import { db } from '$lib/core/db';
import { getOrgUsage } from '$lib/server/billing/usage';
import { decryptUserPii, tryDecryptPii, type EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import type { PageServerLoad } from './$types';

// Convex dual-stack imports
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ parent, params }) => {
	const { org, membership } = await parent();

	// ─── DUAL-STACK: Try Convex first ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const data = await serverQuery(api.organizations.getSettingsData, { slug: params.slug });

			// PII decryption for invites happens on SvelteKit side (encryption keys are server-only)
			const invites = await Promise.all(
				(data.invites ?? []).map(async (i: { _id: string; encryptedEmail: string; role: string; expiresAt: number }) => {
					let email = '[encrypted]';
					if (i.encryptedEmail) {
						try {
							const enc: EncryptedPii = JSON.parse(i.encryptedEmail);
							email = await tryDecryptPii(enc, 'org-invite:' + i._id) ?? '[encrypted]';
						} catch { /* decryption failed */ }
					}
					return {
						id: i._id,
						email,
						role: i.role,
						expiresAt: new Date(i.expiresAt).toISOString()
					};
				})
			);

			return {
				subscription: data.subscription
					? {
						plan: data.subscription.plan,
						status: data.subscription.status,
						priceCents: data.subscription.priceCents,
						currentPeriodEnd: new Date(data.subscription.currentPeriodEnd).toISOString()
					}
					: null,
				usage: {
					verifiedActions: data.usage.verifiedActions,
					maxVerifiedActions: 1000, // Will be refined when plan limits are wired
					emailsSent: data.usage.emailsSent,
					maxEmails: 10000
				},
				members: data.members.map((m: Record<string, unknown>) => ({
					id: m._id,
					userId: m.userId,
					name: m.name,
					email: m.email,
					avatar: m.avatar,
					role: m.role,
					joinedAt: typeof m.joinedAt === 'number'
						? new Date(m.joinedAt as number).toISOString()
						: String(m.joinedAt)
				})),
				invites,
				issueDomains: (data.issueDomains ?? []).map((d: Record<string, unknown>) => ({
					id: d._id,
					label: d.label,
					description: d.description,
					weight: d.weight,
					createdAt: typeof d._creationTime === 'number'
						? new Date(d._creationTime as number).toISOString()
						: String(d._creationTime),
					updatedAt: typeof d.updatedAt === 'number'
						? new Date(d.updatedAt as number).toISOString()
						: String(d.updatedAt)
				}))
			};
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('[Settings] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
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
