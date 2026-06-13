<script lang="ts">
	import CallLogTable from '$lib/components/sms/CallLogTable.svelte';
	import BoundedNotice from '$lib/components/org/BoundedNotice.svelte';
	import { callRoutingLimitNotice } from '$lib/data/org-limit-sentences';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let statusFilter = $state('');

	const filteredCalls = $derived(
		statusFilter ? data.calls.filter((c) => c.status === statusFilter) : data.calls
	);
	const callCount = $derived(data.calls.length);
	const completedCallCount = $derived(
		data.calls.filter((call) => call.status === 'completed').length
	);
	const callLimitNotice = $derived(
		data.callInitiationRuntimeReady
			? null
			: callRoutingLimitNotice({
					initiationRuntimeMissing: data.callInitiationRuntimeMissing,
					initiationRuntimeDependency: data.callInitiationRuntimeDependency,
					initiationRuntimeMessage: data.callInitiationRuntimeMessage
				})
	);
</script>

<svelte:head>
	<title>Calls | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<div>
			<h1 class="text-text-primary text-xl font-semibold">Calls</h1>
			<p class="text-text-tertiary mt-2 max-w-2xl text-sm">
				{callCount}
				{callCount === 1 ? 'call record' : 'call records'}, {completedCallCount} completed.
			</p>
		</div>

		{#if callLimitNotice}
			<BoundedNotice notice={callLimitNotice} />
		{/if}

		<div class="space-y-3">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h2 class="text-text-tertiary text-sm font-medium">Call records</h2>
				<select
					bind:value={statusFilter}
					class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary rounded-md border px-3 py-2 text-sm focus:outline-none"
					aria-label="Filter call records by status"
				>
					<option value="">All statuses</option>
					<option value="initiated">Initiated</option>
					<option value="ringing">Ringing</option>
					<option value="in-progress">In progress</option>
					<option value="completed">Completed</option>
					<option value="failed">Failed</option>
					<option value="no-answer">No answer</option>
					<option value="busy">Busy</option>
				</select>
			</div>
			<CallLogTable calls={filteredCalls} />
		</div>
	</div>
</div>
