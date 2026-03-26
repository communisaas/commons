import { json, error } from '@sveltejs/kit';
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

	const result = await serverMutation(api.organizations.create, {
		name,
		slug,
		description: description || undefined
	});
	return json({ id: result._id, slug: result.slug }, { status: 201 });
};
