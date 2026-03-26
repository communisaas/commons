/**
 * POST /api/org/[slug]/networks/[networkId]/accept — Accept a network invitation
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverMutation(api.networks.updateMemberStatus, {
				orgSlug: params.slug,
				networkId: params.networkId as any,
				status: 'active'
			});
			return json({ data: result });
		} catch (err) {
			console.error('[NetworkAccept.POST] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'editor');

	// Find pending membership for this org in this network
	const pendingMember = await db.orgNetworkMember.findUnique({
		where: {
			networkId_orgId: { networkId: params.networkId, orgId: org.id }
		}
	});

	if (!pendingMember || pendingMember.status !== 'pending') {
		throw error(404, 'No pending invitation found for this network');
	}

	const updated = await db.orgNetworkMember.update({
		where: { id: pendingMember.id },
		data: { status: 'active' }
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
