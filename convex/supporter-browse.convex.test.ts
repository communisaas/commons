/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import type { TransactionMetrics } from 'convex/server';

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { SUPPORTER_BROWSE_MIGRATION_KEY, SUPPORTER_BROWSE_VERSION } from './lib/supporterBrowse';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'supporter-browse-test-secret-32-byte-floor';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
type Harness = TestConvex<typeof schema>;
type BrowsePage = {
	supporters: Array<{ _id: Id<'supporters'> }>;
	nextCursor: string | null;
	hasMore: boolean;
};

function transactionMetrics(ctx: unknown): Promise<TransactionMetrics> {
	return (
		ctx as {
			meta: { getTransactionMetrics: () => Promise<TransactionMetrics> };
		}
	).meta.getTransactionMetrics();
}

async function orgFixture(t: Harness, suffix: string) {
	const tokenIdentifier = `https://issuer.example|supporter-browse-${suffix}`;
	const editorTokenIdentifier = `https://issuer.example|supporter-browse-editor-${suffix}`;
	const { orgId } = await t.run(async (ctx) => {
		const memberId = await ctx.db.insert('users', {
			tokenIdentifier,
			email: `member-${suffix}@example.test`,
			updatedAt: NOW,
			isVerified: true,
			authorityLevel: 1,
			trustTier: 1,
			trustScore: 10,
			reputationTier: 'novice',
			districtVerified: false,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 0,
			profileVisibility: 'private'
		});
		const editorId = await ctx.db.insert('users', {
			tokenIdentifier: editorTokenIdentifier,
			email: `editor-${suffix}@example.test`,
			updatedAt: NOW,
			isVerified: true,
			authorityLevel: 1,
			trustTier: 1,
			trustScore: 10,
			reputationTier: 'novice',
			districtVerified: false,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 0,
			profileVisibility: 'private'
		});
		const orgId = await ctx.db.insert('organizations', {
			name: `Supporter Browse ${suffix}`,
			slug: `supporter-browse-${suffix}`,
			maxSeats: 10,
			maxTemplatesMonth: 100,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			supporterCount: 0,
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', {
			userId: memberId,
			orgId,
			role: 'member',
			joinedAt: NOW
		});
		await ctx.db.insert('orgMemberships', {
			userId: editorId,
			orgId,
			role: 'editor',
			joinedAt: NOW
		});
		return { orgId };
	});
	return {
		orgId,
		slug: `supporter-browse-${suffix}`,
		member: t.withIdentity({
			subject: `supporter-browse-${suffix}`,
			issuer: 'https://issuer.example',
			tokenIdentifier
		}),
		editor: t.withIdentity({
			subject: `supporter-browse-editor-${suffix}`,
			issuer: 'https://issuer.example',
			tokenIdentifier: editorTokenIdentifier
		})
	};
}

function supporterValue(
	orgId: Id<'organizations'>,
	index: number,
	projected: boolean
): Omit<Doc<'supporters'>, '_id' | '_creationTime'> {
	const source = index % 5 === 0 ? 'csv' : 'organic';
	return {
		orgId,
		encryptedEmail: `ciphertext-${index}`,
		emailHash: `hash-${String(index).padStart(8, '0')}`,
		verified: index % 2 === 0,
		emailStatus: index % 3 === 0 ? 'subscribed' : 'bounced',
		smsStatus: 'none',
		source,
		...(projected
			? {
					browseSource: source,
					browseTagIds: [],
					supporterBrowseVersion: SUPPORTER_BROWSE_VERSION
				}
			: {}),
		updatedAt: NOW + index
	};
}

async function finishMigration(t: Harness, restart = false) {
	let result = (await t.mutation(internal.supporters.migrateSupporterBrowse, {
		restart,
		scheduleContinuation: false
	})) as { status: string; runToken: string; failureCode?: string | null };
	for (let attempt = 0; result.status === 'running' && attempt < 1_000; attempt += 1) {
		result = (await t.mutation(internal.supporters.migrateSupporterBrowse, {
			runToken: result.runToken,
			scheduleContinuation: false
		})) as typeof result;
	}
	if (result.status === 'blocked') return result;
	expect(result.status).toBe('migrated');
	await expect(t.mutation(internal.supporters.activateSupporterBrowse, {})).resolves.toMatchObject({
		status: 'ready'
	});
	return result;
}

async function markReady(t: Harness, cardinality: number): Promise<void> {
	await t.run(async (ctx) => {
		await ctx.db.insert('supporterBrowseMigrations', {
			key: SUPPORTER_BROWSE_MIGRATION_KEY,
			status: 'ready',
			runToken: 'large-fixture-ready',
			phase: 'complete',
			scanned: cardinality,
			projected: cardinality,
			startedAt: NOW,
			completedAt: NOW,
			updatedAt: NOW
		});
	});
}

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('supporter browse durable cutover', () => {
	it('fails closed, migrates legacy rows and links exactly once, then activates', async () => {
		const t = convexTest(schema, modules);
		const fixture = await orgFixture(t, 'migration');
		const { supporterIds, tagId } = await t.run(async (ctx) => {
			const supporterIds: Array<Id<'supporters'>> = [];
			for (let index = 0; index < 3; index += 1) {
				supporterIds.push(
					await ctx.db.insert('supporters', supporterValue(fixture.orgId, index, false))
				);
			}
			const tagId = await ctx.db.insert('tags', {
				orgId: fixture.orgId,
				name: 'Volunteer'
			});
			await ctx.db.insert('supporterTags', { supporterId: supporterIds[0], tagId });
			await ctx.db.insert('supporterTags', { supporterId: supporterIds[1], tagId });
			await ctx.db.patch(fixture.orgId, { supporterCount: supporterIds.length });
			return { supporterIds, tagId };
		});

		await expect(
			fixture.member.query(api.supporters.list, {
				orgSlug: fixture.slug,
				paginationOpts: { cursor: null, numItems: 50 }
			})
		).rejects.toThrow('SUPPORTER_BROWSE_NOT_READY');

		await finishMigration(t);
		const memberPage = await fixture.member.query(api.supporters.list, {
			orgSlug: fixture.slug,
			paginationOpts: { cursor: null, numItems: 50 }
		});
		expect(memberPage.hasMore).toBe(false);
		expect(memberPage.supporters).toHaveLength(3);
		expect(memberPage.supporters.every((row) => row.emailHash === null)).toBe(true);
		const editorPage = await fixture.editor.query(api.supporters.list, {
			orgSlug: fixture.slug,
			paginationOpts: { cursor: null, numItems: 50 }
		});
		expect(editorPage.supporters).toHaveLength(3);
		expect(editorPage.supporters.every((row) => typeof row.emailHash === 'string')).toBe(true);
		await expect(
			fixture.editor.query(api.supporters.list, {
				orgSlug: fixture.slug,
				paginationOpts: { cursor: null, numItems: 50 },
				filters: { tagId }
			})
		).rejects.toThrow('SUPPORTER_TAG_BROWSE_PROJECTION_NOT_READY');

		const afterFirst = await t.run(async (ctx) => ({
			tag: await ctx.db.get(tagId),
			supporters: await Promise.all(supporterIds.map((id) => ctx.db.get(id)))
		}));
		expect(afterFirst.tag).toMatchObject({
			nameKey: 'volunteer',
			supporterCount: 2
		});
		expect(afterFirst.supporters.every((row) => row?.supporterBrowseVersion === 1)).toBe(true);
		expect(afterFirst.supporters[0]?.browseTagIds).toEqual([tagId]);

		// Restart is destructive to readiness but idempotent to marked link counts.
		await finishMigration(t, true);
		await expect(t.run((ctx) => ctx.db.get(tagId))).resolves.toMatchObject({ supporterCount: 2 });
		await expect(
			t.query(internal.supporters.supporterBrowseMigrationStatus, {})
		).resolves.toMatchObject({
			status: 'ready',
			phase: 'complete',
			cursor: null,
			failureCode: null
		});
	});

	it('blocks legacy fan-out above the product envelope and keeps readers closed', async () => {
		const t = convexTest(schema, modules);
		const fixture = await orgFixture(t, 'fanout');
		await t.run(async (ctx) => {
			const supporterId = await ctx.db.insert(
				'supporters',
				supporterValue(fixture.orgId, 0, false)
			);
			for (let index = 0; index < 101; index += 1) {
				const tagId = await ctx.db.insert('tags', {
					orgId: fixture.orgId,
					name: `Tag ${String(index).padStart(3, '0')}`
				});
				await ctx.db.insert('supporterTags', { supporterId, tagId });
			}
		});

		const result = await finishMigration(t);
		expect(result).toMatchObject({
			status: 'blocked',
			failureCode: 'SUPPORTER_TAG_LIMIT_EXCEEDED'
		});
		await expect(
			fixture.member.query(api.supporters.list, {
				orgSlug: fixture.slug,
				paginationOpts: { cursor: null, numItems: 50 }
			})
		).rejects.toThrow('SUPPORTER_TAG_LIMIT_EXCEEDED');
	});

	it('keeps every 100-row page bounded and traverses 10005 rows without a rebuilt window', async () => {
		const t = convexTest(schema, modules);
		const fixture = await orgFixture(t, 'large');
		const cardinality = 10_005;
		const writeBatch = 250;
		for (let start = 0; start < cardinality; start += writeBatch) {
			await t.run(async (ctx) => {
				for (let index = start; index < Math.min(cardinality, start + writeBatch); index += 1) {
					await ctx.db.insert('supporters', supporterValue(fixture.orgId, index, true));
				}
			});
		}
		await t.run((ctx) => ctx.db.patch(fixture.orgId, { supporterCount: cardinality }));
		await markReady(t, cardinality);

		const observed = await fixture.member.query(async (ctx) => {
			const value = await ctx.runQuery(api.supporters.list, {
				orgSlug: fixture.slug,
				paginationOpts: { cursor: null, numItems: 100 }
			});
			return { value, metrics: await transactionMetrics(ctx) };
		});
		expect(observed.value.supporters).toHaveLength(100);
		expect(observed.metrics.documentsRead.used).toBeLessThanOrEqual(106);
		expect(observed.metrics.databaseQueries.used).toBeLessThanOrEqual(5);
		expect(observed.metrics.bytesRead.used).toBeLessThan(512_000);

		let cursor: string | null = null;
		const seen = new Set<string>();
		do {
			const result: BrowsePage = await fixture.member.query(api.supporters.list, {
				orgSlug: fixture.slug,
				paginationOpts: { cursor, numItems: 100 }
			});
			for (const supporter of result.supporters) {
				expect(seen.has(String(supporter._id))).toBe(false);
				seen.add(String(supporter._id));
			}
			cursor = result.nextCursor;
			if (!result.hasMore) expect(cursor).toBeNull();
		} while (cursor !== null);
		expect(seen.size).toBe(cardinality);

		// The most selective compound branch is still a real database cursor.
		let filteredCursor: string | null = null;
		let filteredCount = 0;
		do {
			const result: BrowsePage = await fixture.member.query(api.supporters.list, {
				orgSlug: fixture.slug,
				paginationOpts: { cursor: filteredCursor, numItems: 73 },
				filters: { verified: true, emailStatus: 'subscribed', source: 'csv' }
			});
			filteredCount += result.supporters.length;
			filteredCursor = result.nextCursor;
		} while (filteredCursor !== null);
		const expectedFiltered = Array.from({ length: cardinality }, (_, index) => index).filter(
			(index) => index % 2 === 0 && index % 3 === 0 && index % 5 === 0
		).length;
		expect(filteredCount).toBe(expectedFiltered);

		const v1 = await t.query(api.v1api.listSupporters, {
			_secret: SECRET,
			orgId: fixture.orgId,
			limit: 50
		});
		expect(v1.items).toHaveLength(50);
		expect(v1.hasMore).toBe(true);
		expect(v1.cursor).toEqual(expect.any(String));
		expect(v1.total).toBe(cardinality);
		expect(v1).not.toHaveProperty('scanLimit');
		expect(v1).not.toHaveProperty('truncated');

		const filteredV1 = await t.query(api.v1api.listSupporters, {
			_secret: SECRET,
			orgId: fixture.orgId,
			limit: 50,
			verified: true
		});
		expect(filteredV1.total).toBeUndefined();
	}, 120_000);

	it('fails a People/API page closed before one oversized row can exceed 512 KiB', async () => {
		const t = convexTest(schema, modules);
		const fixture = await orgFixture(t, 'byte-bound');
		await t.run(async (ctx) => {
			await ctx.db.insert('supporters', {
				...supporterValue(fixture.orgId, 1, true),
				encryptedCustomFields: 'x'.repeat(600 * 1024)
			});
			await ctx.db.patch(fixture.orgId, { supporterCount: 1 });
		});
		await markReady(t, 1);

		await expect(
			fixture.editor.query(api.supporters.list, {
				orgSlug: fixture.slug,
				paginationOpts: { cursor: null, numItems: 100 }
			})
		).rejects.toThrow('SUPPORTER_PAGE_SPLIT_REQUIRED');
	});
});
