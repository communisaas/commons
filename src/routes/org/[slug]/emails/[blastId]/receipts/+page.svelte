<script lang="ts">
	import { Datum, RegistryMark } from '$lib/design';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const receiptRows = $derived(data.receipts.length);
	const sentCount = $derived(data.receipts.filter((receipt) => receipt.status === 'sent').length);
	const failedCount = $derived(
		data.receipts.filter((receipt) => receipt.status === 'failed').length
	);

	function formatTimestamp(ts: number): string {
		return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
	}
</script>

<svelte:head>
	<title>Delivery receipt register | {data.blast.subject}</title>
</svelte:head>

<main class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<a
			href="/org/{data.orgSlug}/emails/{data.blast.id}"
			class="text-text-tertiary hover:text-text-primary inline-block text-sm"
		>
			&larr; Email detail
		</a>

		<header class="space-y-3">
			<div>
				<p class="text-text-quaternary font-mono text-xs font-semibold tracking-wider uppercase">
					Email delivery evidence
				</p>
				<h1 class="text-text-primary mt-2 text-2xl font-bold">Delivery receipts</h1>
				<p class="text-text-tertiary mt-1 max-w-3xl text-sm">
					{data.blast.subject}. Each receipt records one recipient's delivery outcome for this
					send.
				</p>
			</div>

			<div class="grid gap-3 sm:grid-cols-4">
				<div class="border-surface-border bg-surface-base rounded-md border p-3">
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum value={data.blast.totalRecipients} />
					</p>
					<p class="text-text-tertiary text-xs">recipients</p>
				</div>
				<div class="border-surface-border bg-surface-base rounded-md border p-3">
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum value={data.blast.totalSent} />
					</p>
					<p class="text-text-tertiary text-xs">sent</p>
				</div>
				<div class="border-surface-border bg-surface-base rounded-md border p-3">
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum value={receiptRows} />
					</p>
					<p class="text-text-tertiary text-xs">receipts</p>
				</div>
				<div class="border-surface-border bg-surface-base rounded-md border p-3">
					<p class="font-mono text-lg font-bold text-red-500 tabular-nums">
						<Datum value={failedCount} />
					</p>
					<p class="text-text-tertiary text-xs">failed</p>
				</div>
			</div>
		</header>

		{#if data.receipts.length === 0}
			<section
				id="email-receipt-register"
				class="border-surface-border bg-surface-base rounded-md border py-14 text-center"
			>
				<p class="text-text-primary text-base font-medium">No delivery receipts yet.</p>
				<p class="text-text-tertiary mx-auto mt-2 max-w-md text-sm">
					Receipts appear here once this email is sent, one per recipient.
				</p>
			</section>
		{:else}
			<section
				id="email-receipt-register"
				class="border-surface-border bg-surface-base overflow-hidden rounded-md border"
			>
				<div
					id="email-dispatch-outcomes"
					class="border-surface-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
				>
					<div>
						<p class="text-text-primary text-sm font-medium">Delivery outcomes</p>
						<p class="text-text-tertiary mt-1 text-xs">
							{sentCount} sent and {failedCount} failed on this page.
						</p>
					</div>
					{#if data.hasMore}
						<p class="text-text-tertiary font-mono text-xs">more pages</p>
					{/if}
				</div>

				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead class="border-surface-border bg-surface-raised border-b">
							<tr class="text-text-tertiary font-mono text-[11px] tracking-wide uppercase">
								<th class="px-4 py-2.5 font-medium">Sent at</th>
								<th class="px-4 py-2.5 font-medium">Recipient hash</th>
								<th class="px-4 py-2.5 font-medium">Status</th>
								<th class="px-4 py-2.5 font-medium">SES message id</th>
							</tr>
						</thead>
						<tbody class="divide-surface-border divide-y">
							{#each data.receipts as receipt (receipt.id)}
								<tr>
									<td class="text-text-tertiary px-4 py-3 font-mono text-xs tabular-nums">
										{formatTimestamp(receipt.sentAt)}
									</td>
									<td class="px-4 py-3">
										<RegistryMark
											variant="sha256"
											value={receipt.recipientEmailHash}
											truncate
											copy={false}
											class="text-text-tertiary text-[11px]"
										/>
									</td>
									<td class="px-4 py-3">
										<span
											class="font-mono text-xs tracking-wide uppercase {receipt.status === 'sent'
												? 'text-emerald-500'
												: 'text-red-500'}"
										>
											{receipt.status}
										</span>
										{#if receipt.error}
											<p class="text-text-tertiary mt-1 text-[11px]">{receipt.error}</p>
										{/if}
									</td>
									<td class="px-4 py-3">
										{#if receipt.sesMessageId}
											<RegistryMark
												variant="tag"
												value={receipt.sesMessageId}
												truncate
												class="text-text-tertiary text-[11px]"
											/>
										{:else}
											<span class="text-text-quaternary font-mono text-[11px]">&mdash;</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>

			{#if data.hasMore}
				<p class="text-center">
					<a
						href="?cursor={encodeURIComponent(data.cursor ?? '')}"
						class="text-text-secondary hover:text-text-primary text-sm font-medium"
					>
						Show next 50 &rarr;
					</a>
				</p>
			{/if}
		{/if}

		<footer class="border-surface-border border-t pt-6">
			<p class="text-text-tertiary text-xs">
				Recipient names and emails stay encrypted. This page shows only a one-way hash for each
				recipient, the delivery status, the provider message ID, and any send error.
			</p>
		</footer>
	</div>
</main>
