<script lang="ts">
	/**
	 * Cite — Contextual provenance for verifiable claims.
	 *
	 * Wraps any content (typically a Datum + label) and provides
	 * progressive disclosure of its provenance. The citation is
	 * invisible until inquiry — the form of revelation adapts
	 * to context.
	 *
	 * Forms:
	 *   whisper   — Provenance materializes in the void below on
	 *               hover/focus. For hero metrics, dashboard counts.
	 *   mark      — Dotted underline signals "pull this thread."
	 *               Hover reveals popover. For inline claims.
	 *   footnote  — Superscript ref, collected at bottom of parent Artifact.
	 *               For proof specimens, formal documents.
	 *               Falls back to whisper if not inside an Artifact.
	 *   ghost     — Zero visual. aria-describedby only. For dense layouts.
	 *
	 * Provenance styling utilities (use inside provenance snippet):
	 *   .cite-anchor  — Mono, very small. For hashes, roots, tx IDs.
	 *   .cite-sep     — Middot separator with balanced spacing.
	 *   .cite-method  — Interpretive label, slightly emphasized.
	 */
	import type { Snippet } from 'svelte';
	import { getContext, onDestroy } from 'svelte';
	import { FootnoteRegistry, FOOTNOTE_CTX } from './footnote-registry.svelte';

	let {
		form = 'whisper',
		cite = undefined,
		provenance = undefined,
		class: className = '',
		children
	}: {
		/** Citation form. Determines how provenance is revealed. */
		form?: 'whisper' | 'mark' | 'footnote' | 'ghost';
		/** Simple string provenance. Use `provenance` snippet for rich content. */
		cite?: string;
		/** Rich provenance content (overrides `cite` string). Not used in footnote form. */
		provenance?: Snippet;
		/** Additional CSS classes */
		class?: string;
		children: Snippet;
	} = $props();

	const id = `cite-${Math.random().toString(36).slice(2, 9)}`;

	// ─── Footnote registration ───────────────────────────────
	const registry = getContext<FootnoteRegistry | undefined>(FOOTNOTE_CTX);
	let footnoteIndex = $state<number | undefined>(undefined);

	// Determine effective form: footnote degrades to whisper outside Artifact
	const effectiveForm = $derived(
		form === 'footnote' && !registry ? 'whisper' : form
	);

	// Register footnote during initialization.
	// svelte-ignore state_referenced_locally — form and cite are static per instance
	const _footnoteContent = form === 'footnote' && registry && cite ? cite : null;
	if (_footnoteContent) {
		footnoteIndex = registry!.register(id, _footnoteContent);
	}

	onDestroy(() => {
		if (_footnoteContent) {
			registry!.unregister(id);
		}
	});

	// ─── Mark popover state ──────────────────────────────────
	let markOpen = $state(false);
	let markTimer: ReturnType<typeof setTimeout> | null = null;

	function markEnter() {
		if (markTimer) clearTimeout(markTimer);
		markTimer = setTimeout(() => { markOpen = true; }, 300);
	}

	function markLeave() {
		if (markTimer) clearTimeout(markTimer);
		markTimer = setTimeout(() => { markOpen = false; }, 150);
	}

	function markPopoverEnter() {
		if (markTimer) clearTimeout(markTimer);
	}

	function markPopoverLeave() {
		markTimer = setTimeout(() => { markOpen = false; }, 150);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			markOpen = !markOpen;
		}
		if (event.key === 'Escape') {
			markOpen = false;
		}
	}

	const hasCite = $derived(!!cite || !!provenance);
</script>

{#if !hasCite}
	{@render children()}
{:else if effectiveForm === 'whisper'}
	<!--
	  Whisper: provenance materializes in the void below.
	  The whisper lives in the generous gap EntityCluster creates.
	-->
	<span
		class="cite-whisper group relative inline-flex flex-col items-start {className}"
		aria-describedby={id}
		role="group"
	>
		<span class="cite-content">
			{@render children()}
		</span>
		<span class="cite-provenance" aria-hidden="true">
			{#if provenance}
				{@render provenance()}
			{:else if cite}
				{cite}
			{/if}
		</span>
		<span class="sr-only" id={id}>
			{cite ?? 'See provenance details'}
		</span>
	</span>
{:else if effectiveForm === 'mark'}
	<!--
	  Mark: dotted underline. Pull the thread.
	-->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<span
		class="cite-mark group relative inline {className}"
		aria-describedby={id}
		tabindex={0}
		role="button"
		aria-expanded={markOpen}
		onmouseenter={markEnter}
		onmouseleave={markLeave}
		onfocusin={() => { markOpen = true; }}
		onfocusout={() => { markOpen = false; }}
		onkeydown={handleKeydown}
	>
		<span class="cite-mark-content">
			{@render children()}
		</span>

		{#if markOpen}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="cite-mark-popover"
				id={id}
				role="tooltip"
				onmouseenter={markPopoverEnter}
				onmouseleave={markPopoverLeave}
			>
				{#if provenance}
					{@render provenance()}
				{:else if cite}
					{cite}
				{/if}
			</span>
		{/if}
	</span>
{:else if effectiveForm === 'footnote'}
	<!--
	  Footnote: superscript reference, collected at bottom of Artifact.
	  The sup is teal mono — a route to provenance at the document's foot.
	-->
	<span class="cite-footnote {className}" aria-describedby={id}>
		{@render children()}<sup
			class="cite-footnote-ref"
			aria-label="Footnote {footnoteIndex}"
		>{footnoteIndex}</sup>
	</span>
{:else if effectiveForm === 'ghost'}
	<!--
	  Ghost: invisible citation. Screen readers only.
	-->
	<span class="cite-ghost {className}" aria-describedby={id}>
		{@render children()}
		<span class="sr-only" id={id}>
			{cite ?? 'See provenance details'}
		</span>
	</span>
{/if}

<style>
	/* ─── Whisper ─────────────────────────────────────────── */

	.cite-provenance {
		display: block;
		margin-top: 2px;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem; /* 11px — subordinate */
		line-height: 1.3;
		color: var(--text-tertiary, #6b7280);
		opacity: 0;
		transform: translateY(-2px);
		transition:
			opacity 150ms cubic-bezier(0.4, 0, 0.2, 1),
			transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
		pointer-events: none;
		white-space: nowrap;
	}

	.cite-whisper:hover .cite-provenance,
	.cite-whisper:focus-within .cite-provenance {
		opacity: 1;
		transform: translateY(0);
	}

	/* ─── Mark ────────────────────────────────────────────── */

	.cite-mark-content {
		border-bottom: 1px dotted oklch(0.65 0.14 175 / 0.5);
		transition:
			border-color 150ms ease,
			border-style 150ms ease;
		cursor: default;
	}

	.cite-mark:hover .cite-mark-content,
	.cite-mark:focus-within .cite-mark-content {
		border-bottom-style: solid;
		border-bottom-color: oklch(0.65 0.14 175 / 0.8);
	}

	.cite-mark:focus-visible {
		outline: none;
		border-radius: 2px;
		box-shadow: 0 0 0 2px oklch(0.65 0.14 175 / 0.3);
	}

	.cite-mark-popover {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;

		max-width: 280px;
		padding: 6px 10px;
		border-radius: 6px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-overlay, oklch(0.975 0.005 55));
		box-shadow: 0 4px 12px -4px oklch(0 0 0 / 0.1);

		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: var(--text-secondary, #374151);
		white-space: normal;

		animation: cite-mark-enter 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	@keyframes cite-mark-enter {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}

	/* ─── Footnote ────────────────────────────────────────── */

	.cite-footnote-ref {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem; /* 9px */
		font-variant-numeric: tabular-nums;
		color: var(--coord-route-solid, #3bc4b8);
		margin-left: 1px;
		cursor: default;
		vertical-align: super;
		line-height: 0;
	}

	/* ─── Provenance styling utilities ────────────────────── */
	/* Use these classes inside provenance snippets for          */
	/* structured citation content.                              */

	:global(.cite-anchor) {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem; /* 10px */
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
		word-break: break-all;
	}

	:global(.cite-sep) {
		margin: 0 0.3em;
		opacity: 0.4;
	}

	:global(.cite-sep::before) {
		content: '·';
	}

	:global(.cite-method) {
		font-weight: 500;
	}
</style>
