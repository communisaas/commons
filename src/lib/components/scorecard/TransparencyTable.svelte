<script lang="ts">
	let {
		transparency
	}: {
		transparency: {
			deliveriesSent: number;
			deliveriesOpened: number;
			deliveriesVerified: number;
			repliesReceived: number;
			alignedVotes: number;
			totalScoredVotes: number;
		} | null;
	} = $props();
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4">
	<h3 class="mb-3 text-sm font-semibold text-slate-700">Transparency: Raw Input Counts</h3>

	{#if transparency}
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
						<td class="py-1.5">Deliveries sent</td>
						<td class="py-1.5 text-right font-medium">{transparency.deliveriesSent}</td>
					</tr>
					<tr class="border-b border-slate-100">
						<td class="py-1.5">Deliveries opened</td>
						<td class="py-1.5 text-right font-medium">{transparency.deliveriesOpened}</td>
					</tr>
					<tr class="border-b border-slate-100">
						<td class="py-1.5">Deliveries verified</td>
						<td class="py-1.5 text-right font-medium">{transparency.deliveriesVerified}</td>
					</tr>
					<tr class="border-b border-slate-100">
						<td class="py-1.5">Replies received</td>
						<td class="py-1.5 text-right font-medium">{transparency.repliesReceived}</td>
					</tr>
					<tr class="border-b border-slate-100">
						<td class="py-1.5">Aligned votes</td>
						<td class="py-1.5 text-right font-medium">{transparency.alignedVotes}</td>
					</tr>
					<tr>
						<td class="py-1.5">Total scored votes</td>
						<td class="py-1.5 text-right font-medium">{transparency.totalScoredVotes}</td>
					</tr>
				</tbody>
			</table>
		</div>
	{:else}
		<p class="py-4 text-center text-sm text-slate-400">No scorecard data available yet</p>
	{/if}
</div>
