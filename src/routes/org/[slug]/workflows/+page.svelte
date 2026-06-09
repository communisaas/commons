<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import WorkflowCard from '$lib/components/automation/WorkflowCard.svelte';
	import WorkflowEmailDependencyPanel from '$lib/components/automation/WorkflowEmailDependencyPanel.svelte';
	import { FEATURES } from '$lib/config/features';
	import { Datum } from '$lib/design';
	import {
		buildCoordinationReadiness,
		getGateEvidence,
		type CapabilityState,
		type CoordinationReadinessRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type CapabilityItem = {
		label: string;
		state: CapabilityState;
		phase: string;
		cluster: string;
		action: string;
		detail: string;
		unlock: string;
		href: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};
	type CoordinationPressureReadout = {
		id: string;
		label: string;
		state: CapabilityState;
		title: string;
		action: string;
		detail: string;
		gate: string;
		href: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	const definitionCount = $derived(data.workflows.length);
	const plannedStepCount = $derived(
		data.workflows.reduce((sum, workflow) => sum + workflow.stepCount, 0)
	);
	const runEvidenceCount = $derived(
		data.workflows.reduce((sum, workflow) => sum + workflow.executionCount, 0)
	);
	const enabledFlagCount = $derived(data.workflows.filter((workflow) => workflow.enabled).length);
	const triggerFamilyCount = $derived(
		new Set(data.workflows.map((workflow) => workflow.trigger.type)).size
	);
	const emailStepCount = $derived(
		data.workflows.reduce((sum, workflow) => sum + workflow.emailStepCount, 0)
	);
	const tagStepCount = $derived(
		data.workflows.reduce((sum, workflow) => sum + workflow.tagStepCount, 0)
	);
	const conditionStepCount = $derived(
		data.workflows.reduce((sum, workflow) => sum + workflow.conditionStepCount, 0)
	);
	const workflowEffectsGate = getGateEvidence('CP-workflow-effects', ['T1-9a'], {
		name: 'Bounded workflow runner',
		downstream: 1,
		dependency: 'Trigger dispatch + tag/branch/delay runner'
	});
	const workflowRunEvidenceGate = getGateEvidence('CP-coordination-integrity', ['T10-10'], {
		name: 'Workflow run evidence',
		downstream: 1,
		dependency: 'Execution records + packet-local coordination metrics'
	});
	const emailProxyGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Email send proxy',
		dependency: 'AWS Lambda deploy + BLAST receipts secret sync'
	});
	const coordinationReadiness = $derived(
		buildCoordinationReadiness({
			base: `/org/${data.org.slug}`,
			coordination: {
				enabled: FEATURES.AUTOMATION,
				executionEnabled: FEATURES.WORKFLOW_EXECUTION,
				loaded: true,
				definitionCount,
				enabledCount: enabledFlagCount,
				triggerFamilyCount,
				plannedStepCount,
				emailStepCount,
				tagStepCount,
				conditionStepCount,
				runEvidenceCount
			},
			gates: {
				workflowEffectsGate,
				workflowRunEvidenceGate,
				emailProxyGate
			}
		})
	);
	const workflowRunnerArmed = $derived(
		FEATURES.WORKFLOW_EXECUTION && workflowEffectsGate.state === 'live'
	);
	const coordinationRows = $derived<CoordinationReadinessRow[]>(coordinationReadiness.rows);
	const definitionCoordinationRow = $derived(
		coordinationRows.find((row) => row.id === 'coordination-definitions') ?? null
	);
	const sideEffectCoordinationRow = $derived(
		coordinationRows.find((row) => row.id === 'side-effect-runner') ?? null
	);
	const runEvidenceCoordinationRow = $derived(
		coordinationRows.find((row) => row.id === 'run-evidence') ?? null
	);
	const heldCoordinationRows = $derived(
		coordinationRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const firstHeldCoordinationRow = $derived(
		heldCoordinationRows.find(
			(row) => row.id !== 'coordination-definitions' && row.id !== 'side-effect-runner'
		) ??
			heldCoordinationRows[0] ??
			null
	);
	const nextRunLiftCoordinationRow = $derived(
		(runEvidenceCoordinationRow &&
		(runEvidenceCoordinationRow.state === 'draft-only' ||
			runEvidenceCoordinationRow.state === 'gated')
			? runEvidenceCoordinationRow
			: null) ??
			firstHeldCoordinationRow ??
			runEvidenceCoordinationRow ??
			sideEffectCoordinationRow
	);
	const coordinationPressureReadouts = $derived<CoordinationPressureReadout[]>([
		{
			id: 'definition-ground',
			label: 'Definition ground',
			state: definitionCoordinationRow?.state ?? coordinationReadiness.state,
			title: definitionCoordinationRow?.handoff ?? coordinationReadiness.handoff,
			action: definitionCoordinationRow?.action ?? coordinationReadiness.action,
			detail: definitionCoordinationRow?.ground ?? coordinationReadiness.signal,
			gate: definitionCoordinationRow?.boundary ?? coordinationReadiness.gate,
			href: definitionCoordinationRow?.href ?? '#coordination-definitions',
			metric: definitionCoordinationRow?.metric ?? coordinationReadiness.metric
		},
		{
			id: 'side-effect-runner',
			label: 'Side-effect runner',
			state: sideEffectCoordinationRow?.state ?? coordinationReadiness.state,
			title: sideEffectCoordinationRow?.handoff ?? 'Workflow execution',
			action: sideEffectCoordinationRow?.action ?? 'read execution boundary',
			detail:
				sideEffectCoordinationRow?.ground ??
				'Definitions are preserved; side effects stay dependency-first until the runner clears.',
			gate: sideEffectCoordinationRow?.boundary ?? coordinationReadiness.gate,
			href: sideEffectCoordinationRow?.href ?? '#workflow-execution-boundary',
			metric: sideEffectCoordinationRow?.metric ?? {
				value: enabledFlagCount,
				label: 'enabled flags',
				cite: 'workflows.list enabled'
			}
		},
		{
			id: 'next-run-lift',
			label: 'Next run lift',
			state: nextRunLiftCoordinationRow?.state ?? coordinationReadiness.state,
			title: nextRunLiftCoordinationRow?.handoff ?? coordinationReadiness.nextGate.name,
			action: nextRunLiftCoordinationRow?.action ?? 'read run boundary',
			detail:
				nextRunLiftCoordinationRow?.ground ??
				'Run evidence, workflow email dependencies, and scheduled side effects stay separate.',
			gate: nextRunLiftCoordinationRow?.boundary ?? coordinationReadiness.gate,
			href: nextRunLiftCoordinationRow?.href ?? '#workflow-execution-boundary',
			metric: nextRunLiftCoordinationRow?.metric ?? {
				value: coordinationReadiness.nextGate.downstream,
				label: 'downstream gates',
				cite: coordinationReadiness.nextGate.id
			}
		}
	]);
	const capabilityItems = $derived<CapabilityItem[]>(
		coordinationRows.map((row) => ({
			label: row.label,
			state: row.state,
			phase: row.phase,
			cluster: row.clusters,
			action: row.action,
			detail: row.ground,
			unlock: row.boundary,
			href: row.href,
			metric: row.metric
		}))
	);

	function stateLabel(state: CapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function actionLabel(state: CapabilityState, action: string): string {
		return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });
	}

	function pressureCellClass(state: CapabilityState): string {
		const stateClass =
			state === 'live'
				? 'border-teal-500/35 bg-teal-500/10'
				: state === 'partial'
					? 'border-blue-500/30 bg-blue-500/10'
					: state === 'draft-only'
						? 'border-amber-500/30 bg-amber-500/10'
						: 'border-surface-border-strong bg-surface-overlay';
		return `rounded-md border p-3 text-left transition hover:border-text-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 ${stateClass}`;
	}
</script>

<svelte:head>
	<title>Coordination Logic | {data.org.name}</title>
</svelte:head>

<div id="coordination-logic" class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<div class="mb-8 flex items-center justify-between">
			<div>
				<h1 class="text-text-primary text-2xl font-bold">Coordination logic</h1>
				<p class="text-text-tertiary mt-1 text-sm">
					{coordinationReadiness.effect}
				</p>
			</div>
			<a
				href="/org/{data.org.slug}/workflows/new"
				class="bg-surface-overlay text-text-primary hover:bg-surface-base rounded-md px-4 py-2 text-sm font-semibold"
			>
				Draft coordination logic
			</a>
		</div>

		<WorkspaceCapabilityStrip label="Coordination logic capability" items={capabilityItems} />

		<div class="mt-4 grid gap-3 md:grid-cols-3" aria-label="Coordination readiness pressure">
			{#each coordinationPressureReadouts as readout (readout.id)}
				<a
					href={readout.href}
					class={pressureCellClass(readout.state)}
					data-sveltekit-preload-data="off"
					aria-label={`${readout.label}: ${stateLabel(readout.state)}; ${readout.detail}; ${readout.gate}`}
				>
					<span
						class="text-text-quaternary block font-mono text-[0.65rem] tracking-[0.18em] uppercase"
						>{readout.label}</span
					>
					<span class="text-text-primary mt-2 block text-sm font-semibold">{readout.title}</span>
					<span class="text-text-secondary mt-2 flex items-baseline gap-1 text-xs">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="text-text-tertiary mt-2 block text-xs leading-relaxed">
						{readout.detail}
					</span>
					<span class="mt-3 block text-xs font-semibold text-teal-300">
						{actionLabel(readout.state, readout.action)}
					</span>
					<span class="text-text-quaternary mt-2 block text-xs leading-relaxed">
						{readout.gate}
					</span>
				</a>
			{/each}
		</div>

		<div
			id="workflow-execution-boundary"
			class="my-6 rounded-md border {workflowRunnerArmed
				? 'border-green-600/30 bg-green-900/10'
				: 'border-amber-500/30 bg-amber-500/10'} px-4 py-3"
		>
			<p class="text-sm font-medium {workflowRunnerArmed ? 'text-green-300' : 'text-amber-300'}">
				{workflowRunnerArmed
					? 'Bounded coordination runner is armed'
					: 'Coordination execution is dependency-first'}
			</p>
			<p class="text-text-tertiary mt-1 text-sm">
				{#if workflowRunnerArmed}
					Definitions can be saved, enabled, and triggered. Tag writes/removals, branch conditions,
					delay/resume, and saved trigger families can execute through the runner; workflow email
					remains dependency-bound. Arming email steps requires SES credentials, a configured
					workflow/from address, and org-key verifier; each email run still requires a supporter
					cursor and subscribed supporter.
				{:else}
					Definitions can be saved and reviewed. Tag writes, branch conditions, scheduled resume,
					and saved trigger families stay preserved contracts until the execution gate opens.
					Workflow email stays dependency-first behind SES, configured workflow/from address,
					org-key verifier, supporter cursor, and subscribed-supporter checks.
				{/if}
			</p>
		</div>

		{#if emailStepCount > 0}
			<WorkflowEmailDependencyPanel
				{emailStepCount}
				readiness={data.workflowEmailReadiness}
				cite="workflows.list steps.type.send_email"
			/>
		{/if}

		{#if data.workflows.length === 0}
			<div class="border-surface-border rounded-md border py-16 text-center">
				<p class="text-text-tertiary text-lg">No coordination drafts yet.</p>
				<p class="text-text-tertiary mt-1 text-sm">
					Draft the logic now; bounded execution is available after save when the runner gate is
					armed.
				</p>
				<a
					href="/org/{data.org.slug}/workflows/new"
					class="bg-surface-overlay text-text-primary hover:bg-surface-base mt-4 inline-block rounded-md px-4 py-2 text-sm font-semibold"
				>
					Draft coordination logic
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
