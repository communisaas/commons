<script lang="ts">
	import DonationMetrics from '$lib/components/fundraising/DonationMetrics.svelte';
	import DonorTable from '$lib/components/fundraising/DonorTable.svelte';
	import { Datum } from '$lib/design';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	const statusColors: Record<string, string> = {
		DRAFT: 'border-surface-border-strong bg-surface-overlay text-text-secondary',
		ACTIVE: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
		COMPLETE: 'border-blue-500/30 bg-blue-500/10 text-blue-300'
	};

	const isActive = $derived(data.campaign.status === 'ACTIVE');
	const publicHref = $derived(`/d/${data.campaign.id}`);
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
	const receiptPolicy = $derived(data.campaign.donationReceiptPolicy);
	const receiptPolicyConfigured = $derived(Boolean(receiptPolicy));
	const receiptPolicyLabel = $derived(
		receiptPolicy?.mode === 'tax_acknowledgment_policy'
			? 'Tax acknowledgment policy'
			: receiptPolicy?.mode === 'confirmation_only'
				? 'Confirmation only'
				: 'No saved receipt policy'
	);
	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(iso));
	}
</script>

<svelte:head>
	<title>{data.campaign.title} | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<a
			href="/org/{data.org.slug}/fundraising"
			class="text-text-tertiary hover:text-text-primary inline-block text-sm"
		>
			Fundraising / back
		</a>

		<div id="fundraiser-record" class="flex flex-wrap items-start justify-between gap-4">
			<div class="min-w-0">
				<div class="mb-2 flex items-center gap-3">
					<h1 class="text-text-primary text-xl font-semibold">{data.campaign.title}</h1>
					<span
						class="rounded-md border px-2 py-0.5 font-mono text-xs font-semibold {statusColors[
							data.campaign.status
						] ?? 'border-surface-border-strong bg-surface-overlay text-text-secondary'}"
					>
						{data.campaign.status}
					</span>
				</div>
				<p class="text-text-tertiary text-sm">Created {formatDate(data.campaign.createdAt)}</p>
			</div>

			<div class="flex flex-wrap justify-end gap-2">
				{#if isActive}
					<a
						href={publicHref}
						target="_blank"
						rel="noopener"
						class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm"
					>
						Open donation page
					</a>
				{:else}
					<span
						class="border-surface-border text-text-quaternary rounded-md border px-3 py-1.5 text-sm"
					>
						Donation page not published
					</span>
				{/if}
			</div>
		</div>

		{#if form?.error}
			<div class="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
				{form.error}
			</div>
		{/if}
		{#if form?.statusChanged}
			<div
				class="rounded-md border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300"
			>
				Fundraiser status changed to {form.statusChanged}.
			</div>
		{/if}
		{#if form?.receiptPolicySaved}
			<div
				class="rounded-md border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300"
			>
				Receipt policy register saved.
			</div>
		{/if}

		<div
			id="fundraiser-publication"
			class="border-surface-border bg-surface-base rounded-md border p-4"
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p class="text-text-primary text-sm font-medium">Public donation surface</p>
					<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
						{#if isActive}
							This fundraiser can accept public checkout attempts through its donation page.
						{:else}
							This fundraiser is not accepting public checkout attempts while it is {data.campaign.status.toLowerCase()}.
						{/if}
					</p>
				</div>

				{#if data.canManageFundraiser}
					<div class="flex flex-wrap gap-2">
						{#if data.campaign.status === 'DRAFT'}
							<form method="POST" action="?/publish">
								<button
									type="submit"
									class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-500"
								>
									Publish donation page
								</button>
							</form>
						{/if}
						{#if data.campaign.status === 'ACTIVE'}
							<form method="POST" action="?/complete">
								<button
									type="submit"
									class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm"
								>
									Close fundraiser
								</button>
							</form>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<DonationMetrics campaign={data.campaign} />

		{#if data.campaign.body}
			<div class="border-surface-border bg-surface-base rounded-md border p-4">
				<h3 class="text-text-tertiary mb-2 text-sm font-medium">Story</h3>
				<p class="text-text-secondary text-sm whitespace-pre-line">{data.campaign.body}</p>
			</div>
		{/if}

		<div class="grid gap-4">
			<div
				id="fundraiser-receipt-boundary"
				class="border-surface-border bg-surface-base rounded-md border p-4"
			>
				<p class="text-text-primary text-sm font-medium">Donor confirmations</p>
				<p class="text-text-tertiary mt-1 text-sm">
					Donors get a confirmation email after their payment completes. It confirms the donation;
					it is not a tax acknowledgment.
				</p>
				{#if confirmationOutcomeEvidenceObserved}
					<div class="mt-4" aria-label="Donor confirmation outcomes">
						<div class="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
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
				{/if}
				<div class="border-surface-border mt-4 border-t pt-4">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="text-text-quaternary font-mono text-[0.65rem] tracking-wider uppercase">
								Receipt policy register
							</p>
							<p class="text-text-primary mt-1 text-sm font-medium">{receiptPolicyLabel}</p>
						</div>
						<span
							class="rounded-md border px-2 py-0.5 font-mono text-[0.65rem] font-semibold uppercase {receiptPolicyConfigured
								? 'border-teal-500/30 bg-teal-500/10 text-teal-300'
								: 'border-surface-border-strong bg-surface-overlay text-text-tertiary'}"
						>
							{receiptPolicyConfigured ? 'saved context' : 'not configured'}
						</span>
					</div>
					{#if receiptPolicy?.legalName}
						<p class="text-text-tertiary mt-3 text-sm">
							Legal sender name: <span class="text-text-secondary">{receiptPolicy.legalName}</span>
						</p>
					{/if}
					{#if receiptPolicy?.acknowledgmentText}
						<p
							class="text-text-secondary bg-surface-overlay border-surface-border mt-3 rounded-md border p-3 text-sm whitespace-pre-line"
						>
							{receiptPolicy.acknowledgmentText}
						</p>
					{/if}

					{#if data.canManageFundraiser}
						<form method="POST" action="?/saveReceiptPolicy" class="mt-4 space-y-3">
							<div class="grid gap-3 md:grid-cols-2">
								<label class="block">
									<span class="text-text-tertiary text-xs font-medium">Mode</span>
									<select
										name="receipt_policy_mode"
										class="border-surface-border bg-surface-overlay text-text-primary mt-1 w-full rounded-md border px-3 py-2 text-sm"
									>
										<option value="none" selected={!receiptPolicy}>No saved policy</option>
										<option
											value="confirmation_only"
											selected={receiptPolicy?.mode === 'confirmation_only'}
										>
											Confirmation only
										</option>
										<option
											value="tax_acknowledgment_policy"
											selected={receiptPolicy?.mode === 'tax_acknowledgment_policy'}
										>
											Tax acknowledgment policy
										</option>
									</select>
								</label>
								<label class="block">
									<span class="text-text-tertiary text-xs font-medium">Legal sender name</span>
									<input
										name="receipt_legal_name"
										maxlength="200"
										value={receiptPolicy?.legalName ?? ''}
										class="border-surface-border bg-surface-overlay text-text-primary placeholder:text-text-quaternary mt-1 w-full rounded-md border px-3 py-2 text-sm"
										placeholder="Organization legal sender"
									/>
								</label>
							</div>
							<label class="block">
								<span class="text-text-tertiary text-xs font-medium">Acknowledgment text</span>
								<textarea
									name="receipt_acknowledgment_text"
									maxlength="1000"
									rows="4"
									class="border-surface-border bg-surface-overlay text-text-primary placeholder:text-text-quaternary mt-1 w-full rounded-md border px-3 py-2 text-sm"
									placeholder="Operator-authored boundary or donor acknowledgment language"
									>{receiptPolicy?.acknowledgmentText ?? ''}</textarea
								>
							</label>
							<div class="flex flex-wrap items-center justify-between gap-3">
								<p class="text-text-quaternary text-xs">
									This text can render in baseline donor confirmations; it does not validate tax
									status or issue anchored receipts.
								</p>
								<button
									type="submit"
									class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-500"
								>
									Save receipt policy
								</button>
							</div>
						</form>
					{/if}
				</div>
			</div>
		</div>

		<div id="fundraiser-donors" class="space-y-3">
			<div class="flex items-center justify-between gap-3">
				<h3 class="text-text-tertiary text-sm font-medium">Donations ({data.donors.length})</h3>
				<span class="text-text-quaternary font-mono text-xs tracking-wider uppercase">
					PII encrypted at rest
				</span>
			</div>
			<DonorTable donors={data.donors} currency={data.campaign.donationCurrency} />
		</div>
	</div>
</div>
