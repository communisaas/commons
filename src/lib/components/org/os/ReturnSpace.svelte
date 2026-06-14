<!--
  ReturnSpace — Results: the org's evidence page.

  Answers the questions an organization actually brings here: did it deliver,
  did anyone respond, what do we show the board. Four headline numbers
  (verified constituents, districts reached, proof reports delivered,
  responses logged), the Verification Packet as the proof artifact, and three
  lists: action records, where actions landed, and response activity.

  This is a MOUNTED space: the org-OS shell holds all four spaces at once and
  toggles visibility. Its data is loaded ONCE by the layout server load
  (`+layout.server.ts` → `data.spaces.return`) and threaded in as a prop, so
  switching into this space is a pure state toggle — never a re-run of a
  SvelteKit load.

  HONESTY RULE: only real data renders. A null slice means the results load
  failed — rendered as a distinct unavailable state, never a fabricated zero.
  Zero counts render as plain sentences about what is absent, not bare zeros.
-->
<script lang="ts">
	import VerificationPacket from '$lib/components/org/VerificationPacket.svelte';
	import { Datum, Ratio } from '$lib/design';
	import { SPRINGS, TIMING, EASING } from '$lib/design/motion';
	import {
		NO_REPORTS_DELIVERED_SENTENCE,
		NO_RESPONSES_LOGGED_SENTENCE,
		NO_VERIFIED_ACTIONS_SENTENCE,
		deriveDistrictReach,
		deriveResultsHeadline,
		describeResponseActivity,
		formatReportDay
	} from './results-evidence';
	import type { ReturnSpaceData } from './spaces';

	let {
		data,
		base
	}: {
		/** Results slice from the layout load. Null when the results load failed. */
		data: ReturnSpaceData | null;
		/** `/org/[slug]` — for deep-link CTAs into campaigns/reports. */
		base: string;
	} = $props();

	function relativeTime(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		if (diff < 0) return 'just now';
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	const headline = $derived(data ? deriveResultsHeadline(data) : null);
	const campaigns = $derived(data?.campaigns ?? []);
	/** The packet is computed for one campaign — name it so the proof artifact carries its scope. */
	const packetCampaignTitle = $derived(
		data?.packet && data.topCampaignId
			? (data.campaigns.find((campaign) => campaign.id === data.topCampaignId)?.title ?? null)
			: null
	);
	const districtReach = $derived(deriveDistrictReach(data?.packet?.geography ?? null));
	const responseActivity = $derived(data ? describeResponseActivity(data.receipts) : null);

	const funnel = $derived(
		data?.funnel ?? { imported: 0, postalResolved: 0, identityVerified: 0, districtVerified: 0 }
	);
	const funnelMax = $derived(Math.max(funnel.imported, 1));
	const funnelSteps = $derived([
		{ label: 'Imported', count: funnel.imported, pct: 100 },
		{
			label: 'Postal Resolved',
			count: funnel.postalResolved,
			pct: Math.round((funnel.postalResolved / funnelMax) * 100)
		},
		{
			label: 'Identity Verified',
			count: funnel.identityVerified,
			pct: Math.round((funnel.identityVerified / funnelMax) * 100)
		},
		{
			label: 'District Signal',
			count: funnel.districtVerified,
			pct: Math.round((funnel.districtVerified / funnelMax) * 100)
		}
	]);

	// Results is mounted at `/results` (the org root is now the authoring front
	// door). These intra-Results anchors target sections on THIS surface, so they
	// must point at the Results path — not the bare base, which now mounts Studio.
	const actionRecordsHref = $derived(`${base}/results#action-records`);
	const packetHref = $derived(
		data?.topCampaignId
			? `${base}/campaigns/${data.topCampaignId}/report#proof-preview`
			: `${base}/results#results-packet`
	);
	const proofDeliveryHref = $derived(
		data?.topCampaignId
			? `${base}/campaigns/${data.topCampaignId}/report#proof-delivery`
			: actionRecordsHref
	);
</script>

<div class="return" style="--timing-slow: {TIMING.SLOW}ms; --easing: {EASING};">
	<header class="return-head">
		<div class="return-head-copy">
			<h1 class="return-title">Results</h1>
			<p class="return-sub">
				What your campaigns delivered, who responded, and the proof behind it.
			</p>
		</div>
		<div class="return-head-instrument">
			{#if data && headline}
				<div class="evidence-band" aria-label="Delivery and response evidence">
					{#if headline.verifiedConstituents > 0}
						<span class="evidence-cell">
							<Datum value={headline.verifiedConstituents} animate spring={SPRINGS.METRIC} />
							<span class="evidence-label">verified constituents</span>
						</span>
					{/if}
					{#if headline.districtsReached > 0}
						<span class="evidence-cell">
							<Datum value={headline.districtsReached} />
							<span class="evidence-label">districts reached</span>
						</span>
					{/if}
					{#if headline.proofReportsDelivered > 0}
						<span class="evidence-cell">
							<Datum value={headline.proofReportsDelivered} />
							<span class="evidence-label"
								>proof reports delivered{headline.proofReportsAtSampleCap ? ' (recent)' : ''}</span
							>
							{#if data.receipts.latestProofDeliveredAt}
								<span class="evidence-note"
									>last delivered {formatReportDay(data.receipts.latestProofDeliveredAt)}</span
								>
							{/if}
						</span>
					{/if}
					{#if headline.responsesLogged > 0}
						<span class="evidence-cell">
							<Datum value={headline.responsesLogged} />
							<span class="evidence-label">responses logged</span>
						</span>
					{/if}
				</div>
				{#if headline.verifiedConstituents === 0 || headline.responsesLogged === 0}
					<div class="evidence-absent-group">
						{#if headline.verifiedConstituents === 0}
							<p class="evidence-absent">{NO_VERIFIED_ACTIONS_SENTENCE}</p>
						{/if}
						{#if headline.responsesLogged === 0}
							<p class="evidence-absent">{NO_RESPONSES_LOGGED_SENTENCE}</p>
						{/if}
					</div>
				{/if}
			{/if}
			<a class="return-deep" href={actionRecordsHref} data-sveltekit-preload-data="off"
				>Action records →</a
			>
		</div>
	</header>

	{#if !data}
		<!-- Unavailable, not zero: the results load failed for this page view. -->
		<p class="return-dormant">
			Results didn't load with this page view — delivery and response counts are unavailable right
			now, not zero. Reload the page to fetch them.
		</p>
	{:else}
		<!-- PROOF — the centerpiece. The packet is what the org shows its board. -->
		<section id="results-packet" class="packet-anchor" aria-label="Proof packet">
			{#if packetCampaignTitle}
				<p class="packet-scope">Proof packet for {packetCampaignTitle} — one campaign's evidence.</p>
			{/if}
			<VerificationPacket packet={data.packet}>
				{#snippet actions()}
					{#if data.packet && data.topCampaignId}
						<div class="proof-cta">
							<a href={proofDeliveryHref} class="cta cta--primary">Open proof delivery</a>
							<a href={packetHref} class="cta cta--ghost">Preview packet</a>
						</div>
					{/if}
				{/snippet}
			</VerificationPacket>
		</section>

		<!-- LISTS — action records + where it landed + response activity -->
		<div id="action-records" class="operations">
			<section class="campaigns-section">
				<div class="section-head">
					<span class="section-label">Action records</span>
					<a href="{base}/campaigns" class="section-link">Open actions</a>
				</div>

				{#if campaigns.length === 0}
					<div class="empty-state">
						<p class="empty-text">
							No action records yet — actions you send appear here with their verified counts.
						</p>
						<a href="{base}/campaigns/new" class="empty-action">Create first action</a>
					</div>
				{:else}
					<div class="campaigns">
						{#each campaigns as campaign (campaign.id)}
							<a href="{base}/campaigns/{campaign.id}" class="campaign">
								{#if campaign.totalActions > 0}
									<div class="campaign-count">
										<span class="count-value">
											<Datum value={campaign.verifiedActions} animate spring={SPRINGS.METRIC} />
										</span>
										<span class="count-unit">verified</span>
									</div>
								{/if}
								<div class="campaign-body">
									<span class="campaign-title">{campaign.title}</span>
									{#if campaign.totalActions > 0}
										<Ratio
											segments={[
												{
													value: campaign.verifiedActions,
													color: 'var(--coord-verified)',
													label: 'verified'
												},
												{
													value: Math.max(0, campaign.totalActions - campaign.verifiedActions),
													color: 'oklch(0.91 0.005 60)',
													label: 'unverified'
												}
											]}
											height={3}
										/>
										<span class="campaign-meta">
											<Datum value={campaign.totalActions} class="meta-num" /> total &middot; {relativeTime(
												campaign.updatedAt
											)}
										</span>
									{:else}
										<!-- Absence in plain words, never a bare zero counter. -->
										<span class="campaign-meta">
											No actions yet &middot; updated {relativeTime(campaign.updatedAt)}
										</span>
									{/if}
								</div>
								<span class="campaign-status" data-status={campaign.status.toLowerCase()}
									>{campaign.status}</span
								>
							</a>
						{/each}
					</div>
				{/if}
			</section>

			<aside class="sidebar">
				<!-- Where it landed — top districts from the packet's geographic field. -->
				<div class="district-reach" aria-label="Where actions landed">
					<span class="section-label">Where it landed</span>
					{#if districtReach.length === 0}
						<p class="absence-note">
							No district reach yet — districts appear here as constituents act.
						</p>
					{:else}
						<div class="district-rows">
							{#each districtReach as district (district.label)}
								<div class="district-row">
									<span class="district-label">{district.label}</span>
									<div class="district-bar">
										<div class="district-fill" style="width: {district.sharePct}%"></div>
									</div>
									<span class="district-count"><Datum value={district.count} /></span>
								</div>
							{/each}
						</div>
						<p class="district-note">
							District identities are privacy-protected — the proof packet carries the verifiable
							spread.
						</p>
					{/if}
				</div>

				<!-- Response activity — receipt evidence as sentences, not counters. -->
				<div class="response-activity" aria-label="Response activity">
					<span class="section-label">Response activity</span>
					{#if responseActivity === null}
						<p class="absence-note">{NO_REPORTS_DELIVERED_SENTENCE}</p>
					{:else}
						<p class="response-sentence">{responseActivity}</p>
						{#if data.topCampaignId}
							<a href={proofDeliveryHref} class="response-link">Open the latest report →</a>
						{/if}
					{/if}
				</div>
			</aside>
		</div>

		<!-- DEPTH — supporter verification funnel, on inquiry -->
		<div class="depth">
			<details class="depth-section">
				<summary class="depth-summary">Verification funnel</summary>
				<div class="depth-content">
					<div class="depth-block">
						{#if funnel.imported === 0}
							<p class="empty-hint">No people yet. Import people to see verification progress.</p>
						{:else}
							<div class="funnel">
								{#each funnelSteps as step, i (step.label)}
									<div class="funnel-step">
										<span class="funnel-label">{step.label}</span>
										<div class="funnel-bar">
											<div
												class="funnel-fill"
												data-step={i}
												style="width: {Math.max(step.pct, 1)}%"
											></div>
										</div>
										<span class="funnel-count"><Datum value={step.count} /></span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</details>
		</div>
	{/if}
</div>

<style>
	.return {
		display: flex;
		flex-direction: column;
		gap: 2.5rem;
		width: 100%;
	}

	@media (min-width: 768px) {
		.return {
			gap: 3.5rem;
		}
	}

	/* ─── Head ─── */
	.return-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-direction: column;
		gap: 1rem;
	}

	@media (min-width: 860px) {
		.return-head {
			flex-direction: row;
		}
	}

	.return-head-copy {
		min-width: 0;
	}

	.return-head-instrument {
		display: flex;
		flex-shrink: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.625rem;
	}

	@media (min-width: 860px) {
		.return-head-instrument {
			align-items: flex-end;
		}
	}

	.evidence-band {
		display: flex;
		max-width: 36rem;
		flex-wrap: wrap;
		justify-content: flex-start;
		gap: 0.625rem 1.25rem;
	}

	@media (min-width: 860px) {
		.evidence-band {
			justify-content: flex-end;
		}
	}

	.evidence-cell {
		display: inline-flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.evidence-cell :global(.datum) {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
		line-height: 1;
	}

	.evidence-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--text-secondary, oklch(0.42 0.015 60));
		white-space: nowrap;
	}

	.evidence-note {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.625rem;
		color: var(--text-tertiary, #6b7280);
		white-space: nowrap;
	}

	.evidence-absent-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-width: 26rem;
	}

	.evidence-absent {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
	}

	@media (min-width: 860px) {
		.evidence-absent {
			text-align: right;
		}
	}

	.return-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0;
	}

	.return-sub {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-tertiary, #6b7280);
		margin: 0.25rem 0 0;
		max-width: 36rem;
	}

	.return-deep {
		flex-shrink: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
		padding-top: 0.5rem;
		transition: color var(--timing-slow) var(--easing);
	}
	.return-deep:hover,
	.return-deep:focus-visible {
		text-decoration: underline;
		outline: none;
	}

	.return-dormant {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		font-style: italic;
		margin: 0;
		max-width: 40rem;
	}
	.packet-anchor {
		scroll-margin-top: 6rem;
	}

	.packet-scope {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		margin: 0 0 0.625rem;
	}

	/* ─── Shared ─── */
	.section-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: oklch(0.55 0.01 250);
	}

	.section-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		min-width: 0;
		margin-bottom: 1.25rem;
	}

	.section-link {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.58 0.01 250);
		text-decoration: none;
		transition: color 150ms ease-out;
	}
	.section-link:hover {
		color: oklch(0.45 0.1 180);
	}

	.empty-state {
		padding: 1.5rem 0;
	}
	.empty-text {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		color: oklch(0.6 0.01 250);
		margin: 0;
	}
	.empty-action {
		display: inline-block;
		margin-top: 0.5rem;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.45 0.1 180);
		text-decoration: none;
		transition: color 150ms ease-out;
	}
	.empty-action:hover {
		color: oklch(0.35 0.12 180);
	}
	.empty-hint {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.6 0.01 250);
		margin: 0;
	}

	.absence-note {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: oklch(0.6 0.01 250);
		margin: 0;
	}

	/* ─── Proof CTA ─── */
	.proof-cta {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding-top: 0.75rem;
	}
	.cta {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1.25rem;
		border-radius: 4px;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		text-decoration: none;
		transition:
			background 150ms ease-out,
			border-color 150ms ease-out,
			color 150ms ease-out;
		cursor: pointer;
	}
	.cta--primary {
		background: oklch(0.42 0.1 180);
		border: 1px solid oklch(0.45 0.1 180);
		color: #ffffff;
	}
	.cta--primary:hover {
		background: oklch(0.38 0.11 180);
		border-color: oklch(0.38 0.11 180);
	}
	.cta--ghost {
		background: transparent;
		border: 1px solid oklch(0.86 0.01 250);
		color: oklch(0.38 0.015 250);
	}
	.cta--ghost:hover {
		border-color: oklch(0.7 0.06 180);
		color: oklch(0.32 0.08 180);
	}

	/* ─── Operations grid ─── */
	/* minmax(0, …) tracks + min-width: 0 children: nothing inside may widen a
	   track past the viewport — at 375px every row wraps instead of clipping. */
	.operations {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 2.5rem;
	}
	@media (min-width: 1024px) {
		.operations {
			grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
			gap: 3rem;
			align-items: start;
		}
	}
	.campaigns-section {
		min-width: 0;
	}
	.sidebar {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		min-width: 0;
	}

	/* ─── Campaigns ─── */
	.campaigns {
		display: flex;
		flex-direction: column;
	}
	.campaign {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.875rem 0;
		text-decoration: none;
		border-top: 1px solid oklch(0.92 0.006 60 / 0.6);
		transition: color 150ms ease-out;
	}
	.campaign:first-child {
		border-top: none;
	}
	.campaign:hover .campaign-title {
		color: oklch(0.35 0.12 165);
	}
	.campaign-count {
		flex-shrink: 0;
		text-align: right;
		min-width: 3.5rem;
	}
	.count-value {
		display: block;
		font-size: 1.375rem;
		font-weight: 700;
		color: var(--coord-verified, #10b981);
		line-height: 1;
	}
	.count-unit {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		color: oklch(0.58 0.01 250);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.campaign-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.campaign-title {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 600;
		color: oklch(0.2 0.03 250);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 150ms ease-out;
	}
	.campaign-meta {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.55 0.01 250);
	}
	.campaign-status {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.55 0.01 250);
	}
	.campaign-status[data-status='active'] {
		color: oklch(0.5 0.14 165);
	}
	.campaign-status[data-status='paused'] {
		color: oklch(0.6 0.14 85);
	}
	.campaign-status[data-status='complete'] {
		color: oklch(0.45 0.12 180);
	}

	/* ─── Where it landed ─── */
	.district-reach {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.district-rows {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.district-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.district-label {
		width: 6.5rem;
		flex-shrink: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.55 0.01 250);
		text-align: right;
	}
	.district-bar {
		flex: 1;
		height: 0.875rem;
		border-radius: 2px;
		background: oklch(0.955 0.003 60);
		overflow: hidden;
	}
	.district-fill {
		height: 100%;
		border-radius: 2px;
		background: oklch(0.55 0.11 180 / 0.75);
		transition: width 700ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.district-count {
		width: 2.5rem;
		text-align: right;
		font-size: 0.75rem;
		font-weight: 600;
		color: oklch(0.38 0.015 250);
	}
	.district-note {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.45;
		color: oklch(0.58 0.012 250);
	}

	/* ─── Response activity ─── */
	.response-activity {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.response-sentence {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: oklch(0.42 0.015 250);
	}
	.response-link {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
	}
	.response-link:hover,
	.response-link:focus-visible {
		text-decoration: underline;
		outline: none;
	}

	/* ─── Depth ─── */
	.depth {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
	}
	@media (min-width: 1024px) {
		.depth {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			gap: 2rem;
		}
	}
	.depth-section {
		border-top: 1px solid oklch(0.91 0.006 60);
		min-width: 0;
	}
	.depth-summary {
		cursor: pointer;
		padding: 1rem 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 500;
		color: oklch(0.42 0.015 250);
		transition: color 150ms ease-out;
	}
	.depth-summary:hover {
		color: oklch(0.22 0.03 250);
	}
	.depth-content {
		padding-bottom: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}
	.depth-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	/* ─── Funnel ─── */
	.funnel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.funnel-step {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.funnel-label {
		width: 7.5rem;
		flex-shrink: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.55 0.01 250);
		text-align: right;
	}
	.funnel-bar {
		flex: 1;
		height: 1rem;
		border-radius: 2px;
		background: oklch(0.955 0.003 60);
		overflow: hidden;
	}
	.funnel-fill {
		height: 100%;
		border-radius: 2px;
		transition: width 700ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.funnel-fill[data-step='0'] {
		background: oklch(0.78 0.01 250);
	}
	.funnel-fill[data-step='1'] {
		background: oklch(0.62 0.08 180 / 0.55);
	}
	.funnel-fill[data-step='2'] {
		background: oklch(0.58 0.1 180 / 0.7);
	}
	.funnel-fill[data-step='3'] {
		background: oklch(0.52 0.13 165 / 0.8);
	}
	.funnel-count {
		width: 3rem;
		text-align: right;
		font-size: 0.8125rem;
		font-weight: 600;
		color: oklch(0.38 0.015 250);
	}
</style>
