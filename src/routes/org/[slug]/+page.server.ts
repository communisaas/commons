import type { PageServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ parent }) => {
	const { org } = await parent();

	const dashboard = await serverQuery(api.organizations.getDashboard, { slug: org.slug });

	// Map Convex denormalized payload → shape +page.svelte expects.
	// Fields that Convex doesn't carry yet get safe defaults so the
	// frontend handles them gracefully.
	const campaigns = (dashboard.recentCampaigns ?? []).map((c: Record<string, unknown>) => ({
		id: c._id,
		title: c.title,
		type: c.type,
		status: c.status,
		totalActions: c.actionCount ?? 0,
		verifiedActions: c.verifiedActionCount ?? 0,
		updatedAt: typeof c.updatedAt === 'number' ? new Date(c.updatedAt as number).toISOString() : c.updatedAt
	}));

	const activeCampaignCount = campaigns.filter((c: { status: string }) => c.status === 'ACTIVE').length;

	// Use real member data from Convex getDashboard
	const membersFromConvex = (dashboard.members ?? []).map((m: Record<string, unknown>) => ({
		id: m._id,
		role: m.role,
		userName: m.userName ?? null,
		userEmail: m.userEmail ?? null,
		encryptedUserName: m.encryptedUserName ?? null,
		encryptedUserEmail: m.encryptedUserEmail ?? null,
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
		topCampaignId: (campaigns.find((c: { status: string }) => c.status === 'ACTIVE') || campaigns[0])?.id ?? null,
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
			label: (s.name as string) ?? 'Anonymous',
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
		billingEmail: dashboard.billingEmail ?? null,
		onboardingState: {
			hasDescription: dashboard.onboardingState?.hasDescription ?? false,
			hasIssueDomains: dashboard.onboardingState?.hasIssueDomains ?? false,
			hasSupporters: dashboard.onboardingState?.hasSupporters ?? false,
			hasCampaigns: dashboard.onboardingState?.hasCampaigns ?? false,
			hasTeam: dashboard.onboardingState?.hasTeam ?? false,
			hasSentEmail: dashboard.onboardingState?.hasSentEmail ?? false,
			postalResolvedCount: 0,
			totalSupporters: dashboard.stats?.supporters ?? 0,
			topCampaignId: (campaigns.find((c: { status: string }) => c.status === 'ACTIVE') || campaigns[0])?.id ?? null
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
