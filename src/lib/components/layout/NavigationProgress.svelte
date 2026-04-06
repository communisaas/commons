<script lang="ts">
	/**
	 * NavigationProgress
	 *
	 * Thin indigo bar at the top of the viewport during SvelteKit navigation.
	 * Provides immediate causal feedback — click → bar appears in <50ms.
	 *
	 * Uses CSS animation to simulate progress (fast start, slow crawl, snap to 100%).
	 * Driven by SvelteKit's `navigating` store — non-null while navigation is in flight.
	 */
	import { navigating } from '$app/stores';
</script>

{#if $navigating}
	<div class="nav-progress" aria-hidden="true">
		<div class="nav-progress-bar"></div>
	</div>
{/if}

<style>
	.nav-progress {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		z-index: 99999;
		pointer-events: none;
	}

	.nav-progress-bar {
		height: 100%;
		background: oklch(0.55 0.18 270); /* participation-primary-600 indigo */
		animation: nav-grow 8s cubic-bezier(0.1, 0.5, 0.1, 1) forwards;
		transform-origin: left;
		box-shadow: 0 0 8px oklch(0.55 0.18 270 / 0.4);
	}

	@keyframes nav-grow {
		0%   { width: 0%; }
		10%  { width: 30%; }   /* fast initial burst — causality */
		50%  { width: 65%; }   /* slow crawl */
		80%  { width: 85%; }   /* almost done */
		100% { width: 95%; }   /* never reaches 100 — completion is instantaneous page swap */
	}
</style>
