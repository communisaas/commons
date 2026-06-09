<script lang="ts">
	import { Datum } from '$lib/design';

	let {
		blast
	}: {
		blast: {
			id: string;
			body: string;
			status: string;
			sentCount: number;
			deliveredCount: number;
			failedCount: number;
			totalRecipients: number;
			messageCount?: number;
			createdAt: string;
			sentAt?: string | null;
		};
	} = $props();

	const statusColors: Record<string, string> = {
		draft: 'bg-surface-border-strong text-text-secondary',
		sending: 'bg-yellow-900/50 text-yellow-400',
		sent: 'bg-green-900/50 text-green-400',
		failed: 'bg-red-900/50 text-red-400'
	};
	const statusLabels: Record<string, string> = {
		draft: 'draft',
		sending: 'dispatching',
		sent: 'dispatched',
		failed: 'failed'
	};

	const preview = $derived(blast.body.length > 80 ? blast.body.slice(0, 80) + '...' : blast.body);
	const carrierCounterEvidenceObserved = $derived(
		(blast.messageCount ?? 0) > 0 ||
			blast.sentCount > 0 ||
			blast.deliveredCount > 0 ||
			blast.failedCount > 0
	);
	const carrierStatusEvidenceObserved = $derived(
		carrierCounterEvidenceObserved ||
			!!blast.sentAt ||
			blast.status === 'sent' ||
			blast.status === 'failed'
	);

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(iso));
	}
</script>

<div
	class="border-surface-border hover:border-surface-border-strong rounded-lg border p-4 transition-colors"
>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<div class="mb-1 flex items-center gap-2">
				<p class="text-text-primary truncate text-sm">{preview}</p>
				<span
					class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium {statusColors[
						blast.status
					] ?? 'bg-surface-border-strong text-text-secondary'}"
				>
					{statusLabels[blast.status] ?? blast.status}
				</span>
			</div>
			<p class="text-text-tertiary text-sm">{formatDate(blast.createdAt)}</p>
		</div>

		<div class="shrink-0 text-right">
			<p class="text-text-secondary text-sm">
				<Datum value={blast.totalRecipients} cite="smsBlasts.totalRecipients" /> planned recipients
			</p>
			{#if carrierCounterEvidenceObserved}
				<p class="text-text-tertiary mt-0.5 text-xs" aria-label="Text carrier execution evidence">
					<Datum value={blast.sentCount} cite="smsBlasts.sentCount" /> accepted &middot;
					<Datum value={blast.deliveredCount} cite="smsBlasts.deliveredCount" /> confirmed &middot;
					<Datum value={blast.failedCount} cite="smsBlasts.failedCount" /> failed
				</p>
			{:else}
				<p class="text-text-tertiary mt-0.5 text-xs" aria-label="Saved text custody evidence">
					{carrierStatusEvidenceObserved
						? 'carrier status recorded; counters not loaded'
						: 'carrier counters hidden until receipt rows exist'}
				</p>
			{/if}
		</div>
	</div>
</div>
