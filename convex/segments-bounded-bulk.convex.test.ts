/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { SUPPORTER_BROWSE_MIGRATION_KEY, SUPPORTER_BROWSE_VERSION } from './lib/supporterBrowse';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'segments-bounded-bulk-test-secret';
const NOW = Date.parse('2026-07-21T09:00:00.000Z');
const FILTERS = { logic: 'AND' as const, conditions: [] };
type Harness = TestConvex<typeof schema>;

function supporterValue(
	orgId: Id<'organizations'>,
	index: number
): Omit<Doc<'supporters'>, '_id' | '_creationTime'> {
	return {
		orgId,
		encryptedEmail: `cipher-${index}`,
		emailHash: `segment-hash-${String(index).padStart(8, '0')}`,
		verified: true,
		emailStatus: 'subscribed',
		smsStatus: 'none',
		source: 'test',
		browseSource: 'test',
		browseTagIds: [],
		supporterBrowseVersion: SUPPORTER_BROWSE_VERSION,
		updatedAt: NOW + index
	};
}

async function fixture(t: Harness, suffix: string, supporterCount: number) {
	const slug = `segment-bulk-${suffix}`;
	const tokenIdentifier = `https://issuer.example|${slug}`;
	const { orgId, tagId } = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier,
			email: `${slug}@example.test`,
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
			name: slug,
			slug,
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			supporterCount,
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', {
			userId,
			orgId,
			role: 'editor',
			joinedAt: NOW
		});
		const tagId = await ctx.db.insert('tags', {
			orgId,
			name: 'Launch-safe cohort',
			nameKey: 'launch-safe cohort',
			supporterCount: 0
		});
		await ctx.db.insert('supporterBrowseMigrations', {
			key: SUPPORTER_BROWSE_MIGRATION_KEY,
			status: 'ready',
			runToken: `segment-bulk-${suffix}`,
			phase: 'complete',
			scanned: supporterCount,
			projected: supporterCount,
			startedAt: NOW,
			completedAt: NOW,
			updatedAt: NOW
		});
		return { orgId, tagId };
	});

	for (let start = 0; start < supporterCount; start += 50) {
		await t.run(async (ctx) => {
			for (let index = start; index < Math.min(supporterCount, start + 50); index += 1) {
				await ctx.db.insert('supporters', supporterValue(orgId, index));
			}
		});
	}

	return {
		orgId,
		tagId,
		slug,
		editor: t.withIdentity({
			subject: slug,
			issuer: 'https://issuer.example',
			tokenIdentifier
		})
	};
}

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('bounded segment bulk contract', () => {
	it('proves a 401st row exists, reports a lower-bound count, and performs zero bulk writes', async () => {
		const t = convexTest({ schema, modules });
		const value = await fixture(t, 'over-limit', 401);

		await expect(
			value.editor.action(api.segments.countMatching, {
				_secret: SECRET,
				slug: value.slug,
				filters: FILTERS
			})
		).resolves.toEqual({ count: 400, partial: true, scanned: 400 });

		await expect(
			value.editor.action(api.segments.bulkApplyTag, {
				_secret: SECRET,
				slug: value.slug,
				tagId: value.tagId,
				filters: FILTERS
			})
		).resolves.toMatchObject({
			affected: 0,
			partial: true,
			complete: false,
			rejection: 'SEGMENT_ORG_EXCEEDS_SCAN_LIMIT'
		});
		await expect(
			value.editor.action(api.segments.bulkRemoveTag, {
				_secret: SECRET,
				slug: value.slug,
				tagId: value.tagId,
				filters: FILTERS
			})
		).resolves.toMatchObject({
			affected: 0,
			partial: true,
			complete: false,
			rejection: 'SEGMENT_ORG_EXCEEDS_SCAN_LIMIT'
		});

		await t.run(async (ctx) => {
			expect(await ctx.db.query('supporterTags').collect()).toHaveLength(0);
			expect((await ctx.db.get(value.tagId))?.supporterCount).toBe(0);
			const supporters = await ctx.db
				.query('supporters')
				.withIndex('by_orgId', (q) => q.eq('orgId', value.orgId))
				.collect();
			expect(supporters.every((supporter) => supporter.browseTagIds?.length === 0)).toBe(true);
		});

		// The public export object survives Convex serialization and withholds
		// every row when completion cannot be proven.
		await expect(
			value.editor.action(api.segments.exportDecrypted, {
				_secret: SECRET,
				slug: value.slug,
				filters: FILTERS
			})
		).resolves.toEqual({ rows: [], partial: true, complete: false, scanned: 400 });
	});

	it('applies and removes a fully admitted cohort completely and idempotently', async () => {
		const t = convexTest({ schema, modules });
		const value = await fixture(t, 'within-limit', 120);
		const args = {
			_secret: SECRET,
			slug: value.slug,
			tagId: value.tagId,
			filters: FILTERS
		};

		await expect(value.editor.action(api.segments.bulkApplyTag, args)).resolves.toEqual({
			affected: 120,
			partial: false,
			complete: true,
			scanned: 120
		});
		await expect(value.editor.action(api.segments.bulkApplyTag, args)).resolves.toEqual({
			affected: 0,
			partial: false,
			complete: true,
			scanned: 120
		});
		await expect(value.editor.action(api.segments.bulkRemoveTag, args)).resolves.toEqual({
			affected: 120,
			partial: false,
			complete: true,
			scanned: 120
		});

		await t.run(async (ctx) => {
			expect(await ctx.db.query('supporterTags').collect()).toHaveLength(0);
			expect((await ctx.db.get(value.tagId))?.supporterCount).toBe(0);
		});
	});

	it('admits exactly 400 supporters as the inclusive soft-launch boundary', async () => {
		const t = convexTest({ schema, modules });
		const value = await fixture(t, 'exact-limit', 400);
		const result = await value.editor.action(api.segments.bulkApplyTag, {
			_secret: SECRET,
			slug: value.slug,
			tagId: value.tagId,
			filters: FILTERS
		});
		expect(result).toEqual({
			affected: 400,
			partial: false,
			complete: true,
			scanned: 400
		});
		await t.run(async (ctx) => {
			expect(await ctx.db.query('supporterTags').collect()).toHaveLength(400);
		});
	});

	it('keeps matching-export completion metadata in an object, never on an array', async () => {
		const t = convexTest({ schema, modules });
		const value = await fixture(t, 'serialized-object', 3);
		const result = await value.editor.action(internal.segments.exportMatching, {
			slug: value.slug,
			filters: FILTERS
		});

		expect(Array.isArray(result)).toBe(false);
		expect(result).toMatchObject({ partial: false, complete: true, scanned: 3 });
		expect(result.rows).toHaveLength(3);
	});
});
