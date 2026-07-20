/// <reference types="vite/client" />

import { describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { getConvexSize, type Value } from 'convex/values';

import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const VECTOR = Array.from({ length: 768 }, (_, index) => index / 768);
type Harness = TestConvex<typeof schema>;

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
	return state.runToken as string;
}

describe('submission aggregate compact-source writers', () => {
	it('updates the active compact row with both incremental and backfilled reach', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
		try {
			const t = convexTest({ schema, modules });
			const templateId = await t.run(async (ctx) => {
				return await ctx.db.insert('templates', {
					slug: 'submission-source-writer',
					title: 'Submission source writer',
					description: 'Submission aggregate fixture',
					topics: ['accountability'],
					type: 'campaign',
					deliveryMethod: 'cwc',
					preview: 'Preview',
					messageBody: 'Body',
					deliveryConfig: {},
					recipientConfig: {},
					status: 'published',
					isPublic: true,
					verifiedSends: 0,
					uniqueDistricts: 0,
					endorsementCount: 0,
					topicEmbedding: VECTOR,
					tagEmbeddings: [{ tag: 'accountability', embedding: VECTOR }],
					embeddingVersion: 'none',
					flaggedByModeration: false,
					consensusApproved: true,
					reputationDelta: 0,
					reputationApplied: false,
					updatedAt: Date.now()
				});
			});
			const generation = await migrateAndActivateSourcePlane(t);
			const vectorIdentity = await t.run(async (ctx) => {
				const topic = await ctx.db
					.query('publicTemplateTopicVectors')
					.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
					.unique();
				const tag = await ctx.db
					.query('publicTagEmbeddingVectors')
					.withIndex('by_tag', (q) => q.eq('tag', 'accountability'))
					.unique();
				expect(topic).not.toBeNull();
				expect(tag).not.toBeNull();
				await ctx.db.patch(topic!._id, { updatedAt: 101 });
				await ctx.db.patch(tag!._id, { updatedAt: 202 });
				return {
					topicId: topic!._id,
					tagId: tag!._id
				};
			});

			await t.mutation(internal.submissions.incrementTemplateReach, {
				templateId: 'submission-source-writer',
				districtCode: 'CA-11',
				verifiedAt: Date.now(),
				trustTier: 4
			});

			await t.run(async (ctx) => {
				const compact = await ctx.db
					.query('publicTemplateDiscoverySources')
					.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
					.unique();
				expect(compact).toMatchObject({ generation });
				expect(compact!.source).toMatchObject({
					verifiedSends: 1,
					uniqueDistricts: 1,
					districtCounts: [{ code: 'CA-11', count: 1 }],
					tierCounts: [0, 0, 0, 0, 1, 0]
				});

				await ctx.db.insert('submissions', {
					pseudonymousId: 'submission-source-backfill',
					templateId,
					proofHex: '00',
					publicInputs: {},
					nullifier: 'submission-source-backfill-nullifier',
					actionId: 'submission-source-backfill-action',
					encryptedWitness: 'fixture',
					deliveryStatus: 'delivered',
					resolvedDistrict: 'NY-10',
					verificationStatus: 'verified',
					verifiedAt: Date.now(),
					trustTier: 3,
					updatedAt: Date.now()
				});
			});

			await expect(
				t.mutation(internal.submissions._backfillOneTemplate, {
					templateId,
					today: Date.parse('2026-07-18T00:00:00.000Z'),
					dailyArrivals: [...new Array(29).fill(0), 1],
					districtCounts: [{ code: 'NY-10', count: 1 }],
					tierCounts: [0, 0, 0, 1, 0, 0]
				})
			).resolves.toEqual({ patched: true });

			await t.run(async (ctx) => {
				const compact = await ctx.db
					.query('publicTemplateDiscoverySources')
					.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
					.unique();
				expect(compact).toMatchObject({ generation });
				expect(compact!.source).toMatchObject({
					districtCounts: [{ code: 'NY-10', count: 1 }],
					tierCounts: [0, 0, 0, 1, 0, 0]
				});
				expect(
					(compact!.source as { dailyArrivals: number[] }).dailyArrivals.reduce(
						(total, value) => total + value,
						0
					)
				).toBe(1);

				const topic = await ctx.db
					.query('publicTemplateTopicVectors')
					.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
					.unique();
				const tag = await ctx.db
					.query('publicTagEmbeddingVectors')
					.withIndex('by_tag', (q) => q.eq('tag', 'accountability'))
					.unique();
				expect(topic).toMatchObject({ _id: vectorIdentity.topicId, updatedAt: 101 });
				expect(tag).toMatchObject({ _id: vectorIdentity.tagId, updatedAt: 202 });
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps a 500-district canonical histogram inside the six-row compact projection', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
		try {
			const t = convexTest({ schema, modules });
			const initialDistrictCounts = Array.from({ length: 499 }, (_, index) => ({
				code: `D${index.toString().padStart(3, '0')}`,
				count: index + 1
			}));
			const deliveredDistricts = initialDistrictCounts.map(({ code }) => code);
			const templateId = await t.run((ctx) =>
				ctx.db.insert('templates', {
					slug: 'near-max-district-histogram',
					title: 'T'.repeat(200),
					description: 'D'.repeat(1_000),
					domain: 'd'.repeat(200),
					topics: ['accountability', 'budget', 'housing', 'oversight', 'transparency'],
					type: 'campaign',
					deliveryMethod: 'cwc',
					preview: 'P'.repeat(500),
					messageBody: 'M'.repeat(10_000),
					deliveryConfig: {},
					recipientConfig: {},
					status: 'published',
					isPublic: true,
					verifiedSends: 499,
					uniqueDistricts: 499,
					deliveredDistricts,
					districtCounts: initialDistrictCounts,
					endorsementCount: 0,
					embeddingVersion: 'none',
					flaggedByModeration: false,
					consensusApproved: true,
					reputationDelta: 0,
					reputationApplied: false,
					updatedAt: Date.now()
				})
			);
			await migrateAndActivateSourcePlane(t);

			await expect(
				t.mutation(internal.submissions.incrementTemplateReach, {
					templateId: 'near-max-district-histogram',
					districtCode: 'D499',
					verifiedAt: Date.now(),
					trustTier: 5
				})
			).resolves.toBeNull();

			await t.run(async (ctx) => {
				const canonical = await ctx.db.get(templateId);
				expect(canonical?.districtCounts).toHaveLength(500);
				expect(canonical?.deliveredDistricts).toHaveLength(500);
				expect(canonical?.uniqueDistricts).toBe(500);

				const compact = await ctx.db
					.query('publicTemplateDiscoverySources')
					.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
					.unique();
				expect(compact).not.toBeNull();
				const source = compact!.source as {
					districtCounts: Array<{ code: string; count: number }>;
					districtCountsSuppressedDistricts: number;
					districtCountsSuppressedCount: number;
				};
				const canonicalMass = canonical!.districtCounts!.reduce(
					(total, row) => total + row.count,
					0
				);
				const retainedMass = source.districtCounts.reduce((total, row) => total + row.count, 0);
				expect(source.districtCounts).toEqual(initialDistrictCounts.slice(-6).reverse());
				expect(source.districtCountsSuppressedDistricts).toBe(494);
				expect(retainedMass + source.districtCountsSuppressedCount).toBe(canonicalMass);
				expect(compact!.sourceBytes).toBe(getConvexSize(compact!.source as Value));
				expect(compact!.sourceBytes).toBeLessThanOrEqual(16_000);
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
