/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'legislation-rescore-scope-test-secret';
const TOKEN_IDENTIFIER = 'https://issuer.example|legislation-rescore-editor';
const EMBEDDING = Array.from({ length: 768 }, () => 0.125);
type Harness = TestConvex<typeof schema>;

async function insertOrganization(
	t: Harness,
	input: { name: string; slug: string }
): Promise<Id<'organizations'>> {
	return await t.run((ctx) =>
		ctx.db.insert('organizations', {
			name: input.name,
			slug: input.slug,
			maxSeats: 10,
			maxTemplatesMonth: 100,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: false,
			updatedAt: Date.now()
		})
	);
}

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('organization-scoped legislation rescoring', () => {
	it('filters vector work and relevance writes to the authorized organization', async () => {
		const t = convexTest({ schema, modules });
		const orgA = await insertOrganization(t, { name: 'Organization A', slug: 'organization-a' });
		const orgB = await insertOrganization(t, { name: 'Organization B', slug: 'organization-b' });
		const billId = await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', {
				tokenIdentifier: TOKEN_IDENTIFIER,
				updatedAt: Date.now(),
				isVerified: true,
				authorityLevel: 1,
				trustTier: 1,
				trustScore: 0,
				reputationTier: 'new',
				districtVerified: false,
				templatesContributed: 0,
				templateAdoptionRate: 0,
				peerEndorsements: 0,
				activeMonths: 0,
				profileVisibility: 'private'
			});
			await ctx.db.insert('orgMemberships', {
				userId,
				orgId: orgA,
				role: 'editor',
				joinedAt: Date.now()
			});
			await ctx.db.insert('orgIssueDomains', {
				orgId: orgA,
				label: 'A climate domain',
				embedding: EMBEDDING,
				weight: 1,
				updatedAt: Date.now()
			});
			// This equally similar B domain would be hydrated and written by the
			// former unfiltered top-50 search.
			await ctx.db.insert('orgIssueDomains', {
				orgId: orgB,
				label: 'B private domain',
				embedding: EMBEDDING,
				weight: 1,
				updatedAt: Date.now()
			});
			return await ctx.db.insert('bills', {
				externalId: 'scope-test-1',
				jurisdiction: 'us-federal',
				jurisdictionLevel: 'federal',
				title: 'Scoped relevance test bill',
				status: 'introduced',
				statusDate: Date.now(),
				committees: [],
				sourceUrl: 'https://example.test/bill/scope-test-1',
				topicEmbedding: EMBEDDING,
				topics: ['climate'],
				entities: [],
				updatedAt: Date.now()
			});
		});

		const editor = t.withIdentity({ tokenIdentifier: TOKEN_IDENTIFIER });
		await expect(
			editor.action(api.legislation.rescoreBills, {
				_secret: SECRET,
				slug: 'organization-a',
				billIds: [billId]
			})
		).resolves.toMatchObject({ billsScored: 1, rowsUpserted: 1 });

		await t.run(async (ctx) => {
			const rows = await ctx.db.query('orgBillRelevances').collect();
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				orgId: orgA,
				billId,
				matchedOn: ['A climate domain']
			});
			expect(rows.some((row) => row.orgId === orgB)).toBe(false);
		});
	});
});
