<!--
  StudioSpace — the STUDIO space, as a pure VIEW over the OS process registry.

  This is the strong center of the authoring-first org-OS, but it is no longer
  the owner of the authoring run. The streaming PROCESS lives in the OS process
  registry, driven by the runner (`startAuthoringProcess` in
  `$lib/core/authoring-process.ts`). STUDIO here only:

    · collects INTENT (subject line + core message + audience guidance) and
      spawns a process via the runner;
    · reads `orgOS.focusedProcess` and renders its entries / stage / sources /
      composed message.

  Because the run lives in the registry — outside this component's lifecycle —
  switching spaces (which hides, never unmounts, this view) does NOT stop the
  stream. When the operator reopens STUDIO, the in-flight reasoning is still
  scrolling. The emitted process ledger also restores from device-local storage
  after refresh, while live streams restore as detached rather than running.

  HONESTY RULE: every thought, source, decision-maker, and line of output is
  what a REAL SSE stream emitted, threaded through the registry by the runner.
  Nothing on this surface is fabricated; an idle/empty process renders a marked
  empty state, never a faked trace.
-->
<script lang="ts">
	import { Artifact, Datum, Ratio } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';
	import { FEATURES } from '$lib/config/features';
	import { getOrgOS, isRunning } from './orgOS.svelte';
	import { startAuthoringProcess } from '$lib/core/authoring-process';
	import StudioReasoning from '$lib/components/org/studio/StudioReasoning.svelte';
	import StudioSources, {
		type StudioSource
	} from '$lib/components/org/studio/StudioSources.svelte';
	import StudioSend from '$lib/components/org/studio/StudioSend.svelte';
	import CapabilityLandscape from './CapabilityLandscape.svelte';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments
	} from '$lib/data/capability-state-labels';
	import {
		buildMessageGenerationEvidence,
		buildSendReadiness,
		buildStudioAuthoringReadiness,
		buildStudioScopeReadiness,
		formatGateEvidence,
		getGateEvidence,
		messageGenerationSpineRows,
		type CapabilityState,
		type MessageGenerationEvidencePhase,
		type MessageGenerationEvidenceRow
	} from '$lib/data/capability-hypergraph';
	import {
		saveStudioProcessAsOrgEmailDraft,
		saveStudioProcessAsTemplateDraft
	} from '$lib/components/org/studio/studio-draft-bridge';
	import type { OrgSpacesData } from './spaces';

	let {
		canPublish,
		role,
		spaces
	}: {
		/** Role-derived: owner/editor can publish; members watch. Display gate. */
		canPublish: boolean;
		/** Exact membership role for owner-only authority readouts. */
		role: string;
		/** Existing loaded OS slices used to render the operational capability map. */
		spaces: OrgSpacesData;
	} = $props();

	type StudioCapabilityState = CapabilityState;
	type StudioHeaderMetric = {
		value: number | null;
		label: string;
		cite: string;
	};
	type StudioContractRow = {
		label: string;
		state: StudioCapabilityState;
		action: string;
		handoff: string;
		effect: string;
		gate: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};
	type StudioRunLedgerRow = {
		label: string;
		value: number | string;
		state: StudioCapabilityState;
		cite: string;
		detail: string;
		secondary?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};
	type StudioExecutionStep = {
		phase: string;
		name: string;
		state: StudioCapabilityState;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
		detail: string;
	};
	type StudioStartControl = {
		state: StudioCapabilityState;
		title: string;
		action: string;
		button: string;
		disabled: boolean;
		effect: string;
		gate: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};
	type TraceReplayEvent = {
		at: number;
		endpoint: string;
		eventType: string;
		success: boolean | null;
		durationMs: number | null;
		costUsd: number | null;
		expiresAt: number;
		summary: string;
		payloadKeys: string[];
	};

	const SOURCE_FALLBACK_MARKER = 'Evaluation unavailable';

	const os = getOrgOS();
	const composeHref = '/?create=true';
	const orgEmailHref = $derived(`${os.base}/emails/compose`);
	const emailDeliveryHref = $derived(`${os.base}/emails/compose#email-delivery`);
	const emailDelivery = $derived(spaces.operating?.emailDelivery ?? null);
	const authoringRuntime = $derived(spaces.operating?.authoring ?? null);
	const authoringRuntimeReady = $derived(authoringRuntime?.runtimeReady === true);
	const textDelivery = $derived(spaces.operating?.textDelivery ?? null);
	const congressionalDelivery = $derived(spaces.operating?.congressionalDelivery ?? null);
	const delegatedAgentGate = getGateEvidence('CP-delegation-executor', ['T5-3', 'T4-2', 'T4-1'], {
		name: 'Delegated civic action',
		dependency: 'TEE runtime + proof attachment + delegation executor'
	});
	const emailProxyGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Email send proxy',
		dependency: 'AWS Lambda deploy + BLAST receipts secret sync'
	});
	const abAutomationGate = getGateEvidence('CP-ab-automated-dispatch', ['T1-6b'], {
		name: 'A/B automated dispatch',
		downstream: 1,
		dependency: 'Idempotent test-cohort and winning-remainder send runner'
	});
	const smsDispatchGate = getGateEvidence('CP-sms-dispatch', ['T2-1'], {
		name: 'SMS dispatch',
		downstream: 2,
		dependency: 'Client-side phone decryptor + Twilio proxy'
	});
	const eventArtifactGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-10'], {
		name: 'Event artifact survivability',
		downstream: 3,
		dependency: 'Receipt manifest archive + long-term proof pattern'
	});
	const workflowEffectsGate = getGateEvidence('CP-workflow-effects', ['T1-9a'], {
		name: 'Bounded workflow runner',
		downstream: 1,
		dependency: 'Trigger dispatch + tag/branch/delay runner'
	});
	const congressionalLaunchGate = getGateEvidence('CP-congressional-launch', ['NEW-A-7'], {
		name: 'Congressional delivery launch',
		downstream: 1,
		dependency: 'First-org staging confirmation + CWC launch flag'
	});
	const sendReadiness = $derived(
		buildSendReadiness({
			base: os.base,
			emailDeliveryHref,
			canPublish,
			emailDelivery,
			textDispatch: textDelivery
				? {
						runtimeReady: textDelivery.dispatchRuntimeReady,
						runtimeMissing: textDelivery.dispatchRuntimeMissing,
						runtimeDependency: textDelivery.dispatchRuntimeDependency,
						runtimeMessage: textDelivery.dispatchRuntimeMessage,
						clientBatchRouteMounted: textDelivery.dispatchClientBatchRouteMounted
					}
				: null,
			congressionalDelivery,
			fallbackSubscribedCount: spaces.base?.emailHealth.subscribed ?? null,
			features: {
				EMAIL_CLIENT_DIRECT_MERGE: FEATURES.EMAIL_CLIENT_DIRECT_MERGE,
				EMAIL_SERVER_DISPATCH: FEATURES.EMAIL_SERVER_DISPATCH,
				AB_TESTING: FEATURES.AB_TESTING,
				SMS_DISPATCH: FEATURES.SMS_DISPATCH,
				EVENTS: FEATURES.EVENTS,
				WORKFLOW_EXECUTION: FEATURES.WORKFLOW_EXECUTION,
				CONGRESSIONAL: FEATURES.CONGRESSIONAL
			},
			gates: {
				emailProxyGate,
				abAutomationGate,
				smsDispatchGate,
				eventArtifactGate,
				workflowEffectsGate,
				congressionalLaunchGate
			}
		})
	);
	const jurisdictionScopeGate = getGateEvidence(
		'CP-studio-jurisdiction-scope',
		['T3-1', 'T3-2', 'T3-3', 'T3-4', 'T3-5'],
		{
			name: 'Full jurisdiction resolution',
			downstream: 5,
			dependency: 'State/local terrain plus CA/GB/AU resolver wiring'
		}
	);
	const messageProofGate = getGateEvidence('CP-message-proof-binding', ['T4-2', 'T4-7'], {
		name: 'Artifact proof binding',
		downstream: 3,
		dependency: 'Drafted artifact proof attachment and writer proof plumbing'
	});
	const delegatedTraceGate = getGateEvidence('CP-agent-trace-observability', ['T4-8'], {
		name: 'Delegated trace observability',
		downstream: 1,
		dependency: 'Delegation executor trace fields + grant-indexed replay'
	});
	const studioScopeReadiness = $derived(
		buildStudioScopeReadiness({
			gates: {
				studioJurisdictionScopeGate: jurisdictionScopeGate,
				messageProofGate,
				delegatedTraceGate
			}
		})
	);
	const studioAuthoringReadiness = $derived(
		buildStudioAuthoringReadiness({
			base: os.base,
			process: os.studioProcessEvidence,
			runtime: authoringRuntime,
			gates: {
				studioJurisdictionScopeGate: jurisdictionScopeGate,
				messageProofGate,
				delegatedTraceGate,
				delegatedActionGate: delegatedAgentGate
			}
		})
	);

	// ─── INTENT inputs (the only local state STUDIO still owns) ──────────
	let subjectLine = $state('');
	let coreMessage = $state('');
	let audienceGuidance = $state('');
	let intentError = $state<string | null>(null);
	let traceReplayStatus = $state<'idle' | 'loading' | 'loaded' | 'error'>('idle');
	let traceReplayTraceId = $state<string | null>(null);
	let traceReplayEvents = $state<TraceReplayEvent[]>([]);
	let traceReplayError = $state<string | null>(null);

	// ─── The focused process — STUDIO renders whatever the OS hands it ───
	const proc = $derived(os.focusedProcess);
	const running = $derived(proc ? isRunning(proc) : false);
	const entries = $derived(proc?.entries ?? []);
	const activeStage = $derived(proc?.activeStage ?? null);
	const stageLabel = $derived(proc?.stageLabel ?? '');
	const decisionMakers = $derived(proc?.decisionMakers ?? []);
	const droppedEmailless = $derived(proc?.droppedEmailless ?? 0);
	const geographicScope = $derived(proc?.geographicScope ?? null);
	const geographicScopeLabel = $derived(
		proc?.geographicScopeLabel ?? (audienceGuidance.trim() ? 'Guidance pending' : 'Not resolved')
	);
	const geographicScopeBasis = $derived(
		proc?.geographicScopeBasis ??
			(audienceGuidance.trim()
				? 'Audience guidance is passed to decision-maker resolution; message scope is applied after targets resolve.'
				: 'Message source discovery waits for resolved targets, then uses an explicit fallback only when needed.')
	);
	const geographicScopeSource = $derived(proc?.geographicScopeSource ?? 'pending');
	const sources = $derived(proc?.sources ?? []);
	const composedMessage = $derived(proc?.composedMessage ?? '');
	const activeMessageJob = $derived(proc?.activeMessageJob ?? null);
	const procError = $derived(proc?.errorMessage ?? null);
	const processFailed = $derived(proc?.status === 'error');
	const processStopped = $derived(proc?.status === 'stopped');
	const resolutionStopReason = $derived(proc?.resolutionStopReason ?? null);
	const resolutionStopDetail = $derived(proc?.resolutionStopDetail ?? null);
	const processClosedWithoutOutput = $derived(
		(processFailed || processStopped) && !composedMessage
	);
	const closedProcessReason = $derived(
		processFailed
			? (procError ?? 'The process failed before emitted output could be claimed.')
			: processStopped
				? 'The operator stopped this loop before it emitted output.'
				: null
	);
	const resolutionBlocked = $derived(processClosedWithoutOutput && decisionMakers.length === 0);
	const resolutionBlockedDetail = $derived(
		resolutionStopDetail ??
			closedProcessReason ??
			'Resolution stopped without a typed target boundary; authoring stayed closed.'
	);
	const resolutionBlockedEffect = $derived(
		resolutionStopReason === 'no-public-email'
			? 'Resolved targets were found, but usable public contact evidence was not available for authoring.'
			: resolutionStopReason === 'no-target'
				? 'No decision-maker identity reached the contactable target contract.'
				: 'Resolution stopped before a typed contactable-target boundary could be claimed.'
	);
	const groundingBlocked = $derived(processClosedWithoutOutput && sources.length === 0);
	const sourceEvidenceObserved = $derived(proc?.sourceEvidenceObserved ?? false);
	const sourceEvidenceEvaluationFallback = $derived(
		proc?.sourceEvidenceEvaluationFallback ?? false
	);
	const sourceEvidenceCandidateCount = $derived(proc?.sourceEvidenceCandidateCount ?? null);
	const sourceEvidenceFailedCount = $derived(proc?.sourceEvidenceFailedCount ?? null);
	const sourceEvidenceSearchQueryCount = $derived(proc?.sourceEvidenceSearchQueryCount ?? null);
	const completedSearchOnlySourceCount = $derived(sources.filter(isSearchOnlyStudioSource).length);
	const completedEvaluatedSourceCount = $derived(
		Math.max(0, sources.length - completedSearchOnlySourceCount)
	);
	const attachedSourceCount = $derived(
		sourceEvidenceObserved ? (proc?.sourceEvidenceCount ?? 0) : sources.length
	);
	const evaluatedSourceCount = $derived(
		sourceEvidenceObserved
			? (proc?.sourceEvidenceEvaluatedCount ?? 0)
			: completedEvaluatedSourceCount
	);
	const searchOnlySourceCount = $derived(
		sourceEvidenceObserved
			? (proc?.sourceEvidenceSearchOnlyCount ?? 0)
			: completedSearchOnlySourceCount
	);
	const sourceEvidenceKnown = $derived(
		sourceEvidenceObserved || sources.length > 0 || Boolean(composedMessage)
	);
	const sourceEvidenceCite = $derived(
		sourceEvidenceObserved ? 'stream-message source-evidence' : 'stream-message evaluatedSources'
	);
	const sourceEvidenceAudit = $derived(
		sourceEvidenceObserved
			? [
					proc?.sourceEvidenceMode === 'preverified'
						? 'preverified source cache'
						: 'discovery source stream',
					sourceEvidenceCandidateCount !== null
						? `${sourceEvidenceCandidateCount} candidates`
						: null,
					sourceEvidenceFailedCount !== null ? `${sourceEvidenceFailedCount} failed reads` : null,
					sourceEvidenceSearchQueryCount !== null
						? `${sourceEvidenceSearchQueryCount} search queries`
						: null,
					sourceEvidenceEvaluationFallback ? 'evaluation fallback active' : null
				]
					.filter((part): part is string => Boolean(part))
					.join(' · ')
			: 'source-evidence event pending'
	);
	const sourceBasisState = $derived<StudioCapabilityState>(
		evaluatedSourceCount > 0
			? 'live'
			: sourceEvidenceKnown || searchOnlySourceCount > 0
				? 'partial'
				: groundingBlocked
					? 'gated'
					: activeMessageJob || activeStage === 'ground' || activeStage === 'author'
						? 'partial'
						: 'gated'
	);
	const sourceBasisSignal = $derived(
		sourceEvidenceEvaluationFallback && searchOnlySourceCount > 0
			? `${searchOnlySourceCount} search-only · fallback`
			: evaluatedSourceCount > 0 && searchOnlySourceCount > 0
				? `${evaluatedSourceCount} evaluated · ${searchOnlySourceCount} search-only`
				: evaluatedSourceCount > 0
					? `${evaluatedSourceCount} evaluated`
					: searchOnlySourceCount > 0
						? `${searchOnlySourceCount} search-only`
						: sourceEvidenceKnown
							? '0 evaluated'
							: 'source pending'
	);
	const sourceBasisDetail = $derived(
		evaluatedSourceCount > 0 && searchOnlySourceCount > 0
			? `${evaluatedSourceCount} evaluated sources and ${searchOnlySourceCount} search-only fallback sources are attached. ${sourceEvidenceAudit}.`
			: evaluatedSourceCount > 0
				? `${evaluatedSourceCount} evaluated sources are attached. ${sourceEvidenceAudit}.`
				: searchOnlySourceCount > 0
					? `${searchOnlySourceCount} search-only fallback sources are attached; they are not evaluated citation support. ${sourceEvidenceAudit}.`
					: groundingBlocked
						? 'Grounding closed before source evidence.'
						: sourceEvidenceKnown
							? `Source evidence is known, but 0 evaluated sources are attached. ${sourceEvidenceAudit}.`
							: activeMessageJob || activeStage === 'ground' || activeStage === 'author'
								? 'Recoverable message job is grounding.'
								: 'Source discovery has not started.'
	);

	const messageParagraphs = $derived(
		composedMessage.split(/\n{2,}/).filter((p: string) => p.trim())
	);
	const sendReady = $derived(proc?.status === 'composed' && composedMessage.length > 0);
	// Show the process subject (not the live input) above the authored specimen.
	const procSubject = $derived(proc?.intent.subjectLine ?? '');
	const intentFieldCount = $derived((subjectLine.trim() ? 1 : 0) + (coreMessage.trim() ? 1 : 0));
	const intentReady = $derived(intentFieldCount === 2);
	const processCount = $derived(os.processes.length);
	const runningProcessCount = $derived(os.runningProcesses.length);
	const restoredProcessCount = $derived(
		os.processes.filter((process) => process.restoredFromDevice).length
	);
	const handoffCount = $derived(sendReady && canPublish ? 2 : 0);
	const activeMessageJobLabel = $derived(
		activeMessageJob ? `${activeMessageJob.status} · ${activeMessageJob.jobId.slice(0, 8)}` : 'none'
	);
	const activeTraceId = $derived(activeMessageJob?.traceId ?? null);
	const activeTraceLabel = $derived(activeTraceId ? activeTraceId.slice(0, 8) : 'none');
	const traceReplayEventCount = $derived(
		traceReplayTraceId === activeTraceId ? traceReplayEvents.length : 0
	);
	const traceReplayState = $derived<StudioCapabilityState>(
		activeTraceId ? (traceReplayStatus === 'error' ? 'gated' : 'partial') : 'gated'
	);
	const traceReplayAction = $derived(
		traceReplayStatus === 'loading'
			? 'loading replay'
			: traceReplayEventCount > 0
				? 'refresh trace replay'
				: activeTraceId
					? 'load trace replay'
					: 'run traced stream'
	);
	const studioHeaderMetrics = $derived<StudioHeaderMetric[]>([
		{
			value: runningProcessCount,
			label: 'running loops',
			cite: 'orgOS runningProcesses'
		},
		{
			value: processCount,
			label: 'process records',
			cite: 'orgOS process registry'
		},
		{
			value: proc ? decisionMakers.length : null,
			label: 'contactable targets',
			cite: 'stream-decision-makers complete event'
		},
		{
			value: sourceEvidenceKnown ? evaluatedSourceCount : null,
			label: 'evaluated sources',
			cite: sourceEvidenceCite
		},
		{
			value: composedMessage ? messageParagraphs.length : null,
			label: 'emitted paragraphs',
			cite: 'orgOS focusedProcess.composedMessage'
		}
	]);
	const studioStartControl = $derived<StudioStartControl>(
		running
			? {
					state: 'partial',
					title: 'Loop in progress',
					action: 'stop loop',
					button: 'Stop',
					disabled: false,
					effect:
						'The focused Studio run is already streaming; stopping is an operator interrupt, not a new authoring claim.',
					gate: 'Stopping detaches the active stream. Emitted process records remain in the device-local ledger.',
					metric: {
						value: runningProcessCount,
						label: 'running',
						cite: 'orgOS runningProcesses'
					}
				}
			: !authoringRuntimeReady
				? {
						state: 'gated',
						title: 'Authoring boundary',
						action: 'read authoring boundary',
						button: 'Authoring boundary',
						disabled: true,
						effect:
							authoringRuntime?.runtimeMessage ??
							'Model provider, source discovery, and page-read evaluation must be connected before the loop can run.',
						gate:
							authoringRuntime?.runtimeDependency ??
							'Grounded authoring depends on model provider, source discovery, and page-read evaluation.',
						metric: {
							value: authoringRuntime?.runtimeMissing?.length ?? null,
							label: 'missing capabilities',
							cite: 'OrgSpacesData.operating.authoring'
						}
					}
				: intentReady
					? {
							state: 'live',
							title: 'Ready to run',
							action:
								proc && (proc.status === 'composed' || proc.status === 'error')
									? 'run a new loop'
									: 'run loop',
							button:
								proc && (proc.status === 'composed' || proc.status === 'error')
									? 'Run a new loop'
									: 'Run the loop',
							disabled: false,
							effect:
								'Starts stream-decision-makers from the supplied intent, then permits stream-message only after a contactable target resolves.',
							gate: 'No authored artifact starts without a contactable decision-maker. Source and provider failures remain visible as process boundaries.',
							metric: {
								value: intentFieldCount,
								label: 'required fields',
								cite: 'Studio intent form state'
							}
						}
					: {
							state: 'gated',
							title: 'Intent required',
							action: 'supply intent',
							button: 'Fill intent',
							disabled: true,
							effect: 'Subject line and core message are required before a process can start.',
							gate: 'Subject line is capped at 200 characters; core message is capped at 16,000 characters.',
							metric: {
								value: intentFieldCount,
								label: 'required fields',
								cite: 'Studio intent form state'
							}
						}
	);
	const studioExecutionSpine = $derived<StudioExecutionStep[]>([
		{
			phase: 'INTENT',
			name: 'Operator intent',
			state: intentReady ? 'live' : 'gated',
			metric: {
				value: intentFieldCount,
				label: 'fields',
				cite: 'Studio intent form state'
			},
			detail: intentReady
				? 'Subject and core message can start a process.'
				: 'Subject and core message are required.'
		},
		{
			phase: 'RESOLVE',
			name: 'Power target',
			state:
				decisionMakers.length > 0
					? 'live'
					: resolutionBlocked
						? 'gated'
						: activeStage === 'resolve' || running
							? 'partial'
							: 'gated',
			metric: {
				value: decisionMakers.length,
				label: 'contactable',
				cite: 'stream-decision-makers complete event'
			},
			detail:
				decisionMakers.length > 0
					? 'Contactable decision-makers are in the process.'
					: resolutionBlocked
						? resolutionBlockedDetail
						: activeStage === 'resolve' || running
							? 'Resolution stream is active.'
							: 'Authoring waits for a target.'
		},
		{
			phase: 'GROUND',
			name: 'Source basis',
			state: sourceBasisState,
			metric: {
				value: sourceEvidenceKnown ? evaluatedSourceCount : null,
				label: 'evaluated',
				cite: sourceEvidenceCite
			},
			detail: sourceBasisDetail
		},
		{
			phase: 'AUTHOR',
			name: 'Message artifact',
			state: composedMessage
				? 'live'
				: processClosedWithoutOutput
					? 'gated'
					: activeStage === 'author'
						? 'partial'
						: 'gated',
			metric: {
				value: composedMessage ? messageParagraphs.length : null,
				label: 'paragraphs',
				cite: 'orgOS focusedProcess.composedMessage'
			},
			detail: composedMessage
				? 'The focused process emitted the message.'
				: processClosedWithoutOutput
					? 'No authored output can be claimed.'
					: activeStage === 'author'
						? 'Message stream is writing.'
						: 'Authoring waits for grounded context.'
		},
		{
			phase: 'HANDOFF',
			name: 'Draft handoffs',
			state: sendReady && canPublish ? 'draft-only' : sendReady ? 'partial' : 'gated',
			metric: {
				value: handoffCount,
				label: 'handoffs',
				cite: 'StudioSend public template + org email handlers'
			},
			detail:
				sendReady && canPublish
					? 'Delivery-surface draft handoffs are available.'
					: sendReady
						? 'Org authority gates delivery-surface draft handoff.'
						: 'Delivery-surface draft handoff appears only after an authored artifact exists.'
		}
	]);
	const studioRunLedger = $derived<StudioRunLedgerRow[]>([
		{
			label: 'Process memory',
			value: processCount,
			state: processCount > 0 ? 'partial' : 'gated',
			cite: 'device-local orgOS process storage',
			detail:
				restoredProcessCount > 0
					? `${restoredProcessCount} process${restoredProcessCount === 1 ? '' : 'es'} restored on this device; live streams are detached after refresh.`
					: 'Emitted Studio process records are cached locally on this device after the loop starts.'
		},
		{
			label: 'Contactable targets',
			value: decisionMakers.length,
			state:
				decisionMakers.length > 0
					? 'live'
					: resolutionBlocked
						? 'gated'
						: running || intentReady
							? 'partial'
							: 'gated',
			cite: 'stream-decision-makers complete event',
			detail: resolutionBlocked
				? resolutionBlockedDetail
				: droppedEmailless > 0
					? `${droppedEmailless} dropped without public email`
					: decisionMakers.length > 0
						? 'Resolved target list is contactable.'
						: 'Authoring waits for a contactable target.'
		},
		{
			label: 'Source ground',
			value: sourceEvidenceKnown ? evaluatedSourceCount : 'pending',
			state: sourceBasisState,
			cite: sourceEvidenceCite,
			secondary: {
				value: sourceEvidenceKnown ? searchOnlySourceCount : null,
				label: 'search-only',
				cite: sourceEvidenceCite
			},
			detail: groundingBlocked
				? `Grounding did not start: ${closedProcessReason ?? 'no source evidence was emitted.'}`
				: geographicScope
					? `${sourceBasisSignal}; ${geographicScopeLabel}; ${geographicScopeSource}`
					: sourceBasisDetail
		},
		{
			label: 'Recovery job',
			value: activeMessageJobLabel,
			state:
				activeMessageJob?.status === 'completed'
					? 'live'
					: activeMessageJob?.status === 'failed' || activeMessageJob?.status === 'expired'
						? 'gated'
						: activeMessageJob
							? 'partial'
							: 'gated',
			cite: activeMessageJob ? 'activeMessageJob job_id/input_hash' : 'no active message job',
			detail:
				activeMessageJob?.status === 'failed'
					? 'Job failed before encrypted recovery completed.'
					: activeMessageJob?.status === 'expired'
						? 'Recovery window expired; run the loop again.'
						: activeMessageJob
							? 'Device-local key can recover completed output.'
							: 'Created when the message stream starts.'
		},
		{
			label: 'Trace replay',
			value: activeTraceLabel,
			state: activeTraceId ? 'partial' : activeMessageJob ? 'partial' : 'gated',
			cite: activeTraceId ? 'stream-message traceId' : 'no trace id emitted',
			detail: activeTraceId
				? 'Operator replay handle exists; persistence is env-gated and internal-secret only.'
				: activeMessageJob
					? 'Recovery job exists; waiting for the stream trace handle.'
					: 'Created when stream-message opens.'
		},
		{
			label: 'Draft handoffs',
			value: handoffCount,
			state: sendReady && canPublish ? 'draft-only' : sendReady ? 'partial' : 'gated',
			cite: 'StudioSend public template + org email handlers',
			detail: canPublish
				? 'Studio can create delivery-surface drafts; delivery surfaces own final confirmation.'
				: 'Org authority is required; delivery-surface drafts stay read-only for this role.'
		}
	]);
	const studioContractRows = $derived<StudioContractRow[]>([
		{
			label: 'Grounded authoring readiness',
			state: studioAuthoringReadiness.state,
			action: 'open Studio intent',
			handoff: 'Studio intent',
			effect: studioAuthoringReadiness.effect,
			gate: studioAuthoringReadiness.gate,
			metric: {
				value: studioAuthoringReadiness.metric.value,
				label: studioAuthoringReadiness.metric.label,
				cite: studioAuthoringReadiness.metric.cite
			}
		},
		{
			label: 'Studio scope and recovery',
			state: studioScopeReadiness.state,
			action: 'read Studio scope and recovery',
			handoff: 'Studio scope / recovery',
			effect: studioScopeReadiness.effect,
			gate: studioScopeReadiness.gate,
			metric: {
				value: studioScopeReadiness.boundaryCount,
				label: studioScopeReadiness.boundaryCount === 1 ? 'bounded claim' : 'bounded claims',
				cite: 'buildStudioScopeReadiness'
			}
		},
		{
			label: 'Intent boundary',
			state: intentReady ? 'live' : 'gated',
			action: intentReady ? 'run loop' : 'fill intent',
			handoff: 'Studio intent',
			effect: intentReady
				? 'Starts an OS process from the supplied subject and core message.'
				: 'No process starts until both required intent fields are present.',
			gate: 'Subject line is capped at 200 characters; core message is capped at 16,000 characters.',
			metric: {
				value: intentFieldCount,
				label: 'required fields',
				cite: 'Studio intent form state'
			}
		},
		{
			label: 'Decision-maker resolution',
			state:
				decisionMakers.length > 0
					? 'live'
					: resolutionBlocked
						? 'gated'
						: running || intentReady
							? 'partial'
							: 'gated',
			action:
				decisionMakers.length > 0
					? 'read audience'
					: resolutionBlocked
						? processStopped
							? 'run again'
							: 'revise intent'
						: intentReady
							? 'stream resolve'
							: 'supply intent',
			handoff: 'Power target',
			effect: resolutionBlocked
				? resolutionBlockedEffect
				: 'Calls /api/agents/stream-decision-makers with verbose reasoning and keeps only contactable resolved targets.',
			gate: resolutionBlocked
				? resolutionBlockedDetail
				: 'Authentication, rate limits, moderation, and public email availability still bound the result.',
			metric: {
				value: decisionMakers.length,
				label: 'contactable resolved',
				cite: 'stream-decision-makers complete event'
			}
		},
		{
			label: 'Jurisdiction scope',
			state: geographicScope ? 'partial' : intentReady ? 'partial' : 'gated',
			action: geographicScope ? 'scope applied' : intentReady ? 'resolve scope' : 'supply intent',
			handoff: 'Scope ground',
			effect: geographicScope
				? `Grounding runs with ${geographicScopeLabel} as the message scope.`
				: 'Audience guidance shapes target resolution; message grounding waits for resolved target evidence.',
			gate: formatGateEvidence(jurisdictionScopeGate, {
				prefix:
					geographicScopeSource === 'fallback'
						? geographicScopeBasis
						: `${geographicScopeBasis} Scope is applied, but parser confidence stays bounded until full jurisdiction resolution lands.`
			}),
			metric: {
				value: geographicScope ? 1 : 0,
				label: 'scope applied',
				cite: 'authoring-process geographicScope'
			}
		},
		{
			label: 'Ground + author stream',
			state: composedMessage
				? 'live'
				: processClosedWithoutOutput
					? 'gated'
					: activeMessageJob ||
						  attachedSourceCount > 0 ||
						  (running && (activeStage === 'ground' || activeStage === 'author'))
						? 'partial'
						: 'gated',
			action: composedMessage
				? 'read output'
				: processClosedWithoutOutput
					? processStopped
						? 'run again'
						: 'revise target'
					: activeMessageJob ||
						  attachedSourceCount > 0 ||
						  activeStage === 'ground' ||
						  activeStage === 'author'
						? 'stream message'
						: intentReady
							? 'resolve first'
							: 'supply intent',
			handoff: 'Source + message stream',
			effect: processClosedWithoutOutput
				? 'Authoring did not claim output because the process closed before an authored artifact existed.'
				: 'Calls /api/agents/stream-message as a recoverable message job only after decision-maker resolution; sources and message lines are only what the stream or encrypted job result emits.',
			gate: processClosedWithoutOutput
				? (closedProcessReason ?? 'No authored message is available.')
				: `Source discovery, prompt-safety checks, quota, and provider availability can still stop generation. Recovery is device-local and depends on the local recovery key. ${sourceEvidenceAudit}.`,
			metric: {
				value: sourceEvidenceKnown ? evaluatedSourceCount : null,
				label: 'evaluated sources',
				cite: activeMessageJob ? 'message job recovery handle' : sourceEvidenceCite
			}
		},
		{
			label: 'Artifact recovery boundary',
			state:
				activeMessageJob?.status === 'completed'
					? 'live'
					: activeMessageJob
						? 'partial'
						: composedMessage
							? 'partial'
							: 'gated',
			action:
				activeMessageJob?.status === 'completed'
					? 'recover artifact'
					: activeMessageJob
						? 'track job'
						: composedMessage
							? 'read recovery boundary'
							: 'start stream',
			handoff: 'Artifact recovery',
			effect:
				'The recoverable job can restore authored output on this device; process memory is device-local, not server-side persistence or proof-bound delegated action.',
			gate: formatGateEvidence(messageProofGate, {
				prefix: 'Artifact recovery is live; proof-bound drafted-artifact lift waits on.'
			}),
			metric: {
				value: activeMessageJob ? 1 : null,
				label: 'recovery job',
				cite: activeMessageJob ? 'activeMessageJob job_id/input_hash' : 'no active message job'
			}
		},
		{
			label: 'Trace replay boundary',
			state: activeTraceId ? 'partial' : activeMessageJob ? 'partial' : 'gated',
			action: activeTraceId ? 'read trace id' : activeMessageJob ? 'wait trace' : 'start stream',
			handoff: 'Trace handle',
			effect:
				'The authoring stream emits a trace id for operator replay; persistence is separate from device-local recovery.',
			gate: activeTraceId
				? `Trace ${activeTraceId} is the replay handle. Persistence still depends on AGENT_TRACE_ENABLED, sampling, TTL, and INTERNAL_API_SECRET. ${formatGateEvidence(
						delegatedTraceGate,
						{ prefix: 'Delegated-agent trace observability remains gated.' }
					)}`
				: `No stream-message trace id has been emitted yet. ${formatGateEvidence(
						delegatedTraceGate,
						{
							prefix: 'Delegated-agent trace observability remains gated.'
						}
					)}`,
			metric: {
				value: activeTraceId ? 1 : null,
				label: 'trace id',
				cite: activeTraceId ? 'activeMessageJob traceId' : 'stream-message job event pending'
			}
		},
		{
			label: 'Draft handoffs',
			state: sendReady && canPublish ? 'draft-only' : sendReady ? 'partial' : 'gated',
			action:
				sendReady && canPublish ? 'handoff draft' : sendReady ? 'request editor' : 'finish loop',
			handoff: 'Delivery-surface drafts',
			effect: sendReady
				? 'Can write a local draft into the public template creator or org email composer.'
				: 'No publish or email draft is created until a composed message exists.',
			gate: canPublish
				? 'Delivery surfaces own final audience, preview, send, and publish confirmation.'
				: 'This role can author, watch, and preserve the artifact; draft handoff and execution side effects require org authority.',
			metric: {
				value: handoffCount,
				label: 'draft handoffs',
				cite: 'StudioSend public template + org email buttons'
			}
		},
		{
			label: 'Delegated agent action',
			state: 'gated',
			action: 'read dependency',
			handoff: 'Delegated action',
			effect:
				'Studio is operator-initiated authoring. It does not execute autonomous delegated civic actions.',
			gate: formatGateEvidence(delegatedAgentGate, {
				prefix: 'Autonomous execution remains dependency-first.'
			}),
			metric: {
				value: delegatedAgentGate.downstream,
				label: 'downstream blocked',
				cite: delegatedAgentGate.source
			}
		}
	]);
	const studioStateCounts = $derived(
		studioContractRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<StudioCapabilityState, number>
		)
	);
	const studioSegments = $derived(operatorCapabilityStateRatioSegments(studioStateCounts));
	const procIntentFieldCount = $derived(
		proc
			? (proc.intent.subjectLine.trim() ? 1 : 0) + (proc.intent.coreMessage.trim() ? 1 : 0)
			: intentFieldCount
	);
	const messageResearchStepCount = $derived(
		entries.filter((entry) => entry.stage === 'ground' || entry.stage === 'author').length
	);
	const messageGenerationPhase = $derived<MessageGenerationEvidencePhase>(
		composedMessage
			? 'complete'
			: activeStage === 'ground'
				? 'sources'
				: activeStage === 'author'
					? 'message'
					: activeMessageJob &&
						  activeMessageJob.status !== 'completed' &&
						  activeMessageJob.status !== 'failed' &&
						  activeMessageJob.status !== 'expired'
						? 'recovering'
						: 'preparing'
	);
	const authoredOutputEvidence = $derived(
		buildMessageGenerationEvidence({
			intentFieldCount: procIntentFieldCount,
			targetCount: decisionMakers.length,
			phase: messageGenerationPhase,
			paragraphCount: messageParagraphs.length,
			sourceCount: sourceEvidenceObserved ? attachedSourceCount : sources.length,
			evaluatedSourceCount,
			searchOnlySourceCount,
			sourceEvidenceObserved,
			researchStepCount: messageResearchStepCount,
			hasRecoveryJob: Boolean(activeMessageJob),
			recoveryJobStatus: activeMessageJob?.status ?? null,
			traceHandle: activeTraceLabel === 'none' ? null : activeTraceLabel,
			messageProofGate
		})
	);
	const authoredOutputRows = $derived<MessageGenerationEvidenceRow[]>(authoredOutputEvidence.rows);
	const authoredOutputPressureCells = $derived(messageGenerationSpineRows(authoredOutputRows));
	const authoredOutputStateCounts = $derived(
		authoredOutputRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<StudioCapabilityState, number>
		)
	);
	const authoredOutputSegments = $derived(
		operatorCapabilityStateRatioSegments(authoredOutputStateCounts)
	);

	function studioStateLabel(state: StudioCapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function actionForState(state: StudioCapabilityState, action: string): string {
		return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });
	}

	function studioActionLabel(row: StudioContractRow): string {
		return actionForState(row.state, row.action);
	}

	function outputActionLabel(row: MessageGenerationEvidenceRow): string {
		return actionForState(row.state, row.action);
	}

	function formatTraceTime(value: number): string {
		return new Date(value).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function isSearchOnlyStudioSource(source: StudioSource): boolean {
		return (
			!source.incentive_position ||
			(source.credibility_rationale ?? '').startsWith(SOURCE_FALLBACK_MARKER)
		);
	}

	async function loadTraceReplay() {
		if (!activeTraceId || traceReplayStatus === 'loading') return;
		traceReplayStatus = 'loading';
		traceReplayTraceId = activeTraceId;
		traceReplayError = null;
		try {
			const response = await fetch(`/api/agents/traces/${encodeURIComponent(activeTraceId)}`, {
				credentials: 'include'
			});
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				events?: TraceReplayEvent[];
			};
			if (!response.ok) {
				throw new Error(body.error || 'Trace replay is unavailable.');
			}
			traceReplayEvents = body.events ?? [];
			traceReplayStatus = 'loaded';
		} catch (err) {
			traceReplayEvents = [];
			traceReplayStatus = 'error';
			traceReplayError = err instanceof Error ? err.message : 'Trace replay is unavailable.';
		}
	}

	function runLoop() {
		intentError = null;
		if (!subjectLine.trim() || !coreMessage.trim()) {
			intentError = 'An intent needs a subject line and a core message.';
			return;
		}
		if (!authoringRuntimeReady) {
			intentError =
				authoringRuntime?.runtimeMessage ??
				'Grounded authoring is dependency-first until model provider, source discovery, and page-read evaluation are connected.';
			return;
		}
		// Hand the intent to the OS runner. It spawns + focuses the process and
		// drives the stream independently of this component. STUDIO immediately
		// reflects the new focused process via os.focusedProcess.
		startAuthoringProcess(os, {
			subjectLine: subjectLine.trim(),
			coreMessage: coreMessage.trim(),
			audienceGuidance: audienceGuidance.trim()
		});
	}

	function stopLoop() {
		if (proc) os.stopProcess(proc.id);
	}

	function takeToPublish() {
		if (!proc || proc.status !== 'composed' || !composedMessage.trim()) return;
		const draftId = saveStudioProcessAsTemplateDraft(proc);
		// Creation is modal-first at the public authoring entry. STUDIO now hands
		// off the real resolved audience, sources, and composed message as a draft
		// instead of dropping state on a blank creator.
		window.location.href = `${composeHref}&resumeDraft=${encodeURIComponent(draftId)}`;
	}

	function takeToOrgEmail() {
		if (!proc || proc.status !== 'composed' || !composedMessage.trim()) return;
		const draftId = saveStudioProcessAsOrgEmailDraft(proc);
		window.location.href = `${orgEmailHref}?studioDraft=${encodeURIComponent(draftId)}`;
	}
</script>

<div class="studio" style="--timing-slow: {TIMING.SLOW}ms; --easing: {EASING};">
	<header class="studio-head">
		<div class="studio-head-copy">
			<h1 class="studio-title">Studio</h1>
			<p class="studio-sub">
				The action you author and send — with the instrument's reasoning visible as you go.
			</p>
		</div>
		<div class="studio-head-instrument">
			<div class="studio-proof-counts" aria-label="Studio authoring evidence counts">
				{#each studioHeaderMetrics as metric (metric.label)}
					<span class="studio-proof-count">
						<Datum value={metric.value} cite={metric.cite} />
						<span>{metric.label}</span>
					</span>
				{/each}
			</div>
			<a class="studio-public" href={composeHref} data-sveltekit-preload-data="off">
				Public action draft →
			</a>
		</div>
	</header>

	<CapabilityLandscape
		{spaces}
		base={os.base}
		{canPublish}
		{role}
		studioProcessEvidence={os.studioProcessEvidence}
	/>

	<!-- INTENT — entered in-surface, not a wizard step -->
	<section id="studio-intent" class="intent" aria-label="Intent">
		<div class="intent-contract" aria-label="Studio intent capability contract">
			<div class="intent-contract-head">
				<div>
					<p class="intent-contract-kicker">Intent contract</p>
					<h2 class="intent-contract-title">Start only a real reasoning loop</h2>
				</div>
				<div class="intent-contract-counts">
					<span class="intent-contract-count">
						<Datum value={runningProcessCount} cite="orgOS runningProcesses" />
						<span>running</span>
					</span>
					<span class="intent-contract-count">
						<Datum value={processCount} cite="orgOS process registry" />
						<span>processes</span>
					</span>
				</div>
			</div>
			<Ratio segments={studioSegments} height={8} />
			<div class="execution-spine" aria-label="Studio execution spine">
				{#each studioExecutionSpine as step (step.phase)}
					<div class="execution-step" data-state={step.state}>
						<div class="execution-step-top">
							<span class="execution-phase">{step.phase}</span>
							<span class="execution-state">{studioStateLabel(step.state)}</span>
						</div>
						<span class="execution-name">{step.name}</span>
						<span class="execution-metric">
							<Datum value={step.metric.value} cite={step.metric.cite} />
							<span>{step.metric.label}</span>
						</span>
						<span class="execution-detail">{step.detail}</span>
					</div>
				{/each}
			</div>
			<div class="run-ledger" aria-label="Studio run ledger">
				{#each studioRunLedger as row (row.label)}
					<div class="run-ledger-item" data-state={row.state}>
						<span class="run-ledger-label">{row.label}</span>
						<span class="run-ledger-value">
							{#if typeof row.value === 'number'}
								<Datum value={row.value} cite={row.cite} />
							{:else}
								{row.value}
							{/if}
						</span>
						{#if row.secondary}
							<span class="run-ledger-secondary">
								<Datum value={row.secondary.value} cite={row.secondary.cite} />
								<span>{row.secondary.label}</span>
							</span>
						{/if}
						<span class="run-ledger-state">{studioStateLabel(row.state)}</span>
						<span class="run-ledger-detail">{row.detail}</span>
					</div>
				{/each}
			</div>
			<div class="intent-contract-list">
				{#each studioContractRows as row (row.label)}
					<div class="intent-contract-row" data-state={row.state}>
						<div class="intent-contract-main">
							<span class="intent-contract-name">{row.label}</span>
							<span class="intent-contract-handoff">{row.handoff}</span>
							<span class="intent-contract-effect">{row.effect}</span>
						</div>
						<span class="intent-contract-state">{studioStateLabel(row.state)}</span>
						<span class="intent-contract-metric">
							<Datum value={row.metric.value} cite={row.metric.cite} />
							<span>{row.metric.label}</span>
						</span>
						<span class="intent-contract-action">{studioActionLabel(row)}</span>
						<span class="intent-contract-gate">{row.gate}</span>
					</div>
				{/each}
			</div>
		</div>

		<div class="intent-field">
			<label class="intent-label" for="studio-subject">Subject line</label>
			<input
				id="studio-subject"
				class="intent-input"
				type="text"
				bind:value={subjectLine}
				maxlength={200}
				placeholder="What is this action about?"
				disabled={running}
			/>
		</div>
		<div class="intent-field">
			<label class="intent-label" for="studio-core">Core message</label>
			<textarea
				id="studio-core"
				class="intent-textarea"
				rows={3}
				bind:value={coreMessage}
				maxlength={16000}
				placeholder="The substance — what you want the decision-makers to do, and why."
				disabled={running}
			></textarea>
		</div>
		<div class="intent-field">
			<label class="intent-label" for="studio-audience"
				>Audience guidance <span class="intent-opt">optional</span></label
			>
			<input
				id="studio-audience"
				class="intent-input"
				type="text"
				bind:value={audienceGuidance}
				placeholder="e.g. San Francisco health department leadership"
				disabled={running}
			/>
		</div>

		<div
			class="intent-action-contract"
			data-state={studioStartControl.state}
			aria-label="Studio start action contract"
		>
			<div class="intent-action-main">
				<span class="intent-action-title">{studioStartControl.title}</span>
				<span class="intent-action-effect">{studioStartControl.effect}</span>
				<span class="intent-action-gate">{studioStartControl.gate}</span>
			</div>
			<span class="intent-action-state">{studioStateLabel(studioStartControl.state)}</span>
			<span class="intent-action-metric">
				<Datum value={studioStartControl.metric.value} cite={studioStartControl.metric.cite} />
				<span>{studioStartControl.metric.label}</span>
			</span>
			<span class="intent-action-label">
				{actionForState(studioStartControl.state, studioStartControl.action)}
			</span>
			<button
				type="button"
				class="intent-run"
				class:intent-run--stop={running}
				onclick={running ? stopLoop : runLoop}
				disabled={studioStartControl.disabled}
			>
				{studioStartControl.button}
			</button>
		</div>

		<div class="intent-actions">
			{#if intentError}
				<span class="intent-error" role="alert">{intentError}</span>
			{:else if procError}
				<span class="intent-error" role="alert">{procError}</span>
			{/if}
		</div>
	</section>

	<!-- CENTERPIECE — the live reasoning surface (read from the focused process) -->
	<StudioReasoning {entries} {activeStage} {stageLabel} />

	{#if activeTraceId}
		<section class="trace-replay" data-state={traceReplayState} aria-label="Authoring trace replay">
			<header class="trace-replay-head">
				<div>
					<p class="trace-replay-kicker">Trace replay</p>
					<h2 class="trace-replay-title">Redacted event replay</h2>
				</div>
				<div class="trace-replay-controls">
					<span class="trace-replay-count">
						<Datum value={traceReplayEventCount || null} cite="agentTraces listByTrace" />
						<span>events</span>
					</span>
					<button
						type="button"
						class="trace-replay-load"
						onclick={loadTraceReplay}
						disabled={traceReplayStatus === 'loading'}
					>
						{actionForState(traceReplayState, traceReplayAction)}
					</button>
				</div>
			</header>
			<p class="trace-replay-boundary">
				Trace replay is redacted for browser display: raw prompts and model responses stay
				internal-secret protected, while phase, source-evidence, duration, and cost posture can be
				inspected by the signed-in operator who started the trace.
			</p>
			{#if traceReplayError}
				<p class="trace-replay-error" role="alert">{traceReplayError}</p>
			{/if}
			{#if traceReplayEvents.length > 0}
				<ol class="trace-replay-list">
					{#each traceReplayEvents as event (event.at + event.eventType)}
						<li class="trace-replay-event">
							<span class="trace-event-time">{formatTraceTime(event.at)}</span>
							<span class="trace-event-type">{event.eventType}</span>
							<span class="trace-event-summary">{event.summary}</span>
							{#if event.durationMs !== null}
								<span class="trace-event-metric">
									<Datum value={event.durationMs} cite="agentTraces durationMs" />
									<span>ms</span>
								</span>
							{/if}
							{#if event.costUsd !== null}
								<span class="trace-event-metric">
									<Datum value={event.costUsd} cite="agentTraces costUsd" />
									<span>usd</span>
								</span>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{/if}

	<!-- The loop's products: resolved audience, source ground, authored message -->
	<div class="studio-products">
		{#if decisionMakers.length > 0 || droppedEmailless > 0}
			<section class="dm" aria-label="Resolved decision-makers">
				<header class="dm-head">
					<span class="dm-title">Resolved decision-makers</span>
					<span class="dm-count">
						<Datum value={decisionMakers.length} class="dm-count-num" />
						<span class="dm-count-label">contactable</span>
						{#if droppedEmailless > 0}
							<span class="dm-dropped"
								>· <Datum value={droppedEmailless} class="dm-dropped-num" /> dropped, no public email</span
							>
						{/if}
					</span>
				</header>
				<ul class="dm-list">
					{#each decisionMakers as dm (dm.name + dm.organization)}
						<li class="dm-item">
							<span class="dm-name">{dm.name}</span>
							<span class="dm-role">{dm.title}{dm.organization ? ` · ${dm.organization}` : ''}</span
							>
							{#if dm.email}
								<span class="dm-email">{dm.email}</span>
							{:else}
								<span class="dm-noemail">no public email</span>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if sources.length > 0}
			<StudioSources {sources} />
		{/if}

		{#if composedMessage}
			<!-- AUTHOR output — the white specimen. Every citation traces to a real URL. -->
			<div class="specimen">
				<div class="output-contract" aria-label="Authored output contract">
					<header class="output-contract-head">
						<div>
							<p class="output-contract-kicker">Authored output</p>
							<h2 class="output-contract-title">Emitted message, boundaries attached</h2>
						</div>
						<span class="output-contract-count">
							<Datum value={messageParagraphs.length} cite="orgOS focusedProcess.composedMessage" />
							<span>paragraphs</span>
						</span>
					</header>
					<div class="output-pressure" aria-label="Authored artifact posture">
						{#each authoredOutputPressureCells as cell (cell.key)}
							<div
								class="output-pressure-cell"
								data-state={cell.state}
								title="{cell.label}: {cell.ground}. {cell.effect}"
								aria-label={`${cell.label}: ${studioStateLabel(cell.state)}. ${cell.ground}. ${cell.action}. ${cell.effect}.`}
							>
								<span class="output-pressure-label">{cell.label}</span>
								<span class="output-pressure-value">
									<Datum value={cell.metric.value} cite={cell.metric.cite} />
									<span>{cell.metric.label}</span>
								</span>
								<span class="output-pressure-ground">{cell.ground}</span>
								<span class="output-pressure-next">{cell.effect}</span>
							</div>
						{/each}
					</div>
					<Ratio segments={authoredOutputSegments} height={6} />
					<div class="output-contract-list">
						{#each authoredOutputRows as row (row.key)}
							<div class="output-contract-row" data-state={row.state}>
								<div class="output-contract-main">
									<span class="output-contract-name">{row.label}</span>
									<span class="output-contract-handoff"
										>{row.phase} / {formatCapabilityClusters(row.clusters)}</span
									>
									<span class="output-contract-detail">{row.ground}</span>
								</div>
								<span class="output-contract-state">{studioStateLabel(row.state)}</span>
								<span class="output-contract-metric">
									<Datum value={row.metric.value} cite={row.metric.cite} />
									<span>{row.metric.label}</span>
								</span>
								<span class="output-contract-action">{outputActionLabel(row)}</span>
								<span class="output-contract-gate">{row.gate}</span>
							</div>
						{/each}
					</div>
				</div>
				<span class="specimen-label">Authored message</span>
				<Artifact padding="default">
					{#if procSubject}
						<p class="specimen-subject">{procSubject}</p>
					{/if}
					{#each messageParagraphs as para, i (i)}
						<p class="specimen-para">{para}</p>
					{/each}
				</Artifact>
			</div>
		{/if}
	</div>

	<!-- SEND — consummation -->
	<StudioSend
		ready={sendReady}
		{canPublish}
		{sendReadiness}
		onpublish={takeToPublish}
		onemail={takeToOrgEmail}
	/>
</div>

<style>
	.studio {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		width: 100%;
	}

	/* ─── Head ─── */
	.studio-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.studio-head-copy {
		min-width: 0;
	}

	.studio-head-instrument {
		display: flex;
		flex-shrink: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.625rem;
	}

	.studio-proof-counts {
		display: flex;
		max-width: 40rem;
		flex-wrap: wrap;
		justify-content: flex-start;
		gap: 0.5rem 0.875rem;
	}

	.studio-proof-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-secondary, oklch(0.42 0.015 60));
		white-space: nowrap;
	}

	.studio-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0;
	}

	.studio-sub {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-tertiary, #6b7280);
		margin: 0.25rem 0 0;
		max-width: 36rem;
	}

	.studio-public {
		flex-shrink: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
		padding-top: 0.5rem;
		transition: color var(--timing-slow) var(--easing);
	}
	.studio-public:hover,
	.studio-public:focus-visible {
		text-decoration: underline;
		outline: none;
	}

	@media (max-width: 760px) {
		.studio-head {
			flex-direction: column;
		}
	}

	@media (min-width: 860px) {
		.studio-head-instrument {
			align-items: flex-end;
		}
		.studio-proof-counts {
			justify-content: flex-end;
		}
	}

	/* ─── Intent ─── */
	.intent {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		scroll-margin-top: 6rem;
		padding: 1.125rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}

	.intent-contract {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-bottom: 0.875rem;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
	}

	.intent-contract-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.intent-contract-kicker,
	.intent-contract-state,
	.intent-contract-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.2;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.intent-contract-kicker {
		margin: 0;
		color: oklch(0.52 0.012 250);
	}

	.intent-contract-title {
		margin: 0.125rem 0 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.95rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.intent-contract-counts {
		display: inline-flex;
		align-items: baseline;
		gap: 0.625rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.intent-contract-count,
	.intent-contract-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		white-space: nowrap;
	}

	.intent-contract-list {
		display: grid;
		gap: 0.25rem;
	}

	.run-ledger {
		display: grid;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
	}

	.execution-spine {
		display: grid;
		gap: 0.5rem;
		padding: 0.125rem 0 0.25rem;
	}

	@media (min-width: 780px) {
		.execution-spine {
			grid-template-columns: repeat(5, minmax(0, 1fr));
		}
	}

	.execution-step {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.625rem;
		border-radius: 6px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
		background: #ffffff;
	}

	.execution-step-top,
	.execution-metric {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}

	.execution-phase,
	.execution-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 700;
		line-height: 1.2;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.execution-phase {
		color: oklch(0.52 0.012 250);
	}

	.execution-state {
		color: oklch(0.48 0.02 60);
		text-align: right;
	}

	.execution-step[data-state='live'] .execution-state {
		color: var(--coord-verified, #10b981);
	}

	.execution-step[data-state='partial'] .execution-state {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.execution-step[data-state='draft-only'] .execution-state {
		color: oklch(0.62 0.12 78);
	}

	.execution-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
		overflow-wrap: anywhere;
	}

	.execution-metric {
		justify-content: flex-start;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.execution-detail {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.35;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	@media (min-width: 780px) {
		.run-ledger {
			grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		}
	}

	.run-ledger-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.2rem 0.625rem;
		padding: 0.625rem 0;
		min-width: 0;
	}

	.run-ledger-item + .run-ledger-item {
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.55));
	}

	@media (min-width: 780px) {
		.run-ledger-item {
			padding: 0.625rem 0.75rem;
		}

		.run-ledger-item + .run-ledger-item {
			border-top: 0;
			border-left: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.55));
		}
	}

	.run-ledger-label,
	.run-ledger-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.2;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.run-ledger-label {
		grid-column: 1;
		grid-row: 1;
		color: oklch(0.52 0.012 250);
	}

	.run-ledger-value {
		grid-column: 2;
		grid-row: 1;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
		text-align: right;
		overflow-wrap: anywhere;
	}

	.run-ledger-secondary {
		grid-column: 2;
		grid-row: 2;
		display: inline-flex;
		align-items: baseline;
		justify-self: end;
		gap: 0.25rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.64rem;
		line-height: 1.2;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		white-space: nowrap;
	}

	.run-ledger-state {
		grid-column: 1;
		grid-row: 2;
		color: oklch(0.48 0.02 60);
	}

	.run-ledger-detail {
		grid-column: 1 / -1;
		grid-row: 3;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.35;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		text-align: left;
		min-width: 0;
	}

	.run-ledger-item[data-state='live'] .run-ledger-state {
		color: var(--coord-verified, #10b981);
	}

	.run-ledger-item[data-state='partial'] .run-ledger-state {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.run-ledger-item[data-state='draft-only'] .run-ledger-state {
		color: oklch(0.62 0.12 78);
	}

	.intent-contract-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.35rem;
		padding: 0.625rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
	}

	@media (min-width: 860px) {
		.intent-contract-row {
			grid-template-columns: minmax(10rem, 1fr) 5.25rem 7.75rem auto minmax(0, 1.15fr);
			align-items: baseline;
		}
	}

	.intent-contract-main {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.intent-contract-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.intent-contract-handoff,
	.output-contract-handoff {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.25;
		color: oklch(0.44 0.012 60);
	}

	.intent-contract-effect,
	.intent-contract-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.intent-contract-action {
		color: oklch(0.5 0.012 60);
		text-transform: none;
		letter-spacing: 0;
		white-space: nowrap;
	}

	.intent-contract-row[data-state='live'] .intent-contract-state,
	.intent-contract-row[data-state='live'] .intent-contract-action {
		color: var(--coord-verified, #10b981);
	}

	.intent-contract-row[data-state='partial'] .intent-contract-state,
	.intent-contract-row[data-state='partial'] .intent-contract-action {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.intent-contract-row[data-state='draft-only'] {
		border-top-style: dashed;
	}

	.intent-contract-row[data-state='draft-only'] .intent-contract-state,
	.intent-contract-row[data-state='draft-only'] .intent-contract-action {
		color: oklch(0.62 0.12 78);
	}

	.intent-contract-row[data-state='gated'] {
		border-top-style: dashed;
	}

	.intent-contract-row[data-state='gated'] .intent-contract-state,
	.intent-contract-row[data-state='gated'] .intent-contract-action {
		color: oklch(0.48 0.02 60);
	}

	.intent-field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.intent-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-secondary, oklch(0.4 0.01 60));
	}

	.intent-opt {
		font-weight: 400;
		color: var(--text-tertiary, #9ca3af);
		font-size: 0.6875rem;
	}

	.intent-input,
	.intent-textarea {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-primary, oklch(0.25 0.01 60));
		padding: 0.625rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: #ffffff;
		resize: vertical;
		transition:
			border-color var(--timing-slow) var(--easing),
			box-shadow var(--timing-slow) var(--easing);
	}

	.intent-input:focus,
	.intent-textarea:focus {
		outline: none;
		border-color: var(--coord-route-solid, #3bc4b8);
		box-shadow: 0 0 0 3px oklch(0.7 0.13 190 / 0.12);
	}

	.intent-input:disabled,
	.intent-textarea:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.intent-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.intent-action-contract {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.35rem 0.75rem;
		padding: 0.625rem 0.75rem;
		border-left: 2px solid transparent;
		background: oklch(0.988 0.004 60);
	}

	@media (min-width: 860px) {
		.intent-action-contract {
			grid-template-columns: minmax(0, 1fr) 5.25rem minmax(7rem, auto) auto auto;
			align-items: center;
		}
	}

	.intent-action-main {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.intent-action-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.intent-action-effect,
	.intent-action-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.38;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.intent-action-gate {
		color: oklch(0.44 0.012 60);
	}

	.intent-action-state,
	.intent-action-label {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.2;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.48 0.02 60);
		white-space: nowrap;
	}

	.intent-action-label {
		text-transform: none;
		letter-spacing: 0;
		color: oklch(0.5 0.012 60);
	}

	.intent-action-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		white-space: nowrap;
	}

	.intent-action-contract[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}

	.intent-action-contract[data-state='live'] .intent-action-state,
	.intent-action-contract[data-state='live'] .intent-action-label {
		color: var(--coord-verified, #10b981);
	}

	.intent-action-contract[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}

	.intent-action-contract[data-state='partial'] .intent-action-state,
	.intent-action-contract[data-state='partial'] .intent-action-label {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.intent-action-contract[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}

	.intent-run {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		letter-spacing: 0.01em;
		padding: 0.625rem 1.25rem;
		border-radius: 8px;
		border: none;
		background: var(--coord-route-solid, #3bc4b8);
		color: #ffffff;
		cursor: pointer;
		transition: filter var(--timing-slow) var(--easing);
	}
	.intent-run:hover:not(:disabled),
	.intent-run:focus-visible:not(:disabled) {
		filter: brightness(1.06);
		outline: none;
	}
	.intent-run:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.intent-run--stop {
		background: oklch(0.55 0.18 30);
	}

	.intent-error {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.5 0.18 30);
	}

	/* ─── Products ─── */
	.studio-products {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Decision-makers */
	.dm {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	.dm-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.dm-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.dm-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
	}
	.dm :global(.dm-count-num) {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.dm-count-label,
	.dm-dropped {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--text-tertiary, #6b7280);
	}
	.dm :global(.dm-dropped-num) {
		font-size: 0.6875rem;
		color: var(--text-tertiary, #9ca3af);
	}
	.dm-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.dm-item {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: #ffffff;
	}
	.dm-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.dm-role {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b7280);
	}
	.dm-email {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: var(--coord-verified, #10b981);
	}
	.dm-noemail {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: var(--text-tertiary, #9ca3af);
	}

	/* Authored output contract */
	.output-contract {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}

	.output-contract-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.output-contract-kicker,
	.output-contract-state,
	.output-contract-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.2;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.output-contract-kicker {
		margin: 0;
		color: oklch(0.52 0.012 250);
	}

	.output-contract-title {
		margin: 0.125rem 0 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.95rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.output-contract-count,
	.output-contract-metric {
		display: inline-flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.output-pressure {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.5rem;
	}

	@media (max-width: 980px) {
		.output-pressure {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 560px) {
		.output-pressure {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.output-pressure-cell {
		display: grid;
		min-width: 0;
		min-height: 7.25rem;
		gap: 0.35rem;
		align-content: start;
		padding: 0.625rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-radius: 8px;
		background: var(--surface-overlay, oklch(0.975 0.005 55));
	}

	.output-pressure-cell[data-state='live'] {
		border-color: var(--coord-verified, #10b981);
		background: var(--surface-base, oklch(0.993 0.003 60));
	}

	.output-pressure-cell[data-state='partial'] {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: var(--surface-base, oklch(0.993 0.003 60));
	}

	.output-pressure-cell[data-state='draft-only'] {
		border-color: oklch(0.78 0.12 82 / 0.62);
		background: oklch(0.985 0.006 70);
	}

	.output-pressure-cell[data-state='gated'] {
		border-style: dashed;
		opacity: 0.84;
	}

	.output-pressure-label,
	.output-pressure-value,
	.output-pressure-next {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.output-pressure-label {
		font-weight: 700;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.output-pressure-value {
		display: inline-flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.25rem;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.output-pressure-ground,
	.output-pressure-next {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.output-pressure-ground {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.3;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.output-pressure-next {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.output-contract-list {
		display: grid;
		gap: 0.25rem;
	}

	.output-contract-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.35rem;
		padding: 0.55rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
	}

	@media (min-width: 860px) {
		.output-contract-row {
			grid-template-columns: minmax(10rem, 1fr) 5.25rem 10rem auto minmax(0, 1.15fr);
			align-items: baseline;
		}
	}

	.output-contract-main {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.output-contract-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.output-contract-detail,
	.output-contract-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.output-contract-action {
		color: oklch(0.5 0.012 60);
		text-transform: none;
		letter-spacing: 0;
		white-space: nowrap;
	}

	.output-contract-row[data-state='live'] .output-contract-state,
	.output-contract-row[data-state='live'] .output-contract-action {
		color: var(--coord-verified, #10b981);
	}

	.output-contract-row[data-state='partial'] .output-contract-state,
	.output-contract-row[data-state='partial'] .output-contract-action {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.output-contract-row[data-state='draft-only'] {
		border-top-style: dashed;
	}

	.output-contract-row[data-state='draft-only'] .output-contract-state,
	.output-contract-row[data-state='draft-only'] .output-contract-action {
		color: oklch(0.62 0.12 78);
	}

	.output-contract-row[data-state='gated'] {
		border-top-style: dashed;
	}

	.output-contract-row[data-state='gated'] .output-contract-state,
	.output-contract-row[data-state='gated'] .output-contract-action {
		color: oklch(0.48 0.02 60);
	}

	.trace-replay {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-radius: 8px;
		padding: 1rem;
		background: var(--surface-base, oklch(0.993 0.003 60));
	}

	.trace-replay-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.trace-replay-kicker,
	.trace-event-type {
		margin: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0;
		text-transform: uppercase;
		color: var(--coord-route-solid, #3bc4b8);
	}

	.trace-replay-title {
		margin: 0.125rem 0 0;
		font-size: 1rem;
		font-weight: 650;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.trace-replay-controls {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.625rem;
	}

	.trace-replay-count,
	.trace-event-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		font-size: 0.72rem;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.trace-replay-load {
		min-height: 2rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-radius: 6px;
		padding: 0.35rem 0.625rem;
		background: var(--surface-overlay, oklch(0.975 0.005 55));
		font-size: 0.75rem;
		font-weight: 650;
		color: var(--text-primary, oklch(0.25 0.01 60));
		cursor: pointer;
	}

	.trace-replay-load:disabled {
		cursor: wait;
		opacity: 0.62;
	}

	.trace-replay-boundary,
	.trace-replay-error {
		margin: 0;
		max-width: 72ch;
		font-size: 0.78rem;
		line-height: 1.55;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.trace-replay-error {
		color: var(--coord-risk, #e76f51);
	}

	.trace-replay-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.trace-replay-event {
		display: grid;
		grid-template-columns: minmax(5rem, auto) minmax(8rem, 0.8fr) minmax(0, 2fr) auto auto;
		align-items: baseline;
		gap: 0.625rem;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
		padding-top: 0.5rem;
	}

	.trace-event-time {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.trace-event-summary {
		min-width: 0;
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	@media (max-width: 740px) {
		.trace-replay-head,
		.trace-replay-controls {
			align-items: flex-start;
			flex-direction: column;
		}

		.trace-replay-event {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	/* Specimen (authored message) */
	.specimen {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	.specimen-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.specimen-subject {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0 0 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.specimen-para {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.6;
		color: var(--text-secondary, oklch(0.32 0.01 60));
		margin: 0 0 0.75rem;
		white-space: pre-wrap;
	}
	.specimen-para:last-child {
		margin-bottom: 0;
	}
</style>
