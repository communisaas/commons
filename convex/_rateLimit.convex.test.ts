/// <reference types="vite/client" />

import { afterEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';

import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

afterEach(() => {
	vi.useRealTimers();
});

describe('distributed rate-limit buckets', () => {
	it('stores one row per stable actor and window', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T00:00:30.000Z'));
		const t = convexTest(schema, modules);

		await expect(
			t.mutation(internal._rateLimit.check, {
				key: 'templates.search:user-1',
				windowMs: 60_000,
				maxRequests: 2
			})
		).resolves.toEqual({ allowed: true, remaining: 1 });
		await expect(
			t.mutation(internal._rateLimit.check, {
				key: 'templates.search:user-1',
				windowMs: 60_000,
				maxRequests: 2
			})
		).resolves.toEqual({ allowed: true, remaining: 0 });
		await expect(
			t.mutation(internal._rateLimit.check, {
				key: 'templates.search:user-1',
				windowMs: 60_000,
				maxRequests: 2
			})
		).resolves.toEqual({ allowed: false, remaining: 0 });

		await t.run(async (ctx) => {
			const rows = await ctx.db.query('rateLimits').collect();
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				key: 'templates.search:user-1',
				windowStart: Date.parse('2026-07-18T00:00:00.000Z'),
				count: 2
			});
		});
	});

	it('opens a new bucket at the next fixed-window boundary', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T00:00:59.999Z'));
		const t = convexTest(schema, modules);
		const args = { key: 'actor', windowMs: 60_000, maxRequests: 1 };

		await expect(t.mutation(internal._rateLimit.check, args)).resolves.toMatchObject({
			allowed: true
		});
		vi.setSystemTime(new Date('2026-07-18T00:01:00.000Z'));
		await expect(t.mutation(internal._rateLimit.check, args)).resolves.toMatchObject({
			allowed: true
		});

		await t.run(async (ctx) => {
			expect(await ctx.db.query('rateLimits').collect()).toHaveLength(2);
		});
	});

	it('serializes concurrent consumers of the final slot', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T00:00:30.000Z'));
		const t = convexTest(schema, modules);
		const args = { key: 'shared-actor', windowMs: 60_000, maxRequests: 1 };

		const results = await Promise.all([
			t.mutation(internal._rateLimit.check, args),
			t.mutation(internal._rateLimit.check, args)
		]);
		expect(results.filter((result) => result.allowed)).toHaveLength(1);
		expect(results.filter((result) => !result.allowed)).toHaveLength(1);
		await t.run(async (ctx) => {
			const rows = await ctx.db.query('rateLimits').collect();
			expect(rows).toHaveLength(1);
			expect(rows[0].count).toBe(1);
		});
	});

	it('deletes only a bounded global page and schedules continuation', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			for (let i = 0; i < 4; i++) {
				await ctx.db.insert('rateLimits', {
					key: `expired-${i}`,
					windowStart: Date.now() - 3 * 24 * 60 * 60 * 1_000 - i,
					count: 1,
					updatedAt: Date.now()
				});
			}
			await ctx.db.insert('rateLimits', {
				key: 'current',
				windowStart: Date.now(),
				count: 1,
				updatedAt: Date.now()
			});
		});

		await expect(
			t.mutation(internal._rateLimit.cleanupExpired, { limit: 2 })
		).resolves.toMatchObject({ deleted: 2, hasMore: true });
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		await t.run(async (ctx) => {
			const rows = await ctx.db.query('rateLimits').collect();
			expect(rows).toHaveLength(1);
			expect(rows[0].key).toBe('current');
		});
	});
});
