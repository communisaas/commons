/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type Harness = TestConvex<typeof schema>;
type TemplateValue = Omit<Doc<'templates'>, '_id' | '_creationTime'>;

function newHarness(): Harness {
	return convexTest(schema, modules);
}

function baseUser(tokenIdentifier: string): Omit<Doc<'users'>, '_id' | '_creationTime'> {
	return {
		tokenIdentifier,
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
	};
}

function templateValue(userId: Id<'users'>, overrides: Partial<TemplateValue> = {}): TemplateValue {
	return {
		slug: 'source-cache-template',
		title: 'Source cache template',
		description: 'Source cache boundary fixture',
		domain: 'civic',
		topics: ['water'],
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
		userId,
		...overrides
	};
}

function evaluatedSource(num: number, title: string) {
	return {
		num,
		title,
		url: `https://example.com/source-${num}`,
		type: 'journalism',
		snippet: `${title} snippet`,
		relevance: `${title} relevance`,
		excerpt: `${title} excerpt`,
		credibility_rationale: `${title} credibility`,
		incentive_position: 'neutral',
		source_order: 'secondary'
	};
}

async function seedTemplate(t: Harness, overrides: Partial<TemplateValue> = {}) {
	const authorToken = 'https://issuer.example|source-cache-author';
	const otherToken = 'https://issuer.example|source-cache-other';
	const seeded = await t.run(async (ctx) => {
		const authorId = await ctx.db.insert('users', baseUser(authorToken));
		const otherId = await ctx.db.insert('users', baseUser(otherToken));
		const templateId = await ctx.db.insert('templates', templateValue(authorId, overrides));
		return { authorId, otherId, templateId };
	});

	return {
		...seeded,
		author: t.withIdentity({
			subject: 'source-cache-author',
			issuer: 'https://issuer.example',
			tokenIdentifier: authorToken
		}),
		other: t.withIdentity({
			subject: 'source-cache-other',
			issuer: 'https://issuer.example',
			tokenIdentifier: otherToken
		})
	};
}

async function persistedCacheFields(t: Harness, templateId: Id<'templates'>) {
	return t.run(async (ctx) => {
		const row = await ctx.db.get(templateId);
		return {
			cachedSources: row?.cachedSources,
			sourcesCachedAt: row?.sourcesCachedAt,
			sourceCacheInputHash: row?.sourceCacheInputHash
		};
	});
}

describe('templates source cache', () => {
	it('rejects non-author writes and leaves the row unchanged', async () => {
		const t = newHarness();
		const existing = {
			cachedSources: [evaluatedSource(1, 'Existing')],
			sourcesCachedAt: 1_800_000_000_000,
			sourceCacheInputHash: '1'.repeat(64)
		};
		const { other, templateId } = await seedTemplate(t, existing);

		await expect(
			other.mutation(api.templates.updateSourceCache, {
				templateId,
				cachedSources: [evaluatedSource(2, 'Replacement')],
				sourcesCachedAt: 1_800_000_060_000,
				sourceCacheInputHash: '2'.repeat(64)
			})
		).rejects.toThrow('TEMPLATE_SOURCE_CACHE_FORBIDDEN');

		await expect(persistedCacheFields(t, templateId)).resolves.toEqual(existing);
	});

	it('rejects invalid input hashes and leaves the row unchanged', async () => {
		const t = newHarness();
		const existing = {
			cachedSources: [evaluatedSource(1, 'Existing')],
			sourcesCachedAt: 1_800_000_000_000,
			sourceCacheInputHash: '3'.repeat(64)
		};
		const { author, templateId } = await seedTemplate(t, existing);

		await expect(
			author.mutation(api.templates.updateSourceCache, {
				templateId,
				cachedSources: [evaluatedSource(2, 'Replacement')],
				sourcesCachedAt: 1_800_000_060_000,
				sourceCacheInputHash: 'not-a-sha256'
			})
		).rejects.toThrow('TEMPLATE_SOURCE_CACHE_INPUT_HASH_INVALID');

		await expect(persistedCacheFields(t, templateId)).resolves.toEqual(existing);
	});

	it('lets the author store a valid cache and read it back', async () => {
		const t = newHarness();
		const { author, templateId } = await seedTemplate(t);
		const cachedSources = [evaluatedSource(1, 'Fresh')];
		const sourcesCachedAt = 1_800_000_120_000;
		const sourceCacheInputHash = 'a'.repeat(64);

		await author.mutation(api.templates.updateSourceCache, {
			templateId,
			cachedSources,
			sourcesCachedAt,
			sourceCacheInputHash
		});

		await expect(t.query(api.templates.getSourceCache, { templateId })).resolves.toEqual({
			cachedSources,
			sourcesCachedAt,
			sourceCacheInputHash
		});
	});
});
