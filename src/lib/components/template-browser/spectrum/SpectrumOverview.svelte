<script lang="ts">
	/**
	 * SpectrumOverview — the map of the whole.
	 *
	 * A compact, always-visible ribbon that shows what the collection is MADE OF:
	 * one segment per domain band, each segment's width proportional to how many
	 * templates the band holds, each segment's fill the band's resolved hue. Read
	 * peripherally in a glance it is the shape of the whole spectrum — which issues
	 * are alive, how wide each runs, where the spine goes warm to cool — before the
	 * eye drops into any single band below.
	 *
	 * Built from the Ratio idiom (the system's display-scale composition primitive):
	 * the bar is what a number is made of, felt as proportion and colour, not read
	 * as text. The plain-English labels sit beneath, sharing the same proportions so
	 * a segment and its name read as one mark.
	 *
	 * Every visual channel cites a real field — nothing is invented:
	 * - segment width  ← the band's template count (group.count)
	 * - segment hue    ← the band's resolved domain hue (group.hue), the SAME hue
	 *                    its spine carries below, so the map and the field agree
	 * - segment chroma ← bandMomentum: a band with verified reach reads at fuller
	 *                    chroma; at the zero-send seed every band reads at the same
	 *                    base chroma (no invented emphasis — P4 alive-empty)
	 * - label          ← the band's plain-English domain name
	 *
	 * Alive empty, alive full: with no coordination data the ribbon is still the
	 * true composition of the field — segments sized by count, coloured by topic,
	 * uniform in weight. It is never a dead bar; as sends arrive the bands that
	 * coordinate gain chroma and the map shows where the energy is.
	 *
	 * Sticky at the top of the stream column so the map stays in view while the eye
	 * travels the bands. Tapping a segment to jump to its band lands later; until
	 * then the segments carry no interaction and the layout reserves no space that
	 * a later affordance would reflow.
	 *
	 * SSR-safe: pure derivations over the bands it is handed (no wall-clock, no
	 * browser globals), so it renders identically on the server and the client.
	 */

	import type { DomainGroup } from '$lib/core/topic/domain-grouping';
	import { bandMomentum } from '$lib/core/topic/band-signals';
	import { anchorLabelForHue } from '$lib/utils/domain-hue';
	import { Ratio } from '$lib/design';

	interface Props {
		/** The hue-ordered bands the field renders below, in spectrum order. Each
		 *  carries its resolved hue and its templates — the overview reads count and
		 *  momentum straight off them so the map can never disagree with the field. */
		bands: Pick<DomainGroup, 'domain' | 'hue' | 'count' | 'templates'>[];
	}

	let { bands }: Props = $props();

	// A band with verified reach reads at fuller chroma; an idle band at the base.
	// `bandMomentum` is 0 across the board at the zero-send seed, so every segment
	// reads identically then (no invented emphasis) and the bands that coordinate
	// stand out only once real sends back them.
	const BASE_CHROMA = 0.13;
	const ACTIVE_CHROMA = 0.19;

	/**
	 * One Ratio segment per band — the map stays 1:1 with the field below, so a
	 * segment is exactly a band. Width from the band's count, fill its resolved hue
	 * at a chroma that lifts only when the band carries real coordination. The hue
	 * matches the band's spine exactly (both read `group.hue`), so the map and the
	 * field are the same colour language.
	 *
	 * The caption is the band's plain-English topic: the anchor name its hue belongs
	 * to (e.g. "Housing", "Transportation"), falling back to the band's own domain
	 * wording when the hue is not a canonical anchor (a backfilled projection or an
	 * unknown domain). When several adjacent bands share a topic — two housing
	 * neighbourhoods sit side by side in the spectrum — only the first labels it, so
	 * the name spans its region instead of repeating, while the segments stay
	 * one-per-band.
	 */
	const segments = $derived(
		bands.map((band, i) => {
			const chroma = bandMomentum(band.templates) > 0 ? ACTIVE_CHROMA : BASE_CHROMA;
			const topic = anchorLabelForHue(band.hue) ?? band.domain;
			const previousTopic =
				i > 0 ? (anchorLabelForHue(bands[i - 1].hue) ?? bands[i - 1].domain) : null;
			return {
				key: band.domain,
				topic,
				// Only the first band of a contiguous same-topic run carries the name.
				label: topic === previousTopic ? '' : topic,
				value: band.count,
				color: `oklch(0.62 ${chroma} ${band.hue})`,
				hue: band.hue
			};
		})
	);

	// Total templates across the field — the whole the segments compose. Shown as
	// the ribbon's one-line caption so the proportion has a denominator in words.
	const total = $derived(bands.reduce((sum, band) => sum + band.count, 0));
</script>

{#if bands.length > 0}
	<!-- The map of the whole: a display-scale composition, sticky so it stays in
	     view while the bands scroll beneath it. No card, no border — the ribbon and
	     its labels are the structure. -->
	<div class="spectrum-overview" data-template-count={total}>
		<Ratio segments={segments} height={14} class="spectrum-overview__bar" />

		<!-- The plain-English legend, sharing the bar's proportions so each name
		     sits over its segment. The map reads first as colour + width; the words
		     name what the eye has already grasped. A topic that spans several
		     adjacent bands is named once, over the first of them. -->
		<ul class="spectrum-overview__labels" aria-hidden="true">
			{#each segments as segment (segment.key)}
				<li
					class="spectrum-overview__label"
					style="flex-grow: {segment.value}; --card-hue: {segment.hue};"
				>
					{#if segment.label}
						<span class="font-brand">{segment.label}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	/*
	 * The overview sits at the top of the stream column and stays there as the
	 * field scrolls — it is the map you keep glancing back to. It carries a thin
	 * floor of breathing room and a soft cream backing so the bar stays legible
	 * over the bands that scroll behind it, but no box, no border, no chrome.
	 */
	.spectrum-overview {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.5rem 0 0.6rem;
		/* A warm-cream wash so the ribbon reads over whatever band scrolls beneath,
		   fading at the foot rather than ending on a hard edge. */
		background: linear-gradient(
			to bottom,
			var(--surface-base, oklch(0.993 0.003 60)) 70%,
			oklch(0.993 0.003 60 / 0)
		);
	}

	/*
	 * The bar is the Ratio primitive at display scale; it brings its own segment
	 * radius and proportion. Full chroma reads as the spectrum, not decoration.
	 */
	:global(.spectrum-overview__bar) {
		/* Lift the display-scale ribbon to full presence — the map is the headline
		   here, not a footnote, so it reads at full opacity. */
		opacity: 1;
	}

	/*
	 * The legend mirrors the bar's proportions with the same flex weights, so each
	 * name sits over its segment. Names that would crowd their segment truncate
	 * rather than wrap, keeping the map one line tall and reflow-safe.
	 */
	.spectrum-overview__labels {
		display: flex;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.spectrum-overview__label {
		flex-basis: 0;
		min-width: 0;
		overflow: hidden;
	}

	.spectrum-overview__label span {
		display: block;
		font-size: 0.6875rem;
		font-weight: 500;
		line-height: 1;
		/* Tinted by the segment hue so the word belongs to its colour, kept dark
		   enough to read against the cream. */
		color: oklch(0.46 0.07 var(--card-hue));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
