<script lang="ts">
	import { Datum } from '$lib/design';
	import { SPRINGS } from '$lib/design/motion';

	type ConfirmationEmailStatus = 'sending' | 'sent' | 'skipped' | 'failed' | null;

	let {
		donors,
		currency
	}: {
		donors: Array<{
			id: string;
			name: string;
			email: string;
			amountCents: number;
			recurring: boolean;
			engagementTier: number;
			districtHash: string | null;
			completedAt: string | null;
			confirmationEmailStatus: ConfirmationEmailStatus;
			confirmationEmailAttemptedAt: string | null;
			confirmationEmailSentAt: string | null;
			confirmationEmailFailureReason: string | null;
			confirmationEmailProvider: string | null;
			confirmationEmailProviderMessageId: string | null;
		}>;
		currency: string;
	} = $props();

	function formatCents(cents: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency
		}).format(cents / 100);
	}

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(iso));
	}

	function confirmationLabel(status: ConfirmationEmailStatus): string {
		if (status === 'sent') return 'sent';
		if (status === 'sending') return 'sending';
		if (status === 'skipped') return 'skipped';
		if (status === 'failed') return 'failed';
		return 'not recorded';
	}

	function confirmationClass(status: ConfirmationEmailStatus): string {
		if (status === 'sent') return 'border-teal-500/30 bg-teal-500/10 text-teal-300';
		if (status === 'sending') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
		if (status === 'skipped') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
		if (status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-300';
		return 'border-surface-border text-text-quaternary';
	}

	function confirmationTime(donor: {
		confirmationEmailSentAt: string | null;
		confirmationEmailAttemptedAt: string | null;
	}): string | null {
		return donor.confirmationEmailSentAt ?? donor.confirmationEmailAttemptedAt;
	}

	function providerReference(donor: {
		confirmationEmailProvider: string | null;
		confirmationEmailProviderMessageId: string | null;
	}): string | null {
		if (!donor.confirmationEmailProviderMessageId) return null;
		const provider = donor.confirmationEmailProvider ?? 'provider';
		return `${provider}:${donor.confirmationEmailProviderMessageId}`;
	}
</script>

{#if donors.length === 0}
	<p
		class="border-surface-border bg-surface-base text-text-tertiary rounded-md border py-8 text-center text-sm"
	>
		No completed donations yet.
	</p>
{:else}
	<div class="border-surface-border bg-surface-base overflow-x-auto rounded-md border">
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="border-surface-border text-text-tertiary border-b text-xs">
					<th class="px-4 py-3 font-medium">Name</th>
					<th class="px-4 py-3 font-medium">Email</th>
					<th class="px-4 py-3 font-medium">Amount</th>
					<th class="px-4 py-3 font-medium">Recurring</th>
					<th class="px-4 py-3 font-medium">Tier</th>
					<th class="px-4 py-3 font-medium">Confirmation</th>
					<th class="px-4 py-3 font-medium">Date</th>
				</tr>
			</thead>
			<tbody>
				{#each donors as donor (donor.id)}
					<tr class="border-surface-border/70 border-b last:border-0">
						<td class="text-text-primary px-4 py-3">{donor.name}</td>
						<td class="text-text-tertiary px-4 py-3">{donor.email || 'withheld'}</td>
						<td class="text-text-primary px-4 py-3 font-medium">{formatCents(donor.amountCents)}</td
						>
						<td class="px-4 py-3">
							{#if donor.recurring}
								<span
									class="inline-flex rounded-md border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-xs font-medium text-teal-300"
								>
									Monthly
								</span>
							{:else}
								<span class="text-text-quaternary">&mdash;</span>
							{/if}
						</td>
						<td class="text-text-tertiary px-4 py-3">
							<Datum
								value={donor.engagementTier}
								animate
								spring={SPRINGS.METRIC}
								cite="donations.engagementTier"
							/>
						</td>
						<td class="px-4 py-3">
							<span
								class="inline-flex rounded-md border px-2 py-0.5 font-mono text-[0.68rem] font-semibold tracking-wide uppercase {confirmationClass(
									donor.confirmationEmailStatus
								)}"
								title={donor.confirmationEmailFailureReason ??
									'Baseline donor confirmation email status'}
							>
								{confirmationLabel(donor.confirmationEmailStatus)}
							</span>
							{#if confirmationTime(donor)}
								<p class="text-text-quaternary mt-1 text-xs">
									{formatDate(confirmationTime(donor)!)}
								</p>
							{/if}
							{#if providerReference(donor)}
								<p
									class="text-text-quaternary mt-1 max-w-[12rem] truncate font-mono text-[0.65rem]"
									title={providerReference(donor) ?? undefined}
								>
									{providerReference(donor)}
								</p>
							{/if}
						</td>
						<td class="text-text-tertiary px-4 py-3">
							{donor.completedAt ? formatDate(donor.completedAt) : 'pending'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
