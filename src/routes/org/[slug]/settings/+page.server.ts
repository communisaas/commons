// CONVEX: Blocked — needs Convex queries for subscription, usage, members (with PII decrypt), invites (with PII decrypt), issueDomains
import { db } from '$lib/core/db';
import { getOrgUsage } from '$lib/server/billing/usage';
import { decryptUserPii, tryDecryptPii, type EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { org, membership } = await parent();

	const [subscription, usage, members, invites, issueDomains] = await Promise.all([
		db.subscription.findUnique({ where: { orgId: org.id } }),
		getOrgUsage(org.id),
		db.orgMembership.findMany({
			where: { orgId: org.id },
			include: {
				user: { select: { id: true, encrypted_email: true, encrypted_name: true, avatar: true } }
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
		members: await Promise.all(members.map(async (m) => {
			const pii = await decryptUserPii(m.user).catch(() => ({ email: '[encrypted]', name: null }));
			return {
				id: m.id,
				userId: m.user.id,
				name: pii.name,
				email: pii.email,
				avatar: m.user.avatar,
				role: m.role,
				joinedAt: m.joinedAt.toISOString()
			};
		})),
		invites: ['editor', 'owner'].includes(membership.role)
			? await Promise.all(invites.map(async (i) => {
					let email = '[encrypted]';
					if (i.encrypted_email) {
						try {
							const enc: EncryptedPii = JSON.parse(i.encrypted_email);
							email = await tryDecryptPii(enc, 'org-invite:' + i.id) ?? '[encrypted]';
						} catch { /* decryption failed */ }
					}
					return {
						id: i.id,
						email,
						role: i.role,
						expiresAt: i.expiresAt.toISOString()
					};
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
