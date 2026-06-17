<!--
  OrgShell — the persistent OS frame that holds the four spaces MOUNTED.

  This is the structural core of the org-OS. The prior layout rendered
  `{@render children()}` in the main content area, so navigating between
  workspace routes unmounted the previous route component — tearing down any
  in-flight STUDIO authoring process. The design forbids that:

    "The spaces themselves stay MOUNTED; this only toggles which one is shown.
     Switching is instant and never tears down a space."

  OrgShell mounts ALL FOUR spaces as persistent DOM containers and toggles
  which one is visible via `display:none`, driven by `orgOS.activeSpace`. No
  space is ever unmounted on a switch, so:

    · the Studio authoring process (held in the OS registry, driven by the
      runner) keeps streaming while the operator is in People, Power, or Results;
    · returning to Studio shows the still-scrolling reasoning, not a fresh mount.

  The shell creates the OS instance (`setOrgOS`) and publishes it on context so
  the Mantle's WorkspaceSwitcher, the spaces, and any chrome read the same
  kernel. Switching is a pure state toggle (`orgOS.switchSpace`); the URL is
  updated via SHALLOW routing for addressability — never a navigation that would
  remount.

  Honesty: hidden spaces are display:none, NOT removed — their state (and the
  Studio process view) is real and preserved. People, Power, and Results render only
  REAL data threaded from the layout load (`spaces` prop), loaded ONCE per real
  navigation — a space switch never re-fetches. STUDIO streams only what its real
  SSE process emitted.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { replaceState, afterNavigate } from '$app/navigation';
	import { getOrgOS, spaceForPath, pathForSpace, SPACE_LABELS, type SpaceId } from './orgOS.svelte';
	import { spaceSwitchDirection } from './perceptual';
	import StudioSpace from './StudioSpace.svelte';
	import ReturnSpace from './ReturnSpace.svelte';
	import BaseSpace from './BaseSpace.svelte';
	import LandscapeSpace from './LandscapeSpace.svelte';
	import type { OrgSpacesData } from './spaces';

	let {
		base,
		canPublish,
		role,
		spaces
	}: {
		/** `/org/[slug]` — the addressable root for shallow URL updates. */
		base: string;
		/** Owner/editor can publish; members watch. Display gate for STUDIO Send. */
		canPublish: boolean;
		/** Exact membership role for owner-only authority readouts. */
		role: string;
		/** Per-space data loaded ONCE by the org layout. A space switch is a pure
		 * state toggle, so this is read from props — never re-fetched on switch. */
		spaces: OrgSpacesData;
	} = $props();

	// The OS kernel was created by the layout (setOrgOS) so the Mantle's
	// WorkspaceSwitcher and these spaces share one instance. We read it here.
	const os = getOrgOS();

	function show(space: SpaceId): boolean {
		return os.activeSpace === space;
	}

	// Directional hint for the cross-fade — +1 rightward in switcher order, −1 left,
	// 0 on first paint. prevSpace is non-reactive, but this re-derives on the
	// reactive activeSpace change (set AFTER prevSpace in switchSpace), so the read
	// is correct.
	const switchDir = $derived(spaceSwitchDirection(os.prevSpace, os.activeSpace));

	// ADDRESSABILITY — two directions, kept from fighting each other:
	//
	//  (1) space → URL: when the operator switches spaces (os.switchSpace, a pure
	//      state toggle with NO navigation), rewrite the URL via SHALLOW routing so
	//      a refresh/share lands on the same space. This is the ONLY writer of the
	//      URL here, and it never remounts a space.
	//
	//  (2) URL → space: only on a REAL navigation (a deep-route link, or browser
	//      back/forward) do we reconcile the active space to the URL. Using
	//      afterNavigate — not a reactive effect — means our own shallow URL
	//      rewrites in (1) do NOT trigger a space reconcile, so a deliberate switch
	//      is never reverted by a stale URL read.
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	// (1) space → URL. Guarded so we only rewrite when the URL's owning space
	// actually differs from the active space (spaceForPath collapses deep routes
	// into one space, so e.g. /campaigns must not be clobbered back to /studio).
	$effect(() => {
		if (!mounted) return;
		// Depend ONLY on activeSpace. The current path is read NON-reactively from
		// window.location — NOT from the $page store — on purpose: reading the page
		// store here makes the effect re-run on the very replaceState it performs,
		// an infinite read-write loop (effect_update_depth_exceeded). This effect
		// must fire on a SPACE SWITCH, never on a URL change.
		const space = os.activeSpace;
		const current = window.location.pathname;
		if (spaceForPath(current, base) !== space) {
			try {
				replaceState(pathForSpace(space, base), {});
			} catch {
				// replaceState throws if the router isn't ready; the state toggle
				// already happened, so only addressability is affected and self-heals.
			}
		}
	});

	// (2) URL → space, on real navigations only.
	afterNavigate(async ({ to }) => {
		const pathname = to?.url.pathname ?? window.location.pathname;
		const fromUrl = spaceForPath(pathname, base);
		if (fromUrl !== os.activeSpace) {
			os.switchSpace(fromUrl);
			// Let the space-toggle settle before the next paint; avoids a flash of
			// the prior space when a deep-route navigation lands on a space path.
			await tick();
		}
	});

	// (3) Per-space scroll RESTORE. The outgoing space's offset is captured
	// synchronously inside os.switchSpace (pre-reflow, before it leaves flow); here
	// we only restore the INCOMING space's remembered offset after it lays out
	// (rAF). Scroll is at the document ROOT (window) — NOT main.scrollTop; there is
	// no inner scrollport, so main.scrollTop would silently restore to top. This
	// effect's only reactive dep is activeSpace; it writes no rune the URL effect
	// reads, so it cannot re-enter effect (1).
	let lastScrollSpace: SpaceId = os.activeSpace;
	$effect(() => {
		const space = os.activeSpace;
		if (!browser || space === lastScrollSpace) return;
		lastScrollSpace = space;
		const target = os.getScroll(space);
		// 'auto', never 'smooth' — a restore must be instant. Clamp to the new
		// content's max so a stale offset into now-shorter content can't jump past.
		requestAnimationFrame(() => {
			const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
			window.scrollTo({ top: Math.min(target, max), behavior: 'auto' });
		});
	});
</script>

<!--
  All four spaces are mounted at once. The inactive spaces are kept in the DOM via
  `visibility:hidden` + `opacity:0` (NEVER `display:none`) and lifted out of normal
  flow (`position:absolute`) so the ACTIVE space alone defines the document scroll
  height. Their DOM and component state are preserved — the multitasking ground:
  the Studio process view streams alive behind People, Power, and Results, and a
  switch cross-fades (140ms) rather than hard-cutting. Reduced-motion → instant.
-->
<div class="org-spaces" style="--switch-dir: {switchDir};">
	<div
		class="org-space"
		data-active={show('studio')}
		aria-hidden={!show('studio')}
		aria-label="{SPACE_LABELS.studio} workspace"
	>
		<StudioSpace {canPublish} {spaces} />
	</div>

	<div
		class="org-space"
		data-active={show('base')}
		aria-hidden={!show('base')}
		aria-label="{SPACE_LABELS.base} workspace"
	>
		<BaseSpace data={spaces.base} {base} />
	</div>

	<div
		class="org-space"
		data-active={show('landscape')}
		aria-hidden={!show('landscape')}
		aria-label="{SPACE_LABELS.landscape} workspace"
	>
		<LandscapeSpace data={spaces.landscape} {base} />
	</div>

	<div
		class="org-space"
		data-active={show('return')}
		aria-hidden={!show('return')}
		aria-label="{SPACE_LABELS.return} workspace"
	>
		<ReturnSpace data={spaces.return} {base} />
	</div>
</div>

<style>
	.org-spaces {
		position: relative;
		width: 100%;
	}

	.org-space {
		width: 100%;
		min-width: 0;
	}

	/* Inactive spaces leave normal flow (so the ACTIVE space alone sizes the scroll
	   height — no tallest-of-four inflation) but keep their DOM + state via
	   visibility:hidden, NOT display:none — the Studio stream is never stranded.
	   The `visibility 0s 140ms` delay fades opacity out FIRST, then leaves the a11y
	   tree. */
	.org-space:not([data-active='true']) {
		position: absolute;
		inset: 0 0 auto 0;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transform: translateX(calc(var(--switch-dir, 0) * 8px));
		transition:
			opacity 140ms var(--header-easing),
			transform 140ms var(--header-easing),
			visibility 0s linear 140ms;
	}

	.org-space[data-active='true'] {
		position: relative;
		opacity: 1;
		transform: none;
		transition:
			opacity 140ms var(--header-easing),
			transform 140ms var(--header-easing);
	}

	/* a11y hard gate — instant swap, no fade/translate. MUST match the per-state
	   selectors' (0,2,0) specificity: a bare `.org-space` (0,1,0) is OUTRANKED by
	   `.org-space[data-active='true']` / `:not([data-active='true'])`, so the
	   override would silently lose and motion would still run under reduced-motion. */
	@media (prefers-reduced-motion: reduce) {
		.org-space:not([data-active='true']),
		.org-space[data-active='true'] {
			transition: none;
			transform: none;
		}
	}
</style>
