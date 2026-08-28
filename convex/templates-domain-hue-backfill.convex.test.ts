/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';

import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type TemplateValue = Omit<Doc<'templates'>, '_id' | '_creationTime'>;

function templateValue(index: number, overrides: Partial<TemplateValue> = {}): TemplateValue {
	return {
		slug: `domain-hue-backfill-${index}`,
		title: `Domain hue backfill ${index}`,
		description: 'Cursor paging fixture',
		topics: [],
		type: 'email',
		deliveryMethod: 'email' as const,
		preview: 'Preview',
		messageBody: 'Message',
		deliveryConfig: {},
		recipientConfig: {},
		status: 'draft',
		isPublic: false,
		verifiedSends: 0,
		uniqueDistricts: 0,
		embeddingVersion: 'test',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		updatedAt: 1_800_000_000_000 + index,
		...overrides
	};
}

describe('domain hue backfill paging', () => {
	it('advances past an empty completed prefix and preserves hue zero', async () => {
		const t = convexTest(schema, modules);
		const ids = await t.run(async (ctx) => {
			const inserted = [];
			for (let index = 0; index < 8; index += 1) {
				inserted.push(
					await ctx.db.insert(
						'templates',
						templateValue(index, { topicEmbedding: [1, 0], domainHue: 0 })
					)
				);
			}
			inserted.push(await ctx.db.insert('templates', templateValue(8, { topicEmbedding: [1, 0] })));
			inserted.push(await ctx.db.insert('templates', templateValue(9)));
			return inserted;
		});

		const first = await t.query(internal.templates._listMissingDomainHue, {});
		expect(first).toMatchObject({ candidates: [], scanned: 8, isDone: false });
		expect(first.continueCursor).not.toBeNull();
		if (first.continueCursor === null) throw new Error('expected a second scan page');

		await expect(
			t.query(internal.templates._listMissingDomainHue, {
				cursor: first.continueCursor
			})
		).resolves.toMatchObject({
			candidates: [{ _id: ids[8], topicEmbedding: [1, 0] }],
			scanned: 2,
			continueCursor: null,
			isDone: true
		});

		await expect(
			t.action(internal.templates.backfillDomainHue, {
				anchors: [{ hue: 42, embedding: [1, 0] }]
			})
		).resolves.toEqual({ processed: 1, total: 1, scanned: 10, pages: 2 });

		const rows = await t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
		for (const row of rows.slice(0, 8)) expect(row?.domainHue).toBe(0);
		expect(rows[8]?.domainHue).toBeCloseTo(42);
		expect(rows[9]?.domainHue).toBeUndefined();
	});

	it('rejects empty, malformed, mixed-dimension, and non-finite anchors before writes', async () => {
		const invalidAnchors = [
			[],
			[{ hue: 0, embedding: [] }],
			[
				{ hue: 0, embedding: [1, 0] },
				{ hue: 90, embedding: [1] }
			],
			[{ hue: 360, embedding: [1, 0] }],
			[{ hue: Number.NaN, embedding: [1, 0] }],
			[{ hue: 0, embedding: [Number.POSITIVE_INFINITY, 0] }]
		];

		for (const [index, anchors] of invalidAnchors.entries()) {
			const t = convexTest(schema, modules);
			const templateId = await t.run((ctx) =>
				ctx.db.insert('templates', templateValue(index, { topicEmbedding: [1, 0] }))
			);
			await expect(t.action(internal.templates.backfillDomainHue, { anchors })).rejects.toThrow(
				/DOMAIN_HUE_ANCHOR/
			);
			expect((await t.run((ctx) => ctx.db.get(templateId)))?.domainHue).toBeUndefined();
		}
	});

	it('validates every candidate dimension before scheduling any page patch', async () => {
		const t = convexTest(schema, modules);
		const ids = await t.run(async (ctx) => [
			await ctx.db.insert('templates', templateValue(20, { topicEmbedding: [1, 0] })),
			await ctx.db.insert('templates', templateValue(21, { topicEmbedding: [1] }))
		]);

		await expect(
			t.action(internal.templates.backfillDomainHue, {
				anchors: [{ hue: 42, embedding: [1, 0] }]
			})
		).rejects.toThrow('DOMAIN_HUE_CANDIDATE_VECTOR_INVALID');
		const rows = await t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
		expect(rows.every((row) => row?.domainHue === undefined)).toBe(true);
	});

	it('enforces finite canonical hue range again inside the patch mutation', async () => {
		for (const domainHue of [-1, 360, Number.NaN, Number.POSITIVE_INFINITY]) {
			const t = convexTest(schema, modules);
			const templateId = await t.run((ctx) =>
				ctx.db.insert('templates', templateValue(30, { topicEmbedding: [1, 0] }))
			);
			await expect(
				t.mutation(internal.templates._patchDomainHue, { templateId, domainHue })
			).rejects.toThrow('DOMAIN_HUE_VALUE_INVALID');
			expect((await t.run((ctx) => ctx.db.get(templateId)))?.domainHue).toBeUndefined();
		}
	});
});
