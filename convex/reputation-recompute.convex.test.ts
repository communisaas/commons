/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const ACTION_COUNTS = [0, 5, 25, 100, 500] as const;
type Harness = TestConvex<typeof schema>;

function userValue(prefix: string, index: number): Omit<Doc<'users'>, '_id' | '_creationTime'> {
	return {
		tokenIdentifier: `https://issuer.example|${prefix}-${index}`,
		email: `${prefix}-${index}@example.test`,
		updatedAt: Date.now(),
		isVerified: true,
		authorityLevel: 1,
		trustTier: 1,
		trustScore: 0,
		reputationTier: 'legacy',
		districtVerified: false,
		templatesContributed: 0,
		templateAdoptionRate: 0,
		peerEndorsements: 0,
		activeMonths: 0,
		actionCount: ACTION_COUNTS[index % ACTION_COUNTS.length],
		profileVisibility: 'private'
	};
}

async function insertUsers(t: Harness, prefix: string, count: number): Promise<Array<Id<'users'>>> {
	const ids: Array<Id<'users'>> = [];
	for (let start = 0; start < count; start += 100) {
		ids.push(
			...(await t.run(async (ctx) => {
				const chunk: Array<Id<'users'>> = [];
				for (let index = start; index < Math.min(start + 100, count); index += 1) {
					chunk.push(await ctx.db.insert('users', userValue(prefix, index)));
				}
				return chunk;
			}))
		);
	}
	return ids;
}

function expectedTier(actionCount: number): string {
	if (actionCount >= 500) return 'pillar';
	if (actionCount >= 100) return 'veteran';
	if (actionCount >= 25) return 'established';
	if (actionCount >= 5) return 'active';
	return 'new';
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'));
});

afterEach(() => vi.useRealTimers());

describe('explicit legacy reputation-tier repair', () => {
	it('drains beyond the former 500-user ceiling and terminates at its frozen endpoint', async () => {
		const t = convexTest({ schema, modules });
		const originalIds = await insertUsers(t, 'original', 503);

		await expect(t.mutation(internal.users.recomputeAllReputationTiers, {})).resolves.toEqual({
			status: 'running',
			scanned: 100,
			updated: 100,
			nextCursor: expect.any(String),
			pageSize: 100
		});

		// These rows arrive after the operator-started repair freezes its upper
		// endpoint. They require a later explicit repair and cannot extend this run.
		const laterIds = await insertUsers(t, 'later', 125);
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		await t.run(async (ctx) => {
			for (let index = 0; index < originalIds.length; index += 1) {
				const user = await ctx.db.get(originalIds[index]);
				expect(user?.reputationTier).toBe(
					expectedTier(ACTION_COUNTS[index % ACTION_COUNTS.length])
				);
			}
			for (const id of laterIds) {
				expect((await ctx.db.get(id))?.reputationTier).toBe('legacy');
			}

			const continuations = (await ctx.db.system.query('_scheduled_functions').collect()).filter(
				(job) => job.name === 'users:recomputeAllReputationTiers'
			);
			expect(continuations).toHaveLength(5);
			expect(continuations.every((job) => job.state.kind === 'success')).toBe(true);
		});

		expect((await t.run((ctx) => ctx.db.get(originalIds[502])))?.reputationTier).toBe(
			'established'
		);
	});

	it('completes an empty sweep without scheduling a continuation', async () => {
		const t = convexTest({ schema, modules });
		await expect(
			t.mutation(internal.users.recomputeAllReputationTiers, { limit: 500 })
		).resolves.toEqual({
			status: 'complete',
			scanned: 0,
			updated: 0,
			nextCursor: null,
			pageSize: 100
		});
		await expect(
			t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
		).resolves.toHaveLength(0);
	});
});
