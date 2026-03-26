import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}

	const convexProfile = await serverQuery(api.users.getProfile, {});

	if (convexProfile) {
		return {
			user: {
				id: locals.user.id,
				name: convexProfile.name ?? locals.user.name,
				email: convexProfile.email ?? locals.user.email,
				avatar: convexProfile.avatar || null,
				is_verified: convexProfile.isVerified,
				district_verified: convexProfile.districtVerified,
				trust_score: convexProfile.trustScore,
				reputation_tier: convexProfile.reputationTier,
				trust_tier: convexProfile.trustTier,
				hasPasskey: convexProfile.hasPasskey
			}
		};
	}

	// Fallback to session data if Convex profile not found
	return {
		user: {
			id: locals.user.id,
			name: locals.user.name,
			email: locals.user.email,
			avatar: locals.user.avatar || null,
			is_verified: locals.user.is_verified,
			district_verified: locals.user.district_verified,
			trust_score: locals.user.trust_score,
			reputation_tier: locals.user.reputation_tier,
			trust_tier: locals.user.trust_tier,
			hasPasskey: false
		}
	};
};
