/// <reference types="vite/client" />

import { describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';

import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

describe('seed maintenance public-discovery safety', () => {
	it('clearing a source corpus table invalidates and rebuilds discovery without wiping state', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
		try {
			const now = Date.now();
			const t = convexTest({ schema, modules });
			await t.run(async (ctx) => {
				await ctx.db.insert('embeddingBackfillLeases', {
					key: 'topic',
					token: 'stale-seed-backfill-lease',
					expiresAt: 1_900_000_000_000
				});
				await ctx.db.insert('templates', {
					slug: 'stale-seed-template',
					title: 'Stale seed template',
					description: 'Seed maintenance fixture',
					topics: [],
					type: 'email',
					deliveryMethod: 'email',
					preview: 'Preview',
					messageBody: 'Body',
					deliveryConfig: {},
					recipientConfig: {},
					status: 'published',
					isPublic: true,
					verifiedSends: 0,
					uniqueDistricts: 0,
					embeddingVersion: 'test',
					flaggedByModeration: false,
					consensusApproved: true,
					reputationDelta: 0,
					reputationApplied: false,
					updatedAt: 1
				});
				await ctx.db.insert('publicTemplateSnapshots', {
					key: 'all',
					revision: 3,
					templates: [{ id: 'stale' }],
					sourceCount: 1,
					updatedAt: now
				});
				await ctx.db.insert('templateRelationSnapshots', {
					key: 'public',
					revision: 4,
					twinEdges: [],
					conceptEdges: [],
					conceptEntries: [],
					sourceCap: 50,
					sourceTemplateCount: 1,
					embeddedTemplateCount: 0,
					tagVectorCount: 0,
					updatedAt: now
				});
				await ctx.db.insert('publicDiscoveryManifest', {
					key: 'public',
					listReady: true,
					relationsReady: true,
					listRevision: 3,
					relationsRevision: 4,
					listUpdatedAt: now,
					relationsUpdatedAt: now
				});
				await ctx.db.insert('relatednessCalibration', {
					key: 'public',
					centroid: [0, 0],
					threshold: 0.8,
					count: 1,
					dim: 2,
					updatedAt: 2
				});
			});

			await expect(t.mutation(internal.seed.clearTable, { table: 'templates' })).resolves.toEqual({
				deleted: 1,
				failed: 0
			});

			await t.run(async (ctx) => {
				expect(await ctx.db.query('templates').collect()).toEqual([]);
				expect(await ctx.db.query('embeddingBackfillLeases').collect()).toHaveLength(1);
				expect(await ctx.db.query('publicTemplateSnapshots').collect()).toHaveLength(1);
				expect(await ctx.db.query('templateRelationSnapshots').collect()).toHaveLength(1);
				expect(await ctx.db.query('relatednessCalibration').collect()).toHaveLength(1);
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest).toMatchObject({
					listReady: false,
					relationsReady: false,
					listRevision: 3,
					relationsRevision: 4,
					listDirtyAt: expect.any(Number),
					relationsDirtyAt: expect.any(Number),
					listRefreshScheduledAt: expect.any(Number),
					relationsRefreshScheduledAt: expect.any(Number)
				});
				expect(manifest?.listRefreshScheduledAt).toBe(manifest?.relationsRefreshScheduledAt);
			});

			// The destructive token bypasses the normal six-hour floor and publishes
			// the legitimately empty corpus immediately.
			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();
			const rebuilt = await t.query(internal.templates.publicDiscoveryCronAttemptState, {});
			expect(rebuilt).toMatchObject({ listRevision: 4, relationsRevision: 5 });
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest).toMatchObject({ listReady: true, relationsReady: true });
				expect(manifest?.listDirtyAt).toBeUndefined();
				expect(manifest?.relationsDirtyAt).toBeUndefined();
				expect(await ctx.db.query('embeddingBackfillLeases').collect()).toHaveLength(1);
				expect(await ctx.db.query('relatednessCalibration').collect()).toHaveLength(1);
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('clearing a list-only source preserves relation state and rebuilds only the list', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
		try {
			const now = Date.now();
			const relationToken = now + 30 * 60 * 1000;
			const t = convexTest({ schema, modules });
			await t.run(async (ctx) => {
				await ctx.db.insert('organizations', {
					name: 'Stale organization',
					slug: 'stale-organization',
					maxSeats: 1,
					maxTemplatesMonth: 1,
					dmCacheTtlDays: 1,
					countryCode: 'US',
					isPublic: true,
					updatedAt: now
				});
				await ctx.db.insert('publicTemplateSnapshots', {
					key: 'all',
					revision: 9,
					templates: [{ id: 'stale' }],
					sourceCount: 1,
					updatedAt: now
				});
				await ctx.db.insert('templateRelationSnapshots', {
					key: 'all',
					revision: 11,
					twinEdges: [],
					conceptEdges: [],
					conceptEntries: [],
					sourceCap: 50,
					sourceTemplateCount: 0,
					embeddedTemplateCount: 0,
					tagVectorCount: 0,
					updatedAt: now
				});
				await ctx.db.insert('publicDiscoveryManifest', {
					key: 'public',
					listReady: true,
					relationsReady: true,
					listRevision: 9,
					relationsRevision: 11,
					listUpdatedAt: now,
					relationsUpdatedAt: now,
					relationsRefreshScheduledAt: relationToken,
					relationsFailureAt: now - 1,
					relationsFailureCode: 'PRESERVE_ME'
				});
			});

			await t.mutation(internal.seed.clearTable, { table: 'organizations' });
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest).toMatchObject({
					listReady: false,
					relationsReady: true,
					listRevision: 9,
					relationsRevision: 11,
					relationsRefreshScheduledAt: relationToken,
					relationsFailureCode: 'PRESERVE_ME'
				});
				expect(manifest?.relationsDirtyAt).toBeUndefined();
			});

			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();
			const rebuilt = await t.query(internal.templates.publicDiscoveryCronAttemptState, {});
			expect(rebuilt).toMatchObject({ listRevision: 10, relationsRevision: 11 });
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest).toMatchObject({
					listReady: true,
					relationsReady: true,
					relationsRefreshScheduledAt: relationToken,
					relationsFailureCode: 'PRESERVE_ME'
				});
				expect(await ctx.db.query('templateRelationSnapshots').collect()).toHaveLength(1);
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('reseed publishes an empty generation when no seed users remain', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			await ctx.db.insert('templates', {
				slug: 'old-reseed-template',
				title: 'Old reseed template',
				description: 'Old description',
				topics: [],
				type: 'email',
				deliveryMethod: 'email',
				preview: 'Preview',
				messageBody: 'Body',
				deliveryConfig: {},
				recipientConfig: {},
				status: 'published',
				isPublic: true,
				verifiedSends: 0,
				uniqueDistricts: 0,
				embeddingVersion: 'none',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: 1
			});
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				relationsReady: true,
				listRevision: 5,
				relationsRevision: 7,
				listUpdatedAt: 1,
				relationsUpdatedAt: 1
			});
		});

		await t.action(internal.seed.reseedTemplates, {});
		await t.run(async (ctx) => {
			const manifest = await ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique();
			expect(manifest).toMatchObject({
				listReady: true,
				relationsReady: true,
				listRevision: 6,
				relationsRevision: 8
			});
			expect(manifest?.listDirtyAt).toBeUndefined();
			expect(manifest?.relationsDirtyAt).toBeUndefined();
			expect(manifest?.listRefreshScheduledAt).toBeUndefined();
			expect(manifest?.relationsRefreshScheduledAt).toBeUndefined();
			const snapshots = await ctx.db.query('publicTemplateSnapshots').collect();
			expect(snapshots).toHaveLength(2);
			expect(snapshots.every((snapshot) => snapshot.templates.length === 0)).toBe(true);
		});
	});

	it('rejects the generic clear primitive for tables outside the seed allowlist', async () => {
		const t = convexTest({ schema, modules });
		await expect(t.mutation(internal.seed.clearTable, { table: 'anchorStatus' })).rejects.toThrow(
			'CLEAR_TABLE_NOT_ALLOWED'
		);
	});
});
