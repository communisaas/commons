<!--
  CanvasCapabilityMap — the optional Capability Map. The STUDIO authoring loop as a
  live operating node on a flat, directly manipulated capability map. No sidebar,
  no scrolling content pane — an operating surface with stable position and
  depth. The medium is the argument: an instrument, not a card in a document flow.

  Three layers, back to front:

    1. FIELD (Canvas2D) — ambient verification grain. A calm trace layer of fine
       particles, density + brightness keyed to a REAL metric (the org's
       trailing-week verified actions, and the focused process's live stage).
       Audit signal, never a text line. requestAnimationFrame loop, fully cleaned
       up on destroy. This is verification felt in the surface, not decoration.

    2. WORLD (DOM transform) — a translate+scale layer the operator pans (pointer
       drag) and zooms (wheel, toward cursor). The authoring node lives here, in
       world space, so it has real position + depth on the field.

    3. HUD (fixed) — high-contrast operating rails: org name, workspace posture,
       a live-process pill, Start authoring, and an exit back to the canonical
       shell. No generic nav rail or translucent decorative chrome.

  SEMANTIC ZOOM is the navigation primitive. Zoom out and the node collapses to a
  calm glyph (a pulse + stage dot) in the field; zoom in and it opens to its full,
  legible streaming reasoning. You don't scroll to find detail — you move the
  map to the capability.

  HONESTY RULE: the node binds to a REAL process in the OS registry. Compose calls
  startAuthoringProcess, which streams real agent reasoning via SSE. The idle state
  before Compose is honest — never a faked trace. The process lives in the shared
  OS registry, so leaving and returning shows it still running.

  RUNTIME SAFETY:
    · No $effect reads a reactive value it also writes. The one $effect that syncs
      canvas backing-store size reads the (reactive) DPR + measured size and writes
      only canvas.width/height (a NON-reactive DOM property) — single trigger, no
      loop. The RAF field loop reads live process/viewport state via untrack +
      plain refs, never establishing a reactive dependency.
    · Canvas + listeners init CLIENT-ONLY in onMount; SSR renders the static fallback.
    · onDestroy cancels the RAF, disconnects the ResizeObserver, removes every
      listener. No leaks.
-->
<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { Datum, Ratio } from '$lib/design';
	import { FEATURES } from '$lib/config/features';
	import { COORD_COLORS, EASING, TIMING } from '$lib/design/motion';
	import {
		CAPABILITY_CLUSTER_IDS,
		capabilityClusterLabel,
		formatCapabilityClusters,
		parseCapabilityClusterIds,
		type CapabilityClusterId
	} from '$lib/data/capability-clusters';
	import {
		buildEmailListHealthReadiness,
		buildPeopleSourceProvenanceReadiness,
		buildPowerTerrainReadiness,
		buildResultsProofReadiness,
		buildSendReadiness,
		buildLaunchPressureRows,
		buildStudioAuthoringReadiness,
		buildStudioScopeReadiness,
		formatGateEvidence,
		getDataHonestyEvidence,
		getGateEvidence,
		type DataHonestyEvidence,
		type GateEvidence,
		type LaunchPressureRow,
		type PowerTerrainRow,
		type ResultsProofRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments
	} from '$lib/data/capability-state-labels';
	import { getOrgOS, isRunning, type OrgProcess } from './orgOS.svelte';
	import type { ReasoningStage } from '$lib/components/org/studio/StudioReasoning.svelte';
	import { startAuthoringProcess } from '$lib/core/authoring-process';
	import type { OrgSpacesData } from './spaces';
	import {
		composeConstellation,
		resolveDetailHref,
		regionPopulation,
		REGIONS,
		REGION_ORDER,
		type ConstellationObject,
		type DataConstellationObject,
		type ProcessObject,
		type RegionId
	} from './constellation';
	import {
		buildTargets,
		buildCycleOrder,
		frameBounds,
		pointBounds,
		regionBounds,
		overviewBounds,
		objectLabel,
		easeOutCubic,
		lerpPose,
		posesClose,
		CAMERA_MIN_SCALE,
		CAMERA_MAX_SCALE,
		READ_SCALE,
		type CameraPose,
		type CameraTarget
	} from './camera';
	import { constellationCapabilityContract } from './constellation-capability-contract';
	import ConstellationNode from './ConstellationNode.svelte';
	import ProcessNode from './ProcessNode.svelte';
	import CanvasCapabilityFinder from './CanvasCapabilityFinder.svelte';

	type FieldWorkspaceState = 'live' | 'partial' | 'draft-only' | 'gated';
	type FieldOperatingReadoutId =
		| 'readout-verified-action-loop'
		| 'readout-send-boundary'
		| 'readout-evidence-basis'
		| 'readout-load-bearing-gate';
	type FieldClaimBoundaryId = 'claim-can-claim' | 'claim-must-qualify' | 'claim-cannot-claim-yet';
	type FieldWorkspaceReadout = {
		id: RegionId;
		label: string;
		state: FieldWorkspaceState;
		value: number | null;
		unit: string;
		cite: string;
		action: string;
		detail: string;
		unlock: string;
		gateTasks: string;
		gateSummary: string;
	};
	type FieldOperatingReadout = {
		id: FieldOperatingReadoutId;
		label: string;
		state: FieldWorkspaceState;
		value: number | null;
		unit: string;
		cite: string;
		action: string;
		detail: string;
		href: string;
		gate: string;
	};
	type FieldLoopPhaseId = 'INTENT' | 'GROUND' | 'AUTHOR' | 'RESOLVE' | 'SEND' | 'AGGREGATE';
	type FieldLoopPhase = {
		id: FieldLoopPhaseId;
		label: string;
		state: FieldWorkspaceState;
		workspace: string;
		href: string;
		action: string;
		clusters: string;
		value: number | null;
		unit: string;
		cite: string;
		unlock: string;
	};
	type FieldNextMove = {
		id: string;
		kicker: string;
		label: string;
		state: FieldWorkspaceState;
		href: string;
		action: string;
		handoff: string;
		effect: string;
		gate: string;
		cite: string;
		value: number | null;
		unit: string;
	};
	type FieldVisibleContract = {
		label: string;
		state: FieldWorkspaceState;
		clusters: string;
		href: string;
		action: string;
		source: string;
		gate: string;
		value: number | null;
		unit: string;
	};
	type FieldStateLedgerRow = {
		state: FieldWorkspaceState;
		label: string;
		value: number;
		href: string;
		action: string;
		sample: string;
		source: string;
		gate: string;
	};
	type FieldCoverageRow = {
		id: CapabilityClusterId;
		label: string;
		state: FieldWorkspaceState;
		value: number;
		href: string;
		action: string;
		lead: string;
		source: string;
		gate: string;
		boundary: string;
		boundarySource: string;
		boundaryGate: string;
	};
	type FieldOperatingSpineItem = {
		id: 'move-now' | 'qualify' | 'hold' | 'next-lift';
		label: string;
		state: FieldWorkspaceState;
		value: number | null;
		unit: string;
		cite: string;
		href: string;
		action: string;
		detail: string;
		gate: string;
	};

	const FIELD_STATE_ORDER: FieldWorkspaceState[] = ['live', 'partial', 'draft-only', 'gated'];
	const FIELD_WORKSPACE_CLUSTERS: Record<RegionId, string> = {
		STUDIO: 'C-agentic / C-composability',
		PEOPLE: 'C-reach / C-verification / C-data-sovereignty',
		POWER: 'C-accountability / C-quality-signaling',
		RESULTS: 'C-verification / C-reader-side / C-coordination-integrity'
	};
	const FIELD_OPERATING_CLUSTERS: Record<FieldOperatingReadoutId, string> = {
		'readout-verified-action-loop': 'C-verification / C-coordination-integrity / C-agentic',
		'readout-send-boundary': 'C-reach / C-data-sovereignty / C-coordination-integrity',
		'readout-evidence-basis': 'C-verification / C-data-sovereignty',
		'readout-load-bearing-gate': 'C-composability / C-agentic / C-accountability'
	};
	const FIELD_CLAIM_CLUSTERS: Record<FieldClaimBoundaryId, string> = {
		'claim-can-claim': 'C-verification / C-coordination-integrity',
		'claim-must-qualify': 'C-data-sovereignty / C-quality-signaling',
		'claim-cannot-claim-yet': 'C-composability / C-accountability / C-agentic'
	};
	type FieldClaimBoundary = {
		id: FieldClaimBoundaryId;
		label: string;
		state: FieldWorkspaceState;
		href: string;
		action: string;
		ground: string;
		boundary: string;
		cite: string;
		value: number | null;
		unit: string;
	};

	let {
		orgName,
		base,
		canPublish,
		fieldSignal,
		spaces = null
	}: {
		orgName: string;
		/** `/org/[slug]` — exit target back to the canonical shell. */
		base: string;
		/** Owner/editor can publish; display gate only. */
		canPublish: boolean;
		/** Real verified-action metric the ambient field keys its grain to. */
		fieldSignal: { thisWeek: number | null; lastWeek: number | null };
		/** The org's REAL workspace slices, already loaded.
		 *  null = layout slice unavailable → honest empty regions. No new queries. */
		spaces?: OrgSpacesData | null;
	} = $props();

	const os = getOrgOS();

	// ─── The CONSTELLATION — the org's whole working world, laid in world-space.
	// Pure composition from the already-loaded spaces + the live process registry.
	// Every object is REAL; null slices simply contribute nothing (honest empty).
	const constellation = $derived<ConstellationObject[]>(
		composeConstellation({ spaces, processes: os.processes })
	);
	// Split authoring-process objects (process nodes — they keep the full
	// streaming face here) from the read-only data objects (rendered via the
	// reusable ConstellationNode). The STUDIO node is rendered explicitly.
	const processObjects = $derived(
		constellation.filter((o): o is ProcessObject => o.type === 'process')
	);
	const studioObject = $derived(constellation.find((o) => o.type === 'studio') ?? null);
	const dataObjects = $derived<DataConstellationObject[]>(
		constellation.filter(
			(o): o is DataConstellationObject => o.type !== 'process' && o.type !== 'studio'
		)
	);
	// Per-region population for the honest empty-state tells.
	const population = $derived(regionPopulation(constellation));
	// ANY running process stirs the ambient field (breadth aggregation).
	const anyRunning = $derived(os.runningProcesses.length > 0);
	const authoringRuntime = $derived(spaces?.operating?.authoring ?? null);
	const authoringRuntimeReady = $derived(authoringRuntime?.runtimeReady === true);
	const emailDelivery = $derived(spaces?.operating?.emailDelivery ?? null);
	const textDelivery = $derived(spaces?.operating?.textDelivery ?? null);
	const congressionalDelivery = $derived(spaces?.operating?.congressionalDelivery ?? null);
	const platformApiSync = $derived(spaces?.operating?.platformApiSync ?? null);
	const emailDeliveryHref = $derived(`${base}/emails/compose#email-delivery`);
	const actionRecordsHref = $derived(`${base}#action-records`);
	const resultsPacketHref = $derived(`${base}#results-packet`);
	const packetHref = $derived(
		spaces?.return?.topCampaignId
			? `${base}/campaigns/${spaces.return.topCampaignId}/report#proof-preview`
			: resultsPacketHref
	);
	const proofDeliveryHref = $derived(
		spaces?.return?.topCampaignId
			? `${base}/campaigns/${spaces.return.topCampaignId}/report#proof-delivery`
			: actionRecordsHref
	);

	const platformApiGate = getGateEvidence('CP-platform-api-sync', ['T1-3'], {
		name: 'Direct platform sync',
		downstream: 1,
		dependency: 'Encrypted credential custody + direct sync execution'
	});
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
	const mainnetGate = getGateEvidence('CP-mainnet-deployment', ['T3-6', 'T5-5', 'T6-2', 'T6-1']);
	const teeGate = getGateEvidence('CP-tee-nitro-enclave', ['T5-3', 'T5-4']);
	const delegationGate = getGateEvidence('CP-delegation-executor', [
		'T4-2',
		'T4-1',
		'T4-8',
		'T4-9'
	]);
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
	const studioJurisdictionScopeGate = getGateEvidence(
		'CP-studio-jurisdiction-scope',
		['T3-1', 'T3-2', 'T3-3', 'T3-4', 'T3-5'],
		{
			name: 'Full jurisdiction resolution',
			downstream: 5,
			dependency: 'State, local, special-district, and international resolver coverage'
		}
	);
	const reachExpansionGate = getGateEvidence(
		'CP-reach-expansion',
		['T3-1', 'T3-2', 'T3-3', 'T3-4', 'T3-5'],
		{
			name: 'State, local, and international reach',
			downstream: 5,
			dependency: 'Multi-state + international Phase 2'
		}
	);
	const readerOfficeGate = getGateEvidence('CP-dm-office-profile', ['T8-1a', 'T8-1b', 'T8-8'], {
		name: 'Reader office integration',
		downstream: 4,
		dependency: 'DM enrichment partnership track'
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
	const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2'], {
		name: 'Receipt anchoring',
		downstream: 8,
		dependency: 'Mainnet SnapshotAnchor + receipt writer'
	});
	const coordinationIntegrityGate = getGateEvidence('CP-coordination-integrity', ['T10-10'], {
		name: 'Engagement tier histogram UI',
		downstream: 1,
		dependency: 'Execution records + packet-local coordination metrics'
	});
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
	const smsDispatchGate = getGateEvidence('CP-sms-dispatch', ['T2-1'], {
		name: 'SMS dispatch',
		downstream: 2,
		dependency: 'Client-side phone decryptor + Twilio proxy'
	});
	const donationReceiptGate = getGateEvidence('CP-donation-receipt-compliance', ['T6-1', 'T6-2'], {
		name: 'Donation receipt compliance',
		downstream: 4,
		dependency: 'Receipt policy workflow + mainnet anchoring'
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
	const delegatedActionGate = weakestGate([delegationGate, teeGate]);
	const studioGate = delegatedActionGate;
	const loadBearingGate = weakestGate([
		platformApiGate,
		mainnetGate,
		teeGate,
		delegationGate,
		delegatedTraceGate,
		studioJurisdictionScopeGate,
		reachExpansionGate,
		readerOfficeGate,
		powerStateLocalTerrainGate,
		powerInternationalTerrainGate,
		powerStateBillTerrainGate,
		powerNonFederalScorecardGate,
		powerOfficeResponseGate,
		receiptAnchoringGate,
		coordinationIntegrityGate,
		emailProxyGate,
		messageProofGate,
		smsDispatchGate,
		abAutomationGate,
		eventArtifactGate,
		workflowEffectsGate,
		congressionalLaunchGate
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
			fallbackSubscribedCount: spaces?.base?.emailHealth.subscribed ?? null,
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
	const sendLoopState = $derived<FieldWorkspaceState>(sendReadiness.state);
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
			: 'no held send mode'
	);
	const sendLoopNextLift = $derived(
		sendReadiness.nextHeldMode ? sendReadiness.nextHeldLabel : 'no held send mode'
	);
	const sendLoopHref = $derived(
		sendReadiness.nextHeldMode?.route ?? `${base}/studio#capability-send`
	);
	const sendLoopAction = $derived(sendReadiness.nextHeldMode?.action ?? 'read send boundary');
	const peopleSourceProvenanceReadiness = $derived(
		buildPeopleSourceProvenanceReadiness({
			base,
			sourceCounts: spaces?.base?.sourceCounts ?? null,
			totalPeople: spaces?.base?.total ?? null,
			platformApiGate
		})
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
				loaded: Boolean(spaces?.base),
				subscribed: spaces?.base?.emailHealth.subscribed ?? null,
				unsubscribed: spaces?.base?.emailHealth.unsubscribed ?? null,
				bounced: spaces?.base?.emailHealth.bounced ?? null,
				complained: spaces?.base?.emailHealth.complained ?? null,
				consentEvidenceCount: spaces?.base?.consentEvidence.email ?? null,
				subscribedConsentEvidenceCount: spaces?.base?.consentEvidence.emailSubscribed ?? null
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
	const peopleFieldWorkspaceState = $derived<FieldWorkspaceState>(emailListHealthReadiness.state);
	const peopleFieldWorkspaceDetail = $derived(
		spaces?.base
			? `${emailListHealthReadiness.effect} ${peopleSourceProvenanceReadiness.effect}`
			: 'People slice is unread; consent-bound reach, source custody, and verification-weight claims are not claimed or counted.'
	);
	const peopleFieldWorkspaceGate = $derived(
		`${emailListHealthReadiness.gate} ${peopleSourceProvenanceReadiness.gate}`
	);
	const powerTerrainReadiness = $derived(
		buildPowerTerrainReadiness({
			base,
			power: {
				loaded: Boolean(spaces?.landscape),
				legislationEnabled: Boolean(spaces?.landscape?.legislationEnabled),
				followedCount: spaces?.landscape?.followedCount ?? null,
				watchedBillCount: spaces?.landscape?.bills.length ?? null,
				scorecardCount: spaces?.landscape?.scorecardSnapshotCount ?? null
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
	const powerTerrainRows = $derived<PowerTerrainRow[]>(powerTerrainReadiness.rows);
	const powerResolveRow = $derived(
		powerTerrainRows.find((row) => row.id === 'target-records') ??
			powerTerrainRows.find((row) => row.phase === 'RESOLVE') ??
			null
	);
	const firstHeldPowerTerrainRow = $derived(
		powerTerrainRows.find((row) => row.state === 'draft-only' || row.state === 'gated') ?? null
	);
	const powerLoopState = $derived<FieldWorkspaceState>(powerTerrainReadiness.state);
	const powerLoopMetric = $derived({
		value: powerTerrainReadiness.terrainCount,
		label: powerTerrainReadiness.terrainCount === 1 ? 'terrain record' : 'terrain records',
		cite: 'buildPowerTerrainReadiness'
	});
	const powerLoopHref = $derived(
		powerResolveRow?.href ?? `${base}/representatives#power-following`
	);
	const powerLoopAction = $derived(powerResolveRow?.action ?? 'read Power terrain');
	const powerLoopGate = $derived(
		firstHeldPowerTerrainRow?.boundary ?? powerResolveRow?.boundary ?? powerTerrainReadiness.gate
	);
	const powerLoopNextLift = $derived(
		firstHeldPowerTerrainRow
			? `${firstHeldPowerTerrainRow.label} next`
			: readoutUnlock(powerTerrainReadiness.nextGate)
	);
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
				loaded: Boolean(spaces?.return),
				hasPacket: Boolean(spaces?.return?.packet),
				verifiedCount: spaces?.return?.packet?.verified ?? null,
				totalCount: spaces?.return?.packet?.total ?? null,
				districtCount: spaces?.return?.packet?.districtCount ?? null,
				sentEmails: spaces?.return?.stats.sentEmails ?? null,
				campaignCount: spaces?.return?.campaigns.length ?? null,
				receiptCount: spaces?.return?.receipts.loadedCount ?? null,
				pendingReceiptCount: spaces?.return?.receipts.pendingCount ?? null,
				responseLoggedReceiptCount: spaces?.return?.receipts.responseLoggedCount ?? null,
				anchorFieldCount: spaces?.return?.receipts.anchorFieldCount ?? null,
				receiptSampleLimit: spaces?.return?.receipts.sampleLimit ?? null,
				receiptProofWeightTotal: spaces?.return?.receipts.proofWeightTotal ?? null
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
		resultsProofRows.find((row) => row.id === 'packet-artifact') ?? null
	);
	const firstHeldResultsProofRow = $derived(
		resultsProofRows.find((row) => row.state === 'draft-only' || row.state === 'gated') ?? null
	);
	const resultsLoopState = $derived<FieldWorkspaceState>(resultsProofReadiness.state);
	const resultsLoopMetric = $derived({
		value: resultsProofReadiness.metric.value,
		label: resultsProofReadiness.metric.label,
		cite: resultsProofReadiness.metric.cite
	});
	const resultsLoopHref = $derived(resultsPacketRow?.href ?? resultsProofReadiness.href);
	const resultsLoopAction = $derived(resultsPacketRow?.action ?? resultsProofReadiness.action);
	const resultsLoopGate = $derived(
		firstHeldResultsProofRow?.boundary ?? resultsPacketRow?.boundary ?? resultsProofReadiness.gate
	);
	const resultsLoopNextLift = $derived(
		firstHeldResultsProofRow
			? `${firstHeldResultsProofRow.label} next`
			: readoutUnlock(resultsProofReadiness.nextGate)
	);
	const abAutomationState = $derived<FieldWorkspaceState>(
		!FEATURES.AB_TESTING ? 'gated' : abAutomationGate.state === 'live' ? 'live' : 'draft-only'
	);
	const civicGeographyLabelsState = $derived<FieldWorkspaceState>(
		civicGeographyLabelsGate.state === 'live' ? 'live' : 'partial'
	);
	const fieldLaunchPressureRows = $derived<LaunchPressureRow[]>(
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
			process: os.studioProcessEvidence,
			runtime: authoringRuntime,
			gates: {
				studioJurisdictionScopeGate,
				messageProofGate,
				delegatedTraceGate,
				delegatedActionGate
			}
		})
	);
	const studioAuthoringIntentRow = $derived(
		studioAuthoringReadiness.rows.find((row) => row.key === 'intent') ?? null
	);
	const studioAuthoringArtifactRow = $derived(
		studioAuthoringReadiness.rows.find((row) => row.key === 'message-composition') ?? null
	);
	const studioFieldWorkspaceState = $derived<FieldWorkspaceState>(studioAuthoringReadiness.state);
	const studioFieldWorkspaceDetail = $derived(
		canPublish
			? studioAuthoringReadiness.effect
			: 'Current role can author, watch, and preserve Studio evidence; route handoffs and execution side effects require org authority.'
	);
	const verifiedLoopReadoutDetail = $derived(
		studioAuthoringArtifactRow?.state === 'live'
			? 'Author artifact is emitted; resolve, send, and aggregate still follow route-local evidence gates.'
			: `Intent can be shaped; AUTHOR is ${stateLabel(
					studioAuthoringArtifactRow?.state ?? studioAuthoringReadiness.state
				)} and uses the authored-artifact row before the loop claims message output.`
	);
	const peopleGroundLoopState = $derived<FieldWorkspaceState>(
		!spaces?.base
			? 'gated'
			: peopleSourceProvenanceReadiness.state === 'live' &&
				  emailListHealthReadiness.state === 'live'
				? 'live'
				: peopleSourceProvenanceReadiness.state === 'gated' &&
					  emailListHealthReadiness.state === 'gated'
					? 'gated'
					: peopleSourceProvenanceReadiness.state === 'draft-only' &&
						  emailListHealthReadiness.state === 'draft-only'
						? 'draft-only'
						: 'partial'
	);
	const peopleGroundLoopGate = $derived(
		`${peopleSourceProvenanceReadiness.gate} ${emailListHealthReadiness.gate}`
	);
	const fieldLoopPhases = $derived<FieldLoopPhase[]>([
		{
			id: 'INTENT',
			label: 'Define action',
			state: studioAuthoringIntentRow?.state ?? studioAuthoringReadiness.state,
			workspace: 'Studio',
			href: studioAuthoringIntentRow?.href ?? `${base}/studio#studio-intent`,
			action: studioAuthoringIntentRow?.action ?? 'read intent',
			clusters: 'C-agentic / C-composability',
			value: studioAuthoringIntentRow?.metric.value ?? studioAuthoringReadiness.metric.value,
			unit: studioAuthoringIntentRow?.metric.label ?? studioAuthoringReadiness.metric.label,
			cite: studioAuthoringIntentRow?.metric.cite ?? studioAuthoringReadiness.metric.cite,
			unlock: studioAuthoringIntentRow?.gate ?? studioAuthoringReadiness.gate
		},
		{
			id: 'GROUND',
			label: 'Attach ground',
			state: peopleGroundLoopState,
			workspace: 'People',
			href: peopleSourceProvenanceReadiness.href,
			action: peopleSourceProvenanceReadiness.action,
			clusters: 'C-verification / C-data-sovereignty / C-quality-signaling',
			value: peopleSourceProvenanceReadiness.metric.value,
			unit: peopleSourceProvenanceReadiness.metric.label,
			cite: peopleSourceProvenanceReadiness.metric.cite,
			unlock: peopleGroundLoopGate
		},
		{
			id: 'AUTHOR',
			label: 'Author artifact',
			state: studioAuthoringArtifactRow?.state ?? studioAuthoringReadiness.state,
			workspace: 'Studio',
			href: `${base}/studio#studio-intent`,
			action: studioAuthoringArtifactRow?.action ?? 'read authoring contract',
			clusters: 'C-agentic / C-quality-signaling',
			value: studioAuthoringArtifactRow?.metric.value ?? studioAuthoringReadiness.metric.value,
			unit: studioAuthoringArtifactRow?.metric.label ?? studioAuthoringReadiness.metric.label,
			cite: studioAuthoringArtifactRow?.metric.cite ?? studioAuthoringReadiness.metric.cite,
			unlock: studioAuthoringArtifactRow?.gate ?? studioAuthoringReadiness.gate
		},
		{
			id: 'RESOLVE',
			label: 'Resolve power target',
			state: powerLoopState,
			workspace: 'Power',
			href: powerLoopHref,
			action: powerLoopAction,
			clusters: 'C-reach / C-accountability',
			value: powerLoopMetric.value,
			unit: powerLoopMetric.label,
			cite: powerLoopMetric.cite,
			unlock: powerLoopGate
		},
		{
			id: 'SEND',
			label: 'Deliver only armed channels',
			state: sendLoopState,
			workspace: 'Studio',
			href: sendLoopHref,
			action: sendLoopAction,
			clusters: 'C-reader-side / C-reach / C-verification',
			value: sendLoopMetric.value,
			unit: sendLoopMetric.label,
			cite: sendLoopMetric.cite,
			unlock: sendLoopGate
		},
		{
			id: 'AGGREGATE',
			label: 'Aggregate proof',
			state: resultsLoopState,
			workspace: 'Results',
			href: resultsLoopHref,
			action: resultsLoopAction,
			clusters: 'C-accountability / C-coordination-integrity / C-composability',
			value: resultsLoopMetric.value,
			unit: resultsLoopMetric.label,
			cite: resultsLoopMetric.cite,
			unlock: resultsLoopGate
		}
	]);
	const loopPhaseStates = $derived<FieldWorkspaceState[]>(
		fieldLoopPhases.map((phase) => phase.state)
	);
	const liveLoopPhaseCount = $derived(loopPhaseStates.filter((state) => state === 'live').length);
	const totalLoopPhaseCount = $derived(loopPhaseStates.length);
	const loopReadoutState = $derived<FieldWorkspaceState>(
		liveLoopPhaseCount === totalLoopPhaseCount ? 'live' : 'partial'
	);
	const loadedOrgSlices = $derived([
		spaces?.return ?? null,
		spaces?.base ?? null,
		spaces?.landscape ?? null,
		spaces?.operating ?? null
	]);
	const totalOrgSliceCount = $derived(loadedOrgSlices.length);
	const loadedSliceCount = $derived(loadedOrgSlices.filter(Boolean).length);
	const unloadedSliceCount = $derived(Math.max(0, totalOrgSliceCount - loadedSliceCount));
	const dataHonestyRows: DataHonestyEvidence[] = [
		getDataHonestyEvidence('V-5', 'FIX-V5', {
			live: 'FIX-V5 complete',
			gated: 'public verifier preimage mismatch',
			gate: 'FIX-V5'
		}),
		getDataHonestyEvidence('V-3', 'FIX-V3', {
			live: 'FIX-V3 complete',
			gated: 'debate seed coverage gap',
			gate: 'FIX-V3'
		}),
		getDataHonestyEvidence('V-4', 'FIX-V4', {
			live: 'FIX-V4 complete',
			gated: 'coalition accent tier gate gap',
			gate: 'FIX-V4'
		}),
		getDataHonestyEvidence('V-2', 'FIX-V2', {
			live: 'FIX-V2 complete',
			gated: 'atlasVersion not threaded by clients',
			gate: 'FIX-V2'
		})
	];
	const liveHonestyCount = $derived(dataHonestyRows.filter((row) => row.state === 'live').length);
	const unresolvedHonestyRows = $derived(dataHonestyRows.filter((row) => row.state !== 'live'));
	const unresolvedHonestyCount = $derived(unresolvedHonestyRows.length);
	const unresolvedHonestyMarks = $derived(unresolvedHonestyRows.map((row) => row.mark).join(', '));
	const dataHonestyMarkCount = dataHonestyRows.length;
	const unresolvedBasisCount = $derived(unloadedSliceCount + unresolvedHonestyCount);
	const evidenceBasisState = $derived<FieldWorkspaceState>(
		unresolvedBasisCount === 0 ? 'live' : 'partial'
	);
	const basisGapSummary = $derived(
		unresolvedBasisCount > 0
			? [
					unloadedSliceCount > 0
						? `${unloadedSliceCount} org slice${unloadedSliceCount === 1 ? '' : 's'} unloaded`
						: null,
					unresolvedHonestyCount > 0
						? `unresolved data-honesty marks: ${unresolvedHonestyMarks}`
						: null
				]
					.filter(Boolean)
					.join('; ')
			: 'All org slices and data-honesty marks back current claims.'
	);
	const basisReadoutDetail = $derived(
		`${loadedSliceCount}/${totalOrgSliceCount} org slices loaded; ${liveHonestyCount}/${dataHonestyMarkCount} ${stateLabel('live')} data-honesty marks.`
	);

	function weakestGate(gates: GateEvidence[]): GateEvidence {
		const unresolved = gates.filter((gate) => gate.status !== 'completed');
		return (unresolved.length > 0 ? unresolved : gates).reduce((current, gate) =>
			gate.downstream > current.downstream ? gate : current
		);
	}

	function readoutUnlock(gate: GateEvidence): string {
		return gate.status === 'completed' ? `${gate.name} armed` : `${gate.name} next`;
	}

	function readoutGateSummary(gate: GateEvidence, prefix: string): string {
		return formatGateEvidence(gate, { prefix, density: 'operator' });
	}

	const fieldOperatingReadouts = $derived<FieldOperatingReadout[]>([
		{
			id: 'readout-verified-action-loop',
			label: 'Verified action loop',
			state: loopReadoutState,
			value: liveLoopPhaseCount,
			unit: `of ${totalLoopPhaseCount} phases`,
			cite: 'INTENT/GROUND/AUTHOR/RESOLVE/SEND/AGGREGATE route contracts',
			action: 'read loop posture',
			detail: verifiedLoopReadoutDetail,
			href: `${base}/studio#capability-loop`,
			gate: readoutGateSummary(
				delegationGate,
				'The loop compounds when delegated actions can carry proof-bound agent authority.'
			)
		},
		{
			id: 'readout-send-boundary',
			label: 'Send boundary',
			state: sendLoopState,
			value: sendLoopMetric.value,
			unit: sendLoopMetric.label,
			cite: sendLoopMetric.cite,
			action: sendLoopAction,
			detail: sendLoopSummary,
			href: sendLoopHref,
			gate: sendLoopGate
		},
		{
			id: 'readout-evidence-basis',
			label: 'Evidence basis',
			state: evidenceBasisState,
			value: unresolvedBasisCount,
			unit: 'basis gaps',
			cite: 'layout OrgSpacesData + data-honesty audit marks',
			action: 'read claim basis',
			detail: basisReadoutDetail,
			href: `${base}/studio#capability-basis`,
			gate: basisGapSummary
		},
		{
			id: 'readout-load-bearing-gate',
			label: 'Load-bearing gate',
			state: loadBearingGate.state,
			value: loadBearingGate.downstream,
			unit: 'downstream',
			cite: 'critical path hypergraph',
			action: 'open gate register',
			detail: loadBearingGate.name,
			href: `${base}/studio#capability-gates`,
			gate: readoutGateSummary(loadBearingGate, 'Highest fan-out unresolved gate on this field.')
		}
	]);

	const fieldWorkspaceReadouts = $derived<FieldWorkspaceReadout[]>([
		{
			id: 'STUDIO',
			label: 'Studio',
			state: studioFieldWorkspaceState,
			value: os.runningProcesses.length,
			unit: os.runningProcesses.length === 1 ? 'process' : 'processes',
			cite: 'OS process registry',
			action: 'read Studio posture',
			detail: studioFieldWorkspaceDetail,
			unlock: readoutUnlock(studioGate),
			gateTasks: studioGate.tasks,
			gateSummary: readoutGateSummary(
				studioGate,
				'Delegated civic action is the next lift from assisted authoring to bounded agency.'
			)
		},
		{
			id: 'PEOPLE',
			label: 'People',
			state: peopleFieldWorkspaceState,
			value: emailListHealthReadiness.metric.value,
			unit: emailListHealthReadiness.metric.label,
			cite: emailListHealthReadiness.metric.cite,
			action: emailListHealthReadiness.action,
			detail: peopleFieldWorkspaceDetail,
			unlock: readoutUnlock(emailListHealthReadiness.nextGate),
			gateTasks: emailListHealthReadiness.nextGate.tasks,
			gateSummary: peopleFieldWorkspaceGate
		},
		{
			id: 'POWER',
			label: 'Power',
			state: powerLoopState,
			value: powerLoopMetric.value,
			unit: powerLoopMetric.label,
			cite: powerLoopMetric.cite,
			action: firstHeldPowerTerrainRow?.action ?? powerLoopAction,
			detail: powerTerrainReadiness.detail,
			unlock: powerLoopNextLift,
			gateTasks: firstHeldPowerTerrainRow?.gate.tasks ?? powerTerrainReadiness.nextGate.tasks,
			gateSummary: powerLoopGate
		},
		{
			id: 'RESULTS',
			label: 'Results',
			state: resultsLoopState,
			value: resultsLoopMetric.value,
			unit: resultsLoopMetric.label,
			cite: resultsLoopMetric.cite,
			action: firstHeldResultsProofRow?.action ?? resultsLoopAction,
			detail: resultsProofReadiness.detail,
			unlock: resultsLoopNextLift,
			gateTasks: firstHeldResultsProofRow?.gate.tasks ?? resultsProofReadiness.nextGate.tasks,
			gateSummary: resultsLoopGate
		}
	]);
	const fieldWorkspaceReadoutByRegion = $derived<Record<RegionId, FieldWorkspaceReadout>>(
		Object.fromEntries(fieldWorkspaceReadouts.map((item) => [item.id, item])) as Record<
			RegionId,
			FieldWorkspaceReadout
		>
	);
	const fieldNextMoves = $derived<FieldNextMove[]>([
		{
			id: 'next-grounded-authoring',
			kicker: nextMoveKicker(studioAuthoringReadiness.state),
			label: 'Grounded authoring',
			state: studioAuthoringReadiness.state,
			href: studioAuthoringIntentRow?.href ?? `${base}/studio#studio-intent`,
			action: studioAuthoringIntentRow?.action ?? 'read intent',
			handoff: studioAuthoringIntentRow?.handoff ?? 'Studio intent',
			effect: studioAuthoringReadiness.effect,
			gate: studioAuthoringReadiness.gate,
			cite: studioAuthoringReadiness.metric.cite,
			value: studioAuthoringReadiness.metric.value,
			unit: studioAuthoringReadiness.metric.label
		},
		{
			id: 'next-studio-scope-recovery',
			kicker: nextMoveKicker(studioScopeReadiness.state),
			label: 'Studio scope and recovery',
			state: studioScopeReadiness.state,
			href: `${base}/studio#studio-intent`,
			action: 'read Studio scope',
			handoff: 'Studio evidence',
			effect: studioScopeReadiness.effect,
			gate: studioScopeReadiness.gate,
			cite: 'buildStudioScopeReadiness boundary',
			value: studioScopeReadiness.boundaryCount,
			unit: studioScopeReadiness.boundaryCount === 1 ? 'bounded claim' : 'bounded claims'
		},
		{
			id: sendReadiness.nextHeldMode
				? `next-held-${sendReadiness.nextHeldMode.key}`
				: 'next-send-clear',
			kicker: nextMoveKicker(sendReadiness.nextHeldState),
			label: sendReadiness.nextHeldMode?.label ?? sendLoopNextLift,
			state: sendReadiness.nextHeldState,
			href: sendLoopHref,
			action: sendLoopAction,
			handoff: sendReadiness.nextHeldMode?.handoff ?? 'Send readiness',
			effect: sendReadiness.nextHeldMode?.effect ?? sendLoopSummary,
			gate: sendReadiness.nextHeldMode?.unlock ?? sendLoopGate,
			cite: sendLoopMetric.cite,
			value: sendLoopMetric.value,
			unit: sendLoopMetric.label
		},
		{
			id: 'next-load-bearing-gate',
			kicker: 'Load-bearing',
			label: loadBearingGate.name,
			state: loadBearingGate.state,
			href: `${base}/studio#capability-gates`,
			action: 'read gate register',
			handoff: 'Gate register',
			effect: loadBearingGate.dependency,
			gate: readoutGateSummary(
				loadBearingGate,
				'The strongest blocked claims stay bounded by this gate.'
			),
			cite: loadBearingGate.source,
			value: loadBearingGate.downstream,
			unit: 'downstream'
		}
	]);
	const claimQualifierCount = $derived(
		unresolvedBasisCount + sendLoopMetric.value + studioScopeReadiness.boundaryCount
	);
	const claimQualifierBoundary = $derived(
		claimQualifierCount > 0
			? `${basisGapSummary}; ${sendLoopSummary}; ${studioScopeReadiness.gate}`
			: 'No basis, send, or Studio-scope qualifier is currently visible; stronger execution claims still follow route-owned gates.'
	);
	const fieldClaimBoundaries = $derived<FieldClaimBoundary[]>([
		{
			id: 'claim-can-claim',
			label: 'Can claim',
			state: loopReadoutState,
			href: `${base}/studio#capability-loop`,
			action: 'read loop posture',
			ground:
				'Commons can show the verified action loop, workspace posture, and route handoffs where rows are armed or bounded.',
			boundary:
				'Claims cite loaded slices, process evidence, readiness builders, and route-owned outputs; missing slices are not counted.',
			cite: 'INTENT/GROUND/AUTHOR route contracts',
			value: liveLoopPhaseCount,
			unit: 'armed phases'
		},
		{
			id: 'claim-must-qualify',
			label: 'Must qualify',
			state: claimQualifierCount > 0 ? 'partial' : 'live',
			href: `${base}/studio#capability-basis`,
			action: 'read claim basis',
			ground:
				'Send modes, Studio scope, unloaded org slices, and data-honesty marks determine the qualifier language.',
			boundary: claimQualifierBoundary,
			cite: 'buildSendReadiness + data-honesty marks',
			value: claimQualifierCount,
			unit: 'qualifiers'
		},
		{
			id: 'claim-cannot-claim-yet',
			label: 'Cannot claim yet',
			state: loadBearingGate.state,
			href: `${base}/studio#capability-gates`,
			action: 'read gate register',
			ground:
				'Autonomous agents, settlement-proof receipts, broad terrain, and unarmed dispatch stay future-tense until gates close.',
			boundary: readoutGateSummary(
				loadBearingGate,
				'The strongest blocked claims stay out of the active surface.'
			),
			cite: 'critical path hypergraph',
			value: loadBearingGate.downstream,
			unit: 'blocked lift'
		}
	]);
	const fieldObjectContracts = $derived<FieldVisibleContract[]>(
		dataObjects.map((object) => {
			const contract = constellationCapabilityContract(object);
			return {
				label: contract.label,
				state: normalizeFieldState(contract.state),
				clusters: contract.clusters,
				href:
					resolveDetailHref(object.detailHref, base) ?? `${base}/studio#capability-state-ledger`,
				action: contract.action,
				source: contract.cite,
				gate: readoutGateSummary(contract.gate, 'Object contract next lift.'),
				value: contract.gate.downstream,
				unit: 'downstream'
			};
		})
	);
	const fieldVisibleContracts = $derived<FieldVisibleContract[]>([
		...fieldObjectContracts,
		...fieldOperatingReadouts.map((item) => ({
			label: item.label,
			state: item.state,
			clusters: FIELD_OPERATING_CLUSTERS[item.id],
			href: item.href,
			action: item.action,
			source: item.cite,
			gate: item.gate,
			value: item.value,
			unit: item.unit
		})),
		...fieldLoopPhases.map((phase) => ({
			label: phase.id,
			state: phase.state,
			clusters: phase.clusters,
			href: phase.href,
			action: phase.action,
			source: phase.cite,
			gate: phase.unlock,
			value: phase.value,
			unit: phase.unit
		})),
		...fieldWorkspaceReadouts.map((item) => ({
			label: item.label,
			state: item.state,
			clusters: FIELD_WORKSPACE_CLUSTERS[item.id],
			href: workspaceContractHref(item.id),
			action: item.action,
			source: item.cite,
			gate: item.gateSummary,
			value: item.value,
			unit: item.unit
		})),
		...fieldNextMoves.map((move) => ({
			label: move.label,
			state: move.state,
			clusters: nextMoveContractClusters(move),
			href: move.href,
			action: move.action,
			source: move.cite,
			gate: move.gate,
			value: move.value,
			unit: move.unit
		})),
		...fieldLaunchPressureRows.map((row) => ({
			label: row.name,
			state: row.state,
			clusters: row.cluster,
			href: row.href,
			action: row.action,
			source: row.gate.source,
			gate: readoutGateSummary(row.gate, row.futureLift),
			value: row.gate.downstream,
			unit: 'downstream'
		})),
		...fieldClaimBoundaries.map((boundary) => ({
			label: boundary.label,
			state: boundary.state,
			clusters: FIELD_CLAIM_CLUSTERS[boundary.id],
			href: boundary.href,
			action: boundary.action,
			source: boundary.cite,
			gate: boundary.boundary,
			value: boundary.value,
			unit: boundary.unit
		}))
	]);
	const fieldVisibleContractCount = $derived(fieldVisibleContracts.length);
	const fieldStateCounts = $derived<Record<FieldWorkspaceState, number>>(
		Object.fromEntries(
			FIELD_STATE_ORDER.map((state) => [
				state,
				fieldVisibleContracts.filter((contract) => contract.state === state).length
			])
		) as Record<FieldWorkspaceState, number>
	);
	const fieldStateRatioSegments = $derived(operatorCapabilityStateRatioSegments(fieldStateCounts));
	const fieldStateLedgerRows = $derived<FieldStateLedgerRow[]>(
		FIELD_STATE_ORDER.map((state) => {
			const representative = fieldVisibleContracts.find((contract) => contract.state === state);
			return {
				state,
				label: stateLabel(state),
				value: fieldStateCounts[state],
				href: representative?.href ?? `${base}/studio#capability-state-ledger`,
				action: representative?.action ?? 'read capability state ledger',
				sample: representative?.label ?? 'No visible contract in this state',
				source: representative?.source ?? 'full-map visible capability contracts',
				gate: representative?.gate ?? 'Open Studio state ledger for the complete contract basis.'
			};
		})
	);
	const fieldCoverageRows = $derived<FieldCoverageRow[]>(
		CAPABILITY_CLUSTER_IDS.map((id) => {
			const contracts = fieldVisibleContracts.filter((contract) =>
				parseCapabilityClusterIds(contract.clusters).includes(id)
			);
			const lead =
				contracts.find((contract) => contract.state === 'live') ??
				contracts.find((contract) => contract.state === 'partial') ??
				contracts[0];
			const boundary = fieldCoverageBoundaryContract(contracts);
			return {
				id,
				label: capabilityClusterLabel(id),
				state: aggregateCoverageState(contracts),
				value: contracts.length,
				href: `${base}/studio#capability-cluster-coverage`,
				action: 'read coverage basis',
				lead: lead?.label ?? 'No field contract in this scan',
				source: lead?.source ?? 'CAPABILITY_CLUSTER_IDS + visible field contracts',
				gate: lead?.gate ?? 'Open Studio coverage for the full cluster basis.',
				boundary:
					boundary?.label ??
					(contracts.length > 0 ? 'No unresolved lift in scan' : 'No field contract'),
				boundarySource: boundary?.source ?? 'CAPABILITY_CLUSTER_IDS + visible field contracts',
				boundaryGate:
					boundary?.gate ??
					(contracts.length > 0
						? 'No unresolved lift is visible in the canvas scan; read Studio coverage for the full basis.'
						: 'Open Studio coverage for the full cluster basis.')
			};
		})
	);
	const fieldCoveredClusterCount = $derived(
		fieldCoverageRows.filter((row) => row.value > 0).length
	);
	const fieldCoverageStateCounts = $derived<Record<FieldWorkspaceState, number>>(
		Object.fromEntries(
			FIELD_STATE_ORDER.map((state) => [
				state,
				fieldCoverageRows.filter((row) => row.state === state).length
			])
		) as Record<FieldWorkspaceState, number>
	);
	const fieldHeldClusterCount = $derived(
		fieldCoverageStateCounts['draft-only'] + fieldCoverageStateCounts.gated
	);
	const heldCapabilityCount = $derived(fieldStateCounts['draft-only'] + fieldStateCounts.gated);
	const fieldOperatingSpine = $derived<FieldOperatingSpineItem[]>([
		{
			id: 'move-now',
			label: 'Move now',
			state: fieldStateCounts.live > 0 ? 'live' : 'gated',
			value: fieldStateCounts.live,
			unit: 'armed',
			cite: 'visible armed capability contracts',
			href: `${base}/studio#capability-state-ledger`,
			action: fieldStateCounts.live > 0 ? 'read armed moves' : 'read capability state ledger',
			detail: `${fieldCoveredClusterCount}/${CAPABILITY_CLUSTER_IDS.length} clusters carry field evidence`,
			gate:
				fieldStateCounts.live > 0
					? 'Armed rows still cite route-owned execution boundaries.'
					: 'No armed visible contract in this scan; read the state ledger before acting.'
		},
		{
			id: 'qualify',
			label: 'Qualify',
			state: fieldStateCounts.partial > 0 ? 'partial' : 'live',
			value: fieldStateCounts.partial,
			unit: 'bounded',
			cite: 'visible bounded capability contracts',
			href: `${base}/studio#capability-basis`,
			action: fieldStateCounts.partial > 0 ? 'read qualifiers' : 'read claim basis',
			detail:
				fieldStateCounts.partial > 0
					? 'Use with visible scope, evidence, and boundary language'
					: 'No bounded visible contract in this scan',
			gate: basisGapSummary
		},
		{
			id: 'hold',
			label: 'Hold',
			state: heldCapabilityCount > 0 ? 'gated' : 'live',
			value: heldCapabilityCount,
			unit: 'held',
			cite: 'visible draft-only + not-armed capability contracts',
			href: `${base}/studio#capability-state-ledger`,
			action: heldCapabilityCount > 0 ? 'read held verbs' : 'read clear holds',
			detail:
				heldCapabilityCount > 0
					? `${sendLoopGround} plus dependency-first contracts`
					: 'No draft-only or not-armed visible contract in this scan',
			gate: sendLoopGate
		},
		{
			id: 'next-lift',
			label: 'Next lift',
			state: loadBearingGate.state,
			value: loadBearingGate.downstream,
			unit: 'downstream',
			cite: loadBearingGate.source,
			href: `${base}/studio#capability-gates`,
			action: 'read gate register',
			detail: loadBearingGate.name,
			gate: readoutGateSummary(loadBearingGate, 'Highest fan-out unresolved gate on this field.')
		}
	]);

	function normalizeFieldState(state: FieldWorkspaceState | 'testnet'): FieldWorkspaceState {
		return state === 'testnet' ? 'gated' : state;
	}

	function workspaceContractHref(id: RegionId): string {
		if (id === 'STUDIO') return `${base}/studio`;
		if (id === 'PEOPLE') return `${base}/supporters`;
		if (id === 'POWER') return `${base}/representatives`;
		return base;
	}

	function nextMoveContractClusters(move: FieldNextMove): string {
		if (move.label === 'Grounded authoring')
			return 'C-agentic / C-verification / C-quality-signaling';
		if (move.label === 'Studio scope and recovery') return 'C-accountability / C-quality-signaling';
		if (move.label === loadBearingGate.name)
			return 'C-composability / C-agentic / C-accountability';
		return sendReadiness.nextHeldMode?.cluster ?? 'C-reach / C-coordination-integrity';
	}

	function aggregateCoverageState(contracts: FieldVisibleContract[]): FieldWorkspaceState {
		if (contracts.length === 0) return 'gated';
		if (contracts.every((contract) => contract.state === 'live')) return 'live';
		if (contracts.every((contract) => contract.state === 'gated')) return 'gated';
		if (contracts.every((contract) => contract.state === 'draft-only')) return 'draft-only';
		return 'partial';
	}

	function fieldCoverageBoundaryContract(
		contracts: FieldVisibleContract[]
	): FieldVisibleContract | undefined {
		return (
			contracts.find((contract) => contract.state === 'gated') ??
			contracts.find((contract) => contract.state === 'draft-only') ??
			contracts.find((contract) => contract.state === 'partial')
		);
	}

	function stateLabel(state: FieldWorkspaceState): string {
		return operatorCapabilityStateLabel(state);
	}

	function actionLabel(state: FieldWorkspaceState, action: string): string {
		return operatorCapabilityActionLabel(state, action);
	}

	function nextMoveKicker(state: FieldWorkspaceState): string {
		const label = stateLabel(state);
		return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
	}

	function signalAria(value: number | null, unit: string): string {
		return value === null ? 'unread' : `${value.toLocaleString('en-US')} ${unit}`;
	}

	function workspaceReadoutAriaLabel(readout: FieldWorkspaceReadout): string {
		return `${readout.label}. Capability is ${stateLabel(readout.state)}; action is ${actionLabel(readout.state, readout.action)}; signal is ${signalAria(readout.value, readout.unit)}. Next unlock: ${readout.unlock}, ${readout.gateTasks}.`;
	}

	function dockAriaLabel(readout: FieldWorkspaceReadout, shortcut: number): string {
		return `Move to ${workspaceReadoutAriaLabel(readout)} Press ${shortcut}.`;
	}

	function operatingReadoutAriaLabel(readout: FieldOperatingReadout): string {
		return `${readout.label}. ${stateLabel(readout.state)}. ${signalAria(readout.value, readout.unit)}. ${actionLabel(readout.state, readout.action)}. ${readout.detail}`;
	}

	function loopPhaseAriaLabel(phase: FieldLoopPhase): string {
		return `${phase.id}: ${phase.label}. ${stateLabel(phase.state)} in ${phase.workspace}. ${signalAria(phase.value, phase.unit)}. ${actionLabel(phase.state, phase.action)}. Next unlock: ${phase.unlock}`;
	}

	function nextMoveAriaLabel(move: FieldNextMove): string {
		return `${move.kicker}: ${move.label}. ${stateLabel(move.state)}. ${signalAria(move.value, move.unit)}. ${actionLabel(move.state, move.action)}. ${move.effect}`;
	}

	function launchPressureAriaLabel(row: LaunchPressureRow): string {
		return `${row.name}. ${stateLabel(row.state)}. ${actionLabel(row.state, row.action)}. Handoff: ${row.handoff}. Ground: ${row.ground}. Effect: ${row.effect}. Next lift: ${row.nextLift}. Full ground: ${row.currentGround} Blocked verb: ${row.blocked}. Gate: ${readoutGateSummary(row.gate, row.futureLift)}`;
	}

	function claimBoundaryAriaLabel(boundary: FieldClaimBoundary): string {
		return `${boundary.label}. ${stateLabel(boundary.state)}. ${signalAria(boundary.value, boundary.unit)}. ${actionLabel(boundary.state, boundary.action)}. ${boundary.ground} Boundary: ${boundary.boundary}`;
	}

	function stateLedgerAriaLabel(row: FieldStateLedgerRow): string {
		return `${row.label}. ${row.value.toLocaleString('en-US')} visible contracts. ${actionLabel(row.state, row.action)}. Representative: ${row.sample}. ${row.gate}`;
	}

	function coverageAriaLabel(row: FieldCoverageRow): string {
		return `${row.label}. ${stateLabel(row.state)}. ${row.value.toLocaleString('en-US')} visible contracts. ${actionLabel(row.state, row.action)}. Lead evidence: ${row.lead}. Next lift: ${row.boundary}. ${row.boundaryGate}`;
	}

	function operatingSpineAriaLabel(item: FieldOperatingSpineItem): string {
		return `${item.label}. ${stateLabel(item.state)}. ${signalAria(item.value, item.unit)}. ${actionLabel(item.state, item.action)}. ${item.detail}. ${item.gate}`;
	}

	// ─── The focused process — the STUDIO authoring node renders this one, and the
	// HUD pill + ambient grain key to it. The full streaming face now lives in the
	// ProcessNode child (per-process), so this component only needs the focused
	// process's status + stage for the chrome + field hue.
	const proc = $derived<OrgProcess | null>(os.focusedProcess);
	const running = $derived(proc ? isRunning(proc) : false);
	const activeStage = $derived<ReasoningStage | null>(proc?.activeStage ?? null);
	const stageLabel = $derived(proc?.stageLabel ?? '');
	const procError = $derived(proc?.errorMessage ?? null);

	// The focused process's active-stage hue — drives the ambient field grain (it
	// blooms when ANY process runs, in the focused process's color) + the studio
	// node halo. Calm route-teal when nothing is active.
	const STAGE_COLOR: Record<ReasoningStage, string> = {
		ground: COORD_COLORS.ROUTE.solid,
		author: COORD_COLORS.SHARE.solid,
		resolve: COORD_COLORS.VERIFIED.solid
	};
	const stageColor = $derived(activeStage ? STAGE_COLOR[activeStage] : COORD_COLORS.ROUTE.solid);

	// ─── Viewport (pan/zoom) — plain $state; transforms are CSS vars ────────
	// MIN/MAX scale are the camera module's constants so a manual wheel/keyboard
	// zoom and a camera fly can never land outside each other's range.
	const MIN_SCALE = CAMERA_MIN_SCALE;
	const MAX_SCALE = CAMERA_MAX_SCALE;
	let scale = $state(1);
	let panX = $state(0);
	let panY = $state(0);

	// ─── Navigable targets — the finder index + cycle order. Pure derivation from
	// the SAME constellation the field renders, so every destination is a real
	// object (or a fixed region / the overview). Rebuilds when objects change. ──
	const targets = $derived<CameraTarget[]>(buildTargets(constellation));
	const cycleOrder = $derived<CameraTarget[]>(buildCycleOrder(targets));

	// Detail level by scale — the SEMANTIC ZOOM tiers. Glyph → summary → full.
	const detail = $derived<'glyph' | 'summary' | 'full'>(
		scale < 0.6 ? 'glyph' : scale < 1.2 ? 'summary' : 'full'
	);
	const viewModeLabel = $derived(
		detail === 'glyph' ? 'Whole map' : detail === 'summary' ? 'Scan' : 'Detail'
	);

	// ─── Refs ────────────────────────────────────────────────────────────────
	let rootEl: HTMLDivElement | undefined;
	let canvasEl: HTMLCanvasElement | undefined;

	// ─── Reduced motion ──────────────────────────────────────────────────────
	let reduceMotion = $state(false);

	// ─── Camera controller — the OS navigation primitive ──────────────────────
	// You don't drag the desktop: you state an INTENT and the camera FLIES you to
	// the target. flyTo() animates the (reactive) scale/panX/panY toward a framed
	// pose via a rAF ease-out lerp. A new flyTo cancels the in-flight one; a manual
	// drag/wheel cancels it too (fine-tuning is preserved, just demoted). Reduced
	// motion snaps instantly. The rAF id + animation refs are PLAIN (non-reactive)
	// so the loop never establishes a reactive dependency and there's no read-write
	// $effect cycle — the loop writes scale/pan imperatively from inside rAF.
	let cameraRafId: number | null = null;
	let flyFrom: CameraPose = { scale: 1, panX: 0, panY: 0 };
	let flyTo_: CameraPose = { scale: 1, panX: 0, panY: 0 };
	let flyStart = 0;
	let flyDuration = 0;
	// `flying` is reactive ONLY to gate the WORLD's CSS transition OFF while the rAF
	// lerp drives the transform — otherwise CSS would re-ease each rAF write, fighting
	// the lerp. It is written by flyToPose/cancelFly/stepFly, never DERIVED from
	// scale/pan, so it can't form a read-write $effect cycle.
	let flying = $state(false);

	// Camera history (BACK key). Each fly pushes the pose we LEFT, so back retraces.
	let cameraHistory: CameraPose[] = [];

	// The current viewport size, read from the measured root rect. Used to frame.
	function viewport(): { width: number; height: number } {
		const r = rootEl?.getBoundingClientRect();
		return { width: r?.width ?? 0, height: r?.height ?? 0 };
	}

	function currentPose(): CameraPose {
		return { scale, panX, panY };
	}

	/** Stop any in-flight camera animation. Safe to call when none is running. */
	function cancelFly() {
		if (cameraRafId !== null) {
			cancelAnimationFrame(cameraRafId);
			cameraRafId = null;
		}
		flying = false;
	}

	/**
	 * Fly the camera to a framed pose. Cancels the in-flight fly first; pushes the
	 * pose we're leaving onto history (for BACK); snaps instantly under reduced
	 * motion. Distance-aware duration so a short hop is quick and an overview pull
	 * is unhurried — but always bounded. Browser-only (rAF); SSR never calls this.
	 */
	function flyToPose(target: CameraPose, opts: { record?: boolean } = {}) {
		if (typeof window === 'undefined') return;
		const from = currentPose();
		if (opts.record !== false) {
			cameraHistory = [...cameraHistory.slice(-31), from];
		}
		cancelFly();

		if (posesClose(from, target)) {
			scale = target.scale;
			panX = target.panX;
			panY = target.panY;
			return;
		}

		if (reduceMotion) {
			scale = target.scale;
			panX = target.panX;
			panY = target.panY;
			return;
		}

		// Duration scales with how far the zoom changes + how far we pan, clamped to
		// a calm band. A region→region hop is ~360ms; an overview pull ~520ms.
		const zoomDelta = Math.abs(Math.log2(target.scale / Math.max(0.001, from.scale)));
		const panDelta = Math.hypot(target.panX - from.panX, target.panY - from.panY);
		flyDuration = Math.round(Math.min(560, Math.max(280, 240 + zoomDelta * 120 + panDelta * 0.12)));
		flyFrom = from;
		flyTo_ = target;
		flyStart =
			typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
		flying = true;
		cameraRafId = requestAnimationFrame(stepFly);
	}

	/** One rAF tick of the camera ease-out. Writes scale/pan imperatively (no
	 *  reactive read of its own output → no loop). Self-cancels at progress 1. */
	function stepFly() {
		const now =
			typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
		const elapsed = now - flyStart;
		const t = flyDuration <= 0 ? 1 : Math.min(1, elapsed / flyDuration);
		const eased = easeOutCubic(t);
		const pose = lerpPose(flyFrom, flyTo_, eased);
		scale = pose.scale;
		panX = pose.panX;
		panY = pose.panY;
		if (t < 1) {
			cameraRafId = requestAnimationFrame(stepFly);
		} else {
			cameraRafId = null;
			flying = false;
		}
	}

	/** Fly to a navigable target (object / region / overview), framing its bounds
	 *  at a comfortable read-zoom. The single entry point finder/cycle/dock use. */
	function flyToTarget(target: CameraTarget) {
		const pose = frameBounds(viewport(), target.bounds, { maxScale: target.maxScale });
		flyToPose(pose);
		// A fly to a process FOCUSES it (the HUD pill + ambient grain follow focus).
		if (target.processId) os.focusProcess(target.processId);
	}

	/** Fly to a region by id (the 1-4 hotkeys / dock chips). */
	function flyToRegion(id: RegionId) {
		flyToPose(frameBounds(viewport(), regionBounds(id), { maxScale: CAMERA_MAX_SCALE }));
	}

	/** Fly to the whole-constellation overview (Mission Control: out to everything). */
	function flyToOverview() {
		flyToPose(
			frameBounds(viewport(), overviewBounds(), { maxScale: CAMERA_MAX_SCALE, padding: 120 })
		);
	}

	/** Fly to a single object's framed read-zoom (CLICK / cycle). */
	function flyToObject(o: ConstellationObject) {
		flyToPose(frameBounds(viewport(), pointBounds(o.x, o.y), { maxScale: READ_SCALE }));
	}

	/** Retrace to the previous camera focus (BACK). Pops history; does NOT record
	 *  the pose we leave (so back-back-back walks the stack, not ping-pongs). */
	function flyBack() {
		const prev = cameraHistory[cameraHistory.length - 1];
		if (!prev) return;
		cameraHistory = cameraHistory.slice(0, -1);
		flyToPose(prev, { record: false });
	}

	// ─── Cycle (Cmd-Tab) — running processes first, then objects, then regions ──
	let cycleIndex = $state(-1);
	function cycleFocus(dir: 1 | -1) {
		const order = cycleOrder;
		if (order.length === 0) return;
		cycleIndex = (cycleIndex + dir + order.length) % order.length;
		const t = order[cycleIndex];
		if (t) flyToTarget(t);
	}

	// ─── Capability finder (⌘K) — the PRIMARY navigation ──────────────────────
	let finderOpen = $state(false);
	function openFinder() {
		finderOpen = true;
	}
	function closeFinder() {
		finderOpen = false;
	}

	// ─── Pan interaction (pointer drag) ──────────────────────────────────────
	// isPanning drives the grab/grabbing cursor (class:field--panning) so it is
	// reactive. The drag offsets + pointer id are plain refs (read inside handlers
	// only, never in markup) so they don't need to be $state.
	let isPanning = $state(false);
	let panPointerId: number | null = null;
	let dragStartX = 0;
	let dragStartY = 0;
	let dragOriginX = 0;
	let dragOriginY = 0;
	let moved = false;

	function onPointerDown(e: PointerEvent) {
		// Don't hijack drags that start on interactive node chrome (inputs/buttons/
		// the scrollable trace) — only the open field pans.
		const target = e.target as HTMLElement;
		if (target.closest('[data-no-pan]')) return;
		// A manual drag INTERRUPTS the camera — fine-tuning always wins over a fly
		// in progress, so the operator is never fighting the animation.
		cancelFly();
		isPanning = true;
		moved = false;
		panPointerId = e.pointerId;
		dragStartX = e.clientX;
		dragStartY = e.clientY;
		dragOriginX = panX;
		dragOriginY = panY;
		rootEl?.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!isPanning || e.pointerId !== panPointerId) return;
		const dx = e.clientX - dragStartX;
		const dy = e.clientY - dragStartY;
		if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
		panX = dragOriginX + dx;
		panY = dragOriginY + dy;
	}

	function endPan(e: PointerEvent) {
		if (e.pointerId !== panPointerId) return;
		isPanning = false;
		panPointerId = null;
		if (rootEl?.hasPointerCapture(e.pointerId)) rootEl.releasePointerCapture(e.pointerId);
	}

	// ─── Zoom (wheel, toward cursor) ──────────────────────────────────────────
	function applyZoom(nextScaleRaw: number, originX: number, originY: number) {
		const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScaleRaw));
		if (nextScale === scale) return;
		// Keep the world point under (originX, originY) fixed across the zoom.
		const worldX = (originX - panX) / scale;
		const worldY = (originY - panY) / scale;
		scale = nextScale;
		panX = originX - worldX * nextScale;
		panY = originY - worldY * nextScale;
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const rect = rootEl?.getBoundingClientRect();
		if (!rect) return;
		// Wheel zoom is fine-tuning — it interrupts an in-flight fly.
		cancelFly();
		const factor = e.deltaY > 0 ? 0.9 : 1.1;
		applyZoom(scale * factor, e.clientX - rect.left, e.clientY - rect.top);
	}

	// ─── Keyboard navigation — INTENT-driven, the OS way ──────────────────────
	// The camera flies you; manual pan/zoom (arrows, +/-) is demoted to fine-tuning.
	//   · 1-4         → fly to a region (Spaces)
	//   · 0 / \       → fly to the whole-constellation overview (Mission Control)
	//   · Tab / ⇧Tab  → cycle focus through processes + objects + regions (Cmd-Tab)
	//   · [ / Backspc → fly back to the previous focus (history)
	//   · ⌘K          → Find capability — handled in onFinderKey (capture)
	//   · arrows, +/- → fine-tuning pan/zoom (kept, secondary)
	function onKeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement)?.tagName;
		// Don't capture keys while typing intent (the compose form) or searching.
		if (tag === 'INPUT' || tag === 'TEXTAREA') return;
		// While the capability finder owns the screen, it handles its own keys.
		if (finderOpen) return;

		const center = () => {
			const r = rootEl?.getBoundingClientRect();
			return r ? { x: r.width / 2, y: r.height / 2 } : { x: 0, y: 0 };
		};
		const step = 64;

		// ── INTENT navigation (no modifier chords — keyboard IS the point) ──
		if (!e.metaKey && !e.ctrlKey && !e.altKey) {
			switch (e.key) {
				case '1':
					flyToRegion('STUDIO');
					e.preventDefault();
					return;
				case '2':
					flyToRegion('PEOPLE');
					e.preventDefault();
					return;
				case '3':
					flyToRegion('POWER');
					e.preventDefault();
					return;
				case '4':
					flyToRegion('RESULTS');
					e.preventDefault();
					return;
				case '0':
				case '\\':
					flyToOverview();
					e.preventDefault();
					return;
				case '[':
				case 'Backspace':
					flyBack();
					e.preventDefault();
					return;
			}
		}

		// ── Cycle (Cmd-Tab) ── Tab forward, Shift-Tab back. Plain Tab here (the
		// field is role=application + focused, so AT passes the key to us).
		if (e.key === 'Tab') {
			cycleFocus(e.shiftKey ? -1 : 1);
			e.preventDefault();
			return;
		}

		// ── Fine-tuning (kept, visibly secondary) ──
		switch (e.key) {
			case 'ArrowLeft':
				cancelFly();
				panX += step;
				e.preventDefault();
				break;
			case 'ArrowRight':
				cancelFly();
				panX -= step;
				e.preventDefault();
				break;
			case 'ArrowUp':
				cancelFly();
				panY += step;
				e.preventDefault();
				break;
			case 'ArrowDown':
				cancelFly();
				panY -= step;
				e.preventDefault();
				break;
			case '+':
			case '=': {
				cancelFly();
				const c = center();
				applyZoom(scale * 1.15, c.x, c.y);
				e.preventDefault();
				break;
			}
			case '-':
			case '_': {
				cancelFly();
				const c = center();
				applyZoom(scale / 1.15, c.x, c.y);
				e.preventDefault();
				break;
			}
		}
	}

	// ─── Constellation interaction ────────────────────────────────────────────
	// CLICK a process glyph → FOCUS it and FLY there (the camera animates over, no
	// jump-cut). If we drag-released (moved), suppress the click so panning isn't a
	// focus. The fly itself focuses the process (flyToObject sets focus too — but
	// processes go through flyToTarget so the HUD/grain follow immediately).
	function focusProcessNode(o: ProcessObject) {
		if (moved) return;
		os.focusProcess(o.proc.id);
		flyToObject(o);
	}

	// Center the currently-focused process (HUD pill). Flies to it; if none is
	// focused, pulls back to the overview.
	function centerLiveProcess() {
		const focused = processObjects.find((o) => o.proc.id === os.focusedProcessId);
		if (focused) flyToObject(focused);
		else flyToOverview();
	}

	// CLICK a data object (action record / People / Power / Results) → fly to it. Suppress
	// if the click was actually a drag-release.
	function flyToDataObject(o: DataConstellationObject) {
		if (moved) return;
		flyToObject(o);
	}

	// The finder-style label for an object (for the click-to-fly shim's aria-label).
	function objectLabelOf(o: DataConstellationObject): string {
		return objectLabel(o).label;
	}

	// DOCK: click a running-process chip → focus + fly to its node. Falls back to
	// just focusing if the process has no positioned object yet (defensive).
	function flyToRunningProcess(id: string) {
		os.focusProcess(id);
		const o = processObjects.find((p) => p.proc.id === id);
		if (o) flyToObject(o);
	}

	// Deep-link to a canonical route. Centralized here so ALL window navigation lives
	// in the parent (the child ConstellationNode never touches window). Suppress if
	// the click was actually the end of a drag.
	function openDetails(href: string) {
		if (moved) return;
		if (typeof window !== 'undefined') window.location.href = href;
	}

	// ─── INTENT (the only local state the node owns) ──────────────────────────
	let subjectLine = $state('');
	let coreMessage = $state('');
	let audienceGuidance = $state('');
	let intentError = $state<string | null>(null);
	let composing = $state(false); // HUD-driven: reveal the intent face

	function openCompose() {
		composing = true;
		// Bring the studio instrument into frame if we're zoomed out — fly, don't jump.
		if (studioObject && scale < 0.9) flyToObject(studioObject);
	}

	// ⌘K / Ctrl-K opens Find capability on THIS surface — the primary, intent-driven
	// navigation: type → fly to the thing. The org layout ALSO listens for ⌘K (to
	// toggle the org-wide Spotlight) on the BUBBLE phase via <svelte:window>; we
	// capture it FIRST and stopImmediatePropagation so, while inhabiting the capability
	// field, ⌘K opens the map finder instead of the shell command surface. Capture-phase +
	// stopImmediate keeps the two handlers from both firing — no double-toggle.
	// A second ⌘K (palette already open) closes it (toggle).
	function onFinderKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			e.stopImmediatePropagation();
			if (finderOpen) closeFinder();
			else openFinder();
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
		// Hand to the OS runner — it spawns + focuses the process and streams real
		// agent reasoning into the registry, independent of this component.
		startAuthoringProcess(os, {
			subjectLine: subjectLine.trim(),
			coreMessage: coreMessage.trim(),
			audienceGuidance: audienceGuidance.trim()
		});
		composing = false;
		// Fly to the freshly-spawned process so its full reasoning face opens. The
		// new process is focused by the runner; frame it (a tick later, once the
		// constellation re-derives with the new object) — fall back to the studio.
		queueMicrotask(() => {
			const fresh = processObjects.find((o) => o.proc.id === os.focusedProcessId);
			if (fresh) flyToObject(fresh);
			else if (studioObject) flyToObject(studioObject);
		});
	}

	function stopLoop() {
		if (proc) os.stopProcess(proc.id);
	}

	function exitToWorkspace() {
		window.location.href = `${base}/studio`;
	}

	// ─── Ambient FIELD renderer (Canvas2D, RAF) ───────────────────────────────
	// Calm generative grain. Particle density + drift speed key to a REAL metric:
	//   · verified-action density from the org's trailing-week count (log-mapped),
	//   · a brighter, faster bloom WHILE a process is actively reasoning.
	// Nothing here is decorative noise: the field is louder when the org has done
	// more verified work, and it stirs when the instrument is thinking. Audit trace.
	let rafId: number | null = null;
	let resizeObs: ResizeObserver | null = null;

	type Particle = { x: number; y: number; vx: number; vy: number; r: number; a: number };

	function startField() {
		const canvas = canvasEl;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Base density from the real metric. Dormant (null) → a sparse, near-still
		// field. The log map keeps a busy org from saturating into static.
		const realCount = Math.max(0, fieldSignal.thisWeek ?? 0);
		const baseDensity = Math.round(40 + Math.min(200, Math.log2(realCount + 1) * 36));

		let particles: Particle[] = [];
		let w = 0;
		let h = 0;

		function spawn(): Particle {
			return {
				x: Math.random() * w,
				y: Math.random() * h,
				// Slow continuous drift — linear motion is allowed for the field.
				vx: (Math.random() - 0.5) * 0.12,
				vy: (Math.random() - 0.5) * 0.12,
				r: Math.random() < 0.12 ? 1.6 : 0.8,
				a: 0.04 + Math.random() * 0.1
			};
		}

		function seed() {
			particles = [];
			for (let i = 0; i < baseDensity; i++) particles.push(spawn());
		}

		let lastW = -1;
		let lastH = -1;
		let t = 0;

		function frame() {
			// Read live state WITHOUT creating reactive dependencies — the RAF loop
			// must not be a reactive consumer (that would re-subscribe every frame).
			// BREADTH: the field stirs when ANY process is running (not only the
			// focused one), keyed to the focused process's stage color for hue.
			const live = untrack(() => anyRunning);
			const grainColor = untrack(() => stageColor);

			w = canvas!.width;
			h = canvas!.height;
			if (w !== lastW || h !== lastH) {
				lastW = w;
				lastH = h;
				// Seed ONCE the backing store has real dimensions. The sizing $effect
				// runs a microtask after onMount, so the first frame(s) see w/h = 0;
				// seeding then would clump every particle at (0,0). Wait for w/h > 0
				// so the field spawns across the whole viewport.
				if (particles.length === 0 && w > 0 && h > 0) seed();
			}

			ctx!.clearRect(0, 0, w, h);

			t += 1;
			// When the instrument reasons, the field blooms: slightly brighter grain,
			// keyed to the active stage's coordination color. Calm, not strobing.
			const bloom = live && !reduceMotion ? 0.5 + 0.5 * Math.sin(t * 0.03) : 0;
			const [cr, cg, cb] = hexToRgb(grainColor);

			for (const p of particles) {
				if (!reduceMotion) {
					p.x += p.vx;
					p.y += p.vy;
					if (p.x < 0) p.x += w;
					else if (p.x > w) p.x -= w;
					if (p.y < 0) p.y += h;
					else if (p.y > h) p.y -= h;
				}
				const alpha = p.a + bloom * 0.14;
				if (live) {
					ctx!.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${Math.min(0.6, alpha)})`;
				} else {
					// Dormant grain: warm audited dust, no coordination hue.
					ctx!.fillStyle = `rgba(106, 114, 113, ${Math.min(0.42, alpha * 0.62)})`;
				}
				ctx!.beginPath();
				ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
				ctx!.fill();
			}

			rafId = requestAnimationFrame(frame);
		}

		// Don't seed here — the canvas isn't sized yet. frame() seeds on the first
		// tick where w/h > 0 (see the size-change guard above).
		frame();
	}

	function hexToRgb(hex: string): [number, number, number] {
		const m = hex.replace('#', '');
		const n = parseInt(m.length === 3 ? m.replace(/(.)/g, '$1$1') : m, 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}

	// ─── Canvas backing-store sizing (devicePixelRatio-correct) ───────────────
	// Measured CSS size + DPR are reactive; we write ONLY canvas.width/height (a
	// non-reactive DOM property). Single clear trigger (size/dpr change), no loop.
	let measuredW = $state(0);
	let measuredH = $state(0);
	let dpr = $state(1);

	$effect(() => {
		const cw = measuredW;
		const ch = measuredH;
		const ratio = dpr;
		const canvas = canvasEl;
		if (!canvas || cw === 0 || ch === 0) return;
		canvas.width = Math.round(cw * ratio);
		canvas.height = Math.round(ch * ratio);
	});

	// ─── Lifecycle — client-only init + full cleanup ──────────────────────────
	onMount(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduceMotion = mq.matches;
		const onMq = (e: MediaQueryListEvent) => {
			reduceMotion = e.matches;
		};
		mq.addEventListener('change', onMq);

		dpr = window.devicePixelRatio || 1;

		// Capture phase so Find capability pre-empts the layout's Spotlight ⌘K while here.
		window.addEventListener('keydown', onFinderKey, { capture: true });

		if (rootEl) {
			rootEl.addEventListener('pointerdown', onPointerDown);
			rootEl.addEventListener('pointermove', onPointerMove);
			rootEl.addEventListener('pointerup', endPan);
			rootEl.addEventListener('pointercancel', endPan);
			rootEl.addEventListener('wheel', onWheel, { passive: false });

			resizeObs = new ResizeObserver((entries) => {
				const r = entries[0]?.contentRect;
				if (r) {
					measuredW = r.width;
					measuredH = r.height;
				}
				dpr = window.devicePixelRatio || 1;
			});
			resizeObs.observe(rootEl);
			// Prime the measured size synchronously so the first frame has a backing
			// store (ResizeObserver fires async).
			const rect = rootEl.getBoundingClientRect();
			measuredW = rect.width;
			measuredH = rect.height;

			// Land the camera FRAMED on STUDIO — the studio instrument + live processes —
			// so the operator opens looking at the focal region, not an off-screen
			// corner. Instant (no fly, no history) since this is the opening pose.
			const opening = frameBounds(
				{ width: rect.width, height: rect.height },
				regionBounds('STUDIO'),
				{ maxScale: CAMERA_MAX_SCALE }
			);
			scale = opening.scale;
			panX = opening.panX;
			panY = opening.panY;
		}

		startField();

		// Return a cleanup so onMount's disposer also handles the matchMedia listener.
		return () => {
			mq.removeEventListener('change', onMq);
		};
	});

	onDestroy(() => {
		// onDestroy ALSO runs during SSR (unlike onMount, which is client-only). On
		// the server nothing was set up and `window` does not exist, so bail before
		// touching any browser API — otherwise SSR 500s on window.removeEventListener.
		if (typeof window === 'undefined') return;
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		// Cancel any in-flight camera animation — the same teardown discipline as the
		// field rAF, guarded by the SSR bail above.
		cancelFly();
		if (resizeObs) {
			resizeObs.disconnect();
			resizeObs = null;
		}
		window.removeEventListener('keydown', onFinderKey, { capture: true });
		if (rootEl) {
			rootEl.removeEventListener('pointerdown', onPointerDown);
			rootEl.removeEventListener('pointermove', onPointerMove);
			rootEl.removeEventListener('pointerup', endPan);
			rootEl.removeEventListener('pointercancel', endPan);
			rootEl.removeEventListener('wheel', onWheel);
		}
	});
</script>

<!--
  The capability map surface. role=application + a labelled region: this is an
  inhabited map, not document flow. Keyboard pan/zoom is wired (arrows, +/-, 0 to reset).
  role=application IS the correct semantic for a directly-manipulated spatial
  canvas (it tells AT to pass keys through to our handler), and the tabindex +
  keydown ARE the keyboard navigation — so the noninteractive-element a11y
  heuristics are false positives here.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={rootEl}
	class="field"
	class:field--panning={isPanning}
	role="application"
	aria-label="Capability map for {orgName}. Press Command-K to search Studio, People, Power, and Results; press 1 to 4 to move between workspaces; press 0 or backslash for the whole map; Tab cycles focus; Left bracket moves back. Drag or scroll for fine adjustment."
	tabindex="0"
	onkeydown={onKeydown}
	style="
		--scale: {scale};
		--pan-x: {panX}px;
		--pan-y: {panY}px;
		--stage-color: {stageColor};
		--ease: {EASING};
		--t-normal: {TIMING.NORMAL}ms;
	"
>
	<!-- FIELD layer: ambient verification grain. aria-hidden — it is atmosphere,
	     the meaningful state lives in the node's aria-live region below. -->
	<canvas bind:this={canvasEl} class="field-canvas" aria-hidden="true"></canvas>

	<!-- WORLD layer: transformed by pan + zoom. EVERY object lives here, in world
	     space, laid across fixed internal regions surfaced as Studio / People / Power / Results. While
	     dragging, the transform tracks the pointer 1:1 (no easing lag); for
	     wheel-zoom + keyboard steps it eases out, so the transition is gated OFF
	     during an active pan. The constellation is the org's whole working world. -->
	<div
		class="world"
		class:world--reduced={reduceMotion}
		class:world--dragging={isPanning}
		class:world--flying={flying}
		style="transform: translate(var(--pan-x), var(--pan-y)) scale(var(--scale));"
	>
		<!-- REGION ZONES + LABELS — fixed landscape. The label + boundary fade in as
		     you zoom OUT (the whole-constellation glance); at mid/high zoom the
		     territory recedes so the objects lead. Honest empty tell per region. -->
		{#each REGION_ORDER as rid (rid)}
			{@const region = REGIONS[rid]}
			<div
				class="region"
				class:region--faint={detail !== 'glyph'}
				style="left: {region.x}px; top: {region.y}px; width: {region.width}px; height: {region.height}px;"
				aria-hidden="true"
			>
				<span class="region-label">{region.label}</span>
				{#if rid !== 'STUDIO' && population[rid] === 0}
					<!-- Honest empty state — no objects, no fabrication. -->
					<span class="region-empty">
						{#if rid === 'PEOPLE'}
							No people imported yet.
						{:else if rid === 'POWER'}
							No decision-makers tracked yet.
						{:else}
							No results yet.
						{/if}
					</span>
				{/if}
			</div>
		{/each}

		<!-- STUDIO authoring node — the singular instrument, anchored in STUDIO. Bound
		     to the focused process so Compose flies straight into its open face. -->
		{#if studioObject}
			<div
				class="object object--studio"
				class:object--running={running}
				class:object--error={!!procError}
				data-detail={detail}
				style="left: {studioObject.x}px; top: {studioObject.y}px;"
			>
				<ProcessNode
					{proc}
					{detail}
					focused={true}
					{canPublish}
					{composing}
					bind:subjectLine
					bind:coreMessage
					bind:audienceGuidance
					{intentError}
					runDisabled={!authoringRuntimeReady}
					runLabel={authoringRuntimeReady ? 'Start authoring' : 'Authoring boundary'}
					authoringReadiness={studioAuthoringReadiness}
					onCompose={openCompose}
					onRun={runLoop}
					onCancelCompose={() => (composing = false)}
					onStop={stopLoop}
					onNewIntent={openCompose}
				/>
			</div>
		{/if}

		<!-- RUNNING + FINISHED PROCESSES — concurrent agents, each its own node in
		     the STUDIO region. Click to focus + fly in. This is the multitasking tell:
		     many at once, not one. -->
		{#each processObjects as po (po.id)}
			<div
				class="object object--process"
				class:object--running={isRunning(po.proc)}
				class:object--error={!!po.proc.errorMessage}
				class:object--focused={po.proc.id === os.focusedProcessId}
				data-detail={detail}
				style="left: {po.x}px; top: {po.y}px;"
			>
				<!-- A click-to-focus shim sits BEHIND the node chrome (the node's own
				     data-no-pan regions keep their interactions). Suppressed if the
				     click was actually a drag-release (handled in focusProcessNode). -->
				{#if detail !== 'full'}
					<button
						type="button"
						class="object-focus-shim"
						onclick={() => focusProcessNode(po)}
						aria-label="Focus process {po.proc.title}"
					></button>
				{/if}
				<ProcessNode
					proc={po.proc}
					{detail}
					focused={po.proc.id === os.focusedProcessId}
					{canPublish}
					onStop={() => os.stopProcess(po.proc.id)}
					onNewIntent={openCompose}
				/>
			</div>
		{/each}

		<!-- DATA OBJECTS — campaigns, people, power, results. Capability posture
			     across the three zoom tiers; primary affordance + handoff in FULL.
		     CLICK a far/mid object → the camera flies to it (a click-to-fly shim
		     behind the node, suppressed if the click was a drag-release). In FULL
		     the node's own affordances lead, so no shim there. -->
		{#each dataObjects as obj (obj.id)}
			<div
				class="object object--data"
				data-detail={detail}
				data-type={obj.type}
				style="left: {obj.x}px; top: {obj.y}px;"
			>
				{#if detail !== 'full'}
					<button
						type="button"
						class="object-focus-shim"
						onclick={() => flyToDataObject(obj)}
						aria-label="Fly to {objectLabelOf(obj)}"
					></button>
				{/if}
				<ConstellationNode
					object={obj}
					{detail}
					detailHref={resolveDetailHref(obj.detailHref, base)}
					onOpenDetails={openDetails}
				/>
			</div>
		{/each}
	</div>

	<!-- HUD — compact field chrome: org identity, workspace posture, process status. -->
	<div class="hud hud--top" data-no-pan>
		<div class="hud-org">
			<span class="hud-org-dot" aria-hidden="true"></span>
			<span class="hud-org-title">
				<span class="hud-org-name">{orgName}</span>
				<span class="hud-org-context">Capability map</span>
			</span>
		</div>
		<div class="field-spine" aria-label="Capability operating spine">
			{#each fieldOperatingSpine as item (item.id)}
				<a
					class="field-spine-item"
					data-kind={item.id}
					data-state={item.state}
					href={item.href}
					title="{item.label}: {item.detail}. {item.cite}. {item.gate}"
					aria-label={operatingSpineAriaLabel(item)}
				>
					<span class="field-spine-top">
						<span class="field-spine-label">{item.label}</span>
						<span class="field-spine-state">{stateLabel(item.state)}</span>
					</span>
					<span class="field-spine-value">
						<Datum value={item.value} cite={item.cite} />
						<span>{item.unit}</span>
					</span>
					<span class="field-spine-detail">{item.detail}</span>
					<span class="field-spine-action">{actionLabel(item.state, item.action)}</span>
				</a>
			{/each}
		</div>
		<div class="field-operating-readout" aria-label="Capability operating readout">
			{#each fieldOperatingReadouts as item (item.id)}
				<a
					class="field-operating-item"
					data-state={item.state}
					href={item.href}
					title="{item.label}: {item.detail}. {item.cite}. {item.gate}"
					aria-label={operatingReadoutAriaLabel(item)}
				>
					<span class="field-operating-top">
						<span class="field-operating-label">{item.label}</span>
						<span class="field-operating-state">{stateLabel(item.state)}</span>
					</span>
					<span class="field-operating-signal">
						<Datum value={item.value} cite={item.cite} />
						<span>{item.unit}</span>
					</span>
					<span class="field-operating-action">{actionLabel(item.state, item.action)}</span>
				</a>
			{/each}
		</div>
		<div class="field-loop-strip" aria-label="Verified action loop phases">
			{#each fieldLoopPhases as phase (phase.id)}
				<a
					class="field-loop-phase"
					data-state={phase.state}
					href={phase.href}
					title="{phase.id}: {phase.label}. {phase.workspace}. {phase.cite}. {phase.unlock}"
					aria-label={loopPhaseAriaLabel(phase)}
				>
					<span class="field-loop-top">
						<span class="field-loop-id">{phase.id}</span>
						<span class="field-loop-state">{stateLabel(phase.state)}</span>
					</span>
					<span class="field-loop-label">{phase.label}</span>
					<span class="field-loop-meta">
						<span>{phase.workspace}</span>
						<span>{formatCapabilityClusters(phase.clusters)}</span>
					</span>
					<span class="field-loop-signal">
						<Datum value={phase.value} cite={phase.cite} />
						<span>{phase.unit}</span>
					</span>
					<span class="field-loop-action">{actionLabel(phase.state, phase.action)}</span>
				</a>
			{/each}
		</div>
		<div class="field-rail" aria-label="Workspace capability posture">
			{#each fieldWorkspaceReadouts as item (item.id)}
				<button
					type="button"
					class="field-rail-item"
					data-workspace={item.id}
					data-state={item.state}
					onclick={() => flyToRegion(item.id)}
					title="{item.label}: {item.detail}. Action: {actionLabel(
						item.state,
						item.action
					)}. {item.cite}. {item.gateSummary}"
					aria-label={workspaceReadoutAriaLabel(item)}
				>
					<span class="field-rail-name">{item.label}</span>
					<span class="field-rail-signal">
						<Datum value={item.value} cite={item.cite} />
						<span>{item.unit}</span>
					</span>
					<span class="field-rail-action">{actionLabel(item.state, item.action)}</span>
					<span class="field-rail-unlock">
						<span>{item.unlock}</span>
						<span class="field-rail-tasks">{item.gateTasks}</span>
					</span>
				</button>
			{/each}
		</div>
		<div class="field-contract" aria-label="Capability state ledger and coverage">
			<a
				class="field-contract-summary"
				href={`${base}/studio#capability-state-ledger`}
				title="Capability state ledger. Counts visible full-map contracts, object contracts, first-viewport readouts, next moves, and claim boundary rows."
			>
				<span class="field-contract-label">State ledger</span>
				<span class="field-contract-count">
					<Datum value={fieldVisibleContractCount} cite="full-map visible capability contracts" />
					<span>contracts</span>
				</span>
				<Ratio height={5} segments={fieldStateRatioSegments} />
			</a>
			<div class="field-state-grid" aria-label="Capability contracts by state">
				{#each fieldStateLedgerRows as row (row.state)}
					<a
						class="field-state-item"
						data-state={row.state}
						href={row.href}
						title="{row.label}: {row.sample}. {row.source}. {row.gate}"
						aria-label={stateLedgerAriaLabel(row)}
					>
						<span class="field-state-label">{row.label}</span>
						<span class="field-state-count">
							<Datum value={row.value} cite={row.source} />
						</span>
						<span class="field-state-sample">{row.sample}</span>
					</a>
				{/each}
			</div>
			<a
				class="field-coverage-summary"
				href={`${base}/studio#capability-cluster-coverage`}
				title="Capability coverage. Counts which canonical clusters have visible field contracts in this scan."
			>
				<span class="field-contract-label">Coverage</span>
				<span class="field-contract-count">
					<Datum
						value={fieldCoveredClusterCount}
						cite="CAPABILITY_CLUSTER_IDS + visible field contracts"
					/>
					<span>of {CAPABILITY_CLUSTER_IDS.length}</span>
				</span>
				<span
					class="field-coverage-split"
					aria-label={`Canvas coverage state mix: ${fieldCoverageStateCounts.live} armed clusters; ${fieldCoverageStateCounts.partial} bounded clusters; ${fieldHeldClusterCount} held clusters`}
				>
					<Datum
						value={fieldCoverageStateCounts.live}
						cite="Canvas capability coverage state mix"
					/>
					<span>armed</span>
					<span>/</span>
					<Datum
						value={fieldCoverageStateCounts.partial}
						cite="Canvas capability coverage state mix"
					/>
					<span>bounded</span>
					<span>/</span>
					<Datum value={fieldHeldClusterCount} cite="Canvas capability coverage state mix" />
					<span>held</span>
				</span>
			</a>
			<div class="field-coverage-grid" aria-label="Capability coverage by cluster">
				{#each fieldCoverageRows as row (row.id)}
					<a
						class="field-coverage-item"
						data-state={row.state}
						data-empty={row.value === 0}
						href={row.href}
						title="{row.label}: lead {row.lead} ({row.source}). next lift {row.boundary} ({row.boundarySource}). {row.boundaryGate}"
						aria-label={coverageAriaLabel(row)}
					>
						<span class="field-coverage-label">{row.label}</span>
						<span class="field-coverage-count">
							<Datum value={row.value} cite={row.source} />
						</span>
						<span class="field-coverage-lead">
							<span class="field-coverage-meta-label">Lead</span>
							<span>{row.lead}</span>
						</span>
						<span class="field-coverage-boundary">
							<span class="field-coverage-meta-label">Next</span>
							<span>{row.boundary}</span>
						</span>
					</a>
				{/each}
			</div>
		</div>
		<div class="field-action-strip" aria-label="Claim boundary, next moves, and launch pressure">
			<div class="field-claim-boundary" aria-label="Capability claim boundary">
				<span class="field-claim-title">Claim boundary</span>
				<div class="field-claim-grid">
					{#each fieldClaimBoundaries as boundary (boundary.id)}
						<a
							class="field-claim-item"
							data-state={boundary.state}
							href={boundary.href}
							title="{boundary.label}: {boundary.ground}. {boundary.boundary}. {boundary.cite}"
							aria-label={claimBoundaryAriaLabel(boundary)}
						>
							<span class="field-claim-main">
								<span class="field-claim-label">{boundary.label}</span>
								<span class="field-claim-ground">{boundary.ground}</span>
								<span class="field-claim-boundary-copy">{boundary.boundary}</span>
							</span>
							<span class="field-claim-side">
								<span class="field-claim-action">
									{actionLabel(boundary.state, boundary.action)}
								</span>
								<span class="field-claim-metric">
									<Datum value={boundary.value} cite={boundary.cite} />
									<span>{boundary.unit}</span>
								</span>
							</span>
						</a>
					{/each}
				</div>
			</div>
			<div class="field-next" aria-label="Next capability moves">
				<span class="field-next-title">Next moves</span>
				<div class="field-next-grid">
					{#each fieldNextMoves as move (move.id)}
						<a
							class="field-next-item"
							data-state={move.state}
							href={move.href}
							title="{move.label}: {move.effect}. {move.gate}"
							aria-label={nextMoveAriaLabel(move)}
						>
							<span class="field-next-kicker">{move.kicker}</span>
							<span class="field-next-main">
								<span class="field-next-name">{move.label}</span>
								<span class="field-next-effect">{move.effect}</span>
								<span class="field-next-gate">{move.gate}</span>
							</span>
							<span class="field-next-side">
								<span class="field-next-action">{actionLabel(move.state, move.action)}</span>
								<span class="field-next-metric">
									<Datum value={move.value} cite={move.cite} />
									<span>{move.unit}</span>
								</span>
								<span class="field-next-handoff">{move.handoff}</span>
							</span>
						</a>
					{/each}
				</div>
			</div>
			<div class="field-pressure" aria-label="First-org launch pressure">
				<span class="field-pressure-title">Launch pressure</span>
				{#if fieldLaunchPressureRows.length === 0}
					<a
						class="field-pressure-clear"
						href={`${base}/studio#launch-pressure`}
						title="First-org launch pressure is clear. The full Studio map keeps closed work in the claim basis."
					>
						<span class="field-pressure-name">First-org blockers clear</span>
						<span class="field-pressure-copy">No unresolved launch-grade pressure rows.</span>
					</a>
				{:else}
					<div class="field-pressure-grid">
						{#each fieldLaunchPressureRows as row (row.id)}
							<a
								class="field-pressure-item"
								data-state={row.state}
								href={row.href}
								title="{row.name}: {row.currentGround} {row.blocked} {readoutGateSummary(
									row.gate,
									row.futureLift
								)}"
								aria-label={launchPressureAriaLabel(row)}
							>
								<span class="field-pressure-main">
									<span class="field-pressure-kicker">order {row.order}</span>
									<span class="field-pressure-name">{row.name}</span>
									<span class="field-pressure-ground">{row.handoff} / {row.ground}</span>
									<span class="field-pressure-blocked">{row.effect}</span>
									<span class="field-pressure-next">{row.nextLift}</span>
								</span>
								<span class="field-pressure-side">
									<span class="field-pressure-action">{actionLabel(row.state, row.action)}</span>
									<span class="field-pressure-count">
										<Datum value={row.gate.downstream} cite={row.gate.source} />
										<span>downstream</span>
									</span>
									<span class="field-pressure-tasks">{row.gate.tasks}</span>
								</span>
							</a>
						{/each}
					</div>
				{/if}
			</div>
		</div>
		{#if proc}
			<button
				type="button"
				class="proc-pill"
				class:proc-pill--running={running}
				class:proc-pill--error={!!procError}
				onclick={centerLiveProcess}
				title="Center the focused process"
			>
				<span class="proc-pill-dot" aria-hidden="true"></span>
				<span class="proc-pill-label">{proc.title}</span>
				<span class="proc-pill-stage">{running ? stageLabel || '…' : proc.status}</span>
				{#if os.runningProcesses.length > 1}
					<span class="proc-pill-count" title="{os.runningProcesses.length} processes running"
						>+{os.runningProcesses.length - 1}</span
					>
				{/if}
			</button>
		{/if}
	</div>

	<!-- DOCK — the operating command rail. Start Authoring, Find Capability,
	     workspace movement, scale, and running-process focus live in one stable
	     instrument rail. Workspace controls show state, signal, route effect,
	     action grammar, and next unlock in the rail itself. -->
	<nav
		class="dock"
		data-no-pan
		aria-label="Workspace capability dock: command rail for Studio, People, Power, Results, and running processes"
	>
		<div class="dock-panel">
			<div class="dock-command-group" role="group" aria-label="Primary capability commands">
				<button
					type="button"
					class="dock-command dock-command--author"
					data-state={studioAuthoringReadiness.state}
					onclick={openCompose}
					title="{studioAuthoringReadiness.effect} {studioAuthoringReadiness.detail}"
					aria-label="{authoringRuntimeReady
						? 'Start authoring'
						: 'Read authoring boundary'}: {studioAuthoringReadiness.signal}. {actionLabel(
						studioAuthoringReadiness.state,
						authoringRuntimeReady ? 'open Studio intent' : 'read authoring boundary'
					)}. {studioAuthoringReadiness.gate}"
				>
					<span class="dock-key" aria-hidden="true">+</span>
					<span class="dock-main">
						<span class="dock-label"
							>{authoringRuntimeReady ? 'Start authoring' : 'Authoring boundary'}</span
						>
						<span class="dock-signal">{studioAuthoringReadiness.signal}</span>
						<span class="dock-action"
							>{actionLabel(
								studioAuthoringReadiness.state,
								authoringRuntimeReady ? 'open Studio intent' : 'read authoring boundary'
							)}</span
						>
						<span class="dock-unlock">
							<Datum
								value={studioAuthoringReadiness.boundaryCount}
								cite="buildStudioAuthoringReadiness boundaryCount"
							/>
							<span>authoring boundaries</span>
						</span>
					</span>
				</button>

				<button
					type="button"
					class="dock-command dock-command--finder"
					onclick={openFinder}
					title="Find capability (⌘K)"
					aria-label="Find capability across Studio, People, Power, Results, gates, proof, and running processes"
				>
					<span class="dock-key" aria-hidden="true">⌘K</span>
					<span class="dock-main">
						<span class="dock-label">Find capability</span>
						<span class="dock-signal">Handoffs, gates, proof</span>
					</span>
				</button>

				<a
					class="dock-posture"
					href={`${base}/studio#capability-state-ledger`}
					aria-label="Capability posture. {fieldVisibleContractCount} visible contracts. {fieldCoveredClusterCount} of {CAPABILITY_CLUSTER_IDS.length} capability clusters have field evidence."
					title="State mix across visible map contracts. Open the Studio capability state ledger."
				>
					<span class="dock-posture-head">
						<span class="dock-posture-title">Capability posture</span>
						<span class="dock-posture-metric">
							<Datum
								value={fieldVisibleContractCount}
								cite="full-map visible capability contracts"
							/>
							<span>contracts</span>
						</span>
					</span>
					<span class="dock-posture-ratio">
						<Ratio height={6} segments={fieldStateRatioSegments} />
					</span>
					<span class="dock-posture-counts">
						<span>
							<Datum value={fieldStateCounts.live} cite="visible armed capability contracts" />
							<span>armed</span>
						</span>
						<span>
							<Datum value={fieldStateCounts.partial} cite="visible bounded capability contracts" />
							<span>bounded</span>
						</span>
						<span>
							<Datum
								value={fieldStateCounts['draft-only']}
								cite="visible draft-only capability contracts"
							/>
							<span>draft</span>
						</span>
						<span>
							<Datum value={fieldStateCounts.gated} cite="visible not-armed capability contracts" />
							<span>held</span>
						</span>
						<span>
							<Datum
								value={fieldCoveredClusterCount}
								cite="CAPABILITY_CLUSTER_IDS + visible field contracts"
							/>
							<span>clusters</span>
						</span>
					</span>
				</a>
			</div>
			<span class="dock-sep" aria-hidden="true"></span>

			<div
				class="dock-group dock-group--workspaces"
				role="group"
				aria-label="Workspace capability rail"
			>
				{#each REGION_ORDER as rid, i (rid)}
					{@const readout = fieldWorkspaceReadoutByRegion[rid]}
					<button
						type="button"
						class="dock-control dock-control--workspace"
						data-workspace={rid}
						data-state={readout.state}
						onclick={() => flyToRegion(rid)}
						title="{readout.label}: {readout.detail}. Action: {actionLabel(
							readout.state,
							readout.action
						)}. {readout.cite}. {readout.gateSummary}"
						aria-label={dockAriaLabel(readout, i + 1)}
					>
						<span class="dock-key" aria-hidden="true">{i + 1}</span>
						<span class="dock-main">
							<span class="dock-row">
								<span class="dock-label">{readout.label}</span>
								<span class="dock-state">{stateLabel(readout.state)}</span>
							</span>
							<span class="dock-signal">
								<Datum value={readout.value} cite={readout.cite} />
								<span>{readout.unit}</span>
							</span>
							<span class="dock-action">{actionLabel(readout.state, readout.action)}</span>
							<span class="dock-effect">{readout.detail}</span>
							<span class="dock-unlock">{readout.unlock} · {readout.gateTasks}</span>
						</span>
						{#if population[rid] > 0}
							<span class="dock-count" aria-label="{population[rid]} objects in {readout.label}">
								<Datum value={population[rid]} />
							</span>
						{/if}
					</button>
				{/each}
			</div>
			<span class="dock-sep" aria-hidden="true"></span>

			<div class="dock-map-state" aria-label="Capability map scale">
				<span class="dock-mode">{viewModeLabel}</span>
				<span class="dock-zoom">{Math.round(scale * 100)}%</span>
				<a
					class="dock-back"
					href={`${base}/studio`}
					onclick={(e) => {
						e.preventDefault();
						exitToWorkspace();
					}}
				>
					Back to Studio →
				</a>
			</div>

			{#if os.runningProcesses.length > 0}
				<span class="dock-sep" aria-hidden="true"></span>
				<div class="dock-group dock-group--processes" role="group" aria-label="Running processes">
					{#each os.runningProcesses as rp (rp.id)}
						<button
							type="button"
							class="dock-control dock-control--proc"
							class:dock-control--focused={rp.id === os.focusedProcessId}
							onclick={() => flyToRunningProcess(rp.id)}
							title="Fly to process {rp.title}"
						>
							<span class="dock-proc-dot" aria-hidden="true"></span>
							<span class="dock-proc-label">{rp.title}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</nav>
</div>

<!-- Capability finder — the primary navigation. Rendered OUTSIDE the field so its
     fixed overlay isn't transformed by the world layer. The parent owns the camera
     (onSelect flies); the finder owns only its own filter/selection state. -->
<CanvasCapabilityFinder open={finderOpen} {targets} onSelect={flyToTarget} onClose={closeFinder} />

<style>
	.field {
		position: fixed;
		inset: 0;
		z-index: 60;
		overflow: hidden;
		--canvas-text: oklch(0.22 0.016 250);
		--canvas-muted: oklch(0.42 0.016 245);
		--canvas-dim: oklch(0.52 0.014 235);
		--canvas-panel: oklch(0.982 0.004 58);
		--canvas-panel-strong: oklch(0.995 0.002 60);
		--canvas-panel-border: oklch(0.68 0.022 78);
		--canvas-panel-border-soft: oklch(0.82 0.014 78);
		--org-sidebar-text: var(--canvas-text);
		--org-sidebar-text-muted: var(--canvas-muted);
		--org-sidebar-text-dim: var(--canvas-dim);
		background: var(--surface-base, oklch(0.993 0.003 60));
		cursor: grab;
		touch-action: none;
		user-select: none;
		outline: none;
	}
	.field:focus-visible {
		box-shadow: inset 0 0 0 2px var(--coord-route-solid, #3bc4b8);
	}
	.field--panning {
		cursor: grabbing;
	}

	.field-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		pointer-events: none;
	}

	/* ─── World ─── */
	.world {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		transform-origin: 0 0;
		will-change: transform;
		/* ease-out settle for wheel-zoom + keyboard steps; linear is NOT used. */
		transition: transform var(--t-normal) var(--ease);
	}
	/* During an active drag the pan tracks the pointer 1:1 — no easing lag. The
	   transition resumes the instant the drag ends, so a fling-and-release still
	   settles smoothly. Reduced motion drops the transition entirely. */
	/* The rAF camera lerp drives the transform directly while flying; a CSS
	   transition would re-ease each frame's write and fight the lerp, so it's gated
	   OFF during a fly (and during a manual drag, and under reduced motion). */
	.world--dragging,
	.world--reduced,
	.world--flying {
		transition: none;
	}

	/* ─── Regions (fixed landscape) ─── */
	.region {
		position: absolute;
		border: 1px solid oklch(0.74 0.018 78 / 0.46);
		border-radius: 8px;
		pointer-events: none;
		transition:
			opacity var(--t-normal) var(--ease),
			border-color var(--t-normal) var(--ease);
	}
	/* As you zoom IN past the glyph tier, the territory recedes so objects lead. */
	.region--faint {
		border-color: oklch(0.78 0.014 78 / 0.28);
	}
	.region-label {
		position: absolute;
		top: 0.75rem;
		left: 1rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.8125rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--canvas-dim);
		transition: opacity var(--t-normal) var(--ease);
	}
	.region--faint .region-label {
		opacity: 0.55;
	}
	.region-empty {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-style: italic;
		text-align: center;
		max-width: 80%;
		color: var(--canvas-muted);
	}

	/* ─── Objects (positioned nodes) ─── */
	.object {
		position: absolute;
		transform: translate(-50%, -50%);
		border-radius: 8px;
		background: var(--canvas-panel);
		border: 1px solid var(--canvas-panel-border);
		box-shadow:
			0 24px 70px -34px oklch(0.2 0.02 250 / 0.34),
			0 0 0 1px var(--canvas-panel-border-soft);
		color: var(--canvas-text);
		transition:
			width var(--t-normal) var(--ease),
			padding var(--t-normal) var(--ease);
	}

	/* The STUDIO authoring instrument — widest, the focal node. */
	.object--studio {
		width: min(34rem, 80vw);
		padding: 1.5rem;
		z-index: 3;
	}
	.object--studio[data-detail='glyph'] {
		width: min(20rem, 70vw);
		padding: 0.875rem 1rem;
	}

	/* Concurrent process nodes — narrower, grid-laid in STUDIO. */
	.object--process {
		width: min(20rem, 70vw);
		padding: 1rem 1.125rem;
		z-index: 2;
	}
	.object--process[data-detail='glyph'] {
		width: min(15rem, 60vw);
		padding: 0.75rem 0.875rem;
	}
	.object--process[data-detail='full'] {
		width: min(28rem, 76vw);
		padding: 1.25rem;
		z-index: 4;
	}
	.object--process.object--focused {
		border-color: oklch(0.54 0.05 195 / 0.86);
	}

	/* Data objects — capability posture cards. */
	.object--data {
		width: min(17rem, 64vw);
		padding: 0.9rem 1rem;
		z-index: 1;
	}
	.object--data[data-detail='glyph'] {
		width: min(14rem, 56vw);
		padding: 0.7rem 0.85rem;
	}
	.object--data[data-detail='full'] {
		width: min(22rem, 72vw);
		padding: 1.125rem 1.25rem;
		z-index: 4;
	}
	.object--data[data-type='scorecard'][data-detail='full'],
	.object--data[data-type='packet'][data-detail='full'] {
		width: min(24rem, 74vw);
	}

	.object--error {
		border-color: oklch(0.58 0.15 30 / 0.82);
	}

	/* Click-to-focus shim: a transparent layer BEHIND a process node's chrome so a
	   click anywhere on the (non-full) glyph/summary focuses + flies to it. The
	   node's own data-no-pan interactive regions sit above it. */
	.object-focus-shim {
		position: absolute;
		inset: 0;
		z-index: 0;
		border: none;
		background: transparent;
		border-radius: 8px;
		cursor: pointer;
		padding: 0;
	}
	.object-focus-shim:focus-visible {
		outline: 2px solid var(--coord-route-solid, #3bc4b8);
		outline-offset: 2px;
	}

	/* ─── HUD ─── */
	.hud {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.125rem 1.5rem;
		pointer-events: none;
		z-index: 2;
	}
	.hud--top {
		top: 0;
		display: grid;
		grid-template-columns: minmax(12rem, 0.68fr) minmax(34rem, 2.3fr) minmax(10rem, 0.72fr);
		grid-template-areas:
			'org spine process'
			'operating operating operating'
			'loop loop loop'
			'rail rail rail'
			'contract contract contract'
			'action action action';
		align-items: start;
		justify-content: stretch;
		gap: 0.75rem;
		padding-top: 0.875rem;
	}
	.hud > * {
		pointer-events: auto;
	}

	.hud-org {
		grid-area: org;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		flex: 0 1 18rem;
	}
	.hud-org-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--coord-route-solid, #3bc4b8);
		box-shadow: 0 0 10px -1px var(--coord-route-solid, #3bc4b8);
	}
	.hud-org-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		color: var(--canvas-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hud-org-title {
		display: grid;
		gap: 0.05rem;
		min-width: 0;
	}
	.hud-org-context {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--canvas-dim);
		white-space: nowrap;
	}
	.field-spine {
		grid-area: spine;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.5rem;
		min-width: 0;
		pointer-events: auto;
	}
	.field-spine-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: space-between;
		gap: 0.16rem;
		min-height: 4.1rem;
		padding: 0.66rem 0.76rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		border-left: 2px solid transparent;
		background: var(--canvas-panel);
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
		color: var(--canvas-text);
		text-decoration: none;
		transition:
			border-color var(--t-normal) var(--ease),
			background-color var(--t-normal) var(--ease);
	}
	.field-spine-item:hover,
	.field-spine-item:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: var(--canvas-panel-strong);
		outline: none;
	}
	.field-spine-item[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 26%);
	}
	.field-spine-item[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 28%);
	}
	.field-spine-item[data-state='draft-only'] {
		border-left-color: oklch(0.64 0.11 72 / 0.92);
		background: oklch(0.968 0.006 58);
	}
	.field-spine-item[data-state='gated'] {
		border-left-color: oklch(0.54 0.075 45 / 0.9);
		background: oklch(0.962 0.006 58);
	}
	.field-spine-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}
	.field-spine-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.84rem;
		font-weight: 850;
		color: var(--canvas-text);
	}
	.field-spine-state {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.56rem;
		font-weight: 850;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.field-spine-value {
		display: inline-flex;
		align-items: baseline;
		gap: 0.24rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.74rem;
		font-weight: 850;
		color: var(--canvas-text);
		white-space: nowrap;
	}
	.field-spine-detail,
	.field-spine-action {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.56rem;
		font-weight: 740;
		letter-spacing: 0.025em;
		color: var(--canvas-muted);
	}
	.field-spine-action {
		font-weight: 850;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--canvas-dim);
	}
	.field-operating-readout {
		grid-area: operating;
		display: grid;
		grid-template-columns: repeat(4, minmax(10rem, 1fr));
		gap: 0.5rem;
		min-width: 0;
		pointer-events: auto;
	}
	.field-operating-item {
		display: grid;
		gap: 0.28rem;
		min-height: 5rem;
		padding: 0.78rem 0.84rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		border-left: 2px solid transparent;
		background: var(--canvas-panel);
		color: var(--canvas-text);
		text-decoration: none;
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
		transition:
			border-color var(--t-normal) var(--ease),
			background-color var(--t-normal) var(--ease),
			color var(--t-normal) var(--ease);
	}
	.field-operating-item:hover,
	.field-operating-item:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: var(--canvas-panel-strong);
		outline: none;
	}
	.field-operating-item[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 22%);
	}
	.field-operating-item[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 26%);
	}
	.field-operating-item[data-state='draft-only'] {
		border-left-color: oklch(0.64 0.11 72 / 0.92);
	}
	.field-operating-item[data-state='gated'] {
		border-left-color: oklch(0.54 0.075 45 / 0.9);
		background: oklch(0.962 0.006 58);
	}
	.field-operating-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}
	.field-operating-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.88rem;
		font-weight: 850;
		color: var(--canvas-text);
	}
	.field-operating-state {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.62rem;
		font-weight: 850;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.field-operating-signal {
		display: inline-flex;
		align-items: baseline;
		gap: 0.28rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.8rem;
		font-weight: 800;
		color: var(--canvas-text);
		white-space: nowrap;
	}
	.field-operating-action {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.field-loop-strip {
		grid-area: loop;
		justify-self: center;
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.42rem;
		width: min(74rem, 100%);
		min-width: 0;
		pointer-events: auto;
	}
	.field-loop-phase {
		display: grid;
		gap: 0.18rem;
		min-height: 3.8rem;
		padding: 0.56rem 0.62rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		border-top: 2px solid transparent;
		background: var(--canvas-panel);
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
		color: var(--canvas-text);
		text-decoration: none;
		transition:
			border-color var(--t-normal) var(--ease),
			background-color var(--t-normal) var(--ease);
	}
	.field-loop-phase:hover,
	.field-loop-phase:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: var(--canvas-panel-strong);
		outline: none;
	}
	.field-loop-phase[data-state='live'] {
		border-top-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 20%);
	}
	.field-loop-phase[data-state='partial'] {
		border-top-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 26%);
	}
	.field-loop-phase[data-state='draft-only'] {
		border-top-color: oklch(0.64 0.11 72 / 0.92);
		background: oklch(0.968 0.006 58);
	}
	.field-loop-phase[data-state='gated'] {
		border-top-color: oklch(0.54 0.075 45 / 0.9);
		background: oklch(0.962 0.006 58);
	}
	.field-loop-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.36rem;
		min-width: 0;
	}
	.field-loop-id,
	.field-loop-state,
	.field-loop-meta,
	.field-loop-signal,
	.field-loop-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
	}
	.field-loop-id {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 0.07em;
		color: var(--canvas-text);
	}
	.field-loop-state {
		flex-shrink: 0;
		font-size: 0.56rem;
		font-weight: 850;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.field-loop-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.74rem;
		font-weight: 850;
		color: var(--canvas-text);
	}
	.field-loop-meta,
	.field-loop-signal,
	.field-loop-action {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.55rem;
		font-weight: 760;
		letter-spacing: 0.025em;
		color: var(--canvas-muted);
	}
	.field-loop-meta {
		display: inline-flex;
		gap: 0.28rem;
	}
	.field-loop-meta span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.field-loop-signal {
		display: inline-flex;
		align-items: baseline;
		gap: 0.22rem;
		color: var(--canvas-text);
	}
	.field-loop-action {
		text-transform: uppercase;
		color: var(--canvas-dim);
	}
	.field-rail {
		grid-area: rail;
		justify-self: center;
		display: grid;
		grid-template-columns: repeat(4, minmax(12rem, 1fr));
		gap: 0.5rem;
		width: min(74rem, 100%);
		pointer-events: auto;
	}
	.field-rail-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'name signal'
			'action action'
			'unlock unlock';
		align-items: baseline;
		gap: 0.34rem 0.5rem;
		min-height: 4.85rem;
		padding: 0.72rem 0.82rem 0.66rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		border-left: 2px solid transparent;
		background: var(--canvas-panel);
		color: var(--canvas-text);
		cursor: pointer;
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
		transition:
			border-color var(--t-normal) var(--ease),
			background-color var(--t-normal) var(--ease);
	}
	.field-rail-item:hover,
	.field-rail-item:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: var(--canvas-panel-strong);
		outline: none;
	}
	.field-rail-item[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 30%);
	}
	.field-rail-item[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 34%);
	}
	.field-rail-item[data-state='gated'] {
		border-left-color: oklch(0.54 0.075 45 / 0.9);
		background: oklch(0.962 0.006 58);
	}
	.field-rail-item[data-state='draft-only'] {
		border-left-color: oklch(0.64 0.11 72 / 0.92);
		background: oklch(0.968 0.006 58);
	}
	.field-rail-item[data-state='live'] .field-rail-action {
		color: color-mix(in oklch, var(--coord-verified, #10b981), var(--canvas-text) 18%);
	}
	.field-rail-item[data-state='partial'] .field-rail-action {
		color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), var(--canvas-text) 18%);
	}
	.field-rail-item[data-state='draft-only'] .field-rail-action {
		color: oklch(0.55 0.1 72);
	}
	.field-rail-item[data-state='gated'] .field-rail-action {
		color: oklch(0.46 0.035 55);
	}
	.field-rail-name {
		grid-area: name;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.88rem;
		font-weight: 800;
		color: var(--canvas-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.field-rail-signal {
		grid-area: signal;
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: var(--canvas-muted);
		white-space: nowrap;
	}
	.field-rail-action {
		grid-area: action;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.62rem;
		font-weight: 850;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.field-rail-unlock {
		grid-area: unlock;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.64rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--canvas-dim);
	}
	.field-rail-unlock > span:first-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.field-rail-tasks {
		flex-shrink: 0;
		max-width: 8.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--canvas-muted);
	}
	.field-contract {
		grid-area: contract;
		justify-self: center;
		display: grid;
		grid-template-columns:
			minmax(10rem, 0.62fr) minmax(18rem, 1.16fr)
			minmax(9.6rem, 0.5fr) minmax(23rem, 1.72fr);
		gap: 0.5rem;
		width: min(74rem, 100%);
		pointer-events: auto;
	}
	.field-contract-summary,
	.field-coverage-summary,
	.field-state-item,
	.field-coverage-item {
		min-width: 0;
		min-height: 3.15rem;
		padding: 0.55rem 0.66rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		border-left: 2px solid transparent;
		background: var(--canvas-panel);
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
		color: var(--canvas-text);
		text-decoration: none;
		transition:
			border-color var(--t-normal) var(--ease),
			background-color var(--t-normal) var(--ease);
	}
	.field-contract-summary:hover,
	.field-contract-summary:focus-visible,
	.field-coverage-summary:hover,
	.field-coverage-summary:focus-visible,
	.field-state-item:hover,
	.field-state-item:focus-visible,
	.field-coverage-item:hover,
	.field-coverage-item:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: var(--canvas-panel-strong);
		outline: none;
	}
	.field-contract-summary,
	.field-coverage-summary {
		display: grid;
		align-content: space-between;
		gap: 0.25rem;
	}
	.field-contract-summary {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 32%);
	}
	.field-coverage-summary {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 32%);
	}
	.field-contract-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.63rem;
		font-weight: 850;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.field-contract-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.24rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.68rem;
		font-weight: 800;
		color: var(--canvas-text);
		white-space: nowrap;
	}
	.field-coverage-split {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: inline-flex;
		align-items: baseline;
		gap: 0.22rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.58rem;
		font-weight: 750;
		letter-spacing: 0.035em;
		color: var(--canvas-dim);
	}
	.field-state-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.5rem;
		min-width: 0;
	}
	.field-state-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'label count'
			'sample sample';
		gap: 0.18rem 0.4rem;
	}
	.field-state-item[data-state='live'],
	.field-coverage-item[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 28%);
	}
	.field-state-item[data-state='partial'],
	.field-coverage-item[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 30%);
	}
	.field-state-item[data-state='draft-only'],
	.field-coverage-item[data-state='draft-only'] {
		border-left-color: oklch(0.64 0.11 72 / 0.92);
		background: oklch(0.968 0.006 58);
	}
	.field-state-item[data-state='gated'],
	.field-coverage-item[data-state='gated'] {
		border-left-color: oklch(0.54 0.075 45 / 0.9);
		background: oklch(0.962 0.006 58);
	}
	.field-coverage-item[data-empty='true'] {
		opacity: 0.68;
	}
	.field-state-label,
	.field-coverage-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.73rem;
		font-weight: 850;
		color: var(--canvas-text);
	}
	.field-state-label {
		grid-area: label;
	}
	.field-state-count,
	.field-coverage-count {
		display: inline-flex;
		align-items: baseline;
		justify-content: flex-end;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.68rem;
		font-weight: 850;
		color: var(--canvas-text);
		white-space: nowrap;
	}
	.field-state-count {
		grid-area: count;
	}
	.field-state-sample {
		grid-area: sample;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.57rem;
		font-weight: 700;
		letter-spacing: 0.025em;
		color: var(--canvas-muted);
	}
	.field-coverage-grid {
		display: grid;
		grid-template-columns: repeat(9, minmax(0, 1fr));
		gap: 0.35rem;
		min-width: 0;
	}
	.field-coverage-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'label count'
			'lead lead'
			'boundary boundary';
		align-items: start;
		gap: 0.18rem 0.32rem;
		min-height: 4.25rem;
		padding: 0.52rem 0.56rem;
	}
	.field-coverage-label {
		grid-area: label;
		font-size: 0.66rem;
	}
	.field-coverage-count {
		grid-area: count;
	}
	.field-coverage-lead,
	.field-coverage-boundary {
		min-width: 0;
		display: inline-flex;
		align-items: baseline;
		gap: 0.26rem;
		overflow: hidden;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.54rem;
		font-weight: 720;
		letter-spacing: 0.02em;
		color: var(--canvas-muted);
	}
	.field-coverage-lead {
		grid-area: lead;
	}
	.field-coverage-boundary {
		grid-area: boundary;
		color: var(--canvas-dim);
	}
	.field-coverage-lead > span:last-child,
	.field-coverage-boundary > span:last-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.field-coverage-meta-label {
		flex: 0 0 auto;
		font-size: 0.48rem;
		font-weight: 860;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--canvas-dim);
	}
	.field-action-strip {
		grid-area: action;
		justify-self: center;
		display: grid;
		grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.12fr) minmax(0, 1.18fr);
		align-items: start;
		gap: 0.5rem;
		width: min(74rem, 100%);
		pointer-events: auto;
	}
	.field-claim-boundary,
	.field-next,
	.field-pressure {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: 0.5rem;
		min-width: 0;
	}
	.field-claim-title {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 7.4rem;
		min-height: 3.95rem;
		padding: 0.65rem 0.82rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		background: var(--canvas-panel);
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.66rem;
		font-weight: 850;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--canvas-muted);
		text-align: center;
	}
	.field-claim-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		min-width: 0;
	}
	.field-claim-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.4rem 0.6rem;
		min-height: 3.95rem;
		padding: 0.66rem 0.78rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		border-left: 2px solid transparent;
		background: var(--canvas-panel);
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
		color: var(--canvas-text);
		text-decoration: none;
		transition:
			border-color var(--t-normal) var(--ease),
			background-color var(--t-normal) var(--ease);
	}
	.field-claim-item:hover,
	.field-claim-item:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: var(--canvas-panel-strong);
		outline: none;
	}
	.field-claim-item[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 26%);
	}
	.field-claim-item[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 28%);
	}
	.field-claim-item[data-state='draft-only'] {
		border-left-color: oklch(0.64 0.11 72 / 0.92);
		background: oklch(0.968 0.006 58);
	}
	.field-claim-item[data-state='gated'] {
		border-left-color: oklch(0.54 0.075 45 / 0.9);
		background: oklch(0.962 0.006 58);
	}
	.field-claim-main {
		display: grid;
		gap: 0.12rem;
		min-width: 0;
	}
	.field-claim-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.84rem;
		font-weight: 850;
		color: var(--canvas-text);
	}
	.field-claim-ground,
	.field-claim-boundary-copy {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: var(--canvas-muted);
	}
	.field-claim-boundary-copy {
		color: var(--canvas-dim);
	}
	.field-claim-side {
		display: grid;
		align-content: space-between;
		justify-items: end;
		gap: 0.15rem;
		min-width: 5.9rem;
	}
	.field-claim-action {
		max-width: 7.8rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 850;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.field-claim-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.22rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.64rem;
		font-weight: 800;
		color: var(--canvas-text);
		white-space: nowrap;
	}
	.field-next-title {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 5.7rem;
		min-height: 3.75rem;
		padding: 0.65rem 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		background: var(--canvas-panel);
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.66rem;
		font-weight: 850;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.field-next-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		min-width: 0;
		max-height: 10.8rem;
		overflow: auto;
		scrollbar-width: none;
	}
	.field-next-grid::-webkit-scrollbar {
		display: none;
	}
	.field-next-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'kicker side'
			'main side';
		gap: 0.34rem 0.65rem;
		min-height: 3.75rem;
		padding: 0.66rem 0.78rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		border-left: 2px solid transparent;
		background: var(--canvas-panel);
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
		color: var(--canvas-text);
		text-decoration: none;
		transition:
			border-color var(--t-normal) var(--ease),
			background-color var(--t-normal) var(--ease);
	}
	.field-next-item:hover,
	.field-next-item:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: var(--canvas-panel-strong);
		outline: none;
	}
	.field-next-item[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 26%);
	}
	.field-next-item[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 28%);
	}
	.field-next-item[data-state='draft-only'] {
		border-left-color: oklch(0.64 0.11 72 / 0.92);
		background: oklch(0.968 0.006 58);
	}
	.field-next-item[data-state='gated'] {
		border-left-color: oklch(0.54 0.075 45 / 0.9);
		background: oklch(0.962 0.006 58);
	}
	.field-next-kicker {
		grid-area: kicker;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.61rem;
		font-weight: 850;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--canvas-dim);
		white-space: nowrap;
	}
	.field-next-main {
		grid-area: main;
		display: grid;
		gap: 0.12rem;
		min-width: 0;
	}
	.field-next-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.84rem;
		font-weight: 850;
		color: var(--canvas-text);
	}
	.field-next-effect,
	.field-next-gate {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.61rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: var(--canvas-muted);
	}
	.field-next-gate {
		color: var(--canvas-dim);
	}
	.field-next-side {
		grid-area: side;
		display: grid;
		align-content: space-between;
		justify-items: end;
		gap: 0.14rem;
		min-width: 5.4rem;
	}
	.field-next-action,
	.field-next-handoff {
		max-width: 7.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 850;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.field-next-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.22rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.64rem;
		font-weight: 800;
		color: var(--canvas-text);
		white-space: nowrap;
	}
	.field-pressure-title {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 7.2rem;
		min-height: 3.75rem;
		padding: 0.65rem 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		background: var(--canvas-panel);
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.66rem;
		font-weight: 850;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--canvas-muted);
		text-align: center;
	}
	.field-action-strip .field-claim-title,
	.field-action-strip .field-next-title,
	.field-action-strip .field-pressure-title {
		justify-content: flex-start;
		min-width: 0;
		min-height: 2.35rem;
		padding: 0.5rem 0.68rem;
		text-align: left;
	}
	.field-pressure-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		min-width: 0;
		max-height: 10.8rem;
		overflow: auto;
		scrollbar-width: none;
	}
	.field-pressure-grid::-webkit-scrollbar {
		display: none;
	}
	.field-pressure-item,
	.field-pressure-clear {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.34rem 0.65rem;
		min-height: 3.75rem;
		padding: 0.66rem 0.78rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		border-left: 2px solid transparent;
		background: var(--canvas-panel);
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
		color: var(--canvas-text);
		text-decoration: none;
		transition:
			border-color var(--t-normal) var(--ease),
			background-color var(--t-normal) var(--ease);
	}
	.field-pressure-clear {
		grid-template-columns: minmax(0, 1fr);
		align-content: center;
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 28%);
	}
	.field-pressure-item:hover,
	.field-pressure-item:focus-visible,
	.field-pressure-clear:hover,
	.field-pressure-clear:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: var(--canvas-panel-strong);
		outline: none;
	}
	.field-pressure-item[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 26%);
	}
	.field-pressure-item[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 28%);
	}
	.field-pressure-item[data-state='draft-only'] {
		border-left-color: oklch(0.64 0.11 72 / 0.92);
		background: oklch(0.968 0.006 58);
	}
	.field-pressure-item[data-state='gated'] {
		border-left-color: oklch(0.54 0.075 45 / 0.9);
		background: oklch(0.962 0.006 58);
	}
	.field-pressure-main {
		display: grid;
		gap: 0.1rem;
		min-width: 0;
	}
	.field-pressure-kicker {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.59rem;
		font-weight: 850;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--canvas-dim);
		white-space: nowrap;
	}
	.field-pressure-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.84rem;
		font-weight: 850;
		color: var(--canvas-text);
	}
	.field-pressure-ground,
	.field-pressure-blocked,
	.field-pressure-next,
	.field-pressure-copy {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: var(--canvas-muted);
	}
	.field-pressure-blocked,
	.field-pressure-next,
	.field-pressure-copy {
		color: var(--canvas-dim);
	}
	.field-pressure-side {
		display: grid;
		align-content: space-between;
		justify-items: end;
		gap: 0.14rem;
		min-width: 5.8rem;
	}
	.field-pressure-action,
	.field-pressure-tasks {
		max-width: 7.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6rem;
		font-weight: 850;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.field-pressure-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.22rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.64rem;
		font-weight: 800;
		color: var(--canvas-text);
		white-space: nowrap;
	}
	.proc-pill {
		grid-area: process;
		justify-self: end;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.625rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		background: var(--canvas-panel);
		cursor: pointer;
		max-width: 18rem;
	}
	.proc-pill-dot {
		width: 0.4375rem;
		height: 0.4375rem;
		border-radius: 50%;
		background: var(--org-sidebar-text-dim, oklch(0.52 0.014 235));
		flex-shrink: 0;
	}
	.proc-pill--running .proc-pill-dot {
		background: var(--stage-color);
		box-shadow: 0 0 8px -1px var(--stage-color);
		animation: dot-breath 1.8s ease-in-out infinite;
	}
	.proc-pill--error .proc-pill-dot {
		background: oklch(0.65 0.16 30);
	}
	.proc-pill-label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--org-sidebar-text, oklch(0.22 0.016 250));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	.proc-pill-stage {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.64rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--org-sidebar-text-muted, oklch(0.42 0.016 245));
		flex-shrink: 0;
	}
	.proc-pill-count {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.64rem;
		font-weight: 600;
		padding: 0.05rem 0.3rem;
		border-radius: 6px;
		background: oklch(0.89 0.012 78 / 0.9);
		color: var(--org-sidebar-text, oklch(0.22 0.016 250));
	}

	/* ─── Dock — the workspace command rail ─ */
	.dock {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 1.25rem;
		pointer-events: none;
		z-index: 2;
	}
	.dock > * {
		pointer-events: auto;
	}
	.dock-panel {
		display: grid;
		grid-template-columns: minmax(20rem, 0.82fr) minmax(42rem, 1.9fr) minmax(11rem, 0.42fr);
		grid-auto-flow: column;
		align-items: stretch;
		gap: 0.72rem;
		width: min(100%, 94rem);
		padding: 0.84rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		background: var(--canvas-panel);
		box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.72);
	}
	.dock-command-group {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.45rem;
		min-width: 0;
	}
	.dock-group {
		display: flex;
		align-items: stretch;
		gap: 0.45rem;
		min-width: 0;
	}
	.dock-group--workspaces {
		display: grid;
		grid-template-columns: repeat(4, minmax(9.5rem, 1fr));
	}
	.dock-group--processes {
		max-width: min(24rem, 34vw);
		overflow: hidden;
	}
	.dock-command,
	.dock-control,
	.dock-map-state {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
		min-height: 5.75rem;
		padding: 0.82rem 0.92rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border);
		background: var(--canvas-panel-strong);
		color: var(--canvas-text);
		box-shadow: none;
	}
	.dock-command,
	.dock-control {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.98rem;
		font-weight: 800;
		cursor: pointer;
		transition:
			border-color var(--t-normal) var(--ease),
			color var(--t-normal) var(--ease),
			background-color var(--t-normal) var(--ease);
	}
	.dock-command:hover,
	.dock-command:focus-visible,
	.dock-control:hover,
	.dock-control:focus-visible,
	.dock-back:hover,
	.dock-back:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.955 0.015 190);
		outline: none;
	}
	.dock-command--author {
		border-color: oklch(0.58 0.085 185 / 0.58);
		border-left: 2px solid color-mix(in oklch, var(--coord-verified, #10b981), transparent 26%);
		background: oklch(0.89 0.055 185);
		color: oklch(0.18 0.022 210);
	}
	.dock-command--author[data-state='partial'] {
		border-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 34%);
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 20%);
		background: var(--canvas-panel-strong);
	}
	.dock-command--author[data-state='draft-only'],
	.dock-command--author[data-state='gated'] {
		border-color: oklch(0.64 0.11 72 / 0.68);
		border-left-color: oklch(0.64 0.11 72 / 0.92);
		border-left-style: dashed;
		background: oklch(0.97 0.006 58);
		color: var(--canvas-text);
	}
	.dock-command--finder {
		color: var(--canvas-text);
		border-color: oklch(0.62 0.035 245 / 0.46);
	}
	.dock-posture {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: minmax(0, 0.84fr) minmax(5.5rem, 0.62fr);
		grid-template-areas:
			'head counts'
			'ratio counts';
		align-items: center;
		gap: 0.34rem 0.56rem;
		min-height: 2.9rem;
		padding: 0.54rem 0.64rem;
		border-radius: 8px;
		border: 1px solid var(--canvas-panel-border-soft);
		background: oklch(0.973 0.006 58);
		color: var(--canvas-text);
		text-decoration: none;
	}
	.dock-posture:hover,
	.dock-posture:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.958 0.012 190);
		outline: none;
	}
	.dock-posture-head {
		grid-area: head;
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}
	.dock-posture-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.76rem;
		font-weight: 850;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.dock-posture-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.24rem;
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.64rem;
		font-weight: 800;
		letter-spacing: 0.035em;
		text-transform: uppercase;
		color: var(--canvas-text);
	}
	.dock-posture-ratio {
		grid-area: ratio;
		min-width: 0;
	}
	.dock-posture-counts {
		grid-area: counts;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.24rem 0.46rem;
		min-width: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.58rem;
		font-weight: 800;
		letter-spacing: 0.035em;
		text-transform: uppercase;
		color: var(--canvas-dim);
	}
	.dock-posture-counts > span {
		display: inline-flex;
		align-items: baseline;
		gap: 0.18rem;
		min-width: 0;
		white-space: nowrap;
	}
	.dock-posture-counts > span:last-child {
		grid-column: 1 / -1;
	}
	.dock-control--workspace[data-workspace='STUDIO'] {
		border-color: oklch(0.5 0.055 185 / 0.45);
	}
	.dock-control--workspace[data-workspace='PEOPLE'] {
		border-color: oklch(0.5 0.045 155 / 0.42);
	}
	.dock-control--workspace[data-workspace='POWER'] {
		border-color: oklch(0.52 0.045 285 / 0.38);
	}
	.dock-control--workspace[data-workspace='RESULTS'] {
		border-color: oklch(0.55 0.04 75 / 0.4);
	}
	.dock-control--workspace {
		border-left: 2px solid transparent;
		align-items: flex-start;
		justify-content: flex-start;
		min-height: 6.05rem;
	}
	.dock-control--workspace[data-state='live'] {
		border-left-color: color-mix(in oklch, var(--coord-verified, #10b981), transparent 26%);
	}
	.dock-control--workspace[data-state='partial'] {
		border-left-color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 30%);
	}
	.dock-control--workspace[data-state='gated'] {
		border-left-color: oklch(0.54 0.075 45 / 0.9);
		background: oklch(0.964 0.006 58);
	}
	.dock-control--workspace[data-state='draft-only'] {
		border-left-color: oklch(0.64 0.11 72 / 0.92);
		background: oklch(0.97 0.006 58);
	}
	.dock-control--workspace[data-state='live'] .dock-action {
		color: color-mix(in oklch, var(--coord-verified, #10b981), var(--canvas-text) 18%);
	}
	.dock-control--workspace[data-state='partial'] .dock-action {
		color: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), var(--canvas-text) 18%);
	}
	.dock-control--workspace[data-state='draft-only'] .dock-action {
		color: oklch(0.55 0.1 72);
	}
	.dock-control--workspace[data-state='gated'] .dock-action {
		color: oklch(0.46 0.035 55);
	}
	.dock-control--focused {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.945 0.018 190);
	}
	.dock-key {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.78rem;
		min-width: 1.48rem;
		padding: 0.12rem 0.34rem;
		border-radius: 4px;
		background: oklch(0.88 0.012 78 / 0.92);
		color: var(--canvas-text);
		text-align: center;
	}
	.dock-main {
		display: grid;
		gap: 0.12rem;
		min-width: 0;
		width: 100%;
	}
	.dock-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.45rem;
		min-width: 0;
	}
	.dock-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 850;
		font-size: 1rem;
	}
	.dock-signal {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: var(--canvas-muted);
		white-space: nowrap;
	}
	.dock-action {
		width: 100%;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.62rem;
		font-weight: 850;
		letter-spacing: 0.045em;
		text-transform: uppercase;
		color: var(--canvas-muted);
	}
	.dock-effect {
		width: 100%;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.68rem;
		font-weight: 650;
		line-height: 1.18;
		color: var(--canvas-muted);
	}
	.dock-unlock {
		width: 100%;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.64rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--canvas-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dock-state {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.58rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 0.08rem 0.28rem;
		border-radius: 4px;
		background: oklch(0.9 0.012 78 / 0.76);
		color: var(--canvas-muted);
	}
	.dock-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.35rem;
		height: 1.35rem;
		border-radius: 8px;
		background: oklch(0.88 0.012 78 / 0.92);
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		color: var(--canvas-text);
	}
	.dock-map-state {
		display: grid;
		align-content: center;
		gap: 0.18rem;
	}
	.dock-mode {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.86rem;
		font-weight: 850;
		color: var(--canvas-text);
	}
	.dock-zoom {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.04em;
		color: var(--canvas-muted);
	}
	.dock-back {
		width: fit-content;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--canvas-muted);
		text-decoration: none;
		transition:
			color var(--t-normal) var(--ease),
			background-color var(--t-normal) var(--ease);
	}
	.dock-sep {
		width: 1px;
		height: auto;
		min-height: 2.8rem;
		background: oklch(0.72 0.018 78 / 0.64);
		flex-shrink: 0;
	}
	.dock-control--proc {
		max-width: 12rem;
		min-height: 5.75rem;
	}
	.dock-proc-dot {
		width: 0.4375rem;
		height: 0.4375rem;
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--stage-color, #3bc4b8);
		box-shadow: 0 0 8px -1px var(--stage-color, #3bc4b8);
		animation: dock-proc-breath 1.8s ease-in-out infinite;
	}
	.dock-proc-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	@media (max-width: 920px) {
		.hud--top {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas:
				'org'
				'spine'
				'operating'
				'loop'
				'rail'
				'contract'
				'action'
				'process';
			align-items: flex-start;
		}
		.proc-pill {
			justify-self: start;
		}
		.field-spine {
			width: min(100%, 46rem);
			grid-template-columns: repeat(2, minmax(0, 1fr));
			justify-self: start;
		}
		.field-operating-readout {
			width: min(100%, 46rem);
			grid-template-columns: repeat(2, minmax(10rem, 1fr));
		}
		.field-loop-strip {
			width: min(100%, 46rem);
			justify-self: start;
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.field-rail {
			grid-template-columns: repeat(2, minmax(7.5rem, 1fr));
			width: min(100%, 46rem);
			justify-self: start;
		}
		.field-contract {
			width: min(100%, 46rem);
			justify-self: start;
			grid-template-columns: minmax(0, 1fr);
		}
		.field-state-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.field-coverage-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.field-action-strip {
			width: min(100%, 46rem);
			justify-self: start;
			grid-template-columns: minmax(0, 1fr);
		}
		.field-next-grid,
		.field-pressure-grid {
			max-height: none;
		}
		.field-pressure-title {
			justify-content: flex-start;
			min-height: 2.35rem;
		}
		.field-pressure-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.field-claim-title {
			justify-content: flex-start;
			min-height: 2.35rem;
		}
		.field-claim-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.field-next-title {
			justify-content: flex-start;
			min-height: 2.35rem;
		}
		.field-next-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.dock {
			bottom: 0.75rem;
			padding: 0 0.75rem;
		}
		.dock-panel {
			grid-template-columns: minmax(0, 1fr);
			grid-auto-flow: row;
			width: 100%;
			max-height: min(72vh, 24rem);
			overflow: auto;
			scrollbar-width: none;
		}
		.dock-panel::-webkit-scrollbar {
			display: none;
		}
		.dock-command-group,
		.dock-group--workspaces {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.dock-group--processes {
			max-width: 100%;
			flex-wrap: wrap;
		}
		.dock-sep {
			display: none;
		}
	}

	@media (max-width: 640px) {
		.hud {
			padding-left: 0.875rem;
			padding-right: 0.875rem;
		}
		.hud--top {
			display: grid;
			grid-template-columns: 1fr;
			align-items: stretch;
		}
		.hud-org {
			flex: none;
		}
		.field-rail {
			width: 100%;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.field-spine {
			width: 100%;
		}
		.field-operating-readout {
			width: 100%;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.field-loop-strip {
			width: 100%;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.field-action-strip,
		.field-contract,
		.field-next,
		.field-pressure,
		.field-claim-boundary {
			width: 100%;
		}
		.field-contract-summary,
		.field-coverage-summary,
		.field-state-item,
		.field-coverage-item {
			min-height: 2.95rem;
			padding: 0.5rem 0.58rem;
		}
		.field-coverage-item {
			min-height: 4.05rem;
		}
		.field-claim-item {
			min-height: 3.55rem;
			padding: 0.56rem 0.64rem;
			grid-template-columns: minmax(0, 1fr);
		}
		.field-claim-side {
			grid-template-columns: auto auto;
			align-items: baseline;
			justify-items: start;
			justify-content: space-between;
			min-width: 0;
		}
		.field-claim-action {
			max-width: 100%;
		}
		.field-next-item {
			min-height: 3.45rem;
			padding: 0.56rem 0.64rem;
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas:
				'kicker'
				'main'
				'side';
		}
		.field-next-side {
			grid-template-columns: auto auto;
			align-items: baseline;
			justify-items: start;
			justify-content: space-between;
			min-width: 0;
		}
		.field-next-handoff {
			display: none;
		}
		.field-pressure-item {
			min-height: 3.45rem;
			padding: 0.56rem 0.64rem;
			grid-template-columns: minmax(0, 1fr);
		}
		.field-pressure-side {
			grid-template-columns: auto auto;
			align-items: baseline;
			justify-items: start;
			justify-content: space-between;
			min-width: 0;
		}
		.field-pressure-tasks {
			display: none;
		}
		.field-operating-item {
			min-height: 4.6rem;
			padding: 0.64rem 0.68rem;
		}
		.field-operating-label {
			font-size: 0.82rem;
		}
		.field-operating-signal {
			font-size: 0.72rem;
		}
		.field-rail-item {
			min-height: 4.25rem;
			padding: 0.56rem 0.64rem;
		}
		.field-rail-name {
			font-size: 0.82rem;
		}
		.field-rail-action,
		.dock-action {
			font-size: 0.58rem;
		}
		.dock {
			bottom: 0.65rem;
		}
		.dock-command,
		.dock-control,
		.dock-map-state {
			min-height: 4.25rem;
			padding: 0.58rem 0.7rem;
			font-size: 0.88rem;
		}
		.dock-control--workspace {
			min-height: 4.9rem;
		}
		.dock-map-state {
			grid-template-columns: auto auto 1fr;
			align-items: center;
			column-gap: 0.6rem;
		}
		.dock-posture {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas:
				'head'
				'ratio'
				'counts';
			min-height: 3.2rem;
			padding: 0.54rem 0.62rem;
		}
		.dock-posture-counts {
			grid-template-columns: repeat(5, minmax(0, auto));
			justify-content: space-between;
			gap: 0.32rem;
		}
		.dock-posture-counts > span:last-child {
			grid-column: auto;
		}
		.dock-state {
			display: none;
		}
		.dock-unlock {
			max-width: 7.5rem;
		}
		.dock-count {
			display: none;
		}
	}

	@media (max-width: 480px) {
		.field-spine {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.field-spine-detail {
			display: none;
		}
		.field-operating-action {
			display: none;
		}
		.field-loop-strip {
			grid-template-columns: minmax(0, 1fr);
		}
		.field-next-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.field-pressure-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.field-coverage-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.field-state-sample,
		.field-coverage-split,
		.field-next-gate,
		.field-pressure-blocked,
		.field-pressure-next,
		.field-claim-boundary-copy {
			display: none;
		}
		.field-rail-tasks {
			display: none;
		}
		.dock-unlock {
			display: none;
		}
		.dock-effect {
			display: none;
		}
		.dock-posture-counts {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.dock-posture-counts > span:last-child {
			grid-column: 1 / -1;
		}
	}

	@keyframes dock-proc-breath {
		0%,
		100% {
			opacity: 0.55;
		}
		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.world {
			transition: none;
		}
		.proc-pill--running .proc-pill-dot,
		.dock-proc-dot {
			animation: none !important;
		}
	}
</style>
