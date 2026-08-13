/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';

import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

function preparedItem(overrides: Record<string, unknown> = {}) {
	return {
		category: 'legislative',
		title: 'A bounded prepared intelligence item',
		source: 'operator-reviewed-feed',
		sourceUrl: 'https://example.gov/item',
		publishedAt: 1_800_000_000_000,
		snippet: 'Prepared outside Convex.',
		topics: ['civic infrastructure'],
		entities: ['Example Agency'],
		embedding: [1, ...new Array<number>(767).fill(0)],
		relevanceScore: 0.9,
		sentiment: 'neutral',
		geographicScope: 'US',
		expiresAt: 1_900_000_000_000,
		...overrides
	};
}

describe('intelligence prepared-data storage boundary', () => {
	it('stores one already-produced, finite, dimension-pinned vector without an action', async () => {
		const t = convexTest(schema, modules);
		const id = await t.mutation(internal.intelligence.store, preparedItem());

		const row = await t.run((ctx) => ctx.db.get(id));
		expect(row).toMatchObject({
			category: 'legislative',
			title: 'A bounded prepared intelligence item'
		});
		expect(row?.embedding).toHaveLength(768);
	});

	it('rejects malformed vectors and oversized record fan-in before writing', async () => {
		const t = convexTest(schema, modules);

		await expect(
			t.mutation(internal.intelligence.store, preparedItem({ embedding: [1, 2] }))
		).rejects.toThrow('INTELLIGENCE_EMBEDDING_INVALID');
		await expect(
			t.mutation(
				internal.intelligence.store,
				preparedItem({ topics: Array.from({ length: 33 }, (_, index) => `topic-${index}`) })
			)
		).rejects.toThrow('INTELLIGENCE_TOPICS_TOO_MANY');
		await expect(
			t.mutation(internal.intelligence.store, preparedItem({ title: 'x'.repeat(4_001) }))
		).rejects.toThrow('INTELLIGENCE_TITLE_TOO_LARGE');

		await expect(t.run((ctx) => ctx.db.query('intelligence').collect())).resolves.toEqual([]);
	});
});
