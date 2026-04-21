<script lang="ts">
	import { spring } from 'svelte/motion';
	import type { Snippet } from 'svelte';
	import type { VerificationPacket as Packet, TierCount, CellWeight } from '$lib/types/verification-packet';
	import DistrictMap from '$lib/components/geographic/DistrictMap.svelte';
	import { Datum, Pulse } from '$lib/design';
	import { SPRINGS } from '$lib/design/motion';

	let {
		packet,
		label = 'Verified Constituent Report',
		boundary = undefined,
		interactive = false,
		actions
	}: {
		packet: Packet | null;
		label?: string;
		/** District boundary for geographic map */
		boundary?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
		/** Enable map interaction (pan/zoom/hover) */
		interactive?: boolean;
		actions?: Snippet;
	} = $props();

	// Cross-dimensional filter state
	let hoveredCell = $state<CellWeight | null>(null);
	function handleCellHover(cell: CellWeight | null) { hoveredCell = cell; }

	// Spring-animated hero count
	const animVerified = spring(0, SPRINGS.METRIC);
	$effect(() => { if (packet) animVerified.set(packet.verified); });

	function fmtDateRange(earliest: string, latest: string, spanDays: number): string {
		const fmtDate = (iso: string) => {
			const d = new Date(iso + 'T00:00:00');
			return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
		};
		if (spanDays === 0) return fmtDate(earliest);
		return `${fmtDate(earliest)} \u2013 ${fmtDate(latest)}`;
	}

	const isEmpty = $derived(!packet || packet.total === 0);
	const p = $derived(packet!);
</script>

<div class="vp">
	<!-- Title bar -->
	<div class="vp__title">{label}</div>

	{#if isEmpty}
		<div class="vp__empty">
			<p class="vp__empty-count"><Datum value={0} /></p>
			<p class="vp__empty-text">No verified actions yet. When supporters act, their proof accumulates here.</p>
		</div>
	{:else}
		<!-- Hero count -->
		<div class="vp__hero">
			<span class="vp__hero-count"><Datum value={$animVerified} /></span>
			<span class="vp__hero-label">verified constituents{#if p.districtCount > 0}<br/>across <Datum value={p.districtCount} /> communities{/if}</span>
		</div>

		<div class="vp__divider"></div>

		<!-- ═══ IDENTITY — self-labeling stacked bar ═══ -->
		{#if p.identityBreakdown}
			<p class="vp__section-label">Identity verification</p>
			<div class="vp__stack" role="img" aria-label="Identity: Government ID {p.identityBreakdown.govId}, Address {p.identityBreakdown.addressVerified}{p.identityBreakdown.emailOnly > 0 ? `, Email ${p.identityBreakdown.emailOnly}` : ''}">
				{#if p.identityBreakdown.govId > 0}
					<span class="vp__stack-seg vp__stack-seg--deep" style="flex: {p.identityBreakdown.govId}">
						<span class="vp__stack-name">Government ID</span>
						<span class="vp__stack-count"><Datum value={p.identityBreakdown.govId} /></span>
					</span>
				{/if}
				{#if p.identityBreakdown.addressVerified > 0}
					<span class="vp__stack-seg vp__stack-seg--mid" style="flex: {p.identityBreakdown.addressVerified}">
						<span class="vp__stack-name">Address</span>
						<span class="vp__stack-count"><Datum value={p.identityBreakdown.addressVerified} /></span>
					</span>
				{/if}
				{#if p.identityBreakdown.emailOnly > 0}
					<span class="vp__stack-seg vp__stack-seg--muted" style="flex: {p.identityBreakdown.emailOnly}">
						<span class="vp__stack-name">Email</span>
						<span class="vp__stack-count"><Datum value={p.identityBreakdown.emailOnly} /></span>
					</span>
				{/if}
			</div>

			<div class="vp__divider"></div>
		{/if}

		<!-- ═══ AUTHORSHIP — self-labeling stacked bar ═══ -->
		{#if p.authorship.individual > 0 || p.authorship.shared > 0}
			<p class="vp__section-label">Authorship</p>
			<div class="vp__stack" role="img" aria-label="Authorship: Individual {p.authorship.individual}, Shared {p.authorship.shared}">
				{#if p.authorship.individual > 0}
					<span class="vp__stack-seg vp__stack-seg--deep" style="flex: {p.authorship.individual}">
						<span class="vp__stack-name">Individual voice</span>
						<span class="vp__stack-count"><Datum value={p.authorship.individual} /></span>
					</span>
				{/if}
				{#if p.authorship.shared > 0}
					<span class="vp__stack-seg vp__stack-seg--muted" style="flex: {p.authorship.shared}">
						<span class="vp__stack-name">Shared</span>
						<span class="vp__stack-count"><Datum value={p.authorship.shared} /></span>
					</span>
				{/if}
			</div>

			<div class="vp__divider"></div>
		{/if}

		<!-- ═══ GEOGRAPHY — district map with H3 hexagons ═══ -->
		{#if p.cells && p.cells.length > 0}
			<p class="vp__section-label">Geographic spread</p>
			<div class="vp__map-container">
				<DistrictMap
					boundary={boundary}
					cells={p.cells}
					interactive={interactive}
					onCellHover={handleCellHover}
				/>
			</div>
			<p class="vp__geo-meta">
				<Datum value={p.cells.length} /> cells &middot; diversity <Datum value={p.gds} decimals={2} />
			</p>
			{#if hoveredCell}
				<div class="vp__hover-detail">
					{#if hoveredCell.identity}
						<span>
							<Datum value={hoveredCell.identity.govId} class="vp__hover-num" /> gov ID
							{#if hoveredCell.identity.address > 0}<span class="vp__hover-sep">&middot;</span><Datum value={hoveredCell.identity.address} class="vp__hover-num" /> address{/if}
						</span>
					{/if}
					{#if hoveredCell.authorship}
						<span>
							<Datum value={hoveredCell.authorship.individual} class="vp__hover-num" /> composed
							{#if hoveredCell.authorship.shared > 0}<span class="vp__hover-sep">&middot;</span><Datum value={hoveredCell.authorship.shared} class="vp__hover-num" /> shared{/if}
						</span>
					{/if}
					{#if hoveredCell.temporalBins}
						<Pulse values={hoveredCell.temporalBins} width={80} height={14} color="var(--coord-verified, #10b981)" />
					{/if}
				</div>
			{/if}

			<div class="vp__divider"></div>
		{:else if p.geography && p.geography.length > 1}
			<p class="vp__section-label">Geographic spread</p>
			<p class="vp__geo-meta">
				<Datum value={p.geography.length} /> communities &middot; diversity <Datum value={p.gds} decimals={2} />
			</p>

			<div class="vp__divider"></div>
		{/if}

		<!-- ═══ ARRIVAL — temporal pulse ═══ -->
		{#if p.temporal?.bins}
			<p class="vp__section-label">Arrival</p>
			<div class="vp__temporal">
				<Pulse values={p.temporal.bins} width={200} height={28} color="var(--coord-route-solid, #3bc4b8)" />
				{#if p.dateRange.spanDays > 0}
					<span class="vp__temporal-caption">
						<span class="vp__temporal-range">{fmtDateRange(p.dateRange.earliest, p.dateRange.latest, p.dateRange.spanDays)}</span>
						<span class="vp__temporal-detail">{p.dateRange.spanDays} days</span>
					</span>
				{/if}
			</div>
		{/if}

		<!-- CTA slot -->
		{#if actions}
			{@render actions()}
		{/if}

		<!-- Seal -->
		<div class="vp__seal">
			<span class="vp__seal-text">Cryptographic audit trail &middot; independently verifiable</span>
		</div>
	{/if}
</div>

<style>
	/* ═══ Verification Packet — the specimen IS the component ═══
	   White artifact on warm cream ground. Document aesthetic.
	   Every dimension gets a self-labeling stacked bar or map.
	   No collapsed audit section — the dimensions ARE the presentation. */

	.vp {
		background: #ffffff;
		border: 1px solid oklch(0.84 0.008 250);
		box-shadow:
			0 1px 2px oklch(0.15 0.01 250 / 0.05),
			0 4px 16px oklch(0.15 0.01 250 / 0.07);
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		line-height: 1.6;
		color: oklch(0.3 0.02 250);
	}

	@media (min-width: 640px) { .vp { font-size: 0.8125rem; } }

	/* Title bar */
	.vp__title {
		padding: 0.625rem 1.25rem;
		font-size: 0.5625rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: oklch(0.5 0.012 250);
		border-bottom: 1px solid oklch(0.91 0.006 250);
		background: oklch(0.985 0.002 250);
	}
	@media (min-width: 640px) { .vp__title { padding: 0.75rem 2rem; font-size: 0.625rem; } }

	/* Empty state */
	.vp__empty { padding: 2rem 1.25rem; text-align: center; }
	.vp__empty-count { font-size: 1.875rem; font-weight: 700; color: oklch(0.7 0.01 250); margin: 0; }
	.vp__empty-text { font-family: 'Satoshi', system-ui, sans-serif; font-size: 0.875rem; color: oklch(0.55 0.01 250); margin: 0.75rem 0 0; }

	/* Hero */
	.vp__hero {
		padding: 1rem 1.25rem 1.25rem;
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	@media (min-width: 640px) { .vp__hero { padding: 1.5rem 2rem 1.75rem; } }

	.vp__hero-count {
		font-size: 2.5rem;
		font-weight: 700;
		color: oklch(0.35 0.12 165);
		line-height: 1;
	}
	@media (min-width: 640px) { .vp__hero-count { font-size: 3.25rem; } }

	.vp__hero-label {
		font-size: 0.6875rem;
		color: oklch(0.48 0.01 250);
		font-weight: 400;
		line-height: 1.35;
	}

	/* Divider */
	.vp__divider {
		height: 1px;
		background: oklch(0.91 0.006 250);
		margin: 0.875rem 1.25rem;
	}
	@media (min-width: 640px) { .vp__divider { margin: 1rem 2rem; } }

	/* Section labels */
	.vp__section-label {
		font-size: 0.5625rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: oklch(0.5 0.012 250);
		margin: 0 1.25rem 0.375rem;
	}
	@media (min-width: 640px) { .vp__section-label { margin-left: 2rem; margin-right: 2rem; font-size: 0.625rem; } }

	/* Self-labeling stacked bars */
	.vp__stack {
		display: flex;
		height: 2rem;
		border-radius: 3px;
		overflow: hidden;
		gap: 1px;
		background: oklch(0.91 0.005 250);
		margin: 0 1.25rem;
	}
	@media (min-width: 640px) { .vp__stack { height: 2.25rem; margin: 0 2rem; } }

	.vp__stack-seg {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0.5rem;
		min-width: 3rem;
		overflow: hidden;
		gap: 0.25rem;
	}

	.vp__stack-name {
		font-size: 0.5625rem;
		font-weight: 500;
		letter-spacing: 0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	@media (min-width: 640px) { .vp__stack-name { font-size: 0.625rem; } }

	.vp__stack-count {
		font-weight: 700;
		font-size: 0.75rem;
		flex-shrink: 0;
	}
	@media (min-width: 640px) { .vp__stack-count { font-size: 0.8125rem; } }

	.vp__stack-seg--deep {
		background: oklch(0.38 0.1 170);
		color: oklch(0.97 0.005 170);
	}
	.vp__stack-seg--mid {
		background: oklch(0.92 0.04 175);
		color: oklch(0.25 0.03 250);
	}
	.vp__stack-seg--muted {
		background: oklch(0.94 0.005 250);
		color: oklch(0.4 0.015 250);
	}

	/* District map */
	.vp__map-container {
		height: 160px;
		margin: 0.25rem 1.25rem;
		border-radius: 3px;
		overflow: hidden;
		border: 1px solid oklch(0.91 0.006 250);
	}
	@media (min-width: 640px) { .vp__map-container { height: 200px; margin: 0.25rem 2rem; } }

	.vp__geo-meta {
		font-size: 0.625rem;
		color: oklch(0.5 0.01 250);
		padding: 0.25rem 1.25rem 0;
		margin: 0;
	}
	@media (min-width: 640px) { .vp__geo-meta { padding-left: 2rem; padding-right: 2rem; font-size: 0.6875rem; } }

	/* Hover cross-filter detail */
	.vp__hover-detail {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.25rem 1.25rem 0;
		font-size: 0.625rem;
		color: oklch(0.5 0.01 250);
	}
	@media (min-width: 640px) { .vp__hover-detail { padding-left: 2rem; } }

	:global(.vp__hover-num) { font-weight: 700; color: oklch(0.3 0.02 250); }
	.vp__hover-sep { margin: 0 0.125rem; opacity: 0.4; }

	/* Temporal arrival */
	.vp__temporal {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		padding: 0.25rem 1.25rem 0;
	}
	@media (min-width: 640px) { .vp__temporal { padding-left: 2rem; } }
	@media (max-width: 479px) {
		.vp__temporal { flex-direction: column; align-items: flex-start; gap: 0.25rem; }
	}

	.vp__temporal-caption { display: flex; flex-direction: column; gap: 0; }
	.vp__temporal-range { font-size: 0.6875rem; font-weight: 500; color: oklch(0.32 0.015 250); }
	.vp__temporal-detail { font-size: 0.5625rem; color: oklch(0.52 0.008 250); }
	@media (min-width: 640px) {
		.vp__temporal-range { font-size: 0.75rem; }
		.vp__temporal-detail { font-size: 0.625rem; }
	}

	/* Seal */
	.vp__seal {
		margin-top: 1rem;
		padding: 0.75rem 1.25rem;
		border-top: 1px solid oklch(0.88 0.01 165 / 0.4);
		background: oklch(0.97 0.008 165 / 0.35);
	}
	@media (min-width: 640px) { .vp__seal { padding: 0.875rem 2rem; } }

	.vp__seal-text {
		font-size: 0.6875rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		font-weight: 500;
		color: oklch(0.4 0.05 165);
	}
	@media (min-width: 640px) { .vp__seal-text { font-size: 0.75rem; } }
</style>
