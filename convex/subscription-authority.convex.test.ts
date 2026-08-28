/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const PERIOD_END = NOW + 30 * 24 * 60 * 60 * 1000;
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

async function insertOrg(t: Harness, suffix: string): Promise<Id<'organizations'>> {
	return await t.run((ctx) =>
		ctx.db.insert('organizations', {
			name: `Subscription ${suffix}`,
			slug: `subscription-${suffix}`,
			maxSeats: 99,
			maxTemplatesMonth: 99,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: false,
			memberCount: 1,
			verifiedActionsLifetime: 0,
			sentEmailCount: 0,
			emailReservedCount: 0,
			smsSentCount: 0,
			updatedAt: NOW
		})
	);
}

async function insertUser(t: Harness, suffix: string): Promise<Id<'users'>> {
	return await t.run((ctx) =>
		ctx.db.insert('users', {
			tokenIdentifier: `https://issuer.example|subscription-${suffix}`,
			email: `${suffix}@example.test`,
			updatedAt: NOW,
			isVerified: false,
			authorityLevel: 0,
			trustTier: 0,
			trustScore: 0,
			reputationTier: 'newcomer',
			districtVerified: false,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 0,
			profileVisibility: 'private'
		})
	);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe('subscription authority and bounded maintenance', () => {
	it('creates a post-cutover organization with ready zero usage and no delivery authority', async () => {
		const t = convexTest({ schema, modules });
		await insertUser(t, 'new-org');
		await t.run(async (ctx) => {
			await ctx.db.insert('planUsageMigrations', {
				key: 'v1',
				status: 'ready',
				runToken: 'post-cutover-new-org',
				phase: 'complete',
				verifiedActions: 0,
				emailsSent: 0,
				emailReserved: 0,
				smsSent: 0,
				restarts: 0,
				scannedOrganizations: 0,
				projectedOrganizations: 0,
				scannedSourceRows: 0,
				startedAt: NOW,
				completedAt: NOW,
				updatedAt: NOW
			});
			await ctx.db.insert('contactAuthorityMigrations', {
				key: 'contact-authority-v1',
				status: 'ready',
				scanned: 0,
				startedAt: NOW,
				completedAt: NOW,
				updatedAt: NOW
			});
		});
		const authed = t.withIdentity({
			tokenIdentifier: 'https://issuer.example|subscription-new-org',
			subject: 'subscription-new-org',
			issuer: 'https://issuer.example'
		});
		const created = await authed.mutation(api.organizations.create, {
			name: 'Post Cutover Org',
			slug: 'post-cutover-org'
		});
		const plan = await authed.query(api.subscriptions.checkPlanLimits, {
			orgSlug: created.slug
		});
		expect(plan).toMatchObject({
			plan: 'inactive',
			status: 'none',
			usageReady: true,
			limits: { maxEmails: 0, maxSms: 0 },
			current: { emailsSent: 0, emailsReserved: 0, smsSent: 0 }
		});

		const executionId = await t.run(async (ctx) => {
			const supporterId = await ctx.db.insert('supporters', {
				orgId: created._id,
				encryptedEmail: 'new-org-ciphertext',
				emailHash: 'new-org-email-hash',
				globalEmailHash: 'new-org-global-email-hash',
				verified: false,
				emailStatus: 'subscribed',
				smsStatus: 'none',
				updatedAt: NOW
			});
			const workflowId = await ctx.db.insert('workflows', {
				orgId: created._id,
				name: 'No free delivery',
				trigger: { type: 'supporter_created' },
				steps: [{ type: 'send_email', emailSubject: 'No', emailBody: '<p>No</p>' }],
				enabled: true,
				updatedAt: NOW
			});
			return await ctx.db.insert('workflowExecutions', {
				workflowId,
				supporterId,
				triggerEvent: {},
				status: 'running',
				currentStep: 0
			});
		});
		await expect(
			t.mutation(internal.workflows.claimWorkflowEmailDispatch, {
				executionId,
				stepIndex: 0
			})
		).rejects.toThrow('EMAIL_QUOTA_EXCEEDED');
		await expect(t.run((ctx) => ctx.db.query('planUsageReservations').collect())).resolves.toEqual(
			[]
		);
	});

	it('enforces exactly one owner and preserves plan scope on every mutation path', async () => {
		const t = convexTest({ schema, modules });
		const orgId = await insertOrg(t, 'scope');
		const userId = await insertUser(t, 'scope');
		const base = {
			plan: 'starter' as const,
			priceCents: 1_000,
			status: 'active' as const,
			paymentMethod: 'stripe' as const,
			currentPeriodStart: NOW,
			currentPeriodEnd: PERIOD_END
		};

		await expect(t.mutation(internal.subscriptions.create, base)).rejects.toThrow(
			'SUBSCRIPTION_OWNER_XOR_REQUIRED'
		);
		await expect(
			t.mutation(internal.subscriptions.create, { ...base, orgId, userId })
		).rejects.toThrow('SUBSCRIPTION_OWNER_XOR_REQUIRED');
		await expect(
			t.mutation(internal.subscriptions.create, {
				...base,
				userId
			})
		).rejects.toThrow('SUBSCRIPTION_PLAN_SCOPE_INVALID');

		const subscriptionId = await t.mutation(internal.subscriptions.create, {
			...base,
			orgId,
			stripeSubscriptionId: 'sub_scope'
		});
		await expect(
			t.mutation(internal.subscriptions.update, {
				subscriptionId,
				plan: 'voice'
			})
		).rejects.toThrow('SUBSCRIPTION_PLAN_SCOPE_INVALID');
		await expect(
			t.mutation(internal.subscriptions.updateByStripeId, {
				stripeSubscriptionId: 'sub_scope',
				status: 'active',
				plan: 'advocate'
			})
		).rejects.toThrow('SUBSCRIPTION_PLAN_SCOPE_INVALID');
	});

	it('blocks the authority audit and entitlement readers on duplicate owner identity', async () => {
		const t = convexTest({ schema, modules });
		const orgId = await insertOrg(t, 'duplicate');
		await t.run(async (ctx) => {
			for (const suffix of ['a', 'b']) {
				await ctx.db.insert('subscriptions', {
					orgId,
					plan: 'starter',
					priceCents: 1_000,
					status: 'active',
					paymentMethod: 'stripe',
					stripeSubscriptionId: `sub_duplicate_${suffix}`,
					currentPeriodStart: NOW,
					currentPeriodEnd: PERIOD_END,
					updatedAt: NOW
				});
			}
		});

		await expect(t.query(internal.subscriptions.checkPlanLimitsByOrgId, { orgId })).rejects.toThrow(
			'SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED'
		);
		await expect(
			t.mutation(internal.subscriptions.auditSubscriptionAuthority, {})
		).resolves.toMatchObject({
			status: 'blocked',
			failureCode: expect.stringContaining('SUBSCRIPTION_OWNER_CARDINALITY_INVALID')
		});
		await expect(
			t.query(internal.subscriptions.subscriptionAuthorityStatus, {})
		).resolves.toMatchObject({ status: 'blocked' });
	});

	it('adopts a legacy past-due coordinate and durably expires grace', async () => {
		const t = convexTest({ schema, modules });
		const orgId = await insertOrg(t, 'grace');
		const subscriptionId = await t.run((ctx) =>
			ctx.db.insert('subscriptions', {
				orgId,
				plan: 'starter',
				priceCents: 1_000,
				status: 'past_due',
				paymentMethod: 'stripe',
				stripeSubscriptionId: 'sub_grace',
				currentPeriodStart: NOW,
				currentPeriodEnd: PERIOD_END,
				updatedAt: NOW
			})
		);
		await expect(
			t.mutation(internal.subscriptions.auditSubscriptionAuthority, {})
		).resolves.toMatchObject({
			status: 'blocked',
			failureCode: expect.stringContaining('SUBSCRIPTION_PAST_DUE_COORDINATE_MISSING')
		});

		await expect(t.mutation(internal.subscriptions.sweepPastDueGrace, {})).resolves.toMatchObject({
			status: 'complete',
			scanned: 1,
			adopted: 1,
			expired: 0
		});
		await expect(t.run((ctx) => ctx.db.get(subscriptionId))).resolves.toMatchObject({
			status: 'past_due',
			pastDueSince: NOW,
			pastDueExpiryScheduledAt: NOW + GRACE_MS
		});
		await expect(
			t.mutation(internal.subscriptions.auditSubscriptionAuthority, { retryBlocked: true })
		).resolves.toMatchObject({ status: 'ready', scanned: 1 });

		vi.setSystemTime(NOW + GRACE_MS + 1);
		await expect(
			t.mutation(internal.subscriptions.expirePastDueGrace, {
				subscriptionId,
				expectedPastDueSince: NOW
			})
		).resolves.toEqual({ status: 'expired' });
		await expect(t.run((ctx) => ctx.db.get(subscriptionId))).resolves.toMatchObject({
			status: 'canceled'
		});
		await expect(t.run((ctx) => ctx.db.get(orgId))).resolves.toMatchObject({
			maxSeats: 1,
			maxTemplatesMonth: 2
		});
	});

	it('self-pages both historical maintenance jobs instead of collecting their tables', async () => {
		const t = convexTest({ schema, modules });
		const orgIds: Array<Id<'organizations'>> = [];
		for (let index = 0; index < 31; index += 1) {
			orgIds.push(await insertOrg(t, `backfill-${index}`));
		}
		const campaignId = await t.run((ctx) =>
			ctx.db.insert('campaigns', {
				orgId: orgIds[0]!,
				type: 'LETTER',
				title: 'Backfill campaign',
				status: 'ACTIVE',
				debateEnabled: false,
				debateThreshold: 0,
				raisedAmountCents: 0,
				donorCount: 0,
				targetCountry: 'US',
				updatedAt: NOW
			})
		);
		await t.run(async (ctx) => {
			for (let index = 0; index < 105; index += 1) {
				await ctx.db.insert('campaignActions', {
					campaignId,
					verified: false,
					engagementTier: 0,
					delegated: false,
					sentAt: NOW + index
				});
			}
		});

		await expect(t.mutation(internal.subscriptions.backfillOrgLimits, {})).resolves.toMatchObject({
			status: 'running',
			total: 25
		});
		await expect(
			t.mutation(internal.subscriptions.backfillCampaignActionOrgIds, {})
		).resolves.toMatchObject({ status: 'running', total: 100 });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		await t.run(async (ctx) => {
			for (const orgId of orgIds) {
				await expect(ctx.db.get(orgId)).resolves.toMatchObject({
					maxSeats: 1,
					maxTemplatesMonth: 2
				});
			}
			const actions = await ctx.db.query('campaignActions').collect();
			expect(actions).toHaveLength(105);
			expect(actions.every((action) => action.orgId === orgIds[0])).toBe(true);
		});
	});
});
