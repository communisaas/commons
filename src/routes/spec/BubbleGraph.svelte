<!--
  BubbleGraph — bubble_membership circuit as constraint cells.

  Two cells:
    ① Cross-tree binding (wide): ic forks → Tree 3 engagement membership (input-side)
                                          → epoch_nullifier (output-side)
       Mirrors three_tree_membership's cell ③ — same fork shape, different closures.
    ② Cell-set commitment + ordering: cell_ids[16] sorted ascending + zero-padded,
       hashed up a depth-4 Merkle tree to produce cell_set_root.
-->
<script lang="ts">
	// no props
</script>

<div class="graph" role="group" aria-label="bubble_membership constraint graph">
	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ① Cross-tree binding (ic forks) — identical shape to 3tm ③     -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell graph-cell-wide">
		<header class="graph-cell-head">
			<span class="graph-cell-num">①</span>
			<span class="graph-cell-title">Cross-tree binding &middot; <span class="ic">ic</span> forks</span>
			<span class="graph-cell-note"><a href="#binding">see §5</a> &middot; same shape as 3TM ③</span>
		</header>

		<svg class="graph-svg graph-svg-wide" viewBox="0 0 680 520" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- Center top: ic -->
			<rect class="g-shared" x="280" y="16" width="120" height="30" rx="4" />
			<text class="g-label-ic" x="340" y="35" text-anchor="middle">identity_commitment</text>

			<!-- ic forks: left → engagement leaf (input-side), right → epoch_nullifier (output-side) -->
			<path class="g-arrow-ic" d="M 300 46 Q 200 100 174 214" marker-end="url(#arrow-bm-L)" />
			<path class="g-arrow-ic" d="M 380 46 Q 480 90 514 114" marker-end="url(#arrow-bm-R)" />

			<!-- ═══ LEFT BRANCH: engagement tree membership ═══ -->
			<!-- tier (public), action_count (witness), diversity (witness) -->
			<rect class="g-public" x="10" y="72" width="70" height="22" rx="3" />
			<text class="g-label-public" x="45" y="87" text-anchor="middle">tier</text>
			<rect class="g-witness" x="90" y="72" width="90" height="22" rx="3" />
			<text class="g-label" x="135" y="87" text-anchor="middle">action_count</text>
			<rect class="g-witness" x="190" y="72" width="80" height="22" rx="3" />
			<text class="g-label" x="230" y="87" text-anchor="middle">diversity</text>

			<!-- converge into H3 -->
			<path class="g-arrow" d="M 45 94 Q 45 120 134 140" />
			<path class="g-arrow" d="M 135 94 Q 135 114 154 140" />
			<path class="g-arrow" d="M 230 94 Q 230 120 174 140" />

			<!-- H3 -->
			<rect class="g-op" x="114" y="140" width="80" height="28" rx="14" />
			<text class="g-op-label" x="154" y="159" text-anchor="middle">H3</text>

			<!-- edc label -->
			<path class="g-arrow" d="M 154 168 L 154 184" marker-end="url(#arrow-bm)" />
			<text class="g-label-derived" x="154" y="198" text-anchor="middle">engagement_data_commit</text>

			<!-- H2 (left) — consumes ic + edc -->
			<rect class="g-op" x="114" y="214" width="80" height="28" rx="14" />
			<text class="g-op-label" x="154" y="233" text-anchor="middle">H2</text>
			<path class="g-arrow" d="M 154 204 L 154 214" marker-end="url(#arrow-bm)" />

			<!-- engagement_leaf -->
			<path class="g-arrow" d="M 154 242 L 154 262" marker-end="url(#arrow-bm)" />
			<text class="g-label-derived" x="154" y="276" text-anchor="middle">engagement_leaf</text>

			<!-- ─── Engagement sibling-path ladder · merkle₂₀ ─── -->
			<text class="g-label-tag" x="20" y="294" text-anchor="start">merkle₂₀</text>

			<!-- entry trunk: engagement_leaf → Level 0 -->
			<path class="g-arrow" d="M 154 282 L 154 291" />

			<!-- Level 0: sib₀ on LEFT -->
			<rect class="g-witness" x="20" y="292" width="100" height="20" rx="3" />
			<text class="g-label" x="70" y="306" text-anchor="middle">sib₀</text>
			<path class="g-arrow" d="M 120 302 L 143 302" marker-end="url(#arrow-bm)" />
			<circle class="g-ladder-node" cx="154" cy="302" r="11" />
			<text class="g-ladder-node-label" x="154" y="305" text-anchor="middle">H</text>

			<path class="g-arrow" d="M 154 313 L 154 330" />

			<!-- Level 1: sib₁ on RIGHT -->
			<rect class="g-witness" x="190" y="324" width="100" height="20" rx="3" />
			<text class="g-label" x="240" y="338" text-anchor="middle">sib₁</text>
			<path class="g-arrow" d="M 190 334 L 165 334" marker-end="url(#arrow-bm)" />
			<circle class="g-ladder-node" cx="154" cy="334" r="11" />
			<text class="g-ladder-node-label" x="154" y="337" text-anchor="middle">H</text>

			<path class="g-arrow" d="M 154 345 L 154 362" />

			<!-- Level 2: sib₂ on LEFT -->
			<rect class="g-witness" x="20" y="356" width="100" height="20" rx="3" />
			<text class="g-label" x="70" y="370" text-anchor="middle">sib₂</text>
			<path class="g-arrow" d="M 120 366 L 143 366" marker-end="url(#arrow-bm)" />
			<circle class="g-ladder-node" cx="154" cy="366" r="11" />
			<text class="g-ladder-node-label" x="154" y="369" text-anchor="middle">H</text>

			<path class="g-arrow" d="M 154 377 L 154 386" />

			<!-- Elision: 16 more levels -->
			<line class="g-ladder-elision" x1="20" y1="394" x2="290" y2="394" />
			<line class="g-ladder-elision" x1="20" y1="414" x2="290" y2="414" />
			<text class="g-ladder-elision-label" x="155" y="408" text-anchor="middle">16 more levels · sib₃ … sib₁₈</text>

			<path class="g-arrow" d="M 154 422 L 154 432" />

			<!-- Level 19: sib₁₉ on RIGHT -->
			<rect class="g-witness" x="190" y="434" width="100" height="20" rx="3" />
			<text class="g-label" x="240" y="448" text-anchor="middle">sib₁₉</text>
			<path class="g-arrow" d="M 190 444 L 165 444" marker-end="url(#arrow-bm)" />
			<circle class="g-ladder-node" cx="154" cy="444" r="11" />
			<text class="g-ladder-node-label" x="154" y="447" text-anchor="middle">H</text>

			<!-- closure ≡ engagement_root (PUBLIC INPUT) -->
			<line class="g-closure" x1="154" y1="455" x2="154" y2="484" />
			<text class="g-equiv" x="154" y="472" text-anchor="middle">≡</text>
			<rect class="g-closure-peg" x="84" y="488" width="140" height="26" rx="3" />
			<text class="g-label-closure" x="154" y="506" text-anchor="middle">engagement_root</text>

			<!-- ═══ RIGHT BRANCH: epoch nullifier ═══ -->
			<!-- epoch_domain (public input) -->
			<rect class="g-public" x="420" y="72" width="140" height="22" rx="3" />
			<text class="g-label-public" x="490" y="87" text-anchor="middle">epoch_domain</text>
			<path class="g-arrow" d="M 490 94 Q 490 108 506 114" marker-end="url(#arrow-bm)" />

			<!-- H2 (right) — consumes ic + epoch_domain -->
			<rect class="g-op" x="490" y="114" width="80" height="28" rx="14" />
			<text class="g-op-label" x="530" y="133" text-anchor="middle">H2</text>

			<!-- closure → epoch_nullifier (RETURNED as public output) -->
			<line class="g-closure" x1="530" y1="142" x2="530" y2="186" />
			<text class="g-equiv" x="530" y="170" text-anchor="middle">≡</text>
			<rect class="g-closure-peg" x="460" y="194" width="140" height="26" rx="3" />
			<text class="g-label-closure" x="530" y="212" text-anchor="middle">epoch_nullifier</text>

			<!-- annotation: returned -->
			<text class="g-label-tag" x="530" y="230" text-anchor="middle">returned</text>

			<defs>
				<marker id="arrow-bm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
				</marker>
				<marker id="arrow-bm-L" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--coord-route-solid)" opacity="0.85" />
				</marker>
				<marker id="arrow-bm-R" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--coord-route-solid)" opacity="0.85" />
				</marker>
			</defs>
		</svg>

		<p class="graph-cell-eq">
			engagement_root ≡ merkle₂₀( H2(<span class="ic">ic</span>, H3(tier, count, div)), path, idx )
			&nbsp;·&nbsp;
			epoch_nullifier = H2(<span class="ic">ic</span>, epoch_domain)
		</p>
	</figure>

	<!-- ═════════════════════════════════════════════════════════════ -->
	<!-- ② Cell set: sorted cells → merkle₄                             -->
	<!-- ═════════════════════════════════════════════════════════════ -->
	<figure class="graph-cell graph-cell-wide">
		<header class="graph-cell-head">
			<span class="graph-cell-num">②</span>
			<span class="graph-cell-title">Cell set &middot; sorted · merkle₄</span>
		</header>

		<svg class="graph-svg" viewBox="0 0 380 320" xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true" preserveAspectRatio="xMidYMid meet">
			<!-- cell_ids[16] visualized as 16 slots: first N ascending, rest zeros -->
			<text class="g-label-tag" x="190" y="14" text-anchor="middle">cell_ids[16] · strictly ascending · zero-padded</text>

			<g transform="translate(20, 24)">
				<!-- 16 slots in a row, width 340/16 = 21.25; use 20 with 1.5 gap = 342. Close enough. -->
				{#each Array(16) as _, i}
					{@const isActive = i < 5}
					{@const h = isActive ? 12 + i * 4 : 6}
					<rect x={i * 21.5} y={24 - h} width="18" height={h}
						fill={isActive ? 'var(--coord-route-solid)' : 'var(--text-quaternary)'}
						opacity={isActive ? 0.55 : 0.3}
						rx="1" />
					<text x={i * 21.5 + 9} y="38" text-anchor="middle"
						font-family="'JetBrains Mono', monospace" font-size="8"
						fill="var(--text-quaternary)">{i}</text>
				{/each}
				<!-- Bracket over first 5 = cell_count -->
				<line x1="0" y1="44" x2="107" y2="44" stroke="var(--coord-route-solid)" stroke-width="1" opacity="0.6" />
				<text x="53" y="56" text-anchor="middle" font-family="'JetBrains Mono', monospace"
					font-size="9" fill="var(--coord-route-solid)">cell_count</text>
				<line x1="107" y1="44" x2="344" y2="44" stroke="var(--text-quaternary)" stroke-width="1" stroke-dasharray="2 2" opacity="0.4" />
				<text x="225" y="56" text-anchor="middle" font-family="'JetBrains Mono', monospace"
					font-size="9" fill="var(--text-quaternary)">zeros</text>
			</g>

			<!-- Arrow down to merkle₄ -->
			<path class="g-arrow" d="M 190 96 L 190 118" marker-end="url(#arrow-bm-2)" />

			<!-- merkle₄ shown as a 4-level triangular tree -->
			<g transform="translate(40, 128)">
				<!-- Level 0: 16 small dots -->
				{#each Array(16) as _, i}
					<circle cx={i * 20} cy="0" r="2" fill="var(--text-tertiary)" />
				{/each}
				<!-- Level 1: 8 dots, wider gaps -->
				{#each Array(8) as _, i}
					<circle cx={10 + i * 40} cy="24" r="2.5" fill="var(--text-tertiary)" />
					<line x1={i * 40} y1="0" x2={10 + i * 40} y2="24" class="g-arrow" />
					<line x1={i * 40 + 20} y1="0" x2={10 + i * 40} y2="24" class="g-arrow" />
				{/each}
				<!-- Level 2: 4 dots -->
				{#each Array(4) as _, i}
					<circle cx={30 + i * 80} cy="48" r="3" fill="var(--text-secondary)" />
					<line x1={10 + i * 80} y1="24" x2={30 + i * 80} y2="48" class="g-arrow" />
					<line x1={50 + i * 80} y1="24" x2={30 + i * 80} y2="48" class="g-arrow" />
				{/each}
				<!-- Level 3: 2 dots -->
				{#each Array(2) as _, i}
					<circle cx={70 + i * 160} cy="72" r="3.5" fill="var(--text-secondary)" />
					<line x1={30 + i * 160} y1="48" x2={70 + i * 160} y2="72" class="g-arrow" />
					<line x1={110 + i * 160} y1="48" x2={70 + i * 160} y2="72" class="g-arrow" />
				{/each}
				<!-- Root -->
				<circle cx="150" cy="96" r="5" class="g-closure-peg" />
				<line x1="70" y1="72" x2="150" y2="96" class="g-arrow" />
				<line x1="230" y1="72" x2="150" y2="96" class="g-arrow" />
				<text class="g-label-tag" x="150" y="114" text-anchor="middle">merkle₄ · depth-4</text>
			</g>

			<!-- Closure -->
			<line class="g-closure" x1="190" y1="254" x2="190" y2="282" />
			<text class="g-equiv" x="190" y="272" text-anchor="middle">≡</text>
			<rect class="g-closure-peg" x="130" y="288" width="120" height="26" rx="3" />
			<text class="g-label-closure" x="190" y="306" text-anchor="middle">cell_set_root</text>

			<defs>
				<marker id="arrow-bm-2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
					<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" />
				</marker>
			</defs>
		</svg>

		<p class="graph-cell-eq">
			cell_set_root ≡ merkle₄( cell_ids[16] ) &nbsp;·&nbsp; sorted, zero-padded, MAX_CELLS = 16
		</p>
	</figure>
</div>
