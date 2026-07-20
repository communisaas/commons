/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import { PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS } from './lib/publicDiscovery';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;
const SSR_SECRET = 'seed-public-discovery-secret-32-bytes';

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SSR_SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => vi.unstubAllEnvs());

function newHarness(): Harness {
	return convexTest({ schema, modules });
}

async function migrateAndActivateSourcePlane(t: Harness) {
	let endorsementState: any = await t.mutation(internal.templates.migrateEndorsementCounts, {
		restart: true,
		scheduleContinuation: false
	});
	while (endorsementState.status === 'running') {
		endorsementState = await t.mutation(internal.templates.migrateEndorsementCounts, {
			runToken: endorsementState.runToken,
			scheduleContinuation: false
		});
	}
	expect(endorsementState.status).toBe('complete');

	let state: any = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
		scheduleContinuation: false
	});
	while (state.status === 'running') {
		state = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
			runToken: state.runToken,
			cursor: state.continueCursor,
			startedAt: state.startedAt,
			listDirtyAtAtStart: state.listDirtyAtAtStart,
			relationsDirtyAtAtStart: state.relationsDirtyAtAtStart,
			scanned: state.scanned,
			eligible: state.eligible,
			sourcesWritten: state.sourcesWritten,
			topicVectorsWritten: state.topicVectorsWritten,
			tagVectorsWritten: state.tagVectorsWritten,
			rejected: state.rejected,
			scheduleContinuation: false
		});
	}
	expect(state.status).toBe('migrated');
	await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});
	await t.mutation(internal.templates.migratePublicDiscoveryManifestAuthority, {});
	return state.runToken as string;
}

describe('seed maintenance public-discovery safety', () => {
	it('clearing a source corpus table invalidates and rebuilds discovery without wiping state', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
		try {
			const now = Date.now();
			const t = newHarness();
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
					endorsementCount: 0,
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
			const generation = await migrateAndActivateSourcePlane(t);
			await t.run(async (ctx) => {
				const template = await ctx.db
					.query('templates')
					.withIndex('by_slug', (q) => q.eq('slug', 'stale-seed-template'))
					.unique();
				expect(template).not.toBeNull();
				await ctx.db.insert('publicTemplateTopicVectors', {
					templateId: template!._id,
					generation,
					embedding: [0],
					embeddingVersion: 'clear-fixture',
					updatedAt: now
				});
				const orphanTemplateId = await ctx.db.insert('templates', {
					slug: 'orphaned-compact-source',
					title: 'Orphaned compact source',
					description: 'The canonical row is deleted before seed maintenance.',
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
					endorsementCount: 0,
					embeddingVersion: 'none',
					flaggedByModeration: false,
					consensusApproved: true,
					reputationDelta: 0,
					reputationApplied: false,
					updatedAt: now
				});
				await ctx.db.insert('publicTemplateDiscoverySources', {
					templateId: orphanTemplateId,
					generation,
					templateCreatedAt: now,
					isCwc: false,
					title: 'Orphaned compact source',
					domain: '',
					projectionVersion: 1,
					source: {},
					sourceBytes: 1,
					updatedAt: now
				});
				await ctx.db.insert('publicTemplateTopicVectors', {
					templateId: orphanTemplateId,
					generation,
					embedding: [0],
					embeddingVersion: 'orphan-fixture',
					updatedAt: now
				});
				await ctx.db.delete(orphanTemplateId);
			});

			await expect(
				t.mutation(internal.seed.clearTable, { table: 'templates' })
			).resolves.toMatchObject({
				deleted: 1,
				failed: 0,
				isDone: false,
				stage: 'rows'
			});
			await expect(
				t.mutation(internal.seed.clearTable, { table: 'templates' })
			).resolves.toMatchObject({
				deleted: 0,
				failed: 0,
				isDone: false,
				stage: 'compactSources'
			});
			await expect(
				t.mutation(internal.seed.clearTable, { table: 'templates' })
			).resolves.toMatchObject({
				deleted: 0,
				failed: 0,
				isDone: true,
				stage: 'complete'
			});

			await t.run(async (ctx) => {
				expect(await ctx.db.query('templates').collect()).toEqual([]);
				expect(await ctx.db.query('publicTemplateDiscoverySources').collect()).toEqual([]);
				expect(await ctx.db.query('publicTemplateTopicVectors').collect()).toEqual([]);
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
					relationsRefreshScheduledAt: expect.any(Number),
					listRefreshUrgency: 'urgent',
					relationsRefreshUrgency: 'urgent'
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
				expect(manifest?.listRefreshUrgency).toBeUndefined();
				expect(manifest?.relationsRefreshUrgency).toBeUndefined();
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
			const t = newHarness();
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
			await migrateAndActivateSourcePlane(t);

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
					listRefreshUrgency: 'urgent',
					relationsRefreshScheduledAt: relationToken,
					relationsFailureCode: 'PRESERVE_ME'
				});
				expect(manifest?.relationsDirtyAt).toBeUndefined();
				expect(manifest?.relationsRefreshUrgency).toBeUndefined();
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
				expect(manifest?.listRefreshUrgency).toBeUndefined();
				expect(await ctx.db.query('templateRelationSnapshots').collect()).toHaveLength(1);
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps destructive urgency monotone across ordinary writers and elapsed tokens', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T01:30:00.000Z'));
		try {
			const now = Date.now();
			const t = newHarness();
			await t.run(async (ctx) => {
				await ctx.db.insert('organizations', {
					name: 'Destructive urgency organization',
					slug: 'destructive-urgency-organization',
					maxSeats: 1,
					maxTemplatesMonth: 1,
					dmCacheTtlDays: 1,
					countryCode: 'US',
					isPublic: true,
					updatedAt: now
				});
				await ctx.db.insert('publicDiscoveryManifest', {
					key: 'public',
					listReady: true,
					relationsReady: true,
					listRevision: 1,
					relationsRevision: 1,
					listUpdatedAt: now,
					relationsUpdatedAt: now
				});
			});

			await t.mutation(internal.seed.clearTable, { table: 'organizations' });
			const destructive = await t.run(async (ctx) => {
				return await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
			});
			expect(destructive).toMatchObject({
				listReady: false,
				listDirtyAt: now,
				listRefreshUrgency: 'urgent'
			});
			const destructiveToken = destructive!.listRefreshScheduledAt!;

			const successor = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			// The destructive token is deliberately unique from the prior
			// publication/failure coordinates and remains future-eligible by one
			// millisecond. An ordinary writer coalesces into that urgent generation.
			expect(successor).toEqual({ scheduled: false, scheduledAt: destructiveToken });
			expect(successor.scheduledAt).toBeLessThan(now + 100);
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest).toMatchObject({
					listDirtyAt: now,
					listRefreshScheduledAt: successor.scheduledAt,
					listRefreshUrgency: 'urgent'
				});
			});

			await expect(
				t.mutation(internal.templates.requestPublicTemplateSnapshotRefresh, {})
			).resolves.toEqual({ scheduled: false, scheduledAt: successor.scheduledAt });

			vi.setSystemTime(successor.scheduledAt);
			const elapsedSuccessor = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			expect(elapsedSuccessor).toMatchObject({ scheduled: true });
			expect(elapsedSuccessor.scheduledAt).not.toBe(successor.scheduledAt);
			expect(elapsedSuccessor.scheduledAt).toBeLessThan(successor.scheduledAt + 100);
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest).toMatchObject({
					listDirtyAt: now,
					listRefreshScheduledAt: elapsedSuccessor.scheduledAt,
					listRefreshUrgency: 'urgent'
				});
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('clearSeed gates the old generation and publishes one coherent empty generation', async () => {
		const t = newHarness();
		const oldTemplateId = await t.run(async (ctx) => {
			const templateId = await ctx.db.insert('templates', {
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
				endorsementCount: 0,
				embeddingVersion: 'none',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: 1
			});
			for (let index = 0; index < 11; index++) {
				await ctx.db.insert('rateLimits', {
					key: `clear-seed-page-fixture:${index}`,
					windowStart: index,
					count: 1,
					updatedAt: index
				});
			}
			return templateId;
		});
		await migrateAndActivateSourcePlane(t);
		await t.mutation(internal.templates.rebuildHomepageSnapshots, {});

		const oldManifest = await t.query(api.templates.publicDiscoveryManifest, {
			_secret: SSR_SECRET
		});
		const oldList = await t.query(api.templates.publicDiscoveryList, {
			_secret: SSR_SECRET,
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
				t.query(api.templates.publicDiscoveryManifest, { _secret: SSR_SECRET }),
				t.query(api.templates.publicDiscoveryList, { _secret: SSR_SECRET, excludeCwc: false }),
				t.query(api.templates.publicDiscoveryList, { _secret: SSR_SECRET, excludeCwc: true }),
				t.query(api.templates.publicDiscoveryRelations, { _secret: SSR_SECRET, excludeCwc: false }),
				t.query(api.templates.publicDiscoveryRelations, { _secret: SSR_SECRET, excludeCwc: true })
			]);
		expect(manifest.list).toMatchObject({ ready: true, revision: 2 });
		expect(manifest.relations).toMatchObject({ ready: true, revision: 2 });
		expect(manifest.list.withdrawalEpoch).toBe(oldManifest.list.withdrawalEpoch + 1);
		expect(manifest.relations.withdrawalEpoch).toBe(oldManifest.relations.withdrawalEpoch + 1);
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
		await expect(
			t.query(api.templates.listPublic, { _secret: SSR_SECRET, excludeCwc: false })
		).resolves.toEqual([]);

		await t.run(async (ctx) => {
			expect(await ctx.db.query('templates').collect()).toEqual([]);
			expect(await ctx.db.query('rateLimits').collect()).toEqual([]);
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
		const t = newHarness();
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
				endorsementCount: 0,
				embeddingVersion: 'none',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: 1
			});
		});
		await migrateAndActivateSourcePlane(t);
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
				listWithdrawalEpoch: 1,
				relationsWithdrawalEpoch: 1,
				coordinatedRebuildToken,
				coordinatedRebuildStartedAt: expect.any(Number)
			});
			expect(manifest?.listFailureAt).toBeUndefined();
			expect(manifest?.relationsFailureAt).toBeUndefined();
		});
		// A coordinated rebuild freezes the public generation; legacy readers keep
		// serving the preserved last-good rows, never the in-progress corpus.
		const [publicManifestWhileLocked, lastGoodList] = await Promise.all([
			t.query(api.templates.publicDiscoveryManifest, { _secret: SSR_SECRET }),
			t.query(api.templates.listPublic, { _secret: SSR_SECRET, excludeCwc: false })
		]);
		expect(publicManifestWhileLocked).toEqual({
			list: {
				ready: false,
				retiredRevision: 1,
				revision: 1,
				updatedAt: expect.any(Number),
				withdrawalEpoch: 1
			},
			relations: {
				ready: false,
				retiredRevision: 1,
				revision: 1,
				updatedAt: expect.any(Number),
				withdrawalEpoch: 1
			}
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
		).resolves.toMatchObject({ deleted: 1, failed: 0, isDone: false, stage: 'rows' });
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
				relationsRevision: 2,
				listWithdrawalEpoch: 1,
				relationsWithdrawalEpoch: 1
			});
			expect(manifest?.coordinatedRebuildToken).toBeUndefined();
			expect(manifest?.coordinatedRebuildStartedAt).toBeUndefined();
			expect(manifest?.listDirtyAt).toBeUndefined();
			expect(manifest?.relationsDirtyAt).toBeUndefined();
		});
	});

	it('keeps exactly one owner-fenced watchdog across renewal and completion', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T01:00:00.000Z'));
		try {
			const t = newHarness();
			await migrateAndActivateSourcePlane(t);
			const coordinatedRebuildToken = 'renewed-watchdog-owner';
			const initialScheduledAt = Date.now() + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS;
			await t.mutation(internal.seed.beginCoordinatedPublicDiscoveryRebuild, {
				coordinatedRebuildToken
			});

			const watchdogJobs = () =>
				t.run(async (ctx) =>
					(await ctx.db.system.query('_scheduled_functions').collect()).filter(
						(job) => job.name === 'observability:superviseCoordinatedPublicDiscoveryRebuildWatchdog'
					)
				);
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest).toMatchObject({
					coordinatedRebuildToken,
					coordinatedRebuildAttempt: 1,
					coordinatedRebuildLeaseExpiresAt: initialScheduledAt,
					coordinatedRebuildWatchdogScheduledAt: initialScheduledAt
				});
			});
			expect(await watchdogJobs()).toHaveLength(1);

			vi.advanceTimersByTime(60_000);
			await t.finishInProgressScheduledFunctions();
			await t.mutation(internal.seed.clearTable, {
				table: 'templates',
				suppressDiscoveryRefresh: true,
				coordinatedRebuildToken
			});
			const renewedScheduledAt = Date.now() + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS;
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest?.coordinatedRebuildLeaseExpiresAt).toBe(renewedScheduledAt);
				// Renewal does not enqueue another job. The original durable slot owns
				// the one successor decision at its scheduled boundary.
				expect(manifest?.coordinatedRebuildWatchdogScheduledAt).toBe(initialScheduledAt);
			});
			expect(await watchdogJobs()).toHaveLength(1);

			vi.advanceTimersByTime(PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS - 60_000);
			await t.finishInProgressScheduledFunctions();
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest?.coordinatedRebuildWatchdogScheduledAt).toBe(renewedScheduledAt);
				expect(manifest?.coordinatedRebuildFailureAt).toBeUndefined();
			});
			expect(await watchdogJobs()).toHaveLength(2);

			await t.mutation(internal.templates.rebuildHomepageSnapshots, {
				coordinatedRebuildToken
			});
			vi.advanceTimersByTime(60_000);
			await t.finishInProgressScheduledFunctions();
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest?.coordinatedRebuildToken).toBeUndefined();
				expect(manifest?.coordinatedRebuildWatchdogScheduledAt).toBeUndefined();
				expect(manifest?.coordinatedRebuildFailureAt).toBeUndefined();
				const alerts = (await ctx.db.system.query('_scheduled_functions').collect()).filter(
					(job) => job.name === 'observability:reportCoordinatedPublicDiscoveryRebuildLeaseFailure'
				);
				expect(alerts).toHaveLength(0);
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('permits only a new begin to take over a stale coordinated lock', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T02:00:00.000Z'));
		try {
			const t = newHarness();
			await migrateAndActivateSourcePlane(t);
			const previousToken = 'stale-owner-token';
			const replacementToken = 'replacement-owner-token';
			await t.mutation(internal.seed.beginCoordinatedPublicDiscoveryRebuild, {
				coordinatedRebuildToken: previousToken
			});
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest).toMatchObject({
					coordinatedRebuildToken: previousToken,
					coordinatedRebuildAttempt: 1,
					listWithdrawalEpoch: 0,
					relationsWithdrawalEpoch: 0,
					coordinatedRebuildLeaseExpiresAt:
						Date.now() + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS,
					coordinatedRebuildWatchdogScheduledAt:
						Date.now() + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS
				});
			});

			const previousScheduledAt = Date.now() + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS;
			vi.advanceTimersByTime(PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS + 1);
			await t.finishInProgressScheduledFunctions();
			vi.advanceTimersByTime(0);
			await t.finishInProgressScheduledFunctions();
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest).toMatchObject({
					coordinatedRebuildToken: previousToken,
					coordinatedRebuildFailureCode: 'PUBLIC_DISCOVERY_COORDINATED_REBUILD_LEASE_EXPIRED'
				});
				expect(manifest?.coordinatedRebuildWatchdogScheduledAt).toBeUndefined();
				const alerts = (await ctx.db.system.query('_scheduled_functions').collect()).filter(
					(job) => job.name === 'observability:reportCoordinatedPublicDiscoveryRebuildLeaseFailure'
				);
				expect(alerts).toHaveLength(1);
			});
			await expect(
				t.mutation(internal.observability.superviseCoordinatedPublicDiscoveryRebuildWatchdog, {
					coordinatedRebuildToken: previousToken,
					coordinatedRebuildAttempt: 1,
					scheduledAt: previousScheduledAt
				})
			).resolves.toEqual({ status: 'superseded', shouldAlert: false });
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
					listWithdrawalEpoch: 0,
					relationsWithdrawalEpoch: 0,
					coordinatedRebuildToken: replacementToken,
					coordinatedRebuildStartedAt: Date.now(),
					coordinatedRebuildAttempt: 2,
					coordinatedRebuildLeaseExpiresAt:
						Date.now() + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS,
					coordinatedRebuildWatchdogScheduledAt:
						Date.now() + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS
				});
			});
			await expect(
				t.mutation(internal.observability.superviseCoordinatedPublicDiscoveryRebuildWatchdog, {
					coordinatedRebuildToken: previousToken,
					coordinatedRebuildAttempt: 1,
					scheduledAt: previousScheduledAt
				})
			).resolves.toEqual({ status: 'superseded', shouldAlert: false });

			vi.advanceTimersByTime(1_000);
			await t.mutation(internal.seed.clearTable, {
				table: 'templates',
				suppressDiscoveryRefresh: true,
				coordinatedRebuildToken: replacementToken
			});
			await t.run(async (ctx) => {
				const manifest = await ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique();
				expect(manifest?.coordinatedRebuildLeaseExpiresAt).toBe(
					Date.now() + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS
				);
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
				expect(manifest?.coordinatedRebuildLeaseExpiresAt).toBeUndefined();
				expect(manifest?.coordinatedRebuildAttempt).toBeUndefined();
				expect(manifest?.coordinatedRebuildWatchdogScheduledAt).toBeUndefined();
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('reseed publishes an empty generation when no seed users remain', async () => {
		const t = newHarness();
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
				endorsementCount: 0,
				embeddingVersion: 'none',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: 1
			});
			for (let index = 0; index < 3; index++) {
				await ctx.db.insert('templates', {
					slug: `old-reseed-draft-${index}`,
					title: `Old reseed draft ${index}`,
					description: 'Must be fully drained before the empty generation publishes',
					topics: [],
					type: 'email',
					deliveryMethod: 'email',
					preview: 'Preview',
					messageBody: 'x'.repeat(100_000),
					deliveryConfig: {},
					recipientConfig: {},
					status: 'draft',
					isPublic: false,
					verifiedSends: 0,
					uniqueDistricts: 0,
					endorsementCount: 0,
					embeddingVersion: 'none',
					flaggedByModeration: false,
					consensusApproved: false,
					reputationDelta: 0,
					reputationApplied: false,
					updatedAt: index + 2
				});
			}
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
		await migrateAndActivateSourcePlane(t);

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
			expect(await ctx.db.query('templates').collect()).toEqual([]);
			const snapshots = await ctx.db.query('publicTemplateSnapshots').collect();
			expect(snapshots).toHaveLength(2);
			expect(snapshots.every((snapshot) => snapshot.templates.length === 0)).toBe(true);
		});
	});

	it('keeps compact rows current through metric reset and scope backfill', async () => {
		const t = newHarness();
		const templateId = await t.run(async (ctx) => {
			const templateId = await ctx.db.insert('templates', {
				slug: 'va-rural-telehealth-expansion',
				title: 'Scope backfill fixture',
				description: 'Compact writer fixture',
				topics: ['telehealth'],
				type: 'campaign',
				deliveryMethod: 'cwc',
				preview: 'Preview',
				messageBody: 'Body',
				deliveryConfig: {},
				recipientConfig: {},
				status: 'published',
				isPublic: true,
				verifiedSends: 41,
				uniqueDistricts: 7,
				endorsementCount: 9,
				deliveredDistricts: ['VA-01'],
				embeddingVersion: 'none',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: 1
			});
			const orgId = await ctx.db.insert('organizations', {
				name: 'Metric reset endorser',
				slug: 'metric-reset-endorser',
				maxSeats: 1,
				maxTemplatesMonth: 1,
				dmCacheTtlDays: 1,
				countryCode: 'US',
				isPublic: true,
				updatedAt: 1
			});
			await ctx.db.insert('templateEndorsements', {
				templateId,
				orgId,
				endorsedAt: 1
			});
			return templateId;
		});
		await migrateAndActivateSourcePlane(t);

		await t.mutation(internal.seed.zeroTemplateMetrics, {});
		await t.mutation(internal.seed.backfillScopes, { scheduleContinuation: false });

		await t.run(async (ctx) => {
			const template = await ctx.db.get(templateId);
			expect(template).toMatchObject({
				verifiedSends: 0,
				uniqueDistricts: 0,
				endorsementCount: 1,
				deliveredDistricts: []
			});
			expect(template?.scopes?.length).toBeGreaterThan(0);

			const compact = await ctx.db
				.query('publicTemplateDiscoverySources')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.unique();
			expect(compact).not.toBeNull();
			expect(compact!.source).toMatchObject({
				verifiedSends: 0,
				uniqueDistricts: 0,
				endorsementCount: 1
			});
			expect((compact!.source as { scopes?: unknown[] }).scopes?.length).toBeGreaterThan(0);
		});
	});

	it('drains ordinary seed tables in bounded head pages without skipping rows', async () => {
		const t = newHarness();
		await t.run(async (ctx) => {
			for (let index = 0; index < 11; index++) {
				await ctx.db.insert('rateLimits', {
					key: `bounded-seed-clear:${index}`,
					windowStart: index,
					count: 1,
					updatedAt: index
				});
			}
		});

		let totalDeleted = 0;
		let pages = 0;
		let isDone = false;
		while (!isDone) {
			const page = await t.mutation(internal.seed.clearTable, { table: 'rateLimits' });
			expect(page.deleted).toBeLessThanOrEqual(4);
			expect(page.failed).toBe(0);
			totalDeleted += page.deleted;
			pages++;
			isDone = page.isDone;
		}

		expect(totalDeleted).toBe(11);
		expect(pages).toBe(4); // 4 + 4 + 3 + one explicit empty confirmation.
		await t.run(async (ctx) => {
			expect(await ctx.db.query('rateLimits').collect()).toEqual([]);
		});
	});

	it('skips endorsement recounts during a gated coordinated wipe and drains beyond 500', async () => {
		const t = newHarness();
		const { templateId } = await t.run(async (ctx) => {
			const templateId = await ctx.db.insert('templates', {
				slug: 'coordinated-endorsement-drain',
				title: 'Coordinated endorsement drain',
				description: 'The templates table is cleared immediately after endorsements.',
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
				endorsementCount: 600,
				embeddingVersion: 'none',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: 1
			});
			const orgId = await ctx.db.insert('organizations', {
				name: 'Coordinated endorsement org',
				slug: 'coordinated-endorsement-org',
				maxSeats: 1,
				maxTemplatesMonth: 1,
				dmCacheTtlDays: 1,
				countryCode: 'US',
				isPublic: true,
				updatedAt: 1
			});
			for (let index = 0; index < 600; index += 1) {
				await ctx.db.insert('templateEndorsements', {
					templateId,
					orgId,
					endorsedAt: index
				});
			}
			return { templateId };
		});
		const coordinatedRebuildToken = 'coordinated-600-endorsement-drain';
		await t.mutation(internal.seed.beginCoordinatedPublicDiscoveryRebuild, {
			coordinatedRebuildToken,
			kind: 'clearSeed'
		});

		let deleted = 0;
		let pages = 0;
		let isDone = false;
		while (!isDone) {
			const page = await t.mutation(internal.seed.clearTable, {
				table: 'templateEndorsements',
				suppressDiscoveryRefresh: true,
				coordinatedRebuildToken
			});
			expect(page.failed).toBe(0);
			deleted += page.deleted;
			pages += 1;
			isDone = page.isDone;
		}
		expect({ deleted, pages }).toEqual({ deleted: 600, pages: 151 });
		await t.run(async (ctx) => {
			expect(await ctx.db.query('templateEndorsements').collect()).toEqual([]);
			expect(await ctx.db.get(templateId)).toMatchObject({ endorsementCount: 600 });
		});
	});

	it('makes unsuppressed endorsement clears progress above 500 without republishing stale counts', async () => {
		const t = newHarness();
		const templateId = await t.run(async (ctx) => {
			const templateId = await ctx.db.insert('templates', {
				slug: 'direct-endorsement-drain',
				title: 'Direct endorsement drain',
				description: 'Compact source is hidden until an exact count is bounded.',
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
				endorsementCount: 505,
				embeddingVersion: 'none',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: 1
			});
			const orgId = await ctx.db.insert('organizations', {
				name: 'Direct endorsement org',
				slug: 'direct-endorsement-org',
				maxSeats: 1,
				maxTemplatesMonth: 1,
				dmCacheTtlDays: 1,
				countryCode: 'US',
				isPublic: true,
				updatedAt: 1
			});
			for (let index = 0; index < 505; index += 1) {
				await ctx.db.insert('templateEndorsements', {
					templateId,
					orgId,
					endorsedAt: index
				});
			}
			return templateId;
		});
		const migrated = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
			scheduleContinuation: false
		});
		expect(migrated.status).toBe('migrated');
		await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});

		await expect(
			t.mutation(internal.seed.clearTable, { table: 'templateEndorsements' })
		).resolves.toMatchObject({ deleted: 4, failed: 0, isDone: false });
		await t.run(async (ctx) => {
			expect(await ctx.db.get(templateId)).not.toHaveProperty('endorsementCount');
			expect(
				await ctx.db
					.query('publicTemplateDiscoverySources')
					.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
					.unique()
			).toBeNull();
		});

		await expect(
			t.mutation(internal.seed.clearTable, { table: 'templateEndorsements' })
		).resolves.toMatchObject({ deleted: 4, failed: 0, isDone: false });
		await t.run(async (ctx) => {
			expect(await ctx.db.get(templateId)).toMatchObject({ endorsementCount: 497 });
			const source = await ctx.db
				.query('publicTemplateDiscoverySources')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.unique();
			expect(source?.source).toMatchObject({ endorsementCount: 497 });
		});
	});

	it('repairs a direct one-to-zero endorsement clear before any rebuild runs', async () => {
		const t = newHarness();
		const templateId = await t.run(async (ctx) => {
			const templateId = await ctx.db.insert('templates', {
				slug: 'one-to-zero-endorsement',
				title: 'One to zero endorsement',
				description: 'Exact same-transaction repair fixture.',
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
				endorsementCount: 1,
				embeddingVersion: 'none',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: 1
			});
			const orgId = await ctx.db.insert('organizations', {
				name: 'One endorsement org',
				slug: 'one-endorsement-org',
				maxSeats: 1,
				maxTemplatesMonth: 1,
				dmCacheTtlDays: 1,
				countryCode: 'US',
				isPublic: true,
				updatedAt: 1
			});
			await ctx.db.insert('templateEndorsements', { templateId, orgId, endorsedAt: 1 });
			return templateId;
		});
		const migrated = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
			scheduleContinuation: false
		});
		expect(migrated.status).toBe('migrated');
		await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});

		await t.mutation(internal.seed.clearTable, { table: 'templateEndorsements' });
		await t.run(async (ctx) => {
			expect(await ctx.db.get(templateId)).toMatchObject({ endorsementCount: 0 });
			const source = await ctx.db
				.query('publicTemplateDiscoverySources')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.unique();
			expect(source?.source).toMatchObject({ endorsementCount: 0 });
		});
	});

	it('walks every template metric reset page without a full-table read or cursor skip', async () => {
		const t = newHarness();
		const templateIds = await t.run(async (ctx) => {
			const ids = [];
			for (let index = 0; index < 3; index++) {
				ids.push(
					await ctx.db.insert('templates', {
						slug: `metric-page-fixture-${index}`,
						title: `Metric page fixture ${index}`,
						description: 'Cursor-stability fixture',
						topics: [],
						type: 'email',
						deliveryMethod: 'email',
						preview: 'Preview',
						messageBody: 'x'.repeat(100_000),
						deliveryConfig: {},
						recipientConfig: {},
						status: 'draft',
						isPublic: false,
						verifiedSends: index + 1,
						uniqueDistricts: index + 1,
						deliveredDistricts: [`VA-0${index + 1}`],
						endorsementCount: 0,
						embeddingVersion: 'none',
						flaggedByModeration: false,
						consensusApproved: false,
						reputationDelta: 0,
						reputationApplied: false,
						updatedAt: index
					})
				);
			}
			return ids;
		});

		let cursor: string | undefined;
		let scanned = 0;
		let patched = 0;
		let pages = 0;
		let isDone = false;
		while (!isDone) {
			const page = await t.mutation(internal.seed.zeroTemplateMetrics, {
				cursor,
				scheduleContinuation: false
			});
			expect(page.scanned).toBeLessThanOrEqual(1);
			scanned += page.scanned;
			patched += page.patched;
			pages++;
			isDone = page.isDone;
			cursor = page.continueCursor ?? undefined;
		}

		expect({ scanned, patched, pages }).toEqual({ scanned: 3, patched: 3, pages: 3 });
		await t.run(async (ctx) => {
			for (const templateId of templateIds) {
				expect(await ctx.db.get(templateId)).toMatchObject({
					verifiedSends: 0,
					uniqueDistricts: 0,
					deliveredDistricts: []
				});
			}
		});
	});

	it('deletes at most one embedding-heavy template per transaction', async () => {
		const t = newHarness();
		await t.run(async (ctx) => {
			for (let index = 0; index < 3; index++) {
				await ctx.db.insert('templates', {
					slug: `large-clear-fixture-${index}`,
					title: `Large clear fixture ${index}`,
					description: 'Bounded destructive maintenance fixture',
					topics: [],
					type: 'email',
					deliveryMethod: 'email',
					preview: 'Preview',
					messageBody: 'x'.repeat(600_000),
					deliveryConfig: {},
					recipientConfig: {},
					status: 'draft',
					isPublic: false,
					verifiedSends: 0,
					uniqueDistricts: 0,
					endorsementCount: 0,
					embeddingVersion: 'none',
					flaggedByModeration: false,
					consensusApproved: false,
					reputationDelta: 0,
					reputationApplied: false,
					updatedAt: index
				});
			}
		});

		const deletions: number[] = [];
		let isDone = false;
		while (!isDone) {
			const page = await t.mutation(internal.seed.clearTable, { table: 'templates' });
			deletions.push(page.deleted);
			isDone = page.isDone;
		}
		expect(deletions).toEqual([1, 1, 1, 0]);
		await t.run(async (ctx) => {
			expect(await ctx.db.query('templates').collect()).toEqual([]);
			expect(await ctx.db.query('publicTemplateDiscoverySources').collect()).toEqual([]);
			expect(await ctx.db.query('publicTemplateTopicVectors').collect()).toEqual([]);
		});
	});

	it('rejects the generic clear primitive for tables outside the seed allowlist', async () => {
		const t = newHarness();
		await expect(t.mutation(internal.seed.clearTable, { table: 'anchorStatus' })).rejects.toThrow(
			'CLEAR_TABLE_NOT_ALLOWED'
		);
	});
});
