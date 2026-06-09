import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	buildLaunchPressureRows,
	buildPersonDetailRows,
	buildPowerTargetDetailRows,
	buildStudioAuthoringReadiness,
	getGateEvidence,
	type StudioProcessEvidence
} from '../../src/lib/data/capability-hypergraph';
import {
	filterTargets,
	targetSearchText,
	type CameraTarget
} from '../../src/lib/components/org/os/camera';

function source(path: string): string {
	return readFileSync(path, 'utf8');
}

function section(text: string, start: string, end: string): string {
	const startIndex = text.indexOf(start);
	expect(startIndex).toBeGreaterThanOrEqual(0);
	const endIndex = text.indexOf(end, startIndex + start.length);
	expect(endIndex).toBeGreaterThan(startIndex);
	return text.slice(startIndex, endIndex);
}

function expectTerrainContractCount(
	markup: string,
	options: {
		label: string;
		rows: string;
		stateCounts: string;
		cite: string;
	}
): void {
	expect(markup).toContain('class="terrain-contract-count"');
	expect(markup).toContain(`${options.label} contracts: \${${options.rows}.length}`);
	expect(markup).toContain('class="terrain-contract-split"');
	expect(markup).toContain(`value={${options.rows}.length}`);
	expect(markup).toContain(`value={${options.stateCounts}.live}`);
	expect(markup).toContain(`value={${options.stateCounts}.partial}`);
	expect(markup).toContain(`value={${options.stateCounts}['draft-only']}`);
	expect(markup).toContain(`value={${options.stateCounts}.gated}`);
	expect(markup).toContain(`cite="${options.cite}"`);
	expect(markup).not.toContain('class="terrain-contract-copy"');
}

function cameraTarget(
	overrides: Partial<CameraTarget> & Pick<CameraTarget, 'id' | 'label'>
): CameraTarget {
	return {
		id: overrides.id,
		label: overrides.label,
		sublabel: overrides.sublabel ?? 'Capability',
		group: overrides.group ?? 'Workspaces',
		kind: overrides.kind ?? 'object',
		bounds: overrides.bounds ?? { x: 0, y: 0, width: 1, height: 1 },
		maxScale: overrides.maxScale ?? 1,
		object: overrides.object ?? null,
		processId: overrides.processId ?? null,
		searchTokens: overrides.searchTokens ?? [],
		state: overrides.state ?? null,
		stateLabel: overrides.stateLabel ?? null,
		clusterLabels: overrides.clusterLabels ?? null,
		gateId: overrides.gateId ?? null,
		gateName: overrides.gateName ?? null,
		gateTasks: overrides.gateTasks ?? null,
		gateDependency: overrides.gateDependency ?? null,
		source: overrides.source ?? null,
		action: overrides.action ?? null,
		actionLabel: overrides.actionLabel ?? null,
		handoff: overrides.handoff ?? null,
		effect: overrides.effect ?? null
	};
}

function studioAuthoringGates() {
	return {
		studioJurisdictionScopeGate: getGateEvidence(
			'CP-studio-jurisdiction-scope',
			['T3-1', 'T3-2', 'T3-3', 'T3-4', 'T3-5'],
			{
				name: 'Full jurisdiction resolution',
				downstream: 5,
				dependency: 'State/local terrain plus CA/GB/AU resolver wiring'
			}
		),
		messageProofGate: getGateEvidence('CP-message-proof-binding', ['T4-2', 'T4-7'], {
			name: 'Artifact proof binding',
			downstream: 3,
			dependency: 'Drafted artifact proof attachment and writer proof plumbing'
		}),
		delegatedTraceGate: getGateEvidence('CP-agent-trace-observability', ['T4-8'], {
			name: 'Delegated trace observability',
			downstream: 1,
			dependency: 'Delegation executor trace fields + grant-indexed replay'
		}),
		delegatedActionGate: getGateEvidence('CP-delegation-executor', ['T5-3', 'T4-2', 'T4-1'], {
			name: 'Delegated civic action',
			dependency: 'TEE runtime + proof attachment + delegation executor'
		})
	};
}

function studioProcessEvidence(overrides: Partial<StudioProcessEvidence> = {}): StudioProcessEvidence {
	return {
		processCount: 0,
		runningCount: 0,
		restoredCount: 0,
		focusedStatus: null,
		contactableTargetCount: 0,
		droppedTargetCount: 0,
		resolutionStopReason: null,
		resolutionStopDetail: null,
		sourceEvidenceObserved: false,
		sourceEvidenceCount: 0,
		sourceEvidenceMode: null,
		sourceEvidenceEvaluationFallback: false,
		sourceEvidenceCandidateCount: null,
		sourceEvidenceFailedCount: null,
		sourceEvidenceSearchQueryCount: null,
		evaluatedSourceCount: 0,
		searchOnlySourceCount: 0,
		messageParagraphCount: 0,
		draftHandoffCount: 0,
		hasComposedMessage: false,
		hasRecoveryJob: false,
		recoveryJobStatus: null,
		hasTraceHandle: false,
		scopeLabel: null,
		scopeSource: null,
		...overrides
	};
}

describe('capability launch pressure contract', () => {
	it('keeps Studio readiness bounded until emitted process evidence exists', () => {
		const runtime = {
			runtimeReady: true,
			modelProviderConfigured: true,
			sourceSearchConfigured: true,
			sourceFetchConfigured: true,
			runtimeMissing: [],
			runtimeDependency: 'model provider, source discovery, and page-read evaluation',
			runtimeMessage: null
		};
		const readyWithoutRun = buildStudioAuthoringReadiness({
			base: '/org/local',
			process: null,
			runtime,
			gates: studioAuthoringGates()
		});
		const row = (key: string) => readyWithoutRun.rows.find((candidate) => candidate.key === key);

		expect(row('resolve')?.state).toBe('partial');
		expect(row('source-grounding')?.state).toBe('partial');
		expect(row('message-composition')?.state).toBe('partial');
		expect(row('draft-handoff')?.state).toBe('partial');
		expect(readyWithoutRun.state).toBe('partial');
		expect(readyWithoutRun.effect).toContain(
			'Grounded authoring runtime can start now; target resolution, source grounding, artifact authoring, draft handoff, recovery, trace, and delegated-action claims stay unpromoted until emitted evidence exists.'
		);

		const emitted = buildStudioAuthoringReadiness({
			base: '/org/local',
			process: studioProcessEvidence({
				processCount: 1,
				focusedStatus: 'composed',
				contactableTargetCount: 2,
				sourceEvidenceObserved: true,
				sourceEvidenceCount: 3,
				sourceEvidenceMode: 'discovery',
				evaluatedSourceCount: 3,
				messageParagraphCount: 4,
				draftHandoffCount: 2,
				hasComposedMessage: true,
				hasRecoveryJob: true,
				recoveryJobStatus: 'completed',
				hasTraceHandle: true,
				scopeLabel: 'San Francisco, California, United States',
				scopeSource: 'resolved-targets'
			}),
			runtime,
			gates: studioAuthoringGates()
		});
		const emittedRow = (key: string) => emitted.rows.find((candidate) => candidate.key === key);

		expect(emittedRow('resolve')?.state).toBe('live');
		expect(emittedRow('source-grounding')?.state).toBe('live');
		expect(emittedRow('message-composition')?.state).toBe('live');
		expect(emittedRow('draft-handoff')?.state).toBe('draft-only');
		expect(emitted.effect).toContain(
			'A focused Studio process has emitted contactable targets, evaluated sources, and an authored artifact'
		);
	});

	it('keeps org-root Results status reconciled with the mounted shell data path', () => {
		const implementationStatus = source('docs/implementation-status.md');
		const implementationTasks = source('docs/strategy/implementation-hypergraph/nodes/tasks.json');
		const orgRootServer = source('src/routes/org/[slug]/+page.server.ts');
		const orgRootPage = source('src/routes/org/[slug]/+page.svelte');
		const layoutServer = source('src/routes/org/[slug]/+layout.server.ts');
		const resultsSpace = source('src/lib/components/org/os/ReturnSpace.svelte');
		const spacesContract = source('src/lib/components/org/os/spaces.ts');
		const orgShell = source('src/lib/components/org/os/OrgShell.svelte');

		expect(implementationStatus).toContain('Org root Results data has been reconciled.');
		expect(implementationStatus).toContain('`/org/[slug]` is now an');
		expect(implementationStatus).toContain('addressability shim');
		expect(implementationStatus).toContain('`organizations.getDashboardStats`');
		expect(implementationStatus).toContain('top active/recent campaign packet');
		expect(implementationStatus).toContain('honest empty packet/receipt states');
		expect(implementationStatus).not.toContain('Dashboard demo experience is broken');
		expect(implementationStatus).not.toContain('verification funnel hardcoded `0`s');
		expect(implementationStatus).not.toContain('tier distribution hardcoded `0`s');
		expect(implementationStatus).not.toContain(
			'src/routes/org/[slug]/+page.server.ts:51-83'
		);
		expect(implementationStatus).not.toContain('Dashboard packet/funnel wiring');
		expect(implementationTasks).toContain(
			'Current implementation loads getDashboard/getDashboardStats plus top-campaign'
		);
		expect(implementationTasks).toContain('/org/[slug] is an addressability shim');
		expect(implementationTasks).toContain('OrgSpacesData.return');
		expect(implementationTasks).not.toContain('src/routes/org/[slug]/+page.server.ts:51-83');

		expect(orgRootServer).toContain('moved UP to the layout');
		expect(orgRootServer).toContain('addressable');
		expect(orgRootServer).toContain('return { orgSlug: org.slug };');
		expect(orgRootPage).toContain('so this component intentionally renders');
		expect(orgRootPage).toContain('the mounted OrgShell ReturnSpace is the real');
		expect(layoutServer).toContain('serverQuery(api.organizations.getDashboard, { slug })');
		expect(layoutServer).toContain('serverQuery(api.organizations.getDashboardStats, { slug })');
		expect(layoutServer).toContain('computeVerificationPacketCached(');
		expect(layoutServer).toContain('funnel: dashboardStats.funnel');
		expect(layoutServer).toContain('tiers: dashboardStats.tiers');
		expect(layoutServer).not.toContain('dashboard.recentSupporters');
		expect(spacesContract).not.toContain('ReturnSpaceActivity');
		expect(spacesContract).not.toContain('recentActivity');
		expect(orgShell).toContain('<ReturnSpace data={spaces.return} {base} />');
		expect(resultsSpace).toContain('{#if !data}');
		expect(resultsSpace).toContain('Not a fabricated zero');
		expect(resultsSpace).toContain('aria-label="Results receipt response posture"');
		expect(resultsSpace).toContain('<span class="section-label">Receipt response posture</span>');
		expect(resultsSpace).toContain('legislation.getOrgReceiptSummary bounded sample');
		expect(resultsSpace).toContain('legislation.getOrgReceiptSummary responseLoggedCount');
		expect(resultsSpace).toContain('legislation.getOrgReceiptSummary pendingCount');
		expect(resultsSpace).toContain('legislation.getOrgReceiptSummary anchorFieldCount');
		expect(resultsSpace).not.toContain('Recent Arrivals');
		expect(resultsSpace).not.toContain('signed up');
		expect(resultsSpace).not.toContain('recentActivity');
		expect(resultsSpace).toContain('No people yet. Import people to see verification progress.');
		expect(resultsSpace).toContain(
			'No action records yet. Tier distribution appears as people take action.'
		);
	});

	it('keeps the optional capability map in Studio/People/Power/Results language', () => {
		const canvasPage = source('src/routes/org/[slug]/canvas/+page.svelte');
			const canvasServer = source('src/routes/org/[slug]/canvas/+page.server.ts');
			const canvas = source('src/lib/components/org/os/CanvasCapabilityMap.svelte');
			const fieldNode = source('src/lib/components/org/os/ConstellationNode.svelte');
			const constellationContract = source(
				'src/lib/components/org/os/constellation-capability-contract.ts'
			);
			const processNode = source('src/lib/components/org/os/ProcessNode.svelte');
		const processDock = source('src/lib/components/org/os/ProcessDock.svelte');
		const palette = source('src/lib/components/org/os/CanvasCapabilityFinder.svelte');
		const camera = source('src/lib/components/org/os/camera.ts');
		const constellation = source('src/lib/components/org/os/constellation.ts');
		const spacesContract = source('src/lib/components/org/os/spaces.ts');
		const orgOS = source('src/lib/components/org/os/orgOS.svelte.ts');
		const orgShell = source('src/lib/components/org/os/OrgShell.svelte');
		const peopleSpace = source('src/lib/components/org/os/BaseSpace.svelte');
		const powerSpace = source('src/lib/components/org/os/LandscapeSpace.svelte');
		const resultsSpace = source('src/lib/components/org/os/ReturnSpace.svelte');
		const mantle = source('src/lib/components/org/OrgMantle.svelte');
		const signalWell = source('src/lib/components/org/SignalWell.svelte');
		const coordinationIntegrity = source('src/lib/components/org/CoordinationIntegrity.svelte');
		const commandBar = source('src/lib/components/org/CommandBar.svelte');
		const switcher = source('src/lib/components/org/WorkspaceSwitcher.svelte');
		const spotlight = source('src/lib/components/org/os/Spotlight.svelte');
		const stateLabels = source('src/lib/data/capability-state-labels.ts');
		const layout = source('src/routes/org/[slug]/+layout.svelte');
		const layoutServer = source('src/routes/org/[slug]/+layout.server.ts');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const settings = source('src/routes/org/[slug]/settings/+page.svelte');
		const webhookSettings = source('src/routes/org/[slug]/settings/webhooks/+page.svelte');
		const webhookSettingsServer = source('src/routes/org/[slug]/settings/webhooks/+page.server.ts');
		const webhookTestApi = source('src/routes/api/v1/webhooks/[id]/test-fire/+server.ts');
		const orgWebhooks = source('convex/orgWebhooks.ts');
		const convexHttp = source('convex/http.ts');
		const openapi = source('src/lib/server/api-v1/openapi.ts');
		const supporters = source('src/routes/org/[slug]/supporters/+page.svelte');
		const supporterDetail = source('src/routes/org/[slug]/supporters/[id]/+page.svelte');
		const representativeDetail = source(
			'src/routes/org/[slug]/representatives/[repId]/+page.svelte'
		);
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(canvasPage).toContain('<title>{data.orgName} · Capability Map</title>');
		expect(canvasPage).toContain("import CanvasCapabilityMap from '$lib/components/org/os/CanvasCapabilityMap.svelte';");
		expect(canvasPage).toContain('<CanvasCapabilityMap');
		expect(canvasPage).not.toContain('<title>{data.orgName} · Workspace Map</title>');
		expect(canvasPage).not.toContain('CanvasSpatialOS');
			expect(canvasServer).toContain('Capability Map — server context.');
			expect(canvasServer).toContain('People signal, Power targets, Results');
			expect(canvasServer).toContain('workspace zones');
			expect(canvasServer).not.toMatch(/workspace map/i);
			expect(canvasServer).not.toMatch(/people base|returned packets/i);
			expect(canvasServer).not.toContain('world-space regions');

			expect(canvas).toContain('type FieldWorkspaceReadout');
			expect(canvas).toContain('type FieldOperatingReadoutId');
			expect(canvas).toContain('type FieldClaimBoundaryId');
			expect(canvas).toContain('type FieldOperatingReadout');
			expect(canvas).toContain('type FieldNextMove');
			expect(canvas).toContain('type FieldClaimBoundary');
			expect(canvas).toContain('type FieldVisibleContract');
			expect(canvas).toContain('type FieldStateLedgerRow');
			expect(canvas).toContain('type FieldCoverageRow');
			expect(canvas).toContain("import { FEATURES } from '$lib/config/features';");
			expect(canvas).toContain("import { Datum, Ratio } from '$lib/design';");
			expect(canvas).toContain('CAPABILITY_CLUSTER_IDS,');
			expect(canvas).toContain('capabilityClusterLabel,');
			expect(canvas).toContain('parseCapabilityClusterIds,');
			expect(canvas).toContain("import { constellationCapabilityContract } from './constellation-capability-contract';");
			expect(canvas).toContain('buildPowerTerrainReadiness');
			expect(canvas).toContain('buildResultsProofReadiness');
			expect(canvas).toContain('buildSendReadiness');
			expect(canvas).toContain('buildStudioAuthoringReadiness');
			expect(canvas).toContain('buildStudioScopeReadiness');
		expect(canvas).toContain('formatGateEvidence');
		expect(canvas).toContain('getGateEvidence');
		expect(canvas).toContain('getDataHonestyEvidence');
		expect(canvas).toContain('const authoringRuntime = $derived(spaces?.operating?.authoring ?? null)');
		expect(canvas).toContain('const authoringRuntimeReady = $derived(authoringRuntime?.runtimeReady === true)');
		expect(canvas).toContain('runDisabled={!authoringRuntimeReady}');
		expect(canvas).toContain("runLabel={authoringRuntimeReady ? 'Start authoring' : 'Authoring boundary'}");
		expect(canvas).not.toContain("runLabel={authoringRuntimeReady ? 'Start authoring' : 'Runtime not armed'}");
		expect(canvas).not.toContain('Grounded authoring is not armed');
		expect(canvas).toContain('Grounded authoring is dependency-first');
		expect(canvas).toContain("import CanvasCapabilityFinder from './CanvasCapabilityFinder.svelte';");
		expect(canvas).toContain('unlock: string;');
		expect(canvas).toContain('gateTasks: string;');
		expect(canvas).toContain('gateSummary: string;');
		expect(canvas).toContain('action: string;');
		expect(canvas).toContain("id: 'readout-verified-action-loop'");
		expect(canvas).toContain("id: 'next-grounded-authoring'");
		expect(canvas).toContain("id: 'claim-can-claim'");
		expect(canvas).toContain("const FIELD_OPERATING_CLUSTERS: Record<FieldOperatingReadoutId, string>");
		expect(canvas).toContain("const FIELD_CLAIM_CLUSTERS: Record<FieldClaimBoundaryId, string>");
		expect(canvas).toContain('clusters: FIELD_OPERATING_CLUSTERS[item.id]');
		expect(canvas).toContain('clusters: FIELD_CLAIM_CLUSTERS[boundary.id]');
			expect(canvas).toContain('const fieldWorkspaceReadouts = $derived<FieldWorkspaceReadout[]>');
			expect(canvas).toContain('const fieldOperatingReadouts = $derived<FieldOperatingReadout[]>');
			expect(canvas).toContain('const fieldNextMoves = $derived<FieldNextMove[]>');
			expect(canvas).toContain('const fieldClaimBoundaries = $derived<FieldClaimBoundary[]>');
			expect(canvas).toContain('const fieldObjectContracts = $derived<FieldVisibleContract[]>');
			expect(canvas).toContain('const fieldVisibleContracts = $derived<FieldVisibleContract[]>');
			expect(canvas).toContain('const fieldStateLedgerRows = $derived<FieldStateLedgerRow[]>');
			expect(canvas).toContain('const fieldCoverageRows = $derived<FieldCoverageRow[]>');
			expect(canvas).toContain(
				'const fieldCoverageStateCounts = $derived<Record<FieldWorkspaceState, number>>'
			);
			expect(canvas).toContain('const fieldHeldClusterCount = $derived');
			expect(canvas).toContain('operatorCapabilityStateRatioSegments(fieldStateCounts)');
			expect(canvas).toContain('aria-label="Capability operating readout"');
			expect(canvas).toContain('{#each fieldOperatingReadouts as item (item.id)}');
			expect(canvas).not.toContain('{#each fieldOperatingReadouts as item (item.label)}');
			expect(canvas).toContain('aria-label="Capability state ledger and coverage"');
			expect(canvas).toContain('aria-label="Capability contracts by state"');
			expect(canvas).toContain('aria-label="Capability coverage by cluster"');
			expect(canvas).toContain('{#each fieldClaimBoundaries as boundary (boundary.id)}');
			expect(canvas).not.toContain('{#each fieldClaimBoundaries as boundary (boundary.label)}');
			expect(canvas).toContain('{#each fieldNextMoves as move (move.id)}');
			expect(canvas).not.toContain('{#each fieldNextMoves as move (move.kicker)}');
			expect(canvas).toContain('boundary: string;');
			expect(canvas).toContain('boundarySource: string;');
			expect(canvas).toContain('boundaryGate: string;');
			expect(canvas).toContain('const boundary = fieldCoverageBoundaryContract(contracts);');
			expect(canvas).toContain('function fieldCoverageBoundaryContract(');
			expect(canvas).toContain("contracts.find((contract) => contract.state === 'gated')");
			expect(canvas).toContain(
				'Lead evidence: ${row.lead}. Next lift: ${row.boundary}. ${row.boundaryGate}'
			);
			expect(canvas).toContain(
				'title="{row.label}: lead {row.lead} ({row.source}). next lift {row.boundary} ({row.boundarySource}). {row.boundaryGate}"'
			);
			expect(canvas).toContain('<span class="field-coverage-meta-label">Lead</span>');
			expect(canvas).toContain('<span class="field-coverage-meta-label">Next</span>');
			expect(canvas).toContain('<span>{row.boundary}</span>');
			expect(canvas).toContain('class="field-coverage-split"');
			expect(canvas).toContain('Canvas coverage state mix: ${fieldCoverageStateCounts.live}');
			expect(canvas).toContain('value={fieldCoverageStateCounts.live}');
			expect(canvas).toContain('value={fieldCoverageStateCounts.partial}');
			expect(canvas).toContain('cite="Canvas capability coverage state mix"');
			expect(canvas).toContain(
				'<Datum value={fieldHeldClusterCount} cite="Canvas capability coverage state mix" />'
			);
			expect(canvas).not.toContain('class="field-contract-note"');
			expect(canvas).not.toContain('>field evidence</span>');
			expect(canvas).toContain('grid-area: boundary;');
			expect(canvas).toContain('aria-label="Capability claim boundary"');
			expect(canvas).toContain('aria-label="Next capability moves"');
		expect(canvas).toContain("label: 'Verified action loop'");
		expect(canvas).toContain("label: 'Send boundary'");
		expect(canvas).toContain("label: 'Evidence basis'");
		expect(canvas).toContain("label: 'Load-bearing gate'");
		expect(canvas).toContain("action: 'read loop posture'");
		expect(canvas).toContain("action: 'read claim basis'");
		expect(canvas).toContain("action: 'open gate register'");
			expect(canvas).toContain("label: 'Grounded authoring'");
			expect(canvas).toContain('state: studioAuthoringReadiness.state');
			expect(canvas).toContain('kicker: nextMoveKicker(studioAuthoringReadiness.state)');
			expect(canvas).toContain(
				'href: studioAuthoringIntentRow?.href ?? `${base}/studio#studio-intent`'
			);
			expect(canvas).toContain("action: studioAuthoringIntentRow?.action ?? 'read intent'");
			expect(canvas).toContain("handoff: studioAuthoringIntentRow?.handoff ?? 'Studio intent'");
			expect(canvas).toContain("label: 'Studio scope and recovery'");
			expect(canvas).toContain('kicker: nextMoveKicker(studioScopeReadiness.state)');
			expect(canvas).toContain("label: 'Deliver only armed channels'");
			expect(canvas).toContain('state: sendLoopState');
			expect(canvas).toContain('unlock: sendLoopGate');
			expect(canvas).toContain('kicker: nextMoveKicker(sendReadiness.nextHeldState)');
			expect(canvas).toContain('function nextMoveKicker(state: FieldWorkspaceState): string');
			expect(canvas).not.toContain("kicker: 'Use now'");
			expect(canvas).not.toContain(
				"kicker: sendReadiness.nextHeldMode ? 'Keep held' : 'Send boundary'"
			);
			expect(canvas).toContain("kicker: 'Load-bearing'");
			expect(canvas).toContain("label: 'Can claim'");
			expect(canvas).toContain("label: 'Must qualify'");
			expect(canvas).toContain("label: 'Cannot claim yet'");
			expect(canvas).toContain("cite: 'buildSendReadiness + data-honesty marks'");
			expect(canvas).toContain("unit: 'qualifiers'");
			expect(canvas).toContain("unit: 'blocked lift'");
				expect(canvas).toContain('const claimQualifierCount = $derived(');
				expect(canvas).toContain('const claimQualifierBoundary = $derived(');
				expect(canvas).toContain(
					'unresolvedBasisCount + sendLoopMetric.value + studioScopeReadiness.boundaryCount'
				);
				expect(canvas).toContain(
					'? `${basisGapSummary}; ${sendLoopSummary}; ${studioScopeReadiness.gate}`'
				);
				expect(canvas).not.toContain(
					'? `${basisGapSummary}; ${sendReadiness.sendBoundarySummary}; ${studioScopeReadiness.gate}`'
				);
			expect(canvas).toContain("const messageProofGate = getGateEvidence('CP-message-proof-binding'");
		expect(canvas).toContain("const delegatedTraceGate = getGateEvidence('CP-agent-trace-observability'");
		expect(canvas).toContain("const studioJurisdictionScopeGate = getGateEvidence(");
			expect(canvas).toContain('const studioScopeReadiness = $derived(');
			expect(canvas).toContain('const studioAuthoringReadiness = $derived(');
			expect(canvas).toContain('process: os.studioProcessEvidence');
			expect(canvas).toContain('const studioAuthoringIntentRow = $derived(');
			expect(canvas).toContain("row.key === 'intent'");
			expect(canvas).toContain('const studioAuthoringArtifactRow = $derived(');
			expect(canvas).toContain("row.key === 'message-composition'");
			expect(canvas).toContain(
				'const studioFieldWorkspaceState = $derived<FieldWorkspaceState>(studioAuthoringReadiness.state)'
			);
			expect(canvas).not.toContain(
				"canPublish ? studioAuthoringReadiness.state : 'gated'"
			);
			expect(canvas).toContain('const studioFieldWorkspaceDetail = $derived(');
			expect(canvas).toContain(
				'Current role can author, watch, and preserve Studio evidence; route handoffs and execution side effects require org authority.'
			);
			expect(canvas).not.toContain(
				'Current role can inspect Studio evidence; publish authority is required before authoring handoffs can move.'
			);
			expect(canvas).toContain('const verifiedLoopReadoutDetail = $derived(');
			expect(canvas).toContain('detail: verifiedLoopReadoutDetail');
			expect(canvas).toContain('state: studioFieldWorkspaceState');
			expect(canvas).toContain('detail: studioFieldWorkspaceDetail');
			expect(canvas).not.toContain('Intent and authoring are usable now');
			expect(canvas).not.toContain('Authoring and handoff ready');
			expect(canvas).toContain(
				'state: studioAuthoringIntentRow?.state ?? studioAuthoringReadiness.state'
			);
			expect(canvas).toContain(
				'href: studioAuthoringIntentRow?.href ?? `${base}/studio#studio-intent`'
			);
			expect(canvas).toContain("action: studioAuthoringIntentRow?.action ?? 'read intent'");
			expect(canvas).toContain(
				'value: studioAuthoringIntentRow?.metric.value ?? studioAuthoringReadiness.metric.value'
			);
			expect(canvas).toContain(
				'unlock: studioAuthoringIntentRow?.gate ?? studioAuthoringReadiness.gate'
			);
			expect(canvas).not.toContain("state: canPublish ? 'live' : 'partial'");
			expect(canvas).not.toContain(
				"action: canPublish ? 'open Studio intent' : 'read Studio boundary'"
			);
			expect(canvas).toContain(
				'state: studioAuthoringArtifactRow?.state ?? studioAuthoringReadiness.state'
			);
			expect(canvas).toContain(
				'value: studioAuthoringArtifactRow?.metric.value ?? studioAuthoringReadiness.metric.value'
			);
			expect(canvas).toContain(
				'unlock: studioAuthoringArtifactRow?.gate ?? studioAuthoringReadiness.gate'
			);
			expect(canvas).toContain('const sendLoopState = $derived<FieldWorkspaceState>(sendReadiness.state)');
			expect(canvas).toContain('const sendLoopSummary = $derived(');
			expect(canvas).toContain('const sendLoopGate = $derived(sendReadiness.sendBoundaryGate)');
			expect(canvas).toContain('const sendLoopMetric = $derived({');
			expect(canvas).toContain(
				"label: sendReadiness.heldCount === 1 ? 'held send mode' : 'held send modes'"
			);
			expect(canvas).toContain('const sendLoopGround = $derived(');
			expect(canvas).toContain('const sendLoopNextLift = $derived(');
			expect(canvas).toContain('const sendLoopHref = $derived(');
			expect(canvas).toContain('const sendLoopAction = $derived(');
			expect(canvas).toContain('type PowerTerrainRow');
			expect(canvas).toContain('const powerStateLocalTerrainGate = getGateEvidence(');
			expect(canvas).toContain("'CP-state-local-terrain'");
			expect(canvas).toContain("'CP-international-power-terrain'");
			expect(canvas).toContain("'CP-state-bill-terrain'");
			expect(canvas).toContain("'CP-non-federal-scorecards'");
			expect(canvas).toContain("'CP-reader-office-profile'");
			expect(canvas).toContain('const powerTerrainReadiness = $derived(');
			expect(canvas).toContain('buildPowerTerrainReadiness({');
			expect(canvas).toContain('const powerTerrainRows = $derived<PowerTerrainRow[]>');
			expect(canvas).toContain('const powerResolveRow = $derived(');
			expect(canvas).toContain('const firstHeldPowerTerrainRow = $derived(');
			expect(canvas).toContain(
				'const powerLoopState = $derived<FieldWorkspaceState>(powerTerrainReadiness.state)'
			);
			expect(canvas).toContain('const powerLoopMetric = $derived({');
			expect(canvas).toContain("cite: 'buildPowerTerrainReadiness'");
			expect(canvas).toContain('const powerLoopHref = $derived(');
			expect(canvas).toContain('const powerLoopAction = $derived(');
			expect(canvas).toContain('const powerLoopGate = $derived(');
			expect(canvas).toContain('const powerLoopNextLift = $derived(');
			expect(canvas).toContain("label: 'Resolve power target'");
			expect(canvas).toContain('state: powerLoopState');
			expect(canvas).toContain('value: powerLoopMetric.value');
			expect(canvas).toContain('unit: powerLoopMetric.label');
			expect(canvas).toContain('cite: powerLoopMetric.cite');
			expect(canvas).toContain('unlock: powerLoopGate');
			expect(canvas).toContain('detail: powerTerrainReadiness.detail');
			expect(canvas).not.toContain('const powerTerrainCount = $derived');
			expect(canvas).not.toContain("label: 'Find target'");
			expect(canvas).not.toContain("state: powerTerrainCount === null ? 'gated' : 'partial'");
			expect(canvas).not.toContain(
				"state: powerTerrainCount === null ? 'gated' : powerTerrainCount > 0 ? 'live' : 'partial'"
			);
			expect(canvas).toContain('type ResultsProofRow');
			expect(canvas).toContain('const actionRecordsHref = $derived(`${base}#action-records`)');
			expect(canvas).toContain('const resultsPacketHref = $derived(`${base}#results-packet`)');
			expect(canvas).toContain('const packetHref = $derived(');
			expect(canvas).toContain('const proofDeliveryHref = $derived(');
			expect(canvas).toContain("const coordinationIntegrityGate = getGateEvidence('CP-coordination-integrity'");
			expect(canvas).not.toContain('const resultsGate = weakestGate([');
			expect(canvas).toContain('coordinationIntegrityGate');
			expect(canvas).toContain('const resultsProofReadiness = $derived(');
			expect(canvas).toContain('buildResultsProofReadiness({');
			expect(canvas).toContain('const resultsProofRows = $derived<ResultsProofRow[]>');
			expect(canvas).toContain('const resultsPacketRow = $derived(');
			expect(canvas).toContain('const firstHeldResultsProofRow = $derived(');
			expect(canvas).toContain(
				'const resultsLoopState = $derived<FieldWorkspaceState>(resultsProofReadiness.state)'
			);
			expect(canvas).toContain('const resultsLoopMetric = $derived({');
			expect(canvas).toContain('const resultsLoopHref = $derived(');
			expect(canvas).toContain('const resultsLoopAction = $derived(');
			expect(canvas).toContain('const resultsLoopGate = $derived(');
			expect(canvas).toContain('const resultsLoopNextLift = $derived(');
			expect(canvas).toContain('state: resultsLoopState');
			expect(canvas).toContain('value: resultsLoopMetric.value');
			expect(canvas).toContain('unit: resultsLoopMetric.label');
			expect(canvas).toContain('cite: resultsLoopMetric.cite');
			expect(canvas).toContain('unlock: resultsLoopGate');
			expect(canvas).toContain('detail: resultsProofReadiness.detail');
			expect(canvas).not.toContain('const resultsReceiptCount = $derived');
			expect(canvas).not.toContain('const resultsSignalValue = $derived');
			expect(canvas).not.toContain('const resultsSignalCite = $derived');
			expect(canvas).not.toContain('const resultsWorkspaceDetail = $derived');
			expect(canvas).not.toContain(
				"state: !spaces?.return ? 'gated' : spaces.return.packet ? 'live' : 'partial'"
			);
			expect(canvas).toContain("href: `${base}/studio#studio-intent`");
			expect(canvas).toContain("href: `${base}/studio#capability-gates`");
			expect(canvas).toContain('href: sendLoopHref');
			expect(canvas).toContain('action: sendLoopAction');
		expect(canvas).toContain('studioAuthoringReadiness.metric.value');
		expect(canvas).toContain('studioScopeReadiness.boundaryCount');
		expect(canvas).not.toContain("cite: 'buildStudioScopeReadiness boundary',\n\t\t\tvalue: 2");
		expect(canvas).toContain('operatorCapabilityActionLabel,');
		expect(canvas).toContain('return operatorCapabilityActionLabel(state, action);');
			expect(canvas).toContain('function nextMoveAriaLabel(move: FieldNextMove)');
			expect(canvas).toContain('function claimBoundaryAriaLabel(boundary: FieldClaimBoundary)');
			expect(canvas).toContain('function stateLedgerAriaLabel(row: FieldStateLedgerRow)');
			expect(canvas).toContain('function coverageAriaLabel(row: FieldCoverageRow)');
			expect(canvas).toContain('function operatingReadoutAriaLabel(readout: FieldOperatingReadout)');
		expect(canvas).toContain('actionLabel(readout.state, readout.action)');
		expect(canvas).toContain('actionLabel(readout.state, readout.action)');
			expect(canvas).toContain("action: 'read Studio posture'");
			expect(canvas).toContain('action: emailListHealthReadiness.action');
			expect(canvas).toContain('action: firstHeldPowerTerrainRow?.action ?? powerLoopAction');
			expect(canvas).toContain('action: firstHeldResultsProofRow?.action ?? resultsLoopAction');
		expect(canvas).toContain(
			'<span class="field-rail-action">{actionLabel(item.state, item.action)}</span>'
		);
		expect(canvas).toContain(
			'<span class="dock-action">{actionLabel(readout.state, readout.action)}</span>'
		);
		expect(canvas).toContain(
			'<span class="field-operating-action">{actionLabel(item.state, item.action)}</span>'
		);
		expect(canvas).not.toContain(
			'<span class="field-operating-action">{item.action}</span>'
		);
		expect(canvas).toContain('href: `${base}/studio#capability-loop`');
		expect(canvas).toContain('href: `${base}/studio#capability-basis`');
		expect(canvas).toContain('href: `${base}/studio#capability-gates`');
		expect(canvas).toContain('buildSendReadiness({');
		expect(canvas).toContain('EMAIL_SERVER_DISPATCH: FEATURES.EMAIL_SERVER_DISPATCH');
		expect(canvas).toContain('WORKFLOW_EXECUTION: FEATURES.WORKFLOW_EXECUTION');
		expect(canvas).toContain('const loadedOrgSlices = $derived([');
		expect(canvas).toContain("getDataHonestyEvidence('V-5', 'FIX-V5'");
		expect(canvas).toContain("getDataHonestyEvidence('V-3', 'FIX-V3'");
		expect(canvas).toContain("getDataHonestyEvidence('V-4', 'FIX-V4'");
		expect(canvas).toContain("getDataHonestyEvidence('V-2', 'FIX-V2'");
		expect(canvas).toContain('const liveHonestyCount = $derived');
		expect(canvas).toContain('const unresolvedHonestyRows = $derived');
		expect(canvas).toContain(
			'const unresolvedBasisCount = $derived(unloadedSliceCount + unresolvedHonestyCount)'
		);
		expect(canvas).toContain("unresolvedBasisCount === 0 ? 'live' : 'partial'");
		expect(canvas).toContain('const basisGapSummary = $derived(');
		expect(canvas).toContain('const basisReadoutDetail = $derived(');
		expect(canvas).toContain('value: unresolvedBasisCount');
		expect(canvas).toContain("unit: 'basis gaps'");
		expect(canvas).toContain('gate: basisGapSummary');
		expect(canvas).not.toContain('value: loadedSliceCount,\n\t\t\tunit: `of ${totalOrgSliceCount} slices`');
		expect(canvas).toContain('layout OrgSpacesData + data-honesty audit marks');
		expect(canvas).toContain('critical path hypergraph');
		expect(canvas).toContain('function operatingReadoutAriaLabel(readout: FieldOperatingReadout)');
		expect(canvas).toContain('aria-label="Workspace capability posture"');
		expect(canvas).toContain('<span class="hud-org-context">Capability map</span>');
		expect(canvas).toContain("label: 'Studio'");
		expect(canvas).toContain("label: 'People'");
		expect(canvas).toContain("label: 'Power'");
			expect(canvas).toContain("label: 'Results'");
			expect(canvas).toContain('cite: emailListHealthReadiness.metric.cite');
			expect(canvas).toContain('cite: powerLoopMetric.cite');
			expect(canvas).toContain('cite: resultsLoopMetric.cite');
		expect(canvas).toContain('const fieldWorkspaceReadoutByRegion = $derived');
		expect(canvas).toContain(
			'function dockAriaLabel(readout: FieldWorkspaceReadout, shortcut: number)'
		);
		expect(canvas).toContain('function signalAria(value: number | null, unit: string)');
		expect(canvas).toContain('function workspaceReadoutAriaLabel(readout: FieldWorkspaceReadout)');
		expect(canvas).toContain('action is ${actionLabel(readout.state, readout.action)}');
		expect(canvas).toContain('title="{item.label}: {item.detail}. Action: {actionLabel(');
		expect(canvas).toContain('title="{readout.label}: {readout.detail}. Action: {actionLabel(');
		expect(canvas).toContain("const platformApiGate = getGateEvidence('CP-platform-api-sync'");
		expect(canvas).toContain('const reachExpansionGate = getGateEvidence(');
		expect(canvas).toContain("const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring'");
		expect(canvas).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
		expect(canvas).toContain("const listUnsubscribeGate = getGateEvidence('CP-list-unsubscribe'");
		expect(canvas).toContain(
			"const softBounceGate = getGateEvidence('CP-soft-bounce-categorization'"
		);
		expect(canvas).toContain("const abAutomationGate = getGateEvidence('CP-ab-automated-dispatch'");
		expect(canvas).toContain("const smsDispatchGate = getGateEvidence('CP-sms-dispatch', ['T2-1']");
		expect(canvas).toContain("const workflowEffectsGate = getGateEvidence('CP-workflow-effects'");
		expect(canvas).toContain(
			"const congressionalLaunchGate = getGateEvidence('CP-congressional-launch'"
		);
		expect(canvas).toContain('const loadBearingGate = weakestGate([');
		expect(canvas).toContain('const delegatedActionGate = weakestGate([delegationGate, teeGate]);');
		expect(canvas).toContain('const studioGate = delegatedActionGate;');
			expect(canvas).toContain('receiptAnchoringGate,');
			expect(canvas).toContain('readerOfficeGate,');
			expect(canvas).not.toContain('const peopleGate = weakestGate([');
			expect(canvas).not.toContain('const resultsGate = weakestGate([');
			expect(canvas).toContain('buildPeopleSourceProvenanceReadiness,');
			expect(canvas).toContain('buildEmailListHealthReadiness,');
			expect(canvas).toContain('const peopleSourceProvenanceReadiness = $derived(');
			expect(canvas).toContain("const softBounceHonesty = getDataHonestyEvidence('V-7', null");
			expect(canvas).toContain('const emailListHealthReadiness = $derived(');
			expect(canvas).toContain(
				'const peopleFieldWorkspaceState = $derived<FieldWorkspaceState>(emailListHealthReadiness.state)'
			);
			expect(canvas).toContain('const peopleFieldWorkspaceDetail = $derived(');
			expect(canvas).toContain('const peopleFieldWorkspaceGate = $derived(');
			expect(canvas).toContain('const peopleGroundLoopState = $derived<FieldWorkspaceState>(');
			expect(canvas).toContain("peopleSourceProvenanceReadiness.state === 'live'");
			expect(canvas).toContain("emailListHealthReadiness.state === 'live'");
			expect(canvas).toContain('const peopleGroundLoopGate = $derived(');
			expect(canvas).toContain('state: peopleFieldWorkspaceState');
			expect(canvas).toContain('value: emailListHealthReadiness.metric.value');
			expect(canvas).toContain('unit: emailListHealthReadiness.metric.label');
			expect(canvas).toContain('detail: peopleFieldWorkspaceDetail');
			expect(canvas).toContain('unlock: readoutUnlock(emailListHealthReadiness.nextGate)');
			expect(canvas).toContain('gateTasks: emailListHealthReadiness.nextGate.tasks');
			expect(canvas).toContain('gateSummary: peopleFieldWorkspaceGate');
			expect(canvas).toContain("id: 'GROUND'");
			expect(canvas).toContain('state: peopleGroundLoopState');
			expect(canvas).toContain('href: peopleSourceProvenanceReadiness.href');
			expect(canvas).toContain('action: peopleSourceProvenanceReadiness.action');
			expect(canvas).toContain('value: peopleSourceProvenanceReadiness.metric.value');
			expect(canvas).toContain('unit: peopleSourceProvenanceReadiness.metric.label');
			expect(canvas).toContain('cite: peopleSourceProvenanceReadiness.metric.cite');
			expect(canvas).toContain('unlock: peopleGroundLoopGate');
			expect(canvas).not.toContain(
				"state: !spaces?.base ? 'gated' : spaces.base.emailHealth.subscribed > 0 ? 'live' : 'partial'"
			);
			expect(canvas).not.toContain("state: spaces?.base ? 'partial' : 'gated'");
			expect(canvas).not.toContain("action: 'read People ground'");
			expect(canvas).not.toContain("cite: 'supporters.getSummaryStats identityVerified'");
			expect(canvas).not.toContain("action: 'read People reach'");
			expect(canvas).not.toContain("cite: 'supporters.getSummaryStats email health'");
			expect(canvas).not.toContain('Reach weighted by verification signal');
			expect(canvas).toContain('coordinationIntegrityGate');
		expect(canvas).toContain('function readoutGateSummary(gate: GateEvidence, prefix: string)');
		expect(canvas).toContain("from '$lib/data/capability-state-labels';");
		expect(canvas).toContain('operatorCapabilityActionLabel,');
			expect(canvas).toContain('return operatorCapabilityStateLabel(state);');
			expect(canvas).toContain('type FieldOperatingSpineItem');
			expect(canvas).toContain('const heldCapabilityCount = $derived');
			expect(canvas).toContain('const fieldOperatingSpine = $derived<FieldOperatingSpineItem[]>');
			expect(canvas).toContain("label: 'Move now'");
			expect(canvas).toContain("label: 'Qualify'");
			expect(canvas).toContain("label: 'Hold'");
			expect(canvas).toContain("label: 'Next lift'");
			expect(canvas).toContain('function operatingSpineAriaLabel(item: FieldOperatingSpineItem)');
			expect(canvas).toContain('aria-label="Capability operating spine"');
			expect(canvas).toContain('<span class="field-spine-label">{item.label}</span>');
			expect(canvas).toContain('<span class="field-spine-detail">{item.detail}</span>');
			expect(canvas).toContain('<span class="field-spine-action">{actionLabel(item.state, item.action)}</span>');
			expect(canvas).toContain('.field-spine');
			expect(canvas).toContain('grid-area: spine;');
			expect(canvas).toContain("'org spine process'");
			expect(canvas).toContain("'spine'");
			expect(canvas).toContain('aria-label="Capability map for {orgName}');
			expect(canvas).toContain('search Studio, People, Power, and Results');
			expect(canvas).toContain('aria-label="Workspace capability rail"');
			expect(canvas).toContain(
				'aria-label="Workspace capability dock: command rail for Studio, People, Power, Results, and running processes"'
			);
		expect(canvas).toContain('background: var(--surface-base, oklch(0.993 0.003 60));');
		expect(canvas).toContain('background: var(--canvas-panel);');
		expect(canvas).toContain('--canvas-panel: oklch(0.982 0.004 58);');
		expect(canvas).toContain('min-height: 5rem;');
		expect(canvas).toContain('min-height: 4.25rem;');
		expect(canvas).toContain('min-height: 3.75rem;');
		expect(canvas).toContain('font-size: 0.98rem;');
		expect(canvas).not.toContain('background-image: radial-gradient(');
		expect(canvas).not.toContain('linear-gradient(');
		expect(canvas).not.toContain('createRadialGradient');
		expect(canvas).not.toContain('backdrop-filter');
		expect(canvas).not.toMatch(/frosted/i);
		expect(canvas).not.toContain('dark, pannable, zoomable');
			expect(canvas).not.toContain('aria-label="Workspace map for {orgName}');
			expect(canvas).not.toContain('aria-label="Areas"');
			expect(canvas).not.toContain('aria-label="Studio, People, Power, Results"');
			expect(canvas).not.toContain('aria-label="Fly to an area or running process"');
		expect(canvas).not.toMatch(/verified base/i);
		expect(canvas).not.toMatch(/open in classic|exit to classic/i);
		expect(canvas).not.toContain('SPATIAL OS');
		expect(canvas).not.toContain('CanvasSpatialOS');
		expect(canvas).not.toContain('Verified base');
		expect(canvas).not.toContain("label: 'Returns'");
		expect(canvas).not.toContain('>Returns<');
		expect(canvas).not.toMatch(/spatial os/i);
		expect(canvas).not.toMatch(/workspace-map/i);
		expect(canvasPage).not.toMatch(/workspace-map/i);
		expect(switcher).toContain(
			"import { FileCheck, Landmark, PenLine, UsersRound } from '@lucide/svelte';"
		);
		expect(switcher).toContain("icon: 'studio' | 'people' | 'power' | 'results';");
		expect(switcher).toContain('<PenLine size={18} strokeWidth={1.8} />');
		expect(switcher).toContain('<UsersRound size={18} strokeWidth={1.8} />');
		expect(switcher).toContain('<Landmark size={18} strokeWidth={1.8} />');
		expect(switcher).toContain('<FileCheck size={18} strokeWidth={1.8} />');
		expect(switcher).not.toContain('<svg viewBox');
		expect(switcher).not.toContain("mark.icon === 'base'");
		expect(switcher).not.toContain("mark.icon === 'landscape'");
		expect(switcher).not.toContain("mark.icon === 'return'");
		expect(layout).toContain("icon: 'people'");
		expect(layout).toContain("icon: 'power'");
		expect(layout).toContain("icon: 'results'");
		expect(layout).not.toContain("icon: 'base'");
		expect(layout).not.toContain("icon: 'landscape'");
		expect(layout).not.toContain("icon: 'return'");
		expect(canvas).toContain('data-state={readout.state}');
		expect(canvas).toContain('data-workspace={item.id}');
		expect(canvas).toContain('aria-label={workspaceReadoutAriaLabel(item)}');
		expect(canvas).toContain('aria-label={dockAriaLabel(readout, i + 1)}');
		expect(canvas).toContain('class="dock-control dock-control--workspace"');
		expect(canvas).toContain('data-workspace={rid}');
		expect(canvas).toContain('Next unlock: ${readout.unlock}, ${readout.gateTasks}');
		expect(canvas).toContain('title="{item.label}: {item.detail}. Action: {actionLabel(');
		expect(canvas).toContain('title="{readout.label}: {readout.detail}. Action: {actionLabel(');
		expect(canvas).toContain('<span class="field-rail-unlock">');
		expect(canvas).toContain('<span class="field-rail-tasks">{item.gateTasks}</span>');
		expect(canvas).toContain('<span class="dock-signal">');
		expect(canvas).toContain('<span class="dock-effect">{readout.detail}</span>');
		expect(canvas).toContain('Workspace controls show state, signal, route effect');
		expect(canvas).toContain('class="dock-posture"');
		expect(canvas).toContain('href={`${base}/studio#capability-state-ledger`}');
		expect(canvas).toContain('Capability posture');
		expect(canvas).toContain('fieldVisibleContractCount');
		expect(canvas).toContain('<Ratio height={6} segments={fieldStateRatioSegments} />');
		expect(canvas).toContain('visible armed capability contracts');
		expect(canvas).toContain('visible bounded capability contracts');
		expect(canvas).toContain('visible draft-only capability contracts');
		expect(canvas).toContain('visible not-armed capability contracts');
		expect(canvas).toContain('fieldCoveredClusterCount');
		expect(canvas).toContain('.dock-posture-counts');
		expect(canvas).toContain('grid-template-columns: repeat(5, minmax(0, auto));');
		expect(canvas).toContain(
			'<span class="dock-unlock">{readout.unlock} · {readout.gateTasks}</span>'
		);
		expect(canvas).toContain('grid-template-columns: repeat(4, minmax(9.5rem, 1fr));');
		expect(canvas).toContain('min-height: 6.05rem;');
		expect(canvas).toContain('max-height: min(72vh, 24rem);');
		expect(canvas).toContain('.dock-effect {');
			expect(canvas).toContain('<span class="dock-state">{stateLabel(readout.state)}</span>');
			expect(canvas).toContain('aria-label="Primary capability commands"');
			expect(canvas).toContain('class="dock-command dock-command--author"');
			expect(canvas).toContain('data-state={studioAuthoringReadiness.state}');
			expect(canvas).toContain(
				"{authoringRuntimeReady ? 'Start authoring' : 'Authoring boundary'}"
			);
			expect(canvas).toContain('<span class="dock-signal">{studioAuthoringReadiness.signal}</span>');
			expect(canvas).toContain('studioAuthoringReadiness.boundaryCount');
			expect(canvas).toContain('buildStudioAuthoringReadiness boundaryCount');
			expect(canvas).toContain("authoringRuntimeReady ? 'open Studio intent' : 'read authoring boundary'");
			expect(canvas).toContain(".dock-command--author[data-state='partial']");
			expect(canvas).toContain(".dock-command--author[data-state='draft-only']");
			expect(canvas).toContain('<span class="dock-label">Find capability</span>');
				expect(canvas).toContain('<span class="dock-signal">Handoffs, gates, proof</span>');
			expect(canvas).toContain(
				'aria-label="Find capability across Studio, People, Power, Results, gates, proof, and running processes"'
			);
			expect(canvas).toContain('title="Find capability (⌘K)"');
			expect(canvas).toContain('let finderOpen = $state(false)');
			expect(canvas).toContain('function openFinder()');
			expect(canvas).toContain('function closeFinder()');
			expect(canvas).toContain('function onFinderKey(e: KeyboardEvent)');
			expect(canvas).toContain('class="dock-command dock-command--finder"');
			expect(canvas).toContain(
				'<CanvasCapabilityFinder open={finderOpen} {targets} onSelect={flyToTarget} onClose={closeFinder} />'
			);
				expect(canvas).toContain('class="dock-map-state"');
				expect(canvas).toContain("detail === 'glyph' ? 'Whole map' : detail === 'summary' ? 'Scan' : 'Detail'");
				expect(canvas).toContain('aria-label="Capability map scale"');
			expect(canvas).toContain('press 0 or backslash for the whole map');
			expect(canvas).toContain('.field-contract');
			expect(canvas).toContain('grid-area: contract;');
			expect(canvas).toContain("'contract contract contract'");
			expect(canvas).toContain('const fieldLoopPhases');
			expect(canvas).toContain('aria-label="Verified action loop phases"');
			expect(canvas).toContain('.field-loop-strip');
			expect(canvas).toContain('grid-area: loop;');
			expect(canvas).toContain("'loop loop loop'");
			expect(canvas).toContain("label: 'Aggregate proof'");
			expect(canvas).not.toContain("label: 'Return proof'");
			expect(canvas).toContain('...fieldLoopPhases.map((phase) => ({');
			expect(canvas).toContain('<span class="field-contract-label">State ledger</span>');
			expect(canvas).toContain('<span class="field-contract-label">Coverage</span>');
			expect(canvas).toContain('<Ratio height={5} segments={fieldStateRatioSegments} />');
			expect(canvas).toContain('.field-action-strip');
			expect(canvas).toContain(
				'aria-label="Claim boundary, next moves, and launch pressure"'
			);
			expect(canvas).toContain('grid-area: action;');
			expect(canvas).toContain("'action action action';");
			expect(canvas).toContain('.field-claim-grid');
			expect(canvas).toContain('.field-next-grid');
			expect(canvas).toContain('.field-pressure-grid');
			expect(canvas).not.toContain('<span class="dock-label">Search map</span>');
			expect(canvas).not.toContain('title="Search map (⌘K)"');
			expect(canvas).not.toMatch(/summon/i);
			expect(palette).toContain('CanvasCapabilityFinder');
				expect(palette).toContain('placeholder="Search capability, state, cluster, gate..."');
				expect(palette).toContain('aria-label="Search the capability map"');
				expect(palette).not.toMatch(/summon/i);
			expect(canvas).not.toContain('class="dock-chip');
			expect(canvas).not.toContain('class="dock-control dock-control--area"');
			expect(canvas).not.toContain('aria-label="Map focus"');
			expect(canvas).not.toContain('>Compose<');
			expect(mantle).toContain("import { PenLine } from '@lucide/svelte';");
			expect(mantle).toContain("import type { StudioAuthoringReadinessSummary }");
			expect(mantle).toContain('studioAuthoringReadiness?: StudioAuthoringReadinessSummary | null;');
			expect(mantle).toContain(
				'const authoringRuntimeReady = $derived(studioAuthoringReadiness?.runtimeReady === true);'
			);
			expect(mantle).toContain(
				"authoringRuntimeReady ? 'Start authoring' : 'Authoring boundary'"
			);
			expect(mantle).toContain('data-state={authoringCommandState}');
			expect(mantle).toContain('cite="buildStudioAuthoringReadiness boundaryCount"');
			expect(mantle).not.toContain('>Compose</span>');
			expect(layout).toContain('{studioAuthoringReadiness}');
			expect(hypergraph).toContain('runtimeReady: boolean;');
			expect(hypergraph).toContain('runtimeReady: authoringRuntimeReady');
			expect(canonicalDoc).toContain('**Strong center — authoring command.**');
			expect(canonicalDoc).toContain(
				'The home action is state-bound, not a generic compose affordance.'
			);
			expect(capabilityScope).toContain(
				'The Mantle strong authoring command now consumes `buildStudioAuthoringReadiness`'
			);
		expect(canvas).not.toContain('aria-label="Field status"');
		expect(canvas).not.toContain('press 0 or backslash for the overview');
		expect(canvas).not.toContain(
			"return state === 'live' ? 'live' : state === 'partial' ? 'partial' : 'gated';"
		);
		expect(canvas).not.toContain('title="Move to {REGIONS[rid].label} (press {i + 1})"');

		expect(processDock).toContain("import { Square, X } from '@lucide/svelte';");
		expect(processDock).toContain("import { Datum } from '$lib/design';");
		expect(processDock).toContain("const STATUS_ACTION: Record<OrgProcess['status'], string>");
		expect(processDock).toContain('const runningCount = $derived(os.runningProcesses.length)');
		expect(processDock).toContain('function runAriaLabel(p: OrgProcess): string');
		expect(processDock).toContain('aria-label="Studio authoring runs"');
		expect(processDock).toContain('<span class="dock-label">Studio runs</span>');
		expect(processDock).toContain('<Datum value={runningCount} cite="orgOS runningProcesses" />');
		expect(processDock).toContain('aria-label={runAriaLabel(p)}');
		expect(processDock).toContain('<span class="chip-run-action">{STATUS_ACTION[p.status]}</span>');
		expect(processDock).toContain('aria-label="Stop Studio run {p.title}"');
		expect(processDock).toContain('aria-label="Dismiss Studio run {p.title}"');
		expect(processDock).not.toContain('aria-label="Authoring processes"');
		expect(processDock).not.toContain('<span class="dock-label">Processes</span>');
		expect(processDock).not.toContain('aria-label="Stop process"');
		expect(processDock).not.toContain('aria-label="Dismiss process"');
		expect(processDock).not.toContain('<svg viewBox');
		expect(canonicalDoc).toContain(
			'The persistent Mantle process center names the live registry as **Studio runs**'
		);
		expect(canonicalDoc).toContain('shows a `Datum` count of running work');

				expect(fieldNode).toContain('const detailActionLabel = $derived.by');
				expect(fieldNode).toContain("import { formatCapabilityClusters } from '$lib/data/capability-clusters';");
				expect(fieldNode).toContain('operatorCapabilityStateLabel');
				expect(fieldNode).toContain("import type { DataConstellationObject } from './constellation';");
				expect(fieldNode).toContain("import { constellationCapabilityContract } from './constellation-capability-contract';");
				expect(fieldNode).toContain('object: DataConstellationObject;');
				expect(fieldNode).toContain('const capabilityContract = $derived(constellationCapabilityContract(object));');
				expect(fieldNode).toContain('const detailActionLabel = $derived.by(() => capabilityContract.action);');
				expect(constellation).toContain('export type DataConstellationObject = Exclude<');
				expect(canvas).toContain('type DataConstellationObject,');
				expect(canvas).toContain('const dataObjects = $derived<DataConstellationObject[]>');
				expect(canvas).toContain('(o): o is DataConstellationObject => o.type !==');
				expect(constellationContract).toContain('export type ConstellationCapabilityContract');
				expect(constellationContract).toContain("import type { DataConstellationObject } from './constellation';");
				expect(constellationContract).toContain('object: DataConstellationObject');
				expect(constellationContract).toContain('action: string;');
				expect(constellationContract).toContain('handoff: string;');
				expect(constellationContract).toContain('effect: string;');
			expect(constellationContract).toContain("label: 'Action record'");
			expect(constellationContract).toContain("action: 'Open action record'");
			expect(constellationContract).toContain("handoff: 'Action record'");
			expect(constellationContract).toContain("clusters: 'C-coordination-integrity / C-accountability'");
			expect(constellationContract).toContain("getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2']");
			expect(constellationContract).toContain("label: 'People verification signal'");
			expect(constellationContract).toContain("handoff: 'People ledger'");
			expect(constellationContract).toContain("clusters: 'C-reach / C-verification'");
			expect(constellationContract).toContain("getGateEvidence('CP-platform-api-sync', ['T1-3']");
			expect(constellationContract).toContain(
				'Encrypted credential custody + direct sync execution'
			);
			expect(constellationContract).toContain("label: 'Consent-bound reach'");
			expect(constellationContract).toContain("action: 'Open consent-bound reach'");
			expect(constellationContract).toContain("handoff: 'Consent-bound reach'");
			expect(constellationContract).toContain("clusters: 'C-reach / C-data-sovereignty'");
			expect(constellationContract).toContain("getGateEvidence('CP-custom-domain-dkim', ['T2-6']");
			expect(constellationContract).toContain("label: 'Power target'");
			expect(constellationContract).toContain("handoff: 'Power targets'");
			expect(constellationContract).toContain("getGateEvidence('CP-state-local-terrain', ['T3-1', 'T3-2', 'T3-10']");
			expect(constellationContract).toContain("label: 'Bills terrain'");
			expect(constellationContract).toContain("handoff: 'Bills terrain'");
			expect(constellationContract).toContain("clusters: 'C-accountability / C-quality-signaling'");
			expect(constellationContract).toContain("getGateEvidence('CP-state-bill-terrain', ['T6-6', 'T3-1']");
			expect(constellationContract).toContain("label: 'Accountability response'");
			expect(constellationContract).toContain("handoff: 'Accountability scores'");
			expect(constellationContract).toContain("clusters: 'C-accountability / C-reader-side'");
			expect(constellationContract).toContain("'CP-reader-office-profile'");
			expect(constellationContract).toContain("['T8-1a', 'T8-1b', 'T8-8']");
			expect(constellationContract).toContain(
				'Decision-maker office profile enrichment, office-response workflow, and notification webhooks'
			);
			expect(constellationContract).not.toContain('staffer dashboard');
				expect(constellationContract).toContain("label: 'Reader proof'");
				expect(constellationContract).toContain("handoff: 'Proof delivery'");
				expect(constellationContract).toContain("clusters: 'C-verification / C-reader-side'");
				expect(constellationContract).toContain('const _exhaustive: never = object;');
				expect(constellationContract).not.toContain('default:');
				expect(constellationContract).not.toContain("label: 'Capability'");
				expect(constellationContract).not.toContain("action: 'Open capability'");
				expect(constellationContract).not.toContain(
					'Opens the closest available capability boundary'
				);
				expect(constellationContract).not.toContain("label: 'People activity'");
				expect(constellationContract).not.toContain('OrgSpacesData.return.recentActivity');
			expect(constellationContract).not.toContain(
				"getGateEvidence('CP-civic-geography-labels', ['T1-8c']"
			);
			expect(fieldNode).toContain('const capabilityGateSummary = $derived');
			expect(fieldNode).toContain("formatGateEvidence(capabilityContract.gate, { density: 'operator' })");
		expect(fieldNode).toContain('const capabilityGateLabel = $derived');
		expect(fieldNode).toContain('data-state={capabilityContract.state}');
		expect(fieldNode).toContain('data-clusters={capabilityContract.clusters}');
		expect(fieldNode).toContain('data-gate={capabilityContract.gate.id}');
		expect(fieldNode).toContain('<div');
		expect(fieldNode).toContain('class="capability-contract"');
		expect(fieldNode).toContain('{operatorCapabilityStateLabel(capabilityContract.state)}');
		expect(fieldNode).toContain('{formatCapabilityClusters(capabilityContract.clusters)}');
			expect(fieldNode).toContain('class="capability-gate"');
			expect(fieldNode).toContain('<span class="capability-gate-label">{capabilityGateLabel}</span>');
			expect(fieldNode).toContain('<span class="capability-gate-name">{capabilityContract.gate.name}</span>');
			expect(fieldNode).toContain('<span class="capability-gate-tasks">{capabilityContract.gate.tasks}</span>');
			expect(fieldNode).toContain('class="capability-handoff"');
			expect(fieldNode).toContain('<span class="capability-handoff-value">{capabilityContract.handoff}</span>');
			expect(fieldNode).toContain('<span class="capability-handoff-effect">{capabilityContract.effect}</span>');
			expect(fieldNode).not.toMatch(/ActionNetwork|Action Network/);
			expect(constellationContract).not.toMatch(/ActionNetwork|Action Network/);
		expect(constellation).toContain("detailHref: '__DETAIL__/supporters#people-ledger-boundary'");
		expect(constellation).toContain("detailHref: '__DETAIL__/supporters#email-health'");
		expect(constellation).toContain("detailHref: '__DETAIL__/representatives#power-reach-boundary'");
		expect(constellation).toContain("detailHref: '__DETAIL__/legislation#bill-terrain-boundary'");
		expect(constellation).toContain("detailHref: '__DETAIL__/scorecards#scorecard-list'");
		expect(constellation).toContain("report#proof-delivery");
		expect(canvas).toContain('action: contract.action');
		expect(camera).toContain('contract.handoff');
		expect(camera).toContain('contract.effect');
		expect(camera).toContain('operatorCapabilityActionLabel,');
		expect(camera).toContain('actionLabel: operatorCapabilityActionLabel(contract.state, contract.action)');
		expect(camera).toContain('handoff: contract.handoff');
		expect(camera).toContain('effect: contract.effect');
		expect(camera).toContain('target.actionLabel');
		expect(camera).toContain('target.handoff');
		expect(camera).toContain('target.effect');
		expect(fieldNode).toContain('{detailActionLabel} →');
		expect(fieldNode).not.toContain('Open details →');

				expect(palette).toContain('aria-label="Search the capability map"');
				expect(palette).toContain('placeholder="Search capability, state, cluster, gate..."');
				expect(palette).toContain('aria-label="Capability map search"');
				expect(palette).toContain('aria-label="Capability targets"');
				expect(palette).toContain('<kbd class="sm-kbd">↵</kbd> move');
				expect(palette).toContain("function targetKindLabel(kind: CameraTarget['kind']): string");
			expect(palette).toContain('function targetAriaLabel(t: CameraTarget): string');
			expect(palette).toContain("if (kind === 'object') return 'capability';");
			expect(palette).toContain("if (kind === 'region') return 'workspace';");
			expect(palette).toContain("return 'whole map';");
			expect(palette).toContain('aria-label={targetAriaLabel(t)}');
			expect(palette).toContain('data-state={t.state}');
			expect(palette).toContain('{t.stateLabel}');
			expect(palette).toContain('t.actionLabel ? `action ${t.actionLabel}` : null');
			expect(palette).toContain('t.handoff ? `handoff ${t.handoff}` : null');
			expect(palette).toContain('{t.actionLabel}');
			expect(palette).toContain('{t.handoff}');
			expect(palette).toContain('{t.clusterLabels}');
			expect(palette).toContain('{t.gateName}');
			expect(palette).toContain('{t.gateTasks}');
			expect(palette).toContain('{targetKindLabel(t.kind)}');
				expect(palette).not.toContain("if (kind === 'object') return 'open';");
				expect(palette).not.toContain("t.kind === 'object' ? 'view' : t.kind");
				expect(palette).not.toContain('aria-label="Destinations"');
				expect(palette).not.toContain('aria-label="Capability destinations"');
				expect(palette).not.toContain('<kbd class="sm-kbd">↵</kbd> view');
				expect(palette).toContain('--search-text: oklch(0.22 0.016 250);');
		expect(palette).toContain('background: oklch(0.99 0.003 60 / 0.98);');
		expect(palette).not.toContain('backdrop-filter');
		expect(palette).not.toMatch(/frosted/i);
		expect(palette).not.toMatch(/workspace map/i);

			expect(camera).toContain("group: 'Workspaces'");
			expect(camera).toContain("label: 'Whole map'");
			expect(camera).toContain("sublabel: 'Capability map'");
			expect(camera).toContain(
				"import { formatCapabilityClusters } from '$lib/data/capability-clusters';"
			);
			expect(camera).toContain('operatorCapabilityStateLabel,');
			expect(camera).toContain(
				"import { constellationCapabilityContract } from './constellation-capability-contract';"
			);
			expect(camera).toContain('searchTokens: string[];');
			expect(camera).toContain('state: OperatorCapabilityState | null;');
			expect(camera).toContain('clusterLabels: string | null;');
			expect(camera).toContain('gateTasks: string | null;');
			expect(camera).toContain('function objectCapabilityTargetFields(object: ConstellationObject)');
			expect(camera).toContain('const contract = constellationCapabilityContract(object);');
			expect(camera).toContain('const clusterLabels = formatCapabilityClusters(contract.clusters);');
			expect(camera).toContain('const stateLabel = operatorCapabilityStateLabel(contract.state);');
			expect(camera).toContain('export function targetSearchTokens(target: CameraTarget): string[]');
			expect(camera).toContain('export function targetSearchText(target: CameraTarget): string');
			expect(camera).toContain('...target.searchTokens');
			expect(camera).toContain('function scoreTarget(target: CameraTarget, query: string): number');
			expect(camera).toContain('scoreTarget(t, query) > 0');
			expect(camera).not.toContain('scoreLabel(targetSearchText(t), query) > 0');
			expect(camera).not.toContain("label: 'Overview'");
			expect(camera).not.toContain("sublabel: 'Whole capability map'");
			expect(camera).not.toContain("group: 'Areas'");
		expect(camera).not.toMatch(/workspace-map/i);
			expect(canonicalDoc).toContain(
				'The command rail is named and exposed as the **Workspace capability dock: command rail for Studio, People, Power, Results, and running processes**'
			);
			expect(canonicalDoc).toContain(
				'Find capability stays Cmd-K; palette target kinds read **capability**, **workspace**, or **whole map**, the zoom state says **Whole map / Scan / Detail**, and workspace controls carry the same state, `operatorCapabilityActionLabel` action, cited signal, and next-unlock aria contract as the top posture rail.'
			);
			expect(canonicalDoc).toContain(
				'The finder overlay uses a flat cream scrim and panel, never backdrop-filter or frosted blur.'
			);
			expect(canonicalDoc).toContain(
				'Capability-object targets expose action label, handoff, clusters, and gate evidence in the result row'
			);
			expect(canonicalDoc).toContain(
				'the map-scoped finder indexes the same target contract vocabulary'
			);
			expect(canonicalDoc).toContain(
				"while selecting only existing camera targets from `buildTargets`"
			);
			expect(canonicalDoc).toContain(
				'HUD readouts, workspace rails, next-move tiles, and dock controls are flat high-contrast operating targets with stable heights'
			);
			expect(canonicalDoc).toContain(
				'Each workspace control keeps state, cited signal, route effect, state-aware action grammar, and next unlock visible in a stable desktop cell'
			);
			expect(capabilityScope).toContain(
				'The optional map dock now exposes workspace route effects in the visible rail, not only in title or accessible text.'
			);
		expect(canonicalDoc).toContain(
			'The canvas also mirrors a compact **Next moves** strip in the first viewport'
		);
				expect(canonicalDoc).toContain(
					'The visible loop labels are **Define action**, **Attach ground**, **Author artifact**, **Resolve power target**, **Deliver only armed channels**, and **Aggregate proof**'
				);
				expect(canonicalDoc).toContain(
					'The canvas INTENT phase consumes the `intent` row from `buildStudioAuthoringReadiness`'
				);
				expect(canonicalDoc).toContain(
					'The canvas GROUND phase consumes `buildPeopleSourceProvenanceReadiness` for state/action/metric'
				);
				expect(canonicalDoc).toContain(
					'The canvas RESOLVE phase and Power workspace rail reuse the same `powerLoop*` contract from `buildPowerTerrainReadiness`'
				);
			expect(canonicalDoc).toContain(
				'The canvas AUTHOR phase consumes the `message-composition` row from `buildStudioAuthoringReadiness`'
			);
			expect(canonicalDoc).toContain(
				'The operating readout, Studio workspace-posture card, operating posture rail, operational-shift row, and map-scoped authoring fallback reuse the same `authoringLoop*` contract'
			);
			expect(canonicalDoc).toContain(
				'The canvas AGGREGATE phase and Results workspace rail reuse the same `resultsLoop*` contract from `buildResultsProofReadiness`'
			);
				expect(canonicalDoc).toContain(
					'the compact canvas People workspace rail consumes the same list-health metric, action, state, and source-custody gate'
				);
				expect(canonicalDoc).toContain(
					'The full-map People workspace-posture card follows the same rule as the Mantle People mark and compact People rail'
				);
				expect(canonicalDoc).toContain('A raw subscribed count cannot mark People live');
				expect(canonicalDoc).toContain(
					'The folded People workspace (`BaseSpace`), compact canvas People rail, and the deep `/supporters` ledger consume'
				);
			expect(capabilityScope).toContain(
				'The compact canvas AUTHOR phase consumes the `message-composition` row from `buildStudioAuthoringReadiness`'
			);
			expect(capabilityScope).toContain(
				'The top operating readout, Studio workspace-posture card, authoring posture row, and authoring shift reuse the same `authoringLoopState`, `authoringLoopSummary`, `authoringLoopGate`, `authoringLoopMetric`, and `authoringLoopNextLift`'
			);
			expect(capabilityScope).toContain(
				'no first-scan authoring surface can claim armed streams or count armed loop phases as Studio ground'
			);
			expect(capabilityScope).toContain(
				'The compact canvas INTENT phase consumes the `intent` row from `buildStudioAuthoringReadiness`'
			);
			expect(capabilityScope).toContain(
				'publish authority cannot either promote Studio authoring or downgrade it to a permission gate'
			);
			expect(capabilityScope).toContain(
				'non-publisher Send and workspace-posture boundary copy comes from `buildSendReadiness.sendBoundarySummary` / `nextHeldLabel`'
			);
			expect(capabilityScope).toContain(
				'naming org authority for delivery-surface draft handoff and the first held send handoff'
			);
			expect(capabilityScope).toContain(
				'The compact canvas GROUND phase consumes `buildPeopleSourceProvenanceReadiness` for state, action, metric, and cite'
			);
				expect(capabilityScope).toContain(
					'The compact canvas People workspace rail consumes `buildEmailListHealthReadiness` for state, metric, action, and next gate'
				);
				expect(capabilityScope).toContain(
					'The full-map People workspace-posture card now consumes `emailListHealthReadiness` and `peopleSourceProvenanceReadiness` directly'
				);
				expect(capabilityScope).toContain(
					'It must not promote `emailHealth.subscribed > 0` into a live People workspace claim'
				);
				expect(capabilityScope).toContain(
					'The compact canvas RESOLVE phase and Power workspace rail reuse the same `powerLoopState`, `powerLoopMetric`, `powerLoopGate`, and `powerLoopNextLift` contract from `buildPowerTerrainReadiness`'
				);
				expect(capabilityScope).toContain(
					'The compact canvas AGGREGATE phase and Results workspace rail reuse the same `resultsLoopState`, `resultsLoopMetric`, `resultsLoopGate`, and `resultsLoopNextLift` contract from `buildResultsProofReadiness`'
				);
			expect(canonicalDoc).not.toContain('**Route armed**');
			expect(canonicalDoc).not.toContain('**Return proof**');
			expect(canonicalDoc).toContain(
				'Grounded authoring and Studio scope rows consume `buildStudioAuthoringReadiness`, `buildStudioScopeReadiness`, and `os.studioProcessEvidence`'
			);
			expect(canonicalDoc).toContain(
				"The map's idle/intent Studio node renders a compact **Grounded authoring contract**"
			);
			expect(canonicalDoc).toContain(
				'A disabled authoring runtime therefore reads as dependency-first at the point of action'
			);
			expect(canonicalDoc).toContain(
				'no authoring surface may default missing authoring ground to armed'
			);
			expect(canonicalDoc).toContain('OrgSpacesData.operating.authoring');
		expect(canonicalDoc).toContain(
			'model provider, source discovery, and page-read evaluation are connected'
		);
		expect(canonicalDoc).toContain(
			'Each tile exposes handoff, effect, state-aware action grammar, cited `Datum`, and gate text'
		);
		expect(canonicalDoc).toContain('not a tiny bottom row of route chips');
		expect(canonicalDoc).toContain(
			'Every full-map data object also renders a compact capability contract'
		);
		expect(canonicalDoc).toContain(
			'canonical cluster labels through `formatCapabilityClusters`'
		);
		expect(canonicalDoc).toContain(
			'Each object contract carries a route handoff, route effect, and hypergraph-backed next-lift gate rendered as gate name plus task IDs'
		);
		expect(canonicalDoc).toContain(
			'Object handoffs land on the most specific stable anchor the route already owns'
		);
		expect(canonicalDoc).toContain('object nodes do not own route-local task slogans');
		expect(constellation).toContain('People as proof-weighted reach');
		expect(constellation).toContain('Results artifacts: Verification Packet(s) +');
		expect(constellation).toContain('bounded receipt/response posture');
		expect(constellation).toContain("export type RegionId = 'STUDIO' | 'PEOPLE' | 'POWER' | 'RESULTS'");
		expect(constellation).toContain(
			"export const REGION_ORDER: RegionId[] = ['STUDIO', 'PEOPLE', 'POWER', 'RESULTS']"
		);
		expect(constellation).toContain("id: 'people-funnel'");
		expect(constellation).toContain("id: 'people-email-health'");
		expect(constellation).not.toContain("id: 'results-activity'");
		expect(constellation).not.toContain("type: 'activity'");
		expect(constellation).not.toContain('ReturnSpaceActivity');
		expect(constellation).not.toContain('recentActivity');
		expect(constellation).not.toContain("id: 'base-funnel'");
		expect(constellation).not.toContain("id: 'base-email-health'");
		expect(constellation).not.toContain("id: 'return-activity'");
		expect(camera).toContain("STUDIO: 'Author in Studio'");
		expect(camera).toContain("PEOPLE: 'Reachable people'");
		expect(camera).toContain("RESULTS: 'Proof and response'");
		expect(canvas).toContain("flyToRegion('STUDIO')");
		expect(canvas).toContain("flyToRegion('PEOPLE')");
		expect(canvas).toContain("flyToRegion('RESULTS')");
		expect(canvas).toContain(".dock-control--workspace[data-workspace='STUDIO']");
		expect(canvas).toContain(".dock-control--workspace[data-workspace='PEOPLE']");
		expect(canvas).toContain(".dock-control--workspace[data-workspace='RESULTS']");
		expect(canvas).not.toContain("flyToRegion('WORK')");
		expect(canvas).not.toContain("flyToRegion('BASE')");
		expect(canvas).not.toContain("flyToRegion('RETURN')");
		expect(canvas).not.toContain("data-workspace='WORK'");
		expect(canvas).not.toContain("data-workspace='BASE'");
		expect(canvas).not.toContain("data-workspace='RETURN'");
		expect(constellation).not.toMatch(/people base|what came back/i);
		expect(orgOS).toContain(
			"export const SPACE_LABELS: Record<SpaceId, 'Studio' | 'People' | 'Power' | 'Results'>"
		);
		expect(orgOS).toContain("base: 'People'");
		expect(orgOS).toContain("landscape: 'Power'");
		expect(orgOS).toContain("return: 'Results'");
		expect(orgOS).not.toContain('four persistent spatial contexts');
		expect(spacesContract).toContain('Results: proof and response');
		expect(spacesContract).toContain('People: proof-weighted reach');
		expect(spacesContract).not.toContain('internal return slice');
		expect(spacesContract).not.toContain('internal base slice');
		expect(spacesContract).toContain('Power: targets, bills, and accountability');
		expect(spacesContract).not.toContain('internal landscape slice');
		expect(spacesContract).not.toMatch(
			/what came back|the people you reach|terrain you author against/i
		);
		expect(orgShell).toContain('SPACE_LABELS,');
		expect(orgShell).toContain('aria-label="{SPACE_LABELS.studio} workspace"');
		expect(orgShell).toContain('aria-label="{SPACE_LABELS.base} workspace"');
		expect(orgShell).toContain('aria-label="{SPACE_LABELS.landscape} workspace"');
		expect(orgShell).toContain('aria-label="{SPACE_LABELS.return} workspace"');

		expect(peopleSpace).toContain('BaseSpace — People: proof-weighted reach.');
		expect(peopleSpace).toContain('People slice from the layout load');
		expect(peopleSpace).not.toMatch(/the people you can reach|switching INTO BASE/i);
		expect(powerSpace).toContain('buildPowerTerrainReadiness,');
		expect(powerSpace).toContain('type PowerTerrainRow');
		expect(powerSpace).toContain('WorkspaceCapabilityStrip label="Power capability"');
		expect(powerSpace).toContain('Power terrain coverage');
		expect(powerSpace).toContain('into Power is a pure state toggle');
		expect(powerSpace).not.toMatch(/INTO LANDSCAPE|LANDSCAPE is the composed/i);
		expect(hypergraph).toContain("label: 'Current target records'");
		expect(powerSpace).not.toContain("label: 'Decision terrain'");
		expect(resultsSpace).toContain('ReturnSpace — Results: proof and response.');
		expect(resultsSpace).toContain('Results slice from the layout load');
		expect(resultsSpace).toMatch(/packet is the reason Results exists/i);
		expect(resultsSpace).not.toMatch(/what came back/i);
			expect(processNode).toContain('Start authoring');
			expect(processNode).toContain('runDisabled = false');
			expect(processNode).toContain("runLabel = 'Start authoring'");
			expect(processNode).toContain('authoringReadiness = null');
			expect(processNode).toContain('authoringReadiness?: StudioAuthoringReadinessSummary | null;');
			expect(processNode).toContain('const canSubmitIntent = $derived(');
			expect(processNode).toContain(
				'Boolean(subjectLine.trim() && coreMessage.trim() && !runDisabled)'
			);
			expect(processNode).toContain('function submitIntent()');
			expect(processNode).toContain('if (!canSubmitIntent) return;');
			expect(processNode).toContain('submitIntent();');
			expect(processNode).toContain('const idleCommandState = $derived');
			expect(processNode).toContain("runDisabled ? 'gated' : (authoringReadiness?.state ?? 'live')");
			expect(processNode).toContain('const idleCommandAria = $derived');
			expect(processNode).toContain('class="intent-run intent-run--idle"');
			expect(processNode).toContain('data-state={idleCommandState}');
			expect(processNode).toContain('<span>{runLabel}</span>');
			expect(processNode).toContain('operatorCapabilityStateLabel(idleCommandState)');
			expect(processNode).not.toContain('Compose intent');
			expect(processNode).toContain('const authoringContractRows = $derived');
			expect(processNode).toContain("'source-grounding'");
			expect(processNode).toContain("'message-composition'");
			expect(processNode).toContain("'draft-handoff'");
			expect(processNode).toContain('Grounded authoring contract');
			expect(processNode).toContain('aria-label={authoringContractAria}');
			expect(processNode).toContain('operatorCapabilityStateLabel(row.state)');
			expect(processNode).toContain('data-state={row.state}');
			expect(processNode).toContain('title="{row.label}: {row.ground} Gate: {row.gate}"');
			expect(processNode).toContain('authoringReadiness?.liveStepCount');
			expect(processNode).toContain('disabled={!canSubmitIntent}');
			expect(processNode).not.toContain(
				'disabled={!subjectLine.trim() || !coreMessage.trim() || runDisabled}'
			);
			expect(processNode).toContain(
				'Authoring runtime ground is not attached; Studio can shape intent, but target resolution, source grounding, and message writing stay dependency-first.'
			);
			expect(processNode).toContain(
				'Intent can start a real reasoning loop: resolve a contactable target, ground sources, then author output.'
			);
			expect(processNode).not.toContain(
				'Compose an intent; Commons resolves targets, grounds sources, and authors with a live trace.'
			);
			expect(canvas).toContain('authoringReadiness={studioAuthoringReadiness}');
			expect(processNode).not.toContain('Spawn process');
			expect(processNode).not.toContain('lives in the kernel');
			expect(processNode).not.toContain('radial-gradient');
			expect(processNode).toContain('const sourceEvidenceObserved = $derived');
			expect(processNode).toContain('sourceEvidenceEvaluatedCount');
			expect(processNode).toContain('sourceEvidenceSearchOnlyCount');
			expect(processNode).toContain('<span class="section-label">Source ground</span>');
			expect(processNode).toContain('aria-label="Source ground evidence"');
			expect(processNode).toContain(
				'Search-only rows are context, not evaluated source evidence.'
			);
			expect(processNode).toContain('src-pos--search-only');
			expect(processNode).toContain('publish handoffs gated');
			expect(processNode).toContain(
				'Route handoffs and publish side effects require org authority.'
			);
			expect(processNode).not.toContain('view only');
			expect(canonicalDoc).toContain(
				'Non-publisher process nodes read **publish handoffs gated** rather than "view only"'
			);
			expect(capabilityScope).toContain(
				'Non-publisher Studio process nodes read **publish handoffs gated**, not "view only"'
			);
			expect(processNode).not.toContain('Grounded · {sources.length} sources');

			expect(layout).toContain("label: 'People'");
			expect(layout).toContain("label: 'Power'");
			expect(layout).toContain("label: 'Results'");
			expect(layout).toContain("gloss: 'People you reach'");
			expect(layout).toContain("gloss: 'Decision-makers and bills'");
			expect(layout).toContain("gloss: 'Proof and response'");
			expect(layout).toContain('const powerWorkspaceSignal = $derived<WorkspaceSignal>');
			expect(layout).toContain('state: powerTerrainReadiness.state');
			expect(layout).toContain('signal: powerWorkspaceSignal');
			expect(layout).toContain('const resultsWorkspaceSignal = $derived<WorkspaceSignal>');
			expect(layout).toContain('state: resultsProofReadiness.state');
			expect(layout).toContain('signal: resultsWorkspaceSignal');
			expect(layout).not.toContain("label: 'receipts'");
			expect(layout).not.toContain("cite: 'bounded receipt summary'");
			expect(layout).toContain("label: 'Action records'");
		expect(layout).not.toContain("label: 'Action campaigns'");
		expect(layout).toContain("name: 'Direct platform sync'");
		expect(layout).toContain("label: 'Platform export intake'");
		expect(layout).toContain('href: `${base}/supporters/import#csv-intake`');
		expect(layout).toContain('buildPlatformIntakeReadiness,');
		expect(layout).toContain('const platformIntakeReadiness = $derived(');
		expect(layout).toContain(
			'const platformExportProfileSignal = $derived(platformIntakeReadiness.signal)'
		);
		expect(layout).not.toContain("from '$lib/data/platform-export-profiles'");
		expect(layout).toContain('signal: platformExportProfileSignal');
		expect(layout).not.toContain("signal: 'AN / VAN / NB / MC'");
		expect(layout).toContain('gate: platformIntakeReadiness.gate');
		expect(spotlight).toContain(
			'aria-label="Spotlight — search capabilities, workspaces, or handoffs"'
		);
		expect(spotlight).toContain('placeholder="Search capabilities, workspaces, handoffs…"');
		expect(spotlight).toContain('aria-label="Capability command search"');
		expect(spotlight).toContain('aria-label="Capabilities, workspaces, and handoffs"');
		expect(commandBar).toContain('aria-label="Find capability"');
		expect(commandBar).toContain('<span class="cmdk-trigger-label">Find capability</span>');
		expect(commandBar).not.toContain('<span class="cmdk-trigger-label">Jump</span>');
		expect(layout).toContain("group: 'Workspaces'");
		expect(layout).not.toContain("group: 'Spaces'");
		expect(spotlight).toContain('function destinationSearchText(d: SpotlightDestination): string');
		expect(spotlight).toContain('handoff?: string;');
		expect(spotlight).toContain('effect?: string;');
		expect(switcher).toContain('handoff?: string;');
		expect(switcher).toContain('effect?: string;');
		expect(spotlight).toContain('d.state ? stateLabel(d.state) : null');
		expect(spotlight).toContain("d.latent ? 'not armed latent held' : null");
		expect(spotlight).toContain('function handoffLabel(d: SpotlightDestination): string');
		expect(spotlight).toContain('function effectLabel(d: SpotlightDestination): string | null');
		expect(spotlight).toContain('handoffLabel(d),');
		expect(spotlight).toContain('effectLabel(d),');
		expect(spotlight).toContain('d.signal,');
		expect(spotlight).toContain('d.gate,');
		expect(spotlight).toContain('parts.push(`handoff ${handoffLabel(d)}`);');
		expect(spotlight).toContain('if (effect) parts.push(`effect ${effect}`);');
		expect(spotlight).toContain('class="sp-meta-field sp-handoff"');
		expect(spotlight).toContain('<span class="sp-meta-label">handoff</span>');
		expect(spotlight).toContain('class="sp-meta-field sp-effect"');
		expect(spotlight).toContain('<span class="sp-meta-label">effect</span>');
		expect(spotlight).toContain('class="sp-meta-field sp-signal"');
		expect(spotlight).toContain('<span class="sp-meta-label">signal</span>');
		expect(spotlight).toContain('class="sp-meta-field sp-gate"');
		expect(spotlight).toContain('<span class="sp-meta-label">gate</span>');
		expect(spotlight).not.toContain('<span class="sp-signal">{d.signal}</span>');
		expect(spotlight).not.toContain('<span class="sp-gate">{d.gate}</span>');
		expect(layout).toContain('...capabilityDestinations.map((d) => ({');
		expect(layout).toContain('handoff: d.handoff ?? d.label');
		expect(layout).toContain('effect: d.effect ?? d.sublabel ?? d.signal ?? d.gate');
		expect(layout).toContain('handoff: `${m.label} workspace`');
		expect(layout).toContain(
			'effect: `${m.gloss}; switches mounted ${m.label} workspace without remounting Studio work.`'
		);
		expect(layout).toContain('handoff: s.handoff ?? s.label');
		expect(layout).toContain('effect: s.effect ?? s.sublabel ?? s.signal ?? s.gate');
		expect(spotlight).toContain('actionLabel(d)');
		expect(spotlight).toContain(
			'destinations.filter((d) => score(destinationSearchText(d), query) > 0)'
		);
		expect(spotlight).not.toContain('destinations.filter((d) => score(d.label, query) > 0)');
		expect(stateLabels).toContain("case 'live':");
		expect(stateLabels).toContain("return 'armed'");
		expect(stateLabels).toContain("case 'partial':");
		expect(stateLabels).toContain("return 'bounded'");
		expect(stateLabels).toContain("case 'gated':");
		expect(stateLabels).toContain("return 'not armed'");
		expect(stateLabels).toContain('export function operatorCapabilityStateVerbLabel');
		expect(stateLabels).toContain("return 'draft / shape'");
		expect(stateLabels).toContain("return 'context / read'");
		expect(stateLabels).toContain('export function operatorCapabilityActionLabel');
		expect(stateLabels).toContain("if (state === 'gated' || state === 'testnet')");
		expect(stateLabels).toContain("if (state === 'draft-only') return `draft / ${trimmedAction}`;");
		expect(switcher).toContain('operatorCapabilityStateLabel(mark.state)');
		expect(switcher).toContain('mark.signal.datum');
		expect(switcher).toContain('class="ws-signal" title={mark.signal.cite}');
		expect(switcher).toContain('min-width: min(18rem, calc(100vw - 2rem));');
		expect(switcher).toContain('.ws--horizontal .ws-signal {');
		expect(switcher).toContain('.ws--horizontal .ws-state-label {');
		expect(switcher).toContain('display: inline;');
		expect(switcher).not.toContain(
			'.ws--horizontal .ws-gloss,\n\t.ws--horizontal .ws-signal,\n\t.ws--horizontal .ws-state-label {\n\t\tdisplay: none;'
		);
		expect(switcher).not.toContain("live: 'Live'");
		expect(switcher).not.toContain("partial: 'Partial'");
		expect(switcher).not.toContain("gated: 'Gated'");
		expect(spotlight).toContain('return operatorCapabilityStateLabel(state);');
		expect(spotlight).not.toContain("if (state === 'draft-only') return 'draft'");
		expect(spotlight).not.toContain('jump to routes');
		expect(spotlight).not.toContain('spaces, routes');
		expect(spotlight).toContain('operatorCapabilityActionLabel,');
		expect(spotlight).toContain('return operatorCapabilityActionLabel(d.state, action);');
		expect(spotlight).not.toContain('if (d.action) return d.action;');
		expect(layout).toContain('operatorCapabilityActionLabel,');
		expect(layout).toContain('operatorCapabilityStateLabel');
		expect(layout).toContain("} from '$lib/data/capability-state-labels';");
		expect(layout).toContain(
			'function spotlightActionForState(state: SpotlightState, action: string): string'
		);
		expect(layout).toContain('return operatorCapabilityActionLabel(state, action);');
		expect(layout).not.toContain(
			"if (state === 'gated' || state === 'testnet') return `context / ${action}`;"
		);
		expect(layout).not.toContain("if (state === 'draft-only') return `draft / ${action}`;");
		expect(layout).toContain('const loadBearingGateSummary = $derived(');
		expect(layout).toContain(
			'const gateRegisterSummary = $derived(summarizeGateRegister(gateRegisterRows))'
		);
		expect(layout).toContain(
			'const loadBearingGateSummary = $derived(gateRegisterSummary.loadBearingGateSummary)'
		);
		expect(hypergraph).toContain(
			'Browser send proxy is not configured; browser-direct delivery remains bounded.'
		);
		expect(layout).not.toContain('${emailProxyGate.tasks} must land');
		expect(layout).not.toContain('Load-bearing gate: ${loadBearingGate?.tasks');
		expect(layout).not.toContain('gate: loadBearingGate?.tasks');
		expect(layout).toContain('function operatingGroundCapabilityState(');
		expect(layout).toContain("return state === 'draft-only' ? 'partial' : state;");
		expect(hypergraph).toContain('export type OperatingAuthorityRowKey =');
		expect(hypergraph).toContain('export function buildOperatingAuthorityReadiness');
		expect(hypergraph).toContain("'public-api-ground'");
		expect(hypergraph).toContain("'signed-webhooks'");
		expect(hypergraph).toContain("'owner-transfer-ceremony'");
		expect(hypergraph).toContain("'org-audit-log'");
		expect(hypergraph).toContain("'registry-environment'");
		expect(layout).toContain('buildOperatingAuthorityReadiness,');
		expect(layout).toContain("const auditLogGate = getGateEvidence('CP-audit-log', ['T9-5']");
		expect(layout).toContain('const operatingAuthorityReadiness = $derived(');
		expect(layout).toContain('const operatingAuthorityGroundRows = $derived(');
		expect(layout).toContain('const publishAuthorityOperatingRow = $derived(');
		expect(layout).toContain("row.id === 'publish-authority'");
		expect(layout).toContain('const publishAuthorityWorkspaceGate = $derived(');
		expect(layout).not.toContain(
			'Owner/editor authority is required before Studio can publish or send.'
		);
		expect(layout).toContain("'org-audit-log'");
		expect(layout).toContain('type OperatingGroundReadinessSource');
		expect(layout).toContain('function operatingGroundFromReadiness');
		expect(layout).toContain('function operatingGroundGateSignalFor');
		expect(layout).not.toContain('function operatingAuthorityGroundLabel');
		expect(layout).not.toContain('function operatingAuthorityGroundValue');
		expect(layout).not.toContain('function operatingAuthorityGroundState');
		expect(layout).not.toContain('function operatingAuthorityGroundGateSignal');
		expect(layout).toContain("id: 'capability-operating-authority'");
		expect(layout).toContain("label: 'Operating authority'");
		expect(layout).toContain('role={data.membership.role}');
		expect(layout).toContain('<OrgShell');
		expect(layout).toContain('spaces={data.spaces}');
		expect(layout).not.toContain(
			"state: FEATURES.PUBLIC_API ? operatingGroundCapabilityState(eventRecordsGate.state) : 'gated'"
		);
		expect(layout).not.toContain('gate: eventRecordsGate.tasks');
		expect(hypergraph).toContain("density?: 'audit' | 'operator'");
		expect(hypergraph).toContain("if (options.density === 'operator')");
		expect(hypergraph).toContain(
			'API docs and key routes do not own signed event delivery'
		);
		expect(hypergraph).toContain('this is event substrate, not a public API toggle');
		expect(hypergraph).toContain('export type SignedWebhookReadinessRowKey =');
		expect(hypergraph).toContain('export function buildSignedWebhookReadiness');
		expect(hypergraph).toContain("id: 'signed-event-substrate'");
		expect(hypergraph).toContain("id: 'endpoint-custody'");
		expect(hypergraph).toContain("id: 'delivery-attempt-register'");
		expect(hypergraph).toContain("id: 'reader-office-notification-boundary'");
		expect(hypergraph).toContain("id: 'durable-event-archive-boundary'");
		expect(hypergraph).toContain("label: 'Signed event substrate'");
		expect(hypergraph).toContain("label: 'Endpoint custody'");
		expect(hypergraph).toContain("label: 'Delivery attempt register'");
		expect(hypergraph).toContain("label: 'Reader-office notification boundary'");
		expect(hypergraph).toContain("label: 'Durable event archive boundary'");
		expect(hypergraph).toContain(
			'Signed webhook readiness separates event emission substrate, endpoint custody, sender-side delivery attempts'
		);
		expect(hypergraph).toContain('Receiver processing is not claimed.');
		expect(hypergraph).toContain(
			'Delivery attempts are loaded from the retry log; receiver-side processing remains outside Commons.'
		);
		expect(settings).toContain('buildOperatingAuthorityReadiness,');
		expect(settings).toContain("getGateEvidence('CP-outbound-webhooks', ['T9-3', 'T9-7', 'T6-9']");
		expect(settings).toContain("const auditLogGate = getGateEvidence('CP-audit-log', ['T9-5']");
		expect(settings).toContain('const operatingAuthorityReadiness = $derived(');
		expect(settings).toContain('const developerGroundRow = $derived(');
		expect(settings).toContain('const signedWebhookRow = $derived(');
		expect(settings).toContain('operatorCapabilityActionLabel');
		expect(settings).toContain('operatorCapabilityStateLabel');
		expect(settings).toContain('type AuthorityPressureReadout = {');
		expect(settings).toContain('const publishAuthorityRow = $derived');
		expect(settings).toContain('const auditLogAuthorityRow = $derived');
		expect(settings).toContain('const heldOperatingAuthorityRows = $derived');
		expect(settings).toContain('const firstHeldOperatingAuthorityRow = $derived');
		expect(settings).toContain('const nextAuthorityLiftRow = $derived');
		expect(settings).toContain(
			'const authorityPressureReadouts = $derived<AuthorityPressureReadout[]>(['
		);
		expect(settings).toContain("id: 'authority-ground'");
		expect(settings).toContain("label: 'Authority ground'");
		expect(settings).toContain("id: 'signed-substrate'");
		expect(settings).toContain("label: 'Signed substrate'");
		expect(settings).toContain("id: 'next-authority-lift'");
		expect(settings).toContain("label: 'Next authority lift'");
		expect(settings).toContain('publishAuthorityRow?.ground');
		expect(settings).toContain('signedWebhookRow?.boundary');
		expect(settings).toContain('nextAuthorityLiftRow?.boundary');
		expect(settings).toContain('function authorityRowHref(');
		expect(settings).toContain('aria-label="Org authority pressure"');
		expect(settings).toContain('{#each authorityPressureReadouts as readout (readout.id)}');
		expect(settings).toContain('actionLabel(readout.state, readout.action)');
		expect(settings).toContain('Plan limit ground');
		expect(settings).toContain("{portalLoading ? 'Opening...' : 'Open billing portal'}");
		expect(settings).toContain('Tier feature boundaries');
		expect(settings).toContain('Public API contract');
		expect(settings).toContain('Role authority');
		expect(settings).toContain('Invite role holder');
		expect(settings).toContain('Pending role invites');
		expect(settings).toContain('Legislative domain basis');
		expect(settings).toContain("{editingDomainId ? 'Edit domain basis' : 'Add domain basis'}");
		expect(settings).toContain(
			"domainSaving ? 'Saving...' : editingDomainId ? 'Update basis' : 'Add basis'"
		);
		expect(settings).toContain('PII encryption authority');
		expect(settings).not.toContain('Current Plan');
		expect(settings).not.toContain('Manage Billing');
		expect(settings).not.toContain('>Plans</h2>');
		expect(settings).not.toContain('>Team</h2>');
		expect(settings).not.toContain('Invite a team member');
		expect(settings).not.toContain('Pending Invites');
		expect(settings).not.toContain('Issue Domains');
		expect(settings).not.toContain('Supporter Encryption');
		expect(settings).not.toContain('REST API docs');
		expect(settings).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(settings).toContain(
			'return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });'
		);
		expect(settings).toContain('function pressureCellClass(state: CapabilityState): string');
		expect(settings).toContain('signedWebhookRow?.state ?? eventRecordsGate.state');
		expect(settings).toContain('...operatingAuthorityReadiness.rows.map((row) => ({');
		expect(settings).toContain("row.id === 'signed-webhooks'");
		expect(settings).not.toContain('formatGateEvidence(eventRecordsGate');
		expect(settings).not.toContain('FEATURES.PUBLIC_API ? eventRecordsGate.state');
		expect(settings).not.toContain(
			"const webhookState = $derived<CapabilityState>(FEATURES.PUBLIC_API ? 'live' : 'gated')"
		);
		expect(webhookSettings).toContain('<title>Signed event webhooks | Org authority</title>');
		expect(webhookSettings).toContain(
			'<h1 class="text-text-primary text-xl font-semibold">Signed event webhooks</h1>'
		);
		expect(webhookSettings).toContain('WorkspaceCapabilityStrip');
		expect(webhookSettings).toContain('label="Signed event webhook capability"');
		expect(webhookSettings).toContain('buildSignedWebhookReadiness,');
		expect(webhookSettings).toContain('type SignedWebhookReadinessRow');
		expect(webhookSettings).toContain('const signedWebhookReadiness = $derived(');
		expect(webhookSettings).toContain('buildSignedWebhookReadiness({');
		expect(webhookSettings).toContain('signedWebhookReadiness.rows.map((row) => ({');
		expect(webhookSettings).toContain('function webhookCapabilityHref(row: SignedWebhookReadinessRow)');
		expect(webhookSettings).toContain("row.id === 'signed-event-substrate'");
		expect(webhookSettings).toContain("row.id === 'endpoint-custody'");
		expect(webhookSettings).toContain("row.id === 'delivery-attempt-register'");
		expect(webhookSettings).toContain("row.id === 'reader-office-notification-boundary'");
		expect(canonicalDoc).toContain(
			'The Org authority route now opens with **Org authority pressure** cells for Authority ground, Signed substrate, and Next authority lift'
		);
		expect(canonicalDoc).toContain(
			"The Org authority route's lower controls now use authority/custody labels: **Plan limit ground**, **Tier feature boundaries**, **Public API contract**, **Role authority**, **Legislative domain basis**, and **PII encryption authority**"
		);
		expect(capabilityScope).toContain(
			'The Org authority route now opens with **Org authority pressure** cells for Authority ground, Signed substrate, and Next authority lift'
		);
		expect(capabilityScope).toContain(
			'The lower Org authority controls are now labeled as **Plan limit ground**, **Tier feature boundaries**, **Role authority**, **Legislative domain basis**, and **PII encryption authority**'
		);
		expect(webhookSettings).toContain("row.id === 'durable-event-archive-boundary'");
		expect(webhookSettings).toContain(
			"const eventRecordsGate = getGateEvidence('CP-outbound-webhooks'"
		);
		expect(webhookSettings).toContain(
			"const readerOfficeGate = getGateEvidence('CP-dm-office-profile'"
		);
		expect(webhookSettings).toContain(
			"const webhookArchiveGate = getGateEvidence('CP-receipt-anchoring'"
		);
		expect(webhookSettings).not.toContain('const endpointState = $derived');
		expect(webhookSettings).not.toContain('const deliveryRegisterState = $derived');
		expect(webhookSettings).not.toContain('formatGateEvidence(eventRecordsGate');
		expect(webhookSettings).not.toContain('formatGateEvidence(readerOfficeGate');
		expect(webhookSettings).not.toContain('formatGateEvidence(webhookArchiveGate');
		expect(webhookSettings).toContain('id="signed-event-ground"');
		expect(webhookSettings).toContain('id="webhook-endpoints"');
		expect(webhookSettings).toContain('id="webhook-delivery-evidence"');
		expect(webhookSettings).toContain('id="reader-notification-boundary"');
		expect(webhookSettings).toContain('id="webhook-archive-boundary"');
		expect(webhookSettings).toContain(
			'External endpoints can receive signed Commons events today.'
		);
		expect(webhookSettings).toContain('Send test');
		expect(webhookSettings).toContain('webhook.test');
		expect(webhookSettings).toContain('Test delivery queued');
		expect(webhookSettings).toContain('does not prove the receiver processed the event');
		expect(webhookSettings).not.toContain('Action Network');
		expect(webhookSettings).not.toContain('OSDI');
		expect(webhookSettings).not.toContain('var(--zinc');
		expect(webhookSettings).not.toContain('var(--accent');
		const recentEventsQuery = section(
			orgWebhooks,
			'export const sessionListRecentEvents = query',
			'export const sessionCreateWebhook'
		);
		expect(orgWebhooks).toContain('export const sessionListRecentEvents = query');
		expect(recentEventsQuery).toContain("requireOrgRole(ctx, slug, 'member')");
		expect(recentEventsQuery).toContain("withIndex('by_orgId_emittedAt'");
		expect(recentEventsQuery).toContain('event: row.event');
		expect(recentEventsQuery).toContain('emittedAt: row.emittedAt');
		expect(recentEventsQuery).not.toContain('payload');
		const testDeliveryMutation = section(
			orgWebhooks,
			'export const enqueueTestDelivery = internalMutation',
			'export const deliverWebhook = internalAction'
		);
		expect(orgWebhooks).toContain("const WEBHOOK_TEST_EVENT = 'webhook.test'");
		expect(testDeliveryMutation).toContain("trigger: v.union(v.literal('session'), v.literal('api'))");
		expect(testDeliveryMutation).toContain("event: WEBHOOK_TEST_EVENT");
		expect(testDeliveryMutation).toContain("ctx.scheduler.runAfter(0, internal.orgWebhooks.deliverWebhook");
		expect(testDeliveryMutation).toContain('No supporter, campaign, donation, or event record was changed.');
		expect(orgWebhooks).toContain('export const sessionTestWebhook = mutation');
		expect(webhookSettingsServer).toContain('sessionTestWebhook');
		expect(webhookTestApi).toContain('POST /api/v1/webhooks/[id]/test-fire');
		expect(webhookTestApi).toContain('api.v1api.testWebhook');
		expect(webhookTestApi).toContain("'CONFLICT'");
		expect(openapi).toContain("operationId: 'testWebhookDelivery'");
		expect(openapi).toContain("WebhookTestDelivery");
		expect(openapi).toContain("enum: ['webhook.test']");
		expect(convexHttp).toContain('function redirectToCanonicalPublicApi');
		expect(convexHttp).toContain('canonical_api_origin_required');
		expect(convexHttp).toContain('return redirectToCanonicalPublicApi(request, "/api/v1/supporters")');
		expect(convexHttp).toContain('return redirectToCanonicalPublicApi(request, "/api/v1/campaigns")');
		expect(convexHttp).not.toContain('Use the SvelteKit API for now');
		expect(convexHttp).not.toContain('migration: "in_progress"');
		expect(convexHttp).not.toContain('status: 501');
		expect(layoutServer).toContain('sessionListRecentEvents');
		expect(layoutServer).toContain('signalEventsResult');
		expect(layoutServer).toContain('const signalEvents = Array.isArray(signalEventsResult)');
		expect(layoutServer).toContain('signalEvents,');
		expect(layout).toContain('signalEvents={data.signalEvents}');
		expect(mantle).toContain('signalEvents?: OrgSignal[] | null;');
		expect(mantle).toContain('<SignalWell events={signalEvents} />');
		expect(signalWell).toContain('events?: OrgSignal[] | null');
		expect(signalWell).toContain('aria-label="Recent org signal"');
		expect(signalWell).toContain("eventCount === null ? 'unread' : eventCount");
		expect(signalWell).toContain(
			'Unread. Recent org signal was not attached to this shell read; recent-event claims stay uncounted.'
		);
		expect(signalWell).not.toContain('Recent org events are unavailable');
		expect(signalWell).toContain('Quiet. No recent org events are loaded.');
		expect(signalWell).toContain("case 'campaign_action.created':");
		expect(signalWell).toContain("return 'Action record';");
		expect(signalWell).toContain('title={e.event}>{eventLabel(e.event)}</span>');
		expect(signalWell).not.toContain('Live org events surface here as they arrive');
		expect(peopleSpace).toContain(
			'This shell did not attach People evidence; reach, source-custody, and'
		);
		expect(peopleSpace).toContain(
			'verification-weight claims remain unclaimed and uncounted in this read.'
		);
		expect(peopleSpace).not.toContain('people summary was unavailable');
		expect(peopleSpace).not.toContain('People slice did not load');
		expect(peopleSpace).not.toContain('until it reloads');
		expect(powerSpace).toContain(
			'This shell did not attach Power terrain evidence; target, bill, score, and wider-terrain'
		);
		expect(powerSpace).toContain(
			'coverage claims remain unclaimed and uncounted in this read.'
		);
		expect(powerSpace).not.toContain('terrain reads were unavailable');
		expect(powerSpace).not.toContain('until it reloads');
		expect(resultsSpace).toContain(
			'This shell did not attach Results proof evidence; packet, delivery, receipt, and response'
		);
		expect(resultsSpace).toContain(
			'claims remain unclaimed and uncounted in this read.'
		);
		expect(resultsSpace).not.toContain('results reads were unavailable');
		expect(resultsSpace).not.toContain('until it reloads');
			expect(layout).toContain('resultsProofReadiness.signal');
			expect(layout).not.toContain('Results proof slice unread; packet claim uncounted');
			expect(layout).not.toContain('Results slice + verification packet unavailable');
		expect(spacesContract).toContain('"this read was unread / dormant,"');
		expect(coordinationIntegrity).toContain('Geographic diversity remains uncounted.');
		expect(coordinationIntegrity).not.toContain('Geographic diversity cannot be claimed');
		expect(webhookSettingsServer).toContain('sessionListRecentDeliveries');
		expect(webhookSettingsServer).toContain('recentDeliveries');
		expect(webhookSettingsServer).toContain('webhookUrl: webhook.url');
		expect(canonicalDoc).toContain(
			'The signed webhook management subroute maps its `WorkspaceCapabilityStrip` from `buildSignedWebhookReadiness`'
		);
		expect(canonicalDoc).toContain(
			'Recent `orgWebhookDeliveries` rows are sender-side operational evidence for external endpoints across platforms'
		);
		expect(canonicalDoc).toContain(
			'The Signal well reads a layout-safe recent `orgEvents` slice'
		);
		expect(canonicalDoc).toContain('payloads stay out of the shell');
		expect(capabilityScope).toContain(
			'persistent Signal well reads a session-authenticated recent `orgEvents` slice'
		);
		expect(capabilityScope).toContain(
			'`buildSignedWebhookReadiness` drives the webhook management route strip'
		);
		expect(capabilityScope).toContain('full SSE stream reattachment in the shell');
		expect(webhookSettings).not.toContain('<title>Webhooks · Settings</title>');
		expect(supporterDetail).toContain('People ledger');
		expect(supporterDetail).toContain('WorkspaceCapabilityStrip');
		expect(supporterDetail).toContain('label="Person capability"');
		expect(supporterDetail).toContain('buildPersonDetailRows,');
		expect(supporterDetail).toContain('type PersonDetailRow');
		expect(supporterDetail).toContain('const personDetailRows = $derived<PersonDetailRow[]>');
		expect(supporterDetail).toContain('buildPersonDetailRows({');
		expect(supporterDetail).toContain('identityVerified: data.supporter.identityVerified');
		expect(supporterDetail).toContain('postalCode: data.supporter.postalCode');
		expect(supporterDetail).toContain('emailStatus: data.supporter.emailStatus');
		expect(supporterDetail).toContain('source: data.supporter.source');
		expect(supporterDetail).toContain(
			'hasEncryptedCustomFields: Boolean(data.supporter.encryptedCustomFields)'
		);
		expect(supporterDetail).toContain('personDetailRows.map((row) => ({');
		expect(supporterDetail).toContain('cluster: row.clusters');
		expect(supporterDetail).toContain('handoff: row.handoff');
		expect(supporterDetail).toContain('detail: row.ground');
		expect(supporterDetail).toContain('unlock: row.boundary');
		expect(supporterDetail).not.toContain('formatGateEvidence');
		expect(supporterDetail).not.toContain('const verificationCapabilityState');
		expect(supporterDetail).not.toContain('const reachCapabilityState');
		expect(supporterDetail).not.toContain('const provenanceState');
		expect(supporterDetail).not.toContain('const customFieldCustodyState');
		expect(hypergraph).toContain('export function buildPersonDetailRows');
		expect(hypergraph).toContain("label: 'Person verification weight'");
		expect(hypergraph).toContain("label: 'Reach authorization'");
		expect(hypergraph).toContain("label: 'Source custody'");
		expect(hypergraph).toContain("label: 'Custom field custody'");
		expect(hypergraph).toContain("action: 'read source custody'");
		expect(hypergraph).toContain('is preserved as source custody on this person record.');
		expect(hypergraph).toContain(
			'Unknown source metadata is preserved as a boundary, not a platform-origin claim.'
		);
		expect(hypergraph).toContain(
			'Custom-field custody is encrypted blob evidence; typed fields and segmentation remain dependency-first.'
		);
		expect(supporterDetail).toContain(
			"const verificationTrustGate = getGateEvidence('CP-mainnet-deployment', ['T3-6', 'T5-3']"
		);
		expect(supporterDetail).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
		expect(supporterDetail).toContain(
			"const platformApiGate = getGateEvidence('CP-platform-api-sync', ['T1-3']"
		);
		expect(supporterDetail).toContain(
			"const customFieldsGate = getGateEvidence('CP-custom-fields-type-system', ['T10-7']"
		);
		expect(supporterDetail).toContain('id="person-verification"');
		expect(supporterDetail).toContain('id="person-reach-boundary"');
		expect(supporterDetail).not.toContain('>Supporters<');
		expect(supporterDetail).not.toContain("return 'Action Network';");
		expect(supporterDetail).not.toContain("action: 'read provenance'");
		expect(supporterDetail).not.toContain('is preserved as provenance on this person record.');
		expect(representativeDetail).toContain('Power targets');
		expect(representativeDetail).toContain('WorkspaceCapabilityStrip');
		expect(representativeDetail).toContain('label="Power target detail capability"');
		expect(representativeDetail).toContain('buildPowerTargetDetailRows,');
		expect(representativeDetail).toContain('type PowerTargetDetailRow');
		expect(representativeDetail).toContain(
			'const powerTargetDetailRows = $derived<PowerTargetDetailRow[]>'
		);
		expect(representativeDetail).toContain('buildPowerTargetDetailRows({');
		expect(representativeDetail).toContain('isFollowed');
		expect(representativeDetail).toContain('hasContactRoute');
		expect(representativeDetail).toContain('timelineCount');
		expect(representativeDetail).toContain('receiptCount: data.accountability.receiptCount');
		expect(representativeDetail).toContain('powerTargetDetailRows.map((row) => ({');
		expect(representativeDetail).toContain('cluster: row.clusters');
		expect(representativeDetail).toContain('handoff: row.handoff');
		expect(representativeDetail).toContain('detail: row.ground');
		expect(representativeDetail).toContain('unlock: row.boundary');
		expect(representativeDetail).not.toContain('formatGateEvidence');
		expect(representativeDetail).not.toContain('const followCapabilityState');
		expect(representativeDetail).not.toContain('const contactCapabilityState');
		expect(representativeDetail).not.toContain('const accountabilityCapabilityState');
		expect(hypergraph).toContain('export function buildPowerTargetDetailRows');
		expect(hypergraph).toContain("label: 'Target follow state'");
		expect(hypergraph).toContain("label: 'Contact route evidence'");
		expect(hypergraph).toContain("label: 'Accountability timeline'");
		expect(hypergraph).toContain("label: 'Reader-office boundary'");
		expect(hypergraph).toContain(
			"action: target.hasContactRoute ? 'read contact route' : 'read contact boundary'"
		);
		expect(hypergraph).toContain("action: 'read office-workflow boundary'");
		expect(representativeDetail).toContain(
			"const stateLocalTerrainGate = getGateEvidence(\n\t\t'CP-state-local-terrain'"
		);
		expect(representativeDetail).toContain(
			"const readerOfficeGate = getGateEvidence('CP-reader-office-profile'"
		);
		expect(hypergraph).toContain(
			'Reader-office profile enrichment, office-response workflow, and notification webhooks are not armed here.'
		);
		expect(representativeDetail).not.toContain('Staffer dashboard');
		expect(representativeDetail).toContain(
			"const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring'"
		);
		expect(representativeDetail).toContain('id="target-posture"');
		expect(representativeDetail).toContain('id="target-contact-boundary"');
		expect(representativeDetail).toContain('target-accountability');
		expect(representativeDetail).not.toContain('Decision Makers');
		expect(layout).not.toContain("name: 'Action Network OSDI sync'");
		expect(layout).not.toContain('Action Network migration remains gated.');
		expect(mantle).toContain('Substrate');
		expect(mantle).toContain('action: string;');
		expect(mantle).toContain('gate: string;');
		expect(mantle).toContain('gateSignal?: string;');
		expect(mantle).toContain('function operatingGroundActionLabel');
		expect(mantle).toContain('function operatingGroundAriaLabel');
		expect(mantle).toContain('function operatingGroundGateSignal');
		expect(mantle).toContain('mantle-substrate-state-label');
		expect(mantle).toContain('mantle-substrate-action');
		expect(mantle).toContain('mantle-substrate-gate');
		expect(mantle).toContain('aria-label="Substrate handoffs"');
		expect(mantle).not.toContain('aria-label="Substrate routes"');
		expect(mantle).toContain('Workspace switcher: Studio / People / Power / Results');
		expect(mantle).toContain('type CapabilityPostureCopy');
			expect(mantle).toContain('type CapabilityPostureGate');
			expect(mantle).toContain('type CapabilityPostureSignal');
			expect(mantle).toContain('posturePressureCopy = {}');
			expect(mantle).toContain('posturePressureGate = {}');
			expect(mantle).toContain('posturePressureSignal = {}');
			expect(mantle).toContain('activePosturePressureCopy');
			expect(mantle).toContain('activePosturePressureGate');
			expect(mantle).toContain('activePosturePressureSignal');
			expect(mantle).toContain('function defaultPosturePressureSignalFor');
			expect(mantle).toContain('const posturePressureAriaLabel = $derived(');
			expect(mantle).toContain("'read substrate gate'");
			expect(mantle).not.toContain("? 'read boundary' : 'open ground'");
		expect(mantle).toContain('Next unlock: ${activePosturePressureGate}');
		expect(mantle).toContain('aria-label={posturePressureAriaLabel}');
		expect(mantle).toContain('title="{activePosturePressureCopy} Next unlock: {activePosturePressureGate}"');
		expect(mantle).toContain('const capabilityMapHref = $derived(`${base}/canvas`)');
		expect(mantle).toContain(
			'aria-label="Capability posture across visible Commons surfaces"'
		);
		expect(mantle).not.toContain('visible OS surfaces');
		expect(mantle).toContain('aria-label="Open capability map"');
		expect(mantle).toContain('Capability map');
		expect(mantle).not.toContain('read capability map');
		expect(mantle).toContain('class="mantle-posture-pressure-top"');
		expect(mantle).toContain('class="mantle-posture-signal"');
		expect(mantle).toContain('class="mantle-posture-unlock"');
		expect(mantle).toContain('<span class="mantle-posture-unlock-label">next unlock</span>');
		expect(mantle).toContain('{activePosturePressureSignal}');
		expect(mantle).not.toContain('<span class="mantle-posture-copy">{activePosturePressureCopy}</span>');
		expect(mantle).toContain('title={item.gate}');
		expect(mantle).toContain('{operatingGroundGateSignal(item)}');
		expect(mantle).not.toContain('<span class="mantle-substrate-gate">{item.gate}</span>');
		expect(mantle).toContain('operatorCapabilityStateRatioSegments');
		expect(mantle).toContain('const postureSegments = $derived(');
		expect(mantle).toContain('operatorCapabilityStateRatioSegments(postureCounts, {');
		expect(mantle).toContain('includeTestnet: true');
		expect(mantle).toContain("operatorCapabilityStateLabel('live')");
		expect(mantle).toContain("operatorCapabilityStateLabel('partial')");
		expect(mantle).toContain("operatorCapabilityStateLabel('draft-only')");
		expect(mantle).toContain("operatorCapabilityStateLabel('gated')");
		expect(mantle).not.toContain("live: 'Live'");
		expect(mantle).not.toContain("partial: 'Partial'");
		expect(mantle).not.toContain("gated: 'Gated'");
		expect(mantle).not.toContain('Mainnet, TEE, delegation, or reader-side gates');
		expect(mantle).not.toContain('Send modes include draft-only paths');
		expect(layout).toContain('const mantleDraftOnlyPressureCopy = $derived');
		expect(layout).toContain('sendReadiness.heldModeSummary');
		expect(layout).toContain('sendReadiness.sendBoundarySummary');
		expect(layout).toContain("'draft-only': mantleDraftOnlyPressureCopy");
		expect(layout).not.toContain("commandGate(emailProxyGate, 'Held send modes remain draft-only.')");
		expect(layout).not.toContain(
			"commandGate(smsDispatchGate, 'Carrier text side effects remain draft-only.')"
		);
		expect(layout).not.toContain('Workflow email remains dependency-bound');
		expect(layout).not.toContain(
			"commandGate(congressionalLaunchGate, 'Congressional delivery remains gated.')"
		);
		expect(layout).toContain('const mantlePosturePressureCopy = $derived');
		expect(layout).toContain('function compactGateSignal(gate: GateEvidence): string');
		expect(layout).toContain('function readinessRowSignal(');
		expect(layout).toContain('function operatingGroundFromReadiness');
		expect(layout).toContain('function operatingGroundGateSignalFor');
		expect(layout).not.toContain('function operatingAuthorityGroundGateSignal');
		expect(layout).not.toContain("if (row.id === 'org-audit-log') return 'audit held';");
		expect(layout).toContain('...operatingAuthorityGroundRows.map((row) =>');
		expect(layout).toContain('operatingGroundFromReadiness(row, {');
		expect(layout).toContain("row.id === 'registry-environment' ? 'Sepolia testnet' : undefined");
		expect(layout).toContain("row.id === 'registry-environment' ? 'testnet' : undefined");
		expect(layout).toContain('operatingGroundFromReadiness(fundraisingReadiness');
		expect(layout).toContain('operatingGroundFromReadiness(coordinationReadiness');
		expect(layout).toContain('operatingGroundFromReadiness(textDeliveryReadiness');
		expect(layout).toContain('operatingGroundFromReadiness(callRoutingReadiness');
		expect(layout).toContain('operatingGroundFromReadiness(coalitionReadiness');
		expect(layout).toContain('return readinessRowSignal(source.rowCount, source.boundaryCount, source.liveCount);');
		expect(layout).not.toContain(
			"action: FEATURES.PUBLIC_API ? 'open API ground' : 'read API boundary'"
		);
		expect(layout).not.toContain(
			'Public API feature flag is off; developer ground stays dependency-first.'
		);
		expect(layout).not.toContain(
			"action: FEATURES.PUBLIC_API ? 'open signed webhooks' : 'read webhook boundary'"
		);
		expect(layout).toContain('commandGate(\n\t\t\tloadBearingGate?.gate ?? delegationGate');
		expect(layout).toContain('const mantlePosturePressureGate = $derived');
		expect(layout).toContain('const mantlePosturePressureSignal = $derived');
		expect(layout).toContain('const mantlePartialSurfaceCount = $derived');
		expect(layout).toContain("marks.filter((mark) => mark.state === 'partial').length");
		expect(layout).toContain(
			"operatingGroundCapabilities.filter((item) => item.state === 'partial').length"
		);
		expect(layout).toContain('gated: loadBearingGateSummary');
		expect(layout).toContain('compactGateSignal(loadBearingGate.gate)');
		expect(layout).toContain('partial: `${mantlePartialSurfaceCount} bounded`');
		expect(layout).toContain(
			"commandGate(mainnetGate, 'Registry-backed claims remain testnet-bound.')"
		);
		expect(layout).toContain(
			"commandGate(mainnetGate, 'Next registry unlock remains unresolved.')"
		);
		expect(layout).toContain('sendReadiness.nextHeldMode');
		expect(layout).toContain('`${sendReadiness.nextHeldLabel}: ${sendReadiness.nextHeldGate}`');
		expect(layout).toContain('posturePressureCopy={mantlePosturePressureCopy}');
		expect(layout).toContain('posturePressureGate={mantlePosturePressureGate}');
		expect(layout).toContain('posturePressureSignal={mantlePosturePressureSignal}');
		expect(canonicalDoc).toContain(
			'The pressure copy is supplied by the layout and, when a stronger claim is blocked, renders through `formatGateEvidence` in operator density'
		);
		expect(canonicalDoc).toContain(
			'Draft-only posture copy is also a `buildSendReadiness` adapter'
		);
		expect(canonicalDoc).toContain(
			'The same pressure row renders a visible **next unlock** field supplied by `mantlePosturePressureGate`'
		);
		expect(canonicalDoc).toContain(
			'The posture header link reads **Capability map** and opens the full map'
		);
		expect(canonicalDoc).toContain(
			'The map uses the same flat cream substrate as the rest of the OS'
		);
		expect(canonicalDoc).toContain(
			'CSS gradients, canvas vignettes, dark-map treatments, frosted blur, and decorative atmospheric panels are not allowed'
		);
		expect(canonicalDoc).toContain(
			'Signed webhooks in the Mantle and Org authority strip derive from the completed event-emission gate'
		);
		expect(canonicalDoc).toContain(
			'signed-event evidence derived from `orgEvents`/webhook/SSE substrate rather than the API flag'
		);
		expect(capabilityScope).toContain(
			'v1 activity feed and org event SSE exist, but developer onboarding examples and receiver/consumer UX remain thin'
		);
		expect(capabilityScope).not.toContain('No v1 activity feed endpoint');
		expect(capabilityScope).not.toContain('No v1 real-time subscriptions');
		expect(canonicalDoc).toContain(
			'Each row exposes visible state language, allowed action grammar, and compact `gateSignal` status'
		);
		expect(canonicalDoc).toContain(
			'full gate/provenance copy remains in title/ARIA and the deeper Studio/route evidence rows'
		);
		expect(canonicalDoc).toContain(
			"The rail's visible pressure field stays compressed through `posturePressureSignal`"
		);
		expect(capabilityScope).toContain(
			'workspace marks now visibly render a shared-axis handoff/effect/action/next rail with state-coded dashed boundaries for held marks'
		);
		expect(capabilityScope).toContain(
			'Substrate rows render compact `posturePressureSignal` and `gateSignal` status'
		);
		expect(canonicalDoc).toContain(
			'Compact horizontal marks still show state, cited signal, and the shared-axis handoff/effect/action/next rail'
		);
		expect(canonicalDoc).toContain(
			'/supporters/[id]` keeps the same contract at person scale: person verification weight, reach authorization, and source custody'
		);
		expect(canonicalDoc).toContain('Detail-route breadcrumbs follow the same contract');
		expect(switcher).toContain('aria-label="Studio, People, Power, Results capability rail"');
		expect(switcher).not.toContain('aria-label="Org spaces"');
		expect(switcher).toContain('operatorCapabilityActionLabel');
		expect(switcher).toContain('handoff?: string;');
		expect(switcher).toContain('effect?: string;');
		expect(switcher).toContain('gateSignal?: string;');
		expect(switcher).toContain('function markActionLabel(mark: WorkspaceMark): string');
		expect(switcher).toContain('function markContractTitle(mark: WorkspaceMark): string');
		expect(switcher).toContain('function markContractAria(mark: WorkspaceMark): string');
		expect(switcher).toContain('data-state={mark.state}');
		expect(switcher).toContain('aria-label={markContractAria(mark)}');
		expect(switcher).toContain('class="ws-contract"');
		expect(switcher).toContain('class="ws-contract-axis"');
		expect(switcher).toContain('class="ws-contract-values"');
		expect(switcher).toContain('<span class="ws-contract-kicker">handoff</span>');
		expect(switcher).toContain('<span class="ws-contract-kicker">effect</span>');
		expect(switcher).toContain('<span class="ws-contract-kicker">action</span>');
		expect(switcher).toContain('<span class="ws-contract-kicker">next</span>');
		expect(switcher).toContain(".ws-mark[data-state='draft-only'] .ws-contract");
		expect(switcher).toContain(".ws-mark[data-state='gated'] .ws-contract");
		expect(switcher).toContain(".ws-contract-value--action");
		expect(switcher).toContain(".ws-contract-value--next");
		expect(switcher).toContain('{markActionLabel(mark)}');
		expect(layout).toContain("handoff: 'Studio intent'");
		expect(layout).toContain('const studioWorkspaceState = $derived<WorkspaceCapabilityState>');
		expect(layout).toContain('studioAuthoringReadiness.state');
		expect(layout).not.toContain("canPublish ? studioAuthoringReadiness.state : 'gated'");
		expect(layout).toContain('const studioWorkspaceSignal = $derived<WorkspaceSignal>');
		expect(layout).toContain('studioAuthoringReadiness.metric.value === null');
		expect(layout).toContain('const studioWorkspaceGate = $derived(');
		expect(layout).toContain('`${studioAuthoringCommandGate} ${publishAuthorityWorkspaceGate}`');
		expect(layout).toContain('state: studioWorkspaceState');
		expect(layout).toContain('signal: studioWorkspaceSignal');
		expect(layout).not.toContain('function studioState(');
		expect(layout).not.toContain('function studioSignal(');
		expect(layout).not.toContain("label: 'send mode'");
		expect(layout).toContain("gloss: 'Authoring center'");
		expect(layout).not.toContain("gloss: 'Author & send'");
		expect(layout).not.toContain("cite: 'configured email delivery gates'");
		expect(layout).toContain(
			'author and preserve Studio evidence; route handoffs require org authority'
		);
		expect(layout).toContain("action: 'open Studio intent'");
		expect(layout).toContain('gate: studioWorkspaceGate');
		expect(layout).toContain(
			"gateSignal: canPublish ? studioAuthoringCommandSignal : 'org authority for handoffs'"
		);
		expect(layout).toContain("handoff: 'People ledger'");
		expect(layout).toContain('const peopleWorkspaceState = $derived<WorkspaceCapabilityState>');
		expect(layout).toContain(
			"peopleSourceProvenanceReadiness.state === 'gated' ? 'gated' : emailListHealthReadiness.state"
		);
		expect(layout).toContain('const peopleWorkspaceSignal = $derived<WorkspaceSignal>');
		expect(layout).toContain('emailListHealthReadiness.metric.value === null');
		expect(layout).toContain('state: peopleWorkspaceState');
		expect(layout).toContain('signal: peopleWorkspaceSignal');
		expect(layout).toContain(
			'gate: `${peopleSourceProvenanceReadiness.gate} ${emailListHealthReadiness.gate}`'
		);
		expect(layout).toContain('gateSignal: emailListHealthReadiness.nextGate.name');
		expect(layout).not.toContain('function peopleState(');
		expect(layout).not.toContain('function peopleSignal(');
		expect(layout).not.toContain("cite: 'supporters.getSummaryStats email health'");
		expect(layout).toContain("handoff: 'Power targets'");
		expect(layout).toContain('gate: powerTerrainReadiness.gate');
		expect(layout).toContain("handoff: 'Results proof'");
		expect(layout).toContain('gate: resultsProofReadiness.gate');
		for (const sourceText of [
			canvasPage,
			canvasServer,
			canvas,
			palette,
			fieldNode,
			camera,
			constellation,
			spacesContract,
			peopleSpace,
			powerSpace,
			resultsSpace,
			mantle,
			switcher,
			spotlight,
			layout,
			webhookSettings,
			supporterDetail,
			representativeDetail
		]) {
			expect(sourceText).not.toMatch(/verified base/i);
			expect(sourceText).not.toMatch(/open in classic|exit to classic/i);
			expect(sourceText).not.toContain('SPATIAL OS');
			expect(sourceText).not.toContain('Verified base');
			expect(sourceText).not.toContain("label: 'Returns'");
			expect(sourceText).not.toContain('>Returns<');
		}
	});

	it('filters map targets by capability contract tokens without adding destinations', () => {
		const peopleTarget = cameraTarget({
			id: 'object-people-reach',
			label: 'People reach',
			sublabel: 'People',
			group: 'People',
			searchTokens: [
				'C-reach / C-verification',
				'OrgSpacesData.base summary',
				'direct sync proof checks'
			],
			state: 'partial',
			stateLabel: 'bounded',
			clusterLabels: 'reach / verification',
			gateId: 'CP-platform-api-sync',
			gateName: 'Direct platform sync',
			gateTasks: 'T1-3',
			gateDependency: 'Encrypted API-key contracts'
		});
		const responseTarget = cameraTarget({
			id: 'object-response-terrain',
			label: 'Accountability response',
			sublabel: 'Scorecard',
			group: 'Power',
			searchTokens: ['C-accountability / C-reader-side', 'T8-1a', 'T8-1b', 'T8-8'],
			state: 'partial',
			stateLabel: 'bounded',
			clusterLabels: 'accountability / reader-side UX',
			gateId: 'CP-reader-office-profile',
			gateName: 'Reader office response terrain',
			gateTasks: 'T8-1a/T8-1b/T8-8',
			gateDependency: 'DM office profile enrichment'
		});
		const targets = [peopleTarget, responseTarget];

		expect(targetSearchText(peopleTarget)).toContain('CP-platform-api-sync');
		expect(filterTargets(targets, 'T1-3').map((target) => target.id)).toEqual([
			'object-people-reach'
		]);
		expect(filterTargets(targets, 'reader office').map((target) => target.id)).toEqual([
			'object-response-terrain'
		]);
		expect(filterTargets(targets, 'bounded').map((target) => target.id)).toEqual([
			'object-people-reach',
			'object-response-terrain'
		]);
		expect(filterTargets(targets, 'zzzzzz').map((target) => target.id)).toEqual([]);
	});

	it('lifts People source custody as platform-neutral OS ground', () => {
		const supporters = source('convex/supporters.ts');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const spacesContract = source('src/lib/components/org/os/spaces.ts');
		const layoutServer = source('src/routes/org/[slug]/+layout.server.ts');
		const layout = source('src/routes/org/[slug]/+layout.svelte');
		const peopleSpace = source('src/lib/components/org/os/BaseSpace.svelte');
		const supportersPage = source('src/routes/org/[slug]/supporters/+page.svelte');
		const supportersListServer = source('src/routes/org/[slug]/supporters/+page.server.ts');
		const capabilityMap = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');
		const segmentMatch = source('convex/_segmentMatch.ts');

		expect(supporters).toContain('function supporterSourceValue');
		expect(supporters).toContain('const sourceCounts: Record<string, number> = {};');
		expect(supporters).toContain('? supporter.source.trim()');
		expect(supporters).toContain(": 'unknown'");
		expect(supporters).toContain('supporterSourceValue(s) === filters.source');
		expect(supporters).toContain('sourceCounts,');
		expect(spacesContract).toContain('sourceCounts: Record<string, number>;');
		expect(layoutServer).toContain('function asNumberRecord(value: unknown): Record<string, number>');
		expect(layoutServer).toContain('sourceCounts: asNumberRecord(supporterSummary.sourceCounts)');
		expect(segmentMatch).toContain('function supporterSourceValue');
		expect(segmentMatch).toContain("supporterSourceValue(supporter) === String(cond.value)");
		expect(segmentMatch).toContain("supporterSourceValue(supporter) !== String(cond.value)");
		expect(hypergraph).toContain('export function buildPeopleSourceProvenanceReadiness');
		expect(hypergraph).toContain('platformProfilePeopleCount');
		expect(hypergraph).toContain("cite: 'supporters.getSummaryStats.sourceCounts'");
		expect(layout).toContain('buildPeopleSourceProvenanceReadiness,');
		expect(layout).toContain('const peopleSourceProvenanceReadiness = $derived(');
		expect(layout).toContain("label: 'Source custody'");
		expect(layout).toContain("id: 'capability-people-source-provenance'");
		expect(peopleSpace).toContain("from '$lib/data/platform-export-profiles'");
		expect(peopleSpace).toContain('buildPeopleSourceProvenanceReadiness,');
		expect(peopleSpace).toContain('const peopleSourceProvenanceReadiness = $derived(');
		expect(peopleSpace).toContain("label: 'People source custody'");
		expect(peopleSpace).toContain('metric: peopleSourceProvenanceReadiness.metric');
		expect(peopleSpace).toContain('id="people-source-provenance"');
		expect(peopleSpace).toContain('aria-label="People source custody"');
		expect(peopleSpace).toContain('Source custody');
		expect(peopleSpace).toContain('{peopleSourceProvenanceReadiness.detail}');
		expect(supportersPage).toContain("source ?? 'unknown'");
		expect(supportersPage).toContain('buildSourceFilterOptions');
		expect(supportersPage).toContain('Unknown source');
		expect(supportersListServer).toContain('source.length <= 50');
		expect(capabilityMap).toContain('buildPeopleSourceProvenanceReadiness,');
		expect(capabilityMap).toContain('const peopleSourceProvenanceReadiness = $derived(');
		expect(capabilityMap).toContain("name: 'People source custody'");
		expect(capabilityMap).toContain("title: 'People source custody'");
		expect(capabilityMap).toContain("label: 'Read source custody'");
		expect(capabilityMap).toContain("source: 'supporters.getSummaryStats sourceCounts'");
		expect(capabilityMap).toContain('peopleSourceProvenanceReadiness.metric.cite');
		expect(layout).not.toContain("label: 'Source provenance'");
		expect(peopleSpace).not.toContain("label: 'People source provenance'");
		expect(peopleSpace).not.toContain('aria-label="People source provenance"');
		expect(capabilityMap).not.toContain("name: 'People source provenance'");
		expect(capabilityMap).not.toContain("title: 'People source provenance'");
		expect(capabilityMap).not.toContain("label: 'Read source provenance'");
		expect(capabilityMap).not.toContain('const peopleSourceCounts = $derived<Record<string, number>>');
		expect(capabilityMap).not.toContain("case 'action_network':");
		expect(canonicalDoc).toContain('`OrgSpacesData.base.sourceCounts`');
		expect(capabilityScope).toContain('`supporters.getSummaryStats.sourceCounts`');
	});

	it('keeps person detail rows shared across verification, reach, source, and custom-field custody', () => {
		const verificationTrustGate = getGateEvidence('CP-mainnet-deployment', ['T3-6', 'T5-3'], {
			name: 'Verification trust hardening',
			dependency: 'Scroll mainnet DistrictRegistry + TEE resolver attestation'
		});
		const emailProxyGate = getGateEvidence('CP-2', ['T2-2'], {
			name: 'Email send proxy',
			dependency: 'AWS Lambda deploy + BLAST receipts secret sync'
		});
		const platformApiGate = getGateEvidence('CP-platform-api-sync', ['T1-3'], {
			name: 'Platform API sync',
			downstream: 1,
			dependency: 'Encrypted API-key contracts + paginated per-platform clients'
		});
		const customFieldsGate = getGateEvidence('CP-custom-fields-type-system', ['T10-7'], {
			name: 'Custom fields type system',
			downstream: 1,
			dependency: 'Org custom-field definitions, validation, CSV mapping, and segment behavior'
		});
		const rows = buildPersonDetailRows({
			base: '/org/local',
			person: {
				id: 'person 1',
				identityVerified: false,
				postalCode: '94103',
				emailStatus: 'unsubscribed',
				source: 'unknown',
				hasEncryptedCustomFields: false
			},
			gates: {
				verificationTrustGate,
				emailProxyGate,
				platformApiGate,
				customFieldsGate
			}
		});
		const row = (id: string) => rows.find((candidate) => candidate.id === id);

		expect(rows).toHaveLength(4);
		expect(row('verification-weight')?.state).toBe('partial');
		expect(row('verification-weight')?.action).toBe('read district signal');
		expect(row('verification-weight')?.href).toBe(
			'/org/local/supporters/person%201#person-verification'
		);
		expect(row('reach-authorization')?.state).toBe('gated');
		expect(row('reach-authorization')?.action).toBe('read suppression');
		expect(row('source-custody')?.state).toBe('partial');
		expect(row('source-custody')?.metric.label).toBe('unknown source');
		expect(row('source-custody')?.ground).toContain('not a platform-origin claim');
		expect(row('custom-field-custody')?.state).toBe('partial');
		expect(row('custom-field-custody')?.boundary).toContain('typed fields and segmentation');
		expect(row('custom-field-custody')?.gate.id).toBe('CP-custom-fields-type-system');

		const evidencedRows = buildPersonDetailRows({
			base: '/org/local',
			person: {
				id: 'person-live',
				identityVerified: true,
				postalCode: '94103',
				emailStatus: 'subscribed',
				source: 'everyaction',
				hasEncryptedCustomFields: true
			},
			gates: {
				verificationTrustGate,
				emailProxyGate,
				platformApiGate,
				customFieldsGate
			}
		});
		const evidencedRow = (id: string) => evidencedRows.find((candidate) => candidate.id === id);

		expect(evidencedRow('verification-weight')?.state).toBe('live');
		expect(evidencedRow('reach-authorization')?.state).toBe('partial');
		expect(evidencedRow('reach-authorization')?.href).toBe(
			'/org/local/emails/compose#email-delivery'
		);
		expect(evidencedRow('source-custody')?.state).toBe('live');
		expect(evidencedRow('source-custody')?.ground).toContain('EveryAction / NGP VAN export');
		expect(evidencedRow('custom-field-custody')?.state).toBe('live');
		expect(evidencedRow('custom-field-custody')?.metric.value).toBe(1);
	});

	it('keeps campaign delivery analytics from presenting fake click-through zeros', () => {
		const campaigns = source('convex/campaigns.ts');
		const campaignAnalytics = source('src/lib/server/campaign-analytics.ts');
		const deliveryMetrics = source('src/lib/components/org/DeliveryMetrics.svelte');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');

		expect(campaigns).toContain("response.type === 'clicked_verify'");
		expect(campaigns).toContain('clickRate: sent > 0 ? Math.round((clicked / sent) * 100) : 0');
		expect(campaigns).not.toContain('clicked: 0, // click tracking not yet wired');
		expect(campaigns).not.toContain('complained: 0,');
		expect(campaignAnalytics).not.toContain('complained: number');
		expect(campaignAnalytics).not.toContain('complained: 0');

		expect(deliveryMetrics).toContain(
			'Observed verify-link clicks from proof-delivery response events'
		);
		expect(deliveryMetrics).toContain('verify clicks');
		expect(deliveryMetrics).toContain('verify click {metrics.clickRate}%');
		expect(deliveryMetrics).not.toContain('>clicked</p>');
		expect(deliveryMetrics).not.toContain('complained: number');

		expect(capabilityScope).toContain(
			'observed verify-link clicks from `campaignDeliveries.responses` / `accountabilityReceipts.responses`'
		);
		expect(capabilityScope).toContain('Campaign-level complaint count: not exposed.');
		expect(capabilityScope).not.toContain('but `clicked: 0` hardcoded');
		expect(canonicalDoc).toContain(
			'Campaign delivery analytics label observed verify-link clicks from delivery/receipt response history'
		);
		expect(canonicalDoc).toContain(
			'Campaign-level complaint metrics are not exposed until complaint events can be correlated to a delivery row'
		);
	});

	it('surfaces first-org pressure in the Studio capability map', () => {
		const component = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const canvas = source('src/lib/components/org/os/CanvasCapabilityMap.svelte');
		const layout = source('src/routes/org/[slug]/+layout.svelte');
		const pressureModel = source('src/lib/data/capability-hypergraph.ts');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');

		expect(component).toContain('type LaunchPressureRow');
		expect(component).toContain('type LaunchVectorReadout');
		expect(component).toContain('buildLaunchPressureRows({');
		expect(component).toContain('const launchPressureRows');
		expect(component).toContain('const launchPressureStateCounts = $derived');
		expect(component).toContain('const heldLaunchPressureCount = $derived');
		expect(component).toContain('const firstLaunchPressureRow = $derived');
		expect(component).toContain('const highestFanoutLaunchPressureRow = $derived');
		expect(component).toContain('const heldVisibleContractCount = $derived');
		expect(component).toContain('const launchVectorReadouts = $derived<LaunchVectorReadout[]>');
		expect(component).toContain('const visibleContractBaseStates = $derived<CapabilityState[]>');
		expect(component).toContain('...launchVectorReadouts.map((readout) => readout.state)');
		expect(component).toContain('...launchVectorReadouts.map((readout) => ({');
		expect(component).toContain('id="capability-launch-vector"');
		expect(component).toContain('Which blocker changes the most visible surface');
		expect(component).toContain('aria-label="Launch vector readout"');
		expect(component).toContain('{#each launchVectorReadouts as readout (readout.id)}');
		const launchVectorMarkup = section(
			component,
			'id="capability-launch-vector"',
			'id="capability-grounded-authoring"'
		);
		expect(launchVectorMarkup).toContain('class="launch-vector-count"');
		expect(launchVectorMarkup).toContain('aria-label="Launch vector state mix"');
		expect(launchVectorMarkup).toContain(
			'class="launch-vector-count-item" data-state={readout.state}'
		);
		expect(launchVectorMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(launchVectorMarkup).not.toContain('Derived from unresolved launch pressure');
		expect(component).toContain('.launch-vector-count {');
		expect(component).toContain('.launch-vector-count-item {');
		expect(component).not.toContain('.launch-vector-note {');
		expect(component).toContain('Capability state ledger / buildLaunchPressureRows');
		expect(component).toContain('id="launch-pressure"');
		expect(component).toContain('First-org blockers');
		const launchPressureHeaderMarkup = section(
			component,
			'id="launch-pressure"',
			'id="capability-claim-boundary"'
		);
		expect(launchPressureHeaderMarkup).toContain('class="launch-pressure-count"');
		expect(launchPressureHeaderMarkup).toContain('Launch pressure: ${launchPressureRows.length}');
		expect(launchPressureHeaderMarkup).toContain('launchPressureStateCounts.partial');
		expect(launchPressureHeaderMarkup).toContain('heldLaunchPressureCount');
		expect(launchPressureHeaderMarkup).toContain(
			'highestFanoutLaunchPressureRow?.gate.downstream ?? 0'
		);
		expect(launchPressureHeaderMarkup).toContain('class="launch-pressure-split"');
		expect(launchPressureHeaderMarkup).not.toContain(
			'Only unresolved launch-grade pressure appears here'
		);
		expect(component).toContain('.launch-pressure-count {');
		expect(component).toContain('.launch-pressure-split {');
		expect(component).not.toContain('class="gate-note"');
		expect(component).toContain('{#each launchPressureRows as row (row.id)}');
		expect(component).not.toContain('{#each launchPressureRows as row (row.name)}');
		expect(canvas).toContain('type LaunchPressureRow');
		expect(canvas).toContain('buildLaunchPressureRows({');
		expect(canvas).toContain('const fieldLaunchPressureRows');
		expect(canvas).toContain('aria-label="First-org launch pressure"');
		expect(canvas).toContain('field-pressure');
		expect(canvas).toContain('Launch pressure');
		expect(canvas).toContain('{#each fieldLaunchPressureRows as row (row.id)}');
		expect(canvas).not.toContain('{#each fieldLaunchPressureRows as row (row.name)}');
		expect(canvas).toContain('...fieldLaunchPressureRows.map((row) => ({');
		expect(canvas).toContain('readoutGateSummary(row.gate, row.futureLift)');
		expect(canvas).toContain('Handoff: ${row.handoff}. Ground: ${row.ground}. Effect: ${row.effect}. Next lift: ${row.nextLift}.');
		expect(canvas).toContain('<span class="field-pressure-ground">{row.handoff} / {row.ground}</span>');
		expect(canvas).toContain('<span class="field-pressure-blocked">{row.effect}</span>');
		expect(canvas).toContain('<span class="field-pressure-next">{row.nextLift}</span>');
		expect(canvas).toContain('platformApiSyncRuntimeReady: platformApiSync?.runtimeReady ?? false');
		const launchPressure = section(
			pressureModel,
			'export type LaunchPressureRow',
			'export function summarizeLaunchPressure'
		);
		expect(launchPressure).toContain('id: string;');
		expect(launchPressure).toContain('gate: GateEvidence');
		expect(launchPressure).toContain('handoff: string;');
		expect(launchPressure).toContain('ground: string;');
		expect(launchPressure).toContain('effect: string;');
		expect(launchPressure).toContain('nextLift: string;');
		expect(launchPressure).toContain('futureLift: string');
		expect(launchPressure).toContain('currentGround: string');
		expect(launchPressure).not.toContain('liveGround: string');
		expect(launchPressure).toContain("id: 'platform-api-sync'");
		expect(launchPressure).toContain(
			'href: `${base}/supporters/import/platform-api#platform-sync-boundary`'
		);
		expect(launchPressure).toContain("'read platform sync boundary'");
		expect(launchPressure).toContain(
			'CSV export import and platform source recognition are usable; direct sync remains separate proof.'
		);
		expect(launchPressure).toContain("handoff: 'Platform portability boundary'");
		expect(launchPressure).toContain("ground: 'CSV intake + source recognition'");
		expect(launchPressure).toContain("effect: 'Direct import held'");
		expect(launchPressure).toContain("nextLift: 'direct sync proof'");
		expect(launchPressure).toContain("id: 'text-carrier-dispatch'");
		expect(launchPressure).toContain("handoff: 'Text dispatch boundary'");
		expect(launchPressure).toContain(
			"ground: textDispatchRouteReady ? 'bounded detail batches' : 'drafts + audience snapshots'"
		);
		expect(launchPressure).toContain("id: 'donation-receipt-compliance'");
		expect(launchPressure).toContain(
			'href: `${base}/fundraising#fundraising-receipt-boundary`'
		);
		expect(launchPressure).toContain("action: 'read receipt boundary'");
		expect(launchPressure).toContain(
			'Fundraiser records, public donation state, baseline confirmation outcomes, provider send evidence, and receipt-policy custody are visible.'
		);
		expect(launchPressure).toContain("handoff: 'Fundraising receipts'");
		expect(launchPressure).toContain("nextLift: 'receipt writer + anchoring'");
		expect(launchPressure).toContain("id: 'ab-automated-dispatch'");
		expect(launchPressure).toContain('href: `${base}/emails#ab-continuation-boundary`');
		expect(launchPressure).toContain(
			"action: abAutomationState === 'live' ? 'open experiment runner' : 'read experiment boundary'"
		);
		expect(launchPressure).toContain(
			'email index and detail page expose continuation boundaries for held-back remainder dispatch'
		);
		expect(launchPressure).toContain("handoff: 'A/B continuation'");
		expect(launchPressure).toContain("nextLift: 'server dispatch runtime'");
		expect(launchPressure).toContain("id: 'server-side-email-dispatch'");
		expect(launchPressure).toContain("handoff: 'Email composer'");
		expect(launchPressure).toContain('gate: platformApiGate');
		expect(launchPressure).toContain('gate: smsDispatchGate');
		expect(launchPressure).toContain('gate: donationReceiptGate');
		expect(launchPressure).toContain('gate: abAutomationGate');
		expect(launchPressure).toContain('gate: civicGeographyLabelsGate');
		expect(launchPressure).toContain("id: 'district-state-labels'");
		expect(launchPressure).toContain("name: 'Civic geography cohorts'");
		expect(launchPressure).toContain('href: `${base}/supporters#people-segments`');
		expect(launchPressure).toContain("action: 'read geography boundary'");
		expect(launchPressure).toContain("handoff: 'People segments'");
		expect(launchPressure).toContain("nextLift: 'materialized district labels'");
		expect(launchPressure).not.toContain("name: 'District/state labels'");
		expect(launchPressure).not.toContain("action: 'open People ledger'");
		expect(launchPressure).toContain('gate: workflowEffectsGate');
		expect(launchPressure).toContain("handoff: 'Workflow execution'");
		expect(launchPressure).toContain("nextLift: 'runner side-effect proof'");
		expect(launchPressure).toContain('gate: emailProxyGate');
		expect(launchPressure).toContain("id: 'consent-bound-reach-completion'");
		expect(launchPressure).toContain("name: 'Consent-bound reach completion'");
		expect(launchPressure).toContain('href: `${base}/supporters#email-health`');
		expect(launchPressure).toContain("action: 'read list-health boundary'");
		expect(launchPressure).toContain("handoff: 'Consent-bound reach'");
		expect(launchPressure).toContain("ground: 'subscribed reach + consent evidence'");
		expect(launchPressure).toContain("effect: 'Mailbox and sender-domain proof held'");
		expect(launchPressure).toContain("nextLift: 'mailbox rendering + sender domain'");
		expect(launchPressure).toContain('const consentReachCompletionGate = highestDownstreamGate([');
		expect(launchPressure).toContain('listUnsubscribeProviderGate,');
		expect(launchPressure).toContain('customDomainGate');
		expect(launchPressure).toContain('gate: consentReachCompletionGate');
		expect(launchPressure).toContain("id: 'reader-office-notifications'");
		expect(launchPressure).toContain("name: 'Reader-office notifications'");
		expect(launchPressure).toContain(
			'href: `${base}/settings/webhooks#reader-notification-boundary`'
		);
		expect(launchPressure).toContain("ground: 'signed event substrate'");
		expect(launchPressure).toContain("effect: 'Office alert loop held'");
			expect(launchPressure).toContain("nextLift: 'office profile + notifier'");
			expect(launchPressure).toContain(
				'Commons-owned reader-office notifications remain separate from signed webhook delivery'
			);
			expect(launchPressure).toContain('gate: readerOfficeGate');
			expect(launchPressure).toContain("id: 'durable-proof-settlement'");
			expect(launchPressure).toContain("name: 'Durable proof settlement'");
			expect(launchPressure).toContain('href: `${base}/studio#capability-critical-path`');
			expect(launchPressure).toContain(
				"action: mainnetGate.state === 'live' ? 'open proof settlement' : 'read settlement boundary'"
			);
			expect(launchPressure).toContain("handoff: 'Results proof settlement'");
			expect(launchPressure).toContain("ground: 'verification packet + testnet registry'");
			expect(launchPressure).toContain("effect: 'Mainnet permanence held'");
			expect(launchPressure).toContain("nextLift: 'mainnet anchor + receipt roots'");
			expect(launchPressure).toContain(
				'Receipt roots, durable archive proof, public-chain permanence, and mainnet DistrictRegistry/DebateMarket/SnapshotAnchor remain gated.'
			);
			expect(launchPressure).toContain('gate: mainnetGate');
			expect(launchPressure).toContain("id: 'tee-attested-reasoning'");
			expect(launchPressure).toContain("name: 'TEE-attested reasoning'");
			expect(launchPressure).toContain("handoff: 'TEE attestation path'");
			expect(launchPressure).toContain("ground: 'local resolver + signed AI panel'");
			expect(launchPressure).toContain("effect: 'Enclave trust held'");
			expect(launchPressure).toContain("nextLift: 'Nitro enclave attestation'");
			expect(launchPressure).toContain(
				'TEE-attested constituent resolution, AI panel execution, and position-privacy attestation chain remain gated.'
			);
			expect(launchPressure).toContain('gate: teeGate');
			expect(launchPressure).toContain("id: 'proof-bound-delegated-action'");
			expect(launchPressure).toContain("name: 'Proof-bound delegated action'");
			expect(launchPressure).toContain('href: `${base}/studio#capability-composition`');
			expect(launchPressure).toContain("handoff: 'Delegation executor'");
			expect(launchPressure).toContain("ground: 'Studio reasoning + recovery'");
			expect(launchPressure).toContain("effect: 'Autonomous agent action held'");
			expect(launchPressure).toContain("nextLift: 'executor + proof attachment'");
			expect(launchPressure).toContain(
				'const delegatedActionPressureGate = highestDownstreamGate([delegationGate, teeGate]);'
			);
			expect(launchPressure).toContain('gate: delegatedActionPressureGate');
			expect(component).toContain('listUnsubscribeProviderGate,');
			expect(component).toContain('customDomainGate');
			expect(component).toContain('readerOfficeGate');
			expect(component).toContain('mainnetGate');
			expect(component).toContain('teeGate');
			expect(component).toContain('delegationGate');
			expect(canvas).toContain('listUnsubscribeProviderGate,');
			expect(canvas).toContain('customDomainGate');
			expect(canvas).toContain('readerOfficeGate');
			expect(canvas).toContain('mainnetGate');
			expect(canvas).toContain('teeGate');
			expect(canvas).toContain('delegationGate');
			expect(canonicalDoc).toContain(
				'Reader-office notifications are also part of the shared pressure set'
			);
			expect(canonicalDoc).toContain('Durable proof settlement is part of the same register');
			expect(canonicalDoc).toContain('TEE-attested reasoning is part of the same register');
			expect(canonicalDoc).toContain('Proof-bound delegated action is part of the same register');
			expect(launchPressure).not.toContain('tasks: platformApiGate.tasks');
		expect(launchPressure).not.toContain('downstream: platformApiGate.downstream');
		expect(launchPressure).not.toContain('source: platformApiGate.source');
		const launchPressureMarkup = section(
			component,
			'id="launch-pressure"',
			'class="claim-boundary"'
		);
		expect(component).toContain("import { Cite, Datum, Ratio, Rings, Pulse, RegistryMark } from '$lib/design';");
		expect(launchPressureMarkup).toContain('<Cite cite={row.gate.source} form="ghost">');
		expect(launchPressureMarkup).toContain('<Datum value={row.gate.downstream} />');
		expect(launchPressureMarkup).toContain(
			'<span class="gate-dependency">{row.handoff} / {row.ground}</span>'
		);
		expect(launchPressureMarkup).toContain(
			'<span class="gate-status">{row.gate.status} · {row.gate.completed}/{row.gate.total}</span>'
		);
		expect(launchPressureMarkup).not.toContain('row.liveGround');
		expect(launchPressureMarkup).toContain('<span class="gate-tasks">{row.gate.tasks}</span>');
		expect(launchPressureMarkup).toContain('<span class="gate-blocks">{row.effect}</span>');
		expect(launchPressureMarkup).toContain('<span class="gate-unlocks">{row.nextLift}</span>');
		expect(launchPressureMarkup).toContain('gateSummary(row.gate, {');
		expect(launchPressureMarkup).toContain('prefix: row.futureLift');
		expect(pressureModel).toContain('platformApiSyncRuntimeReady');
		expect(pressureModel).toContain('platformApiSyncRuntimeMissing');

		const readerOfficeGate = getGateEvidence(
			'CP-dm-office-profile',
			['T8-1a', 'T8-1b', 'T8-8'],
			{
				name: 'Reader office integration',
				downstream: 4,
					dependency: 'DM enrichment partnership track'
				}
			);
			const mainnetGate = getGateEvidence('CP-mainnet-deployment', [
				'T3-6',
				'T5-5',
				'T6-2',
				'T6-1'
			]);
			const teeGate = getGateEvidence('CP-tee-nitro-enclave', ['T5-3', 'T5-4']);
			const delegationGate = getGateEvidence('CP-delegation-executor', [
				'T4-2',
				'T4-1',
				'T4-8',
				'T4-9'
			]);
			const pressureRows = buildLaunchPressureRows({
				base: '/org/acme',
			emailDeliveryHref: '/org/acme/emails#email-delivery',
			abAutomationState: 'draft-only',
			civicGeographyLabelsState: 'partial',
			features: {
				AB_TESTING: true,
				EMAIL_SERVER_DISPATCH: false,
				SMS_DISPATCH: false,
				WORKFLOW_EXECUTION: false
			},
			gates: {
				platformApiGate: getGateEvidence('CP-platform-api-sync', ['NEW-T1-3']),
				smsDispatchGate: getGateEvidence('CP-sms-dispatch', ['T2-1']),
				donationReceiptGate: getGateEvidence('CP-donation-receipt-compliance', [
					'T6-1',
					'T6-2'
				]),
				abAutomationGate: getGateEvidence('CP-ab-automated-dispatch', ['T1-6b']),
				civicGeographyLabelsGate: getGateEvidence('CP-civic-geography-labels', ['T1-8c']),
				workflowEffectsGate: getGateEvidence('CP-workflow-effects', ['T1-9']),
				emailProxyGate: getGateEvidence('CP-email-send-proxy', ['T2-2']),
					listUnsubscribeProviderGate: getGateEvidence('CP-list-unsubscribe-provider', [
						'T2-4b'
					]),
					customDomainGate: getGateEvidence('CP-custom-domain', ['T2-6']),
					readerOfficeGate,
					mainnetGate,
					teeGate,
					delegationGate
				}
			});
		const readerOfficePressure = pressureRows.find(
			(row) => row.id === 'reader-office-notifications'
		);
		expect(readerOfficePressure).toMatchObject({
			href: '/org/acme/settings/webhooks#reader-notification-boundary',
			handoff: 'Reader-office notifications',
			ground: 'signed event substrate',
			effect: 'Office alert loop held',
			nextLift: 'office profile + notifier'
		});
			expect(readerOfficePressure?.blocked).toContain(
				'Commons-owned reader-office notifications remain separate from signed webhook delivery'
			);
			expect(readerOfficePressure?.gate.id).toBe('CP-dm-office-profile');
			const durableProofPressure = pressureRows.find((row) => row.id === 'durable-proof-settlement');
			expect(durableProofPressure).toMatchObject({
				href: '/org/acme/studio#capability-critical-path',
				action: 'read settlement boundary',
				handoff: 'Results proof settlement',
				ground: 'verification packet + testnet registry',
				effect: 'Mainnet permanence held',
				nextLift: 'mainnet anchor + receipt roots'
			});
			expect(durableProofPressure?.blocked).toContain(
				'Receipt roots, durable archive proof, public-chain permanence, and mainnet DistrictRegistry/DebateMarket/SnapshotAnchor remain gated.'
			);
			expect(durableProofPressure?.gate.id).toBe('CP-mainnet-deployment');
			const teePressure = pressureRows.find((row) => row.id === 'tee-attested-reasoning');
			expect(teePressure).toMatchObject({
				href: '/org/acme/studio#capability-critical-path',
				action: 'read attestation boundary',
				handoff: 'TEE attestation path',
				ground: 'local resolver + signed AI panel',
				effect: 'Enclave trust held',
				nextLift: 'Nitro enclave attestation'
			});
			expect(teePressure?.blocked).toContain(
				'TEE-attested constituent resolution, AI panel execution, and position-privacy attestation chain remain gated.'
			);
			expect(teePressure?.gate.id).toBe('CP-tee-nitro-enclave');
			const delegatedActionPressure = pressureRows.find(
				(row) => row.id === 'proof-bound-delegated-action'
			);
			expect(delegatedActionPressure).toMatchObject({
				href: '/org/acme/studio#capability-composition',
				action: 'read delegation boundary',
				handoff: 'Delegation executor',
				ground: 'Studio reasoning + recovery',
				effect: 'Autonomous agent action held',
				nextLift: 'executor + proof attachment'
			});
			expect(delegatedActionPressure?.blocked).toContain(
				'Autonomous civic action, ZK proof attachment, grant-indexed replay, and delegation UI remain gated by the executor and attestation path.'
			);
			expect(delegatedActionPressure?.gate.id).toBe('CP-delegation-executor');
			expect(pressureModel).toContain('platformApiSyncRuntimeDependency');
		expect(pressureModel).toContain(
			'Direct platform import still stops while ${platformApiSyncMissingText} are missing.'
		);
		expect(component).not.toContain('Ship Action Network OSDI first');
		expect(component).toContain("getGateEvidence('CP-platform-api-sync'");
		expect(component).not.toContain("getGateEvidence('CP-an-osdi-sync'");
		expect(component).toContain("getGateEvidence('CP-ab-automated-dispatch', ['T1-6b']");
		expect(component).toContain("getGateEvidence('CP-civic-geography-labels', ['T1-8c']");
		expect(pressureModel).toContain('A/B automated dispatch');
		expect(pressureModel).toContain('Civic geography cohorts');
		expect(component).toContain('const abAutomationState = $derived<CapabilityState>');
		expect(pressureModel).toContain('state: abAutomationState');
		expect(component).toContain('const civicGeographyLabelsState = $derived<CapabilityState>');
		expect(pressureModel).toContain('state: civicGeographyLabelsState');
		expect(component).not.toContain('needs hypergraph node');
		expect(component).not.toContain('Campaign clone');
		expect(component).not.toContain('OG images on org');
			expect(component).toContain('type WorkspacePosture');
			expect(component).toContain('type OperatingSpineItem');
			expect(component).toContain('const heldOperatingSpineContractCount = $derived');
			expect(component).toContain('const operatingSpine = $derived<OperatingSpineItem[]>');
			const operatingSpineModel = section(
				component,
				'const operatingSpine = $derived<OperatingSpineItem[]>',
				'function stateLabel'
			);
			expect(operatingSpineModel).toContain("label: 'Move now'");
			expect(operatingSpineModel).toContain("label: 'Qualify'");
			expect(operatingSpineModel).toContain("label: 'Hold'");
			expect(operatingSpineModel).toContain("label: 'Next lift'");
			expect(operatingSpineModel).toContain('safeQueueLiveCount');
			expect(operatingSpineModel).toContain('visibleContractCounts.partial');
			expect(operatingSpineModel).toContain('heldOperatingSpineContractCount');
			expect(operatingSpineModel).toContain('loadBearingGate?.gate.downstream ?? null');
			expect(component).toContain('const workspacePosture = $derived<WorkspacePosture[]>');
			expect(component).toContain('const workspacePostureSegments = $derived(');
			expect(component).toContain('What Commons can realize now');
			expect(component).toContain(
				'const visibleContractCount = $derived(visibleContractStates.length);'
			);
			expect(component).toContain('const visibleHeldContractCount = $derived');
			expect(component).not.toContain('What the OS can realize now');
			const capabilityHeaderMarkup = section(
				component,
				'<header class="capability-head">',
				'<section class="operating-spine"'
			);
			expect(capabilityHeaderMarkup).toContain('class="capability-head-count"');
			expect(capabilityHeaderMarkup).toContain('class="capability-head-total"');
			expect(capabilityHeaderMarkup).toContain('class="capability-head-split"');
			expect(capabilityHeaderMarkup).toContain(
				'Capability map: ${visibleContractCount} visible contracts'
			);
			expect(capabilityHeaderMarkup).toContain(
				'${surfacedClusterCount}/${clusterCoverage.length} canonical clusters surfaced'
			);
			expect(capabilityHeaderMarkup).toContain(
				'${visibleContractCounts.live} armed contracts'
			);
			expect(capabilityHeaderMarkup).toContain(
				'${visibleContractCounts.partial} bounded contracts'
			);
			expect(capabilityHeaderMarkup).toContain(
				'${visibleHeldContractCount} held contracts'
			);
			expect(capabilityHeaderMarkup).toContain(
				'<Datum value={visibleContractCount} cite="Capability map visible contracts" />'
			);
			expect(capabilityHeaderMarkup).toContain(
				'<Datum value={surfacedClusterCount} cite="Capability coverage visible contracts" />'
			);
			expect(capabilityHeaderMarkup).toContain(
				'<Datum value={clusterCoverage.length} cite="CAPABILITY_CLUSTER_IDS" />'
			);
			expect(capabilityHeaderMarkup).toContain(
				'<Datum value={visibleHeldContractCount} cite="Capability map visible contracts" />'
			);
			expect(capabilityHeaderMarkup).not.toContain('class="capability-sub"');
			expect(capabilityHeaderMarkup).not.toContain(
				'Nine clusters plus loop, send, path, gate, and evidence contracts'
			);
			expect(component).toContain('.capability-head-count');
			expect(component).toContain('.capability-head-split');
			expect(component).not.toContain('.capability-sub');
			expect(component).toContain('aria-label="Operating spine"');
			const operatingSpineMarkup = section(
				component,
				'class="operating-spine"',
				'class="workspace-posture"'
			);
			expect(operatingSpineMarkup).toContain('aria-label="Operating spine axis"');
			expect(operatingSpineMarkup).toContain('{#each operatingSpine as item (item.id)}');
			expect(operatingSpineMarkup).toContain(
				'<Datum value={item.value} cite={item.cite} />'
			);
			expect(operatingSpineMarkup).toContain(
				'<span class="operating-spine-detail">{item.detail}</span>'
			);
			expect(operatingSpineMarkup).toContain(
				'<span class="operating-spine-gate">{item.gate}</span>'
			);
			expect(operatingSpineMarkup).toContain(
				'<span class="operating-spine-action">{actionLabel(item.state, item.action)}</span>'
			);
			expect(component).toContain('.operating-spine');
			expect(component).toContain('.operating-spine-row[data-state=\'gated\']');
			expect(component).toContain(
				'aria-label="Workspace posture across Studio, People, Power, Results"'
			);
		const workspacePostureModel = section(
			component,
			'const workspacePosture = $derived<WorkspacePosture[]>',
			'const workspacePostureStateCounts = $derived('
		);
		expect(workspacePostureModel).toContain("label: 'Studio'");
		expect(workspacePostureModel).toContain("id: 'workspace-studio'");
		expect(workspacePostureModel).toContain("label: 'People'");
		expect(workspacePostureModel).toContain("id: 'workspace-people'");
		expect(workspacePostureModel).toContain("label: 'Power'");
		expect(workspacePostureModel).toContain("id: 'workspace-power'");
		expect(workspacePostureModel).toContain("label: 'Results'");
		expect(workspacePostureModel).toContain("id: 'workspace-results'");
		expect(workspacePostureModel).not.toContain("label: 'Substrate'");
		expect(workspacePostureModel).toContain('state: authoringLoopState');
		expect(workspacePostureModel).toContain('value: authoringLoopMetric.value');
		expect(workspacePostureModel).toContain('label: authoringLoopMetric.label');
		expect(workspacePostureModel).toContain('cite: authoringLoopMetric.cite');
		expect(workspacePostureModel).toContain(
			'summary: `${authoringLoopSummary}; Send remains subordinate in Send readiness.`'
		);
		expect(workspacePostureModel).toContain('ground: authoringLoopGround');
		expect(workspacePostureModel).toContain('nextLift: authoringLoopNextLift');
		expect(workspacePostureModel).not.toContain("label: 'armed phases'");
		expect(component).toContain('const peopleGroundState = $derived<CapabilityState>(');
		expect(component).toContain(
			'[peopleSourceProvenanceReadiness.state, emailListHealthReadiness.state].sort('
		);
		expect(component).toContain('boundaryPriority(a) - boundaryPriority(b)');
		expect(component).toContain('const peopleGroundSignal = $derived(');
		expect(component).toContain(
			'`${emailListHealthReadiness.signal}; ${peopleSourceProvenanceReadiness.signal}`'
		);
		expect(component).toContain('const peopleGroundSummary = $derived(');
		expect(component).toContain(
			'`${emailListHealthReadiness.effect} ${peopleSourceProvenanceReadiness.effect}`'
		);
		expect(component).toContain('const peopleGroundGate = $derived(');
		expect(component).toContain(
			'Mainnet identity and enclave resolver trust remain the proof-strength lift beyond source custody and consent-bound reach.'
		);
		expect(component).toContain('const peopleGroundMetric = $derived(');
		expect(component).toContain('const peopleGroundNextGate = $derived(');
		expect(component).toContain('const peopleGroundNextLift = $derived(');
		expect(workspacePostureModel).toContain('state: peopleGroundState');
		expect(workspacePostureModel).toContain('href: peopleGroundHref');
		expect(workspacePostureModel).toContain('action: peopleGroundAction');
		expect(workspacePostureModel).toContain('value: peopleGroundMetric.value');
		expect(workspacePostureModel).toContain('label: peopleGroundMetric.label');
		expect(workspacePostureModel).toContain('cite: peopleGroundMetric.cite');
		expect(workspacePostureModel).toContain('summary: peopleGroundSummary');
		expect(workspacePostureModel).toContain('gate: peopleGroundGate');
		expect(workspacePostureModel).toContain('ground: peopleGroundSignal');
		expect(workspacePostureModel).toContain('nextLift: peopleGroundNextLift');
		expect(workspacePostureModel).not.toContain("label: 'reachable'");
		expect(workspacePostureModel).not.toContain("subscribed > 0 ? 'live' : 'partial'");
		expect(workspacePostureModel).toContain('state: powerTerrainReadiness.state');
		expect(workspacePostureModel).toContain(
			'firstHeldPowerTerrainRow?.href ?? `${base}/representatives#power-reach-boundary`'
		);
		expect(workspacePostureModel).toContain('firstHeldPowerTerrainRow?.action ??');
		expect(workspacePostureModel).toContain('value: powerTerrainReadiness.terrainCount');
		expect(workspacePostureModel).toContain("cite: 'buildPowerTerrainReadiness'");
		expect(workspacePostureModel).toContain('summary: powerTerrainReadiness.effect');
		expect(workspacePostureModel).toContain(
			'gate: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate'
		);
		expect(workspacePostureModel).toContain('ground: powerTerrainReadiness.signal');
		expect(workspacePostureModel).toContain(
			'nextLift: firstHeldPowerTerrainRow?.label ?? powerTerrainReadiness.nextGate.name'
		);
		expect(workspacePostureModel).toContain('state: resultsProofReadiness.state');
		expect(workspacePostureModel).toContain(
			'href: firstHeldResultsProofRow?.href ?? resultsProofReadiness.href'
		);
		expect(workspacePostureModel).toContain(
			'action: firstHeldResultsProofRow?.action ?? resultsProofReadiness.action'
		);
		expect(workspacePostureModel).toContain('resultsProofReadiness.metric.label');
		expect(workspacePostureModel).toContain('summary: resultsProofReadiness.effect');
		expect(workspacePostureModel).toContain(
			'gate: firstHeldResultsProofRow?.boundary ?? resultsProofReadiness.gate'
		);
		expect(workspacePostureModel).toContain('ground: resultsProofReadiness.signal');
		expect(workspacePostureModel).toContain(
			'nextLift: firstHeldResultsProofRow?.label ?? resultsProofReadiness.nextGate.name'
		);
		expect(workspacePostureModel).not.toContain('supporters.getSummaryStats email health');
		expect(workspacePostureModel).not.toContain(
			'power.legislationEnabled && (powerTerrainCount ?? 0) > 0'
		);
		expect(workspacePostureModel).not.toContain('decision-maker follows, watched bills, scorecards');
		expect(workspacePostureModel).not.toContain(
			'Full terrain waits on state, local, and international reach expansion.'
		);
		expect(workspacePostureModel).not.toContain(
			'Current packet, packet integrity, and reader proof are available.'
		);
		expect(workspacePostureModel).not.toContain(
			'Action or delivery ground is loaded; packet proof waits on records.'
		);
		expect(workspacePostureModel).toContain('authoringLoopGate');
		expect(workspacePostureModel).not.toContain('reachExpansionGate');
		expect(workspacePostureModel).toContain('resultsProofReadiness.gate');
		expect(workspacePostureModel).toContain('sendReadiness.sendBoundarySummary');
		expect(workspacePostureModel).not.toContain(': sendReadiness.nextHeldLabel');
		expect(workspacePostureModel).not.toContain(
			'This role can author and watch; route handoffs and send side effects require org authority.'
		);
		expect(workspacePostureModel).not.toContain('Org authority for route handoffs.');
		expect(workspacePostureModel).not.toContain('publish handoffs require publish authority');
		expect(workspacePostureModel).not.toContain('Publish authority for handoffs.');
		expect(workspacePostureModel).toContain('ground:');
		expect(workspacePostureModel).toContain('nextLift:');
		expect(workspacePostureModel).not.toContain('intent and message streams are armed');
		expect(workspacePostureModel).not.toContain('Intent and message streams are armed');
		expect(workspacePostureModel).not.toContain('message streams are armed');
		expect(workspacePostureModel).not.toContain(
			"nextLift: 'Receipt anchoring and reader-office response.'"
		);
		const workspacePostureMarkup = section(
			component,
			'class="workspace-posture"',
			'<section class="operating-readout"'
		);
		expect(workspacePostureMarkup).toContain(
			'<Ratio segments={workspacePostureSegments} height={8} />'
		);
		expect(workspacePostureMarkup).toContain('class="workspace-posture-count"');
		expect(workspacePostureMarkup).toContain(
			'<Datum value={workspacePosture.length} cite="Workspace posture rows" />'
		);
		expect(workspacePostureMarkup).toContain(
			'<Datum value={workspacePostureStateCounts.live} cite="Workspace posture rows" />'
		);
		expect(workspacePostureMarkup).toContain(
			'<Datum value={workspacePostureStateCounts.partial} cite="Workspace posture rows" />'
		);
		expect(workspacePostureMarkup).toContain(
			"value={workspacePostureStateCounts['draft-only'] + workspacePostureStateCounts.gated}"
		);
		expect(workspacePostureMarkup).toContain('class="workspace-posture-split"');
		expect(workspacePostureMarkup).toContain('{#each workspacePosture as item (item.id)}');
		expect(workspacePostureMarkup).not.toContain('{#each workspacePosture as item (item.label)}');
		expect(workspacePostureMarkup).toContain(
			'<Datum value={item.signal.value} cite={item.signal.cite} />'
		);
		expect(workspacePostureMarkup).toContain('<span class="workspace-posture-meta-label">Ground</span>');
		expect(workspacePostureMarkup).toContain('<span class="workspace-posture-meta-label">Next</span>');
		expect(workspacePostureMarkup).toContain('title="{item.label}: {item.summary} Gate: {item.gate}"');
		expect(workspacePostureMarkup).toContain('Full gate: {item.gate}');
		expect(workspacePostureMarkup).toContain('{actionLabel(item.state, item.action)}');
		expect(workspacePostureMarkup).not.toContain(
			'Four workspaces, one cited signal each. Substrate stays ambient.'
		);
		expect(component).toContain('.workspace-posture-count {');
		expect(component).not.toContain('.workspace-posture-note {');

		expect(layout).toContain('buildLaunchPressureRows({');
		expect(layout).toContain(
			'const launchPressureSummary = $derived(summarizeLaunchPressure(launchPressureRows))'
		);
		expect(layout).toContain('const launchPressureCount');
		expect(layout).toContain('const firstLaunchPressureRow = $derived(launchPressureRows[0] ?? null)');
		expect(layout).toContain('const highestFanoutLaunchPressureRow = $derived(');
		expect(layout).toContain('const launchVectorHeldSurfaceCount = $derived(');
		expect(layout).toContain('const launchVectorCommandState = $derived<CapabilityCommandState>');
		expect(layout).toContain('const launchVectorCommandSignal = $derived(');
		expect(layout).toContain('const launchVectorCommandGate = $derived(');
		expect(layout).toContain('const abAutomationState = $derived<CapabilityCommandState>');
		expect(layout).toContain('const civicGeographyLabelsState = $derived<CapabilityCommandState>');
		expect(layout).toContain(
			'const platformApiSync = $derived(data.spaces.operating?.platformApiSync ?? null)'
		);
		expect(layout).toContain(
			'platformApiSyncRuntimeReady: platformApiSync?.runtimeReady ?? false'
		);
		expect(layout).toContain("id: 'capability-launch-pressure'");
		expect(layout).toContain("label: 'Launch pressure'");
		expect(layout).toContain('href: `${base}/studio#launch-pressure`');
		expect(layout).toContain("id: 'capability-launch-vector'");
		expect(layout).toContain("label: 'Launch vector'");
		expect(layout).toContain('href: `${base}/studio#capability-launch-vector`');
		expect(layout).toContain(
			"action: spotlightActionForState(launchVectorCommandState, 'read launch vector')"
		);
		expect(layout).not.toContain('const launchPressureStates');
		expect(layout).not.toContain(
			"commandGate(abAutomationGate, 'A/B continuation remains draft-only.')"
		);
		expect(layout).not.toContain(
			"commandGate(civicGeographyLabelsGate, 'Civic geography labels remain bounded.')"
		);
		expect(layout).not.toContain('A/B ${abAutomationGate.tasks}');
		expect(layout).not.toContain('civic labels ${civicGeographyLabelsGate.tasks}');
		expect(layout).not.toContain('need tracked task nodes');
		expect(canonicalDoc).toContain(
			"The register and Spotlight's Launch pressure command both read from `buildLaunchPressureRows` / `summarizeLaunchPressure`"
		);
		expect(canonicalDoc).toContain(
			'Its header renders `Datum`-backed blocker count, bounded/held mix, and highest downstream fan-out from `launchPressureRows`, `launchPressureStateCounts`, and `highestFanoutLaunchPressureRow` before the row audit'
		);
		expect(canonicalDoc).toContain(
			'Spotlight exposes Launch vector at `#capability-launch-vector`'
		);
	});

	it('keeps workspace strip unlocks backed by hypergraph gate summaries', () => {
		const baseSpace = source('src/lib/components/org/os/BaseSpace.svelte');
		const landscapeSpace = source('src/lib/components/org/os/LandscapeSpace.svelte');
		const returnSpace = source('src/lib/components/org/os/ReturnSpace.svelte');
		const capabilityMap = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const workspaceStrip = source('src/lib/components/org/os/WorkspaceCapabilityStrip.svelte');
		const stateLabels = source('src/lib/data/capability-state-labels.ts');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(hypergraph).toContain('export function formatGateEvidence');
		expect(hypergraph).toContain('gate.completed}/${gate.total} complete');
		expect(hypergraph).toContain('gate.downstream} downstream');
		expect(capabilityMap).toContain('formatGateEvidence,');
		expect(capabilityMap).toContain(
			"return formatGateEvidence(gate, { ...options, density: 'operator' });"
		);
		expect(workspaceStrip).toContain('operatorCapabilityStateRatioSegments');
		expect(workspaceStrip).toContain('handoff?: string');
		expect(workspaceStrip).toContain('const handoff = item.handoff ? `Handoff: ${item.handoff}. ` : \'\';');
		expect(workspaceStrip).toContain('{#if item.handoff}');
		expect(workspaceStrip).toContain('<span>{item.handoff}</span>');
		expect(workspaceStrip).toContain(
			'const stateSegments = $derived(operatorCapabilityStateRatioSegments(stateCounts));'
		);
		expect(workspaceStrip).toContain(
			"const heldContractCount = $derived(stateCounts['draft-only'] + stateCounts.gated);"
		);
		expect(workspaceStrip).toContain("label: stateLabel('live')");
		expect(workspaceStrip).toContain("label: stateLabel('partial')");
		expect(workspaceStrip).toContain("label: stateLabel('draft-only')");
		expect(workspaceStrip).toContain("label: stateLabel('gated')");
		expect(workspaceStrip).toContain('operatorCapabilityStateLabel,');
		expect(workspaceStrip).toContain('return operatorCapabilityStateLabel(state);');
		expect(workspaceStrip).toContain('class="strip-count"');
		expect(workspaceStrip).toContain('class="strip-count-total"');
		expect(workspaceStrip).toContain('class="strip-count-split"');
		expect(workspaceStrip).toContain(
			'${itemCount} local capability contracts; ${stateCounts.live} armed; ${stateCounts.partial} bounded; ${heldContractCount} held'
		);
		expect(workspaceStrip).toContain(
			'<Datum value={itemCount} cite="WorkspaceCapabilityStrip local rows" />'
		);
		expect(workspaceStrip).toContain(
			'<Datum value={stateCounts.live} cite="WorkspaceCapabilityStrip local rows" />'
		);
		expect(workspaceStrip).toContain(
			'<Datum value={stateCounts.partial} cite="WorkspaceCapabilityStrip local rows" />'
		);
		expect(workspaceStrip).toContain(
			'<Datum value={heldContractCount} cite="WorkspaceCapabilityStrip local rows" />'
		);
		expect(workspaceStrip).not.toContain('class="strip-note"');
		expect(workspaceStrip).not.toContain('strip-note-num');
		expect(workspaceStrip).not.toContain('local contracts · phase / cluster / handoff / gate');
		expect(workspaceStrip).not.toContain('/ route / gate');
		expect(workspaceStrip).toContain('<span class="pressure-kicker">next unlock</span>');
		expect(workspaceStrip).toContain(
			'aria-label="Next local unlock: {pressureLabel(pressureItem)}'
		);
		expect(workspaceStrip).toContain('<span class="pressure-unlock">');
		expect(workspaceStrip).toContain('<span class="pressure-unlock-label">Gate</span>');
		expect(workspaceStrip).toContain('<span>{pressureItem.unlock}</span>');
		expect(workspaceStrip).not.toContain('<span class="pressure-kicker">local pressure</span>');
		expect(workspaceStrip).toContain("return `${item.label}: draft only until its gate clears.`");
		expect(workspaceStrip).not.toContain('draft-only until its gate clears');
		expect(stateLabels).toContain('export function operatorCapabilityStateRatioSegments');
		expect(stateLabels).toContain('labelSuffix?: string');
		expect(stateLabels).toContain('const label = operatorCapabilityStateLabel(state)');
		expect(stateLabels).toContain(
			'label: options.labelSuffix ? `${label}${options.labelSuffix}` : label'
		);
		expect(stateLabels).toContain("return 'draft only'");
		expect(workspaceStrip).not.toContain("label: 'armed'");
		expect(workspaceStrip).not.toContain("label: 'bounded'");
		expect(workspaceStrip).not.toContain("label: 'draft'");
		expect(workspaceStrip).not.toContain("label: 'not armed'");

		expect(baseSpace).toContain('buildPeopleSourceProvenanceReadiness,');
		expect(baseSpace).toContain('buildPeopleSegmentationReadiness,');
		expect(baseSpace).toContain('buildEmailListHealthReadiness,');
		expect(baseSpace).toContain('formatGateEvidence,');
		expect(baseSpace).toContain('getGateEvidence,');
		expect(baseSpace).toContain('type PeopleHeaderMetric');
		expect(baseSpace).toContain(
			'const peopleHeaderMetrics = $derived<PeopleHeaderMetric[]>(['
		);
		expect(baseSpace).toContain("label: 'people loaded'");
		expect(baseSpace).toContain("cite: 'supporters.getSummaryStats total'");
		expect(baseSpace).toContain("label: 'address evidence'");
		expect(baseSpace).toContain("cite: 'supporters.getSummaryStats postalResolved'");
		expect(baseSpace).toContain("label: 'district signal'");
		expect(baseSpace).toContain("cite: 'supporters.getSummaryStats districtVerified'");
		expect(baseSpace).toContain("label: 'identity verified'");
		expect(baseSpace).toContain("cite: 'supporters.getSummaryStats identityVerified'");
		expect(baseSpace).toContain("label: 'subscribed reach'");
		expect(baseSpace).toContain("cite: 'supporters.getSummaryStats emailHealth.subscribed'");
		expect(baseSpace).toContain('aria-label="People verification evidence counts"');
		expect(baseSpace).toContain('{#each peopleHeaderMetrics as metric (metric.label)}');
		expect(baseSpace).toContain('class="base-proof-count"');
		expect(baseSpace).toContain('<Datum value={metric.value} cite={metric.cite} />');
		expect(baseSpace).toContain('People ledger →');
		expect(baseSpace).toContain('operatorCapabilityActionLabel,');
		expect(baseSpace).toContain('operatorCapabilityStateVerbLabel');
		expect(baseSpace).toContain(
			'const peopleLedgerHandoffMetrics = $derived<PeopleHeaderMetric[]>(['
		);
		expect(baseSpace).toContain("label: 'ledger rows'");
		expect(baseSpace).toContain("label: 'proof-weight rows'");
		expect(baseSpace).toContain("label: 'reachable rows'");
		expect(baseSpace).toContain(
			"? `${base}/supporters#people-ledger-boundary`"
		);
		expect(baseSpace).toContain('id="people-ledger-handoff"');
		expect(baseSpace).toContain('aria-label="People ledger capability handoff"');
		expect(baseSpace).toContain('data-state={peopleSourceProvenanceReadiness.state}');
		expect(baseSpace).toContain('aria-label="People ledger handoff evidence"');
		expect(baseSpace).toContain('Encrypted person rows are operational drilldown');
		expect(baseSpace).toContain('peopleSourceProvenanceReadiness.gate');
		expect(baseSpace).not.toContain('search, filter, and tag');
		expect(baseSpace).not.toContain('ledger-cta');
		expect(baseSpace).not.toContain('Full people ledger →');
		expect(baseSpace).toContain("getGateEvidence('CP-mainnet-deployment', ['T3-6', 'T5-3']");
		expect(baseSpace).toContain("getGateEvidence('CP-platform-api-sync', ['T1-3']");
		expect(baseSpace).not.toContain("getGateEvidence('CP-an-osdi-sync'");
			expect(baseSpace).toContain("getGateEvidence('CP-2', ['T2-2']");
			expect(baseSpace).toContain("getGateEvidence('CP-list-unsubscribe', ['T2-4']");
			expect(baseSpace).toContain("'CP-list-unsubscribe-provider-rendering'");
			expect(baseSpace).toContain("['T2-4b']");
			expect(baseSpace).toContain("getGateEvidence('CP-soft-bounce-categorization', ['T2-5']");
		expect(baseSpace).toContain("getGateEvidence('CP-custom-domain-dkim', ['T2-6']");
		expect(baseSpace).toContain("getGateEvidence('CP-civic-geography-labels', ['T1-8c']");
		expect(baseSpace).toContain('formatGateEvidence(verificationTrustGate');
		expect(baseSpace).toContain('formatGateEvidence(peopleSegmentationReadiness.nextGate');
		expect(baseSpace).toContain('formatGateEvidence(emailListHealthReadiness.nextGate');
		expect(baseSpace).toContain('unlock: peopleSourceProvenanceReadiness.gate');
		expect(baseSpace).toContain("cluster: 'C-verification / C-data-sovereignty'");
		expect(baseSpace).toContain("cluster: 'C-data-sovereignty / C-reach'");
		expect(baseSpace).not.toContain("cluster: 'verification / data sovereignty'");
		expect(baseSpace).not.toContain("cluster: 'reach / verification'");
		expect(baseSpace).not.toContain('T3-6 + T5-3 move this from district/testnet trust');
		expect(baseSpace).not.toContain('T1-3 / AN partnership closes Action Network OSDI sync');
		expect(baseSpace).not.toContain('Email send proxy (NEW-T2-2) arms proxy-backed delivery');

		expect(landscapeSpace).toContain('buildPowerTerrainReadiness,');
		expect(landscapeSpace).toContain('type PowerTerrainRow');
		expect(landscapeSpace).toContain('getGateEvidence,');
		expect(landscapeSpace).toContain("'CP-state-local-terrain'");
		expect(landscapeSpace).toContain("'CP-international-power-terrain'");
		expect(landscapeSpace).toContain("'CP-state-bill-terrain'");
		expect(landscapeSpace).toContain("'CP-non-federal-scorecards'");
		expect(landscapeSpace).toContain("'CP-reader-office-profile'");
		expect(landscapeSpace).toContain('buildPowerTerrainReadiness({');
		expect(landscapeSpace).toContain('powerTerrainRows.map((row) => ({');
		expect(landscapeSpace).toContain('cluster: row.clusters');
		expect(landscapeSpace).toContain('detail: row.ground');
		expect(landscapeSpace).toContain('unlock: row.boundary');
		expect(landscapeSpace).toContain('type PowerHeaderMetric');
		expect(landscapeSpace).toContain(
			'const powerHeaderMetrics = $derived<PowerHeaderMetric[]>(['
		);
		expect(landscapeSpace).toContain("label: 'followed targets'");
		expect(landscapeSpace).toContain("cite: 'legislation.listOrgDmFollows followedCount'");
		expect(landscapeSpace).toContain("value: data?.legislationEnabled ? bills.length : null");
		expect(landscapeSpace).toContain("label: 'watched bills'");
		expect(landscapeSpace).toContain("cite: 'legislation.listWatchedBills'");
		expect(landscapeSpace).toContain(
			'value: data?.legislationEnabled ? data.scorecardSnapshotCount : null'
		);
		expect(landscapeSpace).toContain("label: 'score snapshots'");
		expect(landscapeSpace).toContain("cite: 'legislation.listOrgScorecards scored snapshots'");
		expect(landscapeSpace).toContain('label: terrainCountMetric.label');
		expect(landscapeSpace).toContain('cite: terrainCountMetric.cite');
		expect(landscapeSpace).toContain('aria-label="Power terrain evidence counts"');
		expect(landscapeSpace).toContain('{#each powerHeaderMetrics as metric (metric.label)}');
		expect(landscapeSpace).toContain('class="landscape-proof-count"');
		expect(landscapeSpace).toContain('<Datum value={metric.value} cite={metric.cite} />');
		expect(landscapeSpace).toContain('Power terrain coverage');
		expect(landscapeSpace).not.toContain('formatGateEvidence');
		expect(landscapeSpace).not.toContain('CP-reach-expansion');
		expect(landscapeSpace).toContain('Open power targets →');
		expect(landscapeSpace).toContain('Open bills terrain →');
		expect(landscapeSpace).toContain('Open accountability scores →');
		expect(landscapeSpace).not.toContain('>Open →</a>');
		expect(landscapeSpace).not.toContain('T3-1/T3-2 add structured state');
		expect(landscapeSpace).not.toContain('T6-6 + T3-1 extend the terrain');
		expect(landscapeSpace).not.toContain('T6-1/T6-2 anchor receipt batches');

		expect(returnSpace).toContain('buildResultsProofReadiness,');
		expect(returnSpace).toContain('getGateEvidence,');
		expect(returnSpace).toContain('type ResultsProofRow');
		expect(returnSpace).toContain("import { FEATURES } from '$lib/config/features';");
		expect(returnSpace).toContain("getGateEvidence('CP-dm-office-profile', ['T8-1b', 'T8-8']");
		expect(returnSpace).toContain(
			"getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2', 'T6-9']"
		);
		expect(returnSpace).toContain("getGateEvidence('CP-coordination-integrity', ['T10-10']");
		expect(returnSpace).toContain('const resultsProofReadiness = $derived(');
		expect(returnSpace).toContain('buildResultsProofReadiness({');
		expect(returnSpace).toContain(
			'const resultsProofRows = $derived<ResultsProofRow[]>(resultsProofReadiness.rows);'
		);
		expect(returnSpace).toContain(
			"resultsProofRows.find((row) => row.id === 'receipt-anchoring') ?? null"
		);
		expect(returnSpace).toContain('const proofDeliveryGateSummary = $derived(');
		expect(returnSpace).toContain('Proof delivery is a route handoff.');
		expect(returnSpace).toContain('receiptAnchoringRow?.boundary ?? resultsProofReadiness.gate');
		expect(returnSpace).toContain('type ResultsHeaderMetric');
		expect(returnSpace).toContain(
			'const resultsHeaderMetrics = $derived<ResultsHeaderMetric[]>(['
		);
		expect(returnSpace).toContain("label: 'packet verified'");
		expect(returnSpace).toContain("cite: 'computeVerificationPacketCached top packet'");
		expect(returnSpace).toContain("label: 'receipt rows'");
		expect(returnSpace).toContain("cite: 'legislation.getOrgReceiptSummary bounded sample'");
		expect(returnSpace).toContain("label: 'logged responses'");
		expect(returnSpace).toContain("cite: 'legislation.getOrgReceiptSummary responseLoggedCount'");
		expect(returnSpace).toContain("label: 'active records'");
		expect(returnSpace).toContain("cite: 'organizations.getDashboardStats activeCampaigns'");
		expect(returnSpace).toContain('aria-label="Results proof evidence counts"');
		expect(returnSpace).toContain('{#each resultsHeaderMetrics as metric (metric.label)}');
		expect(returnSpace).toContain('class="return-proof-count"');
		expect(returnSpace).toContain('<Datum value={metric.value} cite={metric.cite} />');
		expect(returnSpace).toContain('aria-label="Results receipt response posture"');
		expect(returnSpace).toContain('class="receipt-posture-cell"');
		expect(returnSpace).toContain('data.receipts.loadedCount');
		expect(returnSpace).toContain('data.receipts.responseLoggedCount');
		expect(returnSpace).toContain('data.receipts.pendingCount');
		expect(returnSpace).toContain('data.receipts.anchorFieldCount');
		expect(returnSpace).toContain('data.receipts.sampleLimit');
		expect(returnSpace).toContain('receiptAnchoringRow?.boundary ?? resultsProofReadiness.gate');
		expect(returnSpace).not.toContain('Recent Arrivals');
		expect(returnSpace).not.toContain('signed up');
		expect(returnSpace).not.toContain('recentActivity');
		expect(returnSpace).toContain('resultsProofRows.map((row) => ({');
		expect(returnSpace).toContain('label: row.label');
		expect(returnSpace).toContain('state: row.state');
		expect(returnSpace).toContain('phase: row.phase');
		expect(returnSpace).toContain('cluster: row.clusters');
		expect(returnSpace).toContain('handoff: row.handoff');
		expect(returnSpace).toContain('detail: row.ground');
		expect(returnSpace).toContain('unlock: row.boundary');
		expect(returnSpace).toContain('aria-label="Proof packet handoff contract"');
		expect(returnSpace).toContain('Open proof delivery');
		expect(returnSpace).toContain('Preview packet');
		expect(returnSpace).not.toContain('>Deliver Proof<');
		expect(returnSpace).not.toContain('>Preview Packet<');
		expect(returnSpace).not.toContain("label: 'Reader proof packet'");
		expect(returnSpace).not.toContain("label: 'Delivery response'");
		expect(returnSpace).not.toContain("label: 'Coordination integrity'");
		expect(returnSpace).not.toContain('GDS, authorship diversity');
		expect(returnSpace).not.toContain('T8-1b adds the reader-office surface');
		expect(returnSpace).not.toContain('T6-1/T6-2 anchor receipt batches');
		expect(returnSpace).not.toContain('T10-10 adds history and trend');

			expect(canonicalDoc).toContain(
				'People, Power, and Results strip unlock text renders through `formatGateEvidence`'
			);
			expect(canonicalDoc).toContain('visible **next unlock** handoff');
			expect(canonicalDoc).toContain(
				'the next-unlock row shows the gate text directly, not only in accessible copy or lower row detail'
			);
			expect(canonicalDoc).toContain(
				'The People workspace header renders a `Datum`-backed verification evidence strip from `peopleHeaderMetrics`'
			);
			expect(canonicalDoc).toContain(
				'people loaded, address evidence, district signal, identity verification, and subscribed reach from the loaded People summary'
			);
			expect(capabilityScope).toContain(
				'The mounted People header renders `peopleHeaderMetrics` as a `Datum`-backed verification evidence strip'
			);
			expect(capabilityScope).toContain(
				'people loaded, address evidence, district signal, identity-verified people, and subscribed reach all cite the same layout People slice'
			);
			expect(canonicalDoc).toContain(
				'The Power workspace header renders a `Datum`-backed terrain evidence strip from `powerHeaderMetrics`'
			);
			expect(canonicalDoc).toContain(
				'followed targets, watched bills, score snapshots, and loaded terrain records from the loaded Power summary'
			);
			expect(capabilityScope).toContain(
				'The mounted Power header renders `powerHeaderMetrics` as a `Datum`-backed terrain evidence strip'
			);
			expect(capabilityScope).toContain(
				'followed targets, watched bills, score snapshots, and loaded terrain records cite the same layout Power slice and shared `buildPowerTerrainReadiness` terrain total'
			);
			expect(canonicalDoc).toContain(
				'The strip uses the same operator-state translation as the Studio map'
			);
		expect(canonicalDoc).toContain(
			'Power interior handoffs name their destination capabilities directly'
		);
		expect(canonicalDoc).toContain(
			'The folded Results `WorkspaceCapabilityStrip` projects those shared rows directly; it does not own separate reader/delivery/integrity copy.'
		);
		expect(canonicalDoc).toContain(
			'The Results workspace header renders a `Datum`-backed proof evidence strip from `resultsHeaderMetrics`'
		);
			expect(canonicalDoc).toContain(
				'packet-verified actions from the current computed packet, bounded receipt source rows, logged responses, and active action records all cite the same layout Results slice'
			);
		expect(canonicalDoc).toContain(
			'Results packet actions read as route handoffs, not proof side effects'
		);
	});

	it('keeps action, text, and email route strips backed by hypergraph gate summaries', () => {
		const actionIndex = source('src/routes/org/[slug]/campaigns/+page.svelte');
		const newAction = source('src/routes/org/[slug]/campaigns/new/+page.svelte');
		const newActionServer = source('src/routes/org/[slug]/campaigns/new/+page.server.ts');
		const actionDetail = source('src/routes/org/[slug]/campaigns/[id]/+page.svelte');
		const emailIndex = source('src/routes/org/[slug]/emails/+page.svelte');
		const emailDetail = source('src/routes/org/[slug]/emails/[blastId]/+page.svelte');
		const emailDetailServer = source('src/routes/org/[slug]/emails/[blastId]/+page.server.ts');
		const emailReceipts = source('src/routes/org/[slug]/emails/[blastId]/receipts/+page.svelte');
		const emailReceiptsServer = source(
			'src/routes/org/[slug]/emails/[blastId]/receipts/+page.server.ts'
		);
		const emailCompose = source('src/routes/org/[slug]/emails/compose/+page.svelte');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const textIndex = source('src/routes/org/[slug]/sms/+page.svelte');
		const textIndexServer = source('src/routes/org/[slug]/sms/+page.server.ts');
		const textDraft = source('src/routes/org/[slug]/sms/new/+page.svelte');
		const textDraftServer = source('src/routes/org/[slug]/sms/new/+page.server.ts');
		const textDetail = source('src/routes/org/[slug]/sms/[id]/+page.svelte');
		const textDetailServer = source('src/routes/org/[slug]/sms/[id]/+page.server.ts');
		const textCreateApi = source('src/routes/api/org/[slug]/sms/+server.ts');
		const textAudienceCountApi = source('src/routes/api/org/[slug]/sms/audience-count/+server.ts');
		const textApi = source('src/routes/api/org/[slug]/sms/[id]/+server.ts');
		const textRuntime = source('src/lib/server/sms/text-dispatch-readiness.ts');
		const clientTextSender = source('src/lib/services/client-text-sender.ts');
		const layoutServer = source('src/routes/org/[slug]/+layout.server.ts');
		const smsSchema = source('convex/schema.ts');
		const smsConvex = source('convex/sms.ts');
		const smsHttp = source('convex/http.ts');
		const smsWebhooks = source('convex/webhooks.ts');
		const smsReplyRegister = source('src/lib/components/sms/SmsReplyRegister.svelte');
		const smsBlastCard = source('src/lib/components/sms/SmsBlastCard.svelte');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(hypergraph).toContain('export type ActionRecordReadinessRowKey =');
		expect(hypergraph).toContain('export function buildActionRecordReadiness');
		for (const rowKey of [
			"'action-record'",
			"'jurisdiction-resolve'",
			"'reader-action-surface'",
			"'packet-artifact'",
			"'decision-maker-delivery'",
			"'quality-settlement'",
			"'completed-evidence'",
			"'congress-proof-delivery'"
		]) {
			expect(hypergraph).toContain(rowKey);
		}
		expect(hypergraph).toContain(
			'Action readiness separates saved action records, jurisdiction resolve, reader action intake, packet artifacts, decision-maker proof delivery, quality settlement, completed evidence, and CWC transport boundaries.'
		);
		expect(hypergraph).toContain('CWC proof delivery is held until');
		expect(hypergraph).toContain('submissions.getCongressionalDeliveryReadiness');

		for (const actionRoute of [actionIndex, newAction, actionDetail]) {
			expect(actionRoute).toContain('buildActionRecordReadiness,');
			expect(actionRoute).toContain('getGateEvidence,');
			expect(actionRoute).toContain('type ActionRecordReadinessRowKey');
			expect(actionRoute).toContain('const actionRecordReadiness = $derived(');
			expect(actionRoute).toContain('buildActionRecordReadiness({');
			expect(actionRoute).toContain('actionRecordReadiness.rows.find');
			expect(actionRoute).toContain('cluster: row.clusters');
			expect(actionRoute).toContain('detail: row.ground');
			expect(actionRoute).toContain('unlock: row.boundary');
			expect(actionRoute).not.toContain('formatGateEvidence(');
			expect(actionRoute).not.toContain("label: 'Action-to-proof records'");
			expect(actionRoute).not.toContain("label: 'Live proof pressure'");
			expect(actionRoute).not.toContain("label: 'Congress proof delivery'");
		}

		expect(actionIndex).toContain('context: \'index\'');
		expect(actionIndex).toContain("'completed-evidence'");
		expect(actionIndex).toContain("'packet-artifact'");
		expect(actionIndex).toContain("recordCount: data.counts.ALL");

			expect(newAction).toContain('context: \'draft\'');
			expect(newAction).toContain("import { Datum } from '$lib/design';");
			expect(newAction).toContain('type ActionCreationPressureReadout = {');
			expect(newAction).toContain("congressionalDelivery: data.congressionalDelivery");
			expect(newAction).toContain("'congress-proof-delivery'");
			expect(newAction).toContain('const congressionalProofDeliveryRow = $derived(');
			expect(newAction).toContain('const draftActionRecordRow = $derived(');
			expect(newAction).toContain('const jurisdictionResolveRow = $derived(');
			expect(newAction).toContain('const heldActionCreationRows = $derived(');
			expect(newAction).toContain('const nextProofLiftRow = $derived(');
			expect(newAction).toContain(
				'const actionCreationPressureReadouts = $derived<ActionCreationPressureReadout[]>(['
			);
			expect(newAction).toContain("id: 'draft-ground'");
			expect(newAction).toContain("label: 'Draft ground'");
			expect(newAction).toContain("id: 'proof-route'");
			expect(newAction).toContain("label: 'Proof route'");
			expect(newAction).toContain("id: 'next-proof-lift'");
			expect(newAction).toContain("label: 'Next proof lift'");
			expect(newAction).toContain("'congress-proof-delivery': '#proof-delivery-boundary'");
			expect(newAction).toContain('id="proof-delivery-boundary"');
			expect(newAction).toContain('aria-label="Action creation pressure"');
			expect(newAction).toContain('{#each actionCreationPressureReadouts as readout (readout.id)}');
			expect(newAction).toContain('<Datum value={readout.metric.value} cite={readout.metric.cite} />');
			expect(newAction).toContain('actionLabel(readout.state, readout.action)');
			expect(newAction).toContain(
				'operatorCapabilityActionLabel(state, action, { appendReadyArrow: true })'
			);
			expect(newAction).toContain('function pressureCellClass(state: CapabilityState): string');
			expect(newAction).toContain('Draft action record');
			expect(newAction).toContain('Quality settlement');
			expect(newAction).toContain('settlement remains gated');
			expect(newAction).not.toContain('Assemble Proof');
			expect(newAction).not.toContain('Enable on-chain debate for this proof packet');
			expect(newAction).not.toContain('adversarial debate spawns');
			expect(newActionServer).toContain('buildCongressionalDeliveryGround');
			expect(newActionServer).toContain('api.submissions.getCongressionalDeliveryReadiness');
			expect(newActionServer).toContain('congressionalDelivery: buildCongressionalDeliveryGround');
			expect(canonicalDoc).toContain(
				'The action creation route opens with route-local **Action creation pressure** cells for Draft ground, Proof route, and Next proof lift'
			);
			expect(canonicalDoc).toContain(
				'Send readiness routes no-id **CWC congressional delivery** to `/campaigns/new#proof-delivery-boundary`'
			);
			expect(capabilityScope).toContain(
				'The action creation route now opens with **Action creation pressure** cells for Draft ground, Proof route, and Next proof lift'
			);
			expect(capabilityScope).toContain(
				'no-id handoff routes to `/campaigns/new#proof-delivery-boundary`'
			);

		expect(actionDetail).toContain('context: \'detail\'');
		expect(actionDetail).toContain("hasPacket: !!packet");
		expect(actionDetail).toContain("'decision-maker-delivery'");
		expect(actionDetail).toContain("'reader-action-surface'");
		expect(hypergraph).toContain(
			'A proof packet is computed from verified action data and can be opened in the report route.'
		);
		expect(hypergraph).toContain(
			'Recipient rows are present; the proof-delivery surface queues only selected targets and keeps receipt anchoring bounded.'
		);
		expect(actionDetail).toContain('Open proof delivery');
		expect(actionDetail).not.toContain('Deliver Proof');
		expect(canonicalDoc).toContain(
			'`buildActionRecordReadiness` supersedes route-local action strip copy'
		);
		expect(capabilityScope).toContain(
			'`buildActionRecordReadiness` now owns action-record index, builder, and detail route strips'
		);

			expect(emailIndex).toContain('buildSendReadiness,');
			expect(emailIndex).toContain('operatorCapabilityActionLabel,');
			expect(emailIndex).toContain('operatorCapabilityStateLabel');
			expect(emailIndex).toContain("import { Datum } from '$lib/design';");
			expect(emailIndex).toContain('type EmailSendPressureReadout = {');
			expect(emailIndex).toContain('formatGateEvidence,');
			expect(emailIndex).toContain('getGateEvidence,');
			expect(emailIndex).toContain('type SendReadinessMode');
			expect(emailIndex).toContain('const emailReceiptResponseGate = getGateEvidence(');
			expect(emailIndex).toContain("'CP-receipt-anchoring'");
			expect(emailIndex).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
			expect(emailIndex).toContain('formatGateEvidence(emailReceiptResponseGate');
			expect(emailIndex).toContain("const abAutomationGate = getGateEvidence('CP-ab-automated-dispatch'");
			expect(emailIndex).toContain(
				'const emailDelivery = $derived(data.spaces.operating?.emailDelivery ?? null)'
			);
			expect(emailIndex).toContain('const sendReadiness = $derived(');
			expect(emailIndex).toContain('buildSendReadiness({');
			expect(emailIndex).toContain('canPublish: canCreate,');
			expect(emailIndex).toContain('emailDelivery,');
			expect(emailIndex).toContain(
				'const sendReadinessModes = $derived<SendReadinessMode[]>(sendReadiness.modes);'
			);
			expect(emailIndex).toContain(
				"const browserDirectMode = $derived(requiredSendMode(sendReadinessModes, 'browser-direct'))"
			);
			expect(emailIndex).toContain(
				"const serverDispatchMode = $derived(requiredSendMode(sendReadinessModes, 'server-email'))"
			);
			expect(emailIndex).toContain(
				"const abContinuationMode = $derived(requiredSendMode(sendReadinessModes, 'ab-automation'))"
			);
			expect(emailIndex).toContain('const abBlasts = $derived');
			expect(emailIndex).toContain('const abGroupCount = $derived');
			expect(emailIndex).toContain('const abDraftCount = $derived');
			expect(emailIndex).toContain('const abContinuationStateLabel = $derived');
			expect(emailIndex).toContain('operatorCapabilityStateLabel(abContinuationMode.state)');
			expect(emailIndex).toContain('const deliveryRecordState = $derived<CapabilityState>');
			expect(emailIndex).toContain('const deliveryRecordGate = $derived');
			expect(emailIndex).toContain('const nextSendLiftMode = $derived');
			expect(emailIndex).toContain(
				'const emailSendPressureReadouts = $derived<EmailSendPressureReadout[]>(['
			);
			expect(emailIndex).toContain("id: 'delivery-ground'");
			expect(emailIndex).toContain("id: 'browser-send-path'");
			expect(emailIndex).toContain("id: 'next-send-lift'");
			expect(emailIndex).toContain("label: 'Delivery ground'");
			expect(emailIndex).toContain("label: 'Browser path'");
			expect(emailIndex).toContain("label: 'Next send lift'");
			expect(emailIndex).toContain('browserDirectMode.effect');
			expect(emailIndex).toContain('nextSendLiftMode.effect');
			expect(emailIndex).toContain('aria-label="Email send pressure"');
			expect(emailIndex).toContain(
				'{#each emailSendPressureReadouts as readout (readout.id)}'
			);
			expect(emailIndex).toContain('<Datum value={readout.metric.value} cite={readout.metric.cite} />');
			expect(emailIndex).toContain('actionLabel(readout.state, readout.action)');
			expect(emailIndex).toContain(
				'operatorCapabilityActionLabel(state, action, { appendReadyArrow: true })'
			);
			expect(emailIndex).toContain('function pressureCellClass(state: CapabilityState): string');
			expect(emailIndex).toContain("label: 'A/B continuation'");
			expect(emailIndex).toContain("href: `${base}/emails#ab-continuation-boundary`");
			expect(emailIndex).toContain('id="ab-continuation-boundary"');
			expect(emailIndex).toContain('Experiment dispatch boundary');
			expect(emailIndex).toContain('{abContinuationMode.effect}');
			expect(emailIndex).toContain('{abContinuationMode.unlock}');
			expect(emailIndex).toContain('{abContinuationStateLabel}');
			expect(emailIndex).toContain('email.listBlasts abParentId');
			expect(emailIndex).toContain("label: 'Send boundary'");
			expect(emailIndex).toContain('state: sendReadiness.nextHeldMode?.state ?? sendReadiness.state');
			expect(emailIndex).toContain('sendReadiness.heldModeSummary');
			expect(emailIndex).toContain('`${sendReadiness.heldModeSummary}; ${sendReadiness.sendBoundarySummary}`');
			expect(emailIndex).toContain('unlock: sendReadiness.sendBoundaryGate');
			expect(emailIndex).toContain("cite: 'buildSendReadiness heldCount'");
			expect(emailIndex).toContain('metric: browserDirectMode.metric');
			expect(emailIndex).not.toContain('const browserDirectState = $derived(');
			expect(emailIndex).not.toContain('const browserDirectGate = $derived(');
			expect(emailIndex).not.toContain('formatGateEvidence(emailProxyGate');
			expect(emailIndex).not.toContain("state: 'partial' as const,\n\t\t\tphase: 'SEND'");
			expect(emailIndex).not.toContain('value: totalSent');
			expect(canonicalDoc).toContain(
				'The email delivery index also renders **Email send pressure** before the A/B boundary and record list.'
			);
			expect(canonicalDoc).toContain(
				'Delivery ground from route-local delivery records, Browser path from the `browser-direct` `buildSendReadiness` mode, and Next send lift from `sendReadiness.nextHeldMode`'
			);
			expect(capabilityScope).toContain(
				'Email send posture now starts with route-local **Email send pressure** cells for Delivery ground, Browser path, and Next send lift'
			);

			expect(emailDetail).toContain('WorkspaceCapabilityStrip');
		expect(emailDetail).toContain('label="Email detail capability"');
		expect(emailDetail).toContain('buildEmailDeliveryEvidenceReadiness,');
		expect(emailDetail).toContain('type EmailDeliveryEvidenceRow');
		expect(emailDetail).toContain('getGateEvidence,');
		expect(emailDetail).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
		expect(emailDetail).toContain('const receiptAnchoringGate = getGateEvidence(');
		expect(emailDetail).toContain("'CP-receipt-anchoring'");
		expect(emailDetail).toContain(
			"const abAutomationGate = getGateEvidence('CP-ab-automated-dispatch', ['T1-6b']"
		);
		expect(emailDetail).toContain("const listHealthGate = getGateEvidence('CP-2', ['T2-2']");
		expect(emailDetail).toContain(
			"const engagementTelemetryGate = getGateEvidence('CP-email-engagement-attribution', ['T2-10']"
		);
		expect(emailDetail).toContain('const emailDeliveryEvidence = $derived(');
		expect(emailDetail).toContain('buildEmailDeliveryEvidenceReadiness({');
		expect(emailDetail).toContain('emailDeliveryEvidence.detailRows.map');
		expect(emailDetail).toContain('function emailDetailHref');
		expect(emailDetail).toContain(
			'const abContinuationPressureReadouts = $derived<AbContinuationPressureReadout[]>(['
		);
		expect(emailDetail).toContain('aria-label="A/B continuation pressure"');
		expect(emailDetail).toContain("label: 'Snapshot ground'");
		expect(emailDetail).toContain("label: 'Held remainder'");
		expect(emailDetail).toContain("label: 'Dispatch gate'");
		expect(emailDetail).toContain('emailAbTestCohorts.totalCount');
		expect(emailDetail).toContain('EMAIL_SERVER_DISPATCH + getEmailServerDispatchReadiness');
		expect(hypergraph).toContain('export function buildEmailDeliveryEvidenceReadiness');
		expect(hypergraph).toContain('export type EmailDeliveryEvidenceRowKey');
		expect(hypergraph).toContain("label: 'Delivery record'");
		expect(hypergraph).toContain("label: 'Engagement telemetry'");
		expect(hypergraph).toContain("label: 'Receipt evidence'");
		expect(hypergraph).toContain("label: 'Experiment continuation'");
		expect(hypergraph).toContain("label: 'List-health response'");
		expect(emailDetail).toContain("return '#email-record'");
		expect(emailDetail).toContain("return '#email-engagement-telemetry'");
		expect(emailDetail).toContain("return '#email-receipt-evidence'");
		expect(emailDetail).toContain("return '#email-list-health'");
		expect(emailDetail).toContain('id="email-record"');
		expect(emailDetail).toContain('id="email-engagement-telemetry"');
		expect(emailDetail).toContain('id="email-experiment-boundary"');
		expect(emailDetail).toContain('id="email-receipt-evidence"');
		expect(emailDetail).toContain('id="email-list-health"');
		expect(emailDetail).toContain('data.receiptSummary.pageCount');
		expect(hypergraph).toContain("cite: 'email.listReceiptsForBlast'");
		expect(emailDetail).toContain('counters alone are not treated as durable receipt proof.');
		expect(hypergraph).toContain(
			'Open/click telemetry is not armed for this delivery record; sent status, receipt rows, and bounce/complaint counters remain countable evidence.'
		);
		expect(hypergraph).toContain(
			'The blast record carries sent plus bounce/complaint counters from email.getBlast; open/click telemetry is a separate gated evidence layer.'
		);
		expect(hypergraph).toContain("'FEATURES.ENGAGEMENT_METRICS + T2-10'");
		expect(emailDetail).not.toContain('const deliveryRecordState = $derived');
		expect(emailDetail).not.toContain('const receiptEvidenceState = $derived');
		expect(emailDetail).not.toContain('const experimentContinuationState = $derived');
		expect(emailDetail).not.toContain('Open and click counters are gated in this build');
		expect(emailDetail).not.toContain(
			'The blast record carries sent/open/click/bounce counters from email.getBlast'
		);
		expect(emailDetail).not.toContain('bulk-send Lambda after each batch');
		expect(emailDetailServer).toContain('async function loadReceiptSummary');
		expect(emailDetailServer).toContain('api.email.listReceiptsForBlast');
		expect(emailDetailServer).toContain('numItems: 50');
		expect(emailDetailServer).toContain('receiptSummary,');

		expect(emailReceipts).toContain('WorkspaceCapabilityStrip');
		expect(emailReceipts).toContain('Email receipt register capability');
		expect(emailReceipts).toContain('buildEmailDeliveryEvidenceReadiness,');
		expect(emailReceipts).toContain('type EmailDeliveryEvidenceRow');
		expect(emailReceipts).toContain('emailDeliveryEvidence.receiptRegisterRows.map');
		expect(emailReceipts).toContain('function receiptRegisterHref');
		expect(hypergraph).toContain("label: 'Delivery record context'");
		expect(hypergraph).toContain("label: 'Receipt row register'");
		expect(hypergraph).toContain("label: 'Dispatch outcome evidence'");
		expect(hypergraph).toContain("label: 'Recipient privacy boundary'");
		expect(hypergraph).toContain("label: 'Anchored receipt proof'");
		expect(emailReceipts).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
		expect(emailReceipts).toContain('const receiptAnchoringGate = getGateEvidence(');
		expect(emailReceipts).toContain("'CP-receipt-anchoring'");
		expect(emailReceipts).toContain("const listHealthGate = getGateEvidence('CP-2', ['T2-2']");
		expect(emailReceipts).toContain('id="email-receipt-register"');
		expect(emailReceipts).toContain('id="email-dispatch-outcomes"');
		expect(emailReceipts).toContain('id="recipient-hash-boundary"');
		expect(emailReceipts).toContain('id="email-receipt-anchoring-boundary"');
		expect(hypergraph).toContain('emailDeliveryReceipts, not anchored accountability receipts');
		expect(hypergraph).toContain('does not claim Merkle anchoring');
		expect(hypergraph).toContain('plaintext remains encrypted under the org key elsewhere');
		expect(hypergraph).toContain("cite: 'email.listReceiptsForBlast'");
		expect(hypergraph).toContain("cite: 'emailDeliveryReceipts.status'");
		expect(emailReceipts).not.toContain('const receiptRegisterState = $derived');
		expect(emailReceipts).not.toContain('const outcomeState = $derived');
		expect(emailReceipts).not.toContain('const privacyState = $derived');
		expect(emailReceipts).not.toContain('bulk-send Lambda after each batch');
		expect(emailReceipts).not.toContain('text-indigo');
		expect(emailReceipts).not.toContain('text-slate');
		expect(emailReceiptsServer).toContain('orgSlug: params.slug');
		expect(emailReceiptsServer).toContain('api.email.listReceiptsForBlast');
		expect(canonicalDoc).toContain('`buildEmailDeliveryEvidenceReadiness`');
		expect(canonicalDoc).toContain(
			'loaded `emailDeliveryReceipts` rows are operator evidence only'
		);

			expect(emailCompose).toContain('buildSendReadiness,');
			expect(emailCompose).toContain('formatGateEvidence,');
			expect(emailCompose).toContain('getGateEvidence,');
			expect(emailCompose).toContain('type CapabilityState,');
			expect(emailCompose).toContain('type SendReadinessMode');
			expect(emailCompose).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
			expect(emailCompose).toContain(
				"const abAutomationGate = getGateEvidence('CP-ab-automated-dispatch', ['T1-6b']"
			);
			expect(emailCompose).toContain('const sendReadiness = $derived(');
			expect(emailCompose).toContain('buildSendReadiness({');
			expect(emailCompose).toContain('canPublish,');
			expect(emailCompose).toContain('emailDelivery: emailDeliveryGround,');
			expect(emailCompose).toContain(
				'const sendReadinessModes = $derived<SendReadinessMode[]>(sendReadiness.modes);'
			);
			expect(emailCompose).toContain(
				'const sendBoundarySummary = $derived(sendReadiness.sendBoundarySummary);'
			);
			expect(emailCompose).toContain(
				'const sendBoundaryGateSummary = $derived(sendReadiness.sendBoundaryGate);'
			);
			expect(emailCompose).toContain('aria-label="Shared email send readiness boundary"');
			expect(emailCompose).toContain('buildSendReadiness heldCount');
			expect(emailCompose).toContain('sendReadiness.heldModeSummary');
			expect(emailCompose).toContain('sendReadiness.browserDirectSignal');
			expect(emailCompose).toContain('const browserDirectExecutable = $derived(');
			expect(emailCompose).toContain(
				"sendReadiness.browserDirectState === 'partial' && !mergeFieldsBlockClientSend"
			);
			expect(emailCompose).toContain("requiredSendMode(sendReadinessModes, 'browser-direct')");
			expect(emailCompose).toContain("requiredSendMode(sendReadinessModes, 'server-email')");
			expect(emailCompose).toContain("requiredSendMode(sendReadinessModes, 'ab-automation')");
			expect(emailCompose).toContain('const mergePersonalizationState = $derived<CapabilityState>');
			expect(emailCompose).toContain('client-direct merge runner is not armed');
			expect(emailCompose).toContain('server dispatch still owns its own runtime gate');
			expect(emailCompose).toContain('Browser-direct merge is draft-only');
			expect(emailCompose).not.toContain('Merge fields preview with sample data only');
			expect(emailCompose).not.toContain('personalized dispatch disabled');
			expect(emailCompose).not.toContain('Merge fields are preview-only in this build');
			expect(emailCompose).toContain('formatGateEvidence(abAutomationGate');
			expect(emailCompose).toContain("cite: 'recipient filter count + emailAbTestCohorts'");
			expect(emailCompose).toContain('operatorCapabilityStateRatioSegments');
		expect(emailCompose).toContain(
			'const deliverySegments = $derived(operatorCapabilityStateRatioSegments(deliveryStateCounts));'
		);
			expect(emailCompose).toContain('return operatorCapabilityStateLabel(state);');
			expect(emailCompose).not.toContain('const clientDirectState = $derived');
			expect(emailCompose).not.toContain('const serverDispatchState = $derived');
			expect(emailCompose).not.toContain('const mergeState = $derived');
			expect(emailCompose).not.toContain("label: 'live'");
			expect(emailCompose).not.toContain("label: 'partial'");
			expect(emailCompose).not.toContain("label: 'gated'");

		expect(textDraft).toContain('buildTextDeliveryReadiness,');
		expect(textDraft).toContain('getGateEvidence,');
		expect(textDraft).toContain('type TextCarrierProofRow');
		expect(textDraft).toContain('type TextDeliveryReadinessRow');
		expect(textDraft).toContain('operatorCapabilityActionLabel');
		expect(textDraft).toContain('operatorCapabilityStateLabel');
		expect(textDraft).toContain(
			"const smsDispatchGate = getGateEvidence('CP-sms-dispatch', ['T2-1']"
		);
		expect(textDraft).toContain(
			"const smsReceiptAnchoringGate = getGateEvidence('CP-receipt-anchoring'"
		);
		expect(textDraft).toContain('const textReplyRegisterGate = getGateEvidence(');
		expect(textDraft).toContain("'CP-reader-office-profile'");
		expect(textDraft).toContain(
			'Reader-office profiles, office-response workflow, and notification webhooks'
		);
		expect(textDraft).toContain('const textDeliveryReadiness = $derived(');
		expect(textDraft).toContain('buildTextDeliveryReadiness({');
		expect(textDraft).toContain('subscribedPhoneCount: data.smsHealth.subscribed');
		expect(textDraft).toContain('plannedRecipientCount: audienceCount');
		expect(textDraft).toContain('replyCount: 0');
		expect(textDraft).toContain('textReplyRegisterGate');
		expect(textDraft).toContain(
			'dispatchClientBatchRouteMounted: data.textDispatchClientBatchRouteMounted'
		);
		expect(textDraft).toContain('const textCarrierProofRows = $derived<TextCarrierProofRow[]>');
		expect(textDraft).toContain("import { Datum } from '$lib/design';");
		expect(textDraft).toContain('let selectedTagIds = $state<string[]>([])');
		expect(textDraft).toContain('let excludedTagIds = $state<string[]>([])');
		expect(textDraft).toContain('let selectedSegmentIds = $state<string[]>([])');
		expect(textDraft).toContain('let audienceCount = $state(data.initialAudienceCount)');
		expect(textDraft).toContain('const recipientFilterPayload = $derived(');
		expect(textDraft).toContain('/sms/audience-count');
		expect(textDraft).toContain('recipientFilter: recipientFilterPayload');
		expect(textDraft).toContain('id="text-audience-snapshot"');
		expect(textDraft).toContain('sms.countEligibleRecipientsForFilter');
		expect(textDraft).toContain('Save and open dispatch');
		expect(textDraft).toContain('?dispatch=1#text-dispatch-status');
		expect(textDraft).toContain("row.id === 'text-draft-packets'");
		expect(textDraft).toContain("row.id === 'text-audience-snapshots'");
		expect(textDraft).toContain("cluster: row.clusters");
		expect(textDraft).toContain("unlock: row.boundary");
		expect(textDraft).not.toContain('Dispatch gated');
		expect(textDraft).not.toContain('<button\n\t\t\t\ttype="button"\n\t\t\t\tdisabled');
		expect(textDraft).not.toContain('formatGateEvidence(');
		expect(textDraft).not.toContain('qualitySettlementGate');
		expect(textDraftServer).toContain('serverQuery(api.supporters.getTags');
		expect(textDraftServer).toContain('serverQuery(api.segments.list');
		expect(textDraftServer).toContain('serverQuery(api.sms.countEligibleRecipientsForFilter');
		expect(textDraftServer).toContain('initialAudienceCount: initialAudience?.eligibleCount ?? 0');
		expect(textCreateApi).toContain('api.sms.countEligibleRecipientsForFilter');
		expect(textCreateApi).toContain('totalRecipients: audience.eligibleCount');
		expect(textCreateApi).toContain('recipientFilter: parsedFilter');
		expect(textAudienceCountApi).toContain('SMS audience count boundary');
		expect(textAudienceCountApi).toContain('RecipientFilterSchema');
		expect(textAudienceCountApi).toContain('api.sms.countEligibleRecipientsForFilter');
		expect(textAudienceCountApi).toContain("source: result.source");
		expect(smsConvex).toContain('export const countEligibleRecipientsForFilter = query');
		expect(smsConvex).toContain('applySmsRecipientFilter(ctx, org._id, supporters');
		expect(smsConvex).toContain('source: "sms.applySmsRecipientFilter"');
		expect(smsSchema).toContain('smsReplies: defineTable');
		expect(smsSchema).toContain(".index('by_twilioSid', ['twilioSid'])");
		expect(smsHttp).toContain('const messageSid = params.MessageSid;');
		expect(smsHttp).toContain('messageSid: typeof messageSid === "string"');
		expect(smsWebhooks).toContain('messageSid: v.optional(v.string())');
		expect(smsWebhooks).toContain("query('smsReplies')");
		expect(smsWebhooks).toContain("withIndex('by_twilioSid'");
		expect(smsWebhooks).toContain("query('orgTwilioNumbers')");
		expect(smsWebhooks).toContain("ctx.db.insert('smsReplies'");
		expect(smsWebhooks).toContain('body: replyBody.slice(0, 1600)');
		expect(smsConvex).toContain('export const getReplySummary = query');
		expect(smsConvex).toContain('export const listReplies = query');
		expect(smsConvex).toContain('matchedSupporterCount');
		expect(smsConvex).toContain('linkedBlastId: reply.blastId ?? null');

		for (const sourceText of [textIndex, textDetail, textDraft]) {
			expect(sourceText).toContain('type TextDeliveryPressureReadout = {');
			expect(sourceText).toContain('operatorCapabilityActionLabel');
			expect(sourceText).toContain('operatorCapabilityStateLabel');
			expect(sourceText).toContain('const textPacketScopeProofRow = $derived');
			expect(sourceText).toContain('const textPhoneCustodyProofRow = $derived');
			expect(sourceText).toContain('const nextTextProofLiftRow = $derived');
			expect(sourceText).toContain(
				'const textDeliveryPressureReadouts = $derived<TextDeliveryPressureReadout[]>(['
			);
			expect(sourceText).toContain("id: 'packet-scope'");
			expect(sourceText).toContain("label: 'Packet scope'");
			expect(sourceText).toContain("id: 'phone-custody'");
			expect(sourceText).toContain("label: 'Phone custody'");
			expect(sourceText).toContain("id: 'next-proof-lift'");
			expect(sourceText).toContain("label: 'Next proof lift'");
			expect(sourceText).toContain(
				'return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });'
			);
			expect(sourceText).toContain('function pressureCellClass(state: CapabilityState): string');
			expect(sourceText).toContain('aria-label="Text delivery pressure"');
			expect(sourceText).toContain(
				'{#each textDeliveryPressureReadouts as readout (readout.id)}'
			);
			expect(sourceText).toContain('actionLabel(readout.state, readout.action)');
			expect(sourceText).toContain(
				'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
			);
			expect(sourceText).toContain('Carrier acceptance, reply handling, and durable receipt proof');
		}
		expect(textDraft).toContain('SMS body and audience scope');
		expect(textDraft).toContain('local composer count');
		expect(textDraft).toContain('eligible phones match the current scope');

		for (const sourceText of [textIndex, textDetail]) {
			expect(sourceText).toContain('buildTextDeliveryReadiness,');
			expect(sourceText).toContain('getGateEvidence,');
			expect(sourceText).toContain('type TextCarrierProofRow');
			expect(sourceText).toContain('type TextDeliveryReadinessRow');
			expect(sourceText).toContain(
				"const smsDispatchGate = getGateEvidence('CP-sms-dispatch', ['T2-1']"
			);
			expect(sourceText).toContain(
				"const smsReceiptAnchoringGate = getGateEvidence('CP-receipt-anchoring'"
			);
			expect(sourceText).toContain('const textReplyRegisterGate = getGateEvidence(');
			expect(sourceText).toContain("'CP-reader-office-profile'");
			expect(sourceText).toContain('const textDeliveryReadiness = $derived(');
			expect(sourceText).toContain('buildTextDeliveryReadiness({');
			expect(sourceText).toContain('subscribedPhoneCount: data.smsHealth.subscribed');
			expect(sourceText).toContain('replyCount');
			expect(sourceText).toContain('textReplyRegisterGate');
			expect(sourceText).toContain('dispatchRuntimeReady: data.textDispatchRuntimeReady');
			expect(sourceText).toContain('dispatchRuntimeMissing: data.textDispatchRuntimeMissing');
			expect(sourceText).toContain('dispatchRuntimeDependency: data.textDispatchRuntimeDependency');
			expect(sourceText).toContain(
				'dispatchClientBatchRouteMounted: data.textDispatchClientBatchRouteMounted'
			);
			expect(sourceText).toContain('const textDeliveryRows = $derived<TextDeliveryReadinessRow[]>');
			expect(sourceText).toContain('const textCarrierProofRows = $derived<TextCarrierProofRow[]>');
			expect(sourceText).toContain('const textCarrierProofStateCounts = $derived');
			expect(sourceText).toContain('const textCarrierProofSegments = $derived');
			expect(sourceText).toContain('const heldTextCarrierProofCount = $derived');
			expect(sourceText).toContain('operatorCapabilityStateRatioSegments');
			expect(sourceText).toContain('id="text-carrier-proof-contract"');
			expect(sourceText).toContain('Carrier dispatch proof');
			expect(sourceText).toContain('What must be true before texts leave Commons');
			expect(sourceText).toContain('aria-label="Text carrier dispatch proof contract"');
			expect(sourceText).toContain('buildTextDeliveryReadiness proofRows');
			expect(sourceText).toContain('{#each textCarrierProofRows as row (row.id)}');
			expect(sourceText).toContain('{row.effect}');
			expect(sourceText).toContain("cluster: row.clusters");
			expect(sourceText).toContain("unlock: row.boundary");
			expect(sourceText).not.toContain('formatGateEvidence(');
		}
		expect(textIndex).toContain("import { Datum, Ratio } from '$lib/design';");
		expect(textIndex).toContain("import SmsReplyRegister from '$lib/components/sms/SmsReplyRegister.svelte'");
		expect(textIndex).toContain('const replyCount = $derived(data.replySummary.replyCount)');
		expect(textIndex).toContain('id="text-replies"');
		expect(textIndex).toContain('<SmsReplyRegister replies={data.recentReplies}');
		expect(textIndex).toContain('Inbound free-text SMS replies are response evidence');
		expect(textDetail).toContain(
			"import SmsReplyRegister from '$lib/components/sms/SmsReplyRegister.svelte'"
		);
		expect(textDetail).toContain('const replyCount = $derived(data.replies.length)');
		expect(textDetail).toContain("row.id === 'reader-reply-register'");
		expect(textDetail).toContain('id="text-replies"');
		expect(textDetail).toContain('<SmsReplyRegister replies={data.replies}');
		expect(textDetail).toContain('without phone-number exposure');
		expect(smsReplyRegister).toContain('No inbound text replies recorded.');
		expect(smsReplyRegister).toContain('matched supporter');
		expect(smsReplyRegister).toContain('org number only');
		expect(smsReplyRegister).not.toContain('phone number');
		for (const sourceText of [textIndex, textDraft, textDetail]) {
			expect(sourceText).toContain('Browser phone custody and Twilio dispatch runner');
			expect(sourceText).not.toContain('Client-side phone decryptor + Twilio proxy');
		}

		for (const sourceText of [textIndexServer, textDraftServer, textDetailServer]) {
			expect(sourceText).toContain('const EMPTY_SMS_HEALTH = {');
			expect(sourceText).toContain('const { org, spaces');
			expect(sourceText).toContain('smsHealth: spaces.base?.smsHealth ?? EMPTY_SMS_HEALTH');
			expect(sourceText).toContain(
				'textDispatchRuntimeReady: spaces.operating.textDelivery?.dispatchRuntimeReady ?? false'
			);
			expect(sourceText).toContain(
				'textDispatchRuntimeMissing: spaces.operating.textDelivery?.dispatchRuntimeMissing ?? []'
			);
			expect(sourceText).toContain(
				'textDispatchClientBatchRouteMounted:'
			);
		}
		expect(textIndexServer).toContain('serverQuery(api.sms.getReplySummary');
		expect(textIndexServer).toContain('serverQuery(api.sms.listReplies');
		expect(textIndexServer).toContain('replySummary: {');
		expect(textIndexServer).toContain('recentReplies: recentReplies.map');
		expect(textDetailServer).toContain('serverQuery(api.sms.listReplies');
		expect(textDetailServer).toContain('blastId: params.id as Id');
		expect(textDetailServer).toContain('replies: replies.map');
		expect(layoutServer).toContain('serverQuery(api.sms.getReplySummary');
		expect(layoutServer).toContain(
			'const smsReplySummaryRow = smsReplySummary as Record<string, unknown> | null'
		);
		expect(layoutServer).toContain('replyCount: asNumber(smsReplySummaryRow?.replyCount)');
		expect(textRuntime).toContain('getTextDispatchReadiness');
		expect(textRuntime).toContain('TEXT_DISPATCH_RUNNER_IMPLEMENTED = true');
		expect(textRuntime).toContain('TEXT_DISPATCH_CLIENT_DECRYPTOR_MOUNTED = false');
		expect(textRuntime).toContain('TEXT_DISPATCH_CLIENT_BATCH_ROUTE_MOUNTED = true');
		expect(textRuntime).toContain('text dispatch feature gate');
		expect(textRuntime).toContain('browser phone custody');
		expect(textRuntime).toContain('Twilio dispatch runner');
		expect(textRuntime).toContain(
			'text dispatch gate, browser phone custody, Twilio dispatch runner, and transport credentials'
		);
		expect(textRuntime).not.toContain(
			'SMS_DISPATCH flag + client-side phone decryptor + Twilio proxy runner + Twilio env'
		);
		expect(textRuntime).not.toContain('SMS_DISPATCH feature flag');
		expect(textRuntime).not.toContain('client-side phone decryptor');
		expect(textRuntime).not.toContain('Twilio proxy runner');
		expect(textRuntime).toContain('clientDecryptorMounted');
		expect(textRuntime).toContain('clientBatchRouteMounted');
		expect(textRuntime).toContain('open_without_client_decryptor');
		expect(textRuntime).toContain('TWILIO_ACCOUNT_SID');
		expect(textRuntime).toContain(
			'Bulk text dispatch runtime is ready for a client-decrypted recipient batch.'
		);
		expect(textApi).toContain("error: 'text_dispatch_not_armed'");
		expect(textApi).toContain("error: 'text_dispatch_decrypted_recipients_required'");
		expect(textApi).toContain('const SendBodySchema = z');
		expect(textApi).toContain('decryptedRecipients');
		expect(textApi).toContain('expectedTotalRecipients');
		expect(textApi).toContain('finalBatch');
		expect(textApi).toContain('MAX_DECRYPTED_SMS_DISPATCH = 100');
		expect(textApi).toContain('clientDecryptorMounted: hasDecryptedRecipientBatch');
		expect(textApi).toContain('clientBatchRouteMounted: readiness.clientBatchRouteMounted');
		expect(textApi).toContain('sendSms(recipient.phone, existing.blast.body');
		expect(textApi).toContain('api.sms.getEncryptedRecipientsForBlast');
		expect(textApi).toContain("error: 'text_dispatch_recipient_scope_mismatch'");
		expect(textApi).toContain('dispatchCohort.hasMore');
		expect(textApi).toContain('api.sms.recordDispatchBatch');
		expect(textApi).toContain("existing.blast.status !== 'draft' && existing.blast.status !== 'sending'");
		expect(textApi).toContain('batchSentCount: recorded.batchSentCount');
		expect(textApi).toContain('recordedCount: recorded.recordedCount');
		expect(textApi).toContain("blockedVerb: 'carrier_delivery'");
		expect(textApi).toContain("preservedArtifact: 'sms_draft'");
		expect(textApi).toContain("gate: 'CP-sms-dispatch'");
		expect(textApi).toContain("taskIds: ['T2-1']");
		expect(textApi).toContain('getTextDispatchReadiness');
		expect(textApi).toContain('missing: readiness.missing');
		expect(textApi).toContain('runtimeFlag: readiness.runtimeFlag');
		expect(textApi).toContain('runnerImplemented: readiness.runnerImplemented');
		expect(textApi).toContain('featureEnabled: FEATURES.SMS_DISPATCH');
		expect(textApi).toContain('{ status: 424 }');
		expect(textApi).not.toContain('{ status: 501 }');
		expect(clientTextSender).toContain('decryptOrgPii');
		expect(clientTextSender).toContain("status: 'decrypting' | 'sending' | 'complete' | 'error'");
		expect(clientTextSender).toContain('const E164_RE = /^\\+');
		expect(clientTextSender).toContain("action: 'send'");
		expect(clientTextSender).toContain('expectedTotalRecipients,');
		expect(clientTextSender).toContain('finalBatch,');
		expect(clientTextSender).toContain('decryptedRecipients');
		expect(clientTextSender).toContain('could not be prepared for carrier dispatch');
		expect(textDetailServer).toContain('api.organizations.getOrgKeyVerifier');
		expect(textDetailServer).toContain('orgKeyVerifier: keyInfo?.orgKeyVerifier ?? null');
		expect(textDetail).toContain("import { Datum, Ratio } from '$lib/design';");
		expect(textDetail).toContain("row.id === 'scope-revalidation'");
		expect(textDetail).toContain("row.id === 'browser-phone-custody'");
		expect(textDetail).toContain("row.id === 'carrier-acceptance'");
		expect(textDetail).toContain("row.id === 'receipt-anchoring'");
		expect(textDetail).toContain('routeDispatchBlockers');
		expect(textDetail).toContain("item !== 'browser phone custody'");
		expect(textDetail).not.toContain("item !== 'client-side phone decryptor'");
		expect(textDetail).toContain('canAttemptClientDispatch');
		expect(textDetail).toContain('api.sms.getEncryptedRecipientsForBlast');
		expect(textDetail).toContain('sendTextBatchFromClient');
		expect(textDetail).toContain('Dispatch eligible cohort');
		expect(textDetail).toContain('100} cite="SMS client dispatch batch limit"');
		expect(textDetail).toContain('const textCarrierCounterEvidenceObserved = $derived');
		expect(textDetail).toContain('const textDispatchStatusEvidenceObserved = $derived');
		expect(textDetail).toContain('const textAudienceEvidenceLabel = $derived');
		expect(textDetail).toContain('aria-label={textAudienceEvidenceLabel}');
		expect(textDetail).toContain('Text carrier execution evidence');
		expect(textDetail).toContain('Saved text custody evidence');
		expect(textDetail).toContain('getTextDispatchReadiness.clientBatchRouteMounted');
		expect(textDetail).toContain('getTextDispatchReadiness.missing');
		expect(textDetail).toContain('hidden until receipt rows exist');
		expect(textDetail).toContain('zero-delivery send');
		expect(textDetail).not.toContain(
			'<p class="text-text-primary mt-1 text-lg font-bold">{data.blast.sentCount}</p>'
		);
		expect(smsBlastCard).toContain("import { Datum } from '$lib/design';");
		expect(smsBlastCard).toContain('const carrierCounterEvidenceObserved = $derived');
		expect(smsBlastCard).toContain('const carrierStatusEvidenceObserved = $derived');
		expect(smsBlastCard).toContain('aria-label="Text carrier execution evidence"');
		expect(smsBlastCard).toContain('aria-label="Saved text custody evidence"');
		expect(smsBlastCard).toContain('carrier counters hidden until receipt rows exist');
		expect(smsBlastCard).not.toContain('{blast.sentCount} accepted');
		expect(textDetail).toContain('expectedTotalRecipients: cohort.eligibleCount');
		expect(textDetail).toContain('finalBatch,');
		expect(textDetail).toContain('while (cohort.recipients.length > 0)');
		expect(textDetail).toContain('SMS client dispatch batch limit');
		expect(textApi).not.toContain('please contact support to enable delivery');
		expect(textApi).not.toContain('Bulk text dispatch is not yet wired');
		expect(textApi).not.toContain("runtimeFlag: runtimeFlag ? 'open_without_runner' : 'closed'");
		expect(textApi).not.toContain('return textDispatchBoundary(false);');
		expect(textApi).not.toContain('return textDispatchBoundary(true);');
		expect(smsConvex).toContain('export const recordDispatchBatch = mutation');
		expect(smsConvex).toContain('export const getEncryptedRecipientsForBlast = query');
		expect(smsConvex).toContain('SMS_CLIENT_DISPATCH_BATCH_LIMIT = 100');
		expect(smsConvex).toContain('applySmsRecipientFilter');
		expect(smsConvex).toContain('supporter.smsStatus === "subscribed" && !!supporter.encryptedPhone');
		expect(smsConvex).toContain('alreadyRecorded');
		expect(smsConvex).toContain('remaining.length > SMS_CLIENT_DISPATCH_BATCH_LIMIT');
		expect(smsConvex).toContain('hasMore: remaining.length > SMS_CLIENT_DISPATCH_BATCH_LIMIT');
		expect(smsConvex).toContain('supporter.smsStatus !== "subscribed"');
		expect(smsConvex).toContain('SMS_DISPATCH_SUPPORTER_ALREADY_RECORDED');
		expect(smsConvex).toContain('expectedTotalRecipients');
		expect(smsConvex).toContain('recordedCount');
		expect(smsConvex).toContain('await ctx.db.insert("smsMessages"');
		expect(smsConvex).toContain('twilioSid: result.twilioSid');
		expect(smsConvex).toContain('sentCount + deliveredCount > 0 ? "sent" : "failed"');

		for (const sourceText of [
			actionIndex,
			newAction,
			actionDetail,
			emailIndex,
			emailDetail,
			emailCompose,
			textIndex,
			textDraft,
			textDetail
		]) {
			expect(sourceText).not.toContain('NEW-T3-1 through NEW-T3-5');
			expect(sourceText).not.toContain('T5-3/T5-5/T5-2');
			expect(sourceText).not.toContain('T6-1/T6-2 add durable receipt anchoring');
			expect(sourceText).not.toContain('T6-1/T6-2 anchor receipt batches');
			expect(sourceText).not.toContain('State/local reach waits on');
			expect(sourceText).not.toContain('State, local, and international reach remain gated');
			expect(sourceText).not.toContain('T5-3 strengthens quality settlement');
			expect(sourceText).not.toContain('T10-10 is live for integrity snapshots');
			expect(sourceText).not.toContain('T2-2 ses-proxy deployment');
			expect(sourceText).not.toContain('T2-2 and sealed scheduling');
			expect(sourceText).not.toContain('T2-2 dispatch runner before carrier delivery');
			expect(sourceText).not.toContain('T5-3 quality settlement for stronger claim basis');
			expect(sourceText).not.toContain('T2-2 client-side phone decryptor');
			expect(sourceText).not.toContain('T2-2 filter-aware SMS runner');
			expect(sourceText).not.toContain('T2-2 SMS dispatch boundary');
			expect(sourceText).not.toContain('T6-1/T6-2 receipt anchoring after SMS dispatch is wired');
			expect(sourceText).not.toContain('rejects send requests with 501');
			expect(sourceText).not.toContain('PATCH action send rejects with 501');
		}
		expect(canonicalDoc).toContain(
			'Action-record index/creation/detail, email delivery index/composer, and SMS index/detail/composer strips also render stronger-claim unlocks through `formatGateEvidence`'
		);
		expect(canonicalDoc).toContain(
			'The composer can count saved tag/segment audience filters through `sms.countEligibleRecipientsForFilter` and save that scope into the draft'
		);
		expect(canonicalDoc).toContain(
			'the SMS dispatch API can send only explicit client-decrypted E.164 recipient batches'
		);
		expect(canonicalDoc).toContain(
			'inbound free-text SMS replies are stored as bounded reader response evidence in `smsReplies`'
		);
		expect(canonicalDoc).toContain(
			'The text detail route now mounts that browser cohort sender for bounded draft dispatch'
		);
		expect(canonicalDoc).toContain(
			'continues until the saved eligible cohort is recorded'
		);
		expect(canonicalDoc).toContain(
			'saved scope cannot read as a zero-row text dispatch'
		);
		expect(canonicalDoc).toContain(
			'bulk text dispatch is partial only when the bounded detail-route sender can supply decrypted cohort batches'
		);
		expect(canonicalDoc).not.toContain('bulk text dispatch remains `context / read boundary`');
		expect(capabilityScope).toContain(
			'The SMS detail route mounts the browser cohort sender for draft/sending records'
		);
		expect(capabilityScope).toContain(
			'continues through the saved eligible cohort in 100-recipient browser requests'
		);
		expect(capabilityScope).toContain(
			'Composer-side cohort selection is mounted as a counted saved filter'
		);
		expect(capabilityScope).toContain(
			'The SMS list card and detail evidence grid hide accepted/confirmed/failed carrier counters'
		);
		expect(capabilityScope).toContain('saved scope cannot masquerade as a zero-row dispatch');
		expect(capabilityScope).toContain('non-control free-text replies are stored in `smsReplies`');
		expect(capabilityScope).toContain('No admin reply queue, autoresponder, assignment workflow');
		expect(capabilityScope).not.toContain('multi-batch continuation are still held');
	});

	it('keeps server-side email dispatch behind runtime dependency checks', () => {
		const convexEmail = source('convex/email.ts');
		const composeServer = source('src/routes/org/[slug]/emails/compose/+page.server.ts');
		const composePage = source('src/routes/org/[slug]/emails/compose/+page.svelte');
		const emailIndex = source('src/routes/org/[slug]/emails/+page.svelte');
		const emailDetailServer = source('src/routes/org/[slug]/emails/[blastId]/+page.server.ts');
		const emailDetailPage = source('src/routes/org/[slug]/emails/[blastId]/+page.svelte');
		const layoutServer = source('src/routes/org/[slug]/+layout.server.ts');
		const layout = source('src/routes/org/[slug]/+layout.svelte');
		const spacesContract = source('src/lib/components/org/os/spaces.ts');
		const capabilityMap = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const features = source('src/lib/config/features.ts');
		const runtimeReadiness = source('src/lib/server/email/server-dispatch-readiness.ts');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(features).toContain('EMAIL_SERVER_DISPATCH: true');
		expect(runtimeReadiness).toContain('getEmailServerDispatchReadiness');
		expect(runtimeReadiness).toContain('EMAIL_SERVER_DISPATCH_DEPENDENCY');
		expect(runtimeReadiness).toContain('AWS_ACCESS_KEY_ID');
		expect(runtimeReadiness).toContain('UNSUBSCRIBE_SECRET >= ${MIN_UNSUBSCRIBE_SECRET_BYTES} bytes');
		expect(runtimeReadiness).toContain('org key verifier');
		expect(runtimeReadiness).toContain('PUBLIC_BASE_URL http(s) URL');
		expect(runtimeReadiness).toContain('if (!env.PUBLIC_BASE_URL)');

		expect(convexEmail).toContain("const sendBlastRef = makeFunctionReference<'action'>");
		expect(convexEmail).toContain("'email:sendBlast'");
		expect(convexEmail).toContain('export const enqueueServerDispatch = mutation');
		expect(convexEmail).toContain('requireOrgRole(ctx, args.orgSlug');
		expect(convexEmail).toContain("'editor'");
		expect(convexEmail).toContain('Only draft blasts can be queued for server dispatch');
		expect(convexEmail).toContain("status: 'scheduled'");
		expect(convexEmail).toContain("sendMode: 'server'");
		expect(convexEmail).toContain('ctx.scheduler.runAfter(0, sendBlastRef');
		expect(convexEmail).toContain('EMAIL_QUOTA_EXCEEDED');
		expect(convexEmail).toContain('function countSupporterSources');
		expect(convexEmail).toContain('sourceCounts: countSupporterSources(filtered)');

		expect(composeServer).toContain('if (FEATURES.EMAIL_SERVER_DISPATCH)');
		expect(composeServer).toContain('getEmailServerDispatchReadiness');
		expect(composeServer).toContain("errorCode: 'email_server_dispatch_dependency_missing'");
		expect(composeServer).toContain("preservedArtifact: 'email_draft'");
		expect(composeServer).toContain("missing: serverDispatchReadiness.missing");
		expect(composeServer).toContain(
			'serverDispatchRuntimeDependency: serverDispatchReadiness.dependency'
		);
		expect(composeServer).toContain(
			'serverDispatchRuntimeMessage: serverDispatchReadiness.message'
		);
		expect(composeServer).toContain('draftHref: `/org/${params.slug}/emails/${sendResult.id}`');
		expect(composeServer).toContain('api.email.enqueueServerDispatch');
		expect(composeServer).toContain("['open', 'click'].includes(rawWinnerMetric)");
		expect(composeServer).not.toContain("['open', 'click', 'verified_action']");
		expect(composeServer).toContain('type RecipientCountResult = {');
		expect(composeServer).toContain('recipientSourceCounts: initialRecipientCount?.sourceCounts ?? {}');
		expect(composeServer).toContain('sourceCounts: recipientCount.sourceCounts');
		for (const sourceText of [composePage, emailIndex]) {
			expect(sourceText).toContain(
				"const serverDispatchMode = $derived(requiredSendMode(sendReadinessModes, 'server-email'))"
			);
			expect(sourceText).toContain('state: serverDispatchMode.state');
			expect(sourceText).toContain('action: serverDispatchMode.action');
		}
		expect(composePage).toContain('serverDispatchRuntimeArmed');
		expect(composePage).toContain('serverDispatchRuntimeMissing: data.serverDispatchRuntimeMissing');
		expect(composePage).toContain(
			'serverDispatchRuntimeDependency: data.serverDispatchRuntimeDependency'
		);
		expect(composePage).toContain('Open preserved draft');
		expect(composePage).not.toContain('<option value="verified_action">');
		expect(composePage).toContain('exact continuation');
		expect(composePage).toContain('cohort.');
		expect(composePage).not.toContain('requires manual follow-up');
		expect(composePage).toContain("from '$lib/data/platform-export-profiles'");
		expect(composePage).toContain("label: 'Audience source basis'");
		expect(composePage).toContain('email.countRecipientsForFilter sourceCounts');
		expect(composePage).toContain('aria-label="Selected cohort source basis"');
		expect(composePage).toContain('Filtered People source counts, no plaintext identity.');
		expect(composePage).not.toContain("case 'action_network':");
		expect(emailDetailServer).toContain(
			'Server dispatch is dependency-first for this delivery; A/B test cohorts remain preserved drafts until runtime evidence clears.'
		);
		expect(emailDetailServer).toContain(
			'Server dispatch is dependency-first for this delivery; the A/B remainder remains a preserved draft until runtime evidence clears.'
		);
		expect(emailDetailServer).toContain('winnerMetricSupported:');
		expect(emailDetailServer).toContain('winnerBlastId:');
		expect(emailDetailServer).not.toContain('Server dispatch is not armed in this build');
		expect(emailDetailPage).toContain('Verified-action A/B winner selection is not armed');
		expect(emailDetailPage).toContain('recordedWinnerBlastId');
		expect(emailDetailPage).toContain('canMaterializeAbRemainder');
		expect(hypergraph).toContain(
			'production side effects remain preserved drafts until server-dispatch runtime evidence clears.'
		);
		expect(hypergraph).toContain("const serverEmailRuntimeArmed =");
		expect(hypergraph).toContain('serverDispatchRuntimeReady');
		expect(hypergraph).toContain('serverDispatchRuntimeMissing?: string[]');
		expect(hypergraph).toContain('serverDispatchRuntimeDependency?: string');
		expect(hypergraph).toContain('function serverDispatchRuntimeBoundary(');
		expect(hypergraph).toContain('Server email runtime is missing ${missing}');
		expect(hypergraph).toContain("state: serverEmailRuntimeArmed ? 'live' : 'draft-only'");
		expect(hypergraph).toContain(
			'Server-side dispatch stays dependency-first until runtime evidence clears; composer sends remain preserved drafts.'
		);
		expect(hypergraph).toContain(
			'automated A/B side effects remain preserved drafts until server-dispatch runtime evidence clears.'
		);
		expect(hypergraph).not.toContain('Server-side dispatch is not armed in this build');
		expect(hypergraph).not.toContain('server dispatch runtime is ready');
		expect(hypergraph).not.toContain('A/B setup is disabled for this build');
		expect(layoutServer).toContain(
			'serverDispatchRuntimeMissing: emailServerDispatchReadiness.missing'
		);
		expect(layoutServer).toContain(
			'serverDispatchRuntimeDependency: emailServerDispatchReadiness.dependency'
		);
		expect(spacesContract).toContain('serverDispatchRuntimeMissing: string[];');
		expect(spacesContract).toContain('serverDispatchRuntimeDependency: string;');
		expect(layout).toContain(
			'serverDispatchRuntimeMissing: emailDelivery?.serverDispatchRuntimeMissing ?? []'
		);
		expect(capabilityMap).toContain(
			'serverDispatchRuntimeMissing: emailDelivery?.serverDispatchRuntimeMissing ?? []'
		);
		expect(capabilityMap).not.toContain('emailDelivery?.serverDispatchRuntimeMissing?.join');
		expect(capabilityMap).toContain("const serverEmailMode = $derived(");
		expect(emailIndex).toContain('buildSendReadiness({');

		expect(canonicalDoc).toContain('The role-checked enqueue boundary now exists');
		expect(canonicalDoc).toContain(
			'The composer also reads filtered source counts from `email.countRecipientsForFilter`'
		);
		expect(canonicalDoc).toContain(
			'Email detail A/B actions preserve exact test/remainder drafts until server-dispatch runtime evidence clears'
		);
		expect(canonicalDoc).toContain(
			'Winner metrics are open/click only until verified-action attribution is joined'
		);
		expect(canonicalDoc).toContain('typed `email_server_dispatch_dependency_missing`');
		expect(canonicalDoc).toContain('runtime-gated');
		expect(capabilityScope).toContain('email.enqueueServerDispatch');
		expect(capabilityScope).toContain('FEATURES.EMAIL_SERVER_DISPATCH=true');
		expect(capabilityScope).toContain('getEmailServerDispatchReadiness');
		expect(capabilityScope).toContain('filtered source counts beside the recipient total');
		expect(capabilityScope).toContain('typed `email_server_dispatch_dependency_missing`');
		expect(capabilityScope).toContain(
			'production side effects remain preserved drafts until server-dispatch runtime evidence clears'
		);
		expect(capabilityScope).toContain(
			'Winner metrics are open/click only until verified-action attribution is joined'
		);
		expect(capabilityScope).toContain('A/B continuation pressure');
	});

	it('keeps proof report receipts and response arcs gate-backed', () => {
		const report = source('src/routes/org/[slug]/campaigns/[id]/report/+page.svelte');
		const reportServer = source('src/routes/org/[slug]/campaigns/[id]/report/+page.server.ts');
		const campaignDetail = source('src/routes/org/[slug]/campaigns/[id]/+page.svelte');
		const campaigns = source('convex/campaigns.ts');
		const schema = source('convex/schema.ts');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(report).toContain('buildResultsProofReadiness,');
		expect(report).toContain('formatGateEvidence,');
		expect(report).toContain('getGateEvidence,');
		expect(report).toContain('type ResultsProofRow');
		expect(report).toContain("import { formatCapabilityClusters } from '$lib/data/capability-clusters';");
		expect(report).toContain("import { FEATURES } from '$lib/config/features';");
		expect(report).toContain('operatorCapabilityActionLabel,');
		expect(report).toContain("const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring'");
		expect(report).toContain("const readerOfficeGate = getGateEvidence('CP-dm-office-profile'");
		expect(report).toContain("const coordinationIntegrityGate = getGateEvidence('CP-coordination-integrity'");
		expect(report).toContain('formatGateEvidence(receiptAnchoringGate');
		expect(report).toContain('formatGateEvidence(readerOfficeGate');
		expect(report).toContain('const resultsProofReadiness = $derived(');
		expect(report).toContain('buildResultsProofReadiness({');
		expect(report).toContain('receiptCount: receiptBackedCount');
		expect(report).toContain('responseLoggedReceiptCount: responseCount');
		expect(report).toContain('anchorFieldCount: 0');
		expect(report).toContain('receiptSampleLimit: deliveryRowCount');
		expect(report).toContain('const resultsProofRows = $derived<ResultsProofRow[]>');
		expect(report).toContain('type ResultsProofPressureReadout = {');
		expect(report).toContain('const packetArtifactResultsRow = $derived');
		expect(report).toContain('const receiptEvidenceResultsRow = $derived');
		expect(report).toContain('const heldResultsProofRows = $derived');
		expect(report).toContain('const firstHeldResultsProofRow = $derived');
		expect(report).toContain(
			'const resultsProofPressureReadouts = $derived<ResultsProofPressureReadout[]>(['
		);
		expect(report).toContain("id: 'packet-ground'");
		expect(report).toContain("id: 'receipt-evidence'");
		expect(report).toContain("id: 'next-proof-lift'");
		expect(report).toContain("label: 'Packet ground'");
		expect(report).toContain("label: 'Receipt evidence'");
		expect(report).toContain("label: 'Next proof lift'");
		expect(report).toContain('resultsProofReadiness.signal');
		expect(report).toContain('receiptEvidenceResultsRow?.boundary');
		expect(report).toContain('firstHeldResultsProofRow?.boundary');
		expect(report).toContain('const resultsProofSegments = $derived(');
		expect(report).toContain('operatorCapabilityStateRatioSegments(resultsProofStateCounts)');
		expect(report).toContain('aria-label="Results proof posture from OS readiness"');
		expect(report).toContain('Results proof posture');
		expect(report).toContain('What this report can prove back');
		expect(report).toContain(
			'<Datum value={resultsProofRows.length} cite="buildResultsProofReadiness" />'
		);
		expect(report).toContain('aria-label="Report Results proof pressure"');
		expect(report).toContain('{#each resultsProofPressureReadouts as readout (readout.id)}');
		expect(report).toContain('<span class="proof-pressure-kicker">{readout.label}</span>');
		expect(report).toContain('<span class="proof-pressure-title">{readout.title}</span>');
		expect(report).toContain('<Datum value={readout.metric.value} cite={readout.metric.cite} />');
		expect(report).toContain('<span class="proof-pressure-detail">{readout.detail}</span>');
		expect(report).toContain('<span class="proof-pressure-action">{proofActionLabel(readout)}</span>');
		expect(report).toContain('<span class="proof-pressure-gate">{readout.gate}</span>');
		expect(report).toContain('{row.phase} / {formatCapabilityClusters(row.clusters)}');
		expect(report).toContain('<span class="proof-contract-handoff">{row.handoff}</span>');
		expect(report).toContain('{row.ground}');
		expect(report).toContain('{row.boundary}');
		expect(reportServer).toContain('packet: fullPacket');
		expect(reportServer).toContain('packetDigest = rendered.attestationHash');
		expect(reportServer).toContain('proofWeight = computeProofWeight(fullPacket)');
		expect(reportServer).toContain('packetSummary = {');
		expect(reportServer).toContain('receiptBacked: delivery.receiptBacked === true');
		expect(reportServer).toContain("receiptEligibility: asString(delivery.receiptEligibility");
		expect(reportServer).toContain('receiptBlockers: Array.isArray(delivery.receiptBlockers)');
		expect(reportServer).toContain('receiptId: typeof delivery.receiptId');
		expect(reportServer).toContain('attestationDigest:');
		expect(schema).toContain("decisionMakerId: v.optional(v.id('decisionMakers'))");
		expect(schema).toContain("billId: v.optional(v.id('bills'))");
		expect(schema).toContain('packetDigest: v.optional(v.string())');
		expect(schema).toContain('proofWeight: v.optional(v.number())');
		expect(schema).toContain('receiptEligibility: v.optional(');
		expect(schema).toContain("v.literal('missing_bill_and_target')");
		expect(schema).toContain(".index('by_email', ['email'])");
		expect(campaigns).toContain('function receiptReadinessFor');
		expect(campaigns).toContain('async function resolveDecisionMakerForTarget');
		expect(campaigns).toContain('async function maybeCreateAccountabilityReceiptForDelivery');
		expect(campaigns).toContain("ctx.db.insert('accountabilityReceipts'");
		expect(campaigns).toContain("status: 'pending_response'");
		expect(campaigns).toContain("causalityClass: 'pending'");
		expect(campaigns).toContain('alignment: 0');
		expect(campaigns).toContain("if (args.status === 'sent')");
		expect(campaigns).toContain('receiptEligibility: readiness.receiptEligibility');
		expect(campaigns).toContain('receiptBacked: !!receipt');
		expect(report).toContain("action: selectedCount > 0 ? 'queue proof' : 'select targets'");
		expect(report).toContain(
			"action: deliveryRowCount > 0 ? 'log response' : 'await delivery row'"
		);
		expect(report).toContain("label: 'Sender delivery register'");
		expect(report).toContain("label: 'Manual response log'");
		expect(report).toContain('receiptBackedCount');
		expect(report).toContain('receiptEligibleCount');
		expect(report).toContain('receiptBlockedCount');
		expect(report).toContain('sender-side delivery row');
		expect(report).toContain('Accepted, receipt-eligible delivery rows can become accountability receipts');
		expect(report).toContain(
			'the receipt writer runs after SES accepts delivery, while mainnet anchoring remains gated'
		);
		expect(report).toContain('open receipt');
		expect(report).toContain('Manual annotations are not a reader-office workflow');
		expect(report).toContain("if (delivery.receiptEligibility === 'eligible') return 'receipt-eligible'");
		expect(report).toContain('{receiptBadgeLabel(delivery)}');
		expect(campaignDetail).toContain('function targetResolved');
		expect(campaignDetail).toContain("targetResolved(target) ? 'Power target' : 'Manual entry'");
		expect(canonicalDoc).toContain('The local delivery row is now a **sender delivery register**');
		expect(canonicalDoc).toContain('Receipt eligibility only means the sender row is bound');
		expect(canonicalDoc).toContain('**accountabilityReceipts WRITER** — bounded');
		expect(canonicalDoc).toContain(
			'The shorthand “delivery receipts” in older route-contract prose means this sender delivery register'
		);
		expect(capabilityScope).toContain('explicit `receiptEligibility`/`receiptBlockers` readiness');
		expect(capabilityScope).toContain('When SES accepts an eligible row');
		expect(capabilityScope).toContain('`legislation.getOrgReceiptSummary`');
		expect(capabilityScope).toContain('including `anchorFieldCount` rather than an anchored-receipt claim');
		expect(capabilityScope).toContain('This is a bounded source-row writer');
		expect(report).toContain('operatorCapabilityStateRatioSegments');
		expect(report).toContain(
			'const proofSegments = $derived(operatorCapabilityStateRatioSegments(proofStateCounts));'
		);
		expect(report).toContain('return operatorCapabilityStateLabel(state);');
		expect(report).toContain('Proof delivery</span>');
		expect(report).toContain('Queue only what can be defended');
		expect(report).toContain(
			'return operatorCapabilityActionLabel(row.state, row.action, { appendReadyArrow: true });'
		);
		expect(report).not.toContain('return `context / ${row.action}`;');
		expect(report).not.toContain('return `${row.action} ->`;');
		expect(report).not.toContain('Deliver Proof');
		expect(report).not.toContain("action: selectedCount > 0 ? 'deliver proof' : 'select targets'");
		expect(report).not.toContain(
			"action: data.pastDeliveries.length > 0 ? 'log response' : 'send first'"
		);
		expect(report).not.toContain("label: 'live'");
		expect(report).not.toContain("label: 'partial'");
		expect(report).not.toContain("label: 'gated'");
		expect(report).not.toContain("return 'Live'");
		expect(report).not.toContain("return 'Partial'");
		expect(report).not.toContain("return 'Gated'");
		expect(report).not.toContain('Receipt roots and mainnet anchoring remain T6-1/T6-2');
		expect(report).not.toContain(
			'Long-term receipt roots and mainnet survivability are not armed until T6-1/T6-2'
		);
		expect(report).not.toContain('Reader-office surface and notification APIs remain T8-1b/T8-8');
	});

	it('keeps fundraising, platform intake, and workflow route strips backed by hypergraph gate summaries', () => {
		const fundraisingIndex = source('src/routes/org/[slug]/fundraising/+page.svelte');
		const fundraisingNew = source('src/routes/org/[slug]/fundraising/new/+page.svelte');
		const fundraisingDetail = source('src/routes/org/[slug]/fundraising/[id]/+page.svelte');
		const peopleImport = source('src/routes/org/[slug]/supporters/import/+page.svelte');
		const peopleImportServer = source('src/routes/org/[slug]/supporters/import/+page.server.ts');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const platformProfiles = source('src/lib/data/platform-export-profiles.ts');
		const platformApiSyncReadiness = source('src/lib/server/platform-api-sync-readiness.ts');
		const platformApiBoundary = source(
			'src/routes/org/[slug]/supporters/import/platform-api/+page.svelte'
		);
		const platformApiBoundaryServer = source(
			'src/routes/org/[slug]/supporters/import/platform-api/+page.server.ts'
		);
		const organizations = source('convex/organizations.ts');
		const schema = source('convex/schema.ts');
		const layoutServer = source('src/routes/org/[slug]/+layout.server.ts');
		const spaces = source('src/lib/components/org/os/spaces.ts');
		const legacyActionNetworkPage = source(
			'src/routes/org/[slug]/supporters/import/action-network/+page.svelte'
		);
		const legacyActionNetworkServer = source(
			'src/routes/org/[slug]/supporters/import/action-network/+page.server.ts'
		);
		const supportersConvex = source('convex/supporters.ts');
		const supportersListServer = source('src/routes/org/[slug]/supporters/+page.server.ts');
		const supportersPage = source('src/routes/org/[slug]/supporters/+page.svelte');
		const supporterDetail = source('src/routes/org/[slug]/supporters/[id]/+page.svelte');
		const segmentTypes = source('src/lib/types/segment.ts');
		const publicOrgPage = source('src/routes/org/+page.svelte');
		const stateLegislaturePage = source('src/routes/org/for/state-legislature/+page.svelte');
		const localGovernmentPage = source('src/routes/org/for/local-government/+page.svelte');
		const agencyRulemakingPage = source('src/routes/org/for/agency-rulemaking/+page.svelte');
		const migratePage = source('src/routes/migrate/+page.svelte');
		const supportersApi = source('src/routes/api/v1/supporters/+server.ts');
		const workflows = source('src/routes/org/[slug]/workflows/+page.svelte');
		const workflowsServer = source('src/routes/org/[slug]/workflows/+page.server.ts');
		const workflowCard = source('src/lib/components/automation/WorkflowCard.svelte');
		const workflowNew = source('src/routes/org/[slug]/workflows/new/+page.svelte');
		const workflowNewServer = source('src/routes/org/[slug]/workflows/new/+page.server.ts');
		const workflowDetail = source('src/routes/org/[slug]/workflows/[id]/+page.svelte');
		const workflowDetailServer = source('src/routes/org/[slug]/workflows/[id]/+page.server.ts');
		const executionTable = source('src/lib/components/automation/ExecutionTable.svelte');
		const workflowEmailDependencyPanel = source(
			'src/lib/components/automation/WorkflowEmailDependencyPanel.svelte'
		);
		const workflowApi = source('src/routes/api/org/[slug]/workflows/[id]/+server.ts');
		const automationProcess = source('src/routes/api/automation/process/+server.ts');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(fundraisingNew).toContain('buildFundraisingReadiness,');
		expect(fundraisingNew).toContain('type FundraisingReadinessRow');
		expect(fundraisingNew).toContain('getGateEvidence');
		expect(fundraisingNew).toContain(
			"const fundraiserRecordGate = getGateEvidence('CP-coordination-integrity'"
		);
		expect(fundraisingNew).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
		expect(fundraisingNew).toContain(
			"const donationReceiptGate = getGateEvidence('CP-donation-receipt-compliance'"
		);
		expect(fundraisingNew).toContain('const draftFundraiserCount = $derived(');
		expect(fundraisingNew).toContain('const fundraisingReadiness = $derived(');
		expect(fundraisingNew).toContain('buildFundraisingReadiness({');
		expect(fundraisingNew).toContain("context: 'creation'");
		expect(fundraisingNew).toContain('fundraiserCount: 0');
		expect(fundraisingNew).toContain('activeCount: publishNow ? 1 : 0');
		expect(fundraisingNew).toContain('donationCount: 0');
		expect(fundraisingNew).toContain('draftFundraiserCount,');
		expect(fundraisingNew).toContain('publishRequested: publishNow');
		expect(fundraisingNew).toContain('donationConfirmationGate: emailProxyGate');
		expect(fundraisingNew).toContain('const fundraisingRows = $derived<FundraisingReadinessRow[]>');
		expect(fundraisingNew).toContain('fundraisingReadiness.rows');
		expect(fundraisingNew).toContain('fundraisingRows.map((row) => ({');
		expect(fundraisingNew).toContain('label: row.label');
		expect(fundraisingNew).toContain('state: row.state');
		expect(fundraisingNew).toContain('phase: row.phase');
		expect(fundraisingNew).toContain('cluster: row.clusters');
		expect(fundraisingNew).toContain('detail: row.ground');
		expect(fundraisingNew).toContain('unlock: row.boundary');
		expect(fundraisingNew).toContain("'fundraiser-record': '#fundraiser-definition'");
		expect(fundraisingNew).toContain("'public-donation-page': '#fundraiser-publication'");
		expect(fundraisingNew).toContain("'stripe-checkout': '#fundraiser-checkout-boundary'");
		expect(fundraisingNew).toContain("'donor-confirmation': '#fundraiser-receipt-boundary'");
		expect(fundraisingNew).toContain(
			"'provider-send-evidence': '#fundraiser-receipt-boundary'"
		);
		expect(fundraisingNew).toContain(
			"'receipt-policy-register': '#fundraiser-receipt-boundary'"
		);
		expect(fundraisingNew).toContain(
			"'tax-anchored-receipts': '#fundraiser-receipt-boundary'"
		);
		expect(fundraisingNew).not.toContain('formatGateEvidence(fundraiserRecordGate');
		expect(fundraisingNew).not.toContain('formatGateEvidence(donationReceiptGate');
		expect(fundraisingNew).not.toContain("cluster: 'coordination integrity'");
		expect(fundraisingNew).not.toContain("cluster: 'reader-side UX'");
		expect(fundraisingNew).not.toContain("cluster: 'accountability");
		expect(fundraisingNew).not.toContain("action: 'read boundary'");
		expect(fundraisingNew).toContain('type FundraisingReceiptProofRow');
		expect(fundraisingNew).toContain('type FundingReceiptProofPressureReadout = {');
		expect(fundraisingNew).toContain("import { Datum } from '$lib/design';");
		expect(fundraisingNew).toContain('operatorCapabilityActionLabel,');
		expect(fundraisingNew).toContain('operatorCapabilityStateLabel');
		expect(fundraisingNew).toContain(
			'const fundraisingReceiptProofRows = $derived<FundraisingReceiptProofRow[]>'
		);
		expect(fundraisingNew).toContain("row.id === 'fundraiser-record-ground'");
		expect(fundraisingNew).toContain(
			"row.id === 'payment-provider-handoff' || row.id === 'webhook-completion'"
		);
		expect(fundraisingNew).toContain('const fundingGroundProofRow = $derived');
		expect(fundraisingNew).toContain('const confirmationRegisterProofRow = $derived');
		expect(fundraisingNew).toContain('const taxAnchoringProofRow = $derived');
		expect(fundraisingNew).toContain('const heldFundingReceiptProofRows = $derived');
		expect(fundraisingNew).toContain('const nextReceiptLiftProofRow = $derived');
		expect(fundraisingNew).toContain(
			'const fundingReceiptProofPressureReadouts = $derived<FundingReceiptProofPressureReadout[]>(['
		);
		expect(fundraisingNew).toContain("id: 'funding-ground'");
		expect(fundraisingNew).toContain("id: 'confirmation-register'");
		expect(fundraisingNew).toContain("id: 'next-receipt-lift'");
		expect(fundraisingNew).toContain("label: 'Funding ground'");
		expect(fundraisingNew).toContain("label: 'Confirmation register'");
		expect(fundraisingNew).toContain("label: 'Next receipt lift'");
		expect(fundraisingNew).toContain('fundingGroundProofRow?.effect');
		expect(fundraisingNew).toContain('confirmationRegisterProofRow?.effect');
		expect(fundraisingNew).toContain('nextReceiptLiftProofRow?.gate');
		expect(fundraisingNew).toContain(
			'return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });'
		);
		expect(fundraisingNew).toContain('function pressureCellClass(state: CapabilityState): string');
		expect(fundraisingNew).toContain('aria-label="Funding receipt proof pressure"');
		expect(fundraisingNew).toContain(
			'{#each fundingReceiptProofPressureReadouts as readout (readout.id)}'
		);
		expect(fundraisingNew).toContain('class={pressureCellClass(readout.state)}');
		expect(fundraisingNew).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(fundraisingNew).toContain('{actionLabel(readout.state, readout.action)}');
		expect(fundraisingNew).not.toContain('id="fundraising-receipt-proof-contract"');
		expect(fundraisingNew).not.toContain('aria-label="Funding receipt proof contract"');

		for (const sourceText of [fundraisingIndex, fundraisingDetail]) {
			expect(sourceText).toContain('buildFundraisingReadiness,');
			expect(sourceText).toContain('type FundraisingReadinessRow');
			expect(sourceText).toContain('type FundraisingReceiptProofRow');
			expect(sourceText).toContain('getGateEvidence');
			expect(sourceText).toContain(
				"const fundraiserRecordGate = getGateEvidence('CP-coordination-integrity'"
			);
			expect(sourceText).toContain(
				"const donationReceiptGate = getGateEvidence('CP-donation-receipt-compliance'"
			);
			expect(sourceText).toContain('const fundraisingReadiness = $derived(');
			expect(sourceText).toContain('buildFundraisingReadiness({');
			expect(sourceText).toContain('const fundraisingRows = $derived<FundraisingReadinessRow[]>');
			expect(sourceText).toContain('fundraisingRows.map((row) => ({');
			expect(sourceText).toContain('label: row.label');
			expect(sourceText).toContain('state: row.state');
			expect(sourceText).toContain('phase: row.phase');
			expect(sourceText).toContain('cluster: row.clusters');
			expect(sourceText).toContain('detail: row.ground');
			expect(sourceText).toContain('unlock: row.boundary');
			expect(sourceText).not.toContain('formatGateEvidence(fundraiserRecordGate');
			expect(sourceText).not.toContain('formatGateEvidence(donationReceiptGate');
			expect(sourceText).not.toContain(
				'const confirmationOutcomeState = $derived<CapabilityState>'
			);
			expect(sourceText).not.toContain(
				'No completed donation has emitted a confirmation outcome yet; the register stays draft-only.'
			);
			expect(sourceText).toContain('const confirmationAttemptedCount = $derived(');
			expect(sourceText).toContain('const confirmationOutcomeEvidenceObserved = $derived(');
			expect(sourceText).toContain('const receiptBoundaryEvidenceLabel = $derived(');
			expect(sourceText).toContain('Donor confirmation outcome evidence');
			expect(sourceText).toContain('Donation receipt boundary evidence');
			expect(sourceText).toContain('aria-label={receiptBoundaryEvidenceLabel}');
			expect(sourceText).toContain('{#if confirmationOutcomeEvidenceObserved}');
			expect(sourceText).toContain(
				'Confirmation outcome counters stay hidden until completed donation rows or provider'
			);
			expect(sourceText).toContain('completed rows');
			expect(sourceText).toContain('policy custody');
			expect(sourceText).toContain('held proof rows');
			expect(sourceText).not.toContain('<Datum value={confirmationSentCount} />');
			expect(sourceText).not.toContain('<Datum value={confirmationProviderAcceptedCount} />');
			expect(sourceText).not.toContain("cluster: 'coordination integrity'");
			expect(sourceText).not.toContain("cluster: 'reader-side UX'");
			expect(sourceText).not.toContain("cluster: 'accountability / data sovereignty'");
			expect(sourceText).not.toContain("action: 'read boundary'");
		}
		expect(hypergraph).toContain("label: 'Fundraiser record'");
		expect(hypergraph).toContain("label: 'Public donation page'");
		expect(hypergraph).toContain("label: 'Stripe checkout'");
		expect(hypergraph).toContain("label: 'Donor confirmation register'");
		expect(hypergraph).toContain("label: 'Provider send evidence'");
		expect(hypergraph).toContain("label: 'Receipt policy register'");
		expect(hypergraph).toContain("label: 'Tax and anchored receipts'");
		expect(hypergraph).toContain('draftFundraiserCount?: number | null');
		expect(hypergraph).toContain('publishRequested?: boolean | null');
		expect(hypergraph).toContain(
			'Fundraiser creation separates record definition, publication intent, checkout dependency, donor confirmation, provider evidence, receipt policy, and tax/anchored receipt boundaries.'
		);
		expect(hypergraph).toContain('Baseline donor confirmation is transactional confirmation evidence only');
		expect(hypergraph).toContain(
			'Tax acknowledgment and anchored donation receipts remain dependency-first'
		);
		expect(hypergraph).toContain("'read checkout boundary'");
		expect(fundraisingIndex).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
		expect(fundraisingIndex).toContain(
			'const confirmationCompletedCount = $derived(data.confirmationSummary.completed)'
		);
		expect(fundraisingIndex).not.toContain("state: 'partial',\n\t\t\tphase: 'AGGREGATE'");
		for (const sourceText of [fundraisingIndex, fundraisingDetail]) {
			expect(sourceText).toContain('buildFundraisingReadiness,');
			expect(sourceText).toContain('type FundraisingReceiptProofRow');
			expect(sourceText).toContain('type FundingReceiptProofPressureReadout = {');
			expect(sourceText).toContain('operatorCapabilityActionLabel,');
			expect(sourceText).toContain('operatorCapabilityStateRatioSegments');
			expect(sourceText).toContain('const fundraisingReadiness = $derived(');
			expect(sourceText).toContain('buildFundraisingReadiness({');
			expect(sourceText).toContain(
				'const fundraisingReceiptProofRows = $derived<FundraisingReceiptProofRow[]>'
			);
			expect(sourceText).toContain('const fundingGroundProofRow = $derived');
			expect(sourceText).toContain('const confirmationRegisterProofRow = $derived');
			expect(sourceText).toContain('const taxAnchoringProofRow = $derived');
			expect(sourceText).toContain('const heldFundingReceiptProofRows = $derived');
			expect(sourceText).toContain('const nextReceiptLiftProofRow = $derived');
			expect(sourceText).toContain(
				'const fundingReceiptProofPressureReadouts = $derived<FundingReceiptProofPressureReadout[]>(['
			);
			expect(sourceText).toContain("id: 'funding-ground'");
			expect(sourceText).toContain("id: 'confirmation-register'");
			expect(sourceText).toContain("id: 'next-receipt-lift'");
			expect(sourceText).toContain("label: 'Funding ground'");
			expect(sourceText).toContain("label: 'Confirmation register'");
			expect(sourceText).toContain("label: 'Next receipt lift'");
			expect(sourceText).toContain('fundingGroundProofRow?.effect');
			expect(sourceText).toContain('confirmationRegisterProofRow?.effect');
			expect(sourceText).toContain('nextReceiptLiftProofRow?.gate');
			expect(sourceText).toContain('const fundraisingReceiptProofStateCounts = $derived');
			expect(sourceText).toContain('const fundraisingReceiptProofSegments = $derived');
			expect(sourceText).toContain('const heldFundraisingReceiptProofCount = $derived');
			expect(sourceText).toContain(
				'return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });'
			);
			expect(sourceText).toContain('function pressureCellClass(state: CapabilityState): string');
			expect(sourceText).toContain('id="fundraising-receipt-proof-contract"');
			expect(sourceText).toContain('Funding receipt proof');
			expect(sourceText).toContain(
				'What must be true before donation evidence becomes receipt posture'
			);
			expect(sourceText).toContain('aria-label="Funding receipt proof pressure"');
			expect(sourceText).toContain(
				'{#each fundingReceiptProofPressureReadouts as readout (readout.id)}'
			);
			expect(sourceText).toContain('class={pressureCellClass(readout.state)}');
			expect(sourceText).toContain(
				'<span class="text-text-primary mt-2 block text-sm font-semibold">{readout.title}</span>'
			);
			expect(sourceText).toContain(
				'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
			);
			expect(sourceText).toContain('{actionLabel(readout.state, readout.action)}');
			expect(sourceText).toContain('aria-label="Funding receipt proof contract"');
			expect(sourceText).toContain('buildFundraisingReadiness proofRows');
			expect(sourceText).toContain('{#each fundraisingReceiptProofRows as row (row.id)}');
			expect(sourceText).toContain('{row.effect}');
			expect(sourceText).toContain('{row.gate}');
		}
		expect(fundraisingDetail).toContain("row.id === 'webhook-completion'");
		expect(fundraisingDetail).toContain("row.id === 'tax-anchoring-boundary'");
		expect(canonicalDoc).toContain(
			'Saved index/detail routes hide sent/skipped/failed/untracked/provider-accepted confirmation counters'
		);
		expect(canonicalDoc).toContain(
			'Saved index/detail confirmation grids render outcome counters only after completed donation rows or provider acceptance evidence exist'
		);
		expect(capabilityScope).toContain(
			'When completed-donation or provider-accepted confirmation evidence is absent, saved fundraising index/detail routes hide the sent/skipped/failed/untracked/provider-accepted counters'
		);

		expect(platformApiBoundary).toContain('buildPlatformIntakeReadiness,');
		expect(platformApiBoundary).toContain('formatGateEvidence,');
		expect(platformApiBoundary).toContain('getGateEvidence,');
		expect(platformApiBoundary).toContain('type PlatformApiProofRow');
		expect(platformApiBoundary).toContain('type PlatformIntakeProfileRow');
		expect(platformApiBoundary).toContain('type PlatformIntakeStageRow');
		expect(platformApiBoundary).toContain('operatorCapabilityStateRatioSegments');
		expect(platformApiBoundary).toContain('type OperatorCapabilityStateCounts');
		expect(platformApiBoundary).toContain("from '$lib/data/capability-clusters'");
		expect(platformApiBoundary).toContain("import { Datum, Ratio } from '$lib/design'");
		expect(platformApiBoundary).toContain(
			"const platformApiGate = getGateEvidence('CP-platform-api-sync', ['T1-3']"
		);
		expect(platformApiBoundary).not.toContain("getGateEvidence('CP-an-osdi-sync'");
		expect(platformApiBoundary).toContain('const platformIntakeReadiness = $derived(');
		expect(platformApiBoundary).toContain('buildPlatformIntakeReadiness({');
		expect(platformApiBoundary).toContain('platformApiGate');
		expect(platformApiBoundary).toContain(
			'const platformProfileRows = $derived<PlatformIntakeProfileRow[]>(platformIntakeReadiness.rows)'
		);
		expect(platformApiBoundary).toContain(
			'const platformIntakeStageRows = $derived<PlatformIntakeStageRow[]>'
		);
		expect(platformApiBoundary).toContain(
			'const platformApiProofRows = $derived<PlatformApiProofRow[]>'
		);
		expect(platformApiBoundary).toContain('href={row.csvHref}');
		expect(platformApiBoundary).toContain('href={row.apiHref}');
		expect(platformApiBoundary).toContain(
			'const platformProfileCount = $derived(platformIntakeReadiness.profileCount)'
		);
		expect(platformApiBoundary).toContain(
			'const csvContractCount = $derived(platformIntakeReadiness.csvContractCount)'
		);
		expect(platformApiBoundary).toContain(
			'const apiBoundaryCount = $derived(platformIntakeReadiness.apiBoundaryCount)'
		);
		expect(platformApiBoundary).toContain('const platformProfileStateCounts = $derived');
		expect(platformApiBoundary).toContain('const platformProfileSegments = $derived');
		expect(platformApiBoundary).toContain('const platformApiProofStateCounts = $derived');
		expect(platformApiBoundary).toContain('const platformApiProofSegments = $derived');
		expect(platformApiBoundary).toContain('labelSuffix:');
		expect(platformApiBoundary).toContain('formatGateEvidence(platformApiGate');
		expect(platformApiBoundary).toContain('const platformApiGateSummary = $derived(');
		expect(platformApiBoundary).toContain('platformIntakeStageRows.map((row) => ({');
		expect(platformApiBoundary).toContain('label: row.handoff');
		expect(platformApiBoundary).toContain('phase: row.phase');
		expect(platformApiBoundary).toContain('cluster: row.clusters');
		expect(platformApiBoundary).toContain('detail: row.effect');
		expect(platformApiBoundary).toContain('unlock: row.gate');
		expect(hypergraph).toContain("handoff: 'Direct sync execution'");
		expect(platformApiBoundary).not.toContain("const csvVerificationGate = getGateEvidence");
		expect(platformApiBoundary).not.toContain('formatGateEvidence(csvVerificationGate');
		expect(platformApiBoundary).not.toContain("label: 'Encrypted API-key contract'");
		expect(platformApiBoundary).not.toContain("label: 'Stored adapter state'");
		expect(platformApiBoundary).toContain('Platform portability boundary');
		expect(platformApiBoundary).toContain('Platform intake capability');
		expect(platformApiBoundary).toContain('id="platform-profile-contract"');
		expect(platformApiBoundary).toContain('Incumbent exports become source custody');
		expect(platformApiBoundary).not.toContain('Exports become provenance');
		expect(platformApiBoundary).toContain('id="platform-sync-proof-contract"');
		expect(platformApiBoundary).toContain('Direct sync proof');
		expect(platformApiBoundary).toContain('What must be true before imports run');
		expect(platformApiBoundary).toContain('Direct platform sync proof contract');
		expect(platformApiBoundary).toContain('buildPlatformIntakeReadiness proofRows');
		expect(platformApiBoundary).toContain('direct sync proof contract');
		expect(platformApiBoundary).toContain('{#each platformProfileRows as row (row.source)}');
		expect(platformApiBoundary).toContain('{#each platformApiProofRows as row (row.id)}');
		expect(platformApiBoundary).toContain('formatCapabilityClusters(row.clusters)');
		expect(platformApiBoundary).toContain('platform export profile header signatures');
		expect(platformApiBoundary).toContain('Sync proof: {row.apiProofSummary}');
		expect(platformApiBoundary).toContain('direct sync proof checklist');
		expect(platformApiBoundary).toContain('sync checks');
		expect(platformApiBoundary).toContain('buildPlatformIntakeReadiness csvContractCount');
		expect(platformApiBoundary).toContain('buildPlatformIntakeReadiness apiBoundaryCount');
		expect(platformApiBoundary).toContain('aria-label="Source-custody state mix"');
		expect(platformApiBoundary).not.toContain('aria-label="Platform profile state mix"');
		expect(platformApiBoundary).toContain('<Ratio segments={platformProfileSegments} height={8} />');
		expect(platformApiBoundary).not.toContain(
			'Use CSV export profiles for Action Network, EveryAction/NGP VAN, NationBuilder, and'
		);
		expect(platformApiBoundary).toContain('platformApiSyncRuntimeMessage');
		expect(platformApiBoundary).toContain('const platformApiSyncGround = $derived({');
		expect(platformApiBoundary).toContain('runtimeReady: platformApiSyncRuntimeReady');
		expect(platformApiBoundary).toContain('runtimeMissing: platformApiSyncRuntimeMissing');
		expect(platformApiBoundary).toContain('credentialStored: isConnected');
		expect(platformApiBoundary).toContain('platformApiSync: platformApiSyncGround');
		expect(platformApiBoundary).toContain('Direct platform sync is not armed');
		expect(hypergraph).toContain('Configure encrypted credential custody before platform API credentials can be stored.');
		expect(platformApiBoundary).toContain(
			'Credential storage waits on a configured server encryption key'
		);
		expect(platformApiBoundary).not.toContain('token custody is disabled until');
		expect(platformApiBoundary).toContain('platform-specific sync proof');
		expect(platformApiBoundary).toContain("platformApiSyncRunnerImplemented ? 'armed' : 'held'");
		expect(platformApiBoundary).not.toContain('not implemented');
		expect(platformApiBoundary).toContain('sync stays behind the same execution boundary');
		expect(platformApiBoundary).toContain('Store encrypted API credential');
		expect(platformApiBoundary).toContain('name="platform_source"');
		expect(platformApiBoundary).toContain('name="api_key"');
		expect(platformApiBoundary).toContain('This only stores custody for a selected platform profile');
		expect(platformApiBoundary).toContain('It does not call the platform');
		expect(platformApiBoundary).toContain('Verify custody boundary');
		expect(platformApiBoundary).toContain('action="?/sync"');
		expect(platformApiBoundary).toContain('Verify stored credential');
		expect(platformApiBoundary).toContain('form?.probed');
		expect(platformApiBoundary).toContain('form.probeMessage');
		expect(platformApiBoundary).toContain('Direct sync remains a held route handoff.');
		expect(platformApiBoundary).toContain('{platformApiGateSummary}');
		expect(platformApiBoundary).not.toContain("'direct_platform_import'} held by");
		expect(platformApiBoundary).not.toContain('held by {form.gate');
		expect(platformApiBoundary).toContain('credentialProbeCompletedAt');
		expect(platformApiBoundary).toContain('const credentialProbeComplete = $derived');
		expect(hypergraph).toContain("'read credential proof'");
		expect(hypergraph).toContain("'verify stored credential'");
		expect(platformApiBoundary).toContain('opened under the org/profile binding');
		expect(platformApiBoundary).toContain('Probe version');
		expect(platformApiBoundary).toContain('does not call the platform');
		expect(platformApiBoundary).toContain('page through records');
		expect(platformApiBoundary).toContain('import people');
		expect(platformApiBoundary).toContain('credentialCustodyReady');
		expect(platformApiBoundary).toContain('are custody metadata');
		expect(platformApiBoundary).toContain(
			'const platformDirectImportEvidenceObserved = $derived'
		);
		expect(platformApiBoundary).toContain('{#if platformDirectImportEvidenceObserved}');
		expect(platformApiBoundary).toContain('aria-label="Direct import execution evidence"');
		expect(platformApiBoundary).toContain('aria-label="Stored platform custody evidence"');
		expect(platformApiBoundary).toContain('cite="stored platform credential envelope"');
		expect(platformApiBoundary).toContain('cite="stored platform credential probe"');
		expect(platformApiBoundary).toContain('cite="PLATFORM_API_SYNC_RUNNER_IMPLEMENTED"');
		expect(platformApiBoundary).toContain('cite="getPlatformApiSyncReadiness.missing"');
		expect(platformApiBoundary).toContain('Direct');
		expect(platformApiBoundary).toContain('import counters stay hidden');
		expect(platformApiBoundary).toContain('zero-row sync');
		expect(platformApiBoundary).not.toContain('placeholder evidence');
		expect(hypergraph).toContain("cite: 'PLATFORM_EXPORT_PROFILES.length'");
		expect(hypergraph).toContain(
			"cite: 'getPlatformApiSyncReadiness + organizations.getPlatformApiState'"
		);
		expect(hypergraph).toContain("cite: 'direct sync proof checklist'");
		expect(platformApiBoundary).toContain('cite="stored platform adapter imported"');
		expect(platformApiBoundary).toContain('cite="stored platform adapter updated"');
		expect(platformApiBoundary).toContain('cite="stored platform adapter skipped"');
		expect(platformApiBoundary).toContain('cite="stored platform adapter processed/total"');
		expect(platformApiBoundary).toContain('execution progress');
		expect(platformApiBoundary).not.toContain('stored progress');
		expect(platformApiBoundary).toContain('cite="stored platform adapter errors"');
		expect(platformApiBoundary).not.toContain('organizations.anSync');
		expect(hypergraph).toContain('platform-api#platform-connection-boundary');
		expect(hypergraph).toContain('platform-api#platform-sync-boundary');
		expect(hypergraph).toContain('platform-api#platform-stored-state');
		expect(hypergraph).toContain("'read custody boundary'");
		expect(hypergraph).toContain("'read sync boundary'");
		expect(platformApiBoundary).not.toContain("action: 'read boundary'");
		expect(platformApiBoundary).toContain('id="platform-intake"');
		expect(platformApiBoundary).toContain('id="platform-connection-boundary"');
		expect(platformApiBoundary).toContain('id="platform-sync-boundary"');
		expect(platformApiBoundary).toContain('id="platform-stored-state"');
		expect(platformApiBoundary).not.toContain('#an-connection-boundary');
		expect(platformApiBoundary).not.toContain('#an-sync-boundary');
		expect(platformApiBoundary).not.toContain('#an-stored-state');
		expect(platformApiBoundary).not.toContain('id="an-intake"');
		expect(platformApiBoundary).not.toContain('Action Network adapter');
		expect(platformApiBoundary).not.toContain(
			'Action Network OSDI is one adapter under this boundary.'
		);
		expect(platformApiBoundary).not.toContain('Action Network intake capability');
		expect(platformApiSyncReadiness).toContain('PLATFORM_API_SYNC_RUNNER_IMPLEMENTED = false');
		expect(platformApiSyncReadiness).toContain(
			'profile registry, encrypted credential custody, direct sync execution, and continuation checkpointing'
		);
		expect(platformApiSyncReadiness).toContain('direct sync execution');
		expect(platformApiSyncReadiness).toContain('continuation checkpointing');
		expect(platformApiBoundaryServer).toContain('formatGateEvidence, getGateEvidence');
		expect(platformApiBoundaryServer).toContain(
			"const platformApiGate = getGateEvidence('CP-platform-api-sync', ['T1-3']"
		);
		expect(platformApiBoundaryServer).toContain('formatGateEvidence(platformApiGate');
		expect(platformApiBoundaryServer).toContain('getPlatformApiSyncReadiness');
		expect(platformApiBoundaryServer).toContain('sealPlatformApiCredential');
		expect(platformApiBoundaryServer).toContain('openPlatformApiCredential');
		expect(platformApiBoundaryServer).toContain('hasPlatformApiCredentialKey');
		expect(platformApiBoundaryServer).toContain('parseStoredPlatformCredential');
		expect(platformApiBoundaryServer).toContain('recordPlatformApiCredentialProbe');
		expect(platformApiBoundaryServer).toContain('credentialProbeCompletedAt');
		expect(platformApiBoundaryServer).toContain('connectPlatformApiCredential');
		expect(platformApiBoundaryServer).toContain('getPlatformApiState');
		expect(platformApiBoundaryServer).toContain('disconnectPlatformApiCredential');
		expect(platformApiSyncReadiness).toContain('direct sync execution');
		expect(platformApiBoundaryServer).toContain('/supporters/import/platform-api');
		expect(platformApiBoundaryServer).toContain('platform_api_credential_custody_not_configured');
		expect(platformApiBoundaryServer).toContain('platform_api_sync_not_armed');
		expect(platformApiBoundaryServer).toContain('platform_api_credential_probe_complete');
		expect(platformApiBoundaryServer).toContain('platform_api_credential_probe_failed');
		expect(platformApiBoundaryServer).toContain("blockedVerb: 'open_platform_credential'");
		expect(platformApiBoundaryServer).toContain("blockedVerb: 'direct_platform_import'");
		expect(platformApiBoundaryServer).toContain('Credential custody probe passed.');
		expect(organizations).toContain('export const recordPlatformApiCredentialProbe = mutation');
		expect(organizations).toContain("status: 'credential_probe_complete'");
		expect(organizations).toContain("syncType: 'credential-probe'");
		expect(organizations).toContain("currentResource: 'credential-envelope'");
		expect(schema).toContain('credentialProbeCompletedAt: v.optional(v.number())');
		expect(schema).toContain('credentialProbeVersion: v.optional(v.string())');
		expect(layoutServer).toContain('api.organizations.getPlatformApiState');
		expect(layoutServer).toContain('credentialProbeComplete: Boolean');
		expect(layoutServer).toContain('credentialProbeCompletedAt: platformApiStateResult?.credentialProbeCompletedAt');
		expect(spaces).toContain('credentialProbeComplete: boolean;');
		expect(spaces).toContain('credentialProbeCompletedAt: string | null;');
		expect(hypergraph).toContain('credentialProbeComplete?: boolean | null;');
		expect(hypergraph).toContain("phase: 'GROUND' | 'RESOLVE';");
		expect(hypergraph).toContain('export type PlatformApiProofRow = {');
		expect(hypergraph).toContain('proofRows: PlatformApiProofRow[];');
		expect(hypergraph).toContain("id: 'profile-registry'");
		expect(hypergraph).toContain("id: 'credential-probe'");
		expect(hypergraph).toContain("id: 'adapter-execution'");
		expect(hypergraph).toContain("id: 'import-safety'");
		expect(hypergraph).toContain("id: 'continuation-checkpoint'");
		expect(hypergraph).toContain('Direct sync must prove resource pagination');
		expect(hypergraph).toContain('Large platform sync must persist cursor/checkpoint progress');
		expect(hypergraph).toContain("label: 'custody marks'");
		expect(hypergraph).toContain('Credential custody ${credentialProbeComplete ?');
		expect(platformApiBoundaryServer).toContain("blockedVerb: 'store_platform_credential'");
		expect(platformApiBoundaryServer).toContain('return fail(\n\t\t\t\t424,');
		expect(platformApiBoundaryServer).toContain("blockedVerb: options.blockedVerb ?? 'direct_platform_import'");
		expect(platformApiBoundaryServer).toContain('platformApiSyncRuntimeMissing');
		expect(platformApiBoundaryServer).toContain('platformApiSyncRuntimeFlag');
		expect(platformApiBoundaryServer).not.toContain('return fail(\n\t\t\t\t501,');
		expect(platformApiBoundaryServer).not.toContain('gated by NEW-T1-3');
		expect(platformApiBoundaryServer).not.toContain('Action Network OSDI adapter');
		expect(canonicalDoc).toContain(
			'The boundary route consumes `buildPlatformIntakeReadiness`, renders the same recognized-profile lattice as the OS map'
		);
		expect(canonicalDoc).toContain(
			'The OS map and boundary route now show the same platform intake operating-stage strip before the vendor grid'
		);
		expect(canonicalDoc).toContain(
			'Its `WorkspaceCapabilityStrip` maps directly from `buildPlatformIntakeReadiness.stageRows`'
		);
		expect(canonicalDoc).toContain(
			'stored adapter state remains lower-route audit context at `#platform-stored-state`'
		);
		expect(canonicalDoc).toContain(
			'credential envelope, custody probe, runner, and held-check evidence'
		);
		expect(canonicalDoc).toContain('custody cannot read as a zero-row sync');
		expect(canonicalDoc).toContain(
			'Platform-neutral anchors remain `#platform-profile-contract`, `#platform-connection-boundary`, `#platform-sync-boundary`, and `#platform-stored-state`'
		);
		expect(canonicalDoc).toContain(
			'shows the CSV/API state mix with the shared `Ratio`/operator-state formatter'
		);
		expect(canonicalDoc).toContain(
			'Each profile row exposes two distinct handoffs from the shared row model'
		);
		expect(canonicalDoc).toContain('`csvHref` routes to live CSV export intake');
		expect(canonicalDoc).toContain(
			'`apiHref` routes to the encrypted credential / sync-boundary surface'
		);
		expect(canonicalDoc).toContain(
			'the connection boundary can store an encrypted credential for a selected platform profile'
		);
		expect(canonicalDoc).toContain(
			'Its local actions read `read custody boundary`, `verify stored credential`, `read credential proof`, and `read sync boundary`'
		);
		expect(canonicalDoc).toContain('bounded credential-custody probe');
		expect(canonicalDoc).toContain('persists the probe timestamp');
		expect(canonicalDoc).toContain('without calling the platform or importing people');
		expect(canonicalDoc).toContain('Stored adapter state and persisted custody probes are audit context only');
		expect(canonicalDoc).not.toContain('sync` still returns structured `platform_api_sync_not_armed`');
		expect(capabilityScope).toContain('bounded credential-custody probe');
		expect(capabilityScope).toContain('Direct import counters');
		expect(capabilityScope).toContain('zero-row sync');
		expect(capabilityScope).toContain('persists `credentialProbeCompletedAt`');
		expect(capabilityScope).toContain('read custody boundary');
		expect(capabilityScope).toContain('read sync boundary');
		expect(capabilityScope).toContain('`csvHref` for the live CSV intake path');
		expect(capabilityScope).toContain('`apiHref` for the encrypted credential/sync-boundary path');
		expect(capabilityScope).toContain('platform_api_credential_probe_complete');
		expect(capabilityScope).toContain('dependency-bound credential-custody boundary');
		expect(capabilityScope).not.toContain('HTTP 501 sync boundary');
		expect(capabilityScope).not.toContain('platform-neutral route shell still returns 501');
		expect(legacyActionNetworkPage).toContain('Adapter route moved');
		expect(legacyActionNetworkPage).toContain('href="../platform-api"');
		expect(legacyActionNetworkServer).toContain('platformApiBoundary');
		expect(legacyActionNetworkServer).toContain('/supporters/import/platform-api');
		expect(legacyActionNetworkServer).toContain('redirect(308');
		expect(legacyActionNetworkServer).toContain('redirect(303');
		expect(legacyActionNetworkServer).not.toContain('getAnSync');
		expect(supportersPage).toContain('Import from CSV or platform export');
		expect(supportersPage).toContain('WorkspaceCapabilityStrip');
		expect(supportersPage).toContain('label="People capability"');
		expect(supportersPage).toContain("from '$lib/data/platform-export-profiles'");
		expect(supportersPage).toContain("import { Upload } from '@lucide/svelte';");
		expect(supportersPage).toContain('buildPeopleSourceProvenanceReadiness,');
		expect(supportersPage).toContain('buildPeopleSegmentationReadiness,');
		expect(supportersPage).toContain('buildEmailListHealthReadiness,');
		expect(supportersPage).toContain('type PeopleLedgerMetric =');
		expect(supportersPage).toContain('type PeopleRowDrilldownMetric = PeopleLedgerMetric');
		expect(supportersPage).toContain('const peopleLedgerMetrics = $derived<PeopleLedgerMetric[]>([');
		expect(supportersPage).toContain(
			"import {\n\t\toperatorCapabilityActionLabel,\n\t\toperatorCapabilityStateLabel\n\t} from '$lib/data/capability-state-labels';"
		);
		expect(supportersPage).toContain('const peopleSourceProvenanceReadiness = $derived(');
		expect(supportersPage).toContain('const peopleSegmentationReadiness = $derived(');
		expect(supportersPage).toContain('const emailListHealthReadiness = $derived(');
		expect(supportersPage).toContain('function weakestCapabilityState(states: CapabilityState[])');
		expect(supportersPage).toContain('const rowDrilldownState = $derived<CapabilityState>');
		expect(supportersPage).toContain('peopleSegmentationReadiness.state');
		expect(supportersPage).toContain('civicGeographyLabelsGate.state');
		expect(supportersPage).toContain('const rowDrilldownAction = $derived(');
		expect(supportersPage).toContain('operatorCapabilityActionLabel(');
		expect(supportersPage).toContain("'read filtered row evidence'");
		expect(supportersPage).toContain("'shape row drilldown'");
		expect(supportersPage).toContain('const rowDrilldownNext = $derived(');
		expect(supportersPage).toContain('const rowDrilldownMetrics = $derived<PeopleRowDrilldownMetric[]>([');
		expect(supportersPage).toContain('aria-label="People ledger evidence counts"');
		expect(supportersPage).toContain('{#each peopleLedgerMetrics as metric (metric.label)}');
		expect(supportersPage).toContain("label: 'people loaded'");
		expect(supportersPage).toContain("cite: 'supporters.getSummaryStats total'");
		expect(supportersPage).toContain("label: 'address evidence'");
		expect(supportersPage).toContain("cite: 'supporters.getSummaryStats postal'");
		expect(supportersPage).toContain("label: 'district signal'");
		expect(supportersPage).toContain("cite: 'supporters.getSummaryStats district'");
		expect(supportersPage).toContain("label: 'identity verified'");
		expect(supportersPage).toContain("cite: 'supporters.getSummaryStats verified'");
		expect(supportersPage).toContain("label: 'subscribed reach'");
		expect(supportersPage).toContain("cite: 'supporters.getSummaryStats emailHealth.subscribed'");
		expect(supportersPage).toContain(
			'<Upload size={16} strokeWidth={1.8} aria-hidden="true" />'
		);
		expect(supportersPage).not.toContain(
			'<span class="text-text-tertiary font-mono text-lg tabular-nums">{fmt(data.total)}</span>'
		);
		expect(supportersPage).not.toContain('PLATFORM_EXPORT_PROFILES.length');
		expect(supportersPage).toContain(
			"const verificationTrustGate = getGateEvidence('CP-mainnet-deployment', ['T3-6', 'T5-3']"
		);
		expect(supportersPage).toContain(
			"const platformApiGate = getGateEvidence('CP-platform-api-sync', ['T1-3']"
		);
			expect(supportersPage).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
			expect(supportersPage).toContain("const listUnsubscribeGate = getGateEvidence('CP-list-unsubscribe'");
			expect(supportersPage).toContain("'CP-list-unsubscribe-provider-rendering'");
			expect(supportersPage).toContain("['T2-4b']");
			expect(supportersPage).toContain(
				"const softBounceGate = getGateEvidence('CP-soft-bounce-categorization'"
		);
		expect(supportersPage).toContain("const customDomainGate = getGateEvidence('CP-custom-domain-dkim'");
		expect(supportersPage).toContain("const civicGeographyLabelsGate = getGateEvidence('CP-civic-geography-labels'");
		expect(supportersListServer).toContain('sourceCounts: asNumberRecord(summaryStats.sourceCounts)');
		expect(supportersListServer).toContain('api.segments.list');
		expect(supportersListServer).toContain('function buildPeopleSegmentationGround(');
		expect(supportersListServer).toContain('segmentation: Array.isArray(segmentsResult?.segments)');
		expect(supportersPage).toContain("label: 'People verification signal'");
		expect(supportersPage).toContain("label: 'People source custody'");
		expect(supportersPage).toContain("label: 'People segmentation posture'");
		expect(supportersPage).toContain("label: 'Consent-bound reach'");
		expect(supportersPage).not.toContain("label: 'Reachable email cohort'");
		expect(supportersPage).not.toContain("label: 'Platform export provenance'");
		expect(supportersPage).toContain("cluster: 'C-verification / C-data-sovereignty'");
		expect(supportersPage).toContain("cluster: 'C-data-sovereignty / C-reach'");
		expect(supportersPage).toContain("cluster: 'C-reach / C-data-sovereignty'");
		expect(supportersPage).toContain(
			'Postal, district, and identity signals are loaded as reach weight'
		);
		expect(supportersPage).toContain('peopleSourceProvenanceReadiness.effect');
		expect(supportersPage).toContain('peopleSourceProvenanceReadiness.detail');
		expect(supportersPage).toContain('peopleSegmentationReadiness.effect');
		expect(supportersPage).toContain('emailListHealthReadiness.effect');
		expect(supportersPage).toContain('id="people-verification"');
		expect(supportersPage).toContain('id="people-source-provenance"');
		expect(supportersPage).toContain('aria-label="People source custody"');
		expect(supportersPage).toContain('Source custody');
		expect(supportersPage).toContain('id="people-segments"');
		expect(supportersPage).toContain('civicGeographyBoundary={formatGateEvidence');
		expect(supportersPage).toContain(
			'verified local and special district labels remain gated'
		);
		expect(supportersPage).toContain('id="email-health"');
		expect(supportersPage).toContain('aria-label="Consent-bound reach"');
		expect(supportersPage).toContain("import { Datum } from '$lib/design';");
		expect(supportersPage).toContain('id="people-ledger-boundary"');
		expect(supportersPage).toContain('aria-label="People ledger row evidence boundary"');
		expect(supportersPage).toContain('Person rows are drilldown, not proof by themselves');
		expect(supportersPage).toContain(
			'Rows below are encrypted person records and filter drilldown.'
		);
		expect(supportersPage).toContain('supporters.list page rows');
		expect(supportersPage).toContain('supporters.getSummaryStats total');
		expect(supportersPage).toContain('URL filter state');
		expect(supportersPage).toContain('id="people-row-drilldown-controls"');
		expect(supportersPage).toContain('aria-label="People row drilldown controls"');
		expect(supportersPage).toContain('data-state={rowDrilldownState}');
		expect(supportersPage).toContain('{operatorCapabilityStateLabel(rowDrilldownState)}');
		expect(supportersPage).toContain('{rowDrilldownAction}');
		expect(supportersPage).toContain('Encrypted rows stay drilldown; aggregate proof stays above');
		expect(supportersPage).toContain('without promoting person rows');
		expect(supportersPage).toContain('into People capability proof');
		expect(supportersPage).toContain('{rowDrilldownNext}');
		expect(supportersPage).toContain('{#each rowDrilldownMetrics as metric (metric.label)}');
		expect(supportersPage).toContain("label: 'active filters'");
		expect(supportersPage).toContain("label: 'tag labels'");
		expect(supportersPage).toContain("cite: 'supporters.getTags'");
		expect(supportersPage).toContain('aria-label="Find encrypted person row"');
		expect(supportersPage).toContain('placeholder="Find encrypted row..."');
		expect(supportersPage).toContain('Tag custody');
		expect(supportersPage).toContain('Cohort posture');
		expect(supportersPage).not.toContain('Search by name or email...');
		expect(supportersPage).not.toContain('Manage Tags');
		expect(supportersPage).not.toContain('>Segments<');
		expect(supportersPage).not.toContain('>All tags<');
		expect(supportersPage).toContain(
			'Imported state/congressional and action-time district labels are targetable'
		);
		expect(supportersPage).toContain('formatGateEvidence(civicGeographyLabelsGate');
		expect(supportersPage).not.toContain('Import from CSV or Action Network');

		expect(peopleImport).toContain('Platform export profiles');
		expect(peopleImport).toContain("from '$lib/data/platform-export-profiles'");
		expect(peopleImport).toContain("from '$lib/data/capability-clusters'");
		expect(peopleImport).toContain("from '$lib/data/capability-hypergraph'");
		expect(peopleImport).toContain("from '$lib/data/capability-state-labels'");
		expect(peopleImport).toContain("import { Datum, Ratio } from '$lib/design';");
		expect(peopleImport).toContain('PEOPLE_IMPORT_FIELD_ALIASES,');
		expect(peopleImport).toContain('buildPlatformIntakeReadiness,');
		expect(peopleImport).toContain('buildPeopleSourceProvenanceReadiness,');
		expect(peopleImport).toContain('type PlatformIntakeProfileRow');
		expect(peopleImport).toContain('type PlatformIntakeStageRow');
		expect(peopleImport).toContain('type IntakePressureReadout = {');
		expect(peopleImport).toContain('const platformIntakeReadiness = $derived(');
		expect(peopleImport).toContain('buildPlatformIntakeReadiness({');
		expect(peopleImport).toContain('const peopleSourceProvenanceReadiness = $derived(');
		expect(peopleImport).toContain('buildPeopleSourceProvenanceReadiness({');
		expect(peopleImport).toContain('sourceCounts: data.spaces.base?.sourceCounts ?? null');
		expect(peopleImport).toContain('totalPeople: data.spaces.base?.total ?? null');
		expect(peopleImport).toContain(
			'const platformProfileRows = $derived<PlatformIntakeProfileRow[]>(platformIntakeReadiness.rows)'
		);
		expect(peopleImport).toContain(
			'const platformIntakeStageRows = $derived<PlatformIntakeStageRow[]>'
		);
		expect(peopleImport).toContain(
			'const platformExportProfileCount = $derived(platformIntakeReadiness.profileCount)'
		);
		expect(peopleImport).toContain('const platformProfileStateCounts = $derived');
		expect(peopleImport).toContain('const platformProfileSegments = $derived');
		expect(peopleImport).toContain("labelSuffix: ' source-custody contracts'");
		expect(peopleImport).toContain('const exportRecognitionStage = $derived');
		expect(peopleImport).toContain('const directPlatformSyncStage = $derived');
		expect(peopleImport).toContain(
			'const intakePressureReadouts = $derived<IntakePressureReadout[]>(['
		);
		expect(peopleImport).toContain("id: 'recognized-exports'");
		expect(peopleImport).toContain("id: 'source-custody'");
		expect(peopleImport).toContain("id: 'direct-sync-boundary'");
		expect(peopleImport).toContain("label: 'Recognized exports'");
		expect(peopleImport).toContain("label: 'Source custody'");
		expect(peopleImport).toContain("label: 'Direct sync boundary'");
		expect(peopleImport).toContain('peopleSourceProvenanceReadiness.signal');
		expect(peopleImport).toContain('peopleSourceProvenanceReadiness.detail');
		expect(peopleImport).toContain('peopleSourceProvenanceReadiness.gate');
		expect(peopleImport).toContain('peopleSourceProvenanceReadiness.platformProfilePeopleCount');
		expect(peopleImport).toContain("source: 'buildPlatformIntakeReadiness'");
		expect(peopleImport).toContain("source: 'buildPeopleSourceProvenanceReadiness'");
		expect(peopleImport).toContain("source: 'getPlatformApiSyncReadiness'");
		expect(peopleImport).toContain('type IntakeContractRow = {');
		expect(peopleImport).toContain('const intakeContractRows = $derived<IntakeContractRow[]>');
		expect(peopleImport).toContain('aria-label="People import capability contract"');
		expect(peopleImport).toContain('Exports become source custody');
		expect(peopleImport).not.toContain('Portability becomes provenance');
		expect(peopleImport).toContain('{platformIntakeReadiness.effect}');
		expect(peopleImport).toContain('{platformIntakeReadiness.boundary}');
		expect(peopleImport).toContain('/supporters/import/platform-api');
		expect(peopleImport).toContain('Read sync boundary');
		expect(peopleImport).toContain('aria-label="Source portability pressure"');
		expect(peopleImport).toContain(
			'{#each intakePressureReadouts as readout (readout.id)}'
		);
		expect(peopleImport).toContain('data-state={readout.state}');
		expect(peopleImport).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(peopleImport).toContain('actionFor(readout.state, readout.action)');
		expect(peopleImport).toContain("label: 'Export recognition'");
		expect(peopleImport).toContain("label: 'Person key'");
		expect(peopleImport).toContain("label: 'Source custody'");
		expect(peopleImport).toContain("label: 'Custom field custody'");
		expect(peopleImport).toContain("label: 'Encrypted batch write'");
		expect(peopleImport).toContain("label: 'Direct platform sync'");
		expect(peopleImport).toContain("{ value: 'custom', label: 'Encrypted custom field' }");
		expect(peopleImport).toContain('preserveUnmappedAsCustomFields');
		expect(peopleImportServer).toContain("fieldName === 'custom'");
		expect(peopleImportServer).toContain('customFields[key] = value');
		expect(peopleImportServer).toContain('custom_fields: Object.values(effectiveMapping)');
		expect(supportersConvex).toContain('customFields: v.optional(v.record(v.string(), v.string()))');
		expect(supportersConvex).toContain(
			"encryptForSupporterV2(customFieldsJson, orgKey, emailHash, 'customFields')"
		);
		expect(supportersPage).toContain('decryptOrgPii');
		expect(supporterDetail).toContain('decryptOrgPii');
		expect(supporterDetail).toContain('buildPersonDetailRows');
		expect(supporterDetail).toContain("import { Datum } from '$lib/design';");
		expect(supporterDetail).toContain('type PersonRowCustodyMetric =');
		expect(supporterDetail).toContain('const encryptedFieldCount = $derived(');
		expect(supporterDetail).toContain('const customFieldCustodyRow = $derived(');
		expect(supporterDetail).toContain("row.id === 'custom-field-custody'");
		expect(supporterDetail).toContain('const personRowCustodyNext = $derived(');
		expect(supporterDetail).toContain('customFieldCustodyRow?.boundary');
		expect(supporterDetail).toContain(
			'const personRowCustodyMetrics = $derived<PersonRowCustodyMetric[]>(['
		);
		expect(supporterDetail).toContain("label: 'capability rows'");
		expect(supporterDetail).toContain("cite: 'buildPersonDetailRows'");
		expect(supporterDetail).toContain("label: 'encrypted fields'");
		expect(supporterDetail).toContain("cite: 'supporters.getById encrypted row'");
		expect(supporterDetail).toContain("label: 'tag labels'");
		expect(supporterDetail).toContain("cite: 'supporters.getTags'");
		expect(supporterDetail).toContain("label: 'custom fields'");
		expect(supporterDetail).toContain('encryptedCustomFields custody');
		expect(supporterDetail).toContain('id="person-row-custody"');
		expect(supporterDetail).toContain('aria-label="Person row custody boundary"');
		expect(supporterDetail).toContain('data-state={customFieldsGate.state}');
		expect(supporterDetail).toContain(
			'Decrypted fields are evidence drilldown, not identity proof'
		);
		expect(supporterDetail).toContain('{personRowCustodyNext}');
		expect(supporterDetail).toContain(
			'{#each personRowCustodyMetrics as metric (metric.label)}'
		);
		expect(supporterDetail).toContain('aria-label="Encrypted person row fields"');
		expect(supporterDetail).toContain('Tag custody');
		expect(supporterDetail).toContain('No row tags');
		expect(supporterDetail).toContain('Remove row tag {tag.name}');
		expect(supporterDetail).toContain('Add tag');
		expect(supporterDetail).toContain("person row's underlying identity proof details");
		expect(supporterDetail).not.toContain('<!-- Details -->');
		expect(supporterDetail).not.toContain(
			'<p class="text-text-tertiary font-mono text-xs tracking-wider uppercase">Tags</p>'
		);
		expect(supporterDetail).not.toContain('No tags');
		expect(supporterDetail).not.toContain('Remove tag {tag.name}');
		expect(supporterDetail).not.toContain("supporter's identity verification details");
		expect(canonicalDoc).toContain('before `#person-row-custody`');
		expect(canonicalDoc).toContain('encrypted-field count, tag labels, custom-field custody');
		expect(canonicalDoc).toContain('row inspection rather than a contact profile');
		expect(capabilityScope).toContain('renders `#person-row-custody`');
		expect(capabilityScope).toContain(
			'cited capability-row, encrypted-field, tag-label, and custom-field custody metrics'
		);
		expect(capabilityScope).toContain('custody-bound drilldown rather than a contact profile');
		expect(hypergraph).toContain("label: 'Custom field custody'");
		expect(hypergraph).toContain(
			'Custom-field custody is encrypted blob evidence; typed fields and segmentation remain dependency-first.'
		);
		expect(peopleImport).toContain('strictest-wins merging');
		expect(peopleImport).toContain('supporters.importWithEncryption in 100-row batches');
		expect(peopleImport).toContain('gate: platformIntakeReadiness.gate');
		expect(hypergraph).toContain('platformApiSync?.runtimeReady === true');
		expect(hypergraph).toContain('Direct platform sync is not armed; missing ${runtimeMissing}.');
		expect(hypergraph).toContain('direct sync ${runnerImplemented ?');
		expect(hypergraph).toContain("direct sync ${runnerImplemented ? 'armed' : 'held'}");
		expect(hypergraph).toContain('PLATFORM_API_RUNNER_PROOF_REQUIREMENTS');
		expect(hypergraph).toContain('apiProofSummary: string;');
		expect(hypergraph).toContain('const apiRunnerProofSummary = apiRunnerProofs.join');
		expect(hypergraph).toContain('Direct import stays behind ${apiRunnerProofSummary}.');
		expect(hypergraph).toContain('sync proof requires ${apiRunnerProofSummary}.');
		expect(hypergraph).not.toContain(
			"direct sync ${runnerImplemented ? 'implemented' : 'not implemented'}"
		);
		expect(peopleImport).toContain('<Ratio segments={intakeStateSegments} height={8} />');
		expect(peopleImport).toContain('<Ratio segments={platformProfileSegments} height={8} />');
		expect(peopleImport).toContain('Sync proof: {row.apiProofSummary}');
		expect(peopleImport).toContain('direct sync proof checklist');
		expect(peopleImport).toContain('operatorCapabilityStateRatioSegments');
		expect(peopleImport).toContain(
			'const intakeStateSegments = $derived(operatorCapabilityStateRatioSegments(intakeStateCounts));'
		);
		expect(peopleImport).toContain('platformProfileRows');
		expect(peopleImport).toContain('.flatMap((row) => [row.csvState, row.apiState])');
		expect(peopleImport).toContain('operatorCapabilityActionLabel,');
		expect(peopleImport).toContain(
			'return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });'
		);
		expect(peopleImport).toContain('return actionFor(row.state, row.action);');
		expect(peopleImport).not.toContain('return `context / ${row.action}`;');
		expect(peopleImport).toContain('{formatCapabilityClusters(row.cluster)}');
		expect(peopleImport).toContain('return operatorCapabilityStateLabel(state);');
		expect(peopleImport).toContain('{#each platformProfileRows as row (row.source)}');
		expect(peopleImport).toContain('href={row.csvHref}');
		expect(peopleImport).toContain('href={row.apiHref}');
		expect(peopleImport).toContain('CSV profile · {stateLabel(row.csvState)}');
		expect(peopleImport).toContain('Direct sync · {stateLabel(row.apiState)}');
		expect(peopleImport).toContain('platform export profile header signatures');
		expect(peopleImport).toContain(
			'detectedPlatform = detectPlatformExportProfile(parsed.headers)'
		);
		expect(peopleImport).toContain('normalizePlatformExportHeader(parsed.headers[i])');
		expect(peopleImport).toContain('PEOPLE_IMPORT_FIELD_ALIASES[normalized]');
		expect(peopleImport).toContain('Source profile');
		expect(peopleImport).not.toContain('const HEADER_ALIASES');
		expect(peopleImport).not.toContain('{#each PLATFORM_EXPORT_PROFILES as profile}');
		expect(peopleImport).not.toContain("label: 'armed'");
		expect(peopleImport).not.toContain("label: 'bounded'");
		expect(peopleImport).not.toContain("label: 'draft only'");
		expect(peopleImport).not.toContain("label: 'not armed'");
		expect(peopleImport).not.toContain('isActionNetworkFormat');
		expect(peopleImport).not.toContain('Platform Connectors');
		expect(publicOrgPage).toContain("from '$lib/data/platform-export-profiles'");
		expect(publicOrgPage).toContain('const platformProfileCount = PLATFORM_EXPORT_PROFILES.length');
		expect(publicOrgPage).toContain(
			'Recognize CSV exports from {platformProfileCount} common platforms and generic CSV'
		);
		expect(publicOrgPage).toContain('Verification-scoped blasts and delivery evidence');
		expect(publicOrgPage).toContain('server dispatch stays gated by send');
		expect(publicOrgPage).toContain('Text dispatch stays custody-bound');
		expect(publicOrgPage).toContain('Public RSVP records and bounded attendance artifacts');
		expect(publicOrgPage).toContain('proof ceremony stays gated');
		expect(publicOrgPage).toContain('Donation intake and baseline confirmations');
		expect(publicOrgPage).toContain('tax and anchored receipts stay qualified');
		expect(publicOrgPage).toContain('Watch federal bills and register positions');
		expect(publicOrgPage).toContain('alert fan-out stays gated');
		expect(publicOrgPage).toContain('Saved coordination definitions');
		expect(publicOrgPage).toContain('side effects stay behind workflow execution gates');
		for (const stalePublicGridClaim of [
			'Blasts, sequences, deliverability tracking',
			'Segmented by verification tier',
			'Attendance feeds the verification funnel',
			'Contributions, donor management, compliance reporting',
			'trigger campaigns on activity',
			'Verification-gated workflows',
			'Multi-step sequences',
			'Conditional triggers'
		]) {
			expect(publicOrgPage).not.toContain(stalePublicGridClaim);
		}
		expect(publicOrgPage).not.toContain('10DLC-ready');
		expect(canonicalDoc).toContain(
			'Public org product tiles must follow the same route-effect grammar as the OS map'
		);
		expect(canonicalDoc).toContain(
			'fundraising may claim donation intake and baseline confirmations, not compliance reporting'
		);
		expect(capabilityScope).toContain(
			'public-grid claims about sequences, event proof funnels, compliance reporting, campaign-trigger automation, and proof-bearing workflow automation are closed or bounded in active copy'
		);
		for (const verticalPage of [stateLegislaturePage, localGovernmentPage, agencyRulemakingPage]) {
			expect(verticalPage).toContain("from '$lib/data/platform-export-profiles'");
			expect(verticalPage).toContain('const platformProfileCount = PLATFORM_EXPORT_PROFILES.length');
			expect(verticalPage).toContain('Import from {platformProfileCount} recognized platform');
			expect(verticalPage).toContain('CSV exports or generic CSV');
			expect(verticalPage).not.toContain(
				'Import your list from Action Network, EveryAction, NationBuilder'
			);
		}
		expect(localGovernmentPage).toContain('undifferentiated');
		expect(localGovernmentPage).toContain('campaign-platform blasts');
		expect(localGovernmentPage).not.toContain('four hundred Action Network blasts');
		expect(migratePage).toContain("from '$lib/data/platform-export-profiles'");
		expect(migratePage).toContain('const platformProfileCount = PLATFORM_EXPORT_PROFILES.length');
		expect(migratePage).toContain('const platformExamples = PLATFORM_EXPORT_PROFILES.map');
		expect(migratePage).toContain('Direct platform sync remains gated');
		expect(migratePage).toContain('Not armed until custody and sync-proof gates pass');
		expect(migratePage).not.toContain('Action Network API key');
		expect(migratePage).not.toContain('Action Network sync is read-only');
		expect(migratePage).not.toContain('Not on Action Network?');
		expect(peopleImportServer).toContain("from '$lib/data/platform-export-profiles'");
		expect(peopleImportServer).toContain('PEOPLE_IMPORT_FIELD_ALIASES,');
		expect(peopleImportServer).toContain(
			'const detectedPlatform = detectPlatformExportProfile(headers)'
		);
		expect(peopleImportServer).toContain('normalizePlatformExportHeader(headers[i])');
		expect(peopleImportServer).toContain('PEOPLE_IMPORT_FIELD_ALIASES[normalized]');
		expect(peopleImportServer).not.toContain('const COLUMN_MAP');
		expect(peopleImportServer).toContain('source: mapped.source');
		expect(peopleImportServer).toContain(
			"source: detectedPlatform?.label ?? 'CSV / unknown export'"
		);
		expect(platformProfiles).toContain('export const PLATFORM_EXPORT_PROFILES');
		expect(platformProfiles).toContain('export const PEOPLE_IMPORT_FIELD_ALIASES');
		expect(platformProfiles).toContain("'donor email': 'email'");
		expect(platformProfiles).toContain("'activist codes': 'tags'");
		expect(platformProfiles).toContain("'email marketing status': 'can_message'");
		expect(platformProfiles).toContain("'mobile phone number': 'phone'");
		expect(platformProfiles).toContain("source: 'everyaction'");
		expect(platformProfiles).toContain("source: 'nationbuilder'");
		expect(platformProfiles).toContain("source: 'mailchimp'");
		expect(platformProfiles).toContain("source: 'salsa'");
		expect(platformProfiles).toContain("source: 'mobilize'");
		expect(platformProfiles).toContain("source: 'actblue'");
		expect(platformProfiles).toContain("source: 'engaging_networks'");
		expect(platformProfiles).toContain("source: 'civicrm'");
		expect(platformProfiles).toContain("source: 'salesforce'");
		expect(platformProfiles).toContain("label: 'Action Network'");
		expect(platformProfiles).toContain("label: 'EveryAction / NGP VAN'");
		expect(platformProfiles).toContain("label: 'NationBuilder'");
		expect(platformProfiles).toContain("label: 'Mailchimp'");
		expect(platformProfiles).toContain("label: 'Salsa Engage'");
		expect(platformProfiles).toContain("label: 'Mobilize'");
		expect(platformProfiles).toContain("label: 'ActBlue'");
		expect(platformProfiles).toContain("label: 'Engaging Networks'");
		expect(platformProfiles).toContain("label: 'CiviCRM'");
		expect(platformProfiles).toContain("label: 'Salesforce / Nonprofit Cloud'");
		expect(platformProfiles).toContain('requiredAnyHeaders');
		expect(supportersConvex).toContain("source: s.source ?? 'csv'");
		expect(supportersConvex).toContain('SOURCE_TOO_LARGE');
		for (const sourceText of [supportersApi]) {
			expect(sourceText).toContain("'everyaction'");
			expect(sourceText).toContain("'nationbuilder'");
			expect(sourceText).toContain("'mailchimp'");
			expect(sourceText).toContain("'salsa'");
			expect(sourceText).toContain("'mobilize'");
			expect(sourceText).toContain("'actblue'");
			expect(sourceText).toContain("'engaging_networks'");
			expect(sourceText).toContain("'civicrm'");
			expect(sourceText).toContain("'salesforce'");
		}
		expect(supportersListServer).toContain('source.length <= 50');
		expect(supportersListServer).not.toContain("'everyaction'");
		expect(supportersListServer).not.toContain("'salesforce'");
		expect(platformProfiles).toContain('export const PEOPLE_SOURCE_FILTER_OPTIONS');
		expect(platformProfiles).toContain('export const PEOPLE_SOURCE_SEGMENT_OPTIONS');
		expect(platformProfiles).toContain('export function formatPeopleSourceLabel');
		expect(platformProfiles).toContain("{ value: 'api', label: 'Public API' }");
		expect(platformProfiles).toContain("{ value: 'unknown', label: 'Unknown source' }");
		expect(segmentTypes).toContain('PEOPLE_SOURCE_SEGMENT_OPTIONS');
		expect(supportersPage).toContain('PEOPLE_SOURCE_FILTER_OPTIONS');
		expect(supportersPage).toContain("formatPeopleSourceLabel(source ?? 'unknown'");
		expect(supportersPage).toContain('buildSourceFilterOptions');
		expect(supporterDetail).toContain("formatPeopleSourceLabel(s ?? 'unknown'");
		expect(supportersPage).not.toContain("case 'action_network':");
		expect(supportersPage).not.toContain("case 'everyaction':");
		expect(supporterDetail).not.toContain("case 'action_network':");
		expect(supporterDetail).not.toContain("case 'everyaction':");
		expect(supportersPage).not.toContain("return 'AN'");
		expect(supportersPage).not.toContain("return 'EA'");
		expect(supportersPage).not.toContain("return 'NB'");
		expect(supportersPage).not.toContain("return 'MC'");

		expect(workflows).toContain('buildCoordinationReadiness,');
		expect(workflows).toContain('type CoordinationReadinessRow');
		expect(workflows).toContain(
			"const workflowEffectsGate = getGateEvidence('CP-workflow-effects', ['T1-9a']"
		);
		expect(workflows).toContain(
			"const workflowRunEvidenceGate = getGateEvidence('CP-coordination-integrity'"
		);
		expect(workflows).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
		expect(workflows).toContain('const triggerFamilyCount = $derived');
		expect(workflows).toContain('const emailStepCount = $derived');
		expect(workflows).toContain('const tagStepCount = $derived');
		expect(workflows).toContain('const conditionStepCount = $derived');
		expect(workflows).toContain('const coordinationReadiness = $derived(');
		expect(workflows).toContain('buildCoordinationReadiness({');
		expect(workflows).toContain('executionEnabled: FEATURES.WORKFLOW_EXECUTION');
		expect(workflows).toContain('emailStepCount,');
		expect(workflows).toContain('tagStepCount,');
		expect(workflows).toContain('conditionStepCount,');
		expect(workflows).toContain('emailProxyGate');
		expect(workflows).toContain(
			'const coordinationRows = $derived<CoordinationReadinessRow[]>(coordinationReadiness.rows)'
		);
		expect(workflows).toContain('coordinationRows.map((row) => ({');
		expect(workflows).toContain('cluster: row.clusters');
		expect(workflows).toContain('detail: row.ground');
		expect(workflows).toContain('unlock: row.boundary');
		expect(workflows).toContain('{coordinationReadiness.effect}');
		expect(workflows).not.toContain('formatGateEvidence(workflowEffectsGate');
		expect(workflows).not.toContain("cluster: 'agentic systems'");
		expect(workflows).not.toContain("cluster: 'reach'");
		expect(workflowsServer).toContain('function stepTypeCounts');
		expect(workflowsServer).toContain("if (type === 'send_email') counts.emailStepCount += 1");
		expect(workflowsServer).toContain(
			"if (type === 'add_tag' || type === 'remove_tag') counts.tagStepCount += 1"
		);
		expect(workflowsServer).toContain("if (type === 'condition') counts.conditionStepCount += 1");
		expect(workflowsServer).toContain('emailStepCount: stepCounts.emailStepCount');
		expect(workflowsServer).toContain('tagStepCount: stepCounts.tagStepCount');
		expect(workflowsServer).toContain('conditionStepCount: stepCounts.conditionStepCount');
		for (const workflowServer of [workflowsServer, workflowNewServer, workflowDetailServer]) {
			expect(workflowServer).toContain('getWorkflowEmailRuntimeReadinessFromEnv');
			expect(workflowServer).toContain('api.organizations.getOrgKeyVerifier');
			expect(workflowServer).toContain('workflowEmailReadiness');
			expect(workflowServer).toContain('orgKeyConfigured: Boolean(orgKeyVerifier?.orgKeyVerifier)');
		}
		expect(workflowNew).toContain('buildCoordinationReadiness,');
		expect(workflowNew).toContain('type CoordinationReadinessRow');
		expect(workflowNew).toContain('getGateEvidence');
		expect(workflowNew).toContain(
			"const workflowEffectsGate = getGateEvidence('CP-workflow-effects', ['T1-9a']"
		);
		expect(workflowNew).toContain(
			"const workflowRunEvidenceGate = getGateEvidence('CP-coordination-integrity'"
		);
		expect(workflowNew).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
		expect(workflowNew).toContain('const coordinationReadiness = $derived(');
		expect(workflowNew).toContain('buildCoordinationReadiness({');
		expect(workflowNew).toContain('definitionCount: name.trim() ? 1 : 0');
		expect(workflowNew).toContain('enabledCount: 0');
		expect(workflowNew).toContain('triggerFamilyCount: workflowTriggerDispatch ? 1 : 0');
		expect(workflowNew).toContain('plannedStepCount: steps.length');
		expect(workflowNew).toContain('emailStepCount,');
		expect(workflowNew).toContain('tagStepCount: tagWriteStepCount');
		expect(workflowNew).toContain('conditionStepCount,');
		expect(workflowNew).toContain('runEvidenceCount: 0');
		expect(workflowNew).toContain(
			'const coordinationRows = $derived<CoordinationReadinessRow[]>'
		);
		expect(workflowNew).toContain('coordinationReadiness.rows.map((row) => ({');
		expect(workflowNew).toContain("row.id === 'coordination-definitions'");
		expect(workflowNew).toContain("row.id === 'trigger-dispatch-contracts'");
		expect(workflowNew).toContain("row.id === 'step-grammar'");
		expect(workflowNew).toContain("row.id === 'side-effect-runner'");
		expect(workflowNew).toContain("row.id === 'run-evidence'");
		expect(workflowNew).toContain('coordinationRows.map((row) => ({');
		expect(workflowNew).toContain('cluster: row.clusters');
		expect(workflowNew).toContain('detail: row.ground');
		expect(workflowNew).toContain('unlock: row.boundary');
		expect(workflowNew).not.toContain("action: 'read boundary'");
		expect(workflowNew).not.toContain('formatGateEvidence(workflowEffectsGate');
		expect(workflowNew).not.toContain("cluster: 'coordination integrity'");
		expect(workflowNew).not.toContain("cluster: 'agentic systems'");
		expect(workflowNew).not.toContain("cluster: 'reach'");
		expect(workflowNew).not.toContain("cluster: 'accountability'");

		expect(workflowDetail).toContain('buildCoordinationReadiness,');
		expect(workflowDetail).toContain('type CoordinationReadinessRow');
		expect(workflowDetail).toContain('getGateEvidence');
		expect(workflowDetail).toContain(
			"const workflowEffectsGate = getGateEvidence('CP-workflow-effects', ['T1-9a']"
		);
		expect(workflowDetail).toContain(
			"const workflowRunEvidenceGate = getGateEvidence('CP-coordination-integrity'"
		);
		expect(workflowDetail).toContain("const emailProxyGate = getGateEvidence('CP-2', ['T2-2']");
		expect(workflowDetail).toContain('const coordinationReadiness = $derived(');
		expect(workflowDetail).toContain('buildCoordinationReadiness({');
		expect(workflowDetail).toContain('definitionCount: 1');
		expect(workflowDetail).toContain('enabledCount: data.workflow.enabled ? 1 : 0');
		expect(workflowDetail).toContain('plannedStepCount: data.workflow.steps.length');
		expect(workflowDetail).toContain('runEvidenceCount: data.workflow.totalExecutions');
		expect(workflowDetail).toContain(
			'const coordinationRows = $derived<CoordinationReadinessRow[]>'
		);
		expect(workflowDetail).toContain('coordinationReadiness.rows.map((row) => ({');
		expect(workflowDetail).toContain("row.id === 'coordination-definitions'");
		expect(workflowDetail).toContain("row.id === 'trigger-dispatch-contracts'");
		expect(workflowDetail).toContain("row.id === 'step-grammar'");
		expect(workflowDetail).toContain("row.id === 'side-effect-runner'");
		expect(workflowDetail).toContain("row.id === 'run-evidence'");
		expect(workflowDetail).toContain('coordinationRows.map((row) => ({');
		expect(workflowDetail).toContain('label: row.label');
		expect(workflowDetail).toContain('cluster: row.clusters');
		expect(workflowDetail).toContain('detail: row.ground');
		expect(workflowDetail).toContain('unlock: row.boundary');
		expect(workflowDetail).not.toContain('formatGateEvidence(workflowEffectsGate');
		expect(workflowDetail).not.toContain('formatGateEvidence(workflowRunEvidenceGate');
		expect(workflowDetail).not.toContain("cluster: 'coordination integrity'");
		expect(workflowDetail).not.toContain("cluster: 'agentic systems'");
		expect(workflowDetail).not.toContain("cluster: 'reach'");
		expect(workflowDetail).not.toContain("cluster: 'accountability'");
		expect(workflowDetail).not.toContain("action: 'read boundary'");
		for (const workflowSurface of [workflows, workflowNew, workflowDetail]) {
			expect(workflowSurface).toContain('type CoordinationPressureReadout = {');
			expect(workflowSurface).toContain('operatorCapabilityActionLabel');
			expect(workflowSurface).toContain('operatorCapabilityStateLabel');
			expect(workflowSurface).toContain('const definitionCoordinationRow = $derived');
			expect(workflowSurface).toContain('const sideEffectCoordinationRow = $derived');
			expect(workflowSurface).toContain('const runEvidenceCoordinationRow = $derived');
			expect(workflowSurface).toContain('const heldCoordinationRows = $derived');
			expect(workflowSurface).toContain('const firstHeldCoordinationRow = $derived');
			expect(workflowSurface).toContain('const nextRunLiftCoordinationRow = $derived');
			expect(workflowSurface).toContain(
				'const coordinationPressureReadouts = $derived<CoordinationPressureReadout[]>(['
			);
			expect(workflowSurface).toContain("id: 'definition-ground'");
			expect(workflowSurface).toContain("label: 'Definition ground'");
			expect(workflowSurface).toContain("id: 'side-effect-runner'");
			expect(workflowSurface).toContain("label: 'Side-effect runner'");
			expect(workflowSurface).toContain("id: 'next-run-lift'");
			expect(workflowSurface).toContain("label: 'Next run lift'");
			expect(workflowSurface).toContain('sideEffectCoordinationRow?.boundary');
			expect(workflowSurface).toContain('nextRunLiftCoordinationRow?.boundary');
			expect(workflowSurface).toContain(
				'Definitions are preserved; side effects stay dependency-first until the runner clears.'
			);
			expect(workflowSurface).toContain(
				'Run evidence, workflow email dependencies, and scheduled side effects stay separate.'
			);
			expect(workflowSurface).toContain(
				'return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });'
			);
			expect(workflowSurface).toContain('function pressureCellClass(state: CapabilityState): string');
			expect(workflowSurface).toContain('aria-label="Coordination readiness pressure"');
			expect(workflowSurface).toContain(
				'{#each coordinationPressureReadouts as readout (readout.id)}'
			);
			expect(workflowSurface).toContain('actionLabel(readout.state, readout.action)');
			expect(workflowSurface).toContain(
				'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
			);
			expect(workflowSurface).toContain('WorkflowEmailDependencyPanel');
			expect(workflowSurface).toContain('readiness={data.workflowEmailReadiness}');
		}
		expect(workflows).toContain('cite="workflows.list steps.type.send_email"');
		expect(workflowNew).toContain('cite="draft steps.type.send_email"');
		expect(workflowDetail).toContain('cite="workflow.steps.type.send_email"');
		expect(workflowEmailDependencyPanel).toContain('Workflow email dependency boundary');
		expect(workflowEmailDependencyPanel).toContain('workflow_email_dependency_missing');
		expect(workflowEmailDependencyPanel).toContain('Arm-time dependency');
		expect(workflowEmailDependencyPanel).toContain('Missing now');
		expect(workflowEmailDependencyPanel).toContain('Per-run checks');
		expect(workflowEmailDependencyPanel).toContain('readiness.missing.join');
		expect(workflowEmailDependencyPanel).toContain('readiness.perRunDependencies.join');
		expect(workflows).toContain(
			"href: sideEffectCoordinationRow?.href ?? '#workflow-execution-boundary'"
		);
		expect(workflowNew).toContain("href: sideEffectCoordinationRow?.href ?? '#coordination-execution'");
		expect(workflowDetail).toContain(
			"href: sideEffectCoordinationRow?.href ?? '#coordination-execution-status'"
		);
		expect(workflowDetail).toContain("href: nextRunLiftCoordinationRow?.href ?? '#coordination-run-log'");
		expect(hypergraph).toContain("label: 'Coordination definitions'");
		expect(hypergraph).toContain("label: 'Trigger dispatch contracts'");
		expect(hypergraph).toContain("label: 'Step grammar'");
		expect(hypergraph).toContain("label: 'Side-effect runner'");
		expect(hypergraph).toContain("label: 'Run evidence'");
		expect(hypergraph).toContain(
			"action: runnerState === 'partial' ? 'read runner posture' : 'read execution boundary'"
		);
		expect(workflowApi).toContain("error: 'workflow_email_dependency_missing'");
		expect(workflowApi).toContain("blockedVerb: 'enable_workflow_email'");
		expect(workflowApi).toContain("preservedArtifact: 'workflow_definition'");
		expect(workflowApi).toContain('definitionSaved,');
		expect(workflowApi).toContain("gate: 'CP-workflow-email'");
		expect(workflowApi).toContain("taskIds: ['T1-9']");
		expect(workflowApi).toContain('getWorkflowEmailRuntimeReadiness');
		expect(workflowApi).toContain('api.organizations.getOrgKeyVerifier');
		expect(workflowApi).toContain('missing: readiness.missing');
		expect(workflowApi).toContain('perRunDependencies: readiness.perRunDependencies');
		expect(workflowApi).toContain('function hasEmailStep(steps: unknown): boolean');
		expect(workflowApi).toContain('return workflowEmailDependencyBoundary(hasDefinitionPatch, readiness);');
		expect(workflowApi).toContain('const hasDefinitionPatch =');
		expect(workflowApi).toContain('if (hasDefinitionPatch) {');
		expect(automationProcess).toContain('serverAction(api.workflows.processScheduledNow');
		expect(automationProcess).toContain('_secret: getInternalSecret()');
		expect(automationProcess).toContain("runner: 'workflow_scheduled_resume'");
		expect(automationProcess).toContain(
			"effect: 'paused executions with elapsed delays were queued for resume'"
		);
		expect(automationProcess).toContain("error: 'workflow_execution_not_armed'");
		expect(automationProcess).toContain("blockedVerb: 'process_workflow_schedule'");
		expect(automationProcess).toContain("gate: 'CP-workflow-effects'");
		expect(automationProcess).toContain("taskIds: ['T1-9a']");
		expect(automationProcess).toContain('{ status: 424 }');
		expect(automationProcess).not.toContain('{ status: 501 }');
		expect(automationProcess).not.toContain('scheduled processing and email delivery are not armed');
		expect(canonicalDoc).toContain('typed `workflow_execution_not_armed`');
		expect(canonicalDoc).toContain('rather than a 501 stub');
		expect(capabilityScope).toContain('not a 501 stub');
		expect(workflows).toContain('const enabledFlagCount = $derived');
		expect(workflows).not.toContain('armedFlagCount');
		expect(workflows).toContain('const workflowRunnerArmed = $derived');
		expect(workflows).toContain("workflowEffectsGate.state === 'live'");
		expect(workflows).toContain('Definitions can be saved, enabled, and triggered.');
		expect(workflows).toContain('bounded execution is available after save when the runner gate is');
		expect(workflows).not.toContain('Definitions can be saved, armed, and triggered.');
		expect(workflows).not.toContain('bounded arming is available after save');
		expect(workflowCard).toContain("return FEATURES.WORKFLOW_EXECUTION ? 'runner enabled' : 'enabled draft'");
		expect(workflowCard).not.toContain('armed flag, no worker');
		expect(workflowCard).not.toContain("{workflow.enabled ? 'armed' : 'draft'}");
		expect(workflowDetail).toContain('const workflowRunnerArmed = $derived');
		expect(workflowDetail).toContain('const workflowStatusLabel = $derived');
		expect(workflowDetail).toContain('const workflowToggleLabel = $derived');
		expect(workflowDetail).toContain('const partialNoOpRunCount = $derived');
		expect(workflowDetail).toContain(
			"data.executions.filter((execution) => execution.status === 'partial_no_op').length"
		);
		expect(workflowDetail).toContain("'runner enabled' : 'enabled draft'");
		expect(workflowDetail).toContain("data.workflow.enabled ? 'Disable'");
		expect(workflowDetail).not.toContain("{data.workflow.enabled ? 'Disarm' : 'Arm'}");
		expect(workflowDetail).not.toContain("{data.workflow.enabled ? 'armed' : 'draft'}");
		expect(workflowDetail).toContain('Bounded coordination runner is armed');
		expect(workflowDetail).toContain('org-key verifier');
		expect(workflowDetail).toContain('email run then requires a supporter cursor');
		expect(workflowDetail).toContain('aria-label="Unsupported step boundary"');
		expect(workflowDetail).toContain(
			'<Datum value={partialNoOpRunCount} cite="workflowExecutions.status.partial_no_op" />'
		);
		expect(workflowDetail).toContain('partial no-op runs');
		expect(workflowDetail).toContain('not clean coordination completion');
		expect(workflowDetailServer).toContain('const PARTIAL_NO_OP_BOUNDARY');
		expect(workflowDetailServer).toContain("status === 'partial_no_op' ? PARTIAL_NO_OP_BOUNDARY : null");
		expect(workflowDetailServer).toContain(
			'Unsupported legacy step was audited as a no-op; this run is not clean completion evidence.'
		);
		expect(executionTable).toContain("partial_no_op: 'bg-amber-500/15 text-amber-300'");
		expect(executionTable).toContain('function executionBoundary(exec: Execution): string | null');
		expect(executionTable).toContain('function executionBoundaryClass(exec: Execution): string');
		expect(executionTable).toContain("'partial no-op: unsupported step boundary'");
		expect(executionTable).toContain('not clean coordination evidence');
		expect(workflows).toContain('Workflow email stays dependency-first behind SES');
		expect(workflowNew).toContain('Bounded runner available after save');
		expect(workflowNew).toContain('Saved definitions start unarmed.');
		expect(workflowNew).toContain('This preserves a draft-only definition.');
		expect(workflowNew).not.toContain('This saves a disabled definition.');
		expect(workflowNew).not.toContain('This saves a disabled draft.');
		expect(workflowNew).toContain('arming requires SES credentials');
		expect(workflowNew).toContain('configured workflow/from');
		expect(workflowNew).toContain('address, and org-key verifier');
		expect(workflowNew).toContain('each email run still requires a supporter cursor');
		expect(workflowNew).toContain('Workflow email');
		expect(workflowNew).toContain('stays dependency-first behind SES');
		expect(hypergraph).toContain(
			'Trigger clauses remain saved context until the execution gate and scheduled processor are armed.'
		);
		expect(workflowDetail).toContain('stay preserved contracts');
		expect(hypergraph).toContain(
			'Non-email workflow side effects stay dependency-first; workflow email stays represented by the email proxy/runtime dependency boundary.'
		);
		expect(hypergraph).toContain(
			'Scheduled processing and side effects stay dependency-first until the bounded runner gate opens.'
		);
		expect(hypergraph).toContain(
			'Coordination definitions can be shaped; side effects stay dependency-first until the bounded runner gate opens.'
		);
		expect(workflowApi).not.toContain(
			'Definitions can be saved, but triggers, branch evaluation, and side effects will not run yet.'
		);

		for (const sourceText of [
			fundraisingIndex,
			fundraisingNew,
			platformApiBoundary,
			workflows,
			workflowNew,
			workflowDetail
		]) {
			expect(sourceText).not.toContain('No gate for fundraiser records');
			expect(sourceText).not.toContain('T6-1/T6-2 anchor receipt batches');
			expect(sourceText).not.toContain('T6-1/T6-2 anchor accountability receipt batches');
			expect(sourceText).not.toContain('SES receipt config and org-key decrypt');
			expect(sourceText).not.toContain('NEW-T1-3 Action Network OSDI sync');
			expect(sourceText).not.toContain('NEW-T1-3 paginated OSDI client');
			expect(sourceText).not.toContain('NEW-T1-3 replaces placeholder state');
			expect(sourceText).not.toContain('NEW-T2-2 delivery worker boundary');
			expect(sourceText).not.toContain('FEATURES.WORKFLOW_EXECUTION plus');
			expect(sourceText).not.toContain('FEATURES.WORKFLOW_EXECUTION and workflow worker');
			expect(sourceText).not.toContain('Coordination execution worker and action-log settlement');
			expect(sourceText).not.toContain('implemented behind SES');
			expect(sourceText).not.toContain('Visible arming remains gated');
			expect(sourceText).not.toContain('workflow execution is disabled');
			expect(sourceText).not.toContain('visible arming is disabled');
			expect(sourceText).not.toContain('side effects stay gated');
			expect(sourceText).not.toContain('dependency-free workflow email');
			expect(sourceText).not.toContain("cluster: 'Coordination integrity'");
			expect(sourceText).not.toContain("cluster: 'Reader-side UX'");
			expect(sourceText).not.toContain("cluster: 'Data sovereignty'");
			expect(sourceText).not.toContain("cluster: 'Composability'");
			expect(sourceText).not.toContain("cluster: 'Agentic systems'");
			expect(sourceText).not.toContain("cluster: 'Reach'");
			expect(sourceText).not.toContain("cluster: 'Accountability'");
		}
		expect(canonicalDoc).toContain(
			'Fundraising index/create/detail, platform intake, workflow index/builder/detail, and coalition index/create/detail strips use the same adapter-backed gate summaries'
		);
		expect(canonicalDoc).toContain('bounded runner armed, email dependency-bound');
		expect(canonicalDoc).toContain('typed `workflow_email_dependency_missing`');
		expect(canonicalDoc).toContain(
			'stay preserved contracts until the bounded runner gate opens'
		);
		expect(canonicalDoc).toContain(
			'The workflow index, builder, and detail routes now open with **Coordination readiness pressure** cells for Definition ground, Side-effect runner, and Next run lift'
		);
		expect(canonicalDoc).toContain('Workflow detail run logs count `partial_no_op` executions');
		expect(canonicalDoc).toContain('not clean coordination completion');
		expect(capabilityScope).toContain(
			'workflow email remains dependency-bound through the email proxy/runtime boundary'
		);
		expect(capabilityScope).toContain(
			'They now open with **Coordination readiness pressure** cells for Definition ground, Side-effect runner, and Next run lift'
		);
		expect(capabilityScope).toContain(
			'workflow detail run logs surface `partial_no_op` rows as unsupported-step boundary evidence'
		);
	});

	it('keeps event and fundraiser detail route strips dependency-backed and operator-facing', () => {
		const eventsIndex = source('src/routes/org/[slug]/events/+page.svelte');
		const eventNew = source('src/routes/org/[slug]/events/new/+page.svelte');
		const eventDetail = source('src/routes/org/[slug]/events/[id]/+page.svelte');
		const fundraiserDetail = source('src/routes/org/[slug]/fundraising/[id]/+page.svelte');
		const platformApiBoundary = source(
			'src/routes/org/[slug]/supporters/import/platform-api/+page.svelte'
		);
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const studioSpace = source('src/lib/components/org/os/StudioSpace.svelte');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(hypergraph).toContain('export type EventReadinessRowKey =');
		expect(hypergraph).toContain('export function buildEventReadiness');
		expect(hypergraph).toContain("id: 'event-record'");
		expect(hypergraph).toContain("id: 'public-rsvp-intake'");
		expect(hypergraph).toContain("id: 'waitlist-roster'");
		expect(hypergraph).toContain("id: 'checkin-attendance-signal'");
		expect(hypergraph).toContain("id: 'calendar-roster-artifacts'");
		expect(hypergraph).toContain("label: 'Public RSVP intake'");
		expect(hypergraph).toContain("label: 'Waitlist roster'");
		expect(hypergraph).toContain("label: 'Check-in attendance signal'");
		expect(hypergraph).toContain("label: 'Calendar and roster artifacts'");
		expect(hypergraph).toContain(
			'Event readiness separates saved event records, public RSVP intake, waitlist storage'
		);
		expect(hypergraph).toContain(
			'Keep promotion dependency-first until event-triggered workflow side effects can promote the next row.'
		);
		expect(hypergraph).toContain(
			'Keep export claims bounded to ICS and non-PII CSV until archived artifact proof lands.'
		);
		for (const sourceText of [eventsIndex, eventNew, eventDetail]) {
			expect(sourceText).toContain('buildEventReadiness');
			expect(sourceText).toContain('getGateEvidence');
			expect(sourceText).toContain('const eventReadiness = $derived(');
			expect(sourceText).toContain('buildEventReadiness({');
			expect(sourceText).toContain('eventReadiness.rows.map((row) => ({');
			expect(sourceText).toContain('label: row.label');
			expect(sourceText).toContain('state: row.state');
			expect(sourceText).toContain('phase: row.phase');
			expect(sourceText).toContain('cluster: row.clusters');
			expect(sourceText).toContain('detail: row.ground');
			expect(sourceText).toContain('unlock: row.boundary');
			expect(sourceText).toContain(
				"const eventRecordGate = getGateEvidence('CP-outbound-webhooks'"
			);
			expect(sourceText).toContain(
				"const attendanceProofGate = getGateEvidence('CP-mainnet-deployment'"
			);
			expect(sourceText).toContain(
				"const eventArtifactGate = getGateEvidence('CP-receipt-anchoring'"
			);
			expect(sourceText).toContain(
				"const eventWaitlistGate = getGateEvidence('CP-event-waitlist-automation', ['T1-9', 'T9-3']"
			);
			expect(sourceText).not.toContain('formatGateEvidence(eventRecordGate');
			expect(sourceText).not.toContain('formatGateEvidence(attendanceProofGate');
			expect(sourceText).not.toContain('formatGateEvidence(eventArtifactGate');
			expect(sourceText).not.toContain("cluster: 'coordination integrity'");
			expect(sourceText).not.toContain("cluster: 'reader-side UX'");
			expect(sourceText).not.toContain("cluster: 'verification'");
			expect(sourceText).not.toContain("cluster: 'data sovereignty'");
			expect(sourceText).not.toContain("type CapabilityState = 'live' | 'partial'");
			expect(sourceText).not.toContain('type CapabilityItem = {');
			expect(sourceText).not.toContain('No gate for event records');
			expect(sourceText).not.toContain('No gate for record inspection');
			expect(sourceText).not.toContain('remain scope gaps in ORG-CAPABILITY-SCOPE');
			expect(sourceText).not.toContain(
				'QR image generation plus end-to-end attendance proof ceremony remain future work'
			);
			expect(sourceText).not.toContain("cluster: 'Coordination integrity'");
			expect(sourceText).not.toContain("cluster: 'Reader-side UX'");
			expect(sourceText).not.toContain("cluster: 'Verification'");
			expect(sourceText).not.toContain("cluster: 'Data sovereignty'");
		}
			for (const sourceText of [eventsIndex, eventNew, eventDetail]) {
				expect(sourceText).toContain('type EventPressureReadout = {');
				expect(sourceText).toContain('operatorCapabilityActionLabel,');
				expect(sourceText).toContain('operatorCapabilityStateLabel');
			expect(sourceText).toContain('type CapabilityState');
			expect(sourceText).toContain('const eventRecordRow = $derived');
			expect(sourceText).toContain('const publicRsvpRow = $derived');
			expect(sourceText).toContain('const heldEventRows = $derived');
			expect(sourceText).toContain('const nextEventLiftRow = $derived');
			expect(sourceText).toContain('const eventPressureReadouts = $derived<EventPressureReadout[]>([');
			expect(sourceText).toContain("id: 'record-ground'");
			expect(sourceText).toContain("id: 'rsvp-intake'");
			expect(sourceText).toContain("id: 'next-event-lift'");
			expect(sourceText).toContain("label: 'Record ground'");
			expect(sourceText).toContain("label: 'RSVP intake'");
			expect(sourceText).toContain("label: 'Next event lift'");
			expect(sourceText).toContain('eventRecordRow?.ground');
			expect(sourceText).toContain('publicRsvpRow?.ground');
			expect(sourceText).toContain('nextEventLiftRow?.boundary');
			expect(sourceText).toContain('return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });');
			expect(sourceText).toContain('function pressureCellClass(state: CapabilityState): string');
			expect(sourceText).toContain('aria-label="Event operating pressure"');
			expect(sourceText).toContain('{#each eventPressureReadouts as readout (readout.id)}');
			expect(sourceText).toContain('class={pressureCellClass(readout.state)}');
			expect(sourceText).toContain('<Datum value={readout.metric.value} cite={readout.metric.cite} />');
			expect(sourceText).toContain('{actionLabel(readout.state, readout.action)}');
		}
		expect(eventsIndex).toContain('const waitlistEnabledCount = $derived(');
		expect(eventsIndex).toContain('waitlistEnabledCount,');
		expect(eventNew).toContain('waitlistEnabled,');
		expect(eventNew).toContain('waitlistEnabledCount: waitlistEnabled ? 1 : 0');
		expect(eventDetail).toContain('waitlistEnabled: data.event.waitlistEnabled');
		expect(eventDetail).toContain('waitlistEnabledCount: data.event.waitlistEnabled ? 1 : 0');
		expect(eventNew).toContain("'waitlist-roster': '#event-waitlist-boundary'");
		expect(eventNew).toContain('id="event-waitlist-boundary"');
		expect(eventNew).toContain(
			'Waitlisted rows can be stored after save; promotion remains dependency-first.'
		);
		expect(eventNew).not.toContain('auto-promotion is not implemented');
		expect(canonicalDoc).toContain('`buildEventReadiness` owns the event-record index');
			expect(canonicalDoc).toContain(
				'Event index/builder/detail strips consume `buildEventReadiness`'
			);
			expect(canonicalDoc).toContain(
				'The event index/builder/detail routes now open with **Event operating pressure**'
			);
			expect(capabilityScope).toContain(
				'Event route strips consume `buildEventReadiness`'
			);
			expect(capabilityScope).toContain(
				'Event index/builder/detail now start with Event operating pressure cells'
			);

		expect(fundraiserDetail).toContain('getGateEvidence');
		expect(fundraiserDetail).toContain('buildFundraisingReadiness,');
		expect(fundraiserDetail).toContain('type FundraisingReadinessRow');
		expect(fundraiserDetail).toContain(
			"const fundraiserRecordGate = getGateEvidence('CP-coordination-integrity'"
		);
		expect(fundraiserDetail).toContain(
			"const donationConfirmationGate = getGateEvidence('CP-donation-confirmation'"
		);
		expect(fundraiserDetail).toContain(
			"const donationReceiptGate = getGateEvidence('CP-donation-receipt-compliance'"
		);
		expect(fundraiserDetail).toContain('const fundraisingRows = $derived<FundraisingReadinessRow[]>');
		expect(fundraiserDetail).toContain('fundraisingRows.map((row) => ({');
		expect(fundraiserDetail).toContain('label: row.label');
		expect(fundraiserDetail).toContain('cluster: row.clusters');
		expect(fundraiserDetail).toContain('detail: row.ground');
		expect(fundraiserDetail).toContain('unlock: row.boundary');
		expect(fundraiserDetail).not.toContain('formatGateEvidence(fundraiserRecordGate');
		expect(fundraiserDetail).not.toContain('formatGateEvidence(donationConfirmationGate');
		expect(fundraiserDetail).not.toContain('formatGateEvidence(donationReceiptGate');
		expect(fundraiserDetail).toContain(
			'const confirmationCompletedCount = $derived(data.confirmationSummary.completed)'
		);
		expect(fundraiserDetail).toContain('const confirmationAttemptedCount = $derived(');
		expect(fundraiserDetail).toContain('const confirmationOutcomeEvidenceObserved = $derived(');
		expect(fundraiserDetail).toContain('Donation receipt boundary evidence');
		expect(fundraiserDetail).toContain(
			'Confirmation outcome counters stay hidden until completed donation rows or provider'
		);
		expect(fundraiserDetail).not.toContain(
			'const confirmationOutcomeState = $derived<CapabilityState>'
		);
		expect(hypergraph).toContain("confirmationCompleted > 0");
		expect(hypergraph).toContain(
			'No completed donation has emitted a confirmation outcome yet; the register stays draft-only.'
		);
		expect(fundraiserDetail).not.toContain("state: 'partial',\n\t\t\tphase: 'AGGREGATE'");
		expect(hypergraph).toContain("clusters: 'C-coordination-integrity'");
		expect(hypergraph).toContain("clusters: 'C-reader-side / C-reach'");
		expect(hypergraph).toContain("clusters: 'C-reader-side / C-data-sovereignty'");
		expect(hypergraph).toContain("clusters: 'C-accountability / C-reader-side'");
		expect(hypergraph).toContain("clusters: 'C-accountability / C-data-sovereignty'");
		expect(fundraiserDetail).not.toContain('No gate for record inspection');
		expect(fundraiserDetail).not.toContain('SES receipt config and org-key decrypt');
		expect(fundraiserDetail).not.toContain('T6-1/T6-2 anchor accountability receipt batches');
		expect(fundraiserDetail).not.toContain("cluster: 'Coordination integrity'");
		expect(fundraiserDetail).not.toContain("cluster: 'Reader-side UX'");
		expect(fundraiserDetail).not.toContain("cluster: 'Data sovereignty'");
		expect(fundraiserDetail).not.toContain("cluster: 'Accountability'");

		expect(hypergraph).toContain('The server can seal a selected platform API credential');
		expect(platformApiBoundary).toContain('platformIntakeStageRows.map((row) => ({');
		expect(platformApiBoundary).toContain('platformApiSyncRuntimeMessage');
		expect(platformApiBoundary).not.toContain('returns 501');
		expect(platformApiBoundary).not.toContain('HTTP 501');

		expect(studioSpace).toContain(
			'Org authority is required; delivery-surface drafts stay read-only for this role.'
		);
		expect(studioSpace).not.toContain(
			'Publish authority required; handoffs stay draft-only for this role.'
		);
		expect(studioSpace).not.toContain('Owner/editor authority required for delivery.');
	});

	it('keeps patch-through call initiation dependency-first until caller-phone decrypt is mounted', () => {
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const callsPage = source('src/routes/org/[slug]/calls/+page.svelte');
		const callsServer = source('src/routes/org/[slug]/calls/+page.server.ts');
		const callReadiness = source('src/lib/server/calls/call-initiation-readiness.ts');
		const callApi = source('src/routes/api/org/[slug]/calls/+server.ts');
		const layoutServer = source('src/routes/org/[slug]/+layout.server.ts');
		const layout = source('src/routes/org/[slug]/+layout.svelte');
		const capabilityMap = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const callRoutingMarkup = section(
			capabilityMap,
			'id="capability-call-routing"',
			'<section class="power-terrain" aria-labelledby="power-terrain-title"'
		);
		const spacesContract = source('src/lib/components/org/os/spaces.ts');
		const callTable = source('src/lib/components/sms/CallLogTable.svelte');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');
		const callRoutingSource = section(
			hypergraph,
			'export function buildCallRoutingReadiness',
			'export function buildPowerTerrainReadiness'
		);

		expect(hypergraph).toContain('export function buildCallRoutingReadiness');
		expect(hypergraph).toContain("label: 'Call record history'");
		expect(hypergraph).toContain("label: 'Caller phone decrypt'");
		expect(hypergraph).toContain("label: 'Twilio call bridge'");
		expect(hypergraph).toContain("label: 'Call scripts and queues'");
		expect(hypergraph).toContain(
			'Twilio transport credentials are present but the bridge is not armed'
		);
		expect(hypergraph).not.toContain('Twilio environment is present but the call proxy is not implemented');
		expect(hypergraph).not.toContain('Twilio environment is present but the bridge is not armed');
		expect(hypergraph).toContain(
			'runtime preflight, and phone-banking workflow without exposing a false connect affordance'
		);
		expect(hypergraph).toContain('initiationRuntimeReady?: boolean | null;');
		expect(hypergraph).toContain('initiationRuntimeMissing?: string[] | null;');
		expect(hypergraph).toContain('cite: \'getCallInitiationReadiness\'');
		expect(callRoutingSource).toContain('call routing not armed');
		expect(callRoutingSource).toContain('featureNotArmedBoundary(');
		expect(callRoutingSource).toContain("'Call routing',");
		expect(callRoutingSource).toContain(
			"'patch-through record, caller-phone custody, and call-initiation claims'"
		);
		expect(callRoutingSource).toContain('unreadGroundBoundary(');
		expect(callRoutingSource).toContain(
			"'record, Twilio bridge, and initiation-posture claims'"
		);
		expect(callRoutingSource).toContain(
			"unreadGroundBoundary('Call records', 'call-history posture claims')"
		);
		for (const staleCallReadinessCopy of [
			'Call routes are disabled; the OS cannot claim patch-through records or call initiation in this build.',
			'Call routing ground is unread; the OS cannot claim record, bridge, or initiation posture.',
			'Call records are unread; the OS cannot claim call history posture.',
			'SMS feature + owner/editor authority + supporter phone lookup + org-key browser decrypt + callerPhone payload + Twilio call proxy + Twilio env',
			'Supporter phone lookup + org-key browser decrypt + Twilio call proxy',
			'Twilio env configured',
			'Twilio call environment is missing',
			'callerPhone payload',
			'call routing off'
		]) {
			expect(callRoutingSource).not.toContain(staleCallReadinessCopy);
		}
		expect(callReadiness).toContain('export function getCallInitiationReadiness');
		expect(callReadiness).toContain('CALL_INITIATION_SURFACE_MOUNTED = false');
		expect(callReadiness).toContain('CALL_INITIATION_PROXY_IMPLEMENTED = true');
		expect(callReadiness).toContain(
			'call authority, supporter phone custody, caller confirmation, mounted connect controls, and Twilio transport credentials'
		);
		expect(callReadiness).not.toContain(
			'SMS feature + owner/editor authority + supporter phone lookup + org-key browser decrypt + callerPhone payload + Twilio call proxy + Twilio env'
		);
		expect(callReadiness).not.toContain('owner/editor call authority');
		expect(callReadiness).not.toContain('callerPhone payload');
		expect(callApi).toContain("import { env as privateEnv } from '$env/dynamic/private';");
		expect(callApi).toContain("error: 'call_initiation_not_armed'");
		expect(callApi).toContain("preservedArtifact: 'call_record_not_created'");
		expect(callApi).toContain('status = 424');
		expect(callApi).toContain('{ status }');
		expect(callApi).not.toContain('status = 501');
		expect(callApi).not.toContain('{ status: 501 }');
		expect(callApi).toContain('getCallInitiationReadiness(callInitiationEnv()');
		expect(callApi).toContain('if (!callReadiness.ready) return callInitiationBoundary(callReadiness);');
		expect(callApi.indexOf('if (!callReadiness.ready)')).toBeLessThan(
			callApi.indexOf('const callResult = await serverMutation(api.calls.createCall')
		);
		expect(callsPage).toContain('WorkspaceCapabilityStrip');
		expect(callsPage).toContain('Call routing capability');
		expect(callsPage).toContain('buildCallRoutingReadiness,');
		expect(callsPage).toContain('type CallRoutingReadinessRow');
		expect(callsPage).toContain('type CallRoutingPressureReadout = {');
		expect(callsPage).toContain('operatorCapabilityActionLabel');
		expect(callsPage).toContain('operatorCapabilityStateLabel');
		expect(callsPage).toContain(
			"const callInitiationGate = getGateEvidence('CP-call-initiation-ui', ['T2-1']"
		);
		expect(callsPage).toContain('const callRoutingReadiness = $derived(');
		expect(callsPage).toContain('buildCallRoutingReadiness({');
		expect(callsPage).toContain('canManageCalls: data.canManageCalls');
		expect(callsPage).toContain('twilioConfigured: data.twilioConfigured');
		expect(callsPage).toContain('initiationRuntimeReady: data.callInitiationRuntimeReady');
		expect(callsPage).toContain('callInitiationRuntimeReady ? \'ready\' : \'held\'');
		expect(callsPage).toContain('campaignCount: data.campaigns.length');
		expect(callsPage).toContain('const callRoutingRows = $derived<CallRoutingReadinessRow[]>');
		expect(callsPage).toContain('const recordHistoryRow = $derived');
		expect(callsPage).toContain('const heldCallRoutingRows = $derived');
		expect(callsPage).toContain('const nextCallLiftRow = $derived');
		expect(callsPage).toContain(
			'const callRoutingPressureReadouts = $derived<CallRoutingPressureReadout[]>(['
		);
		expect(callsPage).toContain("id: 'record-ground'");
		expect(callsPage).toContain("label: 'Record ground'");
		expect(callsPage).toContain("id: 'caller-custody'");
		expect(callsPage).toContain("label: 'Caller custody'");
		expect(callsPage).toContain("id: 'next-call-lift'");
		expect(callsPage).toContain("label: 'Next call lift'");
		expect(callsPage).toContain(
			'Bridge transport, route-local connect controls, scripts, queues, and proof-bearing response artifacts stay separate.'
		);
		expect(callsPage).toContain("cluster: row.clusters");
		expect(callsPage).toContain("unlock: row.boundary");
		expect(callsPage).toContain(
			'return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });'
		);
		expect(callsPage).toContain('function pressureCellClass(state: CapabilityState): string');
		expect(callsPage).toContain('Read call-initiation boundary');
		expect(callsPage).toContain('aria-label="Call routing pressure"');
		expect(callsPage).toContain('{#each callRoutingPressureReadouts as readout (readout.id)}');
		expect(callsPage).toContain('actionLabel(readout.state, readout.action)');
		expect(callsPage).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(callsPage).toContain('Call initiation boundary');
		expect(callsPage).toContain('transport</p>');
		expect(callsPage).not.toContain('formatGateEvidence(');
		expect(callsPage).not.toContain('Read call boundary');
		expect(callsPage).not.toContain('requires <code>callerPhone</code>');
		expect(callsPage).not.toContain('Initiate Call');
		expect(callsPage).not.toContain('Connect Call');
		expect(callsPage).not.toContain('Twilio env');
		expect(callsPage).not.toContain('/supporters?search=');
		expect(callsPage).not.toContain('async function initiateCall');
		expect(hypergraph).toContain("'read call-initiation boundary'");
		expect(hypergraph).not.toContain("'read call boundary'");

		expect(callsServer).toContain("import { env as privateEnv } from '$env/dynamic/private';");
		expect(callsServer).toContain('getCallInitiationReadiness');
		expect(callsServer).toContain('const callInitiationReadiness = getCallInitiationReadiness(');
		expect(callsServer).toContain("membership.role === 'owner' || membership.role === 'editor'");
		expect(callsServer).toContain('twilioConfigured: callInitiationReadiness.twilioConfigured');
		expect(callsServer).toContain('callInitiationRuntimeMissing: callInitiationReadiness.missing');
		expect(callsServer).toContain("supporterName: c.supporter ? 'Encrypted supporter'");
		expect(callsServer).toContain("targetPhone: c.encryptedTargetPhone ? 'Encrypted phone'");
		expect(callsServer).not.toContain("asString(c.supporterName, 'Unknown')");
		expect(callsServer).not.toContain('asString(c.targetPhone)');

		expect(spacesContract).toContain('callRouting: CallRoutingGroundData | null;');
		expect(spacesContract).toContain('export type CallRoutingGroundData = {');
		expect(spacesContract).toContain('callCount: number;');
		expect(spacesContract).toContain('completedCallCount: number;');
		expect(spacesContract).toContain('twilioConfigured: boolean;');
		expect(spacesContract).toContain('canManageCalls: boolean;');
		expect(spacesContract).toContain('initiationRuntimeReady: boolean;');
		expect(spacesContract).toContain('initiationRuntimeMissing: string[];');
		expect(spacesContract).toContain('initiationSurfaceMounted: boolean;');
		expect(layoutServer).toContain("import { env as privateEnv } from '$env/dynamic/private';");
		expect(layoutServer).toContain(
			"import { getCallInitiationReadiness } from '$lib/server/calls/call-initiation-readiness';"
		);
		expect(layoutServer).toContain('serverQuery(api.calls.listCalls, { slug, limit: 200 })');
		expect(layoutServer).toContain('const callInitiationReadiness = getCallInitiationReadiness(');
		expect(layoutServer).toContain('const callRoutingGround: CallRoutingGroundData | null');
		expect(layoutServer).toContain('callCount: callRows.length');
		expect(layoutServer).toContain(
			"completedCallCount: callRows.filter((call) => call.status === 'completed').length"
		);
		expect(layoutServer).toContain('initiationRuntimeReady: callInitiationReadiness.ready');
		expect(layoutServer).toContain('initiationRuntimeDependency: callInitiationReadiness.dependency');
		expect(layoutServer).toContain('callRouting: callRoutingGround');
		expect(layoutServer).not.toContain('encryptedTargetPhone:');
		expect(layoutServer).not.toContain('encryptedPhone:');

		for (const sourceText of [layout, capabilityMap]) {
			expect(sourceText).toContain('buildCallRoutingReadiness,');
			expect(sourceText).toContain(
				"const callInitiationGate = getGateEvidence('CP-call-initiation-ui', ['T2-1']"
			);
			expect(sourceText).toContain(
				'Call authority, phone custody, route-local confirmation, and Twilio transport'
			);
			expect(sourceText).not.toContain(
				'Supporter phone lookup + org-key browser decrypt + Twilio call proxy'
			);
			expect(sourceText).toContain('const callRoutingReadiness = $derived(');
			expect(sourceText).toContain('buildCallRoutingReadiness({');
			expect(sourceText).toContain('loaded: Boolean(callRouting)');
			expect(sourceText).toContain('canManageCalls: callRouting?.canManageCalls ?? false');
			expect(sourceText).toContain('twilioConfigured: callRouting?.twilioConfigured ?? false');
			expect(sourceText).toContain('initiationRuntimeReady: callRouting?.initiationRuntimeReady ?? false');
			expect(sourceText).toContain(
				'initiationRuntimeDependency: callRouting?.initiationRuntimeDependency ?? null'
			);
			expect(sourceText).toContain('callCount: callRouting?.callCount ?? null');
			expect(sourceText).toContain(
				'completedCallCount: callRouting?.completedCallCount ?? null'
			);
			expect(sourceText).toContain('campaignCount: callRouting?.campaignCount ?? null');
		}
		expect(layout).toContain("id: 'capability-call-routing'");
		expect(layout).toContain("label: 'Call routing posture'");
		expect(layout).toContain('href: `${base}/studio#capability-call-routing`');
		expect(layout).toContain('signal: callRoutingReadiness.signal');
		expect(layout).toContain(
			"action: spotlightActionForState(callRoutingReadiness.state, 'read call routing posture')"
		);
		expect(layout).toContain("label: 'Call routing'");
		expect(capabilityMap).toContain('type CallRoutingReadinessRow');
		expect(capabilityMap).toContain('const callRoutingRows = $derived<CallRoutingReadinessRow[]>');
		expect(capabilityMap).toContain('const callRoutingSegments = $derived');
		expect(capabilityMap).toContain('const heldCallRoutingCount = $derived');
		expect(capabilityMap).toContain("title: 'Call routing posture'");
		expect(capabilityMap).toContain('state: callRoutingReadiness.state');
		expect(capabilityMap).toContain('statement: callRoutingReadiness.effect');
		expect(capabilityMap).toContain('evidence: callRoutingReadiness.detail');
		expect(capabilityMap).toContain("name: 'Call routing posture'");
		expect(capabilityMap).toContain(
			"source: 'calls.listCalls + getCallInitiationReadiness + membership role'"
		);
		expect(capabilityMap).toContain("cite: 'buildCallRoutingReadiness'");
		expect(capabilityMap).toContain('...callRoutingRows.map((row) => row.state),');
		expect(capabilityMap).toContain("label: 'Read call routing posture'");
		expect(capabilityMap).toContain('id="capability-call-routing"');
		expect(capabilityMap).toContain('Call routing readiness matrix');
		expect(capabilityMap).toContain('{#each callRoutingRows as row (row.id)}');
		expect(callRoutingMarkup).toContain('class="terrain-count"');
		expect(callRoutingMarkup).toContain('Call routing posture: ${callRoutingRows.length}');
		expect(callRoutingMarkup).toContain('callRoutingStateCounts.live');
		expect(callRoutingMarkup).toContain('callRoutingStateCounts.partial');
		expect(callRoutingMarkup).toContain('heldCallRoutingCount');
		expect(callRoutingMarkup).toContain('class="terrain-count-split"');
		expectTerrainContractCount(callRoutingMarkup, {
			label: 'Call routing',
			rows: 'callRoutingRows',
			stateCounts: 'callRoutingStateCounts',
			cite: 'buildCallRoutingReadiness'
		});
		expect(callRoutingMarkup).not.toContain(
			'A Twilio configuration never implies an armed connect affordance.'
		);
		expect(capabilityMap).not.toContain('Connect call');

		expect(callTable).toContain('PII encrypted at rest');
		expect(callTable).toContain("piiState?: 'encrypted' | 'not-recorded'");
		expect(callTable).not.toContain('No calls yet');

		expect(canonicalDoc).toContain(
			'Call routing is a record surface before it is an execution surface.'
		);
		expect(canonicalDoc).toContain(
			'`buildCallRoutingReadiness` owns that contract for the call page, Capability map, Spotlight, Mantle Substrate rail, operator queue, and claim-basis ledger'
		);
		expect(canonicalDoc).toContain(
			'The call page now opens with **Call routing pressure** cells for Record ground, Caller custody, and Next call lift'
		);
		expect(canonicalDoc).toContain('`OrgSpacesData.operating.callRouting`');
		expect(canonicalDoc).toContain('The Studio map card **Call routing posture**');
		expect(canonicalDoc).toContain(
			'call initiation remains `context / read call-initiation boundary`'
		);
		expect(canonicalDoc).toContain('typed 424 `call_initiation_not_armed`');
		expect(canonicalDoc).toContain('instead of exposing a 501 implementation stub');
		expect(canonicalDoc).not.toContain('call initiation remains `context / read boundary`');
		expect(capabilityScope).toContain('`/org/[slug]/calls` is an honest call-record surface');
		expect(capabilityScope).toContain(
			'`buildCallRoutingReadiness` lifts the same call-initiation boundary'
		);
		expect(capabilityScope).toContain(
			'The call page now starts with **Call routing pressure** cells for Record ground, Caller custody, and Next call lift'
		);
		expect(capabilityScope).toContain('`OrgSpacesData.operating.callRouting`');
		expect(capabilityScope).toContain('**Call routing posture**');
		expect(capabilityScope).toContain(
			'call initiation stays dependency-first behind `read call-initiation boundary`'
		);
		expect(capabilityScope).toContain('typed 424 `call_initiation_not_armed`');
		expect(capabilityScope).toContain('rather than a 501 stub');
	});

	it('keeps folded Power workspace on shared terrain readiness, not local slogans', () => {
		const powerSpace = source('src/lib/components/org/os/LandscapeSpace.svelte');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(powerSpace).toContain('buildPowerTerrainReadiness,');
		expect(powerSpace).toContain('type PowerTerrainRow');
		expect(powerSpace).toContain('const stateLocalTerrainGate = getGateEvidence(');
		expect(powerSpace).toContain("'CP-state-local-terrain'");
		expect(powerSpace).toContain('const internationalTerrainGate = getGateEvidence(');
		expect(powerSpace).toContain("'CP-international-power-terrain'");
		expect(powerSpace).toContain('const stateBillTerrainGate = getGateEvidence');
		expect(powerSpace).toContain("'CP-state-bill-terrain'");
		expect(powerSpace).toContain('const nonFederalScorecardGate = getGateEvidence');
		expect(powerSpace).toContain("'CP-non-federal-scorecards'");
		expect(powerSpace).toContain('const readerOfficeGate = getGateEvidence');
		expect(powerSpace).toContain("'CP-reader-office-profile'");
		expect(powerSpace).toContain('const powerTerrainReadiness = $derived(');
		expect(powerSpace).toContain('buildPowerTerrainReadiness({');
		expect(powerSpace).toContain('discoverableOfficialCount: null');
		expect(powerSpace).toContain(
			'const powerTerrainRows = $derived<PowerTerrainRow[]>(powerTerrainReadiness.rows)'
		);
		expect(powerSpace).toContain('powerTerrainRows.map((row) => ({');
		expect(powerSpace).toContain('cluster: row.clusters');
		expect(powerSpace).toContain('detail: row.ground');
		expect(powerSpace).toContain('unlock: row.boundary');
		expect(powerSpace).toContain('WorkspaceCapabilityStrip label="Power capability"');
		expect(powerSpace).toContain('aria-label="Power terrain boundary"');
		expect(powerSpace).toContain('Power terrain coverage');
		expect(powerSpace).toContain('{powerTerrainReadiness.effect} {powerTerrainReadiness.detail}');
		expect(powerSpace).toContain('terrainCountMetric');
		expect(powerSpace).not.toContain('formatGateEvidence');
		expect(powerSpace).not.toContain('CP-reach-expansion');
		expect(powerSpace).not.toContain("name: 'State and special-district power targets'");
		expect(powerSpace).not.toContain("label: 'Power targets'");
		expect(powerSpace).not.toContain("label: 'Bill monitoring'");
		expect(powerSpace).not.toContain("label: 'Accountability scores'");
		expect(hypergraph).toContain(
			'Federal/current bill terrain is usable; state and local bill lift stays dependency-first.'
		);
		expect(hypergraph).toContain('Treat wider domestic power terrain as dependency-first.');
		expect(hypergraph).toContain(
			'Cross-border representative lookup stays dependency-first.'
		);
		expect(hypergraph).toContain('Reader-office response loops stay dependency-first.');
		expect(hypergraph).toContain(
			'Decision-maker, bill, scorecard, and office-response joins stay dependency-first.'
		);
		expect(hypergraph).not.toContain('state and local bill lift waits on.');
		expect(hypergraph).not.toContain('dependency-first until.');
		expect(hypergraph).not.toContain('lookup stays bounded until.');
		expect(hypergraph).not.toContain('loops stay bounded until.');
		expect(hypergraph).not.toContain('office-response joins wait on.');

		expect(canonicalDoc).toContain(
			'folded Power workspace (`LandscapeSpace`), Jurisdictional reach card'
		);
		expect(canonicalDoc).toContain(
			'The folded Power `WorkspaceCapabilityStrip` projects those shared rows directly'
		);
		expect(canonicalDoc).toContain('folded-space discover counts stay null');
		expect(canonicalDoc).toContain('Bills terrain route, and Spotlight command consume');
		expect(capabilityScope).toContain(
			'The folded Power workspace (`LandscapeSpace`) and `/org/[slug]/representatives` both expose Power terrain through `buildPowerTerrainReadiness`'
		);
		expect(capabilityScope).toContain('leaves discoverable-official count null');
		expect(capabilityScope).toContain('lookupRepresentatives()` now fails closed with `REP_LOOKUP_NOT_CONFIGURED`');
		expect(capabilityScope).not.toContain('lookupRepresentatives()` returns `[]`');
		expect(capabilityScope).not.toContain('folded Power route, Spotlight');
	});

	it('keeps Power target route as bounded terrain, not a legacy representative list', () => {
		const representatives = source('src/routes/org/[slug]/representatives/+page.svelte');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(representatives).toContain('WorkspaceCapabilityStrip');
		expect(representatives).toContain('Power target capability');
		expect(representatives).toContain('buildPowerTerrainReadiness,');
		expect(representatives).toContain('type PowerTerrainRow');
		expect(representatives).toContain('let localFollowed = $state<FollowedDecisionMaker[]>');
		expect(representatives).toContain('followedCountDelta += 1');
		expect(representatives).toContain('localFollowed = localFollowed.filter');
		expect(representatives).toContain('const stateLocalTerrainGate = getGateEvidence');
		expect(representatives).toContain("'CP-state-local-terrain'");
		expect(representatives).toContain('const internationalTerrainGate = getGateEvidence');
		expect(representatives).toContain("'CP-international-power-terrain'");
		expect(representatives).toContain('const stateBillTerrainGate = getGateEvidence');
		expect(representatives).toContain("'CP-state-bill-terrain'");
		expect(representatives).toContain('const nonFederalScorecardGate = getGateEvidence');
		expect(representatives).toContain("'CP-non-federal-scorecards'");
		expect(representatives).toContain('const readerOfficeGate = getGateEvidence');
		expect(representatives).toContain("'CP-reader-office-profile'");
		expect(representatives).toContain(
			'Decision-maker office profile enrichment, office-response workflow, and notification webhooks'
		);
		expect(representatives).not.toContain('staffer dashboard');
		expect(representatives).toContain('const powerTerrainReadiness = $derived(');
		expect(representatives).toContain('buildPowerTerrainReadiness({');
		expect(representatives).toContain('discoverableOfficialCount: discoverCount');
		expect(representatives).toContain(
			'const powerTerrainRows = $derived<PowerTerrainRow[]>(powerTerrainReadiness.rows)'
		);
		expect(representatives).toContain('powerTerrainRows.map((row) => ({');
		expect(representatives).toContain('cluster: row.clusters');
		expect(representatives).toContain('detail: row.ground');
		expect(representatives).toContain('unlock: row.boundary');
		expect(representatives).toContain('{powerTerrainReadiness.effect}');
		expect(representatives).toContain('{powerTerrainReadiness.detail}');
		expect(representatives).toContain(
			'cite="legislation.listOrgDmFollows + legislation.discoverDms"'
		);
		expect(representatives).toContain('id="power-following"');
		expect(representatives).toContain('id="power-discover"');
		expect(representatives).toContain('id="power-reach-boundary"');
		expect(representatives).toContain('Loaded target');
		expect(representatives).toContain('Full multi-jurisdiction terrain is bounded');
		expect(representatives).toMatch(
			/No cross-route\s+decision-maker,\s+bill, and scorecard\s+join is claimed here\./
		);
		expect(representatives).not.toContain("cluster: 'reader-side UX / accountability'");
		expect(representatives).not.toContain("label: 'Followed power targets'");
		expect(representatives).not.toContain('Representative list capability');
		expect(representatives).not.toContain('open in classic');

		expect(canonicalDoc).toContain(
			'**Power targets** derive their local `WorkspaceCapabilityStrip` from `buildPowerTerrainReadiness`'
		);
		expect(canonicalDoc).toContain('route-local `legislation.discoverDms` count');
		expect(canonicalDoc).toContain('decisionMaker/bill/scorecard joins remain bounded');
		expect(capabilityScope).toContain(
			'both expose Power terrain through `buildPowerTerrainReadiness`'
		);
		expect(capabilityScope).toContain('`/org/[slug]/representatives` passes route-local discover counts');
		expect(capabilityScope).toContain('state/local/special-district terrain');
		expect(capabilityScope).toContain('international resolver wiring');
		expect(canonicalDoc).toContain(
			'Non-US decision-maker resolution returns a `COUNTRY_NOT_LIVE` / `REP_LOOKUP_NOT_CONFIGURED` boundary'
		);
	});

	it('keeps Power target detail rows on shared follow, contact, timeline, and office boundaries', () => {
		const stateLocalTerrainGate = getGateEvidence(
			'CP-state-local-terrain',
			['T3-1', 'T3-2', 'T3-10'],
			{
				name: 'State/local power terrain',
				downstream: 3,
				dependency: 'OpenStates, special-district officeholders, and per-district feeds'
			}
		);
		const readerOfficeGate = getGateEvidence(
			'CP-reader-office-profile',
			['T8-1a', 'T8-1b', 'T8-8'],
			{
				name: 'Reader office response terrain',
				downstream: 4,
				dependency:
					'Decision-maker office profile enrichment, office-response workflow, and notification webhooks'
			}
		);
		const receiptAnchoringGate = getGateEvidence(
			'CP-receipt-anchoring',
			['T6-1', 'T6-2', 'T6-9'],
			{
				name: 'Receipt anchoring + response detection',
				downstream: 4,
				dependency: 'Receipt writer/mainnet anchoring + event-stream response detection'
			}
		);
		const rows = buildPowerTargetDetailRows({
			base: '/org/local',
			target: {
				id: 'dm 1',
				isFollowed: false,
				hasContactRoute: false,
				timelineCount: 0,
				receiptCount: 0
			},
			gates: {
				stateLocalTerrainGate,
				readerOfficeGate,
				receiptAnchoringGate
			}
		});
		const row = (id: string) => rows.find((candidate) => candidate.id === id);

		expect(rows).toHaveLength(4);
		expect(row('follow-state')?.state).toBe('draft-only');
		expect(row('follow-state')?.href).toBe('/org/local/representatives/dm%201#target-posture');
		expect(row('contact-route')?.state).toBe('gated');
		expect(row('contact-route')?.action).toBe('read contact boundary');
		expect(row('accountability-timeline')?.state).toBe('draft-only');
		expect(row('reader-office-boundary')?.action).toBe('read office-workflow boundary');
		expect(row('reader-office-boundary')?.boundary).toContain('reader-office profiles');

		const evidencedRows = buildPowerTargetDetailRows({
			base: '/org/local',
			target: {
				id: 'dm-live',
				isFollowed: true,
				hasContactRoute: true,
				timelineCount: 3,
				receiptCount: 0
			},
			gates: {
				stateLocalTerrainGate,
				readerOfficeGate,
				receiptAnchoringGate
			}
		});
		const evidencedRow = (id: string) => evidencedRows.find((candidate) => candidate.id === id);

		expect(evidencedRow('follow-state')?.state).toBe('live');
		expect(evidencedRow('contact-route')?.state).toBe('partial');
		expect(evidencedRow('contact-route')?.action).toBe('read contact route');
		expect(evidencedRow('accountability-timeline')?.state).toBe('partial');
		expect(evidencedRow('accountability-timeline')?.metric.value).toBe(3);
		expect(evidencedRow('accountability-timeline')?.metric.cite).toBe(
			'legislation.getDmDetail actions + receipts'
		);
	});

	it('keeps Bills terrain as an armed corpus surface with explicit monitoring boundaries', () => {
		const bills = source('src/routes/org/[slug]/legislation/+page.svelte');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(bills).toContain('WorkspaceCapabilityStrip');
		expect(bills).toContain('Bills terrain capability');
		expect(bills).toContain('buildLegislativeMonitoringReadiness,');
		expect(bills).toContain('type LegislativeMonitoringReadinessRow');
		expect(bills).toContain('operatorCapabilityActionLabel,');
		expect(bills).toContain('operatorCapabilityStateLabel');
		expect(bills).toContain('const searchResultCount = $derived');
		expect(bills).toContain('const legislativeMonitoringReadiness = $derived(');
		expect(bills).toContain('buildLegislativeMonitoringReadiness({');
		expect(bills).toContain('searchResultCount');
		expect(bills).toContain(
			'const legislativeMonitoringRows = $derived<LegislativeMonitoringReadinessRow[]>'
		);
		expect(bills).toContain(
			"const heldTerrainRowIds = new Set<LegislativeMonitoringReadinessRow['id']>(["
		);
		expect(bills).toContain("'state-local-corpus'");
		expect(bills).toContain("'per-supporter-alerts'");
		expect(bills).toContain("'delegated-monitoring'");
		expect(bills).toContain("'multi-jurisdiction-routing'");
		expect(bills).toContain(
			'const heldTerrainRows = $derived<LegislativeMonitoringReadinessRow[]>'
		);
		expect(bills).toContain('legislativeMonitoringRows.filter((row) => heldTerrainRowIds.has(row.id))');
		expect(bills).toContain('legislativeMonitoringRows.map((row) => ({');
		expect(bills).toContain('cluster: row.clusters');
		expect(bills).toContain('detail: row.ground');
		expect(bills).toContain('unlock: row.boundary');
		expect(bills).toContain('return operatorCapabilityStateLabel(state);');
		expect(bills).toContain(
			'return operatorCapabilityActionLabel(row.state, row.action, { appendReadyArrow: true });'
		);
		expect(bills).toContain('{legislativeMonitoringReadiness.effect}');
		expect(bills).toContain('{legislativeMonitoringReadiness.detail}');
		expect(bills).toContain("getGateEvidence('CP-state-bill-terrain', ['T6-6', 'T3-1']");
		expect(bills).toContain("getGateEvidence('CP-multi-jurisdiction-routing', ['T3-8']");
		expect(bills).toContain("getGateEvidence('CP-per-supporter-bill-alerts', ['T4-3']");
		expect(bills).toContain(
			"getGateEvidence(\n\t\t'CP-agentic-legislative-monitoring',\n\t\t['T4-4', 'T4-1']"
		);
		expect(bills).toContain('id="bill-search"');
		expect(bills).toContain('id="bill-watchlist"');
		expect(bills).toContain('id="bill-relevance"');
		expect(bills).toContain('id="bill-terrain-boundary"');
		expect(bills).toContain('aria-label="Bills terrain held boundary rows"');
		expect(bills).toContain('{#each heldTerrainRows as row (row.id)}');
		expect(bills).toContain('title={row.boundary}');
		expect(bills).toContain('aria-label="{row.label}: {stateLabel(row.state)}. {row.boundary}"');
		expect(bills).toContain('{row.gate.name}');
		expect(bills).toContain('<Datum value={row.metric.value} cite={row.metric.cite} />');
		expect(bills).toContain('{actionLabel(row)}');
		expect(bills).toContain('Loaded bill records are org-side terrain');
		expect(bills).toContain('This route does not claim state/local');
		expect(bills).not.toContain('<Datum value={null} cite="T6-6 / T3-1" />');
		expect(bills).not.toContain('<Datum value={null} cite="T4-3 / T4-4" />');
		expect(bills).not.toContain('state corpus');
		expect(bills).not.toContain('alert agents');
		expect(bills).not.toContain("cluster: 'reach'");
		expect(bills).not.toContain("cluster: 'accountability'");
		expect(bills).not.toContain("cluster: 'quality signaling'");
		expect(bills).not.toContain("cluster: 'agentic systems'");
		expect(bills).not.toContain("cluster: 'data sovereignty'");
		expect(bills).not.toContain('OpenStates ingestion is live');
		expect(bills).not.toContain('per-supporter alerts are live');
		expect(bills).not.toContain('open in classic');
		expect(hypergraph).toContain('searchResultCount?: number | null;');
		expect(hypergraph).toContain("label: 'Federal bill corpus'");
		expect(hypergraph).toContain("label: 'Org watchlist'");
		expect(hypergraph).toContain("label: 'Org relevance screen'");
		expect(hypergraph).toContain("label: 'Position register'");
		expect(hypergraph).toContain("label: 'Per-supporter alert fan-out'");
		expect(hypergraph).toContain("label: 'Delegated agent monitoring'");
		expect(hypergraph).toContain("label: 'Multi-jurisdiction routing'");
		expect(hypergraph).toContain('bill search results are loaded from the route-local');

		expect(canonicalDoc).toContain(
			'**Bills terrain** derives its local `WorkspaceCapabilityStrip` from `buildLegislativeMonitoringReadiness`'
		);
		expect(canonicalDoc).toContain('route-local bill search result count');
		expect(canonicalDoc).toContain('The `/legislation` route now states the bill-terrain boundary');
		expect(capabilityScope).toContain('Org Bills terrain surface');
		expect(capabilityScope).toContain('consumes `buildLegislativeMonitoringReadiness`');
		expect(capabilityScope).toContain('route-local search-result counts');
		expect(capabilityScope).toContain('state/local bill ingestion, special-district bill coverage');
		expect(capabilityScope).toContain('delegated agent monitoring');
	});

	it('keeps Accountability scores as a bounded evidence surface, not a public-toggle facade', () => {
		const scorecardDashboard = source('src/lib/components/org/ScorecardDashboard.svelte');
		const scorecardCard = source('src/lib/components/org/ScorecardCard.svelte');
		const scorecardTypes = source('src/lib/server/legislation/scorecard/types.ts');
		const scorecardServer = source('src/routes/org/[slug]/scorecards/+page.server.ts');
		const scorecardCsvExport = source('src/routes/api/org/[slug]/scorecards/export/+server.ts');
		const layoutServer = source('src/routes/org/[slug]/+layout.server.ts');
		const layout = source('src/routes/org/[slug]/+layout.svelte');
		const spacesContract = source('src/lib/components/org/os/spaces.ts');
		const landscapeSpace = source('src/lib/components/org/os/LandscapeSpace.svelte');
		const capabilityLandscape = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const canvas = source('src/lib/components/org/os/CanvasCapabilityMap.svelte');
		const constellation = source('src/lib/components/org/os/constellation.ts');
		const legislation = source('convex/legislation.ts');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(scorecardDashboard).toContain('WorkspaceCapabilityStrip');
		expect(scorecardDashboard).toContain('Accountability score capability');
		expect(scorecardDashboard).toContain('buildAccountabilityResponseReadiness');
		expect(scorecardDashboard).toContain('type AccountabilityResponsePressureReadout = {');
		expect(scorecardDashboard).toContain('type AccountabilityResponseReadinessRow');
		expect(scorecardDashboard).toContain('const accountabilityResponseReadiness = $derived');
		expect(scorecardDashboard).toContain(
			'const accountabilityResponseRows = $derived<AccountabilityResponseReadinessRow[]>'
		);
		expect(scorecardDashboard).toContain('const accountabilityResponseStateCounts = $derived');
		expect(scorecardDashboard).toContain(
			'const accountabilityResponseSegments = $derived'
		);
		expect(scorecardDashboard).toContain('const proofDeliveryResponseRow = $derived');
		expect(scorecardDashboard).toContain('const readerSignalResponseRows = $derived');
		expect(scorecardDashboard).toContain('const strongestReaderSignalResponseRow = $derived');
		expect(scorecardDashboard).toContain('const heldAccountabilityResponseRows = $derived');
		expect(scorecardDashboard).toContain('const firstHeldAccountabilityResponseRow = $derived');
		expect(scorecardDashboard).toContain('const nextResponseLiftRow = $derived');
		expect(scorecardDashboard).toContain(
			'const accountabilityResponsePressureReadouts = $derived<AccountabilityResponsePressureReadout[]>(['
		);
		expect(scorecardDashboard).toContain("id: 'response-ground'");
		expect(scorecardDashboard).toContain("id: 'reader-signals'");
		expect(scorecardDashboard).toContain("id: 'next-response-lift'");
		expect(scorecardDashboard).toContain("label: 'Response ground'");
		expect(scorecardDashboard).toContain("label: 'Reader signals'");
		expect(scorecardDashboard).toContain("label: 'Next response lift'");
		expect(scorecardDashboard).toContain("label: 'Scorecard CSV export'");
		expect(scorecardDashboard).toContain(
			"action: strongestReaderSignalResponseRow?.action ?? 'read response boundary'"
		);
		expect(scorecardDashboard).toContain("nextResponseLiftRow?.action ?? 'read response boundary'");
		expect(scorecardDashboard).toContain('...accountabilityResponseRows.map((row) => ({');
		expect(scorecardDashboard).toContain('label: row.label');
		expect(scorecardDashboard).toContain('cluster: row.clusters');
		expect(scorecardDashboard).toContain('handoff: row.handoff');
		expect(scorecardDashboard).not.toContain("label: 'Score snapshots'");
		expect(scorecardDashboard).not.toContain("label: 'Anchored response surface'");
		expect(scorecardDashboard).not.toContain("action: 'read boundary'");
		expect(scorecardDashboard).toContain('Reader-office workflow + notification webhooks');
		expect(scorecardDashboard).not.toContain('Staffer dashboard');
		expect(scorecardDashboard).not.toContain('staffer dashboard');
		expect(scorecardDashboard).not.toContain('staffer dashboards');
		expect(scorecardDashboard).not.toContain('staffer surfaces');
		expect(scorecardDashboard).toContain(
			"getGateEvidence('CP-scorecard-snapshot-basis', ['T6-5', 'T6-8']"
		);
		expect(scorecardDashboard).toContain(
			"getGateEvidence('CP-non-federal-scorecards', ['T6-6', 'T3-1']"
		);
		expect(scorecardDashboard).toContain(
			"getGateEvidence('CP-dm-office-profile', ['T8-1b', 'T8-8']"
		);
		expect(scorecardDashboard).toContain('id="scorecard-public-boundary"');
		expect(scorecardDashboard).toContain('id="scorecard-list"');
		expect(scorecardDashboard).toContain('CSV export is live for members');
		expect(scorecardDashboard).toContain('does not expose a public org publish switch');
		expect(scorecardDashboard).toContain('const scoreSnapshotCount = $derived(');
		expect(scorecardDashboard).toContain('function sumKnown(');
		expect(scorecardDashboard).toContain('<Datum value={meta.avgScore}');
		expect(scorecardDashboard).toContain('value={responseSignalCount}');
		expect(scorecardDashboard).toContain('scorecardSnapshots.deliveriesSent or receiptCount');
		expect(scorecardDashboard).toContain('aria-label="Scorecard accountability response pressure"');
		expect(scorecardDashboard).toContain(
			'{#each accountabilityResponsePressureReadouts as readout (readout.id)}'
		);
		expect(scorecardDashboard).toContain('<Ratio segments={accountabilityResponseSegments} height={8} />');
		expect(scorecardDashboard).toContain('actionLabel(readout.state, readout.action)');
		expect(scorecardDashboard).toContain('operatorCapabilityActionLabel(state, action, { appendReadyArrow: true })');
		expect(scorecardDashboard).not.toContain('const scorecardCount = $derived(scorecards.length)');
		expect(scorecardDashboard).not.toContain('Make Public');
		expect(scorecardDashboard).not.toContain('togglePublic');
		expect(scorecardDashboard).not.toContain('fetch(`/api/org/${orgSlug}/settings`');
		for (const responseLabel of [
			"label: 'Proof delivery register'",
			"label: 'Opened response signal'",
			"label: 'Verified-link signal'",
			"label: 'Reply log'",
			"label: 'Vote alignment basis'",
			"label: 'Reader-office workflow'"
		]) {
			expect(hypergraph).toContain(responseLabel);
		}

		expect(scorecardCard).toContain('function scoreClass(score: number | null)');
		expect(scorecardCard).toContain('function formatCount(value: number | null)');
		expect(scorecardCard).toContain('Vote basis not loaded');
		expect(scorecardCard).toContain('score-unknown');
		expect(scorecardTypes).toContain('reportsOpened: number | null;');
		expect(scorecardTypes).toContain('verifyLinksClicked: number | null;');
		expect(scorecardTypes).toContain('repliesLogged: number | null;');
		expect(scorecardTypes).toContain('relevantVotes: number | null;');
		expect(scorecardTypes).toContain('score: number | null;');

		expect(scorecardServer).toContain('scorecard?.composite');
		expect(scorecardServer).toContain('scorecard?.alignment');
		expect(scorecardServer).toContain('scorecard?.deliveriesSent');
		expect(scorecardServer).toContain('scorecard?.deliveriesOpened');
		expect(scorecardServer).toContain('scorecard?.deliveriesVerified');
		expect(scorecardServer).toContain('scorecard?.repliesReceived');
		expect(scorecardServer).toContain('scorecard?.totalScoredVotes');
		expect(scorecardServer).toContain('reportsOpened: asNumberOrNull(scorecard?.deliveriesOpened)');
		expect(scorecardServer).toContain('relevantVotes: asNumberOrNull(scorecard?.totalScoredVotes)');
		expect(scorecardServer).toContain('score: composite !== null ? Math.round(composite * 100) : null');
		expect(scorecardServer).toContain('avgScore: avgScore !== null ? Math.round(avgScore) : null');
		expect(scorecardServer).toContain('const scoredRows = scorecards.filter');
		expect(scorecardServer).toContain('totalFollowed');
		expect(scorecardServer).toContain('withScorecards');
		expect(scorecardServer).not.toContain('score: composite !== null ? Math.round(composite * 100) : 0');
		expect(scorecardServer).not.toContain(
			'scorecard as Record<string, unknown> | undefined)?.reportsOpened'
		);
		expect(scorecardServer).not.toContain(
			'scorecard as Record<string, unknown> | undefined)?.score'
		);
		expect(layoutServer).toContain('reportsOpened: asNumberOrNull(sc?.deliveriesOpened)');
		expect(layoutServer).toContain('verifyLinksClicked: asNumberOrNull(sc?.deliveriesVerified)');
		expect(layoutServer).toContain('repliesLogged: asNumberOrNull(sc?.repliesReceived)');
		expect(layoutServer).toContain('relevantVotes: asNumberOrNull(sc?.totalScoredVotes)');
		expect(layoutServer).toContain('scorecardSnapshotCount: scoredScorecards.length');
		expect(layoutServer).toContain('score: composite !== null ? Math.round(composite * 100) : null');
		expect(layoutServer).not.toContain('reportsOpened: asNumber(sc?.reportsOpened)');
		expect(spacesContract).toContain('scorecardSnapshotCount: number;');
		expect(spacesContract).toContain('scorecardAvg: number | null;');
		expect(spacesContract).toContain('reportsOpened: number | null;');
		expect(spacesContract).toContain('score: number | null;');
		expect(landscapeSpace).toContain('scorecardCount: data?.scorecardSnapshotCount ?? null');
		expect(landscapeSpace).toContain('<Datum value={data.scorecardSnapshotCount}');
		expect(layout).toContain('const powerWorkspaceSignal = $derived<WorkspaceSignal>');
		expect(layout).toContain('datum: powerTerrainReadiness.terrainCount');
		expect(layout).toContain("cite: 'buildPowerTerrainReadiness'");
		expect(layout).toContain('state: powerTerrainReadiness.state');
		expect(layout).toContain('signal: powerWorkspaceSignal');
		expect(layout).not.toContain(
			'space.followedCount + space.bills.length + space.scorecardSnapshotCount'
		);
		expect(layout).toContain(
			'scorecardCount: data.spaces.landscape?.scorecardSnapshotCount ?? null'
		);
		expect(layout).toContain('const powerScoreTerrainRow = $derived(');
		expect(layout).toContain('href: powerScoreTerrainRow?.href ?? `${base}/scorecards`');
		expect(layout).toContain(
			"signal: capabilityMetricSignal(powerScoreTerrainRow, 'unread scores')"
		);
		expect(layout).not.toContain(
			'data.spaces.landscape.scorecardSnapshotCount.toLocaleString'
		);
		expect(layout).toContain(
			"label: powerTerrainReadiness.terrainCount === null ? 'terrain' : 'terrain records'"
		);
		expect(layout).toContain(
			'powerTerrainReadiness.terrainCount.toLocaleString'
		);
		expect(layout).not.toContain('decision-maker follows, watched bills, score snapshots');
		expect(layout).not.toContain(
			'return space.followedCount + space.bills.length + space.scorecards.length'
		);
		expect(canvas).toContain('scorecardCount: spaces?.landscape?.scorecardSnapshotCount ?? null');
		expect(capabilityLandscape).not.toContain(
			'power ? power.followedCount + power.bills.length + power.scorecardSnapshotCount : null'
		);
		expect(capabilityLandscape).toContain('scorecardCount: power?.scorecardSnapshotCount ?? null');
		expect(constellation).toContain('if (land.scorecardSnapshotCount > 0)');
		expect(constellation).toContain('scorecard.score !== null');
		expect(constellation).toContain('scorecardCount: land.scorecardSnapshotCount');

		expect(legislation).toContain('deliveriesOpened: latest.deliveriesOpened');
		expect(legislation).toContain('deliveriesVerified: latest.deliveriesVerified');
		expect(legislation).toContain('snapshotHash: latest.snapshotHash');
		expect(legislation).toContain('reportsReceived: latest?.deliveriesSent ?? dmReceipts.length');
		expect(legislation).toContain('reportsOpened: latest?.deliveriesOpened ?? null');
		expect(legislation).toContain('relevantVotes: latest?.totalScoredVotes ?? null');
		expect(legislation).toContain(
			'score: latest?.composite != null ? Math.round(latest.composite * 100) : null'
		);
		expect(legislation).toContain('filtered.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));');
		expect(scorecardCsvExport).toContain('function csvValue(value: unknown)');
		expect(scorecardCsvExport).toContain("typeof s.alignmentRate === 'number'");
		expect(scorecardCsvExport).toContain("typeof s.avgResponseTime === 'number'");

		expect(canonicalDoc).toContain(
			'**Accountability scores** derives its response rows from `buildAccountabilityResponseReadiness`'
		);
		expect(canonicalDoc).toContain(
			'Response ground, Reader signals, and Next response lift pressure cells'
		);
		expect(canonicalDoc).not.toContain('staffer dashboard');
		expect(canonicalDoc).not.toContain('staffer dashboards');
		expect(canonicalDoc).toContain('the former org-level public publish action is not exposed');
		expect(capabilityScope).toContain('Org accountability score surface');
		expect(capabilityScope).toContain('consumes `buildAccountabilityResponseReadiness`');
		expect(capabilityScope).toContain('Scorecard accountability response pressure');
		expect(capabilityScope).toContain('read response boundary');
		expect(capabilityScope).not.toContain('staffer dashboard');
		expect(capabilityScope).not.toContain('staffer dashboards');
		expect(capabilityScope).toContain('instead of flattening missing fields to zero');
		expect(capabilityScope).toContain('There is no org-level "make public" settings mutation');
	});

	it('surfaces compound capability moves as an early Spotlight-addressable layer', () => {
		const component = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const peopleSpace = source('src/lib/components/org/os/BaseSpace.svelte');
		const studioSpace = source('src/lib/components/org/os/StudioSpace.svelte');
		const layout = source('src/routes/org/[slug]/+layout.svelte');
		const layoutServer = source('src/routes/org/[slug]/+layout.server.ts');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const legislation = source('convex/legislation.ts');
		const submissions = source('convex/submissions.ts');
		const spacesContract = source('src/lib/components/org/os/spaces.ts');
		const supporters = source('src/routes/org/[slug]/supporters/+page.svelte');
		const platformProfiles = source('src/lib/data/platform-export-profiles.ts');
		const capabilityClusters = source('src/lib/data/capability-clusters.ts');
		const workspaceStrip = source('src/lib/components/org/os/WorkspaceCapabilityStrip.svelte');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');
		const implementationStatus = source('docs/implementation-status.md');
		const launchPressureSource = section(
			hypergraph,
			'export function buildLaunchPressureRows',
			'export function summarizeLaunchPressure'
		);
		const sendReadinessSource = section(
			hypergraph,
			'export function buildSendReadiness',
			'export function getDataHonestyEvidence'
		);
		const capabilityCardContract = section(component, 'type CapabilityCard', 'type HonestyRow');
		const capabilityCardSource = section(component, 'const capabilityCards', 'const sendModes');
		const criticalPathContract = section(
			hypergraph,
			'export type CriticalPathRow',
			'export type SendReadinessModeKey'
		);
		const gateRegisterContract = section(
			hypergraph,
			'export type GateRegisterRow',
			'export type GateRegisterInputs'
		);
		const criticalPathSource = section(
			hypergraph,
			'export function buildCriticalPathRows',
			'export function summarizeCriticalPath'
		);
		const criticalPathSummarySource = section(
			hypergraph,
			'export function summarizeCriticalPath',
			'export function buildSendReadiness'
		);
		const criticalPathUsage = section(component, 'const criticalPathRows', 'const honestyRows');
		const criticalPathPressureSource = section(
			component,
			'const criticalPathSummary',
			'const honestyRows'
		);
		const unlockCascadeSource = section(component, 'const unlockCascade', 'const honestyRows');
		const unlockCascadeMarkup = section(
			component,
			'id="capability-critical-path"',
			'id="capability-gates"'
		);
		const gateRegisterSource = section(
			hypergraph,
			'export function buildGateRegisterRows',
			'export function summarizeGateRegister'
		);
		const gateRegisterSummarySource = section(
			hypergraph,
			'export function summarizeGateRegister',
			'export function getDataHonestyEvidence'
		);
		const gateRegisterUsage = section(component, 'const gateRegister', 'const gateStateSegments');
		const gateRegisterMarkup = section(component, 'id="capability-gates"', 'id="capability-send"');
		const latticeMarkup = section(component, 'class="capability-lattice"', 'class="posture"');
		const clusterCoverageSource = section(
			component,
			'const clusterEvidenceItems',
			'const currentClaimState'
		);
		const clusterCoverageMarkup = section(
			component,
			'id="capability-cluster-coverage"',
			'id="capability-actions"'
		);
		const stateLedgerSource = section(
			component,
			'const stateLedgerSources',
			'const visibleContractStateRows'
		);
		const operatingReadoutMarkup = section(
			component,
			'<section class="operating-readout"',
			'id="capability-state-ledger"'
		);
		const stateLedgerMarkup = section(
			component,
			'id="capability-state-ledger"',
			'id="capability-cluster-coverage"'
		);
		const compositionPathContract = section(
			component,
			'type CompositionStep',
			'type OperatingPosture'
		);
		const compositionSource = section(
			component,
			'const compositionPaths',
			'const partialCompositionPathCount'
		);
		const actionToProofPath = section(component, "id: 'PATH-1'", "id: 'PATH-2'");
		const proofBoundPeoplePath = section(component, "id: 'PATH-2'", "id: 'PATH-3'");
		const delegatedCivicActionPath = section(
			component,
			"id: 'PATH-4'",
			'const partialCompositionPathCount'
		);
		const loopPhaseSource = section(component, 'const loopPhases', 'const liveLoopPhaseCount');
		const loopPressureSource = section(
			component,
			'const heldLoopPhases',
			'const capabilityLattice'
		);
		const peopleGroundLoopPhase = section(loopPhaseSource, "id: 'GROUND'", "id: 'AUTHOR'");
		const powerResolveLoopPhase = section(loopPhaseSource, "id: 'RESOLVE'", "id: 'SEND'");
		const operatingPostureSource = section(
			component,
			'const operatingPosture',
			'const capabilityShifts'
		);
		const peopleOperatingPosture = section(
			operatingPostureSource,
			"id: 'POSTURE-PEOPLE'",
			"id: 'POSTURE-SEND'"
		);
		const capabilityShiftSource = section(
			component,
			'const capabilityShifts',
			'const runtimeGateRows'
		);
		const proofBoundConstituencyCard = section(
			capabilityCardSource,
			"id: 'proof-bound-constituency'",
			"id: 'jurisdictional-reach'"
		);
		const jurisdictionalReachCard = section(
			capabilityCardSource,
			"id: 'jurisdictional-reach'",
			"id: 'legislative-monitoring-posture'"
		);
		const peopleShiftSource = section(
			capabilityShiftSource,
			"id: 'SHIFT-PEOPLE'",
			"id: 'SHIFT-INTAKE'"
		);
		const compositionMarkup = section(
			component,
			'id="capability-composition"',
			'id="launch-pressure"'
		);
		const visibleContractSource = section(
			component,
			'const visibleContractBaseStates',
			'const firstLaunchPressureRow'
		);
		const finalVisibleContractSource = section(
			component,
			'const visibleContractStates',
			'const visibleContractCounts'
		);
		const cardGrid = section(component, '<div class="card-grid">', '<style>');
		const platformIntakeCard = section(
			component,
			"title: 'Platform export intake'",
			"title: 'Grounded authoring loop'"
		);
		const studioAuthoringReadinessSource = section(
			hypergraph,
			'export type StudioAuthoringReadinessRowKey',
			'export type PlatformIntakeProfileRow'
		);
		const studioAuthoringBuilderSource = section(
			hypergraph,
			'export function buildStudioAuthoringReadiness',
			'export function buildPlatformIntakeReadiness'
		);
		const studioAuthoringMarkup = section(
			component,
			'id="capability-grounded-authoring"',
			'id="capability-composition"'
		);
		const platformProfileMarkup = section(
			component,
			'<section class="platform-profiles"',
			'id="capability-people-segmentation"'
		);
		const platformVendorGridMarkup = section(
			platformProfileMarkup,
			'<div class="profile-grid"',
			'</section>'
		);
		const platformProfilePressureSource = section(
			component,
			'const exportRecognitionStage',
			'const mainnetGate'
		);
		const peopleSegmentationReadinessSource = section(
			hypergraph,
			'export type PeopleSegmentationRowKey',
			'export function buildPowerTerrainReadiness'
		);
		const peopleSegmentationCard = section(
			component,
			"title: 'People segmentation posture'",
			"title: 'Donation receipt posture'"
		);
		const peopleSegmentationMarkup = section(
			component,
			'id="capability-people-segmentation"',
			'<section class="power-terrain"'
		);
		const emailListHealthReadinessSource = section(
			hypergraph,
			'export type EmailListHealthRowKey',
			'export function buildPowerTerrainReadiness'
		);
		const emailListHealthCard = section(
			component,
			"title: 'Consent-bound reach'",
			"title: 'Donation receipt posture'"
		);
		const emailListHealthMarkup = section(
			component,
			'id="capability-list-health"',
			'<section class="power-terrain"'
		);
		const textDeliveryReadinessSource = section(
			hypergraph,
			'export type TextDeliveryReadinessRowKey',
			'export function buildPowerTerrainReadiness'
		);
		const textDeliveryCard = section(
			component,
			"title: 'Text delivery posture'",
			"title: 'Donation receipt posture'"
		);
		const textDeliveryMarkup = section(
			component,
			'id="capability-text-delivery"',
			'<section class="power-terrain" aria-labelledby="power-terrain-title"'
		);
		const powerTerrainMarkup = section(
			component,
			'<section class="power-terrain"',
			'<section class="power-terrain results-proof"'
		);
		const powerTerrainReadinessSource = section(
			hypergraph,
			'export function buildPowerTerrainReadiness',
			'export function buildLegislativeMonitoringReadiness'
		);
		const powerTerrainPressureSource = section(
			component,
			'const heldPowerTerrainRows',
			'const legislativeMonitoringReadiness'
		);
		const legislativeMonitoringReadinessSource = section(
			hypergraph,
			'export type LegislativeMonitoringRowKey',
			'export function buildResultsProofReadiness'
		);
		const legislativeMonitoringPressureSource = section(
			component,
			'const heldLegislativeMonitoringRows',
			'const coalitionReadiness'
		);
		const legislativeMonitoringCard = section(
			component,
			"title: 'Legislative monitoring posture'",
			"title: 'Coalition composition'"
		);
		const legislativeMonitoringMarkup = section(
			component,
			'id="capability-legislative-monitoring"',
			'id="capability-coalition"'
		);
		const coalitionReadinessSource = section(
			hypergraph,
			'export type CoalitionReadinessRowKey',
			'export function buildFundraisingReadiness'
		);
		const coalitionPressureSource = section(
			component,
			'const aggregateProofCoalitionRow',
			'const accountabilityResponseReadiness'
		);
		const coalitionCard = section(
			component,
			"title: 'Coalition composition'",
			"title: 'Operating authority'"
		);
		const coalitionMarkup = section(
			component,
			'id="capability-coalition"',
			'<section class="power-terrain results-proof"'
		);
		const resultsProofMarkup = section(
			component,
			'<section class="power-terrain results-proof"',
			'id="capability-accountability-response"'
		);
		const resultsProofReadinessSource = section(
			hypergraph,
			'export function buildResultsProofReadiness',
			'export function buildAccountabilityResponseReadiness'
		);
		const resultsProofPressureSource = section(
			component,
			'const receiptEvidenceResultsRow',
			'const fundraisingRows'
		);
		const accountabilityResponseReadinessSource = section(
			hypergraph,
			'export function buildAccountabilityResponseReadiness',
			'export function buildCoalitionReadiness'
		);
		const accountabilityResponsePressureSource = section(
			component,
			'const proofDeliveryResponseRow',
			'const capabilityCards'
		);
		const accountabilityResponseCard = section(
			component,
			"title: 'Accountability response posture'",
			"title: 'Owned civic infrastructure'"
		);
		const accountabilityResponseMarkup = section(
			component,
			'id="capability-accountability-response"',
			'id="capability-fundraising"'
		);
		const fundraisingReadinessSource = section(
			hypergraph,
			'export type FundraisingReadinessRowKey',
			'export function buildCoordinationReadiness'
		);
		const fundraisingPressureSource = section(
			component,
			'const taxReceiptFundraisingRow',
			'const coordinationRows'
		);
		const coordinationPressureSource = section(
			component,
			'const coordinationDefinitionRow',
			'const publicVerifierHonesty'
		);
		const coordinationReadinessSource = section(
			hypergraph,
			'export type CoordinationReadinessRowKey',
			'export function buildGateRegisterRows'
		);
		const operatingAuthorityReadinessSource = section(
			hypergraph,
			'export type OperatingAuthorityRowKey',
			'export function buildGateRegisterRows'
		);
		const ownerTransferAuthoritySource = section(
			operatingAuthorityReadinessSource,
			"id: 'owner-transfer-ceremony'",
			"id: 'org-audit-log'"
		);
		const operatingAuthorityPressureSource = section(
			component,
			'const publishAuthorityRow',
			'const smsDispatchGate'
		);
		const fundraisingCard = section(
			component,
			"title: 'Donation receipt posture'",
			"title: 'Coordination logic readiness'"
		);
		const coordinationLogicCard = section(
			component,
			"title: 'Coordination logic readiness'",
			"title: 'Grounded authoring loop'"
		);
		const operatingAuthorityCard = section(
			component,
			"title: 'Operating authority'",
			"title: 'Platform export intake'"
		);
		const fundraisingMarkup = section(
			component,
			'id="capability-fundraising"',
			'id="capability-coordination"'
		);
		const coordinationMarkup = section(
			component,
			'id="capability-coordination"',
			'id="capability-operating-authority"'
		);
		const operatingAuthorityMarkup = section(
			component,
			'id="capability-operating-authority"',
			'<section class="operator-queue"'
		);
		const runtimeGateRowsSource = section(component, 'const runtimeGateRows', 'const claimBasis');
		const runtimeServerEmailSource = section(
			runtimeGateRowsSource,
			"id: 'runtime-server-email-dispatch'",
			"id: 'runtime-client-merge-send'"
		);
		const runtimeClientMergeSource = section(
			runtimeGateRowsSource,
			"id: 'runtime-client-merge-send'",
			"id: 'runtime-ab-continuation'"
		);
		const runtimeAbContinuationSource = section(
			runtimeGateRowsSource,
			"id: 'runtime-ab-continuation'",
			"id: 'runtime-sms-dispatch'"
		);
		const runtimeSmsDispatchSource = section(
			runtimeGateRowsSource,
			"id: 'runtime-sms-dispatch'",
			"id: 'runtime-workflow-execution'"
		);
		const runtimeWorkflowExecutionSource = section(
			runtimeGateRowsSource,
			"id: 'runtime-workflow-execution'",
			"id: 'runtime-congressional-delivery'"
		);
		const runtimeCongressionalDeliverySource = section(
			runtimeGateRowsSource,
			"id: 'runtime-congressional-delivery'",
			"id: 'runtime-event-artifacts'"
		);
		const runtimeEventArtifactSource = section(
			runtimeGateRowsSource,
			"id: 'runtime-event-artifacts'",
			"id: 'runtime-coalition-proof'"
		);
		const runtimeCoalitionProofSource = section(
			runtimeGateRowsSource,
			"id: 'runtime-coalition-proof'",
			"id: 'runtime-delegated-civic-action'"
		);
		const runtimeDelegatedCivicActionSource = section(
			runtimeGateRowsSource,
			"id: 'runtime-delegated-civic-action'",
			']);'
		);
		const claimBasisSource = section(
			component,
			'const claimBasis = $derived<ClaimBasis[]>',
			'const visibleContractStates'
		);
		const claimBasisPressureSource = section(
			component,
			'const heldRuntimeClaimBasisRows',
			'const firstViewportMoveContracts'
		);
		const claimBasisMarkup = section(
			component,
			'<section id="capability-basis"',
			'<section\n\t\tid="capability-critical-path"'
		);
		const coordinationCard = section(
			component,
			"title: 'Anti-astroturf signal'",
			"cluster: 'C-reader-side'"
		);
		const operatorQueueCandidateSource = section(
			component,
			'const operatorQueueCandidates',
			'const safeQueue'
		);
		const peopleProofWeightQueueItem = section(
			operatorQueueCandidateSource,
			"id: 'people-proof-weight'",
			"id: 'people-source-provenance'"
		);
		const safeQueueSource = section(component, 'const safeQueue', 'const gatedQueue');
		const gatedQueueSource = section(component, 'const gatedQueue', 'const immediateLiveMove');
		const queuePressureSource = section(component, 'const safeQueueLiveCount', 'function stateLabel');
		const operatorQueueMarkup = section(
			component,
			'<section class="operator-queue"',
			'<section id="capability-basis"'
		);
		const sendModeMarkup = section(
			component,
			'<div id="capability-send"',
			'<div class="card-grid"'
		);
		const sendPressureSource = section(
			component,
			'const usableSendModeCount',
			'const criticalPathRows'
		);
		const armedClaim = section(component, "id: 'CLAIM-ARMED'", "id: 'CLAIM-QUALIFY'");
		const blockedClaim = section(component, "id: 'CLAIM-BLOCK'", 'const operatingReadout');
		const claimGrammarSource = section(
			component,
			'const claimGrammarRows',
			'const operatorQueueCandidates'
		);
		const claimBoundaryMarkup = section(
			component,
			'id="capability-claim-boundary"',
			'id="capability-loop"'
		);
		const loopRailMarkup = section(
			component,
			'id="capability-loop"',
			'<section class="capability-lattice"'
		);

		expect(component).toContain('id="capability-composition"');
		expect(component).toContain('id="capability-actions"');
		expect(compositionPathContract).toContain('type CompositionStep = {');
		expect(compositionPathContract).toContain("phase: LoopPhase['id']");
		expect(compositionPathContract).toContain('steps: CompositionStep[]');
		expect(compositionPathContract).toContain('type CompositionPressureReadout = {');
		expect(component).toContain('const usableCompositionPathCount = $derived(');
		expect(component).toContain('const heldCompositionPathCount = $derived(');
		expect(component).toContain('const heldCompositionSteps = $derived(');
		expect(component).toContain('const firstHeldCompositionStep = $derived(');
		expect(component).toContain('const nextCompositionLiftPath = $derived(');
		expect(component).toContain(
			'const compositionPressureReadouts = $derived<CompositionPressureReadout[]>(['
		);
		expect(component).toContain('const proofBoundAuthorState = $derived<CapabilityState>(');
		expect(component).toContain('const actionToProofPathState = $derived<CapabilityState>(');
		expect(component).toContain('const proofBoundPeoplePathState = $derived<CapabilityState>(');
		expect(component).toContain('const delegatedTerrainState = $derived<CapabilityState>(');
		expect(component).toContain('const delegatedExecutorState = $derived<CapabilityState>(');
		expect(component).toContain('const delegatedCivicActionState = $derived<CapabilityState>(');
		expect(component).toContain('const delegatedCivicActionGround = $derived(');
		expect(component).toContain('const delegatedCivicActionGateSummary = $derived(');
		expect(component).toContain("label: 'Compound ground'");
		expect(component).toContain("label: 'Held phase'");
		expect(actionToProofPath).toContain('state: actionToProofPathState');
		expect(actionToProofPath).toContain('state: authoringLoopState');
		expect(actionToProofPath).toContain('effect: authoringLoopSummary');
		expect(actionToProofPath).toContain('gate: authoringLoopGate');
		expect(actionToProofPath).toContain('state: powerTerrainReadiness.state');
		expect(actionToProofPath).toContain("firstHeldPowerTerrainRow?.label ?? 'Power terrain'");
		expect(actionToProofPath).toContain(
			'effect: firstHeldPowerTerrainRow?.ground ?? powerTerrainReadiness.effect'
		);
		expect(actionToProofPath).toContain(
			'gate: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate'
		);
		expect(actionToProofPath).not.toContain("state: 'partial'");
		expect(actionToProofPath).not.toContain('US/federal structure is usable');
		expect(actionToProofPath).not.toContain('gateLabel(studioJurisdictionScopeGate)');
		expect(proofBoundPeoplePath).toContain('state: proofBoundPeoplePathState');
		expect(proofBoundPeoplePath).toContain('href: peopleGroundHref');
		expect(proofBoundPeoplePath).toContain('action: peopleGroundAction');
		expect(proofBoundPeoplePath).toContain('state: peopleGroundState');
		expect(proofBoundPeoplePath).toContain('effect: peopleGroundSummary');
		expect(proofBoundPeoplePath).toContain('gate: peopleGroundGate');
		expect(proofBoundPeoplePath).toContain('state: proofBoundAuthorState');
		expect(proofBoundPeoplePath).toContain('value: peopleGroundMetric.value');
		expect(proofBoundPeoplePath).toContain('label: peopleGroundMetric.label');
		expect(proofBoundPeoplePath).toContain('cite: peopleGroundMetric.cite');
		expect(proofBoundPeoplePath).not.toContain("state: 'partial'");
		expect(proofBoundPeoplePath).not.toContain("state: people ? 'partial' : 'gated'");
		expect(proofBoundPeoplePath).not.toContain('people?.identityVerified');
		expect(proofBoundPeoplePath).not.toContain('Address, district, and identity signals load');
		expect(delegatedCivicActionPath).toContain('state: delegatedCivicActionState');
		expect(delegatedCivicActionPath).toContain(
			"state: FEATURES.DELEGATION ? delegationGate.state : 'gated'"
		);
		expect(delegatedCivicActionPath).toContain('state: proofBoundAuthorState');
		expect(delegatedCivicActionPath).toContain('state: delegatedTerrainState');
		expect(delegatedCivicActionPath).toContain('state: delegatedExecutorState');
		expect(delegatedCivicActionPath).toContain(
			'effect: firstHeldPowerTerrainRow?.ground ?? powerTerrainReadiness.effect'
		);
		expect(delegatedCivicActionPath).toContain(
			'gate: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate'
		);
		expect(delegatedCivicActionPath).not.toContain(
			"state: FEATURES.DELEGATION ? 'partial' : 'gated'"
		);
		expect(delegatedCivicActionPath).not.toContain("state: 'partial'");
		expect(delegatedCivicActionPath).not.toContain('Heuristic scope passes into message grounding');
		expect(compositionSource).toContain("label: 'Delivery boundary'");
		expect(compositionSource).toContain("phase: 'SEND'");
		expect(compositionSource).toContain("handoff: 'Send readiness'");
		expect(compositionSource).toContain('effect: sendBoundarySummary');
		expect(compositionSource).toContain('state: sendBoundaryState');
		expect(compositionSource).toContain('gate: sendBoundaryStepGate');
		expect(compositionSource).toContain(
			'gate: `${gateLabel(crossBorderCoalitionGate)}; send boundary: ${sendBoundaryStepGate}`'
		);
		expect(component).not.toContain(
			'Armed paths can execute; held channels preserve drafts or read boundaries.'
		);
		expect(compositionSource).toContain('No cross-org delivery side effect is claimed here.');
		expect(compositionSource).toContain(
			'No autonomous side effect is claimed until executor, TEE, and proof gates land.'
		);
		expect(compositionMarkup).toContain('class="path-contract"');
		expect(compositionMarkup).toContain('class="path-step"');
		expect(compositionMarkup).toContain('{step.gate}');
		expect(compositionMarkup).toContain('{stateLabel(step.state)}');
		expect(compositionMarkup).toContain('class="composition-axis"');
		expect(compositionMarkup).toContain('aria-label="Capability composition axis"');
		expect(compositionMarkup).toContain('<span>path</span>');
		expect(compositionMarkup).toContain('<span>phase boundary</span>');
		expect(compositionMarkup).toContain('<span>weakest gate</span>');
		expect(compositionMarkup).toContain('aria-label="Capability composition pressure"');
		expect(compositionMarkup).toContain('{#each compositionPressureReadouts as item (item.id)}');
		expect(compositionMarkup).toContain('class="composition-pressure-card"');
		expect(compositionMarkup).toContain(
			'<span class="composition-pressure-label">{item.label}</span>'
		);
		expect(compositionMarkup).toContain(
			'<span class="composition-pressure-state">{stateLabel(item.state)}</span>'
		);
		expect(compositionMarkup).toContain(
			'<span class="composition-pressure-detail">{item.detail}</span>'
		);
		expect(compositionMarkup).toContain('<span class="composition-pressure-gate">{item.gate}</span>');
		expect(compositionMarkup).toContain(
			'<span class="composition-pressure-action">'
		);
		expect(component).toContain(".composition-pressure-card[data-state='draft-only']");
		expect(component).toContain(".composition-pressure-card[data-state='gated']");
		expect(component).not.toContain('Read this before the registers');
		expect(component).toContain('type LoopPressureReadout = {');
		expect(component).toContain('type CriticalPathPressureReadout = {');
		expect(component).toContain('type GatePressureReadout = {');
		expect(component).toContain('type ClaimBasisPressureReadout = {');
		expect(component).toContain('const loopPhaseStateCounts = $derived');
		expect(component).toContain('const heldLoopPhaseCount = $derived');
		expect(loopPressureSource).toContain('const heldLoopPhases = $derived(');
		expect(loopPressureSource).toContain('const firstHeldLoopPhase = $derived(');
		expect(loopPressureSource).toContain('const aggregateLoopPhase = $derived(');
		expect(loopPressureSource).toContain(
			'const loopPressureReadouts = $derived<LoopPressureReadout[]>'
		);
		expect(loopPressureSource).toContain("id: 'armed-span'");
		expect(loopPressureSource).toContain("id: 'first-held-phase'");
		expect(loopPressureSource).toContain("id: 'aggregate-proof'");
		expect(loopPressureSource).toContain("label: 'aggregate proof'");
		expect(component).toContain("return 'preview aggregate proof';");
		expect(component).not.toContain('proof return');
		expect(component).not.toContain('preview proof return');
		expect(component).not.toContain("id: 'proof-return'");
		expect(component).toContain('function loopPhaseAction(phase: LoopPhase): string');
		expect(component).toContain('const firstViewportMoveContracts = $derived<StateLedgerSource[]>');
		expect(visibleContractSource).toContain(
			'...workspacePosture.map((row) => row.state),'
		);
		expect(visibleContractSource).toContain('...operatingReadout.map((row) => row.state),');
		expect(visibleContractSource).toContain(
			'...firstViewportMoveContracts.map((move) => move.state),'
		);
		expect(visibleContractSource).toContain(
			'...claimBoundaries.map((boundary) => boundary.state),'
		);
		expect(visibleContractSource).toContain(
			'...loopPressureReadouts.map((readout) => readout.state),'
		);
		expect(visibleContractSource).toContain(
			'...criticalPathPressureReadouts.map((readout) => readout.state),'
		);
		expect(visibleContractSource).toContain(
			'...gatePressureReadouts.map((readout) => readout.state),'
		);
		expect(visibleContractSource).toContain(
			'...claimBasisPressureReadouts.map((readout) => readout.state),'
		);
		expect(visibleContractSource).toContain(
			'...compositionPaths.flatMap((path) => path.steps.map((step) => step.state)),'
		);
		expect(visibleContractSource).toContain('...criticalPathRows.map((row) => row.state),');
		expect(visibleContractSource).toContain('...clusterCoverage.map((row) => row.state),');
		expect(finalVisibleContractSource).toContain('...visibleContractBaseStates,');
		expect(finalVisibleContractSource).toContain(
			'...launchVectorReadouts.map((readout) => readout.state)'
		);
		expect(component).toContain('type ClusterCoverageRow = {');
		expect(component).toContain('boundary: string;');
		expect(component).toContain('boundaryGate: string;');
		expect(component).toContain('boundarySource: string;');
			expect(component).toContain('const clusterEvidenceItems = $derived<ClusterEvidenceItem[]>([');
			expect(component).toContain('const clusterCoverage = $derived<ClusterCoverageRow[]>');
			expect(component).toContain('type ClusterBalanceReadout = {');
			expect(component).toContain('const strongestCluster = $derived(');
			expect(component).toContain('const mostConstrainedCluster = $derived(');
			expect(component).toContain('const nextClusterMove = $derived(');
			expect(component).toContain('const boundedClusterCount = $derived(');
			expect(component).toContain('const heldClusterCount = $derived(');
			expect(component).toContain('const clusterBalanceReadouts = $derived<ClusterBalanceReadout[]>');
			expect(component).toContain('CAPABILITY_CLUSTER_IDS.map((id) => {');
			expect(clusterCoverageSource).toContain('...capabilityCards.map((card) => ({');
		expect(clusterCoverageSource).toContain('...compositionPaths.map((path) => ({');
		expect(clusterCoverageSource).toContain('...loopPhases.map((phase) => ({');
		expect(clusterCoverageSource).toContain('...gateRegister.map((row) => ({');
		expect(clusterCoverageSource).toContain(
			'parseCapabilityClusterIds(item.clusters).includes(id)'
		);
		expect(clusterCoverageSource).toContain('const boundary = clusterBoundaryItem(items);');
		expect(clusterCoverageSource).toContain('label: CAPABILITY_CLUSTER_LABELS[id]');
		expect(clusterCoverageSource).toContain('state: clusterCoverageState(counts, items.length)');
		expect(clusterCoverageSource).toContain("boundary?.title ??");
		expect(clusterCoverageSource).toContain("boundary?.gate ??");
		expect(clusterCoverageSource).toContain("boundarySource: boundary?.source");
			expect(component).toContain('function boundaryPriority(state: CapabilityState): number');
			expect(component).toContain('function clusterBoundaryItem(items: ClusterEvidenceItem[])');
			expect(component).toContain('function compareClusterStrength');
			expect(component).toContain('function compareClusterConstraint');
			expect(component).toContain('function compareClusterMove');
			expect(component).toContain('function compactClusterBalanceReadouts');
			expect(component).toContain(".filter((item) => item.state !== 'live')");
			expect(clusterCoverageMarkup).toContain('id="capability-cluster-coverage"');
			expect(clusterCoverageMarkup).toContain(
				'<Ratio segments={clusterCoverageSegments} height={8} />'
			);
			expect(clusterCoverageMarkup).toContain('aria-label="Capability coverage axis"');
			expect(clusterCoverageMarkup).toContain('<span>cluster</span>');
			expect(clusterCoverageMarkup).toContain('<span>state mix</span>');
			expect(clusterCoverageMarkup).toContain('<span>lead evidence</span>');
			expect(clusterCoverageMarkup).toContain('<span>next lift</span>');
			expect(clusterCoverageMarkup).toContain('aria-label="Capability portfolio balance"');
			expect(clusterCoverageMarkup).toContain(
				'{#each clusterBalanceReadouts as readout (readout.id)}'
			);
			expect(clusterCoverageMarkup).toContain(
				'<span class="cluster-balance-kicker">{readout.label}</span>'
			);
			expect(clusterCoverageMarkup).toContain(
				'<span class="cluster-balance-title">{readout.title}</span>'
			);
			expect(clusterCoverageMarkup).toContain(
				'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
			);
			expect(clusterCoverageMarkup).toContain(
				'<span class="cluster-balance-detail">{readout.detail}</span>'
			);
			expect(clusterCoverageMarkup).toContain(
				'<span class="cluster-balance-gate">{readout.gate}</span>'
			);
			expect(clusterCoverageMarkup).toContain(
				'<span class="cluster-balance-source">{readout.source}</span>'
			);
			expect(clusterCoverageMarkup).toContain('actionLabel(readout.state, readout.action)');
			expect(clusterCoverageMarkup).toContain('{#each clusterCoverage as row (row.id)}');
		expect(clusterCoverageMarkup).toContain('value={row.id}');
		expect(clusterCoverageMarkup).toContain('actionLabel(row.state, row.action)');
		expect(clusterCoverageMarkup).toContain('class="cluster-coverage-count"');
		expect(clusterCoverageMarkup).toContain(
			'Capability coverage: ${clusterCoverage.length} canonical clusters'
		);
		expect(clusterCoverageMarkup).toContain('<Datum value={clusterCoverage.length} cite="CAPABILITY_CLUSTER_IDS" />');
		expect(clusterCoverageMarkup).toContain('class="cluster-coverage-split"');
		expect(clusterCoverageMarkup).toContain(
			'<Datum value={surfacedClusterCount} cite="Capability coverage visible contracts" />'
		);
		expect(clusterCoverageMarkup).toContain(
			'<Datum value={liveClusterCount} cite="Capability coverage visible contracts" />'
		);
		expect(clusterCoverageMarkup).toContain(
			'<Datum value={boundedClusterCount} cite="Capability coverage visible contracts" />'
		);
		expect(clusterCoverageMarkup).toContain(
			'<Datum value={heldClusterCount} cite="Capability coverage visible contracts" />'
		);
		expect(clusterCoverageMarkup).not.toContain('class="cluster-coverage-copy"');
		expect(clusterCoverageMarkup).not.toContain('fully armed clusters.');
		expect(clusterCoverageMarkup).toContain("{stateLabel('live')}");
		expect(clusterCoverageMarkup).toContain("{stateLabel('partial')}");
		expect(clusterCoverageMarkup).toContain("{stateLabel('draft-only')}");
		expect(clusterCoverageMarkup).toContain("{stateLabel('gated')}");
		expect(clusterCoverageMarkup).toContain(
			'<span class="cluster-coverage-field-label">Lead evidence</span>'
		);
		expect(clusterCoverageMarkup).toContain(
			'<span class="cluster-coverage-field-label">Next lift</span>'
		);
		expect(clusterCoverageMarkup).toContain('<span>{row.boundary}</span>');
		expect(clusterCoverageMarkup).toContain(
			'<span class="cluster-coverage-gate">{row.boundaryGate}</span>'
		);
		expect(clusterCoverageMarkup).toContain('{row.source} / next: {row.boundarySource}');
		expect(clusterCoverageMarkup).not.toContain(' /> live</span');
		expect(clusterCoverageMarkup).not.toContain(' /> partial</span');
		expect(clusterCoverageMarkup).not.toContain(' /> gated</span');
		expect(loopRailMarkup).toContain('aria-label="Verified loop pressure"');
		expect(loopRailMarkup).toContain('class="loop-rail-count"');
		expect(loopRailMarkup).toContain('Verified action loop: ${loopPhases.length}');
		expect(loopRailMarkup).toContain('loopPhaseStateCounts.live');
		expect(loopRailMarkup).toContain('loopPhaseStateCounts.partial');
		expect(loopRailMarkup).toContain('heldLoopPhaseCount');
		expect(loopRailMarkup).toContain('class="loop-rail-split"');
		expect(loopRailMarkup).not.toContain(
			'Every capability claim lands on a phase, state, handoff, and gate.'
		);
		expect(component).toContain('.loop-rail-count {');
		expect(component).toContain('.loop-rail-split {');
		expect(component).not.toContain('.loop-rail-note {');
		expect(loopRailMarkup).toContain(
			'{#each loopPressureReadouts as readout (readout.id)}'
		);
		expect(loopRailMarkup).toContain(
			'<span class="loop-pressure-kicker">{readout.label}</span>'
		);
		expect(loopRailMarkup).toContain(
			'<span class="loop-pressure-title">{readout.title}</span>'
		);
		expect(loopRailMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(loopRailMarkup).toContain(
			'<span class="loop-pressure-detail">{readout.detail}</span>'
		);
		expect(loopRailMarkup).toContain('<span class="loop-pressure-gate">{readout.gate}</span>');
		expect(loopRailMarkup).toContain(
			'<span class="loop-pressure-source">{readout.source}</span>'
		);
		expect(loopRailMarkup).toContain('actionLabel(readout.state, readout.action)');
		expect(component).toContain('const studioJurisdictionScopeGate = getGateEvidence(');
		expect(component).toContain("'CP-studio-jurisdiction-scope'");
		expect(component).toContain(
			"const messageProofGate = getGateEvidence('CP-message-proof-binding'"
		);
		expect(component).toContain("name: 'Full jurisdiction resolution'");
		expect(component).toContain("name: 'Artifact proof binding'");
		expect(component).toContain("label: 'Read Studio scope and recovery'");
		expect(component).toContain("action: 'read Studio scope and recovery'");
		expect(component).toContain("handoff: 'Studio scope / recovery'");
		expect(component).not.toContain("action: 'read contract'");
		expect(component).not.toContain("action: FEATURES.DELEGATION ? 'open Studio contract'");
		expect(component).not.toContain("handoff: 'Studio contract'");
		expect(hypergraph).toContain("prefix: 'Full jurisdiction scope remains bounded.'");
		expect(hypergraph).toContain("prefix: 'Proof-bound authored-artifact lift remains bounded.'");
		expect(component).toContain("action: 'read send readiness'");
		expect(component).toContain("action: 'read gate register'");
		expect(component).toContain("action: 'open org authority'");
		expect(component).not.toContain("action: 'Open org authority'");
		expect(component).toContain('const eventArtifactMode = $derived(');
		expect(component).toContain("sendModes.find((mode) => mode.key === 'events')");
		expect(component).toContain("action: eventArtifactMode?.action ?? 'read event boundary'");
		expect(component).not.toContain(
			"action: FEATURES.EVENTS ? 'open event artifacts' : 'read event boundary'"
		);
		expect(hypergraph).toContain("action: results.hasPacket ? 'preview packet' : 'open action records'");
		expect(component).toContain('action: coalitionReadiness.action');
		expect(component).not.toContain(
			"action: FEATURES.NETWORKS ? 'open coalition proof' : 'read coalition boundary'"
		);
		expect(component).toContain('action: peopleGroundAction');
		expect(component).not.toContain("action: 'open People ledger'");
		expect(component).toContain('firstHeldPowerTerrainRow?.action ??');
		expect(component).toContain(
			"powerTerrainReadiness.terrainCount === null ? 'read Power terrain' : 'open Power terrain'"
		);
		expect(component).toContain("action: 'open CSV intake'");
		expect(component).toContain("from '$lib/data/capability-clusters'");
		expect(component).toContain('CAPABILITY_CLUSTER_IDS,');
		expect(component).toContain('CAPABILITY_CLUSTER_LABELS,');
		expect(component).toContain('parseCapabilityClusterIds,');
		expect(component).toContain('type CapabilityClusterId');
		expect(component).not.toContain('clusterName');
		expect(component).toContain(
			'function capabilityCardClusterLabel(cluster: CapabilityClusterId): string'
		);
		expect(component).toContain('return formatCapabilityClusters(cluster);');
		expect(component).toContain('name: capabilityCardClusterLabel(card.cluster)');
		expect(capabilityClusters).toContain('export const CAPABILITY_CLUSTER_LABELS = {');
		for (const clusterLabel of [
			"'C-verification': 'verification'",
			"'C-reach': 'reach'",
			"'C-composability': 'composability'",
			"'C-agentic': 'agentic systems'",
			"'C-quality-signaling': 'quality signaling'",
			"'C-accountability': 'accountability'",
			"'C-coordination-integrity': 'coordination integrity'",
			"'C-reader-side': 'reader-side UX'",
			"'C-data-sovereignty': 'data sovereignty'"
		]) {
			expect(capabilityClusters).toContain(clusterLabel);
		}
		expect(capabilityClusters).toContain(
			'export function formatCapabilityClusters(value: string): string'
		);
		expect(capabilityClusters).toContain('export const CAPABILITY_CLUSTER_IDS');
		expect(capabilityClusters).toContain(
			'export function resolveCapabilityClusterId(token: string): CapabilityClusterId | null'
		);
		expect(capabilityClusters).toContain(
			'export function parseCapabilityClusterIds(value: string): CapabilityClusterId[]'
		);
		expect(capabilityClusters).toContain("return `invalid cluster: ${trimmed || 'empty'}`;");
		expect(component).toContain('formatCapabilityClusters,');
		expect(workspaceStrip).toContain(
			"import { formatCapabilityClusters } from '$lib/data/capability-clusters';"
		);
		expect(workspaceStrip).toContain('<span>{formatCapabilityClusters(item.cluster)}</span>');
		expect(workspaceStrip).not.toContain('<span>{item.cluster}</span>');
		expect(workspaceStrip).toContain('verb: string;');
		expect(workspaceStrip).toContain('operatorCapabilityStateVerbLabel');
		expect(workspaceStrip).toContain("verb: stateVerbLabel('live')");
		expect(workspaceStrip).toContain("verb: stateVerbLabel('partial')");
		expect(workspaceStrip).toContain("verb: stateVerbLabel('draft-only')");
		expect(workspaceStrip).toContain("verb: stateVerbLabel('gated')");
		expect(workspaceStrip).toContain('function stateVerbLabel(state: CapabilityState): string');
		expect(workspaceStrip).toContain('return operatorCapabilityStateVerbLabel(state);');
		expect(workspaceStrip).toContain(
			'return `${item.label}. ${stateLabel(item.state)}. Claim grammar: ${stateVerbLabel(item.state)}.'
		);
		expect(workspaceStrip).toContain('operatorCapabilityActionLabel');
		expect(workspaceStrip).toContain(
			'return operatorCapabilityActionLabel(item.state, item.action, { appendReadyArrow: true });'
		);
		expect(workspaceStrip).toContain('<span class="contract-verb">{contract.verb}</span>');
		expect(workspaceStrip).toContain(
			'<span class="pressure-verb">{stateVerbLabel(pressureItem.state)}</span>'
		);
		expect(workspaceStrip).toContain(
			'<span class="strip-verb">{stateVerbLabel(item.state)}</span>'
		);
		expect(component).not.toContain('linear-gradient(');
		expect(component).not.toContain('radial-gradient(');
		expect(component).toContain('background: var(--surface-base, oklch(0.993 0.003 60));');
		for (const canonicalClusterSource of [
			loopPhaseSource,
			compositionSource,
			capabilityShiftSource
		]) {
			expect(canonicalClusterSource).toContain("C-verification");
			expect(canonicalClusterSource).toContain("C-reach");
			expect(canonicalClusterSource).not.toMatch(
				/clusters?: '(verification|reach|agentic systems|reader-side UX|data sovereignty|coordination integrity|accountability|quality signaling|composability)(\s\/|')/
			);
		}
		expect(component).toContain('const studioAuthoringArtifactRow = $derived(');
		expect(component).toContain("studioAuthoringRows.find((row) => row.key === 'message-composition')");
		expect(component).toContain('const authoringLoopState = $derived(');
		expect(component).toContain('const authoringLoopMetric = $derived({');
		expect(component).toContain('const authoringLoopSummary = $derived(');
		expect(component).toContain('const authoringLoopNextLift = $derived(');
		expect(component).toContain(
			'`Author artifact is ${stateLabel(authoringLoopState)}: ${authoringLoopGround}`'
		);
		expect(loopPhaseSource).toContain("id: 'AUTHOR'");
		expect(loopPhaseSource).toContain("label: 'Author artifact'");
		expect(loopPhaseSource).toContain('state: authoringLoopState');
		expect(loopPhaseSource).toContain('summary: authoringLoopGround');
		expect(loopPhaseSource).toContain('unlock: authoringLoopGate');
		expect(loopPhaseSource).toContain('metric: authoringLoopMetric');
		expect(peopleGroundLoopPhase).toContain("id: 'GROUND'");
		expect(peopleGroundLoopPhase).toContain('state: peopleGroundState');
		expect(peopleGroundLoopPhase).toContain('href: peopleGroundHref');
		expect(peopleGroundLoopPhase).toContain('summary: peopleGroundSummary');
		expect(peopleGroundLoopPhase).toContain('unlock: peopleGroundGate');
		expect(peopleGroundLoopPhase).toContain('value: peopleGroundMetric.value');
		expect(peopleGroundLoopPhase).toContain('label: peopleGroundMetric.label');
		expect(peopleGroundLoopPhase).toContain('cite: peopleGroundMetric.cite');
		expect(peopleGroundLoopPhase).not.toContain("state: 'partial'");
		expect(peopleGroundLoopPhase).not.toContain('People and Shadow Atlas ground reach');
		expect(peopleGroundLoopPhase).not.toContain('people?.identityVerified');
		expect(powerResolveLoopPhase).toContain("id: 'RESOLVE'");
		expect(powerResolveLoopPhase).toContain('state: powerTerrainReadiness.state');
		expect(powerResolveLoopPhase).toContain(
			'firstHeldPowerTerrainRow?.href ?? `${base}/representatives#power-reach-boundary`'
		);
		expect(powerResolveLoopPhase).toContain('summary: powerTerrainReadiness.effect');
		expect(powerResolveLoopPhase).toContain(
			'unlock: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate'
		);
		expect(powerResolveLoopPhase).toContain('value: powerTerrainReadiness.terrainCount');
		expect(powerResolveLoopPhase).toContain(
			"cite: 'buildPowerTerrainReadiness'"
		);
		expect(powerResolveLoopPhase).not.toContain("state: 'partial'");
		expect(powerResolveLoopPhase).not.toContain('reachExpansionGate');
		expect(powerResolveLoopPhase).not.toContain('power?.followedCount');
		expect(powerResolveLoopPhase).not.toContain("label: 'tracked targets'");
		expect(powerResolveLoopPhase).not.toContain("cite: 'legislation.listOrgDmFollows'");
		expect(loopPhaseSource).not.toContain("label: 'Generate grounded message'");
		expect(loopPhaseSource).not.toContain(
			"id: 'AUTHOR',\n\t\t\tlabel: 'Author artifact',\n\t\t\tstate: 'live'"
		);
		expect(component).toContain('summary: `${authoringLoopSummary}; bounded phases keep their gates visible.`');
		expect(component).toContain(
			"authoringLoopState === 'live' ? 'Authoring rail is armed' : 'Authoring rail is bounded'"
		);
		expect(component).toContain('detail: authoringLoopSummary');
		expect(component).toContain('title: \'Authoring becomes visible work\'');
		expect(component).toContain(
			'to: \'Commons mode: intent, source ground, target resolve, artifact output, recovery, trace, and delegation each carry their own readiness row.\''
		);
		expect(component).toContain('evidence: studioAuthoringReadiness.detail');
		expect(component).not.toContain('Intent and authoring are armed');
		expect(component).not.toContain('Intent and authoring run as real streams');
		expect(component).not.toContain("title: 'AI becomes visible authoring'");
		expect(component).not.toContain("label: 'live loop phases'");
		for (const visibleClusterSlot of [
			'<span>{formatCapabilityClusters(path.clusters)}</span>',
			'{formatCapabilityClusters(row.cluster)} / {row.gate.source}',
			'<span>{formatCapabilityClusters(phase.clusters)}</span>',
			'<span class="shift-cluster">{formatCapabilityClusters(shift.cluster)}</span>',
			'<span class="queue-cluster">{formatCapabilityClusters(item.cluster)}</span>',
			'<span class="cascade-clusters">{formatCapabilityClusters(item.clusters)}</span>',
			'<span class="gate-clusters">{formatCapabilityClusters(row.gate.clusters)}</span>',
			'<span class="mode-cluster">{formatCapabilityClusters(mode.cluster)}</span>'
		]) {
			expect(component).toContain(visibleClusterSlot);
		}
		expect(component).not.toContain('<span class="mode-cluster">{mode.cluster}</span>');
		expect(component).not.toContain('<span class="queue-cluster">{item.cluster}</span>');
		expect(component).not.toContain('<span class="shift-cluster">{shift.cluster}</span>');
		expect(component).not.toContain('reader-side proof');
		for (const genericMapAction of [
			"action: 'inspect",
			"action: packet ? 'inspect",
			"'inspect gate'",
			"'inspect proof'",
			"'inspect artifacts'",
			"'inspect Send'",
			"'inspect intake'",
			"label: 'Inspect Studio scope and recovery'",
			"label: 'Inspect proof artifact'"
		]) {
			expect(component).not.toContain(genericMapAction);
		}
		expect(component).toContain('function heldContractPressureDetail');
		expect(component).toContain('can shape or preserve work without side effects');
		expect(component).toContain(
			"route to dependency-first ${stateVerbLabel('gated')} boundaries"
		);
		expect(component).not.toContain('downgraded action grammar');
		expect(component).toContain('buildPlatformIntakeReadiness,');
		expect(component).toContain('type PlatformApiProofRow');
		expect(component).toContain('type PlatformIntakeProfileRow');
		expect(component).toContain('type PlatformIntakeStageRow');
		expect(component).toContain('const platformIntakeReadiness = $derived(');
		expect(component).toContain('buildPlatformIntakeReadiness({');
		expect(component).toContain('const platformApiProofRows = $derived<PlatformApiProofRow[]>');
		expect(component).toContain('const platformApiProofStateCounts = $derived');
		expect(component).toContain('const platformApiProofSegments = $derived');
		expect(component).toContain('const heldPlatformApiProofCount = $derived');
		expect(component).not.toContain("from '$lib/data/platform-export-profiles'");
		expect(component).not.toContain(
			'const platformExportProfiles = PLATFORM_EXPORT_PROFILES.map((profile) => profile.label)'
		);
		expect(hypergraph).toContain('PLATFORM_API_RUNNER_PROOF_REQUIREMENTS,');
		expect(hypergraph).toContain('PLATFORM_EXPORT_PROFILES');
		expect(hypergraph).toContain('export type PlatformIntakeStageRow = {');
		expect(hypergraph).toContain('export type PlatformApiProofRow = {');
		expect(hypergraph).toContain('export function buildPlatformIntakeReadiness');
		expect(hypergraph).toContain('stageRows: PlatformIntakeStageRow[];');
		expect(hypergraph).toContain('proofRows: PlatformApiProofRow[];');
		expect(hypergraph).toContain("id: 'export-recognition'");
		expect(hypergraph).toContain("id: 'credential-custody'");
		expect(hypergraph).toContain("id: 'direct-api-runner'");
		expect(hypergraph).toContain("id: 'profile-registry'");
		expect(hypergraph).toContain("id: 'import-safety'");
		expect(hypergraph).toContain("id: 'continuation-checkpoint'");
		expect(hypergraph).toContain('csvHref: string;');
		expect(hypergraph).toContain('apiHref: string;');
		expect(hypergraph).toContain('csvAction: string;');
		expect(hypergraph).toContain('apiAction: string;');
		expect(hypergraph).toContain('const csvHref = `${base}/supporters/import#csv-intake`;');
		expect(hypergraph).toContain(
			'const apiHref = `${base}/supporters/import/platform-api#platform-connection-boundary`;'
		);
		expect(hypergraph).toContain(
			'CSV export recognition and source custody are armed; direct platform sync remains dependency-first.'
		);
		expect(hypergraph).toContain(
			'The operator-facing capability is source-custody intake across export formats'
		);
		expect(platformProfiles).toContain("'EveryAction / NGP VAN'");
		expect(platformProfiles).toContain('export const PLATFORM_API_RUNNER_PROOF_REQUIREMENTS');
		expect(platformProfiles).toContain("'resource pagination'");
		expect(platformProfiles).toContain("'consent and suppression mapping'");
		expect(platformProfiles).toContain("'idempotent source-key upsert'");
		expect(platformProfiles).toContain("'rate-limit backoff'");
		expect(platformProfiles).toContain("'chunked continuation checkpoint'");
		expect(platformProfiles).toContain("'NationBuilder'");
		expect(platformProfiles).toContain("'Mailchimp'");
		expect(platformProfiles).toContain("'Salsa Engage'");
		expect(platformProfiles).toContain("'Mobilize'");
		expect(platformProfiles).toContain("'ActBlue'");
		expect(platformProfiles).toContain("'Engaging Networks'");
		expect(platformProfiles).toContain("'CiviCRM'");
		expect(platformProfiles).toContain("'Salesforce / Nonprofit Cloud'");
		expect(component).toContain(
			'const platformExportProfileCount = $derived(platformIntakeReadiness.profileCount)'
		);
		expect(component).not.toContain('const platformExportProfileSignal = platformExportProfiles.join');
		expect(component).not.toContain('type PlatformProfileRow = {');
		expect(component).not.toContain('const platformApiRunnerState = $derived<CapabilityState>');
		expect(component).toContain(
			'const platformProfileRows = $derived<PlatformIntakeProfileRow[]>(platformIntakeReadiness.rows)'
		);
		expect(component).toContain(
			'const platformIntakeStageRows = $derived<PlatformIntakeStageRow[]>'
		);
		expect(component).toContain('const platformProfileStateCounts = $derived');
		expect(component).toContain('const platformProfileCsvStateCounts = $derived');
		expect(component).toContain('const platformProfileApiStateCounts = $derived');
		expect(component).toContain('const heldPlatformProfileCsvCount = $derived');
		expect(component).toContain('const heldPlatformProfileApiCount = $derived');
		expect(component).toContain('const platformProfileSegments = $derived');
		expect(component).toContain("labelSuffix: ' source-custody contracts'");
		expect(component).toContain('type PlatformProfilePressureReadout = {');
		expect(platformProfilePressureSource).toContain('const exportRecognitionStage = $derived');
		expect(platformProfilePressureSource).toContain('const directPlatformSyncStage = $derived');
		expect(platformProfilePressureSource).toContain(
			'const platformProfilePressureReadouts = $derived<PlatformProfilePressureReadout[]>(['
		);
		expect(platformProfilePressureSource).toContain("id: 'recognized-exports'");
		expect(platformProfilePressureSource).toContain("id: 'source-custody'");
		expect(platformProfilePressureSource).toContain("id: 'direct-sync-boundary'");
		expect(platformProfilePressureSource).toContain("label: 'Recognized exports'");
		expect(platformProfilePressureSource).toContain("label: 'Source custody'");
		expect(platformProfilePressureSource).toContain("label: 'Direct sync boundary'");
		expect(platformProfilePressureSource).toContain('peopleSourceProvenanceReadiness.signal');
		expect(platformProfilePressureSource).toContain('peopleSourceProvenanceReadiness.detail');
		expect(platformProfilePressureSource).toContain('platformIntakeReadiness.apiBoundaryCount');
		expect(platformProfilePressureSource).toContain("source: 'buildPlatformIntakeReadiness'");
		expect(platformProfilePressureSource).toContain(
			"source: 'buildPeopleSourceProvenanceReadiness'"
		);
		expect(platformProfilePressureSource).toContain("source: 'getPlatformApiSyncReadiness'");
		expect(clusterCoverageSource).toContain('...platformIntakeStageRows.map((row) => ({');
		expect(clusterCoverageSource).toContain('title: row.handoff');
		expect(visibleContractSource).toContain(
			'...platformProfilePressureReadouts.map((readout) => readout.state),'
		);
		expect(visibleContractSource).toContain(
			'...platformIntakeStageRows.map((row) => row.state),'
		);
		expect(visibleContractSource).toContain(
			'...platformProfileRows.flatMap((row) => [row.csvState, row.apiState])'
		);
		expect(component).toContain('buildPowerTerrainReadiness,');
		expect(component).toContain('type PowerTerrainRow');
		expect(component).toContain("const powerStateLocalTerrainGate = getGateEvidence(");
		expect(component).toContain("'CP-state-local-terrain'");
		expect(component).toContain("const powerInternationalTerrainGate = getGateEvidence(");
		expect(component).toContain("'CP-international-power-terrain'");
		expect(component).toContain('const powerStateBillTerrainGate = getGateEvidence');
		expect(component).toContain("'CP-state-bill-terrain'");
		expect(component).toContain("const powerNonFederalScorecardGate = getGateEvidence(");
		expect(component).toContain("'CP-non-federal-scorecards'");
		expect(component).toContain('const powerOfficeResponseGate = getGateEvidence');
		expect(component).toContain("'CP-reader-office-profile'");
		expect(component).toContain('const powerTerrainReadiness = $derived(');
		expect(component).toContain('buildPowerTerrainReadiness({');
		expect(component).not.toContain('const powerJoinedTerrainGate = $derived');
		expect(component).toContain(
			'const powerTerrainRows = $derived<PowerTerrainRow[]>(powerTerrainReadiness.rows)'
		);
		expect(hypergraph).toContain('export function buildPowerTerrainReadiness');
		expect(hypergraph).toContain('Power connects target records, bills, and score snapshots');
		expect(component).toContain('const powerTerrainStateCounts = $derived');
		expect(component).toContain('const powerTerrainSegments = $derived');
		expect(component).toContain("labelSuffix: ' terrain contracts'");
		expect(component).toContain('type PowerTerrainPressureReadout = {');
		expect(powerTerrainPressureSource).toContain('const heldPowerTerrainRows = $derived');
		expect(powerTerrainPressureSource).toContain('const firstHeldPowerTerrainRow = $derived');
		expect(powerTerrainPressureSource).toContain(
			'const powerTerrainPressureReadouts = $derived<PowerTerrainPressureReadout[]>(['
		);
		expect(powerTerrainPressureSource).toContain("id: 'loaded-terrain'");
		expect(powerTerrainPressureSource).toContain("id: 'held-terrain'");
		expect(powerTerrainPressureSource).toContain("id: 'next-terrain-lift'");
		expect(powerTerrainPressureSource).toContain("label: 'Loaded terrain'");
		expect(powerTerrainPressureSource).toContain("label: 'Held terrain'");
		expect(powerTerrainPressureSource).toContain("label: 'Next terrain lift'");
		expect(powerTerrainPressureSource).toContain('powerTerrainReadiness.terrainCount');
		expect(powerTerrainPressureSource).toContain('heldPowerTerrainRows.length');
		expect(powerTerrainPressureSource).toContain('firstHeldPowerTerrainRow?.boundary');
		expect(powerTerrainPressureSource).toContain("?? 'buildPowerTerrainReadiness'");
		expect(visibleContractSource).toContain('...powerTerrainRows.map((row) => row.state),');
		expect(visibleContractSource).toContain(
			'...powerTerrainPressureReadouts.map((readout) => readout.state),'
		);
		expect(platformProfileMarkup).toContain('Source portability');
		expect(platformProfileMarkup).toContain('Incumbent exports become source custody');
		expect(platformProfileMarkup).toContain('class="profile-axis" aria-label="Source portability axis"');
		expect(platformProfileMarkup).not.toContain('Platform profile recognition');
		expect(platformProfileMarkup).not.toContain('Exports become provenance');
		expect(platformProfileMarkup).not.toContain('Platform profile axis');
		expect(platformProfileMarkup).toContain('<span>export</span>');
		expect(platformProfileMarkup).toContain('<span>custody</span>');
		expect(platformProfileMarkup).toContain('<span>sync</span>');
		expect(platformProfileMarkup).toContain('<span>gate</span>');
		expect(platformProfileMarkup).toContain('aria-label="Source custody pressure"');
		expect(platformProfileMarkup).not.toContain('aria-label="Platform profile pressure"');
		expect(platformProfileMarkup).toContain(
			'{#each platformProfilePressureReadouts as readout (readout.id)}'
		);
		expect(platformProfileMarkup).toContain('class="profile-pressure-cell"');
		expect(platformProfileMarkup).toContain(
			'<span class="profile-pressure-kicker">{readout.label}</span>'
		);
		expect(platformProfileMarkup).toContain(
			'<span class="profile-pressure-title">{readout.title}</span>'
		);
		expect(platformProfileMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(platformProfileMarkup).toContain(
			'<span class="profile-pressure-detail">{readout.detail}</span>'
		);
		expect(platformProfileMarkup).toContain(
			'<span class="profile-pressure-gate">{readout.gate}</span>'
		);
		expect(platformProfileMarkup).toContain(
			'<span class="profile-pressure-source">{readout.source}</span>'
		);
		expect(platformProfileMarkup).toContain('actionLabel(readout.state, readout.action)');
		expect(platformProfileMarkup).not.toContain('class="profile-note"');
		expect(platformProfileMarkup).not.toContain('{platformIntakeReadiness.effect}');
		expect(platformProfileMarkup).not.toContain('{platformIntakeReadiness.boundary}');
		expect(platformProfileMarkup).toContain(
			'aria-label="Platform intake operating stages"'
		);
		expect(platformProfileMarkup).toContain(
			'{#each platformIntakeStageRows as row (row.id)}'
		);
		expect(platformProfileMarkup).toContain(
			'<span class="profile-stage-kicker">{row.label}</span>'
		);
		expect(platformProfileMarkup).toContain(
			'<span class="profile-stage-title">{row.handoff}</span>'
		);
		expect(platformProfileMarkup).toContain(
			'<span class="profile-stage-cluster">{formatCapabilityClusters(row.clusters)}</span>'
		);
		expect(platformProfileMarkup).toContain(
			'<Datum value={row.metric.value} cite={row.metric.cite} />'
		);
		expect(platformProfileMarkup).toContain(
			'<span class="profile-stage-effect">{row.effect}</span>'
		);
		expect(platformProfileMarkup).toContain(
			'<span class="profile-stage-gate">{row.gate}</span>'
		);
		expect(platformProfileMarkup).toContain('actionLabel(row.state, row.action)');
		expect(platformProfileMarkup).toContain('<Ratio segments={platformProfileSegments} height={8} />');
		expect(platformProfileMarkup).toContain('class="profile-contract-count"');
		expect(platformProfileMarkup).toContain(
			'Source portability contract: ${platformExportProfileCount} recognized profiles'
		);
		expect(platformProfileMarkup).toContain('class="profile-contract-total"');
		expect(platformProfileMarkup).toContain(
			'<Datum value={platformExportProfileCount} cite="PLATFORM_EXPORT_PROFILES.length" />'
		);
		expect(platformProfileMarkup).toContain('class="profile-contract-split"');
		expect(platformProfileMarkup).toContain(
			'<Datum value={platformProfileCsvStateCounts.live} cite="buildPlatformIntakeReadiness" />'
		);
		expect(platformProfileMarkup).toContain(
			'<Datum value={heldPlatformProfileCsvCount} cite="buildPlatformIntakeReadiness" />'
		);
		expect(platformProfileMarkup).toContain(
			'<Datum value={platformProfileApiStateCounts.live} cite="buildPlatformIntakeReadiness" />'
		);
		expect(platformProfileMarkup).toContain(
			'<Datum value={heldPlatformProfileApiCount} cite="buildPlatformIntakeReadiness" />'
		);
		expect(platformProfileMarkup).toContain('direct sync');
		expect(platformProfileMarkup).not.toContain('class="profile-contract-copy"');
		expect(platformProfileMarkup).not.toContain(
			'recognized export profiles; {platformIntakeReadiness.detail}'
		);
		expect(platformProfileMarkup).toContain('{#each platformProfileRows as row (row.source)}');
		expect(platformProfileMarkup).toContain('aria-label="Recognized incumbent export profiles"');
		expect(platformProfileMarkup).not.toContain('aria-label="Recognized platform export profiles"');
		expect(platformVendorGridMarkup).not.toContain('href={row.href}');
		expect(platformProfileMarkup).toContain('href={row.csvHref}');
		expect(platformProfileMarkup).toContain('href={row.apiHref}');
		expect(platformProfileMarkup).toContain('<RegistryMark variant="tag" value={row.source} copy={false} />');
		expect(platformProfileMarkup).toContain('<span>CSV profile</span>');
		expect(platformProfileMarkup).toContain('<span>Direct sync</span>');
		expect(platformProfileMarkup).toContain('{stateLabel(row.csvState)}');
		expect(platformProfileMarkup).toContain('{stateLabel(row.apiState)}');
		expect(platformProfileMarkup).toContain('platform export profile header signatures');
		expect(platformProfileMarkup).toContain('profile-api-proof');
		expect(platformProfileMarkup).toContain('{row.apiProofSummary}');
		expect(platformProfileMarkup).toContain('direct sync proof checklist');
		expect(platformProfileMarkup).toContain('Direct platform sync proof contract');
		expect(platformProfileMarkup).toContain('{#each platformApiProofRows as row (row.id)}');
		expect(platformProfileMarkup).toContain('buildPlatformIntakeReadiness proofRows');
		expect(platformProfileMarkup).toContain('heldPlatformApiProofCount');
		expect(platformProfileMarkup).toContain('sync checks');
		expect(platformProfileMarkup).toContain('{actionLabel(row.apiState, row.apiAction)}');
		expect(component).toContain(".profile-pressure-cell[data-state='draft-only']");
		expect(component).toContain(".profile-pressure-cell[data-state='gated']");
		expect(spacesContract).toContain('export type PeopleSegmentationGroundData = {');
		expect(spacesContract).toContain('segmentation: PeopleSegmentationGroundData | null;');
		expect(layoutServer).toContain('PeopleSegmentationGroundData,');
		expect(layoutServer).toContain('api.segments.list');
		expect(layoutServer).toContain('function buildPeopleSegmentationGround(');
		expect(layoutServer).toContain('humanReadableGeographyConditionCount');
		expect(layoutServer).toContain('segmentation: Array.isArray(segmentsResult?.segments)');
		expect(hypergraph).toContain('export function buildPeopleSegmentationReadiness');
		expect(peopleSegmentationReadinessSource).toContain("label: 'Saved cohort definitions'");
		expect(peopleSegmentationReadinessSource).toContain("label: 'Proof and reach filters'");
		expect(peopleSegmentationReadinessSource).toContain("label: 'Source custody filters'");
		expect(peopleSegmentationReadinessSource).toContain("label: 'Action-context filters'");
		expect(peopleSegmentationReadinessSource).toContain(
			"label: 'Readable state and district labels'"
		);
		expect(peopleSegmentationReadinessSource).toContain(
			'A district hash is not a readable state, congressional, local, or special-district label; action-time district labels are not materialized local or special-district membership.'
		);
		expect(peopleSegmentationReadinessSource).toContain(
			'Source filters preserve origin across CSV and organizing-platform exports'
		);
		expect(peopleSegmentationReadinessSource).toContain(
			'Segments are filter definitions, not data containers.'
		);
		expect(peopleSegmentationReadinessSource).toContain(
			"unreadGroundBoundary('People source custody', 'source-origin custody claims')"
		);
		expect(peopleSegmentationReadinessSource).toContain(
			"unreadGroundBoundary('People segmentation', 'saved cohort posture claims')"
		);
		expect(peopleSegmentationReadinessSource).toContain(
			"unreadGroundBoundary('People segmentation', 'readable civic-geography label claims')"
		);
		for (const stalePeopleSegmentationCopy of [
			'People source provenance is unavailable because the People slice did not load.',
			'People source custody is unavailable because the People slice did not load.',
			'The OS must not claim source custody until supporters.getSummaryStats provides aggregate sourceCounts.',
			'Saved segment definitions are unread; the OS cannot claim cohort posture.',
			'People segmentation ground is unread; the OS cannot claim saved cohort posture.'
		]) {
			expect(peopleSegmentationReadinessSource).not.toContain(stalePeopleSegmentationCopy);
		}
		expect(layout).toContain('buildPeopleSegmentationReadiness,');
		expect(layout).toContain('const peopleSegmentation = $derived(data.spaces.base?.segmentation ?? null)');
		expect(layout).toContain('const peopleSegmentationReadiness = $derived(');
		expect(layout).toContain('buildPeopleSegmentationReadiness({');
		expect(layout).toContain("label: 'Segmentation posture'");
		expect(layout).toContain("sublabel: 'Saved cohorts + civic geography boundary'");
		expect(layout).toContain("id: 'capability-people-segmentation'");
		expect(layout).toContain("label: 'People segmentation posture'");
		expect(layout).toContain('href: `${base}/studio#capability-people-segmentation`');
		expect(layout).toContain(
			"action: spotlightActionForState(\n\t\t\t\tpeopleSegmentationReadiness.state,"
		);
		expect(peopleSpace).toContain('buildPeopleSegmentationReadiness,');
		expect(peopleSpace).toContain('type PeopleSegmentationReadinessRow');
		expect(peopleSpace).toContain('const peopleSegmentation = $derived(data?.segmentation ?? null)');
		expect(peopleSpace).toContain('const peopleSegmentationReadiness = $derived(');
		expect(peopleSpace).toContain("label: 'People segmentation posture'");
		expect(peopleSpace).toContain('metric: peopleSegmentationReadiness.metric');
		expect(peopleSpace).toContain('id="people-segments"');
		expect(peopleSpace).toContain('aria-label="People segmentation posture"');
		expect(peopleSpace).toContain('{#each peopleSegmentationRows as row (row.id)}');
		expect(peopleSpace).toContain('{row.phase} / {formatCapabilityClusters(row.clusters)}');
		expect(peopleSpace).toContain('{stateLabel(row.state)}');
		expect(component).toContain('buildPeopleSegmentationReadiness,');
		expect(component).toContain('type PeopleSegmentationReadinessRow');
		expect(component).toContain('const peopleSegmentation = $derived(people?.segmentation ?? null)');
		expect(component).toContain(
			'const peopleSegmentationRows = $derived<PeopleSegmentationReadinessRow[]>'
		);
		expect(component).toContain('const peopleSegmentationStateCounts = $derived');
		expect(component).toContain('const peopleSegmentationSegments = $derived');
		expect(component).toContain('const heldPeopleSegmentationCount = $derived');
		expect(component).toContain("labelSuffix: ' segment contracts'");
		expect(visibleContractSource).toContain('...peopleSegmentationRows.map((row) => row.state),');
		expect(peopleSegmentationCard).toContain("workspace: 'People'");
		expect(peopleSegmentationCard).toContain("phase: 'GROUND / SEND'");
		expect(peopleSegmentationCard).toContain('state: peopleSegmentationReadiness.state');
		expect(peopleSegmentationCard).toContain('statement: peopleSegmentationReadiness.effect');
		expect(peopleSegmentationCard).toContain('evidence: peopleSegmentationReadiness.detail');
		expect(peopleSegmentationCard).toContain('nextGate: peopleSegmentationReadiness.nextGate');
		expect(component).toContain("id: 'SHIFT-SEGMENTATION'");
		expect(component).toContain('Segments become civic posture');
		expect(component).toContain("name: 'People segmentation posture'");
		expect(component).toContain(
			"source: 'People segmentation slice + civic geography label gate'"
		);
		expect(component).toContain("cite: 'buildPeopleSegmentationReadiness'");
		expect(operatorQueueCandidateSource).toContain("label: 'Read segmentation posture'");
		expect(operatorQueueCandidateSource).toContain('state: peopleSegmentationReadiness.state');
		expect(operatorQueueCandidateSource).toContain('effect: peopleSegmentationReadiness.effect');
		expect(operatorQueueCandidateSource).toContain('detail: peopleSegmentationReadiness.detail');
		expect(operatorQueueCandidateSource).toContain('gate: peopleSegmentationReadiness.gate');
		expect(peopleSegmentationMarkup).toContain('People segmentation posture');
		expect(peopleSegmentationMarkup).toContain('Where cohorts become proof-weighted reach');
		expect(peopleSegmentationMarkup).toContain('class="terrain-count"');
		expect(peopleSegmentationMarkup).toContain(
			'People segmentation posture: ${peopleSegmentationRows.length}'
		);
		expect(peopleSegmentationMarkup).toContain('peopleSegmentationStateCounts.live');
		expect(peopleSegmentationMarkup).toContain('peopleSegmentationStateCounts.partial');
		expect(peopleSegmentationMarkup).toContain('heldPeopleSegmentationCount');
		expect(peopleSegmentationMarkup).toContain('class="terrain-count-split"');
		expect(peopleSegmentationMarkup).not.toContain(
			'Action-district hashes are evidence only; action-time district labels do not imply full'
		);
		expect(peopleSegmentationMarkup).toContain(
			'<Ratio segments={peopleSegmentationSegments} height={8} />'
		);
		expectTerrainContractCount(peopleSegmentationMarkup, {
			label: 'People segmentation',
			rows: 'peopleSegmentationRows',
			stateCounts: 'peopleSegmentationStateCounts',
			cite: 'buildPeopleSegmentationReadiness'
		});
		expect(component).toContain('.terrain-count {');
		expect(component).toContain('.terrain-count-split {');
		expect(component).not.toContain('.terrain-note {');
		expect(component.match(/class="terrain-contract-count"/g)?.length ?? 0).toBe(15);
		expect(component).toContain('.terrain-contract-count {');
		expect(component).toContain('.terrain-contract-split {');
		expect(component).not.toContain('terrain-contract-copy');
		expect(peopleSegmentationMarkup).toContain(
			'<Datum value={peopleSegmentationRows.length} cite="buildPeopleSegmentationReadiness" />'
		);
		expect(peopleSegmentationMarkup).toContain(
			'aria-label="People segmentation readiness matrix"'
		);
		expect(peopleSegmentationMarkup).toContain('{#each peopleSegmentationRows as row (row.id)}');
		expect(peopleSegmentationMarkup).toContain(
			'{row.phase} / {formatCapabilityClusters(row.clusters)}'
		);
		expect(peopleSegmentationMarkup).toContain('{row.ground}');
		expect(peopleSegmentationMarkup).toContain('{row.boundary}');
		expect(peopleSegmentationMarkup).toContain('{actionLabel(row.state, row.action)}');
		expect(hypergraph).toContain('export function buildEmailListHealthReadiness');
		expect(emailListHealthReadinessSource).toContain("label: 'Reachable subscribed cohort'");
		expect(emailListHealthReadinessSource).toContain("label: 'Suppression status ledger'");
		expect(emailListHealthReadinessSource).toContain("label: 'Consent evidence custody'");
		expect(emailListHealthReadinessSource).toContain("label: 'Unsubscribe consent path'");
		expect(emailListHealthReadinessSource).toContain(
			"label: 'Bounce and complaint attribution'"
		);
		expect(emailListHealthReadinessSource).toContain(
			"unreadGroundBoundary('People list health', 'reachable-list posture claims')"
		);
		expect(emailListHealthReadinessSource).toContain(
			"unreadGroundBoundary('People list health', 'email consent-evidence claims')"
		);
		expect(emailListHealthReadinessSource).toContain(
			"unreadGroundBoundary('People list health', 'consent-bound reach claims')"
		);
		for (const staleListHealthCopy of [
			'People email-health counts are unread; the OS cannot claim reachable list posture.',
			'Suppression statuses are unread.',
			'Email consent evidence counts are unread.',
			'Unsubscribe status ground is unread.',
			'People list health is unread; the OS cannot claim consent-bound reach.'
		]) {
			expect(emailListHealthReadinessSource).not.toContain(staleListHealthCopy);
		}
		expect(emailListHealthReadinessSource).toContain("id: 'manual-report-consensus'");
		expect(emailListHealthReadinessSource).toContain("label: 'Verified report consensus'");
		expect(emailListHealthReadinessSource).toContain(
			'Two independent verified bounce reports can suppress a canonical global email hash'
		);
		expect(emailListHealthReadinessSource).toContain(
			'This surface does not load pending report counts'
		);
		expect(emailListHealthReadinessSource).toContain(
			"cite: 'convex.email processBounceReports consensus path'"
		);
			expect(emailListHealthReadinessSource).toContain("label: 'List-Unsubscribe headers'");
			expect(emailListHealthReadinessSource).toContain("label: 'Mailbox unsubscribe rendering'");
		expect(emailListHealthReadinessSource).toContain(
			"label: 'Sender domain authentication'"
		);
		expect(emailListHealthReadinessSource).toContain("'read sender-domain evidence'");
		expect(emailListHealthReadinessSource).toContain("'read sender-domain boundary'");
		expect(emailListHealthReadinessSource).not.toContain("'open sender domains'");
		expect(emailListHealthReadinessSource).not.toContain("'read domain gate'");
		expect(emailListHealthReadinessSource).toContain(
			'per-org From domains, DKIM, and DMARC verification remain not armed'
		);
		expect(emailListHealthReadinessSource).not.toContain(
			'per-org From domains, DKIM, and DMARC verification are not implemented'
		);
		expect(emailListHealthReadinessSource).toContain('without inventing an inbox-placement score');
		expect(emailListHealthReadinessSource).toContain(
			"cite: 'supporters.getSummaryStats emailHealth'"
		);
		expect(emailListHealthReadinessSource).toContain(
			"cite: 'supporters.getSummaryStats consentEvidence.email'"
			);
			expect(emailListHealthReadinessSource).toContain("cite: 'T2-4 list-unsubscribe-convex-path'");
			expect(emailListHealthReadinessSource).toContain(
				"cite: 'T2-4b list-unsubscribe-provider-verification'"
			);
			expect(emailListHealthReadinessSource).toContain("cite: 'T2-6 custom-domain-dkim'");
			expect(layout).toContain('buildEmailListHealthReadiness,');
			expect(layout).toContain("const listUnsubscribeGate = getGateEvidence('CP-list-unsubscribe'");
			expect(layout).toContain("'CP-list-unsubscribe-provider-rendering'");
			expect(layout).toContain("['T2-4b']");
			expect(layout).toContain(
				"const softBounceGate = getGateEvidence('CP-soft-bounce-categorization'"
		);
		expect(layout).toContain("const customDomainGate = getGateEvidence('CP-custom-domain-dkim'");
		expect(layout).toContain("const softBounceHonesty = getDataHonestyEvidence('V-7', null");
		expect(layout).toContain('const emailListHealthReadiness = $derived(');
		expect(layout).toContain('buildEmailListHealthReadiness({');
		expect(layout).toContain('subscribed: data.spaces.base?.emailHealth.subscribed ?? null');
		expect(layout).toContain('consentEvidenceCount: data.spaces.base?.consentEvidence.email ?? null');
		expect(layout).toContain("label: 'Consent-bound reach'");
		expect(layout).toContain("sublabel: 'Subscriptions + suppression boundary'");
		expect(layout).toContain("id: 'capability-list-health'");
		expect(layout).toContain('href: `${base}/studio#capability-list-health`');
			expect(peopleSpace).toContain('buildEmailListHealthReadiness,');
			expect(peopleSpace).toContain("const listUnsubscribeGate = getGateEvidence('CP-list-unsubscribe'");
			expect(peopleSpace).toContain("'CP-list-unsubscribe-provider-rendering'");
			expect(peopleSpace).toContain("['T2-4b']");
			expect(peopleSpace).toContain(
				"const softBounceGate = getGateEvidence('CP-soft-bounce-categorization'"
		);
		expect(peopleSpace).toContain("const customDomainGate = getGateEvidence('CP-custom-domain-dkim'");
		expect(peopleSpace).toContain("const softBounceHonesty = getDataHonestyEvidence('V-7', null");
		expect(peopleSpace).toContain('const emailListHealthReadiness = $derived(');
		expect(peopleSpace).toContain("label: 'Consent-bound reach'");
		expect(peopleSpace).toContain('metric: emailListHealthReadiness.metric');
		expect(peopleSpace).toContain('id="email-health"');
		expect(peopleSpace).toContain('aria-label="Consent-bound reach"');
		expect(peopleSpace).toContain('{emailListHealthReadiness.effect}');
			expect(component).toContain('buildEmailListHealthReadiness,');
			expect(component).toContain("'CP-list-unsubscribe-provider-rendering'");
			expect(component).toContain("['T2-4b']");
			expect(component).toContain('type EmailListHealthReadinessRow');
		expect(component).toContain('const emailListHealthReadiness = $derived(');
		expect(component).toContain(
			'const emailListHealthRows = $derived<EmailListHealthReadinessRow[]>'
		);
		expect(component).toContain('const emailListHealthStateCounts = $derived');
		expect(component).toContain('const emailListHealthSegments = $derived');
		expect(component).toContain('const heldEmailListHealthCount = $derived');
		expect(component).toContain("labelSuffix: ' list-health contracts'");
		expect(visibleContractSource).toContain('...emailListHealthRows.map((row) => row.state),');
		expect(emailListHealthCard).toContain("workspace: 'People'");
		expect(emailListHealthCard).toContain("phase: 'GROUND / SEND'");
		expect(emailListHealthCard).toContain('state: emailListHealthReadiness.state');
		expect(emailListHealthCard).toContain('statement: emailListHealthReadiness.effect');
		expect(emailListHealthCard).toContain('evidence: emailListHealthReadiness.detail');
		expect(emailListHealthCard).toContain('nextGate: emailListHealthReadiness.nextGate');
		expect(component).toContain("id: 'SHIFT-LIST-HEALTH'");
		expect(component).toContain('List size becomes consent-bound reach');
		expect(component).toContain("name: 'Consent-bound reach'");
		expect(component).toContain("source: 'People emailHealth + email delivery gates'");
		expect(component).toContain("cite: 'buildEmailListHealthReadiness'");
		expect(operatorQueueCandidateSource).toContain("label: 'Read list health posture'");
		expect(operatorQueueCandidateSource).toContain('state: emailListHealthReadiness.state');
		expect(operatorQueueCandidateSource).toContain('effect: emailListHealthReadiness.effect');
		expect(operatorQueueCandidateSource).toContain('detail: emailListHealthReadiness.detail');
		expect(operatorQueueCandidateSource).toContain('gate: emailListHealthReadiness.gate');
		expect(emailListHealthMarkup).toContain('List health posture');
		expect(emailListHealthMarkup).toContain('Where reach stays consent-bound');
		expect(emailListHealthMarkup).toContain('class="terrain-count"');
		expect(emailListHealthMarkup).toContain('List health posture: ${emailListHealthRows.length}');
		expect(emailListHealthMarkup).toContain('emailListHealthStateCounts.live');
		expect(emailListHealthMarkup).toContain('emailListHealthStateCounts.partial');
		expect(emailListHealthMarkup).toContain('heldEmailListHealthCount');
		expect(emailListHealthMarkup).toContain('class="terrain-count-split"');
		expect(emailListHealthMarkup).not.toContain('No inbox-placement score is invented.');
		expect(emailListHealthMarkup).toContain(
			'<Ratio segments={emailListHealthSegments} height={8} />'
		);
		expectTerrainContractCount(emailListHealthMarkup, {
			label: 'List health',
			rows: 'emailListHealthRows',
			stateCounts: 'emailListHealthStateCounts',
			cite: 'buildEmailListHealthReadiness'
		});
		expect(emailListHealthMarkup).toContain(
			'<Datum value={emailListHealthRows.length} cite="buildEmailListHealthReadiness" />'
		);
		expect(emailListHealthMarkup).toContain('aria-label="List health readiness matrix"');
		expect(emailListHealthMarkup).toContain('{#each emailListHealthRows as row (row.id)}');
		expect(emailListHealthMarkup).toContain('{row.ground}');
		expect(emailListHealthMarkup).toContain('{row.boundary}');
		expect(supporters).toContain('id="email-health"');
		expect(supporters).toContain('aria-label="Consent-bound reach"');
		expect(supporters).toContain('{emailListHealthReadiness.effect}');
		expect(hypergraph).toContain('export function buildTextDeliveryReadiness');
		expect(textDeliveryReadinessSource).toContain('export type TextCarrierProofRow = {');
		expect(textDeliveryReadinessSource).toContain('proofRows: TextCarrierProofRow[];');
		expect(textDeliveryReadinessSource).toContain("label: 'Phone consent ledger'");
		expect(textDeliveryReadinessSource).toContain("label: 'Consent evidence custody'");
		expect(textDeliveryReadinessSource).toContain("label: 'Text draft packets'");
		expect(textDeliveryReadinessSource).toContain("label: 'Audience snapshots'");
		expect(textDeliveryReadinessSource).toContain("label: 'Carrier receipt evidence'");
		expect(textDeliveryReadinessSource).toContain("label: 'Reader reply register'");
		expect(textDeliveryReadinessSource).toContain("label: 'Bulk dispatch runner'");
		expect(textDeliveryReadinessSource).toContain("label: 'Anchored text receipts'");
		expect(textDeliveryReadinessSource).toContain("label: 'Saved draft packet'");
		expect(textDeliveryReadinessSource).toContain("label: 'Audience scope'");
		expect(textDeliveryReadinessSource).toContain("label: 'Browser phone custody'");
		expect(textDeliveryReadinessSource).toContain("label: 'Scope revalidation'");
		expect(textDeliveryReadinessSource).toContain("label: 'Carrier acceptance'");
		expect(textDeliveryReadinessSource).toContain("label: 'Reply register'");
		expect(textDeliveryReadinessSource).toContain("label: 'Receipt anchoring'");
		expect(textDeliveryReadinessSource).toContain("cite: 'sms.listReplies'");
		expect(textDeliveryReadinessSource).toContain(
			'without pretending carrier delivery is armed'
		);
		expect(textDeliveryReadinessSource).toContain(
			"cite: 'supporters.getSummaryStats smsHealth'"
		);
		expect(textDeliveryReadinessSource).toContain(
			"cite: 'supporters.getSummaryStats consentEvidence.sms'"
		);
		expect(textDeliveryReadinessSource).toContain('getTextDispatchReadiness + SMS detail route');
		expect(textDeliveryReadinessSource).toContain('dispatchRuntimeReady && smsDispatchGate.state');
		expect(textDeliveryReadinessSource).toContain('dispatchClientBatchRouteMounted');
		expect(textDeliveryReadinessSource).toContain('routeBatchRuntimeReady');
		expect(textDeliveryReadinessSource).toContain('routeDispatchMissingText');
		expect(textDeliveryReadinessSource).toContain('bounded browser-dispatch route');
		expect(textDeliveryReadinessSource).toContain('const proofRows: TextCarrierProofRow[] = [');
		expect(textDeliveryReadinessSource).toContain(
			'The draft detail route can prompt for the org key and prepare encrypted phones in bounded browser batches'
		);
		expect(textDeliveryReadinessSource).toContain(
			'Each dispatch API request reloads the next saved encrypted cohort'
		);
		expect(textDeliveryReadinessSource).toContain('SMS client dispatch batch limit');
		expect(hypergraph).toContain('function featureNotArmedBoundary(surface: string, claims: string): string');
		expect(hypergraph).toContain('function unreadGroundBoundary(surface: string, claims: string): string');
		expect(textDeliveryReadinessSource).toContain('text delivery not armed');
		expect(textDeliveryReadinessSource).toContain('featureNotArmedBoundary(');
		expect(textDeliveryReadinessSource).toContain("'Text delivery',");
		expect(textDeliveryReadinessSource).toContain(
			"'SMS authoring, carrier dispatch, and receipt-evidence claims'"
		);
		expect(textDeliveryReadinessSource).toContain('unreadGroundBoundary(');
		expect(textDeliveryReadinessSource).toContain(
			"'SMS draft, phone-reach, dispatch, and carrier-evidence claims'"
		);
		for (const staleTextReadinessCopy of [
			'Text delivery routes are disabled in this build.',
			'Text delivery routes are disabled; the OS cannot claim SMS authoring, dispatch, or receipt evidence in this build.',
			'Text delivery ground is unread; the OS cannot claim SMS drafts, phone reach, dispatch, or carrier evidence.',
			'SMS_DISPATCH flag + client-side phone decryptor + Twilio proxy runner + Twilio env',
			'Client-side phone decryptor + Twilio proxy',
			'text delivery off'
		]) {
			expect(textDeliveryReadinessSource).not.toContain(staleTextReadinessCopy);
		}
		expect(spacesContract).toContain('smsHealth: {');
		expect(spacesContract).toContain('consentEvidence: {');
		expect(spacesContract).toContain('textDelivery: TextDeliveryGroundData | null;');
		expect(spacesContract).toContain('dispatchRuntimeReady: boolean;');
		expect(spacesContract).toContain('dispatchRuntimeMissing: string[];');
		expect(spacesContract).toContain('dispatchRuntimeDependency: string;');
		expect(spacesContract).toContain('replyCount: number;');
		expect(spacesContract).toContain('dispatchClientBatchRouteMounted: boolean;');
		expect(layoutServer).toContain('smsHealth: {');
		expect(layoutServer).toContain('consentEvidence: {');
		expect(layoutServer).toContain('getTextDispatchReadiness');
		expect(layoutServer).toContain('serverQuery(api.sms.listBlasts, { slug, limit: 100 })');
		expect(layoutServer).toContain('const textDeliveryGround: TextDeliveryGroundData | null');
		expect(layoutServer).toContain('dispatchRuntimeReady: textDispatchReadiness.ready');
		expect(layoutServer).toContain('dispatchRuntimeMissing: textDispatchReadiness.missing');
		expect(layoutServer).toContain('serverQuery(api.sms.getReplySummary');
		expect(layoutServer).toContain('replyCount: asNumber(smsReplySummaryRow?.replyCount)');
		expect(layoutServer).toContain(
			'dispatchClientBatchRouteMounted: textDispatchReadiness.clientBatchRouteMounted'
		);
		expect(layoutServer).toContain('textDelivery: textDeliveryGround');
		expect(layout).toContain('buildTextDeliveryReadiness,');
		expect(layout).toContain("const smsReceiptAnchoringGate = getGateEvidence('CP-receipt-anchoring'");
		expect(layout).toContain('const textDeliveryReadiness = $derived(');
		expect(layout).toContain('buildTextDeliveryReadiness({');
		expect(layout).toContain('subscribedPhoneCount: data.spaces.base?.smsHealth.subscribed ?? null');
		expect(layout).toContain('smsConsentEvidenceCount: data.spaces.base?.consentEvidence.sms ?? null');
		expect(layout).toContain('dispatchRuntimeReady: textDelivery?.dispatchRuntimeReady ?? false');
		expect(layout).toContain('replyCount: textDelivery?.replyCount ?? null');
		expect(layout).toContain('textReplyRegisterGate');
		expect(layout).toContain('textDispatchRuntimeMissing: textDelivery?.dispatchRuntimeMissing ?? []');
		expect(layout).toContain(
			'dispatchClientBatchRouteMounted: textDelivery?.dispatchClientBatchRouteMounted ?? false'
		);
		for (const sourceText of [layout, component]) {
			expect(sourceText).toContain('Browser phone custody and Twilio dispatch runner');
			expect(sourceText).not.toContain('Client-side phone decryptor + Twilio proxy');
		}
		expect(layout).toContain("id: 'capability-text-delivery'");
		expect(layout).toContain('href: `${base}/studio#capability-text-delivery`');
		expect(component).toContain('buildTextDeliveryReadiness,');
		expect(component).toContain('type TextCarrierProofRow');
		expect(component).toContain('type TextDeliveryReadinessRow');
		expect(component).toContain('const textDeliveryReadiness = $derived(');
		expect(component).toContain('dispatchRuntimeReady: textDelivery?.dispatchRuntimeReady ?? false');
		expect(component).toContain('replyCount: textDelivery?.replyCount ?? null');
		expect(component).toContain('textReplyRegisterGate');
		expect(component).toContain('textDispatchRuntimeMissing: textDelivery?.dispatchRuntimeMissing ?? []');
		expect(component).toContain(
			'dispatchClientBatchRouteMounted: textDelivery?.dispatchClientBatchRouteMounted ?? false'
		);
		expect(component).toContain(
			'const textDeliveryRows = $derived<TextDeliveryReadinessRow[]>(textDeliveryReadiness.rows)'
		);
		expect(component).toContain(
			'const textCarrierProofRows = $derived<TextCarrierProofRow[]>(textDeliveryReadiness.proofRows)'
		);
		expect(component).toContain('const textCarrierProofStateCounts = $derived');
		expect(component).toContain('const textCarrierProofSegments = $derived');
		expect(component).toContain('const heldTextCarrierProofCount = $derived');
		expect(component).toContain('const textDeliveryStateCounts = $derived');
		expect(component).toContain('const textDeliverySegments = $derived');
		expect(component).toContain('const heldTextDeliveryCount = $derived');
		expect(component).toContain("labelSuffix: ' carrier proof rows'");
		expect(component).toContain("labelSuffix: ' text-delivery contracts'");
		expect(visibleContractSource).toContain('...textDeliveryRows.map((row) => row.state),');
		expect(visibleContractSource).toContain('...textCarrierProofRows.map((row) => row.state),');
		expect(textDeliveryCard).toContain("workspace: 'People'");
		expect(textDeliveryCard).toContain("phase: 'GROUND / SEND / AGGREGATE'");
		expect(textDeliveryCard).toContain('state: textDeliveryReadiness.state');
		expect(textDeliveryCard).toContain('statement: textDeliveryReadiness.effect');
		expect(textDeliveryCard).toContain('evidence: textDeliveryReadiness.detail');
		expect(textDeliveryCard).toContain('nextGate: textDeliveryReadiness.nextGate');
		expect(component).toContain("id: 'SHIFT-TEXT-DELIVERY'");
		expect(component).toContain('Texting becomes custody-bound delivery');
		expect(component).toContain("name: 'Text delivery posture'");
		expect(component).toContain("source: 'People smsHealth + operating text delivery slice'");
		expect(component).toContain("cite: 'buildTextDeliveryReadiness'");
		expect(operatorQueueCandidateSource).toContain("label: 'Read text delivery posture'");
		expect(operatorQueueCandidateSource).toContain('state: textDeliveryReadiness.state');
		expect(operatorQueueCandidateSource).toContain('effect: textDeliveryReadiness.effect');
		expect(operatorQueueCandidateSource).toContain('detail: textDeliveryReadiness.detail');
		expect(operatorQueueCandidateSource).toContain('gate: textDeliveryReadiness.gate');
		expect(textDeliveryMarkup).toContain('Text delivery posture');
		expect(textDeliveryMarkup).toContain('Where phone reach stays custody-bound');
		expect(textDeliveryMarkup).toContain('class="terrain-count"');
		expect(textDeliveryMarkup).toContain('Text delivery posture: ${textDeliveryRows.length}');
		expect(textDeliveryMarkup).toContain('textDeliveryStateCounts.live');
		expect(textDeliveryMarkup).toContain('textDeliveryStateCounts.partial');
		expect(textDeliveryMarkup).toContain('heldTextDeliveryCount');
		expect(textDeliveryMarkup).toContain('class="terrain-count-split"');
		expect(textDeliveryMarkup).not.toContain(
			'A phone number never implies an armed text side effect.'
		);
		expect(textDeliveryMarkup).toContain(
			'<Ratio segments={textDeliverySegments} height={8} />'
		);
		expect(textDeliveryMarkup).toContain(
			'<Ratio segments={textCarrierProofSegments} height={8} />'
		);
		expectTerrainContractCount(textDeliveryMarkup, {
			label: 'Text delivery',
			rows: 'textDeliveryRows',
			stateCounts: 'textDeliveryStateCounts',
			cite: 'buildTextDeliveryReadiness'
		});
		expect(textDeliveryMarkup).toContain(
			'<Datum value={textDeliveryRows.length} cite="buildTextDeliveryReadiness" />'
		);
		expect(textDeliveryMarkup).toContain('aria-label="Text delivery readiness matrix"');
		expect(textDeliveryMarkup).toContain('{#each textDeliveryRows as row (row.id)}');
		expect(textDeliveryMarkup).toContain('{row.ground}');
		expect(textDeliveryMarkup).toContain('{row.boundary}');
		expect(textDeliveryMarkup).toContain('Text carrier dispatch proof contract');
		expect(textDeliveryMarkup).toContain('textCarrierProofStateCounts.live');
		expect(textDeliveryMarkup).toContain('textCarrierProofStateCounts.partial');
		expect(textDeliveryMarkup).toContain('heldTextCarrierProofCount');
		expect(textDeliveryMarkup).toContain(
			'<Datum value={textCarrierProofRows.length} cite="buildTextDeliveryReadiness proofRows" />'
		);
		expect(textDeliveryMarkup).toContain('aria-label="Text carrier dispatch proof contract"');
		expect(textDeliveryMarkup).toContain('{#each textCarrierProofRows as row (row.id)}');
		expect(textDeliveryMarkup).toContain('{row.effect}');
		expect(textDeliveryMarkup).toContain('{row.gate}');
		expect(canonicalDoc).toContain(
				'Text delivery posture is a shared custody-bound delivery surface, not an SMS button'
		);
		expect(canonicalDoc).toContain(
			'`buildTextDeliveryReadiness` owns phone consent ledger, SMS consent evidence custody, text draft packets, audience snapshots, carrier receipt evidence, reader reply register, dispatch execution, and anchored text receipt rows'
		);
		expect(canonicalDoc).toContain(
			'shared `proofRows` carrier-dispatch contract for saved draft packet, audience scope, browser phone custody, scope revalidation, carrier acceptance, reply register, and receipt anchoring'
		);
		expect(canonicalDoc).toContain('`getTextDispatchReadiness`');
		expect(canonicalDoc).toContain(
			'it never loads plaintext phone numbers into the shell, never treats `phonePresent` as opt-in'
		);
		expect(canonicalDoc).toContain('`dispatchClientBatchRouteMounted` evidence flag');
		expect(canonicalDoc).toContain('partial route evidence');
		expect(canonicalDoc).toContain(
			'The SMS index, compose, and detail routes now open with **Text delivery pressure** cells for Packet scope, Phone custody, and Next proof lift'
		);
		expect(canonicalDoc).toContain(
			'Public org product copy must follow the same rule: it may name verified targeting and custody-bound text dispatch, but it must not claim 10DLC readiness'
		);
		expect(canonicalDoc).toContain('`#text-carrier-proof-contract`');
		expect(canonicalDoc).toContain('saved-cohort scope revalidation');
		expect(capabilityScope).toContain('Text delivery OS posture');
		expect(capabilityScope).toContain(
			'`supporters.getSummaryStats` now exposes aggregate `smsHealth`'
		);
		expect(capabilityScope).toContain('aggregate consent-evidence counts');
		expect(capabilityScope).toContain('dispatchClientBatchRouteMounted');
		expect(capabilityScope).toContain('`buildTextDeliveryReadiness.proofRows` contract');
		expect(capabilityScope).toContain(
			'The SMS index/compose/detail routes now start with **Text delivery pressure** cells for Packet scope, Phone custody, and Next proof lift'
		);
		expect(capabilityScope).toContain('the route-local **Text delivery pressure** cells');
		expect(capabilityScope).toContain('`#text-carrier-proof-contract`');
		expect(capabilityScope).toContain(
			'This is posture plus a bounded carrier-dispatch substrate: phone consent status, imported consent evidence, draft packets, audience snapshots, carrier counters, reader reply register, dispatch runner, and receipt anchoring are distinct rows'
		);
		expect(capabilityScope).toContain(
			'Public org product copy now names custody-bound text dispatch instead of 10DLC readiness'
		);
		expect(capabilityScope).toContain(
			'proofRows contract separately exposes saved draft packet, audience scope, browser phone custody, scope revalidation, carrier acceptance, reply register, and receipt anchoring'
		);
		expect(powerTerrainMarkup).toContain('Power terrain coverage');
		expect(powerTerrainMarkup).toContain('What the OS resolves against');
		expect(powerTerrainMarkup).toContain('class="terrain-axis" aria-label="Power terrain axis"');
		expect(powerTerrainMarkup).toContain('<span>loaded</span>');
		expect(powerTerrainMarkup).toContain('<span>held</span>');
		expect(powerTerrainMarkup).toContain('<span>lift</span>');
		expect(powerTerrainMarkup).toContain('<span>gate</span>');
		expect(powerTerrainMarkup).toContain('aria-label="Power terrain pressure"');
		expect(powerTerrainMarkup).toContain(
			'{#each powerTerrainPressureReadouts as readout (readout.id)}'
		);
		expect(powerTerrainMarkup).toContain('class="terrain-pressure-cell"');
		expect(powerTerrainMarkup).toContain(
			'<span class="terrain-pressure-kicker">{readout.label}</span>'
		);
		expect(powerTerrainMarkup).toContain(
			'<span class="terrain-pressure-title">{readout.title}</span>'
		);
		expect(powerTerrainMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(powerTerrainMarkup).toContain(
			'<span class="terrain-pressure-detail">{readout.detail}</span>'
		);
		expect(powerTerrainMarkup).toContain(
			'<span class="terrain-pressure-gate">{readout.gate}</span>'
		);
		expect(powerTerrainMarkup).toContain(
			'<span class="terrain-pressure-source">{readout.source}</span>'
		);
		expect(powerTerrainMarkup).toContain('actionLabel(readout.state, readout.action)');
		expect(powerTerrainMarkup).not.toContain(
			'Loaded target, bill, and score surfaces get route effects'
		);
		expect(powerTerrainMarkup).not.toContain('reader-office, and joined-plane claims stay gated');
		expect(powerTerrainMarkup).toContain('<Ratio segments={powerTerrainSegments} height={8} />');
		expectTerrainContractCount(powerTerrainMarkup, {
			label: 'Power terrain',
			rows: 'powerTerrainRows',
			stateCounts: 'powerTerrainStateCounts',
			cite: 'buildPowerTerrainReadiness'
		});
		expect(powerTerrainMarkup).not.toContain(
			'loaded counts only come from follows, watched bills, and score'
		);
		expect(powerTerrainMarkup).toContain('{#each powerTerrainRows as row (row.id)}');
		expect(powerTerrainMarkup).toContain('{row.phase} / {formatCapabilityClusters(row.clusters)}');
		expect(powerTerrainMarkup).toContain('{stateLabel(row.state)}');
		expect(powerTerrainMarkup).toContain('<Datum value={row.metric.value} cite={row.metric.cite} />');
		expect(powerTerrainMarkup).toContain('{row.ground}');
		expect(powerTerrainMarkup).toContain('{row.boundary}');
		expect(powerTerrainMarkup).toContain('{actionLabel(row.state, row.action)}');
		expect(component).toContain(".terrain-pressure-cell[data-state='draft-only']");
		expect(component).toContain(".terrain-pressure-cell[data-state='gated']");
		for (const powerTerrainLabel of [
			"label: 'Current target records'",
			"label: 'Discoverable officials'",
			"label: 'Bills corpus'",
			"label: 'Score snapshots'",
			"label: 'State/local terrain'",
			"label: 'International resolver'",
			"label: 'Office response terrain'",
			"label: 'Joined terrain plane'"
		]) {
			expect(hypergraph).toContain(powerTerrainLabel);
		}
		expect(hypergraph).toContain('this map does not proxy a discover count from follows');
		expect(hypergraph).toContain('absent dimensions stay blank rather than becoming zeros');
		expect(hypergraph).toContain('it does not claim a full cross-route join plane yet');
		expect(powerTerrainReadinessSource).toContain(
			"unreadGroundBoundary('Power terrain', 'target, bill, and score coverage claims')"
		);
		expect(powerTerrainReadinessSource).not.toContain(
			'Power terrain is not loaded; the OS cannot claim target, bill, or score coverage.'
		);
		expect(spacesContract).toContain('relevantBillCount: number | null;');
		expect(spacesContract).toContain('positionedBillCount: number | null;');
		expect(layoutServer).toContain('api.legislation.listRelevantBills');
		expect(layoutServer).toContain('const relevantBillCount = Array.isArray(relevantBills)');
		expect(layoutServer).toContain('const positionedBillCount = Array.isArray(watchedBills)');
		expect(hypergraph).toContain('export function buildLegislativeMonitoringReadiness');
		for (const monitoringLabel of [
			"label: 'Federal bill corpus'",
			"label: 'Org watchlist'",
			"label: 'Org relevance screen'",
			"label: 'Position register'",
			"label: 'State and local bill corpus'",
			"label: 'Per-supporter alert fan-out'",
			"label: 'Delegated agent monitoring'",
			"label: 'Multi-jurisdiction routing'"
		]) {
			expect(legislativeMonitoringReadinessSource).toContain(monitoringLabel);
		}
		expect(legislativeMonitoringReadinessSource).toContain(
			'They do not imply constituent subscriptions, district fan-out, or agentic monitoring.'
		);
		expect(legislativeMonitoringReadinessSource).toContain(
			'They are not constituent-specific alerts, legal analysis, or autonomous agent recommendations.'
		);
		expect(legislativeMonitoringReadinessSource).toContain(
			'no constituentBillSubscriptions or per-supporter alert rows are armed'
		);
		expect(legislativeMonitoringReadinessSource).toContain('legislation not armed');
		expect(legislativeMonitoringReadinessSource).toContain(
			"'bill corpus, watchlist, relevance, position, alert, and routing claims'"
		);
		expect(legislativeMonitoringReadinessSource).toContain(
			"unreadGroundBoundary('Legislative monitoring', 'watched-bill claims')"
		);
		expect(legislativeMonitoringReadinessSource).toContain('unreadGroundBoundary(');
		expect(legislativeMonitoringReadinessSource).toContain(
			"'watch, relevance, and position claims'"
		);
		for (const staleLegislativeMonitoringCopy of [
			'Legislation features are disabled; the OS cannot claim bill corpus search.',
			'Watched bill rows are unread.',
			'Relevance rows are unread.',
			'Position rows are unread.',
			'Legislative monitoring ground is unavailable; the OS cannot claim bill watch capability.'
		]) {
			expect(legislativeMonitoringReadinessSource).not.toContain(
				staleLegislativeMonitoringCopy
			);
		}
		expect(layout).toContain('buildLegislativeMonitoringReadiness,');
		expect(layout).toContain("const perSupporterBillAlertsGate = getGateEvidence");
		expect(layout).toContain("const delegatedLegislativeMonitoringGate = getGateEvidence");
		expect(layout).toContain("const multiJurisdictionRoutingGate = getGateEvidence");
		expect(layout).toContain('const legislativeMonitoringReadiness = $derived(');
		expect(layout).toContain('buildLegislativeMonitoringReadiness({');
		expect(layout).toContain(
			'relevantBillCount: data.spaces.landscape?.relevantBillCount ?? null'
		);
		expect(layout).toContain("label: 'Legislative monitoring'");
		expect(layout).toContain("sublabel: 'Watchlists + agent boundary'");
		expect(layout).toContain("id: 'capability-legislative-monitoring'");
		expect(layout).toContain('href: `${base}/studio#capability-legislative-monitoring`');
		expect(component).toContain('buildLegislativeMonitoringReadiness,');
		expect(component).toContain('type LegislativeMonitoringReadinessRow');
		expect(component).toContain('const legislativeMonitoringReadiness = $derived(');
		expect(component).toContain(
			'const legislativeMonitoringRows = $derived<LegislativeMonitoringReadinessRow[]>'
		);
		expect(component).toContain('const legislativeMonitoringStateCounts = $derived');
		expect(component).toContain('const legislativeMonitoringSegments = $derived');
		expect(component).toContain("labelSuffix: ' monitoring contracts'");
		expect(component).toContain('type LegislativeMonitoringPressureReadout = {');
		expect(legislativeMonitoringPressureSource).toContain(
			'const heldLegislativeMonitoringRows = $derived'
		);
		expect(legislativeMonitoringPressureSource).toContain(
			'const firstHeldLegislativeMonitoringRow = $derived'
		);
		expect(legislativeMonitoringPressureSource).toContain(
			'const legislativeMonitoringPressureReadouts = $derived<LegislativeMonitoringPressureReadout[]>(['
		);
		expect(legislativeMonitoringPressureSource).toContain("id: 'current-watch'");
		expect(legislativeMonitoringPressureSource).toContain("id: 'held-fanout'");
		expect(legislativeMonitoringPressureSource).toContain("id: 'next-monitoring-lift'");
		expect(legislativeMonitoringPressureSource).toContain("label: 'Current watch'");
		expect(legislativeMonitoringPressureSource).toContain("label: 'Held fan-out'");
		expect(legislativeMonitoringPressureSource).toContain("label: 'Next monitoring lift'");
		expect(legislativeMonitoringPressureSource).toContain(
			'legislativeMonitoringReadiness.watchedBillCount'
		);
		expect(legislativeMonitoringPressureSource).toContain(
			'heldLegislativeMonitoringRows.length'
		);
		expect(legislativeMonitoringPressureSource).toContain(
			'firstHeldLegislativeMonitoringRow?.boundary'
		);
		expect(legislativeMonitoringPressureSource).toContain(
			"?? 'buildLegislativeMonitoringReadiness'"
		);
		expect(visibleContractSource).toContain(
			'...legislativeMonitoringRows.map((row) => row.state),'
		);
		expect(visibleContractSource).toContain(
			'...legislativeMonitoringPressureReadouts.map((readout) => readout.state),'
		);
		expect(legislativeMonitoringCard).toContain("workspace: 'Power'");
		expect(legislativeMonitoringCard).toContain("phase: 'GROUND / RESOLVE'");
		expect(legislativeMonitoringCard).toContain('state: legislativeMonitoringReadiness.state');
		expect(legislativeMonitoringCard).toContain(
			'statement: legislativeMonitoringReadiness.effect'
		);
		expect(legislativeMonitoringCard).toContain(
			'nextGate: legislativeMonitoringReadiness.nextGate'
		);
		expect(component).toContain("id: 'SHIFT-MONITORING'");
		expect(component).toContain('Bill tracking becomes civic monitoring');
		expect(component).toContain("name: 'Legislative monitoring posture'");
		expect(component).toContain("source: 'Power bill slice + monitoring gates'");
		expect(component).toContain("cite: 'buildLegislativeMonitoringReadiness'");
		expect(operatorQueueCandidateSource).toContain(
			"label: 'Read legislative monitoring posture'"
		);
		expect(operatorQueueCandidateSource).toContain(
			'state: legislativeMonitoringReadiness.state'
		);
		expect(operatorQueueCandidateSource).toContain(
			'effect: legislativeMonitoringReadiness.effect'
		);
		expect(operatorQueueCandidateSource).toContain(
			'gate: legislativeMonitoringReadiness.gate'
		);
		expect(legislativeMonitoringMarkup).toContain('Legislative monitoring posture');
		expect(legislativeMonitoringMarkup).toContain('Where bill terrain becomes civic watch');
		expect(legislativeMonitoringMarkup).toContain(
			'class="terrain-axis" aria-label="Legislative monitoring axis"'
		);
		expect(legislativeMonitoringMarkup).toContain('<span>watch</span>');
		expect(legislativeMonitoringMarkup).toContain('<span>fan-out</span>');
		expect(legislativeMonitoringMarkup).toContain('<span>lift</span>');
		expect(legislativeMonitoringMarkup).toContain('<span>gate</span>');
		expect(legislativeMonitoringMarkup).toContain(
			'aria-label="Legislative monitoring pressure"'
		);
		expect(legislativeMonitoringMarkup).toContain(
			'{#each legislativeMonitoringPressureReadouts as readout (readout.id)}'
		);
		expect(legislativeMonitoringMarkup).toContain('class="terrain-pressure-cell"');
		expect(legislativeMonitoringMarkup).toContain(
			'<span class="terrain-pressure-kicker">{readout.label}</span>'
		);
		expect(legislativeMonitoringMarkup).toContain(
			'<span class="terrain-pressure-title">{readout.title}</span>'
		);
		expect(legislativeMonitoringMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(legislativeMonitoringMarkup).toContain(
			'<span class="terrain-pressure-detail">{readout.detail}</span>'
		);
		expect(legislativeMonitoringMarkup).toContain(
			'<span class="terrain-pressure-gate">{readout.gate}</span>'
		);
		expect(legislativeMonitoringMarkup).toContain('actionLabel(readout.state, readout.action)');
		expect(legislativeMonitoringMarkup).not.toContain(
			'Federal corpus search, org watchlists, relevance rows, and positions are current org terrain'
		);
		expect(legislativeMonitoringMarkup).not.toContain(
			'Per-supporter alerts, delegated monitoring, and multi-jurisdiction routing stay'
		);
		expect(legislativeMonitoringMarkup).toContain(
			'<Ratio segments={legislativeMonitoringSegments} height={8} />'
		);
		expect(legislativeMonitoringMarkup).toContain(
			'value={legislativeMonitoringRows.length}'
		);
		expect(legislativeMonitoringMarkup).toContain(
			'aria-label="Legislative monitoring readiness matrix"'
		);
		expect(legislativeMonitoringMarkup).toContain(
			'{#each legislativeMonitoringRows as row (row.id)}'
		);
		expect(legislativeMonitoringMarkup).toContain('{row.ground}');
		expect(legislativeMonitoringMarkup).toContain('{row.boundary}');
		expect(spacesContract).toContain('coalition: CoalitionGroundData | null;');
		expect(spacesContract).toContain('export type CoalitionGroundData = {');
		expect(layoutServer).toContain('CoalitionGroundData,');
		expect(layoutServer).toContain('serverQuery(api.networks.list, { orgSlug: slug })');
		expect(layoutServer).toContain('const coalitionGround: CoalitionGroundData | null');
		expect(layoutServer).toContain('coalition: coalitionGround');
		expect(hypergraph).toContain('export function buildCoalitionReadiness');
		for (const coalitionLabel of [
			"label: creationContext ? 'Coalition record definition' : 'Network memberships'",
			"label: creationContext ? 'Creation authority' : 'Invite response queue'",
			"label: creationContext ? 'Member proof path' : 'Member roster aggregate'",
			"label: creationContext ? 'Aggregate proof handoff' : 'Aggregate proof detail'",
			"label: 'Cross-border coalition routing'",
			"label: 'Durable coalition artifact'"
		]) {
			expect(coalitionReadinessSource).toContain(coalitionLabel);
		}
		expect(coalitionReadinessSource).toContain('networks.list active memberships');
		expect(coalitionReadinessSource).toContain('networks.getStats via network detail');
		expect(coalitionReadinessSource).toContain(
			'The shell does not fabricate verified coalition actions'
		);
		expect(coalitionReadinessSource).toContain(
			'Member rows prove coalition structure, not shared supporter access'
		);
		expect(coalitionReadinessSource).toContain('coalition not armed');
		expect(coalitionReadinessSource).toContain(
			"'network membership, invite, member-roster, aggregate-proof, routing, and durable-artifact claims'"
		);
		expect(coalitionReadinessSource).toContain(
			"unreadGroundBoundary('Coalition invite queue', 'invite-response claims')"
		);
		expect(coalitionReadinessSource).toContain(
			"unreadGroundBoundary('Coalition roster aggregate', 'member-structure claims')"
		);
		for (const staleCoalitionReadinessCopy of [
			'Coalition routes are disabled in this build.',
			'Coalition invite queue is unread.',
			'Coalition member roster aggregate is unread.',
			'coalition off',
			'Coalition routes are disabled; the OS cannot claim network membership or aggregate proof posture in this build.',
			'Coalition ground is unread; no membership, invite, or aggregate-proof handoff is invented.'
		]) {
			expect(coalitionReadinessSource).not.toContain(staleCoalitionReadinessCopy);
		}
		expect(layout).toContain('buildCoalitionReadiness,');
		expect(layout).toContain('const coalition = $derived(data.spaces.operating?.coalition ?? null);');
		expect(layout).toContain('const coalitionReadiness = $derived(');
		expect(layout).toContain('buildCoalitionReadiness({');
		expect(layout).toContain("id: 'capability-coalition'");
		expect(layout).toContain("label: 'Coalition composition posture'");
		expect(layout).toContain("sublabel: 'Network memberships + proof handoff'");
		expect(layout).toContain('href: `${base}/studio#capability-coalition`');
		expect(layout).toContain('action: coalitionReadiness.action');
		expect(layout).not.toContain('const coalitionGroundSignal = $derived');
		expect(component).toContain('buildCoalitionReadiness,');
		expect(component).toContain('type CoalitionReadinessRow');
		expect(component).toContain('const coalitionReadiness = $derived(');
		expect(component).toContain(
			'const coalitionRows = $derived<CoalitionReadinessRow[]>(coalitionReadiness.rows)'
		);
		expect(component).toContain("labelSuffix: ' coalition contracts'");
		expect(component).toContain('type CoalitionPressureReadout = {');
		expect(coalitionPressureSource).toContain('const aggregateProofCoalitionRow = $derived');
		expect(coalitionPressureSource).toContain('const heldCoalitionRows = $derived');
		expect(coalitionPressureSource).toContain('const firstHeldCoalitionRow = $derived');
		expect(coalitionPressureSource).toContain(
			'const coalitionPressureReadouts = $derived<CoalitionPressureReadout[]>(['
		);
		expect(coalitionPressureSource).toContain("id: 'membership-ground'");
		expect(coalitionPressureSource).toContain("id: 'proof-handoff'");
		expect(coalitionPressureSource).toContain("id: 'next-coalition-lift'");
		expect(coalitionPressureSource).toContain("label: 'Membership ground'");
		expect(coalitionPressureSource).toContain("label: 'Proof handoff'");
		expect(coalitionPressureSource).toContain("label: 'Next coalition lift'");
		expect(coalitionPressureSource).toContain('coalitionReadiness.signal');
		expect(coalitionPressureSource).toContain('aggregateProofCoalitionRow?.boundary');
		expect(coalitionPressureSource).toContain('firstHeldCoalitionRow?.boundary');
		expect(coalitionPressureSource).toContain("?? 'buildCoalitionReadiness'");
		expect(visibleContractSource).toContain('...coalitionRows.map((row) => row.state),');
		expect(visibleContractSource).toContain(
			'...coalitionPressureReadouts.map((readout) => readout.state),'
		);
		expect(coalitionCard).toContain("workspace: 'Substrate'");
		expect(coalitionCard).toContain("phase: 'AGGREGATE'");
		expect(coalitionCard).toContain('state: coalitionReadiness.state');
		expect(coalitionCard).toContain('statement: coalitionReadiness.effect');
		expect(coalitionCard).toContain('metric: {');
		expect(component).toContain("id: 'SHIFT-COALITION'");
		expect(component).toContain('Coalitions become protocol composition');
		expect(component).toContain("name: 'Coalition composition posture'");
		expect(component).toContain("source: 'Operating coalition slice + coalition gates'");
		expect(component).toContain("cite: 'buildCoalitionReadiness'");
		expect(operatorQueueCandidateSource).toContain("label: 'Read coalition posture'");
		expect(operatorQueueCandidateSource).toContain('state: coalitionReadiness.state');
		expect(operatorQueueCandidateSource).toContain('effect: coalitionReadiness.effect');
		expect(operatorQueueCandidateSource).toContain('detail: coalitionReadiness.detail');
		expect(operatorQueueCandidateSource).toContain('gate: coalitionReadiness.gate');
		expect(coalitionMarkup).toContain('Coalition composition posture');
		expect(coalitionMarkup).toContain('Where networks become shared proof ground');
		expect(coalitionMarkup).toContain(
			'class="terrain-axis" aria-label="Coalition composition axis"'
		);
		expect(coalitionMarkup).toContain('<span>membership</span>');
		expect(coalitionMarkup).toContain('<span>proof</span>');
		expect(coalitionMarkup).toContain('<span>lift</span>');
		expect(coalitionMarkup).toContain('<span>gate</span>');
		expect(coalitionMarkup).toContain('aria-label="Coalition composition pressure"');
		expect(coalitionMarkup).toContain('{#each coalitionPressureReadouts as readout (readout.id)}');
		expect(coalitionMarkup).toContain('class="terrain-pressure-cell"');
		expect(coalitionMarkup).toContain(
			'<span class="terrain-pressure-kicker">{readout.label}</span>'
		);
		expect(coalitionMarkup).toContain(
			'<span class="terrain-pressure-title">{readout.title}</span>'
		);
		expect(coalitionMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(coalitionMarkup).toContain(
			'<span class="terrain-pressure-detail">{readout.detail}</span>'
		);
		expect(coalitionMarkup).toContain(
			'<span class="terrain-pressure-gate">{readout.gate}</span>'
		);
		expect(coalitionMarkup).toContain('actionLabel(readout.state, readout.action)');
		expect(coalitionMarkup).not.toContain(
			'Network memberships, invite resolution, member rows, detail aggregate stats'
		);
		expect(coalitionMarkup).not.toContain('Coalition membership never implies shared');
		expect(coalitionMarkup).toContain('<Ratio segments={coalitionSegments} height={8} />');
		expect(coalitionMarkup).toContain(
			'<Datum value={coalitionRows.length} cite="buildCoalitionReadiness" />'
		);
		expect(coalitionMarkup).toContain('aria-label="Coalition readiness matrix"');
		expect(coalitionMarkup).toContain('{#each coalitionRows as row (row.id)}');
		expect(canonicalDoc).toContain(
			'Coalition composition posture is a shared composability surface, not a shared CRM'
		);
		expect(canonicalDoc).toContain('`buildCoalitionReadiness` owns network memberships');
		expect(canonicalDoc).toContain(
			'`coalitionPressureReadouts` opens this section with **Membership ground**, **Proof handoff**, and **Next coalition lift** cells'
		);
		expect(canonicalDoc).toContain(
			'When coalition composition is not armed or unread, the shared builder must name the membership, invite, roster, aggregate-proof, routing, and artifact claims'
		);
		expect(capabilityScope).toContain('Coalition composition OS posture');
		expect(capabilityScope).toContain(
			'Coalition composition now starts with Membership ground, Proof handoff, and Next coalition lift pressure cells from `buildCoalitionReadiness`'
		);
		expect(component).toContain('buildResultsProofReadiness,');
		expect(component).toContain('type ResultsProofRow');
		expect(component).toContain('const resultsProofReadiness = $derived(');
		expect(component).toContain('buildResultsProofReadiness({');
		expect(component).toContain('receiptCount: ret?.receipts.loadedCount ?? null');
		expect(component).toContain('anchorFieldCount: ret?.receipts.anchorFieldCount ?? null');
		expect(component).toContain('const resultsProofRows = $derived<ResultsProofRow[]>');
		expect(component).toContain('const resultsPacketRow = $derived(');
		expect(component).toContain('const resultsCoordinationRow = $derived(');
		expect(component).toContain('const resultsReaderRow = $derived(');
		expect(component).toContain('const resultsProofStateCounts = $derived');
		expect(component).toContain('const resultsProofSegments = $derived');
		expect(component).toContain("labelSuffix: ' proof contracts'");
		expect(component).toContain('type ResultsProofPressureReadout = {');
		expect(resultsProofPressureSource).toContain('const receiptEvidenceResultsRow = $derived');
		expect(resultsProofPressureSource).toContain('const heldResultsProofRows = $derived');
		expect(resultsProofPressureSource).toContain('const firstHeldResultsProofRow = $derived');
		expect(resultsProofPressureSource).toContain(
			'const resultsProofPressureReadouts = $derived<ResultsProofPressureReadout[]>(['
		);
		expect(resultsProofPressureSource).toContain("id: 'packet-ground'");
		expect(resultsProofPressureSource).toContain("id: 'receipt-evidence'");
		expect(resultsProofPressureSource).toContain("id: 'next-proof-lift'");
		expect(resultsProofPressureSource).toContain("label: 'Packet ground'");
		expect(resultsProofPressureSource).toContain("label: 'Receipt evidence'");
		expect(resultsProofPressureSource).toContain("label: 'Next proof lift'");
		expect(resultsProofPressureSource).toContain('resultsProofReadiness.signal');
		expect(resultsProofPressureSource).toContain('receiptEvidenceResultsRow?.boundary');
		expect(resultsProofPressureSource).toContain('firstHeldResultsProofRow?.boundary');
		expect(resultsProofPressureSource).toContain("?? 'buildResultsProofReadiness'");
		expect(visibleContractSource).toContain('...resultsProofRows.map((row) => row.state),');
		expect(visibleContractSource).toContain(
			'...resultsProofPressureReadouts.map((readout) => readout.state),'
		);
		expect(legislation).toContain('export const getOrgReceiptSummary = query');
		expect(legislation).toContain("withIndex('by_orgId'");
		expect(legislation).toContain('anchorFieldCount');
		expect(legislation).not.toContain('anchoredCount');
		expect(spacesContract).toContain('export type ReturnSpaceReceiptSummary');
		expect(spacesContract).toContain('receipts: ReturnSpaceReceiptSummary;');
		expect(layoutServer).toContain('api.legislation.getOrgReceiptSummary');
		expect(layoutServer).toContain('receipts: {');
		expect(layoutServer).toContain('loadedCount: asNumber(receiptSummary?.loadedCount)');
		expect(layoutServer).toContain('anchorFieldCount: asNumber(receiptSummary?.anchorFieldCount)');
		expect(layout).toContain('receiptCount: data.spaces.return?.receipts.loadedCount ?? null');
		expect(layout).toContain('pendingReceiptCount: data.spaces.return?.receipts.pendingCount ?? null');
		expect(layout).toContain('anchorFieldCount: data.spaces.return?.receipts.anchorFieldCount ?? null');
		expect(hypergraph).toContain('export function buildResultsProofReadiness');
		expect(hypergraph).toContain("| 'receipt-evidence'");
		expect(hypergraph).toContain("label: 'Receipt evidence'");
		expect(hypergraph).toContain('Loaded receipt rows are source-row evidence');
		expect(hypergraph).toContain('bounded receipt summary');
		expect(hypergraph).toContain('anchor fields');
		expect(hypergraph).toContain('handoff: string;');
		expect(hypergraph).toContain("handoff: results.hasPacket ? 'Proof packet' : 'Action records'");
		expect(hypergraph).toContain(
			"handoff: results.hasPacket ? 'Reader proof preview' : 'Action records'"
		);
		expect(hypergraph).toContain('Computed packet visibility is not the same as durable receipt anchoring');
		expect(hypergraph).toContain('Packet-local coordination metrics can be read');
		expect(hypergraph).toContain('no packet metric is invented');
		expect(resultsProofReadinessSource).toContain(
			"unreadGroundBoundary('Results proof', 'packet-artifact claims')"
		);
		expect(resultsProofReadinessSource).toContain(
			"'proof-packet, reader-proof, receipt, and response claims'"
		);
		expect(resultsProofReadinessSource).toContain(
			"'current packet, integrity, and reader-proof metric claims'"
		);
		for (const staleResultsProofCopy of [
			'Results is unread; the OS cannot claim a packet artifact.',
			'Reader proof is unavailable until Results loads.',
			'Accountability routes are disabled; Results cannot claim proof packets in this build.',
			'Results proof is not loaded; the OS cannot claim current packet, integrity, or reader-proof metrics.'
		]) {
			expect(resultsProofReadinessSource).not.toContain(staleResultsProofCopy);
		}
			expect(canonicalDoc).toContain('Results proof rows carry a handoff field');
			expect(canonicalDoc).toContain(
				'the map, folded Results strip, compact canvas, and campaign report render that route object'
			);
		expect(canonicalDoc).toContain(
			'`resultsProofPressureReadouts` opens this section with **Packet ground**, **Receipt evidence**, and **Next proof lift** cells'
		);
		expect(canonicalDoc).toContain(
			'When Results proof is not armed or unread, the shared builder must name proof-packet, reader-proof, receipt, response, packet, integrity, and reader-proof metric claims'
		);
		expect(capabilityScope).toContain(
			'Results proof now starts with Packet ground, Receipt evidence, and Next proof lift pressure cells from `buildResultsProofReadiness`'
		);
		expect(capabilityScope).toContain(
			'The report route now renders **Report Results proof pressure** before local delivery controls'
		);
		expect(capabilityScope).toContain(
			'The mounted Results header now renders `resultsHeaderMetrics` as a `Datum`-backed proof evidence strip'
		);
		expect(capabilityScope).toContain(
			'current packet verified actions, bounded receipt rows, logged responses, and active action records all cite the same layout Results slice'
		);
		expect(resultsProofMarkup).toContain('Results proof posture');
		expect(resultsProofMarkup).toContain('What the OS can prove back');
		expect(resultsProofMarkup).toContain(
			'class="terrain-axis" aria-label="Results proof axis"'
		);
		expect(resultsProofMarkup).toContain('<span>packet</span>');
		expect(resultsProofMarkup).toContain('<span>receipt</span>');
		expect(resultsProofMarkup).toContain('<span>lift</span>');
		expect(resultsProofMarkup).toContain('<span>gate</span>');
		expect(resultsProofMarkup).toContain('aria-label="Results proof pressure"');
		expect(resultsProofMarkup).toContain(
			'{#each resultsProofPressureReadouts as readout (readout.id)}'
		);
		expect(resultsProofMarkup).toContain('class="terrain-pressure-cell"');
		expect(resultsProofMarkup).toContain(
			'<span class="terrain-pressure-kicker">{readout.label}</span>'
		);
		expect(resultsProofMarkup).toContain(
			'<span class="terrain-pressure-title">{readout.title}</span>'
		);
		expect(resultsProofMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(resultsProofMarkup).toContain(
			'<span class="terrain-pressure-detail">{readout.detail}</span>'
		);
		expect(resultsProofMarkup).toContain(
			'<span class="terrain-pressure-gate">{readout.gate}</span>'
		);
		expect(resultsProofMarkup).toContain('actionLabel(readout.state, readout.action)');
		expect(resultsProofMarkup).not.toContain(
			'Packet, integrity, verifier, receipt evidence, anchoring, and office-response claims stay'
		);
		expect(resultsProofMarkup).toContain('<Ratio segments={resultsProofSegments} height={8} />');
		expect(resultsProofMarkup).toContain(
			'<Datum value={resultsProofRows.length} cite="buildResultsProofReadiness" />'
		);
		expect(resultsProofMarkup).toContain('{#each resultsProofRows as row (row.id)}');
		expect(resultsProofMarkup).toContain('{row.phase} / {formatCapabilityClusters(row.clusters)}');
		expect(resultsProofMarkup).toContain('<span class="terrain-handoff">{row.handoff}</span>');
		expect(resultsProofMarkup).toContain('{stateLabel(row.state)}');
		expect(resultsProofMarkup).toContain('<Datum value={row.metric.value} cite={row.metric.cite} />');
		expect(resultsProofMarkup).toContain('{row.ground}');
		expect(resultsProofMarkup).toContain('{row.boundary}');
		expect(resultsProofMarkup).toContain('{actionLabel(row.state, row.action)}');
		for (const resultsProofLabel of [
			"label: 'Packet artifact'",
			"label: 'Coordination integrity'",
			"label: 'Reader verifier'",
			"label: 'Receipt evidence'",
			"label: 'Receipt anchoring'",
			"label: 'Reader-office response'"
		]) {
			expect(hypergraph).toContain(resultsProofLabel);
		}
		expect(hypergraph).toContain('export function buildAccountabilityResponseReadiness');
		for (const responseLabel of [
			"label: 'Proof delivery register'",
			"label: 'Opened response signal'",
			"label: 'Verified-link signal'",
			"label: 'Reply log'",
			"label: 'Vote alignment basis'",
			"label: 'Reader-office workflow'"
		]) {
			expect(accountabilityResponseReadinessSource).toContain(responseLabel);
		}
		expect(accountabilityResponseReadinessSource).toContain('LandscapeScorecard.reportsReceived');
		expect(accountabilityResponseReadinessSource).toContain('LandscapeScorecard.reportsOpened');
		expect(accountabilityResponseReadinessSource).toContain(
			'LandscapeScorecard.verifyLinksClicked'
		);
		expect(accountabilityResponseReadinessSource).toContain('LandscapeScorecard.repliesLogged');
		expect(accountabilityResponseReadinessSource).toContain('LandscapeScorecard.relevantVotes');
		expect(accountabilityResponseReadinessSource).toContain(
			'const rawOpenedCount = response.openedCount'
		);
		expect(accountabilityResponseReadinessSource).toContain(
			'Opened-report signal is not loaded from a scorecard snapshot.'
		);
		expect(accountabilityResponseReadinessSource).toContain(
			'response and vote-alignment dimensions are unread until a scorecard snapshot exists'
		);
		expect(accountabilityResponseReadinessSource).toContain(
			'Accountability response posture separates proof-delivery rows'
		);
		expect(accountabilityResponseReadinessSource).toContain('response not armed');
		expect(accountabilityResponseReadinessSource).toContain(
			"'response-evidence, reader-signal, reply, vote-alignment, and office-workflow claims'"
		);
		expect(accountabilityResponseReadinessSource).toContain(
			"unreadGroundBoundary('Accountability response', 'delivery-response count claims')"
		);
		expect(accountabilityResponseReadinessSource).toContain(
			"'report, open, verify, reply, and alignment-count claims'"
		);
		for (const staleAccountabilityResponseCopy of [
			'Accountability or legislation routes are disabled; delivery response evidence is unavailable.',
			'Power scorecards are unread, so no delivery-response count is claimed.',
			'response off',
			'Accountability response routes are disabled; Commons cannot claim response evidence in this build.',
			'Accountability response ground is unread; no report, open, verify, reply, or alignment counts are invented.'
		]) {
			expect(accountabilityResponseReadinessSource).not.toContain(
				staleAccountabilityResponseCopy
			);
		}
		expect(layout).toContain('buildAccountabilityResponseReadiness,');
		expect(layout).toContain('function sumKnownScorecardMetric(');
		expect(layout).toContain('const accountabilityResponseReadiness = $derived(');
		expect(layout).toContain('buildAccountabilityResponseReadiness({');
		expect(layout).toContain('scorecardCount: data.spaces.landscape?.scorecardSnapshotCount ?? null');
		expect(layout).toContain(
			"openedCount: sumKnownScorecardMetric(data.spaces.landscape?.scorecards, 'reportsOpened')"
		);
		expect(layout).toContain('reportsReceived');
		expect(layout).toContain('verifyLinksClicked');
		expect(layout).toContain("id: 'capability-accountability-response'");
		expect(layout).toContain('href: `${base}/studio#capability-accountability-response`');
		expect(layout).toContain("label: 'Response evidence'");
		expect(component).toContain('buildAccountabilityResponseReadiness,');
		expect(component).toContain('function sumKnownScorecardMetric(');
		expect(component).toContain('scorecardCount: power?.scorecardSnapshotCount ?? null');
		expect(component).toContain("openedCount: sumKnownScorecardMetric(power?.scorecards, 'reportsOpened')");
		expect(component).toContain('type AccountabilityResponseReadinessRow');
		expect(component).toContain(
			'const accountabilityResponseRows = $derived<AccountabilityResponseReadinessRow[]>'
		);
		expect(component).toContain('const accountabilityResponseSegments = $derived');
		expect(component).toContain("labelSuffix: ' response contracts'");
		expect(component).toContain('type AccountabilityResponsePressureReadout = {');
		expect(accountabilityResponsePressureSource).toContain(
			'const proofDeliveryResponseRow = $derived'
		);
		expect(accountabilityResponsePressureSource).toContain(
			'const readerSignalResponseRows = $derived'
		);
		expect(accountabilityResponsePressureSource).toContain(
			'const strongestReaderSignalResponseRow = $derived'
		);
		expect(accountabilityResponsePressureSource).toContain(
			'const heldAccountabilityResponseRows = $derived'
		);
		expect(accountabilityResponsePressureSource).toContain(
			'const firstHeldAccountabilityResponseRow = $derived'
		);
		expect(accountabilityResponsePressureSource).toContain(
			'const accountabilityResponsePressureReadouts = $derived<AccountabilityResponsePressureReadout[]>(['
		);
		expect(accountabilityResponsePressureSource).toContain("id: 'response-ground'");
		expect(accountabilityResponsePressureSource).toContain("id: 'reader-signals'");
		expect(accountabilityResponsePressureSource).toContain("id: 'next-response-lift'");
		expect(accountabilityResponsePressureSource).toContain("label: 'Response ground'");
		expect(accountabilityResponsePressureSource).toContain("label: 'Reader signals'");
		expect(accountabilityResponsePressureSource).toContain("label: 'Next response lift'");
		expect(accountabilityResponsePressureSource).toContain(
			'accountabilityResponseReadiness.signal'
		);
		expect(accountabilityResponsePressureSource).toContain('proofDeliveryResponseRow?.ground');
		expect(accountabilityResponsePressureSource).toContain('strongestReaderSignalResponseRow?.ground');
		expect(accountabilityResponsePressureSource).toContain(
			'firstHeldAccountabilityResponseRow?.boundary'
		);
		expect(accountabilityResponsePressureSource).toContain(
			"?? 'buildAccountabilityResponseReadiness'"
		);
		expect(visibleContractSource).toContain(
			'...accountabilityResponseRows.map((row) => row.state),'
		);
		expect(visibleContractSource).toContain(
			'...accountabilityResponsePressureReadouts.map((readout) => readout.state),'
		);
		expect(accountabilityResponseCard).toContain("workspace: 'Results'");
		expect(accountabilityResponseCard).toContain("phase: 'SEND / AGGREGATE'");
		expect(accountabilityResponseCard).toContain(
			'state: accountabilityResponseReadiness.state'
		);
		expect(accountabilityResponseCard).toContain(
			'statement: accountabilityResponseReadiness.effect'
		);
		expect(component).toContain("id: 'SHIFT-RESPONSE'");
		expect(component).toContain('Response analytics become accountability posture');
		expect(component).toContain("name: 'Accountability response posture'");
		expect(component).toContain(
			"source: 'Power scorecard aggregates + response hypergraph gates'"
		);
		expect(component).toContain("cite: 'buildAccountabilityResponseReadiness'");
		expect(operatorQueueCandidateSource).toContain("label: 'Read accountability response'");
		expect(operatorQueueCandidateSource).toContain(
			'state: accountabilityResponseReadiness.state'
		);
		expect(operatorQueueCandidateSource).toContain(
			'effect: accountabilityResponseReadiness.effect'
		);
		expect(operatorQueueCandidateSource).toContain(
			'detail: accountabilityResponseReadiness.detail'
		);
		expect(accountabilityResponseMarkup).toContain('Accountability response posture');
		expect(accountabilityResponseMarkup).toContain(
			'Where reader signals become accountable ground'
		);
		expect(accountabilityResponseMarkup).toContain(
			'class="terrain-axis" aria-label="Accountability response axis"'
		);
		expect(accountabilityResponseMarkup).toContain('<span>response</span>');
		expect(accountabilityResponseMarkup).toContain('<span>signals</span>');
		expect(accountabilityResponseMarkup).toContain('<span>lift</span>');
		expect(accountabilityResponseMarkup).toContain('<span>gate</span>');
		expect(accountabilityResponseMarkup).toContain('aria-label="Accountability response pressure"');
		expect(accountabilityResponseMarkup).toContain(
			'{#each accountabilityResponsePressureReadouts as readout (readout.id)}'
		);
		expect(accountabilityResponseMarkup).toContain('class="terrain-pressure-cell"');
		expect(accountabilityResponseMarkup).toContain(
			'<span class="terrain-pressure-kicker">{readout.label}</span>'
		);
		expect(accountabilityResponseMarkup).toContain(
			'<span class="terrain-pressure-title">{readout.title}</span>'
		);
		expect(accountabilityResponseMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(accountabilityResponseMarkup).toContain(
			'<span class="terrain-pressure-detail">{readout.detail}</span>'
		);
		expect(accountabilityResponseMarkup).toContain(
			'<span class="terrain-pressure-gate">{readout.gate}</span>'
		);
		expect(accountabilityResponseMarkup).toContain(
			'actionLabel(readout.state, readout.action)'
		);
		expect(accountabilityResponseMarkup).not.toContain(
			'Response evidence does not imply office-surface workflow or anchored'
		);
		expect(accountabilityResponseMarkup).toContain(
			'<Ratio segments={accountabilityResponseSegments} height={8} />'
		);
		expect(accountabilityResponseMarkup).toContain(
			'cite="buildAccountabilityResponseReadiness"'
		);
		expect(accountabilityResponseMarkup).toContain(
			'aria-label="Accountability response readiness matrix"'
		);
		expect(accountabilityResponseMarkup).toContain(
			'{#each accountabilityResponseRows as row (row.id)}'
		);
		expect(canonicalDoc).toContain(
			'Accountability response posture is a shared Results/Power bridge, not a reporting widget'
		);
		expect(canonicalDoc).toContain(
			'`buildAccountabilityResponseReadiness` owns proof-delivery register rows'
		);
		expect(canonicalDoc).toContain(
			'`accountabilityResponsePressureReadouts` opens this section with **Response ground**, **Reader signals**, and **Next response lift** cells'
		);
		expect(canonicalDoc).toContain(
			'When accountability response is not armed or unread, the shared builder must name response-evidence, reader-signal, reply, vote-alignment, and office-workflow claims'
		);
		expect(capabilityScope).toContain('Accountability response OS posture');
		expect(capabilityScope).toContain(
			'proof-delivery receipt counts, opened-report signals, verification-link clicks, logged replies'
		);
		expect(capabilityScope).toContain(
			'Accountability response now starts with Response ground, Reader signals, and Next response lift pressure cells from `buildAccountabilityResponseReadiness`'
		);
		expect(spacesContract).toContain('export type FundraisingGroundData = {');
		expect(spacesContract).toContain('fundraising: FundraisingGroundData | null;');
		expect(spacesContract).toContain('export type CoordinationGroundData = {');
		expect(spacesContract).toContain('coordination: CoordinationGroundData | null;');
		expect(layoutServer).toContain('FundraisingGroundData,');
		expect(layoutServer).toContain('CoordinationGroundData,');
		expect(layoutServer).toContain('api.donations.listByOrgWithDonors');
		expect(layoutServer).toContain('api.donations.getConfirmationSummary');
		expect(layoutServer).toContain('api.workflows.list');
		expect(layoutServer).toContain('fundraising: fundraisingGround');
		expect(layoutServer).toContain('coordination: coordinationGround');
		expect(layout).toContain('buildFundraisingReadiness,');
		expect(layout).toContain('buildCoordinationReadiness,');
		expect(layout).toContain('const fundraising = $derived(data.spaces.operating?.fundraising ?? null)');
		expect(layout).toContain('const coordination = $derived(data.spaces.operating?.coordination ?? null)');
		expect(layout).toContain('const fundraisingReadiness = $derived(');
		expect(layout).toContain('const coordinationReadiness = $derived(');
		expect(layout).toContain('buildFundraisingReadiness({');
		expect(layout).toContain('buildCoordinationReadiness({');
		expect(layout).toContain("label: 'Donation receipt posture'");
		expect(layout).toContain("href: `${base}/studio#capability-fundraising`");
		expect(layout).toContain("label: 'Coordination logic readiness'");
		expect(layout).toContain("href: `${base}/studio#capability-coordination`");
		expect(layout).toContain("label: 'Funding actions'");
		expect(layout).toContain("sublabel: 'Donation intake + receipt boundary'");
		expect(layout).toContain('signal: fundraisingReadiness.signal');
		expect(layout).toContain("label: 'Workflow drafts'");
		expect(layout).toContain("sublabel: 'Coordination logic'");
		expect(layout).toContain('signal: coordinationReadiness.signal');
		expect(layout).toContain("label: 'Donation posture'");
		expect(layout).toContain("label: 'Coordination logic'");
		expect(component).toContain('buildFundraisingReadiness,');
		expect(component).toContain('buildCoordinationReadiness,');
		expect(component).toContain('type FundraisingReadinessRow');
		expect(component).toContain('type FundraisingReceiptProofRow');
		expect(component).toContain('type CoordinationReadinessRow');
		expect(component).toContain(
			'const fundraisingRows = $derived<FundraisingReadinessRow[]>(fundraisingReadiness.rows)'
		);
		expect(component).toContain(
			'const fundraisingReceiptProofRows = $derived<FundraisingReceiptProofRow[]>'
		);
		expect(component).toContain(
			'const coordinationRows = $derived<CoordinationReadinessRow[]>(coordinationReadiness.rows)'
		);
		expect(component).toContain('const fundraisingStateCounts = $derived');
		expect(component).toContain('const fundraisingReceiptProofStateCounts = $derived');
		expect(component).toContain('const coordinationStateCounts = $derived');
		expect(component).toContain('const fundraisingSegments = $derived');
		expect(component).toContain('const fundraisingReceiptProofSegments = $derived');
		expect(component).toContain('const heldFundraisingReceiptProofCount = $derived');
		expect(component).toContain('const coordinationSegments = $derived');
		expect(component).toContain("labelSuffix: ' receipt proof rows'");
		expect(component).toContain("labelSuffix: ' funding contracts'");
		expect(component).toContain("labelSuffix: ' coordination contracts'");
		expect(component).toContain('type FundraisingPressureReadout = {');
		expect(component).toContain('type CoordinationPressureReadout = {');
		expect(fundraisingPressureSource).toContain('const taxReceiptFundraisingRow = $derived');
		expect(fundraisingPressureSource).toContain('const heldFundraisingRows = $derived');
		expect(fundraisingPressureSource).toContain('const firstHeldFundraisingRow = $derived');
		expect(fundraisingPressureSource).toContain(
			'const nextReceiptLiftFundraisingRow = $derived'
		);
		expect(fundraisingPressureSource).toContain(
			'const fundraisingPressureReadouts = $derived<FundraisingPressureReadout[]>(['
		);
		expect(fundraisingPressureSource).toContain("id: 'funding-ground'");
		expect(fundraisingPressureSource).toContain("id: 'confirmation-register'");
		expect(fundraisingPressureSource).toContain("id: 'next-receipt-lift'");
		expect(fundraisingPressureSource).toContain("label: 'Funding ground'");
		expect(fundraisingPressureSource).toContain("label: 'Confirmation register'");
		expect(fundraisingPressureSource).toContain("label: 'Next receipt lift'");
		expect(fundraisingPressureSource).toContain('fundraisingReadiness.signal');
		expect(fundraisingPressureSource).toContain('fundraisingConfirmationRow?.ground');
		expect(fundraisingPressureSource).toContain('nextReceiptLiftFundraisingRow?.boundary');
		expect(fundraisingPressureSource).toContain("?? 'buildFundraisingReadiness'");
		expect(coordinationPressureSource).toContain('const coordinationDefinitionRow = $derived');
		expect(coordinationPressureSource).toContain('const sideEffectCoordinationRow = $derived');
		expect(coordinationPressureSource).toContain('const runEvidenceCoordinationRow = $derived');
		expect(coordinationPressureSource).toContain('const heldCoordinationRows = $derived');
		expect(coordinationPressureSource).toContain('const firstHeldCoordinationRow = $derived');
		expect(coordinationPressureSource).toContain(
			'const nextRunLiftCoordinationRow = $derived'
		);
		expect(coordinationPressureSource).toContain(
			'const coordinationPressureReadouts = $derived<CoordinationPressureReadout[]>(['
		);
		expect(coordinationPressureSource).toContain("id: 'definition-ground'");
		expect(coordinationPressureSource).toContain("id: 'side-effect-runner'");
		expect(coordinationPressureSource).toContain("id: 'next-run-lift'");
		expect(coordinationPressureSource).toContain("label: 'Definition ground'");
		expect(coordinationPressureSource).toContain("label: 'Side-effect runner'");
		expect(coordinationPressureSource).toContain("label: 'Next run lift'");
		expect(coordinationPressureSource).toContain('coordinationReadiness.signal');
		expect(coordinationPressureSource).toContain('coordinationDefinitionRow?.ground');
		expect(coordinationPressureSource).toContain('sideEffectCoordinationRow?.boundary');
		expect(coordinationPressureSource).toContain('nextRunLiftCoordinationRow?.boundary');
		expect(coordinationPressureSource).toContain("?? 'buildCoordinationReadiness'");
		expect(visibleContractSource).toContain('...fundraisingRows.map((row) => row.state),');
		expect(visibleContractSource).toContain(
			'...fundraisingReceiptProofRows.map((row) => row.state),'
		);
		expect(visibleContractSource).toContain(
			'...fundraisingPressureReadouts.map((readout) => readout.state),'
		);
		expect(visibleContractSource).toContain(
			'...coordinationPressureReadouts.map((readout) => readout.state),'
		);
		expect(visibleContractSource).toContain('...coordinationRows.map((row) => row.state),');
		expect(fundraisingReadinessSource).toContain('export function buildFundraisingReadiness');
		expect(fundraisingReadinessSource).toContain('type FundraisingReceiptProofRow');
		expect(fundraisingReadinessSource).toContain('proofRows: FundraisingReceiptProofRow[];');
		expect(fundraisingReadinessSource).toContain(
			'const proofRows: FundraisingReceiptProofRow[] = ['
		);
		expect(fundraisingReadinessSource).toContain("label: 'Fundraiser record'");
		expect(fundraisingReadinessSource).toContain("label: 'Public donation page'");
		expect(fundraisingReadinessSource).toContain("label: 'Stripe checkout'");
		expect(fundraisingReadinessSource).toContain("label: 'Donor confirmation register'");
		expect(fundraisingReadinessSource).toContain("label: 'Provider send evidence'");
		expect(fundraisingReadinessSource).toContain("label: 'Receipt policy register'");
		expect(fundraisingReadinessSource).toContain("label: 'Tax and anchored receipts'");
		expect(fundraisingReadinessSource).toContain("label: 'Fundraiser record ground'");
		expect(fundraisingReadinessSource).toContain("label: 'Public intake scope'");
		expect(fundraisingReadinessSource).toContain("label: 'Payment provider handoff'");
		expect(fundraisingReadinessSource).toContain("label: 'Webhook completion'");
		expect(fundraisingReadinessSource).toContain("label: 'Confirmation outcome register'");
		expect(fundraisingReadinessSource).toContain("label: 'Provider send acceptance'");
		expect(fundraisingReadinessSource).toContain("label: 'Receipt policy custody'");
		expect(fundraisingReadinessSource).toContain("label: 'Tax and anchoring boundary'");
		expect(fundraisingReadinessSource).toContain(
			'Baseline donor confirmation is transactional confirmation evidence only'
		);
		expect(fundraisingReadinessSource).toContain(
			'Payment provider handoff is not a Commons receipt'
		);
		expect(fundraisingReadinessSource).toContain(
			'Webhook completion writes completed donation ground'
		);
		expect(fundraisingReadinessSource).toContain(
			'Provider message identifiers are send-provider acceptance evidence only'
		);
		expect(fundraisingReadinessSource).toContain(
			'Receipt policy custody can feed baseline confirmation content'
		);
		expect(fundraisingReadinessSource).toContain(
			'Tax acknowledgment and anchored donation receipts remain dependency-first'
		);
		expect(fundraisingReadinessSource).toContain('fundraising not armed');
		expect(fundraisingReadinessSource).toContain(
			"'fundraiser-record, public-intake, checkout, confirmation, provider evidence, and receipt claims'"
		);
		expect(fundraisingReadinessSource).toContain(
			"unreadGroundBoundary('Fundraising', 'public donation intake claims')"
		);
		expect(fundraisingReadinessSource).toContain(
			"unreadGroundBoundary('Fundraising', 'receipt-policy claims')"
		);
		expect(fundraisingReadinessSource).toContain(
			"unreadGroundBoundary('Fundraising', 'provider send-evidence claims')"
		);
		for (const staleFundraisingReadinessCopy of [
			'Fundraising routes are disabled in this build.',
			'The OS cannot claim public donation intake until fundraising ground loads.',
			'Payment checkout cannot be claimed until fundraising ground loads.',
			'The confirmation register cannot be claimed until fundraising ground loads.',
			'Receipt policy ground cannot be claimed until fundraising ground loads.',
			'fundraising off',
			'Fundraising routes are disabled; the OS cannot claim donation intake or receipt posture in this build.',
			'Funding ground is unread; the OS cannot claim fundraiser records, public intake, confirmations, or receipt posture.'
		]) {
			expect(fundraisingReadinessSource).not.toContain(staleFundraisingReadinessCopy);
		}
		expect(fundraisingCard).toContain("workspace: 'Studio'");
		expect(fundraisingCard).toContain("phase: 'SEND / AGGREGATE'");
		expect(fundraisingCard).toContain('state: fundraisingReadiness.state');
		expect(fundraisingCard).toContain('statement: fundraisingReadiness.effect');
		expect(fundraisingCard).toContain('nextGate: fundraisingReadiness.nextGate');
		expect(fundraisingMarkup).toContain('Funding action readiness');
		expect(fundraisingMarkup).toContain('Where donation intake becomes receipt posture');
		expect(fundraisingMarkup).toContain(
			'class="terrain-axis" aria-label="Funding action axis"'
		);
		expect(fundraisingMarkup).toContain('<span>funding</span>');
		expect(fundraisingMarkup).toContain('<span>confirm</span>');
		expect(fundraisingMarkup).toContain('<span>lift</span>');
		expect(fundraisingMarkup).toContain('<span>gate</span>');
		expect(fundraisingMarkup).toContain('aria-label="Funding action pressure"');
		expect(fundraisingMarkup).toContain(
			'{#each fundraisingPressureReadouts as readout (readout.id)}'
		);
		expect(fundraisingMarkup).toContain('class="terrain-pressure-cell"');
		expect(fundraisingMarkup).toContain(
			'<span class="terrain-pressure-kicker">{readout.label}</span>'
		);
		expect(fundraisingMarkup).toContain(
			'<span class="terrain-pressure-title">{readout.title}</span>'
		);
		expect(fundraisingMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(fundraisingMarkup).toContain(
			'<span class="terrain-pressure-detail">{readout.detail}</span>'
		);
		expect(fundraisingMarkup).toContain(
			'<span class="terrain-pressure-gate">{readout.gate}</span>'
		);
		expect(fundraisingMarkup).toContain('actionLabel(readout.state, readout.action)');
		expect(fundraisingMarkup).not.toContain('Public intake never implies compliant receipt proof.');
		expect(fundraisingMarkup).toContain('Funding receipt proof contract');
		expect(fundraisingMarkup).toContain(
			'<Ratio segments={fundraisingReceiptProofSegments} height={8} />'
		);
		expect(fundraisingMarkup).toContain('value={fundraisingReceiptProofRows.length}');
		expect(fundraisingMarkup).toContain('cite="buildFundraisingReadiness proofRows"');
		expect(fundraisingMarkup).toContain('fundraisingReceiptProofStateCounts.live');
		expect(fundraisingMarkup).toContain('fundraisingReceiptProofStateCounts.partial');
		expect(fundraisingMarkup).toContain('heldFundraisingReceiptProofCount');
		expect(fundraisingMarkup).toContain('aria-label="Funding receipt proof contract"');
		expect(fundraisingMarkup).toContain('{#each fundraisingReceiptProofRows as row (row.id)}');
		expect(fundraisingMarkup).toContain('{row.effect}');
		expect(fundraisingMarkup).toContain('{row.gate}');
		expect(fundraisingMarkup).toContain('<Ratio segments={fundraisingSegments} height={8} />');
		expect(fundraisingMarkup).toContain(
			'<Datum value={fundraisingRows.length} cite="buildFundraisingReadiness" />'
		);
		expect(fundraisingMarkup).toContain('aria-label="Fundraising readiness matrix"');
		expect(fundraisingMarkup).toContain('{#each fundraisingRows as row (row.id)}');
		expect(fundraisingMarkup).toContain('{row.phase} / {formatCapabilityClusters(row.clusters)}');
		expect(fundraisingMarkup).toContain('<Datum value={row.metric.value} cite={row.metric.cite} />');
		expect(fundraisingMarkup).toContain('{row.ground}');
		expect(fundraisingMarkup).toContain('{row.boundary}');
		expect(fundraisingMarkup).toContain('{actionLabel(row.state, row.action)}');
		expect(canonicalDoc).toContain(
			'`fundraisingPressureReadouts` opens this section with **Funding ground**, **Confirmation register**, and **Next receipt lift** cells'
		);
		expect(canonicalDoc).toContain(
			'`buildFundraisingReadiness` now also emits a shared `proofRows` receipt-proof contract'
		);
		expect(canonicalDoc).toContain('#fundraising-receipt-proof-contract');
		expect(capabilityScope).toContain(
			'Funding action readiness now starts with Funding ground, Confirmation register, and Next receipt lift pressure cells from `buildFundraisingReadiness`'
		);
		expect(capabilityScope).toContain('`buildFundraisingReadiness.proofRows`');
		expect(capabilityScope).toContain('#fundraising-receipt-proof-contract');
		expect(coordinationReadinessSource).toContain('export function buildCoordinationReadiness');
		expect(coordinationReadinessSource).toContain("label: 'Coordination definitions'");
		expect(coordinationReadinessSource).toContain("label: 'Trigger dispatch contracts'");
		expect(coordinationReadinessSource).toContain("label: 'Step grammar'");
		expect(coordinationReadinessSource).toContain("label: 'Side-effect runner'");
		expect(coordinationReadinessSource).toContain("label: 'Run evidence'");
		expect(coordinationReadinessSource).toContain(
			'saved definitions, trigger dispatch contracts, step grammar, visible execution arming, and run evidence'
		);
		expect(coordinationReadinessSource).toContain('coordination not armed');
		expect(coordinationReadinessSource).toContain(
			"'definition, trigger, step, side-effect, and run-evidence claims'"
		);
		expect(coordinationReadinessSource).toContain(
			"unreadGroundBoundary('Coordination logic', 'trigger-dispatch claims')"
		);
		expect(coordinationReadinessSource).toContain(
			'run evidence stays unclaimed rather than becoming a zero-performance count'
		);
		for (const staleCoordinationReadinessCopy of [
			'Coordination logic routes are disabled in this build.',
			'Trigger dispatch contracts cannot be claimed until coordination ground loads.',
			'Step grammar cannot be claimed until coordination ground loads.',
			'No workflow execution rows are loaded; run evidence stays unavailable rather than becoming a zero-performance claim.',
			'Run evidence cannot be claimed until coordination ground loads.',
			'coordination off',
			'Coordination routes are disabled; the OS cannot claim coordination logic in this build.',
			'Coordination ground is unread; the OS cannot claim definitions, trigger contracts, side-effect posture, or run evidence.'
		]) {
			expect(coordinationReadinessSource).not.toContain(staleCoordinationReadinessCopy);
		}
		expect(coordinationLogicCard).toContain("workspace: 'Studio'");
		expect(coordinationLogicCard).toContain("phase: 'GROUND / SEND / AGGREGATE'");
		expect(coordinationLogicCard).toContain('state: coordinationReadiness.state');
		expect(coordinationLogicCard).toContain('statement: coordinationReadiness.effect');
		expect(coordinationLogicCard).toContain('nextGate: coordinationReadiness.nextGate');
		expect(coordinationMarkup).toContain('Coordination logic readiness');
		expect(coordinationMarkup).toContain('Where workflow drafts become auditable runs');
		expect(coordinationMarkup).toContain(
			'class="terrain-axis" aria-label="Coordination logic axis"'
		);
		expect(coordinationMarkup).toContain('<span>definitions</span>');
		expect(coordinationMarkup).toContain('<span>effects</span>');
		expect(coordinationMarkup).toContain('<span>lift</span>');
		expect(coordinationMarkup).toContain('<span>gate</span>');
		expect(coordinationMarkup).toContain('aria-label="Coordination logic pressure"');
		expect(coordinationMarkup).toContain(
			'{#each coordinationPressureReadouts as readout (readout.id)}'
		);
		expect(coordinationMarkup).toContain('class="terrain-pressure-cell"');
		expect(coordinationMarkup).toContain(
			'<span class="terrain-pressure-kicker">{readout.label}</span>'
		);
		expect(coordinationMarkup).toContain(
			'<span class="terrain-pressure-title">{readout.title}</span>'
		);
		expect(coordinationMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(coordinationMarkup).toContain(
			'<span class="terrain-pressure-detail">{readout.detail}</span>'
		);
		expect(coordinationMarkup).toContain(
			'<span class="terrain-pressure-gate">{readout.gate}</span>'
		);
		expect(coordinationMarkup).toContain('actionLabel(readout.state, readout.action)');
		expect(coordinationMarkup).not.toContain('Saved logic never implies background automation.');
		expect(coordinationMarkup).toContain('<Ratio segments={coordinationSegments} height={8} />');
		expect(coordinationMarkup).toContain(
			'<Datum value={coordinationRows.length} cite="buildCoordinationReadiness" />'
		);
		expect(coordinationMarkup).toContain('aria-label="Coordination readiness matrix"');
		expect(coordinationMarkup).toContain('{#each coordinationRows as row (row.id)}');
		expect(coordinationMarkup).toContain(
			'{row.phase} / {formatCapabilityClusters(row.clusters)}'
		);
		expect(coordinationMarkup).toContain(
			'<Datum value={row.metric.value} cite={row.metric.cite} />'
		);
		expect(coordinationMarkup).toContain('{row.ground}');
		expect(coordinationMarkup).toContain('{row.boundary}');
		expect(coordinationMarkup).toContain('{actionLabel(row.state, row.action)}');
		expect(canonicalDoc).toContain(
			'`coordinationPressureReadouts` opens this section with **Definition ground**, **Side-effect runner**, and **Next run lift** cells'
		);
		expect(capabilityScope).toContain(
			'Coordination readiness now starts with Definition ground, Side-effect runner, and Next run lift pressure cells from `buildCoordinationReadiness`'
		);
		expect(operatingAuthorityReadinessSource).toContain(
			'export function buildOperatingAuthorityReadiness'
		);
		for (const authorityLabel of [
			"label: 'Publish authority'",
			"label: 'Team seats and invites'",
			"label: 'Role and removal authority'",
			"label: 'Owner transfer ceremony'",
			"label: 'Org audit log'",
			"label: 'Plan limits'",
			"label: 'Plan feature boundary'",
			"label: 'Public API ground'",
			"label: 'Signed webhooks'",
			"label: 'PII encryption authority'",
			"label: 'Registry environment'"
		]) {
			expect(operatingAuthorityReadinessSource).toContain(authorityLabel);
		}
		expect(operatingAuthorityReadinessSource).toContain('auditLogGate: GateEvidence');
		expect(operatingAuthorityReadinessSource).toContain(
			'const { eventRecordsGate, customDomainGate, mainnetGate, auditLogGate } = input.gates'
		);
		expect(operatingAuthorityReadinessSource).toContain("id: 'owner-transfer-ceremony'");
		expect(ownerTransferAuthoritySource).toContain('value: null');
		expect(ownerTransferAuthoritySource).toContain("label: 'transfer ceremonies'");
		expect(ownerTransferAuthoritySource).not.toContain('value: 0');
		expect(operatingAuthorityReadinessSource).toContain("id: 'org-audit-log'");
		expect(operatingAuthorityReadinessSource).toContain(
			'AuditEvents table, mutation writes, retention, and API/query surface'
		);
		expect(operatingAuthorityReadinessSource).toContain(
			'Public API is not armed; developer API surface claims stay dependency-first until the feature gate opens.'
		);
		expect(operatingAuthorityReadinessSource).not.toContain(
			'The public API feature flag is off in this build.'
		);
		expect(operatingAuthorityReadinessSource).toContain(
			'Operating authority separates role power, team seats, owner succession, auditability, billing limits, API/webhooks, org-key custody, tier boundaries, and registry posture'
		);
		expect(layout).toContain('buildOperatingAuthorityReadiness({');
		expect(layout).toContain("const auditLogGate = getGateEvidence('CP-audit-log', ['T9-5']");
		expect(layout).toContain('encryptionConfigured: data.spaces.operating?.emailDelivery.orgKeyConfigured ?? null');
		expect(layout).toContain('auditLogGate');
		expect(layout).toContain("id: 'capability-operating-authority'");
		expect(component).toContain('buildOperatingAuthorityReadiness,');
		expect(component).toContain("const auditLogGate = getGateEvidence('CP-audit-log', ['T9-5']");
		expect(component).toContain('auditLogGate');
		expect(component).toContain('type OperatingAuthorityReadinessRow');
		expect(component).toContain(
			'const operatingAuthorityRows = $derived<OperatingAuthorityReadinessRow[]>'
		);
		expect(component).toContain('const operatingAuthorityStateCounts = $derived');
		expect(component).toContain('const operatingAuthoritySegments = $derived');
		expect(component).toContain("labelSuffix: ' authority contracts'");
		expect(component).toContain('type OperatingAuthorityPressureReadout = {');
		expect(operatingAuthorityPressureSource).toContain('const publishAuthorityRow = $derived');
		expect(operatingAuthorityPressureSource).toContain(
			'const signedWebhookAuthorityRow = $derived'
		);
		expect(operatingAuthorityPressureSource).toContain('const auditLogAuthorityRow = $derived');
		expect(operatingAuthorityPressureSource).toContain(
			'const heldOperatingAuthorityRows = $derived'
		);
		expect(operatingAuthorityPressureSource).toContain(
			'const firstHeldOperatingAuthorityRow = $derived'
		);
		expect(operatingAuthorityPressureSource).toContain('const nextAuthorityLiftRow = $derived');
		expect(operatingAuthorityPressureSource).toContain(
			'const operatingAuthorityPressureReadouts = $derived<OperatingAuthorityPressureReadout[]>(['
		);
		expect(operatingAuthorityPressureSource).toContain("id: 'authority-ground'");
		expect(operatingAuthorityPressureSource).toContain("id: 'signed-substrate'");
		expect(operatingAuthorityPressureSource).toContain("id: 'next-authority-lift'");
		expect(operatingAuthorityPressureSource).toContain("label: 'Authority ground'");
		expect(operatingAuthorityPressureSource).toContain("label: 'Signed substrate'");
		expect(operatingAuthorityPressureSource).toContain("label: 'Next authority lift'");
		expect(operatingAuthorityPressureSource).toContain('operatingAuthorityReadiness.signal');
		expect(operatingAuthorityPressureSource).toContain('publishAuthorityRow?.ground');
		expect(operatingAuthorityPressureSource).toContain('signedWebhookAuthorityRow?.boundary');
		expect(operatingAuthorityPressureSource).toContain('nextAuthorityLiftRow?.boundary');
		expect(operatingAuthorityPressureSource).toContain("'buildOperatingAuthorityReadiness'");
		expect(visibleContractSource).toContain(
			'...operatingAuthorityPressureReadouts.map((readout) => readout.state),'
		);
		expect(visibleContractSource).toContain('...operatingAuthorityRows.map((row) => row.state),');
		expect(operatingAuthorityCard).toContain("workspace: 'Substrate'");
		expect(operatingAuthorityCard).toContain("phase: 'GROUND / AGGREGATE'");
		expect(operatingAuthorityCard).toContain('state: operatingAuthorityReadiness.state');
		expect(operatingAuthorityCard).toContain('statement: operatingAuthorityReadiness.effect');
		expect(operatingAuthorityCard).toContain('nextGate: operatingAuthorityReadiness.nextGate');
		expect(operatingAuthorityMarkup).toContain('Operating authority');
		expect(operatingAuthorityMarkup).toContain(
			'Where org ground becomes enforceable capability'
		);
		expect(operatingAuthorityMarkup).toContain(
			'class="terrain-axis" aria-label="Operating authority axis"'
		);
		expect(operatingAuthorityMarkup).toContain('<span>authority</span>');
		expect(operatingAuthorityMarkup).toContain('<span>substrate</span>');
		expect(operatingAuthorityMarkup).toContain('<span>lift</span>');
		expect(operatingAuthorityMarkup).toContain('<span>gate</span>');
		expect(operatingAuthorityMarkup).toContain('aria-label="Operating authority pressure"');
		expect(operatingAuthorityMarkup).toContain(
			'{#each operatingAuthorityPressureReadouts as readout (readout.id)}'
		);
		expect(operatingAuthorityMarkup).toContain('class="terrain-pressure-cell"');
		expect(operatingAuthorityMarkup).toContain(
			'<span class="terrain-pressure-kicker">{readout.label}</span>'
		);
		expect(operatingAuthorityMarkup).toContain(
			'<span class="terrain-pressure-title">{readout.title}</span>'
		);
		expect(operatingAuthorityMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(operatingAuthorityMarkup).toContain(
			'<span class="terrain-pressure-detail">{readout.detail}</span>'
		);
		expect(operatingAuthorityMarkup).toContain(
			'<span class="terrain-pressure-gate">{readout.gate}</span>'
		);
		expect(operatingAuthorityMarkup).toContain('actionLabel(readout.state, readout.action)');
		expect(operatingAuthorityMarkup).not.toContain('Authority is the product frame.');
		expect(operatingAuthorityMarkup).toContain(
			'<Ratio segments={operatingAuthoritySegments} height={8} />'
		);
		expect(operatingAuthorityMarkup).toContain(
			'<Datum value={operatingAuthorityRows.length} cite="buildOperatingAuthorityReadiness" />'
		);
		expect(operatingAuthorityMarkup).toContain(
			'aria-label="Operating authority readiness matrix"'
		);
		expect(operatingAuthorityMarkup).toContain('{#each operatingAuthorityRows as row (row.id)}');
		expect(operatingAuthorityMarkup).toContain(
			'{row.phase} / {formatCapabilityClusters(row.clusters)}'
		);
		expect(operatingAuthorityMarkup).toContain(
			'<Datum value={row.metric.value} cite={row.metric.cite} />'
		);
		expect(operatingAuthorityMarkup).toContain('{row.ground}');
		expect(operatingAuthorityMarkup).toContain('{row.boundary}');
		expect(operatingAuthorityMarkup).toContain('{actionLabel(row.state, row.action)}');
		expect(canonicalDoc).toContain(
			'`operatingAuthorityPressureReadouts` opens this section with **Authority ground**, **Signed substrate**, and **Next authority lift** cells'
		);
		expect(capabilityScope).toContain(
			'Operating authority now starts with Authority ground, Signed substrate, and Next authority lift pressure cells from `buildOperatingAuthorityReadiness`'
		);
		expect(component).toContain("id: 'SHIFT-AUTHORITY'");
		expect(component).toContain('Operating authority becomes visible');
		expect(component).toContain("name: 'Operating authority readiness'");
		expect(component).toContain("source: 'Membership role + operating authority gates'");
		expect(component).toContain("cite: 'buildOperatingAuthorityReadiness'");
		expect(component).not.toContain('const stateCounts = $derived');
		expect(component).not.toContain('const stateSegments = $derived');
		expect(component).toContain("visual: 'contract-ratio'");
		expect(component).toContain("{#if item.visual === 'contract-ratio'}");
		expect(component).toContain('<Ratio segments={visibleContractSegments} height={10} />');
		expect(component).toContain("{#if shift.visual === 'contract-ratio'}");
		expect(component).toContain('<Ratio segments={visibleContractSegments} height={8} />');
		expect(component).toContain('class="posture-mix"');
		expect(component).toContain('aria-label="Operating posture state mix"');
		expect(component).toContain('<Datum value={visibleContractCounts.live} />');
		expect(component).toContain('<Datum value={visibleContractCounts.partial} />');
		expect(component).toContain(
			"<Datum value={visibleContractCounts['draft-only'] + visibleContractCounts.gated} />"
		);
		expect(component).toContain('class="shift-axis"');
		expect(component).toContain('aria-label="Operational shift axis"');
		expect(component).toContain('<span>incumbent mode</span>');
		expect(component).toContain('<span>Commons mode</span>');
		expect(component).toContain('<span>gate</span>');
		expect(component).toContain('type ShiftPressureReadout = {');
		expect(capabilityShiftSource).toContain('const groundedShiftCount = $derived(');
		expect(capabilityShiftSource).toContain('const qualifiedShiftCount = $derived(');
		expect(capabilityShiftSource).toContain('const heldShiftCount = $derived(');
		expect(capabilityShiftSource).toContain('const loadBearingShift = $derived(');
		expect(peopleOperatingPosture).toContain('state: peopleGroundState');
		expect(peopleOperatingPosture).toContain('href: peopleGroundHref');
		expect(peopleOperatingPosture).toContain('action: peopleGroundAction');
		expect(peopleOperatingPosture).toContain('detail: peopleGroundSummary');
		expect(peopleOperatingPosture).toContain('gate: peopleGroundGate');
		expect(peopleOperatingPosture).toContain('value: peopleGroundMetric.value');
		expect(peopleOperatingPosture).toContain('label: peopleGroundMetric.label');
		expect(peopleOperatingPosture).toContain('cite: peopleGroundMetric.cite');
		expect(peopleOperatingPosture).not.toContain("state: 'partial'");
		expect(peopleOperatingPosture).not.toContain('people?.identityVerified');
		expect(peopleShiftSource).toContain('state: peopleGroundState');
		expect(peopleShiftSource).toContain('href: peopleGroundHref');
		expect(peopleShiftSource).toContain('action: peopleGroundAction');
		expect(peopleShiftSource).toContain('evidence: peopleGroundSummary');
		expect(peopleShiftSource).toContain('gate: peopleGroundGate');
		expect(peopleShiftSource).toContain('value: peopleGroundMetric.value');
		expect(peopleShiftSource).toContain('label: peopleGroundMetric.label');
		expect(peopleShiftSource).toContain('cite: peopleGroundMetric.cite');
		expect(peopleShiftSource).toContain('C-verification / C-reach / C-data-sovereignty');
		expect(peopleShiftSource).not.toContain("state: 'partial'");
		expect(peopleShiftSource).not.toContain('unreadSliceClaimBoundary');
		expect(peopleShiftSource).not.toContain('people?.identityVerified');
		expect(peopleShiftSource).not.toContain("label: 'identity verified'");
		const powerShiftSource = section(
			capabilityShiftSource,
			"id: 'SHIFT-POWER'",
			"id: 'SHIFT-MONITORING'"
		);
		expect(powerShiftSource).toContain('state: powerTerrainReadiness.state');
		expect(powerShiftSource).toContain(
			'firstHeldPowerTerrainRow?.href ?? `${base}/representatives#power-reach-boundary`'
		);
		expect(powerShiftSource).toContain('firstHeldPowerTerrainRow?.action ??');
		expect(powerShiftSource).toContain('evidence: powerTerrainReadiness.effect');
		expect(powerShiftSource).toContain(
			'gate: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate'
		);
		expect(powerShiftSource).toContain('value: powerTerrainReadiness.terrainCount');
		expect(powerShiftSource).toContain("cite: 'buildPowerTerrainReadiness'");
		expect(powerShiftSource).not.toContain("state: 'partial'");
		expect(powerShiftSource).not.toContain(
			'Power slice carries followed targets, watched bills, and accountability scores together.'
		);
		expect(powerShiftSource).not.toContain('unreadSliceClaimBoundary');
		expect(powerShiftSource).not.toContain('reachExpansionGate');
		expect(powerShiftSource).not.toContain("label: 'tracked targets'");
		expect(powerShiftSource).not.toContain("cite: 'legislation.listOrgDmFollows'");
		expect(capabilityShiftSource).toContain(
			'const shiftPressureReadouts = $derived<ShiftPressureReadout[]>(['
		);
		expect(capabilityShiftSource).toContain("label: 'Grounded lift'");
		expect(capabilityShiftSource).toContain("label: 'Qualified lift'");
		expect(capabilityShiftSource).toContain("label: 'Next lift'");
		expect(component).toContain('aria-label="Operational shift pressure"');
		expect(component).toContain('{#each shiftPressureReadouts as item (item.id)}');
		expect(component).toContain('class="shift-pressure-card"');
		expect(component).toContain('<span class="shift-pressure-label">{item.label}</span>');
		expect(component).toContain('<span class="shift-pressure-state">{stateLabel(item.state)}</span>');
		expect(component).toContain('<Datum value={item.metric.value} cite={item.metric.cite} />');
		expect(component).toContain('<span class="shift-pressure-detail">{item.detail}</span>');
		expect(component).toContain('<span class="shift-pressure-gate">{item.gate}</span>');
		expect(component).toContain(
			'<span class="shift-pressure-action">{actionLabel(item.state, item.action)}</span>'
		);
		expect(component).toContain(".shift-pressure-card[data-state='draft-only']");
		expect(component).toContain(".shift-pressure-card[data-state='gated']");
		expect(component).not.toContain('Read this first:');
		expect(component).not.toContain('Not a feature list:');
		expect(component).not.toContain(
			'Four dials: loop, send boundary, evidence basis, and load-bearing gate.'
		);
		expect(component).not.toContain(
			'Each state names one representative handoff, route effect, source, and gate from the same'
		);
		expect(component).not.toContain(
			'Derived from visible cards, compound paths, loop phases, and gate rows.'
		);
			expect(component).toContain(
				'ground: `${liveLoopPhaseCount}/${loopPhases.length} phases armed; AUTHOR ${stateLabel('
			);
			expect(component).toContain("nextLift: firstHeldLoopPhase?.label ?? 'delegated proof'");
			expect(component).toContain('state: sendLoopState');
			expect(component).toContain('summary: sendLoopSummary');
			expect(component).toContain('gate: sendLoopGate');
			expect(component).toContain('ground: sendLoopGround');
			expect(component).toContain('nextLift: sendLoopNextLift');
			expect(component).not.toContain("'all send modes armed'");
			expect(component).not.toContain("item.visual === 'state-ratio'");
			expect(component).not.toContain("shift.visual === 'state-ratio'");
			expect(component).toContain('function stateLabel(state: CapabilityState): string');
		expect(component).toContain('operatorCapabilityStateLabel,');
		expect(component).toContain('operatorCapabilityStateRatioSegments');
		expect(component).toContain(
			'const sendModeSegments = $derived(operatorCapabilityStateRatioSegments(sendModeStateCounts));'
		);
		expect(component).toContain(
			"operatorCapabilityStateRatioSegments(loopStateCounts, { labelSuffix: ' phases' })"
		);
		expect(component).toContain(
			"operatorCapabilityStateRatioSegments(visibleContractCounts, { labelSuffix: ' contracts' })"
		);
		expect(component).toContain('return operatorCapabilityStateLabel(state);');
		expect(component).toContain('type StateLedgerSource = {');
		expect(component).toContain('const stateLedgerSources = $derived<StateLedgerSource[]>');
		expect(stateLedgerSource).toContain('...workspacePosture.map((row) => ({');
		expect(stateLedgerSource).toContain('...operatingReadout.map((row) => ({');
		expect(stateLedgerSource).toContain('...firstViewportMoveContracts');
		expect(stateLedgerSource).toContain('...claimBoundaries.map((boundary) => ({');
		expect(stateLedgerSource).toContain('...loopPressureReadouts.map((readout) => ({');
		expect(stateLedgerSource).toContain('...launchPressureRows.map((row) => ({');
		expect(stateLedgerSource).toContain('...capabilityCards.map((card) => ({');
		expect(stateLedgerSource).toContain('...sendModes.map((mode) => ({');
		expect(stateLedgerSource).toContain('...studioAuthoringRows.map((row) => ({');
		expect(stateLedgerSource).toContain('...compositionPaths.map((path) => ({');
		expect(stateLedgerSource).toContain('...gateRegister.map((row) => ({');
		expect(stateLedgerSource).toContain('target: card.title');
		expect(stateLedgerSource).toContain('handoff: card.handoff');
		expect(stateLedgerSource).toContain('effect: card.effect');
		expect(stateLedgerSource).toContain('gate: mode.unlock');
		expect(stateLedgerSource).toContain('source: row.gate.source');
		expect(component).toContain('const liveLedgerSource = $derived(');
		expect(component).toContain('const partialLedgerSource = $derived(');
		expect(component).toContain('const draftOnlyLedgerSource = $derived(');
		expect(component).toContain('const gatedLedgerSource = $derived(');
		expect(component).toContain('function fallbackLedgerSource(');
		expect(operatingReadoutMarkup).toContain('aria-label="Operating readout axis"');
		expect(operatingReadoutMarkup).toContain('{#each operatingReadout as item (item.id)}');
		expect(operatingReadoutMarkup).toContain('<span data-state={item.state}>{item.label}</span>');
		expect(operatingReadoutMarkup).toContain(
			'title="{item.label}: {item.summary} Gate: {item.gate}"'
		);
		expect(operatingReadoutMarkup).toContain('Ground: {item.ground}');
		expect(operatingReadoutMarkup).toContain('Next lift: {item.nextLift}');
		expect(operatingReadoutMarkup).toContain('<span class="readout-meta-label">Ground</span>');
		expect(operatingReadoutMarkup).toContain('<span>{item.ground}</span>');
		expect(operatingReadoutMarkup).toContain('<span class="readout-meta-label">Next</span>');
		expect(operatingReadoutMarkup).toContain('<span>{item.nextLift}</span>');
		expect(operatingReadoutMarkup).not.toContain(
			'<span class="readout-summary">{item.summary}</span>'
		);
		expect(operatingReadoutMarkup).not.toContain('<span class="readout-gate">{item.gate}</span>');
		expect(stateLedgerMarkup).toContain('class="state-ledger"');
		expect(stateLedgerMarkup).toContain('Capability state ledger');
		expect(stateLedgerMarkup).toContain('What can move, and what cannot');
		expect(stateLedgerMarkup).toContain('aria-label="Capability state ledger axis"');
		expect(stateLedgerMarkup).toContain('<span>state</span>');
		expect(stateLedgerMarkup).toContain('<span>handoff</span>');
		expect(stateLedgerMarkup).toContain('<span>effect</span>');
		expect(stateLedgerMarkup).toContain('<span>gate</span>');
		expect(stateLedgerMarkup).toContain('aria-label="Capability state ledger"');
		expect(stateLedgerMarkup).toContain('{#each visibleContractStateRows as row (row.state)}');
		expect(stateLedgerMarkup).toContain(
			'<Datum value={row.count} cite="Capability map visible contracts" />'
		);
		expect(stateLedgerMarkup).toContain('<span class="state-ledger-handoff">{row.handoff}</span>');
		expect(stateLedgerMarkup).toContain('<span class="state-ledger-effect">{row.effect}</span>');
		expect(stateLedgerMarkup).toContain('<span class="state-ledger-gate">{row.gate}</span>');
		expect(stateLedgerMarkup).toContain('<span class="state-ledger-source">{row.source}</span>');
		expect(stateLedgerMarkup).toContain('{actionLabel(row.state, row.action)}');
		expect(canonicalDoc).toContain(
			'The map renders **Capability state ledger** at `#capability-state-ledger`'
		);
		expect(canonicalDoc).toContain(
			'armed, bounded, draft-only, and not-armed counts each name one representative handoff'
		);
		expect(capabilityScope).toContain('**Capability state ledger**');
		expect(capabilityScope).toContain(
			'names one representative handoff, route effect, source, action grammar, and gate for each state'
		);
		expect(component).not.toContain(
			'function contractSegmentLabel(state: CapabilityState): string'
		);
		expect(component).not.toContain("label: contractSegmentLabel('live')");
		expect(component).not.toContain("label: contractSegmentLabel('partial')");
		expect(component).not.toContain("label: contractSegmentLabel('draft-only')");
		expect(component).not.toContain("label: contractSegmentLabel('gated')");
		expect(component).toContain("label: stateLabel('live')");
		expect(component).toContain("label: stateLabel('partial')");
		expect(component).toContain("label: stateLabel('draft-only')");
		expect(component).toContain("label: stateLabel('gated')");
		expect(component).toContain("cite: 'OrgSpacesData.return.stats.sentEmails'");
		expect(component).not.toContain("cite: 'organizations.getDashboard'");
		expect(component).not.toContain("label: 'Armed'");
		expect(component).not.toContain("label: 'Bounded'");
		expect(component).not.toContain("label: 'Not armed'");
		expect(component).not.toContain("label: 'armed contracts'");
		expect(component).not.toContain("label: 'bounded contracts'");
		expect(component).not.toContain("label: 'not-armed contracts'");
		expect(component).toContain('type ClaimGrammarRow = {');
		expect(component).toContain('const claimGrammarRows = $derived<ClaimGrammarRow[]>');
		expect(component).toContain('operatorCapabilityStateVerbLabel');
		expect(claimGrammarSource).toContain("verb: stateVerbLabel('live')");
		expect(claimGrammarSource).toContain("verb: stateVerbLabel('partial')");
		expect(claimGrammarSource).toContain("verb: stateVerbLabel('draft-only')");
		expect(claimGrammarSource).toContain("verb: stateVerbLabel('gated')");
		expect(claimGrammarSource).toContain(
			'Do not present drafts as sent, executed, automated, or carrier-delivered.'
		);
		expect(claimGrammarSource).toContain(
			'Do not expose an execution verb until the named gate is armed.'
		);
		expect(claimGrammarSource).toContain('gate: basisGapSummary');
			expect(claimGrammarSource).toContain('gate: sendLoopGate');
		expect(claimGrammarSource).toContain('gate: loadBearingGateSummary');
		expect(component).toContain('type ClaimPressureReadout = {');
		expect(component).toContain('const claimableBoundary = $derived(');
		expect(component).toContain('const qualifiedBoundary = $derived(');
		expect(component).toContain('const blockedBoundary = $derived(');
		expect(component).toContain('const qualifiedClaimCount = $derived(');
		expect(component).toContain('const blockedClaimCount = $derived(');
		expect(component).toContain('const claimPressureReadouts = $derived<ClaimPressureReadout[]>([');
		expect(component).toContain("label: 'Claimable ground'");
		expect(component).toContain("label: 'Qualifier load'");
		expect(component).toContain("label: 'Blocked claim'");
		expect(claimBoundaryMarkup).toContain('class="boundary-axis"');
		expect(claimBoundaryMarkup).toContain('aria-label="Claim boundary axis"');
		expect(claimBoundaryMarkup).toContain('<span>claim</span>');
		expect(claimBoundaryMarkup).toContain('<span>qualifier</span>');
		expect(claimBoundaryMarkup).toContain('<span>blocked claim</span>');
		expect(claimBoundaryMarkup).toContain('aria-label="Claim boundary pressure"');
		expect(claimBoundaryMarkup).toContain('{#each claimPressureReadouts as item (item.id)}');
		expect(claimBoundaryMarkup).toContain('class="boundary-pressure-card"');
		expect(claimBoundaryMarkup).toContain(
			'<span class="boundary-pressure-label">{item.label}</span>'
		);
		expect(claimBoundaryMarkup).toContain(
			'<span class="boundary-pressure-state">{stateLabel(item.state)}</span>'
		);
		expect(claimBoundaryMarkup).toContain(
			'<span class="boundary-pressure-action">{actionLabel(item.state, item.action)}</span>'
		);
		expect(component).toContain(".boundary-pressure-card[data-state='draft-only']");
		expect(component).toContain(".boundary-pressure-card[data-state='gated']");
		expect(component).not.toContain('class="boundary-note"');
		expect(component).not.toContain(
			'What the org can say, what it must qualify, and what stays unarmed.'
		);
		expect(claimBoundaryMarkup).toContain('class="claim-grammar"');
		expect(claimBoundaryMarkup).toContain('aria-label="Claim grammar by capability state"');
		expect(claimBoundaryMarkup).toContain('{#each claimGrammarRows as row (row.state)}');
		expect(claimBoundaryMarkup).toContain('<span class="claim-grammar-verb">{row.verb}</span>');
		expect(claimBoundaryMarkup).toContain('<span class="claim-grammar-deny">{row.mustNot}</span>');
		expect(component).not.toContain("label: 'Live'");
		expect(component).not.toContain("label: 'Partial'");
		expect(component).not.toContain("label: 'Gated'");
		expect(capabilityCardContract).toContain('id: string;');
		expect(capabilityCardContract).toContain('futureLift: string');
		expect(capabilityCardContract).toContain('handoff: string');
		expect(capabilityCardContract).toContain('effect: string');
		expect(capabilityCardContract).toContain('nextGate: GateEvidence');
		expect(capabilityCardContract).not.toContain('unlock: string');
		expect(capabilityCardContract).not.toContain('chokepoint?: string');
		expect(capabilityCardSource).toContain("id: 'proof-bound-constituency'");
		expect(proofBoundConstituencyCard).toContain('state: peopleGroundState');
		expect(proofBoundConstituencyCard).toContain('evidence: peopleGroundSummary');
		expect(proofBoundConstituencyCard).toContain('href: peopleGroundHref');
		expect(proofBoundConstituencyCard).toContain('action: peopleGroundAction');
		expect(proofBoundConstituencyCard).toContain('effect: peopleGroundSummary');
		expect(proofBoundConstituencyCard).toContain('honesty: peopleGroundGate');
		expect(proofBoundConstituencyCard).toContain('nextGate: peopleGroundNextGate');
		expect(proofBoundConstituencyCard).toContain('label: peopleGroundMetric.label');
		expect(proofBoundConstituencyCard).toContain('value: peopleGroundMetric.value');
		expect(proofBoundConstituencyCard).toContain('cite: peopleGroundMetric.cite');
		expect(proofBoundConstituencyCard).not.toContain("state: 'partial'");
		expect(proofBoundConstituencyCard).not.toContain('unreadSliceClaimBoundary');
		expect(proofBoundConstituencyCard).not.toContain('people?.identityVerified');
		expect(proofBoundConstituencyCard).not.toContain("label: 'identity verified'");
		expect(jurisdictionalReachCard).toContain('state: powerTerrainReadiness.state');
		expect(jurisdictionalReachCard).toContain('statement: powerTerrainReadiness.effect');
		expect(jurisdictionalReachCard).toContain('evidence: powerTerrainReadiness.detail');
		expect(jurisdictionalReachCard).toContain(
			'firstHeldPowerTerrainRow?.href ?? `${base}/representatives#power-reach-boundary`'
		);
		expect(jurisdictionalReachCard).toContain('firstHeldPowerTerrainRow?.action ??');
		expect(jurisdictionalReachCard).toContain(
			"handoff: firstHeldPowerTerrainRow?.label ?? 'Power terrain'"
		);
		expect(jurisdictionalReachCard).toContain('effect: powerTerrainReadiness.effect');
		expect(jurisdictionalReachCard).toContain(
			'honesty: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate'
		);
		expect(jurisdictionalReachCard).toContain(
			'nextGate: firstHeldPowerTerrainRow?.gate ?? powerTerrainReadiness.nextGate'
		);
		expect(jurisdictionalReachCard).toContain('value: powerTerrainReadiness.terrainCount');
		expect(jurisdictionalReachCard).toContain("cite: 'buildPowerTerrainReadiness'");
		expect(jurisdictionalReachCard).not.toContain("label: 'tracked targets'");
		expect(jurisdictionalReachCard).not.toContain('power?.followedCount');
		expect(jurisdictionalReachCard).not.toContain("cite: 'legislation.listOrgDmFollows'");
		expect(jurisdictionalReachCard).not.toContain('route-local discovery context');
		expect(capabilityCardSource).toContain("id: 'platform-export-intake'");
		expect(capabilityCardSource).toContain("id: 'grounded-authoring-loop'");
		expect(capabilityCardSource).toContain("id: 'proof-and-receipts'");
		expect(capabilityCardSource).toContain("id: 'owned-civic-infrastructure'");
		expect(cardGrid).toContain('{#each capabilityCards as card (card.id)}');
		expect(cardGrid).not.toContain('{#each capabilityCards as card (card.title)}');
		expect(cardGrid).toContain('data-capability-id={card.id}');
		expect(cardGrid).toContain('aria-label={`${card.title} route-effect contract`}');
		expect(cardGrid).toContain('<span class="card-contract-label">handoff</span>');
		expect(cardGrid).toContain('<span class="card-contract-value">{card.handoff}</span>');
		expect(cardGrid).toContain('<span class="card-contract-label">effect</span>');
		expect(cardGrid).toContain('<span class="card-contract-value">{card.effect}</span>');
		expect(cardGrid).toContain('<span class="card-chokepoint">{card.nextGate.chokepoint}</span>');
		expect(cardGrid).toContain(
			'{gateSummary(card.nextGate, { prefix: card.futureLift, complete: card.futureLift })}'
		);
		expect(cardGrid.indexOf('<h3 class="card-title">{card.title}</h3>')).toBeLessThan(
			cardGrid.indexOf(
				'aria-label={`${capabilityCardClusterLabel(card.cluster)} cluster audit mark`}'
			)
		);
		expect(cardGrid).toContain(
			'aria-label={`${capabilityCardClusterLabel(card.cluster)} cluster audit mark`}'
		);
		expect(cardGrid).toContain(
			'<span class="card-cluster-name">{capabilityCardClusterLabel(card.cluster)}</span>'
		);
		expect(cardGrid).toContain('value={card.cluster}');
		expect(cardGrid).not.toContain('<span class="card-cluster-id">{card.cluster}</span>');
		expect(component).toContain('const latticeStateCounts = $derived');
		expect(component).toContain('const touchedLatticePhaseCount = $derived');
		expect(component).toContain('const heldLatticeRowCount = $derived');
		expect(component).toContain('const highestFanoutLatticeRow = $derived');
		expect(latticeMarkup).toContain('class="lattice-count"');
		expect(latticeMarkup).toContain('Capability footprint: ${capabilityLattice.length}');
		expect(latticeMarkup).toContain('touchedLatticePhaseCount');
		expect(latticeMarkup).toContain('heldLatticeRowCount');
		expect(latticeMarkup).toContain('highestFanoutLatticeRow?.gate.downstream');
		expect(latticeMarkup).toContain('class="lattice-count-split"');
		expect(latticeMarkup).not.toContain('Cells mark loop phases touched by a cluster.');
		expect(component).toContain('.lattice-count {');
		expect(component).toContain('.lattice-count-split {');
		expect(component).not.toContain('.lattice-note {');
		expect(latticeMarkup).toContain('{#each capabilityLattice as row (row.id)}');
		expect(latticeMarkup).not.toContain('{#each capabilityLattice as row (row.title)}');
		expect(latticeMarkup).toContain('<span class="lattice-corner">Capability</span>');
		expect(latticeMarkup).toContain('<span class="lattice-name">{row.title}</span>');
		expect(latticeMarkup).toContain('<span class="lattice-cluster">{row.name}</span>');
		expect(latticeMarkup).toContain('value={row.cluster}');
		expect(latticeMarkup).not.toContain('<span class="lattice-corner">Cluster</span>');
		expect(latticeMarkup).not.toContain('<span class="lattice-name">{row.name}</span>');
		expect(latticeMarkup).not.toContain('<span class="lattice-id">{row.cluster}</span>');
		expect(cardGrid).not.toContain('<span class="card-unlock">{card.unlock}</span>');
		expect(component).toContain("cluster: 'C-reach',\n\t\t\ttitle: 'Platform export intake'");
		expect(platformIntakeCard).toContain("workspace: 'People'");
		expect(platformIntakeCard).toContain("phase: 'GROUND'");
		expect(platformIntakeCard).toContain('state: platformIntakeReadiness.state');
		expect(platformIntakeCard).toContain('statement: platformIntakeReadiness.effect');
			expect(platformIntakeCard).toContain('evidence: platformIntakeReadiness.detail');
			expect(platformIntakeCard).toContain('href: `${base}/supporters/import#csv-intake`');
			expect(platformIntakeCard).toContain("handoff: 'CSV export intake'");
			expect(platformIntakeCard).toContain('direct platform sync stays dependency-first');
			expect(platformIntakeCard).toContain('nextGate: platformApiGate');
		expect(platformIntakeCard).toContain("label: 'recognized profiles'");
		expect(platformIntakeCard).toContain("cite: 'src/lib/data/platform-export-profiles.ts'");
		expect(platformIntakeCard).toContain('futureLift: platformIntakeReadiness.futureLift');
		expect(platformIntakeCard).toContain('honesty: platformIntakeReadiness.boundary');
		expect(platformIntakeCard).toContain('platformExportProfileCount');
		expect(component).toContain("const eventArtifactGate = getGateEvidence('CP-receipt-anchoring'");
		expect(component).toContain('gateSummary(eventArtifactGate');
		expect(component).not.toContain("chokepoint: 'CP-mainnet");
		expect(component).not.toContain("chokepoint: 'CP-TEE");
		expect(component).not.toContain("chokepoint: 'CP-delegation");
		expect(component).not.toContain("chokepoint: 'CP-webhooks");
		expect(component).not.toContain('card.chokepoint');
		expect(component).not.toContain('AB_TESTING=false');
		expect(component).not.toContain('FEATURES.DELEGATION plus');
		expect(component).not.toContain('disabled by feature flag');
		expect(component).not.toContain('feature-gated off');
		expect(component).not.toContain('feature-enabled');
		expect(component).not.toContain("source: 'FEATURES.*'");
		expect(component).toContain("source: 'Configured channel gates'");
			expect(component).toContain("name: 'Channel gates'");
			expect(component).toContain('type ClaimBasis = {');
			expect(component).toContain('const firstUnresolvedHonestyRow = $derived(');
			expect(component).toContain('type RuntimeClaimBasisInput = {');
			expect(component).toContain('id: string;');
			expect(component).toContain('...runtimeGateRows,');
			expect(component).toContain(
				'Send readiness and the gated queue derive from runtime gates plus route-local delivery dependencies.'
			);
			expect(component).toContain('function runtimeGateClaim(input: RuntimeClaimBasisInput): ClaimBasis');
			expect(component).toContain('id: input.id');
			expect(component).toContain("source: 'src/lib/config/features.ts'");
			expect(component).toContain('Execution gate ${input.flagName}=');
			expect(component).toContain('Current ground: ${input.currentGround}');
			expect(component).toContain(
				'Claim boundary: ${input.enabled ? input.enabledBoundary : input.closedBoundary}'
			);
			for (const runtimeGateName of [
				'Execution gate / Server email dispatch',
				'Execution gate / Client merge send',
				'Execution gate / A/B continuation',
				'Execution gate / SMS dispatch',
				'Execution gate / Workflow execution',
				'Execution gate / Congressional delivery',
				'Execution gate / Event artifacts',
				'Execution gate / Coalition proof',
				'Execution gate / Delegated civic action'
			]) {
				expect(runtimeGateRowsSource).toContain(`name: '${runtimeGateName}'`);
			}
			expect(runtimeGateRowsSource).not.toContain('Runtime gate /');
			for (const runtimeGateFlag of [
				"flagName: 'EMAIL_SERVER_DISPATCH'",
				"flagName: 'EMAIL_CLIENT_DIRECT_MERGE'",
				"flagName: 'AB_TESTING'",
				"flagName: 'SMS_DISPATCH'",
				"flagName: 'WORKFLOW_EXECUTION'",
				"flagName: 'CONGRESSIONAL'",
				"flagName: 'EVENTS'",
				"flagName: 'NETWORKS'",
				"flagName: 'DELEGATION'"
			]) {
				expect(runtimeGateRowsSource).toContain(runtimeGateFlag);
			}
		expect(runtimeGateRowsSource).toContain('runtimeGateClaim({');
		expect(runtimeGateRowsSource).toContain("id: 'runtime-server-email-dispatch'");
		expect(runtimeGateRowsSource).toContain("id: 'runtime-sms-dispatch'");
		expect(runtimeServerEmailSource).toContain("state: serverEmailMode?.state ?? 'draft-only'");
		expect(runtimeServerEmailSource).toContain('currentGround:');
		expect(runtimeServerEmailSource).toContain('serverEmailMode?.effect ??');
		expect(runtimeServerEmailSource).toContain(
			'enabledBoundary: serverEmailMode?.unlock ?? sendBoundaryGateSummary'
		);
		expect(runtimeServerEmailSource).toContain(
			'closedBoundary: serverEmailMode?.unlock ?? sendBoundaryGateSummary'
		);
		expect(runtimeServerEmailSource).toContain(
			'gateText: serverEmailMode?.unlock ?? sendBoundaryGateSummary'
		);
		expect(runtimeClientMergeSource).toContain(
			'state: clientMergeMode?.state ?? clientDirectMergeState'
		);
		expect(runtimeClientMergeSource).toContain('clientMergeMode?.effect ??');
		expect(runtimeClientMergeSource).toContain(
			'enabledBoundary: clientMergeMode?.unlock ?? clientDirectMergeGate'
		);
		expect(runtimeClientMergeSource).toContain(
			'closedBoundary: clientMergeMode?.unlock ?? clientDirectMergeGate'
		);
		expect(runtimeClientMergeSource).toContain(
			'gateText: clientMergeMode?.unlock ?? clientDirectMergeGate'
		);
		expect(runtimeAbContinuationSource).toContain(
			'state: abAutomationMode?.state ?? abAutomationState'
		);
		expect(runtimeAbContinuationSource).toContain('abAutomationMode?.effect ??');
		expect(runtimeAbContinuationSource).toContain(
			'enabledBoundary: abAutomationMode?.unlock ?? sendBoundaryGateSummary'
		);
		expect(runtimeAbContinuationSource).toContain(
			'closedBoundary: abAutomationMode?.unlock ?? sendBoundaryGateSummary'
		);
		expect(runtimeAbContinuationSource).toContain('gateText:');
		expect(runtimeAbContinuationSource).toContain('abAutomationMode?.unlock ??');
		expect(runtimeSmsDispatchSource).toContain(
			'state: smsSendMode?.state ?? textDispatchClaimState'
		);
		expect(runtimeSmsDispatchSource).toContain(
			'currentGround: smsSendMode?.effect ?? textDeliveryReadiness.effect'
		);
		expect(runtimeSmsDispatchSource).toContain(
			'enabledBoundary: smsSendMode?.unlock ?? textDeliveryReadiness.gate'
		);
		expect(runtimeSmsDispatchSource).toContain(
			'closedBoundary: smsSendMode?.unlock ?? textDeliveryReadiness.gate'
		);
		expect(runtimeSmsDispatchSource).toContain(
			'gateText: smsSendMode?.unlock ?? textDeliveryReadiness.gate'
		);
		expect(runtimeWorkflowExecutionSource).toContain(
			"state: workflowSendMode?.state ?? (workflowExecutionArmed ? 'live' : 'draft-only')"
		);
		expect(runtimeWorkflowExecutionSource).toContain(
			'currentGround: workflowSendMode?.effect ?? coordinationReadiness.effect'
		);
		expect(runtimeWorkflowExecutionSource).toContain(
			'enabledBoundary: workflowSendMode?.unlock ?? coordinationReadiness.gate'
		);
		expect(runtimeWorkflowExecutionSource).toContain(
			'closedBoundary: workflowSendMode?.unlock ?? coordinationReadiness.gate'
		);
		expect(runtimeWorkflowExecutionSource).toContain('gateText:');
		expect(runtimeWorkflowExecutionSource).toContain('workflowSendMode?.unlock ??');
		expect(runtimeCongressionalDeliverySource).toContain(
			"state: cwcSendMode?.state ?? (congressionalDeliveryArmed ? 'live' : 'gated')"
		);
		expect(runtimeCongressionalDeliverySource).toContain('cwcSendMode?.effect ??');
		expect(runtimeCongressionalDeliverySource).toContain(
			'enabledBoundary: cwcSendMode?.unlock ?? sendBoundaryGateSummary'
		);
		expect(runtimeCongressionalDeliverySource).toContain(
			'closedBoundary: cwcSendMode?.unlock ?? sendBoundaryGateSummary'
		);
		expect(runtimeCongressionalDeliverySource).toContain('gateText:');
		expect(runtimeCongressionalDeliverySource).toContain('cwcSendMode?.unlock ??');
		expect(runtimeEventArtifactSource).toContain('state: eventArtifactMode?.state ??');
		expect(runtimeEventArtifactSource).toContain('eventArtifactMode?.effect ??');
		expect(runtimeEventArtifactSource).toContain(
			'gateText: eventArtifactMode?.unlock ?? gateSummary(eventArtifactGate)'
		);
		expect(runtimeEventArtifactSource).not.toContain("state: FEATURES.EVENTS ? 'partial' : 'gated'");
		expect(runtimeEventArtifactSource).not.toContain('gate: eventArtifactGate');
		expect(runtimeEventArtifactSource).not.toContain('gatePrefix:');
		expect(runtimeGateRowsSource).toContain("id: 'runtime-delegated-civic-action'");
		expect(runtimeCoalitionProofSource).toContain('state: coalitionReadiness.state');
		expect(runtimeCoalitionProofSource).toContain('currentGround: coalitionReadiness.effect');
		expect(runtimeCoalitionProofSource).toContain('enabledBoundary: coalitionReadiness.detail');
		expect(runtimeCoalitionProofSource).toContain('closedBoundary: coalitionReadiness.gate');
		expect(runtimeCoalitionProofSource).toContain('gateText: coalitionReadiness.gate');
		expect(runtimeCoalitionProofSource).not.toContain(
			"state: FEATURES.NETWORKS ? 'partial' : 'gated'"
		);
		expect(runtimeCoalitionProofSource).not.toContain('gate: crossBorderCoalitionGate');
		expect(runtimeCoalitionProofSource).not.toContain('gatePrefix:');
		expect(runtimeDelegatedCivicActionSource).toContain('state: delegatedCivicActionState');
		expect(runtimeDelegatedCivicActionSource).toContain(
			'currentGround: delegatedCivicActionGround'
		);
		expect(runtimeDelegatedCivicActionSource).toContain(
			'enabledBoundary: delegatedCivicActionGateSummary'
		);
		expect(runtimeDelegatedCivicActionSource).toContain(
			'closedBoundary: delegatedCivicActionGateSummary'
		);
		expect(runtimeDelegatedCivicActionSource).toContain(
			'gateText: delegatedCivicActionGateSummary'
		);
		expect(runtimeDelegatedCivicActionSource).not.toContain(
			"state: FEATURES.DELEGATION ? 'partial' : 'gated'"
		);
		expect(runtimeDelegatedCivicActionSource).not.toContain('gate: delegationGate');
		expect(runtimeDelegatedCivicActionSource).not.toContain('gatePrefix:');
		expect(claimBasisSource).toContain("id: 'basis-loaded-org-signal'");
			expect(claimBasisSource).toContain("id: 'basis-quality-trigger'");
			expect(claimBasisSource).toContain("id: 'basis-task-hypergraph'");
			expect(claimBasisSource).toContain('id: `basis-audit-${row.mark}`');
			expect(claimBasisPressureSource).toContain(
				'const heldRuntimeClaimBasisRows = $derived(runtimeGateRows.filter((row) => row.state !=='
			);
			expect(claimBasisPressureSource).toContain('const firstHeldRuntimeClaim = $derived(');
			expect(claimBasisPressureSource).toContain(
				'const claimBasisPressureReadouts = $derived<ClaimBasisPressureReadout[]>'
			);
			expect(claimBasisPressureSource).toContain("id: 'evidence-basis'");
			expect(claimBasisPressureSource).toContain("id: 'first-honesty-gap'");
			expect(claimBasisPressureSource).toContain("id: 'runtime-boundary'");
			expect(claimBasisPressureSource).toContain("label: 'Execution boundary'");
			expect(claimBasisPressureSource).toContain("'read execution boundary'");
			expect(claimBasisPressureSource).toContain("'read execution basis'");
			expect(claimBasisPressureSource).toContain('value: unresolvedBasisCount');
			expect(claimBasisPressureSource).toContain('value: unresolvedHonestyCount');
			expect(claimBasisPressureSource).toContain('value: heldRuntimeClaimBasisRows.length');
			expect(claimBasisPressureSource).toContain("label: 'held execution gates'");
			expect(claimBasisPressureSource).not.toContain('Runtime boundary');
			expect(claimBasisPressureSource).not.toContain('read runtime basis');
			expect(claimBasisPressureSource).not.toContain('runtime feature gate');
			expect(claimBasisPressureSource).toContain(
				'OrgSpacesData layout load + data-hypergraph'
			);
			expect(claimBasisPressureSource).not.toContain('unresolvedGateCount');
			expect(stateLedgerSource).toContain(
				'...claimBasisPressureReadouts.map((readout) => ({'
			);
			expect(claimBasisMarkup).toContain('class="claim-axis" aria-label="Claim basis axis"');
			expect(claimBasisMarkup).toContain('<span>evidence</span>');
			expect(claimBasisMarkup).toContain('<span>audit</span>');
			expect(claimBasisMarkup).toContain('<span>boundary</span>');
			expect(claimBasisMarkup).toContain('<span>gate</span>');
			expect(claimBasisMarkup).not.toContain('Why the map can say what it says.');
			expect(component).toContain('.claim-axis {');
			expect(component).not.toContain('.claim-note {');
			expect(claimBasisMarkup).toContain('aria-label="Claim basis pressure"');
			expect(claimBasisMarkup).toContain(
				'{#each claimBasisPressureReadouts as readout (readout.id)}'
			);
			expect(claimBasisMarkup).toContain(
				'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
			);
			expect(claimBasisMarkup).toContain(
				'actionLabel(readout.state, readout.action)'
			);
			expect(claimBasisMarkup).toContain('{#each claimBasis as claim (claim.id)}');
			expect(claimBasisMarkup).not.toContain('{#each claimBasis as claim (claim.name)}');
			expect(runtimeGateRowsSource).not.toContain(
				'Large or no-key email paths preserve delivery drafts'
			);
			expect(runtimeGateRowsSource).not.toContain(
				'Bulk carrier delivery is not claimed; drafts and records remain the boundary'
			);
			expect(component).toContain('const textDispatchArmed = $derived(');
			expect(component).toContain('const textDispatchRouteReady = $derived(');
			expect(component).toContain('const textDispatchClaimState = $derived<CapabilityState>');
			expect(runtimeGateRowsSource).toContain(
				'state: smsSendMode?.state ?? textDispatchClaimState'
			);
			expect(runtimeGateRowsSource).not.toContain(
				'Counted composer audience filters and bounded draft-detail browser cohort dispatch are mounted'
			);
			expect(runtimeGateRowsSource).not.toContain(
				'carrier delivery still waits for the SMS dispatch gate to clear'
			);
			expect(runtimeGateRowsSource).not.toContain('textDelivery?.dispatchRuntimeMissing?.join');
			expect(runtimeGateRowsSource).not.toContain(
				"state: FEATURES.SMS_DISPATCH ? 'live' : 'draft-only'"
			);
			expect(component).toContain('const workflowExecutionArmed = $derived(');
			expect(runtimeGateRowsSource).toContain(
				"state: workflowSendMode?.state ?? (workflowExecutionArmed ? 'live' : 'draft-only')"
			);
			expect(runtimeGateRowsSource).not.toContain(
				'side-effect arming still waits for the workflow effects gate'
			);
			expect(runtimeGateRowsSource).not.toContain('launch gate before CWC');
			expect(runtimeGateRowsSource).not.toContain('runtime gate is open');
			expect(runtimeGateRowsSource).not.toContain('runtime gate is closed');
		expect(component).not.toContain("unlock: 'Move proofs from Sepolia/local trust");
		expect(component).not.toContain("unlock: 'Add state and special-district officeholders");
		expect(component).not.toContain("unlock: 'T3-6 + T5-3");
		expect(criticalPathContract).toContain('gate: GateEvidence');
		expect(criticalPathContract).toContain('today: string');
		expect(criticalPathContract).toContain('lift: string');
		expect(criticalPathContract).toContain('dependency: string');
		expect(criticalPathContract).toContain('elapsed: string');
		expect(criticalPathContract).not.toContain('tasks: string');
		expect(criticalPathContract).not.toContain('downstream: number');
		expect(criticalPathContract).not.toContain('source: string');
		expect(gateRegisterContract).toContain('gate: GateEvidence');
		expect(gateRegisterContract).not.toContain('dependency: string');
		expect(gateRegisterContract).not.toContain('status: string');
		expect(gateRegisterContract).not.toContain('tasks: string');
		expect(gateRegisterContract).not.toContain('downstream: number');
		expect(gateRegisterContract).not.toContain('source: string');
		expect(criticalPathSource).toContain('eventRecordsGate');
		expect(criticalPathSource).toContain('mainnetGate');
		expect(criticalPathSource).toContain('teeGate');
		expect(criticalPathSource).toContain('studioJurisdictionScopeGate');
		expect(criticalPathSource).toContain('messageProofGate');
		expect(criticalPathSource).toContain('delegationGate');
		expect(criticalPathSource).toContain('readerOfficeGate');
		expect(criticalPathContract).toContain('id: string;');
		expect(criticalPathSource).toContain("id: 'event-emission-substrate'");
		expect(criticalPathSource).toContain("id: 'mainnet-settlement'");
		expect(criticalPathSource).toContain("id: 'reader-office-loop'");
		expect(criticalPathSource).toContain("name: 'Event emission substrate'");
		expect(criticalPathSource).toContain("name: 'Mainnet settlement'");
		expect(criticalPathSource).toContain("name: 'TEE attestation path'");
		expect(criticalPathSource).toContain("dependency: eventRecordsGate.dependency");
		expect(criticalPathSource).toContain("elapsed: '3 days engineering'");
		expect(criticalPathSource).toContain(
			'Audit, Safe setup, verifier deployment, model keys, Scroll gas, and Scroll USDC'
		);
		expect(criticalPathSource).toContain("elapsed: '2-4 weeks ops'");
		expect(criticalPathSource).toContain(
			'Nitro account, enclave image, PCR0 manifest, vsock proxy, and attestation verifier'
		);
		expect(criticalPathSource).toContain("elapsed: '3 weeks elapsed'");
		expect(criticalPathSource).toContain('dependency: studioJurisdictionScopeGate.dependency');
		expect(criticalPathSource).toContain(
			"dependency: 'Drafted message table before writer proof binding'"
		);
		expect(criticalPathSource).toContain(
			"dependency: 'ZK proof attachment first, then delegation executor'"
		);
		expect(criticalPathSource).toContain("elapsed: '5-6 weeks combined'");
		expect(criticalPathSource).toContain('dependency: readerOfficeGate.dependency');
		expect(criticalPathSource).not.toContain('tasks: eventRecordsGate.tasks');
		expect(criticalPathSource).not.toContain('downstream: eventRecordsGate.downstream');
		expect(criticalPathSource).not.toContain(
			'eventRecordsGate.completed}/${eventRecordsGate.total}'
		);
		expect(criticalPathSummarySource).toContain(
			"const unresolvedRows = rows.filter((row) => row.gate.status !== 'completed')"
		);
		expect(criticalPathSummarySource).toContain('row.gate.downstream > current.gate.downstream');
		expect(criticalPathSummarySource).toContain('Critical path clear');
		expect(criticalPathUsage).toContain('buildCriticalPathRows({');
		expect(criticalPathUsage).toContain('eventRecordsGate');
		expect(criticalPathUsage).toContain('mainnetGate');
		expect(criticalPathUsage).toContain('readerOfficeGate');
		expect(criticalPathPressureSource).toContain(
			'const criticalPathSummary = $derived(summarizeCriticalPath(criticalPathRows));'
		);
		expect(criticalPathPressureSource).toContain('const unresolvedCriticalPathRows = $derived(');
		expect(criticalPathPressureSource).toContain('const groundedCriticalPathRow = $derived(');
		expect(criticalPathPressureSource).toContain(
			'const loadBearingCriticalPathRow = $derived(criticalPathSummary.loadBearingRow);'
		);
		expect(criticalPathPressureSource).toContain(
			'const criticalPathPressureReadouts = $derived<CriticalPathPressureReadout[]>'
		);
		expect(criticalPathPressureSource).toContain("id: 'load-bearing-lift'");
		expect(criticalPathPressureSource).toContain("id: 'held-path'");
		expect(criticalPathPressureSource).toContain("id: 'grounded-substrate'");
		expect(criticalPathPressureSource).toContain('criticalPathSummary.loadBearingSummary');
		expect(criticalPathPressureSource).toContain(
			'buildCriticalPathRows / summarizeCriticalPath'
		);
		expect(unlockCascadeSource).toContain(
			'const unlockCascade = $derived<CriticalPathRow[]>(criticalPathRows);'
		);
		expect(unlockCascadeSource).not.toContain('tasks: row.tasks');
		expect(unlockCascadeSource).not.toContain('downstream: row.downstream');
		expect(unlockCascadeSource).not.toContain('source: row.evidence');
		expect(unlockCascadeMarkup).toContain('Critical path');
		expect(unlockCascadeMarkup).toContain('aria-label="Critical path pressure"');
		expect(unlockCascadeMarkup).toContain(
			'{#each criticalPathPressureReadouts as readout (readout.id)}'
		);
		expect(unlockCascadeMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(unlockCascadeMarkup).toContain(
			'actionLabel(readout.state, readout.action)'
		);
		expect(unlockCascadeMarkup).toContain('{#each unlockCascade as item (item.id)}');
		expect(unlockCascadeMarkup).not.toContain('{#each unlockCascade as item (item.name)}');
		expect(unlockCascadeMarkup).toContain('What unlocks the next operating plane');
		expect(unlockCascadeMarkup).toContain(
			'class="cascade-axis" aria-label="Critical path axis"'
		);
		expect(unlockCascadeMarkup).toContain('<span>load-bearing</span>');
		expect(unlockCascadeMarkup).toContain('<span>elapsed</span>');
		expect(unlockCascadeMarkup).toContain('<span>dependency</span>');
		expect(unlockCascadeMarkup).toContain('<span>gate</span>');
		expect(unlockCascadeMarkup).not.toContain(
			'Critical-path gates translated into capability lift.'
		);
		expect(component).toContain('.cascade-axis {');
		expect(component).not.toContain('.cascade-note {');
		expect(unlockCascadeMarkup).toContain(
			'<Datum value={item.gate.downstream} cite={item.gate.source} /> downstream'
		);
		expect(unlockCascadeMarkup).toContain('<span class="cascade-elapsed">{item.elapsed}</span>');
		expect(unlockCascadeMarkup).toContain(
			'<span class="cascade-dependency">{item.dependency}</span>'
		);
		expect(unlockCascadeMarkup).toContain('<span class="cascade-tasks">{item.gate.tasks}</span>');
		expect(gateRegisterSource).toContain('gate: eventRecordsGate');
		expect(gateRegisterContract).toContain('id: string;');
		expect(gateRegisterSource).toContain("id: 'event-emission-records'");
		expect(gateRegisterSource).toContain("id: 'email-send-proxy'");
		expect(gateRegisterSource).toContain("id: 'reader-office-integration'");
		expect(gateRegisterSource).toContain('gate: platformApiGate');
		expect(gateRegisterSource).toContain('gate: emailProxyGate');
		expect(gateRegisterSource).toContain('gate: smsDispatchGate');
		expect(gateRegisterSource).toContain('gate: donationReceiptGate');
		expect(gateRegisterSource).toContain('gate: abAutomationGate');
		expect(gateRegisterSource).toContain('gate: civicGeographyLabelsGate');
		expect(gateRegisterSource).toContain('gate: workflowEffectsGate');
		expect(gateRegisterSource).toContain('gate: mainnetGate');
		expect(gateRegisterSource).toContain('gate: teeGate');
		expect(gateRegisterSource).toContain('gate: delegationGate');
		expect(gateRegisterSource).not.toContain('dependency: eventRecordsGate.dependency');
		expect(gateRegisterSource).not.toContain('status: eventRecordsGate.status');
		expect(gateRegisterSource).not.toContain('tasks: eventRecordsGate.tasks');
		expect(gateRegisterSource).not.toContain('downstream: eventRecordsGate.downstream');
		expect(gateRegisterSummarySource).toContain(
			"const unresolvedRows = rows.filter((row) => row.gate.status !== 'completed')"
		);
		expect(gateRegisterSummarySource).toContain('row.gate.downstream > current.gate.downstream');
		expect(gateRegisterSummarySource).toContain(
			'The highest fan-out unresolved gate remains load-bearing.'
		);
		expect(gateRegisterUsage).toContain('buildGateRegisterRows({');
		expect(gateRegisterUsage).toContain('summarizeGateRegister(gateRegister)');
		expect(gateRegisterUsage).toContain('const unresolvedGateCount');
		expect(gateRegisterUsage).toContain(
			'const gatePressureReadouts = $derived<GatePressureReadout[]>(['
		);
		expect(gateRegisterUsage).toContain("id: 'open-gates'");
		expect(gateRegisterUsage).toContain("id: 'load-bearing-gate'");
		expect(gateRegisterUsage).toContain("id: 'completed-ground'");
		expect(gateRegisterUsage).toContain("label: 'Open gates'");
		expect(gateRegisterUsage).toContain("label: 'Load-bearing gate'");
		expect(gateRegisterUsage).toContain("label: 'Completed ground'");
		expect(layout).toContain('buildGateRegisterRows({');
		expect(layout).toContain(
			'const gateRegisterSummary = $derived(summarizeGateRegister(gateRegisterRows))'
		);
		expect(layout).toContain('const unresolvedGateCount');
		expect(layout).not.toContain('const gateEvidenceRows');
		expect(gateRegisterMarkup).toContain('class="gate-axis"');
		expect(gateRegisterMarkup).toContain('aria-label="Gate register axis"');
		expect(gateRegisterMarkup).toContain('<span>status</span>');
		expect(gateRegisterMarkup).toContain('<span>downstream</span>');
		expect(gateRegisterMarkup).toContain('<span>blocked verb</span>');
		expect(gateRegisterMarkup).toContain('<span>next lift</span>');
		expect(gateRegisterMarkup).toContain('aria-label="Gate register pressure"');
		expect(gateRegisterMarkup).toContain('{#each gatePressureReadouts as readout (readout.id)}');
		expect(gateRegisterMarkup).toContain('class="gate-pressure-cell"');
		expect(gateRegisterMarkup).toContain('<span class="gate-pressure-kicker">{readout.label}</span>');
		expect(gateRegisterMarkup).toContain('<span class="gate-pressure-title">{readout.title}</span>');
		expect(gateRegisterMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(gateRegisterMarkup).toContain(
			'<span class="gate-pressure-action">{actionLabel(readout.state, readout.action)}</span>'
		);
		expect(gateRegisterMarkup).not.toContain('class="gate-note"');
		expect(gateRegisterMarkup).not.toContain(
			'Source chokepoint, dependency class, blocked verb, and future lift.'
		);
		expect(gateRegisterMarkup).toContain('{#each gateRegister as row (row.id)}');
		expect(gateRegisterMarkup).not.toContain('{#each gateRegister as row (row.name)}');
		expect(gateRegisterMarkup).toContain(
			'<span class="gate-dependency">{row.gate.dependency}</span>'
		);
		expect(gateRegisterMarkup).toContain('<span class="gate-status">{row.gate.status}</span>');
		expect(gateRegisterMarkup).toContain(
			'<Datum value={row.gate.downstream} cite={row.gate.source} /> downstream'
		);
		expect(gateRegisterMarkup).toContain('<span class="gate-tasks">{row.gate.tasks}</span>');
		expect(gateRegisterMarkup).toContain(
			'<span class="gate-clusters">{formatCapabilityClusters(row.gate.clusters)}</span>'
		);
		expect(component).toContain('const immediateLiveMove');
		expect(component).toContain('const immediateBoundedMove');
		expect(component).toContain('const immediateGatedMove');
		expect(component).toContain('type QueuePressureReadout = {');
		expect(component).toContain("id: 'SHIFT-INTAKE'");
		expect(component).toContain('Migration becomes source custody');
		expect(component).not.toContain('Migration becomes provenance');
		expect(component).toContain('evidence: platformIntakeReadiness.detail');
		expect(component).toContain('gate: platformIntakeReadiness.gate');
		expect(component).toContain("name: 'Platform intake registry'");
		expect(component).toContain("source: 'platform export profiles + CP-platform-api-sync'");
		expect(component).toContain("cite: 'buildPlatformIntakeReadiness'");
		expect(operatorQueueCandidateSource).toContain("label: 'Import platform exports'");
		expect(operatorQueueCandidateSource).toContain("handoff: 'People import'");
		expect(operatorQueueCandidateSource).toContain('effect: platformIntakeReadiness.effect');
		expect(operatorQueueCandidateSource).toContain('detail: platformIntakeReadiness.detail');
		expect(operatorQueueCandidateSource).toContain('gate: platformIntakeReadiness.gate');
		expect(operatorQueueCandidateSource).toContain("label: 'Read donation receipt posture'");
		expect(operatorQueueCandidateSource).toContain('effect: fundraisingReadiness.effect');
		expect(operatorQueueCandidateSource).toContain('detail: fundraisingReadiness.detail');
		expect(operatorQueueCandidateSource).toContain('gate: fundraisingReadiness.gate');
		expect(operatorQueueCandidateSource).toContain("label: 'Read coordination readiness'");
		expect(operatorQueueCandidateSource).toContain('effect: coordinationReadiness.effect');
		expect(operatorQueueCandidateSource).toContain('detail: coordinationReadiness.detail');
		expect(operatorQueueCandidateSource).toContain('gate: coordinationReadiness.gate');
		expect(operatorQueueCandidateSource).toContain("label: 'Read operating authority'");
		expect(operatorQueueCandidateSource).toContain('effect: operatingAuthorityReadiness.effect');
		expect(operatorQueueCandidateSource).toContain('detail: operatingAuthorityReadiness.detail');
		expect(operatorQueueCandidateSource).toContain('gate: operatingAuthorityReadiness.gate');
		expect(component).toContain("name: 'Donation receipt posture'");
		expect(component).toContain("source: 'Operating fundraising slice + donation receipt gates'");
		expect(component).toContain("cite: 'buildFundraisingReadiness'");
		expect(component).toContain("name: 'Coordination logic readiness'");
		expect(component).toContain("source: 'Operating coordination slice + workflow execution gates'");
		expect(component).toContain("cite: 'buildCoordinationReadiness'");
		expect(component).toContain("name: 'Operating authority readiness'");
		expect(component).toContain("source: 'Membership role + operating authority gates'");
		expect(component).toContain("cite: 'buildOperatingAuthorityReadiness'");
		expect(component).toContain('const safeQueue = $derived<OperatorQueueItem[]>');
		expect(component).toContain('type OperatorQueueItem = {');
		expect(component).toContain('id: string;');
		expect(operatorQueueCandidateSource).toContain("id: 'studio-grounded-authoring'");
		expect(operatorQueueCandidateSource).toContain("id: 'platform-export-intake'");
		expect(operatorQueueCandidateSource).toContain("id: 'email-draft-handoff'");
		expect(peopleProofWeightQueueItem).toContain("id: 'people-proof-weight'");
		expect(peopleProofWeightQueueItem).toContain('state: peopleGroundState');
		expect(peopleProofWeightQueueItem).toContain('href: peopleGroundHref');
		expect(peopleProofWeightQueueItem).toContain('action: peopleGroundAction');
		expect(peopleProofWeightQueueItem).toContain("handoff: 'People ground'");
		expect(peopleProofWeightQueueItem).toContain('effect: peopleGroundSummary');
		expect(peopleProofWeightQueueItem).toContain('detail: peopleGroundSignal');
		expect(peopleProofWeightQueueItem).toContain('gate: peopleGroundGate');
		expect(peopleProofWeightQueueItem).toContain('value: peopleGroundMetric.value');
		expect(peopleProofWeightQueueItem).toContain('label: peopleGroundMetric.label');
		expect(peopleProofWeightQueueItem).toContain('cite: peopleGroundMetric.cite');
		expect(peopleProofWeightQueueItem).not.toContain("state: 'partial'");
		expect(peopleProofWeightQueueItem).not.toContain('people?.identityVerified');
		expect(peopleProofWeightQueueItem).not.toContain('supporters.getSummaryStats');
		expect(peopleProofWeightQueueItem).not.toContain(
			'Reads real people verification and email-health signal'
		);
		expect(safeQueueSource).toContain(
			"operatorQueueCandidates.filter((item) => item.state === 'live' || item.state === 'partial')"
		);
		expect(component).toContain('const heldSendModes = $derived');
		expect(component).toContain('const heldSendHandoffs = $derived');
		expect(gatedQueueSource).toContain('...heldSendModes.map((mode) => ({');
		expect(gatedQueueSource).toContain('id: `send-${mode.key}`');
		expect(gatedQueueSource).toContain('...operatorQueueCandidates');
		expect(gatedQueueSource).toContain('id: item.id');
		expect(gatedQueueSource).toContain("item.state === 'draft-only' || item.state === 'gated'");
		expect(gatedQueueSource).toContain('!heldSendHandoffs.has(item.handoff)');
		expect(queuePressureSource).toContain('const safeQueueLiveCount = $derived');
		expect(queuePressureSource).toContain('const safeQueuePartialCount = $derived');
		expect(queuePressureSource).toContain('const heldQueueDraftOnlyCount = $derived');
		expect(queuePressureSource).toContain('const heldQueueGatedCount = $derived');
		expect(queuePressureSource).toContain(
			'const queuePressureReadouts = $derived<QueuePressureReadout[]>'
		);
		expect(queuePressureSource).toContain("id: 'usable-moves'");
		expect(queuePressureSource).toContain("id: 'held-verbs'");
		expect(queuePressureSource).toContain("id: 'first-held'");
		expect(queuePressureSource).toContain('safeQueue.length');
		expect(queuePressureSource).toContain('gatedQueue.length');
		expect(queuePressureSource).toContain('immediateGatedMove?.gate');
		expect(operatorQueueMarkup).toContain('class="queue-axis" aria-label="Operator queue axis"');
		expect(operatorQueueMarkup).toContain('<span>use</span>');
		expect(operatorQueueMarkup).toContain('<span>hold</span>');
		expect(operatorQueueMarkup).toContain('<span>handoff</span>');
		expect(operatorQueueMarkup).toContain('<span>gate</span>');
		expect(operatorQueueMarkup).not.toContain(
			'Immediate moves on the left. Held verbs stay on the right.'
		);
		expect(operatorQueueMarkup).toContain('class="queue-panel-count"');
		expect(operatorQueueMarkup).toContain(
			'<Datum value={safeQueue.length} cite="Operator queue safe lane" />'
		);
		expect(operatorQueueMarkup).toContain(
			'<Datum value={gatedQueue.length} cite="Operator queue held lane" />'
		);
		expect(operatorQueueMarkup).toContain('{safeQueueLiveCount} armed /');
		expect(operatorQueueMarkup).toContain('{safeQueuePartialCount} bounded');
		expect(operatorQueueMarkup).toContain('{heldQueueDraftOnlyCount} draft /');
		expect(operatorQueueMarkup).toContain('{heldQueueGatedCount} gated');
		expect(operatorQueueMarkup).not.toContain('Armed or bounded paths');
		expect(operatorQueueMarkup).not.toContain('Draft-only or dependency-first');
		expect(component).toContain('.queue-axis {');
		expect(component).toContain('.queue-panel-count {');
		expect(component).not.toContain('.queue-note {');
		expect(component).not.toContain('.queue-panel-note {');
		expect(operatorQueueMarkup).toContain('{#each safeQueue as item (item.id)}');
		expect(operatorQueueMarkup).toContain('{#each gatedQueue as item (item.id)}');
		expect(operatorQueueMarkup).toContain('aria-label="Operator queue pressure"');
		expect(operatorQueueMarkup).toContain(
			'{#each queuePressureReadouts as readout (readout.id)}'
		);
		expect(operatorQueueMarkup).toContain(
			'<span class="queue-pressure-kicker">{readout.label}</span>'
		);
		expect(operatorQueueMarkup).toContain(
			'<span class="queue-pressure-title">{readout.title}</span>'
		);
		expect(operatorQueueMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(operatorQueueMarkup).toContain(
			'<span class="queue-pressure-detail">{readout.detail}</span>'
		);
		expect(operatorQueueMarkup).toContain(
			'<span class="queue-pressure-gate">{readout.gate}</span>'
		);
		expect(operatorQueueMarkup).toContain(
			'<span class="queue-pressure-source">{readout.source}</span>'
		);
		expect(operatorQueueMarkup).toContain('actionLabel(readout.state, readout.action)');
		expect(component).toContain('type SendPressureReadout = {');
		expect(sendPressureSource).toContain(
			'const usableSendModeCount = $derived(sendModeStateCounts.live + sendModeStateCounts.partial)'
		);
		expect(sendPressureSource).toContain('const nextHeldSendMode = $derived(');
		expect(sendPressureSource).toContain(
			'const sendPressureReadouts = $derived<SendPressureReadout[]>(['
		);
		expect(sendPressureSource).toContain("id: 'usable-send'");
		expect(sendPressureSource).toContain("id: 'held-send'");
		expect(sendPressureSource).toContain("id: 'next-send-lift'");
		expect(sendPressureSource).toContain("label: 'Usable send'");
		expect(sendPressureSource).toContain("label: 'Held send'");
		expect(sendPressureSource).toContain("label: 'Next send lift'");
		expect(sendPressureSource).toContain('heldSendModeCount > 0 ? heldSendModeSummary');
		expect(sendPressureSource).toContain("source: 'buildSendReadiness'");
		expect(visibleContractSource).toContain(
			'...sendPressureReadouts.map((readout) => readout.state),'
		);
		expect(sendModeMarkup).toContain('class="readiness-axis" aria-label="Send readiness axis"');
		expect(sendModeMarkup).toContain('<span>mode</span>');
		expect(sendModeMarkup).toContain('<span>state</span>');
		expect(sendModeMarkup).toContain('<span>handoff</span>');
		expect(sendModeMarkup).toContain('<span>gate</span>');
		expect(sendModeMarkup).toContain('aria-label="Send readiness pressure"');
		expect(sendModeMarkup).toContain(
			'{#each sendPressureReadouts as readout (readout.id)}'
		);
		expect(sendModeMarkup).toContain('class="send-pressure-cell"');
		expect(sendModeMarkup).toContain(
			'<span class="send-pressure-kicker">{readout.label}</span>'
		);
		expect(sendModeMarkup).toContain(
			'<span class="send-pressure-title">{readout.title}</span>'
		);
		expect(sendModeMarkup).toContain(
			'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
		);
		expect(sendModeMarkup).toContain(
			'<span class="send-pressure-action">{actionLabel(readout.state, readout.action)}</span>'
		);
		expect(sendModeMarkup).toContain('{#each sendModes as mode (mode.key)}');
		expect(component).toContain(".send-pressure-cell[data-state='draft-only']");
		expect(component).toContain(".send-pressure-cell[data-state='gated']");
		expect(component).not.toContain('class="readiness-note"');
		expect(component).not.toContain(
			'Execution verbs only. Draft and gated rows do not claim side effects.'
		);
		expect(component).not.toContain('{#each safeQueue as item (item.label)}');
		expect(component).not.toContain('{#each gatedQueue as item (item.label)}');
		expect(component).not.toContain('{#each sendModes as mode (mode.label)}');
		expect(component).toContain('<Datum value={safeQueue.length} cite="Operator queue safe lane" />');
		expect(component).toContain('{safeQueueLiveCount} armed /');
		expect(component).toContain('aria-label="Hold until armed"');
		expect(component).toContain('<span class="queue-panel-title">Hold until armed</span>');
		expect(component).toContain('<Datum value={gatedQueue.length} cite="Operator queue held lane" />');
		expect(component).not.toContain('Live or bounded paths');
		expect(component).not.toContain('Keep gated');
		expect(component).toContain('function gateSummary(');
		expect(component).toContain(
			"return formatGateEvidence(gate, { ...options, density: 'operator' });"
		);
		expect(hypergraph).toContain(
			'const congressionalRuntimeReady = congressionalDelivery?.runtimeReady === true;'
		);
		expect(hypergraph).toContain(
			'features.CONGRESSIONAL && congressionalRuntimeReady && congressionalLaunchGate.state ==='
		);
		expect(hypergraph).toContain('value: congressionalDeliveryArmed ? 1 : null');
		expect(hypergraph).toContain(
			"label: congressionalDeliveryArmed ? 'delivery runtime' : 'runtime evidence'"
		);
		expect(hypergraph).toContain("cite: 'submissions.getCongressionalDeliveryReadiness'");
		expect(hypergraph).not.toContain('value: congressionalDeliveryArmed ? 1 : 0');
		expect(hypergraph).not.toContain("'armed runtimes'");
		expect(hypergraph).not.toContain(
			'features.CONGRESSIONAL && congressionalLaunchGate.state ==='
		);
		expect(submissions).toContain('export const getCongressionalDeliveryReadiness = query({');
		expect(submissions).toContain('await requireAuth(ctx);');
		expect(submissions).toContain('GCP_PROXY_URL');
		expect(submissions).toContain('GCP_PROXY_AUTH_TOKEN');
		expect(submissions).toContain('CWC_API_BASE_URL');
		expect(submissions).toContain('CWC_API_KEY');
		expect(spacesContract).toContain(
			'congressionalDelivery: CongressionalDeliveryGroundData | null;'
		);
		expect(spacesContract).toContain('export type CongressionalDeliveryGroundData = {');
		expect(layoutServer).toContain(
			'serverQuery(api.submissions.getCongressionalDeliveryReadiness, {})'
		);
		expect(layoutServer).toContain('const congressionalDeliveryGround: CongressionalDeliveryGroundData | null');
		expect(layoutServer).toContain('congressionalDelivery: congressionalDeliveryGround');
		for (const sourceText of [layout, component, studioSpace]) {
			expect(sourceText).toContain('congressionalDelivery');
		}
		expect(hypergraph).toContain("state: congressionalDeliveryArmed ? 'live' : 'gated'");
		expect(hypergraph).toContain(
			'route: `${base}/campaigns/new#proof-delivery-boundary`'
		);
		expect(hypergraph).toContain(
			"action: congressionalDeliveryArmed ? 'prepare proof handoff' : 'read proof-delivery boundary'"
		);
		for (const sendPlaceholder of [
			"'open sender'",
			"'inspect path'",
			"'dependency only'",
			"'draft surface'",
			"'launch gate'",
			"'open delivery'",
			"'create variants'",
			"'open runner'",
			"'build definition'",
			"'inspect definitions'"
		]) {
			expect(component).not.toContain(sendPlaceholder);
		}
		for (const sendAction of [
			"'open email composer'",
			"'read browser-send boundary'",
			"'open merge composer'",
			"'preserve merge draft'",
			"'read merge boundary'",
			"'open server dispatch'",
			"'create delivery draft'",
			"'open experiment runner'",
			"'read experiment boundary'",
			"'open text dispatch'",
			"'read text boundary'",
			"'open event artifacts'",
			"'read event boundary'",
			"'open workflow runner'",
			"'read execution boundary'",
			"'prepare proof handoff'",
			"'read proof-delivery boundary'"
		]) {
			expect(hypergraph).toContain(sendAction);
		}
		expect(hypergraph).toContain("action: results.hasPacket ? 'preview packet' : 'open action records'");
		expect(component).not.toContain("action: packet ? 'Preview packet' : 'Open action records'");
		expect(component).not.toContain("action: packet ? 'Preview Packet' : 'Open action records'");
		expect(component).not.toContain("FEATURES.CONGRESSIONAL ? 'live' : 'gated'");
		expect(component).not.toContain("FEATURES.CONGRESSIONAL ? 'open delivery' : 'launch gate'");
		expect(component).not.toContain("'context / launch gate'");
		expect(component).not.toContain('const coordinationIntegrityState = $derived<CapabilityState>');
		expect(component).not.toContain('const coordinationIntegrityEvidence = $derived');
		expect(coordinationCard).toContain(
			'state: resultsCoordinationRow?.state ?? resultsProofReadiness.state'
		);
		expect(coordinationCard).toContain(
			'evidence: resultsCoordinationRow?.ground ?? resultsProofReadiness.detail'
		);
		expect(coordinationCard).toContain(
			'honesty: resultsCoordinationRow?.boundary ?? resultsProofReadiness.gate'
		);
		expect(coordinationCard).not.toContain("state: 'live'");
		expect(component).toContain('const currentClaimState = $derived<CapabilityState>');
		expect(armedClaim).toContain('state: currentClaimState');
		expect(armedClaim).toContain('headline: currentClaimHeadline');
		expect(armedClaim).toContain('claim: currentClaimCopy');
		expect(armedClaim).toContain('evidence: currentClaimEvidence');
		expect(armedClaim).toContain('gate: currentClaimGate');
		expect(armedClaim).toContain('metric: currentClaimMetric');
		expect(component).toContain('[authoringLoopState, resultsProofReadiness.state].sort(');
		expect(component).toContain('boundaryPriority(a) - boundaryPriority(b)');
		expect(component).toContain(
			"'Commons can author with proof claims bounded by Results readiness.'"
		);
		expect(component).toContain("'Claimable ground starts with bounded authoring.'");
		expect(component).toContain(
			'`${authoringLoopSummary} Results claim language follows the shared proof contract: ${resultsProofReadiness.effect}`'
		);
		expect(component).toContain(
			'`Studio claim ground cites ${authoringLoopMetric.cite}; Results proof ground cites ${resultsProofReadiness.metric.cite}. ${resultsProofReadiness.detail}`'
		);
		expect(component).toContain(
			'const currentClaimGate = $derived(`${authoringLoopGate} ${resultsProofReadiness.gate}`)'
		);
		expect(component).toContain(
			'value: resultsProofReadiness.metric.value ?? authoringLoopMetric.value'
		);
		expect(component).not.toContain("packet ? 'live' : ret ? 'partial' : 'gated'");
		expect(component).not.toContain('Commons can author now;');
		expect(component).toContain(
			'Results claim language follows the shared proof contract'
		);
		expect(component).not.toContain(
			'Qualify packet artifacts and coordination integrity until action records produce a current packet.'
		);
		expect(component).not.toContain(
			'Open action records and compute a proof packet before claiming org-specific aggregate proof.'
		);
		expect(component).not.toContain('Results slice current packet');
		expect(armedClaim).not.toContain("state: 'live'");
		expect(armedClaim).not.toContain('computed packet artifacts, coordination-integrity math');
		expect(armedClaim).not.toContain('value: liveLoopPhaseCount');
		expect(component).toContain('const blockedClaimGateSummary = $derived(');
		expect(component).toContain('? gateSummary(loadBearingGate.gate, {');
			expect(component).toContain(': sendLoopGate');
		expect(component).not.toContain('const blockedClaimGate = $derived');
		expect(blockedClaim).toContain('gate: blockedClaimGateSummary');
		expect(blockedClaim).not.toContain('${sendBoundaryGate.tasks}');
		expect(blockedClaim).not.toContain('${mainnetGate.tasks}');
		expect(blockedClaim).not.toContain('${teeGate.tasks}');
		expect(blockedClaim).not.toContain('${delegationGate.tasks}');
		expect(blockedClaim).not.toContain('${readerOfficeGate.tasks}');
		expect(hypergraph).toContain('export function buildSendReadiness');
		expect(hypergraph).toContain("phase: 'SEND' | 'SEND / AGGREGATE' | 'AGGREGATE';");
		expect(hypergraph).toContain("phase: 'SEND / AGGREGATE'");
		expect(hypergraph).toContain('EMAIL_CLIENT_DIRECT_MERGE: boolean');
		expect(hypergraph).toContain('clientDirectMergeState');
		expect(hypergraph).toContain('browserDirectState');
		expect(hypergraph).toContain('nextHeldMode');
		expect(hypergraph).toContain('heldModeSummary: string');
		expect(hypergraph).toContain('const compactSendModeLabels');
		expect(hypergraph).toContain('function formatHeldSendModeSummary');
		expect(hypergraph).toContain('const heldModeSummary = formatHeldSendModeSummary(heldModes);');
		expect(hypergraph).toContain('sendBoundarySummary: string');
		expect(hypergraph).toContain('sendBoundaryGate: string');
		expect(hypergraph).toContain('const workflowExecutionArmed =');
		expect(hypergraph).toContain(
			"features.WORKFLOW_EXECUTION && workflowEffectsGate.state === 'live'"
		);
		expect(hypergraph).toContain("key: 'ab-automation'");
		expect(hypergraph).toContain('route: `${base}/emails#ab-continuation-boundary`');
		expect(hypergraph).toContain("handoff: 'A/B continuation'");
		expect(hypergraph).toContain(
			"action: abAutomationState === 'live' ? 'open experiment runner' : 'read experiment boundary'"
		);
		expect(hypergraph).not.toContain("'set up variants'");
		expect(hypergraph).toContain("state: workflowExecutionArmed ? 'live' : 'draft-only'");
		expect(hypergraph).not.toContain("state: features.WORKFLOW_EXECUTION ? 'live' : 'draft-only'");
		expect(launchPressureSource).toContain("id: 'workflow-arming'");
		expect(launchPressureSource).toContain(
			'href: `${base}/workflows#workflow-execution-boundary`'
		);
		expect(launchPressureSource).toContain(
			"action: workflowExecutionArmed ? 'open workflow runner' : 'read execution boundary'"
		);
		expect(sendReadinessSource).toContain("key: 'workflow'");
		expect(sendReadinessSource).toContain(
			'route: `${base}/workflows#workflow-execution-boundary`'
		);
		expect(sendReadinessSource).toContain(
			"action: workflowExecutionArmed ? 'open workflow runner' : 'read execution boundary'"
		);
		expect(sendReadinessSource).toContain("handoff: 'Workflow execution'");
		expect(sendReadinessSource).toContain("key: 'sms'");
		expect(sendReadinessSource).toContain('route: `${base}/sms#sms-dispatch-boundary`');
		expect(sendReadinessSource).toContain("'read text boundary'");
		expect(sendReadinessSource).toContain("handoff: 'Text dispatch boundary'");
		expect(sendReadinessSource).toContain(
			"unreadGroundBoundary('Operating email delivery', 'browser-direct send readiness claims')"
		);
		expect(sendReadinessSource).not.toContain('Operating email-delivery slice unavailable.');
		expect(hypergraph).not.toContain("'shape workflow definition'");
		expect(hypergraph).not.toContain("handoff: 'Workflow builder'");
		expect(hypergraph).toContain('const sendBoundarySummary = !canPublish');
		expect(hypergraph).toContain('const sendBoundaryGate = !canPublish');
		expect(hypergraph).toContain(
			'Org authority is not attached to this session; Studio can shape intent while delivery-surface handoffs stay read-only and channel gates remain visible.'
		);
		expect(hypergraph).toContain(
			'Org authority is not attached to this session; delivery drafts can be inspected, but delivery-surface handoffs stay read-only.'
		);
		expect(hypergraph).toContain(
			'org authority, a subscribed cohort, org key, and SES proxy evidence'
		);
		expect(hypergraph).toContain(
			'Browser-direct send is dependency-first until org authority, a subscribed cohort, org key, and SES proxy evidence are present.'
		);
		expect(hypergraph).toContain(
			'Org authority is absent for this session, so delivery handoffs remain inspection-only.'
		);
		expect(hypergraph).not.toContain('Publish authority is not attached to this session');
		expect(hypergraph).not.toContain('Publish-authority ground is absent');
		expect(hypergraph).not.toContain('Publishing requires owner/editor authority.');
		expect(hypergraph).not.toContain('Publishing requires a publish-capable role.');
		expect(hypergraph).not.toContain(
			'route handoffs and send side effects require a publish-capable role'
		);
		expect(hypergraph).not.toContain(
			'Draft handoff and send side effects require a publish-capable role'
		);
		expect(hypergraph).not.toContain(
			'route handoff authority, a subscribed cohort, org key, and SES proxy'
		);
		expect(component).toContain('buildSendReadiness({');
		expect(component).toContain('canPublish,');
		expect(component).toContain(
			'const sendModes = $derived<SendReadinessMode[]>(sendReadiness.modes)'
		);
		expect(component).toContain(
			"const serverEmailMode = $derived(sendModes.find((mode) => mode.key === 'server-email') ?? null)"
		);
		expect(component).toContain(
			"const clientMergeMode = $derived(sendModes.find((mode) => mode.key === 'client-merge') ?? null)"
		);
		expect(component).toContain(
			"sendModes.find((mode) => mode.key === 'ab-automation') ?? null"
		);
		expect(component).toContain(
			"const smsSendMode = $derived(sendModes.find((mode) => mode.key === 'sms') ?? null)"
		);
		expect(component).toContain(
			"const workflowSendMode = $derived(sendModes.find((mode) => mode.key === 'workflow') ?? null)"
		);
		expect(component).toContain(
			"const cwcSendMode = $derived(sendModes.find((mode) => mode.key === 'cwc') ?? null)"
		);
		expect(component).toContain('const heldSendModeCount = $derived(sendReadiness.heldCount)');
		expect(component).toContain(
			'const clientDirectMergeState = $derived<CapabilityState>(sendReadiness.clientDirectMergeState)'
		);
		expect(component).toContain(
			'const sendBoundarySummary = $derived(sendReadiness.sendBoundarySummary)'
		);
		expect(component).toContain(
			'const sendBoundaryGateSummary = $derived(sendReadiness.sendBoundaryGate)'
		);
			expect(component).toContain(
				'const sendBoundaryState = $derived<CapabilityState>(sendReadiness.state)'
			);
			expect(component).toContain(
				'const heldSendModeSummary = $derived(sendReadiness.heldModeSummary)'
			);
			expect(component).toContain('const sendBoundaryStepGate = $derived(');
			expect(component).toContain('sendReadiness.nextHeldLabel');
			expect(component).toContain('sendReadiness.nextHeldGate');
			expect(component).toContain(
				'const sendLoopState = $derived<CapabilityState>(sendReadiness.state)'
			);
			expect(component).toContain('const sendLoopSummary = $derived(');
			expect(component).toContain(
				'sendReadiness.heldModeSummary}; ${sendReadiness.sendBoundarySummary}'
			);
			expect(component).toContain('const sendLoopGate = $derived(sendReadiness.sendBoundaryGate)');
			expect(component).toContain('const sendLoopMetric = $derived({');
			expect(component).toContain(
				"label: sendReadiness.heldCount === 1 ? 'held send mode' : 'held send modes'"
			);
			expect(component).toContain('const sendLoopGround = $derived(');
			expect(component).toContain('const sendLoopNextLift = $derived(');
			expect(loopPhaseSource).toContain("id: 'SEND'");
			expect(loopPhaseSource).toContain('state: sendLoopState');
			expect(loopPhaseSource).toContain('summary: sendLoopSummary');
			expect(loopPhaseSource).toContain('unlock: sendLoopGate');
			expect(loopPhaseSource).toContain('metric: sendLoopMetric');
			expect(component).not.toContain("state: 'partial',\n\t\t\tworkspace: 'Studio'");
			expect(component).toContain('state: clientMergeMode?.state ?? clientDirectMergeState');
			expect(hypergraph).toContain('unlock: clientDirectMergeGate');
		expect(component).not.toContain("state: FEATURES.EMAIL_CLIENT_DIRECT_MERGE ? 'live' : 'gated'");
		expect(component).toContain('<span class="path-unlock">{gateSummary(path.weakestGate)}</span>');
		expect(component).toContain('aria-label="Capability composition pressure"');
		expect(component).not.toContain('Read this before the registers');
		const actionStrip = section(
			component,
			'id="capability-actions"',
			'id="capability-composition"'
		);
		expect(actionStrip).toContain('class="action-strip-count"');
		expect(actionStrip).toContain('aria-label="Next moves state mix"');
		expect(actionStrip).toContain('{#each operatingSpine as item (item.id)}');
		expect(actionStrip).toContain('class="action-strip-count-item" data-state={item.state}');
		expect(actionStrip).toContain('<Datum value={item.value} cite={item.cite} />');
		expect(actionStrip).not.toContain('Use, qualify, hold.');
		expect(component).toContain('.action-strip-count {');
		expect(component).toContain('.action-strip-count-item {');
		expect(component).not.toContain('.action-strip-note {');
		expect(actionStrip).toContain(
			'<span class="action-kicker">{stateLabel(immediateLiveMove.state)}</span>'
		);
		expect(actionStrip).toContain(
			'<span class="action-kicker">{stateLabel(immediateBoundedMove.state)}</span>'
		);
		expect(actionStrip).toContain(
			'<span class="action-kicker">{stateLabel(immediateGatedMove.state)}</span>'
		);
		expect(actionStrip).toContain(
			"<span class=\"action-kicker\">{stateLabel(loadBearingGate?.state ?? 'live')}</span>"
		);
		expect(actionStrip).toContain('aria-label="{immediateLiveMove.label}: {stateLabel(');
		expect(actionStrip).toContain('aria-label="{immediateBoundedMove.label}: {stateLabel(');
		expect(actionStrip).toContain('aria-label="{immediateGatedMove.label}: {stateLabel(');
		expect(actionStrip).not.toContain('<span class="action-kicker">Use now</span>');
		expect(actionStrip).not.toContain('<span class="action-kicker">Bounded</span>');
		expect(actionStrip).not.toContain('<span class="action-kicker">Hold until armed</span>');
		expect(actionStrip).not.toContain('Keep gated');
		expect(actionStrip).toContain('<span class="action-gate">{immediateLiveMove.gate}</span>');
		expect(actionStrip).toContain('<span class="action-gate">{immediateBoundedMove.gate}</span>');
		expect(actionStrip).toContain('<span class="action-gate">{immediateGatedMove.gate}</span>');
		expect(actionStrip).toContain(
			"loadBearingGate?.gate.dependency ?? 'No dependency gate registered.'"
		);
		expect(component).toContain("title: 'Action-to-proof loop'");
		expect(component).toContain("title: 'Proof-bound people'");
		expect(component).toContain("title: 'Coalition packet'");
		expect(component).toContain("title: 'Delegated civic action'");
		expect(component).not.toContain('T2-1/T2-2 plus congressional launch gates');
		expect(component).not.toContain('must land before the composer can claim server-side send');
		expect(component).not.toContain('SMS_DISPATCH=false; ${smsDispatchGate.tasks}');
		expect(component).not.toContain('CONGRESSIONAL=false; ${congressionalLaunchGate.tasks}');
		expect(component).not.toContain('WORKFLOW_EXECUTION=false; ${workflowEffectsGate.tasks}');
		expect(component).not.toContain("unlock: 'T6-1 + T6-2 + T8-8'");
		expect(component).not.toContain("unlock: 'T4-2 -> T4-1'");
		expect(component.indexOf('id="capability-composition"')).toBeLessThan(
			component.indexOf('id="launch-pressure"')
		);
		expect(component.indexOf('id="capability-actions"')).toBeLessThan(
			component.indexOf('id="capability-composition"')
		);
		expect(component.indexOf('id="capability-composition"')).toBeLessThan(
			component.indexOf('id="capability-loop"')
		);

		expect(layout).toContain('const compositionPathStates');
		expect(layout).toContain('const compositionCommandState');
		expect(layout).toContain('const compositionCommandGate');
		expect(layout).toContain('const studioJurisdictionScopeGate = getGateEvidence(');
		expect(layout).toContain("const messageProofGate = getGateEvidence('CP-message-proof-binding'");
		expect(layout).toContain('const studioScopeCommandState = $derived<CapabilityCommandState>');
		expect(layout).toContain('const studioScopeCommandGate = $derived');
		expect(layout).toContain('formatGateEvidence,');
		expect(layout).toContain('type GateEvidence');
		expect(layout).toContain('function commandGate(gate: GateEvidence, prefix: string): string');
		expect(layout).toContain(
			"return formatGateEvidence(gate, { prefix, complete: prefix, density: 'operator' });"
		);
		expect(layout).toContain('buildSendReadiness({');
		expect(layout).toContain('const sendReadinessGate = $derived(sendReadiness.sendBoundaryGate)');
		expect(layout).toContain(
			'const clientDirectMergeCommandState = $derived<CapabilityCommandState>('
		);
		expect(layout).toContain('sendReadiness.clientDirectMergeState');
		expect(layout).toContain('clientDirectMergeCommandState');
		expect(layout).not.toContain('clientDirectMergeCommandGate');
		expect(layout).not.toContain('sendReadiness.modes.map((mode) => mode.unlock).join');
		expect(layout).not.toContain('Server dispatch and proxy delivery stay held.');
		expect(layout).not.toContain('A/B continuation stays held.');
		expect(layout).toContain('sendReadiness.nextHeldLabel');
		expect(layout).toContain('sendReadiness.nextHeldGate');
		expect(layout).not.toContain('const sendModeStates');
		expect(layout).not.toContain('const nextHeldMoveKey');
		expect(layout).not.toContain("FEATURES.EMAIL_CLIENT_DIRECT_MERGE ? 'live' : 'gated'");
		expect(layout).toContain("const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring'");
		expect(layout).toContain('const nextMoveStates');
		expect(layout).toContain('const nextHeldMoveLabel');
		expect(layout).toContain('const nextMovesCommandState');
		expect(layout).toContain('const launchVectorCommandState');
		expect(layout).toContain('const launchVectorCommandSignal');
		expect(layout).toContain('const launchVectorCommandGate');
		expect(layout).toContain("id: 'capability-actions'");
		expect(layout).toContain("label: 'Next moves'");
		expect(layout).toContain('href: `${base}/studio#capability-actions`');
		expect(layout).toContain("id: 'capability-launch-vector'");
		expect(layout).toContain("label: 'Launch vector'");
		expect(layout).toContain("sublabel: 'First unblock + held surface'");
		expect(layout).toContain('href: `${base}/studio#capability-launch-vector`');
		expect(layout).toContain("from '$lib/data/capability-clusters'");
		expect(layout).toContain('CAPABILITY_CLUSTER_IDS.length');
		expect(layout).toContain('const clusterCoverageCommandState');
		expect(layout).toContain('const clusterCoverageCommandSignal');
		expect(layout).toContain('const clusterCoverageCommandGate');
		expect(layout).toContain('const stateLedgerCommandState');
		expect(layout).toContain('const stateLedgerCommandSignal');
		expect(layout).toContain('const stateLedgerCommandGate');
		expect(layout).toContain(
			'const heldSendModeSummary = $derived(sendReadiness.heldModeSummary);'
		);
		expect(layout).toContain('${heldSendModeSummary} · ${unresolvedGateCount}');
		expect(layout).toContain('signal: `${browserDirectSendSignal} · ${heldSendModeSummary}`');
		expect(layout).toContain('operatorCapabilityStateLabel');
		expect(layout).toContain('function commandStateLabel(state: CapabilityCommandState): string');
		expect(layout).toContain("${commandStateLabel('live')} loop phases");
		expect(layout).toContain("id: 'capability-cluster-coverage'");
		expect(layout).toContain("label: 'Capability coverage'");
		expect(layout).toContain("sublabel: 'Nine clusters, current evidence'");
		expect(layout).toContain('href: `${base}/studio#capability-cluster-coverage`');
		expect(layout).toContain(
			"action: spotlightActionForState(clusterCoverageCommandState, 'read capability coverage')"
		);
		expect(layout).toContain("id: 'capability-state-ledger'");
		expect(layout).toContain("label: 'Capability state ledger'");
		expect(layout).toContain("sublabel: 'Armed, bounded, draft-only, not armed'");
		expect(layout).toContain('href: `${base}/studio#capability-state-ledger`');
		expect(layout).toContain(
			"action: spotlightActionForState(stateLedgerCommandState, 'read capability state ledger')"
		);
		expect(layout).toContain("id: 'capability-grounded-authoring'");
		expect(layout).toContain("label: 'Grounded authoring'");
		expect(layout).toContain("sublabel: 'Source + target + artifact reasoning'");
		expect(layout).toContain(
			"action: spotlightActionForState(studioAuthoringCommandState, 'open Studio intent')"
		);
		expect(layout).toContain("id: 'capability-studio-scope-recovery'");
		expect(layout).toContain("label: 'Studio scope and recovery'");
		expect(layout).toContain('href: `${base}/studio#studio-intent`');
		expect(layout).toContain(
			"action: spotlightActionForState(studioScopeCommandState, 'read Studio scope and recovery')"
		);
		expect(layout).not.toContain(
			"action: spotlightActionForState(studioScopeCommandState, 'read contract')"
		);
		expect(layout).toContain("id: 'capability-composition'");
		expect(layout).toContain("label: 'Compound moves'");
		expect(layout).toContain('href: `${base}/studio#capability-composition`');
		expect(layout).toContain('buildCriticalPathRows({');
		expect(layout).toContain(
			'const criticalPathSummary = $derived(summarizeCriticalPath(criticalPathRows))'
		);
		expect(layout).toContain("id: 'capability-critical-path'");
		expect(layout).toContain("label: 'Critical path'");
		expect(layout).toContain('href: `${base}/studio#capability-critical-path`');
		expect(layout).toContain(
			"action: spotlightActionForState(criticalPathCommandState, 'read critical path')"
		);
		expect(layout).toContain("${commandStateLabel('live')} · ${criticalPathSummary.unresolvedCount}");
		expect(layout).toContain("signal: `${liveLoopPhaseCount}/${totalLoopPhaseCount} ${commandStateLabel('live')} phases`");
		expect(layout).toContain(
			'${partialCompositionPathCount}/4 ${commandStateLabel(\'partial\')} paths'
		);
		expect(layout).toContain(
			'${gatedCompositionPathCount} ${commandStateLabel(\'gated\')} paths'
		);
		expect(layout).not.toContain('`${partialCompositionPathCount}/4 partial');
		expect(layout).toContain('`${activeNextMoveBoundaryCount} boundaries');
		expect(hypergraph).toContain('export type StudioAuthoringReadinessRowKey =');
		expect(hypergraph).toContain('export type StudioAuthoringReadinessRow = {');
		expect(hypergraph).toContain("export type ResolutionStopReason = 'no-target' | 'no-public-email' | 'stopped' | 'unknown';");
		expect(hypergraph).toContain('export type StudioProcessEvidence = {');
		expect(hypergraph).toContain('droppedTargetCount: number;');
		expect(hypergraph).toContain('resolutionStopReason: ResolutionStopReason | null;');
		expect(hypergraph).toContain('resolutionStopDetail: string | null;');
		expect(hypergraph).toContain('export type StudioAuthoringRuntimeGround = {');
		expect(hypergraph).toContain('modelProviderConfigured?: boolean | null;');
		expect(hypergraph).toContain('sourceSearchConfigured?: boolean | null;');
		expect(hypergraph).toContain('sourceFetchConfigured?: boolean | null;');
		expect(hypergraph).toContain('base: string;');
		expect(hypergraph).toContain('process?: StudioProcessEvidence | null;');
		expect(hypergraph).toContain('runtime?: StudioAuthoringRuntimeGround | null;');
		expect(hypergraph).toContain('processEvidence: StudioProcessEvidence | null;');
		expect(hypergraph).toContain('export function buildStudioAuthoringReadiness');
		expect(studioAuthoringBuilderSource).toContain(
			'const authoringRuntimeReady = runtime?.runtimeReady === true'
		);
		expect(studioAuthoringBuilderSource).toContain(
			"const authoringRuntimeMissingText = authoringRuntimeLoaded"
		);
		expect(studioAuthoringBuilderSource).toContain("'authoring runtime ground'");
		expect(studioAuthoringBuilderSource).toContain(
			'const modelProviderConfigured = runtime?.modelProviderConfigured ?? authoringRuntimeReady'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'const sourceSearchConfigured = runtime?.sourceSearchConfigured ?? authoringRuntimeReady'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'const sourceFetchConfigured = runtime?.sourceFetchConfigured ?? authoringRuntimeReady'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'const resolutionStopped = Boolean(processEvidence?.resolutionStopReason);'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'const resolveState: CapabilityState = !authoringRuntimeReady'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'const sourceGroundingState: CapabilityState = !authoringRuntimeReady'
		);
		expect(studioAuthoringBuilderSource).toContain(
			"processEvidence.resolutionStopReason === 'no-public-email'"
		);
		expect(studioAuthoringBuilderSource).toContain(
			'processEvidence.searchOnlySourceCount > 0'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'const messageCompositionState: CapabilityState = !authoringRuntimeReady'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'Studio intent can be shaped, but grounded authoring streams stay dependency-first'
		);
		expect(studioAuthoringBuilderSource).toContain('runtime missing: ${authoringRuntimeMissingText}');
		for (const authoringRow of [
			"key: 'intent'",
			"key: 'model-provider'",
			"key: 'source-search'",
			"key: 'page-read-evaluation'",
			"key: 'resolve'",
			"key: 'source-grounding'",
			"key: 'message-composition'",
			"key: 'draft-handoff'",
			"key: 'recovery-envelope'",
			"key: 'trace-replay'",
			"key: 'delegated-action'"
		]) {
			expect(studioAuthoringBuilderSource).toContain(authoringRow);
		}
		expect(studioAuthoringBuilderSource).toContain('Intent input is an operator action');
		expect(studioAuthoringBuilderSource).toContain("label: 'Model provider'");
		expect(studioAuthoringBuilderSource).toContain("label: 'Source search'");
		expect(studioAuthoringBuilderSource).toContain("label: 'Page-read evaluation'");
		expect(studioAuthoringBuilderSource).toContain('getMessageGenerationReadiness.modelProviderConfigured');
		expect(studioAuthoringBuilderSource).toContain('getMessageGenerationReadiness.sourceSearchConfigured');
		expect(studioAuthoringBuilderSource).toContain('getMessageGenerationReadiness.sourceFetchConfigured');
		expect(studioAuthoringBuilderSource).toContain('formatAuthoringMissing(runtime)');
		expect(studioAuthoringBuilderSource).toContain('Missing authoring capability: model provider');
		expect(studioAuthoringBuilderSource).toContain('Missing authoring capability: source discovery');
		expect(studioAuthoringBuilderSource).toContain('Missing authoring capability: page-read evaluation');
		expect(studioAuthoringBuilderSource).not.toContain('Missing GEMINI_API_KEY');
		expect(studioAuthoringBuilderSource).not.toContain('Missing EXA_API_KEY');
		expect(studioAuthoringBuilderSource).not.toContain('Missing FIRECRAWL_API_KEY');
		expect(studioAuthoringBuilderSource).toContain('signal: studioResolveSignal(processEvidence)');
		expect(studioAuthoringBuilderSource).toContain('studioResolveGround(processEvidence)');
		expect(studioAuthoringBuilderSource).toContain('public-contact drops');
		expect(studioAuthoringBuilderSource).toContain(
			'Source grounding did not start because RESOLVE did not emit a contactable target.'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'Artifact authoring did not start because RESOLVE did not emit a contactable target.'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'Source grounding stays dependency-first; missing ${authoringRuntimeMissingText}.'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'Artifact authoring stays dependency-first; missing ${authoringRuntimeMissingText}.'
		);
		expect(studioAuthoringBuilderSource).not.toContain('Source grounding cannot be claimed');
		expect(studioAuthoringBuilderSource).not.toContain('Artifact authoring cannot be claimed');
		expect(studioAuthoringBuilderSource).toContain(
			'Authoring stays closed until RESOLVE emits at least one contactable target.'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'Source grounding is emitted by the authoring stream'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'Authored artifact is current-run evidence'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'Draft handoff is not publish or dispatch execution'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'stream-message can issue a recoverable job tuple'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'stream-message can emit a trace id'
		);
		expect(studioAuthoringBuilderSource).toContain(
			'Grounded authoring runtime can start now; target resolution, source grounding, artifact authoring, draft handoff, recovery, trace, and delegated-action claims stay unpromoted until emitted evidence exists.'
		);
		expect(capabilityScope).toContain(
			'unread/absent authoring ground is treated as dependency-first'
		);
		expect(capabilityScope).toContain(
			'The primary Studio workspace mark now consumes `buildStudioAuthoringReadiness`'
		);
		expect(capabilityScope).toContain('its visible gloss is **Authoring center**');
		expect(canonicalDoc).toContain('The visible Studio Mantle gloss is **Authoring center**');
		expect(canonicalDoc).toContain(
			'Send stays a subordinate phase, route handoff, and effect surface, not the workspace identity'
		);
		expect(canonicalDoc).toContain(
			'publish authority cannot downgrade that authoring posture, and only draft handoffs/execution side effects move behind org authority'
		);
		expect(hypergraph).toContain(
			'A focused Studio process has emitted contactable targets, evaluated sources, and an authored artifact'
		);
		expect(hypergraph).toContain('orgOS studioProcessEvidence');
		expect(layout).toContain('buildStudioAuthoringReadiness,');
		expect(layout).toContain('const studioAuthoringReadiness = $derived(');
		expect(layout).toContain('buildStudioAuthoringReadiness({');
		expect(layout).toContain('base,');
		expect(layout).toContain('process: os.studioProcessEvidence');
		expect(layout).toContain('runtime: data.spaces.operating?.authoring ?? null');
		expect(layout).toContain(
			'const studioAuthoringCommandState = $derived<CapabilityCommandState>('
		);
		expect(layout).toContain(
			'const studioAuthoringCommandSignal = $derived(studioAuthoringReadiness.signal)'
		);
		expect(layout).toContain(
			'const studioAuthoringCommandGate = $derived(studioAuthoringReadiness.gate)'
		);
		expect(layout).toContain(
			'const studioAuthoringBoundaryCount = $derived(studioAuthoringReadiness.boundaryCount)'
		);
		expect(hypergraph).toContain('export type StudioScopeReadinessRow = {');
		expect(hypergraph).toContain('export function buildStudioScopeReadiness');
		expect(hypergraph).toContain("key: 'jurisdiction-scope'");
		expect(hypergraph).toContain("key: 'message-recovery'");
		expect(hypergraph).toContain("key: 'trace-replay'");
		expect(hypergraph).toContain("prefix: 'Full jurisdiction scope remains bounded.'");
		expect(hypergraph).toContain("prefix: 'Proof-bound authored-artifact lift remains bounded.'");
		expect(hypergraph).toContain("prefix: 'Delegated trace replay remains bounded.'");
		expect(layout).toContain('buildStudioScopeReadiness,');
		expect(layout).toContain('const studioScopeReadiness = $derived(');
		expect(layout).toContain('buildStudioScopeReadiness({');
		expect(layout).toContain(
			'const studioScopeCommandState = $derived<CapabilityCommandState>(studioScopeReadiness.state)'
		);
		expect(layout).toContain(
			'const studioScopeCommandSignal = $derived(studioScopeReadiness.signal)'
		);
		expect(layout).toContain('const studioScopeCommandGate = $derived(studioScopeReadiness.gate)');
		expect(layout).toContain(
			'const studioScopeBoundaryCount = $derived(studioScopeReadiness.boundaryCount)'
		);
		expect(layout).toContain('signal: studioScopeCommandSignal');
		expect(layout).toContain(
			'`${activeNextMoveBoundaryCount} boundaries · ${studioAuthoringBoundaryCount} authoring · ${studioScopeBoundaryCount} Studio · ${nextHeldMoveLabel}`'
		);
		expect(component).toContain('buildStudioAuthoringReadiness,');
		expect(component).toContain('type StudioProcessEvidence');
		expect(component).toContain('studioProcessEvidence?: StudioProcessEvidence | null');
		expect(component).toContain('const studioAuthoringReadiness = $derived(');
		expect(component).toContain('buildStudioAuthoringReadiness({');
		expect(component).toContain('base,');
		expect(component).toContain('process: studioProcessEvidence');
		expect(component).toContain('const authoringRuntime = $derived(spaces.operating?.authoring ?? null)');
		expect(component).toContain('runtime: authoringRuntime');
		expect(component).toContain('type StudioAuthoringReadinessRow');
		expect(component).toContain(
			'const studioAuthoringRows = $derived<StudioAuthoringReadinessRow[]>'
		);
		expect(component).toContain('const studioAuthoringStateCounts = $derived');
		expect(component).toContain('const studioAuthoringSegments = $derived');
		expect(component).toContain("labelSuffix: ' authoring contracts'");
		expect(component).toContain("title: 'Grounded authoring loop'");
		expect(component).toContain('state: studioAuthoringReadiness.state');
		expect(component).toContain('statement: studioAuthoringReadiness.effect');
		expect(component).toContain('evidence: studioAuthoringReadiness.detail');
		expect(component).toContain('label: studioAuthoringReadiness.metric.label');
		expect(component).toContain('value: studioAuthoringReadiness.metric.value');
		expect(component).toContain("name: 'Studio authoring stream'");
		expect(component).toContain("source: 'stream-decision-makers + stream-message'");
		expect(component).toContain('proof: studioAuthoringReadiness.effect');
		expect(component).toContain('gate: studioAuthoringReadiness.gate');
		expect(visibleContractSource).toContain('...studioAuthoringRows.map((row) => row.state),');
		expect(studioAuthoringMarkup).toContain('Grounded authoring evidence');
		expect(studioAuthoringMarkup).toContain(
			'Where intent becomes an accountable authoring run'
		);
		expect(studioAuthoringMarkup).not.toContain('Where AI copy becomes an accountable run');
		expect(component).toContain(
			'Incumbent mode: ungrounded copy assistance for the advocacy operator.'
		);
		expect(component).not.toContain('Incumbent mode: AI copy generation for the advocacy operator.');
		expect(studioAuthoringMarkup).toContain('class="studio-authoring-count"');
		expect(studioAuthoringMarkup).toContain(
			'Grounded authoring: ${studioAuthoringRows.length} contracts;'
		);
		expect(studioAuthoringMarkup).toContain('studioAuthoringStateCounts.live');
		expect(studioAuthoringMarkup).toContain('studioAuthoringStateCounts.partial');
		expect(studioAuthoringMarkup).toContain(
			"studioAuthoringStateCounts['draft-only']"
		);
		expect(studioAuthoringMarkup).toContain('studioAuthoringStateCounts.gated');
		expect(studioAuthoringMarkup).toContain('class="studio-authoring-split"');
		expect(studioAuthoringMarkup).not.toContain(
			'Model provider, source discovery, page-read evaluation, target resolution, source grounding,'
		);
		expect(component).toContain('.studio-authoring-count {');
		expect(component).toContain('.studio-authoring-split {');
		expect(studioAuthoringMarkup).toContain('<Ratio segments={studioAuthoringSegments} height={8} />');
		expect(studioAuthoringMarkup).toContain(
			'<Datum value={studioAuthoringRows.length} cite="buildStudioAuthoringReadiness" />'
		);
		expect(studioAuthoringMarkup).toContain(
			'aria-label="Grounded authoring readiness matrix"'
		);
		expect(studioAuthoringMarkup).toContain('{#each studioAuthoringRows as row (row.key)}');
		expect(studioAuthoringMarkup).toContain('{row.phase} / {formatCapabilityClusters(row.clusters)}');
		expect(studioAuthoringMarkup).toContain('{row.ground}');
		expect(studioAuthoringMarkup).toContain('{row.gate}');
		expect(component).toContain('buildStudioScopeReadiness,');
		expect(component).toContain('const studioScopeReadiness = $derived(');
		expect(component).toContain('buildStudioScopeReadiness({');
		expect(studioSpace).toContain('buildStudioAuthoringReadiness,');
		expect(studioSpace).toContain('buildStudioScopeReadiness,');
		expect(studioSpace).toContain('type CapabilityState');
		expect(studioSpace).toContain('type StudioCapabilityState = CapabilityState');
		expect(studioSpace).toContain('type StudioStartControl = {');
		expect(studioSpace).toContain('const studioScopeReadiness = $derived(');
		expect(studioSpace).toContain('buildStudioScopeReadiness({');
		expect(studioSpace).toContain('studioJurisdictionScopeGate: jurisdictionScopeGate');
		expect(studioSpace).toContain('const studioAuthoringReadiness = $derived(');
		expect(studioSpace).toContain('buildStudioAuthoringReadiness({');
		expect(studioSpace).toContain('process: os.studioProcessEvidence');
		expect(studioSpace).toContain(
			'const authoringRuntime = $derived(spaces.operating?.authoring ?? null)'
		);
		expect(studioSpace).toContain(
			'const authoringRuntimeReady = $derived(authoringRuntime?.runtimeReady === true)'
		);
		expect(studioSpace).toContain('runtime: authoringRuntime');
		expect(studioSpace).toContain('if (!authoringRuntimeReady) {');
		expect(studioSpace).toContain('authoringRuntime?.runtimeMessage');
		expect(studioSpace).toContain('const studioStartControl = $derived<StudioStartControl>');
		expect(studioSpace).toContain("title: 'Authoring boundary'");
		expect(studioSpace).toContain("action: 'read authoring boundary'");
		expect(studioSpace).toContain("button: 'Authoring boundary'");
		expect(studioSpace).toContain('missing capabilities');
		expect(studioSpace).not.toContain("title: 'Runtime boundary'");
		expect(studioSpace).not.toContain("button: 'Runtime not armed'");
		expect(studioSpace).not.toContain('Grounded authoring is not armed');
		expect(studioSpace).toContain('Grounded authoring is dependency-first');
		expect(studioSpace).not.toContain('GEMINI_API_KEY, EXA_API_KEY, and FIRECRAWL_API_KEY');
		expect(studioSpace).toContain("title: 'Intent required'");
		expect(studioSpace).toContain("action: 'supply intent'");
		expect(studioSpace).toContain("title: 'Ready to run'");
		expect(studioSpace).toContain(
			'No authored artifact starts without a contactable decision-maker'
		);
		expect(studioSpace).toContain("title: 'Loop in progress'");
		expect(studioSpace).toContain("action: 'stop loop'");
		expect(studioSpace).toContain('aria-label="Studio start action contract"');
		expect(studioSpace).toContain('data-state={studioStartControl.state}');
		expect(studioSpace).toContain(
			'actionForState(studioStartControl.state, studioStartControl.action)'
		);
		expect(studioSpace).toContain('disabled={studioStartControl.disabled}');
		expect(studioSpace).toContain('class:intent-run--stop={running}');
		expect(studioSpace).toContain(
			'<Datum value={studioStartControl.metric.value} cite={studioStartControl.metric.cite} />'
		);
		expect(studioSpace).not.toContain(
			'disabled={!subjectLine.trim() || !coreMessage.trim() || !authoringRuntimeReady}'
		);
		expect(studioSpace).toContain("label: 'Grounded authoring readiness'");
		expect(studioSpace).toContain('state: studioAuthoringReadiness.state');
		expect(studioSpace).toContain('effect: studioAuthoringReadiness.effect');
		expect(studioSpace).toContain('gate: studioAuthoringReadiness.gate');
		expect(studioSpace).toContain('value: studioAuthoringReadiness.metric.value');
		expect(studioSpace).toContain("label: 'Studio scope and recovery'");
		expect(studioSpace).toContain('state: studioScopeReadiness.state');
		expect(studioSpace).toContain('effect: studioScopeReadiness.effect');
		expect(studioSpace).toContain('gate: studioScopeReadiness.gate');
		expect(studioSpace).toContain('value: studioScopeReadiness.boundaryCount');
		expect(operatorQueueCandidateSource).toContain('state: studioAuthoringReadiness.state');
		expect(operatorQueueCandidateSource).toContain('effect: studioAuthoringReadiness.effect');
		expect(operatorQueueCandidateSource).toContain('detail: studioAuthoringReadiness.detail');
		expect(operatorQueueCandidateSource).toContain('gate: studioAuthoringReadiness.gate');
		expect(operatorQueueCandidateSource).toContain('state: studioScopeReadiness.state');
		expect(operatorQueueCandidateSource).toContain('effect: studioScopeReadiness.effect');
		expect(operatorQueueCandidateSource).toContain('detail: studioScopeReadiness.detail');
		expect(operatorQueueCandidateSource).toContain('gate: studioScopeReadiness.gate');
		expect(layout).toContain(
			"commandGate(studioJurisdictionScopeGate, 'Studio jurisdiction scope remains bounded.')"
		);
		expect(layout).toContain(
			"commandGate(messageProofGate, 'Proof-bound message recovery remains bounded.')"
		);
		expect(layout).toContain(
			"commandGate(delegationGate, 'Agentic execution remains dependency-first.')"
		);
		expect(layout).toContain(
			"commandGate(receiptAnchoringGate, 'Aggregate proof remains bounded.')"
		);
		expect(layout).toContain(
			"commandGate(mainnetGate, 'Action-to-proof settlement remains bounded.')"
		);
		expect(layout).toContain(
			"commandGate(readerOfficeGate, 'Reader-office response remains bounded.')"
		);
		expect(layout).toContain('gate: sendReadinessGate');
		expect(layout).not.toContain('reader office ${readerOfficeGate.tasks}');
		expect(layout).not.toContain('T4-1/T4-2 and T6-1/T6-2 bound stronger claims');
		expect(layout).not.toContain('Gates: ${emailProxyGate.tasks}');
		expect(layout).not.toContain('SMS_DISPATCH=false until ${smsDispatchGate.tasks} lands');
		expect(layout).not.toContain('WORKFLOW_EXECUTION=false blocks visible arming; tag writes');

		expect(canonicalDoc).toContain(
			'The first recognition path is operating spine → workspace posture → operating readout → capability state ledger → capability coverage → next moves → launch vector → grounded authoring evidence → compound moves → launch pressure'
		);
		expect(canonicalDoc).toContain(
			'Its header renders compact `Datum` metrics from `launchVectorReadouts` for First unblock, Largest fan-out, and Held surface before the row audit'
		);
		expect(canonicalDoc).toContain(
			'the workspace posture header renders `Datum`-backed workspace count plus armed/bounded/held state mix from `workspacePostureStateCounts`'
		);
		expect(capabilityScope).toContain(
			'workspace posture renders a `Datum`-backed workspace count plus armed/bounded/held state mix from `workspacePostureStateCounts`'
		);
		expect(capabilityScope).toContain(
			'The Launch vector header now renders compact `Datum` metrics from `launchVectorReadouts` for First unblock, Largest fan-out, and Held surface before the row audit'
		);
		expect(capabilityScope).toContain(
			'The launch-pressure register itself now exposes a `Datum`-backed blocker count, bounded/held mix, and highest downstream fan-out from `launchPressureRows`, `launchPressureStateCounts`, and `highestFanoutLaunchPressureRow`'
		);
		expect(canonicalDoc).toContain(
			'The Compound moves section starts with a pressure rail for compound ground, held phase, and next lift derived only from `compositionPaths` and their phase-step states'
		);
			expect(canonicalDoc).toContain(
				'Render an operating spine before the workspace posture rail'
			);
			expect(canonicalDoc).toContain(
				'**Move now**, **Qualify**, **Hold**, and **Next lift** must derive from `safeQueue`, visible-contract counts, claim-basis gaps, held send modes, and the load-bearing gate'
			);
			expect(canonicalDoc).toContain(
				'Launch vector (`#capability-launch-vector`) must derive from unresolved launch-pressure rows plus the visible contract ledger'
			);
		expect(canonicalDoc).toContain(
			'Capability state ledger (`#capability-state-ledger`) must show armed, bounded, draft-only, and not-armed counts'
		);
		expect(canonicalDoc).toContain(
			'Capability coverage (`#capability-cluster-coverage`) must show all nine clusters with state mix, portfolio balance, lead evidence, and the next unresolved lift'
		);
		expect(canonicalDoc).toContain(
			'Each Next-move tile, in the full map and canvas, derives its visible kicker from the same armed/bounded/draft-only/not-armed state label as the tile state'
		);
		expect(capabilityScope).toContain(
			'Next-move kickers in the full map and canvas are derived from each row\'s armed/bounded/draft-only/not-armed state label'
		);
		expect(canonicalDoc).toContain(
			'then begins with a pressure strip for armed span, first held phase, and aggregate proof before the six phase cards'
		);
		expect(canonicalDoc).toContain(
			'The verified loop section header renders `Datum`-backed phase count plus armed/bounded/held mix from `loopPhaseStateCounts`'
		);
		expect(canonicalDoc).toContain(
			'The capability-footprint lattice header renders `Datum`-backed capability count plus phase-touch, held-row, and downstream-gate mix from `capabilityLattice`'
		);
		expect(canonicalDoc).toContain(
			'People segmentation, List health, Text delivery, and Call routing headers render `Datum`-backed contract count plus armed/bounded/held mix from their shared readiness state counts'
		);
		expect(canonicalDoc).toContain(
			'The loop rail itself starts with armed span, first held phase, and aggregate-proof pressure rows derived from `loopPhases`'
		);
		expect(canonicalDoc).toContain(
			'Its header renders `Datum`-backed phase count plus armed/bounded/held mix from `loopPhaseStateCounts`'
		);
		expect(canonicalDoc).toContain(
			'Its header renders `Datum`-backed capability count plus phase-touch, held-row, and downstream-gate mix from `capabilityLattice`'
		);
		expect(canonicalDoc).toContain(
			'The Capability map and Spotlight mirror these Studio boundaries'
		);
		expect(canonicalDoc).toContain(
			'Map actions use route-effect verbs rather than generic inspection verbs'
		);
		expect(canonicalDoc).toContain(
			'The Next moves header mirrors `operatingSpine` as compact `Datum` counts for Move now, Qualify, Hold, and Next lift before the action tiles'
		);
		expect(canonicalDoc).toContain(
			'Spotlight exposes **Grounded authoring** at `#studio-intent`'
		);
		expect(canonicalDoc).toContain(
			'exposes **Studio scope and recovery** at the same anchor as the stronger-claim boundary'
		);
		expect(canonicalDoc).toContain('The Studio scope and recovery readout marks this as partial');
		expect(canonicalDoc).toContain(
			'The Studio intent contract now leads with shared readiness rows from `buildStudioAuthoringReadiness`, `buildStudioScopeReadiness`, and `orgOS.studioProcessEvidence`'
		);
		expect(canonicalDoc).not.toContain('The Studio contract now renders');
		expect(canonicalDoc).toContain('Spotlight exposes Next moves at `#capability-actions`');
		expect(canonicalDoc).toContain(
			'Spotlight exposes Capability coverage at `#capability-cluster-coverage`'
		);
		expect(canonicalDoc).toContain(
			'Spotlight exposes Capability state ledger at `#capability-state-ledger`'
		);
		expect(capabilityScope).toContain(
			'The Studio Capability map is now an operational instrument rather than a route inventory'
		);
		expect(canonicalDoc).toContain(
			'First-scan section headers must behave as instruments, not instructions'
		);
		expect(canonicalDoc).toContain(
			'Its header uses compact **use / hold / handoff / gate** axis labels instead of explaining the queue lanes in prose.'
		);
		expect(canonicalDoc).toContain(
			'Operating posture shows the visible-contract state mix as audited values'
		);
		expect(canonicalDoc).toContain(
			'Operational shifts uses compact incumbent / Commons / gate axis labels'
		);
		expect(canonicalDoc).toContain(
			'Operational shifts uses compact incumbent / Commons / gate axis labels plus a pressure rail for grounded lift, qualified lift, and next lift derived only from `capabilityShifts`'
		);
		expect(capabilityScope).toContain(
			'The Operating posture header renders the same visible-contract state mix as compact audited values'
		);
		expect(capabilityScope).toContain(
			'The Next moves header now mirrors `operatingSpine` as compact `Datum` counts for Move now, Qualify, Hold, and Next lift before the action tiles'
		);
		expect(capabilityScope).toContain(
			'The Compound moves section renders compound ground, held phase, and next lift pressure cells from `compositionPaths`, phase-step states, and weakest gates before the path cards'
		);
		expect(capabilityScope).toContain(
			'Operational shifts renders incumbent / Commons / gate axis labels and a pressure rail for grounded lift, qualified lift, and next lift derived only from the `capabilityShifts` state mix plus the first gated/draft/partial row'
		);
		expect(capabilityScope).toContain(
			'neither section uses visible explainer copy to describe how to read the map'
		);
			expect(capabilityScope).toContain(
				'**Capability coverage** for the nine canonical clusters'
			);
			expect(canonicalDoc).toContain(
				'portfolio-balance strip for strongest ground, most constrained cluster, and next cluster move'
			);
		expect(capabilityScope).toContain(
			'portfolio-balance readout for strongest ground, most constrained cluster, and next cluster move'
		);
		expect(capabilityScope).toContain(
			'then the section starts with a pressure readout for armed span, first held phase, and aggregate proof, derived only from `loopPhases`, before the six phase cards'
		);
		expect(capabilityScope).toContain(
			'The verified-loop header renders a `Datum`-backed phase count plus armed/bounded/held mix from `loopPhaseStateCounts`'
		);
		expect(capabilityScope).toContain(
			'The capability-footprint lattice header renders a `Datum`-backed capability count plus phase-touch, held-row, and downstream-gate mix from `capabilityLattice`'
		);
		expect(capabilityScope).toContain(
			'People segmentation, List health, Text delivery, and Call routing headers render `Datum`-backed contract count plus armed/bounded/held mix from their shared readiness state counts'
		);
		expect(capabilityScope).toContain(
			'operator queue now starts with a pressure readout for usable moves, held verbs, and first held handoff'
		);
		expect(capabilityScope).toContain(
			'the two queue lane headers render count-backed usable and held totals with armed/bounded and draft/gated splits'
		);
		expect(canonicalDoc).toContain(
			'Its lane headers render `Datum` counts for usable and held paths, with armed/bounded and draft/gated splits from the same queue state.'
		);
		expect(capabilityScope).toContain(
			'its header uses compact use / hold / handoff / gate axis labels instead of explaining lane placement'
		);
		expect(canonicalDoc).toContain(
			'Its header uses compact **evidence / audit / boundary / gate** axis labels before the pressure cells and ledger rows.'
		);
		expect(capabilityScope).toContain(
			'claim-basis layer now starts with compact evidence / audit / boundary / gate axis labels'
		);
		expect(canonicalDoc).toContain(
			'Next-move tiles render state-derived kickers, handoff, effect, and gate in the first viewport'
		);
		expect(canonicalDoc).toContain(
			'Visible gate summaries use adapter-backed task evidence rather than component-local task slogans'
		);
		expect(canonicalDoc).toContain(
			'Spotlight exposes Critical path at `#capability-critical-path`'
		);
		expect(canonicalDoc).toContain('`buildCriticalPathRows` / `summarizeCriticalPath`');
		expect(canonicalDoc).toContain(
			'Critical-path rows come from `buildCriticalPathRows` / `summarizeCriticalPath`'
		);
		expect(canonicalDoc).toContain(
			'Its header uses compact **load-bearing / elapsed / dependency / gate** axis labels before the pressure cells and row audit.'
		);
		expect(canonicalDoc).toContain(
			'plus row-level `elapsed` and `dependency` evidence'
		);
		expect(capabilityScope).toContain(
			'critical-path layer now starts with compact load-bearing / elapsed / dependency / gate axis labels and a pressure readout'
		);
		expect(capabilityScope).toContain(
			'then renders `elapsed` and `dependency` cells from `criticalPathRows`'
		);
		expect(canonicalDoc).toContain(
			'Gate-register rows also carry `GateEvidence`; dependency, status, task IDs, source, fan-out, chokepoint, and clusters render from the gate object'
		);
			expect(canonicalDoc).toContain(
				'Capability card future-lift copy renders through `card.nextGate` and `gateSummary`'
			);
			expect(canonicalDoc).toContain(
				'Capability cards also carry a first-class route-effect contract'
			);
			expect(canonicalDoc).toContain(
				'This keeps the first capability inventory from becoming feature-card prose'
			);
			expect(canonicalDoc).toContain(
				'Platform export intake is also a Reach capability card and operator-queue move'
			);
			expect(canonicalDoc).toContain(
				'The map starts platform intake with Recognized exports, Source custody, and Direct sync boundary pressure cells'
			);
			expect(capabilityScope).toContain(
				'Platform intake now starts with Recognized exports, Source custody, and Direct sync boundary pressure cells'
			);
		expect(canonicalDoc).toContain(
			'People segmentation posture is a shared cohort-readiness surface, not a hidden CRM filter drawer'
		);
		expect(canonicalDoc).toContain(
			'When People segmentation is unread, the shared builder must name the saved-cohort, filter, source, action-context, and civic-geography claims'
		);
		expect(canonicalDoc).toContain(
			'Consent-bound reach is a shared list-health posture, not a deliverability widget'
		);
		expect(canonicalDoc).toContain(
			'`buildEmailListHealthReadiness` owns reachable subscribed cohort, consent evidence custody, suppression statuses, unsubscribe consent path, bounce/complaint attribution, verified report consensus, List-Unsubscribe header support, mailbox unsubscribe rendering, and sender-domain authentication as separate rows'
		);
		expect(canonicalDoc).toContain(
			'it never invents inbox placement, reputation, legal clearance, pending report counts, or engagement scores'
		);
		expect(canonicalDoc).toContain(
			'Sender-domain rows say the current route uses the Commons platform domain and that custom From/DKIM/DMARC verification is not armed'
		);
		expect(canonicalDoc).toContain(
			'When list health is unread, the shared builder must name the reachable-cohort, consent, suppression, unsubscribe, feedback, and sender-domain claims'
		);
		expect(canonicalDoc).toContain(
			'When Power terrain is unread, the shared builder must name target, bill, and score coverage claims'
		);
			expect(canonicalDoc).toContain(
				'Legislative monitoring posture is a shared Power readiness surface, not a bill-list counter or an AI promise'
			);
			expect(canonicalDoc).toContain(
				'`legislativeMonitoringPressureReadouts` opens this section with **Current watch**, **Held fan-out**, and **Next monitoring lift** cells'
			);
			expect(capabilityScope).toContain(
				'Legislative monitoring now starts with Current watch, Held fan-out, and Next monitoring lift pressure cells from `buildLegislativeMonitoringReadiness`'
			);
			expect(canonicalDoc).toContain(
				'`buildLegislativeMonitoringReadiness` owns federal bill corpus, org watchlist, org relevance screen, position register, state/local corpus, per-supporter alert fan-out, delegated monitoring, and multi-jurisdiction routing as separate rows'
			);
		expect(canonicalDoc).toContain(
			'When legislative monitoring is not armed or unread, the shared builder must name bill-corpus, watchlist, relevance, position, alert, routing, and count claims'
		);
		expect(canonicalDoc).toContain(
			'`buildFundraisingReadiness` owns fundraiser record, public donation page, payment checkout, donor confirmation register, provider send-evidence register, receipt policy register, and tax/anchored receipt rows'
		);
		expect(canonicalDoc).toContain(
			'The layout loads only no-PII aggregate fundraising ground into `OrgSpacesData.operating.fundraising`'
		);
		expect(canonicalDoc).toContain(
			'Baseline donor confirmation is allowed only as transactional outcome evidence, provider message ids prove only send-provider acceptance'
		);
		expect(canonicalDoc).toContain(
			'receipt policy text can render only as operator-authored confirmation context'
		);
		expect(canonicalDoc).toContain(
			'When fundraising is not armed or unread, the shared builder must name the fundraiser-record, public-intake, checkout, confirmation, provider evidence, and receipt claims'
		);
		expect(canonicalDoc).toContain(
			'Coordination readiness is a shared workflow/automation posture, not a generic disabled feature'
		);
		expect(canonicalDoc).toContain(
			'`buildCoordinationReadiness` owns coordination definitions, trigger dispatch contracts, step grammar, side-effect runner, and run-evidence rows'
		);
		expect(canonicalDoc).toContain(
			'The folded workflow index, workflow builder, and saved workflow detail route also derive their local `WorkspaceCapabilityStrip` rows from `buildCoordinationReadiness`'
		);
		expect(canonicalDoc).toContain(
			'aggregate step-type counts for email steps, tag writes/removals, branch conditions, trigger families, and run records'
		);
		expect(canonicalDoc).toContain(
			'Non-email workflow execution is bounded capability'
		);
		expect(canonicalDoc).toContain(
			'When coordination is not armed or unread, the shared builder must name definition, trigger, step, side-effect, and run-evidence claims'
		);
		expect(canonicalDoc).toContain(
			'email-bearing definitions can enable only after SES credentials'
		);
		expect(canonicalDoc).toContain('missing enable-time dependencies');
		expect(canonicalDoc).toContain(
			'The Substrate command set includes **Operating authority** at `#capability-operating-authority`'
		);
		expect(canonicalDoc).toContain(
			'backed by `buildOperatingAuthorityReadiness`, membership role, seat/quota data where loaded, public API flag state, signed-event evidence derived from `orgEvents`/webhook/SSE substrate rather than the API flag'
		);
		expect(canonicalDoc).toContain(
			'When the public API gate is closed, Public API ground says the developer API surface is not armed'
		);
		expect(canonicalDoc).toContain(
			'Org authority also surfaces owner-transfer and org audit-log boundaries through `buildOperatingAuthorityReadiness`'
		);
		expect(canonicalDoc).toContain(
			'Operating authority commands additionally cite the owner succession boundary and org audit-log gate'
		);
		expect(canonicalDoc).toContain(
			'The authority rows are selected from `buildOperatingAuthorityReadiness`, not hand-maintained Mantle prose'
		);
		expect(canonicalDoc).toContain(
			'including owner succession and auditability as explicit authority boundaries'
		);
		expect(canonicalDoc).toContain('`buildPowerTerrainReadiness` is the shared OS readout');
		expect(canonicalDoc).toContain(
			'`powerTerrainPressureReadouts` opens this section with **Loaded terrain**, **Held terrain**, and **Next terrain lift** cells'
		);
		expect(canonicalDoc).toContain(
			'Counts only come from loaded follows, watched bills, and score snapshots'
		);
		expect(canonicalDoc).toContain('`buildResultsProofReadiness` owns packet artifact');
		expect(canonicalDoc).toContain(
			'bounded receipt evidence, receipt anchoring, and reader-office response'
		);
		expect(canonicalDoc).toContain(
			'Loaded receipt rows are source-row evidence; computed packets and receipt rows do not imply Merkle-anchored receipts'
		);
		expect(canonicalDoc).toContain(
			'`safeQueue` may contain only internal `live` or `partial` rows'
		);
		expect(canonicalDoc).toContain(
			'compact held-mode summary, first held verb, first held gate'
		);
			expect(canonicalDoc).toContain(
				'`sendBoundarySummary`, `sendBoundaryGate`, compound-step `sendBoundaryStepGate`, and the first-scan `sendLoop*` contract cannot drift'
			);
		expect(canonicalDoc).toContain(
			'Those surfaces must not concatenate per-channel slogans or task-code prose'
		);
		expect(canonicalDoc).toContain(
			'Execution gates that materially change visible verbs must appear as individual rows sourced to `src/lib/config/features.ts`'
		);
		expect(canonicalDoc).toContain(
			'Vendor names appear only as recognized export profiles or adapter formats; the capability surface stays platform-neutral.'
		);
		expect(canonicalDoc).toContain(
			'Each profile contributes one armed CSV-recognition contract and one dependency-first direct-sync contract'
		);
		expect(canonicalDoc).toContain(
			'The OS map and boundary route now show the same platform intake operating-stage strip before the vendor grid'
		);
		expect(canonicalDoc).toContain(
			'Decorative CSS gradients, orbs, and marketing-panel treatments are not allowed on this layer.'
		);
		expect(canonicalDoc).toContain(
			'Platform-neutral anchors remain `#platform-profile-contract`, `#platform-connection-boundary`, `#platform-sync-boundary`, and `#platform-stored-state`'
		);
		expect(canonicalDoc).not.toContain('anchors at `#an-connection-boundary`');
		expect(canonicalDoc).toContain(
			'The card reading order is capability title, workspace/phase route contract, state, cluster audit mark'
		);
		expect(canonicalDoc).toContain(
			'Loop phases, compound paths, operational shifts, queue rows, gate rows, and send modes follow the same rule'
		);
		expect(canonicalDoc).toContain(
			'source data stores canonical `C-*` ids, while visible prose comes from the canonical nine-label formatter'
		);
		expect(canonicalDoc).toContain(
			'Generic posture ratios use the visible-contract mix, not the narrower nine-card inventory'
		);
		expect(canonicalDoc).toContain(
			'Coordination integrity is armed only when a current packet exists'
		);
		expect(canonicalDoc).toContain(
			'Visible capability states translate the internal enum into operator language'
		);
		expect(canonicalDoc).toContain('layout-fed Spotlight command signals');
		expect(canonicalDoc).toContain('the layout-fed Spotlight command index');
		expect(canonicalDoc).toContain(
			'the layout helper that prepares command actions delegates to `operatorCapabilityActionLabel`'
		);
		expect(canonicalDoc).toContain('`live` renders as **armed**');
		expect(canonicalDoc).toContain('`gated` as **not armed**');
		expect(canonicalDoc).toContain(
			'Any broad state ratio in this layer also uses the visible-contract mix'
		);
		expect(canonicalDoc).toContain(
			'human capability titles down the side, loop phases across the top'
		);
		expect(canonicalDoc).toContain('Spotlight exposes Compound moves at `#capability-composition`');
		expect(canonicalDoc).toContain(
			'Spotlight capability-command gates render through `formatGateEvidence` in operator density'
		);
		expect(canonicalDoc).toContain(
			'Spotlight route actions use route-effect verbs rather than generic drawer verbs'
		);
		expect(canonicalDoc).toContain(
			"Spotlight's visible and accessible search copy names capabilities, workspaces, and handoffs"
		);
		expect(canonicalDoc).toContain(
			'Spotlight mirrors this as first-class handoff/effect fields'
		);
		expect(canonicalDoc).toContain(
			'search indexes destination label, workspace group, operator state, handoff, route effect, signal, gate text, and final action grammar'
		);
		expect(canonicalDoc).toContain(
			'result rows render handoff before effect/signal/gate'
		);
		expect(capabilityScope).toContain(
			'Spotlight command rows carry the same route contract as the capability map and operator queue'
		);
		expect(canonicalDoc).toContain(
			'Action Network is one recognized CSV profile and possible OSDI adapter, not the product frame'
		);
		expect(implementationStatus).toContain('direct platform sync across per-platform direct sync paths');
		expect(implementationStatus).toContain(
			'Platform CSV export profiles (10 recognized profiles: Action Network, EveryAction/NGP VAN, NationBuilder, Mailchimp, Salsa Engage, Mobilize, ActBlue, Engaging Networks, CiviCRM, Salesforce/Nonprofit Cloud)'
		);
		expect(implementationStatus).toContain(
			'Direct platform sync (platform-format sync, incremental)'
		);
		expect(implementationStatus).not.toContain('Action Network OSDI first');
		expect(implementationStatus).not.toContain(
			'| Action Network import (OSDI sync, incremental) | Production |'
		);
		expect(layout).toContain("href: `${base}/canvas`");
		expect(layout).toContain(
			"action: spotlightActionForState(mapCommandState, 'open capability map')"
		);
		expect(layout).toContain(
			"action: spotlightActionForState(nextMovesCommandState, 'read next moves')"
		);
		expect(layout).toContain(
			"action: spotlightActionForState(launchVectorCommandState, 'read launch vector')"
		);
		expect(layout).toContain(
			"action: spotlightActionForState(launchPressureCommandState, 'read launch pressure')"
		);
		expect(layout).toContain(
			"action: spotlightActionForState(compositionCommandState, 'read compound moves')"
		);
		expect(layout).toContain(
			"action: spotlightActionForState(criticalPathCommandState, 'read critical path')"
		);
		expect(layout).toContain(
			"action: spotlightActionForState(sendCommandState, 'read send readiness')"
		);
		expect(layout).toContain(
			"action: spotlightActionForState(loadBearingGate?.state ?? 'live', 'read gate register')"
		);
		expect(layout).toContain("action: 'open action records'");
		expect(layout).toContain("href: `${base}/sms#sms-dispatch-boundary`");
		expect(layout).toContain("'read text boundary'");
		expect(layout).toContain('action: coordinationReadiness.action');
		expect(layout).toContain("action: 'open People ledger'");
		expect(layout).toContain("action: 'open CSV intake'");
		expect(layout).toContain("action: powerTargetTerrainRow?.action ?? 'open Power targets'");
		expect(layout).toContain("action: powerBillsTerrainRow?.action ?? 'open bills terrain'");
		expect(layout).toContain(
			"action: powerScoreTerrainRow?.action ?? 'open accountability scores'"
		);
			expect(layout).toContain('buildPowerTerrainReadiness,');
			expect(layout).toContain('const powerTerrainReadiness = $derived(');
			expect(layout).toContain('const powerWorkspaceSignal = $derived<WorkspaceSignal>');
			expect(layout).toContain('const powerTargetTerrainRow = $derived(');
			expect(layout).toContain('const powerBillsTerrainRow = $derived(');
			expect(layout).toContain('const powerScoreTerrainRow = $derived(');
			expect(layout).toContain('function capabilityMetricSignal(');
			expect(layout).toContain('signal: powerWorkspaceSignal');
			expect(layout).toContain('href: powerTargetTerrainRow?.href ?? `${base}/representatives`');
			expect(layout).toContain('signal: capabilityMetricSignal(');
			expect(layout).toContain('href: powerBillsTerrainRow?.href ?? `${base}/legislation`');
			expect(layout).toContain("signal: capabilityMetricSignal(powerBillsTerrainRow, 'unread bills')");
			expect(layout).toContain('href: powerScoreTerrainRow?.href ?? `${base}/scorecards`');
			expect(layout).toContain(
				"signal: capabilityMetricSignal(powerScoreTerrainRow, 'unread scores')"
			);
			expect(layout).toContain('gate: powerTargetTerrainRow?.boundary ?? powerTerrainReadiness.gate');
			expect(layout).toContain('gate: powerBillsTerrainRow?.boundary ?? powerTerrainReadiness.gate');
			expect(layout).toContain('gate: powerScoreTerrainRow?.boundary ?? powerTerrainReadiness.gate');
			expect(layout).not.toContain('`${data.spaces.landscape.bills.length.toLocaleString');
			expect(layout).not.toContain(
				'`${data.spaces.landscape.scorecardSnapshotCount.toLocaleString'
			);
			expect(layout).not.toContain('function terrainCount(');
			expect(layout).not.toContain('function powerState(');
			expect(layout).not.toContain('function powerSignal(');
			expect(layout).toContain('buildResultsProofReadiness,');
			expect(layout).toContain('const resultsProofReadiness = $derived(');
			expect(layout).toContain('buildResultsProofReadiness({');
			expect(layout).toContain('const resultsWorkspaceSignal = $derived<WorkspaceSignal>');
			expect(layout).toContain('href: resultsProofReadiness.href');
			expect(layout).toContain('state: resultsProofReadiness.state');
			expect(layout).toContain('signal: resultsWorkspaceSignal');
			expect(layout).toContain('resultsProofReadiness.signal');
			expect(layout).toContain('datum: resultsProofReadiness.metric.value');
			expect(layout).toContain('action: resultsProofReadiness.action');
			expect(layout).toContain('gate: resultsProofReadiness.gate');
			expect(layout).not.toContain('function resultsState(');
			expect(layout).not.toContain('function resultsSignal(');
			expect(layout).not.toContain("if (space.packet) return 'live'");
		expect(layout).toContain('action: operatingAuthorityReadiness.action');
		expect(layout).toContain('action: signedWebhookAuthorityRow.action');
		expect(layout).toContain("label: 'Operating authority'");
		expect(layout).toContain('href: `${base}/studio#capability-operating-authority`');
		expect(layout).toContain('action: coalitionReadiness.action');
		for (const genericCommandAction of [
			"action: 'inspect'",
			"action: 'build'",
			"action: 'configure'",
			"action: 'resolve'",
			"'inspect moves'",
			"'inspect pressure'",
			"'inspect coalition'",
			"'inspect proof'",
			"'inspect artifacts'",
			'launch-gated'
		]) {
			expect(layout).not.toContain(genericCommandAction);
		}
	});

	it('keeps first-viewport evidence basis tied to data-honesty marks', () => {
		const component = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const canvas = source('src/lib/components/org/os/CanvasCapabilityMap.svelte');
		const layout = source('src/routes/org/[slug]/+layout.svelte');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const basisReadout = section(component, "id: 'READOUT-BASIS'", "id: 'READOUT-GATE'");
		const taskHypergraphClaim = section(
			component,
			"name: 'Task hypergraph'",
			"name: 'Data honesty audit'"
		);
		const dataHonestyClaim = section(
			component,
			"name: 'Data honesty audit'",
			'const visibleContractStates'
		);
		const honestyRowsSource = section(component, 'const honestyRows', 'const liveHonestyCount');

		expect(component).toContain('const dataHonestyMarkCount = $derived(honestyRows.length)');
		expect(component).toContain(
			'const loadedOrgSlices = $derived([ret, people, power, spaces.operating])'
		);
		expect(component).toContain('const totalOrgSliceCount = $derived(loadedOrgSlices.length)');
		expect(component).toContain(
			'const unloadedSliceCount = $derived(Math.max(0, totalOrgSliceCount - loadedSliceCount))'
		);
		expect(component).toContain(
			'const unresolvedBasisCount = $derived(unloadedSliceCount + unresolvedHonestyCount)'
		);
		expect(component).toContain('const basisGapSummary = $derived(');
		expect(component).toContain('const unresolvedHonestyNames = $derived(');
		expect(component).toContain('const unresolvedHonestyMarks = $derived(');
		expect(component).toContain(
			'function unreadSliceClaimBoundary(sliceName: string, claimName: string): string'
		);
		expect(component).toContain(
			'${sliceName} slice is unread; ${claimName} are not claimed or counted.'
		);
		expect(component).toContain(
			'Unread slices render dormant claim boundaries instead of fabricated counts.'
		);
		expect(component).toContain("label: `${stateLabel('live')} data-honesty marks`");
		expect(component).toContain("label: 'unresolved data-honesty marks'");
		expect(component).toContain("label: 'unloaded slices'");
		expect(component).toContain('state: unresolvedBasisCount === 0 ?');
		expect(component).toContain("unit: 'basis gaps'");
		expect(component).toContain('OrgSpacesData layout load + data-hypergraph audit');
		expect(component).toContain('All org slices and data-honesty marks back current claims');
		expect(component).toContain('unresolved data-honesty mark');
		expect(component).toContain('gate: basisGapSummary');
		expect(canvas).toContain('type DataHonestyEvidence,');
		expect(canvas).toContain("getDataHonestyEvidence('V-5', 'FIX-V5'");
		expect(canvas).toContain("getDataHonestyEvidence('V-3', 'FIX-V3'");
		expect(canvas).toContain("getDataHonestyEvidence('V-4', 'FIX-V4'");
		expect(canvas).toContain("getDataHonestyEvidence('V-2', 'FIX-V2'");
		expect(canvas).toContain('const dataHonestyMarkCount = dataHonestyRows.length');
		expect(canvas).toContain('const unresolvedHonestyRows = $derived');
		expect(canvas).toContain(
			'const unresolvedBasisCount = $derived(unloadedSliceCount + unresolvedHonestyCount)'
		);
		expect(canvas).toContain("unresolvedBasisCount === 0 ? 'live' : 'partial'");
		expect(canvas).toContain('const basisGapSummary = $derived(');
		expect(canvas).toContain('const basisReadoutDetail = $derived(');
		expect(canvas).toContain('value: unresolvedBasisCount');
		expect(canvas).toContain("unit: 'basis gaps'");
		expect(canvas).toContain('detail: basisReadoutDetail');
		expect(canvas).toContain('gate: basisGapSummary');
		expect(canvas).toContain(
			'People slice is unread; consent-bound reach, source custody, and verification-weight claims are not claimed or counted.'
		);
		expect(canvas).not.toContain('People slice unavailable');
		expect(canvas).not.toContain('value: loadedSliceCount,\n\t\t\tunit: `of ${totalOrgSliceCount} slices`');
		expect(basisReadout).toContain(
			"${loadedSliceCount}/${totalOrgSliceCount} org slices loaded; ${liveHonestyCount}/${dataHonestyMarkCount} ${stateLabel('live')} data-honesty marks."
		);
		expect(basisReadout).not.toContain("state: loadedSliceCount === 3 ? 'live' : 'partial'");
		expect(basisReadout).not.toContain('${loadedSliceCount}/3 org slices loaded');
		expect(basisReadout).not.toContain("unit: 'loaded slices'");
		expect(component).toContain('const loadBearingGateSummary = $derived(');
		expect(component).toContain('gateRegisterSummary.loadBearingGateSummary');
		expect(hypergraph).toContain('The highest fan-out unresolved gate remains load-bearing.');
		expect(taskHypergraphClaim).toContain('gate: loadBearingGateSummary');
		expect(taskHypergraphClaim).not.toContain('gate: loadBearingGate?.gate.tasks');
		expect(taskHypergraphClaim).not.toContain('NEW-T6-2 mainnet');
		expect(taskHypergraphClaim).not.toContain('NEW-T5-3 TEE');
		expect(taskHypergraphClaim).not.toContain('NEW-T4-1/NEW-T4-2 delegation');
		expect(taskHypergraphClaim).not.toContain('NEW-T8 reader-side work');
		expect(dataHonestyClaim).toContain('...honestyRows.map((row) => ({');
		expect(dataHonestyClaim).toContain('name: `Audit mark / ${row.name}`');
		expect(dataHonestyClaim).toContain('proof: row.evidence');
		expect(dataHonestyClaim).toContain('mark: row.mark');
		expect(dataHonestyClaim).toContain(
			'Read the individual audit rows before strengthening bounded claims: ${unresolvedHonestyMarks}.'
		);
		expect(component).toContain('function dataHonestyBoundaryGate(row: HonestyRow): string');
		expect(component).toContain(
			'keeps ${row.name} ${stateLabel(\'partial\')}; treat the related claim as bounded evidence until the audit mark clears.'
		);
		expect(component).not.toContain('qualified or unavailable');
		expect(honestyRowsSource).toContain("name: 'Public verifier hash'");
		expect(honestyRowsSource).toContain("name: 'Debate packet fields'");
		expect(honestyRowsSource).toContain("name: 'Coalition accent gate'");
		expect(honestyRowsSource).toContain("name: 'Atlas drift signal'");
		expect(dataHonestyClaim).not.toContain(
			'Verifier, debate, and coalition accent fixes are complete; atlas drift remains explicitly unavailable.'
		);
		for (const staleDormantCopy of [
			'People summary unavailable; the map will not invent counts.',
			'Results proof is unavailable in the current layout slice.',
			'People slice unavailable; no reach count is invented.',
			'People slice unavailable',
			'Power terrain unavailable; the map keeps the shift partial.',
			'If a slice is unavailable, the map renders dormant copy instead of inventing counts.'
		]) {
			expect(component).not.toContain(staleDormantCopy);
		}

		expect(layout).toContain('const unresolvedHonestyCount = $derived');
		expect(layout).toContain('const liveHonestyCount = $derived');
		expect(layout).toContain('const dataHonestyMarkCount = dataHonestyRows.length');
		expect(layout).toContain('const totalOrgSliceCount = $derived(loadedOrgSlices.length)');
		expect(layout).toContain(
			'const unloadedSliceCount = $derived(Math.max(0, totalOrgSliceCount - loadedSliceCount))'
		);
		expect(layout).toContain(
			'const unresolvedBasisCount = $derived(unloadedSliceCount + unresolvedHonestyCount)'
		);
		expect(layout).toContain("unresolvedBasisCount === 0 ? 'live' : 'partial'");
		expect(layout).toContain('const basisCommandSignal = $derived');
		expect(layout).toContain(
			'${loadedSliceCount}/${totalOrgSliceCount} slices · ${liveHonestyCount}/${dataHonestyMarkCount} ${commandStateLabel(\'live\')} data-honesty marks · ${unresolvedBasisCount} basis gap'
		);
		expect(layout).not.toContain('data-honesty marks live');
		expect(layout).toContain('const basisCommandGate = $derived');
		expect(layout).toContain('state: basisCommandState');
		expect(layout).toContain('signal: basisCommandSignal');
		expect(layout).toContain(
			"action: spotlightActionForState(basisCommandState, 'read claim basis')"
		);
		expect(layout).toContain('gate: basisCommandGate');
		expect(layout).not.toContain("action: spotlightActionForState(basisCommandState, 'audit')");
		expect(layout).not.toContain(
			'loadedSliceCount === 3 && unresolvedHonestyCount === 0 && unresolvedGateCount === 0'
		);
		expect(layout).not.toContain('${loadedSliceCount}/3 slices');
		expect(layout).not.toContain('FIX-V2 gates atlas drift');

		expect(canonicalDoc).toContain(
			'The Evidence basis dial counts unresolved basis gaps from unloaded org slices plus data-honesty marks'
		);
		expect(canonicalDoc).toContain(
			'The full-map canvas uses the same basis-gap rule in its first-viewport Evidence basis card'
		);
		expect(canonicalDoc).toContain(
			'every visible operating action must render through `operatorCapabilityActionLabel`'
		);
		expect(canonicalDoc).toContain(
			'the bottom command rail mirrors the same workspace state, state-aware read/scan action'
		);
		expect(canonicalDoc).toContain(
			'workspace controls carry the same state, `operatorCapabilityActionLabel` action'
		);
		expect(canonicalDoc).toContain(
			'The denominator is four layout slices — People, Power, Results, and Substrate'
		);
		expect(canonicalDoc).toContain(
			'The Spotlight **Claim basis** command mirrors the Evidence basis dial exactly'
		);
		expect(canonicalDoc).toContain('armed data-honesty mark count');
		expect(canonicalDoc).toContain('It must not fold in the gate-register backlog');
		expect(canonicalDoc).toContain('one visible row per data-honesty audit mark');
		expect(canonicalDoc).toContain('The Claim basis ledger must render each mark individually');
	});

	it('threads atlas evidence through public and embed district-evidence paths without overclaiming postal-only drift', () => {
		const verifyDistrictRoute = source('src/routes/api/c/[slug]/verify-district/+server.ts');
		const publicCampaign = source('src/routes/c/[slug]/+page.svelte');
		const embedCampaign = source('src/routes/embed/campaign/[slug]/+page.svelte');
		const embedCampaignServer = source('src/routes/embed/campaign/[slug]/+page.server.ts');
		const component = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const dataIndex = source('docs/strategy/data-hypergraph/docs/INDEX.md');
		const dataTasks = source('docs/strategy/data-hypergraph/nodes/tasks.json');
		const scopeDoc = source('docs/design/ORG-CAPABILITY-SCOPE.md');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const transcendenceDoc = source('docs/strategy/capability-transcendence.md');

		expect(verifyDistrictRoute).toContain(
			"import { getCurrentAtlasVersion } from '$lib/core/shadow-atlas/district-bundle';"
		);
		expect(verifyDistrictRoute).toContain(
			'const districtCode = result.officials?.district_code ?? result.district?.id ?? null;'
		);
		expect(verifyDistrictRoute).toContain(
			'const atlasVersion = await getCurrentAtlasVersion().catch(() => null);'
		);
		expect(verifyDistrictRoute).toContain('h3Cell: result.cell_id ?? null');
		expect(verifyDistrictRoute).toContain('atlasVersion');

		expect(publicCampaign).toContain("let h3Cell = $state('');");
		expect(publicCampaign).toContain("let atlasVersion = $state('');");
		expect(publicCampaign).toContain("h3Cell = '';");
		expect(publicCampaign).toContain("atlasVersion = '';");
		expect(publicCampaign).toContain("h3Cell = result.h3Cell ?? '';");
		expect(publicCampaign).toContain("atlasVersion = result.atlasVersion ?? '';");
		expect(publicCampaign).toContain('<input type="hidden" name="h3Cell" value={h3Cell} />');
		expect(publicCampaign).toContain(
			'<input type="hidden" name="atlasVersion" value={atlasVersion} />'
		);

		expect(embedCampaign).toContain("import { FEATURES } from '$lib/config/features';");
		expect(embedCampaign).toContain("let h3Cell = $state('');");
		expect(embedCampaign).toContain("let atlasVersion = $state('');");
		expect(embedCampaign).toContain('async function verifyDistrictEvidence()');
		expect(embedCampaign).toContain('districtCode = result.district.code;');
		expect(embedCampaign).toContain("h3Cell = result.h3Cell ?? '';");
		expect(embedCampaign).toContain("atlasVersion = result.atlasVersion ?? '';");
		expect(embedCampaign).toContain('Add district evidence');
		expect(embedCampaign).toContain('Attach district evidence');
		expect(embedCampaign).toContain('<input type="hidden" name="districtCode" value={districtCode} />');
		expect(embedCampaign).toContain('<input type="hidden" name="h3Cell" value={h3Cell} />');
		expect(embedCampaign).toContain(
			'<input type="hidden" name="atlasVersion" value={atlasVersion} />'
		);
		expect(embedCampaignServer).toContain("import { FEATURES } from '$lib/config/features';");
		expect(embedCampaignServer).toContain("formData.get('districtCode')");
		expect(embedCampaignServer).toContain("FEATURES.ADDRESS_SPECIFICITY === 'district'");
		expect(embedCampaignServer).toContain('districtCode:');
		expect(component).toContain(
			'FIX-V2 threads atlasVersion and H3 cell evidence through the public campaign and embed district-evidence forms'
		);
		expect(component).toContain(
			'packet drift is claimed only when action rows carry that atlas signal'
		);
		expect(dataIndex).toContain('2026-06-03 partial V-2 wiring');
		expect(dataIndex).toContain('2026-06-05 FIX-V2 embed bridge');
		expect(dataIndex).toContain('postal-only or skipped district-evidence submissions still carry no atlas signal');
		expect(dataTasks).toContain('"id": "FIX-V2"');
		expect(dataTasks).toContain('"status": "completed"');
		expect(dataTasks).toContain('embed district-evidence drawer');
		expect(scopeDoc).toContain('optional district-evidence drawer');
		expect(scopeDoc).toContain('postal-only or skipped district-evidence submissions still carry no atlas signal');
		expect(scopeDoc).toContain('Embed is anonymous');
		expect(canonicalDoc).toContain('the embed district-evidence drawer');
		expect(canonicalDoc).toContain('packet atlas drift still reads as row-evidence');
		expect(transcendenceDoc).toContain('Packet driftCount is available when action rows carry atlas evidence');
		expect(transcendenceDoc).toContain('postal-only/skipped district-evidence actions remain outside that broad claim');
	});

	it('surfaces event artifacts as bounded operating capability in the Studio map', () => {
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const scopeDoc = source('docs/design/ORG-CAPABILITY-SCOPE.md');
		const component = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const layout = source('src/routes/org/[slug]/+layout.svelte');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');

		expect(component).toContain("id: 'SHIFT-EVENTS'");
		expect(component).toContain('Events become bounded evidence');
		expect(component).toContain('state: eventArtifactMode?.state ??');
		expect(component).toContain('href: eventArtifactMode?.route ?? `${base}/events#event-export-boundary`');
		expect(component).toContain("action: eventArtifactMode?.action ?? 'read event boundary'");
		expect(component).toContain('eventArtifactMode?.effect ??');
		expect(component).toContain('gate: eventArtifactMode?.unlock ?? gateSummary(eventArtifactGate)');
		expect(component).toContain(
			'Event artifact claims stay dependency-first until the event-record gate opens; no RSVP or artifact path is claimed.'
		);
		expect(component).toContain(
			'Debate setup stays dependency-first until the quality-settlement gate opens.'
		);
		expect(component).toContain('state: abAutomationMode?.state ?? abAutomationState');
		expect(component).toContain(
			"abAutomationMode?.effect ?? 'A/B continuation mode is unread from buildSendReadiness.'"
		);
		expect(component).toContain('currentGround: coalitionReadiness.effect');
		expect(component).not.toContain('unavailable in this build');
		expect(hypergraph).toContain("label: 'Event records and artifacts'");
		expect(hypergraph).toContain("cluster: 'C-data-sovereignty'");
		expect(hypergraph).toContain('per-event ICS plus non-PII attendance CSV artifacts after save');
		expect(hypergraph).toContain(
			'Event records and artifacts stay dependency-first until the event artifact gate opens.'
		);
		expect(hypergraph).not.toContain('unavailable in this build');
		expect(component).toContain("label: 'Export event artifacts'");
		expect(component).toContain("handoff: eventArtifactMode?.handoff ?? 'Event records'");
		expect(component).toContain("cluster: eventArtifactMode?.cluster ?? 'C-data-sovereignty'");
		expect(component).not.toContain(
			'Event detail routes provide ICS and non-PII attendance CSV downloads'
		);
		expect(component).not.toContain(
			'Event artifacts are not armed; the boundary route provides context, not artifact export.'
		);
		expect(component).not.toContain('Event records are disabled; the route is unavailable.');
		expect(component).not.toContain(
			'QR rendering, decrypted attendee export, waitlist auto-promotion, and provider calendar sync'
		);
		expect(component).toContain('`${base}/events#event-export-boundary`');
		expect(component).not.toContain("state: FEATURES.EVENTS ? 'partial' : 'gated'");
		expect(component).not.toContain(
			"action: FEATURES.EVENTS ? 'open event artifacts' : 'read event boundary'"
		);

		expect(layout).toContain('const eventArtifactMode = $derived(');
		expect(layout).toContain("sendReadiness.modes.find((mode) => mode.key === 'events')");
		expect(layout).toContain('href: eventArtifactMode?.route ?? `${base}/events#event-export-boundary`');
		expect(layout).toContain("label: 'Event records'");
		expect(layout).toContain("sublabel: 'RSVP + artifacts'");
		expect(layout).toContain("signal: FEATURES.EVENTS ? 'ICS + non-PII CSV' : 'artifact gate held'");
		expect(layout).toContain("action: eventArtifactMode?.action ?? 'read event boundary'");
		expect(layout).toContain('gate:');
		expect(layout).toContain('eventArtifactMode?.unlock ??');
		expect(layout).toContain(
			'Event records and artifacts stay dependency-first until the event artifact gate opens.'
		);
		expect(layout).not.toContain('events disabled');
		expect(layout).not.toContain('Event records are disabled; the route is unavailable.');
		expect(canonicalDoc).toContain(
			'The event folded route mirrors the `buildSendReadiness` event mode rather than owning feature-flag copy'
		);
		expect(canonicalDoc).toContain(
			'The event-artifact queue move consumes `eventArtifactMode` from `buildSendReadiness`'
		);
		expect(canonicalDoc).toContain(
			'server email, client merge, A/B continuation, SMS dispatch, Workflow side effects, CWC congressional delivery, and Event artifacts use their matching `buildSendReadiness.modes` rows'
		);
		expect(canonicalDoc).toContain('Coalition proof uses `coalitionReadiness`');
		expect(canonicalDoc).toContain('Delegated civic action uses `delegatedCivicActionState`');
		expect(scopeDoc).toContain(
			'Event-artifact shift, runtime claim-basis, and queue rows consume that same event send-mode contract (`eventArtifactMode`)'
		);
		expect(scopeDoc).toContain(
			'Runtime claim-basis rows for server email, client merge, A/B continuation, SMS dispatch, workflow, and CWC congressional delivery consume their matching `buildSendReadiness.modes` entries'
		);
		expect(scopeDoc).toContain(
			'Coalition runtime claim-basis consumes `coalitionReadiness`'
		);
		expect(scopeDoc).toContain(
			'delegated-action runtime claim-basis consumes `delegatedCivicActionState`'
		);
		expect(scopeDoc).toContain(
			'`NETWORKS` and `DELEGATION` flags stay audit marks rather than visible state shortcuts'
		);
		expect(canonicalDoc).toContain('artifact gate held');
		expect(layout).not.toContain("label: 'Event forms'");
	});

	it('keeps Studio live states tied to emitted authoring outputs', () => {
		const studio = source('src/lib/components/org/os/StudioSpace.svelte');
		const studioSend = source('src/lib/components/org/studio/StudioSend.svelte');
		const studioSources = source('src/lib/components/org/studio/StudioSources.svelte');
		const studioReasoning = source('src/lib/components/org/studio/StudioReasoning.svelte');
		const authoringProcess = source('src/lib/core/authoring-process.ts');
		const messageJobRecovery = source('src/lib/core/agents/message-job-recovery.ts');
		const messageGenerationResolver = source(
			'src/lib/components/template/creator/MessageGenerationResolver.svelte'
		);
		const slugCustomizer = source('src/lib/components/template/creator/SlugCustomizer.svelte');
		const templateSuccessModal = source('src/lib/components/modals/TemplateSuccessModal.svelte');
		const templateModal = source('src/lib/components/template/TemplateModal.svelte');
		const templateApiRoute = source('src/routes/api/templates/+server.ts');
		const shareMessages = source('src/lib/utils/share-messages.ts');
		const publicActionPage = source('src/routes/s/[slug]/+page.svelte');
		const publicActionOgImage = source('src/routes/s/[slug]/og-image/+server.ts');
		const onboardingContent = source('src/lib/components/auth/parts/OnboardingContent.svelte');
		const creationSpark = source('src/lib/components/activation/CreationSpark.svelte');
		const coordinationExplainer = source(
			'src/lib/components/activation/CoordinationExplainer.svelte'
		);
		const templateTypes = source('src/lib/types/template.ts');
		const templateDraftStore = source('src/lib/stores/templateDraft.ts');
		const templateCreator = source('src/lib/components/template/TemplateCreator.svelte');
		const messageResults = source('src/lib/components/template/creator/MessageResults.svelte');
		const messageWriter = source('src/lib/core/agents/agents/message-writer.ts');
		const messageWriterPrompt = source('src/lib/core/agents/prompts/message-writer.ts');
		const sourceDiscovery = source('src/lib/core/agents/agents/source-discovery.ts');
		const streamMessage = source('src/routes/api/agents/stream-message/+server.ts');
		const traceReplayRoute = source('src/routes/api/agents/traces/[traceId]/+server.ts');
		const capabilityMap = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const layoutServer = source('src/routes/org/[slug]/+layout.server.ts');
		const layout = source('src/routes/org/[slug]/+layout.svelte');
		const spacesContract = source('src/lib/components/org/os/spaces.ts');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const messageGenerationEvidenceSource = section(
			hypergraph,
			'export function buildMessageGenerationEvidence',
			'export function buildPlatformIntakeReadiness'
		);
		const messageGenerationReadiness = source(
			'src/lib/server/agents/message-generation-readiness.ts'
		);
		const studioDraftBridge = source('src/lib/components/org/studio/studio-draft-bridge.ts');
		const orgEmailDraftStore = source('src/lib/stores/orgEmailComposeDraft.ts');
		const orgEmailComposer = source('src/routes/org/[slug]/emails/compose/+page.svelte');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

			expect(studio).toContain('buildSendReadiness,');
			expect(studio).toContain('formatGateEvidence,');
			expect(studio).toContain('getGateEvidence');
		expect(studioSend).toContain(
			'Operating delivery ground is unread; Studio counts no send side effect from this view.'
		);
		expect(studioSend).not.toContain('Operating delivery readiness is unavailable');
		expect(spacesContract).toContain('authoring: AuthoringRuntimeGroundData;');
		expect(spacesContract).toContain('export type AuthoringRuntimeGroundData = {');
		expect(spacesContract).toContain('runtimeReady: boolean;');
		expect(spacesContract).toContain('modelProviderConfigured: boolean;');
		expect(spacesContract).toContain('sourceSearchConfigured: boolean;');
		expect(spacesContract).toContain('sourceFetchConfigured: boolean;');
		expect(spacesContract).toContain('runtimeMissing: string[];');
		expect(messageGenerationReadiness).toContain(
			"export const MESSAGE_GENERATION_DEPENDENCY ="
		);
		expect(messageGenerationReadiness).toContain(
			"'model provider, source discovery, and page-read evaluation'"
		);
		expect(messageGenerationReadiness).toContain("missing.push('GEMINI_API_KEY')");
		expect(messageGenerationReadiness).toContain("missing.push('EXA_API_KEY')");
		expect(messageGenerationReadiness).toContain("missing.push('FIRECRAWL_API_KEY')");
		expect(messageGenerationReadiness).toContain('Grounded authoring is dependency-bound');
		expect(messageGenerationReadiness).toContain('formatMessageGenerationMissing');
		expect(messageGenerationReadiness).not.toContain(
			"'GEMINI_API_KEY + EXA_API_KEY + FIRECRAWL_API_KEY'"
		);
		expect(messageGenerationReadiness).not.toContain(
			['Message', 'generation', 'is dependency-bound'].join(' ')
		);
		expect(layoutServer).toContain(
			"import { getMessageGenerationReadiness } from '$lib/server/agents/message-generation-readiness';"
		);
		expect(layoutServer).toContain('function messageGenerationEnv()');
		expect(layoutServer).toContain('GEMINI_API_KEY: privateEnv.GEMINI_API_KEY');
		expect(layoutServer).toContain('EXA_API_KEY: privateEnv.EXA_API_KEY');
		expect(layoutServer).toContain('FIRECRAWL_API_KEY: privateEnv.FIRECRAWL_API_KEY');
		expect(layoutServer).toContain('const authoringGround: AuthoringRuntimeGroundData = {');
		expect(layoutServer).toContain(
			'modelProviderConfigured: messageGenerationReadiness.modelProviderConfigured'
		);
		expect(layoutServer).toContain(
			'sourceSearchConfigured: messageGenerationReadiness.sourceSearchConfigured'
		);
		expect(layoutServer).toContain(
			'sourceFetchConfigured: messageGenerationReadiness.sourceFetchConfigured'
		);
		expect(layoutServer).toContain('authoring: authoringGround,');
		expect(streamMessage).toContain(
			"import { getMessageGenerationReadiness } from '$lib/server/agents/message-generation-readiness';"
		);
		expect(streamMessage).toContain('const runtimeReadiness = getMessageGenerationReadiness({');
		expect(streamMessage).toContain("code: 'message_generation_runtime_not_configured'");
		expect(streamMessage).toContain('missing: runtimeReadiness.missing');
		expect(streamMessage).toContain('dependency: runtimeReadiness.dependency');
		expect(studio).toContain("const delegatedAgentGate = getGateEvidence('CP-delegation-executor'");
		expect(studio).toContain('formatGateEvidence(delegatedAgentGate');
		expect(studio).toContain('type StudioHeaderMetric');
		expect(studio).toContain(
			'const studioHeaderMetrics = $derived<StudioHeaderMetric[]>(['
		);
		expect(studio).toContain("label: 'running loops'");
		expect(studio).toContain("cite: 'orgOS runningProcesses'");
		expect(studio).toContain("label: 'process records'");
		expect(studio).toContain("cite: 'orgOS process registry'");
		expect(studio).toContain('value: proc ? decisionMakers.length : null');
		expect(studio).toContain("label: 'contactable targets'");
		expect(studio).toContain("cite: 'stream-decision-makers complete event'");
		expect(studio).toContain('value: sourceEvidenceKnown ? evaluatedSourceCount : null');
		expect(studio).toContain("label: 'evaluated sources'");
		expect(studio).toContain('cite: sourceEvidenceCite');
		expect(studio).toContain('value: composedMessage ? messageParagraphs.length : null');
		expect(studio).toContain("label: 'emitted paragraphs'");
		expect(studio).toContain("cite: 'orgOS focusedProcess.composedMessage'");
		expect(studio).toContain('aria-label="Studio authoring evidence counts"');
		expect(studio).toContain('{#each studioHeaderMetrics as metric (metric.label)}');
		expect(studio).toContain('class="studio-proof-count"');
		expect(studio).toContain('<Datum value={metric.value} cite={metric.cite} />');
		expect(studio).toContain('Public action draft →');
		expect(studio).not.toContain('Citizen compose →');
		expect(studio).toContain('const jurisdictionScopeGate = getGateEvidence(');
		expect(studio).toContain("'CP-studio-jurisdiction-scope'");
		expect(studio).toContain("['T3-1', 'T3-2', 'T3-3', 'T3-4', 'T3-5']");
		expect(studio).toContain("const messageProofGate = getGateEvidence('CP-message-proof-binding'");
		expect(studio).toContain("['T4-2', 'T4-7']");
		expect(studio).toContain(
			"const delegatedTraceGate = getGateEvidence('CP-agent-trace-observability'"
		);
		expect(studio).toContain("['T4-8']");
		expect(studio).toContain('formatGateEvidence(jurisdictionScopeGate');
		expect(studio).toContain('formatGateEvidence(messageProofGate');
		expect(studio).toContain('delegatedTraceGate,');
		expect(studio).not.toContain('CP-4: T4-2 proof attachment');
		expect(studio).toContain('type StudioContractRow');
		expect(studio).toContain('handoff: string');
		expect(studio).toContain('<span class="intent-contract-handoff">{row.handoff}</span>');
		expect(studio).toContain("handoff: 'Studio intent'");
		expect(studio).toContain("handoff: 'Power target'");
		expect(studio).toContain("handoff: 'Source + message stream'");
		expect(studio).toContain('type StudioRunLedgerRow');
		expect(studio).toContain('const studioRunLedger = $derived<StudioRunLedgerRow[]>');
		expect(studio).toContain('type StudioExecutionStep');
		expect(studio).toContain('const studioExecutionSpine = $derived<StudioExecutionStep[]>');
		expect(studio).toContain('aria-label="Studio execution spine"');
		expect(studio).toContain("phase: 'INTENT'");
		expect(studio).toContain("phase: 'RESOLVE'");
		expect(studio).toContain("phase: 'GROUND'");
		expect(studio).toContain("phase: 'AUTHOR'");
		expect(studio).toContain("phase: 'HANDOFF'");
		expect(studio).toContain(
			"state: sendReady && canPublish ? 'draft-only' : sendReady ? 'partial' : 'gated'"
		);
		expect(studio).toContain("label: 'Draft handoffs'");
		expect(studio).not.toContain("label: 'Armed handoffs'");
		expect(studio).not.toContain("label: 'armed handoffs'");
		expect(studio).toContain("cite: 'stream-decision-makers complete event'");
		expect(studio).toContain(
			"sourceEvidenceObserved ? 'stream-message source-evidence' : 'stream-message evaluatedSources'"
		);
		expect(studio).toContain("cite: 'orgOS focusedProcess.composedMessage'");
		expect(studio).toContain('Authoring waits for a target.');
		expect(studio).toContain('No authored output can be claimed.');
		expect(studio).toContain('Delivery-surface draft handoffs are available.');
		expect(studio).toContain('Org authority gates delivery-surface draft handoff.');
		expect(studio).toContain(
			'Delivery-surface draft handoff appears only after an authored artifact exists.'
		);
		expect(studio).not.toContain('Destination-owned draft handoffs are available.');
		expect(studio).not.toContain('Org authority gates destination draft handoff.');
		expect(studio).not.toContain(
			'Destination-owned draft handoff appears only after an authored artifact exists.'
		);
		expect(studio).not.toContain('Publish authority gates handoff.');
		expect(studio).not.toContain('No handoff before authored output.');
		expect(studio).toContain('aria-label="Studio run ledger"');
		expect(studio).toContain("label: 'Process memory'");
		expect(studio).toContain("label: 'Source ground'");
		expect(studio).toContain("value: sourceEvidenceKnown ? evaluatedSourceCount : 'pending'");
		expect(studio).toContain("label: 'search-only'");
		expect(studio).toContain('<span class="run-ledger-secondary">');
		expect(studio).toContain('sourceBasisSignal');
		expect(studio).toContain('device-local orgOS process storage');
		expect(studio).toContain('process.restoredFromDevice');
		expect(studio).toContain('live streams are detached after refresh');
		expect(studio).toContain("label: 'Recovery job'");
		expect(studio).toContain('buildMessageGenerationEvidence,');
		expect(studio).toContain('messageGenerationSpineRows,');
		expect(studio).toContain('type MessageGenerationEvidenceRow');
		expect(studio).toContain('type MessageGenerationEvidencePhase');
		expect(studio).toContain('const authoredOutputEvidence = $derived(');
		expect(studio).toContain('buildMessageGenerationEvidence({');
		expect(studio).toContain(
			'const authoredOutputRows = $derived<MessageGenerationEvidenceRow[]>(authoredOutputEvidence.rows)'
		);
		expect(studio).toContain(
			'const authoredOutputPressureCells = $derived(messageGenerationSpineRows(authoredOutputRows));'
		);
		expect(studio).toContain(
			'<span class="output-contract-handoff"'
		);
		expect(studio).toContain('{row.phase} / {formatCapabilityClusters(row.clusters)}');
		expect(studio).toContain('const authoredOutputSegments = $derived');
		expect(studio).toContain('operatorCapabilityStateRatioSegments');
		expect(studio).toContain(
			'const studioSegments = $derived(operatorCapabilityStateRatioSegments(studioStateCounts));'
		);
		expect(studio).toContain('operatorCapabilityStateRatioSegments(authoredOutputStateCounts)');
		expect(studio).toContain('return operatorCapabilityStateLabel(state);');
		expect(studio).not.toContain("return 'Live'");
		expect(studio).not.toContain("return 'Partial'");
		expect(studio).not.toContain("return 'Gated'");
		expect(studio).not.toContain("label: operatorCapabilityStateLabel('live')");
		expect(studio).not.toContain("label: operatorCapabilityStateLabel('partial')");
		expect(studio).not.toContain("label: operatorCapabilityStateLabel('draft-only')");
		expect(studio).not.toContain("label: operatorCapabilityStateLabel('gated')");
		expect(studio).not.toContain("label: 'live'");
		expect(studio).not.toContain("label: 'partial'");
		expect(studio).not.toContain("label: 'gated'");
		expect(studio).toContain('aria-label="Authored output contract"');
		expect(studio).toContain('aria-label="Authored artifact posture"');
		expect(studio).toContain('<span class="output-pressure-ground">{cell.ground}</span>');
		expect(studio).toContain('<span class="output-pressure-next">{cell.effect}</span>');
		expect(studio).toContain('<Datum value={row.metric.value} cite={row.metric.cite} />');
		expect(studio).toContain('procIntentFieldCount');
		expect(studio).toContain('messageResearchStepCount');
		expect(studio).toContain('messageGenerationPhase');
		expect(studio).toContain('targetCount: decisionMakers.length');
		expect(studio).toContain('phase: messageGenerationPhase');
		expect(studio).toContain('paragraphCount: messageParagraphs.length');
		expect(studio).toContain('sourceCount: sourceEvidenceObserved ? attachedSourceCount : sources.length');
		expect(studio).toContain('evaluatedSourceCount,');
		expect(studio).toContain('searchOnlySourceCount,');
		expect(studio).toContain('traceHandle: activeTraceLabel ===');
		expect(messageGenerationEvidenceSource).toContain("label: 'Target basis'");
		expect(messageGenerationEvidenceSource).toContain("label: 'Artifact basis'");
		expect(messageGenerationEvidenceSource).toContain("label: 'Source basis'");
		expect(messageGenerationEvidenceSource).toContain("label: 'Proof binding'");
		expect(studio).not.toContain("label: 'Artifact ground'");
		expect(studio).not.toContain("label: 'Audience basis'");
		expect(studio).not.toContain("label: 'Grounding basis'");
		expect(studio).not.toContain("label: 'Scope basis'");
		expect(studio).not.toContain('type StudioOutputPressureCell');
		expect(studio).not.toContain('const authoredOutputPressureCells = $derived<StudioOutputPressureCell[]>');
		expect(studio).not.toContain('secondaryMetric?:');
		expect(studio).not.toContain('secondaryMetric: {');
		expect(studio).not.toContain('<span class="output-contract-metric-divider">/</span>');
		expect(studio).not.toContain('Search-only fallback sources sit beside this output');
		expect(studio).not.toContain(
			'Treat search-only fallback as grounding context, not evaluated source evidence.'
		);
		expect(studio).not.toContain('Verified source URLs');
		expect(studio).toContain('orgOS focusedProcess.composedMessage');
		expect(studio).toContain('stream-message evaluatedSources');
		expect(studio).not.toContain(
			'The artifact below is emitted by the focused OS process, not placeholder copy.'
		);
		expect(studio).not.toContain(
			'The authored message is recoverable on this device, but it is not yet a proof-bound delegated action.'
		);
		expect(studio).not.toContain(
			'Bind drafted messages to proof before stronger authored-action claims.'
		);
		expect(studio).toContain('function outputActionLabel(row: MessageGenerationEvidenceRow): string');
		expect(studio).toContain('activeMessageJob.status');
		expect(studio).toContain('activeMessageJob.jobId.slice(0, 8)');
		expect(studio).toContain('const activeTraceId = $derived(activeMessageJob?.traceId ?? null)');
		expect(studio).toContain("type TraceReplayEvent = {");
		expect(studio).toContain(
			"let traceReplayStatus = $state<'idle' | 'loading' | 'loaded' | 'error'>('idle')"
		);
		expect(studio).toContain(
			'fetch(`/api/agents/traces/${encodeURIComponent(activeTraceId)}`'
		);
		expect(studio).toContain('aria-label="Authoring trace replay"');
		expect(studio).toContain('Redacted event replay');
		expect(studio).toContain('Trace replay is redacted for browser display');
		expect(studio).toContain('raw prompts and model responses stay');
		expect(studio).toContain('internal-secret protected');
		expect(studio).toContain('agentTraces listByTrace');
		expect(studio).toContain('function loadTraceReplay()');
		expect(studio).toContain("traceReplayStatus === 'loading'");
		expect(studio).toContain('actionForState(traceReplayState, traceReplayAction)');
		expect(studio).toContain("label: 'Trace replay'");
		expect(studio).toContain("label: 'Trace replay boundary'");
		expect(hypergraph).toContain('stream-message traceId + agentTraces');
		expect(studio).toContain('AGENT_TRACE_ENABLED, sampling, TTL, and INTERNAL_API_SECRET');
		expect(studio).toContain('Delegated-agent trace observability remains gated.');
		expect(studio).toContain(
			"cite: activeMessageJob ? 'activeMessageJob job_id/input_hash' : 'no active message job'"
		);
		expect(studio).toContain("const processFailed = $derived(proc?.status === 'error')");
		expect(studio).toContain("const processStopped = $derived(proc?.status === 'stopped')");
		expect(studio).toContain(
			'const resolutionStopReason = $derived(proc?.resolutionStopReason ?? null)'
		);
		expect(studio).toContain(
			'const resolutionStopDetail = $derived(proc?.resolutionStopDetail ?? null)'
		);
		expect(studio).toContain('const processClosedWithoutOutput = $derived(');
		expect(studio).toContain('(processFailed || processStopped) && !composedMessage');
		expect(studio).toContain(
			'const resolutionBlocked = $derived(processClosedWithoutOutput && decisionMakers.length === 0)'
		);
		expect(studio).toContain(
			'const groundingBlocked = $derived(processClosedWithoutOutput && sources.length === 0)'
		);
		expect(studio).toContain(
			'const sourceEvidenceObserved = $derived(proc?.sourceEvidenceObserved ?? false)'
		);
		expect(studio).toContain('const completedSearchOnlySourceCount = $derived');
		expect(studio).toContain('const completedEvaluatedSourceCount = $derived');
		expect(studio).toContain('const attachedSourceCount = $derived');
		expect(studio).toContain('const evaluatedSourceCount = $derived');
		expect(studio).toContain('const searchOnlySourceCount = $derived');
		expect(studio).toContain('const sourceEvidenceKnown = $derived');
		expect(studio).toContain('const sourceEvidenceCite = $derived');
		expect(studio).toContain('const sourceBasisState = $derived<StudioCapabilityState>');
		expect(studio).toContain('const sourceBasisSignal = $derived');
		expect(studio).toContain('const sourceBasisDetail = $derived');
		expect(studio).toContain('function isSearchOnlyStudioSource(source: StudioSource): boolean');
		expect(studio).toContain("const SOURCE_FALLBACK_MARKER = 'Evaluation unavailable'");
		expect(studio).toContain('The operator stopped this loop before it emitted output.');
		expect(studioSources).toContain('aria-label="Source ground"');
		expect(studioSources).toContain('<span class="sources-title">Source ground</span>');
		expect(studioSources).toContain('const fallbackCount = $derived(sources.filter(isFallback).length)');
		expect(studioSources).toContain('const evaluatedCount = $derived(sources.length - fallbackCount)');
		expect(studioSources).toContain('<span class="sources-count-label">attached</span>');
		expect(studioSources).toContain('<span class="sources-count-label">evaluated</span>');
		expect(studioSources).toContain('<span class="sources-count-label">search-only</span>');
		expect(studioSources).toContain('No source ground yet. It surfaces here as GROUND completes.');
		expect(studioSources).toContain('class="source-boundary"');
		expect(studioSources).toContain('relevance only.');
		expect(studioSources).not.toContain('aria-label="Verified sources"');
		expect(studioSources).not.toContain('<span class="sources-title">Verified sources</span>');
		expect(studioSources).not.toContain('<span class="sources-count-label">verified</span>');
		expect(studioSources).not.toContain('class="source-stub"');
		expect(studioReasoning).toContain(
			"author: { label: 'Author', gloss: 'writing from attached source ground' }"
		);
		expect(studioReasoning).not.toContain('writing from verified sources');
		expect(studio).toContain(
			'Resolved targets were found, but usable public contact evidence was not available for authoring.'
		);
		expect(studio).toContain(
			'No decision-maker identity reached the contactable target contract.'
		);
		expect(studio).toContain('resolutionBlockedDetail');
		expect(studio).toContain(
			'Authoring did not claim output because the process closed before an authored artifact existed.'
		);
		expect(studio).toContain('Job failed before encrypted recovery completed.');
		expect(studio).toContain("label: 'Artifact recovery boundary'");
		expect(studio).toContain("'read recovery boundary'");
		expect(studio).not.toContain("action: 'read boundary'");
		expect(studio).toContain(
			'process memory is device-local, not server-side persistence or proof-bound delegated action'
		);
		expect(studio).toContain('Artifact recovery is live; proof-bound drafted-artifact lift waits on.');
		expect(studio).not.toContain('T3-1 through T3-5');
		expect(studio).not.toContain(
			"state: decisionMakers.length > 0 ? 'live' : running || intentReady ? 'partial' : 'gated'"
		);
		expect(studio).toContain('sources.length > 0 ||');
		expect(studio).toContain('activeMessageJob ||');
		expect(studio).toContain("activeStage === 'ground' || activeStage === 'author'");
		expect(studio).toContain('resolve first');
			expect(studio).toContain(
				'Calls /api/agents/stream-message as a recoverable message job only after decision-maker resolution'
			);
			expect(studio).toContain('Recovery is device-local and depends on the local recovery key');
			expect(studio).toContain('buildSendReadiness({');
			expect(studio).toContain('emailDeliveryHref,');
			expect(studio).toContain('fallbackSubscribedCount: spaces.base?.emailHealth.subscribed ?? null');
		expect(studio).toContain('{sendReadiness}');
		expect(studio).toContain(
			'Scope is applied, but parser confidence stays bounded until full jurisdiction resolution lands.'
		);
		expect(studio).toContain(
			'This role can author, watch, and preserve the artifact; draft handoff and execution side effects require org authority.'
		);
		expect(messageGenerationEvidenceSource).toContain(
			'Authored artifact can publish as a public action template; delivery side effects remain delivery-surface-owned.'
		);
		expect(messageGenerationEvidenceSource).toContain(
			'No delivery-surface handoff is claimed until stream-message emits output.'
		);
		expect(studioSend).toContain(
			'Draft handoff authority is required before Studio can write into delivery surfaces.'
		);
		expect(studio).not.toContain('Owners and editors can publish; members can author and watch.');
		expect(studio).not.toContain('publish authority is required for handoff');
		expect(studio).not.toContain(
			'route handoff authority is required before Studio can write it into a destination draft'
		);
		expect(studio).not.toContain(
			'No destination-owned draft handoff appears until authored output exists.'
		);
		expect(studio).not.toContain('artifact exists; route handoff authority required');
		expect(studio).not.toContain('No handoff appears until authored output exists.');
		expect(studio).not.toContain('Scope is applied, but parser confidence stays bounded until.');
		expect(studio).not.toContain(
			"state: intentReady || decisionMakers.length > 0 || running ? 'live' : 'gated'"
		);

			expect(studioSend).toContain('formatGateEvidence');
			expect(studioSend).toContain('getGateEvidence');
			expect(studioSend).toContain('type CapabilityState');
			expect(studioSend).toContain('type SendReadinessSummary');
			expect(studioSend).toContain('type SendChannelContract');
			expect(studioSend).toContain("phase: SendReadinessMode['phase'] | 'HANDOFF'");
			expect(studioSend).toContain('contract: SendChannelContract');
			expect(studioSend).toContain('formatCapabilityClusters');
			expect(studioSend).toContain('sendReadiness?: SendReadinessSummary | null');
			expect(studioSend).toContain(
				"const congressionalLaunchGate = getGateEvidence('CP-congressional-launch', ['NEW-A-7']"
			);
			expect(studioSend).toContain('const browserDirectMode = $derived(');
			expect(studioSend).toContain("sendReadiness?.modes.find((mode) => mode.key === 'browser-direct')");
			expect(studioSend).toContain('const cwcSendMode = $derived(');
			expect(studioSend).toContain("sendReadiness?.modes.find((mode) => mode.key === 'cwc')");
			expect(studioSend).toContain("const cwcArmed = $derived(cwcSendMode?.state === 'live')");
		expect(studioSend).not.toContain(
			'Boolean(FEATURES.CONGRESSIONAL && congressionalLaunchGate.state ==='
		);
		expect(studioSend).toContain(
			'const publishReady = $derived(ready && canPublish && Boolean(onpublish))'
		);
		expect(studioSend).toContain(
			'const emailReady = $derived(ready && canPublish && Boolean(onemail))'
		);
		expect(studioSend).toContain(
			'const cwcReady = $derived(ready && canPublish && cwcArmed && Boolean(oncwc))'
		);
		expect(studioSend).toContain("import { FileUp, Landmark, Mail, type Icon }");
		expect(studioSend).toContain('operatorCapabilityStateLabel');
		expect(studioSend).toContain('operatorCapabilityStateRatioSegments');
		expect(studioSend).toContain(
			"const publicTemplateState = $derived<CapabilityState>(publishReady ? 'draft-only' : 'gated')"
		);
		expect(studioSend).toContain(
			"const orgEmailState = $derived<CapabilityState>(emailReady ? 'draft-only' : 'gated')"
		);
		expect(studioSend).toContain(
			"const cwcState = $derived<CapabilityState>(cwcReady ? 'live' : 'gated')"
		);
		expect(studioSend).toContain('function handoffPosture(handler: (() => void) | undefined)');
		expect(studioSend).toContain("if (!ready) return 'No authored artifact to hand off yet.'");
		expect(studioSend).toContain(
			"if (!canPublish) return 'Org authority required before draft handoff.'"
		);
		expect(studioSend).toContain(
			'Draft transfer only; the delivery surface owns final confirmation.'
		);
		expect(studioSend).toContain(
			'Your role can preserve the artifact but not hand it to delivery surfaces'
		);
		expect(studioSend).toContain('sendReadiness?.sendBoundaryGate');
		expect(studioSend).toContain('Draft handoff authority is required before Studio can write');
		expect(studioSend).toContain(
			"if (!handler) return 'Draft handoff is not wired for this channel.'"
		);
		expect(studioSend).toContain('const cwcPosture = $derived(');
		expect(studioSend).toContain('Proof delivery boundary only; no congressional side effect.');
		expect(studioSend).toContain('draft handoff authority and a delivery surface');
		expect(studioSend).toContain('draft handoff and execution side');
		expect(studioSend).toContain('effects require org authority');
		expect(studioSend).toContain('<span class="channel-posture">{channel.posture}</span>');
		expect(studioSend).not.toContain('channel-reason');
		expect(studioSend).not.toContain("'Role gated'");
		expect(studioSend).not.toContain("'No handoff'");
		expect(studioSend).not.toContain("'Dependency first'");
		expect(studioSend).not.toContain('Your role can author but not publish');
		expect(studioSend).not.toContain(
			'Owners and editors can create publish or delivery drafts from Studio.'
		);
		expect(studioSend).not.toContain('Owners and editors can launch congressional delivery.');
			expect(studioSend).toContain('const publicTemplateGate = $derived(handoffGate');
			expect(studioSend).toContain('const orgEmailGate = $derived(handoffGate');
				expect(studioSend).toContain(
					'resolved audience, sources, composed message, scope, recoverable job handle, and trace id'
				);
				expect(studioSend).toContain('subject, body, scope, and non-secret Studio provenance');
			expect(studioSend).toContain(
				'const publicTemplateContract = $derived<SendChannelContract>'
			);
			expect(studioSend).toContain('const orgEmailContract = $derived<SendChannelContract>');
			expect(studioSend).toContain('const cwcContract = $derived<SendChannelContract>');
			expect(studioSend).toContain("handoff: 'Public template creator'");
			expect(studioSend).toContain(
				'Creates a public action draft from emitted audience'
			);
			expect(studioSend).toContain('Studio creates only an email composer draft');
			expect(studioSend).toContain(
				'Proof delivery remains a read-only boundary until runtime evidence'
			);
			expect(studioSend).not.toContain('destination-owned');
			expect(studioSend).not.toContain('Destination draft handoff');
			expect(studioSend).not.toContain('destination route owns final confirmation');
			expect(studioSend).not.toContain('destination routes');
			expect(studioSend).not.toContain('draft destination');
				expect(studioSend).toContain('const firstHeldMode = $derived(sendReadiness?.nextHeldMode ?? null)');
				expect(studioSend).toContain(
					'const deliveryModeRows = $derived<SendReadinessMode[]>(sendReadiness?.modes ?? [])'
			);
			expect(studioSend).toContain('const deliveryModeSegments = $derived(');
			expect(studioSend).toContain('operatorCapabilityStateRatioSegments(deliveryModeStateCounts)');
			expect(studioSend).toContain('const heldDeliveryModeCount = $derived(');
			expect(studioSend).toContain(
				"deliveryModeStateCounts['draft-only'] + deliveryModeStateCounts.gated"
			);
			expect(studioSend).toContain('const deliveryBoundarySummary = $derived(');
			expect(studioSend).toContain(
				"const deliveryHeldModeSummary = $derived(sendReadiness?.heldModeSummary ?? 'no held handoffs')"
			);
			expect(studioSend).toContain('sendReadiness?.sendBoundarySummary');
			expect(studioSend).toContain('sendReadiness?.sendBoundaryGate');
			expect(studioSend).toContain('aria-label="Shared send readiness boundary"');
			expect(studioSend).toContain('buildSendReadiness heldCount');
			expect(studioSend).toContain('{deliveryHeldModeSummary}');
			expect(studioSend).toContain('sendReadiness?.browserDirectSignal');
			expect(studioSend).toContain(
				'{firstHeldMode.phase} / {formatCapabilityClusters(firstHeldMode.cluster)}'
			);
			expect(studioSend).toContain('stateActionLabel(firstHeldMode.state, firstHeldMode.action)');
			expect(studioSend).toContain('function modeActionLabel(mode: SendReadinessMode): string');
			expect(studioSend).toContain('return stateActionLabel(mode.state, mode.action);');
			expect(studioSend).toContain('aria-label="Shared delivery-mode readiness"');
			expect(studioSend).toContain('Shared send modes');
			expect(studioSend).toContain('Armed, bounded, and held send paths');
			expect(studioSend).not.toContain('Armed paths, draft paths, and held verbs');
			expect(studioSend).toContain('buildSendReadiness modes');
			expect(studioSend).toContain('class="mode-count-total"');
			expect(studioSend).toContain('class="mode-count-split"');
			expect(studioSend).toContain('class="mode-count-divider"');
			expect(studioSend).toContain(
				'${deliveryModeRows.length} shared send modes; ${deliveryModeStateCounts.live} armed; ${deliveryModeStateCounts.partial} bounded; ${heldDeliveryModeCount} held'
			);
			expect(studioSend).toContain(
				'<Datum value={deliveryModeStateCounts.live} cite="buildSendReadiness modes" />'
			);
			expect(studioSend).toContain(
				'<Datum value={deliveryModeStateCounts.partial} cite="buildSendReadiness modes" />'
			);
			expect(studioSend).toContain(
				'<Datum value={heldDeliveryModeCount} cite="buildSendReadiness modes" />'
			);
			expect(studioSend).toContain('aria-label="Shared send mode state mix"');
			expect(studioSend).toContain('{#each deliveryModeRows as mode (mode.key)}');
			expect(studioSend).toContain('{mode.phase} / {formatCapabilityClusters(mode.cluster)}');
			expect(studioSend).toContain('{mode.unlock}');
		expect(studioSend).toContain('{modeActionLabel(mode)}');
		expect(studioSend).toContain('const cwcGateSummary = $derived(');
		expect(studioSend).toContain('Congressional delivery remains dependency-first.');
		expect(studioSend).toContain('Proof handoff can open; transport still verifies downstream.');
			expect(studioSend).toContain('const channelRows = $derived<SendChannel[]>');
			expect(studioSend).toContain("name: 'Public action draft'");
			expect(studioSend).toContain("name: 'Email composer draft'");
			expect(studioSend).toContain("name: 'Congress proof delivery'");
			expect(studioSend).toContain(
				"action: cwcReady ? 'prepare proof handoff' : 'read proof-delivery boundary'"
			);
			expect(studioSend).toContain(
				'CWC proof handoff can open after proof, routing, and transport checks.'
			);
			expect(studioSend).not.toContain("'submit congressional delivery'");
			expect(studioSend).not.toContain("'read CWC gate'");
			expect(studioSend).not.toContain("name: 'Org email blast'");
			expect(studioSend).not.toContain("name: 'Congress (CWC)'");
			expect(studioSend).toContain('const channelSegments = $derived(');
			expect(studioSend).toContain('operatorCapabilityStateRatioSegments(channelStateCounts)');
		expect(studioSend).toContain(
			"channelRows.filter((channel) => channel.state === 'draft-only').length"
		);
		expect(studioSend).toContain('aria-label="Studio send capability contract"');
		expect(studioSend).toContain('id="studio-send"');
		expect(studioSend).toContain('aria-label="Send channel state mix"');
		expect(studioSend).toContain('<Ratio segments={channelSegments} height={8} />');
				expect(studioSend).toContain('size: 18, strokeWidth: 1.8');
				expect(studioSend).toContain('<span class="channel-state">{stateLabel(channel.state)}</span>');
				expect(studioSend).toContain('aria-label={channelAriaLabel(channel)}');
				expect(studioSend).toContain('function channelAriaLabel(channel: SendChannel): string');
				expect(studioSend).toContain(
					'<span class="channel-contract" aria-label={`${channel.name} handoff-effect contract`}>'
				);
				expect(studioSend).toContain(
					'{channel.contract.phase} / {formatCapabilityClusters('
				);
				expect(studioSend).toContain('{channel.contract.handoff}');
				expect(studioSend).toContain('{channel.contract.effect}');
				expect(studioSend).toContain('{channel.contract.source}');
				expect(studioSend).toContain('<span class="channel-gate">{channel.gate}</span>');
				expect(studioSend).toContain(
					'return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });'
			);
			expect(studioSend).toContain('return stateActionLabel(channel.state, channel.action);');
		expect(studioSend).not.toContain("'Gate closed'");
		expect(studioSend).not.toContain("'Congressional delivery gate is closed'");
		expect(studioSend).not.toContain("'Ready handoff'");
			expect(studioSend).not.toContain('FEATURES.CONGRESSIONAL is false');
			expect(studioSend).not.toContain("'Feature gated'");
			expect(studioSend).not.toContain('Congressional delivery is feature-gated');
			expect(studioSend).not.toContain('Org email blast');
			expect(studioSend).not.toContain(
				'When CONGRESSIONAL flips true at launch, this channel goes live'
			);
		expect(studioSend).not.toContain('channel-state--live">Live handoff');
		expect(studioSend).not.toContain('svg viewBox');

		expect(authoringProcess).toContain('if (decisionMakers.length === 0)');
		expect(authoringProcess).toContain('function buildResolutionStopBoundary');
		expect(authoringProcess).toContain("reason: 'no-public-email'");
		expect(authoringProcess).toContain("reason: 'no-target'");
		expect(authoringProcess).toContain(
			'No decision-maker identity with contactable public email was emitted; AUTHOR stayed closed.'
		);
		expect(authoringProcess).toContain(
			'lacked usable public email or deliverability evidence; AUTHOR stayed closed.'
		);
		expect(authoringProcess).toContain('p.resolutionStopReason = stopBoundary.reason;');
		expect(authoringProcess.indexOf('function buildResolutionStopBoundary')).toBeLessThan(
			authoringProcess.indexOf('async function runMessage')
		);
		expect(authoringProcess).toContain('computeMessageInputHash');
		expect(authoringProcess).toContain('getOrCreateMessageRecoveryPublicKey');
		expect(authoringProcess).toContain('decryptMessageJobResult');
		expect(authoringProcess).toContain('job_id: jobId');
		expect(authoringProcess).toContain('input_hash: inputHash');
		expect(authoringProcess).toContain('recovery_public_key_jwk: recoveryPublicKeyJwk');
		expect(messageJobRecovery).toContain('traceId?: string');
		expect(authoringProcess).toContain('traceId?: string');
		expect(authoringProcess).toContain('traceId: job.traceId ?? p.activeMessageJob?.traceId');
		expect(streamMessage).toContain('status: messageJob.status,');
		expect(streamMessage).toContain('traceId');
		expect(streamMessage).toContain(
			"emitter.send('job-complete', { job: { ...messageJob, traceId } })"
		);
		expect(streamMessage).toContain(
			"emitter.send('job-running', { job: { ...messageJob, traceId } })"
		);
		expect(streamMessage).toContain('type SourceEvidenceUpdate');
		expect(streamMessage).toContain('onSourceEvidence: (evidence: SourceEvidenceUpdate) => {');
		expect(streamMessage).toContain("emitter.send('source-evidence', evidence)");
		expect(streamMessage).toContain("traceEvent(traceId, TRACE_ENDPOINT, 'source-evidence', evidence)");
		expect(traceReplayRoute).toContain('serverQuery(api.agentTraces.listByTrace');
		expect(traceReplayRoute).toContain('process.env.INTERNAL_API_SECRET');
		expect(traceReplayRoute).toContain('event.locals.session');
		expect(traceReplayRoute).toContain("traceEvent.eventType === 'trace.start'");
		expect(traceReplayRoute).toContain('start.userId !== session.userId');
		expect(traceReplayRoute).toContain("start.endpoint !== 'message-generation'");
		expect(traceReplayRoute).toContain('agent_trace_replay_not_configured');
		expect(traceReplayRoute).toContain('function summarizeTracePayload');
		expect(traceReplayRoute).toContain("'Model message-write event recorded; raw prompt and response stay internal.'");
		expect(traceReplayRoute).toContain('payloadKeys: payloadKeys(event.payload)');
		expect(traceReplayRoute).not.toContain('payload: event.payload');
		expect(authoringProcess).toContain("case 'source-evidence':");
		expect(authoringProcess).toContain('const evidence = normalizeSourceEvidence(event.data)');
		expect(authoringProcess).toContain('p.sourceEvidenceObserved = true');
		expect(authoringProcess).toContain(
			'p.sourceEvidenceEvaluatedCount = evidence.evaluatedSourceCount'
		);
		expect(authoringProcess).toContain(
			'p.sourceEvidenceSearchOnlyCount = evidence.searchOnlySourceCount'
		);
		expect(authoringProcess).toContain(
			'p.sourceEvidenceEvaluationFallback = evidence.evaluationFallback'
		);
		expect(authoringProcess).toContain('p.sourceEvidenceCandidateCount = evidence.candidateCount');
		expect(authoringProcess).toContain('p.sourceEvidenceFailedCount = evidence.failedCount');
		expect(authoringProcess).toContain(
			'p.sourceEvidenceSearchQueryCount = evidence.searchQueryCount'
		);
		expect(messageWriter).toContain('export interface SourceEvidenceUpdate');
		expect(messageWriter).toContain("mode: 'discovery' | 'preverified'");
		expect(messageWriter).toContain('evaluatedSourceCount: number;');
		expect(messageWriter).toContain('searchOnlySourceCount: number;');
		expect(messageWriter).toContain('evaluationFallback?: boolean;');
		expect(messageWriter).toContain("const SOURCE_EVALUATION_FALLBACK_PREFIX = 'Evaluation unavailable'");
		expect(messageWriter).toContain('searchOnlySourceCount(verifiedSources)');
		expect(sourceDiscovery).toContain('evaluationFallback: boolean;');
		expect(sourceDiscovery).toContain('evaluationFallbackError?: string;');
		expect(sourceDiscovery).toContain('## Source Ground (cite using [1], [2], etc.)');
		expect(sourceDiscovery).toContain(
			'Search-only fallback sources may be cited for context but must not be described as evaluated or verified.'
		);
		expect(streamMessage).toContain('Final message with bounded source ground');
		expect(streamMessage).toContain('Write using ONLY bounded source ground');
		expect(streamMessage).toContain('sourceGroundCount: result.sources.length');
		expect(streamMessage).toContain('evaluatedSourceCount:');
		expect(streamMessage).toContain('searchOnlySourceCount:');
		expect(streamMessage).not.toContain('Final message with VERIFIED sources');
		expect(streamMessage).not.toContain('Write using ONLY verified sources');
		expect(streamMessage).not.toContain('verifiedSourceCount: result.sources.length');
		expect(authoringProcess).toContain('Streams real GROUND thoughts + bounded source ground');
		expect(authoringProcess).not.toContain('Streams real GROUND thoughts + verified sources');
		expect(messageWriterPrompt).toContain('## SOURCE GROUND');
		expect(messageWriterPrompt).toContain('bounded source ground');
		expect(messageWriterPrompt).toContain(
			'Search-only fallback sources may be useful context, but they are not evaluated evidence'
		);
		expect(messageWriterPrompt).toContain(
			'If a source is marked search-only fallback, cite it only for cautious context'
		);
		expect(messageWriterPrompt).not.toContain('VERIFIED SOURCE POOL');
		expect(messageWriterPrompt).not.toContain('verified sources');
		expect(messageWriter).toContain('Discovering and evaluating source ground');
		expect(messageWriter).toContain('Source ground ready:');
		expect(messageWriter).toContain('sourceGroundCount: verifiedSources.length');
		expect(messageWriter).toContain(
			'evaluatedSourceCount: verifiedSources.length - searchOnlySourceCount(verifiedSources)'
		);
		expect(messageWriter).toContain(
			'searchOnlySourceCount: searchOnlySourceCount(verifiedSources)'
		);
		expect(messageWriter).toContain('sourceGroundRows: verifiedSourcesForOutput.length');
		expect(messageWriter).not.toContain('Discovering and verifying sources');
		expect(messageWriter).not.toContain('verifiedSourceCount: verifiedSources.length');
		expect(messageWriter).not.toContain('verifiedSources: verifiedSourcesForOutput.length');
		expect(messageWriter).toContain('onSourceEvidence?: (evidence: SourceEvidenceUpdate) => void;');
		expect(messageWriter).toContain('options.onSourceEvidence?.({');
		expect(messageGenerationResolver).toContain('traceId?: string | null');
		expect(messageGenerationResolver).toContain('function updateActiveMessageJobFromServer');
		expect(messageGenerationResolver).toContain('activeJob.traceId = job.traceId');
		expect(messageGenerationResolver).toContain("case 'job':");
		expect(messageGenerationResolver).toContain("case 'phase':");
		expect(messageGenerationResolver).toContain("import type { PipelinePhase }");
			expect(messageGenerationResolver).toContain(
				"import { Artifact, Datum, Ratio } from '$lib/design'"
			);
			expect(messageGenerationResolver).toContain('buildMessageGenerationEvidence,');
			expect(messageGenerationResolver).toContain('messageGenerationSpineRows,');
			expect(messageGenerationResolver).toContain('type MessageGenerationEvidenceRow');
			expect(messageGenerationResolver).toContain('operatorCapabilityActionLabel');
			expect(messageGenerationResolver).toContain('operatorCapabilityStateRatioSegments');
			expect(messageGenerationResolver).toContain('formatCapabilityClusters');
			expect(messageGenerationResolver).toContain("getGateEvidence('CP-message-proof-binding'");
			expect(hypergraph).toContain('export const MESSAGE_GENERATION_SPINE_ROW_KEYS');
			expect(hypergraph).toContain('export function messageGenerationSpineRows');
			expect(messageGenerationResolver).toContain('const messageCoreInput = $derived(');
		expect(messageGenerationResolver).toContain('const messageIntentFieldCount = $derived(');
		expect(messageGenerationResolver).toContain(
			'const selectedDecisionMakerCount = $derived(formData.audience.decisionMakers?.length ?? 0)'
		);
			expect(messageGenerationResolver).toContain('const liveEvidenceSummary = $derived(');
			expect(messageGenerationResolver).toContain('buildMessageGenerationEvidence({');
			expect(messageGenerationResolver).toContain(
				'const liveGenerationSpineRows = $derived(messageGenerationSpineRows(liveEvidenceRows));'
			);
			expect(messageGenerationResolver).toContain('intentFieldCount: messageIntentFieldCount');
		expect(messageGenerationResolver).toContain('targetCount: selectedDecisionMakerCount');
		expect(messageGenerationResolver).toContain('let liveSourceCount = $state(0)');
		expect(messageGenerationResolver).toContain('let liveEvaluatedSourceCount = $state(0)');
		expect(messageGenerationResolver).toContain('let liveSearchOnlySourceCount = $state(0)');
		expect(messageGenerationResolver).toContain(
			"let liveSourceMode = $state<'discovery' | 'preverified' | null>(null)"
		);
		expect(messageGenerationResolver).toContain("phase: currentPhase ?? 'preparing'");
		expect(messageGenerationResolver).toContain('paragraphCount: 0');
		expect(messageGenerationResolver).toContain('sourceCount: liveSourceCount');
		expect(messageGenerationResolver).toContain('evaluatedSourceCount: liveEvaluatedSourceCount');
		expect(messageGenerationResolver).toContain('searchOnlySourceCount: liveSearchOnlySourceCount');
		expect(messageGenerationResolver).toContain('sourceEvidenceObserved: liveSourceMode !== null');
		expect(messageGenerationResolver).toContain('researchStepCount: thoughts.length');
		expect(messageGenerationResolver).toContain('traceHandle: liveTraceHandle');
		expect(messageGenerationResolver).toContain('const liveFocusRows = $derived(');
		expect(messageGenerationResolver).toContain("'intent-input'");
		expect(messageGenerationResolver).toContain("'target-basis'");
		expect(messageGenerationResolver).toContain("'stream-phase'");
		expect(messageGenerationResolver).toContain('currentPhase = null;');
			expect(messageGenerationResolver).toContain("currentPhase = 'recovering'");
			expect(messageGenerationResolver).toContain('aria-label="Live authored artifact contract"');
			expect(messageGenerationResolver).toContain('Live authoring contract');
			expect(messageGenerationResolver).toContain('aria-label="Authored artifact spine"');
			expect(messageGenerationResolver).toContain('{#each liveGenerationSpineRows as row (row.key)}');
			expect(messageGenerationResolver).toContain('class="generation-spine-cell"');
			expect(messageGenerationResolver).toContain('<span class="generation-spine-label">{row.label}</span>');
			expect(messageGenerationResolver).toContain(
				'<span class="generation-spine-ground">{row.ground}</span>'
			);
			expect(messageGenerationResolver).toContain(
				'<span class="generation-spine-action">{rowActionLabel(row)}</span>'
			);
			expect(messageGenerationResolver).toContain(".generation-spine-cell[data-state='draft-only']");
			expect(messageGenerationResolver).toContain(".generation-row[data-state='draft-only']");
			expect(messageGenerationResolver).toContain('type GenerationBoundary = {');
		expect(messageGenerationResolver).toContain('let generationBoundary = $state<GenerationBoundary | null>(null)');
		expect(messageGenerationResolver).toContain('const generationBoundaryTitle = $derived(');
		expect(messageGenerationResolver).toContain("generationBoundary?.code === 'message_generation_rate_limited'");
		expect(messageGenerationResolver).toContain("'Authoring quota boundary'");
		expect(messageGenerationResolver).toContain('function boundaryFromResponse(');
		expect(messageGenerationResolver).toContain('message_generation_runtime_not_configured');
		expect(messageGenerationResolver).toContain('currentPhaseMessage = generationBoundary.message');
		expect(messageGenerationResolver).toContain('function boundaryFromThrownError');
		expect(messageGenerationResolver).toContain('message_generation_input_not_ready');
		expect(messageGenerationResolver).toContain('aria-label={generationBoundaryTitle}');
		expect(messageGenerationResolver).toContain('{generationBoundaryTitle}');
		expect(messageGenerationResolver).toContain('generation-boundary-artifact');
		expect(messageGenerationResolver).toContain('generation-boundary-meta');
		expect(messageGenerationResolver).toContain('{generationBoundaryAction}');
		expect(messageGenerationResolver).toContain("code: 'message_generation_rate_limited'");
		expect(messageGenerationResolver).toContain("missing: ['available authoring quota']");
		expect(messageGenerationResolver).toContain("'read quota boundary'");
		expect(messageGenerationResolver).toContain("stage === 'rate-limited'");
		expect(messageGenerationResolver).not.toContain(['Generation', 'limit reached'].join(' '));
		expect(messageGenerationResolver).toContain('Retry stream');
		expect(messageGenerationResolver).toContain('generationBoundary?.retryable !== false');
		expect(messageGenerationResolver).toContain('Review input');
		expect(messageGenerationResolver).not.toContain('Something went wrong');
		expect(messageGenerationResolver).toContain('Sign in to continue authoring');
		expect(messageGenerationResolver).toContain(
			'Authentication preserves quota, recovery, and draft continuity for this run.'
		);
		expect(messageGenerationResolver).toContain('<Ratio segments={liveEvidenceSegments} height={6} />');
		expect(messageGenerationResolver).toContain('{formatCapabilityClusters(row.clusters)}');
		expect(messageGenerationResolver).toContain('{rowStateLabel(row)}');
		expect(messageGenerationResolver).toContain(
			'return operatorCapabilityActionLabel(row.state, row.action, { appendReadyArrow: true });'
		);
		expect(messageGenerationResolver).toContain('<span class="generation-row-effect">{row.effect}</span>');
		expect(messageGenerationResolver).toContain(
			'<span class="generation-row-action">{rowActionLabel(row)}</span>'
		);
		expect(messageGenerationResolver).toContain('context="Grounding and authoring"');
		expect(messageGenerationResolver).toContain(
			"traceId: typeof event.data.traceId === 'string' ? event.data.traceId : null"
		);
		expect(messageGenerationResolver).toContain("case 'source-evidence':");
		expect(messageGenerationResolver).toContain('event.data.evaluatedSourceCount');
		expect(messageGenerationResolver).toContain('event.data.searchOnlySourceCount');
		expect(messageGenerationResolver).toContain(
			'No evaluated source ground attached; authoring can continue without citation support.'
		);
		expect(messageGenerationResolver).toContain(
			'`${liveEvaluatedSourceCount} evaluated · ${liveSearchOnlySourceCount} search-only source${liveSearchOnlySourceCount === 1 ? \'\' : \'s\'} attached.`'
		);
		expect(messageGenerationResolver).toContain(
			'`${liveEvaluatedSourceCount} cached evaluated source${liveEvaluatedSourceCount === 1 ? \'\' : \'s\'} ready for authoring.`'
		);
		expect(messageGenerationResolver).toContain(
			'activeMessageJob={formData.content.activeMessageJob}'
		);
		expect(messageGenerationResolver).toContain('intentFieldCount={messageIntentFieldCount}');
		expect(messageGenerationResolver).toContain('targetCount={selectedDecisionMakerCount}');
		expect(messageGenerationResolver).toContain(
			"operatorCapabilityActionLabel('partial', 'publish public action template'"
		);
		expect(messageGenerationResolver).toContain('Publishing public action...');
		expect(messageGenerationResolver).toContain('Public action template');
		expect(messageGenerationResolver).toContain(
			'send / dispatch / receipt proof stay route-owned'
		);
		expect(messageGenerationResolver).not.toContain('Publishing...');
		expect(messageGenerationResolver).not.toContain('Try Again →');
		expect(messageGenerationResolver).not.toContain('Publish →');
		expect(slugCustomizer).toContain('Action page link');
		expect(slugCustomizer).toContain('after public-action publish');
		expect(slugCustomizer).toContain('this opens reader confirmation');
		expect(slugCustomizer).toContain('Send and proof stay route-owned');
		expect(slugCustomizer).toContain('slug-link-preview');
		expect(slugCustomizer).not.toContain('Your shareable link');
		expect(slugCustomizer).not.toContain('anyone with this link can send your message');
		expect(slugCustomizer).not.toContain('bg-gradient-to-br');
		expect(creationSpark).toContain('Author once.');
		expect(creationSpark).toContain('Confirm together.');
		expect(creationSpark).toContain('Publish an action page.');
		expect(creationSpark).toContain('Each reader confirms their route');
		expect(creationSpark).toContain('before any send or proof is');
		expect(creationSpark).not.toContain('Write it once. Share the link. Everyone can send it.');
		expect(coordinationExplainer).toContain('How action pages become records');
		expect(coordinationExplainer).toContain('One confirmed route is one voice');
		expect(coordinationExplainer).toContain('Publish the action page.');
		expect(coordinationExplainer).toContain('Readers open confirmation before any send.');
		expect(coordinationExplainer).toContain('Verified confirmations and route-owned receipts');
		expect(coordinationExplainer).not.toContain('How sends are recorded');
		expect(coordinationExplainer).not.toContain('Share the link.');
		expect(coordinationExplainer).not.toContain('Anyone who shares your problem can send it too.');
		expect(templateSuccessModal).toContain('let showShareActions = $derived(isPublished)');
		expect(templateSuccessModal).toContain('Public action publish status');
		expect(templateSuccessModal).toContain('Publishing public action');
		expect(templateSuccessModal).toContain(
			'The action page unlocks after the server confirms creation.'
		);
		expect(templateSuccessModal).toContain('Action page pending');
		expect(templateSuccessModal).toContain(
			'Share controls unlock only after the server confirms a public action.'
		);
		expect(templateSuccessModal).toContain('Share action page');
		expect(templateSuccessModal).toContain('Action page copied');
		expect(templateSuccessModal).toContain('Copy action page');
		expect(templateSuccessModal).toContain('Open action page');
		expect(templateSuccessModal).toContain("import { Datum, Ratio } from '$lib/design';");
		expect(templateSuccessModal).toContain(
			"import { formatCapabilityClusters } from '$lib/data/capability-clusters';"
		);
		expect(templateSuccessModal).toContain('buildPublicActionPublishContractRows,');
		expect(templateSuccessModal).toContain("getGateEvidence,");
		expect(templateSuccessModal).toContain('type PublicActionPublishContractRow');
		expect(templateSuccessModal).not.toContain('type PublishContractRow = {');
		expect(templateSuccessModal).not.toContain("formatGateEvidence,");
		expect(templateSuccessModal).toContain("const messageProofGate = getGateEvidence('CP-message-proof-binding'");
		expect(templateSuccessModal).toContain(
			'const publishContractRows = $derived<PublicActionPublishContractRow[]>'
		);
		expect(templateSuccessModal).toContain('buildPublicActionPublishContractRows({');
		expect(templateSuccessModal).toContain('isPublished,');
		expect(templateSuccessModal).toContain('publishing,');
		expect(templateSuccessModal).toContain('isDraft: hasError ? false : isDraft');
		expect(templateSuccessModal).toContain('evaluatedSourceCount,');
		expect(templateSuccessModal).toContain('searchOnlySourceCount,');
		expect(templateSuccessModal).toContain(
			"publishContractRows.find((row) => row.id === 'publish-record')?.state ?? 'gated'"
		);
		expect(templateSuccessModal).toContain('operatorCapabilityStateRatioSegments(publishContractStateCounts)');
		expect(templateSuccessModal).toContain('aria-label="Public action publish contract"');
		expect(templateSuccessModal).toContain('Public action route, not delivery proof');
		expect(templateSuccessModal).toContain('{formatCapabilityClusters(row.clusters)}');
		expect(templateSuccessModal).not.toContain('const sourceBasisState = $derived');
		expect(templateSuccessModal).not.toContain('const sourceBasisAction = $derived');
		expect(templateSuccessModal).not.toContain('const sourceBasisEffect = $derived');
		expect(hypergraph).toContain('export type PublicActionPublishRowKey');
		expect(hypergraph).toContain('export type PublicActionPublishContractRow');
		expect(hypergraph).toContain('export function buildPublicActionPublishContractRows');
		expect(hypergraph).toContain("id: 'publish-record'");
		expect(hypergraph).toContain("label: 'Publish record'");
		expect(hypergraph).toContain("label: 'Action route'");
		expect(hypergraph).toContain("label: 'Target basis'");
		expect(hypergraph).toContain("label: 'Source basis'");
		expect(hypergraph).toContain("label: 'Proof binding'");
		expect(hypergraph).toContain("evaluatedSourceCount > 0 ? 'live' : 'partial'");
		expect(hypergraph).toContain('qualify search-only source ground');
		expect(hypergraph).toContain('do not imply evaluated citation support');
		expect(hypergraph).toContain('value: evaluatedSourceCount');
		expect(hypergraph).toContain("label: 'evaluated sources'");
		expect(hypergraph).toContain(
			'The server confirmed a public action template record; share controls can appear.'
		);
		expect(hypergraph).toContain(
			'The public action page owns reader confirmation; this modal does not count send, receipt, or proof side effects.'
		);
		expect(hypergraph).toContain(
			'search-only fallback remains bounded context, and delivery receipt or proof-bound execution require separate routes.'
		);
		expect(hypergraph).toContain(
			'Published action route is live; artifact proof binding remains bounded.'
		);
		expect(hypergraph).toContain('template.sources + template.research_log');
		expect(templateSuccessModal).toContain(
			'reader-side send confirmation remains on that route'
		);
		expect(templateSuccessModal).toContain(
			'Share the action page. Each reader confirms their own route.'
		);
		expect(templateSuccessModal).toContain('Retry public action publish');
		expect(templateSuccessModal).not.toContain('Your link is ready to share');
		expect(templateSuccessModal).not.toContain('Published!');
		expect(templateSuccessModal).not.toContain('<span>Send your message</span>');
		expect(templateSuccessModal).not.toContain('Share the link. Others send the same message.');
		expect(templateSuccessModal).not.toContain('Share controls unlock only after the server returns');
		expect(templateSuccessModal).not.toContain('Public link pending');
		expect(templateSuccessModal).not.toContain('Share link');
		expect(templateSuccessModal).not.toContain('Link copied');
		expect(templateSuccessModal).not.toContain('Copy link');
		expect(templateSuccessModal).not.toContain('bg-gradient-to-br');
		expect(templateApiRoute).toContain('sources: existingByContent.sources ?? []');
		expect(templateApiRoute).toContain('research_log: existingByContent.researchLog ?? []');
		expect(templateApiRoute).toContain('sources: newTemplate.sources ?? []');
		expect(templateApiRoute).toContain('research_log: newTemplate.researchLog ?? []');
		expect(templateModal).toContain('Share action page');
		expect(templateModal).toContain('Copy action page message');
		expect(templateModal).toContain('Action page URL');
		expect(templateModal).toContain('Copy action page');
		expect(templateModal).toContain('people confirming routes');
		expect(templateModal).toContain('already confirmed');
		expect(templateModal).toContain('Open the action page to confirm your route');
		expect(templateModal).toContain('I confirmed my route on this action page.');
		expect(templateModal).toContain('readers confirmed');
		expect(templateModal).toContain('confirm your route: ${shareUrl}');
		expect(templateModal).not.toContain('Share template');
		expect(templateModal).not.toContain('Copy share message');
		expect(templateModal).not.toContain('Share link');
		expect(templateModal).not.toContain('Copy URL');
		expect(templateModal).not.toContain('people already sent');
		expect(templateModal).not.toContain('I sent this.');
		expect(templateModal).not.toContain('people acted.');
		expect(templateModal).not.toContain('Takes 2 minutes');
		expect(shareMessages).toContain('an action page to confirm routes');
		expect(shareMessages).toContain('Each reader reviews the message, confirms their route');
		expect(shareMessages).toContain('I confirmed my route to ${recipients}');
		expect(shareMessages).toContain('reports route handoff, invites others');
		expect(shareMessages).not.toContain('Takes 2 minutes');
		expect(shareMessages).not.toContain('I reached out');
		expect(shareMessages).not.toContain('The more people who send it');
		expect(publicActionPage).toContain('readers confirming routes');
		expect(publicActionPage).toContain('readers have confirmed routes');
		expect(publicActionPage).toContain('routes confirmed');
		expect(publicActionPage).toContain('Confirm your route on Commons');
		expect(publicActionPage).toContain(
			'Contextual share message shifts from action-page invitation to route-handoff evidence.'
		);
		expect(publicActionPage).not.toContain('people have taken action');
		expect(publicActionPage).not.toContain('const sent = template.send_count');
		expect(publicActionPage).not.toContain('acted on this');
		expect(publicActionPage).not.toContain('Join the movement');
		expect(publicActionOgImage).toContain('routes confirmed');
		expect(publicActionOgImage).toContain('Confirm your route');
		expect(publicActionOgImage).not.toContain('people took action');
		expect(publicActionOgImage).not.toContain('Join the movement');
		expect(onboardingContent).toContain('routes confirmed on this action page');
		expect(onboardingContent).toContain('Review route');
		expect(onboardingContent).toContain('Confirm your route');
		expect(onboardingContent).toContain('Proof waits for route completion');
		expect(onboardingContent).toContain('confirmed</span>');
		expect(onboardingContent).not.toContain('people have sent this template');
		expect(onboardingContent).not.toContain('Your message is sent');
		expect(onboardingContent).not.toContain("cta: 'Send your message'");
		expect(onboardingContent).not.toContain('sent</span>');
		expect(onboardingContent).not.toContain('Receipt added to the public record');
		expect(hypergraph).toContain('export type MessageGenerationEvidenceRowKey');
		expect(hypergraph).toContain("| 'intent-input'");
		expect(hypergraph).toContain("| 'target-basis'");
		expect(hypergraph).toContain("| 'stream-phase'");
		expect(hypergraph).toContain("| 'delivery-handoff'");
		expect(hypergraph).toContain('export type MessageGenerationEvidencePhase');
		expect(hypergraph).toContain('export function buildMessageGenerationEvidence');
		expect(hypergraph).toContain('evaluatedSourceCount?: number;');
		expect(hypergraph).toContain('searchOnlySourceCount?: number;');
		expect(hypergraph).toContain('sourceEvidenceObserved?: boolean;');
		expect(hypergraph).toContain('const sourceCountKnown = sourceCount > 0 || sourceEvidenceObserved || phase ===');
		expect(hypergraph).toContain('const sourceHasOnlySearchFallback =');
		expect(hypergraph).toContain('Evaluation fallback remains search-only source ground.');
		expect(hypergraph).toContain('do not treat them as evaluated source evidence');
		expect(hypergraph).toContain("'stream-message source-evidence'");
		expect(hypergraph).toContain('sourceEvidenceObserved: boolean;');
		expect(hypergraph).toContain("sourceEvidenceMode: 'discovery' | 'preverified' | null;");
		expect(hypergraph).toContain('processEvidence.sourceEvidenceObserved');
		expect(hypergraph).toContain("'stream-message source-evidence via orgOS studioProcessEvidence'");
		expect(hypergraph).toContain(
			'Source evidence has not emitted yet; source counts remain unclaimed'
		);
		expect(hypergraph).toContain('action: string;');
		expect(hypergraph).toContain('effect: string;');
		expect(hypergraph).toContain("label: 'Intent input'");
		expect(hypergraph).toContain("label: 'Target basis'");
		expect(hypergraph).toContain("label: 'Stream phase'");
		expect(hypergraph).toContain("label: 'Delivery handoff'");
		expect(hypergraph).toContain("action: 'read intent'");
		expect(hypergraph).toContain("action: 'read target basis'");
		expect(hypergraph).toContain("action: 'read stream phase'");
		expect(hypergraph).toContain("action: paragraphCount > 0 ? 'edit authored artifact'");
		expect(hypergraph).toContain(
			"action: paragraphCount > 0 ? 'publish public action template'"
		);
		expect(hypergraph).toContain("action: hasRecoveryJob ? 'recover artifact'");
		expect(hypergraph).toContain('stream-message phase SSE');
		expect(hypergraph).toContain('authoring stream phase event');
		expect(hypergraph).toContain('AUTHOR is not a substitute for RESOLVE');
		expect(hypergraph).toContain('Authored artifact is editable and recoverable');
		expect(hypergraph).toContain(
			'public action template; delivery side effects remain delivery-surface-owned'
		);
		expect(hypergraph).toContain('Public-template handoff can publish the action shell');
		expect(hypergraph).toContain('TemplateCreator public action publish');
		expect(hypergraph).toContain('messageProofGate.source');
		expect(hypergraph).toContain('stream-message research_log');
		expect(messageGenerationEvidenceSource).toContain(
			'Recovery is not retained; same-device recovery claims stay dependency-first until stream-message issues a recoverable job tuple.'
		);
		expect(messageGenerationEvidenceSource).not.toContain(
			'Recovery is unavailable until stream-message issues a recoverable job tuple.'
		);
		expect(messageResults).toContain("import { Artifact, Datum, Ratio } from '$lib/design'");
		expect(messageResults).toContain('buildMessageGenerationEvidence,');
		expect(messageResults).toContain('buildStudioDraftHandoffRows,');
		expect(messageResults).toContain('messageGenerationSpineRows,');
		expect(messageResults).toContain('type MessageGenerationEvidenceRow');
		expect(messageResults).toContain('type StudioDraftHandoffRow');
		expect(messageResults).toContain('operatorCapabilityActionLabel');
		expect(messageResults).toContain('operatorCapabilityStateRatioSegments');
		expect(messageResults).toContain('formatCapabilityClusters');
		expect(messageResults).toContain('activeMessageJob?: ActiveMessageJob | null');
		expect(messageResults).toContain('intentFieldCount?: number');
		expect(messageResults).toContain('targetCount?: number');
		expect(messageResults).toContain("const SOURCE_EVALUATION_FALLBACK_PREFIX = 'Evaluation unavailable'");
		expect(messageResults).toContain('const searchOnlySourceCount = $derived(');
		expect(messageResults).toContain('const evaluatedSourceCount = $derived(sources.length - searchOnlySourceCount)');
		expect(messageResults).not.toContain('const studioSourceHandoffState = $derived');
		expect(messageResults).not.toContain('const studioSourceHandoffAction = $derived');
		expect(messageResults).not.toContain('const studioSourceHandoffEffect = $derived');
		expect(messageResults).toContain("getGateEvidence('CP-message-proof-binding'");
		expect(messageResults).toContain('const evidenceSummary = $derived(');
		expect(messageResults).toContain('buildMessageGenerationEvidence({');
		expect(messageResults).toContain('sourceEvidenceObserved: true');
		expect(messageResults).toContain('intentFieldCount,');
		expect(messageResults).toContain('targetCount,');
		expect(messageResults).toContain("phase: 'complete'");
		expect(messageResults).toContain('paragraphCount: paragraphs.length');
		expect(messageResults).toContain('evaluatedSourceCount,');
		expect(messageResults).toContain('searchOnlySourceCount,');
		expect(messageResults).toContain('traceHandle,');
		expect(messageResults).toContain('messageProofGate');
		expect(messageResults).toContain(
			'const evidenceRows = $derived<MessageGenerationEvidenceRow[]>(evidenceSummary.rows)'
		);
		expect(messageResults).toContain(
			'const evidenceSpineRows = $derived(messageGenerationSpineRows(evidenceRows));'
		);
		expect(hypergraph).toContain("label: 'Recovery job'");
		expect(hypergraph).toContain("label: 'Trace handle'");
		expect(hypergraph).toContain("label: 'Proof binding'");
		expect(messageResults).toContain('aria-label="Authored artifact evidence"');
		expect(messageResults).toContain('aria-label="Authored artifact spine"');
		expect(messageResults).toContain('<Artifact padding="compact" class="message-artifact">');
		expect(messageResults).toContain('<Ratio segments={evidenceSegments} height={6} />');
		expect(messageResults).toContain('{#each evidenceSpineRows as row (row.key)}');
		expect(messageResults).toContain('class="evidence-spine-cell"');
		expect(messageResults).toContain('<span class="evidence-spine-label">{row.label}</span>');
		expect(messageResults).toContain('<span class="evidence-spine-ground">{row.ground}</span>');
		expect(messageResults).toContain(
			'<span class="evidence-spine-action">{actionLabel(row)}</span>'
		);
		expect(messageResults).toContain(".evidence-spine-cell[data-state='draft-only']");
		expect(messageResults).toContain(".evidence-row[data-state='draft-only']");
		expect(messageResults).toContain('{formatCapabilityClusters(row.clusters)}');
		expect(messageResults).toContain('operatorCapabilityStateLabel(evidenceSummary.state)');
		expect(hypergraph).toContain('stream-message traceId');
		expect(messageResults).toContain(
			'return operatorCapabilityActionLabel(row.state, row.action, { appendReadyArrow: true });'
		);
		expect(messageResults).toContain('<p class="evidence-row-effect">{row.effect}</p>');
		expect(messageResults).toContain('<span class="evidence-row-action">{actionLabel(row)}</span>');
		expect(messageResults).toContain('<Datum value={row.metric.value} cite={row.metric.cite} />');
		expect(messageResults).not.toContain('type EvidenceRow =');
		expect(messageResults).not.toContain('const proofBoundary = $derived');
		expect(messageResults).not.toContain('const evidenceRows = $derived<EvidenceRow[]>');
		expect(messageResults).not.toContain('rounded-lg border border-slate-200 bg-white shadow-sm');
		expect(hypergraph).toContain('export type StudioDraftHandoffDestination');
		expect(hypergraph).toContain('export type StudioDraftHandoffRow');
		expect(hypergraph).toContain('export function buildStudioDraftHandoffRows');
		expect(hypergraph).toContain("destination: StudioDraftHandoffDestination");
		expect(hypergraph).toContain("const publicAction = destination === 'public-action-template'");
		expect(hypergraph).toContain("label: 'Draft handoff'");
		expect(hypergraph).toContain("label: 'Target basis'");
		expect(hypergraph).toContain("label: 'Source basis'");
		expect(hypergraph).toContain("label: 'Scope basis'");
		expect(hypergraph).toContain('qualify search-only source ground');
		expect(hypergraph).toContain('do not imply evaluated citation support');
		expect(hypergraph).toContain(
			'search-only fallback remains bounded context, and ${sourceRouteBoundary}'
		);
		expect(hypergraph).toContain(
			'Public action handoff is live as a draft transfer; artifact proof binding remains bounded.'
		);
		expect(hypergraph).toContain(
			'Email composer handoff is live as a draft transfer; artifact proof binding remains bounded.'
		);
		expect(templateTypes).toContain('export interface TemplateDraftOrigin');
		expect(templateTypes).toContain("handoff: 'public-action-template';");
		expect(templateTypes).toContain('draftOrigin?: TemplateDraftOrigin | null;');
		expect(templateDraftStore).toContain('draftOrigin: data.content?.draftOrigin');
		expect(templateCreator).toContain('formData.content.draftOrigin = null;');
		expect(messageGenerationResolver).toContain('draftOrigin={formData.content.draftOrigin ?? null}');
		expect(messageGenerationResolver).toContain('formData.content.draftOrigin = null;');
		expect(messageResults).toContain('draftOrigin?: TemplateDraftOrigin | null');
		expect(messageResults).not.toContain('type StudioPublicActionHandoffRow');
		expect(messageResults).toContain(
			'const studioHandoffRows = $derived<StudioDraftHandoffRow[]>'
		);
		expect(messageResults).toContain('buildStudioDraftHandoffRows({');
		expect(messageResults).toContain("destination: 'public-action-template'");
		expect(messageResults).toContain('operatorCapabilityStateRatioSegments(studioHandoffStateCounts)');
		expect(messageResults).toContain('aria-label="Studio public action handoff contract"');
		expect(messageResults).toContain('<span class="studio-handoff-title">{studioDraftOrigin.label}</span>');
		expect(messageResults).toContain('evaluatedSourceCount,');
		expect(messageResults).toContain('searchOnlySourceCount,');
		expect(messageResults).toContain('scopeLabel: geographicScope ? formatScope(geographicScope) : null');
		expect(messageResults).toContain('draftEffect: studioDraftOrigin.effect');
		expect(authoringProcess).toContain("case 'job-complete'");
		expect(authoringProcess).toContain("case 'job-running'");
		expect(authoringProcess).toContain('await runMessage(os, id, intent, decisionMakers, signal)');
		const orgOS = source('src/lib/components/org/os/orgOS.svelte.ts');
		expect(orgOS).toContain("import { browser } from '$app/environment';");
		expect(orgOS).toContain('ResolutionStopReason,');
		expect(orgOS).toContain('StudioProcessEvidence');
		expect(orgOS).toContain('const STUDIO_PROCESS_STORAGE_VERSION = 1');
		expect(orgOS).toContain('const STUDIO_PROCESS_STORAGE_LIMIT = 12');
		expect(orgOS).toContain('const RESOLUTION_STOP_REASONS: ResolutionStopReason[] = [');
		expect(orgOS).toContain('function studioProcessStorageKey(base: string): string');
		expect(orgOS).toContain('function toStoredProcess(proc: OrgProcess): StoredOrgProcess');
		expect(orgOS).toContain('function restoreProcess(raw: Partial<StoredOrgProcess>');
		expect(orgOS).toContain('function asResolutionStopReason(value: unknown): ResolutionStopReason | null');
		expect(orgOS).toContain('function paragraphCount(message: string): number');
		expect(orgOS).toContain('function evaluatedSourceCount(sources: StudioSource[]): number');
		expect(orgOS).toContain("!source.credibility_rationale?.startsWith('Evaluation unavailable')");
		expect(orgOS).toContain('sourceEvidenceObserved: boolean;');
		expect(orgOS).toContain('sourceEvidenceEvaluatedCount: number;');
		expect(orgOS).toContain('sourceEvidenceSearchOnlyCount: number;');
		expect(orgOS).toContain("sourceEvidenceMode: 'discovery' | 'preverified' | null;");
		expect(orgOS).toContain('sourceEvidenceEvaluationFallback: boolean;');
		expect(orgOS).toContain('sourceEvidenceCandidateCount: number | null;');
		expect(orgOS).toContain('sourceEvidenceFailedCount: number | null;');
		expect(orgOS).toContain('sourceEvidenceSearchQueryCount: number | null;');
		expect(orgOS).toContain('resolutionStopReason: ResolutionStopReason | null;');
		expect(orgOS).toContain('resolutionStopDetail: string | null;');
		expect(orgOS).toContain('sourceEvidenceObserved: raw.sourceEvidenceObserved ?? false');
		expect(orgOS).toContain(
			'sourceEvidenceEvaluationFallback: raw.sourceEvidenceEvaluationFallback ?? false'
		);
		expect(orgOS).toContain('get studioProcessEvidence(): StudioProcessEvidence');
		expect(orgOS).toContain('const sourceEvidenceObserved = Boolean(focused?.sourceEvidenceObserved)');
		expect(orgOS).toContain('contactableTargetCount: focused?.decisionMakers.length ?? 0');
		expect(orgOS).toContain('droppedTargetCount: focused?.droppedEmailless ?? 0');
		expect(orgOS).toContain('resolutionStopReason: focused?.resolutionStopReason ?? null');
		expect(orgOS).toContain('resolutionStopDetail: focused?.resolutionStopDetail ?? null');
		expect(orgOS).toContain('const evaluatedSourcesFromRows = focused ? evaluatedSourceCount(focused.sources) : 0');
		expect(orgOS).toContain('evaluatedSourceCount: evaluatedSources');
		expect(orgOS).toContain('searchOnlySourceCount: searchOnlySources');
		expect(orgOS).toContain('sourceEvidenceCount: focused');
		expect(orgOS).toContain('sourceEvidenceMode: focused?.sourceEvidenceMode ?? null');
		expect(orgOS).toContain(
			'sourceEvidenceEvaluationFallback: focused?.sourceEvidenceEvaluationFallback ?? false'
		);
		expect(hypergraph).toContain('searchOnlySourceCount: number;');
		expect(hypergraph).toContain('sourceEvidenceEvaluationFallback: boolean;');
		expect(hypergraph).toContain('sourceEvidenceCandidateCount: number | null;');
		expect(hypergraph).toContain('sourceEvidenceFailedCount: number | null;');
		expect(hypergraph).toContain('sourceEvidenceSearchQueryCount: number | null;');
		expect(hypergraph).toContain('function studioSourceEvidenceAudit(');
		expect(hypergraph).toContain('Evaluation fallback is active');
		expect(hypergraph).toContain('search queries');
		expect(hypergraph).toContain('const sourceGroundSignal = processEvidence');
		expect(hypergraph).toContain('`${processEvidence.searchOnlySourceCount} search-only · eval fallback`');
		expect(hypergraph).toContain('`${processEvidence.evaluatedSourceCount} evaluated · ${processEvidence.searchOnlySourceCount} search-only`');
		expect(hypergraph).toContain("? '0 evaluated sources'");
		expect(hypergraph).toContain("label: 'search-only sources'");
		expect(hypergraph).toContain('they are not counted as evaluated source ground');
		expect(studio).toContain('const sourceEvidenceAudit = $derived(');
		expect(studio).toContain('evaluation fallback active');
		expect(studio).toContain('sourceEvidenceCandidateCount');
		expect(studio).toContain('sourceEvidenceFailedCount');
		expect(studio).toContain('sourceEvidenceSearchQueryCount');
		expect(hypergraph).toContain('Evaluation fallback remains search-only ground');
		expect(orgOS).toContain('messageParagraphCount: focused?.composedMessage');
		expect(orgOS).toContain('hasTraceHandle: Boolean(focused?.activeMessageJob?.traceId)');
		expect(orgOS).toContain('Restored after page refresh; live stream is no longer attached.');
		expect(orgOS).toContain('abort: null');
		expect(orgOS).toContain('restoredFromDevice: true');
		expect(orgOS).toContain('function loadStoredProcessRegistry');
		expect(orgOS).toContain('function saveStoredProcessRegistry');
		expect(orgOS).toContain('saveStoredProcessRegistry(baseRoute, processes, focusedProcessId)');
		expect(orgOS).toContain('restoredFromDevice: false');
		expect(orgOS).not.toContain('JSON.stringify(processes)');

		expect(studioDraftBridge).toContain('function cloneActiveMessageJob');
		expect(studioDraftBridge).toContain('function buildTemplateDraftOrigin');
		expect(studioDraftBridge).toContain("label: 'Public action draft from Studio'");
		expect(studioDraftBridge).toContain("sourceRef: 'saveStudioProcessAsTemplateDraft'");
		expect(studioDraftBridge).toContain('activeMessageJob: cloneActiveMessageJob(proc)');
		expect(studioDraftBridge).toContain('draftOrigin: buildTemplateDraftOrigin(proc)');
		expect(studioDraftBridge).toContain('messageJobId: proc.activeMessageJob?.jobId');
		expect(studioDraftBridge).toContain('messageInputHash: proc.activeMessageJob?.inputHash');
		expect(studioDraftBridge).toContain('messageJobStatus: proc.activeMessageJob?.status');
		expect(studioDraftBridge).toContain('messageTraceId: proc.activeMessageJob?.traceId');
		expect(studioDraftBridge).toContain('geographicScopeLabel: proc.geographicScopeLabel');
		expect(studioDraftBridge).toContain('const SOURCE_EVALUATION_FALLBACK_PREFIX');
		expect(studioDraftBridge).toContain('function evaluatedSourceCount(sources: Source[]): number');
		expect(studioDraftBridge).toContain('evaluatedSourceCount: evaluatedSources');
		expect(studioDraftBridge).toContain('searchOnlySourceCount: searchOnlySources');
		expect(studioDraftBridge).not.toContain('activeMessageJob: null');
		expect(orgEmailDraftStore).toContain('messageTraceId?: string');
		expect(orgEmailDraftStore).toContain('evaluatedSourceCount?: number');
		expect(orgEmailDraftStore).toContain('searchOnlySourceCount?: number');
		expect(orgEmailDraftStore).toContain('geographicScopeSource?: GeographicScopeSource');
		expect(orgEmailComposer).toContain('Studio provenance:');
		expect(orgEmailComposer).toContain('studioDraftRestored.metadata.messageTraceId.slice(0, 8)');
		expect(orgEmailComposer).toContain('studioDraftRestored.metadata.geographicScopeLabel');
		expect(orgEmailComposer).toContain('const studioDraftEvaluatedSourceCount = $derived');
		expect(orgEmailComposer).toContain('const studioDraftSearchOnlySourceCount = $derived');
		expect(orgEmailComposer).toContain('buildStudioDraftHandoffRows,');
		expect(orgEmailComposer).toContain('type StudioDraftHandoffRow');
		expect(orgEmailComposer).not.toContain('const studioDraftSourceAction = $derived');
		expect(orgEmailComposer).not.toContain('const studioDraftSourceEffect = $derived');
		expect(orgEmailComposer).not.toContain('type StudioHandoffRow');
		expect(orgEmailComposer).toContain("const messageProofGate = getGateEvidence('CP-message-proof-binding'");
		expect(orgEmailComposer).toContain(
			'const studioHandoffRows = $derived<StudioDraftHandoffRow[]>'
		);
		expect(orgEmailComposer).toContain('buildStudioDraftHandoffRows({');
		expect(orgEmailComposer).toContain("destination: 'email-composer'");
		expect(orgEmailComposer).toContain('{formatCapabilityClusters(row.clusters)}');
		expect(orgEmailComposer).toContain('operatorCapabilityStateRatioSegments(studioHandoffStateCounts)');
		expect(orgEmailComposer).toContain('aria-label="Studio email composer handoff contract"');
		expect(orgEmailComposer).toContain('Email composer draft from Studio');
		expect(hypergraph).toContain("label: 'Recovery handle'");
		expect(hypergraph).toContain("label: 'Trace handle'");
		expect(orgEmailComposer).toContain(
			'Studio supplied the subject and body; this composer now owns cohort selection, preview, and send confirmation.'
		);
		expect(hypergraph).toContain('Imported Studio output is a composer draft, not a sent email');
		expect(hypergraph).toContain('search-only fallback remains bounded context');
		expect(orgEmailComposer).toContain('evaluatedSourceCount: studioDraftEvaluatedSourceCount');
		expect(orgEmailComposer).toContain('orgEmailComposeDraft metadata.searchOnlySourceCount');
		expect(hypergraph).toContain('Recovery is same-device message-output recovery');
		expect(hypergraph).toContain('Trace handles are operator observability evidence');

		expect(layout).toContain(
			"const delegatedTraceGate = getGateEvidence('CP-agent-trace-observability'"
		);
		expect(layout).toContain('buildStudioScopeReadiness({');
		expect(layout).toContain('delegatedTraceGate');
		expect(layout).toContain('process: os.studioProcessEvidence');
			expect(capabilityMap).toContain('sendLoopGate');
		expect(capabilityMap).not.toContain('current weakest send gate');
		expect(capabilityMap).not.toContain('separate task evidence in the Send register');
		expect(capabilityMap).toContain('buildStudioAuthoringReadiness,');
		expect(capabilityMap).toContain('studioProcessEvidence?: StudioProcessEvidence | null');
		expect(capabilityMap).toContain('const studioAuthoringReadiness = $derived(');
		expect(capabilityMap).toContain('const studioAuthoringRows = $derived<StudioAuthoringReadinessRow[]>');
		expect(capabilityMap).toContain('process: studioProcessEvidence');
		expect(capabilityMap).toContain('id="capability-grounded-authoring"');
		expect(capabilityMap).toContain('Grounded authoring evidence');
		expect(capabilityMap).toContain('Where intent becomes an accountable authoring run');
		expect(capabilityMap).not.toContain('Where AI copy becomes an accountable run');
		expect(capabilityMap).toContain('Grounded authoring readiness matrix');
		expect(capabilityMap).toContain('...studioAuthoringRows.map((row) => row.state),');
		expect(capabilityMap).toContain("title: 'Grounded authoring loop'");
		expect(capabilityMap).toContain('metric: {');
		expect(capabilityMap).toContain('label: studioAuthoringReadiness.metric.label');
		expect(capabilityMap).toContain('value: studioAuthoringReadiness.metric.value');
		expect(capabilityMap).toContain("label: 'Run grounded authoring'");
		expect(capabilityMap).toContain('state: studioAuthoringReadiness.state');
		expect(capabilityMap).toContain('effect: studioAuthoringReadiness.effect');
		expect(capabilityMap).toContain('detail: studioAuthoringReadiness.detail');
		expect(capabilityMap).toContain("name: 'Studio authoring stream'");
		expect(capabilityMap).toContain("source: 'stream-decision-makers + stream-message'");
		expect(capabilityMap).toContain(
			"const delegatedTraceGate = getGateEvidence('CP-agent-trace-observability'"
		);
		expect(capabilityMap).toContain("name: 'Authoring trace replay'");
		expect(capabilityMap).toContain('agentTraces authoring trace endpoint');
		expect(capabilityMap).toContain('Studio activeMessageJob traceId; not loaded into this map');
		expect(capabilityMap).toContain(
			'Artifact recovery and process memory are device-local; server-side process persistence and proof-bound delegated action remain gated.'
		);
		expect(capabilityMap).not.toContain(
			'is the load-bearing send gate; email proxy, SMS dispatch, workflow effects, and congressional launch stay separate'
		);

		expect(canonicalDoc).toContain(
			'The Studio intent contract distinguishes ready input from emitted artifacts'
		);
		expect(canonicalDoc).toContain('authoring-aware readout');
		expect(canonicalDoc).toContain(
			'The Studio workspace header renders a `Datum`-backed authoring evidence strip from `studioHeaderMetrics`'
		);
		expect(canonicalDoc).toContain(
			'running loops, device-local process records, contactable targets, evaluated sources, and emitted paragraphs from the focused OS process'
		);
		expect(capabilityScope).toContain(
			'The mounted Studio header renders `studioHeaderMetrics` as a `Datum`-backed authoring evidence strip'
		);
		expect(capabilityScope).toContain(
			'running loops, device-local process records, contactable targets, evaluated sources, and emitted paragraphs cite the OS process registry and focused `stream-decision-makers` / `stream-message` run'
		);
		expect(capabilityScope).toContain('message_generation_runtime_not_configured');
		expect(capabilityScope).toContain('OrgSpacesData.operating.authoring');
			expect(canonicalDoc).toContain(
				'Studio Send labels reflect executable handoffs, not channel existence'
			);
			expect(canonicalDoc).toContain('Public action draft and email composer draft rows');
			expect(canonicalDoc).toContain(
				'Studio Send renders the same gate-backed action contract as the map'
			);
			expect(canonicalDoc).toContain(
				"their capability state is `draft-only`, not `live`, because the delivery surface still owns publish/send confirmation"
			);
			expect(canonicalDoc).toContain(
				'each button renders its own handoff-effect contract with phase/cluster, handoff object, effect, evidence source, gate, posture, and state-aware action'
			);
			expect(canonicalDoc).toContain(
				'The email composer draft borrows its nearest email-mode context from `buildSendReadiness`'
			);
			expect(canonicalDoc).toContain(
				'public action drafts stay a Studio-local handoff because they are not a delivery provider'
			);
			expect(canonicalDoc).toContain(
				'a `Ratio` state mix, cited draft/execution handoff counts, shared operator-state labels'
			);
		expect(canonicalDoc).toContain(
			'composed message, geographic scope, recoverable message-job handle, trace handle'
		);
		expect(canonicalDoc).toContain('draft-local `TemplateDraftOrigin` handoff envelope');
		expect(canonicalDoc).toContain('**Studio public action handoff contract**');
		expect(canonicalDoc).toContain('displays non-secret Studio provenance');
		expect(canonicalDoc).toContain(
			'Send-readiness and launch-pressure actions use channel-neutral route-effect grammar'
		);
		expect(canonicalDoc).toContain(
			'Do not use generic labels like `open sender`, `dependency only`, `inspect path`, `draft surface`, or `launch gate`.'
		);
		expect(canonicalDoc).toContain(
			'No contactable target is a hard stop before AUTHOR'
		);
		expect(canonicalDoc).toContain('Studio renders a run ledger from the focused OS process');
		expect(canonicalDoc).toContain(
			'Studio also renders a compact execution spine from the same process fields'
		);
		expect(canonicalDoc).toContain(
			'It is a recognition layer over emitted state, not a second pipeline model'
		);
		expect(canonicalDoc).toContain(
			'When an authored artifact exists, Studio renders an authored-output contract before the Artifact'
		);
		expect(canonicalDoc).toContain('**Authored artifact posture** rail');
		expect(canonicalDoc).toContain(
			'the compact `messageGenerationSpineRows` readout'
		);
		expect(canonicalDoc).toContain(
			'Studio no longer owns parallel Artifact ground / Audience basis / Grounding basis / Scope basis copy'
		);
		expect(canonicalDoc).toContain(
			'the detailed rows include intent, target, stream phase, artifact, source basis, research trace, delivery handoff, recovery job, trace handle, and proof binding'
		);
		expect(canonicalDoc).toContain(
			'the source row still preserves evaluated vs. search-only fallback counts from the focused OS process'
		);
		expect(canonicalDoc).toContain(
			'The shared recovery-job row reads `read recovery boundary`'
		);
		expect(canonicalDoc).toContain('bounded device-local ledger of emitted process records');
		expect(canonicalDoc).toContain(
			'Studio and the public template creator both consume `buildMessageGenerationEvidence`'
		);
			expect(canonicalDoc).toContain('consumes `buildMessageGenerationEvidence`');
			expect(canonicalDoc).toContain(
				'its **Authoring boundary** when the run closes before an artifact'
			);
			expect(canonicalDoc).toContain(
				'and its **Authored artifact evidence** rail beside authored output'
			);
			expect(canonicalDoc).toContain('compact **artifact spine** from `messageGenerationSpineRows`');
			expect(canonicalDoc).toContain(
				'intent input, target basis, source basis, artifact basis, and delivery handoff appear before the detailed matrix'
			);
		expect(canonicalDoc).toContain(
			'non-retryable runtime gaps render `context / read runtime boundary`'
		);
		expect(canonicalDoc).toContain('The public authoring resolver stays in INTENT/preparing');
		expect(capabilityScope).toContain(
			'Runtime preflight boundaries therefore remain provider/source/page-read boundaries'
		);
		expect(canonicalDoc).toContain(
			'the same state labels, `Ratio` mix, `Datum` citations, cluster labels, row action/effect contracts, state-aware `operatorCapabilityActionLabel`, and `formatGateEvidence` proof gate as the OS map'
		);
		expect(canonicalDoc).toContain(
			'Route-local action labels delegate to `operatorCapabilityActionLabel`'
		);
		expect(canonicalDoc).toContain(
			'Dependency boundaries speak in operator language (`held`, `not armed`, `dependency-first`) rather than implementation status'
		);
		expect(canonicalDoc).toContain(
			'`source-evidence` SSE advances the source-basis count only after the evaluator or preverified cache has produced countable source ground'
		);
		expect(canonicalDoc).toContain(
			'The public artifact now carries the same evaluated/search-only split'
		);
		expect(canonicalDoc).toContain(
			'A zero from that event renders as a real evaluated zero; absence of the event remains blank.'
		);
		expect(canonicalDoc).toContain('public-template publish handoff');
			expect(canonicalDoc).toContain(
				'The delivery-handoff row is `SEND`-phase evidence for a public action template'
			);
			expect(canonicalDoc).toContain(
				'the final creator CTA reads `publish public action template`'
			);
			expect(canonicalDoc).toContain(
				'send, dispatch, receipt proof, and proof-bound execution stay owned by delivery surfaces'
			);
			expect(canonicalDoc).toContain('row action/effect contracts');
		expect(canonicalDoc).toContain('state-aware `operatorCapabilityActionLabel`');
		expect(canonicalDoc).toContain(
			'in-flight SSE streams rehydrate as stopped/detached rather than still running'
		);
		expect(canonicalDoc).toContain(
			'not server-side durable process persistence or automatic stream reattachment'
		);
		expect(canonicalDoc).toContain('buildStudioAuthoringReadiness');
		expect(canonicalDoc).toContain(
			'shared readout for the operator-initiated authoring loop: intent input, model provider, source discovery, page-read evaluation, contactable decision-maker resolution, source grounding, artifact authoring, draft handoff, recovery envelope, trace replay, and delegated-action boundary'
		);
		expect(canonicalDoc).toContain(
			'model/source/page-read rows expose which authoring capabilities are connected, while target/source/artifact/handoff rows remain bounded until focused Studio process evidence emits'
		);
		expect(canonicalDoc).toContain(
			'Runtime-ready means the loop can start; it does not promote contactable targets, evaluated sources, authored paragraphs, or draft handoffs to live evidence before a run proves them.'
		);
		expect(canonicalDoc).toContain(
			'Grounded authoring evidence** matrix at `#capability-grounded-authoring`'
		);
		expect(canonicalDoc).toContain(
			'Its header renders `Datum`-backed authoring contract count plus armed/bounded/draft/not-armed mix from `studioAuthoringStateCounts` before the matrix'
		);
		expect(canonicalDoc).toContain(
			'Spotlight exposes Grounded authoring at `#studio-intent` through `buildStudioAuthoringReadiness`'
		);
		expect(canonicalDoc).toContain(
			'When a focused Studio run exists, the layout and Capability map pass `orgOS.studioProcessEvidence` into that readout'
		);
		expect(canonicalDoc).toContain(
			'current-run process count, contactable targets, dropped public-contact targets, typed resolution-stop reason, typed source-evidence posture, evaluated sources, search-only fallback sources, emitted paragraphs, draft handoffs, recovery-job status, trace-handle presence, and applied scope'
		);
		expect(canonicalDoc).toContain(
			'The process also records a typed resolution-stop reason: `no-public-email`'
		);
		expect(canonicalDoc).toContain(
			'contactable target count, dropped public-contact target count, resolution-stop reason'
		);
		expect(canonicalDoc).toContain(
			'That evidence remains device-local current-run evidence; it is not server-side process persistence'
		);
			expect(canonicalDoc).toContain(
				'Studio also distinguishes **authoring trace replay** from recovery'
			);
			expect(canonicalDoc).toContain(
				'Studio Send also receives the shared `buildSendReadiness` summary used by the Capability map and Spotlight'
			);
			expect(canonicalDoc).toContain(
				'if the operating email-delivery slice is unread, `buildSendReadiness` says browser-direct send readiness claims are uncounted'
			);
			expect(canonicalDoc).toContain(
				'held mode count, compact held-mode summary, browser-direct signal, first held mode, shared send boundary summary, and gate text come from the same object as `#capability-send`'
			);
			expect(canonicalDoc).toContain(
				'Its shared send-mode header renders a `Datum`-backed mode count plus armed/bounded/held split from `deliveryModeRows`, `deliveryModeStateCounts`, and `heldDeliveryModeCount` before the Ratio and row matrix.'
			);
			expect(canonicalDoc).toContain(
				'with state mix, SEND/AGGREGATE phase, canonical cluster label, handoff, action grammar, effect, metric, and gate'
			);
			expect(canonicalDoc).toContain('phase-labeled shared send-mode rows');
			expect(canonicalDoc).toContain(
				'The email delivery index and composer consume `buildSendReadiness`'
			);
			expect(canonicalDoc).toContain(
				'The index uses the layout operating email-delivery slice before the record list'
			);
			expect(canonicalDoc).toContain('Message-local checks still stay local: merge-token blocking');
			expect(canonicalDoc).toContain(
				'The claim-basis ledger also includes **Authoring trace replay** as a partial row'
			);
		expect(capabilityScope).toContain(
			'Studio now receives the `stream-message` `traceId` alongside the recoverable message job'
		);
		expect(capabilityScope).toContain('`orgOS.studioProcessEvidence` lifts only the focused');
		expect(capabilityScope).toContain(
			'dropped public-contact targets, typed resolution-stop posture, typed source-evidence posture, evaluation-fallback posture, candidate/search-query/failed-read audit counts, evaluated sources, search-only fallback sources, emitted paragraphs, draft handoffs'
		);
		expect(canonicalDoc).toContain(
			'evaluation-fallback posture plus source candidate, failed-read, and search-query audit counts'
		);
		expect(capabilityScope).toContain(
			'The OS process runner now consumes that same event for Studio process evidence'
		);
		expect(capabilityScope).toContain(
			'`buildStudioAuthoringReadiness` now splits that OS-level evidence into rows at `#capability-grounded-authoring`'
		);
		expect(capabilityScope).toContain(
			'Its header renders a `Datum`-backed authoring contract count plus armed/bounded/draft/not-armed mix from `studioAuthoringStateCounts` before the matrix'
		);
			expect(capabilityScope).toContain(
				'its **Authored artifact posture** rail is `messageGenerationSpineRows` for intent input'
			);
			expect(capabilityScope).toContain(
				'the detailed matrix renders the same stream-phase, research-trace, recovery-job, trace-handle, and proof-binding rows used by the public creator'
			);
			expect(capabilityScope).toContain(
				'intent input, model provider, source discovery, page-read evaluation, decision-maker resolve'
			);
		expect(capabilityScope).toContain('`buildMessageGenerationEvidence`');
		expect(capabilityScope).toContain(
			'The same evaluated/search-only split is carried through the public template creator'
		);
		expect(capabilityScope).toContain(
			'each local button now uses a handoff-effect posture line rather than generic reason labels'
		);
		expect(capabilityScope).toContain(
			'The shared mode header renders a `Datum`-backed mode count plus armed/bounded/held split from `deliveryModeRows`, `deliveryModeStateCounts`, and `heldDeliveryModeCount` before the Ratio and row matrix'
		);
		expect(capabilityScope).toContain(
			'intent input, selected target basis, a first-class `stream-phase` row, research steps, recovery job state, emitted paragraphs, evaluated source count, search-only fallback source count, trace handle, and artifact proof binding'
		);
		expect(capabilityScope).toContain('state-aware action/effect');
		expect(capabilityScope).toContain(
			'Source discovery, artifact authoring, completion, and same-device recovery are legible as phase evidence'
		);
		expect(capabilityScope).toContain(
			'source counts can advance only from the typed `source-evidence` event after evaluated/preverified source ground exists'
		);
		expect(capabilityScope).toContain(
			'A `source-evidence` zero is a real evaluated zero; no event remains unknown, not zero.'
		);
		expect(capabilityScope).toContain(
			'`stream-message` is treated as AUTHOR, not as a substitute for RESOLVE'
		);
		expect(capabilityScope).toContain('Delegated-agent trace observability remains gated');
	});

	it('keeps coalition aggregate stats wired and documented as live stats with bounded artifacts', () => {
		const publicStatsRoute = source('src/routes/api/v1/networks/[id]/stats/+server.ts');
		const orgReportRoute = source(
			'src/routes/api/org/[slug]/networks/[networkId]/report/+server.ts'
		);
		const networkIndex = source('src/routes/org/[slug]/networks/+page.svelte');
		const networkNew = source('src/routes/org/[slug]/networks/new/+page.svelte');
		const networkPage = source('src/routes/org/[slug]/networks/[networkId]/+page.svelte');
		const networkPageServer = source('src/routes/org/[slug]/networks/[networkId]/+page.server.ts');
		const coalitionReport = source('src/lib/components/networks/CoalitionReport.svelte');
		const convexNetworks = source('convex/networks.ts');
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const coalitionReadinessSource = section(
			hypergraph,
			'export type CoalitionReadinessRowKey',
			'export function buildFundraisingReadiness'
		);
		const capabilityMap = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const layout = source('src/routes/org/[slug]/+layout.svelte');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const implementationStatus = source('docs/implementation-status.md');

		expect(publicStatsRoute).toContain('api.networks.getStats');
		expect(publicStatsRoute).toContain('api.networks.checkMembership');
		expect(publicStatsRoute).not.toMatch(/501|not yet wired/i);

		expect(orgReportRoute).toContain('api.networks.get');
		expect(orgReportRoute).toContain('api.networks.getStats');
		expect(orgReportRoute).toContain('return json({ data: stats })');
		expect(networkPageServer).toContain('const stats = await serverQuery(api.networks.getStats');
		expect(networkPageServer).toContain(
			'const proofPressure = await serverQuery(api.networks.getProofPressure'
		);
		expect(networkPageServer).not.toContain('proofPressure is currently unwired');
		expect(networkPageServer).not.toContain('const proofPressure: Array');
		expect(convexNetworks).toContain('export const getProofPressure = query');
		expect(convexNetworks).toContain(".query('accountabilityReceipts')");
		expect(convexNetworks).toContain("withIndex('by_orgId'");
		expect(convexNetworks).toContain('verifiedActionEvidence');
		expect(convexNetworks).toContain('districtSignalCount');
		expect(convexNetworks).toContain('combinedProofWeight');
		expect(networkPageServer).toContain('stats');
		expect(networkPageServer).not.toContain('verifiedSupporters: 0');
		expect(networkPageServer).not.toContain('totalSupporters: 0');
		expect(networkPageServer).not.toContain('uniqueSupporters: 0');

		expect(networkIndex).toContain('WorkspaceCapabilityStrip');
			expect(networkIndex).toContain('Coalition layer capability');
			expect(networkIndex).toContain('<title>Coalition layer | {data.org.name}</title>');
			expect(networkIndex).toContain('buildCoalitionReadiness,');
			expect(networkIndex).toContain('formatGateEvidence,');
			expect(networkIndex).toContain('operatorCapabilityActionLabel,');
			expect(networkIndex).toContain('operatorCapabilityStateLabel');
			expect(networkIndex).toContain("import { Datum } from '$lib/design';");
			expect(networkIndex).toContain('type CoalitionReadinessRow');
			expect(networkIndex).toContain('type CoalitionPressureReadout = {');
			expect(networkIndex).toContain('const coalitionReadiness = $derived(');
			expect(networkIndex).toContain('buildCoalitionReadiness({');
			expect(networkIndex).toContain('activeNetworkCount: activeNetworks.length');
			expect(networkIndex).toContain('pendingInviteCount: pendingNetworks.length');
		expect(networkIndex).toContain('activeMemberRows,');
		expect(networkIndex).toContain('topActiveNetworkId: activeNetworks[0]?.id ?? null');
		expect(networkIndex).toContain('const coalitionRows = $derived<CoalitionReadinessRow[]>');
		expect(networkIndex).toContain('coalitionReadiness.rows.map((row) => ({');
		expect(networkIndex).toContain("row.id === 'network-memberships'");
		expect(networkIndex).toContain("row.id === 'invite-response-queue'");
		expect(networkIndex).toContain("row.id === 'member-roster-aggregate'");
		expect(networkIndex).toContain("row.id === 'cross-border-routing'");
		expect(networkIndex).toContain("row.id === 'durable-coalition-artifact'");
		expect(networkIndex).toContain('coalitionRows.map((row) => ({');
		expect(networkIndex).toContain('label: row.label');
		expect(networkIndex).toContain('cluster: row.clusters');
			expect(networkIndex).toContain('detail: row.ground');
			expect(networkIndex).toContain('unlock: row.boundary');
			expect(networkIndex).toContain('const aggregateProofCoalitionRow = $derived');
			expect(networkIndex).toContain('const heldCoalitionRows = $derived');
			expect(networkIndex).toContain('const firstHeldCoalitionRow = $derived');
			expect(networkIndex).toContain(
				'const coalitionPressureReadouts = $derived<CoalitionPressureReadout[]>(['
			);
			expect(networkIndex).toContain("id: 'membership-ground'");
			expect(networkIndex).toContain("id: 'proof-handoff'");
			expect(networkIndex).toContain("id: 'next-coalition-lift'");
			expect(networkIndex).toContain("label: 'Membership ground'");
			expect(networkIndex).toContain("label: 'Proof handoff'");
			expect(networkIndex).toContain("label: 'Next coalition lift'");
			expect(networkIndex).toContain('coalitionReadiness.signal');
			expect(networkIndex).toContain('aggregateProofCoalitionRow?.boundary');
			expect(networkIndex).toContain('firstHeldCoalitionRow?.boundary');
			expect(networkIndex).toContain('aria-label="Coalition composition pressure"');
			expect(networkIndex).toContain(
				'{#each coalitionPressureReadouts as readout (readout.id)}'
			);
			expect(networkIndex).toContain(
				'<Datum value={readout.metric.value} cite={readout.metric.cite} />'
			);
			expect(networkIndex).toContain('actionLabel(readout.state, readout.action)');
			expect(networkIndex).toContain(
				'operatorCapabilityActionLabel(state, action, { appendReadyArrow: true })'
			);
			expect(networkIndex).toContain('function pressureCellClass(state: CapabilityState): string');
			expect(networkIndex).not.toContain("label: 'Creation authority'");
			expect(networkIndex).not.toContain('formatGateEvidence(coalitionStatsGate');
			expect(networkIndex).not.toContain('formatGateEvidence(crossBorderCoalitionGate');
			expect(networkIndex).not.toContain('formatGateEvidence(coalitionArtifactGate');
		expect(networkIndex).toContain('activeNetworks.length');
		expect(networkIndex).toContain('pendingNetworks.length');
		expect(networkIndex).toContain('{#if data.canCreate}');
		expect(coalitionReadinessSource).toContain('networks.list active memberships');
		expect(coalitionReadinessSource).toContain('networks.list pending memberships');
		expect(networkIndex).toContain('CP-coalition-aggregate-stats');
		expect(networkIndex).toContain('CP-cross-border-coalition');
		expect(networkIndex).toContain('CP-coalition-artifact');
		expect(networkIndex).toContain('id="network-memberships"');
		expect(networkIndex).toContain('id="network-invites"');
		expect(networkIndex).toContain('id="coalition-creation-boundary"');
		expect(networkIndex).toContain('id="coalition-routing-boundary"');
		expect(networkIndex).toContain('id="coalition-artifact-boundary"');
			expect(networkIndex).toContain('Create coalition network');
			expect(networkIndex).not.toContain('<title>Networks |');
			expect(networkIndex).not.toContain('Create Network');
			expect(canonicalDoc).toContain(
				'The network index opens with route-local **Coalition composition pressure** cells for Membership ground, Proof handoff, and Next coalition lift'
			);
			expect(capabilityScope).toContain(
				'The coalition index now opens with route-local **Coalition composition pressure** cells for Membership ground, Proof handoff, and Next coalition lift'
			);

			expect(networkNew).toContain('WorkspaceCapabilityStrip');
		expect(networkNew).toContain('Coalition creation capability');
		expect(networkNew).toContain('<title>Create coalition network | {data.org.name}</title>');
		expect(networkNew).toContain('buildCoalitionReadiness,');
		expect(networkNew).toContain('type CoalitionReadinessRow');
		expect(networkNew).toContain('const draftNetworkCount = $derived(');
		expect(networkNew).toContain('const coalitionReadiness = $derived(');
		expect(networkNew).toContain('buildCoalitionReadiness({');
		expect(networkNew).toContain("context: 'creation'");
		expect(networkNew).toContain('activeNetworkCount: 0');
		expect(networkNew).toContain('pendingInviteCount: 0');
		expect(networkNew).toContain('activeMemberRows: 0');
		expect(networkNew).toContain('topActiveNetworkId: null');
		expect(networkNew).toContain('draftNetworkCount,');
		expect(networkNew).toContain('creationAuthority: true');
		expect(networkNew).toContain('const coalitionRows = $derived<CoalitionReadinessRow[]>');
		expect(networkNew).toContain('coalitionReadiness.rows');
		expect(networkNew).toContain('coalitionRows.map((row) => ({');
		expect(networkNew).toContain('label: row.label');
		expect(networkNew).toContain('cluster: row.clusters');
		expect(networkNew).toContain('detail: row.ground');
		expect(networkNew).toContain('unlock: row.boundary');
		expect(networkNew).toContain("'network-memberships': '#coalition-definition'");
		expect(networkNew).toContain("'invite-response-queue': '#coalition-authority'");
		expect(networkNew).toContain("'member-roster-aggregate': '#coalition-member-path'");
		expect(networkNew).toContain("'aggregate-proof-detail': '#coalition-member-path'");
		expect(networkNew).toContain("'cross-border-routing': '#coalition-member-path'");
		expect(networkNew).toContain("'durable-coalition-artifact': '#coalition-artifact-boundary'");
		expect(hypergraph).toContain(
			"label: creationContext ? 'Coalition record definition' : 'Network memberships'"
		);
		expect(hypergraph).toContain(
			"label: creationContext ? 'Creation authority' : 'Invite response queue'"
		);
		expect(hypergraph).toContain(
			"label: creationContext ? 'Member proof path' : 'Member roster aggregate'"
		);
		expect(hypergraph).toContain(
			"label: creationContext ? 'Aggregate proof handoff' : 'Aggregate proof detail'"
		);
		expect(hypergraph).toContain("context?: 'index' | 'creation' | 'detail'");
		expect(networkNew).toContain('coalition subscription and owner-role gates');
		expect(networkNew).not.toContain('Coalition plan plus owner role');
		expect(networkNew).toContain('CP-coalition-aggregate-stats');
		expect(networkNew).toContain('CP-cross-border-coalition');
		expect(networkNew).toContain('CP-coalition-artifact');
		expect(networkNew).toContain('id="coalition-authority"');
		expect(networkNew).toContain('id="coalition-member-path"');
		expect(networkNew).toContain('id="coalition-definition"');
		expect(networkNew).toContain('id="coalition-artifact-boundary"');
		expect(networkNew).toContain('const networkId = result?.data?.id');
		expect(networkNew).toContain('Create coalition network');
		expect(networkNew).not.toContain("label: 'Coalition record definition'");
		expect(networkNew).not.toContain("label: 'Creation authority'");
		expect(networkNew).not.toContain("label: 'Member proof path'");
		expect(networkNew).not.toContain("label: 'Durable coalition artifact'");
		expect(networkNew).not.toContain('formatGateEvidence(coalitionStatsGate');
		expect(networkNew).not.toContain('formatGateEvidence(crossBorderCoalitionGate');
		expect(networkNew).not.toContain('formatGateEvidence(coalitionArtifactGate');
		expect(networkNew).not.toContain('<title>Create Network');
		expect(networkNew).not.toContain('networks/${result.id}');

		expect(networkPage).toContain('WorkspaceCapabilityStrip');
		expect(networkPage).toContain('Coalition proof capability');
		expect(networkPage).toContain('buildCoalitionReadiness,');
		expect(networkPage).toContain('type CoalitionReadinessRow');
		expect(networkPage).toContain('const coalitionStatsGate = getGateEvidence');
		expect(networkPage).toContain('CP-coalition-aggregate-stats');
		expect(networkPage).toContain('const proofPressureGate = getGateEvidence');
		expect(networkPage).toContain('CP-coalition-proof-pressure');
		expect(networkPage).toContain('const coalitionArtifactGate = getGateEvidence');
		expect(networkPage).toContain('CP-coalition-artifact');
		expect(networkPage).toContain('const coalitionReadiness = $derived(');
		expect(networkPage).toContain('buildCoalitionReadiness({');
		expect(networkPage).toContain('activeNetworkCount: 1');
		expect(networkPage).toContain('pendingInviteCount: pendingMembers.length');
		expect(networkPage).toContain('activeMemberRows: activeMembers.length');
		expect(networkPage).toContain('topActiveNetworkId: data.network.id');
		expect(networkPage).toContain('const coalitionRows = $derived<CoalitionReadinessRow[]>');
		expect(networkPage).toContain('coalitionReadiness.rows.map((row) => ({');
		expect(networkPage).toContain("row.id === 'network-memberships'");
		expect(networkPage).toContain("row.id === 'member-roster-aggregate'");
		expect(networkPage).toContain("row.id === 'aggregate-proof-detail'");
		expect(networkPage).toContain("row.id === 'cross-border-routing'");
		expect(networkPage).toContain("row.id === 'durable-coalition-artifact'");
		expect(networkPage).toContain('const proofPressureCapabilityItem = $derived<CapabilityItem>');
		expect(networkPage).toContain("label: 'Proof-pressure terrain'");
		expect(networkPage).toContain('coalitionRows.flatMap((row) => {');
		expect(networkPage).toContain('label: row.label');
		expect(networkPage).toContain('cluster: row.clusters');
		expect(networkPage).toContain('detail: row.ground');
		expect(networkPage).toContain('unlock: row.boundary');
		expect(networkPage).not.toContain("label: 'Active member roster'");
		expect(networkPage).not.toContain("label: 'Aggregate proof posture'");
		expect(networkPage).not.toContain("label: 'Durable coalition artifact'");
		expect(networkPage).not.toContain('formatGateEvidence(coalitionStatsGate');
		expect(networkPage).not.toContain('formatGateEvidence(crossBorderCoalitionGate');
		expect(networkPage).not.toContain('formatGateEvidence(coalitionArtifactGate');
		expect(networkPage).toContain(
			"action: data.proofPressure.length > 0 ? 'read pressure' : 'read proof-pressure boundary'"
		);
		expect(networkPage).not.toContain("action: 'read boundary'");
		expect(networkPage).toContain('id="coalition-proof-posture"');
		expect(networkPage).toContain('id="proof-pressure-boundary"');
		expect(networkPage).toContain('id="coalition-routing-boundary"');
		expect(networkPage).toContain('id="coalition-artifact-boundary"');
		expect(networkPage).toContain('id="network-members"');
		expect(networkPage).toContain('<Datum');
		expect(networkPage).toContain('value={data.stats.verifiedSupporters}');
		expect(networkPage).toContain('cite="networks.getStats verifiedSupporters"');
		expect(networkPage).toContain('verified people in active-member ledgers');
		expect(networkPage).toContain('Receipt-backed decision-maker pressure rows are visible');
		expect(networkPage).toContain('No receipt-backed decision-maker pressure rows are loaded');
		expect(networkPage).toContain('coalition totals are not converted into accountability-pressure claims');
		expect(networkPage).toContain('networks.getProofPressure');
		expect(networkPage).toContain('verifiedActionEvidence');
		expect(networkPage).toContain('districtSignalCount');
		expect(networkPage).toContain('Proof-pressure boundary');
		expect(networkPage).not.toContain('Decision-maker proof pressure is not wired');
		expect(networkPage).not.toContain('Proof-pressure terrain is not loaded');
		expect(networkPage).toContain('Cross-border routing boundary');
		expect(networkPage).toContain('Coalition artifact boundary');
		expect(networkPage).not.toContain('Cross-border coalition routing is not armed');
		expect(networkPage).not.toContain('Durable coalition artifact is not armed');
		expect(networkPage).toContain('People rows');
		expect(networkPage).toContain('networks/${data.network.id}/report');
		expect(networkPage).toContain('reportStatsOverride = body.data');
		expect(networkPage).toContain('let reportStatsOverride = $state<CoalitionStats | null>(null)');
		expect(networkPage).toContain(
			'const reportStats = $derived(reportStatsOverride ?? data.stats)'
		);
		expect(networkPage).toContain('Refresh coalition report');
		expect(networkPage).toContain('Failed to refresh report');
		expect(networkPage).toContain('verifiedCampaignActions');
		expect(networkPage).toContain('districtCount');
		expect(networkPage).not.toContain('Coalition Proof Power');
		expect(networkPage).not.toContain('verified supporters combined');
		expect(networkPage).not.toContain('Generate Coalition Report');
		expect(networkPage).not.toContain('totalVerifiedActions');
		expect(networkPage).not.toContain('uniqueDistricts');

		expect(coalitionReport).toContain('memberCount: number');
		expect(coalitionReport).toContain('verifiedCampaignActions: number');
		expect(coalitionReport).toContain('districtCount: number');
		expect(coalitionReport).toContain('Coordination Scalars');
		expect(coalitionReport).toContain('Country Distribution');
		expect(coalitionReport).not.toContain('tierDistribution');

		expect(capabilityMap).toContain('buildCoalitionReadiness,');
		expect(capabilityMap).toContain('type CoalitionReadinessRow');
		expect(capabilityMap).toContain('const coalitionReadiness = $derived(');
		expect(capabilityMap).toContain(
			'const coalitionRows = $derived<CoalitionReadinessRow[]>(coalitionReadiness.rows)'
		);
		expect(capabilityMap).toContain('id="capability-coalition"');
		expect(capabilityMap).toContain('Coalition composition posture');
		expect(capabilityMap).toContain('Where networks become shared proof ground');
		expect(capabilityMap).toContain('aria-label="Coalition composition pressure"');
		expect(capabilityMap).toContain('{#each coalitionPressureReadouts as readout (readout.id)}');
		expect(capabilityMap).toContain("label: 'Membership ground'");
		expect(capabilityMap).toContain("label: 'Proof handoff'");
		expect(capabilityMap).toContain("label: 'Next coalition lift'");
		expect(capabilityMap).not.toContain('Coalition membership never implies shared');
		expect(capabilityMap).toContain('Network detail routes own verified coalition action counts');
		expect(capabilityMap).not.toContain('partial-live');
		const coalitionPath = section(capabilityMap, "title: 'Coalition packet'", "id: 'PATH-4'");
		const coalitionShift = section(capabilityMap, "id: 'SHIFT-COALITION'", 'const claimBasis');
		for (const sourceText of [coalitionPath, coalitionShift]) {
			expect(sourceText).toContain('value: coalitionReadiness.metric.value');
			expect(sourceText).toContain('label: coalitionReadiness.metric.label');
			expect(sourceText).toContain('cite: coalitionReadiness.metric.cite');
			expect(sourceText).toContain('coalitionReadiness.gate');
			expect(sourceText).not.toContain('ret?.stats.campaigns');
			expect(sourceText).not.toContain("cite: 'organizations.getDashboard'");
			expect(sourceText).not.toContain("label: 'coalition aggregate loaded'");
		}
		expect(layout).toContain('const crossBorderCoalitionGate = getGateEvidence(');
		expect(layout).toContain("'CP-cross-border-coalition'");
		expect(layout).toContain('const coalitionStatsGate = getGateEvidence(');
		expect(layout).toContain("'CP-coalition-aggregate-stats'");
		expect(layout).toContain('const coalitionArtifactGate = getGateEvidence(');
		expect(layout).toContain("'CP-coalition-artifact'");
		expect(layout).toContain('const coalitionReadiness = $derived(');
		expect(layout).toContain('buildCoalitionReadiness({');
		expect(layout).toContain('signal: coalitionReadiness.signal');
		expect(layout).toContain('gate: coalitionReadiness.gate');
		expect(layout).not.toContain('const coalitionGroundSignal = $derived');
		expect(layout).not.toContain('const coalitionGroundGate = $derived');
		expect(layout).not.toContain("value: FEATURES.NETWORKS ? 'plan gated' : 'off'");
		expect(layout).not.toContain('data.spaces.return.stats.campaigns');
		const layoutCoalitionRoute = section(
			layout,
			"label: 'Coalition layer'",
			'const capabilityDestinations'
		);
		expect(layoutCoalitionRoute).toContain("sublabel: 'Network memberships + proof handoff'");
		expect(layoutCoalitionRoute).toContain('signal: coalitionReadiness.signal');
		expect(layoutCoalitionRoute).toContain('gate: coalitionReadiness.gate');
		expect(layoutCoalitionRoute).toContain('action: coalitionReadiness.action');
		expect(canonicalDoc).toContain(
			'The network report route owns live `networks.getStats` aggregate proof numbers'
		);
		expect(canonicalDoc).toContain(
			'the network detail route loads that same stats query before rendering its coalition proof posture'
		);
		expect(canonicalDoc).toContain(
			'The network index, creation route, and saved network detail route derive their local `WorkspaceCapabilityStrip` rows from `buildCoalitionReadiness`'
		);
		expect(canonicalDoc).toContain(
			'the creation route passes creation context, local draft-record state, route-proven creation authority, member proof path, aggregate proof handoff, and local anchors into that same row contract'
		);
		expect(canonicalDoc).toContain(
			'appends only the receipt-backed proof-pressure row from `networks.getProofPressure` to the shared strip'
		);
		expect(canonicalDoc).toContain(
			'The org OS layout loads no-PII membership posture from `networks.list` into `OrgSpacesData.operating.coalition`'
		);
		expect(capabilityScope).toContain(
			'`buildCoalitionReadiness` lifts network membership and creation posture into the Studio capability map, shell, and saved coalition route strips'
		);
		expect(capabilityScope).toContain(
			'The detail `WorkspaceCapabilityStrip` maps shared `buildCoalitionReadiness` rows to local proof, member, routing, and artifact anchors'
		);

		expect(capabilityScope).toContain('T7-1 coalition aggregate stats are no longer a 501');
		expect(capabilityScope).toContain(
			'Aggregate coalition proof stats are live through `convex/networks.getStats`'
		);
		expect(capabilityScope).toContain(
			'The network detail page loads `api.networks.getStats` server-side'
		);
		expect(capabilityScope).toContain(
			'Coalition aggregate stats are live through the network stats route'
		);
		expect(capabilityScope).toContain('durable coalition artifacts remain bounded');
		expect(capabilityScope).toContain(
			'Substrate chrome must point to membership/proof handoff plus cross-border gate evidence, not to org-local campaign counts'
		);
		expect(capabilityScope).not.toContain('networks (+ stats 501)');
		expect(capabilityScope).not.toContain('Coalition aggregation stats | 🟠 HTTP 501');
		expect(capabilityScope).not.toContain('Coalition aggregation 501');
		expect(capabilityScope).not.toContain('coalition aggregation 501');
		expect(capabilityScope).not.toContain(
			'src/routes/api/v1/networks/[id]/stats/+server.ts:37` returns HTTP 501'
		);

		expect(implementationStatus).toContain(
			'aggregate stats are live through Convex/public API/org report'
		);
		expect(implementationStatus).not.toContain('coalition aggregation stats return HTTP 501');
	});

	it('does not use action-record counts as delegated civic action evidence', () => {
		const capabilityMap = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');

		const delegatedPath = section(
			capabilityMap,
			"title: 'Delegated civic action'",
			'const partialCompositionPathCount'
		);

		expect(delegatedPath).toContain('value: null');
		expect(delegatedPath).toContain("label: 'delegated executions loaded'");
		expect(delegatedPath).toContain(
			"cite: 'delegation executor gate; no delegation slice in OrgSpacesData'"
		);
		expect(delegatedPath).toContain('weakestGate: weakestGate([');
		expect(delegatedPath).toContain('delegationGate,');
		expect(delegatedPath).toContain('messageProofGate,');
		expect(delegatedPath).toContain('studioJurisdictionScopeGate,');
		expect(delegatedPath).toContain('teeGate');
		expect(delegatedPath).not.toContain('ret?.stats.activeCampaigns');
		expect(delegatedPath).not.toContain("label: 'active action records'");
		expect(delegatedPath).not.toContain("cite: 'organizations.getDashboard'");
		expect(canonicalDoc).toContain('not reuse active action-record count as a proxy');
	});

	it('treats campaign debate threshold spawn as realized quality-trigger ground', () => {
		const capabilityMap = source('src/lib/components/org/os/CapabilityLandscape.svelte');
		const route = source('src/routes/api/campaigns/[id]/debate/+server.ts');
		const campaigns = source('convex/campaigns.ts');
		const debates = source('convex/debates.ts');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const transcendence = source('docs/strategy/capability-transcendence.md');
		const implementationStatus = source('docs/implementation-status.md');

		const qualityCard = section(
			capabilityMap,
			"title: 'Quality-triggered debate'",
			"cluster: 'C-accountability'"
		);
		const claimBasis = section(capabilityMap, 'const claimBasis', 'const visibleContractStates');

		expect(route).toContain('api.debates.forceSpawnDebateForCampaign');
		expect(route).not.toMatch(/501|campaign_debate_helper_unavailable|not yet wired/i);
		expect(campaigns).toContain('internal.debates.atomicSpawnIfEligible');
		expect(campaigns).toContain('(campaign?.verifiedActionCount ?? 0) + 1');
		expect(debates).toContain('export const atomicSpawnIfEligible = internalAction');
		expect(debates).toContain('export const forceSpawnDebateForCampaign = action');
		expect(debates).toContain('export const _spawnDebateIfEligible = internalMutation');
		expect(debates).toContain('export const _spawnDebateIfEligibleForce = internalMutation');

		expect(qualityCard).toContain(
			'Action records can store a debate threshold, and campaign debate creation is wired'
		);
		expect(qualityCard).toContain('href: `${base}/campaigns/new#quality-settlement`');
		expect(qualityCard).toContain(
			"action: FEATURES.DEBATE ? 'set debate threshold' : 'read debate boundary'"
		);
		expect(qualityCard).not.toContain("action: 'read quality boundary'");
		expect(qualityCard).toContain(
			'The new-action route exposes quality settlement at #quality-settlement'
		);
		expect(qualityCard).toContain('Verified-action thresholds schedule atomic debate spawn');
		expect(qualityCard).toContain('Quality-trigger plumbing is armed through T5-1');
		expect(qualityCard).toContain('nextGate: qualitySettlementGate');
		expect(claimBasis).toContain("name: 'Quality trigger'");
		expect(claimBasis).toContain('debateTriggerGate.state');
		expect(claimBasis).toContain('atomicSpawnIfEligible');
		expect(claimBasis).toContain('forceSpawnDebateForCampaign');

		expect(capabilityScope).toContain('T5-1 auto-debate-spawn is no longer a 501');
		expect(capabilityScope).toContain('campaign-linked debate route is no longer a 501');
		expect(capabilityScope).toContain('Verified action threshold crossing now schedules');
		expect(capabilityScope).toContain('market rows remain `pre_market`');
		expect(capabilityScope).not.toContain('| 9 | Auto-debate-spawn | 🟠 HTTP 501 |');
		expect(capabilityScope).not.toContain('Auto-debate-spawn 501');
		expect(capabilityScope).not.toContain('auto-spawn from campaign threshold is unimplemented');
		expect(transcendence).toContain(
			'Campaign threshold debate spawn and manual campaign debate creation are wired through T5-1'
		);
		expect(transcendence).not.toContain(
			'Auto-debate-spawn from campaign threshold (HTTP 501 today)'
		);
		expect(transcendence).not.toContain('Auto-debate-spawn from campaign threshold (501)');
		expect(canonicalDoc).toContain('T5-1 is the current example');
		expect(canonicalDoc).toContain(
			'campaign threshold debate spawn and manual campaign debate creation are armed quality-trigger ground'
		);
		expect(canonicalDoc).toContain(
			'**Quality-triggered debate** card routes to `/campaigns/new#quality-settlement`'
		);
		expect(canonicalDoc).toContain('uses the route-effect action **set debate threshold**');
		expect(implementationStatus).toContain('campaign threshold debate spawn (`T5-1`)');
	});

	it('fails closed for debate chain fallbacks instead of recording stubbed capability claims', () => {
		const chainGate = source('src/lib/server/debate-chain-gate.ts');
		const create = source('src/routes/api/debates/create/+server.ts');
		const argumentsRoute = source('src/routes/api/debates/[debateId]/arguments/+server.ts');
		const claim = source('src/routes/api/debates/[debateId]/claim/+server.ts');
		const resolve = source('src/routes/api/debates/[debateId]/resolve/+server.ts');
		const cosign = source('src/routes/api/debates/[debateId]/cosign/+server.ts');
		const commit = source('src/routes/api/debates/[debateId]/commit/+server.ts');
		const reveal = source('src/routes/api/debates/[debateId]/reveal/+server.ts');

		expect(chainGate).toContain('Debate create/argument/cosign/reveal/resolve/claim routes');
		for (const [routeName, routeSource] of [
			['debates/create', create],
			['debates/arguments', argumentsRoute],
			['debates/claim', claim],
			['debates/resolve', resolve],
			['debates/cosign', cosign],
			['debates/commit', commit],
			['debates/reveal', reveal]
		] as const) {
			expect(routeSource, routeName).toContain("allowChainMisconfig({ op: '");
			expect(routeSource, routeName).toContain(routeName);
		}

		expect(create).toContain("chainStatus: offchainOnly ? 'offchain_only' : 'onchain_proposed'");
		expect(argumentsRoute).toContain('let offchainOnly = false;');
		expect(argumentsRoute).toContain("chainStatus: offchainOnly");
		expect(argumentsRoute).toContain("verificationStatus: serverVerified ? 'verified' : 'pending'");
		expect(claim).toContain("status: 'claim_recorded'");
		expect(claim).toContain("chainStatus: 'offchain_recorded'");
		expect(claim).toContain('no payout or on-chain settlement was executed');
		expect(resolve).toContain("chainStatus: resolvedFromChain ? 'onchain_resolved' : 'offchain_resolved'");

		for (const routeSource of [create, argumentsRoute, claim, resolve]) {
			expect(routeSource).not.toMatch(/returning stub|off-chain stub|stub response/i);
		}
	});

	it('keeps the canonical launch blocker table focused on unresolved work', () => {
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');
		const topBlockers = section(
			capabilityScope,
			'## Top launch blockers (ordered)',
			'## Strategic implications'
		);

		expect(topBlockers).toMatch(/\|\s*1\s*\|\s*Direct platform sync foundation\s*\|/);
		expect(topBlockers).toMatch(/\|\s*2\s*\|\s*Text carrier dispatch\s*\|/);
		expect(topBlockers).toMatch(/\|\s*3\s*\|\s*Donation receipt compliance posture\s*\|/);
		expect(topBlockers).toMatch(/\|\s*4\s*\|\s*A\/B automated test\/remainder dispatch\s*\|/);
		expect(topBlockers).toMatch(/\|\s*5\s*\|\s*Human-readable district-label segmentation\s*\|/);
			expect(topBlockers).toMatch(/\|\s*6\s*\|\s*Workflow email dependency confidence\s*\|/);
			expect(topBlockers).toMatch(/\|\s*7\s*\|\s*Server-side email dispatch\s*\|/);
			expect(topBlockers).toMatch(/\|\s*8\s*\|\s*Consent-bound reach completion\s*\|/);
			expect(topBlockers).toMatch(/\|\s*9\s*\|\s*Reader-office notifications\s*\|/);
			expect(topBlockers).toMatch(/\|\s*10\s*\|\s*Durable proof settlement\s*\|/);
			expect(topBlockers).toMatch(/\|\s*11\s*\|\s*TEE-attested reasoning\s*\|/);
			expect(topBlockers).toMatch(/\|\s*12\s*\|\s*Proof-bound delegated action\s*\|/);
			expect(topBlockers).toContain('`buildPeopleSegmentationReadiness` now exposes');
			expect(topBlockers).toContain('`buildCoordinationReadiness` now lifts workflow definitions');
			expect(topBlockers).toContain('`buildEmailListHealthReadiness` now exposes');
		expect(topBlockers).not.toContain('| 5 | Campaign clone |');
		expect(topBlockers).not.toContain('OG images on org pages');
		expect(topBlockers).toContain('Closed since the prior launch-blocker list');
	});

	it('keeps local capability actions in route-effect language', () => {
		const capabilityActionSources = [
			'src/lib/components/org/OrgMantle.svelte',
			'src/lib/components/org/ScorecardDashboard.svelte',
			'src/lib/components/org/os/ReturnSpace.svelte',
			'src/lib/components/org/os/StudioSpace.svelte',
			'src/routes/org/[slug]/calls/+page.svelte',
			'src/routes/org/[slug]/campaigns/+page.svelte',
			'src/routes/org/[slug]/campaigns/[id]/report/+page.svelte',
			'src/routes/org/[slug]/emails/+page.svelte',
			'src/routes/org/[slug]/emails/compose/+page.svelte',
			'src/routes/org/[slug]/events/+page.svelte',
			'src/routes/org/[slug]/events/[id]/+page.svelte',
			'src/routes/org/[slug]/fundraising/+page.svelte',
			'src/routes/org/[slug]/fundraising/[id]/+page.svelte',
			'src/routes/org/[slug]/networks/[networkId]/+page.svelte',
			'src/routes/org/[slug]/representatives/+page.svelte',
			'src/routes/org/[slug]/settings/+page.svelte',
			'src/routes/org/[slug]/sms/+page.svelte',
			'src/routes/org/[slug]/sms/[id]/+page.svelte',
			'src/routes/org/[slug]/supporters/import/platform-api/+page.svelte',
			'src/routes/org/[slug]/workflows/+page.svelte',
			'src/routes/org/[slug]/workflows/[id]/+page.svelte'
		];
		const genericInspectAction = /action:\s*[\s\S]{0,180}['"`]inspect\b/i;

		for (const path of capabilityActionSources) {
			const text = source(path);
			expect(text, path).not.toMatch(genericInspectAction);
		}
	});

	it('turns manual bounce reports into consensus-backed reach suppression', () => {
		const email = source('convex/email.ts');
		const schema = source('convex/schema.ts');
		const reportEndpoint = source('src/routes/api/emails/report-bounce/+server.ts');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(email).toContain('const USER_BOUNCE_REPORT_THRESHOLD = 2;');
		expect(email).toContain('const USER_BOUNCE_REPORT_SCAN_LIMIT = 500;');
		expect(email).toContain('const getPendingBounceReportsRef = makeFunctionReference');
		expect(email).toContain('const suppressReportedBounceRef = makeFunctionReference');
		expect(schema).toContain(".index('by_resolved', ['resolved'])");
		expect(email).toContain(".withIndex('by_resolved', (q) => q.eq('resolved', false))");
		expect(email).toContain('reporterCount < USER_BOUNCE_REPORT_THRESHOLD');
		expect(email).toContain("source: 'user_report'");
		expect(email).toContain("suppressedBy: 'verified_user_report_consensus'");
		expect(email).toContain(
			".withIndex('by_globalEmailHash', (q) => q.eq('globalEmailHash', emailHash))"
		);
		expect(email).toContain("if (supporter.emailStatus === 'complained') continue;");
		expect(email).toContain("probeResult: 'suppressed_by_consensus'");
		expect(email).toContain("resolution: 'auto_resolved_stale'");
		expect(email).toContain(
			'return { processed, suppressed, staleResolved, groupsChecked: reportGroups.size };'
		);
		expect(email).not.toContain('return { processed: 0, suppressed: 0, staleResolved };');
		expect(reportEndpoint).toContain('Mirrors computeGlobalEmailHash in convex/_orgHash.ts');
		expect(reportEndpoint).toContain('encode(`email:${email.trim().toLowerCase()}`)');
		expect(capabilityScope).toContain(
			'manual bounce reports suppress after two independent verified reporters'
		);
	});

	it('documents closed geography, clone, and OG work without overclaiming district cohorts', () => {
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const implementationStatus = source('docs/implementation-status.md');

		expect(capabilityScope).toContain('postalCode` (equals/startsWith)');
		expect(capabilityScope).toContain('stateCode` (equals from imported state/province code)');
		expect(capabilityScope).toContain(
			'congressionalDistrict` (equals from imported readable label)'
		);
		expect(capabilityScope).toContain('country` (equals)');
		expect(capabilityScope).toContain('no local/special district membership filter exists yet');
		expect(capabilityScope).toContain('Clone/duplicate ships via `campaigns.clone`');
		expect(capabilityScope).toContain('org/segment/integrity pages now emit OG image/meta tags');
		expect(capabilityScope).toContain(
			'campaignParticipation` (participated/notParticipated via indexed action context)'
		);
		expect(capabilityScope).toContain('actionDistrict` can target action `districtHash`');
		expect(capabilityScope).toContain(
			'actionDistrictLabel` can target action-time readable congressional district labels'
		);

		expect(implementationStatus).toContain(
			'district labels beyond imported/action-time congressional cohorts and full local/special civic geography (`T1-8c`)'
		);
		expect(capabilityScope).toContain('Human-readable district-label segmentation');
		expect(canonicalDoc).toContain(
			'district labels beyond imported/action-time congressional cohorts and full local/special civic geography (`T1-8c`)'
		);
		expect(implementationStatus).toContain('A/B automated dispatch (`T1-6b`)');
		expect(implementationStatus).toContain('saved People segments as email recipient lists');
		expect(implementationStatus).toContain(
			'org/segment/integrity OG images, member role/removal authority, and'
		);
		expect(implementationStatus).not.toContain('campaign clone → district segmentation');
	});
});
