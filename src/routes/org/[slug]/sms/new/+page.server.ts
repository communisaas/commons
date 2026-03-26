// CONVEX: Keep SvelteKit — SMS/Twilio integration
import { error, redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const campaigns = await serverQuery(api.campaigns.list, { slug: params.slug });

	return {
		org: { name: params.slug, slug: params.slug },
		campaigns: campaigns.map((c) => ({ id: c._id, title: c.title }))
	};
};
