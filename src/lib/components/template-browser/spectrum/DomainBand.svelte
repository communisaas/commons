<script lang="ts">
	/**
	 * DomainBand — one neighbourhood of the commons spectrum.
	 *
	 * Renders a single hue-ordered domain: a thin colour SPINE in the band's
	 * resolved hue, a header (domain name + how many templates + the band's
	 * shared arrival rhythm), and the templates laid out as a proximity cluster.
	 *
	 * Every visual channel cites a real field:
	 * - spine hue          ← the band's resolved domain hue (the spectrum axis)
	 * - count              ← how many templates the band holds
	 * - aggregate Pulse    ← summed `daily_arrivals` across the band (D-region),
	 *                        rendered ONLY when real arrivals back it
	 * - per-tile dimensions ← each tile cites its own substrate (TemplateTile)
	 *
	 * Alive empty, alive full: with zero coordination data the band is a
	 * structured topical space — spine, name, count, tiles. No band-level Pulse
	 * is drawn until arrivals actually exist; it is absent, never a dead flat
	 * line. As sends arrive the rhythm draws itself in.
	 *
	 * Bands are chunked by void, not chrome: the spine is the hue dimension, the
	 * generous gap between bands is the boundary. There is no card, no border, no
	 * box around a band.
	 *
	 * Hue authority: ONE resolver. The spine reads the band's resolved hue (the
	 * spectrum order key, from the lead tile) and every tile is tinted by
	 * `resolveDomainHue` too — the same authority — so spine and tiles never clash.
	 * Today (anchor fallback) they are identical; once per-template hue is backfilled
	 * the tiles gain within-band micro-variation around the spine's band position.
	 */

	import type { DomainGroup } from '$lib/core/topic/domain-grouping';
	import { bandDomId } from '$lib/core/topic/domain-grouping';
	import { aggregateArrivals } from '$lib/core/topic/band-signals';
	import { resolveDomainHue } from '$lib/utils/domain-hue';
	import TemplateTile from './TemplateTile.svelte';
	import { Pulse } from '$lib/design';
	import { spring as svelteSpring } from 'svelte/motion';
	import { SPRINGS } from '$lib/design/motion';

	interface Props {
		/** The hue-ordered group this band renders. A topic band carries its
		 *  domain; a place band carries the precision tier as its name — both share
		 *  this shape (name, domain-derived hue, ordered templates, count). */
		group: Pick<DomainGroup, 'domain' | 'hue' | 'templates' | 'count'>;
		/** Currently selected template id, threaded down to the tiles. */
		selectedId?: string | null;
		/** Called with the template id when a tile is activated. */
		onSelect: (id: string) => void;
		/** Pointer enter/leave on a tile, so the field can preload. */
		onHover?: (id: string, isHovering: boolean) => void;
		/** Keydown owned by the field (focus order across the whole spectrum). */
		onKeydown?: (event: KeyboardEvent, id: string, index: number) => void;
		/** Flat index of this band's first tile across the whole field. */
		indexOffset?: number;
		/** How many tiles show before "more" reveals the rest. */
		initialVisible?: number;
		/** In the place lens, the geographic tier this band represents — shown as a
		 *  small chip on each tile so place stays visible while topic keeps the hue.
		 *  Absent in the topic lens (no chip → tiles render exactly as before). */
		placeLabel?: string | null;
		/** Set true for one beat when the overview jumps the field to this band: the
		 *  spine blooms brighter, then settles, confirming "you arrived here". The
		 *  field flips it back to false after the bloom; reduced-motion never sets it. */
		blooming?: boolean;
	}

	let {
		group,
		selectedId = null,
		onSelect,
		onHover,
		onKeydown,
		indexOffset = 0,
		initialVisible = 6,
		placeLabel = null,
		blooming = false
	}: Props = $props();

	// The spine colour and order key — already resolved by the grouper's hue
	// resolver (anchor fallback when the embedding projection is absent).
	const hue = $derived(group.hue);

	// The stable scroll target the overview map jumps to when its segment is tapped.
	const domId = $derived(bandDomId(group.domain));

	// Spine bloom: a 0→1 brightness lift that arrives on the ENTRANCE spring (firm
	// arrival, minimal overshoot) when the field jumps here, then settles back to
	// rest. The spring drives the spine's lightness + chroma so the neighbourhood
	// flares to greet the eye, not flashes. SSR-safe: the store starts at rest and
	// only moves on the client, where `blooming` can flip.
	// svelte-ignore state_referenced_locally — initial rest value is captured once per instance
	const bloom = svelteSpring(0, SPRINGS.ENTRANCE);
	$effect(() => {
		// Drive to full on the way in, settle to rest on the way out. The field
		// holds `blooming` true only briefly, so this reads as a single flare.
		bloom.set(blooming ? 1 : 0);
	});

	// The band's shared rhythm: summed arrivals across its templates, or null
	// when nothing real backs it. Null → no Pulse (absence, not a dead zero).
	const arrivals = $derived(aggregateArrivals(group.templates));

	// "more" reveal: start with the lead tiles, expand to the full band inline.
	let expanded = $state(false);
	const visibleCount = $derived(
		expanded ? group.templates.length : Math.min(initialVisible, group.templates.length)
	);
	const remaining = $derived(group.templates.length - visibleCount);
	const visibleTemplates = $derived(group.templates.slice(0, visibleCount));
</script>

<section class="domain-band" id={domId} aria-label={group.domain}>
	<!-- The hue spine: this band's place on the spectrum, as colour. Not a
	     border — it is the hue dimension, a saturated rule the eye reads as
	     "this neighbourhood." When the overview jumps the field here, the bloom
	     amount lifts its lightness and chroma for one beat to confirm arrival. -->
	<span
		class="band-spine"
		class:band-spine--blooming={$bloom > 0.01}
		style="--card-hue: {hue}; --bloom: {$bloom};"
		aria-hidden="true"
	></span>

	<div class="band-body">
		<header class="band-header">
			<h2 class="band-name font-brand" style="--card-hue: {hue};">
				{group.domain}
			</h2>

			<div class="band-meta">
				<span class="band-count">
					<span class="font-mono tabular-nums">{group.count}</span>
					<span class="font-brand">{group.count === 1 ? 'template' : 'templates'}</span>
				</span>

				{#if arrivals}
					<!-- The band's shared rhythm — present only when sends back it. -->
					<Pulse
						values={arrivals}
						width={72}
						height={16}
						color="oklch(0.55 0.12 {hue})"
						class="band-pulse"
					/>
				{/if}
			</div>
		</header>

		<!-- Tiles as a proximity cluster: tight within the band, the void between
		     bands does the chunking. No border, no box. -->
		<div class="band-tiles">
			{#each visibleTemplates as template, i (template.id)}
				<TemplateTile
					{template}
					resolvedHue={resolveDomainHue(template)}
					{placeLabel}
					selected={selectedId === template.id}
					index={indexOffset + i}
					newlyRevealed={i >= initialVisible}
					onSelect={onSelect}
					onHover={onHover}
					onKeydown={onKeydown}
				/>
			{/each}
		</div>

		{#if remaining > 0}
			<button type="button" class="band-more font-brand" onclick={() => (expanded = true)}>
				Show <span class="font-mono tabular-nums">{remaining}</span> more
			</button>
		{/if}
	</div>
</section>

<style>
	/*
	 * A band lays the spine alongside its body — the colour rule on the left,
	 * the neighbourhood beside it. The band carries no border and no background;
	 * separation from the next band is the generous void the field places between
	 * them (EntityCluster proximity), never chrome.
	 */
	.domain-band {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 1rem;
		align-items: stretch;
	}

	/*
	 * The hue spine. A thin, saturated vertical rule in the band's resolved hue —
	 * read as the colour dimension of the neighbourhood, not as a container edge.
	 * Full chroma so it reads as a hue, not a hairline border. Slightly rounded
	 * top/bottom so it reads as a mark, not a frame.
	 */
	.band-spine {
		/* Bloom amount (0 at rest → 1 at the flare), driven by the ENTRANCE spring.
		   The lightness and chroma below interpolate off it so the spine lifts as
		   one mark; at rest (--bloom: 0) it reads at its base spectrum weight. */
		--bloom: 0;
		--bloom-l: calc(0.62 + 0.12 * var(--bloom));
		--bloom-c: calc(0.16 + 0.05 * var(--bloom));
		width: 3px;
		border-radius: 9999px;
		/* Holds full chroma down the whole band so even a tall neighbourhood reads
		   as one hue; a gentle taper at the foot keeps it a living mark, not a
		   hard rule. The bloom lifts both stops together so the whole spine flares. */
		background: linear-gradient(
			to bottom,
			oklch(var(--bloom-l) var(--bloom-c) var(--card-hue)),
			oklch(var(--bloom-l) var(--bloom-c) var(--card-hue) / 0.72)
		);
		align-self: stretch;
	}

	/* While blooming, a soft hue-glow widens the spine's presence so the flare is
	   felt peripherally — the eye catches the arrival without reading it. The glow
	   rides the same bloom amount, so it fades in and out with the lightness lift.
	   Reduced-motion never sets `blooming`, so this class is simply never applied. */
	.band-spine--blooming {
		box-shadow: 0 0 calc(6px * var(--bloom)) oklch(0.7 0.18 var(--card-hue) / calc(0.5 * var(--bloom)));
	}

	.band-body {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.band-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	/*
	 * The domain name is the band's strong centre — text-xl, the typographic
	 * peak that anchors the neighbourhood. Tinted by the band hue so the word
	 * itself belongs to its colour.
	 */
	.band-name {
		font-size: 1.25rem;
		line-height: 1.75rem;
		font-weight: 700;
		color: oklch(0.38 0.08 var(--card-hue));
		margin: 0;
	}

	.band-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.band-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		font-size: 0.8125rem;
		color: oklch(0.5 0.02 250);
	}

	:global(.band-pulse) {
		flex-shrink: 0;
	}

	/*
	 * Tiles within a band sit closer together than bands sit apart — the
	 * proximity ratio that lets the eye chunk a band as one unit without a box.
	 *
	 * They flow as a fluid grid: one tile per row when the band is narrow (a
	 * phone, or a constrained column), two-up as it widens, more as the field
	 * opens out on a large screen. `auto-fit` with a comfortable minimum lets the
	 * count follow the band's real width rather than a hardcoded breakpoint — a
	 * tile never drops below the width it reads cleanly at, so the field reflows
	 * without ever cramping. The `min(100%, …)` keeps a track from overflowing a
	 * band narrower than the minimum (a sub-300px column stays one-up, no scroll).
	 * A tile is capped at its natural card width (below) so a lone template stays
	 * a card, not a stretched banner. The gap stays tight (proximity) so the eye
	 * chunks the band as one neighbourhood whether one or many up.
	 */
	.band-tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 18.75rem), 1fr));
		justify-items: start;
		gap: 0.75rem;
		align-items: start;
	}

	/*
	 * A tile holds its natural card width even when its grid track is wider (a
	 * lone template in a wide band): capped and left-aligned in the track so it
	 * reads as a card, not a full-bleed banner. When the band fills and the grid
	 * goes multi-up, each track is already under this cap, so the rule is inert
	 * there — it only reins in the single-tile, wide-band case.
	 */
	.band-tiles :global(.template-card) {
		max-width: 28rem;
	}

	/*
	 * "more" is a plain text affordance, not a pill or a chip. It reveals the
	 * rest of the band inline; the freshly revealed tiles carry TemplateTile's
	 * own staggered entrance (and respect reduced-motion there).
	 */
	.band-more {
		align-self: flex-start;
		padding: 0.25rem 0;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.5 0.06 var(--card-hue));
		background: none;
		border: none;
		cursor: pointer;
		transition: color 150ms ease-out;
	}

	.band-more:hover {
		color: oklch(0.42 0.1 var(--card-hue));
	}

	.band-more:focus-visible {
		outline: 2px solid oklch(0.45 0.18 var(--card-hue));
		outline-offset: 2px;
		border-radius: 2px;
	}
</style>
