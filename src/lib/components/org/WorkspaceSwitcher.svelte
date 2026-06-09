<!--
  WorkspaceSwitcher — the four space-marks of the Mantle dock.

  NOT a link cabinet. Four spaces, each a compact mark that SWITCHES the mounted
  space instantly (orgOS.switchSpace) — no route navigation, no splayed list of
  sub-links in the rail. The routes that fold under a space are reachable through
  Spotlight (Cmd/Ctrl-K), not a vertical cabinet. Killing that splay is the whole
  point: a dock of spaces reads as an OS; a tree of links reads as a dashboard.

  aria-current marks the active space, read from the OS kernel (not the URL) so a
  switch lights the right mark instantly. Navigation motion is ease-out; spring is
  reserved for coordination signals.

  Switching: clicking a mark calls os.switchSpace(id) — an instant state toggle,
  no remount, so an in-flight STUDIO process keeps streaming. The mark keeps its
  href for addressability / open-in-new-tab. When the operator is on a DEEP route
  (a page the OS hasn't absorbed, where the shell is hidden), a click navigates to
  the space path so the switch is visible; on a space path, OrgShell's shallow
  routing handles the URL.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { FileCheck, Landmark, PenLine, UsersRound } from '@lucide/svelte';
	import { Datum } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import { getOrgOS, isSpacePath, type SpaceId } from './os/orgOS.svelte';

	export interface SecondaryLink {
		href: string;
		label: string;
		/** Compact capability state for Spotlight route handoffs. */
		state?: WorkspaceCapabilityState;
		/** Short qualifier shown in Spotlight after the label. */
		sublabel?: string;
		/** One real signal or explicit boundary. */
		signal?: string;
		/** What Enter does, in route/capability language. */
		action?: string;
		/** Operational object this folded route hands off to in Spotlight. */
		handoff?: string;
		/** Route effect after execution, kept weaker than any unarmed capability claim. */
		effect?: string;
		/** Gate or boundary that keeps the route honest. */
		gate?: string;
		/** Latent / not-yet-armed verbs — surfaced in Spotlight, dimmed, never hidden. */
		latent?: boolean;
	}

	export type WorkspaceCapabilityState = 'live' | 'partial' | 'draft-only' | 'gated';

	export interface WorkspaceSignal {
		label: string;
		value: string;
		datum?: number | null;
		cite?: string;
	}

	export interface WorkspaceMark {
		/** Stable OS route/state id. Public copy and icon vocabulary stay capability-first. */
		id: 'studio' | 'base' | 'landscape' | 'return';
		label: string;
		/** One-word verb-noun gloss in Satoshi — what this space IS. */
		gloss: string;
		/** Primary destination — an existing route, for addressability / no-JS. */
		href: string;
		icon: 'studio' | 'people' | 'power' | 'results';
		/** Capability state derived from real loaded slices and feature gates. */
		state: WorkspaceCapabilityState;
		/** One compact, auditable readout for the space. */
		signal: WorkspaceSignal;
		/** Primary handoff surface exposed by the mark itself. */
		handoff?: string;
		/** Route effect after switching; weaker than any unarmed execution claim. */
		effect?: string;
		/** Operator action, rendered through state-aware action grammar. */
		action?: string;
		/** Full boundary or gate evidence, preserved in aria/title. */
		gate?: string;
		/** Compact visible unlock/boundary signal. */
		gateSignal?: string;
		/** Routes that fold under this space. Not rendered here — they live in
		 * Spotlight. Kept on the mark so the layout can build the Spotlight index. */
		secondary?: SecondaryLink[];
	}

	let {
		marks,
		base,
		orientation = 'vertical'
	}: {
		marks: WorkspaceMark[];
		base: string;
		orientation?: 'vertical' | 'horizontal';
	} = $props();

	const os = getOrgOS();

	// Active space comes from the OS kernel (single source of truth), not the URL,
	// so a switch lights the right mark before any shallow-route settles.
	function isActive(mark: WorkspaceMark): boolean {
		return os.activeSpace === (mark.id as SpaceId);
	}

	function markAria(mark: WorkspaceMark): string {
		const signal =
			mark.signal.datum !== undefined && mark.signal.datum !== null
				? `${mark.signal.datum.toLocaleString('en-US')} ${mark.signal.label}`
				: `${mark.signal.value} ${mark.signal.label}`;
		return `${mark.label}: ${mark.gloss}. ${operatorCapabilityStateLabel(mark.state)}. ${signal}.`;
	}

	function markActionLabel(mark: WorkspaceMark): string {
		return operatorCapabilityActionLabel(mark.state, mark.action ?? `open ${mark.label}`, {
			appendReadyArrow: true
		});
	}

	function markContractTitle(mark: WorkspaceMark): string {
		return [
			`Handoff: ${mark.handoff ?? mark.label}`,
			`Effect: ${mark.effect ?? mark.gloss}`,
			`Action: ${markActionLabel(mark)}`,
			`Next unlock: ${mark.gate ?? mark.gateSignal ?? 'No unresolved visible workspace gate.'}`
		].join('. ');
	}

	function markContractAria(mark: WorkspaceMark): string {
		return `${markAria(mark)} Handoff: ${mark.handoff ?? mark.label}. Effect: ${
			mark.effect ?? mark.gloss
		}. Action: ${markActionLabel(mark)}. Next unlock: ${
			mark.gate ?? mark.gateSignal ?? 'No unresolved visible workspace gate.'
		}`;
	}

	/** Instant OS switch. Intercepts the mark's navigation on a space path; on a
	 * deep route (shell hidden) it navigates to the space path so the switch shows. */
	function onMarkClick(e: MouseEvent, mark: WorkspaceMark) {
		// Honor modifier / middle clicks — let the browser open the route normally.
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
		e.preventDefault();
		os.switchSpace(mark.id as SpaceId);
		if (!isSpacePath($page.url.pathname, base)) goto(mark.href);
	}
</script>

<nav
	class="ws ws--{orientation}"
	aria-label="Studio, People, Power, Results capability rail"
	style="--timing-normal: {TIMING.NORMAL}ms; --easing: {EASING};"
>
	{#each marks as mark (mark.id)}
		{@const active = isActive(mark)}
		<a
			href={mark.href}
			class="ws-mark"
			class:ws-mark--active={active}
			data-state={mark.state}
			aria-current={active ? 'page' : undefined}
			aria-label={markContractAria(mark)}
			data-sveltekit-preload-data="off"
			onclick={(e) => onMarkClick(e, mark)}
		>
			<span class="ws-icon" aria-hidden="true">
				{#if mark.icon === 'studio'}
					<PenLine size={18} strokeWidth={1.8} />
				{:else if mark.icon === 'people'}
					<UsersRound size={18} strokeWidth={1.8} />
				{:else if mark.icon === 'power'}
					<Landmark size={18} strokeWidth={1.8} />
				{:else if mark.icon === 'results'}
					<FileCheck size={18} strokeWidth={1.8} />
				{/if}
			</span>
			<span class="ws-body">
				<span class="ws-text">
					<span class="ws-title">
						<span class="ws-label">{mark.label}</span>
						<span class="ws-state ws-state--{mark.state}">
							<span class="ws-state-dot" aria-hidden="true"></span>
							<span class="ws-state-label">{operatorCapabilityStateLabel(mark.state)}</span>
						</span>
					</span>
					<span class="ws-gloss">{mark.gloss}</span>
				</span>
				<span class="ws-signal" title={mark.signal.cite}>
					<span class="ws-signal-value">
						{#if mark.signal.datum !== undefined}
							<Datum value={mark.signal.datum} class="ws-signal-datum" />
						{:else}
							{mark.signal.value}
						{/if}
					</span>
					<span class="ws-signal-label">{mark.signal.label}</span>
				</span>
				<span class="ws-contract" title={markContractTitle(mark)} aria-hidden="true">
					<span class="ws-contract-axis">
						<span class="ws-contract-kicker">handoff</span>
						<span class="ws-contract-kicker">effect</span>
						<span class="ws-contract-kicker">action</span>
						<span class="ws-contract-kicker">next</span>
					</span>
					<span class="ws-contract-values">
						<span class="ws-contract-value">{mark.handoff ?? mark.label}</span>
						<span class="ws-contract-value">{mark.effect ?? mark.gloss}</span>
						<span class="ws-contract-value ws-contract-value--action">{markActionLabel(mark)}</span>
						<span class="ws-contract-value ws-contract-value--next"
							>{mark.gateSignal ?? mark.gate ?? 'no open gate'}</span
						>
					</span>
				</span>
			</span>
		</a>
	{/each}
</nav>

<style>
	.ws {
		display: flex;
	}

	.ws--vertical {
		flex-direction: column;
		gap: 0.125rem;
	}

	.ws--horizontal {
		flex-direction: row;
		gap: 0.5rem;
		overflow-x: auto;
		scrollbar-width: none;
		padding-bottom: 0.125rem;
	}
	.ws--horizontal::-webkit-scrollbar {
		display: none;
	}

	.ws--horizontal .ws-text {
		flex-direction: column;
		gap: 0.125rem;
	}

	.ws--horizontal .ws-title {
		justify-content: space-between;
		gap: 0.5rem;
	}

	.ws--horizontal .ws-mark {
		flex: 0 0 auto;
		min-width: min(18rem, calc(100vw - 2rem));
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--org-sidebar-border);
		border-left: 1px solid var(--org-sidebar-border);
		border-radius: 8px;
	}

	.ws--horizontal .ws-mark--active {
		border-color: var(--coord-route-solid);
		background-color: var(--org-sidebar-active);
	}

	.ws--horizontal .ws-body {
		grid-template-columns: minmax(0, 1fr);
		gap: 0.375rem;
	}

	.ws--horizontal .ws-gloss {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ws--horizontal .ws-signal {
		width: 100%;
		max-width: none;
		min-width: 0;
		flex-direction: row;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.375rem;
	}

	.ws--horizontal .ws-state-label {
		display: inline;
	}

	.ws-mark {
		display: grid;
		grid-template-columns: 1.125rem minmax(0, 1fr);
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		border-left: 2px solid transparent;
		color: var(--org-sidebar-text-muted);
		text-decoration: none;
		transition:
			color var(--timing-normal) var(--easing),
			background-color var(--timing-normal) var(--easing);
	}

	.ws-mark:hover,
	.ws-mark:focus-visible {
		color: var(--org-sidebar-text);
		background-color: var(--org-sidebar-hover);
		outline: none;
	}

	.ws-mark--active {
		color: var(--org-sidebar-text);
		background-color: var(--org-sidebar-active);
		border-left-color: var(--coord-route-solid);
	}

	.ws-mark--active[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}

	.ws-mark--active[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}

	.ws-mark--active[data-state='draft-only'],
	.ws-mark--active[data-state='gated'] {
		border-left-style: dashed;
	}

	.ws-mark--active[data-state='draft-only'] {
		border-left-color: oklch(0.72 0.14 65);
	}

	.ws-mark--active[data-state='gated'] {
		border-left-color: oklch(0.56 0.1 25);
	}

	.ws-icon {
		flex-shrink: 0;
		width: 1.125rem;
		height: 1.125rem;
	}
	.ws-icon :global(svg) {
		width: 100%;
		height: 100%;
	}

	.ws-body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.625rem;
		min-width: 0;
	}

	.ws-text {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
	}

	.ws-title {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
	}

	.ws-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		line-height: 1.1;
	}

	.ws-state {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		line-height: 1;
		color: var(--org-sidebar-text-dim);
	}

	.ws-state-dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 3px;
		background: currentColor;
		box-shadow: 0 0 0 1px oklch(1 0 0 / 0.08);
	}

	.ws-state--live {
		color: var(--coord-verified, #10b981);
	}

	.ws-state--partial {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.ws-state--draft-only {
		color: oklch(0.72 0.14 65);
	}

	.ws-state--gated {
		color: oklch(0.56 0.1 25);
	}

	.ws-gloss {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--org-sidebar-text-dim);
		line-height: 1.2;
	}

	.ws-signal {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.0625rem;
		min-width: 2.75rem;
		max-width: 4.25rem;
		color: var(--org-sidebar-text-muted);
	}

	.ws-signal-value {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1;
		white-space: nowrap;
		color: var(--org-sidebar-text);
	}

	.ws-signal-datum {
		color: inherit;
	}

	.ws-signal-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.5625rem;
		line-height: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
		color: var(--org-sidebar-text-dim);
	}

	.ws-contract {
		grid-column: 1 / -1;
		display: grid;
		gap: 0.1875rem;
		min-width: 0;
		padding-top: 0.375rem;
		border-top: 1px solid var(--org-sidebar-border);
	}

	.ws-mark[data-state='draft-only'] .ws-contract,
	.ws-mark[data-state='gated'] .ws-contract {
		border-top-style: dashed;
	}

	.ws-contract-axis,
	.ws-contract-values {
		display: grid;
		grid-template-columns: 0.95fr 1.15fr 1.15fr 0.95fr;
		gap: 0.375rem;
		min-width: 0;
	}

	.ws-contract-kicker {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		line-height: 1;
		text-transform: uppercase;
		color: var(--org-sidebar-text-muted);
	}

	.ws-contract-value {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.625rem;
		line-height: 1.15;
		color: var(--org-sidebar-text-dim);
	}

	.ws-contract-value--action {
		color: var(--org-sidebar-text);
		font-weight: 600;
	}

	.ws-contract-value--next {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		color: var(--org-sidebar-text-muted);
	}

	.ws-mark[data-state='live'] .ws-contract-value--next {
		color: var(--coord-verified, #10b981);
	}

	.ws-mark[data-state='partial'] .ws-contract-value--next {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.ws-mark[data-state='draft-only'] .ws-contract-value--action,
	.ws-mark[data-state='draft-only'] .ws-contract-value--next {
		color: oklch(0.72 0.14 65);
	}

	.ws-mark[data-state='gated'] .ws-contract-value--action,
	.ws-mark[data-state='gated'] .ws-contract-value--next {
		color: oklch(0.56 0.1 25);
	}
</style>
