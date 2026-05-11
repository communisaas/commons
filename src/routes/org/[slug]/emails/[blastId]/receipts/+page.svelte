<script lang="ts">
	import type { PageData } from './$types';
	import { Datum, RegistryMark } from '$lib/design';

	let { data }: { data: PageData } = $props();

	function formatTimestamp(ts: number): string {
		return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
	}

	const sentCount = $derived(
		data.receipts.filter((r) => r.status === 'sent').length
	);
	const failedCount = $derived(
		data.receipts.filter((r) => r.status === 'failed').length
	);
</script>

<svelte:head>
	<title>Delivery receipts — {data.blast.subject}</title>
</svelte:head>

<main class="mx-auto max-w-4xl px-4 py-10">
	<header class="mb-8 border-b border-slate-200 pb-6">
		<p class="font-mono text-xs uppercase tracking-wide text-slate-500">
			Delivery receipts
		</p>
		<h1 class="mt-2 font-brand text-2xl font-bold text-slate-900">
			{data.blast.subject}
		</h1>
		<dl class="mt-5 flex flex-wrap gap-x-8 gap-y-2 font-brand text-sm">
			<div>
				<dt class="font-mono text-xs uppercase tracking-wide text-slate-500">
					Total recipients
				</dt>
				<dd class="mt-1">
					<Datum
						value={data.blast.totalRecipients}
						class="font-mono tabular-nums text-slate-800"
					/>
				</dd>
			</div>
			<div>
				<dt class="font-mono text-xs uppercase tracking-wide text-slate-500">
					Sent
				</dt>
				<dd class="mt-1">
					<Datum
						value={data.blast.totalSent}
						class="font-mono tabular-nums text-slate-800"
					/>
				</dd>
			</div>
			<div>
				<dt class="font-mono text-xs uppercase tracking-wide text-slate-500">
					Bounced or failed
				</dt>
				<dd class="mt-1">
					<Datum
						value={data.blast.totalBounced}
						class="font-mono tabular-nums text-slate-800"
					/>
				</dd>
			</div>
			<div>
				<dt class="font-mono text-xs uppercase tracking-wide text-slate-500">
					This page
				</dt>
				<dd class="mt-1 font-mono tabular-nums text-slate-800">
					{sentCount} sent · {failedCount} failed
				</dd>
			</div>
		</dl>
		<p class="mt-4 font-brand text-xs text-slate-500">
			Per-recipient outcomes are recorded by the bulk-send Lambda after each batch
			(durable path) and by the browser as a backup. Recipient identity is shown
			as the org-scoped email hash, never plaintext.
		</p>
	</header>

	{#if data.receipts.length === 0}
		<section class="my-10 border-y border-slate-200 py-10 text-center">
			<p class="font-brand text-base text-slate-700">No receipts on record yet.</p>
			<p class="mx-auto mt-2 max-w-md font-brand text-sm text-slate-500">
				Receipts appear after the blast dispatches. If the blast is in the sending
				state, refresh after a moment.
			</p>
		</section>
	{:else}
		<section class="overflow-hidden rounded-md border border-slate-200">
			<table class="w-full font-brand text-sm">
				<thead class="bg-slate-50 text-left">
					<tr class="font-mono text-[11px] uppercase tracking-wide text-slate-500">
						<th class="px-4 py-2.5 font-medium">Sent at</th>
						<th class="px-4 py-2.5 font-medium">Recipient hash</th>
						<th class="px-4 py-2.5 font-medium">Status</th>
						<th class="px-4 py-2.5 font-medium">SES message id</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.receipts as receipt (receipt.id)}
						<tr>
							<td class="px-4 py-3 font-mono text-xs tabular-nums text-slate-600">
								{formatTimestamp(receipt.sentAt)}
							</td>
							<td class="px-4 py-3">
								<RegistryMark
									variant="sha256"
									value={receipt.recipientEmailHash}
									truncate
									copy={false}
									class="text-[11px] text-slate-600"
								/>
							</td>
							<td class="px-4 py-3">
								<span class="font-mono text-xs uppercase tracking-wide {receipt.status === 'sent' ? 'text-emerald-700' : 'text-red-700'}">
									{receipt.status}
								</span>
								{#if receipt.error}
									<p class="mt-1 font-brand text-[11px] text-slate-500">
										{receipt.error}
									</p>
								{/if}
							</td>
							<td class="px-4 py-3">
								{#if receipt.sesMessageId}
									<RegistryMark
										variant="tag"
										value={receipt.sesMessageId}
										truncate
										class="text-[11px] text-slate-500"
									/>
								{:else}
									<span class="font-mono text-[11px] text-slate-400">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		{#if data.hasMore}
			<p class="mt-6 text-center">
				<a
					href="?cursor={encodeURIComponent(data.cursor ?? '')}"
					class="font-brand text-sm text-indigo-600 hover:text-indigo-800"
				>
					Show next 50 →
				</a>
			</p>
		{/if}
	{/if}

	<footer class="mt-12 border-t border-slate-200 pt-6">
		<p class="font-brand text-xs text-slate-500">
			Receipts are operator-visible per-blast. Per-recipient identity stays
			encrypted under the org key elsewhere; this page surfaces only the
			deterministic hash and SES dispatch outcome.
		</p>
	</footer>
</main>
