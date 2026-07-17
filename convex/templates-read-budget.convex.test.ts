/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import type { TransactionMetrics } from 'convex/server';

import { api, internal } from './_generated/api';
import schema from './schema';

// Keep tests out of the function module map while allowing convex-test to run
// the real registered handlers.
const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type Harness = TestConvex<typeof schema>;

const VECTOR = Array.from({ length: 768 }, (_, index) => index / 768);

function newHarness(): Harness {
	return convexTest({
		schema,
		modules,
		// The materialized relation queries should fit comfortably beneath this
		// budget. Hydrating even one fixture template's three vectors does not.
		transactionLimits: {
			bytesRead: 12_000,
			documentsRead: 4,
			databaseQueries: 4
		}
	});
}

function newRebuildHarness(): Harness {
	return convexTest({ schema, modules });
}

function getTransactionMetrics(ctx: unknown): Promise<TransactionMetrics> {
	// convex-test 0.0.54 implements the current ctx.meta syscall, while its
	// published GenericQueryCtx type still reflects the older Convex surface.
	return (
		ctx as {
			meta: { getTransactionMetrics: () => Promise<TransactionMetrics> };
		}
	).meta.getTransactionMetrics();
}

async function seedHeavyTemplates(t: Harness, count: number): Promise<void> {
	await t.run(async (ctx) => {
		for (let index = 0; index < count; index += 1) {
			await ctx.db.insert('templates', {
				slug: `heavy-${index}`,
				title: `Heavy template ${index}`,
				description: 'Embedding-heavy regression fixture',
				topics: [`topic-${index}`],
				type: 'email',
				deliveryMethod: 'email',
				preview: 'Preview',
				messageBody: 'Message body',
				deliveryConfig: {},
				recipientConfig: {},
				status: 'published',
				isPublic: true,
				verifiedSends: 10,
				uniqueDistricts: 4,
				locationEmbedding: VECTOR,
				topicEmbedding: VECTOR,
				tagEmbeddings: [{ tag: `topic-${index}`, embedding: VECTOR }],
				embeddingVersion: 'test-v1',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: 1_800_000_000_000 + index
			});
		}
	});
}

describe('public template query read budgets', () => {
	it('the activation rebuild publishes bounded list and relation snapshots with no vector leakage', async () => {
		const t = newRebuildHarness();
		await seedHeavyTemplates(t, 20);
		await t.run(async (ctx) => {
			const cwcTemplate = await ctx.db
				.query('templates')
				.withIndex('by_status_isPublic', (q) => q.eq('status', 'published').eq('isPublic', true))
				.first();
			expect(cwcTemplate).not.toBeNull();
			await ctx.db.patch(cwcTemplate!._id, { deliveryMethod: 'cwc' });
		});

		const rebuilt = await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
		expect(rebuilt.list).toMatchObject({
			sourceCap: 250,
			scannedCount: 20,
			allCount: 20,
			excludeCwcCount: 19
		});
		expect(rebuilt.relations).toMatchObject({
			sourceScanCap: 250,
			scannedCount: 20,
			all: {
				sourceCap: 50,
				sourceTemplateCount: 20,
				embeddedTemplateCount: 20,
				tagVectorCount: 20
			},
			excludeCwc: {
				sourceCap: 50,
				sourceTemplateCount: 19,
				embeddedTemplateCount: 19,
				tagVectorCount: 19
			}
		});

		const all = await t.query(api.templates.listPublic, { excludeCwc: false });
		const excludingCwc = await t.query(api.templates.listPublic, { excludeCwc: true });
		expect(all).toHaveLength(20);
		expect(excludingCwc).toHaveLength(19);
		expect(excludingCwc.every((template) => template.deliveryMethod !== 'cwc')).toBe(true);
		for (const template of all) {
			expect(template).not.toHaveProperty('locationEmbedding');
			expect(template).not.toHaveProperty('topicEmbedding');
			expect(template).not.toHaveProperty('tagEmbeddings');
		}

		const relationSnapshot = await t.run(async (ctx) =>
			ctx.db
				.query('templateRelationSnapshots')
				.withIndex('by_key', (q) => q.eq('key', 'all'))
				.unique()
		);
		expect(relationSnapshot).toMatchObject({
			sourceCap: 50,
			sourceTemplateCount: 20,
			embeddedTemplateCount: 20,
			tagVectorCount: 20
		});
	});

	it('listPublic returns an honest empty list without scanning templates on snapshot cold start', async () => {
		const t = newHarness();
		await seedHeavyTemplates(t, 20);

		const observed = await t.query(async (ctx) => {
			const result = await ctx.runQuery(api.templates.listPublic, { excludeCwc: false });
			return { result, metrics: await getTransactionMetrics(ctx) };
		});

		expect(observed.result).toEqual([]);
		expect(observed.metrics.documentsRead.used).toBe(0);
		expect(observed.metrics.databaseQueries.used).toBe(1);
		expect(observed.metrics.bytesRead.used).toBe(0);
	});

	it('listPublic reads one compact, feature-gate-specific snapshot', async () => {
		const t = newHarness();
		await seedHeavyTemplates(t, 20);
		const allCard = {
			id: 'template-all',
			slug: 'all-template',
			title: 'All template',
			deliveryMethod: 'cwc',
			is_public: true
		};
		const nonCwcCard = {
			id: 'template-email',
			slug: 'email-template',
			title: 'Email template',
			deliveryMethod: 'email',
			is_public: true
		};
		await t.run(async (ctx) => {
			await ctx.db.insert('publicTemplateSnapshots', {
				key: 'all',
				revision: 7,
				templates: [allCard, nonCwcCard],
				sourceCount: 20,
				updatedAt: 1_800_000_000_000
			});
			await ctx.db.insert('publicTemplateSnapshots', {
				key: 'excludeCwc',
				revision: 7,
				templates: [nonCwcCard],
				sourceCount: 20,
				updatedAt: 1_800_000_000_000
			});
		});

		const all = await t.query(async (ctx) => {
			const result = await ctx.runQuery(api.templates.listPublic, { excludeCwc: false });
			return { result, metrics: await getTransactionMetrics(ctx) };
		});
		expect(all.result).toEqual([allCard, nonCwcCard]);
		expect(all.metrics.documentsRead.used).toBe(1);
		expect(all.metrics.databaseQueries.used).toBe(1);
		expect(all.metrics.bytesRead.used).toBeLessThan(2_000);

		const excludingCwc = await t.query(async (ctx) => {
			const result = await ctx.runQuery(api.templates.listPublic, { excludeCwc: true });
			return { result, metrics: await getTransactionMetrics(ctx) };
		});
		expect(excludingCwc.result).toEqual([nonCwcCard]);
		expect(excludingCwc.metrics.documentsRead.used).toBe(1);
		expect(excludingCwc.metrics.databaseQueries.used).toBe(1);
		expect(excludingCwc.metrics.bytesRead.used).toBeLessThan(2_000);

		const versioned = await t.query(async (ctx) => {
			const result = await ctx.runQuery(api.templates.publicDiscoveryList, {
				excludeCwc: false
			});
			return { result, metrics: await getTransactionMetrics(ctx) };
		});
		expect(versioned.result).toEqual({
			revision: 7,
			updatedAt: 1_800_000_000_000,
			templates: [allCard, nonCwcCard]
		});
		expect(versioned.metrics.documentsRead.used).toBe(1);
		expect(versioned.metrics.databaseQueries.used).toBe(1);
		expect(versioned.metrics.bytesRead.used).toBeLessThan(2_000);
	});

	it('the readiness manifest reads only its compact singleton', async () => {
		const t = newHarness();
		await seedHeavyTemplates(t, 20);
		await t.run(async (ctx) => {
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				relationsReady: true,
				listRevision: 7,
				relationsRevision: 9,
				listUpdatedAt: 1_800_000_000_000,
				relationsUpdatedAt: 1_800_000_000_001
			});
		});

		const observed = await t.query(async (ctx) => {
			const result = await ctx.runQuery(api.templates.publicDiscoveryManifest, {});
			return { result, metrics: await getTransactionMetrics(ctx) };
		});

		expect(observed.result).toEqual({
			list: { ready: true, revision: 7, updatedAt: 1_800_000_000_000 },
			relations: { ready: true, revision: 9, updatedAt: 1_800_000_000_001 }
		});
		expect(observed.metrics.documentsRead.used).toBe(1);
		expect(observed.metrics.databaseQueries.used).toBe(1);
		expect(observed.metrics.bytesRead.used).toBeLessThan(1_000);
	});

	it('relation queries return honest empty shapes without scanning templates on snapshot cold start', async () => {
		const t = newHarness();
		await seedHeavyTemplates(t, 20);

		const observed = await t.query(async (ctx) => {
			const twins = await ctx.runQuery(api.templates.relatednessEdges, {});
			const concepts = await ctx.runQuery(api.templates.conceptRelations, {});
			return { twins, concepts, metrics: await getTransactionMetrics(ctx) };
		});

		expect(observed.twins).toEqual([]);
		expect(observed.concepts).toEqual({ edges: [], conceptMap: {} });
		expect(observed.metrics.documentsRead.used).toBe(0);
		expect(observed.metrics.databaseQueries.used).toBe(2);
		expect(observed.metrics.bytesRead.used).toBe(0);
	});

	it('relation queries hydrate only the compact snapshot, never embedding-heavy templates', async () => {
		const t = newHarness();
		await seedHeavyTemplates(t, 20);
		await t.run(async (ctx) => {
			await ctx.db.insert('templateRelationSnapshots', {
				key: 'all',
				revision: 9,
				twinEdges: [{ a: 'alpha', b: 'beta', score: 0.91, kind: 'twin' }],
				conceptEdges: [{ a: 'alpha', b: 'beta', concept: 'libraries', kind: 'concept' }],
				conceptEntries: [
					{ tag: 'library-card', concept: 'libraries' },
					{ tag: 'libraries', concept: 'libraries' }
				],
				sourceCap: 50,
				sourceTemplateCount: 20,
				embeddedTemplateCount: 20,
				tagVectorCount: 20,
				updatedAt: 1_800_000_000_000
			});
		});

		const twins = await t.query(async (ctx) => {
			const result = await ctx.runQuery(api.templates.relatednessEdges, {});
			return { result, metrics: await getTransactionMetrics(ctx) };
		});
		expect(twins.result).toEqual([{ a: 'alpha', b: 'beta', score: 0.91, kind: 'twin' }]);
		expect(twins.metrics.documentsRead.used).toBe(1);
		expect(twins.metrics.databaseQueries.used).toBe(1);
		expect(twins.metrics.bytesRead.used).toBeLessThan(2_000);

		const concepts = await t.query(async (ctx) => {
			const result = await ctx.runQuery(api.templates.conceptRelations, {});
			return { result, metrics: await getTransactionMetrics(ctx) };
		});
		expect(concepts.result).toEqual({
			edges: [{ a: 'alpha', b: 'beta', concept: 'libraries', kind: 'concept' }],
			conceptMap: {
				'library-card': 'libraries',
				libraries: 'libraries'
			}
		});
		expect(concepts.metrics.documentsRead.used).toBe(1);
		expect(concepts.metrics.databaseQueries.used).toBe(1);
		expect(concepts.metrics.bytesRead.used).toBeLessThan(2_000);

		const combined = await t.query(async (ctx) => {
			const result = await ctx.runQuery(api.templates.publicDiscoveryRelations, {});
			return { result, metrics: await getTransactionMetrics(ctx) };
		});
		expect(combined.result).toEqual({
			revision: 9,
			updatedAt: 1_800_000_000_000,
			twinEdges: [{ a: 'alpha', b: 'beta', score: 0.91, kind: 'twin' }],
			conceptRelations: {
				edges: [{ a: 'alpha', b: 'beta', concept: 'libraries', kind: 'concept' }],
				conceptMap: {
					'library-card': 'libraries',
					libraries: 'libraries'
				}
			}
		});
		expect(combined.metrics.documentsRead.used).toBe(1);
		expect(combined.metrics.databaseQueries.used).toBe(1);
		expect(combined.metrics.bytesRead.used).toBeLessThan(2_000);
	});
});
