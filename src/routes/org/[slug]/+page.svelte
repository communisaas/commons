<script lang="ts">
	import VerificationPacket from '$lib/components/org/VerificationPacket.svelte';
	import OnboardingChecklist from '$lib/components/org/OnboardingChecklist.svelte';
	import LegislativeActivity from '$lib/components/org/LegislativeActivity.svelte';
	import { FEATURES } from '$lib/config/features';
	import { Datum, Ratio } from '$lib/design';
	import { SPRINGS } from '$lib/design/motion';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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

	// Effective reach (email status breakdown)
	const er = $derived(data.emailReach);

	// Funnel percentages (relative to imported)
	const funnel = $derived(data.funnel);
	const funnelMax = $derived(Math.max(funnel.imported, 1));
	const funnelSteps = $derived([
		{ label: 'Imported', count: funnel.imported, pct: 100 },
		{ label: 'Postal Resolved', count: funnel.postalResolved, pct: Math.round((funnel.postalResolved / funnelMax) * 100) },
		{ label: 'Identity Verified', count: funnel.identityVerified, pct: Math.round((funnel.identityVerified / funnelMax) * 100) },
		{ label: 'District Verified', count: funnel.districtVerified, pct: Math.round((funnel.districtVerified / funnelMax) * 100) }
	]);

	// Tier distribution
	const tierTotal = $derived(data.tiers.reduce((s, t) => s + t.count, 0));
	const tierMax = $derived(Math.max(...data.tiers.map(t => t.count), 1));

	// Endorsement management state
	let endorsedList = $state(data.endorsedTemplates ?? []);
	let searchQuery = $state('');
	let searchResults = $state<Array<{
		id: string; slug: string; title: string; description: string;
		verified_sends: number; unique_districts: number; similarity: number | null;
	}>>([]);
	let searching = $state(false);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let errorFlash = $state('');
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;

	const endorsedIds = $derived(new Set(endorsedList.map(e => e.templateId)));

	function showError(msg: string): void {
		errorFlash = msg;
		if (errorTimeout) clearTimeout(errorTimeout);
		errorTimeout = setTimeout(() => { errorFlash = ''; }, 3000);
	}

	function handleSearchInput(e: Event): void {
		const q = (e.target as HTMLInputElement).value;
		searchQuery = q;
		if (searchTimeout) clearTimeout(searchTimeout);
		if (q.trim().length < 2) {
			searchResults = [];
			return;
		}
		searching = true;
		searchTimeout = setTimeout(async () => {
			try {
				const res = await fetch('/api/templates/search', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						query: q.trim(),
						limit: 5,
						excludeIds: [...endorsedIds]
					})
				});
				if (res.ok) {
					const json = await res.json();
					searchResults = json.templates ?? [];
				}
			} catch { /* graceful */ }
			searching = false;
		}, 300);
	}

	async function endorseTemplate(templateId: string): Promise<void> {
		const found = searchResults.find(t => t.id === templateId);
		if (!found) return;

		const optimisticEntry = {
			id: crypto.randomUUID(),
			templateId: found.id,
			slug: found.slug,
			title: found.title,
			description: found.description,
			sends: found.verified_sends,
			districts: found.unique_districts ?? 0,
			endorsedAt: new Date().toISOString()
		};
		endorsedList = [optimisticEntry, ...endorsedList];
		searchResults = searchResults.filter(t => t.id !== templateId);

		try {
			const res = await fetch(`/api/org/${data.org.slug}/endorsements`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ templateId })
			});
			if (!res.ok) {
				endorsedList = endorsedList.filter(e => e.id !== optimisticEntry.id);
				searchResults = [found, ...searchResults];
				showError('Failed to endorse — try again');
			}
		} catch {
			endorsedList = endorsedList.filter(e => e.id !== optimisticEntry.id);
			searchResults = [found, ...searchResults];
			showError('Network error — try again');
		}
	}

	async function removeEndorsement(templateId: string): Promise<void> {
		const prevList = endorsedList;
		endorsedList = endorsedList.filter(e => e.templateId !== templateId);

		try {
			const res = await fetch(`/api/org/${data.org.slug}/endorsements`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ templateId })
			});
			if (!res.ok) {
				endorsedList = prevList;
				showError('Failed to remove — try again');
			}
		} catch {
			endorsedList = prevList;
			showError('Network error — try again');
		}
	}
</script>

<svelte:head>
	<title>{data.org.name} | Commons</title>
</svelte:head>

<div class="dashboard">
	<!-- ═══ ONBOARDING ═══ -->
	{#if !data.onboardingComplete}
		<OnboardingChecklist
			orgSlug={data.org.slug}
			onboarding={data.onboardingState}
			orgDescription={data.org.description}
			billingEmail={data.billingEmail ?? null}
			funnel={data.funnel}
		/>
	{/if}

	<!-- ═══════════════════════════════════════════
	     PROOF — the gravitational center
	     The packet is the reason this page exists.
	     Everything else serves it.
	     ═══════════════════════════════════════════ -->
	<VerificationPacket
		packet={data.packet}
		label={data.stats.activeCampaigns > 0
			? `Coordination Integrity \u00b7 ${data.stats.activeCampaigns} active campaign${data.stats.activeCampaigns === 1 ? '' : 's'}`
			: 'Coordination Integrity'}
	>
		{#snippet actions()}
			{#if data.packet && data.topCampaignId}
				<div class="proof-cta">
					<a href="/org/{data.org.slug}/campaigns/{data.topCampaignId}/report" class="cta cta--primary">
						Deliver Proof
					</a>
					<a href="/org/{data.org.slug}/campaigns/{data.topCampaignId}/report" class="cta cta--ghost">
						Preview Packet
					</a>
				</div>
			{/if}
		{/snippet}
	</VerificationPacket>


	<!-- ═══════════════════════════════════════════
	     OPERATIONS — campaigns + sidebar
	     Campaigns are the verification engines.
	     Sidebar holds reach, arrivals, legislative.
	     ═══════════════════════════════════════════ -->
	<div class="operations">
		<!-- Campaigns -->
		<section class="campaigns-section">
			<div class="section-head">
				<span class="section-label">Campaigns</span>
				<a href="/org/{data.org.slug}/campaigns" class="section-link">View all</a>
			</div>

			{#if data.campaigns.length === 0}
				<div class="empty-state">
					<p class="empty-text">No campaigns yet.</p>
					<a href="/org/{data.org.slug}/campaigns/new" class="empty-action">Assemble your first proof</a>
				</div>
			{:else}
				<div class="campaigns">
					{#each data.campaigns as campaign (campaign.id)}
						<a href="/org/{data.org.slug}/campaigns/{campaign.id}" class="campaign">
							<div class="campaign-count">
								<span class="count-value">
									<Datum value={campaign.verifiedActions} animate spring={SPRINGS.METRIC} />
								</span>
								<span class="count-unit">verified</span>
							</div>

							<div class="campaign-body">
								<span class="campaign-title">{campaign.title}</span>
								{#if campaign.totalActions > 0}
									<Ratio segments={[
										{ value: campaign.verifiedActions, color: 'var(--coord-verified)', label: 'verified' },
										{ value: Math.max(0, campaign.totalActions - campaign.verifiedActions), color: 'oklch(0.91 0.005 60)', label: 'unverified' }
									]} height={3} />
								{/if}
								<span class="campaign-meta">
									<Datum value={campaign.totalActions} class="meta-num" /> total &middot; {relativeTime(campaign.updatedAt)}
								</span>
							</div>

							<span class="campaign-status" data-status={campaign.status.toLowerCase()}>{campaign.status}</span>
						</a>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Sidebar -->
		<aside class="sidebar">
			<!-- Effective Reach -->
			{#if er.subscribed > 0 || er.unsubscribed > 0}
				<div class="reach">
					<span class="section-label">Effective Reach</span>
					<div class="reach-hero">
						<span class="reach-value">
							<Datum value={er.subscribed} animate spring={SPRINGS.METRIC} />
						</span>
						<span class="reach-of">
							/ <Datum value={er.total} />
						</span>
					</div>
					<Ratio segments={[
						{ value: er.subscribed, color: 'var(--coord-verified)', label: 'subscribed' },
						{ value: er.unsubscribed, color: 'oklch(0.65 0.15 50)', label: 'unsubscribed' },
						{ value: er.bounced, color: 'oklch(0.6 0.18 25)', label: 'bounced' },
						{ value: er.complained, color: 'oklch(0.55 0.15 25)', label: 'complained' }
					]} height={4} />
				</div>
			{/if}

			<!-- Recent Arrivals -->
			{#if data.recentActivity.length > 0}
				<div class="arrivals">
					<span class="section-label">Recent Arrivals</span>
					<div class="arrival-list">
						{#each data.recentActivity.slice(0, 8) as item (item.id)}
							<div class="arrival">
								<span class="arrival-dot" class:arrival-dot--verified={item.verified}></span>
								<span class="arrival-text">
									<span class="arrival-name">{item.label}</span>
									{#if item.type === 'action'}
										<span class="arrival-sep">&middot;</span>
										<span class="arrival-detail">{item.detail}</span>
									{:else}
										<span class="arrival-note">signed up</span>
									{/if}
								</span>
								<span class="arrival-time">{relativeTime(item.timestamp)}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Legislative Activity -->
			<LegislativeActivity
				alerts={data.legislativeAlerts}
				orgSlug={data.org.slug}
				pendingCount={data.legislativeAlerts.length}
			/>
		</aside>
	</div>


	<!-- ═══════════════════════════════════════════
	     INTELLIGENCE — decision makers + legislation
	     Only appears when there's data to show.
	     ═══════════════════════════════════════════ -->
	{#if data.followedReps.count > 0 || data.watchedBills.count > 0}
		<div class="intelligence">
			{#if data.followedReps.count > 0}
				<section class="intel-col">
					<div class="section-head">
						<span class="section-label">Decision Makers</span>
						<a href="/org/{data.org.slug}/representatives" class="section-link">View all</a>
					</div>
					<div class="intel-hero">
						<span class="intel-count">
							<Datum value={data.followedReps.count} animate spring={SPRINGS.METRIC} />
						</span>
						<span class="intel-unit">followed</span>
					</div>
					{#if data.followedReps.top.length > 0}
						<div class="intel-list">
							{#each data.followedReps.top as dm (dm.id)}
								<div class="intel-entry">
									{#if dm.party}
										<span class="party" data-party={dm.party}>{dm.party}</span>
									{/if}
									<span class="intel-name">{dm.name}</span>
									{#if dm.jurisdiction}
										<span class="intel-jurisdiction">{dm.jurisdiction}</span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{/if}

			{#if data.watchedBills.count > 0}
				<section class="intel-col">
					<div class="section-head">
						<span class="section-label">Legislation</span>
						<a href="/org/{data.org.slug}/legislation" class="section-link">View all</a>
					</div>
					<div class="intel-hero">
						<span class="intel-count">
							<Datum value={data.watchedBills.count} animate spring={SPRINGS.METRIC} />
						</span>
						<span class="intel-unit">watched</span>
					</div>
					{#if data.watchedBills.top.length > 0}
						<div class="intel-list">
							{#each data.watchedBills.top as bill (bill.id)}
								<div class="intel-entry">
									<span class="bill-status">{bill.status}</span>
									<span class="intel-name">{bill.title}</span>
									{#if bill.position}
										<span class="bill-position" data-position={bill.position}>{bill.position}</span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{/if}
		</div>
	{/if}


	<!-- ═══════════════════════════════════════════
	     DEPTH — collapsed details
	     Pipeline, tiers, endorsed templates.
	     Available on inquiry, not on arrival.
	     ═══════════════════════════════════════════ -->
	<div class="depth">
		<details class="depth-section">
			<summary class="depth-summary">Verification pipeline &amp; engagement tiers</summary>
			<div class="depth-content">
				<!-- Verification Funnel -->
				<div class="depth-block">
					<span class="section-label">Verification Funnel</span>
					{#if funnel.imported === 0}
						<p class="empty-hint">No supporters yet. Import supporters to see verification progress.</p>
					{:else}
						<div class="funnel">
							{#each funnelSteps as step, i}
								<div class="funnel-step">
									<span class="funnel-label">{step.label}</span>
									<div class="funnel-bar">
										<div class="funnel-fill" data-step={i} style="width: {Math.max(step.pct, 1)}%"></div>
									</div>
									<span class="funnel-count"><Datum value={step.count} /></span>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Tier Distribution -->
				<div class="depth-block">
					<span class="section-label">Engagement Tier Distribution</span>
					{#if tierTotal === 0}
						<p class="empty-hint">No campaign actions yet. Tier distribution appears as supporters take action.</p>
					{:else}
						<div class="tiers">
							{#each [...data.tiers].reverse() as tier}
								<div class="tier-row">
									<span class="tier-label">{tier.label} <span class="tier-num">T{tier.tier}</span></span>
									<div class="tier-bar">
										<div
											class="tier-fill"
											data-tier={tier.tier}
											style="width: {tier.count > 0 ? Math.max((tier.count / tierMax) * 100, 2) : 0}%"
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

		<details class="depth-section">
			<summary class="depth-summary">
				Endorsed templates
				{#if endorsedList.length > 0}
					<span class="depth-badge">&middot; {endorsedList.length}</span>
				{/if}
			</summary>
			<div class="depth-content">
				{#if endorsedList.length > 0}
					<div class="endorsed-list">
						{#each endorsedList as item (item.templateId)}
							<div class="endorsed-entry">
								<a href="/s/{item.slug}" class="endorsed-title">{item.title}</a>
								{#if FEATURES.ENGAGEMENT_METRICS}
									<span class="endorsed-meta">
										<Datum value={item.sends} /> sends &middot; <Datum value={item.districts} /> districts
									</span>
								{/if}
								<button class="endorsed-remove" onclick={() => removeEndorsement(item.templateId)}>Remove</button>
							</div>
						{/each}
					</div>
				{:else}
					<p class="empty-hint">No endorsed templates yet. Endorse public templates to signal coalition support.</p>
				{/if}

				<!-- Search to endorse -->
				<div class="endorse-search">
					<input
						type="text"
						class="endorse-input"
						placeholder="Search templates to endorse..."
						value={searchQuery}
						oninput={handleSearchInput}
					/>
					{#if searchResults.length > 0}
						<div class="search-results">
							{#each searchResults as t (t.id)}
								<button class="search-result" onclick={() => endorseTemplate(t.id)}>
									<span class="search-result-title">{t.title}</span>
									<span class="search-result-action">Endorse</span>
								</button>
							{/each}
						</div>
					{/if}
					{#if searching}
						<div class="search-spinner"></div>
					{/if}
				</div>
			</div>
		</details>
	</div>

	<!-- Error flash -->
	{#if errorFlash}
		<div class="error-flash">{errorFlash}</div>
	{/if}
</div>

<style>
	/* ═══════════════════════════════════════════
	   DASHBOARD — Verification-first. Warm ground.
	   Content sits on cream. Only the proof packet
	   earns bounded artifact treatment. Everything
	   else lives on ground, grouped by proximity.
	   ═══════════════════════════════════════════ */

	.dashboard {
		display: flex;
		flex-direction: column;
		gap: 2.5rem;
	}

	@media (min-width: 768px) {
		.dashboard { gap: 3.5rem; }
	}

	/* ═══ SHARED ═══ */

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

	.section-link:hover { color: oklch(0.45 0.1 180); }

	.empty-state { padding: 1.5rem 0; }

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

	.empty-action:hover { color: oklch(0.35 0.12 180); }

	.empty-hint {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.6 0.01 250);
		margin: 0;
	}

	/* ═══ PROOF CTA ═══ */

	.proof-cta {
		display: flex;
		gap: 0.75rem;
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
		transition: background 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out;
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

	/* ���══ OPERATIONS GRID ═══ */

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

	/* ═══ CAMPAIGNS ═══
	   No cards. Each campaign is a row on ground,
	   separated by a hairline. The verified count
	   is the hero per-row — mono, large, emerald.
	   Status is a typographic annotation, not a pill.
	   ═══════════════════════════════════════════ */

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

	.campaign:first-child { border-top: none; }

	.campaign:hover .campaign-title { color: oklch(0.35 0.12 165); }

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

	/* Typographic status — not a pill badge */
	.campaign-status {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.55 0.01 250);
	}

	.campaign-status[data-status='active'] { color: oklch(0.5 0.14 165); }
	.campaign-status[data-status='paused'] { color: oklch(0.6 0.14 85); }
	.campaign-status[data-status='complete'] { color: oklch(0.45 0.12 180); }

	/* ═══ EFFECTIVE REACH ═══ */

	.reach {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.reach-hero {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
	}

	.reach-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: oklch(0.2 0.03 250);
	}

	.reach-of {
		font-size: 0.875rem;
		color: oklch(0.55 0.01 250);
	}

	/* ═══ ARRIVALS ═══ */

	.arrivals {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.arrival-list {
		display: flex;
		flex-direction: column;
	}

	.arrival {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3125rem 0;
		font-size: 0.75rem;
	}

	.arrival-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		flex-shrink: 0;
		background: oklch(0.82 0.01 250);
	}

	.arrival-dot--verified { background: var(--coord-verified, #10b981); }

	.arrival-text {
		flex: 1;
		min-width: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		color: oklch(0.42 0.015 250);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.arrival-name {
		font-weight: 500;
		color: oklch(0.28 0.02 250);
	}

	.arrival-sep { color: oklch(0.82 0.01 250); margin: 0 0.125rem; }
	.arrival-detail, .arrival-note { color: oklch(0.55 0.01 250); }

	.arrival-time {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: oklch(0.62 0.01 250);
		font-variant-numeric: tabular-nums;
	}

	/* ═══ INTELLIGENCE ═══ */

	.intelligence {
		display: grid;
		grid-template-columns: 1fr;
		gap: 2rem;
	}

	@media (min-width: 768px) {
		.intelligence {
			grid-template-columns: 1fr 1fr;
			gap: 3rem;
		}
	}

	.intel-hero {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.intel-count {
		font-size: 1.5rem;
		font-weight: 700;
		color: oklch(0.2 0.03 250);
	}

	.intel-unit {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.55 0.01 250);
	}

	.intel-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.intel-entry {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.intel-name {
		font-family: 'Satoshi', system-ui, sans-serif;
		color: oklch(0.2 0.03 250);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	.intel-jurisdiction {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		color: oklch(0.55 0.01 250);
		flex-shrink: 0;
	}

	.party {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 50%;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5rem;
		font-weight: 700;
		color: white;
		flex-shrink: 0;
	}

	.party[data-party='D'] { background: oklch(0.5 0.18 260); }
	.party[data-party='R'] { background: oklch(0.5 0.18 25); }
	.party[data-party='I'] { background: oklch(0.5 0.14 290); }

	.bill-status {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: oklch(0.52 0.06 250);
		flex-shrink: 0;
	}

	.bill-position {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.5625rem;
		font-weight: 500;
		flex-shrink: 0;
	}

	.bill-position[data-position='support'] { color: oklch(0.5 0.14 165); }
	.bill-position[data-position='oppose'] { color: oklch(0.55 0.15 25); }

	/* ═══ DEPTH (collapsed details) ═══
	   Available on inquiry, not on arrival.
	   Hairline separators. Subordinate content.
	   ═══════════════════════════════════════════ */

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

	.depth-summary:hover { color: oklch(0.22 0.03 250); }

	.depth-badge { color: oklch(0.62 0.01 250); }

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

	/* ═══ FUNNEL ═══ */

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

	.funnel-fill[data-step='0'] { background: oklch(0.78 0.01 250); }
	.funnel-fill[data-step='1'] { background: oklch(0.62 0.08 180 / 0.55); }
	.funnel-fill[data-step='2'] { background: oklch(0.58 0.1 180 / 0.7); }
	.funnel-fill[data-step='3'] { background: oklch(0.52 0.13 165 / 0.8); }

	.funnel-count {
		width: 3rem;
		text-align: right;
		font-size: 0.8125rem;
		font-weight: 600;
		color: oklch(0.38 0.015 250);
	}

	/* ═══ TIERS ═══ */

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

	.tier-num { color: oklch(0.72 0.01 250); }

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

	.tier-fill[data-tier='0'] { background: oklch(0.78 0.01 250); }
	.tier-fill[data-tier='1'] { background: oklch(0.62 0.08 180 / 0.55); }
	.tier-fill[data-tier='2'] { background: oklch(0.58 0.1 180 / 0.7); }
	.tier-fill[data-tier='3'] { background: oklch(0.52 0.12 165 / 0.8); }
	.tier-fill[data-tier='4'] { background: oklch(0.52 0.15 165); }

	.tier-count {
		width: 2.5rem;
		text-align: right;
		font-size: 0.75rem;
		font-weight: 600;
		color: oklch(0.38 0.015 250);
	}

	/* ═══ ENDORSED TEMPLATES ═══ */

	.endorsed-list {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		margin-bottom: 1rem;
	}

	.endorsed-entry {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0;
	}

	.endorsed-title {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 500;
		color: oklch(0.2 0.03 250);
		text-decoration: none;
		transition: color 150ms ease-out;
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.endorsed-title:hover { color: oklch(0.35 0.12 165); }

	.endorsed-meta {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: oklch(0.58 0.01 250);
		flex-shrink: 0;
	}

	.endorsed-remove {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		color: oklch(0.65 0.01 250);
		background: none;
		border: none;
		cursor: pointer;
		opacity: 0;
		transition: opacity 150ms ease-out, color 150ms ease-out;
		flex-shrink: 0;
		padding: 0;
	}

	.endorsed-entry:hover .endorsed-remove { opacity: 1; }
	.endorsed-remove:hover { color: oklch(0.55 0.15 25); }

	/* ═══ SEARCH ═══ */

	.endorse-search { position: relative; }

	.endorse-input {
		width: 100%;
		padding: 0.5625rem 0.75rem;
		border-radius: 4px;
		border: 1px solid oklch(0.88 0.008 60);
		background: white;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.2 0.02 250);
		outline: none;
		transition: border-color 150ms ease-out;
	}

	.endorse-input:focus { border-color: oklch(0.65 0.1 180); }
	.endorse-input::placeholder { color: oklch(0.65 0.01 250); }

	.search-results {
		position: absolute;
		left: 0;
		right: 0;
		top: 100%;
		margin-top: 0.25rem;
		background: white;
		border: 1px solid oklch(0.88 0.008 60);
		border-radius: 4px;
		box-shadow: 0 4px 12px -4px oklch(0 0 0 / 0.1);
		z-index: 10;
		overflow: hidden;
	}

	.search-result {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: none;
		border: none;
		border-bottom: 1px solid oklch(0.94 0.004 60);
		cursor: pointer;
		text-align: left;
		transition: background 150ms ease-out;
	}

	.search-result:last-child { border-bottom: none; }
	.search-result:hover { background: oklch(0.985 0.003 60); }

	.search-result-title {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.2 0.03 250);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.search-result-action {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		font-weight: 600;
		color: oklch(0.45 0.12 165);
		flex-shrink: 0;
		margin-left: 0.75rem;
	}

	.search-spinner {
		position: absolute;
		right: 0.625rem;
		top: 50%;
		transform: translateY(-50%);
		width: 0.75rem;
		height: 0.75rem;
		border: 1.5px solid oklch(0.82 0.01 250);
		border-top-color: oklch(0.45 0.12 165);
		border-radius: 50%;
		animation: spin 600ms linear infinite;
	}

	@keyframes spin {
		to { transform: translateY(-50%) rotate(360deg); }
	}

	/* ═══ ERROR FLASH ═══ */

	.error-flash {
		padding: 0.625rem 1rem;
		border-radius: 4px;
		border: 1px solid oklch(0.7 0.15 25 / 0.3);
		background: oklch(0.97 0.02 25 / 0.3);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.45 0.15 25);
	}
</style>
