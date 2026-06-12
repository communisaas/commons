<!--
	  Spotlight — the universal command surface (Cmd/Ctrl-K).

	  With the link cabinet gone from the rail, Spotlight carries
	  recognition-over-recall navigation across the workspaces and every route
	  folded under them. It is rendered ONCE at the shell level (outside the
	  hideable OrgShell) so it is reachable from every space AND every deep route,
	  reads the OS kernel's `spotlightOpen` flag, and executes against the kernel:

	    · a SPACE destination → os.switchSpace (instant, stateful) — and, when the
	      current URL is not rendering a mounted space, a navigation to the space
	      path so the switch is visible.
	    · a ROUTE destination → goto.

	  Fuzzy match (substring outranks subsequence, best match first),
	  keyboard-driven (↑/↓/Enter/Esc),
	  grouped by space. Motion is ease-out (navigation-class, no spring). No data
	  is fabricated — destinations are the real routes the org exposes, a count is
	  a real loaded count, and a note is the plain-language limit sentence that
	  bounds the action it links to.
-->
<script lang="ts" module>
	import type { SpaceId } from './orgOS.svelte';

	export interface SpotlightDestination {
		id: string;
		label: string;
		/** Group header — the workspace it belongs to, "Workspaces", or "Substrate". */
		group: string;
		kind: 'space' | 'route';
		spaceId?: SpaceId;
		href?: string;
		/** Real loaded count, when the destination carries one. Null = unread. */
		count?: number | null;
		/** One plain-language limit sentence, for a bounded action. */
		note?: string;
	}
</script>

<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { TIMING, EASING } from '$lib/design/motion';
	import { getOrgOS, pathForSpace, rankSpotlightMatches, rendersSpaceForUrl } from './orgOS.svelte';

	let {
		destinations,
		base
	}: {
		destinations: SpotlightDestination[];
		base: string;
	} = $props();

	const os = getOrgOS();

	let query = $state('');
	let selected = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);

	function destinationSearchText(d: SpotlightDestination): string {
		return [d.label, d.group, d.note].filter(Boolean).join(' ');
	}

	// Best match first: substring outranks subsequence, so Enter on the top row
	// takes the strongest match. The sort is stable, so equal scores keep the
	// original grouped order — an empty query leaves the list untouched.
	const filtered = $derived(rankSpotlightMatches(destinations, query, destinationSearchText));

	// Focus + reset whenever the palette opens.
	$effect(() => {
		if (os.spotlightOpen) {
			query = '';
			selected = 0;
			queueMicrotask(() => inputEl?.focus());
		}
	});

	function close() {
		os.closeSpotlight();
	}

	function execute(d: SpotlightDestination | undefined) {
		if (!d) return;
		os.closeSpotlight();
		if (d.kind === 'route' && d.href) {
			goto(d.href);
			return;
		}
		if (d.kind === 'space' && d.spaceId) {
			os.switchSpace(d.spaceId);
			// When the current URL is not rendering a mounted space — a deep route,
			// or a space path under the ?view=full opt-out — navigate to the space
			// path so the switch is actually visible. On a rendering space path,
			// OrgShell's shallow routing updates the URL without a remount.
			if (!rendersSpaceForUrl($page.url, base)) goto(pathForSpace(d.spaceId, base));
		}
	}

	function itemAria(d: SpotlightDestination): string {
		const parts = [d.label];
		if (d.count !== undefined && d.count !== null) {
			parts.push(d.count.toLocaleString('en-US'));
		}
		if (d.note) parts.push(d.note);
		return parts.join(', ');
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
			close();
		} else {
			// any other key edits the query — keep selection in range next tick
			selected = 0;
		}
	}
</script>

{#if os.spotlightOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="sp-backdrop"
		onclick={close}
		style="--timing-slow: {TIMING.SLOW}ms; --timing-normal: {TIMING.NORMAL}ms; --easing: {EASING};"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="sp-panel"
			role="dialog"
			aria-modal="true"
			aria-label="Spotlight — search pages and workspaces"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<input
				bind:this={inputEl}
				bind:value={query}
				onkeydown={onInputKey}
				class="sp-input"
				type="text"
				role="combobox"
				aria-expanded="true"
				aria-controls="sp-list"
				aria-autocomplete="list"
				placeholder="Search pages and workspaces…"
				aria-label="Page and workspace search"
			/>

			{#if filtered.length === 0}
				<p class="sp-empty">No match. <kbd class="sp-kbd">Esc</kbd> to close.</p>
			{:else}
				<ul id="sp-list" class="sp-list" role="listbox" aria-label="Pages and workspaces">
					{#each filtered as d, i (d.id)}
						{#if i === 0 || filtered[i - 1].group !== d.group}
							<li class="sp-group" aria-hidden="true">{d.group}</li>
						{/if}
						<li role="option" aria-selected={i === selected}>
							<!-- svelte-ignore a11y_mouse_events_have_key_events -->
							<button
								type="button"
								class="sp-item"
								class:sp-item--sel={i === selected}
								aria-label={itemAria(d)}
								onmouseenter={() => (selected = i)}
								onclick={() => execute(d)}
							>
								<span class="sp-item-main">
									<span class="sp-line">
										<span class="sp-label">{d.label}</span>
										{#if d.count !== undefined && d.count !== null}
											<span class="sp-count">{d.count.toLocaleString('en-US')}</span>
										{/if}
									</span>
									{#if d.note}
										<span class="sp-note">{d.note}</span>
									{/if}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="sp-foot">
				<kbd class="sp-kbd">↑↓</kbd> move
				<kbd class="sp-kbd">↵</kbd> open
				<kbd class="sp-kbd">esc</kbd> close
			</div>
		</div>
	</div>
{/if}

<style>
	.sp-backdrop {
		position: fixed;
		inset: 0;
		z-index: 70;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 16vh;
		background: oklch(0.15 0.02 60 / 0.38);
		animation: sp-fade var(--timing-normal) var(--easing);
	}

	.sp-panel {
		width: min(40rem, 92vw);
		max-height: 64vh;
		display: flex;
		flex-direction: column;
		background: var(--surface, #ffffff);
		border: 1px solid var(--coord-node-border);
		border-radius: 8px;
		box-shadow: var(--coord-node-shadow);
		padding: 0.875rem;
		animation: sp-rise var(--timing-slow) var(--easing);
	}

	.sp-input {
		width: 100%;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		color: var(--text-primary);
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--coord-node-border);
		padding: 0.25rem 0 0.625rem;
		outline: none;
	}

	.sp-list {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		overflow-y: auto;
	}

	.sp-group {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		padding: 0.5rem 0.5rem 0.25rem;
	}

	.sp-item {
		width: 100%;
		display: block;
		padding: 0.5rem;
		border: none;
		border-radius: 6px;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.sp-item--sel {
		background: var(--coord-node-bg, oklch(0.6 0.14 175 / 0.1));
	}

	.sp-item-main {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.sp-line {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
		flex-wrap: wrap;
	}

	.sp-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-primary);
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.sp-count {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		white-space: nowrap;
	}

	.sp-note {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--text-tertiary);
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.sp-empty {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		margin: 0.75rem 0.5rem 0.25rem;
	}

	.sp-foot {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding-top: 0.625rem;
		margin-top: 0.5rem;
		border-top: 1px solid var(--coord-node-border);
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--text-tertiary);
	}

	.sp-kbd {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.5625rem;
		color: var(--text-tertiary);
		border: 1px solid var(--coord-node-border);
		border-radius: 4px;
		padding: 0.0625rem 0.25rem;
		margin-right: 0.125rem;
	}

	@keyframes sp-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes sp-rise {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
