import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');

	const { org, membership } = await parent();

	const [convexNetworks, subscription] = await Promise.all([
		serverQuery(api.networks.list, { orgSlug: org.slug }),
		serverQuery(api.organizations.getSubscription, { slug: org.slug })
	]);

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
};
