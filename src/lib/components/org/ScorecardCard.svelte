<script lang="ts">
	import type { DecisionMakerScore } from '$lib/server/legislation/scorecard/types';

	let {
		scorecard,
		defaultExpanded = false
	}: {
		scorecard: DecisionMakerScore;
		defaultExpanded?: boolean;
	} = $props();

	let expanded = $state(defaultExpanded);

	function scoreClass(score: number): string {
		if (score >= 67) return 'score-high';
		if (score >= 34) return 'score-mid';
		return 'score-low';
	}

	function formatHours(hours: number | null): string {
		if (hours === null) return '--';
		if (hours < 1) return '<1h';
		if (hours < 24) return `${Math.round(hours)}h`;
		const days = Math.round(hours / 24);
		return `${days}d`;
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '--';
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function formatAlignment(rate: number | null): string {
		if (rate === null) return '--';
		return `${Math.round(rate * 100)}%`;
	}
</script>

<div class="scorecard-card">
	<button
		class="scorecard-header"
		onclick={() => expanded = !expanded}
		aria-expanded={expanded}
		aria-label="Toggle details for {scorecard.name}"
	>
		<div class="header-info">
			<span class="official-name">{scorecard.name}</span>
			{#if scorecard.title || scorecard.district}
				<span class="official-detail">
					{#if scorecard.title}{scorecard.title}{/if}
					{#if scorecard.title && scorecard.district} &middot; {/if}
					{#if scorecard.district}{scorecard.district}{/if}
				</span>
			{/if}
		</div>
		<div class="header-score">
			<span
				class="score-badge {scoreClass(scorecard.score)}"
				role="img"
				aria-label="Score: {scorecard.score} out of 100"
			>
				{scorecard.score}
			</span>
			<svg
				class="expand-icon"
				class:rotated={expanded}
				width="16" height="16" viewBox="0 0 24 24"
				fill="none" stroke="currentColor" stroke-width="2"
			>
				<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
			</svg>
		</div>
	</button>

	{#if expanded}
		<div class="scorecard-body">
			<div class="metrics-grid">
				<div class="metric-section">
					<p class="metric-label">Engagement</p>
					<div class="metric-rows">
						<div class="metric-row">
							<span class="metric-key">{scorecard.reportsReceived} reports sent</span>
						</div>
						<div class="metric-row">
							<span class="metric-key">{scorecard.reportsOpened} opened</span>
						</div>
						<div class="metric-row">
							<span class="metric-key">{scorecard.verifyLinksClicked} verify click{scorecard.verifyLinksClicked !== 1 ? 's' : ''}</span>
						</div>
						<div class="metric-row">
							<span class="metric-key">{scorecard.repliesLogged} repl{scorecard.repliesLogged !== 1 ? 'ies' : 'y'} logged</span>
						</div>
					</div>
				</div>

				<div class="metric-section">
					<p class="metric-label">Alignment</p>
					<div class="metric-rows">
						{#if scorecard.relevantVotes > 0}
							<div class="metric-row">
								<span class="metric-key">{scorecard.alignedVotes}/{scorecard.relevantVotes} votes aligned ({formatAlignment(scorecard.alignmentRate)})</span>
							</div>
						{:else}
							<div class="metric-row">
								<span class="metric-key dim">No tracked votes yet</span>
							</div>
						{/if}
					</div>
				</div>

				<div class="metric-section">
					<p class="metric-label">Responsiveness</p>
					<div class="metric-rows">
						<div class="metric-row">
							<span class="metric-key">Avg: {formatHours(scorecard.avgResponseTime)}</span>
						</div>
						<div class="metric-row">
							<span class="metric-key">Last: {formatDate(scorecard.lastContactDate)}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.scorecard-card {
		border: 1px solid var(--surface-border);
		background: var(--surface-raised);
	}

	.scorecard-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 1rem 1.25rem;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		color: var(--text-primary);
		transition: background 0.15s;
	}

	.scorecard-header:hover {
		background: var(--surface-overlay);
	}

	.header-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.official-name {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		font-family: monospace;
	}

	.official-detail {
		font-size: 0.6875rem;
		color: var(--text-tertiary);
		font-family: monospace;
	}

	.header-score {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.score-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.5rem;
		height: 2rem;
		padding: 0 0.5rem;
		font-family: monospace;
		font-weight: 700;
		font-size: 0.875rem;
		border: 1px solid;
	}

	.score-high {
		color: #34d399;
		background: rgba(52, 211, 153, 0.1);
		border-color: rgba(52, 211, 153, 0.2);
	}

	.score-mid {
		color: #fbbf24;
		background: rgba(251, 191, 36, 0.1);
		border-color: rgba(251, 191, 36, 0.2);
	}

	.score-low {
		color: #f87171;
		background: rgba(248, 113, 113, 0.1);
		border-color: rgba(248, 113, 113, 0.2);
	}

	.expand-icon {
		color: var(--text-quaternary);
		transition: transform 0.15s;
		flex-shrink: 0;
	}

	.expand-icon.rotated {
		transform: rotate(180deg);
	}

	.scorecard-body {
		padding: 0 1.25rem 1.25rem;
		border-top: 1px solid var(--surface-border);
	}

	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.25rem;
		padding-top: 1rem;
	}

	@media (max-width: 640px) {
		.metrics-grid {
			grid-template-columns: 1fr;
			gap: 1rem;
		}
	}

	.metric-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.metric-label {
		font-size: 0.625rem;
		font-family: monospace;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
	}

	.metric-rows {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.metric-row {
		display: flex;
		align-items: center;
	}

	.metric-key {
		font-size: 0.75rem;
		font-family: monospace;
		color: var(--text-secondary);
	}

	.metric-key.dim {
		color: var(--text-quaternary);
	}
</style>
