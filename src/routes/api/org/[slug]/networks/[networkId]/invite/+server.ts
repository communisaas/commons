/**
 * POST /api/org/[slug]/networks/[networkId]/invite — Invite an org to the network
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { z } from 'zod';
import type { RequestHandler } from './$types';

// orgSlug max-length parity with /api/org POST (slug 2-48 chars).
const InviteSchema = z.object({
	orgSlug: z.string().min(2).max(48)
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
		networkId: params.networkId as Id<'orgNetworks'>,
		targetOrgSlug: parsed.data.orgSlug
	});
	return json({ data: { id: result } }, { status: 201 });
};
