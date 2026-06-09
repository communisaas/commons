<script lang="ts">
	import { Datum } from '$lib/design';

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
		cite,
		id = 'workflow-email-dependency-boundary'
	}: {
		emailStepCount: number;
		readiness: WorkflowEmailReadiness;
		cite: string;
		id?: string;
	} = $props();

	const state = $derived(
		emailStepCount > 0 ? (readiness.ready ? 'partial' : 'gated') : 'draft-only'
	);
	const missingText = $derived(
		readiness.missing.length > 0 ? readiness.missing.join(', ') : 'arm-time runtime ready'
	);
	const perRunText = $derived(readiness.perRunDependencies.join(', '));
	const panelClass = $derived(
		state === 'partial'
			? 'border-blue-500/30 bg-blue-500/10'
			: state === 'gated'
				? 'border-amber-500/30 bg-amber-500/10'
				: 'border-surface-border bg-surface-overlay'
	);
</script>

<div
	{id}
	class="my-6 rounded-md border {panelClass} px-4 py-3"
	aria-label="Workflow email dependency boundary"
>
	<div class="flex flex-wrap items-baseline justify-between gap-3">
		<p class="text-sm font-medium {state === 'gated' ? 'text-amber-300' : 'text-blue-300'}">
			Workflow email dependency boundary
		</p>
		<p class="text-text-secondary flex items-baseline gap-1 text-xs">
			<Datum value={emailStepCount} {cite} />
			<span>{emailStepCount === 1 ? 'email step' : 'email steps'}</span>
		</p>
	</div>
	<p class="text-text-tertiary mt-1 text-sm leading-relaxed">
		{#if emailStepCount === 0}
			No workflow email steps are loaded on this surface; email dependency does not arm or block
			this definition.
		{:else if readiness.ready}
			Email-bearing workflow enablement can pass the arm-time runtime check. Delivery still stays
			per-run bounded by {perRunText}.
		{:else}
			Email-bearing workflows stay saved but cannot be enabled for delivery. Enable attempts return
			workflow_email_dependency_missing until {missingText} clears; non-email trigger, tag, branch, and
			delay side effects remain separate.
		{/if}
	</p>
	<div class="mt-3 grid gap-2 text-xs md:grid-cols-3">
		<div>
			<p class="text-text-quaternary font-mono tracking-[0.14em] uppercase">Arm-time dependency</p>
			<p class="text-text-secondary mt-1 leading-relaxed">{readiness.dependency}</p>
		</div>
		<div>
			<p class="text-text-quaternary font-mono tracking-[0.14em] uppercase">Missing now</p>
			<p class="text-text-secondary mt-1 leading-relaxed">{missingText}</p>
		</div>
		<div>
			<p class="text-text-quaternary font-mono tracking-[0.14em] uppercase">Per-run checks</p>
			<p class="text-text-secondary mt-1 leading-relaxed">{perRunText}</p>
		</div>
	</div>
</div>
