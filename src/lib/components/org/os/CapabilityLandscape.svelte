<!--
  CapabilityLandscape — an operational map of what Commons can do now, what is
  draft-only, and what unlocks the next capability level.

  It is deliberately inside STUDIO: authoring is the center of the org OS, and
  the map explains the substrate that surrounds every authored action. The data
  comes from the layout-loaded OrgSpacesData slices plus configured channel
  gates. No aspirational metric is rendered as a number.
-->
<script lang="ts">
	import { FEATURES } from '$lib/config/features';
	import {
		buildAccountabilityResponseReadiness,
		buildCallRoutingReadiness,
		buildCoalitionReadiness,
		buildCriticalPathRows,
		buildCoordinationReadiness,
		buildEmailListHealthReadiness,
		buildFundraisingReadiness,
		buildGateRegisterRows,
		buildLaunchPressureRows,
		buildLegislativeMonitoringReadiness,
		buildOperatingAuthorityReadiness,
		buildPeopleSegmentationReadiness,
		buildPeopleSourceProvenanceReadiness,
		buildPlatformIntakeReadiness,
		buildPowerTerrainReadiness,
		buildResultsProofReadiness,
		buildSendReadiness,
		buildStudioAuthoringReadiness,
		buildStudioScopeReadiness,
		buildTextDeliveryReadiness,
		formatGateEvidence,
		getDataHonestyEvidence,
		getGateEvidence,
		summarizeGateRegister,
		summarizeCriticalPath,
		type AccountabilityResponseReadinessRow,
		type CallRoutingReadinessRow,
		type CoalitionReadinessRow,
		type CriticalPathRow,
		type CoordinationReadinessRow,
		type EmailListHealthReadinessRow,
		type FundraisingReceiptProofRow,
		type FundraisingReadinessRow,
		type GateEvidence,
		type GateRegisterRow,
		type LaunchPressureRow,
		type LegislativeMonitoringReadinessRow,
		type OperatingAuthorityReadinessRow,
		type PeopleSegmentationReadinessRow,
		type PlatformApiProofRow,
		type PlatformIntakeProfileRow,
		type PlatformIntakeStageRow,
		type PowerTerrainRow,
		type ResultsProofRow,
		type SendReadinessMode,
		type StudioAuthoringReadinessRow,
		type StudioProcessEvidence,
		type TextCarrierProofRow,
		type TextDeliveryReadinessRow
	} from '$lib/data/capability-hypergraph';
	import {
		CAPABILITY_CLUSTER_IDS,
		CAPABILITY_CLUSTER_LABELS,
		formatCapabilityClusters,
		parseCapabilityClusterIds,
		type CapabilityClusterId
	} from '$lib/data/capability-clusters';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments,
		operatorCapabilityStateVerbLabel
	} from '$lib/data/capability-state-labels';
	import { Cite, Datum, Ratio, Rings, Pulse, RegistryMark } from '$lib/design';
	import { SPRINGS, TIMING, EASING } from '$lib/design/motion';
	import type { OrgSpacesData } from './spaces';

	type CapabilityState = 'live' | 'partial' | 'draft-only' | 'gated';
	type WorkspaceName = 'Studio' | 'People' | 'Power' | 'Results' | 'Substrate';
	type LandscapeScorecard = NonNullable<OrgSpacesData['landscape']>['scorecards'][number];
	type NullableScorecardMetric =
		| 'reportsOpened'
		| 'verifyLinksClicked'
		| 'repliesLogged'
		| 'alignedVotes'
		| 'relevantVotes';

	type CapabilityCard = {
		id: string;
		cluster: CapabilityClusterId;
		title: string;
		workspace: WorkspaceName;
		phase: string;
		state: CapabilityState;
		statement: string;
		evidence: string;
		href: string;
		action: string;
		handoff: string;
		effect: string;
		futureLift: string;
		honesty?: string;
		nextGate: GateEvidence;
		metric?: {
			label: string;
			value: number | null;
			cite: string;
		};
		visual?: 'verification-ratio' | 'packet-ratio' | 'rings' | 'pulse' | 'registry';
	};

	function sumKnownScorecardMetric(
		scorecards: LandscapeScorecard[] | null | undefined,
		key: NullableScorecardMetric
	): number | null {
		if (!scorecards) return null;
		let sum = 0;
		let hasKnown = false;
		for (const scorecard of scorecards) {
			const value = scorecard[key];
			if (value !== null) {
				sum += value;
				hasKnown = true;
			}
		}
		return hasKnown ? sum : null;
	}

	type HonestyRow = {
		name: string;
		state: CapabilityState;
		mark: string;
		evidence: string;
	};

	type LoopPhase = {
		id: 'INTENT' | 'GROUND' | 'AUTHOR' | 'RESOLVE' | 'SEND' | 'AGGREGATE';
		label: string;
		state: CapabilityState;
		workspace: WorkspaceName;
		clusters: string;
		href: string;
		summary: string;
		unlock: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type LoopPressureReadout = {
		id: 'armed-span' | 'first-held-phase' | 'aggregate-proof';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type CapabilityLatticeRow = {
		id: string;
		cluster: string;
		name: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		workspace: WorkspaceName;
		gate: GateEvidence;
		phases: Array<{
			id: LoopPhase['id'];
			label: string;
			state: CapabilityState | null;
		}>;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type ClusterEvidenceItem = {
		clusters: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		gate: string;
		source: string;
	};

	type ClusterCoverageRow = {
		id: CapabilityClusterId;
		label: string;
		state: CapabilityState;
		href: string;
		action: string;
		lead: string;
		gate: string;
		source: string;
		boundary: string;
		boundaryGate: string;
		boundarySource: string;
		total: number;
		live: number;
		partial: number;
		draftOnly: number;
		gated: number;
	};

	type ClusterBalanceReadout = {
		id: string;
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type QueuePressureReadout = {
		id: 'usable-moves' | 'held-verbs' | 'first-held';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type CriticalPathPressureReadout = {
		id: 'load-bearing-lift' | 'held-path' | 'grounded-substrate';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type GatePressureReadout = {
		id: 'open-gates' | 'load-bearing-gate' | 'completed-ground';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type SendPressureReadout = {
		id: 'usable-send' | 'held-send' | 'next-send-lift';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type PlatformProfilePressureReadout = {
		id: 'recognized-exports' | 'source-custody' | 'direct-sync-boundary';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type PowerTerrainPressureReadout = {
		id: 'loaded-terrain' | 'held-terrain' | 'next-terrain-lift';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type LegislativeMonitoringPressureReadout = {
		id: 'current-watch' | 'held-fanout' | 'next-monitoring-lift';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type CoalitionPressureReadout = {
		id: 'membership-ground' | 'proof-handoff' | 'next-coalition-lift';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type ResultsProofPressureReadout = {
		id: 'packet-ground' | 'receipt-evidence' | 'next-proof-lift';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type AccountabilityResponsePressureReadout = {
		id: 'response-ground' | 'reader-signals' | 'next-response-lift';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type FundraisingPressureReadout = {
		id: 'funding-ground' | 'confirmation-register' | 'next-receipt-lift';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type CoordinationPressureReadout = {
		id: 'definition-ground' | 'side-effect-runner' | 'next-run-lift';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type OperatingAuthorityPressureReadout = {
		id: 'authority-ground' | 'signed-substrate' | 'next-authority-lift';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type LaunchVectorReadout = {
		id: 'first-blocker' | 'largest-fanout' | 'held-contracts';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type StateContract = {
		state: CapabilityState;
		label: string;
		count: number;
		meaning: string;
		target: string;
		href: string;
		action: string;
		handoff: string;
		effect: string;
		gate: string;
		source: string;
	};

	type StateLedgerSource = {
		state: CapabilityState;
		target: string;
		href: string;
		action: string;
		handoff: string;
		effect: string;
		gate: string;
		source: string;
	};

	type ClaimBoundary = {
		id: string;
		label: string;
		state: CapabilityState;
		headline: string;
		claim: string;
		evidence: string;
		gate: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type ClaimPressureReadout = {
		id: 'claimable-ground' | 'qualified-ground' | 'blocked-claim';
		label: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type OperatingReadout = {
		id: string;
		label: string;
		state: CapabilityState;
		value: number | null;
		unit: string;
		cite: string;
		summary: string;
		gate: string;
		ground: string;
		nextLift: string;
		href: string;
		action: string;
		visual: 'loop-ratio' | 'send-ratio' | 'basis-ratio' | 'gate-ratio';
	};

	type OperatingSpineItem = {
		id: 'move-now' | 'qualify' | 'hold' | 'next-lift';
		label: string;
		state: CapabilityState;
		href: string;
		action: string;
		value: number | null;
		unit: string;
		cite: string;
		detail: string;
		gate: string;
	};

	type WorkspacePosture = {
		id: string;
		label: Exclude<WorkspaceName, 'Substrate'>;
		state: CapabilityState;
		href: string;
		action: string;
		signal: {
			value: number | null;
			label: string;
			cite: string;
		};
		summary: string;
		gate: string;
		ground: string;
		nextLift: string;
	};

	type CompositionStep = {
		phase: LoopPhase['id'];
		label: string;
		state: CapabilityState;
		handoff: string;
		effect: string;
		gate: string;
	};

	type CompositionPath = {
		id: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		sequence: string[];
		steps: CompositionStep[];
		workspaces: WorkspaceName[];
		clusters: string;
		promise: string;
		limit: string;
		weakestGate: GateEvidence;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
		visual: 'verification-ratio' | 'packet-ratio' | 'rings' | 'pulse';
	};

	type CompositionPressureReadout = {
		id: 'compound-ground' | 'held-phase' | 'next-compound-lift';
		label: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type OperatingPosture = {
		id: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
		visual: 'contract-ratio' | 'verification-ratio' | 'send-ratio' | 'packet-ratio';
	};

	type CapabilityShift = {
		id: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		from: string;
		to: string;
		evidence: string;
		gate: string;
		cluster: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
		visual:
			| 'contract-ratio'
			| 'verification-ratio'
			| 'send-ratio'
			| 'packet-ratio'
			| 'rings'
			| 'pulse';
	};

	type ShiftPressureReadout = {
		id: 'grounded-lift' | 'qualified-lift' | 'next-lift';
		label: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type OperatorQueueItem = {
		id: string;
		label: string;
		state: CapabilityState;
		href: string;
		action: string;
		handoff: string;
		effect: string;
		detail: string;
		gate: string;
		cluster: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type ClaimBasis = {
		id: string;
		name: string;
		state: CapabilityState;
		source: string;
		proof: string;
		gate: string;
		mark?: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type ClaimBasisPressureReadout = {
		id: 'evidence-basis' | 'first-honesty-gap' | 'runtime-boundary';
		label: string;
		title: string;
		state: CapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type RuntimeClaimBasisInput = {
		id: string;
		name: string;
		flagName: string;
		enabled: boolean;
		state: CapabilityState;
		currentGround: string;
		enabledBoundary: string;
		closedBoundary: string;
		gate?: GateEvidence;
		gateText?: string;
		gatePrefix?: string;
		gateComplete?: string;
	};

	type ClaimGrammarRow = {
		state: CapabilityState;
		label: string;
		verb: string;
		count: number;
		allowed: string;
		mustNot: string;
		gate: string;
	};

	let {
		spaces,
		base,
		canPublish,
		role,
		studioProcessEvidence = null
	}: {
		spaces: OrgSpacesData;
		base: string;
		canPublish: boolean;
		role: string;
		studioProcessEvidence?: StudioProcessEvidence | null;
	} = $props();

	const ret = $derived(spaces.return);
	const people = $derived(spaces.base);
	const power = $derived(spaces.landscape);
	const authoringRuntime = $derived(spaces.operating?.authoring ?? null);
	const emailDelivery = $derived(spaces.operating?.emailDelivery ?? null);
	const textDelivery = $derived(spaces.operating?.textDelivery ?? null);
	const callRouting = $derived(spaces.operating?.callRouting ?? null);
	const congressionalDelivery = $derived(spaces.operating?.congressionalDelivery ?? null);
	const fundraising = $derived(spaces.operating?.fundraising ?? null);
	const coordination = $derived(spaces.operating?.coordination ?? null);
	const coalition = $derived(spaces.operating?.coalition ?? null);
	const peopleSegmentation = $derived(people?.segmentation ?? null);
	const packet = $derived(ret?.packet ?? null);
	const campaignsHref = $derived(`${base}/campaigns`);
	const actionRecordsHref = $derived(`${base}#action-records`);
	const packetHref = $derived(
		ret?.topCampaignId
			? `${base}/campaigns/${ret.topCampaignId}/report#proof-preview`
			: `${base}#results-packet`
	);
	const resultsPacketHref = $derived(`${base}#results-packet`);
	const proofDeliveryHref = $derived(
		ret?.topCampaignId
			? `${base}/campaigns/${ret.topCampaignId}/report#proof-delivery`
			: actionRecordsHref
	);
	const emailBodyHref = $derived(`${base}/emails/compose#email-compose-body`);
	const emailDeliveryHref = $derived(`${base}/emails/compose#email-delivery`);
	const loadedOrgSlices = $derived([ret, people, power, spaces.operating]);
	const totalOrgSliceCount = $derived(loadedOrgSlices.length);
	const loadedSliceCount = $derived(loadedOrgSlices.filter(Boolean).length);
	const platformApiSync = $derived(spaces.operating?.platformApiSync ?? null);
	const eventRecordsGate = getGateEvidence('CP-outbound-webhooks', ['T9-3', 'T9-7', 'T6-9'], {
		name: 'Event records'
	});
	const eventArtifactGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-10'], {
		name: 'Event artifact survivability',
		downstream: 3,
		dependency: 'Receipt manifest archive + long-term proof pattern'
	});
	const platformApiGate = getGateEvidence('CP-platform-api-sync', ['T1-3'], {
		name: 'Direct platform sync',
		downstream: 1,
		dependency: 'Encrypted credential custody + direct sync execution'
	});
	const platformIntakeReadiness = $derived(
		buildPlatformIntakeReadiness({
			base,
			platformApiGate,
			platformApiSync
		})
	);
	const peopleSourceProvenanceReadiness = $derived(
		buildPeopleSourceProvenanceReadiness({
			base,
			sourceCounts: people?.sourceCounts ?? null,
			totalPeople: people?.total ?? null,
			platformApiGate
		})
	);
	const platformExportProfileCount = $derived(platformIntakeReadiness.profileCount);
	const platformProfileRows = $derived<PlatformIntakeProfileRow[]>(platformIntakeReadiness.rows);
	const platformIntakeStageRows = $derived<PlatformIntakeStageRow[]>(
		platformIntakeReadiness.stageRows
	);
	const platformApiProofRows = $derived<PlatformApiProofRow[]>(platformIntakeReadiness.proofRows);
	const platformProfileStateCounts = $derived(
		platformProfileRows.reduce(
			(counts, row) => {
				counts[row.csvState] += 1;
				counts[row.apiState] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const platformProfileCsvStateCounts = $derived(
		platformProfileRows.reduce(
			(counts, row) => {
				counts[row.csvState] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const platformProfileApiStateCounts = $derived(
		platformProfileRows.reduce(
			(counts, row) => {
				counts[row.apiState] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const heldPlatformProfileCsvCount = $derived(
		platformProfileCsvStateCounts['draft-only'] + platformProfileCsvStateCounts.gated
	);
	const heldPlatformProfileApiCount = $derived(
		platformProfileApiStateCounts['draft-only'] + platformProfileApiStateCounts.gated
	);
	const platformProfileSegments = $derived(
		operatorCapabilityStateRatioSegments(platformProfileStateCounts, {
			labelSuffix: ' source-custody contracts'
		})
	);
	const platformApiProofStateCounts = $derived(
		platformApiProofRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const platformApiProofSegments = $derived(
		operatorCapabilityStateRatioSegments(platformApiProofStateCounts, {
			labelSuffix: ' direct sync proof rows'
		})
	);
	const heldPlatformApiProofCount = $derived(
		platformApiProofStateCounts['draft-only'] + platformApiProofStateCounts.gated
	);
	const exportRecognitionStage = $derived(
		platformIntakeStageRows.find((row) => row.id === 'export-recognition') ?? null
	);
	const directPlatformSyncStage = $derived(
		platformIntakeStageRows.find((row) => row.id === 'direct-api-runner') ?? null
	);
	const platformProfilePressureReadouts = $derived<PlatformProfilePressureReadout[]>([
		{
			id: 'recognized-exports',
			label: 'Recognized exports',
			title: `${platformIntakeReadiness.csvContractCount}/${platformIntakeReadiness.profileCount} CSV contracts`,
			state: exportRecognitionStage?.state ?? platformIntakeReadiness.state,
			href: exportRecognitionStage?.href ?? `${base}/supporters/import#csv-intake`,
			action: exportRecognitionStage?.action ?? 'upload CSV export',
			detail:
				exportRecognitionStage?.effect ??
				`${platformIntakeReadiness.csvContractCount} CSV source-custody contracts preserve origin and header evidence across recognized exports.`,
			gate:
				exportRecognitionStage?.gate ?? 'Export-header recognition is armed for CSV export intake.',
			source: 'buildPlatformIntakeReadiness',
			metric: {
				value: platformIntakeReadiness.csvContractCount,
				label: 'CSV contracts',
				cite: 'PLATFORM_EXPORT_PROFILES.length'
			}
		},
		{
			id: 'source-custody',
			label: 'Source custody',
			title: peopleSourceProvenanceReadiness.signal,
			state: peopleSourceProvenanceReadiness.state,
			href: peopleSourceProvenanceReadiness.href,
			action: peopleSourceProvenanceReadiness.action,
			detail: peopleSourceProvenanceReadiness.detail,
			gate: peopleSourceProvenanceReadiness.gate,
			source: 'buildPeopleSourceProvenanceReadiness',
			metric: {
				value: peopleSourceProvenanceReadiness.platformProfilePeopleCount,
				label: 'profile-origin people',
				cite: 'supporters.getSummaryStats.sourceCounts'
			}
		},
		{
			id: 'direct-sync-boundary',
			label: 'Direct sync boundary',
			title: directPlatformSyncStage?.handoff ?? 'Direct sync execution',
			state: directPlatformSyncStage?.state ?? platformIntakeReadiness.state,
			href:
				directPlatformSyncStage?.href ??
				`${base}/supporters/import/platform-api#platform-sync-boundary`,
			action: directPlatformSyncStage?.action ?? 'read sync boundary',
			detail:
				directPlatformSyncStage?.effect ??
				`${platformIntakeReadiness.apiBoundaryCount} direct sync paths remain dependency-first.`,
			gate: directPlatformSyncStage?.gate ?? platformIntakeReadiness.gate,
			source: 'getPlatformApiSyncReadiness',
			metric: {
				value: platformIntakeReadiness.apiBoundaryCount,
				label: 'sync boundaries',
				cite: 'buildPlatformIntakeReadiness'
			}
		}
	]);
	const mainnetGate = getGateEvidence('CP-mainnet-deployment', ['T3-6', 'T5-5', 'T6-2', 'T6-1']);
	const teeGate = getGateEvidence('CP-tee-nitro-enclave', ['T5-3', 'T5-4']);
	const delegationGate = getGateEvidence('CP-delegation-executor', [
		'T4-2',
		'T4-1',
		'T4-8',
		'T4-9'
	]);
	const emailProxyGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Email send proxy',
		dependency: 'AWS Lambda deploy + BLAST receipts secret sync'
	});
	const listUnsubscribeGate = getGateEvidence('CP-list-unsubscribe', ['T2-4'], {
		name: 'List-Unsubscribe headers',
		downstream: 2,
		dependency: 'SES v2 Simple.Headers + per-recipient HMAC URL on the Convex path'
	});
	const listUnsubscribeProviderGate = getGateEvidence(
		'CP-list-unsubscribe-provider-rendering',
		['T2-4b'],
		{
			name: 'Mailbox unsubscribe rendering',
			downstream: 1,
			dependency: 'Production Gmail/Yahoo seed sends confirming one-click affordance rendering'
		}
	);
	const softBounceGate = getGateEvidence('CP-soft-bounce-categorization', ['T2-5'], {
		name: 'Soft-bounce suppression',
		downstream: 1,
		dependency: '3-strike transient bounce threshold + suppressedEmails TTL'
	});
	const customDomainGate = getGateEvidence('CP-custom-domain-dkim', ['T2-6'], {
		name: 'Sender domain authentication',
		downstream: 2,
		dependency: 'Per-org SES identity, DKIM, DMARC, and From-domain verification'
	});
	const auditLogGate = getGateEvidence('CP-audit-log', ['T9-5'], {
		name: 'Org audit log',
		downstream: 3,
		dependency: 'auditEvents table + mutation emitters + query/API surface'
	});
	const operatingAuthorityReadiness = $derived(
		buildOperatingAuthorityReadiness({
			base,
			authority: {
				role,
				canPublish,
				canInvite: canPublish,
				isOwner: role === 'owner',
				memberCount: ret?.stats.members ?? null,
				inviteCount: null,
				maxSeats: null,
				planName: null,
				planStatus: null,
				maxVerifiedActions: null,
				maxEmails: null,
				publicApiEnabled: FEATURES.PUBLIC_API,
				encryptionConfigured: emailDelivery?.orgKeyConfigured ?? null,
				registryEnvironment: 'Sepolia testnet'
			},
			gates: {
				eventRecordsGate,
				customDomainGate,
				mainnetGate,
				auditLogGate
			}
		})
	);
	const operatingAuthorityRows = $derived<OperatingAuthorityReadinessRow[]>(
		operatingAuthorityReadiness.rows
	);
	const operatingAuthorityStateCounts = $derived(
		operatingAuthorityRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const operatingAuthoritySegments = $derived(
		operatorCapabilityStateRatioSegments(operatingAuthorityStateCounts, {
			labelSuffix: ' authority contracts'
		})
	);
	const publishAuthorityRow = $derived(
		operatingAuthorityRows.find((row) => row.id === 'publish-authority') ?? null
	);
	const signedWebhookAuthorityRow = $derived(
		operatingAuthorityRows.find((row) => row.id === 'signed-webhooks') ?? null
	);
	const auditLogAuthorityRow = $derived(
		operatingAuthorityRows.find((row) => row.id === 'org-audit-log') ?? null
	);
	const heldOperatingAuthorityRows = $derived(
		operatingAuthorityRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const firstHeldOperatingAuthorityRow = $derived(heldOperatingAuthorityRows[0] ?? null);
	const nextAuthorityLiftRow = $derived(
		auditLogAuthorityRow && auditLogAuthorityRow.state !== 'live'
			? auditLogAuthorityRow
			: firstHeldOperatingAuthorityRow
	);
	const operatingAuthorityPressureReadouts = $derived<OperatingAuthorityPressureReadout[]>([
		{
			id: 'authority-ground',
			label: 'Authority ground',
			title: operatingAuthorityReadiness.signal,
			state: operatingAuthorityReadiness.state,
			href: operatingAuthorityReadiness.href,
			action: operatingAuthorityReadiness.action,
			detail: publishAuthorityRow?.ground ?? operatingAuthorityReadiness.detail,
			gate: gateSummary(operatingAuthorityReadiness.nextGate, {
				prefix: 'Operating authority stays bounded by the next unresolved authority lift.',
				complete: 'Operating authority has no unresolved authority lift.'
			}),
			source: operatingAuthorityReadiness.nextGate.source,
			metric: {
				value: operatingAuthorityReadiness.metric.value,
				label: operatingAuthorityReadiness.metric.label,
				cite: operatingAuthorityReadiness.metric.cite
			}
		},
		{
			id: 'signed-substrate',
			label: 'Signed substrate',
			title: signedWebhookAuthorityRow?.label ?? 'Signed webhooks',
			state: signedWebhookAuthorityRow?.state ?? operatingAuthorityReadiness.state,
			href: signedWebhookAuthorityRow?.href ?? operatingAuthorityReadiness.href,
			action: signedWebhookAuthorityRow?.action ?? operatingAuthorityReadiness.action,
			detail:
				signedWebhookAuthorityRow?.ground ??
				'No signed-event substrate row is loaded, so event delivery posture stays uncounted.',
			gate: signedWebhookAuthorityRow?.boundary ?? operatingAuthorityReadiness.gate,
			source: 'buildOperatingAuthorityReadiness',
			metric: {
				value: signedWebhookAuthorityRow?.metric.value ?? operatingAuthorityReadiness.metric.value,
				label: signedWebhookAuthorityRow?.metric.label ?? operatingAuthorityReadiness.metric.label,
				cite: signedWebhookAuthorityRow?.metric.cite ?? 'buildOperatingAuthorityReadiness'
			}
		},
		{
			id: 'next-authority-lift',
			label: 'Next authority lift',
			title: nextAuthorityLiftRow?.label ?? 'Authority boundary clear',
			state: nextAuthorityLiftRow?.state ?? 'live',
			href: nextAuthorityLiftRow?.href ?? operatingAuthorityReadiness.href,
			action: nextAuthorityLiftRow?.action ?? operatingAuthorityReadiness.action,
			detail:
				nextAuthorityLiftRow?.ground ??
				'No authority contract is currently blocking role, audit, API, custody, or registry ground.',
			gate: nextAuthorityLiftRow?.boundary ?? operatingAuthorityReadiness.gate,
			source: nextAuthorityLiftRow
				? 'buildOperatingAuthorityReadiness'
				: operatingAuthorityReadiness.nextGate.source,
			metric: {
				value: nextAuthorityLiftRow?.metric.value ?? operatingAuthorityReadiness.boundaryCount,
				label: nextAuthorityLiftRow?.metric.label ?? 'authority boundaries',
				cite: nextAuthorityLiftRow?.metric.cite ?? 'buildOperatingAuthorityReadiness'
			}
		}
	]);
	const smsDispatchGate = getGateEvidence('CP-sms-dispatch', ['T2-1'], {
		name: 'SMS dispatch',
		downstream: 2,
		dependency: 'Browser phone custody and Twilio dispatch runner'
	});
	const textDispatchArmed = $derived(
		textDelivery?.dispatchRuntimeReady === true && smsDispatchGate.state === 'live'
	);
	const textDispatchRouteReady = $derived(
		textDelivery?.dispatchClientBatchRouteMounted === true &&
			(textDelivery?.dispatchRuntimeMissing ?? []).filter(
				(item) => item !== 'browser phone custody'
			).length === 0
	);
	const textDispatchClaimState = $derived<CapabilityState>(
		textDispatchArmed ? 'live' : textDispatchRouteReady ? 'partial' : 'draft-only'
	);
	const smsReceiptAnchoringGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2'], {
		name: 'Text receipt anchoring',
		downstream: 4,
		dependency: 'SMS carrier evidence + receipt writer + mainnet anchoring'
	});
	const textReplyRegisterGate = getGateEvidence(
		'CP-reader-office-profile',
		['T8-1a', 'T8-1b', 'T8-8'],
		{
			name: 'Text reply workflow',
			downstream: 3,
			dependency: 'Reader-office profiles, office-response workflow, and notification webhooks'
		}
	);
	const abAutomationGate = getGateEvidence('CP-ab-automated-dispatch', ['T1-6b'], {
		name: 'A/B automated dispatch',
		downstream: 1,
		dependency: 'Idempotent test-cohort and winning-remainder send runner'
	});
	const civicGeographyLabelsGate = getGateEvidence('CP-civic-geography-labels', ['T1-8c'], {
		name: 'Civic geography labels',
		downstream: 1,
		dependency: 'Supporter civic-label materialization/backfill'
	});
	const abAutomationState = $derived<CapabilityState>(
		!FEATURES.AB_TESTING ? 'gated' : abAutomationGate.state === 'live' ? 'live' : 'draft-only'
	);
	const civicGeographyLabelsState = $derived<CapabilityState>(
		civicGeographyLabelsGate.state === 'live' ? 'live' : 'partial'
	);
	const peopleSegmentationReadiness = $derived(
		buildPeopleSegmentationReadiness({
			base,
			segmentation: {
				loaded: Boolean(peopleSegmentation),
				segmentCount: peopleSegmentation?.segmentCount ?? null,
				conditionCount: peopleSegmentation?.conditionCount ?? null,
				tagConditionCount: peopleSegmentation?.tagConditionCount ?? null,
				verificationConditionCount: peopleSegmentation?.verificationConditionCount ?? null,
				sourceConditionCount: peopleSegmentation?.sourceConditionCount ?? null,
				emailStatusConditionCount: peopleSegmentation?.emailStatusConditionCount ?? null,
				dateConditionCount: peopleSegmentation?.dateConditionCount ?? null,
				postalCountryConditionCount: peopleSegmentation?.postalCountryConditionCount ?? null,
				stateCodeConditionCount: peopleSegmentation?.stateCodeConditionCount ?? null,
				congressionalDistrictConditionCount:
					peopleSegmentation?.congressionalDistrictConditionCount ?? null,
				campaignParticipationConditionCount:
					peopleSegmentation?.campaignParticipationConditionCount ?? null,
				actionDistrictHashConditionCount:
					peopleSegmentation?.actionDistrictHashConditionCount ?? null,
				actionDistrictLabelConditionCount:
					peopleSegmentation?.actionDistrictLabelConditionCount ?? null,
				engagementTierConditionCount: peopleSegmentation?.engagementTierConditionCount ?? null,
				humanReadableGeographyConditionCount:
					peopleSegmentation?.humanReadableGeographyConditionCount ?? null
			},
			gates: {
				civicGeographyLabelsGate,
				platformApiGate
			}
		})
	);
	const peopleSegmentationRows = $derived<PeopleSegmentationReadinessRow[]>(
		peopleSegmentationReadiness.rows
	);
	const peopleSegmentationStateCounts = $derived(
		peopleSegmentationRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const peopleSegmentationSegments = $derived(
		operatorCapabilityStateRatioSegments(peopleSegmentationStateCounts, {
			labelSuffix: ' segment contracts'
		})
	);
	const heldPeopleSegmentationCount = $derived(
		peopleSegmentationStateCounts['draft-only'] + peopleSegmentationStateCounts.gated
	);
	const softBounceHonesty = getDataHonestyEvidence('V-7', null, {
		live: 'Soft-bounce threshold evidence is verified against webhook and suppression rows.',
		gated: 'Soft-bounce threshold evidence is unresolved.',
		gate: 'Verify soft-bounce threshold handling before claiming suppression integrity.'
	});
	const emailListHealthReadiness = $derived(
		buildEmailListHealthReadiness({
			base,
			emailHealth: {
				loaded: Boolean(people),
				subscribed: people?.emailHealth.subscribed ?? null,
				unsubscribed: people?.emailHealth.unsubscribed ?? null,
				bounced: people?.emailHealth.bounced ?? null,
				complained: people?.emailHealth.complained ?? null,
				consentEvidenceCount: people?.consentEvidence.email ?? null,
				subscribedConsentEvidenceCount: people?.consentEvidence.emailSubscribed ?? null
			},
			gates: {
				emailProxyGate,
				listUnsubscribeGate,
				listUnsubscribeProviderGate,
				softBounceGate,
				customDomainGate
			},
			honesty: {
				softBounceThreshold: softBounceHonesty
			}
		})
	);
	const emailListHealthRows = $derived<EmailListHealthReadinessRow[]>(
		emailListHealthReadiness.rows
	);
	const emailListHealthStateCounts = $derived(
		emailListHealthRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const emailListHealthSegments = $derived(
		operatorCapabilityStateRatioSegments(emailListHealthStateCounts, {
			labelSuffix: ' list-health contracts'
		})
	);
	const heldEmailListHealthCount = $derived(
		emailListHealthStateCounts['draft-only'] + emailListHealthStateCounts.gated
	);
	const peopleTrustLiftGate = $derived(weakestGate([mainnetGate, teeGate]));
	const peopleGroundState = $derived<CapabilityState>(
		[peopleSourceProvenanceReadiness.state, emailListHealthReadiness.state].sort(
			(a, b) => boundaryPriority(a) - boundaryPriority(b)
		)[0] ?? 'gated'
	);
	const peopleGroundHref = $derived(
		peopleSourceProvenanceReadiness.state === 'gated'
			? peopleSourceProvenanceReadiness.href
			: emailListHealthReadiness.href
	);
	const peopleGroundAction = $derived(
		peopleSourceProvenanceReadiness.state === 'gated'
			? peopleSourceProvenanceReadiness.action
			: emailListHealthReadiness.action
	);
	const peopleGroundSignal = $derived(
		`${emailListHealthReadiness.signal}; ${peopleSourceProvenanceReadiness.signal}`
	);
	const peopleGroundSummary = $derived(
		`${emailListHealthReadiness.effect} ${peopleSourceProvenanceReadiness.effect}`
	);
	const peopleGroundGate = $derived(
		`${peopleSourceProvenanceReadiness.gate} ${emailListHealthReadiness.gate} ${gateSummary(
			peopleTrustLiftGate,
			{
				prefix:
					'Mainnet identity and enclave resolver trust remain the proof-strength lift beyond source custody and consent-bound reach.'
			}
		)}`
	);
	const peopleGroundMetric = $derived(
		peopleSourceProvenanceReadiness.state === 'gated'
			? peopleSourceProvenanceReadiness.metric
			: emailListHealthReadiness.metric
	);
	const peopleGroundNextGate = $derived(
		weakestGate([
			peopleSourceProvenanceReadiness.nextGate,
			emailListHealthReadiness.nextGate,
			peopleTrustLiftGate
		])
	);
	const peopleGroundNextLift = $derived(
		peopleSourceProvenanceReadiness.state === 'gated'
			? peopleSourceProvenanceReadiness.nextGate.name
			: emailListHealthReadiness.nextGate.name
	);
	const textDeliveryReadiness = $derived(
		buildTextDeliveryReadiness({
			base,
			text: {
				enabled: FEATURES.SMS,
				dispatchEnabled: FEATURES.SMS_DISPATCH,
				loaded: Boolean(textDelivery),
				draftCount: textDelivery?.draftCount ?? null,
				plannedRecipientCount: textDelivery?.plannedRecipientCount ?? null,
				sentCount: textDelivery?.sentCount ?? null,
				deliveredCount: textDelivery?.deliveredCount ?? null,
				failedCount: textDelivery?.failedCount ?? null,
				messageCount: textDelivery?.messageCount ?? null,
				replyCount: textDelivery?.replyCount ?? null,
				subscribedPhoneCount: people?.smsHealth.subscribed ?? null,
				unsubscribedPhoneCount: people?.smsHealth.unsubscribed ?? null,
				stoppedPhoneCount: people?.smsHealth.stopped ?? null,
				noSmsStatusCount: people?.smsHealth.none ?? null,
				phonePresentCount: people?.smsHealth.phonePresent ?? null,
				smsConsentEvidenceCount: people?.consentEvidence.sms ?? null,
				subscribedSmsConsentEvidenceCount: people?.consentEvidence.smsSubscribed ?? null,
				dispatchRuntimeReady: textDelivery?.dispatchRuntimeReady ?? false,
				dispatchRuntimeMissing: textDelivery?.dispatchRuntimeMissing ?? [],
				dispatchRuntimeDependency: textDelivery?.dispatchRuntimeDependency ?? null,
				dispatchRuntimeMessage: textDelivery?.dispatchRuntimeMessage ?? null,
				dispatchRunnerImplemented: textDelivery?.dispatchRunnerImplemented ?? false,
				dispatchClientBatchRouteMounted: textDelivery?.dispatchClientBatchRouteMounted ?? false
			},
			gates: {
				smsDispatchGate,
				smsReceiptAnchoringGate,
				textReplyRegisterGate
			}
		})
	);
	const textDeliveryRows = $derived<TextDeliveryReadinessRow[]>(textDeliveryReadiness.rows);
	const textCarrierProofRows = $derived<TextCarrierProofRow[]>(textDeliveryReadiness.proofRows);
	const textCarrierProofStateCounts = $derived(
		textCarrierProofRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const textCarrierProofSegments = $derived(
		operatorCapabilityStateRatioSegments(textCarrierProofStateCounts, {
			labelSuffix: ' carrier proof rows'
		})
	);
	const heldTextCarrierProofCount = $derived(
		textCarrierProofStateCounts['draft-only'] + textCarrierProofStateCounts.gated
	);
	const textDeliveryStateCounts = $derived(
		textDeliveryRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const textDeliverySegments = $derived(
		operatorCapabilityStateRatioSegments(textDeliveryStateCounts, {
			labelSuffix: ' text-delivery contracts'
		})
	);
	const heldTextDeliveryCount = $derived(
		textDeliveryStateCounts['draft-only'] + textDeliveryStateCounts.gated
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
				enabled: FEATURES.SMS,
				loaded: Boolean(callRouting),
				canManageCalls: callRouting?.canManageCalls ?? false,
				twilioConfigured: callRouting?.twilioConfigured ?? false,
				initiationRuntimeReady: callRouting?.initiationRuntimeReady ?? false,
				initiationRuntimeMissing: callRouting?.initiationRuntimeMissing ?? null,
				initiationRuntimeDependency: callRouting?.initiationRuntimeDependency ?? null,
				initiationRuntimeMessage: callRouting?.initiationRuntimeMessage ?? null,
				initiationSurfaceMounted: callRouting?.initiationSurfaceMounted ?? false,
				initiationProxyImplemented: callRouting?.initiationProxyImplemented ?? null,
				callCount: callRouting?.callCount ?? null,
				completedCallCount: callRouting?.completedCallCount ?? null,
				campaignCount: callRouting?.campaignCount ?? null
			},
			gates: {
				callInitiationGate
			}
		})
	);
	const callRoutingRows = $derived<CallRoutingReadinessRow[]>(callRoutingReadiness.rows);
	const callRoutingStateCounts = $derived(
		callRoutingRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const callRoutingSegments = $derived(
		operatorCapabilityStateRatioSegments(callRoutingStateCounts, {
			labelSuffix: ' call-routing contracts'
		})
	);
	const heldCallRoutingCount = $derived(
		callRoutingStateCounts['draft-only'] + callRoutingStateCounts.gated
	);
	const workflowEffectsGate = getGateEvidence('CP-workflow-effects', ['T1-9a'], {
		name: 'Bounded workflow runner',
		downstream: 1,
		dependency: 'Trigger dispatch + tag/branch/delay runner'
	});
	const workflowExecutionArmed = $derived(
		FEATURES.WORKFLOW_EXECUTION && workflowEffectsGate.state === 'live'
	);
	const workflowRunEvidenceGate = getGateEvidence('CP-coordination-integrity', ['T10-10'], {
		name: 'Workflow run evidence',
		downstream: 1,
		dependency: 'Execution records + packet-local coordination metrics'
	});
	const coordinationReadiness = $derived(
		buildCoordinationReadiness({
			base,
			coordination: {
				enabled: FEATURES.AUTOMATION,
				executionEnabled: FEATURES.WORKFLOW_EXECUTION,
				loaded: Boolean(coordination),
				definitionCount: coordination?.definitionCount ?? null,
				enabledCount: coordination?.enabledCount ?? null,
				triggerFamilyCount: coordination?.triggerFamilyCount ?? null,
				plannedStepCount: coordination?.plannedStepCount ?? null,
				emailStepCount: coordination?.emailStepCount ?? null,
				tagStepCount: coordination?.tagStepCount ?? null,
				conditionStepCount: coordination?.conditionStepCount ?? null,
				runEvidenceCount: coordination?.runEvidenceCount ?? null
			},
			gates: {
				workflowEffectsGate,
				workflowRunEvidenceGate,
				emailProxyGate
			}
		})
	);
	const congressionalLaunchGate = getGateEvidence('CP-congressional-launch', ['NEW-A-7'], {
		name: 'Congressional delivery launch',
		downstream: 1,
		dependency: 'First-org staging confirmation + CWC launch flag'
	});
	const congressionalDeliveryRuntimeReady = $derived(congressionalDelivery?.runtimeReady === true);
	const congressionalDeliveryArmed = $derived(
		Boolean(
			FEATURES.CONGRESSIONAL &&
			congressionalDeliveryRuntimeReady &&
			congressionalLaunchGate.state === 'live'
		)
	);
	const delegatedActionGate = weakestGate([delegationGate, teeGate]);
	const studioJurisdictionScopeGate = getGateEvidence(
		'CP-studio-jurisdiction-scope',
		['T3-1', 'T3-2', 'T3-3', 'T3-4', 'T3-5'],
		{
			name: 'Full jurisdiction resolution',
			downstream: 5,
			dependency: 'State, local, special-district, and international resolver coverage'
		}
	);
	const messageProofGate = getGateEvidence('CP-message-proof-binding', ['T4-2', 'T4-7'], {
		name: 'Artifact proof binding',
		downstream: 2,
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
				studioJurisdictionScopeGate,
				messageProofGate,
				delegatedTraceGate
			}
		})
	);
	const studioAuthoringReadiness = $derived(
		buildStudioAuthoringReadiness({
			base,
			process: studioProcessEvidence,
			runtime: authoringRuntime,
			gates: {
				studioJurisdictionScopeGate,
				messageProofGate,
				delegatedTraceGate,
				delegatedActionGate
			}
		})
	);
	const studioAuthoringRows = $derived<StudioAuthoringReadinessRow[]>(
		studioAuthoringReadiness.rows
	);
	const studioAuthoringArtifactRow = $derived(
		studioAuthoringRows.find((row) => row.key === 'message-composition') ?? null
	);
	const authoringLoopState = $derived(
		studioAuthoringArtifactRow?.state ?? studioAuthoringReadiness.state
	);
	const authoringLoopGround = $derived(
		studioAuthoringArtifactRow?.ground ?? studioAuthoringReadiness.effect
	);
	const authoringLoopGate = $derived(
		studioAuthoringArtifactRow?.gate ?? studioAuthoringReadiness.gate
	);
	const authoringLoopMetric = $derived({
		value: studioAuthoringArtifactRow?.metric.value ?? studioAuthoringReadiness.metric.value,
		label: studioAuthoringArtifactRow?.metric.label ?? studioAuthoringReadiness.metric.label,
		cite: studioAuthoringArtifactRow?.metric.cite ?? studioAuthoringReadiness.metric.cite
	});
	const authoringLoopSummary = $derived(
		`Author artifact is ${stateLabel(authoringLoopState)}: ${authoringLoopGround}`
	);
	const authoringLoopNextLift = $derived(
		authoringLoopState === 'live' ? 'Send readiness handoff' : 'Authored artifact evidence'
	);
	const studioAuthoringStateCounts = $derived(
		studioAuthoringRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const studioAuthoringSegments = $derived(
		operatorCapabilityStateRatioSegments(studioAuthoringStateCounts, {
			labelSuffix: ' authoring contracts'
		})
	);
	const readerOfficeGate = getGateEvidence('CP-dm-office-profile', ['T8-1a', 'T8-1b', 'T8-8'], {
		name: 'Reader office integration',
		downstream: 4,
		dependency: 'DM enrichment partnership track'
	});
	const reachExpansionGate = getGateEvidence(
		'CP-reach-expansion',
		['T3-1', 'T3-2', 'T3-3', 'T3-4', 'T3-5'],
		{
			name: 'State, local, and international reach',
			downstream: 5,
			dependency: 'Multi-state + international Phase 2'
		}
	);
	const crossBorderCoalitionGate = getGateEvidence(
		'CP-cross-border-coalition',
		['T7-4', 'T7-6', 'T6-2'],
		{
			name: 'Cross-border coalition routing',
			downstream: 3,
			dependency: 'International Phase 2 + mainnet settlement'
		}
	);
	const coalitionStatsGate = getGateEvidence('CP-coalition-aggregate-stats', ['T7-1'], {
		name: 'Coalition aggregate stats',
		downstream: 1,
		dependency: 'Network member aggregate query'
	});
	const coalitionArtifactGate = getGateEvidence('CP-coalition-artifact', ['T6-1', 'T6-2', 'T7-6'], {
		name: 'Durable coalition artifact',
		downstream: 4,
		dependency: 'Receipt anchoring + cross-border delivery path'
	});
	const qualitySettlementGate = getGateEvidence('CP-quality-settlement', ['T5-3', 'T5-5', 'T5-2'], {
		name: 'Quality settlement',
		downstream: 6,
		dependency: 'TEE + Scroll mainnet settlement'
	});
	const debateTriggerGate = getGateEvidence('CP-debate-trigger', ['T5-1'], {
		name: 'Debate threshold trigger',
		downstream: 1,
		dependency: 'Verified-action threshold scheduler + manual campaign debate route'
	});
	const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2'], {
		name: 'Receipt anchoring',
		downstream: 8,
		dependency: 'Mainnet SnapshotAnchor + receipt writer'
	});
	const powerStateLocalTerrainGate = getGateEvidence(
		'CP-state-local-terrain',
		['T3-1', 'T3-2', 'T3-10'],
		{
			name: 'State/local power terrain',
			downstream: 3,
			dependency: 'OpenStates, special-district officeholders, and per-district feeds'
		}
	);
	const powerInternationalTerrainGate = getGateEvidence(
		'CP-international-power-terrain',
		['T3-3', 'T3-4', 'T3-5'],
		{
			name: 'International power resolver',
			downstream: 3,
			dependency: 'CA, GB, and AU representative lookup wiring'
		}
	);
	const powerStateBillTerrainGate = getGateEvidence('CP-state-bill-terrain', ['T6-6', 'T3-1'], {
		name: 'State bill terrain',
		downstream: 4,
		dependency: 'OpenStates or equivalent state-bill ingestion plus state legislator data'
	});
	const powerNonFederalScorecardGate = getGateEvidence(
		'CP-non-federal-scorecards',
		['T6-6', 'T3-1'],
		{
			name: 'Non-federal scorecard terrain',
			downstream: 3,
			dependency: 'State bill ingestion + state officeholder coverage'
		}
	);
	const powerOfficeResponseGate = getGateEvidence(
		'CP-reader-office-profile',
		['T8-1a', 'T8-1b', 'T8-8'],
		{
			name: 'Reader office response terrain',
			downstream: 4,
			dependency:
				'Decision-maker office profile enrichment, office-response workflow, and notification webhooks'
		}
	);
	const perSupporterBillAlertsGate = getGateEvidence('CP-per-supporter-bill-alerts', ['T4-3'], {
		name: 'Per-supporter bill alerts',
		downstream: 2,
		dependency: 'Constituent bill subscriptions, district fan-out, and digest delivery'
	});
	const delegatedLegislativeMonitoringGate = getGateEvidence(
		'CP-agentic-legislative-monitoring',
		['T4-4', 'T4-1'],
		{
			name: 'Delegated legislative monitoring',
			downstream: 4,
			dependency: 'Delegation executor + bill-to-district matching across constituent jurisdictions'
		}
	);
	const multiJurisdictionRoutingGate = getGateEvidence('CP-multi-jurisdiction-routing', ['T3-8'], {
		name: 'Multi-jurisdiction routing',
		downstream: 3,
		dependency: 'Campaign jurisdiction legs + per-slot decision-maker resolution'
	});
	const powerTerrainReadiness = $derived(
		buildPowerTerrainReadiness({
			base,
			power: {
				loaded: Boolean(power),
				legislationEnabled: Boolean(power?.legislationEnabled),
				followedCount: power?.followedCount ?? null,
				watchedBillCount: power?.bills.length ?? null,
				scorecardCount: power?.scorecardSnapshotCount ?? null
			},
			gates: {
				powerStateLocalTerrainGate,
				powerInternationalTerrainGate,
				powerStateBillTerrainGate,
				powerNonFederalScorecardGate,
				powerOfficeResponseGate
			}
		})
	);
	const donationReceiptGate = getGateEvidence('CP-donation-receipt-compliance', ['T6-1', 'T6-2'], {
		name: 'Donation receipt compliance',
		downstream: 4,
		dependency: 'Receipt policy workflow + mainnet anchoring'
	});
	const fundraiserRecordGate = getGateEvidence('CP-coordination-integrity', ['T10-10'], {
		name: 'Fundraiser record integrity',
		downstream: 1,
		dependency: 'Saved record integrity + packet-local coordination metrics'
	});
	const donationConfirmationGate = getGateEvidence('CP-donation-confirmation', ['T1-4'], {
		name: 'Donation confirmation outcome register',
		downstream: 1,
		dependency: 'Donation completion webhook + configured transactional confirmation'
	});
	const fundraisingReadiness = $derived(
		buildFundraisingReadiness({
			base,
			fundraising: {
				enabled: FEATURES.FUNDRAISING,
				loaded: Boolean(fundraising),
				fundraiserCount: fundraising?.fundraiserCount ?? null,
				activeCount: fundraising?.activeCount ?? null,
				raisedAmountCents: fundraising?.raisedAmountCents ?? null,
				donationCount: fundraising?.donationCount ?? null,
				receiptPolicyCount: fundraising?.receiptPolicyCount ?? null,
				confirmationCompleted: fundraising?.confirmation.completed ?? null,
				confirmationSent: fundraising?.confirmation.sent ?? null,
				confirmationAttempted: fundraising?.confirmation.attempted ?? null,
				confirmationProviderAccepted: fundraising?.confirmation.providerAccepted ?? null
			},
			gates: {
				fundraiserRecordGate,
				donationConfirmationGate,
				donationReceiptGate
			}
		})
	);
	const coordinationIntegrityGate = getGateEvidence('CP-coordination-integrity', ['T10-10'], {
		name: 'Engagement tier histogram UI',
		downstream: 1,
		dependency: 'Packet UI visibility'
	});
	const resultsProofReadiness = $derived(
		buildResultsProofReadiness({
			base,
			hrefs: {
				actionRecordsHref,
				packetHref,
				resultsPacketHref,
				proofDeliveryHref
			},
			results: {
				loaded: Boolean(ret),
				hasPacket: Boolean(packet),
				verifiedCount: packet?.verified ?? null,
				totalCount: packet?.total ?? null,
				districtCount: packet?.districtCount ?? null,
				sentEmails: ret?.stats.sentEmails ?? null,
				campaignCount: ret?.campaigns.length ?? null,
				receiptCount: ret?.receipts.loadedCount ?? null,
				pendingReceiptCount: ret?.receipts.pendingCount ?? null,
				responseLoggedReceiptCount: ret?.receipts.responseLoggedCount ?? null,
				anchorFieldCount: ret?.receipts.anchorFieldCount ?? null,
				receiptSampleLimit: ret?.receipts.sampleLimit ?? null,
				receiptProofWeightTotal: ret?.receipts.proofWeightTotal ?? null
			},
			features: {
				ACCOUNTABILITY: FEATURES.ACCOUNTABILITY
			},
			gates: {
				receiptAnchoringGate,
				readerOfficeGate,
				coordinationIntegrityGate
			}
		})
	);
	const resultsProofRows = $derived<ResultsProofRow[]>(resultsProofReadiness.rows);
	const resultsPacketRow = $derived(
		resultsProofReadiness.rows.find((row) => row.id === 'packet-artifact') ?? null
	);
	const resultsCoordinationRow = $derived(
		resultsProofReadiness.rows.find((row) => row.id === 'coordination-integrity') ?? null
	);
	const resultsReaderRow = $derived(
		resultsProofReadiness.rows.find((row) => row.id === 'reader-verifier') ?? null
	);
	const resultsProofStateCounts = $derived(
		resultsProofRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const resultsProofSegments = $derived(
		operatorCapabilityStateRatioSegments(resultsProofStateCounts, {
			labelSuffix: ' proof contracts'
		})
	);
	const receiptEvidenceResultsRow = $derived(
		resultsProofRows.find((row) => row.id === 'receipt-evidence') ?? null
	);
	const heldResultsProofRows = $derived(
		resultsProofRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const firstHeldResultsProofRow = $derived(heldResultsProofRows[0] ?? null);
	const resultsProofPressureReadouts = $derived<ResultsProofPressureReadout[]>([
		{
			id: 'packet-ground',
			label: 'Packet ground',
			title: resultsProofReadiness.signal,
			state: resultsProofReadiness.state,
			href: resultsProofReadiness.href,
			action: resultsProofReadiness.action,
			detail: resultsProofReadiness.detail,
			gate: gateSummary(resultsProofReadiness.nextGate, {
				prefix: 'Results proof stays bounded by the next unresolved proof lift.',
				complete: 'Results proof has no unresolved proof lift.'
			}),
			source: resultsProofReadiness.nextGate.source,
			metric: {
				value: resultsProofReadiness.metric.value,
				label: resultsProofReadiness.metric.label,
				cite: resultsProofReadiness.metric.cite
			}
		},
		{
			id: 'receipt-evidence',
			label: 'Receipt evidence',
			title: receiptEvidenceResultsRow?.label ?? 'Receipt evidence',
			state: receiptEvidenceResultsRow?.state ?? resultsProofReadiness.state,
			href: receiptEvidenceResultsRow?.href ?? resultsProofReadiness.href,
			action: receiptEvidenceResultsRow?.action ?? resultsProofReadiness.action,
			detail:
				receiptEvidenceResultsRow?.ground ??
				'No bounded receipt source rows are loaded, so receipt evidence has no source-row handoff.',
			gate: receiptEvidenceResultsRow?.boundary ?? resultsProofReadiness.gate,
			source: receiptEvidenceResultsRow?.gate.source ?? 'buildResultsProofReadiness',
			metric: {
				value: receiptEvidenceResultsRow?.metric.value ?? resultsProofReadiness.metric.value,
				label: receiptEvidenceResultsRow?.metric.label ?? resultsProofReadiness.metric.label,
				cite: receiptEvidenceResultsRow?.metric.cite ?? 'buildResultsProofReadiness'
			}
		},
		{
			id: 'next-proof-lift',
			label: 'Next proof lift',
			title: firstHeldResultsProofRow?.label ?? 'Proof boundary clear',
			state: firstHeldResultsProofRow?.state ?? 'live',
			href: firstHeldResultsProofRow?.href ?? resultsProofReadiness.href,
			action: firstHeldResultsProofRow?.action ?? resultsProofReadiness.action,
			detail:
				firstHeldResultsProofRow?.ground ??
				'No proof contract is currently blocking packet, receipt, or response ground.',
			gate: firstHeldResultsProofRow?.boundary ?? resultsProofReadiness.gate,
			source: firstHeldResultsProofRow?.gate.source ?? resultsProofReadiness.nextGate.source,
			metric: {
				value: firstHeldResultsProofRow?.metric.value ?? resultsProofReadiness.boundaryCount,
				label: firstHeldResultsProofRow?.metric.label ?? 'proof boundaries',
				cite: firstHeldResultsProofRow?.metric.cite ?? 'buildResultsProofReadiness'
			}
		}
	]);
	const fundraisingRows = $derived<FundraisingReadinessRow[]>(fundraisingReadiness.rows);
	const fundraisingReceiptProofRows = $derived<FundraisingReceiptProofRow[]>(
		fundraisingReadiness.proofRows
	);
	const fundraisingReceiptProofStateCounts = $derived(
		fundraisingReceiptProofRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const fundraisingReceiptProofSegments = $derived(
		operatorCapabilityStateRatioSegments(fundraisingReceiptProofStateCounts, {
			labelSuffix: ' receipt proof rows'
		})
	);
	const heldFundraisingReceiptProofCount = $derived(
		fundraisingReceiptProofStateCounts['draft-only'] + fundraisingReceiptProofStateCounts.gated
	);
	const fundraisingStateCounts = $derived(
		fundraisingRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const fundraisingSegments = $derived(
		operatorCapabilityStateRatioSegments(fundraisingStateCounts, {
			labelSuffix: ' funding contracts'
		})
	);
	const fundraisingConfirmationRow = $derived(
		fundraisingRows.find((row) => row.id === 'donor-confirmation') ?? null
	);
	const taxReceiptFundraisingRow = $derived(
		fundraisingRows.find((row) => row.id === 'tax-anchored-receipts') ?? null
	);
	const heldFundraisingRows = $derived(
		fundraisingRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const firstHeldFundraisingRow = $derived(heldFundraisingRows[0] ?? null);
	const nextReceiptLiftFundraisingRow = $derived(
		taxReceiptFundraisingRow && taxReceiptFundraisingRow.state !== 'live'
			? taxReceiptFundraisingRow
			: firstHeldFundraisingRow
	);
	const fundraisingPressureReadouts = $derived<FundraisingPressureReadout[]>([
		{
			id: 'funding-ground',
			label: 'Funding ground',
			title: fundraisingReadiness.signal,
			state: fundraisingReadiness.state,
			href: fundraisingReadiness.href,
			action: fundraisingReadiness.action,
			detail: fundraisingReadiness.detail,
			gate: gateSummary(fundraisingReadiness.nextGate, {
				prefix: 'Funding action stays bounded by the next unresolved receipt lift.',
				complete: 'Funding action has no unresolved receipt lift.'
			}),
			source: fundraisingReadiness.nextGate.source,
			metric: {
				value: fundraisingReadiness.metric.value,
				label: fundraisingReadiness.metric.label,
				cite: fundraisingReadiness.metric.cite
			}
		},
		{
			id: 'confirmation-register',
			label: 'Confirmation register',
			title: fundraisingConfirmationRow?.label ?? 'Donor confirmation register',
			state: fundraisingConfirmationRow?.state ?? fundraisingReadiness.state,
			href: fundraisingConfirmationRow?.href ?? fundraisingReadiness.href,
			action: fundraisingConfirmationRow?.action ?? fundraisingReadiness.action,
			detail:
				fundraisingConfirmationRow?.ground ??
				'No donor confirmation register is loaded, so confirmation evidence stays uncounted.',
			gate: fundraisingConfirmationRow?.boundary ?? fundraisingReadiness.gate,
			source: fundraisingConfirmationRow?.gate.source ?? 'buildFundraisingReadiness',
			metric: {
				value: fundraisingConfirmationRow?.metric.value ?? fundraisingReadiness.metric.value,
				label: fundraisingConfirmationRow?.metric.label ?? fundraisingReadiness.metric.label,
				cite: fundraisingConfirmationRow?.metric.cite ?? 'buildFundraisingReadiness'
			}
		},
		{
			id: 'next-receipt-lift',
			label: 'Next receipt lift',
			title: nextReceiptLiftFundraisingRow?.label ?? 'Receipt boundary clear',
			state: nextReceiptLiftFundraisingRow?.state ?? 'live',
			href: nextReceiptLiftFundraisingRow?.href ?? fundraisingReadiness.href,
			action: nextReceiptLiftFundraisingRow?.action ?? fundraisingReadiness.action,
			detail:
				nextReceiptLiftFundraisingRow?.ground ??
				'No funding contract is currently blocking confirmation, receipt policy, or anchored receipt ground.',
			gate: nextReceiptLiftFundraisingRow?.boundary ?? fundraisingReadiness.gate,
			source: nextReceiptLiftFundraisingRow?.gate.source ?? fundraisingReadiness.nextGate.source,
			metric: {
				value: nextReceiptLiftFundraisingRow?.metric.value ?? fundraisingReadiness.boundaryCount,
				label: nextReceiptLiftFundraisingRow?.metric.label ?? 'funding boundaries',
				cite: nextReceiptLiftFundraisingRow?.metric.cite ?? 'buildFundraisingReadiness'
			}
		}
	]);
	const coordinationRows = $derived<CoordinationReadinessRow[]>(coordinationReadiness.rows);
	const coordinationStateCounts = $derived(
		coordinationRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const coordinationSegments = $derived(
		operatorCapabilityStateRatioSegments(coordinationStateCounts, {
			labelSuffix: ' coordination contracts'
		})
	);
	const coordinationDefinitionRow = $derived(
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
	const firstHeldCoordinationRow = $derived(heldCoordinationRows[0] ?? null);
	const nextRunLiftCoordinationRow = $derived(
		runEvidenceCoordinationRow && runEvidenceCoordinationRow.state !== 'partial'
			? runEvidenceCoordinationRow
			: firstHeldCoordinationRow
	);
	const coordinationPressureReadouts = $derived<CoordinationPressureReadout[]>([
		{
			id: 'definition-ground',
			label: 'Definition ground',
			title: coordinationReadiness.signal,
			state: coordinationReadiness.state,
			href: coordinationReadiness.href,
			action: coordinationReadiness.action,
			detail: coordinationDefinitionRow?.ground ?? coordinationReadiness.detail,
			gate: gateSummary(coordinationReadiness.nextGate, {
				prefix: 'Coordination logic stays bounded by the next unresolved execution lift.',
				complete: 'Coordination logic has no unresolved execution lift.'
			}),
			source: coordinationReadiness.nextGate.source,
			metric: {
				value: coordinationReadiness.metric.value,
				label: coordinationReadiness.metric.label,
				cite: coordinationReadiness.metric.cite
			}
		},
		{
			id: 'side-effect-runner',
			label: 'Side-effect runner',
			title: sideEffectCoordinationRow?.label ?? 'Side-effect runner',
			state: sideEffectCoordinationRow?.state ?? coordinationReadiness.state,
			href: sideEffectCoordinationRow?.href ?? coordinationReadiness.href,
			action: sideEffectCoordinationRow?.action ?? coordinationReadiness.action,
			detail:
				sideEffectCoordinationRow?.ground ??
				'No side-effect runner row is loaded, so execution posture stays uncounted.',
			gate: sideEffectCoordinationRow?.boundary ?? coordinationReadiness.gate,
			source: sideEffectCoordinationRow?.gate.source ?? 'buildCoordinationReadiness',
			metric: {
				value: sideEffectCoordinationRow?.metric.value ?? coordinationReadiness.metric.value,
				label: sideEffectCoordinationRow?.metric.label ?? coordinationReadiness.metric.label,
				cite: sideEffectCoordinationRow?.metric.cite ?? 'buildCoordinationReadiness'
			}
		},
		{
			id: 'next-run-lift',
			label: 'Next run lift',
			title: nextRunLiftCoordinationRow?.label ?? 'Run boundary clear',
			state: nextRunLiftCoordinationRow?.state ?? 'live',
			href: nextRunLiftCoordinationRow?.href ?? coordinationReadiness.href,
			action: nextRunLiftCoordinationRow?.action ?? coordinationReadiness.action,
			detail:
				nextRunLiftCoordinationRow?.ground ??
				'No coordination contract is currently blocking side-effect execution or run-evidence ground.',
			gate: nextRunLiftCoordinationRow?.boundary ?? coordinationReadiness.gate,
			source: nextRunLiftCoordinationRow?.gate.source ?? coordinationReadiness.nextGate.source,
			metric: {
				value: nextRunLiftCoordinationRow?.metric.value ?? coordinationReadiness.boundaryCount,
				label: nextRunLiftCoordinationRow?.metric.label ?? 'coordination boundaries',
				cite: nextRunLiftCoordinationRow?.metric.cite ?? 'buildCoordinationReadiness'
			}
		}
	]);
	const publicVerifierHonesty = getDataHonestyEvidence('V-5', 'FIX-V5', {
		live: 'FIX-V5 resolved the AttestationVerifier preimage redaction mismatch after V-5 found the gap.',
		gated:
			'V-5 found the public verifier hash mismatch; keep reader recompute claims gated until FIX-V5 lands.',
		gate: 'FIX-V5'
	});
	const debateHonesty = getDataHonestyEvidence('V-3', 'FIX-V3', {
		live: 'V-3 verified debate packet threading, and FIX-V3 wired seeded debate coverage.',
		gated:
			'Debate packet claims need FIX-V3 seed wiring before the data audit can stand behind them.',
		gate: 'FIX-V3'
	});
	const coalitionAccentHonesty = getDataHonestyEvidence('V-4', 'FIX-V4', {
		live: 'FIX-V4 added the plan-tier gate after V-4 found branding accent could persist without tier enforcement.',
		gated: 'Coalition accent claims need the FIX-V4 plan-tier gate before they are honest.',
		gate: 'FIX-V4'
	});
	const atlasDriftHonesty = getDataHonestyEvidence('V-2', 'FIX-V2', {
		live: 'FIX-V2 threads atlasVersion and H3 cell evidence through the public campaign and embed district-evidence forms; packet drift is claimed only when action rows carry that atlas signal.',
		gated:
			'The public verified-address flow threads H3 cell and atlas version; packet drift stays bounded until embed and other geography-claiming submissions supply the same evidence.',
		gate: 'FIX-V2'
	});

	const verificationSegments = $derived([
		{
			value: people?.identityVerified ?? 0,
			color: 'var(--coord-verified, #10b981)',
			label: 'identity verified'
		},
		{
			value: Math.max(0, (people?.districtVerified ?? 0) - (people?.identityVerified ?? 0)),
			color: 'oklch(0.58 0.1 180)',
			label: 'district signal'
		},
		{
			value: Math.max(0, (people?.postalResolved ?? 0) - (people?.districtVerified ?? 0)),
			color: 'var(--coord-route-solid, #3bc4b8)',
			label: 'address resolved'
		},
		{
			value: Math.max(
				0,
				(people?.total ?? 0) -
					Math.max(
						people?.postalResolved ?? 0,
						people?.districtVerified ?? 0,
						people?.identityVerified ?? 0
					)
			),
			color: 'oklch(0.86 0.006 60)',
			label: 'ledger only'
		}
	]);

	const packetSegments = $derived([
		{
			value: packet?.verified ?? 0,
			color: 'var(--coord-verified, #10b981)',
			label: 'verified'
		},
		{
			value: Math.max(0, (packet?.total ?? 0) - (packet?.verified ?? 0)),
			color: 'oklch(0.86 0.006 60)',
			label: 'not verified'
		}
	]);

	const pulseValues = $derived([
		ret?.growth.lastWeek ?? 0,
		ret?.growth.thisWeek ?? 0,
		ret?.stats.activeCampaigns ?? 0,
		ret?.stats.sentEmails ?? 0
	]);
	const sendReadiness = $derived(
		buildSendReadiness({
			base,
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
			fallbackSubscribedCount: people?.emailHealth.subscribed ?? null,
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
	const clientDirectMergeState = $derived<CapabilityState>(sendReadiness.clientDirectMergeState);
	const clientDirectMergeGate = $derived(sendReadiness.clientDirectMergeGate);
	const sendBoundarySummary = $derived(sendReadiness.sendBoundarySummary);
	const sendBoundaryGateSummary = $derived(sendReadiness.sendBoundaryGate);
	const sendBoundaryState = $derived<CapabilityState>(sendReadiness.state);
	const sendBoundaryStepGate = $derived(
		sendReadiness.nextHeldMode
			? `${sendReadiness.nextHeldLabel}: ${sendReadiness.nextHeldGate}`
			: sendBoundaryGateSummary
	);
	const sendLoopState = $derived<CapabilityState>(sendReadiness.state);
	const sendLoopSummary = $derived(
		sendReadiness.heldCount > 0
			? `${sendReadiness.heldModeSummary}; ${sendReadiness.sendBoundarySummary}`
			: sendReadiness.sendBoundarySummary
	);
	const sendLoopGate = $derived(sendReadiness.sendBoundaryGate);
	const sendLoopMetric = $derived({
		value: sendReadiness.heldCount,
		label: sendReadiness.heldCount === 1 ? 'held send mode' : 'held send modes',
		cite: 'buildSendReadiness'
	});
	const sendLoopGround = $derived(
		sendReadiness.heldCount > 0
			? `${sendReadiness.heldCount} held send mode${sendReadiness.heldCount === 1 ? '' : 's'}`
			: 'no held send modes'
	);
	const sendLoopNextLift = $derived(
		sendReadiness.nextHeldMode ? sendReadiness.nextHeldLabel : 'no held send mode'
	);
	const powerTerrainRows = $derived<PowerTerrainRow[]>(powerTerrainReadiness.rows);
	const powerTerrainStateCounts = $derived(
		powerTerrainRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const powerTerrainSegments = $derived(
		operatorCapabilityStateRatioSegments(powerTerrainStateCounts, {
			labelSuffix: ' terrain contracts'
		})
	);
	const heldPowerTerrainRows = $derived(
		powerTerrainRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const firstHeldPowerTerrainRow = $derived(heldPowerTerrainRows[0] ?? null);
	const powerTerrainPressureReadouts = $derived<PowerTerrainPressureReadout[]>([
		{
			id: 'loaded-terrain',
			label: 'Loaded terrain',
			title:
				powerTerrainReadiness.terrainCount === null
					? 'Terrain unread'
					: `${powerTerrainReadiness.terrainCount} terrain records`,
			state: powerTerrainReadiness.state,
			href: `${base}/representatives#power-following`,
			action:
				powerTerrainReadiness.terrainCount === null ? 'read Power terrain' : 'open Power terrain',
			detail: powerTerrainReadiness.detail,
			gate: gateSummary(powerTerrainReadiness.nextGate, {
				prefix: 'Loaded Power terrain stays bounded by the next unresolved terrain lift.',
				complete: 'Loaded Power terrain has no unresolved lift.'
			}),
			source: powerTerrainReadiness.nextGate.source,
			metric: {
				value: powerTerrainReadiness.terrainCount,
				label: 'loaded records',
				cite: 'buildPowerTerrainReadiness'
			}
		},
		{
			id: 'held-terrain',
			label: 'Held terrain',
			title:
				heldPowerTerrainRows.length > 0
					? `${heldPowerTerrainRows.length} terrain contracts held`
					: 'No held terrain contract',
			state: firstHeldPowerTerrainRow?.state ?? 'live',
			href: firstHeldPowerTerrainRow?.href ?? `${base}/representatives#power-reach-boundary`,
			action: firstHeldPowerTerrainRow?.action ?? 'open Power terrain',
			detail:
				heldPowerTerrainRows.length > 0
					? 'Wider jurisdiction, reader-office, and joined-plane terrain stay dependency-first until their gates clear.'
					: 'Every Power terrain row is armed or bounded by current route evidence.',
			gate: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate,
			source: firstHeldPowerTerrainRow?.gate.source ?? 'buildPowerTerrainReadiness',
			metric: {
				value: heldPowerTerrainRows.length,
				label: 'held contracts',
				cite: 'buildPowerTerrainReadiness'
			}
		},
		{
			id: 'next-terrain-lift',
			label: 'Next terrain lift',
			title: firstHeldPowerTerrainRow?.label ?? 'Terrain boundary clear',
			state: firstHeldPowerTerrainRow?.state ?? 'live',
			href: firstHeldPowerTerrainRow?.href ?? `${base}/representatives#power-reach-boundary`,
			action: firstHeldPowerTerrainRow?.action ?? 'open Power terrain',
			detail:
				firstHeldPowerTerrainRow?.ground ??
				'No wider terrain contract is currently blocking Power resolution.',
			gate: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate,
			source: firstHeldPowerTerrainRow?.gate.source ?? powerTerrainReadiness.nextGate.source,
			metric: {
				value: firstHeldPowerTerrainRow?.metric.value ?? powerTerrainReadiness.boundaryCount,
				label: firstHeldPowerTerrainRow?.metric.label ?? 'terrain boundaries',
				cite: firstHeldPowerTerrainRow?.metric.cite ?? 'buildPowerTerrainReadiness'
			}
		}
	]);
	const legislativeMonitoringReadiness = $derived(
		buildLegislativeMonitoringReadiness({
			base,
			legislation: {
				loaded: Boolean(power),
				enabled: Boolean(power?.legislationEnabled),
				watchedBillCount: power?.bills.length ?? null,
				relevantBillCount: power?.relevantBillCount ?? null,
				positionedBillCount: power?.positionedBillCount ?? null
			},
			gates: {
				stateBillTerrainGate: powerStateBillTerrainGate,
				perSupporterAlertsGate: perSupporterBillAlertsGate,
				delegatedMonitoringGate: delegatedLegislativeMonitoringGate,
				multiJurisdictionRoutingGate
			}
		})
	);
	const legislativeMonitoringRows = $derived<LegislativeMonitoringReadinessRow[]>(
		legislativeMonitoringReadiness.rows
	);
	const legislativeMonitoringStateCounts = $derived(
		legislativeMonitoringRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const legislativeMonitoringSegments = $derived(
		operatorCapabilityStateRatioSegments(legislativeMonitoringStateCounts, {
			labelSuffix: ' monitoring contracts'
		})
	);
	const heldLegislativeMonitoringRows = $derived(
		legislativeMonitoringRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const firstHeldLegislativeMonitoringRow = $derived(heldLegislativeMonitoringRows[0] ?? null);
	const legislativeMonitoringPressureReadouts = $derived<LegislativeMonitoringPressureReadout[]>([
		{
			id: 'current-watch',
			label: 'Current watch',
			title:
				legislativeMonitoringReadiness.watchedBillCount === null
					? 'Bill terrain unread'
					: `${legislativeMonitoringReadiness.watchedBillCount} watched / ${legislativeMonitoringReadiness.relevantBillCount ?? 0} relevant / ${legislativeMonitoringReadiness.positionedBillCount ?? 0} positioned`,
			state: legislativeMonitoringReadiness.state,
			href: legislativeMonitoringReadiness.href,
			action: legislativeMonitoringReadiness.action,
			detail: legislativeMonitoringReadiness.detail,
			gate: gateSummary(legislativeMonitoringReadiness.nextGate, {
				prefix: 'Org-side monitoring stays bounded by the next unresolved watch lift.',
				complete: 'Bill monitoring has no unresolved watch lift.'
			}),
			source: legislativeMonitoringReadiness.nextGate.source,
			metric: {
				value: legislativeMonitoringReadiness.watchedBillCount,
				label: 'watched bills',
				cite: 'legislation.listWatchedBills'
			}
		},
		{
			id: 'held-fanout',
			label: 'Held fan-out',
			title:
				heldLegislativeMonitoringRows.length > 0
					? `${heldLegislativeMonitoringRows.length} monitoring contracts held`
					: 'No held monitoring contract',
			state: firstHeldLegislativeMonitoringRow?.state ?? 'live',
			href: firstHeldLegislativeMonitoringRow?.href ?? legislativeMonitoringReadiness.href,
			action: firstHeldLegislativeMonitoringRow?.action ?? legislativeMonitoringReadiness.action,
			detail:
				heldLegislativeMonitoringRows.length > 0
					? 'Alert fan-out, delegated monitoring, and multi-jurisdiction routing stay dependency-first until their gates clear.'
					: 'Every monitoring row is armed or bounded by current route evidence.',
			gate: firstHeldLegislativeMonitoringRow?.boundary ?? legislativeMonitoringReadiness.gate,
			source:
				firstHeldLegislativeMonitoringRow?.gate.source ?? 'buildLegislativeMonitoringReadiness',
			metric: {
				value: heldLegislativeMonitoringRows.length,
				label: 'held contracts',
				cite: 'buildLegislativeMonitoringReadiness'
			}
		},
		{
			id: 'next-monitoring-lift',
			label: 'Next monitoring lift',
			title: firstHeldLegislativeMonitoringRow?.label ?? 'Monitoring boundary clear',
			state: firstHeldLegislativeMonitoringRow?.state ?? 'live',
			href: firstHeldLegislativeMonitoringRow?.href ?? legislativeMonitoringReadiness.href,
			action: firstHeldLegislativeMonitoringRow?.action ?? legislativeMonitoringReadiness.action,
			detail:
				firstHeldLegislativeMonitoringRow?.ground ??
				'No monitoring contract is currently blocking bill-watch resolution.',
			gate: firstHeldLegislativeMonitoringRow?.boundary ?? legislativeMonitoringReadiness.gate,
			source:
				firstHeldLegislativeMonitoringRow?.gate.source ??
				legislativeMonitoringReadiness.nextGate.source,
			metric: {
				value:
					firstHeldLegislativeMonitoringRow?.metric.value ??
					legislativeMonitoringReadiness.boundaryCount,
				label: firstHeldLegislativeMonitoringRow?.metric.label ?? 'monitoring boundaries',
				cite:
					firstHeldLegislativeMonitoringRow?.metric.cite ?? 'buildLegislativeMonitoringReadiness'
			}
		}
	]);
	const coalitionReadiness = $derived(
		buildCoalitionReadiness({
			base,
			coalition: {
				enabled: FEATURES.NETWORKS,
				loaded: Boolean(coalition),
				activeNetworkCount: coalition?.activeNetworkCount ?? null,
				pendingInviteCount: coalition?.pendingInviteCount ?? null,
				activeMemberRows: coalition?.activeMemberRows ?? null,
				topActiveNetworkId: coalition?.topActiveNetworkId ?? null
			},
			gates: {
				coalitionStatsGate,
				crossBorderCoalitionGate,
				coalitionArtifactGate
			}
		})
	);
	const coalitionRows = $derived<CoalitionReadinessRow[]>(coalitionReadiness.rows);
	const coalitionStateCounts = $derived(
		coalitionRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const coalitionSegments = $derived(
		operatorCapabilityStateRatioSegments(coalitionStateCounts, {
			labelSuffix: ' coalition contracts'
		})
	);
	const aggregateProofCoalitionRow = $derived(
		coalitionRows.find((row) => row.id === 'aggregate-proof-detail') ?? null
	);
	const heldCoalitionRows = $derived(
		coalitionRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const firstHeldCoalitionRow = $derived(heldCoalitionRows[0] ?? null);
	const coalitionPressureReadouts = $derived<CoalitionPressureReadout[]>([
		{
			id: 'membership-ground',
			label: 'Membership ground',
			title: coalitionReadiness.signal,
			state: coalitionReadiness.state,
			href: coalitionReadiness.href,
			action: coalitionReadiness.action,
			detail: coalitionReadiness.detail,
			gate: gateSummary(coalitionReadiness.nextGate, {
				prefix: 'Coalition posture stays bounded by the next unresolved network lift.',
				complete: 'Coalition posture has no unresolved network lift.'
			}),
			source: coalitionReadiness.nextGate.source,
			metric: {
				value: coalitionReadiness.metric.value,
				label: coalitionReadiness.metric.label,
				cite: coalitionReadiness.metric.cite
			}
		},
		{
			id: 'proof-handoff',
			label: 'Proof handoff',
			title: aggregateProofCoalitionRow?.label ?? 'Aggregate proof detail',
			state: aggregateProofCoalitionRow?.state ?? coalitionReadiness.state,
			href: aggregateProofCoalitionRow?.href ?? coalitionReadiness.href,
			action: aggregateProofCoalitionRow?.action ?? coalitionReadiness.action,
			detail:
				aggregateProofCoalitionRow?.ground ??
				'No active coalition network is loaded, so aggregate proof detail has no handoff target.',
			gate: aggregateProofCoalitionRow?.boundary ?? coalitionReadiness.gate,
			source: aggregateProofCoalitionRow?.gate.source ?? 'buildCoalitionReadiness',
			metric: {
				value: aggregateProofCoalitionRow?.metric.value ?? coalitionReadiness.metric.value,
				label: aggregateProofCoalitionRow?.metric.label ?? coalitionReadiness.metric.label,
				cite: aggregateProofCoalitionRow?.metric.cite ?? 'buildCoalitionReadiness'
			}
		},
		{
			id: 'next-coalition-lift',
			label: 'Next coalition lift',
			title: firstHeldCoalitionRow?.label ?? 'Coalition boundary clear',
			state: firstHeldCoalitionRow?.state ?? 'live',
			href: firstHeldCoalitionRow?.href ?? coalitionReadiness.href,
			action: firstHeldCoalitionRow?.action ?? coalitionReadiness.action,
			detail:
				firstHeldCoalitionRow?.ground ??
				'No coalition contract is currently blocking network composition.',
			gate: firstHeldCoalitionRow?.boundary ?? coalitionReadiness.gate,
			source: firstHeldCoalitionRow?.gate.source ?? coalitionReadiness.nextGate.source,
			metric: {
				value: firstHeldCoalitionRow?.metric.value ?? coalitionReadiness.boundaryCount,
				label: firstHeldCoalitionRow?.metric.label ?? 'coalition boundaries',
				cite: firstHeldCoalitionRow?.metric.cite ?? 'buildCoalitionReadiness'
			}
		}
	]);
	const accountabilityResponseReadiness = $derived(
		buildAccountabilityResponseReadiness({
			base,
			response: {
				loaded: Boolean(power),
				scorecardCount: power?.scorecardSnapshotCount ?? null,
				receiptCount:
					power?.scorecards.reduce((sum, scorecard) => sum + scorecard.reportsReceived, 0) ?? null,
				openedCount: sumKnownScorecardMetric(power?.scorecards, 'reportsOpened'),
				verifyClickCount: sumKnownScorecardMetric(power?.scorecards, 'verifyLinksClicked'),
				replyCount: sumKnownScorecardMetric(power?.scorecards, 'repliesLogged'),
				alignedVoteCount: sumKnownScorecardMetric(power?.scorecards, 'alignedVotes'),
				relevantVoteCount: sumKnownScorecardMetric(power?.scorecards, 'relevantVotes')
			},
			features: {
				ACCOUNTABILITY: FEATURES.ACCOUNTABILITY,
				LEGISLATION: FEATURES.LEGISLATION
			},
			gates: {
				receiptAnchoringGate,
				readerOfficeGate,
				nonFederalScorecardGate: powerNonFederalScorecardGate
			}
		})
	);
	const accountabilityResponseRows = $derived<AccountabilityResponseReadinessRow[]>(
		accountabilityResponseReadiness.rows
	);
	const accountabilityResponseStateCounts = $derived(
		accountabilityResponseRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const accountabilityResponseSegments = $derived(
		operatorCapabilityStateRatioSegments(accountabilityResponseStateCounts, {
			labelSuffix: ' response contracts'
		})
	);
	const proofDeliveryResponseRow = $derived(
		accountabilityResponseRows.find((row) => row.id === 'proof-delivery-register') ?? null
	);
	const readerSignalResponseRows = $derived(
		accountabilityResponseRows.filter((row) =>
			['opened-response-signal', 'verified-link-signal', 'reply-log'].includes(row.id)
		)
	);
	const strongestReaderSignalResponseRow = $derived(
		[...readerSignalResponseRows].sort(
			(a, b) => statePriority(a.state) - statePriority(b.state)
		)[0] ?? null
	);
	const heldAccountabilityResponseRows = $derived(
		accountabilityResponseRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const firstHeldAccountabilityResponseRow = $derived(heldAccountabilityResponseRows[0] ?? null);
	const accountabilityResponsePressureReadouts = $derived<AccountabilityResponsePressureReadout[]>([
		{
			id: 'response-ground',
			label: 'Response ground',
			title: accountabilityResponseReadiness.signal,
			state: accountabilityResponseReadiness.state,
			href: accountabilityResponseReadiness.href,
			action: accountabilityResponseReadiness.action,
			detail: proofDeliveryResponseRow?.ground ?? accountabilityResponseReadiness.detail,
			gate: gateSummary(accountabilityResponseReadiness.nextGate, {
				prefix: 'Accountability response stays bounded by the next unresolved response lift.',
				complete: 'Accountability response has no unresolved response lift.'
			}),
			source: accountabilityResponseReadiness.nextGate.source,
			metric: {
				value: accountabilityResponseReadiness.metric.value,
				label: accountabilityResponseReadiness.metric.label,
				cite: accountabilityResponseReadiness.metric.cite
			}
		},
		{
			id: 'reader-signals',
			label: 'Reader signals',
			title: strongestReaderSignalResponseRow?.label ?? 'Reader signals',
			state: strongestReaderSignalResponseRow?.state ?? accountabilityResponseReadiness.state,
			href: strongestReaderSignalResponseRow?.href ?? accountabilityResponseReadiness.href,
			action: strongestReaderSignalResponseRow?.action ?? accountabilityResponseReadiness.action,
			detail:
				strongestReaderSignalResponseRow?.ground ??
				'Reader open, verification-click, and reply signals are not loaded, so signal ground stays uncounted.',
			gate: strongestReaderSignalResponseRow?.boundary ?? accountabilityResponseReadiness.gate,
			source:
				strongestReaderSignalResponseRow?.gate.source ?? 'buildAccountabilityResponseReadiness',
			metric: {
				value: accountabilityResponseReadiness.responseSignalCount,
				label: 'reader signals',
				cite:
					strongestReaderSignalResponseRow?.metric.cite ?? 'buildAccountabilityResponseReadiness'
			}
		},
		{
			id: 'next-response-lift',
			label: 'Next response lift',
			title: firstHeldAccountabilityResponseRow?.label ?? 'Response boundary clear',
			state: firstHeldAccountabilityResponseRow?.state ?? 'live',
			href: firstHeldAccountabilityResponseRow?.href ?? accountabilityResponseReadiness.href,
			action: firstHeldAccountabilityResponseRow?.action ?? accountabilityResponseReadiness.action,
			detail:
				firstHeldAccountabilityResponseRow?.ground ??
				'No response contract is currently blocking proof-delivery, reader-signal, reply, or office workflow ground.',
			gate: firstHeldAccountabilityResponseRow?.boundary ?? accountabilityResponseReadiness.gate,
			source:
				firstHeldAccountabilityResponseRow?.gate.source ??
				accountabilityResponseReadiness.nextGate.source,
			metric: {
				value:
					firstHeldAccountabilityResponseRow?.metric.value ??
					accountabilityResponseReadiness.boundaryCount,
				label: firstHeldAccountabilityResponseRow?.metric.label ?? 'response boundaries',
				cite:
					firstHeldAccountabilityResponseRow?.metric.cite ?? 'buildAccountabilityResponseReadiness'
			}
		}
	]);

	const capabilityCards = $derived<CapabilityCard[]>([
		{
			id: 'proof-bound-constituency',
			cluster: 'C-verification',
			title: 'Proof-bound constituency',
			workspace: 'People',
			phase: 'GROUND / SEND',
			state: peopleGroundState,
			statement:
				'Reach, source custody, consent evidence, and verification signal form the People ground every authored action can carry.',
			evidence: peopleGroundSummary,
			href: peopleGroundHref,
			action: peopleGroundAction,
			handoff: 'People ground',
			effect: peopleGroundSummary,
			futureLift:
				'Move People ground from source-custody and consent-bound reach into mainnet identity and TEE-attested resolver trust.',
			honesty: peopleGroundGate,
			nextGate: peopleGroundNextGate,
			metric: {
				label: peopleGroundMetric.label,
				value: peopleGroundMetric.value,
				cite: peopleGroundMetric.cite
			},
			visual: 'verification-ratio'
		},
		{
			id: 'jurisdictional-reach',
			cluster: 'C-reach',
			title: 'Jurisdictional reach',
			workspace: 'Power',
			phase: 'RESOLVE',
			state: powerTerrainReadiness.state,
			statement: powerTerrainReadiness.effect,
			evidence: powerTerrainReadiness.detail,
			href: firstHeldPowerTerrainRow?.href ?? `${base}/representatives#power-reach-boundary`,
			action:
				firstHeldPowerTerrainRow?.action ??
				(powerTerrainReadiness.terrainCount === null ? 'read Power terrain' : 'open Power terrain'),
			handoff: firstHeldPowerTerrainRow?.label ?? 'Power terrain',
			effect: powerTerrainReadiness.effect,
			futureLift:
				firstHeldPowerTerrainRow?.boundary ??
				'Add wider jurisdiction, office-response, international resolver, and joined target/bill/score terrain only when those terrain rows are armed.',
			honesty: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate,
			nextGate: firstHeldPowerTerrainRow?.gate ?? powerTerrainReadiness.nextGate,
			metric: {
				label: powerTerrainReadiness.terrainCount === 1 ? 'terrain record' : 'terrain records',
				value: powerTerrainReadiness.terrainCount,
				cite: 'buildPowerTerrainReadiness'
			}
		},
		{
			id: 'legislative-monitoring-posture',
			cluster: 'C-agentic',
			title: 'Legislative monitoring posture',
			workspace: 'Power',
			phase: 'GROUND / RESOLVE',
			state: legislativeMonitoringReadiness.state,
			statement: legislativeMonitoringReadiness.effect,
			evidence: legislativeMonitoringReadiness.detail,
			href: legislativeMonitoringReadiness.href,
			action: legislativeMonitoringReadiness.action,
			handoff: legislativeMonitoringReadiness.handoff,
			effect: legislativeMonitoringReadiness.effect,
			futureLift:
				'Move from org-side federal bill watchlists into per-supporter alerts, delegated monitoring, and multi-jurisdiction routing only when the executor and corpus gates land.',
			honesty: legislativeMonitoringReadiness.gate,
			nextGate: legislativeMonitoringReadiness.nextGate,
			metric: {
				label: legislativeMonitoringReadiness.metric.label,
				value: legislativeMonitoringReadiness.metric.value,
				cite: legislativeMonitoringReadiness.metric.cite
			}
		},
		{
			id: 'coalition-composition',
			cluster: 'C-composability',
			title: 'Coalition composition',
			workspace: 'Substrate',
			phase: 'AGGREGATE',
			state: coalitionReadiness.state,
			statement: coalitionReadiness.effect,
			evidence: coalitionReadiness.detail,
			href: coalitionReadiness.href,
			action: coalitionReadiness.action,
			handoff: coalitionReadiness.handoff,
			effect: coalitionReadiness.effect,
			futureLift:
				'Move descriptive network membership into cross-border routing and durable coalition artifacts only when international delivery, receipt anchoring, and artifact gates land.',
			honesty: coalitionReadiness.gate,
			nextGate: coalitionReadiness.nextGate,
			metric: {
				label: coalitionReadiness.metric.label,
				value: coalitionReadiness.metric.value,
				cite: coalitionReadiness.metric.cite
			},
			visual: 'rings'
		},
		{
			id: 'operating-authority',
			cluster: 'C-data-sovereignty',
			title: 'Operating authority',
			workspace: 'Substrate',
			phase: 'GROUND / AGGREGATE',
			state: operatingAuthorityReadiness.state,
			statement: operatingAuthorityReadiness.effect,
			evidence: operatingAuthorityReadiness.detail,
			href: `${base}/studio#capability-operating-authority`,
			action: operatingAuthorityReadiness.action,
			handoff: operatingAuthorityReadiness.handoff,
			effect: operatingAuthorityReadiness.effect,
			futureLift:
				'Move authority from honest local ground into custom-domain custody, richer developer surfaces, and mainnet registry permanence only when those gates land.',
			honesty: operatingAuthorityReadiness.gate,
			nextGate: operatingAuthorityReadiness.nextGate,
			metric: {
				label: operatingAuthorityReadiness.metric.label,
				value: operatingAuthorityReadiness.metric.value,
				cite: operatingAuthorityReadiness.metric.cite
			},
			visual: 'registry'
		},
		{
			id: 'platform-export-intake',
			cluster: 'C-reach',
			title: 'Platform export intake',
			workspace: 'People',
			phase: 'GROUND',
			state: platformIntakeReadiness.state,
			statement: platformIntakeReadiness.effect,
			evidence: platformIntakeReadiness.detail,
			href: `${base}/supporters/import#csv-intake`,
			action: 'open CSV intake',
			handoff: 'CSV export intake',
			effect:
				'Opens platform-neutral CSV recognition and source preservation; direct platform sync stays dependency-first.',
			futureLift: platformIntakeReadiness.futureLift,
			honesty: platformIntakeReadiness.boundary,
			nextGate: platformApiGate,
			metric: {
				label: 'recognized profiles',
				value: platformExportProfileCount,
				cite: 'src/lib/data/platform-export-profiles.ts'
			}
		},
		{
			id: 'people-source-provenance',
			cluster: 'C-data-sovereignty',
			title: 'People source custody',
			workspace: 'People',
			phase: 'GROUND',
			state: peopleSourceProvenanceReadiness.state,
			statement: peopleSourceProvenanceReadiness.effect,
			evidence: peopleSourceProvenanceReadiness.detail,
			href: peopleSourceProvenanceReadiness.href,
			action: peopleSourceProvenanceReadiness.action,
			handoff: peopleSourceProvenanceReadiness.handoff,
			effect: peopleSourceProvenanceReadiness.effect,
			futureLift: peopleSourceProvenanceReadiness.futureLift,
			honesty: peopleSourceProvenanceReadiness.boundary,
			nextGate: peopleSourceProvenanceReadiness.nextGate,
			metric: {
				label: peopleSourceProvenanceReadiness.metric.label,
				value: peopleSourceProvenanceReadiness.metric.value,
				cite: peopleSourceProvenanceReadiness.metric.cite
			}
		},
		{
			id: 'people-segmentation-posture',
			cluster: 'C-reach',
			title: 'People segmentation posture',
			workspace: 'People',
			phase: 'GROUND / SEND',
			state: peopleSegmentationReadiness.state,
			statement: peopleSegmentationReadiness.effect,
			evidence: peopleSegmentationReadiness.detail,
			href: peopleSegmentationReadiness.href,
			action: peopleSegmentationReadiness.action,
			handoff: peopleSegmentationReadiness.handoff,
			effect: peopleSegmentationReadiness.effect,
			futureLift:
				'Materialize readable civic geography labels while keeping source-specific runners and action-context cohorts separately proven.',
			honesty: peopleSegmentationReadiness.gate,
			nextGate: peopleSegmentationReadiness.nextGate,
			metric: {
				label: peopleSegmentationReadiness.metric.label,
				value: peopleSegmentationReadiness.metric.value,
				cite: peopleSegmentationReadiness.metric.cite
			}
		},
		{
			id: 'consent-bound-reach',
			cluster: 'C-reader-side',
			title: 'Consent-bound reach',
			workspace: 'People',
			phase: 'GROUND / SEND',
			state: emailListHealthReadiness.state,
			statement: emailListHealthReadiness.effect,
			evidence: emailListHealthReadiness.detail,
			href: emailListHealthReadiness.href,
			action: emailListHealthReadiness.action,
			handoff: emailListHealthReadiness.handoff,
			effect: emailListHealthReadiness.effect,
			futureLift:
				'Unify one-click headers across send paths and add per-org sender-domain authentication without collapsing them into a fake deliverability score.',
			honesty: emailListHealthReadiness.gate,
			nextGate: emailListHealthReadiness.nextGate,
			metric: {
				label: emailListHealthReadiness.metric.label,
				value: emailListHealthReadiness.metric.value,
				cite: emailListHealthReadiness.metric.cite
			}
		},
		{
			id: 'text-delivery-posture',
			cluster: 'C-reach',
			title: 'Text delivery posture',
			workspace: 'People',
			phase: 'GROUND / SEND / AGGREGATE',
			state: textDeliveryReadiness.state,
			statement: textDeliveryReadiness.effect,
			evidence: textDeliveryReadiness.detail,
			href: textDeliveryReadiness.href,
			action: textDeliveryReadiness.action,
			handoff: textDeliveryReadiness.handoff,
			effect: textDeliveryReadiness.effect,
			futureLift:
				'Arm carrier delivery only after browser phone custody, STOP filtering, carrier transport, and receipt anchoring can be proven without weakening People custody.',
			honesty: textDeliveryReadiness.gate,
			nextGate: textDeliveryReadiness.nextGate,
			metric: {
				label: textDeliveryReadiness.metric.label,
				value: textDeliveryReadiness.metric.value,
				cite: textDeliveryReadiness.metric.cite
			}
		},
		{
			id: 'call-routing-posture',
			cluster: 'C-reach',
			title: 'Call routing posture',
			workspace: 'Power',
			phase: 'SEND / AGGREGATE',
			state: callRoutingReadiness.state,
			statement: callRoutingReadiness.effect,
			evidence: callRoutingReadiness.detail,
			href: callRoutingReadiness.href,
			action: callRoutingReadiness.action,
			handoff: callRoutingReadiness.handoff,
			effect: callRoutingReadiness.effect,
			futureLift:
				'Arm patch-through calling only after caller-phone custody, supporter lookup, bridge transport, and phone-bank workflow semantics are proven together.',
			honesty: callRoutingReadiness.gate,
			nextGate: callRoutingReadiness.nextGate,
			metric: {
				label: callRoutingReadiness.metric.label,
				value: callRoutingReadiness.metric.value,
				cite: callRoutingReadiness.metric.cite
			}
		},
		{
			id: 'donation-receipt-posture',
			cluster: 'C-accountability',
			title: 'Donation receipt posture',
			workspace: 'Studio',
			phase: 'SEND / AGGREGATE',
			state: fundraisingReadiness.state,
			statement: fundraisingReadiness.effect,
			evidence: fundraisingReadiness.detail,
			href: fundraisingReadiness.href,
			action: fundraisingReadiness.action,
			handoff: fundraisingReadiness.handoff,
			effect: fundraisingReadiness.effect,
			futureLift:
				'Move funding actions from public intake and baseline confirmation into compliant acknowledgments and anchored receipt proof.',
			honesty: fundraisingReadiness.gate,
			nextGate: fundraisingReadiness.nextGate,
			metric: {
				label: fundraisingReadiness.metric.label,
				value: fundraisingReadiness.metric.value,
				cite: fundraisingReadiness.metric.cite
			}
		},
		{
			id: 'coordination-logic-readiness',
			cluster: 'C-coordination-integrity',
			title: 'Coordination logic readiness',
			workspace: 'Studio',
			phase: 'GROUND / SEND / AGGREGATE',
			state: coordinationReadiness.state,
			statement: coordinationReadiness.effect,
			evidence: coordinationReadiness.detail,
			href: coordinationReadiness.href,
			action: coordinationReadiness.action,
			handoff: coordinationReadiness.handoff,
			effect: coordinationReadiness.effect,
			futureLift:
				'Move saved trigger-and-step logic into armed side effects and auditable run evidence when workflow execution clears.',
			honesty: coordinationReadiness.gate,
			nextGate: coordinationReadiness.nextGate,
			metric: {
				label: coordinationReadiness.metric.label,
				value: coordinationReadiness.metric.value,
				cite: coordinationReadiness.metric.cite
			}
		},
		{
			id: 'grounded-authoring-loop',
			cluster: 'C-agentic',
			title: 'Grounded authoring loop',
			workspace: 'Studio',
			phase: 'INTENT / AUTHOR',
			state: studioAuthoringReadiness.state,
			statement: studioAuthoringReadiness.effect,
			evidence: studioAuthoringReadiness.detail,
			href: `${base}/studio`,
			action: 'open Studio intent',
			handoff: 'Studio intent',
			effect: studioAuthoringReadiness.effect,
			futureLift:
				'Add proof-bound drafted messages, full jurisdiction resolution, and the delegation executor for AI-assisted action.',
			honesty:
				'Reasoning streams, trace handles, and device-local output recovery are armed or bounded; proof-bound autonomous action is not armed.',
			nextGate: delegatedActionGate,
			metric: {
				label: studioAuthoringReadiness.metric.label,
				value: studioAuthoringReadiness.metric.value,
				cite: studioAuthoringReadiness.metric.cite
			},
			visual: 'pulse'
		},
		{
			id: 'quality-triggered-debate',
			cluster: 'C-quality-signaling',
			title: 'Quality-triggered debate',
			workspace: 'Studio',
			phase: 'AUTHOR / AGGREGATE',
			state: FEATURES.DEBATE ? 'partial' : 'gated',
			statement:
				'Action records can store a debate threshold, and campaign debate creation is wired; mainnet staking and TEE-attested verdicts are not production-armed.',
			evidence: FEATURES.DEBATE
				? 'The new-action route exposes quality settlement at #quality-settlement. Verified-action thresholds schedule atomic debate spawn, and editors can force-spawn a linked debate through the campaign route.'
				: 'Debate setup stays dependency-first until the quality-settlement gate opens.',
			href: `${base}/campaigns/new#quality-settlement`,
			action: FEATURES.DEBATE ? 'set debate threshold' : 'read debate boundary',
			handoff: 'Quality settlement setup',
			effect:
				'Opens campaign debate setup and threshold posture; real stake verification, mainnet markets, and TEE verdicts stay bounded.',
			futureLift: 'Add TEE evaluation, mainnet DebateMarket, and real stake verification.',
			honesty:
				'Quality-trigger plumbing is armed through T5-1; stake economics and TEE verdicts are not production-settled.',
			nextGate: qualitySettlementGate
		},
		{
			id: 'proof-and-receipts',
			cluster: 'C-accountability',
			title: 'Proof and receipts',
			workspace: 'Results',
			phase: 'SEND / AGGREGATE',
			state: resultsPacketRow?.state ?? resultsProofReadiness.state,
			statement: resultsProofReadiness.effect,
			evidence: resultsPacketRow?.ground ?? resultsProofReadiness.detail,
			href: resultsPacketRow?.href ?? resultsProofReadiness.href,
			action: resultsPacketRow?.action ?? resultsProofReadiness.action,
			handoff: resultsPacketRow?.handoff ?? resultsProofReadiness.handoff,
			effect: resultsPacketRow?.ground ?? resultsProofReadiness.effect,
			futureLift:
				'Anchor receipt batches to Scroll mainnet after the receipt writer and anchoring gate clear.',
			honesty: resultsPacketRow?.boundary ?? resultsProofReadiness.gate,
			nextGate: resultsPacketRow?.gate ?? receiptAnchoringGate,
			metric: {
				label: resultsPacketRow?.metric.label ?? 'verified in packet',
				value: resultsPacketRow?.metric.value ?? null,
				cite: resultsPacketRow?.metric.cite ?? 'computeVerificationPacketCached'
			},
			visual: 'packet-ratio'
		},
		{
			id: 'anti-astroturf-signal',
			cluster: 'C-coordination-integrity',
			title: 'Anti-astroturf signal',
			workspace: 'Results',
			phase: 'AGGREGATE',
			state: resultsCoordinationRow?.state ?? resultsProofReadiness.state,
			statement:
				'GDS, authorship diversity, timing entropy, burst velocity, and CAI are computed with each packet.',
			evidence: resultsCoordinationRow?.ground ?? resultsProofReadiness.detail,
			href: resultsCoordinationRow?.href ?? resultsProofReadiness.href,
			action: resultsCoordinationRow?.action ?? resultsProofReadiness.action,
			handoff: resultsCoordinationRow?.handoff ?? resultsProofReadiness.handoff,
			effect: resultsCoordinationRow?.ground ?? resultsProofReadiness.effect,
			futureLift:
				'Keep integrity metrics packet-local until trends and broader reader surfaces have evidence.',
			honesty: resultsCoordinationRow?.boundary ?? resultsProofReadiness.gate,
			nextGate: resultsCoordinationRow?.gate ?? coordinationIntegrityGate,
			metric: {
				label: resultsCoordinationRow?.metric.label ?? 'districts in packet',
				value: resultsCoordinationRow?.metric.value ?? null,
				cite: resultsCoordinationRow?.metric.cite ?? 'verification packet district grouping'
			}
		},
		{
			id: 'reader-legible-proof',
			cluster: 'C-reader-side',
			title: 'Reader-legible proof',
			workspace: 'Results',
			phase: 'SEND',
			state: resultsReaderRow?.state ?? resultsProofReadiness.state,
			statement: 'Reader proof previews and independent verification are bounded by packet ground.',
			evidence: resultsReaderRow?.ground ?? resultsProofReadiness.detail,
			href: resultsReaderRow?.href ?? resultsProofReadiness.href,
			action: resultsReaderRow?.action ?? resultsProofReadiness.action,
			handoff: resultsReaderRow?.handoff ?? resultsProofReadiness.handoff,
			effect: resultsReaderRow?.ground ?? resultsProofReadiness.effect,
			futureLift: 'Add reader-office workflows and notification APIs.',
			honesty: resultsReaderRow?.boundary ?? resultsProofReadiness.gate,
			nextGate: resultsReaderRow?.gate ?? readerOfficeGate
		},
		{
			id: 'accountability-response-posture',
			cluster: 'C-accountability',
			title: 'Accountability response posture',
			workspace: 'Results',
			phase: 'SEND / AGGREGATE',
			state: accountabilityResponseReadiness.state,
			statement: accountabilityResponseReadiness.effect,
			evidence: accountabilityResponseReadiness.detail,
			href: accountabilityResponseReadiness.href,
			action: accountabilityResponseReadiness.action,
			handoff: accountabilityResponseReadiness.handoff,
			effect: accountabilityResponseReadiness.effect,
			futureLift:
				'Move response evidence into reader-office workflows, notification APIs, non-federal scorecard terrain, and anchored receipt proof only when those gates land.',
			honesty: accountabilityResponseReadiness.gate,
			nextGate: accountabilityResponseReadiness.nextGate,
			metric: {
				label: accountabilityResponseReadiness.metric.label,
				value: accountabilityResponseReadiness.metric.value,
				cite: accountabilityResponseReadiness.metric.cite
			}
		},
		{
			id: 'owned-civic-infrastructure',
			cluster: 'C-data-sovereignty',
			title: 'Owned civic infrastructure',
			workspace: 'Substrate',
			phase: 'GROUND',
			state: 'partial',
			statement:
				'Shadow Atlas and PII-minimized architecture are armed infrastructure; the public chain mark is still testnet.',
			evidence: 'RegistryMark in the Mantle is honest: Sepolia testnet.',
			href: `${base}/settings#org-authority`,
			action: 'open org authority',
			handoff: 'Registry ground',
			effect:
				'Opens operating authority and registry posture; owned atlas is armed, while public-chain permanence remains testnet.',
			futureLift: 'Complete mainnet DistrictRegistry and SnapshotAnchor deployment.',
			honesty:
				'Owned atlas is armed; public-chain permanence remains testnet until mainnet deployment.',
			nextGate: mainnetGate,
			visual: 'registry'
		}
	]);

	const sendModes = $derived<SendReadinessMode[]>(sendReadiness.modes);
	const serverEmailMode = $derived(sendModes.find((mode) => mode.key === 'server-email') ?? null);
	const clientMergeMode = $derived(sendModes.find((mode) => mode.key === 'client-merge') ?? null);
	const abAutomationMode = $derived(sendModes.find((mode) => mode.key === 'ab-automation') ?? null);
	const smsSendMode = $derived(sendModes.find((mode) => mode.key === 'sms') ?? null);
	const eventArtifactMode = $derived(sendModes.find((mode) => mode.key === 'events') ?? null);
	const workflowSendMode = $derived(sendModes.find((mode) => mode.key === 'workflow') ?? null);
	const cwcSendMode = $derived(sendModes.find((mode) => mode.key === 'cwc') ?? null);

	const sendModeStateCounts = $derived(
		sendModes.reduce(
			(acc, mode) => {
				acc[mode.state] += 1;
				return acc;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);

	const sendModeSegments = $derived(operatorCapabilityStateRatioSegments(sendModeStateCounts));
	const usableSendModeCount = $derived(sendModeStateCounts.live + sendModeStateCounts.partial);
	const heldSendModeCount = $derived(sendReadiness.heldCount);
	const heldSendModeSummary = $derived(sendReadiness.heldModeSummary);
	const nextHeldSendMode = $derived(sendReadiness.nextHeldMode ?? null);
	const sendPressureReadouts = $derived<SendPressureReadout[]>([
		{
			id: 'usable-send',
			label: 'Usable send',
			title: `${usableSendModeCount}/${sendModes.length} usable modes`,
			state: usableSendModeCount === sendModes.length ? 'live' : sendBoundaryState,
			href: '#capability-send',
			action: 'read send readiness',
			detail:
				'Usable modes are live or bounded by route-local checks; they still preserve each route handoff.',
			gate: sendLoopGate,
			source: 'buildSendReadiness',
			metric: {
				value: usableSendModeCount,
				label: 'usable modes',
				cite: 'buildSendReadiness'
			}
		},
		{
			id: 'held-send',
			label: 'Held send',
			title: heldSendModeCount > 0 ? heldSendModeSummary : 'No held send mode',
			state: nextHeldSendMode?.state ?? 'live',
			href: nextHeldSendMode?.route ?? '#capability-send',
			action: nextHeldSendMode?.action ?? 'read send readiness',
			detail:
				heldSendModeCount > 0
					? `${heldSendModeCount} send modes stay draft-only or dependency-first before side effects.`
					: 'Every shared send mode is currently usable within its route boundary.',
			gate: nextHeldSendMode?.unlock ?? sendLoopGate,
			source: nextHeldSendMode?.metric?.cite ?? 'buildSendReadiness',
			metric: {
				value: heldSendModeCount,
				label: 'held modes',
				cite: 'buildSendReadiness'
			}
		},
		{
			id: 'next-send-lift',
			label: 'Next send lift',
			title: nextHeldSendMode?.label ?? 'Send boundary clear',
			state: nextHeldSendMode?.state ?? 'live',
			href: nextHeldSendMode?.route ?? '#capability-send',
			action: nextHeldSendMode?.action ?? 'read send readiness',
			detail: nextHeldSendMode?.effect ?? 'No held send handoff is blocking the shared SEND rail.',
			gate: nextHeldSendMode?.unlock ?? sendLoopGate,
			source: nextHeldSendMode?.metric?.cite ?? 'buildSendReadiness',
			metric: {
				value: nextHeldSendMode?.metric?.value ?? null,
				label: nextHeldSendMode?.metric?.label ?? 'next lift',
				cite: nextHeldSendMode?.metric?.cite ?? 'buildSendReadiness'
			}
		}
	]);

	const criticalPathRows = $derived<CriticalPathRow[]>(
		buildCriticalPathRows({
			gates: {
				eventRecordsGate,
				mainnetGate,
				teeGate,
				studioJurisdictionScopeGate,
				messageProofGate,
				delegationGate,
				readerOfficeGate
			}
		})
	);
	const unlockCascade = $derived<CriticalPathRow[]>(criticalPathRows);
	const criticalPathSummary = $derived(summarizeCriticalPath(criticalPathRows));
	const unresolvedCriticalPathRows = $derived(
		criticalPathRows.filter((row) => row.gate.status !== 'completed')
	);
	const groundedCriticalPathRow = $derived(
		criticalPathRows
			.filter((row) => row.gate.status === 'completed')
			.reduce<CriticalPathRow | null>(
				(current, row) =>
					!current || row.gate.downstream > current.gate.downstream ? row : current,
				null
			)
	);
	const loadBearingCriticalPathRow = $derived(criticalPathSummary.loadBearingRow);
	const criticalPathPressureReadouts = $derived<CriticalPathPressureReadout[]>([
		{
			id: 'load-bearing-lift',
			label: 'Load-bearing lift',
			title: loadBearingCriticalPathRow?.name ?? 'Critical path clear',
			state: loadBearingCriticalPathRow?.state ?? 'live',
			href: '#capability-critical-path',
			action: loadBearingCriticalPathRow ? 'read critical lift' : 'read cleared path',
			detail:
				loadBearingCriticalPathRow?.lift ??
				'Every critical-path row currently resolves as armed ground.',
			gate: criticalPathSummary.loadBearingSummary,
			source: loadBearingCriticalPathRow?.gate.source ?? 'summarizeCriticalPath',
			metric: {
				value: loadBearingCriticalPathRow?.gate.downstream ?? 0,
				label: loadBearingCriticalPathRow ? 'downstream items' : 'unresolved gates',
				cite: loadBearingCriticalPathRow?.gate.source ?? 'summarizeCriticalPath'
			}
		},
		{
			id: 'held-path',
			label: 'Held path',
			title:
				unresolvedCriticalPathRows.length > 0
					? 'Unresolved capability lift'
					: 'No held critical lift',
			state: criticalPathSummary.state,
			href: '#capability-critical-path',
			action: 'read unresolved path',
			detail: `${criticalPathSummary.liveCount}/${criticalPathRows.length} critical-path rows are ${stateLabel('live')}; ${criticalPathSummary.unresolvedCount} remain held by task evidence.`,
			gate: criticalPathSummary.loadBearingSummary,
			source: 'summarizeCriticalPath',
			metric: {
				value: criticalPathSummary.unresolvedCount,
				label: 'unresolved rows',
				cite: 'buildCriticalPathRows / summarizeCriticalPath'
			}
		},
		{
			id: 'grounded-substrate',
			label: 'Grounded substrate',
			title: groundedCriticalPathRow?.name ?? 'No armed substrate',
			state: groundedCriticalPathRow?.state ?? 'gated',
			href: '#capability-critical-path',
			action: groundedCriticalPathRow ? 'read grounded lift' : 'read gate evidence',
			detail:
				groundedCriticalPathRow?.today ??
				'No critical-path row is currently completed; inspect gates before claiming lift.',
			gate: groundedCriticalPathRow
				? gateSummary(groundedCriticalPathRow.gate, { complete: groundedCriticalPathRow.lift })
				: criticalPathSummary.loadBearingSummary,
			source: groundedCriticalPathRow?.gate.source ?? 'buildCriticalPathRows',
			metric: {
				value: criticalPathSummary.liveCount,
				label: 'armed rows',
				cite: 'buildCriticalPathRows'
			}
		}
	]);

	const honestyRows = $derived<HonestyRow[]>([
		{
			name: 'Public verifier hash',
			state: publicVerifierHonesty.state,
			mark: publicVerifierHonesty.mark,
			evidence: publicVerifierHonesty.evidence
		},
		{
			name: 'Debate packet fields',
			state: debateHonesty.state,
			mark: debateHonesty.mark,
			evidence: debateHonesty.evidence
		},
		{
			name: 'Coalition accent gate',
			state: coalitionAccentHonesty.state,
			mark: coalitionAccentHonesty.mark,
			evidence: coalitionAccentHonesty.evidence
		},
		{
			name: 'Atlas drift signal',
			state: atlasDriftHonesty.state,
			mark: atlasDriftHonesty.mark,
			evidence: atlasDriftHonesty.evidence
		}
	]);
	const liveHonestyCount = $derived(honestyRows.filter((row) => row.state === 'live').length);
	const unresolvedHonestyRows = $derived(honestyRows.filter((row) => row.state !== 'live'));
	const firstUnresolvedHonestyRow = $derived(unresolvedHonestyRows[0] ?? null);
	const unresolvedHonestyCount = $derived(honestyRows.filter((row) => row.state !== 'live').length);
	const unresolvedHonestyNames = $derived(unresolvedHonestyRows.map((row) => row.name).join(', '));
	const unresolvedHonestyMarks = $derived(unresolvedHonestyRows.map((row) => row.mark).join(', '));
	const gatedUnlockCount = $derived(criticalPathRows.filter((row) => row.state === 'gated').length);
	const dataHonestyMarkCount = $derived(honestyRows.length);
	const unloadedSliceCount = $derived(Math.max(0, totalOrgSliceCount - loadedSliceCount));
	const unresolvedBasisCount = $derived(unloadedSliceCount + unresolvedHonestyCount);
	const basisGapSummary = $derived(
		unresolvedBasisCount > 0
			? [
					unloadedSliceCount > 0
						? `${unloadedSliceCount} org slice${unloadedSliceCount === 1 ? '' : 's'} unloaded`
						: null,
					unresolvedHonestyCount > 0
						? `${unresolvedHonestyCount} unresolved data-honesty mark${
								unresolvedHonestyCount === 1 ? '' : 's'
							}: ${unresolvedHonestyNames}`
						: null
				]
					.filter(Boolean)
					.join('; ')
			: 'All org slices and data-honesty marks back current claims.'
	);

	const loopPhases = $derived<LoopPhase[]>([
		{
			id: 'INTENT',
			label: 'Define the civic action',
			state: 'live',
			workspace: 'Studio',
			clusters: 'C-agentic',
			href: `${base}/studio`,
			summary: 'Studio can accept an intent and start a real reasoning process.',
			unlock: gateSummary(delegatedActionGate, {
				prefix: 'Operator-initiated authoring becomes bounded delegated action after this gate.'
			})
		},
		{
			id: 'GROUND',
			label: 'Attach proof and source ground',
			state: peopleGroundState,
			workspace: 'People',
			clusters: 'C-verification / C-data-sovereignty / C-quality-signaling',
			href: peopleGroundHref,
			summary: peopleGroundSummary,
			unlock: peopleGroundGate,
			metric: {
				value: peopleGroundMetric.value,
				label: peopleGroundMetric.label,
				cite: peopleGroundMetric.cite
			}
		},
		{
			id: 'AUTHOR',
			label: 'Author artifact',
			state: authoringLoopState,
			workspace: 'Studio',
			clusters: 'C-agentic / C-quality-signaling',
			href: `${base}/studio`,
			summary: authoringLoopGround,
			unlock: authoringLoopGate,
			metric: authoringLoopMetric
		},
		{
			id: 'RESOLVE',
			label: 'Find the right power target',
			state: powerTerrainReadiness.state,
			workspace: 'Power',
			clusters: 'C-reach / C-accountability',
			href: firstHeldPowerTerrainRow?.href ?? `${base}/representatives#power-reach-boundary`,
			summary: powerTerrainReadiness.effect,
			unlock: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate,
			metric: {
				value: powerTerrainReadiness.terrainCount,
				label: powerTerrainReadiness.terrainCount === 1 ? 'terrain record' : 'terrain records',
				cite: 'buildPowerTerrainReadiness'
			}
		},
		{
			id: 'SEND',
			label: 'Deliver only armed channels',
			state: sendLoopState,
			workspace: 'Studio',
			clusters: 'C-reader-side / C-reach / C-verification',
			href: emailDeliveryHref,
			summary: sendLoopSummary,
			unlock: sendLoopGate,
			metric: sendLoopMetric
		},
		{
			id: 'AGGREGATE',
			label: 'Aggregate proof and accountability',
			state: resultsProofReadiness.state,
			workspace: 'Results',
			clusters: 'C-accountability / C-coordination-integrity / C-composability',
			href: resultsProofReadiness.href,
			summary: resultsProofReadiness.effect,
			unlock: resultsProofReadiness.gate,
			metric: {
				value: resultsProofReadiness.metric.value,
				label: resultsProofReadiness.metric.label,
				cite: resultsProofReadiness.metric.cite
			}
		}
	]);
	const loopPhaseStateCounts = $derived(
		loopPhases.reduce(
			(counts, phase) => {
				counts[phase.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const heldLoopPhaseCount = $derived(
		loopPhaseStateCounts.partial + loopPhaseStateCounts['draft-only'] + loopPhaseStateCounts.gated
	);
	const liveLoopPhaseCount = $derived(loopPhases.filter((phase) => phase.state === 'live').length);
	const heldLoopPhases = $derived(loopPhases.filter((phase) => phase.state !== 'live'));
	const firstHeldLoopPhase = $derived(heldLoopPhases[0] ?? null);
	const aggregateLoopPhase = $derived(loopPhases.find((phase) => phase.id === 'AGGREGATE') ?? null);
	const loopPressureReadouts = $derived<LoopPressureReadout[]>([
		{
			id: 'armed-span',
			label: 'armed span',
			title: 'Loop phases armed',
			state: liveLoopPhaseCount === loopPhases.length ? 'live' : 'partial',
			href: '#capability-loop',
			action: 'read loop',
			detail: `${liveLoopPhaseCount}/${loopPhases.length} phases are armed before qualifiers apply.`,
			gate: firstHeldLoopPhase
				? `First held phase: ${firstHeldLoopPhase.id}. ${firstHeldLoopPhase.unlock}`
				: 'All loop phases are armed in the current map.',
			source: 'Operating loop readiness',
			metric: {
				value: liveLoopPhaseCount,
				label: 'armed phases',
				cite: 'Operating loop readiness'
			}
		},
		firstHeldLoopPhase
			? {
					id: 'first-held-phase',
					label: 'first held phase',
					title: firstHeldLoopPhase.label,
					state: firstHeldLoopPhase.state,
					href: firstHeldLoopPhase.href,
					action: loopPhaseAction(firstHeldLoopPhase),
					detail: firstHeldLoopPhase.summary,
					gate: firstHeldLoopPhase.unlock,
					source: firstHeldLoopPhase.metric?.cite ?? 'Operating loop readiness',
					metric: {
						value: firstHeldLoopPhase.metric?.value ?? null,
						label: firstHeldLoopPhase.metric?.label ?? firstHeldLoopPhase.id.toLowerCase(),
						cite: firstHeldLoopPhase.metric?.cite ?? 'Operating loop readiness'
					}
				}
			: {
					id: 'first-held-phase',
					label: 'first held phase',
					title: 'No held phase',
					state: 'live',
					href: '#capability-loop',
					action: 'read loop',
					detail: 'Every phase in the visible loop is armed.',
					gate: 'No phase boundary is currently visible in the loop rail.',
					source: 'Operating loop readiness',
					metric: {
						value: 0,
						label: 'held phases',
						cite: 'Operating loop readiness'
					}
				},
		aggregateLoopPhase
			? {
					id: 'aggregate-proof',
					label: 'aggregate proof',
					title: aggregateLoopPhase.label,
					state: aggregateLoopPhase.state,
					href: aggregateLoopPhase.href,
					action: loopPhaseAction(aggregateLoopPhase),
					detail: aggregateLoopPhase.summary,
					gate: aggregateLoopPhase.unlock,
					source: aggregateLoopPhase.metric?.cite ?? 'Results proof readiness',
					metric: {
						value: aggregateLoopPhase.metric?.value ?? null,
						label: aggregateLoopPhase.metric?.label ?? 'proof signal',
						cite: aggregateLoopPhase.metric?.cite ?? 'Results proof readiness'
					}
				}
			: {
					id: 'aggregate-proof',
					label: 'aggregate proof',
					title: 'Aggregate proof',
					state: 'gated',
					href: '#capability-basis',
					action: 'read claim basis',
					detail: 'The loop has no aggregate phase row to cite.',
					gate: 'Add AGGREGATE phase evidence before claiming aggregate proof.',
					source: 'Operating loop readiness',
					metric: {
						value: null,
						label: 'proof signal',
						cite: 'Operating loop readiness'
					}
				}
	]);
	const capabilityLattice = $derived<CapabilityLatticeRow[]>(
		capabilityCards.map((card) => ({
			id: card.id,
			cluster: card.cluster,
			name: capabilityCardClusterLabel(card.cluster),
			title: card.title,
			state: card.state,
			href: card.href,
			action: card.action,
			workspace: card.workspace,
			gate: card.nextGate,
			metric: card.metric,
			phases: loopPhases.map((phase) => ({
				id: phase.id,
				label: phase.label,
				state: phaseTouches(card.phase, phase.id) ? card.state : null
			}))
		}))
	);
	const latticeStateCounts = $derived(
		capabilityLattice.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const touchedLatticePhaseCount = $derived(
		capabilityLattice.reduce(
			(total, row) => total + row.phases.filter((phase) => phase.state !== null).length,
			0
		)
	);
	const heldLatticeRowCount = $derived(
		latticeStateCounts.partial + latticeStateCounts['draft-only'] + latticeStateCounts.gated
	);
	const highestFanoutLatticeRow = $derived(
		capabilityLattice
			.filter((row) => row.gate.status !== 'completed')
			.reduce<CapabilityLatticeRow | null>(
				(current, row) =>
					!current || row.gate.downstream > current.gate.downstream ? row : current,
				null
			)
	);

	const loopStateCounts = $derived(
		loopPhases.reduce(
			(counts, phase) => {
				counts[phase.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const loopStateSegments = $derived(
		operatorCapabilityStateRatioSegments(loopStateCounts, { labelSuffix: ' phases' })
	);

	const basisSegments = $derived([
		{ value: loadedSliceCount, color: 'var(--coord-verified, #10b981)', label: 'loaded slices' },
		{
			value: liveHonestyCount,
			color: 'var(--coord-route-solid, #3bc4b8)',
			label: `${stateLabel('live')} data-honesty marks`
		},
		{
			value: unresolvedHonestyCount,
			color: 'oklch(0.75 0.13 82)',
			label: 'unresolved data-honesty marks'
		},
		{
			value: unloadedSliceCount,
			color: 'oklch(0.55 0.02 60)',
			label: 'unloaded slices'
		}
	]);

	const proofBoundAuthorState = $derived<CapabilityState>(
		[authoringLoopState, messageProofGate.state].sort(
			(a, b) => boundaryPriority(a) - boundaryPriority(b)
		)[0] ?? 'gated'
	);
	const actionToProofPathState = $derived<CapabilityState>(
		[
			authoringLoopState,
			powerTerrainReadiness.state,
			sendBoundaryState,
			resultsProofReadiness.state
		].sort((a, b) => boundaryPriority(a) - boundaryPriority(b))[0] ?? 'gated'
	);
	const proofBoundPeoplePathState = $derived<CapabilityState>(
		[peopleGroundState, proofBoundAuthorState, sendBoundaryState, resultsProofReadiness.state].sort(
			(a, b) => boundaryPriority(a) - boundaryPriority(b)
		)[0] ?? 'gated'
	);
	const delegatedTerrainState = $derived<CapabilityState>(
		[powerTerrainReadiness.state, studioJurisdictionScopeGate.state].sort(
			(a, b) => boundaryPriority(a) - boundaryPriority(b)
		)[0] ?? 'gated'
	);
	const delegatedExecutorState = $derived<CapabilityState>(
		delegatedActionGate.state === 'live' ? 'live' : 'gated'
	);
	const delegatedCivicActionState = $derived<CapabilityState>(
		FEATURES.DELEGATION
			? ([
					delegationGate.state,
					proofBoundAuthorState,
					delegatedTerrainState,
					delegatedExecutorState
				].sort((a, b) => boundaryPriority(a) - boundaryPriority(b))[0] ?? 'gated')
			: 'gated'
	);
	const delegatedCivicActionGround = $derived(
		`${authoringLoopSummary} ${firstHeldPowerTerrainRow?.ground ?? powerTerrainReadiness.effect}`
	);
	const delegatedCivicActionGateSummary = $derived(
		[
			gateSummary(delegationGate, {
				prefix: 'Delegated authority stays bounded by the grant/review gate.'
			}),
			authoringLoopGate,
			firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate,
			gateSummary(delegatedActionGate, {
				prefix: 'Autonomous execution waits on the delegation executor and TEE gates.'
			})
		].join(' ')
	);

	const compositionPaths = $derived<CompositionPath[]>([
		{
			id: 'PATH-1',
			title: 'Action-to-proof loop',
			state: actionToProofPathState,
			href: resultsReaderRow?.href ?? resultsProofReadiness.href,
			action: resultsReaderRow?.action ?? resultsProofReadiness.action,
			sequence: ['author', 'resolve', 'send', 'aggregate'],
			steps: [
				{
					phase: 'AUTHOR',
					label: 'Grounded draft',
					state: authoringLoopState,
					handoff: 'Studio intent',
					effect: authoringLoopSummary,
					gate: authoringLoopGate
				},
				{
					phase: 'RESOLVE',
					label: 'Target terrain',
					state: powerTerrainReadiness.state,
					handoff: firstHeldPowerTerrainRow?.label ?? 'Power terrain',
					effect: firstHeldPowerTerrainRow?.ground ?? powerTerrainReadiness.effect,
					gate: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate
				},
				{
					phase: 'SEND',
					label: 'Delivery boundary',
					state: sendBoundaryState,
					handoff: 'Send readiness',
					effect: sendBoundarySummary,
					gate: sendBoundaryStepGate
				},
				{
					phase: 'AGGREGATE',
					label: 'Reader packet',
					state: resultsPacketRow?.state ?? resultsProofReadiness.state,
					handoff: resultsProofReadiness.handoff,
					effect: resultsPacketRow?.ground ?? resultsProofReadiness.effect,
					gate: resultsPacketRow?.boundary ?? resultsProofReadiness.gate
				}
			],
			workspaces: ['Studio', 'Power', 'Results'],
			clusters: 'C-agentic / C-reach / C-accountability / C-reader-side',
			promise:
				'A grounded message can move through target resolution into a packet artifact the reader can read.',
			limit: 'Receipt writers, office notification APIs, and mainnet anchoring are not armed.',
			weakestGate: weakestGate([mainnetGate, readerOfficeGate]),
			metric: {
				value: resultsProofReadiness.metric.value,
				label: resultsProofReadiness.metric.label,
				cite: resultsProofReadiness.metric.cite
			},
			visual: 'packet-ratio'
		},
		{
			id: 'PATH-2',
			title: 'Proof-bound people',
			state: proofBoundPeoplePathState,
			href: peopleGroundHref,
			action: peopleGroundAction,
			sequence: ['verify', 'weight', 'reach', 'show proof'],
			steps: [
				{
					phase: 'GROUND',
					label: 'Verify people',
					state: peopleGroundState,
					handoff: 'People ground',
					effect: peopleGroundSummary,
					gate: peopleGroundGate
				},
				{
					phase: 'AUTHOR',
					label: 'Use proof weight',
					state: proofBoundAuthorState,
					handoff: 'Studio intent',
					effect: authoringLoopSummary,
					gate: authoringLoopGate
				},
				{
					phase: 'SEND',
					label: 'Reach through armed modes',
					state: sendBoundaryState,
					handoff: 'Send readiness',
					effect: sendBoundarySummary,
					gate: sendBoundaryStepGate
				},
				{
					phase: 'AGGREGATE',
					label: 'Show proof',
					state: resultsReaderRow?.state ?? resultsProofReadiness.state,
					handoff: resultsProofReadiness.handoff,
					effect: resultsReaderRow?.ground ?? resultsProofReadiness.effect,
					gate: resultsReaderRow?.boundary ?? resultsProofReadiness.gate
				}
			],
			workspaces: ['People', 'Studio', 'Results'],
			clusters: 'C-verification / C-coordination-integrity / C-reader-side',
			promise:
				'Reachable people become weighted civic capacity when address, identity, and packet proof move together.',
			limit:
				'District trust and resolver attestation remain testnet/local until mainnet and TEE land.',
			weakestGate: weakestGate([mainnetGate, teeGate]),
			metric: {
				value: peopleGroundMetric.value,
				label: peopleGroundMetric.label,
				cite: peopleGroundMetric.cite
			},
			visual: 'verification-ratio'
		},
		{
			id: 'PATH-3',
			title: 'Coalition packet',
			state: coalitionReadiness.state,
			href: coalitionReadiness.href,
			action: coalitionReadiness.action,
			sequence: [
				'read memberships',
				'open proof detail',
				'route jurisdictions',
				'publish artifact'
			],
			steps: [
				{
					phase: 'GROUND',
					label: 'Membership ground',
					state: coalitionReadiness.state,
					handoff: coalitionReadiness.handoff,
					effect: coalitionReadiness.detail,
					gate: coalitionReadiness.gate
				},
				{
					phase: 'RESOLVE',
					label: 'Aggregate proof handoff',
					state: 'gated',
					handoff: 'Coalition proof detail',
					effect:
						'Network detail routes own verified coalition action counts, unique supporters, district count, and integrity metrics.',
					gate: gateLabel(coalitionStatsGate)
				},
				{
					phase: 'SEND',
					label: 'Multi-org delivery',
					state: 'gated',
					handoff: 'Coalition send boundary',
					effect: 'No cross-org delivery side effect is claimed here.',
					gate: `${gateLabel(crossBorderCoalitionGate)}; send boundary: ${sendBoundaryStepGate}`
				},
				{
					phase: 'AGGREGATE',
					label: 'Protocol packet',
					state: 'gated',
					handoff: 'Coalition artifact',
					effect: 'Shared packet and receipt anchoring remain gated.',
					gate: gateLabel(weakestGate([crossBorderCoalitionGate, receiptAnchoringGate]))
				}
			],
			workspaces: ['Substrate', 'Results'],
			clusters: 'C-composability / C-accountability / C-data-sovereignty',
			promise:
				'Network memberships, aggregate proof handoff, and artifact gates point toward protocol-level coalition composition without collapsing org ledgers.',
			limit:
				'Cross-org sharing, cross-border schema, multi-country delivery, and receipt anchoring are still deferred.',
			weakestGate: coalitionReadiness.nextGate,
			metric: {
				value: coalitionReadiness.metric.value,
				label: coalitionReadiness.metric.label,
				cite: coalitionReadiness.metric.cite
			},
			visual: 'rings'
		},
		{
			id: 'PATH-4',
			title: 'Delegated civic action',
			state: delegatedCivicActionState,
			href: `${base}/studio`,
			action:
				delegatedCivicActionState === 'gated'
					? 'read delegation boundary'
					: 'read Studio scope and recovery',
			sequence: ['grant scope', 'draft action', 'attach proof', 'execute inside bounds'],
			steps: [
				{
					phase: 'INTENT',
					label: 'Grant scope',
					state: FEATURES.DELEGATION ? delegationGate.state : 'gated',
					handoff: 'Delegation boundary',
					effect: 'Grant review UI and executor remain outside the active route.',
					gate: gateLabel(delegationGate)
				},
				{
					phase: 'AUTHOR',
					label: 'Draft with proof',
					state: proofBoundAuthorState,
					handoff: 'Studio recovery',
					effect: authoringLoopSummary,
					gate: authoringLoopGate
				},
				{
					phase: 'RESOLVE',
					label: 'Scope terrain',
					state: delegatedTerrainState,
					handoff: firstHeldPowerTerrainRow?.label ?? 'Power terrain',
					effect: firstHeldPowerTerrainRow?.ground ?? powerTerrainReadiness.effect,
					gate: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate
				},
				{
					phase: 'SEND',
					label: 'Execute inside bounds',
					state: delegatedExecutorState,
					handoff: 'Delegation executor',
					effect: 'No autonomous side effect is claimed until executor, TEE, and proof gates land.',
					gate: gateLabel(delegatedActionGate)
				}
			],
			workspaces: ['Studio', 'People', 'Power'],
			clusters: 'C-agentic / C-verification / C-reach / C-coordination-integrity',
			promise:
				'The next operating plane is an agent acting only within verified constituent authority, carrying recoverable authoring output into proof-bound action.',
			limit:
				'Studio reasoning streams and device-local output recovery now; full jurisdiction scope, autonomous executor, ZK proof attachment, and delegation UI are not armed.',
			weakestGate: weakestGate([
				delegationGate,
				messageProofGate,
				studioJurisdictionScopeGate,
				teeGate
			]),
			metric: {
				value: null,
				label: 'delegated executions loaded',
				cite: 'delegation executor gate; no delegation slice in OrgSpacesData'
			},
			visual: 'pulse'
		}
	]);

	const partialCompositionPathCount = $derived(
		compositionPaths.filter((path) => path.state === 'partial').length
	);
	const usableCompositionPathCount = $derived(
		compositionPaths.filter((path) => path.state === 'live' || path.state === 'partial').length
	);
	const heldCompositionPathCount = $derived(
		compositionPaths.filter((path) => path.state === 'draft-only' || path.state === 'gated').length
	);
	const heldCompositionSteps = $derived(
		compositionPaths.flatMap((path) =>
			path.steps
				.filter((step) => step.state === 'draft-only' || step.state === 'gated')
				.map((step) => ({ path, step }))
		)
	);
	const firstHeldCompositionStep = $derived(heldCompositionSteps[0] ?? null);
	const nextCompositionLiftPath = $derived(
		compositionPaths.find((path) => path.state === 'gated') ??
			compositionPaths.find((path) => path.state === 'draft-only') ??
			compositionPaths.find((path) => path.state === 'partial') ??
			null
	);
	const compositionPressureReadouts = $derived<CompositionPressureReadout[]>([
		{
			id: 'compound-ground',
			label: 'Compound ground',
			state: usableCompositionPathCount > 0 ? 'partial' : 'gated',
			href: '#capability-composition',
			action: 'scan compound moves',
			detail: `${usableCompositionPathCount}/${compositionPaths.length} compound paths have usable ground.`,
			gate:
				heldCompositionPathCount > 0
					? `${heldCompositionPathCount} paths remain dependency-first.`
					: 'No dependency-first compound path in this scan.',
			metric: {
				value: usableCompositionPathCount,
				label: 'usable paths',
				cite: 'Capability composition paths'
			}
		},
		{
			id: 'held-phase',
			label: 'Held phase',
			state: firstHeldCompositionStep ? firstHeldCompositionStep.step.state : 'live',
			href: firstHeldCompositionStep?.path.href ?? '#capability-composition',
			action: firstHeldCompositionStep?.path.action ?? 'scan compound moves',
			detail: firstHeldCompositionStep
				? `${firstHeldCompositionStep.path.title} / ${firstHeldCompositionStep.step.phase}: ${firstHeldCompositionStep.step.label}`
				: 'No held compound phase in this scan.',
			gate: firstHeldCompositionStep?.step.gate ?? 'No compound phase gate is currently held.',
			metric: {
				value: heldCompositionSteps.length,
				label: 'held phases',
				cite: 'Capability composition phase steps'
			}
		},
		{
			id: 'next-compound-lift',
			label: 'Next lift',
			state: nextCompositionLiftPath?.state ?? 'live',
			href: nextCompositionLiftPath?.href ?? '#capability-composition',
			action: nextCompositionLiftPath?.action ?? 'scan compound moves',
			detail: nextCompositionLiftPath
				? nextCompositionLiftPath.title
				: 'No compound lift gate remains in this scan.',
			gate: nextCompositionLiftPath
				? gateSummary(nextCompositionLiftPath.weakestGate)
				: 'No weakest gate is currently blocking a compound path.',
			metric: {
				value: nextCompositionLiftPath?.weakestGate.downstream ?? null,
				label: nextCompositionLiftPath ? 'downstream' : 'blocked',
				cite: nextCompositionLiftPath?.weakestGate.source ?? 'Capability composition paths'
			}
		}
	]);
	const scrollMainnetUnlock = $derived(
		criticalPathRows.find((row) => row.name === 'Mainnet settlement') ?? null
	);

	const gateRegister = $derived<GateRegisterRow[]>(
		buildGateRegisterRows({
			features: {
				DELEGATION: FEATURES.DELEGATION
			},
			gates: {
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
			}
		})
	);
	const gateRegisterSummary = $derived(summarizeGateRegister(gateRegister));
	const unresolvedGateCount = $derived(gateRegisterSummary.unresolvedCount);
	const completedGateCount = $derived(gateRegisterSummary.completedCount);
	const loadBearingGate = $derived(gateRegisterSummary.loadBearingGate);
	const loadBearingGateSummary = $derived(gateRegisterSummary.loadBearingGateSummary);
	const gatePressureReadouts = $derived<GatePressureReadout[]>([
		{
			id: 'open-gates',
			label: 'Open gates',
			title:
				unresolvedGateCount > 0 ? `${unresolvedGateCount} unresolved gates` : 'Gate register clear',
			state: unresolvedGateCount === 0 ? 'live' : 'gated',
			href: '#capability-gates',
			action: 'read gate register',
			detail: `${completedGateCount}/${gateRegister.length} gates are completed; unresolved gates keep stronger verbs downgraded.`,
			gate: loadBearingGateSummary,
			source: 'summarizeGateRegister',
			metric: {
				value: unresolvedGateCount,
				label: 'unresolved gates',
				cite: 'summarizeGateRegister'
			}
		},
		{
			id: 'load-bearing-gate',
			label: 'Load-bearing gate',
			title: loadBearingGate?.name ?? 'No unresolved gate',
			state: loadBearingGate?.state ?? 'live',
			href: '#capability-gates',
			action: loadBearingGate ? 'read load-bearing gate' : 'read clear register',
			detail: loadBearingGate
				? `${loadBearingGate.blocks} Next lift: ${loadBearingGate.unlocks}`
				: 'No registered unresolved verb is blocking the map.',
			gate: loadBearingGateSummary,
			source: loadBearingGate?.gate.source ?? 'summarizeGateRegister',
			metric: {
				value: loadBearingGate?.gate.downstream ?? 0,
				label: loadBearingGate ? 'downstream items' : 'unresolved gates',
				cite: loadBearingGate?.gate.source ?? 'summarizeGateRegister'
			}
		},
		{
			id: 'completed-ground',
			label: 'Completed ground',
			title: `${completedGateCount} completed gates`,
			state: completedGateCount > 0 ? 'live' : 'gated',
			href: '#capability-gates',
			action: 'read completed ground',
			detail: 'Completed gates are usable ground; unresolved gates still bound stronger claims.',
			gate:
				unresolvedGateCount > 0
					? loadBearingGateSummary
					: 'Every registered gate in this map is completed.',
			source: 'summarizeGateRegister',
			metric: {
				value: completedGateCount,
				label: 'completed gates',
				cite: 'summarizeGateRegister'
			}
		}
	]);

	const gateStateSegments = $derived([
		{
			value: completedGateCount,
			color: 'var(--coord-verified, #10b981)',
			label: 'completed gates'
		},
		{ value: unresolvedGateCount, color: 'oklch(0.55 0.02 60)', label: 'unresolved gates' }
	]);

	const clusterEvidenceItems = $derived<ClusterEvidenceItem[]>([
		...capabilityCards.map((card) => ({
			clusters: card.cluster,
			title: card.title,
			state: card.state,
			href: card.href,
			action: card.action,
			gate: gateSummary(card.nextGate, {
				prefix: card.futureLift,
				complete: card.futureLift
			}),
			source: card.metric?.cite ?? card.nextGate.source
		})),
		...compositionPaths.map((path) => ({
			clusters: path.clusters,
			title: path.title,
			state: path.state,
			href: path.href,
			action: path.action,
			gate: gateSummary(path.weakestGate),
			source: path.metric?.cite ?? path.weakestGate.source
		})),
		...loopPhases.map((phase) => ({
			clusters: phase.clusters,
			title: phase.label,
			state: phase.state,
			href: phase.href,
			action: 'read loop',
			gate: phase.unlock,
			source: phase.metric?.cite ?? 'Operating loop readiness'
		})),
		...platformIntakeStageRows.map((row) => ({
			clusters: row.clusters,
			title: row.handoff,
			state: row.state,
			href: row.href,
			action: row.action,
			gate: row.gate,
			source: row.metric.cite
		})),
		...gateRegister.map((row) => ({
			clusters: row.gate.clusters,
			title: row.name,
			state: row.state,
			href: '#capability-gates',
			action: 'read gate register',
			gate: gateSummary(row.gate),
			source: row.gate.source
		}))
	]);

	const clusterCoverage = $derived<ClusterCoverageRow[]>(
		CAPABILITY_CLUSTER_IDS.map((id) => {
			const items = clusterEvidenceItems.filter((item) =>
				parseCapabilityClusterIds(item.clusters).includes(id)
			);
			const counts = items.reduce(
				(acc, item) => {
					acc[item.state] += 1;
					return acc;
				},
				{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
			);
			const lead = clusterLeadItem(items);
			const boundary = clusterBoundaryItem(items);
			return {
				id,
				label: CAPABILITY_CLUSTER_LABELS[id],
				state: clusterCoverageState(counts, items.length),
				href: lead?.href ?? '#capability-gates',
				action: lead?.action ?? 'read gate register',
				lead: lead?.title ?? 'No surfaced contract',
				gate:
					lead?.gate ??
					'No surfaced contract can support this cluster yet; add verified route evidence before claiming it.',
				source: lead?.source ?? 'Capability map cluster coverage',
				boundary:
					boundary?.title ??
					(items.length > 0 ? 'No unresolved boundary surfaced' : 'No surfaced contract'),
				boundaryGate:
					boundary?.gate ??
					(items.length > 0
						? 'No unresolved boundary is visible for this cluster; keep stronger claims tied to the gate register.'
						: 'No surfaced contract can support this cluster yet; add verified route evidence before claiming it.'),
				boundarySource: boundary?.source ?? 'Capability map cluster coverage',
				total: items.length,
				live: counts.live,
				partial: counts.partial,
				draftOnly: counts['draft-only'],
				gated: counts.gated
			};
		})
	);
	const clusterCoverageStateCounts = $derived(
		clusterCoverage.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const clusterCoverageSegments = $derived(
		operatorCapabilityStateRatioSegments(clusterCoverageStateCounts, {
			labelSuffix: ' clusters'
		})
	);
	const liveClusterCount = $derived(clusterCoverage.filter((row) => row.state === 'live').length);
	const boundedClusterCount = $derived(clusterCoverageStateCounts.partial);
	const heldClusterCount = $derived(
		clusterCoverageStateCounts['draft-only'] + clusterCoverageStateCounts.gated
	);
	const surfacedClusterCount = $derived(clusterCoverage.filter((row) => row.total > 0).length);
	const strongestCluster = $derived([...clusterCoverage].sort(compareClusterStrength)[0] ?? null);
	const mostConstrainedCluster = $derived(
		[...clusterCoverage].sort(compareClusterConstraint)[0] ?? null
	);
	const nextClusterMove = $derived([...clusterCoverage].sort(compareClusterMove)[0] ?? null);
	const clusterBalanceReadouts = $derived<ClusterBalanceReadout[]>(
		compactClusterBalanceReadouts([
			strongestCluster
				? {
						id: 'strongest-cluster-ground',
						label: 'strongest ground',
						title: strongestCluster.label,
						state: strongestCluster.state,
						href: strongestCluster.href,
						action: strongestCluster.action,
						detail: `${strongestCluster.live} armed / ${strongestCluster.total} visible contracts`,
						gate: strongestCluster.gate,
						source: strongestCluster.source,
						metric: {
							value: strongestCluster.live,
							label: 'live rows',
							cite: 'Capability coverage visible contracts'
						}
					}
				: null,
			mostConstrainedCluster
				? {
						id: 'most-constrained-cluster',
						label: 'most constrained',
						title: mostConstrainedCluster.label,
						state: mostConstrainedCluster.state,
						href: mostConstrainedCluster.href,
						action: mostConstrainedCluster.action,
						detail: `${mostConstrainedCluster.draftOnly + mostConstrainedCluster.gated} held / ${mostConstrainedCluster.total} visible contracts`,
						gate: mostConstrainedCluster.boundaryGate,
						source: mostConstrainedCluster.boundarySource,
						metric: {
							value: mostConstrainedCluster.draftOnly + mostConstrainedCluster.gated,
							label: 'held rows',
							cite: 'Capability coverage visible contracts'
						}
					}
				: null,
			nextClusterMove
				? {
						id: 'next-cluster-move',
						label: 'next cluster move',
						title: nextClusterMove.label,
						state: nextClusterMove.state,
						href: nextClusterMove.href,
						action: nextClusterMove.action,
						detail: nextClusterMove.lead,
						gate: nextClusterMove.boundaryGate,
						source: nextClusterMove.boundarySource,
						metric: {
							value: nextClusterMove.live + nextClusterMove.partial,
							label: 'usable rows',
							cite: 'Capability coverage visible contracts'
						}
					}
				: null
		])
	);

	const currentClaimState = $derived<CapabilityState>(
		[authoringLoopState, resultsProofReadiness.state].sort(
			(a, b) => boundaryPriority(a) - boundaryPriority(b)
		)[0] ?? 'gated'
	);
	const currentClaimHeadline = $derived(
		authoringLoopState === 'live'
			? resultsProofReadiness.hasPacket
				? 'Commons can author and qualify current proof ground.'
				: 'Commons can author with proof claims bounded by Results readiness.'
			: 'Claimable ground starts with bounded authoring.'
	);
	const currentClaimCopy = $derived(
		`${authoringLoopSummary} Results claim language follows the shared proof contract: ${resultsProofReadiness.effect}`
	);
	const currentClaimEvidence = $derived(
		`Studio claim ground cites ${authoringLoopMetric.cite}; Results proof ground cites ${resultsProofReadiness.metric.cite}. ${resultsProofReadiness.detail}`
	);
	const currentClaimGate = $derived(`${authoringLoopGate} ${resultsProofReadiness.gate}`);
	const currentClaimMetric = $derived({
		value: resultsProofReadiness.metric.value ?? authoringLoopMetric.value,
		label:
			resultsProofReadiness.metric.value !== null
				? resultsProofReadiness.metric.label
				: authoringLoopMetric.label,
		cite:
			resultsProofReadiness.metric.value !== null
				? resultsProofReadiness.metric.cite
				: authoringLoopMetric.cite
	});
	const blockedClaimGateSummary = $derived(
		loadBearingGate
			? gateSummary(loadBearingGate.gate, {
					prefix: 'The strongest blocked claims stay bounded by the current load-bearing gate.'
				})
			: sendLoopGate
	);

	const claimBoundaries = $derived<ClaimBoundary[]>([
		{
			id: 'CLAIM-ARMED',
			label: 'Claim',
			state: currentClaimState,
			headline: currentClaimHeadline,
			claim: currentClaimCopy,
			evidence: currentClaimEvidence,
			gate: currentClaimGate,
			metric: currentClaimMetric
		},
		{
			id: 'CLAIM-QUALIFY',
			label: 'Qualify',
			state: 'partial',
			headline: 'Commons can compose power, but several claims need scope language.',
			claim:
				'Use partial language for proof-weighted reach, Studio jurisdiction scope, recoverable message output, US/federal terrain, coalition stats, reader reports, and bounded sending.',
			evidence:
				'These surfaces route to real workspaces and metrics, but trust, coverage, or operations limits remain explicit.',
			gate: 'Mainnet, TEE, state/local/international terrain, receipt anchoring, and reader-office APIs lift these claims.',
			metric: {
				value: partialCompositionPathCount,
				label: 'partial compound paths',
				cite: 'Capability composition paths'
			}
		},
		{
			id: 'CLAIM-BLOCK',
			label: 'Do not claim yet',
			state: 'gated',
			headline:
				'Autonomous agents, settlement-proof receipts, and unarmed delivery stay off the claim sheet.',
			claim:
				'Do not present delegated action, TEE-attested verdicts, mainnet permanence, server dispatch, bulk SMS, workflows, or CWC as live.',
			evidence:
				'Feature flags and the task hypergraph keep those verbs draft-only or dependency-first.',
			gate: blockedClaimGateSummary,
			metric: {
				value: unresolvedGateCount,
				label: 'unresolved gates',
				cite: 'Task hypergraph gate register'
			}
		}
	]);
	const claimableBoundary = $derived(
		claimBoundaries.find((boundary) => boundary.id === 'CLAIM-ARMED') ?? null
	);
	const qualifiedBoundary = $derived(
		claimBoundaries.find((boundary) => boundary.id === 'CLAIM-QUALIFY') ?? null
	);
	const blockedBoundary = $derived(
		claimBoundaries.find((boundary) => boundary.id === 'CLAIM-BLOCK') ?? null
	);
	const qualifiedClaimCount = $derived(
		claimBoundaries.filter((boundary) => boundary.state !== 'live').length
	);
	const blockedClaimCount = $derived(
		claimBoundaries.filter((boundary) => boundary.state === 'gated').length
	);
	const claimPressureReadouts = $derived<ClaimPressureReadout[]>([
		{
			id: 'claimable-ground',
			label: 'Claimable ground',
			state: claimableBoundary?.state ?? 'gated',
			href: '#capability-claim-boundary',
			action: 'read claim boundary',
			detail: claimableBoundary?.headline ?? 'Current claim ground is unread.',
			gate: claimableBoundary?.gate ?? 'Reload claim boundary before using claim language.',
			metric: {
				value: claimableBoundary?.metric.value ?? null,
				label: claimableBoundary?.metric.label ?? 'claim signal',
				cite: claimableBoundary?.metric.cite ?? 'Capability claim boundary'
			}
		},
		{
			id: 'qualified-ground',
			label: 'Qualifier load',
			state: qualifiedBoundary?.state ?? 'partial',
			href: '#capability-claim-boundary',
			action: 'read qualifiers',
			detail: `${qualifiedClaimCount} claim rows require qualification or blocking language.`,
			gate: qualifiedBoundary?.gate ?? 'No qualifier gate is loaded.',
			metric: {
				value: qualifiedClaimCount,
				label: 'qualified rows',
				cite: 'Capability claim boundary'
			}
		},
		{
			id: 'blocked-claim',
			label: 'Blocked claim',
			state: blockedBoundary?.state ?? 'gated',
			href: '#capability-gates',
			action: 'read gate register',
			detail: blockedBoundary?.headline ?? 'No blocked claim row loaded.',
			gate: blockedBoundary?.gate ?? 'No blocked claim gate loaded.',
			metric: {
				value: blockedBoundary?.metric.value ?? blockedClaimCount,
				label: blockedBoundary?.metric.label ?? 'blocked rows',
				cite: blockedBoundary?.metric.cite ?? 'Capability claim boundary'
			}
		}
	]);

	const operatingReadout = $derived<OperatingReadout[]>([
		{
			id: 'READOUT-LOOP',
			label: 'Loop armed',
			state: liveLoopPhaseCount === loopPhases.length ? 'live' : 'partial',
			value: liveLoopPhaseCount,
			unit: 'armed phases',
			cite: 'Operating loop readiness',
			summary: `${authoringLoopSummary}; bounded phases keep their gates visible.`,
			gate:
				firstHeldLoopPhase?.unlock ??
				gateSummary(delegatedActionGate, {
					prefix:
						'Delegated action is the next loop lift from assisted work to durable bounded agency.'
				}),
			ground: `${liveLoopPhaseCount}/${loopPhases.length} phases armed; AUTHOR ${stateLabel(
				authoringLoopState
			)}`,
			nextLift: firstHeldLoopPhase?.label ?? 'delegated proof',
			href: '#capability-loop',
			action: 'read loop',
			visual: 'loop-ratio'
		},
		{
			id: 'READOUT-SEND',
			label: 'Send boundary',
			state: sendLoopState,
			value: sendLoopMetric.value,
			unit: sendLoopMetric.label,
			cite: sendLoopMetric.cite,
			summary: sendLoopSummary,
			gate: sendLoopGate,
			ground: sendLoopGround,
			nextLift: sendLoopNextLift,
			href: '#capability-send',
			action: 'read send readiness',
			visual: 'send-ratio'
		},
		{
			id: 'READOUT-BASIS',
			label: 'Evidence basis',
			state: unresolvedBasisCount === 0 ? 'live' : 'partial',
			value: unresolvedBasisCount,
			unit: 'basis gaps',
			cite: 'OrgSpacesData layout load + data-hypergraph audit',
			summary: `${loadedSliceCount}/${totalOrgSliceCount} org slices loaded; ${liveHonestyCount}/${dataHonestyMarkCount} ${stateLabel('live')} data-honesty marks.`,
			gate: basisGapSummary,
			ground: `${loadedSliceCount}/${totalOrgSliceCount} slices loaded`,
			nextLift: firstUnresolvedHonestyRow?.name ?? 'basis clear',
			href: '#capability-basis',
			action: 'read claim basis',
			visual: 'basis-ratio'
		},
		{
			id: 'READOUT-GATE',
			label: 'Load-bearing gate',
			state: loadBearingGate?.state ?? 'live',
			value: loadBearingGate?.gate.downstream ?? null,
			unit: 'downstream blocked',
			cite: loadBearingGate?.gate.source ?? 'Task hypergraph gate register',
			summary: loadBearingGate
				? `${loadBearingGate.name} is the highest fan-out unresolved gate in this map.`
				: 'No unresolved gate is currently registered in the map.',
			gate: loadBearingGateSummary,
			ground: loadBearingGate ? `${loadBearingGate.gate.downstream} downstream` : 'no open gate',
			nextLift: loadBearingGate?.name ?? 'gate register clear',
			href: '#capability-gates',
			action: 'read gate register',
			visual: 'gate-ratio'
		}
	]);
	const workspacePosture = $derived<WorkspacePosture[]>([
		{
			id: 'workspace-studio',
			label: 'Studio',
			state: authoringLoopState,
			href: `${base}/studio#studio-intent`,
			action: 'open Studio intent',
			signal: {
				value: authoringLoopMetric.value,
				label: authoringLoopMetric.label,
				cite: authoringLoopMetric.cite
			},
			summary: `${authoringLoopSummary}; Send remains subordinate in Send readiness.`,
			gate: canPublish
				? authoringLoopGate
				: `${authoringLoopGate} ${sendReadiness.sendBoundarySummary}`,
			ground: authoringLoopGround,
			nextLift: authoringLoopNextLift
		},
		{
			id: 'workspace-people',
			label: 'People',
			state: peopleGroundState,
			href: peopleGroundHref,
			action: peopleGroundAction,
			signal: {
				value: peopleGroundMetric.value,
				label: peopleGroundMetric.label,
				cite: peopleGroundMetric.cite
			},
			summary: peopleGroundSummary,
			gate: peopleGroundGate,
			ground: peopleGroundSignal,
			nextLift: peopleGroundNextLift
		},
		{
			id: 'workspace-power',
			label: 'Power',
			state: powerTerrainReadiness.state,
			href: firstHeldPowerTerrainRow?.href ?? `${base}/representatives#power-reach-boundary`,
			action:
				firstHeldPowerTerrainRow?.action ??
				(powerTerrainReadiness.terrainCount === null ? 'read Power terrain' : 'open Power terrain'),
			signal: {
				value: powerTerrainReadiness.terrainCount,
				label: powerTerrainReadiness.terrainCount === 1 ? 'terrain record' : 'terrain records',
				cite: 'buildPowerTerrainReadiness'
			},
			summary: powerTerrainReadiness.effect,
			gate: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate,
			ground: powerTerrainReadiness.signal,
			nextLift: firstHeldPowerTerrainRow?.label ?? powerTerrainReadiness.nextGate.name
		},
		{
			id: 'workspace-results',
			label: 'Results',
			state: resultsProofReadiness.state,
			href: firstHeldResultsProofRow?.href ?? resultsProofReadiness.href,
			action: firstHeldResultsProofRow?.action ?? resultsProofReadiness.action,
			signal: {
				value: resultsProofReadiness.metric.value,
				label: resultsProofReadiness.metric.label,
				cite: resultsProofReadiness.metric.cite
			},
			summary: resultsProofReadiness.effect,
			gate: firstHeldResultsProofRow?.boundary ?? resultsProofReadiness.gate,
			ground: resultsProofReadiness.signal,
			nextLift: firstHeldResultsProofRow?.label ?? resultsProofReadiness.nextGate.name
		}
	]);
	const workspacePostureStateCounts = $derived(
		workspacePosture.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const workspacePostureSegments = $derived(
		operatorCapabilityStateRatioSegments(workspacePostureStateCounts, {
			labelSuffix: ' workspaces'
		})
	);

	const launchPressureRows = $derived<LaunchPressureRow[]>(
		buildLaunchPressureRows({
			base,
			emailDeliveryHref,
			abAutomationState,
			civicGeographyLabelsState,
			serverDispatchRuntimeReady: emailDelivery?.serverDispatchRuntimeReady ?? false,
			serverDispatchRuntimeMissing: emailDelivery?.serverDispatchRuntimeMissing ?? [],
			serverDispatchRuntimeDependency: emailDelivery?.serverDispatchRuntimeDependency ?? null,
			textDispatchRuntimeReady: textDelivery?.dispatchRuntimeReady ?? false,
			textDispatchRuntimeMissing: textDelivery?.dispatchRuntimeMissing ?? [],
			textDispatchRuntimeDependency: textDelivery?.dispatchRuntimeDependency ?? null,
			textDispatchClientBatchRouteMounted: textDelivery?.dispatchClientBatchRouteMounted ?? false,
			platformApiSyncRuntimeReady: platformApiSync?.runtimeReady ?? false,
			platformApiSyncRuntimeMissing: platformApiSync?.runtimeMissing ?? [],
			platformApiSyncRuntimeDependency: platformApiSync?.runtimeDependency ?? null,
			features: {
				AB_TESTING: FEATURES.AB_TESTING,
				EMAIL_SERVER_DISPATCH: FEATURES.EMAIL_SERVER_DISPATCH,
				SMS_DISPATCH: FEATURES.SMS_DISPATCH,
				WORKFLOW_EXECUTION: FEATURES.WORKFLOW_EXECUTION
			},
			gates: {
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
			}
		})
	);
	const launchPressureStateCounts = $derived(
		launchPressureRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const heldLaunchPressureCount = $derived(
		launchPressureStateCounts['draft-only'] + launchPressureStateCounts.gated
	);

	const operatingPosture = $derived<OperatingPosture[]>([
		{
			id: 'POSTURE-AUTHOR',
			title:
				authoringLoopState === 'live' ? 'Authoring rail is armed' : 'Authoring rail is bounded',
			state: authoringLoopState,
			href: `${base}/studio#studio-intent`,
			action: 'open Studio intent',
			detail: authoringLoopSummary,
			gate: authoringLoopGate,
			metric: {
				value: authoringLoopMetric.value,
				label: authoringLoopMetric.label,
				cite: authoringLoopMetric.cite
			},
			visual: 'contract-ratio'
		},
		{
			id: 'POSTURE-PEOPLE',
			title:
				peopleGroundState === 'live'
					? 'People ground is armed'
					: peopleGroundState === 'gated'
						? 'People ground is not armed'
						: 'People ground is bounded',
			state: peopleGroundState,
			href: peopleGroundHref,
			action: peopleGroundAction,
			detail: peopleGroundSummary,
			gate: peopleGroundGate,
			metric: {
				value: peopleGroundMetric.value,
				label: peopleGroundMetric.label,
				cite: peopleGroundMetric.cite
			},
			visual: 'verification-ratio'
		},
		{
			id: 'POSTURE-SEND',
			title:
				sendLoopState === 'live'
					? 'Side effects are armed'
					: sendLoopState === 'gated'
						? 'Side effects are not armed'
						: 'Side effects are bounded',
			state: sendLoopState,
			href: emailDeliveryHref,
			action: 'read send readiness',
			detail: sendLoopSummary,
			gate: sendLoopGate,
			metric: {
				value: sendLoopMetric.value,
				label: sendLoopMetric.label,
				cite: sendLoopMetric.cite
			},
			visual: 'send-ratio'
		},
		{
			id: 'POSTURE-COMPOUND',
			title: 'Compound power is partial',
			state: 'partial',
			href: resultsReaderRow?.href ?? resultsProofReadiness.href,
			action: resultsReaderRow?.action ?? resultsProofReadiness.action,
			detail: resultsProofReadiness.effect,
			gate: scrollMainnetUnlock
				? `${gateSummary(mainnetGate, {
						prefix: 'Compound power stays partial while settlement and anchoring are deferred.'
					})} ${resultsProofReadiness.gate}`
				: resultsProofReadiness.gate,
			metric: {
				value: partialCompositionPathCount,
				label: 'partial paths',
				cite: 'Capability composition paths'
			},
			visual: 'packet-ratio'
		}
	]);

	const capabilityShifts = $derived<CapabilityShift[]>([
		{
			id: 'SHIFT-PEOPLE',
			title: 'Reach becomes proof weight',
			state: peopleGroundState,
			href: peopleGroundHref,
			action: peopleGroundAction,
			from: 'Incumbent mode: list size, ZIP inference, and enrollment history.',
			to: 'Commons mode: reachable people carry consent-bound reach, source custody, and verification signal.',
			evidence: peopleGroundSummary,
			gate: peopleGroundGate,
			cluster: 'C-verification / C-reach / C-data-sovereignty',
			metric: {
				value: peopleGroundMetric.value,
				label: peopleGroundMetric.label,
				cite: peopleGroundMetric.cite
			},
			visual: 'verification-ratio'
		},
		{
			id: 'SHIFT-INTAKE',
			title: 'Migration becomes source custody',
			state: platformIntakeReadiness.state,
			href: `${base}/supporters/import#csv-intake`,
			action: 'import exports',
			from: 'Incumbent mode: migration is a connector checkbox or a one-vendor sync.',
			to: 'Commons mode: export origins are preserved as People source signal; direct sync stays gated until custody and execution proof are present.',
			evidence: platformIntakeReadiness.detail,
			gate: platformIntakeReadiness.gate,
			cluster: 'C-reach / C-data-sovereignty / C-composability',
			metric: {
				value: platformExportProfileCount,
				label: 'recognized profiles',
				cite: 'src/lib/data/platform-export-profiles.ts'
			},
			visual: 'contract-ratio'
		},
		{
			id: 'SHIFT-SEGMENTATION',
			title: 'Segments become civic posture',
			state: peopleSegmentationReadiness.state,
			href: peopleSegmentationReadiness.href,
			action: peopleSegmentationReadiness.action,
			from: 'Incumbent mode: saved lists, tags, and vendor segments imply audience power.',
			to: 'Commons mode: cohort definitions are read against proof weight, source custody, action context, and civic geography limits.',
			evidence: peopleSegmentationReadiness.detail,
			gate: peopleSegmentationReadiness.gate,
			cluster: 'C-reach / C-verification / C-data-sovereignty',
			metric: {
				value: peopleSegmentationReadiness.metric.value,
				label: peopleSegmentationReadiness.metric.label,
				cite: peopleSegmentationReadiness.metric.cite
			},
			visual: 'contract-ratio'
		},
		{
			id: 'SHIFT-LIST-HEALTH',
			title: 'List size becomes consent-bound reach',
			state: emailListHealthReadiness.state,
			href: emailListHealthReadiness.href,
			action: emailListHealthReadiness.action,
			from: 'Incumbent mode: audience size, suppression, and deliverability scores blur together.',
			to: 'Commons mode: subscribed reach, opt-outs, bounces, complaints, one-click headers, and sender-domain authentication stay separate.',
			evidence: emailListHealthReadiness.detail,
			gate: emailListHealthReadiness.gate,
			cluster: 'C-reach / C-reader-side / C-data-sovereignty',
			metric: {
				value: emailListHealthReadiness.metric.value,
				label: emailListHealthReadiness.metric.label,
				cite: emailListHealthReadiness.metric.cite
			},
			visual: 'contract-ratio'
		},
		{
			id: 'SHIFT-TEXT-DELIVERY',
			title: 'Texting becomes custody-bound delivery',
			state: textDeliveryReadiness.state,
			href: textDeliveryReadiness.href,
			action: textDeliveryReadiness.action,
			from: 'Incumbent mode: SMS reads as another broadcast button once phone numbers exist.',
			to: 'Commons mode: phone consent, draft packet, audience scope, carrier evidence, dispatch runner, and receipt permanence stay separate.',
			evidence: textDeliveryReadiness.detail,
			gate: textDeliveryReadiness.gate,
			cluster: 'C-reach / C-data-sovereignty / C-reader-side',
			metric: {
				value: textDeliveryReadiness.metric.value,
				label: textDeliveryReadiness.metric.label,
				cite: textDeliveryReadiness.metric.cite
			},
			visual: 'contract-ratio'
		},
		{
			id: 'SHIFT-CALL-ROUTING',
			title: 'Calling becomes custody-aware routing',
			state: callRoutingReadiness.state,
			href: callRoutingReadiness.href,
			action: callRoutingReadiness.action,
			from: 'Incumbent mode: a phone number and a telephony account imply a call button.',
			to: 'Commons mode: call records, caller-phone decrypt, Twilio transport, and phone-bank workflow stay separate until each boundary is proven.',
			evidence: callRoutingReadiness.detail,
			gate: callRoutingReadiness.gate,
			cluster: 'C-reach / C-data-sovereignty / C-accountability',
			metric: {
				value: callRoutingReadiness.metric.value,
				label: callRoutingReadiness.metric.label,
				cite: callRoutingReadiness.metric.cite
			},
			visual: 'contract-ratio'
		},
		{
			id: 'SHIFT-POWER',
			title: 'Targets become terrain',
			state: powerTerrainReadiness.state,
			href: firstHeldPowerTerrainRow?.href ?? `${base}/representatives#power-reach-boundary`,
			action:
				firstHeldPowerTerrainRow?.action ??
				(powerTerrainReadiness.terrainCount === null ? 'read Power terrain' : 'open Power terrain'),
			from: 'Incumbent mode: legislative intel, accountability files, and contacts live apart.',
			to: 'Commons mode: targets, bills, and accountability scores form the terrain authoring resolves against.',
			evidence: powerTerrainReadiness.effect,
			gate: firstHeldPowerTerrainRow?.boundary ?? powerTerrainReadiness.gate,
			cluster: 'C-reach / C-accountability',
			metric: {
				value: powerTerrainReadiness.terrainCount,
				label: powerTerrainReadiness.terrainCount === 1 ? 'terrain record' : 'terrain records',
				cite: 'buildPowerTerrainReadiness'
			},
			visual: 'contract-ratio'
		},
		{
			id: 'SHIFT-MONITORING',
			title: 'Bill tracking becomes civic monitoring',
			state: legislativeMonitoringReadiness.state,
			href: legislativeMonitoringReadiness.href,
			action: legislativeMonitoringReadiness.action,
			from: 'Incumbent mode: staff watch bill feeds and manually decide who should act.',
			to: 'Commons mode: current bill terrain can become supporter-specific alerts and delegated action only when verified authority and district matching are armed.',
			evidence: legislativeMonitoringReadiness.detail,
			gate: legislativeMonitoringReadiness.gate,
			cluster: 'C-agentic / C-reach / C-coordination-integrity',
			metric: {
				value: legislativeMonitoringReadiness.metric.value,
				label: legislativeMonitoringReadiness.metric.label,
				cite: legislativeMonitoringReadiness.metric.cite
			},
			visual: 'contract-ratio'
		},
		{
			id: 'SHIFT-AUTHOR',
			title: 'Authoring becomes visible work',
			state: studioAuthoringReadiness.state,
			href: `${base}/studio#studio-intent`,
			action: 'open Studio intent',
			from: 'Incumbent mode: ungrounded copy assistance for the advocacy operator.',
			to: 'Commons mode: intent, source ground, target resolve, artifact output, recovery, trace, and delegation each carry their own readiness row.',
			evidence: studioAuthoringReadiness.detail,
			gate: [
				authoringLoopGate,
				gateSummary(delegatedActionGate, {
					prefix: 'Attach grants and executor bounds before autonomous action is claimed.'
				})
			].join(' '),
			cluster: 'C-agentic / C-quality-signaling',
			metric: {
				value: studioAuthoringReadiness.metric.value,
				label: studioAuthoringReadiness.metric.label,
				cite: studioAuthoringReadiness.metric.cite
			},
			visual: 'pulse'
		},
		{
			id: 'SHIFT-SEND',
			title: 'Sending becomes a boundary',
			state: sendLoopState,
			href: emailDeliveryHref,
			action: 'read send readiness',
			from: 'Incumbent mode: every channel reads like another send button.',
			to: 'Commons mode: every send mode carries its own state, handoff, effect, metric, and gate before a side effect is claimed.',
			evidence: sendLoopSummary,
			gate: sendLoopGate,
			cluster: 'C-reader-side / C-reach / C-verification',
			metric: {
				value: sendLoopMetric.value,
				label: sendLoopMetric.label,
				cite: sendLoopMetric.cite
			},
			visual: 'send-ratio'
		},
		{
			id: 'SHIFT-EVENTS',
			title: 'Events become bounded evidence',
			state: eventArtifactMode?.state ?? 'gated',
			href: eventArtifactMode?.route ?? `${base}/events#event-export-boundary`,
			action: eventArtifactMode?.action ?? 'read event boundary',
			from: 'Incumbent mode: event tools manage logistics and raw attendee exports.',
			to: 'Commons mode: event records produce public RSVP state plus calendar and non-PII attendance artifacts.',
			evidence:
				eventArtifactMode?.effect ??
				'Event artifact claims stay dependency-first until the event-record gate opens; no RSVP or artifact path is claimed.',
			gate: eventArtifactMode?.unlock ?? gateSummary(eventArtifactGate),
			cluster: 'C-coordination-integrity / C-data-sovereignty',
			visual: 'contract-ratio'
		},
		{
			id: 'SHIFT-PROOF',
			title: 'Reports become reader proof',
			state: resultsReaderRow?.state ?? resultsProofReadiness.state,
			href: resultsReaderRow?.href ?? resultsProofReadiness.href,
			action: resultsReaderRow?.action ?? resultsProofReadiness.action,
			from: 'Incumbent mode: analytics stay in the vendor report or export.',
			to: 'Commons mode: packet, hash, and verification URL travel to the reader.',
			evidence: resultsReaderRow?.ground ?? resultsProofReadiness.detail,
			gate: resultsReaderRow?.boundary ?? resultsProofReadiness.gate,
			cluster: 'C-accountability / C-reader-side',
			metric: {
				value: resultsProofReadiness.metric.value,
				label: resultsProofReadiness.metric.label,
				cite: resultsProofReadiness.metric.cite
			},
			visual: 'packet-ratio'
		},
		{
			id: 'SHIFT-RESPONSE',
			title: 'Response analytics become accountability posture',
			state: accountabilityResponseReadiness.state,
			href: accountabilityResponseReadiness.href,
			action: accountabilityResponseReadiness.action,
			from: 'Incumbent mode: opens, clicks, replies, and scorecards sit in separate reporting surfaces.',
			to: 'Commons mode: proof-delivery rows, reader signals, replies, and vote basis fold into a bounded accountability posture.',
			evidence: accountabilityResponseReadiness.detail,
			gate: accountabilityResponseReadiness.gate,
			cluster: 'C-accountability / C-reader-side / C-quality-signaling',
			metric: {
				value: accountabilityResponseReadiness.metric.value,
				label: accountabilityResponseReadiness.metric.label,
				cite: accountabilityResponseReadiness.metric.cite
			},
			visual: 'contract-ratio'
		},
		{
			id: 'SHIFT-COALITION',
			title: 'Coalitions become protocol composition',
			state: coalitionReadiness.state,
			href: coalitionReadiness.href,
			action: coalitionReadiness.action,
			from: 'Incumbent mode: coalition work is export, import, and manual reconciliation.',
			to: 'Commons mode: network membership, active member rows, and detail aggregate stats point toward shared proof artifacts without becoming shared CRM rows.',
			evidence: coalitionReadiness.detail,
			gate: coalitionReadiness.gate,
			cluster: 'C-composability / C-data-sovereignty',
			metric: {
				value: coalitionReadiness.metric.value,
				label: coalitionReadiness.metric.label,
				cite: coalitionReadiness.metric.cite
			},
			visual: 'rings'
		},
		{
			id: 'SHIFT-AUTHORITY',
			title: 'Operating authority becomes visible',
			state: operatingAuthorityReadiness.state,
			href: `${base}/studio#capability-operating-authority`,
			action: operatingAuthorityReadiness.action,
			from: 'Incumbent mode: admin settings hide the power, quotas, keys, and integrations that determine what an org can actually do.',
			to: 'Commons mode: authority, billing limits, API ground, signed events, encryption custody, and registry posture are visible as capability contracts.',
			evidence: operatingAuthorityReadiness.detail,
			gate: operatingAuthorityReadiness.gate,
			cluster: 'C-data-sovereignty / C-composability / C-coordination-integrity',
			metric: {
				value: operatingAuthorityReadiness.metric.value,
				label: operatingAuthorityReadiness.metric.label,
				cite: operatingAuthorityReadiness.metric.cite
			},
			visual: 'contract-ratio'
		}
	]);

	const groundedShiftCount = $derived(
		capabilityShifts.filter((shift) => shift.state === 'live' || shift.state === 'partial').length
	);
	const qualifiedShiftCount = $derived(
		capabilityShifts.filter((shift) => shift.state !== 'live').length
	);
	const heldShiftCount = $derived(
		capabilityShifts.filter((shift) => shift.state === 'draft-only' || shift.state === 'gated')
			.length
	);
	const loadBearingShift = $derived(
		capabilityShifts.find((shift) => shift.state === 'gated') ??
			capabilityShifts.find((shift) => shift.state === 'draft-only') ??
			capabilityShifts.find((shift) => shift.state === 'partial') ??
			null
	);
	const shiftPressureReadouts = $derived<ShiftPressureReadout[]>([
		{
			id: 'grounded-lift',
			label: 'Grounded lift',
			state: groundedShiftCount > 0 ? 'partial' : 'gated',
			href: `${base}/studio#capability-shifts-title`,
			action: 'scan operational shifts',
			detail: `${groundedShiftCount}/${capabilityShifts.length} shifts have live or bounded ground.`,
			gate:
				heldShiftCount > 0
					? `${heldShiftCount} shifts remain draft-only or not armed.`
					: 'No held operational shift rows in this scan.',
			metric: {
				value: groundedShiftCount,
				label: 'grounded shifts',
				cite: 'capabilityShifts state mix'
			}
		},
		{
			id: 'qualified-lift',
			label: 'Qualified lift',
			state: qualifiedShiftCount > 0 ? 'partial' : 'live',
			href: `${base}/studio#capability-shifts-title`,
			action: 'read shift qualifiers',
			detail:
				qualifiedShiftCount > 0
					? `${qualifiedShiftCount} shift claims need row-level qualifier before stronger execution language.`
					: 'All operational shift rows are live in this scan.',
			gate:
				qualifiedShiftCount > 0
					? 'Row gates name the unlock for each stronger claim.'
					: 'No remaining operational-shift qualifier in this scan.',
			metric: {
				value: qualifiedShiftCount,
				label: 'qualified shifts',
				cite: 'capabilityShifts state mix'
			}
		},
		{
			id: 'next-lift',
			label: 'Next lift',
			state: loadBearingShift?.state ?? 'live',
			href: loadBearingShift?.href ?? `${base}/studio#capability-shifts-title`,
			action: loadBearingShift?.action ?? 'scan operational shifts',
			detail: loadBearingShift
				? loadBearingShift.title
				: 'No unresolved operational-shift gate in this scan.',
			gate: loadBearingShift?.gate ?? 'No stronger operational-shift claim is currently blocked.',
			metric: {
				value: loadBearingShift ? 1 : 0,
				label: loadBearingShift ? 'shift gate' : 'shift gates',
				cite: 'capabilityShifts load-bearing row'
			}
		}
	]);

	const runtimeGateRows = $derived<ClaimBasis[]>([
		runtimeGateClaim({
			id: 'runtime-server-email-dispatch',
			name: 'Execution gate / Server email dispatch',
			flagName: 'EMAIL_SERVER_DISPATCH',
			enabled: FEATURES.EMAIL_SERVER_DISPATCH,
			state: serverEmailMode?.state ?? 'draft-only',
			currentGround:
				serverEmailMode?.effect ?? 'Server email mode is unread from buildSendReadiness.',
			enabledBoundary: serverEmailMode?.unlock ?? sendBoundaryGateSummary,
			closedBoundary: serverEmailMode?.unlock ?? sendBoundaryGateSummary,
			gateText: serverEmailMode?.unlock ?? sendBoundaryGateSummary
		}),
		runtimeGateClaim({
			id: 'runtime-client-merge-send',
			name: 'Execution gate / Client merge send',
			flagName: 'EMAIL_CLIENT_DIRECT_MERGE',
			enabled: FEATURES.EMAIL_CLIENT_DIRECT_MERGE,
			state: clientMergeMode?.state ?? clientDirectMergeState,
			currentGround:
				clientMergeMode?.effect ?? 'Client merge mode is unread from buildSendReadiness.',
			enabledBoundary: clientMergeMode?.unlock ?? clientDirectMergeGate,
			closedBoundary: clientMergeMode?.unlock ?? clientDirectMergeGate,
			gateText: clientMergeMode?.unlock ?? clientDirectMergeGate
		}),
		runtimeGateClaim({
			id: 'runtime-ab-continuation',
			name: 'Execution gate / A/B continuation',
			flagName: 'AB_TESTING',
			enabled: FEATURES.AB_TESTING,
			state: abAutomationMode?.state ?? abAutomationState,
			currentGround:
				abAutomationMode?.effect ?? 'A/B continuation mode is unread from buildSendReadiness.',
			enabledBoundary: abAutomationMode?.unlock ?? sendBoundaryGateSummary,
			closedBoundary: abAutomationMode?.unlock ?? sendBoundaryGateSummary,
			gateText:
				abAutomationMode?.unlock ??
				gateSummary(abAutomationGate, {
					prefix: 'Automated continuation waits on A/B execution proof.'
				})
		}),
		runtimeGateClaim({
			id: 'runtime-sms-dispatch',
			name: 'Execution gate / SMS dispatch',
			flagName: 'SMS_DISPATCH',
			enabled: FEATURES.SMS_DISPATCH,
			state: smsSendMode?.state ?? textDispatchClaimState,
			currentGround: smsSendMode?.effect ?? textDeliveryReadiness.effect,
			enabledBoundary: smsSendMode?.unlock ?? textDeliveryReadiness.gate,
			closedBoundary: smsSendMode?.unlock ?? textDeliveryReadiness.gate,
			gateText: smsSendMode?.unlock ?? textDeliveryReadiness.gate
		}),
		runtimeGateClaim({
			id: 'runtime-workflow-execution',
			name: 'Execution gate / Workflow execution',
			flagName: 'WORKFLOW_EXECUTION',
			enabled: FEATURES.WORKFLOW_EXECUTION,
			state: workflowSendMode?.state ?? (workflowExecutionArmed ? 'live' : 'draft-only'),
			currentGround: workflowSendMode?.effect ?? coordinationReadiness.effect,
			enabledBoundary: workflowSendMode?.unlock ?? coordinationReadiness.gate,
			closedBoundary: workflowSendMode?.unlock ?? coordinationReadiness.gate,
			gateText:
				workflowSendMode?.unlock ??
				gateSummary(workflowEffectsGate, {
					prefix: 'Workflow arming waits on side-effect execution proof.'
				})
		}),
		runtimeGateClaim({
			id: 'runtime-congressional-delivery',
			name: 'Execution gate / Congressional delivery',
			flagName: 'CONGRESSIONAL',
			enabled: FEATURES.CONGRESSIONAL,
			state: cwcSendMode?.state ?? (congressionalDeliveryArmed ? 'live' : 'gated'),
			currentGround: cwcSendMode?.effect ?? 'CWC mode is unread from buildSendReadiness.',
			enabledBoundary: cwcSendMode?.unlock ?? sendBoundaryGateSummary,
			closedBoundary: cwcSendMode?.unlock ?? sendBoundaryGateSummary,
			gateText:
				cwcSendMode?.unlock ??
				gateSummary(congressionalLaunchGate, {
					prefix: 'CWC proof delivery waits on proof transport readiness plus launch confirmation.'
				})
		}),
		runtimeGateClaim({
			id: 'runtime-event-artifacts',
			name: 'Execution gate / Event artifacts',
			flagName: 'EVENTS',
			enabled: FEATURES.EVENTS,
			state: eventArtifactMode?.state ?? 'gated',
			currentGround:
				eventArtifactMode?.effect ??
				'Event artifact claims stay dependency-first until the event-record gate opens; no RSVP or artifact path is claimed.',
			enabledBoundary:
				eventArtifactMode?.effect ??
				'Stronger attendance, decrypted export, and archive claims stay bounded.',
			closedBoundary:
				eventArtifactMode?.effect ??
				'Event records and artifacts stay dependency-first until the event artifact gate opens.',
			gateText: eventArtifactMode?.unlock ?? gateSummary(eventArtifactGate)
		}),
		runtimeGateClaim({
			id: 'runtime-coalition-proof',
			name: 'Execution gate / Coalition proof',
			flagName: 'NETWORKS',
			enabled: FEATURES.NETWORKS,
			state: coalitionReadiness.state,
			currentGround: coalitionReadiness.effect,
			enabledBoundary: coalitionReadiness.detail,
			closedBoundary: coalitionReadiness.gate,
			gateText: coalitionReadiness.gate
		}),
		runtimeGateClaim({
			id: 'runtime-delegated-civic-action',
			name: 'Execution gate / Delegated civic action',
			flagName: 'DELEGATION',
			enabled: FEATURES.DELEGATION,
			state: delegatedCivicActionState,
			currentGround: delegatedCivicActionGround,
			enabledBoundary: delegatedCivicActionGateSummary,
			closedBoundary: delegatedCivicActionGateSummary,
			gateText: delegatedCivicActionGateSummary
		})
	]);

	const claimBasis = $derived<ClaimBasis[]>([
		{
			id: 'basis-loaded-org-signal',
			name: 'Loaded org signal',
			state: loadedSliceCount === totalOrgSliceCount ? 'live' : 'partial',
			source: 'OrgSpacesData',
			proof:
				'People, Power, Results, and Substrate rows are loaded once by the org layout and threaded into Studio.',
			gate: 'Unread slices render dormant claim boundaries instead of fabricated counts.',
			metric: {
				value: loadedSliceCount,
				label: 'loaded slices',
				cite: 'OrgSpacesData layout load'
			}
		},
		{
			id: 'basis-studio-authoring-stream',
			name: 'Studio authoring stream',
			state: studioAuthoringReadiness.state,
			source: 'stream-decision-makers + stream-message',
			proof: studioAuthoringReadiness.effect,
			gate: studioAuthoringReadiness.gate,
			metric: {
				value: studioAuthoringReadiness.metric.value ?? studioAuthoringReadiness.liveStepCount,
				label: studioAuthoringReadiness.metric.value
					? studioAuthoringReadiness.metric.label
					: 'authoring contracts',
				cite: 'buildStudioAuthoringReadiness'
			}
		},
		{
			id: 'basis-platform-intake-registry',
			name: 'Platform intake registry',
			state: platformIntakeReadiness.state,
			source: 'platform export profiles + CP-platform-api-sync',
			proof: platformIntakeReadiness.effect,
			gate: platformIntakeReadiness.gate,
			metric: {
				value: platformIntakeReadiness.profileCount,
				label: 'recognized profiles',
				cite: 'buildPlatformIntakeReadiness'
			}
		},
		{
			id: 'basis-people-source-provenance',
			name: 'People source custody',
			state: peopleSourceProvenanceReadiness.state,
			source: 'supporters.getSummaryStats sourceCounts',
			proof: peopleSourceProvenanceReadiness.effect,
			gate: peopleSourceProvenanceReadiness.gate,
			metric: {
				value: peopleSourceProvenanceReadiness.metric.value,
				label: peopleSourceProvenanceReadiness.metric.label,
				cite: peopleSourceProvenanceReadiness.metric.cite
			}
		},
		{
			id: 'basis-people-segmentation-posture',
			name: 'People segmentation posture',
			state: peopleSegmentationReadiness.state,
			source: 'People segmentation slice + civic geography label gate',
			proof: peopleSegmentationReadiness.effect,
			gate: peopleSegmentationReadiness.gate,
			metric: {
				value: peopleSegmentationReadiness.metric.value,
				label: peopleSegmentationReadiness.metric.label,
				cite: 'buildPeopleSegmentationReadiness'
			}
		},
		{
			id: 'basis-consent-bound-reach',
			name: 'Consent-bound reach',
			state: emailListHealthReadiness.state,
			source: 'People emailHealth + email delivery gates',
			proof: emailListHealthReadiness.effect,
			gate: emailListHealthReadiness.gate,
			metric: {
				value: emailListHealthReadiness.metric.value,
				label: emailListHealthReadiness.metric.label,
				cite: 'buildEmailListHealthReadiness'
			}
		},
		{
			id: 'basis-text-delivery-posture',
			name: 'Text delivery posture',
			state: textDeliveryReadiness.state,
			source: 'People smsHealth + operating text delivery slice',
			proof: textDeliveryReadiness.effect,
			gate: textDeliveryReadiness.gate,
			metric: {
				value: textDeliveryReadiness.metric.value,
				label: textDeliveryReadiness.metric.label,
				cite: 'buildTextDeliveryReadiness'
			}
		},
		{
			id: 'basis-call-routing-posture',
			name: 'Call routing posture',
			state: callRoutingReadiness.state,
			source: 'calls.listCalls + getCallInitiationReadiness + membership role',
			proof: callRoutingReadiness.effect,
			gate: callRoutingReadiness.gate,
			metric: {
				value: callRoutingReadiness.metric.value,
				label: callRoutingReadiness.metric.label,
				cite: 'buildCallRoutingReadiness'
			}
		},
		{
			id: 'basis-donation-receipt-posture',
			name: 'Donation receipt posture',
			state: fundraisingReadiness.state,
			source: 'Operating fundraising slice + donation receipt gates',
			proof: fundraisingReadiness.effect,
			gate: fundraisingReadiness.gate,
			metric: {
				value: fundraisingReadiness.metric.value,
				label: fundraisingReadiness.metric.label,
				cite: 'buildFundraisingReadiness'
			}
		},
		{
			id: 'basis-coordination-logic-readiness',
			name: 'Coordination logic readiness',
			state: coordinationReadiness.state,
			source: 'Operating coordination slice + workflow execution gates',
			proof: coordinationReadiness.effect,
			gate: coordinationReadiness.gate,
			metric: {
				value: coordinationReadiness.metric.value,
				label: coordinationReadiness.metric.label,
				cite: 'buildCoordinationReadiness'
			}
		},
		{
			id: 'basis-operating-authority-readiness',
			name: 'Operating authority readiness',
			state: operatingAuthorityReadiness.state,
			source: 'Membership role + operating authority gates',
			proof: operatingAuthorityReadiness.effect,
			gate: operatingAuthorityReadiness.gate,
			metric: {
				value: operatingAuthorityReadiness.metric.value,
				label: operatingAuthorityReadiness.metric.label,
				cite: 'buildOperatingAuthorityReadiness'
			}
		},
		{
			id: 'basis-power-terrain-coverage',
			name: 'Power terrain coverage',
			state: powerTerrainReadiness.state,
			source: 'Power slice + terrain hypergraph gates',
			proof: powerTerrainReadiness.effect,
			gate: powerTerrainReadiness.gate,
			metric: {
				value: powerTerrainReadiness.terrainCount,
				label: 'loaded terrain',
				cite: 'buildPowerTerrainReadiness'
			}
		},
		{
			id: 'basis-legislative-monitoring-posture',
			name: 'Legislative monitoring posture',
			state: legislativeMonitoringReadiness.state,
			source: 'Power bill slice + monitoring gates',
			proof: legislativeMonitoringReadiness.effect,
			gate: legislativeMonitoringReadiness.gate,
			metric: {
				value: legislativeMonitoringReadiness.metric.value,
				label: legislativeMonitoringReadiness.metric.label,
				cite: 'buildLegislativeMonitoringReadiness'
			}
		},
		{
			id: 'basis-coalition-composition-posture',
			name: 'Coalition composition posture',
			state: coalitionReadiness.state,
			source: 'Operating coalition slice + coalition gates',
			proof: coalitionReadiness.effect,
			gate: coalitionReadiness.gate,
			metric: {
				value: coalitionReadiness.metric.value,
				label: coalitionReadiness.metric.label,
				cite: 'buildCoalitionReadiness'
			}
		},
		{
			id: 'basis-results-proof-posture',
			name: 'Results proof posture',
			state: resultsProofReadiness.state,
			source: 'Results slice + proof hypergraph gates',
			proof: resultsProofReadiness.effect,
			gate: resultsProofReadiness.gate,
			metric: {
				value: resultsProofReadiness.metric.value,
				label: resultsProofReadiness.metric.label,
				cite: 'buildResultsProofReadiness'
			}
		},
		{
			id: 'basis-accountability-response-posture',
			name: 'Accountability response posture',
			state: accountabilityResponseReadiness.state,
			source: 'Power scorecard aggregates + response hypergraph gates',
			proof: accountabilityResponseReadiness.effect,
			gate: accountabilityResponseReadiness.gate,
			metric: {
				value: accountabilityResponseReadiness.metric.value,
				label: accountabilityResponseReadiness.metric.label,
				cite: 'buildAccountabilityResponseReadiness'
			}
		},
		{
			id: 'basis-studio-recovery-envelope',
			name: 'Studio recovery envelope',
			state: 'partial',
			source: 'stream-message recoverable job',
			proof:
				'Studio sends job_id, input_hash, and a device-local recovery public key to recover authored artifacts when the stream closes early.',
			gate: gateSummary(messageProofGate, {
				prefix:
					'Artifact recovery and process memory are device-local; server-side process persistence and proof-bound delegated action remain gated.'
			}),
			metric: {
				value: null,
				label: 'active recovery job',
				cite: 'Studio activeMessageJob job_id/input_hash; not loaded into this map'
			}
		},
		{
			id: 'basis-message-trace-replay',
			name: 'Authoring trace replay',
			state: 'partial',
			source: 'agentTraces authoring trace endpoint',
			proof:
				'stream-message emits a trace id and records trace.start, source, artifact authoring, completion, and cost events when AGENT_TRACE_ENABLED is true.',
			gate: gateSummary(delegatedTraceGate, {
				prefix:
					'Authoring trace replay is operator-only, env-gated, sampled, TTL-bound, and internal-secret protected; delegated trace observability waits on this gate.'
			}),
			metric: {
				value: null,
				label: 'trace handle',
				cite: 'Studio activeMessageJob traceId; not loaded into this map'
			}
		},
		{
			id: 'basis-channel-gates',
			name: 'Channel gates',
			state: sendLoopState,
			source: 'Configured channel gates',
			proof:
				'Send readiness and the gated queue derive from runtime gates plus route-local delivery dependencies.',
			gate: sendLoopGate,
			metric: {
				value: sendLoopMetric.value,
				label: sendLoopMetric.label,
				cite: sendLoopMetric.cite
			}
		},
		{
			id: 'basis-quality-trigger',
			name: 'Quality trigger',
			state: debateTriggerGate.state,
			source:
				'convex/campaigns.ts + convex/debates.ts + src/routes/api/campaigns/[id]/debate/+server.ts',
			proof:
				'Verified action threshold crossing schedules atomicSpawnIfEligible, and the campaign debate route calls forceSpawnDebateForCampaign after editor-role checks.',
			gate: gateSummary(debateTriggerGate, {
				complete:
					'T5-1 is complete; keep on-chain stake, TEE verdict, and mainnet DebateMarket claims tied to the quality-settlement gate.'
			}),
			mark: debateTriggerGate.tasks,
			metric: {
				value: debateTriggerGate.completed,
				label: 'quality-trigger tasks complete',
				cite: debateTriggerGate.source
			}
		},
		...runtimeGateRows,
		{
			id: 'basis-task-hypergraph',
			name: 'Task hypergraph',
			state: gatedUnlockCount > 0 ? 'gated' : 'live',
			source: 'Implementation hypergraphs',
			proof:
				'The gate register names source chokepoints, task evidence, and unresolved dependency class before full realization is claimed.',
			gate: loadBearingGateSummary,
			metric: {
				value: unresolvedGateCount,
				label: 'unresolved gates',
				cite: 'docs/strategy/implementation-hypergraph + docs/strategy/next-implementation-hypergraph'
			}
		},
		{
			id: 'basis-data-honesty-audit',
			name: 'Data honesty audit',
			state: unresolvedHonestyCount > 0 ? 'partial' : 'live',
			source: 'Data hypergraph',
			proof: `${liveHonestyCount}/${dataHonestyMarkCount} data-honesty marks are ${stateLabel('live')}; unresolved marks keep their claim rows ${stateLabel('partial')}.`,
			gate:
				unresolvedHonestyCount > 0
					? `Read the individual audit rows before strengthening bounded claims: ${unresolvedHonestyMarks}.`
					: 'All data-honesty marks backing this map are armed.',
			mark: 'data-hypergraph',
			metric: {
				value: liveHonestyCount,
				label: 'verified marks',
				cite: 'docs/strategy/data-hypergraph/docs/INDEX.md'
			}
		},
		...honestyRows.map((row) => ({
			id: `basis-audit-${row.mark}`,
			name: `Audit mark / ${row.name}`,
			state: row.state,
			source: 'Data hypergraph',
			proof: row.evidence,
			gate:
				row.state === 'live'
					? `${row.mark} is ${stateLabel('live')}; this claim can support the map.`
					: dataHonestyBoundaryGate(row),
			mark: row.mark
		}))
	]);
	const heldRuntimeClaimBasisRows = $derived(runtimeGateRows.filter((row) => row.state !== 'live'));
	const firstHeldRuntimeClaim = $derived(heldRuntimeClaimBasisRows[0] ?? null);
	const claimBasisPressureReadouts = $derived<ClaimBasisPressureReadout[]>([
		{
			id: 'evidence-basis',
			label: 'Evidence basis',
			title: unresolvedBasisCount === 0 ? 'Claims backed' : 'Claims qualified',
			state: unresolvedBasisCount === 0 ? 'live' : 'partial',
			href: '#capability-basis',
			action: 'read claim basis',
			detail: `${loadedSliceCount}/${totalOrgSliceCount} org slices loaded; ${liveHonestyCount}/${dataHonestyMarkCount} data-honesty marks are ${stateLabel('live')}.`,
			gate: basisGapSummary,
			source: 'OrgSpacesData + data hypergraph',
			metric: {
				value: unresolvedBasisCount,
				label: 'basis gaps',
				cite: 'OrgSpacesData layout load + data-hypergraph'
			}
		},
		{
			id: 'first-honesty-gap',
			label: 'Honesty mark',
			title: firstUnresolvedHonestyRow
				? `${firstUnresolvedHonestyRow.mark} / ${firstUnresolvedHonestyRow.name}`
				: 'Data honesty clear',
			state: firstUnresolvedHonestyRow?.state ?? 'live',
			href: '#capability-basis',
			action: firstUnresolvedHonestyRow ? 'read honesty mark' : 'read data honesty',
			detail:
				firstUnresolvedHonestyRow?.evidence ??
				'All data-honesty audit marks backing this map are armed.',
			gate: firstUnresolvedHonestyRow
				? dataHonestyBoundaryGate(firstUnresolvedHonestyRow)
				: 'No unresolved data-honesty mark is currently visible.',
			source: 'docs/strategy/data-hypergraph/docs/INDEX.md',
			metric: {
				value: unresolvedHonestyCount,
				label: 'unresolved marks',
				cite: 'docs/strategy/data-hypergraph/docs/INDEX.md'
			}
		},
		{
			id: 'runtime-boundary',
			label: 'Execution boundary',
			title: firstHeldRuntimeClaim?.name ?? 'Execution gates clear',
			state: firstHeldRuntimeClaim?.state ?? 'live',
			href: '#capability-basis',
			action: firstHeldRuntimeClaim ? 'read execution boundary' : 'read execution basis',
			detail:
				firstHeldRuntimeClaim?.proof ??
				'No execution gate currently changes a visible verb into a held claim.',
			gate:
				firstHeldRuntimeClaim?.gate ?? 'Execution gates do not currently block claim-basis rows.',
			source: firstHeldRuntimeClaim?.source ?? 'src/lib/config/features.ts',
			metric: {
				value: heldRuntimeClaimBasisRows.length,
				label: 'held execution gates',
				cite: 'src/lib/config/features.ts'
			}
		}
	]);

	const firstViewportMoveContracts = $derived<StateLedgerSource[]>([
		{
			state: studioAuthoringReadiness.state,
			target: 'Grounded authoring',
			href: `${base}/studio#studio-intent`,
			action: 'open Studio intent',
			handoff: 'Studio intent',
			effect: studioAuthoringReadiness.effect,
			gate: studioAuthoringReadiness.gate,
			source: 'buildStudioAuthoringReadiness'
		},
		{
			state: studioScopeReadiness.state,
			target: 'Studio scope and recovery',
			href: `${base}/studio#studio-intent`,
			action: 'read Studio scope and recovery',
			handoff: 'Studio scope / recovery',
			effect: studioScopeReadiness.effect,
			gate: studioScopeReadiness.gate,
			source: 'buildStudioScopeReadiness'
		},
		sendReadiness.nextHeldMode
			? {
					state: sendReadiness.nextHeldMode.state,
					target: sendReadiness.nextHeldMode.label,
					href: sendReadiness.nextHeldMode.route,
					action: sendReadiness.nextHeldMode.action,
					handoff: sendReadiness.nextHeldMode.handoff,
					effect: sendReadiness.nextHeldMode.effect,
					gate: sendReadiness.nextHeldMode.unlock,
					source: sendReadiness.nextHeldMode.metric?.cite ?? 'buildSendReadiness'
				}
			: {
					state: sendBoundaryState,
					target: 'Send boundary clear',
					href: '#capability-send',
					action: 'read send readiness',
					handoff: 'Send readiness',
					effect: sendLoopSummary,
					gate: sendLoopGate,
					source: 'buildSendReadiness'
				},
		{
			state: loadBearingGate?.state ?? 'live',
			target: loadBearingGate?.name ?? 'No unresolved gate',
			href: '#capability-gates',
			action: 'read gate register',
			handoff: 'Gate register',
			effect: loadBearingGate?.blocks ?? 'No registered unresolved verb is blocking the map.',
			gate: loadBearingGateSummary,
			source: loadBearingGate?.gate.source ?? 'Task hypergraph gate register'
		}
	]);

	const visibleContractBaseStates = $derived<CapabilityState[]>([
		...workspacePosture.map((row) => row.state),
		...operatingReadout.map((row) => row.state),
		...firstViewportMoveContracts.map((move) => move.state),
		...claimBoundaries.map((boundary) => boundary.state),
		...loopPressureReadouts.map((readout) => readout.state),
		...criticalPathPressureReadouts.map((readout) => readout.state),
		...gatePressureReadouts.map((readout) => readout.state),
		...sendPressureReadouts.map((readout) => readout.state),
		...claimBasisPressureReadouts.map((readout) => readout.state),
		...clusterCoverage.map((row) => row.state),
		...capabilityCards.map((card) => card.state),
		...loopPhases.map((phase) => phase.state),
		...sendModes.map((mode) => mode.state),
		...launchPressureRows.map((pressure) => pressure.state),
		...compositionPaths.map((path) => path.state),
		...compositionPaths.flatMap((path) => path.steps.map((step) => step.state)),
		...studioAuthoringRows.map((row) => row.state),
		...platformProfilePressureReadouts.map((readout) => readout.state),
		...platformIntakeStageRows.map((row) => row.state),
		...platformProfileRows.flatMap((row) => [row.csvState, row.apiState]),
		...peopleSegmentationRows.map((row) => row.state),
		...emailListHealthRows.map((row) => row.state),
		...textDeliveryRows.map((row) => row.state),
		...textCarrierProofRows.map((row) => row.state),
		...callRoutingRows.map((row) => row.state),
		...powerTerrainPressureReadouts.map((readout) => readout.state),
		...powerTerrainRows.map((row) => row.state),
		...legislativeMonitoringPressureReadouts.map((readout) => readout.state),
		...legislativeMonitoringRows.map((row) => row.state),
		...coalitionPressureReadouts.map((readout) => readout.state),
		...coalitionRows.map((row) => row.state),
		...resultsProofPressureReadouts.map((readout) => readout.state),
		...resultsProofRows.map((row) => row.state),
		...accountabilityResponsePressureReadouts.map((readout) => readout.state),
		...accountabilityResponseRows.map((row) => row.state),
		...fundraisingPressureReadouts.map((readout) => readout.state),
		...fundraisingReceiptProofRows.map((row) => row.state),
		...fundraisingRows.map((row) => row.state),
		...coordinationPressureReadouts.map((readout) => readout.state),
		...coordinationRows.map((row) => row.state),
		...operatingAuthorityPressureReadouts.map((readout) => readout.state),
		...operatingAuthorityRows.map((row) => row.state),
		...criticalPathRows.map((row) => row.state),
		...gateRegister.map((gate) => gate.state),
		...claimBasis.map((claim) => claim.state)
	]);

	const visibleContractBaseCounts = $derived(
		visibleContractBaseStates.reduce(
			(acc, state) => {
				acc[state] += 1;
				return acc;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const firstLaunchPressureRow = $derived(launchPressureRows[0] ?? null);
	const highestFanoutLaunchPressureRow = $derived(
		launchPressureRows.reduce<LaunchPressureRow | null>(
			(current, row) => (!current || row.gate.downstream > current.gate.downstream ? row : current),
			null
		)
	);
	const heldVisibleContractCount = $derived(
		visibleContractBaseCounts['draft-only'] + visibleContractBaseCounts.gated
	);
	const launchVectorReadouts = $derived<LaunchVectorReadout[]>([
		{
			id: 'first-blocker',
			label: 'First unblock',
			title: firstLaunchPressureRow?.name ?? 'First-org pressure clear',
			state: firstLaunchPressureRow?.state ?? 'live',
			href: firstLaunchPressureRow?.href ?? '#launch-pressure',
			action: firstLaunchPressureRow?.action ?? 'read launch pressure',
			detail:
				firstLaunchPressureRow?.effect ??
				'No launch-grade blocker remains in the first-org pressure register.',
			gate: firstLaunchPressureRow
				? gateSummary(firstLaunchPressureRow.gate, { prefix: firstLaunchPressureRow.futureLift })
				: 'First-org pressure clear.',
			source: firstLaunchPressureRow?.gate.source ?? 'buildLaunchPressureRows',
			metric: {
				value: firstLaunchPressureRow?.order ?? 0,
				label: firstLaunchPressureRow ? 'launch order' : 'open blockers',
				cite: firstLaunchPressureRow?.gate.source ?? 'buildLaunchPressureRows'
			}
		},
		{
			id: 'largest-fanout',
			label: 'Largest fan-out',
			title: highestFanoutLaunchPressureRow?.name ?? 'No fan-out blocker',
			state: highestFanoutLaunchPressureRow?.state ?? 'live',
			href: highestFanoutLaunchPressureRow?.href ?? '#launch-pressure',
			action: highestFanoutLaunchPressureRow?.action ?? 'read launch pressure',
			detail:
				highestFanoutLaunchPressureRow?.nextLift ??
				'No launch-grade row is currently blocking downstream capability lift.',
			gate: highestFanoutLaunchPressureRow
				? gateSummary(highestFanoutLaunchPressureRow.gate, {
						prefix: highestFanoutLaunchPressureRow.blocked
					})
				: 'No unresolved launch-pressure fan-out remains.',
			source: highestFanoutLaunchPressureRow?.gate.source ?? 'buildLaunchPressureRows',
			metric: {
				value: highestFanoutLaunchPressureRow?.gate.downstream ?? 0,
				label: 'downstream items',
				cite: highestFanoutLaunchPressureRow?.gate.source ?? 'buildLaunchPressureRows'
			}
		},
		{
			id: 'held-contracts',
			label: 'Held surface',
			title: heldVisibleContractCount > 0 ? 'Held capability contracts' : 'No held contracts',
			state:
				heldVisibleContractCount === 0
					? 'live'
					: visibleContractBaseCounts.gated > 0
						? 'gated'
						: 'draft-only',
			href: '#capability-state-ledger',
			action: 'read state ledger',
			detail:
				heldVisibleContractCount > 0
					? heldContractPressureDetail(visibleContractBaseCounts)
					: 'The visible contract mix has no draft-only or not-armed rows.',
			gate: firstLaunchPressureRow
				? gateSummary(firstLaunchPressureRow.gate, {
						prefix: 'Start with the first launch-pressure row before strengthening held surfaces.'
					})
				: 'No launch-pressure blocker is available to prioritize from this surface.',
			source: 'Capability state ledger / buildLaunchPressureRows',
			metric: {
				value: heldVisibleContractCount,
				label: 'held contracts',
				cite: 'Capability state ledger visible contracts'
			}
		}
	]);

	const visibleContractStates = $derived<CapabilityState[]>([
		...visibleContractBaseStates,
		...launchVectorReadouts.map((readout) => readout.state)
	]);
	const visibleContractCount = $derived(visibleContractStates.length);

	const visibleContractCounts = $derived(
		visibleContractStates.reduce(
			(acc, state) => {
				acc[state] += 1;
				return acc;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const visibleHeldContractCount = $derived(
		visibleContractCounts['draft-only'] + visibleContractCounts.gated
	);

	const visibleContractSegments = $derived(
		operatorCapabilityStateRatioSegments(visibleContractCounts, { labelSuffix: ' contracts' })
	);

	const stateLedgerSources = $derived<StateLedgerSource[]>([
		...workspacePosture.map((row) => ({
			state: row.state,
			target: row.label,
			href: row.href,
			action: row.action,
			handoff: row.label,
			effect: row.summary,
			gate: row.gate,
			source: row.signal.cite
		})),
		...operatingReadout.map((row) => ({
			state: row.state,
			target: row.label,
			href: row.href,
			action: row.action,
			handoff: row.label,
			effect: row.summary,
			gate: row.gate,
			source: row.cite
		})),
		...firstViewportMoveContracts,
		...launchVectorReadouts.map((readout) => ({
			state: readout.state,
			target: readout.title,
			href: readout.href,
			action: readout.action,
			handoff: readout.label,
			effect: readout.detail,
			gate: readout.gate,
			source: readout.source
		})),
		...claimBoundaries.map((boundary) => ({
			state: boundary.state,
			target: boundary.headline,
			href: '#capability-claim-boundary',
			action: 'read claim boundary',
			handoff: boundary.label,
			effect: boundary.claim,
			gate: boundary.gate,
			source: boundary.metric.cite
		})),
		...loopPressureReadouts.map((readout) => ({
			state: readout.state,
			target: readout.title,
			href: readout.href,
			action: readout.action,
			handoff: readout.label,
			effect: readout.detail,
			gate: readout.gate,
			source: readout.source
		})),
		...criticalPathPressureReadouts.map((readout) => ({
			state: readout.state,
			target: readout.title,
			href: readout.href,
			action: readout.action,
			handoff: readout.label,
			effect: readout.detail,
			gate: readout.gate,
			source: readout.source
		})),
		...claimBasisPressureReadouts.map((readout) => ({
			state: readout.state,
			target: readout.title,
			href: readout.href,
			action: readout.action,
			handoff: readout.label,
			effect: readout.detail,
			gate: readout.gate,
			source: readout.source
		})),
		...launchPressureRows.map((row) => ({
			state: row.state,
			target: row.name,
			href: row.href,
			action: row.action,
			handoff: row.handoff,
			effect: row.effect,
			gate: gateSummary(row.gate, { prefix: row.futureLift }),
			source: row.gate.source
		})),
		...capabilityCards.map((card) => ({
			state: card.state,
			target: card.title,
			href: card.href,
			action: card.action,
			handoff: card.handoff,
			effect: card.effect,
			gate: gateSummary(card.nextGate, {
				prefix: card.futureLift,
				complete: card.futureLift
			}),
			source: card.metric?.cite ?? card.nextGate.source
		})),
		...sendModes.map((mode) => ({
			state: mode.state,
			target: mode.label,
			href: mode.route,
			action: mode.action,
			handoff: mode.handoff,
			effect: mode.effect,
			gate: mode.unlock,
			source: mode.metric?.cite ?? 'buildSendReadiness'
		})),
		...studioAuthoringRows.map((row) => ({
			state: row.state,
			target: row.label,
			href: row.href,
			action: row.action,
			handoff: row.handoff,
			effect: row.ground,
			gate: row.gate,
			source: row.metric.cite
		})),
		...compositionPaths.map((path) => ({
			state: path.state,
			target: path.title,
			href: path.href,
			action: path.action,
			handoff: path.workspaces.join(' / '),
			effect: path.promise,
			gate: gateSummary(path.weakestGate),
			source: path.metric?.cite ?? path.weakestGate.source
		})),
		...gateRegister.map((row) => ({
			state: row.state,
			target: row.name,
			href: '#capability-gates',
			action: 'read gate register',
			handoff: row.name,
			effect: row.blocks,
			gate: gateSummary(row.gate),
			source: row.gate.source
		}))
	]);

	const liveLedgerSource = $derived(
		stateLedgerSources.find((item) => item.state === 'live') ??
			fallbackLedgerSource('live', 'No armed contract surfaced')
	);
	const partialLedgerSource = $derived(
		stateLedgerSources.find((item) => item.state === 'partial') ??
			fallbackLedgerSource('partial', 'No bounded contract surfaced')
	);
	const draftOnlyLedgerSource = $derived(
		stateLedgerSources.find((item) => item.state === 'draft-only') ??
			fallbackLedgerSource('draft-only', 'No draft-only contract surfaced')
	);
	const gatedLedgerSource = $derived(
		stateLedgerSources.find((item) => item.state === 'gated') ??
			fallbackLedgerSource('gated', 'No dependency-first contract surfaced')
	);

	const visibleContractStateRows = $derived<StateContract[]>([
		{
			state: 'live',
			label: stateLabel('live'),
			count: visibleContractCounts.live,
			meaning: 'Armed output or computed result is present now.',
			target: liveLedgerSource.target,
			href: liveLedgerSource.href,
			action: liveLedgerSource.action,
			handoff: liveLedgerSource.handoff,
			effect: liveLedgerSource.effect,
			gate: liveLedgerSource.gate,
			source: liveLedgerSource.source
		},
		{
			state: 'partial',
			label: stateLabel('partial'),
			count: visibleContractCounts.partial,
			meaning: 'Usable surface with explicit trust, scope, or ops limits.',
			target: partialLedgerSource.target,
			href: partialLedgerSource.href,
			action: partialLedgerSource.action,
			handoff: partialLedgerSource.handoff,
			effect: partialLedgerSource.effect,
			gate: partialLedgerSource.gate,
			source: partialLedgerSource.source
		},
		{
			state: 'draft-only',
			label: stateLabel('draft-only'),
			count: visibleContractCounts['draft-only'],
			meaning: 'Can save or shape work; no side effect is claimed.',
			target: draftOnlyLedgerSource.target,
			href: draftOnlyLedgerSource.href,
			action: draftOnlyLedgerSource.action,
			handoff: draftOnlyLedgerSource.handoff,
			effect: draftOnlyLedgerSource.effect,
			gate: draftOnlyLedgerSource.gate,
			source: draftOnlyLedgerSource.source
		},
		{
			state: 'gated',
			label: stateLabel('gated'),
			count: visibleContractCounts.gated,
			meaning: 'Dependency first; route is for context, not execution.',
			target: gatedLedgerSource.target,
			href: gatedLedgerSource.href,
			action: gatedLedgerSource.action,
			handoff: gatedLedgerSource.handoff,
			effect: gatedLedgerSource.effect,
			gate: gatedLedgerSource.gate,
			source: gatedLedgerSource.source
		}
	]);

	const claimGrammarRows = $derived<ClaimGrammarRow[]>([
		{
			state: 'live',
			label: stateLabel('live'),
			verb: stateVerbLabel('live'),
			count: visibleContractCounts.live,
			allowed: 'Claim current output or computed result only when the route owns the side effect.',
			mustNot: 'Do not extend live language to mainnet, TEE, delegation, or receipt claims.',
			gate: 'Cited by live route data, feature gates, and completed hypergraph tasks.'
		},
		{
			state: 'partial',
			label: stateLabel('partial'),
			verb: stateVerbLabel('partial'),
			count: visibleContractCounts.partial,
			allowed: 'Use the surface with explicit scope, trust, or operations qualifiers.',
			mustNot:
				'Do not collapse bounded proof, reach, coalition, or reader claims into finished capability.',
			gate: basisGapSummary
		},
		{
			state: 'draft-only',
			label: stateLabel('draft-only'),
			verb: stateVerbLabel('draft-only'),
			count: visibleContractCounts['draft-only'],
			allowed: 'Save, shape, preview, or preserve work without claiming delivery side effects.',
			mustNot: 'Do not present drafts as sent, executed, automated, or carrier-delivered.',
			gate: sendLoopGate
		},
		{
			state: 'gated',
			label: stateLabel('gated'),
			verb: stateVerbLabel('gated'),
			count: visibleContractCounts.gated,
			allowed: 'Route to the boundary, task evidence, or dependency context.',
			mustNot: 'Do not expose an execution verb until the named gate is armed.',
			gate: loadBearingGateSummary
		}
	]);

	const operatorQueueCandidates = $derived<OperatorQueueItem[]>([
		{
			id: 'studio-grounded-authoring',
			label: 'Run grounded authoring',
			state: studioAuthoringReadiness.state,
			href: `${base}/studio#studio-intent`,
			action: 'open Studio intent',
			handoff: 'Studio intent',
			effect: studioAuthoringReadiness.effect,
			detail: studioAuthoringReadiness.detail,
			gate: studioAuthoringReadiness.gate,
			cluster: 'C-agentic'
		},
		{
			id: 'studio-scope-recovery',
			label: 'Read Studio scope and recovery',
			state: studioScopeReadiness.state,
			href: `${base}/studio#studio-intent`,
			action: 'read Studio scope and recovery',
			handoff: 'Studio scope / recovery',
			effect: studioScopeReadiness.effect,
			detail: studioScopeReadiness.detail,
			gate: studioScopeReadiness.gate,
			cluster: 'C-agentic / C-reach'
		},
		{
			id: 'people-proof-weight',
			label: 'Weight reach by proof',
			state: peopleGroundState,
			href: peopleGroundHref,
			action: peopleGroundAction,
			handoff: 'People ground',
			effect: peopleGroundSummary,
			detail: peopleGroundSignal,
			gate: peopleGroundGate,
			cluster: 'C-verification',
			metric: {
				value: peopleGroundMetric.value,
				label: peopleGroundMetric.label,
				cite: peopleGroundMetric.cite
			}
		},
		{
			id: 'people-source-provenance',
			label: 'Read source custody',
			state: peopleSourceProvenanceReadiness.state,
			href: peopleSourceProvenanceReadiness.href,
			action: peopleSourceProvenanceReadiness.action,
			handoff: peopleSourceProvenanceReadiness.handoff,
			effect: peopleSourceProvenanceReadiness.effect,
			detail: peopleSourceProvenanceReadiness.detail,
			gate: peopleSourceProvenanceReadiness.gate,
			cluster: 'C-data-sovereignty / C-reach',
			metric: {
				value: peopleSourceProvenanceReadiness.metric.value,
				label: peopleSourceProvenanceReadiness.metric.label,
				cite: peopleSourceProvenanceReadiness.metric.cite
			}
		},
		{
			id: 'platform-export-intake',
			label: 'Import platform exports',
			state: platformIntakeReadiness.state,
			href: `${base}/supporters/import#csv-intake`,
			action: 'import people',
			handoff: 'People import',
			effect: platformIntakeReadiness.effect,
			detail: platformIntakeReadiness.detail,
			gate: platformIntakeReadiness.gate,
			cluster: 'C-reach / C-data-sovereignty',
			metric: {
				value: platformExportProfileCount,
				label: 'recognized profiles',
				cite: 'src/lib/data/platform-export-profiles.ts'
			}
		},
		{
			id: 'people-segmentation-posture',
			label: 'Read segmentation posture',
			state: peopleSegmentationReadiness.state,
			href: peopleSegmentationReadiness.href,
			action: peopleSegmentationReadiness.action,
			handoff: peopleSegmentationReadiness.handoff,
			effect: peopleSegmentationReadiness.effect,
			detail: peopleSegmentationReadiness.detail,
			gate: peopleSegmentationReadiness.gate,
			cluster: 'C-reach / C-verification / C-data-sovereignty',
			metric: {
				value: peopleSegmentationReadiness.metric.value,
				label: peopleSegmentationReadiness.metric.label,
				cite: peopleSegmentationReadiness.metric.cite
			}
		},
		{
			id: 'consent-bound-reach',
			label: 'Read list health posture',
			state: emailListHealthReadiness.state,
			href: emailListHealthReadiness.href,
			action: emailListHealthReadiness.action,
			handoff: emailListHealthReadiness.handoff,
			effect: emailListHealthReadiness.effect,
			detail: emailListHealthReadiness.detail,
			gate: emailListHealthReadiness.gate,
			cluster: 'C-reach / C-reader-side / C-data-sovereignty',
			metric: {
				value: emailListHealthReadiness.metric.value,
				label: emailListHealthReadiness.metric.label,
				cite: emailListHealthReadiness.metric.cite
			}
		},
		{
			id: 'text-delivery-posture',
			label: 'Read text delivery posture',
			state: textDeliveryReadiness.state,
			href: textDeliveryReadiness.href,
			action: textDeliveryReadiness.action,
			handoff: textDeliveryReadiness.handoff,
			effect: textDeliveryReadiness.effect,
			detail: textDeliveryReadiness.detail,
			gate: textDeliveryReadiness.gate,
			cluster: 'C-reach / C-reader-side / C-data-sovereignty',
			metric: {
				value: textDeliveryReadiness.metric.value,
				label: textDeliveryReadiness.metric.label,
				cite: textDeliveryReadiness.metric.cite
			}
		},
		{
			id: 'call-routing-posture',
			label: 'Read call routing posture',
			state: callRoutingReadiness.state,
			href: callRoutingReadiness.href,
			action: callRoutingReadiness.action,
			handoff: callRoutingReadiness.handoff,
			effect: callRoutingReadiness.effect,
			detail: callRoutingReadiness.detail,
			gate: callRoutingReadiness.gate,
			cluster: 'C-reach / C-data-sovereignty / C-accountability',
			metric: {
				value: callRoutingReadiness.metric.value,
				label: callRoutingReadiness.metric.label,
				cite: callRoutingReadiness.metric.cite
			}
		},
		{
			id: 'legislative-monitoring-posture',
			label: 'Read legislative monitoring posture',
			state: legislativeMonitoringReadiness.state,
			href: legislativeMonitoringReadiness.href,
			action: legislativeMonitoringReadiness.action,
			handoff: legislativeMonitoringReadiness.handoff,
			effect: legislativeMonitoringReadiness.effect,
			detail: legislativeMonitoringReadiness.detail,
			gate: legislativeMonitoringReadiness.gate,
			cluster: 'C-agentic / C-reach / C-coordination-integrity',
			metric: {
				value: legislativeMonitoringReadiness.metric.value,
				label: legislativeMonitoringReadiness.metric.label,
				cite: legislativeMonitoringReadiness.metric.cite
			}
		},
		{
			id: 'coalition-posture',
			label: 'Read coalition posture',
			state: coalitionReadiness.state,
			href: coalitionReadiness.href,
			action: coalitionReadiness.action,
			handoff: coalitionReadiness.handoff,
			effect: coalitionReadiness.effect,
			detail: coalitionReadiness.detail,
			gate: coalitionReadiness.gate,
			cluster: 'C-composability / C-coordination-integrity / C-data-sovereignty',
			metric: {
				value: coalitionReadiness.metric.value,
				label: coalitionReadiness.metric.label,
				cite: coalitionReadiness.metric.cite
			}
		},
		{
			id: 'donation-receipt-posture',
			label: 'Read donation receipt posture',
			state: fundraisingReadiness.state,
			href: fundraisingReadiness.href,
			action: fundraisingReadiness.action,
			handoff: fundraisingReadiness.handoff,
			effect: fundraisingReadiness.effect,
			detail: fundraisingReadiness.detail,
			gate: fundraisingReadiness.gate,
			cluster: 'C-accountability / C-reader-side',
			metric: {
				value: fundraisingReadiness.metric.value,
				label: fundraisingReadiness.metric.label,
				cite: fundraisingReadiness.metric.cite
			}
		},
		{
			id: 'coordination-readiness',
			label: 'Read coordination readiness',
			state: coordinationReadiness.state,
			href: coordinationReadiness.href,
			action: coordinationReadiness.action,
			handoff: coordinationReadiness.handoff,
			effect: coordinationReadiness.effect,
			detail: coordinationReadiness.detail,
			gate: coordinationReadiness.gate,
			cluster: 'C-coordination-integrity / C-agentic',
			metric: {
				value: coordinationReadiness.metric.value,
				label: coordinationReadiness.metric.label,
				cite: coordinationReadiness.metric.cite
			}
		},
		{
			id: 'operating-authority',
			label: 'Read operating authority',
			state: operatingAuthorityReadiness.state,
			href: `${base}/studio#capability-operating-authority`,
			action: operatingAuthorityReadiness.action,
			handoff: operatingAuthorityReadiness.handoff,
			effect: operatingAuthorityReadiness.effect,
			detail: operatingAuthorityReadiness.detail,
			gate: operatingAuthorityReadiness.gate,
			cluster: 'C-data-sovereignty / C-composability / C-coordination-integrity',
			metric: {
				value: operatingAuthorityReadiness.metric.value,
				label: operatingAuthorityReadiness.metric.label,
				cite: operatingAuthorityReadiness.metric.cite
			}
		},
		{
			id: 'email-draft-handoff',
			label: 'Draft an armed handoff',
			state: 'partial',
			href: emailBodyHref,
			action: 'create draft',
			handoff: 'Email composer',
			effect:
				'Opens the mature composer; a composed Studio process can later hand off subject/body as a local draft.',
			detail:
				'Move authored work into the mature email composer while keeping merge and server send limits visible.',
			gate: gateSummary(emailProxyGate, {
				prefix: 'Proxy-backed email send is the next stronger claim.'
			}),
			cluster: 'C-reader-side',
			metric: {
				value: ret?.stats.sentEmails ?? null,
				label: 'sent emails',
				cite: 'OrgSpacesData.return.stats.sentEmails'
			}
		},
		{
			id: 'accountability-response',
			label: 'Read accountability response',
			state: accountabilityResponseReadiness.state,
			href: accountabilityResponseReadiness.href,
			action: accountabilityResponseReadiness.action,
			handoff: accountabilityResponseReadiness.handoff,
			effect: accountabilityResponseReadiness.effect,
			detail: accountabilityResponseReadiness.detail,
			gate: accountabilityResponseReadiness.gate,
			cluster: 'C-accountability / C-reader-side / C-quality-signaling',
			metric: {
				value: accountabilityResponseReadiness.metric.value,
				label: accountabilityResponseReadiness.metric.label,
				cite: accountabilityResponseReadiness.metric.cite
			}
		},
		{
			id: 'proof-artifact',
			label: 'Read proof artifact',
			state: resultsPacketRow?.state ?? resultsProofReadiness.state,
			href: resultsPacketRow?.href ?? resultsProofReadiness.href,
			action: resultsPacketRow?.action ?? resultsProofReadiness.action,
			handoff: resultsProofReadiness.handoff,
			effect: resultsPacketRow?.ground ?? resultsProofReadiness.effect,
			detail:
				'Treat packet and integrity metrics as a reader-facing artifact, not a generic reporting score.',
			gate: resultsPacketRow?.boundary ?? resultsProofReadiness.gate,
			cluster: 'C-accountability',
			metric: {
				value: resultsProofReadiness.metric.value,
				label: resultsProofReadiness.metric.label,
				cite: resultsProofReadiness.metric.cite
			}
		},
		{
			id: 'event-artifacts',
			label: 'Export event artifacts',
			state: eventArtifactMode?.state ?? 'gated',
			href: eventArtifactMode?.route ?? `${base}/events#event-export-boundary`,
			action: eventArtifactMode?.action ?? 'read event boundary',
			handoff: eventArtifactMode?.handoff ?? 'Event records',
			effect:
				eventArtifactMode?.effect ??
				'Event artifact claims stay dependency-first until the event-record gate opens; no RSVP or artifact path is claimed.',
			detail:
				'Use saved event records as public RSVP ground, then export calendar and bounded attendance artifacts.',
			gate: eventArtifactMode?.unlock ?? gateSummary(eventArtifactGate),
			cluster: eventArtifactMode?.cluster ?? 'C-data-sovereignty'
		}
	]);

	const safeQueue = $derived<OperatorQueueItem[]>(
		operatorQueueCandidates.filter((item) => item.state === 'live' || item.state === 'partial')
	);
	const heldSendModes = $derived(
		sendModes.filter((mode) => mode.state === 'draft-only' || mode.state === 'gated')
	);
	const heldSendHandoffs = $derived(new Set(heldSendModes.map((mode) => mode.handoff)));
	const gatedQueue = $derived<OperatorQueueItem[]>([
		...heldSendModes.map((mode) => ({
			id: `send-${mode.key}`,
			label: mode.label,
			state: mode.state,
			href: mode.route,
			action: mode.action,
			handoff: mode.handoff,
			effect: mode.effect,
			detail:
				mode.state === 'draft-only'
					? 'Use this surface to shape work only; no side effect is claimed.'
					: 'Use this route for context only; the dependency must land first.',
			gate: mode.unlock,
			cluster: mode.cluster
		})),
		...operatorQueueCandidates
			.filter(
				(item) =>
					(item.state === 'draft-only' || item.state === 'gated') &&
					!heldSendHandoffs.has(item.handoff)
			)
			.map((item) => ({
				id: item.id,
				label: item.label,
				state: item.state,
				href: item.href,
				action: item.action,
				handoff: item.handoff,
				effect: item.effect,
				detail:
					item.state === 'draft-only'
						? 'Use this surface to shape work only; no side effect is claimed.'
						: 'Use this route for context only; the dependency must land first.',
				gate: item.gate,
				cluster: item.cluster
			}))
	]);

	const immediateLiveMove = $derived(
		safeQueue.find((item) => item.state === 'live') ?? safeQueue[0] ?? null
	);
	const immediateBoundedMove = $derived(
		safeQueue.find((item) => item.state === 'partial') ??
			safeQueue.find((item) => item.state !== 'live') ??
			null
	);
	const immediateGatedMove = $derived(gatedQueue[0] ?? null);
	const safeQueueLiveCount = $derived(safeQueue.filter((item) => item.state === 'live').length);
	const safeQueuePartialCount = $derived(
		safeQueue.filter((item) => item.state === 'partial').length
	);
	const heldQueueDraftOnlyCount = $derived(
		gatedQueue.filter((item) => item.state === 'draft-only').length
	);
	const heldQueueGatedCount = $derived(gatedQueue.filter((item) => item.state === 'gated').length);
	const usableQueueState = $derived<CapabilityState>(
		safeQueue.length === 0 ? 'gated' : safeQueuePartialCount > 0 ? 'partial' : 'live'
	);
	const heldQueueState = $derived<CapabilityState>(
		gatedQueue.length === 0 ? 'live' : heldQueueDraftOnlyCount > 0 ? 'draft-only' : 'gated'
	);
	const queuePressureReadouts = $derived<QueuePressureReadout[]>([
		{
			id: 'usable-moves',
			label: 'Use now',
			title: 'Armed and bounded moves',
			state: usableQueueState,
			href: immediateLiveMove?.href ?? '#capability-gates',
			action: immediateLiveMove?.action ?? 'read gate register',
			detail:
				safeQueue.length > 0
					? `${safeQueueLiveCount} armed; ${safeQueuePartialCount} bounded. First handoff: ${immediateLiveMove?.handoff ?? 'none'}.`
					: 'No armed or bounded move is surfaced in the current map.',
			gate: immediateLiveMove?.gate ?? loadBearingGateSummary,
			source: 'operatorQueueCandidates',
			metric: {
				value: safeQueue.length,
				label: 'usable moves',
				cite: 'Operator queue safe lane'
			}
		},
		{
			id: 'held-verbs',
			label: 'Hold',
			title: 'Draft-only and dependency-first verbs',
			state: heldQueueState,
			href: immediateGatedMove?.href ?? '#capability-actions',
			action: immediateGatedMove?.action ?? 'read next moves',
			detail:
				gatedQueue.length > 0
					? `${heldQueueDraftOnlyCount} draft-only; ${heldQueueGatedCount} not armed. ${heldSendModes.length} are send-mode handoffs.`
					: 'No draft-only or dependency-first queue item is currently surfaced.',
			gate: immediateGatedMove?.gate ?? 'No held verb is currently queued.',
			source: 'sendModes + operatorQueueCandidates',
			metric: {
				value: gatedQueue.length,
				label: 'held verbs',
				cite: 'Operator queue held lane'
			}
		},
		{
			id: 'first-held',
			label: 'First held',
			title: immediateGatedMove?.label ?? 'No held verb',
			state: immediateGatedMove?.state ?? 'live',
			href: immediateGatedMove?.href ?? '#capability-actions',
			action: immediateGatedMove?.action ?? 'read next moves',
			detail:
				immediateGatedMove?.detail ?? 'All queued action handoffs are currently armed or bounded.',
			gate:
				immediateGatedMove?.gate ??
				'No draft-only or dependency-first queue item is currently surfaced.',
			source: immediateGatedMove?.handoff ?? 'Operator queue',
			metric: {
				value: immediateGatedMove ? 1 : 0,
				label: 'first held route',
				cite: 'Operator queue held lane'
			}
		}
	]);
	const heldOperatingSpineContractCount = $derived(
		visibleContractCounts['draft-only'] + visibleContractCounts.gated
	);
	const operatingSpine = $derived<OperatingSpineItem[]>([
		{
			id: 'move-now',
			label: 'Move now',
			state: usableQueueState,
			href: immediateLiveMove?.href ?? immediateBoundedMove?.href ?? '#capability-actions',
			action: immediateLiveMove?.action ?? immediateBoundedMove?.action ?? 'read next moves',
			value: safeQueue.length,
			unit: 'usable moves',
			cite: 'Operator queue safe lane',
			detail:
				safeQueue.length > 0
					? `${safeQueueLiveCount} armed; ${safeQueuePartialCount} bounded. First handoff: ${immediateLiveMove?.handoff ?? immediateBoundedMove?.handoff ?? 'none'}.`
					: 'No armed or bounded move is surfaced in the current map.',
			gate: immediateLiveMove?.gate ?? immediateBoundedMove?.gate ?? loadBearingGateSummary
		},
		{
			id: 'qualify',
			label: 'Qualify',
			state: unresolvedBasisCount === 0 ? 'live' : 'partial',
			href: '#capability-basis',
			action: 'read claim basis',
			value: visibleContractCounts.partial,
			unit: 'bounded contracts',
			cite: 'Capability map visible contracts',
			detail: `${loadedSliceCount}/${totalOrgSliceCount} org slices loaded; ${liveHonestyCount}/${dataHonestyMarkCount} data-honesty marks are ${stateLabel('live')}.`,
			gate: basisGapSummary
		},
		{
			id: 'hold',
			label: 'Hold',
			state: heldQueueState,
			href: immediateGatedMove?.href ?? '#capability-actions',
			action: immediateGatedMove?.action ?? 'read next moves',
			value: heldOperatingSpineContractCount,
			unit: 'held contracts',
			cite: 'Capability map visible contracts',
			detail:
				gatedQueue.length > 0
					? `${heldQueueDraftOnlyCount} draft-only; ${heldQueueGatedCount} not armed. ${heldSendModes.length} are send-mode handoffs.`
					: 'No draft-only or dependency-first queue item is currently surfaced.',
			gate: immediateGatedMove?.gate ?? sendLoopGate
		},
		{
			id: 'next-lift',
			label: 'Next lift',
			state: loadBearingGate?.state ?? 'live',
			href: '#capability-gates',
			action: 'read gate register',
			value: loadBearingGate?.gate.downstream ?? null,
			unit: 'downstream blocked',
			cite: loadBearingGate?.gate.source ?? 'Task hypergraph gate register',
			detail: loadBearingGate
				? `${loadBearingGate.name} is the highest fan-out unresolved gate in this map.`
				: 'No unresolved gate is currently registered in the map.',
			gate: loadBearingGateSummary
		}
	]);

	function stateLabel(state: CapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function stateVerbLabel(state: CapabilityState): string {
		return operatorCapabilityStateVerbLabel(state);
	}

	function actionLabel(state: CapabilityState, action: string): string {
		return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });
	}

	function heldContractPressureDetail(counts: Record<CapabilityState, number>): string {
		const draftOnlyCount = counts['draft-only'];
		const notArmedCount = counts.gated;
		const parts: string[] = [];
		if (draftOnlyCount > 0) {
			parts.push(
				`${draftOnlyCount} ${stateLabel('draft-only')} contract${draftOnlyCount === 1 ? '' : 's'} can shape or preserve work without side effects`
			);
		}
		if (notArmedCount > 0) {
			parts.push(
				`${notArmedCount} ${stateLabel('gated')} contract${notArmedCount === 1 ? '' : 's'} route to dependency-first ${stateVerbLabel('gated')} boundaries`
			);
		}
		return parts.length > 0
			? `${parts.join('; ')}.`
			: 'The visible contract mix has no draft-only or not-armed rows.';
	}

	function dataHonestyBoundaryGate(row: HonestyRow): string {
		return `${row.mark} keeps ${row.name} ${stateLabel('partial')}; treat the related claim as bounded evidence until the audit mark clears.`;
	}

	function unreadSliceClaimBoundary(sliceName: string, claimName: string): string {
		return `${sliceName} slice is unread; ${claimName} are not claimed or counted.`;
	}

	function loopPhaseAction(phase: LoopPhase): string {
		switch (phase.id) {
			case 'INTENT':
				return 'open Studio intent';
			case 'GROUND':
				return 'read proof ground';
			case 'AUTHOR':
				return 'open authoring loop';
			case 'RESOLVE':
				return 'open Power terrain';
			case 'SEND':
				return 'read send readiness';
			case 'AGGREGATE':
				return 'preview aggregate proof';
		}
	}

	function fallbackLedgerSource(state: CapabilityState, target: string): StateLedgerSource {
		return {
			state,
			target,
			href: '#capability-gates',
			action: 'read gate register',
			handoff: 'Capability map',
			effect: 'No representative route contract is surfaced for this state in the current map.',
			gate: 'Use the gate register and claim basis before making a stronger claim.',
			source: 'Capability map visible contracts'
		};
	}

	function weakestGate(gates: GateEvidence[]): GateEvidence {
		const deferred = gates.filter((gate) => gate.status !== 'completed');
		return (deferred.length > 0 ? deferred : gates).reduce((current, gate) =>
			gate.downstream > current.downstream ? gate : current
		);
	}

	function statePriority(state: CapabilityState): number {
		if (state === 'live') return 0;
		if (state === 'partial') return 1;
		if (state === 'draft-only') return 2;
		return 3;
	}

	function boundaryPriority(state: CapabilityState): number {
		if (state === 'gated') return 0;
		if (state === 'draft-only') return 1;
		if (state === 'partial') return 2;
		return 3;
	}

	function clusterLeadItem(items: ClusterEvidenceItem[]): ClusterEvidenceItem | null {
		return [...items].sort((a, b) => statePriority(a.state) - statePriority(b.state))[0] ?? null;
	}

	function clusterBoundaryItem(items: ClusterEvidenceItem[]): ClusterEvidenceItem | null {
		return (
			items
				.filter((item) => item.state !== 'live')
				.sort((a, b) => boundaryPriority(a.state) - boundaryPriority(b.state))[0] ?? null
		);
	}

	function clusterHeldCount(row: ClusterCoverageRow): number {
		return row.draftOnly + row.gated;
	}

	function clusterOrder(id: CapabilityClusterId): number {
		return CAPABILITY_CLUSTER_IDS.indexOf(id);
	}

	function compareClusterStrength(a: ClusterCoverageRow, b: ClusterCoverageRow): number {
		return (
			b.live - a.live ||
			b.partial - a.partial ||
			clusterHeldCount(a) - clusterHeldCount(b) ||
			b.total - a.total ||
			clusterOrder(a.id) - clusterOrder(b.id)
		);
	}

	function compareClusterConstraint(a: ClusterCoverageRow, b: ClusterCoverageRow): number {
		return (
			clusterHeldCount(b) - clusterHeldCount(a) ||
			b.gated - a.gated ||
			b.draftOnly - a.draftOnly ||
			b.total - a.total ||
			clusterOrder(a.id) - clusterOrder(b.id)
		);
	}

	function compareClusterMove(a: ClusterCoverageRow, b: ClusterCoverageRow): number {
		return (
			statePriority(a.state) - statePriority(b.state) ||
			clusterHeldCount(b) - clusterHeldCount(a) ||
			b.partial - a.partial ||
			clusterOrder(a.id) - clusterOrder(b.id)
		);
	}

	function compactClusterBalanceReadouts(
		readouts: Array<ClusterBalanceReadout | null>
	): ClusterBalanceReadout[] {
		return readouts.filter((readout): readout is ClusterBalanceReadout => Boolean(readout));
	}

	function clusterCoverageState(
		counts: Record<CapabilityState, number>,
		total: number
	): CapabilityState {
		if (total === 0) return 'gated';
		if (counts.live > 0 && counts.partial === 0 && counts['draft-only'] === 0 && counts.gated === 0)
			return 'live';
		if (counts.live > 0 || counts.partial > 0) return 'partial';
		if (counts['draft-only'] > 0) return 'draft-only';
		return 'gated';
	}

	function gateLabel(gate: GateEvidence): string {
		return `${gate.name} / ${gate.tasks}`;
	}

	function capabilityCardClusterLabel(cluster: CapabilityClusterId): string {
		return formatCapabilityClusters(cluster);
	}

	function gateSummary(
		gate: GateEvidence,
		options: { prefix?: string; complete?: string } = {}
	): string {
		return formatGateEvidence(gate, { ...options, density: 'operator' });
	}

	function runtimeGateClaim(input: RuntimeClaimBasisInput): ClaimBasis {
		const gate =
			input.gateText ??
			(input.gate
				? gateSummary(input.gate, { prefix: input.gatePrefix, complete: input.gateComplete })
				: 'No hypergraph gate registered for this execution gate.');
		return {
			id: input.id,
			name: input.name,
			state: input.state,
			source: 'src/lib/config/features.ts',
			proof: `Execution gate ${input.flagName}=${input.enabled ? 'true' : 'false'}. Current ground: ${input.currentGround} Claim boundary: ${input.enabled ? input.enabledBoundary : input.closedBoundary}`,
			gate,
			mark: `${input.flagName}=${input.enabled ? 'true' : 'false'}`
		};
	}

	function phaseTouches(cardPhase: string, phaseId: LoopPhase['id']): boolean {
		return cardPhase
			.split('/')
			.map((phase) => phase.trim().toUpperCase())
			.includes(phaseId);
	}
</script>

<section
	class="capability"
	style="--timing-slow: {TIMING.SLOW}ms; --easing: {EASING};"
	aria-labelledby="capability-title"
>
	<header class="capability-head">
		<div class="capability-copy">
			<span class="capability-kicker">Capability map</span>
			<h2 id="capability-title" class="capability-title">What Commons can realize now</h2>
			<span
				class="capability-head-count"
				aria-label={`Capability map: ${visibleContractCount} visible contracts; ${surfacedClusterCount}/${clusterCoverage.length} canonical clusters surfaced; ${visibleContractCounts.live} armed contracts; ${visibleContractCounts.partial} bounded contracts; ${visibleHeldContractCount} held contracts`}
			>
				<span class="capability-head-total">
					<Datum value={visibleContractCount} cite="Capability map visible contracts" />
					<span>contracts</span>
				</span>
				<span class="capability-head-split">
					<Datum value={surfacedClusterCount} cite="Capability coverage visible contracts" />
					<span>/</span>
					<Datum value={clusterCoverage.length} cite="CAPABILITY_CLUSTER_IDS" />
					<span>clusters surfaced</span>
					<span>/</span>
					<Datum value={visibleContractCounts.live} cite="Capability map visible contracts" />
					<span>armed</span>
					<span>/</span>
					<Datum value={visibleContractCounts.partial} cite="Capability map visible contracts" />
					<span>bounded</span>
					<span>/</span>
					<Datum value={visibleHeldContractCount} cite="Capability map visible contracts" />
					<span>held</span>
				</span>
			</span>
		</div>

		<div class="state-contract" aria-label="Visible capability contract state mix">
			<Ratio height={10} segments={visibleContractSegments} />
			<div class="contract-list">
				{#each visibleContractStateRows as contract (contract.state)}
					<div class="contract-row" data-state={contract.state}>
						<span class="contract-count">
							<Datum value={contract.count} cite="Capability map visible contracts" />
						</span>
						<span class="contract-name">{contract.label}</span>
						<span class="contract-meaning">{contract.meaning}</span>
					</div>
				{/each}
			</div>
		</div>
	</header>

	<section class="operating-spine" aria-label="Operating spine">
		<div class="operating-spine-head">
			<span class="operating-spine-title">Operating spine</span>
			<div class="operating-spine-axis" aria-label="Operating spine axis">
				<span>move</span>
				<span>qualify</span>
				<span>hold</span>
				<span>lift</span>
			</div>
		</div>
		<div class="operating-spine-grid">
			{#each operatingSpine as item (item.id)}
				<a
					class="operating-spine-row"
					href={item.href}
					data-state={item.state}
					data-sveltekit-preload-data="off"
					title="{item.label}: {item.detail} Gate: {item.gate}"
					aria-label="{item.label}: {stateLabel(item.state)}. {item.value ??
						'unread'} {item.unit}. {item.detail} Full gate: {item.gate}. Action: {actionLabel(
						item.state,
						item.action
					)}"
				>
					<span class="operating-spine-top">
						<span class="operating-spine-label">{item.label}</span>
						<span class="operating-spine-state">{stateLabel(item.state)}</span>
					</span>
					<span class="operating-spine-signal">
						<Datum value={item.value} cite={item.cite} />
						<span>{item.unit}</span>
					</span>
					<span class="operating-spine-detail">{item.detail}</span>
					<span class="operating-spine-gate">{item.gate}</span>
					<span class="operating-spine-action">{actionLabel(item.state, item.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		class="workspace-posture"
		aria-label="Workspace posture across Studio, People, Power, Results"
	>
		<div class="workspace-posture-head">
			<span class="workspace-posture-title">Workspace posture</span>
			<span
				class="workspace-posture-count"
				aria-label={`Workspace posture: ${workspacePosture.length} workspaces; ${workspacePostureStateCounts.live} armed; ${workspacePostureStateCounts.partial} bounded; ${workspacePostureStateCounts['draft-only'] + workspacePostureStateCounts.gated} held`}
			>
				<Datum value={workspacePosture.length} cite="Workspace posture rows" />
				<span>workspaces</span>
				<span class="workspace-posture-split">
					<Datum value={workspacePostureStateCounts.live} cite="Workspace posture rows" />
					armed /
					<Datum value={workspacePostureStateCounts.partial} cite="Workspace posture rows" />
					bounded /
					<Datum
						value={workspacePostureStateCounts['draft-only'] + workspacePostureStateCounts.gated}
						cite="Workspace posture rows"
					/>
					held
				</span>
			</span>
		</div>
		<Ratio segments={workspacePostureSegments} height={8} />
		<div class="workspace-posture-grid">
			{#each workspacePosture as item (item.id)}
				<a
					class="workspace-posture-row"
					href={item.href}
					data-state={item.state}
					data-sveltekit-preload-data="off"
					title="{item.label}: {item.summary} Gate: {item.gate}"
					aria-label="{item.label}: {stateLabel(item.state)}. {item.signal.value ?? 'unread'} {item
						.signal
						.label}. Ground: {item.ground}. Next lift: {item.nextLift}. Full gate: {item.gate}. Action: {actionLabel(
						item.state,
						item.action
					)}"
				>
					<span class="workspace-posture-top">
						<span class="workspace-posture-name">{item.label}</span>
						<span class="workspace-posture-state">{stateLabel(item.state)}</span>
					</span>
					<span class="workspace-posture-signal">
						<Datum value={item.signal.value} cite={item.signal.cite} />
						<span>{item.signal.label}</span>
					</span>
					<span class="workspace-posture-readout">
						<span class="workspace-posture-meta-label">Ground</span>
						<span>{item.ground}</span>
					</span>
					<span class="workspace-posture-readout workspace-posture-readout--next">
						<span class="workspace-posture-meta-label">Next</span>
						<span>{item.nextLift}</span>
					</span>
					<span class="workspace-posture-action">{actionLabel(item.state, item.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section class="operating-readout" aria-labelledby="operating-readout-title">
		<div class="readout-head">
			<span id="operating-readout-title" class="readout-title">Operating readout</span>
			<div class="readout-axis" aria-label="Operating readout axis">
				{#each operatingReadout as item (item.id)}
					<span data-state={item.state}>{item.label}</span>
				{/each}
			</div>
		</div>
		<div class="readout-grid">
			{#each operatingReadout as item (item.id)}
				<a
					class="readout-card"
					href={item.href}
					data-state={item.state}
					title="{item.label}: {item.summary} Gate: {item.gate}"
					aria-label="{item.label}: {stateLabel(item.state)}. {item.value ??
						'unread'} {item.unit}. Ground: {item.ground}. Next lift: {item.nextLift}. Full gate: {item.gate}. Action: {actionLabel(
						item.state,
						item.action
					)}"
				>
					<span class="readout-top">
						<span class="readout-label">{item.label}</span>
						<span class="readout-state">{stateLabel(item.state)}</span>
					</span>
					<span class="readout-metric">
						<Datum value={item.value} animate spring={SPRINGS.METRIC} cite={item.cite} />
						<span>{item.unit}</span>
					</span>
					<span class="readout-visual" aria-hidden="true">
						{#if item.visual === 'loop-ratio'}
							<Ratio segments={loopStateSegments} height={10} />
						{:else if item.visual === 'send-ratio'}
							<Ratio segments={sendModeSegments} height={10} />
						{:else if item.visual === 'basis-ratio'}
							<Ratio segments={basisSegments} height={10} />
						{:else if item.visual === 'gate-ratio'}
							<Ratio segments={gateStateSegments} height={10} />
						{/if}
					</span>
					<span class="readout-compact">
						<span class="readout-meta-label">Ground</span>
						<span>{item.ground}</span>
					</span>
					<span class="readout-compact readout-compact--next">
						<span class="readout-meta-label">Next</span>
						<span>{item.nextLift}</span>
					</span>
					<span class="readout-action">{actionLabel(item.state, item.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section id="capability-state-ledger" class="state-ledger" aria-labelledby="state-ledger-title">
		<div class="state-ledger-head">
			<div>
				<span class="state-ledger-kicker">Capability state ledger</span>
				<h3 id="state-ledger-title" class="state-ledger-title">What can move, and what cannot</h3>
			</div>
			<div class="state-ledger-axis" aria-label="Capability state ledger axis">
				<span>state</span>
				<span>handoff</span>
				<span>effect</span>
				<span>gate</span>
			</div>
		</div>

		<div class="state-ledger-grid" aria-label="Capability state ledger">
			{#each visibleContractStateRows as row (row.state)}
				<a
					class="state-ledger-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="state-ledger-count">
						<Datum value={row.count} cite="Capability map visible contracts" />
						<span>{row.label}</span>
					</span>
					<span class="state-ledger-main">
						<span class="state-ledger-target">{row.target}</span>
						<span class="state-ledger-meaning">{row.meaning}</span>
					</span>
					<span class="state-ledger-route">
						<span class="state-ledger-handoff">{row.handoff}</span>
						<span class="state-ledger-effect">{row.effect}</span>
					</span>
					<span class="state-ledger-gate">{row.gate}</span>
					<span class="state-ledger-source">{row.source}</span>
					<span class="state-ledger-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-cluster-coverage"
		class="cluster-coverage"
		aria-labelledby="cluster-coverage-title"
	>
		<div class="cluster-coverage-head">
			<div>
				<span class="cluster-coverage-kicker">Capability coverage</span>
				<h3 id="cluster-coverage-title" class="cluster-coverage-title">
					Nine clusters, current evidence
				</h3>
			</div>
			<div class="cluster-coverage-axis" aria-label="Capability coverage axis">
				<span>cluster</span>
				<span>state mix</span>
				<span>lead evidence</span>
				<span>next lift</span>
			</div>
		</div>

		<div class="cluster-coverage-contract">
			<Ratio segments={clusterCoverageSegments} height={8} />
			<span
				class="cluster-coverage-count"
				aria-label={`Capability coverage: ${clusterCoverage.length} canonical clusters; ${surfacedClusterCount} surfaced; ${liveClusterCount} armed; ${boundedClusterCount} bounded; ${heldClusterCount} held`}
			>
				<Datum value={clusterCoverage.length} cite="CAPABILITY_CLUSTER_IDS" />
				<span>clusters</span>
				<span class="cluster-coverage-split">
					<Datum value={surfacedClusterCount} cite="Capability coverage visible contracts" />
					surfaced /
					<Datum value={liveClusterCount} cite="Capability coverage visible contracts" />
					armed /
					<Datum value={boundedClusterCount} cite="Capability coverage visible contracts" />
					bounded /
					<Datum value={heldClusterCount} cite="Capability coverage visible contracts" />
					held
				</span>
			</span>
		</div>

		<div class="cluster-balance" aria-label="Capability portfolio balance">
			{#each clusterBalanceReadouts as readout (readout.id)}
				<a
					class="cluster-balance-cell"
					href={readout.href}
					data-state={readout.state}
					aria-label="{readout.label}: {readout.title}. {readout.detail}. Action: {actionLabel(
						readout.state,
						readout.action
					)}. Gate: {readout.gate}"
					data-sveltekit-preload-data="off"
				>
					<span class="cluster-balance-kicker">{readout.label}</span>
					<span class="cluster-balance-title">{readout.title}</span>
					<span class="cluster-balance-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="cluster-balance-detail">{readout.detail}</span>
					<span class="cluster-balance-gate">{readout.gate}</span>
					<span class="cluster-balance-source">{readout.source}</span>
					<span class="cluster-balance-action">{actionLabel(readout.state, readout.action)}</span>
				</a>
			{/each}
		</div>

		<div class="cluster-coverage-grid" aria-label="Nine capability cluster coverage">
			{#each clusterCoverage as row (row.id)}
				<a
					class="cluster-coverage-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="cluster-coverage-main">
						<span class="cluster-coverage-label">{row.label}</span>
						<span class="cluster-coverage-id">
							<RegistryMark variant="tag" value={row.id} copy={false} />
						</span>
					</span>
					<span class="cluster-coverage-state">{stateLabel(row.state)}</span>
					<span class="cluster-coverage-mix">
						<span
							><Datum value={row.live} cite="Capability coverage visible contracts" />
							{stateLabel('live')}</span
						>
						<span
							><Datum value={row.partial} cite="Capability coverage visible contracts" />
							{stateLabel('partial')}</span
						>
						<span
							><Datum value={row.draftOnly} cite="Capability coverage visible contracts" />
							{stateLabel('draft-only')}</span
						>
						<span
							><Datum value={row.gated} cite="Capability coverage visible contracts" />
							{stateLabel('gated')}</span
						>
					</span>
					<span class="cluster-coverage-lead">
						<span class="cluster-coverage-field-label">Lead evidence</span>
						<span>{row.lead}</span>
					</span>
					<span class="cluster-coverage-boundary">
						<span class="cluster-coverage-field-label">Next lift</span>
						<span>{row.boundary}</span>
					</span>
					<span class="cluster-coverage-gate">{row.boundaryGate}</span>
					<span class="cluster-coverage-source">{row.source} / next: {row.boundarySource}</span>
					<span class="cluster-coverage-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section id="capability-actions" class="action-strip" aria-labelledby="action-strip-title">
		<div class="action-strip-head">
			<span id="action-strip-title" class="action-strip-title">Next moves</span>
			<span class="action-strip-count" aria-label="Next moves state mix">
				{#each operatingSpine as item (item.id)}
					<span class="action-strip-count-item" data-state={item.state}>
						<Datum value={item.value} cite={item.cite} />
						<span>{item.label}</span>
					</span>
				{/each}
			</span>
		</div>
		<div class="action-strip-grid">
			{#if immediateLiveMove}
				<a
					class="action-tile"
					href={immediateLiveMove.href}
					data-state={immediateLiveMove.state}
					data-sveltekit-preload-data="off"
					aria-label="{immediateLiveMove.label}: {stateLabel(
						immediateLiveMove.state
					)}. {immediateLiveMove.effect}. Gate: {immediateLiveMove.gate}. Action: {actionLabel(
						immediateLiveMove.state,
						immediateLiveMove.action
					)}. Handoff: {immediateLiveMove.handoff}"
				>
					<span class="action-kicker">{stateLabel(immediateLiveMove.state)}</span>
					<span class="action-name">{immediateLiveMove.label}</span>
					<span class="action-effect">{immediateLiveMove.effect}</span>
					<span class="action-gate">{immediateLiveMove.gate}</span>
					<span class="action-foot">
						<span>{actionLabel(immediateLiveMove.state, immediateLiveMove.action)}</span>
						<span>{immediateLiveMove.handoff}</span>
					</span>
				</a>
			{/if}

			{#if immediateBoundedMove}
				<a
					class="action-tile"
					href={immediateBoundedMove.href}
					data-state={immediateBoundedMove.state}
					data-sveltekit-preload-data="off"
					aria-label="{immediateBoundedMove.label}: {stateLabel(
						immediateBoundedMove.state
					)}. {immediateBoundedMove.detail}. Gate: {immediateBoundedMove.gate}. Action: {actionLabel(
						immediateBoundedMove.state,
						immediateBoundedMove.action
					)}. Handoff: {immediateBoundedMove.handoff}"
				>
					<span class="action-kicker">{stateLabel(immediateBoundedMove.state)}</span>
					<span class="action-name">{immediateBoundedMove.label}</span>
					<span class="action-effect">{immediateBoundedMove.detail}</span>
					<span class="action-gate">{immediateBoundedMove.gate}</span>
					<span class="action-foot">
						<span>{actionLabel(immediateBoundedMove.state, immediateBoundedMove.action)}</span>
						<span>{immediateBoundedMove.handoff}</span>
					</span>
				</a>
			{/if}

			{#if immediateGatedMove}
				<a
					class="action-tile"
					href={immediateGatedMove.href}
					data-state={immediateGatedMove.state}
					data-sveltekit-preload-data="off"
					aria-label="{immediateGatedMove.label}: {stateLabel(
						immediateGatedMove.state
					)}. {immediateGatedMove.detail}. Gate: {immediateGatedMove.gate}. Action: {actionLabel(
						immediateGatedMove.state,
						immediateGatedMove.action
					)}. Handoff: {immediateGatedMove.handoff}"
				>
					<span class="action-kicker">{stateLabel(immediateGatedMove.state)}</span>
					<span class="action-name">{immediateGatedMove.label}</span>
					<span class="action-effect">{immediateGatedMove.detail}</span>
					<span class="action-gate">{immediateGatedMove.gate}</span>
					<span class="action-foot">
						<span>{actionLabel(immediateGatedMove.state, immediateGatedMove.action)}</span>
						<span>{immediateGatedMove.handoff}</span>
					</span>
				</a>
			{/if}

			<a
				class="action-tile"
				href="#capability-gates"
				data-state={loadBearingGate?.state ?? 'live'}
				aria-label="Load-bearing gate: {stateLabel(
					loadBearingGate?.state ?? 'live'
				)}. {loadBearingGate?.blocks ??
					'No registered unresolved verb is blocking the map.'} Gate: {loadBearingGate?.gate
					.dependency ?? 'No dependency gate registered.'}"
			>
				<span class="action-kicker">{stateLabel(loadBearingGate?.state ?? 'live')}</span>
				<span class="action-name">{loadBearingGate?.name ?? 'No unresolved gate'}</span>
				<span class="action-effect"
					>{loadBearingGate?.blocks ?? 'No registered unresolved verb is blocking the map.'}</span
				>
				<span class="action-gate"
					>{loadBearingGate?.gate.dependency ?? 'No dependency gate registered.'}</span
				>
				<span class="action-foot">
					<span>{loadBearingGate?.gate.tasks ?? 'no active gate'}</span>
					<span
						><Datum
							value={loadBearingGate?.gate.downstream ?? null}
							cite={loadBearingGate?.gate.source ?? 'Task hypergraph gate register'}
						/>
						downstream</span
					>
				</span>
			</a>
		</div>
	</section>

	<section
		id="capability-launch-vector"
		class="launch-vector"
		aria-labelledby="launch-vector-title"
	>
		<div class="launch-vector-head">
			<div>
				<span class="launch-vector-kicker">Launch vector</span>
				<h3 id="launch-vector-title" class="launch-vector-title">
					Which blocker changes the most visible surface
				</h3>
			</div>
			<span class="launch-vector-count" aria-label="Launch vector state mix">
				{#each launchVectorReadouts as readout (readout.id)}
					<span class="launch-vector-count-item" data-state={readout.state}>
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.label}</span>
					</span>
				{/each}
			</span>
		</div>

		<div class="launch-vector-grid" aria-label="Launch vector readout">
			{#each launchVectorReadouts as readout (readout.id)}
				<a
					class="launch-vector-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
				>
					<span class="launch-vector-kicker">{readout.label}</span>
					<span class="launch-vector-name">{readout.title}</span>
					<span class="launch-vector-state">{stateLabel(readout.state)}</span>
					<span class="launch-vector-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="launch-vector-detail">{readout.detail}</span>
					<span class="launch-vector-gate">{readout.gate}</span>
					<span class="launch-vector-source">{readout.source}</span>
					<span class="launch-vector-action">{actionLabel(readout.state, readout.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-grounded-authoring"
		class="power-terrain studio-authoring-readiness"
		aria-labelledby="studio-authoring-readiness-title"
	>
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">Grounded authoring evidence</span>
				<h3 id="studio-authoring-readiness-title" class="terrain-title">
					Where intent becomes an accountable authoring run
				</h3>
			</div>
			<span
				class="studio-authoring-count"
				aria-label={`Grounded authoring: ${studioAuthoringRows.length} contracts; ${studioAuthoringStateCounts.live} armed; ${studioAuthoringStateCounts.partial} bounded; ${studioAuthoringStateCounts['draft-only']} draft-only; ${studioAuthoringStateCounts.gated} not armed`}
			>
				<Datum value={studioAuthoringRows.length} cite="buildStudioAuthoringReadiness" />
				<span>contracts</span>
				<span class="studio-authoring-split">
					<Datum value={studioAuthoringStateCounts.live} cite="buildStudioAuthoringReadiness" />
					armed /
					<Datum value={studioAuthoringStateCounts.partial} cite="buildStudioAuthoringReadiness" />
					bounded /
					<Datum
						value={studioAuthoringStateCounts['draft-only']}
						cite="buildStudioAuthoringReadiness"
					/>
					draft /
					<Datum value={studioAuthoringStateCounts.gated} cite="buildStudioAuthoringReadiness" />
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-contract">
			<Ratio segments={studioAuthoringSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Grounded authoring contracts: ${studioAuthoringRows.length}; ${studioAuthoringStateCounts.live} armed; ${studioAuthoringStateCounts.partial} bounded; ${studioAuthoringStateCounts['draft-only']} draft-only; ${studioAuthoringStateCounts.gated} not armed`}
			>
				<Datum value={studioAuthoringRows.length} cite="buildStudioAuthoringReadiness" />
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum value={studioAuthoringStateCounts.live} cite="buildStudioAuthoringReadiness" />
					armed /
					<Datum value={studioAuthoringStateCounts.partial} cite="buildStudioAuthoringReadiness" />
					bounded /
					<Datum
						value={studioAuthoringStateCounts['draft-only']}
						cite="buildStudioAuthoringReadiness"
					/>
					draft /
					<Datum value={studioAuthoringStateCounts.gated} cite="buildStudioAuthoringReadiness" />
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="Grounded authoring readiness matrix">
			{#each studioAuthoringRows as row (row.key)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
						<span class="terrain-handoff">{row.handoff}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.gate}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section id="capability-composition" class="composition" aria-labelledby="composition-title">
		<div class="composition-head">
			<div>
				<span class="composition-kicker">Capability composition</span>
				<h3 id="composition-title" class="composition-title">Compound moves</h3>
			</div>
			<div class="composition-axis" aria-label="Capability composition axis">
				<span>path</span>
				<span>phase boundary</span>
				<span>weakest gate</span>
			</div>
		</div>

		<div class="composition-pressure" aria-label="Capability composition pressure">
			{#each compositionPressureReadouts as item (item.id)}
				<a
					class="composition-pressure-card"
					href={item.href}
					data-state={item.state}
					data-sveltekit-preload-data="off"
					title="{item.label}: {item.detail} Gate: {item.gate}"
					aria-label="{item.label}: {stateLabel(item.state)}. {item.metric.value ?? 'unread'} {item
						.metric.label}. {item.detail} Full gate: {item.gate}. Action: {actionLabel(
						item.state,
						item.action
					)}"
				>
					<span class="composition-pressure-top">
						<span class="composition-pressure-label">{item.label}</span>
						<span class="composition-pressure-state">{stateLabel(item.state)}</span>
					</span>
					<span class="composition-pressure-metric">
						<Datum value={item.metric.value} cite={item.metric.cite} />
						<span>{item.metric.label}</span>
					</span>
					<span class="composition-pressure-detail">{item.detail}</span>
					<span class="composition-pressure-gate">{item.gate}</span>
					<span class="composition-pressure-action">
						{actionLabel(item.state, item.action)}
					</span>
				</a>
			{/each}
		</div>

		<div class="path-grid">
			{#each compositionPaths as path (path.id)}
				<a
					class="path-card"
					href={path.href}
					data-state={path.state}
					data-sveltekit-preload-data="off"
				>
					<span class="path-top">
						<span class="path-id">{path.id}</span>
						<span class="path-state">{stateLabel(path.state)}</span>
					</span>

					<span class="path-title">{path.title}</span>

					<span class="path-sequence" aria-label={`${path.title} sequence`}>
						{#each path.sequence as step (step)}
							<span>{step}</span>
						{/each}
					</span>

					<span class="path-contract" aria-label={`${path.title} phase contract`}>
						{#each path.steps as step (`${path.id}-${step.phase}-${step.label}`)}
							<span class="path-step" data-state={step.state}>
								<span class="path-step-top">
									<span class="path-step-phase">{step.phase}</span>
									<span class="path-step-state">{stateLabel(step.state)}</span>
								</span>
								<span class="path-step-label">{step.label}</span>
								<span class="path-step-handoff">{step.handoff}</span>
								<span class="path-step-effect">{step.effect}</span>
								<span class="path-step-gate">{step.gate}</span>
							</span>
						{/each}
					</span>

					<span class="path-promise">{path.promise}</span>

					<span class="path-visual" aria-hidden="true">
						{#if path.visual === 'verification-ratio'}
							<Ratio segments={verificationSegments} height={12} />
						{:else if path.visual === 'packet-ratio'}
							<Ratio segments={packetSegments} height={12} />
						{:else if path.visual === 'rings'}
							<Rings tiers={ret?.tiers ?? []} size={48} />
						{:else if path.visual === 'pulse'}
							<Pulse values={pulseValues} width={128} height={30} />
						{/if}
					</span>

					<span class="path-meta">
						<span>{path.workspaces.join(' / ')}</span>
						<span>{formatCapabilityClusters(path.clusters)}</span>
					</span>

					{#if path.metric}
						<span class="path-metric">
							<Datum
								value={path.metric.value}
								animate
								spring={SPRINGS.METRIC}
								cite={path.metric.cite}
							/>
							<span>{path.metric.label}</span>
						</span>
					{/if}

					<span class="path-limit">{path.limit}</span>
					<span class="path-gate" data-state={path.weakestGate.state}>
						<span class="path-gate-kicker">weakest gate</span>
						<span class="path-gate-name">{path.weakestGate.name}</span>
						<span class="path-gate-tasks">{path.weakestGate.tasks}</span>
						<span class="path-gate-count">
							<Datum value={path.weakestGate.downstream} cite={path.weakestGate.source} />
							downstream
						</span>
					</span>
					<span class="path-foot">
						<span class="path-action">{actionLabel(path.state, path.action)}</span>
						<span class="path-unlock">{gateSummary(path.weakestGate)}</span>
					</span>
				</a>
			{/each}
		</div>
	</section>

	<section id="launch-pressure" class="gate-register" aria-labelledby="launch-pressure-title">
		<div class="gate-head">
			<div>
				<span class="gate-kicker">Launch pressure</span>
				<h3 id="launch-pressure-title" class="gate-title">First-org blockers</h3>
			</div>
			<span
				class="launch-pressure-count"
				aria-label={`Launch pressure: ${launchPressureRows.length} unresolved blockers; ${launchPressureStateCounts.partial} bounded; ${heldLaunchPressureCount} held; ${highestFanoutLaunchPressureRow?.gate.downstream ?? 0} downstream blocked`}
			>
				<Datum value={launchPressureRows.length} cite="buildLaunchPressureRows" />
				<span>blockers</span>
				<span class="launch-pressure-split">
					<Datum value={launchPressureStateCounts.partial} cite="buildLaunchPressureRows" />
					bounded /
					<Datum value={heldLaunchPressureCount} cite="buildLaunchPressureRows" />
					held /
					<Datum
						value={highestFanoutLaunchPressureRow?.gate.downstream ?? 0}
						cite={highestFanoutLaunchPressureRow?.gate.source ?? 'buildLaunchPressureRows'}
					/>
					downstream
				</span>
			</span>
		</div>

		<div class="gate-list">
			{#each launchPressureRows as row (row.id)}
				<a
					class="gate-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
					title="{row.name}: {row.currentGround} {row.blocked} {gateSummary(row.gate, {
						prefix: row.futureLift
					})}"
					aria-label="{row.name}. {stateLabel(
						row.state
					)}. Handoff: {row.handoff}. Ground: {row.ground}. Effect: {row.effect}. Next lift: {row.nextLift}. Gate: {gateSummary(
						row.gate,
						{ prefix: row.futureLift }
					)}. Action: {actionLabel(row.state, row.action)}"
				>
					<div class="gate-main">
						<span class="gate-name">{row.name}</span>
						<span class="gate-dependency">{row.handoff} / {row.ground}</span>
					</div>
					<span class="gate-state">{stateLabel(row.state)}</span>
					<span class="gate-status">{row.gate.status} · {row.gate.completed}/{row.gate.total}</span>
					<span class="gate-count">
						<Cite cite={row.gate.source} form="ghost">
							<Datum value={row.gate.downstream} />
						</Cite>
						<span>downstream</span>
					</span>
					<span class="gate-tasks">{row.gate.tasks}</span>
					<span class="gate-chokepoint">{actionLabel(row.state, row.action)}</span>
					<span class="gate-blocks">{row.effect}</span>
					<span class="gate-unlocks">{row.nextLift}</span>
					<span class="gate-clusters"
						>{formatCapabilityClusters(row.cluster)} / {row.gate.source}</span
					>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-claim-boundary"
		class="claim-boundary"
		aria-labelledby="claim-boundary-title"
	>
		<div class="boundary-head">
			<span id="claim-boundary-title" class="boundary-title">Claim boundary</span>
			<div class="boundary-axis" aria-label="Claim boundary axis">
				<span>claim</span>
				<span>qualifier</span>
				<span>blocked claim</span>
			</div>
		</div>
		<div class="boundary-pressure" aria-label="Claim boundary pressure">
			{#each claimPressureReadouts as item (item.id)}
				<a
					class="boundary-pressure-card"
					href={item.href}
					data-state={item.state}
					data-sveltekit-preload-data="off"
					aria-label={`${item.label}: ${stateLabel(item.state)}. ${item.detail} Gate: ${item.gate}`}
				>
					<span class="boundary-pressure-top">
						<span class="boundary-pressure-label">{item.label}</span>
						<span class="boundary-pressure-state">{stateLabel(item.state)}</span>
					</span>
					<span class="boundary-pressure-metric">
						<Datum value={item.metric.value} cite={item.metric.cite} />
						<span>{item.metric.label}</span>
					</span>
					<span class="boundary-pressure-detail">{item.detail}</span>
					<span class="boundary-pressure-gate">{item.gate}</span>
					<span class="boundary-pressure-action">{actionLabel(item.state, item.action)}</span>
				</a>
			{/each}
		</div>
		<div class="boundary-grid">
			{#each claimBoundaries as boundary (boundary.id)}
				<div class="boundary-card" data-state={boundary.state}>
					<span class="boundary-top">
						<span class="boundary-label">{boundary.label}</span>
						<span class="boundary-state">{stateLabel(boundary.state)}</span>
					</span>
					<span class="boundary-headline">{boundary.headline}</span>
					<span class="boundary-metric">
						<Datum
							value={boundary.metric.value}
							animate
							spring={SPRINGS.METRIC}
							cite={boundary.metric.cite}
						/>
						<span>{boundary.metric.label}</span>
					</span>
					<span class="boundary-claim">{boundary.claim}</span>
					<span class="boundary-evidence">{boundary.evidence}</span>
					<span class="boundary-gate">{boundary.gate}</span>
				</div>
			{/each}
		</div>
		<div class="claim-grammar" aria-label="Claim grammar by capability state">
			{#each claimGrammarRows as row (row.state)}
				<div class="claim-grammar-row" data-state={row.state}>
					<span class="claim-grammar-state">
						<span>{row.label}</span>
						<span>{stateLabel(row.state)}</span>
					</span>
					<span class="claim-grammar-count">
						<Datum value={row.count} cite="Capability map visible contracts" />
						<span>contracts</span>
					</span>
					<span class="claim-grammar-verb">{row.verb}</span>
					<span class="claim-grammar-allowed">{row.allowed}</span>
					<span class="claim-grammar-deny">{row.mustNot}</span>
					<span class="claim-grammar-gate">{row.gate}</span>
				</div>
			{/each}
		</div>
	</section>

	<section id="capability-loop" class="loop-rail" aria-labelledby="loop-rail-title">
		<div class="loop-rail-head">
			<span id="loop-rail-title" class="loop-rail-title">Verified action loop</span>
			<span
				class="loop-rail-count"
				aria-label={`Verified action loop: ${loopPhases.length} phases; ${loopPhaseStateCounts.live} armed; ${loopPhaseStateCounts.partial} bounded; ${heldLoopPhaseCount} held`}
			>
				<Datum value={loopPhases.length} cite="Operating loop readiness" />
				<span>phases</span>
				<span class="loop-rail-split">
					<Datum value={loopPhaseStateCounts.live} cite="Operating loop readiness" />
					armed /
					<Datum value={loopPhaseStateCounts.partial} cite="Operating loop readiness" />
					bounded /
					<Datum value={heldLoopPhaseCount} cite="Operating loop readiness" />
					held
				</span>
			</span>
		</div>
		<div class="loop-pressure" aria-label="Verified loop pressure">
			{#each loopPressureReadouts as readout (readout.id)}
				<a
					class="loop-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					aria-label={`${readout.label}: ${stateLabel(readout.state)}. ${readout.detail}`}
				>
					<span class="loop-pressure-kicker">{readout.label}</span>
					<span class="loop-pressure-title">{readout.title}</span>
					<span class="loop-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="loop-pressure-detail">{readout.detail}</span>
					<span class="loop-pressure-gate">{readout.gate}</span>
					<span class="loop-pressure-source">{readout.source}</span>
					<span class="loop-pressure-action">{actionLabel(readout.state, readout.action)}</span>
				</a>
			{/each}
		</div>
		<div class="loop-rail-track">
			{#each loopPhases as phase, i (phase.id)}
				<a
					class="loop-node"
					href={phase.href}
					data-state={phase.state}
					data-sveltekit-preload-data="off"
				>
					<span class="loop-node-top">
						<span class="loop-node-index"><Datum value={i + 1} /></span>
						<span class="loop-node-id">{phase.id}</span>
						<span class="loop-node-state">{stateLabel(phase.state)}</span>
					</span>
					<span class="loop-node-label">{phase.label}</span>
					<span class="loop-node-meta">
						<span>{phase.workspace}</span>
						<span>{formatCapabilityClusters(phase.clusters)}</span>
					</span>
					{#if phase.metric}
						<span class="loop-node-metric">
							<Datum
								value={phase.metric.value}
								animate
								spring={SPRINGS.METRIC}
								cite={phase.metric.cite}
							/>
							<span>{phase.metric.label}</span>
						</span>
					{/if}
					<span class="loop-node-unlock">{phase.unlock}</span>
				</a>
			{/each}
		</div>
	</section>

	<section class="capability-lattice" aria-labelledby="capability-lattice-title">
		<div class="lattice-head">
			<div>
				<span class="lattice-kicker">Capability footprint</span>
				<h3 id="capability-lattice-title" class="lattice-title">Where each capability acts</h3>
			</div>
			<span
				class="lattice-count"
				aria-label={`Capability footprint: ${capabilityLattice.length} capabilities; ${touchedLatticePhaseCount} phase touches; ${heldLatticeRowCount} held rows; ${highestFanoutLatticeRow?.gate.downstream ?? 0} downstream blocked`}
			>
				<Datum value={capabilityLattice.length} cite="capabilityCards" />
				<span>capabilities</span>
				<span class="lattice-count-split">
					<Datum value={touchedLatticePhaseCount} cite="capabilityLattice" />
					touches /
					<Datum value={heldLatticeRowCount} cite="capabilityLattice" />
					held /
					<Datum
						value={highestFanoutLatticeRow?.gate.downstream ?? 0}
						cite={highestFanoutLatticeRow?.gate.source ?? 'capabilityLattice'}
					/>
					downstream
				</span>
			</span>
		</div>

		<div class="lattice-grid" aria-label="Capability footprint across the verified action loop">
			<div class="lattice-row lattice-row--head" aria-hidden="true">
				<span class="lattice-corner">Capability</span>
				{#each loopPhases as phase (phase.id)}
					<span class="lattice-phase-head">{phase.id}</span>
				{/each}
				<span class="lattice-gate-head">Next gate</span>
			</div>
			{#each capabilityLattice as row (row.id)}
				<a
					class="lattice-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="lattice-capability">
						<span class="lattice-name">{row.title}</span>
						<span class="lattice-cluster">{row.name}</span>
						<span class="lattice-id">
							<RegistryMark variant="tag" value={row.cluster} copy={false} />
						</span>
						<span class="lattice-workspace">{row.workspace}</span>
					</span>
					{#each row.phases as phase (phase.id)}
						<span
							class="lattice-cell"
							data-state={phase.state ?? 'empty'}
							aria-label={`${row.name}: ${phase.id} ${phase.state ? stateLabel(phase.state) : 'not touched'}`}
							title={`${row.name} / ${phase.id}: ${phase.state ? stateLabel(phase.state) : 'not touched'}`}
						>
							{#if phase.state}
								<span class="lattice-mark"></span>
								<span class="sr-only">{phase.id} {stateLabel(phase.state)}</span>
							{/if}
						</span>
					{/each}
					<span class="lattice-gate" data-state={row.gate.state}>
						<span class="lattice-gate-name">{row.gate.name}</span>
						<span class="lattice-gate-tasks">{row.gate.tasks}</span>
						<span class="lattice-gate-count">
							<Datum value={row.gate.downstream} cite={row.gate.source} />
							downstream
						</span>
					</span>
					<span class="lattice-state">{stateLabel(row.state)}</span>
					<span class="lattice-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section class="posture" aria-labelledby="posture-title">
		<div class="posture-head">
			<span id="posture-title" class="posture-title">Operating posture</span>
			<span class="posture-mix" aria-label="Operating posture state mix">
				<span class="posture-mix-item" data-state="live">
					<Datum value={visibleContractCounts.live} />
					<span>{stateLabel('live')}</span>
				</span>
				<span class="posture-mix-item" data-state="partial">
					<Datum value={visibleContractCounts.partial} />
					<span>{stateLabel('partial')}</span>
				</span>
				<span class="posture-mix-item" data-state="held">
					<Datum value={visibleContractCounts['draft-only'] + visibleContractCounts.gated} />
					<span>held</span>
				</span>
			</span>
		</div>
		<div class="posture-grid">
			{#each operatingPosture as item (item.id)}
				<a
					class="posture-card"
					href={item.href}
					data-state={item.state}
					data-sveltekit-preload-data="off"
				>
					<span class="posture-top">
						<span class="posture-state">{stateLabel(item.state)}</span>
						<span class="posture-action">{actionLabel(item.state, item.action)}</span>
					</span>
					<span class="posture-name">{item.title}</span>
					<span class="posture-metric">
						<Datum
							value={item.metric.value}
							animate
							spring={SPRINGS.METRIC}
							cite={item.metric.cite}
						/>
						<span>{item.metric.label}</span>
					</span>
					<span class="posture-visual" aria-hidden="true">
						{#if item.visual === 'contract-ratio'}
							<Ratio segments={visibleContractSegments} height={10} />
						{:else if item.visual === 'verification-ratio'}
							<Ratio segments={verificationSegments} height={10} />
						{:else if item.visual === 'send-ratio'}
							<Ratio segments={sendModeSegments} height={10} />
						{:else if item.visual === 'packet-ratio'}
							<Ratio segments={packetSegments} height={10} />
						{/if}
					</span>
					<span class="posture-detail">{item.detail}</span>
					<span class="posture-gate">{item.gate}</span>
				</a>
			{/each}
		</div>
	</section>

	<section class="capability-shifts" aria-labelledby="capability-shifts-title">
		<div class="shift-head">
			<div>
				<span class="shift-kicker">Operational shifts</span>
				<h3 id="capability-shifts-title" class="shift-title">What Commons changes</h3>
			</div>
			<div class="shift-axis" aria-label="Operational shift axis">
				<span>incumbent mode</span>
				<span>Commons mode</span>
				<span>gate</span>
			</div>
		</div>

		<div class="shift-pressure" aria-label="Operational shift pressure">
			{#each shiftPressureReadouts as item (item.id)}
				<a
					class="shift-pressure-card"
					href={item.href}
					data-state={item.state}
					data-sveltekit-preload-data="off"
					title="{item.label}: {item.detail} Gate: {item.gate}"
					aria-label="{item.label}: {stateLabel(item.state)}. {item.metric.value ?? 'unread'} {item
						.metric.label}. {item.detail} Full gate: {item.gate}. Action: {actionLabel(
						item.state,
						item.action
					)}"
				>
					<span class="shift-pressure-top">
						<span class="shift-pressure-label">{item.label}</span>
						<span class="shift-pressure-state">{stateLabel(item.state)}</span>
					</span>
					<span class="shift-pressure-metric">
						<Datum value={item.metric.value} cite={item.metric.cite} />
						<span>{item.metric.label}</span>
					</span>
					<span class="shift-pressure-detail">{item.detail}</span>
					<span class="shift-pressure-gate">{item.gate}</span>
					<span class="shift-pressure-action">{actionLabel(item.state, item.action)}</span>
				</a>
			{/each}
		</div>

		<div class="shift-list">
			{#each capabilityShifts as shift (shift.id)}
				<a
					class="shift-row"
					href={shift.href}
					data-state={shift.state}
					data-sveltekit-preload-data="off"
				>
					<span class="shift-main">
						<span class="shift-name">{shift.title}</span>
						<span class="shift-from">{shift.from}</span>
						<span class="shift-to">{shift.to}</span>
					</span>
					<span class="shift-state">{stateLabel(shift.state)}</span>
					<span class="shift-signal">
						<span class="shift-visual" aria-hidden="true">
							{#if shift.visual === 'contract-ratio'}
								<Ratio segments={visibleContractSegments} height={8} />
							{:else if shift.visual === 'verification-ratio'}
								<Ratio segments={verificationSegments} height={8} />
							{:else if shift.visual === 'send-ratio'}
								<Ratio segments={sendModeSegments} height={8} />
							{:else if shift.visual === 'packet-ratio'}
								<Ratio segments={packetSegments} height={8} />
							{:else if shift.visual === 'rings'}
								<Rings tiers={ret?.tiers ?? []} size={36} />
							{:else if shift.visual === 'pulse'}
								<Pulse values={pulseValues} width={96} height={24} />
							{/if}
						</span>
						{#if shift.metric}
							<span class="shift-metric">
								<Datum
									value={shift.metric.value}
									animate
									spring={SPRINGS.METRIC}
									cite={shift.metric.cite}
								/>
								<span>{shift.metric.label}</span>
							</span>
						{/if}
					</span>
					<span class="shift-cluster">{formatCapabilityClusters(shift.cluster)}</span>
					<span class="shift-evidence">{shift.evidence}</span>
					<span class="shift-gate">{shift.gate}</span>
					<span class="shift-action">{actionLabel(shift.state, shift.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section class="platform-profiles" aria-labelledby="platform-profiles-title">
		<div class="profile-head">
			<div>
				<span class="profile-kicker">Source portability</span>
				<h3 id="platform-profiles-title" class="profile-title">
					Incumbent exports become source custody
				</h3>
			</div>
			<div class="profile-axis" aria-label="Source portability axis">
				<span>export</span>
				<span>custody</span>
				<span>sync</span>
				<span>gate</span>
			</div>
		</div>

		<div class="profile-pressure" aria-label="Source custody pressure">
			{#each platformProfilePressureReadouts as readout (readout.id)}
				<a
					class="profile-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail}. Gate: ${readout.gate}`}
				>
					<span class="profile-pressure-kicker">{readout.label}</span>
					<span class="profile-pressure-title">{readout.title}</span>
					<span class="profile-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="profile-pressure-detail">{readout.detail}</span>
					<span class="profile-pressure-gate">{readout.gate}</span>
					<span class="profile-pressure-source">{readout.source}</span>
					<span class="profile-pressure-action">
						{actionLabel(readout.state, readout.action)}
					</span>
				</a>
			{/each}
		</div>

		<div class="profile-stages" aria-label="Platform intake operating stages">
			{#each platformIntakeStageRows as row (row.id)}
				<a
					class="profile-stage"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
					aria-label={`${row.label}: ${stateLabel(row.state)}. ${row.effect}`}
				>
					<span class="profile-stage-main">
						<span class="profile-stage-kicker">{row.label}</span>
						<span class="profile-stage-title">{row.handoff}</span>
						<span class="profile-stage-cluster">{formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="profile-stage-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="profile-stage-effect">{row.effect}</span>
					<span class="profile-stage-gate">{row.gate}</span>
					<span class="profile-stage-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>

		<div class="profile-contract">
			<Ratio segments={platformApiProofSegments} height={8} />
			<span
				class="profile-contract-count"
				aria-label={`Direct sync proof contract: ${platformApiProofRows.length} rows; ${platformApiProofStateCounts.live} armed; ${platformApiProofStateCounts.partial} bounded; ${heldPlatformApiProofCount} held`}
			>
				<span class="profile-contract-total">
					<Datum
						value={platformApiProofRows.length}
						cite="buildPlatformIntakeReadiness proofRows"
					/>
					proof rows
				</span>
				<span class="profile-contract-split">
					armed
					<Datum value={platformApiProofStateCounts.live} cite="direct sync proof contract" />
					/ bounded
					<Datum value={platformApiProofStateCounts.partial} cite="direct sync proof contract" />
					/ held
					<Datum value={heldPlatformApiProofCount} cite="direct sync proof contract" />
				</span>
			</span>
		</div>

		<div class="profile-stages" aria-label="Direct platform sync proof contract">
			{#each platformApiProofRows as row (row.id)}
				<a
					class="profile-stage"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
					aria-label={`${row.label}: ${stateLabel(row.state)}. ${row.effect}`}
				>
					<span class="profile-stage-main">
						<span class="profile-stage-kicker">{row.label}</span>
						<span class="profile-stage-title">{row.handoff}</span>
						<span class="profile-stage-cluster">{formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="profile-stage-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="profile-stage-effect">{row.effect}</span>
					<span class="profile-stage-gate">{row.gate}</span>
					<span class="profile-stage-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>

		<div class="profile-contract">
			<Ratio segments={platformProfileSegments} height={8} />
			<span
				class="profile-contract-count"
				aria-label={`Source portability contract: ${platformExportProfileCount} recognized profiles; CSV source-custody ${platformProfileCsvStateCounts.live} armed, ${platformProfileCsvStateCounts.partial} bounded, ${heldPlatformProfileCsvCount} held; direct sync ${platformProfileApiStateCounts.live} armed, ${platformProfileApiStateCounts.partial} bounded, ${heldPlatformProfileApiCount} held`}
			>
				<span class="profile-contract-total">
					<Datum value={platformExportProfileCount} cite="PLATFORM_EXPORT_PROFILES.length" />
					profiles
				</span>
				<span class="profile-contract-split">
					CSV
					<Datum value={platformProfileCsvStateCounts.live} cite="buildPlatformIntakeReadiness" />
					armed /
					<Datum
						value={platformProfileCsvStateCounts.partial}
						cite="buildPlatformIntakeReadiness"
					/>
					bounded /
					<Datum value={heldPlatformProfileCsvCount} cite="buildPlatformIntakeReadiness" />
					held
				</span>
				<span class="profile-contract-split">
					direct sync
					<Datum value={platformProfileApiStateCounts.live} cite="buildPlatformIntakeReadiness" />
					armed /
					<Datum
						value={platformProfileApiStateCounts.partial}
						cite="buildPlatformIntakeReadiness"
					/>
					bounded /
					<Datum value={heldPlatformProfileApiCount} cite="buildPlatformIntakeReadiness" />
					held
				</span>
			</span>
		</div>

		<div class="profile-grid" aria-label="Recognized incumbent export profiles">
			{#each platformProfileRows as row (row.source)}
				<div class="profile-row" data-state={row.apiState}>
					<span class="profile-main">
						<span class="profile-label">{row.label}</span>
						<span class="profile-source">
							<RegistryMark variant="tag" value={row.source} copy={false} />
						</span>
						<span class="profile-cluster">{formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="profile-state-group" aria-label={`${row.label} profile contract`}>
						<a
							class="profile-state"
							href={row.csvHref}
							data-state={row.csvState}
							data-sveltekit-preload-data="off"
							aria-label={`${row.label}: CSV export profile ${stateLabel(row.csvState)}`}
						>
							<span>CSV profile</span>
							<span>{stateLabel(row.csvState)}</span>
						</a>
						<a
							class="profile-state"
							href={row.apiHref}
							data-state={row.apiState}
							data-sveltekit-preload-data="off"
							aria-label={`${row.label}: direct sync boundary ${stateLabel(row.apiState)}`}
						>
							<span>Direct sync</span>
							<span>{stateLabel(row.apiState)}</span>
						</a>
					</span>
					<span class="profile-fingerprint">
						{row.fingerprint}
						{#if row.requiredCount > 0}
							/ {row.requiredCount} required anchors
						{/if}
						<span class="profile-api-proof">Sync proof: {row.apiProofSummary}</span>
					</span>
					<span class="profile-metric">
						<Datum value={row.matchCount} cite="platform export profile header signatures" />
						<span>header signals</span>
						<span class="profile-metric-divider" aria-hidden="true">/</span>
						<Datum value={row.apiProofCount} cite="direct sync proof checklist" />
						<span>sync checks</span>
					</span>
					<span class="profile-gate">{gateSummary(row.gate)}</span>
					<span class="profile-action">{actionLabel(row.apiState, row.apiAction)}</span>
				</div>
			{/each}
		</div>
	</section>

	<section
		id="capability-people-segmentation"
		class="people-segmentation power-terrain"
		aria-labelledby="people-segmentation-title"
	>
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">People segmentation posture</span>
				<h3 id="people-segmentation-title" class="terrain-title">
					Where cohorts become proof-weighted reach
				</h3>
			</div>
			<span
				class="terrain-count"
				aria-label={`People segmentation posture: ${peopleSegmentationRows.length} contracts; ${peopleSegmentationStateCounts.live} armed; ${peopleSegmentationStateCounts.partial} bounded; ${heldPeopleSegmentationCount} held`}
			>
				<Datum value={peopleSegmentationRows.length} cite="buildPeopleSegmentationReadiness" />
				<span>contracts</span>
				<span class="terrain-count-split">
					<Datum
						value={peopleSegmentationStateCounts.live}
						cite="buildPeopleSegmentationReadiness"
					/>
					armed /
					<Datum
						value={peopleSegmentationStateCounts.partial}
						cite="buildPeopleSegmentationReadiness"
					/>
					bounded /
					<Datum value={heldPeopleSegmentationCount} cite="buildPeopleSegmentationReadiness" />
					held
				</span>
			</span>
		</div>

		<div class="terrain-contract">
			<Ratio segments={peopleSegmentationSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`People segmentation contracts: ${peopleSegmentationRows.length}; ${peopleSegmentationStateCounts.live} armed; ${peopleSegmentationStateCounts.partial} bounded; ${peopleSegmentationStateCounts['draft-only']} draft-only; ${peopleSegmentationStateCounts.gated} not armed`}
			>
				<Datum value={peopleSegmentationRows.length} cite="buildPeopleSegmentationReadiness" />
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum
						value={peopleSegmentationStateCounts.live}
						cite="buildPeopleSegmentationReadiness"
					/>
					armed /
					<Datum
						value={peopleSegmentationStateCounts.partial}
						cite="buildPeopleSegmentationReadiness"
					/>
					bounded /
					<Datum
						value={peopleSegmentationStateCounts['draft-only']}
						cite="buildPeopleSegmentationReadiness"
					/>
					draft /
					<Datum
						value={peopleSegmentationStateCounts.gated}
						cite="buildPeopleSegmentationReadiness"
					/>
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="People segmentation readiness matrix">
			{#each peopleSegmentationRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-list-health"
		class="list-health power-terrain"
		aria-labelledby="list-health-title"
	>
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">List health posture</span>
				<h3 id="list-health-title" class="terrain-title">Where reach stays consent-bound</h3>
			</div>
			<span
				class="terrain-count"
				aria-label={`List health posture: ${emailListHealthRows.length} contracts; ${emailListHealthStateCounts.live} armed; ${emailListHealthStateCounts.partial} bounded; ${heldEmailListHealthCount} held`}
			>
				<Datum value={emailListHealthRows.length} cite="buildEmailListHealthReadiness" />
				<span>contracts</span>
				<span class="terrain-count-split">
					<Datum value={emailListHealthStateCounts.live} cite="buildEmailListHealthReadiness" />
					armed /
					<Datum value={emailListHealthStateCounts.partial} cite="buildEmailListHealthReadiness" />
					bounded /
					<Datum value={heldEmailListHealthCount} cite="buildEmailListHealthReadiness" />
					held
				</span>
			</span>
		</div>

		<div class="terrain-contract">
			<Ratio segments={emailListHealthSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`List health contracts: ${emailListHealthRows.length}; ${emailListHealthStateCounts.live} armed; ${emailListHealthStateCounts.partial} bounded; ${emailListHealthStateCounts['draft-only']} draft-only; ${emailListHealthStateCounts.gated} not armed`}
			>
				<Datum value={emailListHealthRows.length} cite="buildEmailListHealthReadiness" />
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum value={emailListHealthStateCounts.live} cite="buildEmailListHealthReadiness" />
					armed /
					<Datum value={emailListHealthStateCounts.partial} cite="buildEmailListHealthReadiness" />
					bounded /
					<Datum
						value={emailListHealthStateCounts['draft-only']}
						cite="buildEmailListHealthReadiness"
					/>
					draft /
					<Datum value={emailListHealthStateCounts.gated} cite="buildEmailListHealthReadiness" />
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="List health readiness matrix">
			{#each emailListHealthRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-text-delivery"
		class="power-terrain text-delivery-readiness"
		aria-labelledby="text-delivery-readiness-title"
	>
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">Text delivery posture</span>
				<h3 id="text-delivery-readiness-title" class="terrain-title">
					Where phone reach stays custody-bound
				</h3>
			</div>
			<span
				class="terrain-count"
				aria-label={`Text delivery posture: ${textDeliveryRows.length} contracts; ${textDeliveryStateCounts.live} armed; ${textDeliveryStateCounts.partial} bounded; ${heldTextDeliveryCount} held`}
			>
				<Datum value={textDeliveryRows.length} cite="buildTextDeliveryReadiness" />
				<span>contracts</span>
				<span class="terrain-count-split">
					<Datum value={textDeliveryStateCounts.live} cite="buildTextDeliveryReadiness" />
					armed /
					<Datum value={textDeliveryStateCounts.partial} cite="buildTextDeliveryReadiness" />
					bounded /
					<Datum value={heldTextDeliveryCount} cite="buildTextDeliveryReadiness" />
					held
				</span>
			</span>
		</div>

		<div class="terrain-contract">
			<Ratio segments={textDeliverySegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Text delivery contracts: ${textDeliveryRows.length}; ${textDeliveryStateCounts.live} armed; ${textDeliveryStateCounts.partial} bounded; ${textDeliveryStateCounts['draft-only']} draft-only; ${textDeliveryStateCounts.gated} not armed`}
			>
				<Datum value={textDeliveryRows.length} cite="buildTextDeliveryReadiness" />
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum value={textDeliveryStateCounts.live} cite="buildTextDeliveryReadiness" />
					armed /
					<Datum value={textDeliveryStateCounts.partial} cite="buildTextDeliveryReadiness" />
					bounded /
					<Datum value={textDeliveryStateCounts['draft-only']} cite="buildTextDeliveryReadiness" />
					draft /
					<Datum value={textDeliveryStateCounts.gated} cite="buildTextDeliveryReadiness" />
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-contract">
			<Ratio segments={textCarrierProofSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Text carrier dispatch proof contract: ${textCarrierProofRows.length} rows; ${textCarrierProofStateCounts.live} armed; ${textCarrierProofStateCounts.partial} bounded; ${heldTextCarrierProofCount} held`}
			>
				<Datum value={textCarrierProofRows.length} cite="buildTextDeliveryReadiness proofRows" />
				<span>proof rows</span>
				<span class="terrain-contract-split">
					<Datum value={textCarrierProofStateCounts.live} cite="text carrier proof contract" />
					armed /
					<Datum value={textCarrierProofStateCounts.partial} cite="text carrier proof contract" />
					bounded /
					<Datum value={heldTextCarrierProofCount} cite="text carrier proof contract" />
					held
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="Text carrier dispatch proof contract">
			{#each textCarrierProofRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
					aria-label={`${row.label}: ${stateLabel(row.state)}. ${row.effect}`}
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta"
							>{row.handoff} / {formatCapabilityClusters(row.clusters)}</span
						>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.effect}</span>
					<span class="terrain-gate">{row.gate}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>

		<div class="terrain-grid" aria-label="Text delivery readiness matrix">
			{#each textDeliveryRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-call-routing"
		class="power-terrain call-routing-readiness"
		aria-labelledby="call-routing-readiness-title"
	>
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">Call routing posture</span>
				<h3 id="call-routing-readiness-title" class="terrain-title">
					Where a call record stays separate from a dial action
				</h3>
			</div>
			<span
				class="terrain-count"
				aria-label={`Call routing posture: ${callRoutingRows.length} contracts; ${callRoutingStateCounts.live} armed; ${callRoutingStateCounts.partial} bounded; ${heldCallRoutingCount} held`}
			>
				<Datum value={callRoutingRows.length} cite="buildCallRoutingReadiness" />
				<span>contracts</span>
				<span class="terrain-count-split">
					<Datum value={callRoutingStateCounts.live} cite="buildCallRoutingReadiness" />
					armed /
					<Datum value={callRoutingStateCounts.partial} cite="buildCallRoutingReadiness" />
					bounded /
					<Datum value={heldCallRoutingCount} cite="buildCallRoutingReadiness" />
					held
				</span>
			</span>
		</div>

		<div class="terrain-contract">
			<Ratio segments={callRoutingSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Call routing contracts: ${callRoutingRows.length}; ${callRoutingStateCounts.live} armed; ${callRoutingStateCounts.partial} bounded; ${callRoutingStateCounts['draft-only']} draft-only; ${callRoutingStateCounts.gated} not armed`}
			>
				<Datum value={callRoutingRows.length} cite="buildCallRoutingReadiness" />
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum value={callRoutingStateCounts.live} cite="buildCallRoutingReadiness" />
					armed /
					<Datum value={callRoutingStateCounts.partial} cite="buildCallRoutingReadiness" />
					bounded /
					<Datum value={callRoutingStateCounts['draft-only']} cite="buildCallRoutingReadiness" />
					draft /
					<Datum value={callRoutingStateCounts.gated} cite="buildCallRoutingReadiness" />
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="Call routing readiness matrix">
			{#each callRoutingRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section class="power-terrain" aria-labelledby="power-terrain-title">
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">Power terrain coverage</span>
				<h3 id="power-terrain-title" class="terrain-title">What the OS resolves against</h3>
			</div>
			<div class="terrain-axis" aria-label="Power terrain axis">
				<span>loaded</span>
				<span>held</span>
				<span>lift</span>
				<span>gate</span>
			</div>
		</div>

		<div class="terrain-pressure" aria-label="Power terrain pressure">
			{#each powerTerrainPressureReadouts as readout (readout.id)}
				<a
					class="terrain-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail}. Gate: ${readout.gate}`}
				>
					<span class="terrain-pressure-kicker">{readout.label}</span>
					<span class="terrain-pressure-title">{readout.title}</span>
					<span class="terrain-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="terrain-pressure-detail">{readout.detail}</span>
					<span class="terrain-pressure-gate">{readout.gate}</span>
					<span class="terrain-pressure-source">{readout.source}</span>
					<span class="terrain-pressure-action">
						{actionLabel(readout.state, readout.action)}
					</span>
				</a>
			{/each}
		</div>

		<div class="terrain-contract">
			<Ratio segments={powerTerrainSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Power terrain contracts: ${powerTerrainRows.length}; ${powerTerrainStateCounts.live} armed; ${powerTerrainStateCounts.partial} bounded; ${powerTerrainStateCounts['draft-only']} draft-only; ${powerTerrainStateCounts.gated} not armed`}
			>
				<Datum value={powerTerrainRows.length} cite="buildPowerTerrainReadiness" />
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum value={powerTerrainStateCounts.live} cite="buildPowerTerrainReadiness" />
					armed /
					<Datum value={powerTerrainStateCounts.partial} cite="buildPowerTerrainReadiness" />
					bounded /
					<Datum value={powerTerrainStateCounts['draft-only']} cite="buildPowerTerrainReadiness" />
					draft /
					<Datum value={powerTerrainStateCounts.gated} cite="buildPowerTerrainReadiness" />
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="Power terrain coverage matrix">
			{#each powerTerrainRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-legislative-monitoring"
		class="legislative-monitoring power-terrain"
		aria-labelledby="legislative-monitoring-title"
	>
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">Legislative monitoring posture</span>
				<h3 id="legislative-monitoring-title" class="terrain-title">
					Where bill terrain becomes civic watch
				</h3>
			</div>
			<div class="terrain-axis" aria-label="Legislative monitoring axis">
				<span>watch</span>
				<span>fan-out</span>
				<span>lift</span>
				<span>gate</span>
			</div>
		</div>

		<div class="terrain-pressure" aria-label="Legislative monitoring pressure">
			{#each legislativeMonitoringPressureReadouts as readout (readout.id)}
				<a
					class="terrain-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					title={`${readout.detail} ${readout.gate}`}
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail} ${readout.gate}`}
				>
					<span class="terrain-pressure-kicker">{readout.label}</span>
					<span class="terrain-pressure-title">{readout.title}</span>
					<span class="terrain-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="terrain-pressure-detail">{readout.detail}</span>
					<span class="terrain-pressure-gate">{readout.gate}</span>
					<span class="terrain-pressure-source">{readout.source}</span>
					<span class="terrain-pressure-action">
						{actionLabel(readout.state, readout.action)}
					</span>
				</a>
			{/each}
		</div>

		<div class="terrain-contract">
			<Ratio segments={legislativeMonitoringSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Legislative monitoring contracts: ${legislativeMonitoringRows.length}; ${legislativeMonitoringStateCounts.live} armed; ${legislativeMonitoringStateCounts.partial} bounded; ${legislativeMonitoringStateCounts['draft-only']} draft-only; ${legislativeMonitoringStateCounts.gated} not armed`}
			>
				<Datum
					value={legislativeMonitoringRows.length}
					cite="buildLegislativeMonitoringReadiness"
				/>
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum
						value={legislativeMonitoringStateCounts.live}
						cite="buildLegislativeMonitoringReadiness"
					/>
					armed /
					<Datum
						value={legislativeMonitoringStateCounts.partial}
						cite="buildLegislativeMonitoringReadiness"
					/>
					bounded /
					<Datum
						value={legislativeMonitoringStateCounts['draft-only']}
						cite="buildLegislativeMonitoringReadiness"
					/>
					draft /
					<Datum
						value={legislativeMonitoringStateCounts.gated}
						cite="buildLegislativeMonitoringReadiness"
					/>
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="Legislative monitoring readiness matrix">
			{#each legislativeMonitoringRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-coalition"
		class="power-terrain coalition-readiness"
		aria-labelledby="coalition-readiness-title"
	>
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">Coalition composition posture</span>
				<h3 id="coalition-readiness-title" class="terrain-title">
					Where networks become shared proof ground
				</h3>
			</div>
			<div class="terrain-axis" aria-label="Coalition composition axis">
				<span>membership</span>
				<span>proof</span>
				<span>lift</span>
				<span>gate</span>
			</div>
		</div>

		<div class="terrain-pressure" aria-label="Coalition composition pressure">
			{#each coalitionPressureReadouts as readout (readout.id)}
				<a
					class="terrain-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					title={`${readout.detail} ${readout.gate}`}
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail} ${readout.gate}`}
				>
					<span class="terrain-pressure-kicker">{readout.label}</span>
					<span class="terrain-pressure-title">{readout.title}</span>
					<span class="terrain-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="terrain-pressure-detail">{readout.detail}</span>
					<span class="terrain-pressure-gate">{readout.gate}</span>
					<span class="terrain-pressure-source">{readout.source}</span>
					<span class="terrain-pressure-action">
						{actionLabel(readout.state, readout.action)}
					</span>
				</a>
			{/each}
		</div>

		<div class="terrain-contract">
			<Ratio segments={coalitionSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Coalition contracts: ${coalitionRows.length}; ${coalitionStateCounts.live} armed; ${coalitionStateCounts.partial} bounded; ${coalitionStateCounts['draft-only']} draft-only; ${coalitionStateCounts.gated} not armed`}
			>
				<Datum value={coalitionRows.length} cite="buildCoalitionReadiness" />
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum value={coalitionStateCounts.live} cite="buildCoalitionReadiness" />
					armed /
					<Datum value={coalitionStateCounts.partial} cite="buildCoalitionReadiness" />
					bounded /
					<Datum value={coalitionStateCounts['draft-only']} cite="buildCoalitionReadiness" />
					draft /
					<Datum value={coalitionStateCounts.gated} cite="buildCoalitionReadiness" />
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="Coalition readiness matrix">
			{#each coalitionRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section class="power-terrain results-proof" aria-labelledby="results-proof-title">
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">Results proof posture</span>
				<h3 id="results-proof-title" class="terrain-title">What the OS can prove back</h3>
			</div>
			<div class="terrain-axis" aria-label="Results proof axis">
				<span>packet</span>
				<span>receipt</span>
				<span>lift</span>
				<span>gate</span>
			</div>
		</div>

		<div class="terrain-pressure" aria-label="Results proof pressure">
			{#each resultsProofPressureReadouts as readout (readout.id)}
				<a
					class="terrain-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					title={`${readout.detail} ${readout.gate}`}
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail} ${readout.gate}`}
				>
					<span class="terrain-pressure-kicker">{readout.label}</span>
					<span class="terrain-pressure-title">{readout.title}</span>
					<span class="terrain-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="terrain-pressure-detail">{readout.detail}</span>
					<span class="terrain-pressure-gate">{readout.gate}</span>
					<span class="terrain-pressure-source">{readout.source}</span>
					<span class="terrain-pressure-action">
						{actionLabel(readout.state, readout.action)}
					</span>
				</a>
			{/each}
		</div>

		<div class="terrain-contract">
			<Ratio segments={resultsProofSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Results proof contracts: ${resultsProofRows.length}; ${resultsProofStateCounts.live} armed; ${resultsProofStateCounts.partial} bounded; ${resultsProofStateCounts['draft-only']} draft-only; ${resultsProofStateCounts.gated} not armed`}
			>
				<Datum value={resultsProofRows.length} cite="buildResultsProofReadiness" />
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum value={resultsProofStateCounts.live} cite="buildResultsProofReadiness" />
					armed /
					<Datum value={resultsProofStateCounts.partial} cite="buildResultsProofReadiness" />
					bounded /
					<Datum value={resultsProofStateCounts['draft-only']} cite="buildResultsProofReadiness" />
					draft /
					<Datum value={resultsProofStateCounts.gated} cite="buildResultsProofReadiness" />
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="Results proof readiness matrix">
			{#each resultsProofRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
						<span class="terrain-handoff">{row.handoff}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-accountability-response"
		class="power-terrain accountability-response-readiness"
		aria-labelledby="accountability-response-title"
	>
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">Accountability response posture</span>
				<h3 id="accountability-response-title" class="terrain-title">
					Where reader signals become accountable ground
				</h3>
			</div>
			<div class="terrain-axis" aria-label="Accountability response axis">
				<span>response</span>
				<span>signals</span>
				<span>lift</span>
				<span>gate</span>
			</div>
		</div>

		<div class="terrain-pressure" aria-label="Accountability response pressure">
			{#each accountabilityResponsePressureReadouts as readout (readout.id)}
				<a
					class="terrain-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					title={`${readout.detail} ${readout.gate}`}
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail} ${readout.gate}`}
				>
					<span class="terrain-pressure-kicker">{readout.label}</span>
					<span class="terrain-pressure-title">{readout.title}</span>
					<span class="terrain-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="terrain-pressure-detail">{readout.detail}</span>
					<span class="terrain-pressure-gate">{readout.gate}</span>
					<span class="terrain-pressure-source">{readout.source}</span>
					<span class="terrain-pressure-action">
						{actionLabel(readout.state, readout.action)}
					</span>
				</a>
			{/each}
		</div>

		<div class="terrain-contract">
			<Ratio segments={accountabilityResponseSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Accountability response contracts: ${accountabilityResponseRows.length}; ${accountabilityResponseStateCounts.live} armed; ${accountabilityResponseStateCounts.partial} bounded; ${accountabilityResponseStateCounts['draft-only']} draft-only; ${accountabilityResponseStateCounts.gated} not armed`}
			>
				<Datum
					value={accountabilityResponseRows.length}
					cite="buildAccountabilityResponseReadiness"
				/>
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum
						value={accountabilityResponseStateCounts.live}
						cite="buildAccountabilityResponseReadiness"
					/>
					armed /
					<Datum
						value={accountabilityResponseStateCounts.partial}
						cite="buildAccountabilityResponseReadiness"
					/>
					bounded /
					<Datum
						value={accountabilityResponseStateCounts['draft-only']}
						cite="buildAccountabilityResponseReadiness"
					/>
					draft /
					<Datum
						value={accountabilityResponseStateCounts.gated}
						cite="buildAccountabilityResponseReadiness"
					/>
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="Accountability response readiness matrix">
			{#each accountabilityResponseRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-fundraising"
		class="power-terrain fundraising-readiness"
		aria-labelledby="fundraising-readiness-title"
	>
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">Funding action readiness</span>
				<h3 id="fundraising-readiness-title" class="terrain-title">
					Where donation intake becomes receipt posture
				</h3>
			</div>
			<div class="terrain-axis" aria-label="Funding action axis">
				<span>funding</span>
				<span>confirm</span>
				<span>lift</span>
				<span>gate</span>
			</div>
		</div>

		<div class="terrain-pressure" aria-label="Funding action pressure">
			{#each fundraisingPressureReadouts as readout (readout.id)}
				<a
					class="terrain-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					title={`${readout.detail} ${readout.gate}`}
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail} ${readout.gate}`}
				>
					<span class="terrain-pressure-kicker">{readout.label}</span>
					<span class="terrain-pressure-title">{readout.title}</span>
					<span class="terrain-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="terrain-pressure-detail">{readout.detail}</span>
					<span class="terrain-pressure-gate">{readout.gate}</span>
					<span class="terrain-pressure-source">{readout.source}</span>
					<span class="terrain-pressure-action">
						{actionLabel(readout.state, readout.action)}
					</span>
				</a>
			{/each}
		</div>

		<div class="terrain-contract">
			<Ratio segments={fundraisingSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Funding action contracts: ${fundraisingRows.length}; ${fundraisingStateCounts.live} armed; ${fundraisingStateCounts.partial} bounded; ${fundraisingStateCounts['draft-only']} draft-only; ${fundraisingStateCounts.gated} not armed`}
			>
				<Datum value={fundraisingRows.length} cite="buildFundraisingReadiness" />
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum value={fundraisingStateCounts.live} cite="buildFundraisingReadiness" />
					armed /
					<Datum value={fundraisingStateCounts.partial} cite="buildFundraisingReadiness" />
					bounded /
					<Datum value={fundraisingStateCounts['draft-only']} cite="buildFundraisingReadiness" />
					draft /
					<Datum value={fundraisingStateCounts.gated} cite="buildFundraisingReadiness" />
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-contract">
			<Ratio segments={fundraisingReceiptProofSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Funding receipt proof contract: ${fundraisingReceiptProofRows.length} rows; ${fundraisingReceiptProofStateCounts.live} armed; ${fundraisingReceiptProofStateCounts.partial} bounded; ${heldFundraisingReceiptProofCount} held`}
			>
				<Datum
					value={fundraisingReceiptProofRows.length}
					cite="buildFundraisingReadiness proofRows"
				/>
				<span>proof rows</span>
				<span class="terrain-contract-split">
					<Datum
						value={fundraisingReceiptProofStateCounts.live}
						cite="funding receipt proof contract"
					/>
					armed /
					<Datum
						value={fundraisingReceiptProofStateCounts.partial}
						cite="funding receipt proof contract"
					/>
					bounded /
					<Datum value={heldFundraisingReceiptProofCount} cite="funding receipt proof contract" />
					held
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="Funding receipt proof contract">
			{#each fundraisingReceiptProofRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
					aria-label={`${row.label}: ${stateLabel(row.state)}. ${row.effect}`}
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta"
							>{row.handoff} / {formatCapabilityClusters(row.clusters)}</span
						>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.effect}</span>
					<span class="terrain-gate">{row.gate}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>

		<div class="terrain-grid" aria-label="Fundraising readiness matrix">
			{#each fundraisingRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-coordination"
		class="power-terrain coordination-readiness"
		aria-labelledby="coordination-readiness-title"
	>
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">Coordination logic readiness</span>
				<h3 id="coordination-readiness-title" class="terrain-title">
					Where workflow drafts become auditable runs
				</h3>
			</div>
			<div class="terrain-axis" aria-label="Coordination logic axis">
				<span>definitions</span>
				<span>effects</span>
				<span>lift</span>
				<span>gate</span>
			</div>
		</div>

		<div class="terrain-pressure" aria-label="Coordination logic pressure">
			{#each coordinationPressureReadouts as readout (readout.id)}
				<a
					class="terrain-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					title={`${readout.detail} ${readout.gate}`}
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail} ${readout.gate}`}
				>
					<span class="terrain-pressure-kicker">{readout.label}</span>
					<span class="terrain-pressure-title">{readout.title}</span>
					<span class="terrain-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="terrain-pressure-detail">{readout.detail}</span>
					<span class="terrain-pressure-gate">{readout.gate}</span>
					<span class="terrain-pressure-source">{readout.source}</span>
					<span class="terrain-pressure-action">
						{actionLabel(readout.state, readout.action)}
					</span>
				</a>
			{/each}
		</div>

		<div class="terrain-contract">
			<Ratio segments={coordinationSegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Coordination contracts: ${coordinationRows.length}; ${coordinationStateCounts.live} armed; ${coordinationStateCounts.partial} bounded; ${coordinationStateCounts['draft-only']} draft-only; ${coordinationStateCounts.gated} not armed`}
			>
				<Datum value={coordinationRows.length} cite="buildCoordinationReadiness" />
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum value={coordinationStateCounts.live} cite="buildCoordinationReadiness" />
					armed /
					<Datum value={coordinationStateCounts.partial} cite="buildCoordinationReadiness" />
					bounded /
					<Datum value={coordinationStateCounts['draft-only']} cite="buildCoordinationReadiness" />
					draft /
					<Datum value={coordinationStateCounts.gated} cite="buildCoordinationReadiness" />
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="Coordination readiness matrix">
			{#each coordinationRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section
		id="capability-operating-authority"
		class="power-terrain operating-authority"
		aria-labelledby="operating-authority-title"
	>
		<div class="terrain-head">
			<div>
				<span class="terrain-kicker">Operating authority</span>
				<h3 id="operating-authority-title" class="terrain-title">
					Where org ground becomes enforceable capability
				</h3>
			</div>
			<div class="terrain-axis" aria-label="Operating authority axis">
				<span>authority</span>
				<span>substrate</span>
				<span>lift</span>
				<span>gate</span>
			</div>
		</div>

		<div class="terrain-pressure" aria-label="Operating authority pressure">
			{#each operatingAuthorityPressureReadouts as readout (readout.id)}
				<a
					class="terrain-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					title={`${readout.detail} ${readout.gate}`}
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail} ${readout.gate}`}
				>
					<span class="terrain-pressure-kicker">{readout.label}</span>
					<span class="terrain-pressure-title">{readout.title}</span>
					<span class="terrain-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="terrain-pressure-detail">{readout.detail}</span>
					<span class="terrain-pressure-gate">{readout.gate}</span>
					<span class="terrain-pressure-source">{readout.source}</span>
					<span class="terrain-pressure-action">
						{actionLabel(readout.state, readout.action)}
					</span>
				</a>
			{/each}
		</div>

		<div class="terrain-contract">
			<Ratio segments={operatingAuthoritySegments} height={8} />
			<span
				class="terrain-contract-count"
				aria-label={`Operating authority contracts: ${operatingAuthorityRows.length}; ${operatingAuthorityStateCounts.live} armed; ${operatingAuthorityStateCounts.partial} bounded; ${operatingAuthorityStateCounts['draft-only']} draft-only; ${operatingAuthorityStateCounts.gated} not armed`}
			>
				<Datum value={operatingAuthorityRows.length} cite="buildOperatingAuthorityReadiness" />
				<span>contracts</span>
				<span class="terrain-contract-split">
					<Datum
						value={operatingAuthorityStateCounts.live}
						cite="buildOperatingAuthorityReadiness"
					/>
					armed /
					<Datum
						value={operatingAuthorityStateCounts.partial}
						cite="buildOperatingAuthorityReadiness"
					/>
					bounded /
					<Datum
						value={operatingAuthorityStateCounts['draft-only']}
						cite="buildOperatingAuthorityReadiness"
					/>
					draft /
					<Datum
						value={operatingAuthorityStateCounts.gated}
						cite="buildOperatingAuthorityReadiness"
					/>
					not armed
				</span>
			</span>
		</div>

		<div class="terrain-grid" aria-label="Operating authority readiness matrix">
			{#each operatingAuthorityRows as row (row.id)}
				<a
					class="terrain-row"
					href={row.href}
					data-state={row.state}
					data-sveltekit-preload-data="off"
				>
					<span class="terrain-main">
						<span class="terrain-label">{row.label}</span>
						<span class="terrain-meta">{row.phase} / {formatCapabilityClusters(row.clusters)}</span>
					</span>
					<span class="terrain-state">{stateLabel(row.state)}</span>
					<span class="terrain-metric">
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
					<span class="terrain-ground">{row.ground}</span>
					<span class="terrain-gate">{row.boundary}</span>
					<span class="terrain-action">{actionLabel(row.state, row.action)}</span>
				</a>
			{/each}
		</div>
	</section>

	<section class="operator-queue" aria-labelledby="operator-queue-title">
		<div class="queue-head">
			<div>
				<span class="queue-kicker">Operator queue</span>
				<h3 id="operator-queue-title" class="queue-title">Act without overclaiming</h3>
			</div>
			<div class="queue-axis" aria-label="Operator queue axis">
				<span>use</span>
				<span>hold</span>
				<span>handoff</span>
				<span>gate</span>
			</div>
		</div>

		<div class="queue-pressure" aria-label="Operator queue pressure">
			{#each queuePressureReadouts as readout (readout.id)}
				<a
					class="queue-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					aria-label="{readout.label}: {readout.title}. {readout.detail}. Action: {actionLabel(
						readout.state,
						readout.action
					)}. Gate: {readout.gate}"
				>
					<span class="queue-pressure-kicker">{readout.label}</span>
					<span class="queue-pressure-title">{readout.title}</span>
					<span class="queue-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="queue-pressure-detail">{readout.detail}</span>
					<span class="queue-pressure-gate">{readout.gate}</span>
					<span class="queue-pressure-source">{readout.source}</span>
					<span class="queue-pressure-action">{actionLabel(readout.state, readout.action)}</span>
				</a>
			{/each}
		</div>

		<div class="queue-grid">
			<section class="queue-panel queue-panel--safe" aria-label="Use now">
				<div class="queue-panel-head">
					<span class="queue-panel-title">Use now</span>
					<span
						class="queue-panel-count"
						aria-label={`Use now: ${safeQueue.length} usable paths; ${safeQueueLiveCount} armed; ${safeQueuePartialCount} bounded`}
					>
						<Datum value={safeQueue.length} cite="Operator queue safe lane" />
						<span>usable</span>
						<span class="queue-panel-split">
							{safeQueueLiveCount} armed / {safeQueuePartialCount} bounded
						</span>
					</span>
				</div>
				<div class="queue-list">
					{#each safeQueue as item (item.id)}
						<a
							class="queue-row"
							href={item.href}
							data-state={item.state}
							data-sveltekit-preload-data="off"
						>
							<span class="queue-main">
								<span class="queue-label">{item.label}</span>
								<span class="queue-detail">{item.detail}</span>
								<span class="queue-handoff">{item.handoff}</span>
								<span class="queue-effect">{item.effect}</span>
							</span>
							<span class="queue-state">{stateLabel(item.state)}</span>
							<span class="queue-action">{actionLabel(item.state, item.action)}</span>
							{#if item.metric}
								<span class="queue-metric">
									<Datum
										value={item.metric.value}
										animate
										spring={SPRINGS.METRIC}
										cite={item.metric.cite}
									/>
									<span>{item.metric.label}</span>
								</span>
							{/if}
							<span class="queue-cluster">{formatCapabilityClusters(item.cluster)}</span>
							<span class="queue-gate">{item.gate}</span>
						</a>
					{/each}
				</div>
			</section>

			<section class="queue-panel queue-panel--gated" aria-label="Hold until armed">
				<div class="queue-panel-head">
					<span class="queue-panel-title">Hold until armed</span>
					<span
						class="queue-panel-count"
						aria-label={`Hold until armed: ${gatedQueue.length} held paths; ${heldQueueDraftOnlyCount} draft-only; ${heldQueueGatedCount} gated`}
					>
						<Datum value={gatedQueue.length} cite="Operator queue held lane" />
						<span>held</span>
						<span class="queue-panel-split">
							{heldQueueDraftOnlyCount} draft / {heldQueueGatedCount} gated
						</span>
					</span>
				</div>
				<div class="queue-list">
					{#each gatedQueue as item (item.id)}
						<a
							class="queue-row"
							href={item.href}
							data-state={item.state}
							data-sveltekit-preload-data="off"
						>
							<span class="queue-main">
								<span class="queue-label">{item.label}</span>
								<span class="queue-detail">{item.detail}</span>
								<span class="queue-handoff">{item.handoff}</span>
								<span class="queue-effect">{item.effect}</span>
							</span>
							<span class="queue-state">{stateLabel(item.state)}</span>
							<span class="queue-action">{actionLabel(item.state, item.action)}</span>
							<span class="queue-cluster">{formatCapabilityClusters(item.cluster)}</span>
							<span class="queue-gate">{item.gate}</span>
						</a>
					{/each}
				</div>
			</section>
		</div>
	</section>

	<section id="capability-basis" class="claim-basis" aria-labelledby="claim-basis-title">
		<div class="claim-head">
			<span id="claim-basis-title" class="claim-title">Claim basis</span>
			<span class="claim-axis" aria-label="Claim basis axis">
				<span>evidence</span>
				<span>audit</span>
				<span>boundary</span>
				<span>gate</span>
			</span>
		</div>
		<div class="claim-pressure" aria-label="Claim basis pressure">
			{#each claimBasisPressureReadouts as readout (readout.id)}
				<a
					class="claim-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail}`}
				>
					<span class="claim-pressure-kicker">{readout.label}</span>
					<span class="claim-pressure-title">{readout.title}</span>
					<span class="claim-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="claim-pressure-detail">{readout.detail}</span>
					<span class="claim-pressure-gate">{readout.gate}</span>
					<span class="claim-pressure-source">{readout.source}</span>
					<span class="claim-pressure-action">{actionLabel(readout.state, readout.action)}</span>
				</a>
			{/each}
		</div>
		<div class="claim-list">
			{#each claimBasis as claim (claim.id)}
				<div class="claim-row" data-state={claim.state}>
					<div class="claim-main">
						<span class="claim-name">{claim.name}</span>
						<span class="claim-proof">{claim.proof}</span>
					</div>
					<span class="claim-state">{stateLabel(claim.state)}</span>
					<span class="claim-source">{claim.source}</span>
					{#if claim.metric}
						<span class="claim-metric">
							<Datum
								value={claim.metric.value}
								animate
								spring={SPRINGS.METRIC}
								cite={claim.metric.cite}
							/>
							<span>{claim.metric.label}</span>
						</span>
					{/if}
					{#if claim.mark}
						<span class="claim-mark">
							<RegistryMark variant="tag" value={claim.mark} copy={false} />
						</span>
					{/if}
					<span class="claim-gate">{claim.gate}</span>
				</div>
			{/each}
		</div>
	</section>

	<section
		id="capability-critical-path"
		class="unlock-cascade"
		aria-labelledby="unlock-cascade-title"
	>
		<div class="cascade-head">
			<div>
				<span class="cascade-kicker">Critical path</span>
				<h3 id="unlock-cascade-title" class="cascade-title">
					What unlocks the next operating plane
				</h3>
			</div>
			<div class="cascade-axis" aria-label="Critical path axis">
				<span>load-bearing</span>
				<span>elapsed</span>
				<span>dependency</span>
				<span>gate</span>
			</div>
		</div>

		<div class="cascade-pressure" aria-label="Critical path pressure">
			{#each criticalPathPressureReadouts as readout (readout.id)}
				<a
					class="cascade-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail}`}
				>
					<span class="cascade-pressure-kicker">{readout.label}</span>
					<span class="cascade-pressure-title">{readout.title}</span>
					<span class="cascade-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="cascade-pressure-detail">{readout.detail}</span>
					<span class="cascade-pressure-gate">{readout.gate}</span>
					<span class="cascade-pressure-source">{readout.source}</span>
					<span class="cascade-pressure-action">{actionLabel(readout.state, readout.action)}</span>
				</a>
			{/each}
		</div>

		<div class="cascade-list">
			{#each unlockCascade as item (item.id)}
				<div class="cascade-row" data-state={item.state}>
					<div class="cascade-main">
						<span class="cascade-name">{item.name}</span>
						<span class="cascade-today">{item.today}</span>
					</div>
					<span class="cascade-state">{stateLabel(item.state)}</span>
					<span class="cascade-count"
						><Datum value={item.gate.downstream} cite={item.gate.source} /> downstream</span
					>
					<span class="cascade-elapsed">{item.elapsed}</span>
					<span class="cascade-dependency">{item.dependency}</span>
					<span class="cascade-tasks">{item.gate.tasks}</span>
					<span class="cascade-lift">{item.lift}</span>
					<span class="cascade-clusters">{formatCapabilityClusters(item.clusters)}</span>
				</div>
			{/each}
		</div>
	</section>

	<section id="capability-gates" class="gate-register" aria-labelledby="gate-register-title">
		<div class="gate-head">
			<div>
				<span class="gate-kicker">Gate register</span>
				<h3 id="gate-register-title" class="gate-title">Task hypergraph evidence</h3>
			</div>
			<div class="gate-axis" aria-label="Gate register axis">
				<span>status</span>
				<span>downstream</span>
				<span>blocked verb</span>
				<span>next lift</span>
			</div>
		</div>

		<div class="gate-pressure" aria-label="Gate register pressure">
			{#each gatePressureReadouts as readout (readout.id)}
				<a
					class="gate-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail}. Gate: ${readout.gate}`}
				>
					<span class="gate-pressure-kicker">{readout.label}</span>
					<span class="gate-pressure-title">{readout.title}</span>
					<span class="gate-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="gate-pressure-detail">{readout.detail}</span>
					<span class="gate-pressure-gate">{readout.gate}</span>
					<span class="gate-pressure-source">{readout.source}</span>
					<span class="gate-pressure-action">{actionLabel(readout.state, readout.action)}</span>
				</a>
			{/each}
		</div>

		<div class="gate-list">
			{#each gateRegister as row (row.id)}
				<div class="gate-row" data-state={row.state}>
					<div class="gate-main">
						<span class="gate-name">{row.name}</span>
						<span class="gate-dependency">{row.gate.dependency}</span>
					</div>
					<span class="gate-state">{stateLabel(row.state)}</span>
					<span class="gate-status">{row.gate.status}</span>
					<span class="gate-count"
						><Datum value={row.gate.downstream} cite={row.gate.source} /> downstream</span
					>
					<span class="gate-tasks">{row.gate.tasks}</span>
					<span class="gate-chokepoint">{row.gate.chokepoint}</span>
					<span class="gate-blocks">{row.blocks}</span>
					<span class="gate-unlocks">{row.unlocks}</span>
					<span class="gate-clusters">{formatCapabilityClusters(row.gate.clusters)}</span>
				</div>
			{/each}
		</div>
	</section>

	<div id="capability-send" class="readiness" aria-label="Send readiness">
		<div class="readiness-head">
			<span class="readiness-title">Send readiness</span>
			<div class="readiness-axis" aria-label="Send readiness axis">
				<span>mode</span>
				<span>state</span>
				<span>handoff</span>
				<span>gate</span>
			</div>
		</div>

		<div class="send-pressure" aria-label="Send readiness pressure">
			{#each sendPressureReadouts as readout (readout.id)}
				<a
					class="send-pressure-cell"
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					aria-label={`${readout.label}: ${readout.title}. ${readout.detail}. Gate: ${readout.gate}`}
				>
					<span class="send-pressure-kicker">{readout.label}</span>
					<span class="send-pressure-title">{readout.title}</span>
					<span class="send-pressure-metric">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="send-pressure-detail">{readout.detail}</span>
					<span class="send-pressure-gate">{readout.gate}</span>
					<span class="send-pressure-source">{readout.source}</span>
					<span class="send-pressure-action">{actionLabel(readout.state, readout.action)}</span>
				</a>
			{/each}
		</div>

		<div class="mode-list">
			{#each sendModes as mode (mode.key)}
				<a
					class="mode-row"
					href={mode.route}
					data-state={mode.state}
					data-sveltekit-preload-data="off"
				>
					<span class="mode-main">
						<span class="mode-name">{mode.label}</span>
						<span class="mode-cluster">{formatCapabilityClusters(mode.cluster)}</span>
						<span class="mode-handoff">{mode.handoff}</span>
						<span class="mode-effect">{mode.effect}</span>
						{#if mode.metric}
							<span class="mode-metric">
								<Datum value={mode.metric.value} cite={mode.metric.cite} />
								<span>{mode.metric.label}</span>
							</span>
						{/if}
					</span>
					<span class="mode-state">{stateLabel(mode.state)}</span>
					<span class="mode-action">{actionLabel(mode.state, mode.action)}</span>
					<span class="mode-unlock">{mode.unlock}</span>
				</a>
			{/each}
		</div>
	</div>

	<div class="card-grid">
		{#each capabilityCards as card (card.id)}
			<article class="cap-card" data-state={card.state} data-capability-id={card.id}>
				<header class="card-head">
					<span class="card-title-block">
						<h3 class="card-title">{card.title}</h3>
						<span class="card-route">
							<span>{card.workspace}</span>
							<span>{card.phase}</span>
						</span>
					</span>
					<span class="card-state">{stateLabel(card.state)}</span>
				</header>

				<div class="card-main">
					<div>
						<div
							class="card-cluster"
							aria-label={`${capabilityCardClusterLabel(card.cluster)} cluster audit mark`}
						>
							<span class="card-cluster-name">{capabilityCardClusterLabel(card.cluster)}</span>
							<span class="card-cluster-id">
								<RegistryMark variant="tag" value={card.cluster} copy={false} />
							</span>
						</div>
						<p class="card-statement">{card.statement}</p>
					</div>

					{#if card.visual === 'verification-ratio'}
						<div class="card-visual">
							<Ratio segments={verificationSegments} height={16} />
						</div>
					{:else if card.visual === 'packet-ratio'}
						<div class="card-visual">
							<Ratio segments={packetSegments} height={16} />
						</div>
					{:else if card.visual === 'rings'}
						<div class="card-visual card-visual--rings">
							<Rings tiers={ret?.tiers ?? []} size={56} />
						</div>
					{:else if card.visual === 'pulse'}
						<div class="card-visual card-visual--pulse">
							<Pulse values={pulseValues} width={140} height={34} />
						</div>
					{:else if card.visual === 'registry'}
						<div class="card-visual card-visual--registry">
							<RegistryMark variant="tag" value="Sepolia testnet" copy={false} />
						</div>
					{/if}
				</div>

				{#if card.metric}
					<div class="card-metric">
						<span class="metric-value"
							><Datum
								value={card.metric.value}
								animate
								spring={SPRINGS.METRIC}
								cite={card.metric.cite}
							/></span
						>
						<span class="metric-label">{card.metric.label}</span>
					</div>
				{/if}

				<p class="card-evidence">{card.evidence}</p>
				<div class="card-contract" aria-label={`${card.title} route-effect contract`}>
					<span class="card-contract-label">handoff</span>
					<span class="card-contract-value">{card.handoff}</span>
					<span class="card-contract-label">effect</span>
					<span class="card-contract-value">{card.effect}</span>
				</div>

				<footer class="card-foot">
					<a class="card-action" href={card.href} data-sveltekit-preload-data="off"
						>{actionLabel(card.state, card.action)}</a
					>
					<span class="card-chokepoint">{card.nextGate.chokepoint}</span>
					<span class="card-unlock">
						{gateSummary(card.nextGate, { prefix: card.futureLift, complete: card.futureLift })}
					</span>
					<span class="card-next-gate" data-state={card.nextGate.state}>
						<span class="card-next-kicker">next gate</span>
						<span class="card-next-name">{card.nextGate.name}</span>
						<span class="card-next-tasks">{card.nextGate.tasks}</span>
						<span class="card-next-count">
							<Datum value={card.nextGate.downstream} cite={card.nextGate.source} />
							downstream
						</span>
					</span>
					{#if card.honesty}
						<span class="card-honesty">{card.honesty}</span>
					{/if}
				</footer>
			</article>
		{/each}
	</div>
</section>

<style>
	.capability {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		max-width: 100%;
		padding: 1rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
		overflow-wrap: anywhere;
	}

	.capability-head {
		display: grid;
		gap: 1rem;
	}
	@media (min-width: 760px) {
		.capability-head {
			grid-template-columns: minmax(0, 1fr) minmax(15rem, 18rem);
			align-items: end;
		}
	}

	.capability-kicker,
	.composition-kicker,
	.composition-pressure-label,
	.composition-pressure-state,
	.composition-pressure-action,
	.boundary-pressure-label,
	.boundary-pressure-state,
	.boundary-pressure-action,
	.operating-spine-title,
	.operating-spine-label,
	.operating-spine-action,
	.workspace-posture-title,
	.workspace-posture-name,
	.workspace-posture-action,
	.cluster-coverage-kicker,
	.cluster-coverage-id,
	.cluster-coverage-source,
	.cluster-coverage-action,
	.cluster-balance-kicker,
	.cluster-balance-source,
	.cluster-balance-action,
	.queue-kicker,
	.queue-pressure-kicker,
	.queue-pressure-source,
	.queue-pressure-action,
	.queue-panel-title,
	.readout-title,
	.readout-label,
	.readout-action,
	.state-ledger-kicker,
	.state-ledger-count,
	.state-ledger-handoff,
	.state-ledger-source,
	.state-ledger-action,
	.action-strip-title,
	.action-kicker,
	.action-foot,
	.launch-vector-kicker,
	.launch-vector-source,
	.launch-vector-action,
	.claim-title,
	.claim-pressure-kicker,
	.claim-pressure-source,
	.claim-pressure-action,
	.claim-source,
	.cascade-kicker,
	.cascade-pressure-kicker,
	.cascade-pressure-source,
	.cascade-pressure-action,
	.cascade-elapsed,
	.cascade-tasks,
	.gate-kicker,
	.gate-tasks,
	.gate-chokepoint,
	.gate-dependency,
	.gate-clusters,
	.gate-pressure-kicker,
	.gate-pressure-source,
	.gate-pressure-action,
	.send-pressure-kicker,
	.send-pressure-source,
	.send-pressure-action,
	.card-cluster-id,
	.readiness-title,
	.mode-cluster,
	.card-chokepoint,
	.card-route,
	.posture-title,
	.posture-state,
	.boundary-title,
	.boundary-label,
	.claim-grammar-state,
	.claim-grammar-verb,
	.loop-pressure-kicker,
	.loop-pressure-source,
	.loop-pressure-action,
	.loop-rail-title,
	.loop-node-id,
	.loop-node-meta,
	.lattice-kicker,
	.lattice-corner,
	.lattice-phase-head,
	.lattice-gate-head,
	.lattice-id,
	.lattice-workspace,
	.lattice-gate-tasks,
	.lattice-gate-count,
	.lattice-state,
	.lattice-action,
	.shift-kicker,
	.shift-pressure-label,
	.shift-pressure-state,
	.shift-pressure-action,
	.profile-kicker,
	.profile-pressure-kicker,
	.profile-pressure-source,
	.profile-pressure-action,
	.profile-stage-kicker,
	.profile-stage-cluster,
	.profile-stage-action,
	.profile-source,
	.profile-cluster,
	.profile-action,
	.terrain-kicker,
	.terrain-pressure-kicker,
	.terrain-pressure-source,
	.terrain-pressure-action,
	.terrain-meta,
	.terrain-handoff,
	.terrain-action,
	.shift-cluster,
	.path-id,
	.path-sequence span,
	.path-meta,
	.path-unlock,
	.queue-cluster {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: oklch(0.52 0.012 250);
	}

	.capability-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1.125rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0.25rem 0 0;
	}

	.capability-copy {
		display: grid;
		gap: 0.35rem;
		min-width: 0;
	}

	.capability-head-count,
	.capability-head-total,
	.capability-head-split {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.4;
		text-transform: uppercase;
		color: var(--text-secondary, oklch(0.42 0.012 60));
	}

	.capability-head-count {
		gap: 0.35rem 0.8rem;
	}

	.capability-head-total {
		gap: 0.3rem;
		white-space: nowrap;
	}

	.capability-head-split {
		gap: 0.25rem 0.4rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.state-contract {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0 0;
	}

	.contract-list {
		display: grid;
		gap: 0.25rem;
	}
	.contract-row {
		display: grid;
		grid-template-columns: 1.5rem 5rem minmax(0, 1fr);
		gap: 0.5rem;
		align-items: baseline;
		min-width: 0;
	}
	.contract-count,
	.contract-name {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: oklch(0.45 0.012 60);
	}
	.contract-count {
		font-variant-numeric: tabular-nums;
	}
	.contract-meaning {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.contract-row[data-state='live'] .contract-name {
		color: var(--coord-verified, #10b981);
	}
	.contract-row[data-state='partial'] .contract-name {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.contract-row[data-state='draft-only'] .contract-name {
		color: oklch(0.62 0.12 78);
	}
	.contract-row[data-state='gated'] .contract-name {
		color: oklch(0.48 0.02 60);
	}

	.operating-spine {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}

	.operating-spine-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.operating-spine-axis {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.operating-spine-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}

	@media (min-width: 760px) {
		.operating-spine-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 1120px) {
		.operating-spine-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.operating-spine-row {
		display: flex;
		min-width: 0;
		min-height: 9.1rem;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.625rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}

	.operating-spine-row:hover,
	.operating-spine-row:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}

	.operating-spine-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}

	.operating-spine-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}

	.operating-spine-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}

	.operating-spine-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}

	.operating-spine-top,
	.operating-spine-signal {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}

	.operating-spine-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}

	.operating-spine-row[data-state='live'] .operating-spine-state {
		color: var(--coord-verified, #10b981);
	}

	.operating-spine-row[data-state='partial'] .operating-spine-state {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.operating-spine-row[data-state='draft-only'] .operating-spine-state {
		color: oklch(0.62 0.12 78);
	}

	.operating-spine-signal {
		justify-content: flex-start;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.36 0.012 60);
	}

	.operating-spine-detail,
	.operating-spine-gate {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.operating-spine-detail {
		-webkit-line-clamp: 2;
	}

	.operating-spine-gate {
		-webkit-line-clamp: 2;
		color: oklch(0.44 0.012 60);
	}

	.operating-spine-action {
		margin-top: auto;
		color: oklch(0.38 0.012 60);
		letter-spacing: 0.06em;
	}

	.workspace-posture {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}

	.workspace-posture-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.workspace-posture-count {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: flex-end;
		gap: 0.25rem 0.4rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 750;
		line-height: 1.35;
		color: oklch(0.43 0.012 60);
		text-align: right;
	}
	.workspace-posture-split {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		white-space: nowrap;
	}

	.workspace-posture-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}

	@media (min-width: 760px) {
		.workspace-posture-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 1120px) {
		.workspace-posture-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.workspace-posture-row {
		display: flex;
		min-width: 0;
		min-height: 8.4rem;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.625rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}

	.workspace-posture-row:hover,
	.workspace-posture-row:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}

	.workspace-posture-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}

	.workspace-posture-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}

	.workspace-posture-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}

	.workspace-posture-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}

	.workspace-posture-top,
	.workspace-posture-signal {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		justify-content: space-between;
		min-width: 0;
	}

	.workspace-posture-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}

	.workspace-posture-row[data-state='live'] .workspace-posture-state {
		color: var(--coord-verified, #10b981);
	}

	.workspace-posture-row[data-state='partial'] .workspace-posture-state {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.workspace-posture-row[data-state='draft-only'] .workspace-posture-state {
		color: oklch(0.62 0.12 78);
	}

	.workspace-posture-signal {
		justify-content: flex-start;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}

	.workspace-posture-readout {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.55rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.workspace-posture-readout--next {
		margin-top: auto;
		color: oklch(0.44 0.012 60);
	}

	.workspace-posture-meta-label {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: oklch(0.46 0.018 60);
	}

	.workspace-posture-action {
		color: oklch(0.38 0.012 60);
		letter-spacing: 0.06em;
	}

	.operating-readout {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.readout-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.readout-axis,
	.state-ledger-axis,
	.cluster-coverage-axis,
	.boundary-axis {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 800;
		line-height: 1.35;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		text-align: right;
	}
	.readout-axis span,
	.state-ledger-axis span,
	.cluster-coverage-axis span,
	.boundary-axis span {
		white-space: nowrap;
	}
	.readout-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}
	@media (min-width: 760px) {
		.readout-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (min-width: 1120px) {
		.readout-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.readout-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 11.5rem;
		padding: 0.625rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.readout-card:hover,
	.readout-card:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.readout-card[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.readout-card[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.readout-card[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.readout-card[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.readout-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.readout-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}
	.readout-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.75rem;
		font-weight: 700;
		color: oklch(0.4 0.012 60);
	}
	.readout-visual {
		display: flex;
		align-items: center;
		min-height: 1.25rem;
	}
	.readout-compact {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.4rem;
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.readout-compact--next {
		margin-top: auto;
		color: oklch(0.44 0.012 60);
	}
	.readout-meta-label {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: oklch(0.46 0.018 60);
	}
	.readout-action {
		color: oklch(0.38 0.012 60);
	}

	.state-ledger {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}

	.state-ledger-head {
		display: grid;
		gap: 0.5rem;
	}

	@media (min-width: 760px) {
		.state-ledger-head {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.85fr);
			align-items: end;
		}
	}

	.state-ledger-title {
		margin: 0.25rem 0 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.state-ledger-grid {
		display: grid;
		gap: 0.375rem;
	}

	.state-ledger-row {
		display: grid;
		grid-template-columns:
			minmax(6.5rem, 0.42fr) minmax(11rem, 0.75fr) minmax(13rem, 1fr)
			minmax(13rem, 1fr);
		gap: 0.35rem 0.625rem;
		align-items: baseline;
		min-height: 5.75rem;
		padding: 0.5rem 0.625rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		color: inherit;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}

	.state-ledger-row:hover,
	.state-ledger-row:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}

	.state-ledger-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}

	.state-ledger-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}

	.state-ledger-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}

	.state-ledger-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}

	.state-ledger-count,
	.state-ledger-main,
	.state-ledger-route {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.125rem;
	}

	.state-ledger-count {
		font-size: 0.6875rem;
		letter-spacing: 0.07em;
		color: oklch(0.42 0.012 60);
	}

	.state-ledger-target {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.state-ledger-meaning,
	.state-ledger-effect,
	.state-ledger-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.state-ledger-handoff {
		color: oklch(0.44 0.012 60);
		letter-spacing: 0.07em;
	}

	.state-ledger-effect {
		color: oklch(0.48 0.012 60);
	}

	.state-ledger-gate,
	.state-ledger-source,
	.state-ledger-action {
		grid-column: 1 / -1;
	}

	.state-ledger-gate {
		color: oklch(0.44 0.012 60);
	}

	.state-ledger-source {
		color: oklch(0.52 0.012 250);
		letter-spacing: 0.08em;
	}

	.state-ledger-action {
		color: oklch(0.38 0.012 60);
		letter-spacing: 0.06em;
	}

	.state-ledger-row[data-state='live'] .state-ledger-count {
		color: var(--coord-verified, #10b981);
	}

	.state-ledger-row[data-state='partial'] .state-ledger-count {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.state-ledger-row[data-state='draft-only'] .state-ledger-count {
		color: oklch(0.62 0.12 78);
	}

	.state-ledger-row[data-state='gated'] .state-ledger-count {
		color: oklch(0.48 0.02 60);
	}

	@media (max-width: 980px) {
		.state-ledger-row {
			grid-template-columns: 1fr;
			align-items: start;
		}
	}

	.cluster-coverage {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.cluster-coverage-head {
		display: grid;
		gap: 0.5rem;
	}
	@media (min-width: 760px) {
		.cluster-coverage-head {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.85fr);
			align-items: end;
		}
	}
	.cluster-coverage-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0.25rem 0 0;
	}
	.cluster-coverage-contract {
		display: grid;
		gap: 0.375rem;
	}
	.cluster-coverage-count,
	.cluster-coverage-split {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.45rem;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.4;
		color: var(--text-secondary, oklch(0.42 0.012 60));
		margin: 0;
	}
	.cluster-coverage-count {
		gap: 0.35rem 0.8rem;
	}
	.cluster-coverage-split {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.cluster-balance {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.375rem;
	}
	@media (min-width: 860px) {
		.cluster-balance {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.cluster-balance-cell {
		display: grid;
		grid-template-rows: auto auto auto 1fr auto auto auto;
		gap: 0.25rem;
		min-height: 11rem;
		padding: 0.625rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.cluster-balance-cell:hover,
	.cluster-balance-cell:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.cluster-balance-cell[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 48%);
	}
	.cluster-balance-cell[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 45%);
	}
	.cluster-balance-cell[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.cluster-balance-cell[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.cluster-balance-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 800;
		line-height: 1.15;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.cluster-balance-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.42 0.012 60);
	}
	.cluster-balance-detail,
	.cluster-balance-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.35;
	}
	.cluster-balance-detail {
		color: oklch(0.42 0.012 60);
	}
	.cluster-balance-gate {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.cluster-balance-source {
		color: oklch(0.52 0.012 250);
		letter-spacing: 0.08em;
	}
	.cluster-balance-action {
		color: oklch(0.38 0.012 60);
		letter-spacing: 0.06em;
		align-self: end;
	}
	.cluster-coverage-grid {
		display: grid;
		gap: 0.375rem;
	}
	.cluster-coverage-row {
		display: grid;
		grid-template-columns:
			minmax(9rem, 0.75fr) 5.25rem minmax(11rem, 0.85fr) minmax(10rem, 0.85fr)
			minmax(10rem, 0.85fr);
		gap: 0.35rem 0.625rem;
		align-items: baseline;
		padding: 0.5rem 0.625rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.cluster-coverage-row:hover,
	.cluster-coverage-row:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.cluster-coverage-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 48%);
	}
	.cluster-coverage-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 45%);
	}
	.cluster-coverage-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.cluster-coverage-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.cluster-coverage-main {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.125rem;
	}
	.cluster-coverage-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.cluster-coverage-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}
	.cluster-coverage-row[data-state='live'] .cluster-coverage-state {
		color: var(--coord-verified, #10b981);
	}
	.cluster-coverage-row[data-state='partial'] .cluster-coverage-state {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.cluster-coverage-row[data-state='draft-only'] .cluster-coverage-state {
		color: oklch(0.62 0.12 78);
	}
	.cluster-coverage-row[data-state='gated'] .cluster-coverage-state {
		color: oklch(0.48 0.02 60);
	}
	.cluster-coverage-mix {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.15rem 0.5rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		color: oklch(0.45 0.012 60);
	}
	.cluster-coverage-lead,
	.cluster-coverage-boundary,
	.cluster-coverage-gate {
		display: grid;
		gap: 0.125rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.cluster-coverage-lead {
		color: oklch(0.38 0.012 60);
	}
	.cluster-coverage-boundary {
		color: oklch(0.43 0.012 60);
	}
	.cluster-coverage-field-label {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.58 0.012 60);
	}
	.cluster-coverage-gate,
	.cluster-coverage-source,
	.cluster-coverage-action {
		grid-column: 1 / -1;
	}
	.cluster-coverage-gate {
		color: oklch(0.44 0.012 60);
	}
	.cluster-coverage-source {
		color: oklch(0.52 0.012 250);
		letter-spacing: 0.08em;
	}
	.cluster-coverage-action {
		color: oklch(0.38 0.012 60);
		letter-spacing: 0.06em;
	}
	@media (max-width: 980px) {
		.cluster-coverage-row {
			grid-template-columns: 1fr;
			align-items: start;
		}
		.cluster-coverage-mix {
			grid-template-columns: repeat(4, minmax(0, max-content));
		}
	}

	.action-strip {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.action-strip-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.action-strip-count {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
		font-size: 0.625rem;
		line-height: 1.25;
		color: var(--text-secondary, oklch(0.42 0.012 60));
		text-align: right;
		text-transform: uppercase;
	}
	.action-strip-count-item {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		white-space: nowrap;
	}
	.action-strip-count-item[data-state='live'] {
		color: var(--coord-verified, #10b981);
	}
	.action-strip-count-item[data-state='partial'] {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.action-strip-count-item[data-state='draft-only'] {
		color: oklch(0.56 0.09 78);
	}
	.action-strip-count-item[data-state='gated'] {
		color: oklch(0.44 0.035 35);
	}
	.action-strip-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}
	@media (min-width: 760px) {
		.action-strip-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (min-width: 1120px) {
		.action-strip-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.action-tile {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 8.75rem;
		padding: 0.625rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.action-tile:hover,
	.action-tile:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.action-tile[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.action-tile[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.action-tile[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.action-tile[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.action-kicker {
		color: oklch(0.46 0.012 250);
	}
	.action-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.action-effect {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.action-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: oklch(0.44 0.012 60);
	}
	.action-foot {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-top: auto;
		color: oklch(0.38 0.012 60);
		letter-spacing: 0.06em;
	}

	.launch-vector {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.launch-vector-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.launch-vector-title {
		margin: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: clamp(1rem, 1.6vw, 1.25rem);
		font-weight: 800;
		line-height: 1.05;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.launch-vector-count {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
		font-size: 0.625rem;
		line-height: 1.25;
		color: var(--text-secondary, oklch(0.42 0.012 60));
		text-align: right;
		text-transform: uppercase;
	}
	.launch-vector-count-item {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		white-space: nowrap;
	}
	.launch-vector-count-item[data-state='live'] {
		color: var(--coord-verified, #10b981);
	}
	.launch-vector-count-item[data-state='partial'] {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.launch-vector-count-item[data-state='draft-only'] {
		color: oklch(0.56 0.09 78);
	}
	.launch-vector-count-item[data-state='gated'] {
		color: oklch(0.44 0.035 35);
	}
	.launch-vector-grid {
		display: grid;
		gap: 0.375rem;
	}
	@media (min-width: 820px) {
		.launch-vector-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.launch-vector-cell {
		display: grid;
		grid-template-rows: auto auto auto auto 1fr auto auto auto;
		gap: 0.35rem;
		min-width: 0;
		min-height: 12.25rem;
		padding: 0.65rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.launch-vector-cell:hover,
	.launch-vector-cell:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.launch-vector-cell[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.launch-vector-cell[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.launch-vector-cell[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.launch-vector-cell[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.launch-vector-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.launch-vector-state,
	.launch-vector-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.launch-vector-detail,
	.launch-vector-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.38;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.launch-vector-detail {
		color: var(--text-secondary, oklch(0.4 0.012 60));
	}
	.launch-vector-source {
		color: oklch(0.52 0.012 250);
		letter-spacing: 0.08em;
	}
	.launch-vector-action {
		align-self: end;
		color: oklch(0.38 0.012 60);
	}
	@media (max-width: 720px) {
		.launch-vector-head {
			flex-direction: column;
		}
		.launch-vector-count {
			justify-content: flex-start;
			text-align: left;
		}
	}

	.claim-boundary {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.boundary-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.boundary-pressure {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
	}
	@media (max-width: 760px) {
		.boundary-pressure {
			grid-template-columns: 1fr;
		}
	}
	.boundary-pressure-card {
		display: flex;
		min-width: 0;
		min-height: 7.25rem;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.62rem 0.7rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.boundary-pressure-card:hover,
	.boundary-pressure-card:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.boundary-pressure-card[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 48%);
	}
	.boundary-pressure-card[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 45%);
	}
	.boundary-pressure-card[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.boundary-pressure-card[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.boundary-pressure-top,
	.boundary-pressure-metric {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}
	.boundary-pressure-state {
		white-space: nowrap;
	}
	.boundary-pressure-metric {
		justify-content: flex-start;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.75rem;
		font-weight: 750;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.boundary-pressure-metric span:last-child {
		min-width: 0;
		overflow: hidden;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		font-size: 0.62rem;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.boundary-pressure-detail,
	.boundary-pressure-gate {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.68rem;
		line-height: 1.38;
	}
	.boundary-pressure-detail {
		-webkit-line-clamp: 2;
		line-clamp: 2;
		color: var(--text-secondary, oklch(0.42 0.012 60));
	}
	.boundary-pressure-gate {
		-webkit-line-clamp: 2;
		line-clamp: 2;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.boundary-pressure-action {
		margin-top: auto;
		overflow: hidden;
		color: oklch(0.5 0.012 60);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.boundary-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}
	@media (min-width: 900px) {
		.boundary-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.boundary-card {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 13.25rem;
		padding: 0.625rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	.boundary-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.boundary-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}
	.boundary-headline {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.boundary-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: oklch(0.45 0.012 60);
	}
	.boundary-claim,
	.boundary-evidence,
	.boundary-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.boundary-evidence {
		color: oklch(0.48 0.012 60);
	}
	.boundary-gate {
		margin-top: auto;
		color: oklch(0.44 0.012 60);
	}
	.boundary-card[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.boundary-card[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.boundary-card[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.boundary-card[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}

	.claim-grammar {
		display: grid;
		gap: 0.375rem;
		margin-top: 0.25rem;
	}
	.claim-grammar-row {
		display: grid;
		grid-template-columns: minmax(6.5rem, 0.7fr) minmax(5rem, 0.4fr) minmax(6rem, 0.55fr) minmax(
				0,
				1fr
			);
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.5rem 0.625rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	.claim-grammar-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.claim-grammar-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.claim-grammar-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.claim-grammar-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.claim-grammar-state {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		color: oklch(0.42 0.012 60);
		letter-spacing: 0.07em;
	}
	.claim-grammar-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.claim-grammar-allowed,
	.claim-grammar-deny,
	.claim-grammar-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.claim-grammar-deny {
		color: oklch(0.43 0.035 45);
	}
	.claim-grammar-gate {
		grid-column: 4;
		color: oklch(0.44 0.012 60);
	}
	@media (max-width: 900px) {
		.claim-grammar-row {
			grid-template-columns: 1fr;
		}
		.claim-grammar-gate {
			grid-column: auto;
		}
	}

	.loop-rail {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.loop-rail-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.loop-rail-count {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
		font-size: 0.625rem;
		line-height: 1.25;
		color: var(--text-secondary, oklch(0.42 0.012 60));
		text-align: right;
		text-transform: uppercase;
	}
	.loop-rail-split {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		white-space: nowrap;
	}
	@media (max-width: 720px) {
		.loop-rail-head {
			flex-direction: column;
			align-items: flex-start;
		}
		.loop-rail-count {
			justify-content: flex-start;
			text-align: left;
		}
	}
	.loop-pressure {
		display: grid;
		gap: 0.375rem;
	}
	@media (min-width: 820px) {
		.loop-pressure {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.loop-pressure-cell {
		display: grid;
		grid-template-rows: auto auto auto 1fr auto auto auto;
		gap: 0.35rem;
		min-width: 0;
		min-height: 12rem;
		padding: 0.65rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.loop-pressure-cell:hover,
	.loop-pressure-cell:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.loop-pressure-cell[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.loop-pressure-cell[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.loop-pressure-cell[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.loop-pressure-cell[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.loop-pressure-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.loop-pressure-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.loop-pressure-detail,
	.loop-pressure-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.38;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.loop-pressure-detail {
		color: var(--text-secondary, oklch(0.4 0.012 60));
	}
	.loop-pressure-action {
		align-self: end;
		color: oklch(0.38 0.012 60);
	}
	.loop-rail-track {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.375rem;
	}
	@media (min-width: 760px) {
		.loop-rail-track {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (min-width: 1160px) {
		.loop-rail-track {
			grid-template-columns: repeat(6, minmax(0, 1fr));
		}
	}
	.loop-node {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-height: 11.75rem;
		padding: 0.625rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.loop-node:hover,
	.loop-node:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.loop-node-top {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
	}
	.loop-node-index,
	.loop-node-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}
	.loop-node-index {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.loop-node-state {
		margin-left: auto;
	}
	.loop-node-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.loop-node-meta {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		color: oklch(0.52 0.012 250);
		letter-spacing: 0.08em;
	}
	.loop-node-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: oklch(0.45 0.012 60);
	}
	.loop-node-unlock {
		margin-top: auto;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: oklch(0.44 0.012 60);
	}
	.loop-node[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.loop-node[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.loop-node[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.loop-node[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}

	.capability-lattice {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.lattice-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.lattice-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0.125rem 0 0;
	}
	.lattice-count {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
		font-size: 0.625rem;
		line-height: 1.25;
		color: var(--text-secondary, oklch(0.46 0.012 60));
		text-align: right;
		text-transform: uppercase;
	}
	.lattice-count-split {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		white-space: nowrap;
	}
	.lattice-grid {
		display: grid;
		gap: 0.25rem;
		width: 100%;
		min-width: 0;
		max-width: 100%;
		overflow-x: auto;
		contain: inline-size;
		padding-bottom: 0.125rem;
	}
	.lattice-row {
		display: grid;
		grid-template-columns:
			minmax(11rem, 1.1fr) repeat(6, minmax(2.75rem, 0.35fr)) minmax(12rem, 1fr)
			5rem 6.5rem;
		gap: 0.25rem;
		align-items: stretch;
		min-width: 58rem;
		text-decoration: none;
		color: inherit;
	}
	@media (max-width: 760px) {
		.lattice-head {
			flex-direction: column;
			align-items: flex-start;
		}
		.lattice-count {
			justify-content: flex-start;
			text-align: left;
		}
		.lattice-grid {
			overflow-x: visible;
			contain: none;
		}

		.lattice-row {
			grid-template-columns: minmax(0, 1fr);
			min-width: 0;
			width: 100%;
		}

		.lattice-row--head {
			display: none;
		}
	}
	.lattice-row:not(.lattice-row--head) {
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.lattice-row:not(.lattice-row--head):hover,
	.lattice-row:not(.lattice-row--head):focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.lattice-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.lattice-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.lattice-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.lattice-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.lattice-row--head {
		min-height: 1.5rem;
	}
	.lattice-corner,
	.lattice-phase-head,
	.lattice-gate-head {
		display: flex;
		align-items: end;
		color: oklch(0.5 0.012 250);
	}
	.lattice-phase-head {
		justify-content: center;
	}
	.lattice-capability {
		display: grid;
		gap: 0.125rem;
		padding: 0.5rem 0.625rem;
		min-width: 0;
	}
	.lattice-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lattice-cluster {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 600;
		color: oklch(0.48 0.012 60);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lattice-id,
	.lattice-workspace {
		color: oklch(0.54 0.012 250);
		letter-spacing: 0.08em;
	}
	.lattice-cell {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 3.25rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: oklch(0.992 0.003 60);
	}
	@media (max-width: 760px) {
		.lattice-cell {
			justify-content: flex-start;
			min-height: 1.75rem;
			padding: 0.25rem 0.625rem;
		}
	}
	.lattice-cell[data-state='empty'] {
		border-style: dashed;
		background: transparent;
		opacity: 0.55;
	}
	@media (max-width: 760px) {
		.lattice-cell[data-state='empty'] {
			display: none;
		}
	}
	.lattice-mark {
		display: block;
		width: 1rem;
		height: 0.24rem;
		border-radius: 2px;
		background: currentColor;
	}
	.lattice-cell[data-state='live'] {
		color: var(--coord-verified, #10b981);
		background: color-mix(in oklch, var(--coord-verified, #10b981), white 91%);
	}
	.lattice-cell[data-state='partial'] {
		color: var(--coord-route-solid, #3bc4b8);
		background: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), white 91%);
	}
	.lattice-cell[data-state='draft-only'] {
		color: oklch(0.62 0.12 78);
		background: oklch(0.985 0.009 76);
	}
	.lattice-cell[data-state='gated'] {
		color: oklch(0.48 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.lattice-gate {
		display: grid;
		align-content: center;
		gap: 0.125rem;
		padding: 0.45rem 0.625rem;
		border-left: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		min-width: 0;
	}
	.lattice-gate-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 700;
		color: oklch(0.32 0.012 60);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lattice-gate-tasks,
	.lattice-gate-count {
		color: oklch(0.5 0.012 60);
		letter-spacing: 0.06em;
	}
	.lattice-state,
	.lattice-action {
		display: flex;
		align-items: center;
		padding: 0.45rem 0.5rem;
		color: oklch(0.45 0.012 60);
	}
	.lattice-action {
		text-transform: none;
		letter-spacing: 0;
		color: oklch(0.5 0.012 60);
	}
	.lattice-row[data-state='live'] .lattice-state,
	.lattice-row[data-state='live'] .lattice-action {
		color: var(--coord-verified, #10b981);
	}
	.lattice-row[data-state='partial'] .lattice-state,
	.lattice-row[data-state='partial'] .lattice-action {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.lattice-row[data-state='draft-only'] .lattice-state,
	.lattice-row[data-state='draft-only'] .lattice-action {
		color: oklch(0.62 0.12 78);
	}
	.lattice-row[data-state='gated'] .lattice-state,
	.lattice-row[data-state='gated'] .lattice-action {
		color: oklch(0.48 0.02 60);
	}

	.posture {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.posture-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.posture-mix {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 0.375rem;
		min-width: 0;
	}
	.posture-mix-item {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		white-space: nowrap;
	}
	.posture-mix-item[data-state='live'] {
		color: var(--coord-verified, #10b981);
	}
	.posture-mix-item[data-state='partial'] {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.posture-mix-item[data-state='held'] {
		color: oklch(0.56 0.06 78);
	}
	.posture-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}
	@media (min-width: 760px) {
		.posture-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (min-width: 1120px) {
		.posture-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.posture-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 12.75rem;
		padding: 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-left: 2px solid oklch(0.78 0.01 60);
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.posture-card:hover,
	.posture-card:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.posture-card[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 42%);
	}
	.posture-card[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 38%);
	}
	.posture-card[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.posture-card[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.posture-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.posture-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		color: oklch(0.5 0.012 60);
		white-space: nowrap;
	}
	.posture-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.posture-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: oklch(0.45 0.012 60);
	}
	.posture-visual {
		display: flex;
		align-items: center;
		min-height: 1.25rem;
	}
	.posture-detail,
	.posture-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.posture-gate {
		margin-top: auto;
		color: oklch(0.44 0.012 60);
	}

	.capability-shifts {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.shift-head {
		display: grid;
		gap: 0.5rem;
	}
	@media (min-width: 760px) {
		.shift-head {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.85fr);
			align-items: end;
		}
	}
	.shift-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0.25rem 0 0;
	}
	.shift-axis {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.375rem;
		align-items: center;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.shift-axis span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	@media (min-width: 760px) {
		.shift-axis {
			text-align: right;
		}
	}
	.shift-pressure {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
	}
	@media (max-width: 760px) {
		.shift-pressure {
			grid-template-columns: 1fr;
		}
	}
	.shift-pressure-card {
		display: flex;
		min-width: 0;
		min-height: 7.25rem;
		flex-direction: column;
		gap: 0.35rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		padding: 0.62rem 0.7rem;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.shift-pressure-card:hover,
	.shift-pressure-card:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.shift-pressure-card[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 48%);
	}
	.shift-pressure-card[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 45%);
	}
	.shift-pressure-card[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.shift-pressure-card[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.shift-pressure-top,
	.shift-pressure-metric {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}
	.shift-pressure-state {
		white-space: nowrap;
	}
	.shift-pressure-metric {
		justify-content: flex-start;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.75rem;
		font-weight: 750;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.shift-pressure-metric span:last-child {
		min-width: 0;
		overflow: hidden;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		font-size: 0.62rem;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.shift-pressure-detail,
	.shift-pressure-gate {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.68rem;
		line-height: 1.38;
	}
	.shift-pressure-detail {
		-webkit-line-clamp: 2;
		color: var(--text-secondary, oklch(0.42 0.012 60));
	}
	.shift-pressure-gate {
		-webkit-line-clamp: 2;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.shift-pressure-action {
		margin-top: auto;
		overflow: hidden;
		color: oklch(0.5 0.012 60);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.shift-list {
		display: grid;
		gap: 0.375rem;
	}
	.shift-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.625rem;
		padding: 0.5rem 0.5rem 0.5rem 0.625rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	@media (min-width: 940px) {
		.shift-row {
			grid-template-columns: minmax(0, 1.35fr) 5rem minmax(9rem, 0.65fr) minmax(8rem, 0.65fr);
			align-items: baseline;
		}
	}
	.shift-row:hover,
	.shift-row:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.shift-main {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.shift-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.shift-from,
	.shift-to,
	.shift-evidence,
	.shift-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.shift-to {
		color: oklch(0.43 0.012 60);
	}
	.shift-state,
	.shift-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}
	.shift-action {
		grid-column: 1 / -1;
		text-transform: none;
		letter-spacing: 0;
		color: oklch(0.5 0.012 60);
	}
	.shift-signal {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 8rem;
	}
	.shift-visual {
		display: flex;
		align-items: center;
		min-height: 1rem;
	}
	.shift-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: oklch(0.45 0.012 60);
	}
	.shift-cluster {
		color: oklch(0.52 0.012 250);
	}
	.shift-evidence,
	.shift-gate {
		grid-column: 1 / -1;
	}
	.shift-gate {
		color: oklch(0.44 0.012 60);
	}
	.shift-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 48%);
	}
	.shift-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 45%);
	}
	.shift-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.shift-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}

	.platform-profiles {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.profile-head {
		display: grid;
		gap: 0.5rem;
	}
	@media (min-width: 760px) {
		.profile-head {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.85fr);
			align-items: end;
		}
	}
	.profile-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0.25rem 0 0;
	}
	.profile-contract-count,
	.profile-contract-split {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.45rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--text-secondary, oklch(0.42 0.012 60));
		margin: 0;
	}
	.profile-contract-count {
		gap: 0.35rem 0.8rem;
	}
	.profile-contract-total,
	.profile-contract-split {
		min-width: 0;
	}
	.profile-contract-total {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.profile-contract-split {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.profile-axis {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 800;
		line-height: 1.35;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		text-align: right;
	}
	.profile-axis span {
		white-space: nowrap;
	}
	@media (min-width: 760px) {
		.profile-axis {
			text-align: right;
		}
	}
	.profile-contract {
		display: grid;
		gap: 0.375rem;
	}
	.profile-pressure {
		display: grid;
		gap: 0.375rem;
	}
	@media (min-width: 820px) {
		.profile-pressure {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.profile-pressure-cell {
		display: grid;
		grid-template-rows: auto auto auto 1fr auto auto auto;
		gap: 0.35rem;
		min-width: 0;
		min-height: 12rem;
		padding: 0.65rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.profile-pressure-cell:hover,
	.profile-pressure-cell:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.profile-pressure-cell[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.profile-pressure-cell[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.profile-pressure-cell[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.profile-pressure-cell[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.profile-pressure-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.profile-pressure-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.profile-pressure-detail,
	.profile-pressure-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.38;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.profile-pressure-detail {
		color: var(--text-secondary, oklch(0.4 0.012 60));
	}
	.profile-pressure-source {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.profile-pressure-action {
		align-self: end;
		color: oklch(0.38 0.012 60);
	}
	.profile-stages {
		display: grid;
		gap: 0.375rem;
	}
	@media (min-width: 860px) {
		.profile-stages {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.profile-stage {
		display: grid;
		grid-template-rows: auto auto 1fr auto auto;
		gap: 0.45rem;
		min-width: 0;
		min-height: 12rem;
		padding: 0.65rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.profile-stage:hover,
	.profile-stage:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.profile-stage[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.profile-stage[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.profile-stage[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.profile-stage[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.profile-stage-main {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.2rem;
	}
	.profile-stage-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.profile-stage-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.profile-stage-effect,
	.profile-stage-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.38;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.profile-stage-effect {
		color: var(--text-secondary, oklch(0.4 0.012 60));
	}
	.profile-stage-action {
		align-self: end;
		color: oklch(0.38 0.012 60);
	}
	.profile-grid {
		display: grid;
		gap: 0.375rem;
	}
	.profile-row {
		display: grid;
		grid-template-columns:
			minmax(10rem, 1fr) minmax(11rem, 0.85fr) minmax(8rem, 0.75fr)
			minmax(7rem, 0.5fr) minmax(12rem, 1fr) minmax(7rem, 0.55fr);
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
		padding: 0.5rem 0.625rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.profile-row:hover,
	.profile-row:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.profile-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.profile-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.profile-main,
	.profile-state-group,
	.profile-state {
		display: flex;
		min-width: 0;
	}
	.profile-main {
		flex-direction: column;
		gap: 0.2rem;
	}
	.profile-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.profile-state-group {
		flex-direction: column;
		gap: 0.25rem;
	}
	.profile-state {
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.2rem 0.35rem;
		border: 1px solid transparent;
		border-radius: 6px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: oklch(0.48 0.012 60);
		text-decoration: none;
		transition:
			border-color var(--timing-fast) var(--easing),
			background var(--timing-fast) var(--easing);
	}
	.profile-state:hover,
	.profile-state:focus-visible {
		border-color: color-mix(in oklch, currentColor, transparent 58%);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.profile-state[data-state='live'] {
		color: var(--coord-verified, #10b981);
	}
	.profile-state[data-state='partial'] {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.profile-state[data-state='gated'] {
		color: oklch(0.48 0.02 60);
	}
	.profile-fingerprint,
	.profile-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.profile-metric {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.profile-api-proof {
		display: block;
		margin-top: 0.18rem;
		color: var(--text-quaternary, oklch(0.63 0.012 60));
	}
	.profile-metric-divider {
		color: var(--text-quaternary, oklch(0.63 0.012 60));
	}
	.profile-action {
		color: oklch(0.38 0.012 60);
		letter-spacing: 0.06em;
	}
	@media (max-width: 980px) {
		.profile-row {
			grid-template-columns: 1fr;
			align-items: start;
		}
	}

	.power-terrain {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.terrain-head {
		display: grid;
		gap: 0.5rem;
	}
	@media (min-width: 760px) {
		.terrain-head {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.85fr);
			align-items: end;
		}
	}
	.terrain-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0.25rem 0 0;
	}
	.terrain-contract-count,
	.terrain-contract-split {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.45rem;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.4;
		color: var(--text-secondary, oklch(0.42 0.012 60));
		margin: 0;
	}
	.terrain-contract-count {
		gap: 0.35rem 0.8rem;
	}
	.terrain-contract-split {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.terrain-count {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
		font-size: 0.625rem;
		line-height: 1.25;
		color: var(--text-secondary, oklch(0.42 0.012 60));
		text-align: right;
		text-transform: uppercase;
	}
	.terrain-count-split {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		white-space: nowrap;
	}
	.studio-authoring-count {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
		font-size: 0.625rem;
		line-height: 1.25;
		color: var(--text-secondary, oklch(0.42 0.012 60));
		text-align: right;
		text-transform: uppercase;
	}
	.studio-authoring-split {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		white-space: nowrap;
	}
	@media (max-width: 759px) {
		.studio-authoring-count,
		.terrain-count {
			justify-content: flex-start;
			text-align: left;
		}
	}
	.terrain-axis {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 800;
		line-height: 1.35;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		text-align: right;
	}
	.terrain-axis span {
		white-space: nowrap;
	}
	.terrain-pressure {
		display: grid;
		gap: 0.375rem;
	}
	@media (min-width: 820px) {
		.terrain-pressure {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.terrain-pressure-cell {
		display: grid;
		grid-template-rows: auto auto auto 1fr auto auto auto;
		gap: 0.35rem;
		min-width: 0;
		min-height: 12rem;
		padding: 0.65rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.terrain-pressure-cell:hover,
	.terrain-pressure-cell:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.terrain-pressure-cell[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.terrain-pressure-cell[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.terrain-pressure-cell[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.terrain-pressure-cell[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.terrain-pressure-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.terrain-pressure-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.terrain-pressure-detail,
	.terrain-pressure-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.38;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.terrain-pressure-detail {
		color: var(--text-secondary, oklch(0.4 0.012 60));
	}
	.terrain-pressure-source {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.terrain-pressure-action {
		align-self: end;
		color: oklch(0.38 0.012 60);
	}
	.terrain-contract {
		display: grid;
		gap: 0.375rem;
	}
	.terrain-grid {
		display: grid;
		gap: 0.375rem;
	}
	.terrain-row {
		display: grid;
		grid-template-columns:
			minmax(9rem, 0.9fr) minmax(5rem, 0.42fr) minmax(6.5rem, 0.48fr)
			minmax(13rem, 1.1fr) minmax(14rem, 1.2fr) minmax(7.5rem, 0.55fr);
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
		padding: 0.5rem 0.625rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.terrain-row:hover,
	.terrain-row:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.terrain-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 48%);
	}
	.terrain-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 45%);
	}
	.terrain-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.terrain-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.terrain-main {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	.terrain-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.terrain-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: oklch(0.48 0.012 60);
	}
	.terrain-row[data-state='live'] .terrain-state {
		color: var(--coord-verified, #10b981);
	}
	.terrain-row[data-state='partial'] .terrain-state {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.terrain-row[data-state='draft-only'] .terrain-state {
		color: oklch(0.62 0.12 78);
	}
	.terrain-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.terrain-ground,
	.terrain-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.terrain-gate {
		color: oklch(0.44 0.012 60);
	}
	.terrain-handoff {
		color: oklch(0.44 0.012 60);
		text-transform: none;
		letter-spacing: 0;
	}
	.terrain-action {
		color: oklch(0.38 0.012 60);
		letter-spacing: 0.06em;
	}
	.terrain-footnote {
		margin: 0;
		padding: 0.625rem 0.75rem;
		border-left: 2px solid color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 50%);
		background: oklch(0.988 0.004 60);
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	@media (max-width: 1080px) {
		.terrain-row {
			grid-template-columns: 1fr;
			align-items: start;
		}
	}

	.operator-queue {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.queue-head {
		display: grid;
		gap: 0.5rem;
	}
	@media (min-width: 760px) {
		.queue-head {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.75fr);
			align-items: end;
		}
	}
	.queue-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0.25rem 0 0;
	}
	.queue-axis {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 800;
		line-height: 1.35;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		text-align: right;
	}
	.queue-axis span {
		white-space: nowrap;
	}
	.queue-pressure {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}
	@media (min-width: 820px) {
		.queue-pressure {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.queue-pressure-cell {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-height: 10.25rem;
		padding: 0.625rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-left: 2px solid oklch(0.76 0.012 60);
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.queue-pressure-cell:hover,
	.queue-pressure-cell:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.queue-pressure-cell[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 42%);
	}
	.queue-pressure-cell[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 38%);
	}
	.queue-pressure-cell[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.queue-pressure-cell[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.queue-pressure-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.queue-pressure-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.75rem;
		color: oklch(0.43 0.012 60);
	}
	.queue-pressure-detail,
	.queue-pressure-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.queue-pressure-gate {
		margin-top: auto;
		color: oklch(0.43 0.012 60);
	}
	.queue-pressure-source {
		color: oklch(0.52 0.012 250);
	}
	.queue-pressure-action {
		text-transform: none;
		letter-spacing: 0;
		color: oklch(0.5 0.012 60);
	}
	.queue-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.875rem;
	}
	@media (min-width: 1080px) {
		.queue-grid {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
		}
	}
	.queue-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	@media (min-width: 1080px) {
		.queue-panel--safe {
			padding-right: 0.875rem;
			border-right: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		}
	}
	.queue-panel-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.queue-panel-count {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: flex-end;
		gap: 0.25rem 0.4rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 750;
		line-height: 1.35;
		color: oklch(0.43 0.012 60);
		text-align: right;
	}
	.queue-panel-split {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		white-space: nowrap;
	}
	.queue-list {
		display: grid;
		gap: 0.375rem;
	}
	.queue-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.625rem;
		padding: 0.5rem 0.5rem 0.5rem 0.625rem;
		border-left: 2px solid transparent;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	@media (min-width: 760px) {
		.queue-row {
			grid-template-columns: minmax(0, 1.4fr) 5.25rem 6.25rem minmax(6rem, 0.7fr);
			align-items: baseline;
		}
	}
	.queue-row:hover,
	.queue-row:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.queue-main {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.queue-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.queue-detail,
	.queue-effect,
	.queue-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.queue-state,
	.queue-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}
	.queue-action {
		text-transform: none;
		letter-spacing: 0;
		color: oklch(0.5 0.012 60);
	}
	.queue-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: oklch(0.45 0.012 60);
	}
	.queue-cluster {
		color: oklch(0.52 0.012 250);
	}
	.queue-handoff {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.42 0.014 220);
	}
	.queue-effect {
		color: oklch(0.43 0.012 60);
	}
	.queue-gate {
		grid-column: 1 / -1;
		color: oklch(0.44 0.012 60);
	}
	@media (min-width: 760px) {
		.queue-gate {
			grid-column: 1 / -1;
		}
	}
	.queue-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 48%);
	}
	.queue-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 45%);
	}
	.queue-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.queue-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}

	.claim-basis {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.claim-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.claim-axis {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 800;
		line-height: 1.35;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		text-align: right;
	}
	.claim-axis span {
		white-space: nowrap;
	}
	.claim-pressure {
		display: grid;
		gap: 0.375rem;
	}
	@media (min-width: 820px) {
		.claim-pressure {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.claim-pressure-cell {
		display: grid;
		grid-template-rows: auto auto auto 1fr auto auto auto;
		gap: 0.35rem;
		min-width: 0;
		min-height: 12rem;
		padding: 0.65rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.claim-pressure-cell:hover,
	.claim-pressure-cell:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.claim-pressure-cell[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.claim-pressure-cell[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.claim-pressure-cell[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.claim-pressure-cell[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.claim-pressure-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.claim-pressure-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.claim-pressure-detail,
	.claim-pressure-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.38;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.claim-pressure-detail {
		color: var(--text-secondary, oklch(0.4 0.012 60));
	}
	.claim-pressure-source {
		color: oklch(0.52 0.012 250);
	}
	.claim-pressure-action {
		align-self: end;
		color: oklch(0.38 0.012 60);
	}
	.claim-list {
		display: grid;
		gap: 0.375rem;
	}
	.claim-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.625rem;
		padding: 0.5rem 0.5rem 0.5rem 0.625rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	@media (min-width: 860px) {
		.claim-row {
			grid-template-columns: minmax(0, 1.4fr) 5rem minmax(7rem, 0.65fr) minmax(7rem, 0.7fr) auto;
			align-items: baseline;
		}
	}
	.claim-main {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.claim-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.claim-proof,
	.claim-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.claim-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}
	.claim-source {
		color: oklch(0.52 0.012 250);
	}
	.claim-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: oklch(0.45 0.012 60);
	}
	.claim-mark {
		display: inline-flex;
		align-items: center;
	}
	.claim-gate {
		grid-column: 1 / -1;
		color: oklch(0.44 0.012 60);
	}
	.claim-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 48%);
	}
	.claim-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 45%);
	}
	.claim-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.claim-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}

	.unlock-cascade {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.cascade-head {
		display: grid;
		gap: 0.5rem;
	}
	@media (min-width: 760px) {
		.cascade-head {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.75fr);
			align-items: end;
		}
	}
	.cascade-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0.25rem 0 0;
	}
	.cascade-axis {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.625rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 800;
		line-height: 1.35;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.cascade-axis span {
		white-space: nowrap;
	}
	@media (min-width: 760px) {
		.cascade-axis {
			justify-content: flex-end;
			text-align: right;
		}
	}
	.cascade-pressure {
		display: grid;
		gap: 0.375rem;
	}
	@media (min-width: 820px) {
		.cascade-pressure {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.cascade-pressure-cell {
		display: grid;
		grid-template-rows: auto auto auto 1fr auto auto auto;
		gap: 0.35rem;
		min-width: 0;
		min-height: 12rem;
		padding: 0.65rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.cascade-pressure-cell:hover,
	.cascade-pressure-cell:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.cascade-pressure-cell[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.cascade-pressure-cell[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.cascade-pressure-cell[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.cascade-pressure-cell[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.cascade-pressure-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.cascade-pressure-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.cascade-pressure-detail,
	.cascade-pressure-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.38;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.cascade-pressure-detail {
		color: var(--text-secondary, oklch(0.4 0.012 60));
	}
	.cascade-pressure-source {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.cascade-pressure-action {
		align-self: end;
		color: oklch(0.38 0.012 60);
	}
	.cascade-list {
		display: grid;
		gap: 0.375rem;
	}
	.cascade-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.625rem;
		padding: 0.5rem 0.5rem 0.5rem 0.625rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	@media (min-width: 900px) {
		.cascade-row {
			grid-template-columns:
				minmax(0, 1.15fr) 5rem 6.75rem minmax(5.5rem, 0.45fr)
				minmax(9rem, 0.75fr) minmax(7rem, 0.65fr);
			align-items: baseline;
		}
	}
	.cascade-main {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.cascade-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.cascade-today,
	.cascade-dependency,
	.cascade-lift,
	.cascade-clusters {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.cascade-state,
	.cascade-count {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}
	.cascade-count {
		text-transform: none;
		letter-spacing: 0;
	}
	.cascade-elapsed {
		color: oklch(0.43 0.012 60);
		white-space: nowrap;
	}
	.cascade-dependency {
		color: oklch(0.43 0.012 60);
	}
	.cascade-tasks {
		color: oklch(0.45 0.012 60);
	}
	.cascade-lift,
	.cascade-clusters {
		grid-column: 1 / -1;
		color: oklch(0.44 0.012 60);
	}
	.cascade-clusters {
		color: oklch(0.52 0.012 250);
	}
	.cascade-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 48%);
	}
	.cascade-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 45%);
	}
	.cascade-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.cascade-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}

	.gate-register {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.gate-head {
		display: grid;
		gap: 0.5rem;
	}
	@media (min-width: 760px) {
		.gate-head {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.75fr);
			align-items: end;
		}
	}
	.gate-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0.25rem 0 0;
	}
	.gate-axis {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 800;
		line-height: 1.35;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		text-align: right;
	}
	.gate-axis span {
		white-space: nowrap;
	}
	.launch-pressure-count {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
		font-size: 0.625rem;
		line-height: 1.25;
		color: var(--text-secondary, oklch(0.42 0.012 60));
		text-align: right;
		text-transform: uppercase;
	}
	.launch-pressure-split {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		white-space: nowrap;
	}
	@media (max-width: 759px) {
		.launch-pressure-count {
			justify-content: flex-start;
			text-align: left;
		}
	}
	.gate-pressure {
		display: grid;
		gap: 0.375rem;
	}
	@media (min-width: 820px) {
		.gate-pressure {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.gate-pressure-cell {
		display: grid;
		grid-template-rows: auto auto auto 1fr auto auto auto;
		gap: 0.35rem;
		min-width: 0;
		min-height: 12rem;
		padding: 0.65rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.gate-pressure-cell:hover,
	.gate-pressure-cell:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.gate-pressure-cell[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.gate-pressure-cell[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.gate-pressure-cell[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.gate-pressure-cell[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.gate-pressure-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.gate-pressure-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.gate-pressure-detail,
	.gate-pressure-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.38;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.gate-pressure-detail {
		color: var(--text-secondary, oklch(0.4 0.012 60));
	}
	.gate-pressure-source {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.gate-pressure-action {
		align-self: end;
		color: oklch(0.38 0.012 60);
	}
	.gate-list {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
	}
	.gate-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.625rem;
		min-width: 0;
		padding: 0.5rem 0.5rem 0.5rem 0.625rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	@media (max-width: 979px) {
		.gate-row {
			grid-template-columns: minmax(0, 1fr);
			align-items: start;
		}

		.gate-state,
		.gate-status,
		.gate-count {
			white-space: normal;
		}
	}
	@media (min-width: 980px) {
		.gate-row {
			grid-template-columns: minmax(0, 1.1fr) 5rem 5.75rem 6.75rem minmax(7rem, 0.7fr);
			align-items: baseline;
		}
	}
	.gate-main {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.gate-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.gate-dependency,
	.gate-chokepoint,
	.gate-clusters {
		color: oklch(0.52 0.012 250);
		letter-spacing: 0.08em;
	}
	.gate-state,
	.gate-status,
	.gate-count {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}
	.gate-count {
		display: inline-flex;
		align-items: baseline;
		justify-content: flex-end;
		gap: 0.25rem;
		text-transform: none;
		letter-spacing: 0;
		color: oklch(0.45 0.012 60);
	}
	.gate-tasks {
		color: oklch(0.45 0.012 60);
	}
	.gate-blocks,
	.gate-unlocks {
		grid-column: 1 / -1;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.gate-unlocks {
		color: oklch(0.44 0.012 60);
	}
	.gate-clusters {
		grid-column: 1 / -1;
	}
	.gate-row[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 48%);
	}
	.gate-row[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 45%);
	}
	.gate-row[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.gate-row[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}

	.composition {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.875rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.composition-head {
		display: grid;
		gap: 0.5rem;
	}
	@media (min-width: 760px) {
		.composition-head {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.75fr);
			align-items: end;
		}
	}
	.composition-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0.25rem 0 0;
	}
	.composition-axis {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.375rem;
		align-items: center;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.5625rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.composition-axis span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	@media (min-width: 760px) {
		.composition-axis {
			text-align: right;
		}
	}
	.composition-pressure {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
	}
	@media (max-width: 760px) {
		.composition-pressure {
			grid-template-columns: 1fr;
		}
	}
	.composition-pressure-card {
		display: flex;
		min-width: 0;
		min-height: 7.5rem;
		flex-direction: column;
		gap: 0.35rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		padding: 0.62rem 0.7rem;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.composition-pressure-card:hover,
	.composition-pressure-card:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.composition-pressure-card[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 48%);
	}
	.composition-pressure-card[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 45%);
	}
	.composition-pressure-card[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.composition-pressure-card[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.composition-pressure-top,
	.composition-pressure-metric {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}
	.composition-pressure-state {
		white-space: nowrap;
	}
	.composition-pressure-metric {
		justify-content: flex-start;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.75rem;
		font-weight: 750;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.composition-pressure-metric span:last-child {
		min-width: 0;
		overflow: hidden;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		font-size: 0.62rem;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}
	.composition-pressure-detail,
	.composition-pressure-gate {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.68rem;
		line-height: 1.38;
	}
	.composition-pressure-detail {
		-webkit-line-clamp: 2;
		color: var(--text-secondary, oklch(0.42 0.012 60));
	}
	.composition-pressure-gate {
		-webkit-line-clamp: 2;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.composition-pressure-action {
		margin-top: auto;
		overflow: hidden;
		color: oklch(0.5 0.012 60);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.path-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.625rem;
	}
	@media (min-width: 920px) {
		.path-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.path-card {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		min-height: 19.5rem;
		padding: 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-left: 2px solid oklch(0.78 0.01 60);
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.path-card:hover,
	.path-card:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.path-card[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 42%);
	}
	.path-card[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 38%);
	}
	.path-card[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.path-card[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.path-top,
	.path-foot {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.path-state,
	.path-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}
	.path-action {
		text-transform: none;
		letter-spacing: 0;
	}
	.path-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.path-sequence {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.path-sequence span {
		padding: 0.2rem 0.35rem;
		border-radius: 6px;
		background: oklch(0.965 0.006 60);
		color: oklch(0.42 0.012 60);
		letter-spacing: 0.08em;
	}
	.path-contract {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.3rem;
	}
	@media (min-width: 560px) {
		.path-contract {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.path-step {
		display: grid;
		gap: 0.18rem;
		padding: 0.45rem 0.5rem;
		border: 1px solid var(--surface-border, oklch(0.88 0.008 60));
		border-left: 2px solid var(--coord-route-solid, #3bc4b8);
		border-radius: 6px;
		background: oklch(0.992 0.003 60);
	}
	.path-step[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}
	.path-step[data-state='draft-only'],
	.path-step[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		border-left-style: dashed;
		background: oklch(0.982 0.004 60);
	}
	.path-step-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.path-step-phase,
	.path-step-state,
	.path-step-gate {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.56rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.48 0.012 60);
	}
	.path-step-state {
		white-space: nowrap;
	}
	.path-step-label,
	.path-step-handoff,
	.path-step-effect {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.66rem;
		line-height: 1.3;
		color: var(--text-secondary, oklch(0.38 0.012 60));
	}
	.path-step-label {
		font-weight: 700;
	}
	.path-step-handoff,
	.path-step-effect {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.path-step-gate {
		text-transform: none;
		letter-spacing: 0;
		color: oklch(0.5 0.012 60);
	}
	.path-promise,
	.path-limit {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.path-limit {
		color: oklch(0.44 0.012 60);
	}
	.path-gate {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.2rem 0.75rem;
		padding: 0.45rem 0.5rem;
		border-left: 2px solid oklch(0.55 0.02 60);
		background: oklch(0.986 0.004 60);
	}
	.path-gate[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}
	.path-gate[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}
	.path-gate[data-state='draft-only'],
	.path-gate[data-state='gated'] {
		border-left-style: dashed;
	}
	.path-gate-kicker,
	.path-gate-tasks,
	.path-gate-count {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.5 0.012 60);
	}
	.path-gate-name {
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.74rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-secondary, oklch(0.38 0.012 60));
	}
	.path-gate-tasks {
		grid-column: 1 / -1;
		text-transform: none;
		letter-spacing: 0;
		color: oklch(0.48 0.012 60);
	}
	.path-gate-count {
		justify-self: end;
		white-space: nowrap;
		letter-spacing: 0;
		text-transform: none;
	}
	.path-visual {
		display: flex;
		align-items: center;
		min-height: 2.5rem;
	}
	.path-meta {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		color: oklch(0.52 0.012 250);
		letter-spacing: 0.08em;
	}
	.path-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		margin-top: auto;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: oklch(0.45 0.012 60);
	}
	.path-foot {
		margin-top: 0.125rem;
		align-items: flex-start;
	}
	.path-unlock {
		color: oklch(0.45 0.012 60);
		text-align: right;
	}

	.readiness {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.875rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}
	.readiness-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.readiness-axis {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.35rem 0.625rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 800;
		line-height: 1.35;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		text-align: right;
	}
	.readiness-axis span {
		white-space: nowrap;
	}
	.send-pressure {
		display: grid;
		gap: 0.375rem;
	}
	@media (min-width: 820px) {
		.send-pressure {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.send-pressure-cell {
		display: grid;
		grid-template-rows: auto auto auto 1fr auto auto auto;
		gap: 0.35rem;
		min-width: 0;
		min-height: 12rem;
		padding: 0.65rem 0.75rem;
		border-left: 2px solid transparent;
		background: var(--surface-base, oklch(0.993 0.003 60));
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-slow) var(--easing),
			background var(--timing-slow) var(--easing);
	}
	.send-pressure-cell:hover,
	.send-pressure-cell:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.988 0.004 60);
		outline: none;
	}
	.send-pressure-cell[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 45%);
	}
	.send-pressure-cell[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 42%);
	}
	.send-pressure-cell[data-state='draft-only'] {
		border-left-color: oklch(0.68 0.12 78);
		background: oklch(0.984 0.005 65);
	}
	.send-pressure-cell[data-state='gated'] {
		border-left-color: oklch(0.62 0.02 60);
		background: oklch(0.982 0.004 60);
	}
	.send-pressure-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.send-pressure-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}
	.send-pressure-detail,
	.send-pressure-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.7rem;
		line-height: 1.38;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.send-pressure-detail {
		color: var(--text-secondary, oklch(0.4 0.012 60));
	}
	.send-pressure-source {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.send-pressure-action {
		align-self: end;
		color: oklch(0.38 0.012 60);
	}
	.mode-list {
		display: grid;
		gap: 0.25rem;
	}
	.mode-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.75rem;
		padding: 0.5rem 0;
		text-decoration: none;
		border-left: 2px solid transparent;
		transition:
			border-color var(--timing-slow) var(--easing),
			color var(--timing-slow) var(--easing);
	}
	@media (min-width: 760px) {
		.mode-row {
			grid-template-columns: minmax(12rem, 1fr) 5.5rem 7.25rem minmax(0, 1.7fr);
			align-items: baseline;
			padding: 0.45rem 0.5rem;
		}
	}
	.mode-row:hover,
	.mode-row:focus-visible {
		border-left-color: var(--coord-route-solid, #3bc4b8);
		outline: none;
	}
	.mode-main {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.mode-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.mode-handoff {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.42 0.014 220);
	}
	.mode-effect {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: oklch(0.43 0.012 60);
	}
	.mode-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.mode-state,
	.mode-action,
	.card-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.45 0.02 60);
		white-space: nowrap;
	}
	.mode-action {
		text-transform: none;
		letter-spacing: 0;
		color: oklch(0.5 0.012 60);
	}
	.mode-unlock {
		grid-column: 1 / -1;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	@media (min-width: 760px) {
		.mode-unlock {
			grid-column: auto;
		}
	}

	.mode-row[data-state='live'] .mode-state,
	.mode-row[data-state='live'] .mode-action,
	.readout-card[data-state='live'] .readout-state,
	.readout-card[data-state='live'] .readout-action,
	.boundary-card[data-state='live'] .boundary-state,
	.boundary-pressure-card[data-state='live'] .boundary-pressure-state,
	.boundary-pressure-card[data-state='live'] .boundary-pressure-action,
	.loop-node[data-state='live'] .loop-node-state,
	.cascade-row[data-state='live'] .cascade-state,
	.gate-row[data-state='live'] .gate-state,
	.gate-pressure-cell[data-state='live'] .gate-pressure-action,
	.send-pressure-cell[data-state='live'] .send-pressure-action,
	.claim-row[data-state='live'] .claim-state,
	.queue-row[data-state='live'] .queue-state,
	.queue-row[data-state='live'] .queue-action,
	.posture-card[data-state='live'] .posture-state,
	.posture-card[data-state='live'] .posture-action,
	.profile-pressure-cell[data-state='live'] .profile-pressure-action,
	.terrain-pressure-cell[data-state='live'] .terrain-pressure-action,
	.shift-pressure-card[data-state='live'] .shift-pressure-state,
	.shift-pressure-card[data-state='live'] .shift-pressure-action,
	.shift-row[data-state='live'] .shift-state,
	.shift-row[data-state='live'] .shift-action,
	.composition-pressure-card[data-state='live'] .composition-pressure-state,
	.composition-pressure-card[data-state='live'] .composition-pressure-action,
	.path-card[data-state='live'] .path-state,
	.path-card[data-state='live'] .path-action,
	.cap-card[data-state='live'] .card-state {
		color: var(--coord-verified, #10b981);
	}
	.mode-row[data-state='partial'] .mode-state,
	.mode-row[data-state='partial'] .mode-action,
	.readout-card[data-state='partial'] .readout-state,
	.readout-card[data-state='partial'] .readout-action,
	.boundary-card[data-state='partial'] .boundary-state,
	.boundary-pressure-card[data-state='partial'] .boundary-pressure-state,
	.boundary-pressure-card[data-state='partial'] .boundary-pressure-action,
	.loop-node[data-state='partial'] .loop-node-state,
	.cascade-row[data-state='partial'] .cascade-state,
	.gate-row[data-state='partial'] .gate-state,
	.gate-pressure-cell[data-state='partial'] .gate-pressure-action,
	.send-pressure-cell[data-state='partial'] .send-pressure-action,
	.claim-row[data-state='partial'] .claim-state,
	.queue-row[data-state='partial'] .queue-state,
	.queue-row[data-state='partial'] .queue-action,
	.posture-card[data-state='partial'] .posture-state,
	.posture-card[data-state='partial'] .posture-action,
	.profile-pressure-cell[data-state='partial'] .profile-pressure-action,
	.terrain-pressure-cell[data-state='partial'] .terrain-pressure-action,
	.shift-pressure-card[data-state='partial'] .shift-pressure-state,
	.shift-pressure-card[data-state='partial'] .shift-pressure-action,
	.shift-row[data-state='partial'] .shift-state,
	.shift-row[data-state='partial'] .shift-action,
	.composition-pressure-card[data-state='partial'] .composition-pressure-state,
	.composition-pressure-card[data-state='partial'] .composition-pressure-action,
	.path-card[data-state='partial'] .path-state,
	.path-card[data-state='partial'] .path-action,
	.cap-card[data-state='partial'] .card-state {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.mode-row[data-state='draft-only'] .mode-state,
	.mode-row[data-state='draft-only'] .mode-action,
	.readout-card[data-state='draft-only'] .readout-state,
	.readout-card[data-state='draft-only'] .readout-action,
	.boundary-card[data-state='draft-only'] .boundary-state,
	.boundary-pressure-card[data-state='draft-only'] .boundary-pressure-state,
	.boundary-pressure-card[data-state='draft-only'] .boundary-pressure-action,
	.loop-node[data-state='draft-only'] .loop-node-state,
	.cascade-row[data-state='draft-only'] .cascade-state,
	.gate-row[data-state='draft-only'] .gate-state,
	.gate-pressure-cell[data-state='draft-only'] .gate-pressure-action,
	.send-pressure-cell[data-state='draft-only'] .send-pressure-action,
	.claim-row[data-state='draft-only'] .claim-state,
	.queue-row[data-state='draft-only'] .queue-state,
	.queue-row[data-state='draft-only'] .queue-action,
	.posture-card[data-state='draft-only'] .posture-state,
	.posture-card[data-state='draft-only'] .posture-action,
	.profile-pressure-cell[data-state='draft-only'] .profile-pressure-action,
	.terrain-pressure-cell[data-state='draft-only'] .terrain-pressure-action,
	.shift-pressure-card[data-state='draft-only'] .shift-pressure-state,
	.shift-pressure-card[data-state='draft-only'] .shift-pressure-action,
	.shift-row[data-state='draft-only'] .shift-state,
	.shift-row[data-state='draft-only'] .shift-action,
	.composition-pressure-card[data-state='draft-only'] .composition-pressure-state,
	.composition-pressure-card[data-state='draft-only'] .composition-pressure-action,
	.path-card[data-state='draft-only'] .path-state,
	.path-card[data-state='draft-only'] .path-action,
	.cap-card[data-state='draft-only'] .card-state {
		color: oklch(0.62 0.12 78);
	}
	.mode-row[data-state='gated'] .mode-state,
	.mode-row[data-state='gated'] .mode-action,
	.readout-card[data-state='gated'] .readout-state,
	.readout-card[data-state='gated'] .readout-action,
	.boundary-card[data-state='gated'] .boundary-state,
	.boundary-pressure-card[data-state='gated'] .boundary-pressure-state,
	.boundary-pressure-card[data-state='gated'] .boundary-pressure-action,
	.loop-node[data-state='gated'] .loop-node-state,
	.cascade-row[data-state='gated'] .cascade-state,
	.gate-row[data-state='gated'] .gate-state,
	.gate-pressure-cell[data-state='gated'] .gate-pressure-action,
	.send-pressure-cell[data-state='gated'] .send-pressure-action,
	.claim-row[data-state='gated'] .claim-state,
	.queue-row[data-state='gated'] .queue-state,
	.queue-row[data-state='gated'] .queue-action,
	.posture-card[data-state='gated'] .posture-state,
	.posture-card[data-state='gated'] .posture-action,
	.profile-pressure-cell[data-state='gated'] .profile-pressure-action,
	.terrain-pressure-cell[data-state='gated'] .terrain-pressure-action,
	.shift-pressure-card[data-state='gated'] .shift-pressure-state,
	.shift-pressure-card[data-state='gated'] .shift-pressure-action,
	.shift-row[data-state='gated'] .shift-state,
	.shift-row[data-state='gated'] .shift-action,
	.composition-pressure-card[data-state='gated'] .composition-pressure-state,
	.composition-pressure-card[data-state='gated'] .composition-pressure-action,
	.path-card[data-state='gated'] .path-state,
	.path-card[data-state='gated'] .path-action,
	.cap-card[data-state='gated'] .card-state {
		color: oklch(0.48 0.02 60);
	}
	.cap-card[data-state='live'] .card-action {
		color: var(--coord-verified, #10b981);
	}
	.cap-card[data-state='partial'] .card-action {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.cap-card[data-state='draft-only'] .card-action {
		color: oklch(0.62 0.12 78);
	}
	.cap-card[data-state='gated'] .card-action {
		color: oklch(0.48 0.02 60);
	}
	.readout-card[data-state='draft-only'],
	.readout-card[data-state='gated'],
	.loop-node[data-state='draft-only'],
	.loop-node[data-state='gated'],
	.boundary-pressure-card[data-state='draft-only'],
	.boundary-pressure-card[data-state='gated'],
	.posture-card[data-state='draft-only'],
	.posture-card[data-state='gated'],
	.profile-pressure-cell[data-state='draft-only'],
	.profile-pressure-cell[data-state='gated'],
	.terrain-pressure-cell[data-state='draft-only'],
	.terrain-pressure-cell[data-state='gated'],
	.shift-pressure-card[data-state='draft-only'],
	.shift-pressure-card[data-state='gated'],
	.shift-row[data-state='draft-only'],
	.shift-row[data-state='gated'],
	.composition-pressure-card[data-state='draft-only'],
	.composition-pressure-card[data-state='gated'],
	.queue-row[data-state='draft-only'],
	.queue-row[data-state='gated'],
	.claim-row[data-state='draft-only'],
	.claim-row[data-state='gated'],
	.cascade-row[data-state='draft-only'],
	.cascade-row[data-state='gated'],
	.gate-row[data-state='draft-only'],
	.gate-row[data-state='gated'],
	.gate-pressure-cell[data-state='draft-only'],
	.gate-pressure-cell[data-state='gated'],
	.send-pressure-cell[data-state='draft-only'],
	.send-pressure-cell[data-state='gated'],
	.path-card[data-state='draft-only'],
	.path-card[data-state='gated'],
	.mode-row[data-state='draft-only'],
	.mode-row[data-state='gated'],
	.cap-card[data-state='draft-only'],
	.cap-card[data-state='gated'] {
		border-left-style: dashed;
	}

	.card-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
		min-width: 0;
	}
	@media (min-width: 760px) {
		.card-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	.cap-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
		min-height: 18rem;
		padding: 0.875rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	.cap-card[data-state='gated'],
	.cap-card[data-state='draft-only'] {
		background: oklch(0.982 0.004 60);
	}
	.card-head,
	.card-foot {
		display: flex;
		min-width: 0;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.card-title-block {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}
	.card-cluster {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		min-width: 0;
		margin-bottom: 0.5rem;
	}
	.card-cluster-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.2;
		color: oklch(0.48 0.012 60);
	}
	.card-cluster-id {
		color: oklch(0.52 0.012 250);
		letter-spacing: 0.08em;
	}
	.card-main {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.card-route {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		color: oklch(0.48 0.012 60);
	}
	.card-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0;
	}
	.card-statement,
	.card-evidence,
	.card-unlock,
	.card-honesty {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		margin: 0;
	}
	.card-evidence {
		color: oklch(0.48 0.012 60);
	}
	.card-contract {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.28rem 0.6rem;
		padding-block: 0.1rem;
	}
	.card-contract-label {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.58rem;
		font-weight: 800;
		letter-spacing: 0;
		text-transform: uppercase;
		color: oklch(0.5 0.012 60);
	}
	.card-contract-value {
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		font-weight: 650;
		line-height: 1.35;
		color: var(--text-secondary, oklch(0.38 0.012 60));
	}
	.card-visual {
		min-height: 2.5rem;
		display: flex;
		align-items: center;
	}
	.card-visual--rings,
	.card-visual--pulse,
	.card-visual--registry {
		justify-content: flex-start;
	}
	.card-metric {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
	}
	.metric-value {
		font-size: 1.35rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.metric-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.6875rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}
	.card-foot {
		margin-top: auto;
		align-items: flex-start;
		flex-direction: column;
	}
	.card-action {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
	}
	.card-chokepoint {
		color: oklch(0.48 0.012 60);
	}
	.card-next-gate {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.2rem 0.65rem;
		box-sizing: border-box;
		min-width: 0;
		width: 100%;
		padding: 0.45rem 0.5rem;
		border-left: 2px solid oklch(0.55 0.02 60);
		background: oklch(0.986 0.004 60);
	}
	.card-next-gate[data-state='live'] {
		border-left-color: var(--coord-verified, #10b981);
	}
	.card-next-gate[data-state='partial'] {
		border-left-color: var(--coord-route-solid, #3bc4b8);
	}
	.card-next-gate[data-state='draft-only'],
	.card-next-gate[data-state='gated'] {
		border-left-style: dashed;
	}
	.card-next-kicker,
	.card-next-tasks,
	.card-next-count {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.5 0.012 60);
	}
	.card-next-name {
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.74rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-secondary, oklch(0.38 0.012 60));
	}
	.card-next-tasks {
		grid-column: 1 / -1;
		text-transform: none;
		letter-spacing: 0;
		color: oklch(0.48 0.012 60);
	}
	.card-next-count {
		justify-self: end;
		min-width: 0;
		max-width: 100%;
		white-space: nowrap;
		letter-spacing: 0;
		text-transform: none;
	}
	@media (max-width: 560px) {
		.card-next-gate {
			grid-template-columns: minmax(0, 1fr);
		}

		.card-next-count {
			justify-self: start;
		}
	}
	.card-honesty {
		color: oklch(0.42 0.012 60);
	}
	.card-action:hover,
	.card-action:focus-visible {
		text-decoration: underline;
		outline: none;
	}
</style>
