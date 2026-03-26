import { tryDecryptPii, type EncryptedPii } from '$lib/core/crypto/user-pii-encryption';
import type { PageServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ parent, params }) => {
	const { org, membership } = await parent();

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
};
