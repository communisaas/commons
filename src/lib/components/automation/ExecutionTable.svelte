<script lang="ts">
	type Execution = {
		id: string;
		supporterName: string;
		supporterEmail: string;
		status: string;
		currentStep: number;
		error: string | null;
		stepBoundary: string | null;
		createdAt: string;
		completedAt: string | null;
	};

	let {
		executions
	}: {
		executions: Execution[];
	} = $props();

	const statusColors: Record<string, string> = {
		pending: 'bg-surface-border-strong text-text-secondary',
		running: 'bg-blue-900/50 text-blue-400',
		completed: 'bg-green-900/50 text-green-400',
		partial_no_op: 'bg-amber-500/15 text-amber-300',
		failed: 'bg-red-900/50 text-red-400',
		paused: 'bg-yellow-900/50 text-yellow-400'
	};
	const statusLabels: Record<string, string> = {
		pending: 'pending',
		running: 'running',
		completed: 'completed',
		partial_no_op: 'partial no-op',
		failed: 'failed',
		paused: 'paused'
	};

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(iso));
	}

	function executionBoundary(exec: Execution): string | null {
		if (exec.error) return exec.error;
		if (exec.status === 'partial_no_op') {
			return (
				exec.stepBoundary ??
				'Completed with unsupported legacy step no-ops; this run is not clean coordination evidence.'
			);
		}
		return null;
	}

	function executionBoundaryClass(exec: Execution): string {
		return exec.status === 'partial_no_op' && !exec.error ? 'text-amber-300' : 'text-red-400';
	}
</script>

{#if executions.length === 0}
	<p class="text-text-tertiary py-8 text-center text-sm">No run records yet.</p>
{:else}
	<div class="border-surface-border overflow-x-auto rounded-lg border">
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="border-surface-border text-text-tertiary border-b text-xs">
					<th class="px-4 py-3 font-medium">Person</th>
					<th class="px-4 py-3 font-medium">Run state</th>
					<th class="px-4 py-3 font-medium">Step</th>
					<th class="px-4 py-3 font-medium">Recorded</th>
					<th class="px-4 py-3 font-medium">Finished</th>
				</tr>
			</thead>
			<tbody>
				{#each executions as exec (exec.id)}
					{@const boundary = executionBoundary(exec)}
					<tr class="border-surface-border/70 border-b last:border-0">
						<td class="px-4 py-3">
							<p class="text-text-primary">{exec.supporterName}</p>
							<p class="text-text-tertiary text-xs">{exec.supporterEmail}</p>
						</td>
						<td class="px-4 py-3">
							<span
								aria-label={exec.status === 'partial_no_op'
									? 'partial no-op: unsupported step boundary'
									: (statusLabels[exec.status] ?? exec.status)}
								class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {statusColors[
									exec.status
								] ?? 'bg-surface-border-strong text-text-secondary'}"
							>
								{statusLabels[exec.status] ?? exec.status}
							</span>
							{#if boundary}
								<p
									class="mt-1 max-w-64 text-xs leading-snug {executionBoundaryClass(exec)}"
									title={boundary}
								>
									{boundary}
								</p>
							{/if}
						</td>
						<td class="text-text-secondary px-4 py-3">{exec.currentStep}</td>
						<td class="text-text-tertiary px-4 py-3">{formatDate(exec.createdAt)}</td>
						<td class="text-text-tertiary px-4 py-3">
							{exec.completedAt ? formatDate(exec.completedAt) : '-'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
