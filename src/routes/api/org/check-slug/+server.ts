import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
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

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const existing = await serverQuery(api.organizations.getBySlug, { slug });
			return json({ available: !existing });
		} catch (err) {
			console.error('[CheckSlug] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const existing = await db.organization.findUnique({
		where: { slug },
		select: { id: true }
	});

	return json({ available: !existing });
};
