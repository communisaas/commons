import implementationTasksJson from '../../../docs/strategy/implementation-hypergraph/nodes/tasks.json';
import chokepointsJson from '../../../docs/strategy/implementation-hypergraph/nodes/chokepoints.json';
import unblocksJson from '../../../docs/strategy/implementation-hypergraph/edges/unblocks.json';
import nextImplementationTasksJson from '../../../docs/strategy/next-implementation-hypergraph/nodes/tasks.json';
import nextChokepointsJson from '../../../docs/strategy/next-implementation-hypergraph/nodes/chokepoints.json';
import nextUnblocksJson from '../../../docs/strategy/next-implementation-hypergraph/edges/unblocks.json';
import dataTasksJson from '../../../docs/strategy/data-hypergraph/nodes/tasks.json';
import {
	formatPeopleSourceLabel,
	PLATFORM_API_RUNNER_PROOF_REQUIREMENTS,
	PLATFORM_EXPORT_PROFILES
} from './platform-export-profiles';

export type CapabilityState = 'live' | 'partial' | 'draft-only' | 'gated';
export type HypergraphStatus = 'not_started' | 'in_progress' | 'blocked' | 'completed' | 'deferred';

type ImplementationTask = {
	id: string;
	name: string;
	clusters?: string[];
	wave?: string;
	status?: string;
	carryover_from?: string | null;
};

type DataTask = ImplementationTask & {
	verdict?: 'honest' | 'gap';
};

type Chokepoint = {
	id: string;
	target_task_id?: string;
	task_id?: string;
	name: string;
	downstream_count?: number;
	unblocks_count?: number;
	elapsed_time_dependency?: string;
	gate_kind?: string;
	gate_owner?: string;
	rationale?: string;
	wave?: string;
};

type UnblockEdge = {
	chokepoint_id?: string;
	chokepoint?: string | null;
	source: string;
	downstream_count?: number;
	fan_out_semantics?: string;
	elapsed_time_dependency?: string;
	wave_lift?: string;
	wave_transition?: string;
	targets?: string[];
};

type TaskRollup = {
	state: CapabilityState;
	status: HypergraphStatus;
	taskIds: string[];
	tasks: string;
	completed: number;
	total: number;
	waves: string;
	clusters: string;
	source: string;
};

export type GateEvidence = TaskRollup & {
	id: string;
	name: string;
	downstream: number;
	dependency: string;
	chokepoint: string;
	semantics: string;
};

export type GateEvidenceSummaryOptions = {
	prefix?: string;
	complete?: string;
	density?: 'audit' | 'operator';
};

export type DataHonestyEvidence = {
	state: CapabilityState;
	status: HypergraphStatus;
	mark: string;
	evidence: string;
	gate: string;
	source: string;
};

export type LaunchPressureRow = {
	id: string;
	order: number;
	name: string;
	state: CapabilityState;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	effect: string;
	nextLift: string;
	currentGround: string;
	blocked: string;
	futureLift: string;
	gate: GateEvidence;
	cluster: string;
};

export type LaunchPressureInputs = {
	base: string;
	emailDeliveryHref: string;
	abAutomationState: CapabilityState;
	civicGeographyLabelsState: CapabilityState;
	serverDispatchRuntimeReady?: boolean | null;
	serverDispatchRuntimeMissing?: string[] | null;
	serverDispatchRuntimeDependency?: string | null;
	textDispatchRuntimeReady?: boolean | null;
	textDispatchRuntimeMissing?: string[] | null;
	textDispatchRuntimeDependency?: string | null;
	textDispatchClientBatchRouteMounted?: boolean | null;
	platformApiSyncRuntimeReady?: boolean | null;
	platformApiSyncRuntimeMissing?: string[] | null;
	platformApiSyncRuntimeDependency?: string | null;
	features: {
		AB_TESTING: boolean;
		EMAIL_SERVER_DISPATCH: boolean;
		SMS_DISPATCH: boolean;
		WORKFLOW_EXECUTION: boolean;
	};
	gates: {
		platformApiGate: GateEvidence;
		smsDispatchGate: GateEvidence;
		donationReceiptGate: GateEvidence;
		abAutomationGate: GateEvidence;
		civicGeographyLabelsGate: GateEvidence;
		workflowEffectsGate: GateEvidence;
		emailProxyGate: GateEvidence;
		listUnsubscribeProviderGate: GateEvidence;
		customDomainGate: GateEvidence;
		readerOfficeGate: GateEvidence;
		mainnetGate: GateEvidence;
		teeGate: GateEvidence;
		delegationGate: GateEvidence;
	};
};

export type LaunchPressureSummary = {
	count: number;
	state: CapabilityState;
	gate: string;
};

export type GateRegisterRow = {
	id: string;
	name: string;
	state: CapabilityState;
	gate: GateEvidence;
	blocks: string;
	unlocks: string;
};

export type GateRegisterInputs = {
	features: {
		DELEGATION: boolean;
	};
	gates: {
		eventRecordsGate: GateEvidence;
		platformApiGate: GateEvidence;
		emailProxyGate: GateEvidence;
		smsDispatchGate: GateEvidence;
		donationReceiptGate: GateEvidence;
		abAutomationGate: GateEvidence;
		civicGeographyLabelsGate: GateEvidence;
		workflowEffectsGate: GateEvidence;
		congressionalLaunchGate: GateEvidence;
		mainnetGate: GateEvidence;
		teeGate: GateEvidence;
		studioJurisdictionScopeGate: GateEvidence;
		messageProofGate: GateEvidence;
		delegationGate: GateEvidence;
		readerOfficeGate: GateEvidence;
	};
};

export type GateRegisterSummary = {
	completedCount: number;
	unresolvedCount: number;
	loadBearingGate: GateRegisterRow | null;
	loadBearingGateSummary: string;
};

export type CriticalPathRow = {
	id: string;
	order: number;
	name: string;
	state: CapabilityState;
	gate: GateEvidence;
	today: string;
	lift: string;
	dependency: string;
	elapsed: string;
	clusters: string;
};

export type CriticalPathInputs = {
	gates: {
		eventRecordsGate: GateEvidence;
		mainnetGate: GateEvidence;
		teeGate: GateEvidence;
		studioJurisdictionScopeGate: GateEvidence;
		messageProofGate: GateEvidence;
		delegationGate: GateEvidence;
		readerOfficeGate: GateEvidence;
	};
};

export type CriticalPathSummary = {
	liveCount: number;
	unresolvedCount: number;
	state: CapabilityState;
	loadBearingRow: CriticalPathRow | null;
	loadBearingSummary: string;
};

export type SendReadinessModeKey =
	| 'browser-direct'
	| 'client-merge'
	| 'server-email'
	| 'ab-automation'
	| 'sms'
	| 'events'
	| 'workflow'
	| 'cwc';

export type SendReadinessMode = {
	key: SendReadinessModeKey;
	label: string;
	phase: 'SEND' | 'SEND / AGGREGATE' | 'AGGREGATE';
	cluster: string;
	state: CapabilityState;
	route: string;
	action: string;
	handoff: string;
	effect: string;
	unlock: string;
	metric?: {
		value: number | null;
		label: string;
		cite: string;
	};
};

const compactSendModeLabels: Record<SendReadinessModeKey, string> = {
	'browser-direct': 'browser email',
	'client-merge': 'merge',
	'server-email': 'server email',
	'ab-automation': 'A/B continuation',
	sms: 'text',
	events: 'events',
	workflow: 'workflow',
	cwc: 'CWC'
};

function formatHeldSendModeSummary(modes: SendReadinessMode[]): string {
	if (modes.length === 0) return 'no held handoffs';
	const labels = modes.map((mode) => compactSendModeLabels[mode.key] ?? mode.label);
	if (labels.length === 1) return `${labels[0]} held`;
	if (labels.length <= 3) return `${labels.join(' / ')} held`;
	return `${labels.slice(0, 3).join(' / ')} +${labels.length - 3} held`;
}

type EmailDeliveryGround = {
	subscribedCount: number;
	clientDirectThreshold: number;
	orgKeyConfigured: boolean;
	sesProxyConfigured: boolean;
	serverDispatchRuntimeReady?: boolean;
	serverDispatchRuntimeMissing?: string[];
	serverDispatchRuntimeDependency?: string;
	serverDispatchRuntimeMessage?: string;
};

type TextDispatchGround = {
	runtimeReady?: boolean;
	runtimeMissing?: string[];
	runtimeDependency?: string;
	runtimeMessage?: string;
	clientBatchRouteMounted?: boolean;
};

type CongressionalDeliveryGround = {
	runtimeReady?: boolean;
	runtimeMissing?: string[];
	runtimeDependency?: string;
	runtimeMessage?: string;
	launched?: boolean;
	houseTransportConfigured?: boolean;
	senateTransportConfigured?: boolean;
};

export type SendReadinessInputs = {
	base: string;
	emailDeliveryHref: string;
	canPublish: boolean;
	emailDelivery: EmailDeliveryGround | null;
	textDispatch?: TextDispatchGround | null;
	congressionalDelivery?: CongressionalDeliveryGround | null;
	fallbackSubscribedCount: number | null;
	features: {
		EMAIL_CLIENT_DIRECT_MERGE: boolean;
		EMAIL_SERVER_DISPATCH: boolean;
		AB_TESTING: boolean;
		SMS_DISPATCH: boolean;
		EVENTS: boolean;
		WORKFLOW_EXECUTION: boolean;
		CONGRESSIONAL: boolean;
	};
	gates: {
		emailProxyGate: GateEvidence;
		abAutomationGate: GateEvidence;
		smsDispatchGate: GateEvidence;
		eventArtifactGate: GateEvidence;
		workflowEffectsGate: GateEvidence;
		congressionalLaunchGate: GateEvidence;
	};
};

export type SendReadinessSummary = {
	modes: SendReadinessMode[];
	state: CapabilityState;
	heldCount: number;
	heldModeSummary: string;
	sendBoundarySummary: string;
	sendBoundaryGate: string;
	browserDirectState: CapabilityState;
	browserDirectSignal: string;
	browserDirectGate: string;
	clientDirectMergeState: CapabilityState;
	clientDirectMergeGate: string;
	nextHeldMode: SendReadinessMode | null;
	nextHeldLabel: string;
	nextHeldState: CapabilityState;
	nextHeldGate: string;
};

export type EmailDeliveryEvidenceRowKey =
	| 'delivery-record'
	| 'engagement-telemetry'
	| 'receipt-evidence'
	| 'experiment-continuation'
	| 'list-health-response'
	| 'receipt-register'
	| 'dispatch-outcomes'
	| 'recipient-privacy'
	| 'anchored-receipt-proof';

export type EmailDeliveryEvidenceRow = {
	id: EmailDeliveryEvidenceRowKey;
	label: string;
	state: CapabilityState;
	phase: 'AUTHOR / SEND' | 'SEND / AGGREGATE' | 'AGGREGATE';
	cluster: string;
	href: string;
	action: string;
	handoff: string;
	detail: string;
	unlock: string;
	gate: GateEvidence;
	metric?: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type EmailDeliveryEvidenceInputs = {
	base: string;
	blastId: string;
	delivery: {
		status: string;
		totalSent: number;
		totalOpened?: number | null;
		totalClicked?: number | null;
		totalBounced?: number | null;
		totalComplained?: number | null;
		receiptPageCount: number;
		receiptSentCount?: number | null;
		receiptFailedCount?: number | null;
		receiptHasMore: boolean;
		engagementMetricsEnabled: boolean;
		hasExperimentView?: boolean | null;
		abWinnerPickedAt?: string | null;
		hasDraftAbVariant?: boolean | null;
		hasQueuedOrSentAbVariant?: boolean | null;
		hasDraftRemainder?: boolean | null;
		hasQueuedOrSentRemainder?: boolean | null;
		hasRemainderDraft?: boolean | null;
		abRemainderCount?: number | null;
		serverDispatchRuntimeArmed?: boolean | null;
	};
	receiptRegister?: {
		rowCount: number;
		sentCount: number;
		failedCount: number;
		hasMore: boolean;
	} | null;
	gates: {
		emailProxyGate: GateEvidence;
		receiptAnchoringGate: GateEvidence;
		abAutomationGate: GateEvidence;
		listHealthGate: GateEvidence;
		engagementTelemetryGate: GateEvidence;
	};
};

export type EmailDeliveryEvidenceSummary = {
	rows: EmailDeliveryEvidenceRow[];
	detailRows: EmailDeliveryEvidenceRow[];
	receiptRegisterRows: EmailDeliveryEvidenceRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	totalSent: number;
	suppressedSignal: number;
	receiptPageCount: number;
	receiptRegisterRowCount: number;
	failedReceiptCount: number;
};

export type StudioScopeReadinessRow = {
	key: 'jurisdiction-scope' | 'message-recovery' | 'trace-replay';
	label: string;
	state: CapabilityState;
	signal: string;
	gate: string;
};

export type StudioScopeReadinessInputs = {
	gates: {
		studioJurisdictionScopeGate: GateEvidence;
		messageProofGate: GateEvidence;
		delegatedTraceGate: GateEvidence;
	};
};

export type StudioScopeReadinessSummary = {
	rows: StudioScopeReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	boundaryCount: number;
};

export type StudioAuthoringReadinessRowKey =
	| 'intent'
	| 'model-provider'
	| 'source-search'
	| 'page-read-evaluation'
	| 'resolve'
	| 'source-grounding'
	| 'message-composition'
	| 'draft-handoff'
	| 'recovery-envelope'
	| 'trace-replay'
	| 'delegated-action';

export type StudioAuthoringReadinessRow = {
	key: StudioAuthoringReadinessRowKey;
	label: string;
	state: CapabilityState;
	phase: 'INTENT' | 'RESOLVE' | 'GROUND' | 'AUTHOR' | 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	signal: string;
	ground: string;
	gate: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type ResolutionStopReason = 'no-target' | 'no-public-email' | 'stopped' | 'unknown';

export type StudioProcessEvidence = {
	processCount: number;
	runningCount: number;
	restoredCount: number;
	focusedStatus: string | null;
	contactableTargetCount: number;
	droppedTargetCount: number;
	resolutionStopReason: ResolutionStopReason | null;
	resolutionStopDetail: string | null;
	sourceEvidenceObserved: boolean;
	sourceEvidenceCount: number;
	sourceEvidenceMode: 'discovery' | 'preverified' | null;
	sourceEvidenceEvaluationFallback: boolean;
	sourceEvidenceCandidateCount: number | null;
	sourceEvidenceFailedCount: number | null;
	sourceEvidenceSearchQueryCount: number | null;
	evaluatedSourceCount: number;
	searchOnlySourceCount: number;
	messageParagraphCount: number;
	draftHandoffCount: number;
	hasComposedMessage: boolean;
	hasRecoveryJob: boolean;
	recoveryJobStatus: string | null;
	hasTraceHandle: boolean;
	scopeLabel: string | null;
	scopeSource: string | null;
};

export type StudioAuthoringRuntimeGround = {
	runtimeReady: boolean;
	modelProviderConfigured?: boolean | null;
	sourceSearchConfigured?: boolean | null;
	sourceFetchConfigured?: boolean | null;
	runtimeMissing?: string[] | null;
	runtimeDependency?: string | null;
	runtimeMessage?: string | null;
};

export type StudioAuthoringReadinessInputs = {
	base: string;
	process?: StudioProcessEvidence | null;
	runtime?: StudioAuthoringRuntimeGround | null;
	gates: {
		studioJurisdictionScopeGate: GateEvidence;
		messageProofGate: GateEvidence;
		delegatedTraceGate: GateEvidence;
		delegatedActionGate: GateEvidence;
	};
};

export type StudioAuthoringReadinessSummary = {
	rows: StudioAuthoringReadinessRow[];
	state: CapabilityState;
	runtimeLoaded: boolean;
	runtimeReady: boolean;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	processEvidence: StudioProcessEvidence | null;
	boundaryCount: number;
	liveStepCount: number;
};

export type MessageGenerationEvidenceRowKey =
	| 'intent-input'
	| 'target-basis'
	| 'stream-phase'
	| 'output-basis'
	| 'source-basis'
	| 'research-trace'
	| 'delivery-handoff'
	| 'recovery-job'
	| 'trace-handle'
	| 'proof-binding';

export type MessageGenerationEvidencePhase =
	| 'preparing'
	| 'sources'
	| 'message'
	| 'complete'
	| 'recovering'
	| null;

export type MessageGenerationEvidenceRow = {
	key: MessageGenerationEvidenceRowKey;
	label: string;
	state: CapabilityState;
	phase: 'INTENT' | 'RESOLVE' | 'GROUND' | 'AUTHOR' | 'SEND' | 'AGGREGATE';
	clusters: string;
	signal: string;
	action: string;
	effect: string;
	ground: string;
	gate: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type MessageGenerationEvidenceInputs = {
	intentFieldCount: number;
	targetCount: number;
	phase: MessageGenerationEvidencePhase;
	paragraphCount: number;
	sourceCount: number;
	evaluatedSourceCount?: number;
	searchOnlySourceCount?: number;
	sourceEvidenceObserved?: boolean;
	researchStepCount: number;
	hasRecoveryJob: boolean;
	recoveryJobStatus: string | null;
	traceHandle: string | null;
	messageProofGate: GateEvidence;
};

export type MessageGenerationEvidenceSummary = {
	rows: MessageGenerationEvidenceRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	liveCount: number;
	boundaryCount: number;
};

export const MESSAGE_GENERATION_SPINE_ROW_KEYS: MessageGenerationEvidenceRowKey[] = [
	'intent-input',
	'target-basis',
	'source-basis',
	'output-basis',
	'delivery-handoff'
];

export function messageGenerationSpineRows(
	rows: MessageGenerationEvidenceRow[]
): MessageGenerationEvidenceRow[] {
	return MESSAGE_GENERATION_SPINE_ROW_KEYS.map((key) => rows.find((row) => row.key === key)).filter(
		(row): row is MessageGenerationEvidenceRow => Boolean(row)
	);
}

export type StudioDraftHandoffDestination = 'public-action-template' | 'email-composer';

export type StudioDraftHandoffRow = {
	label: string;
	state: CapabilityState;
	action: string;
	effect: string;
	gate: string;
	clusters: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type StudioDraftHandoffInputs = {
	destination: StudioDraftHandoffDestination;
	targetCount: number;
	evaluatedSourceCount: number;
	searchOnlySourceCount: number;
	scopeLabel?: string | null;
	scopeBasis?: string | null;
	scopeSource?: string | null;
	scopeMetricCite: string;
	recoveryJobPresent: boolean;
	recoveryJobStatus?: string | null;
	recoveryMetricCite: string;
	traceHandle?: string | null;
	traceMetricCite: string;
	draftEffect: string;
	draftMetricCite: string;
	messageProofGate: GateEvidence;
};

function countWithLabel(count: number, label: string): string {
	return `${count} ${label}${count === 1 ? '' : 's'}`;
}

export function buildStudioDraftHandoffRows(
	input: StudioDraftHandoffInputs
): StudioDraftHandoffRow[] {
	const {
		destination,
		targetCount,
		evaluatedSourceCount,
		searchOnlySourceCount,
		scopeLabel,
		scopeBasis,
		scopeSource,
		scopeMetricCite,
		recoveryJobPresent,
		recoveryJobStatus,
		recoveryMetricCite,
		traceHandle,
		traceMetricCite,
		draftEffect,
		draftMetricCite,
		messageProofGate
	} = input;
	const publicAction = destination === 'public-action-template';
	const draftAction = publicAction ? 'edit public action draft' : 'edit composer draft';
	const draftGate = publicAction
		? 'Imported Studio output is a public action draft, not a published action, send, or proof-bearing delivery.'
		: 'Imported Studio output is a composer draft, not a sent email or receipt-bearing action.';
	const targetGate = publicAction
		? 'Studio resolution evidence constrains authoring; the public action route still owns publish confirmation.'
		: 'Studio resolution evidence constrains authoring; this email route still owns recipient cohort selection.';
	const sourceCarrier = publicAction ? 'drafted artifact' : 'email body';
	const sourceRouteBoundary = publicAction
		? 'delivery proof and receipt evidence require separate routes.'
		: 'delivery proof and receipt evidence still require a send path.';
	const sourceEffect =
		evaluatedSourceCount > 0 && searchOnlySourceCount > 0
			? `${countWithLabel(evaluatedSourceCount, 'evaluated source')} and ${countWithLabel(searchOnlySourceCount, 'search-only source')} ${publicAction ? 'are attached to this' : 'were carried into the'} ${sourceCarrier} as source context.`
			: evaluatedSourceCount > 0
				? `${countWithLabel(evaluatedSourceCount, 'evaluated source')} ${evaluatedSourceCount === 1 ? (publicAction ? 'is' : 'was') : publicAction ? 'are' : 'were'} ${publicAction ? 'attached to this' : 'carried into the'} ${sourceCarrier} as source context.`
				: searchOnlySourceCount > 0
					? `${countWithLabel(searchOnlySourceCount, 'search-only fallback source')} ${searchOnlySourceCount === 1 ? (publicAction ? 'is' : 'was') : publicAction ? 'are' : 'were'} ${publicAction ? 'attached for context' : 'carried for context'}; do not imply evaluated citation support.`
					: 'The Studio draft did not carry evaluated source rows; do not imply citation support.';
	const scopeEffect = scopeLabel
		? publicAction
			? `The handoff carries ${scopeLabel} scope for the drafted artifact.`
			: `Studio applied ${scopeLabel} before message grounding.`
		: publicAction
			? 'No geographic scope was carried into this public action draft.'
			: 'No Studio geographic scope label was carried into this draft.';
	const scopeGate =
		scopeBasis ??
		(publicAction
			? 'Scope is authoring ground for the draft; jurisdictional delivery proof remains route-owned.'
			: 'Studio scope is heuristic until full jurisdiction resolution lands.');
	const proofPrefix = publicAction
		? 'Public action handoff is live as a draft transfer; artifact proof binding remains bounded.'
		: 'Email composer handoff is live as a draft transfer; artifact proof binding remains bounded.';

	return [
		{
			label: 'Draft handoff',
			state: 'draft-only',
			action: draftAction,
			effect: draftEffect,
			gate: draftGate,
			clusters: 'C-reader-side / C-data-sovereignty',
			metric: {
				value: 1,
				label: 'draft imported',
				cite: draftMetricCite
			}
		},
		{
			label: 'Target basis',
			state: targetCount > 0 ? 'live' : 'gated',
			action: targetCount > 0 ? 'read target basis' : 'resolve targets',
			effect:
				targetCount > 0
					? publicAction
						? 'Resolved decision-maker ground survived the Studio to public-action handoff.'
						: 'The Studio run carried resolved decision-maker ground into this draft.'
					: 'No resolved decision-maker ground was carried with this draft.',
			gate: targetGate,
			clusters: 'C-composability / C-accountability',
			metric: {
				value: targetCount,
				label: 'resolved targets',
				cite: publicAction
					? 'TemplateFormData.audience.decisionMakers'
					: 'orgEmailComposeDraft metadata.decisionMakerCount'
			}
		},
		{
			label: 'Source basis',
			state: evaluatedSourceCount > 0 ? 'live' : 'partial',
			action:
				evaluatedSourceCount > 0
					? 'read source basis'
					: searchOnlySourceCount > 0
						? 'qualify search-only source ground'
						: 'qualify source gap',
			effect: sourceEffect,
			gate: `Source evidence is inherited from the Studio stream; search-only fallback remains bounded context, and ${sourceRouteBoundary}`,
			clusters: 'C-quality-signaling / C-accountability',
			metric: {
				value: evaluatedSourceCount,
				label: 'evaluated sources',
				cite: publicAction
					? 'TemplateFormData.content.sources'
					: 'orgEmailComposeDraft metadata.evaluatedSourceCount'
			}
		},
		{
			label: 'Scope basis',
			state: scopeLabel ? 'partial' : 'gated',
			action: scopeLabel ? 'read scope' : 'resolve scope',
			effect: scopeEffect,
			gate: scopeGate,
			clusters: 'C-verification / C-coordination-integrity',
			metric: {
				value: scopeLabel ? 1 : null,
				label: scopeLabel ? (scopeSource ?? scopeLabel) : 'scope not carried',
				cite: scopeMetricCite
			}
		},
		{
			label: 'Recovery handle',
			state: recoveryJobPresent ? 'partial' : 'gated',
			action: recoveryJobPresent ? 'read recovery handle' : 'read recovery gap',
			effect: recoveryJobPresent
				? 'The Studio recoverable message job handle survived the handoff for operator provenance.'
				: 'No recoverable message job handle was carried with this draft.',
			gate: 'Recovery is same-device message-output recovery; it is not server-side process persistence or proof-bound execution.',
			clusters: 'C-agentic / C-data-sovereignty',
			metric: {
				value: recoveryJobPresent ? 1 : null,
				label: recoveryJobStatus ?? 'no job',
				cite: recoveryMetricCite
			}
		},
		{
			label: 'Trace handle',
			state: traceHandle ? 'partial' : 'gated',
			action: traceHandle ? 'read trace handle' : 'read trace gap',
			effect: traceHandle
				? 'The Studio stream emitted an operator observability handle.'
				: 'No trace handle was emitted or carried with this draft.',
			gate: 'Trace handles are operator observability evidence; delegated trace replay remains separately gated.',
			clusters: 'C-agentic / C-accountability',
			metric: {
				value: traceHandle ? 1 : null,
				label: traceHandle ?? 'no trace',
				cite: traceMetricCite
			}
		},
		{
			label: 'Proof binding',
			state: messageProofGate.state === 'live' ? 'live' : 'gated',
			action: 'read proof boundary',
			effect:
				messageProofGate.state === 'live'
					? 'Authored artifacts can be attached to proof-bound drafted messages.'
					: 'This remains a recoverable draft artifact, not a proof-bound delegated action.',
			gate: formatGateEvidence(messageProofGate, { prefix: proofPrefix }),
			clusters: 'C-accountability / C-reader-side',
			metric: {
				value: messageProofGate.state === 'live' ? 1 : null,
				label: messageProofGate.state === 'live' ? 'armed' : 'not armed',
				cite: messageProofGate.source
			}
		}
	];
}

export type PublicActionPublishRowKey =
	| 'publish-record'
	| 'action-route'
	| 'target-basis'
	| 'source-basis'
	| 'proof-binding';

export type PublicActionPublishContractRow = {
	id: PublicActionPublishRowKey;
	label: string;
	state: CapabilityState;
	action: string;
	effect: string;
	gate: string;
	clusters: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type PublicActionPublishContractInputs = {
	isPublished: boolean;
	publishing: boolean;
	isDraft: boolean;
	targetCount: number;
	evaluatedSourceCount: number;
	searchOnlySourceCount: number;
	messageProofGate: GateEvidence;
};

export function buildPublicActionPublishContractRows(
	input: PublicActionPublishContractInputs
): PublicActionPublishContractRow[] {
	const {
		isPublished,
		publishing,
		isDraft,
		targetCount,
		evaluatedSourceCount,
		searchOnlySourceCount,
		messageProofGate
	} = input;
	const publishRecordState: CapabilityState = publishing
		? 'partial'
		: isDraft
			? 'draft-only'
			: isPublished
				? 'live'
				: 'gated';
	const actionRouteState: CapabilityState = isPublished
		? 'live'
		: publishing
			? 'partial'
			: isDraft
				? 'draft-only'
				: 'gated';
	const sourceBasisState: CapabilityState = evaluatedSourceCount > 0 ? 'live' : 'partial';
	const sourceBasisEffect =
		evaluatedSourceCount > 0 && searchOnlySourceCount > 0
			? `${countWithLabel(evaluatedSourceCount, 'evaluated source')} and ${countWithLabel(searchOnlySourceCount, 'search-only source')} were saved with the public action.`
			: evaluatedSourceCount > 0
				? `${countWithLabel(evaluatedSourceCount, 'evaluated source')} ${evaluatedSourceCount === 1 ? 'was' : 'were'} saved with the public action.`
				: searchOnlySourceCount > 0
					? `${countWithLabel(searchOnlySourceCount, 'search-only fallback source')} ${searchOnlySourceCount === 1 ? 'was' : 'were'} saved for context; do not imply evaluated citation support.`
					: 'No evaluated source rows were returned with this publish response; do not imply citation support here.';

	return [
		{
			id: 'publish-record',
			label: 'Publish record',
			state: publishRecordState,
			action: isPublished
				? 'read publish record'
				: publishing
					? 'wait publish record'
					: isDraft
						? 'revise draft'
						: 'retry publish',
			effect: isPublished
				? 'The server confirmed a public action template record; share controls can appear.'
				: publishing
					? 'The public action is not confirmed yet; share controls remain held.'
					: isDraft
						? 'The action remains private until review approves it.'
						: 'No public action record was confirmed for this attempt.',
			gate: 'Share controls unlock only after /api/templates returns a public template with published status.',
			clusters: 'C-reader-side / C-data-sovereignty',
			metric: {
				value: isPublished ? 1 : null,
				label: isPublished
					? 'published'
					: publishing
						? 'pending'
						: isDraft
							? 'draft held'
							: 'not saved',
				cite: '/api/templates POST + templates.createTemplate'
			}
		},
		{
			id: 'action-route',
			label: 'Action route',
			state: actionRouteState,
			action: isPublished ? 'open action page' : 'read route boundary',
			effect:
				'The public action page owns reader confirmation; this modal does not count send, receipt, or proof side effects.',
			gate: 'Reader-side confirmation opens at /s/[slug]; route completion and delivery proof stay outside the publish modal.',
			clusters: 'C-reader-side / C-accountability',
			metric: {
				value: isPublished ? 1 : null,
				label: isPublished ? 'route live' : 'route held',
				cite: 'TemplateSuccessModal shareUrl'
			}
		},
		{
			id: 'target-basis',
			label: 'Target basis',
			state: targetCount > 0 ? 'live' : 'gated',
			action: targetCount > 0 ? 'read target basis' : 'resolve targets',
			effect:
				targetCount > 0
					? 'The published action carries resolved recipient ground into the reader route.'
					: 'No recipient ground is attached to this published action response.',
			gate: 'Target ground is saved in recipient_config; reader confirmation still selects the actual route participant.',
			clusters: 'C-reach / C-accountability',
			metric: {
				value: targetCount,
				label: 'targets',
				cite: 'template.recipient_config'
			}
		},
		{
			id: 'source-basis',
			label: 'Source basis',
			state: sourceBasisState,
			action:
				evaluatedSourceCount > 0
					? 'read source basis'
					: searchOnlySourceCount > 0
						? 'qualify search-only source ground'
						: 'qualify source gap',
			effect: sourceBasisEffect,
			gate: 'Saved sources and research log are authoring evidence; search-only fallback remains bounded context, and delivery receipt or proof-bound execution require separate routes.',
			clusters: 'C-quality-signaling / C-accountability',
			metric: {
				value: evaluatedSourceCount,
				label: 'evaluated sources',
				cite: 'template.sources + template.research_log'
			}
		},
		{
			id: 'proof-binding',
			label: 'Proof binding',
			state: messageProofGate.state === 'live' ? 'live' : 'gated',
			action: 'read proof boundary',
			effect:
				messageProofGate.state === 'live'
					? 'Published action artifacts can attach to proof-bound drafted messages.'
					: 'Publishing creates a public action route, not a proof-bound delegated action.',
			gate: formatGateEvidence(messageProofGate, {
				prefix: 'Published action route is live; artifact proof binding remains bounded.'
			}),
			clusters: 'C-accountability / C-reader-side',
			metric: {
				value: messageProofGate.state === 'live' ? 1 : null,
				label: messageProofGate.state === 'live' ? 'armed' : 'not armed',
				cite: messageProofGate.source
			}
		}
	];
}

export type PlatformIntakeProfileRow = {
	label: string;
	source: string;
	csvState: CapabilityState;
	apiState: CapabilityState;
	href: string;
	csvHref: string;
	apiHref: string;
	csvAction: string;
	apiAction: string;
	fingerprint: string;
	matchCount: number;
	requiredCount: number;
	apiProofs: string[];
	apiProofCount: number;
	apiProofSummary: string;
	gate: GateEvidence;
	clusters: string;
};

export type PlatformApiProofRow = {
	id:
		| 'profile-registry'
		| 'credential-custody'
		| 'credential-probe'
		| 'adapter-execution'
		| 'import-safety'
		| 'continuation-checkpoint';
	label: string;
	state: CapabilityState;
	href: string;
	action: string;
	handoff: string;
	effect: string;
	gate: string;
	clusters: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type PlatformIntakeStageRow = {
	id: 'export-recognition' | 'credential-custody' | 'direct-api-runner';
	label: string;
	state: CapabilityState;
	phase: 'GROUND' | 'RESOLVE';
	href: string;
	action: string;
	handoff: string;
	effect: string;
	gate: string;
	clusters: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type PlatformIntakeReadinessInputs = {
	base: string;
	platformApiGate: GateEvidence;
	platformApiSync?: {
		runtimeReady?: boolean | null;
		runtimeMissing?: string[] | null;
		runtimeDependency?: string | null;
		runtimeMessage?: string | null;
		credentialCustodyReady?: boolean | null;
		credentialStored?: boolean | null;
		credentialProbeComplete?: boolean | null;
		credentialProbeCompletedAt?: string | null;
		adapterSource?: string | null;
		runnerImplemented?: boolean | null;
		armedAdapterSources?: string[] | null;
		profileCount?: number | null;
	} | null;
};

export type PlatformIntakeReadinessSummary = {
	rows: PlatformIntakeProfileRow[];
	stageRows: PlatformIntakeStageRow[];
	proofRows: PlatformApiProofRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	boundary: string;
	futureLift: string;
	profileCount: number;
	csvContractCount: number;
	apiBoundaryCount: number;
};

export type PeopleSourceProvenanceReadinessInputs = {
	base: string;
	sourceCounts: Record<string, number> | null;
	totalPeople: number | null;
	platformApiGate: GateEvidence;
};

export type PeopleSourceProvenanceReadinessSummary = {
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	boundary: string;
	futureLift: string;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	nextGate: GateEvidence;
	sourceOriginCount: number;
	sourcedPeopleCount: number;
	platformProfilePeopleCount: number;
	unknownPeopleCount: number;
};

export type PersonDetailRowKey =
	| 'verification-weight'
	| 'reach-authorization'
	| 'source-custody'
	| 'custom-field-custody';

export type PersonDetailRow = {
	id: PersonDetailRowKey;
	label: string;
	state: CapabilityState;
	phase: 'GROUND' | 'SEND';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type PersonDetailRowsInputs = {
	base: string;
	person: {
		id: string;
		identityVerified: boolean;
		postalCode?: string | null;
		emailStatus: string;
		source?: string | null;
		hasEncryptedCustomFields: boolean;
	};
	gates: {
		verificationTrustGate: GateEvidence;
		emailProxyGate: GateEvidence;
		platformApiGate: GateEvidence;
		customFieldsGate: GateEvidence;
	};
};

export type PeopleSegmentationRowKey =
	| 'saved-segments'
	| 'proof-reach-filters'
	| 'source-provenance-filters'
	| 'action-context-filters'
	| 'civic-geography-labels';

export type PeopleSegmentationReadinessRow = {
	id: PeopleSegmentationRowKey;
	label: string;
	state: CapabilityState;
	phase: 'GROUND' | 'AUTHOR' | 'SEND';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type PeopleSegmentationReadinessInputs = {
	base: string;
	segmentation: {
		loaded: boolean;
		segmentCount: number | null;
		conditionCount: number | null;
		tagConditionCount: number | null;
		verificationConditionCount: number | null;
		sourceConditionCount: number | null;
		emailStatusConditionCount: number | null;
		dateConditionCount: number | null;
		postalCountryConditionCount: number | null;
		stateCodeConditionCount: number | null;
		congressionalDistrictConditionCount: number | null;
		campaignParticipationConditionCount: number | null;
		actionDistrictHashConditionCount: number | null;
		actionDistrictLabelConditionCount: number | null;
		engagementTierConditionCount: number | null;
		humanReadableGeographyConditionCount: number | null;
	};
	gates: {
		civicGeographyLabelsGate: GateEvidence;
		platformApiGate: GateEvidence;
	};
};

export type PeopleSegmentationReadinessSummary = {
	rows: PeopleSegmentationReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
};

export type EmailListHealthRowKey =
	| 'reachable-cohort'
	| 'suppression-statuses'
	| 'consent-evidence-custody'
	| 'unsubscribe-consent'
	| 'bounce-complaint-attribution'
	| 'manual-report-consensus'
	| 'list-unsubscribe-headers'
	| 'mailbox-unsubscribe-rendering'
	| 'sender-domain-auth';

export type EmailListHealthReadinessRow = {
	id: EmailListHealthRowKey;
	label: string;
	state: CapabilityState;
	phase: 'GROUND' | 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type EmailListHealthReadinessInputs = {
	base: string;
	emailHealth: {
		loaded: boolean;
		subscribed: number | null;
		unsubscribed: number | null;
		bounced: number | null;
		complained: number | null;
		consentEvidenceCount?: number | null;
		subscribedConsentEvidenceCount?: number | null;
	};
	gates: {
		emailProxyGate: GateEvidence;
		listUnsubscribeGate: GateEvidence;
		listUnsubscribeProviderGate: GateEvidence;
		softBounceGate: GateEvidence;
		customDomainGate: GateEvidence;
	};
	honesty?: {
		softBounceThreshold?: DataHonestyEvidence;
	};
};

export type EmailListHealthReadinessSummary = {
	rows: EmailListHealthReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
	reachableCount: number | null;
	suppressedCount: number | null;
};

export type TextDeliveryReadinessRowKey =
	| 'phone-consent-ledger'
	| 'sms-consent-evidence'
	| 'text-draft-packets'
	| 'text-audience-snapshots'
	| 'carrier-receipt-evidence'
	| 'reader-reply-register'
	| 'bulk-dispatch-runner'
	| 'text-receipt-anchoring';

export type TextDeliveryReadinessRow = {
	id: TextDeliveryReadinessRowKey;
	label: string;
	state: CapabilityState;
	phase: 'GROUND' | 'AUTHOR' | 'RESOLVE' | 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type TextCarrierProofRow = {
	id:
		| 'saved-draft-packet'
		| 'audience-scope'
		| 'browser-phone-custody'
		| 'scope-revalidation'
		| 'carrier-acceptance'
		| 'reply-register'
		| 'receipt-anchoring';
	label: string;
	state: CapabilityState;
	href: string;
	action: string;
	handoff: string;
	effect: string;
	gate: string;
	clusters: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type TextDeliveryReadinessInputs = {
	base: string;
	text: {
		enabled: boolean;
		dispatchEnabled: boolean;
		loaded: boolean;
		draftCount: number | null;
		plannedRecipientCount: number | null;
		sentCount: number | null;
		deliveredCount: number | null;
		failedCount: number | null;
		messageCount: number | null;
		replyCount?: number | null;
		subscribedPhoneCount: number | null;
		unsubscribedPhoneCount: number | null;
		stoppedPhoneCount: number | null;
		noSmsStatusCount: number | null;
		phonePresentCount: number | null;
		smsConsentEvidenceCount?: number | null;
		subscribedSmsConsentEvidenceCount?: number | null;
		dispatchRuntimeReady?: boolean | null;
		dispatchRuntimeMissing?: string[] | null;
		dispatchRuntimeDependency?: string | null;
		dispatchRuntimeMessage?: string | null;
		dispatchRunnerImplemented?: boolean | null;
		dispatchClientBatchRouteMounted?: boolean | null;
	};
	gates: {
		smsDispatchGate: GateEvidence;
		smsReceiptAnchoringGate: GateEvidence;
		textReplyRegisterGate?: GateEvidence;
	};
};

export type TextDeliveryReadinessSummary = {
	rows: TextDeliveryReadinessRow[];
	proofRows: TextCarrierProofRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
	subscribedPhoneCount: number | null;
	receiptCounterCount: number | null;
};

export type CallRoutingRowKey =
	| 'call-record-history'
	| 'caller-phone-decrypt'
	| 'twilio-call-bridge'
	| 'phone-banking-workflow';

export type CallRoutingReadinessRow = {
	id: CallRoutingRowKey;
	label: string;
	state: CapabilityState;
	phase: 'AUTHOR' | 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type CallRoutingReadinessInputs = {
	base: string;
	calls: {
		enabled: boolean;
		loaded: boolean;
		canManageCalls: boolean;
		twilioConfigured: boolean;
		initiationRuntimeReady?: boolean | null;
		initiationRuntimeMissing?: string[] | null;
		initiationRuntimeDependency?: string | null;
		initiationRuntimeMessage?: string | null;
		initiationSurfaceMounted?: boolean | null;
		initiationProxyImplemented?: boolean | null;
		callCount: number | null;
		completedCallCount: number | null;
		campaignCount: number | null;
	};
	gates: {
		callInitiationGate: GateEvidence;
	};
};

export type CallRoutingReadinessSummary = {
	rows: CallRoutingReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
	callCount: number | null;
	completedCallCount: number | null;
};

export type PowerTerrainRowKey =
	| 'target-records'
	| 'discoverable-officials'
	| 'bills-corpus'
	| 'score-snapshots'
	| 'state-local-terrain'
	| 'international-resolver'
	| 'office-response-terrain'
	| 'joined-terrain-plane';

export type PowerTerrainRow = {
	id: PowerTerrainRowKey;
	label: string;
	state: CapabilityState;
	phase: 'GROUND' | 'RESOLVE' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type PowerTerrainReadinessInputs = {
	base: string;
	power: {
		loaded: boolean;
		legislationEnabled: boolean;
		followedCount: number | null;
		discoverableOfficialCount?: number | null;
		watchedBillCount: number | null;
		scorecardCount: number | null;
	};
	gates: {
		powerStateLocalTerrainGate: GateEvidence;
		powerInternationalTerrainGate: GateEvidence;
		powerStateBillTerrainGate: GateEvidence;
		powerNonFederalScorecardGate: GateEvidence;
		powerOfficeResponseGate: GateEvidence;
	};
};

export type PowerTerrainReadinessSummary = {
	rows: PowerTerrainRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	terrainCount: number | null;
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
};

export type PowerTargetDetailRowKey =
	| 'follow-state'
	| 'contact-route'
	| 'accountability-timeline'
	| 'reader-office-boundary';

export type PowerTargetDetailRow = {
	id: PowerTargetDetailRowKey;
	label: string;
	state: CapabilityState;
	phase: 'RESOLVE' | 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type PowerTargetDetailInputs = {
	base: string;
	target: {
		id: string;
		isFollowed: boolean;
		hasContactRoute: boolean;
		timelineCount: number;
		receiptCount: number;
	};
	gates: {
		stateLocalTerrainGate: GateEvidence;
		readerOfficeGate: GateEvidence;
		receiptAnchoringGate: GateEvidence;
	};
};

export type LegislativeMonitoringRowKey =
	| 'federal-bill-corpus'
	| 'org-watchlist'
	| 'org-relevance-screen'
	| 'position-register'
	| 'state-local-corpus'
	| 'per-supporter-alerts'
	| 'delegated-monitoring'
	| 'multi-jurisdiction-routing';

export type LegislativeMonitoringReadinessRow = {
	id: LegislativeMonitoringRowKey;
	label: string;
	state: CapabilityState;
	phase: 'GROUND' | 'RESOLVE' | 'AUTHOR' | 'SEND';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type LegislativeMonitoringReadinessInputs = {
	base: string;
	legislation: {
		loaded: boolean;
		enabled: boolean;
		watchedBillCount: number | null;
		relevantBillCount: number | null;
		positionedBillCount: number | null;
		searchResultCount?: number | null;
	};
	gates: {
		stateBillTerrainGate: GateEvidence;
		perSupporterAlertsGate: GateEvidence;
		delegatedMonitoringGate: GateEvidence;
		multiJurisdictionRoutingGate: GateEvidence;
	};
};

export type LegislativeMonitoringReadinessSummary = {
	rows: LegislativeMonitoringReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
	watchedBillCount: number | null;
	relevantBillCount: number | null;
	positionedBillCount: number | null;
};

export type ResultsProofRowKey =
	| 'packet-artifact'
	| 'coordination-integrity'
	| 'reader-verifier'
	| 'receipt-evidence'
	| 'receipt-anchoring'
	| 'reader-office-response';

export type ResultsProofRow = {
	id: ResultsProofRowKey;
	label: string;
	state: CapabilityState;
	phase: 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type ResultsProofReadinessInputs = {
	base: string;
	hrefs: {
		actionRecordsHref: string;
		packetHref: string;
		resultsPacketHref: string;
		proofDeliveryHref: string;
	};
	results: {
		loaded: boolean;
		hasPacket: boolean;
		verifiedCount: number | null;
		totalCount: number | null;
		districtCount: number | null;
		sentEmails: number | null;
		campaignCount: number | null;
		receiptCount: number | null;
		pendingReceiptCount: number | null;
		responseLoggedReceiptCount: number | null;
		anchorFieldCount: number | null;
		receiptSampleLimit: number | null;
		receiptProofWeightTotal: number | null;
	};
	features: {
		ACCOUNTABILITY: boolean;
	};
	gates: {
		receiptAnchoringGate: GateEvidence;
		readerOfficeGate: GateEvidence;
		coordinationIntegrityGate: GateEvidence;
	};
};

export type ResultsProofReadinessSummary = {
	rows: ResultsProofRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	hasPacket: boolean;
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
};

export type AccountabilityResponseRowKey =
	| 'proof-delivery-register'
	| 'opened-response-signal'
	| 'verified-link-signal'
	| 'reply-log'
	| 'vote-alignment-basis'
	| 'reader-office-workflow';

export type AccountabilityResponseReadinessRow = {
	id: AccountabilityResponseRowKey;
	label: string;
	state: CapabilityState;
	phase: 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type AccountabilityResponseReadinessInputs = {
	base: string;
	response: {
		loaded: boolean;
		scorecardCount: number | null;
		receiptCount: number | null;
		openedCount: number | null;
		verifyClickCount: number | null;
		replyCount: number | null;
		alignedVoteCount: number | null;
		relevantVoteCount: number | null;
	};
	features: {
		ACCOUNTABILITY: boolean;
		LEGISLATION: boolean;
	};
	gates: {
		receiptAnchoringGate: GateEvidence;
		readerOfficeGate: GateEvidence;
		nonFederalScorecardGate: GateEvidence;
	};
};

export type AccountabilityResponseReadinessSummary = {
	rows: AccountabilityResponseReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
	receiptCount: number | null;
	responseSignalCount: number | null;
};

export type CoalitionReadinessRowKey =
	| 'network-memberships'
	| 'invite-response-queue'
	| 'member-roster-aggregate'
	| 'aggregate-proof-detail'
	| 'cross-border-routing'
	| 'durable-coalition-artifact';

export type CoalitionReadinessRow = {
	id: CoalitionReadinessRowKey;
	label: string;
	state: CapabilityState;
	phase: 'GROUND' | 'AUTHOR' | 'RESOLVE' | 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type CoalitionReadinessInputs = {
	base: string;
	context?: 'index' | 'creation' | 'detail';
	coalition: {
		enabled: boolean;
		loaded: boolean;
		activeNetworkCount: number | null;
		pendingInviteCount: number | null;
		activeMemberRows: number | null;
		topActiveNetworkId: string | null;
		draftNetworkCount?: number | null;
		creationAuthority?: boolean | null;
	};
	gates: {
		coalitionStatsGate: GateEvidence;
		crossBorderCoalitionGate: GateEvidence;
		coalitionArtifactGate: GateEvidence;
	};
	hrefs?: Partial<Record<CoalitionReadinessRowKey, string>>;
};

export type CoalitionReadinessSummary = {
	rows: CoalitionReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
};

export type FundraisingReadinessRowKey =
	| 'fundraiser-record'
	| 'public-donation-page'
	| 'stripe-checkout'
	| 'donor-confirmation'
	| 'provider-send-evidence'
	| 'receipt-policy-register'
	| 'tax-anchored-receipts';

export type FundraisingReadinessRow = {
	id: FundraisingReadinessRowKey;
	label: string;
	state: CapabilityState;
	phase: 'AUTHOR' | 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type FundraisingReceiptProofRow = {
	id:
		| 'fundraiser-record-ground'
		| 'public-intake-scope'
		| 'payment-provider-handoff'
		| 'webhook-completion'
		| 'confirmation-outcome-register'
		| 'provider-send-acceptance'
		| 'receipt-policy-custody'
		| 'tax-anchoring-boundary';
	label: string;
	state: CapabilityState;
	href: string;
	action: string;
	handoff: string;
	effect: string;
	gate: string;
	clusters: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type FundraisingReadinessInputs = {
	base: string;
	context?: 'index' | 'creation' | 'detail';
	fundraising: {
		enabled: boolean;
		loaded: boolean;
		fundraiserCount: number | null;
		activeCount: number | null;
		raisedAmountCents: number | null;
		donationCount: number | null;
		receiptPolicyCount: number | null;
		confirmationCompleted: number | null;
		confirmationSent: number | null;
		confirmationAttempted: number | null;
		confirmationProviderAccepted: number | null;
		draftFundraiserCount?: number | null;
		publishRequested?: boolean | null;
	};
	gates: {
		fundraiserRecordGate: GateEvidence;
		donationConfirmationGate: GateEvidence;
		donationReceiptGate: GateEvidence;
	};
	hrefs?: Partial<Record<FundraisingReadinessRowKey, string>>;
};

export type FundraisingReadinessSummary = {
	rows: FundraisingReadinessRow[];
	proofRows: FundraisingReceiptProofRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
};

export type ActionRecordReadinessRowKey =
	| 'action-record'
	| 'jurisdiction-resolve'
	| 'reader-action-surface'
	| 'packet-artifact'
	| 'decision-maker-delivery'
	| 'quality-settlement'
	| 'completed-evidence'
	| 'congress-proof-delivery';

export type ActionRecordReadinessRow = {
	id: ActionRecordReadinessRowKey;
	label: string;
	state: CapabilityState;
	phase: string;
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type ActionRecordReadinessInputs = {
	base: string;
	context: 'index' | 'draft' | 'detail';
	action: {
		recordCount?: number | null;
		draftCount?: number | null;
		activeCount?: number | null;
		pausedCount?: number | null;
		completeCount?: number | null;
		status?: string | null;
		hasSavedRecord?: boolean | null;
		actionCount?: number | null;
		verifiedActionCount?: number | null;
		hasPacket?: boolean | null;
		packetVerified?: number | null;
		targetCount?: number | null;
		targetCountry?: string | null;
		targetJurisdiction?: string | null;
		debateEnabled?: boolean | null;
		hasDebate?: boolean | null;
		debateResolved?: boolean | null;
		congressionalDelivery?: CongressionalDeliveryGround | null;
	};
	features?: {
		CONGRESSIONAL?: boolean;
	};
	gates: {
		actionProofGate: GateEvidence;
		reachExpansionGate: GateEvidence;
		qualitySettlementGate: GateEvidence;
		coordinationHistoryGate: GateEvidence;
		congressionalLaunchGate: GateEvidence;
	};
	hrefs?: Partial<Record<ActionRecordReadinessRowKey, string>>;
};

export type ActionRecordReadinessSummary = {
	rows: ActionRecordReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
};

export type CoordinationReadinessRowKey =
	| 'coordination-definitions'
	| 'trigger-dispatch-contracts'
	| 'step-grammar'
	| 'side-effect-runner'
	| 'run-evidence';

export type CoordinationReadinessRow = {
	id: CoordinationReadinessRowKey;
	label: string;
	state: CapabilityState;
	phase: 'AUTHOR' | 'GROUND' | 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type CoordinationReadinessInputs = {
	base: string;
	coordination: {
		enabled: boolean;
		executionEnabled: boolean;
		loaded: boolean;
		definitionCount: number | null;
		enabledCount: number | null;
		triggerFamilyCount: number | null;
		plannedStepCount: number | null;
		emailStepCount: number | null;
		tagStepCount: number | null;
		conditionStepCount: number | null;
		runEvidenceCount: number | null;
	};
	gates: {
		workflowEffectsGate: GateEvidence;
		workflowRunEvidenceGate: GateEvidence;
		emailProxyGate: GateEvidence;
	};
};

export type CoordinationReadinessSummary = {
	rows: CoordinationReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
};

export type EventReadinessRowKey =
	| 'event-record'
	| 'public-rsvp-intake'
	| 'waitlist-roster'
	| 'checkin-attendance-signal'
	| 'calendar-roster-artifacts';

export type EventReadinessRow = {
	id: EventReadinessRowKey;
	label: string;
	state: CapabilityState;
	phase: 'AUTHOR' | 'RESOLVE' | 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric?: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type EventReadinessInputs = {
	base: string;
	context: 'index' | 'draft' | 'detail';
	event: {
		recordCount: number | null;
		publishedCount: number | null;
		draftCount: number | null;
		rsvpCount: number | null;
		visibleRsvpRows: number | null;
		attendeeCount: number | null;
		verifiedAttendeeCount: number | null;
		status: string | null;
		publishRequested: boolean | null;
		waitlistEnabled: boolean | null;
		waitlistEnabledCount: number | null;
		hasCheckinCode: boolean | null;
		hasSavedRecord: boolean;
		hasCalendarExport: boolean;
		hasRosterExport: boolean;
	};
	gates: {
		eventRecordGate: GateEvidence;
		eventWaitlistGate: GateEvidence;
		attendanceProofGate: GateEvidence;
		eventArtifactGate: GateEvidence;
	};
	hrefs?: Partial<Record<EventReadinessRowKey, string>>;
};

export type EventReadinessSummary = {
	rows: EventReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
};

export type OperatingAuthorityRowKey =
	| 'publish-authority'
	| 'team-seat-authority'
	| 'role-removal-authority'
	| 'owner-transfer-ceremony'
	| 'org-audit-log'
	| 'plan-limits'
	| 'plan-feature-boundary'
	| 'public-api-ground'
	| 'signed-webhooks'
	| 'pii-encryption-authority'
	| 'registry-environment';

export type OperatingAuthorityReadinessRow = {
	id: OperatingAuthorityRowKey;
	label: string;
	state: CapabilityState;
	phase: 'GROUND' | 'AUTHOR' | 'SEND' | 'AGGREGATE';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type OperatingAuthorityReadinessInputs = {
	base: string;
	authority: {
		role: string;
		canPublish: boolean;
		canInvite: boolean;
		isOwner: boolean;
		memberCount: number | null;
		inviteCount: number | null;
		maxSeats: number | null;
		planName: string | null;
		planStatus: string | null;
		maxVerifiedActions: number | null;
		maxEmails: number | null;
		publicApiEnabled: boolean;
		encryptionConfigured: boolean | null;
		registryEnvironment: string;
	};
	gates: {
		eventRecordsGate: GateEvidence;
		customDomainGate: GateEvidence;
		mainnetGate: GateEvidence;
		auditLogGate: GateEvidence;
	};
};

export type OperatingAuthorityReadinessSummary = {
	rows: OperatingAuthorityReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
};

export type SignedWebhookReadinessRowKey =
	| 'signed-event-substrate'
	| 'endpoint-custody'
	| 'delivery-attempt-register'
	| 'reader-office-notification-boundary'
	| 'durable-event-archive-boundary';

export type SignedWebhookReadinessRow = {
	id: SignedWebhookReadinessRowKey;
	label: string;
	state: CapabilityState;
	phase: 'AGGREGATE' | 'SEND';
	clusters: string;
	href: string;
	action: string;
	handoff: string;
	ground: string;
	boundary: string;
	gate: GateEvidence;
	metric?: {
		value: number | null;
		label: string;
		cite: string;
	};
};

export type SignedWebhookReadinessInputs = {
	base: string;
	webhooks: {
		eventKindCount: number | null;
		endpointCount: number;
		activeEndpointCount: number;
		subscribedEventCount: number;
		recentDeliveryCount: number;
		deliveredCount: number;
		retryingCount: number;
		deadCount: number;
		failureCount: number;
	};
	gates: {
		eventRecordsGate: GateEvidence;
		readerOfficeGate: GateEvidence;
		webhookArchiveGate: GateEvidence;
	};
};

export type SignedWebhookReadinessSummary = {
	rows: SignedWebhookReadinessRow[];
	state: CapabilityState;
	signal: string;
	effect: string;
	detail: string;
	gate: string;
	nextGate: GateEvidence;
	href: string;
	action: string;
	handoff: string;
	metric: {
		value: number | null;
		label: string;
		cite: string;
	};
	liveCount: number;
	boundaryCount: number;
	rowCount: number;
	endpointCount: number;
	recentDeliveryCount: number;
};

const v1ImplementationTasks = (implementationTasksJson as { tasks: ImplementationTask[] }).tasks;
const nextImplementationTasks = (nextImplementationTasksJson as { tasks: ImplementationTask[] })
	.tasks;
const implementationTasks = [...v1ImplementationTasks, ...nextImplementationTasks];
const dataTasks = (dataTasksJson as { tasks: DataTask[] }).tasks;
const v1Chokepoints = (chokepointsJson as { chokepoints: Chokepoint[] }).chokepoints;
const nextChokepoints = (nextChokepointsJson as { chokepoints: Chokepoint[] }).chokepoints;
const chokepoints = [...v1Chokepoints, ...nextChokepoints];
const v1UnblockEdges = (unblocksJson as { edges: UnblockEdge[] }).edges;
const nextUnblockEdges = (nextUnblocksJson as { unblocks: UnblockEdge[] }).unblocks;
const unblockEdges = [...v1UnblockEdges, ...nextUnblockEdges];

const implementationTaskById = new Map(implementationTasks.map((task) => [task.id, task]));
const dataTaskById = new Map(dataTasks.map((task) => [task.id, task]));
const chokepointById = new Map(chokepoints.map((chokepoint) => [chokepoint.id, chokepoint]));
const unblockEdgeById = new Map(
	unblockEdges
		.map((edge) => [edge.chokepoint_id ?? edge.chokepoint ?? edge.source, edge] as const)
		.filter(([id]) => Boolean(id))
);

function normalizeStatus(status: string | undefined): HypergraphStatus {
	if (
		status === 'completed' ||
		status === 'deferred' ||
		status === 'blocked' ||
		status === 'in_progress' ||
		status === 'not_started'
	) {
		return status;
	}
	return 'not_started';
}

function stateFromStatuses(statuses: HypergraphStatus[]): CapabilityState {
	if (statuses.length === 0) return 'gated';
	if (statuses.every((status) => status === 'completed')) return 'live';
	if (statuses.some((status) => status === 'completed' || status === 'in_progress'))
		return 'partial';
	return 'gated';
}

function highestDownstreamGate(gates: GateEvidence[]): GateEvidence {
	const unresolved = gates.filter((gate) => gate.status !== 'completed');
	return (unresolved.length > 0 ? unresolved : gates).reduce((current, gate) =>
		gate.downstream > current.downstream ? gate : current
	);
}

function statusFromStatuses(statuses: HypergraphStatus[]): HypergraphStatus {
	if (statuses.length === 0) return 'not_started';
	if (statuses.every((status) => status === 'completed')) return 'completed';
	if (statuses.some((status) => status === 'in_progress')) return 'in_progress';
	if (statuses.some((status) => status === 'blocked')) return 'blocked';
	if (statuses.some((status) => status === 'deferred')) return 'deferred';
	return 'not_started';
}

function uniqueText(values: Array<string | undefined>): string {
	const present = [...new Set(values.filter(Boolean) as string[])];
	return present.length > 0 ? present.join(' / ') : 'unassigned';
}

function carriesForward(task: ImplementationTask, taskId: string): boolean {
	const carryover = task.carryover_from;
	if (!carryover) return false;
	return (
		carryover === taskId || carryover.startsWith(`${taskId} `) || carryover.includes(`+${taskId}`)
	);
}

function currentTaskIds(taskIds: string[]): string[] {
	const resolved = taskIds.flatMap((id) => {
		if (id.startsWith('NEW-')) return [id];
		const successors = nextImplementationTasks
			.filter((task) => carriesForward(task, id))
			.map((task) => task.id);
		return successors.length > 0 ? successors : [id];
	});
	return [...new Set(resolved)];
}

function implementationSource(taskIds: string[]): string {
	const sources = [
		taskIds.some((id) => !id.startsWith('NEW-'))
			? 'docs/strategy/implementation-hypergraph/nodes/tasks.json'
			: undefined,
		taskIds.some((id) => id.startsWith('NEW-'))
			? 'docs/strategy/next-implementation-hypergraph/nodes/tasks.json'
			: undefined
	];
	return uniqueText(sources);
}

function edgeSource(edge: UnblockEdge | undefined, rollupSource: string): string {
	if (!edge) return rollupSource;
	const edgePath = edge.chokepoint_id
		? 'docs/strategy/implementation-hypergraph/edges/unblocks.json'
		: 'docs/strategy/next-implementation-hypergraph/edges/unblocks.json';
	return uniqueText([edgePath, rollupSource]);
}

function summarizeTasks(
	taskIds: string[],
	taskMap: Map<string, ImplementationTask | DataTask>
): TaskRollup {
	const resolvedTaskIds = taskMap === implementationTaskById ? currentTaskIds(taskIds) : taskIds;
	const tasks = resolvedTaskIds.map((id) => taskMap.get(id)).filter(Boolean) as Array<
		ImplementationTask | DataTask
	>;
	const statuses = resolvedTaskIds.map((id) => normalizeStatus(taskMap.get(id)?.status));

	return {
		state: stateFromStatuses(statuses),
		status: statusFromStatuses(statuses),
		taskIds: resolvedTaskIds,
		tasks: resolvedTaskIds.join(' / '),
		completed: statuses.filter((status) => status === 'completed').length,
		total: resolvedTaskIds.length,
		waves: uniqueText(tasks.map((task) => task.wave)),
		clusters: uniqueText(tasks.flatMap((task) => task.clusters ?? [])),
		source:
			taskMap === implementationTaskById
				? implementationSource(resolvedTaskIds)
				: 'docs/strategy/implementation-hypergraph/nodes/tasks.json'
	};
}

function splitTaskIds(targetTaskId: string): string[] {
	return targetTaskId
		.split('+')
		.map((id) => id.trim())
		.filter(Boolean);
}

export function getGateEvidence(
	chokepointId: string,
	taskIdsOverride?: string[],
	options: { name?: string; downstream?: number; dependency?: string; source?: string } = {}
): GateEvidence {
	const chokepoint = chokepointById.get(chokepointId);
	const edge = unblockEdgeById.get(chokepointId);
	const taskIds =
		taskIdsOverride ??
		splitTaskIds(chokepoint?.target_task_id ?? chokepoint?.task_id ?? edge?.source ?? chokepointId);
	const rollup = summarizeTasks(taskIds, implementationTaskById);

	return {
		...rollup,
		id: chokepointId,
		name: options.name ?? chokepoint?.name ?? chokepointId,
		downstream:
			options.downstream ??
			Math.max(
				edge?.downstream_count ?? 0,
				chokepoint?.downstream_count ?? chokepoint?.unblocks_count ?? 0
			),
		dependency:
			options.dependency ??
			edge?.elapsed_time_dependency ??
			chokepoint?.elapsed_time_dependency ??
			chokepoint?.gate_owner ??
			chokepoint?.gate_kind ??
			'Hypergraph task dependency',
		chokepoint: chokepoint?.id ?? edge?.chokepoint_id ?? edge?.chokepoint ?? chokepointId,
		semantics:
			edge?.fan_out_semantics ??
			chokepoint?.rationale ??
			edge?.wave_transition ??
			chokepoint?.name ??
			'Task hypergraph gate',
		source: options.source ?? edgeSource(edge, rollup.source)
	};
}

export function formatGateEvidence(
	gate: GateEvidence,
	options: GateEvidenceSummaryOptions = {}
): string {
	if (options.density === 'operator') {
		const lead =
			gate.status === 'completed'
				? (options.complete ?? `${gate.name} is live.`)
				: (options.prefix ?? `${gate.name} remains bounded.`);
		const status = gate.status.replace('_', ' ');
		const taskLabel = gate.total === 1 ? 'tracked task' : 'tracked tasks';
		const downstream =
			gate.downstream > 0
				? `${gate.downstream} downstream capability path${gate.downstream === 1 ? '' : 's'}`
				: 'no registered downstream fan-out';
		const dependency =
			gate.dependency && gate.dependency !== 'Hypergraph task dependency'
				? ` Dependency: ${gate.dependency}.`
				: '';
		return `${lead} ${gate.name}: ${status}; ${gate.completed}/${gate.total} ${taskLabel} complete; ${downstream}.${dependency}`;
	}

	const basis = `${gate.name}: ${gate.tasks} (${gate.status}; ${gate.completed}/${gate.total} complete; ${gate.downstream} downstream; ${gate.source}).`;
	if (gate.status === 'completed') {
		return options.complete ? `${options.complete} ${basis}` : basis;
	}
	return options.prefix ? `${options.prefix} ${basis}` : basis;
}

function formatRuntimeMissing(missing: string[] | null | undefined): string {
	const values = missing?.filter(Boolean) ?? [];
	return values.length > 0 ? values.join(', ') : 'runtime dependencies';
}

function formatAuthoringMissing(runtime: StudioAuthoringRuntimeGround | null): string {
	if (!runtime) return 'authoring ground';
	const missing: string[] = [];
	if (runtime.modelProviderConfigured !== true) missing.push('model provider');
	if (runtime.sourceSearchConfigured !== true) missing.push('source discovery');
	if (runtime.sourceFetchConfigured !== true) missing.push('page-read evaluation');
	return missing.length > 0 ? missing.join(', ') : 'authoring dependencies';
}

function featureNotArmedBoundary(surface: string, claims: string): string {
	return `${surface} is not armed; ${claims} stay dependency-first until the feature gate and runtime evidence clear.`;
}

function unreadGroundBoundary(surface: string, claims: string): string {
	return `${surface} ground is unread; ${claims} are not claimed or counted.`;
}

function serverDispatchRuntimeBoundary(
	emailDelivery: EmailDeliveryGround | null | undefined,
	emailProxyGate: GateEvidence
): string {
	if (emailDelivery?.serverDispatchRuntimeReady) {
		return formatGateEvidence(emailProxyGate, {
			complete:
				'Server email runtime dependencies are present; route-local recipient, quota, and provider checks still apply.',
			density: 'operator'
		});
	}

	const missing = formatRuntimeMissing(emailDelivery?.serverDispatchRuntimeMissing);
	const dependency =
		emailDelivery?.serverDispatchRuntimeDependency ??
		'AWS SES credentials + org key + UNSUBSCRIBE_SECRET + valid PUBLIC_BASE_URL';

	return [
		`Server email runtime is missing ${missing}. Dependency: ${dependency}.`,
		formatGateEvidence(emailProxyGate, {
			prefix: 'The remaining email transport lift stays visible through the email delivery gate.',
			density: 'operator'
		})
	].join(' ');
}

export function buildLaunchPressureRows(input: LaunchPressureInputs): LaunchPressureRow[] {
	const {
		base,
		emailDeliveryHref,
		abAutomationState,
		civicGeographyLabelsState,
		serverDispatchRuntimeReady,
		serverDispatchRuntimeMissing,
		serverDispatchRuntimeDependency,
		textDispatchRuntimeReady,
		textDispatchRuntimeMissing,
		textDispatchRuntimeDependency,
		textDispatchClientBatchRouteMounted,
		platformApiSyncRuntimeReady,
		platformApiSyncRuntimeMissing,
		platformApiSyncRuntimeDependency,
		features,
		gates
	} = input;
	const {
		platformApiGate,
		smsDispatchGate,
		donationReceiptGate,
		abAutomationGate,
		civicGeographyLabelsGate,
		workflowEffectsGate,
		emailProxyGate,
		listUnsubscribeProviderGate,
		customDomainGate,
		readerOfficeGate,
		mainnetGate,
		teeGate,
		delegationGate
	} = gates;
	const consentReachCompletionGate = highestDownstreamGate([
		listUnsubscribeProviderGate,
		customDomainGate
	]);
	const delegatedActionPressureGate = highestDownstreamGate([delegationGate, teeGate]);
	const serverDispatchMissingText = formatRuntimeMissing(serverDispatchRuntimeMissing);
	const serverDispatchDependencyText =
		serverDispatchRuntimeDependency ??
		'AWS SES credentials + org key + UNSUBSCRIBE_SECRET + valid PUBLIC_BASE_URL';
	const textDispatchRouteMissing =
		textDispatchClientBatchRouteMounted === true
			? (textDispatchRuntimeMissing ?? []).filter((item) => item !== 'browser phone custody')
			: (textDispatchRuntimeMissing ?? []);
	const textDispatchRouteMissingText = formatRuntimeMissing(textDispatchRouteMissing);
	const textDispatchRouteReady =
		textDispatchClientBatchRouteMounted === true && textDispatchRouteMissing.length === 0;
	const textDispatchDependencyText =
		textDispatchRuntimeDependency ??
		'text dispatch gate, browser phone custody, Twilio dispatch runner, and transport credentials';
	const platformApiSyncMissingText = formatRuntimeMissing(platformApiSyncRuntimeMissing);
	const platformApiSyncDependencyText =
		platformApiSyncRuntimeDependency ??
		'profile registry, encrypted credential custody, direct sync execution, and continuation checkpointing';
	// Readiness.ready already requires the profile registry, credential custody,
	// the sync runner, and at least one armed adapter; the T1-3 gate stays cited
	// on the row for the un-met scope (remaining adapters + tag/list sync).
	const platformApiSyncArmed = platformApiSyncRuntimeReady === true;
	const workflowExecutionArmed =
		features.WORKFLOW_EXECUTION && workflowEffectsGate.state === 'live';

	const rows: LaunchPressureRow[] = [
		{
			id: 'platform-api-sync',
			order: 1,
			name: 'Direct platform sync',
			state: platformApiSyncArmed ? 'partial' : 'gated',
			href: `${base}/supporters/import/platform-api#platform-sync-boundary`,
			action: platformApiSyncArmed ? 'open platform sync' : 'read platform sync boundary',
			handoff: 'Platform portability boundary',
			ground: 'CSV intake + source recognition',
			effect: platformApiSyncArmed
				? 'Bounded direct import armed per adapter'
				: 'Direct import held',
			nextLift: 'direct sync proof',
			currentGround: platformApiSyncArmed
				? 'CSV export import, platform source recognition, and bounded direct import for armed adapter sources are usable; remaining adapters stay separate proof.'
				: 'CSV export import and platform source recognition are usable; direct sync remains separate proof.',
			blocked: platformApiSyncArmed
				? 'Direct platform import still stops for adapter sources without a registered runner, and tag/list sync stays gated.'
				: `Direct platform import still stops while ${platformApiSyncMissingText} are missing.`,
			futureLift: `Configure ${platformApiSyncDependencyText}, then verify adapter-specific pagination, rate limits, and continuation before direct sync is marked live.`,
			gate: platformApiGate,
			cluster: 'reach / data sovereignty'
		},
		{
			id: 'text-carrier-dispatch',
			order: 2,
			name: 'Text carrier dispatch',
			state:
				textDispatchRuntimeReady === true && smsDispatchGate.state === 'live'
					? 'live'
					: textDispatchRouteReady
						? 'partial'
						: 'draft-only',
			href: `${base}/sms#sms-dispatch-boundary`,
			action:
				textDispatchRuntimeReady === true && smsDispatchGate.state === 'live'
					? 'open text dispatch'
					: textDispatchRouteReady
						? 'open text drafts'
						: 'read text boundary',
			handoff: 'Text dispatch boundary',
			ground: textDispatchRouteReady ? 'bounded detail batches' : 'drafts + audience snapshots',
			effect: textDispatchRouteReady ? 'Broad carrier send held' : 'Carrier send not armed',
			nextLift: textDispatchRouteReady
				? 'dispatch gate + carrier evidence'
				: 'Twilio runtime evidence',
			currentGround: textDispatchRouteReady
				? 'Text records, draft creation, audience snapshots, detail evidence, and bounded browser-dispatched cohort batches are present.'
				: 'Text records, draft creation, audience snapshots, and detail evidence are present.',
			blocked: textDispatchRouteReady
				? 'Broad carrier text dispatch remains bounded by the dispatch gate, carrier evidence, and route-local dispatch checks.'
				: `Carrier text side effects remain unarmed while ${textDispatchRouteMissingText} are missing.`,
			futureLift: `Configure ${textDispatchDependencyText}, then verify STOP filtering, quota checks, and carrier receipt evidence before marking dispatch live.`,
			gate: smsDispatchGate,
			cluster: 'reach'
		},
		{
			id: 'donation-receipt-compliance',
			order: 3,
			name: 'Donation receipt compliance',
			state: donationReceiptGate.state === 'live' ? 'live' : 'partial',
			href: `${base}/fundraising#fundraising-receipt-boundary`,
			action: 'read receipt boundary',
			handoff: 'Fundraising receipts',
			ground: 'baseline confirmations',
			effect: 'Tax and anchored receipts held',
			nextLift: 'receipt writer + anchoring',
			currentGround:
				'Fundraiser records, public donation state, baseline confirmation outcomes, provider send evidence, and receipt-policy custody are visible.',
			blocked: 'Tax receipt posture and anchored proof are not complete.',
			futureLift: 'Add receipt template/policy workflow, receipt writer, and mainnet anchoring.',
			gate: donationReceiptGate,
			cluster: 'accountability / data sovereignty'
		},
		{
			id: 'ab-automated-dispatch',
			order: 4,
			name: 'A/B automated dispatch',
			state: abAutomationState,
			href: `${base}/emails#ab-continuation-boundary`,
			action: abAutomationState === 'live' ? 'open experiment runner' : 'read experiment boundary',
			handoff: 'A/B continuation',
			ground: 'linked draft cohorts',
			effect: 'Remainder dispatch held',
			nextLift: 'server dispatch runtime',
			currentGround:
				'Composer-created variants carry exact test-cohort filters; the email index and detail page expose continuation boundaries for held-back remainder dispatch.',
			blocked:
				'The runner substrate exists, but A/B test/remainder side effects stay held until server-dispatch runtime dependencies pass.',
			futureLift:
				'Arm server dispatch and production dependency checks before claiming automated A/B continuation.',
			gate: abAutomationGate,
			cluster: 'coordination integrity / reader-side UX'
		},
		{
			id: 'district-state-labels',
			order: 5,
			name: 'Civic geography cohorts',
			state: civicGeographyLabelsState,
			href: `${base}/supporters#people-segments`,
			action: 'read geography boundary',
			handoff: 'People segments',
			ground: 'saved cohort filters',
			effect: 'Verified local cohorts bounded',
			nextLift: 'materialized district labels',
			currentGround:
				'Saved segments cover tags, status, source, verification, dates, postal/country, imported state/congressional district labels, action-time district labels, campaign participation, engagement tier, and action-district hashes.',
			blocked:
				'Imported and action-time congressional district labels are usable; verified/materialized local and special district membership labels remain bounded.',
			futureLift:
				'Persist verified local/special civic geography labels or preload enriched district context before claiming full state/local cohorting.',
			gate: civicGeographyLabelsGate,
			cluster: 'verification / reach'
		},
		{
			id: 'workflow-arming',
			order: 6,
			name: 'Workflow arming',
			state: workflowExecutionArmed ? 'live' : 'draft-only',
			href: `${base}/workflows#workflow-execution-boundary`,
			action: workflowExecutionArmed ? 'open workflow runner' : 'read execution boundary',
			handoff: 'Workflow execution',
			ground: 'definitions + run evidence',
			effect: 'Side effects dependency-first',
			nextLift: 'runner side-effect proof',
			currentGround:
				'Definitions, trigger clauses, step grammar, route-local execution boundary, and run evidence surfaces are present.',
			blocked:
				'Visible workflow execution stays dependency-first until side-effect runner evidence clears.',
			futureLift:
				'Arm bounded runner side effects only after trigger dispatch, tag/branch/delay execution, and workflow email dependencies are verified.',
			gate: workflowEffectsGate,
			cluster: 'agentic systems / reach'
		},
		{
			id: 'server-side-email-dispatch',
			order: 7,
			name: 'Server-side email dispatch',
			state:
				features.EMAIL_SERVER_DISPATCH && serverDispatchRuntimeReady === true
					? 'live'
					: 'draft-only',
			href: emailDeliveryHref,
			action:
				features.EMAIL_SERVER_DISPATCH && serverDispatchRuntimeReady === true
					? 'open server dispatch'
					: 'create delivery draft',
			handoff: 'Email composer',
			ground: 'draft + runtime checks',
			effect: 'Large/no-key send held',
			nextLift: 'server dispatch runtime',
			currentGround:
				'Composer, merge preview, browser-direct boundary, draft preservation, and runtime dependency checks exist.',
			blocked:
				features.EMAIL_SERVER_DISPATCH && serverDispatchRuntimeReady !== true
					? `Large/no-key sends preserve delivery drafts until ${serverDispatchMissingText} are configured.`
					: 'Large/no-key sends preserve delivery drafts until server email runtime dependencies pass.',
			futureLift: `Configure ${serverDispatchDependencyText}, verify provider rendering, then let large/no-key sends queue from the composer.`,
			gate: emailProxyGate,
			cluster: 'reader-side UX / reach / accountability'
		},
		{
			id: 'consent-bound-reach-completion',
			order: 8,
			name: 'Consent-bound reach completion',
			state: consentReachCompletionGate.state === 'live' ? 'live' : 'partial',
			href: `${base}/supporters#email-health`,
			action: 'read list-health boundary',
			handoff: 'Consent-bound reach',
			ground: 'subscribed reach + consent evidence',
			effect: 'Mailbox and sender-domain proof held',
			nextLift: 'mailbox rendering + sender domain',
			currentGround:
				'Subscribed reach, consent evidence custody, suppression statuses, one-click header substrate, bounce/complaint attribution, and verified report consensus are visible list-health ground.',
			blocked:
				'Consent-bound reach is not complete until production mailbox one-click rendering and per-org sender-domain authentication are proven.',
			futureLift:
				'Verify mailbox-rendered one-click unsubscribe evidence, then add per-org sender-domain authentication without turning the list-health surface into an inbox-placement score.',
			gate: consentReachCompletionGate,
			cluster: 'reach / reader-side UX / data sovereignty'
		},
		{
			id: 'reader-office-notifications',
			order: 9,
			name: 'Reader-office notifications',
			state: readerOfficeGate.state === 'live' ? 'live' : 'gated',
			href: `${base}/settings/webhooks#reader-notification-boundary`,
			action:
				readerOfficeGate.state === 'live'
					? 'open reader-office notifications'
					: 'read notification boundary',
			handoff: 'Reader-office notifications',
			ground: 'signed event substrate',
			effect: 'Office alert loop held',
			nextLift: 'office profile + notifier',
			currentGround:
				'Org events, signed webhook delivery attempts, endpoint custody, and event-backed polling are usable operating ground for external systems.',
			blocked:
				'Commons-owned reader-office notifications remain separate from signed webhook delivery until office profiles, office-response workflow, and notification consumers land.',
			futureLift:
				'Build the reader-office profile/workflow/notifier path on top of the signed event stream before claiming Commons alerts offices from Results or Power.',
			gate: readerOfficeGate,
			cluster: 'reader-side UX / accountability / composability'
		},
		{
			id: 'durable-proof-settlement',
			order: 10,
			name: 'Durable proof settlement',
			state: mainnetGate.state === 'live' ? 'live' : 'gated',
			href: `${base}/studio#capability-critical-path`,
			action: mainnetGate.state === 'live' ? 'open proof settlement' : 'read settlement boundary',
			handoff: 'Results proof settlement',
			ground: 'verification packet + testnet registry',
			effect: 'Mainnet permanence held',
			nextLift: 'mainnet anchor + receipt roots',
			currentGround:
				'Verification packets, bounded receipt/source rows, reader verifier, and Sepolia/testnet registry posture are visible; they are not mainnet permanence.',
			blocked:
				'Receipt roots, durable archive proof, public-chain permanence, and mainnet DistrictRegistry/DebateMarket/SnapshotAnchor remain gated.',
			futureLift:
				'Deploy mainnet DistrictRegistry, DebateMarket, SnapshotAnchor, and receipt Merkle anchoring before claiming long-term-survivable proof.',
			gate: mainnetGate,
			cluster: 'verification / accountability / data sovereignty / quality signaling'
		},
		{
			id: 'tee-attested-reasoning',
			order: 11,
			name: 'TEE-attested reasoning',
			state: teeGate.state === 'live' ? 'live' : 'gated',
			href: `${base}/studio#capability-critical-path`,
			action: teeGate.state === 'live' ? 'open attestation path' : 'read attestation boundary',
			handoff: 'TEE attestation path',
			ground: 'local resolver + signed AI panel',
			effect: 'Enclave trust held',
			nextLift: 'Nitro enclave attestation',
			currentGround:
				'Local constituent resolution, debate AI panel signatures, and quality-trigger plumbing are visible; they are not enclave-attested execution.',
			blocked:
				'TEE-attested constituent resolution, AI panel execution, and position-privacy attestation chain remain gated.',
			futureLift:
				'Deploy the Nitro Enclave path, publish PCR0/manifest evidence, wire the vsock proxy, and verify attestation documents before claiming attested reasoning or TEE resolver trust.',
			gate: teeGate,
			cluster: 'verification / quality signaling / agentic systems'
		},
		{
			id: 'proof-bound-delegated-action',
			order: 12,
			name: 'Proof-bound delegated action',
			state: delegatedActionPressureGate.state === 'live' ? 'live' : 'gated',
			href: `${base}/studio#capability-composition`,
			action:
				delegatedActionPressureGate.state === 'live'
					? 'open delegated action'
					: 'read delegation boundary',
			handoff: 'Delegation executor',
			ground: 'Studio reasoning + recovery',
			effect: 'Autonomous agent action held',
			nextLift: 'executor + proof attachment',
			currentGround:
				'Studio can ground, author, recover, and hand off operator-initiated artifacts; no delegation execution slice is loaded as action ground.',
			blocked:
				'Autonomous civic action, ZK proof attachment, grant-indexed replay, and delegation UI remain gated by the executor and attestation path.',
			futureLift:
				'Land proof-bound drafted messages, delegation executor, grant/review UI, and trace observability before claiming agent-as-civic-actor execution.',
			gate: delegatedActionPressureGate,
			cluster: 'agentic systems / verification / coordination integrity'
		}
	];

	return rows.filter((row) => row.state !== 'live');
}

export function summarizeLaunchPressure(rows: LaunchPressureRow[]): LaunchPressureSummary {
	if (rows.length === 0) {
		return {
			count: 0,
			state: 'live',
			gate: 'first-org pressure clear'
		};
	}

	return {
		count: rows.length,
		state: 'partial',
		gate: rows
			.map((row) => formatGateEvidence(row.gate, { prefix: row.futureLift, density: 'operator' }))
			.join(' ')
	};
}

export function buildStudioScopeReadiness(
	input: StudioScopeReadinessInputs
): StudioScopeReadinessSummary {
	const { studioJurisdictionScopeGate, messageProofGate, delegatedTraceGate } = input.gates;
	const rows: StudioScopeReadinessRow[] = [
		{
			key: 'jurisdiction-scope',
			label: 'Jurisdiction scope',
			state: studioJurisdictionScopeGate.state === 'live' ? 'live' : 'partial',
			signal: studioJurisdictionScopeGate.state === 'live' ? 'resolver armed' : 'heuristic scope',
			gate: formatGateEvidence(studioJurisdictionScopeGate, {
				prefix: 'Full jurisdiction scope remains bounded.',
				complete: 'Full jurisdiction scope is armed.',
				density: 'operator'
			})
		},
		{
			key: 'message-recovery',
			label: 'Artifact recovery boundary',
			state: messageProofGate.state === 'live' ? 'live' : 'partial',
			signal: messageProofGate.state === 'live' ? 'proof-bound drafts' : 'device-local recovery',
			gate: formatGateEvidence(messageProofGate, {
				prefix: 'Proof-bound authored-artifact lift remains bounded.',
				complete: 'Proof-bound authored-artifact lift is armed.',
				density: 'operator'
			})
		},
		{
			key: 'trace-replay',
			label: 'Authoring trace replay',
			state: delegatedTraceGate.state === 'live' ? 'live' : 'partial',
			signal: delegatedTraceGate.state === 'live' ? 'grant-indexed trace' : 'operator trace handle',
			gate: formatGateEvidence(delegatedTraceGate, {
				prefix: 'Delegated trace replay remains bounded.',
				complete: 'Delegated trace replay is armed.',
				density: 'operator'
			})
		}
	];
	const boundaryRows = rows.filter((row) => row.state !== 'live');
	const liveRows = rows.length - boundaryRows.length;
	const boundaryCount = boundaryRows.length;

	return {
		rows,
		state: boundaryCount === 0 ? 'live' : 'partial',
		signal: `${liveRows}/${rows.length} scope/recovery contracts live · ${
			boundaryCount > 0 ? `${boundaryCount} bounded` : 'all armed'
		}`,
		effect:
			boundaryCount === 0
				? 'Studio scope, artifact proof, and trace replay are armed for stronger authored-action claims.'
				: 'Studio can show scope, recover artifacts on this device, and surface trace handles without claiming full jurisdiction, proof-bound drafts, or delegated trace replay.',
		detail:
			'Heuristic scope, device-local recovery, and operator trace handles stay one recognitional contract across Studio, Spotlight, and the capability map.',
		gate: rows.map((row) => row.gate).join(' '),
		boundaryCount
	};
}

function studioResolveSignal(processEvidence: StudioProcessEvidence | null): string {
	if (!processEvidence) return 'contactable target required';
	if (processEvidence.contactableTargetCount > 0) {
		return `${processEvidence.contactableTargetCount} contactable targets`;
	}
	if (processEvidence.resolutionStopReason === 'no-public-email') {
		return processEvidence.droppedTargetCount > 0
			? `${processEvidence.droppedTargetCount} public-contact drops`
			: 'public-contact boundary';
	}
	if (processEvidence.resolutionStopReason === 'no-target') return 'no target emitted';
	if (processEvidence.resolutionStopReason === 'stopped') return 'resolution stopped';
	if (processEvidence.resolutionStopReason === 'unknown') return 'resolution boundary';
	return 'contactable target required';
}

function studioResolveGround(processEvidence: StudioProcessEvidence | null): string | null {
	if (!processEvidence) return null;
	if (processEvidence.contactableTargetCount > 0) {
		return `${processEvidence.contactableTargetCount} contactable decision-makers are loaded from the focused Studio run.`;
	}
	if (processEvidence.resolutionStopReason === 'no-public-email') {
		return (
			processEvidence.resolutionStopDetail ??
			`${processEvidence.droppedTargetCount} resolved targets lacked usable public email or deliverability evidence; AUTHOR stays closed.`
		);
	}
	if (processEvidence.resolutionStopReason === 'no-target') {
		return (
			processEvidence.resolutionStopDetail ??
			'No decision-maker identity with contactable public email was emitted; AUTHOR stays closed.'
		);
	}
	if (processEvidence.resolutionStopReason === 'stopped') {
		return (
			processEvidence.resolutionStopDetail ??
			'The operator stopped this loop before a contactable target was emitted.'
		);
	}
	if (processEvidence.resolutionStopReason === 'unknown') {
		return (
			processEvidence.resolutionStopDetail ??
			'RESOLVE closed without a contactable target; AUTHOR stays closed.'
		);
	}
	return null;
}

function studioSourceEvidenceAudit(processEvidence: StudioProcessEvidence | null): string {
	if (!processEvidence?.sourceEvidenceObserved) {
		return 'Source-evidence event has not emitted; source counts remain unknown instead of zero.';
	}

	const basis =
		processEvidence.sourceEvidenceMode === 'preverified'
			? 'Preverified cache supplied source ground.'
			: processEvidence.sourceEvidenceMode === 'discovery'
				? 'Discovery stream supplied source ground.'
				: 'Source-evidence event supplied source ground.';
	const candidate =
		processEvidence.sourceEvidenceCandidateCount === null
			? null
			: `${processEvidence.sourceEvidenceCandidateCount} candidates`;
	const failed =
		processEvidence.sourceEvidenceFailedCount === null
			? null
			: `${processEvidence.sourceEvidenceFailedCount} failed reads`;
	const queries =
		processEvidence.sourceEvidenceSearchQueryCount === null
			? null
			: `${processEvidence.sourceEvidenceSearchQueryCount} search queries`;
	const auditParts = [candidate, failed, queries].filter((part): part is string => Boolean(part));
	const fallback = processEvidence.sourceEvidenceEvaluationFallback
		? ' Evaluation fallback is active; attached search-only sources are context, not evaluated citation support.'
		: '';
	const audit = auditParts.length > 0 ? ` Audit: ${auditParts.join(', ')}.` : '';
	return `${basis}${audit}${fallback}`;
}

export function buildStudioAuthoringReadiness(
	input: StudioAuthoringReadinessInputs
): StudioAuthoringReadinessSummary {
	const { studioJurisdictionScopeGate, messageProofGate, delegatedTraceGate, delegatedActionGate } =
		input.gates;
	const { base } = input;
	const processEvidence = input.process ?? null;
	const runtime = input.runtime ?? null;
	const authoringRuntimeLoaded = Boolean(runtime);
	const authoringRuntimeReady = runtime?.runtimeReady === true;
	const authoringRuntimeMissingText = authoringRuntimeLoaded
		? formatAuthoringMissing(runtime)
		: 'authoring runtime ground';
	const authoringRuntimeDependency =
		runtime?.runtimeDependency ?? 'model provider, source discovery, and page-read evaluation';
	const authoringRuntimeBoundary =
		runtime?.runtimeMessage ??
		'Grounded authoring runtime readiness is not loaded; Studio intent stays usable, but source and message execution must be verified route-locally.';
	const modelProviderConfigured = runtime?.modelProviderConfigured ?? authoringRuntimeReady;
	const sourceSearchConfigured = runtime?.sourceSearchConfigured ?? authoringRuntimeReady;
	const sourceFetchConfigured = runtime?.sourceFetchConfigured ?? authoringRuntimeReady;
	const modelProviderState: CapabilityState = !authoringRuntimeLoaded
		? 'gated'
		: modelProviderConfigured
			? 'live'
			: 'gated';
	const sourceSearchState: CapabilityState = !authoringRuntimeLoaded
		? 'gated'
		: sourceSearchConfigured
			? 'live'
			: 'gated';
	const pageReadEvaluationState: CapabilityState = !authoringRuntimeLoaded
		? 'gated'
		: sourceFetchConfigured
			? 'live'
			: 'gated';
	const hasProcessEvidence = Boolean(processEvidence && processEvidence.processCount > 0);
	const resolutionStopped = Boolean(processEvidence?.resolutionStopReason);
	const sourceGroundSignal = processEvidence
		? processEvidence.sourceEvidenceEvaluationFallback && processEvidence.searchOnlySourceCount > 0
			? `${processEvidence.searchOnlySourceCount} search-only · eval fallback`
			: processEvidence.evaluatedSourceCount > 0 && processEvidence.searchOnlySourceCount > 0
				? `${processEvidence.evaluatedSourceCount} evaluated · ${processEvidence.searchOnlySourceCount} search-only`
				: processEvidence.evaluatedSourceCount > 0
					? `${processEvidence.evaluatedSourceCount} evaluated sources`
					: processEvidence.searchOnlySourceCount > 0
						? `${processEvidence.searchOnlySourceCount} search-only sources`
						: processEvidence.sourceEvidenceObserved
							? '0 evaluated sources'
							: 'source SSE'
		: 'source SSE';
	const currentProcessMetric = processEvidence?.hasComposedMessage
		? {
				value: processEvidence.messageParagraphCount,
				label: 'emitted paragraphs',
				cite: 'orgOS studioProcessEvidence'
			}
		: processEvidence?.sourceEvidenceObserved
			? {
					value: processEvidence.evaluatedSourceCount,
					label: 'evaluated sources',
					cite: 'stream-message source-evidence via orgOS studioProcessEvidence'
				}
			: processEvidence && processEvidence.evaluatedSourceCount > 0
				? {
						value: processEvidence.evaluatedSourceCount,
						label: 'evaluated sources',
						cite: 'orgOS studioProcessEvidence'
					}
				: processEvidence && processEvidence.searchOnlySourceCount > 0
					? {
							value: processEvidence.searchOnlySourceCount,
							label: 'search-only sources',
							cite: 'orgOS studioProcessEvidence'
						}
					: processEvidence &&
						  processEvidence.resolutionStopReason === 'no-public-email' &&
						  processEvidence.droppedTargetCount > 0
						? {
								value: processEvidence.droppedTargetCount,
								label: 'public-contact drops',
								cite: 'stream-decision-makers pipeline_stats via orgOS studioProcessEvidence'
							}
						: processEvidence && processEvidence.contactableTargetCount > 0
							? {
									value: processEvidence.contactableTargetCount,
									label: 'contactable targets',
									cite: 'orgOS studioProcessEvidence'
								}
							: hasProcessEvidence
								? {
										value: processEvidence?.processCount ?? null,
										label: 'device process records',
										cite: 'orgOS studioProcessEvidence'
									}
								: {
										value: null,
										label: 'authoring evidence',
										cite: 'buildStudioAuthoringReadiness'
									};
	const processEvidenceDetail = processEvidence
		? `${processEvidence.processCount} device-local process records, ${processEvidence.runningCount} running, ${processEvidence.restoredCount} restored, ${processEvidence.contactableTargetCount} contactable targets, ${processEvidence.droppedTargetCount} dropped targets, resolution stop ${processEvidence.resolutionStopReason ?? 'none'}, source evidence ${processEvidence.sourceEvidenceObserved ? (processEvidence.sourceEvidenceMode ?? 'observed') : 'absent'}, fallback ${processEvidence.sourceEvidenceEvaluationFallback ? 'active' : 'off'}, candidates ${processEvidence.sourceEvidenceCandidateCount ?? 'unknown'}, failed reads ${processEvidence.sourceEvidenceFailedCount ?? 'unknown'}, search queries ${processEvidence.sourceEvidenceSearchQueryCount ?? 'unknown'}, ${processEvidence.evaluatedSourceCount} evaluated sources, ${processEvidence.searchOnlySourceCount} search-only sources, ${processEvidence.messageParagraphCount} emitted paragraphs, ${processEvidence.draftHandoffCount} draft handoffs, recovery ${processEvidence.recoveryJobStatus ?? (processEvidence.hasRecoveryJob ? 'present' : 'absent')}, trace ${processEvidence.hasTraceHandle ? 'present' : 'absent'}, scope ${processEvidence.scopeLabel ?? 'not applied'} (${processEvidence.scopeSource ?? 'pending'}).`
		: null;
	const recoveryEnvelopeState: CapabilityState = processEvidence?.hasRecoveryJob
		? 'partial'
		: !authoringRuntimeReady
			? 'gated'
			: messageProofGate.state === 'live'
				? 'live'
				: 'partial';
	const traceReplayState: CapabilityState = processEvidence?.hasTraceHandle
		? 'partial'
		: !authoringRuntimeReady
			? 'gated'
			: delegatedTraceGate.state === 'live'
				? 'live'
				: 'partial';
	const delegatedActionState: CapabilityState =
		delegatedActionGate.state === 'live' ? 'live' : 'gated';
	const resolveState: CapabilityState = !authoringRuntimeReady
		? 'gated'
		: processEvidence?.contactableTargetCount
			? 'live'
			: resolutionStopped
				? 'gated'
				: 'partial';
	const sourceGroundingState: CapabilityState = !authoringRuntimeReady
		? 'gated'
		: resolutionStopped
			? 'gated'
			: processEvidence?.evaluatedSourceCount
				? 'live'
				: 'partial';
	const messageCompositionState: CapabilityState = !authoringRuntimeReady
		? 'gated'
		: processEvidence?.hasComposedMessage
			? 'live'
			: resolutionStopped
				? 'gated'
				: 'partial';
	const draftHandoffState: CapabilityState = !authoringRuntimeReady
		? 'gated'
		: processEvidence?.draftHandoffCount
			? 'draft-only'
			: 'partial';
	const studioIntentHref = `${base}/studio#studio-intent`;
	const rows: StudioAuthoringReadinessRow[] = [
		{
			key: 'intent',
			label: 'Intent input',
			state: 'live',
			phase: 'INTENT',
			clusters: 'C-agentic / C-coordination-integrity',
			href: studioIntentHref,
			action: 'open Studio intent',
			handoff: 'Studio intent',
			signal: hasProcessEvidence
				? `${processEvidence?.processCount ?? 0} process records`
				: 'subject + core message',
			ground: hasProcessEvidence
				? `${processEvidence?.processCount ?? 0} device-local process records are visible in this session.`
				: 'Studio starts only after the operator supplies a subject and core message.',
			gate: 'Intent input is an operator action, not generated placeholder copy.',
			metric: {
				value: hasProcessEvidence ? (processEvidence?.processCount ?? null) : null,
				label: 'process records',
				cite: hasProcessEvidence ? 'orgOS studioProcessEvidence' : 'Studio intent form state'
			}
		},
		{
			key: 'model-provider',
			label: 'Model provider',
			state: modelProviderState,
			phase: 'AUTHOR',
			clusters: 'C-agentic / C-quality-signaling',
			href: studioIntentHref,
			action: modelProviderConfigured ? 'read model ground' : 'read model boundary',
			handoff: 'Model provider',
			signal: modelProviderConfigured ? 'model connected' : 'model missing',
			ground: modelProviderConfigured
				? 'Model provider is connected for source-grounded message authoring.'
				: authoringRuntimeLoaded
					? 'Model provider is not connected; Studio can collect intent, but cannot claim grounded authoring.'
					: 'Model-provider ground was not loaded into the OS shell.',
			gate: modelProviderConfigured
				? 'Model-provider ground is necessary, not sufficient; source discovery, page-read evaluation, review, quota, and route-local errors can still stop a run.'
				: `${authoringRuntimeBoundary} Missing authoring capability: model provider. Dependency: ${authoringRuntimeDependency}.`,
			metric: {
				value: modelProviderConfigured ? 1 : null,
				label: modelProviderConfigured ? 'model provider' : 'model missing',
				cite: 'getMessageGenerationReadiness.modelProviderConfigured'
			}
		},
		{
			key: 'source-search',
			label: 'Source search',
			state: sourceSearchState,
			phase: 'GROUND',
			clusters: 'C-agentic / C-reader-side',
			href: studioIntentHref,
			action: sourceSearchConfigured ? 'read search ground' : 'read search boundary',
			handoff: 'Source discovery',
			signal: sourceSearchConfigured ? 'source discovery connected' : 'source discovery missing',
			ground: sourceSearchConfigured
				? 'Source discovery is connected for evidence search before authoring.'
				: authoringRuntimeLoaded
					? 'Source search is not configured; Studio cannot claim grounded source discovery.'
					: 'Source-search ground was not loaded into the OS shell.',
			gate: sourceSearchConfigured
				? 'Source discovery can find candidate evidence, but evaluated source ground still waits on page-read and incentive/credibility evaluation.'
				: `${authoringRuntimeBoundary} Missing authoring capability: source discovery. Dependency: ${authoringRuntimeDependency}.`,
			metric: {
				value: sourceSearchConfigured ? 1 : null,
				label: sourceSearchConfigured ? 'source discovery' : 'source discovery missing',
				cite: 'getMessageGenerationReadiness.sourceSearchConfigured'
			}
		},
		{
			key: 'page-read-evaluation',
			label: 'Page-read evaluation',
			state: pageReadEvaluationState,
			phase: 'GROUND',
			clusters: 'C-agentic / C-quality-signaling / C-reader-side',
			href: studioIntentHref,
			action: sourceFetchConfigured ? 'read evaluation ground' : 'read evaluation boundary',
			handoff: 'Page-read evaluator',
			signal: sourceFetchConfigured ? 'page-read connected' : 'page-read missing',
			ground: sourceFetchConfigured
				? 'Page-read evaluation is connected so source candidates can be fetched and assessed.'
				: authoringRuntimeLoaded
					? 'Page-read evaluation is not connected; search results remain insufficient for evaluated source evidence.'
					: 'Page-read evaluation ground was not loaded into the OS shell.',
			gate: sourceFetchConfigured
				? 'Page-read evaluation enables evaluated source ground; source credibility, incentive assessment, and provider failure still bound each run.'
				: `${authoringRuntimeBoundary} Missing authoring capability: page-read evaluation. Dependency: ${authoringRuntimeDependency}.`,
			metric: {
				value: sourceFetchConfigured ? 1 : null,
				label: sourceFetchConfigured ? 'page-read runtime' : 'page-read missing',
				cite: 'getMessageGenerationReadiness.sourceFetchConfigured'
			}
		},
		{
			key: 'resolve',
			label: 'Decision-maker resolve',
			state: resolveState,
			phase: 'RESOLVE',
			clusters: 'C-agentic / C-reach',
			href: studioIntentHref,
			action: 'open target reasoning',
			handoff: 'Power target',
			signal: studioResolveSignal(processEvidence),
			ground: !authoringRuntimeReady
				? `Decision-maker resolution is dependency-bound; missing ${authoringRuntimeMissingText}.`
				: (studioResolveGround(processEvidence) ??
					'Authoring stays closed until RESOLVE emits at least one contactable target.'),
			gate: !authoringRuntimeReady
				? `${authoringRuntimeBoundary} Dependency: ${authoringRuntimeDependency}.`
				: resolutionStopped
					? `${processEvidence?.resolutionStopDetail ?? 'Resolution stopped without a typed contactable-target boundary.'} Revise the audience, broaden the target basis, or hydrate public-contact evidence before AUTHOR.`
					: formatGateEvidence(studioJurisdictionScopeGate, {
							prefix:
								'stream-decision-makers must emit a contactable target before stream-message can run; full jurisdiction scope remains bounded.',
							complete:
								'stream-decision-makers must emit a contactable target before stream-message can run; full jurisdiction scope is armed.',
							density: 'operator'
						}),
			metric: {
				value: processEvidence ? processEvidence.contactableTargetCount : null,
				label: 'contactable targets',
				cite: processEvidence ? 'orgOS studioProcessEvidence' : 'stream-decision-makers'
			}
		},
		{
			key: 'source-grounding',
			label: 'Source grounding',
			state: sourceGroundingState,
			phase: 'GROUND',
			clusters: 'C-agentic / C-quality-signaling / C-reader-side',
			href: studioIntentHref,
			action: 'read source grounding',
			handoff: 'Source basis',
			signal: sourceGroundSignal,
			ground: !authoringRuntimeReady
				? `Source grounding stays dependency-first; missing ${authoringRuntimeMissingText}.`
				: processEvidence && processEvidence.evaluatedSourceCount > 0
					? processEvidence.searchOnlySourceCount > 0
						? `${processEvidence.evaluatedSourceCount} evaluated sources and ${processEvidence.searchOnlySourceCount} search-only sources are attached to the focused Studio run. ${studioSourceEvidenceAudit(processEvidence)}`
						: `${processEvidence.evaluatedSourceCount} evaluated sources are attached to the focused Studio run. ${studioSourceEvidenceAudit(processEvidence)}`
					: resolutionStopped
						? 'Source grounding did not start because RESOLVE did not emit a contactable target.'
						: processEvidence && processEvidence.searchOnlySourceCount > 0
							? `${processEvidence.searchOnlySourceCount} attached sources came from search relevance after evaluation fallback; they are not counted as evaluated source ground. ${studioSourceEvidenceAudit(processEvidence)}`
							: processEvidence?.sourceEvidenceObserved
								? `The authoring stream emitted source evidence with 0 evaluated sources; authored output must not claim citation support. ${studioSourceEvidenceAudit(processEvidence)}`
								: processEvidence
									? 'Source evidence has not emitted yet; source counts remain unclaimed for the focused Studio run.'
									: 'Runtime is armed, but GROUND has not emitted source evidence for a focused Studio run.',
			gate: authoringRuntimeReady
				? `Source grounding is emitted by the authoring stream; provider search, fetch, evaluation, moderation, and quota failures can still stop a run. Evaluation fallback remains search-only ground until incentive/credibility assessment succeeds. ${studioSourceEvidenceAudit(processEvidence)}`
				: `${authoringRuntimeBoundary} Dependency: ${authoringRuntimeDependency}.`,
			metric: {
				value:
					processEvidence &&
					(processEvidence.sourceEvidenceObserved || processEvidence.evaluatedSourceCount > 0)
						? processEvidence.evaluatedSourceCount
						: null,
				label: 'evaluated sources',
				cite: processEvidence?.sourceEvidenceObserved
					? 'stream-message source-evidence via orgOS studioProcessEvidence'
					: processEvidence
						? 'orgOS studioProcessEvidence'
						: 'stream-message evaluatedSources'
			}
		},
		{
			key: 'message-composition',
			label: 'Artifact authoring',
			state: messageCompositionState,
			phase: 'AUTHOR',
			clusters: 'C-agentic / C-reader-side',
			href: studioIntentHref,
			action: 'read authored output',
			handoff: 'Authored artifact',
			signal:
				processEvidence && processEvidence.hasComposedMessage
					? `${processEvidence.messageParagraphCount} emitted paragraphs`
					: 'AUTHOR stream',
			ground: !authoringRuntimeReady
				? `Artifact authoring stays dependency-first; missing ${authoringRuntimeMissingText}.`
				: processEvidence && processEvidence.hasComposedMessage
					? `${processEvidence.messageParagraphCount} authored artifact paragraphs are loaded from the focused Studio run.`
					: resolutionStopped
						? 'Artifact authoring did not start because RESOLVE did not emit a contactable target.'
						: processEvidence
							? 'AUTHOR has not emitted an artifact for the focused Studio run.'
							: 'Runtime is armed, but AUTHOR has not emitted an artifact for a focused Studio run.',
			gate: authoringRuntimeReady
				? 'Authored artifact is current-run evidence; delivery surfaces still own editing, preview, publish, and send confirmation.'
				: `${authoringRuntimeBoundary} Dependency: ${authoringRuntimeDependency}.`,
			metric: {
				value: processEvidence?.hasComposedMessage ? processEvidence.messageParagraphCount : null,
				label: 'emitted paragraphs',
				cite: processEvidence?.hasComposedMessage
					? 'orgOS studioProcessEvidence'
					: 'stream-message message phase'
			}
		},
		{
			key: 'draft-handoff',
			label: 'Draft handoff',
			state: draftHandoffState,
			phase: 'SEND',
			clusters: 'C-agentic / C-coordination-integrity',
			href: `${base}/studio#studio-send`,
			action: 'open draft handoffs',
			handoff: 'Delivery-surface drafts',
			signal:
				processEvidence && processEvidence.draftHandoffCount > 0
					? `${processEvidence.draftHandoffCount} draft handoffs`
					: 'public template + email drafts',
			ground:
				processEvidence && processEvidence.draftHandoffCount > 0
					? `${processEvidence.draftHandoffCount} delivery-surface draft handoffs are available for the focused Studio run.`
					: !authoringRuntimeReady
						? 'Draft handoff cannot be claimed until the authoring runtime can emit an artifact.'
						: 'Studio can hand emitted artifacts to delivery-surface drafts after authoring; no focused artifact has emitted yet.',
			gate: 'Draft handoff is not publish or dispatch execution; public template and email surfaces own final confirmation.',
			metric: {
				value: processEvidence?.draftHandoffCount ? processEvidence.draftHandoffCount : null,
				label: 'draft handoffs',
				cite: 'StudioSend public template + org email handlers'
			}
		},
		{
			key: 'recovery-envelope',
			label: 'Recovery envelope',
			state: recoveryEnvelopeState,
			phase: 'AGGREGATE',
			clusters: 'C-agentic / C-data-sovereignty',
			href: studioIntentHref,
			action: 'read recovery boundary',
			handoff: 'Message recovery',
			signal: processEvidence?.hasRecoveryJob
				? `recovery ${processEvidence.recoveryJobStatus ?? 'present'}`
				: recoveryEnvelopeState === 'live'
					? 'proof binding armed'
					: 'device recovery',
			ground: processEvidence?.hasRecoveryJob
				? `The focused Studio run has a recoverable message job with status ${processEvidence.recoveryJobStatus ?? 'present'}.`
				: authoringRuntimeReady
					? 'stream-message can issue a recoverable job tuple for same-device output recovery.'
					: 'No recovery job can be claimed until the authoring runtime is configured.',
			gate:
				authoringRuntimeReady || processEvidence?.hasRecoveryJob
					? formatGateEvidence(messageProofGate, {
							prefix:
								'Device-local recovery is live; proof-bound drafted-message lift remains bounded.',
							complete: 'Proof-bound drafted-message lift is armed.',
							density: 'operator'
						})
					: `${authoringRuntimeBoundary} Dependency: ${authoringRuntimeDependency}.`,
			metric: {
				value: processEvidence?.hasRecoveryJob ? 1 : null,
				label: 'recovery job',
				cite: processEvidence?.hasRecoveryJob
					? 'orgOS studioProcessEvidence'
					: 'stream-message job_id/input_hash'
			}
		},
		{
			key: 'trace-replay',
			label: 'Trace replay',
			state: traceReplayState,
			phase: 'AGGREGATE',
			clusters: 'C-agentic / C-accountability',
			href: studioIntentHref,
			action: 'read trace boundary',
			handoff: 'Trace handle',
			signal: processEvidence?.hasTraceHandle
				? 'trace handle present'
				: traceReplayState === 'live'
					? 'trace replay armed'
					: 'operator trace handle',
			ground: processEvidence?.hasTraceHandle
				? 'The focused Studio run carries a stream-message trace handle.'
				: authoringRuntimeReady
					? 'stream-message can emit a trace id; persistence and replay remain operator-only and env-gated.'
					: 'No trace handle can be claimed until the authoring runtime is configured.',
			gate:
				authoringRuntimeReady || processEvidence?.hasTraceHandle
					? formatGateEvidence(delegatedTraceGate, {
							prefix: 'Operator trace handles are live; delegated trace replay remains bounded.',
							complete: 'Delegated trace replay is armed.',
							density: 'operator'
						})
					: `${authoringRuntimeBoundary} Dependency: ${authoringRuntimeDependency}.`,
			metric: {
				value: processEvidence?.hasTraceHandle ? 1 : null,
				label: 'trace handles',
				cite: processEvidence?.hasTraceHandle
					? 'orgOS studioProcessEvidence'
					: 'stream-message traceId + agentTraces'
			}
		},
		{
			key: 'delegated-action',
			label: 'Delegated civic action',
			state: delegatedActionState,
			phase: 'SEND',
			clusters: 'C-agentic / C-data-sovereignty / C-accountability',
			href: `${base}/studio#capability-gates`,
			action: 'read delegation gate',
			handoff: 'Delegated action',
			signal: delegatedActionState === 'live' ? 'delegation armed' : 'operator-initiated only',
			ground:
				'Grounded authoring is operator-initiated; autonomous delegated action is a separate executor and proof contract.',
			gate: formatGateEvidence(delegatedActionGate, {
				prefix: 'Autonomous delegated action remains separate from grounded authoring.',
				complete: 'Autonomous delegated action is armed; route-level grant scope still applies.',
				density: 'operator'
			}),
			metric: {
				value: delegatedActionState === 'live' ? 1 : delegatedActionGate.downstream,
				label: delegatedActionState === 'live' ? 'executor route' : 'downstream blocked',
				cite: delegatedActionGate.source
			}
		}
	];
	const boundaryRows = rows.filter((row) => row.state !== 'live');
	const liveStepCount = rows.length - boundaryRows.length;
	const boundaryCount = boundaryRows.length;
	const coreAuthoringRows = rows.filter((row) =>
		[
			'intent',
			'model-provider',
			'source-search',
			'page-read-evaluation',
			'resolve',
			'source-grounding',
			'message-composition'
		].includes(row.key)
	);

	return {
		rows,
		state: coreAuthoringRows.every((row) => row.state === 'live') ? 'live' : 'partial',
		runtimeLoaded: authoringRuntimeLoaded,
		runtimeReady: authoringRuntimeReady,
		signal:
			processEvidence && processEvidence.hasComposedMessage
				? `${processEvidence.contactableTargetCount} targets · ${processEvidence.evaluatedSourceCount} sources · ${processEvidence.messageParagraphCount} paragraphs`
				: !authoringRuntimeReady
					? `runtime missing: ${authoringRuntimeMissingText}`
					: hasProcessEvidence
						? resolutionStopped
							? `${processEvidence?.processCount ?? 0} processes · ${studioResolveSignal(processEvidence)} · ${processEvidence?.evaluatedSourceCount ?? 0} sources`
							: `${processEvidence?.processCount ?? 0} processes · ${processEvidence?.contactableTargetCount ?? 0} targets · ${processEvidence?.evaluatedSourceCount ?? 0} sources`
						: `${liveStepCount}/${rows.length} authoring contracts armed · ${
								boundaryCount > 0 ? `${boundaryCount} bounded` : 'all armed'
							}`,
		effect:
			processEvidence && processEvidence.hasComposedMessage
				? 'A focused Studio process has emitted contactable targets, evaluated sources, and an authored artifact; draft handoff, recovery, trace, and delegated-action claims remain explicitly separated.'
				: !authoringRuntimeReady
					? 'Studio intent can be shaped, but grounded authoring streams stay dependency-first until model provider, source discovery, and page-read evaluation are connected.'
					: hasProcessEvidence
						? resolutionStopped
							? 'The focused Studio process stopped at RESOLVE; the map names whether the boundary is target discovery, public-contact evidence, or an operator stop before any AUTHOR claim.'
							: 'Studio process evidence is device-local and current-run bounded; target resolution, source grounding, artifact authoring, draft handoff, recovery, trace, and delegated-action claims stay distinct.'
						: boundaryCount > 0
							? 'Grounded authoring runtime can start now; target resolution, source grounding, artifact authoring, draft handoff, recovery, trace, and delegated-action claims stay unpromoted until emitted evidence exists.'
							: 'Grounded authoring, proof binding, trace replay, and delegated action are armed.',
		detail: !authoringRuntimeReady
			? `${authoringRuntimeBoundary} Missing ${authoringRuntimeMissingText}.`
			: processEvidenceDetail
				? `${processEvidenceDetail} Studio runs source, decision-maker, and artifact reasoning through live SSE endpoints, then hands emitted artifacts to delivery-surface drafts.`
				: 'Studio runs source, decision-maker, and artifact reasoning through live SSE endpoints, then hands emitted artifacts to delivery-surface drafts.',
		gate: rows.map((row) => row.gate).join(' '),
		metric: currentProcessMetric,
		processEvidence,
		boundaryCount,
		liveStepCount
	};
}

export function buildMessageGenerationEvidence(
	input: MessageGenerationEvidenceInputs
): MessageGenerationEvidenceSummary {
	const {
		intentFieldCount,
		targetCount,
		phase: inputPhase,
		paragraphCount,
		sourceCount,
		evaluatedSourceCount: inputEvaluatedSourceCount,
		searchOnlySourceCount: inputSearchOnlySourceCount,
		sourceEvidenceObserved = false,
		researchStepCount,
		hasRecoveryJob,
		recoveryJobStatus,
		traceHandle,
		messageProofGate
	} = input;
	const phase: MessageGenerationEvidencePhase =
		inputPhase ?? (paragraphCount > 0 ? 'complete' : 'preparing');
	const intentState: CapabilityState = intentFieldCount >= 2 ? 'live' : 'gated';
	const targetState: CapabilityState = targetCount > 0 ? 'live' : 'gated';
	const generationReady = intentState === 'live' && targetState === 'live';
	const sourceDiscoveryActive = phase === 'sources';
	const artifactAuthoringActive = phase === 'message';
	const recoveryActive = phase === 'recovering';
	const sourceCountKnown = sourceCount > 0 || sourceEvidenceObserved || phase === 'complete';
	const searchOnlySourceCount = Math.max(
		0,
		inputSearchOnlySourceCount ?? (sourceCountKnown ? 0 : 0)
	);
	const evaluatedSourceCount = Math.max(
		0,
		inputEvaluatedSourceCount ??
			(sourceCountKnown ? Math.max(0, sourceCount - searchOnlySourceCount) : 0)
	);
	const sourceHasOnlySearchFallback =
		sourceCountKnown && sourceCount > 0 && evaluatedSourceCount === 0 && searchOnlySourceCount > 0;
	const outputState: CapabilityState =
		paragraphCount > 0 ? 'live' : generationReady && artifactAuthoringActive ? 'partial' : 'gated';
	const sourceState: CapabilityState = !generationReady
		? 'gated'
		: evaluatedSourceCount > 0
			? 'live'
			: sourceCountKnown
				? 'partial'
				: 'partial';
	const researchState: CapabilityState = !generationReady
		? 'gated'
		: researchStepCount > 0
			? 'live'
			: 'partial';
	const recoveryState: CapabilityState = hasRecoveryJob ? 'partial' : 'gated';
	const traceState: CapabilityState = traceHandle
		? 'partial'
		: hasRecoveryJob
			? 'partial'
			: 'gated';
	const proofState: CapabilityState = messageProofGate.state === 'live' ? 'live' : 'gated';
	const deliveryHandoffState: CapabilityState =
		paragraphCount <= 0 ? 'gated' : proofState === 'live' ? 'live' : 'partial';
	const streamPhaseState: CapabilityState = !generationReady
		? 'gated'
		: phase === 'sources' || phase === 'message' || phase === 'complete'
			? 'live'
			: phase === 'recovering'
				? 'partial'
				: 'partial';
	const proofBoundary = formatGateEvidence(messageProofGate, {
		prefix:
			'Authored artifact is editable and recoverable; proof-bound drafted-message lift remains bounded.',
		complete: 'Authored artifact can be attached to proof-bound drafted messages.',
		density: 'operator'
	});
	const paragraphLabel = paragraphCount === 1 ? 'paragraph' : 'paragraphs';
	const paragraphVerb = paragraphCount === 1 ? 'is' : 'are';
	const evaluatedSourceLabel =
		evaluatedSourceCount === 1 ? 'evaluated source' : 'evaluated sources';
	const searchOnlySourceLabel =
		searchOnlySourceCount === 1 ? 'search-only source' : 'search-only sources';
	const sourceSignal = sourceCountKnown
		? searchOnlySourceCount > 0
			? `${evaluatedSourceCount} evaluated · ${searchOnlySourceCount} search-only`
			: `${evaluatedSourceCount} ${evaluatedSourceLabel}`
		: 'source stream';
	const targetLabel = targetCount === 1 ? 'target' : 'targets';
	const streamPhaseSignal =
		phase === 'sources'
			? 'source discovery'
			: phase === 'message'
				? 'artifact authoring'
				: phase === 'complete'
					? 'artifact emitted'
					: phase === 'recovering'
						? 'recovery poll'
						: 'preparing';
	const streamPhaseGround =
		phase === 'sources'
			? 'The authoring stream is running GROUND; source counts stay unclaimed until sources emit.'
			: phase === 'message'
				? 'The authoring stream is running AUTHOR against selected target and source ground.'
				: phase === 'complete'
					? 'The authoring stream emitted completion; artifact, sources, and research rows can cite result payload counts.'
					: phase === 'recovering'
						? 'Same-device recovery is polling the recoverable job envelope instead of starting an untracked duplicate.'
						: 'Authoring is preparing; no phase event has been claimed yet.';
	const rows: MessageGenerationEvidenceRow[] = [
		{
			key: 'intent-input',
			label: 'Intent input',
			state: intentState,
			phase: 'INTENT',
			clusters: 'C-agentic / C-composability',
			signal: `${Math.min(intentFieldCount, 2)} / 2 fields`,
			action: 'read intent',
			effect:
				intentState === 'live'
					? 'Operator intent is ready for source-grounded authoring.'
					: 'Collect subject and core message before authoring starts.',
			ground:
				intentState === 'live'
					? 'Subject and core message are present before stream-message runs.'
					: 'Authoring is closed until subject and core message are both present.',
			gate: 'The authoring run receives explicit operator intent; it does not invent an action from an empty prompt.',
			metric: {
				value: Math.min(intentFieldCount, 2),
				label: 'required fields',
				cite: 'TemplateFormData.objective'
			}
		},
		{
			key: 'target-basis',
			label: 'Target basis',
			state: targetState,
			phase: 'RESOLVE',
			clusters: 'C-reach / C-accountability',
			signal: targetCount > 0 ? `${targetCount} ${targetLabel}` : 'no target',
			action: 'read target basis',
			effect:
				targetState === 'live'
					? 'Selected decision-maker ground can constrain the authoring run.'
					: 'Resolve a contactable decision-maker before authoring.',
			ground:
				targetCount > 0
					? `${targetCount} selected decision-maker ${targetLabel} ${targetCount === 1 ? 'is' : 'are'} passed into AUTHOR.`
					: 'No authored artifact is claimed until at least one selected decision-maker exists.',
			gate: 'Decision-maker resolution owns target selection; AUTHOR is not a substitute for RESOLVE.',
			metric: {
				value: targetCount > 0 ? targetCount : null,
				label: 'selected targets',
				cite: 'TemplateFormData.audience.decisionMakers'
			}
		},
		{
			key: 'stream-phase',
			label: 'Stream phase',
			state: streamPhaseState,
			phase:
				phase === 'sources'
					? 'GROUND'
					: phase === 'message'
						? 'AUTHOR'
						: phase === 'complete' || phase === 'recovering'
							? 'AGGREGATE'
							: 'INTENT',
			clusters: 'C-agentic / C-coordination-integrity',
			signal: streamPhaseSignal,
			action: 'read stream phase',
			effect:
				streamPhaseState === 'live'
					? 'The active stream phase is emitted as authoring evidence.'
					: 'Phase posture stays bounded until stream-message emits a phase or recovery state.',
			ground: streamPhaseGround,
			gate: 'Phase evidence comes from the authoring stream phase event or same-device recovery state; it is not a substitute for emitted artifact counts.',
			metric: {
				value:
					phase === 'sources' ||
					phase === 'message' ||
					phase === 'complete' ||
					phase === 'recovering'
						? 1
						: null,
				label: streamPhaseSignal,
				cite:
					phase === 'recovering'
						? 'activeMessageJob recovery poll'
						: phase === 'sources' || phase === 'message' || phase === 'complete'
							? 'stream-message phase SSE'
							: 'no stream phase'
			}
		},
		{
			key: 'output-basis',
			label: 'Artifact basis',
			state: outputState,
			phase: 'AUTHOR',
			clusters: 'C-agentic / C-reader-side',
			signal: paragraphCount > 0 ? `${paragraphCount} ${paragraphLabel}` : 'no artifact',
			action: paragraphCount > 0 ? 'edit authored artifact' : 'read artifact boundary',
			effect:
				outputState === 'live'
					? 'Emitted text can move into edit, preview, and delivery-surface handoffs.'
					: 'No authored artifact is claimed until stream-message emits output.',
			ground:
				paragraphCount > 0
					? `${paragraphCount} authored artifact ${paragraphLabel} ${paragraphVerb} loaded from stream-message.`
					: artifactAuthoringActive
						? 'Artifact authoring is active; no authored text is claimed until completion emits.'
						: 'No authored text is claimed until stream-message emits output.',
			gate: 'Only emitted authored text is shown here; delivery surfaces still own editing, preview, publish, and send confirmation.',
			metric: {
				value: paragraphCount > 0 ? paragraphCount : null,
				label: 'emitted paragraphs',
				cite: 'authoring result payload'
			}
		},
		{
			key: 'source-basis',
			label: 'Source basis',
			state: sourceState,
			phase: 'GROUND',
			clusters: 'C-agentic / C-quality-signaling / C-reader-side',
			signal: sourceSignal,
			action: 'read source basis',
			effect:
				sourceState === 'live'
					? 'Attached sources can support reader-legible artifact evidence.'
					: sourceHasOnlySearchFallback
						? 'Attached sources are search-only fallback ground; do not treat them as evaluated source evidence.'
						: sourceCountKnown
							? 'No evaluated sources are attached; output must not claim citation support.'
							: 'Source discovery may be active, but the source count remains unclaimed.',
			ground:
				evaluatedSourceCount > 0 && searchOnlySourceCount > 0
					? `${evaluatedSourceCount} ${evaluatedSourceLabel} and ${searchOnlySourceCount} ${searchOnlySourceLabel} are attached to this authored artifact.`
					: evaluatedSourceCount > 0
						? `${evaluatedSourceCount} ${evaluatedSourceLabel} ${evaluatedSourceCount === 1 ? 'is' : 'are'} attached to this authored artifact.`
						: sourceHasOnlySearchFallback
							? `${searchOnlySourceCount} attached ${searchOnlySourceLabel} came from search relevance after evaluation fallback.`
							: sourceCountKnown
								? 'Source evaluation completed with 0 sources; authored output must not cite external sources.'
								: sourceDiscoveryActive
									? 'Source discovery is active; source count remains unclaimed until the authoring stream emits the result.'
									: 'Source discovery can run, but this result has no source count to cite.',
			gate: 'Source rows come from authoring stream sources; provider search, fetch, evaluation, moderation, and quota failures can still stop a run. Evaluation fallback remains search-only source ground.',
			metric: {
				value: sourceCountKnown ? evaluatedSourceCount : null,
				label: searchOnlySourceCount > 0 ? 'evaluated sources' : 'sources',
				cite:
					sourceEvidenceObserved && phase !== 'complete'
						? 'stream-message source-evidence'
						: 'stream-message sources'
			}
		},
		{
			key: 'research-trace',
			label: 'Research trace',
			state: researchState,
			phase: 'GROUND',
			clusters: 'C-agentic / C-coordination-integrity',
			signal: researchStepCount > 0 ? `${researchStepCount} steps` : 'trace optional',
			action: 'read research trace',
			effect:
				researchState === 'live'
					? 'Operator-facing reasoning is visible for this run.'
					: 'Reasoning evidence appears only when the stream emits it.',
			ground:
				researchStepCount > 0
					? `${researchStepCount} research steps are visible from the stream.`
					: 'Reasoning steps are shown only when the stream emitted them.',
			gate: 'Research trace is operator-facing reasoning evidence, not proof-bound delegated action audit.',
			metric: {
				value: researchStepCount > 0 ? researchStepCount : null,
				label: 'research steps',
				cite: 'stream-message research_log'
			}
		},
		{
			key: 'delivery-handoff',
			label: 'Delivery handoff',
			state: deliveryHandoffState,
			phase: 'SEND',
			clusters: 'C-composability / C-reader-side',
			signal:
				paragraphCount > 0
					? deliveryHandoffState === 'live'
						? 'proof-bound handoff'
						: 'public action handoff'
					: 'awaiting output',
			action: paragraphCount > 0 ? 'publish public action template' : 'read handoff boundary',
			effect:
				paragraphCount > 0
					? 'Authored artifact can publish as a public action template; delivery side effects remain delivery-surface-owned.'
					: 'No delivery-surface handoff is claimed until stream-message emits output.',
			ground:
				paragraphCount > 0
					? 'The emitted artifact is ready for public-template creation, while delivery surfaces still own send, dispatch, receipt, and proof semantics.'
					: 'AUTHOR has not emitted an authored artifact, so there is nothing to hand to a delivery surface.',
			gate: formatGateEvidence(messageProofGate, {
				prefix:
					'Public-template handoff can publish the action shell; proof-bound message execution remains bounded.',
				complete:
					'Public-template handoff can attach authored output to proof-bound drafted messages; route-level send readiness still applies.',
				density: 'operator'
			}),
			metric: {
				value: paragraphCount > 0 ? 1 : null,
				label: paragraphCount > 0 ? 'handoff ready' : 'handoff pending',
				cite: paragraphCount > 0 ? 'TemplateCreator public action publish' : 'no authoring result'
			}
		},
		{
			key: 'recovery-job',
			label: 'Recovery job',
			state: recoveryState,
			phase: 'AGGREGATE',
			clusters: 'C-agentic / C-data-sovereignty',
			signal: hasRecoveryJob ? `recovery ${recoveryJobStatus ?? 'present'}` : 'not retained',
			action: hasRecoveryJob ? 'recover artifact' : 'read recovery boundary',
			effect: hasRecoveryJob
				? 'Same-device recovery can recover the authored artifact envelope.'
				: 'Recovery is not retained; same-device recovery claims stay dependency-first until stream-message issues a recoverable job tuple.',
			ground: hasRecoveryJob
				? `Same-device recovery handle is retained with status ${recoveryJobStatus ?? 'present'}.`
				: 'No recoverable job tuple is attached to this authored artifact.',
			gate: formatGateEvidence(messageProofGate, {
				prefix: 'Device-local recovery is live; proof-bound drafted-message lift remains bounded.',
				complete: 'Proof-bound drafted-message lift is armed.',
				density: 'operator'
			}),
			metric: {
				value: hasRecoveryJob ? 1 : null,
				label: recoveryJobStatus ?? 'recovery job',
				cite: hasRecoveryJob ? 'activeMessageJob job_id/input_hash' : 'no active message job'
			}
		},
		{
			key: 'trace-handle',
			label: 'Trace handle',
			state: traceState,
			phase: 'AGGREGATE',
			clusters: 'C-agentic / C-accountability',
			signal: traceHandle ? traceHandle : hasRecoveryJob ? 'trace pending' : 'not emitted',
			action: 'read trace handle',
			effect: traceHandle
				? 'Operator observability can cite the emitted trace handle.'
				: 'Trace replay remains bounded until a stream trace handle exists.',
			ground: traceHandle
				? 'Server-side trace handle is present for operator observability.'
				: 'No server trace handle was emitted for this run.',
			gate: 'Trace handles are operator observability evidence; delegated trace replay remains gated until grant-indexed executor events exist.',
			metric: {
				value: traceHandle ? 1 : null,
				label: traceHandle ?? 'trace handle',
				cite: traceHandle ? 'stream-message traceId' : 'no trace id emitted'
			}
		},
		{
			key: 'proof-binding',
			label: 'Proof binding',
			state: proofState,
			phase: 'AGGREGATE',
			clusters: 'C-agentic / C-verification / C-accountability',
			signal: proofState === 'live' ? 'proof binding armed' : 'not armed',
			action: 'read proof boundary',
			effect:
				proofState === 'live'
					? 'Authored artifact can be attached to proof-bound drafted messages.'
					: 'Authored artifact remains a recoverable draft artifact, not delegated proof.',
			ground:
				proofState === 'live'
					? 'Authored artifact can be attached to proof-bound drafted messages.'
					: 'Authored artifact is a recoverable draft artifact, not a proof-bound delegated action.',
			gate: proofBoundary,
			metric: {
				value: proofState === 'live' ? 1 : null,
				label: proofState === 'live' ? 'armed' : 'not armed',
				cite: messageProofGate.source
			}
		}
	];
	const boundaryRows = rows.filter((row) => row.state !== 'live');
	const liveCount = rows.length - boundaryRows.length;
	const boundaryCount = boundaryRows.length;
	const state: CapabilityState = !generationReady
		? 'gated'
		: outputState === 'live' && proofState === 'live'
			? 'live'
			: outputState === 'live'
				? 'partial'
				: 'partial';

	return {
		rows,
		state,
		signal: !generationReady
			? intentState !== 'live'
				? 'intent incomplete'
				: 'target missing'
			: paragraphCount > 0
				? `${paragraphCount} ${paragraphLabel} · ${sourceSignal}`
				: sourceDiscoveryActive
					? 'source discovery running'
					: artifactAuthoringActive
						? 'artifact authoring running'
						: recoveryActive
							? 'recovery polling'
							: 'authored artifact pending',
		effect: !generationReady
			? 'Authoring is gated until operator intent and selected decision-maker target ground are both present.'
			: paragraphCount > 0
				? 'Authoring emitted an artifact with source, research, recovery, trace, and proof boundaries separated.'
				: sourceDiscoveryActive
					? 'Authoring is grounding sources; no authored artifact is claimed yet.'
					: artifactAuthoringActive
						? 'Authoring is composing against selected target and source ground; output remains unclaimed until completion.'
						: recoveryActive
							? 'Authoring is polling same-device recovery instead of starting an untracked duplicate run.'
							: 'Authoring has not emitted an artifact; no authored artifact is claimed.',
		detail:
			'The public creator and OS map use the same contract shape: intent and target ground first, emitted artifact next, then source ground, recovery, trace, and proof-boundary evidence.',
		gate: rows.map((row) => row.gate).join(' '),
		liveCount,
		boundaryCount
	};
}

export function buildPlatformIntakeReadiness(
	input: PlatformIntakeReadinessInputs
): PlatformIntakeReadinessSummary {
	const { base, platformApiGate, platformApiSync } = input;
	const runtimeReady = platformApiSync?.runtimeReady === true;
	const runtimeMissing = formatRuntimeMissing(platformApiSync?.runtimeMissing);
	const runtimeDependency =
		platformApiSync?.runtimeDependency ??
		'profile registry, encrypted credential custody, direct sync execution, and continuation checkpointing';
	const runtimeMessage =
		platformApiSync?.runtimeMessage ??
		`Direct platform sync is not armed; missing ${runtimeMissing}. CSV export intake remains the live migration path.`;
	const custodyReady = platformApiSync?.credentialCustodyReady === true;
	const credentialStored = platformApiSync?.credentialStored === true;
	const credentialProbeComplete = platformApiSync?.credentialProbeComplete === true;
	const runnerImplemented = platformApiSync?.runnerImplemented === true;
	const armedAdapterSources = (platformApiSync?.armedAdapterSources ?? []).filter(
		(source): source is string => typeof source === 'string'
	);
	const armedAdapterCount = armedAdapterSources.length;
	const custodyEvidenceCount =
		(custodyReady ? 1 : 0) + (credentialStored ? 1 : 0) + (credentialProbeComplete ? 1 : 0);
	const anyAdapterArmed = runtimeReady && armedAdapterCount > 0;
	const csvHref = `${base}/supporters/import#csv-intake`;
	const apiHref = `${base}/supporters/import/platform-api#platform-connection-boundary`;
	const apiAction = runtimeReady
		? 'prove direct sync'
		: custodyReady
			? 'store credential'
			: 'read sync boundary';
	const apiRunnerProofs = [...PLATFORM_API_RUNNER_PROOF_REQUIREMENTS];
	const apiRunnerProofCount = apiRunnerProofs.length;
	const apiRunnerProofSummary = apiRunnerProofs.join(' + ');
	const rows: PlatformIntakeProfileRow[] = PLATFORM_EXPORT_PROFILES.map((profile) => ({
		label: profile.label,
		source: profile.source,
		csvState: 'live',
		apiState:
			runtimeReady && armedAdapterSources.includes(profile.source)
				? ('partial' as const)
				: ('gated' as const),
		href: csvHref,
		csvHref,
		apiHref,
		csvAction: 'upload CSV export',
		apiAction,
		fingerprint: profile.requiredAnyHeaders?.length
			? profile.requiredAnyHeaders.join(' / ')
			: `${profile.minMatches} matching headers`,
		matchCount: profile.matchHeaders.length,
		requiredCount: profile.requiredAnyHeaders?.length ?? 0,
		apiProofs: [...apiRunnerProofs],
		apiProofCount: apiRunnerProofCount,
		apiProofSummary: apiRunnerProofSummary,
		gate: platformApiGate,
		clusters: 'C-data-sovereignty / C-reach'
	}));
	const profileCount = rows.length;
	const apiBoundaryCount = rows.filter((row) => row.apiState === 'gated').length;
	const csvContractCount = rows.filter((row) => row.csvState === 'live').length;
	const profileLabel = profileCount === 1 ? 'profile' : 'profiles';
	const apiLabel = apiBoundaryCount === 1 ? 'sync boundary' : 'sync boundaries';
	const gate = formatGateEvidence(platformApiGate, {
		prefix: `${runtimeMessage} Dependency: ${runtimeDependency}.`,
		complete: runtimeReady
			? 'Direct platform sync has custody and execution ground; adapter-specific format, pagination, rate-limit, and import checks still bound each live import claim.'
			: `${runtimeMessage} Dependency: ${runtimeDependency}.`,
		density: 'operator'
	});
	const csvGate =
		profileCount > 0
			? 'Header-profile recognition is armed for CSV export intake; direct sync proof is not required for this path.'
			: 'No export-profile registry is available; generic CSV can be mapped manually without profile evidence.';
	const custodyGate = custodyReady
		? 'Encrypted credential custody is configured; storing a selected platform credential does not call the platform or import people.'
		: `${runtimeMessage} Configure encrypted credential custody before platform API credentials can be stored.`;
	const runnerGate = formatGateEvidence(platformApiGate, {
		prefix: `${runtimeMessage} Direct import stays behind ${apiRunnerProofSummary}.`,
		complete: `The platform sync boundary is through; each direct sync path still needs ${apiRunnerProofSummary}.`,
		density: 'operator'
	});
	const stageRows: PlatformIntakeStageRow[] = [
		{
			id: 'export-recognition',
			label: 'export recognition',
			state: profileCount > 0 ? 'live' : 'gated',
			phase: 'GROUND',
			href: csvHref,
			action: 'upload CSV export',
			handoff: 'CSV export intake',
			effect:
				profileCount > 0
					? `${csvContractCount} profile contracts can recognize organizing exports from header evidence and preserve source custody.`
					: 'Generic CSV intake can still run, but no named profile contract can be cited.',
			gate: csvGate,
			clusters: 'C-data-sovereignty / C-reach',
			metric: {
				value: profileCount,
				label: 'profiles',
				cite: 'PLATFORM_EXPORT_PROFILES.length'
			}
		},
		{
			id: 'credential-custody',
			label: 'credential custody',
			state: custodyReady || credentialStored || credentialProbeComplete ? 'partial' : 'gated',
			phase: 'GROUND',
			href: apiHref,
			action: credentialProbeComplete
				? 'read credential proof'
				: credentialStored
					? 'verify stored credential'
					: custodyReady
						? 'store credential'
						: 'read custody boundary',
			handoff: 'Encrypted credential custody',
			effect: credentialProbeComplete
				? 'A stored platform credential has been opened under org/profile custody; no platform call or import side effect is claimed.'
				: credentialStored
					? 'A selected platform API credential is sealed for this org; custody proof is available before direct sync is armed.'
					: custodyReady
						? 'The server can seal a selected platform API credential for custody; no platform call or import side effect is claimed.'
						: 'Selected platform API credentials stay out of custody until encryption is configured.',
			gate: custodyGate,
			clusters: 'C-data-sovereignty / C-composability',
			metric: {
				value: custodyEvidenceCount,
				label: 'custody marks',
				cite: 'getPlatformApiSyncReadiness + organizations.getPlatformApiState'
			}
		},
		{
			id: 'direct-api-runner',
			label: 'direct sync',
			state: anyAdapterArmed ? 'partial' : 'gated',
			phase: 'RESOLVE',
			href: `${base}/supporters/import/platform-api#platform-sync-boundary`,
			action: apiAction,
			handoff: 'Direct sync execution',
			effect: anyAdapterArmed
				? `Bounded direct import is armed for ${armedAdapterCount} adapter ${armedAdapterCount === 1 ? 'source' : 'sources'}; ${apiBoundaryCount} direct ${apiLabel} stay dependency-first and ${apiRunnerProofSummary} still bound each live import claim.`
				: runnerImplemented
					? `Direct sync execution ground is present, but ${apiRunnerProofSummary} still bound each live import claim.`
					: `${apiBoundaryCount} direct ${apiLabel} remain dependency-first until ${apiRunnerProofSummary} are proven.`,
			gate: runnerGate,
			clusters: 'C-reach / C-composability / C-data-sovereignty',
			metric: {
				value: apiRunnerProofCount,
				label: runnerImplemented ? 'proof checks' : 'proof checks held',
				cite: 'direct sync proof checklist'
			}
		}
	];
	const proofExecutionState: CapabilityState = anyAdapterArmed ? 'partial' : 'gated';
	const proofRows: PlatformApiProofRow[] = [
		{
			id: 'profile-registry',
			label: 'Profile registry',
			state: profileCount > 0 ? 'live' : 'gated',
			href: `${base}/supporters/import/platform-api#platform-profile-contract`,
			action: 'read profile contracts',
			handoff: 'Export dialect registry',
			effect:
				profileCount > 0
					? `${profileCount} platform export profiles are recognized from header evidence.`
					: 'Named platform export profiles are unavailable; direct sync cannot claim profile support.',
			gate: csvGate,
			clusters: 'C-data-sovereignty / C-reach',
			metric: {
				value: profileCount,
				label: 'profiles',
				cite: 'PLATFORM_EXPORT_PROFILES.length'
			}
		},
		{
			id: 'credential-custody',
			label: 'Credential custody',
			state: custodyReady || credentialStored || credentialProbeComplete ? 'partial' : 'gated',
			href: `${base}/supporters/import/platform-api#platform-connection-boundary`,
			action:
				credentialStored || credentialProbeComplete
					? 'read custody proof'
					: custodyReady
						? 'store credential'
						: 'read custody boundary',
			handoff: 'Encrypted credential custody',
			effect:
				credentialStored || credentialProbeComplete
					? 'A selected platform credential is sealed for this org/profile; custody is evidence, not import execution.'
					: custodyReady
						? 'The server can seal a selected platform credential before any platform call is allowed.'
						: 'Platform credentials cannot enter custody until encryption is configured.',
			gate: custodyGate,
			clusters: 'C-data-sovereignty',
			metric: {
				value: custodyEvidenceCount,
				label: 'custody marks',
				cite: 'getPlatformApiSyncReadiness + organizations.getPlatformApiState'
			}
		},
		{
			id: 'credential-probe',
			label: 'Credential probe',
			state: credentialProbeComplete ? 'partial' : credentialStored ? 'partial' : 'gated',
			href: `${base}/supporters/import/platform-api#platform-stored-state`,
			action: credentialProbeComplete
				? 'read credential proof'
				: credentialStored
					? 'verify stored credential'
					: 'read probe boundary',
			handoff: 'Org/profile envelope proof',
			effect: credentialProbeComplete
				? 'The stored credential envelope opened under this org/profile binding and then stopped before any vendor call.'
				: credentialStored
					? 'A stored credential can be opened as custody proof before direct sync execution exists.'
					: 'No stored platform credential can be opened or cited yet.',
			gate: credentialProbeComplete
				? 'Credential probe is custody evidence only; platform calls, pagination, import, and continuation remain unarmed.'
				: custodyGate,
			clusters: 'C-data-sovereignty / C-accountability',
			metric: {
				value: credentialProbeComplete ? 1 : credentialStored ? 0 : null,
				label: credentialProbeComplete ? 'probe complete' : 'probe held',
				cite: 'organizations.recordPlatformApiCredentialProbe'
			}
		},
		{
			id: 'adapter-execution',
			label: 'Adapter execution',
			state: proofExecutionState,
			href: `${base}/supporters/import/platform-api#platform-sync-boundary`,
			action: runtimeReady ? 'prove direct sync' : 'read sync boundary',
			handoff: 'Direct sync runner',
			effect: anyAdapterArmed
				? `The bounded sync runner executes vendor calls for ${armedAdapterCount} armed adapter ${armedAdapterCount === 1 ? 'source' : 'sources'}; every other adapter still needs resource and import-safety proof before live import claims.`
				: runnerImplemented
					? 'A direct sync runner is present, but each adapter still needs resource and import-safety proof before live import claims.'
					: 'No direct platform runner executes vendor calls or imports people.',
			gate: runnerGate,
			clusters: 'C-composability / C-data-sovereignty',
			metric: {
				value: runnerImplemented ? 1 : null,
				label: runnerImplemented ? 'runner present' : 'runner held',
				cite: 'getPlatformApiSyncReadiness.runnerImplemented'
			}
		},
		{
			id: 'import-safety',
			label: 'Import safety',
			state: proofExecutionState,
			href: `${base}/supporters/import/platform-api#platform-sync-proof-contract`,
			action: runtimeReady ? 'prove import safety' : 'read import-safety boundary',
			handoff: 'Pagination + idempotent upsert',
			effect:
				'Direct sync must prove resource pagination, consent/suppression mapping, idempotent source-key upsert, and rate-limit backoff before importing people.',
			gate: formatGateEvidence(platformApiGate, {
				prefix: `${runtimeMessage} Import safety remains held until resource pagination, consent/suppression mapping, idempotent source-key upsert, and rate-limit backoff are proven.`,
				complete:
					'Import safety still must be verified adapter-by-adapter before any live direct import claim.',
				density: 'operator'
			}),
			clusters: 'C-reach / C-coordination-integrity / C-data-sovereignty',
			metric: {
				value: runnerImplemented ? 4 : null,
				label: 'safety checks',
				cite: 'direct sync proof checklist'
			}
		},
		{
			id: 'continuation-checkpoint',
			label: 'Continuation checkpoint',
			state: proofExecutionState,
			href: `${base}/supporters/import/platform-api#platform-sync-proof-contract`,
			action: runtimeReady ? 'prove continuation' : 'read continuation boundary',
			handoff: 'Chunked continuation',
			effect:
				'Large platform sync must persist cursor/checkpoint progress before Commons can claim resumable direct import.',
			gate: formatGateEvidence(platformApiGate, {
				prefix: `${runtimeMessage} Chunked continuation checkpointing remains held.`,
				complete:
					'Continuation proof is present at the shared boundary; adapter-specific replay safety still applies.',
				density: 'operator'
			}),
			clusters: 'C-composability / C-accountability / C-data-sovereignty',
			metric: {
				value: runnerImplemented ? 1 : null,
				label: 'checkpoint proof',
				cite: 'direct sync proof checklist'
			}
		}
	];

	return {
		rows,
		stageRows,
		proofRows,
		state: profileCount > 0 ? 'partial' : 'gated',
		signal: `${profileCount} recognized CSV ${profileLabel}`,
		effect:
			profileCount > 0
				? runtimeReady
					? 'CSV export recognition and source custody are armed; direct platform sync is ready for adapter-specific proof.'
					: 'CSV export recognition and source custody are armed; direct platform sync remains dependency-first.'
				: 'No platform export profiles are registered; direct platform sync remains dependency-first.',
		detail:
			profileCount > 0
				? `${csvContractCount} CSV profile contracts preserve origin and header evidence across common organizing exports; ${apiBoundaryCount} direct ${apiLabel} stay behind the platform sync boundary. Credential custody ${credentialProbeComplete ? 'probed' : credentialStored ? 'stored' : custodyReady ? 'ready' : 'missing'}; direct sync ${runnerImplemented ? 'armed' : 'held'}; sync proof requires ${apiRunnerProofSummary}.`
				: 'Generic CSV intake can still run, but this build has no named profile registry to cite.',
		gate,
		boundary:
			'Vendor names are detection dialects only. The operator-facing capability is source-custody intake across export formats, not a one-platform migration.',
		futureLift: `Configure ${runtimeDependency}, then verify ${apiRunnerProofSummary} before direct sync is marked live.`,
		profileCount,
		csvContractCount,
		apiBoundaryCount
	};
}

export function buildPeopleSourceProvenanceReadiness(
	input: PeopleSourceProvenanceReadinessInputs
): PeopleSourceProvenanceReadinessSummary {
	const { base, sourceCounts, totalPeople, platformApiGate } = input;
	const loaded = sourceCounts !== null;
	const entries = Object.entries(sourceCounts ?? {}).filter(([, count]) => count > 0);
	const platformSourceIds = new Set<string>(
		PLATFORM_EXPORT_PROFILES.map((profile) => profile.source)
	);
	const sourceOriginCount = entries.length;
	const sourcedPeopleCount = entries.reduce((sum, [, count]) => sum + count, 0);
	const platformProfilePeopleCount = entries.reduce(
		(sum, [source, count]) => sum + (platformSourceIds.has(source) ? count : 0),
		0
	);
	const unknownPeopleCount = sourceCounts?.unknown ?? 0;
	const state: CapabilityState = !loaded ? 'gated' : sourceOriginCount > 0 ? 'live' : 'partial';
	const href =
		loaded && sourceOriginCount > 0
			? `${base}/supporters#people-source-provenance`
			: `${base}/supporters/import#csv-intake`;
	const action = loaded && sourceOriginCount > 0 ? 'read source basis' : 'import people';
	const gate = formatGateEvidence(platformApiGate, {
		prefix:
			'Source custody is aggregate People ground; direct platform sync remains dependency-first.',
		complete:
			'Source custody and credential custody are through the gate; route-local sync proof still bounds each adapter.',
		density: 'operator'
	});
	const peopleLabel = sourcedPeopleCount === 1 ? 'person' : 'people';
	const originLabel = sourceOriginCount === 1 ? 'origin' : 'origins';

	return {
		state,
		signal: !loaded
			? 'source origins unread'
			: sourceOriginCount > 0
				? `${sourceOriginCount} ${originLabel} · ${sourcedPeopleCount} ${peopleLabel}`
				: `${totalPeople ?? 0} people · no source origins`,
		effect: !loaded
			? unreadGroundBoundary('People source custody', 'source-origin custody claims')
			: sourceOriginCount > 0
				? `${sourcedPeopleCount} People rows preserve source custody across ${sourceOriginCount} ${originLabel}.`
				: 'No People source-origin evidence is loaded for this org yet.',
		detail: !loaded
			? 'Source custody stays uncounted until supporters.getSummaryStats provides aggregate sourceCounts.'
			: `${platformProfilePeopleCount} people came through recognized platform export profiles, ${unknownPeopleCount} people have unknown source metadata, and direct platform sync stays behind custody and execution proof.`,
		gate,
		boundary:
			'Source custody is aggregate metadata only: no plaintext identity, matched-person list, or vendor-owned sync state is loaded into the shell.',
		futureLift:
			'After the platform sync boundary clears, direct sync can add incremental source custody without changing the operator-facing source basis.',
		href,
		action,
		handoff: 'People source basis',
		metric: {
			value: loaded ? sourceOriginCount : null,
			label: 'source origins',
			cite: 'supporters.getSummaryStats.sourceCounts'
		},
		nextGate: platformApiGate,
		sourceOriginCount,
		sourcedPeopleCount,
		platformProfilePeopleCount,
		unknownPeopleCount
	};
}

export function buildPersonDetailRows(input: PersonDetailRowsInputs): PersonDetailRow[] {
	const { base, person } = input;
	const { verificationTrustGate, emailProxyGate, platformApiGate, customFieldsGate } = input.gates;
	const personHref = `${base}/supporters/${encodeURIComponent(person.id)}`;
	const hasPostalSignal = Boolean(person.postalCode);
	const isSubscribed = person.emailStatus === 'subscribed';
	const source = person.source ?? null;
	const hasKnownSource = Boolean(source && source !== 'unknown');
	const hasUnknownSource = source === 'unknown';
	const sourceLabel = formatPeopleSourceLabel(source ?? 'unknown', {
		style: 'record',
		fallback: 'Unknown source'
	});

	return [
		{
			id: 'verification-weight',
			label: 'Person verification weight',
			state: person.identityVerified ? 'live' : hasPostalSignal ? 'partial' : 'draft-only',
			phase: 'GROUND',
			clusters: 'C-verification / C-data-sovereignty',
			href: `${personHref}#person-verification`,
			action: person.identityVerified
				? 'read proof signal'
				: hasPostalSignal
					? 'read district signal'
					: 'read import state',
			handoff: 'Person verification',
			ground: person.identityVerified
				? 'Identity verification is present; protocol-private details remain outside org custody.'
				: hasPostalSignal
					? 'Postal evidence gives this person reach weight, but identity proof is not present.'
					: 'This person is imported, but no postal or identity signal is attached yet.',
			boundary: formatGateEvidence(verificationTrustGate, {
				prefix: 'Move person-level district and resolver trust beyond testnet/local assumptions.',
				complete: 'Person-level district and resolver trust are mainnet/attested.',
				density: 'operator'
			}),
			gate: verificationTrustGate,
			metric: {
				value: person.identityVerified ? 1 : null,
				label: 'identity proof',
				cite: 'supporters.get'
			}
		},
		{
			id: 'reach-authorization',
			label: 'Reach authorization',
			state: isSubscribed ? 'partial' : 'gated',
			phase: 'SEND',
			clusters: 'C-reach / C-reader-side',
			href: isSubscribed
				? `${base}/emails/compose#email-delivery`
				: `${personHref}#person-reach-boundary`,
			action: isSubscribed ? 'open email delivery' : 'read suppression',
			handoff: 'Person reach',
			ground: isSubscribed
				? 'This person can enter subscribed email cohorts; delivery still obeys send-mode and receipt gates.'
				: 'Suppressed email statuses stay out of delivery cohorts before any send side effect can run.',
			boundary: formatGateEvidence(emailProxyGate, {
				prefix:
					'Proxy-backed delivery and receipt attribution remain the stronger person-level reach claim.',
				complete: 'Proxy-backed delivery and receipt attribution are armed.',
				density: 'operator'
			}),
			gate: emailProxyGate,
			metric: {
				value: isSubscribed ? 1 : null,
				label: person.emailStatus,
				cite: 'supporters.get emailStatus'
			}
		},
		{
			id: 'source-custody',
			label: 'Source custody',
			state: hasKnownSource ? 'live' : 'partial',
			phase: 'GROUND',
			clusters: 'C-data-sovereignty / C-reach',
			href: `${base}/supporters/import#csv-intake`,
			action: 'read source custody',
			handoff: 'Person source basis',
			ground: hasKnownSource
				? `${sourceLabel} is preserved as source custody on this person record.`
				: hasUnknownSource
					? 'Unknown source metadata is preserved as a boundary, not a platform-origin claim.'
					: 'No import source is preserved on this person record; direct platform API state is not inferred.',
			boundary: formatGateEvidence(platformApiGate, {
				prefix:
					'Direct platform API sync waits on encrypted custody and paginated runners; this record only claims preserved source.',
				complete:
					'Direct platform API sync custody is armed; route-local adapter proof still bounds each source.',
				density: 'operator'
			}),
			gate: platformApiGate,
			metric: {
				value: hasKnownSource ? 1 : null,
				label: hasKnownSource
					? 'source record'
					: hasUnknownSource
						? 'unknown source'
						: 'source absent',
				cite: 'supporters.get source'
			}
		},
		{
			id: 'custom-field-custody',
			label: 'Custom field custody',
			state: person.hasEncryptedCustomFields ? 'live' : 'partial',
			phase: 'GROUND',
			clusters: 'C-data-sovereignty / C-composability',
			href: `${base}/supporters/import#csv-intake`,
			action: person.hasEncryptedCustomFields ? 'read encrypted fields' : 'import custom fields',
			handoff: 'Person custom fields',
			ground: person.hasEncryptedCustomFields
				? 'Imported custom columns are preserved as an encrypted, opaque JSON blob on this person record.'
				: 'No imported custom-field blob is attached to this person yet.',
			boundary: formatGateEvidence(customFieldsGate, {
				prefix:
					'Custom-field custody is encrypted blob evidence; typed fields and segmentation remain dependency-first.',
				complete:
					'Custom-field definitions and validation are armed; segment behavior still needs field-specific proof.',
				density: 'operator'
			}),
			gate: customFieldsGate,
			metric: {
				value: person.hasEncryptedCustomFields ? 1 : null,
				label: 'encrypted blob',
				cite: 'supporters.get encryptedCustomFields'
			}
		}
	];
}

export function buildPeopleSegmentationReadiness(
	input: PeopleSegmentationReadinessInputs
): PeopleSegmentationReadinessSummary {
	const { base, segmentation } = input;
	const { civicGeographyLabelsGate, platformApiGate } = input.gates;
	const segmentCount = segmentation.segmentCount ?? 0;
	const conditionCount = segmentation.conditionCount ?? 0;
	const proofReachFilterCount =
		(segmentation.tagConditionCount ?? 0) +
		(segmentation.verificationConditionCount ?? 0) +
		(segmentation.emailStatusConditionCount ?? 0) +
		(segmentation.dateConditionCount ?? 0) +
		(segmentation.postalCountryConditionCount ?? 0) +
		(segmentation.stateCodeConditionCount ?? 0) +
		(segmentation.congressionalDistrictConditionCount ?? 0);
	const sourceFilterCount = segmentation.sourceConditionCount ?? 0;
	const stateCodeFilterCount = segmentation.stateCodeConditionCount ?? 0;
	const congressionalDistrictFilterCount = segmentation.congressionalDistrictConditionCount ?? 0;
	const actionDistrictLabelFilterCount = segmentation.actionDistrictLabelConditionCount ?? 0;
	const actionContextFilterCount =
		(segmentation.campaignParticipationConditionCount ?? 0) +
		(segmentation.actionDistrictHashConditionCount ?? 0) +
		actionDistrictLabelFilterCount +
		(segmentation.engagementTierConditionCount ?? 0);
	const readableGeographyFilterCount = segmentation.humanReadableGeographyConditionCount ?? 0;
	const importedReadableGeographyFilterCount =
		stateCodeFilterCount + congressionalDistrictFilterCount;
	const actionReadableGeographyFilterCount = actionDistrictLabelFilterCount;
	const materializedReadableGeographyFilterCount = Math.max(
		readableGeographyFilterCount -
			importedReadableGeographyFilterCount -
			actionReadableGeographyFilterCount,
		0
	);
	const savedSegmentState: CapabilityState = !segmentation.loaded
		? 'gated'
		: segmentCount > 0
			? 'partial'
			: 'draft-only';
	const proofReachState: CapabilityState = !segmentation.loaded
		? 'gated'
		: proofReachFilterCount > 0
			? 'partial'
			: 'draft-only';
	const sourceState: CapabilityState = !segmentation.loaded
		? 'gated'
		: sourceFilterCount > 0
			? 'partial'
			: 'draft-only';
	const actionContextState: CapabilityState = !segmentation.loaded
		? 'gated'
		: actionContextFilterCount > 0
			? 'partial'
			: 'draft-only';
	const civicGeographyState: CapabilityState = !segmentation.loaded
		? 'gated'
		: importedReadableGeographyFilterCount > 0 || actionReadableGeographyFilterCount > 0
			? 'partial'
			: civicGeographyLabelsGate.state !== 'live'
				? 'gated'
				: readableGeographyFilterCount > 0
					? 'partial'
					: 'draft-only';
	const href = `${base}/supporters#people-segments`;

	const rows: PeopleSegmentationReadinessRow[] = [
		{
			id: 'saved-segments',
			label: 'Saved cohort definitions',
			state: savedSegmentState,
			phase: 'AUTHOR',
			clusters: 'C-reach / C-data-sovereignty',
			href,
			action: segmentCount > 0 ? 'read segmentation posture' : 'shape segment',
			handoff: 'People segments',
			ground: segmentation.loaded
				? `${segmentCount} saved segment definitions carry ${conditionCount} filter conditions without storing matched people.`
				: unreadGroundBoundary('People segmentation', 'saved cohort-definition claims'),
			boundary:
				'Segments are filter definitions, not data containers. They do not imply matched-person counts, exports, or delivery side effects by themselves.',
			gate: platformApiGate,
			metric: {
				value: segmentation.loaded ? segmentCount : null,
				label: 'saved segments',
				cite: 'segments.list aggregate'
			}
		},
		{
			id: 'proof-reach-filters',
			label: 'Proof and reach filters',
			state: proofReachState,
			phase: 'GROUND',
			clusters: 'C-verification / C-reach',
			href,
			action: proofReachFilterCount > 0 ? 'read proof filters' : 'shape proof filters',
			handoff: 'People filters',
			ground: segmentation.loaded
				? `${proofReachFilterCount} tag, verification, email-status, date, postal, country, imported state-code, or imported congressional-district conditions are saved.`
				: unreadGroundBoundary('People segmentation', 'proof/reach filter claims'),
			boundary:
				'Tags, verification, email status, dates, postal code, imported state/province code, imported congressional district, and country can shape cohorts; route-local matching must still produce any member count.',
			gate: civicGeographyLabelsGate,
			metric: {
				value: segmentation.loaded ? proofReachFilterCount : null,
				label: 'proof/reach conditions',
				cite: 'segments.list filters.conditions'
			}
		},
		{
			id: 'source-provenance-filters',
			label: 'Source custody filters',
			state: sourceState,
			phase: 'GROUND',
			clusters: 'C-data-sovereignty / C-reach',
			href,
			action: sourceFilterCount > 0 ? 'read source cohorts' : 'shape source cohort',
			handoff: 'People source custody',
			ground: segmentation.loaded
				? `${sourceFilterCount} saved conditions use import/source custody.`
				: unreadGroundBoundary('People segmentation', 'source-custody filter claims'),
			boundary: formatGateEvidence(platformApiGate, {
				prefix:
					'Source filters preserve origin across CSV and organizing-platform exports; direct platform sync remains separate.',
				complete:
					'Source filters preserve origin across export formats; direct platform sync still needs adapter-specific proof.',
				density: 'operator'
			}),
			gate: platformApiGate,
			metric: {
				value: segmentation.loaded ? sourceFilterCount : null,
				label: 'source conditions',
				cite: 'segments.list filters.conditions'
			}
		},
		{
			id: 'action-context-filters',
			label: 'Action-context filters',
			state: actionContextState,
			phase: 'SEND',
			clusters: 'C-reach / C-coordination-integrity',
			href,
			action: actionContextFilterCount > 0 ? 'read action cohorts' : 'shape action cohort',
			handoff: 'Campaign context',
			ground: segmentation.loaded
				? `${actionContextFilterCount} saved conditions use campaign participation, engagement tier, action-district hashes, or action-time district labels.`
				: unreadGroundBoundary('People segmentation', 'action-context filter claims'),
			boundary:
				'Campaign participation, engagement tier, action-district hashes, and action-time district labels require action context. A district hash is not a readable state, congressional, local, or special-district label; action-time district labels are not materialized local or special-district membership.',
			gate: civicGeographyLabelsGate,
			metric: {
				value: segmentation.loaded ? actionContextFilterCount : null,
				label: 'action-context conditions',
				cite: 'segments.list filters.conditions'
			}
		},
		{
			id: 'civic-geography-labels',
			label: 'Readable state and district labels',
			state: civicGeographyState,
			phase: 'GROUND',
			clusters: 'C-verification / C-reach',
			href,
			action: civicGeographyState === 'gated' ? 'read geography boundary' : 'read civic cohorts',
			handoff: 'Civic geography labels',
			ground: segmentation.loaded
				? `${stateCodeFilterCount} saved conditions use imported state/province codes, ${congressionalDistrictFilterCount} use imported congressional district labels, ${actionDistrictLabelFilterCount} use action-time congressional district labels, and ${materializedReadableGeographyFilterCount} use materialized local, special, or civic-geography labels.`
				: unreadGroundBoundary('People segmentation', 'readable civic-geography label claims'),
			boundary: formatGateEvidence(civicGeographyLabelsGate, {
				prefix:
					'Imported state/province, imported congressional district, and action-time congressional district labels can shape cohorts; verified/materialized local and special-district labels remain bounded.',
				complete:
					'Human-readable civic geography labels are materialized; imported labels and action-time filters still need proof before broad cohort claims.',
				density: 'operator'
			}),
			gate: civicGeographyLabelsGate,
			metric: {
				value: segmentation.loaded ? readableGeographyFilterCount : null,
				label: 'readable geography filters',
				cite: 'segments.list filters.conditions'
			}
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const armedCount = rows.filter((row) => row.state === 'live' || row.state === 'partial').length;
	const boundaryCount = rows.length - liveCount;
	const nextGate =
		civicGeographyState === 'gated' || civicGeographyState === 'draft-only'
			? civicGeographyLabelsGate
			: platformApiGate.state !== 'live'
				? platformApiGate
				: civicGeographyLabelsGate;
	const metric = {
		value: segmentation.loaded ? segmentCount : null,
		label: 'saved segments',
		cite: 'segments.list aggregate'
	};

	return {
		rows,
		state: !segmentation.loaded
			? 'gated'
			: armedCount > 0 || segmentCount > 0 || conditionCount > 0
				? 'partial'
				: 'draft-only',
		signal: !segmentation.loaded
			? 'unread segments'
			: `${segmentCount} segments · ${conditionCount} conditions · ${actionContextFilterCount} action-context`,
		effect: !segmentation.loaded
			? unreadGroundBoundary('People segmentation', 'saved cohort posture claims')
			: segmentCount > 0
				? 'Saved segments can shape proof-weighted reach from current filters while source custody, action context, and civic geography label limits stay explicit.'
				: 'Segment grammar is available, but no saved cohort definitions are loaded; civic geography label work remains an explicit gate.',
		detail: !segmentation.loaded
			? 'Load the People segmentation slice before showing segment counts.'
			: `${segmentCount} saved segments, ${conditionCount} conditions, ${proofReachFilterCount} proof/reach filters, ${sourceFilterCount} source filters, ${actionContextFilterCount} action-context filters, ${stateCodeFilterCount} imported state-code filters, ${congressionalDistrictFilterCount} imported congressional-district filters, ${actionDistrictLabelFilterCount} action-time district-label filters, and ${readableGeographyFilterCount} readable civic-geography filters are loaded as aggregate-only posture.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate,
		href,
		action: segmentCount > 0 ? 'read segmentation posture' : 'shape segment',
		handoff: 'People segments',
		metric,
		liveCount,
		boundaryCount,
		rowCount: rows.length
	};
}

export function buildEmailListHealthReadiness(
	input: EmailListHealthReadinessInputs
): EmailListHealthReadinessSummary {
	const { base, emailHealth } = input;
	const {
		emailProxyGate,
		listUnsubscribeGate,
		listUnsubscribeProviderGate,
		softBounceGate,
		customDomainGate
	} = input.gates;
	const subscribed = emailHealth.subscribed ?? 0;
	const unsubscribed = emailHealth.unsubscribed ?? 0;
	const bounced = emailHealth.bounced ?? 0;
	const complained = emailHealth.complained ?? 0;
	const emailConsentEvidence = emailHealth.consentEvidenceCount ?? 0;
	const subscribedConsentEvidence = emailHealth.subscribedConsentEvidenceCount ?? 0;
	const suppressed = unsubscribed + bounced + complained;
	const statusTotal = subscribed + suppressed;
	const href = `${base}/supporters#email-health`;
	const importHref = `${base}/supporters/import#csv-intake`;
	const deliveryHref = `${base}/emails/compose#email-delivery`;
	const loaded = emailHealth.loaded;
	const hasReach = loaded && subscribed > 0;
	const hasStatuses = loaded && statusTotal > 0;
	const hasConsentEvidence = loaded && emailConsentEvidence > 0;
	const bounceAudit = input.honesty?.softBounceThreshold;

	const rows: EmailListHealthReadinessRow[] = [
		{
			id: 'reachable-cohort',
			label: 'Reachable subscribed cohort',
			state: !loaded ? 'gated' : subscribed > 0 ? 'partial' : 'draft-only',
			phase: 'GROUND',
			clusters: 'C-reach / C-data-sovereignty',
			href,
			action: subscribed > 0 ? 'read list health posture' : 'import people',
			handoff: 'People email health',
			ground: loaded
				? `${subscribed} subscribed people are currently reachable; ${suppressed} are opted out, bounced, or complained.`
				: unreadGroundBoundary('People list health', 'reachable-list posture claims'),
			boundary:
				'Subscribed means reachable in People. It is not an inbox-placement score, engagement estimate, or provider reputation claim.',
			gate: emailProxyGate,
			metric: {
				value: loaded ? subscribed : null,
				label: 'reachable subscribed',
				cite: 'supporters.getSummaryStats emailHealth'
			}
		},
		{
			id: 'suppression-statuses',
			label: 'Suppression status ledger',
			state: !loaded ? 'gated' : hasStatuses ? 'partial' : 'draft-only',
			phase: 'GROUND',
			clusters: 'C-reach / C-verification',
			href,
			action: hasStatuses ? 'read suppression posture' : 'import people',
			handoff: 'People suppression',
			ground: loaded
				? `${unsubscribed} unsubscribed, ${bounced} bounced, and ${complained} complained statuses are loaded from supporter rows.`
				: unreadGroundBoundary('People list health', 'suppression-status claims'),
			boundary:
				'Suppression is status ground for recipient selection; it does not imply inbox placement, statutory consent sufficiency, or cross-provider deliverability analytics.',
			gate: softBounceGate,
			metric: {
				value: loaded ? suppressed : null,
				label: 'suppressed statuses',
				cite: 'supporters.emailStatus aggregate'
			}
		},
		{
			id: 'consent-evidence-custody',
			label: 'Consent evidence custody',
			state: !loaded ? 'gated' : hasConsentEvidence ? 'partial' : 'draft-only',
			phase: 'GROUND',
			clusters: 'C-reach / C-data-sovereignty',
			href: importHref,
			action: hasConsentEvidence ? 'read consent evidence' : 'map consent evidence',
			handoff: 'People import',
			ground: loaded
				? `${emailConsentEvidence} people have imported email consent source/date/text evidence; ${subscribedConsentEvidence} are currently subscribed.`
				: unreadGroundBoundary('People list health', 'email consent-evidence claims'),
			boundary:
				'Imported consent evidence is aggregate custody ground. It is not double opt-in, legal advice, sender-domain authentication, inbox placement, or proof that every provider-specific permission model has been normalized.',
			gate: emailProxyGate,
			metric: {
				value: loaded ? emailConsentEvidence : null,
				label: 'email consent evidence',
				cite: 'supporters.getSummaryStats consentEvidence.email'
			}
		},
		{
			id: 'unsubscribe-consent',
			label: 'Unsubscribe consent path',
			state: !loaded ? 'gated' : hasStatuses ? 'partial' : 'draft-only',
			phase: 'SEND',
			clusters: 'C-data-sovereignty / C-reader-side',
			href,
			action: unsubscribed > 0 ? 'read opt-out posture' : 'read consent boundary',
			handoff: 'One-click unsubscribe',
			ground: loaded
				? `${unsubscribed} people are marked unsubscribed and excluded from subscribed reach.`
				: unreadGroundBoundary('People list health', 'unsubscribe-status claims'),
			boundary:
				'The unsubscribe mutation updates supporter emailStatus. Imported consent evidence can now be counted, but double opt-in, legal policy workflows, and provider-specific permission normalization remain separate product work.',
			gate: listUnsubscribeGate,
			metric: {
				value: loaded ? unsubscribed : null,
				label: 'unsubscribed',
				cite: 'supporters.unsubscribeFromBlast'
			}
		},
		{
			id: 'bounce-complaint-attribution',
			label: 'Bounce and complaint attribution',
			state: !loaded ? 'gated' : softBounceGate.state === 'live' ? 'partial' : softBounceGate.state,
			phase: 'AGGREGATE',
			clusters: 'C-verification / C-accountability',
			href,
			action: softBounceGate.state === 'live' ? 'read suppression signal' : 'read attribution gate',
			handoff: 'SES feedback',
			ground: loaded
				? `${bounced + complained} bounced or complained statuses are present. ${bounceAudit?.evidence ?? 'Soft-bounce threshold evidence is read from the task hypergraph.'}`
				: unreadGroundBoundary('People list health', 'bounce and complaint attribution claims'),
			boundary: formatGateEvidence(softBounceGate, {
				prefix:
					'Bounce and complaint suppression remains bounded until soft-bounce handling is verified.',
				complete:
					'Permanent bounces, complaints, and 3-strike soft-bounce suppression update People status; campaign analytics still need event correlation before stronger claims.',
				density: 'operator'
			}),
			gate: softBounceGate,
			metric: {
				value: loaded ? bounced + complained : null,
				label: 'bounce/complaint statuses',
				cite: bounceAudit?.mark ?? 'convex.webhooks processSesWebhook'
			}
		},
		{
			id: 'manual-report-consensus',
			label: 'Verified report consensus',
			state: !loaded ? 'gated' : 'partial',
			phase: 'AGGREGATE',
			clusters: 'C-verification / C-reach / C-accountability',
			href,
			action: 'read report consensus boundary',
			handoff: 'People suppression',
			ground: loaded
				? 'Two independent verified bounce reports can suppress a canonical global email hash, patch matching People rows, and resolve the contributing report records.'
				: unreadGroundBoundary('People list health', 'manual report consensus claims'),
			boundary:
				'Verified report consensus is bounded suppression evidence, not Reacher SMTP probing, mailbox placement scoring, or campaign-level complaint attribution. This surface does not load pending report counts.',
			gate: softBounceGate,
			metric: {
				value: null,
				label: '2-report threshold',
				cite: 'convex.email processBounceReports consensus path'
			}
		},
		{
			id: 'list-unsubscribe-headers',
			label: 'List-Unsubscribe headers',
			state: listUnsubscribeGate.state === 'live' ? 'partial' : 'gated',
			phase: 'SEND',
			clusters: 'C-reader-side / C-reach',
			href: deliveryHref,
			action: listUnsubscribeGate.state === 'live' ? 'read header support' : 'read header gate',
			handoff: 'Email delivery',
			ground:
				'Browser/Lambda and Convex server-side senders both have code paths for per-recipient one-click headers; production use still depends on dispatch arming, UNSUBSCRIBE_SECRET, SES credentials, and mailbox rendering.',
			boundary: formatGateEvidence(listUnsubscribeGate, {
				prefix:
					'Visible unsubscribe status exists and the Convex header substrate is wired, but production send/provider confirmation stays gated.',
				complete:
					'Convex server-side delivery can include List-Unsubscribe headers; provider rendering still depends on mailbox policy.',
				density: 'operator'
			}),
			gate: listUnsubscribeGate,
			metric: {
				value: null,
				label: 'uniform header support',
				cite: 'T2-4 list-unsubscribe-convex-path'
			}
		},
		{
			id: 'mailbox-unsubscribe-rendering',
			label: 'Mailbox unsubscribe rendering',
			state: listUnsubscribeProviderGate.state === 'live' ? 'partial' : 'gated',
			phase: 'SEND',
			clusters: 'C-reader-side / C-reach',
			href: deliveryHref,
			action:
				listUnsubscribeProviderGate.state === 'live'
					? 'read mailbox evidence'
					: 'read provider verification gate',
			handoff: 'Email delivery',
			ground:
				'Convex can emit one-click unsubscribe headers, but Gmail/Yahoo-visible mailbox affordance evidence requires production seed sends and provider confirmation.',
			boundary: formatGateEvidence(listUnsubscribeProviderGate, {
				prefix: 'Header bytes are wired; mailbox rendering stays a production verification gate.',
				complete:
					'Production seed sends confirm the mailbox-visible one-click unsubscribe affordance.',
				density: 'operator'
			}),
			gate: listUnsubscribeProviderGate,
			metric: {
				value: null,
				label: 'mailbox evidence',
				cite: 'T2-4b list-unsubscribe-provider-verification'
			}
		},
		{
			id: 'sender-domain-auth',
			label: 'Sender domain authentication',
			state: customDomainGate.state === 'live' ? 'partial' : 'gated',
			phase: 'SEND',
			clusters: 'C-data-sovereignty / C-reach',
			href: deliveryHref,
			action:
				customDomainGate.state === 'live'
					? 'read sender-domain evidence'
					: 'read sender-domain boundary',
			handoff: 'Sender domain',
			ground:
				'Current blast paths send from the Commons platform domain; per-org From domains, DKIM, and DMARC verification remain not armed.',
			boundary: formatGateEvidence(customDomainGate, {
				prefix:
					'Commons can show list posture without claiming per-org sender-domain authentication.',
				complete:
					'Per-org sender domain verification is live; deliverability still depends on DNS, provider feedback, and operator configuration.',
				density: 'operator'
			}),
			gate: customDomainGate,
			metric: {
				value: null,
				label: 'custom sender domain',
				cite: 'T2-6 custom-domain-dkim'
			}
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const armedCount = rows.filter((row) => row.state === 'live' || row.state === 'partial').length;
	const boundaryCount = rows.length - liveCount;
	const nextGate = highestDownstreamGate([
		listUnsubscribeGate,
		customDomainGate,
		emailProxyGate,
		softBounceGate
	]);
	const metric = {
		value: loaded ? subscribed : null,
		label: 'reachable subscribed',
		cite: 'supporters.getSummaryStats emailHealth'
	};

	return {
		rows,
		state: !loaded ? 'gated' : armedCount > 0 || statusTotal > 0 ? 'partial' : 'draft-only',
		signal: !loaded
			? 'unread list health'
			: `${subscribed} reachable · ${emailConsentEvidence} consent evidence · ${suppressed} suppressed`,
		effect: !loaded
			? unreadGroundBoundary('People list health', 'consent-bound reach claims')
			: 'Reach separates subscribed people, consent evidence custody, opted-out and suppressed statuses, SES/manual feedback attribution, one-click header support, and sender-domain authentication without inventing an inbox-placement score.',
		detail: !loaded
			? 'Load the People email-health slice before showing reachability or suppression counts.'
			: `${subscribed} subscribed, ${emailConsentEvidence} email consent evidence records, ${unsubscribed} unsubscribed, ${bounced} bounced, and ${complained} complained statuses are loaded from the People ledger; verified manual bounce reports suppress only after two independent reporters.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate,
		href,
		action: hasReach ? 'read list health posture' : 'import people',
		handoff: 'People email health',
		metric,
		liveCount,
		boundaryCount,
		rowCount: rows.length,
		reachableCount: loaded ? subscribed : null,
		suppressedCount: loaded ? suppressed : null
	};
}

export function buildTextDeliveryReadiness(
	input: TextDeliveryReadinessInputs
): TextDeliveryReadinessSummary {
	const { base, text } = input;
	const { smsDispatchGate, smsReceiptAnchoringGate } = input.gates;
	const textReplyRegisterGate = input.gates.textReplyRegisterGate ?? smsReceiptAnchoringGate;
	const loaded = text.loaded;
	const enabledAndLoaded = text.enabled && loaded;
	const draftCount = text.draftCount ?? 0;
	const plannedRecipientCount = text.plannedRecipientCount ?? 0;
	const sentCount = text.sentCount ?? 0;
	const deliveredCount = text.deliveredCount ?? 0;
	const failedCount = text.failedCount ?? 0;
	const messageCount = text.messageCount ?? 0;
	const replyCount = text.replyCount ?? 0;
	const receiptCounterCount = sentCount + deliveredCount + failedCount;
	const subscribedPhoneCount = text.subscribedPhoneCount ?? 0;
	const unsubscribedPhoneCount = text.unsubscribedPhoneCount ?? 0;
	const stoppedPhoneCount = text.stoppedPhoneCount ?? 0;
	const noSmsStatusCount = text.noSmsStatusCount ?? 0;
	const phonePresentCount = text.phonePresentCount ?? 0;
	const smsConsentEvidence = text.smsConsentEvidenceCount ?? 0;
	const subscribedSmsConsentEvidence = text.subscribedSmsConsentEvidenceCount ?? 0;
	const dispatchRuntimeReady = text.dispatchRuntimeReady === true;
	const dispatchRuntimeMissing = text.dispatchRuntimeMissing ?? [];
	const dispatchClientBatchRouteMounted = text.dispatchClientBatchRouteMounted === true;
	const routeResolvedDispatchMissing = dispatchClientBatchRouteMounted
		? dispatchRuntimeMissing.filter((item) => item !== 'browser phone custody')
		: dispatchRuntimeMissing;
	const routeBatchRuntimeReady =
		dispatchClientBatchRouteMounted && routeResolvedDispatchMissing.length === 0;
	const routeDispatchMissingText = formatRuntimeMissing(routeResolvedDispatchMissing);
	const dispatchRuntimeDependency =
		text.dispatchRuntimeDependency ??
		'text dispatch gate, browser phone custody, Twilio dispatch runner, and transport credentials';
	const consentStatusCount =
		subscribedPhoneCount + unsubscribedPhoneCount + stoppedPhoneCount + noSmsStatusCount;
	const href = `${base}/sms`;
	const consentHref = `${base}/supporters/import#csv-intake`;
	const dispatchHref = `${base}/sms#sms-dispatch-boundary`;
	const receiptHref = `${base}/sms#text-receipts`;
	const draftPacketState: CapabilityState = !text.enabled
		? 'gated'
		: loaded
			? 'draft-only'
			: 'gated';
	const audienceState: CapabilityState = !enabledAndLoaded
		? 'gated'
		: plannedRecipientCount > 0
			? 'partial'
			: 'draft-only';
	const receiptState: CapabilityState = !enabledAndLoaded
		? 'gated'
		: receiptCounterCount > 0 || messageCount > 0
			? 'partial'
			: 'gated';
	const replyState: CapabilityState = !enabledAndLoaded
		? 'gated'
		: replyCount > 0
			? 'partial'
			: 'draft-only';
	const dispatchState: CapabilityState =
		enabledAndLoaded && dispatchRuntimeReady && smsDispatchGate.state === 'live'
			? 'live'
			: enabledAndLoaded && routeBatchRuntimeReady
				? 'partial'
				: 'gated';
	const anchoringState: CapabilityState =
		receiptState === 'partial' && smsReceiptAnchoringGate.state === 'live' ? 'partial' : 'gated';

	const rows: TextDeliveryReadinessRow[] = [
		{
			id: 'phone-consent-ledger',
			label: 'Phone consent ledger',
			state: !text.enabled
				? 'gated'
				: !loaded
					? 'gated'
					: subscribedPhoneCount > 0
						? 'partial'
						: 'draft-only',
			phase: 'GROUND',
			clusters: 'C-reach / C-data-sovereignty',
			href: consentHref,
			action: subscribedPhoneCount > 0 ? 'read phone reach' : 'import phone consent',
			handoff: 'People phone status',
			ground: loaded
				? `${subscribedPhoneCount} people are text-subscribed; ${smsConsentEvidence} have imported SMS consent evidence; ${stoppedPhoneCount} are stopped and ${unsubscribedPhoneCount} are unsubscribed. ${phonePresentCount} people have encrypted phone ground.`
				: 'Phone and SMS consent status counts are unread.',
			boundary:
				'Phone status and imported consent evidence are reach ground, not legal clearance, carrier dispatch proof, or an operator inbox. STOP/START changes status; free-text replies are separate response evidence.',
			gate: smsDispatchGate,
			metric: {
				value: loaded ? subscribedPhoneCount : null,
				label: 'text subscribed',
				cite: 'supporters.getSummaryStats smsHealth'
			}
		},
		{
			id: 'sms-consent-evidence',
			label: 'Consent evidence custody',
			state: !text.enabled
				? 'gated'
				: !loaded
					? 'gated'
					: smsConsentEvidence > 0
						? 'partial'
						: 'draft-only',
			phase: 'GROUND',
			clusters: 'C-data-sovereignty / C-reach',
			href: consentHref,
			action: smsConsentEvidence > 0 ? 'read consent evidence' : 'map consent evidence',
			handoff: 'People import',
			ground: loaded
				? `${smsConsentEvidence} people have imported SMS consent source/date/text evidence; ${subscribedSmsConsentEvidence} are currently text-subscribed.`
				: 'SMS consent evidence counts are unread.',
			boundary:
				'Imported SMS consent evidence is aggregate custody ground. It is not TCPA legal advice, 10DLC registration, reply workflow handling, phone decrypt proof, or carrier delivery permission.',
			gate: smsDispatchGate,
			metric: {
				value: loaded ? smsConsentEvidence : null,
				label: 'SMS consent evidence',
				cite: 'supporters.getSummaryStats consentEvidence.sms'
			}
		},
		{
			id: 'text-draft-packets',
			label: 'Text draft packets',
			state: draftPacketState,
			phase: 'AUTHOR',
			clusters: 'C-accountability / C-reach',
			href: `${base}/sms/new#text-message`,
			action: draftCount > 0 ? 'open text drafts' : 'compose text draft',
			handoff: 'Text delivery drafts',
			ground: enabledAndLoaded
				? `${draftCount} saved text drafts are loaded without claiming carrier side effects.`
				: text.enabled
					? unreadGroundBoundary('Text delivery records', 'saved SMS draft-packet counts')
					: featureNotArmedBoundary(
							'Text delivery',
							'SMS authoring, carrier dispatch, and receipt-evidence claims'
						),
			boundary: formatGateEvidence(smsDispatchGate, {
				prefix: 'Saved SMS packets stay draft ground until carrier dispatch is armed.',
				complete: 'Saved SMS packets can hand off to the armed dispatch path.',
				density: 'operator'
			}),
			gate: smsDispatchGate,
			metric: {
				value: enabledAndLoaded ? draftCount : null,
				label: 'draft packets',
				cite: 'sms.listBlasts'
			}
		},
		{
			id: 'text-audience-snapshots',
			label: 'Audience snapshots',
			state: audienceState,
			phase: 'RESOLVE',
			clusters: 'C-reach / C-verification',
			href:
				plannedRecipientCount > 0
					? `${base}/sms#text-audience-snapshot`
					: `${base}/sms/new#text-audience-snapshot`,
			action: plannedRecipientCount > 0 ? 'read audience snapshots' : 'shape text audience',
			handoff: 'Text audience',
			ground: enabledAndLoaded
				? `${plannedRecipientCount} planned recipients are stored across loaded text records; new drafts can save filtered eligible-phone snapshots.`
				: unreadGroundBoundary('Text delivery', 'text audience snapshot claims'),
			boundary:
				'Audience counts are filter-aware scope evidence. They are not phone decrypt, TCPA proof, broad carrier delivery, or anchored receipt proof.',
			gate: smsDispatchGate,
			metric: {
				value: enabledAndLoaded ? plannedRecipientCount : null,
				label: 'planned recipients',
				cite: 'smsBlasts.totalRecipients + sms.countEligibleRecipientsForFilter'
			}
		},
		{
			id: 'carrier-receipt-evidence',
			label: 'Carrier receipt evidence',
			state: receiptState,
			phase: 'AGGREGATE',
			clusters: 'C-reader-side / C-accountability',
			href: receiptHref,
			action:
				receiptCounterCount > 0 || messageCount > 0
					? 'read receipt counters'
					: 'read receipt boundary',
			handoff: 'Carrier receipts',
			ground: enabledAndLoaded
				? `${receiptCounterCount} sent/delivered/failed counters and ${messageCount} message rows are loaded from text records.`
				: 'Carrier receipt evidence is unread.',
			boundary:
				'Carrier counters are operational evidence only. They do not become accountability receipts or anchored proof without the receipt writer and mainnet path; reader replies land in a separate register.',
			gate: smsReceiptAnchoringGate,
			metric: {
				value: enabledAndLoaded ? receiptCounterCount : null,
				label: 'receipt counters',
				cite: 'smsBlasts sent/delivered/failed counts'
			}
		},
		{
			id: 'reader-reply-register',
			label: 'Reader reply register',
			state: replyState,
			phase: 'AGGREGATE',
			clusters: 'C-reader-side / C-accountability',
			href: `${base}/sms#text-replies`,
			action: replyCount > 0 ? 'read text replies' : 'read reply boundary',
			handoff: 'Text replies',
			ground: enabledAndLoaded
				? `${replyCount} inbound free-text SMS replies are recorded as reader response evidence.`
				: unreadGroundBoundary('Text delivery', 'reader SMS reply claims'),
			boundary: formatGateEvidence(textReplyRegisterGate, {
				prefix:
					'Text replies are a bounded response register, not an admin inbox, autoresponder, legal-policy workflow, assignment queue, or reader-office notification loop.',
				complete:
					'Reader-office response loops can add staffer surfaces, notification workflows, and routed follow-up on top of the reply register.',
				density: 'operator'
			}),
			gate: textReplyRegisterGate,
			metric: {
				value: enabledAndLoaded ? replyCount : null,
				label: 'text replies',
				cite: 'sms.listReplies'
			}
		},
		{
			id: 'bulk-dispatch-runner',
			label: 'Bulk dispatch runner',
			state: dispatchState,
			phase: 'SEND',
			clusters: 'C-reach / C-data-sovereignty',
			href: dispatchHref,
			action: dispatchState === 'live' ? 'open dispatch runner' : 'read dispatch boundary',
			handoff: 'Carrier dispatch',
			ground:
				dispatchState === 'live'
					? 'The SMS dispatch runtime gate is open; route-local phone decrypt and quota checks still bound execution.'
					: routeBatchRuntimeReady
						? 'The composer can save a counted audience filter, and the draft detail route can prepare 100-recipient browser-decrypted carrier batches until the saved eligible cohort is recorded; broader carrier claims still wait on the SMS dispatch gate, carrier evidence, and route-local dispatch checks.'
						: enabledAndLoaded
							? `Text records and drafts exist, but the carrier side-effect runner is not armed; missing ${routeDispatchMissingText}.`
							: unreadGroundBoundary('Text delivery', 'carrier side-effect posture claims'),
			boundary: formatGateEvidence(smsDispatchGate, {
				prefix:
					text.dispatchRuntimeMessage ??
					`Bulk SMS dispatch stays dependency-first until ${dispatchRuntimeDependency} pass.`,
				complete:
					'Bulk SMS dispatch is armed, with STOP filtering, quota, org-key, and carrier outcomes still enforced route-locally.',
				density: 'operator'
			}),
			gate: smsDispatchGate,
			metric: {
				value: enabledAndLoaded ? (dispatchRuntimeReady || routeBatchRuntimeReady ? 1 : 0) : null,
				label:
					routeBatchRuntimeReady && !dispatchRuntimeReady ? 'bounded route' : 'dispatch runtime',
				cite:
					routeBatchRuntimeReady && !dispatchRuntimeReady
						? 'getTextDispatchReadiness + SMS detail route'
						: 'getTextDispatchReadiness'
			}
		},
		{
			id: 'text-receipt-anchoring',
			label: 'Anchored text receipts',
			state: anchoringState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-data-sovereignty',
			href: dispatchHref,
			action: anchoringState === 'partial' ? 'read anchoring posture' : 'read anchoring gate',
			handoff: 'Receipt anchoring',
			ground:
				receiptCounterCount > 0
					? 'Carrier evidence exists as operational counters, but anchored accountability receipts are still separate.'
					: 'No text carrier evidence is loaded for anchoring.',
			boundary: formatGateEvidence(smsReceiptAnchoringGate, {
				prefix:
					'Text receipt permanence waits on dispatch evidence, receipt writer policy, and mainnet anchoring.',
				complete:
					'Text receipt evidence can be lifted into anchored accountability artifacts after route-local receipt policy passes.',
				density: 'operator'
			}),
			gate: smsReceiptAnchoringGate,
			metric: {
				value: enabledAndLoaded ? receiptCounterCount : null,
				label: 'anchorable counters',
				cite: 'CP-receipt-anchoring'
			}
		}
	];
	const browserCustodyState: CapabilityState =
		enabledAndLoaded && dispatchState === 'live'
			? 'live'
			: enabledAndLoaded && routeBatchRuntimeReady
				? 'partial'
				: 'gated';
	const scopeRevalidationState: CapabilityState =
		enabledAndLoaded && dispatchState === 'live'
			? 'live'
			: enabledAndLoaded && routeBatchRuntimeReady
				? 'partial'
				: 'gated';
	const proofRows: TextCarrierProofRow[] = [
		{
			id: 'saved-draft-packet',
			label: 'Saved draft packet',
			state: draftPacketState,
			href: `${base}/sms/new#text-message`,
			action: draftCount > 0 ? 'open saved draft packet' : 'compose text draft',
			handoff: 'SMS body packet',
			effect: enabledAndLoaded
				? `${draftCount} saved text draft packets are durable authoring ground; no carrier side effect is implied.`
				: unreadGroundBoundary('Text delivery', 'saved SMS body packet claims'),
			gate: formatGateEvidence(smsDispatchGate, {
				prefix: 'Saved SMS body packets stay authoring ground until carrier dispatch proof clears.',
				complete: 'Saved SMS body packets can hand off to route-local dispatch proof.',
				density: 'operator'
			}),
			clusters: 'C-accountability / C-reach',
			metric: {
				value: enabledAndLoaded ? draftCount : null,
				label: 'draft packets',
				cite: 'sms.listBlasts'
			}
		},
		{
			id: 'audience-scope',
			label: 'Audience scope',
			state: audienceState,
			href:
				plannedRecipientCount > 0
					? `${base}/sms#text-audience-snapshot`
					: `${base}/sms/new#text-audience-snapshot`,
			action: plannedRecipientCount > 0 ? 'read saved scope' : 'shape text scope',
			handoff: 'Saved eligible cohort',
			effect: enabledAndLoaded
				? `${plannedRecipientCount} planned recipients are saved as filter-aware scope evidence before any phone decrypt or carrier request.`
				: unreadGroundBoundary('Text delivery', 'saved text audience scope claims'),
			gate: 'Saved audience scope is a recipientFilter/count contract; it is not phone decrypt, carrier delivery, TCPA clearance, or receipt proof.',
			clusters: 'C-reach / C-verification',
			metric: {
				value: enabledAndLoaded ? plannedRecipientCount : null,
				label: 'scoped recipients',
				cite: 'smsBlasts.totalRecipients + sms.countEligibleRecipientsForFilter'
			}
		},
		{
			id: 'browser-phone-custody',
			label: 'Browser phone custody',
			state: browserCustodyState,
			href: dispatchHref,
			action: browserCustodyState === 'gated' ? 'read custody boundary' : 'open browser custody',
			handoff: 'Org-key phone decrypt',
			effect: routeBatchRuntimeReady
				? 'The draft detail route can prompt for the org key and prepare encrypted phones in bounded browser batches; the OS shell still never loads plaintext phone numbers.'
				: enabledAndLoaded
					? `Browser phone custody is not ready for carrier dispatch; missing ${routeDispatchMissingText}.`
					: unreadGroundBoundary('Text delivery', 'browser phone-custody claims'),
			gate: formatGateEvidence(smsDispatchGate, {
				prefix:
					text.dispatchRuntimeMessage ??
					`Browser phone custody stays dependency-first until ${dispatchRuntimeDependency} pass.`,
				complete:
					'Browser phone custody is available only inside route-local org-key dispatch checks.',
				density: 'operator'
			}),
			clusters: 'C-data-sovereignty / C-reach',
			metric: {
				value: enabledAndLoaded ? (dispatchClientBatchRouteMounted ? 1 : 0) : null,
				label: 'browser route',
				cite: 'getTextDispatchReadiness.clientBatchRouteMounted'
			}
		},
		{
			id: 'scope-revalidation',
			label: 'Scope revalidation',
			state: scopeRevalidationState,
			href: dispatchHref,
			action: scopeRevalidationState === 'gated' ? 'read scope boundary' : 'verify dispatch scope',
			handoff: 'Dispatch cohort guard',
			effect:
				'Each dispatch API request reloads the next saved encrypted cohort, rejects decrypted supporter IDs outside that saved audience scope, and caps plaintext E.164 payloads at 100 recipients.',
			gate: 'Scope revalidation must pass before every Twilio request; a saved draft cannot expand into a broader carrier cohort.',
			clusters: 'C-verification / C-data-sovereignty',
			metric: {
				value: enabledAndLoaded && dispatchClientBatchRouteMounted ? 100 : null,
				label: 'recipient cap',
				cite: 'SMS client dispatch batch limit'
			}
		},
		{
			id: 'carrier-acceptance',
			label: 'Carrier acceptance',
			state: receiptState,
			href: receiptHref,
			action: receiptState === 'partial' ? 'read carrier evidence' : 'read carrier boundary',
			handoff: 'Twilio outcome rows',
			effect: enabledAndLoaded
				? `${receiptCounterCount} sent/delivered/failed counters and ${messageCount} carrier outcome rows are operational evidence, not anchored accountability proof.`
				: unreadGroundBoundary('Text delivery', 'carrier acceptance evidence claims'),
			gate: 'Carrier acceptance proves provider-side attempt/outcome rows only; reply handling and receipt anchoring are separate contracts.',
			clusters: 'C-reader-side / C-accountability',
			metric: {
				value: enabledAndLoaded ? receiptCounterCount : null,
				label: 'carrier counters',
				cite: 'smsBlasts sent/delivered/failed counts'
			}
		},
		{
			id: 'reply-register',
			label: 'Reply register',
			state: replyState,
			href: `${base}/sms#text-replies`,
			action: replyCount > 0 ? 'read replies' : 'read reply boundary',
			handoff: 'Inbound response evidence',
			effect: enabledAndLoaded
				? `${replyCount} inbound free-text replies are recorded without exposing plaintext phone numbers in the OS shell.`
				: unreadGroundBoundary('Text delivery', 'text reply evidence claims'),
			gate: formatGateEvidence(textReplyRegisterGate, {
				prefix:
					'Text replies are bounded response evidence, not an admin inbox, autoresponder, assignment queue, legal-policy review, or reader-office notification loop.',
				complete:
					'Reply evidence can lift into routed reader-office workflows after those surfaces clear.',
				density: 'operator'
			}),
			clusters: 'C-reader-side / C-accountability',
			metric: {
				value: enabledAndLoaded ? replyCount : null,
				label: 'text replies',
				cite: 'sms.listReplies'
			}
		},
		{
			id: 'receipt-anchoring',
			label: 'Receipt anchoring',
			state: anchoringState,
			href: receiptHref,
			action: anchoringState === 'partial' ? 'read anchoring proof' : 'read anchoring gate',
			handoff: 'Durable text receipts',
			effect:
				receiptCounterCount > 0
					? 'Carrier outcome rows are present, but permanence still waits on receipt-writer policy and mainnet anchoring.'
					: 'No carrier outcome rows are loaded for durable receipt anchoring.',
			gate: formatGateEvidence(smsReceiptAnchoringGate, {
				prefix:
					'Text receipt anchoring waits on dispatch evidence, receipt writer policy, and mainnet anchoring.',
				complete:
					'Text receipt evidence can be lifted into anchored accountability artifacts after route-local receipt policy passes.',
				density: 'operator'
			}),
			clusters: 'C-accountability / C-data-sovereignty',
			metric: {
				value: enabledAndLoaded ? receiptCounterCount : null,
				label: 'anchorable counters',
				cite: 'CP-receipt-anchoring'
			}
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const armedCount = rows.filter((row) => row.state === 'live' || row.state === 'partial').length;
	const boundaryCount = rows.length - liveCount;
	const nextGate = highestDownstreamGate([
		smsDispatchGate,
		smsReceiptAnchoringGate,
		textReplyRegisterGate
	]);
	const metric = {
		value: loaded ? subscribedPhoneCount : null,
		label: 'text subscribed',
		cite: 'supporters.getSummaryStats smsHealth'
	};

	return {
		rows,
		proofRows,
		state: !text.enabled
			? 'gated'
			: !loaded
				? 'gated'
				: dispatchRuntimeReady && smsDispatchGate.state === 'live'
					? 'partial'
					: armedCount > 0 || draftCount > 0 || consentStatusCount > 0
						? 'partial'
						: 'draft-only',
		signal: !text.enabled
			? 'text delivery not armed'
			: !loaded
				? 'unread text ground'
				: `${draftCount} drafts · ${subscribedPhoneCount} text-subscribed · ${smsConsentEvidence} consent evidence`,
		effect: !text.enabled
			? featureNotArmedBoundary(
					'Text delivery',
					'SMS authoring, carrier dispatch, and receipt-evidence claims'
				)
			: !loaded
				? unreadGroundBoundary(
						'Text delivery',
						'SMS draft, phone-reach, dispatch, and carrier-evidence claims'
					)
				: 'Text delivery separates phone consent status, imported consent evidence, draft packets, audience snapshots, carrier counters, reader replies, dispatch runner, and anchored receipt claims without pretending carrier delivery is armed.',
		detail: !loaded
			? 'Load the text delivery operating slice before showing SMS counts.'
			: `${subscribedPhoneCount} text-subscribed people, ${smsConsentEvidence} SMS consent evidence records, ${stoppedPhoneCount} stopped statuses, ${draftCount} draft packets, ${plannedRecipientCount} planned recipients, ${receiptCounterCount} sent/delivered/failed counters, ${messageCount} message rows, ${replyCount} inbound reply rows, and ${
					dispatchClientBatchRouteMounted
						? 'a mounted bounded browser-dispatch route'
						: 'no mounted browser-dispatch route'
				} are loaded as aggregate-only posture.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate,
		href: dispatchHref,
		action: draftCount > 0 ? 'read text delivery posture' : 'compose text draft',
		handoff: 'Text delivery',
		metric,
		liveCount,
		boundaryCount,
		rowCount: rows.length,
		subscribedPhoneCount: loaded ? subscribedPhoneCount : null,
		receiptCounterCount: loaded ? receiptCounterCount : null
	};
}

export function buildCallRoutingReadiness(
	input: CallRoutingReadinessInputs
): CallRoutingReadinessSummary {
	const { base, calls } = input;
	const { callInitiationGate } = input.gates;
	const loaded = calls.loaded;
	const callCount = calls.callCount ?? 0;
	const completedCallCount = calls.completedCallCount ?? 0;
	const campaignCount = calls.campaignCount ?? 0;
	const initiationRuntimeReady = calls.initiationRuntimeReady === true;
	const initiationRuntimeMissing = calls.initiationRuntimeMissing ?? [];
	const initiationRuntimeDependency =
		calls.initiationRuntimeDependency ??
		'call authority, supporter phone custody, caller confirmation, mounted connect controls, and Twilio transport credentials';
	const initiationRuntimeMessage =
		calls.initiationRuntimeMessage ??
		'Patch-through call initiation stays record-first until call authority, phone custody, caller confirmation, mounted connect controls, and Twilio transport evidence are present.';
	const initiationSurfaceMounted = calls.initiationSurfaceMounted === true;
	const initiationProxyImplemented = calls.initiationProxyImplemented !== false;
	const historyHref = `${base}/calls#call-history`;
	const initiationHref = `${base}/calls#call-initiation-boundary`;
	const queueHref = `${base}/calls#call-queue-boundary`;
	const historyState: CapabilityState = !calls.enabled ? 'gated' : loaded ? 'live' : 'gated';
	const decryptState: CapabilityState =
		calls.enabled &&
		calls.canManageCalls &&
		callInitiationGate.state === 'live' &&
		initiationRuntimeReady
			? 'partial'
			: 'gated';
	const twilioState: CapabilityState = !calls.enabled
		? 'gated'
		: calls.twilioConfigured && initiationProxyImplemented
			? 'partial'
			: 'gated';

	const rows: CallRoutingReadinessRow[] = [
		{
			id: 'call-record-history',
			label: 'Call record history',
			state: historyState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-reader-side',
			href: historyHref,
			action: 'read call history',
			handoff: 'Call records',
			ground: loaded
				? `${callCount} patch-through call records are loaded; ${completedCallCount} are completed. Supporter and target phone fields stay encrypted or redacted on this surface.`
				: unreadGroundBoundary('Call records', 'call-history posture claims'),
			boundary:
				'Call records are operational evidence only. They are not a phone-banking station, volunteer queue, script workflow, or proof-bearing office response artifact.',
			gate: callInitiationGate,
			metric: {
				value: loaded ? callCount : null,
				label: 'call records',
				cite: 'calls.listCalls'
			}
		},
		{
			id: 'caller-phone-decrypt',
			label: 'Caller phone decrypt',
			state: decryptState,
			phase: 'SEND',
			clusters: 'C-data-sovereignty / C-reach',
			href: initiationHref,
			action:
				decryptState === 'partial' ? 'read initiation contract' : 'read call-initiation boundary',
			handoff: 'Caller phone custody',
			ground:
				decryptState === 'partial'
					? 'Caller-phone decrypt, supporter lookup, connect UI, and Twilio runtime are through the shared gate; the route still keeps phones encrypted until a request supplies callerPhone.'
					: initiationRuntimeMessage,
			boundary: formatGateEvidence(callInitiationGate, {
				prefix: `Patch-through call initiation stays dependency-first until ${initiationRuntimeDependency} clear together.`,
				complete:
					'Caller-phone decrypt and call proxy are through the gate; route-local supporter selection still bounds execution.',
				density: 'operator'
			}),
			gate: callInitiationGate,
			metric: {
				value: calls.canManageCalls ? 1 : 0,
				label: 'manager authority',
				cite: 'membership.role'
			}
		},
		{
			id: 'twilio-call-bridge',
			label: 'Twilio call bridge',
			state: twilioState,
			phase: 'SEND',
			clusters: 'C-reach',
			href: initiationHref,
			action: calls.twilioConfigured ? 'read bridge' : 'configure Twilio',
			handoff: 'Twilio bridge',
			ground: calls.twilioConfigured
				? `${initiationProxyImplemented ? 'Twilio bridge and transport credentials are present' : 'Twilio transport credentials are present but the bridge is not armed'}; connect remains ${initiationRuntimeReady ? 'surface-ready' : 'surface-held'}.`
				: `Twilio transport credentials are missing: ${initiationRuntimeMissing.length > 0 ? initiationRuntimeMissing.join(', ') : 'TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER'}.`,
			boundary:
				'Transport configuration alone is not an armed call UI. Caller-phone custody, supporter lookup, permission, route-local connect controls, and runtime readiness must clear before any dial side effect.',
			gate: callInitiationGate,
			metric: {
				value: calls.twilioConfigured ? 1 : null,
				label: 'transport configured',
				cite: 'getCallInitiationReadiness'
			}
		},
		{
			id: 'phone-banking-workflow',
			label: 'Call scripts and queues',
			state: 'gated',
			phase: 'AUTHOR',
			clusters: 'C-coordination-integrity / C-reader-side',
			href: queueHref,
			action: 'read phone-bank boundary',
			handoff: 'Phone-bank workflow',
			ground: `${campaignCount} action records can be listed for context, but no script builder, volunteer assignment, queue, or embeddable click-to-call surface is mounted. Call initiation surface mounted: ${initiationSurfaceMounted ? 'yes' : 'no'}.`,
			boundary: formatGateEvidence(callInitiationGate, {
				prefix:
					'Phone-banking workflow remains separate from call-record posture until initiation custody and queue semantics are implemented.',
				complete:
					'Call initiation custody is through the first gate; script, queue, assignment, and click-to-call semantics still need route-local proof before broader phone-bank claims.',
				density: 'operator'
			}),
			gate: callInitiationGate,
			metric: {
				value: loaded ? campaignCount : null,
				label: 'action contexts',
				cite: 'campaigns.list'
			}
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const armedCount = rows.filter((row) => row.state === 'live' || row.state === 'partial').length;
	const boundaryCount = rows.length - liveCount;
	const metric = {
		value: loaded ? callCount : null,
		label: 'call records',
		cite: 'calls.listCalls'
	};

	return {
		rows,
		state: !calls.enabled
			? 'gated'
			: !loaded
				? 'gated'
				: armedCount > 0 || callCount > 0
					? 'partial'
					: 'draft-only',
		signal: !calls.enabled
			? 'call routing not armed'
			: !loaded
				? 'unread call ground'
				: `${callCount} records · ${completedCallCount} completed · ${
						calls.twilioConfigured ? 'Twilio set' : 'Twilio missing'
					} · ${initiationRuntimeReady ? 'connect surfaced' : 'connect held'}`,
		effect: !calls.enabled
			? featureNotArmedBoundary(
					'Call routing',
					'patch-through record, caller-phone custody, and call-initiation claims'
				)
			: !loaded
				? unreadGroundBoundary(
						'Call routing',
						'record, Twilio bridge, and initiation-posture claims'
					)
				: 'Call routing separates readable call records, caller-phone custody, Twilio transport, runtime preflight, and phone-banking workflow without exposing a false connect affordance.',
		detail: loaded
			? `${callCount} call records, ${completedCallCount} completed calls, ${campaignCount} action contexts, call authority ${calls.canManageCalls ? 'present' : 'absent'}, Twilio transport ${calls.twilioConfigured ? 'configured' : 'missing'}, and call-initiation runtime ${initiationRuntimeReady ? 'ready' : 'held'} are loaded as aggregate-only posture. ${initiationRuntimeMessage}`
			: 'Load the call routing slice before showing call-record or transport posture.',
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate: callInitiationGate,
		href: initiationHref,
		action: callCount > 0 ? 'read call routing posture' : 'read call-initiation boundary',
		handoff: 'Call routing',
		metric,
		liveCount,
		boundaryCount,
		rowCount: rows.length,
		callCount: loaded ? callCount : null,
		completedCallCount: loaded ? completedCallCount : null
	};
}

export function buildPowerTerrainReadiness(
	input: PowerTerrainReadinessInputs
): PowerTerrainReadinessSummary {
	const { base, power } = input;
	const {
		powerStateLocalTerrainGate,
		powerInternationalTerrainGate,
		powerStateBillTerrainGate,
		powerNonFederalScorecardGate,
		powerOfficeResponseGate
	} = input.gates;
	const joinedTerrainGate = highestDownstreamGate([
		powerStateLocalTerrainGate,
		powerStateBillTerrainGate,
		powerNonFederalScorecardGate,
		powerOfficeResponseGate
	]);
	const followedCount = power.followedCount ?? 0;
	const discoverableOfficialCount = power.discoverableOfficialCount ?? null;
	const watchedBillCount = power.watchedBillCount ?? 0;
	const scorecardCount = power.scorecardCount ?? 0;
	const terrainCount = power.loaded ? followedCount + watchedBillCount + scorecardCount : null;
	const rows: PowerTerrainRow[] = [
		{
			id: 'target-records',
			label: 'Current target records',
			state: power.loaded ? (followedCount > 0 ? 'live' : 'partial') : 'gated',
			phase: 'RESOLVE',
			clusters: 'C-reach',
			href: `${base}/representatives#power-following`,
			action: followedCount > 0 ? 'open Power targets' : 'follow target',
			ground:
				'Followed decision-makers feed Studio target resolution and proof-delivery recipient selection.',
			boundary: formatGateEvidence(powerStateLocalTerrainGate, {
				prefix:
					'Loaded target records are usable; full state, local, and special-district terrain stays bounded.',
				complete: 'Loaded target records are usable, and wider domestic power terrain is armed.',
				density: 'operator'
			}),
			gate: powerStateLocalTerrainGate,
			metric: {
				value: power.loaded ? followedCount : null,
				label: 'followed targets',
				cite: 'legislation.listOrgDmFollows'
			}
		},
		{
			id: 'discoverable-officials',
			label: 'Discoverable officials',
			state: power.loaded
				? discoverableOfficialCount === null || discoverableOfficialCount > 0
					? 'partial'
					: 'draft-only'
				: 'gated',
			phase: 'GROUND',
			clusters: 'C-reach',
			href: `${base}/representatives#power-discover`,
			action:
				discoverableOfficialCount === null || discoverableOfficialCount > 0
					? 'open discover slice'
					: 'read discover boundary',
			ground:
				discoverableOfficialCount === null
					? 'Discovery belongs to the Power targets route; this map does not proxy a discover count from follows.'
					: `${discoverableOfficialCount} discoverable officials are loaded on the Power targets route; search filters local records only.`,
			boundary: formatGateEvidence(powerStateLocalTerrainGate, {
				prefix:
					'Loaded discovery is a bounded route slice until state/local officeholder feeds are armed.',
				complete: 'Loaded discovery and state/local officeholder feeds are armed.',
				density: 'operator'
			}),
			gate: powerStateLocalTerrainGate,
			metric: {
				value: discoverableOfficialCount,
				label: discoverableOfficialCount === null ? 'route-local count' : 'discoverable officials',
				cite: 'legislation.discoverDms'
			}
		},
		{
			id: 'bills-corpus',
			label: 'Bills corpus',
			state: power.legislationEnabled ? (watchedBillCount > 0 ? 'live' : 'partial') : 'gated',
			phase: 'RESOLVE',
			clusters: 'C-reach / C-accountability',
			href: `${base}/legislation#bill-search`,
			action: 'open bills terrain',
			ground:
				'Bill search and watched bill records are route-owned terrain for current loaded corpus data.',
			boundary: formatGateEvidence(powerStateBillTerrainGate, {
				prefix:
					'Federal/current bill terrain is usable; state and local bill lift stays dependency-first.',
				complete: 'Federal/current bill terrain and state/local bill lift are armed.',
				density: 'operator'
			}),
			gate: powerStateBillTerrainGate,
			metric: {
				value: power.loaded ? watchedBillCount : null,
				label: 'watched bills',
				cite: 'legislation.listWatchedBills'
			}
		},
		{
			id: 'score-snapshots',
			label: 'Score snapshots',
			state: power.legislationEnabled ? (scorecardCount > 0 ? 'live' : 'draft-only') : 'gated',
			phase: 'AGGREGATE',
			clusters: 'C-accountability',
			href: `${base}/scorecards#scorecard-list`,
			action: scorecardCount > 0 ? 'open accountability scores' : 'send proof reports',
			ground:
				'Score snapshot rows are loaded from accountability snapshots; absent dimensions stay blank rather than becoming zeros.',
			boundary: formatGateEvidence(powerNonFederalScorecardGate, {
				prefix:
					'Federal score snapshots are bounded; non-federal scorecards wait on state bill and officeholder terrain.',
				complete: 'Federal and non-federal scorecard terrain is armed.',
				density: 'operator'
			}),
			gate: powerNonFederalScorecardGate,
			metric: {
				value: power.loaded ? scorecardCount : null,
				label: 'score snapshots',
				cite: 'legislation.listOrgScorecards'
			}
		},
		{
			id: 'state-local-terrain',
			label: 'State/local terrain',
			state: 'gated',
			phase: 'GROUND',
			clusters: 'C-reach / C-data-sovereignty',
			href: `${base}/representatives#power-reach-boundary`,
			action: 'read terrain gate',
			ground:
				'State, local, special-district, and per-district feeds are not collapsed into federal target rows.',
			boundary: formatGateEvidence(powerStateLocalTerrainGate, {
				prefix: 'Treat wider domestic power terrain as dependency-first.',
				complete: 'State, local, special-district, and per-district feeds are armed.',
				density: 'operator'
			}),
			gate: powerStateLocalTerrainGate,
			metric: {
				value: null,
				label: 'state/local feeds',
				cite: 'CP-state-local-terrain'
			}
		},
		{
			id: 'international-resolver',
			label: 'International resolver',
			state: 'gated',
			phase: 'RESOLVE',
			clusters: 'C-reach',
			href: `${base}/representatives#power-reach-boundary`,
			action: 'read resolver gate',
			ground:
				'International lookup remains explicit country resolver work, not a hidden fallback in target search.',
			boundary: formatGateEvidence(powerInternationalTerrainGate, {
				prefix: 'Cross-border representative lookup stays dependency-first.',
				complete: 'Cross-border representative lookup is armed.',
				density: 'operator'
			}),
			gate: powerInternationalTerrainGate,
			metric: {
				value: null,
				label: 'country resolvers',
				cite: 'CP-international-power-terrain'
			}
		},
		{
			id: 'office-response-terrain',
			label: 'Office response terrain',
			state: 'gated',
			phase: 'AGGREGATE',
			clusters: 'C-reader-side / C-accountability',
			href: `${base}/representatives#power-reach-boundary`,
			action: 'read office boundary',
			ground:
				'Public contact evidence can be shown; staffer dashboard, notifications, and office workflows are not armed.',
			boundary: formatGateEvidence(powerOfficeResponseGate, {
				prefix: 'Reader-office response loops stay dependency-first.',
				complete: 'Reader-office response loops are armed.',
				density: 'operator'
			}),
			gate: powerOfficeResponseGate,
			metric: {
				value: null,
				label: 'office workflows',
				cite: 'CP-reader-office-profile'
			}
		},
		{
			id: 'joined-terrain-plane',
			label: 'Joined terrain plane',
			state: 'gated',
			phase: 'RESOLVE',
			clusters: 'C-reach / C-accountability / C-composability',
			href: `${base}/representatives#power-reach-boundary`,
			action: 'read joined-plane gate',
			ground:
				'The OS can point across targets, bills, and scores; it does not claim a full cross-route join plane yet.',
			boundary: formatGateEvidence(joinedTerrainGate, {
				prefix: 'Decision-maker, bill, scorecard, and office-response joins stay dependency-first.',
				complete: 'Decision-maker, bill, scorecard, and office-response joins are armed.',
				density: 'operator'
			}),
			gate: joinedTerrainGate,
			metric: {
				value: null,
				label: 'joined plane',
				cite: joinedTerrainGate.source
			}
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const boundaryCount = rows.length - liveCount;

	return {
		rows,
		state: power.loaded ? (liveCount > 0 ? 'partial' : 'gated') : 'gated',
		signal:
			terrainCount === null
				? 'unread terrain'
				: `${terrainCount} terrain records · ${boundaryCount} boundaries`,
		effect:
			terrainCount === null
				? unreadGroundBoundary('Power terrain', 'target, bill, and score coverage claims')
				: 'Power connects target records, bills, and score snapshots while keeping wider jurisdiction, office-response, and joined-plane claims bounded.',
		detail:
			terrainCount === null
				? 'Load the Power slice before showing terrain counts.'
				: discoverableOfficialCount === null
					? `${followedCount} followed targets, ${watchedBillCount} watched bills, and ${scorecardCount} score snapshots are the loaded terrain; discover counts stay route-local.`
					: `${followedCount} followed targets, ${discoverableOfficialCount} discoverable officials, ${watchedBillCount} watched bills, and ${scorecardCount} score snapshots are the loaded terrain.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate: joinedTerrainGate,
		terrainCount,
		liveCount,
		boundaryCount,
		rowCount: rows.length
	};
}

export function buildPowerTargetDetailRows(input: PowerTargetDetailInputs): PowerTargetDetailRow[] {
	const { base, target } = input;
	const { stateLocalTerrainGate, readerOfficeGate, receiptAnchoringGate } = input.gates;
	const targetHref = `${base}/representatives/${encodeURIComponent(target.id)}`;
	const timelineEvidenceCount =
		target.timelineCount > 0
			? target.timelineCount
			: target.receiptCount > 0
				? target.receiptCount
				: 0;

	return [
		{
			id: 'follow-state',
			label: 'Target follow state',
			state: target.isFollowed ? 'live' : 'draft-only',
			phase: 'RESOLVE',
			clusters: 'C-reach',
			href: `${targetHref}#target-posture`,
			action: target.isFollowed ? 'read target' : 'follow target',
			handoff: 'Power target',
			ground: target.isFollowed
				? 'This target is followed and can serve Studio resolution and proof-delivery selection.'
				: 'This target is loaded, but it is not yet part of the org followed terrain.',
			boundary: formatGateEvidence(stateLocalTerrainGate, {
				prefix: 'Loaded target records are usable now; full state/local terrain remains bounded.',
				complete: 'Loaded target records and wider domestic power terrain are armed.',
				density: 'operator'
			}),
			gate: stateLocalTerrainGate,
			metric: {
				value: target.isFollowed ? 1 : null,
				label: 'followed',
				cite: 'legislation.getDmDetail follow'
			}
		},
		{
			id: 'contact-route',
			label: 'Contact route evidence',
			state: target.hasContactRoute ? 'partial' : 'gated',
			phase: 'SEND',
			clusters: 'C-reach / C-reader-side',
			href: `${targetHref}#target-contact-boundary`,
			action: target.hasContactRoute ? 'read contact route' : 'read contact boundary',
			handoff: 'Public contact evidence',
			ground: target.hasContactRoute
				? 'Public phone, email, website, or office address is visible; it does not claim reader-office workflow automation.'
				: 'No public contact route is loaded for this target, so delivery must resolve elsewhere.',
			boundary: formatGateEvidence(readerOfficeGate, {
				prefix:
					'Office profile enrichment and notification surfaces remain the stronger reader-side claim.',
				complete: 'Office profile enrichment and notification surfaces are armed.',
				density: 'operator'
			}),
			gate: readerOfficeGate,
			metric: {
				value: target.hasContactRoute ? 1 : null,
				label: 'contact route',
				cite: 'legislation.getDmDetail decisionMaker'
			}
		},
		{
			id: 'accountability-timeline',
			label: 'Accountability timeline',
			state: timelineEvidenceCount > 0 ? 'partial' : 'draft-only',
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-quality-signaling',
			href: `${targetHref}#target-accountability`,
			action: timelineEvidenceCount > 0 ? 'read activity' : 'await evidence',
			handoff: 'Target activity',
			ground:
				timelineEvidenceCount > 0
					? 'Votes, sponsorships, and proof receipts render as target-specific response terrain.'
					: 'No votes, sponsorships, or proof receipts are loaded for this target yet.',
			boundary: formatGateEvidence(receiptAnchoringGate, {
				prefix:
					'Long-term receipt survivability and response detection remain bounded by anchoring work.',
				complete: 'Receipt survivability and response detection are armed.',
				density: 'operator'
			}),
			gate: receiptAnchoringGate,
			metric: {
				value: timelineEvidenceCount > 0 ? timelineEvidenceCount : null,
				label: target.timelineCount > 0 ? 'timeline rows' : 'receipt records',
				cite:
					target.timelineCount > 0
						? 'legislation.getDmDetail actions + receipts'
						: 'legislation.getDmDetail accountability.receiptCount'
			}
		},
		{
			id: 'reader-office-boundary',
			label: 'Reader-office boundary',
			state: 'gated',
			phase: 'AGGREGATE',
			clusters: 'C-reader-side / C-accountability',
			href: `${targetHref}#target-contact-boundary`,
			action: 'read office-workflow boundary',
			handoff: 'Reader-office workflow',
			ground:
				'Reader-office profile enrichment, office-response workflow, and notification webhooks are not armed here.',
			boundary: formatGateEvidence(readerOfficeGate, {
				prefix: 'Keep office-response workflow claims gated until reader-office profiles land.',
				complete: 'Reader-office profiles and office-response workflow are armed.',
				density: 'operator'
			}),
			gate: readerOfficeGate,
			metric: {
				value: null,
				label: 'office workflows',
				cite: 'CP-reader-office-profile'
			}
		}
	];
}

export function buildLegislativeMonitoringReadiness(
	input: LegislativeMonitoringReadinessInputs
): LegislativeMonitoringReadinessSummary {
	const { base, legislation } = input;
	const {
		stateBillTerrainGate,
		perSupporterAlertsGate,
		delegatedMonitoringGate,
		multiJurisdictionRoutingGate
	} = input.gates;
	const watchedBillCount = legislation.watchedBillCount ?? 0;
	const relevantBillCount = legislation.relevantBillCount ?? 0;
	const positionedBillCount = legislation.positionedBillCount ?? 0;
	const searchResultCount = legislation.searchResultCount ?? null;
	const enabled = legislation.enabled;
	const loaded = legislation.loaded;
	const terrainHref = `${base}/legislation#bill-terrain-boundary`;
	const searchHref = `${base}/legislation#bill-search`;
	const watchHref = `${base}/legislation#bill-watchlist`;
	const relevanceHref = `${base}/legislation#bill-relevance`;
	const corpusState: CapabilityState = !loaded || !enabled ? 'gated' : 'partial';
	const watchlistState: CapabilityState =
		!loaded || !enabled ? 'gated' : watchedBillCount > 0 ? 'live' : 'draft-only';
	const relevanceState: CapabilityState =
		!loaded || !enabled ? 'gated' : relevantBillCount > 0 ? 'partial' : 'draft-only';
	const positionState: CapabilityState =
		!loaded || !enabled
			? 'gated'
			: positionedBillCount > 0
				? 'partial'
				: watchedBillCount > 0
					? 'draft-only'
					: 'gated';

	const rows: LegislativeMonitoringReadinessRow[] = [
		{
			id: 'federal-bill-corpus',
			label: 'Federal bill corpus',
			state: corpusState,
			phase: 'GROUND',
			clusters: 'C-reach / C-accountability',
			href: searchHref,
			action: enabled ? 'open bill search' : 'read bill boundary',
			handoff: 'Bills terrain',
			ground: enabled
				? searchResultCount === null
					? 'Bill search runs against the current loaded federal corpus; state and local corpora are not folded into this count.'
					: `${searchResultCount} bill search results are loaded from the route-local federal corpus query; state and local corpora are not folded into this count.`
				: featureNotArmedBoundary('Legislative monitoring', 'bill-corpus search claims'),
			boundary: formatGateEvidence(stateBillTerrainGate, {
				prefix:
					'Federal bill search is the current corpus; state and local bill ingestion remains bounded.',
				complete: 'Federal, state, and local bill corpora are armed.',
				density: 'operator'
			}),
			gate: stateBillTerrainGate,
			metric: {
				value: enabled && loaded ? searchResultCount : null,
				label: searchResultCount === null ? 'current federal corpus' : 'searched results',
				cite: 'legislation.searchBills route-local query'
			}
		},
		{
			id: 'org-watchlist',
			label: 'Org watchlist',
			state: watchlistState,
			phase: 'RESOLVE',
			clusters: 'C-reach / C-coordination-integrity',
			href: watchHref,
			action: watchedBillCount > 0 ? 'open watched bills' : 'watch bill',
			handoff: 'Watched bills',
			ground: loaded
				? `${watchedBillCount} watched bills are loaded for this org.`
				: unreadGroundBoundary('Legislative monitoring', 'watched-bill claims'),
			boundary:
				'Watched bills are org-side terrain. They do not imply constituent subscriptions, district fan-out, or agentic monitoring.',
			gate: perSupporterAlertsGate,
			metric: {
				value: loaded && enabled ? watchedBillCount : null,
				label: 'watched bills',
				cite: 'legislation.listWatchedBills'
			}
		},
		{
			id: 'org-relevance-screen',
			label: 'Org relevance screen',
			state: relevanceState,
			phase: 'GROUND',
			clusters: 'C-agentic / C-quality-signaling',
			href: relevanceHref,
			action: relevantBillCount > 0 ? 'read relevance rows' : 'score issue domains',
			handoff: 'Bill relevance',
			ground: loaded
				? `${relevantBillCount} relevance rows are loaded from org issue-domain scoring.`
				: unreadGroundBoundary('Legislative monitoring', 'bill-relevance claims'),
			boundary:
				'Relevance rows rank bills for an org. They are not constituent-specific alerts, legal analysis, or autonomous agent recommendations.',
			gate: delegatedMonitoringGate,
			metric: {
				value: loaded && enabled ? relevantBillCount : null,
				label: 'relevance rows',
				cite: 'legislation.listRelevantBills'
			}
		},
		{
			id: 'position-register',
			label: 'Position register',
			state: positionState,
			phase: 'AUTHOR',
			clusters: 'C-accountability / C-reader-side',
			href: watchHref,
			action: positionedBillCount > 0 ? 'read positions' : 'set bill position',
			handoff: 'Watched bill positions',
			ground: loaded
				? `${positionedBillCount} watched bills carry an org position.`
				: unreadGroundBoundary('Legislative monitoring', 'bill-position claims'),
			boundary:
				'Positions are authoring ground for the org. They do not become scorecard votes, proof delivery, or office-response evidence until action records and receipts exist.',
			gate: stateBillTerrainGate,
			metric: {
				value: loaded && enabled ? positionedBillCount : null,
				label: 'positioned bills',
				cite: 'orgBillWatches.position'
			}
		},
		{
			id: 'state-local-corpus',
			label: 'State and local bill corpus',
			state: 'gated',
			phase: 'GROUND',
			clusters: 'C-reach / C-data-sovereignty',
			href: terrainHref,
			action: 'read corpus gate',
			handoff: 'State bill terrain',
			ground:
				'State, local, and special-district bill data are not present in the org bill corpus.',
			boundary: formatGateEvidence(stateBillTerrainGate, {
				prefix: 'State/local bill monitoring remains dependency-first.',
				complete: 'State/local bill ingestion is armed for monitoring and scorecards.',
				density: 'operator'
			}),
			gate: stateBillTerrainGate,
			metric: {
				value: null,
				label: 'state/local corpus',
				cite: 'T6-6 / T3-1'
			}
		},
		{
			id: 'per-supporter-alerts',
			label: 'Per-supporter alert fan-out',
			state: 'gated',
			phase: 'SEND',
			clusters: 'C-agentic / C-reach',
			href: terrainHref,
			action: 'read alert gate',
			handoff: 'Constituent bill alerts',
			ground:
				'Legislative alerts are org-scoped today; no constituentBillSubscriptions or per-supporter alert rows are armed.',
			boundary: formatGateEvidence(perSupporterAlertsGate, {
				prefix:
					'Constituent-level bill alerts stay gated until subscription and district fan-out tables exist.',
				complete: 'Per-supporter bill alerts are armed.',
				density: 'operator'
			}),
			gate: perSupporterAlertsGate,
			metric: {
				value: null,
				label: 'supporter alerts',
				cite: 'T4-3 per-supporter-bill-alerts'
			}
		},
		{
			id: 'delegated-monitoring',
			label: 'Delegated agent monitoring',
			state: 'gated',
			phase: 'SEND',
			clusters: 'C-agentic / C-verification',
			href: terrainHref,
			action: 'read agent gate',
			handoff: 'Delegated monitoring',
			ground:
				'No delegation executor watches bill changes or drafts responses inside verified constituent authority.',
			boundary: formatGateEvidence(delegatedMonitoringGate, {
				prefix:
					'Agentic monitoring remains gated until the delegation executor, per-supporter alerts, and district matching exist.',
				complete: 'Delegated legislative monitoring is armed.',
				density: 'operator'
			}),
			gate: delegatedMonitoringGate,
			metric: {
				value: null,
				label: 'delegated monitors',
				cite: 'T4-4 agentic-legislative-monitoring'
			}
		},
		{
			id: 'multi-jurisdiction-routing',
			label: 'Multi-jurisdiction routing',
			state: 'gated',
			phase: 'RESOLVE',
			clusters: 'C-reach / C-composability',
			href: terrainHref,
			action: 'read routing gate',
			handoff: 'Campaign jurisdiction legs',
			ground:
				'Campaigns still resolve a single target country/jurisdiction path; jurisdiction-leg routing is not armed.',
			boundary: formatGateEvidence(multiJurisdictionRoutingGate, {
				prefix:
					'Multi-jurisdiction campaign routing stays gated until campaign legs and per-slot resolution exist.',
				complete: 'Multi-jurisdiction routing is armed.',
				density: 'operator'
			}),
			gate: multiJurisdictionRoutingGate,
			metric: {
				value: null,
				label: 'routing legs',
				cite: 'T3-8 multi-jurisdiction-routing'
			}
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const armedCount = rows.filter((row) => row.state === 'live' || row.state === 'partial').length;
	const boundaryCount = rows.length - liveCount;
	const nextGate = highestDownstreamGate([
		delegatedMonitoringGate,
		perSupporterAlertsGate,
		stateBillTerrainGate,
		multiJurisdictionRoutingGate
	]);
	const metric = {
		value: loaded && enabled ? watchedBillCount : null,
		label: 'watched bills',
		cite: 'legislation.listWatchedBills'
	};

	return {
		rows,
		state: !loaded || !enabled ? 'gated' : armedCount > 0 ? 'partial' : 'draft-only',
		signal: !enabled
			? 'legislation not armed'
			: !loaded
				? 'unread bill terrain'
				: `${watchedBillCount} watched · ${relevantBillCount} relevant · ${positionedBillCount} positioned`,
		effect: !enabled
			? featureNotArmedBoundary(
					'Legislative monitoring',
					'bill corpus, watchlist, relevance, position, alert, and routing claims'
				)
			: !loaded
				? unreadGroundBoundary('Legislative monitoring', 'watch, relevance, and position claims')
				: 'Bills terrain separates federal corpus search, org watch/relevance/positions, state-local corpus, supporter alerts, delegated monitoring, and multi-jurisdiction routing.',
		detail:
			!loaded || !enabled
				? 'Load the legislation slice before showing watch, relevance, or position counts.'
				: `${watchedBillCount} watched bills, ${relevantBillCount} relevance rows, and ${positionedBillCount} positioned bills are loaded as org-side terrain; constituent-level monitoring remains gated.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate,
		href: terrainHref,
		action: watchedBillCount > 0 ? 'read monitoring posture' : 'open bills terrain',
		handoff: 'Bills terrain',
		metric,
		liveCount,
		boundaryCount,
		rowCount: rows.length,
		watchedBillCount: loaded && enabled ? watchedBillCount : null,
		relevantBillCount: loaded && enabled ? relevantBillCount : null,
		positionedBillCount: loaded && enabled ? positionedBillCount : null
	};
}

export function buildResultsProofReadiness(
	input: ResultsProofReadinessInputs
): ResultsProofReadinessSummary {
	const { results, features, hrefs } = input;
	const { receiptAnchoringGate, readerOfficeGate, coordinationIntegrityGate } = input.gates;
	const packetClaimsGate = highestDownstreamGate([
		receiptAnchoringGate,
		readerOfficeGate,
		coordinationIntegrityGate
	]);
	const verifiedCount = results.verifiedCount ?? 0;
	const totalCount = results.totalCount ?? 0;
	const districtCount = results.districtCount ?? 0;
	const sentEmails = results.sentEmails ?? 0;
	const campaignCount = results.campaignCount ?? 0;
	const receiptCount = results.receiptCount ?? 0;
	const pendingReceiptCount = results.pendingReceiptCount ?? 0;
	const responseLoggedReceiptCount = results.responseLoggedReceiptCount ?? 0;
	const anchorFieldCount = results.anchorFieldCount ?? 0;
	const receiptSampleLimit = results.receiptSampleLimit ?? 0;
	const receiptProofWeightTotal = results.receiptProofWeightTotal ?? 0;
	const hasActionGround = sentEmails > 0 || campaignCount > 0;
	const hasReceiptRows = receiptCount > 0;
	const packetSurfaceState: CapabilityState = features.ACCOUNTABILITY
		? results.hasPacket
			? 'partial'
			: results.loaded
				? 'partial'
				: 'gated'
		: 'gated';
	const coordinationState: CapabilityState = results.hasPacket
		? 'live'
		: results.loaded
			? 'partial'
			: 'gated';
	const readerSurfaceState: CapabilityState =
		features.ACCOUNTABILITY && results.loaded ? 'partial' : 'gated';
	const receiptEvidenceState: CapabilityState =
		features.ACCOUNTABILITY && results.loaded ? 'partial' : 'gated';
	const receiptAnchoringState: CapabilityState =
		features.ACCOUNTABILITY && anchorFieldCount > 0 && receiptAnchoringGate.state === 'live'
			? 'live'
			: 'gated';
	const readerOfficeState: CapabilityState =
		features.ACCOUNTABILITY && results.hasPacket && readerOfficeGate.state === 'live'
			? 'partial'
			: 'gated';
	const rows: ResultsProofRow[] = [
		{
			id: 'packet-artifact',
			label: 'Packet artifact',
			state: packetSurfaceState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability',
			href: results.hasPacket ? hrefs.packetHref : hrefs.actionRecordsHref,
			action: results.hasPacket ? 'preview packet' : 'open action records',
			handoff: results.hasPacket ? 'Proof packet' : 'Action records',
			ground: results.hasPacket
				? 'A current computed packet is available from action records for this org.'
				: results.loaded
					? 'Results is loaded, but no current packet exists; action records must produce one before packet metrics are claimed.'
					: unreadGroundBoundary('Results proof', 'packet-artifact claims'),
			boundary: formatGateEvidence(receiptAnchoringGate, {
				prefix:
					'Computed packet visibility is not the same as durable receipt anchoring; anchoring remains bounded.',
				complete: 'Computed packet visibility and durable receipt anchoring are armed.',
				density: 'operator'
			}),
			gate: receiptAnchoringGate,
			metric: {
				value: results.hasPacket ? verifiedCount : null,
				label: 'verified in packet',
				cite: 'computeVerificationPacketCached'
			}
		},
		{
			id: 'coordination-integrity',
			label: 'Coordination integrity',
			state: coordinationState,
			phase: 'AGGREGATE',
			clusters: 'C-coordination-integrity',
			href: results.hasPacket ? hrefs.packetHref : hrefs.resultsPacketHref,
			action: results.hasPacket ? 'read packet' : 'open proof readout',
			handoff: results.hasPacket ? 'Packet integrity' : 'Results proof readout',
			ground: results.hasPacket
				? 'Packet-local coordination metrics can be read from the current artifact.'
				: results.loaded
					? 'Integrity computation exists, but org-specific values wait on a current packet.'
					: unreadGroundBoundary('Results proof', 'coordination-integrity metric claims'),
			boundary: formatGateEvidence(coordinationIntegrityGate, {
				prefix:
					'Coordination integrity stays packet-local until the engagement-tier surface is visible.',
				complete:
					'Packet-local coordination integrity is visible with the engagement-tier surface.',
				density: 'operator'
			}),
			gate: coordinationIntegrityGate,
			metric: {
				value: results.hasPacket ? districtCount : null,
				label: 'districts in packet',
				cite: 'verification packet district grouping'
			}
		},
		{
			id: 'reader-verifier',
			label: 'Reader verifier',
			state: readerSurfaceState,
			phase: 'SEND',
			clusters: 'C-reader-side',
			href: results.hasPacket ? hrefs.proofDeliveryHref : hrefs.actionRecordsHref,
			action: results.hasPacket ? 'preview reader proof' : 'open action records',
			handoff: results.hasPacket ? 'Reader proof preview' : 'Action records',
			ground: results.hasPacket
				? 'The reader proof preview can carry the current packet and verification URL.'
				: results.loaded
					? 'Reader proof has a route, but current proof delivery waits on packet ground.'
					: unreadGroundBoundary('Results proof', 'reader-proof claims'),
			boundary: formatGateEvidence(readerOfficeGate, {
				prefix:
					'Reader verification is not an office response workflow; office surfaces and notifications remain bounded.',
				complete: 'Reader verification and office response workflows are armed.',
				density: 'operator'
			}),
			gate: readerOfficeGate,
			metric: {
				value: results.hasPacket ? totalCount : null,
				label: 'actions in packet',
				cite: 'verification packet action count'
			}
		},
		{
			id: 'receipt-evidence',
			label: 'Receipt evidence',
			state: receiptEvidenceState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-data-sovereignty',
			href: hrefs.resultsPacketHref,
			action: hasReceiptRows ? 'open receipt evidence' : 'read receipt boundary',
			handoff: 'Accountability receipts',
			ground: hasReceiptRows
				? `${receiptCount} recent accountability receipt rows are loaded from the bounded receipt summary; ${pendingReceiptCount} pending, ${responseLoggedReceiptCount} with logged response, ${anchorFieldCount} with anchor fields.`
				: results.loaded
					? 'No accountability receipt rows were loaded in the bounded receipt summary; receipt proof waits on eligible proof delivery.'
					: unreadGroundBoundary('Results proof', 'receipt-evidence claims'),
			boundary: formatGateEvidence(receiptAnchoringGate, {
				prefix:
					'Loaded receipt rows are source-row evidence; durable receipt roots and mainnet anchoring remain separate claims.',
				complete:
					'Loaded receipt rows can be read alongside durable receipt roots and mainnet anchoring.',
				density: 'operator'
			}),
			gate: receiptAnchoringGate,
			metric: {
				value: results.loaded ? receiptCount : null,
				label: 'recent receipts',
				cite: 'bounded receipt summary'
			}
		},
		{
			id: 'receipt-anchoring',
			label: 'Receipt anchoring',
			state: receiptAnchoringState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-data-sovereignty',
			href: hrefs.resultsPacketHref,
			action: receiptAnchoringState === 'live' ? 'open anchored receipts' : 'read anchoring gate',
			handoff: 'Receipt permanence',
			ground:
				anchorFieldCount > 0
					? `${anchorFieldCount} loaded receipt rows expose anchor fields, but durable root/mainnet permanence stays gate-backed.`
					: hasReceiptRows
						? `${receiptCount} receipt source rows exist, but no loaded row exposes anchor fields; Merkle roots and mainnet permanence are not implied.`
						: 'Computed packets and accountability receipt rows do not become Merkle-anchored by implication.',
			boundary: formatGateEvidence(receiptAnchoringGate, {
				prefix:
					'Durable receipt roots and mainnet anchoring remain bounded; the proof-email receipt writer is a source row, not permanence.',
				complete: 'Durable receipt roots and mainnet anchoring are armed.',
				density: 'operator'
			}),
			gate: receiptAnchoringGate,
			metric: {
				value: results.loaded ? anchorFieldCount : null,
				label: 'anchor fields',
				cite: 'bounded receipt summary anchorFieldCount'
			}
		},
		{
			id: 'reader-office-response',
			label: 'Reader-office response',
			state: readerOfficeState,
			phase: 'AGGREGATE',
			clusters: 'C-reader-side / C-accountability',
			href: hrefs.resultsPacketHref,
			action: readerOfficeState === 'partial' ? 'open office response' : 'read office gate',
			handoff: 'Reader-office response',
			ground:
				'Verification links can travel to readers, but staffer dashboards, notifications, and response workflows are separate capability ground.',
			boundary: formatGateEvidence(readerOfficeGate, {
				prefix:
					'Reader-office response loops wait on enriched office profiles, staffer surfaces, and notification webhooks.',
				complete:
					'Reader-office response loops have enriched office profiles, staffer surfaces, and notification webhooks.',
				density: 'operator'
			}),
			gate: readerOfficeGate,
			metric: {
				value: null,
				label: 'office workflows',
				cite: 'CP-dm-office-profile'
			}
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const boundaryCount = rows.length - liveCount;
	const metric = results.hasPacket
		? {
				value: verifiedCount,
				label: 'verified in packet',
				cite: 'computeVerificationPacketCached'
			}
		: hasReceiptRows
			? {
					value: receiptCount,
					label: 'recent receipts',
					cite: 'OrgSpacesData.return.receipts.loadedCount'
				}
			: {
					value: results.loaded ? (sentEmails > 0 ? sentEmails : campaignCount) : null,
					label: sentEmails > 0 ? 'sent emails' : 'action records',
					cite:
						sentEmails > 0
							? 'OrgSpacesData.return.stats.sentEmails'
							: 'OrgSpacesData.return.campaigns'
				};

	return {
		rows,
		state: features.ACCOUNTABILITY
			? results.loaded
				? results.hasPacket
					? 'partial'
					: hasActionGround
						? 'partial'
						: 'partial'
				: 'gated'
			: 'gated',
		signal: !results.loaded
			? 'unread proof'
			: results.hasPacket
				? hasReceiptRows
					? `${verifiedCount} verified / ${receiptCount} receipts`
					: `${verifiedCount} verified / ${districtCount} districts`
				: hasReceiptRows
					? `${receiptCount} receipts / packet pending`
					: hasActionGround
						? `${sentEmails > 0 ? sentEmails : campaignCount} ${sentEmails > 0 ? 'sent' : 'records'} / packet pending`
						: '0 records / packet pending',
		effect: !features.ACCOUNTABILITY
			? featureNotArmedBoundary(
					'Results proof',
					'proof-packet, reader-proof, receipt, and response claims'
				)
			: !results.loaded
				? unreadGroundBoundary(
						'Results proof',
						'current packet, integrity, and reader-proof metric claims'
					)
				: results.hasPacket
					? hasReceiptRows
						? 'Results can preview a current packet, show packet-local coordination integrity, read bounded receipt source rows, and hand off reader proof while receipt anchoring and reader-office response remain bounded.'
						: 'Results can preview a current packet, show packet-local coordination integrity, and hand off reader proof while receipt anchoring and reader-office response remain bounded.'
					: 'Results is loaded with action or delivery ground, but no current packet exists; proof claims route back to action records until packet ground exists.',
		detail: !results.loaded
			? 'Load the Results slice before showing proof counts.'
			: results.hasPacket
				? hasReceiptRows
					? `${verifiedCount} verified of ${totalCount} actions across ${districtCount} districts are loaded from the current packet; ${receiptCount} recent receipt rows (${pendingReceiptCount} pending, ${responseLoggedReceiptCount} response logged, ${receiptProofWeightTotal.toFixed(2)} proof weight) are loaded from a ${receiptSampleLimit}-row bounded summary.`
					: `${verifiedCount} verified of ${totalCount} actions across ${districtCount} districts are loaded from the current packet.`
				: hasReceiptRows
					? `${receiptCount} recent receipt rows (${pendingReceiptCount} pending, ${responseLoggedReceiptCount} response logged) are visible; no packet metric is invented.`
					: `${sentEmails} sent-email records and ${campaignCount} action records are visible; no packet metric is invented.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate: packetClaimsGate,
		href: results.hasPacket ? hrefs.packetHref : hrefs.resultsPacketHref,
		action: results.hasPacket ? 'preview packet' : 'open proof readout',
		handoff: results.hasPacket ? 'Proof report' : 'Results packet',
		metric,
		hasPacket: results.hasPacket,
		liveCount,
		boundaryCount,
		rowCount: rows.length
	};
}

export function buildAccountabilityResponseReadiness(
	input: AccountabilityResponseReadinessInputs
): AccountabilityResponseReadinessSummary {
	const { base, response, features } = input;
	const { receiptAnchoringGate, readerOfficeGate, nonFederalScorecardGate } = input.gates;
	const enabled = features.ACCOUNTABILITY && features.LEGISLATION;
	const loaded = response.loaded;
	const scorecardCount = response.scorecardCount ?? 0;
	const receiptCount = response.receiptCount ?? 0;
	const rawOpenedCount = response.openedCount;
	const rawVerifyClickCount = response.verifyClickCount;
	const rawReplyCount = response.replyCount;
	const rawAlignedVoteCount = response.alignedVoteCount;
	const rawRelevantVoteCount = response.relevantVoteCount;
	const openedCount = response.openedCount ?? 0;
	const verifyClickCount = response.verifyClickCount ?? 0;
	const replyCount = response.replyCount ?? 0;
	const alignedVoteCount = response.alignedVoteCount ?? 0;
	const relevantVoteCount = response.relevantVoteCount ?? 0;
	const responseSignalCount =
		rawOpenedCount === null && rawVerifyClickCount === null && rawReplyCount === null
			? null
			: openedCount + verifyClickCount + replyCount;
	const scorecardsHref = `${base}/scorecards`;
	const capabilityHref = `${base}/studio#capability-accountability-response`;
	const loadedAndEnabled = enabled && loaded;

	const deliveryRegisterState: CapabilityState = !enabled
		? 'gated'
		: !loaded
			? 'gated'
			: receiptCount > 0
				? 'live'
				: scorecardCount > 0
					? 'draft-only'
					: 'draft-only';
	const openedSignalState: CapabilityState = !loadedAndEnabled
		? 'gated'
		: openedCount > 0
			? 'partial'
			: receiptCount > 0
				? 'draft-only'
				: 'gated';
	const verifySignalState: CapabilityState = !loadedAndEnabled
		? 'gated'
		: verifyClickCount > 0
			? 'partial'
			: receiptCount > 0
				? 'draft-only'
				: 'gated';
	const replyState: CapabilityState = !loadedAndEnabled
		? 'gated'
		: replyCount > 0
			? 'partial'
			: receiptCount > 0
				? 'draft-only'
				: 'gated';
	const alignmentState: CapabilityState = !loadedAndEnabled
		? 'gated'
		: relevantVoteCount > 0
			? 'partial'
			: scorecardCount > 0
				? 'draft-only'
				: 'gated';
	const officeWorkflowState: CapabilityState =
		loadedAndEnabled && readerOfficeGate.state === 'live' ? 'partial' : 'gated';

	const rows: AccountabilityResponseReadinessRow[] = [
		{
			id: 'proof-delivery-register',
			label: 'Proof delivery register',
			state: deliveryRegisterState,
			phase: 'SEND',
			clusters: 'C-accountability / C-reader-side',
			href: scorecardsHref,
			action: receiptCount > 0 ? 'open response scores' : 'read response ground',
			handoff: 'Accountability scores',
			ground: !enabled
				? featureNotArmedBoundary(
						'Accountability response',
						'proof-delivery response-evidence claims'
					)
				: !loaded
					? unreadGroundBoundary('Accountability response', 'delivery-response count claims')
					: receiptCount > 0
						? `${receiptCount} proof-delivery rows are folded into the org scorecard surface.`
						: `${scorecardCount} score snapshots are loaded, but no org proof-delivery receipt count is present.`,
			boundary: formatGateEvidence(receiptAnchoringGate, {
				prefix:
					'Scorecard receipt counts are sender-side accountability evidence; durable receipt anchoring remains bounded.',
				complete: 'Scorecard receipt counts and durable receipt anchoring are both armed.',
				density: 'operator'
			}),
			gate: receiptAnchoringGate,
			metric: {
				value: loadedAndEnabled ? receiptCount : null,
				label: 'reports received',
				cite: 'LandscapeScorecard.reportsReceived'
			}
		},
		{
			id: 'opened-response-signal',
			label: 'Opened response signal',
			state: openedSignalState,
			phase: 'AGGREGATE',
			clusters: 'C-reader-side',
			href: scorecardsHref,
			action: openedCount > 0 ? 'read opens' : 'read open-signal boundary',
			handoff: 'Reader response signal',
			ground: loadedAndEnabled
				? rawOpenedCount === null
					? 'Opened-report signal is not loaded from a scorecard snapshot.'
					: `${openedCount} opened-report signals are aggregated across scorecard rows.`
				: 'Opened-report signal is unread.',
			boundary:
				'Open tracking is a reader-side signal, not proof that an office reviewed, routed, or acted on the report.',
			gate: readerOfficeGate,
			metric: {
				value: loadedAndEnabled ? rawOpenedCount : null,
				label: 'reports opened',
				cite: 'LandscapeScorecard.reportsOpened'
			}
		},
		{
			id: 'verified-link-signal',
			label: 'Verified-link signal',
			state: verifySignalState,
			phase: 'AGGREGATE',
			clusters: 'C-reader-side / C-verification',
			href: scorecardsHref,
			action: verifyClickCount > 0 ? 'read verify clicks' : 'read verifier boundary',
			handoff: 'Reader verification signal',
			ground: loadedAndEnabled
				? rawVerifyClickCount === null
					? 'Verification-link signal is not loaded from a scorecard snapshot.'
					: `${verifyClickCount} verification-link clicks are aggregated from response evidence.`
				: 'Verification-link response signal is unread.',
			boundary:
				'Verify clicks show reader interaction with the proof surface; they do not imply reply, staffer workflow, or durable receipt anchoring.',
			gate: readerOfficeGate,
			metric: {
				value: loadedAndEnabled ? rawVerifyClickCount : null,
				label: 'verify clicks',
				cite: 'LandscapeScorecard.verifyLinksClicked'
			}
		},
		{
			id: 'reply-log',
			label: 'Reply log',
			state: replyState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-reader-side',
			href: scorecardsHref,
			action: replyCount > 0 ? 'read replies' : 'read reply boundary',
			handoff: 'Reply evidence',
			ground: loadedAndEnabled
				? rawReplyCount === null
					? 'Reply signal is not loaded from a scorecard snapshot.'
					: `${replyCount} reply signals are logged in the scorecard aggregate.`
				: 'Reply evidence is unread.',
			boundary:
				'Replies are logged response evidence, not a complete case-management workflow or notification loop.',
			gate: readerOfficeGate,
			metric: {
				value: loadedAndEnabled ? rawReplyCount : null,
				label: 'replies logged',
				cite: 'LandscapeScorecard.repliesLogged'
			}
		},
		{
			id: 'vote-alignment-basis',
			label: 'Vote alignment basis',
			state: alignmentState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-quality-signaling',
			href: scorecardsHref,
			action: relevantVoteCount > 0 ? 'read alignment basis' : 'read scorecard boundary',
			handoff: 'Accountability score basis',
			ground: loadedAndEnabled
				? rawRelevantVoteCount === null
					? 'Vote alignment basis is not loaded from a scorecard snapshot.'
					: `${rawAlignedVoteCount ?? 0} aligned votes are present across ${relevantVoteCount} scored-vote rows.`
				: 'Vote alignment basis is unread.',
			boundary: formatGateEvidence(nonFederalScorecardGate, {
				prefix:
					'Vote alignment is current scorecard basis; non-federal score terrain remains bounded.',
				complete: 'Federal and non-federal scorecard terrain are armed.',
				density: 'operator'
			}),
			gate: nonFederalScorecardGate,
			metric: {
				value: loadedAndEnabled ? rawRelevantVoteCount : null,
				label: 'scored votes',
				cite: 'LandscapeScorecard.relevantVotes'
			}
		},
		{
			id: 'reader-office-workflow',
			label: 'Reader-office workflow',
			state: officeWorkflowState,
			phase: 'AGGREGATE',
			clusters: 'C-reader-side / C-accountability',
			href: capabilityHref,
			action:
				officeWorkflowState === 'partial' ? 'open office workflow' : 'read office workflow gate',
			handoff: 'Reader-office workflow',
			ground:
				'Scorecard response evidence is not yet an office dashboard, notification API, or staffer workflow surface.',
			boundary: formatGateEvidence(readerOfficeGate, {
				prefix:
					'Reader-office workflow waits on enriched office profiles, staffer surfaces, and notification webhooks.',
				complete:
					'Reader-office workflow has enriched office profiles, staffer surfaces, and notification webhooks.',
				density: 'operator'
			}),
			gate: readerOfficeGate,
			metric: {
				value: null,
				label: 'office workflows',
				cite: 'CP-dm-office-profile'
			}
		}
	];

	const liveCount = rows.filter((row) => row.state === 'live').length;
	const armedCount = rows.filter((row) => row.state === 'live' || row.state === 'partial').length;
	const boundaryCount = rows.length - liveCount;
	const nextGate = highestDownstreamGate([
		readerOfficeGate,
		receiptAnchoringGate,
		nonFederalScorecardGate
	]);
	const metric = {
		value: loadedAndEnabled ? (receiptCount > 0 ? receiptCount : scorecardCount) : null,
		label: receiptCount > 0 ? 'reports received' : 'score snapshots',
		cite: receiptCount > 0 ? 'LandscapeScorecard.reportsReceived' : 'scorecardSnapshotCount'
	};

	return {
		rows,
		state: !enabled ? 'gated' : !loaded ? 'gated' : armedCount > 0 ? 'partial' : 'draft-only',
		signal: !enabled
			? 'response not armed'
			: !loaded
				? 'unread responses'
				: `${receiptCount} reports · ${responseSignalCount ?? 'unread'} signals · ${rawReplyCount ?? 'unread'} replies`,
		effect: !enabled
			? featureNotArmedBoundary(
					'Accountability response',
					'response-evidence, reader-signal, reply, vote-alignment, and office-workflow claims'
				)
			: !loaded
				? unreadGroundBoundary(
						'Accountability response',
						'report, open, verify, reply, and alignment-count claims'
					)
				: 'Accountability response posture separates proof-delivery rows, reader opens, verification clicks, replies, vote-alignment basis, and reader-office workflows.',
		detail: !loadedAndEnabled
			? 'Load the Power scorecard slice before showing response evidence.'
			: responseSignalCount === null && rawRelevantVoteCount === null
				? `${receiptCount} reports are loaded; response and vote-alignment dimensions are unread until a scorecard snapshot exists.`
				: `${receiptCount} reports, ${rawOpenedCount ?? 'unread'} opens, ${rawVerifyClickCount ?? 'unread'} verify clicks, ${rawReplyCount ?? 'unread'} replies, and ${rawRelevantVoteCount ?? 'unread'} scored votes are loaded from scorecard aggregates.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate,
		href: scorecardsHref,
		action: receiptCount > 0 ? 'read response evidence' : 'open accountability scores',
		handoff: 'Accountability response',
		metric,
		liveCount,
		boundaryCount,
		rowCount: rows.length,
		receiptCount: loadedAndEnabled ? receiptCount : null,
		responseSignalCount: loadedAndEnabled ? responseSignalCount : null
	};
}

export function buildCoalitionReadiness(
	input: CoalitionReadinessInputs
): CoalitionReadinessSummary {
	const { base, coalition } = input;
	const { coalitionStatsGate, crossBorderCoalitionGate, coalitionArtifactGate } = input.gates;
	const context = input.context ?? 'index';
	const creationContext = context === 'creation';
	const activeNetworkCount = coalition.activeNetworkCount ?? 0;
	const pendingInviteCount = coalition.pendingInviteCount ?? 0;
	const activeMemberRows = coalition.activeMemberRows ?? 0;
	const draftNetworkCount = coalition.draftNetworkCount ?? 0;
	const creationAuthority = coalition.creationAuthority ?? creationContext;
	const enabledAndLoaded = coalition.enabled && coalition.loaded;
	const networksHref = `${base}/networks`;
	const detailHref = coalition.topActiveNetworkId
		? `${base}/networks/${coalition.topActiveNetworkId}#coalition-proof-posture`
		: networksHref;
	const hrefFor = (id: CoalitionReadinessRowKey, fallback: string): string =>
		input.hrefs?.[id] ?? fallback;
	const membershipState: CapabilityState = !coalition.enabled
		? 'gated'
		: !coalition.loaded
			? 'gated'
			: activeNetworkCount > 0
				? 'live'
				: 'draft-only';
	const inviteState: CapabilityState = !coalition.enabled
		? 'gated'
		: !coalition.loaded
			? 'gated'
			: creationContext && creationAuthority
				? 'live'
				: pendingInviteCount > 0
					? 'partial'
					: 'live';
	const memberAggregateState: CapabilityState = !enabledAndLoaded
		? 'gated'
		: creationContext
			? 'draft-only'
			: activeMemberRows > 0
				? 'partial'
				: activeNetworkCount > 0
					? 'draft-only'
					: 'gated';
	const aggregateDetailState: CapabilityState = !enabledAndLoaded
		? 'gated'
		: activeNetworkCount > 0
			? 'partial'
			: 'draft-only';

	const rows: CoalitionReadinessRow[] = [
		{
			id: 'network-memberships',
			label: creationContext ? 'Coalition record definition' : 'Network memberships',
			state: membershipState,
			phase: creationContext ? 'AUTHOR' : 'GROUND',
			clusters: 'C-composability / C-coordination-integrity',
			href: hrefFor('network-memberships', networksHref),
			action: creationContext
				? 'define network'
				: activeNetworkCount > 0
					? 'open coalition layer'
					: 'read membership ground',
			handoff: creationContext ? 'Coalition definition' : 'Coalition memberships',
			ground: !coalition.enabled
				? featureNotArmedBoundary(
						'Coalition composition',
						'network membership and aggregate-proof claims'
					)
				: !coalition.loaded
					? 'Coalition memberships are unread, so no network count is claimed.'
					: creationContext
						? draftNetworkCount > 0
							? 'A coalition record draft is being shaped through name, slug, and description before any member proof exists.'
							: 'Coalition creation can define the network record, but no saved membership is claimed before submit.'
						: `${activeNetworkCount} active coalition memberships are loaded for this org.`,
			boundary: formatGateEvidence(coalitionStatsGate, {
				complete: creationContext
					? 'Saved network records hand off to the detail route where aggregate stats load after members join.'
					: 'Network membership ground is live; aggregate proof posture belongs on the network detail route.',
				prefix: creationContext
					? 'Coalition record creation remains separate from aggregate proof until a saved network has member rows.'
					: 'Network membership ground remains bounded until the coalition aggregate query is live.',
				density: 'operator'
			}),
			gate: coalitionStatsGate,
			metric: {
				value: enabledAndLoaded ? (creationContext ? draftNetworkCount : activeNetworkCount) : null,
				label: creationContext ? 'draft records' : 'active networks',
				cite: creationContext ? 'network creation form' : 'networks.list active memberships'
			}
		},
		{
			id: 'invite-response-queue',
			label: creationContext ? 'Creation authority' : 'Invite response queue',
			state: inviteState,
			phase: creationContext ? 'GROUND' : 'RESOLVE',
			clusters: creationContext
				? 'C-data-sovereignty / C-coordination-integrity'
				: 'C-coordination-integrity',
			href: hrefFor('invite-response-queue', `${networksHref}#network-invites`),
			action: creationContext
				? 'create network'
				: pendingInviteCount > 0
					? 'respond to invites'
					: 'read invite queue',
			handoff: creationContext ? 'Coalition authority' : 'Coalition invites',
			ground: creationContext
				? enabledAndLoaded
					? 'Creation authority is present only after the route load passes the Coalition plan and owner-role gates.'
					: unreadGroundBoundary('Coalition creation authority', 'plan and owner-role claims')
				: enabledAndLoaded
					? `${pendingInviteCount} pending coalition invites are loaded separately from active memberships.`
					: unreadGroundBoundary('Coalition invite queue', 'invite-response claims'),
			boundary: creationContext
				? 'Creation authority only allows the record save; invitations, member rows, and aggregate proof still begin after creation.'
				: 'Pending invites are coordination ground only; they do not contribute to coalition aggregate proof until accepted.',
			gate: coalitionStatsGate,
			metric: {
				value: enabledAndLoaded
					? creationContext
						? creationAuthority
							? 1
							: 0
						: pendingInviteCount
					: null,
				label: creationContext ? 'authorized creators' : 'pending invites',
				cite: creationContext ? 'networks/new load gate' : 'networks.list pending memberships'
			}
		},
		{
			id: 'member-roster-aggregate',
			label: creationContext ? 'Member proof path' : 'Member roster aggregate',
			state: memberAggregateState,
			phase: creationContext ? 'RESOLVE' : 'GROUND',
			clusters: 'C-composability / C-data-sovereignty',
			href: hrefFor('member-roster-aggregate', networksHref),
			action: creationContext
				? 'invite orgs after create'
				: activeMemberRows > 0
					? 'read member roster'
					: 'read roster boundary',
			handoff: creationContext ? 'Member proof path' : 'Coalition roster',
			ground: creationContext
				? 'Creation saves the coalition shell; invitations, active members, and aggregate proof posture begin after save.'
				: enabledAndLoaded
					? `${activeMemberRows} active member-org rows are visible across this org's loaded networks.`
					: unreadGroundBoundary('Coalition roster aggregate', 'member-structure claims'),
			boundary: creationContext
				? formatGateEvidence(crossBorderCoalitionGate, {
						prefix:
							'Keep member proof and cross-border routing out of the creation claim until coalition routing gates clear.',
						density: 'operator'
					})
				: 'Member rows prove coalition structure, not shared supporter access or cross-org data-sharing permission.',
			gate: creationContext ? crossBorderCoalitionGate : coalitionStatsGate,
			metric: {
				value: enabledAndLoaded ? activeMemberRows : null,
				label: 'member org rows',
				cite: creationContext ? 'post-save network detail' : 'networks.list memberCount'
			}
		},
		{
			id: 'aggregate-proof-detail',
			label: creationContext ? 'Aggregate proof handoff' : 'Aggregate proof detail',
			state: aggregateDetailState,
			phase: 'AGGREGATE',
			clusters: 'C-composability / C-accountability',
			href: hrefFor('aggregate-proof-detail', detailHref),
			action:
				!creationContext && activeNetworkCount > 0
					? 'open aggregate proof'
					: 'read aggregate boundary',
			handoff: 'Coalition proof detail',
			ground: creationContext
				? 'No aggregate proof detail exists until the network is saved and active member rows can be read.'
				: activeNetworkCount > 0
					? 'Network detail routes load live aggregate proof stats with networks.getStats; the shell only carries the membership handoff.'
					: 'No active coalition network is loaded, so aggregate proof detail has no handoff target.',
			boundary:
				'The shell does not fabricate verified coalition actions, unique supporters, district count, or integrity metrics; those counts live on network detail after stats load.',
			gate: coalitionStatsGate,
			metric: {
				value: enabledAndLoaded ? activeNetworkCount : null,
				label: 'detail routes',
				cite: 'networks.getStats via network detail'
			}
		},
		{
			id: 'cross-border-routing',
			label: 'Cross-border coalition routing',
			state: 'gated',
			phase: 'SEND',
			clusters: 'C-reach / C-data-sovereignty',
			href: hrefFor('cross-border-routing', `${networksHref}#coalition-routing-boundary`),
			action: 'read routing boundary',
			handoff: 'Cross-border coalition route',
			ground:
				'Coalition records do not imply multi-country campaign routing or cross-border delivery.',
			boundary: formatGateEvidence(crossBorderCoalitionGate, {
				prefix:
					'Cross-border coalition routing remains bounded until international delivery and settlement gates clear.',
				complete: 'Cross-border coalition routing is armed.',
				density: 'operator'
			}),
			gate: crossBorderCoalitionGate,
			metric: {
				value: null,
				label: 'routing legs',
				cite: 'T7-4 / T7-6 / T6-2'
			}
		},
		{
			id: 'durable-coalition-artifact',
			label: 'Durable coalition artifact',
			state: 'gated',
			phase: 'AGGREGATE',
			clusters: 'C-composability / C-accountability / C-data-sovereignty',
			href: hrefFor('durable-coalition-artifact', `${networksHref}#coalition-artifact-boundary`),
			action: 'read artifact boundary',
			handoff: 'Coalition artifact',
			ground:
				'Descriptive coalition stats do not become archive-grade packets or anchored receipt artifacts by implication.',
			boundary: formatGateEvidence(coalitionArtifactGate, {
				prefix:
					'Durable coalition artifacts wait on receipt anchoring, artifact path, and cross-border delivery work.',
				complete: 'Durable coalition artifacts are armed.',
				density: 'operator'
			}),
			gate: coalitionArtifactGate,
			metric: {
				value: null,
				label: 'anchored artifacts',
				cite: 'T6-1 / T6-2 / T7-6'
			}
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const armedCount = rows.filter((row) => row.state === 'live' || row.state === 'partial').length;
	const boundaryCount = rows.length - liveCount;
	const nextGate = highestDownstreamGate([
		coalitionArtifactGate,
		crossBorderCoalitionGate,
		coalitionStatsGate
	]);
	const metric = {
		value: enabledAndLoaded ? (creationContext ? draftNetworkCount : activeNetworkCount) : null,
		label: creationContext ? 'draft records' : 'active networks',
		cite: creationContext ? 'network creation form' : 'networks.list active memberships'
	};

	return {
		rows,
		state: !coalition.enabled
			? 'gated'
			: !coalition.loaded
				? 'gated'
				: armedCount > 0
					? 'partial'
					: 'draft-only',
		signal: !coalition.enabled
			? 'coalition not armed'
			: !coalition.loaded
				? 'unread coalitions'
				: creationContext
					? `${draftNetworkCount} draft · post-save proof handoff · ${activeMemberRows} member rows`
					: `${activeNetworkCount} active · ${pendingInviteCount} pending · ${activeMemberRows} member rows`,
		effect: !coalition.enabled
			? featureNotArmedBoundary(
					'Coalition composition',
					'network membership, invite, member-roster, aggregate-proof, routing, and durable-artifact claims'
				)
			: !coalition.loaded
				? unreadGroundBoundary(
						'Coalition composition',
						'membership, invite, member-roster, and aggregate-proof handoff claims'
					)
				: creationContext
					? 'Coalition creation separates record definition, creation authority, member proof path, aggregate proof handoff, cross-border routing, and durable artifact claims.'
					: 'Coalition posture separates network memberships, invite resolution, member roster aggregate, aggregate proof detail, cross-border routing, and durable artifact claims.',
		detail: !enabledAndLoaded
			? 'Load the coalition slice before showing network membership posture.'
			: creationContext
				? `${draftNetworkCount} draft coalition records are being shaped; member rows and aggregate proof numbers begin on the saved network detail route.`
				: `${activeNetworkCount} active networks, ${pendingInviteCount} pending invites, and ${activeMemberRows} active member-org rows are loaded; aggregate proof numbers live on network detail.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate,
		href: creationContext
			? hrefFor('network-memberships', `${networksHref}/new`)
			: activeNetworkCount > 0
				? detailHref
				: networksHref,
		action: creationContext
			? 'define network'
			: activeNetworkCount > 0
				? 'open aggregate proof'
				: 'open coalition layer',
		handoff: 'Coalition layer',
		metric,
		liveCount,
		boundaryCount,
		rowCount: rows.length
	};
}

export function buildFundraisingReadiness(
	input: FundraisingReadinessInputs
): FundraisingReadinessSummary {
	const { base, fundraising } = input;
	const { fundraiserRecordGate, donationConfirmationGate, donationReceiptGate } = input.gates;
	const context = input.context ?? 'index';
	const creationContext = context === 'creation';
	const fundraiserCount = fundraising.fundraiserCount ?? 0;
	const activeCount = fundraising.activeCount ?? 0;
	const raisedAmountCents = fundraising.raisedAmountCents ?? 0;
	const donationCount = fundraising.donationCount ?? 0;
	const receiptPolicyCount = fundraising.receiptPolicyCount ?? 0;
	const confirmationCompleted = fundraising.confirmationCompleted ?? 0;
	const confirmationSent = fundraising.confirmationSent ?? 0;
	const confirmationAttempted = fundraising.confirmationAttempted ?? 0;
	const confirmationProviderAccepted = fundraising.confirmationProviderAccepted ?? 0;
	const draftFundraiserCount = fundraising.draftFundraiserCount ?? 0;
	const publishRequested = fundraising.publishRequested === true;
	const enabledAndLoaded = fundraising.enabled && fundraising.loaded;
	const hrefFor = (id: FundraisingReadinessRowKey, fallback: string): string =>
		input.hrefs?.[id] ?? fallback;
	const fundraiserRecordState: CapabilityState = enabledAndLoaded ? 'live' : 'gated';
	const publicDonationState: CapabilityState = !fundraising.enabled
		? 'gated'
		: !fundraising.loaded
			? 'gated'
			: activeCount > 0
				? 'live'
				: 'draft-only';
	const stripeCheckoutState: CapabilityState = !fundraising.enabled
		? 'gated'
		: !fundraising.loaded
			? 'gated'
			: activeCount > 0
				? 'partial'
				: 'draft-only';
	const donorConfirmationState: CapabilityState = !fundraising.enabled
		? 'gated'
		: !fundraising.loaded
			? 'gated'
			: confirmationCompleted > 0
				? 'partial'
				: 'draft-only';
	const providerSendEvidenceState: CapabilityState = !fundraising.enabled
		? 'gated'
		: !fundraising.loaded
			? 'gated'
			: confirmationProviderAccepted > 0
				? 'partial'
				: confirmationSent > 0
					? 'draft-only'
					: 'gated';
	const receiptPolicyState: CapabilityState = !fundraising.enabled
		? 'gated'
		: !fundraising.loaded
			? 'gated'
			: receiptPolicyCount > 0
				? 'partial'
				: 'draft-only';
	const taxReceiptState: CapabilityState =
		enabledAndLoaded && donationReceiptGate.state === 'live' ? 'live' : 'gated';
	const webhookCompletionState: CapabilityState = !fundraising.enabled
		? 'gated'
		: !fundraising.loaded
			? 'gated'
			: donationCount > 0
				? 'partial'
				: activeCount > 0
					? 'draft-only'
					: 'gated';

	const rows: FundraisingReadinessRow[] = [
		{
			id: 'fundraiser-record',
			label: 'Fundraiser record',
			state: fundraiserRecordState,
			phase: 'AUTHOR',
			clusters: 'C-coordination-integrity',
			href: hrefFor('fundraiser-record', `${base}/fundraising`),
			action: fundraiserCount > 0 ? 'open funding records' : 'create fundraiser',
			handoff: 'Fundraising records',
			ground: enabledAndLoaded
				? creationContext
					? draftFundraiserCount > 0
						? 'A fundraiser record draft is being shaped with title, story, goal, currency, and publication intent before donation evidence exists.'
						: 'Fundraiser creation can save a record, but no saved fundraising ground is claimed before submit.'
					: 'Editors can create fundraiser records and the OS has loaded the no-PII fundraiser list.'
				: fundraising.enabled
					? 'Fundraising is enabled, but the OS has not loaded fundraiser record ground.'
					: featureNotArmedBoundary(
							'Fundraising',
							'fundraiser-record, public-intake, confirmation, and receipt claims'
						),
			boundary: formatGateEvidence(fundraiserRecordGate, {
				prefix:
					'Fundraiser records are saved campaign ground; they do not imply public intake or receipt proof by themselves.',
				complete:
					'Fundraiser records are saved campaign ground and stay separate from public intake and receipt proof.',
				density: 'operator'
			}),
			gate: fundraiserRecordGate,
			metric: {
				value: enabledAndLoaded ? (creationContext ? draftFundraiserCount : fundraiserCount) : null,
				label: creationContext ? 'draft records' : 'fundraisers',
				cite: creationContext ? 'fundraiser creation form' : 'donations.listByOrgWithDonors'
			}
		},
		{
			id: 'public-donation-page',
			label: 'Public donation page',
			state: publicDonationState,
			phase: 'SEND',
			clusters: 'C-reader-side / C-reach',
			href: hrefFor('public-donation-page', `${base}/fundraising`),
			action: activeCount > 0 ? 'open public donation pages' : 'publish fundraiser',
			handoff: 'Donation page',
			ground:
				creationContext && publishRequested
					? 'Publishing is requested; the public donation page can open only after the fundraiser record is saved active.'
					: enabledAndLoaded && activeCount > 0
						? 'Active fundraiser records expose public donation pages.'
						: enabledAndLoaded
							? 'Fundraiser records can be shaped, but no active public donation page is loaded.'
							: unreadGroundBoundary('Fundraising', 'public donation intake claims'),
			boundary:
				'Public intake is status-bound: only active fundraisers expose donation pages; draft, paused, or complete records remain non-intake ground.',
			gate: fundraiserRecordGate,
			metric: {
				value: enabledAndLoaded ? activeCount : null,
				label: 'active pages',
				cite: 'campaign status from donations.listByOrgWithDonors'
			}
		},
		{
			id: 'stripe-checkout',
			label: 'Stripe checkout',
			state: stripeCheckoutState,
			phase: 'SEND',
			clusters: 'C-reader-side / C-data-sovereignty',
			href: hrefFor('stripe-checkout', `${base}/fundraising#fundraising-receipt-boundary`),
			action: activeCount > 0 ? 'read checkout boundary' : 'prepare donation intake',
			handoff: 'Donation checkout',
			ground:
				creationContext && publishRequested
					? 'The saved active fundraiser can enter checkout only if payment-provider configuration, pending-donation custody, and org-key encryption pass at runtime.'
					: enabledAndLoaded && activeCount > 0
						? 'Active public fundraiser pages can enter the configured payment checkout path.'
						: enabledAndLoaded
							? 'The checkout action exists, but no active fundraiser is currently loaded for intake.'
							: unreadGroundBoundary('Fundraising', 'payment checkout claims'),
			boundary: formatGateEvidence(donationConfirmationGate, {
				prefix:
					'Payment completion depends on payment-provider configuration, org-key custody, and webhook completion before Commons records a completed donation.',
				complete:
					'Payment completion has provider configuration, org-key custody, and webhook completion ground.',
				density: 'operator'
			}),
			gate: donationConfirmationGate,
			metric: {
				value: enabledAndLoaded ? donationCount : null,
				label: 'completed donations',
				cite: 'donations.listByOrgWithDonors donorCount'
			}
		},
		{
			id: 'donor-confirmation',
			label: 'Donor confirmation register',
			state: donorConfirmationState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-reader-side',
			href: hrefFor('donor-confirmation', `${base}/fundraising#fundraising-receipt-boundary`),
			action: confirmationCompleted > 0 ? 'read confirmations' : 'read confirmation boundary',
			handoff: 'Confirmation register',
			ground: creationContext
				? 'Donor confirmation outcomes begin only after a completed donation and runtime email/org-key dependencies pass.'
				: enabledAndLoaded && confirmationCompleted > 0
					? 'Completed donations have baseline donor-confirmation outcome rows.'
					: enabledAndLoaded
						? 'No completed donation has emitted a confirmation outcome yet; the register stays draft-only.'
						: unreadGroundBoundary('Fundraising', 'donor-confirmation claims'),
			boundary:
				'Baseline donor confirmation is transactional confirmation evidence only; provider acceptance, mailbox delivery, tax acknowledgment, archive-grade receipt proof, and settlement evidence remain separate claims.',
			gate: donationConfirmationGate,
			metric: {
				value: enabledAndLoaded ? confirmationSent : null,
				label: 'confirmations sent',
				cite: 'donations.getConfirmationSummary'
			}
		},
		{
			id: 'provider-send-evidence',
			label: 'Provider send evidence',
			state: providerSendEvidenceState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-data-sovereignty',
			href: hrefFor('provider-send-evidence', `${base}/fundraising#fundraising-receipt-boundary`),
			action:
				confirmationProviderAccepted > 0 ? 'read provider evidence' : 'read send-evidence boundary',
			handoff: 'Confirmation provider evidence',
			ground:
				enabledAndLoaded && confirmationProviderAccepted > 0
					? `${confirmationProviderAccepted} donor confirmations carry provider-accepted message identifiers.`
					: enabledAndLoaded && confirmationSent > 0
						? 'Confirmation sent outcomes exist, but no provider message identifiers are recorded yet.'
						: enabledAndLoaded
							? 'No donor confirmation provider evidence is loaded yet.'
							: unreadGroundBoundary('Fundraising', 'provider send-evidence claims'),
			boundary:
				'Provider message identifiers are send-provider acceptance evidence only. They are not mailbox delivery proof, legal receipt proof, or anchored donation receipts.',
			gate: donationConfirmationGate,
			metric: {
				value: enabledAndLoaded ? confirmationProviderAccepted : null,
				label: 'provider accepted',
				cite: 'donations.confirmationEmailProviderMessageId'
			}
		},
		{
			id: 'receipt-policy-register',
			label: 'Receipt policy register',
			state: receiptPolicyState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-data-sovereignty',
			href: hrefFor('receipt-policy-register', `${base}/fundraising#fundraising-receipt-boundary`),
			action: receiptPolicyCount > 0 ? 'read receipt policy' : 'shape receipt policy',
			handoff: 'Receipt policy',
			ground:
				enabledAndLoaded && receiptPolicyCount > 0
					? `${receiptPolicyCount} fundraiser records carry operator-authored receipt policy text that can render in baseline donor confirmations.`
					: enabledAndLoaded
						? 'No fundraiser record has a saved receipt policy boundary yet.'
						: unreadGroundBoundary('Fundraising', 'receipt-policy claims'),
			boundary:
				'Receipt policy custody can feed baseline confirmation content. It is not legal review, IRS acknowledgment proof, mailbox delivery proof, or Merkle anchoring.',
			gate: donationReceiptGate,
			metric: {
				value: enabledAndLoaded ? receiptPolicyCount : null,
				label: 'receipt policies',
				cite: 'campaigns.donationReceiptPolicy'
			}
		},
		{
			id: 'tax-anchored-receipts',
			label: 'Tax and anchored receipts',
			state: taxReceiptState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-data-sovereignty',
			href: hrefFor('tax-anchored-receipts', `${base}/fundraising#fundraising-receipt-boundary`),
			action: taxReceiptState === 'live' ? 'open receipt proof' : 'read receipt boundary',
			handoff: 'Receipt compliance',
			ground:
				'Donation records and baseline confirmation outcomes do not become compliant tax acknowledgments or anchored receipt proofs by implication.',
			boundary: formatGateEvidence(donationReceiptGate, {
				prefix:
					'Tax receipt workflow, compliance policy, receipt archive, and anchoring remain outside the armed fundraiser surface.',
				complete:
					'Tax receipt workflow, compliance policy, receipt archive, and anchoring are armed.',
				density: 'operator'
			}),
			gate: donationReceiptGate,
			metric: {
				value: null,
				label: 'anchored receipts',
				cite: 'CP-donation-receipt-compliance'
			}
		}
	];
	const proofRows: FundraisingReceiptProofRow[] = [
		{
			id: 'fundraiser-record-ground',
			label: 'Fundraiser record ground',
			state: fundraiserRecordState,
			href: `${base}/fundraising#fundraiser-records`,
			action: fundraiserCount > 0 ? 'open funding records' : 'create fundraiser',
			handoff: 'Saved funding record',
			effect: enabledAndLoaded
				? `${fundraiserCount} fundraiser records preserve goal, story, status, raised amount, and receipt-policy posture without exposing donor PII.`
				: unreadGroundBoundary('Fundraising', 'saved fundraiser record claims'),
			gate: formatGateEvidence(fundraiserRecordGate, {
				prefix:
					'Fundraiser records are authoring and intake ground; they do not prove payment completion, confirmation delivery, tax compliance, or anchoring.',
				complete:
					'Fundraiser record ground is armed and remains separate from payment and receipt proof.',
				density: 'operator'
			}),
			clusters: 'C-coordination-integrity / C-data-sovereignty',
			metric: {
				value: enabledAndLoaded ? fundraiserCount : null,
				label: 'fundraisers',
				cite: 'donations.listByOrgWithDonors'
			}
		},
		{
			id: 'public-intake-scope',
			label: 'Public intake scope',
			state: publicDonationState,
			href: `${base}/fundraising#fundraiser-records`,
			action: activeCount > 0 ? 'open public donation pages' : 'publish fundraiser',
			handoff: 'Active donation page',
			effect: enabledAndLoaded
				? `${activeCount} active fundraiser pages can accept reader-side donation attempts; draft and complete fundraisers remain non-intake records.`
				: unreadGroundBoundary('Fundraising', 'public donation intake claims'),
			gate: 'Public intake scope is status-bound; an active page is not proof of payment completion, donor confirmation, tax status, or receipt anchoring.',
			clusters: 'C-reader-side / C-reach',
			metric: {
				value: enabledAndLoaded ? activeCount : null,
				label: 'active pages',
				cite: 'campaign status from donations.listByOrgWithDonors'
			}
		},
		{
			id: 'payment-provider-handoff',
			label: 'Payment provider handoff',
			state: stripeCheckoutState,
			href: `${base}/fundraising#fundraising-receipt-boundary`,
			action: activeCount > 0 ? 'read payment boundary' : 'prepare donation intake',
			handoff: 'Stripe checkout handoff',
			effect: enabledAndLoaded
				? `${donationCount} completed donations are loaded from the payment completion path; checkout depends on payment-provider configuration and encrypted pending-donation custody.`
				: unreadGroundBoundary('Fundraising', 'payment provider handoff claims'),
			gate: formatGateEvidence(donationConfirmationGate, {
				prefix:
					'Payment provider handoff is not a Commons receipt until Stripe completion, webhook delivery, org-key custody, and confirmation registration complete.',
				complete:
					'Payment provider handoff can produce completed donation rows when route-local payment and webhook checks pass.',
				density: 'operator'
			}),
			clusters: 'C-reader-side / C-data-sovereignty',
			metric: {
				value: enabledAndLoaded ? donationCount : null,
				label: 'completed donations',
				cite: 'donations.processCheckout + stripe webhook'
			}
		},
		{
			id: 'webhook-completion',
			label: 'Webhook completion',
			state: webhookCompletionState,
			href: `${base}/fundraising#fundraising-receipt-boundary`,
			action: donationCount > 0 ? 'read completion rows' : 'read webhook boundary',
			handoff: 'Completed donation row',
			effect: enabledAndLoaded
				? `${donationCount} completed donation rows are loaded after provider completion; pending and failed checkout attempts are not promoted into receipt evidence.`
				: unreadGroundBoundary('Fundraising', 'payment webhook completion claims'),
			gate: 'Webhook completion writes completed donation ground only after provider completion; it does not prove confirmation email acceptance, tax acknowledgment, or permanent receipt storage.',
			clusters: 'C-accountability / C-data-sovereignty',
			metric: {
				value: enabledAndLoaded ? donationCount : null,
				label: 'completed rows',
				cite: 'webhooks.completeDonation'
			}
		},
		{
			id: 'confirmation-outcome-register',
			label: 'Confirmation outcome register',
			state: donorConfirmationState,
			href: `${base}/fundraising#fundraising-receipt-boundary`,
			action: confirmationCompleted > 0 ? 'read confirmations' : 'read confirmation boundary',
			handoff: 'Donor confirmation outcome',
			effect: enabledAndLoaded
				? `${confirmationSent}/${confirmationAttempted} confirmation attempts are recorded; outcomes are sent, skipped, failed, or untracked baseline confirmation evidence.`
				: unreadGroundBoundary('Fundraising', 'donor confirmation outcome claims'),
			gate: 'Confirmation outcomes are transactional donor evidence only; they are not mailbox delivery proof, IRS acknowledgment, archive-grade receipt proof, or settlement evidence.',
			clusters: 'C-accountability / C-reader-side',
			metric: {
				value: enabledAndLoaded ? confirmationSent : null,
				label: 'confirmations sent',
				cite: 'donations.getConfirmationSummary'
			}
		},
		{
			id: 'provider-send-acceptance',
			label: 'Provider send acceptance',
			state: providerSendEvidenceState,
			href: `${base}/fundraising#fundraising-receipt-boundary`,
			action:
				confirmationProviderAccepted > 0 ? 'read provider acceptance' : 'read provider boundary',
			handoff: 'Provider message id',
			effect: enabledAndLoaded
				? `${confirmationProviderAccepted} confirmation rows carry provider-accepted message identifiers.`
				: unreadGroundBoundary('Fundraising', 'provider send-acceptance claims'),
			gate: 'Provider acceptance proves the confirmation provider accepted a send request; it is not inbox placement, donor read proof, tax compliance, or anchoring.',
			clusters: 'C-accountability / C-data-sovereignty',
			metric: {
				value: enabledAndLoaded ? confirmationProviderAccepted : null,
				label: 'provider accepted',
				cite: 'donations.confirmationEmailProviderMessageId'
			}
		},
		{
			id: 'receipt-policy-custody',
			label: 'Receipt policy custody',
			state: receiptPolicyState,
			href: `${base}/fundraising#fundraising-receipt-boundary`,
			action: receiptPolicyCount > 0 ? 'read receipt policy' : 'shape receipt policy',
			handoff: 'Operator-authored receipt context',
			effect: enabledAndLoaded
				? `${receiptPolicyCount} fundraiser records carry operator-authored receipt policy text for baseline donor confirmations.`
				: unreadGroundBoundary('Fundraising', 'receipt policy custody claims'),
			gate: 'Receipt policy custody is operator-authored confirmation context; legal review, EIN validation, receipt archive, and anchoring remain separate gates.',
			clusters: 'C-accountability / C-data-sovereignty',
			metric: {
				value: enabledAndLoaded ? receiptPolicyCount : null,
				label: 'receipt policies',
				cite: 'campaigns.donationReceiptPolicy'
			}
		},
		{
			id: 'tax-anchoring-boundary',
			label: 'Tax and anchoring boundary',
			state: taxReceiptState,
			href: `${base}/fundraising#fundraising-receipt-boundary`,
			action: taxReceiptState === 'live' ? 'open receipt proof' : 'read receipt boundary',
			handoff: 'Compliant receipt proof',
			effect:
				'Donation and confirmation records stay bounded until tax acknowledgment policy, compliant receipt archive, and anchoring are armed.',
			gate: formatGateEvidence(donationReceiptGate, {
				prefix:
					'Tax acknowledgment and anchored donation receipts remain dependency-first beyond baseline donor confirmations.',
				complete:
					'Tax acknowledgment and anchored donation receipt proof are armed after compliance and anchoring pass.',
				density: 'operator'
			}),
			clusters: 'C-accountability / C-data-sovereignty',
			metric: {
				value: null,
				label: 'anchored receipts',
				cite: 'CP-donation-receipt-compliance'
			}
		}
	];

	const liveCount = rows.filter((row) => row.state === 'live').length;
	const armedCount = rows.filter((row) => row.state === 'live' || row.state === 'partial').length;
	const boundaryCount = rows.length - liveCount;
	const nextGate =
		taxReceiptState !== 'live'
			? donationReceiptGate
			: highestDownstreamGate([donationConfirmationGate, fundraiserRecordGate]);
	const metric = enabledAndLoaded
		? {
				value: creationContext ? draftFundraiserCount : donationCount,
				label: creationContext ? 'draft records' : 'completed donations',
				cite: creationContext
					? 'fundraiser creation form'
					: 'donations.listByOrgWithDonors + donations.getConfirmationSummary'
			}
		: {
				value: null,
				label: 'fundraising ground',
				cite: 'OrgSpacesData.operating.fundraising'
			};

	return {
		rows,
		proofRows,
		state: !fundraising.enabled
			? 'gated'
			: !fundraising.loaded
				? 'gated'
				: armedCount > 0
					? 'partial'
					: 'gated',
		signal: !fundraising.enabled
			? 'fundraising not armed'
			: !fundraising.loaded
				? 'unread funding'
				: creationContext
					? `${draftFundraiserCount} draft · ${publishRequested ? 1 : 0} publish intent · receipt held`
					: `${fundraiserCount} fundraisers · ${activeCount} active · ${donationCount} completed · ${confirmationProviderAccepted} provider accepted`,
		effect: !fundraising.enabled
			? featureNotArmedBoundary(
					'Fundraising',
					'fundraiser-record, public-intake, checkout, confirmation, provider evidence, and receipt claims'
				)
			: !fundraising.loaded
				? unreadGroundBoundary(
						'Fundraising',
						'fundraiser-record, public-intake, confirmation, provider evidence, and receipt-posture claims'
					)
				: creationContext
					? 'Fundraiser creation separates record definition, publication intent, checkout dependency, donor confirmation, provider evidence, receipt policy, and tax/anchored receipt boundaries.'
					: 'Funding actions separate saved fundraiser records, active public intake, payment completion, baseline confirmation outcomes, provider send evidence, receipt-policy confirmation content, and the tax/anchored receipt boundary.',
		detail: !fundraising.loaded
			? 'Load the fundraising operating slice before showing funding counts.'
			: creationContext
				? `${draftFundraiserCount} draft fundraiser records are being shaped; publish intent is ${publishRequested ? 'on' : 'off'}, while checkout, confirmation, provider evidence, and tax receipts remain post-save/runtime claims.`
				: `${fundraiserCount} fundraiser records, ${activeCount} active donation pages, ${donationCount} completed donations, ${confirmationSent}/${confirmationAttempted} confirmation attempts sent, ${confirmationProviderAccepted} provider-accepted confirmation message ids, ${receiptPolicyCount} receipt policies, and ${raisedAmountCents} raised cents are loaded without donor PII.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate,
		href: `${base}/fundraising#fundraising-receipt-boundary`,
		action: creationContext
			? 'save fundraiser'
			: donationCount > 0
				? 'read confirmations'
				: fundraiserCount > 0
					? 'open funding records'
					: 'create fundraiser',
		handoff: 'Funding actions',
		metric,
		liveCount,
		boundaryCount,
		rowCount: rows.length
	};
}

export function buildActionRecordReadiness(
	input: ActionRecordReadinessInputs
): ActionRecordReadinessSummary {
	const { base, context, action } = input;
	const {
		actionProofGate,
		reachExpansionGate,
		qualitySettlementGate,
		coordinationHistoryGate,
		congressionalLaunchGate
	} = input.gates;
	const recordCount = action.recordCount ?? (action.hasSavedRecord ? 1 : 0);
	const draftCount =
		action.draftCount ?? (action.status === 'DRAFT' || context === 'draft' ? 1 : 0);
	const activeCount = action.activeCount ?? (action.status === 'ACTIVE' ? 1 : 0);
	const pausedCount = action.pausedCount ?? (action.status === 'PAUSED' ? 1 : 0);
	const completeCount = action.completeCount ?? (action.status === 'COMPLETE' ? 1 : 0);
	const actionCount = action.actionCount ?? 0;
	const verifiedActionCount = action.verifiedActionCount ?? action.packetVerified ?? actionCount;
	const targetCount = action.targetCount ?? 0;
	const hasPacket = action.hasPacket === true || (action.packetVerified ?? 0) > 0;
	const packetVerified = action.packetVerified ?? (hasPacket ? verifiedActionCount : null);
	const hasTargetJurisdiction = Boolean(action.targetJurisdiction);
	const activeOrPaused =
		activeCount > 0 || pausedCount > 0 || action.status === 'ACTIVE' || action.status === 'PAUSED';
	const closedOrActive = activeOrPaused || completeCount > 0 || action.status === 'COMPLETE';
	const debateEnabled = action.debateEnabled === true;
	const congressionalDelivery = action.congressionalDelivery ?? null;
	const congressionalRuntimeReady = congressionalDelivery?.runtimeReady === true;
	const congressionalDeliveryArmed =
		input.features?.CONGRESSIONAL === true &&
		congressionalRuntimeReady &&
		congressionalLaunchGate.state === 'live';
	const congressionalMissingText = formatRuntimeMissing(congressionalDelivery?.runtimeMissing);
	const congressionalDependency =
		congressionalDelivery?.runtimeDependency ??
		'congressional launch flag + House CWC proxy env + Senate CWC API env + per-submission proof/template checks';
	const congressionalBoundary =
		congressionalDelivery?.runtimeMessage ??
		`Congressional delivery is dependency-bound; configure ${congressionalMissingText} before CWC side effects can be armed.`;

	const actionRecordState: CapabilityState =
		context === 'draft'
			? 'draft-only'
			: recordCount > 0 || action.hasSavedRecord
				? 'live'
				: 'draft-only';
	const jurisdictionState: CapabilityState =
		hasTargetJurisdiction || (context === 'index' && activeCount > 0) ? 'partial' : 'draft-only';
	const readerActionState: CapabilityState = activeOrPaused ? 'live' : 'draft-only';
	const packetArtifactState: CapabilityState = hasPacket
		? 'live'
		: closedOrActive || actionCount > 0
			? 'partial'
			: 'draft-only';
	const decisionMakerDeliveryState: CapabilityState =
		hasPacket && targetCount > 0 ? 'partial' : 'gated';
	const qualitySettlementState: CapabilityState =
		action.debateResolved === true || action.hasDebate === true
			? 'partial'
			: debateEnabled
				? 'draft-only'
				: 'gated';
	const completedEvidenceState: CapabilityState =
		completeCount > 0 || action.status === 'COMPLETE'
			? 'live'
			: recordCount > 0 || actionCount > 0
				? 'partial'
				: 'draft-only';
	const congressProofDeliveryState: CapabilityState = congressionalDeliveryArmed
		? context === 'draft'
			? 'partial'
			: 'live'
		: 'gated';

	const defaultHref = (id: ActionRecordReadinessRowKey): string => {
		if (id === 'action-record') {
			if (context === 'draft') return '#action-identity';
			if (context === 'detail') return '#action-settings';
			return `${base}/campaigns`;
		}
		if (id === 'jurisdiction-resolve') {
			if (context === 'draft') return '#proof-destination';
			if (context === 'detail') return '#decision-maker-recipients';
			return `${base}/campaigns/new#proof-destination`;
		}
		if (id === 'reader-action-surface') {
			if (context === 'detail') return activeOrPaused ? '#reader-action-embed' : '#action-settings';
			return activeOrPaused ? `${base}/campaigns` : `${base}/campaigns/new`;
		}
		if (id === 'packet-artifact') {
			if (context === 'detail') return '#proof-preview';
			if (context === 'draft') return '#action-identity';
			return `${base}/campaigns`;
		}
		if (id === 'decision-maker-delivery') {
			if (context === 'detail') return '#decision-maker-recipients';
			return `${base}/campaigns/new#proof-destination`;
		}
		if (id === 'quality-settlement') return '#quality-settlement';
		if (id === 'completed-evidence') return `${base}/campaigns`;
		return context === 'draft'
			? '#proof-delivery-boundary'
			: `${base}/campaigns/new#proof-delivery-boundary`;
	};
	const hrefFor = (id: ActionRecordReadinessRowKey): string => input.hrefs?.[id] ?? defaultHref(id);

	const rows: ActionRecordReadinessRow[] = [
		{
			id: 'action-record',
			label:
				context === 'draft'
					? 'Draft action record'
					: context === 'detail'
						? 'Action record'
						: 'Action record ground',
			state: actionRecordState,
			phase: 'AUTHOR',
			clusters: 'C-accountability / C-reader-side',
			href: hrefFor('action-record'),
			action:
				context === 'draft'
					? 'shape record'
					: recordCount > 0
						? 'open action records'
						: 'assemble proof',
			handoff: context === 'draft' ? 'Action draft' : 'Action records',
			ground:
				context === 'draft'
					? 'Submitting creates an action record draft; it does not claim delivery, reader participation, or proof evidence.'
					: context === 'detail'
						? 'The saved action row preserves title, body, status, target scope, debate threshold, and recipient configuration.'
						: `${recordCount} action record${recordCount === 1 ? '' : 's'} are loaded as action-to-proof ground.`,
			boundary: formatGateEvidence(actionProofGate, {
				prefix:
					'Action records are saved authoring ground; verified participation, receipt anchoring, and reader response stay separate claims.',
				complete:
					'Action records are saved authoring ground and stay separate from proof delivery and receipt anchoring.',
				density: 'operator'
			}),
			gate: actionProofGate,
			metric: {
				value: context === 'draft' ? null : recordCount,
				label: context === 'draft' ? 'draft' : 'records',
				cite: context === 'detail' ? 'campaigns.getForOrgPage' : 'campaigns.getStatusCounts.ALL'
			}
		},
		{
			id: 'jurisdiction-resolve',
			label: 'Jurisdiction resolve',
			state: jurisdictionState,
			phase: 'RESOLVE',
			clusters: 'C-reach / C-verification',
			href: hrefFor('jurisdiction-resolve'),
			action: hasTargetJurisdiction
				? 'keep jurisdiction'
				: context === 'index' && activeCount > 0
					? 'open active actions'
					: 'choose jurisdiction',
			handoff: 'Power terrain',
			ground: hasTargetJurisdiction
				? `Target scope is set to ${action.targetJurisdiction}, ${action.targetCountry ?? 'US'} for downstream decision-maker targeting.`
				: context === 'index' && activeCount > 0
					? `${activeCount} active action record${activeCount === 1 ? '' : 's'} are collecting proof pressure through the currently mounted resolver paths.`
					: 'The action can be shaped before a jurisdiction is selected; broader state, local, and international reach remains bounded.',
			boundary: formatGateEvidence(reachExpansionGate, {
				prefix:
					'Current action records use the mounted resolver terrain; wider state, local, and international routing remains bounded.',
				complete:
					'Resolver terrain can expand beyond the current federal/default paths after this gate clears.',
				density: 'operator'
			}),
			gate: reachExpansionGate,
			metric: {
				value: hasTargetJurisdiction ? 1 : context === 'index' ? activeCount : null,
				label: hasTargetJurisdiction ? 'jurisdiction' : 'active',
				cite: hasTargetJurisdiction
					? 'campaign targetCountry/targetJurisdiction'
					: 'campaigns.getStatusCounts.ACTIVE'
			}
		},
		{
			id: 'reader-action-surface',
			label: 'Reader action surface',
			state: readerActionState,
			phase: 'GROUND / SEND',
			clusters: 'C-verification / C-reach',
			href: hrefFor('reader-action-surface'),
			action: activeOrPaused ? 'copy embed' : 'activate first',
			handoff: 'Public action page',
			ground: activeOrPaused
				? 'The public action route can collect verified reader action and strengthen the packet.'
				: 'The public reader action route stays hidden until the action record is active.',
			boundary: formatGateEvidence(qualitySettlementGate, {
				prefix:
					'Reader participation can strengthen packet evidence; TEE settlement and mainnet survivability remain stronger proof lifts.',
				complete:
					'Reader participation and quality settlement can feed stronger proof posture after route-local checks pass.',
				density: 'operator'
			}),
			gate: qualitySettlementGate,
			metric: {
				value: context === 'index' ? activeCount : actionCount,
				label: context === 'index' ? 'active' : 'actions',
				cite: context === 'index' ? 'campaigns.getStatusCounts.ACTIVE' : 'verified action count'
			}
		},
		{
			id: 'packet-artifact',
			label: 'Packet artifact',
			state: packetArtifactState,
			phase: 'AGGREGATE',
			clusters: 'C-reader-side / C-accountability',
			href: hrefFor('packet-artifact'),
			action: hasPacket ? 'preview packet' : context === 'draft' ? 'prepare action' : 'open action',
			handoff: 'Verification packet',
			ground: hasPacket
				? 'A proof packet is computed from verified action data and can be opened in the report route.'
				: closedOrActive || actionCount > 0
					? 'The action is public or has action rows, but the current packet has not accumulated enough verified evidence yet.'
					: 'Draft records can be shaped before any public proof packet is claimed.',
			boundary: formatGateEvidence(actionProofGate, {
				prefix:
					'Packet artifacts are computed from verified action rows; receipt anchoring and reader-office response remain separate claims.',
				complete:
					'Packet artifacts can compute from verified action rows while receipt anchoring stays a separate proof lift.',
				density: 'operator'
			}),
			gate: actionProofGate,
			metric: {
				value: hasPacket ? packetVerified : actionCount > 0 ? actionCount : null,
				label: hasPacket ? 'verified' : 'actions',
				cite: hasPacket ? 'computeVerificationPacketCached' : 'verified action count'
			}
		},
		{
			id: 'decision-maker-delivery',
			label: 'Decision-maker delivery',
			state: decisionMakerDeliveryState,
			phase: 'RESOLVE / SEND',
			clusters: 'C-reach / C-accountability',
			href: hrefFor('decision-maker-delivery'),
			action: decisionMakerDeliveryState === 'partial' ? 'open proof delivery' : 'add recipients',
			handoff: 'Proof delivery',
			ground:
				targetCount > 0
					? 'Recipient rows are present; the proof-delivery surface queues only selected targets and keeps receipt anchoring bounded.'
					: 'No decision-maker recipient is attached to this action yet.',
			boundary: formatGateEvidence(reachExpansionGate, {
				prefix:
					'Decision-maker delivery stays route-bound: recipient resolution, packet context, receipt eligibility, and reader-office response are separate gates.',
				complete:
					'Recipient terrain can expand while proof delivery remains bounded by route-local packet and receipt checks.',
				density: 'operator'
			}),
			gate: reachExpansionGate,
			metric: {
				value: targetCount,
				label: 'recipients',
				cite: 'campaign.targets'
			}
		},
		{
			id: 'quality-settlement',
			label: 'Quality settlement',
			state: qualitySettlementState,
			phase: 'AGGREGATE',
			clusters: 'C-quality-signaling / C-coordination-integrity',
			href: hrefFor('quality-settlement'),
			action:
				qualitySettlementState === 'partial'
					? 'read debate state'
					: debateEnabled
						? 'set threshold'
						: 'enable debate',
			handoff: 'Quality trigger',
			ground:
				qualitySettlementState === 'partial'
					? 'Campaign-linked debate creation and threshold-triggered spawn are wired; final settlement remains bounded by stronger proof infrastructure.'
					: debateEnabled
						? 'The threshold can be stored with the action record; settlement depends on later participation and proof infrastructure.'
						: 'Adversarial debate is optional context until enabled for this action record.',
			boundary: formatGateEvidence(qualitySettlementGate, {
				prefix:
					'Quality-triggered debate ground exists, while TEE-attested panel execution, stake verification, and mainnet settlement remain stronger lifts.',
				complete:
					'Quality-triggered debate ground is wired; stronger settlement still follows route-local debate and proof checks.',
				density: 'operator'
			}),
			gate: qualitySettlementGate,
			metric: {
				value: qualitySettlementState === 'gated' ? null : 1,
				label: qualitySettlementState === 'partial' ? 'debate ground' : 'enabled',
				cite: action.hasDebate ? 'debates.getByCampaign' : 'campaign.debateEnabled'
			}
		},
		{
			id: 'completed-evidence',
			label: 'Completed evidence',
			state: completedEvidenceState,
			phase: 'AGGREGATE',
			clusters: 'C-coordination-integrity / C-accountability',
			href: hrefFor('completed-evidence'),
			action: completedEvidenceState === 'live' ? 'read completed evidence' : 'watch closure',
			handoff: 'Completed action records',
			ground:
				completedEvidenceState === 'live'
					? 'Completed records preserve the visible path from action to proof and response.'
					: 'Completion evidence appears after an action record finishes its public action and delivery arc.',
			boundary: formatGateEvidence(coordinationHistoryGate, {
				prefix:
					'Completed action evidence remains packet-local until longitudinal integrity snapshots and settlement history deepen.',
				complete:
					'Integrity snapshots are live; history and settlement depth keep expanding from packet data.',
				density: 'operator'
			}),
			gate: coordinationHistoryGate,
			metric: {
				value: completeCount,
				label: 'complete',
				cite: 'campaigns.getStatusCounts.COMPLETE'
			}
		},
		{
			id: 'congress-proof-delivery',
			label: 'Congress proof delivery',
			state: congressProofDeliveryState,
			phase: 'SEND',
			clusters: 'C-verification / C-accountability',
			href: hrefFor('congress-proof-delivery'),
			action: congressionalDeliveryArmed ? 'prepare proof handoff' : 'read proof-delivery boundary',
			handoff: 'Proof delivery boundary',
			ground: congressionalDeliveryArmed
				? 'CWC transport readiness is present, but action routes still require proof packet context, recipients, template, witness, chamber, and representative routing checks before any side effect.'
				: congressionalRuntimeReady
					? 'CWC transport runtime is configured, but the congressional launch gate is not live; action routes provide context only.'
					: `CWC proof delivery is held until ${congressionalMissingText} are configured.`,
			boundary: formatGateEvidence(congressionalLaunchGate, {
				prefix: `${congressionalBoundary} Dependency: ${congressionalDependency}.`,
				density: 'operator'
			}),
			gate: congressionalLaunchGate,
			metric: {
				value: congressionalDeliveryArmed ? 1 : null,
				label: congressionalDeliveryArmed ? 'CWC transport' : 'runtime evidence',
				cite: 'submissions.getCongressionalDeliveryReadiness'
			}
		}
	];

	const liveCount = rows.filter((row) => row.state === 'live').length;
	const boundaryCount = rows.length - liveCount;
	const heldRows = rows.filter((row) => row.state === 'draft-only' || row.state === 'gated');
	const firstHeldRow = heldRows[0] ?? null;
	const state: CapabilityState =
		liveCount === rows.length
			? 'live'
			: rows.some((row) => row.state === 'live' || row.state === 'partial')
				? 'partial'
				: 'draft-only';
	const nextGate =
		firstHeldRow?.gate ??
		highestDownstreamGate([
			actionProofGate,
			reachExpansionGate,
			qualitySettlementGate,
			coordinationHistoryGate,
			congressionalLaunchGate
		]);

	return {
		rows,
		state,
		signal: `${recordCount} records · ${activeCount} active · ${completeCount} complete · ${verifiedActionCount} verified`,
		effect:
			'Action readiness separates saved action records, jurisdiction resolve, reader action intake, packet artifacts, decision-maker proof delivery, quality settlement, completed evidence, and CWC transport boundaries.',
		detail: `${recordCount} action records, ${draftCount} drafts, ${activeCount} active, ${pausedCount} paused, ${completeCount} complete, ${verifiedActionCount} verified action signals, ${targetCount} recipient rows, and ${hasPacket ? 1 : 0} computed packets are visible as action-to-proof evidence.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate,
		href: firstHeldRow?.href ?? `${base}/campaigns`,
		action: firstHeldRow?.action ?? 'read action posture',
		handoff: firstHeldRow?.handoff ?? 'Action records',
		metric: {
			value: recordCount,
			label: 'action records',
			cite: context === 'detail' ? 'campaigns.getForOrgPage' : 'campaigns.getStatusCounts.ALL'
		},
		liveCount,
		boundaryCount,
		rowCount: rows.length
	};
}

export function buildCoordinationReadiness(
	input: CoordinationReadinessInputs
): CoordinationReadinessSummary {
	const { base, coordination } = input;
	const { workflowEffectsGate, workflowRunEvidenceGate, emailProxyGate } = input.gates;
	const definitionCount = coordination.definitionCount ?? 0;
	const enabledCount = coordination.enabledCount ?? 0;
	const triggerFamilyCount = coordination.triggerFamilyCount ?? 0;
	const plannedStepCount = coordination.plannedStepCount ?? 0;
	const emailStepCount = coordination.emailStepCount ?? 0;
	const tagStepCount = coordination.tagStepCount ?? 0;
	const conditionStepCount = coordination.conditionStepCount ?? 0;
	const runEvidenceCount = coordination.runEvidenceCount ?? 0;
	const enabledAndLoaded = coordination.enabled && coordination.loaded;
	const definitionState: CapabilityState = !coordination.enabled
		? 'gated'
		: coordination.loaded
			? enabledCount > 0 && coordination.executionEnabled && workflowEffectsGate.state === 'live'
				? 'partial'
				: 'draft-only'
			: 'gated';
	const triggerState: CapabilityState = !enabledAndLoaded
		? 'gated'
		: coordination.executionEnabled && workflowEffectsGate.state === 'live'
			? 'partial'
			: 'draft-only';
	const stepGrammarState: CapabilityState = !enabledAndLoaded
		? 'gated'
		: coordination.executionEnabled && workflowEffectsGate.state === 'live'
			? 'partial'
			: 'draft-only';
	const runnerState: CapabilityState =
		enabledAndLoaded && coordination.executionEnabled && workflowEffectsGate.state === 'live'
			? 'partial'
			: 'gated';
	const runEvidenceState: CapabilityState = !enabledAndLoaded
		? 'gated'
		: runEvidenceCount > 0
			? 'partial'
			: 'gated';

	const rows: CoordinationReadinessRow[] = [
		{
			id: 'coordination-definitions',
			label: 'Coordination definitions',
			state: definitionState,
			phase: 'AUTHOR',
			clusters: 'C-coordination-integrity',
			href: `${base}/workflows#coordination-definitions`,
			action: definitionCount > 0 ? 'open coordination drafts' : 'draft coordination logic',
			handoff: 'Coordination logic',
			ground: enabledAndLoaded
				? enabledCount > 0 && coordination.executionEnabled && workflowEffectsGate.state === 'live'
					? 'Saved definitions include enabled bounded workflow execution flags.'
					: 'Saved definitions preserve trigger-and-step logic without claiming background execution.'
				: coordination.enabled
					? 'Coordination logic is enabled, but workflow definitions are not loaded into the OS.'
					: featureNotArmedBoundary(
							'Coordination logic',
							'definition, trigger, side-effect, and run-evidence claims'
						),
			boundary: formatGateEvidence(workflowEffectsGate, {
				prefix:
					'Definitions are draft ground; side effects remain held until workflow execution is armed.',
				complete:
					'Definitions can hand off to bounded workflow execution after route-local dependencies pass.',
				density: 'operator'
			}),
			gate: workflowEffectsGate,
			metric: {
				value: enabledAndLoaded ? definitionCount : null,
				label: 'definitions',
				cite: 'workflows.list'
			}
		},
		{
			id: 'trigger-dispatch-contracts',
			label: 'Trigger dispatch contracts',
			state: triggerState,
			phase: 'GROUND',
			clusters: 'C-agentic / C-coordination-integrity',
			href: `${base}/workflows#coordination-definitions`,
			action: triggerState === 'partial' ? 'read trigger contracts' : 'shape triggers',
			handoff: 'Workflow triggers',
			ground:
				enabledAndLoaded && triggerFamilyCount > 0
					? 'Saved trigger families cover people, action, event, funding, and tag-triggered coordination paths present in this org.'
					: enabledAndLoaded
						? 'Trigger grammar can be shaped, but no saved trigger family is loaded yet.'
						: unreadGroundBoundary('Coordination logic', 'trigger-dispatch claims'),
			boundary: formatGateEvidence(workflowEffectsGate, {
				prefix:
					'Trigger clauses remain saved context until the execution gate and scheduled processor are armed.',
				complete:
					'Trigger clauses can schedule enabled workflows through the bounded execution path.',
				density: 'operator'
			}),
			gate: workflowEffectsGate,
			metric: {
				value: enabledAndLoaded ? triggerFamilyCount : null,
				label: 'trigger families',
				cite: 'workflows.list trigger.type'
			}
		},
		{
			id: 'step-grammar',
			label: 'Step grammar',
			state: stepGrammarState,
			phase: 'SEND',
			clusters: 'C-reach / C-reader-side',
			href: `${base}/workflows#coordination-definitions`,
			action: 'draft steps',
			handoff: 'Workflow steps',
			ground:
				enabledAndLoaded && plannedStepCount > 0
					? coordination.executionEnabled && workflowEffectsGate.state === 'live'
						? `${tagStepCount} tag writes/removals and ${conditionStepCount} branch conditions can execute through the bounded runner; ${emailStepCount} email steps remain dependency-bound.`
						: `${emailStepCount} email steps, ${tagStepCount} tag writes/removals, and ${conditionStepCount} branch conditions are loaded as planned coordination logic.`
					: enabledAndLoaded
						? 'Step grammar can be shaped, but no planned steps are loaded yet.'
						: unreadGroundBoundary('Coordination logic', 'step-grammar claims'),
			boundary:
				stepGrammarState === 'partial'
					? 'Step grammar can execute tag, delay, and branch side effects after arming; workflow email still requires SES/org-key/from-email dependencies.'
					: 'Step grammar stores intended behavior; it does not execute email, tag, delay, or branch side effects until the runner is armed.',
			gate: workflowEffectsGate,
			metric: {
				value: enabledAndLoaded ? plannedStepCount : null,
				label: 'planned steps',
				cite: 'workflows.list steps'
			}
		},
		{
			id: 'side-effect-runner',
			label: 'Side-effect runner',
			state: runnerState,
			phase: 'SEND',
			clusters: 'C-agentic / C-reach / C-reader-side',
			href: `${base}/workflows#workflow-execution-boundary`,
			action: runnerState === 'partial' ? 'read runner posture' : 'read execution boundary',
			handoff: 'Workflow execution',
			ground:
				runnerState === 'partial'
					? 'Visible workflow execution can run trigger dispatch, tag writes/removals, branch conditions, and delay/resume; email steps require separate SES/org-key/from-email dependencies.'
					: 'Definitions, triggers, and steps are visible, but background side effects remain dependency-first.',
			boundary: [
				formatGateEvidence(workflowEffectsGate, {
					prefix:
						'Scheduled processing and side effects stay dependency-first until the bounded runner gate opens.',
					complete:
						'Bounded workflow execution is armed for trigger dispatch, tag writes/removals, branch conditions, and delay/resume.',
					density: 'operator'
				}),
				formatGateEvidence(emailProxyGate, {
					prefix:
						'Workflow email also depends on supporter cursor, subscribed status, org key, SES credentials, and configured workflow/from email.',
					complete:
						'Workflow email can use the configured email proxy after supporter and org-key dependencies pass.',
					density: 'operator'
				})
			].join(' '),
			gate: workflowEffectsGate,
			metric: {
				value: enabledAndLoaded ? enabledCount : null,
				label: 'enabled flags',
				cite: 'workflows.list enabled'
			}
		},
		{
			id: 'run-evidence',
			label: 'Run evidence',
			state: runEvidenceState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-coordination-integrity',
			href: `${base}/workflows#coordination-definitions`,
			action: runEvidenceCount > 0 ? 'open run records' : 'read run boundary',
			handoff: 'Workflow run log',
			ground:
				enabledAndLoaded && runEvidenceCount > 0
					? 'Workflow execution rows are loaded as coordination evidence.'
					: enabledAndLoaded
						? 'No workflow execution rows are loaded; run evidence stays unclaimed rather than becoming a zero-performance count.'
						: unreadGroundBoundary('Coordination logic', 'run-evidence claims'),
			boundary: formatGateEvidence(workflowRunEvidenceGate, {
				prefix:
					'Run evidence remains bounded to actual execution rows and packet-local coordination metrics.',
				complete:
					'Run evidence is readable from execution rows and packet-local coordination metrics.',
				density: 'operator'
			}),
			gate: workflowRunEvidenceGate,
			metric: {
				value: enabledAndLoaded ? runEvidenceCount : null,
				label: 'run records',
				cite: 'workflows.list executionCount'
			}
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const armedCount = rows.filter((row) => row.state === 'live' || row.state === 'partial').length;
	const boundaryCount = rows.length - liveCount;
	const nextGate =
		runnerState !== 'partial'
			? workflowEffectsGate
			: highestDownstreamGate([workflowRunEvidenceGate, emailProxyGate]);
	const metric = enabledAndLoaded
		? {
				value: definitionCount,
				label: 'coordination definitions',
				cite: 'workflows.list'
			}
		: {
				value: null,
				label: 'coordination ground',
				cite: 'OrgSpacesData.operating.coordination'
			};

	return {
		rows,
		state: !coordination.enabled
			? 'gated'
			: !coordination.loaded
				? 'gated'
				: armedCount > 0 || definitionCount > 0 || plannedStepCount > 0 || runEvidenceCount > 0
					? 'partial'
					: 'draft-only',
		signal: !coordination.enabled
			? 'coordination not armed'
			: !coordination.loaded
				? 'unread coordination'
				: `${definitionCount} definitions · ${plannedStepCount} steps · ${runEvidenceCount} runs`,
		effect: !coordination.enabled
			? featureNotArmedBoundary(
					'Coordination logic',
					'definition, trigger, step, side-effect, and run-evidence claims'
				)
			: !coordination.loaded
				? unreadGroundBoundary(
						'Coordination logic',
						'definition, trigger-contract, side-effect posture, and run-evidence claims'
					)
				: coordination.executionEnabled && workflowEffectsGate.state === 'live'
					? 'Coordination logic separates saved definitions, trigger dispatch contracts, bounded tag/branch/delay execution, email dependencies, and run evidence.'
					: 'Coordination logic separates saved definitions, trigger dispatch contracts, step grammar, visible execution arming, and run evidence so background automation never reads as armed by default.',
		detail: !coordination.loaded
			? 'Load the coordination operating slice before showing workflow counts.'
			: `${definitionCount} coordination definitions, ${enabledCount} enabled flags, ${triggerFamilyCount} trigger families, ${plannedStepCount} planned steps, and ${runEvidenceCount} run records are loaded from workflow metadata.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate,
		href: `${base}/workflows#workflow-execution-boundary`,
		action: definitionCount > 0 ? 'read coordination posture' : 'draft coordination logic',
		handoff: 'Coordination logic',
		metric,
		liveCount,
		boundaryCount,
		rowCount: rows.length
	};
}

export function buildEventReadiness(input: EventReadinessInputs): EventReadinessSummary {
	const { base, context, event } = input;
	const { eventRecordGate, eventWaitlistGate, attendanceProofGate, eventArtifactGate } =
		input.gates;
	const recordCount = event.recordCount ?? (event.hasSavedRecord ? 1 : 0);
	const publishedCount =
		event.publishedCount ?? (event.status === 'PUBLISHED' || event.publishRequested ? 1 : 0);
	const draftCount = event.draftCount ?? (event.status === 'DRAFT' ? 1 : 0);
	const rsvpCount = event.rsvpCount ?? 0;
	const visibleRsvpRows = event.visibleRsvpRows ?? null;
	const verifiedAttendeeCount = event.verifiedAttendeeCount ?? 0;
	const waitlistEnabledCount =
		event.waitlistEnabledCount ?? (event.waitlistEnabled === true ? 1 : 0);
	const publishLive =
		publishedCount > 0 || event.status === 'PUBLISHED' || event.publishRequested === true;
	const publicRsvpState: CapabilityState = publishLive ? 'live' : 'draft-only';
	const waitlistState: CapabilityState =
		event.waitlistEnabled === true || waitlistEnabledCount > 0 ? 'partial' : 'draft-only';
	const checkinState: CapabilityState =
		context === 'detail' && event.hasCheckinCode === false ? 'gated' : 'partial';
	const artifactState: CapabilityState =
		event.hasCalendarExport || event.hasRosterExport || (context === 'index' && recordCount > 0)
			? 'partial'
			: 'draft-only';
	const defaultHref = (id: EventReadinessRowKey): string => {
		if (id === 'event-record') {
			if (context === 'detail') return '#event-record';
			if (context === 'draft') return '#event-definition';
			return `${base}/events/new`;
		}
		if (id === 'public-rsvp-intake') {
			if (context === 'detail')
				return publishLive ? `${base}/events#event-records` : '#event-publication';
			if (context === 'draft') return '#event-publication';
			return '#event-records';
		}
		if (id === 'waitlist-roster') {
			if (context === 'draft') return '#event-waitlist-boundary';
			if (context === 'detail') return '#event-roster';
			return `${base}/events/new#event-waitlist-boundary`;
		}
		if (id === 'checkin-attendance-signal') {
			if (context === 'detail' || context === 'draft') return '#event-checkin-boundary';
			return '#event-records';
		}
		if (context === 'detail' || context === 'draft') return '#event-export-boundary';
		return '#event-export-boundary';
	};
	const hrefFor = (id: EventReadinessRowKey): string => input.hrefs?.[id] ?? defaultHref(id);

	const rows: EventReadinessRow[] = [
		{
			id: 'event-record',
			label: context === 'index' ? 'Event record drafting' : 'Event record',
			state: 'live',
			phase: 'AUTHOR',
			clusters: 'C-coordination-integrity / C-composability',
			href: hrefFor('event-record'),
			action:
				context === 'detail' ? 'read record' : context === 'draft' ? 'save draft' : 'create event',
			handoff: context === 'detail' ? 'Event record' : 'Event drafting',
			ground:
				context === 'detail'
					? 'Schedule, status, capacity, location, and counters are loaded from the saved event row.'
					: context === 'draft'
						? 'Creates a saved event row with schedule, capacity, location, status, and check-in code.'
						: `${recordCount} saved event records are loaded; editors can create durable event records before any public intake claim.`,
			boundary: formatGateEvidence(eventRecordGate, {
				complete:
					'Event records are armed from saved rows; public intake still depends on publication state.',
				density: 'operator'
			}),
			gate: eventRecordGate,
			metric: {
				value: context === 'detail' ? rsvpCount : recordCount,
				label: context === 'detail' ? 'stored RSVPs' : 'event records',
				cite: context === 'detail' ? 'events.rsvpCount' : 'events.list'
			}
		},
		{
			id: 'public-rsvp-intake',
			label: 'Public RSVP intake',
			state: publicRsvpState,
			phase: 'SEND',
			clusters: 'C-reader-side / C-reach',
			href: hrefFor('public-rsvp-intake'),
			action: publishLive ? 'read RSVPs' : context === 'draft' ? 'prepare page' : 'publish event',
			handoff: 'Public RSVP page',
			ground: publishLive
				? `${publishedCount} published event surface${publishedCount === 1 ? '' : 's'} can accept encrypted public RSVPs; public counters remain K-floored below five.`
				: context === 'detail'
					? 'This event is not currently accepting new public RSVPs.'
					: 'Public RSVP intake stays draft-only until an event is published.',
			boundary: publishLive
				? formatGateEvidence(eventRecordGate, {
						complete:
							'Published RSVP routes share the armed event substrate; public counters remain K-floored.',
						density: 'operator'
					})
				: formatGateEvidence(eventRecordGate, {
						complete:
							'Publish an event to expose /e/[id]; the saved event substrate is already armed.',
						density: 'operator'
					}),
			gate: eventRecordGate,
			metric: {
				value: context === 'detail' ? rsvpCount : publishedCount,
				label: context === 'detail' ? 'stored RSVPs' : 'published events',
				cite: context === 'detail' ? 'eventRsvps.by_eventId' : 'events.status'
			}
		},
		{
			id: 'waitlist-roster',
			label: 'Waitlist roster',
			state: waitlistState,
			phase: 'SEND',
			clusters: 'C-coordination-integrity / C-reader-side',
			href: hrefFor('waitlist-roster'),
			action: waitlistState === 'partial' ? 'store waitlist' : 'prepare waitlist',
			handoff: 'Waitlist roster',
			ground:
				waitlistState === 'partial'
					? `${waitlistEnabledCount} event waitlist setting${waitlistEnabledCount === 1 ? '' : 's'} can store WAITLISTED rows after capacity is reached; automatic promotion is not armed.`
					: 'Waitlist storage is not enabled for the current event posture.',
			boundary: formatGateEvidence(eventWaitlistGate, {
				prefix:
					'Keep promotion dependency-first until event-triggered workflow side effects can promote the next row.',
				density: 'operator'
			}),
			gate: eventWaitlistGate,
			metric: {
				value: waitlistEnabledCount > 0 ? waitlistEnabledCount : null,
				label: 'waitlist-enabled',
				cite: 'events.waitlistEnabled'
			}
		},
		{
			id: 'checkin-attendance-signal',
			label: 'Check-in attendance signal',
			state: checkinState,
			phase: 'AGGREGATE',
			clusters: 'C-verification / C-coordination-integrity',
			href: hrefFor('checkin-attendance-signal'),
			action: checkinState === 'gated' ? 'read check-in boundary' : 'read check-ins',
			handoff: 'Attendance signal',
			ground:
				checkinState === 'gated'
					? 'Check-in code is not visible to this role; verified-attendance operations should not be claimed.'
					: `${verifiedAttendeeCount} verified attendee signal${verifiedAttendeeCount === 1 ? '' : 's'} are loaded as code-bound attendance evidence; QR and mDL/ZK attendance ceremony are not mounted.`,
			boundary: formatGateEvidence(attendanceProofGate, {
				prefix: 'Keep check-in code-bound until wallet-backed attendance proof lands.',
				density: 'operator'
			}),
			gate: attendanceProofGate,
			metric: {
				value: verifiedAttendeeCount,
				label: 'verified attendees',
				cite: 'events.verifiedAttendees'
			}
		},
		{
			id: 'calendar-roster-artifacts',
			label: 'Calendar and roster artifacts',
			state: artifactState,
			phase: 'AGGREGATE',
			clusters: 'C-data-sovereignty / C-accountability',
			href: hrefFor('calendar-roster-artifacts'),
			action:
				artifactState === 'partial'
					? context === 'detail'
						? 'export records'
						: 'open records'
					: 'save first',
			handoff: 'Event artifacts',
			ground:
				artifactState === 'partial'
					? context === 'detail'
						? `${visibleRsvpRows ?? rsvpCount} visible roster row${(visibleRsvpRows ?? rsvpCount) === 1 ? '' : 's'} can be exported as bounded CSV evidence; ICS exports the event record.`
						: 'Per-event ICS and non-PII attendance CSV exports are mounted after event records exist.'
					: 'ICS and non-PII attendance CSV exports are mounted only after the event record exists.',
			boundary: formatGateEvidence(eventArtifactGate, {
				prefix:
					'Keep export claims bounded to ICS and non-PII CSV until archived artifact proof lands.',
				density: 'operator'
			}),
			gate: eventArtifactGate,
			metric: {
				value: context === 'detail' ? visibleRsvpRows : recordCount > 0 ? recordCount : null,
				label: context === 'detail' ? 'visible rows' : 'exportable records',
				cite: context === 'detail' ? 'events.getRsvps' : 'event detail ICS/CSV routes'
			}
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const boundaryCount = rows.length - liveCount;
	const heldRows = rows.filter((row) => row.state === 'draft-only' || row.state === 'gated');
	const firstHeldRow = heldRows[0] ?? null;
	const state: CapabilityState =
		liveCount === rows.length
			? 'live'
			: rows.some((row) => row.state === 'live' || row.state === 'partial')
				? 'partial'
				: 'draft-only';
	const nextGate =
		firstHeldRow?.gate ??
		highestDownstreamGate([eventWaitlistGate, attendanceProofGate, eventArtifactGate]);

	return {
		rows,
		state,
		signal: `${recordCount} records · ${publishedCount} published · ${rsvpCount} RSVPs`,
		effect:
			'Event readiness separates saved event records, public RSVP intake, waitlist storage, code-bound attendance, and bounded calendar/roster artifacts.',
		detail: `${recordCount} event records, ${publishedCount} published events, ${draftCount} drafts, ${rsvpCount} stored RSVPs, ${event.attendeeCount ?? 0} attendee signals, ${verifiedAttendeeCount} verified attendee signals, and ${waitlistEnabledCount} waitlist-enabled records are visible as event evidence.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate,
		href: firstHeldRow?.href ?? `${base}/events#event-records`,
		action: firstHeldRow?.action ?? 'read event posture',
		handoff: firstHeldRow?.handoff ?? 'Event records',
		metric: {
			value: recordCount,
			label: 'event records',
			cite: 'events.list'
		},
		liveCount,
		boundaryCount,
		rowCount: rows.length
	};
}

export function buildSignedWebhookReadiness(
	input: SignedWebhookReadinessInputs
): SignedWebhookReadinessSummary {
	const { base, webhooks } = input;
	const { eventRecordsGate, readerOfficeGate, webhookArchiveGate } = input.gates;
	const endpointCount = webhooks.endpointCount;
	const activeEndpointCount = webhooks.activeEndpointCount;
	const pausedEndpointCount = endpointCount - activeEndpointCount;
	const recentDeliveryCount = webhooks.recentDeliveryCount;
	const eventSubstrateLive = eventRecordsGate.state === 'live';
	const endpointState: CapabilityState =
		activeEndpointCount > 0 && eventSubstrateLive
			? 'live'
			: endpointCount > 0
				? 'partial'
				: 'draft-only';
	const deliveryRegisterState: CapabilityState =
		recentDeliveryCount > 0
			? webhooks.deadCount > 0 || webhooks.retryingCount > 0 || !eventSubstrateLive
				? 'partial'
				: 'live'
			: endpointCount > 0
				? 'partial'
				: 'draft-only';

	const rows: SignedWebhookReadinessRow[] = [
		{
			id: 'signed-event-substrate',
			label: 'Signed event substrate',
			state: eventRecordsGate.state,
			phase: 'AGGREGATE',
			clusters: 'C-composability / C-coordination-integrity',
			href: `${base}/settings/webhooks#signed-event-ground`,
			action: eventSubstrateLive ? 'read signature contract' : 'read event-substrate boundary',
			handoff: 'Signed event delivery',
			ground:
				'Org events are written to orgEvents and delivered as HMAC-signed POSTs when a matching endpoint exists.',
			boundary: formatGateEvidence(eventRecordsGate, {
				complete:
					'Event emission, signed delivery, retry, response detection, and SSE polling are armed.',
				density: 'operator'
			}),
			gate: eventRecordsGate,
			metric: {
				value: webhooks.eventKindCount,
				label: 'event kinds',
				cite: 'orgWebhooks SESSION_ALLOWED_EVENTS'
			}
		},
		{
			id: 'endpoint-custody',
			label: 'Endpoint custody',
			state: endpointState,
			phase: 'AGGREGATE',
			clusters: 'C-data-sovereignty / C-composability',
			href: `${base}/settings/webhooks#webhook-endpoints`,
			action: activeEndpointCount > 0 ? 'manage endpoints' : 'add endpoint',
			handoff: 'Endpoint custody',
			ground:
				endpointCount > 0
					? `${endpointCount} endpoint rows are org-scoped; ${activeEndpointCount} enabled, ${pausedEndpointCount} paused, and ${webhooks.subscribedEventCount} event subscriptions are configured.`
					: 'No endpoint row exists yet; Commons cannot deliver org events to an external system until one is added.',
			boundary:
				endpointCount > 0
					? 'Endpoint rows are org-scoped; signing secrets are shown only on create or rotation.'
					: 'Add an endpoint before Commons can deliver events to external systems.',
			gate: eventRecordsGate,
			metric: {
				value: endpointCount,
				label: 'endpoints',
				cite: 'orgWebhooks.sessionListWebhooks'
			}
		},
		{
			id: 'delivery-attempt-register',
			label: 'Delivery attempt register',
			state: deliveryRegisterState,
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-composability',
			href: `${base}/settings/webhooks#webhook-delivery-evidence`,
			action: recentDeliveryCount > 0 ? 'read attempts' : 'read delivery boundary',
			handoff: 'Webhook delivery evidence',
			ground:
				recentDeliveryCount > 0
					? `${recentDeliveryCount} recent sender-side attempts are loaded; ${webhooks.deliveredCount} delivered, ${webhooks.retryingCount} retrying, and ${webhooks.deadCount} dead-lettered. Receiver processing is not claimed.`
					: 'Delivery attempts appear only after an eligible org event matches a configured endpoint.',
			boundary:
				recentDeliveryCount > 0
					? formatGateEvidence(eventRecordsGate, {
							complete:
								'Delivery attempts are loaded from the retry log; receiver-side processing remains outside Commons.',
							density: 'operator'
						})
					: 'Attempts appear after an eligible org event matches a configured endpoint.',
			gate: eventRecordsGate,
			metric: {
				value: recentDeliveryCount,
				label: 'recent attempts',
				cite: 'orgWebhooks.sessionListRecentDeliveries'
			}
		},
		{
			id: 'reader-office-notification-boundary',
			label: 'Reader-office notification boundary',
			state: 'gated',
			phase: 'SEND',
			clusters: 'C-reader-side / C-accountability',
			href: `${base}/settings/webhooks#reader-notification-boundary`,
			action: 'read notification boundary',
			handoff: 'Reader-office notifications',
			ground:
				'Signed webhooks can feed external systems now; Commons-owned reader-office notifications are a separate consumer path.',
			boundary: formatGateEvidence(readerOfficeGate, {
				prefix:
					'Keep endpoint delivery separate from reader-office notification claims until the reader-side consumer lands.',
				density: 'operator'
			}),
			gate: readerOfficeGate
		},
		{
			id: 'durable-event-archive-boundary',
			label: 'Durable event archive boundary',
			state: 'gated',
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-data-sovereignty',
			href: `${base}/settings/webhooks#webhook-archive-boundary`,
			action: 'read archive boundary',
			handoff: 'Event archive proof',
			ground:
				'Webhook delivery rows are operational evidence; they are not Merkle-anchored durable accountability receipts.',
			boundary: formatGateEvidence(webhookArchiveGate, {
				prefix:
					'Keep delivery logs bounded to operational evidence until anchored event receipts are implemented.',
				density: 'operator'
			}),
			gate: webhookArchiveGate
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const boundaryCount = rows.length - liveCount;
	const heldRows = rows.filter((row) => row.state === 'draft-only' || row.state === 'gated');
	const firstHeldRow = heldRows[0] ?? null;
	const state: CapabilityState =
		liveCount === rows.length
			? 'live'
			: rows.some((row) => row.state === 'live' || row.state === 'partial')
				? 'partial'
				: 'draft-only';

	return {
		rows,
		state,
		signal: `${endpointCount} endpoints · ${recentDeliveryCount} attempts · ${webhooks.failureCount} failures`,
		effect:
			'Signed webhook readiness separates event emission substrate, endpoint custody, sender-side delivery attempts, reader-office notification claims, and archive-grade receipt proof.',
		detail: `${endpointCount} endpoint rows, ${activeEndpointCount} enabled endpoints, ${webhooks.subscribedEventCount} event subscriptions, ${recentDeliveryCount} recent delivery attempts, ${webhooks.deliveredCount} delivered attempts, ${webhooks.retryingCount} retrying attempts, ${webhooks.deadCount} dead-letter attempts, and ${webhooks.failureCount} endpoint failures are visible as sender-side webhook evidence.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate: firstHeldRow?.gate ?? highestDownstreamGate([readerOfficeGate, webhookArchiveGate]),
		href: firstHeldRow?.href ?? `${base}/settings/webhooks#signed-event-ground`,
		action: firstHeldRow?.action ?? 'read signed event posture',
		handoff: firstHeldRow?.handoff ?? 'Signed event delivery',
		metric: {
			value: endpointCount,
			label: 'endpoints',
			cite: 'orgWebhooks.sessionListWebhooks'
		},
		liveCount,
		boundaryCount,
		rowCount: rows.length,
		endpointCount,
		recentDeliveryCount
	};
}

export function buildOperatingAuthorityReadiness(
	input: OperatingAuthorityReadinessInputs
): OperatingAuthorityReadinessSummary {
	const { base, authority } = input;
	const { eventRecordsGate, customDomainGate, mainnetGate, auditLogGate } = input.gates;
	const memberCount = authority.memberCount;
	const inviteCount = authority.inviteCount;
	const seatUse =
		memberCount === null ? null : memberCount + (inviteCount !== null ? inviteCount : 0);
	const planLimitLoaded = authority.maxVerifiedActions !== null || authority.maxEmails !== null;
	const eventRecordCount = eventRecordsGate.completed;
	const registryIsTestnet = authority.registryEnvironment.toLowerCase().includes('testnet');
	const registryState: CapabilityState =
		mainnetGate.state === 'live' && !registryIsTestnet ? 'live' : 'partial';
	const webhookState: CapabilityState = eventRecordsGate.state;
	const encryptionState: CapabilityState =
		authority.encryptionConfigured === true
			? 'live'
			: authority.encryptionConfigured === false
				? 'partial'
				: 'partial';
	const planFeatureBoundary = formatGateEvidence(customDomainGate, {
		prefix:
			'Custom sending domains remain dependency-first; SQL mirror and white-label stay plan-boundary entries rather than armed benefits.',
		complete:
			'Custom sending domains have sender-domain ground; SQL mirror and white-label still need separate implementation proof.',
		density: 'operator'
	});

	const rows: OperatingAuthorityReadinessRow[] = [
		{
			id: 'publish-authority',
			label: 'Publish authority',
			state: authority.canPublish ? 'live' : 'gated',
			phase: 'AUTHOR',
			clusters: 'C-coordination-integrity',
			href: `${base}/settings#team-authority`,
			action: authority.canPublish ? 'open org authority' : 'read authority boundary',
			handoff: 'Org authority',
			ground: authority.canPublish
				? `${authority.role} role can author and publish through guarded routes.`
				: `${authority.role} role can inspect, but publish routes require owner or editor authority.`,
			boundary:
				'Role is displayed by the persistent shell; enforcement remains in route/server mutations.',
			metric: {
				value: authority.canPublish ? 1 : 0,
				label: 'publish role',
				cite: 'layout membership.role'
			}
		},
		{
			id: 'team-seat-authority',
			label: 'Team seats and invites',
			state: authority.canInvite ? 'live' : 'gated',
			phase: 'AUTHOR',
			clusters: 'C-coordination-integrity',
			href: `${base}/settings#team-authority`,
			action: authority.canInvite ? 'invite member' : 'read team',
			handoff: 'Team authority',
			ground:
				seatUse !== null && authority.maxSeats !== null
					? `${seatUse}/${authority.maxSeats} seats are visible before invite send.`
					: 'Team authority is visible; exact seat use is loaded on Org authority.',
			boundary:
				'Owner or editor role required to invite; plan seats gate additional members before mutation.',
			metric: {
				value: seatUse,
				label: 'seats used',
				cite: 'organizations.getSettingsData members + invites'
			}
		},
		{
			id: 'role-removal-authority',
			label: 'Role and removal authority',
			state: authority.isOwner ? 'live' : 'gated',
			phase: 'AUTHOR',
			clusters: 'C-coordination-integrity',
			href: `${base}/settings#team-authority`,
			action: authority.isOwner ? 'change roles' : 'read guard',
			handoff: 'Member authority',
			ground: authority.isOwner
				? 'Owner controls can update roles and remove members through guarded mutations.'
				: 'Role changes and removals are visible as a guard, not an available action.',
			boundary:
				'Owner role required; rank ceilings and last-owner lockout prevent orphaning the org.',
			metric: {
				value: memberCount,
				label: 'members',
				cite: 'organizations.removeMember/updateMemberRole'
			}
		},
		{
			id: 'owner-transfer-ceremony',
			label: 'Owner transfer ceremony',
			state: 'gated',
			phase: 'AUTHOR',
			clusters: 'C-coordination-integrity / C-accountability',
			href: `${base}/settings#team-authority`,
			action: 'read transfer boundary',
			handoff: 'Owner succession',
			ground:
				'Owner role changes are guarded, but Commons does not yet expose an explicit transfer-owner ceremony.',
			boundary: formatGateEvidence(auditLogGate, {
				prefix:
					'Owner transfer needs queryable audit events before succession can be presented as an accountable ceremony.',
				density: 'operator'
			}),
			metric: {
				value: null,
				label: 'transfer ceremonies',
				cite: 'ORG-CAPABILITY-SCOPE no transfer-owner ceremony'
			}
		},
		{
			id: 'org-audit-log',
			label: 'Org audit log',
			state: auditLogGate.state === 'live' ? 'partial' : 'gated',
			phase: 'AGGREGATE',
			clusters: 'C-accountability / C-coordination-integrity / C-data-sovereignty',
			href: `${base}/settings#org-authority`,
			action: auditLogGate.state === 'live' ? 'read activity evidence' : 'read audit boundary',
			handoff: 'Authority evidence',
			ground: 'No org-level who-did-what-when audit log is queryable from the org surface today.',
			boundary: formatGateEvidence(auditLogGate, {
				prefix:
					'AuditEvents table, mutation writes, retention, and API/query surface remain the accountable authority gate.',
				complete:
					'AuditEvents substrate is present; retention policy and route-local surfacing still determine the claim scope.',
				density: 'operator'
			}),
			metric: {
				value: auditLogGate.completed,
				label: 'audit tasks complete',
				cite: auditLogGate.source
			}
		},
		{
			id: 'plan-limits',
			label: 'Plan limits',
			state: planLimitLoaded ? 'live' : 'partial',
			phase: 'SEND',
			clusters: 'C-coordination-integrity',
			href: `${base}/settings#plan-limits`,
			action: 'read limits',
			handoff: 'Billing limits',
			ground: planLimitLoaded
				? `${authority.planName ?? 'current'} plan limits are loaded from the billing limit query.`
				: 'Plan limit enforcement exists, but exact quota counts are loaded on Org authority.',
			boundary:
				authority.planStatus && authority.planStatus !== 'active'
					? `Billing status is ${authority.planStatus}; quota facts are enforcement data, not marketing copy.`
					: 'Quotas and seats are live enforcement; unarmed tier features stay separate.',
			metric: {
				value: authority.maxVerifiedActions,
				label: 'verified action cap',
				cite: 'subscriptions.checkPlanLimits'
			}
		},
		{
			id: 'plan-feature-boundary',
			label: 'Plan feature boundary',
			state: 'partial',
			phase: 'SEND',
			clusters: 'C-data-sovereignty / C-reach',
			href: `${base}/settings#plan-feature-boundary`,
			action: 'read tier boundary',
			handoff: 'Tier feature posture',
			ground:
				'SMS quota, A/B setup, custom domains, SQL mirror, coalition layer, and white-label entries must carry their current capability state.',
			boundary: planFeatureBoundary,
			metric: {
				value: authority.maxEmails,
				label: 'email cap',
				cite: 'subscriptions.checkPlanLimits'
			}
		},
		{
			id: 'public-api-ground',
			label: 'Public API ground',
			state: authority.publicApiEnabled ? 'live' : 'gated',
			phase: 'AGGREGATE',
			clusters: 'C-composability / C-data-sovereignty',
			href: `${base}/settings#developer-ground`,
			action: authority.publicApiEnabled ? 'open API docs' : 'read API boundary',
			handoff: 'Developer ground',
			ground: authority.publicApiEnabled
				? 'OpenAPI v1 and key-backed REST routes are available as developer ground.'
				: 'Public API is not armed; developer API surface claims stay dependency-first until the feature gate opens.',
			boundary:
				'API docs and key routes do not own signed event delivery; orgEvents and webhook/SSE posture are tracked by the signed-webhook row.',
			metric: {
				value: authority.publicApiEnabled ? 1 : 0,
				label: 'API surface',
				cite: 'FEATURES.PUBLIC_API'
			}
		},
		{
			id: 'signed-webhooks',
			label: 'Signed webhooks',
			state: webhookState,
			phase: 'AGGREGATE',
			clusters: 'C-composability / C-reader-side',
			href: `${base}/settings/webhooks#signed-event-ground`,
			action: webhookState === 'live' ? 'manage webhooks' : 'read webhook boundary',
			handoff: 'Signed event delivery',
			ground:
				'Org event subscribers use HMAC-signed deliveries, retries, secret rotation, and event-backed polling; this is event substrate, not a public API toggle.',
			boundary: formatGateEvidence(eventRecordsGate, {
				complete:
					'Event emission, signed delivery, retry, response detection, and SSE polling are armed.',
				density: 'operator'
			}),
			metric: {
				value: eventRecordCount,
				label: 'event tasks complete',
				cite: 'CP-outbound-webhooks'
			}
		},
		{
			id: 'pii-encryption-authority',
			label: 'PII encryption authority',
			state: encryptionState,
			phase: 'GROUND',
			clusters: 'C-data-sovereignty',
			href: `${base}/settings#encryption-authority`,
			action: authority.encryptionConfigured ? 'read key' : 'configure key',
			handoff: 'Org-key custody',
			ground: authority.encryptionConfigured
				? 'Org-held encryption key custody is configured for PII and invite workflows.'
				: 'Encrypted workflows can be shaped, but this org still needs key setup or unlock.',
			boundary:
				'Device unlock controls local plaintext access; server-side sealed-key readiness remains separate.',
			metric: {
				value:
					authority.encryptionConfigured === null ? null : authority.encryptionConfigured ? 1 : 0,
				label: 'org key configured',
				cite: 'organizations.getOrgKeyVerifier'
			}
		},
		{
			id: 'registry-environment',
			label: 'Registry environment',
			state: registryState,
			phase: 'AGGREGATE',
			clusters: 'C-verification / C-data-sovereignty',
			href: `${base}/studio#capability-critical-path`,
			action: registryState === 'live' ? 'read registry ground' : 'read registry boundary',
			handoff: 'Registry ground',
			ground: `RegistryMark currently reads ${authority.registryEnvironment}.`,
			boundary: formatGateEvidence(mainnetGate, {
				prefix: 'Production receipt anchoring and public-chain permanence remain bounded.',
				complete: 'Mainnet registry ground is live.',
				density: 'operator'
			}),
			metric: {
				value: registryState === 'live' ? 1 : 0,
				label: 'mainnet registry',
				cite: 'RegistryMark + CP-mainnet-deployment'
			}
		}
	];
	const liveCount = rows.filter((row) => row.state === 'live').length;
	const boundaryCount = rows.length - liveCount;
	const nextGate = highestDownstreamGate([
		eventRecordsGate,
		customDomainGate,
		mainnetGate,
		auditLogGate
	]);
	const state: CapabilityState =
		liveCount === rows.length
			? 'live'
			: rows.some((row) => row.state === 'live' || row.state === 'partial')
				? 'partial'
				: 'gated';

	return {
		rows,
		state,
		signal: `${liveCount}/${rows.length} authority contracts · ${authority.role}`,
		effect:
			'Operating authority separates role power, team seats, owner succession, auditability, billing limits, API/webhooks, org-key custody, tier boundaries, and registry posture so org ground never collapses into settings chrome.',
		detail:
			seatUse !== null && authority.maxSeats !== null
				? `${seatUse}/${authority.maxSeats} seats, ${authority.planName ?? 'current'} plan, API ${
						authority.publicApiEnabled ? 'on' : 'off'
					}, registry ${authority.registryEnvironment}.`
				: `${authority.role} role, API ${authority.publicApiEnabled ? 'on' : 'off'}, registry ${
						authority.registryEnvironment
					}; exact team and quota counts are loaded on Org authority.`,
		gate: rows.map((row) => row.boundary).join(' '),
		nextGate,
		href: `${base}/settings#org-authority`,
		action: state === 'gated' ? 'read authority boundary' : 'read operating authority',
		handoff: 'Operating ground',
		metric: {
			value: seatUse,
			label: 'seats used',
			cite: 'members + invites'
		},
		liveCount,
		boundaryCount,
		rowCount: rows.length
	};
}

export function buildGateRegisterRows(input: GateRegisterInputs): GateRegisterRow[] {
	const { features, gates } = input;
	const {
		eventRecordsGate,
		platformApiGate,
		emailProxyGate,
		smsDispatchGate,
		donationReceiptGate,
		abAutomationGate,
		civicGeographyLabelsGate,
		workflowEffectsGate,
		congressionalLaunchGate,
		mainnetGate,
		teeGate,
		studioJurisdictionScopeGate,
		messageProofGate,
		delegationGate,
		readerOfficeGate
	} = gates;

	return [
		{
			id: 'event-emission-records',
			name: 'Event emission records',
			state: eventRecordsGate.state,
			gate: eventRecordsGate,
			blocks:
				'No current map claim is blocked; orgEvents, signed webhooks, and SSE can be treated as live ground.',
			unlocks: eventRecordsGate.semantics
		},
		{
			id: 'platform-api-sync',
			name: 'Direct platform sync',
			state: platformApiGate.state,
			gate: platformApiGate,
			blocks:
				'Direct platform import remains gated; CSV export recognition is live while encrypted custody and direct sync execution are unfinished.',
			unlocks: platformApiGate.semantics
		},
		{
			id: 'email-send-proxy',
			name: 'Email send proxy',
			state: emailProxyGate.state,
			gate: emailProxyGate,
			blocks:
				'Server-side composer send, reliable client-direct proxy receipts, workflow email steps, List-Unsubscribe hardening, and digest emails.',
			unlocks: emailProxyGate.semantics
		},
		{
			id: 'text-carrier-dispatch',
			name: 'Text carrier dispatch',
			state: smsDispatchGate.state,
			gate: smsDispatchGate,
			blocks: 'Carrier text side effects; text routes remain draft and history surfaces only.',
			unlocks: smsDispatchGate.semantics
		},
		{
			id: 'donation-receipt-compliance',
			name: 'Donation receipt compliance',
			state: donationReceiptGate.state,
			gate: donationReceiptGate,
			blocks:
				'Tax receipt posture, anchored donor receipt proof, and archive-grade fundraising receipts.',
			unlocks: donationReceiptGate.semantics
		},
		{
			id: 'ab-automated-continuation',
			name: 'A/B automated continuation',
			state: abAutomationGate.state,
			gate: abAutomationGate,
			blocks:
				'Production A/B side effects; exact test-cohort and remainder queue hooks remain held by the server-dispatch gate.',
			unlocks: abAutomationGate.semantics
		},
		{
			id: 'civic-geography-labels',
			name: 'Civic geography labels',
			state: civicGeographyLabelsGate.state,
			gate: civicGeographyLabelsGate,
			blocks:
				'Verified/materialized local and special district segment filters; imported state/congressional labels, hash, postal, and country filters remain the usable path.',
			unlocks: civicGeographyLabelsGate.semantics
		},
		{
			id: 'bounded-workflow-runner',
			name: 'Bounded workflow runner',
			state: workflowEffectsGate.state,
			gate: workflowEffectsGate,
			blocks:
				'Non-email workflow side effects stay dependency-first; workflow email stays represented by the email proxy/runtime dependency boundary.',
			unlocks: workflowEffectsGate.semantics
		},
		{
			id: 'congressional-delivery-launch',
			name: 'Congressional delivery launch',
			state: congressionalLaunchGate.state,
			gate: congressionalLaunchGate,
			blocks:
				'CWC delivery action; congressional routes stay context-only while the launch flag is false.',
			unlocks: congressionalLaunchGate.semantics
		},
		{
			id: 'mainnet-settlement-anchoring',
			name: 'Mainnet settlement and anchoring',
			state: mainnetGate.state,
			gate: mainnetGate,
			blocks:
				'Production receipt anchoring, real DebateMarket economics, and public-chain permanence.',
			unlocks: mainnetGate.semantics
		},
		{
			id: 'tee-attestation-path',
			name: 'TEE attestation path',
			state: teeGate.state,
			gate: teeGate,
			blocks: 'TEE-attested resolver execution and AI panel verdict provenance.',
			unlocks: teeGate.semantics
		},
		{
			id: 'full-jurisdiction-resolution',
			name: 'Full jurisdiction resolution',
			state: studioJurisdictionScopeGate.state === 'live' ? 'live' : 'partial',
			gate: studioJurisdictionScopeGate,
			blocks:
				'Claiming Studio can resolve every state, local, special-district, and international target from message scope.',
			unlocks: studioJurisdictionScopeGate.semantics
		},
		{
			id: 'message-proof-binding',
			name: 'Artifact proof binding',
			state: messageProofGate.state === 'live' ? 'live' : 'partial',
			gate: messageProofGate,
			blocks:
				'Proof-attached AI drafts, durable process persistence, and autonomous action provenance.',
			unlocks: messageProofGate.semantics
		},
		{
			id: 'delegated-civic-action',
			name: 'Delegated civic action',
			state: features.DELEGATION ? 'partial' : delegationGate.state,
			gate: delegationGate,
			blocks:
				'Autonomous action, proof-attached AI drafts, grant review, and delegation trace observability.',
			unlocks: delegationGate.semantics
		},
		{
			id: 'reader-office-integration',
			name: 'Reader office integration',
			state: readerOfficeGate.state,
			gate: readerOfficeGate,
			blocks:
				'Reader-office surface, office integration feed, webhook notifier, and weekly digest.',
			unlocks: readerOfficeGate.semantics
		}
	];
}

export function summarizeGateRegister(rows: GateRegisterRow[]): GateRegisterSummary {
	const unresolvedRows = rows.filter((row) => row.gate.status !== 'completed');
	const loadBearingGate = unresolvedRows.reduce<GateRegisterRow | null>(
		(current, row) => (!current || row.gate.downstream > current.gate.downstream ? row : current),
		null
	);

	return {
		completedCount: rows.filter((row) => row.gate.status === 'completed').length,
		unresolvedCount: unresolvedRows.length,
		loadBearingGate,
		loadBearingGateSummary: loadBearingGate
			? formatGateEvidence(loadBearingGate.gate, {
					prefix: 'The highest fan-out unresolved gate remains load-bearing.',
					density: 'operator'
				})
			: 'No unresolved task gate.'
	};
}

export function buildCriticalPathRows(input: CriticalPathInputs): CriticalPathRow[] {
	const {
		eventRecordsGate,
		mainnetGate,
		teeGate,
		studioJurisdictionScopeGate,
		messageProofGate,
		delegationGate,
		readerOfficeGate
	} = input.gates;

	return [
		{
			id: 'event-emission-substrate',
			order: 1,
			name: 'Event emission substrate',
			state: eventRecordsGate.state,
			gate: eventRecordsGate,
			today: 'Org events, signed webhooks, and route-level event artifacts are usable ground.',
			lift: 'Reader notifications, receipt response detection, and coalition trigger paths can build on the completed event stream.',
			dependency: eventRecordsGate.dependency,
			elapsed: '3 days engineering',
			clusters: 'reader-side UX / accountability / composability'
		},
		{
			id: 'mainnet-settlement',
			order: 2,
			name: 'Mainnet settlement',
			state: mainnetGate.state,
			gate: mainnetGate,
			today:
				'Sepolia and local trust marks stay honest; permanent receipt, registry, and market claims remain bounded.',
			lift: 'Mainnet DistrictRegistry, DebateMarket, SnapshotAnchor, receipt roots, and browser verification move from testnet posture into durable proof.',
			dependency: 'Audit, Safe setup, verifier deployment, model keys, Scroll gas, and Scroll USDC',
			elapsed: '2-4 weeks ops',
			clusters: 'verification / quality signaling / accountability / data sovereignty'
		},
		{
			id: 'tee-attestation-path',
			order: 3,
			name: 'TEE attestation path',
			state: teeGate.state,
			gate: teeGate,
			today:
				'Resolver execution and AI verdict trust remain platform-local rather than enclave-attested.',
			lift: 'Constituent resolution, AI panel verdicts, and privacy-preserving position paths gain attestable execution evidence.',
			dependency:
				'Nitro account, enclave image, PCR0 manifest, vsock proxy, and attestation verifier',
			elapsed: '3 weeks elapsed',
			clusters: 'verification / quality signaling / agentic systems'
		},
		{
			id: 'full-jurisdiction-resolution',
			order: 4,
			name: 'Full jurisdiction resolution',
			state: studioJurisdictionScopeGate.state,
			gate: studioJurisdictionScopeGate,
			today:
				'Studio passes explicit scope into message grounding, but state, local, special-district, and international coverage stay bounded.',
			lift: 'Scope changes from heuristic authoring boundary into routed multi-jurisdiction reach across Power and Studio.',
			dependency: studioJurisdictionScopeGate.dependency,
			elapsed: 'phase-2 data',
			clusters: 'reach / data sovereignty / accountability'
		},
		{
			id: 'message-proof-binding',
			order: 5,
			name: 'Artifact proof binding',
			state: messageProofGate.state,
			gate: messageProofGate,
			today:
				'Studio can recover authored artifacts on the same device; authored-artifact proof is not attached to every draft.',
			lift: 'Drafted artifacts carry writer provenance, proof attachment, and durable process evidence into delegated action.',
			dependency: 'Drafted message table before writer proof binding',
			elapsed: '1.5-2 weeks first lift',
			clusters: 'agentic systems / verification / reader-side UX'
		},
		{
			id: 'delegated-agent-action',
			order: 6,
			name: 'Delegated agent action',
			state: delegationGate.state,
			gate: delegationGate,
			today:
				'Operator-initiated authoring is live; autonomous civic action remains outside the armed surface.',
			lift: 'The executor can act inside verified constituent authority, attach proofs, and emit auditable agent traces.',
			dependency: 'ZK proof attachment first, then delegation executor',
			elapsed: '5-6 weeks combined',
			clusters: 'agentic systems / verification / coordination integrity'
		},
		{
			id: 'reader-office-loop',
			order: 7,
			name: 'Reader office loop',
			state: readerOfficeGate.state,
			gate: readerOfficeGate,
			today:
				'Reader proof previews and independent verifier paths exist; office profiles, dashboards, and notifications are not armed.',
			lift: 'Verified actions can enter office-facing surfaces with response notifications and reader-side accountability context.',
			dependency: readerOfficeGate.dependency,
			elapsed: 'partnership track',
			clusters: 'reader-side UX / accountability / composability'
		}
	];
}

export function summarizeCriticalPath(rows: CriticalPathRow[]): CriticalPathSummary {
	const unresolvedRows = rows.filter((row) => row.gate.status !== 'completed');
	const loadBearingRow = unresolvedRows.reduce<CriticalPathRow | null>(
		(current, row) => (!current || row.gate.downstream > current.gate.downstream ? row : current),
		null
	);

	return {
		liveCount: rows.length - unresolvedRows.length,
		unresolvedCount: unresolvedRows.length,
		state: unresolvedRows.length > 0 ? 'partial' : 'live',
		loadBearingRow,
		loadBearingSummary: loadBearingRow
			? formatGateEvidence(loadBearingRow.gate, {
					prefix: `${loadBearingRow.name} is the next critical-path lift.`,
					density: 'operator'
				})
			: 'Critical path clear; no unresolved capability chokepoint row remains.'
	};
}

export function buildEmailDeliveryEvidenceReadiness(
	input: EmailDeliveryEvidenceInputs
): EmailDeliveryEvidenceSummary {
	const { base, blastId, delivery, receiptRegister } = input;
	const {
		emailProxyGate,
		receiptAnchoringGate,
		abAutomationGate,
		listHealthGate,
		engagementTelemetryGate
	} = input.gates;
	const detailHref = `${base}/emails/${blastId}`;
	const receiptRegisterHref = `${detailHref}/receipts`;
	const totalSent = delivery.totalSent;
	const totalOpened = delivery.totalOpened ?? 0;
	const totalClicked = delivery.totalClicked ?? 0;
	const totalBounced = delivery.totalBounced ?? 0;
	const totalComplained = delivery.totalComplained ?? 0;
	const suppressedSignal = totalBounced + totalComplained;
	const receiptPageCount = delivery.receiptPageCount;
	const receiptRegisterRowCount = receiptRegister?.rowCount ?? receiptPageCount;
	const receiptFailedCount = receiptRegister?.failedCount ?? delivery.receiptFailedCount ?? 0;
	const receiptSentCount = receiptRegister?.sentCount ?? delivery.receiptSentCount ?? 0;
	const loadedOutcomeCount = receiptSentCount + receiptFailedCount;
	const receiptHasMore = receiptRegister?.hasMore ?? delivery.receiptHasMore;
	const hasExperimentView = delivery.hasExperimentView === true;
	const serverDispatchRuntimeArmed = delivery.serverDispatchRuntimeArmed === true;
	const hasDraftAbVariant = delivery.hasDraftAbVariant === true;
	const hasQueuedOrSentAbVariant = delivery.hasQueuedOrSentAbVariant === true;
	const hasDraftRemainder = delivery.hasDraftRemainder === true;
	const hasQueuedOrSentRemainder = delivery.hasQueuedOrSentRemainder === true;
	const hasRemainderDraft = delivery.hasRemainderDraft === true;
	const abWinnerPickedAt = delivery.abWinnerPickedAt ?? null;

	const deliveryRecordState: CapabilityState =
		totalSent > 0 ? 'partial' : delivery.status === 'draft' ? 'draft-only' : 'partial';
	const receiptEvidenceState: CapabilityState =
		receiptPageCount > 0 ? 'partial' : totalSent > 0 ? 'gated' : 'draft-only';
	const receiptRegisterState: CapabilityState =
		receiptRegisterRowCount > 0 ? 'partial' : totalSent > 0 ? 'gated' : 'draft-only';
	const outcomeState: CapabilityState =
		loadedOutcomeCount > 0 ? 'partial' : delivery.status === 'draft' ? 'draft-only' : 'gated';
	const privacyState: CapabilityState = receiptRegisterRowCount > 0 ? 'partial' : 'draft-only';
	const engagementTelemetryState: CapabilityState = delivery.engagementMetricsEnabled
		? totalSent > 0
			? 'partial'
			: 'draft-only'
		: 'gated';
	const experimentContinuationState: CapabilityState = !hasExperimentView
		? 'gated'
		: serverDispatchRuntimeArmed && (hasQueuedOrSentAbVariant || hasQueuedOrSentRemainder)
			? 'partial'
			: abWinnerPickedAt && hasRemainderDraft
				? 'partial'
				: 'draft-only';
	const listHealthState: CapabilityState =
		totalSent > 0 || suppressedSignal > 0 ? 'partial' : 'draft-only';

	const engagementTelemetrySummary = delivery.engagementMetricsEnabled
		? formatGateEvidence(engagementTelemetryGate, {
				prefix:
					'Open/click telemetry is visible as engagement evidence; attribution edge cases remain bounded.',
				density: 'operator'
			})
		: formatGateEvidence(engagementTelemetryGate, {
				prefix:
					'Open/click telemetry is not armed for this delivery record. Sent status, receipt rows, and bounce/complaint counters remain countable evidence.',
				density: 'operator'
			});
	const detailReceiptUnlock =
		receiptEvidenceState === 'partial'
			? formatGateEvidence(receiptAnchoringGate, {
					prefix:
						'Per-recipient receipt rows are visible for this record; archive-grade anchoring and office response remain bounded.',
					density: 'operator'
				})
			: formatGateEvidence(emailProxyGate, {
					prefix:
						'Sent counters are not durable receipt rows; keep receipt proof unclaimed until dispatch writes per-recipient outcomes.',
					density: 'operator'
				});
	const registerReceiptUnlock =
		receiptRegisterRowCount > 0
			? formatGateEvidence(receiptAnchoringGate, {
					prefix:
						'Per-recipient delivery rows are visible for this blast; archive-grade anchoring and office response remain bounded.',
					density: 'operator'
				})
			: formatGateEvidence(emailProxyGate, {
					prefix:
						'Sent counters are not receipt rows; keep receipt proof unclaimed until dispatch writes per-recipient outcomes.',
					density: 'operator'
				});

	const detailRows: EmailDeliveryEvidenceRow[] = [
		{
			id: 'delivery-record',
			label: 'Delivery record',
			state: deliveryRecordState,
			phase: 'SEND / AGGREGATE',
			cluster: 'C-reach / C-reader-side',
			href: `${detailHref}#email-record`,
			action: totalSent > 0 ? 'read delivery record' : 'preserve delivery draft',
			handoff: 'Email delivery detail',
			detail:
				totalSent > 0
					? delivery.engagementMetricsEnabled
						? 'The blast record carries sent, open, click, bounce, and complaint counters from email.getBlast; per-recipient receipts are a separate evidence layer.'
						: 'The blast record carries sent plus bounce/complaint counters from email.getBlast; open/click telemetry is a separate gated evidence layer.'
					: 'This record has not produced a sent cohort yet; the page stays in draft/evidence posture.',
			unlock: formatGateEvidence(emailProxyGate, {
				prefix: 'Server-side delivery remains bounded by the proxy and receipt-secret launch gate.',
				density: 'operator'
			}),
			gate: emailProxyGate,
			metric: {
				value: totalSent,
				label: 'sent counter',
				cite: 'email.getBlast totals'
			}
		},
		{
			id: 'engagement-telemetry',
			label: 'Engagement telemetry',
			state: engagementTelemetryState,
			phase: 'AGGREGATE',
			cluster: 'C-accountability / C-reader-side',
			href: `${detailHref}#email-engagement-telemetry`,
			action: delivery.engagementMetricsEnabled
				? 'read engagement telemetry'
				: 'read telemetry boundary',
			handoff: 'Email telemetry',
			detail: delivery.engagementMetricsEnabled
				? totalSent > 0
					? 'Open/click counters are visible as SES engagement telemetry; they are attribution evidence, not proof delivery.'
					: 'No sent cohort exists, so open/click engagement telemetry remains unclaimed.'
				: 'Open/click telemetry is not armed for this delivery record; sent status, receipt rows, and bounce/complaint counters remain countable evidence.',
			unlock: engagementTelemetrySummary,
			gate: engagementTelemetryGate,
			metric: {
				value: delivery.engagementMetricsEnabled ? totalOpened + totalClicked : null,
				label: delivery.engagementMetricsEnabled ? 'open/click events' : 'telemetry events',
				cite: delivery.engagementMetricsEnabled
					? 'email.getBlast open/click totals'
					: 'FEATURES.ENGAGEMENT_METRICS + T2-10'
			}
		},
		{
			id: 'receipt-evidence',
			label: 'Receipt evidence',
			state: receiptEvidenceState,
			phase: 'AGGREGATE',
			cluster: 'C-accountability / C-data-sovereignty',
			href: `${detailHref}#email-receipt-evidence`,
			action: 'read receipt rows',
			handoff: 'Delivery receipt register',
			detail:
				receiptPageCount > 0
					? 'This route loaded a bounded page of per-recipient delivery outcomes for the current blast.'
					: 'No per-recipient delivery receipt row is loaded for this blast; counters alone are not treated as proof.',
			unlock: detailReceiptUnlock,
			gate: receiptEvidenceState === 'partial' ? receiptAnchoringGate : emailProxyGate,
			metric: {
				value: receiptPageCount,
				label: delivery.receiptHasMore ? 'receipts on first page' : 'receipt rows',
				cite: 'email.listReceiptsForBlast'
			}
		},
		{
			id: 'experiment-continuation',
			label: 'Experiment continuation',
			state: experimentContinuationState,
			phase: 'AUTHOR / SEND',
			cluster: 'C-coordination-integrity / C-reader-side',
			href: hasExperimentView
				? `${detailHref}#email-experiment-boundary`
				: `${base}/emails/compose#email-ab-test`,
			action: hasExperimentView
				? abWinnerPickedAt
					? hasRemainderDraft
						? serverDispatchRuntimeArmed && hasDraftRemainder
							? 'queue remainder send'
							: 'open remainder draft'
						: 'create remainder draft'
					: serverDispatchRuntimeArmed && hasDraftAbVariant
						? 'queue test cohorts'
						: 'read experiment boundary'
				: 'read experiment setup',
			handoff: 'A/B continuation',
			detail: hasExperimentView
				? serverDispatchRuntimeArmed
					? 'Linked variants and cohort snapshots can be queued through exact server-dispatch snapshots; already queued or sent rows are not rescheduled.'
					: 'Linked variants and cohort snapshots are inspectable; exact A/B queue hooks preserve drafts until server-dispatch runtime dependencies pass.'
				: 'This delivery is not an A/B group; variants start from the composer boundary.',
			unlock: formatGateEvidence(abAutomationGate, {
				prefix:
					'A/B continuation now has exact runner substrate; production side effects remain preserved drafts until server-dispatch runtime evidence clears.',
				density: 'operator'
			}),
			gate: abAutomationGate,
			metric: {
				value: delivery.abRemainderCount ?? null,
				label: 'held-back remainder',
				cite: 'emailAbTestCohorts'
			}
		},
		{
			id: 'list-health-response',
			label: 'List-health response',
			state: listHealthState,
			phase: 'AGGREGATE',
			cluster: 'C-reach / C-accountability',
			href: `${detailHref}#email-list-health`,
			action: 'read suppression signal',
			handoff: 'People suppression',
			detail:
				suppressedSignal > 0
					? 'Bounce and complaint counters are visible on the delivery record; recipient rows only appear when event evidence is loaded.'
					: 'No bounce or complaint counter is present on this record; no campaign-level complaint metric is invented.',
			unlock: formatGateEvidence(listHealthGate, {
				prefix:
					'Keep complaint/bounce evidence tied to SES correlation and People suppression before claiming complete delivery health.',
				density: 'operator'
			}),
			gate: listHealthGate,
			metric: {
				value: suppressedSignal,
				label: 'bounce/complaint counter',
				cite: 'email.getBlast suppression totals'
			}
		}
	];

	const receiptRegisterRows: EmailDeliveryEvidenceRow[] = [
		{
			id: 'delivery-record',
			label: 'Delivery record context',
			state: deliveryRecordState,
			phase: 'SEND / AGGREGATE',
			cluster: 'C-reach / C-reader-side',
			href: `${detailHref}#email-record`,
			action: totalSent > 0 ? 'read delivery record' : 'preserve delivery draft',
			handoff: 'Email delivery detail',
			detail:
				'Blast totals come from email.getBlast; this route separates those counters from per-recipient receipt rows.',
			unlock: formatGateEvidence(emailProxyGate, {
				prefix: 'Server-side delivery remains bounded by the proxy and receipt-secret launch gate.',
				density: 'operator'
			}),
			gate: emailProxyGate,
			metric: {
				value: totalSent,
				label: 'sent counter',
				cite: 'email.getBlast totals'
			}
		},
		{
			id: 'receipt-register',
			label: 'Receipt row register',
			state: receiptRegisterState,
			phase: 'AGGREGATE',
			cluster: 'C-accountability / C-data-sovereignty',
			href: `${receiptRegisterHref}#email-receipt-register`,
			action: 'read receipt rows',
			handoff: 'Delivery receipt register',
			detail:
				'Loaded rows are immediate send outcomes from emailDeliveryReceipts, not anchored accountability receipts.',
			unlock: registerReceiptUnlock,
			gate: receiptRegisterState === 'partial' ? receiptAnchoringGate : emailProxyGate,
			metric: {
				value: receiptRegisterRowCount,
				label: receiptHasMore ? 'receipt rows on page' : 'receipt rows',
				cite: 'email.listReceiptsForBlast'
			}
		},
		{
			id: 'dispatch-outcomes',
			label: 'Dispatch outcome evidence',
			state: outcomeState,
			phase: 'AGGREGATE',
			cluster: 'C-accountability / C-reach',
			href: `${receiptRegisterHref}#email-dispatch-outcomes`,
			action: loadedOutcomeCount > 0 ? 'read outcomes' : 'await outcomes',
			handoff: 'Delivery outcome rows',
			detail:
				'Status and error fields show the immediate dispatch attempt; bounce, complaint, open, and click events stay separate.',
			unlock: formatGateEvidence(listHealthGate, {
				prefix:
					'Keep post-delivery health signals bounded to SES webhook correlation and People suppression state.',
				density: 'operator'
			}),
			gate: listHealthGate,
			metric: {
				value: receiptFailedCount,
				label: 'failed rows',
				cite: 'emailDeliveryReceipts.status'
			}
		},
		{
			id: 'recipient-privacy',
			label: 'Recipient privacy boundary',
			state: privacyState,
			phase: 'AGGREGATE',
			cluster: 'C-data-sovereignty',
			href: `${receiptRegisterHref}#recipient-hash-boundary`,
			action: receiptRegisterRowCount > 0 ? 'read hashes' : 'await rows',
			handoff: 'Hash-only receipt custody',
			detail:
				'Recipient identity appears as org-scoped email hashes only; plaintext remains encrypted under the org key elsewhere.',
			unlock: formatGateEvidence(receiptAnchoringGate, {
				prefix:
					'Hash-only operator evidence is not a public verification artifact until anchored receipt paths land.',
				density: 'operator'
			}),
			gate: receiptAnchoringGate,
			metric: {
				value: receiptRegisterRowCount,
				label: 'hash rows',
				cite: 'emailDeliveryReceipts.recipientEmailHash'
			}
		},
		{
			id: 'anchored-receipt-proof',
			label: 'Anchored receipt proof',
			state: 'gated',
			phase: 'AGGREGATE',
			cluster: 'C-accountability / C-data-sovereignty',
			href: `${receiptRegisterHref}#email-receipt-anchoring-boundary`,
			action: 'read anchoring boundary',
			handoff: 'Receipt proof boundary',
			detail:
				'This page does not claim Merkle anchoring, reader-office notification, or long-term accountability receipts.',
			unlock: formatGateEvidence(receiptAnchoringGate, {
				prefix:
					'Archive-grade email receipt proof remains dependency-first until receipt anchoring and reader response surfaces land.',
				density: 'operator'
			}),
			gate: receiptAnchoringGate
		}
	];

	const rows = [...detailRows, ...receiptRegisterRows];
	const heldRows = rows.filter((row) => row.state === 'draft-only' || row.state === 'gated');
	const firstHeldRow = heldRows[0] ?? null;
	const state: CapabilityState =
		totalSent <= 0 && delivery.status === 'draft'
			? 'draft-only'
			: heldRows.length > 0
				? 'partial'
				: 'live';
	const metric = {
		value: totalSent,
		label: 'sent counter',
		cite: 'email.getBlast totals'
	};

	return {
		rows,
		detailRows,
		receiptRegisterRows,
		state,
		signal: `${totalSent.toLocaleString('en-US')} sent · ${receiptRegisterRowCount.toLocaleString('en-US')} receipt rows · ${suppressedSignal.toLocaleString('en-US')} suppressed`,
		effect:
			'Email delivery evidence separates delivery counters, per-recipient sender rows, engagement telemetry, list-health signals, experiment continuation, and anchored receipt proof boundaries.',
		detail: `${totalSent} sent counters, ${receiptRegisterRowCount} receipt rows, ${receiptFailedCount} failed receipt rows, ${totalOpened + totalClicked} engagement events, and ${suppressedSignal} bounce/complaint signals are visible as route evidence; stronger receipt proof remains gate-bound.`,
		gate: rows.map((row) => row.unlock).join(' '),
		nextGate: firstHeldRow?.gate ?? receiptAnchoringGate,
		href: firstHeldRow?.href ?? receiptRegisterHref,
		action: firstHeldRow?.action ?? 'read delivery evidence',
		handoff: firstHeldRow?.handoff ?? 'Email delivery evidence',
		metric,
		totalSent,
		suppressedSignal,
		receiptPageCount,
		receiptRegisterRowCount,
		failedReceiptCount: receiptFailedCount
	};
}

export function buildSendReadiness(input: SendReadinessInputs): SendReadinessSummary {
	const {
		base,
		emailDeliveryHref,
		canPublish,
		emailDelivery,
		textDispatch,
		congressionalDelivery,
		fallbackSubscribedCount,
		features,
		gates
	} = input;
	const {
		emailProxyGate,
		abAutomationGate,
		smsDispatchGate,
		eventArtifactGate,
		workflowEffectsGate,
		congressionalLaunchGate
	} = gates;

	const browserDirectState: CapabilityState =
		!canPublish || !emailDelivery || emailDelivery.subscribedCount <= 0
			? 'gated'
			: emailDelivery.subscribedCount >= emailDelivery.clientDirectThreshold
				? 'draft-only'
				: !emailDelivery.orgKeyConfigured || !emailDelivery.sesProxyConfigured
					? 'gated'
					: 'partial';
	const browserDirectSignal = !canPublish
		? 'watch only'
		: !emailDelivery
			? 'email ground unread'
			: emailDelivery.subscribedCount <= 0
				? '0 subscribed'
				: emailDelivery.subscribedCount >= emailDelivery.clientDirectThreshold
					? `${emailDelivery.subscribedCount.toLocaleString('en-US')} over browser cap`
					: !emailDelivery.orgKeyConfigured
						? 'org key missing'
						: !emailDelivery.sesProxyConfigured
							? 'proxy missing'
							: `${emailDelivery.subscribedCount.toLocaleString('en-US')} browser-ready`;
	const browserDirectGate = !canPublish
		? 'Org authority is not attached to this session; delivery drafts can be inspected, but delivery-surface handoffs stay read-only.'
		: !emailDelivery
			? unreadGroundBoundary('Operating email delivery', 'browser-direct send readiness claims')
			: emailDelivery.subscribedCount <= 0
				? 'Import or subscribe people before email delivery can run.'
				: emailDelivery.subscribedCount >= emailDelivery.clientDirectThreshold
					? `Browser-direct send is capped below ${emailDelivery.clientDirectThreshold.toLocaleString('en-US')} recipients.`
					: !emailDelivery.orgKeyConfigured
						? 'Organization key verifier is missing; browser decrypt cannot start.'
						: !emailDelivery.sesProxyConfigured
							? formatGateEvidence(emailProxyGate, {
									prefix:
										'Browser send proxy is not configured; browser-direct delivery remains bounded.',
									density: 'operator'
								})
							: 'Composer still owns merge-token checks, dispatch claim, Lambda proxy, SES receipts, and cohort filters.';
	const browserDirectEffect =
		browserDirectState === 'partial'
			? 'Can create a client-direct draft and send from the browser after message-specific merge checks pass.'
			: !canPublish
				? 'This session can inspect delivery boundaries, while delivery-surface handoffs stay read-only until org authority is present.'
				: browserDirectState === 'draft-only'
					? 'The subscribed cohort is too large for browser-direct delivery; the composer preserves a delivery draft.'
					: 'Browser-direct send is dependency-first until org authority, a subscribed cohort, org key, and SES proxy evidence are present.';

	const clientDirectMergeState: CapabilityState = !features.EMAIL_CLIENT_DIRECT_MERGE
		? 'gated'
		: browserDirectState;
	const clientDirectMergeEffect = !features.EMAIL_CLIENT_DIRECT_MERGE
		? 'Composer can preview merge fields, but direct personalized send is not armed.'
		: browserDirectState === 'partial'
			? 'Personalized browser send resolves supported merge fields after recipient decrypt and uses singleton Lambda calls when tokens are present.'
			: browserDirectState === 'draft-only'
				? 'Merge tokens can be prepared, but the cohort is over the browser-direct cap; the composer preserves a delivery draft.'
				: 'Merge personalization stays dependency-first until org authority, a subscribed cohort, org key, and SES proxy evidence are present.';
	const clientDirectMergeGate = !features.EMAIL_CLIENT_DIRECT_MERGE
		? formatGateEvidence(emailProxyGate, {
				prefix:
					'Client-direct merge personalization stays dependency-first until the merge runner is armed.',
				density: 'operator'
			})
		: clientDirectMergeState === 'partial'
			? formatGateEvidence(emailProxyGate, {
					prefix: 'Client-direct merge is bounded by browser-direct delivery.',
					density: 'operator'
				})
			: browserDirectGate;

	const abAutomationState: CapabilityState = !features.AB_TESTING
		? 'gated'
		: features.EMAIL_SERVER_DISPATCH &&
			  emailDelivery?.serverDispatchRuntimeReady === true &&
			  abAutomationGate.state === 'live'
			? 'live'
			: 'draft-only';
	const serverEmailRuntimeArmed =
		features.EMAIL_SERVER_DISPATCH && emailDelivery?.serverDispatchRuntimeReady === true;
	const congressionalRuntimeReady = congressionalDelivery?.runtimeReady === true;
	const congressionalDeliveryArmed =
		features.CONGRESSIONAL && congressionalRuntimeReady && congressionalLaunchGate.state === 'live';
	const workflowExecutionArmed =
		features.WORKFLOW_EXECUTION && workflowEffectsGate.state === 'live';
	const serverDispatchMissingText = formatRuntimeMissing(
		emailDelivery?.serverDispatchRuntimeMissing
	);
	const serverDispatchBoundary = serverDispatchRuntimeBoundary(emailDelivery, emailProxyGate);
	const textDispatchRuntimeReady = textDispatch?.runtimeReady === true;
	const textDispatchMissingText = formatRuntimeMissing(textDispatch?.runtimeMissing);
	const textDispatchRouteMissing =
		textDispatch?.clientBatchRouteMounted === true
			? (textDispatch.runtimeMissing ?? []).filter((item) => item !== 'browser phone custody')
			: (textDispatch?.runtimeMissing ?? []);
	const textDispatchRouteMissingText = formatRuntimeMissing(textDispatchRouteMissing);
	const textDispatchRouteReady =
		textDispatch?.clientBatchRouteMounted === true && textDispatchRouteMissing.length === 0;
	const textDispatchDependency =
		textDispatch?.runtimeDependency ??
		'text dispatch gate, browser phone custody, Twilio dispatch runner, and transport credentials';
	const textDispatchBoundary = textDispatchRouteReady
		? 'Bulk text dispatch has a bounded detail-route cohort sender; broad composer dispatch remains gate-bound.'
		: (textDispatch?.runtimeMessage ??
			`Bulk text dispatch is dependency-bound. Drafts are preserved; configure ${textDispatchMissingText} before carrier delivery can be armed.`);
	const congressionalMissingText = formatRuntimeMissing(congressionalDelivery?.runtimeMissing);
	const congressionalDependency =
		congressionalDelivery?.runtimeDependency ??
		'congressional launch flag + House CWC proxy env + Senate CWC API env + per-submission proof/template checks';
	const congressionalBoundary =
		congressionalDelivery?.runtimeMessage ??
		`Congressional delivery is dependency-bound; configure ${congressionalMissingText} before CWC side effects can be armed.`;

	const modes: SendReadinessMode[] = [
		{
			key: 'browser-direct',
			label: 'Browser-direct email',
			phase: 'SEND',
			cluster: 'C-reader-side',
			state: browserDirectState,
			route: emailDeliveryHref,
			action:
				browserDirectState === 'partial' ? 'open email composer' : 'read browser-send boundary',
			handoff: 'Email composer',
			effect: browserDirectEffect,
			unlock: browserDirectGate,
			metric: {
				value: emailDelivery?.subscribedCount ?? fallbackSubscribedCount,
				label: 'subscribed cohort',
				cite: 'layout operating.emailDelivery + supporters.getSummaryStats.emailHealth'
			}
		},
		{
			key: 'client-merge',
			label: 'Client-direct merge personalization',
			phase: 'SEND',
			cluster: 'C-reader-side',
			state: clientDirectMergeState,
			route: emailDeliveryHref,
			action:
				clientDirectMergeState === 'partial'
					? 'open merge composer'
					: clientDirectMergeState === 'draft-only'
						? 'preserve merge draft'
						: 'read merge boundary',
			handoff: 'Email composer',
			effect: clientDirectMergeEffect,
			unlock: clientDirectMergeGate
		},
		{
			key: 'server-email',
			label: 'Server-side email dispatch',
			phase: 'SEND',
			cluster: 'C-reader-side',
			state: serverEmailRuntimeArmed ? 'live' : 'draft-only',
			route: emailDeliveryHref,
			action: serverEmailRuntimeArmed ? 'open server dispatch' : 'create delivery draft',
			handoff: 'Email composer',
			effect: serverEmailRuntimeArmed
				? 'Server send can queue large/no-key dispatch after cohort, quota, org-key, SES, and unsubscribe checks pass.'
				: features.EMAIL_SERVER_DISPATCH
					? `The server sender is built, but this runtime preserves drafts until ${serverDispatchMissingText} are configured.`
					: 'Large/no-key paths create or preserve drafts; no server-side send is claimed.',
			unlock: features.EMAIL_SERVER_DISPATCH
				? serverDispatchBoundary
				: formatGateEvidence(emailProxyGate, {
						prefix:
							'Server-side dispatch stays dependency-first until runtime evidence clears; composer sends remain preserved drafts.',
						density: 'operator'
					})
		},
		{
			key: 'ab-automation',
			label: 'A/B experiment continuation',
			phase: 'SEND / AGGREGATE',
			cluster: 'C-coordination-integrity',
			state: abAutomationState,
			route: `${base}/emails#ab-continuation-boundary`,
			action: abAutomationState === 'live' ? 'open experiment runner' : 'read experiment boundary',
			handoff: 'A/B continuation',
			effect:
				abAutomationState === 'live'
					? 'A/B can dispatch exact test cohorts, mark or receive the winner, and continue to the held-back remainder through the armed runner.'
					: features.AB_TESTING
						? 'Variant setup creates linked draft cohorts with a stored remainder; exact test and remainder queue hooks exist, but runtime dependencies keep side effects behind server dispatch.'
						: 'A/B continuation stays dependency-first until the experiment gate opens.',
			unlock:
				abAutomationState === 'live'
					? formatGateEvidence(abAutomationGate, {
							complete:
								'Exact cohort snapshots remain the dispatch contract for automated continuation.',
							density: 'operator'
						})
					: features.AB_TESTING
						? formatGateEvidence(abAutomationGate, {
								prefix:
									'Winner markers, exact remainder drafts, and exact queue hooks exist; automated A/B side effects remain preserved drafts until server-dispatch runtime evidence clears.',
								density: 'operator'
							})
						: 'A/B continuation remains dependency-first until the experiment gate opens.'
		},
		{
			key: 'sms',
			label: 'Text delivery',
			phase: 'SEND / AGGREGATE',
			cluster: 'C-reach',
			state:
				textDispatchRuntimeReady && smsDispatchGate.state === 'live'
					? 'live'
					: textDispatchRouteReady
						? 'partial'
						: 'draft-only',
			route: `${base}/sms#sms-dispatch-boundary`,
			action:
				textDispatchRuntimeReady && smsDispatchGate.state === 'live'
					? 'open text dispatch'
					: textDispatchRouteReady
						? 'open text drafts'
						: 'read text boundary',
			handoff: 'Text dispatch boundary',
			effect:
				textDispatchRuntimeReady && smsDispatchGate.state === 'live'
					? 'Text delivery can dispatch through the armed carrier path after route-local consent, quota, org-key, and carrier checks pass.'
					: textDispatchRouteReady
						? 'Text drafts can save counted audience filters and hand off to bounded browser-dispatched cohort batches; broad carrier delivery remains held by the SMS dispatch gate, carrier evidence, and route-local dispatch checks.'
						: `Text drafts and history are usable; the carrier dispatch boundary stays held until ${textDispatchRouteMissingText} are configured.`,
			unlock: formatGateEvidence(smsDispatchGate, {
				prefix: `${textDispatchBoundary} Dependency: ${textDispatchDependency}.`,
				density: 'operator'
			})
		},
		{
			key: 'events',
			label: 'Event records and artifacts',
			phase: 'AGGREGATE',
			cluster: 'C-data-sovereignty',
			state: features.EVENTS ? 'partial' : 'gated',
			route: `${base}/events#event-export-boundary`,
			action: features.EVENTS ? 'open event artifacts' : 'read event boundary',
			handoff: 'Event records',
			effect: features.EVENTS
				? 'Event routes can publish public RSVP pages and expose per-event ICS plus non-PII attendance CSV artifacts after save.'
				: 'Event artifact claims stay dependency-first until the event-record gate opens; no RSVP or artifact path is claimed.',
			unlock: features.EVENTS
				? formatGateEvidence(eventArtifactGate, {
						prefix: 'Bounded artifacts are live; archive-grade event proof waits on this gate.',
						density: 'operator'
					})
				: formatGateEvidence(eventArtifactGate, {
						prefix:
							'Event records and artifacts stay dependency-first until the event artifact gate opens.',
						density: 'operator'
					})
		},
		{
			key: 'workflow',
			label: 'Workflow side effects',
			phase: 'SEND / AGGREGATE',
			cluster: 'C-agentic',
			state: workflowExecutionArmed ? 'live' : 'draft-only',
			route: `${base}/workflows#workflow-execution-boundary`,
			action: workflowExecutionArmed ? 'open workflow runner' : 'read execution boundary',
			handoff: 'Workflow execution',
			effect: workflowExecutionArmed
				? 'Workflow execution can run tag writes/removals, branch conditions, delay/resume, and saved trigger families; workflow email remains dependency-bound.'
				: 'Definitions can be shaped; tag writes, branches, scheduled resume, saved trigger families, and single-supporter email stay preserved contracts.',
			unlock: formatGateEvidence(workflowEffectsGate, {
				prefix:
					'Coordination definitions can be shaped; side effects stay dependency-first until the bounded runner gate opens.',
				complete:
					'Bounded workflow execution is armed for tag, branch, delay, and trigger side effects.',
				density: 'operator'
			})
		},
		{
			key: 'cwc',
			label: 'CWC congressional delivery',
			phase: 'SEND',
			cluster: 'C-verification',
			state: congressionalDeliveryArmed ? 'live' : 'gated',
			route: `${base}/campaigns/new#proof-delivery-boundary`,
			action: congressionalDeliveryArmed ? 'prepare proof handoff' : 'read proof-delivery boundary',
			handoff: 'Proof delivery',
			effect: congressionalDeliveryArmed
				? 'Congressional delivery transport is armed; submission-local proof, template, witness, chamber, and representative checks still gate every CWC side effect.'
				: congressionalRuntimeReady
					? 'CWC transport runtime is configured, but the congressional launch gate is not live; action routes provide context only.'
					: `CWC XML generation exists, but proof delivery is held until ${congressionalMissingText} are configured.`,
			unlock: formatGateEvidence(congressionalLaunchGate, {
				prefix: `${congressionalBoundary} Dependency: ${congressionalDependency}.`,
				density: 'operator'
			}),
			metric: {
				value: congressionalDeliveryArmed ? 1 : null,
				label: congressionalDeliveryArmed ? 'delivery runtime' : 'runtime evidence',
				cite: 'submissions.getCongressionalDeliveryReadiness'
			}
		}
	];
	const heldModes = modes.filter((mode) => mode.state === 'draft-only' || mode.state === 'gated');
	const nextHeldMode = heldModes[0] ?? null;
	const heldModeSummary = formatHeldSendModeSummary(heldModes);
	const sendBoundarySummary = !canPublish
		? 'Org authority is not attached to this session; Studio can shape intent while delivery-surface handoffs stay read-only and channel gates remain visible.'
		: nextHeldMode
			? `${nextHeldMode.label} is the first held send handoff; ${nextHeldMode.effect}`
			: 'Every visible send path is armed or bounded by route-local checks.';
	const sendBoundaryGate = !canPublish
		? [
				'Org authority is absent for this session, so delivery handoffs remain inspection-only.',
				nextHeldMode
					? `First channel boundary: ${nextHeldMode.unlock}`
					: 'No channel dependency is currently first in the send queue.'
			].join(' ')
		: (nextHeldMode?.unlock ?? 'No held send verb is first in the send queue.');

	return {
		modes,
		state: !canPublish ? 'gated' : heldModes.length > 0 ? 'draft-only' : 'live',
		heldCount: heldModes.length,
		heldModeSummary,
		sendBoundarySummary,
		sendBoundaryGate,
		browserDirectState,
		browserDirectSignal,
		browserDirectGate,
		clientDirectMergeState,
		clientDirectMergeGate,
		nextHeldMode,
		nextHeldLabel: nextHeldMode?.label ?? 'No held verb',
		nextHeldState: nextHeldMode?.state ?? 'live',
		nextHeldGate: nextHeldMode?.unlock ?? 'No held verb is first in the send queue.'
	};
}

export function getDataHonestyEvidence(
	verifyId: string,
	fixId: string | null,
	labels: {
		live: string;
		gated: string;
		gate: string;
	}
): DataHonestyEvidence {
	const verify = dataTaskById.get(verifyId);
	const fix = fixId ? dataTaskById.get(fixId) : null;
	const fixStatus = fix ? normalizeStatus(fix.status) : null;
	const verifyStatus = normalizeStatus(verify?.status);
	const state =
		fixStatus === 'completed' || verify?.verdict === 'honest'
			? 'live'
			: fixStatus === 'deferred' || verify?.verdict === 'gap'
				? 'gated'
				: verifyStatus === 'completed'
					? 'partial'
					: 'gated';
	const status = fixStatus === 'completed' ? 'completed' : (fixStatus ?? verifyStatus);

	return {
		state,
		status,
		mark: fixId ? `${verifyId}/${fixId}` : verifyId,
		evidence: state === 'live' ? labels.live : labels.gated,
		gate: labels.gate,
		source: 'docs/strategy/data-hypergraph/nodes/tasks.json'
	};
}
