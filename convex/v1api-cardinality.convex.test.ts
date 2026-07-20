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
			name: 'Cardinality Org',
			slug: 'cardinality-org',
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			updatedAt: NOW
		})
	);
}

describe('v1 maximum-cardinality pages', () => {
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

	it('walks campaign history in opaque pages capped at 50 without rebuilding a window', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		await t.run(async (ctx) => {
			for (let index = 0; index < 123; index += 1) {
				await ctx.db.insert('campaigns', {
					orgId,
					type: 'LETTER',
					title: `Campaign ${index}`,
					status: 'DRAFT',
					debateEnabled: false,
					debateThreshold: 100,
					raisedAmountCents: 0,
					donorCount: 0,
					targetCountry: 'US',
					actionCount: 0,
					verifiedActionCount: 0,
					updatedAt: NOW + index
				});
			}
		});

		const first = await t.query(api.v1api.listCampaigns, {
			_secret: SECRET,
			orgId,
			limit: 50
		});
		const second = await t.query(api.v1api.listCampaigns, {
			_secret: SECRET,
			orgId,
			limit: 50,
			cursor: first.cursor ?? undefined
		});
		const third = await t.query(api.v1api.listCampaigns, {
			_secret: SECRET,
			orgId,
			limit: 50,
			cursor: second.cursor ?? undefined
		});

		expect([first.items.length, second.items.length, third.items.length]).toEqual([50, 50, 23]);
		expect(first.hasMore).toBe(true);
		expect(second.hasMore).toBe(true);
		expect(third.hasMore).toBe(false);
		expect(
			new Set([...first.items, ...second.items, ...third.items].map((row) => row._id))
		).toHaveLength(123);
		expect(first.total).toBeUndefined();
		expect(first.items.every((row) => row._count.exact === false)).toBe(true);
	});

	it('pages one followed decision-maker activity source without cross-DM fan-out', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		const fixture = await t.run(async (ctx) => {
			const decisionMakerId = await ctx.db.insert('decisionMakers', {
				type: 'legislator',
				name: 'Bounded Representative',
				lastName: 'Representative',
				active: true,
				updatedAt: NOW
			});
			const billId = await ctx.db.insert('bills', {
				externalId: 'B-1',
				jurisdiction: 'us-federal',
				jurisdictionLevel: 'federal',
				title: 'Bounded bill',
				status: 'introduced',
				statusDate: NOW,
				committees: [],
				sourceUrl: 'https://example.gov/bill',
				topics: [],
				entities: [],
				updatedAt: NOW
			});
			await ctx.db.insert('orgDmFollows', {
				orgId,
				decisionMakerId,
				reason: 'manual',
				alertsEnabled: true,
				followedAt: NOW
			});
			for (let index = 0; index < 123; index += 1) {
				await ctx.db.insert('legislativeActions', {
					billId,
					decisionMakerId,
					name: 'Bounded Representative',
					action: index % 2 === 0 ? 'voted_yes' : 'voted_no',
					occurredAt: NOW + index
				});
			}
			return { decisionMakerId };
		});

		const first = await t.query(api.v1api.listActivityFeed, {
			_secret: SECRET,
			orgId,
			decisionMakerId: fixture.decisionMakerId,
			activityType: 'vote',
			limit: 50
		});
		expect('items' in first && first.items).toHaveLength(50);
		expect('hasMore' in first && first.hasMore).toBe(true);
		if (!('nextCursor' in first)) throw new Error('expected activity page');

		const second = await t.query(api.v1api.listActivityFeed, {
			_secret: SECRET,
			orgId,
			decisionMakerId: fixture.decisionMakerId,
			activityType: 'vote',
			limit: 50,
			cursor: first.nextCursor ?? undefined
		});
		expect('items' in second && second.items).toHaveLength(50);
		expect('total' in second ? second.total : undefined).toBeUndefined();
	});

	it('strips wide decision-maker internals from a byte-bounded country page', async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			for (let index = 0; index < 60; index += 1) {
				await ctx.db.insert('decisionMakers', {
					type: 'legislator',
					name: `International Representative ${index}`,
					lastName: `Representative ${index}`,
					jurisdiction: 'GB',
					jurisdictionLevel: 'international',
					active: true,
					institution: {
						type: 'legislature',
						name: `Wide institution ${'x'.repeat(5_000)}`
					},
					updatedAt: NOW + index
				});
			}
		});

		const page = await t.query(api.v1api.listRepresentativesV1, {
			_secret: SECRET,
			country: 'GB',
			limit: 50
		});
		expect(page.items).toHaveLength(50);
		expect(page.items.every((item) => !('institution' in item))).toBe(true);
		expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThan(64 * 1_024);
	});
});
