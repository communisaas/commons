import { json } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		if (!locals.user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

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
