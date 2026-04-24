<script lang="ts">
	import ExecutionTable from '$lib/components/automation/ExecutionTable.svelte';
	import { TRIGGER_LABELS, STEP_LABELS } from '$lib/config/workflow-labels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let toggling = $state(false);
	let deleting = $state(false);

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
		if (step.type === 'send_email' && step.emailSubject) return `${label}: "${step.emailSubject}"`;
		if (step.type === 'delay' && step.delayMinutes) return `${label}: ${step.delayMinutes} min`;
		if (step.type === 'condition' && step.field) return `${label}: ${step.field} ${step.operator} ${step.value}`;
		return label;
	}

	async function toggleEnabled() {
		toggling = true;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/workflows/${data.workflow.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !data.workflow.enabled })
			});
			if (res.ok) {
				window.location.reload();
			}
		} catch {
			/* ignore */
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
	<title>{data.workflow.name} | {data.org.name}</title>
</svelte:head>

<div class="min-h-screen bg-surface-raised text-text-primary">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<!-- Back link -->
		<a href="/org/{data.org.slug}/workflows" class="mb-6 inline-block text-sm text-text-tertiary hover:text-text-primary">
			&larr; All Workflows
		</a>

		<!-- Header -->
		<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
			<div>
				<div class="mb-2 flex items-center gap-3">
					<h1 class="text-2xl font-bold text-text-primary">{data.workflow.name}</h1>
					<span class="rounded-full px-2.5 py-0.5 text-xs font-medium {data.workflow.enabled ? 'bg-green-900/50 text-green-400' : 'bg-surface-border-strong text-text-secondary'}">
						{data.workflow.enabled ? 'Enabled' : 'Disabled'}
					</span>
				</div>
				{#if data.workflow.description}
					<p class="text-sm text-text-tertiary">{data.workflow.description}</p>
				{/if}
				<p class="mt-1 text-sm text-text-tertiary">Created {formatDate(data.workflow.createdAt)}</p>
			</div>

			<!-- Actions -->
			<div class="flex gap-2">
				<button
					onclick={toggleEnabled}
					disabled={toggling}
					class="rounded-lg border border-surface-border-strong px-3 py-1.5 text-sm text-text-secondary hover:border-text-tertiary hover:text-text-primary disabled:opacity-50"
				>
					{data.workflow.enabled ? 'Disable' : 'Enable'}
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

		<!-- Metrics -->
		<div class="mb-6 grid grid-cols-3 gap-3">
			<div class="rounded-lg border border-surface-border p-4">
				<p class="text-xs font-medium text-text-tertiary">Trigger</p>
				<p class="mt-1 text-lg font-bold text-text-primary">{TRIGGER_LABELS[data.workflow.trigger.type] ?? data.workflow.trigger.type}</p>
			</div>
			<div class="rounded-lg border border-surface-border p-4">
				<p class="text-xs font-medium text-text-tertiary">Steps</p>
				<p class="mt-1 text-lg font-bold text-text-primary">{data.workflow.steps.length}</p>
			</div>
			<div class="rounded-lg border border-surface-border p-4">
				<p class="text-xs font-medium text-text-tertiary">Executions</p>
				<p class="mt-1 text-lg font-bold text-text-primary">{data.workflow.totalExecutions}</p>
			</div>
		</div>

		<!-- Steps -->
		<div class="mb-6 rounded-lg border border-surface-border p-4">
			<h3 class="mb-3 text-sm font-medium text-text-tertiary">Steps</h3>
			{#if data.workflow.steps.length === 0}
				<p class="py-4 text-center text-sm text-text-tertiary">No steps defined</p>
			{:else}
				<div class="space-y-2">
					{#each data.workflow.steps as step, i (i)}
						<div class="flex items-center gap-3 rounded-lg bg-surface-base px-3 py-2">
							<span class="shrink-0 text-xs font-medium text-text-tertiary">{i + 1}</span>
							<span class="text-sm text-text-primary">{stepSummary(step)}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Executions -->
		<div>
			<h3 class="mb-3 text-sm font-medium text-text-tertiary">Recent Executions ({data.workflow.totalExecutions})</h3>
			<ExecutionTable executions={data.executions} />
		</div>
	</div>
</div>
