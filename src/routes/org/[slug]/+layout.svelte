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
		summarizeCriticalPath,
		summarizeGateRegister,
		summarizeLaunchPressure,
		type CapabilityState,
		type GateEvidence
	} from '$lib/data/capability-hypergraph';
	import { CAPABILITY_CLUSTER_IDS } from '$lib/data/capability-clusters';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import { page } from '$app/stores';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';
	import OrgMantle from '$lib/components/org/OrgMantle.svelte';
	import OrgShell from '$lib/components/org/os/OrgShell.svelte';
	import Spotlight, {
		type SpotlightDestination,
		type SpotlightState
	} from '$lib/components/org/os/Spotlight.svelte';
	import { setOrgOS, spaceForPath, rendersSpaceForUrl } from '$lib/components/org/os/orgOS.svelte';
	import type {
		WorkspaceCapabilityState,
		WorkspaceMark
	} from '$lib/components/org/WorkspaceSwitcher.svelte';
	import type { WatermarkTier } from '$lib/components/org/MantleWatermark.svelte';

	type OperatingGroundCapability = {
		label: string;
		value: string;
		state: 'live' | 'partial' | 'gated' | 'testnet';
		action: string;
		gate: string;
		gateSignal?: string;
		href?: string;
	};

	type CapabilityCommandState = Exclude<SpotlightState, 'testnet'>;
	type OperatingGroundReadinessSource = {
		label?: string;
		state: CapabilityState;
		signal?: string;
		action: string;
		gate?: string;
		boundary?: string;
		href: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
		rowCount?: number;
		boundaryCount?: number;
		liveCount?: number;
	};
	type OperatingGroundReadinessOptions = {
		label?: string;
		value?: string;
		state?: OperatingGroundCapability['state'];
		gateSignal?: string;
		href?: string;
	};
	type CapabilityMetricSource = {
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};
	type OperatingGroundRoute = {
		href: string;
		label: string;
		sublabel?: string;
		state?: SpotlightState;
		signal?: string;
		action?: string;
		handoff?: string;
		effect?: string;
		gate?: string;
		latent?: boolean;
	};
	type SpacesData = LayoutData['spaces'];
	type WorkspaceSignal = WorkspaceMark['signal'];
	type LandscapeScorecard = NonNullable<SpacesData['landscape']>['scorecards'][number];
	type NullableScorecardMetric =
		| 'reportsOpened'
		| 'verifyLinksClicked'
		| 'repliesLogged'
		| 'alignedVotes'
		| 'relevantVotes';

	let {
		children,
		data
	}: {
		children: Snippet;
		data: LayoutData;
	} = $props();

	const base = $derived(`/org/${data.org.slug}`);

	// ─── The OS kernel ────────────────────────────────────────────────
	// Created HERE, at the layout, so both the Mantle (WorkspaceSwitcher) and
	// the OrgShell (the four mounted spaces) read the SAME instance via context.
	// The layout persists across every /org/[slug]/* child navigation, so the OS
	// — and the in-flight STUDIO authoring process it holds — survives navigating
	// to deep routes and switching spaces. It is the persistent kernel.
	//
	// setContext must run during component init (not in an effect), so we seed the
	// initial space from the SSR-resolved pathname. The slug is fixed for the life
	// of this mounted layout (a slug change remounts it), so reading it once at
	// init is correct — this is intentionally NOT the reactive `base`.
	const initialBase = `/org/${data.org.slug}`;
	const os = setOrgOS(spaceForPath($page.url.pathname, initialBase), initialBase);

	// A canonical space path (/studio, /supporters, /representatives, org root) is
	// OWNED by a mounted OrgShell space — we show the shell and suppress the
	// redundant route page. A deep route (/campaigns, /settings, /legislation, …)
	// is a full page the OS hasn't absorbed yet: we render its children() instead,
	// while OrgShell stays mounted (hidden) so the STUDIO process keeps streaming.
	// `?view=full` is the explicit opt-out: it renders the full page at a
	// canonical space path (the supporter table at /supporters, the
	// decision-maker directory at /representatives) — the spaces link through it
	// so the deep tools they summarize stay reachable.
	const onSpacePath = $derived(rendersSpaceForUrl($page.url, base));

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

	// Role gates the STUDIO Send affordance (display only; not enforcement).
	const canPublish = $derived(
		data.membership.role === 'owner' || data.membership.role === 'editor'
	);

	function signalText(signal: WorkspaceSignal): string {
		if (signal.datum !== undefined && signal.datum !== null) {
			return `${signal.datum.toLocaleString('en-US')} ${signal.label}`;
		}
		return `${signal.value} ${signal.label}`;
	}

	function capabilityMetricSignal(
		source: CapabilityMetricSource | null | undefined,
		fallback: string
	): string {
		if (!source || source.metric.value === null) return fallback;
		return `${source.metric.value.toLocaleString('en-US')} ${source.metric.label}`;
	}

	function spotlightState(state: WorkspaceCapabilityState): SpotlightState {
		return state;
	}

	function operatingGroundCapabilityState(
		state: CapabilityState
	): OperatingGroundCapability['state'] {
		return state === 'draft-only' ? 'partial' : state;
	}

	function compactGateSignal(gate: GateEvidence): string {
		if (gate.state === 'live') return `${gate.completed}/${gate.total} tasks complete`;
		if (gate.downstream > 0) return `${gate.downstream} downstream`;
		return gate.tasks;
	}

	function readinessRowSignal(rowCount: number, boundaryCount: number, liveCount: number): string {
		if (rowCount <= 0) return 'unread rows';
		if (boundaryCount <= 0) return `${liveCount}/${rowCount} armed`;
		return `${boundaryCount}/${rowCount} bounded`;
	}

	function operatingGroundValue(source: OperatingGroundReadinessSource): string {
		if (source.signal) return source.signal;
		if (source.metric) {
			return source.metric.value === null
				? source.metric.label
				: `${source.metric.value.toLocaleString('en-US')} ${source.metric.label}`;
		}
		return source.label ?? 'substrate';
	}

	function operatingGroundGateSignalFor(source: OperatingGroundReadinessSource): string {
		if (
			source.rowCount !== undefined &&
			source.boundaryCount !== undefined &&
			source.liveCount !== undefined
		) {
			return readinessRowSignal(source.rowCount, source.boundaryCount, source.liveCount);
		}
		if (source.state === 'live') return 'armed';
		if (source.metric?.value !== null && source.metric?.value !== undefined) {
			return `${source.metric.value.toLocaleString('en-US')} ${source.metric.label}`;
		}
		return source.metric?.label ?? source.signal ?? 'boundary';
	}

	function operatingGroundFromReadiness(
		source: OperatingGroundReadinessSource,
		options: OperatingGroundReadinessOptions = {}
	): OperatingGroundCapability {
		return {
			label: options.label ?? source.label ?? 'Substrate',
			value: options.value ?? operatingGroundValue(source),
			state: options.state ?? operatingGroundCapabilityState(source.state),
			action: source.action,
			gate: source.boundary ?? source.gate ?? '',
			gateSignal: options.gateSignal ?? operatingGroundGateSignalFor(source),
			href: options.href ?? source.href
		};
	}

	function spotlightActionForState(state: SpotlightState, action: string): string {
		return operatorCapabilityActionLabel(state, action);
	}

	function commandStateLabel(state: CapabilityCommandState): string {
		return operatorCapabilityStateLabel(state);
	}

	function routeLatent(state: WorkspaceCapabilityState | undefined): boolean {
		return state === 'draft-only' || state === 'gated';
	}

	function commandGate(gate: GateEvidence, prefix: string): string {
		return formatGateEvidence(gate, { prefix, complete: prefix, density: 'operator' });
	}

	const loadedOrgSlices = $derived([
		data.spaces.return,
		data.spaces.base,
		data.spaces.landscape,
		data.spaces.operating
	]);
	const totalOrgSliceCount = $derived(loadedOrgSlices.length);
	const loadedSliceCount = $derived(loadedOrgSlices.filter(Boolean).length);
	const unloadedSliceCount = $derived(Math.max(0, totalOrgSliceCount - loadedSliceCount));
	const emailDelivery = $derived(data.spaces.operating?.emailDelivery ?? null);
	const textDelivery = $derived(data.spaces.operating?.textDelivery ?? null);
	const callRouting = $derived(data.spaces.operating?.callRouting ?? null);
	const congressionalDelivery = $derived(data.spaces.operating?.congressionalDelivery ?? null);
	const platformApiSync = $derived(data.spaces.operating?.platformApiSync ?? null);
	const fundraising = $derived(data.spaces.operating?.fundraising ?? null);
	const coordination = $derived(data.spaces.operating?.coordination ?? null);
	const coalition = $derived(data.spaces.operating?.coalition ?? null);
	const peopleSegmentation = $derived(data.spaces.base?.segmentation ?? null);
	const emailDeliveryHref = $derived(`${base}/emails/compose#email-delivery`);
	const actionRecordsHref = $derived(`${base}#action-records`);
	const resultsPacketHref = $derived(`${base}#results-packet`);
	const packetHref = $derived(
		data.spaces.return?.topCampaignId
			? `${base}/campaigns/${data.spaces.return.topCampaignId}/report#proof-preview`
			: resultsPacketHref
	);
	const proofDeliveryHref = $derived(
		data.spaces.return?.topCampaignId
			? `${base}/campaigns/${data.spaces.return.topCampaignId}/report#proof-delivery`
			: actionRecordsHref
	);
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
	const platformExportProfileSignal = $derived(platformIntakeReadiness.signal);
	const peopleSourceProvenanceReadiness = $derived(
		buildPeopleSourceProvenanceReadiness({
			base,
			sourceCounts: data.spaces.base?.sourceCounts ?? null,
			totalPeople: data.spaces.base?.total ?? null,
			platformApiGate
		})
	);
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
	const smsDispatchGate = getGateEvidence('CP-sms-dispatch', ['T2-1'], {
		name: 'SMS dispatch',
		downstream: 2,
		dependency: 'Browser phone custody and Twilio dispatch runner'
	});
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
	const abAutomationState = $derived<CapabilityCommandState>(
		!FEATURES.AB_TESTING ? 'gated' : abAutomationGate.state === 'live' ? 'live' : 'draft-only'
	);
	const civicGeographyLabelsState = $derived<CapabilityCommandState>(
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
	const softBounceHonesty = getDataHonestyEvidence('V-7', null, {
		live: 'Soft-bounce threshold evidence is verified against webhook and suppression rows.',
		gated: 'Soft-bounce threshold evidence is unresolved.',
		gate: 'Verify soft-bounce threshold handling before claiming suppression integrity.'
	});
	const emailListHealthReadiness = $derived(
		buildEmailListHealthReadiness({
			base,
			emailHealth: {
				loaded: Boolean(data.spaces.base),
				subscribed: data.spaces.base?.emailHealth.subscribed ?? null,
				unsubscribed: data.spaces.base?.emailHealth.unsubscribed ?? null,
				bounced: data.spaces.base?.emailHealth.bounced ?? null,
				complained: data.spaces.base?.emailHealth.complained ?? null,
				consentEvidenceCount: data.spaces.base?.consentEvidence.email ?? null,
				subscribedConsentEvidenceCount: data.spaces.base?.consentEvidence.emailSubscribed ?? null
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
	const peopleWorkspaceState = $derived<WorkspaceCapabilityState>(
		peopleSourceProvenanceReadiness.state === 'gated' ? 'gated' : emailListHealthReadiness.state
	);
	const peopleWorkspaceSignal = $derived<WorkspaceSignal>({
		label:
			emailListHealthReadiness.metric.value === null
				? 'reach'
				: emailListHealthReadiness.metric.label,
		value:
			emailListHealthReadiness.metric.value === null
				? emailListHealthReadiness.signal
				: emailListHealthReadiness.metric.value.toLocaleString('en-US'),
		datum: emailListHealthReadiness.metric.value,
		cite: emailListHealthReadiness.metric.cite
	});
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
				subscribedPhoneCount: data.spaces.base?.smsHealth.subscribed ?? null,
				unsubscribedPhoneCount: data.spaces.base?.smsHealth.unsubscribed ?? null,
				stoppedPhoneCount: data.spaces.base?.smsHealth.stopped ?? null,
				noSmsStatusCount: data.spaces.base?.smsHealth.none ?? null,
				phonePresentCount: data.spaces.base?.smsHealth.phonePresent ?? null,
				smsConsentEvidenceCount: data.spaces.base?.consentEvidence.sms ?? null,
				subscribedSmsConsentEvidenceCount: data.spaces.base?.consentEvidence.smsSubscribed ?? null,
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
	const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2'], {
		name: 'Receipt anchoring',
		downstream: 4,
		dependency: 'Receipt writer + mainnet anchoring'
	});
	const eventArtifactGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-10'], {
		name: 'Event artifact survivability',
		downstream: 3,
		dependency: 'Receipt manifest archive + long-term proof pattern'
	});
	const readerOfficeGate = getGateEvidence('CP-dm-office-profile', ['T8-1a', 'T8-1b', 'T8-8'], {
		name: 'Reader office integration',
		downstream: 4,
		dependency: 'DM enrichment partnership track'
	});
	const mainnetGate = getGateEvidence('CP-mainnet-deployment', ['T3-6', 'T5-5', 'T6-2', 'T6-1']);
	const teeGate = getGateEvidence('CP-tee-nitro-enclave', ['T5-3', 'T5-4']);
	const delegationGate = getGateEvidence('CP-delegation-executor', [
		'T4-2',
		'T4-1',
		'T4-8',
		'T4-9'
	]);
	const loopPhaseStates = $derived<CapabilityCommandState[]>([
		'live',
		'partial',
		'live',
		'partial',
		'partial',
		'partial'
	]);
	const liveLoopPhaseCount = $derived(loopPhaseStates.filter((state) => state === 'live').length);
	const totalLoopPhaseCount = $derived(loopPhaseStates.length);
	const loopCommandState = $derived<CapabilityCommandState>(
		liveLoopPhaseCount === totalLoopPhaseCount ? 'live' : 'partial'
	);
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
			fallbackSubscribedCount: data.spaces.base?.emailHealth.subscribed ?? null,
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
	const eventArtifactMode = $derived(
		sendReadiness.modes.find((mode) => mode.key === 'events') ?? null
	);
	const browserDirectSendSignal = $derived(sendReadiness.browserDirectSignal);
	const clientDirectMergeCommandState = $derived<CapabilityCommandState>(
		sendReadiness.clientDirectMergeState
	);
	const heldSendModeCount = $derived(sendReadiness.heldCount);
	const heldSendModeSummary = $derived(sendReadiness.heldModeSummary);
	const sendCommandState = $derived<CapabilityCommandState>(sendReadiness.state);
	const sendReadinessGate = $derived(sendReadiness.sendBoundaryGate);
	const launchPressureRows = $derived(
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
	const launchPressureSummary = $derived(summarizeLaunchPressure(launchPressureRows));
	const launchPressureCount = $derived(launchPressureSummary.count);
	const launchPressureCommandState = $derived<CapabilityCommandState>(launchPressureSummary.state);
	const launchPressureGate = $derived(launchPressureSummary.gate);
	const firstLaunchPressureRow = $derived(launchPressureRows[0] ?? null);
	const highestFanoutLaunchPressureRow = $derived(
		launchPressureRows.reduce<(typeof launchPressureRows)[number] | null>(
			(current, row) => (!current || row.gate.downstream > current.gate.downstream ? row : current),
			null
		)
	);
	const eventRecordsGate = getGateEvidence('CP-outbound-webhooks', ['T9-3', 'T9-7', 'T6-9'], {
		name: 'Event records'
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
				role: data.membership.role,
				canPublish,
				canInvite: canPublish,
				isOwner: data.membership.role === 'owner',
				memberCount: data.spaces.return?.stats.members ?? null,
				inviteCount: null,
				maxSeats: data.org.max_seats ?? null,
				planName: null,
				planStatus: null,
				maxVerifiedActions: null,
				maxEmails: null,
				publicApiEnabled: FEATURES.PUBLIC_API,
				encryptionConfigured: data.spaces.operating?.emailDelivery.orgKeyConfigured ?? null,
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
	const operatingAuthorityGroundRows = $derived(
		operatingAuthorityReadiness.rows.filter((row) =>
			[
				'publish-authority',
				'org-audit-log',
				'public-api-ground',
				'signed-webhooks',
				'registry-environment'
			].includes(row.id)
		)
	);
	const publishAuthorityOperatingRow = $derived(
		operatingAuthorityReadiness.rows.find((row) => row.id === 'publish-authority') ?? null
	);
	const publishAuthorityWorkspaceGate = $derived(
		publishAuthorityOperatingRow
			? `${publishAuthorityOperatingRow.ground} ${publishAuthorityOperatingRow.boundary}`
			: operatingAuthorityReadiness.gate
	);
	const signedWebhookAuthorityRow = $derived(
		operatingAuthorityReadiness.rows.find((row) => row.id === 'signed-webhooks') ?? null
	);
	const delegatedActionGate =
		[delegationGate, teeGate].find((gate) => gate.state !== 'live') ?? delegationGate;
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
				loaded: Boolean(data.spaces.return),
				hasPacket: Boolean(data.spaces.return?.packet),
				verifiedCount: data.spaces.return?.packet?.verified ?? null,
				totalCount: data.spaces.return?.packet?.total ?? null,
				districtCount: data.spaces.return?.packet?.districtCount ?? null,
				sentEmails: data.spaces.return?.stats.sentEmails ?? null,
				campaignCount: data.spaces.return?.campaigns.length ?? null,
				receiptCount: data.spaces.return?.receipts.loadedCount ?? null,
				pendingReceiptCount: data.spaces.return?.receipts.pendingCount ?? null,
				responseLoggedReceiptCount: data.spaces.return?.receipts.responseLoggedCount ?? null,
				anchorFieldCount: data.spaces.return?.receipts.anchorFieldCount ?? null,
				receiptSampleLimit: data.spaces.return?.receipts.sampleLimit ?? null,
				receiptProofWeightTotal: data.spaces.return?.receipts.proofWeightTotal ?? null
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
	const resultsWorkspaceSignal = $derived<WorkspaceSignal>({
		label:
			resultsProofReadiness.metric.value === null ? 'proof' : resultsProofReadiness.metric.label,
		value:
			resultsProofReadiness.metric.value === null
				? resultsProofReadiness.signal
				: resultsProofReadiness.metric.value.toLocaleString('en-US'),
		datum: resultsProofReadiness.metric.value,
		cite: resultsProofReadiness.metric.cite
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
				loaded: Boolean(data.spaces.landscape),
				legislationEnabled: Boolean(data.spaces.landscape?.legislationEnabled),
				followedCount: data.spaces.landscape?.followedCount ?? null,
				watchedBillCount: data.spaces.landscape?.bills.length ?? null,
				scorecardCount: data.spaces.landscape?.scorecardSnapshotCount ?? null
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
	const powerWorkspaceSignal = $derived<WorkspaceSignal>({
		label: powerTerrainReadiness.terrainCount === null ? 'terrain' : 'terrain records',
		value:
			powerTerrainReadiness.terrainCount === null
				? powerTerrainReadiness.signal
				: powerTerrainReadiness.terrainCount.toLocaleString('en-US'),
		datum: powerTerrainReadiness.terrainCount,
		cite: 'buildPowerTerrainReadiness'
	});
	const powerTargetTerrainRow = $derived(
		powerTerrainReadiness.rows.find((row) => row.id === 'target-records') ?? null
	);
	const powerBillsTerrainRow = $derived(
		powerTerrainReadiness.rows.find((row) => row.id === 'bills-corpus') ?? null
	);
	const powerScoreTerrainRow = $derived(
		powerTerrainReadiness.rows.find((row) => row.id === 'score-snapshots') ?? null
	);
	const accountabilityResponseReadiness = $derived(
		buildAccountabilityResponseReadiness({
			base,
			response: {
				loaded: Boolean(data.spaces.landscape),
				scorecardCount: data.spaces.landscape?.scorecardSnapshotCount ?? null,
				receiptCount:
					data.spaces.landscape?.scorecards.reduce(
						(sum, scorecard) => sum + scorecard.reportsReceived,
						0
					) ?? null,
				openedCount: sumKnownScorecardMetric(data.spaces.landscape?.scorecards, 'reportsOpened'),
				verifyClickCount: sumKnownScorecardMetric(
					data.spaces.landscape?.scorecards,
					'verifyLinksClicked'
				),
				replyCount: sumKnownScorecardMetric(data.spaces.landscape?.scorecards, 'repliesLogged'),
				alignedVoteCount: sumKnownScorecardMetric(
					data.spaces.landscape?.scorecards,
					'alignedVotes'
				),
				relevantVoteCount: sumKnownScorecardMetric(
					data.spaces.landscape?.scorecards,
					'relevantVotes'
				)
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
	const legislativeMonitoringReadiness = $derived(
		buildLegislativeMonitoringReadiness({
			base,
			legislation: {
				loaded: Boolean(data.spaces.landscape),
				enabled: Boolean(data.spaces.landscape?.legislationEnabled),
				watchedBillCount: data.spaces.landscape?.bills.length ?? null,
				relevantBillCount: data.spaces.landscape?.relevantBillCount ?? null,
				positionedBillCount: data.spaces.landscape?.positionedBillCount ?? null
			},
			gates: {
				stateBillTerrainGate: powerStateBillTerrainGate,
				perSupporterAlertsGate: perSupporterBillAlertsGate,
				delegatedMonitoringGate: delegatedLegislativeMonitoringGate,
				multiJurisdictionRoutingGate
			}
		})
	);
	const criticalPathRows = $derived(
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
	const criticalPathSummary = $derived(summarizeCriticalPath(criticalPathRows));
	const criticalPathCommandState = $derived<CapabilityCommandState>(criticalPathSummary.state);
	const criticalPathCommandSignal = $derived(
		`${criticalPathSummary.liveCount}/${criticalPathRows.length} ${commandStateLabel('live')} · ${criticalPathSummary.unresolvedCount} unresolved`
	);
	const criticalPathCommandGate = $derived(criticalPathSummary.loadBearingSummary);
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
	const gateRegisterRows = $derived(
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
	const gateRegisterSummary = $derived(summarizeGateRegister(gateRegisterRows));
	const unresolvedGateCount = $derived(gateRegisterSummary.unresolvedCount);
	const loadBearingGate = $derived(gateRegisterSummary.loadBearingGate);
	const loadBearingGateSummary = $derived(gateRegisterSummary.loadBearingGateSummary);
	const dataHonestyRows = [
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
	const unresolvedHonestyCount = $derived(
		dataHonestyRows.filter((row) => row.state !== 'live').length
	);
	const liveHonestyCount = $derived(dataHonestyRows.filter((row) => row.state === 'live').length);
	const dataHonestyMarkCount = dataHonestyRows.length;
	const unresolvedHonestyRows = $derived(dataHonestyRows.filter((row) => row.state !== 'live'));
	const unresolvedHonestyMarks = $derived(unresolvedHonestyRows.map((row) => row.mark).join(', '));
	const unresolvedBasisCount = $derived(unloadedSliceCount + unresolvedHonestyCount);
	const basisCommandState = $derived<CapabilityCommandState>(
		unresolvedBasisCount === 0 ? 'live' : 'partial'
	);
	const basisCommandSignal = $derived(
		`${loadedSliceCount}/${totalOrgSliceCount} slices · ${liveHonestyCount}/${dataHonestyMarkCount} ${commandStateLabel('live')} data-honesty marks · ${unresolvedBasisCount} basis gap${unresolvedBasisCount === 1 ? '' : 's'}`
	);
	const basisCommandGate = $derived(
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
			: 'No missing slice becomes a count; all data-honesty marks are armed.'
	);
	const compositionPathStates = $derived<CapabilityCommandState[]>([
		'partial',
		'partial',
		FEATURES.NETWORKS ? 'partial' : 'gated',
		FEATURES.DELEGATION ? 'partial' : 'gated'
	]);
	const partialCompositionPathCount = $derived(
		compositionPathStates.filter((state) => state === 'partial').length
	);
	const gatedCompositionPathCount = $derived(
		compositionPathStates.filter((state) => state === 'gated').length
	);
	const compositionCommandState = $derived<CapabilityCommandState>(
		partialCompositionPathCount > 0 ? 'partial' : gatedCompositionPathCount > 0 ? 'gated' : 'live'
	);
	const compositionCommandGate = $derived(
		[
			commandGate(studioJurisdictionScopeGate, 'Studio jurisdiction scope remains bounded.'),
			commandGate(messageProofGate, 'Proof-bound message recovery remains bounded.'),
			commandGate(mainnetGate, 'Action-to-proof settlement remains bounded.'),
			commandGate(teeGate, 'Attested agent reasoning remains bounded.'),
			commandGate(delegationGate, 'Delegated civic action remains gated.'),
			commandGate(readerOfficeGate, 'Reader-office response remains bounded.')
		].join(' ')
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
			runtime: data.spaces.operating?.authoring ?? null,
			gates: {
				studioJurisdictionScopeGate,
				messageProofGate,
				delegatedTraceGate,
				delegatedActionGate
			}
		})
	);
	const studioAuthoringCommandState = $derived<CapabilityCommandState>(
		studioAuthoringReadiness.state
	);
	const studioAuthoringCommandSignal = $derived(studioAuthoringReadiness.signal);
	const studioAuthoringCommandGate = $derived(studioAuthoringReadiness.gate);
	const studioAuthoringBoundaryCount = $derived(studioAuthoringReadiness.boundaryCount);
	const studioWorkspaceState = $derived<WorkspaceCapabilityState>(studioAuthoringReadiness.state);
	const studioWorkspaceSignal = $derived<WorkspaceSignal>({
		label:
			studioAuthoringReadiness.metric.value === null
				? 'authoring'
				: studioAuthoringReadiness.metric.label,
		value:
			studioAuthoringReadiness.metric.value === null
				? studioAuthoringReadiness.signal
				: studioAuthoringReadiness.metric.value.toLocaleString('en-US'),
		datum: studioAuthoringReadiness.metric.value,
		cite: studioAuthoringReadiness.metric.cite
	});
	const studioWorkspaceGate = $derived(
		canPublish
			? studioAuthoringCommandGate
			: `${studioAuthoringCommandGate} ${publishAuthorityWorkspaceGate}`
	);
	const studioScopeCommandState = $derived<CapabilityCommandState>(studioScopeReadiness.state);
	const studioScopeCommandSignal = $derived(studioScopeReadiness.signal);
	const studioScopeCommandGate = $derived(studioScopeReadiness.gate);
	const studioScopeBoundaryCount = $derived(studioScopeReadiness.boundaryCount);
	const stateLedgerCommandState = $derived<CapabilityCommandState>(
		heldSendModeCount > 0 || unresolvedGateCount > 0 || unresolvedBasisCount > 0
			? 'partial'
			: 'live'
	);
	const stateLedgerCommandSignal = $derived(
		`${liveLoopPhaseCount}/${totalLoopPhaseCount} ${commandStateLabel('live')} loop phases · ${heldSendModeSummary} · ${unresolvedGateCount} gates · ${unresolvedBasisCount} basis gap${unresolvedBasisCount === 1 ? '' : 's'}`
	);
	const stateLedgerCommandGate = $derived(
		`State ledger derives from visible route contracts and lands each state on one representative handoff, effect, source, and gate. ${loadBearingGateSummary}`
	);
	const clusterCoverageCommandState = $derived<CapabilityCommandState>(
		unresolvedGateCount > 0 || unresolvedBasisCount > 0 ? 'partial' : 'live'
	);
	const clusterCoverageCommandSignal = $derived(
		`${CAPABILITY_CLUSTER_IDS.length} clusters · ${unresolvedGateCount} gates · ${unresolvedBasisCount} basis gap${unresolvedBasisCount === 1 ? '' : 's'}`
	);
	const clusterCoverageCommandGate = $derived(
		`Cluster coverage derives from visible capability cards, compound paths, loop phases, and gate rows. ${loadBearingGateSummary}`
	);
	const nextHeldMoveState = $derived<CapabilityCommandState>(sendReadiness.nextHeldState);
	const nextHeldMoveLabel = $derived(sendReadiness.nextHeldLabel);
	const nextHeldMoveGate = $derived(sendReadiness.nextHeldGate);
	const nextMoveStates = $derived<CapabilityCommandState[]>([
		'live',
		studioAuthoringCommandState,
		studioScopeCommandState,
		'partial',
		nextHeldMoveState,
		loadBearingGate?.state ?? 'live'
	]);
	const activeNextMoveBoundaryCount = $derived(
		nextMoveStates.filter((state) => state !== 'live').length
	);
	const nextMovesCommandState = $derived<CapabilityCommandState>(
		activeNextMoveBoundaryCount > 0 ? 'partial' : 'live'
	);
	const nextMovesGate = $derived(
		`${studioAuthoringCommandGate} ${studioScopeCommandGate} ${nextHeldMoveGate} ${loadBearingGateSummary}`
	);
	const launchVectorHeldSurfaceCount = $derived(
		heldSendModeCount + unresolvedGateCount + unresolvedBasisCount
	);
	const launchVectorCommandState = $derived<CapabilityCommandState>(
		launchPressureCount > 0 || launchVectorHeldSurfaceCount > 0 ? 'partial' : 'live'
	);
	const launchVectorCommandSignal = $derived(
		firstLaunchPressureRow
			? `${firstLaunchPressureRow.name} first · ${highestFanoutLaunchPressureRow?.gate.downstream ?? 0} fan-out · ${launchVectorHeldSurfaceCount} held surface`
			: `pressure clear · ${launchVectorHeldSurfaceCount} held surface`
	);
	const launchVectorCommandGate = $derived(
		[
			firstLaunchPressureRow
				? commandGate(
						firstLaunchPressureRow.gate,
						`First unblock: ${firstLaunchPressureRow.nextLift}`
					)
				: 'First-org pressure clear.',
			highestFanoutLaunchPressureRow &&
			highestFanoutLaunchPressureRow.id !== firstLaunchPressureRow?.id
				? commandGate(
						highestFanoutLaunchPressureRow.gate,
						`Highest fan-out: ${highestFanoutLaunchPressureRow.effect}`
					)
				: null,
			launchVectorHeldSurfaceCount > 0
				? `Held surface evidence: ${heldSendModeSummary}; ${unresolvedGateCount} unresolved gates; ${unresolvedBasisCount} basis gaps.`
				: 'No held command surface remains.'
		]
			.filter(Boolean)
			.join(' ')
	);

	// ─── Four workspaces, not thirteen links ──────────────────────────
	// The org runs one loop: INTENT → GROUND → AUTHOR → RESOLVE → SEND →
	// AGGREGATE. The four marks fold the existing routes into that loop.
	// Every current route stays reachable. Configuration-gated routes ride as
	// secondary links inside the workspace they belong to; latent verbs are
	// annotated, not hidden.
	const marks = $derived<WorkspaceMark[]>([
		{
			id: 'studio',
			label: 'Studio',
			gloss: 'Authoring center',
			// STUDIO interior: the authoring loop with the agent's reasoning
			// visible. Campaigns/emails/sms/etc. ride beneath it as Send modes.
			href: `${base}/studio`,
			icon: 'studio',
			state: studioWorkspaceState,
			signal: studioWorkspaceSignal,
			handoff: 'Studio intent',
			effect: canPublish
				? 'author grounded action drafts and delivery handoffs'
				: 'author and preserve Studio evidence; route handoffs require org authority',
			action: 'open Studio intent',
			gate: studioWorkspaceGate,
			gateSignal: canPublish ? studioAuthoringCommandSignal : 'org authority for handoffs',
			secondary: [
				{
					href: `${base}/campaigns`,
					label: 'Action records',
					sublabel: 'Proof-bearing containers',
					state: 'partial',
					signal: data.spaces.return
						? `${data.spaces.return.stats.activeCampaigns.toLocaleString('en-US')} active`
						: 'unread campaigns',
					action: 'open action records',
					gate: commandGate(
						congressionalLaunchGate,
						'Proof packets depend on action records; CWC proof delivery remains gated.'
					)
				},
				{
					href: `${base}/emails`,
					label: 'Email delivery',
					sublabel: 'Send mode boundary',
					state: sendCommandState,
					signal: browserDirectSendSignal,
					action:
						sendCommandState === 'draft-only'
							? 'create delivery draft'
							: sendCommandState === 'gated'
								? 'read delivery boundary'
								: 'open delivery records',
					gate: sendReadinessGate
				},
				...(FEATURES.SMS
					? [
							{
								href: `${base}/sms#sms-dispatch-boundary`,
								label: 'Phone outreach',
								sublabel: 'Reach channel',
								state:
									textDelivery?.dispatchRuntimeReady && smsDispatchGate.state === 'live'
										? ('partial' as const)
										: ('draft-only' as const),
								signal:
									textDelivery?.dispatchRuntimeReady && smsDispatchGate.state === 'live'
										? 'text dispatch armed'
										: 'text drafts only',
								action:
									textDelivery?.dispatchRuntimeReady && smsDispatchGate.state === 'live'
										? 'open text dispatch'
										: 'read text boundary',
								gate: commandGate(
									smsDispatchGate,
									textDelivery?.dispatchRuntimeMessage ??
										'Carrier text delivery remains draft-only until the dispatch runtime is ready.'
								),
								latent: !(textDelivery?.dispatchRuntimeReady && smsDispatchGate.state === 'live')
							}
						]
					: []),
				{
					href: eventArtifactMode?.route ?? `${base}/events#event-export-boundary`,
					label: 'Event records',
					sublabel: 'RSVP + artifacts',
					state: eventArtifactMode?.state ?? 'gated',
					signal: FEATURES.EVENTS ? 'ICS + non-PII CSV' : 'artifact gate held',
					action: eventArtifactMode?.action ?? 'read event boundary',
					gate:
						eventArtifactMode?.unlock ??
						commandGate(
							eventArtifactGate,
							'Event records and artifacts stay dependency-first until the event artifact gate opens.'
						),
					latent: (eventArtifactMode?.state ?? 'gated') === 'gated'
				},
				...(FEATURES.FUNDRAISING
					? [
							{
								href: fundraisingReadiness.href,
								label: 'Funding actions',
								sublabel: 'Donation intake + receipt boundary',
								state: fundraisingReadiness.state,
								signal: fundraisingReadiness.signal,
								action: fundraisingReadiness.action,
								gate: fundraisingReadiness.gate,
								latent:
									fundraisingReadiness.state === 'draft-only' ||
									fundraisingReadiness.state === 'gated'
							}
						]
					: []),
				...(FEATURES.AUTOMATION
					? [
							{
								href: coordinationReadiness.href,
								label: 'Workflow drafts',
								sublabel: 'Coordination logic',
								state: coordinationReadiness.state,
								signal: coordinationReadiness.signal,
								action: coordinationReadiness.action,
								gate: coordinationReadiness.gate,
								latent:
									coordinationReadiness.state === 'draft-only' ||
									coordinationReadiness.state === 'gated'
							}
						]
					: [])
			]
		},
		{
			id: 'base',
			label: 'People',
			gloss: 'People you reach',
			href: `${base}/supporters`,
			icon: 'people',
			state: peopleWorkspaceState,
			signal: peopleWorkspaceSignal,
			handoff: 'People ledger',
			effect: 'read reachable people, consent, and source custody',
			action: 'open People ledger',
			gate: `${peopleSourceProvenanceReadiness.gate} ${emailListHealthReadiness.gate}`,
			gateSignal: emailListHealthReadiness.nextGate.name,
			secondary: [
				{
					href: `${base}/supporters`,
					label: 'People ledger',
					sublabel: 'Proof-weighted people',
					state: peopleWorkspaceState,
					signal: signalText(peopleWorkspaceSignal),
					action: 'open People ledger',
					gate: emailListHealthReadiness.gate
				},
				{
					href: peopleSourceProvenanceReadiness.href,
					label: 'Source custody',
					sublabel: 'Origin custody',
					state: peopleSourceProvenanceReadiness.state,
					signal: peopleSourceProvenanceReadiness.signal,
					action: peopleSourceProvenanceReadiness.action,
					gate: peopleSourceProvenanceReadiness.gate,
					latent: peopleSourceProvenanceReadiness.state === 'gated'
				},
				{
					href: peopleSegmentationReadiness.href,
					label: 'Segmentation posture',
					sublabel: 'Saved cohorts + civic geography boundary',
					state: peopleSegmentationReadiness.state,
					signal: peopleSegmentationReadiness.signal,
					action: peopleSegmentationReadiness.action,
					gate: peopleSegmentationReadiness.gate,
					latent:
						peopleSegmentationReadiness.state === 'draft-only' ||
						peopleSegmentationReadiness.state === 'gated'
				},
				{
					href: emailListHealthReadiness.href,
					label: 'Consent-bound reach',
					sublabel: 'Subscriptions + suppression boundary',
					state: emailListHealthReadiness.state,
					signal: emailListHealthReadiness.signal,
					action: emailListHealthReadiness.action,
					gate: emailListHealthReadiness.gate,
					latent:
						emailListHealthReadiness.state === 'draft-only' ||
						emailListHealthReadiness.state === 'gated'
				},
				{
					href: `${base}/supporters/import#csv-intake`,
					label: 'Platform export intake',
					sublabel: 'CSV profiles',
					state: platformIntakeReadiness.state,
					signal: platformExportProfileSignal,
					action: 'open CSV intake',
					gate: platformIntakeReadiness.gate
				}
			]
		},
		{
			id: 'landscape',
			label: 'Power',
			gloss: 'Decision-makers and bills',
			href: `${base}/representatives`,
			icon: 'power',
			state: powerTerrainReadiness.state,
			signal: powerWorkspaceSignal,
			handoff: 'Power targets',
			effect: 'read decision-maker, bill, and score terrain',
			action: 'open Power targets',
			gate: powerTerrainReadiness.gate,
			gateSignal: powerTerrainReadiness.signal,
			secondary: [
				...(FEATURES.LEGISLATION
					? [
							{
								href: powerTargetTerrainRow?.href ?? `${base}/representatives`,
								label: 'Power targets',
								sublabel: 'Power terrain',
								state: powerTargetTerrainRow?.state ?? powerTerrainReadiness.state,
								signal: capabilityMetricSignal(powerTargetTerrainRow, powerTerrainReadiness.signal),
								action: powerTargetTerrainRow?.action ?? 'open Power targets',
								gate: powerTargetTerrainRow?.boundary ?? powerTerrainReadiness.gate
							},
							{
								href: powerBillsTerrainRow?.href ?? `${base}/legislation`,
								label: 'Bills terrain',
								sublabel: 'Watched bills',
								state: powerBillsTerrainRow?.state ?? ('gated' as const),
								signal: capabilityMetricSignal(powerBillsTerrainRow, 'unread bills'),
								action: powerBillsTerrainRow?.action ?? 'open bills terrain',
								gate: powerBillsTerrainRow?.boundary ?? powerTerrainReadiness.gate,
								latent: (powerBillsTerrainRow?.state ?? 'gated') === 'gated'
							},
							{
								href: legislativeMonitoringReadiness.href,
								label: 'Legislative monitoring',
								sublabel: 'Watchlists + agent boundary',
								state: legislativeMonitoringReadiness.state,
								signal: legislativeMonitoringReadiness.signal,
								action: legislativeMonitoringReadiness.action,
								gate: legislativeMonitoringReadiness.gate,
								latent:
									legislativeMonitoringReadiness.state === 'draft-only' ||
									legislativeMonitoringReadiness.state === 'gated'
							},
							{
								href: powerScoreTerrainRow?.href ?? `${base}/scorecards`,
								label: 'Accountability scores',
								sublabel: 'Accountability terrain',
								state: powerScoreTerrainRow?.state ?? ('gated' as const),
								signal: capabilityMetricSignal(powerScoreTerrainRow, 'unread scores'),
								action: powerScoreTerrainRow?.action ?? 'open accountability scores',
								gate: powerScoreTerrainRow?.boundary ?? powerTerrainReadiness.gate,
								latent:
									powerScoreTerrainRow?.state === 'draft-only' ||
									powerScoreTerrainRow?.state === 'gated'
							}
						]
					: [
							{
								href: powerTargetTerrainRow?.href ?? `${base}/representatives`,
								label: 'Power targets',
								sublabel: 'Power terrain',
								state: powerTargetTerrainRow?.state ?? ('partial' as const),
								signal: capabilityMetricSignal(powerTargetTerrainRow, powerTerrainReadiness.signal),
								action: powerTargetTerrainRow?.action ?? 'open Power targets',
								gate: powerTargetTerrainRow?.boundary ?? powerTerrainReadiness.gate
							}
						])
			]
		},
		{
			id: 'return',
			label: 'Results',
			gloss: 'Proof and response',
			// Results routes to the org root, where delivery metrics, responses,
			// and the Verification Packet now live as artifact.
			href: base,
			icon: 'results',
			state: resultsProofReadiness.state,
			signal: resultsWorkspaceSignal,
			handoff: 'Results proof',
			effect: 'read packet, receipt, and response evidence',
			action: resultsProofReadiness.action,
			gate: resultsProofReadiness.gate,
			gateSignal: resultsProofReadiness.signal,
			secondary: [
				{
					href: resultsProofReadiness.href,
					label: 'Results home',
					sublabel: 'Results readout',
					state: resultsProofReadiness.state,
					signal: resultsProofReadiness.signal,
					action: resultsProofReadiness.action,
					gate: resultsProofReadiness.gate
				},
				{
					href: `${base}/studio#capability-accountability-response`,
					label: 'Response evidence',
					sublabel: 'Reports + reader signals',
					state: accountabilityResponseReadiness.state,
					signal: accountabilityResponseReadiness.signal,
					action: accountabilityResponseReadiness.action,
					gate: accountabilityResponseReadiness.gate,
					latent:
						accountabilityResponseReadiness.state === 'draft-only' ||
						accountabilityResponseReadiness.state === 'gated'
				}
			]
		}
	]);

	// ─── Substrate — ambient, not a workspace ─────────────────────────
	const substrateLinks = $derived<OperatingGroundRoute[]>([
		{
			href: operatingAuthorityReadiness.href,
			label: 'Org authority',
			sublabel: 'RBAC, billing, API, registry',
			state: operatingAuthorityReadiness.state,
			signal: operatingAuthorityReadiness.signal,
			action: operatingAuthorityReadiness.action,
			gate: operatingAuthorityReadiness.gate
		},
		...(FEATURES.PUBLIC_API && signedWebhookAuthorityRow
			? [
					{
						href: signedWebhookAuthorityRow.href,
						label: 'Signed webhooks',
						sublabel: 'Signed event ground',
						state: signedWebhookAuthorityRow.state,
						signal: `${eventRecordsGate.completed}/${eventRecordsGate.total} event tasks`,
						action: signedWebhookAuthorityRow.action,
						gate: signedWebhookAuthorityRow.boundary
					}
				]
			: []),
		...(FEATURES.NETWORKS
			? [
					{
						href: coalitionReadiness.href,
						label: 'Coalition layer',
						sublabel: 'Network memberships + proof handoff',
						state: coalitionReadiness.state,
						signal: coalitionReadiness.signal,
						action: coalitionReadiness.action,
						gate: coalitionReadiness.gate
					}
				]
			: [])
	]);

	const capabilityDestinations = $derived<SpotlightDestination[]>([
		{
			id: 'capability-cluster-coverage',
			label: 'Capability coverage',
			sublabel: 'Nine clusters, current evidence',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-cluster-coverage`,
			state: clusterCoverageCommandState,
			signal: clusterCoverageCommandSignal,
			action: spotlightActionForState(clusterCoverageCommandState, 'read capability coverage'),
			gate: clusterCoverageCommandGate
		},
		{
			id: 'capability-state-ledger',
			label: 'Capability state ledger',
			sublabel: 'Armed, bounded, draft-only, not armed',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-state-ledger`,
			state: stateLedgerCommandState,
			signal: stateLedgerCommandSignal,
			action: spotlightActionForState(stateLedgerCommandState, 'read capability state ledger'),
			gate: stateLedgerCommandGate
		},
		{
			id: 'capability-grounded-authoring',
			label: 'Grounded authoring',
			sublabel: 'Source + target + artifact reasoning',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#studio-intent`,
			state: studioAuthoringCommandState,
			signal: studioAuthoringCommandSignal,
			action: spotlightActionForState(studioAuthoringCommandState, 'open Studio intent'),
			gate: studioAuthoringCommandGate
		},
		{
			id: 'capability-studio-scope-recovery',
			label: 'Studio scope and recovery',
			sublabel: 'Jurisdiction scope + recoverable output',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#studio-intent`,
			state: studioScopeCommandState,
			signal: studioScopeCommandSignal,
			action: spotlightActionForState(studioScopeCommandState, 'read Studio scope and recovery'),
			gate: studioScopeCommandGate
		},
		{
			id: 'capability-actions',
			label: 'Next moves',
			sublabel: 'Use, qualify, hold',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-actions`,
			state: nextMovesCommandState,
			signal: `${activeNextMoveBoundaryCount} boundaries · ${studioAuthoringBoundaryCount} authoring · ${studioScopeBoundaryCount} Studio · ${nextHeldMoveLabel}`,
			action: spotlightActionForState(nextMovesCommandState, 'read next moves'),
			gate: nextMovesGate
		},
		{
			id: 'capability-launch-vector',
			label: 'Launch vector',
			sublabel: 'First unblock + held surface',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-launch-vector`,
			state: launchVectorCommandState,
			signal: launchVectorCommandSignal,
			action: spotlightActionForState(launchVectorCommandState, 'read launch vector'),
			gate: launchVectorCommandGate
		},
		{
			id: 'capability-launch-pressure',
			label: 'Launch pressure',
			sublabel: 'First-org blockers',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#launch-pressure`,
			state: launchPressureCommandState,
			signal: `${launchPressureCount} unresolved`,
			action: spotlightActionForState(launchPressureCommandState, 'read launch pressure'),
			gate: launchPressureCount > 0 ? launchPressureGate : 'first-org pressure clear'
		},
		{
			id: 'capability-loop',
			label: 'Verified action loop',
			sublabel: 'Intent to aggregate',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-loop`,
			state: loopCommandState,
			signal: `${liveLoopPhaseCount}/${totalLoopPhaseCount} ${commandStateLabel('live')} phases`,
			action: spotlightActionForState(loopCommandState, 'read loop'),
			gate: [
				commandGate(delegationGate, 'Agentic execution remains dependency-first.'),
				commandGate(receiptAnchoringGate, 'Aggregate proof remains bounded.')
			].join(' ')
		},
		{
			id: 'capability-composition',
			label: 'Compound moves',
			sublabel: 'Cross-workspace capability paths',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-composition`,
			state: compositionCommandState,
			signal: `${partialCompositionPathCount}/4 ${commandStateLabel('partial')} paths · ${gatedCompositionPathCount} ${commandStateLabel('gated')} paths`,
			action: spotlightActionForState(compositionCommandState, 'read compound moves'),
			gate: compositionCommandGate
		},
		{
			id: 'capability-critical-path',
			label: 'Critical path',
			sublabel: 'Capability chokepoints',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-critical-path`,
			state: criticalPathCommandState,
			signal: criticalPathCommandSignal,
			action: spotlightActionForState(criticalPathCommandState, 'read critical path'),
			gate: criticalPathCommandGate
		},
		{
			id: 'capability-send',
			label: 'Send readiness',
			sublabel: 'Armed vs held handoffs',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-send`,
			state: sendCommandState,
			signal: `${browserDirectSendSignal} · ${heldSendModeSummary}`,
			action: spotlightActionForState(sendCommandState, 'read send readiness'),
			gate: sendReadinessGate
		},
		{
			id: 'capability-people-source-provenance',
			label: 'People source custody',
			sublabel: 'Origin custody + source-count basis',
			group: 'Capability',
			kind: 'route' as const,
			href: peopleSourceProvenanceReadiness.href,
			state: peopleSourceProvenanceReadiness.state,
			signal: peopleSourceProvenanceReadiness.signal,
			action: spotlightActionForState(
				peopleSourceProvenanceReadiness.state,
				peopleSourceProvenanceReadiness.action
			),
			gate: peopleSourceProvenanceReadiness.gate
		},
		{
			id: 'capability-people-segmentation',
			label: 'People segmentation posture',
			sublabel: 'Saved cohorts + civic geography boundary',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-people-segmentation`,
			state: peopleSegmentationReadiness.state,
			signal: peopleSegmentationReadiness.signal,
			action: spotlightActionForState(
				peopleSegmentationReadiness.state,
				'read segmentation posture'
			),
			gate: peopleSegmentationReadiness.gate
		},
		{
			id: 'capability-list-health',
			label: 'Consent-bound reach',
			sublabel: 'List health + suppression boundary',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-list-health`,
			state: emailListHealthReadiness.state,
			signal: emailListHealthReadiness.signal,
			action: spotlightActionForState(emailListHealthReadiness.state, 'read list health posture'),
			gate: emailListHealthReadiness.gate
		},
		{
			id: 'capability-legislative-monitoring',
			label: 'Legislative monitoring posture',
			sublabel: 'Bill watchlists + delegated monitoring gate',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-legislative-monitoring`,
			state: legislativeMonitoringReadiness.state,
			signal: legislativeMonitoringReadiness.signal,
			action: spotlightActionForState(
				legislativeMonitoringReadiness.state,
				'read monitoring posture'
			),
			gate: legislativeMonitoringReadiness.gate
		},
		{
			id: 'capability-fundraising',
			label: 'Donation receipt posture',
			sublabel: 'Funding intake + confirmation boundary',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-fundraising`,
			state: fundraisingReadiness.state,
			signal: fundraisingReadiness.signal,
			action: spotlightActionForState(fundraisingReadiness.state, 'read donation posture'),
			gate: fundraisingReadiness.gate
		},
		{
			id: 'capability-coordination',
			label: 'Coordination logic readiness',
			sublabel: 'Workflow definitions + execution boundary',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-coordination`,
			state: coordinationReadiness.state,
			signal: coordinationReadiness.signal,
			action: spotlightActionForState(coordinationReadiness.state, 'read coordination posture'),
			gate: coordinationReadiness.gate
		},
		{
			id: 'capability-coalition',
			label: 'Coalition composition posture',
			sublabel: 'Network memberships + proof handoff',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-coalition`,
			state: coalitionReadiness.state,
			signal: coalitionReadiness.signal,
			action: spotlightActionForState(coalitionReadiness.state, 'read coalition posture'),
			gate: coalitionReadiness.gate
		},
		{
			id: 'capability-text-delivery',
			label: 'Text delivery posture',
			sublabel: 'Phone consent + draft + dispatch boundary',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-text-delivery`,
			state: textDeliveryReadiness.state,
			signal: textDeliveryReadiness.signal,
			action: spotlightActionForState(textDeliveryReadiness.state, 'read text delivery posture'),
			gate: textDeliveryReadiness.gate
		},
		{
			id: 'capability-call-routing',
			label: 'Call routing posture',
			sublabel: 'Call records + caller-phone boundary',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-call-routing`,
			state: callRoutingReadiness.state,
			signal: callRoutingReadiness.signal,
			action: spotlightActionForState(callRoutingReadiness.state, 'read call routing posture'),
			gate: callRoutingReadiness.gate
		},
		{
			id: 'capability-accountability-response',
			label: 'Accountability response posture',
			sublabel: 'Reports + reader signals + score basis',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-accountability-response`,
			state: accountabilityResponseReadiness.state,
			signal: accountabilityResponseReadiness.signal,
			action: spotlightActionForState(
				accountabilityResponseReadiness.state,
				'read response posture'
			),
			gate: accountabilityResponseReadiness.gate
		},
		{
			id: 'capability-operating-authority',
			label: 'Operating authority',
			sublabel: 'RBAC + API + webhooks + registry',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-operating-authority`,
			state: operatingAuthorityReadiness.state,
			signal: operatingAuthorityReadiness.signal,
			action: spotlightActionForState(
				operatingAuthorityReadiness.state,
				'read operating authority'
			),
			gate: operatingAuthorityReadiness.gate
		},
		{
			id: 'capability-basis',
			label: 'Claim basis',
			sublabel: 'Why each claim is legitimate',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-basis`,
			state: basisCommandState,
			signal: basisCommandSignal,
			action: spotlightActionForState(basisCommandState, 'read claim basis'),
			gate: basisCommandGate
		},
		{
			id: 'capability-gates',
			label: 'Gate register',
			sublabel: 'Task hypergraph evidence',
			group: 'Capability',
			kind: 'route' as const,
			href: `${base}/studio#capability-gates`,
			state: loadBearingGate?.state ?? 'live',
			signal: loadBearingGate
				? `${loadBearingGate.gate.downstream} downstream blocked`
				: 'no unresolved gates',
			action: spotlightActionForState(loadBearingGate?.state ?? 'live', 'read gate register'),
			gate: loadBearingGateSummary
		}
	]);

	// Spotlight index — the recognition-over-recall navigation that replaces the
	// rail's old link cabinet. The four spaces SWITCH; folded handoffs + the
	// Substrate links NAVIGATE. Every command carries a handoff/effect
	// contract so the palette reads as an instrument, not a link cabinet.
	const destinations = $derived<SpotlightDestination[]>([
		...capabilityDestinations.map((d) => ({
			...d,
			handoff: d.handoff ?? d.label,
			effect: d.effect ?? d.sublabel ?? d.signal ?? d.gate
		})),
		...marks.map((m) => ({
			id: `space-${m.id}`,
			label: m.label,
			sublabel: m.gloss,
			group: 'Workspaces',
			kind: 'space' as const,
			spaceId: m.id,
			state: spotlightState(m.state),
			signal: signalText(m.signal),
			action: spotlightActionForState(spotlightState(m.state), 'switch'),
			handoff: `${m.label} workspace`,
			effect: `${m.gloss}; switches mounted ${m.label} workspace without remounting Studio work.`,
			gate: m.signal.cite
		})),
		...marks.flatMap((m) =>
			(m.secondary ?? []).map((s) => ({
				id: `route-${s.href}`,
				label: s.label,
				sublabel: s.sublabel,
				group: m.label,
				kind: 'route' as const,
				href: s.href,
				latent: s.latent ?? routeLatent(s.state),
				state: s.state,
				signal: s.signal,
				action: spotlightActionForState(s.state ?? 'live', s.action ?? 'open'),
				handoff: s.handoff ?? s.label,
				effect: s.effect ?? s.sublabel ?? s.signal ?? s.gate,
				gate: s.gate
			}))
		),
		...substrateLinks.map((s) => ({
			id: `sub-${s.href}`,
			label: s.label,
			sublabel: s.sublabel,
			group: 'Substrate',
			kind: 'route' as const,
			href: s.href,
			latent: s.latent,
			state: s.state,
			signal: s.signal,
			action: spotlightActionForState(s.state ?? 'live', s.action ?? 'open'),
			handoff: s.handoff ?? s.label,
			effect: s.effect ?? s.sublabel ?? s.signal ?? s.gate,
			gate: s.gate
		}))
	]);

	// Watermark — verified-live only (growth + tiers from getDashboardStats),
	// dormant when the layout query was unavailable. Never a fabricated zero.
	const watermark = $derived<{
		thisWeek: number | null;
		lastWeek: number | null;
		tiers: WatermarkTier[];
	}>(
		data.watermark
			? {
					thisWeek: data.watermark.thisWeek,
					lastWeek: data.watermark.lastWeek,
					tiers: data.watermark.tiers
				}
			: { thisWeek: null, lastWeek: null, tiers: [] }
	);

	const orgIdentity = $derived({
		name: data.org.name,
		slug: data.org.slug,
		avatar: data.org.avatar
	});

	const operatingGroundCapabilities = $derived<OperatingGroundCapability[]>([
		...operatingAuthorityGroundRows.map((row) =>
			operatingGroundFromReadiness(row, {
				label:
					row.id === 'public-api-ground'
						? 'Public API'
						: row.id === 'registry-environment'
							? 'Registry'
							: row.label,
				value: row.id === 'registry-environment' ? 'Sepolia testnet' : undefined,
				state: row.id === 'registry-environment' ? 'testnet' : undefined,
				gateSignal: row.id === 'registry-environment' ? 'testnet' : undefined
			})
		),
		operatingGroundFromReadiness(fundraisingReadiness, {
			label: 'Donation posture'
		}),
		operatingGroundFromReadiness(coordinationReadiness, {
			label: 'Coordination logic'
		}),
		operatingGroundFromReadiness(textDeliveryReadiness, {
			label: 'Text delivery',
			href: `${base}/studio#capability-text-delivery`
		}),
		operatingGroundFromReadiness(callRoutingReadiness, {
			label: 'Call routing',
			href: `${base}/studio#capability-call-routing`
		}),
		operatingGroundFromReadiness(coalitionReadiness, {
			label: 'Coalition layer'
		})
	]);
	const mantlePartialSurfaceCount = $derived(
		marks.filter((mark) => mark.state === 'partial').length +
			operatingGroundCapabilities.filter((item) => item.state === 'partial').length
	);
	const mantleDraftOnlyPressureCopy = $derived(
		sendReadiness.nextHeldMode
			? `${sendReadiness.heldModeSummary}; next held mode is ${sendReadiness.nextHeldLabel}. ${sendReadiness.nextHeldMode.effect}`
			: sendReadiness.sendBoundarySummary
	);
	const mantlePosturePressureCopy = $derived({
		gated: commandGate(
			loadBearingGate?.gate ?? delegationGate,
			'Load-bearing capability gate remains unresolved.'
		),
		testnet: commandGate(mainnetGate, 'Registry-backed claims remain testnet-bound.'),
		'draft-only': mantleDraftOnlyPressureCopy,
		partial: 'Usable surfaces are armed, with named trust or scope limits.',
		live: 'All visible surfaces are armed from current state.'
	});
	const mantlePosturePressureGate = $derived({
		gated: loadBearingGateSummary,
		testnet: commandGate(mainnetGate, 'Next registry unlock remains unresolved.'),
		'draft-only': sendReadiness.nextHeldMode
			? `${sendReadiness.nextHeldLabel}: ${sendReadiness.nextHeldGate}`
			: sendReadiness.sendBoundaryGate,
		partial: loadBearingGateSummary,
		live: 'No unresolved visible-surface gate.'
	});
	const mantlePosturePressureSignal = $derived({
		gated: loadBearingGate
			? compactGateSignal(loadBearingGate.gate)
			: compactGateSignal(delegationGate),
		testnet: compactGateSignal(mainnetGate),
		'draft-only': sendReadiness.nextHeldMode
			? sendReadiness.nextHeldLabel
			: `${heldSendModeCount} held modes`,
		partial: `${mantlePartialSurfaceCount} bounded`,
		live: 'all armed'
	});

	// Measured height of the fixed mobile header, so the main content clears it
	// exactly — no magic spacer that clips a tall header or over-pads a short one.
	let mobileHeaderHeight = $state(0);

	// Single global Spotlight keybinding (⌘K / Ctrl-K). One owner — the layout —
	// so the two Mantle variants (rail + mobile header) never double-toggle it.
	function onSpotlightKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			os.toggleSpotlight();
		}
	}
</script>

<svelte:window onkeydown={onSpotlightKey} />

<div class="flex min-h-screen">
	<!-- Mantle — desktop rail (persistent authoring-first frame) -->
	<aside class="hidden md:block">
		<OrgMantle
			org={orgIdentity}
			role={data.membership.role}
			{marks}
			{substrateLinks}
			signalEvents={data.signalEvents}
			{operatingGroundCapabilities}
			posturePressureCopy={mantlePosturePressureCopy}
			posturePressureGate={mantlePosturePressureGate}
			posturePressureSignal={mantlePosturePressureSignal}
			{studioAuthoringReadiness}
			{watermark}
			variant="rail"
		/>
	</aside>

	<!-- Mantle — mobile header (same instrument, reduced density) -->
	<div class="fixed top-0 right-0 left-0 z-40 md:hidden" bind:clientHeight={mobileHeaderHeight}>
		<OrgMantle
			org={orgIdentity}
			role={data.membership.role}
			{marks}
			{substrateLinks}
			signalEvents={data.signalEvents}
			{operatingGroundCapabilities}
			posturePressureCopy={mantlePosturePressureCopy}
			posturePressureGate={mantlePosturePressureGate}
			posturePressureSignal={mantlePosturePressureSignal}
			{studioAuthoringReadiness}
			{watermark}
			variant="header"
		/>
	</div>

	<!-- Main content — warm cream ground (design system surface). Mobile pad
	     clears the fixed header by its measured height (0 on desktop, where the
	     header is hidden and the rail is in-flow). -->
	<main
		class="min-w-0 flex-1"
		style="padding-top: {mobileHeaderHeight}px; background: oklch(0.995 0.004 55);"
	>
		<div class="org-main-frame" class:org-main-frame--space={onSpacePath}>
			<!--
			  OrgShell holds the four spaces MOUNTED at once; switching is an instant
			  state toggle (no remount), so the in-flight STUDIO authoring process
			  keeps streaming across space switches. It stays mounted across every
			  deep-route navigation too. On a canonical space path we show the shell;
			  on a deep route we render that route's page below it (shell hidden, state
			  preserved) so every existing route stays reachable.
			-->
			<div class:org-shell-hidden={!onSpacePath}>
				<OrgShell {base} {canPublish} role={data.membership.role} spaces={data.spaces} />
			</div>
			{#if !onSpacePath}
				{@render children()}
			{/if}
		</div>
	</main>
</div>

<!-- Spotlight — one palette, shell-level (outside the hideable OrgShell so it is
     reachable from every space AND every deep route). Carries the navigation the
     rail's link cabinet used to. -->
<Spotlight {destinations} {base} />

<style>
	/* Keep OrgShell MOUNTED (state + STUDIO process alive) but visually out of the
	   way when the operator is on a deep route. Not removed — hidden. */
	.org-shell-hidden {
		display: none;
	}

	main {
		overflow-x: clip;
	}

	.org-main-frame {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		max-width: 64rem;
		overflow-x: clip;
		padding: 1.5rem;
	}

	.org-main-frame--space {
		max-width: none;
	}

	@media (min-width: 768px) {
		.org-main-frame {
			padding: 2rem;
		}

		.org-main-frame--space {
			max-width: 88rem;
		}
	}
</style>
