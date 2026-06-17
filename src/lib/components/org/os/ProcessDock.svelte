<!--
  ProcessDock — the menu-bar process center. The multitasking made VISIBLE.

  This is the proof that the OS is real: it reads `orgOS.processes` (the live
  registry the authoring runner drives) and surfaces every running/finished
  authoring process as a chip — regardless of which space the operator is in.
  Because the process lives in the registry (not a component), it stays here and
  keeps advancing while the operator is in People, Power, or Results; clicking a
  chip focuses that process and switches to Studio to watch it.

  HONESTY RULE: a chip's stage + status are exactly what the real SSE stream
  emitted. The live pulse on a running chip is a SIGNAL-class CSS breath (the
  instrument is alive); it is gated on prefers-reduced-motion. No fabricated
  progress, ever. An idle registry renders nothing — no fake activity.
-->
<script lang="ts">
	import { Square, X } from '@lucide/svelte';
	import { Datum } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';
	import { getOrgOS, isRunning, type OrgProcess } from './orgOS.svelte';

	const os = getOrgOS();

	const STATUS_LABEL: Record<OrgProcess['status'], string> = {
		resolving: 'Resolving',
		grounding: 'Grounding',
		authoring: 'Authoring',
		composed: 'Composed',
		error: 'Failed',
		stopped: 'Stopped'
	};
	const STATUS_ACTION: Record<OrgProcess['status'], string> = {
		resolving: 'Watch target resolution',
		grounding: 'Watch source ground',
		authoring: 'Watch draft assembly',
		composed: 'Open authored output',
		error: 'Inspect failed run',
		stopped: 'Inspect stopped run'
	};
	const runningCount = $derived(os.runningProcesses.length);

	function runAriaLabel(p: OrgProcess): string {
		const running = isRunning(p);
		return `Studio run ${p.title}. ${STATUS_LABEL[p.status]}. ${running ? 'Running' : 'Idle'}. ${STATUS_ACTION[p.status]}.`;
	}

	function focus(p: OrgProcess) {
		os.focusProcess(p.id);
		os.switchSpace('studio');
	}

	function stop(e: MouseEvent, p: OrgProcess) {
		e.stopPropagation();
		os.stopProcess(p.id);
	}

	function dismiss(e: MouseEvent, p: OrgProcess) {
		e.stopPropagation();
		os.dismissProcess(p.id);
	}
</script>

{#if os.processes.length > 0}
	<section
		class="dock"
		aria-label="Studio authoring runs"
		style="--timing-normal: {TIMING.NORMAL}ms; --easing: {EASING};"
	>
		<div class="dock-head">
			<span class="dock-label">Studio runs</span>
			<span class="dock-count">
				<Datum value={runningCount} />
				running
			</span>
		</div>
		<ul class="dock-list">
			{#each os.processes as p (p.id)}
				{@const running = isRunning(p)}
				{@const focused = os.focusedProcessId === p.id}
				<li>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="chip"
						class:chip--running={running}
						class:chip--focused={focused}
						class:chip--error={p.status === 'error'}
						role="button"
						tabindex="0"
						aria-current={focused ? 'true' : undefined}
						aria-label={runAriaLabel(p)}
						onclick={() => focus(p)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								focus(p);
							}
						}}
					>
						<span class="chip-pulse" aria-hidden="true"></span>
						<span class="chip-body">
							<span class="chip-title">{p.title}</span>
							<span class="chip-meta">
								<span class="chip-status">{STATUS_LABEL[p.status]}</span>
								<span class="chip-run-action">{STATUS_ACTION[p.status]}</span>
							</span>
						</span>
						{#if running}
							<button
								type="button"
								class="chip-action"
								aria-label="Stop Studio run {p.title}"
								onclick={(e) => stop(e, p)}
							>
								<Square size={13} strokeWidth={2} aria-hidden="true" />
							</button>
						{:else}
							<button
								type="button"
								class="chip-action"
								aria-label="Dismiss Studio run {p.title}"
								onclick={(e) => dismiss(e, p)}
							>
								<X size={14} strokeWidth={2} aria-hidden="true" />
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.dock {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.dock-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.dock-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-dim);
	}

	.dock-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.5625rem;
		color: var(--org-sidebar-text-dim);
		white-space: nowrap;
	}

	.dock-list {
		display: flex;
		flex-direction: column;
		gap: 0.3125rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.chip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4375rem 0.5rem;
		border-radius: 8px;
		border: 1px solid var(--org-sidebar-border);
		background: transparent;
		cursor: pointer;
		transition:
			border-color var(--timing-normal) var(--easing),
			background-color var(--timing-normal) var(--easing);
	}

	.chip:hover,
	.chip:focus-visible {
		border-color: var(--coord-route-solid);
		background-color: var(--org-sidebar-hover);
		outline: none;
	}

	.chip--focused {
		border-color: var(--coord-route-solid);
		background-color: var(--org-sidebar-active);
	}

	.chip-pulse {
		flex-shrink: 0;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--org-sidebar-text-dim);
		transition: background var(--timing-normal) var(--easing);
	}

	.chip--running .chip-pulse {
		background: var(--coord-route-solid);
		animation: chip-pulse var(--pulse-duration) var(--pulse-easing) infinite;
	}

	.chip--error .chip-pulse {
		background: oklch(0.62 0.18 30);
		animation: none;
	}

	@keyframes chip-pulse {
		0%,
		100% {
			opacity: 0.4;
			box-shadow: 0 0 0 0 oklch(0.7 0.13 190 / 0);
		}
		50% {
			opacity: 1;
			box-shadow: 0 0 0 3px oklch(0.7 0.13 190 / 0.22);
		}
	}

	.chip-body {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
		flex: 1 1 auto;
	}

	.chip-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--org-sidebar-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chip-status {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.5625rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-dim);
	}

	.chip-meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
	}

	.chip-run-action {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.625rem;
		color: var(--org-sidebar-text-muted);
	}

	.chip--running .chip-status {
		color: var(--coord-route-solid);
	}
	.chip--error .chip-status {
		color: oklch(0.68 0.16 30);
	}

	.chip-action {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		/* 44px tappable hit area (WCAG 2.5.5). The glyph stays small (.chip-action svg
		   below); the transparent box just enlarges the touch/click target — Stop and
		   Dismiss are the only way to kill a run. */
		min-width: 44px;
		min-height: 44px;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--org-sidebar-text-dim);
		cursor: pointer;
		transition: color var(--timing-normal) var(--easing);
	}
	.chip-action:hover,
	.chip-action:focus-visible {
		color: var(--org-sidebar-text);
		outline: none;
	}
	.chip-action :global(svg) {
		width: 0.75rem;
		height: 0.75rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.chip--running .chip-pulse {
			animation: none;
			opacity: 1;
		}
	}
</style>
