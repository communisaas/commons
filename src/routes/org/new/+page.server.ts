// CONVEX: No DB dependency — no migration needed
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Redirect /org/new to the org landing page which has the creation form
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/auth/google?returnTo=/org/new');
	}

	throw redirect(302, '/org');
};
