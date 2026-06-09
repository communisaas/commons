<script lang="ts">
	import WorkspaceCapabilityStrip from './os/WorkspaceCapabilityStrip.svelte';
	import ScorecardCard from './ScorecardCard.svelte';
	import { FEATURES } from '$lib/config/features';
	import {
		buildAccountabilityResponseReadiness,
		formatGateEvidence,
		getGateEvidence,
		type AccountabilityResponseReadinessRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments
	} from '$lib/data/capability-state-labels';
	import { Datum, Ratio } from '$lib/design';
	import type { DecisionMakerScore } from '$lib/server/legislation/scorecard/types';

	type CapabilityState = 'live' | 'partial' | 'draft-only' | 'gated';
	type CapabilityItem = {
		label: string;
		state: CapabilityState;
		phase: string;
		cluster: string;
		action: string;
		detail: string;
		unlock: string;
		href: string;
		handoff?: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};
	type AccountabilityResponsePressureReadout = {
		id: string;
		label: string;
		state: CapabilityState;
		title: string;
		action: string;
		detail: string;
		gate: string;
		href: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

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
	type ScorecardSignalKey =
		| 'reportsOpened'
		| 'verifyLinksClicked'
		| 'repliesLogged'
		| 'relevantVotes'
		| 'alignedVotes';
	let sortBy = $state<SortKey>('score');

	function scoreSortValue(score: number | null): number {
		return score ?? -1;
	}

	function sumKnown(rows: DecisionMakerScore[], keys: ScorecardSignalKey[]): number | null {
		let sum = 0;
		let hasKnown = false;
		for (const row of rows) {
			for (const key of keys) {
				const value = row[key];
				if (value !== null) {
					sum += value;
					hasKnown = true;
				}
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
	const reportsSentCount = $derived(
		scorecards.reduce((total, scorecard) => total + scorecard.reportsReceived, 0)
	);
	const openedReportCount = $derived(sumKnown(scorecards, ['reportsOpened']));
	const verifyClickCount = $derived(sumKnown(scorecards, ['verifyLinksClicked']));
	const replyCount = $derived(sumKnown(scorecards, ['repliesLogged']));
	const alignedVoteCount = $derived(sumKnown(scorecards, ['alignedVotes']));
	const voteBasisCount = $derived(sumKnown(scorecards, ['relevantVotes']));
	const scorecardSnapshotGate = getGateEvidence('CP-scorecard-snapshot-basis', ['T6-5', 'T6-8'], {
		name: 'Scorecard snapshot basis',
		downstream: 2,
		dependency: 'Receipt API + methodology versioning'
	});
	const nonFederalScorecardGate = getGateEvidence('CP-non-federal-scorecards', ['T6-6', 'T3-1'], {
		name: 'Non-federal scorecard terrain',
		downstream: 3,
		dependency: 'State bill ingestion + state officeholder coverage'
	});
	const readerOfficeGate = getGateEvidence('CP-dm-office-profile', ['T8-1b', 'T8-8'], {
		name: 'Reader office response surface',
		downstream: 4,
		dependency: 'Reader-office workflow + notification webhooks'
	});
	const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2', 'T6-9'], {
		name: 'Receipt anchoring for scorecards',
		downstream: 4,
		dependency: 'Receipt writer/mainnet anchoring + durable event history'
	});
	const accountabilityResponseReadiness = $derived(
		buildAccountabilityResponseReadiness({
			base: `/org/${orgSlug}`,
			response: {
				loaded: true,
				scorecardCount: scoreSnapshotCount,
				receiptCount: reportsSentCount,
				openedCount: openedReportCount,
				verifyClickCount,
				replyCount,
				alignedVoteCount,
				relevantVoteCount: voteBasisCount
			},
			features: {
				ACCOUNTABILITY: FEATURES.ACCOUNTABILITY,
				LEGISLATION: FEATURES.LEGISLATION
			},
			gates: {
				receiptAnchoringGate,
				readerOfficeGate,
				nonFederalScorecardGate
			}
		})
	);
	const accountabilityResponseRows = $derived<AccountabilityResponseReadinessRow[]>(
		accountabilityResponseReadiness.rows
	);
	const accountabilityResponseStateCounts = $derived({
		live: accountabilityResponseRows.filter((row) => row.state === 'live').length,
		partial: accountabilityResponseRows.filter((row) => row.state === 'partial').length,
		'draft-only': accountabilityResponseRows.filter((row) => row.state === 'draft-only').length,
		gated: accountabilityResponseRows.filter((row) => row.state === 'gated').length
	});
	const accountabilityResponseHeldCount = $derived(
		accountabilityResponseStateCounts['draft-only'] + accountabilityResponseStateCounts.gated
	);
	const accountabilityResponseSegments = $derived(
		operatorCapabilityStateRatioSegments(accountabilityResponseStateCounts, {
			labelSuffix: ' response contracts'
		})
	);
	const responseSignalCount = $derived(accountabilityResponseReadiness.responseSignalCount);
	const proofDeliveryResponseRow = $derived(
		accountabilityResponseRows.find((row) => row.id === 'proof-delivery-register') ?? null
	);
	const readerSignalResponseRows = $derived(
		accountabilityResponseRows.filter((row) =>
			['opened-response-signal', 'verified-link-signal', 'reply-log'].includes(row.id)
		)
	);
	const strongestReaderSignalResponseRow = $derived(
		readerSignalResponseRows.find((row) => row.state === 'partial' || row.state === 'live') ??
			readerSignalResponseRows[0] ??
			null
	);
	const heldAccountabilityResponseRows = $derived(
		accountabilityResponseRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const firstHeldAccountabilityResponseRow = $derived(
		heldAccountabilityResponseRows.find((row) => row.id !== 'proof-delivery-register') ??
			heldAccountabilityResponseRows[0] ??
			null
	);
	const nextResponseLiftRow = $derived(
		firstHeldAccountabilityResponseRow ??
			accountabilityResponseRows.find((row) => row.id === 'reader-office-workflow') ??
			proofDeliveryResponseRow
	);
	const accountabilityResponsePressureReadouts = $derived<AccountabilityResponsePressureReadout[]>([
		{
			id: 'response-ground',
			label: 'Response ground',
			state: proofDeliveryResponseRow?.state ?? accountabilityResponseReadiness.state,
			title: proofDeliveryResponseRow?.handoff ?? accountabilityResponseReadiness.handoff,
			action: proofDeliveryResponseRow?.action ?? accountabilityResponseReadiness.action,
			detail: proofDeliveryResponseRow?.ground ?? accountabilityResponseReadiness.effect,
			gate: proofDeliveryResponseRow?.boundary ?? accountabilityResponseReadiness.gate,
			href: proofDeliveryResponseRow?.href ?? accountabilityResponseReadiness.href,
			metric: proofDeliveryResponseRow?.metric ?? accountabilityResponseReadiness.metric
		},
		{
			id: 'reader-signals',
			label: 'Reader signals',
			state: strongestReaderSignalResponseRow?.state ?? accountabilityResponseReadiness.state,
			title: strongestReaderSignalResponseRow?.handoff ?? 'Reader response signals',
			action: strongestReaderSignalResponseRow?.action ?? 'read response boundary',
			detail:
				strongestReaderSignalResponseRow?.ground ??
				'Opened, verified, and replied signals are response evidence, not office workflow.',
			gate:
				strongestReaderSignalResponseRow?.boundary ??
				formatGateEvidence(readerOfficeGate, {
					prefix:
						'Reader-office response remains bounded until workflow and notification surfaces land.'
				}),
			href: strongestReaderSignalResponseRow?.href ?? '#scorecard-public-boundary',
			metric: {
				value: responseSignalCount,
				label: 'reader signals',
				cite: 'buildAccountabilityResponseReadiness'
			}
		},
		{
			id: 'next-response-lift',
			label: 'Next response lift',
			state: nextResponseLiftRow?.state ?? accountabilityResponseReadiness.state,
			title: nextResponseLiftRow?.handoff ?? accountabilityResponseReadiness.nextGate.name,
			action: nextResponseLiftRow?.action ?? 'read response boundary',
			detail: nextResponseLiftRow?.ground ?? accountabilityResponseReadiness.detail,
			gate:
				nextResponseLiftRow?.boundary ??
				formatGateEvidence(accountabilityResponseReadiness.nextGate, {
					prefix:
						'Reader-office workflow, non-federal scorecards, and anchored response batches stay dependency-first.'
				}),
			href: nextResponseLiftRow?.href ?? '#scorecard-public-boundary',
			metric: {
				value: voteBasisCount,
				label: 'scored votes',
				cite: 'LandscapeScorecard.relevantVotes'
			}
		}
	]);
	const scorecardExportCapabilityItem = $derived<CapabilityItem>({
		label: 'Scorecard CSV export',
		state: scorecards.length > 0 ? 'live' : 'draft-only',
		phase: 'AGGREGATE',
		cluster: 'C-data-sovereignty / C-accountability',
		action: scorecards.length > 0 ? 'export csv' : 'wait for scores',
		detail:
			'Members can export non-PII scorecard rows; export does not publish a public org setting.',
		unlock: formatGateEvidence(scorecardSnapshotGate, {
			complete:
				'CSV export is live for loaded scorecards; public reader-office workflow remains separate.'
		}),
		href:
			scorecards.length > 0
				? `/api/org/${orgSlug}/scorecards/export?format=csv`
				: '#scorecard-public-boundary',
		metric: {
			value: reportsSentCount,
			label: 'reports sent',
			cite: 'scorecardSnapshots.deliveriesSent'
		}
	});
	const capabilityItems = $derived<CapabilityItem[]>([
		...accountabilityResponseRows.map((row) => ({
			label: row.label,
			state: row.state,
			phase: row.phase,
			cluster: row.clusters,
			action: row.action,
			handoff: row.handoff,
			detail: row.ground,
			unlock: row.boundary,
			href: row.href,
			metric: row.metric
		})),
		scorecardExportCapabilityItem
	]);

	function stateLabel(state: CapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function actionLabel(state: CapabilityState, action: string): string {
		return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });
	}

	function pressureAria(readout: AccountabilityResponsePressureReadout): string {
		const value =
			readout.metric.value === null ? 'unread' : readout.metric.value.toLocaleString('en-US');
		return `${readout.label}. ${stateLabel(readout.state)}. ${readout.title}. ${value} ${readout.metric.label}. ${readout.detail} Gate: ${readout.gate}`;
	}
</script>

<div class="scorecard-dashboard">
	<!-- Header -->
	<div class="dashboard-header">
		<div>
			<p class="dashboard-kicker">Power / Accountability</p>
			<h1 class="dashboard-title">Accountability scores</h1>
			<p class="dashboard-subtitle">
				{orgName}: <Datum
					value={scoreSnapshotCount}
					cite="legislation.listOrgScorecards withScorecards"
				/>
				score snapshot{scoreSnapshotCount === 1 ? '' : 's'} &middot; Avg score
				<Datum value={meta.avgScore} cite="known scorecard composite average" />
			</p>
		</div>
	</div>

	<WorkspaceCapabilityStrip label="Accountability score capability" items={capabilityItems} />

	<section class="response-posture" aria-label="Scorecard accountability response posture">
		<div class="response-posture-head">
			<div>
				<p class="response-posture-kicker">Accountability response posture</p>
				<h2 class="response-posture-title">Where reader signals become accountable ground</h2>
			</div>
			<div
				class="response-contract-count"
				aria-label={`${accountabilityResponseRows.length} response contracts; ${accountabilityResponseStateCounts.live} armed; ${accountabilityResponseStateCounts.partial} bounded; ${accountabilityResponseHeldCount} held`}
			>
				<span>
					<Datum
						value={accountabilityResponseRows.length}
						cite="buildAccountabilityResponseReadiness"
					/>
					contracts
				</span>
				<span>
					<Datum
						value={accountabilityResponseStateCounts.live}
						cite="buildAccountabilityResponseReadiness"
					/>
					armed
				</span>
				<span>
					<Datum
						value={accountabilityResponseStateCounts.partial}
						cite="buildAccountabilityResponseReadiness"
					/>
					bounded
				</span>
				<span>
					<Datum
						value={accountabilityResponseHeldCount}
						cite="buildAccountabilityResponseReadiness"
					/>
					held
				</span>
			</div>
		</div>
		<div class="response-ratio" aria-label="Accountability response state mix">
			<Ratio segments={accountabilityResponseSegments} height={8} />
		</div>
		<div class="response-axis" aria-label="Scorecard response axis">
			<span>response</span>
			<span>signals</span>
			<span>lift</span>
			<span>gate</span>
		</div>
		<div class="response-pressure-grid" aria-label="Scorecard accountability response pressure">
			{#each accountabilityResponsePressureReadouts as readout (readout.id)}
				<a
					href={readout.href}
					class="response-pressure-cell"
					data-state={readout.state}
					aria-label={pressureAria(readout)}
					data-sveltekit-preload-data="off"
				>
					<span class="response-pressure-kicker">{readout.label}</span>
					<span class="response-pressure-title">{readout.title}</span>
					<span class="response-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="response-pressure-detail">{readout.detail}</span>
					<span class="response-pressure-action">
						{actionLabel(readout.state, readout.action)}
					</span>
					<span class="response-pressure-gate">{readout.gate}</span>
				</a>
			{/each}
		</div>
	</section>

	<div id="scorecard-public-boundary" class="scorecard-boundary">
		<div class="boundary-copy">
			<p class="boundary-title">Scorecard surface boundary</p>
			<p class="boundary-body">
				Loaded accountability scores are org-side evidence. CSV export is live for members. This
				route does not expose a public org publish switch; reader-office workflows, notification
				webhooks, and archive-grade anchored receipt batches remain gated.
			</p>
		</div>
		<div class="boundary-metrics" aria-label="Accountability score evidence basis">
			<div>
				<p class="boundary-num">
					<Datum value={scoreSnapshotCount} cite="legislation.listOrgScorecards withScorecards" />
				</p>
				<p class="boundary-label">snapshots</p>
			</div>
			<div>
				<p class="boundary-num">
					<Datum
						value={reportsSentCount}
						cite="scorecardSnapshots.deliveriesSent or receiptCount"
					/>
				</p>
				<p class="boundary-label">reports</p>
			</div>
			<div>
				<p class="boundary-num boundary-num--accent">
					<Datum
						value={responseSignalCount}
						cite="scorecardSnapshots deliveriesOpened/deliveriesVerified/repliesReceived"
					/>
				</p>
				<p class="boundary-label">responses</p>
			</div>
		</div>
	</div>

	<!-- Controls -->
	{#if scorecards.length > 0}
		<div class="controls">
			{#if isMember}
				<div class="control-actions">
					<button class="btn-secondary" onclick={handleExportCSV}> Export CSV </button>
					<a class="btn-secondary" href="#scorecard-public-boundary">Surface boundary</a>
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
				<p class="empty-body">
					Send proof reports to decision-makers to start tracking accountability.
				</p>
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

	.mono {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}

	.response-posture {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--surface-border);
		border-radius: 0.375rem;
		background: var(--surface-base);
	}

	.response-posture-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.response-posture-kicker,
	.response-pressure-kicker,
	.response-axis,
	.response-contract-count {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.response-posture-kicker,
	.response-axis,
	.response-contract-count {
		color: var(--text-quaternary);
	}

	.response-posture-title {
		margin-top: 0.25rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.response-contract-count {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.65rem;
		text-align: right;
	}

	.response-contract-count span {
		display: inline-flex;
		align-items: baseline;
		gap: 0.2rem;
	}

	.response-ratio {
		min-height: 8px;
	}

	.response-axis {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.5rem;
		padding-top: 0.25rem;
		border-top: 1px solid var(--surface-border);
	}

	.response-pressure-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.response-pressure-cell {
		display: flex;
		min-height: 13rem;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--surface-border);
		border-radius: 0.375rem;
		background: var(--surface-overlay);
		color: inherit;
		text-decoration: none;
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	.response-pressure-cell:hover {
		border-color: var(--text-tertiary);
	}

	.response-pressure-cell[data-state='live'] {
		border-color: rgb(20 184 166 / 0.35);
		background: rgb(20 184 166 / 0.1);
	}

	.response-pressure-cell[data-state='partial'] {
		border-color: rgb(59 130 246 / 0.3);
		background: rgb(59 130 246 / 0.1);
	}

	.response-pressure-cell[data-state='draft-only'] {
		border-color: rgb(245 158 11 / 0.3);
		background: rgb(245 158 11 / 0.1);
	}

	.response-pressure-kicker {
		color: var(--text-quaternary);
	}

	.response-pressure-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.response-pressure-metric {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.response-pressure-detail,
	.response-pressure-gate {
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--text-tertiary);
	}

	.response-pressure-action {
		margin-top: auto;
		font-size: 0.75rem;
		font-weight: 700;
		color: rgb(94 234 212);
	}

	.response-pressure-gate {
		color: var(--text-quaternary);
	}

	.scorecard-boundary {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid rgb(245 158 11 / 0.3);
		border-radius: 0.375rem;
		background: rgb(245 158 11 / 0.1);
	}

	.boundary-copy {
		max-width: 42rem;
	}

	.boundary-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: rgb(252 211 77);
	}

	.boundary-body {
		margin-top: 0.25rem;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--text-tertiary);
	}

	.boundary-metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
		min-width: 16rem;
		text-align: center;
	}

	.boundary-num {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.boundary-num--accent {
		color: rgb(94 234 212);
	}

	.boundary-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		color: var(--text-quaternary);
	}

	@media (max-width: 720px) {
		.response-posture-head,
		.scorecard-boundary {
			flex-direction: column;
		}

		.response-contract-count {
			justify-content: flex-start;
			text-align: left;
		}

		.response-axis,
		.response-pressure-grid {
			grid-template-columns: 1fr;
		}

		.boundary-metrics {
			width: 100%;
			min-width: 0;
		}
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
