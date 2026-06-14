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

	import type { Template, TemplateGroup } from '$lib/types/template';
	import { groupByDomain, bandDomId } from '$lib/core/topic/domain-grouping';
	import { toPlaceBands } from '$lib/core/topic/place-bands';
	import { resolveDomainHue } from '$lib/utils/domain-hue';
	import DomainBand from './DomainBand.svelte';
	import LensToggle, { type Lens } from './LensToggle.svelte';
	import SpectrumOverview from './SpectrumOverview.svelte';
	import { EntityCluster } from '$lib/design';
	import { TIMING } from '$lib/design/motion';

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
	}

	let {
		templates,
		placeGroups = [],
		selectedId = null,
		onSelect,
		onHover,
		initialVisible = 6
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

	// The topic lens: group by civic domain and order the bands along the hue
	// spectrum. The hue resolver is injected so the grouper stays decoupled from
	// the embedding backfill — the band order is stable today, and sharpens as
	// `domainHue` fills in. Deterministic and pure, so this runs cleanly under SSR.
	const topicBands = $derived(groupByDomain(templates, { hueOf: resolveDomainHue }));

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
</script>

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

<style>
	/*
	 * The landscape carries no chrome of its own — the bands and the void
	 * between them are the structure. Only a small floor of breathing room so
	 * the field does not crowd the scope bar above it.
	 */
	:global(.spectrum-landscape) {
		padding-top: 0.25rem;
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
</style>
