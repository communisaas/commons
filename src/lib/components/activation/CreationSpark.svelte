<script lang="ts">
	/**
	 * CreationSpark - Perceptual Engineering
	 *
	 * The visible entry point for template creation.
	 * NOT a button that opens a modal. A SURFACE that invites writing.
	 *
	 * Cognitive principle: Recognition > Recall
	 * Users see the writing surface, understand what "create" means,
	 * and can begin immediately without predicting modal contents.
	 *
	 * Draft continuation: Integrates directly into the surface.
	 * User's saved work pre-fills the textarea - they SEE their words
	 * and recognize their work. No separate "resume draft" UI needed.
	 *
	 * Low commitment: typing in a field is lower friction than clicking
	 * an abstract button. The spark captures initial intent, then
	 * transitions to the full wizard.
	 */

	import { onMount } from 'svelte';
	import { ArrowRight, Clock } from '@lucide/svelte';
	import { templateDraftStore, formatTimeAgo } from '$lib/stores/templateDraft';

	import type { Snippet } from 'svelte';

	// Props
	interface Props {
		context?: Snippet;
		onactivate?: (data: { initialText: string; draftId?: string }) => void;
	}

	let { context, onactivate }: Props = $props();

	let issueText = $state('');
	let isFocused = $state(false);
	let inputEl = $state<HTMLTextAreaElement | null>(null);

	// Draft state - integrated into the surface
	let activeDraftId = $state<string | null>(null);
	let draftLastSaved = $state<number | null>(null);
	let draftStep = $state<string | null>(null);

	// Store subscription trigger - increments when store updates
	let storeVersion = $state(0);

	// Subscribe to store changes for reactivity
	onMount(() => {
		const unsubscribe = templateDraftStore.subscribe(() => {
			storeVersion++;
		});
		return unsubscribe;
	});

	// Load draft reactively - re-runs when store updates
	$effect(() => {
		// Trigger on store version changes
		void storeVersion;

		const draftIds = templateDraftStore.getAllDraftIds();
		if (draftIds.length === 0) {
			// No drafts - clear state
			activeDraftId = null;
			draftLastSaved = null;
			draftStep = null;
			// Don't clear issueText - user might be typing
			return;
		}

		// Find most recent draft within 24 hours
		const cutoff = 24 * 60 * 60 * 1000;
		let mostRecentId: string | null = null;
		let mostRecentAge = Infinity;

		for (const id of draftIds) {
			const age = templateDraftStore.getDraftAge(id);
			if (age !== null && age < cutoff && age < mostRecentAge) {
				mostRecentAge = age;
				mostRecentId = id;
			}
		}

		if (mostRecentId) {
			const draft = templateDraftStore.getDraft(mostRecentId);
			if (draft) {
				// Pre-fill the surface with draft content
				// User sees their words → immediate recognition
				const rawInput = draft.data.objective?.rawInput || '';
				const title = draft.data.objective?.title || '';

				// Use rawInput if available, otherwise title
				if (rawInput.trim()) {
					issueText = rawInput;
					activeDraftId = mostRecentId;
					draftLastSaved = draft.lastSaved;
					draftStep = draft.currentStep;
				} else if (title.trim()) {
					issueText = title;
					activeDraftId = mostRecentId;
					draftLastSaved = draft.lastSaved;
					draftStep = draft.currentStep;
				} else {
					// Draft exists but no content - clear draft state
					activeDraftId = null;
					draftLastSaved = null;
					draftStep = null;
				}
			}
		} else {
			// No recent draft found
			activeDraftId = null;
			draftLastSaved = null;
			draftStep = null;
		}
	});

	// Derived: has user started writing?
	const hasContent = $derived(issueText.trim().length > 0);
	const isActivated = $derived(hasContent || isFocused);
	const hasDraft = $derived(activeDraftId !== null);

	// Check draft state for button text accuracy
	const draftHasSuggestion = $derived.by(() => {
		if (!activeDraftId) return false;
		const draft = templateDraftStore.getDraft(activeDraftId);
		if (!draft) return false;
		// Either a pending (not yet accepted) suggestion, or an accepted title
		return !!draft.pendingSuggestion || !!draft.data.objective?.title?.trim();
	});

	// Clear draft state when user clears the text
	$effect(() => {
		if (!issueText.trim() && activeDraftId) {
			// User cleared the surface - offer to discard draft
			// But don't auto-discard, let them start fresh
		}
	});

	function handleContinue() {
		onactivate?.({
			initialText: issueText.trim(),
			draftId: activeDraftId || undefined
		});
	}

	function handleStartFresh() {
		// Discard draft and clear surface
		if (activeDraftId) {
			templateDraftStore.deleteDraft(activeDraftId);
			activeDraftId = null;
			draftLastSaved = null;
			draftStep = null;
		}
		issueText = '';
		inputEl?.focus();
	}

	function handleKeydown(event: KeyboardEvent) {
		// Cmd/Ctrl + Enter to continue
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && hasContent) {
			event.preventDefault();
			handleContinue();
		}
	}
</script>

<div class="creation-spark" class:activated={isActivated} class:has-content={hasContent}>
	<!-- Brand + Headline integrated into creation surface -->
	<div class="spark-header">
		<p class="brand-mark">commons</p>
		<h1 class="headline">
			Write once.
			<span class="accent">Send together.</span>
		</h1>
		<p class="subhead">Write it once. Share the link. Everyone can send it.</p>
	</div>

	<!-- The writing surface - immediately visible -->
	<div class="spark-surface">
		<div class="spark-prompt-row">
			<label for="issue-input" class="spark-prompt"> What needs to change? </label>

			<!-- Draft indicator - subtle, peripheral awareness -->
			{#if hasDraft && draftLastSaved}
				<div class="draft-indicator">
					<Clock class="draft-icon" />
					<span class="draft-text">saved {formatTimeAgo(draftLastSaved).toLowerCase()}</span>
				</div>
			{/if}
		</div>

		{#if hasDraft}
			<!-- SETTLED STATE: Draft displayed as read-only artifact -->
			<div class="draft-artifact" role="region" aria-label="Your saved draft">
				<!-- Content as quotation -->
				<div class="draft-content">
					<blockquote class="draft-quote">"{issueText}"</blockquote>
				</div>

				<!-- Footer: Start fresh only -->
				<div class="draft-footer">
					<span class="draft-hint">Continue where you left off, or</span>
					<button type="button" class="start-fresh-link" onclick={handleStartFresh}>
						start fresh
					</button>
				</div>
			</div>
		{:else}
			<!-- ACTIVE STATE: Editable textarea -->
			<div class="input-container" class:focused={isFocused}>
				<textarea
					bind:this={inputEl}
					bind:value={issueText}
					id="issue-input"
					class="spark-input"
					placeholder="The rent keeps going up but wages don't..."
					rows="3"
					onfocus={() => (isFocused = true)}
					onblur={() => (isFocused = false)}
					onkeydown={handleKeydown}
				></textarea>

				<!-- Subtle helper text -->
				<div class="input-footer">
					{#if hasContent}
						<span class="char-count">{issueText.length} characters</span>
					{:else}
						<span class="hint">Describe the problem you want to solve</span>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Continue action - appears when content exists or focused -->
		<div class="spark-actions" class:visible={isActivated}>
			<button
				type="button"
				class="continue-btn"
				class:ready={hasContent}
				class:is-draft={hasDraft}
				onclick={handleContinue}
				disabled={!hasContent}
			>
				<span class="btn-text">
					{#if !hasContent}
						Start typing above
					{:else if hasDraft && draftStep === 'content'}
						Continue to message
					{:else if hasDraft && draftStep === 'audience'}
						Continue to decision-makers
					{:else if hasDraft && draftHasSuggestion}
						Review subject line
					{:else if hasDraft}
						Continue draft
					{:else}
						Pick decision-makers
					{/if}
				</span>
				<ArrowRight class="btn-icon" />
			</button>

			{#if hasContent}
				<p class="action-hint">
					Press <kbd>⌘</kbd><kbd>Enter</kbd> to continue
				</p>
			{/if}

		</div>
	</div>

	<!-- Or browse existing -->
	<div class="spark-divider">
		<span class="divider-line"></span>
		<span class="divider-text"><span class="divider-text--mobile">or scroll to join an existing campaign</span><span class="divider-text--desktop">or join an existing campaign</span></span>
		<span class="divider-line"></span>
	</div>

	<!-- Render additional context (explainer, footer, etc) -->
	{#if context}
		{@render context()}
	{/if}
</div>

<style>
	/*
	 * CreationSpark - Perceptual Engineering Styles
	 *
	 * Visual hierarchy:
	 * 1. Headline establishes context (200ms)
	 * 2. Writing surface draws focus (immediate affordance)
	 * 3. Continue action reveals on engagement
	 *
	 * Color: Uses participation-primary (cyan) for activation states
	 * Typography: Satoshi for brand voice
	 */

	.creation-spark {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/*
	 * Desktop: Positioning context for absolutely positioned footer
	 * Also allows overflow for expanded RelayLoom nodes if explainer is slotted
	 */
	@media (min-width: 1280px) {
		.creation-spark {
			position: relative;
			overflow: visible;
			min-height: calc(100vh - 5rem); /* Full viewport minus top padding */
		}
	}

	/* Header - Brand + Headline */
	.spark-header {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.brand-mark {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		text-transform: lowercase;
		color: oklch(0.42 0.08 55); /* Warm amber-brown */
		margin: 0;
	}

	.headline {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.5rem, 4vw + 0.5rem, 2.25rem);
		font-weight: 700;
		line-height: 1.15;
		letter-spacing: -0.02em;
		color: oklch(0.15 0.02 250);
		margin: 0;
	}

	/*
	 * Container-aware type: when .creation-column has container-type: inline-size,
	 * cqi units size relative to the column (340-480px), not the viewport.
	 * 6.5cqi at 420px = 27px — proportionate to the narrow column.
	 */
	@container creation (min-width: 0px) {
		.headline {
			font-size: clamp(1.5rem, 6.5cqi, 2rem);
		}
	}

	.headline .accent {
		display: block;
		color: oklch(0.55 0.15 195); /* Cyan - participation color */
	}

	.subhead {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(0.875rem, 2.5vw + 0.25rem, 1.0625rem);
		font-weight: 500;
		line-height: 1.5;
		color: oklch(0.42 0.04 250);
		margin: 0.25rem 0 0 0;
	}

	@container creation (min-width: 0px) {
		.subhead {
			font-size: clamp(0.8125rem, 3.5cqi, 0.9375rem);
		}
	}

	/* Writing Surface */
	.spark-surface {
		display: flex;
		flex-direction: column;
		padding-top: 1rem;
		gap: 0.75rem;
	}

	.spark-prompt-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.spark-prompt {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		color: oklch(0.35 0.02 250);
		margin: 0;
	}

	/* Draft indicator - subtle peripheral awareness */
	.draft-indicator {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.625rem;
		background: oklch(0.96 0.02 155);
		border: 1px solid oklch(0.88 0.04 155);
		border-radius: 100px;
		animation: draftPulse 2s ease-in-out;
	}

	@keyframes draftPulse {
		0% { opacity: 0; transform: translateX(4px); }
		100% { opacity: 1; transform: translateX(0); }
	}

	.draft-indicator :global(.draft-icon) {
		width: 0.75rem;
		height: 0.75rem;
		color: oklch(0.5 0.1 155);
	}

	.draft-text {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 500;
		color: oklch(0.4 0.06 155);
	}

	.input-container {
		position: relative;
		border-radius: 12px;
		border: 2px solid oklch(0.85 0.02 250);
		background: oklch(0.99 0.005 250);
		transition:
			border-color 200ms ease-out,
			box-shadow 200ms ease-out,
			background 200ms ease-out;
	}

	.input-container.focused {
		border-color: oklch(0.65 0.12 195);
		box-shadow:
			0 0 0 3px oklch(0.7 0.1 195 / 0.15),
			0 4px 12px -2px oklch(0.5 0.1 195 / 0.1);
		background: white;
	}

	/* Draft Artifact - Settled state presentation */
	.draft-artifact {
		border-radius: 12px;
		border: 2px solid oklch(0.75 0.08 155);
		background: oklch(0.995 0.005 155);
		overflow: hidden;
	}

	.draft-content {
		padding: 1rem;
	}

	.draft-quote {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1rem;
		line-height: 1.5;
		color: oklch(0.3 0.02 250);
		border-left: 3px solid oklch(0.7 0.08 155);
		padding-left: 0.75rem;
	}

	.draft-footer {
		padding: 0.5rem 1rem;
		border-top: 1px solid oklch(0.88 0.04 155);
		background: oklch(0.98 0.005 155);
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 0.375rem;
	}

	.draft-hint {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.5 0.02 250);
	}

	.spark-input {
		width: 100%;
		padding: 1rem;
		border: none;
		border-radius: 10px;
		background: transparent;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1rem;
		line-height: 1.5;
		color: oklch(0.2 0.02 250);
		resize: none;
		outline: none;
	}

	.spark-input::placeholder {
		color: oklch(0.6 0.02 250);
		font-style: italic;
	}

	.input-footer {
		padding: 0.5rem 1rem;
		border-top: 1px solid oklch(0.92 0.01 250);
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.char-count {
		font-size: 0.75rem;
		color: oklch(0.5 0.02 250);
		font-variant-numeric: tabular-nums;
	}

	.hint {
		font-size: 0.75rem;
		color: oklch(0.55 0.02 250);
		font-style: italic;
	}

	.start-fresh-link {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 500;
		color: oklch(0.5 0.04 250);
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
		text-decoration-color: oklch(0.7 0.02 250);
		text-underline-offset: 2px;
		transition: color 150ms ease-out;
	}

	.start-fresh-link:hover {
		color: oklch(0.35 0.04 250);
		text-decoration-color: oklch(0.5 0.02 250);
	}

	/* Actions - collapse height when hidden to avoid negative space */
	.spark-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		opacity: 0;
		max-height: 0;
		overflow: hidden;
		transform: translateY(-8px);
		transition:
			opacity 200ms ease-out,
			transform 200ms ease-out,
			max-height 200ms ease-out;
		pointer-events: none;
	}

	.spark-actions.visible {
		opacity: 1;
		max-height: 120px; /* Enough for button + hint */
		transform: translateY(0);
		pointer-events: auto;
	}

	.continue-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.875rem 1.5rem;
		border: none;
		border-radius: 10px;
		background: oklch(0.85 0.02 250);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 600;
		color: oklch(0.5 0.02 250);
		cursor: not-allowed;
		transition:
			background 200ms ease-out,
			color 200ms ease-out,
			transform 150ms ease-out,
			box-shadow 200ms ease-out;
	}

	.continue-btn.ready {
		background: linear-gradient(135deg, oklch(0.55 0.15 195), oklch(0.48 0.17 195));
		color: white;
		cursor: pointer;
	}

	/* Draft continuation - emerald accent for preserved work */
	.continue-btn.ready.is-draft {
		background: linear-gradient(135deg, oklch(0.52 0.12 155), oklch(0.45 0.14 155));
	}

	.continue-btn.ready:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px -2px oklch(0.5 0.15 195 / 0.35);
	}

	.continue-btn.ready.is-draft:hover {
		box-shadow: 0 4px 12px -2px oklch(0.45 0.12 155 / 0.35);
	}

	.continue-btn.ready:active {
		transform: translateY(0);
	}

	.continue-btn:disabled {
		cursor: not-allowed;
	}

	/* Icon styles - use :global() to reach inside Lucide component */
	.continue-btn :global(.btn-icon) {
		width: 1rem;
		height: 1rem;
		transition: transform 150ms ease-out;
	}

	.continue-btn.ready:hover :global(.btn-icon) {
		transform: translateX(2px);
	}

	/* Keyboard hint — desktop-only affordance.
	 * On touch devices ⌘Enter doesn't exist; showing it is cognitive noise. */
	.action-hint {
		display: none;
		font-size: 0.75rem;
		color: oklch(0.55 0.02 250);
		text-align: center;
		margin: 0;
	}

	@media (min-width: 1024px) {
		.action-hint {
			display: block;
		}
	}

	.action-hint kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.25rem;
		border-radius: 4px;
		background: oklch(0.95 0.01 250);
		border: 1px solid oklch(0.88 0.02 250);
		font-family: system-ui, sans-serif;
		font-size: 0.625rem;
		font-weight: 600;
		color: oklch(0.45 0.02 250);
		margin: 0 0.125rem;
	}

	/*
	 * Divider — perceptual bridge between creation and discovery.
	 *
	 * Mobile: The template stream below is the PRIMARY discovery path.
	 * This should feel like an invitation downward, not a page-end ornament.
	 * Tight spacing, muted lines, forward-leaning copy.
	 *
	 * Desktop: Spatial position already encodes the "or" relationship —
	 * the divider becomes a gentle label pointing toward the right column.
	 */
	.spark-divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.25rem;
	}

	@media (min-width: 1280px) {
		.spark-divider {
			margin-top: 1rem;
			padding-top: 1rem;
			border-top: 1px solid oklch(0.92 0.01 250);
			justify-content: flex-start;
			gap: 0.5rem;
		}
	}

	.divider-line {
		flex: 1;
		height: 1px;
		background: oklch(0.91 0.01 250);
	}

	/* Desktop: spatial positioning encodes "or" — lines are redundant */
	@media (min-width: 1280px) {
		.divider-line {
			display: none;
		}
	}

	.divider-text {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.58 0.02 250);
		white-space: nowrap;
		letter-spacing: 0.01em;
	}

	.divider-text--desktop {
		display: none;
	}

	@media (min-width: 1280px) {
		.divider-text {
			font-size: 0.875rem;
			font-weight: 500;
			color: oklch(0.45 0.02 250);
		}

		.divider-text--mobile {
			display: none;
		}

		.divider-text--desktop {
			display: inline;
		}

		.divider-text::after {
			content: ' →';
			opacity: 0.5;
		}
	}

	/* Reduced motion */
	@media (prefers-reduced-motion: reduce) {
		.spark-actions {
			transition: none;
		}

		.continue-btn {
			transition: none;
		}

		.input-container {
			transition: none;
		}
	}
</style>
