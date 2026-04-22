<!--
  PositionNoteGraph — position_note circuit as constraint cells.

  Four cells:
    ① Position commitment   (args → H_PCM → commitment)
    ② Merkle membership     (commitment → merkle₂₀ → ≡ position_root)
    ③ Settlement identities (argument_index ≡ winning, weighted ≡ claimed — two tie-lines)
    ④ Position nullifier    (key + commitment + debate_id → H_PNL → ≡ nullifier)

  Cell ③ is distinctively flat (pure equality) — gives this circuit's
  specimen a different silhouette from the hash-heavy three_tree /
  bubble circuits.
-->
<script lang="ts">
	// no props
</script>

<div class="graph" role="group" aria-label="position_note constraint graph">
	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ① Position commitment                                          -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell">
		<header class="graph-cell-head">
			<span class="graph-cell-num">①</span>
			<span class="graph-cell-title">Position commitment</span>
			<span class="graph-cell-note"><a href="#domain">PCM domain · §3</a></span>
		</header>

		<svg class="graph-svg" viewBox="0 0 380 220" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- 3 witnesses -->
			<rect class="g-witness" x="10" y="10" width="110" height="26" rx="3" />
			<text class="g-label" x="65" y="27" text-anchor="middle">argument_index</text>
			<rect class="g-witness" x="135" y="10" width="110" height="26" rx="3" />
			<text class="g-label" x="190" y="27" text-anchor="middle">weighted_amount</text>
			<rect class="g-witness" x="260" y="10" width="110" height="26" rx="3" />
			<text class="g-label" x="315" y="27" text-anchor="middle">randomness</text>

			<!-- converge -->
			<path class="g-arrow" d="M 65 36 Q 65 80 176 100" />
			<path class="g-arrow" d="M 190 36 Q 190 76 190 100" />
			<path class="g-arrow" d="M 315 36 Q 315 80 204 100" />

			<!-- H_PCM operator -->
			<rect class="g-op" x="150" y="100" width="80" height="28" rx="14" />
			<text class="g-op-label" x="190" y="119" text-anchor="middle">H_PCM</text>

			<!-- → commitment (derived, labeled below) -->
			<path class="g-arrow" d="M 190 128 L 190 152" marker-end="url(#arrow-pn)" />
			<text class="g-label-derived" x="190" y="166" text-anchor="middle">commitment</text>
			<text class="g-label-tag" x="190" y="184" text-anchor="middle">used by ② and ④</text>

			<defs>
				<marker id="arrow-pn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
				</marker>
			</defs>
		</svg>

		<p class="graph-cell-eq">
			commitment = H_PCM( argument_index, weighted_amount, randomness )
		</p>
	</figure>

	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ② Merkle membership                                            -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell">
		<header class="graph-cell-head">
			<span class="graph-cell-num">②</span>
			<span class="graph-cell-title">Tree membership &middot; merkle₂₀</span>
		</header>

		<svg class="graph-svg" viewBox="0 0 380 220" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- commitment (from ①) -->
			<rect class="g-witness" x="40" y="14" width="120" height="26" rx="3"
				style="stroke: var(--coord-route-solid); stroke-dasharray: none; opacity: 0.85;" />
			<text class="g-label" x="100" y="31" text-anchor="middle"
				style="fill: var(--coord-route-solid);">commitment</text>
			<text class="g-label-tag" x="100" y="54" text-anchor="middle">from ①</text>

			<!-- side path witness -->
			<rect class="g-witness" x="220" y="14" width="140" height="26" rx="3" />
			<text class="g-label" x="290" y="31" text-anchor="middle">position_path[20] · idx</text>

			<!-- both feed merkle -->
			<path class="g-arrow" d="M 100 40 Q 100 70 176 90" marker-end="url(#arrow-pn-2)" />
			<path class="g-arrow" d="M 290 40 Q 290 70 204 90" marker-end="url(#arrow-pn-2)" />

			<!-- merkle₂₀ -->
			<rect class="g-op" x="150" y="90" width="80" height="28" rx="3" />
			<text class="g-op-label" x="190" y="109" text-anchor="middle">merkle₂₀</text>

			<!-- closure -->
			<line class="g-closure" x1="190" y1="118" x2="190" y2="158" />
			<text class="g-equiv" x="190" y="144" text-anchor="middle">≡</text>
			<rect class="g-closure-peg" x="130" y="164" width="120" height="26" rx="3" />
			<text class="g-label-closure" x="190" y="182" text-anchor="middle">position_root</text>

			<defs>
				<marker id="arrow-pn-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
				</marker>
			</defs>
		</svg>

		<p class="graph-cell-eq">
			position_root ≡ merkle₂₀( commitment, position_path, position_index )
		</p>
	</figure>

	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ③ Settlement identities — two tie-lines, distinctively flat    -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell graph-cell-wide">
		<header class="graph-cell-head">
			<span class="graph-cell-num">③</span>
			<span class="graph-cell-title">Settlement identities &middot; prover cannot substitute</span>
		</header>

		<svg class="graph-svg" viewBox="0 0 600 160" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- Tie-line 1: argument_index ≡ winning_argument_index -->
			<g transform="translate(0, 20)">
				<rect class="g-witness" x="30" y="0" width="160" height="28" rx="3" />
				<text class="g-label" x="110" y="18" text-anchor="middle">argument_index</text>
				<!-- dashed equality band -->
				<line x1="190" y1="14" x2="410" y2="14" class="g-closure" />
				<text class="g-equiv" x="300" y="19" text-anchor="middle"
					style="background: white;">≡</text>
				<rect x="270" y="6" width="60" height="16" fill="var(--surface-base)" />
				<text class="g-equiv" x="300" y="19" text-anchor="middle">≡</text>
				<rect class="g-closure-peg" x="410" y="0" width="160" height="28" rx="3" />
				<text class="g-label-closure" x="490" y="18" text-anchor="middle">winning_argument_index</text>
			</g>

			<!-- Tie-line 2: weighted_amount ≡ claimed_weighted_amount -->
			<g transform="translate(0, 90)">
				<rect class="g-witness" x="30" y="0" width="160" height="28" rx="3" />
				<text class="g-label" x="110" y="18" text-anchor="middle">weighted_amount</text>
				<line x1="190" y1="14" x2="410" y2="14" class="g-closure" />
				<rect x="270" y="6" width="60" height="16" fill="var(--surface-base)" />
				<text class="g-equiv" x="300" y="19" text-anchor="middle">≡</text>
				<rect class="g-closure-peg" x="410" y="0" width="160" height="28" rx="3" />
				<text class="g-label-closure" x="490" y="18" text-anchor="middle">claimed_weighted_amount</text>
			</g>
		</svg>

		<p class="graph-cell-eq">
			argument_index ≡ winning_argument_index &nbsp;·&nbsp;
			weighted_amount ≡ claimed_weighted_amount
		</p>
	</figure>

	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ④ Position nullifier                                           -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell graph-cell-wide">
		<header class="graph-cell-head">
			<span class="graph-cell-num">④</span>
			<span class="graph-cell-title">Position nullifier &middot; prevents double-claim</span>
			<span class="graph-cell-note"><a href="#domain">PNL domain · §3</a></span>
		</header>

		<svg class="graph-svg" viewBox="0 0 440 220" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- 3 inputs: nullifier_key (witness), commitment (from ①, teal), debate_id (public) -->
			<rect class="g-witness" x="20" y="12" width="120" height="26" rx="3" />
			<text class="g-label" x="80" y="29" text-anchor="middle">nullifier_key</text>

			<rect x="160" y="12" width="120" height="26" rx="3"
				style="fill: #fff; stroke: var(--coord-route-solid); stroke-width: 1.25;" />
			<text x="220" y="29" text-anchor="middle"
				style="font-family: 'JetBrains Mono', monospace; font-size: 11px;
				       fill: var(--coord-route-solid);">commitment</text>
			<text class="g-label-tag" x="220" y="52" text-anchor="middle">from ①</text>

			<rect class="g-public" x="300" y="12" width="120" height="26" rx="3" />
			<text class="g-label-public" x="360" y="29" text-anchor="middle">debate_id</text>

			<!-- converge -->
			<path class="g-arrow" d="M 80 38 Q 80 80 206 100" />
			<path class="g-arrow" d="M 220 60 Q 220 80 220 100" />
			<path class="g-arrow" d="M 360 38 Q 360 80 234 100" />

			<!-- H_PNL -->
			<rect class="g-op" x="180" y="100" width="80" height="28" rx="14" />
			<text class="g-op-label" x="220" y="119" text-anchor="middle">H_PNL</text>

			<!-- closure -->
			<line class="g-closure" x1="220" y1="128" x2="220" y2="164" />
			<text class="g-equiv" x="220" y="150" text-anchor="middle">≡</text>
			<rect class="g-closure-peg" x="150" y="170" width="140" height="26" rx="3" />
			<text class="g-label-closure" x="220" y="188" text-anchor="middle">nullifier</text>
		</svg>

		<p class="graph-cell-eq">
			nullifier ≡ H_PNL( nullifier_key, commitment, debate_id )
			&nbsp;·&nbsp; pre: nullifier_key ≠ 0
		</p>
	</figure>
</div>
