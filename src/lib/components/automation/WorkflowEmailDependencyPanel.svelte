<!--
	Shown beside workflow surfaces that carry email steps. When the email
	infrastructure isn't connected, it renders the one plain-language limit
	sentence (with operator detail collapsed); when email delivery is ready,
	it renders nothing — the steps just run.
-->
<script lang="ts">
	import BoundedNotice from '$lib/components/org/BoundedNotice.svelte';
	import { workflowEmailLimitNotice } from '$lib/data/org-limit-sentences';

	type WorkflowEmailReadiness = {
		ready: boolean;
		missing: string[];
		dependency: string;
		perRunDependencies: string[];
		message: string;
	};

	let {
		emailStepCount,
		readiness,
		workflowSaved = false,
		id = 'workflow-email-dependency-boundary'
	}: {
		emailStepCount: number;
		readiness: WorkflowEmailReadiness;
		/** Whether a saved workflow actually exists; gates the preserved-artifact reassurance. */
		workflowSaved?: boolean;
		id?: string;
	} = $props();

	const notice = $derived(workflowEmailLimitNotice(readiness, { artifactExists: workflowSaved }));
</script>

{#if emailStepCount > 0 && !readiness.ready}
	<div {id} class="border-surface-border bg-surface-base my-6 rounded-md border px-4 py-3">
		<BoundedNotice {notice} />
	</div>
{/if}
