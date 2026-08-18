/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import {
	PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION,
	PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
	publicTemplateDetailProjectionBytes,
	type PublicTemplateDetailProjection
} from './lib/publicTemplateDiscoverySource';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'ssr-snapshot-query-secret-32-bytes';

function harness() {
	return convexTest({ schema, modules });
}

function detailReadBudgetHarness() {
	return convexTest({
		schema,
		modules,
		transactionLimits: {
			databaseQueries: 3,
			documentsRead: 3,
			bytesRead: 20_000
		}
	});
}

async function prepareCompactPublicSourcePlane(
	t: ReturnType<typeof harness>,
	options: { activate?: boolean } = {}
) {
	let endorsements: any = await t.mutation(internal.templates.migrateEndorsementCounts, {
		restart: true,
		scheduleContinuation: false
	});
	while (endorsements.status === 'running') {
		endorsements = await t.mutation(internal.templates.migrateEndorsementCounts, {
			runToken: endorsements.runToken,
			scheduleContinuation: false
		});
	}
	expect(endorsements.status).toBe('complete');

	let source: any = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
		scheduleContinuation: false
	});
	while (source.status === 'running') {
		source = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
			runToken: source.runToken,
			cursor: source.continueCursor,
			startedAt: source.startedAt,
			listDirtyAtAtStart: source.listDirtyAtAtStart,
			relationsDirtyAtAtStart: source.relationsDirtyAtAtStart,
			scanned: source.scanned,
			eligible: source.eligible,
			sourcesWritten: source.sourcesWritten,
			topicVectorsWritten: source.topicVectorsWritten,
			tagVectorsWritten: source.tagVectorsWritten,
			rejected: source.rejected,
			scheduleContinuation: false
		});
	}
	expect(source.status).toBe('migrated');
	if (options.activate !== false) {
		await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});
	}
	return source;
}

function templateValue(slug: string, status: string, isPublic: boolean) {
	return {
		slug,
		title: slug,
		description: 'Visibility fixture',
		topics: [],
		type: 'email',
		deliveryMethod: 'email' as const,
		preview: 'Preview',
		messageBody: 'Message',
		deliveryConfig: {},
		recipientConfig: {},
		status,
		isPublic,
		verifiedSends: 0,
		uniqueDistricts: 0,
		embeddingVersion: 'test-v1',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		updatedAt: 1
	};
}

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('SSR-only public discovery query boundary', () => {
	it('fails closed for missing or internally incoherent recipient migration counters', async () => {
		const readyRows = [
			{
				label: 'missing',
				counters: {}
			},
			{
				label: 'incoherent',
				counters: {
					recipientIntentTemplates: 1,
					recipientIntentRecipients: 2,
					recipientProjectedRecipients: 0,
					recipientLossTemplates: 1,
					recipientLossRecipients: 1,
					recipientLossClassifiedTemplates: 1,
					recipientLossClassifiedRecipients: 1
				}
			}
		] as const;

		for (const fixture of readyRows) {
			const t = harness();
			await t.run(async (ctx) => {
				await ctx.db.insert('publicDiscoverySourceMigrations', {
					key: 'v1',
					status: 'ready',
					projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
					runToken: `${fixture.label}-recipient-integrity`,
					startedAt: 1,
					completedAt: 2,
					scanned: 1,
					eligible: 1,
					sourcesWritten: 1,
					topicVectorsWritten: 0,
					tagVectorsWritten: 0,
					rejected: 0,
					...fixture.counters,
					updatedAt: 2
				});
			});
			if (fixture.label === 'missing') {
				await expect(
					t.query(internal.templates.publicDiscoverySourceMigrationStatus, {})
				).resolves.toMatchObject({ recipientIntentTemplates: null });
			}
			await expect(
				t.query(api.templates.getBySlugPublic, {
					_secret: SECRET,
					slug: `${fixture.label}-recipient-integrity`
				})
			).rejects.toThrow('PUBLIC_DISCOVERY_SOURCE_PLANE_NOT_READY');
		}

		const activation = harness();
		await activation.run(async (ctx) => {
			await ctx.db.insert('publicDiscoverySourceMigrations', {
				key: 'v1',
				status: 'migrated',
				projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
				runToken: 'incoherent-activation',
				startedAt: 1,
				completedAt: 2,
				scanned: 1,
				eligible: 1,
				sourcesWritten: 1,
				topicVectorsWritten: 0,
				tagVectorsWritten: 0,
				rejected: 0,
				recipientIntentTemplates: 0,
				recipientIntentRecipients: 1,
				recipientProjectedRecipients: 0,
				recipientLossTemplates: 1,
				recipientLossRecipients: 1,
				recipientLossClassifiedTemplates: 1,
				recipientLossClassifiedRecipients: 1,
				updatedAt: 2
			});
		});
		await expect(
			activation.mutation(internal.templates.activatePublicDiscoverySourcePlane, {})
		).rejects.toThrow('PUBLIC_DISCOVERY_SOURCE_PLANE_MIGRATION_UNSAFE');
	});

	it('scopes the recipient blocker queue to the current completed migration run', async () => {
		const t = harness();
		let currentTemplateId: Id<'templates'> | undefined;
		await t.run(async (ctx) => {
			const staleTemplateId = await ctx.db.insert(
				'templates',
				templateValue('stale-recipient-review', 'draft', false)
			);
			currentTemplateId = await ctx.db.insert(
				'templates',
				templateValue('current-recipient-review', 'published', true)
			);
			await ctx.db.insert('publicDiscoverySourceMigrations', {
				key: 'v1',
				status: 'migrated',
				projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
				runToken: 'current-recipient-run',
				startedAt: 1,
				completedAt: 2,
				scanned: 1,
				eligible: 1,
				sourcesWritten: 1,
				topicVectorsWritten: 0,
				tagVectorsWritten: 0,
				rejected: 0,
				recipientIntentTemplates: 1,
				recipientIntentRecipients: 1,
				recipientProjectedRecipients: 0,
				recipientLossTemplates: 1,
				recipientLossRecipients: 1,
				recipientLossClassifiedTemplates: 0,
				recipientLossClassifiedRecipients: 0,
				updatedAt: 2
			});
			for (const [templateId, runToken, intentHash] of [
				[staleTemplateId, 'superseded-recipient-run', 'a'.repeat(64)],
				[currentTemplateId, 'current-recipient-run', 'b'.repeat(64)]
			] as const) {
				await ctx.db.insert('publicRecipientMigrationReviews', {
					templateId,
					projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
					runToken,
					intentHash,
					intentCount: 1,
					projectedCount: 0,
					disposition: 'pending',
					updatedAt: 2
				});
			}
		});

		const blockers = await t.query(internal.templates.listPublicRecipientMigrationBlockers, {});
		expect(blockers.page).toEqual([
			{
				templateId: currentTemplateId,
				intentHash: 'b'.repeat(64),
				intentCount: 1,
				projectedCount: 0
			}
		]);
	});

	it('denies every direct-origin snapshot query before touching malformed singleton state', async () => {
		const t = harness();
		await t.run(async (ctx) => {
			for (let revision = 1; revision <= 2; revision += 1) {
				await ctx.db.insert('publicDiscoveryManifestAuthority', {
					key: 'public',
					projectionVersion: 1,
					listReady: true,
					listRetiredRevision: revision - 1,
					listRevision: revision,
					listUpdatedAt: revision,
					listWithdrawalEpoch: 0,
					relationsReady: true,
					relationsRetiredRevision: revision - 1,
					relationsRevision: revision,
					relationsUpdatedAt: revision,
					relationsWithdrawalEpoch: 0
				});
				await ctx.db.insert('publicDiscoveryManifest', {
					key: 'public',
					listReady: true,
					relationsReady: true,
					listRevision: revision,
					relationsRevision: revision
				});
				await ctx.db.insert('publicTemplateSnapshots', {
					key: 'all',
					projectionVersion: 4,
					revision,
					templates: [],
					sourceCount: 0,
					updatedAt: revision
				});
				await ctx.db.insert('templateRelationSnapshots', {
					key: 'all',
					revision,
					twinEdges: [],
					conceptEdges: [],
					conceptEntries: [],
					sourceCap: 50,
					sourceTemplateCount: 0,
					embeddedTemplateCount: 0,
					tagVectorCount: 0,
					updatedAt: revision
				});
			}
		});

		const unauthorizedCalls = [
			() => t.query(api.templates.getBySlug, { slug: 'anything' }),
			() => t.query(api.templates.getBySlugPublic, { slug: 'anything' }),
			// The three versioned queries now declare `_secret: v.string()`
			// non-optionally, so the unauthorized call this test exists to prove is
			// refused is no longer expressible in a typed call. Constructing it
			// deliberately is the point: the cast asserts nothing about the runtime,
			// which must still reject every one of these.
			() => t.query(api.templates.publicDiscoveryManifest, {} as never),
			() => t.query(api.templates.listPublic, {} as never),
			() => t.query(api.templates.publicDiscoveryList, {} as never),
			() => t.query(api.templates.relatednessEdges, {}),
			() => t.query(api.templates.conceptRelations, {}),
			() => t.query(api.templates.publicDiscoveryRelations, {} as never)
		];
		for (const call of unauthorizedCalls) {
			// Two refusal shapes, both correct, and the test is about the DENIAL —
			// not which layer produced it. The three versioned discovery queries now
			// declare `_secret: v.string()` non-optionally, so an omitted secret is
			// refused by the ARGUMENT VALIDATOR before the handler runs at all. That
			// is strictly earlier than the handler's `Unauthorized`, which is what
			// this test's own name asks for: denial before any singleton state is
			// touched. The remaining legacy aliases still refuse in-handler.
			await expect(call()).rejects.toThrow(
				/Unauthorized|Missing required field `_secret`/
			);
		}

		// The authorized call reaches the deliberately invalid duplicate range,
		// proving the denial above happened before the first indexed read.
		await expect(
			t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET })
		).rejects.toThrow();
	});

	it('serves authorized SSR reads from only the compact singleton rows', async () => {
		const t = harness();
		await t.run(async (ctx) => {
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				relationsReady: true,
				listRevision: 7,
				relationsRevision: 9,
				listUpdatedAt: 70,
				relationsUpdatedAt: 90
			});
			await ctx.db.insert('publicTemplateSnapshots', {
				key: 'all',
				projectionVersion: 4,
				revision: 7,
				templates: [],
				sourceCount: 0,
				updatedAt: 70
			});
			await ctx.db.insert('templateRelationSnapshots', {
				key: 'all',
				revision: 9,
				twinEdges: [],
				conceptEdges: [],
				conceptEntries: [],
				sourceCap: 50,
				sourceTemplateCount: 0,
				embeddedTemplateCount: 0,
				tagVectorCount: 0,
				updatedAt: 90
			});
		});
		await t.mutation(internal.templates.migratePublicDiscoveryManifestAuthority, {});

		await expect(
			t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET })
		).resolves.toEqual({
			list: {
				ready: true,
				retiredRevision: 6,
				revision: 7,
				updatedAt: 70,
				withdrawalEpoch: 0
			},
			relations: {
				ready: true,
				retiredRevision: 8,
				revision: 9,
				updatedAt: 90,
				withdrawalEpoch: 0
			}
		});
		await expect(t.query(api.templates.listPublic, { _secret: SECRET })).resolves.toEqual([]);
		await expect(
			t.query(api.templates.publicDiscoveryList, { _secret: SECRET })
		).resolves.toMatchObject({ projectionVersion: 4, revision: 7, templates: [] });
		await expect(t.query(api.templates.relatednessEdges, { _secret: SECRET })).resolves.toEqual([]);
		await expect(t.query(api.templates.conceptRelations, { _secret: SECRET })).resolves.toEqual({
			edges: [],
			conceptMap: {}
		});
		await expect(
			t.query(api.templates.publicDiscoveryRelations, { _secret: SECRET })
		).resolves.toMatchObject({ revision: 9, twinEdges: [] });
	});

	it('retires the embedding-heavy legacy list and enforces published-and-public slug visibility', async () => {
		const t = harness();
		await t.run(async (ctx) => {
			await ctx.db.insert('templates', templateValue('published-public', 'published', true));
			await ctx.db.insert('templates', templateValue('published-private', 'published', false));
			await ctx.db.insert('templates', templateValue('draft-public', 'draft', true));
		});
		let migration: any = await t.mutation(internal.templates.migrateTemplateListProjection, {
			scheduleContinuation: false
		});
		while (migration.status === 'running') {
			migration = await t.mutation(internal.templates.migrateTemplateListProjection, {
				runToken: migration.runToken,
				scheduleContinuation: false
			});
		}
		await t.mutation(internal.templates.activateTemplateListProjection, {});
		await prepareCompactPublicSourcePlane(t);

		await expect(t.query(internal.templates.list, {})).rejects.toThrow('TEMPLATES_LIST_RETIRED');
		await expect(
			t.query(api.templates.getBySlug, { _secret: SECRET, slug: 'published-public' })
		).resolves.toMatchObject({ slug: 'published-public' });
		await expect(
			t.query(api.templates.getBySlug, { _secret: SECRET, slug: 'published-private' })
		).resolves.toBeNull();
		await expect(
			t.query(api.templates.getBySlug, { _secret: SECRET, slug: 'draft-public' })
		).resolves.toBeNull();
		await expect(
			t.query(api.templates.getBySlugPublic, {
				_secret: SECRET,
				slug: 'published-private'
			})
		).resolves.toBeNull();
		await expect(
			t.query(api.templates.templateSlugsExist, {
				_secret: SECRET,
				slugs: ['published-private', 'missing-slug']
			})
		).resolves.toEqual([true, false]);
		await expect(
			t.query(api.templates.templateSlugsExist, { slugs: ['published-private'] })
		).rejects.toThrow('Unauthorized');
		for (const slugs of [
			[],
			['a', 'b', 'c', 'd', 'e', 'f', 'g'],
			['duplicate', 'duplicate'],
			['x'.repeat(401)]
		]) {
			await expect(
				t.query(api.templates.templateSlugsExist, { _secret: SECRET, slugs })
			).rejects.toThrow('TEMPLATE_SLUG_BATCH_');
		}
	});

	it('fails closed when a stored public-detail row is poisoned', async () => {
		const t = harness();
		await t.run(async (ctx) => {
			await ctx.db.insert('templates', templateValue('poisoned-detail', 'published', true));
		});
		await prepareCompactPublicSourcePlane(t);
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query('publicTemplateDetailProjections')
				.withIndex('by_slug', (q) => q.eq('slug', 'poisoned-detail'))
				.unique();
			if (!row) throw new Error('missing detail fixture');
			await ctx.db.patch(row._id, {
				detail: {
					...(row.detail as Record<string, unknown>),
					privateProviderToken: 'must-never-cross-the-boundary'
				}
			});
		});

		await expect(
			t.query(api.templates.getBySlugPublic, {
				_secret: SECRET,
				slug: 'poisoned-detail'
			})
		).rejects.toThrow('PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID:unknown-key');
	});

	it('requires a versioned remigration and strips unsigned legacy recipient detail', async () => {
		const t = harness();
		const legacyEmail = 'unsigned-legacy-target@example.test';
		await t.run(async (ctx) => {
			const templateId = await ctx.db.insert('templates', {
				...templateValue('legacy-recipient-detail', 'published', true),
				recipientConfig: {
					emails: [legacyEmail],
					recipients: [legacyEmail],
					decisionMakers: [
						{
							name: 'Legacy target',
							title: 'Director',
							organization: 'Legacy agency',
							email: legacyEmail,
							isAiResolved: true,
							emailGrounded: true,
							emailSource: 'https://legacy.example.test/contact',
							accountabilityOpener: 'Unsigned legacy copy',
							personalPrompt: 'Must not survive migration'
						}
					]
				}
			});
			const legacyDetail = {
				id: templateId,
				slug: 'legacy-recipient-detail',
				title: 'legacy-recipient-detail',
				description: 'Visibility fixture',
				domain: '',
				type: 'email',
				deliveryMethod: 'email' as const,
				subject: 'legacy-recipient-detail',
				message_body: 'Message',
				sources: [],
				research_log: [],
				preview: 'Preview',
				is_public: true,
				verified_sends: null,
				unique_districts: null,
				send_count: null,
				delivery_config: {},
				cwc_config: null,
				recipient_config: {
					emails: [legacyEmail],
					personalPrompt: 'Must not survive migration',
					decisionMakers: [
						{
							name: 'Legacy target',
							email: legacyEmail,
							accountabilityOpener: 'Unsigned legacy copy',
							personalPrompt: 'Must not survive migration'
						}
					]
				},
				recipient_count: 1,
				recipientEmails: [legacyEmail],
				topics: [],
				createdAt: '2026-07-18T00:00:00.000Z'
			};
			await ctx.db.insert('publicTemplateDetailProjections', {
				templateId,
				slug: 'legacy-recipient-detail',
				projectionVersion: PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION - 1,
				detail: legacyDetail,
				detailBytes: 1,
				updatedAt: 1
			});
			await ctx.db.insert('publicDiscoverySourceMigrations', {
				key: 'v1',
				status: 'ready',
				projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION - 1,
				runToken: 'legacy-generation',
				startedAt: 1,
				completedAt: 2,
				scanned: 1,
				eligible: 1,
				sourcesWritten: 1,
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
				updatedAt: 2
			});
		});

		await expect(
			t.query(api.templates.getBySlugPublic, {
				_secret: SECRET,
				slug: 'legacy-recipient-detail'
			})
		).rejects.toThrow('PUBLIC_DISCOVERY_SOURCE_PLANE_NOT_READY');

		const migrated = await prepareCompactPublicSourcePlane(t, { activate: false });
		expect(migrated).toMatchObject({
			recipientIntentTemplates: 1,
			recipientIntentRecipients: 1,
			recipientProjectedRecipients: 0,
			recipientLossTemplates: 1,
			recipientLossRecipients: 1,
			recipientLossClassifiedTemplates: 0,
			recipientLossClassifiedRecipients: 0
		});
		await expect(
			t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {})
		).rejects.toThrow('PUBLIC_DISCOVERY_SOURCE_PLANE_MIGRATION_UNSAFE');
		const blockers = await t.query(internal.templates.listPublicRecipientMigrationBlockers, {});
		expect(blockers.page).toHaveLength(1);
		expect(blockers.page[0]).toMatchObject({
			intentCount: 1,
			projectedCount: 0
		});
		await expect(
			t.mutation(internal.templates.classifyPublicRecipientMigrationRedaction, {
				templateId: blockers.page[0].templateId,
				expectedIntentHash: blockers.page[0].intentHash,
				operatorReference: 'launch-review/legacy-recipient-detail'
			})
		).resolves.toMatchObject({
			status: 'classified',
			lostRecipients: 1,
			requiresRemigration: true
		});
		await prepareCompactPublicSourcePlane(t);
		await expect(
			t.query(internal.templates.publicDiscoverySourceMigrationStatus, {})
		).resolves.toMatchObject({
			status: 'ready',
			recipientLossTemplates: 1,
			recipientLossRecipients: 1,
			recipientLossClassifiedTemplates: 1,
			recipientLossClassifiedRecipients: 1
		});
		const detail = await t.query(api.templates.getBySlugPublic, {
			_secret: SECRET,
			slug: 'legacy-recipient-detail'
		});
		expect(detail).toMatchObject({
			recipient_config: { emails: [] },
			recipientEmails: [],
			recipient_count: 0
		});
		expect(JSON.stringify(detail)).not.toContain(legacyEmail);
		expect(JSON.stringify(detail)).not.toContain('Unsigned legacy copy');
		expect(JSON.stringify(detail)).not.toContain('Must not survive migration');
		const stored = await t.run((ctx) =>
			ctx.db
				.query('publicTemplateDetailProjections')
				.withIndex('by_slug', (q) => q.eq('slug', 'legacy-recipient-detail'))
				.unique()
		);
		expect(stored?.projectionVersion).toBe(PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION);
	});

	it('serves detail from three compact rows without hydrating the canonical template', async () => {
		const t = detailReadBudgetHarness();
		await t.run(async (ctx) => {
			const templateId = await ctx.db.insert('templates', {
				...templateValue('compact-detail-only', 'published', true),
				deliveryConfig: { privateProviderToken: 'x'.repeat(100_000) },
				locationEmbedding: new Array<number>(768).fill(0),
				topicEmbedding: new Array<number>(768).fill(0)
			});
			const detail: PublicTemplateDetailProjection = {
				id: templateId,
				slug: 'compact-detail-only',
				title: 'Compact detail',
				description: 'Purpose-bound projection',
				domain: 'civic',
				type: 'email',
				deliveryMethod: 'email' as const,
				subject: 'Compact detail',
				message_body: 'Message',
				sources: [],
				research_log: [],
				preview: 'Preview',
				is_public: true,
				verified_sends: null,
				unique_districts: null,
				send_count: null,
				delivery_config: {},
				cwc_config: null,
				recipient_config: { emails: [] },
				recipient_count: 0,
				recipientEmails: [],
				topics: [],
				createdAt: '2026-07-18T00:00:00.000Z'
			};
			await ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: false,
				relationsReady: false,
				listRevision: 0,
				relationsRevision: 0
			});
			await ctx.db.insert('publicDiscoverySourceMigrations', {
				key: 'v1',
				status: 'ready',
				projectionVersion: PUBLIC_TEMPLATE_DISCOVERY_SOURCE_VERSION,
				runToken: 'compact-detail-generation',
				startedAt: 1,
				completedAt: 2,
				scanned: 1,
				eligible: 1,
				sourcesWritten: 1,
				pageArtifactCoordinatesWritten: 1,
				topicVectorsWritten: 1,
				tagVectorsWritten: 0,
				rejected: 0,
				recipientIntentTemplates: 0,
				recipientIntentRecipients: 0,
				recipientProjectedRecipients: 0,
				recipientLossTemplates: 0,
				recipientLossRecipients: 0,
				recipientLossClassifiedTemplates: 0,
				recipientLossClassifiedRecipients: 0,
				updatedAt: 2
			});
			await ctx.db.insert('publicTemplateDetailProjections', {
				templateId,
				slug: detail.slug,
				projectionVersion: PUBLIC_TEMPLATE_DETAIL_PROJECTION_VERSION,
				detail,
				detailBytes: publicTemplateDetailProjectionBytes(detail),
				updatedAt: 2
			});
		});

		const result = await t.query(api.templates.getBySlugPublic, {
			_secret: SECRET,
			slug: 'compact-detail-only'
		});
		expect(result).toMatchObject({
			id: expect.any(String),
			slug: 'compact-detail-only',
			title: 'Compact detail',
			author: null
		});
		expect(JSON.stringify(result)).not.toContain('privateProviderToken');
	});
});
