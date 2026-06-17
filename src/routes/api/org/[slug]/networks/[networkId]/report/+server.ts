/**
 * GET /api/org/[slug]/networks/[networkId]/report — Coalition aggregate report
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// Membership/authz is enforced by networks.get. Keep this explicit so the
	// aggregate stats query remains a network-shaped operation, not a public ID probe.
	await serverQuery(api.networks.get, {
		orgSlug: params.slug,
		networkId: params.networkId as Id<'orgNetworks'>
	});

	const stats = await serverQuery(api.networks.getStats, {
		networkId: params.networkId as Id<'orgNetworks'>
	});

	return json({ data: stats });
};
