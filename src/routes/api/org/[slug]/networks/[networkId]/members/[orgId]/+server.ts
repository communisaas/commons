/**
 * DELETE /api/org/[slug]/networks/[networkId]/members/[orgId] — Remove a member org
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			await serverMutation(api.networks.updateMemberStatus, {
				orgSlug: params.slug,
				networkId: params.networkId as any,
				targetOrgId: params.orgId as any,
				status: 'removed'
			});
			return json({ data: { removed: true } });
		} catch (err) {
			console.error('[NetworkRemoveMember.DELETE] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org } = await loadOrgContext(params.slug, locals.user.id);

	// Verify requesting org is admin in the network
	const callerMembership = await db.orgNetworkMember.findUnique({
		where: {
			networkId_orgId: { networkId: params.networkId, orgId: org.id }
		}
	});
	if (!callerMembership || callerMembership.status !== 'active' || callerMembership.role !== 'admin') {
		throw error(403, 'Network admin role required');
	}

	// Verify the network exists and check owner
	const network = await db.orgNetwork.findUnique({
		where: { id: params.networkId },
		select: { ownerOrgId: true }
	});
	if (!network) throw error(404, 'Network not found');

	// Can't remove the owner org
	if (params.orgId === network.ownerOrgId) {
		throw error(400, 'Cannot remove the network owner organization');
	}

	// Find the target membership
	const targetMember = await db.orgNetworkMember.findUnique({
		where: {
			networkId_orgId: { networkId: params.networkId, orgId: params.orgId }
		}
	});
	if (!targetMember || targetMember.status === 'removed') {
		throw error(404, 'Member not found in this network');
	}

	await db.orgNetworkMember.update({
		where: { id: targetMember.id },
		data: { status: 'removed' }
	});

	return json({ data: { removed: true } });
};
