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
	 * as text. At the real seed the bands are many and narrow, so an always-on
	 * caption inside each segment would clip into noise; instead the ribbon stays
	 * pure colour + width (the peripheral map) and a single readable caption line
	 * names whichever band the eye is on — hovered or keyboard-focused.
	 *
	 * Every visual channel cites a real field — nothing is invented:
	 * - segment width  ← the band's template count (group.count)
	 * - segment hue    ← the band's resolved domain hue (group.hue), the SAME hue
	 *                    its spine carries below, so the map and the field agree
	 * - segment chroma ← bandMomentum: a band with verified reach reads at fuller
	 *                    chroma; at the zero-send seed every band reads at the same
	 *                    base chroma (no invented emphasis — P4 alive-empty)
	 * - caption        ← the hovered/focused band's own heading (group.domain), the
	 *                    SAME words its DomainBand shows below, so the map label and
	 *                    the band you land on always agree — in both lenses (the
	 *                    topic lens shows the descriptive domain, the place lens
	 *                    shows the precision tier, e.g. "Nationwide").
	 *
	 * Alive empty, alive full: with no coordination data the ribbon is still the
	 * true composition of the field — segments sized by count, coloured by topic,
	 * uniform in weight. It is never a dead bar; as sends arrive the bands that
	 * coordinate gain chroma and the map shows where the energy is.
	 *
	 * Sticky at the top of the stream column so the map stays in view while the eye
	 * travels the bands. Each segment is also a wayfinding control: activating it
	 * (tap, click, or Enter/Space) asks the field to travel to that band — the
	 * field owns the scroll and the spine bloom, the map just names the target.
	 *
	 * SSR-safe: pure derivations over the bands it is handed (no wall-clock, no
	 * browser globals), so it renders identically on the server and the client.
	 */

	import type { DomainGroup } from '$lib/core/topic/domain-grouping';
	import { bandMomentum } from '$lib/core/topic/band-signals';
	import { Ratio } from '$lib/design';

	interface Props {
		/** The hue-ordered bands the field renders below, in spectrum order. Each
		 *  carries its resolved hue and its templates — the overview reads count and
		 *  momentum straight off them so the map can never disagree with the field. */
		bands: Pick<DomainGroup, 'domain' | 'hue' | 'count' | 'templates'>[];
		/** Activating a segment asks the field to travel to that band (by domain).
		 *  The field owns the scroll + spine bloom; the map just names the target.
		 *  Absent → the segments still render, simply carrying no jump. */
		onFocusBand?: (domain: string) => void;
	}

	let { bands, onFocusBand }: Props = $props();

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
	 * field are the same colour language. Each segment names the band by its OWN
	 * heading (`group.domain`) — the same words its DomainBand shows — so a hover or
	 * focus on the map names exactly the band you would land on, in either lens.
	 */
	const segments = $derived(
		bands.map((band) => {
			const chroma = bandMomentum(band.templates) > 0 ? ACTIVE_CHROMA : BASE_CHROMA;
			return {
				key: band.domain,
				domain: band.domain,
				value: band.count,
				color: `oklch(0.62 ${chroma} ${band.hue})`,
				hue: band.hue
			};
		})
	);

	// Total templates across the field — the whole the segments compose. Exposed as
	// a data attribute so the proportion has a denominator the page/AT can read.
	const total = $derived(bands.reduce((sum, band) => sum + band.count, 0));

	// The caption names whichever band the eye is on — the segment under the pointer
	// or the keyboard focus. Null at rest, so the line stays a quiet neutral hint
	// rather than asserting a band nobody picked. Pointer and focus share one slot:
	// the last one to move wins, and leaving clears it back to the hint.
	let activeDomain = $state<string | null>(null);
	let activeHue = $state<number | null>(null);

	function show(domain: string, hue: number) {
		activeDomain = domain;
		activeHue = hue;
	}
	function clear() {
		activeDomain = null;
		activeHue = null;
	}
</script>

{#if bands.length > 0}
	<!-- The map of the whole: a display-scale composition, sticky so it stays in
	     view while the bands scroll beneath it. No card, no border — the ribbon and
	     its one caption line are the structure. -->
	<div class="spectrum-overview" data-template-count={total}>
		<!-- The ribbon is the Ratio primitive at display scale — pure proportion +
		     colour, the peripheral map. The interactive segment row sits directly
		     over it (same flex proportions), so the whole width of each band is a
		     focusable, keyboard-activatable wayfinding control while the colour map
		     reads underneath. -->
		<div class="spectrum-overview__ribbon">
			<Ratio segments={segments} height={14} class="spectrum-overview__bar" />

			<!-- The wayfinding controls: one transparent button per band, flex-weighted
			     to overlay its segment exactly. No inline text — at the real seed the
			     bands are too narrow to caption without clipping, so the ribbon stays
			     pure colour + width and the caption line below names whatever the eye
			     is on. Each button still carries a distinct accessible name and a
			     native tooltip, so every band is reachable and named. -->
			<ul class="spectrum-overview__segments" aria-label="Jump to a band">
				{#each segments as segment (segment.key)}
					<li class="spectrum-overview__segment" style="flex-grow: {segment.value};">
						<button
							type="button"
							class="spectrum-overview__jump"
							style="--card-hue: {segment.hue};"
							aria-label="Jump to {segment.domain}"
							title={segment.domain}
							onclick={() => onFocusBand?.(segment.key)}
							onpointerenter={() => show(segment.domain, segment.hue)}
							onpointerleave={clear}
							onfocus={() => show(segment.domain, segment.hue)}
							onblur={clear}
						></button>
					</li>
				{/each}
			</ul>
		</div>

		<!-- The one caption line: plain English, room to breathe, no clipping. It
		     names the band the eye is on (hover or focus) by its OWN heading, so the
		     map label always matches the band below. At rest it is a quiet hint, not
		     a band nobody picked. -->
		<p
			class="spectrum-overview__caption font-brand"
			class:spectrum-overview__caption--hint={activeDomain === null}
			style={activeHue === null ? '' : `--card-hue: ${activeHue};`}
			aria-live="polite"
		>
			{activeDomain ?? 'Hover or focus a band to see its name'}
		</p>
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
		gap: 0.35rem;
		padding: 0.5rem 0 0.6rem;
		/* A warm-cream wash so the ribbon reads over whatever band scrolls beneath,
		   fading at the foot rather than ending on a hard edge. */
		background: linear-gradient(
			to bottom,
			var(--surface-base, oklch(0.993 0.003 60)) 70%,
			oklch(0.993 0.003 60 / 0)
		);
	}

	/* The ribbon stacks the interactive segment row directly over the Ratio bar,
	   so the colour map and the tap targets share one footprint. */
	.spectrum-overview__ribbon {
		position: relative;
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
	 * The interactive row overlays the bar exactly — same flex proportions, so a
	 * button sits over its segment. Transparent: the colour lives on the Ratio bar
	 * beneath; these are the tap/focus targets, not the paint.
	 */
	.spectrum-overview__segments {
		position: absolute;
		inset: 0;
		display: flex;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.spectrum-overview__segment {
		flex-basis: 0;
		min-width: 0;
		display: flex;
	}

	/*
	 * The wayfinding control fills its segment so the whole width is the tap
	 * target, carries no chrome of its own (the bar beneath is the colour), and
	 * gives an instant press response — the eye is acknowledged before the field
	 * has finished travelling. A plain transparent target, never a pill or a box.
	 */
	.spectrum-overview__jump {
		display: block;
		width: 100%;
		height: 100%;
		min-width: 0;
		padding: 0;
		margin: 0;
		background: none;
		border: none;
		cursor: pointer;
	}

	/* Hover/focus lifts the band slightly out of the ribbon so the eye sees which
	   segment it is pointing at — the same band the caption below has just named. */
	.spectrum-overview__jump:hover,
	.spectrum-overview__jump:focus-visible {
		background: oklch(0.62 0.19 var(--card-hue) / 0.18);
	}

	/* Press feedback: an immediate dim on touch/click, no transition in, so the
	   acknowledgement is causal (<100ms) before the field starts to travel. */
	.spectrum-overview__jump:active {
		background: oklch(0.62 0.19 var(--card-hue) / 0.32);
	}

	.spectrum-overview__jump:focus-visible {
		outline: 2px solid oklch(0.45 0.18 var(--card-hue));
		outline-offset: 2px;
		border-radius: 2px;
	}

	/*
	 * The caption: a single plain-English line with room to breathe, so it never
	 * clips the way an in-segment label would. It names the band the eye is on by
	 * its own heading; tinted toward that band's hue so the word belongs to its
	 * colour, kept dark enough to read against the cream.
	 */
	.spectrum-overview__caption {
		margin: 0;
		min-height: 1rem;
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.2;
		color: oklch(0.42 0.09 var(--card-hue, 250));
		/* One line; if a heading is unusually long it ends in an ellipsis rather
		   than reflowing the sticky bar — but with full width it has room. */
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 150ms var(--header-easing, ease-out);
	}

	/* At rest the line is a quiet neutral hint, not an asserted band — calm. */
	.spectrum-overview__caption--hint {
		color: oklch(0.6 0.01 250);
		font-weight: 400;
	}
</style>
