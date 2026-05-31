/**
 * /api/org/[slug]/networks/[networkId]/members/[orgId]
 *
 *   DELETE — Remove a member org from the network
 *   PATCH  — Update a member org's role (admin ↔ member). T7-8.
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	await serverMutation(api.networks.updateMemberStatus, {
		orgSlug: params.slug!,
		networkId: params.networkId as Id<'orgNetworks'>,
		targetOrgId: params.orgId as Id<'organizations'>,
		status: 'removed'
	});
	return json({ data: { removed: true } });
};

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { role } = body as { role?: 'admin' | 'member' };
	if (role !== 'admin' && role !== 'member') {
		throw error(400, "role must be 'admin' or 'member'");
	}

	try {
		const result = await serverMutation(api.networks.updateMemberRole, {
			orgSlug: params.slug!,
			networkId: params.networkId as Id<'orgNetworks'>,
			targetOrgId: params.orgId as Id<'organizations'>,
			role
		});
		return json({ data: result });
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Failed to update role';
		throw error(400, message);
	}
};
