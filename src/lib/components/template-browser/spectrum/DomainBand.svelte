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
	 * Hue authority: the spine reads the band's resolved hue (the spectrum order
	 * key), while each tile keeps its own domain tint. For a band's shared domain
	 * the two land on the same anchor hue, so spine and tiles read as one
	 * neighbourhood; once per-template hue is backfilled the tiles gain within-band
	 * micro-variation while the spine holds the band's place on the spine.
	 */

	import type { DomainGroup } from '$lib/core/topic/domain-grouping';
	import { aggregateArrivals } from '$lib/core/topic/band-signals';
	import TemplateTile from './TemplateTile.svelte';
	import { Pulse } from '$lib/design';

	interface Props {
		/** The hue-ordered domain group this band renders. */
		group: DomainGroup;
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
	}

	let {
		group,
		selectedId = null,
		onSelect,
		onHover,
		onKeydown,
		indexOffset = 0,
		initialVisible = 6
	}: Props = $props();

	// The spine colour and order key — already resolved by the grouper's hue
	// resolver (anchor fallback when the embedding projection is absent).
	const hue = $derived(group.hue);

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

<section class="domain-band" aria-label={group.domain}>
	<!-- The hue spine: this band's place on the spectrum, as colour. Not a
	     border — it is the hue dimension, a saturated rule the eye reads as
	     "this neighbourhood." -->
	<span class="band-spine" style="--card-hue: {hue};" aria-hidden="true"></span>

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
		width: 3px;
		border-radius: 9999px;
		/* Holds full chroma down the whole band so even a tall neighbourhood reads
		   as one hue; a gentle taper at the foot keeps it a living mark, not a
		   hard rule. */
		background: linear-gradient(
			to bottom,
			oklch(0.62 0.16 var(--card-hue)),
			oklch(0.62 0.16 var(--card-hue) / 0.72)
		);
		align-self: stretch;
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
	 */
	.band-tiles {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
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
