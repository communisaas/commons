<script lang="ts">
	import FundraiserCard from '$lib/components/fundraising/FundraiserCard.svelte';
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const fundraiserCount = $derived(data.campaigns.length);
	const activeCount = $derived(
		data.campaigns.filter((campaign) => campaign.status === 'ACTIVE').length
	);
	const raisedAmountCents = $derived(
		data.campaigns.reduce((sum, campaign) => sum + campaign.raisedAmountCents, 0)
	);
	const donationCount = $derived(
		data.campaigns.reduce((sum, campaign) => sum + campaign.donorCount, 0)
	);
	const receiptPolicyCount = $derived(
		data.campaigns.filter((campaign) => campaign.receiptPolicyConfigured).length
	);
	const confirmationCompletedCount = $derived(data.confirmationSummary.completed);
	const confirmationSentCount = $derived(data.confirmationSummary.sent);
	const confirmationFailedCount = $derived(data.confirmationSummary.failed);
	const confirmationSkippedCount = $derived(data.confirmationSummary.skipped);
	const confirmationNotRecordedCount = $derived(data.confirmationSummary.notRecorded);
	const confirmationProviderAcceptedCount = $derived(data.confirmationSummary.providerAccepted);
	const confirmationAttemptedCount = $derived(
		confirmationSentCount +
			confirmationFailedCount +
			confirmationSkippedCount +
			confirmationNotRecordedCount
	);
	const confirmationOutcomeEvidenceObserved = $derived(
		confirmationCompletedCount > 0 ||
			confirmationAttemptedCount > 0 ||
			confirmationProviderAcceptedCount > 0
	);

	function formatDollars(cents: number): string {
		return (cents / 100).toLocaleString('en-US', {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: 0
		});
	}
</script>

<svelte:head>
	<title>Fundraising | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<nav class="text-text-tertiary mb-3 flex items-center gap-2 text-sm">
					<a href="/org/{data.org.slug}/studio" class="hover:text-text-secondary transition-colors">
						Studio
					</a>
					<span aria-hidden="true">/</span>
					<span>Fundraising</span>
				</nav>
				<h1 class="text-text-primary text-xl font-semibold">Fundraising</h1>
				<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
					Take donations through public fundraiser pages and confirm each donor by email.
				</p>
			</div>
			<a
				href="/org/{data.org.slug}/fundraising/new"
				class="bg-surface-overlay text-text-primary hover:bg-surface-base rounded-md px-4 py-2 text-sm font-semibold transition-colors"
			>
				Create fundraiser
			</a>
		</div>

		{#if confirmationOutcomeEvidenceObserved}
			<div
				id="fundraising-receipt-boundary"
				class="border-surface-border bg-surface-base rounded-md border px-4 py-3"
			>
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div class="max-w-2xl">
						<p class="text-text-primary text-sm font-medium">Donor confirmations</p>
						<p class="text-text-tertiary mt-1 text-sm">
							Donors get a confirmation email after their payment completes. It confirms the
							donation; it is not a tax acknowledgment.
						</p>
					</div>
					<div
						class="w-full min-w-0 text-center sm:min-w-[320px] lg:w-auto"
						aria-label="Donor confirmation outcomes"
					>
						<div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
							<div>
								<p class="font-mono text-sm font-bold text-teal-300">
									<Datum value={confirmationSentCount} />
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">sent</p>
							</div>
							<div>
								<p class="font-mono text-sm font-bold text-red-300">
									<Datum value={confirmationFailedCount} />
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">failed</p>
							</div>
							<div>
								<p class="font-mono text-sm font-bold text-amber-300">
									<Datum value={confirmationSkippedCount} />
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">skipped</p>
							</div>
							<div>
								<p class="text-text-tertiary font-mono text-sm font-bold">
									<Datum value={confirmationNotRecordedCount} />
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">untracked</p>
							</div>
							<div>
								<p class="font-mono text-sm font-bold text-blue-300">
									<Datum value={confirmationProviderAcceptedCount} />
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">provider accepted</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		{/if}

		{#if data.campaigns.length === 0}
			<div class="border-surface-border bg-surface-base rounded-md border py-14 text-center">
				<p class="text-text-primary text-base font-medium">No fundraisers yet.</p>
				<p class="text-text-tertiary mt-1 text-sm">
					Create a draft first, then publish it when the public donation page should accept money.
				</p>
				<a
					href="/org/{data.org.slug}/fundraising/new"
					class="bg-surface-overlay text-text-primary hover:bg-surface-raised mt-4 inline-block rounded-md px-4 py-2 text-sm font-semibold transition-colors"
				>
					Create fundraiser
				</a>
			</div>
		{:else}
			<div id="fundraiser-records" class="space-y-3">
				<div class="grid gap-3 sm:grid-cols-4">
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							{fundraiserCount}
						</p>
						<p class="text-text-tertiary text-xs">fundraisers</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">{activeCount}</p>
						<p class="text-text-tertiary text-xs">active</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							{donationCount}
						</p>
						<p class="text-text-tertiary text-xs">completed donations</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							{formatDollars(raisedAmountCents)}
						</p>
						<p class="text-text-tertiary text-xs">raised</p>
					</div>
				</div>

				{#each data.campaigns as campaign (campaign.id)}
					<a href="/org/{data.org.slug}/fundraising/{campaign.id}" class="block">
						<FundraiserCard {campaign} />
					</a>
				{/each}
			</div>
		{/if}
	</div>
</div>
