import type { LayoutServerLoad } from './$types';

import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// Cache user shell data across navigations — only re-fetch when explicitly invalidated.
	// hooks.server already validated the session and projected the full user row
	// into locals, so querying users.getProfile here would read the same document a
	// second time on every navigation.
	depends('data:user');

	if (!locals.user) {
		return { user: null };
	}

	let membershipPage: {
		data: Array<{
			orgSlug: string;
			orgName: string;
			orgAvatar: string | null;
			role: string;
			activeCampaignCount: number | null;
		}>;
		cursor: string | null;
		hasMore: boolean;
		limit: number;
	} = { data: [], cursor: null, hasMore: false, limit: 12 };
	try {
		membershipPage = await serverQuery(api.organizations.getMyMemberships, {
			cursor: null,
			limit: 12
		});
	} catch (err) {
		console.error(
			'[Layout] Convex membership shell query failed:',
			err instanceof Error ? err.message : String(err)
		);
	}

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
			address_verified_at: locals.user.address_verified_at?.toISOString() ?? null,
			hasPasskey: Boolean(locals.user.passkey_credential_id),
			district_hash: locals.user.district_hash,
			district_verified: locals.user.district_verified,
			hasWallet: Boolean(locals.user.wallet_address),
			hasDistrictCredential: Boolean(locals.user.district_verified),
			orgMemberships: membershipPage.data,
			orgMembershipsOverflow: {
				hasMore: membershipPage.hasMore,
				cursor: membershipPage.cursor,
				limit: membershipPage.limit
			}
		}
	};
};
