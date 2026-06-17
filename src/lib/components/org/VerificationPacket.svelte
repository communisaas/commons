<script lang="ts">
	import { spring } from 'svelte/motion';
	import type { Snippet } from 'svelte';
	import type {
		VerificationPacket as Packet,
		TierCount,
		CellWeight
	} from '$lib/types/verification-packet';
	import DistrictMap from '$lib/components/geographic/DistrictMap.svelte';
	import { participationDepth } from './participation-depth';
	import { Datum, Pulse, Ratio } from '$lib/design';
	import { SPRINGS } from '$lib/design/motion';

	let {
		packet,
		label = 'Verified Constituent Report',
		boundary = undefined,
		districtCode = undefined,
		districtCentroid = undefined,
		interactive = false,
		actions
	}: {
		packet: Packet | null;
		label?: string;
		/** District boundary for geographic map (static — takes precedence) */
		boundary?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
		/** District code (e.g., "CA-11") — DistrictMap self-resolves boundary if no boundary prop */
		districtCode?: string;
		/** District centroid for boundary lookup */
		districtCentroid?: { lat: number; lng: number };
		/** Enable map interaction (pan/zoom/hover) */
		interactive?: boolean;
		actions?: Snippet;
	} = $props();

	// Cross-dimensional filter state
	let hoveredCell = $state<CellWeight | null>(null);
	function handleCellHover(cell: CellWeight | null) {
		hoveredCell = cell;
	}

	// Spring-animated hero count
	const animVerified = spring(0, SPRINGS.METRIC);
	$effect(() => {
		if (packet) animVerified.set(packet.verified);
	});

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
	const engagementTiers = $derived(
		(packet?.tiers ?? []).filter((tier: TierCount) => tier.count !== 0)
	);
	const suppressedEngagementTierCount = $derived(
		engagementTiers.filter((tier) => tier.count < 0).length
	);

	// Composition segments for the identity + authorship Ratio bars. These are real
	// non-sentinel counts (the k-anon -1 sentinel lives ONLY on tiers, which stay a
	// Rings-safe text list — never fed to Ratio), so summing into Ratio's total is
	// safe. govId→verified, address→route, email/shared→muted neutral. The per-
	// segment counts move OUT of the bar into the legend below it.
	const identitySegments = $derived(
		p.identityBreakdown
			? [
					{ value: p.identityBreakdown.govId, color: 'var(--coord-verified)', label: 'Government ID' },
					{
						value: p.identityBreakdown.addressVerified,
						color: 'var(--coord-route-solid)',
						label: 'Address'
					},
					{ value: p.identityBreakdown.emailOnly, color: 'oklch(0.82 0.01 250)', label: 'Email' }
				]
			: []
	);
	const authorshipSegments = $derived([
		{ value: p.authorship.individual, color: 'var(--coord-verified)', label: 'Individual voice' },
		{ value: p.authorship.shared, color: 'oklch(0.82 0.01 250)', label: 'Shared' }
	]);
</script>

<div class="vp">
	<!-- Title bar -->
	<div class="vp__title">{label}</div>

	{#if isEmpty}
		<div class="vp__empty">
			<p class="vp__empty-count"><Datum value={0} /></p>
			<p class="vp__empty-text">
				No verified actions yet. When supporters act, their proof accumulates here.
			</p>
		</div>
	{:else}
		<!-- Hero count -->
		<div class="vp__hero">
			<span class="vp__hero-count"><Datum value={$animVerified} /></span>
			<span class="vp__hero-label"
				>verified constituents{#if p.districtCount > 1}<br />across <Datum
						value={p.districtCount}
					/> districts{/if}</span
			>
		</div>

		<div class="vp__divider"></div>

		<!-- ═══ IDENTITY — Ratio bar (pure proportion) + ledger legend ═══ -->
		{#if p.identityBreakdown}
			<p class="vp__section-label">Identity verification</p>
			<!-- Ratio builds its own role=img aria-label from segment labels + pct. -->
			<Ratio segments={identitySegments} height={16} class="vp__ratio" />
			<ul class="vp__legend" aria-hidden="true">
				{#if p.identityBreakdown.govId > 0}
					<li class="vp__legend-item">
						<span class="vp__legend-label">
							<span class="vp__legend-swatch" style="background: var(--coord-verified)"></span>
							<span class="vp__legend-name">Government ID</span>
						</span>
						<span class="vp__legend-count"><Datum value={p.identityBreakdown.govId} /></span>
					</li>
				{/if}
				{#if p.identityBreakdown.addressVerified > 0}
					<li class="vp__legend-item">
						<span class="vp__legend-label">
							<span class="vp__legend-swatch" style="background: var(--coord-route-solid)"></span>
							<span class="vp__legend-name">Address</span>
						</span>
						<span class="vp__legend-count"
							><Datum value={p.identityBreakdown.addressVerified} /></span
						>
					</li>
				{/if}
				{#if p.identityBreakdown.emailOnly > 0}
					<li class="vp__legend-item">
						<span class="vp__legend-label">
							<span class="vp__legend-swatch" style="background: oklch(0.82 0.01 250)"></span>
							<span class="vp__legend-name">Email</span>
						</span>
						<span class="vp__legend-count"><Datum value={p.identityBreakdown.emailOnly} /></span>
					</li>
				{/if}
			</ul>

			<div class="vp__divider"></div>
		{/if}

		<!-- ═══ AUTHORSHIP — Ratio bar (pure proportion) + ledger legend ═══ -->
		{#if p.authorship.individual > 0 || p.authorship.shared > 0}
			<p class="vp__section-label">Authorship</p>
			<Ratio segments={authorshipSegments} height={16} class="vp__ratio" />
			<ul class="vp__legend" aria-hidden="true">
				{#if p.authorship.individual > 0}
					<li class="vp__legend-item">
						<span class="vp__legend-label">
							<span class="vp__legend-swatch" style="background: var(--coord-verified)"></span>
							<span class="vp__legend-name">Individual voice</span>
						</span>
						<span class="vp__legend-count"><Datum value={p.authorship.individual} /></span>
					</li>
				{/if}
				{#if p.authorship.shared > 0}
					<li class="vp__legend-item">
						<span class="vp__legend-label">
							<span class="vp__legend-swatch" style="background: oklch(0.82 0.01 250)"></span>
							<span class="vp__legend-name">Shared</span>
						</span>
						<span class="vp__legend-count"><Datum value={p.authorship.shared} /></span>
					</li>
				{/if}
			</ul>

			<div class="vp__divider"></div>
		{/if}

		<!-- ═══ GEOGRAPHY — district map with H3 hexagons ═══ -->
		{#if p.cells && p.cells.length > 0}
			<p class="vp__section-label">Geographic spread</p>
			<div class="vp__map-container">
				<DistrictMap
					{boundary}
					{districtCode}
					{districtCentroid}
					cells={p.cells}
					{interactive}
					onCellHover={handleCellHover}
				/>
			</div>
			<div class="vp__geo-footer">
				<p class="vp__geo-meta">
					Spread across <Datum value={p.cells.length} /> neighborhood{p.cells.length === 1
						? ''
						: 's'}
					{#if hoveredCell}
						<span class="vp__hover-inline">
							&middot; <Datum value={hoveredCell.count} class="vp__hover-num" /> here
							{#if hoveredCell.identity}
								&middot; <Datum value={hoveredCell.identity.govId} class="vp__hover-num" /> gov ID
							{/if}
						</span>
					{/if}
				</p>
			</div>

			<div class="vp__divider"></div>
		{:else if p.geography && p.geography.length > 1}
			<p class="vp__section-label">Geographic spread</p>
			<p class="vp__geo-meta">
				Spread across <Datum value={p.geography.length} /> communities
			</p>

			<div class="vp__divider"></div>
		{/if}

		<!-- ═══ ARRIVAL — temporal pulse ═══ -->
		{#if p.temporal?.bins}
			<p class="vp__section-label">Arrival</p>
			<div class="vp__temporal">
				<Pulse
					values={p.temporal.bins}
					width={200}
					height={28}
					color="var(--coord-route-solid, #3bc4b8)"
				/>
				{#if p.dateRange.spanDays > 0}
					<span class="vp__temporal-caption">
						<span class="vp__temporal-range"
							>{fmtDateRange(p.dateRange.earliest, p.dateRange.latest, p.dateRange.spanDays)}</span
						>
						<span class="vp__temporal-detail">{p.dateRange.spanDays} days</span>
					</span>
				{/if}
			</div>
		{/if}

		<!-- CTA slot -->
		{#if actions}
			{@render actions()}
		{/if}

		<!-- Seal — click to drill into the audit detail behind the headline evidence -->
		<details class="vp__seal-details">
			<summary class="vp__seal">
				<span class="vp__seal-text">Audit trail &middot; independently verifiable</span>
				<span class="vp__seal-chevron" aria-hidden="true">›</span>
			</summary>
			<div class="vp__seal-drawer">
				<dl class="vp__seal-hashes">
					<div class="vp__seal-hash-row">
						<dt>identity registry</dt>
						<dd>
							<code>user_root</code> &mdash; the protocol&rsquo;s standing commitment to every
							verified person (registry scheme, not a value bound to this report)
						</dd>
					</div>
					<div class="vp__seal-hash-row">
						<dt>district registry</dt>
						<dd>
							<code>cell_map_root</code> &mdash; the protocol&rsquo;s standing commitment to H3-cell
							→ district assignments (registry scheme, not a value bound to this report)
						</dd>
					</div>
					<div class="vp__seal-hash-row">
						<dt>action anchor</dt>
						<dd>
							<code>engagement_root</code> &mdash; the protocol&rsquo;s standing commitment to
							per-person action history (registry scheme, not a value bound to this report)
						</dd>
					</div>
					<div class="vp__seal-hash-row">
						<dt>one-time receipts</dt>
						<dd>
							<Datum value={p.verified} /> &mdash; one per verified action, prevents double-spend (<code
								>nullifier</code
							>)
						</dd>
					</div>
					{#if engagementTiers.length > 0}
						<div class="vp__seal-hash-row">
							<dt>participation depth</dt>
							<dd>
								<ul class="vp__depth-list">
									{#each engagementTiers as tier (tier.tier)}
										<li>
											{participationDepth(tier.tier)} &mdash;
											{#if tier.count > 0}
												<Datum value={tier.count} cite="computeTierDistribution" />
											{:else}
												fewer than 5
											{/if}
										</li>
									{/each}
								</ul>
								{#if suppressedEngagementTierCount > 0}
									<p class="vp__depth-privacy">
										Groups smaller than five people are reported as &ldquo;fewer than 5&rdquo; so
										no individual can be identified.
									</p>
								{/if}
							</dd>
						</div>
					{/if}
					{#if p.gds !== null}
						<div class="vp__seal-hash-row">
							<dt>geographic diversity</dt>
							<dd>
								<Datum value={p.gds} decimals={2} cite="computeGDSFromDistribution" /> on a 0&ndash;1
								scale &mdash; higher means actions spread across more communities rather than one place
							</dd>
						</div>
					{/if}
				</dl>
				<p class="vp__seal-footnote">
					This report is bound by a single SHA-256 attestation over its aggregate figures &mdash; a
					decision-maker can recompute it independently without learning who signed. Counts are
					K-anonymized aggregates, never per-person.
					<a href="/spec" class="vp__seal-link">Read the full protocol &rarr;</a>
				</p>
			</div>
		</details>
	{/if}
</div>

<style>
	/* ═══ Verification Packet — the specimen IS the component ═══
	   White artifact on warm cream ground. Document aesthetic.
	   Every staffer-facing dimension gets a self-labeling stacked bar or map.
	   Platform-internal metrics live behind the collapsed audit drawer. */

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

	@media (min-width: 640px) {
		.vp {
			font-size: 0.8125rem;
		}
	}

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
	@media (min-width: 640px) {
		.vp__title {
			padding: 0.75rem 2rem;
			font-size: 0.625rem;
		}
	}

	/* Empty state */
	.vp__empty {
		padding: 2rem 1.25rem;
		text-align: center;
	}
	.vp__empty-count {
		font-size: 1.875rem;
		font-weight: 700;
		color: oklch(0.7 0.01 250);
		margin: 0;
	}
	.vp__empty-text {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		color: oklch(0.55 0.01 250);
		margin: 0.75rem 0 0;
	}

	/* Hero */
	.vp__hero {
		padding: 1rem 1.25rem 1.25rem;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	@media (min-width: 640px) {
		.vp__hero {
			padding: 1.5rem 2rem 1.75rem;
		}
	}

	.vp__hero-count {
		font-size: 2.5rem;
		font-weight: 700;
		color: oklch(0.35 0.12 165);
		line-height: 1;
	}
	@media (min-width: 640px) {
		.vp__hero-count {
			font-size: 3.25rem;
		}
	}

	.vp__hero-label {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.42 0.01 250);
		font-weight: 400;
		line-height: 1.4;
	}

	/* Divider */
	.vp__divider {
		height: 1px;
		background: oklch(0.91 0.006 250);
		margin: 0.875rem 1.25rem;
	}
	@media (min-width: 640px) {
		.vp__divider {
			margin: 1rem 2rem;
		}
	}

	/* Section labels */
	.vp__section-label {
		font-size: 0.5625rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: oklch(0.5 0.012 250);
		margin: 0 1.25rem 0.375rem;
	}
	@media (min-width: 640px) {
		.vp__section-label {
			margin-left: 2rem;
			margin-right: 2rem;
			font-size: 0.625rem;
		}
	}

	/* Composition: Ratio bar (pure proportion) + ledger legend (the counts) */
	.vp__ratio {
		margin: 0 1.25rem;
	}
	@media (min-width: 640px) {
		.vp__ratio {
			margin: 0 2rem;
		}
	}

	.vp__legend {
		list-style: none;
		margin: 0.5rem 1.25rem 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	@media (min-width: 640px) {
		.vp__legend {
			margin-left: 2rem;
			margin-right: 2rem;
		}
	}

	.vp__legend-item {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.vp__legend-label {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
	}

	.vp__legend-swatch {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.vp__legend-name {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.625rem;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: oklch(0.45 0.012 250);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.vp__legend-count {
		font-weight: 700;
		font-size: 0.75rem;
		flex-shrink: 0;
	}
	@media (min-width: 640px) {
		.vp__legend-count {
			font-size: 0.8125rem;
		}
	}

	/* District map */
	.vp__map-container {
		height: 160px;
		margin: 0.25rem 1.25rem;
		border-radius: 3px;
		overflow: hidden;
		border: 1px solid oklch(0.91 0.006 250);
	}
	@media (min-width: 640px) {
		.vp__map-container {
			height: 200px;
			margin: 0.25rem 2rem;
		}
	}

	.vp__geo-footer {
		padding: 0.25rem 1.25rem 0;
	}
	@media (min-width: 640px) {
		.vp__geo-footer {
			padding-left: 2rem;
			padding-right: 2rem;
		}
	}

	.vp__geo-meta {
		font-size: 0.625rem;
		color: oklch(0.5 0.01 250);
		margin: 0;
	}
	@media (min-width: 640px) {
		.vp__geo-meta {
			font-size: 0.6875rem;
		}
	}

	/* Hover detail appended inline — no layout shift */
	:global(.vp__hover-inline) {
		opacity: 0.9;
	}
	:global(.vp__hover-num) {
		font-weight: 700;
		color: oklch(0.3 0.02 250);
	}

	/* Temporal arrival */
	.vp__temporal {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		padding: 0.25rem 1.25rem 0;
	}
	@media (min-width: 640px) {
		.vp__temporal {
			padding-left: 2rem;
		}
	}
	@media (max-width: 479px) {
		.vp__temporal {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.25rem;
		}
	}

	.vp__temporal-caption {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.vp__temporal-range {
		font-size: 0.6875rem;
		font-weight: 500;
		color: oklch(0.32 0.015 250);
	}
	.vp__temporal-detail {
		font-size: 0.5625rem;
		color: oklch(0.52 0.008 250);
	}
	@media (min-width: 640px) {
		.vp__temporal-range {
			font-size: 0.75rem;
		}
		.vp__temporal-detail {
			font-size: 0.625rem;
		}
	}

	/* Seal — interactive drawer */
	.vp__seal-details {
		margin-top: 1rem;
		border-top: 1px solid oklch(0.88 0.01 165 / 0.4);
		background: oklch(0.97 0.008 165 / 0.35);
	}

	.vp__seal {
		list-style: none;
		padding: 0.75rem 1.25rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: space-between;
		transition: background 150ms ease-out;
	}
	.vp__seal::-webkit-details-marker {
		display: none;
	}
	.vp__seal:hover {
		background: oklch(0.96 0.012 165 / 0.45);
	}
	@media (min-width: 640px) {
		.vp__seal {
			padding: 0.875rem 2rem;
		}
	}

	.vp__seal-text {
		font-size: 0.6875rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		font-weight: 500;
		color: oklch(0.4 0.05 165);
	}
	@media (min-width: 640px) {
		.vp__seal-text {
			font-size: 0.75rem;
		}
	}

	.vp__seal-chevron {
		font-family: 'JetBrains Mono', monospace;
		color: oklch(0.5 0.06 165);
		transition: transform 200ms ease-out;
		font-size: 1rem;
		line-height: 1;
	}
	.vp__seal-details[open] .vp__seal-chevron {
		transform: rotate(90deg);
	}

	.vp__seal-drawer {
		padding: 0.25rem 1.25rem 1rem;
		border-top: 1px solid oklch(0.9 0.012 165 / 0.4);
	}
	@media (min-width: 640px) {
		.vp__seal-drawer {
			padding: 0.25rem 2rem 1.25rem;
		}
	}

	.vp__seal-hashes {
		margin: 0.75rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.vp__seal-hash-row {
		display: grid;
		grid-template-columns: 8rem 1fr;
		gap: 0.75rem;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.45;
		color: oklch(0.42 0.015 250);
	}
	@media (max-width: 479px) {
		.vp__seal-hash-row {
			grid-template-columns: 1fr;
			gap: 0.125rem;
		}
	}

	.vp__seal-hash-row dt {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.5 0.01 250);
		font-weight: 600;
		padding-top: 0.125rem;
	}

	.vp__seal-hash-row dd {
		margin: 0;
	}
	.vp__seal-hash-row code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		color: oklch(0.25 0.03 250);
		background: oklch(0.95 0.004 250);
		padding: 0.0625rem 0.25rem;
		border-radius: 2px;
		font-weight: 500;
	}

	.vp__depth-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.125rem 1rem;
	}

	.vp__depth-privacy {
		margin: 0.375rem 0 0;
		font-size: 0.6875rem;
		color: oklch(0.5 0.01 250);
	}

	.vp__seal-footnote {
		margin: 1rem 0 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.5;
		color: oklch(0.45 0.015 250);
	}

	.vp__seal-link {
		color: oklch(0.38 0.1 175);
		text-decoration: none;
		border-bottom: 1px solid oklch(0.82 0.06 180 / 0.5);
		margin-left: 0.25rem;
	}
	.vp__seal-link:hover {
		color: oklch(0.32 0.11 175);
		border-bottom-color: oklch(0.45 0.1 180);
	}
</style>
