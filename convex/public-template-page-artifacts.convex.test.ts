/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';

import { api, internal } from './_generated/api';
import schema from './schema';
import type { Id } from './_generated/dataModel';
import {
	PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS,
	PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_AGE_MS,
	PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_BODY
} from './lib/publicDiscovery';
import {
	PUBLIC_TEMPLATE_PAGE_AUTHOR_COORDINATE_MAX,
	bumpPublicTemplatePageArtifactsForAuthor
} from './lib/publicTemplateDiscoverySource';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const NOW = 1_900_000_000_000;
const SECRET = 'public-template-page-secret-0123456789';

function userValue() {
	return {
		updatedAt: NOW,
		isVerified: false,
		authorityLevel: 1,
		trustTier: 0,
		trustScore: 0,
		reputationTier: 'new',
		districtVerified: false,
		templatesContributed: 0,
		templateAdoptionRate: 0,
		peerEndorsements: 0,
		activeMonths: 0,
		profileVisibility: 'public'
	};
}

function templateValue(index: number, userId: Id<'users'>) {
	return {
		slug: `author-page-${index.toString().padStart(3, '0')}`,
		title: `Author page ${index}`,
		description: 'Bounded author fan-out fixture',
		topics: [],
		type: 'email',
		deliveryMethod: 'email' as const,
		preview: 'Preview',
		messageBody: 'Message',
		deliveryConfig: {},
		recipientConfig: {},
		status: 'published',
		isPublic: true,
		verifiedSends: 0,
		uniqueDistricts: 0,
		embeddingVersion: 'none',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		updatedAt: NOW,
		userId
	};
}

describe('public template page artifact coordinates', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
		vi.stubEnv(
			'PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL',
			'https://commons.example/api/internal/public-discovery-manifest-refresh'
		);
		vi.stubEnv('DISCOVERY_MANIFEST_REFRESH_SECRET', SECRET);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('bumps all 250 author coordinates atomically and fails closed at 251', async () => {
		const t = convexTest({ schema, modules });
		const userId = await t.run((ctx) => ctx.db.insert('users', userValue()));

		await t.run(async (ctx) => {
			for (let index = 0; index < PUBLIC_TEMPLATE_PAGE_AUTHOR_COORDINATE_MAX; index += 1) {
				const templateId = await ctx.db.insert('templates', templateValue(index, userId));
				await ctx.db.insert('publicTemplatePageArtifactCoordinates', {
					templateId,
					userId,
					generation: 'author-test-generation',
					slug: `author-page-${index.toString().padStart(3, '0')}`,
					projectionVersion: 1,
					artifactRevision: index + 1,
					detailUpdatedAt: 1,
					aggregateUpdatedAt: 1,
					updatedAt: 1
				});
			}
		});

		await expect(
			t.run((ctx) => bumpPublicTemplatePageArtifactsForAuthor(ctx, userId, NOW))
		).resolves.toBe(PUBLIC_TEMPLATE_PAGE_AUTHOR_COORDINATE_MAX);
		const bumped = await t.run((ctx) =>
			ctx.db
				.query('publicTemplatePageArtifactCoordinates')
				.withIndex('by_userId', (q) => q.eq('userId', userId))
				.collect()
		);
		expect(bumped).toHaveLength(PUBLIC_TEMPLATE_PAGE_AUTHOR_COORDINATE_MAX);
		expect(
			bumped.every(
				(row) =>
					row.artifactRevision === NOW && row.detailUpdatedAt === NOW && row.updatedAt === NOW
			)
		).toBe(true);

		await t.run(async (ctx) => {
			const templateId = await ctx.db.insert(
				'templates',
				templateValue(PUBLIC_TEMPLATE_PAGE_AUTHOR_COORDINATE_MAX, userId)
			);
			await ctx.db.insert('publicTemplatePageArtifactCoordinates', {
				templateId,
				userId,
				generation: 'author-test-generation',
				slug: 'author-page-250',
				projectionVersion: 1,
				artifactRevision: 251,
				detailUpdatedAt: 1,
				aggregateUpdatedAt: 1,
				updatedAt: 1
			});
		});

		await expect(
			t.run((ctx) => bumpPublicTemplatePageArtifactsForAuthor(ctx, userId, NOW + 1))
		).rejects.toThrow('PUBLIC_TEMPLATE_PAGE_AUTHOR_COORDINATE_CAP_EXCEEDED');
		const afterRejectedBump = await t.run((ctx) =>
			ctx.db
				.query('publicTemplatePageArtifactCoordinates')
				.withIndex('by_userId', (q) => q.eq('userId', userId))
				.collect()
		);
		expect(afterRejectedBump).toHaveLength(251);
		expect(afterRejectedBump.filter((row) => row.artifactRevision === NOW)).toHaveLength(250);
		expect(afterRejectedBump.find((row) => row.slug === 'author-page-250')).toMatchObject({
			artifactRevision: 251,
			detailUpdatedAt: 1
		});
	});

	it('makes argument-score mutation, page coordinate, and aggregate producer token one transaction', async () => {
		const t = convexTest({ schema, modules });
		const { debateId, templateId } = await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', userValue());
			const templateId = await ctx.db.insert('templates', templateValue(0, userId));
			const debateId = await ctx.db.insert('debates', {
				templateId,
				debateIdOnchain: 'offchain-page-score-freshness',
				actionDomain: `0x${'11'.repeat(32)}`,
				propositionHash: `0x${'22'.repeat(32)}`,
				propositionText: 'Should score changes reach the anonymous artifact?',
				deadline: NOW + 86_400_000,
				jurisdictionSize: 100,
				status: 'active',
				argumentCount: 1,
				uniqueParticipants: 1,
				totalStake: 1,
				resolvedFromChain: false,
				proposerAddress: `0x${'00'.repeat(20)}`,
				proposerBond: 0,
				marketStatus: 'pre_market',
				currentEpoch: 0,
				updatedAt: 1
			});
			await ctx.db.insert('debateArguments', {
				debateId,
				argumentIndex: 0,
				stance: 'SUPPORT',
				body: 'A bounded public argument.',
				bodyHash: `0x${'33'.repeat(32)}`,
				stakeAmount: 1,
				engagementTier: 3,
				weightedScore: 1,
				totalStake: 1,
				coSignCount: 0,
				positionCount: 0,
				verificationStatus: 'verified'
			});
			await ctx.db.insert('publicTemplatePageArtifactCoordinates', {
				templateId,
				userId,
				generation: 'score-freshness-generation',
				slug: 'author-page-000',
				projectionVersion: 1,
				artifactRevision: 1,
				detailUpdatedAt: 1,
				aggregateUpdatedAt: 1,
				updatedAt: 1
			});
			return { debateId, templateId };
		});

		await t.mutation(api.debates.updateArgumentScores, {
			_secret: SECRET,
			debateId,
			scores: [
				{
					argumentIndex: 0,
					aiScores: { relevance: 0.9 },
					aiWeighted: 0.8,
					finalScore: 0.85,
					modelAgreement: 0.95
				}
			]
		});

		const state = await t.run(async (ctx) => ({
			coordinate: await ctx.db
				.query('publicTemplatePageArtifactCoordinates')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.unique(),
			manifest: await ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		}));
		expect(state.coordinate).toMatchObject({
			artifactRevision: NOW,
			aggregateUpdatedAt: NOW,
			updatedAt: NOW
		});
		expect(state.manifest?.listDirtyAt).toBe(NOW);
		expect(state.manifest?.listRefreshScheduledAt).toBeGreaterThanOrEqual(NOW + 60_000);
		expect(state.manifest?.listRefreshScheduledAt).toBeLessThanOrEqual(
			NOW + PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS
		);
	});

	it('retains one durable producer token through all sixteen 202 continuation cycles', async () => {
		const t = convexTest({ schema, modules });
		const token = 'page-artifact-continuation-token';
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				manifestControlPushToken: token,
				relationsReady: true,
				relationsRevision: 1
			})
		);
		const fetch = vi.fn(
			async (_input: URL, _init?: RequestInit) =>
				new Response('{}', {
					headers: {
						'retry-after': '120',
						'x-public-discovery-page-backfill-continuation': '1',
						'x-public-discovery-refresh-gate-protocol': '3'
					},
					status: fetch.mock.calls.length < 16 ? 202 : 200
				})
		);
		vi.stubGlobal('fetch', fetch);

		for (let cycle = 1; cycle < 16; cycle += 1) {
			await expect(
				t.action(internal.templates.pushPublicDiscoveryManifestControl, {
					attempt: cycle,
					...(cycle > 1 ? { continuation: true } : {}),
					startedAt: NOW,
					token
				})
			).resolves.toEqual({ refreshed: false, retryScheduled: true, superseded: false });
			const durable = await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			expect(durable?.manifestControlPushToken).toBe(token);
		}

		await expect(
			t.action(internal.templates.pushPublicDiscoveryManifestControl, {
				attempt: 16,
				continuation: true,
				startedAt: NOW,
				token
			})
		).resolves.toEqual({ refreshed: true });
		expect(fetch).toHaveBeenCalledTimes(16);
		for (const [index, request] of fetch.mock.calls.entries()) {
			const headers = new Headers(request[1]?.headers);
			expect(headers.get('x-public-discovery-refresh-purpose')).toBe(
				index === 0 ? null : 'page-backfill-continuation'
			);
		}
		const completed = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(completed?.manifestControlPushToken).toBeUndefined();
		expect(completed).toMatchObject({
			manifestControlPushLastOutcome: 'succeeded',
			manifestControlPushLastOutcomeAttempt: 16,
			manifestControlPushLastOutcomeStartedAt: NOW
		});
	});

	it('recognizes only the exact trusted containment response and schedules zero retry', async () => {
		const t = convexTest({ schema, modules });
		const token = 'contained-publication-token';
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				manifestControlPushToken: token,
				relationsReady: true,
				relationsRevision: 1
			})
		);
		const fetch = vi.fn(
			async () =>
				new Response(PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_BODY, {
					headers: {
						'cache-control': 'no-store',
						'content-type': 'application/json; charset=utf-8',
						'x-public-discovery-manifest-refresh-contained': '1'
					},
					status: 503
				})
		);
		vi.stubGlobal('fetch', fetch);

		await expect(
			t.action(internal.templates.pushPublicDiscoveryManifestControl, {
				attempt: 1,
				startedAt: NOW,
				token
			})
		).resolves.toEqual({
			contained: true,
			refreshed: false,
			retryScheduled: false,
			superseded: false
		});
		expect(fetch).toHaveBeenCalledTimes(1);
		const durable = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(durable?.manifestControlPushToken).toBeUndefined();
		expect(durable).toMatchObject({
			manifestControlPushLastOutcome: 'contained',
			manifestControlPushLastOutcomeAt: NOW,
			manifestControlPushLastOutcomeAttempt: 1,
			manifestControlPushLastOutcomeStartedAt: NOW
		});
	});

	it('terminates a valid 202 chain at the producer attempt ceiling', async () => {
		const t = convexTest({ schema, modules });
		const token = 'exhausted-continuation-token';
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				manifestControlPushToken: token,
				relationsReady: true,
				relationsRevision: 1
			})
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response('{}', {
						headers: {
							'retry-after': '120',
							'x-public-discovery-page-backfill-continuation': '1',
							'x-public-discovery-refresh-gate-protocol': '3'
						},
						status: 202
					})
			)
		);

		await expect(
			t.action(internal.templates.pushPublicDiscoveryManifestControl, {
				attempt: PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS,
				continuation: true,
				startedAt: NOW,
				token
			})
		).resolves.toEqual({
			exhausted: true,
			outcome: 'attemptsExhausted',
			refreshed: false,
			retryScheduled: false,
			superseded: false
		});
		const durable = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(durable?.manifestControlPushToken).toBeUndefined();
		expect(durable?.manifestControlPushLastOutcome).toBe('attemptsExhausted');
	});

	it('does no network work once a nonlegacy producer chain reaches its age ceiling', async () => {
		const t = convexTest({ schema, modules });
		const token = 'age-exhausted-publication-token';
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				manifestControlPushToken: token,
				relationsReady: true,
				relationsRevision: 1
			})
		);
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);

		await expect(
			t.action(internal.templates.pushPublicDiscoveryManifestControl, {
				attempt: 2,
				startedAt: NOW - PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_AGE_MS,
				token
			})
		).resolves.toMatchObject({
			exhausted: true,
			outcome: 'ageExhausted',
			retryScheduled: false
		});
		expect(fetch).not.toHaveBeenCalled();
		const durable = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(durable?.manifestControlPushLastOutcome).toBe('ageExhausted');
		expect(durable?.manifestControlPushToken).toBeUndefined();
	});

	it('lets a racing successor token supersede a continuation without being overwritten', async () => {
		const t = convexTest({ schema, modules });
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				manifestControlPushToken: 'newer-publication-token',
				relationsReady: true,
				relationsRevision: 1
			})
		);

		await expect(
			t.mutation(internal.templates.requeuePublicDiscoveryManifestControlPush, {
				attempt: 2,
				delayMs: 121_000,
				startedAt: NOW,
				token: 'older-incomplete-token'
			})
		).resolves.toEqual({ requeued: false, superseded: true });
		await expect(
			t.mutation(internal.templates.requeuePublicDiscoveryManifestControlPush, {
				attempt: 1,
				outcome: 'contained',
				startedAt: NOW,
				token: 'older-incomplete-token'
			})
		).resolves.toEqual({ requeued: false, superseded: true });
		const durable = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(durable?.manifestControlPushToken).toBe('newer-publication-token');
		expect(durable?.manifestControlPushLastOutcome).toBe('contained');
	});

	it.each([
		['transport failure', () => Promise.reject(new Error('network unavailable'))],
		[
			'invalid 202 protocol',
			() => Promise.resolve(new Response('{}', { headers: { 'retry-after': '120' }, status: 202 }))
		],
		[
			'invalid 202 retry delay',
			() =>
				Promise.resolve(
					new Response('{}', {
						headers: {
							'retry-after': '999',
							'x-public-discovery-refresh-gate-protocol': '3'
						},
						status: 202
					})
				)
		],
		[
			'retryable server failure',
			() =>
				Promise.resolve(
					new Response('temporarily unavailable', {
						headers: { 'x-public-discovery-refresh-gate-protocol': '3' },
						status: 503
					})
				)
		],
		[
			'forged containment signal',
			() =>
				Promise.resolve(
					new Response('{"status":"maintenance","retry":false}\n', {
						headers: {
							'cache-control': 'no-store',
							'content-type': 'application/json; charset=utf-8',
							'x-public-discovery-manifest-refresh-contained': '1'
						},
						status: 503
					})
				)
		],
		['invalid success protocol', () => Promise.resolve(new Response('{}', { status: 200 }))]
	] as const)('restores the claimed token after %s', async (_label, response) => {
		const t = convexTest({ schema, modules });
		const token = 'failed-publication-token';
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				manifestControlPushToken: token,
				relationsReady: true,
				relationsRevision: 1
			})
		);
		vi.stubGlobal('fetch', vi.fn(response));

		await expect(
			t.action(internal.templates.pushPublicDiscoveryManifestControl, {
				attempt: 1,
				startedAt: NOW,
				token
			})
		).rejects.toThrow();
		const durable = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(durable?.manifestControlPushToken).toBe(token);
	});

	it('gives legacy and explicit final actions one terminal attempt instead of minting retries', async () => {
		const t = convexTest({ schema, modules });
		const token = 'legacy-publication-token';
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRevision: 1,
				manifestControlPushToken: token,
				relationsReady: true,
				relationsRevision: 1
			})
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new Error('legacy transport fault')))
		);

		await expect(
			t.action(internal.templates.pushPublicDiscoveryManifestControl, { token })
		).rejects.toThrow('legacy transport fault');
		const durable = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(durable?.manifestControlPushToken).toBeUndefined();
		expect(durable).toMatchObject({
			manifestControlPushLastOutcome: 'attemptsExhausted',
			manifestControlPushLastOutcomeAttempt: PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS,
			manifestControlPushLastOutcomeStartedAt: NOW
		});

		const boundedToken = 'bounded-final-publication-token';
		await t.run(async (ctx) => {
			const manifest = await ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique();
			if (!manifest) throw new Error('missing manifest fixture');
			await ctx.db.patch(manifest._id, { manifestControlPushToken: boundedToken });
		});
		await expect(
			t.action(internal.templates.pushPublicDiscoveryManifestControl, {
				attempt: PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS,
				startedAt: NOW - 1_000,
				token: boundedToken
			})
		).rejects.toThrow('legacy transport fault');
		const final = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(final?.manifestControlPushToken).toBeUndefined();
		expect(final).toMatchObject({
			manifestControlPushLastOutcome: 'attemptsExhausted',
			manifestControlPushLastOutcomeAttempt: PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS,
			manifestControlPushLastOutcomeStartedAt: NOW - 1_000
		});
	});
});
