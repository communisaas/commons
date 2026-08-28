/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const VECTOR = Array.from({ length: 768 }, (_, index) => index / 768);
type Harness = TestConvex<typeof schema>;

function templateValue(index: number, topics: string[]) {
	return {
		slug: `source-plane-${index}`,
		title: `Source plane ${index}`,
		description: 'Compact producer fixture',
		domain: 'civic',
		topics,
		type: 'email',
		deliveryMethod: 'email' as const,
		preview: 'Preview',
		messageBody: 'Message',
		deliveryConfig: {},
		recipientConfig: {},
		status: 'published',
		isPublic: true,
		verifiedSends: 10,
		uniqueDistricts: 4,
		endorsementCount: 0,
		locationEmbedding: VECTOR,
		topicEmbedding: VECTOR,
		tagEmbeddings: topics.map((tag) => ({ tag, embedding: VECTOR })),
		embeddingVersion: 'test-v1',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		updatedAt: 1_800_000_000_000 + index
	};
}

async function migrateWithoutScheduler(t: Harness) {
	let state: any = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
		scheduleContinuation: false
	});
	while (state.status === 'running') {
		state = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
			runToken: state.runToken,
			cursor: state.continueCursor,
			startedAt: state.startedAt,
			scanned: state.scanned,
			eligible: state.eligible,
			sourcesWritten: state.sourcesWritten,
			topicVectorsWritten: state.topicVectorsWritten,
			tagVectorsWritten: state.tagVectorsWritten,
			rejected: state.rejected,
			scheduleContinuation: false
		});
	}
	return state;
}

async function migrateEndorsementsWithoutScheduler(t: Harness) {
	let state: any = await t.mutation(internal.templates.migrateEndorsementCounts, {
		restart: true,
		scheduleContinuation: false
	});
	while (state.status === 'running') {
		state = await t.mutation(internal.templates.migrateEndorsementCounts, {
			runToken: state.runToken,
			scheduleContinuation: false
		});
	}
	expect(state.status).toBe('complete');
}

describe('compact public-discovery source plane', () => {
	it('fails closed before activation and caps tag-vector reads before clustering', async () => {
		const t = convexTest({ schema, modules });
		await t.run(async (ctx) => {
			for (let index = 0; index < 2; index += 1) {
				const topics = Array.from(
					{ length: 110 },
					(_, tagIndex) => `topic-${index}-${tagIndex.toString().padStart(3, '0')}`
				);
				await ctx.db.insert('templates', templateValue(index, topics));
			}
		});
		await migrateEndorsementsWithoutScheduler(t);

		await expect(t.mutation(internal.templates.rebuildHomepageSnapshots, {})).rejects.toThrow(
			'PUBLIC_DISCOVERY_SOURCE_PLANE_NOT_READY'
		);

		const migrated = await migrateWithoutScheduler(t);
		expect(migrated).toMatchObject({
			status: 'migrated',
			eligible: 2,
			sourcesWritten: 2,
			rejected: 0
		});
		await expect(t.mutation(internal.templates.rebuildHomepageSnapshots, {})).rejects.toThrow(
			'PUBLIC_DISCOVERY_SOURCE_PLANE_NOT_READY'
		);

		await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});
		const rebuilt = await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
		expect(rebuilt.relations.all).toMatchObject({
			tagVectorCandidateCount: 220,
			tagVectorCount: 220,
			tagVectorShedCount: 0
		});

		const rows = await t.run((ctx) => ctx.db.query('publicTemplateDiscoverySources').collect());
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.sourceBytes).toBeLessThanOrEqual(16_000);
			expect(JSON.stringify(row.source)).not.toContain('Embedding');
		}
	});
});
