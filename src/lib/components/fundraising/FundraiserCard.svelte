<script lang="ts">
	import { Datum } from '$lib/design';
	import { SPRINGS } from '$lib/design/motion';

	let {
		campaign
	}: {
		campaign: {
			id: string;
			title: string;
			status: string;
			goalAmountCents: number | null;
			raisedAmountCents: number;
			donorCount: number;
			donationCurrency: string;
			createdAt: string;
		};
	} = $props();

	const statusColors: Record<string, string> = {
		DRAFT: 'border-surface-border-strong bg-surface-overlay text-text-secondary',
		ACTIVE: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
		COMPLETE: 'border-blue-500/30 bg-blue-500/10 text-blue-300'
	};

	function formatCents(cents: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: campaign.donationCurrency
		}).format(cents / 100);
	}

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(iso));
	}

	const goalPercent = $derived(
		campaign.goalAmountCents
			? Math.min(100, (campaign.raisedAmountCents / campaign.goalAmountCents) * 100)
			: null
	);
</script>

<div
	class="border-surface-border bg-surface-base hover:border-surface-border-strong hover:bg-surface-overlay rounded-md border p-4 transition-colors"
>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<div class="mb-1 flex items-center gap-2">
				<h3 class="text-text-primary truncate text-base font-semibold">{campaign.title}</h3>
				<span
					class="shrink-0 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold {statusColors[
						campaign.status
					] ?? 'border-surface-border-strong bg-surface-overlay text-text-secondary'}"
				>
					{campaign.status}
				</span>
			</div>

			<p class="text-text-tertiary text-sm">{formatDate(campaign.createdAt)}</p>

			<p class="text-text-quaternary mt-0.5 text-sm">
				<Datum
					value={campaign.donorCount}
					animate
					spring={SPRINGS.METRIC}
					cite="campaigns.donorCount"
				/>
				{campaign.donorCount === 1 ? 'donation' : 'donations'}
			</p>
		</div>

		<div class="shrink-0 text-right">
			<p class="text-text-primary text-lg font-bold">{formatCents(campaign.raisedAmountCents)}</p>
			<p class="text-text-tertiary text-xs">
				raised
				{#if campaign.goalAmountCents}
					/ {formatCents(campaign.goalAmountCents)}
				{/if}
			</p>
		</div>
	</div>

	{#if goalPercent !== null}
		<div class="bg-surface-overlay mt-3 h-1 w-full overflow-hidden rounded-full">
			<div
				class="h-full rounded-full transition-all duration-300 {goalPercent >= 90
					? 'bg-teal-500'
					: 'bg-text-tertiary'}"
				style="width: {goalPercent}%"
			></div>
		</div>
	{/if}
</div>
