import type { PageServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asIso(value: unknown): string {
	return typeof value === 'number' ? new Date(value).toISOString() : asString(value, new Date().toISOString());
}

export const load: PageServerLoad = async ({ parent }) => {
	const { org } = await parent();

	const dashboard = await serverQuery(api.organizations.getDashboard, { slug: org.slug });

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
		// TODO: enhance convex/organizations.getDashboard to include funnel detail (postalResolved, identityVerified, districtVerified)
		funnel: {
			imported: dashboard.stats?.supporters ?? 0,
			postalResolved: 0,
			identityVerified: 0,
			districtVerified: 0
		},
		// TODO: enhance convex/organizations.getDashboard to include tier distribution
		tiers: [0, 1, 2, 3, 4].map(tier => ({
			tier,
			label: ['New', 'Active', 'Established', 'Veteran', 'Pillar'][tier],
			count: 0
		})),
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
		// TODO: enhance convex/organizations.getDashboard to include verification packet
		packet: null,
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
		// TODO: enhance convex/organizations.getDashboard to include growth (thisWeek/lastWeek verified actions)
		growth: { thisWeek: 0, lastWeek: 0 },
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
