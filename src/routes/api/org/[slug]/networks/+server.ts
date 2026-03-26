/**
 * POST /api/org/[slug]/networks — Create a new coalition network
 * GET  /api/org/[slug]/networks — List networks the org belongs to
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { z } from 'zod';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

const CreateNetworkSchema = z.object({
	name: z.string().min(3, 'Name must be at least 3 characters').max(100, 'Name must be at most 100 characters'),
	slug: z.string().min(3).max(50).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
	description: z.string().max(500).optional()
});

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const parsed = CreateNetworkSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, parsed.error.issues[0]?.message ?? 'Invalid request body');
	}

	const { name, slug, description } = parsed.data;

	const networkId = await serverMutation(api.networks.create, {
		orgSlug: params.slug,
		name,
		slug,
		description: description ?? undefined
	});
	return json({
		data: { id: networkId, name, slug, description: description ?? null, status: 'active', createdAt: new Date().toISOString() }
	}, { status: 201 });
};

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const result = await serverQuery(api.networks.list, { slug: params.slug });
	return json({ data: result });
};
