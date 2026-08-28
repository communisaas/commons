import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent, url }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');

	const { org, membership } = await parent();

	const convexNetwork = await serverQuery(api.networks.get, {
		orgSlug: org.slug,
		networkId: params.networkId as Id<'orgNetworks'>,
		memberCursor: url.searchParams.get('memberCursor') || undefined,
		memberLimit: 50
	});

	if (!convexNetwork) throw error(404, 'Network not found');

	const proofPressure = await serverQuery(api.networks.getProofPressure, {
		networkId: params.networkId as Id<'orgNetworks'>,
		orgSlug: org.slug,
		limit: 12
	});
	const stats = await serverQuery(api.networks.getStats, {
		networkId: params.networkId as Id<'orgNetworks'>,
		orgSlug: org.slug
	});

	return {
		proofPressure,
		network: {
			id: convexNetwork._id,
			name: convexNetwork.name,
			slug: convexNetwork.slug,
			description: convexNetwork.description ?? null,
			status: convexNetwork.status,
			ownerOrg: convexNetwork.ownerOrg,
			isOwner: !!(
				convexNetwork.ownerOrg &&
				(convexNetwork.ownerOrg as Record<string, unknown>).slug === org.slug
			)
		},
		isAdmin: convexNetwork.callerRole === 'admin',
		members: ((convexNetwork.members as Array<Record<string, unknown>>) ?? []).map(
			(m: Record<string, unknown>) => ({
				id: m._id,
				orgId: m.orgId,
				orgName: m.orgName,
				orgSlug: m.orgSlug,
				role: m.role,
				status: 'active',
				supporterCount: 0,
				joinedAt:
					typeof m.joinedAt === 'number'
						? new Date(m.joinedAt as number).toISOString()
						: String(m.joinedAt),
				isOwnerOrg: !!(
					convexNetwork.ownerOrg &&
					(convexNetwork.ownerOrg as Record<string, unknown>)._id === m.orgId
				)
			})
		),
		stats,
		membersHasMore: convexNetwork.membersHasMore,
		memberNextCursor: convexNetwork.memberNextCursor
	};
};
