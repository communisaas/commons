<!--
  StudioSources — the GROUND verdict, made legible.

  Renders the source-ground pool with each source's incentive_position.
  The ordering is intentional and unintuitive: an adversarial-but-supporting
  source ranks HIGHEST ("even [opponent] acknowledges…") because the
  opponent's own data is the strongest argument. This component surfaces that
  ranking honestly — it does not re-sort to "most agreeable first."

  Every source here is real: it comes from the message-generation `complete`
  event's source payload (Exa search → Firecrawl fetch → Gemini incentive-aware
  evaluation when available). Where Gemini evaluation failed, the source carries
  the literal fallback rationale ("Evaluation unavailable…"); this component
  counts it as search-only source ground rather than fake evaluated confidence
  (the HONESTY RULE).
-->
<script lang="ts" module>
	export interface StudioSource {
		num: number;
		title: string;
		url: string;
		type: 'journalism' | 'research' | 'government' | 'legal' | 'advocacy' | 'other';
		credibility_rationale?: string;
		incentive_position?: 'adversarial' | 'neutral' | 'aligned';
		source_order?: 'primary' | 'secondary' | 'opinion';
	}
</script>

<script lang="ts">
	import { Datum } from '$lib/design';

	let {
		sources
	}: {
		/** Attached source ground from the live message stream. */
		sources: StudioSource[];
	} = $props();

	// Incentive ranking weight. Adversarial ranks HIGHEST — intentional.
	const INCENTIVE_RANK: Record<NonNullable<StudioSource['incentive_position']>, number> = {
		adversarial: 0,
		neutral: 1,
		aligned: 2
	};

	const INCENTIVE_META = {
		adversarial: {
			label: 'Adversarial',
			gloss: 'opponent’s own data — strongest argument',
			color: 'var(--coord-verified, #10b981)'
		},
		neutral: {
			label: 'Neutral',
			gloss: 'disinterested authority',
			color: 'var(--coord-route-solid, #3bc4b8)'
		},
		aligned: {
			label: 'Aligned',
			gloss: 'constituency signal, not neutral authority',
			color: 'var(--coord-share, #4f46e5)'
		}
	} as const;

	const FALLBACK_MARKER = 'Evaluation unavailable';

	const ranked = $derived(
		[...sources].sort((a, b) => {
			const ra = a.incentive_position ? INCENTIVE_RANK[a.incentive_position] : 99;
			const rb = b.incentive_position ? INCENTIVE_RANK[b.incentive_position] : 99;
			if (ra !== rb) return ra - rb;
			return a.num - b.num;
		})
	);

	const adversarialCount = $derived(
		sources.filter((s) => s.incentive_position === 'adversarial').length
	);
	const fallbackCount = $derived(sources.filter(isFallback).length);
	const evaluatedCount = $derived(sources.length - fallbackCount);

	function isFallback(s: StudioSource): boolean {
		return !s.incentive_position || (s.credibility_rationale ?? '').startsWith(FALLBACK_MARKER);
	}

	function hostOf(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}
</script>

<section class="sources" aria-label="Source ground">
	<header class="sources-head">
		<span class="sources-title">Source ground</span>
		<span class="sources-counts">
			<span class="sources-count">
				<Datum value={sources.length} class="sources-count-num" />
				<span class="sources-count-label">attached</span>
			</span>
			<span class="sources-count">
				<Datum value={evaluatedCount} class="sources-count-num" />
				<span class="sources-count-label">evaluated</span>
			</span>
			{#if adversarialCount > 0}
				<span class="sources-count">
					<Datum value={adversarialCount} class="sources-count-num sources-count-num--adv" />
					<span class="sources-count-label">adversarial, ranked first</span>
				</span>
			{/if}
			{#if fallbackCount > 0}
				<span class="sources-count">
					<Datum value={fallbackCount} class="sources-count-num sources-count-num--boundary" />
					<span class="sources-count-label">search-only</span>
				</span>
			{/if}
		</span>
	</header>

	{#if sources.length === 0}
		<p class="sources-empty">No source ground yet. It surfaces here as GROUND completes.</p>
	{:else}
		<ol class="sources-list">
			{#each ranked as source (source.num)}
				{@const fallback = isFallback(source)}
				{@const meta = source.incentive_position
					? INCENTIVE_META[source.incentive_position]
					: null}
				<li class="source">
					<span class="source-num">[{source.num}]</span>
					<div class="source-body">
						<a class="source-title" href={source.url} target="_blank" rel="noopener noreferrer">
							{source.title}
						</a>
						<span class="source-meta">
							<span class="source-host">{hostOf(source.url)}</span>
							<span class="source-sep">·</span>
							<span class="source-type">{source.type}</span>
							{#if source.source_order}
								<span class="source-sep">·</span>
								<span class="source-order">{source.source_order}</span>
							{/if}
						</span>

						{#if fallback}
							<p class="source-boundary">
								Credibility assessment not available — this source was included on search
								relevance only.
							</p>
						{:else if meta}
							<span
								class="source-incentive"
								style="--inc-color: {meta.color};"
							>
								<span class="source-incentive-dot" aria-hidden="true"></span>
								<span class="source-incentive-label">{meta.label}</span>
								<span class="source-incentive-gloss">{meta.gloss}</span>
							</span>
							{#if source.credibility_rationale}
								<p class="source-rationale">{source.credibility_rationale}</p>
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.sources {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.sources-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.sources-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.sources-counts {
		display: flex;
		align-items: baseline;
		gap: 1rem;
	}

	.sources-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
	}

	.sources :global(.sources-count-num) {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.sources :global(.sources-count-num--adv) {
		color: var(--coord-verified, #10b981);
	}
	.sources :global(.sources-count-num--boundary) {
		color: var(--coord-warn, oklch(0.62 0.14 65));
	}

	.sources-count-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--text-tertiary, #6b7280);
	}

	.sources-empty {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: var(--text-tertiary, #6b7280);
		font-style: italic;
		margin: 0;
	}

	.sources-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.source {
		display: flex;
		gap: 0.625rem;
	}

	.source-num {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.75rem;
		color: var(--coord-route-solid, #3bc4b8);
		padding-top: 0.0625rem;
	}

	.source-body {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		min-width: 0;
	}

	.source-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
		text-decoration: none;
		line-height: 1.4;
	}
	.source-title:hover,
	.source-title:focus-visible {
		text-decoration: underline;
		outline: none;
	}

	.source-meta {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		color: var(--text-tertiary, #9ca3af);
		display: inline-flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.source-sep {
		opacity: 0.5;
	}

	.source-incentive {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.125rem;
	}

	.source-incentive-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--inc-color);
		flex-shrink: 0;
	}

	.source-incentive-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--inc-color);
	}

	.source-incentive-gloss {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--text-tertiary, #6b7280);
	}

	.source-rationale {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-secondary, oklch(0.4 0.01 60));
		margin: 0.125rem 0 0;
	}

	.source-boundary {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-secondary, oklch(0.4 0.01 60));
		margin: 0.25rem 0 0;
		padding-left: 0.5rem;
		border-left: 2px solid var(--coord-warn, oklch(0.72 0.12 70));
	}
</style>
