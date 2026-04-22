<!--
  CircuitPrimer — the topology of a ZK proof in one annotated picture.

  Teaches the visual grammar in-situ:
    - Dashed rectangle → private witness (stays with the user)
    - Solid rectangle  → public receipt (anyone can verify)
    - Rounded pill     → hash function
    - Horizontal bar with ≡ → proof equation: left side computed = right side public
    - Travelling artifact  → the proof itself, sent from prover to verifier

  Every later circuit diagram reuses this grammar. The primer is the only
  place each element gets a role label. Subsequent diagrams inherit it.
-->
<script lang="ts">
	// no props
</script>

<figure class="primer" aria-label="Zero-knowledge proof topology">
	<svg viewBox="0 0 680 220" xmlns="http://www.w3.org/2000/svg"
		role="img" preserveAspectRatio="xMidYMid meet">

		<!-- ═══ Prover region (left) ═══ -->
		<rect x="0" y="24" width="300" height="140" rx="4"
			fill="rgba(0,0,0,0.04)" stroke="none" />
		<text x="16" y="18" class="region-label">Private · stays with you</text>

		<!-- Private witness — dashed border teaches "private" -->
		<rect class="g-witness" x="40" y="56" width="140" height="26" rx="3" />
		<text class="g-label" x="110" y="73" text-anchor="middle">user_secret</text>
		<text class="annotation" x="190" y="72">↖ private witness</text>

		<rect class="g-shared" x="40" y="96" width="140" height="26" rx="3" />
		<text class="g-label-ic" x="110" y="113" text-anchor="middle">identity_commitment</text>

		<!-- Flow into circuit -->
		<path class="g-arrow" d="M 180 69 L 328 102" />
		<path class="g-arrow" d="M 180 109 L 328 106" />

		<!-- ═══ Circuit operator (center) ═══ -->
		<rect class="g-op" x="316" y="92" width="60" height="28" rx="14" />
		<text class="g-op-label" x="346" y="111" text-anchor="middle">H2</text>
		<text class="annotation annotation-op" x="346" y="85" text-anchor="middle">hash</text>

		<!-- ═══ Closure bridge ═══ -->
		<line class="g-closure" x1="376" y1="106" x2="480" y2="106" />
		<text class="g-equiv" x="428" y="101" text-anchor="middle">≡</text>
		<text class="annotation" x="428" y="129" text-anchor="middle">proof equation</text>

		<!-- ═══ Verifier region (right) ═══ -->
		<rect x="380" y="24" width="300" height="140" rx="4"
			fill="rgba(59,196,184,0.035)" stroke="none" />
		<text x="664" y="18" class="region-label" text-anchor="end">Public · anyone can verify</text>

		<rect class="g-closure-peg" x="480" y="93" width="160" height="26" rx="3" />
		<text class="g-label-closure" x="560" y="110" text-anchor="middle">user_root</text>
		<text class="annotation" x="485" y="76">↙ public receipt</text>

		<!-- ═══ Proof artifact travelling ═══ -->
		<g transform="translate(140, 194)">
			<path d="M 0 0 L 400 0" stroke="var(--coord-route-solid)" stroke-width="1"
				fill="none" stroke-dasharray="3 3" opacity="0.6"
				marker-end="url(#primer-arrow)" />
			<rect x="170" y="-8" width="60" height="16" rx="2"
				fill="var(--surface-base)" stroke="var(--coord-route-solid)" stroke-width="1" />
			<text x="200" y="3" text-anchor="middle"
				font-family="'JetBrains Mono', monospace" font-size="9"
				fill="var(--coord-route-solid)" font-weight="600">proof</text>
			<text class="annotation annotation-flow" x="-6" y="3" text-anchor="end">prover →</text>
			<text class="annotation annotation-flow" x="406" y="3">→ verifier</text>
		</g>

		<defs>
			<marker id="primer-arrow" viewBox="0 0 10 10" refX="9" refY="5"
				markerWidth="6" markerHeight="6" orient="auto">
				<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--coord-route-solid)" opacity="0.8" />
			</marker>
		</defs>
	</svg>

	<p class="primer-caption">
		This grammar repeats across every circuit. A <span class="hl-private">private witness</span> enters a
		<span class="hl-op">hash</span> inside the prover, producing a value that the
		<span class="hl-equiv">proof equation</span> binds to a
		<span class="hl-public">public receipt</span> on-chain.
	</p>
</figure>

<style>
	.primer {
		margin: 0 0 2.25rem 0;
		padding: 0;
	}

	.primer svg {
		display: block;
		width: 100%;
		height: auto;
		max-width: 680px;
		margin: 0 auto;
	}

	.region-label {
		font-family: 'Satoshi', sans-serif;
		font-size: 11px;
		fill: var(--text-tertiary);
		font-weight: 500;
	}

	.annotation {
		font-family: 'Satoshi', sans-serif;
		font-size: 10px;
		fill: var(--text-tertiary);
		font-style: italic;
	}

	.annotation-op {
		fill: var(--text-tertiary);
		font-style: normal;
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.annotation-flow {
		font-size: 10px;
		fill: var(--coord-route-solid);
		font-style: normal;
		font-weight: 500;
	}

	.primer-caption {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--text-secondary);
		max-width: 44rem;
		margin: 1rem auto 0;
		text-align: center;
	}

	.hl-private { border-bottom: 1px dashed oklch(0.7 0.02 250); padding-bottom: 1px; }
	.hl-public { border-bottom: 1px solid var(--coord-route-solid); padding-bottom: 1px; color: var(--text-primary); }
	.hl-op { font-family: 'JetBrains Mono', monospace; font-size: 0.8125rem; color: var(--text-primary); }
	.hl-equiv { font-weight: 600; color: var(--text-primary); }
</style>
