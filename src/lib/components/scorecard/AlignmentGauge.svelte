<script lang="ts">
	import type { Fact } from '$lib/core/fact';

	type AlignmentCounts = {
		alignedVotes: number;
		totalScoredVotes: number;
	};

	let { current }: { current: Fact<AlignmentCounts> } = $props();
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4">
	<h3 class="mb-3 text-sm font-semibold text-slate-700">Alignment activity</h3>

	{#if current.state === 'present'}
		<div class="text-xs text-slate-500">
			<div class="flex justify-between">
				<span>Aligned votes</span>
				<span class="font-medium text-slate-700">
					{current.value.alignedVotes} / {current.value.totalScoredVotes}
				</span>
			</div>
			{#if current.value.totalScoredVotes < 2}
				<p class="mt-1 text-slate-400">Minimum 2 scored votes required</p>
			{/if}
		</div>
	{:else if current.state === 'absent'}
		<p class="text-sm text-slate-400">No scored votes are recorded.</p>
	{:else if current.state === 'withheld'}
		<p class="text-sm text-slate-400">Public vote counts are withheld.</p>
	{:else}
		<p class="text-sm text-slate-400">Vote counts are temporarily unavailable.</p>
	{/if}
</div>
