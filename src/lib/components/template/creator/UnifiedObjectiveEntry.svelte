<script lang="ts">
	import type { TemplateCreationContext } from '$lib/types/template';
	import { Sparkles, ArrowRight } from '@lucide/svelte';
	import { api } from '$lib/core/api/client';
	import { slide, fade } from 'svelte/transition';
	import { onMount, tick } from 'svelte';
	import { AI_SUGGESTION_TIMING } from '$lib/constants/ai-timing';
	import { calculateSimilarity } from '$lib/utils/similarity';
	import { SuggestionCache } from '$lib/services/ai/suggestion-cache';
	import { SuggestionRateLimiter } from '$lib/services/ai/rate-limiter';
	import SlugCustomizer from './SlugCustomizer.svelte';
	import ClarificationPanel from './ClarificationPanel.svelte';
	import type {
		ClarificationQuestion,
		InferredContext,
		ClarificationAnswers
	} from '$lib/core/agents/types/clarification';

	interface Props {
		data: {
			rawInput: string;
			title: string;
			description: string;
			domain: string;
			topics?: string[];
			slug?: string;
			voiceSample?: string;
			audienceGuidance?: string;
			aiGenerated?: boolean;
		};
		context: TemplateCreationContext;
		/** Called when user accepts AI suggestion - triggers flow advancement */
		onAccept?: () => void;
		/** Exposes the current ready suggestion so parent can auto-apply on close */
		pendingSuggestion?: {
			subject_line: string;
			core_message: string;
			topics: string[];
			domain: string;
			url_slug: string;
			voice_sample: string;
		} | null;
		/** Restored suggestion from draft — shows panel immediately without re-generating */
		initialSuggestion?: {
			subject_line: string;
			core_message: string;
			topics: string[];
			domain: string;
			url_slug: string;
			voice_sample: string;
		} | null;
		/** Exposes template link readiness: true = valid & available, false = invalid/taken, null = checking */
		slugReady?: boolean | null;
	}

	import { normalizeTopics } from '$lib/utils/topic-normalization';

	let {
		data = $bindable(),
		context,
		onAccept,
		pendingSuggestion = $bindable(null),
		initialSuggestion = null,
		slugReady = $bindable(null)
	}: Props = $props();

	// State
	type SuggestionState =
		| { status: 'idle' }
		| { status: 'thinking'; startTime: number }
		| { status: 'streaming'; thoughts: string[]; startTime: number }
		| {
				status: 'clarifying';
				questions: ClarificationQuestion[];
				inferredContext: InferredContext;
				interactionId: string;
		  }
		| { status: 'ready'; suggestion: AISuggestion }
		| { status: 'error'; message: string };

	interface AISuggestion {
		subject_line: string;
		core_message: string;
		topics: string[];
		domain: string;
		url_slug: string;
		voice_sample: string;
		interactionId?: string;
		detected_location?: string | null;
	}

	/** Shape of response data when agent needs clarification */
	interface ClarificationResponseData {
		needs_clarification: boolean;
		clarification_questions?: ClarificationQuestion[];
		inferred_context?: InferredContext;
		interactionId?: string;
	}

	const defaultInferredContext: InferredContext = {
		detected_location: null,
		detected_scope: null,
		detected_target_type: null,
		location_confidence: 0,
		scope_confidence: 0,
		target_type_confidence: 0
	};

	let suggestionState = $state<SuggestionState>({ status: 'idle' });
	let showAISuggest = $state(false);
	let attemptCount = $state(0);
	let audienceGuidance = $state(data.audienceGuidance || '');
	let isGenerating = $state(false);
	let userWantsAI = $state(true); // AI mode enabled - but explicit trigger required (Cmd/Ctrl+Enter)
	let manualMode = $state(false); // User writing subject line manually
	let hasAutoTriggered = $state(false); // Track if we've auto-triggered once

	// Store complete context for clarification turns
	let conversationContext = $state<{
		originalDescription: string;
		questionsAsked: ClarificationQuestion[];
		inferredContext: InferredContext;
	} | null>(null);

	// Iteration history (perceptual substrate for temporal navigation)
	let suggestionHistory = $state<AISuggestion[]>([]);
	let selectedIterationIndex = $state<number>(0);

	// Inline editing state for suggestion refinement
	let editingSubjectLine = $state(false);
	let editingCoreMessage = $state(false);

	// Real-time generation state
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let currentRequestId: string | null = null;
	let lastGeneratedText = '';

	// Thought container ref for auto-scroll
	let thoughtContainerRef: HTMLDivElement | null = $state(null);

	// Cache and rate limiter
	const suggestionCache = new SuggestionCache<AISuggestion>();
	const rateLimiter = new SuggestionRateLimiter();

	// Derived (perceptual state)
	const canShowRegenerateButton = $derived(
		showAISuggest && suggestionState.status === 'ready' && attemptCount < 5
	);

	// OS-aware keyboard shortcut (Cmd for Mac, Ctrl for Windows/Linux)
	// Using text labels instead of symbols for screen reader compatibility
	let isMac = $state(false);
	const shortcutKey = $derived(isMac ? 'Cmd' : 'Ctrl');


	// Settled state: rawInput transforms from editable workspace to grounded artifact
	// When user has accepted an AI suggestion, the original input is "settled" - read-only reference
	const isSettled = $derived(data.aiGenerated === true && !!data.title?.trim());
	let showEditConfirm = $state(false); // Inline confirmation for editing settled input

	// Written-state: text exists but hasn't been AI-refined yet
	let isEditingRawInput = $state(true); // Default to textarea; onMount may flip to quote
	const hasExistingText = $derived(
		(data.rawInput || '').trim().length >= AI_SUGGESTION_TIMING.MIN_INPUT_LENGTH
	);

	// Auto-scroll thought container when new thoughts arrive
	$effect(() => {
		if (
			suggestionState.status === 'streaming' &&
			suggestionState.thoughts.length > 0 &&
			thoughtContainerRef
		) {
			// Smooth scroll to bottom
			thoughtContainerRef.scrollTo({
				top: thoughtContainerRef.scrollHeight,
				behavior: 'smooth'
			});
		}
	});

	// Current displayed suggestion (from history if navigating, else from state)
	const currentSuggestion = $derived<AISuggestion | null>(
		suggestionHistory.length > 0
			? suggestionHistory[selectedIterationIndex]
			: suggestionState.status === 'ready'
				? suggestionState.suggestion
				: null
	);

	// Sync bindable pendingSuggestion so parent can auto-apply on close
	$effect(() => {
		pendingSuggestion = showAISuggest ? currentSuggestion : null;
	});

	// Sync suggestion fields to formData so downstream steps always have current values.
	// Without this, "Pick Decision-Makers" can advance with stale/empty description
	// because acceptSuggestion() only commits on explicit "Use this" click.
	$effect(() => {
		if (currentSuggestion && showAISuggest) {
			if (currentSuggestion.subject_line) {
				data.title = currentSuggestion.subject_line;
			}
			if (currentSuggestion.url_slug) {
				data.slug = currentSuggestion.url_slug;
			}
			if (currentSuggestion.core_message) {
				data.description = currentSuggestion.core_message;
			}
			if (currentSuggestion.voice_sample) {
				data.voiceSample = currentSuggestion.voice_sample;
			}
			if (currentSuggestion.topics?.length) {
				data.topics = normalizeTopics(
					currentSuggestion.topics,
					currentSuggestion.detected_location
				);
			}
			if (currentSuggestion.domain) {
				data.domain = currentSuggestion.domain;
			}
		}
	});

	// Is user viewing an older iteration (not the latest)?
	const isViewingPastIteration = $derived(
		suggestionHistory.length > 0 && selectedIterationIndex < suggestionHistory.length - 1
	);

	// React to rawInput changes - no auto-generation on typing
	// Explicit trigger required via Cmd/Ctrl+Enter (see handleTextareaKeydown)
	// This $effect only cleans up any stale timers
	$effect(() => {
		// Cancel any existing timer (cleanup only - no new timers started)
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = undefined;
		}
	});

	async function handleDebouncedGeneration(text: string): Promise<void> {
		// Check cache
		const cacheKey = text.trim().toLowerCase();
		const cached = suggestionCache.get(cacheKey);
		if (cached) {
			console.log('[AI] Using cached suggestion');
			suggestionState = { status: 'ready', suggestion: cached };
			showAISuggest = true;
			return;
		}

		// Check rate limit
		if (!rateLimiter.canMakeCall()) {
			const remaining = Math.ceil(rateLimiter.getTimeUntilReset() / 1000);
			suggestionState = {
				status: 'error',
				message: `Slow down. Try again in ${remaining}s.`
			};
			return;
		}

		// Set generating flag to prevent double-triggers
		isGenerating = true;
		try {
			await generateSuggestionWithTiming(text);
		} finally {
			isGenerating = false;
		}
	}

	async function generateSuggestionWithTiming(
		text: string,
		clarificationAnswers?: ClarificationAnswers,
		interactionId?: string
	): Promise<void> {
		const requestId = crypto.randomUUID();
		currentRequestId = requestId;

		const startTime = Date.now();

		// For clarification answers, use non-streaming API (simpler flow)
		if (clarificationAnswers || interactionId) {
			await generateWithNonStreaming(
				text,
				requestId,
				startTime,
				clarificationAnswers,
				interactionId
			);
			return;
		}

		// Use streaming for initial generation - show thoughts in real-time
		try {
			rateLimiter.recordCall();

			// Start with streaming state immediately (no delay - perceptual continuity)
			suggestionState = { status: 'streaming', thoughts: [], startTime };

			await api.stream<{ content?: string; data?: AISuggestion; message?: string }>(
				'/agents/stream-subject',
				{ message: text },
				(event) => {
					// Ignore stale responses
					if (requestId !== currentRequestId) return;

					switch (event.type) {
						case 'thought':
							// Accumulate thoughts for display
							if (event.data.content && suggestionState.status === 'streaming') {
								suggestionState = {
									...suggestionState,
									thoughts: [...suggestionState.thoughts, event.data.content]
								};
							}
							break;

						case 'clarification':
							if (event.data.data) {
								// Stream generic types data as AISuggestion, but clarification events carry different shape
								const responseData = event.data.data as unknown as ClarificationResponseData;
								suggestionState = {
									status: 'clarifying',
									questions: responseData.clarification_questions || [],
									inferredContext: responseData.inferred_context || defaultInferredContext,
									interactionId: crypto.randomUUID()
								};
								conversationContext = {
									originalDescription: text,
									questionsAsked: responseData.clarification_questions || [],
									inferredContext: responseData.inferred_context || defaultInferredContext
								};
								showAISuggest = true;
							}
							break;

						case 'complete':
							if (event.data.data) {
								const raw = event.data.data as Record<string, unknown>;
								const ctx = raw.inferred_context as Record<string, unknown> | undefined;
								const newSuggestion: AISuggestion = {
									...(raw as unknown as AISuggestion),
									detected_location: (ctx?.detected_location as string) ?? null,
								};
								suggestionCache.set(text.trim().toLowerCase(), newSuggestion);
								suggestionHistory = [...suggestionHistory, newSuggestion];
								selectedIterationIndex = suggestionHistory.length - 1;
								suggestionState = { status: 'ready', suggestion: newSuggestion };
								showAISuggest = true;
								lastGeneratedText = text;
								attemptCount++;
							}
							break;

						case 'error':
							suggestionState = {
								status: 'error',
								message: event.data.message || 'Something broke. Try again.'
							};
							break;
					}
				}
			);
		} catch (err) {
			if (requestId === currentRequestId) {
				suggestionState = {
					status: 'error',
					message: err instanceof Error ? err.message : 'Something broke. Try again.'
				};
			}
		}
	}

	/**
	 * Non-streaming generation for clarification follow-ups
	 * (Multi-turn context requires the standard API)
	 */
	async function generateWithNonStreaming(
		text: string,
		requestId: string,
		startTime: number,
		clarificationAnswers?: ClarificationAnswers,
		interactionId?: string
	): Promise<void> {
		// Delay showing "thinking" to prevent flash
		const thinkingTimer = setTimeout(() => {
			if (currentRequestId === requestId) {
				suggestionState = { status: 'thinking', startTime };
			}
		}, AI_SUGGESTION_TIMING.MIN_THINKING_DURATION);

		try {
			rateLimiter.recordCall();

			const payload: {
				message: string;
				interactionId?: string;
				clarificationAnswers?: ClarificationAnswers;
			} = { message: text };

			if (interactionId) {
				payload.interactionId = interactionId;
			}

			if (clarificationAnswers) {
				payload.clarificationAnswers = clarificationAnswers;
			}

			const response = await api.post('/agents/generate-subject', payload, {
				timeout: AI_SUGGESTION_TIMING.SUGGESTION_TIMEOUT,
				retries: AI_SUGGESTION_TIMING.MAX_RETRIES,
				showToast: false,
				skipErrorLogging: true
			});

			clearTimeout(thinkingTimer);

			// Ignore stale responses
			if (requestId !== currentRequestId) {
				return;
			}

			if (response.success && response.data) {
				// Check if agent needs clarification
				const clarificationData = response.data as ClarificationResponseData;
				if (clarificationData.needs_clarification) {
					suggestionState = {
						status: 'clarifying',
						questions: clarificationData.clarification_questions || [],
						inferredContext: clarificationData.inferred_context || defaultInferredContext,
						interactionId: clarificationData.interactionId || crypto.randomUUID()
					};

					// Store complete context for reconstruction on answer submission
					conversationContext = {
						originalDescription: text,
						questionsAsked: clarificationData.clarification_questions || [],
						inferredContext: clarificationData.inferred_context || defaultInferredContext
					};

					showAISuggest = true;
					return;
				}

				// Cache result
				suggestionCache.set(text.trim().toLowerCase(), response.data as AISuggestion);

				const newSuggestion = response.data as AISuggestion;

				// Add to history (temporal substrate)
				suggestionHistory = [...suggestionHistory, newSuggestion];
				selectedIterationIndex = suggestionHistory.length - 1; // Auto-select latest

				suggestionState = { status: 'ready', suggestion: newSuggestion };
				showAISuggest = true;
				lastGeneratedText = text;
				attemptCount++;
			} else {
				throw new Error(response.error || 'Generation failed');
			}
		} catch (err) {
			clearTimeout(thinkingTimer);

			if (requestId === currentRequestId) {
				const isTimeout = err instanceof Error && err.name === 'AbortError';
				suggestionState = {
					status: 'error',
					message: isTimeout
						? 'AI took too long. Try again or write your own.'
						: err instanceof Error ? err.message : 'Something broke. Try again.'
				};
			}
		}
	}

	async function generateSuggestion(): Promise<void> {
		// Prevent concurrent generation (race condition: rapid clicks or re-renders)
		if (isGenerating || attemptCount >= 5) return;

		isGenerating = true;

		// Cancel any pending debounce
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		await generateSuggestionWithTiming(data.rawInput);

		isGenerating = false;
	}

	// Cleanup on unmount
	onMount(() => {
		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	});

	function acceptSuggestion() {
		if (currentSuggestion) {
			const { subject_line, core_message, url_slug, topics, domain, voice_sample, detected_location } = currentSuggestion;
			data.title = subject_line || '';
			// Fallback chain for core_message: use raw input if agent didn't provide one
			data.description = core_message || data.rawInput || '';
			data.slug = url_slug || '';
			// Fallback chain for voice_sample: prefer agent-extracted, then raw input
			data.voiceSample = voice_sample || data.rawInput || '';
			// Normalize topics, filtering out any leaked location names
			const normalized = normalizeTopics(topics || [], detected_location);
			data.topics = normalized;
			data.domain = domain || '';
			data.aiGenerated = true;
			data.audienceGuidance = audienceGuidance.trim() || undefined;
			showAISuggest = false;

			// Flow advancement: user accepted subject line, advance to decision-makers
			// Perceptual: ArrowRight icon on button sets expectation of forward motion
			onAccept?.();
		}
	}

	// Temporal navigation functions
	function navigateToIteration(index: number) {
		if (index >= 0 && index < suggestionHistory.length) {
			selectedIterationIndex = index;
			editingSubjectLine = false;
			editingCoreMessage = false;
		}
	}

	function navigatePrevious() {
		if (selectedIterationIndex > 0) {
			selectedIterationIndex--;
		}
	}

	function navigateNext() {
		if (selectedIterationIndex < suggestionHistory.length - 1) {
			selectedIterationIndex++;
		}
	}

	// Inline edit: commit refined subject line back into suggestion history
	async function startEditingField(field: 'subject' | 'core') {
		if (field === 'subject') {
			editingSubjectLine = true;
			await tick();
			const input = document.querySelector('[data-edit-subject]') as HTMLInputElement;
			input?.focus();
			input?.select();
		} else {
			editingCoreMessage = true;
			await tick();
			const textarea = document.querySelector('[data-edit-core]') as HTMLTextAreaElement;
			textarea?.focus();
		}
	}

	// Guard: when Escape cancels an edit, the DOM removal fires blur — skip commit
	let editCancelled = false;

	function commitSubjectLineEdit(newValue: string) {
		if (editCancelled) return;
		const trimmed = newValue.trim();
		if (trimmed && suggestionHistory.length > 0) {
			suggestionHistory[selectedIterationIndex] = {
				...suggestionHistory[selectedIterationIndex],
				subject_line: trimmed
			};
		}
		editingSubjectLine = false;
	}

	function commitCoreMessageEdit(newValue: string) {
		if (editCancelled) return;
		const trimmed = newValue.trim();
		if (trimmed && suggestionHistory.length > 0) {
			suggestionHistory[selectedIterationIndex] = {
				...suggestionHistory[selectedIterationIndex],
				core_message: trimmed
			};
		}
		editingCoreMessage = false;
	}

	function cancelEdit(field: 'subject' | 'core') {
		editCancelled = true;
		if (field === 'subject') editingSubjectLine = false;
		else editingCoreMessage = false;
		// Reset after blur has fired (DOM removal → blur is synchronous in same microtask)
		tick().then(() => { editCancelled = false; });
	}

	function handleSubjectLineKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			commitSubjectLineEdit((event.target as HTMLInputElement).value);
		} else if (event.key === 'Escape') {
			event.stopPropagation();
			cancelEdit('subject');
		}
	}

	function handleCoreMessageKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			commitCoreMessageEdit((event.target as HTMLTextAreaElement).value);
		} else if (event.key === 'Escape') {
			event.stopPropagation();
			cancelEdit('core');
		}
	}

	// Keyboard navigation (spatial metaphor: ← → arrows)
	function handleKeyboardNavigation(event: KeyboardEvent) {
		if (!showAISuggest || suggestionHistory.length === 0) return;

		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			navigatePrevious();
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			navigateNext();
		}
	}

	// Attach keyboard listener on mount + auto-trigger if we have initial input
	onMount(() => {
		// Detect OS for keyboard shortcut display
		isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

		window.addEventListener('keydown', handleKeyboardNavigation);

		// Three restoration paths, checked in priority order:
		//
		// 1. ACCEPTED suggestion (user clicked "Use this" — this is the source of truth)
		// 2. Pending suggestion from draft (user saw it but didn't click "Use this")
		// 3. Fresh start (auto-trigger generation if sufficient input)
		//
		// CRITICAL: Accepted state (aiGenerated + title) takes priority over pending suggestion.
		// This prevents the bug where navigating back restores stale pending state.

		if (data.aiGenerated && data.title?.trim()) {
			// Path 1: Reconstruct from ACCEPTED state (formData is source of truth)
			// User already accepted → lock in the result, don't re-generate
			const reconstructed: AISuggestion = {
				subject_line: data.title,
				core_message: data.description || data.rawInput || '',
				topics: data.topics || [],
				url_slug: data.slug || '',
				voice_sample: data.voiceSample || data.rawInput || ''
			};
			suggestionHistory = [reconstructed];
			selectedIterationIndex = 0;
			suggestionState = { status: 'ready', suggestion: reconstructed };
			showAISuggest = true;
			hasAutoTriggered = true;
			lastGeneratedText = data.rawInput || '';
			attemptCount = 1;
		} else if (initialSuggestion) {
			// Path 2: Restore pending suggestion from draft (user saw but didn't accept)
			const restored: AISuggestion = {
				subject_line: initialSuggestion.subject_line,
				core_message: initialSuggestion.core_message,
				topics: initialSuggestion.topics,
				url_slug: initialSuggestion.url_slug,
				voice_sample: initialSuggestion.voice_sample
			};
			suggestionHistory = [restored];
			selectedIterationIndex = 0;
			suggestionState = { status: 'ready', suggestion: restored };
			showAISuggest = true;
			hasAutoTriggered = true;
			lastGeneratedText = data.rawInput || '';
			attemptCount = 1;
		} else {
			// Path 3: Fresh start — auto-trigger if we have sufficient pre-filled input
			// The $effect also watches rawInput, but the hasAutoTriggered guard
			// prevents it from double-firing after this direct call.
			// For from-scratch typing (empty rawInput), this path skips and the
			// $effect handles debounced generation as the user types.
			const text = data.rawInput || '';
			if (
				text.trim().length >= AI_SUGGESTION_TIMING.MIN_INPUT_LENGTH &&
				!hasAutoTriggered &&
				userWantsAI &&
				!manualMode
			) {
				hasAutoTriggered = true;
				handleDebouncedGeneration(text);
			}
		}

		// Initialize raw input display mode: quote view when text exists, textarea when empty
		isEditingRawInput = !((data.rawInput || '').trim().length >= AI_SUGGESTION_TIMING.MIN_INPUT_LENGTH);

		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			window.removeEventListener('keydown', handleKeyboardNavigation);
		};
	});

	function editRawWriting() {
		// Keep suggestion visible — user is editing raw input, not discarding the result
		startEditingRawInput();
	}

	function startEditingRawInput() {
		isEditingRawInput = true;
		tick().then(() => {
			const textarea = document.getElementById('raw-input') as HTMLTextAreaElement;
			if (textarea) {
				textarea.focus();
				textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
			}
		});
	}

	function finishEditingRawInput() {
		// Only return to quote view if there's meaningful content
		if ((data.rawInput || '').trim().length >= AI_SUGGESTION_TIMING.MIN_INPUT_LENGTH) {
			isEditingRawInput = false;
		}
	}

	function enableAISuggestions() {
		userWantsAI = true;
		manualMode = false;
		// Trigger generation immediately if we have enough input
		if ((data.rawInput || '').trim().length >= AI_SUGGESTION_TIMING.MIN_INPUT_LENGTH) {
			generateSuggestion();
		}
	}

	// Handle keyboard shortcuts in textarea
	function handleTextareaKeydown(event: KeyboardEvent) {
		// Cmd/Ctrl + Enter to trigger generation immediately
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			if (
				(data.rawInput || '').trim().length >= AI_SUGGESTION_TIMING.MIN_INPUT_LENGTH &&
				!isGenerating
			) {
				generateSuggestion();
			}
		}
	}

	function writeManually() {
		manualMode = true;
		userWantsAI = false;
		showAISuggest = false;
		suggestionState = { status: 'idle' };
		// Capture rawInput as voice sample for downstream agents
		// Manual writers still have voice—it's in their original complaint
		if (data.rawInput && data.rawInput.trim()) {
			data.voiceSample = data.rawInput.trim();
		}
		data.aiGenerated = false;
		isEditingRawInput = true;
	}

	/**
	 * Handle clarification answers submission
	 * Sends COMPLETE context (original + questions + answers) via streaming endpoint
	 * so user sees thoughts while the agent processes their answers.
	 */
	async function handleClarificationSubmit(answers: Record<string, string>): Promise<void> {
		// Prevent concurrent submissions (race condition: double-click or click+Escape)
		if (isGenerating || suggestionState.status !== 'clarifying' || !conversationContext) return;

		// Build full conversation context for the agent
		const fullContext = {
			originalDescription: conversationContext.originalDescription,
			questionsAsked: conversationContext.questionsAsked,
			inferredContext: conversationContext.inferredContext,
			answers: answers as ClarificationAnswers
		};

		isGenerating = true;
		const requestId = crypto.randomUUID();
		currentRequestId = requestId;

		// Show streaming state with thoughts
		// showAISuggest must be false so the streaming thought viewer renders
		suggestionState = { status: 'streaming', thoughts: [], startTime: Date.now() };
		showAISuggest = false;

		try {
			await api.stream<{ content?: string; data?: AISuggestion; message?: string }>(
				'/agents/stream-subject',
				{
					message: data.rawInput,
					conversationContext: fullContext
				},
				(event) => {
					if (requestId !== currentRequestId) return;

					switch (event.type) {
						case 'thought':
							if (event.data.content && suggestionState.status === 'streaming') {
								suggestionState = {
									...suggestionState,
									thoughts: [...suggestionState.thoughts, event.data.content]
								};
							}
							break;

						case 'complete':
							if (event.data.data) {
								const raw = event.data.data as Record<string, unknown>;
								const ctx = raw.inferred_context as Record<string, unknown> | undefined;
								const newSuggestion: AISuggestion = {
									...(raw as unknown as AISuggestion),
									detected_location: (ctx?.detected_location as string) ?? null,
								};
								suggestionCache.set(data.rawInput.trim().toLowerCase(), newSuggestion);
								suggestionHistory = [...suggestionHistory, newSuggestion];
								selectedIterationIndex = suggestionHistory.length - 1;
								suggestionState = { status: 'ready', suggestion: newSuggestion };
								showAISuggest = true;
								lastGeneratedText = data.rawInput;
								attemptCount++;
								conversationContext = null;
							}
							break;

						case 'error':
							suggestionState = {
								status: 'error',
								message: event.data.message || 'Something broke after clarification. Try again.'
							};
							break;
					}
				}
			);
		} catch (err) {
			if (requestId === currentRequestId) {
				suggestionState = {
					status: 'error',
					message: err instanceof Error ? err.message : 'Something broke after clarification. Try again.'
				};
			}
		} finally {
			isGenerating = false;
		}
	}

	/**
	 * Handle clarification skip
	 * Still sends context but with empty answers - agent uses best guesses
	 */
	async function handleClarificationSkip(): Promise<void> {
		// Treat skip as submitting empty answers - agent will use inferred context
		await handleClarificationSubmit({});
	}
</script>

<div class="unified-objective-entry">
	<!-- Raw writing surface: Settled artifact OR editable textarea -->
	{#if isSettled && !manualMode}
		<!-- SETTLED STATE: Read-only artifact presentation -->
		<div
			class="settled-artifact rounded-lg border border-slate-200 bg-white shadow-sm"
			role="region"
			aria-label="Your original concern"
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-4 py-3">
				<span class="text-xs font-medium uppercase tracking-wide text-slate-500">Your concern</span>
				<button
					type="button"
					onclick={() => (showEditConfirm = !showEditConfirm)}
					class="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-700"
					aria-expanded={showEditConfirm}
				>
					<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
					</svg>
					Edit
				</button>
			</div>

			<!-- Content: The original input displayed as quotation -->
			<div class="px-4 py-4">
				<blockquote class="border-l-2 border-slate-200 pl-3 text-base leading-relaxed text-slate-700">
					"{data.rawInput}"
				</blockquote>
			</div>

			<!-- Inline edit confirmation (slides in when Edit clicked) -->
			{#if showEditConfirm}
				<div
					class="border-t border-slate-100 bg-amber-50 px-4 py-3"
					transition:slide={{ duration: 150 }}
					role="alertdialog"
					aria-labelledby="edit-confirm-label"
				>
					<p id="edit-confirm-label" class="text-sm text-amber-800">
						Editing will reset your subject line. You'll need to generate a new one.
					</p>
					<div class="mt-2 flex gap-2">
						<button
							type="button"
							onclick={() => {
								showEditConfirm = false;
								data.aiGenerated = false;
								showAISuggest = false;
								suggestionState = { status: 'idle' };
								hasAutoTriggered = false;
								isEditingRawInput = true;
							}}
							class="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700"
						>
							Edit anyway
						</button>
						<button
							type="button"
							onclick={() => (showEditConfirm = false)}
							class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
						>
							Keep it
						</button>
					</div>
				</div>
			{/if}

			<!-- Footer with Start Fresh -->
			<div class="flex items-center justify-end border-t border-slate-100 bg-slate-50/30 px-4 py-2">
				<button
					type="button"
					onclick={() => {
						data.rawInput = '';
						data.title = '';
						data.description = '';
						data.slug = '';
						data.aiGenerated = false;
						data.voiceSample = '';
						data.topics = [];
						showAISuggest = false;
						suggestionState = { status: 'idle' };
						suggestionHistory = [];
						hasAutoTriggered = false;
						showEditConfirm = false;
						isEditingRawInput = true;
					}}
					class="transform-gpu rounded-md px-2 py-1 text-sm text-slate-500
						transition-all duration-150
						hover:bg-slate-100/60 hover:text-slate-700
						active:scale-[0.97] active:bg-slate-200/60"
				>
					Start fresh →
				</button>
			</div>
		</div>
	{:else if hasExistingText && !isEditingRawInput && !manualMode}
		<!-- WRITTEN STATE: Pre-existing text displayed as quote artifact -->
		<div
			class="written-artifact rounded-lg border border-participation-primary-200 bg-gradient-to-br from-participation-primary-50/40 to-white shadow-sm"
			role="region"
			aria-label="Your concern"
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-participation-primary-100 bg-participation-primary-50/30 px-4 py-3">
				<span class="text-xs font-medium uppercase tracking-wide text-participation-primary-600/70">Your concern</span>
				<button
					type="button"
					onclick={startEditingRawInput}
					class="inline-flex items-center gap-1 text-sm text-participation-primary-500 transition-colors hover:text-participation-primary-700"
				>
					<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
					</svg>
					Edit
				</button>
			</div>

			<!-- Content: blockquote -->
			<div class="px-4 py-4">
				<blockquote class="border-l-2 border-participation-primary-300 pl-3 text-base leading-relaxed text-slate-700">
					"{data.rawInput}"
				</blockquote>
			</div>

			<!-- Footer -->
			<div class="flex items-center justify-end border-t border-participation-primary-100 bg-participation-primary-50/20 px-4 py-2.5">
				<div class="flex items-center gap-3">
					{#if !isGenerating}
						<button
							type="button"
							onclick={() => generateSuggestion()}
							class="inline-flex transform-gpu items-center gap-1.5 px-1 py-0.5
							text-sm font-medium text-participation-primary-600
							transition-all duration-150
							hover:scale-[1.04] hover:text-participation-primary-700
							active:scale-[0.97]"
						>
							<kbd class="hidden rounded bg-participation-primary-100 px-1 py-0.5 font-mono text-xs text-participation-primary-700 md:inline">{shortcutKey}+Enter</kbd>
							<span class="text-xs md:hidden"><Sparkles class="inline h-3 w-3" aria-hidden="true" /> Generate</span>
						</button>
					{/if}
					<button
						type="button"
						onclick={() => {
							data.rawInput = '';
							data.aiGenerated = false;
							showAISuggest = false;
							suggestionState = { status: 'idle' };
							hasAutoTriggered = false;
							isEditingRawInput = true;
						}}
						class="transform-gpu rounded-md px-2 py-1 text-xs text-participation-primary-400
							transition-all duration-150
							hover:bg-participation-primary-100/60 hover:text-participation-primary-600
							active:scale-[0.97] active:bg-participation-primary-200/60"
					>
						Start fresh
					</button>
				</div>
			</div>
		</div>
	{:else}
		<!-- ACTIVE STATE: Editable textarea -->
		<div class="raw-writing-surface">
			<label for="raw-input" class="mb-2 block text-sm font-medium text-slate-700">
				What needs to change?
			</label>

			<textarea
				id="raw-input"
				bind:value={data.rawInput}
				onkeydown={handleTextareaKeydown}
				onblur={finishEditingRawInput}
				placeholder="The rent keeps going up but wages don't..."
				rows="5"
				disabled={isGenerating}
				tabindex={0}
				class="w-full rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-3
	             text-base text-slate-900 transition-colors duration-200
	             placeholder:italic placeholder:text-slate-500 focus:border-participation-primary-500 focus:bg-white focus:outline-none
	             focus:ring-2 focus:ring-participation-primary-500
	             disabled:cursor-not-allowed disabled:opacity-60"
			></textarea>

			<div class="mt-2 flex items-center justify-between text-xs text-slate-600">
				{#if (data.rawInput || '').trim().length > 0}
					<span class="font-mono">{(data.rawInput || '').length} characters</span>
				{:else}
					<span class="italic">Describe the problem you want to solve</span>
				{/if}
				{#if !isSettled && !manualMode}
					{#if !isGenerating && (data.rawInput || '').trim().length >= AI_SUGGESTION_TIMING.MIN_INPUT_LENGTH}
						<button
							type="button"
							onpointerdown={(e) => e.preventDefault()}
							onclick={() => generateSuggestion()}
							class="inline-flex transform-gpu items-center gap-1.5 px-1 py-0.5
							font-medium text-participation-primary-600
							transition-all duration-150
							hover:scale-[1.04] hover:text-participation-primary-700
							active:scale-[0.97]"
						>
							<Sparkles class="h-3 w-3" aria-hidden="true" />
							<kbd class="hidden rounded bg-participation-primary-100 px-1 py-0.5 font-mono text-participation-primary-700 md:inline">{shortcutKey}+Enter</kbd>
							<span class="text-xs md:hidden">Generate</span>
						</button>
					{:else if !isGenerating}
						<div class="flex items-center gap-1.5 text-slate-400">
							<Sparkles class="h-3 w-3" aria-hidden="true" />
							<kbd class="hidden rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-400 md:inline">{shortcutKey}+Enter</kbd>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	<!-- Streaming thoughts (perceptual engineering: scannable research log) -->
	{#if !isSettled && suggestionState.status === 'streaming' && !showAISuggest}
		<div
			class="mt-4 rounded-md border border-participation-primary-200/60 bg-participation-primary-50 p-3 "
			transition:fade={{ duration: 200 }}
			role="status"
			aria-live="polite"
			aria-label="AI analysis in progress"
		>
			<!-- Header with activity indicator -->
			<div class="mb-2 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<span class="relative flex h-2 w-2" aria-hidden="true">
						<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-participation-primary-400 opacity-75"></span>
						<span class="relative inline-flex h-2 w-2 rounded-full bg-participation-primary-500"></span>
					</span>
					<span class="text-xs font-medium text-participation-primary-600/70">Analyzing your message...</span>
				</div>
				<button
					type="button"
					onclick={writeManually}
					class="text-xs text-participation-primary-400 transition-colors hover:text-participation-primary-600"
				>
					I'll write my own
				</button>
			</div>

			<!-- Thought log - left-justified, scannable -->
			<div bind:this={thoughtContainerRef} class="max-h-32 space-y-1 overflow-y-auto" role="log">
				{#if suggestionState.thoughts.length === 0}
					<p class="py-2 text-sm italic text-participation-primary-400">understanding your concern...</p>
				{:else}
					{#each suggestionState.thoughts as thought, i}
						<p
							class="border-l-2 py-0.5 pl-2 text-sm transition-all duration-150
							{i === suggestionState.thoughts.length - 1 ? 'border-participation-primary-400 bg-participation-primary-100/40 text-participation-primary-900' : 'border-transparent text-participation-primary-700/60'}"
							style="animation: thoughtAppear 0.2s ease-out forwards; opacity: 0;"
						>
							{thought}
						</p>
					{/each}
				{/if}
			</div>
		</div>
	{/if}

	<!-- Fallback thinking indicator (for non-streaming paths like clarification follow-up) -->
	{#if !isSettled && suggestionState.status === 'thinking' && !showAISuggest}
		<div
			class="mt-4 rounded-md border border-participation-primary-200/60 bg-participation-primary-50 p-3 "
			transition:fade={{ duration: 150 }}
		>
			<div class="flex items-center gap-2">
				<span class="relative flex h-2 w-2">
					<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-participation-primary-400 opacity-75"></span>
					<span class="relative inline-flex h-2 w-2 rounded-full bg-participation-primary-500"></span>
				</span>
				<span class="text-xs font-medium text-participation-primary-600/70">Refining with your clarifications...</span>
			</div>
		</div>
	{/if}

	<!-- Clarification panel (shown when agent needs clarification) -->
	{#if showAISuggest && suggestionState.status === 'clarifying'}
		<div class="mt-4" transition:slide={{ duration: 200 }}>
			<ClarificationPanel
				questions={suggestionState.questions}
				inferredContext={suggestionState.inferredContext}
				onSubmit={handleClarificationSubmit}
				onSkip={handleClarificationSkip}
			/>
		</div>
	{/if}

	<!-- Refined suggestion surface -->
	{#if showAISuggest && currentSuggestion}
		<div
			class="mt-4 rounded-md border border-participation-primary-200/60 bg-participation-primary-50 p-4 "
			transition:slide={{ duration: 200 }}
		>
			<!-- Iteration timeline (perceptual temporal navigation) -->
			{#if suggestionHistory.length > 1}
				<div class="mb-4 flex items-center gap-3 border-b border-participation-primary-200 pb-3">
					<button
						type="button"
						onclick={navigatePrevious}
						disabled={selectedIterationIndex === 0}
						class="text-participation-primary-600 transition-opacity hover:text-participation-primary-700 disabled:cursor-not-allowed disabled:opacity-30"
						aria-label="Previous iteration"
					>
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 19l-7-7 7-7"
							/>
						</svg>
					</button>

					<div class="flex flex-1 items-center justify-center gap-2">
						{#each suggestionHistory as _, index}
							<button
								type="button"
								onclick={() => navigateToIteration(index)}
								class="group relative transition-all duration-200 ease-out"
								aria-label={`Iteration ${index + 1}${index === suggestionHistory.length - 1 ? ' (latest)' : ''}`}
							>
								<!-- Dot indicator -->
								<div
									class="h-2.5 w-2.5 rounded-full transition-all duration-200
									{index === selectedIterationIndex
										? 'scale-125 bg-participation-primary-600 ring-2 ring-participation-primary-600 ring-offset-2 ring-offset-participation-primary-50'
										: index === suggestionHistory.length - 1
											? 'bg-participation-primary-400 hover:bg-participation-primary-500'
											: 'bg-participation-primary-300 hover:bg-participation-primary-400'}"
								></div>

								<!-- Tooltip on hover -->
								<div
									class="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
								>
									{index === suggestionHistory.length - 1 ? 'Latest' : `Try ${index + 1}`}
								</div>
							</button>
						{/each}
					</div>

					<button
						type="button"
						onclick={navigateNext}
						disabled={selectedIterationIndex === suggestionHistory.length - 1}
						class="text-participation-primary-600 transition-opacity hover:text-participation-primary-700 disabled:cursor-not-allowed disabled:opacity-30"
						aria-label="Next iteration"
					>
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5l7 7-7 7"
							/>
						</svg>
					</button>
				</div>

				<!-- Viewing past iteration indicator -->
				{#if isViewingPastIteration}
					<div
						class="mb-3 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-xs text-amber-900"
						transition:fade={{ duration: 150 }}
					>
						<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<span class="font-medium"
							>Viewing try {selectedIterationIndex + 1} of {suggestionHistory.length}</span
						>
						<button
							type="button"
							onclick={() => navigateToIteration(suggestionHistory.length - 1)}
							class="ml-auto font-medium text-amber-700 underline hover:text-amber-800"
						>
							Jump to latest
						</button>
					</div>
				{/if}
			{/if}

			{#if suggestionState.status === 'streaming'}
				<!-- Thought traces during regeneration -->
				<div class="mb-4" role="status" aria-live="polite" aria-label="Regenerating">
					<div class="mb-2 flex items-center gap-2">
						<span class="relative flex h-2 w-2" aria-hidden="true">
							<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-participation-primary-400 opacity-75"></span>
							<span class="relative inline-flex h-2 w-2 rounded-full bg-participation-primary-500"></span>
						</span>
						<span class="text-xs font-medium text-participation-primary-600/70">Rethinking...</span>
					</div>
					<div bind:this={thoughtContainerRef} class="max-h-32 space-y-1 overflow-y-auto" role="log">
						{#if suggestionState.thoughts.length === 0}
							<p class="py-2 text-sm italic text-participation-primary-400">finding a new angle...</p>
						{:else}
							{#each suggestionState.thoughts as thought, i}
								<p
									class="border-l-2 py-0.5 pl-2 text-sm transition-all duration-150
										{i === suggestionState.thoughts.length - 1 ? 'border-participation-primary-400 bg-participation-primary-100/40 text-participation-primary-900' : 'border-transparent text-participation-primary-700/60'}"
									style="animation: thoughtAppear 0.2s ease-out forwards; opacity: 0;"
								>
									{thought}
								</p>
							{/each}
						{/if}
					</div>
				</div>
			{:else}
				<!-- Current suggestion content — inline-editable -->
				<div class="md:mb-1">
					<div class="mb-1 flex items-center gap-2">
						<Sparkles class="h-4 w-4 text-participation-primary-600" aria-hidden="true" />
						<span
							class="text-xs font-semibold uppercase tracking-wide text-participation-primary-700"
						>
							Refined Subject Line
						</span>
					</div>

					{#if editingSubjectLine}
						<input
							data-edit-subject
							type="text"
							value={currentSuggestion.subject_line}
							onblur={(e) => commitSubjectLineEdit(e.currentTarget.value)}
							onkeydown={handleSubjectLineKeydown}
							class="w-full rounded-md border-2 border-participation-primary-300 bg-white px-3 py-2
								text-lg font-bold leading-tight text-slate-900
								focus:border-participation-primary-500 focus:outline-none focus:ring-2 focus:ring-participation-primary-500/30"
						/>
					{:else}
						<button
							type="button"
							class="w-full cursor-text rounded px-2 py-1.5 text-left text-lg font-bold leading-tight text-slate-900
								transition-colors duration-150
								hover:bg-white/50
								md:px-1 md:py-0.5"
							onclick={() => startEditingField('subject')}
							title="Tap to edit subject line"
						>
							{currentSuggestion.subject_line}
						</button>
					{/if}
				</div>

				<div class="mb-4 space-y-2 text-sm text-participation-primary-900/80">
					{#if editingCoreMessage}
						<div>
							<strong class="mb-1 block font-semibold">Core message:</strong>
							<textarea
								data-edit-core
								value={currentSuggestion.core_message}
								onblur={(e) => commitCoreMessageEdit(e.currentTarget.value)}
								onkeydown={handleCoreMessageKeydown}
								rows="3"
								class="w-full rounded-md border-2 border-participation-primary-300 bg-white px-3 py-2
									text-base md:text-sm text-slate-900
									focus:border-participation-primary-500 focus:outline-none focus:ring-2 focus:ring-participation-primary-500/30"
							></textarea>
						</div>
					{:else}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="cursor-text rounded px-2 py-1.5 transition-colors duration-150
								hover:bg-white/50
								md:px-1 md:py-0.5"
							onclick={() => startEditingField('core')}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') startEditingField('core'); }}
							role="button"
							tabindex={0}
							title="Tap to edit core message"
						>
							<strong class="font-semibold">Core message:</strong>
							{currentSuggestion.core_message}
						</div>
					{/if}
					<div class="flex flex-wrap gap-1.5">
						{#each currentSuggestion.topics as topic}
							<span class="rounded-full bg-participation-primary-100/70 px-2 py-0.5 text-xs text-participation-primary-800">{topic}</span>
						{/each}
					</div>
					<!-- Audience guidance — optional steering for decision-maker agent -->
					<div class="mt-3 border-t border-participation-primary-200/30 pt-2">
						<textarea
							bind:value={audienceGuidance}
							placeholder="Who should hear this? e.g. &quot;EPA and state agencies&quot; or &quot;Portland city council housing committee&quot;"
							rows="2"
							class="w-full resize-none rounded-md border border-participation-primary-200/40 bg-white/50 px-3 py-2
								text-sm text-slate-700 placeholder:text-slate-400/60
								focus:border-participation-primary-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-participation-primary-400/30
								transition-colors duration-150"
						></textarea>
						<p class="mt-0.5 text-[11px] text-participation-primary-600/40">
							optional — we'll discover decision-makers either way
						</p>
					</div>
				</div>
			{/if}

			<div class="space-y-2">
				<button
					type="button"
					onclick={acceptSuggestion}
					tabindex={0}
					class="inline-flex w-full transform-gpu items-center justify-center gap-2 rounded-lg
                 bg-gradient-to-r from-participation-primary-600 to-participation-primary-500 px-4 py-2.5 text-sm font-semibold text-white
                 shadow-participation-primary transition-all duration-200
                 hover:from-participation-primary-700 hover:to-participation-primary-600 hover:shadow-lg
                 active:scale-[0.97]
                 focus:outline-none focus:ring-2 focus:ring-participation-primary-500 focus:ring-offset-2"
				>
					Use this
					<ArrowRight class="h-4 w-4" />
				</button>

				<div class="flex items-center justify-between">
					{#if attemptCount < 5}
						<button
							type="button"
							onclick={generateSuggestion}
							disabled={isGenerating}
							tabindex={0}
							class="inline-flex transform-gpu items-center gap-2 rounded-md px-2 py-1
								text-sm font-medium text-participation-primary-700
								transition-all duration-150
								hover:bg-participation-primary-100/60 hover:text-participation-primary-900
								active:scale-[0.97] active:bg-participation-primary-200/60
								focus:outline-none focus:underline
								disabled:cursor-not-allowed disabled:opacity-50"
						>
							{#if isGenerating}
								<div
									class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-participation-primary-600 border-t-transparent"
									aria-hidden="true"
								></div>
							{:else}
								<Sparkles class="h-3.5 w-3.5" aria-hidden="true" />
							{/if}
							Try another ({5 - attemptCount} left)
						</button>
					{:else}
						<span class="text-sm text-participation-primary-700/60">Out of refinements</span>
					{/if}

					<button
						type="button"
						onclick={writeManually}
						tabindex={0}
						class="transform-gpu rounded-md px-2 py-1 text-sm text-participation-primary-600
							transition-all duration-150
							hover:bg-participation-primary-100/60 hover:text-participation-primary-800
							active:scale-[0.97] active:bg-participation-primary-200/60
							focus:outline-none focus:underline"
					>
						I'll write it
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Error state -->
	{#if suggestionState.status === 'error'}
		<div
			class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3"
			transition:slide={{ duration: 200 }}
		>
			<p class="text-sm text-red-700">{suggestionState.message}</p>
			<button
				type="button"
				onclick={generateSuggestion}
				class="mt-2 text-sm font-medium text-red-600 underline hover:text-red-800"
			>
				Hit me again
			</button>
		</div>
	{/if}

	<!-- Manual writing mode -->
	{#if manualMode}
		<div class="mt-4 space-y-4" transition:slide={{ duration: 200 }}>
			<div class="rounded-lg border-2 border-slate-200 bg-white p-4">
				<div class="mb-3">
					<label for="manual-title" class="mb-1 block text-sm font-medium text-slate-700">
						Subject Line
					</label>
					<input
						id="manual-title"
						type="text"
						bind:value={data.title}
						placeholder="Make housing affordable in California"
						class="w-full rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-2
                     text-base text-slate-900 transition-colors duration-200
                     placeholder:text-slate-500 focus:border-participation-primary-500 focus:bg-white
                     focus:outline-none focus:ring-2 focus:ring-participation-primary-500"
					/>
				</div>

				<div class="mb-3">
					<label for="manual-description" class="mb-1 block text-sm font-medium text-slate-700">
						Core Message (Optional)
					</label>
					<textarea
						id="manual-description"
						bind:value={data.description}
						placeholder="Brief description of your core message..."
						rows="3"
						class="w-full rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-2
                     text-base text-slate-900 transition-colors duration-200
                     placeholder:text-slate-500 focus:border-participation-primary-500 focus:bg-white
                     focus:outline-none focus:ring-2 focus:ring-participation-primary-500"
					></textarea>
				</div>

				<div class="flex justify-end gap-2">
					<button
						type="button"
						onclick={enableAISuggestions}
						class="inline-flex items-center gap-2 rounded-lg border border-slate-300
                   bg-white px-3 py-2 text-sm font-medium text-slate-700
                   transition-colors duration-150 hover:bg-slate-50"
					>
						<Sparkles class="h-3.5 w-3.5" aria-hidden="true" />
						Refine it for me
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Slug customizer (existing component, unchanged) -->
	<div class="mt-6">
		<SlugCustomizer
			title={data.title}
			bind:slug={data.slug}
			aiGenerated={data.aiGenerated}
			{context}
			bind:slugReady
		/>
	</div>
</div>

<style>
	/*
	 * Streaming Thoughts Animation
	 *
	 * Perceptual Engineering: Each thought fades in quickly,
	 * creating the feeling of emergence. Fast (200ms) to maintain
	 * reading flow without jarring transitions.
	 */
	@keyframes -global-thoughtAppear {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
