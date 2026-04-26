import { redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}

	let convexProfile = null;
	let convexTemplates = null;
	let convexReps = null;
	let convexBudget: {
		tierBypass: boolean;
		nextAllowedAt: number | null;
		recentCount: number;
		periodCap: number;
		windowMs: number;
		emailSybilTripped: boolean;
	} | null = null;
	try {
		[convexProfile, convexTemplates, convexReps, convexBudget] = await Promise.all([
			serverQuery(api.users.getProfile, {}),
			serverQuery(api.users.getMyTemplates, {}),
			serverQuery(api.users.getMyRepresentatives, {}),
			serverQuery(api.users.getReverificationBudget, { userId: locals.user.id as any })
		]);
	} catch (err) {
		console.error('[Profile Page] Convex query failed:', err instanceof Error ? err.message : String(err));
	}

	const templates = (convexTemplates ?? []).map((t: Record<string, unknown>) => t);
	const templateStats = templates.reduce(
		(acc: Record<string, number>, template: Record<string, unknown>) => {
			acc.total++;
			if (template.status === 'published') acc.published++;
			if (template.isPublic) acc.public++;
			acc.totalUses += ((template.campaigns as unknown[]) ?? []).length;
			return acc;
		},
		{ total: 0, published: 0, public: 0, totalUses: 0, totalSent: 0, totalDelivered: 0 }
	);

	return {
		user: {
			id: locals.user.id,
			email: locals.user.email,
			name: locals.user.name,
			avatar: locals.user.avatar,
			trust_tier: locals.user.trust_tier ?? 0
		},
		reverificationBudget: convexBudget,
		streamed: {
			userDetails: Promise.resolve(convexProfile ? {
				id: convexProfile._id,
				name: convexProfile.name,
				email: convexProfile.email,
				avatar: convexProfile.avatar,
				profile: {
					role: convexProfile.role, organization: convexProfile.organization,
					location: convexProfile.location, connection: convexProfile.connection,
					completed_at: convexProfile.profileCompletedAt ?? null,
					visibility: convexProfile.profileVisibility
				},
				verification: {
					is_verified: convexProfile.isVerified, method: convexProfile.verificationMethod,
					verified_at: convexProfile.verifiedAt, district_verified: convexProfile.districtVerified
				},
				reputation: {
					trust_tier: convexProfile.trustTier, trust_score: convexProfile.trustScore,
					tier: convexProfile.reputationTier, authority_level: null, active_months: null,
					templates_contributed: null, template_adoption_rate: null, peer_endorsements: null
				},
				timestamps: { created_at: convexProfile._creationTime ?? null, updated_at: null }
			} : null),
			templatesData: Promise.resolve({ templates, templateStats }),
			representatives: Promise.resolve(convexReps ?? [])
		}
	};
};
