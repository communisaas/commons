/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
	WEBHOOK_CREATION_MAX_PER_WINDOW,
	WEBHOOK_SUBSCRIPTION_MAX,
	WEBHOOK_TRUSTED_ORIGINS_ENV
} from './lib/orgWebhookPolicy';
import schema from './schema';

declare const process: { env: Record<string, string | undefined> };

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;

const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const TOKEN = 'https://issuer.example|webhook-owner';
const SLUG = 'webhook-invariants';
const TRUSTED_ORIGIN = 'https://hooks.acme.net';
const INTERNAL_SECRET = 'webhook-invariant-internal-secret';

async function seedOrg(t: Harness): Promise<Id<'organizations'>> {
	return await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier: TOKEN,
			email: 'owner@example.test',
			updatedAt: NOW,
			isVerified: true,
			authorityLevel: 1,
			trustTier: 1,
			trustScore: 10,
			reputationTier: 'novice',
			districtVerified: false,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 0,
			profileVisibility: 'private'
		});
		const orgId = await ctx.db.insert('organizations', {
			name: 'Webhook Invariants',
			slug: SLUG,
			maxSeats: 10,
			maxTemplatesMonth: 100,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: false,
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', { userId, orgId, role: 'owner', joinedAt: NOW });
		return orgId;
	});
}

function owner(t: Harness) {
	return t.withIdentity({
		subject: 'webhook-owner',
		issuer: 'https://issuer.example',
		tokenIdentifier: TOKEN
	});
}

async function insertLegacyWebhook(
	t: Harness,
	orgId: Id<'organizations'>,
	index: number,
	enabled = true
): Promise<Id<'orgWebhooks'>> {
	return await t.run((ctx) =>
		ctx.db.insert('orgWebhooks', {
			orgId,
			url: `${TRUSTED_ORIGIN}/legacy/${index}`,
			events: ['supporter.created'],
			signingSecret: 'a'.repeat(64),
			enabled,
			createdAt: NOW + index,
			failureCount: 0
		})
	);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	process.env[WEBHOOK_TRUSTED_ORIGINS_ENV] = TRUSTED_ORIGIN;
	process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
});

afterEach(() => {
	delete process.env[WEBHOOK_TRUSTED_ORIGINS_ENV];
	delete process.env.INTERNAL_API_SECRET;
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('bounded organization webhooks', () => {
	it('serializes concurrent session and v1 creation at one organization-wide cap', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		const authenticated = owner(t);

		const results = await Promise.all(
			Array.from({ length: WEBHOOK_SUBSCRIPTION_MAX + 6 }, (_, index) => {
				const input = {
					url: `${TRUSTED_ORIGIN}/concurrent/${index}`,
					events: ['supporter.created', 'supporter.created', 'campaign.updated'],
					description: `receiver ${index}`
				};
				return index % 2 === 0
					? authenticated.mutation(api.orgWebhooks.sessionCreateWebhook, {
							slug: SLUG,
							...input
						})
					: t.mutation(api.v1api.createWebhook, {
							_secret: INTERNAL_SECRET,
							orgId,
							...input
						});
			})
		);

		expect(results.filter((result) => result.error === null)).toHaveLength(
			WEBHOOK_SUBSCRIPTION_MAX
		);
		expect(results.filter((result) => result.error === 'subscription_limit')).toHaveLength(6);
		await t.run(async (ctx) => {
			const rows = await ctx.db.query('orgWebhooks').collect();
			expect(rows).toHaveLength(WEBHOOK_SUBSCRIPTION_MAX);
			expect(
				rows.every((row) => row.events.join(',') === 'campaign.updated,supporter.created')
			).toBe(true);
			const buckets = await ctx.db
				.query('rateLimits')
				.filter((q) => q.eq(q.field('key'), `org-webhook-create:${rows[0].orgId}`))
				.collect();
			expect(buckets).toHaveLength(1);
			expect(buckets[0].count).toBe(WEBHOOK_SUBSCRIPTION_MAX);
		});
	});

	it('shares one stable organization creation throttle across both adapters and delete churn', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		const authenticated = owner(t);

		for (let index = 0; index < WEBHOOK_CREATION_MAX_PER_WINDOW; index += 1) {
			const input = {
				url: `${TRUSTED_ORIGIN}/churn/${index}`,
				events: ['supporter.created']
			};
			const created =
				index % 2 === 0
					? await authenticated.mutation(api.orgWebhooks.sessionCreateWebhook, {
							slug: SLUG,
							...input
						})
					: await t.mutation(api.v1api.createWebhook, {
							_secret: INTERNAL_SECRET,
							orgId,
							...input
						});
			expect(created.error).toBeNull();
			if (created.error === null) {
				const deleted =
					index % 2 === 0
						? await t.mutation(api.v1api.deleteWebhook, {
								_secret: INTERNAL_SECRET,
								orgId,
								webhookId: created.webhook.id
							})
						: await authenticated.mutation(api.orgWebhooks.sessionDeleteWebhook, {
								slug: SLUG,
								webhookId: created.webhook.id
							});
				expect(deleted).toBe(true);
			}
		}

		await expect(
			t.mutation(api.v1api.createWebhook, {
				_secret: INTERNAL_SECRET,
				orgId,
				url: `${TRUSTED_ORIGIN}/churn/blocked`,
				events: ['supporter.created']
			})
		).resolves.toMatchObject({ error: 'creation_throttled' });
	});

	it('reads MAX+1, fans out only MAX, and coalesces durable legacy overflow evidence', async () => {
		const t = convexTest({
			schema,
			modules,
			transactionLimits: {
				documentsRead: WEBHOOK_SUBSCRIPTION_MAX + 3,
				databaseQueries: 4,
				bytesRead: 80_000
			}
		});
		const orgId = await seedOrg(t);
		for (let index = 0; index < 100; index += 1) await insertLegacyWebhook(t, orgId, index);

		const result = await t.mutation(internal.orgWebhooks.queueEvent, {
			orgId,
			event: 'supporter.created',
			payload: '{ "supporterId": "bounded" }'
		});
		expect(result).toEqual({ queued: WEBHOOK_SUBSCRIPTION_MAX, overflow: true, dropped: null });
		await t.run(async (ctx) => {
			expect(
				await ctx.db.query('orgWebhookDeliveries').take(WEBHOOK_SUBSCRIPTION_MAX + 1)
			).toHaveLength(WEBHOOK_SUBSCRIPTION_MAX);
			const evidence = await ctx.db
				.query('orgWebhookOverflowEvidence')
				.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				.unique();
			expect(evidence).toMatchObject({
				cap: WEBHOOK_SUBSCRIPTION_MAX,
				observedCountLowerBound: WEBHOOK_SUBSCRIPTION_MAX + 1,
				removedSubscriptions: 0
			});
		});

		await t.mutation(internal.orgWebhooks.queueEvent, {
			orgId,
			event: 'supporter.created',
			payload: '{"supporterId":"second"}'
		});
		await t.run(async (ctx) => {
			expect(await ctx.db.query('orgWebhookOverflowEvidence').take(2)).toHaveLength(1);
		});
	});

	it('repairs legacy subscription overflow one parent at a time', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		for (let index = 0; index < WEBHOOK_SUBSCRIPTION_MAX + 2; index += 1) {
			await insertLegacyWebhook(t, orgId, index);
		}
		await t.mutation(internal.orgWebhooks.queueEvent, {
			orgId,
			event: 'supporter.created',
			payload: '{"supporterId":"repair"}'
		});

		await expect(
			t.mutation(internal.orgWebhooks.repairLegacySubscriptionOverflow, { orgId })
		).resolves.toEqual({ removed: 1, hasMore: true });
		await expect(
			t.mutation(internal.orgWebhooks.repairLegacySubscriptionOverflow, { orgId })
		).resolves.toEqual({ removed: 1, hasMore: true });
		await expect(
			t.mutation(internal.orgWebhooks.repairLegacySubscriptionOverflow, { orgId })
		).resolves.toEqual({ removed: 0, hasMore: false });

		await t.run(async (ctx) => {
			expect(await ctx.db.query('orgWebhooks').collect()).toHaveLength(WEBHOOK_SUBSCRIPTION_MAX);
			const evidence = await ctx.db
				.query('orgWebhookOverflowEvidence')
				.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				.unique();
			expect(evidence?.removedSubscriptions).toBe(2);
			expect(evidence?.resolvedAt).toEqual(expect.any(Number));
		});
	});

	it('deletes the parent immediately and drains unbounded legacy delivery history in pages', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		const webhookId = await insertLegacyWebhook(t, orgId, 0);
		await t.run(async (ctx) => {
			for (let index = 0; index < 125; index += 1) {
				await ctx.db.insert('orgWebhookDeliveries', {
					webhookId,
					orgId,
					event: 'supporter.created',
					payload: '{"bounded":true}',
					attempt: 1,
					isDead: true
				});
			}
		});
		await expect(
			owner(t).query(api.orgWebhooks.sessionListRecentDeliveries, {
				slug: SLUG,
				webhookId,
				limit: 10_000
			})
		).resolves.toHaveLength(50);

		await expect(
			owner(t).mutation(api.orgWebhooks.sessionDeleteWebhook, { slug: SLUG, webhookId })
		).resolves.toBe(true);
		await t.run(async (ctx) => {
			expect(await ctx.db.get(webhookId)).toBeNull();
			expect(await ctx.db.query('orgWebhookDeliveries').collect()).toHaveLength(75);
		});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		await t.run(async (ctx) => {
			expect(await ctx.db.query('orgWebhookDeliveries').collect()).toEqual([]);
		});
	});

	it('revalidates a queued destination and blocks private rebinding before fetch', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		const created = await owner(t).mutation(api.orgWebhooks.sessionCreateWebhook, {
			slug: SLUG,
			url: `${TRUSTED_ORIGIN}/before-rebind`,
			events: ['supporter.created']
		});
		expect(created.error).toBeNull();
		if (created.error !== null) throw new Error('fixture creation failed');
		await t.mutation(internal.orgWebhooks.queueEvent, {
			orgId,
			event: 'supporter.created',
			payload: '{"supporterId":"rebind"}'
		});
		const delivery = await t.run((ctx) => ctx.db.query('orgWebhookDeliveries').first());
		if (!delivery) throw new Error('delivery fixture missing');
		await t.run((ctx) => ctx.db.patch(created.webhook.id, { url: 'https://127.0.0.1/private' }));
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await t.action(internal.orgWebhooks.deliverWebhook, { deliveryId: delivery._id });
		expect(fetchMock).not.toHaveBeenCalled();
		await t.run(async (ctx) => {
			const rejected = await ctx.db.get(delivery._id);
			expect(rejected).toMatchObject({
				isDead: true,
				errorMessage: 'destination rejected before delivery: destination_private'
			});
		});
	});

	it('drops oversized/invalid event input before any history or fan-out write', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		await insertLegacyWebhook(t, orgId, 0);
		await expect(
			t.mutation(internal.orgWebhooks.queueEvent, {
				orgId,
				event: 'supporter.created',
				payload: JSON.stringify({ wide: 'x'.repeat(65 * 1_024) })
			})
		).resolves.toMatchObject({ queued: 0, dropped: 'payload_too_large' });
		await expect(
			t.mutation(internal.orgWebhooks.queueEvent, {
				orgId,
				event: ['not', 'advertised'].join('.'),
				payload: '{}'
			})
		).resolves.toMatchObject({ queued: 0, dropped: 'invalid_event' });
		await t.run(async (ctx) => {
			expect(await ctx.db.query('orgEvents').collect()).toEqual([]);
			expect(await ctx.db.query('orgWebhookDeliveries').collect()).toEqual([]);
		});
	});
});
