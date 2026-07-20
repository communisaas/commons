/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION } from './lib/publicTemplateDiscoverySource';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'endorsement-count-test-secret-32-bytes';
const VECTOR = Array.from({ length: 768 }, (_, index) => index / 768);

type Harness = TestConvex<typeof schema>;

function newHarness(): Harness {
	return convexTest(schema, modules);
}

function templateValue(index: number, overrides: Record<string, unknown> = {}) {
	return {
		slug: `endorsement-count-${index}`,
		title: `Endorsement count ${index}`,
		description: 'Authoritative endorsement counter fixture',
		domain: 'civic',
		topics: [],
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
		embeddingVersion: 'test-v1',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		updatedAt: 1_800_000_000_000 + index,
		...overrides
	};
}

async function insertUser(t: Harness, suffix: string) {
	const tokenIdentifier = `https://issuer.example|endorsement-${suffix}`;
	const userId = await t.run((ctx) =>
		ctx.db.insert('users', {
			tokenIdentifier,
			updatedAt: Date.now(),
			isVerified: true,
			authorityLevel: 1,
			trustTier: 1,
			trustScore: 100,
			reputationTier: 'novice',
			districtVerified: false,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 0,
			profileVisibility: 'private'
		})
	);
	return {
		userId,
		authenticated: t.withIdentity({
			subject: `endorsement-${suffix}`,
			issuer: 'https://issuer.example',
			tokenIdentifier
		})
	};
}

async function insertOrg(t: Harness, suffix: string): Promise<Id<'organizations'>> {
	return await t.run((ctx) =>
		ctx.db.insert('organizations', {
			name: `Endorsement Org ${suffix}`,
			slug: `endorsement-org-${suffix}`,
			maxSeats: 10,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: true,
			updatedAt: Date.now()
		})
	);
}

async function insertReadySourceGeneration(t: Harness, runToken: string): Promise<void> {
	await t.run(async (ctx) => {
		await ctx.db.insert('publicDiscoverySourceMigrations', {
			key: 'v1',
			status: 'ready',
			projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
			runToken,
			startedAt: Date.now(),
			completedAt: Date.now(),
			scanned: 0,
			eligible: 0,
			sourcesWritten: 0,
			topicVectorsWritten: 0,
			tagVectorsWritten: 0,
			rejected: 0,
			recipientIntentTemplates: 0,
			recipientIntentRecipients: 0,
			recipientProjectedRecipients: 0,
			recipientLossTemplates: 0,
			recipientLossRecipients: 0,
			recipientLossClassifiedTemplates: 0,
			recipientLossClassifiedRecipients: 0,
			updatedAt: Date.now()
		});
	});
}

describe('authoritative template endorsement counters', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('initializes new templates and their compact source at zero', async () => {
		const t = newHarness();
		const { userId, authenticated } = await insertUser(t, 'creator');

		const created = await authenticated.mutation(api.templates.createTemplate, {
			_secret: SECRET,
			userId,
			title: 'New counter',
			slug: 'new-counter',
			description: 'Fixture',
			messageBody: 'Body',
			preview: 'Preview',
			type: 'email',
			deliveryMethod: 'email',
			domain: 'civic',
			topics: [],
			contentHash: 'new-counter-content',
			status: 'published',
			isPublic: true,
			consensusApproved: true
		});

		expect(created?.endorsementCount).toBe(0);
		const source = await t.run((ctx) =>
			ctx.db
				.query('publicTemplateDiscoverySources')
				.withIndex('by_templateId', (q) => q.eq('templateId', created!._id))
				.unique()
		);
		expect(source?.source).toMatchObject({ endorsementCount: 0 });
	});

	it('repairs legacy totals exactly on endorse, idempotent endorse, and remove', async () => {
		const t = newHarness();
		await insertReadySourceGeneration(t, 'endorsement-writer-generation');
		const { userId, authenticated } = await insertUser(t, 'editor');
		const editorOrgId = await insertOrg(t, 'editor');
		await t.run((ctx) =>
			ctx.db.insert('orgMemberships', {
				userId,
				orgId: editorOrgId,
				role: 'editor',
				joinedAt: Date.now()
			})
		);
		const vectorIdentity = await t.run(async (ctx) => {
			const templateId = await ctx.db.insert(
				'templates',
				templateValue(1, {
					topics: ['accountability'],
					topicEmbedding: VECTOR,
					tagEmbeddings: [{ tag: 'accountability', embedding: VECTOR }]
				})
			);
			const topicId = await ctx.db.insert('publicTemplateTopicVectors', {
				templateId,
				generation: 'endorsement-writer-generation',
				embedding: VECTOR,
				embeddingVersion: 'test-v1',
				updatedAt: 101
			});
			const tagId = await ctx.db.insert('publicTagEmbeddingVectors', {
				tag: 'accountability',
				embedding: VECTOR,
				embeddingVersion: 'test-v1',
				updatedAt: 202
			});
			return { templateId, topicId, tagId };
		});
		const { templateId } = vectorIdentity;
		for (let index = 0; index < 8; index += 1) {
			const orgId = await insertOrg(t, `legacy-${index}`);
			await t.run((ctx) =>
				ctx.db.insert('templateEndorsements', {
					templateId,
					orgId,
					endorsedAt: Date.now() + index
				})
			);
		}

		await authenticated.mutation(api.templates.endorse, {
			orgSlug: 'endorsement-org-editor',
			templateId
		});
		await expect(t.run((ctx) => ctx.db.get(templateId))).resolves.toMatchObject({
			endorsementCount: 9
		});

		// An idempotent repeat still audits a legacy/invalid counter before returning.
		await t.run((ctx) => ctx.db.patch(templateId, { endorsementCount: undefined }));
		await authenticated.mutation(api.templates.endorse, {
			orgSlug: 'endorsement-org-editor',
			templateId
		});
		await expect(t.run((ctx) => ctx.db.get(templateId))).resolves.toMatchObject({
			endorsementCount: 9
		});

		await authenticated.mutation(api.templates.removeEndorsement, {
			orgSlug: 'endorsement-org-editor',
			templateId
		});
		await expect(t.run((ctx) => ctx.db.get(templateId))).resolves.toMatchObject({
			endorsementCount: 8
		});

		// A no-op remove also repairs an unknown total instead of preserving drift.
		await t.run((ctx) => ctx.db.patch(templateId, { endorsementCount: undefined }));
		await authenticated.mutation(api.templates.removeEndorsement, {
			orgSlug: 'endorsement-org-editor',
			templateId
		});
		await expect(t.run((ctx) => ctx.db.get(templateId))).resolves.toMatchObject({
			endorsementCount: 8
		});
		const source = await t.run((ctx) =>
			ctx.db
				.query('publicTemplateDiscoverySources')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.unique()
		);
		expect(source?.source).toMatchObject({ endorsementCount: 8 });
		const vectors = await t.run(async (ctx) => ({
			topic: await ctx.db.get(vectorIdentity.topicId),
			tag: await ctx.db.get(vectorIdentity.tagId)
		}));
		expect(vectors.topic).toMatchObject({
			_id: vectorIdentity.topicId,
			updatedAt: 101
		});
		expect(vectors.tag).toMatchObject({ _id: vectorIdentity.tagId, updatedAt: 202 });
	});

	it('reconciles one whole template per transaction and repairs defined drift', async () => {
		const t = newHarness();
		await insertReadySourceGeneration(t, 'endorsement-migration-generation');
		const templateIds = await t.run(async (ctx) => {
			const first = await ctx.db.insert('templates', templateValue(10));
			const second = await ctx.db.insert('templates', templateValue(11, { endorsementCount: 1 }));
			const orgId = await ctx.db.insert('organizations', {
				name: 'Migration Endorser',
				slug: 'migration-endorser',
				maxSeats: 1,
				maxTemplatesMonth: 1,
				dmCacheTtlDays: 7,
				countryCode: 'US',
				isPublic: true,
				updatedAt: Date.now()
			});
			for (let index = 0; index < 3; index += 1) {
				await ctx.db.insert('templateEndorsements', {
					templateId: first,
					orgId,
					endorsedAt: index
				});
			}
			for (let index = 0; index < 4; index += 1) {
				await ctx.db.insert('templateEndorsements', {
					templateId: second,
					orgId,
					endorsedAt: index
				});
			}
			return [first, second] as const;
		});

		let state = await t.mutation(internal.templates.migrateEndorsementCounts, {
			scheduleContinuation: false
		});
		expect(state).toMatchObject({ status: 'running', scannedTemplates: 1 });
		while (state.status === 'running') {
			state = await t.mutation(internal.templates.migrateEndorsementCounts, {
				runToken: state.runToken,
				scheduleContinuation: false
			});
		}
		expect(state).toMatchObject({
			status: 'complete',
			scannedTemplates: 2,
			repairedTemplates: 2,
			endorsementsCounted: 7
		});

		await expect(t.run((ctx) => ctx.db.get(templateIds[0]))).resolves.toMatchObject({
			endorsementCount: 3
		});
		await expect(t.run((ctx) => ctx.db.get(templateIds[1]))).resolves.toMatchObject({
			endorsementCount: 4
		});
		await expect(
			t.query(internal.templates.endorsementCountMigrationStatus, {})
		).resolves.toMatchObject({
			status: 'complete',
			scannedTemplates: 2,
			repairedTemplates: 2,
			endorsementsCounted: 7,
			missingCounterTemplateId: null
		});

		const sources = await t.run((ctx) => ctx.db.query('publicTemplateDiscoverySources').collect());
		expect(
			sources.map((row) => (row.source as { endorsementCount?: number }).endorsementCount).sort()
		).toEqual([3, 4]);
	});

	it('rotates the run token on resume and supersedes delayed continuations', async () => {
		const t = newHarness();
		await t.run(async (ctx) => {
			for (let index = 0; index < 3; index += 1) {
				await ctx.db.insert('templates', templateValue(100 + index));
			}
		});

		const first = await t.mutation(internal.templates.migrateEndorsementCounts, {
			scheduleContinuation: false
		});
		expect(first).toMatchObject({ status: 'running', scannedTemplates: 1 });
		if (first.status !== 'running') throw new Error('expected a resumable migration');

		const resumed = await t.mutation(internal.templates.migrateEndorsementCounts, {
			resume: true,
			scheduleContinuation: false
		});
		expect(resumed).toMatchObject({ status: 'running', scannedTemplates: 2 });
		if (resumed.status !== 'running') throw new Error('expected the resumed migration to continue');
		expect(resumed.runToken).not.toBe(first.runToken);

		await expect(
			t.mutation(internal.templates.migrateEndorsementCounts, {
				runToken: first.runToken,
				scheduleContinuation: false
			})
		).resolves.toMatchObject({ status: 'superseded', runToken: first.runToken });
		await expect(
			t.mutation(internal.templates.migrateEndorsementCounts, {
				runToken: resumed.runToken,
				scheduleContinuation: false
			})
		).resolves.toMatchObject({ status: 'complete', scannedTemplates: 3 });
	});

	it('refuses to publish a bounded endorsement sample as an unknown total', async () => {
		const t = newHarness();
		await expect(
			t.mutation(internal.templates.migrateEndorsementCounts, {
				scheduleContinuation: false
			})
		).resolves.toMatchObject({ status: 'complete', scannedTemplates: 0 });
		await t.run((ctx) => ctx.db.insert('templates', templateValue(20)));
		const migrated = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
			scheduleContinuation: false
		});
		expect(migrated.status).toBe('migrated');
		await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});

		await expect(t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {})).rejects.toThrow(
			'endorsement-count-not-materialized'
		);
	});

	it('retains last-good snapshots until plausible legacy counters are reconciled', async () => {
		const t = newHarness();
		await t.run(async (ctx) => {
			await ctx.db.insert('templates', templateValue(30, { endorsementCount: 0 }));
			await ctx.db.insert('templates', templateValue(31, { endorsementCount: 77 }));
		});
		await expect(
			t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
				scheduleContinuation: false
			})
		).resolves.toMatchObject({ status: 'migrated' });
		await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});

		const migration = await t.mutation(internal.templates.migrateEndorsementCounts, {
			scheduleContinuation: false
		});
		expect(migration).toMatchObject({ status: 'running', scannedTemplates: 1 });

		const snapshotId = await t.run((ctx) =>
			ctx.db.insert('publicTemplateSnapshots', {
				key: 'all',
				projectionVersion: 4,
				revision: 7,
				templates: [{ sentinel: 'last-good' }],
				sourceCount: 1,
				updatedAt: 1_700_000_000_000
			})
		);

		await expect(t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {})).rejects.toThrow(
			'PUBLIC_TEMPLATE_SNAPSHOT_INVALID:endorsement-count-migration-running'
		);
		await expect(t.run((ctx) => ctx.db.get(snapshotId))).resolves.toMatchObject({
			revision: 7,
			templates: [{ sentinel: 'last-good' }]
		});
	});
});
