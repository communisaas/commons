/**
 * GET   /api/org/[slug]/networks/[networkId] — Network detail with member list
 * PATCH /api/org/[slug]/networks/[networkId] — Update network name/description
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const UpdateNetworkSchema = z.object({
	name: z.string().min(3, 'Name must be at least 3 characters').max(100, 'Name must be at most 100 characters').optional(),
	description: z.string().max(500).optional()
}).refine((d) => d.name !== undefined || d.description !== undefined, {
	message: 'At least one field (name or description) is required'
});

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const result = await serverQuery(api.networks.get, {
		orgSlug: params.slug,
		networkId: params.networkId as any
	});
	return json({ data: result });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const parsed = UpdateNetworkSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, parsed.error.issues[0]?.message ?? 'Invalid request body');
	}

	const result = await serverMutation(api.networks.update, {
		orgSlug: params.slug,
		networkId: params.networkId as any,
		name: parsed.data.name,
		description: parsed.data.description
	});
	return json({ data: result });
};
