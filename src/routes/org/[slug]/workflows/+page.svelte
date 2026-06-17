<script lang="ts">
	import WorkflowCard from '$lib/components/automation/WorkflowCard.svelte';
	import WorkflowEmailDependencyPanel from '$lib/components/automation/WorkflowEmailDependencyPanel.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const definitionCount = $derived(data.workflows.length);
	const enabledFlagCount = $derived(data.workflows.filter((workflow) => workflow.enabled).length);
	const emailStepCount = $derived(
		data.workflows.reduce((sum, workflow) => sum + workflow.emailStepCount, 0)
	);
</script>

<svelte:head>
	<title>Workflows | {data.org.name}</title>
</svelte:head>

<div id="coordination-logic" class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<div class="mb-8 flex items-center justify-between">
			<div>
				<h1 class="text-text-primary text-2xl font-bold">Workflows</h1>
				<p class="text-text-tertiary mt-1 text-sm">
					{definitionCount}
					{definitionCount === 1 ? 'workflow' : 'workflows'} · {enabledFlagCount} enabled
				</p>
			</div>
			<a
				href="/org/{data.org.slug}/workflows/new"
				class="bg-surface-overlay text-text-primary hover:bg-surface-base rounded-md px-4 py-2 text-sm font-semibold"
			>
				Create workflow
			</a>
		</div>

		<WorkflowEmailDependencyPanel
			{emailStepCount}
			readiness={data.workflowEmailReadiness}
			workflowSaved={data.workflows.length > 0}
		/>

		{#if data.workflows.length === 0}
			<div class="border-surface-border rounded-md border py-16 text-center">
				<p class="text-text-tertiary text-lg">No workflows yet.</p>
				<p class="text-text-tertiary mt-1 text-sm">
					Create a workflow to tag, branch, wait, and email automatically when people act.
				</p>
				<a
					href="/org/{data.org.slug}/workflows/new"
					class="bg-surface-overlay text-text-primary hover:bg-surface-base mt-4 inline-block rounded-md px-4 py-2 text-sm font-semibold"
				>
					Create workflow
				</a>
			</div>
		{:else}
			<div id="coordination-definitions" class="space-y-3">
				{#each data.workflows as workflow (workflow.id)}
					<a href="/org/{data.org.slug}/workflows/{workflow.id}" class="block">
						<WorkflowCard {workflow} />
					</a>
				{/each}
			</div>
		{/if}
	</div>
</div>
