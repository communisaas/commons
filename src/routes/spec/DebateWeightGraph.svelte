<!--
  DebateWeightGraph — debate_weight circuit as constraint cells.

  Three cells:
    ① Integer-square number line — stake trapped between k² ticks
       uniquely determines floor(√stake). The quadratic-voting pedagogy
       lives in the growing tick gaps: 8→9 costs as much as 0→8.
    ② Area = sqrt_stake × 2^tier — quadratic pedestal crossed with
       geometric ladder, their product visualized as rectangle area.
    ③ Compact handoff — H3(stake, tier, randomness) → note_commitment
       → consumed by position_note.

  Cell ① dominates (full width) because it's the novel circuit trick.
  Cell ③ is deliberately compact — it's infrastructure, not climax.
-->
<script lang="ts">
	// Number-line tick positions for integer squares k² (k = 0..10).
	// x(k²) = 40 + 6·k² → spans 40 (k=0) to 640 (k=10).
	const ticks: { k: number; sq: number; x: number }[] = Array.from({ length: 11 }, (_, k) => ({
		k,
		sq: k * k,
		x: 40 + 6 * k * k
	}));

	// Example stake = 42, so sqrt_stake = 6. Stake lands at x=292 between
	// 6² (x=256) and 7² (x=334). The interval span is 78px wide.
	const exampleStake = 42;
	const sqrtStake = 6;
	const stakeX = 40 + 6 * exampleStake; // 292
	const lowSquareX = ticks[6].x; // 256 (6²=36)
	const highSquareX = ticks[7].x; // 334 (7²=49)
</script>

<div class="graph" role="group" aria-label="debate_weight constraint graph">
	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ① Integer-square number line (WIDE) — the novel circuit trick -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell graph-cell-wide">
		<header class="graph-cell-head">
			<span class="graph-cell-num">①</span>
			<span class="graph-cell-title">Sqrt bound &middot; stake trapped between consecutive squares</span>
			<span class="graph-cell-note">u64 arithmetic</span>
		</header>

		<svg class="graph-svg graph-svg-wide" viewBox="0 0 680 280" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- Top context: example tag -->
			<text class="g-label-tag" x="40" y="18" text-anchor="start">example · stake = {exampleStake}</text>

			<!-- ── Upper bound labels (the two squares that trap stake) ── -->
			<!-- Labels push outward from the ticks so they don't collide in the narrow 78px interval -->
			<!-- sqrt_stake² = 36 (derived) — label anchored to the LEFT, extends further left -->
			<text class="g-label" x={lowSquareX - 60} y="52" text-anchor="middle">sqrt_stake² = 36</text>
			<path class="g-closure" d="M {lowSquareX - 60} 58 L {lowSquareX - 60} 76 L {lowSquareX} 100 L {lowSquareX} 138" fill="none" />

			<!-- (sqrt_stake+1)² = 49 (derived) — label anchored to the RIGHT, extends further right -->
			<text class="g-label" x={highSquareX + 70} y="52" text-anchor="middle">(sqrt_stake+1)² = 49</text>
			<path class="g-closure" d="M {highSquareX + 70} 58 L {highSquareX + 70} 76 L {highSquareX} 100 L {highSquareX} 138" fill="none" />

			<!-- ── Stake marker: teal triangle above the axis ── -->
			<path d="M {stakeX} 138 L {stakeX - 7} 124 L {stakeX + 7} 124 z"
				fill="var(--coord-route-solid)" />
			<text class="g-label-ic" x={stakeX} y="118" text-anchor="middle">stake</text>

			<!-- ── Interval highlight band (the trap) ── -->
			<rect class="g-shared" x={lowSquareX} y="146" width={highSquareX - lowSquareX} height="28" rx="2" />

			<!-- ── Number line axis ── -->
			<line x1="40" y1="160" x2="640" y2="160" stroke="var(--text-tertiary)" stroke-width="1.25" />

			<!-- Ticks + square-value labels (k² below each tick) -->
			{#each ticks as t}
				<line class="g-tick" x1={t.x} y1="154" x2={t.x} y2="166" />
				{#if t.k !== 1}
					<!-- Skip label for k=1 to avoid collision with k=0 (they're 6px apart) -->
					<text class="g-label-tag" x={t.x} y="186" text-anchor="middle">{t.sq}</text>
				{/if}
			{/each}

			<!-- Secondary row: k² notation for a few ticks so the quadratic spacing reads -->
			<text class="g-label-tag" x="40" y="202" text-anchor="middle" opacity="0.6">0²</text>
			<text class="g-label-tag" x="136" y="202" text-anchor="middle" opacity="0.6">4²</text>
			<text class="g-label-tag" x={lowSquareX} y="202" text-anchor="middle">6²</text>
			<text class="g-label-tag" x={highSquareX} y="202" text-anchor="middle">7²</text>
			<text class="g-label-tag" x="424" y="202" text-anchor="middle" opacity="0.6">8²</text>
			<text class="g-label-tag" x="640" y="202" text-anchor="middle" opacity="0.6">10²</text>

			<!-- ── Derived readout: sqrt_stake = 6 ── -->
			<!-- Bracket under the interval pointing down to the readout -->
			<path class="g-arrow-ic" d="M {lowSquareX} 222 Q {(lowSquareX + highSquareX) / 2} 236 {highSquareX} 222" fill="none" />
			<text class="g-label-closure" x={(lowSquareX + highSquareX) / 2} y="252" text-anchor="middle">sqrt_stake = {sqrtStake}</text>

			<!-- ── Pedagogy annotation: why the ticks grow ── -->
			<text class="g-label-tag" x="340" y="273" text-anchor="middle">
				gaps grow quadratically &middot; each +1 to voice costs 2·sqrt_stake + 1 more tokens
			</text>
		</svg>

		<p class="graph-cell-eq">
			sqrt_stake² ≤ stake &lt; (sqrt_stake + 1)² &nbsp;·&nbsp; the interval traps exactly one integer root
		</p>
	</figure>

	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ② Quadratic × geometric — rectangle area = weighted_amount     -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell">
		<header class="graph-cell-head">
			<span class="graph-cell-num">②</span>
			<span class="graph-cell-title">Quadratic weighting &middot; pedestal × ladder</span>
		</header>

		<svg class="graph-svg" viewBox="0 0 380 280" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- y-axis label (rotated) -->
			<text class="g-label" x="22" y="140" text-anchor="middle" transform="rotate(-90 22 140)">2^tier</text>

			<!-- Axes: baseline + left rail -->
			<line x1="60" y1="240" x2="260" y2="240" stroke="var(--text-primary)" stroke-width="1.25" />
			<line x1="60" y1="240" x2="60" y2="34" stroke="var(--text-primary)" stroke-width="1.25" />

			<!-- Ghost tier boundaries (dashed horizontal lines) — each shows what rect you'd get at that tier -->
			<!-- y(h) = 240 - 200·h/16 → y(2)=215, y(4)=190, y(8)=140, y(16)=40 -->
			<line class="g-ladder-elision" x1="60" y1="40" x2="260" y2="40" />
			<line class="g-ladder-elision" x1="60" y1="190" x2="260" y2="190" />
			<line class="g-ladder-elision" x1="60" y1="215" x2="260" y2="215" />

			<!-- Tick marks on y-axis -->
			<line class="g-ladder-bit-tick" x1="55" y1="40" x2="60" y2="40" />
			<line class="g-ladder-bit-tick" x1="55" y1="140" x2="60" y2="140" />
			<line class="g-ladder-bit-tick" x1="55" y1="190" x2="60" y2="190" />
			<line class="g-ladder-bit-tick" x1="55" y1="215" x2="60" y2="215" />

			<!-- Your tier: tier 3 rectangle shaded (area = weighted_amount) -->
			<rect x="60" y="140" width="200" height="100"
				fill="rgba(59, 196, 184, 0.1)"
				stroke="var(--coord-route-solid)" stroke-width="1.5" />

			<!-- Right-side labels: tier number + multiplier -->
			<text class="g-label-tag" x="265" y="44" text-anchor="start">tier 4 · ×16</text>
			<text class="g-label-ic" x="265" y="144" text-anchor="start">tier 3 · ×8</text>
			<text class="g-label-tag" x="340" y="144" text-anchor="start">← yours</text>
			<text class="g-label-tag" x="265" y="194" text-anchor="start">tier 2 · ×4</text>
			<text class="g-label-tag" x="265" y="219" text-anchor="start">tier 1 · ×2</text>

			<!-- Inside shaded region: weighted_amount label + "= area" -->
			<text class="g-label-closure" x="160" y="192" text-anchor="middle">weighted_amount</text>
			<text class="g-label-tag" x="160" y="206" text-anchor="middle">= shaded area</text>

			<!-- x-axis label below -->
			<line class="g-ladder-bit-tick" x1="60" y1="240" x2="60" y2="245" />
			<line class="g-ladder-bit-tick" x1="260" y1="240" x2="260" y2="245" />
			<text class="g-label-tag" x="160" y="258" text-anchor="middle">sqrt_stake (from ①)</text>

			<!-- Bottom pedagogy -->
			<text class="g-label-tag" x="190" y="274" text-anchor="middle">quadratic on stake · geometric on tier</text>
		</svg>

		<p class="graph-cell-eq">
			weighted_amount ≡ sqrt_stake × 2^tier
		</p>
	</figure>

	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ③ Note commitment (compact handoff)                           -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell">
		<header class="graph-cell-head">
			<span class="graph-cell-num">③</span>
			<span class="graph-cell-title">Note commitment &middot; handoff</span>
			<span class="graph-cell-note"><a href="#domain-separation">H3M domain · §3</a></span>
		</header>

		<svg class="graph-svg" viewBox="0 0 380 200" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- Three witnesses in a row -->
			<rect class="g-witness" x="14" y="24" width="80" height="24" rx="3" />
			<text class="g-label" x="54" y="40" text-anchor="middle">stake</text>
			<rect class="g-witness" x="104" y="24" width="64" height="24" rx="3" />
			<text class="g-label" x="136" y="40" text-anchor="middle">tier</text>
			<rect class="g-witness" x="178" y="24" width="108" height="24" rx="3" />
			<text class="g-label" x="232" y="40" text-anchor="middle">randomness</text>

			<!-- Converge into H3 -->
			<path class="g-arrow" d="M 54 48 Q 54 72 140 90" fill="none" />
			<path class="g-arrow" d="M 136 48 L 145 90" fill="none" />
			<path class="g-arrow" d="M 232 48 Q 232 72 160 90" fill="none" />

			<!-- H3 operator -->
			<rect class="g-op" x="110" y="90" width="80" height="26" rx="13" />
			<text class="g-op-label" x="150" y="108" text-anchor="middle">H3</text>

			<!-- Closure -->
			<line class="g-closure" x1="150" y1="116" x2="150" y2="142" />
			<text class="g-equiv" x="150" y="134" text-anchor="middle">≡</text>

			<!-- note_commitment peg -->
			<rect class="g-closure-peg" x="82" y="146" width="136" height="26" rx="3" />
			<text class="g-label-closure" x="150" y="164" text-anchor="middle">note_commitment</text>

			<!-- Arrow out to position_note — signals the handoff -->
			<path class="g-arrow" d="M 220 159 L 288 159" fill="none" marker-end="url(#arrow-h3-out)" />
			<text class="g-label-tag" x="325" y="163" text-anchor="middle">position_note</text>

			<defs>
				<marker id="arrow-h3-out" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
				</marker>
			</defs>
		</svg>

		<p class="graph-cell-eq">
			note_commitment ≡ H3(stake, tier, randomness) &nbsp;·&nbsp; consumed by <code>position_note</code>
		</p>
	</figure>
</div>

<style>
	/* Cell ① spans both columns — the integer-square number line is the
	   novel circuit trick and needs width for the quadratic tick spacing
	   to read perceptually. */
	:global(.graph-cell-wide) {
		grid-column: 1 / -1;
	}

	/* Link styling for inline anchor in cell note */
	:global(.graph-cell-note a) {
		color: inherit;
		text-decoration: none;
		border-bottom: 1px dashed currentColor;
	}
	:global(.graph-cell-note a:hover) {
		color: var(--coord-route-solid);
	}
</style>
