/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import schema from './schema';
import { MAX_TEMPLATE_TOPICS } from './lib/templateInputBudget';
import { MAX_PUBLIC_RELATION_TAG_VECTORS } from './lib/publicTemplateDiscoverySource';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const INTERNAL_SECRET = 'relation-valid-envelope-secret-32-bytes';
const TEMPLATE_COUNT = 50;
const EMBEDDING_DIMENSIONS = 768;

type Harness = TestConvex<typeof schema>;

function tagVector(index: number): number[] {
	const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
	vector[index] = 1;
	return vector;
}

function templateValue(index: number) {
	const firstTag = index * MAX_TEMPLATE_TOPICS;
	const topics = Array.from(
		{ length: MAX_TEMPLATE_TOPICS },
		(_, offset) => `valid-topic-${firstTag + offset}`
	);
	return {
		slug: `relation-valid-envelope-${index}`,
		title: `Relation valid envelope ${index}`,
		description: 'Five distinct accepted topics must not degrade producer readiness.',
		domain: 'civic',
		topics,
		type: 'email',
		deliveryMethod: 'email',
		preview: 'Preview',
		messageBody: 'Message',
		deliveryConfig: {},
		recipientConfig: {},
		status: 'published',
		isPublic: true,
		verifiedSends: 0,
		uniqueDistricts: 0,
		endorsementCount: 0,
		tagEmbeddings: topics.map((tag, offset) => ({
			tag,
			embedding: tagVector(firstTag + offset)
		})),
		embeddingVersion: 'test-v1',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		updatedAt: 1_800_000_000_000 + index
	};
}

async function migrateSourcePlane(t: Harness): Promise<void> {
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
	expect(state).toMatchObject({
		status: 'migrated',
		eligible: TEMPLATE_COUNT,
		sourcesWritten: TEMPLATE_COUNT,
		tagVectorsWritten: TEMPLATE_COUNT * MAX_TEMPLATE_TOPICS,
		rejected: 0
	});
	await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});

	let recipientState: any = await t.mutation(internal.templatePage.migrateRecipientMetrics, {
		scheduleContinuation: false
	});
	while (recipientState.status === 'running') {
		recipientState = await t.mutation(internal.templatePage.migrateRecipientMetrics, {
			runToken: recipientState.runToken,
			scheduleContinuation: false
		});
	}
	if (recipientState.status === 'migrated') {
		await t.mutation(internal.templatePage.activateRecipientMetrics, {});
	} else if (recipientState.status !== 'already-ready') {
		throw new Error(`TEST_RECIPIENT_METRICS_MIGRATION_${recipientState.status}`);
	}
}

describe('maximum valid public relation vocabulary', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', INTERNAL_SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('publishes 50×5 distinct topics without shedding or unhealthy readiness', async () => {
		expect(MAX_PUBLIC_RELATION_TAG_VECTORS).toBe(TEMPLATE_COUNT * MAX_TEMPLATE_TOPICS);
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: false,
				relationsReady: false,
				listRevision: 0,
				relationsRevision: 0,
				endorsementCountMigrationStatus: 'complete',
				endorsementCountMigrationStartedAt: now,
				endorsementCountMigrationCompletedAt: now,
				endorsementCountMigrationScannedTemplates: TEMPLATE_COUNT,
				endorsementCountMigrationRepairedTemplates: 0,
				endorsementCountMigrationEndorsementsCounted: 0
			});
			await ctx.db.insert('templateListProjectionMigrations', {
				key: 'v1',
				status: 'ready',
				runToken: 'relation-valid-envelope-list',
				startedAt: now,
				completedAt: now,
				scanned: TEMPLATE_COUNT,
				projected: TEMPLATE_COUNT,
				updatedAt: now
			});
			for (let index = 0; index < TEMPLATE_COUNT; index += 1) {
				await ctx.db.insert('templates', templateValue(index));
			}
		});

		await migrateSourcePlane(t);
		const rebuilt = await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
		for (const variant of [rebuilt.relations.all, rebuilt.relations.excludeCwc]) {
			expect(variant).toMatchObject({
				sourceTemplateCount: TEMPLATE_COUNT,
				tagVectorCandidateCount: TEMPLATE_COUNT * MAX_TEMPLATE_TOPICS,
				tagVectorCount: TEMPLATE_COUNT * MAX_TEMPLATE_TOPICS,
				tagVectorShedCount: 0,
				conceptEdgeShedCount: 0,
				conceptEntryShedCount: 0
			});
		}

		await expect(t.query(internal.templates.publicDiscoveryFailureStatus, {})).resolves.toEqual({
			list: null,
			relations: null
		});
		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: INTERNAL_SECRET })
		).resolves.toMatchObject({
			discoveryProducerHealthy: true,
			discoveryProducerOverdueAt: null
		});
		await expect(
			t.query(api.templates.publicDiscoveryRelations, {
				_secret: INTERNAL_SECRET,
				excludeCwc: false
			})
		).resolves.toMatchObject({ revision: 1 });
	});
});
