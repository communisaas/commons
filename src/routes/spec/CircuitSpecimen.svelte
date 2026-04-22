<!--
  CircuitSpecimen — shell for a circuit's constraint graph.

  Structure:
    - Header (name + subtitle: identity ⟶ action)
    - Essence (one-line meaning)
    - Graph (child component: bespoke SVG cells for the circuit's constraints)
    - Footer (depth · gates · source · relates)

  Shared graph CSS lives here (:global) so child graph components just
  use the class names. This keeps the visual vocabulary consistent
  across all four circuits without duplication.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		name: string;
		subtitle: string;
		claim: string;
		hidden: string[];
		visible: string[];
		depth?: string;
		gates?: string;
		source: string;
		relates?: string;
		children: Snippet;
	}

	let {
		name,
		subtitle,
		claim,
		hidden,
		visible,
		depth,
		gates,
		source,
		relates,
		children
	}: Props = $props();

	const sourceUrl = `https://github.com/communisaas/voter-protocol/blob/main/${source}`;
</script>

<article class="circuit" aria-label={`Circuit ${name}`}>
	<header class="circuit-head">
		<h3 class="circuit-name">{name}</h3>
		<p class="circuit-subtitle">{subtitle}</p>
	</header>

	<p class="circuit-claim">{claim}</p>

	<div class="circuit-io">
		<div class="io-col io-hidden">
			<p class="io-region">Private &middot; stays with you</p>
			<ul class="io-tokens">
				{#each hidden as t}
					<li class="io-token io-token-hidden">{t}</li>
				{/each}
			</ul>
		</div>
		<div class="io-col io-visible">
			<p class="io-region">Public &middot; anyone can verify</p>
			<ul class="io-tokens">
				{#each visible as t}
					<li class="io-token io-token-visible">{t}</li>
				{/each}
			</ul>
		</div>
	</div>

	<div class="circuit-graph">
		{@render children()}
	</div>

	<footer class="circuit-foot">
		{#if depth}
			<span class="foot-item">
				<span class="foot-label">depth</span>
				<span class="foot-value mono">{depth}</span>
			</span>
		{/if}
		{#if gates}
			<span class="foot-item">
				<span class="foot-label">gates</span>
				<span class="foot-value mono">{gates}</span>
			</span>
		{/if}
		<a class="foot-src" href={sourceUrl} target="_blank" rel="noopener">
			<span class="foot-label">source</span>
			<code class="foot-path">{source}</code>
		</a>
		{#if relates}
			<p class="foot-relates">{@html relates}</p>
		{/if}
	</footer>
</article>

<style>
	/* ─── Shell ─── */
	.circuit {
		padding: 2rem 0 2.25rem;
		border-bottom: 1px dashed var(--coord-node-border);
	}

	.circuit:last-child {
		border-bottom: none;
	}

	.circuit-head {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.625rem;
	}

	.circuit-name {
		font-family: 'JetBrains Mono', monospace;
		font-size: 1.0625rem;
		font-weight: 500;
		color: var(--text-primary);
		letter-spacing: -0.005em;
		margin: 0;
	}

	.circuit-subtitle {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		letter-spacing: 0.01em;
		margin: 0;
		font-style: italic;
	}

	/* ─── Claim: the perceptual anchor. Dominant, direct assertion. ─── */
	.circuit-claim {
		font-family: 'Satoshi', sans-serif;
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--text-primary);
		line-height: 1.4;
		margin: 0 0 1.25rem 0;
		max-width: 44rem;
		letter-spacing: -0.01em;
	}
	@media (min-width: 640px) {
		.circuit-claim { font-size: 1.25rem; }
	}

	/* ─── Input/output tokens: same grammar as the primer ─── */
	.circuit-io {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		margin: 0 0 1.5rem 0;
		padding: 0.875rem 0;
		border-top: 1px dashed var(--coord-node-border);
		border-bottom: 1px dashed var(--coord-node-border);
	}

	.io-col {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.io-region {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.75rem;
		letter-spacing: 0;
		color: var(--text-tertiary);
		font-weight: 500;
		margin: 0;
	}

	.io-tokens {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.io-token {
		display: inline-block;
		padding: 0.25rem 0.625rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		border-radius: 3px;
		background: #ffffff;
	}

	.io-token-hidden {
		border: 1px dashed var(--text-tertiary);
		color: var(--text-secondary);
	}

	.io-token-visible {
		border: 1.25px solid var(--text-primary);
		color: var(--text-primary);
		font-weight: 500;
	}

	@media (max-width: 540px) {
		.circuit-io {
			grid-template-columns: 1fr;
			gap: 1rem;
		}
	}

	.circuit-graph {
		margin: 0 0 1.5rem 0;
	}

	.circuit-foot {
		display: flex;
		align-items: baseline;
		gap: 1.5rem;
		flex-wrap: wrap;
		font-family: 'Satoshi', sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.foot-item {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4375rem;
	}

	.foot-label {
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary);
	}

	.foot-value.mono {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.foot-src {
		display: inline-flex;
		align-items: baseline;
		gap: 0.4375rem;
		color: inherit;
		text-decoration: none;
		transition: color 180ms ease-out;
	}

	.foot-src:hover {
		color: var(--text-primary);
	}

	.foot-path {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: var(--text-secondary);
		background: none;
		padding: 0;
		border-bottom: 1px dashed var(--text-quaternary);
	}

	.foot-src:hover .foot-path {
		border-bottom-color: var(--text-primary);
		color: var(--text-primary);
	}

	.foot-relates {
		flex-basis: 100%;
		font-family: 'Satoshi', sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-style: italic;
		margin: 0.25rem 0 0 0;
		line-height: 1.55;
	}

	.foot-relates :global(code) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: var(--coord-route-solid);
		background: none;
		padding: 0;
		font-style: normal;
	}

	/* ══════════════════════════════════════════════════════════════════ */
	/* Shared graph vocabulary — applies to all circuit graph SVGs.      */
	/* ══════════════════════════════════════════════════════════════════ */

	/* Grid of constraint cells: 1-col mobile, 2-col ≥640px */
	:global(.graph) {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	@media (min-width: 640px) {
		:global(.graph) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 1.25rem;
		}
	}

	/* Each constraint renders as a "cell" — a small framed SVG + formal caption */
	:global(.graph-cell) {
		display: flex;
		flex-direction: column;
		padding: 0.875rem 1rem 1rem;
		border: 1px solid var(--coord-node-border);
		border-radius: 4px;
		background: var(--surface-base);
	}

	:global(.graph-cell-head) {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}

	:global(.graph-cell-num) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: var(--coord-route-solid);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	:global(.graph-cell-title) {
		font-family: 'Satoshi', sans-serif;
		font-size: 0.8125rem;
		color: var(--text-primary);
		font-weight: 500;
	}

	:global(.graph-cell-note) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: var(--text-quaternary);
		margin-left: auto;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}

	:global(.graph-svg) {
		display: block;
		width: 100%;
		height: auto;
		max-width: 420px;
		margin: 0.25rem auto 0.625rem;
	}

	:global(.graph-cell-eq) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		margin: 0;
		text-align: center;
		line-height: 1.55;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--coord-node-border);
		overflow-wrap: anywhere;
	}

	:global(.graph-cell-eq .ic) {
		color: var(--coord-route-solid);
		font-weight: 600;
	}

	/* SVG primitives — node shapes */
	:global(.g-witness) {
		fill: #ffffff;
		stroke: var(--text-tertiary);
		stroke-width: 1;
		stroke-dasharray: 3 2;
	}

	:global(.g-public) {
		fill: #ffffff;
		stroke: var(--text-primary);
		stroke-width: 1.25;
	}

	:global(.g-shared) {
		fill: rgba(59, 196, 184, 0.08);
		stroke: var(--coord-route-solid);
		stroke-width: 1.5;
	}

	:global(.g-closure-peg) {
		fill: rgba(59, 196, 184, 0.06);
		stroke: var(--coord-route-solid);
		stroke-width: 1.5;
	}

	/* Text labels */
	:global(.g-label) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		fill: var(--text-secondary);
	}

	:global(.g-label-public) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		fill: var(--text-primary);
		font-weight: 500;
	}

	:global(.g-label-ic) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		fill: var(--coord-route-solid);
		font-weight: 600;
	}

	:global(.g-label-closure) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		fill: var(--coord-route-solid);
		font-weight: 600;
	}

	:global(.g-label-derived) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		fill: var(--text-tertiary);
		font-style: italic;
	}

	:global(.g-label-tag) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 8.5px;
		fill: var(--text-quaternary);
		letter-spacing: 0.04em;
	}

	/* Operators */
	:global(.g-op) {
		fill: #ffffff;
		stroke: var(--text-primary);
		stroke-width: 1.25;
	}

	:global(.g-op-label) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		fill: var(--text-primary);
		font-weight: 500;
	}

	/* Arrows and closures */
	:global(.g-arrow) {
		stroke: var(--text-tertiary);
		stroke-width: 1;
		fill: none;
	}

	:global(.g-arrow-ic) {
		stroke: var(--coord-route-solid);
		stroke-width: 1.25;
		fill: none;
		opacity: 0.8;
	}

	:global(.g-closure) {
		stroke: var(--coord-route-solid);
		stroke-width: 1.5;
		stroke-dasharray: 4 3;
		fill: none;
		opacity: 0.75;
	}

	:global(.g-equiv) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		fill: var(--coord-route-solid);
		font-weight: 700;
	}

	:global(.g-tick) {
		stroke: var(--coord-route-solid);
		stroke-width: 1;
		opacity: 0.55;
	}

	/* Tree-membership ladder — cascading H nodes instead of an opaque box.
	   Used for merkle₂₀ and smt primitives: the sibling-path is the proof. */
	:global(.g-ladder-node) {
		fill: #ffffff;
		stroke: var(--text-primary);
		stroke-width: 1.25;
	}
	:global(.g-ladder-node-label) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		fill: var(--text-primary);
		font-weight: 500;
	}
	:global(.g-ladder-elision) {
		fill: none;
		stroke: var(--text-tertiary);
		stroke-width: 0.75;
		stroke-dasharray: 1.5 2.5;
		opacity: 0.7;
	}
	:global(.g-ladder-elision-label) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 8.5px;
		fill: var(--text-tertiary);
		letter-spacing: 0.02em;
	}
	/* Bit glyph: tiny teal digit (0/1) that tags each SMT level with the
	   bit of the key deciding L/R. Absent on Merkle ladders. */
	:global(.g-ladder-bit) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 9px;
		fill: var(--coord-route-solid);
		font-weight: 600;
	}
	:global(.g-ladder-bit-tick) {
		stroke: var(--coord-route-solid);
		stroke-width: 0.9;
		opacity: 0.6;
	}
	:global(.g-ladder-cap) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 8.5px;
		fill: var(--text-tertiary);
		letter-spacing: 0.02em;
	}
	:global(.g-ladder-cap em) {
		font-style: normal;
		color: var(--coord-route-solid);
	}

	@media (max-width: 480px) {
		:global(.graph-cell-eq) {
			font-size: 0.625rem;
		}
	}

	/* Wide cells (like three_tree's cross-tree-binding) keep their geometry
	   and scroll horizontally on narrow screens — the ic fork visual is
	   load-bearing and can't be meaningfully compressed. */
	@media (max-width: 639px) {
		:global(.graph-cell-wide) {
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
		}

		:global(.graph-svg-wide) {
			min-width: 560px;
		}
	}
</style>
