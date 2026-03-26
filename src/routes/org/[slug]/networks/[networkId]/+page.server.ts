import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { getNetworkProofPressure } from '$lib/server/legislation/receipts/aggregation';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');

	const { org, membership } = await parent();

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const convexNetwork = await serverQuery(api.networks.get, {
				orgSlug: org.slug,
				networkId: params.networkId as any
			});

			if (!convexNetwork) throw error(404, 'Network not found');

			console.log(`[Network Detail] Convex: loaded network ${params.networkId} for ${org.slug}`);

			const proofPressure = FEATURES.ACCOUNTABILITY
				? await getNetworkProofPressure(params.networkId)
				: [];

			return {
				proofPressure,
				network: {
					id: convexNetwork._id,
					name: convexNetwork.name,
					slug: convexNetwork.slug,
					description: convexNetwork.description ?? null,
					status: convexNetwork.status,
					ownerOrg: convexNetwork.ownerOrg,
					isOwner: !!(convexNetwork.ownerOrg && (convexNetwork.ownerOrg as Record<string, unknown>).slug === org.slug)
				},
				isAdmin: (convexNetwork.members as Array<Record<string, unknown>>)?.some(
					(m: Record<string, unknown>) => m.orgSlug === org.slug && m.role === 'admin'
				) ?? false,
				members: ((convexNetwork.members as Array<Record<string, unknown>>) ?? []).map((m: Record<string, unknown>) => ({
					id: m._id,
					orgId: m.orgId,
					orgName: m.orgName,
					orgSlug: m.orgSlug,
					role: m.role,
					status: 'active',
					supporterCount: 0,
					joinedAt: typeof m.joinedAt === 'number'
						? new Date(m.joinedAt as number).toISOString()
						: String(m.joinedAt),
					isOwnerOrg: !!(convexNetwork.ownerOrg && (convexNetwork.ownerOrg as Record<string, unknown>)._id === m.orgId)
				})),
				stats: {
					memberCount: convexNetwork.memberCount ?? 0,
					totalSupporters: 0,
					uniqueSupporters: 0,
					verifiedSupporters: 0
				}
			};
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('[Network Detail] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

	const network = await db.orgNetwork.findUnique({
		where: { id: params.networkId },
		include: {
			ownerOrg: { select: { id: true, name: true, slug: true } },
			members: {
				where: { status: { in: ['active', 'pending'] } },
				include: { org: { select: { id: true, name: true, slug: true } } },
				orderBy: { joinedAt: 'asc' }
			}
		}
	});

	if (!network) throw error(404, 'Network not found');

	// Verify the current org is a member
	const currentMembership = network.members.find((m) => m.orgId === org.id);
	if (!currentMembership || currentMembership.status === 'removed') {
		throw error(403, 'Not a member of this network');
	}

	if (currentMembership.status === 'pending') {
		// Pending orgs see only the invitation, not full network data
		return {
			proofPressure: [],
			network: {
				id: network.id,
				name: network.name,
				slug: network.slug,
				description: network.description,
				status: network.status,
				ownerOrg: network.ownerOrg,
				isOwner: false
			},
			isAdmin: false,
			isPending: true,
			members: [],
			stats: { memberCount: 0, totalSupporters: 0, uniqueSupporters: 0, verifiedSupporters: 0 }
		};
	}

	const isAdmin = currentMembership.role === 'admin';

	// Get supporter counts per member org
	const activeMembers = network.members.filter((m) => m.status === 'active');
	const activeMemberOrgIds = activeMembers.map((m) => m.orgId);

	const supporterCounts = await db.supporter.groupBy({
		by: ['orgId'],
		where: { orgId: { in: activeMemberOrgIds } },
		_count: { id: true }
	});

	const supporterMap = new Map(supporterCounts.map((s) => [s.orgId, s._count.id]));

	// Aggregate stats
	const totalSupporters = supporterCounts.reduce((sum, s) => sum + s._count.id, 0);

	// Unique supporters by email_hash across member orgs
	const uniqueResult = await db.supporter.groupBy({
		by: ['email_hash'],
		where: { orgId: { in: activeMemberOrgIds } },
		_count: { email_hash: true }
	});
	const uniqueSupporters = uniqueResult.length;

	// Verified supporters (identity-verified)
	const verifiedResult = await db.supporter.count({
		where: {
			orgId: { in: activeMemberOrgIds },
			verified: true
		}
	});

	// Proof pressure aggregation (gated)
	const proofPressure = FEATURES.ACCOUNTABILITY
		? await getNetworkProofPressure(params.networkId)
		: [];

	return {
		proofPressure,
		network: {
			id: network.id,
			name: network.name,
			slug: network.slug,
			description: network.description,
			status: network.status,
			ownerOrg: network.ownerOrg,
			isOwner: network.ownerOrgId === org.id
		},
		isAdmin,
		members: network.members.map((m) => ({
			id: m.id,
			orgId: m.orgId,
			orgName: m.org.name,
			orgSlug: m.org.slug,
			role: m.role,
			status: m.status,
			supporterCount: supporterMap.get(m.orgId) ?? 0,
			joinedAt: m.joinedAt.toISOString(),
			isOwnerOrg: m.orgId === network.ownerOrgId
		})),
		stats: {
			memberCount: activeMembers.length,
			totalSupporters,
			uniqueSupporters,
			verifiedSupporters: verifiedResult
		}
	};
};
