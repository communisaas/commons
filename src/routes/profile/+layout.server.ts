import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: LayoutServerLoad = async ({ locals }) => {
	// Check if user is authenticated
	if (!locals.user) {
		throw redirect(302, '/');
	}

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const convexProfile = await serverQuery(api.users.getProfile, {});

			if (convexProfile) {
				console.log('[ProfileLayout] Convex: loaded user profile');
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
		} catch (err) {
			console.error('[ProfileLayout] Convex load failed, falling back to Prisma:', err);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───
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
			hasPasskey: Boolean(locals.user.passkey_credential_id)
		}
	};
};
