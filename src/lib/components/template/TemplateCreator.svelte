<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { Building2, Users, Mail, Megaphone, ArrowRight, ArrowLeft, X } from '@lucide/svelte';
	import type { TemplateCreationContext, TemplateFormData, Template } from '$lib/types/template';
	import { templateDraftStore, generateDraftId, formatTimeAgo } from '$lib/stores/templateDraft';
	import { appendReferences } from '$lib/utils/message-processing';
	import { extractRecipientEmails } from '$lib/utils/decision-maker-processing';
	import UnifiedObjectiveEntry from './creator/UnifiedObjectiveEntry.svelte';
	import DecisionMakerResolver from './creator/DecisionMakerResolver.svelte';
	import MessageGenerationResolver from './creator/MessageGenerationResolver.svelte';

	let {
		context,
		isSubmitting = false,
		validationErrors = {},
		initialText = '',
		initialDraftId = '',
		onSaveError = $bindable<string | null>(null),
		onclose,
		onsave
	}: {
		context: TemplateCreationContext;
		isSubmitting?: boolean;
		validationErrors?: Record<string, string>;
		initialText?: string;
		/** Pre-load a specific draft by ID (skips recovery modal) */
		initialDraftId?: string;
		/** Bindable: parent sets this when save fails (for inline error display) */
		onSaveError?: string | null;
		onclose?: () => void;
		onsave?: (data: Omit<Template, 'id'>) => void;
	} = $props();

	// Snapshot props at init time — these are one-shot values that don't change after mount.
	// untrack() prevents Svelte from warning about stale reactive captures.
	const _initialDraftId = untrack(() => initialDraftId);
	const _initialText = untrack(() => initialText);

	// --- Synchronous draft restoration ---
	// MUST happen before child components render, because child onMount runs
	// before parent onMount in Svelte. If we deferred to onMount, UnifiedObjectiveEntry
	// would fire API calls before we could provide the restored suggestion.
	// localStorage is synchronous, so this is safe at init time.
	const _loadedDraft = _initialDraftId ? templateDraftStore.getDraft(_initialDraftId) : null;

	let currentStep: 'objective' | 'audience' | 'content' = $state(
		_loadedDraft ? (_loadedDraft.currentStep as 'objective' | 'audience' | 'content') : 'objective'
	);
	let formErrors: string[] = $state([]);
	let draftId = $state<string>(_loadedDraft ? _initialDraftId : generateDraftId());
	let lastSaved = $state<number | null>(_loadedDraft ? _loadedDraft.lastSaved : null);
	let showDraftRecovery = $state(false);
	let isTransitioning = $state(false);

	// Publish flow states (for inline error display at point of action)
	let publishError = $state<string | null>(null);
	let localPublishing = $state(false);
	let isPublishing = $derived(isSubmitting || localPublishing);

	// Draft cleanup mode: 'save' = preserve on close, 'delete' = clean up (save succeeded)
	let draftCleanupMode: 'save' | 'delete' = 'save';

	// Sync parent's save error to inline display
	$effect(() => {
		if (onSaveError) {
			publishError = onSaveError;
		}
	});

	// Reset local guard once parent finishes (success or failure)
	$effect(() => {
		if (!isSubmitting && localPublishing) {
			localPublishing = false;
		}
	});

	// If save fails, ensure draft is preserved on future close
	$effect(() => {
		if (onSaveError && draftCleanupMode === 'delete') {
			draftCleanupMode = 'save';
		}
	});

	// Pending AI suggestion from UnifiedObjectiveEntry (persisted in draft on close)
	let pendingSuggestion = $state<{
		subject_line: string;
		core_message: string;
		topics: string[];
		domain: string;
		url_slug: string;
		voice_sample: string;
	} | null>(null);

	// Suggestion restored from draft (passed to UnifiedObjectiveEntry to show panel immediately)
	// Set synchronously so it's available at child's first render + onMount
	// Cleared when user accepts a suggestion to prevent stale state on navigation
	let restoredSuggestion = $state<typeof pendingSuggestion>(
		_loadedDraft?.pendingSuggestion ?? null
	);

	// Clear restoredSuggestion once user accepts (aiGenerated becomes true)
	// This prevents stale pending suggestion from overriding accepted state on back-navigation
	$effect(() => {
		if (formData.objective.aiGenerated && restoredSuggestion) {
			restoredSuggestion = null;
		}
	});

	// Template link readiness from SlugCustomizer (via UnifiedObjectiveEntry)
	let slugReady = $state<boolean | null>(null);

	// Auto-save cleanup function
	let cleanupAutoSave: (() => void) | null = null;

	// Debounced save timer for immediate feedback
	let debounceSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let isSaving = $state(false);
	const DEBOUNCE_SAVE_DELAY = 2000;

	// When resuming a draft, backfill rawInput from initialText if the draft's rawInput is empty.
	// This covers the case where rawInput was cleared (e.g. "Start fresh") but the homepage
	// still shows the draft title — the user sees text, clicks continue, and expects it in the modal.
	function _backfillDraftData(draft: typeof _loadedDraft): TemplateFormData {
		const data = draft!.data;
		if (!data.objective.rawInput?.trim() && _initialText.trim()) {
			data.objective.rawInput = _initialText;
		}
		return data;
	}

	let formData: TemplateFormData = $state(
		_loadedDraft
			? _backfillDraftData(_loadedDraft)
			: {
					objective: {
						rawInput: _initialText,
						title: '',
						description: '',
						domain: '',
						slug: '',
						topics: [],
						voiceSample: '',
						aiGenerated: false
					},
					audience: {
						decisionMakers: [],
						recipientEmails: [],
						includesCongress: false,
						customRecipients: []
					},
					content: {
						preview: '',
						variables: [],
						sources: [],
						researchLog: [],
						geographicScope: null,
						aiGenerated: false,
						edited: false
					},
					review: {}
				}
	);

	// State machine checkpoint: the subject line that downstream steps were built for.
	// When the subject changes and the user advances, downstream state is invalidated.
	let downstreamSubjectCheckpoint = $state<string | undefined>(
		_loadedDraft ? formData.objective.title : undefined
	);

	// Derived: has content worth saving (for ambient indicator)
	const hasContent = $derived(
		formData.objective.rawInput?.trim() ||
			formData.objective.title?.trim() ||
			formData.content.preview?.trim()
	);

	// Validation functions for each step
	const validators = {
		objective: (data: TemplateFormData['objective']) => {
			const errors: string[] = [];
			if (!data.title.trim()) errors.push('Title is required');
			if (!data.description?.trim()) errors.push('Core message is required');
			if (!data.slug?.trim()) errors.push('Template link is required');
			else if (slugReady === false) errors.push('Template link is unavailable — choose a different link');
			// slugReady === null (still checking) is allowed — server validates uniqueness at save time
			return errors;
		},
		audience: (data: TemplateFormData['audience']) => {
			const errors: string[] = [];
			// Check source data, not derived recipientEmails
			// This matches the DecisionMakerResolver's Next button disabled logic
			const hasRecipients =
				(data.decisionMakers?.length || 0) > 0 ||
				(data.customRecipients?.length || 0) > 0 ||
				data.includesCongress;

			if (!hasRecipients) {
				errors.push('At least one recipient is required');
			}
			return errors;
		},
		content: (data: TemplateFormData['content']) => {
			const errors = [];
			if (!data.preview.trim()) errors.push('Message content is required');
			// Note: We removed variable requirements to give writers more agency
			// Templates work great with or without personalization variables
			return errors;
		}
	};

	const isCurrentStepValid = $derived.by(() => {
		if (currentStep === 'objective') {
			const currentErrors = validators.objective(formData.objective);
			return currentErrors.length === 0;
		} else if (currentStep === 'audience') {
			const currentErrors = validators.audience(formData.audience);
			return currentErrors.length === 0;
		} else if (currentStep === 'content') {
			const currentErrors = validators.content(formData.content);
			return currentErrors.length === 0;
		}
		return true;
	});

	function validateCurrentStep(): boolean {
		if (currentStep === 'objective') {
			formErrors = validators.objective(formData.objective);
		} else if (currentStep === 'audience') {
			formErrors = validators.audience(formData.audience);
		} else if (currentStep === 'content') {
			formErrors = validators.content(formData.content);
		}
		return formErrors.length === 0;
	}

	function handleNext() {
		if (!validateCurrentStep()) return;
		if (isTransitioning) return;

		const steps: ('objective' | 'audience' | 'content')[] = ['objective', 'audience', 'content'];
		const currentIndex = steps.indexOf(currentStep);

		if (currentIndex < steps.length - 1) {
			// State machine invalidation: when subject changed, clear downstream state.
			// This is the authoritative check — children re-resolve on mount when empty.
			if (currentStep === 'objective') {
				const currentTitle = formData.objective.title;
				if (downstreamSubjectCheckpoint && downstreamSubjectCheckpoint !== currentTitle) {
					formData.audience.decisionMakers = [];
					formData.audience.resolvedForSubject = undefined;
					formData.content.preview = '';
					formData.content.aiGenerated = false;
					formData.content.generatedForSubject = undefined;
				}
				downstreamSubjectCheckpoint = currentTitle;
			}

			// Show immediate feedback - button enters loading state
			isTransitioning = true;

			// Small delay to ensure loading state is visible before view transition
			// This maintains causality: click → feedback → transition
			setTimeout(() => {
				currentStep = steps[currentIndex + 1];
				formErrors = []; // Clear errors when moving to next step
				isTransitioning = false;
			}, 150);
		}
	}

	function handleBack() {
		const steps: ('objective' | 'audience' | 'content')[] = ['objective', 'audience', 'content'];
		const currentIndex = steps.indexOf(currentStep);

		if (currentIndex > 0) {
			currentStep = steps[currentIndex - 1];
			formErrors = []; // Clear errors when moving back
		}
	}

	function handleSave() {
		if (isPublishing) return; // Guard against double-submit
		// Clear previous errors (fresh attempt)
		publishError = null;
		onSaveError = null;
		localPublishing = true;

		if (!validateCurrentStep()) {
			localPublishing = false;
			return;
		}

		// Re-extract recipient emails from source data (handles stale draft restoration)
		// This ensures emails are current even if draft had missing/stale recipientEmails
		formData.audience.recipientEmails = extractRecipientEmails(
			formData.audience.decisionMakers,
			formData.audience.customRecipients,
			formData.audience.includesCongress
		);

		// Validation errors display inline at the publish button (perceptual: feedback at action locus)
		if (!formData.objective.title?.trim()) {
			publishError = 'Template title is required';
			localPublishing = false;
			return;
		}
		if (!formData.content.preview?.trim()) {
			publishError = 'Message content is required';
			localPublishing = false;
			return;
		}
		if (!formData.audience.recipientEmails || formData.audience.recipientEmails.length === 0) {
			publishError = 'At least one recipient email is required';
			localPublishing = false;
			return;
		}

		// Append References section to message body (at bottom for trust without interrupting flow)
		const messageWithReferences =
			formData.content.sources && formData.content.sources.length > 0
				? appendReferences(formData.content.preview, formData.content.sources)
				: formData.content.preview;

		const template: Omit<Template, 'id'> = {
			slug: formData.objective.slug || '',
			title: formData.objective.title,
			description: formData.objective.description || formData.content.preview.substring(0, 160),
			domain: formData.objective.domain,
			topics: formData.objective.topics || [],
			type: context.channelId === 'certified' ? 'certified' : 'direct',
			deliveryMethod: context.channelId === 'certified'
				? 'certified'
				: formData.audience.includesCongress
					? 'cwc'
					: 'email',
			subject: formData.objective.title || `Regarding: ${formData.objective.title}`,
			message_body: messageWithReferences, // Message with References appended
			sources: formData.content.sources || [], // Persist sources for provenance
			research_log: formData.content.researchLog || [], // Persist research log for transparency
			delivery_config: {},
			cwc_config: {},
			recipient_config: {
				reach: formData.audience.includesCongress ? 'district-based' : 'location-specific',
				emails: formData.audience.recipientEmails,
				decisionMakers: formData.audience.decisionMakers,
				cwcRouting: formData.audience.includesCongress || undefined
			},
			campaign_id: null,
			status: 'published',
			is_public: true,
			send_count: 0,
			coordinationScale: 0,
			isNew: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			applicable_countries: [],
			jurisdiction_level: null,
			specific_locations: [],
			preview: formData.content.preview.substring(0, 500),
			recipientEmails: formData.audience.recipientEmails
		};

		// Attach full GeoScope object for TemplateScope creation.
		// Template type has geographic_scope as a string enum (display-level),
		// but the API expects the structured GeoScope object with country/subdivision.
		const payload = formData.content.geographicScope
			? { ...template, geographic_scope: formData.content.geographicScope }
			: template;

		// Optimistic: mark draft for deletion BEFORE dispatching to parent.
		// Parent may destroy us synchronously (showTemplateCreator=false happens before
		// isSubmitting=false in the finally block), so the $effect that was setting this
		// reactively never ran — onDestroy saw 'save' and re-saved the draft instead.
		// If the save fails, the error-recovery $effect (below) resets to 'save',
		// and the component stays alive on failure (parent only unmounts on success).
		draftCleanupMode = 'delete';

		onsave?.(payload as Omit<Template, 'id'>);
	}

	// Progress calculation
	const progress = $derived.by(() => {
		const steps = ['objective', 'audience', 'content'];
		return ((steps.indexOf(currentStep) + 1) / steps.length) * 100;
	});

	const stepInfo = {
		objective: {
			title: "What's Your Message?",
			icon: Megaphone,
			description: 'What do you want decision-makers to hear?'
		},
		audience: {
			title: 'Who Controls This?',
			icon: Users,
			description: 'Congress, CEO, school board—who makes the call?'
		},
		content: {
			title: 'Load Your Message',
			icon: Mail,
			description: 'What gets their attention and moves the needle?'
		}
	};

	// Auto-save setup (onMount needed for cleanup lifecycle)
	onMount(() => {
		// Hydrate encrypted DM emails from prior resolution (async, fast)
		if (_loadedDraft && formData.audience?.decisionMakers?.length > 0) {
			templateDraftStore.hydrateEmails(draftId, formData).catch(() => {
				// Decryption failed (different device, cleared keys) — emails stay empty
			});
		}

		// Draft was already loaded synchronously above for initialDraftId.
		// Only handle the recovery modal path here (no initialDraftId).
		if (!_loadedDraft && !initialDraftId) {
			const availableDrafts = templateDraftStore.getAllDraftIds();
			if (availableDrafts.length > 0) {
				const mostRecentDraftId = availableDrafts
					.map((id) => ({ id, age: templateDraftStore.getDraftAge(id) || Infinity }))
					.sort((a, b) => a.age - b.age)[0].id;

				const draft = templateDraftStore.getDraft(mostRecentDraftId);
				if (draft && draft.lastSaved > Date.now() - 24 * 60 * 60 * 1000) {
					showDraftRecovery = true;
					draftId = mostRecentDraftId;
				}
			}
		}

		// Start auto-save
		cleanupAutoSave = templateDraftStore.startAutoSave(
			draftId,
			() => formData,
			() => currentStep,
			() => pendingSuggestion
		);
	});

	onDestroy(() => {
		if (draftCleanupMode === 'delete') {
			// Save succeeded — clean up the draft instead of re-saving
			templateDraftStore.deleteDraft(draftId);
		} else {
			// Normal close or failed save — preserve user's work
			const hasContent =
				formData.objective.rawInput?.trim() ||
				formData.objective.title?.trim() ||
				formData.content.preview?.trim();

			if (hasContent) {
				templateDraftStore.saveDraft(draftId, formData, currentStep, pendingSuggestion);
			}
		}

		// Cleanup timers
		if (cleanupAutoSave) {
			cleanupAutoSave();
		}
		if (debounceSaveTimer) {
			clearTimeout(debounceSaveTimer);
		}
	});

	// Debounced save on content changes
	// Perceptual: Continuous persistence like Google Docs - work is always safe
	$effect(() => {
		// Track changes to meaningful content
		const rawInput = formData.objective.rawInput;
		const title = formData.objective.title;
		const preview = formData.content.preview;

		// Clear existing timer
		if (debounceSaveTimer) {
			clearTimeout(debounceSaveTimer);
		}

		// Check if there's content worth saving
		const contentExists = rawInput?.trim() || title?.trim() || preview?.trim();

		if (contentExists) {
			// Show saving indicator immediately on change
			isSaving = true;

			// Debounce: save 2 seconds after last change
			debounceSaveTimer = setTimeout(() => {
				templateDraftStore.saveDraft(draftId, formData, currentStep, pendingSuggestion);
				lastSaved = Date.now();
				isSaving = false;
			}, DEBOUNCE_SAVE_DELAY);
		}
	});

	// Functions for draft management
	function recoverDraft() {
		const draft = templateDraftStore.getDraft(draftId);
		if (draft) {
			formData = draft.data;
			currentStep = draft.currentStep as 'objective' | 'audience' | 'content';
			lastSaved = draft.lastSaved;
			// Hydrate encrypted DM emails
			if (formData.audience?.decisionMakers?.length > 0) {
				templateDraftStore.hydrateEmails(draftId, formData).catch(() => {});
			}
		}
		showDraftRecovery = false;
	}

	function discardDraft() {
		templateDraftStore.deleteDraft(draftId);
		showDraftRecovery = false;
		// Generate new draft ID for current session
		draftId = generateDraftId();

		// Restart auto-save with new ID
		if (cleanupAutoSave) {
			cleanupAutoSave();
		}
		cleanupAutoSave = templateDraftStore.startAutoSave(
			draftId,
			() => formData,
			() => currentStep
		);
	}

	function _manualSave() {
		templateDraftStore.saveDraft(draftId, formData, currentStep, pendingSuggestion);
		lastSaved = Date.now();
	}
</script>

<div class="flex h-full flex-col">
	<!-- Progress bar -->
	<div class="h-1 bg-slate-100">
		<div
			class="h-full bg-participation-primary-600 transition-all duration-300"
			style="width: {progress}%"
		></div>
	</div>

	<!-- Step Header -->
	<div class="border-b border-slate-200 px-4 py-3 md:px-6 md:py-4">
		<div class="flex flex-col gap-1 md:gap-1">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-1.5 md:gap-3">
					{#snippet iconSnippet()}
						{@const IconComponent = stepInfo[currentStep].icon}
						<IconComponent class="h-4 w-4 text-participation-primary-600 md:h-5 md:w-5" />
					{/snippet}
					{@render iconSnippet()}
					<h2 class="text-base font-semibold text-slate-900 md:text-xl">
						{stepInfo[currentStep].title}
					</h2>
				</div>

				<div class="flex items-center gap-2">
					<!-- Draft/Save indicator - Perceptual: Ambient awareness of work safety -->
					{#if isSaving}
						<!-- Saving state: user sees their changes are being captured -->
						<div
							class="inline-flex items-center gap-1 rounded-full border border-amber-200
							       bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600 md:px-2"
						>
							<div
								class="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
							></div>
							<span class="hidden sm:inline">saving...</span>
						</div>
					{:else if lastSaved}
						<!-- Saved state: work is safely persisted -->
						<div
							class="inline-flex items-center gap-1 rounded-full border border-emerald-200
							       bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-600 md:px-2"
						>
							<div
								class="h-1.5 w-1.5 rounded-full bg-emerald-500"
							></div>
							<span class="hidden sm:inline">saved {formatTimeAgo(lastSaved).toLowerCase()}</span>
							<span class="sm:hidden">saved</span>
						</div>
					{:else if hasContent}
						<!-- Has content but not yet saved: will save soon -->
						<div
							class="inline-flex items-center gap-1 rounded-full border border-slate-200
							       bg-slate-50 px-1.5 py-0.5 text-xs text-slate-500 md:px-2"
						>
							<div
								class="h-1.5 w-1.5 rounded-full bg-slate-400"
							></div>
							<span class="hidden sm:inline">draft</span>
						</div>
					{/if}

					<!-- Close button -->
					<button
						type="button"
						onclick={() => onclose?.()}
						class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
						aria-label="Close"
					>
						<X class="h-5 w-5" />
					</button>
				</div>
			</div>
			<p class="ml-6 text-sm text-slate-600 md:ml-8 md:text-sm">
				{stepInfo[currentStep].description}
			</p>
		</div>
	</div>

	<!-- Error display -->
	{#if formErrors.length > 0 || Object.keys(validationErrors).length > 0}
		<div class="border-b border-red-200 bg-red-50 px-6 py-3">
			<ul class="list-inside list-disc text-sm text-red-600">
				{#each formErrors as error}
					<li>{error}</li>
				{/each}
				{#each Object.entries(validationErrors) as [_field, message]}
					<li>{message}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Content -->
	<div class="relative flex-1">
		<div class="p-4 md:p-6" transition:fade={{ duration: 150 }}>
			{#if currentStep === 'objective'}
				<UnifiedObjectiveEntry bind:data={formData.objective} {context} onAccept={handleNext} bind:pendingSuggestion initialSuggestion={restoredSuggestion} bind:slugReady />
			{:else if currentStep === 'audience'}
				<DecisionMakerResolver
					bind:formData
					onnext={handleNext}
					onback={handleBack}
					{draftId}
					onSaveDraft={() => templateDraftStore.saveDraft(draftId, formData, currentStep)}
				/>
			{:else if currentStep === 'content'}
				<MessageGenerationResolver
					bind:formData
					onnext={handleSave}
					onback={handleBack}
					{draftId}
					onSaveDraft={() => templateDraftStore.saveDraft(draftId, formData, currentStep)}
					{publishError}
					{isPublishing}
				/>
			{/if}
		</div>
	</div>

	<!-- Navigation (hidden for audience and content steps - they handle their own nav) -->
	{#if currentStep !== 'audience' && currentStep !== 'content'}
		<div class="border-t border-slate-200 bg-slate-50 px-4 py-3 md:px-6 md:py-4">
			<div class="flex items-center justify-between">
				<button
					class="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50 md:gap-2 md:px-4 md:py-2 md:text-base"
					onclick={handleBack}
					disabled={currentStep === 'objective' || isSubmitting}
				>
					<ArrowLeft class="h-4 w-4 md:h-4 md:w-4" />
					Back
				</button>

				<button
					class="flex items-center gap-1.5 rounded bg-participation-primary-600 px-3 py-2 text-sm text-white hover:bg-participation-primary-700 disabled:opacity-50 md:gap-2 md:px-4 md:py-2 md:text-base"
					onclick={handleNext}
					disabled={!isCurrentStepValid || isSubmitting || isTransitioning}
				>
					{#if isTransitioning}
						<div
							class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
						></div>
						Finding decision-makers...
					{:else if currentStep === 'objective'}
						Pick Decision-Makers
						<ArrowRight class="h-4 w-4 md:h-4 md:w-4" />
					{:else}
						Continue
						<ArrowRight class="h-4 w-4 md:h-4 md:w-4" />
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>

<!-- Draft Recovery Modal -->
{#if showDraftRecovery}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div class="mx-4 w-full max-w-md rounded-lg bg-white shadow-xl">
			<div class="p-6">
				<h3 class="mb-2 text-lg font-semibold text-slate-900">Recover Previous Draft?</h3>
				<p class="mb-4 text-sm text-slate-600">
					We found a draft that was auto-saved {templateDraftStore.getDraftAge(draftId)
						? formatTimeAgo(Date.now() - templateDraftStore.getDraftAge(draftId)!)
						: 'recently'}. Would you like to recover it?
				</p>
				<div class="flex justify-end gap-3">
					<button
						class="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
						onclick={discardDraft}
					>
						Start Fresh
					</button>
					<button
						class="rounded bg-participation-primary-600 px-4 py-2 text-sm text-white hover:bg-participation-primary-700"
						onclick={recoverDraft}
					>
						Recover Draft
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
