<!--
  DebateWeightGraph — debate_weight circuit as constraint cells.

  Three cells:
    ① Sqrt bound       (sqrt² ≤ stake < (sqrt+1)² — uniquely determines floor(sqrt))
    ② Quadratic weight (sqrt_stake × 2^tier = weighted_amount)
    ③ Note commitment  (H3(stake, tier, randomness) = note_commitment)

  No trees, no ic. This circuit is purely about committing a private
  quadratic-weighted stake. The sqrt-bound visualization is the
  perceptual centerpiece.
-->
<script lang="ts">
	// no props
</script>

<div class="graph" role="group" aria-label="debate_weight constraint graph">
	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ① Sqrt bound: brackets squeezing floor(sqrt(stake))            -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell">
		<header class="graph-cell-head">
			<span class="graph-cell-num">①</span>
			<span class="graph-cell-title">Sqrt bound &middot; floor(√stake)</span>
			<span class="graph-cell-note">u64 arithmetic</span>
		</header>

		<svg class="graph-svg" viewBox="0 0 380 220" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- Three boxes: sqrt², stake, (sqrt+1)² with ≤ and < between -->
			<g transform="translate(0, 40)">
				<!-- sqrt_stake² (derived) -->
				<rect class="g-witness" x="14" y="0" width="110" height="32" rx="3" />
				<text class="g-label" x="69" y="19" text-anchor="middle">sqrt_stake²</text>

				<!-- ≤ glyph -->
				<text class="g-equiv" x="138" y="22" text-anchor="middle">≤</text>

				<!-- stake (witness, solid teal to indicate "the value being bounded") -->
				<rect class="g-shared" x="152" y="0" width="76" height="32" rx="3" />
				<text class="g-label-ic" x="190" y="19" text-anchor="middle">stake</text>

				<!-- < glyph -->
				<text class="g-equiv" x="242" y="22" text-anchor="middle">&lt;</text>

				<!-- (sqrt+1)² (derived) -->
				<rect class="g-witness" x="256" y="0" width="120" height="32" rx="3" />
				<text class="g-label" x="316" y="19" text-anchor="middle">(sqrt_stake+1)²</text>
			</g>

			<!-- Bracket below: converging squeeze -->
			<g transform="translate(0, 98)">
				<!-- Lines from both outer boxes pointing inward -->
				<path class="g-arrow-ic" d="M 69 0 Q 69 20 190 40" />
				<path class="g-arrow-ic" d="M 316 0 Q 316 20 190 40" />
				<!-- Center label -->
				<text class="g-label-closure" x="190" y="56" text-anchor="middle">uniquely determines</text>
				<text class="g-equiv" x="190" y="80" text-anchor="middle">sqrt_stake = ⌊√stake⌋</text>
			</g>

			<!-- Annotation box -->
			<g transform="translate(0, 190)">
				<text class="g-label-tag" x="190" y="12" text-anchor="middle">max stake 100_000_000 &rArr; (sqrt+1)² ≤ 10_001² &lt; 2⁶⁴</text>
			</g>
		</svg>

		<p class="graph-cell-eq">
			sqrt_stake² ≤ stake &lt; (sqrt_stake + 1)²
		</p>
	</figure>

	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ② Quadratic weighting                                          -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell">
		<header class="graph-cell-head">
			<span class="graph-cell-num">②</span>
			<span class="graph-cell-title">Quadratic weighting</span>
		</header>

		<svg class="graph-svg" viewBox="0 0 380 260" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- Left: sqrt_stake (derived from ①) -->
			<rect class="g-witness" x="40" y="12" width="110" height="26" rx="3" />
			<text class="g-label" x="95" y="29" text-anchor="middle">sqrt_stake</text>
			<text class="g-label-tag" x="95" y="52" text-anchor="middle">from ①</text>

			<!-- Right: tier (witness) with multiplier ladder -->
			<rect class="g-witness" x="230" y="12" width="110" height="26" rx="3" />
			<text class="g-label" x="285" y="29" text-anchor="middle">tier ∈ [1..4]</text>

			<!-- 2^tier ladder underneath tier -->
			<g transform="translate(230, 52)">
				<rect class="g-op" x="0" y="0" width="110" height="62" rx="3" />
				<text class="g-label-tag" x="55" y="14" text-anchor="middle">2^tier</text>
				<text class="g-label" x="12" y="28" text-anchor="start">1 &rarr;</text>
				<text class="g-label" x="60" y="28" text-anchor="start">×2</text>
				<text class="g-label" x="12" y="42" text-anchor="start">2 &rarr;</text>
				<text class="g-label" x="60" y="42" text-anchor="start">×4</text>
				<text class="g-label" x="12" y="56" text-anchor="start">3 &rarr;</text>
				<text class="g-label" x="60" y="56" text-anchor="start">×8</text>
			</g>
			<text class="g-label-tag" x="285" y="130" text-anchor="middle">4 &rarr; ×16</text>

			<!-- Convergence into × operator -->
			<path class="g-arrow" d="M 95 38 Q 95 100 186 146" marker-end="url(#arrow-dw)" />
			<path class="g-arrow" d="M 285 114 Q 285 130 194 146" marker-end="url(#arrow-dw)" />

			<!-- × operator -->
			<rect class="g-op" x="150" y="146" width="80" height="28" rx="14" />
			<text class="g-op-label" x="190" y="165" text-anchor="middle">×</text>

			<!-- Closure: computed = weighted_amount -->
			<line class="g-closure" x1="190" y1="174" x2="190" y2="210" />
			<text class="g-equiv" x="190" y="196" text-anchor="middle">≡</text>
			<rect class="g-closure-peg" x="120" y="216" width="140" height="26" rx="3" />
			<text class="g-label-closure" x="190" y="234" text-anchor="middle">weighted_amount</text>

			<defs>
				<marker id="arrow-dw" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
				</marker>
			</defs>
		</svg>

		<p class="graph-cell-eq">
			weighted_amount ≡ sqrt_stake × 2^tier
		</p>
	</figure>

	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ③ Note commitment                                              -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell">
		<header class="graph-cell-head">
			<span class="graph-cell-num">③</span>
			<span class="graph-cell-title">Note commitment</span>
			<span class="graph-cell-note"><a href="#domain-separation">H3M domain · §3</a></span>
		</header>

		<svg class="graph-svg" viewBox="0 0 380 220" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- 3 witnesses -->
			<rect class="g-witness" x="20" y="12" width="100" height="26" rx="3" />
			<text class="g-label" x="70" y="29" text-anchor="middle">stake</text>
			<rect class="g-witness" x="140" y="12" width="100" height="26" rx="3" />
			<text class="g-label" x="190" y="29" text-anchor="middle">tier</text>
			<rect class="g-witness" x="260" y="12" width="100" height="26" rx="3" />
			<text class="g-label" x="310" y="29" text-anchor="middle">randomness</text>

			<!-- converge into H3 -->
			<path class="g-arrow" d="M 70 38 Q 70 80 176 100" />
			<path class="g-arrow" d="M 190 38 Q 190 80 190 100" />
			<path class="g-arrow" d="M 310 38 Q 310 80 204 100" />

			<!-- H3 -->
			<rect class="g-op" x="150" y="100" width="80" height="28" rx="14" />
			<text class="g-op-label" x="190" y="119" text-anchor="middle">H3</text>

			<!-- closure -->
			<line class="g-closure" x1="190" y1="128" x2="190" y2="164" />
			<text class="g-equiv" x="190" y="150" text-anchor="middle">≡</text>
			<rect class="g-closure-peg" x="120" y="170" width="140" height="26" rx="3" />
			<text class="g-label-closure" x="190" y="188" text-anchor="middle">note_commitment</text>
		</svg>

		<p class="graph-cell-eq">
			note_commitment ≡ H3(stake, tier, randomness) &nbsp;·&nbsp; consumed by <code>position_note</code>
		</p>
	</figure>
</div>

<style>
	/* Cell ③ spans full width — the downstream handoff to position_note is the climax */
	:global(.graph-cell-wide) {
		/* already set globally by CircuitSpecimen */
	}
</style>
