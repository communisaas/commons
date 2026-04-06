<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { TemplateFormData, Source } from '$lib/types/template';
	import { cleanHtmlFormatting } from '$lib/utils/message-processing';
	import { parseSSEStream } from '$lib/utils/sse-stream';
	import AgentThinking from '$lib/components/ui/AgentThinking.svelte';
	import MessageResults from './MessageResults.svelte';
	import AuthGateOverlay from './AuthGateOverlay.svelte';
	import SourceEditor from './SourceEditor.svelte';
	import { FileText } from '@lucide/svelte';

	interface Props {
		formData: TemplateFormData;
		onnext: () => void;
		onback: () => void;
		/** Draft ID for OAuth resumption */
		draftId?: string;
		/** Save draft callback for OAuth flow */
		onSaveDraft?: () => void;
		/** Error message to display inline (from parent validation or API) */
		publishError?: string | null;
		/** Whether publish is in progress */
		isPublishing?: boolean;
	}

	let {
		formData = $bindable(),
		onnext,
		onback,
		draftId,
		onSaveDraft,
		publishError = null,
		isPublishing = false
	}: Props = $props();

	type Stage = 'generating' | 'results' | 'editing' | 'error' | 'auth-required' | 'rate-limited';
	let stage = $state<Stage>('generating');
	let errorMessage = $state<string | null>(null);
	let rateLimitResetAt = $state<string | null>(null);
	let rateLimitMessage = $state<string | null>(null);
	let isGenerating = $state(false);

	// Streaming state
	let thoughts = $state<string[]>([]);

	/**
	 * Check if error indicates auth is required
	 * Matches rate limiter 429 responses for guests
	 */
	function isAuthRequiredError(err: unknown): boolean {
		if (err instanceof Error) {
			const msg = err.message.toLowerCase();
			return (
				msg.includes('requires an account') ||
				msg.includes('sign in') ||
				msg.includes('authentication required') ||
				msg.includes('401')
			);
		}
		return false;
	}

	/**
	 * Build progress items for auth gate - shows sunk cost
	 */
	function buildAuthProgressItems() {
		const items = [];

		// Their subject line
		if (formData.objective.title) {
			items.push({
				label: 'Subject line',
				value: formData.objective.title,
				secondary: formData.objective.description
			});
		}

		// Their selected decision-makers (truncated list)
		const dmCount = formData.audience?.decisionMakers?.length || 0;
		if (dmCount > 0) {
			const firstDm = formData.audience.decisionMakers[0];
			const dmValue =
				dmCount === 1
					? firstDm.name
					: `${firstDm.name} + ${dmCount - 1} other${dmCount > 2 ? 's' : ''}`;
			items.push({
				label: 'Decision-makers',
				value: dmValue,
				secondary: firstDm.title
			});
		}

		return items;
	}

	// Store original AI-generated content for "start fresh"
	let originalMessage = $state('');
	let originalSubject = $state('');
	let originalSources = $state<Source[]>([]);

	// Textarea ref for cursor-position insertion
	let editTextarea: HTMLTextAreaElement;

	/**
	 * Build topics array with robust fallback chain
	 * 1. Use topics array if populated with valid entries
	 * 2. Fall back to category (normalized)
	 * 3. Ultimate fallback - 'general'
	 */
	function buildTopics(): string[] {
		if (Array.isArray(formData.objective.topics) && formData.objective.topics.length > 0) {
			const valid = formData.objective.topics.filter((t) => t && t.trim());
			if (valid.length > 0) return valid;
		}
		if (formData.objective.category && formData.objective.category.trim()) {
			return [formData.objective.category.toLowerCase().trim()];
		}
		return ['general'];
	}

	/**
	 * Build voice sample with fallback chain
	 * Prefer AI-extracted voiceSample, fall back to rawInput, then description
	 */
	function buildVoiceSample(): string {
		return (
			formData.objective.voiceSample ||
			formData.objective.rawInput ||
			formData.objective.description ||
			''
		);
	}

	/**
	 * Build raw input with fallback to description
	 */
	function buildRawInput(): string {
		return formData.objective.rawInput || formData.objective.description || '';
	}

	// US state abbreviations for geographic inference
	const US_STATES: Record<string, string> = {
		AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
		CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
		HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
		KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
		MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
		MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
		NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
		ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
		RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
		TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
		WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia'
	};

	/**
	 * Infer geographic scope from decision makers' organizations.
	 * Heuristic-based — doesn't need to be perfect; Exa queries still work with approximate scope.
	 */
	function inferGeographicScope(
		dms: { name: string; title: string; organization: string }[]
	): { type: 'international' | 'nationwide' | 'subnational'; country?: string; subdivision?: string; locality?: string } {
		if (!dms || dms.length === 0) return { type: 'nationwide', country: 'US' };

		const orgs = dms.map((dm) => dm.organization || '');

		// Try to extract state abbreviations from org strings (e.g. "CA State Legislature")
		function extractState(org: string): string | null {
			// Match 2-letter state code at word boundary
			const match = org.match(/\b([A-Z]{2})\b/);
			if (match && US_STATES[match[1]]) return match[1];
			// Match full state names
			for (const [abbr, name] of Object.entries(US_STATES)) {
				if (org.toLowerCase().includes(name.toLowerCase())) return abbr;
			}
			return null;
		}

		// Try to extract city/locality from org strings (e.g. "San Francisco Board of Supervisors")
		// Common patterns: "City of X", "X City Council", "X Board of Supervisors", "X County"
		function extractLocality(org: string): string | null {
			const patterns = [
				/City of ([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/,
				/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(?:City Council|Board of Supervisors|Town Council|Village Board|Borough Council)/,
				/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+County/
			];
			for (const pat of patterns) {
				const m = org.match(pat);
				if (m) return m[1];
			}
			return null;
		}

		const states = orgs.map(extractState);
		const localities = orgs.map(extractLocality);

		// Check if all share a locality
		const nonNullLocalities = localities.filter((l): l is string => l !== null);
		if (nonNullLocalities.length === dms.length) {
			const unique = [...new Set(nonNullLocalities)];
			if (unique.length === 1) {
				const state = states.find((s): s is string => s !== null);
				return {
					type: 'subnational',
					country: 'US',
					subdivision: state || undefined,
					locality: unique[0]
				};
			}
		}

		// Check if all share a state
		const nonNullStates = states.filter((s): s is string => s !== null);
		if (nonNullStates.length === dms.length) {
			const unique = [...new Set(nonNullStates)];
			if (unique.length === 1) {
				return { type: 'subnational', country: 'US', subdivision: unique[0] };
			}
		}

		// Check for US-level indicators (Congress, Senate, federal agencies)
		const federalPatterns = /\b(U\.?S\.?|United States|Congress|Senate|House of Representatives|Federal)\b/i;
		const allUS = orgs.every(
			(org) => federalPatterns.test(org) || nonNullStates.length > 0
		);
		if (allUS) return { type: 'nationwide', country: 'US' };

		// Default: if we can't determine, assume nationwide US
		return { type: 'nationwide', country: 'US' };
	}

	async function generateMessage() {
		// Prevent concurrent generation
		if (isGenerating) return;
		isGenerating = true;

		try {
			stage = 'generating';
			errorMessage = null;
			thoughts = [];
			console.log('[MessageGenerationResolver] Starting streaming generation...');

			// Validate we have required data (with fallback for core_message)
			const subjectLine = formData.objective.title;
			const coreMessage =
				formData.objective.description || formData.objective.rawInput || formData.objective.title;

			if (!subjectLine) {
				throw new Error('Missing subject line');
			}

			if (!formData.audience.decisionMakers || formData.audience.decisionMakers.length === 0) {
				throw new Error('No decision-makers selected');
			}

			// Build with fallback chains
			const topics = buildTopics();
			const voiceSample = buildVoiceSample();
			const rawInput = buildRawInput();

			// Use streaming endpoint
			const response = await fetch('/api/agents/stream-message', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include', // Ensure session cookie is sent after OAuth return
				body: JSON.stringify({
					subject_line: subjectLine,
					core_message: coreMessage,
					topics,
					decision_makers: formData.audience.decisionMakers.map((dm) => ({
						name: dm.name,
						title: dm.title,
						organization: dm.organization
					})),
					voice_sample: voiceSample,
					raw_input: rawInput,
					geographic_scope: inferGeographicScope(formData.audience.decisionMakers)
				})
			});

			// Check for auth / rate-limit errors
			if (response.status === 429 || response.status === 401) {
				const errorData = await response.json().catch(() => ({}));

				// Guest with zero quota or 401 → auth gate
				if (response.status === 401 || errorData.tier === 'guest') {
					throw { _kind: 'auth-required' };
				}

				// Authenticated/verified user who exhausted quota → rate-limited
				throw { _kind: 'rate-limited', resetAt: errorData.resetAt, message: errorData.error };
			}

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error || 'Failed to generate message');
			}

			// Process SSE stream
			for await (const event of parseSSEStream<Record<string, unknown>>(response)) {
				switch (event.type) {
					case 'thought':
						if (typeof event.data.content === 'string') {
							thoughts = [...thoughts, event.data.content];
						}
						break;

					case 'complete': {
						const result = event.data as {
							message?: string;
							sources?: unknown[];
							research_log?: string[];
							geographic_scope?: unknown;
						};

						// Clean HTML formatting from message
						const cleanedMessage = cleanHtmlFormatting(result.message || '');

						// Store original for "start fresh"
						originalMessage = cleanedMessage;
						originalSubject = formData.objective.title;
						originalSources = [...((result.sources as Source[]) || [])];

						// Update formData — subject is already set by the subject-line agent
						formData.content.preview = cleanedMessage;
						formData.content.sources = (result.sources as typeof formData.content.sources) || [];
						formData.content.researchLog = result.research_log || [];
						formData.content.geographicScope =
							(result.geographic_scope as typeof formData.content.geographicScope) || null;
						formData.content.aiGenerated = true;
						formData.content.edited = false;
						formData.content.generatedForSubject = formData.objective.title;

						console.log('[MessageGenerationResolver] Message generated:', {
							message_length: cleanedMessage.length,
							sources_count: formData.content.sources?.length || 0
						});

						stage = 'results';
						break;
					}

					case 'error':
						throw new Error(
							typeof event.data.message === 'string' ? event.data.message : 'Generation failed'
						);
				}
			}
		} catch (err: any) {
			console.error('[MessageGenerationResolver] Error:', err);

			if (err?._kind === 'auth-required' || isAuthRequiredError(err)) {
				console.log('[MessageGenerationResolver] Auth required, showing overlay');
				stage = 'auth-required';
			} else if (err?._kind === 'rate-limited') {
				rateLimitResetAt = err.resetAt ?? null;
				rateLimitMessage = err.message ?? null;
				stage = 'rate-limited';
			} else {
				errorMessage =
					err instanceof Error ? err.message : 'Failed to generate message. Please try again.';
				stage = 'error';
			}
		} finally {
			isGenerating = false;
		}
	}

	// Auto-run on mount
	onMount(() => {
		// Check if the objective changed since content was generated
		const generatedFor = formData.content.generatedForSubject;
		const currentSubject = formData.objective.title;
		const isStale = generatedFor && generatedFor !== currentSubject;

		if (isStale) {
			console.log('[MessageGenerationResolver] Subject changed, clearing stale content', {
				generatedFor, currentSubject
			});
			formData.content.preview = '';
			formData.content.aiGenerated = false;
			formData.content.generatedForSubject = undefined;
			generateMessage();
		} else if (!formData.content.preview || !formData.content.aiGenerated) {
			generateMessage();
		} else {
			// Already have a message for the current subject, go straight to results
			originalMessage = formData.content.preview;
			originalSubject = formData.objective.title;
			originalSources = [...(formData.content.sources || [])];
			stage = 'results';
		}
	});

	function handleEdit() {
		stage = 'editing';
		// Mark as edited
		formData.content.edited = true;
	}

	function handleStartFresh() {
		// Reset to original AI-generated message + sources
		formData.content.preview = originalMessage;
		formData.objective.title = originalSubject;
		formData.content.sources = [...originalSources];
		formData.content.edited = false;
		stage = 'results';
	}

	function handleSaveEdit() {
		// User finished editing, back to results
		stage = 'results';
	}

	function handleInsertAtCursor(text: string) {
		if (!editTextarea) return;
		const start = editTextarea.selectionStart ?? formData.content.preview.length;
		const end = editTextarea.selectionEnd ?? start;
		const before = formData.content.preview.slice(0, start);
		const after = formData.content.preview.slice(end);
		formData.content.preview = before + text + after;
		tick().then(() => {
			if (editTextarea) {
				editTextarea.selectionStart = editTextarea.selectionEnd = start + text.length;
				editTextarea.focus();
			}
		});
	}

	function handleNext() {
		// Ensure content is set
		if (!formData.content.preview.trim()) {
			errorMessage = 'Message content is required';
			stage = 'error';
			return;
		}

		onnext();
	}
</script>

<div class="mx-auto max-w-3xl">
	{#if stage === 'generating'}
		<!-- Thought-centered loading: the agent's reasoning IS the experience -->
		<AgentThinking {thoughts} isActive={stage === 'generating'} context="Writing your message" />
	{:else if stage === 'results'}
		<!-- Results display with citations, sources, and research log -->
		<MessageResults
			bind:geographicScope={formData.content.geographicScope}
			message={formData.content.preview}
			subject={formData.objective.title}
			sources={formData.content.sources || []}
			researchLog={formData.content.researchLog || []}
			onEdit={handleEdit}
		/>

		<!-- Navigation with inline error display -->
		<div class="mt-8 border-t border-slate-200 pt-6">
			{#if publishError}
				<!-- Inline error: appears at locus of action, not displaced to header/toast -->
				<div
					class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
					role="alert"
				>
					<div class="flex items-start gap-3">
						<svg
							class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500"
							fill="currentColor"
							viewBox="0 0 20 20"
						>
							<path
								fill-rule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
								clip-rule="evenodd"
							/>
						</svg>
						<span>{publishError}</span>
					</div>
				</div>
			{/if}

			<div class="flex items-center justify-between">
				<button
					type="button"
					onclick={onback}
					disabled={isPublishing}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
				>
					← Back
				</button>

				<button
					type="button"
					onclick={handleNext}
					disabled={isPublishing}
					class="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-70
						{publishError
						? 'bg-red-600 hover:bg-red-700'
						: 'bg-participation-primary-600 hover:bg-participation-primary-700 hover:shadow'}"
				>
					{#if isPublishing}
						<div
							class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
						></div>
						Publishing...
					{:else if publishError}
						Try Again →
					{:else}
						Publish →
					{/if}
				</button>
			</div>
		</div>
	{:else if stage === 'editing'}
		<!-- Message editor -->
		<div class="space-y-4">
			<div>
				<h3 class="text-lg font-semibold text-slate-900">Edit your message</h3>
				<p class="mt-1 text-sm text-slate-600">
					{#if formData.content.sources && formData.content.sources.length > 0}
						Sources and citations stay linked as you edit
					{:else}
						Edit the message to match your voice. Add sources with [n] references.
					{/if}
				</p>
			</div>

			<!-- Subject line -->
			<div>
				<label for="edit-subject" class="block text-sm font-medium text-slate-700"> Subject </label>
				<input
					id="edit-subject"
					type="text"
					bind:value={formData.objective.title}
					class="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 focus:border-participation-primary-500 focus:ring-2 focus:ring-participation-primary-500"
				/>
			</div>

			<!-- Message body -->
			<div>
				<label for="edit-message" class="block text-sm font-medium text-slate-700"> Message </label>
				<textarea
					id="edit-message"
					bind:value={formData.content.preview}
					bind:this={editTextarea}
					rows={16}
					class="mt-1 w-full rounded-lg border border-slate-300 px-4 py-2 font-mono text-sm focus:border-participation-primary-500 focus:ring-2 focus:ring-participation-primary-500"
				></textarea>
				<p class="mt-1 text-xs text-slate-500">
					Type [1], [2], etc. to reference sources
				</p>
			</div>

			<!-- Source management -->
			<SourceEditor
				sources={formData.content.sources || []}
				message={formData.content.preview}
				onSourcesChange={(s) => { formData.content.sources = s; }}
				onMessageChange={(m) => { formData.content.preview = m; }}
				onInsertAtCursor={handleInsertAtCursor}
			/>

			<!-- Actions -->
			<div class="flex items-center justify-end gap-3">
				<button
					type="button"
					onclick={handleStartFresh}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
				>
					Reset to original
				</button>
				<button
					type="button"
					onclick={handleSaveEdit}
					class="inline-flex items-center gap-2 rounded-lg bg-participation-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-participation-primary-700"
				>
					Save changes
				</button>
			</div>
		</div>
	{:else if stage === 'error'}
		<!-- Error state -->
		<div class="space-y-4 py-8">
			<div class="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
				<p class="text-lg font-semibold text-red-900">Something went wrong</p>
				<p class="mt-2 text-sm text-red-700">{errorMessage}</p>
			</div>

			<div class="flex items-center justify-center gap-4">
				<button
					type="button"
					onclick={generateMessage}
					class="inline-flex items-center gap-2 rounded-lg bg-participation-primary-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-participation-primary-700"
				>
					Try again
				</button>

				<button
					type="button"
					onclick={onback}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
				>
					Go back
				</button>
			</div>
		</div>
	{:else if stage === 'rate-limited'}
		<!-- Rate limit reached — friendly, non-blocking -->
		<div class="space-y-6 py-8">
			<div class="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
				<p class="text-base font-semibold text-amber-900">
					Generation limit reached
				</p>
				<p class="mt-2 text-sm text-amber-700">
					{rateLimitMessage || 'You\'ve used your available message generations for now.'}
				</p>
				{#if rateLimitResetAt}
					<p class="mt-2 text-xs text-amber-600">
						Resets at {new Date(rateLimitResetAt).toLocaleTimeString()}
					</p>
				{/if}
			</div>

			<div class="flex items-center justify-center gap-4">
				<button
					type="button"
					onclick={onback}
					class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
				>
					Go back
				</button>
			</div>
		</div>
	{:else if stage === 'auth-required'}
		<!-- Auth required - progressive commitment overlay -->
		<div class="relative min-h-[400px]">
			<AuthGateOverlay
				title="Unlock Message Generation"
				description="Free account required to craft your message"
				icon={FileText}
				hints={[]}
				progress={buildAuthProgressItems()}
				onback={onback}
				{draftId}
				{onSaveDraft}
			/>
		</div>
	{/if}
</div>
