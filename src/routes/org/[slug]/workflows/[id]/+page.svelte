<script lang="ts">
	import ExecutionTable from '$lib/components/automation/ExecutionTable.svelte';
	import WorkflowEmailDependencyPanel from '$lib/components/automation/WorkflowEmailDependencyPanel.svelte';
	import { FEATURES } from '$lib/config/features';
	import { TRIGGER_LABELS, STEP_LABELS } from '$lib/config/workflow-labels';
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let toggling = $state(false);
	let deleting = $state(false);
	let errorMsg = $state('');

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

	const emailStepCount = $derived(
		data.workflow.steps.filter((step) => step.type === 'send_email').length
	);
	const workflowStatusLabel = $derived(data.workflow.enabled ? 'enabled' : 'draft');
	const workflowStatusClass = $derived(
		data.workflow.enabled
			? 'bg-green-900/50 text-green-400'
			: 'bg-surface-border-strong text-text-secondary'
	);
	const workflowToggleLabel = $derived(data.workflow.enabled ? 'Disable' : 'Enable');
	const partialNoOpRunCount = $derived(
		data.executions.filter((execution) => execution.status === 'partial_no_op').length
	);
	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(iso));
	}

	function stepSummary(step: { type: string; [key: string]: unknown }): string {
		const label = STEP_LABELS[step.type] ?? step.type;
		// Reads backend field names (emailSubject, delayMinutes, thenStepIndex) —
		// source of truth is convex/workflows.ts step shape.
		if (!FEATURES.WORKFLOW_EXECUTION) {
			if (step.type === 'send_email' && step.emailSubject) {
				return `Draft email step: "${step.emailSubject}"`;
			}
			if (step.type === 'add_tag') return 'Draft tag-write step';
			if (step.type === 'remove_tag') return 'Draft tag-removal step';
			if (step.type === 'condition' && step.field) {
				return `Draft branch condition: ${step.field} ${step.operator} ${step.value}`;
			}
		}
		if (step.type === 'send_email' && step.emailSubject) return `${label}: "${step.emailSubject}"`;
		if (step.type === 'delay' && step.delayMinutes) return `${label}: ${step.delayMinutes} min`;
		if (step.type === 'condition' && step.field)
			return `${label}: ${step.field} ${step.operator} ${step.value}`;
		return label;
	}

	async function toggleEnabled() {
		toggling = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/org/${data.org.slug}/workflows/${data.workflow.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !data.workflow.enabled })
			});
			if (res.ok) {
				window.location.reload();
			} else {
				const body = await res.json().catch(() => null);
				errorMsg = body?.message ?? body?.error ?? `Failed to update (${res.status})`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			toggling = false;
		}
	}

	async function deleteWorkflow() {
		if (!confirm('Delete this workflow? This cannot be undone.')) return;
		deleting = true;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/workflows/${data.workflow.id}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				window.location.href = `/org/${data.org.slug}/workflows`;
			}
		} catch {
			/* ignore */
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head>
	<title>{data.workflow.name} | Workflows | {data.org.name}</title>
</svelte:head>

<div id="coordination-logic-detail" class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<a
			href="/org/{data.org.slug}/workflows"
			class="text-text-tertiary hover:text-text-primary mb-6 inline-block text-sm"
		>
			&larr; Workflows
		</a>

		<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
			<div>
				<div class="mb-2 flex items-center gap-3">
					<h1 class="text-text-primary text-2xl font-bold">{data.workflow.name}</h1>
					<span class="rounded-full px-2.5 py-0.5 text-xs font-medium {workflowStatusClass}">
						{workflowStatusLabel}
					</span>
				</div>
				{#if data.workflow.description}
					<p class="text-text-tertiary text-sm">{data.workflow.description}</p>
				{/if}
				<p class="text-text-tertiary mt-1 text-sm">Created {formatDate(data.workflow.createdAt)}</p>
			</div>

			<div class="flex gap-2">
				<button
					onclick={toggleEnabled}
					disabled={toggling}
					class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
				>
					{workflowToggleLabel}
				</button>
				<button
					onclick={deleteWorkflow}
					disabled={deleting}
					class="rounded-lg border border-red-800/60 px-3 py-1.5 text-sm text-red-400 hover:border-red-600 hover:text-red-300 disabled:opacity-50"
				>
					Delete
				</button>
			</div>
		</div>

		{#if errorMsg}
			<div
				class="my-6 rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400"
			>
				{errorMsg}
			</div>
		{/if}

		<WorkflowEmailDependencyPanel {emailStepCount} readiness={data.workflowEmailReadiness} />

		<div
			id="coordination-trigger"
			class="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
		>
			<div class="border-surface-border rounded-lg border p-4">
				<p class="text-text-tertiary text-xs font-medium">Trigger</p>
				<p class="text-text-primary mt-1 text-lg font-bold">
					{TRIGGER_LABELS[data.workflow.trigger.type] ?? data.workflow.trigger.type}
				</p>
			</div>
			<div class="border-surface-border rounded-lg border p-4">
				<p class="text-text-tertiary text-xs font-medium">Scope</p>
				<p
					class="text-text-primary mt-1 truncate text-lg font-bold"
					title={triggerScopeLabel(data.workflow.trigger)}
				>
					{triggerScopeLabel(data.workflow.trigger)}
				</p>
			</div>
			<div class="border-surface-border rounded-lg border p-4">
				<p class="text-text-tertiary text-xs font-medium">Steps</p>
				<p class="text-text-primary mt-1 text-lg font-bold">{data.workflow.steps.length}</p>
			</div>
			<div class="border-surface-border rounded-lg border p-4">
				<p class="text-text-tertiary text-xs font-medium">Runs</p>
				<p class="text-text-primary mt-1 text-lg font-bold">{data.workflow.totalExecutions}</p>
			</div>
		</div>

		<div id="coordination-definition" class="border-surface-border mb-6 rounded-lg border p-4">
			<h3 class="text-text-tertiary mb-3 text-sm font-medium">Steps</h3>
			{#if data.workflow.steps.length === 0}
				<p class="text-text-tertiary py-4 text-center text-sm">No steps defined</p>
			{:else}
				<div class="space-y-2">
					{#each data.workflow.steps as step, i (i)}
						<div class="bg-surface-base flex items-center gap-3 rounded-lg px-3 py-2">
							<span class="text-text-tertiary shrink-0 text-xs font-medium">{i + 1}</span>
							<span class="text-text-primary text-sm">{stepSummary(step)}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div id="coordination-run-log">
			<h3 class="text-text-tertiary mb-3 text-sm font-medium">
				Run log ({data.workflow.totalExecutions})
			</h3>
			{#if partialNoOpRunCount > 0}
				<div
					class="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3"
					aria-label="Runs with skipped steps"
				>
					<div class="flex flex-wrap items-baseline justify-between gap-3">
						<p class="text-sm font-medium text-amber-300">Some steps were skipped</p>
						<p class="text-text-secondary flex items-baseline gap-1 text-xs">
							<Datum value={partialNoOpRunCount} />
							<span>runs with skipped steps</span>
						</p>
					</div>
					<p class="text-text-tertiary mt-1 text-sm leading-relaxed">
						These runs finished, but one or more older step types were skipped. Review the
						workflow's steps before counting these as complete runs.
					</p>
				</div>
			{/if}
			<ExecutionTable executions={data.executions} />
		</div>
	</div>
</div>
