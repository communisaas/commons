<!--
  CanvasCapabilityFinder — the map-scoped capability finder (⌘K). The PRIMARY
  navigation of the Capability Map: you don't drag the map hunting for an object,
  you search it by name and the camera flies you there.

	  This is Spotlight's pattern, retargeted: instead of switching org spaces or
	  routing to pages, it lists every REAL constellation object + the four workspaces +
	  the whole-map overview, indexes their capability states/clusters/gates,
	  fuzzy-filters as you type, and on select hands the chosen CameraTarget back to
	  the parent — which flies the camera to frame it.
  No navigation, no remount: the camera moves, the field stays.

	  HONESTY: the index is `buildTargets(constellation)` — exactly the objects on the
	  field, nothing fabricated. Capability metadata changes recognition vocabulary,
	  not destination count. An empty org lists only the workspaces + overview.

  SSR SAFETY: this component touches NO browser API. Open/query/selection are local
  $state; focus is queued in an $effect that only runs client-side (effects don't
  run during SSR render). All flight + window access lives in the parent.

  ACCESSIBILITY: role=dialog + aria-modal, a combobox input wired to the listbox,
  full keyboard drive (↑/↓/Enter/Esc), and the selected option scrolls into view.
-->
<script lang="ts">
	import { TIMING, EASING } from '$lib/design/motion';
	import type { CameraTarget } from './camera';
	import { filterTargets } from './camera';

	let {
		open = false,
		targets,
		onSelect,
		onClose
	}: {
		/** Parent-owned open flag (the parent owns the ⌘K keybinding). */
		open?: boolean;
		/** The full target index (overview + regions + every real object). */
		targets: CameraTarget[];
		/** Fly the camera to the chosen target. Parent owns the camera + history. */
		onSelect: (target: CameraTarget) => void;
		/** Dismiss the palette. */
		onClose: () => void;
	} = $props();

	let query = $state('');
	let selected = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLUListElement | null>(null);

	const filtered = $derived(filterTargets(targets, query));

	// Reset + focus whenever the palette opens. This $effect only ever runs on the
	// client (Svelte effects don't run during SSR render), so the queueMicrotask +
	// focus are safe without a window guard. Reading `open` is the only trigger; we
	// write query/selected (NOT open) so there is no read-write feedback loop.
	$effect(() => {
		if (open) {
			query = '';
			selected = 0;
			queueMicrotask(() => inputEl?.focus());
		}
	});

	// Keep the selected option in view as the operator arrows through a long list.
	$effect(() => {
		if (!open) return;
		// Touch `selected` so this re-runs on every move.
		const idx = selected;
		queueMicrotask(() => {
			const node = listEl?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
			node?.scrollIntoView({ block: 'nearest' });
		});
	});

	function execute(t: CameraTarget | undefined) {
		if (!t) return;
		onClose();
		onSelect(t);
	}

	function targetKindLabel(kind: CameraTarget['kind']): string {
		if (kind === 'object') return 'capability';
		if (kind === 'region') return 'workspace';
		return 'whole map';
	}

	function targetAriaLabel(t: CameraTarget): string {
		return [
			targetKindLabel(t.kind),
			t.label,
			t.sublabel,
			t.stateLabel ? `state ${t.stateLabel}` : null,
			t.actionLabel ? `action ${t.actionLabel}` : null,
			t.handoff ? `handoff ${t.handoff}` : null,
			t.clusterLabels ? `clusters ${t.clusterLabels}` : null,
			t.gateName ? `gate ${t.gateName}` : null,
			t.gateTasks ? `tasks ${t.gateTasks}` : null
		]
			.filter(Boolean)
			.join(', ');
	}

	function onInputKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = Math.min(selected + 1, filtered.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			execute(filtered[selected]);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else {
			// Any other key edits the query — reset the cursor next tick.
			selected = 0;
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="sm-backdrop"
		onclick={onClose}
		style="--timing-slow: {TIMING.SLOW}ms; --timing-normal: {TIMING.NORMAL}ms; --easing: {EASING};"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="sm-panel"
			role="dialog"
			aria-modal="true"
			aria-label="Search the capability map"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<input
				bind:this={inputEl}
				bind:value={query}
				onkeydown={onInputKey}
				class="sm-input"
				type="text"
				role="combobox"
				aria-expanded="true"
				aria-controls="sm-list"
				aria-autocomplete="list"
				placeholder="Search capability, state, cluster, gate..."
				aria-label="Capability map search"
			/>

			{#if filtered.length === 0}
				<p class="sm-empty">Nothing found. <kbd class="sm-kbd">Esc</kbd> to close.</p>
			{:else}
				<ul
					bind:this={listEl}
					id="sm-list"
					class="sm-list"
					role="listbox"
					aria-label="Capability targets"
				>
					{#each filtered as t, i (t.id)}
						{#if i === 0 || filtered[i - 1].group !== t.group}
							<li class="sm-group" aria-hidden="true">{t.group}</li>
						{/if}
						<li role="option" aria-selected={i === selected} data-idx={i}>
							<!-- svelte-ignore a11y_mouse_events_have_key_events -->
							<button
								type="button"
								class="sm-item"
								class:sm-item--sel={i === selected}
								aria-label={targetAriaLabel(t)}
								onmouseenter={() => (selected = i)}
								onclick={() => execute(t)}
							>
								<span class="sm-item-main">
									<span class="sm-mark" data-kind={t.kind} aria-hidden="true"></span>
									<span class="sm-copy">
										<span class="sm-title-line">
											<span class="sm-label">{t.label}</span>
											{#if t.stateLabel}
												<span class="sm-state" data-state={t.state}>{t.stateLabel}</span>
											{/if}
										</span>
										<span class="sm-sublabel">{t.sublabel}</span>
										{#if t.actionLabel || t.handoff || t.clusterLabels || t.gateName || t.gateTasks}
											<span class="sm-contract">
												{#if t.actionLabel}
													<span>{t.actionLabel}</span>
												{/if}
												{#if t.handoff}
													<span>{t.handoff}</span>
												{/if}
												{#if t.clusterLabels}
													<span>{t.clusterLabels}</span>
												{/if}
												{#if t.gateName}
													<span>{t.gateName}</span>
												{/if}
												{#if t.gateTasks}
													<span>{t.gateTasks}</span>
												{/if}
											</span>
										{/if}
									</span>
								</span>
								<span class="sm-kind">{targetKindLabel(t.kind)}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="sm-foot">
				<kbd class="sm-kbd">↑↓</kbd> move
				<kbd class="sm-kbd">↵</kbd> move
				<kbd class="sm-kbd">esc</kbd> close
			</div>
		</div>
	</div>
{/if}

<style>
	.sm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 16vh;
		background: oklch(0.78 0.012 78 / 0.38);
		animation: sm-fade var(--timing-normal) var(--easing);
	}

	.sm-panel {
		--search-text: oklch(0.22 0.016 250);
		--search-muted: oklch(0.42 0.016 245);
		--search-dim: oklch(0.52 0.014 235);
		width: min(40rem, 92vw);
		max-height: 64vh;
		display: flex;
		flex-direction: column;
		background: oklch(0.99 0.003 60 / 0.98);
		border: 1px solid oklch(0.72 0.018 78 / 0.82);
		border-radius: 8px;
		box-shadow:
			0 34px 100px -44px oklch(0.25 0.025 250 / 0.38),
			0 0 0 1px oklch(0.82 0.014 78 / 0.62);
		padding: 0.875rem;
		animation: sm-rise var(--timing-slow) var(--easing);
	}

	.sm-input {
		width: 100%;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		color: var(--search-text);
		background: transparent;
		border: none;
		border-bottom: 1px solid oklch(0.72 0.018 78 / 0.82);
		padding: 0.25rem 0 0.625rem;
		outline: none;
	}
	.sm-input::placeholder {
		color: var(--search-dim);
	}

	.sm-list {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		overflow-y: auto;
	}

	.sm-group {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--search-dim);
		padding: 0.5rem 0.5rem 0.25rem;
	}

	.sm-item {
		width: 100%;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.55rem 0.625rem;
		border: none;
		border-radius: 6px;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.sm-item--sel {
		background: oklch(0.935 0.016 190 / 0.96);
	}

	.sm-item-main {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		min-width: 0;
		flex: 1;
	}

	.sm-mark {
		flex-shrink: 0;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 3px;
		background: var(--coord-route-solid, #3bc4b8);
		box-shadow: 0 0 8px -1px var(--coord-route-solid, #3bc4b8);
	}

	.sm-copy {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 0.125rem;
	}

	.sm-title-line {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}

	.sm-mark[data-kind='region'] {
		background: var(--coord-share-solid, #4f46e5);
		box-shadow: 0 0 8px -1px var(--coord-share-solid, #4f46e5);
		border-radius: 2px;
	}
	.sm-mark[data-kind='overview'] {
		background: var(--coord-verified, #10b981);
		box-shadow: 0 0 8px -1px var(--coord-verified, #10b981);
		border-radius: 50%;
	}

	.sm-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.9375rem;
		color: var(--search-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.sm-state {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.5625rem;
		text-transform: uppercase;
		color: oklch(0.2 0.018 250);
		border: 1px solid oklch(0.7 0.025 190 / 0.78);
		border-radius: 4px;
		background: oklch(0.94 0.018 190 / 0.78);
		padding: 0.0625rem 0.25rem;
	}

	.sm-state[data-state='live'] {
		border-color: oklch(0.68 0.11 158 / 0.75);
		background: oklch(0.92 0.035 155 / 0.8);
	}

	.sm-state[data-state='draft-only'] {
		border-color: oklch(0.7 0.1 82 / 0.78);
		background: oklch(0.95 0.035 82 / 0.8);
	}

	.sm-state[data-state='gated'],
	.sm-state[data-state='testnet'] {
		border-color: oklch(0.62 0.02 245 / 0.72);
		background: oklch(0.93 0.008 245 / 0.8);
	}

	.sm-sublabel {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--search-muted);
	}

	.sm-contract {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.45rem;
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.25;
		color: var(--search-dim);
	}

	.sm-kind {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.625rem;
		text-transform: uppercase;
		color: var(--search-muted);
		flex-shrink: 0;
	}

	.sm-empty {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: var(--search-muted);
		margin: 0.75rem 0.5rem 0.25rem;
	}

	.sm-foot {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding-top: 0.625rem;
		margin-top: 0.5rem;
		border-top: 1px solid oklch(0.72 0.018 78 / 0.82);
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--search-muted);
	}

	.sm-kbd {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.5625rem;
		color: var(--search-text);
		border: 1px solid oklch(0.72 0.018 78 / 0.82);
		border-radius: 4px;
		background: oklch(0.96 0.006 58 / 0.88);
		padding: 0.0625rem 0.25rem;
		margin-right: 0.125rem;
	}

	@keyframes sm-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes sm-rise {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sm-backdrop,
		.sm-panel {
			animation: none;
		}
	}
</style>
