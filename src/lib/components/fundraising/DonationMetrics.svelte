<script lang="ts">
	import { Datum } from '$lib/design';
	import { SPRINGS } from '$lib/design/motion';

	let {
		campaign
	}: {
		campaign: {
			raisedAmountCents: number;
			goalAmountCents: number | null;
			donorCount: number;
			donationCurrency: string;
		};
	} = $props();

	function formatCents(cents: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: campaign.donationCurrency
		}).format(cents / 100);
	}

	const goalPercent = $derived(
		campaign.goalAmountCents
			? Math.min(100, (campaign.raisedAmountCents / campaign.goalAmountCents) * 100)
			: null
	);

	const averageCents = $derived(
		campaign.donorCount > 0 ? Math.round(campaign.raisedAmountCents / campaign.donorCount) : 0
	);
</script>

<div class="grid gap-3 md:grid-cols-3">
	<div class="border-surface-border bg-surface-base rounded-md border p-4">
		<p class="text-text-tertiary text-xs font-medium">Raised</p>
		<p class="text-text-primary mt-1 text-2xl font-bold">
			{formatCents(campaign.raisedAmountCents)}
			{#if campaign.goalAmountCents}
				<span class="text-text-tertiary text-sm font-normal">
					/ {formatCents(campaign.goalAmountCents)}</span
				>
			{/if}
		</p>
		{#if goalPercent !== null}
			<div class="bg-surface-overlay mt-2 h-1.5 w-full overflow-hidden rounded-full">
				<div
					class="bg-text-tertiary h-full rounded-full transition-all"
					style="width: {goalPercent}%"
				></div>
			</div>
		{/if}
	</div>

	<div class="border-surface-border bg-surface-base rounded-md border p-4">
		<p class="text-text-tertiary text-xs font-medium">Donations</p>
		<p class="text-text-primary mt-1 text-2xl font-bold">
			<Datum
				value={campaign.donorCount}
				animate
				spring={SPRINGS.METRIC}
				cite="campaigns.donorCount"
			/>
		</p>
		<p class="text-text-quaternary mt-1 text-xs">Completed webhook rows</p>
	</div>

	<div class="border-surface-border bg-surface-base rounded-md border p-4">
		<p class="text-text-tertiary text-xs font-medium">Average</p>
		<p class="mt-1 text-2xl font-bold text-teal-300">{formatCents(averageCents)}</p>
		<p class="text-text-quaternary mt-1 text-xs">Raised / completed donations</p>
	</div>
</div>
