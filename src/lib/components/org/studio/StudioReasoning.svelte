<!--
  StudioReasoning — the strong center of the STUDIO interior.

  This is the instrument thinking out loud. Every line is a REAL thought
  streamed from a live agent SSE endpoint (stream-decision-makers /
  stream-message), surfaced through the LIGHT filter (verbose mode) so the
  org watches actual planning — not a stub. The HONESTY RULE governs here:
  this component renders only what it is handed. It never fabricates a
  thought; an empty phase renders an honest empty state.

  Reasoning is grouped by loop stage:
    GROUND   — source discovery (stream-message phase 'sources')
    AUTHOR   — message composition (stream-message phase 'message')
    RESOLVE  — decision-maker tool loop (stream-decision-makers segments)

  Tool actions (search_web / read_page) arrive as ActionEntry rows and are
  rendered distinctly from free reasoning, with their live status.

  Motion law: the active phase carries a "working pulse" — a slow SIGNAL-class
  breath that says the instrument is alive. No spring on the trace itself
  (text is not a coordination signal); the pulse is a CSS animation gated on
  prefers-reduced-motion. Counts are Mono via <Datum>.
-->
<script lang="ts" module>
	export type ReasoningStage = 'ground' | 'author' | 'resolve';

	export interface ThoughtEntry {
		kind: 'thought';
		stage: ReasoningStage;
		content: string;
		ts: number;
	}

	export interface ActionEntry {
		kind: 'action';
		stage: ReasoningStage;
		action: string; // 'search' | 'analyze' | ...
		title: string;
		status: 'in_progress' | 'complete' | 'error';
		statusMessage?: string;
		ts: number;
	}

	export type ReasoningEntry = ThoughtEntry | ActionEntry;
</script>

<script lang="ts">
	import { Datum } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';

	let {
		entries,
		activeStage = null,
		stageLabel = ''
	}: {
		/** The full, ordered reasoning trace. Real streamed entries only. */
		entries: ReasoningEntry[];
		/** Which loop stage is currently producing reasoning (drives the pulse). */
		activeStage?: ReasoningStage | null;
		/** Human label for the active stage, shown in the header. Satoshi. */
		stageLabel?: string;
	} = $props();

	const STAGE_META: Record<ReasoningStage, { label: string; gloss: string }> = {
		ground: { label: 'Ground', gloss: 'discovering & ranking sources' },
		author: { label: 'Author', gloss: 'writing from attached source ground' },
		resolve: { label: 'Resolve', gloss: 'resolving decision-makers' }
	};

	const thoughtCount = $derived(entries.filter((e) => e.kind === 'thought').length);
	const actionCount = $derived(entries.filter((e) => e.kind === 'action').length);
	const isWorking = $derived(activeStage !== null);

	// Auto-scroll the trace to the newest entry as it streams.
	let scrollEl = $state<HTMLElement>();
	$effect(() => {
		// touch length so the effect re-runs on each new entry
		void entries.length;
		if (scrollEl) {
			scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
		}
	});
</script>

<section
	class="reasoning"
	class:reasoning--working={isWorking}
	style="--timing-slow: {TIMING.SLOW}ms; --easing: {EASING};"
	aria-label="Agent reasoning"
>
	<header class="reasoning-head">
		<div class="reasoning-head-left">
			<span class="reasoning-pulse" aria-hidden="true"></span>
			<span class="reasoning-title">
				{#if isWorking}
					{stageLabel || (activeStage ? STAGE_META[activeStage].label : 'Thinking')}
				{:else}
					Reasoning
				{/if}
			</span>
			{#if isWorking && activeStage}
				<span class="reasoning-gloss">{STAGE_META[activeStage].gloss}</span>
			{/if}
		</div>
		<div class="reasoning-counts">
			<span class="reasoning-count">
				<Datum value={thoughtCount} class="reasoning-count-num" />
				<span class="reasoning-count-label">thoughts</span>
			</span>
			{#if actionCount > 0}
				<span class="reasoning-count">
					<Datum value={actionCount} class="reasoning-count-num" />
					<span class="reasoning-count-label">tool calls</span>
				</span>
			{/if}
		</div>
	</header>

	<div
		class="reasoning-stream"
		bind:this={scrollEl}
		role="log"
		aria-live="polite"
		aria-relevant="additions"
		aria-busy={isWorking}
	>
		{#if entries.length === 0}
			<!-- Honest empty state — never a faked thought. -->
			<p class="reasoning-empty">
				{#if isWorking}
					Waiting for the first thought to stream in…
				{:else}
					The instrument is idle. Set an intent and the reasoning will surface here as the agent
					grounds, authors, and resolves.
				{/if}
			</p>
		{:else}
			{#each entries as entry, i (i)}
				{#if entry.kind === 'thought'}
					<p class="reasoning-line reasoning-line--{entry.stage}">
						<span class="reasoning-stage-tag">{STAGE_META[entry.stage].label}</span>
						<span class="reasoning-text">{entry.content}</span>
					</p>
				{:else}
					<div
						class="reasoning-action reasoning-action--{entry.status}"
						aria-label="{entry.action} {entry.title}"
					>
						<span class="reasoning-action-mark" aria-hidden="true">
							{#if entry.action === 'search'}
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
									><circle cx="11" cy="11" r="7" /><path
										stroke-linecap="round"
										d="M21 21l-4.3-4.3"
									/></svg
								>
							{:else}
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
									/></svg
								>
							{/if}
						</span>
						<span class="reasoning-action-body">
							<span class="reasoning-action-title">{entry.title}</span>
							{#if entry.statusMessage}
								<span class="reasoning-action-status">{entry.statusMessage}</span>
							{/if}
						</span>
						<span class="reasoning-action-state" aria-hidden="true">
							{#if entry.status === 'in_progress'}
								<span class="reasoning-spinner"></span>
							{:else if entry.status === 'complete'}
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M4.5 12.75l6 6 9-13.5"
									/></svg
								>
							{:else}
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M6 18L18 6M6 6l12 12"
									/></svg
								>
							{/if}
						</span>
					</div>
				{/if}
			{/each}
		{/if}
	</div>
</section>

<style>
	.reasoning {
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--surface-base, oklch(0.993 0.003 60));
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-radius: 8px;
		overflow: hidden;
	}

	/* ─── Header ─── */
	.reasoning-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-overlay, oklch(0.975 0.005 55));
	}

	.reasoning-head-left {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}

	.reasoning-pulse {
		align-self: center;
		flex-shrink: 0;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: oklch(0.7 0.01 60);
		transition: background var(--timing-slow) var(--easing);
	}

	/* Working pulse: a slow SIGNAL-class breath. The instrument is alive. */
	.reasoning--working .reasoning-pulse {
		background: var(--coord-route-solid, #3bc4b8);
		animation: working-pulse var(--pulse-duration) var(--pulse-easing) infinite;
	}

	@keyframes working-pulse {
		0%,
		100% {
			opacity: 0.35;
			box-shadow: 0 0 0 0 oklch(0.7 0.13 190 / 0);
		}
		50% {
			opacity: 1;
			box-shadow: 0 0 0 4px oklch(0.7 0.13 190 / 0.18);
		}
	}

	.reasoning-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-primary, oklch(0.25 0.01 60));
		white-space: nowrap;
	}

	.reasoning-gloss {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b7280);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.reasoning-counts {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		flex-shrink: 0;
	}

	.reasoning-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
	}

	.reasoning :global(.reasoning-count-num) {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.reasoning-count-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--text-tertiary, #6b7280);
	}

	/* ─── Stream ─── */
	.reasoning-stream {
		flex: 1 1 auto;
		min-height: 14rem;
		max-height: 28rem;
		overflow-y: auto;
		padding: 0.75rem 1rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.reasoning-empty {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		font-style: italic;
		margin: auto 0;
		max-width: 32rem;
	}

	.reasoning-line {
		display: flex;
		gap: 0.625rem;
		margin: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--text-secondary, oklch(0.4 0.01 60));
	}

	.reasoning-stage-tag {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.5625rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding-top: 0.3rem;
		width: 3.75rem;
		color: var(--text-tertiary, #9ca3af);
	}

	.reasoning-line--ground .reasoning-stage-tag {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.reasoning-line--author .reasoning-stage-tag {
		color: var(--coord-share, #4f46e5);
	}
	.reasoning-line--resolve .reasoning-stage-tag {
		color: var(--coord-verified, #10b981);
	}

	.reasoning-text {
		min-width: 0;
	}

	/* ─── Tool actions ─── */
	.reasoning-action {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: #ffffff;
	}

	.reasoning-action--complete {
		border-color: oklch(0.85 0.06 160);
	}
	.reasoning-action--error {
		border-color: oklch(0.82 0.08 30);
	}

	.reasoning-action-mark {
		flex-shrink: 0;
		width: 1rem;
		height: 1rem;
		color: var(--coord-route-solid, #3bc4b8);
	}
	.reasoning-action-mark svg {
		width: 100%;
		height: 100%;
	}

	.reasoning-action-body {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
		flex: 1 1 auto;
	}

	.reasoning-action-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: var(--text-primary, oklch(0.25 0.01 60));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.reasoning-action-status {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.625rem;
		color: var(--text-tertiary, #6b7280);
	}

	.reasoning-action-state {
		flex-shrink: 0;
		width: 1rem;
		height: 1rem;
	}
	.reasoning-action--complete .reasoning-action-state {
		color: var(--coord-verified, #10b981);
	}
	.reasoning-action--error .reasoning-action-state {
		color: oklch(0.55 0.18 30);
	}
	.reasoning-action-state svg {
		width: 100%;
		height: 100%;
	}

	.reasoning-spinner {
		display: block;
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 50%;
		border: 2px solid oklch(0.7 0.01 60 / 0.3);
		border-top-color: var(--coord-route-solid, #3bc4b8);
		animation: reasoning-spin 0.7s linear infinite;
	}

	@keyframes reasoning-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.reasoning--working .reasoning-pulse {
			animation: none;
			opacity: 1;
		}
		.reasoning-spinner {
			animation: none;
			border-top-color: oklch(0.7 0.01 60 / 0.3);
		}
		.reasoning-stream {
			scroll-behavior: auto;
		}
	}
</style>
