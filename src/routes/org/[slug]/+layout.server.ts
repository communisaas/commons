import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { computeVerificationPacketCached } from '$lib/server/verification-packet';
import { getCallInitiationReadiness } from '$lib/server/calls/call-initiation-readiness';
import { getMessageGenerationReadiness } from '$lib/server/agents/message-generation-readiness';
import { getEmailServerDispatchReadiness } from '$lib/server/email/server-dispatch-readiness';
import { getPlatformApiSyncReadiness } from '$lib/server/platform-api-sync-readiness';
import { getTextDispatchReadiness } from '$lib/server/sms/text-dispatch-readiness';
import { CLIENT_DIRECT_EMAIL_THRESHOLD } from '$lib/data/org-limit-sentences';
import type { Id } from '$convex/_generated/dataModel';
import type {
	ReturnSpaceData,
	BaseSpaceData,
	LandscapeSpaceData,
	LandscapeDecisionMaker,
	LandscapeBill,
	FundraisingGroundData,
	CoordinationGroundData,
	AuthoringRuntimeGroundData,
	PlatformApiSyncGroundData,
	TextDeliveryGroundData,
	CallRoutingGroundData,
	CongressionalDeliveryGroundData,
	CoalitionGroundData,
	PeopleSegmentationGroundData,
	OrgSpacesData
} from '$lib/components/org/os/spaces';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNumberRecord(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object') return {};
	return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>(
		(record, [key, count]) => {
			if (typeof key === 'string' && typeof count === 'number' && Number.isFinite(count)) {
				record[key] = count;
			}
			return record;
		},
		{}
	);
}

function asNumberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asIso(value: unknown): string {
	return typeof value === 'number'
		? new Date(value).toISOString()
		: asString(value, new Date().toISOString());
}

function segmentConditionsFromFilters(filters: unknown): Record<string, unknown>[] {
	if (!filters || typeof filters !== 'object') return [];
	const conditions = (filters as { conditions?: unknown }).conditions;
	if (!Array.isArray(conditions)) return [];
	return conditions.filter(
		(condition): condition is Record<string, unknown> =>
			Boolean(condition) && typeof condition === 'object'
	);
}

function segmentConditionCount(
	conditions: Record<string, unknown>[],
	fields: readonly string[]
): number {
	const fieldSet = new Set(fields);
	return conditions.filter((condition) => fieldSet.has(asString(condition.field))).length;
}

function buildPeopleSegmentationGround(
	segments: Record<string, unknown>[]
): PeopleSegmentationGroundData {
	const conditions = segments.flatMap((segment) => segmentConditionsFromFilters(segment.filters));

	return {
		segmentCount: segments.length,
		conditionCount: conditions.length,
		tagConditionCount: segmentConditionCount(conditions, ['tag']),
		verificationConditionCount: segmentConditionCount(conditions, ['verification']),
		sourceConditionCount: segmentConditionCount(conditions, ['source']),
		emailStatusConditionCount: segmentConditionCount(conditions, ['emailStatus']),
		dateConditionCount: segmentConditionCount(conditions, ['dateRange']),
		postalCountryConditionCount: segmentConditionCount(conditions, ['postalCode', 'country']),
		stateCodeConditionCount: segmentConditionCount(conditions, ['stateCode']),
		congressionalDistrictConditionCount: segmentConditionCount(conditions, [
			'congressionalDistrict'
		]),
		campaignParticipationConditionCount: segmentConditionCount(conditions, [
			'campaignParticipation'
		]),
		actionDistrictHashConditionCount: segmentConditionCount(conditions, ['actionDistrict']),
		actionDistrictLabelConditionCount: segmentConditionCount(conditions, ['actionDistrictLabel']),
		engagementTierConditionCount: segmentConditionCount(conditions, ['engagementTier']),
		humanReadableGeographyConditionCount: segmentConditionCount(conditions, [
			'state',
			'stateCode',
			'district',
			'congressionalDistrict',
			'actionDistrictLabel',
			'stateLegislativeDistrict',
			'localDistrict',
			'specialDistrict',
			'civicGeography'
		])
	};
}

function messageGenerationEnv() {
	return {
		GEMINI_API_KEY: privateEnv.GEMINI_API_KEY,
		EXA_API_KEY: privateEnv.EXA_API_KEY,
		FIRECRAWL_API_KEY: privateEnv.FIRECRAWL_API_KEY
	};
}

function emailServerDispatchEnv() {
	return {
		AWS_ACCESS_KEY_ID: privateEnv.AWS_ACCESS_KEY_ID,
		AWS_SECRET_ACCESS_KEY: privateEnv.AWS_SECRET_ACCESS_KEY,
		UNSUBSCRIBE_SECRET: privateEnv.UNSUBSCRIBE_SECRET,
		PUBLIC_BASE_URL: env.PUBLIC_BASE_URL
	};
}

type KVNamespace = {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

/**
 * Org-OS layout load — the ONE load that hydrates the persistent shell.
 *
 * The four workspaces (Studio / People / Power / Results) are MOUNTED at once and
 * switching between them is a pure state toggle, never a navigation. So a space
 * switch must NOT trigger a route load. The data each space renders is therefore
 * loaded HERE, once per real navigation, and threaded into the spaces as props
 * via OrgShell. (STUDIO is the exception — it's driven by the live process
 * registry, not server data.)
 *
 * Each space's slice is loaded BEST-EFFORT: a transient failure (or a
 * configuration-gated/empty surface) resolves to null, so one space's hiccup can never
 * 500 the whole shell. The spaces render honest empty/dormant states on null.
 * The deep routes (/supporters, /representatives, …) keep their own loads, so
 * they stay independently resolvable; this layer only feeds the mounted shell.
 */
export const load: LayoutServerLoad = async ({ params, locals, platform }) => {
	if (!locals.user) {
		throw redirect(302, `/auth/google?returnTo=/org/${params.slug}`);
	}

	const result = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });

	if (!result) {
		// No org context found — redirect to home
		throw redirect(302, '/');
	}

	const slug = params.slug;

	// ─── RESULTS proof posture + watermark ────────────────────────────
	// Reuses the org-root page load's Convex calls. dashboardStats also feeds the
	// Mantle watermark, so we share the one query.
	const [dashboard, dashboardStats, receiptSummary] = await Promise.all([
		serverQuery(api.organizations.getDashboard, { slug }).catch(() => null),
		serverQuery(api.organizations.getDashboardStats, { slug }).catch(() => null),
		FEATURES.ACCOUNTABILITY
			? serverQuery(api.legislation.getOrgReceiptSummary, { slug, limit: 200 }).catch(() => null)
			: Promise.resolve(null)
	]);

	const watermark = dashboardStats
		? {
				thisWeek: dashboardStats.growth.thisWeek,
				lastWeek: dashboardStats.growth.lastWeek,
				tiers: dashboardStats.tiers.map((t: { tier: number; count: number }) => ({
					tier: t.tier,
					count: t.count
				}))
			}
		: null;

	// ─── PEOPLE verification and reach summary ────────────────────────
	// Pipeline + email-health summary for the BASE surface. The full supporter
	// table (paginated, filterable, with PII decryption) stays on the /supporters
	// deep route; BASE surfaces the pipeline signal + a link in.
	const [supporterSummary, districtVerifiedResult, orgKeyResult, segmentsResult] = await Promise.all([
		serverQuery(api.supporters.getSummaryStats, {
			orgSlug: slug
		}).catch(() => null),
		// District-of-record is set cardinality, served by a separate bounded
		// query (not the always-on funnel summary). Null-safe so a failure or an
		// org with no district signal just shows 0.
		serverQuery(api.supporters.getDistrictVerifiedCount, {
			orgSlug: slug
		}).catch(() => null),
		serverQuery(api.organizations.getOrgKeyVerifier, { slug }).catch(() => null),
		serverQuery(api.segments.list, { slug }).catch(() => null)
	]);

	// ─── OPERATING GROUND (fundraising posture, no donor PII) ──────────
	// The deep fundraising routes own donor lists and mutations. The shell only
	// loads aggregate fundraiser/donation posture for the bounded action notices,
	// without fabricating receipt or donor identity claims.
	const [
		fundraiserResult,
		donationConfirmationSummary,
		workflowResult,
		smsBlastResult,
		smsReplySummary,
		callResult,
		congressionalDeliveryResult,
		networkResult,
		signalEventsResult,
		platformApiStateResult
	] = await Promise.all([
		FEATURES.FUNDRAISING
			? serverQuery(api.donations.listByOrgWithDonors, {
					orgSlug: slug,
					limit: 100,
					cursor: null
				}).catch(() => null)
			: Promise.resolve(null),
		FEATURES.FUNDRAISING
			? serverQuery(api.donations.getConfirmationSummary, { orgSlug: slug }).catch(() => null)
			: Promise.resolve(null),
		FEATURES.AUTOMATION
			? serverQuery(api.workflows.list, { slug }).catch(() => null)
			: Promise.resolve(null),
		FEATURES.SMS
			? serverQuery(api.sms.listBlasts, { slug, limit: 100 }).catch(() => null)
			: Promise.resolve(null),
		FEATURES.SMS
			? serverQuery(api.sms.getReplySummary, { slug }).catch(() => null)
			: Promise.resolve(null),
		FEATURES.SMS
			? serverQuery(api.calls.listCalls, { slug, limit: 200 }).catch(() => null)
			: Promise.resolve(null),
		serverQuery(api.submissions.getCongressionalDeliveryReadiness, {}).catch(() => null),
		FEATURES.NETWORKS
			? serverQuery(api.networks.list, { orgSlug: slug }).catch(() => null)
			: Promise.resolve(null),
		serverQuery(api.orgWebhooks.sessionListRecentEvents, { slug, limit: 8 }).catch(() => null),
		serverQuery(api.organizations.getPlatformApiState, { slug }).catch(() => null)
	]);

	// ─── LANDSCAPE (decision-makers + watched bills + scorecards) ─────
	// The followed/watched/tracked terrain, folded into one surface. Search and
	// mutation tooling stays on deep routes; the shell only reads aggregate
	// relevance/position posture so monitoring claims do not drift.
	// Legislation-gated reads short-circuit to null when the feature is off,
	// matching the deep routes' 404/redirect.
	const [dmFollows, watchedBills, relevantBills, scorecardResult] = await Promise.all([
		serverQuery(api.legislation.listOrgDmFollows, { slug, limit: 12 }).catch(() => null),
		FEATURES.LEGISLATION
			? serverQuery(api.legislation.listWatchedBills, { slug, limit: 10 }).catch(() => null)
			: Promise.resolve(null),
		FEATURES.LEGISLATION
			? serverQuery(api.legislation.listRelevantBills, { slug, limit: 10 }).catch(() => null)
			: Promise.resolve(null),
		FEATURES.LEGISLATION
			? serverQuery(api.legislation.listOrgScorecards, {
					slug,
					sortBy: 'score',
					minReports: 1
				}).catch(() => null)
			: Promise.resolve(null)
	]);

	// ─── Compose RETURN space data (mirrors the org-root page mapping) ─
	let returnSpace: ReturnSpaceData | null = null;
	if (dashboard && dashboardStats) {
		const campaigns = (dashboard.recentCampaigns ?? []).map((c: Record<string, unknown>) => ({
			id: asString(c._id),
			title: asString(c.title, 'Untitled campaign'),
			type: asString(c.type),
			status: asString(c.status, 'DRAFT'),
			totalActions: asNumber(c.actionCount),
			verifiedActions: asNumber(c.verifiedActionCount),
			updatedAt: asIso(c.updatedAt)
		}));

		const activeCampaignCount = campaigns.filter((c) => c.status === 'ACTIVE').length;
		const topCampaignId =
			(campaigns.find((c) => c.status === 'ACTIVE') || campaigns[0])?.id ?? null;

		// Verification packet for the org's top campaign. Null on new orgs.
		const packet =
			topCampaignId && dashboard.org?._id
				? await computeVerificationPacketCached(
						topCampaignId as Id<'campaigns'>,
						dashboard.org._id as Id<'organizations'>,
						(platform as { env?: { KV?: KVNamespace } })?.env?.KV
					).catch(() => null)
				: null;

		returnSpace = {
			funnel: dashboardStats.funnel,
			tiers: dashboardStats.tiers,
			growth: dashboardStats.growth,
			campaigns,
			topCampaignId,
			packet,
			stats: {
				supporters: dashboard.stats?.supporters ?? 0,
				campaigns: dashboard.stats?.campaigns ?? 0,
				activeCampaigns: activeCampaignCount,
				members: dashboard.stats?.members ?? 0,
				sentEmails: dashboard.stats?.sentEmails ?? 0
			},
			receipts: {
				loadedCount: asNumber(receiptSummary?.loadedCount),
				pendingCount: asNumber(receiptSummary?.pendingCount),
				responseLoggedCount: asNumber(receiptSummary?.responseLoggedCount),
				anchorFieldCount: asNumber(receiptSummary?.anchorFieldCount),
				proofWeightTotal: asNumber(receiptSummary?.proofWeightTotal),
				latestProofDeliveredAt:
					typeof receiptSummary?.latestProofDeliveredAt === 'number'
						? new Date(receiptSummary.latestProofDeliveredAt).toISOString()
						: null,
				sampleLimit: asNumber(receiptSummary?.sampleLimit, 200)
			}
		};
	}

	// ─── Compose BASE space data ──────────────────────────────────────
	const baseSpace: BaseSpaceData | null = supporterSummary
		? {
				total: asNumber(supporterSummary.total),
				imported: asNumber(supporterSummary.imported),
				sourceCounts: asNumberRecord(supporterSummary.sourceCounts),
				postalResolved: asNumber(supporterSummary.postalResolved),
				districtVerified: asNumber(districtVerifiedResult?.districtVerified),
				districtVerifiedTruncated: Boolean(districtVerifiedResult?.truncated),
				identityVerified: asNumber(supporterSummary.identityVerified),
				emailHealth: {
					subscribed: asNumber(supporterSummary.emailHealth?.subscribed),
					unsubscribed: asNumber(supporterSummary.emailHealth?.unsubscribed),
					bounced: asNumber(supporterSummary.emailHealth?.bounced),
					complained: asNumber(supporterSummary.emailHealth?.complained)
				},
				smsHealth: {
					subscribed: asNumber(supporterSummary.smsHealth?.subscribed),
					unsubscribed: asNumber(supporterSummary.smsHealth?.unsubscribed),
					stopped: asNumber(supporterSummary.smsHealth?.stopped),
					none: asNumber(supporterSummary.smsHealth?.none),
					phonePresent: asNumber(supporterSummary.smsHealth?.phonePresent)
				},
				consentEvidence: {
					email: asNumber(supporterSummary.consentEvidence?.email),
					emailSubscribed: asNumber(supporterSummary.consentEvidence?.emailSubscribed),
					sms: asNumber(supporterSummary.consentEvidence?.sms),
					smsSubscribed: asNumber(supporterSummary.consentEvidence?.smsSubscribed)
				},
				segmentation: Array.isArray(segmentsResult?.segments)
					? buildPeopleSegmentationGround(segmentsResult.segments as Record<string, unknown>[])
					: null
			}
		: null;
	const emailServerDispatchReadiness = getEmailServerDispatchReadiness(emailServerDispatchEnv(), {
		orgKeyConfigured: Boolean(orgKeyResult?.orgKeyVerifier)
	});
	const messageGenerationReadiness = getMessageGenerationReadiness(messageGenerationEnv());
	const authoringGround: AuthoringRuntimeGroundData = {
		runtimeReady: messageGenerationReadiness.ready,
		modelProviderConfigured: messageGenerationReadiness.modelProviderConfigured,
		sourceSearchConfigured: messageGenerationReadiness.sourceSearchConfigured,
		sourceFetchConfigured: messageGenerationReadiness.sourceFetchConfigured,
		runtimeMissing: messageGenerationReadiness.missing,
		runtimeDependency: messageGenerationReadiness.dependency,
		runtimeMessage: messageGenerationReadiness.message
	};
	const platformApiSyncReadiness = getPlatformApiSyncReadiness();
	const platformApiSyncGround: PlatformApiSyncGroundData = {
		runtimeReady: platformApiSyncReadiness.ready,
		credentialCustodyReady: platformApiSyncReadiness.credentialCustodyReady,
		credentialStored: Boolean(platformApiStateResult?.credentialStoredAt),
		credentialProbeComplete: Boolean(platformApiStateResult?.credentialProbeCompletedAt),
		credentialProbeCompletedAt: platformApiStateResult?.credentialProbeCompletedAt
			? new Date(platformApiStateResult.credentialProbeCompletedAt).toISOString()
			: null,
		adapterSource:
			typeof platformApiStateResult?.adapterSource === 'string'
				? platformApiStateResult.adapterSource
				: null,
		profileCount: platformApiSyncReadiness.profileCount,
		runnerImplemented: platformApiSyncReadiness.runnerImplemented,
		armedAdapterSources: platformApiSyncReadiness.armedAdapterSources,
		runtimeMissing: platformApiSyncReadiness.missing,
		runtimeDependency: platformApiSyncReadiness.dependency,
		runtimeMessage: platformApiSyncReadiness.message,
		runtimeFlag: platformApiSyncReadiness.runtimeFlag
	};
	const textDispatchReadiness = getTextDispatchReadiness(
		{
			TWILIO_ACCOUNT_SID: privateEnv.TWILIO_ACCOUNT_SID,
			TWILIO_AUTH_TOKEN: privateEnv.TWILIO_AUTH_TOKEN,
			TWILIO_PHONE_NUMBER: privateEnv.TWILIO_PHONE_NUMBER
		},
		{ featureEnabled: FEATURES.SMS_DISPATCH }
	);

	// ─── Compose LANDSCAPE space data ─────────────────────────────────
	const followed = (dmFollows?.followed ?? [])
		.map((f: Record<string, unknown>) => {
			const dm = f.decisionMaker as Record<string, unknown> | null;
			if (!dm) return null;
			return {
				id: asString(f._id),
				reason: asString(f.reason, 'manual'),
				name: asString(dm.name, 'Unknown'),
				party: typeof dm.party === 'string' ? dm.party : null,
				title: typeof dm.title === 'string' ? dm.title : null,
				jurisdiction: typeof dm.jurisdiction === 'string' ? dm.jurisdiction : null,
				district: typeof dm.district === 'string' ? dm.district : null
			};
		})
		.filter((x): x is LandscapeDecisionMaker => x !== null);

	const bills = (watchedBills ?? [])
		.map((w: Record<string, unknown>) => {
			const bill = w.bill as Record<string, unknown> | null;
			if (!bill) return null;
			return {
				id: asString(w._id),
				title: asString(bill.title, 'Untitled bill'),
				externalId: asString(bill.externalId),
				status: asString(bill.status),
				jurisdiction: asString(bill.jurisdiction),
				position: typeof w.position === 'string' ? w.position : null
			};
		})
		.filter((x): x is LandscapeBill => x !== null);
	const relevantBillCount = Array.isArray(relevantBills) ? relevantBills.length : null;
	const positionedBillCount = Array.isArray(watchedBills)
		? bills.filter((bill) => bill.position).length
		: null;

	const scorecards = (scorecardResult?.scorecards ?? []).map((s: Record<string, unknown>) => {
		const dm = s.decisionMaker as Record<string, unknown> | undefined;
		const sc = s.scorecard as Record<string, unknown> | undefined;
		const composite = asNumberOrNull(sc?.composite);
		const responsiveness = asNumberOrNull(sc?.responsiveness);
		return {
			name: asString(dm?.name, 'Unknown'),
			title: asString(dm?.title),
			district: asString(dm?.district),
			reportsReceived: asNumber(sc?.deliveriesSent, asNumber(s.receiptCount)),
			reportsOpened: asNumberOrNull(sc?.deliveriesOpened),
			verifyLinksClicked: asNumberOrNull(sc?.deliveriesVerified),
			repliesLogged: asNumberOrNull(sc?.repliesReceived),
			relevantVotes: asNumberOrNull(sc?.totalScoredVotes),
			alignedVotes: asNumberOrNull(sc?.alignedVotes),
			alignmentRate: asNumberOrNull(sc?.alignment),
			avgResponseTime:
				responsiveness !== null ? Math.round((1 - responsiveness) * 168 * 10) / 10 : null,
			lastContactDate: typeof sc?.periodEnd === 'string' ? sc.periodEnd : null,
			score: composite !== null ? Math.round(composite * 100) : null,
			proofWeighted: null
		};
	});
	const scoredScorecards = scorecards.filter((scorecard) => scorecard.score !== null);

	// LANDSCAPE is present whenever ANY of its three reads resolved — even empty,
	// so the surface can render honest empty states. Null only when DM follows
	// (the always-available read) failed entirely.
	const landscapeSpace: LandscapeSpaceData | null = dmFollows
		? {
				legislationEnabled: FEATURES.LEGISLATION,
				followed,
				followedCount: asNumber(dmFollows.followedCount, followed.length),
				bills,
				relevantBillCount,
				positionedBillCount,
				scorecards,
				scorecardSnapshotCount: scoredScorecards.length,
				scorecardAvg:
					scoredScorecards.length > 0
						? Math.round(
								scoredScorecards.reduce((sum, scorecard) => sum + (scorecard.score ?? 0), 0) /
									scoredScorecards.length
							)
						: null
			}
		: null;

	const fundraisingRows = fundraiserResult?.data ?? null;
	const fundraisingGround: FundraisingGroundData | null =
		FEATURES.FUNDRAISING && (fundraisingRows || donationConfirmationSummary)
			? {
					fundraiserCount: fundraisingRows?.length ?? 0,
					activeCount:
						fundraisingRows?.filter((f: Record<string, unknown>) => f.status === 'ACTIVE').length ??
						0,
					raisedAmountCents:
						fundraisingRows?.reduce(
							(sum: number, f: Record<string, unknown>) => sum + asNumber(f.raisedAmountCents),
							0
						) ?? 0,
					donationCount:
						fundraisingRows?.reduce(
							(sum: number, f: Record<string, unknown>) => sum + asNumber(f.donorCount),
							0
						) ?? 0,
					receiptPolicyCount:
						fundraisingRows?.filter((f: Record<string, unknown>) => f.donationReceiptPolicy)
							.length ?? 0,
					confirmation: {
						completed: asNumber(donationConfirmationSummary?.completed),
						sent: asNumber(donationConfirmationSummary?.sent),
						sending: asNumber(donationConfirmationSummary?.sending),
						skipped: asNumber(donationConfirmationSummary?.skipped),
						failed: asNumber(donationConfirmationSummary?.failed),
						notRecorded: asNumber(donationConfirmationSummary?.notRecorded),
						attempted: asNumber(donationConfirmationSummary?.attempted),
						providerAccepted: asNumber(donationConfirmationSummary?.providerAccepted)
					}
				}
			: null;
	const workflowRows = Array.isArray(workflowResult)
		? (workflowResult as Record<string, unknown>[])
		: null;
	const coordinationGround: CoordinationGroundData | null =
		FEATURES.AUTOMATION && workflowRows
			? {
					definitionCount: workflowRows.length,
					enabledCount: workflowRows.filter((workflow) => workflow.enabled === true).length,
					triggerFamilyCount: new Set(
						workflowRows
							.map((workflow) => (workflow.trigger as Record<string, unknown> | null)?.type)
							.filter((type): type is string => typeof type === 'string')
					).size,
					plannedStepCount: workflowRows.reduce(
						(sum, workflow) => sum + (Array.isArray(workflow.steps) ? workflow.steps.length : 0),
						0
					),
					emailStepCount: workflowRows.reduce(
						(sum, workflow) =>
							sum +
							(Array.isArray(workflow.steps)
								? workflow.steps.filter(
										(step) => (step as Record<string, unknown>).type === 'send_email'
									).length
								: 0),
						0
					),
					tagStepCount: workflowRows.reduce(
						(sum, workflow) =>
							sum +
							(Array.isArray(workflow.steps)
								? workflow.steps.filter((step) =>
										['add_tag', 'remove_tag'].includes(
											String((step as Record<string, unknown>).type)
										)
									).length
								: 0),
						0
					),
					conditionStepCount: workflowRows.reduce(
						(sum, workflow) =>
							sum +
							(Array.isArray(workflow.steps)
								? workflow.steps.filter(
										(step) => (step as Record<string, unknown>).type === 'condition'
									).length
								: 0),
						0
					),
					runEvidenceCount: workflowRows.reduce(
						(sum, workflow) => sum + asNumber(workflow.executionCount),
						0
					)
				}
			: null;
	const smsBlastRows = Array.isArray(smsBlastResult)
		? (smsBlastResult as Record<string, unknown>[])
		: null;
	const smsReplySummaryRow = smsReplySummary as Record<string, unknown> | null;
	const textDeliveryGround: TextDeliveryGroundData | null =
		FEATURES.SMS && smsBlastRows
			? {
					draftCount: smsBlastRows.filter((blast) => blast.status === 'draft').length,
					plannedRecipientCount: smsBlastRows.reduce(
						(sum, blast) => sum + asNumber(blast.totalRecipients),
						0
					),
					sentCount: smsBlastRows.reduce((sum, blast) => sum + asNumber(blast.sentCount), 0),
					deliveredCount: smsBlastRows.reduce(
						(sum, blast) => sum + asNumber(blast.deliveredCount),
						0
					),
					failedCount: smsBlastRows.reduce((sum, blast) => sum + asNumber(blast.failedCount), 0),
					messageCount: smsBlastRows.reduce((sum, blast) => sum + asNumber(blast.messageCount), 0),
					replyCount: asNumber(smsReplySummaryRow?.replyCount),
					dispatchRuntimeReady: textDispatchReadiness.ready,
					dispatchRuntimeMissing: textDispatchReadiness.missing,
					dispatchRuntimeDependency: textDispatchReadiness.dependency,
					dispatchRuntimeMessage: textDispatchReadiness.message,
					dispatchRunnerImplemented: textDispatchReadiness.runnerImplemented,
					dispatchClientBatchRouteMounted: textDispatchReadiness.clientBatchRouteMounted
				}
			: null;
	const callRows = Array.isArray(callResult) ? (callResult as Record<string, unknown>[]) : null;
	const canManageCalls = result.membership.role === 'owner' || result.membership.role === 'editor';
	const callInitiationReadiness = getCallInitiationReadiness(
		{
			TWILIO_ACCOUNT_SID: privateEnv.TWILIO_ACCOUNT_SID,
			TWILIO_AUTH_TOKEN: privateEnv.TWILIO_AUTH_TOKEN,
			TWILIO_PHONE_NUMBER: privateEnv.TWILIO_PHONE_NUMBER
		},
		{
			featureEnabled: FEATURES.SMS,
			canManageCalls,
			scope: 'os_surface'
		}
	);
	const callRoutingGround: CallRoutingGroundData | null =
		FEATURES.SMS && callRows
			? {
					callCount: callRows.length,
					completedCallCount: callRows.filter((call) => call.status === 'completed').length,
					campaignCount: asNumber(dashboard?.stats?.campaigns),
					twilioConfigured: callInitiationReadiness.twilioConfigured,
					canManageCalls,
					initiationRuntimeReady: callInitiationReadiness.ready,
					initiationRuntimeMissing: callInitiationReadiness.missing,
					initiationRuntimeDependency: callInitiationReadiness.dependency,
					initiationRuntimeMessage: callInitiationReadiness.message,
					initiationSurfaceMounted: callInitiationReadiness.surfaceMounted,
					initiationProxyImplemented: callInitiationReadiness.proxyImplemented
				}
			: null;
	const congressionalDeliveryRuntime = congressionalDeliveryResult as Record<
		string,
		unknown
	> | null;
	const congressionalDeliveryGround: CongressionalDeliveryGroundData | null =
		congressionalDeliveryRuntime
			? {
					runtimeReady: congressionalDeliveryRuntime.ready === true,
					runtimeMissing: Array.isArray(congressionalDeliveryRuntime.missing)
						? congressionalDeliveryRuntime.missing.filter(
								(value): value is string => typeof value === 'string'
							)
						: [],
					runtimeDependency: asString(
						congressionalDeliveryRuntime.dependency,
						'congressional launch flag + House CWC proxy env + Senate CWC API env + per-submission proof/template checks'
					),
					runtimeMessage: asString(
						congressionalDeliveryRuntime.message,
						'Congressional delivery runtime posture is unread; CWC remains context-only until transport and proof-delivery checks are visible.'
					),
					launched: congressionalDeliveryRuntime.launched === true,
					houseTransportConfigured: congressionalDeliveryRuntime.houseTransportConfigured === true,
					senateTransportConfigured: congressionalDeliveryRuntime.senateTransportConfigured === true
				}
			: null;
	const networkRows = Array.isArray(networkResult)
		? (networkResult as Record<string, unknown>[])
		: null;
	const activeNetworkRows =
		networkRows?.filter((network) => network.memberStatus === 'active') ?? [];
	const coalitionGround: CoalitionGroundData | null =
		FEATURES.NETWORKS && networkRows
			? {
					activeNetworkCount: activeNetworkRows.length,
					pendingInviteCount: networkRows.filter((network) => network.memberStatus === 'pending')
						.length,
					activeMemberRows: activeNetworkRows.reduce(
						(sum, network) => sum + asNumber(network.memberCount),
						0
					),
					topActiveNetworkId:
						typeof activeNetworkRows[0]?._id === 'string' ? activeNetworkRows[0]._id : null
				}
			: null;
	const signalEvents = Array.isArray(signalEventsResult)
		? signalEventsResult.flatMap((event) =>
				typeof event.id === 'string' &&
				typeof event.event === 'string' &&
				typeof event.emittedAt === 'number'
					? [
							{
								id: String(event.id),
								event: event.event,
								emittedAt: event.emittedAt
							}
						]
					: []
			)
		: null;

	return {
		watermark,
		org: {
			id: result.org._id,
			name: result.org.name,
			slug: result.org.slug,
			description: result.org.description,
			avatar: result.org.avatar,
			max_seats: result.org.maxSeats,
			max_templates_month: result.org.maxTemplatesMonth,
			dm_cache_ttl_days: result.org.dmCacheTtlDays,
			identity_commitment: result.org.identityCommitment,
			brandingAccent: result.org.brandingAccent ?? null,
			createdAt: new Date(result.org._creationTime)
		},
		membership: {
			role: result.membership.role,
			joinedAt: new Date(result.membership.joinedAt)
		},
		signalEvents,
		// Per-space slices for the mounted OrgShell. Each is independently
		// best-effort: null = render the space's honest dormant/empty state.
		spaces: {
			return: returnSpace,
			base: baseSpace,
			landscape: landscapeSpace,
			operating: {
				authoring: authoringGround,
				emailDelivery: {
					subscribedCount: baseSpace?.emailHealth.subscribed ?? 0,
					clientDirectThreshold: CLIENT_DIRECT_EMAIL_THRESHOLD,
					sesProxyConfigured: Boolean(env.PUBLIC_SES_PROXY_URL),
					orgKeyConfigured: Boolean(orgKeyResult?.orgKeyVerifier),
					serverDispatchRuntimeReady: emailServerDispatchReadiness.ready,
					serverDispatchRuntimeMissing: emailServerDispatchReadiness.missing,
					serverDispatchRuntimeDependency: emailServerDispatchReadiness.dependency,
					serverDispatchRuntimeMessage: emailServerDispatchReadiness.message
				},
				platformApiSync: platformApiSyncGround,
				textDelivery: textDeliveryGround,
				callRouting: callRoutingGround,
				congressionalDelivery: congressionalDeliveryGround,
				fundraising: fundraisingGround,
				coordination: coordinationGround,
				coalition: coalitionGround
			}
		} satisfies OrgSpacesData
	};
};
