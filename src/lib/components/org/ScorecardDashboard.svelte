<!--
  ScorecardDashboard — accountability scores for the decision-makers an org
  follows, in plain words: how each scored, what was sent to them, what came
  back. Sort and CSV export stay here; every number traces to the org's own
  scorecard read.
-->
<script lang="ts">
	import ScorecardCard from './ScorecardCard.svelte';
	import {
		SCORECARDS_BUILD_SENTENCE,
		describeReportSignals
	} from '$lib/components/org/os/power-coverage';
	import { Datum } from '$lib/design';
	import type { DecisionMakerScore } from '$lib/server/legislation/scorecard/types';

	type ScorecardMeta = {
		orgId: string;
		computedAt: string;
		decisionMakers: number;
		avgScore: number | null;
		totalFollowed?: number;
		withScorecards?: number;
	};

	let {
		scorecards,
		meta,
		orgSlug,
		orgName,
		isMember = true
	}: {
		scorecards: DecisionMakerScore[];
		meta: ScorecardMeta;
		orgSlug: string;
		orgName: string;
		isMember?: boolean;
	} = $props();

	type SortKey = 'score' | 'name' | 'alignment';
	type ScorecardSignalKey = 'reportsOpened' | 'repliesLogged';
	let sortBy = $state<SortKey>('score');

	function scoreSortValue(score: number | null): number {
		return score ?? -1;
	}

	function sumKnown(rows: DecisionMakerScore[], key: ScorecardSignalKey): number | null {
		let sum = 0;
		let hasKnown = false;
		for (const row of rows) {
			const value = row[key];
			if (value !== null) {
				sum += value;
				hasKnown = true;
			}
		}
		return hasKnown ? sum : null;
	}

	const sorted = $derived(
		(() => {
			const copy = [...scorecards];
			switch (sortBy) {
				case 'name':
					return copy.sort((a, b) => a.name.localeCompare(b.name));
				case 'alignment':
					return copy.sort((a, b) => (b.alignmentRate ?? -1) - (a.alignmentRate ?? -1));
				case 'score':
				default:
					return copy.sort((a, b) => scoreSortValue(b.score) - scoreSortValue(a.score));
			}
		})()
	);

	function handleExportCSV(): void {
		window.location.href = `/api/org/${orgSlug}/scorecards/export?format=csv`;
	}

	// Desktop: cards default expanded; mobile: collapsed
	let isDesktop = $state(false);

	$effect(() => {
		const mql = window.matchMedia('(min-width: 768px)');
		isDesktop = mql.matches;
		const handler = (e: MediaQueryListEvent) => {
			isDesktop = e.matches;
		};
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	const scoreSnapshotCount = $derived(
		meta.withScorecards ?? scorecards.filter((scorecard) => scorecard.score !== null).length
	);
	const reportSignals = $derived(
		describeReportSignals({
			reportsReceived: scorecards.reduce(
				(total, scorecard) => total + scorecard.reportsReceived,
				0
			),
			reportsOpened: sumKnown(scorecards, 'reportsOpened'),
			repliesLogged: sumKnown(scorecards, 'repliesLogged')
		})
	);
</script>

<div class="scorecard-dashboard">
	<!-- Header -->
	<div class="dashboard-header">
		<div>
			<p class="dashboard-kicker">Power / Accountability</p>
			<h1 class="dashboard-title">Accountability scores</h1>
			{#if scoreSnapshotCount > 0}
				<p class="dashboard-subtitle">
					{orgName}: <Datum value={scoreSnapshotCount} />
					score snapshot{scoreSnapshotCount === 1 ? '' : 's'}{#if meta.avgScore !== null}
						&nbsp;&middot; Avg score <Datum value={meta.avgScore} />{/if}
				</p>
			{/if}
			{#if scorecards.length > 0}
				<p class="dashboard-signals">{reportSignals}</p>
			{/if}
		</div>
	</div>

	<!-- Controls -->
	{#if scorecards.length > 0}
		<div class="controls">
			{#if isMember}
				<div class="control-actions">
					<button class="btn-secondary" onclick={handleExportCSV}> Export CSV </button>
				</div>
			{/if}
			<div class="sort-controls">
				<span class="sort-label">Sort:</span>
				<button
					class="sort-btn"
					class:active={sortBy === 'score'}
					onclick={() => (sortBy = 'score')}
				>
					Score
				</button>
				<button class="sort-btn" class:active={sortBy === 'name'} onclick={() => (sortBy = 'name')}>
					Name
				</button>
				<button
					class="sort-btn"
					class:active={sortBy === 'alignment'}
					onclick={() => (sortBy = 'alignment')}
				>
					Alignment
				</button>
			</div>
		</div>
	{/if}

	<!-- Cards or Empty State -->
	{#if sorted.length === 0}
		<div id="scorecard-list" class="empty-state">
			<div class="empty-inner">
				<p class="empty-title">No accountability scores yet</p>
				<p class="empty-body">{SCORECARDS_BUILD_SENTENCE}</p>
				<a href="/org/{orgSlug}/campaigns/new" class="empty-cta"> Create action </a>
			</div>
		</div>
	{:else}
		<div id="scorecard-list" class="card-list">
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

	.dashboard-kicker {
		margin-bottom: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-quaternary);
	}

	.dashboard-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--text-primary);
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
	}

	.dashboard-subtitle {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.dashboard-signals {
		margin-top: 0.25rem;
		font-size: 0.75rem;
		color: var(--text-tertiary);
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
		display: inline-flex;
		align-items: center;
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		color: var(--text-secondary);
		background: var(--surface-raised);
		border: 1px solid var(--surface-border);
		cursor: pointer;
		text-decoration: none;
		transition:
			background 0.15s,
			color 0.15s;
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
