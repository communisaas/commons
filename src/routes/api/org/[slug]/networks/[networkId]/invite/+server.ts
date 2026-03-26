/**
 * POST /api/org/[slug]/networks/[networkId]/invite — Invite an org to the network
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const InviteSchema = z.object({
	orgSlug: z.string().min(1, 'orgSlug is required')
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

	const parsed = InviteSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, parsed.error.issues[0]?.message ?? 'Invalid request body');
	}

	const result = await serverMutation(api.networks.invite, {
		orgSlug: params.slug,
		networkId: params.networkId as any,
		targetOrgSlug: parsed.data.orgSlug
	});
	return json({ data: { id: result } }, { status: 201 });
};
