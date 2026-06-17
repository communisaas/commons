<script lang="ts">
	/**
	 * DescentDive — the one Artifact-over-scrim descent.
	 *
	 * Selecting a template anywhere on the landing — a spectrum tile, a relation-map
	 * node — is falling into it. This is the single implementation of that fall: the
	 * WHOLE page recedes behind one full-viewport backdrop scrim (blur + a faint warm
	 * dim) and the chosen template ascends into an Artifact — the one white bounded
	 * surface for a floated object — wrapping the page's own preview. Because the
	 * scrim is one fixed plane over everything, the field, the hero beside it, and the
	 * header above it recede together, as one — no half-sharp seam, one composited blur
	 * layer. Back / esc / a tap on the scrim reverses the fall: the Artifact settles
	 * away, the page returns to the EXACT state it left (scroll position, selection
	 * cleared), and focus lands back on the surface the dive rose from.
	 *
	 * It is deliberately not coupled to any one surface's state. Every caller —
	 * spectrum, graph — passes the same three things: the preview to mount (`dive`),
	 * whether the descent is `open`, and an `onClose` to report the climb-out. So there
	 * is exactly ONE descent vocabulary; the surfaces share it rather than each forking
	 * a modal. A surface that wants focus returned to its originating element on close
	 * names it with `restoreFocusSelector` (a CSS selector resolved against the
	 * document); without one, the dive simply releases focus.
	 *
	 * SSR-safe: the descent only exists on the client (the effect that opens it never
	 * runs under SSR), so the window/document reads need no environment guard.
	 */

	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import { Artifact } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';

	interface Props {
		/** The chosen template's preview, supplied by the page already wired to its
		 *  send flow / personalization / proof footer. Mounted inside the risen
		 *  Artifact unchanged — the descent is a mount and a transition around it,
		 *  never a fork. */
		dive: Snippet;
		/** Whether the descent is engaged. True → the page recedes and the preview
		 *  ascends; false → nothing renders and the page is at rest. */
		open: boolean;
		/** Called when the dive closes (esc, back, or a tap on the receded page behind
		 *  it). The caller clears its selection here so the page returns to its exact
		 *  prior state. Required for the descent to be reversible. */
		onClose: () => void;
		/** Optional CSS selector for the element the dive rose from (a tile, a node),
		 *  so focus returns there on close — the field comes back exactly where it
		 *  left. Absent → focus is simply released. */
		restoreFocusSelector?: string | null;
	}

	let { dive, open, onClose, restoreFocusSelector = null }: Props = $props();

	// The body scroll position captured as the dive opens, restored as it closes, so
	// the page comes back exactly where it was — the reversibility the descent
	// promises. The element focus was on (the originating tile/node) is restored too.
	let lockedScrollY = 0;
	let diveSurface = $state<HTMLElement | null>(null);
	let restoreSelector: string | null = null;

	function lockFieldScroll() {
		lockedScrollY = window.scrollY;
		document.body.style.position = 'fixed';
		document.body.style.top = `-${lockedScrollY}px`;
		document.body.style.left = '0';
		document.body.style.right = '0';
	}

	function unlockFieldScroll() {
		document.body.style.position = '';
		document.body.style.top = '';
		document.body.style.left = '';
		document.body.style.right = '';
		window.scrollTo(0, lockedScrollY);
	}

	// Open / close is driven by `open`. On open: remember the originating element's
	// selector, lock the page's scroll, move focus into the Artifact. On close:
	// restore the scroll and return focus to the originating element. Effects never
	// run under SSR and the dive only exists on the client, so the window/document
	// reads need no guard.
	$effect(() => {
		if (!open) return;
		restoreSelector = restoreFocusSelector;
		lockFieldScroll();
		// Focus the first focusable inside the risen Artifact once it has mounted.
		// `preventScroll` so moving focus never nudges the (fixed) body underneath.
		tick().then(() => {
			const first = diveSurface?.querySelector<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			(first ?? diveSurface)?.focus({ preventScroll: true });
		});
		return () => {
			unlockFieldScroll();
			// Return focus to the element the dive rose from, so the page knows where it
			// came back to. `preventScroll` is essential: a bare focus() scrolls that
			// element into view and would override the exact scroll position we just
			// restored — the page must come back where it left, not jump to the tile.
			const selector = restoreSelector;
			restoreSelector = null;
			tick().then(() => {
				if (!selector) return;
				document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
			});
		};
	});

	function closeDive() {
		onClose();
	}

	// Portal the descent layer to <body>. A surface sits inside its own page column,
	// which is a positioned, z-indexed stacking context, and the hero beside it sits
	// in a sticky higher-z column — so a scrim left in place would be capped at the
	// column's z-index and the hero would paint OVER it, leaving one half sharp.
	// Moving the layer to <body> lifts it to the document root, where its z-index
	// clears every page context and its backdrop-filter blurs the WHOLE page beneath
	// it as one. Mirrors the existing body-portal pattern (AnimatedPopover).
	// Client-only (actions never run under SSR), so the document reads need no guard.
	function portalToBody(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	// Esc reverses the dive. A keydown on the descent layer is enough — focus is
	// trapped inside it while diving, so the handler always sees the key.
	function handleDiveKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			closeDive();
			return;
		}
		if (event.key !== 'Tab') return;
		// Trap focus inside the Artifact: wrap from last → first and first → last so
		// tab never leaves the risen object for the receded field beneath it.
		const focusables = diveSurface?.querySelectorAll<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		if (!focusables || focusables.length === 0) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		const active = document.activeElement;
		if (event.shiftKey && active === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

{#if open}
	<!-- The descent: the chosen template, risen as an Artifact over the whole receded
	     page. A tap on the scrim, esc, or back reverses it. Focus is trapped inside
	     the Artifact while it is up and restored to the originating element on close.
	     The preview inside is the page's own — mounted here, never forked. -->
	<div class="dive-layer" role="presentation" onkeydown={handleDiveKeydown} use:portalToBody>
		<!-- The scrim recedes the whole page as one: a fixed full-viewport plane that
		     blurs and faintly dims everything painted behind it — the field, the hero
		     beside it, the header above it — so the dive reads as a fall away from the
		     entire page, not just one column. It is also the way back: a click anywhere
		     on it closes the dive. A button (not a div) so the keyboard reaches it. -->
		<button type="button" class="dive-scrim" aria-label="Back to the field" onclick={closeDive}
		></button>

		<div
			bind:this={diveSurface}
			class="dive-surface"
			role="dialog"
			aria-modal="true"
			aria-label="Template preview"
			tabindex="-1"
			style="--dive-ascent-ms: {TIMING.SLOW}ms; --dive-ascent-ease: {EASING};"
		>
			<Artifact padding="compact" class="dive-artifact">
				{@render dive()}
			</Artifact>
		</div>
	</div>
{/if}

<style>
	/*
	 * The descent layer — a full-viewport plane the risen Artifact floats in. It
	 * sits over the whole page; its scrim is the recede AND the way back.
	 */
	.dive-layer {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
	}

	/*
	 * The scrim recedes the whole page as one. A fixed full-viewport plane that
	 * blurs everything painted behind it (one composited backdrop-filter layer, not
	 * a blurred 300-node subtree) and lays a faint warm dim over it — the modal
	 * surface token (warm cream) at half alpha, never a hard black overlay. So the
	 * field, the hero beside it, and the header above it recede together, with no
	 * half-sharp seam. Clicking it reverses the dive. The blur is the expensive
	 * channel, so it is dropped under reduced motion (below); the dim stays.
	 */
	.dive-scrim {
		position: absolute;
		inset: 0;
		border: none;
		margin: 0;
		padding: 0;
		cursor: pointer;
		/* Fallback for engines without color-mix: the modal surface token at full
		   weight; the color-mix below takes it to half alpha where supported. */
		background: var(--surface-overlay, oklch(0.975 0.005 55));
		background: color-mix(in oklch, var(--surface-overlay, oklch(0.975 0.005 55)) 50%, transparent);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
	}

	/*
	 * The risen object. Bounded so the preview keeps its column rhythm, scrollable
	 * within when the preview is taller than the viewport, and raised above the
	 * backdrop. The white surface and border belong to the Artifact inside it.
	 */
	.dive-surface {
		position: relative;
		z-index: 1;
		width: 100%;
		max-width: 40rem;
		max-height: calc(100vh - 3rem);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		/* The ascent: the Artifact rises on system motion — SLOW (320ms) for the
		   weight of a surfacing object, with the standard EASING. Both come from
		   motion.ts via the inline custom properties above (TIMING.SLOW / EASING),
		   so this transition carries no off-token literal. */
		animation: dive-ascend var(--dive-ascent-ms) var(--dive-ascent-ease) both;
	}

	.dive-surface :global(.dive-artifact) {
		max-height: 100%;
		overflow-y: auto;
	}

	@keyframes dive-ascend {
		from {
			opacity: 0;
			transform: translateY(16px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	/*
	 * Reduced motion: no blur, no rise. The scrim keeps only its faint warm dim
	 * (cheap, non-vestibular) so the dive is still legibly set apart, and the
	 * Artifact appears at once — the descent is instant, not animated.
	 */
	@media (prefers-reduced-motion: reduce) {
		.dive-scrim {
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}

		.dive-surface {
			animation: none;
		}
	}
</style>
