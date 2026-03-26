/**
 * POST /api/org/[slug]/networks — Create a new coalition network
 * GET  /api/org/[slug]/networks — List networks the org belongs to
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { orgMeetsPlan } from '$lib/server/billing/plan-check';
import { FEATURES } from '$lib/config/features';
import { z } from 'zod';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

const CreateNetworkSchema = z.object({
	name: z.string().min(3, 'Name must be at least 3 characters').max(100, 'Name must be at most 100 characters'),
	slug: z.string().min(3).max(50).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
	description: z.string().max(500).optional()
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

	const parsed = CreateNetworkSchema.safeParse(body);
	if (!parsed.success) {
		throw error(400, parsed.error.issues[0]?.message ?? 'Invalid request body');
	}

	const { name, slug, description } = parsed.data;

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const networkId = await serverMutation(api.networks.create, {
				orgSlug: params.slug,
				name,
				slug,
				description: description ?? undefined
			});
			return json({ data: { id: networkId, name, slug, description: description ?? null, status: 'active', createdAt: new Date().toISOString() } }, { status: 201 });
		} catch (err) {
			console.error('[NetworkCreate] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
	requireRole(membership.role, 'owner');

	const meetsPlan = await orgMeetsPlan(org.id, 'coalition');
	if (!meetsPlan) throw error(403, 'Networks require a Coalition plan');

	try {
		const network = await db.orgNetwork.create({
			data: {
				name,
				slug,
				description: description ?? null,
				ownerOrgId: org.id,
				members: {
					create: {
						orgId: org.id,
						role: 'admin',
						status: 'active',
						invitedBy: locals.user.id
					}
				}
			}
		});

		return json({
			data: {
				id: network.id,
				name: network.name,
				slug: network.slug,
				description: network.description,
				status: network.status,
				createdAt: network.createdAt.toISOString()
			}
		}, { status: 201 });
	} catch (err: unknown) {
		if (
			typeof err === 'object' && err !== null && 'code' in err &&
			(err as { code: string }).code === 'P2002'
		) {
			throw error(409, 'A network with this slug already exists');
		}
		throw err;
	}
};

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const result = await serverQuery(api.networks.list, { slug: params.slug });
			return json({ data: result });
		} catch (err) {
			console.error('[NetworkList] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const { org } = await loadOrgContext(params.slug, locals.user.id);

	const memberships = await db.orgNetworkMember.findMany({
		where: {
			orgId: org.id,
			status: { in: ['active', 'pending'] }
		},
		include: {
			network: {
				include: {
					ownerOrg: { select: { id: true, name: true, slug: true } },
					_count: { select: { members: { where: { status: 'active' } } } }
				}
			}
		},
		orderBy: { joinedAt: 'desc' }
	});

	return json({
		data: memberships.map((m) => ({
			id: m.network.id,
			name: m.network.name,
			slug: m.network.slug,
			description: m.network.description,
			status: m.network.status,
			role: m.role,
			memberStatus: m.status,
			memberCount: m.network._count.members,
			ownerOrg: m.network.ownerOrg,
			createdAt: m.network.createdAt.toISOString()
		}))
	});
};
