<!--
  ThreeTreeGraph — three_tree_membership circuit as constraint cells.

  Three cells:
    ① Tree 1 membership  (user identity leaf → merkle → user_root)
    ② Tree 2 membership  (cell_id + sponge₂₄(districts) → H2 → smt → cell_map_root)
    ③ Cross-tree binding (ic forks: → H2(·, action_domain) = nullifier
                                     → H2(·, H3(tier, count, div)) → merkle = engagement_root)

  Cell ③ is the visual climax — the ic fork IS the cross-tree binding of §5
  rendered in live circuit form. Spatial echo of §5's ic≡ic band.
-->
<script lang="ts">
	// no props — bespoke composition
</script>

<div class="graph" role="group" aria-label="three_tree_membership constraint graph">
	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ① Tree 1 membership                                            -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell">
		<header class="graph-cell-head">
			<span class="graph-cell-num">①</span>
			<span class="graph-cell-title">Tree 1 &middot; user identity</span>
		</header>
		<p class="graph-cell-narrator">Identity proves this is a real, uniquely registered person. The deterministic output is the <span class="ic">identity_commitment</span> &mdash; abbreviated <span class="ic">ic</span> &mdash; a stable per-person value that never reveals who.</p>

		<svg class="graph-svg" viewBox="0 0 380 450" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- Witnesses: 2×2 grid -->
			<g>
				<rect class="g-witness" x="30" y="10" width="140" height="22" rx="3" />
				<text class="g-label" x="100" y="25" text-anchor="middle">user_secret</text>
				<rect class="g-witness" x="210" y="10" width="140" height="22" rx="3" />
				<text class="g-label" x="280" y="25" text-anchor="middle">cell_id</text>
				<rect class="g-witness" x="30" y="40" width="140" height="22" rx="3" />
				<text class="g-label" x="100" y="55" text-anchor="middle">registration_salt</text>
				<rect class="g-witness" x="210" y="40" width="140" height="22" rx="3" />
				<text class="g-label" x="280" y="55" text-anchor="middle">authority_level</text>
			</g>

			<!-- Convergence into H4 -->
			<path class="g-arrow" d="M 100 32 Q 100 70 186 94" />
			<path class="g-arrow" d="M 280 32 Q 280 70 194 94" />
			<path class="g-arrow" d="M 100 62 Q 130 80 186 94" />
			<path class="g-arrow" d="M 280 62 Q 250 80 194 94" />

			<!-- H4 operator -->
			<rect class="g-op" x="150" y="94" width="80" height="28" rx="14" />
			<text class="g-op-label" x="190" y="113" text-anchor="middle">H4</text>

			<!-- H4 → user_leaf (enters the ladder as leaf) -->
			<path class="g-arrow" d="M 190 122 L 190 144" marker-end="url(#arrow-3tm)" />
			<text class="g-label-derived" x="190" y="158" text-anchor="middle">user_leaf</text>

			<!-- ─── Sibling-path ladder · merkle₂₀ ─── -->
			<!-- 20 levels of cascading H: leaf + sibᵢ → climb. 4 shown concretely,
			     16 elided. Sibling slots (dashed) are the private path witness. -->
			<text class="g-label-tag" x="32" y="180" text-anchor="start">merkle₂₀</text>

			<!-- entry trunk -->
			<path class="g-arrow" d="M 190 164 L 190 188" />

			<!-- Level 0: sib₀ on LEFT -->
			<rect class="g-witness" x="38" y="190" width="102" height="20" rx="3" />
			<text class="g-label" x="89" y="204" text-anchor="middle">sib₀</text>
			<path class="g-arrow" d="M 140 200 L 180 200" marker-end="url(#arrow-3tm)" />
			<circle class="g-ladder-node" cx="190" cy="200" r="11" />
			<text class="g-ladder-node-label" x="190" y="203" text-anchor="middle">H</text>

			<path class="g-arrow" d="M 190 211 L 190 228" />

			<!-- Level 1: sib₁ on RIGHT -->
			<rect class="g-witness" x="240" y="230" width="102" height="20" rx="3" />
			<text class="g-label" x="291" y="244" text-anchor="middle">sib₁</text>
			<path class="g-arrow" d="M 240 240 L 200 240" marker-end="url(#arrow-3tm)" />
			<circle class="g-ladder-node" cx="190" cy="240" r="11" />
			<text class="g-ladder-node-label" x="190" y="243" text-anchor="middle">H</text>

			<path class="g-arrow" d="M 190 251 L 190 268" />

			<!-- Level 2: sib₂ on LEFT -->
			<rect class="g-witness" x="38" y="270" width="102" height="20" rx="3" />
			<text class="g-label" x="89" y="284" text-anchor="middle">sib₂</text>
			<path class="g-arrow" d="M 140 280 L 180 280" marker-end="url(#arrow-3tm)" />
			<circle class="g-ladder-node" cx="190" cy="280" r="11" />
			<text class="g-ladder-node-label" x="190" y="283" text-anchor="middle">H</text>

			<path class="g-arrow" d="M 190 291 L 190 300" />

			<!-- Elision band: 16 more levels (sib₃ … sib₁₈) -->
			<line class="g-ladder-elision" x1="40" y1="308" x2="340" y2="308" />
			<line class="g-ladder-elision" x1="40" y1="330" x2="340" y2="330" />
			<text class="g-ladder-elision-label" x="190" y="322" text-anchor="middle">16 more levels · sib₃ … sib₁₈</text>

			<path class="g-arrow" d="M 190 338 L 190 348" />

			<!-- Level 19: sib₁₉ on RIGHT -->
			<rect class="g-witness" x="240" y="350" width="102" height="20" rx="3" />
			<text class="g-label" x="291" y="364" text-anchor="middle">sib₁₉</text>
			<path class="g-arrow" d="M 240 360 L 200 360" marker-end="url(#arrow-3tm)" />
			<circle class="g-ladder-node" cx="190" cy="360" r="11" />
			<text class="g-ladder-node-label" x="190" y="363" text-anchor="middle">H</text>

			<!-- Closure: last H ≡ user_root -->
			<line class="g-closure" x1="190" y1="371" x2="190" y2="400" />
			<text class="g-equiv" x="190" y="388" text-anchor="middle">≡</text>
			<rect class="g-closure-peg" x="140" y="404" width="100" height="24" rx="3" />
			<text class="g-label-closure" x="190" y="420" text-anchor="middle">user_root</text>

			<!-- Caption: what idx does -->
			<text class="g-ladder-cap" x="190" y="442" text-anchor="middle">
				user_index (private) decides L/R at each level
			</text>

			<defs>
				<marker id="arrow-3tm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
				</marker>
			</defs>
		</svg>

		<p class="graph-cell-eq">
			user_root ≡ merkle( H4(user_secret, cell_id, registration_salt, authority_level), path, idx )
		</p>
	</figure>

	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ② Tree 2 membership                                            -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell">
		<header class="graph-cell-head">
			<span class="graph-cell-num">②</span>
			<span class="graph-cell-title">Tree 2 &middot; cell &rarr; districts</span>
		</header>
		<p class="graph-cell-narrator">Location proves the person lives in one of the 24 accepted districts.</p>

		<svg class="graph-svg" viewBox="0 0 380 470" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- cell_id (witness, left) -->
			<rect class="g-witness" x="30" y="10" width="120" height="22" rx="3" />
			<text class="g-label" x="90" y="25" text-anchor="middle">cell_id</text>

			<!-- districts[24] (public, right) -->
			<rect class="g-public" x="230" y="10" width="120" height="22" rx="3" />
			<text class="g-label-public" x="290" y="25" text-anchor="middle">districts[24]</text>

			<!-- districts → sponge₂₄ -->
			<path class="g-arrow" d="M 290 32 L 290 54" marker-end="url(#arrow-3tm-2)" />
			<rect class="g-op" x="240" y="56" width="100" height="26" rx="13" />
			<text class="g-op-label" x="290" y="74" text-anchor="middle">sponge₂₄</text>

			<!-- sponge → district_commitment label -->
			<path class="g-arrow" d="M 290 82 L 290 102" marker-end="url(#arrow-3tm-2)" />
			<text class="g-label-derived" x="290" y="116" text-anchor="middle">district_commitment</text>

			<!-- cell_id + dc → H2 (merge point) -->
			<path class="g-arrow" d="M 90 32 Q 90 90 186 134" />
			<path class="g-arrow" d="M 290 120 Q 290 130 194 134" />

			<!-- H2 operator -->
			<rect class="g-op" x="150" y="134" width="80" height="28" rx="14" />
			<text class="g-op-label" x="190" y="153" text-anchor="middle">H2</text>

			<!-- H2 → cell_map_leaf (enters ladder as leaf) -->
			<path class="g-arrow" d="M 190 162 L 190 184" marker-end="url(#arrow-3tm-2)" />
			<text class="g-label-derived" x="190" y="198" text-anchor="middle">cell_map_leaf</text>

			<!-- ─── SMT ladder · position keyed by bits(cell_id) ─── -->
			<!-- Same cascading-H shape as merkle₂₀, but the leaf slot is NOT a
			     free witness: it is determined by bits of cell_id. The bits
			     witness exists only to avoid in-circuit decomposition. -->
			<text class="g-label-tag" x="32" y="220" text-anchor="start">smt₂₀</text>
			<text class="g-ladder-cap" x="348" y="220" text-anchor="end"><tspan style="fill: var(--coord-route-solid); font-weight: 600;">slot = bits(cell_id)</tspan></text>

			<!-- entry trunk -->
			<path class="g-arrow" d="M 190 204 L 190 228" />

			<!-- teal slot-binding arc: cell_id (top-left) drops a dashed route
			     to the ladder's entry, showing dual role (input AND key) -->
			<path d="M 90 32 Q 30 150 30 228 Q 30 238 50 240" class="g-closure"
				style="stroke: var(--coord-route-solid); stroke-dasharray: 2 4; opacity: 0.55;" />
			<text class="g-ladder-bit" x="22" y="140" text-anchor="start"
				style="writing-mode: vertical-rl; text-orientation: mixed; opacity: 0.7;">key route</text>

			<!-- Level 0: path[0] on LEFT -->
			<rect class="g-witness" x="58" y="230" width="102" height="20" rx="3" />
			<text class="g-label" x="109" y="244" text-anchor="middle">path[0]</text>
			<path class="g-arrow" d="M 160 240 L 180 240" marker-end="url(#arrow-3tm-2)" />
			<circle class="g-ladder-node" cx="190" cy="240" r="11" />
			<text class="g-ladder-node-label" x="190" y="243" text-anchor="middle">H</text>
			<!-- bit tag -->
			<text class="g-ladder-bit" x="212" y="244" text-anchor="start">bit₀</text>

			<path class="g-arrow" d="M 190 251 L 190 268" />

			<!-- Level 1: path[1] on RIGHT -->
			<rect class="g-witness" x="222" y="270" width="102" height="20" rx="3" />
			<text class="g-label" x="273" y="284" text-anchor="middle">path[1]</text>
			<path class="g-arrow" d="M 222 280 L 200 280" marker-end="url(#arrow-3tm-2)" />
			<circle class="g-ladder-node" cx="190" cy="280" r="11" />
			<text class="g-ladder-node-label" x="190" y="283" text-anchor="middle">H</text>
			<text class="g-ladder-bit" x="168" y="284" text-anchor="end">bit₁</text>

			<path class="g-arrow" d="M 190 291 L 190 308" />

			<!-- Level 2: path[2] on LEFT -->
			<rect class="g-witness" x="58" y="310" width="102" height="20" rx="3" />
			<text class="g-label" x="109" y="324" text-anchor="middle">path[2]</text>
			<path class="g-arrow" d="M 160 320 L 180 320" marker-end="url(#arrow-3tm-2)" />
			<circle class="g-ladder-node" cx="190" cy="320" r="11" />
			<text class="g-ladder-node-label" x="190" y="323" text-anchor="middle">H</text>
			<text class="g-ladder-bit" x="212" y="324" text-anchor="start">bit₂</text>

			<path class="g-arrow" d="M 190 331 L 190 340" />

			<!-- Elision: 16 more levels (path[3] … path[18]) -->
			<line class="g-ladder-elision" x1="40" y1="348" x2="340" y2="348" />
			<line class="g-ladder-elision" x1="40" y1="370" x2="340" y2="370" />
			<text class="g-ladder-elision-label" x="190" y="362" text-anchor="middle">16 more levels · path[3] … path[18] · bit₃ … bit₁₈</text>

			<path class="g-arrow" d="M 190 378 L 190 388" />

			<!-- Level 19: path[19] on RIGHT -->
			<rect class="g-witness" x="222" y="390" width="102" height="20" rx="3" />
			<text class="g-label" x="273" y="404" text-anchor="middle">path[19]</text>
			<path class="g-arrow" d="M 222 400 L 200 400" marker-end="url(#arrow-3tm-2)" />
			<circle class="g-ladder-node" cx="190" cy="400" r="11" />
			<text class="g-ladder-node-label" x="190" y="403" text-anchor="middle">H</text>
			<text class="g-ladder-bit" x="168" y="404" text-anchor="end">bit₁₉</text>

			<!-- Closure: last H ≡ cell_map_root -->
			<line class="g-closure" x1="190" y1="411" x2="190" y2="438" />
			<text class="g-equiv" x="190" y="426" text-anchor="middle">≡</text>
			<rect class="g-closure-peg" x="130" y="442" width="120" height="20" rx="3" />
			<text class="g-label-closure" x="190" y="456" text-anchor="middle">cell_map_root</text>

			<defs>
				<marker id="arrow-3tm-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
				</marker>
			</defs>
		</svg>

		<p class="graph-cell-eq">
			cell_map_root ≡ smt( H2(cell_id, sponge₂₄(districts)), path, bits )
		</p>
	</figure>

	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ③ Cross-tree binding — THE CLIMAX                              -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell graph-cell-wide">
		<header class="graph-cell-head">
			<span class="graph-cell-num">③</span>
			<span class="graph-cell-title">Cross-tree binding &middot; <span class="ic">ic</span> forks</span>
			<span class="graph-cell-note"><a href="#binding">see §5</a></span>
		</header>
		<p class="graph-cell-narrator">Identity and location bind to this one action — and only this one. The same <span class="ic">ic</span> from ① forks into a nullifier (prevents double-spend) and into the engagement record.</p>

		<svg class="graph-svg graph-svg-wide" viewBox="0 0 680 520" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- Center top: ic (shared witness) — the single source of truth -->
			<rect class="g-shared" x="280" y="16" width="120" height="30" rx="4" />
			<text class="g-label-ic" x="340" y="35" text-anchor="middle">identity_commitment</text>

			<!-- ic → left branch (nullifier) — exits from bottom-left -->
			<path class="g-arrow-ic" d="M 300 46 Q 200 90 166 114" marker-end="url(#arrow-ic-L)" />
			<!-- ic → right branch (engagement) — exits from bottom-right -->
			<path class="g-arrow-ic" d="M 380 46 Q 500 90 514 214" marker-end="url(#arrow-ic-R)" />

			<!-- ═══ LEFT BRANCH: nullifier ═══ -->
			<!-- action_domain (public input) -->
			<rect class="g-public" x="40" y="72" width="140" height="22" rx="3" />
			<text class="g-label-public" x="110" y="87" text-anchor="middle">action_domain</text>
			<path class="g-arrow" d="M 110 94 Q 110 108 132 114" marker-end="url(#arrow-3tm-3)" />

			<!-- H2 (left) -->
			<rect class="g-op" x="110" y="114" width="80" height="28" rx="14" />
			<text class="g-op-label" x="150" y="133" text-anchor="middle">H2</text>

			<!-- closure → nullifier peg -->
			<line class="g-closure" x1="150" y1="142" x2="150" y2="186" />
			<text class="g-equiv" x="150" y="170" text-anchor="middle">≡</text>
			<rect class="g-closure-peg" x="90" y="194" width="120" height="26" rx="3" />
			<text class="g-label-closure" x="150" y="212" text-anchor="middle">nullifier</text>

			<!-- ═══ RIGHT BRANCH: engagement ═══ -->
			<!-- tier, action_count, diversity feed H3 -->
			<rect class="g-public" x="420" y="72" width="70" height="22" rx="3" />
			<text class="g-label-public" x="455" y="87" text-anchor="middle">tier</text>
			<rect class="g-witness" x="500" y="72" width="80" height="22" rx="3" />
			<text class="g-label" x="540" y="87" text-anchor="middle">action_count</text>
			<rect class="g-witness" x="590" y="72" width="80" height="22" rx="3" />
			<text class="g-label" x="630" y="87" text-anchor="middle">diversity</text>

			<!-- convergence into H3 -->
			<path class="g-arrow" d="M 455 94 Q 455 120 514 140" />
			<path class="g-arrow" d="M 540 94 Q 540 114 534 140" />
			<path class="g-arrow" d="M 630 94 Q 630 120 554 140" />

			<!-- H3 operator -->
			<rect class="g-op" x="494" y="140" width="80" height="28" rx="14" />
			<text class="g-op-label" x="534" y="159" text-anchor="middle">H3</text>

			<!-- H3 → edc -->
			<path class="g-arrow" d="M 534 168 L 534 184" marker-end="url(#arrow-3tm-3)" />
			<text class="g-label-derived" x="534" y="198" text-anchor="middle">engagement_data_commit</text>

			<!-- H2 (right) — consumes ic (from the ic→right branch above) AND edc -->
			<rect class="g-op" x="494" y="214" width="80" height="28" rx="14" />
			<text class="g-op-label" x="534" y="233" text-anchor="middle">H2</text>

			<!-- edc → H2 right -->
			<path class="g-arrow" d="M 534 204 L 534 214" marker-end="url(#arrow-3tm-3)" />

			<!-- H2 → engagement_leaf -->
			<path class="g-arrow" d="M 534 242 L 534 262" marker-end="url(#arrow-3tm-3)" />
			<text class="g-label-derived" x="534" y="276" text-anchor="middle">engagement_leaf</text>

			<!-- ─── Engagement sibling-path ladder · merkle₂₀ ─── -->
			<text class="g-label-tag" x="400" y="294" text-anchor="end">merkle₂₀</text>

			<!-- entry trunk: engagement_leaf → Level 0 -->
			<path class="g-arrow" d="M 534 282 L 534 291" />

			<!-- Level 0: sib₀ on LEFT -->
			<rect class="g-witness" x="400" y="292" width="100" height="20" rx="3" />
			<text class="g-label" x="450" y="306" text-anchor="middle">sib₀</text>
			<path class="g-arrow" d="M 500 302 L 523 302" marker-end="url(#arrow-3tm-3)" />
			<circle class="g-ladder-node" cx="534" cy="302" r="11" />
			<text class="g-ladder-node-label" x="534" y="305" text-anchor="middle">H</text>

			<path class="g-arrow" d="M 534 313 L 534 330" />

			<!-- Level 1: sib₁ on RIGHT -->
			<rect class="g-witness" x="570" y="324" width="100" height="20" rx="3" />
			<text class="g-label" x="620" y="338" text-anchor="middle">sib₁</text>
			<path class="g-arrow" d="M 570 334 L 545 334" marker-end="url(#arrow-3tm-3)" />
			<circle class="g-ladder-node" cx="534" cy="334" r="11" />
			<text class="g-ladder-node-label" x="534" y="337" text-anchor="middle">H</text>

			<path class="g-arrow" d="M 534 345 L 534 362" />

			<!-- Level 2: sib₂ on LEFT -->
			<rect class="g-witness" x="400" y="356" width="100" height="20" rx="3" />
			<text class="g-label" x="450" y="370" text-anchor="middle">sib₂</text>
			<path class="g-arrow" d="M 500 366 L 523 366" marker-end="url(#arrow-3tm-3)" />
			<circle class="g-ladder-node" cx="534" cy="366" r="11" />
			<text class="g-ladder-node-label" x="534" y="369" text-anchor="middle">H</text>

			<path class="g-arrow" d="M 534 377 L 534 386" />

			<!-- Elision: 16 more levels -->
			<line class="g-ladder-elision" x1="400" y1="394" x2="670" y2="394" />
			<line class="g-ladder-elision" x1="400" y1="414" x2="670" y2="414" />
			<text class="g-ladder-elision-label" x="535" y="408" text-anchor="middle">16 more levels · sib₃ … sib₁₈</text>

			<path class="g-arrow" d="M 534 422 L 534 432" />

			<!-- Level 19: sib₁₉ on RIGHT -->
			<rect class="g-witness" x="570" y="434" width="100" height="20" rx="3" />
			<text class="g-label" x="620" y="448" text-anchor="middle">sib₁₉</text>
			<path class="g-arrow" d="M 570 444 L 545 444" marker-end="url(#arrow-3tm-3)" />
			<circle class="g-ladder-node" cx="534" cy="444" r="11" />
			<text class="g-ladder-node-label" x="534" y="447" text-anchor="middle">H</text>

			<!-- closure → engagement_root peg -->
			<line class="g-closure" x1="534" y1="455" x2="534" y2="484" />
			<text class="g-equiv" x="534" y="472" text-anchor="middle">≡</text>
			<rect class="g-closure-peg" x="464" y="488" width="140" height="26" rx="3" />
			<text class="g-label-closure" x="534" y="506" text-anchor="middle">engagement_root</text>

			<defs>
				<marker id="arrow-3tm-3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
				</marker>
				<marker id="arrow-ic-L" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--coord-route-solid)" opacity="0.85" />
				</marker>
				<marker id="arrow-ic-R" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--coord-route-solid)" opacity="0.85" />
				</marker>
			</defs>
		</svg>

		<p class="graph-cell-eq">
			nullifier ≡ H2(<span class="ic">ic</span>, action_domain) &nbsp;·&nbsp;
			engagement_root ≡ merkle( H2(<span class="ic">ic</span>, H3(tier, count, diversity)), path, idx )
		</p>
	</figure>
</div>

<style>
	/* Cell ③ spans both columns on desktop (the climax gets width) */
	:global(.graph-cell-wide) {
		grid-column: 1 / -1;
	}

	:global(.graph-svg-wide) {
		max-width: 680px;
	}

	/* Narrator: human-language framing above each cell's SVG machinery.
	   Makes ①②③ read as a story (identity → location → both bind). */
	:global(.graph-cell-narrator) {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--text-secondary);
		margin: 0 0 0.875rem 0;
		max-width: 44rem;
	}
	:global(.graph-cell-narrator .ic) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--text-primary);
	}
</style>
