import { db } from '$lib/core/db';
import { getOrgUsage } from '$lib/server/billing/usage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { org, membership } = await parent();

	const [subscription, usage, members, invites, issueDomains] = await Promise.all([
		db.subscription.findUnique({ where: { orgId: org.id } }),
		getOrgUsage(org.id),
		db.orgMembership.findMany({
			where: { orgId: org.id },
			include: {
				user: { select: { id: true, name: true, email: true, avatar: true } }
			},
			orderBy: { joinedAt: 'asc' }
		}),
		db.orgInvite.findMany({
			where: { orgId: org.id, accepted: false, expiresAt: { gt: new Date() } },
			orderBy: { expiresAt: 'asc' },
			take: 200
		}),
		db.orgIssueDomain.findMany({
			where: { orgId: org.id },
			select: { id: true, label: true, description: true, weight: true, createdAt: true, updatedAt: true },
			orderBy: { createdAt: 'asc' },
			take: 500
		})
	]);

	return {
		subscription: subscription
			? {
					plan: subscription.plan,
					status: subscription.status,
					priceCents: subscription.price_cents,
					currentPeriodEnd: subscription.current_period_end.toISOString()
				}
			: null,
		usage: {
			verifiedActions: usage.verifiedActions,
			maxVerifiedActions: usage.limits.maxVerifiedActions,
			emailsSent: usage.emailsSent,
			maxEmails: usage.limits.maxEmails
		},
		members: members.map((m) => ({
			id: m.id,
			userId: m.user.id,
			name: m.user.name,
			email: m.user.email,
			avatar: m.user.avatar,
			role: m.role,
			joinedAt: m.joinedAt.toISOString()
		})),
		invites: ['editor', 'owner'].includes(membership.role)
			? invites.map((i) => ({
					id: i.id,
					email: i.email,
					role: i.role,
					expiresAt: i.expiresAt.toISOString()
				}))
			: [],
		issueDomains: issueDomains.map((d) => ({
			id: d.id,
			label: d.label,
			description: d.description,
			weight: d.weight,
			createdAt: d.createdAt.toISOString(),
			updatedAt: d.updatedAt.toISOString()
		}))
	};
};
