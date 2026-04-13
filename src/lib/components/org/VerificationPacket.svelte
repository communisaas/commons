<script lang="ts">
	import { spring } from 'svelte/motion';
	import type { Snippet } from 'svelte';
	import type { VerificationPacket as Packet, IntegrityMetrics, TierCount } from '$lib/types/verification-packet';
	import IntegrityAssessment from '$lib/components/org/IntegrityAssessment.svelte';

	let {
		packet,
		showDebate = false,
		label = 'Verification Packet',
		detailsOpen = false,
		actions
	}: {
		packet: Packet | null;
		showDebate?: boolean;
		label?: string;
		detailsOpen?: boolean;
		actions?: Snippet;
	} = $props();

	// Spring-animated values
	const springOpts = { stiffness: 0.15, damping: 0.8 };
	const animVerified = spring(0, springOpts);
	const animTotal = spring(0, springOpts);
	const animPct = spring(0, springOpts);
	const animDistricts = spring(0, springOpts);
	const animGds = spring(0, springOpts);
	const animAld = spring(0, springOpts);

	$effect(() => {
		if (packet) {
			animVerified.set(packet.verified);
			animTotal.set(packet.total);
			animPct.set(packet.verifiedPct);
			animDistricts.set(packet.districtCount);
			animGds.set(packet.gds ?? 0);
			animAld.set(packet.ald ?? 0);
		}
	});

	function fmt(n: number): string {
		return Math.round(n).toLocaleString('en-US');
	}

	function fmtScore(n: number, hasValue: boolean): string {
		if (!hasValue) return '\u2014';
		return n.toFixed(2);
	}

	function tierBarWidth(tiers: TierCount[], tier: TierCount): string {
		if (tier.count <= 0) return '2%';
		const max = Math.max(...tiers.map((t) => t.count), 1);
		return `${Math.max((tier.count / max) * 100, 2)}%`;
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

	function scoreQuality(val: number | null): string {
		if (val === null) return 'text-text-quaternary';
		if (val >= 0.8) return 'text-emerald-400';
		if (val >= 0.5) return 'text-teal-400';
		return 'text-text-tertiary';
	}

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

<div class="rounded-md border p-6 space-y-6" style="background: var(--coord-node-bg); border-color: var(--coord-node-border); box-shadow: var(--coord-node-shadow);">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<p class="text-xs font-mono uppercase tracking-wider text-text-tertiary">{label}</p>
		{#if packet && !isEmpty}
			<span class="text-[10px] font-mono text-text-quaternary">
				{new Date(packet.lastUpdated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
			</span>
		{/if}
	</div>

	{#if isEmpty}
		<!-- Empty state -->
		<div class="py-6 text-center">
			<p class="font-mono tabular-nums text-3xl font-bold text-text-quaternary">0</p>
			<p class="text-sm text-text-quaternary mt-3">No verified actions yet. When supporters act, their proof accumulates here.</p>
		</div>
	{:else}
		<!-- ═══ STAFFER-LEGIBLE HEADLINE ═══ -->

		<!-- Hero: verified count -->
		<div>
			<p class="font-mono tabular-nums text-4xl md:text-5xl font-bold text-emerald-400">
				{fmt($animVerified)}
			</p>
			<p class="text-lg text-text-secondary mt-1">
				verified constituents across <span class="font-mono tabular-nums">{fmt($animDistricts)}</span> communities
			</p>
		</div>

		<!-- Identity breakdown (Cycle 2: from trustTier per action) -->
		{#if p.identityBreakdown}
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
				{#if p.identityBreakdown.govId > 0}
					<span><span class="font-mono tabular-nums font-semibold text-text-primary">{p.identityBreakdown.govId}</span> government ID</span>
				{/if}
				{#if p.identityBreakdown.addressVerified > 0}
					<span><span class="font-mono tabular-nums font-semibold text-text-primary">{p.identityBreakdown.addressVerified}</span> address verified</span>
				{/if}
				{#if p.identityBreakdown.emailOnly > 0}
					<span><span class="font-mono tabular-nums font-semibold text-text-primary">{p.identityBreakdown.emailOnly}</span> email authenticated</span>
				{/if}
			</div>
		{/if}

		<!-- Authorship: individually composed vs shared -->
		{#if p.authorship.individual > 0 || p.authorship.shared > 0}
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
				{#if p.authorship.individual > 0}
					<span><span class="font-mono tabular-nums font-semibold text-text-primary">{p.authorship.individual}</span> {p.authorship.explicit ? 'individually composed' : 'distinct messages'}</span>
				{/if}
				{#if p.authorship.shared > 0}
					<span><span class="font-mono tabular-nums font-semibold text-text-primary">{p.authorship.shared}</span> shared {p.authorship.shared === 1 ? 'statement' : 'statements'}</span>
				{/if}
			</div>
		{/if}

		<!-- Date range + dedup -->
		<div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-tertiary">
			{#if p.dateRange.spanDays > 0}
				<span>Submissions spanning {fmtDateRange(p.dateRange.earliest, p.dateRange.latest, p.dateRange.spanDays)}</span>
			{/if}
			<span>One submission per person</span>
		</div>

		<!-- Integrity assessment — translated to natural language -->
		<IntegrityAssessment packet={p} />

		<!-- Progress bar -->
		<div class="h-2 rounded-full bg-surface-raised overflow-hidden">
			<div
				class="h-2 rounded-full bg-emerald-500/60 transition-all duration-700 ease-out"
				style="width: {Math.min($animPct, 100)}%"
			></div>
		</div>

		<!-- CTA slot -->
		{#if actions}
			{@render actions()}
		{/if}

		<!-- ═══ COORDINATION AUDIT (collapsed) ═══ -->
		<details open={detailsOpen}>
			<summary class="cursor-pointer text-sm font-medium text-text-secondary hover:text-text-primary py-2">
				Coordination audit
			</summary>

			<!-- Integrity scores -->
			<div class="mt-4">
				<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary mb-3">Integrity Scores</p>
				<div class="grid grid-cols-5 gap-3">
					<div class="text-center" title="Geographic Diversity Score: How spread across districts are the actions? Higher = more diverse.">
						<p class="font-mono tabular-nums text-lg font-semibold {scoreQuality(p.gds)}">
							{fmtScore($animGds, p.gds !== null)}
						</p>
						<p class="text-[10px] text-text-quaternary mt-0.5">Geographic</p>
					</div>
					<div class="text-center" title="Author Linkage Diversity: How unique are the messages? Higher = more original content.">
						<p class="font-mono tabular-nums text-lg font-semibold {scoreQuality(p.ald)}">
							{fmtScore($animAld, p.ald !== null)}
						</p>
						<p class="text-[10px] text-text-quaternary mt-0.5">Authenticity</p>
					</div>
					<div class="text-center" title="Temporal Entropy: How spread over time are the actions? Higher = more organic timing.">
						<p class="font-mono tabular-nums text-lg font-semibold {scoreQuality(p.temporalEntropy)}">
							{p.temporalEntropy !== null ? p.temporalEntropy.toFixed(1) : '\u2014'}
						</p>
						<p class="text-[10px] text-text-quaternary mt-0.5">Timing</p>
					</div>
					<div class="text-center" title="Burst Velocity: Peak vs average action rate. Low = organic, high = coordinated surge.">
						<p class="font-mono tabular-nums text-lg font-semibold {p.burstVelocity !== null && p.burstVelocity > 5 ? 'text-amber-400' : 'text-text-tertiary'}">
							{p.burstVelocity !== null ? p.burstVelocity.toFixed(1) : '\u2014'}
						</p>
						<p class="text-[10px] text-text-quaternary mt-0.5">Rate</p>
					</div>
					<div class="text-center" title="Coordination Authenticity Index: Ratio of long-term engaged participants. Higher = deeper engagement.">
						<p class="font-mono tabular-nums text-lg font-semibold {scoreQuality(p.cai)}">
							{p.cai !== null ? p.cai.toFixed(2) : '\u2014'}
						</p>
						<p class="text-[10px] text-text-quaternary mt-0.5">Depth</p>
					</div>
				</div>
			</div>

			<!-- Tier distribution -->
			{#if p.tiers.length > 0}
				<div class="mt-6">
					<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary mb-3">Engagement Distribution</p>
					<div class="space-y-1.5">
						{#each [...p.tiers].reverse() as tier}
							<div class="flex items-center gap-3">
								<span class="w-20 text-[10px] font-mono text-text-tertiary text-right">
									{tier.label}
									<span class="text-text-quaternary">T{tier.tier}</span>
								</span>
								<div class="flex-1 h-4 rounded bg-surface-raised overflow-hidden">
									<div
										class="h-full rounded {tierColor(tier.tier)} transition-all duration-700 ease-out"
										style="width: {tierBarWidth(p.tiers, tier)}"
									></div>
								</div>
								<span class="w-10 text-xs font-mono tabular-nums text-text-tertiary text-right" title={tier.count === -1 ? 'Suppressed for privacy (fewer than 5)' : ''}>
									{tier.count === -1 ? '<5' : tier.count}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</details>
	{/if}
</div>
