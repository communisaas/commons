import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

type NetworkListItem = {
	_id: string;
	name: string;
	slug: string;
	description?: string | null;
	status: string;
	role?: string | null;
	memberStatus?: string | null;
	memberCount?: number;
	ownerOrg?: { slug?: string } | null;
	_creationTime: number;
};

type SubscriptionSummary = {
	plan: string;
} | null;

export const load: PageServerLoad = async ({ parent }) => {
	if (!FEATURES.NETWORKS) throw error(404, 'Not found');

	const { org, membership } = await parent();

	const [convexNetworks, subscription] = await Promise.all([
		serverQuery(api.networks.list, { orgSlug: org.slug }) as Promise<NetworkListItem[]>,
		serverQuery(api.subscriptions.getByOrg, { orgSlug: org.slug }) as Promise<SubscriptionSummary>
	]);

	return {
		networks: convexNetworks.map((n) => ({
			id: n._id,
			name: n.name,
			slug: n.slug,
			description: n.description ?? null,
			status: n.status,
			role: n.role,
			membershipStatus: n.memberStatus,
			memberCount: n.memberCount,
			ownerOrg: n.ownerOrg,
			isOwner: n.ownerOrg?.slug === org.slug,
			joinedAt: typeof n._creationTime === 'number'
				? new Date(n._creationTime).toISOString()
				: String(n._creationTime)
		})),
		canCreate: subscription?.plan === 'coalition' && membership.role === 'owner'
	};
};
