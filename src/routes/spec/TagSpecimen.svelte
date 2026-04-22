<!--
  TagSpecimen — a single domain tag as a typological specimen.

  Structure:
    - ASCII identity (primary): "H2M"
    - Hex provenance (derived): = 0x48324d
    - State layout: four cells showing where the tag sits in the Poseidon2
      state, with user inputs, the tag slot (accented), and zero padding
      visually distinct
    - Marginalia: arity, use

  The strong center is the state layout: position in the state IS the
  separation invariant. Everything else is supporting metadata.
-->
<script lang="ts">
	type TagSlot = { kind: 'tag'; label: string };
	type InputSlot = { kind: 'input'; label: string };
	type ZeroSlot = { kind: 'zero' };
	export type Slot = TagSlot | InputSlot | ZeroSlot;

	interface Props {
		name: string;
		hex: string;
		layout: Slot[] | null;
		layoutNote?: string;
		arity: string;
		use: string;
	}

	let { name, hex, layout, layoutNote, arity, use }: Props = $props();
</script>

<article class="spec" aria-label={`Domain tag ${name}`}>
	<div class="spec-identity">
		<p class="spec-name">"{name}"</p>
		<p class="spec-hex">= <span class="hex-val">{hex}</span></p>
	</div>

	<div class="spec-layout">
		{#if layout}
			<ol class="state-cells" aria-label="State layout">
				{#each layout as slot}
					{#if slot.kind === 'tag'}
						<li class="cell cell-tag"><span class="cell-label">{slot.label}</span></li>
					{:else if slot.kind === 'zero'}
						<li class="cell cell-zero"><span class="cell-label">0</span></li>
					{:else}
						<li class="cell cell-input"><span class="cell-label">{slot.label}</span></li>
					{/if}
				{/each}
			</ol>
		{:else if layoutNote}
			<p class="layout-note">{layoutNote}</p>
		{/if}
	</div>

	<dl class="spec-meta">
		<div>
			<dt>arity</dt>
			<dd class="meta-arity">{arity}</dd>
		</div>
		<div class="spec-use">
			<dt>use</dt>
			<dd>{use}</dd>
		</div>
	</dl>
</article>

<style>
	.spec {
		display: grid;
		grid-template-columns: 180px 1fr;
		grid-template-rows: auto auto;
		align-items: start;
		column-gap: 2rem;
		row-gap: 0.75rem;
		padding: 1.5rem 0;
		border-bottom: 1px dashed var(--coord-node-border);
	}

	.spec:last-child {
		border-bottom: none;
	}

	.spec-identity {
		grid-row: 1 / 3;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.spec-name {
		font-family: 'JetBrains Mono', monospace;
		font-size: 1.125rem;
		font-weight: 500;
		color: var(--text-primary);
		letter-spacing: -0.005em;
		margin: 0;
	}

	.spec-hex {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin: 0;
		font-variant-numeric: tabular-nums;
	}

	.spec-hex .hex-val {
		color: var(--coord-route-solid);
	}

	/* State layout cells — the strong center */
	.state-cells {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		align-items: stretch;
		gap: 0;
		max-width: 400px;
	}

	.cell {
		flex: 1 1 0;
		min-width: 0;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		border: 1px solid var(--coord-node-border);
		background: #ffffff;
		color: var(--text-secondary);
	}

	.cell + .cell {
		border-left: none;
	}

	.cell:first-child {
		border-top-left-radius: 4px;
		border-bottom-left-radius: 4px;
	}

	.cell:last-child {
		border-top-right-radius: 4px;
		border-bottom-right-radius: 4px;
	}

	.cell-label {
		padding: 0 0.25rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	/* Tag slot — the accent, the point of the whole diagram */
	.cell-tag {
		background: rgba(59, 196, 184, 0.10);
		border-color: rgba(59, 196, 184, 0.38);
		color: var(--text-primary);
		font-weight: 500;
	}

	.cell + .cell-tag {
		border-left: 1px solid rgba(59, 196, 184, 0.38);
	}

	.cell-tag + .cell {
		border-left: 1px solid rgba(59, 196, 184, 0.38);
	}

	/* Input slots — user-supplied values, italic */
	.cell-input .cell-label {
		font-style: italic;
		color: var(--text-tertiary);
	}

	/* Zero-padding slots — faded, dashed */
	.cell-zero {
		background: transparent;
		border-style: dashed;
		color: var(--text-quaternary);
	}

	.cell + .cell-zero {
		border-left: 1px dashed var(--coord-node-border);
	}

	.cell-zero + .cell {
		border-left: 1px dashed var(--coord-node-border);
	}

	.layout-note {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.8125rem;
		color: var(--text-tertiary);
		font-style: italic;
		margin: 0;
		padding: 0.75rem 0.875rem;
		border: 1px dashed var(--coord-node-border);
		border-radius: 4px;
		max-width: 400px;
	}

	/* Marginalia — arity + use */
	.spec-meta {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 2rem;
		row-gap: 0.25rem;
		align-items: baseline;
		margin: 0;
		max-width: 40rem;
	}

	.spec-meta > div {
		display: contents;
	}

	.spec-meta dt {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary);
	}

	.spec-meta dd {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin: 0;
		line-height: 1.55;
	}

	.meta-arity {
		font-family: 'JetBrains Mono', monospace;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 720px) {
		.spec {
			grid-template-columns: 1fr;
			grid-template-rows: auto auto auto;
			row-gap: 0.875rem;
		}

		.spec-identity {
			grid-row: auto;
		}

		.state-cells,
		.layout-note {
			max-width: none;
		}
	}
</style>
