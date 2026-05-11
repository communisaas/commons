<!--
  Public-record route layout.

  Reading-room register. The public record is a faithful presentation of
  canonical markdown sources; the route renders as a bare document on a
  plain-white ground plane, with no global app chrome (no header, no footer,
  no warm-cream gradient).

  The root +layout.svelte gates this subtree alongside /embed and /c so the
  global header, footer, error boundary wrapper, and warm gradient are not
  composed. This file additionally overrides the <html> background-image
  gradient that app.css applies as the perceptual foundation, replacing it
  with #ffffff for the duration of the route.
-->
<script lang="ts">
	import '../../app.css';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}

<style>
	/*
	 * Suppress the warm-cream gradient that app.css applies to <html>.
	 * The public record is a document, not an inhabited surface — its
	 * ground plane is plain paper-white. Scope is global so it overrides
	 * the @layer base rule in app.css.
	 *
	 * We also clear background-color on <html> and <body> to defeat the
	 * #fdfcfa fallback. The component's :global selectors lift to document
	 * scope and persist for the lifetime of this layout.
	 */
	:global(html) {
		background: #ffffff;
		background-color: #ffffff;
	}
	:global(body) {
		background: #ffffff;
		background-color: #ffffff;
	}
</style>
