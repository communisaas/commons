<!--
  LandscapeSpace — Power: targets, bills, and accountability.

  Three reads folded into ONE surface: the decision-makers you follow, the bills
  you watch, and the accountability scorecards you've earned. Each was its own
  route (/representatives, /legislation, /scorecards); Power composes them as
  a single object so the operator sees the whole terrain at a glance. Data is
  loaded ONCE by the org layout (`+layout.server.ts` → `data.spaces.landscape`,
  reusing the three routes' Convex reads) and threaded in as a prop — switching
  into Power is a pure state toggle, no route load.

  The interactive tooling — follow/unfollow, watch/unwatch, set position, bill
  search, CSV export — stays on the deep routes (still resolvable), which own the
  mutation endpoints. Power is the composed view plus the doors into each tool.

  HONESTY RULE: only REAL terrain renders. Empty follow/watch/scorecard sets get
  honest empty states, never faked counts. When legislation is not configured,
  bills + scorecards are marked "not yet armed" rather than shown as zero. A null
  slice renders a dormant state.
-->
<script lang="ts">
	import ScorecardCard from '$lib/components/org/ScorecardCard.svelte';
	import {
		buildPowerTerrainReadiness,
		getGateEvidence,
		type PowerTerrainRow
	} from '$lib/data/capability-hypergraph';
	import { Datum } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';
	import WorkspaceCapabilityStrip from './WorkspaceCapabilityStrip.svelte';
	import type { LandscapeSpaceData } from './spaces';

	type PowerHeaderMetric = {
		value: number | null;
		label: string;
		cite: string;
	};

	let {
		data,
		base
	}: {
		/** Power slice from the layout load. Null when the DM read failed. */
		data: LandscapeSpaceData | null;
		/** `/org/[slug]` — for the deep links into each terrain tool. */
		base: string;
	} = $props();

	function partyColor(party: string | null): string {
		switch (party) {
			case 'D':
				return 'oklch(0.5 0.18 260)';
			case 'R':
				return 'oklch(0.5 0.18 25)';
			case 'I':
				return 'oklch(0.5 0.14 290)';
			case 'L':
				return 'oklch(0.62 0.14 70)';
			default:
				return 'oklch(0.6 0.01 250)';
		}
	}

	function locationLabel(jurisdiction: string | null, district: string | null): string {
		if (!jurisdiction) return '';
		return district ? `${jurisdiction}-${district}` : jurisdiction;
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'passed':
			case 'signed':
				return 'oklch(0.5 0.14 165)';
			case 'failed':
			case 'vetoed':
				return 'oklch(0.55 0.15 25)';
			case 'floor':
				return 'oklch(0.6 0.14 85)';
			default:
				return 'oklch(0.55 0.06 250)';
		}
	}

	const followed = $derived(data?.followed ?? []);
	const bills = $derived(data?.bills ?? []);
	const scorecards = $derived(data?.scorecards ?? []);
	const legislationEnabled = $derived(data?.legislationEnabled ?? false);
	const stateLocalTerrainGate = getGateEvidence(
		'CP-state-local-terrain',
		['T3-1', 'T3-2', 'T3-10'],
		{
			name: 'State/local power terrain',
			downstream: 3,
			dependency: 'OpenStates, special-district officeholders, and per-district feeds'
		}
	);
	const internationalTerrainGate = getGateEvidence(
		'CP-international-power-terrain',
		['T3-3', 'T3-4', 'T3-5'],
		{
			name: 'International power resolver',
			downstream: 3,
			dependency: 'CA, GB, and AU representative lookup wiring'
		}
	);
	const stateBillTerrainGate = getGateEvidence('CP-state-bill-terrain', ['T6-6', 'T3-1'], {
		name: 'State bill terrain',
		downstream: 4,
		dependency: 'OpenStates or equivalent state-bill ingestion plus state legislator data'
	});
	const nonFederalScorecardGate = getGateEvidence('CP-non-federal-scorecards', ['T6-6', 'T3-1'], {
		name: 'Non-federal scorecard terrain',
		downstream: 3,
		dependency: 'State bill ingestion + state officeholder coverage'
	});
	const readerOfficeGate = getGateEvidence('CP-reader-office-profile', ['T8-1a', 'T8-1b', 'T8-8'], {
		name: 'Reader office response terrain',
		downstream: 4,
		dependency:
			'Decision-maker office profile enrichment, office-response workflow, and notification webhooks'
	});
	const powerTerrainReadiness = $derived(
		buildPowerTerrainReadiness({
			base,
			power: {
				loaded: !!data,
				legislationEnabled,
				followedCount: data?.followedCount ?? null,
				discoverableOfficialCount: null,
				watchedBillCount: data?.bills.length ?? null,
				scorecardCount: data?.scorecardSnapshotCount ?? null
			},
			gates: {
				powerStateLocalTerrainGate: stateLocalTerrainGate,
				powerInternationalTerrainGate: internationalTerrainGate,
				powerStateBillTerrainGate: stateBillTerrainGate,
				powerNonFederalScorecardGate: nonFederalScorecardGate,
				powerOfficeResponseGate: readerOfficeGate
			}
		})
	);
	const powerTerrainRows = $derived<PowerTerrainRow[]>(powerTerrainReadiness.rows);
	const capabilityItems = $derived(
		powerTerrainRows.map((row) => ({
			label: row.label,
			state: row.state,
			phase: row.phase,
			cluster: row.clusters,
			action: row.action,
			detail: row.ground,
			unlock: row.boundary,
			href: row.href,
			metric: row.metric
		}))
	);
	const terrainCountMetric = $derived({
		value: powerTerrainReadiness.terrainCount,
		label: 'loaded terrain records',
		cite: 'legislation.listOrgDmFollows + legislation.listWatchedBills + legislation.listOrgScorecards'
	});
	const powerHeaderMetrics = $derived<PowerHeaderMetric[]>([
		{
			value: data?.followedCount ?? null,
			label: 'followed targets',
			cite: 'legislation.listOrgDmFollows followedCount'
		},
		{
			value: data?.legislationEnabled ? bills.length : null,
			label: 'watched bills',
			cite: 'legislation.listWatchedBills'
		},
		{
			value: data?.legislationEnabled ? data.scorecardSnapshotCount : null,
			label: 'score snapshots',
			cite: 'legislation.listOrgScorecards scored snapshots'
		},
		{
			value: terrainCountMetric.value,
			label: terrainCountMetric.label,
			cite: terrainCountMetric.cite
		}
	]);
</script>

<div class="landscape" style="--timing-slow: {TIMING.SLOW}ms; --easing: {EASING};">
	<header class="landscape-head">
		<div class="landscape-head-copy">
			<h1 class="landscape-title">Power</h1>
			<p class="landscape-sub">
				Decision-makers, bills, and accountability signals in one working surface.
			</p>
		</div>
		<div class="landscape-head-instrument">
			<div class="landscape-proof-counts" aria-label="Power terrain evidence counts">
				{#each powerHeaderMetrics as metric (metric.label)}
					<span class="landscape-proof-count">
						<Datum value={metric.value} cite={metric.cite} />
						<span>{metric.label}</span>
					</span>
				{/each}
			</div>
		</div>
	</header>

	{#if !data}
		<p class="landscape-dormant">
			This shell did not attach Power terrain evidence; target, bill, score, and wider-terrain
			coverage claims remain unclaimed and uncounted in this read.
		</p>
	{:else}
		<WorkspaceCapabilityStrip label="Power capability" items={capabilityItems} />
		<section class="terrain-readout" aria-label="Power terrain boundary">
			<div class="terrain-readout-copy">
				<span class="terrain-label">Power terrain coverage</span>
				<p>{powerTerrainReadiness.effect} {powerTerrainReadiness.detail}</p>
			</div>
			<div class="terrain-readout-metric">
				<Datum
					value={terrainCountMetric.value}
					cite={terrainCountMetric.cite}
					class="terrain-readout-num"
				/>
				<span>{terrainCountMetric.label}</span>
			</div>
		</section>

		<!-- POWER TARGETS -->
		<section class="terrain" aria-label="Power targets">
			<div class="terrain-head">
				<span class="terrain-label">Power Targets</span>
				<span class="terrain-count">
					<Datum value={data.followedCount} class="terrain-count-num" /> followed
				</span>
				<a class="terrain-deep" href="{base}/representatives" data-sveltekit-preload-data="off"
					>Open power targets →</a
				>
			</div>

			{#if followed.length === 0}
				<p class="terrain-empty">
					No power targets tracked yet. <a class="terrain-empty-link" href="{base}/representatives"
						>Open power targets</a
					> to follow the people your actions need to move.
				</p>
			{:else}
				<ul class="dm-list">
					{#each followed as dm (dm.id)}
						<li class="dm-item">
							{#if dm.party}
								<span class="dm-party" style="background: {partyColor(dm.party)}">{dm.party}</span>
							{:else}
								<span class="dm-party dm-party--none">·</span>
							{/if}
							<a class="dm-name" href="{base}/representatives/{dm.id}">{dm.name}</a>
							<span class="dm-meta">
								{#if dm.title}{dm.title}{/if}
								{#if dm.title && dm.jurisdiction}<span class="dm-sep">·</span>{/if}
								{#if dm.jurisdiction}{locationLabel(dm.jurisdiction, dm.district)}{/if}
							</span>
							<span class="dm-via"
								>{dm.reason === 'campaign_delivery' ? 'via delivery' : 'manual'}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- BILLS -->
		<section class="terrain" aria-label="Bills">
			<div class="terrain-head">
				<span class="terrain-label">Bills</span>
				{#if legislationEnabled}
					<span class="terrain-count">
						<Datum value={bills.length} class="terrain-count-num" /> watched
					</span>
					<a class="terrain-deep" href="{base}/legislation" data-sveltekit-preload-data="off"
						>Open bills terrain →</a
					>
				{/if}
			</div>

			{#if !legislationEnabled}
				<p class="terrain-latent">
					Not yet armed — bill tracking lands when legislation features enable for this org.
				</p>
			{:else if bills.length === 0}
				<p class="terrain-empty">
					No bills being watched. <a class="terrain-empty-link" href="{base}/legislation"
						>Open bills</a
					> to track the bills your actions reference.
				</p>
			{:else}
				<ul class="bill-list">
					{#each bills as bill (bill.id)}
						<li class="bill-item">
							<span class="bill-status" style="color: {statusColor(bill.status)}"
								>{bill.status || '—'}</span
							>
							<span class="bill-title">{bill.title}</span>
							{#if bill.position}
								<span class="bill-position" data-position={bill.position}>{bill.position}</span>
							{/if}
							<span class="bill-ext">{bill.externalId}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- ACCOUNTABILITY SCORES -->
		<section class="terrain" aria-label="Accountability scores">
			<div class="terrain-head">
				<span class="terrain-label">Accountability Scores</span>
				{#if legislationEnabled}
					<span class="terrain-count">
						<Datum value={data.scorecardSnapshotCount} class="terrain-count-num" /> snapshots
						{#if data.scorecardSnapshotCount > 0}
							<span class="terrain-sep">·</span> avg <Datum
								value={data.scorecardAvg}
								class="terrain-count-num"
							/>
						{/if}
					</span>
					<a class="terrain-deep" href="{base}/scorecards" data-sveltekit-preload-data="off"
						>Open accountability scores →</a
					>
				{/if}
			</div>

			{#if !legislationEnabled}
				<p class="terrain-latent">
					Not yet armed — accountability scores compute once legislation features enable and proof
					reports land.
				</p>
			{:else if scorecards.length === 0}
				<p class="terrain-empty">
					No accountability scores yet. <a class="terrain-empty-link" href="{base}/scorecards"
						>Open accountability scores</a
					> once proof reports begin moving power targets.
				</p>
			{:else}
				<div class="card-list">
					{#each scorecards as scorecard (scorecard.name + scorecard.district)}
						<ScorecardCard {scorecard} />
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.landscape {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		width: 100%;
	}

	/* ─── Head ─── */
	.landscape-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.landscape-head-copy {
		min-width: 0;
	}
	.landscape-head-instrument {
		display: flex;
		flex-shrink: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.625rem;
	}
	.landscape-proof-counts {
		display: flex;
		max-width: 36rem;
		flex-wrap: wrap;
		justify-content: flex-start;
		gap: 0.5rem 0.875rem;
	}
	.landscape-proof-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-secondary, oklch(0.42 0.015 60));
		white-space: nowrap;
	}
	.landscape-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0;
	}
	.landscape-sub {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
		max-width: 36rem;
	}
	.landscape-dormant {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		font-style: italic;
		margin: 0;
		max-width: 40rem;
	}

	.terrain-readout {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.875rem 1rem;
		border-radius: 6px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	.terrain-readout-copy {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}
	.terrain-readout-copy p {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.45;
		color: var(--text-secondary, oklch(0.38 0.012 60));
		margin: 0;
		max-width: 52rem;
	}
	.terrain-readout-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		flex-shrink: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		color: var(--text-tertiary, #6b7280);
		white-space: nowrap;
	}
	.terrain-readout-metric :global(.terrain-readout-num) {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	/* ─── Terrain section ─── */
	.terrain {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.terrain-head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.terrain-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: oklch(0.55 0.01 250);
	}
	.terrain-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b7280);
	}
	.terrain :global(.terrain-count-num) {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.terrain-sep,
	.dm-sep {
		color: oklch(0.78 0.01 250);
	}
	.terrain-deep {
		margin-left: auto;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
		transition: color var(--timing-slow) var(--easing);
	}
	.terrain-deep:hover,
	.terrain-deep:focus-visible {
		text-decoration: underline;
		outline: none;
	}
	.terrain-empty,
	.terrain-latent {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
		max-width: 40rem;
	}
	.terrain-latent {
		font-style: italic;
	}
	.terrain-empty-link {
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
	}
	.terrain-empty-link:hover,
	.terrain-empty-link:focus-visible {
		text-decoration: underline;
		outline: none;
	}

	/* ─── Decision-maker list ─── */
	.dm-list,
	.bill-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.dm-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	.dm-party {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 50%;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5rem;
		font-weight: 700;
		color: #ffffff;
		flex-shrink: 0;
	}
	.dm-party--none {
		background: oklch(0.92 0.005 60);
		color: oklch(0.6 0.01 250);
	}
	.dm-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
		text-decoration: none;
		flex-shrink: 0;
		transition: color var(--timing-slow) var(--easing);
	}
	.dm-name:hover {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.dm-meta {
		flex: 1;
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b7280);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dm-via {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		color: oklch(0.62 0.01 250);
	}

	/* ─── Bill list ─── */
	.bill-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	.bill-status {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.bill-title {
		flex: 1;
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-primary, oklch(0.25 0.01 60));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bill-position {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		font-weight: 500;
	}
	.bill-position[data-position='support'] {
		color: oklch(0.5 0.14 165);
	}
	.bill-position[data-position='oppose'] {
		color: oklch(0.55 0.15 25);
	}
	.bill-ext {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		color: oklch(0.62 0.01 250);
	}

	/* ─── Scorecard list ─── */
	.card-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	@media (max-width: 760px) {
		.landscape-head {
			flex-direction: column;
		}
	}

	@media (min-width: 860px) {
		.landscape-head-instrument {
			align-items: flex-end;
		}
		.landscape-proof-counts {
			justify-content: flex-end;
		}
	}
</style>
