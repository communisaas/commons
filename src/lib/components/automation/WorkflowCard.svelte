<script lang="ts">
	import { TRIGGER_LABELS } from '$lib/config/workflow-labels';

	let { workflow }: {
		workflow: {
			id: string;
			name: string;
			description: string | null;
			trigger: { type: string; tagId?: string; campaignId?: string };
			stepCount: number;
			enabled: boolean;
			executionCount: number;
			createdAt: string;
		};
	} = $props();

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(iso));
	}
</script>

<div class="rounded-lg border border-zinc-800/60 p-4 transition-colors hover:border-zinc-700">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<div class="mb-1 flex items-center gap-2">
				<h3 class="truncate text-base font-semibold text-zinc-100">{workflow.name}</h3>
				<span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium {workflow.enabled ? 'bg-green-900/50 text-green-400' : 'bg-zinc-700 text-zinc-300'}">
					{workflow.enabled ? 'Enabled' : 'Disabled'}
				</span>
			</div>

			{#if workflow.description}
				<p class="mb-1 truncate text-sm text-zinc-400">{workflow.description}</p>
			{/if}

			<p class="text-sm text-zinc-500">{formatDate(workflow.createdAt)}</p>
		</div>

		<div class="shrink-0 text-right">
			<p class="text-sm font-medium text-zinc-300">{TRIGGER_LABELS[workflow.trigger.type] ?? workflow.trigger.type}</p>
			<p class="mt-0.5 text-xs text-zinc-500">
				{workflow.stepCount} {workflow.stepCount === 1 ? 'step' : 'steps'} &middot;
				{workflow.executionCount} {workflow.executionCount === 1 ? 'run' : 'runs'}
			</p>
		</div>
	</div>
</div>
