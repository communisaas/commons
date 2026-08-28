/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'test-internal-secret-0123456789abcdef-pad';
const NOW = Date.parse('2026-07-19T00:00:00.000Z');

type Harness = TestConvex<typeof schema>;

async function seedOrg(t: Harness): Promise<Id<'organizations'>> {
	return await t.run(async (ctx) =>
		ctx.db.insert('organizations', {
			name: 'Key Budget Org',
			slug: 'key-budget-org',
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			updatedAt: NOW
		})
	);
}

function createArgs(index: number) {
	return {
		_secret: SECRET,
		orgSlug: 'key-budget-org',
		keyHash: index.toString(16).padStart(64, '0'),
		keyPrefix: `ck_live_${String(index).padStart(4, '0')}`,
		name: `Key ${index}`,
		scopes: ['read'],
		createdBy: 'test-user'
	};
}

async function seedKeys(
	t: Harness,
	orgId: Id<'organizations'>,
	count: number,
	revoked: boolean
): Promise<void> {
	await t.run(async (ctx) => {
		for (let index = 1; index <= count; index += 1) {
			await ctx.db.insert('apiKeys', {
				orgId,
				keyHash: index.toString(16).padStart(64, '0'),
				keyPrefix: `ck_live_${String(index).padStart(4, '0')}`,
				name: `Seed ${index}`,
				scopes: ['read'],
				requestCount: 0,
				createdBy: 'test-user',
				revokedAt: revoked ? NOW : undefined
			});
		}
	});
}

describe('v1 API key multiplication budgets', () => {
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

	it('serializes concurrent creates at the eight-active-key cap', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		await seedKeys(t, orgId, 7, false);
		vi.setSystemTime(NOW + 6_000);

		const results = await Promise.allSettled([
			t.mutation(api.v1api.createApiKey, createArgs(100)),
			t.mutation(api.v1api.createApiKey, createArgs(101))
		]);
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		const rejection = results.find((result) => result.status === 'rejected');
		expect(String(rejection && rejection.status === 'rejected' ? rejection.reason : '')).toContain(
			'API_KEY_ACTIVE_LIMIT_EXCEEDED'
		);

		await t.run(async (ctx) => {
			const active = await ctx.db
				.query('apiKeys')
				.withIndex('by_orgId_revokedAt', (q) => q.eq('orgId', orgId).eq('revokedAt', undefined))
				.collect();
			expect(active).toHaveLength(8);
		});
	});

	it('uses the latest committed create as a stable concurrent throttle', async () => {
		const t = convexTest(schema, modules);
		await seedOrg(t);

		const results = await Promise.allSettled([
			t.mutation(api.v1api.createApiKey, createArgs(200)),
			t.mutation(api.v1api.createApiKey, createArgs(201))
		]);
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		const rejection = results.find((result) => result.status === 'rejected');
		expect(String(rejection && rejection.status === 'rejected' ? rejection.reason : '')).toContain(
			'API_KEY_CREATE_THROTTLED'
		);
	});

	it('fails closed once bounded key history reaches 64 rows', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		await seedKeys(t, orgId, 64, true);
		vi.setSystemTime(NOW + 6_000);

		await expect(t.mutation(api.v1api.createApiKey, createArgs(300))).rejects.toThrow(
			'API_KEY_HISTORY_LIMIT_EXCEEDED'
		);
	});
});
