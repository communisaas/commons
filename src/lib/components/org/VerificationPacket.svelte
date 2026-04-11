<script lang="ts">
	import { spring } from 'svelte/motion';
	import type { Snippet } from 'svelte';
	import IntegrityAssessment from '$lib/components/org/IntegrityAssessment.svelte';

	interface TierCount {
		tier: number;
		label: string;
		count: number;
	}

	interface Packet {
		total: number;
		verified: number;
		verifiedPct: number;
		gds: number | null;
		ald: number | null;
		temporalEntropy: number | null;
		burstVelocity: number | null;
		cai: number | null;
		tiers: TierCount[];
		districtCount: number;
		lastUpdated: string;
	}

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

	// Spring-animated values: stiffness 0.15, damping 0.8 — weighted, inevitable
	const springOpts = { stiffness: 0.15, damping: 0.8 };
	const animVerified = spring(0, springOpts);
	const animTotal = spring(0, springOpts);
	const animPct = spring(0, springOpts);
	const animGds = spring(0, springOpts);
	const animAld = spring(0, springOpts);
	const animDistricts = spring(0, springOpts);

	$effect(() => {
		if (packet) {
			animVerified.set(packet.verified);
			animTotal.set(packet.total);
			animPct.set(packet.verifiedPct);
			animGds.set(packet.gds ?? 0);
			animAld.set(packet.ald ?? 0);
			animDistricts.set(packet.districtCount);
		}
	});

	function fmt(n: number): string {
		return Math.round(n).toLocaleString('en-US');
	}

	function fmtScore(n: number, hasValue: boolean): string {
		if (!hasValue) return '\u2014';
		return n.toFixed(2);
	}

	// Tier bar: max width relative to largest tier (-1 = suppressed for k-anonymity)
	function tierBarWidth(tiers: TierCount[], tier: TierCount): string {
		if (tier.count <= 0) return '2%';
		const max = Math.max(...tiers.map((t) => t.count), 1);
		return `${Math.max((tier.count / max) * 100, 2)}%`;
	}

	// Tier color by level
	function tierColor(tier: number): string {
		switch (tier) {
			case 4: return 'bg-emerald-500';
			case 3: return 'bg-emerald-500/70';
			case 2: return 'bg-teal-500/60';
			case 1: return 'bg-teal-500/40';
			default: return 'bg-text-quaternary';
		}
	}

	// Coordination integrity score quality indicator
	function scoreQuality(val: number | null): string {
		if (val === null) return 'text-text-quaternary';
		if (val >= 0.8) return 'text-emerald-400';
		if (val >= 0.5) return 'text-teal-400';
		return 'text-text-tertiary';
	}

	const isEmpty = $derived(!packet || packet.total === 0);

	// Non-null packet accessor for use inside {:else} block where isEmpty is false
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
			<p class="text-sm text-text-quaternary mt-3">No verified actions yet. When supporters act, their proof accumulates here — the packet you'll ship to decision-makers.</p>
		</div>
	{:else}
		<!-- Hero count: verified (dominant) -->
		<div>
			<p class="font-mono tabular-nums text-4xl md:text-5xl font-bold text-emerald-400">
				{fmt($animVerified)}
			</p>
			<p class="text-lg text-text-secondary mt-1">
				<span class="font-mono tabular-nums">{fmt($animTotal)}</span> total
				<span class="text-text-quaternary mx-1">&middot;</span>
				<span class="font-mono tabular-nums">{fmt($animPct)}</span><span class="text-text-tertiary">%</span> verified
			</p>
		</div>

		<!-- District breadth -->
		<p class="text-lg text-text-secondary font-mono">
			across {fmt($animDistricts)} districts
		</p>

		<!-- Integrity assessment -->
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

		<!-- Coordination details (collapsed by default) -->
		<details open={detailsOpen}>
			<summary class="cursor-pointer text-sm font-medium text-text-secondary hover:text-text-primary py-2">
				Coordination details
			</summary>

			<!-- Coordination integrity scores -->
			<div class="mt-4">
				<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary mb-3">Coordination Integrity</p>
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
						<p class="text-[10px] text-text-quaternary mt-0.5">Engagement</p>
					</div>
				</div>
			</div>

			<!-- Tier distribution -->
			<div class="mt-6">
				<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary mb-3">Tier Distribution</p>
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
		</details>
	{/if}
</div>
