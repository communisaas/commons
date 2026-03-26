/**
 * GET   /api/org/[slug]/networks/[networkId] — Network detail with member list
 * PATCH /api/org/[slug]/networks/[networkId] — Update network name/description
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext } from '$lib/server/org';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const UpdateNetworkSchema = z.object({
	name: z.string().min(3, 'Name must be at least 3 characters').max(100, 'Name must be at most 100 characters').optional(),
	description: z.string().max(500).optional()
}).refine((d) => d.name !== undefined || d.description !== undefined, {
	message: 'At least one field (name or description) is required'
});

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.networks.get, {
				orgSlug: params.slug,
				networkId: params.networkId as any
			});
			return json({ data: result });
		} catch (err) {
			console.error('[NetworkDetail.GET] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org } = await loadOrgContext(params.slug, locals.user.id);

	// Verify requesting org is an active member
	const callerMembership = await db.orgNetworkMember.findUnique({
		where: {
			networkId_orgId: { networkId: params.networkId, orgId: org.id }
		}
	});
	if (!callerMembership || callerMembership.status !== 'active') {
		throw error(403, 'Your organization is not an active member of this network');
	}

	const network = await db.orgNetwork.findUnique({
		where: { id: params.networkId },
		include: {
			ownerOrg: { select: { id: true, name: true, slug: true } },
			members: {
				where: { status: 'active' },
				include: {
					org: { select: { id: true, name: true, slug: true } }
				},
				orderBy: { joinedAt: 'asc' }
			}
		}
	});

	if (!network) throw error(404, 'Network not found');

	return json({
		data: {
			id: network.id,
			name: network.name,
			slug: network.slug,
			description: network.description,
			status: network.status,
			ownerOrg: network.ownerOrg,
			members: network.members.map((m) => ({
				id: m.id,
				orgId: m.org.id,
				orgName: m.org.name,
				orgSlug: m.org.slug,
				role: m.role,
				joinedAt: m.joinedAt.toISOString()
			})),
			memberCount: network.members.length,
			createdAt: network.createdAt.toISOString()
		}
	});
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const parsed = UpdateNetworkSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, parsed.error.issues[0]?.message ?? 'Invalid request body');
	}

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverMutation(api.networks.update, {
				orgSlug: params.slug,
				networkId: params.networkId as any,
				name: parsed.data.name,
				description: parsed.data.description
			});
			return json({ data: result });
		} catch (err) {
			console.error('[NetworkDetail.PATCH] Convex failed, falling back to Prisma:', err);
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

	const data: Record<string, string> = {};
	if (parsed.data.name !== undefined) data.name = parsed.data.name;
	if (parsed.data.description !== undefined) data.description = parsed.data.description;

	const updated = await db.orgNetwork.update({
		where: { id: params.networkId },
		data
	});

	return json({
		data: {
			id: updated.id,
			name: updated.name,
			description: updated.description,
			updatedAt: updated.updatedAt.toISOString()
		}
	});
};
