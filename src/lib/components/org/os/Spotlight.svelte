<!--
	  Spotlight — the universal command surface (Cmd/Ctrl-K).

	  This is the command ground of the OS: with the link cabinet gone from the rail,
	  Spotlight carries recognition-over-recall across capability surfaces, workspaces,
	  and real handoffs. It is rendered ONCE at the shell level (outside the
	  hideable OrgShell) so it is reachable from every space AND every deep route,
	  reads the OS kernel's `spotlightOpen` flag, and executes against the kernel:

    · a SPACE destination  → os.switchSpace (instant, stateful) — and, when on a
      deep route where the shell is hidden, a navigation to the space path so the
      switch is visible.
	    · a HANDOFF destination → goto (a capability anchor or deep page the OS hasn't
	      absorbed yet, with state/gate context).

  Fuzzy match (substring, then subsequence), keyboard-driven (↑/↓/Enter/Esc),
  grouped by space. Motion is ease-out (navigation-class, no spring). No data is
  fabricated — destinations are the real routes the org exposes.
-->
<script lang="ts" module>
	import type { SpaceId } from './orgOS.svelte';

	export type SpotlightState = 'live' | 'partial' | 'draft-only' | 'gated' | 'testnet';

	export interface SpotlightDestination {
		id: string;
		label: string;
		/** Short qualifier shown after the label (e.g. a space's gloss). */
		sublabel?: string;
		/** Compact capability state. Same grammar as the Mantle and capability map. */
		state?: SpotlightState;
		/** One real signal or count, if the destination carries one. */
		signal?: string;
		/** What Enter will do, in route/capability language. */
		action?: string;
		/** The operational object or workspace this command hands the operator to. */
		handoff?: string;
		/** The real route effect after execution; never a stronger capability claim. */
		effect?: string;
		/** Gate or boundary that keeps the command honest. */
		gate?: string;
		/** Group header (the workspace it belongs to, or "Substrate"). */
		group: string;
		kind: 'space' | 'route';
		spaceId?: SpaceId;
		href?: string;
		latent?: boolean;
	}
</script>

<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { TIMING, EASING } from '$lib/design/motion';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import { getOrgOS, isSpacePath, pathForSpace } from './orgOS.svelte';

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

	/** Substring match scores higher than subsequence; 0 = no match. */
	function score(label: string, q: string): number {
		if (!q) return 1;
		const l = label.toLowerCase();
		const query = q.toLowerCase();
		if (l.includes(query)) return 2;
		let i = 0;
		for (const ch of l) {
			if (ch === query[i]) i += 1;
			if (i === query.length) return 1;
		}
		return 0;
	}

	function stateLabel(state: SpotlightState): string {
		return operatorCapabilityStateLabel(state);
	}

	function actionLabel(d: SpotlightDestination): string {
		const action = d.action ?? (d.kind === 'space' ? 'switch' : 'open');
		return operatorCapabilityActionLabel(d.state, action);
	}

	function handoffLabel(d: SpotlightDestination): string {
		return d.handoff ?? d.label;
	}

	function effectLabel(d: SpotlightDestination): string | null {
		return d.effect ?? d.sublabel ?? d.signal ?? null;
	}

	function destinationSearchText(d: SpotlightDestination): string {
		return [
			d.label,
			d.sublabel,
			d.group,
			d.kind,
			d.state ? stateLabel(d.state) : null,
			d.latent ? 'not armed latent held' : null,
			handoffLabel(d),
			effectLabel(d),
			d.signal,
			d.gate,
			actionLabel(d)
		]
			.filter(Boolean)
			.join(' ');
	}

	// Keep the original (grouped) order so group headers stay contiguous; just
	// filter. Substring and subsequence matches both survive.
	const filtered = $derived(destinations.filter((d) => score(destinationSearchText(d), query) > 0));

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
			// On a deep route the shell is hidden — navigate to the space path so
			// the switch is actually visible. On a space path, OrgShell's shallow
			// routing updates the URL without a remount.
			if (!isSpacePath($page.url.pathname, base)) goto(pathForSpace(d.spaceId, base));
		}
	}

	function itemAria(d: SpotlightDestination): string {
		const parts = [d.label];
		if (d.state) parts.push(`state ${stateLabel(d.state)}`);
		parts.push(`handoff ${handoffLabel(d)}`);
		const effect = effectLabel(d);
		if (effect) parts.push(`effect ${effect}`);
		if (d.signal) parts.push(`signal ${d.signal}`);
		if (d.gate) parts.push(`gate ${d.gate}`);
		parts.push(`action ${actionLabel(d)}`);
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
			aria-label="Spotlight — search capabilities, workspaces, or handoffs"
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
				placeholder="Search capabilities, workspaces, handoffs…"
				aria-label="Capability command search"
			/>

			{#if filtered.length === 0}
				<p class="sp-empty">No match. <kbd class="sp-kbd">Esc</kbd> to close.</p>
			{:else}
				<ul
					id="sp-list"
					class="sp-list"
					role="listbox"
					aria-label="Capabilities, workspaces, and handoffs"
				>
					{#each filtered as d, i (d.id)}
						{@const handoff = handoffLabel(d)}
						{@const effect = effectLabel(d)}
						{#if i === 0 || filtered[i - 1].group !== d.group}
							<li class="sp-group" aria-hidden="true">{d.group}</li>
						{/if}
						<li role="option" aria-selected={i === selected}>
							<!-- svelte-ignore a11y_mouse_events_have_key_events -->
							<button
								type="button"
								class="sp-item"
								class:sp-item--sel={i === selected}
								data-state={d.state}
								aria-label={itemAria(d)}
								onmouseenter={() => (selected = i)}
								onclick={() => execute(d)}
							>
								<span class="sp-item-main">
									<span class="sp-line">
										<span class="sp-label">{d.label}</span>
										{#if d.state}
											<span class="sp-state" data-state={d.state}>{stateLabel(d.state)}</span>
										{/if}
										{#if d.latent}<span class="sp-latent">not yet armed</span>{/if}
									</span>
									<span class="sp-meta">
										{#if d.sublabel}<span class="sp-sublabel">{d.sublabel}</span>{/if}
										<span class="sp-meta-field sp-handoff">
											<span class="sp-meta-label">handoff</span>
											<span>{handoff}</span>
										</span>
										{#if effect}
											<span class="sp-meta-field sp-effect">
												<span class="sp-meta-label">effect</span>
												<span>{effect}</span>
											</span>
										{/if}
										{#if d.signal}
											<span class="sp-meta-field sp-signal">
												<span class="sp-meta-label">signal</span>
												<span>{d.signal}</span>
											</span>
										{/if}
										{#if d.gate}
											<span class="sp-meta-field sp-gate">
												<span class="sp-meta-label">gate</span>
												<span>{d.gate}</span>
											</span>
										{/if}
									</span>
								</span>
								<span class="sp-kind">{actionLabel(d)}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="sp-foot">
				<kbd class="sp-kbd">↑↓</kbd> move
				<kbd class="sp-kbd">↵</kbd> execute
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
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem;
		border: none;
		border-radius: 6px;
		border-left: 2px solid transparent;
		background: transparent;
		text-align: left;
		cursor: pointer;
		min-height: 3.375rem;
	}

	.sp-item--sel {
		background: var(--coord-node-bg, oklch(0.6 0.14 175 / 0.1));
	}
	.sp-item[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.sp-item[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.sp-item[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		border-left-style: dashed;
	}
	.sp-item[data-state='gated'],
	.sp-item[data-state='testnet'] {
		border-left-color: oklch(0.62 0.02 60);
		border-left-style: dashed;
	}

	.sp-item-main {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.sp-line,
	.sp-meta {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}
	.sp-line {
		flex-wrap: wrap;
	}
	.sp-meta {
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
	}

	.sp-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-primary);
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.sp-sublabel,
	.sp-meta-field {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		overflow-wrap: anywhere;
	}
	.sp-meta-field {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		min-width: 0;
		max-width: 100%;
	}
	.sp-handoff {
		color: var(--text-secondary, oklch(0.4 0.012 60));
	}
	.sp-effect {
		color: oklch(0.42 0.018 175);
	}
	.sp-gate {
		color: oklch(0.48 0.012 60);
	}
	.sp-meta-label {
		flex: 0 0 auto;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		opacity: 0.78;
	}
	.sp-meta-field span:last-child {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.sp-state,
	.sp-latent {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-tertiary);
		opacity: 0.8;
	}
	.sp-state[data-state='live'] {
		color: var(--coord-verified, #10b981);
	}
	.sp-state[data-state='partial'] {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.sp-state[data-state='draft-only'] {
		color: oklch(0.62 0.12 78);
	}
	.sp-state[data-state='gated'],
	.sp-state[data-state='testnet'] {
		color: oklch(0.48 0.02 60);
	}

	.sp-kind {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.625rem;
		color: var(--text-tertiary);
		flex-shrink: 0;
		white-space: nowrap;
		align-self: start;
		padding-top: 0.125rem;
	}
	.sp-item--sel .sp-kind {
		color: var(--text-secondary);
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
