<script lang="ts">
	/**
	 * SpectrumLandscape — the topical field.
	 *
	 * The discovery surface that replaces the flat list: it groups the public
	 * templates by civic domain and lays the resulting neighbourhoods out in
	 * hue order, so the eye reads the whole collection — which issues are alive,
	 * where the spectrum runs warm to cool — at a glance, then dives into a
	 * single template beneath.
	 *
	 * What it orchestrates:
	 * - grouping: `groupByDomain` buckets templates by domain and orders the
	 *   bands along the domain-hue spectrum (the resolver supplies a stable hue
	 *   even before the embedding projection has run for every template).
	 * - the bands: each `DomainBand` is one neighbourhood — a hue spine, a
	 *   header with the band's shared rhythm, and its tiles.
	 * - selection + focus: this is the one place that knows a tile's flat index
	 *   across the whole field, so keyboard order and the preload-on-hover read
	 *   are owned here and threaded down. The bands and tiles stay pure.
	 *
	 * Every visual channel cites a real field — the hue order from the resolver,
	 * each band's count and aggregate rhythm from its templates, each tile's own
	 * dimensions from its substrate. Nothing is invented; at the zero-send seed
	 * the field is a structured topical space with no momentum primitives drawn.
	 *
	 * SSR-safe: grouping and hue resolution are pure (no wall-clock at module
	 * load, no browser globals), so the field renders identically on the server
	 * and the client.
	 */

	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import type { Template, TemplateGroup } from '$lib/types/template';
	import { groupByDomain, bandDomId } from '$lib/core/topic/domain-grouping';
	import { toPlaceBands } from '$lib/core/topic/place-bands';
	import { resolveDomainHue } from '$lib/utils/domain-hue';
	import DomainBand from './DomainBand.svelte';
	import LensToggle, { type Lens } from './LensToggle.svelte';
	import SpectrumOverview from './SpectrumOverview.svelte';
	import { Artifact, EntityCluster } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';

	interface Props {
		/** The public templates to lay out as a topical field. */
		templates: Template[];
		/** The same templates already grouped by geographic precision (the existing
		 *  `groupByPrecision` path, computed by the page). Drives the place lens; the
		 *  topic lens ignores it. Absent → the place lens falls back to one band. */
		placeGroups?: TemplateGroup[];
		/** The currently selected (diving) template id, threaded down to the tiles. */
		selectedId?: string | null;
		/** Called with the template id when a tile is activated. */
		onSelect: (id: string) => void;
		/** Pointer enter (true) / leave (false) on a tile, so the field can preload. */
		onHover?: (id: string, isHovering: boolean) => void;
		/** How many tiles a band shows before "more" reveals the rest. */
		initialVisible?: number;
		/** The dive: the chosen template's preview, supplied by the page already wired
		 *  to its send flow / personalization / proof footer. When present together with
		 *  a `selectedId`, the field recedes and this ascends into an Artifact over it.
		 *  The page passes `TemplatePreview` unchanged — the descent is a mount and a
		 *  transition around it, never a fork. Absent → no dive (the list-era split
		 *  view, where the preview lives in its own column). */
		dive?: Snippet;
		/** Called when the dive closes (esc, back, or the receded field behind it).
		 *  The page clears its selection here so the field returns to its exact prior
		 *  state. Required for the descent to be reversible. */
		onClose?: () => void;
	}

	let {
		templates,
		placeGroups = [],
		selectedId = null,
		onSelect,
		onHover,
		initialVisible = 6,
		dive,
		onClose
	}: Props = $props();

	// How the field is organised. Topic is the default lens (hue-ordered domain
	// bands); place re-organises the same templates by geographic precision while
	// hue keeps encoding topic. The choice persists across reloads in
	// sessionStorage so a return visit re-opens the lens last chosen, without a
	// server round-trip. SSR-safe: server renders the topic default, the client
	// reconciles to the stored choice on mount.
	const LENS_STORAGE_KEY = 'commons:landing-lens';
	let lens = $state<Lens>('topic');

	// `$effect` and the click handler below both run only on the client (effects
	// never fire during SSR, and a click cannot happen on the server), so reading
	// and writing `sessionStorage` here needs no environment guard.
	$effect(() => {
		const stored = sessionStorage.getItem(LENS_STORAGE_KEY);
		if (stored === 'place' || stored === 'topic') {
			lens = stored;
		}
	});

	function selectLens(next: Lens) {
		lens = next;
		sessionStorage.setItem(LENS_STORAGE_KEY, next);
	}

	// The clock the within-band recency weighting reads, captured ONCE per mount
	// rather than re-read on every regrouping. Pinning it makes the grouping a
	// pure function of the template array: the same templates always produce the
	// identical field, so a re-render triggered by unrelated state never reshuffles
	// the bands under the eye, and the work below is genuinely memoizable on the
	// array identity. `Date.now()` is not a browser global, so reading it here is
	// SSR-safe (server and client capture their own mount clock; the band ORDER is
	// hue-driven and clock-independent — only the within-band tie order can shift,
	// and it is stable within a session).
	const groupingClock = new Date();

	// The topic lens: group by civic domain and order the bands along the hue
	// spectrum. The hue resolver is injected so the grouper stays decoupled from
	// the embedding backfill — the band order is stable today, and sharpens as
	// `domainHue` fills in. This `$derived` IS the memoization: it recomputes only
	// when its tracked input — the `templates` array reference — changes, never on
	// an unrelated state change (a bloom, a lens flip, a band expanding). With the
	// clock pinned above, regrouping the same array is wasted only if the array
	// identity churns; the grouper itself is O(n log n) and measured well under the
	// frame budget even at a synthetic 200-template field. Deterministic and pure,
	// so it runs cleanly under SSR.
	const topicBands = $derived(groupByDomain(templates, { hueOf: resolveDomainHue, now: groupingClock }));

	// The place lens: the EXISTING geographic precision grouping (computed by the
	// page via `groupByPrecision`, reused unchanged), adapted into bands. Hue
	// stays domain-derived — each place band's spine is its lead template's
	// domain hue, never a colour invented to encode place.
	const placeBands = $derived(toPlaceBands(placeGroups, { hueOf: resolveDomainHue }));

	// The bands the field renders, by lens. Each carries a stable `key` (the band
	// name) for the keyed `#each`, and the place lens stamps a `placeLabel` so the
	// tiles surface a place chip; the topic lens leaves it null.
	const bands = $derived(
		lens === 'place'
			? placeBands.map((b) => ({ ...b, key: b.domain, placeLabel: b.place }))
			: topicBands.map((b) => ({ ...b, key: b.domain, placeLabel: null as string | null }))
	);

	// Each band starts at a flat index equal to the running tile total before it,
	// so keyboard order reads continuously down the whole field rather than
	// restarting per band. Computed alongside the bands so the offsets never
	// drift from the order the resolver produced.
	const indexOffsets = $derived.by(() => {
		const offsets: number[] = [];
		let running = 0;
		for (const band of bands) {
			offsets.push(running);
			running += band.templates.length;
		}
		return offsets;
	});

	// The flat order the field presents, for arrow / tab focus movement across
	// band boundaries. Built from the same band order so it can never disagree
	// with what is rendered.
	const flatTemplates = $derived(bands.flatMap((band) => band.templates));

	// ─── Tap-to-focus: the overview map jumps the field to a band ─────────────
	//
	// Tapping a segment in the sticky overview is a wayfinding gesture — "take me
	// there". The field travels to the matching band (a deliberate, SLOW scroll)
	// and the band's spine blooms for one beat to confirm arrival. The bloom lives
	// on the band; this orchestrator only names which band is blooming, because it
	// is the one place that sees the whole field at once.
	//
	// reduced-motion: the jump is instant (`auto`) and NO bloom is set, so the
	// surface never animates for a vestibular-sensitive reader — but the scroll
	// still offsets for the sticky overview, so the heading lands clear of the map
	// in both modes, not tucked beneath it. SSR-safe: the handler only runs on the
	// client (a tap cannot happen on the server), so the `window` / `document`
	// reads below need no environment guard.

	// Which band is blooming right now (its domain), or null at rest. Threaded down
	// so exactly one band flares per jump.
	let bloomingDomain = $state<string | null>(null);
	let bloomTimer: ReturnType<typeof setTimeout> | null = null;

	function prefersReducedMotion(): boolean {
		return (
			typeof window !== 'undefined' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		);
	}

	/**
	 * Jump the field to a band and bloom its spine. Called by the overview when a
	 * segment is activated (click or Enter/Space). The scroll lands the band below
	 * the sticky overview by offsetting for its height, so the heading is never
	 * tucked under the map. Press feedback is the segment's own :active styling
	 * (instant, <100ms); this is the consequent travel + arrival flare.
	 */
	function focusBand(domain: string) {
		const reduced = prefersReducedMotion();
		const target = document.getElementById(bandDomId(domain));
		if (target) {
			// Both motion modes offset the scroll by the sticky overview's height so
			// the band heading clears the map rather than landing beneath it. The only
			// difference is the travel: smooth for a default reader, instant (`auto`)
			// for a vestibular-sensitive one. A bare `scrollIntoView` ignores the
			// sticky bar and would tuck the heading under it, so we compute the offset
			// scroll position explicitly in both branches.
			const overview = document.querySelector<HTMLElement>('.spectrum-overview');
			const offset = overview ? overview.getBoundingClientRect().height : 0;
			const top = target.getBoundingClientRect().top + window.scrollY - offset - 8;
			window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
		}

		// No bloom under reduced-motion — the band stays at rest weight.
		if (reduced) return;

		// Flare the destination band, then let it settle. Re-tapping retargets the
		// bloom cleanly (clear the prior timer first).
		if (bloomTimer) clearTimeout(bloomTimer);
		bloomingDomain = domain;
		bloomTimer = setTimeout(() => {
			bloomingDomain = null;
			bloomTimer = null;
		}, TIMING.SLOW);
	}

	/**
	 * Move keyboard focus to a tile by its flat index across the whole field.
	 * Reads the rendered buttons in document order — the same order the bands
	 * lay them out — so this stays correct as bands expand or reorder.
	 */
	function focusTileAt(index: number) {
		if (index < 0 || index >= flatTemplates.length) return;
		const buttons = document.querySelectorAll<HTMLElement>('[data-template-button]');
		buttons[index]?.focus();
	}

	/**
	 * Keyboard navigation owned by the field: Enter/Space activate; arrows and
	 * tab walk the flat order across band boundaries. Activation is reported up
	 * via `onSelect` so the preview follows the field's selection.
	 */
	function handleKeydown(event: KeyboardEvent, id: string, index: number) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onSelect(id);
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			focusTileAt(index + 1);
			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			focusTileAt(index - 1);
			return;
		}

		if (event.key === 'Tab' && !event.shiftKey) {
			// Let focus leave the field naturally once past the last tile.
			if (index >= flatTemplates.length - 1) return;
			event.preventDefault();
			focusTileAt(index + 1);
		} else if (event.key === 'Tab' && event.shiftKey) {
			// Let focus leave the field naturally before the first tile.
			if (index <= 0) return;
			event.preventDefault();
			focusTileAt(index - 1);
		}
	}

	// ─── The dive: a descent into the chosen template ─────────────────────────
	//
	// Selecting a tile is falling into it. The WHOLE page recedes behind a single
	// full-viewport backdrop scrim (blur + a faint warm dim) and the chosen template
	// ascends into an Artifact — the one white bounded surface for a floated object —
	// wrapping the page's own preview. Because the scrim is one fixed plane over
	// everything, the hero beside the field and the header above it recede with the
	// field, as one — no half-sharp seam, one composited blur layer. Back / esc / a
	// tap on the scrim reverses the fall: the Artifact settles away, the page returns
	// to the EXACT state it left (scroll position, lens, selection cleared), and
	// focus lands back on the tile it rose from. Reversible, no hidden state.
	//
	// The dive is on only when the page supplies the preview snippet AND a tile is
	// selected; without the snippet the surface keeps the split-view behaviour (the
	// preview lives in its own column) and nothing here engages.
	const diving = $derived(!!dive && !!selectedId);

	// The body scroll position captured as the dive opens, restored as it closes,
	// so the field comes back exactly where it was — the reversibility the descent
	// promises. The element focus was on (the originating tile) is restored too.
	let lockedScrollY = 0;
	let diveSurface = $state<HTMLElement | null>(null);
	let restoreFocusId: string | null = null;

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

	// Open / close is driven by `diving`. On open: remember the originating tile,
	// lock the field's scroll, move focus into the Artifact. On close: restore the
	// scroll and return focus to the tile. Effects never run under SSR and the dive
	// only exists on the client, so the window/document reads need no guard.
	$effect(() => {
		if (!diving) return;
		restoreFocusId = selectedId;
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
			// Return focus to the tile the dive rose from, so the body knows where it
			// came back to. `preventScroll` is essential: a bare focus() scrolls the
			// tile into view and would override the exact scroll position we just
			// restored — the field must come back where it left, not jump to the tile.
			const id = restoreFocusId;
			restoreFocusId = null;
			tick().then(() => {
				if (!id) return;
				document
					.querySelector<HTMLElement>(`[data-template-button][data-template-id="${id}"]`)
					?.focus({ preventScroll: true });
			});
		};
	});

	function closeDive() {
		onClose?.();
	}

	// Portal the descent layer to <body>. The field sits inside the page's
	// `.template-list-column`, which is a `position: relative; z-index: 1` stacking
	// context, and the hero beside it sits in a sticky `z-index: 10` column — so a
	// scrim left in place would be capped at z-index 1 and the hero (z-index 10)
	// would paint OVER it, leaving the left half sharp. Moving the layer to <body>
	// lifts it to the document root, where its z-index clears every page context and
	// its backdrop-filter blurs the WHOLE page beneath it as one. Mirrors the
	// existing body-portal pattern (AnimatedPopover). Client-only (actions never run
	// under SSR), so the document reads need no guard.
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

<!-- The field stays inert (no clicks, no focus) while a dive is open, but it is
     NOT itself blurred: the whole page — this field, the hero beside it, the
     header above it — recedes as one behind a single full-viewport backdrop scrim
     in the descent layer below, so there is no half-sharp seam and one composited
     layer does the blur rather than a deep subtree. -->
<div class="spectrum-field" class:field-inert={diving}>
	{#if templates.length > 0}
		<!-- The lens chooses the organiser; hue keeps encoding topic in both. -->
		<LensToggle {lens} onChange={selectLens} />
	{/if}

	{#if bands.length > 0}
		<!-- The map of the whole: a sticky composition ribbon summing the field into
		     one glance — each band a segment sized by its count and coloured by its
		     hue, the same hue its spine carries below. It stays in view while the bands
		     scroll, so the eye can always reorient. -->
		<SpectrumOverview {bands} onFocusBand={focusBand} />

		<!-- The field: bands chunked by generous void, not chrome. EntityCluster's
		     proximity ratio lets the eye read each neighbourhood as one unit and the
		     gaps between them as the boundaries — no borders, no cards. -->
		<EntityCluster as="section" density="spacious" class="spectrum-landscape">
			{#each bands as band, i (band.key)}
				<DomainBand
					group={band}
					placeLabel={band.placeLabel}
					blooming={bloomingDomain === band.domain}
					{selectedId}
					{onSelect}
					{onHover}
					onKeydown={handleKeydown}
					indexOffset={indexOffsets[i]}
					{initialVisible}
				/>
			{/each}
		</EntityCluster>
	{:else}
		<!-- Honest empty state: no field to lay out yet. Plain English, no dead
		     counters or invented activity. -->
		<div class="spectrum-empty">
			<p class="font-brand spectrum-empty__head">No templates yet.</p>
			<p class="font-brand spectrum-empty__sub">You can write the first one.</p>
		</div>
	{/if}
</div>

{#if diving}
	<!-- The descent: the chosen template, risen as an Artifact over the whole
	     receded page. A tap on the scrim, esc, or back reverses it. Focus is trapped
	     inside the Artifact while it is up and restored to the originating tile on
	     close. The preview inside is the page's own — mounted here, never forked. -->
	<div
		class="dive-layer"
		role="presentation"
		onkeydown={handleDiveKeydown}
		use:portalToBody
	>
		<!-- The scrim recedes the whole page as one: a fixed full-viewport plane that
		     blurs and faintly dims everything painted behind it — this field, the hero
		     beside it, the header above it — so the dive reads as a fall away from the
		     entire page, not just one column. It is also the way back: a click anywhere
		     on it closes the dive. A button (not a div) so the keyboard reaches it. -->
		<button
			type="button"
			class="dive-scrim"
			aria-label="Back to the field"
			onclick={closeDive}
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
				{@render dive?.()}
			</Artifact>
		</div>
	</div>
{/if}

<style>
	/*
	 * The landscape carries no chrome of its own — the bands and the void
	 * between them are the structure. Only a small floor of breathing room so
	 * the field does not crowd the scope bar above it.
	 */
	:global(.spectrum-landscape) {
		padding-top: 0.25rem;
	}

	/*
	 * Below the mobile breakpoint the bands read as full-width stacked sections:
	 * the hue spine stays (it is the topic dimension, not chrome), but the gap to
	 * the body tightens so each band uses the whole narrow column. The generous
	 * void between bands still does the chunking — no borders, no boxes — and the
	 * sticky scrubber above keeps the map in reach while these scroll.
	 */
	@media (max-width: 767px) {
		:global(.spectrum-landscape .domain-band) {
			gap: 0.6rem;
		}
	}

	.spectrum-empty {
		padding: 3rem 1.5rem;
		text-align: center;
	}

	.spectrum-empty__head {
		font-size: 1rem;
		font-weight: 600;
		color: oklch(0.32 0.02 250);
		margin: 0;
	}

	.spectrum-empty__sub {
		margin-top: 0.5rem;
		font-size: 0.875rem;
		color: oklch(0.5 0.02 250);
	}

	/*
	 * While a dive is open the field is inert — it must not catch clicks or focus,
	 * because the whole page is being read through the scrim. The recede itself is
	 * NOT applied here: the field is blurred/dimmed (along with the hero beside it
	 * and the header above it) by the single full-viewport scrim in the descent
	 * layer below. No per-column filter, so there is no half-sharp seam.
	 */
	.spectrum-field.field-inert {
		pointer-events: none;
	}

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
