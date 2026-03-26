/**
 * POST /api/org/[slug]/networks/[networkId]/leave — Leave a network
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	await serverMutation(api.networks.updateMemberStatus, {
		orgSlug: params.slug,
		networkId: params.networkId as any,
		status: 'removed'
	});
	return json({ ok: true });
};
