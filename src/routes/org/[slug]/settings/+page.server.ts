// Member PII: plaintext name/email returned from Convex (user-level, not org-encrypted)
import type { PageServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ parent, params }) => {
	const { org, membership } = await parent();

	const isEditor = membership.role === 'owner' || membership.role === 'editor';
	const [data, keyInfo] = await Promise.all([
		serverQuery(api.organizations.getSettingsData, { slug: params.slug }),
		isEditor
			? serverQuery(api.organizations.getOrgKeyVerifier, { slug: params.slug })
			: Promise.resolve({ orgKeyVerifier: null, hasRecoveryKey: false, piiVersion: 'legacy' })
	]);

	// Invite emails are client-encrypted — pass through as-is for client-side decryption
	const invites = (data.invites ?? []).map((i: { _id: string; encryptedEmail: string; emailHash?: string; role: string; expiresAt: number }) => ({
		id: i._id,
		encryptedEmail: i.encryptedEmail,
		emailHash: i.emailHash ?? null,
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
		members: data.members.map((m: Record<string, unknown>) => ({
			id: m._id,
			userId: m.userId,
			name: (m.name as string | null) ?? null,
			email: (m.email as string | null) ?? null,
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
		})),
		encryption: {
			orgKeyVerifier: keyInfo.orgKeyVerifier,
			hasRecoveryKey: keyInfo.hasRecoveryKey,
			recoveryWrappedOrgKey: keyInfo.recoveryWrappedOrgKey,
			piiVersion: keyInfo.piiVersion
		}
	};
};
