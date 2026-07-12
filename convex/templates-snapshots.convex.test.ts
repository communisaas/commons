/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import schema from './schema';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { computeTwinEdges } from './lib/relatedness';
import { clusterTagConcepts, conceptEdges, tagConceptMap } from './lib/tag_concepts';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type Harness = TestConvex<typeof schema>;
type TemplateValue = Omit<Doc<'templates'>, '_id' | '_creationTime'>;

function newHarness(): Harness {
	return convexTest(schema, modules);
}

function templateValue(index: number, overrides: Partial<TemplateValue> = {}): TemplateValue {
	return {
		slug: `template-${index}`,
		title: `Template ${index}`,
		description: `Description ${index}`,
		topics: [],
		type: 'email',
		deliveryMethod: 'email',
		preview: `Preview ${index}`,
		messageBody: `Message ${index}`,
		deliveryConfig: {},
		recipientConfig: {},
		status: 'published',
		isPublic: true,
		verifiedSends: 0,
		uniqueDistricts: 0,
		embeddingVersion: 'test-v1',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		updatedAt: 1_800_000_000_000 + index,
		...overrides
	};
}

function embedding(head: number[]): number[] {
	return [...head, ...new Array<number>(768 - head.length).fill(0)];
}

describe('templates materialized public snapshots', () => {
	it('rebuilds both bounded list variants once, preserves order, and retains last-good rows on oversize', async () => {
		const t = newHarness();

		await t.run(async (ctx) => {
			for (let index = 0; index < 260; index++) {
				await ctx.db.insert(
					'templates',
					templateValue(index, {
						deliveryMethod: index % 2 === 0 ? 'cwc' : 'email'
					})
				);
			}
			// These are newer than every eligible row but the exact compound index
			// must exclude them before they can displace a snapshot member.
			await ctx.db.insert('templates', templateValue(1_000, { status: 'draft', isPublic: true }));
			await ctx.db.insert(
				'templates',
				templateValue(1_001, { status: 'published', isPublic: false })
			);
		});

		// Cold start is intentionally honest and cheap: source rows do not trigger
		// an embedding-heavy fallback.
		expect(await t.query(api.templates.listPublic, {})).toEqual([]);

		const rebuilt = await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
		expect(rebuilt.list).toMatchObject({
			sourceCap: 250,
			scannedCount: 250,
			allCount: 50,
			excludeCwcCount: 50
		});
		expect(rebuilt.relations).toMatchObject({
			sourceCap: 50,
			sourceTemplateCount: 50,
			embeddedTemplateCount: 0
		});

		const all = await t.query(api.templates.listPublic, {});
		expect(all).toHaveLength(50);
		expect(all.map((template) => template.slug)).toEqual(
			Array.from({ length: 50 }, (_, offset) => `template-${259 - offset}`)
		);

		const excludingCwc = await t.query(api.templates.listPublic, {
			excludeCwc: true
		});
		expect(excludingCwc).toHaveLength(50);
		expect(excludingCwc.every((template) => template.deliveryMethod !== 'cwc')).toBe(true);
		expect(excludingCwc.map((template) => template.slug)).toEqual(
			Array.from({ length: 50 }, (_, offset) => `template-${259 - offset * 2}`)
		);

		const beforeOversize = all.map((template) => template.id);
		await t.run(async (ctx) => {
			for (let index = 0; index < 50; index++) {
				await ctx.db.insert(
					'templates',
					templateValue(2_000 + index, {
						messageBody: 'x'.repeat(22_000)
					})
				);
			}
		});

		await expect(t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {})).rejects.toThrow(
			/PUBLIC_TEMPLATE_SNAPSHOT_TOO_LARGE:all/
		);
		expect((await t.query(api.templates.listPublic, {})).map((template) => template.id)).toEqual(
			beforeOversize
		);
	});

	it('publishes pure-helper-equivalent relations and never live-scans on reads', async () => {
		const t = newHarness();
		const topicVectors = [
			embedding([10, 1, 0, 0]),
			embedding([10, 1, 0, 0]),
			embedding([10, 0, 1, 0]),
			embedding([10, 0, -1, 0])
		];
		const tags = ['libraries', 'library-card', 'rural-access', 'ceo-pay-ratio'];
		const tagVectors = [
			embedding([10, 2, 0]),
			embedding([10, 1, 0]),
			embedding([10, 0, 1]),
			embedding([10, 0, -1])
		];

		const ids = await t.run(async (ctx) => {
			const inserted: Id<'templates'>[] = [];
			for (let index = 0; index < 4; index++) {
				const id = await ctx.db.insert(
					'templates',
					templateValue(index, {
						topics: [tags[index]],
						topicEmbedding: topicVectors[index],
						tagEmbeddings: [{ tag: tags[index], embedding: tagVectors[index] }]
					})
				);
				inserted.push(id);
			}
			// Both rows carry valid vectors but are outside the exact public corpus.
			await ctx.db.insert(
				'templates',
				templateValue(10, {
					status: 'draft',
					topicEmbedding: embedding([10, 1, 0, 0])
				})
			);
			await ctx.db.insert(
				'templates',
				templateValue(11, {
					isPublic: false,
					topicEmbedding: embedding([10, 1, 0, 0])
				})
			);
			return inserted;
		});

		expect(await t.query(api.templates.relatednessEdges, {})).toEqual([]);
		expect(await t.query(api.templates.conceptRelations, {})).toEqual({
			edges: [],
			conceptMap: {}
		});

		const rebuilt = await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		expect(rebuilt).toMatchObject({
			sourceCap: 50,
			sourceTemplateCount: 4,
			embeddedTemplateCount: 4,
			tagVectorCount: 4
		});

		const expectedTwins = computeTwinEdges(
			ids.map((id, index) => ({ id, embedding: topicVectors[index] }))
		);
		const concepts = clusterTagConcepts(
			tags.map((tag, index) => ({ tag, embedding: tagVectors[index] }))
		);
		const expectedConceptEdges = conceptEdges(
			ids.map((id, index) => ({ id, tags: [tags[index]] })),
			concepts
		);

		expect(await t.query(api.templates.relatednessEdges, {})).toEqual(expectedTwins);
		expect(await t.query(api.templates.conceptRelations, {})).toEqual({
			edges: expectedConceptEdges,
			conceptMap: tagConceptMap(concepts)
		});

		// Mutating an embedding after publication must not affect request reads
		// until the explicit rebuild publishes a new singleton.
		await t.run(async (ctx) => {
			await ctx.db.patch(ids[0], {
				topicEmbedding: embedding([10, -20, 0, 0])
			});
		});
		expect(await t.query(api.templates.relatednessEdges, {})).toEqual(expectedTwins);

		await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		const snapshotRows = await t.run(async (ctx) =>
			ctx.db.query('templateRelationSnapshots').collect()
		);
		expect(snapshotRows).toHaveLength(1);
		expect(snapshotRows[0]).toMatchObject({
			key: 'public',
			sourceCap: 50,
			sourceTemplateCount: 4
		});
		expect(JSON.stringify(snapshotRows[0])).not.toContain('topicEmbedding');
		expect(JSON.stringify(snapshotRows[0])).not.toContain('tagEmbeddings');
	});
});
