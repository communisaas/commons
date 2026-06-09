<!--
  ReturnSpace — Results: proof and response.

  This is the org-root results readout, lifted out of `/org/[slug]/+page.svelte` into a
  MOUNTED space. The org-OS shell holds all four spaces at once and toggles
  visibility; Results no longer owns a route page render. Its data is loaded ONCE
  by the layout server load (`+layout.server.ts` → `data.spaces.return`) and
  threaded in as a prop, so switching INTO this space is a pure state toggle —
  never a re-run of a SvelteKit load.

  Results shows the Verification Packet as the gravitational artifact, then
  delivery/coordination signal: campaigns with verified counts, receipt/response
  posture, and the verification funnel + engagement tiers as depth.

  HONESTY RULE: only REAL data renders. The root fields the backend does not
  carry yet (endorsed templates, followed-rep / watched-bill counts on the root,
  legislative alerts, email-reach breakdown) are NOT faked as zeros — they are
  either omitted or marked "not yet armed." A null slice renders a dormant state.
-->
<script lang="ts">
	import VerificationPacket from '$lib/components/org/VerificationPacket.svelte';
	import { FEATURES } from '$lib/config/features';
	import {
		buildResultsProofReadiness,
		getGateEvidence,
		type ResultsProofRow
	} from '$lib/data/capability-hypergraph';
	import { Datum, Ratio } from '$lib/design';
	import { SPRINGS, TIMING, EASING } from '$lib/design/motion';
	import WorkspaceCapabilityStrip from './WorkspaceCapabilityStrip.svelte';
	import type { ReturnSpaceData } from './spaces';

	type ResultsHeaderMetric = {
		value: number | null;
		label: string;
		cite: string;
	};

	let {
		data,
		base
	}: {
		/** Results slice from the layout load. Null when the results read failed. */
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

	const tiers = $derived(data?.tiers ?? []);
	const tierTotal = $derived(tiers.reduce((s, t) => s + t.count, 0));
	const tierMax = $derived(Math.max(...tiers.map((t) => t.count), 1));

	const campaigns = $derived(data?.campaigns ?? []);
	const activeCampaigns = $derived(data?.stats.activeCampaigns ?? 0);
	const resultsHeaderMetrics = $derived<ResultsHeaderMetric[]>([
		{
			value: data?.packet?.verified ?? null,
			label: 'packet verified',
			cite: 'computeVerificationPacketCached top packet'
		},
		{
			value: data?.receipts.loadedCount ?? null,
			label: 'receipt rows',
			cite: 'legislation.getOrgReceiptSummary bounded sample'
		},
		{
			value: data?.receipts.responseLoggedCount ?? null,
			label: 'logged responses',
			cite: 'legislation.getOrgReceiptSummary responseLoggedCount'
		},
		{
			value: data?.stats.activeCampaigns ?? null,
			label: 'active records',
			cite: 'organizations.getDashboardStats activeCampaigns'
		}
	]);
	const packetHref = $derived(
		data?.topCampaignId
			? `${base}/campaigns/${data.topCampaignId}/report#proof-preview`
			: `${base}#results-packet`
	);
	const actionRecordsHref = $derived(`${base}#action-records`);
	const proofDeliveryHref = $derived(
		data?.topCampaignId
			? `${base}/campaigns/${data.topCampaignId}/report#proof-delivery`
			: actionRecordsHref
	);
	const packetLabel = $derived(
		activeCampaigns > 0
			? `Coordination Integrity · ${activeCampaigns} active action record${activeCampaigns === 1 ? '' : 's'}`
			: 'Coordination Integrity'
	);
	const readerOfficeGate = getGateEvidence('CP-dm-office-profile', ['T8-1b', 'T8-8'], {
		name: 'Reader office integration',
		downstream: 4,
		dependency: 'Office-facing reader surface + notification APIs'
	});
	const deliveryResponseGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2', 'T6-9'], {
		name: 'Receipt anchoring + response detection',
		downstream: 4,
		dependency: 'Receipt writer/mainnet anchoring + event-stream response detection'
	});
	const coordinationHistoryGate = getGateEvidence('CP-coordination-integrity', ['T10-10'], {
		name: 'Coordination integrity history',
		downstream: 1,
		dependency: 'Longitudinal packet-local coordination metrics'
	});
	const resultsProofReadiness = $derived(
		buildResultsProofReadiness({
			base,
			hrefs: {
				actionRecordsHref,
				packetHref,
				resultsPacketHref: `${base}#results-packet`,
				proofDeliveryHref
			},
			results: {
				loaded: !!data,
				hasPacket: !!data?.packet,
				verifiedCount: data?.packet?.verified ?? null,
				totalCount: data?.packet?.total ?? null,
				districtCount: data?.packet?.districtCount ?? null,
				sentEmails: data?.stats.sentEmails ?? null,
				campaignCount: data?.stats.campaigns ?? null,
				receiptCount: data?.receipts.loadedCount ?? null,
				pendingReceiptCount: data?.receipts.pendingCount ?? null,
				responseLoggedReceiptCount: data?.receipts.responseLoggedCount ?? null,
				anchorFieldCount: data?.receipts.anchorFieldCount ?? null,
				receiptSampleLimit: data?.receipts.sampleLimit ?? null,
				receiptProofWeightTotal: data?.receipts.proofWeightTotal ?? null
			},
			features: {
				ACCOUNTABILITY: FEATURES.ACCOUNTABILITY
			},
			gates: {
				receiptAnchoringGate: deliveryResponseGate,
				readerOfficeGate,
				coordinationIntegrityGate: coordinationHistoryGate
			}
		})
	);
	const resultsProofRows = $derived<ResultsProofRow[]>(resultsProofReadiness.rows);
	const receiptAnchoringRow = $derived(
		resultsProofRows.find((row) => row.id === 'receipt-anchoring') ?? null
	);
	const proofDeliveryGateSummary = $derived(
		`Proof delivery is a route handoff. ${receiptAnchoringRow?.boundary ?? resultsProofReadiness.gate}`
	);
	const capabilityItems = $derived(
		resultsProofRows.map((row) => ({
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
		}))
	);
</script>

<div class="return" style="--timing-slow: {TIMING.SLOW}ms; --easing: {EASING};">
	<header class="return-head">
		<div class="return-head-copy">
			<h1 class="return-title">Results</h1>
			<p class="return-sub">
				Proof, delivery, and response signal from the actions your organization sent.
			</p>
		</div>
		<div class="return-head-instrument">
			<div class="return-proof-counts" aria-label="Results proof evidence counts">
				{#each resultsHeaderMetrics as metric (metric.label)}
					<span class="return-proof-count">
						<Datum value={metric.value} cite={metric.cite} />
						<span>{metric.label}</span>
					</span>
				{/each}
			</div>
			<a class="return-deep" href={actionRecordsHref} data-sveltekit-preload-data="off"
				>Action records →</a
			>
		</div>
	</header>

	{#if !data}
		<!-- Dormant: the results read is unread. Not a fabricated zero. -->
		<p class="return-dormant">
			This shell did not attach Results proof evidence; packet, delivery, receipt, and response
			claims remain unclaimed and uncounted in this read.
		</p>
	{:else}
		<WorkspaceCapabilityStrip label="Results capability" items={capabilityItems} />

		<!-- PROOF — the gravitational center. The packet is the reason Results exists. -->
		<section id="results-packet" class="packet-anchor" aria-label="Proof packet">
			<VerificationPacket packet={data.packet} label={packetLabel}>
				{#snippet actions()}
					{#if data.packet && data.topCampaignId}
						<div class="proof-handoff" aria-label="Proof packet handoff contract">
							<div class="proof-cta">
								<a href={proofDeliveryHref} class="cta cta--primary">Open proof delivery</a>
								<a href={packetHref} class="cta cta--ghost">Preview packet</a>
							</div>
							<p class="proof-handoff-gate">{proofDeliveryGateSummary}</p>
						</div>
					{/if}
				{/snippet}
			</VerificationPacket>
		</section>

		<!-- OPERATIONS — action records + sidebar -->
		<div id="action-records" class="operations">
			<section class="campaigns-section">
				<div class="section-head">
					<span class="section-label">Action records</span>
					<a href="{base}/campaigns" class="section-link">Open actions</a>
				</div>

				{#if campaigns.length === 0}
					<div class="empty-state">
						<p class="empty-text">No action records yet.</p>
						<a href="{base}/campaigns/new" class="empty-action">Create first action</a>
					</div>
				{:else}
					<div class="campaigns">
						{#each campaigns as campaign (campaign.id)}
							<a href="{base}/campaigns/{campaign.id}" class="campaign">
								<div class="campaign-count">
									<span class="count-value">
										<Datum value={campaign.verifiedActions} animate spring={SPRINGS.METRIC} />
									</span>
									<span class="count-unit">verified</span>
								</div>
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
									{/if}
									<span class="campaign-meta">
										<Datum value={campaign.totalActions} class="meta-num" /> total &middot; {relativeTime(
											campaign.updatedAt
										)}
									</span>
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
				<!-- Receipt posture — bounded proof-row sample, not a CRM activity feed. -->
				<div class="receipt-posture" aria-label="Results receipt response posture">
					<span class="section-label">Receipt response posture</span>
					<div class="receipt-posture-grid">
						<div class="receipt-posture-cell">
							<Datum
								value={data.receipts.loadedCount}
								cite="legislation.getOrgReceiptSummary bounded sample"
							/>
							<span>receipt rows</span>
						</div>
						<div class="receipt-posture-cell">
							<Datum
								value={data.receipts.responseLoggedCount}
								cite="legislation.getOrgReceiptSummary responseLoggedCount"
							/>
							<span>logged responses</span>
						</div>
						<div class="receipt-posture-cell">
							<Datum
								value={data.receipts.pendingCount}
								cite="legislation.getOrgReceiptSummary pendingCount"
							/>
							<span>pending rows</span>
						</div>
						<div class="receipt-posture-cell">
							<Datum
								value={data.receipts.anchorFieldCount}
								cite="legislation.getOrgReceiptSummary anchorFieldCount"
							/>
							<span>anchor fields</span>
						</div>
					</div>
					<p class="receipt-posture-note">
						Bounded sample of the latest <Datum
							value={data.receipts.sampleLimit}
							cite="legislation.getOrgReceiptSummary sampleLimit"
						/> receipt rows. {receiptAnchoringRow?.boundary ?? resultsProofReadiness.gate}
						{#if data.receipts.latestProofDeliveredAt}
							<span class="receipt-posture-latest">
								Latest proof delivery: {relativeTime(data.receipts.latestProofDeliveredAt)}.
							</span>
						{/if}
					</p>
				</div>

				<!-- Legislative response — latent. Marked, never faked with a zero. -->
				<div class="latent">
					<span class="section-label">Legislative response</span>
					<p class="latent-note">
						Not yet armed — vote-and-reply tracking surfaces here once decision-makers respond to
						delivered proof.
					</p>
				</div>
			</aside>
		</div>

		<!-- DEPTH — verification funnel + engagement tiers, on inquiry -->
		<div class="depth">
			<details class="depth-section">
				<summary class="depth-summary">Verification pipeline &amp; engagement tiers</summary>
				<div class="depth-content">
					<div class="depth-block">
						<span class="section-label">Verification Funnel</span>
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

					<div class="depth-block">
						<span class="section-label">Engagement Tier Distribution</span>
						{#if tierTotal === 0}
							<p class="empty-hint">
								No action records yet. Tier distribution appears as people take action.
							</p>
						{:else}
							<div class="tiers">
								{#each [...tiers].reverse() as tier (tier.tier)}
									<div class="tier-row">
										<span class="tier-label"
											>{tier.label} <span class="tier-num">T{tier.tier}</span></span
										>
										<div class="tier-bar">
											<div
												class="tier-fill"
												data-tier={tier.tier}
												style="width: {tier.count > 0
													? Math.max((tier.count / tierMax) * 100, 2)
													: 0}%"
											></div>
										</div>
										<span class="tier-count"><Datum value={tier.count} /></span>
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

	.return-proof-counts {
		display: flex;
		max-width: 34rem;
		flex-wrap: wrap;
		justify-content: flex-start;
		gap: 0.5rem 0.875rem;
	}

	@media (min-width: 860px) {
		.return-proof-counts {
			justify-content: flex-end;
		}
	}

	.return-proof-count {
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

	/* ─── Proof CTA ─── */
	.proof-handoff {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.75rem;
	}
	.proof-cta {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
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
	.proof-handoff-gate {
		margin: 0;
		max-width: 44rem;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--text-tertiary, oklch(0.55 0.01 250));
	}

	/* ─── Operations grid ─── */
	.operations {
		display: grid;
		grid-template-columns: 1fr;
		gap: 2.5rem;
	}
	@media (min-width: 1024px) {
		.operations {
			grid-template-columns: 3fr 2fr;
			gap: 3rem;
			align-items: start;
		}
	}
	.sidebar {
		display: flex;
		flex-direction: column;
		gap: 2rem;
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

	/* ─── Receipt posture ─── */
	.receipt-posture {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.receipt-posture-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.receipt-posture-cell {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-height: 4rem;
		justify-content: center;
		border: 1px solid oklch(0.86 0.01 70 / 0.8);
		border-radius: 6px;
		padding: 0.625rem;
		background: oklch(0.96 0.006 70 / 0.72);
	}
	.receipt-posture-cell :global(.datum) {
		font-size: 1rem;
		color: oklch(0.24 0.025 250);
	}
	.receipt-posture-cell span {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.2;
		color: oklch(0.52 0.012 250);
	}
	.receipt-posture-note {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.45;
		color: oklch(0.5 0.012 250);
	}
	.receipt-posture-latest {
		display: block;
		margin-top: 0.35rem;
	}

	/* ─── Latent ─── */
	.latent {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.latent-note {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: oklch(0.6 0.01 250);
		font-style: italic;
		margin: 0;
	}

	/* ─── Depth ─── */
	.depth {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0;
	}
	@media (min-width: 1024px) {
		.depth {
			grid-template-columns: 1fr 1fr;
			gap: 2rem;
		}
	}
	.depth-section {
		border-top: 1px solid oklch(0.91 0.006 60);
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

	/* ─── Tiers ─── */
	.tiers {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.tier-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}
	.tier-label {
		width: 5.5rem;
		flex-shrink: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: oklch(0.55 0.01 250);
		text-align: right;
	}
	.tier-num {
		color: oklch(0.72 0.01 250);
	}
	.tier-bar {
		flex: 1;
		height: 0.875rem;
		border-radius: 2px;
		background: oklch(0.955 0.003 60);
		overflow: hidden;
	}
	.tier-fill {
		height: 100%;
		border-radius: 2px;
		transition: width 700ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.tier-fill[data-tier='0'] {
		background: oklch(0.78 0.01 250);
	}
	.tier-fill[data-tier='1'] {
		background: oklch(0.62 0.08 180 / 0.55);
	}
	.tier-fill[data-tier='2'] {
		background: oklch(0.58 0.1 180 / 0.7);
	}
	.tier-fill[data-tier='3'] {
		background: oklch(0.52 0.12 165 / 0.8);
	}
	.tier-fill[data-tier='4'] {
		background: oklch(0.52 0.15 165);
	}
	.tier-count {
		width: 2.5rem;
		text-align: right;
		font-size: 0.75rem;
		font-weight: 600;
		color: oklch(0.38 0.015 250);
	}
</style>
