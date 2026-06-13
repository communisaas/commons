<!--
  WorkspaceSwitcher — the four space-marks of the Mantle dock.

  NOT a link cabinet. Four spaces, each a compact mark that SWITCHES the mounted
  space instantly (orgOS.switchSpace) — no route navigation, no splayed list of
  sub-links in the rail. The routes that fold under a space are reachable through
  Spotlight (Cmd/Ctrl-K), not a vertical cabinet. Killing that splay is the whole
  point: a dock of spaces reads as an OS; a tree of links reads as a dashboard.

  Each mark is plain navigation: a label and at most one count badge read from
  real loaded data. A null count renders NO badge — per the spaces contract,
  null means the slice is unread, and a fabricated zero would claim a reading
  that never happened. The Studio mark is the exception: its badge is the OS
  kernel's live count of running authoring processes, and it pulses while one
  is running — work-in-flight stays visible from every space.

  aria-current marks the active space, read from the OS kernel (not the URL) so a
  switch lights the right mark instantly. Navigation motion is ease-out; spring is
  reserved for coordination signals.

  Switching: clicking a mark calls os.switchSpace(id) — an instant state toggle,
  no remount, so an in-flight STUDIO process keeps streaming. The mark keeps its
  href for addressability / open-in-new-tab. When the current URL does not render
  a mounted space (a deep route, or a space path opted out via ?view=full), a
  click navigates to the space path so the switch is visible.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { FileCheck, Landmark, PenLine, UsersRound } from '@lucide/svelte';
	import { TIMING, EASING } from '$lib/design/motion';
	import { getOrgOS, rendersSpaceForUrl, type SpaceId } from './os/orgOS.svelte';

	/** A route folded under a space. Not rendered in the rail — Spotlight
	 * carries it. Kept on the mark so the layout can build the Spotlight index. */
	export interface SecondaryLink {
		href: string;
		label: string;
		/** Real loaded count, when the destination carries one. Null = unread. */
		count?: number | null;
		/** One plain-language limit sentence, for a bounded action. */
		note?: string;
	}

	export interface WorkspaceMark {
		/** Stable OS space id — routing state and the device-local process
		 * ledger key derive from it, so it never churns with display copy. */
		id: SpaceId;
		label: string;
		/** Primary destination — an existing route, for addressability / no-JS. */
		href: string;
		/** Real loaded count for the space. Null/absent = unread slice, no badge. */
		count?: number | null;
		/** Routes that fold under this space; rendered in Spotlight, not here. */
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
		return os.activeSpace === mark.id;
	}

	// The Studio mark reads the kernel directly: its badge is the live count of
	// running authoring processes, so work-in-flight shows from any space.
	const runningCount = $derived(os.runningProcesses.length);

	function badgeFor(mark: WorkspaceMark): number | null {
		if (mark.id === 'studio') return runningCount > 0 ? runningCount : null;
		return mark.count ?? null;
	}

	/** Instant OS switch. Intercepts the mark's navigation when a mounted space
	 * is rendering; anywhere the shell is NOT rendering — a deep route, or a
	 * space path under the ?view=full opt-out — it navigates to the space path
	 * so the switch is visible. */
	function onMarkClick(e: MouseEvent, mark: WorkspaceMark) {
		// Honor modifier / middle clicks — let the browser open the route normally.
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
		e.preventDefault();
		os.switchSpace(mark.id);
		if (!rendersSpaceForUrl($page.url, base)) goto(mark.href);
	}
</script>

<nav
	class="ws ws--{orientation}"
	aria-label="Workspaces"
	style="--timing-normal: {TIMING.NORMAL}ms; --easing: {EASING};"
>
	{#each marks as mark (mark.id)}
		{@const active = isActive(mark)}
		{@const count = badgeFor(mark)}
		{@const alive = mark.id === 'studio' && runningCount > 0}
		<a
			href={mark.href}
			class="ws-mark"
			class:ws-mark--active={active}
			class:ws-mark--alive={alive}
			aria-current={active ? 'page' : undefined}
			aria-label={alive
				? `${mark.label}, ${runningCount} running ${runningCount === 1 ? 'process' : 'processes'}`
				: undefined}
			data-sveltekit-preload-data="off"
			onclick={(e) => onMarkClick(e, mark)}
		>
			<span class="ws-icon" aria-hidden="true">
				{#if mark.id === 'studio'}
					<PenLine size={18} strokeWidth={1.8} />
				{:else if mark.id === 'base'}
					<UsersRound size={18} strokeWidth={1.8} />
				{:else if mark.id === 'landscape'}
					<Landmark size={18} strokeWidth={1.8} />
				{:else}
					<FileCheck size={18} strokeWidth={1.8} />
				{/if}
			</span>
			<span class="ws-label">{mark.label}</span>
			{#if count !== null}
				<span class="ws-count" class:ws-count--alive={alive}>
					{count.toLocaleString('en-US')}
				</span>
			{/if}
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
		gap: 0.375rem;
		overflow-x: auto;
		scrollbar-width: none;
		padding-bottom: 0.125rem;
	}
	.ws--horizontal::-webkit-scrollbar {
		display: none;
	}

	.ws--horizontal .ws-mark {
		flex: 0 0 auto;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--org-sidebar-border);
		border-left: 1px solid var(--org-sidebar-border);
		border-radius: 8px;
	}

	.ws--horizontal .ws-mark--active {
		border-color: var(--coord-route-solid);
		background-color: var(--org-sidebar-active);
	}

	.ws-mark {
		display: flex;
		align-items: center;
		gap: 0.625rem;
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

	.ws-icon {
		flex-shrink: 0;
		width: 1.125rem;
		height: 1.125rem;
	}
	.ws-icon :global(svg) {
		width: 100%;
		height: 100%;
	}

	.ws-label {
		flex: 1 1 auto;
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		line-height: 1.1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ws-count {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1;
		white-space: nowrap;
		padding: 0.1875rem 0.375rem;
		border-radius: 999px;
		color: var(--org-sidebar-text);
		background: oklch(1 0 0 / 0.07);
	}

	/* The alive badge: a running authoring process. Soft opacity pulse only —
	   spring stays reserved for coordination signals. */
	.ws-count--alive {
		color: var(--org-sidebar-bg);
		background: var(--coord-verified, #10b981);
		animation: ws-alive 2s var(--easing) infinite;
	}

	.ws-mark--alive {
		color: var(--org-sidebar-text);
	}

	@keyframes ws-alive {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ws-count--alive {
			animation: none;
		}
	}
</style>
