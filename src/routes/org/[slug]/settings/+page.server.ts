import { tryDecryptPii, type EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import type { PageServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ parent, params }) => {
	const { org, membership } = await parent();

	const data = await serverQuery(api.organizations.getSettingsData, { slug: params.slug });

	// Invite emails are client-encrypted — pass through as-is for client-side decryption
	const invites = (data.invites ?? []).map((i: { _id: string; encryptedEmail: string; role: string; expiresAt: number }) => ({
		id: i._id,
		encryptedEmail: i.encryptedEmail,
		role: i.role,
		expiresAt: new Date(i.expiresAt).toISOString()
	}));

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
		members: await Promise.all(data.members.map(async (m: Record<string, unknown>) => {
			let name = m.name as string | null;
			let email = m.email as string | null;
			// Decrypt encrypted PII blobs server-side (encryption keys are server-only)
			if (!name && m.encryptedName) {
				try {
					const enc: EncryptedPii = JSON.parse(m.encryptedName as string);
					name = await tryDecryptPii(enc, m.userId as string, 'name') ?? null;
				} catch { /* decryption failed */ }
			}
			if (!email && m.encryptedEmail) {
				try {
					const enc: EncryptedPii = JSON.parse(m.encryptedEmail as string);
					email = await tryDecryptPii(enc, m.userId as string, 'email') ?? null;
				} catch { /* decryption failed */ }
			}
			return {
				id: m._id,
				userId: m.userId,
				name,
				email,
				avatar: m.avatar,
				role: m.role,
				joinedAt: typeof m.joinedAt === 'number'
					? new Date(m.joinedAt as number).toISOString()
					: String(m.joinedAt)
			};
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
};
