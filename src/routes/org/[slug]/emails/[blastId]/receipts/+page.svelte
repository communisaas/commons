<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import { FEATURES } from '$lib/config/features';
	import {
		buildEmailDeliveryEvidenceReadiness,
		getGateEvidence,
		type EmailDeliveryEvidenceRow
	} from '$lib/data/capability-hypergraph';
	import { Datum, RegistryMark } from '$lib/design';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const receiptRows = $derived(data.receipts.length);
	const sentCount = $derived(data.receipts.filter((receipt) => receipt.status === 'sent').length);
	const failedCount = $derived(
		data.receipts.filter((receipt) => receipt.status === 'failed').length
	);

	const base = $derived(`/org/${data.orgSlug}`);
	const emailProxyGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Email send proxy',
		dependency: 'AWS Lambda deploy + BLAST receipts secret sync'
	});
	const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2', 'T8-8'], {
		name: 'Email receipt and response',
		downstream: 8,
		dependency: 'Receipt writer/mainnet anchoring + reader-side notifications'
	});
	const listHealthGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Bounce and complaint attribution',
		dependency: 'SES webhook correlation + List-Unsubscribe receipt path'
	});
	const abAutomationGate = getGateEvidence('CP-ab-automated-dispatch', ['T1-6b'], {
		name: 'A/B automated dispatch',
		downstream: 1,
		dependency: 'Idempotent test-cohort and winning-remainder send runner'
	});
	const engagementTelemetryGate = getGateEvidence('CP-email-engagement-attribution', ['T2-10'], {
		name: 'Email engagement attribution',
		downstream: 1,
		dependency: 'SES open/click attribution + Configuration Set evidence'
	});

	const emailDeliveryEvidence = $derived(
		buildEmailDeliveryEvidenceReadiness({
			base,
			blastId: data.blast.id,
			delivery: {
				status: data.blast.status,
				totalSent: data.blast.totalSent,
				totalBounced: data.blast.totalBounced,
				totalOpened: 0,
				totalClicked: 0,
				totalComplained: 0,
				receiptPageCount: receiptRows,
				receiptSentCount: sentCount,
				receiptFailedCount: failedCount,
				receiptHasMore: data.hasMore,
				engagementMetricsEnabled: FEATURES.ENGAGEMENT_METRICS
			},
			receiptRegister: {
				rowCount: receiptRows,
				sentCount,
				failedCount,
				hasMore: data.hasMore
			},
			gates: {
				emailProxyGate,
				receiptAnchoringGate,
				abAutomationGate,
				listHealthGate,
				engagementTelemetryGate
			}
		})
	);

	function receiptRegisterHref(row: EmailDeliveryEvidenceRow): string {
		if (row.id === 'delivery-record')
			return `/org/${data.orgSlug}/emails/${data.blast.id}#email-record`;
		if (row.id === 'receipt-register') return '#email-receipt-register';
		if (row.id === 'dispatch-outcomes') return '#email-dispatch-outcomes';
		if (row.id === 'recipient-privacy') return '#recipient-hash-boundary';
		if (row.id === 'anchored-receipt-proof') return '#email-receipt-anchoring-boundary';
		return row.href;
	}

	const capabilityItems = $derived(
		emailDeliveryEvidence.receiptRegisterRows.map((row) => ({
			...row,
			href: receiptRegisterHref(row)
		}))
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
				<h1 class="text-text-primary mt-2 text-2xl font-bold">Delivery receipt register</h1>
				<p class="text-text-tertiary mt-1 max-w-3xl text-sm">
					{data.blast.subject}. This page reads bounded per-recipient send outcomes. It does not
					turn delivery counters into anchored accountability receipts.
				</p>
			</div>

			<div class="grid gap-3 sm:grid-cols-4">
				<div class="border-surface-border bg-surface-base rounded-md border p-3">
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum value={data.blast.totalRecipients} cite="email.getBlast totalRecipients" />
					</p>
					<p class="text-text-tertiary text-xs">recipients</p>
				</div>
				<div class="border-surface-border bg-surface-base rounded-md border p-3">
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum value={data.blast.totalSent} cite="email.getBlast totalSent" />
					</p>
					<p class="text-text-tertiary text-xs">sent counter</p>
				</div>
				<div class="border-surface-border bg-surface-base rounded-md border p-3">
					<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
						<Datum value={receiptRows} cite="email.listReceiptsForBlast" />
					</p>
					<p class="text-text-tertiary text-xs">receipt rows</p>
				</div>
				<div class="border-surface-border bg-surface-base rounded-md border p-3">
					<p class="font-mono text-lg font-bold text-red-500 tabular-nums">
						<Datum value={failedCount} cite="emailDeliveryReceipts.status" />
					</p>
					<p class="text-text-tertiary text-xs">failed rows</p>
				</div>
			</div>
		</header>

		<WorkspaceCapabilityStrip label="Email receipt register capability" items={capabilityItems} />

		<section
			id="email-receipt-anchoring-boundary"
			class="border-surface-border bg-surface-base rounded-md border px-4 py-3"
		>
			<p class="text-text-primary text-sm font-medium">Anchoring boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				Rows here prove what this org can inspect about a blast dispatch attempt. Archive-grade
				receipt batches, Merkle roots, and reader-office notification surfaces remain outside this
				register.
			</p>
		</section>

		<section
			id="recipient-hash-boundary"
			class="border-surface-border bg-surface-base rounded-md border px-4 py-3"
		>
			<p class="text-text-primary text-sm font-medium">Recipient privacy boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				The register exposes deterministic org-scoped hashes and dispatch metadata only. It does not
				decrypt names, emails, or message bodies.
			</p>
		</section>

		{#if data.receipts.length === 0}
			<section
				id="email-receipt-register"
				class="border-surface-border bg-surface-base rounded-md border py-14 text-center"
			>
				<p class="text-text-primary text-base font-medium">No receipt rows on this page.</p>
				<p class="text-text-tertiary mx-auto mt-2 max-w-md text-sm">
					Receipt rows appear after a dispatch path writes per-recipient outcomes. Until then, sent
					counters stay separate from receipt proof.
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
						<p class="text-text-primary text-sm font-medium">Dispatch outcome rows</p>
						<p class="text-text-tertiary mt-1 text-xs">
							Loaded {sentCount} sent row{sentCount === 1 ? '' : 's'} and {failedCount} failed row{failedCount ===
							1
								? ''
								: 's'} from the current receipt page.
						</p>
					</div>
					<p class="text-text-tertiary font-mono text-xs">
						{data.hasMore ? 'paged' : 'complete page'}
					</p>
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
				Recipient identity stays encrypted under the org key elsewhere. This register exposes only
				the deterministic hash, immediate dispatch status, optional SES message id, and any local
				send error for the current blast.
			</p>
		</footer>
	</div>
</main>
