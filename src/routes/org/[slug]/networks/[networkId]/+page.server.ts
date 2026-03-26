import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');

	const { org, membership } = await parent();

	const convexNetwork = await serverQuery(api.networks.get, {
		orgSlug: org.slug,
		networkId: params.networkId as any
	});

	if (!convexNetwork) throw error(404, 'Network not found');

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
};
