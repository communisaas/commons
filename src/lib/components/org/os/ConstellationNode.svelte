<!--
  ConstellationNode — one DATA object on the org field, rendered across the
  THREE semantic-zoom tiers (glyph → summary → full). This is the reusable face
  for every non-authoring object: campaigns, the people funnel + email
  health, decision-makers, watched bills, the scorecard reading, and the
  verification packet that came back.

  The STUDIO authoring node + live agent PROCESSES are NOT rendered here — they
	  keep their full streaming reasoning face inside CanvasCapabilityMap (they own the
	  intent form + OS actions). This component is purely presentational + posture-led:
	  it surfaces REAL data and affords each object's PRIMARY action in
	  place. Deeper, write-heavy capabilities hand off through an
	  honest route affordance (shown only in the FULL tier), so no
  capability is lost while the field spatializes region by region.

  HONESTY: every count/field rendered here is passed straight from the loaded
  OrgSpacesData. Nothing is fabricated. Empty/null upstream → the object simply
  isn't composed, so it never appears.

  SSR SAFETY: this component touches NO browser API. It binds `detailHref` to an
  <a href> and also calls back to the parent via `onOpenDetails` — the parent
  owns any window navigation, keeping all browser access centralized + guarded.
  Pure render: safe under svelte/server.
-->
<script lang="ts">
	import { Datum, Ratio } from '$lib/design';
	import { COORD_COLORS } from '$lib/design/motion';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import { operatorCapabilityStateLabel } from '$lib/data/capability-state-labels';
	import { formatGateEvidence } from '$lib/data/capability-hypergraph';
	import type { DataConstellationObject } from './constellation';
	import { constellationCapabilityContract } from './constellation-capability-contract';

	let {
		object,
		detail,
		detailHref,
		onOpenDetails
	}: {
		object: DataConstellationObject;
		detail: 'glyph' | 'summary' | 'full';
		/** Resolved slug-prefixed route, or null for map-native objects. */
		detailHref: string | null;
		/** Parent-owned navigation. Keeps window access out of this component. */
		onOpenDetails: (href: string) => void;
	} = $props();

	// Per-type accent color — coordination palette, never a CTA hue.
	const accent = $derived.by(() => {
		switch (object.type) {
			case 'campaign':
				return COORD_COLORS.ROUTE.solid;
			case 'funnel':
			case 'email-health':
			case 'packet':
				return COORD_COLORS.VERIFIED.solid;
			case 'decision-maker':
			case 'scorecard':
				return COORD_COLORS.SHARE.solid;
			case 'bill':
				return COORD_COLORS.ROUTE.solid;
		}
		const _exhaustive: never = object;
		return _exhaustive;
	});

	// A short kind label for the glyph + full badge.
	const kindLabel = $derived.by(() => {
		switch (object.type) {
			case 'campaign':
				return 'Campaign';
			case 'funnel':
				return 'Reach';
			case 'email-health':
				return 'Email health';
			case 'decision-maker':
				return 'Decision-maker';
			case 'bill':
				return 'Bill';
			case 'scorecard':
				return 'Scorecard';
			case 'packet':
				return 'Packet';
		}
		const _exhaustive: never = object;
		return _exhaustive;
	});

	// A one-line title per object — the glyph's legible label.
	const title = $derived.by(() => {
		switch (object.type) {
			case 'campaign':
				return object.campaign.title;
			case 'funnel':
				return 'People reach';
			case 'email-health':
				return 'Email health';
			case 'decision-maker':
				return object.dm.name;
			case 'bill':
				return object.bill.title;
			case 'scorecard':
				return 'Engagement';
			case 'packet':
				return object.campaignTitle ?? 'Verification packet';
		}
		const _exhaustive: never = object;
		return _exhaustive;
	});

	const capabilityContract = $derived(constellationCapabilityContract(object));
	const detailActionLabel = $derived.by(() => capabilityContract.action);
	const capabilityGateSummary = $derived(
		formatGateEvidence(capabilityContract.gate, { density: 'operator' })
	);
	const capabilityGateLabel = $derived(
		capabilityContract.gate.status === 'completed' ? 'Grounded by' : 'Next lift'
	);

	function statusDate(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<div
	class="cnode"
	class:cnode--full={detail === 'full'}
	style="--accent: {accent};"
	data-type={object.type}
	data-state={capabilityContract.state}
	data-clusters={capabilityContract.clusters}
	data-gate={capabilityContract.gate.id}
>
	{#if detail === 'glyph'}
		<!-- GLYPH — far view: a calm mark + kind + one-line title. No prose. -->
		<div class="glyph">
			<span class="glyph-mark" aria-hidden="true"></span>
			<div class="glyph-body">
				<span class="glyph-kind">{kindLabel}</span>
				<span class="glyph-title">{title}</span>
			</div>
		</div>
	{:else}
		<!-- SUMMARY + FULL — the object opens to its real data. -->
		<header class="cnode-head">
			<span class="cnode-kind">{kindLabel}</span>
			{#if object.type === 'campaign'}
				<span class="cnode-tag" data-status={object.campaign.status.toLowerCase()}>
					{object.campaign.status}
				</span>
			{:else if object.type === 'bill' && object.bill.position}
				<span class="cnode-tag" data-pos={object.bill.position}>{object.bill.position}</span>
			{/if}
		</header>
		<p class="cnode-title">{title}</p>
		<div
			class="capability-contract"
			data-state={capabilityContract.state}
			title="{capabilityContract.label}. {formatCapabilityClusters(
				capabilityContract.clusters
			)}. {capabilityContract.cite}. {capabilityGateSummary}"
		>
			<span class="capability-state">{operatorCapabilityStateLabel(capabilityContract.state)}</span>
			<span class="capability-label">{capabilityContract.label}</span>
			<span class="capability-clusters"
				>{formatCapabilityClusters(capabilityContract.clusters)}</span
			>
		</div>
		<div
			class="capability-gate"
			data-state={capabilityContract.gate.state}
			data-gate={capabilityContract.gate.id}
			title={capabilityGateSummary}
		>
			<span class="capability-gate-label">{capabilityGateLabel}</span>
			<span class="capability-gate-name">{capabilityContract.gate.name}</span>
			<span class="capability-gate-tasks">{capabilityContract.gate.tasks}</span>
		</div>
		{#if detail === 'full'}
			<div
				class="capability-handoff"
				title="{capabilityContract.handoff}. {capabilityContract.effect}"
			>
				<span class="capability-handoff-label">handoff</span>
				<span class="capability-handoff-value">{capabilityContract.handoff}</span>
				<span class="capability-handoff-effect">{capabilityContract.effect}</span>
			</div>
		{/if}

		{#if object.type === 'campaign'}
			<div class="metric-row">
				<span class="metric"
					><Datum value={object.campaign.verifiedActions} class="metric-num" /> verified</span
				>
				<span class="metric-sub"
					><Datum value={object.campaign.totalActions} class="metric-sub-num" /> total</span
				>
			</div>
			{#if object.campaign.totalActions > 0}
				<Ratio
					height={detail === 'full' ? 6 : 4}
					segments={[
						{
							value: object.campaign.verifiedActions,
							color: 'var(--coord-verified, #10b981)',
							label: 'verified'
						},
						{
							value: Math.max(0, object.campaign.totalActions - object.campaign.verifiedActions),
							color: 'var(--coord-route-solid, #3bc4b8)',
							label: 'unverified'
						}
					]}
				/>
			{/if}
			{#if detail === 'full'}
				<p class="cnode-meta">
					{object.campaign.type || 'action'} · updated {statusDate(object.campaign.updatedAt)}
				</p>
			{/if}
		{:else if object.type === 'funnel'}
			<div class="funnel-stack">
				<div class="funnel-row">
					<span class="funnel-label">People in ledger</span>
					<Datum value={object.funnel.total} class="funnel-num" />
				</div>
				<div class="funnel-row">
					<span class="funnel-label">Address resolved</span>
					<Datum value={object.funnel.postalResolved} class="funnel-num" />
				</div>
				<div class="funnel-row">
					<span class="funnel-label">District signal</span>
					<Datum value={object.funnel.districtVerified} class="funnel-num" />
				</div>
				<div class="funnel-row">
					<span class="funnel-label">Identity verified</span>
					<Datum value={object.funnel.identityVerified} class="funnel-num" />
				</div>
			</div>
		{:else if object.type === 'email-health'}
			{@const h = object.health}
			<Ratio
				height={detail === 'full' ? 8 : 5}
				segments={[
					{ value: h.subscribed, color: 'var(--coord-verified, #10b981)', label: 'subscribed' },
					{ value: h.unsubscribed, color: 'oklch(0.5 0.01 250)', label: 'unsubscribed' },
					{ value: h.bounced, color: 'oklch(0.6 0.14 40)', label: 'bounced' },
					{ value: h.complained, color: 'oklch(0.6 0.16 25)', label: 'complained' }
				]}
			/>
			<div class="health-legend">
				<span class="health-item"
					><span class="dot dot--ok"></span><Datum value={h.subscribed} class="health-num" /> subscribed</span
				>
				{#if detail === 'full'}
					<span class="health-item"
						><span class="dot dot--bounce"></span><Datum value={h.bounced} class="health-num" /> bounced</span
					>
					<span class="health-item"
						><span class="dot dot--complain"></span><Datum
							value={h.complained}
							class="health-num"
						/> complained</span
					>
				{/if}
			</div>
		{:else if object.type === 'decision-maker'}
			<p class="cnode-meta">
				{object.dm.title ?? 'Decision-maker'}{object.dm.party ? ` · ${object.dm.party}` : ''}
			</p>
			{#if detail === 'full'}
				<dl class="kv">
					{#if object.dm.jurisdiction}
						<div class="kv-row">
							<dt>Jurisdiction</dt>
							<dd>{object.dm.jurisdiction}</dd>
						</div>
					{/if}
					{#if object.dm.district}
						<div class="kv-row">
							<dt>District</dt>
							<dd>{object.dm.district}</dd>
						</div>
					{/if}
					<div class="kv-row">
						<dt>Followed via</dt>
						<dd>{object.dm.reason}</dd>
					</div>
				</dl>
			{/if}
		{:else if object.type === 'bill'}
			<p class="cnode-meta">
				{object.bill.jurisdiction || 'jurisdiction —'} · {object.bill.status || 'status —'}
			</p>
			{#if detail === 'full' && object.bill.externalId}
				<p class="cnode-ext">{object.bill.externalId}</p>
			{/if}
		{:else if object.type === 'scorecard'}
			<div class="metric-row">
				<span class="metric"
					><Datum value={object.scorecardAvg} class="metric-num" /> avg score</span
				>
				<span class="metric-sub"
					>over <Datum value={object.scorecardCount} class="metric-sub-num" /></span
				>
			</div>
			{#if detail === 'full'}
				<dl class="kv">
					<div class="kv-row">
						<dt>Top engaged</dt>
						<dd>{object.scorecard.name}</dd>
					</div>
					<div class="kv-row">
						<dt>Reports received</dt>
						<dd><Datum value={object.scorecard.reportsReceived} /></dd>
					</div>
					<div class="kv-row">
						<dt>Replies logged</dt>
						<dd><Datum value={object.scorecard.repliesLogged} /></dd>
					</div>
					{#if object.scorecard.alignmentRate !== null}
						<div class="kv-row">
							<dt>Alignment</dt>
							<dd><Datum value={object.scorecard.alignmentRate} decimals={0} />%</dd>
						</div>
					{/if}
				</dl>
			{/if}
		{:else if object.type === 'packet'}
			<div class="metric-row">
				<span class="metric"
					><Datum value={object.packet.verified} class="metric-num" /> verified</span
				>
				<span class="metric-sub"
					><Datum value={object.packet.verifiedPct} class="metric-sub-num" />% of <Datum
						value={object.packet.total}
						class="metric-sub-num"
					/></span
				>
			</div>
			{#if object.packet.total > 0}
				<Ratio
					height={detail === 'full' ? 6 : 4}
					segments={[
						{
							value: object.packet.verified,
							color: 'var(--coord-verified, #10b981)',
							label: 'verified'
						},
						{
							value: Math.max(0, object.packet.total - object.packet.verified),
							color: 'var(--coord-route-solid, #3bc4b8)',
							label: 'unverified'
						}
					]}
				/>
			{/if}
			{#if detail === 'full'}
				<dl class="kv">
					<div class="kv-row">
						<dt>Districts</dt>
						<dd><Datum value={object.packet.districtCount} /></dd>
					</div>
					<div class="kv-row">
						<dt>Individually authored</dt>
						<dd><Datum value={object.packet.authorship.individual} /></dd>
					</div>
					<div class="kv-row">
						<dt>Shared template</dt>
						<dd><Datum value={object.packet.authorship.shared} /></dd>
					</div>
					{#if object.packet.dateRange}
						<div class="kv-row">
							<dt>Span</dt>
							<dd><Datum value={object.packet.dateRange.spanDays} /> days</dd>
						</div>
					{/if}
				</dl>
			{/if}
		{/if}

		{#if detail === 'full' && detailHref}
			<a
				class="open-details"
				href={detailHref}
				data-no-pan
				onclick={(e) => {
					e.preventDefault();
					onOpenDetails(detailHref);
				}}
			>
				{detailActionLabel} →
			</a>
		{/if}
	{/if}
</div>

<style>
	.cnode {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		color: var(--org-sidebar-text, oklch(0.92 0.005 55));
	}

	/* ─── Glyph (far) ─── */
	.glyph {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.glyph-mark {
		flex-shrink: 0;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 3px;
		background: var(--accent);
		box-shadow: 0 0 10px -1px var(--accent);
	}
	.glyph-body {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
	}
	.glyph-kind {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-dim, oklch(0.45 0.01 55));
	}
	.glyph-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 13rem;
		color: var(--org-sidebar-text, oklch(0.92 0.005 55));
	}

	/* ─── Head ─── */
	.cnode-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.cnode-kind {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.cnode-tag {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		background: oklch(0.26 0.018 250 / 0.7);
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}
	.cnode-tag[data-status='active'] {
		color: var(--coord-verified, #10b981);
	}
	.cnode-tag[data-status='draft'] {
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}
	.cnode-tag[data-pos='support'],
	.cnode-tag[data-pos='aligned'] {
		color: var(--coord-verified, #10b981);
	}
	.cnode-tag[data-pos='oppose'],
	.cnode-tag[data-pos='adversarial'] {
		color: oklch(0.7 0.16 30);
	}
	.cnode-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 700;
		letter-spacing: 0;
		margin: 0;
		line-height: 1.25;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.cnode-meta {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		margin: 0;
		color: var(--org-sidebar-text-muted, oklch(0.74 0.012 70));
	}

	.capability-contract {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		padding: 0.28rem 0;
		border-top: 1px solid oklch(0.48 0.018 250 / 0.34);
		border-bottom: 1px solid oklch(0.48 0.018 250 / 0.2);
	}
	.capability-state,
	.capability-clusters {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		line-height: 1.1;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-dim, oklch(0.52 0.012 60));
		white-space: nowrap;
	}
	.capability-state {
		color: var(--accent);
	}
	.capability-contract[data-state='draft-only'] .capability-state {
		color: oklch(0.7 0.12 78);
	}
	.capability-contract[data-state='gated'] .capability-state {
		color: oklch(0.58 0.035 60);
	}
	.capability-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--org-sidebar-text-muted, oklch(0.72 0.012 70));
		white-space: nowrap;
	}
	.capability-clusters {
		margin-left: auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: right;
	}
	.capability-gate {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		margin-top: -0.25rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		line-height: 1.15;
		color: var(--org-sidebar-text-dim, oklch(0.5 0.012 60));
	}
	.capability-gate-label,
	.capability-gate-tasks {
		flex-shrink: 0;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.capability-gate-label {
		color: var(--accent);
	}
	.capability-gate-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--org-sidebar-text-muted, oklch(0.66 0.012 70));
	}
	.capability-gate-tasks {
		margin-left: auto;
		color: var(--org-sidebar-text-dim, oklch(0.46 0.01 55));
	}
	.capability-handoff {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.2rem 0.45rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid oklch(0.48 0.018 250 / 0.18);
	}
	.capability-handoff-label {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		line-height: 1.1;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-dim, oklch(0.48 0.01 55));
		white-space: nowrap;
	}
	.capability-handoff-value {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--org-sidebar-text-muted, oklch(0.72 0.012 70));
	}
	.capability-handoff-effect {
		grid-column: 1 / -1;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--org-sidebar-text-muted, oklch(0.64 0.012 70));
	}
	.cnode-ext {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		margin: 0;
		color: var(--org-sidebar-text-dim, oklch(0.45 0.01 55));
	}

	/* ─── Metric row ─── */
	.metric-row {
		display: flex;
		align-items: baseline;
		gap: 0.625rem;
	}
	.metric {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: var(--org-sidebar-text, oklch(0.88 0.008 55));
	}
	.metric :global(.metric-num) {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--accent);
	}
	.metric-sub {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}

	/* ─── Funnel ─── */
	.funnel-stack {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.funnel-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.funnel-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: var(--org-sidebar-text-muted, oklch(0.74 0.012 70));
	}
	.funnel-stack :global(.funnel-num) {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--org-sidebar-text, oklch(0.88 0.008 55));
	}

	/* ─── Email health ─── */
	.health-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.health-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--org-sidebar-text-muted, oklch(0.74 0.012 70));
	}
	.health-legend :global(.health-num) {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--org-sidebar-text, oklch(0.86 0.008 55));
	}
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
	}
	.dot--ok {
		background: var(--coord-verified, #10b981);
	}
	.dot--bounce {
		background: oklch(0.6 0.14 40);
	}
	.dot--complain {
		background: oklch(0.6 0.16 25);
	}

	/* ─── Key/value ─── */
	.kv {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding-top: 0.4rem;
		border-top: 1px solid oklch(0.28 0.018 250 / 0.6);
	}
	.kv-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.kv-row dt {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--org-sidebar-text-muted, oklch(0.6 0.01 55));
	}
	.kv-row dd {
		margin: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.75rem;
		color: var(--org-sidebar-text, oklch(0.86 0.008 55));
		text-align: right;
		min-width: 0;
	}

	/* ─── Open Details ─── */
	.open-details {
		align-self: flex-start;
		margin-top: 0.25rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--org-sidebar-text-muted, oklch(0.74 0.012 70));
		text-decoration: none;
		border-bottom: 1px solid oklch(0.74 0.012 70 / 0.44);
		transition:
			color 220ms cubic-bezier(0.4, 0, 0.2, 1),
			border-color 220ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.open-details:hover,
	.open-details:focus-visible {
		color: var(--accent);
		border-bottom-color: var(--accent);
		outline: none;
	}
</style>
