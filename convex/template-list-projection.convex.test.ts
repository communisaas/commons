/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { getConvexSize, type Value } from 'convex/values';

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import {
	TEMPLATE_LIST_MAX_PAGE_BYTES,
	TEMPLATE_LIST_MAX_PROJECTION_VALUE_BYTES,
	TEMPLATE_LIST_MAX_STORED_ROW_BYTES,
	assertCompleteTemplateListPage
} from './lib/templateListProjection';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;

function newHarness(): Harness {
	return convexTest(schema, modules);
}

async function authenticatedUser(t: Harness, suffix: string) {
	const tokenIdentifier = `https://issuer.example|template-list-${suffix}`;
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
	return {
		userId,
		authenticated: t.withIdentity({
			subject: `template-list-${suffix}`,
			issuer: 'https://issuer.example',
			tokenIdentifier
		})
	};
}

function templateValue(index: number, userId: Id<'users'>) {
	return {
		userId,
		slug: `${String(index).padStart(3, '0')}-${'s'.repeat(396)}`,
		title: '🧱'.repeat(950),
		description: 'd'.repeat(8_000),
		domain: 'x'.repeat(200),
		topics: [],
		type: 'email',
		deliveryMethod: 'email' as const,
		preview: 'Preview',
		messageBody: 'Message',
		deliveryConfig: {},
		recipientConfig: {},
		status: 'draft',
		isPublic: false,
		verifiedSends: 0,
		uniqueDistricts: 0,
		embeddingVersion: 'test-v1',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		updatedAt: 1_900_000_000_000 + index
	};
}

async function migrateAndActivate(t: Harness) {
	let result: any = await t.mutation(internal.templates.migrateTemplateListProjection, {
		scheduleContinuation: false
	});
	while (result.status === 'running') {
		result = await t.mutation(internal.templates.migrateTemplateListProjection, {
			runToken: result.runToken,
			scheduleContinuation: false
		});
	}
	expect(result.status).toBe('migrated');
	const activated = await t.mutation(internal.templates.activateTemplateListProjection, {});
	expect(activated.status).toBe('ready');
	return result;
}

describe('authenticated template-list projection foundation', () => {
	it('fails closed before explicit migration activation', async () => {
		const t = newHarness();
		const { authenticated } = await authenticatedUser(t, 'cold');

		await expect(
			authenticated.query(api.users.getMyTemplatesPage, {
				paginationOpts: { numItems: 50, cursor: null }
			})
		).rejects.toThrow('TEMPLATE_LIST_PROJECTION_NOT_READY');
	});

	it('migrates in bounded pages and proves the exact 51-row lookahead byte bound', async () => {
		const t = newHarness();
		const { authenticated, userId } = await authenticatedUser(t, 'aggregate');
		await t.run(async (ctx) => {
			for (let index = 0; index < 51; index += 1) {
				await ctx.db.insert('templates', templateValue(index, userId));
			}
		});

		const migrated = await migrateAndActivate(t);
		expect(migrated).toMatchObject({ scanned: 51, projected: 51 });

		const proof = await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('templateListProjections')
				.withIndex('by_userId', (q) => q.eq('userId', userId))
				.collect();
			return {
				count: rows.length,
				aggregateBytes: rows.reduce(
					(total, row) => total + getConvexSize(row as unknown as Value),
					0
				),
				maxStoredRowBytes: Math.max(...rows.map((row) => getConvexSize(row as unknown as Value))),
				maxProjectionValueBytes: Math.max(...rows.map((row) => row.projectionBytes)),
				allTruncated: rows.every(
					(row) => row.titleTruncated && row.descriptionTruncated && !row.domainTruncated
				)
			};
		});
		expect(proof.count).toBe(51);
		expect(proof.aggregateBytes).toBeLessThanOrEqual(TEMPLATE_LIST_MAX_PAGE_BYTES);
		expect(proof.maxStoredRowBytes).toBeLessThanOrEqual(TEMPLATE_LIST_MAX_STORED_ROW_BYTES);
		expect(proof.maxProjectionValueBytes).toBeLessThanOrEqual(
			TEMPLATE_LIST_MAX_PROJECTION_VALUE_BYTES
		);
		expect(proof.allTruncated).toBe(true);

		const first = await authenticated.query(api.users.getMyTemplatesPage, {
			paginationOpts: { numItems: 50, cursor: null }
		});
		expect(first.page).toHaveLength(50);
		expect(first.isDone).toBe(false);
	});

	it('gates continuation reads throughout a coordinated multi-transaction clear', async () => {
		const t = newHarness();
		const { authenticated, userId } = await authenticatedUser(t, 'coordinated');
		await t.run(async (ctx) => {
			for (let index = 0; index < 6; index += 1) {
				await ctx.db.insert('templates', templateValue(index, userId));
			}
		});
		await migrateAndActivate(t);

		const first = await authenticated.query(api.users.getMyTemplatesPage, {
			paginationOpts: { numItems: 2, cursor: null }
		});
		expect(first.isDone).toBe(false);

		const coordinatedRebuildToken = 'template-list-coordinated-clear';
		await t.mutation(internal.seed.beginCoordinatedPublicDiscoveryRebuild, {
			coordinatedRebuildToken,
			kind: 'clearSeed'
		});
		const deleted = await t.mutation(internal.seed.clearTable, {
			table: 'templates',
			suppressDiscoveryRefresh: true,
			coordinatedRebuildToken
		});
		expect(deleted).toMatchObject({ deleted: 1, isDone: false });

		await expect(
			authenticated.query(api.users.getMyTemplatesPage, {
				paginationOpts: { numItems: 2, cursor: first.continueCursor }
			})
		).rejects.toThrow('PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED');
	});
});

describe('template-list pagination failure semantics', () => {
	it('turns SplitRequired into a coded no-progress failure', () => {
		const splitPage = {
			page: [] as Doc<'templateListProjections'>[],
			continueCursor: 'must-not-be-consumed',
			isDone: false,
			pageStatus: 'SplitRequired' as const,
			splitCursor: 'split-cursor'
		};
		expect(() => assertCompleteTemplateListPage(splitPage)).toThrow(
			'TEMPLATE_LIST_PAGE_SPLIT_REQUIRED'
		);
	});
});
