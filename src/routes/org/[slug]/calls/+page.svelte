<script lang="ts">
	import CallLogTable from '$lib/components/sms/CallLogTable.svelte';
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import {
		buildCallRoutingReadiness,
		getGateEvidence,
		type CallRoutingReadinessRow,
		type CapabilityState
	} from '$lib/data/capability-hypergraph';
	import { Datum } from '$lib/design';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let statusFilter = $state('');

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
	type CallRoutingPressureReadout = {
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

	const filteredCalls = $derived(
		statusFilter ? data.calls.filter((c) => c.status === statusFilter) : data.calls
	);
	const base = $derived(`/org/${data.org.slug}`);
	const callCount = $derived(data.calls.length);
	const completedCallCount = $derived(
		data.calls.filter((call) => call.status === 'completed').length
	);
	const callInitiationGate = getGateEvidence('CP-call-initiation-ui', ['T2-1'], {
		name: 'Patch-through caller phone decrypt',
		downstream: 1,
		dependency: 'Call authority, phone custody, route-local confirmation, and Twilio transport'
	});
	const callRoutingReadiness = $derived(
		buildCallRoutingReadiness({
			base,
			calls: {
				enabled: true,
				loaded: true,
				canManageCalls: data.canManageCalls,
				twilioConfigured: data.twilioConfigured,
				initiationRuntimeReady: data.callInitiationRuntimeReady,
				initiationRuntimeMissing: data.callInitiationRuntimeMissing,
				initiationRuntimeDependency: data.callInitiationRuntimeDependency,
				initiationRuntimeMessage: data.callInitiationRuntimeMessage,
				initiationSurfaceMounted: data.callInitiationSurfaceMounted,
				initiationProxyImplemented: data.callInitiationProxyImplemented,
				callCount,
				completedCallCount,
				campaignCount: data.campaigns.length
			},
			gates: {
				callInitiationGate
			}
		})
	);
	const callRoutingRows = $derived<CallRoutingReadinessRow[]>(callRoutingReadiness.rows);
	const recordHistoryRow = $derived(
		callRoutingRows.find((row) => row.id === 'call-record-history') ?? null
	);
	const initiationRow = $derived(callRoutingRows.find((row) => row.id === 'caller-phone-decrypt'));
	const queueRow = $derived(callRoutingRows.find((row) => row.id === 'phone-banking-workflow'));
	const heldCallRoutingRows = $derived(
		callRoutingRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const nextCallLiftRow = $derived(
		heldCallRoutingRows.find((row) => row.id !== 'caller-phone-decrypt') ??
			heldCallRoutingRows[0] ??
			callRoutingRows.find((row) => row.id === 'twilio-call-bridge') ??
			queueRow ??
			null
	);
	const callRoutingPressureReadouts = $derived<CallRoutingPressureReadout[]>([
		{
			id: 'record-ground',
			label: 'Record ground',
			state: recordHistoryRow?.state ?? callRoutingReadiness.state,
			title: recordHistoryRow?.handoff ?? callRoutingReadiness.handoff,
			action: recordHistoryRow?.action ?? callRoutingReadiness.action,
			detail: recordHistoryRow?.ground ?? callRoutingReadiness.signal,
			gate: recordHistoryRow?.boundary ?? callRoutingReadiness.gate,
			href: recordHistoryRow?.href ?? '#call-history',
			metric: recordHistoryRow?.metric ?? callRoutingReadiness.metric
		},
		{
			id: 'caller-custody',
			label: 'Caller custody',
			state: initiationRow?.state ?? callRoutingReadiness.state,
			title: initiationRow?.handoff ?? 'Caller phone custody',
			action: initiationRow?.action ?? 'read call-initiation boundary',
			detail:
				initiationRow?.ground ??
				'Caller-phone decrypt and route-local connect controls remain dependency-first.',
			gate: initiationRow?.boundary ?? callRoutingReadiness.gate,
			href: initiationRow?.href ?? '#call-initiation-boundary',
			metric: initiationRow?.metric ?? {
				value: data.canManageCalls ? 1 : 0,
				label: 'manager authority',
				cite: 'membership.role'
			}
		},
		{
			id: 'next-call-lift',
			label: 'Next call lift',
			state: nextCallLiftRow?.state ?? callRoutingReadiness.state,
			title: nextCallLiftRow?.handoff ?? callRoutingReadiness.nextGate.name,
			action: nextCallLiftRow?.action ?? 'read call-initiation boundary',
			detail:
				nextCallLiftRow?.ground ??
				'Bridge transport, route-local connect controls, scripts, queues, and proof-bearing response artifacts stay separate.',
			gate: nextCallLiftRow?.boundary ?? callRoutingReadiness.gate,
			href: nextCallLiftRow?.href ?? '#call-queue-boundary',
			metric: nextCallLiftRow?.metric ?? {
				value: callRoutingReadiness.nextGate.downstream,
				label: 'downstream gates',
				cite: callRoutingReadiness.nextGate.id
			}
		}
	]);
	const capabilityItems = $derived<CapabilityItem[]>([
		...callRoutingRows.map((row) => ({
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
	]);

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
	<title>Call routing | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<p class="text-text-quaternary font-mono text-xs tracking-widest uppercase">
					Power / Send boundary
				</p>
				<h1 class="text-text-primary mt-2 text-xl font-semibold">Call routing</h1>
				<p class="text-text-tertiary mt-2 max-w-2xl text-sm">
					{callRoutingReadiness.effect}
				</p>
			</div>

			<a
				href="#call-initiation-boundary"
				class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm transition-colors"
			>
				Read call-initiation boundary
			</a>
		</div>

		<WorkspaceCapabilityStrip label="Call routing capability" items={capabilityItems} />

		<div class="grid gap-3 md:grid-cols-3" aria-label="Call routing pressure">
			{#each callRoutingPressureReadouts as readout (readout.id)}
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
			id="call-initiation-boundary"
			class="rounded-md border border-amber-500/30 bg-amber-500/10 p-4"
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div class="max-w-2xl">
					<p class="text-sm font-medium text-amber-300">Call initiation boundary</p>
					<p class="text-text-tertiary mt-1 text-sm">
						{initiationRow?.ground ?? callRoutingReadiness.detail}
					</p>
				</div>
				<div class="grid min-w-[280px] grid-cols-2 gap-2 text-center sm:grid-cols-4">
					<div>
						<p class="text-text-primary font-mono text-sm font-bold">
							<Datum value={callCount} />
						</p>
						<p class="text-text-quaternary text-[0.65rem] uppercase">records</p>
					</div>
					<div>
						<p class="font-mono text-sm font-bold text-teal-300">
							<Datum value={completedCallCount} />
						</p>
						<p class="text-text-quaternary text-[0.65rem] uppercase">completed</p>
					</div>
					<div>
						<p
							class="font-mono text-sm font-bold {data.twilioConfigured
								? 'text-teal-300'
								: 'text-amber-300'}"
						>
							{data.twilioConfigured ? 'set' : 'missing'}
						</p>
						<p class="text-text-quaternary text-[0.65rem] uppercase">transport</p>
					</div>
					<div>
						<p
							class="font-mono text-sm font-bold {data.callInitiationRuntimeReady
								? 'text-teal-300'
								: 'text-amber-300'}"
						>
							{data.callInitiationRuntimeReady ? 'ready' : 'held'}
						</p>
						<p class="text-text-quaternary text-[0.65rem] uppercase">connect</p>
					</div>
				</div>
			</div>
		</div>

		<div
			id="call-queue-boundary"
			class="border-surface-border bg-surface-base rounded-md border p-4"
		>
			<p class="text-text-primary text-sm font-medium">Call scripts and queues</p>
			<p class="text-text-tertiary mt-1 text-sm">
				{queueRow?.ground ?? callRoutingReadiness.detail}
			</p>
		</div>

		<div id="call-history" class="space-y-3">
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
