/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'private-template-query-secret-32-bytes';
type Harness = TestConvex<typeof schema>;

function harness(): Harness {
	return convexTest({ schema, modules });
}

async function userFixture(t: Harness, suffix: string) {
	const tokenIdentifier = `https://issuer.example|private-query-${suffix}`;
	const userId = await t.run((ctx) =>
		ctx.db.insert('users', {
			tokenIdentifier,
			updatedAt: 1,
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
			subject: `private-query-${suffix}`,
			issuer: 'https://issuer.example',
			tokenIdentifier
		})
	};
}

function templateValue(userId: Id<'users'>, suffix: string) {
	return {
		userId,
		slug: `private-query-${suffix}`,
		title: `Private query ${suffix}`,
		description: 'Exact indexed lookup fixture',
		domain: 'civic',
		category: 'General',
		topics: ['efficiency'],
		type: 'email',
		deliveryMethod: 'email',
		preview: 'Preview',
		messageBody: 'Message',
		sources: ['source'],
		researchLog: ['research'],
		deliveryConfig: {},
		cwcConfig: {},
		recipientConfig: {},
		contentHash: `hash-${suffix}`,
		status: 'draft',
		isPublic: false,
		verifiedSends: 0,
		uniqueDistricts: 0,
		topicEmbedding: Array.from({ length: 768 }, () => 0.5),
		embeddingVersion: 'test-v1',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		updatedAt: 2
	};
}

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('private template query boundaries', () => {
	it('uses the exact user/content-hash index and returns only caller-consumed fields', async () => {
		const t = harness();
		const owner = await userFixture(t, 'owner');
		const other = await userFixture(t, 'other');
		await t.run((ctx) => ctx.db.insert('templates', templateValue(owner.userId, 'owner')));

		await expect(
			owner.authenticated.query(api.templates.findByContentHash, {
				userId: String(other.userId),
				contentHash: 'hash-owner'
			})
		).rejects.toThrow('TEMPLATE_CONTENT_HASH_USER_MISMATCH');

		const result = await owner.authenticated.query(api.templates.findByContentHash, {
			userId: String(owner.userId),
			contentHash: 'hash-owner'
		});
		expect(result).not.toBeNull();
		expect(result).not.toHaveProperty('topicEmbedding');
		expect(result).not.toHaveProperty('tagEmbeddings');
		expect(Object.keys(result!).sort()).toEqual(
			[
				'_creationTime',
				'_id',
				'category',
				'cwcConfig',
				'deliveryConfig',
				'deliveryMethod',
				'description',
				'domain',
				'isPublic',
				'messageBody',
				'preview',
				'recipientConfig',
				'researchLog',
				'slug',
				'sources',
				'status',
				'title',
				'topics',
				'type',
				'uniqueDistricts',
				'updatedAt',
				'verifiedSends'
			].sort()
		);
	});

	it('binds source-cache reads and writes to the secret, authenticated user, and owner', async () => {
		const t = harness();
		const owner = await userFixture(t, 'cache-owner');
		const other = await userFixture(t, 'cache-other');
		const templateId = await t.run((ctx) =>
			ctx.db.insert('templates', templateValue(owner.userId, 'cache-owner'))
		);
		const otherTemplateId = await t.run((ctx) =>
			ctx.db.insert('templates', templateValue(other.userId, 'cache-other'))
		);
		const cachedSources = [
			{
				num: 1,
				title: 'Bounded source',
				url: 'https://example.test/source',
				type: 'research',
				excerpt: 'Evidence',
				incentive_position: 'neutral'
			}
		];

		await expect(
			owner.authenticated.mutation(api.templates.updateSourceCache, {
				_secret: 'wrong-secret',
				userId: owner.userId,
				templateId,
				cachedSources,
				sourcesCachedAt: 10
			})
		).rejects.toThrow('Unauthorized');
		await expect(
			owner.authenticated.mutation(api.templates.updateSourceCache, {
				_secret: SECRET,
				userId: other.userId,
				templateId,
				cachedSources,
				sourcesCachedAt: 10
			})
		).rejects.toThrow('TEMPLATE_SOURCE_CACHE_USER_MISMATCH');
		await expect(
			owner.authenticated.mutation(api.templates.updateSourceCache, {
				_secret: SECRET,
				userId: owner.userId,
				templateId: otherTemplateId,
				cachedSources,
				sourcesCachedAt: 10
			})
		).rejects.toThrow('TEMPLATE_SOURCE_CACHE_NOT_OWNED');

		await owner.authenticated.mutation(api.templates.updateSourceCache, {
			_secret: SECRET,
			userId: owner.userId,
			templateId,
			cachedSources,
			sourcesCachedAt: 10
		});
		await expect(
			owner.authenticated.query(api.templates.getSourceCache, {
				_secret: SECRET,
				userId: owner.userId,
				templateId
			})
		).resolves.toEqual({ cachedSources, sourcesCachedAt: 10 });
		await expect(
			other.authenticated.query(api.templates.getSourceCache, {
				_secret: SECRET,
				userId: other.userId,
				templateId
			})
		).rejects.toThrow('TEMPLATE_SOURCE_CACHE_NOT_OWNED');
	});

	it('rejects malformed and oversized source caches atomically', async () => {
		const t = harness();
		const owner = await userFixture(t, 'cache-budget');
		const templateId = await t.run((ctx) =>
			ctx.db.insert('templates', templateValue(owner.userId, 'cache-budget'))
		);

		for (const cachedSources of [
			{},
			Array.from({ length: 21 }, () => ({ title: 'too many' })),
			[{ excerpt: 'x'.repeat(70_000) }]
		]) {
			await expect(
				owner.authenticated.mutation(api.templates.updateSourceCache, {
					_secret: SECRET,
					userId: owner.userId,
					templateId,
					cachedSources,
					sourcesCachedAt: 10
				})
			).rejects.toThrow(/TEMPLATE_SOURCE_CACHE_(INVALID_STRUCTURE|BUDGET_EXCEEDED)/);
		}

		const unchanged = await t.run((ctx) => ctx.db.get(templateId));
		expect(unchanged).not.toHaveProperty('cachedSources');
		expect(unchanged).not.toHaveProperty('sourcesCachedAt');
	});

	it('authorizes CWC verification by secret, expected identity, owner, and strict fields', async () => {
		const t = harness();
		const owner = await userFixture(t, 'cwc-owner');
		const other = await userFixture(t, 'cwc-other');
		const templateId = await t.run((ctx) =>
			ctx.db.insert('templates', {
				...templateValue(owner.userId, 'cwc-owner'),
				status: 'published',
				isPublic: true
			})
		);
		const valid = {
			_secret: SECRET,
			expectedUserId: owner.userId,
			templateId,
			verificationStatus: 'verified',
			countryCode: 'US',
			reputationApplied: true
		};

		await expect(
			owner.authenticated.mutation(api.templates.setCwcVerification, {
				...valid,
				_secret: undefined
			})
		).rejects.toThrow('Unauthorized');
		await expect(
			owner.authenticated.mutation(api.templates.setCwcVerification, {
				...valid,
				expectedUserId: other.userId
			})
		).rejects.toThrow('CWC_VERIFICATION_EXPECTED_USER_MISMATCH');
		await expect(
			other.authenticated.mutation(api.templates.setCwcVerification, {
				...valid,
				expectedUserId: other.userId
			})
		).rejects.toThrow('CWC_VERIFICATION_TEMPLATE_NOT_OWNED');
		await expect(
			owner.authenticated.mutation(api.templates.setCwcVerification, {
				...valid,
				verificationStatus: 'anything'
			})
		).rejects.toThrow('CWC_VERIFICATION_STATUS_INVALID');
		await expect(
			owner.authenticated.mutation(api.templates.setCwcVerification, {
				...valid,
				countryCode: 'usa'
			})
		).rejects.toThrow('CWC_VERIFICATION_COUNTRY_CODE_INVALID');

		const before = await t.run((ctx) => ctx.db.get(templateId));
		expect(before).not.toHaveProperty('verificationStatus');
		await expect(
			owner.authenticated.mutation(api.templates.setCwcVerification, valid)
		).resolves.toBeNull();
		await expect(t.run((ctx) => ctx.db.get(templateId))).resolves.toMatchObject({
			verificationStatus: 'verified',
			countryCode: 'US',
			reputationApplied: true
		});
	});
});
