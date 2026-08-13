/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';

import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const VECTOR = Array.from({ length: 768 }, (_, index) => index / 768);
const SECRET = 'projection-writer-secret-32-bytes';

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('template compact-projection writers', () => {
	it('updates metadata without rewriting unchanged topic or tag vectors', async () => {
		const t = convexTest({ schema, modules });
		const tokenIdentifier = 'https://issuer.example|projection-writer';
		const { templateId, userId } = await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', {
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
			});
			const templateId = await ctx.db.insert('templates', {
				userId,
				slug: 'projection-writer',
				title: 'Projection writer',
				description: 'Projection-only metadata fixture',
				domain: 'old-domain',
				topics: ['old-topic'],
				type: 'email',
				deliveryMethod: 'cwc',
				preview: 'Preview',
				messageBody: 'Message',
				deliveryConfig: {},
				recipientConfig: {},
				cachedSources: [{ title: 'stale evidence' }],
				sourcesCachedAt: Date.now(),
				sourceCacheInputHash: 'a'.repeat(64),
				status: 'published',
				isPublic: true,
				verifiedSends: 0,
				uniqueDistricts: 0,
				endorsementCount: 0,
				topicEmbedding: VECTOR,
				tagEmbeddings: [{ tag: 'old-topic', embedding: VECTOR }],
				embeddingVersion: 'test-v1',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: Date.now()
			});
			return { templateId, userId };
		});

		const migrated = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
			scheduleContinuation: false
		});
		expect(migrated.status).toBe('migrated');
		await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});

		const vectorIdentity = await t.run(async (ctx) => {
			const topic = await ctx.db
				.query('publicTemplateTopicVectors')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.unique();
			const tag = await ctx.db
				.query('publicTagEmbeddingVectors')
				.withIndex('by_tag', (q) => q.eq('tag', 'old-topic'))
				.unique();
			expect(topic).not.toBeNull();
			expect(tag).not.toBeNull();
			await ctx.db.patch(topic!._id, { updatedAt: 101 });
			await ctx.db.patch(tag!._id, { updatedAt: 202 });
			return { topicId: topic!._id, tagId: tag!._id };
		});

		const authenticated = t.withIdentity({
			subject: 'projection-writer',
			issuer: 'https://issuer.example',
			tokenIdentifier
		});
		await authenticated.mutation(api.templates.patchMetadata, {
			templateId,
			domain: 'new-domain',
			topics: ['new-topic']
		});
		await authenticated.mutation(api.templates.setCwcVerification, {
			_secret: SECRET,
			expectedUserId: userId,
			templateId,
			verificationStatus: 'verified',
			countryCode: 'US',
			reputationApplied: true
		});
		await t.mutation(internal.templates._patchDomainHue, {
			templateId,
			domainHue: 42
		});

		await t.run(async (ctx) => {
			const source = await ctx.db
				.query('publicTemplateDiscoverySources')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.unique();
			expect(source?.source).toMatchObject({
				domain: 'new-domain',
				topics: ['new-topic'],
				countryCode: 'US',
				domainHue: 42
			});

			const topic = await ctx.db.get(vectorIdentity.topicId);
			const tag = await ctx.db.get(vectorIdentity.tagId);
			const template = await ctx.db.get(templateId);
			expect(topic).toMatchObject({ _id: vectorIdentity.topicId, updatedAt: 101 });
			expect(tag).toMatchObject({ _id: vectorIdentity.tagId, updatedAt: 202 });
			expect(template).not.toHaveProperty('cachedSources');
			expect(template).not.toHaveProperty('sourcesCachedAt');
			expect(template).not.toHaveProperty('sourceCacheInputHash');
		});
	});
});
