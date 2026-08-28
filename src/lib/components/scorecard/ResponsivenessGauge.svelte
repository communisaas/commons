<script lang="ts">
	import type { Fact } from '$lib/core/fact';

	type ResponsivenessCounts = {
		deliveriesSent: number;
		deliveriesOpened: number;
		deliveriesVerified: number;
		repliesReceived: number;
	};

	let { current }: { current: Fact<ResponsivenessCounts> } = $props();
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4">
	<h3 class="mb-3 text-sm font-semibold text-slate-700">Responsiveness activity</h3>

	{#if current.state === 'present'}
		<div class="grid grid-cols-2 gap-2 text-xs text-slate-500">
			<div class="flex justify-between gap-2">
				<span>Accountability receipts</span>
				<span class="font-medium text-slate-700">{current.value.deliveriesSent}</span>
			</div>
			<div class="flex justify-between gap-2">
				<span>Opened</span>
				<span class="font-medium text-slate-700">{current.value.deliveriesOpened}</span>
			</div>
			<div class="flex justify-between gap-2">
				<span>Verification links followed</span>
				<span class="font-medium text-slate-700">{current.value.deliveriesVerified}</span>
			</div>
			<div class="flex justify-between gap-2">
				<span>Replies logged</span>
				<span class="font-medium text-slate-700">{current.value.repliesReceived}</span>
			</div>
		</div>
	{:else if current.state === 'absent'}
		<p class="text-sm text-slate-400">No receipt activity is recorded.</p>
	{:else if current.state === 'withheld'}
		<p class="text-sm text-slate-400">Public activity counts are withheld.</p>
	{:else}
		<p class="text-sm text-slate-400">Activity counts are temporarily unavailable.</p>
	{/if}
</div>
