<!--
  SpongeDiagram — 24-input absorption made spatial.

  The `+=` operator is the load-bearing invariant. Inputs add into
  rate slots; they don't overwrite. Overwriting would break the
  cryptographic chain — each permutation output must carry forward
  into the next absorb step. The capacity slot (initialized with
  the domain tag) carries that chain across 8 iterations.

  Prose buries this in a one-line note. Spatial shows the `+=` as
  the operator it actually is.
-->
<script lang="ts">
	// specimen; no props
</script>

<figure class="sponge" aria-labelledby="sponge-caption">
	<svg
		viewBox="0 0 720 430"
		xmlns="http://www.w3.org/2000/svg"
		role="img"
		aria-labelledby="sponge-title"
	>
		<title id="sponge-title">Poseidon2 sponge construction</title>

		<defs>
			<marker
				id="sp-arrow"
				viewBox="0 0 10 10"
				refX="9"
				refY="5"
				markerWidth="7"
				markerHeight="7"
				orient="auto-start-reverse"
			>
				<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--coord-route-solid)" opacity="0.75" />
			</marker>
			<marker
				id="sp-arrow-loop"
				viewBox="0 0 10 10"
				refX="9"
				refY="5"
				markerWidth="7"
				markerHeight="7"
				orient="auto-start-reverse"
			>
				<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-tertiary)" opacity="0.55" />
			</marker>
		</defs>

		<!-- ═════ STATE ROW — four slots, capacity distinct ═════ -->
		<g transform="translate(140, 60)">
			<text
				x="-14"
				y="4"
				text-anchor="end"
				font-family="'Satoshi', sans-serif"
				font-size="10"
				fill="var(--text-quaternary)"
				style="text-transform: uppercase; letter-spacing: 0.06em;"
			>state</text>

			<!-- Capacity cell (dashed border — the "chain" slot, not directly absorbed into) -->
			<rect
				x="0" y="-24" width="80" height="48" rx="4"
				fill="var(--surface-base)"
				stroke="var(--text-tertiary)"
				stroke-width="1.25"
				stroke-dasharray="3 3"
			/>
			<text x="40" y="2" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="12" font-weight="500" fill="var(--text-primary)">c</text>
			<text x="40" y="16" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="8.5" fill="var(--text-tertiary)">capacity</text>

			<!-- Rate cells r₁ r₂ r₃ -->
			<rect x="80" y="-24" width="80" height="48" rx="4" fill="#ffffff" stroke="var(--coord-node-border)" stroke-width="1" />
			<text x="120" y="2" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="12" fill="var(--text-primary)">r₁</text>
			<text x="120" y="16" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="8.5" fill="var(--text-tertiary)">rate</text>

			<rect x="160" y="-24" width="80" height="48" rx="4" fill="#ffffff" stroke="var(--coord-node-border)" stroke-width="1" />
			<text x="200" y="2" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="12" fill="var(--text-primary)">r₂</text>
			<text x="200" y="16" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="8.5" fill="var(--text-tertiary)">rate</text>

			<rect x="240" y="-24" width="80" height="48" rx="4" fill="#ffffff" stroke="var(--coord-node-border)" stroke-width="1" />
			<text x="280" y="2" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="12" fill="var(--text-primary)">r₃</text>
			<text x="280" y="16" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="8.5" fill="var(--text-tertiary)">rate</text>

			<!-- Capacity init annotation -->
			<text x="40" y="46" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" fill="var(--coord-route-solid)">SONGE_24</text>
			<text x="40" y="58" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="8.5" fill="var(--text-quaternary)" font-style="italic">domain init</text>
		</g>

		<!-- ═════ ABSORB — three += arrows (the invariant) ═════ -->
		<!-- Rate cell bottoms at y=84; input tops at y=172. Arrows bridge. -->
		<path d="M 260 168 L 260 88" fill="none" stroke="var(--coord-route-solid)" stroke-width="1.5" opacity="0.75" marker-end="url(#sp-arrow)" />
		<path d="M 340 168 L 340 88" fill="none" stroke="var(--coord-route-solid)" stroke-width="1.5" opacity="0.75" marker-end="url(#sp-arrow)" />
		<path d="M 420 168 L 420 88" fill="none" stroke="var(--coord-route-solid)" stroke-width="1.5" opacity="0.75" marker-end="url(#sp-arrow)" />

		<!-- += labels — large, emerald, the load-bearing operator -->
		<g font-family="'JetBrains Mono', monospace" font-size="19" font-weight="700" fill="var(--coord-verified)">
			<text x="260" y="138" text-anchor="middle">+=</text>
			<text x="340" y="138" text-anchor="middle">+=</text>
			<text x="420" y="138" text-anchor="middle">+=</text>
		</g>

		<!-- ═════ INPUTS ROW — three absorbed per iteration ═════ -->
		<g transform="translate(220, 192)">
			<text
				x="-14" y="4"
				text-anchor="end"
				font-family="'Satoshi', sans-serif" font-size="10"
				fill="var(--text-quaternary)"
				style="text-transform: uppercase; letter-spacing: 0.06em;"
			>inputs</text>

			<rect x="0" y="-20" width="80" height="40" rx="4" fill="#ffffff" stroke="var(--coord-node-border)" stroke-width="1" />
			<text x="40" y="5" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="var(--text-primary)">inputs[3i]</text>

			<rect x="80" y="-20" width="80" height="40" rx="4" fill="#ffffff" stroke="var(--coord-node-border)" stroke-width="1" />
			<text x="120" y="5" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="var(--text-primary)">inputs[3i+1]</text>

			<rect x="160" y="-20" width="80" height="40" rx="4" fill="#ffffff" stroke="var(--coord-node-border)" stroke-width="1" />
			<text x="200" y="5" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="var(--text-primary)">inputs[3i+2]</text>
		</g>

		<!-- ═════ STATE → PERMUTE subtle flow line ═════ -->
		<path d="M 180 84 L 180 275" fill="none" stroke="var(--text-tertiary)" stroke-width="1" stroke-dasharray="2 3" opacity="0.4" />

		<!-- ═════ PERMUTE BOX ═════ -->
		<g transform="translate(140, 275)">
			<rect x="0" y="0" width="320" height="44" rx="4" fill="var(--surface-base)" stroke="var(--text-tertiary)" stroke-width="1.25" />
			<text x="160" y="27" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="13" fill="var(--text-primary)">Poseidon2_permute(state)</text>
		</g>

		<!-- ═════ LOOP — permute output feeds state, ×8 iterations ═════ -->
		<path
			d="M 460 297 Q 560 297 560 170 Q 560 36 140 36"
			fill="none"
			stroke="var(--text-tertiary)"
			stroke-width="1"
			stroke-dasharray="3 3"
			opacity="0.55"
			marker-end="url(#sp-arrow-loop)"
		/>
		<text x="575" y="168" font-family="'Satoshi', sans-serif" font-size="11" fill="var(--text-tertiary)" font-style="italic">loop</text>
		<text x="575" y="184" font-family="'JetBrains Mono', monospace" font-size="12" fill="var(--text-secondary)">×8</text>

		<!-- ═════ OUTPUT — after the 8th permutation, extract state[0] ═════ -->
		<path d="M 300 321 L 300 346" fill="none" stroke="var(--text-tertiary)" stroke-width="1" stroke-dasharray="2 3" opacity="0.5" />

		<text x="300" y="358" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="10.5" fill="var(--text-tertiary)" font-style="italic">after the 8th permutation</text>

		<text x="300" y="393" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="13" fill="var(--text-primary)">
			<tspan fill="var(--text-tertiary)">return</tspan>
			<tspan dx="6" fill="var(--text-primary)" font-weight="500">state[0]</tspan>
			<tspan dx="8" fill="var(--text-quaternary)">=</tspan>
			<tspan dx="6" fill="var(--coord-verified)" font-weight="500">H(inputs)</tspan>
		</text>
	</svg>

	<figcaption id="sponge-caption" class="sr-only">
		Poseidon2 sponge absorption. The state has four slots: one capacity slot initialized with the domain tag SONGE_24, and three rate slots. Each of eight iterations adds three inputs into the rate slots using plus-equals (not assignment), then applies the Poseidon2 permutation. The capacity slot carries the cryptographic chain across all iterations. After the final permutation, state[0] is returned as the hash output over all 24 inputs.
	</figcaption>
</figure>

<style>
	.sponge {
		margin: 1.5rem 0 0.75rem;
		padding: 0;
		color: var(--text-tertiary);
	}

	.sponge svg {
		display: block;
		width: 100%;
		height: auto;
		max-width: 720px;
		margin: 0 auto;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* Subtle emphasis pulse on the += operators — the invariant breathes */
	@media (prefers-reduced-motion: no-preference) {
		.sponge svg g[font-weight='700'] {
			animation: op-breath 4.5s ease-in-out infinite;
			transform-origin: center;
		}
	}

	@keyframes op-breath {
		0%, 100% { opacity: 0.88; }
		50% { opacity: 1; }
	}
</style>
