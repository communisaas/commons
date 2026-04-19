<script lang="ts">
	import VerificationPacket from '$lib/components/org/VerificationPacket.svelte';
	import OnboardingChecklist from '$lib/components/org/OnboardingChecklist.svelte';
	import LegislativeActivity from '$lib/components/org/LegislativeActivity.svelte';
	import { FEATURES } from '$lib/config/features';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function fmt(n: number): string {
		return n.toLocaleString('en-US');
	}

	function relativeTime(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime();
		if (diff < 0) return 'just now'; // I5: guard clock skew / future timestamps
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'ACTIVE': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
			case 'DRAFT': return 'text-text-tertiary bg-surface-raised border-surface-border';
			case 'PAUSED': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
			case 'COMPLETE': return 'text-teal-400 bg-teal-500/10 border-teal-500/20';
			default: return 'text-text-tertiary bg-surface-raised border-surface-border';
		}
	}

	function tierColor(tier: number): string {
		switch (tier) {
			case 4: return 'bg-emerald-500';
			case 3: return 'bg-emerald-500/70';
			case 2: return 'bg-teal-500/60';
			case 1: return 'bg-teal-500/40';
			default: return 'bg-text-quaternary';
		}
	}

	// Effective reach (email status breakdown)
	const er = $derived(data.emailReach);
	const erPct = $derived(er.total > 0 ? (er.subscribed / er.total * 100).toFixed(1) : '0.0');

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

<div class="space-y-6">
	<!-- Page title -->
	<div>
		<h1 class="text-xl font-semibold text-text-primary">{data.org.name}</h1>
	</div>

	<!-- ===== Effective Reach ===== -->
	{#if er.total > 0}
		<div class="rounded-md bg-surface-base border border-surface-border p-6">
			<p class="text-[10px] font-mono uppercase tracking-wider text-text-tertiary mb-3">Effective Reach</p>

			<!-- Hero number -->
			<div class="flex items-baseline gap-3 mb-4">
				<span class="font-mono tabular-nums text-3xl font-bold text-text-primary">{fmt(er.subscribed)}</span>
				<span class="text-sm text-text-secondary">/ {fmt(er.total)}</span>
				<span class="text-sm font-mono tabular-nums text-emerald-400">({erPct}%)</span>
			</div>

			<!-- Stacked bar -->
			<div class="h-3 rounded-full overflow-hidden flex bg-surface-raised">
				{#if er.subscribed > 0}
					<div class="bg-emerald-500 transition-all duration-700" style="width: {er.subscribed / er.total * 100}%"></div>
				{/if}
				{#if er.unsubscribed > 0}
					<div class="bg-amber-500 transition-all duration-700" style="width: {er.unsubscribed / er.total * 100}%"></div>
				{/if}
				{#if er.bounced > 0}
					<div class="bg-red-500 transition-all duration-700" style="width: {er.bounced / er.total * 100}%"></div>
				{/if}
				{#if er.complained > 0}
					<div class="bg-red-400 transition-all duration-700" style="width: {er.complained / er.total * 100}%"></div>
				{/if}
			</div>

			<!-- Legend -->
			<div class="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs">
				<span class="flex items-center gap-1.5">
					<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
					<span class="text-text-secondary">Subscribed</span>
					<span class="font-mono tabular-nums text-text-tertiary">{fmt(er.subscribed)}</span>
				</span>
				{#if er.unsubscribed > 0}
					<span class="flex items-center gap-1.5">
						<span class="w-2 h-2 rounded-full bg-amber-500"></span>
						<span class="text-text-secondary">Unsubscribed</span>
						<span class="font-mono tabular-nums text-text-tertiary">{fmt(er.unsubscribed)}</span>
					</span>
				{/if}
				{#if er.bounced > 0}
					<span class="flex items-center gap-1.5">
						<span class="w-2 h-2 rounded-full bg-red-500"></span>
						<span class="text-text-secondary">Bounced</span>
						<span class="font-mono tabular-nums text-text-tertiary">{fmt(er.bounced)}</span>
					</span>
				{/if}
				{#if er.complained > 0}
					<span class="flex items-center gap-1.5">
						<span class="w-2 h-2 rounded-full bg-red-400"></span>
						<span class="text-text-secondary">Complained</span>
						<span class="font-mono tabular-nums text-text-tertiary">{fmt(er.complained)}</span>
					</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- ===== Onboarding Checklist (first-run) ===== -->
	{#if !data.onboardingComplete}
		<OnboardingChecklist
			orgSlug={data.org.slug}
			onboarding={data.onboardingState}
			orgDescription={data.org.description}
			billingEmail={data.billingEmail ?? null}
			funnel={data.funnel}
		/>
	{/if}

	<!-- ===== Verification Packet (primary surface — position 1) ===== -->
	<VerificationPacket
		packet={data.packet}
		label={data.stats.activeCampaigns > 0
			? `Coordination Integrity \u00b7 ${data.stats.activeCampaigns} active campaign${data.stats.activeCampaigns === 1 ? '' : 's'}`
			: 'Coordination Integrity'}
	>
		{#snippet actions()}
			{#if data.packet && data.topCampaignId}
				<div class="flex gap-3 pt-2">
					<a href="/org/{data.org.slug}/campaigns/{data.topCampaignId}/report"
					   class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-500 transition-colors">
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
						</svg>
						Deliver Proof
					</a>
					<a href="/org/{data.org.slug}/campaigns/{data.topCampaignId}/report"
					   class="inline-flex items-center gap-2 rounded-lg bg-surface-overlay px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-raised transition-colors">
						Preview Proof Packet
					</a>
				</div>
			{/if}
		{/snippet}
	</VerificationPacket>

	<!-- ===== Legislative Activity ===== -->
	<LegislativeActivity
		alerts={data.legislativeAlerts}
		orgSlug={data.org.slug}
		pendingCount={data.legislativeAlerts.length}
	/>

	<!-- ===== Intelligence Loop: Decision Makers & Legislation ===== -->
	{#if data.followedReps.count > 0 || data.watchedBills.count > 0}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<!-- Decision Makers card -->
			<div class="rounded-md bg-surface-base border border-surface-border p-6">
				<div class="flex items-center justify-between mb-4">
					<p class="text-[10px] font-mono uppercase tracking-wider text-text-tertiary">Decision Makers</p>
					<a
						href="/org/{data.org.slug}/representatives"
						class="text-xs text-text-quaternary hover:text-teal-500 transition-colors"
					>
						View all &rarr;
					</a>
				</div>

				<div class="flex items-baseline gap-2 mb-4">
					<span class="font-mono tabular-nums text-2xl font-bold text-text-primary">{fmt(data.followedReps.count)}</span>
					<span class="text-xs text-text-tertiary">followed</span>
				</div>

				{#if data.followedReps.top.length > 0}
					<div class="space-y-2">
						{#each data.followedReps.top as dm (dm.id)}
							<div class="flex items-center gap-2 text-sm">
								{#if dm.party}
									<span class="inline-block w-5 h-5 rounded-full text-[10px] font-mono font-bold flex items-center justify-center text-white {dm.party === 'D' ? 'bg-blue-600' : dm.party === 'R' ? 'bg-red-600' : 'bg-purple-600'}">
										{dm.party}
									</span>
								{/if}
								<span class="text-text-primary truncate">{dm.name}</span>
								{#if dm.jurisdiction}
									<span class="text-text-quaternary text-xs flex-shrink-0">{dm.jurisdiction}</span>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-xs text-text-quaternary">No decision makers followed yet.</p>
				{/if}
			</div>

			<!-- Legislation card -->
			<div class="rounded-md bg-surface-base border border-surface-border p-6">
				<div class="flex items-center justify-between mb-4">
					<p class="text-[10px] font-mono uppercase tracking-wider text-text-tertiary">Legislation</p>
					<a
						href="/org/{data.org.slug}/legislation"
						class="text-xs text-text-quaternary hover:text-teal-500 transition-colors"
					>
						View all &rarr;
					</a>
				</div>

				<div class="flex items-baseline gap-2 mb-4">
					<span class="font-mono tabular-nums text-2xl font-bold text-text-primary">{fmt(data.watchedBills.count)}</span>
					<span class="text-xs text-text-tertiary">watched</span>
				</div>

				{#if data.watchedBills.top.length > 0}
					<div class="space-y-2">
						{#each data.watchedBills.top as bill (bill.id)}
							<div class="flex items-center gap-2 text-sm">
								<span class="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded border {
									bill.status === 'introduced' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' :
									bill.status === 'committee' ? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' :
									bill.status === 'floor' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
									bill.status === 'passed' || bill.status === 'signed' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
									bill.status === 'failed' || bill.status === 'vetoed' ? 'text-red-400 bg-red-500/10 border-red-500/20' :
									'text-text-tertiary bg-surface-raised border-surface-border'
								} flex-shrink-0">
									{bill.status}
								</span>
								<span class="text-text-primary truncate">{bill.title}</span>
								{#if bill.position}
									<span class="text-[10px] font-mono px-1 py-0.5 rounded {
										bill.position === 'support' ? 'text-emerald-400 bg-emerald-500/10' :
										bill.position === 'oppose' ? 'text-red-400 bg-red-500/10' :
										'text-text-quaternary bg-surface-raised'
									} flex-shrink-0">
										{bill.position}
									</span>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-xs text-text-quaternary">No bills watched yet.</p>
				{/if}
			</div>
		</div>
	{/if}

	<!-- ===== SECTIONS 2+3: Verification Pipeline & Engagement Tiers (collapsed) ===== -->
	<details class="rounded-md bg-surface-base border border-surface-border">
		<summary class="cursor-pointer px-6 py-4 text-sm font-medium text-text-secondary hover:text-text-primary">
			Verification pipeline &amp; engagement tiers
		</summary>
		<div class="px-6 pb-6 space-y-6">
			<!-- Verification Funnel -->
			<div>
				<p class="text-[10px] font-mono uppercase tracking-wider text-text-tertiary mb-4">Verification Funnel</p>

				{#if funnel.imported === 0}
					<div class="py-4 text-center">
						<p class="text-sm text-text-quaternary">No supporters yet. Import supporters to see verification progress.</p>
					</div>
				{:else}
					<div class="space-y-3">
						{#each funnelSteps as step, i}
							<div class="flex items-center gap-4">
								<div class="w-32 flex items-center gap-2">
									<span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono {step.count > 0 ? 'bg-teal-500/20 text-teal-400' : 'bg-surface-overlay text-text-quaternary'}">
										{i + 1}
									</span>
									<span class="text-xs text-text-tertiary truncate">{step.label}</span>
								</div>
								<div class="flex-1 h-6 rounded bg-surface-raised overflow-hidden relative">
									<div
										class="h-full rounded transition-all duration-700 ease-out {i === 0 ? 'bg-text-quaternary' : i === 1 ? 'bg-teal-500/40' : i === 2 ? 'bg-teal-500/60' : 'bg-emerald-500/70'}"
										style="width: {Math.max(step.pct, 1)}%"
									></div>
									{#if step.count > 0}
										<span class="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-mono tabular-nums text-text-tertiary">
											{step.pct}%
										</span>
									{/if}
								</div>
								<span class="w-16 text-right font-mono tabular-nums text-sm text-text-secondary">
									{fmt(step.count)}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Tier Distribution -->
			<div>
				<div class="flex items-center justify-between mb-4">
					<p class="text-[10px] font-mono uppercase tracking-wider text-text-tertiary">Engagement Tier Distribution</p>
					{#if tierTotal > 0}
						<span class="text-xs font-mono tabular-nums text-text-quaternary">{fmt(tierTotal)} actions</span>
					{/if}
				</div>

				{#if tierTotal === 0}
					<div class="py-4 text-center">
						<p class="text-sm text-text-quaternary">No campaign actions yet. Tier distribution will appear as supporters take action.</p>
					</div>
				{:else}
					<div class="space-y-2">
						{#each [...data.tiers].reverse() as tier}
							<div class="flex items-center gap-3">
								<span class="w-24 text-[10px] font-mono text-text-tertiary text-right">
									{tier.label}
									<span class="text-text-quaternary">T{tier.tier}</span>
								</span>
								<div class="flex-1 h-5 rounded bg-surface-raised overflow-hidden">
									<div
										class="h-full rounded {tierColor(tier.tier)} transition-all duration-700 ease-out"
										style="width: {tier.count > 0 ? Math.max((tier.count / tierMax) * 100, 2) : 0}%"
									></div>
								</div>
								<span class="w-14 text-xs font-mono tabular-nums text-text-tertiary text-right">
									{fmt(tier.count)}
								</span>
								<span class="w-10 text-[10px] font-mono tabular-nums text-text-quaternary text-right">
									{Math.round((tier.count / tierTotal) * 100)}%
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</details>

	<!-- ===== SECTION 4: Campaign List ===== -->
	<div class="rounded-md bg-surface-base border border-surface-border p-6">
		<div class="flex items-center justify-between mb-4">
			<p class="text-[10px] font-mono uppercase tracking-wider text-text-tertiary">Campaigns</p>
			<a
				href="/org/{data.org.slug}/campaigns"
				class="text-xs text-text-quaternary hover:text-teal-500 transition-colors"
			>
				View all
			</a>
		</div>

		{#if data.campaigns.length === 0}
			<div class="py-4 text-center">
				<p class="text-sm text-text-quaternary">No campaigns yet.</p>
				<a
					href="/org/{data.org.slug}/campaigns/new"
					class="inline-block mt-2 text-xs text-teal-500 hover:text-teal-400 transition-colors"
				>
					Assemble your first proof
				</a>
			</div>
		{:else}
			<div class="space-y-2">
				{#each data.campaigns as campaign (campaign.id)}
					<a href="/org/{data.org.slug}/campaigns/{campaign.id}"
					   class="flex items-center gap-4 rounded-lg border border-surface-border bg-surface-raised px-4 py-3 transition-colors hover:border-[var(--coord-route-solid)] group">
						<!-- Verified count (hero element per card) -->
						<div class="flex-shrink-0 text-right">
							<p class="font-mono tabular-nums text-2xl font-bold text-emerald-400">
								{fmt(campaign.verifiedActions)}
							</p>
							<p class="text-[10px] text-text-quaternary">verified</p>
						</div>

						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<p class="text-sm font-medium text-text-primary group-hover:text-teal-500 transition-colors truncate">
									{campaign.title}
								</p>
								<span class="text-[10px] font-mono px-1.5 py-0.5 rounded border {statusColor(campaign.status)} flex-shrink-0">
									{campaign.status}
								</span>
							</div>
							<p class="text-xs text-text-quaternary mt-0.5">
								<span class="font-mono tabular-nums">{fmt(campaign.totalActions)}</span> total actions
								<span class="text-surface-border-strong mx-1">&middot;</span>
								{relativeTime(campaign.updatedAt)}
							</p>
						</div>

						{#if campaign.totalActions > 0}
							{@const pct = Math.round((campaign.verifiedActions / campaign.totalActions) * 100)}
							<div class="flex-shrink-0 w-10 h-10 relative">
								<svg viewBox="0 0 36 36" class="w-10 h-10 -rotate-90">
									<circle cx="18" cy="18" r="15" fill="none" stroke-width="3" class="stroke-surface-border" />
									<circle cx="18" cy="18" r="15" fill="none" stroke-width="3"
										stroke-dasharray="{pct * 0.942} {(100 - pct) * 0.942}"
										class="stroke-teal-500/60" />
								</svg>
								<span class="absolute inset-0 flex items-center justify-center text-[9px] font-mono tabular-nums text-text-tertiary">
									{pct}%
								</span>
							</div>
						{/if}
					</a>
				{/each}
			</div>
		{/if}
	</div>

	<!-- ===== SECTION 5: Recent Activity ===== -->
	{#if data.recentActivity.length > 0}
		<div class="rounded-md bg-surface-base border border-surface-border p-6">
			<p class="text-[10px] font-mono uppercase tracking-wider text-text-tertiary mb-4">Recent Activity</p>
			<div class="space-y-1">
				{#each data.recentActivity.slice(0, 5) as item (item.id)}
					<div class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-raised transition-colors">
						<!-- I4: Type indicator with label -->
						{#if item.type === 'action'}
							<div class="flex items-center gap-1.5 flex-shrink-0 w-16">
								<div class="w-2 h-2 rounded-full {item.verified ? 'bg-emerald-500' : 'bg-text-quaternary'}"></div>
								<span class="text-[9px] font-mono text-text-quaternary">Action</span>
							</div>
						{:else}
							<div class="flex items-center gap-1.5 flex-shrink-0 w-16">
								<div class="w-2 h-2 rounded-full bg-teal-500/60"></div>
								<span class="text-[9px] font-mono text-text-quaternary">Signup</span>
							</div>
						{/if}

						<!-- Content -->
						<div class="min-w-0 flex-1">
							<p class="text-xs text-text-secondary truncate">
								<span class="font-medium">{item.label}</span>
								{#if item.type === 'action'}
									<span class="text-text-quaternary"> acted on </span>
									<span class="text-text-tertiary">{item.detail}</span>
								{:else}
									<span class="text-text-quaternary"> signed up via </span>
									<span class="text-text-tertiary">{item.detail}</span>
								{/if}
							</p>
						</div>

						<!-- Tier badge (actions only) -->
						{#if item.type === 'action' && item.tier > 0}
							<span class="text-[9px] font-mono px-1 py-0.5 rounded bg-surface-raised text-text-tertiary flex-shrink-0">
								T{item.tier}
							</span>
						{/if}

						<!-- Timestamp -->
						<span class="text-[10px] font-mono text-text-quaternary flex-shrink-0">
							{relativeTime(item.timestamp)}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Error flash -->
	{#if errorFlash}
		<div class="rounded-lg border border-red-900/40 bg-red-950/30 px-4 py-2 text-xs text-red-400">
			{errorFlash}
		</div>
	{/if}

	<!-- ===== Endorsed Templates (collapsed) ===== -->
	<details class="rounded-md bg-surface-base border border-surface-border">
		<summary class="cursor-pointer px-6 py-4 text-sm font-medium text-text-secondary hover:text-text-primary">
			Endorsed templates
			{#if endorsedList.length > 0}
				<span class="text-text-quaternary ml-1">&middot; {endorsedList.length}</span>
			{/if}
		</summary>
		<div class="px-6 pb-6">
			{#if endorsedList.length > 0}
				<div class="space-y-2 mb-4">
					{#each endorsedList as item (item.templateId)}
						<div class="group flex items-center gap-3 rounded-lg border border-surface-border bg-surface-raised px-4 py-3 transition-colors hover:border-[var(--coord-route-solid)]">
							<div class="w-0.5 h-8 rounded-full bg-teal-500/60 flex-shrink-0"></div>
							<div class="min-w-0 flex-1">
								<a href="/s/{item.slug}" class="text-sm font-medium text-text-primary hover:text-teal-500 transition-colors line-clamp-1">
									{item.title}
								</a>
								{#if FEATURES.ENGAGEMENT_METRICS}
									<p class="text-xs text-text-quaternary mt-0.5">
										<span class="font-mono tabular-nums">{fmt(item.sends)}</span> sends &middot; <span class="font-mono tabular-nums">{fmt(item.districts)}</span> districts
									</p>
								{/if}
							</div>
							<button
								class="text-xs text-text-quaternary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
								onclick={() => removeEndorsement(item.templateId)}
							>
								Remove
							</button>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-xs text-text-quaternary mb-4">No endorsed templates yet. Endorse public templates to signal coalition support.</p>
			{/if}

			<!-- Search to endorse -->
			<div class="relative">
				<input
					type="text"
					class="participation-input text-sm"
					placeholder="Search templates to endorse..."
					value={searchQuery}
					oninput={handleSearchInput}
				/>
				{#if searchResults.length > 0}
					<div class="absolute left-0 right-0 top-full mt-1 rounded-lg border border-surface-border bg-surface-base shadow-[var(--shadow-lg)] z-10 overflow-hidden">
						{#each searchResults as t (t.id)}
							<button
								class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-raised transition-colors border-b border-surface-border last:border-0"
								onclick={() => endorseTemplate(t.id)}
							>
								<div class="min-w-0 flex-1">
									<p class="text-sm text-text-primary line-clamp-1">{t.title}</p>
									{#if FEATURES.ENGAGEMENT_METRICS}
										<p class="text-xs text-text-quaternary mt-0.5">
											<span class="font-mono tabular-nums">{fmt(t.verified_sends)}</span> sends
											{#if t.similarity != null}
												<span class="text-surface-border-strong mx-1">&middot;</span>
												<span class="text-teal-600">{Math.round(t.similarity * 100)}% match</span>
											{/if}
										</p>
									{/if}
								</div>
								<span class="text-xs font-medium text-teal-500 flex-shrink-0">Endorse</span>
							</button>
						{/each}
					</div>
				{/if}
				{#if searching}
					<div class="absolute right-3 top-1/2 -translate-y-1/2">
						<div class="w-3 h-3 border border-text-quaternary border-t-teal-500 rounded-full animate-spin"></div>
					</div>
				{/if}
			</div>
		</div>
	</details>

</div>
