<script lang="ts">
	let { campaign }: {
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
		DRAFT: 'bg-zinc-700 text-zinc-300',
		ACTIVE: 'bg-green-900/50 text-green-400',
		PAUSED: 'bg-yellow-900/50 text-yellow-400',
		COMPLETED: 'bg-blue-900/50 text-blue-400'
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

<div class="rounded-lg border border-zinc-800/60 p-4 transition-colors hover:border-zinc-700">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<div class="mb-1 flex items-center gap-2">
				<h3 class="truncate text-base font-semibold text-zinc-100">{campaign.title}</h3>
				<span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium {statusColors[campaign.status] ?? 'bg-zinc-700 text-zinc-300'}">
					{campaign.status}
				</span>
			</div>

			<p class="text-sm text-zinc-400">{formatDate(campaign.createdAt)}</p>

			<p class="mt-0.5 text-sm text-zinc-500">
				{campaign.donorCount} {campaign.donorCount === 1 ? 'donation' : 'donations'}
			</p>
		</div>

		<div class="shrink-0 text-right">
			<p class="text-lg font-bold text-zinc-200">{formatCents(campaign.raisedAmountCents)}</p>
			<p class="text-xs text-zinc-500">
				raised
				{#if campaign.goalAmountCents}
					/ {formatCents(campaign.goalAmountCents)}
				{/if}
			</p>
		</div>
	</div>

	{#if goalPercent !== null}
		<div class="mt-3 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
			<div
				class="h-full rounded-full transition-all duration-300 {goalPercent >= 90 ? 'bg-green-500' : 'bg-zinc-500'}"
				style="width: {goalPercent}%"
			></div>
		</div>
	{/if}
</div>
