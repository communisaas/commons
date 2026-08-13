/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'agentic-provider-capacity-secret-32-bytes';
const ORG_SLUG = 'agentic-capacity-org';
const SECOND_ORG_SLUG = 'second-agentic-org';
const PERIOD_START = Date.UTC(2026, 6, 1);
const PERIOD_END = Date.UTC(2026, 7, 1);
type Harness = TestConvex<typeof schema>;

async function seedPaidOrg(t: Harness): Promise<{
	orgId: Id<'organizations'>;
	userId: Id<'users'>;
}> {
	return await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier: 'https://issuer.example|agentic-capacity',
			email: 'agentic@example.test',
			updatedAt: PERIOD_START,
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
		});
		const orgId = await ctx.db.insert('organizations', {
			name: 'Agentic Capacity Org',
			slug: ORG_SLUG,
			maxSeats: 5,
			maxTemplatesMonth: 100,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			memberCount: 1,
			verifiedActionsLifetime: 0,
			sentEmailCount: 0,
			emailReservedCount: 0,
			smsSentCount: 0,
			updatedAt: PERIOD_START
		});
		await ctx.db.insert('orgMemberships', {
			userId,
			orgId,
			role: 'owner',
			joinedAt: PERIOD_START
		});
		return { orgId, userId };
	});
}

describe('payment-minted agentic provider capacity', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => vi.unstubAllEnvs());

	it('grants nothing for active plan state, then credits one idempotent settled invoice', async () => {
		const t = convexTest({ schema, modules });
		const { orgId, userId } = await seedPaidOrg(t);
		const checkoutCreated = PERIOD_START + 2 * 24 * 60 * 60 * 1_000;
		await t.action(internal.subscriptions.processStripeWebhook, {
			eventType: 'checkout.session.completed',
			data: {
				mode: 'subscription',
				subscription: 'sub_agentic_capacity',
				created: checkoutCreated / 1_000,
				metadata: { orgId, plan: 'starter' }
			}
		});

		await expect(
			t.query(api.metering.agenticResolveAdmission, {
				_secret: SECRET,
				userId,
				orgSlug: ORG_SLUG
			})
		).resolves.toMatchObject({
			scope: 'org',
			plan: 'starter',
			providerBalance: {
				state: 'blocked',
				why: 'settled capacity was not found at the active billing period'
			},
			used: 0,
			allowed: false
		});

		// Stripe's initial invoice header is degenerate. Its subscription line
		// carries the real service window and must replace checkout's synthetic one.
		const webhook = {
			eventType: 'invoice.payment_succeeded',
			data: {
				id: 'in_agentic_capacity_1',
				amount_paid: 1_000,
				period_start: checkoutCreated / 1_000,
				period_end: checkoutCreated / 1_000,
				lines: {
					data: [
						{
							parent: {
								type: 'subscription_item_details',
								subscription_item_details: { subscription_item: 'si_agentic_capacity' }
							},
							period: { start: PERIOD_START / 1_000, end: PERIOD_END / 1_000 }
						}
					]
				},
				parent: { subscription_details: { subscription: 'sub_agentic_capacity' } }
			}
		};
		await t.action(internal.subscriptions.processStripeWebhook, webhook);
		await t.action(internal.subscriptions.processStripeWebhook, webhook);

		await expect(
			t.query(api.metering.agenticResolveAdmission, {
				_secret: SECRET,
				userId,
				orgSlug: ORG_SLUG
			})
		).resolves.toMatchObject({
			scope: 'org',
			orgId,
			plan: 'starter',
			billingPeriodStart: PERIOD_START,
			billingPeriodEnd: PERIOD_END,
			providerBalance: { state: 'present', value: { balanceUnits: 830, allowance: 5 } },
			used: 0,
			allowed: true
		});
		await expect(
			t.run(async (ctx) => ({
				receipts: (await ctx.db.query('agenticProviderReceipts').collect()).length,
				balances: await ctx.db.query('agenticProviderBalances').collect(),
				subscription: await ctx.db
					.query('subscriptions')
					.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
					.unique()
			}))
		).resolves.toMatchObject({
			receipts: 1,
			balances: [{ orgId, balanceUnits: 830, amountPaidCents: 1_000 }],
			subscription: { currentPeriodStart: PERIOD_START, currentPeriodEnd: PERIOD_END }
		});
	});

	it('reads the Dahlia subscription-item period instead of removed subscription fields', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedPaidOrg(t);
		await t.action(internal.subscriptions.processStripeWebhook, {
			eventType: 'checkout.session.completed',
			data: {
				mode: 'subscription',
				subscription: 'sub_item_period',
				created: (PERIOD_START + 10_000) / 1_000,
				metadata: { orgId, plan: 'starter' }
			}
		});
		await t.action(internal.subscriptions.processStripeWebhook, {
			eventType: 'customer.subscription.updated',
			data: {
				id: 'sub_item_period',
				status: 'active',
				items: {
					data: [
						{
							current_period_start: PERIOD_START / 1_000,
							current_period_end: PERIOD_END / 1_000,
							price: { lookup_key: 'starter', unit_amount: 1_000 }
						}
					]
				}
			}
		});

		await expect(
			t.run(async (ctx) =>
				ctx.db
					.query('subscriptions')
					.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
					.unique()
			)
		).resolves.toMatchObject({
			currentPeriodStart: PERIOD_START,
			currentPeriodEnd: PERIOD_END
		});
	});

	it('recovers past_due before rejecting an unrelated malformed capacity proof', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedPaidOrg(t);
		await t.action(internal.subscriptions.processStripeWebhook, {
			eventType: 'checkout.session.completed',
			data: {
				mode: 'subscription',
				subscription: 'sub_recovery',
				created: PERIOD_START / 1_000,
				metadata: { orgId, plan: 'starter' }
			}
		});
		await t.action(internal.subscriptions.processStripeWebhook, {
			eventType: 'invoice.payment_failed',
			data: { parent: { subscription_details: { subscription: 'sub_recovery' } } }
		});
		await expect(
			t.action(internal.subscriptions.processStripeWebhook, {
				eventType: 'invoice.payment_succeeded',
				data: {
					id: 'in_recovery',
					amount_paid: 1_000,
					period_start: PERIOD_START / 1_000,
					period_end: PERIOD_START / 1_000,
					parent: { subscription_details: { subscription: 'sub_recovery' } }
				}
			})
		).rejects.toThrow('AGENTIC_PROVIDER_PAYMENT_PROOF_INVALID');

		await expect(
			t.run(async (ctx) =>
				ctx.db
					.query('subscriptions')
					.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
					.unique()
			)
		).resolves.toMatchObject({ status: 'active' });
	});
});

describe('agentic resolve admission scope', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => vi.unstubAllEnvs());

	it('keeps a member on the person lane when no org context is declared', async () => {
		const t = convexTest({ schema, modules });
		const { userId } = await seedPaidOrg(t);

		await expect(
			t.query(api.metering.agenticResolveAdmission, { _secret: SECRET, userId })
		).resolves.toEqual({ scope: 'individual' });
	});

	it('puts a declared org on the org lane at the unpaid floor', async () => {
		const t = convexTest({ schema, modules });
		const { orgId, userId } = await seedPaidOrg(t);

		await expect(
			t.query(api.metering.agenticResolveAdmission, {
				_secret: SECRET,
				userId,
				orgSlug: ORG_SLUG
			})
		).resolves.toMatchObject({
			scope: 'org',
			orgId,
			plan: 'inactive',
			providerBalance: { state: 'absent' },
			used: 0,
			allowed: false
		});
	});

	it('answers a non-member, an unknown slug, and an empty slug identically', async () => {
		const t = convexTest({ schema, modules });
		await seedPaidOrg(t);
		const outsiderId = await t.run(async (ctx) =>
			ctx.db.insert('users', {
				tokenIdentifier: 'https://issuer.example|agentic-outsider',
				email: 'outsider@example.test',
				updatedAt: PERIOD_START,
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

		for (const orgSlug of [ORG_SLUG, 'no-such-org-anywhere', '']) {
			await expect(
				t.query(api.metering.agenticResolveAdmission, {
					_secret: SECRET,
					userId: outsiderId,
					orgSlug
				})
			).resolves.toEqual({ scope: 'individual' });
		}
	});

	it('bills the declared org, not whichever membership the index yields first', async () => {
		const t = convexTest({ schema, modules });
		const { orgId: firstOrgId, userId } = await seedPaidOrg(t);
		const secondOrgId = await t.run(async (ctx) => {
			const id = await ctx.db.insert('organizations', {
				name: 'Second Agentic Org',
				slug: SECOND_ORG_SLUG,
				maxSeats: 5,
				maxTemplatesMonth: 100,
				dmCacheTtlDays: 30,
				countryCode: 'US',
				isPublic: false,
				memberCount: 1,
				verifiedActionsLifetime: 0,
				sentEmailCount: 0,
				emailReservedCount: 0,
				smsSentCount: 0,
				updatedAt: PERIOD_START
			});
			await ctx.db.insert('orgMemberships', {
				userId,
				orgId: id,
				role: 'member',
				joinedAt: PERIOD_START
			});
			return id;
		});

		const admission = await t.query(api.metering.agenticResolveAdmission, {
			_secret: SECRET,
			userId,
			orgSlug: SECOND_ORG_SLUG
		});

		expect(admission).toMatchObject({ scope: 'org', orgId: secondOrgId });
		expect(admission).not.toMatchObject({ orgId: firstOrgId });
	});
});
