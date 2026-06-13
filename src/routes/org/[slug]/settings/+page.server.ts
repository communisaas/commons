// Member PII: plaintext name/email returned from Convex (user-level, not org-encrypted)
import type { PageServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { PLAN_ORDER, PLANS } from '$lib/server/billing/plans';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export const load: PageServerLoad = async ({ parent, params }) => {
	const { org, membership } = await parent();

	const isEditor = membership.role === 'owner' || membership.role === 'editor';
	const [data, keyInfo, planUsage] = await Promise.all([
		serverQuery(api.organizations.getSettingsData, { slug: params.slug }),
		isEditor
			? serverQuery(api.organizations.getOrgKeyVerifier, { slug: params.slug })
			: Promise.resolve({ orgKeyVerifier: null, hasRecoveryKey: false, piiVersion: 'legacy' }),
		serverQuery(api.subscriptions.checkPlanLimits, { orgSlug: params.slug })
	]);

	// Invite emails are client-encrypted — pass through as-is for client-side decryption
	const invites = (data.invites ?? []).map(
		(i: {
			_id: string;
			encryptedEmail: string;
			emailHash?: string;
			role: string;
			expiresAt: number;
		}) => ({
			id: i._id,
			encryptedEmail: i.encryptedEmail,
			emailHash: i.emailHash ?? null,
			role: i.role,
			expiresAt: new Date(i.expiresAt).toISOString()
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
			plan: planUsage.plan,
			status: planUsage.status,
			periodStart: new Date(planUsage.periodStart).toISOString(),
			verifiedActions: planUsage.current.verifiedActions,
			maxVerifiedActions: planUsage.limits.maxVerifiedActions,
			emailsSent: planUsage.current.emailsSent,
			maxEmails: planUsage.limits.maxEmails,
			smsSent: planUsage.current.smsSent,
			maxSms: planUsage.limits.maxSms,
			maxTemplatesMonth: planUsage.limits.maxTemplatesMonth
		},
		planCatalog: PLAN_ORDER.map((slug) => {
			const plan = PLANS[slug];
			const price = plan.priceCents === 0 ? '$0' : `$${plan.priceCents / 100}`;
			const features: Array<{
				label: string;
				state: 'live' | 'partial' | 'draft-only' | 'gated';
				detail: string;
			}> = [
				{
					label: `${plan.maxVerifiedActions.toLocaleString('en-US')} verified actions/mo`,
					state: 'live',
					detail: 'Quota enforced by billing limits.'
				},
				{
					label: `${plan.maxEmails.toLocaleString('en-US')} emails/mo`,
					state: 'live',
					detail: 'Quota enforced by email send gates.'
				},
				{
					label: `${plan.maxSeats.toLocaleString('en-US')} seats`,
					state: 'live',
					detail: 'Invite seat limit enforced before sending invites.'
				},
				{
					label: `${plan.maxTemplatesMonth.toLocaleString('en-US')} templates/mo`,
					state: 'live',
					detail: 'Template quota enforced by campaign template mutations.'
				}
			];

			if (plan.maxSms > 0) {
				features.push({
					label: `${plan.maxSms.toLocaleString('en-US')} SMS quota reserved`,
					state: 'draft-only',
					detail: 'Quota reserved for when bulk texting is fully available.'
				});
			}
			if (slug !== 'free') {
				features.push({
					label: 'A/B test setup',
					state: 'draft-only',
					detail:
						'Set up A/B tests with exact test groups and send the winner to the rest; automatic winner send-out is coming.'
				});
			}
			if (slug === 'organization' || slug === 'coalition') {
				features.push(
					{
						label: 'Custom sending domain',
						state: 'gated',
						detail: 'Not available yet.'
					},
					{
						label: 'SQL mirror',
						state: 'gated',
						detail: 'Not available yet.'
					}
				);
			}
			if (slug === 'coalition') {
				features.push(
					{
						label: 'Coalition network layer',
						state: 'partial',
						detail: 'Coalition networks work today; international coalition reporting is coming.'
					},
					{
						label: 'White-label surface',
						state: 'gated',
						detail: 'Not available yet.'
					}
				);
			}

			return {
				slug,
				name: plan.name,
				price,
				isApplied: planUsage.plan === slug,
				features
			};
		}),
		members: data.members.map((m: Record<string, unknown>) => ({
			id: m._id,
			userId: m.userId,
			name: (m.name as string | null) ?? null,
			email: (m.email as string | null) ?? null,
			avatar: typeof m.avatar === 'string' ? m.avatar : null,
			role: asString(m.role, 'member'),
			joinedAt:
				typeof m.joinedAt === 'number' ? new Date(m.joinedAt).toISOString() : String(m.joinedAt)
		})),
		invites,
		issueDomains: (data.issueDomains ?? []).map((d: Record<string, unknown>) => ({
			id: asString(d._id),
			label: asString(d.label),
			description: typeof d.description === 'string' ? d.description : null,
			weight: asNumber(d.weight, 1),
			createdAt:
				typeof d._creationTime === 'number'
					? new Date(d._creationTime).toISOString()
					: String(d._creationTime),
			updatedAt:
				typeof d.updatedAt === 'number' ? new Date(d.updatedAt).toISOString() : String(d.updatedAt)
		})),
		encryption: {
			orgKeyVerifier: keyInfo.orgKeyVerifier,
			hasRecoveryKey: keyInfo.hasRecoveryKey,
			recoveryWrappedOrgKey:
				'recoveryWrappedOrgKey' in keyInfo ? keyInfo.recoveryWrappedOrgKey : null,
			piiVersion: keyInfo.piiVersion
		}
	};
};
