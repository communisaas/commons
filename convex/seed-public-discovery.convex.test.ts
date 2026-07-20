/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';

import { api, internal } from './_generated/api';
import { PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS } from './lib/publicDiscovery';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'seed-public-discovery-read-secret-32-bytes';

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

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

	it('clearSeed gates the old generation and publishes one coherent empty generation', async () => {
		const t = convexTest({ schema, modules });
		const oldTemplateId = await t.run(async (ctx) => {
			return await ctx.db.insert('templates', {
				slug: 'clear-seed-stale-template',
				title: 'Clear seed stale template',
				description: 'Must never survive the coordinated clear',
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
		});
		await t.mutation(internal.templates.rebuildHomepageSnapshots, {});

		const oldManifest = await t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET });
		const oldList = await t.query(api.templates.publicDiscoveryList, {
			_secret: SECRET,
			excludeCwc: false
		});
		expect(oldManifest.list).toMatchObject({ ready: true, revision: 1 });
		expect(oldManifest.relations).toMatchObject({ ready: true, revision: 1 });
		expect(oldList.templates).toHaveLength(1);
		expect(String(oldList.templates[0].id)).toBe(String(oldTemplateId));

		const preservedIds = await t.run(async (ctx) => {
			const manifest = await ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique();
			return {
				manifest: String(manifest?._id),
				list: (await ctx.db.query('publicTemplateSnapshots').collect())
					.map((row) => String(row._id))
					.sort(),
				relations: (await ctx.db.query('templateRelationSnapshots').collect())
					.map((row) => String(row._id))
					.sort()
			};
		});

		await t.action(internal.seed.clearSeed, {});

		const [manifest, allList, excludeCwcList, allRelations, excludeCwcRelations] =
			await Promise.all([
				t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET }),
				t.query(api.templates.publicDiscoveryList, { _secret: SECRET, excludeCwc: false }),
				t.query(api.templates.publicDiscoveryList, { _secret: SECRET, excludeCwc: true }),
				t.query(api.templates.publicDiscoveryRelations, { _secret: SECRET, excludeCwc: false }),
				t.query(api.templates.publicDiscoveryRelations, { _secret: SECRET, excludeCwc: true })
			]);
		expect(manifest.list).toMatchObject({ ready: true, revision: 2 });
		expect(manifest.relations).toMatchObject({ ready: true, revision: 2 });
		expect(allList).toMatchObject({ revision: 2, templates: [] });
		expect(excludeCwcList).toMatchObject({ revision: 2, templates: [] });
		expect(allRelations).toMatchObject({
			revision: 2,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});
		expect(excludeCwcRelations).toMatchObject({
			revision: 2,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});
		expect(allList.updatedAt).toBe(manifest.list.updatedAt);
		expect(excludeCwcList.updatedAt).toBe(manifest.list.updatedAt);
		expect(allRelations.updatedAt).toBe(manifest.relations.updatedAt);
		expect(excludeCwcRelations.updatedAt).toBe(manifest.relations.updatedAt);
		await expect(t.query(api.templates.listPublic, { excludeCwc: false })).resolves.toEqual([]);

		await t.run(async (ctx) => {
			expect(await ctx.db.query('templates').collect()).toEqual([]);
			const manifestRow = await ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique();
			expect(manifestRow?.listDirtyAt).toBeUndefined();
			expect(manifestRow?.relationsDirtyAt).toBeUndefined();
			expect(manifestRow?.listRefreshScheduledAt).toBeUndefined();
			expect(manifestRow?.relationsRefreshScheduledAt).toBeUndefined();
			expect(manifestRow?.coordinatedRebuildToken).toBeUndefined();
			expect(manifestRow?.coordinatedRebuildStartedAt).toBeUndefined();
			expect(String(manifestRow?._id)).toBe(preservedIds.manifest);
			expect(
				(await ctx.db.query('publicTemplateSnapshots').collect())
					.map((row) => String(row._id))
					.sort()
			).toEqual(preservedIds.list);
			expect(
				(await ctx.db.query('templateRelationSnapshots').collect())
					.map((row) => String(row._id))
					.sort()
			).toEqual(preservedIds.relations);
		});
	});

	it('serializes interleaved writers and rebuilds behind the coordinated token', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await t.run(async (ctx) => {
			return await ctx.db.insert('templates', {
				slug: 'coordinated-lock-template',
				title: 'Coordinated lock template',
				description: 'Must roll back concurrent projection writes',
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
		});
		await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
		await t.mutation(internal.templates.requestPublicTemplateSnapshotRefresh, {});
		await t.mutation(internal.templates.requestPublicTemplateRelationSnapshotRefresh, {});
		const supersededTokens = await t.run(async (ctx) => {
			const manifest = await ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique();
			return {
				list: manifest?.listRefreshScheduledAt,
				relations: manifest?.relationsRefreshScheduledAt
			};
		});
		expect(supersededTokens.list).toEqual(expect.any(Number));
		expect(supersededTokens.relations).toEqual(expect.any(Number));

		const coordinatedRebuildToken = 'coordinated-owner-token';
		await expect(
			t.mutation(internal.seed.beginCoordinatedPublicDiscoveryRebuild, {
				coordinatedRebuildToken
			})
		).resolves.toEqual({ coordinatedRebuildToken });
		await expect(
			t.mutation(internal.seed.beginCoordinatedPublicDiscoveryRebuild, {
				coordinatedRebuildToken: 'overlapping-owner-token'
			})
		).rejects.toThrow('PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED');

		await expect(
			t.mutation(internal.templates.patchTagEmbeddings, {
				templateId,
				tagEmbeddings: [{ tag: 'locked', embedding: Array.from({ length: 768 }, () => 0) }]
			})
		).rejects.toThrow('PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED');
		await expect(t.mutation(internal.seed.clearTable, { table: 'templates' })).rejects.toThrow(
			'PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED'
		);
		await expect(
			t.mutation(internal.seed.clearTable, {
				table: 'templates',
				suppressDiscoveryRefresh: true
			})
		).rejects.toThrow('PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED');
		await expect(
			t.mutation(internal.seed.clearTable, {
				table: 'templates',
				suppressDiscoveryRefresh: true,
				coordinatedRebuildToken: 'wrong-owner-token'
			})
		).rejects.toThrow('PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED');

		await expect(t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {})).rejects.toThrow(
			'PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED'
		);
		await expect(t.mutation(internal.templates.rebuildRelationSnapshot, {})).rejects.toThrow(
			'PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED'
		);
		await expect(t.mutation(internal.templates.rebuildHomepageSnapshots, {})).rejects.toThrow(
			'PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED'
		);
		await expect(
			t.mutation(internal.templates.rebuildRelationSnapshotForCronAttempt, {})
		).rejects.toThrow('PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED');
		const lockedAttempt = await t.query(internal.templates.publicDiscoveryCronAttemptState, {});
		await expect(
			t.mutation(internal.templates.recordPublicDiscoverySnapshotRuntimeFailure, {
				failures: [{ family: 'list', code: 'MUST_NOT_STAMP_LOCKED_GENERATION' }],
				failedAt: Date.now(),
				attempt: lockedAttempt
			})
		).resolves.toEqual({ recorded: [] });
		await expect(
			t.mutation(internal.templates.recoverPublicDiscoveryScheduledRefreshFailure, {
				family: 'list',
				scheduledAt: supersededTokens.list!,
				code: 'MUST_NOT_RECOVER_LOCKED_GENERATION',
				failedAt: Date.now()
			})
		).resolves.toEqual({ recorded: [] });

		await t.run(async (ctx) => {
			const template = await ctx.db.get(templateId);
			expect(template?.tagEmbeddings).toBeUndefined();
			expect(template?.embeddingsUpdatedAt).toBeUndefined();
			const manifest = await ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique();
			expect(manifest).toMatchObject({
				listReady: false,
				relationsReady: false,
				listRevision: 1,
				relationsRevision: 1,
				coordinatedRebuildToken,
				coordinatedRebuildStartedAt: expect.any(Number)
			});
			expect(manifest?.listFailureAt).toBeUndefined();
			expect(manifest?.relationsFailureAt).toBeUndefined();
		});
		// A coordinated rebuild freezes the public generation; legacy readers keep
		// serving the preserved last-good rows, never the in-progress corpus.
		const [publicManifestWhileLocked, lastGoodList] = await Promise.all([
			t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET }),
			t.query(api.templates.listPublic, { excludeCwc: false })
		]);
		expect(publicManifestWhileLocked).toEqual({
			list: { ready: false, revision: 1, updatedAt: expect.any(Number) },
			relations: { ready: false, revision: 1, updatedAt: expect.any(Number) }
		});
		expect('coordinatedRebuildToken' in publicManifestWhileLocked).toBe(false);
		expect(lastGoodList).toHaveLength(1);
		expect(String(lastGoodList[0].id)).toBe(String(templateId));

		await expect(
			t.mutation(internal.seed.clearTable, {
				table: 'templates',
				suppressDiscoveryRefresh: true,
				coordinatedRebuildToken
			})
		).resolves.toEqual({ deleted: 1, failed: 0 });
		await expect(
			t.mutation(internal.templates.rebuildHomepageSnapshots, {
				coordinatedRebuildToken: 'wrong-owner-token'
			})
		).rejects.toThrow('PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED');
		await t.mutation(internal.templates.rebuildHomepageSnapshots, {
			coordinatedRebuildToken
		});
		await expect(
			t.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
				scheduledAt: supersededTokens.list!
			})
		).resolves.toEqual({ status: 'superseded' });
		await expect(
			t.mutation(internal.templates.flushScheduledPublicTemplateRelationsRefresh, {
				scheduledAt: supersededTokens.relations!
			})
		).resolves.toEqual({ status: 'superseded' });

		await t.run(async (ctx) => {
			expect(await ctx.db.get(templateId)).toBeNull();
			const manifest = await ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique();
			expect(manifest).toMatchObject({
				listReady: true,
				relationsReady: true,
				listRevision: 2,
				relationsRevision: 2
			});
			expect(manifest?.coordinatedRebuildToken).toBeUndefined();
			expect(manifest?.coordinatedRebuildStartedAt).toBeUndefined();
			expect(manifest?.listDirtyAt).toBeUndefined();
			expect(manifest?.relationsDirtyAt).toBeUndefined();
		});
	});

	it('permits only a new begin to take over a stale coordinated lock', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T02:00:00.000Z'));
		try {
			const t = convexTest({ schema, modules });
			const previousToken = 'stale-owner-token';
			const replacementToken = 'replacement-owner-token';
			await t.mutation(internal.seed.beginCoordinatedPublicDiscoveryRebuild, {
				coordinatedRebuildToken: previousToken
			});

			vi.advanceTimersByTime(PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS + 1);
			await expect(
				t.mutation(internal.seed.beginCoordinatedPublicDiscoveryRebuild, {
					coordinatedRebuildToken: replacementToken
				})
			).resolves.toEqual({ coordinatedRebuildToken: replacementToken });

			await expect(
				t.mutation(internal.seed.clearTable, {
					table: 'templates',
					suppressDiscoveryRefresh: true,
					coordinatedRebuildToken: previousToken
				})
			).rejects.toThrow('PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED');
			await expect(
				t.mutation(internal.templates.rebuildHomepageSnapshots, {
					coordinatedRebuildToken: previousToken
				})
			).rejects.toThrow('PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED');

			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest).toMatchObject({
					listReady: false,
					relationsReady: false,
					coordinatedRebuildToken: replacementToken,
					coordinatedRebuildStartedAt: Date.now()
				});
			});

			await t.mutation(internal.templates.rebuildHomepageSnapshots, {
				coordinatedRebuildToken: replacementToken
			});
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest).toMatchObject({
					listReady: true,
					relationsReady: true,
					listRevision: 1,
					relationsRevision: 1
				});
				expect(manifest?.coordinatedRebuildToken).toBeUndefined();
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
