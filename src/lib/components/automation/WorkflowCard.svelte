<script lang="ts">
	import { FEATURES } from '$lib/config/features';
	import { TRIGGER_LABELS } from '$lib/config/workflow-labels';

	let {
		workflow
	}: {
		workflow: {
			id: string;
			name: string;
			description: string | null;
			trigger: { type: string; tagId?: string; campaignId?: string; eventId?: string };
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

	function triggerScopeLabel(trigger: {
		type: string;
		tagId?: string;
		campaignId?: string;
		eventId?: string;
	}): string {
		if (trigger.type === 'tag_added') return trigger.tagId ? `Tag ${trigger.tagId}` : 'All tags';
		if (trigger.type === 'campaign_action') {
			return trigger.campaignId ? `Action ${trigger.campaignId}` : 'All action responses';
		}
		if (trigger.type === 'event_rsvp' || trigger.type === 'event_checkin') {
			return trigger.eventId ? `Event ${trigger.eventId}` : 'All event records';
		}
		if (trigger.type === 'donation_completed') {
			return trigger.campaignId ? `Funding ${trigger.campaignId}` : 'All completed donations';
		}
		return 'All matching events';
	}

	function workflowStatusLabel(): string {
		if (!workflow.enabled) return 'draft';
		return FEATURES.WORKFLOW_EXECUTION ? 'runner enabled' : 'enabled draft';
	}

	function workflowStatusClass(): string {
		if (!workflow.enabled) return 'bg-surface-border-strong text-text-secondary';
		return FEATURES.WORKFLOW_EXECUTION
			? 'bg-green-900/50 text-green-400'
			: 'bg-amber-500/15 text-amber-300';
	}
</script>

<div
	class="border-surface-border hover:border-surface-border-strong rounded-lg border p-4 transition-colors"
>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<div class="mb-1 flex items-center gap-2">
				<h3 class="text-text-primary truncate text-base font-semibold">{workflow.name}</h3>
				<span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium {workflowStatusClass()}">
					{workflowStatusLabel()}
				</span>
			</div>

			{#if workflow.description}
				<p class="text-text-secondary mb-1 truncate text-sm">{workflow.description}</p>
			{/if}

			<p class="text-text-tertiary text-sm">{formatDate(workflow.createdAt)}</p>
		</div>

		<div class="shrink-0 text-right">
			<p class="text-text-secondary text-sm font-medium">
				{TRIGGER_LABELS[workflow.trigger.type] ?? workflow.trigger.type}
			</p>
			<p
				class="text-text-quaternary mt-0.5 max-w-48 truncate text-xs"
				title={triggerScopeLabel(workflow.trigger)}
			>
				{triggerScopeLabel(workflow.trigger)}
			</p>
			<p class="text-text-tertiary mt-0.5 text-xs">
				{workflow.stepCount}
				{workflow.stepCount === 1 ? 'step' : 'steps'} &middot;
				{workflow.executionCount}
				{workflow.executionCount === 1 ? 'run record' : 'run records'}
			</p>
		</div>
	</div>
</div>
