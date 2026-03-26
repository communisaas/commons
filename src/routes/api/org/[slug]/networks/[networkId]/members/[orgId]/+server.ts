/**
 * DELETE /api/org/[slug]/networks/[networkId]/members/[orgId] — Remove a member org
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	await serverMutation(api.networks.updateMemberStatus, {
		orgSlug: params.slug,
		networkId: params.networkId as any,
		targetOrgId: params.orgId as any,
		status: 'removed'
	});
	return json({ data: { removed: true } });
};
