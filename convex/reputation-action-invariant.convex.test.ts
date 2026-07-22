/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { reputationStateForActionCount } from './lib/reputationTier';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const NOW = Date.parse('2026-07-21T12:00:00.000Z');
type Harness = TestConvex<typeof schema>;

function userValue(
	suffix: string,
	actionCount: number
): Omit<Doc<'users'>, '_id' | '_creationTime'> {
	return {
		tokenIdentifier: `https://issuer.example|reputation-${suffix}`,
		email: `reputation-${suffix}@example.test`,
		updatedAt: NOW,
		isVerified: true,
		authorityLevel: 3,
		trustTier: 3,
		trustScore: 0,
		reputationTier: reputationStateForActionCount(actionCount).reputationTier,
		districtVerified: true,
		templatesContributed: 0,
		templateAdoptionRate: 0,
		peerEndorsements: 0,
		activeMonths: 0,
		actionCount,
		profileVisibility: 'private'
	};
}

async function seedCrossing(t: Harness, threshold: number) {
	return await t.run(async (ctx) => {
		const suffix = String(threshold);
		const userId = await ctx.db.insert('users', userValue(suffix, threshold - 1));
		const orgId = await ctx.db.insert('organizations', {
			name: `Reputation ${suffix}`,
			slug: `reputation-${suffix}`,
			maxSeats: 1,
			maxTemplatesMonth: 1,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: false,
			verifiedActionsLifetime: 0,
			actionTierCounts: [0, 0, 0, 0, 0],
			updatedAt: NOW
		});
		const campaignId = await ctx.db.insert('campaigns', {
			orgId,
			type: 'LETTER',
			title: `Threshold ${suffix}`,
			status: 'ACTIVE',
			debateEnabled: false,
			debateThreshold: 100,
			raisedAmountCents: 0,
			donorCount: 0,
			targetCountry: 'US',
			actionCount: 0,
			verifiedActionCount: 0,
			tier3VerifiedActionCount: 0,
			updatedAt: NOW
		});
		const supporterId = await ctx.db.insert('supporters', {
			orgId,
			encryptedEmail: `cipher-${suffix}`,
			emailHash: `hash-${suffix}`,
			verified: true,
			emailStatus: 'subscribed',
			smsStatus: 'none',
			updatedAt: NOW
		});
		return { userId, orgId, campaignId, supporterId };
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe('transactional reputation attribution', () => {
	it.each([5, 25, 100, 500])(
		'stamps the post-increment tier when actionCount crosses %i',
		async (threshold) => {
			const t = convexTest({ schema, modules });
			const ids = await seedCrossing(t, threshold);
			const expected = reputationStateForActionCount(threshold);
			const staleSubmittedTier = ((expected.engagementTier + 2) % 5) as 0 | 1 | 2 | 3 | 4;

			await expect(
				t.mutation(internal.campaigns.createCampaignAction, {
					campaignId: ids.campaignId,
					supporterId: ids.supporterId,
					verified: true,
					engagementTier: staleSubmittedTier,
					trustTier: 3,
					userId: ids.userId,
					channel: 'web'
				})
			).resolves.toMatchObject({ alreadySubmitted: false, actionCount: 1, totalCount: 1 });

			await t.run(async (ctx) => {
				await expect(ctx.db.get(ids.userId)).resolves.toMatchObject({
					actionCount: threshold,
					reputationTier: expected.reputationTier
				});
				const action = await ctx.db
					.query('campaignActions')
					.withIndex('by_campaignId_supporterId', (q) =>
						q.eq('campaignId', ids.campaignId).eq('supporterId', ids.supporterId)
					)
					.unique();
				expect(action?.engagementTier).toBe(expected.engagementTier);

				const org = await ctx.db.get(ids.orgId);
				const expectedHistogram = [0, 0, 0, 0, 0];
				expectedHistogram[expected.engagementTier] = 1;
				expect(org?.actionTierCounts).toEqual(expectedHistogram);

				const event = await ctx.db
					.query('orgEvents')
					.withIndex('by_orgId_emittedAt', (q) => q.eq('orgId', ids.orgId))
					.unique();
				expect(JSON.parse(event?.payload ?? '{}')).toMatchObject({
					engagementTier: expected.engagementTier
				});
			});

			// The dedup return precedes the reputation patch, so retries cannot
			// double-promote the user or create a second immutable attribution.
			await t.mutation(internal.campaigns.createCampaignAction, {
				campaignId: ids.campaignId,
				supporterId: ids.supporterId,
				verified: true,
				engagementTier: staleSubmittedTier,
				trustTier: 3,
				userId: ids.userId,
				channel: 'web'
			});
			expect((await t.run((ctx) => ctx.db.get(ids.userId)))?.actionCount).toBe(threshold);
		}
	);
});
