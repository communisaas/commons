<script lang="ts">
	let {
		messages
	}: {
		messages: Array<{
			id: string;
			recipientName: string;
			to: string;
			status: string;
			errorCode: string | null;
			createdAt: string;
		}>;
	} = $props();

	const statusColors: Record<string, string> = {
		queued: 'bg-surface-border-strong text-text-secondary',
		sent: 'bg-blue-900/50 text-blue-400',
		delivered: 'bg-green-900/50 text-green-400',
		failed: 'bg-red-900/50 text-red-400',
		undelivered: 'bg-yellow-900/50 text-yellow-400'
	};
	const statusLabels: Record<string, string> = {
		queued: 'queued',
		sent: 'accepted',
		delivered: 'confirmed',
		failed: 'failed',
		undelivered: 'undelivered'
	};

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(iso));
	}
</script>

{#if messages.length === 0}
	<p class="text-text-tertiary py-8 text-center text-sm">No deliveries yet.</p>
{:else}
	<div class="border-surface-border overflow-x-auto rounded-lg border">
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="border-surface-border text-text-tertiary border-b text-xs">
					<th class="px-4 py-3 font-medium">Recipient</th>
					<th class="px-4 py-3 font-medium">Receipt state</th>
					<th class="px-4 py-3 font-medium">Error</th>
					<th class="px-4 py-3 font-medium">Recorded</th>
				</tr>
			</thead>
			<tbody>
				{#each messages as msg (msg.id)}
					<tr class="border-surface-border/70 border-b last:border-0">
						<td class="px-4 py-3">
							<p class="text-text-primary">{msg.recipientName}</p>
							<p class="text-text-tertiary text-xs">{msg.to}</p>
						</td>
						<td class="px-4 py-3">
							<span
								class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {statusColors[
									msg.status
								] ?? 'bg-surface-border-strong text-text-secondary'}"
							>
								{statusLabels[msg.status] ?? msg.status}
							</span>
						</td>
						<td class="text-text-tertiary px-4 py-3">
							{#if msg.errorCode}
								<span class="text-xs text-red-400">{msg.errorCode}</span>
							{:else}
								<span class="text-text-quaternary">-</span>
							{/if}
						</td>
						<td class="text-text-tertiary px-4 py-3">{formatDate(msg.createdAt)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
