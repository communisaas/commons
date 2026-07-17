/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';

import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

describe('seed maintenance public-discovery safety', () => {
	it('clearing a source corpus table also removes ready discovery state atomically', async () => {
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
				updatedAt: 3
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
				updatedAt: 4
			});
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				relationsReady: true,
				listRevision: 3,
				relationsRevision: 4,
				listUpdatedAt: 3,
				relationsUpdatedAt: 4
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
			expect(await ctx.db.query('embeddingBackfillLeases').collect()).toEqual([]);
			expect(await ctx.db.query('publicTemplateSnapshots').collect()).toEqual([]);
			expect(await ctx.db.query('templateRelationSnapshots').collect()).toEqual([]);
			expect(await ctx.db.query('publicDiscoveryManifest').collect()).toEqual([]);
			expect(await ctx.db.query('relatednessCalibration').collect()).toEqual([]);
		});
	});

	it('rejects the generic clear primitive for tables outside the seed allowlist', async () => {
		const t = convexTest({ schema, modules });
		await expect(t.mutation(internal.seed.clearTable, { table: 'anchorStatus' })).rejects.toThrow(
			'CLEAR_TABLE_NOT_ALLOWED'
		);
	});
});
