/**
 * Space data shapes — the contract between the org-OS layout load and the
 * mounted space components.
 *
 * The four visible workspaces — Studio, People, Power, Results — are mounted at
 * once. Switching is a pure state toggle, not a navigation, so a workspace
 * switch must NOT re-run a route load. Each workspace's data is loaded ONCE in
 * `routes/org/[slug]/+layout.server.ts` and threaded into the components as
 * props. These types are the shared contract so both ends agree on shape without
 * the components importing server code.
 *
 * STUDIO is intentionally absent: it renders the live process registry, not
 * server-loaded data.
 *
 * HONESTY RULE: every field here is REAL signal the backend actually carries. A
 * `null` slice means "this read was unread / dormant," rendered as an
 * honest empty state — never a fabricated zero.
 */

import type { VerificationPacket } from '$lib/types/verification-packet';

// ─── Results: proof and response ─────────────────────────────────────────

export type ReturnSpaceCampaign = {
	id: string;
	title: string;
	type: string;
	status: string;
	totalActions: number;
	verifiedActions: number;
	updatedAt: string;
};

export type ReturnSpaceReceiptSummary = {
	loadedCount: number;
	pendingCount: number;
	responseLoggedCount: number;
	anchorFieldCount: number;
	proofWeightTotal: number;
	latestProofDeliveredAt: string | null;
	sampleLimit: number;
};

export type ReturnSpaceData = {
	funnel: {
		imported: number;
		postalResolved: number;
		identityVerified: number;
		districtVerified: number;
	};
	tiers: Array<{ tier: number; label: string; count: number }>;
	growth: { thisWeek: number; lastWeek: number };
	campaigns: ReturnSpaceCampaign[];
	topCampaignId: string | null;
	packet: VerificationPacket | null;
	stats: {
		supporters: number;
		campaigns: number;
		activeCampaigns: number;
		members: number;
		sentEmails: number;
	};
	receipts: ReturnSpaceReceiptSummary;
};

// ─── People: proof-weighted reach ─────────────────────────────────────────

export type BaseSpaceData = {
	total: number;
	imported: number;
	sourceCounts: Record<string, number>;
	postalResolved: number;
	districtVerified: number;
	identityVerified: number;
	emailHealth: {
		subscribed: number;
		unsubscribed: number;
		bounced: number;
		complained: number;
	};
	smsHealth: {
		subscribed: number;
		unsubscribed: number;
		stopped: number;
		none: number;
		phonePresent: number;
	};
	consentEvidence: {
		email: number;
		emailSubscribed: number;
		sms: number;
		smsSubscribed: number;
	};
	segmentation: PeopleSegmentationGroundData | null;
};

export type PeopleSegmentationGroundData = {
	segmentCount: number;
	conditionCount: number;
	tagConditionCount: number;
	verificationConditionCount: number;
	sourceConditionCount: number;
	emailStatusConditionCount: number;
	dateConditionCount: number;
	postalCountryConditionCount: number;
	stateCodeConditionCount: number;
	congressionalDistrictConditionCount: number;
	campaignParticipationConditionCount: number;
	actionDistrictHashConditionCount: number;
	actionDistrictLabelConditionCount: number;
	engagementTierConditionCount: number;
	humanReadableGeographyConditionCount: number;
};

// ─── Power: targets, bills, and accountability ───────────────────────────

export type LandscapeDecisionMaker = {
	id: string;
	reason: string;
	name: string;
	party: string | null;
	title: string | null;
	jurisdiction: string | null;
	district: string | null;
};

export type LandscapeBill = {
	id: string;
	title: string;
	externalId: string;
	status: string;
	jurisdiction: string;
	position: string | null;
};

export type LandscapeScorecard = {
	name: string;
	title: string;
	district: string;
	reportsReceived: number;
	reportsOpened: number | null;
	verifyLinksClicked: number | null;
	repliesLogged: number | null;
	relevantVotes: number | null;
	alignedVotes: number | null;
	alignmentRate: number | null;
	avgResponseTime: number | null;
	lastContactDate: string | null;
	score: number | null;
	proofWeighted: null;
};

export type LandscapeSpaceData = {
	legislationEnabled: boolean;
	followed: LandscapeDecisionMaker[];
	followedCount: number;
	bills: LandscapeBill[];
	relevantBillCount: number | null;
	positionedBillCount: number | null;
	scorecards: LandscapeScorecard[];
	scorecardSnapshotCount: number;
	scorecardAvg: number | null;
};

// ─── SUBSTRATE — ambient org facts ─────────────────────────────────────

export type OperatingGroundData = {
	authoring: AuthoringRuntimeGroundData;
	emailDelivery: {
		subscribedCount: number;
		clientDirectThreshold: number;
		sesProxyConfigured: boolean;
		orgKeyConfigured: boolean;
		serverDispatchRuntimeReady: boolean;
		serverDispatchRuntimeMissing: string[];
		serverDispatchRuntimeDependency: string;
		serverDispatchRuntimeMessage: string;
	};
	platformApiSync: PlatformApiSyncGroundData;
	textDelivery: TextDeliveryGroundData | null;
	callRouting: CallRoutingGroundData | null;
	congressionalDelivery: CongressionalDeliveryGroundData | null;
	fundraising: FundraisingGroundData | null;
	coordination: CoordinationGroundData | null;
	coalition: CoalitionGroundData | null;
};

export type AuthoringRuntimeGroundData = {
	runtimeReady: boolean;
	modelProviderConfigured: boolean;
	sourceSearchConfigured: boolean;
	sourceFetchConfigured: boolean;
	runtimeMissing: string[];
	runtimeDependency: string;
	runtimeMessage: string;
};

export type PlatformApiSyncGroundData = {
	runtimeReady: boolean;
	credentialCustodyReady: boolean;
	credentialStored: boolean;
	credentialProbeComplete: boolean;
	credentialProbeCompletedAt: string | null;
	adapterSource: string | null;
	profileCount: number;
	runnerImplemented: boolean;
	armedAdapterSources: string[];
	runtimeMissing: string[];
	runtimeDependency: string;
	runtimeMessage: string;
	runtimeFlag: 'closed' | 'custody_ready_without_runner' | 'ready';
};

export type TextDeliveryGroundData = {
	draftCount: number;
	plannedRecipientCount: number;
	sentCount: number;
	deliveredCount: number;
	failedCount: number;
	messageCount: number;
	replyCount: number;
	dispatchRuntimeReady: boolean;
	dispatchRuntimeMissing: string[];
	dispatchRuntimeDependency: string;
	dispatchRuntimeMessage: string;
	dispatchRunnerImplemented: boolean;
	dispatchClientBatchRouteMounted: boolean;
};

export type CallRoutingGroundData = {
	callCount: number;
	completedCallCount: number;
	campaignCount: number;
	twilioConfigured: boolean;
	canManageCalls: boolean;
	initiationRuntimeReady: boolean;
	initiationRuntimeMissing: string[];
	initiationRuntimeDependency: string;
	initiationRuntimeMessage: string;
	initiationSurfaceMounted: boolean;
	initiationProxyImplemented: boolean;
};

export type CongressionalDeliveryGroundData = {
	runtimeReady: boolean;
	runtimeMissing: string[];
	runtimeDependency: string;
	runtimeMessage: string;
	launched: boolean;
	houseTransportConfigured: boolean;
	senateTransportConfigured: boolean;
};

export type FundraisingGroundData = {
	fundraiserCount: number;
	activeCount: number;
	raisedAmountCents: number;
	donationCount: number;
	receiptPolicyCount: number;
	confirmation: {
		completed: number;
		sent: number;
		sending: number;
		skipped: number;
		failed: number;
		notRecorded: number;
		attempted: number;
		providerAccepted: number;
	};
};

export type CoordinationGroundData = {
	definitionCount: number;
	enabledCount: number;
	triggerFamilyCount: number;
	plannedStepCount: number;
	emailStepCount: number;
	tagStepCount: number;
	conditionStepCount: number;
	runEvidenceCount: number;
};

export type CoalitionGroundData = {
	activeNetworkCount: number;
	pendingInviteCount: number;
	activeMemberRows: number;
	topActiveNetworkId: string | null;
};

// ─── Bundle — the per-space slices the layout returns ────────────────────

export type OrgSpacesData = {
	return: ReturnSpaceData | null;
	base: BaseSpaceData | null;
	landscape: LandscapeSpaceData | null;
	operating: OperatingGroundData | null;
};
