import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/** Check if an org slug is available. */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const slug = url.searchParams.get('slug');
	if (!slug || slug.length < 2 || slug.length > 48 || !/^[a-z0-9-]+$/.test(slug)) {
		return json({ available: false });
	}

	const existing = await serverQuery(api.organizations.getBySlug, { slug });
	return json({ available: !existing });
};
