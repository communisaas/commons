import type { PageServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { computeVerificationPacketCached } from '$lib/server/verification-packet';
import type { Id } from '$convex/_generated/dataModel';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asIso(value: unknown): string {
	return typeof value === 'number' ? new Date(value).toISOString() : asString(value, new Date().toISOString());
}

export const load: PageServerLoad = async ({ parent, platform }) => {
	const { org } = await parent();

	const [dashboard, dashboardStats] = await Promise.all([
		serverQuery(api.organizations.getDashboard, { slug: org.slug }),
		serverQuery(api.organizations.getDashboardStats, { slug: org.slug })
	]);

	// Map Convex denormalized payload → shape +page.svelte expects.
	// Fields that Convex doesn't carry yet get safe defaults so the
	// frontend handles them gracefully.
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
	const topCampaignId = (campaigns.find((c) => c.status === 'ACTIVE') || campaigns[0])?.id ?? null;

	// Verification packet for the org's top campaign. Null on new orgs (no campaigns
	// yet) — page renders the empty state. KV cache is 30s; reuses the per-campaign
	// computeVerificationPacketCached path so the dashboard sees the same numbers
	// as the campaign report.
	const packet =
		topCampaignId && dashboard.org?._id
			? await computeVerificationPacketCached(
					topCampaignId as Id<'campaigns'>,
					dashboard.org._id as Id<'organizations'>,
					(platform as { env?: { KV?: unknown } })?.env?.KV as
						| {
								get(key: string): Promise<string | null>;
								put(
									key: string,
									value: string,
									options?: { expirationTtl?: number }
								): Promise<void>;
						  }
						| undefined
				).catch(() => null)
			: null;

	// Use real member data from Convex getDashboard
	const membersFromConvex = (dashboard.members ?? []).map((m: Record<string, unknown>) => ({
		id: m._id,
		role: m.role,
		userName: m.userName ?? null,
		userEmail: m.userEmail ?? null,
		userAvatar: m.userAvatar ?? null,
		joinedAt: m.joinedAt
	}));

	return {
		funnel: dashboardStats.funnel,
		tiers: dashboardStats.tiers,
		campaigns,
		topCampaignId,
		stats: {
			supporters: dashboard.stats?.supporters ?? 0,
			campaigns: dashboard.stats?.campaigns ?? 0,
			// TODO: enhance convex/organizations.getDashboard to include template count
			templates: 0,
			activeCampaigns: activeCampaignCount,
			members: dashboard.stats?.members ?? membersFromConvex.length,
			sentEmails: dashboard.stats?.sentEmails ?? 0
		},
		// TODO: enhance convex/organizations.getDashboard to include email reach breakdown
		emailReach: {
			subscribed: 0,
			unsubscribed: 0,
			bounced: 0,
			complained: 0,
			total: dashboard.stats?.supporters ?? 0
		},
		packet,
		recentActivity: (dashboard.recentSupporters ?? []).map((s: Record<string, unknown>) => ({
			type: 'signup' as const,
			id: s._id,
			label: 'Supporter',
			detail: (s.source as string) ?? 'organic',
			verified: s.verified,
			tier: 0,
			timestamp: typeof s._creationTime === 'number'
				? new Date(s._creationTime as number).toISOString()
				: String(s._creationTime)
		})),
		// TODO: enhance convex/organizations.getDashboard to include endorsed templates
		endorsedTemplates: [],
		growth: dashboardStats.growth,
		encryptedBillingEmail: dashboard.encryptedBillingEmail ?? null,
		onboardingState: {
			hasDescription: dashboard.onboardingState?.hasDescription ?? false,
			hasIssueDomains: dashboard.onboardingState?.hasIssueDomains ?? false,
			hasSupporters: dashboard.onboardingState?.hasSupporters ?? false,
			hasCampaigns: dashboard.onboardingState?.hasCampaigns ?? false,
			hasTeam: dashboard.onboardingState?.hasTeam ?? false,
			hasSentEmail: dashboard.onboardingState?.hasSentEmail ?? false,
			postalResolvedCount: 0,
			totalSupporters: dashboard.stats?.supporters ?? 0,
			topCampaignId
		},
		onboardingComplete: dashboard.onboardingComplete ?? false,
		// TODO: enhance convex/organizations.getDashboard to include followed reps
		followedReps: { count: 0, top: [] },
		// TODO: enhance convex/organizations.getDashboard to include watched bills
		watchedBills: { count: 0, top: [] },
		// TODO: enhance convex/organizations.getDashboard to include legislative alerts
		legislativeAlerts: []
	};
};
