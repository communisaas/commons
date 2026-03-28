import type { LayoutServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// Cache user data across navigations — only re-fetch when explicitly invalidated
	depends('data:user');

	if (!locals.user) {
		return { user: null };
	}

	let convexProfile = null;
	let convexMemberships = null;
	try {
		[convexProfile, convexMemberships] = await Promise.all([
			serverQuery(api.users.getProfile, {}),
			serverQuery(api.organizations.getMyMemberships, {})
		]);
	} catch (err) {
		console.error('[Layout] Convex profile query failed:', err instanceof Error ? err.message : String(err));
	}

	if (convexProfile) {
		return {
			user: {
				id: locals.user.id,
				email: convexProfile.email ?? locals.user.email,
				name: convexProfile.name ?? locals.user.name,
				avatar: convexProfile.avatar ?? locals.user.avatar,
				trust_tier: convexProfile.trustTier ?? 0,
				is_verified: convexProfile.isVerified || false,
				verification_method: convexProfile.verificationMethod,
				verified_at: convexProfile.verifiedAt,
				hasPasskey: convexProfile.hasPasskey,
				district_hash: convexProfile.districtHash,
				district_verified: convexProfile.districtVerified,
				hasWallet: convexProfile.hasWallet,
				hasDistrictCredential: Boolean(convexProfile.districtVerified),
				orgMemberships: convexMemberships ?? []
			}
		};
	}

	// Profile not found in Convex or query failed — return minimal user data from session
	return {
		user: {
			id: locals.user.id,
			email: locals.user.email,
			name: locals.user.name,
			avatar: locals.user.avatar,
			trust_tier: locals.user.trust_tier ?? 0,
			is_verified: locals.user.is_verified || false,
			verification_method: locals.user.verification_method,
			verified_at: locals.user.verified_at,
			hasPasskey: false,
			district_hash: locals.user.district_hash,
			district_verified: locals.user.district_verified,
			hasWallet: false,
			hasDistrictCredential: false,
			orgMemberships: []
		}
	};
};
