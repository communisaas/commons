import { json } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		if (!locals.user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
		if (PUBLIC_CONVEX_URL) {
			try {
				const result = await serverQuery(api.templates.listByUser, {});
				return json(result);
			} catch (err) {
				console.error('[UserTemplates.GET] Convex failed, falling back to Prisma:', err);
			}
		}

		// ─── PRISMA FALLBACK ───
		const userTemplates = await db.template.findMany({
			where: {
				userId: locals.user.id
			},
			orderBy: {
				updatedAt: 'desc'
			},
			select: {
				id: true,
				slug: true,
				title: true,
				description: true,
				body: true,
				category: true,
				status: true,
				is_public: true,
				verified_sends: true,
				createdAt: true,
				updatedAt: true
			}
		});

		return json(userTemplates);
	} catch {
		return json({ error: 'Failed to fetch templates' }, { status: 500 });
	}
};
