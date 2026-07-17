/// <reference types="vite/client" />

import { describe, expect, it, vi } from 'vitest';
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

function storedPublicCard(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		slug: id,
		title: `Title ${id}`,
		description: `Description ${id}`,
		domain: 'civic',
		topics: [],
		type: 'email',
		deliveryMethod: 'email',
		subject: `Title ${id}`,
		message_body: 'Body',
		preview: 'Preview',
		endorsingOrg: null,
		endorsingOrgs: [],
		endorsementCount: 0,
		coordinationScale: 0,
		isNew: false,
		hasActiveDebate: false,
		verified_sends: null,
		unique_districts: null,
		send_count: null,
		daily_arrivals: [],
		district_counts: [],
		tier_counts: [],
		delivery_config: {},
		cwc_config: null,
		recipient_config: null,
		recipient_count: 0,
		campaign_id: null,
		status: 'published',
		is_public: true,
		jurisdictions: [],
		scope: null,
		scopes: [],
		recipientEmails: [],
		createdAt: '2026-07-17T00:00:00.000Z',
		...overrides
	};
}

function embedding(head: number[]): number[] {
	return [...head, ...new Array<number>(768 - head.length).fill(0)];
}

const PUBLIC_CREATE_SECRET = 'public-create-discovery-secret-32-bytes';

async function createPublicTemplate(t: Harness, index: number): Promise<Id<'templates'>> {
	const tokenIdentifier = `https://issuer.example|occ-creator-${index}`;
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
	const authenticated = t.withIdentity({
		subject: `occ-creator-${index}`,
		issuer: 'https://issuer.example',
		tokenIdentifier
	});
	const created = await authenticated.mutation(api.templates.createTemplate, {
		_secret: PUBLIC_CREATE_SECRET,
		userId,
		title: `OCC publication ${index}`,
		slug: `occ-publication-${index}`,
		description: 'Serializable flush ordering fixture',
		messageBody: 'Body',
		preview: 'Preview',
		type: 'email',
		deliveryMethod: 'email',
		domain: 'civic',
		topics: [],
		contentHash: `occ-publication-${index}`,
		status: 'published',
		isPublic: true,
		consensusApproved: true
	});
	return created!._id;
}

describe('templates materialized public snapshots', () => {
	it('publishes explicit ready revisions atomically and distinguishes a valid empty corpus from cold start', async () => {
		const t = newHarness();

		expect(await t.query(api.templates.publicDiscoveryManifest, {})).toEqual({
			list: { ready: false, revision: 0, updatedAt: null },
			relations: { ready: false, revision: 0, updatedAt: null }
		});
		expect(await t.query(api.templates.publicDiscoveryList, {})).toEqual({
			projectionVersion: 0,
			revision: 0,
			updatedAt: null,
			templates: []
		});
		expect(await t.query(api.templates.publicDiscoveryRelations, {})).toEqual({
			revision: 0,
			updatedAt: null,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});

		await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
		const afterList = await t.query(api.templates.publicDiscoveryManifest, {});
		expect(afterList.list).toMatchObject({ ready: true, revision: 1 });
		expect(afterList.relations).toEqual({ ready: false, revision: 0, updatedAt: null });
		expect(await t.query(api.templates.publicDiscoveryList, {})).toMatchObject({
			projectionVersion: 4,
			revision: 1,
			templates: []
		});

		await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		const afterRelations = await t.query(api.templates.publicDiscoveryManifest, {});
		expect(afterRelations.relations).toMatchObject({ ready: true, revision: 1 });
		expect(await t.query(api.templates.publicDiscoveryRelations, {})).toMatchObject({
			revision: 1,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});

		// A non-empty source corpus with no safe card must not replace the healthy
		// empty generation or advance either family.
		await t.run(async (ctx) => {
			for (let index = 0; index < 50; index++) {
				await ctx.db.insert(
					'templates',
					templateValue(5_000 + index, { messageBody: 'x'.repeat(22_000) })
				);
			}
		});
		await expect(t.mutation(internal.templates.rebuildHomepageSnapshots, {})).rejects.toThrow(
			/PUBLIC_TEMPLATE_SNAPSHOT_NO_VALID_CARDS:/
		);
		expect(await t.query(api.templates.publicDiscoveryManifest, {})).toEqual(afterRelations);
		expect(await t.query(api.templates.listPublic, {})).toEqual([]);

		// Even if a legacy/manual row edit creates a mismatch, the payload exposes
		// its own revision so the edge can reject it against manifest revision 1.
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query('publicTemplateSnapshots')
				.withIndex('by_key', (q) => q.eq('key', 'all'))
				.unique();
			if (!row) throw new Error('missing list snapshot');
			await ctx.db.patch(row._id, { revision: 999 });
		});
		expect(await t.query(api.templates.publicDiscoveryList, {})).toMatchObject({
			revision: 999,
			templates: []
		});

		await t.run(async (ctx) => {
			const row = await ctx.db
				.query('templateRelationSnapshots')
				.withIndex('by_key', (q) => q.eq('key', 'all'))
				.unique();
			if (!row) throw new Error('missing relation snapshot');
			await ctx.db.patch(row._id, { revision: 999 });
		});
		expect(await t.query(api.templates.publicDiscoveryRelations, {})).toMatchObject({
			revision: 999,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});
	});

	it('fails loudly when any exact-key discovery singleton has duplicate rows', async () => {
		const t = newHarness();
		await t.run(async (ctx) => {
			for (const revision of [1, 2]) {
				await ctx.db.insert('publicTemplateSnapshots', {
					key: 'all',
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
				await ctx.db.insert('publicDiscoveryManifest', {
					key: 'public',
					listReady: true,
					listRevision: revision,
					listUpdatedAt: revision,
					relationsReady: true,
					relationsRevision: revision,
					relationsUpdatedAt: revision
				});
			}
		});

		await expect(t.query(api.templates.listPublic, {})).rejects.toThrow();
		await expect(t.query(api.templates.publicDiscoveryList, {})).rejects.toThrow();
		await expect(t.query(api.templates.relatednessEdges, {})).rejects.toThrow();
		await expect(t.query(api.templates.conceptRelations, {})).rejects.toThrow();
		await expect(t.query(api.templates.publicDiscoveryRelations, {})).rejects.toThrow();
		await expect(t.query(api.templates.publicDiscoveryManifest, {})).rejects.toThrow();
		await expect(t.query(internal.templates.publicDiscoveryFailureStatus, {})).rejects.toThrow();
		await expect(
			t.mutation(internal.templates.requestPublicTemplateSnapshotRefresh, {})
		).rejects.toThrow();
		await t.run(async (ctx) => {
			const manifests = await ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.collect();
			if (!manifests[1]) throw new Error('missing duplicate manifest fixture');
			await ctx.db.delete(manifests[1]._id);
		});
		await expect(
			t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {})
		).rejects.toThrow();
		await expect(t.mutation(internal.templates.rebuildRelationSnapshot, {})).rejects.toThrow();
	});

	it('projects stored rows through a strict allowlist and redacts legacy recipient data', async () => {
		const t = newHarness();
		const sensitiveEmail = 'legacy-private-target@example.test';
		const publicOrg = { name: 'Public org', slug: 'public-org', avatar: null };
		const publicScope = {
			id: 'newer_s0',
			template_id: 'newer',
			country_code: 'CA',
			region_code: null,
			locality_code: null,
			district_code: null,
			display_text: 'Canada',
			scope_level: 'country',
			confidence: 1,
			extraction_method: 'fixture'
		};
		const newer = storedPublicCard('newer', {
			title: 'Newer',
			subject: 'Newer',
			endorsingOrg: publicOrg,
			scopes: [publicScope],
			recipient_count: 2
		});
		const legacyNewer: Record<string, unknown> = { ...newer };
		delete legacyNewer.recipient_count;
		const storedNewer = {
			...legacyNewer,
			recipient_config: {
				recipients: [{ email: sensitiveEmail }],
				decisionMakers: [{ name: 'Private target' }, { name: 'Private target 2' }]
			},
			recipientEmails: [sensitiveEmail],
			endorsingOrg: {
				...publicOrg,
				encryptedBillingEmail: 'producer-private-fixture'
			},
			scopes: [
				{
					...publicScope,
					internalBoundarySource: 'producer-private-fixture'
				}
			],
			topicEmbedding: [0.1, 0.2],
			moderationNotes: 'producer-only fixture'
		};
		const { title: _missingTitle, ...missingDisplaySpine } =
			storedPublicCard('missing-display-spine');
		const newerTwin = { a: 'newer-a', b: 'newer-b', score: 0.9, kind: 'twin' as const };
		await t.run(async (ctx) => {
			await ctx.db.insert('publicTemplateSnapshots', {
				key: 'all',
				revision: 1,
				templates: [
					storedNewer,
					'malformed-producer-row',
					{ ...storedPublicCard('malformed-allowed-field'), deliveryMethod: 42 },
					missingDisplaySpine
				],
				sourceCount: 2,
				updatedAt: 1
			});
			await ctx.db.insert('templateRelationSnapshots', {
				key: 'all',
				revision: 1,
				twinEdges: [newerTwin],
				conceptEdges: [],
				conceptEntries: [],
				sourceCap: 50,
				sourceTemplateCount: 2,
				embeddedTemplateCount: 2,
				tagVectorCount: 0,
				updatedAt: 1
			});
		});

		const storedProjectionError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const publicList = await t.query(api.templates.listPublic, {});
		expect(publicList).toEqual([newer]);
		await expect(t.query(api.templates.publicDiscoveryList, {})).resolves.toEqual({
			projectionVersion: 0,
			revision: 1,
			updatedAt: 1,
			templates: [newer]
		});
		expect(JSON.stringify(publicList)).not.toContain(sensitiveEmail);
		expect(storedProjectionError).toHaveBeenCalledTimes(2);
		expect(storedProjectionError).toHaveBeenNthCalledWith(
			1,
			'[public-discovery] PUBLIC_TEMPLATE_SNAPSHOT_STORED_INVALID:key=all:revision=1:dropped=3:stored=4'
		);
		expect(storedProjectionError).toHaveBeenNthCalledWith(
			2,
			'[public-discovery] PUBLIC_TEMPLATE_SNAPSHOT_STORED_INVALID:key=all:revision=1:dropped=3:stored=4'
		);
		storedProjectionError.mockRestore();
		await expect(t.query(api.templates.publicDiscoveryRelations, {})).resolves.toMatchObject({
			revision: 1,
			updatedAt: 1,
			twinEdges: [newerTwin]
		});
	});

	it('redacts discovery recipients while preserving the uncached detail/send roster', async () => {
		const t = newHarness();
		const targetEmail = 'public-action-target@example.test';
		await t.run((ctx) =>
			ctx.db.insert(
				'templates',
				templateValue(9_000, {
					recipientConfig: {
						emails: [targetEmail],
						decisionMakers: [{ name: 'Target one', email: targetEmail }, { name: 'Target two' }]
					}
				})
			)
		);

		await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
		const [listCard] = await t.query(api.templates.listPublic, {});
		const detail = await t.query(api.templates.getBySlugPublic, { slug: 'template-9000' });

		expect(listCard).toMatchObject({
			recipient_config: null,
			recipientEmails: [],
			recipient_count: 2
		});
		expect(detail).toMatchObject({
			recipient_config: {
				emails: [targetEmail],
				decisionMakers: [{ name: 'Target one', email: targetEmail }, { name: 'Target two' }]
			},
			recipientEmails: [targetEmail],
			recipient_count: 2
		});
		expect(JSON.stringify(listCard)).not.toContain(targetEmail);
	});

	it('coalesces dirty writes for 60 seconds and enforces six hours between scheduled list rebuilds', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		try {
			const t = newHarness();
			const firstDirtyAt = Date.now();
			const first = await t.mutation(internal.templates.requestPublicTemplateSnapshotRefresh, {});
			vi.advanceTimersByTime(1_000);
			const duplicate = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			expect(first.scheduled).toBe(true);
			expect(duplicate).toEqual({ scheduled: false, scheduledAt: first.scheduledAt });
			const coalescedRow = await t.run(async (ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			// The duplicate did not patch the singleton's dirty timestamp.
			expect(coalescedRow?.listDirtyAt).toBe(firstDirtyAt);

			vi.advanceTimersByTime(58_999);
			expect((await t.query(api.templates.publicDiscoveryManifest, {})).list.revision).toBe(0);
			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();
			const firstPublish = await t.query(api.templates.publicDiscoveryManifest, {});
			expect(firstPublish.list).toMatchObject({ ready: true, revision: 1 });

			const next = await t.mutation(internal.templates.requestPublicTemplateSnapshotRefresh, {});
			const nextDuplicate = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			expect(next.scheduled).toBe(true);
			expect(nextDuplicate).toEqual({ scheduled: false, scheduledAt: next.scheduledAt });
			expect(next.scheduledAt).toBe(firstPublish.list.updatedAt! + 6 * 60 * 60 * 1000);

			vi.advanceTimersByTime(6 * 60 * 60 * 1000 - 1);
			expect((await t.query(api.templates.publicDiscoveryManifest, {})).list.revision).toBe(1);
			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();
			expect((await t.query(api.templates.publicDiscoveryManifest, {})).list).toMatchObject({
				ready: true,
				revision: 2
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('preserves a publication across both serializable OCC orders around a list flush', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		vi.stubEnv('INTERNAL_API_SECRET', PUBLIC_CREATE_SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
		try {
			// Writer serializes first: it reuses the already-dirty token without a
			// manifest patch, and the following range-read flush must include it.
			const writerFirst = newHarness();
			const writerFirstToken = await writerFirst.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			vi.advanceTimersByTime(59_999);
			const writerFirstId = await createPublicTemplate(writerFirst, 1);
			vi.advanceTimersByTime(1);
			await writerFirst.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
				scheduledAt: writerFirstToken.scheduledAt
			});
			expect((await writerFirst.query(api.templates.listPublic, {})).map(({ id }) => id)).toContain(
				writerFirstId
			);

			// Flush serializes first: a later source+dirty commit owns the next cost
			// window rather than being cleared by the completed generation.
			const flushFirst = newHarness();
			const flushFirstToken = await flushFirst.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			vi.advanceTimersByTime(60_000);
			await flushFirst.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
				scheduledAt: flushFirstToken.scheduledAt
			});
			const flushFirstId = await createPublicTemplate(flushFirst, 2);
			const pending = await flushFirst.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(pending).toMatchObject({
				listDirtyAt: expect.any(Number),
				listRefreshScheduledAt: expect.any(Number)
			});
			expect(await flushFirst.query(api.templates.listPublic, {})).toEqual([]);

			vi.setSystemTime(pending!.listRefreshScheduledAt!);
			await flushFirst.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
				scheduledAt: pending!.listRefreshScheduledAt!
			});
			expect((await flushFirst.query(api.templates.listPublic, {})).map(({ id }) => id)).toContain(
				flushFirstId
			);

			// Exact boundary: `scheduledAt === now` is eligible, so a writer must
			// replace the elapsed token and patch the manifest. The old flush is then
			// superseded rather than being able to clear the writer's generation.
			vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
			const boundary = newHarness();
			const elapsedToken = await boundary.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			vi.setSystemTime(elapsedToken.scheduledAt);
			const boundaryId = await createPublicTemplate(boundary, 3);
			const successor = await boundary.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(successor).toMatchObject({
				listDirtyAt: elapsedToken.scheduledAt,
				listRefreshScheduledAt: expect.any(Number)
			});
			expect(successor!.listRefreshScheduledAt!).toBeGreaterThan(elapsedToken.scheduledAt);
			await expect(
				boundary.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
					scheduledAt: elapsedToken.scheduledAt
				})
			).resolves.toEqual({ status: 'superseded' });

			vi.setSystemTime(successor!.listRefreshScheduledAt!);
			await boundary.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
				scheduledAt: successor!.listRefreshScheduledAt!
			});
			expect((await boundary.query(api.templates.listPublic, {})).map(({ id }) => id)).toContain(
				boundaryId
			);
		} finally {
			vi.unstubAllEnvs();
			vi.useRealTimers();
		}
	});

	it('coalesces relation writes, defers them for six hours, and clears dirty state only after publication', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		try {
			const t = newHarness();
			const firstDirtyAt = Date.now();
			const first = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			vi.advanceTimersByTime(1_000);
			const duplicate = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			expect(first.scheduled).toBe(true);
			expect(duplicate).toEqual({ scheduled: false, scheduledAt: first.scheduledAt });

			const coalescedRow = await t.run(async (ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(coalescedRow?.relationsDirtyAt).toBe(firstDirtyAt);
			expect(coalescedRow?.relationsRefreshScheduledAt).toBe(first.scheduledAt);

			vi.advanceTimersByTime(58_999);
			expect((await t.query(api.templates.publicDiscoveryManifest, {})).relations.revision).toBe(0);
			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();

			const firstPublish = await t.query(api.templates.publicDiscoveryManifest, {});
			expect(firstPublish.relations).toMatchObject({ ready: true, revision: 1 });
			const cleanRow = await t.run(async (ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(cleanRow?.relationsDirtyAt).toBeUndefined();
			expect(cleanRow?.relationsRefreshScheduledAt).toBeUndefined();

			const next = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			const nextDuplicate = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			expect(next.scheduled).toBe(true);
			expect(nextDuplicate).toEqual({ scheduled: false, scheduledAt: next.scheduledAt });
			expect(next.scheduledAt).toBe(firstPublish.relations.updatedAt! + 6 * 60 * 60 * 1000);

			vi.advanceTimersByTime(6 * 60 * 60 * 1000 - 1);
			expect((await t.query(api.templates.publicDiscoveryManifest, {})).relations.revision).toBe(1);
			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();
			expect((await t.query(api.templates.publicDiscoveryManifest, {})).relations).toMatchObject({
				ready: true,
				revision: 2
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('dirties relations for topic and tag-embedding writes while reusing one relation token', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		try {
			const t = newHarness();
			const tokenIdentifier = 'https://issuer.example|topic-editor';
			const { templateId } = await t.run(async (ctx) => {
				const userId = await ctx.db.insert('users', {
					tokenIdentifier,
					updatedAt: Date.now(),
					isVerified: true,
					authorityLevel: 1,
					trustTier: 1,
					trustScore: 0,
					reputationTier: 'novice',
					districtVerified: false,
					templatesContributed: 0,
					templateAdoptionRate: 0,
					peerEndorsements: 0,
					activeMonths: 0,
					profileVisibility: 'private'
				});
				const templateId = await ctx.db.insert(
					'templates',
					templateValue(3_200, { userId, topics: [] })
				);
				return { templateId };
			});
			const authenticated = t.withIdentity({
				subject: 'topic-editor',
				issuer: 'https://issuer.example',
				tokenIdentifier
			});

			await authenticated.mutation(api.templates.patchMetadata, {
				templateId,
				topics: ['public libraries']
			});
			const afterTopics = await t.run(async (ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(afterTopics?.listDirtyAt).toEqual(expect.any(Number));
			expect(afterTopics?.relationsDirtyAt).toEqual(expect.any(Number));
			expect(afterTopics?.relationsRefreshScheduledAt).toEqual(expect.any(Number));

			vi.advanceTimersByTime(1_000);
			await t.mutation(internal.templates.patchTagEmbeddings, {
				templateId,
				tagEmbeddings: [{ tag: 'public libraries', embedding: embedding([1, 0]) }]
			});
			const afterTagEmbedding = await t.run(async (ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(afterTagEmbedding?.relationsDirtyAt).toBe(afterTopics?.relationsDirtyAt);
			expect(afterTagEmbedding?.relationsRefreshScheduledAt).toBe(
				afterTopics?.relationsRefreshScheduledAt
			);
			expect(await t.run((ctx) => ctx.db.get(templateId))).toMatchObject({
				topics: ['public libraries'],
				tagEmbeddings: [{ tag: 'public libraries', embedding: embedding([1, 0]) }]
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('dirties both snapshot families when a public template is created before embeddings exist', async () => {
		const secret = 'public-create-discovery-secret-32-bytes';
		vi.stubEnv('INTERNAL_API_SECRET', secret);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
		try {
			const t = newHarness();
			const tokenIdentifier = 'https://issuer.example|public-creator';
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
			const authenticated = t.withIdentity({
				subject: 'public-creator',
				issuer: 'https://issuer.example',
				tokenIdentifier
			});

			await authenticated.mutation(api.templates.createTemplate, {
				_secret: secret,
				userId,
				title: 'Public creation invalidates discovery',
				slug: 'public-creation-invalidates-discovery',
				description: 'No embedding provider response is required.',
				messageBody: 'Body',
				preview: 'Preview',
				type: 'email',
				deliveryMethod: 'email',
				domain: 'civic',
				topics: [],
				contentHash: 'public-creation-invalidates-discovery',
				status: 'published',
				isPublic: true,
				consensusApproved: true
			});

			const manifest = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(manifest).toMatchObject({
				listDirtyAt: expect.any(Number),
				listRefreshScheduledAt: expect.any(Number),
				relationsDirtyAt: expect.any(Number),
				relationsRefreshScheduledAt: expect.any(Number)
			});
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it('validates before the top-50 limit and backfills invalid or oversized cards', async () => {
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
			sourceScanCap: 250,
			scannedCount: 250,
			all: {
				sourceCap: 50,
				sourceTemplateCount: 50,
				embeddedTemplateCount: 0
			},
			excludeCwc: {
				sourceCap: 50,
				sourceTemplateCount: 50,
				embeddedTemplateCount: 0
			}
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

		const { oversizedId, invalidId, validPeerId } = await t.run(async (ctx) => {
			const oversizedId = await ctx.db.insert(
				'templates',
				templateValue(2_000, { messageBody: 'x'.repeat(22_000) })
			);
			const invalidId = await ctx.db.insert(
				'templates',
				templateValue(2_001, {
					scopes: Array.from({ length: 101 }, (_, index) => ({
						countryCode: 'US',
						regionCode: `US-${index}`,
						displayText: `Region ${index}`,
						scopeLevel: 'region',
						confidence: 1,
						extractionMethod: 'test'
					}))
				})
			);
			const validPeerId = await ctx.db.insert('templates', templateValue(2_002));
			return { oversizedId, invalidId, validPeerId };
		});

		const degraded = await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
		expect(degraded).toMatchObject({
			allCount: 50,
			excludeCwcCount: 50,
			invalidCount: 1,
			oversizedCardCount: 1,
			aggregateShedCount: 0,
			excludedCount: 2
		});
		const afterOversize = await t.query(api.templates.listPublic, {});
		expect(afterOversize).toHaveLength(50);
		expect(afterOversize.map((template) => template.id)).toContain(validPeerId);
		expect(afterOversize.map((template) => template.id)).not.toContain(oversizedId);
		expect(afterOversize.map((template) => template.id)).not.toContain(invalidId);
		const failure = await t.query(internal.templates.publicDiscoveryFailureStatus, {});
		expect(failure.list?.code).toContain(`PUBLIC_TEMPLATE_SNAPSHOT_INVALID:${invalidId}`);
		expect(failure.list?.code).toContain(`PUBLIC_TEMPLATE_CARD_TOO_LARGE:${oversizedId}:`);
	});

	it('publishes valid cards while recording and alerting invalid producer cards', async () => {
		const t = newHarness();
		const { invalidTemplateId, validTemplateId } = await t.run(async (ctx) => {
			const invalidTemplateId = await ctx.db.insert('templates', templateValue(3_000));
			const validTemplateId = await ctx.db.insert('templates', templateValue(3_001));
			return { invalidTemplateId, validTemplateId };
		});

		await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
		const before = await t.query(api.templates.publicDiscoveryManifest, {});
		const lastGood = await t.query(api.templates.listPublic, {});
		expect(lastGood.map(({ id }) => id)).toEqual([validTemplateId, invalidTemplateId]);

		await t.run((ctx) =>
			ctx.db.patch(invalidTemplateId, {
				scopes: Array.from({ length: 101 }, (_, index) => ({
					countryCode: 'US',
					regionCode: `US-${index}`,
					displayText: `Region ${index}`,
					scopeLevel: 'region',
					confidence: 1,
					extractionMethod: 'test'
				}))
			})
		);

		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(
			t.mutation(internal.templates.rebuildPublicTemplateSnapshotsForCronAttempt, {})
		).resolves.toEqual({
			status: 'rebuilt',
			rebuilt: expect.objectContaining({
				invalidCount: 1,
				allCount: 1,
				excludeCwcCount: 1
			})
		});
		expect(await t.query(api.templates.publicDiscoveryManifest, {})).toMatchObject({
			list: { ready: true, revision: before.list.revision + 1 }
		});
		expect((await t.query(api.templates.listPublic, {})).map(({ id }) => id)).toEqual([
			validTemplateId
		]);
		await expect(
			t.query(internal.templates.publicDiscoveryFailureStatus, {})
		).resolves.toMatchObject({
			list: { code: `PUBLIC_TEMPLATE_SNAPSHOT_INVALID:${invalidTemplateId}` }
		});
		await expect(t.query(api.observability.servicePing, {})).resolves.toMatchObject({
			discoveryProducerHealthy: false
		});
		expect(consoleError).toHaveBeenCalledWith(
			'[public-discovery] list revision 2 excluded 1 invalid template card(s); valid cards remain available'
		);
		consoleError.mockRestore();
	});

	it('freezes the last-good snapshot when no valid card survives and clears after repair', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const sentryWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubEnv('SENTRY_DSN', 'invalid-test-dsn');
		try {
			const t = newHarness();
			const healthyId = await t.run((ctx) => ctx.db.insert('templates', templateValue(4_000)));
			await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
			await t.mutation(internal.templates.rebuildRelationSnapshot, {});
			const lastGoodManifest = await t.query(api.templates.publicDiscoveryManifest, {});
			const lastGoodIds = (await t.query(api.templates.listPublic, {})).map(({ id }) => id);
			await t.run(async (ctx) => {
				await ctx.db.patch(healthyId, { messageBody: 'x'.repeat(22_000) });
				for (let index = 0; index < 50; index++) {
					await ctx.db.insert(
						'templates',
						templateValue(5_000 + index, { messageBody: 'x'.repeat(22_000) })
					);
				}
			});
			const failedAt = Date.now();
			const failure = await t.action(internal.templates.rebuildPublicTemplateSnapshotsForCron, {});
			expect(failure).toEqual({ status: 'invalid' });
			expect((await t.query(api.templates.listPublic, {})).map(({ id }) => id)).toEqual(
				lastGoodIds
			);
			expect(await t.query(api.templates.publicDiscoveryManifest, {})).toMatchObject({
				list: {
					ready: true,
					revision: lastGoodManifest.list.revision,
					updatedAt: lastGoodManifest.list.updatedAt
				},
				relations: lastGoodManifest.relations
			});
			await expect(t.query(internal.templates.publicDiscoveryFailureStatus, {})).resolves.toEqual({
				list: {
					failedAt,
					code: expect.stringMatching(/^PUBLIC_TEMPLATE_SNAPSHOT_NO_VALID_CARDS:/)
				},
				relations: null
			});
			await expect(t.query(api.observability.servicePing, {})).resolves.toMatchObject({
				discoveryProducerHealthy: false
			});
			vi.advanceTimersByTime(0);
			await t.finishInProgressScheduledFunctions();
			expect(sentryWarning).toHaveBeenCalledWith(
				'[Sentry/convex] Invalid SENTRY_DSN format; skipping capture'
			);

			await t.run(async (ctx) => {
				for (const row of await ctx.db
					.query('templates')
					.withIndex('by_status_isPublic', (q) => q.eq('status', 'published').eq('isPublic', true))
					.take(100)) {
					if (row.slug.startsWith('template-5')) await ctx.db.delete(row._id);
				}
				await ctx.db.patch(healthyId, { messageBody: 'Message 4000' });
			});
			const retry = await t.mutation(internal.templates.requestPublicTemplateSnapshotRefresh, {});
			expect(retry.scheduled).toBe(true);
			vi.setSystemTime(retry.scheduledAt);
			await t.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
				scheduledAt: retry.scheduledAt
			});
			await expect(t.query(internal.templates.publicDiscoveryFailureStatus, {})).resolves.toEqual({
				list: null,
				relations: null
			});
			await expect(t.query(api.observability.servicePing, {})).resolves.toMatchObject({
				discoveryProducerHealthy: true
			});
		} finally {
			consoleError.mockRestore();
			sentryWarning.mockRestore();
			vi.unstubAllEnvs();
			vi.useRealTimers();
		}
	});

	it('caps each template to its newest six endorsement organizations and preserves the total', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		try {
			const t = newHarness();
			const templateId = await t.run((ctx) =>
				ctx.db.insert('templates', templateValue(3_000, { endorsementCount: 30 }))
			);

			for (let index = 0; index < 30; index++) {
				vi.advanceTimersByTime(1_000);
				await t.run(async (ctx) => {
					const orgId = await ctx.db.insert('organizations', {
						name: `Endorser ${index}`,
						slug: `endorser-${index}`,
						maxSeats: 1,
						maxTemplatesMonth: 1,
						dmCacheTtlDays: 7,
						countryCode: 'US',
						isPublic: true,
						updatedAt: Date.now()
					});
					await ctx.db.insert('templateEndorsements', {
						templateId,
						orgId,
						endorsedAt: Date.now()
					});
				});
			}

			await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
			const [template] = await t.query(api.templates.listPublic, {});
			expect(template.endorsingOrgs).toHaveLength(6);
			expect(template.endorsingOrgs.map((org: { name: string }) => org.name)).toEqual(
				Array.from({ length: 6 }, (_, offset) => `Endorser ${29 - offset}`)
			);
			expect(template.endorsementCount).toBe(30);
		} finally {
			vi.useRealTimers();
		}
	});

	it('ages quiet daily-arrival windows to the materialization day', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
		try {
			const t = newHarness();
			const anchoredDay = Date.parse('2026-07-13T00:00:00.000Z');
			const expiredDay = Date.parse('2026-06-01T00:00:00.000Z');
			await t.run(async (ctx) => {
				await ctx.db.insert(
					'templates',
					templateValue(3_100, {
						verifiedSends: 18,
						dailyArrivals: [...new Array<number>(27).fill(0), 5, 6, 7],
						dailyArrivalsLastDay: anchoredDay
					})
				);
				await ctx.db.insert(
					'templates',
					templateValue(3_101, {
						verifiedSends: 9,
						dailyArrivals: [...new Array<number>(29).fill(0), 9],
						dailyArrivalsLastDay: expiredDay
					})
				);
			});

			await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
			const templates = await t.query(api.templates.listPublic, {});
			const shifted = templates.find((template) => template.slug === 'template-3100');
			const expired = templates.find((template) => template.slug === 'template-3101');

			expect(shifted?.daily_arrivals).toHaveLength(30);
			expect(shifted?.daily_arrivals.slice(-6)).toEqual([5, 6, 7, 0, 0, 0]);
			expect(expired?.daily_arrivals).toEqual(new Array<number>(30).fill(0));
		} finally {
			vi.useRealTimers();
		}
	});

	it('marks the public list dirty only when an organization avatar changes', async () => {
		const t = newHarness();
		const tokenIdentifier = 'https://issuer.example|avatar-editor';
		const { orgId } = await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', {
				tokenIdentifier,
				updatedAt: Date.now(),
				isVerified: true,
				authorityLevel: 1,
				trustTier: 1,
				trustScore: 0,
				reputationTier: 'novice',
				districtVerified: false,
				templatesContributed: 0,
				templateAdoptionRate: 0,
				peerEndorsements: 0,
				activeMonths: 0,
				profileVisibility: 'private'
			});
			const orgId = await ctx.db.insert('organizations', {
				name: 'Avatar Org',
				slug: 'avatar-org',
				maxSeats: 2,
				maxTemplatesMonth: 2,
				dmCacheTtlDays: 7,
				countryCode: 'US',
				isPublic: true,
				updatedAt: Date.now()
			});
			await ctx.db.insert('orgMemberships', {
				userId,
				orgId,
				role: 'editor',
				joinedAt: Date.now()
			});
			return { orgId };
		});
		const authenticated = t.withIdentity({
			subject: 'avatar-editor',
			issuer: 'https://issuer.example',
			tokenIdentifier
		});

		await authenticated.mutation(api.organizations.update, {
			slug: 'avatar-org',
			description: 'Description-only updates do not affect public template cards.'
		});
		expect(
			await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			)
		).toBeNull();

		await authenticated.mutation(api.organizations.update, {
			slug: 'avatar-org',
			avatar: 'https://images.example/avatar.png'
		});
		const dirtyManifest = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(dirtyManifest).toMatchObject({
			key: 'public',
			listReady: false,
			listRevision: 0
		});
		expect(dirtyManifest?.listDirtyAt).toEqual(expect.any(Number));
		expect(dirtyManifest?.listRefreshScheduledAt).toEqual(expect.any(Number));
		expect(await t.run((ctx) => ctx.db.get(orgId))).toMatchObject({
			avatar: 'https://images.example/avatar.png'
		});

		const firstDirtyAt = dirtyManifest?.listDirtyAt;
		await authenticated.mutation(api.organizations.update, {
			slug: 'avatar-org',
			avatar: 'https://images.example/avatar.png'
		});
		const unchangedManifest = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(unchangedManifest?.listDirtyAt).toBe(firstDirtyAt);
	});

	it('publishes graph rows for both list variants without hidden CWC endpoints', async () => {
		const t = newHarness();
		const emailVectors = [
			embedding([10, 1, 0, 0]),
			embedding([10, 1, 0, 0]),
			embedding([10, 0, 1, 0]),
			embedding([10, 0, -1, 0])
		];
		const emailIds = await t.run(async (ctx) => {
			const ids: Id<'templates'>[] = [];
			for (let index = 0; index < emailVectors.length; index++) {
				ids.push(
					await ctx.db.insert(
						'templates',
						templateValue(7_000 + index, {
							topicEmbedding: emailVectors[index]
						})
					)
				);
			}
			// These newer CWC rows occupy the entire unfiltered top 50. The
			// exclude-CWC graph must still be built from the four displayed emails.
			for (let index = 0; index < 50; index++) {
				await ctx.db.insert(
					'templates',
					templateValue(8_000 + index, {
						deliveryMethod: 'cwc'
					})
				);
			}
			return ids;
		});

		await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
		const allList = await t.query(api.templates.publicDiscoveryList, { excludeCwc: false });
		const emailList = await t.query(api.templates.publicDiscoveryList, { excludeCwc: true });
		const allRelations = await t.query(api.templates.publicDiscoveryRelations, {
			excludeCwc: false
		});
		const emailRelations = await t.query(api.templates.publicDiscoveryRelations, {
			excludeCwc: true
		});

		expect(allList.templates).toHaveLength(50);
		expect(allList.templates.every(({ deliveryMethod }) => deliveryMethod === 'cwc')).toBe(true);
		expect(emailList.templates.map(({ id }) => id)).toEqual([...emailIds].reverse());
		expect(allRelations.revision).toBe(emailRelations.revision);
		expect(allRelations.updatedAt).toBe(emailRelations.updatedAt);

		const expectedEmailTwins = computeTwinEdges(
			emailIds.map((id, index) => ({ id, embedding: emailVectors[index] }))
		);
		expect(expectedEmailTwins).toHaveLength(1);
		expect(emailRelations.twinEdges).toEqual(expectedEmailTwins);
		const visibleEmailIds = new Set<string>(emailList.templates.map(({ id }) => id));
		for (const edge of [...emailRelations.twinEdges, ...emailRelations.conceptRelations.edges]) {
			expect(visibleEmailIds.has(edge.a)).toBe(true);
			expect(visibleEmailIds.has(edge.b)).toBe(true);
		}
	});

	it('publishes pure-helper-equivalent relations, rejects malformed vectors, and never live-scans on reads', async () => {
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
			// A newer malformed legacy vector must not establish a two-dimensional
			// calibration or prevent the canonical vectors from entering the graph.
			await ctx.db.insert(
				'templates',
				templateValue(12, {
					topics: ['malformed-vector'],
					topicEmbedding: [1, 0],
					tagEmbeddings: [{ tag: 'malformed-vector', embedding: [1, 0] }]
				})
			);
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
			sourceScanCap: 250,
			scannedCount: 5,
			all: {
				sourceCap: 50,
				sourceTemplateCount: 5,
				embeddedTemplateCount: 4,
				tagVectorCount: 4
			},
			excludeCwc: {
				sourceCap: 50,
				sourceTemplateCount: 5,
				embeddedTemplateCount: 4,
				tagVectorCount: 4
			}
		});
		await expect(
			t.mutation(internal.templates.recomputeRelatednessCalibration, {})
		).resolves.toMatchObject({ updated: true, count: 4, dim: 768 });

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
		expect(snapshotRows).toHaveLength(2);
		expect(snapshotRows.map(({ key }) => key).sort()).toEqual(['all', 'excludeCwc']);
		for (const snapshotRow of snapshotRows) {
			expect(snapshotRow).toMatchObject({
				sourceCap: 50,
				sourceTemplateCount: 5,
				embeddedTemplateCount: 4,
				tagVectorCount: 4
			});
			expect(JSON.stringify(snapshotRow)).not.toContain('topicEmbedding');
			expect(JSON.stringify(snapshotRow)).not.toContain('tagEmbeddings');
		}

		// A removed topic must not keep influencing the concept vocabulary merely
		// because its old server-side vector is still stored for cheap reuse.
		await t.run(async (ctx) => {
			await ctx.db.patch(ids[0], { topics: [] });
		});
		await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		expect((await t.query(api.templates.conceptRelations, {})).conceptMap).not.toHaveProperty(
			tags[0]
		);
	});
});
