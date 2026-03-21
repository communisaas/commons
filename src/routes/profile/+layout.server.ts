import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ locals }) => {
	// Check if user is authenticated
	if (!locals.user) {
		throw redirect(302, '/');
	}

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
