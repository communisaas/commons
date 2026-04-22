<!--
  CrossTreeBinding — The cryptographic invariant made spatial.

  A single private input (identity_commitment) feeds BOTH the nullifier
  derivation and the Tree 3 engagement leaf. The circuit asserts the
  ic consumed by the nullifier derivation equals the ic consumed by
  the leaf derivation — preventing an adversary from claiming
  engagement data belonging to a different identity.

  The equality constraint — ic ≡ ic — is drawn as a dashed band
  connecting the two hash operators. The band IS the cryptography;
  it's not an annotation, it's the circuit's live claim rendered.
-->
<script lang="ts">
	// No props; this is a specimen, fixed composition.
</script>

<figure class="binding" aria-labelledby="binding-caption">
	<svg viewBox="0 0 680 350" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="binding-title">
		<title id="binding-title">Cross-tree identity binding</title>

		<defs>
			<marker
				id="arrow"
				viewBox="0 0 10 10"
				refX="9"
				refY="5"
				markerWidth="8"
				markerHeight="8"
				orient="auto-start-reverse"
			>
				<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--coord-route-solid)" opacity="0.8" />
			</marker>
		</defs>

		<!-- Connectors: drawn first so they sit behind nodes -->
		<!-- Left branch: center → nullifier -->
		<path
			d="M 340 92 Q 340 180 160 240"
			fill="none"
			stroke="var(--coord-route-solid)"
			stroke-width="1.5"
			stroke-linecap="round"
			marker-end="url(#arrow)"
			opacity="0.65"
		/>
		<!-- Right branch: center → engagement leaf -->
		<path
			d="M 340 92 Q 340 180 520 240"
			fill="none"
			stroke="var(--coord-route-solid)"
			stroke-width="1.5"
			stroke-linecap="round"
			marker-end="url(#arrow)"
			opacity="0.65"
		/>

		<!-- Hash operator labels — ic tokens colored teal to signal shared witness. -->
		<g transform="translate(220, 168)">
			<text
				text-anchor="middle"
				font-family="'JetBrains Mono', monospace"
				font-size="11"
			>
				<tspan fill="var(--text-tertiary)">H2(&#8201;</tspan>
				<tspan fill="var(--coord-route-solid)" font-weight="600">ic</tspan>
				<tspan fill="var(--text-tertiary)">, action_domain&#8201;)</tspan>
			</text>
		</g>
		<g transform="translate(460, 168)">
			<text
				text-anchor="middle"
				font-family="'JetBrains Mono', monospace"
				font-size="11"
			>
				<tspan fill="var(--text-tertiary)">H2(&#8201;</tspan>
				<tspan fill="var(--coord-route-solid)" font-weight="600">ic</tspan>
				<tspan fill="var(--text-tertiary)">, engagement_data_commitment&#8201;)</tspan>
			</text>
		</g>

		<!-- ═════ EQUALITY CONSTRAINT BAND ═════ -->
		<!-- The band is the cryptography made spatial. -->
		<g>
			<!-- Short vertical ticks descending from each hash label toward the band -->
			<line x1="180" y1="178" x2="180" y2="196"
				stroke="var(--coord-route-solid)"
				stroke-width="1"
				opacity="0.55" />
			<line x1="500" y1="178" x2="500" y2="196"
				stroke="var(--coord-route-solid)"
				stroke-width="1"
				opacity="0.55" />
			<!-- Horizontal dashed line tying the two ticks together -->
			<line x1="180" y1="196" x2="500" y2="196"
				stroke="var(--coord-route-solid)"
				stroke-width="1"
				stroke-dasharray="4 3"
				opacity="0.55" />
			<!-- Background mask behind the center marker for clean layering -->
			<rect x="304" y="187" width="72" height="18" fill="var(--surface-base)" />
			<!-- Center: ic ≡ ic -->
			<text x="340" y="200" text-anchor="middle"
				font-family="'JetBrains Mono', monospace"
				font-size="12"
				fill="var(--coord-route-solid)"
				font-weight="600">ic &equiv; ic</text>
			<!-- Caption -->
			<text x="340" y="218" text-anchor="middle"
				font-family="'Satoshi', sans-serif"
				font-size="10"
				fill="var(--text-tertiary)"
				font-style="italic">circuit-enforced equality</text>
		</g>

		<!-- Center node: identity_commitment (private) -->
		<g transform="translate(340, 58)">
			<rect
				class="center-rect"
				x="-118"
				y="-26"
				width="236"
				height="52"
				rx="6"
				fill="var(--surface-base)"
				stroke="var(--text-tertiary)"
				stroke-width="1.25"
				stroke-dasharray="3 3"
				opacity="0.85"
			/>
			<text
				text-anchor="middle"
				font-family="'JetBrains Mono', monospace"
				font-size="13"
				fill="var(--text-primary)"
				font-weight="500"
				dy="-4"
			>
				identity_commitment
			</text>
			<text
				text-anchor="middle"
				font-family="'Satoshi', sans-serif"
				font-size="10"
				fill="var(--text-tertiary)"
				dy="14"
			>
				private · deterministic per verified person
			</text>
		</g>

		<!-- Left terminal: nullifier -->
		<g transform="translate(160, 262)">
			<rect
				x="-110"
				y="-28"
				width="220"
				height="66"
				rx="6"
				fill="#ffffff"
				stroke="var(--coord-node-border)"
				stroke-width="1"
			/>
			<text
				text-anchor="middle"
				font-family="'JetBrains Mono', monospace"
				font-size="13"
				fill="var(--text-primary)"
				font-weight="500"
				dy="-6"
			>
				nullifier
			</text>
			<text
				text-anchor="middle"
				font-family="'Satoshi', sans-serif"
				font-size="10.5"
				fill="var(--coord-verified)"
				dy="12"
				font-weight="500"
			>
				public · on-chain
			</text>
			<text
				text-anchor="middle"
				font-family="'Satoshi', sans-serif"
				font-size="10"
				fill="var(--text-tertiary)"
				dy="26"
			>
				prevents double-submission
			</text>
		</g>

		<!-- Right terminal: engagement leaf -->
		<g transform="translate(520, 262)">
			<rect
				x="-110"
				y="-28"
				width="220"
				height="66"
				rx="6"
				fill="#ffffff"
				stroke="var(--coord-node-border)"
				stroke-width="1"
			/>
			<text
				text-anchor="middle"
				font-family="'JetBrains Mono', monospace"
				font-size="13"
				fill="var(--text-primary)"
				font-weight="500"
				dy="-6"
			>
				engagement_leaf
			</text>
			<text
				text-anchor="middle"
				font-family="'Satoshi', sans-serif"
				font-size="10.5"
				fill="var(--coord-verified)"
				dy="12"
				font-weight="500"
			>
				member of Tree 3
			</text>
			<text
				text-anchor="middle"
				font-family="'Satoshi', sans-serif"
				font-size="10"
				fill="var(--text-tertiary)"
				dy="26"
			>
				binds engagement data to identity
			</text>
		</g>
	</svg>

	<figcaption id="binding-caption" class="sr-only">
		Cross-tree identity binding: a private identity_commitment value feeds both the nullifier derivation (H2 with action_domain) and the engagement leaf derivation (H2 with engagement_data_commitment). The circuit enforces that the same ic is used in both derivations — the equality ic ≡ ic is the cryptographic joint preventing cross-identity claims.
	</figcaption>
</figure>

<style>
	.binding {
		margin: 0;
		padding: 0;
		color: var(--text-tertiary);
	}

	.binding svg {
		display: block;
		width: 100%;
		height: auto;
		max-width: 680px;
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

	/* Subtle pulse on the private center — "this is the invariant" */
	@media (prefers-reduced-motion: no-preference) {
		.binding svg .center-rect {
			animation: breath 4.5s ease-in-out infinite;
		}
	}

	@keyframes breath {
		0%, 100% { opacity: 0.85; }
		50% { opacity: 1; }
	}
</style>
