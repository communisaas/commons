<script lang="ts">
	import { spring } from 'svelte/motion';

	let {
		total,
		postalResolved,
		identityVerified,
		districtVerified,
		growth,
		class: className = ''
	}: {
		total: number;
		postalResolved: number;
		identityVerified: number;
		districtVerified: number;
		growth?: { thisWeek: number; lastWeek: number };
		class?: string;
	} = $props();

	const springOpts = { stiffness: 0.15, damping: 0.8 };
	const animTotal = spring(0, springOpts);
	const animPostal = spring(0, springOpts);
	const animVerified = spring(0, springOpts);

	$effect(() => {
		animTotal.set(total);
		animPostal.set(postalResolved);
		animVerified.set(identityVerified);
	});

	function fmt(n: number): string {
		return Math.round(n).toLocaleString('en-US');
	}
</script>

<div class="rounded-xl bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-6 {className}">
	<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary mb-4">Verification Pipeline</p>

	{#if total === 0}
		<p class="text-sm text-text-quaternary text-center py-4">
			No supporters yet. Import supporters to see your verification pipeline.
		</p>
	{:else}
		<!-- Stage 1: Imported -->
		<div class="flex items-center gap-3">
			<span class="text-lg text-text-tertiary w-6 text-center">○</span>
			<p class="font-mono tabular-nums text-2xl font-bold text-text-tertiary">{fmt($animTotal)}</p>
			<div>
				<p class="text-sm text-text-secondary">imported</p>
			</div>
		</div>

		<!-- Connector -->
		<div class="ml-[11px] h-4 border-l-2 border-dashed border-text-quaternary"></div>

		<!-- Stage 2: District-resolved -->
		<div class="flex items-center gap-3">
			<span class="text-lg text-teal-400 w-6 text-center">◐</span>
			<p class="font-mono tabular-nums text-2xl font-bold text-teal-400">{fmt($animPostal)}</p>
			<div>
				<p class="text-sm text-text-secondary">district-resolved</p>
				<p class="text-xs text-text-quaternary">postal code → district</p>
			</div>
		</div>

		<!-- Connector -->
		<div class="ml-[11px] h-4 border-l-2 border-dashed border-text-quaternary"></div>

		<!-- Stage 3: Identity-verified -->
		<div class="flex items-center gap-3">
			<span class="text-lg text-emerald-400 w-6 text-center">●</span>
			<p class="font-mono tabular-nums text-2xl font-bold text-emerald-400">{fmt($animVerified)}</p>
			<div>
				<p class="text-sm text-text-secondary">identity-verified</p>
				<p class="text-xs text-text-quaternary">ZK proof of residency</p>
			</div>
		</div>

		<!-- Growth rate -->
		{#if growth && growth.lastWeek > 0}
			{@const rate = Math.round(((growth.thisWeek - growth.lastWeek) / growth.lastWeek) * 100)}
			<p class="text-sm text-text-tertiary mt-4 pt-4 border-t border-surface-border">
				<span class="font-mono tabular-nums text-emerald-400">{growth.thisWeek}</span> verifications this week
				<span class="font-mono tabular-nums {rate >= 0 ? 'text-emerald-400' : 'text-amber-400'} ml-1">
					({rate >= 0 ? '+' : ''}{rate}% from last week)
				</span>
			</p>
		{:else if growth}
			<p class="text-sm text-text-tertiary mt-4 pt-4 border-t border-surface-border">
				<span class="font-mono tabular-nums text-emerald-400">{growth.thisWeek}</span> verifications this week
			</p>
		{/if}
	{/if}
</div>
