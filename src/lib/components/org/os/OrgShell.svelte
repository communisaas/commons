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
	import { replaceState, afterNavigate } from '$app/navigation';
	import { getOrgOS, spaceForPath, pathForSpace, SPACE_LABELS, type SpaceId } from './orgOS.svelte';
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
</script>

<!--
  All four spaces are mounted at once. Visibility is toggled with `display:none`
  via [hidden]; the inactive space's DOM (and its component state) is preserved,
  never destroyed. This is the multitasking ground: the Studio process view
  stays alive behind People, Power, and Results.
-->
<div class="org-spaces">
	<div
		class="org-space"
		hidden={!show('studio')}
		aria-hidden={!show('studio')}
		aria-label="{SPACE_LABELS.studio} workspace"
	>
		<StudioSpace {canPublish} {spaces} />
	</div>

	<div
		class="org-space"
		hidden={!show('base')}
		aria-hidden={!show('base')}
		aria-label="{SPACE_LABELS.base} workspace"
	>
		<BaseSpace data={spaces.base} {base} />
	</div>

	<div
		class="org-space"
		hidden={!show('landscape')}
		aria-hidden={!show('landscape')}
		aria-label="{SPACE_LABELS.landscape} workspace"
	>
		<LandscapeSpace data={spaces.landscape} {base} />
	</div>

	<div
		class="org-space"
		hidden={!show('return')}
		aria-hidden={!show('return')}
		aria-label="{SPACE_LABELS.return} workspace"
	>
		<ReturnSpace data={spaces.return} {base} />
	</div>
</div>

<style>
	.org-spaces {
		width: 100%;
	}

	.org-space {
		width: 100%;
	}

	/* [hidden] is honored by the attribute; this hardens it against utility CSS
	   that might set display on descendants. The space is hidden, not unmounted. */
	.org-space[hidden] {
		display: none;
	}
</style>
