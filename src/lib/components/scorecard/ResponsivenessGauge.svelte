<script lang="ts">
	let {
		score,
		sent,
		opened,
		verified,
		replied
	}: {
		score: number | null;
		sent: number;
		opened: number;
		verified: number;
		replied: number;
	} = $props();

	let displayScore = $derived(score != null ? Math.round(score * 10) / 10 : null);

	let color = $derived(
		score == null
			? 'bg-slate-200'
			: score >= 67
				? 'bg-green-500'
				: score >= 34
					? 'bg-amber-500'
					: 'bg-red-500'
	);
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4">
	<div class="mb-2 flex items-center justify-between">
		<h3 class="text-sm font-semibold text-slate-700">Responsiveness</h3>
		{#if displayScore != null}
			<span class="text-lg font-bold text-slate-900">{displayScore}</span>
		{:else}
			<span class="text-sm text-slate-400">N/A</span>
		{/if}
	</div>

	<!-- Score bar -->
	<div
		class="mb-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
		role="progressbar"
		aria-valuenow={displayScore ?? 0}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-label="Responsiveness score: {displayScore ?? 'not available'}"
	>
		<div
			class="h-full rounded-full transition-all duration-500 {color}"
			style="width: {displayScore != null ? displayScore : 0}%"
		></div>
	</div>

	<!-- Breakdown -->
	<div class="grid grid-cols-2 gap-2 text-xs text-slate-500">
		<div class="flex justify-between">
			<span>Sent</span>
			<span class="font-medium text-slate-700">{sent}</span>
		</div>
		<div class="flex justify-between">
			<span>Opened</span>
			<span class="font-medium text-slate-700">{opened}</span>
		</div>
		<div class="flex justify-between">
			<span>Verified</span>
			<span class="font-medium text-slate-700">{verified}</span>
		</div>
		<div class="flex justify-between">
			<span>Replied</span>
			<span class="font-medium text-slate-700">{replied}</span>
		</div>
	</div>
</div>
