<!--
  TreeSpecimen — a single Merkle tree rendered with leaf formula as
  the strong center.

  Structure:
    - Left: name + construction (identity)
    - Right: leaf formula (strong center), marginalia (depth/node/lifecycle),
      and cross-tree annotation when this tree links to another.

  The leaf is where the architectural claim lives. Depth and node form
  are container specs; they go marginal.
-->
<script lang="ts">
	interface Props {
		name: string;
		construction: string;
		leaf: string;
		depth: string;
		depthNote?: string;
		node: string;
		lifecycle: string;
		crossTree?: string;
	}

	let { name, construction, leaf, depth, depthNote, node, lifecycle, crossTree }: Props = $props();
</script>

<article class="tree-spec">
	<div class="ts-identity">
		<h3 class="ts-name">{name}</h3>
		<p class="ts-construction">{construction}</p>
	</div>

	<div class="ts-body">
		<div class="ts-leaf">
			<p class="ts-leaf-label">Leaf</p>
			<code class="ts-leaf-formula">{leaf}</code>
		</div>

		<dl class="ts-meta">
			<div>
				<dt>depth</dt>
				<dd>
					<span class="meta-mono">{depth}</span>
					{#if depthNote}
						<span class="meta-note">&nbsp;&middot;&nbsp;{depthNote}</span>
					{/if}
				</dd>
			</div>
			<div>
				<dt>node</dt>
				<dd><span class="meta-mono">{node}</span></dd>
			</div>
			<div>
				<dt>lifecycle</dt>
				<dd>{lifecycle}</dd>
			</div>
		</dl>

		{#if crossTree}
			<p class="ts-cross">
				<span class="cross-arrow" aria-hidden="true">&#8627;</span>
				<span class="cross-label">cross-tree</span>
				<span class="cross-body">{@html crossTree}</span>
			</p>
		{/if}
	</div>
</article>

<style>
	.tree-spec {
		display: grid;
		grid-template-columns: 180px 1fr;
		column-gap: 2rem;
		padding: 1.5rem 0;
		border-bottom: 1px dashed var(--coord-node-border);
	}

	.tree-spec:last-child {
		border-bottom: none;
	}

	.ts-identity {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.ts-name {
		font-family: 'Satoshi', sans-serif;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text-primary);
		letter-spacing: -0.01em;
		margin: 0;
	}

	.ts-construction {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin: 0;
	}

	.ts-body {
		display: flex;
		flex-direction: column;
		gap: 1.125rem;
	}

	/* Leaf — the strong center */
	.ts-leaf {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.ts-leaf-label {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary);
		margin: 0;
	}

	.ts-leaf-formula {
		display: block;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.9375rem;
		color: var(--text-primary);
		background: none;
		padding: 0.5rem 0.875rem;
		border-left: 2px solid var(--coord-route-solid);
		background: rgba(59, 196, 184, 0.04);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	/* Marginalia */
	.ts-meta {
		display: grid;
		grid-template-columns: 5.5rem 1fr;
		column-gap: 1rem;
		row-gap: 0.375rem;
		margin: 0;
	}

	.ts-meta > div {
		display: contents;
	}

	.ts-meta dt {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary);
		padding-top: 0.125rem;
	}

	.ts-meta dd {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin: 0;
		line-height: 1.5;
	}

	.meta-mono {
		font-family: 'JetBrains Mono', monospace;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	.meta-note {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-style: italic;
	}

	/* Cross-tree annotation */
	.ts-cross {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin: 0;
		padding: 0.625rem 0.875rem;
		background: rgba(0, 0, 0, 0.02);
		border-radius: 4px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.cross-arrow {
		color: var(--coord-route-solid);
		font-size: 0.9375rem;
	}

	.cross-label {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary);
	}

	.cross-body :global(code) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--coord-route-solid);
		background: none;
		padding: 0;
	}

	.cross-body :global(a) {
		color: var(--text-primary);
		text-decoration: none;
		border-bottom: 1px dashed var(--text-quaternary);
	}

	@media (max-width: 720px) {
		.tree-spec {
			grid-template-columns: 1fr;
			row-gap: 0.875rem;
		}
	}
</style>
