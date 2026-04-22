<!--
  TreeTopology — the four-tree data topology made spatial.

  What this shows, pre-attentively:
    - Tree 1 is the hub (thicker stroke)
    - Tree 2 is sparse (dashed border)
    - Tree 2 ↔ Tree 1 shares cell_id
    - Tree 1 ↔ Tree 3 shares identity_commitment
    - Position Tree is isolated (past the dashed divider)

  The cross-tree witnesses are labeled on the connectors. A cryptographer
  scanning this in 3 seconds has the whole protocol's data topology —
  and is primed for §5's binding invariant.
-->
<script lang="ts">
	// specimen; no props
</script>

<figure class="topology" aria-labelledby="topology-caption">
	<svg
		viewBox="0 0 860 170"
		xmlns="http://www.w3.org/2000/svg"
		role="img"
		aria-labelledby="topology-title"
	>
		<title id="topology-title">Four-tree data topology</title>

		<!-- ═════ Tree 2 — sparse, dashed border ═════ -->
		<g transform="translate(20, 50)">
			<rect
				x="0" y="0" width="140" height="68" rx="4"
				fill="#ffffff"
				stroke="var(--text-tertiary)"
				stroke-width="1"
				stroke-dasharray="4 3"
			/>
			<text x="70" y="24" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="12" font-weight="600" fill="var(--text-primary)">Tree 2</text>
			<text x="70" y="42" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="10" fill="var(--text-tertiary)" font-style="italic">sparse · geography</text>
			<text x="70" y="58" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" fill="var(--text-quaternary)">depth 20</text>
		</g>

		<!-- Link: Tree 2 ↔ Tree 1 (cell_id) -->
		<path
			d="M 164 84 L 239 84"
			stroke="var(--coord-route-solid)"
			stroke-width="1.25"
			fill="none"
			opacity="0.7"
		/>
		<text x="201" y="76" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="var(--coord-route-solid)">cell_id</text>

		<!-- ═════ Tree 1 — hub, solid, thicker stroke ═════ -->
		<g transform="translate(243, 50)">
			<rect
				x="0" y="0" width="140" height="68" rx="4"
				fill="#ffffff"
				stroke="var(--text-primary)"
				stroke-width="1.5"
			/>
			<text x="70" y="24" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="12" font-weight="600" fill="var(--text-primary)">Tree 1</text>
			<text x="70" y="42" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="10" fill="var(--text-tertiary)" font-style="italic">binary · identity</text>
			<text x="70" y="58" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" fill="var(--text-quaternary)">depth 18&ndash;24</text>
		</g>

		<!-- Hub annotation (subtle, above Tree 1) -->
		<text x="313" y="38" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="9" fill="var(--text-quaternary)" style="text-transform: uppercase; letter-spacing: 0.06em;">hub</text>

		<!-- Link: Tree 1 ↔ Tree 3 (identity_commitment) -->
		<!-- Wider gap (140px) accommodates the full label. -->
		<path
			d="M 387 84 L 527 84"
			stroke="var(--coord-route-solid)"
			stroke-width="1.25"
			fill="none"
			opacity="0.7"
		/>
		<text x="457" y="76" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="10" fill="var(--coord-route-solid)">identity_commitment</text>

		<!-- ═════ Tree 3 — binary ═════ -->
		<g transform="translate(531, 50)">
			<rect
				x="0" y="0" width="140" height="68" rx="4"
				fill="#ffffff"
				stroke="var(--text-tertiary)"
				stroke-width="1"
			/>
			<text x="70" y="24" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="12" font-weight="600" fill="var(--text-primary)">Tree 3</text>
			<text x="70" y="42" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="10" fill="var(--text-tertiary)" font-style="italic">binary · engagement</text>
			<text x="70" y="58" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" fill="var(--text-quaternary)">depth 20</text>
		</g>

		<!-- ═════ Dashed separator — marks isolation boundary ═════ -->
		<line
			x1="695" y1="40" x2="695" y2="128"
			stroke="var(--coord-node-border)"
			stroke-dasharray="3 3"
			opacity="0.7"
		/>

		<!-- ═════ Position Tree — isolated, per-debate ═════ -->
		<g transform="translate(715, 50)">
			<rect
				x="0" y="0" width="130" height="68" rx="4"
				fill="#ffffff"
				stroke="var(--text-tertiary)"
				stroke-width="1"
			/>
			<text x="65" y="24" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="12" font-weight="600" fill="var(--text-primary)">Position Tree</text>
			<text x="65" y="42" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="10" fill="var(--text-tertiary)" font-style="italic">binary · per-debate</text>
			<text x="65" y="58" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="9" fill="var(--text-quaternary)">depth 20</text>
		</g>

		<text x="780" y="138" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="9" fill="var(--text-quaternary)" font-style="italic">isolated · pruned on settle</text>

		<!-- Core-trees annotation underneath -->
		<text x="345" y="138" text-anchor="middle" font-family="'Satoshi', sans-serif" font-size="9" fill="var(--text-quaternary)" font-style="italic">core · persistent, linked</text>
	</svg>

	<figcaption id="topology-caption" class="sr-only">
		Four-tree data topology. Tree 1 is the identity hub. Tree 2 (sparse Merkle, geographic) attaches to Tree 1 via the shared witness cell_id. Tree 3 (binary Merkle, engagement) attaches to Tree 1 via identity_commitment. Position Tree is cryptographically isolated: each debate has its own tree, pruned on settle.
	</figcaption>
</figure>

<style>
	.topology {
		margin: 0 0 2rem 0;
		padding: 0;
	}

	.topology svg {
		display: block;
		width: 100%;
		height: auto;
		max-width: 860px;
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
</style>
