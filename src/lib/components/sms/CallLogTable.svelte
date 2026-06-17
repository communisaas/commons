<script lang="ts">
	let {
		calls
	}: {
		calls: Array<{
			id: string;
			supporterName: string;
			targetName: string | null;
			targetPhone: string;
			piiState?: 'encrypted' | 'not-recorded';
			status: string;
			duration: number | null;
			createdAt: string;
		}>;
	} = $props();

	const statusColors: Record<string, string> = {
		initiated: 'border-surface-border-strong bg-surface-overlay text-text-secondary',
		ringing: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
		'in-progress': 'border-blue-500/30 bg-blue-500/10 text-blue-300',
		completed: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
		failed: 'border-red-500/30 bg-red-500/10 text-red-300',
		'no-answer': 'border-surface-border-strong bg-surface-overlay text-text-secondary',
		busy: 'border-amber-500/30 bg-amber-500/10 text-amber-300'
	};

	function formatDuration(seconds: number | null): string {
		if (seconds == null) return '-';
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(iso));
	}
</script>

{#if calls.length === 0}
	<p class="text-text-tertiary py-8 text-center text-sm">No call records yet.</p>
{:else}
	<div class="border-surface-border overflow-x-auto rounded-md border">
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="border-surface-border text-text-quaternary border-b text-xs">
					<th class="px-4 py-3 font-medium">Supporter</th>
					<th class="px-4 py-3 font-medium">Target</th>
					<th class="px-4 py-3 font-medium">Status</th>
					<th class="px-4 py-3 font-medium">Duration</th>
					<th class="px-4 py-3 font-medium">Date</th>
				</tr>
			</thead>
			<tbody>
				{#each calls as call (call.id)}
					<tr class="border-surface-border/70 border-b last:border-0">
						<td class="text-text-primary px-4 py-3">
							{call.supporterName}
							{#if call.piiState === 'encrypted'}
								<p class="text-text-quaternary mt-1 text-xs">PII encrypted at rest</p>
							{/if}
						</td>
						<td class="px-4 py-3">
							<p class="text-text-primary">{call.targetName ?? 'Target not labeled'}</p>
							<p class="text-text-quaternary text-xs">{call.targetPhone}</p>
						</td>
						<td class="px-4 py-3">
							<span
								class="inline-flex rounded-md border px-2 py-0.5 font-mono text-xs font-medium {statusColors[
									call.status
								] ?? 'border-surface-border-strong bg-surface-overlay text-text-secondary'}"
							>
								{call.status}
							</span>
						</td>
						<td class="text-text-secondary px-4 py-3">{formatDuration(call.duration)}</td>
						<td class="text-text-tertiary px-4 py-3">{formatDate(call.createdAt)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
