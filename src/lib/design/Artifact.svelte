<script lang="ts">
	/**
	 * Artifact — A bounded object that earns card treatment.
	 *
	 * Use for things that FLOAT above the warm cream ground:
	 * proof specimens, email previews, browsable template cards,
	 * RelayLoom node cards.
	 *
	 * Do NOT use for: entity lists, form sections, metric displays,
	 * settings groups — use EntityCluster or raw proximity spacing.
	 *
	 * Provides footnote context: Cite form="footnote" children collect
	 * at the bottom as numbered references automatically.
	 */
	import type { Snippet } from 'svelte';
	import { setContext } from 'svelte';
	import { FootnoteRegistry, FOOTNOTE_CTX } from './footnote-registry.svelte';

	let {
		padding = 'default',
		class: className = '',
		children
	}: {
		/** Internal padding. 'compact' for dense artifacts like email previews. */
		padding?: 'compact' | 'default' | 'spacious';
		/** Additional CSS classes */
		class?: string;
		children: Snippet;
	} = $props();

	const PAD_MAP = { compact: 'p-4', default: 'p-6', spacious: 'p-8' } as const;
	const padClass = $derived(PAD_MAP[padding]);

	// Provide footnote collection context for Cite form="footnote"
	const footnotes = new FootnoteRegistry();
	setContext(FOOTNOTE_CTX, footnotes);
</script>

<div
	class="artifact {padClass} {className}"
	style="
		background: #ffffff;
		border: 1px solid var(--coord-node-border);
		border-radius: 8px;
		box-shadow:
			inset 0 1px 0 0 rgba(255, 255, 255, 0.6),
			0 1px 3px 0 oklch(0 0 0 / 0.04),
			var(--coord-node-shadow);
	"
>
	{@render children()}

	{#if footnotes.entries.length > 0}
		<footer class="artifact-footnotes">
			<hr class="artifact-footnotes-rule" />
			{#each footnotes.entries as entry, i}
				<p class="artifact-footnote" id={entry.id}>
					<sup class="artifact-footnote-ref">{i + 1}</sup>
					{entry.content}
				</p>
			{/each}
		</footer>
	{/if}
</div>

<style>
	.artifact-footnotes {
		margin-top: 1.5rem;
		padding-top: 0.75rem;
	}

	.artifact-footnotes-rule {
		border: none;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		margin: 0 0 0.5rem 0;
	}

	.artifact-footnote {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem; /* 11px — subordinate to content */
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		margin: 0.25rem 0;
		padding-left: 1rem;
		text-indent: -1rem;
	}

	.artifact-footnote-ref {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem; /* 9px */
		font-variant-numeric: tabular-nums;
		color: var(--coord-route-solid, #3bc4b8);
		margin-right: 0.25rem;
	}
</style>
