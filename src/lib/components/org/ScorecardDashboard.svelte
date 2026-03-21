<script lang="ts">
	import ScorecardCard from './ScorecardCard.svelte';
	import type { DecisionMakerScore } from '$lib/server/legislation/scorecard/types';

	let {
		scorecards,
		meta,
		orgSlug,
		orgName,
		isMember = true
	}: {
		scorecards: DecisionMakerScore[];
		meta: { orgId: string; computedAt: string; decisionMakers: number; avgScore: number };
		orgSlug: string;
		orgName: string;
		isMember?: boolean;
	} = $props();

	type SortKey = 'score' | 'name' | 'alignment';
	let sortBy = $state<SortKey>('score');
	let makingPublic = $state(false);

	const sorted = $derived((() => {
		const copy = [...scorecards];
		switch (sortBy) {
			case 'name':
				return copy.sort((a, b) => a.name.localeCompare(b.name));
			case 'alignment':
				return copy.sort((a, b) => (b.alignmentRate ?? -1) - (a.alignmentRate ?? -1));
			case 'score':
			default:
				return copy.sort((a, b) => b.score - a.score);
		}
	})());

	function handleExportCSV(): void {
		window.location.href = `/api/org/${orgSlug}/scorecards/export?format=csv`;
	}

	async function togglePublic(): Promise<void> {
		makingPublic = true;
		try {
			await fetch(`/api/org/${orgSlug}/settings`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ scorecardsPublic: true })
			});
		} catch {
			// Stub: API not implemented yet
		}
		makingPublic = false;
	}

	// Desktop: cards default expanded; mobile: collapsed
	let isDesktop = $state(false);

	$effect(() => {
		const mql = window.matchMedia('(min-width: 768px)');
		isDesktop = mql.matches;
		const handler = (e: MediaQueryListEvent) => { isDesktop = e.matches; };
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});
</script>

<div class="scorecard-dashboard">
	<!-- Header -->
	<div class="dashboard-header">
		<div>
			<h1 class="dashboard-title">{orgName} -- Decision-Maker Scorecards</h1>
			<p class="dashboard-subtitle">
				<span class="mono">{meta.decisionMakers}</span> official{meta.decisionMakers !== 1 ? 's' : ''} tracked
				&middot; Avg score: <span class="mono">{meta.avgScore}</span>
			</p>
		</div>
	</div>

	<!-- Controls -->
	{#if scorecards.length > 0}
		<div class="controls">
			{#if isMember}
				<div class="control-actions">
					<button class="btn-secondary" onclick={handleExportCSV}>
						Export CSV
					</button>
					<button
						class="btn-secondary"
						onclick={togglePublic}
						disabled={makingPublic}
					>
						{makingPublic ? 'Saving...' : 'Make Public'}
					</button>
				</div>
			{/if}
			<div class="sort-controls">
				<span class="sort-label">Sort:</span>
				<button
					class="sort-btn"
					class:active={sortBy === 'score'}
					onclick={() => sortBy = 'score'}
				>
					Score
				</button>
				<button
					class="sort-btn"
					class:active={sortBy === 'name'}
					onclick={() => sortBy = 'name'}
				>
					Name
				</button>
				<button
					class="sort-btn"
					class:active={sortBy === 'alignment'}
					onclick={() => sortBy = 'alignment'}
				>
					Alignment
				</button>
			</div>
		</div>
	{/if}

	<!-- Cards or Empty State -->
	{#if sorted.length === 0}
		<div class="empty-state">
			<div class="empty-inner">
				<p class="empty-title">No scorecards yet</p>
				<p class="empty-body">
					Send proof reports to decision-makers to start tracking accountability.
				</p>
				<a href="/org/{orgSlug}/campaigns/new" class="empty-cta">
					Create Campaign
				</a>
			</div>
		</div>
	{:else}
		<div class="card-list">
			{#each sorted as scorecard (scorecard.name + scorecard.district)}
				<ScorecardCard {scorecard} defaultExpanded={isDesktop} />
			{/each}
		</div>
	{/if}
</div>

<style>
	.scorecard-dashboard {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.dashboard-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.dashboard-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--text-primary);
		font-family: monospace;
	}

	.dashboard-subtitle {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.mono {
		font-family: monospace;
		font-variant-numeric: tabular-nums;
	}

	.controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.control-actions {
		display: flex;
		gap: 0.5rem;
	}

	.btn-secondary {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		font-family: monospace;
		color: var(--text-secondary);
		background: var(--surface-raised);
		border: 1px solid var(--surface-border);
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.btn-secondary:hover {
		background: var(--surface-overlay);
		color: var(--text-primary);
	}

	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.sort-controls {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.sort-label {
		font-size: 0.6875rem;
		color: var(--text-quaternary);
		font-family: monospace;
	}

	.sort-btn {
		padding: 0.25rem 0.5rem;
		font-size: 0.6875rem;
		font-family: monospace;
		color: var(--text-tertiary);
		background: none;
		border: 1px solid transparent;
		cursor: pointer;
		transition: all 0.15s;
	}

	.sort-btn:hover {
		color: var(--text-secondary);
		border-color: var(--surface-border);
	}

	.sort-btn.active {
		color: var(--text-primary);
		border-color: var(--surface-border-strong, var(--surface-border));
		background: var(--surface-raised);
	}

	.card-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.empty-state {
		border: 1px solid var(--surface-border);
		background: var(--surface-raised);
		padding: 3rem 1.5rem;
	}

	.empty-inner {
		text-align: center;
		max-width: 24rem;
		margin: 0 auto;
	}

	.empty-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-secondary);
		font-family: monospace;
		margin-bottom: 0.5rem;
	}

	.empty-body {
		font-size: 0.75rem;
		color: var(--text-quaternary);
		line-height: 1.5;
		margin-bottom: 1rem;
	}

	.empty-cta {
		display: inline-block;
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		font-family: monospace;
		color: #2dd4bf;
		border: 1px solid rgba(45, 212, 191, 0.3);
		text-decoration: none;
		transition: all 0.15s;
	}

	.empty-cta:hover {
		background: rgba(45, 212, 191, 0.1);
	}
</style>
