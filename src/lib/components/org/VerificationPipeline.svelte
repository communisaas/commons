<script lang="ts">
	import { spring } from 'svelte/motion';
	import { SPRINGS } from '$lib/design/motion';

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

	const animTotal = spring(0, SPRINGS.METRIC);
	const animPostal = spring(0, SPRINGS.METRIC);
	const animDistrict = spring(0, SPRINGS.METRIC);
	const animVerified = spring(0, SPRINGS.METRIC);

	$effect(() => {
		animTotal.set(total);
		animPostal.set(postalResolved);
		animDistrict.set(districtVerified);
		animVerified.set(identityVerified);
	});

	function fmt(n: number): string {
		return Math.round(n).toLocaleString('en-US');
	}
</script>

<div class="bg-surface-base border-surface-border rounded-md border p-6 {className}">
	<p class="text-text-quaternary mb-4 font-mono text-[10px] tracking-wider uppercase">
		Verification Pipeline
	</p>

	{#if total === 0}
		<p class="text-text-quaternary py-4 text-center text-sm">
			No supporters yet. Import supporters to see your verification pipeline.
		</p>
	{:else}
		<!-- Stage 1: Supporters on the list -->
		<div class="flex items-center gap-3">
			<span class="text-text-tertiary w-6 text-center text-lg">○</span>
			<p class="text-text-tertiary font-mono text-2xl font-bold tabular-nums">{fmt($animTotal)}</p>
			<div>
				<p class="text-text-secondary text-sm">supporters on your list</p>
			</div>
		</div>

		<!-- Connector -->
		<div class="border-text-quaternary ml-[11px] h-4 border-l-2 border-dashed"></div>

		<!-- Stage 2: Address-resolved -->
		<div class="flex items-center gap-3">
			<span class="w-6 text-center text-lg text-teal-400">◐</span>
			<p class="font-mono text-2xl font-bold text-teal-400 tabular-nums">{fmt($animPostal)}</p>
			<div>
				<p class="text-text-secondary text-sm">address-resolved</p>
				<p class="text-text-quaternary text-xs">postal code present</p>
			</div>
		</div>

		<!-- Connector -->
		<div class="border-text-quaternary ml-[11px] h-4 border-l-2 border-dashed"></div>

		<!-- Stage 3: District-verified -->
		<div class="flex items-center gap-3">
			<span class="w-6 text-center text-lg text-teal-500">◑</span>
			<p class="font-mono text-2xl font-bold text-teal-500 tabular-nums">{fmt($animDistrict)}</p>
			<div>
				<p class="text-text-secondary text-sm">district-verified</p>
				<p class="text-text-quaternary text-xs">their actions carry proof of their district</p>
			</div>
		</div>

		<!-- Connector -->
		<div class="border-text-quaternary ml-[11px] h-4 border-l-2 border-dashed"></div>

		<!-- Stage 4: Identity-verified -->
		<div class="flex items-center gap-3">
			<span class="w-6 text-center text-lg text-emerald-400">●</span>
			<p class="font-mono text-2xl font-bold text-emerald-400 tabular-nums">{fmt($animVerified)}</p>
			<div>
				<p class="text-text-secondary text-sm">identity-verified</p>
				<p class="text-text-quaternary text-xs">can appear in verified constituent reports</p>
			</div>
		</div>

		<!-- Growth rate -->
		{#if growth && growth.lastWeek > 0}
			{@const rate = Math.round(((growth.thisWeek - growth.lastWeek) / growth.lastWeek) * 100)}
			<p class="text-text-tertiary border-surface-border mt-4 border-t pt-4 text-sm">
				<span class="font-mono text-emerald-400 tabular-nums">{growth.thisWeek}</span> verifications
				this week
				<span
					class="font-mono tabular-nums {rate >= 0 ? 'text-emerald-400' : 'text-amber-400'} ml-1"
				>
					({rate >= 0 ? '+' : ''}{rate}% from last week)
				</span>
			</p>
		{:else if growth}
			<p class="text-text-tertiary border-surface-border mt-4 border-t pt-4 text-sm">
				<span class="font-mono text-emerald-400 tabular-nums">{growth.thisWeek}</span> verifications this
				week
			</p>
		{/if}
	{/if}
</div>
