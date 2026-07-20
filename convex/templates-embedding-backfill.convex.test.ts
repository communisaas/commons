/// <reference types="vite/client" />

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import schema from './schema';
import { topicEmbeddingMarkerSplitRequiredResult } from './templates';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'embedding-backfill-test-secret-32-bytes-minimum';
type TemplateValue = Omit<Doc<'templates'>, '_id' | '_creationTime'>;

function missingTemplateValue(slug: string, overrides: Partial<TemplateValue> = {}): TemplateValue {
	return {
		slug,
		title: 'Missing embedding fixture',
		description: 'Fixture',
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
		updatedAt: 1_800_000_000_000,
		...overrides
	};
}

function validEmbedding(): number[] {
	return [1, ...new Array<number>(767).fill(0)];
}

function harness() {
	return convexTest({
		schema,
		modules,
		transactionLimits: {
			documentsRead: 25,
			databaseQueries: 2,
			bytesRead: 100_000
		}
	});
}

function writeHarness() {
	return convexTest(schema, modules);
}

function snapshotRebuildBudgetHarness() {
	return convexTest({
		schema,
		modules,
		transactionLimits: {
			// Fifty candidates require bounded enrichment joins plus one keyed topic
			// vector lookup apiece. The shared list selection fits below this ceiling;
			// preparing the enrichment set again for relations would still cross it.
			databaseQueries: 240,
			documentsRead: 500,
			bytesRead: 5_000_000
		}
	});
}

function migrationHarness() {
	return convexTest({
		schema,
		modules,
		transactionLimits: {
			// The migration reads four near-limit rows and patches each valid row in the same
			// bounded transaction; convex-test counts patch lookups toward this cap.
			documentsRead: 225,
			databaseQueries: 5,
			// Pagination itself is capped at 5 MiB. Patching the four returned
			// near-limit rows performs keyed lookups too, so model the production
			// transaction's larger 16 MiB ceiling rather than conflating the two.
			bytesRead: 10_000_000
		}
	});
}

async function seedTemplates(t: ReturnType<typeof harness>, missing: number, completed: number) {
	await t.run(async (ctx) => {
		for (let index = 0; index < missing + completed; index += 1) {
			const hasEmbedding = index >= missing;
			await ctx.db.insert('templates', {
				slug: `backfill-${index}`,
				title: `Backfill ${index}`,
				description: 'Bounded embedding repair fixture',
				topics: ['repair'],
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
				...(hasEmbedding
					? {
							topicEmbedding: [1, 0],
							locationEmbedding: [1, 0],
							embeddingsUpdatedAt: 1_800_000_000_000 + index,
							topicEmbeddingsUpdatedAt: 1_800_000_000_000 + index
						}
					: {}),
				embeddingVersion: 'test',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: 1_800_000_000_000 + index
			});
		}
	});
}

async function prepareDiscoveryRollout(t: ReturnType<typeof writeHarness>) {
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
	await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});
	await t.mutation(internal.templates.migratePublicDiscoveryManifestAuthority, {});
}

describe('bounded embedding backfill discovery', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	it('requires the server secret before exposing repair candidates', async () => {
		const t = harness();
		await seedTemplates(t, 2, 0);
		await expect(
			t.query(api.templates.listMissingEmbeddings, { _secret: 'not-the-secret', limit: 1 })
		).rejects.toThrow('Unauthorized');
	});

	it('uses the exact missing-embedding index and honors a hard batch limit', async () => {
		const t = harness();
		await seedTemplates(t, 40, 5);

		const rows = await t.query(api.templates.listMissingEmbeddings, {
			_secret: SECRET,
			limit: 20
		});

		expect(rows).toHaveLength(20);
		expect(rows.every((row) => !('slug' in row))).toBe(true);
		expect(rows.map((row) => row.title)).toEqual(
			Array.from({ length: 20 }, (_, offset) => `Backfill ${39 - offset}`)
		);
		expect(rows.every((row) => !('topicEmbedding' in row))).toBe(true);
	});

	it('discovers missing tag embeddings only from the published list generation', async () => {
		const t = writeHarness();
		const { emailId, cwcId } = await t.run(async (ctx) => ({
			emailId: await ctx.db.insert(
				'templates',
				missingTemplateValue('published-email-tags', { topics: ['libraries'] })
			),
			cwcId: await ctx.db.insert(
				'templates',
				missingTemplateValue('published-cwc-tags', {
					deliveryMethod: 'cwc',
					topics: ['district access']
				})
			)
		}));
		await prepareDiscoveryRollout(t);

		// A cold deployment has no truthful displayed generation and must not
		// fall back to an embedding-heavy live corpus scan.
		await expect(t.query(internal.templates.listMissingTagEmbeddings, {})).resolves.toEqual([]);
		await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});

		const liveEntrant = await t.run((ctx) =>
			ctx.db.insert(
				'templates',
				missingTemplateValue('not-yet-published-tags', { topics: ['live entrant'] })
			)
		);
		const missing = await t.query(internal.templates.listMissingTagEmbeddings, {});
		expect(new Set(missing.map(({ _id }) => String(_id)))).toEqual(
			new Set([String(emailId), String(cwcId)])
		);
		expect(missing.map(({ _id }) => _id)).not.toContain(liveEntrant);
	});

	it('keeps malformed legacy tag vectors eligible for bounded repair', async () => {
		const t = writeHarness();
		const { corruptId, coveredId } = await t.run(async (ctx) => ({
			corruptId: await ctx.db.insert(
				'templates',
				missingTemplateValue('corrupt-tag-vector', { topics: ['libraries'] })
			),
			coveredId: await ctx.db.insert(
				'templates',
				missingTemplateValue('covered-tag-vector', { topics: ['district access'] })
			)
		}));
		await prepareDiscoveryRollout(t);
		await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
		await t.run(async (ctx) => {
			await ctx.db.insert('publicTagEmbeddingVectors', {
				tag: 'libraries',
				embedding: [Number.NaN, ...new Array<number>(767).fill(0)],
				embeddingVersion: 'legacy-corrupt',
				updatedAt: 1_800_000_000_000
			});
			await ctx.db.insert('publicTagEmbeddingVectors', {
				tag: 'district access',
				embedding: validEmbedding(),
				embeddingVersion: 'current',
				updatedAt: 1_800_000_000_001
			});
		});

		const missing = await t.query(internal.templates.listMissingTagEmbeddings, {});
		expect(missing).toEqual([{ _id: corruptId, tags: ['libraries'] }]);
		expect(missing.map(({ _id }) => _id)).not.toContain(coveredId);
	});

	it('serializes Pages isolates with an expiring token-checked lease', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
		try {
			const t = writeHarness();
			const firstToken = 'backfill-lease-token-first';
			const secondToken = 'backfill-lease-token-second';
			const startedAt = Date.now();

			await expect(
				t.mutation(api.templates.claimEmbeddingBackfillLease, {
					_secret: 'not-the-secret',
					token: firstToken
				})
			).rejects.toThrow('Unauthorized');
			await expect(
				t.mutation(api.templates.claimEmbeddingBackfillLease, {
					_secret: SECRET,
					token: firstToken
				})
			).resolves.toEqual({ acquired: true, expiresAt: startedAt + 15 * 60 * 1000 });
			await expect(
				t.mutation(api.templates.claimEmbeddingBackfillLease, {
					_secret: SECRET,
					token: secondToken
				})
			).resolves.toEqual({ acquired: false, retryAt: startedAt + 15 * 60 * 1000 });

			await expect(
				t.mutation(api.templates.releaseEmbeddingBackfillLease, {
					_secret: SECRET,
					token: secondToken
				})
			).resolves.toEqual({ released: false });

			vi.advanceTimersByTime(15 * 60 * 1000 + 1);
			await expect(
				t.mutation(api.templates.claimEmbeddingBackfillLease, {
					_secret: SECRET,
					token: secondToken
				})
			).resolves.toMatchObject({ acquired: true });
			// The evicted/late first runner cannot clear the reclaimed generation.
			await expect(
				t.mutation(api.templates.releaseEmbeddingBackfillLease, {
					_secret: SECRET,
					token: firstToken
				})
			).resolves.toEqual({ released: false });
			await expect(
				t.mutation(api.templates.releaseEmbeddingBackfillLease, {
					_secret: SECRET,
					token: secondToken
				})
			).resolves.toEqual({ released: true });
			await expect(
				t.run((ctx) => ctx.db.query('embeddingBackfillLeases').collect())
			).resolves.toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not let a tag-only write hide a missing topic embedding', async () => {
		const t = harness();
		await t.run(async (ctx) => {
			await ctx.db.insert('templates', {
				slug: 'tag-first',
				title: 'Tag first',
				description: 'Tag vectors arrived before the topic vector',
				topics: ['repair'],
				tagEmbeddings: [{ tag: 'repair', embedding: [1, 0] }],
				// Legacy/shared activity timestamp must not satisfy the topic marker.
				embeddingsUpdatedAt: 1_800_000_000_000,
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
				updatedAt: 1_800_000_000_000
			});
		});

		await expect(
			t.query(api.templates.listMissingEmbeddings, { _secret: SECRET, limit: 1 })
		).resolves.toMatchObject([{ title: 'Tag first' }]);
	});

	it('migrates valid legacy topic vectors without paying to regenerate them', async () => {
		const t = harness();
		const vector = new Array<number>(768).fill(0);
		vector[0] = 1;
		await t.run(async (ctx) => {
			for (const [index, topicEmbedding] of [vector, [1, 0]].entries()) {
				await ctx.db.insert('templates', {
					slug: `legacy-vector-${index}`,
					title: `Legacy vector ${index}`,
					description: 'Migration fixture',
					topics: [],
					topicEmbedding,
					embeddingsUpdatedAt: 1_800_000_000_000 + index,
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
					embeddingVersion: 'legacy',
					flaggedByModeration: false,
					consensusApproved: true,
					reputationDelta: 0,
					reputationApplied: false,
					updatedAt: 1_800_000_000_000 + index
				});
			}
		});

		await expect(
			t.mutation(internal.templates.migrateTopicEmbeddingMarkers, {})
		).resolves.toMatchObject({ scanned: 2, marked: 1, isDone: true });
		await expect(
			t.query(api.templates.listMissingEmbeddings, { _secret: SECRET, limit: 10 })
		).resolves.toMatchObject([{ title: 'Legacy vector 1' }]);
		await expect(
			t.query(internal.templates.topicEmbeddingMarkerMigrationStatus, {})
		).resolves.toMatchObject({ status: 'complete', scanned: 2, marked: 1 });
		await expect(
			t.mutation(internal.templates.migrateTopicEmbeddingMarkers, {})
		).resolves.toMatchObject({ status: 'already-complete', scanned: 2, marked: 1 });
	});

	it('self-pages near the document limit and exposes durable completion evidence', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		try {
			const t = migrationHarness();
			const vector = new Array<number>(768).fill(0);
			vector[0] = 1;
			await t.run(async (ctx) => {
				for (let index = 0; index < 9; index += 1) {
					await ctx.db.insert('templates', {
						slug: `legacy-page-${index}`,
						title: `Legacy page ${index}`,
						description: 'Multi-page migration fixture',
						topics: [],
						topicEmbedding: vector,
						embeddingsUpdatedAt: 1_800_000_000_000 + index,
						type: 'email',
						deliveryMethod: 'email',
						preview: 'Preview',
						messageBody: 'x'.repeat(900_000),
						deliveryConfig: {},
						recipientConfig: {},
						status: 'published',
						isPublic: true,
						verifiedSends: 0,
						uniqueDistricts: 0,
						embeddingVersion: 'legacy',
						flaggedByModeration: false,
						consensusApproved: true,
						reputationDelta: 0,
						reputationApplied: false,
						updatedAt: 1_800_000_000_000 + index
					});
				}
			});

			await expect(
				t.mutation(internal.templates.migrateTopicEmbeddingMarkers, {})
			).resolves.toMatchObject({
				status: 'running',
				pageScanned: 4,
				scanned: 4,
				isDone: false
			});
			await expect(
				t.query(internal.templates.topicEmbeddingMarkerMigrationStatus, {})
			).resolves.toMatchObject({ status: 'running', scanned: 4, marked: 4 });

			for (let page = 0; page < 4; page += 1) {
				const state = await t.query(internal.templates.topicEmbeddingMarkerMigrationStatus, {});
				if (state.status === 'complete') break;
				vi.advanceTimersByTime(0);
				await t.finishInProgressScheduledFunctions();
			}

			await expect(
				t.query(internal.templates.topicEmbeddingMarkerMigrationStatus, {})
			).resolves.toMatchObject({ status: 'complete', scanned: 9, marked: 9 });
		} finally {
			vi.useRealTimers();
		}
	});

	it('maps a defensive SplitRequired page to zero-progress durable block state', () => {
		expect(
			topicEmbeddingMarkerSplitRequiredResult({
				startedAt: 1_800_000_000_000,
				scanned: 7,
				marked: 3
			})
		).toEqual({
			status: 'blocked',
			failureCode: 'TOPIC_EMBEDDING_MARKER_MIGRATION_PAGE_SPLIT_REQUIRED',
			pageScanned: 0,
			pageMarked: 0,
			scanned: 7,
			marked: 3,
			isDone: false,
			startedAt: 1_800_000_000_000,
			completedAt: null
		});
	});

	it('explicitly restarts a marker migration whose continuation stopped', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
		try {
			const t = writeHarness();
			await t.run((ctx) =>
				ctx.db.insert('publicDiscoveryManifest', {
					key: 'public',
					listReady: false,
					relationsReady: false,
					listRevision: 0,
					relationsRevision: 0,
					topicEmbeddingMarkerMigrationStartedAt: Date.now() - 60_000,
					topicEmbeddingMarkerMigrationScanned: 100,
					topicEmbeddingMarkerMigrationMarked: 50
				})
			);

			await expect(
				t.mutation(internal.templates.migrateTopicEmbeddingMarkers, {})
			).resolves.toMatchObject({ status: 'already-running', scanned: 100, marked: 50 });
			await expect(
				t.mutation(internal.templates.migrateTopicEmbeddingMarkers, { restart: true })
			).resolves.toMatchObject({ status: 'complete', scanned: 0, marked: 0, isDone: true });
			await expect(
				t.query(internal.templates.topicEmbeddingMarkerMigrationStatus, {})
			).resolves.toMatchObject({ status: 'complete', scanned: 0, marked: 0 });
		} finally {
			vi.useRealTimers();
		}
	});

	it('automatically restarts a stale marker migration and supersedes its old continuation', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
		try {
			const t = writeHarness();
			const staleStartedAt = Date.now() - 15 * 60 * 1000 - 1;
			await t.run((ctx) =>
				ctx.db.insert('publicDiscoveryManifest', {
					key: 'public',
					listReady: false,
					relationsReady: false,
					listRevision: 0,
					relationsRevision: 0,
					topicEmbeddingMarkerMigrationStartedAt: staleStartedAt,
					topicEmbeddingMarkerMigrationScanned: 100,
					topicEmbeddingMarkerMigrationMarked: 50
				})
			);

			await expect(
				t.mutation(internal.templates.migrateTopicEmbeddingMarkers, {})
			).resolves.toMatchObject({
				status: 'complete',
				scanned: 0,
				marked: 0,
				startedAt: Date.now()
			});
			await expect(
				t.mutation(internal.templates.migrateTopicEmbeddingMarkers, {
					startedAt: staleStartedAt,
					scanned: 100,
					marked: 50
				})
			).resolves.toMatchObject({ status: 'superseded', startedAt: staleStartedAt });
		} finally {
			vi.useRealTimers();
		}
	});

	it('rejects embedding payloads that could bloat public source documents', async () => {
		const t = writeHarness();
		const leaseToken = 'dimension-guard-lease-token';
		await t.mutation(api.templates.claimEmbeddingBackfillLease, {
			_secret: SECRET,
			token: leaseToken
		});
		const templateId = await t.run((ctx) =>
			ctx.db.insert('templates', {
				slug: 'dimension-guard',
				title: 'Dimension guard',
				description: 'Fixture',
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
				updatedAt: 1_800_000_000_000
			})
		);

		await expect(
			t.mutation(api.templates.updateMissingEmbeddingsForBackfill, {
				templateId,
				locationEmbedding: [1, 0],
				topicEmbedding: [1, 0],
				_secret: SECRET,
				leaseToken
			})
		).rejects.toThrow('INVALID_EMBEDDING_DIMENSION:expected=768');
	});

	it('rejects non-finite embedding components and bounds domain hues to 0..360', async () => {
		const t = writeHarness();
		const leaseToken = 'finite-value-guard-lease-token';
		await t.mutation(api.templates.claimEmbeddingBackfillLease, {
			_secret: SECRET,
			token: leaseToken
		});
		let fixtureIndex = 0;
		const insertFixture = () =>
			t.run((ctx) =>
				ctx.db.insert('templates', missingTemplateValue(`finite-embedding-guard-${fixtureIndex++}`))
			);
		const nonFiniteEmbedding = validEmbedding();
		nonFiniteEmbedding[20] = Number.NaN;

		await expect(
			t.mutation(api.templates.updateMissingEmbeddingsForBackfill, {
				templateId: await insertFixture(),
				locationEmbedding: nonFiniteEmbedding,
				topicEmbedding: validEmbedding(),
				_secret: SECRET,
				leaseToken
			})
		).rejects.toThrow('INVALID_EMBEDDING_VALUE:finite-numbers-required');
		for (const domainHue of [Number.POSITIVE_INFINITY, -0.01, 360, 360.01]) {
			await expect(
				t.mutation(api.templates.updateMissingEmbeddingsForBackfill, {
					templateId: await insertFixture(),
					locationEmbedding: validEmbedding(),
					topicEmbedding: validEmbedding(),
					domainHue,
					_secret: SECRET,
					leaseToken
				})
			).rejects.toThrow('INVALID_DOMAIN_HUE:expected=0..<360');
		}
		for (const domainHue of [0, 359.999]) {
			await expect(
				t.mutation(api.templates.updateMissingEmbeddingsForBackfill, {
					templateId: await insertFixture(),
					locationEmbedding: validEmbedding(),
					topicEmbedding: validEmbedding(),
					domainHue,
					_secret: SECRET,
					leaseToken
				})
			).resolves.toEqual({ updated: true });
		}
	});

	it('completes deferred creator embeddings without request auth and reuses the bounded refresh tokens', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
		try {
			const t = writeHarness();
			const { ownerId, otherId, templateId } = await t.run(async (ctx) => {
				const baseUser = {
					updatedAt: Date.now(),
					isVerified: true,
					authorityLevel: 1,
					trustTier: 1,
					trustScore: 100,
					reputationTier: 'novice' as const,
					districtVerified: false,
					templatesContributed: 0,
					templateAdoptionRate: 0,
					peerEndorsements: 0,
					activeMonths: 0,
					profileVisibility: 'private' as const
				};
				const ownerId = await ctx.db.insert('users', {
					...baseUser,
					tokenIdentifier: 'https://issuer.example|deferred-owner'
				});
				const otherId = await ctx.db.insert('users', {
					...baseUser,
					tokenIdentifier: 'https://issuer.example|wrong-deferred-owner'
				});
				const templateId = await ctx.db.insert(
					'templates',
					missingTemplateValue('deferred-completion', { userId: ownerId })
				);
				return { ownerId, otherId, templateId };
			});
			await prepareDiscoveryRollout(t);

			const listToken = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			const relationToken = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			const args = {
				templateId,
				expectedUserId: ownerId,
				locationEmbedding: validEmbedding(),
				topicEmbedding: validEmbedding(),
				domainHue: 120,
				_secret: SECRET
			};

			await expect(
				t.mutation(api.templates.completePublicTemplateEmbeddings, {
					...args,
					expectedUserId: otherId
				})
			).rejects.toThrow('EMBEDDING_COMPLETION_OWNER_MISMATCH');
			await expect(
				t.mutation(api.templates.completePublicTemplateEmbeddings, args)
			).resolves.toEqual({ updated: true });

			const dirty = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(dirty).toMatchObject({
				listRefreshScheduledAt: listToken.scheduledAt,
				relationsRefreshScheduledAt: relationToken.scheduledAt
			});

			// No direct runAfter(0) composite rebuild is allowed. The first embedding
			// remains behind the same 60-second coalescing window as creation.
			vi.advanceTimersByTime(0);
			await t.finishInProgressScheduledFunctions();
			expect(
				await t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET })
			).toMatchObject({
				list: { revision: 0 },
				relations: { revision: 0 }
			});

			vi.advanceTimersByTime(60_000);
			await t.finishInProgressScheduledFunctions();
			expect(
				await t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET })
			).toMatchObject({
				list: { ready: true, revision: 1 },
				relations: { ready: true, revision: 1 }
			});
			await expect(
				t.mutation(api.templates.completePublicTemplateEmbeddings, args)
			).rejects.toThrow('TOPIC_EMBEDDINGS_ALREADY_PRESENT');
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps the secret-gated backfill bridge missing-only', async () => {
		const t = writeHarness();
		const leaseToken = 'trusted-backfill-lease-token';
		await expect(
			t.mutation(api.templates.claimEmbeddingBackfillLease, {
				_secret: SECRET,
				token: leaseToken
			})
		).resolves.toMatchObject({ acquired: true });
		const { templateId, legacyValidId, privateId } = await t.run(async (ctx) => ({
			templateId: await ctx.db.insert('templates', missingTemplateValue('trusted-backfill')),
			legacyValidId: await ctx.db.insert(
				'templates',
				missingTemplateValue('legacy-valid', {
					locationEmbedding: validEmbedding(),
					topicEmbedding: validEmbedding()
				})
			),
			privateId: await ctx.db.insert(
				'templates',
				missingTemplateValue('private-missing', { isPublic: false })
			)
		}));
		const args = {
			templateId,
			locationEmbedding: validEmbedding(),
			topicEmbedding: validEmbedding(),
			leaseToken
		};

		await expect(
			t.mutation(api.templates.updateMissingEmbeddingsForBackfill, {
				...args,
				_secret: 'not-the-secret'
			})
		).rejects.toThrow('Unauthorized');
		await expect(
			t.mutation(api.templates.updateMissingEmbeddingsForBackfill, {
				...args,
				_secret: SECRET
			})
		).resolves.toEqual({ updated: true });
		await expect(
			t.mutation(api.templates.updateMissingEmbeddingsForBackfill, {
				...args,
				_secret: SECRET
			})
		).rejects.toThrow('TOPIC_EMBEDDINGS_ALREADY_PRESENT');
		await expect(
			t.mutation(api.templates.updateMissingEmbeddingsForBackfill, {
				...args,
				templateId: legacyValidId,
				_secret: SECRET
			})
		).rejects.toThrow('TOPIC_EMBEDDINGS_ALREADY_PRESENT');
		await expect(
			t.mutation(api.templates.updateMissingEmbeddingsForBackfill, {
				...args,
				templateId: privateId,
				_secret: SECRET
			})
		).rejects.toThrow('EMBEDDING_BACKFILL_PUBLIC_TEMPLATE_REQUIRED');

		const manifest = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(manifest?.listDirtyAt).toBeUndefined();
		expect(manifest?.relationsDirtyAt).toEqual(expect.any(Number));
		expect(manifest?.relationsRefreshScheduledAt).toEqual(expect.any(Number));
	});

	it('rejects expired and superseded lease generations at each backfill write and rebuild', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
		try {
			const t = writeHarness();
			const templateId = await t.run((ctx) =>
				ctx.db.insert('templates', missingTemplateValue('authoritative-backfill-lease'))
			);
			await prepareDiscoveryRollout(t);
			const firstToken = 'authoritative-lease-first';
			const successorToken = 'authoritative-lease-successor';
			await expect(
				t.mutation(api.templates.claimEmbeddingBackfillLease, {
					_secret: SECRET,
					token: firstToken
				})
			).resolves.toMatchObject({ acquired: true });

			vi.advanceTimersByTime(15 * 60 * 1000 + 1);
			const writeArgs = {
				templateId,
				locationEmbedding: validEmbedding(),
				topicEmbedding: validEmbedding(),
				_secret: SECRET,
				leaseToken: firstToken
			};
			await expect(
				t.mutation(api.templates.updateMissingEmbeddingsForBackfill, writeArgs)
			).rejects.toThrow('EMBEDDING_BACKFILL_LEASE_EXPIRED');
			expect(await t.run((ctx) => ctx.db.get(templateId))).not.toHaveProperty(
				'topicEmbeddingsUpdatedAt'
			);

			await expect(
				t.mutation(api.templates.claimEmbeddingBackfillLease, {
					_secret: SECRET,
					token: successorToken
				})
			).resolves.toMatchObject({ acquired: true });
			await expect(
				t.mutation(api.templates.updateMissingEmbeddingsForBackfill, writeArgs)
			).rejects.toThrow('EMBEDDING_BACKFILL_LEASE_NOT_OWNED');
			await expect(
				t.mutation(api.templates.rebuildHomepageSnapshotsAfterBackfill, {
					_secret: SECRET,
					leaseToken: firstToken
				})
			).rejects.toThrow('EMBEDDING_BACKFILL_LEASE_NOT_OWNED');

			await expect(
				t.mutation(api.templates.updateMissingEmbeddingsForBackfill, {
					...writeArgs,
					leaseToken: successorToken
				})
			).resolves.toEqual({ updated: true });
			await expect(
				t.mutation(api.templates.rebuildHomepageSnapshotsAfterBackfill, {
					_secret: SECRET,
					leaseToken: successorToken
				})
			).resolves.toMatchObject({ list: expect.any(Object), relations: expect.any(Object) });
		} finally {
			vi.useRealTimers();
		}
	});

	it('reuses one enriched list selection for the post-backfill list and relation publication', async () => {
		const t = snapshotRebuildBudgetHarness();
		const leaseToken = 'single-selection-rebuild-lease';
		await t.run(async (ctx) => {
			for (let index = 0; index < 50; index += 1) {
				await ctx.db.insert(
					'templates',
					missingTemplateValue(`single-selection-${index}`, {
						updatedAt: 1_800_000_000_000 + index
					})
				);
			}
		});
		await prepareDiscoveryRollout(t);
		await expect(
			t.mutation(api.templates.claimEmbeddingBackfillLease, {
				_secret: SECRET,
				token: leaseToken
			})
		).resolves.toMatchObject({ acquired: true });

		await expect(
			t.mutation(api.templates.rebuildHomepageSnapshotsAfterBackfill, {
				_secret: SECRET,
				leaseToken
			})
		).resolves.toMatchObject({
			list: { scannedCount: 50, allCount: 50, excludeCwcCount: 50 },
			relations: {
				scannedCount: 50,
				all: { sourceTemplateCount: 50 },
				excludeCwc: { sourceTemplateCount: 50 }
			}
		});
	});

	it('does not trust direct callers to self-publish server-derived content', async () => {
		const t = harness();
		const userId = await t.run((ctx) =>
			ctx.db.insert('users', {
				tokenIdentifier: 'https://issuer.example|publisher',
				updatedAt: 1_800_000_000_000,
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

		await expect(
			t.mutation(api.templates.createTemplate, {
				_secret: 'caller-controlled',
				userId,
				title: 'Self approved',
				slug: 'self-approved',
				description: '',
				messageBody: 'Body',
				preview: 'Preview',
				type: 'email',
				deliveryMethod: 'email',
				domain: 'civic',
				topics: [],
				contentHash: 'self-approved-hash',
				status: 'published',
				isPublic: true,
				consensusApproved: true
			})
		).rejects.toThrow('Unauthorized');
	});
});
