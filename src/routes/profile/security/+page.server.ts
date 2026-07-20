import { redirect } from '@sveltejs/kit';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}

	const convexProfile = await serverQuery(api.users.getProfile, {});

	return {
		passkey: convexProfile?.hasPasskey
			? {
					createdAt: null,
					lastUsedAt: null
				}
			: null
	};
};
