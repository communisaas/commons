/**
 * POST /api/org/[slug]/networks/[networkId]/leave — Leave a network
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	// Cannot leave a network you created (you're the admin)
	const network = await db.orgNetwork.findUnique({
		where: { id: params.networkId },
		select: { ownerOrgId: true }
	});

	if (network?.ownerOrgId === org.id) {
		throw error(400, 'Cannot leave a network you created. Delete the network instead.');
	}

	const member = await db.orgNetworkMember.findUnique({
		where: {
			networkId_orgId: { networkId: params.networkId, orgId: org.id }
		}
	});

	if (!member || member.status !== 'active') {
		throw error(404, 'Not an active member of this network');
	}

	await db.orgNetworkMember.delete({
		where: { id: member.id }
	});

	return json({ ok: true });
};
