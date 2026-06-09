<!--
  CommandBar — the Spotlight trigger in the Mantle.

  Not the palette itself: the palette (Spotlight.svelte) is rendered ONCE at the
  shell level and reads the OS kernel's `spotlightOpen` flag, so a single ⌘K
  listener and a single palette serve every chrome. This button just raises it
  (orgOS.openSpotlight) — the rail and the mobile header each render one without
  fighting over a duplicate keybinding or a second backdrop.

  Motion: ease-out on the affordance hover (navigation-class, no spring).
-->
<script lang="ts">
	import { TIMING, EASING } from '$lib/design/motion';
	import { getOrgOS } from './os/orgOS.svelte';

	const os = getOrgOS();
</script>

<button
	type="button"
	class="cmdk-trigger"
	onclick={() => os.openSpotlight()}
	aria-haspopup="dialog"
	aria-expanded={os.spotlightOpen}
	aria-keyshortcuts="Meta+K Control+K"
	aria-label="Find capability"
	style="--timing-fast: {TIMING.FAST}ms; --easing: {EASING};"
>
	<span class="cmdk-trigger-label">Find capability</span>
	<kbd class="cmdk-kbd">⌘K</kbd>
</button>

<style>
	.cmdk-trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--org-sidebar-border);
		border-radius: 8px;
		background: transparent;
		color: var(--org-sidebar-text-dim);
		cursor: pointer;
		transition:
			color var(--timing-fast) var(--easing),
			border-color var(--timing-fast) var(--easing);
	}

	.cmdk-trigger:hover,
	.cmdk-trigger:focus-visible {
		color: var(--org-sidebar-text);
		border-color: var(--coord-route-solid);
		outline: none;
	}

	.cmdk-trigger-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
	}

	.cmdk-kbd {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.625rem;
		color: var(--org-sidebar-text-dim);
		border: 1px solid var(--org-sidebar-border);
		border-radius: 4px;
		padding: 0.0625rem 0.25rem;
		line-height: 1.2;
	}
</style>
