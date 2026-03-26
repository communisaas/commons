import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');

	const { org, membership } = await parent();

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const convexNetworks = await serverQuery(api.networks.list, { orgSlug: org.slug });

			console.log(`[Networks] Convex: loaded ${convexNetworks.length} networks for ${org.slug}`);

			// Still need subscription from Prisma for canCreate check
			const subscription = await db.subscription.findUnique({ where: { orgId: org.id } });

			return {
				networks: convexNetworks.map((n: Record<string, unknown>) => ({
					id: n._id,
					name: n.name,
					slug: n.slug,
					description: n.description ?? null,
					status: n.status,
					role: n.role,
					membershipStatus: n.memberStatus,
					memberCount: n.memberCount,
					ownerOrg: n.ownerOrg,
					isOwner: !!(n.ownerOrg && (n.ownerOrg as Record<string, unknown>).slug === org.slug),
					joinedAt: typeof n._creationTime === 'number'
						? new Date(n._creationTime as number).toISOString()
						: String(n._creationTime)
				})),
				canCreate: subscription?.plan === 'coalition' && membership.role === 'owner'
			};
		} catch (err) {
			console.error('[Networks] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

	const [memberships, subscription] = await Promise.all([
		db.orgNetworkMember.findMany({
			where: { orgId: org.id, status: { in: ['active', 'pending'] } },
			include: {
				network: {
					include: {
						ownerOrg: { select: { id: true, name: true, slug: true } },
						_count: { select: { members: { where: { status: 'active' } } } }
					}
				}
			},
			orderBy: { joinedAt: 'desc' }
		}),
		db.subscription.findUnique({ where: { orgId: org.id } })
	]);

	return {
		networks: memberships.map((m) => ({
			id: m.network.id,
			name: m.network.name,
			slug: m.network.slug,
			description: m.network.description,
			status: m.network.status,
			role: m.role,
			membershipStatus: m.status,
			memberCount: m.network._count.members,
			ownerOrg: m.network.ownerOrg,
			isOwner: m.network.ownerOrgId === org.id,
			joinedAt: m.joinedAt.toISOString()
		})),
		canCreate: subscription?.plan === 'coalition' && membership.role === 'owner'
	};
};
