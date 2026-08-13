import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { getCallInitiationReadiness } from '$lib/server/calls/call-initiation-readiness';
import { getMessageGenerationReadiness } from '$lib/server/agents/message-generation-readiness';
import { getEmailServerDispatchReadiness } from '$lib/server/email/server-dispatch-readiness';
import { getPlatformApiSyncReadiness } from '$lib/server/platform-api-sync-readiness';
import { getTextDispatchReadiness } from '$lib/server/sms/text-dispatch-readiness';
import { CLIENT_DIRECT_EMAIL_THRESHOLD } from '$lib/data/org-limit-sentences';
import type {
	AuthoringRuntimeGroundData,
	BaseSpaceData,
	CallRoutingGroundData,
	CongressionalDeliveryGroundData,
	LandscapeSpaceData,
	OperatingGroundData,
	OrgSpacesData,
	PlatformApiSyncGroundData,
	ReturnSpaceData,
	TextDeliveryGroundData
} from '$lib/components/org/os/spaces';
import { orgShellLoadPolicy } from '$lib/server/org-shell-load-policy';

type Workspace = 'base' | 'operating' | 'landscape' | 'return';

function selectedWorkspace(policy: ReturnType<typeof orgShellLoadPolicy>): Workspace | undefined {
	if (policy.base) return 'base';
	if (policy.operating) return 'operating';
	if (policy.landscape) return 'landscape';
	if (policy.return) return 'return';
	return undefined;
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

/**
 * Shared org layout contract.
 *
 * Every route performs one `organizations.getOrgContext` call. Deep routes stop
 * there. A canonical Studio URL may make one additional configuration-only
 * readiness query; Results and Power summaries are bounded branches inside the
 * context transaction. Feature histories, supporter joins, workflow executions,
 * donations, SMS messages/replies, calls, networks, bills and scorecards are
 * deliberately page-owned and never loaded by this shared layout.
 */
export const load: LayoutServerLoad = async ({ params, locals, url }) => {
	if (!locals.user) {
		throw redirect(302, `/auth/google?returnTo=/org/${params.slug}`);
	}

	const policy = orgShellLoadPolicy(url, params.slug);
	const workspace = selectedWorkspace(policy);
	const contextPromise = serverQuery(
		api.organizations.getOrgContext,
		workspace ? { slug: params.slug, workspace } : { slug: params.slug }
	);
	const congressionalPromise = policy.operating
		? serverQuery(api.submissions.getCongressionalDeliveryReadiness, {}).catch(() => null)
		: Promise.resolve(null);
	const [result, congressionalDeliveryResult] = await Promise.all([
		contextPromise,
		congressionalPromise
	]);

	if (!result) throw redirect(302, '/');

	const supporter = result.supporterSummary;
	const baseSpace: BaseSpaceData | null = policy.base
		? {
				total: supporter.total,
				imported: supporter.total,
				sourceCounts: supporter.sourceCounts,
				postalResolved: supporter.postalResolved,
				// District set cardinality is intentionally owned by the People tool.
				districtVerified: null,
				districtVerifiedTruncated: null,
				identityVerified: supporter.identityVerified,
				emailHealth: supporter.emailHealth,
				smsHealth: supporter.smsHealth,
				consentEvidence: supporter.consentEvidence,
				// Segment definitions can contain arbitrary filters and are page-owned.
				segmentation: null
			}
		: null;

	const returnSummary = result.workspace?.kind === 'return' ? result.workspace : null;
	const campaigns = returnSummary
		? returnSummary.campaignCardsReady
			? returnSummary.campaigns.map((campaign) => ({
					id: String(campaign._id),
					title: campaign.title,
					type: campaign.type,
					status: campaign.status,
					totalActions: campaign.actionCount,
					verifiedActions: campaign.verifiedActionCount,
					updatedAt: new Date(campaign.updatedAt).toISOString()
				}))
			: null
		: null;
	const topCampaignId =
		(campaigns?.find((campaign) => campaign.status === 'ACTIVE') ?? campaigns?.[0])?.id ?? null;
	const returnSpace: ReturnSpaceData | null =
		policy.return && returnSummary
			? {
					funnel: {
						imported: supporter.total,
						postalResolved: supporter.postalResolved,
						identityVerified: supporter.identityVerified,
						districtVerified: null
					},
					tiers: [],
					growth: null,
					campaigns,
					topCampaignId,
					// The report page owns packet construction and its campaign histories.
					packet: null,
					stats: {
						supporters: result.navBadges.supporters,
						campaigns: result.navBadges.campaigns,
						activeCampaigns: result.navBadges.activeCampaigns,
						members: result.navBadges.members,
						sentEmails: result.navBadges.sentEmails
					},
					receipts: returnSummary.receipts
						? {
								loadedCount: returnSummary.receipts.receiptCount,
								pendingCount: returnSummary.receipts.pendingCount,
								responseLoggedCount: returnSummary.receipts.responseLoggedCount,
								anchorFieldCount: returnSummary.receipts.anchorFieldCount,
								latestProofDeliveredAt: returnSummary.receipts.latestProofDeliveredAt
									? new Date(returnSummary.receipts.latestProofDeliveredAt).toISOString()
									: null,
								sampleLimit: 0
							}
						: null
				}
			: null;

	const landscapeSummary = result.workspace?.kind === 'landscape' ? result.workspace : null;
	const landscapeSpace: LandscapeSpaceData | null =
		policy.landscape && landscapeSummary
			? {
					legislationEnabled: FEATURES.LEGISLATION,
					followed: landscapeSummary.followedReady
						? landscapeSummary.followed.map((row) => ({
								id: String(row.decisionMakerId),
								reason: row.reason,
								name: row.name,
								party: row.party,
								title: row.title,
								jurisdiction: row.jurisdiction,
								district: row.district
							}))
						: null,
					followedCount: landscapeSummary.followedReady ? landscapeSummary.followed.length : null,
					followedCountTruncated: landscapeSummary.followedTruncated,
					// Bill and scorecard collections remain behind their owned routes.
					bills: null,
					relevantBillCount: null,
					positionedBillCount: null,
					scorecards: null,
					scorecardSnapshotCount: null,
					scorecardAvg: null
				}
			: null;

	const messageGenerationReadiness = getMessageGenerationReadiness(messageGenerationEnv());
	const authoring: AuthoringRuntimeGroundData = {
		runtimeReady: messageGenerationReadiness.ready,
		modelProviderConfigured: messageGenerationReadiness.modelProviderConfigured,
		sourceSearchConfigured: messageGenerationReadiness.sourceSearchConfigured,
		sourceFetchConfigured: messageGenerationReadiness.sourceFetchConfigured,
		runtimeMissing: messageGenerationReadiness.missing,
		runtimeDependency: messageGenerationReadiness.dependency,
		runtimeMessage: messageGenerationReadiness.message
	};
	const emailReadiness = getEmailServerDispatchReadiness(emailServerDispatchEnv(), {
		orgKeyConfigured: result.operatingState.orgKeyConfigured
	});
	const platformReadiness = getPlatformApiSyncReadiness();
	const platformState = result.operatingState.platformApi;
	const platformApiSync: PlatformApiSyncGroundData = {
		runtimeReady: platformReadiness.ready,
		credentialCustodyReady: platformReadiness.credentialCustodyReady,
		credentialStored: Boolean(platformState?.credentialStoredAt),
		credentialProbeComplete: Boolean(platformState?.credentialProbeCompletedAt),
		credentialProbeCompletedAt: platformState?.credentialProbeCompletedAt
			? new Date(platformState.credentialProbeCompletedAt).toISOString()
			: null,
		adapterSource: platformState?.adapterSource ?? null,
		profileCount: platformReadiness.profileCount,
		runnerImplemented: platformReadiness.runnerImplemented,
		armedAdapterSources: platformReadiness.armedAdapterSources,
		runtimeMissing: platformReadiness.missing,
		runtimeDependency: platformReadiness.dependency,
		runtimeMessage: platformReadiness.message,
		runtimeFlag: platformReadiness.runtimeFlag
	};
	const textReadiness = getTextDispatchReadiness(
		{
			TWILIO_ACCOUNT_SID: privateEnv.TWILIO_ACCOUNT_SID,
			TWILIO_AUTH_TOKEN: privateEnv.TWILIO_AUTH_TOKEN,
			TWILIO_PHONE_NUMBER: privateEnv.TWILIO_PHONE_NUMBER
		},
		{ featureEnabled: FEATURES.SMS_DISPATCH }
	);
	const textDelivery: TextDeliveryGroundData | null = FEATURES.SMS
		? {
				draftCount: null,
				plannedRecipientCount: null,
				sentCount: null,
				deliveredCount: null,
				failedCount: null,
				messageCount: null,
				replyCount: null,
				dispatchRuntimeReady: textReadiness.ready,
				dispatchRuntimeMissing: textReadiness.missing,
				dispatchRuntimeDependency: textReadiness.dependency,
				dispatchRuntimeMessage: textReadiness.message,
				dispatchRunnerImplemented: textReadiness.runnerImplemented,
				dispatchClientBatchRouteMounted: textReadiness.clientBatchRouteMounted
			}
		: null;
	const canManageCalls = result.membership.role === 'owner' || result.membership.role === 'editor';
	const callReadiness = getCallInitiationReadiness(
		{
			TWILIO_ACCOUNT_SID: privateEnv.TWILIO_ACCOUNT_SID,
			TWILIO_AUTH_TOKEN: privateEnv.TWILIO_AUTH_TOKEN,
			TWILIO_PHONE_NUMBER: privateEnv.TWILIO_PHONE_NUMBER
		},
		{ featureEnabled: FEATURES.SMS, canManageCalls, scope: 'os_surface' }
	);
	const callRouting: CallRoutingGroundData | null = FEATURES.SMS
		? {
				callCount: null,
				completedCallCount: null,
				campaignCount: result.navBadges.campaigns,
				twilioConfigured: callReadiness.twilioConfigured,
				canManageCalls,
				initiationRuntimeReady: callReadiness.ready,
				initiationRuntimeMissing: callReadiness.missing,
				initiationRuntimeDependency: callReadiness.dependency,
				initiationRuntimeMessage: callReadiness.message,
				initiationSurfaceMounted: callReadiness.surfaceMounted,
				initiationProxyImplemented: callReadiness.proxyImplemented
			}
		: null;
	const congressional = congressionalDeliveryResult as Record<string, unknown> | null;
	const congressionalDelivery: CongressionalDeliveryGroundData | null = congressional
		? {
				runtimeReady: congressional.ready === true,
				runtimeMissing: Array.isArray(congressional.missing)
					? congressional.missing.filter((item): item is string => typeof item === 'string')
					: [],
				runtimeDependency:
					typeof congressional.dependency === 'string' ? congressional.dependency : '',
				runtimeMessage: typeof congressional.message === 'string' ? congressional.message : '',
				launched: congressional.launched === true,
				houseTransportConfigured: congressional.houseTransportConfigured === true,
				senateTransportConfigured: congressional.senateTransportConfigured === true
			}
		: null;

	// Readiness is shell state, not feature history. Keep it present on deep routes
	// so child navigation cannot erase the Mantle's authoring and delivery posture.
	const operating: OperatingGroundData = {
		authoring,
		emailDelivery: {
			subscribedCount: supporter.emailHealth.subscribed,
			clientDirectThreshold: CLIENT_DIRECT_EMAIL_THRESHOLD,
			sesProxyConfigured: Boolean(env.PUBLIC_SES_PROXY_URL),
			orgKeyConfigured: result.operatingState.orgKeyConfigured,
			serverDispatchRuntimeReady: emailReadiness.ready,
			serverDispatchRuntimeMissing: emailReadiness.missing,
			serverDispatchRuntimeDependency: emailReadiness.dependency,
			serverDispatchRuntimeMessage: emailReadiness.message
		},
		platformApiSync,
		textDelivery,
		callRouting,
		congressionalDelivery,
		fundraising: null,
		coordination: null,
		coalition: null
	};

	return {
		watermark: null,
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
			logoUrl: result.org.logoUrl ?? null,
			whiteLabel: result.org.whiteLabel ?? false,
			isPublic: result.org.isPublic,
			createdAt: new Date(result.org._creationTime)
		},
		membership: {
			role: result.membership.role,
			joinedAt: new Date(result.membership.joinedAt)
		},
		navBadges: result.navBadges,
		badgeReadiness: result.badgeReadiness,
		signalEvents: null,
		spaces: {
			return: returnSpace,
			base: baseSpace,
			landscape: landscapeSpace,
			operating
		} satisfies OrgSpacesData
	};
};
