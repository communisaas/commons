/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'test-internal-secret-0123456789abcdef-pad';
const NOW = Date.parse('2026-07-19T00:00:30.000Z');

type Harness = TestConvex<typeof schema>;

async function seedCredential(
	t: Harness,
	options: {
		keyHash?: string;
		plan?: 'starter' | 'organization' | 'coalition';
	} = {}
): Promise<{ orgId: Id<'organizations'>; keyId: Id<'apiKeys'>; keyHash: string }> {
	return await t.run(async (ctx) => {
		const keyHash = options.keyHash ?? 'hash-for-shared-key';
		const orgId = await ctx.db.insert('organizations', {
			name: 'Atomic API Org',
			slug: `atomic-api-${keyHash}`,
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			updatedAt: NOW
		});
		if (options.plan) {
			await ctx.db.insert('subscriptions', {
				orgId,
				plan: options.plan,
				priceCents: 1_000,
				status: 'active',
				currentPeriodStart: NOW - 1_000,
				currentPeriodEnd: NOW + 86_400_000,
				paymentMethod: 'stripe',
				updatedAt: NOW
			});
		}
		const keyId = await ctx.db.insert('apiKeys', {
			orgId,
			keyHash,
			keyPrefix: 'ck_live_',
			name: 'shared key',
			scopes: ['read', 'write'],
			requestCount: 0,
			createdBy: 'test'
		});
		return { orgId, keyId, keyHash };
	});
}

describe('v1 API atomic authentication and rate consumption', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it.each([
		[undefined, 'inactive', 100],
		['starter', 'starter', 300],
		['organization', 'organization', 1_000],
		['coalition', 'coalition', 3_000]
	] as const)('assigns a nonzero global ceiling for %s', async (plan, expectedPlan, limit) => {
		const t = convexTest(schema, modules);
		const { keyHash } = await seedCredential(t, { plan });

		await expect(
			t.mutation(api.v1api.authenticateApiKey, { _secret: SECRET, keyHash })
		).resolves.toMatchObject({
			status: 'allowed',
			planSlug: expectedPlan,
			limit,
			remaining: limit - 1
		});
	});

	it('serializes concurrent calls from varied endpoints at one per-key cap', async () => {
		const t = convexTest(schema, modules);
		const { orgId, keyId, keyHash } = await seedCredential(t);
		// Endpoint identity is intentionally absent from the mutation arguments and
		// bucket key. These labels model traffic spread across routes: all of it
		// consumes the same API-key budget.
		const endpoints = ['/events', '/campaigns', '/supporters', '/usage', '/networks'];
		const requests = Array.from({ length: 105 }, (_, index) => ({
			endpoint: endpoints[index % endpoints.length],
			result: t.mutation(api.v1api.authenticateApiKey, {
				_secret: SECRET,
				keyHash
			})
		}));
		expect(new Set(requests.map((request) => request.endpoint))).toEqual(new Set(endpoints));
		const results = await Promise.all(requests.map((request) => request.result));

		expect(results.filter((result) => result?.status === 'allowed')).toHaveLength(100);
		expect(results.filter((result) => result?.status === 'rate_limited')).toHaveLength(5);

		await t.run(async (ctx) => {
			const buckets = await ctx.db.query('rateLimits').collect();
			expect(buckets).toHaveLength(2);
			expect(buckets).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ key: `api-v1:${keyId}`, count: 100 }),
					expect.objectContaining({ key: `api-v1-org:${orgId}`, count: 100 })
				])
			);

			// Hot credentials are immutable under traffic. Usage telemetry lives on
			// the bounded bucket instead of invalidating the API-key auth index row.
			const credential = await ctx.db.get(keyId);
			expect(credential?.requestCount).toBe(0);
			expect(credential?.lastUsedAt).toBeUndefined();
		});
	});

	it('serializes concurrent keys through one organization-global cap', async () => {
		const t = convexTest(schema, modules);
		const first = await seedCredential(t, { keyHash: 'first-key-hash' });
		const secondKeyId = await t.run(async (ctx) =>
			ctx.db.insert('apiKeys', {
				orgId: first.orgId,
				keyHash: 'second-key-hash',
				keyPrefix: 'ck_live_',
				name: 'second key',
				scopes: ['read'],
				requestCount: 0,
				createdBy: 'test'
			})
		);

		const results = await Promise.all(
			Array.from({ length: 105 }, (_, index) =>
				t.mutation(api.v1api.authenticateApiKey, {
					_secret: SECRET,
					keyHash: index % 2 === 0 ? first.keyHash : 'second-key-hash'
				})
			)
		);
		expect(results.filter((result) => result?.status === 'allowed')).toHaveLength(100);
		const denied = results.filter((result) => result?.status === 'rate_limited');
		expect(denied).toHaveLength(5);
		expect(denied).toEqual(
			expect.arrayContaining([expect.objectContaining({ rateLimitScope: 'organization' })])
		);

		await t.run(async (ctx) => {
			const buckets = await ctx.db.query('rateLimits').collect();
			expect(buckets).toHaveLength(3);
			const orgBucket = buckets.find((row) => row.key === `api-v1-org:${first.orgId}`);
			expect(orgBucket?.count).toBe(100);
			const perKeyCounts = buckets
				.filter((row) => row.key === `api-v1:${first.keyId}` || row.key === `api-v1:${secondKeyId}`)
				.map((row) => row.count)
				.sort((a, b) => a - b);
			expect(perKeyCounts).toEqual([50, 50]);
		});
	});
});
