/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { getFunctionName, type FunctionReference } from 'convex/server';

import schema from './schema';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { computeTwinEdges } from './lib/relatedness';
import { clusterTagConcepts, conceptEdges, tagConceptMap } from './lib/tag_concepts';
import { invalidatePublicDiscoveryAfterDestructiveSourceChange } from './lib/publicDiscovery';
import { issuePublicRecipientProvenance } from './lib/publicRecipientProvenance';
import { PUBLIC_ROLE_LOCAL_PARTS } from './lib/publicRoleAddress';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type Harness = TestConvex<typeof schema>;
type TemplateValue = Omit<Doc<'templates'>, '_id' | '_creationTime'>;
type AnyMutationReference = FunctionReference<'mutation', any, any, any>;
type AnyActionReference = FunctionReference<'action', any, any, any>;

const MATERIALIZER_MUTATIONS = new Set([
	'templates:rebuildPublicTemplateSnapshots',
	'templates:rebuildRelationSnapshot',
	'templates:rebuildHomepageSnapshots',
	'templates:rebuildPublicTemplateSnapshotsForCronAttempt',
	'templates:rebuildRelationSnapshotForCronAttempt',
	'templates:requestPublicTemplateSnapshotRefresh',
	'templates:requestPublicTemplateRelationSnapshotRefresh'
]);

const READY_ONLY_MUTATIONS = new Set([
	'templates:flushScheduledPublicTemplateRefresh',
	'templates:flushScheduledPublicTemplateRelationsRefresh'
]);

async function prepareDiscoveryRollout(t: Harness): Promise<void> {
	let listState: any = await t.mutation(internal.templates.migrateTemplateListProjection, {
		scheduleContinuation: false
	});
	while (listState.status === 'running') {
		listState = await t.mutation(internal.templates.migrateTemplateListProjection, {
			runToken: listState.runToken,
			scheduleContinuation: false
		});
	}
	if (listState.status === 'migrated') {
		await t.mutation(internal.templates.activateTemplateListProjection, {});
	} else if (listState.status !== 'already-ready') {
		throw new Error(`TEST_LIST_PROJECTION_MIGRATION_${listState.status}`);
	}

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
	if (endorsementState.status !== 'complete') {
		throw new Error(`TEST_ENDORSEMENT_MIGRATION_${endorsementState.status}`);
	}

	const migrateSourcePlane = async () => {
		let state: any = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
			scheduleContinuation: false
		});
		while (state.status === 'running') {
			state = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
				runToken: state.runToken,
				scheduleContinuation: false
			});
		}
		return state;
	};
	let sourceState = await migrateSourcePlane();
	if (sourceState.status !== 'migrated') {
		throw new Error(`TEST_SOURCE_MIGRATION_${sourceState.status}`);
	}
	if (
		sourceState.recipientLossTemplates !== sourceState.recipientLossClassifiedTemplates ||
		sourceState.recipientLossRecipients !== sourceState.recipientLossClassifiedRecipients
	) {
		let cursor: string | undefined;
		let classified = 0;
		do {
			const blockers = await t.query(internal.templates.listPublicRecipientMigrationBlockers, {
				cursor
			});
			for (const blocker of blockers.page) {
				await t.mutation(internal.templates.classifyPublicRecipientMigrationRedaction, {
					templateId: blocker.templateId,
					expectedIntentHash: blocker.intentHash,
					operatorReference: `test/explicit-redaction/${blocker.templateId}`
				});
				classified += 1;
			}
			cursor = blockers.continueCursor ?? undefined;
		} while (cursor !== undefined);
		if (classified === 0) throw new Error('TEST_SOURCE_MIGRATION_UNCLASSIFIABLE_LOSS');
		sourceState = await migrateSourcePlane();
		if (sourceState.status !== 'migrated') {
			throw new Error(`TEST_SOURCE_REMIGRATION_${sourceState.status}`);
		}
	}
	await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});
	await t.mutation(internal.templates.migratePublicDiscoveryManifestAuthority, {});

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

function newHarness(): Harness {
	const raw = convexTest(schema, modules);
	return new Proxy(raw, {
		get(target, property, receiver) {
			if (property === 'mutation') {
				return async (reference: AnyMutationReference, args?: Record<string, unknown>) => {
					const name = getFunctionName(reference);
					if (MATERIALIZER_MUTATIONS.has(name)) {
						await prepareDiscoveryRollout(target);
					} else if (READY_ONLY_MUTATIONS.has(name)) {
						const sourceState = await target.query(
							internal.templates.publicDiscoverySourceMigrationStatus,
							{}
						);
						if (sourceState.status !== 'ready') await prepareDiscoveryRollout(target);
					}
					return await target.mutation(reference, args);
				};
			}
			if (property === 'action') {
				return async (reference: AnyActionReference, args?: Record<string, unknown>) => {
					await prepareDiscoveryRollout(target);
					return await target.action(reference, args);
				};
			}
			if (property === 'finishInProgressScheduledFunctions') {
				return async (...args: unknown[]) => {
					const sourceState = await target.query(
						internal.templates.publicDiscoverySourceMigrationStatus,
						{}
					);
					if (sourceState.status !== 'ready') {
						throw new Error(`TEST_SOURCE_NOT_READY_BEFORE_SCHEDULED:${sourceState.status}`);
					}
					return await (
						target.finishInProgressScheduledFunctions as (...values: unknown[]) => Promise<unknown>
					)(...args);
				};
			}
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		}
	}) as Harness;
}

function templateValue(index: number, overrides: Partial<TemplateValue> = {}): TemplateValue {
	return {
		slug: `template-${index}`,
		title: `Template ${index}`,
		description: `Description ${index}`,
		topics: [],
		type: 'email',
		deliveryMethod: 'email' as const,
		preview: `Preview ${index}`,
		messageBody: `Message ${index}`,
		deliveryConfig: {},
		recipientConfig: {},
		status: 'published',
		isPublic: true,
		verifiedSends: 0,
		uniqueDistricts: 0,
		endorsementCount: 0,
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
		deliveryMethod: 'email' as const,
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
		district_counts_suppressed_districts: 0,
		district_counts_suppressed_count: 0,
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

async function insertTestUser(t: Harness, index: number): Promise<Id<'users'>> {
	return await t.run((ctx) =>
		ctx.db.insert('users', {
			tokenIdentifier: `https://issuer.example|recipient-author-${index}`,
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
}

async function attestedRecipient(
	userId: Id<'users'>,
	overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
	const recipient = {
		name: 'Target one',
		title: 'Director',
		organization: 'Public agency',
		email: 'info@example.test',
		emailGrounded: true,
		emailSource: 'https://agency.example.test/contact',
		isAiResolved: true,
		...overrides
	};
	const groundedRecipient = {
		...recipient,
		publicEmailGrounding: {
			version: 1,
			method: 'page-read',
			source: recipient.emailSource
		}
	};
	const publicRecipientProvenance = await issuePublicRecipientProvenance(
		groundedRecipient,
		String(userId),
		PUBLIC_CREATE_SECRET
	);
	if (!publicRecipientProvenance) throw new Error('TEST_PUBLIC_RECIPIENT_ATTESTATION_FAILED');
	return { ...groundedRecipient, publicRecipientProvenance };
}

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', PUBLIC_CREATE_SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

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
		deliveryMethod: 'email' as const,
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
		await t.mutation(internal.templates.migratePublicDiscoveryManifestAuthority, {});

		expect(
			await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET })
		).toEqual({
			list: {
				ready: false,
				retiredRevision: 0,
				revision: 0,
				updatedAt: null,
				withdrawalEpoch: 0
			},
			relations: {
				ready: false,
				retiredRevision: 0,
				revision: 0,
				updatedAt: null,
				withdrawalEpoch: 0
			}
		});
		expect(
			await t.query(api.templates.publicDiscoveryList, { _secret: PUBLIC_CREATE_SECRET })
		).toEqual({
			projectionVersion: 0,
			revision: 0,
			updatedAt: null,
			templates: []
		});
		expect(
			await t.query(api.templates.publicDiscoveryRelations, { _secret: PUBLIC_CREATE_SECRET })
		).toEqual({
			revision: 0,
			updatedAt: null,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});
		await expect(
			t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })
		).rejects.toThrow('PUBLIC_DISCOVERY_LIST_SNAPSHOT_NOT_READY:all');

		await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
		const afterList = await t.query(api.templates.publicDiscoveryManifest, {
			_secret: PUBLIC_CREATE_SECRET
		});
		expect(afterList.list).toMatchObject({ ready: true, revision: 1 });
		expect(afterList.relations).toEqual({
			ready: false,
			retiredRevision: 0,
			revision: 0,
			updatedAt: null,
			withdrawalEpoch: 0
		});
		expect(
			await t.query(api.templates.publicDiscoveryList, { _secret: PUBLIC_CREATE_SECRET })
		).toMatchObject({
			projectionVersion: 4,
			revision: 1,
			templates: []
		});

		await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		const afterRelations = await t.query(api.templates.publicDiscoveryManifest, {
			_secret: PUBLIC_CREATE_SECRET
		});
		expect(afterRelations.relations).toMatchObject({ ready: true, revision: 1 });
		expect(
			await t.query(api.templates.publicDiscoveryRelations, { _secret: PUBLIC_CREATE_SECRET })
		).toMatchObject({
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
					templateValue(5_000 + index, { messageBody: 'x'.repeat(15_500) })
				);
			}
		});
		await expect(t.mutation(internal.templates.rebuildHomepageSnapshots, {})).rejects.toThrow(
			/PUBLIC_TEMPLATE_SNAPSHOT_NO_VALID_CARDS:/
		);
		expect(
			await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET })
		).toEqual(afterRelations);
		expect(await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })).toEqual([]);

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
		expect(
			await t.query(api.templates.publicDiscoveryList, { _secret: PUBLIC_CREATE_SECRET })
		).toMatchObject({
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
		expect(
			await t.query(api.templates.publicDiscoveryRelations, { _secret: PUBLIC_CREATE_SECRET })
		).toMatchObject({
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

		await expect(
			t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })
		).rejects.toThrow();
		await expect(
			t.query(api.templates.publicDiscoveryList, { _secret: PUBLIC_CREATE_SECRET })
		).rejects.toThrow();
		await expect(
			t.query(api.templates.relatednessEdges, { _secret: PUBLIC_CREATE_SECRET })
		).rejects.toThrow();
		await expect(
			t.query(api.templates.conceptRelations, { _secret: PUBLIC_CREATE_SECRET })
		).rejects.toThrow();
		await expect(
			t.query(api.templates.publicDiscoveryRelations, { _secret: PUBLIC_CREATE_SECRET })
		).rejects.toThrow();
		await expect(
			t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET })
		).rejects.toThrow();
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
		const sensitiveDeliveryToken = 'legacy-private-delivery-token';
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
			delivery_config: { token: sensitiveDeliveryToken },
			cwc_config: { apiKey: sensitiveDeliveryToken },
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
					{ ...storedPublicCard('draft-stored'), status: 'draft' },
					{ ...storedPublicCard('private-stored'), is_public: false },
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
		const publicList = await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET });
		expect(publicList).toEqual([newer]);
		await expect(
			t.query(api.templates.publicDiscoveryList, { _secret: PUBLIC_CREATE_SECRET })
		).resolves.toEqual({
			projectionVersion: 0,
			revision: 1,
			updatedAt: 1,
			templates: [newer]
		});
		expect(JSON.stringify(publicList)).not.toContain(sensitiveEmail);
		expect(JSON.stringify(publicList)).not.toContain(sensitiveDeliveryToken);
		expect(storedProjectionError).toHaveBeenCalledTimes(2);
		expect(storedProjectionError).toHaveBeenNthCalledWith(
			1,
			'[public-discovery] PUBLIC_TEMPLATE_SNAPSHOT_STORED_INVALID:key=all:revision=1:dropped=5:stored=6'
		);
		expect(storedProjectionError).toHaveBeenNthCalledWith(
			2,
			'[public-discovery] PUBLIC_TEMPLATE_SNAPSHOT_STORED_INVALID:key=all:revision=1:dropped=5:stored=6'
		);
		storedProjectionError.mockRestore();
		await expect(
			t.query(api.templates.publicDiscoveryRelations, { _secret: PUBLIC_CREATE_SECRET })
		).resolves.toMatchObject({
			revision: 1,
			updatedAt: 1,
			twinEdges: [newerTwin]
		});
	});

	it('redacts public configs while preserving only the attested detail/send roster', async () => {
		const t = newHarness();
		const targetEmail = 'press@example.test';
		const deliveryConfig = { provider: 'detail-only-provider' };
		const cwcConfig = { apiKey: 'detail-only-secret' };
		const userId = await insertTestUser(t, 9_000);
		const eligibleRecipient = await attestedRecipient(userId, {
			email: targetEmail,
			personalPrompt: 'How has this affected you?',
			publicActions: ['Approved the current policy'],
			emailVerified: 'deliverable',
			emailSourceTitle: 'Internal source title',
			provenance: 'private pipeline provenance',
			source: 'https://research.example.test/private',
			source_url: 'https://research.example.test/private-legacy',
			recencyCheck: 'private recency reasoning',
			positionSourceDate: '2026-07-17'
		});
		await t.run((ctx) =>
			ctx.db.insert(
				'templates',
				templateValue(9_000, {
					userId,
					deliveryConfig,
					cwcConfig,
					recipientConfig: {
						emails: [targetEmail, 'compatibility-only@example.test'],
						decisionMakers: [
							eligibleRecipient,
							{
								name: 'Target two',
								title: 'Deputy',
								organization: 'Public agency',
								email: 'forged@example.test',
								isAiResolved: true,
								emailGrounded: true,
								emailSource: 'https://agency.example.test/forged'
							}
						],
						privateNote: 'recipient-config-secret',
						workflow: { apiKey: 'recipient-workflow-secret' }
					}
				})
			)
		);

		await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
		const [listCard] = await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET });
		const detail = await t.query(api.templates.getBySlugPublic, {
			_secret: PUBLIC_CREATE_SECRET,
			slug: 'template-9000'
		});

		expect(listCard).toMatchObject({
			delivery_config: {},
			cwc_config: null,
			recipient_config: null,
			recipientEmails: [],
			// The card advertises only the provenance-checked roster that the
			// detail/send surface can actually use, never private authoring intent.
			recipient_count: 1
		});
		expect(detail).toMatchObject({
			delivery_config: {},
			cwc_config: null,
			recipient_config: {
				emails: [targetEmail],
				decisionMakers: [
					{
						name: 'Target one',
						title: 'Director',
						organization: 'Public agency',
						email: targetEmail,
						emailGrounded: true,
						emailSource: 'https://agency.example.test/contact'
					}
				]
			},
			recipientEmails: [targetEmail],
			recipient_count: 1
		});
		const projectedDecisionMaker = detail?.recipient_config?.decisionMakers?.[0];
		expect(projectedDecisionMaker).not.toHaveProperty('accountabilityOpener');
		expect(projectedDecisionMaker).not.toHaveProperty('relevanceRank');
		expect(JSON.stringify(listCard)).not.toContain(targetEmail);
		expect(JSON.stringify(detail)).not.toContain(cwcConfig.apiKey);
		expect(JSON.stringify(detail)).not.toContain(deliveryConfig.provider);
		expect(JSON.stringify(detail)).not.toContain('recipient-config-secret');
		expect(JSON.stringify(detail)).not.toContain('recipient-workflow-secret');
		expect(JSON.stringify(detail)).not.toContain('private pipeline provenance');
		expect(JSON.stringify(detail)).not.toContain('research.example.test');
		expect(JSON.stringify(detail)).not.toContain('private recency reasoning');
		expect(JSON.stringify(detail)).not.toContain('Internal source title');
		expect(JSON.stringify(detail)).not.toContain('javascript:');
		expect(JSON.stringify(detail)).not.toContain('Approved the current policy');
		expect(JSON.stringify(detail)).not.toContain('How has this affected you?');
		expect(JSON.stringify(detail)).not.toContain('forged@example.test');
		expect(JSON.stringify(detail)).not.toContain('compatibility-only@example.test');
	});

	it('caps both public detail roster projections from the same normalized allowlist', async () => {
		const t = newHarness();
		const userId = await insertTestUser(t, 9_001);
		const roleLocalParts = [...PUBLIC_ROLE_LOCAL_PARTS].slice(0, 55);
		expect(roleLocalParts).toHaveLength(55);
		const decisionMakers = await Promise.all(
			roleLocalParts.map((roleLocalPart, index) =>
				attestedRecipient(userId, {
					name: `Public ${roleLocalPart} office`,
					email: `${roleLocalPart}@example.test`,
					emailSource: `https://agency.example.test/contact/${index}`
				})
			)
		);
		await t.run((ctx) =>
			ctx.db.insert(
				'templates',
				templateValue(9_001, { userId, recipientConfig: { decisionMakers } })
			)
		);
		await prepareDiscoveryRollout(t);

		const detail = await t.query(api.templates.getBySlugPublic, {
			_secret: PUBLIC_CREATE_SECRET,
			slug: 'template-9001'
		});
		expect(detail).not.toBeNull();
		const projectedConfig = detail?.recipient_config as { emails: string[] };
		expect(detail?.recipientEmails).toHaveLength(50);
		expect(projectedConfig.emails).toEqual(detail?.recipientEmails);
		expect(detail?.recipient_count).toBe(50);
	});

	it('round-trips query-string public email sources and refuses fragments', async () => {
		const t = newHarness();
		const bareEmail = 'info@example.test';
		const queryEmail = 'planning@example.test';
		const fragmentEmail = 'press@example.test';
		const querySource = 'https://agency.example.test/contact?dept=planning&view=staff';
		const userId = await insertTestUser(t, 9_003);
		const bareSource = await attestedRecipient(userId, {
			name: 'Bare source',
			email: bareEmail
		});
		const queryStringSource = await attestedRecipient(userId, {
			name: 'Planning desk',
			email: queryEmail,
			emailSource: querySource
		});
		await t.run((ctx) =>
			ctx.db.insert(
				'templates',
				templateValue(9_003, {
					userId,
					recipientConfig: {
						emails: [bareEmail, queryEmail, fragmentEmail],
						decisionMakers: [
							bareSource,
							queryStringSource,
							{
								name: 'Fragment credential',
								title: 'Director',
								organization: 'Public agency',
								email: fragmentEmail,
								isAiResolved: true,
								emailGrounded: true,
								emailSource: 'https://agency.example.test/contact#access_token=private-fragment'
							}
						]
					}
				})
			)
		);
		await prepareDiscoveryRollout(t);

		const detail = await t.query(api.templates.getBySlugPublic, {
			_secret: PUBLIC_CREATE_SECRET,
			slug: 'template-9003'
		});
		expect(detail).not.toBeNull();
		const decisionMakers = (
			detail!.recipient_config as unknown as {
				decisionMakers: Array<Record<string, unknown>>;
			}
		).decisionMakers;
		expect(decisionMakers).toEqual([
			{
				name: 'Bare source',
				title: 'Director',
				organization: 'Public agency',
				email: bareEmail,
				emailGrounded: true,
				emailSource: 'https://agency.example.test/contact'
			},
			{
				name: 'Planning desk',
				title: 'Director',
				organization: 'Public agency',
				email: queryEmail,
				emailGrounded: true,
				emailSource: querySource
			}
		]);
		expect(JSON.stringify(detail)).toContain(querySource);
		expect(JSON.stringify(detail)).not.toContain('private-fragment');
	});

	it('ignores compatibility string arrays rather than granting or consuming roster eligibility', async () => {
		const t = newHarness();
		const userId = await insertTestUser(t, 9_002);
		const roleEmails = ['press@example.test', 'info@example.test', 'superintendent@example.test'];
		const compatibilityEmails = Array.from(
			{ length: 50 },
			(_, index) => `compatibility-target-${index}@example.test`
		);
		const decisionMakers = await Promise.all(
			roleEmails.map((email, index) =>
				attestedRecipient(userId, {
					name: `Decision maker ${index}`,
					email,
					emailSource: `https://sources.example.test/address-${index}`
				})
			)
		);
		await t.run((ctx) =>
			ctx.db.insert(
				'templates',
				templateValue(9_002, {
					userId,
					recipientConfig: {
						recipients: compatibilityEmails,
						decisionMakers
					}
				})
			)
		);
		await prepareDiscoveryRollout(t);

		const detail = await t.query(api.templates.getBySlugPublic, {
			_secret: PUBLIC_CREATE_SECRET,
			slug: 'template-9002'
		});
		expect(detail).not.toBeNull();
		const projectedConfig = detail?.recipient_config as {
			emails: string[];
			decisionMakers: Array<{ name: string; email?: string }>;
		};
		expect(detail?.recipientEmails).toEqual(roleEmails);
		expect(projectedConfig.emails).toEqual(detail?.recipientEmails);
		expect(projectedConfig.decisionMakers).toHaveLength(3);
		expect(JSON.stringify(detail)).not.toContain(compatibilityEmails[0]);
		expect(detail?.recipient_count).toBe(3);
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
			expect(
				(await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET }))
					.list.revision
			).toBe(0);
			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();
			const firstPublish = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
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
			expect(
				(await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET }))
					.list.revision
			).toBe(1);
			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();
			expect(
				(await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET }))
					.list
			).toMatchObject({
				ready: true,
				revision: 2
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('promotes public authoring to a one-minute list generation without lifting the relation floor', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		try {
			const t = newHarness();
			await t.run((ctx) => ctx.db.insert('templates', templateValue(7_050)));
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const before = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});

			const ordinary = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			expect(ordinary.scheduledAt).toBe(before.list.updatedAt! + 6 * 60 * 60 * 1000);

			const authoredAt = Date.now();
			const newcomer = await createPublicTemplate(t, 7_051);
			const pending = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(pending).toMatchObject({
				listDirtyAt: authoredAt,
				listRefreshScheduledAt: authoredAt + 60_000,
				listRefreshUrgency: 'prompt',
				relationsDirtyAt: authoredAt,
				relationsRefreshScheduledAt: before.relations.updatedAt! + 6 * 60 * 60 * 1000
			});
			expect(pending!.listRefreshScheduledAt).toBeLessThan(ordinary.scheduledAt);
			expect(pending?.relationsRefreshUrgency).toBeUndefined();

			vi.setSystemTime(pending!.listRefreshScheduledAt!);
			await expect(
				t.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
					scheduledAt: pending!.listRefreshScheduledAt!
				})
			).resolves.toMatchObject({
				status: 'rebuilt',
				rebuilt: { allCount: 2 }
			});

			const after = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
			expect(after.list.revision).toBe(before.list.revision + 1);
			expect(after.relations).toEqual(before.relations);
			expect(
				(await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })).map(
					({ id }) => id
				)
			).toContain(newcomer);
			const retainedRelationWork = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(retainedRelationWork?.listDirtyAt).toBeUndefined();
			expect(retainedRelationWork?.listRefreshUrgency).toBeUndefined();
			expect(retainedRelationWork?.relationsDirtyAt).toBe(authoredAt);
			expect(retainedRelationWork?.relationsRefreshScheduledAt).toBe(
				before.relations.updatedAt! + 6 * 60 * 60 * 1000
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('fails both public families closed immediately when a published template is deleted', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		try {
			const t = newHarness();
			const deletedId = await t.run((ctx) => ctx.db.insert('templates', templateValue(7_060)));
			await t.run((ctx) => ctx.db.insert('templates', templateValue(7_061)));
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const before = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});

			await t.mutation(internal.templates.deleteTemplate, { templateId: deletedId });
			await expect(
				t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET })
			).resolves.toEqual({
				list: {
					...before.list,
					ready: false,
					retiredRevision: before.list.revision,
					withdrawalEpoch: before.list.withdrawalEpoch + 1
				},
				relations: {
					...before.relations,
					ready: false,
					retiredRevision: before.relations.revision,
					withdrawalEpoch: before.relations.withdrawalEpoch + 1
				}
			});
			const invalidated = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(invalidated).toMatchObject({
				listReady: false,
				relationsReady: false,
				listWithdrawalEpoch: before.list.withdrawalEpoch + 1,
				relationsWithdrawalEpoch: before.relations.withdrawalEpoch + 1,
				listRefreshUrgency: 'urgent',
				relationsRefreshUrgency: 'urgent',
				listRefreshScheduledAt: expect.any(Number),
				relationsRefreshScheduledAt: expect.any(Number)
			});
			expect(invalidated?.relationsRefreshScheduledAt).toBe(invalidated?.listRefreshScheduledAt);
			await t.run((ctx) =>
				invalidatePublicDiscoveryAfterDestructiveSourceChange(ctx, {
					list: true,
					relations: true
				})
			);
			const repeated = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
			expect(repeated.list.withdrawalEpoch).toBe(before.list.withdrawalEpoch + 1);
			expect(repeated.relations.withdrawalEpoch).toBe(before.relations.withdrawalEpoch + 1);

			await expect(
				t.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
					scheduledAt: invalidated!.listRefreshScheduledAt!
				})
			).resolves.toMatchObject({
				status: 'rebuilt',
				rebuilt: {
					list: { allCount: 1 },
					relations: { all: { sourceTemplateCount: 1 } }
				}
			});
			const after = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
			expect(after.list).toMatchObject({ ready: true, revision: before.list.revision + 1 });
			expect(after.relations).toMatchObject({
				ready: true,
				revision: before.relations.revision + 1
			});
			expect(after.list.withdrawalEpoch).toBe(before.list.withdrawalEpoch + 1);
			expect(after.relations.withdrawalEpoch).toBe(before.relations.withdrawalEpoch + 1);

			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const ordinary = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
			expect(ordinary.list.withdrawalEpoch).toBe(after.list.withdrawalEpoch);
			expect(ordinary.relations.withdrawalEpoch).toBe(after.relations.withdrawalEpoch);
			expect(
				(await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })).map(
					({ id }) => id
				)
			).not.toContain(deletedId);
		} finally {
			vi.useRealTimers();
		}
	});

	it('increments each withdrawal epoch once across concurrent destructive invalidators', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:30:00.000Z'));
		try {
			const t = newHarness();
			await t.run((ctx) => ctx.db.insert('templates', templateValue(7_062)));
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const before = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});

			await Promise.all([
				t.run((ctx) =>
					invalidatePublicDiscoveryAfterDestructiveSourceChange(ctx, {
						list: true,
						relations: true
					})
				),
				t.run((ctx) =>
					invalidatePublicDiscoveryAfterDestructiveSourceChange(ctx, {
						list: true,
						relations: true
					})
				)
			]);

			const after = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
			expect(after.list).toMatchObject({
				ready: false,
				withdrawalEpoch: before.list.withdrawalEpoch + 1
			});
			expect(after.relations).toMatchObject({
				ready: false,
				withdrawalEpoch: before.relations.withdrawalEpoch + 1
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
			expect(
				(await writerFirst.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })).map(
					({ id }) => id
				)
			).toContain(writerFirstId);

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
			expect(
				await flushFirst.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })
			).toEqual([]);

			vi.setSystemTime(pending!.listRefreshScheduledAt!);
			await flushFirst.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
				scheduledAt: pending!.listRefreshScheduledAt!
			});
			expect(
				(await flushFirst.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })).map(
					({ id }) => id
				)
			).toContain(flushFirstId);

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
			expect(
				(await boundary.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })).map(
					({ id }) => id
				)
			).toContain(boundaryId);
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
			await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
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
			expect(
				(await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET }))
					.relations.revision
			).toBe(0);
			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();

			const firstPublish = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
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
			expect(
				(await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET }))
					.relations.revision
			).toBe(1);
			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();
			expect(
				(await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET }))
					.relations
			).toMatchObject({
				ready: true,
				revision: 2
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('defers a relation-first token and publishes both dirty families from one list plan', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		try {
			const t = newHarness();
			await t.run(async (ctx) => {
				await ctx.db.insert(
					'templates',
					templateValue(7_100, { topicEmbedding: embedding([10, 1, 0]) })
				);
				await ctx.db.insert(
					'templates',
					templateValue(7_101, { topicEmbedding: embedding([10, 0, 1]) })
				);
			});
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const before = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});

			const newcomer = await t.run((ctx) =>
				ctx.db.insert('templates', templateValue(7_102, { topicEmbedding: embedding([10, -1, 0]) }))
			);
			const listRequest = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			const relationRequest = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			expect(relationRequest.scheduledAt).toBe(listRequest.scheduledAt);

			vi.setSystemTime(relationRequest.scheduledAt);
			await expect(
				t.mutation(internal.templates.flushScheduledPublicTemplateRelationsRefresh, {
					scheduledAt: relationRequest.scheduledAt
				})
			).resolves.toMatchObject({
				status: 'deferred-for-list',
				scheduledAt: expect.any(Number)
			});
			expect(
				await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET })
			).toEqual(before);
			expect(
				(await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })).map(
					({ id }) => id
				)
			).not.toContain(newcomer);

			const flushed = await t.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
				scheduledAt: listRequest.scheduledAt
			});
			expect(flushed).toMatchObject({
				status: 'rebuilt',
				rebuilt: {
					list: { allCount: 3 },
					relations: { all: { sourceTemplateCount: 3 } }
				}
			});

			const listIds = new Set(
				(await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })).map(({ id }) =>
					String(id)
				)
			);
			expect(listIds.has(String(newcomer))).toBe(true);
			const relations = await t.query(api.templates.publicDiscoveryRelations, {
				_secret: PUBLIC_CREATE_SECRET
			});
			for (const edge of [...relations.twinEdges, ...relations.conceptRelations.edges]) {
				expect(listIds.has(String(edge.a))).toBe(true);
				expect(listIds.has(String(edge.b))).toBe(true);
			}
			const after = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
			expect(after.list.revision).toBe(before.list.revision + 1);
			expect(after.relations.revision).toBe(before.relations.revision + 1);
			const manifest = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(manifest?.listDirtyAt).toBeUndefined();
			expect(manifest?.relationsDirtyAt).toBeUndefined();
			expect(manifest?.listRefreshScheduledAt).toBeUndefined();
			expect(manifest?.relationsRefreshScheduledAt).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('holds a composite refresh until both independent six-hour floors are eligible', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		try {
			const t = newHarness();
			await t.run((ctx) => ctx.db.insert('templates', templateValue(7_125)));
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const initial = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});

			vi.advanceTimersByTime(6 * 60 * 60 * 1000);
			await t.mutation(internal.templates.rebuildRelationSnapshot, {});
			const relationFresh = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
			expect(relationFresh.list).toEqual(initial.list);
			expect(relationFresh.relations.revision).toBe(initial.relations.revision + 1);

			const listRequest = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			const relationRequest = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			expect(listRequest.scheduledAt).toBe(Date.now() + 60_000);
			expect(relationRequest.scheduledAt).toBe(
				relationFresh.relations.updatedAt! + 6 * 60 * 60 * 1000
			);

			vi.setSystemTime(listRequest.scheduledAt);
			const deferred = await t.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
				scheduledAt: listRequest.scheduledAt
			});
			expect(deferred).toEqual({
				status: 'deferred',
				scheduledAt: relationRequest.scheduledAt,
				relationsScheduledAt: relationRequest.scheduledAt
			});
			if (deferred.status !== 'deferred') throw new Error('expected deferred composite');
			expect(
				await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET })
			).toEqual(relationFresh);

			vi.advanceTimersByTime(deferred.scheduledAt - listRequest.scheduledAt);
			// Exercise the real same-token race between the deferred list owner and
			// the relation job that was queued before ownership was aligned.
			await t.finishInProgressScheduledFunctions();
			const published = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
			expect(published.list.revision).toBe(initial.list.revision + 1);
			expect(published.relations.revision).toBe(relationFresh.relations.revision + 1);
			expect(published.relations.updatedAt).toBeGreaterThanOrEqual(
				relationFresh.relations.updatedAt! + 6 * 60 * 60 * 1000
			);
			const manifest = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(manifest?.listRefreshScheduledAt).toBeUndefined();
			expect(manifest?.relationsRefreshScheduledAt).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('freezes a relation token when its dirty list has no recovery token', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const t = newHarness();
			const templateId = await t.run((ctx) => ctx.db.insert('templates', templateValue(7_150)));
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const lastGood = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});

			await t.run((ctx) => ctx.db.patch(templateId, { messageBody: 'x'.repeat(15_500) }));
			const listRequest = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);

			vi.setSystemTime(listRequest.scheduledAt);
			await expect(
				t.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
					scheduledAt: listRequest.scheduledAt
				})
			).resolves.toEqual({ status: 'invalid' });
			const relationRequest = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			vi.setSystemTime(relationRequest.scheduledAt);
			await expect(
				t.mutation(internal.templates.flushScheduledPublicTemplateRelationsRefresh, {
					scheduledAt: relationRequest.scheduledAt
				})
			).resolves.toEqual({ status: 'blocked-by-list' });

			const afterFailure = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(afterFailure).toMatchObject({
				listReady: true,
				listRevision: lastGood.list.revision,
				relationsReady: true,
				relationsRevision: lastGood.relations.revision,
				listDirtyAt: expect.any(Number),
				relationsDirtyAt: expect.any(Number),
				listFailureCode: expect.stringMatching(/^PUBLIC_TEMPLATE_SNAPSHOT_NO_VALID_CARDS:/),
				relationsFailureCode: expect.stringMatching(/^PUBLIC_DISCOVERY_RELATIONS_BLOCKED_BY_LIST:/)
			});
			expect(afterFailure?.listRefreshScheduledAt).toBeUndefined();
			expect(afterFailure?.relationsRefreshScheduledAt).toBeUndefined();

			vi.advanceTimersByTime(60_000);
			await t.finishInProgressScheduledFunctions();
			const afterQueuedNoOps = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(afterQueuedNoOps?.relationsRevision).toBe(lastGood.relations.revision);
			expect(afterQueuedNoOps?.relationsRefreshScheduledAt).toBeUndefined();
		} finally {
			consoleError.mockRestore();
			vi.useRealTimers();
		}
	});

	it('freezes both list-owned composite tokens after deterministic list rejection', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const t = newHarness();
			const templateId = await t.run((ctx) => ctx.db.insert('templates', templateValue(7_160)));
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const lastGood = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});

			await t.run((ctx) => ctx.db.patch(templateId, { messageBody: 'x'.repeat(15_500) }));
			const listRequest = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			const relationRequest = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			expect(relationRequest.scheduledAt).toBe(listRequest.scheduledAt);

			vi.setSystemTime(listRequest.scheduledAt);
			await expect(
				t.mutation(internal.templates.flushScheduledPublicTemplateRefresh, {
					scheduledAt: listRequest.scheduledAt
				})
			).resolves.toEqual({ status: 'invalid' });
			const frozen = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(frozen).toMatchObject({
				listRevision: lastGood.list.revision,
				relationsRevision: lastGood.relations.revision,
				listDirtyAt: expect.any(Number),
				relationsDirtyAt: expect.any(Number),
				listFailureCode: expect.stringMatching(/^PUBLIC_TEMPLATE_SNAPSHOT_NO_VALID_CARDS:/),
				relationsFailureCode: expect.stringMatching(/^PUBLIC_DISCOVERY_RELATIONS_BLOCKED_BY_LIST:/)
			});
			expect(frozen?.listRefreshScheduledAt).toBeUndefined();
			expect(frozen?.relationsRefreshScheduledAt).toBeUndefined();
			await expect(
				t.mutation(internal.templates.flushScheduledPublicTemplateRelationsRefresh, {
					scheduledAt: relationRequest.scheduledAt
				})
			).resolves.toEqual({ status: 'superseded' });

			await t.finishInProgressScheduledFunctions();
			const afterQueuedNoOps = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
			expect(afterQueuedNoOps).toEqual(lastGood);
		} finally {
			consoleError.mockRestore();
			vi.useRealTimers();
		}
	});

	it('supervises composite scheduled failures without clearing successor tokens', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const t = newHarness();
			await t.run((ctx) => ctx.db.insert('templates', templateValue(7_175)));
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const before = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
			const duplicateId = await t.run(async (ctx) => {
				const row = await ctx.db
					.query('templateRelationSnapshots')
					.withIndex('by_key', (q) => q.eq('key', 'all'))
					.unique();
				if (!row) throw new Error('missing relation snapshot');
				const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...value } = row;
				return await ctx.db.insert('templateRelationSnapshots', value);
			});

			const listRequest = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			const relationRequest = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			vi.setSystemTime(listRequest.scheduledAt);
			await expect(
				t.action(internal.templates.superviseScheduledPublicTemplateRefresh, {
					scheduledAt: listRequest.scheduledAt
				})
			).rejects.toThrow();

			const failed = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(failed).toMatchObject({
				listRevision: before.list.revision,
				relationsRevision: before.relations.revision,
				listFailureCode: expect.stringMatching(/^PUBLIC_DISCOVERY_LIST_SCHEDULED_REBUILD_FAILED:/),
				relationsFailureCode: expect.stringMatching(
					/^PUBLIC_DISCOVERY_RELATIONS_COMPOSITE_REBUILD_FAILED:/
				)
			});
			expect(failed?.listRefreshScheduledAt).toBeUndefined();
			expect(failed?.relationsRefreshScheduledAt).toBeUndefined();

			await t.run((ctx) => ctx.db.delete(duplicateId));
			const successorList = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			const successorRelations = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			await expect(
				t.mutation(internal.templates.recoverPublicDiscoveryScheduledRefreshFailure, {
					family: 'list',
					scheduledAt: listRequest.scheduledAt,
					relationsScheduledAt: relationRequest.scheduledAt,
					code: 'STALE_ATTEMPT',
					failedAt: Date.now()
				})
			).resolves.toEqual({ recorded: [] });
			const successorManifest = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(successorManifest?.listRefreshScheduledAt).toBe(successorList.scheduledAt);
			expect(successorManifest?.relationsRefreshScheduledAt).toBe(successorRelations.scheduledAt);

			vi.setSystemTime(successorList.scheduledAt);
			await expect(
				t.action(internal.templates.superviseScheduledPublicTemplateRefresh, {
					scheduledAt: successorList.scheduledAt
				})
			).resolves.toMatchObject({ status: 'rebuilt' });
			expect(await t.query(internal.templates.publicDiscoveryFailureStatus, {})).toEqual({
				list: null,
				relations: null
			});
		} finally {
			consoleError.mockRestore();
			vi.useRealTimers();
		}
	});

	it('cron recovery records failure without clearing a newer writer-owned token', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const t = newHarness();
			await t.run((ctx) => ctx.db.insert('templates', templateValue(7_176)));
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const attempt = await t.query(internal.templates.publicDiscoveryCronAttemptState, {});

			// The source writer schedules a successor after the failed attempt rolled
			// back but before the fresh recovery mutation begins.
			const successor = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			await t.mutation(internal.templates.recordPublicDiscoverySnapshotRuntimeFailure, {
				failures: [
					{
						family: 'list',
						code: 'PUBLIC_DISCOVERY_LIST_REBUILD_FAILED:synthetic'
					}
				],
				failedAt: Date.now(),
				attempt
			});

			const manifest = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(manifest).toMatchObject({
				listRefreshScheduledAt: successor.scheduledAt,
				listDirtyAt: expect.any(Number),
				listFailureCode: 'PUBLIC_DISCOVERY_LIST_REBUILD_FAILED:synthetic'
			});
		} finally {
			consoleError.mockRestore();
			vi.useRealTimers();
		}
	});

	it('cron recovery ignores an attempt superseded by a newer successful publication', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const t = newHarness();
			await t.run((ctx) => ctx.db.insert('templates', templateValue(7_177)));
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const attempt = await t.query(internal.templates.publicDiscoveryCronAttemptState, {});

			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const newer = await t.query(internal.templates.publicDiscoveryCronAttemptState, {});
			await expect(
				t.mutation(internal.templates.recordPublicDiscoverySnapshotRuntimeFailure, {
					failures: [
						{ family: 'list', code: 'STALE_LIST_CRON_FAILURE' },
						{ family: 'relations', code: 'STALE_RELATIONS_CRON_FAILURE' }
					],
					failedAt: Date.now(),
					attempt
				})
			).resolves.toEqual({ recorded: [] });

			const manifest = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(manifest).toMatchObject({
				listReady: true,
				relationsReady: true,
				listRevision: newer.listRevision,
				relationsRevision: newer.relationsRevision
			});
			expect(manifest?.listDirtyAt).toBeUndefined();
			expect(manifest?.relationsDirtyAt).toBeUndefined();
			expect(manifest?.listFailureCode).toBeUndefined();
			expect(manifest?.relationsFailureCode).toBeUndefined();
		} finally {
			consoleError.mockRestore();
			vi.useRealTimers();
		}
	});

	it('builds a relation-only refresh from published list IDs instead of live entrants', async () => {
		const t = newHarness();
		await t.run(async (ctx) => {
			await ctx.db.insert(
				'templates',
				templateValue(7_200, { topicEmbedding: embedding([10, 1, 0]) })
			);
			await ctx.db.insert(
				'templates',
				templateValue(7_201, { topicEmbedding: embedding([10, 0, 1]) })
			);
		});
		await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
		const publishedIds = new Set(
			(await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })).map(({ id }) =>
				String(id)
			)
		);
		const liveEntrant = await t.run((ctx) =>
			ctx.db.insert('templates', templateValue(7_202, { topicEmbedding: embedding([10, -1, 0]) }))
		);

		const rebuilt = await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		expect(rebuilt).toMatchObject({
			scannedCount: 2,
			all: { sourceTemplateCount: 2 },
			excludeCwc: { sourceTemplateCount: 2 }
		});
		expect(publishedIds.has(String(liveEntrant))).toBe(false);
		const relations = await t.query(api.templates.publicDiscoveryRelations, {
			_secret: PUBLIC_CREATE_SECRET
		});
		for (const edge of [...relations.twinEdges, ...relations.conceptRelations.edges]) {
			expect(publishedIds.has(String(edge.a))).toBe(true);
			expect(publishedIds.has(String(edge.b))).toBe(true);
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
				deliveryMethod: 'email' as const,
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
		await expect(
			t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })
		).rejects.toThrow('PUBLIC_DISCOVERY_LIST_SNAPSHOT_NOT_READY:all');

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

		const all = await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET });
		expect(all).toHaveLength(50);
		expect(all.map((template) => template.slug)).toEqual(
			Array.from({ length: 50 }, (_, offset) => `template-${259 - offset}`)
		);

		const excludingCwc = await t.query(api.templates.listPublic, {
			_secret: PUBLIC_CREATE_SECRET,
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
				templateValue(2_000, { messageBody: 'x'.repeat(15_500) })
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
		const afterOversize = await t.query(api.templates.listPublic, {
			_secret: PUBLIC_CREATE_SECRET
		});
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
		const before = await t.query(api.templates.publicDiscoveryManifest, {
			_secret: PUBLIC_CREATE_SECRET
		});
		const lastGood = await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET });
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
		expect(
			await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET })
		).toMatchObject({
			list: { ready: true, revision: before.list.revision + 1 }
		});
		expect(
			(await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })).map(
				({ id }) => id
			)
		).toEqual([validTemplateId]);
		await expect(
			t.query(internal.templates.publicDiscoveryFailureStatus, {})
		).resolves.toMatchObject({
			list: { code: `PUBLIC_TEMPLATE_SNAPSHOT_INVALID:${invalidTemplateId}` }
		});
		await expect(
			t.query(api.observability.discoveryProducerStatus, { _secret: PUBLIC_CREATE_SECRET })
		).resolves.toMatchObject({
			discoveryProducerHealthy: false
		});
		expect(consoleError).toHaveBeenCalledWith(
			'[public-discovery] list revision 2 excluded 1 invalid template card(s); valid cards remain available'
		);
		consoleError.mockRestore();
	});

	it('builds relations from the same validated and backfilled cards as the list', async () => {
		const t = newHarness();
		const vectors = [
			embedding([10, 1, 0, 0]),
			embedding([10, 1, 0, 0]),
			embedding([10, 0, 1, 0]),
			embedding([10, 0, -1, 0])
		];
		const { validIds, invalidId, oversizedId } = await t.run(async (ctx) => {
			const validIds: Id<'templates'>[] = [];
			for (let index = 0; index < vectors.length; index++) {
				validIds.push(
					await ctx.db.insert(
						'templates',
						templateValue(3_100 + index, { topicEmbedding: vectors[index] })
					)
				);
			}
			const oversizedId = await ctx.db.insert(
				'templates',
				templateValue(3_200, {
					messageBody: 'x'.repeat(15_500),
					topicEmbedding: vectors[0]
				})
			);
			const invalidId = await ctx.db.insert(
				'templates',
				templateValue(3_201, {
					topicEmbedding: vectors[1],
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
			return { validIds, invalidId, oversizedId };
		});

		const rebuilt = await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
		expect(rebuilt).toMatchObject({
			list: { allCount: 4, invalidCount: 1, oversizedCardCount: 1 },
			relations: {
				scannedCount: 6,
				all: { sourceTemplateCount: 4, embeddedTemplateCount: 4 },
				excludeCwc: { sourceTemplateCount: 4, embeddedTemplateCount: 4 }
			}
		});
		const listIds = (
			await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })
		).map(({ id }) => id);
		expect(listIds).toEqual([...validIds].reverse());
		expect(listIds).not.toContain(invalidId);
		expect(listIds).not.toContain(oversizedId);
		const relations = await t.query(api.templates.publicDiscoveryRelations, {
			_secret: PUBLIC_CREATE_SECRET
		});
		for (const edge of [...relations.twinEdges, ...relations.conceptRelations.edges]) {
			expect(listIds).toContain(edge.a);
			expect(listIds).toContain(edge.b);
		}
	});

	it('deduplicates stable degraded-list evidence and clears it only after repair', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		vi.stubEnv('SENTRY_DSN', 'invalid-test-dsn');
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const sentryWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const t = newHarness();
			const scheduledFailureReports = () =>
				t.run(async (ctx) =>
					(await ctx.db.system.query('_scheduled_functions').collect()).filter(
						(job) => job.name === 'templates:reportPublicDiscoverySnapshotFailure'
					)
				);
			const invalidId = await t.run(async (ctx) => {
				await ctx.db.insert('templates', templateValue(3_299));
				return await ctx.db.insert(
					'templates',
					templateValue(3_300, {
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
			});

			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const firstFailure = await t.query(internal.templates.publicDiscoveryFailureStatus, {});
			expect(firstFailure.list?.code).toBe(`PUBLIC_TEMPLATE_SNAPSHOT_INVALID:${invalidId}`);
			expect(await scheduledFailureReports()).toHaveLength(1);
			vi.advanceTimersByTime(0);
			await t.finishInProgressScheduledFunctions();
			expect(await scheduledFailureReports()).toHaveLength(1);

			vi.advanceTimersByTime(60 * 60 * 1000);
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const repeatedFailure = await t.query(internal.templates.publicDiscoveryFailureStatus, {});
			expect(repeatedFailure.list).toEqual(firstFailure.list);
			const repeatedManifest = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(repeatedManifest?.listDirtyAt).toBeUndefined();
			vi.advanceTimersByTime(0);
			await t.finishInProgressScheduledFunctions();
			// A stable degraded corpus retains its original evidence without
			// scheduling a second out-of-band alert. Inspect the harness-local
			// scheduler instead of global console traffic from unrelated jobs.
			expect(await scheduledFailureReports()).toHaveLength(1);

			await t.run((ctx) => ctx.db.patch(invalidId, { scopes: [] }));
			vi.advanceTimersByTime(60 * 60 * 1000);
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			expect(await t.query(internal.templates.publicDiscoveryFailureStatus, {})).toEqual({
				list: null,
				relations: null
			});
			await expect(
				t.query(api.observability.discoveryProducerStatus, { _secret: PUBLIC_CREATE_SECRET })
			).resolves.toMatchObject({
				discoveryProducerHealthy: true
			});
		} finally {
			consoleError.mockRestore();
			sentryWarning.mockRestore();
			vi.unstubAllEnvs();
			vi.useRealTimers();
		}
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
			const lastGoodManifest = await t.query(api.templates.publicDiscoveryManifest, {
				_secret: PUBLIC_CREATE_SECRET
			});
			const lastGoodIds = (
				await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })
			).map(({ id }) => id);
			await t.run(async (ctx) => {
				await ctx.db.patch(healthyId, { messageBody: 'x'.repeat(15_500) });
				for (let index = 0; index < 50; index++) {
					await ctx.db.insert(
						'templates',
						templateValue(5_000 + index, { messageBody: 'x'.repeat(15_500) })
					);
				}
			});
			const failedAt = Date.now();
			const failure = await t.action(internal.templates.rebuildPublicTemplateSnapshotsForCron, {});
			expect(failure).toEqual({ status: 'invalid' });
			expect(
				(await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET })).map(
					({ id }) => id
				)
			).toEqual(lastGoodIds);
			expect(
				await t.query(api.templates.publicDiscoveryManifest, { _secret: PUBLIC_CREATE_SECRET })
			).toMatchObject({
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
			await expect(
				t.query(api.observability.discoveryProducerStatus, { _secret: PUBLIC_CREATE_SECRET })
			).resolves.toMatchObject({
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
			await expect(
				t.query(api.observability.discoveryProducerStatus, { _secret: PUBLIC_CREATE_SECRET })
			).resolves.toMatchObject({
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
			const [template] = await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET });
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
			const templates = await t.query(api.templates.listPublic, { _secret: PUBLIC_CREATE_SECRET });
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
			listRevision: 0,
			listRefreshUrgency: 'prompt'
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

	it('records non-oversize scheduled relation failures and recovers after repair', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const t = newHarness();
			await t.run((ctx) => ctx.db.insert('templates', templateValue(6_900)));
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			const lastGood = await t.query(api.templates.publicDiscoveryRelations, {
				_secret: PUBLIC_CREATE_SECRET
			});
			await t.run(async (ctx) => {
				const row = await ctx.db
					.query('publicTemplateSnapshots')
					.withIndex('by_key', (q) => q.eq('key', 'all'))
					.unique();
				if (!row) throw new Error('missing published list row');
				await ctx.db.patch(row._id, { revision: (row.revision ?? 0) + 1 });
			});

			const requested = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			vi.setSystemTime(requested.scheduledAt);
			await expect(
				t.mutation(internal.templates.flushScheduledPublicTemplateRelationsRefresh, {
					scheduledAt: requested.scheduledAt
				})
			).resolves.toEqual({ status: 'invalid' });
			expect(
				await t.query(api.templates.publicDiscoveryRelations, { _secret: PUBLIC_CREATE_SECRET })
			).toEqual(lastGood);
			await expect(
				t.query(internal.templates.publicDiscoveryFailureStatus, {})
			).resolves.toMatchObject({
				relations: {
					code: expect.stringMatching(
						/^PUBLIC_TEMPLATE_SNAPSHOT_INVALID:relations:published-generation:all/
					)
				}
			});
			await expect(
				t.query(api.observability.discoveryProducerStatus, { _secret: PUBLIC_CREATE_SECRET })
			).resolves.toMatchObject({
				discoveryProducerHealthy: false
			});

			await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
			const retry = await t.mutation(
				internal.templates.requestPublicTemplateRelationSnapshotRefresh,
				{}
			);
			vi.setSystemTime(retry.scheduledAt);
			await expect(
				t.mutation(internal.templates.flushScheduledPublicTemplateRelationsRefresh, {
					scheduledAt: retry.scheduledAt
				})
			).resolves.toMatchObject({ status: 'rebuilt' });
			expect(await t.query(internal.templates.publicDiscoveryFailureStatus, {})).toEqual({
				list: null,
				relations: null
			});
			await expect(
				t.query(api.observability.discoveryProducerStatus, { _secret: PUBLIC_CREATE_SECRET })
			).resolves.toMatchObject({
				discoveryProducerHealthy: true
			});
		} finally {
			consoleError.mockRestore();
			vi.useRealTimers();
		}
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
						deliveryMethod: 'cwc' as const
					})
				);
			}
			return ids;
		});

		await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
		const allList = await t.query(api.templates.publicDiscoveryList, {
			_secret: PUBLIC_CREATE_SECRET,
			excludeCwc: false
		});
		const emailList = await t.query(api.templates.publicDiscoveryList, {
			_secret: PUBLIC_CREATE_SECRET,
			excludeCwc: true
		});
		const allRelations = await t.query(api.templates.publicDiscoveryRelations, {
			_secret: PUBLIC_CREATE_SECRET,
			excludeCwc: false
		});
		const emailRelations = await t.query(api.templates.publicDiscoveryRelations, {
			_secret: PUBLIC_CREATE_SECRET,
			excludeCwc: true
		});
		expect(
			await t.query(api.templates.relatednessEdges, { _secret: PUBLIC_CREATE_SECRET })
		).toEqual(allRelations.twinEdges);
		expect(
			await t.query(api.templates.conceptRelations, { _secret: PUBLIC_CREATE_SECRET })
		).toEqual(allRelations.conceptRelations);
		expect(
			await t.query(api.templates.relatednessEdges, {
				_secret: PUBLIC_CREATE_SECRET,
				excludeCwc: true
			})
		).toEqual(emailRelations.twinEdges);
		expect(
			await t.query(api.templates.conceptRelations, {
				_secret: PUBLIC_CREATE_SECRET,
				excludeCwc: true
			})
		).toEqual(emailRelations.conceptRelations);

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

	it('deterministically sheds oversized relation payloads and retains unhealthy evidence', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		vi.stubEnv('SENTRY_DSN', 'invalid-test-dsn');
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const sentryWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const t = newHarness();
			const tagFor = (conceptIndex: number, variant: number) =>
				`${conceptIndex.toString().padStart(2, '0')}-${variant}-${'x'.repeat(5_400)}`;
			const tagVector = (conceptIndex: number) => {
				const vector = new Array<number>(768).fill(0);
				vector[0] = 10;
				vector[conceptIndex + 1] = 2;
				return vector;
			};
			const templateIds = await t.run(async (ctx) => {
				const ids: Id<'templates'>[] = [];
				for (let templateIndex = 0; templateIndex < 50; templateIndex++) {
					const previousConcept = (templateIndex + 49) % 50;
					const topics = [tagFor(templateIndex, 0), tagFor(previousConcept, 1)];
					ids.push(
						await ctx.db.insert(
							'templates',
							templateValue(7_500 + templateIndex, {
								topics,
								tagEmbeddings: [
									{ tag: topics[0], embedding: tagVector(templateIndex) },
									{ tag: topics[1], embedding: tagVector(previousConcept) }
								]
							})
						)
					);
				}
				return ids;
			});

			const first = await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			expect(first.relations.all).toMatchObject({
				sourceTemplateCount: 50,
				conceptEdgeShedCount: expect.any(Number),
				conceptEntryShedCount: expect.any(Number)
			});
			expect(first.relations.all.conceptEdgeShedCount).toBeGreaterThan(0);
			expect(first.relations.all.conceptEntryShedCount).toBeGreaterThan(0);
			expect(first.relations.all.snapshotBytes).toBeLessThanOrEqual(900_000);
			const firstFailure = await t.query(internal.templates.publicDiscoveryFailureStatus, {});
			expect(firstFailure.relations?.code).toMatch(/^RELATION_SNAPSHOT_DEGRADED:/);
			await expect(
				t.query(api.observability.discoveryProducerStatus, { _secret: PUBLIC_CREATE_SECRET })
			).resolves.toMatchObject({
				discoveryProducerHealthy: false
			});
			vi.advanceTimersByTime(0);
			await t.finishInProgressScheduledFunctions();
			expect(sentryWarning).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(60 * 60 * 1000);
			const repeated = await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			expect(repeated.relations.all).toMatchObject({
				conceptEdgeShedCount: first.relations.all.conceptEdgeShedCount,
				conceptEntryShedCount: first.relations.all.conceptEntryShedCount,
				snapshotBytes: first.relations.all.snapshotBytes
			});
			expect(
				(await t.query(internal.templates.publicDiscoveryFailureStatus, {})).relations
			).toEqual(firstFailure.relations);
			vi.advanceTimersByTime(0);
			await t.finishInProgressScheduledFunctions();
			expect(sentryWarning).toHaveBeenCalledTimes(1);

			await t.run(async (ctx) => {
				for (const id of templateIds) {
					await ctx.db.patch(id, { topics: [], tagEmbeddings: [] });
				}
			});
			vi.advanceTimersByTime(60 * 60 * 1000);
			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
			expect(await t.query(internal.templates.publicDiscoveryFailureStatus, {})).toEqual({
				list: null,
				relations: null
			});
			await expect(
				t.query(api.observability.discoveryProducerStatus, { _secret: PUBLIC_CREATE_SECRET })
			).resolves.toMatchObject({
				discoveryProducerHealthy: true
			});
		} finally {
			consoleError.mockRestore();
			sentryWarning.mockRestore();
			vi.unstubAllEnvs();
			vi.useRealTimers();
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
			const nonFiniteTopic = embedding([10, 1, 0, 0]);
			nonFiniteTopic[100] = Number.NaN;
			const nonFiniteTag = embedding([10, 1, 0]);
			nonFiniteTag[200] = Number.POSITIVE_INFINITY;
			await ctx.db.insert(
				'templates',
				templateValue(13, {
					topics: ['non-finite-vector'],
					topicEmbedding: nonFiniteTopic,
					tagEmbeddings: [{ tag: 'non-finite-vector', embedding: nonFiniteTag }]
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

		expect(
			await t.query(api.templates.relatednessEdges, { _secret: PUBLIC_CREATE_SECRET })
		).toEqual([]);
		expect(
			await t.query(api.templates.conceptRelations, { _secret: PUBLIC_CREATE_SECRET })
		).toEqual({
			edges: [],
			conceptMap: {}
		});

		await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
		const rebuilt = await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		expect(rebuilt).toMatchObject({
			sourceScanCap: 250,
			scannedCount: 6,
			all: {
				sourceCap: 50,
				sourceTemplateCount: 6,
				embeddedTemplateCount: 4,
				tagVectorCount: 4
			},
			excludeCwc: {
				sourceCap: 50,
				sourceTemplateCount: 6,
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

		expect(
			await t.query(api.templates.relatednessEdges, { _secret: PUBLIC_CREATE_SECRET })
		).toEqual(expectedTwins);
		expect(
			await t.query(api.templates.conceptRelations, { _secret: PUBLIC_CREATE_SECRET })
		).toEqual({
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
		expect(
			await t.query(api.templates.relatednessEdges, { _secret: PUBLIC_CREATE_SECRET })
		).toEqual(expectedTwins);

		await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		const snapshotRows = await t.run(async (ctx) =>
			ctx.db.query('templateRelationSnapshots').collect()
		);
		expect(snapshotRows).toHaveLength(2);
		expect(snapshotRows.map(({ key }) => key).sort()).toEqual(['all', 'excludeCwc']);
		for (const snapshotRow of snapshotRows) {
			expect(snapshotRow).toMatchObject({
				sourceCap: 50,
				sourceTemplateCount: 6,
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
		expect(
			(await t.query(api.templates.conceptRelations, { _secret: PUBLIC_CREATE_SECRET })).conceptMap
		).not.toHaveProperty(tags[0]);
	});
});
