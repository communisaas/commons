import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/** Create a new organization. The authenticated user becomes the owner. */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { name, slug, description } = body as { name?: string; slug?: string; description?: string };

	if (!name || !slug) {
		throw error(400, 'name and slug are required');
	}

	if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 2 || slug.length > 48) {
		throw error(400, 'slug must be 2-48 lowercase alphanumeric characters or hyphens');
	}

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverMutation(api.organizations.create, {
				name,
				slug,
				description: description || undefined
			});
			return json({ id: result._id, slug: result.slug }, { status: 201 });
		} catch (err) {
			console.error('[OrgCreate] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const existing = await db.organization.findUnique({ where: { slug } });
	if (existing) {
		throw error(409, 'An organization with this slug already exists');
	}

	const org = await db.organization.create({
		data: {
			name,
			slug,
			description: description || null,
			memberships: {
				create: {
					userId: locals.user.id,
					role: 'owner'
				}
			}
		}
	});

	return json({ id: org.id, slug: org.slug }, { status: 201 });
};
