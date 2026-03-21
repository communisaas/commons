/**
 * POST /api/org/[slug]/networks/[networkId]/decline — Decline a network invitation
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

	const member = await db.orgNetworkMember.findUnique({
		where: {
			networkId_orgId: { networkId: params.networkId, orgId: org.id }
		}
	});

	if (!member || member.status !== 'pending') {
		throw error(404, 'No pending invitation found for this network');
	}

	const updated = await db.orgNetworkMember.update({
		where: { id: member.id },
		data: { status: 'removed' }
	});

	return json({
		data: {
			id: updated.id,
			networkId: updated.networkId,
			orgId: updated.orgId,
			status: updated.status
		}
	});
};
