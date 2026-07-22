/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';

import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const ACTION_COUNTS = [0, 5, 25, 100, 500] as const;
const EXPECTED_TIERS = ['new', 'active', 'established', 'veteran', 'pillar'] as const;

function userValue(index: number): Omit<Doc<'users'>, '_id' | '_creationTime'> {
	return {
		tokenIdentifier: `https://issuer.example|recompute-${index}`,
		email: `recompute-${index}@example.test`,
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
		actionCount: ACTION_COUNTS[index],
		profileVisibility: 'private'
	};
}

describe('reputation tier recompute', () => {
	it('repairs legacy labels to canonical threshold tiers and is idempotent', async () => {
		const t = convexTest({ schema, modules });
		const ids = await t.run(async (ctx) => {
			const inserted = [];
			for (let index = 0; index < ACTION_COUNTS.length; index += 1) {
				inserted.push(await ctx.db.insert('users', userValue(index)));
			}
			return inserted;
		});

		await expect(t.mutation(internal.users.recomputeAllReputationTiers, {})).resolves.toEqual({
			scanned: 5,
			updated: 5
		});

		await t.run(async (ctx) => {
			for (let index = 0; index < ids.length; index += 1) {
				expect((await ctx.db.get(ids[index]))?.reputationTier).toBe(EXPECTED_TIERS[index]);
			}
		});

		await expect(t.mutation(internal.users.recomputeAllReputationTiers, {})).resolves.toEqual({
			scanned: 5,
			updated: 0
		});
	});
});
