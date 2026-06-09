<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import ExecutionTable from '$lib/components/automation/ExecutionTable.svelte';
	import WorkflowEmailDependencyPanel from '$lib/components/automation/WorkflowEmailDependencyPanel.svelte';
	import { FEATURES } from '$lib/config/features';
	import { TRIGGER_LABELS, STEP_LABELS } from '$lib/config/workflow-labels';
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

	let toggling = $state(false);
	let deleting = $state(false);
	let errorMsg = $state('');

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
	const tagWriteStepCount = $derived(
		data.workflow.steps.filter((step) => ['add_tag', 'remove_tag'].includes(step.type)).length
	);
	const conditionStepCount = $derived(
		data.workflow.steps.filter((step) => step.type === 'condition').length
	);
	const hasEmailSteps = $derived(emailStepCount > 0);
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
				definitionCount: 1,
				enabledCount: data.workflow.enabled ? 1 : 0,
				triggerFamilyCount: 1,
				plannedStepCount: data.workflow.steps.length,
				emailStepCount,
				tagStepCount: tagWriteStepCount,
				conditionStepCount,
				runEvidenceCount: data.workflow.totalExecutions
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
	const workflowStatusLabel = $derived(
		data.workflow.enabled ? (workflowRunnerArmed ? 'runner enabled' : 'enabled draft') : 'draft'
	);
	const workflowStatusClass = $derived(
		data.workflow.enabled
			? workflowRunnerArmed
				? 'bg-green-900/50 text-green-400'
				: 'bg-amber-500/15 text-amber-300'
			: 'bg-surface-border-strong text-text-secondary'
	);
	const workflowToggleLabel = $derived(
		data.workflow.enabled ? 'Disable' : workflowRunnerArmed ? 'Enable runner' : 'Enable draft'
	);
	const partialNoOpRunCount = $derived(
		data.executions.filter((execution) => execution.status === 'partial_no_op').length
	);
	const coordinationRows = $derived<CoordinationReadinessRow[]>(
		coordinationReadiness.rows.map((row) => ({
			...row,
			href:
				row.id === 'coordination-definitions'
					? '#coordination-definition'
					: row.id === 'trigger-dispatch-contracts'
						? '#coordination-trigger'
						: row.id === 'step-grammar'
							? '#coordination-definition'
							: row.id === 'side-effect-runner'
								? '#coordination-execution-status'
								: row.id === 'run-evidence'
									? '#coordination-run-log'
									: row.href
		}))
	);
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
			href: definitionCoordinationRow?.href ?? '#coordination-definition',
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
			href: sideEffectCoordinationRow?.href ?? '#coordination-execution-status',
			metric: sideEffectCoordinationRow?.metric ?? {
				value: data.workflow.enabled ? 1 : 0,
				label: 'enabled flags',
				cite: 'workflow.enabled'
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
			href: nextRunLiftCoordinationRow?.href ?? '#coordination-run-log',
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
		if (!confirm('Delete this coordination draft? This cannot be undone.')) return;
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
	<title>{data.workflow.name} | Coordination Logic | {data.org.name}</title>
</svelte:head>

<div id="coordination-logic-detail" class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<a
			href="/org/{data.org.slug}/workflows"
			class="text-text-tertiary hover:text-text-primary mb-6 inline-block text-sm"
		>
			&larr; Coordination logic
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

		<WorkspaceCapabilityStrip label="Coordination detail capability" items={capabilityItems} />

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

		{#if errorMsg}
			<div
				class="my-6 rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400"
			>
				{errorMsg}
			</div>
		{/if}

		<div
			id="coordination-execution-status"
			class="my-6 rounded-md border {workflowRunnerArmed
				? 'border-green-600/30 bg-green-900/10'
				: 'border-amber-500/30 bg-amber-500/10'} px-4 py-3"
		>
			<p class="text-sm font-medium {workflowRunnerArmed ? 'text-green-300' : 'text-amber-300'}">
				{workflowRunnerArmed
					? 'Bounded coordination runner is armed'
					: 'Coordination execution is not armed'}
			</p>
			<p class="text-text-tertiary mt-1 text-sm">
				{#if workflowRunnerArmed}
					Enabled workflows can run trigger dispatch, tag writes/removals, branch conditions, and
					scheduled delay/resume. {#if hasEmailSteps}This definition has email steps, so enabling
						also requires SES credentials, a configured workflow/from address, and org-key verifier;
						each email run then requires a supporter cursor and subscribed supporter.{:else}This
						definition has no email steps, so it can enable through the runner without the email
						proxy dependency.{/if}
				{:else}
					This definition is saved. Tag writes, branch conditions, scheduled resume, and saved
					trigger families stay preserved contracts until the execution gate opens. Workflow email
					stays dependency-first behind SES, configured workflow/from address, org-key verifier,
					supporter cursor, and subscribed-supporter checks.
				{/if}
			</p>
		</div>

		{#if hasEmailSteps}
			<WorkflowEmailDependencyPanel
				{emailStepCount}
				readiness={data.workflowEmailReadiness}
				cite="workflow.steps.type.send_email"
			/>
		{/if}

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
				<p class="text-text-tertiary text-xs font-medium">Draft steps</p>
				<p class="text-text-primary mt-1 text-lg font-bold">{data.workflow.steps.length}</p>
			</div>
			<div class="border-surface-border rounded-lg border p-4">
				<p class="text-text-tertiary text-xs font-medium">Run records</p>
				<p class="text-text-primary mt-1 text-lg font-bold">{data.workflow.totalExecutions}</p>
			</div>
		</div>

		<div id="coordination-definition" class="border-surface-border mb-6 rounded-lg border p-4">
			<h3 class="text-text-tertiary mb-3 text-sm font-medium">Step grammar</h3>
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
					aria-label="Unsupported step boundary"
				>
					<div class="flex flex-wrap items-baseline justify-between gap-3">
						<p class="text-sm font-medium text-amber-300">Unsupported step boundary</p>
						<p class="text-text-secondary flex items-baseline gap-1 text-xs">
							<Datum value={partialNoOpRunCount} cite="workflowExecutions.status.partial_no_op" />
							<span>partial no-op runs</span>
						</p>
					</div>
					<p class="text-text-tertiary mt-1 text-sm leading-relaxed">
						These runs completed with unsupported legacy steps audited as no-ops. Treat them as
						boundary evidence, not clean coordination completion, until the definition is inspected
						and replayed through supported step grammar.
					</p>
				</div>
			{/if}
			<ExecutionTable executions={data.executions} />
		</div>
	</div>
</div>
