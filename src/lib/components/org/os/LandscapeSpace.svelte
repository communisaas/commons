<!--
  LandscapeSpace — Power: who decides, what they're doing, and whether your
  pressure is registering.

  Three sections answer the org's questions in plain words: WHO DECIDES (the
  decision-makers you follow, with where coverage honestly stands), WHAT
  THEY'RE DOING (the bills you watch and your positions on them), and IS YOUR
  PRESSURE REGISTERING (the accountability scorecards your reports have built).

  Each section was its own route (/representatives, /legislation,
  /scorecards); Power composes them as a single surface. Data is loaded ONCE
  by the org layout (`+layout.server.ts` → `data.spaces.landscape`, reusing the
  three routes' Convex reads) and threaded in as a prop — switching into Power
  is a pure state toggle, no route load.

  The interactive tooling — follow/unfollow, watch/unwatch, set position, bill
  search, CSV export — stays on the deep routes, which own the mutation
  endpoints. Power is the composed view plus the doors into each tool.

  HONESTY RULE: only real records render. Empty follow/watch/scorecard sets
  get plain empty sentences, never fabricated counts. A failed read renders as
  unavailable, not as zero. Sections for features this org does not have are
  not shown at all.
-->
<script lang="ts">
	import ScorecardCard from '$lib/components/org/ScorecardCard.svelte';
	import { Datum } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';
	import { fullViewHref } from './orgOS.svelte';
	import {
		DECISION_MAKER_COVERAGE_SENTENCE,
		NO_FOLLOWED_DECISION_MAKERS_LEAD,
		NO_WATCHED_BILLS_SENTENCE,
		POWER_UNAVAILABLE_SENTENCE,
		SCORECARDS_BUILD_SENTENCE,
		describePowerPosition,
		describeRelevantBills
	} from './power-coverage';
	import type { LandscapeSpaceData } from './spaces';

	let {
		data,
		base
	}: {
		/** Power slice from the layout load. Null when the decision-maker read failed. */
		data: LandscapeSpaceData | null;
		/** `/org/[slug]` — for the deep links into each tool. */
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
	const headline = $derived(
		data
			? describePowerPosition({
					followedCount: data.followedCount,
					watchedBillCount: bills.length,
					scorecardSnapshotCount: data.scorecardSnapshotCount,
					scorecardAvg: data.scorecardAvg,
					legislationEnabled
				})
			: null
	);
	const relevantBillsLine = $derived(data ? describeRelevantBills(data.relevantBillCount) : null);
</script>

<div class="power" style="--timing-slow: {TIMING.SLOW}ms; --easing: {EASING};">
	<header class="power-head">
		<div class="power-head-copy">
			<h1 class="power-title">Power</h1>
			<p class="power-sub">
				Who decides, what they're doing, and whether your pressure is registering.
			</p>
		</div>
		{#if headline}
			<div class="power-head-instrument">
				<p class="power-headline">{headline}</p>
			</div>
		{/if}
	</header>

	{#if !data}
		<!-- Unavailable, not zero: the decision-maker read failed for this page view. -->
		<p class="power-dormant">{POWER_UNAVAILABLE_SENTENCE}</p>
	{:else}
		<!-- WHO DECIDES — the decision-makers you follow. -->
		<section class="block" aria-label="Decision-makers you follow">
			<div class="block-head">
				<span class="section-label">Who decides</span>
				{#if followed.length > 0}
					<span class="block-count">
						<Datum value={data.followedCount} class="block-count-num" /> followed
					</span>
				{/if}
				<a
					class="block-deep"
					href={fullViewHref(`${base}/representatives`)}
					data-sveltekit-preload-data="off">All decision-makers →</a
				>
			</div>

			<!-- Coverage honesty: what the directory holds today, in plain words. -->
			<p class="power-quiet">{DECISION_MAKER_COVERAGE_SENTENCE}</p>

			{#if followed.length === 0}
				<p class="block-empty">
					{NO_FOLLOWED_DECISION_MAKERS_LEAD} —
					<a class="block-link" href={fullViewHref(`${base}/representatives`)}>find yours</a>.
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
								>{dm.reason === 'campaign_delivery' ? 'via delivery' : 'added by you'}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if legislationEnabled}
			<!-- WHAT THEY'RE DOING — the bills you watch and your positions. -->
			<section class="block" aria-label="Bills you watch">
				<div class="block-head">
					<span class="section-label">What they're doing</span>
					{#if bills.length > 0}
						<span class="block-count">
							<Datum value={bills.length} class="block-count-num" /> watched
						</span>
					{/if}
					<a class="block-deep" href="{base}/legislation" data-sveltekit-preload-data="off"
						>All bills →</a
					>
				</div>

				{#if bills.length === 0}
					<p class="block-empty">
						{NO_WATCHED_BILLS_SENTENCE}
						<a class="block-link" href="{base}/legislation">Find bills →</a>
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
				{#if relevantBillsLine}
					<p class="power-quiet">
						{relevantBillsLine} —
						<a class="block-link" href="{base}/legislation">review them</a>
					</p>
				{/if}
			</section>

			<!-- IS YOUR PRESSURE REGISTERING — accountability scorecards. -->
			<section class="block" aria-label="Accountability scorecards">
				<div class="block-head">
					<span class="section-label">Is your pressure registering</span>
					{#if data.scorecardSnapshotCount > 0}
						<span class="block-count">
							<Datum value={data.scorecardSnapshotCount} class="block-count-num" />
							scorecard{data.scorecardSnapshotCount === 1 ? '' : 's'}
							{#if data.scorecardAvg !== null}
								<span class="block-sep">·</span> avg
								<Datum value={data.scorecardAvg} class="block-count-num" />
							{/if}
						</span>
					{/if}
					<a class="block-deep" href="{base}/scorecards" data-sveltekit-preload-data="off"
						>All scorecards →</a
					>
				</div>

				{#if scorecards.length === 0}
					<p class="block-empty">{SCORECARDS_BUILD_SENTENCE}</p>
				{:else}
					<div class="card-list">
						{#each scorecards as scorecard (scorecard.name + scorecard.district)}
							<ScorecardCard {scorecard} />
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	{/if}
</div>

<style>
	.power {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		width: 100%;
	}

	/* ─── Head ─── */
	.power-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.power-head-copy {
		min-width: 0;
	}
	.power-head-instrument {
		flex-shrink: 0;
		max-width: 24rem;
	}
	.power-headline {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-secondary, oklch(0.38 0.012 60));
		margin: 0;
		text-align: right;
	}
	.power-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0;
	}
	.power-sub {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
		max-width: 36rem;
	}
	.power-dormant {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		font-style: italic;
		margin: 0;
		max-width: 40rem;
	}
	.power-quiet {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
		max-width: 40rem;
	}

	/* ─── Section blocks ─── */
	.block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.block-head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.section-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: oklch(0.55 0.01 250);
	}
	.block-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b7280);
	}
	.block :global(.block-count-num) {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.block-sep,
	.dm-sep {
		color: oklch(0.78 0.01 250);
	}
	.block-deep {
		margin-left: auto;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
		transition: color var(--timing-slow) var(--easing);
	}
	.block-deep:hover,
	.block-deep:focus-visible {
		text-decoration: underline;
		outline: none;
	}
	.block-empty {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
		max-width: 40rem;
	}
	.block-link {
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
	}
	.block-link:hover,
	.block-link:focus-visible {
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
		.power-head {
			flex-direction: column;
		}
		.power-headline {
			text-align: left;
		}
	}
</style>
