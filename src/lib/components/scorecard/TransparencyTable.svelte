<script lang="ts">
	import type { Fact } from '$lib/core/fact';

	type TransparencyCounts = {
		deliveriesSent: number;
		deliveriesOpened: number;
		deliveriesVerified: number;
		repliesReceived: number;
		alignedVotes: number;
		totalScoredVotes: number;
	};

	let { current }: { current: Fact<TransparencyCounts> } = $props();
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4">
	<h3 class="mb-3 text-sm font-semibold text-slate-700">Transparency: Raw Input Counts</h3>

	{#if current.state === 'present'}
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-slate-200 text-left text-xs text-slate-500">
						<th class="pb-2 font-medium">Metric</th>
						<th class="pb-2 text-right font-medium">Count</th>
					</tr>
				</thead>
				<tbody class="text-slate-700">
					<tr class="border-b border-slate-100">
						<td class="py-1.5">Accountability receipts</td>
						<td class="py-1.5 text-right font-medium">{current.value.deliveriesSent}</td>
					</tr>
					<tr class="border-b border-slate-100">
						<td class="py-1.5">Opened</td>
						<td class="py-1.5 text-right font-medium">{current.value.deliveriesOpened}</td>
					</tr>
					<tr class="border-b border-slate-100">
						<td class="py-1.5">Verification links followed</td>
						<td class="py-1.5 text-right font-medium">
							{current.value.deliveriesVerified}
						</td>
					</tr>
					<tr class="border-b border-slate-100">
						<td class="py-1.5">Replies logged</td>
						<td class="py-1.5 text-right font-medium">{current.value.repliesReceived}</td>
					</tr>
					<tr class="border-b border-slate-100">
						<td class="py-1.5">Aligned votes</td>
						<td class="py-1.5 text-right font-medium">{current.value.alignedVotes}</td>
					</tr>
					<tr>
						<td class="py-1.5">Total scored votes</td>
						<td class="py-1.5 text-right font-medium">{current.value.totalScoredVotes}</td>
					</tr>
				</tbody>
			</table>
		</div>
	{:else if current.state === 'absent'}
		<p class="py-4 text-center text-sm text-slate-400">No activity counts are recorded.</p>
	{:else if current.state === 'withheld'}
		<p class="py-4 text-center text-sm text-slate-400">Public activity counts are withheld.</p>
	{:else}
		<p class="py-4 text-center text-sm text-slate-400">
			Activity counts are temporarily unavailable.
		</p>
	{/if}
</div>
