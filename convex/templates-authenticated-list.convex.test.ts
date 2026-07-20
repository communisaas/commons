/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;

function newHarness(): Harness {
	return convexTest(schema, modules);
}

async function migrateAndActivateTemplateListProjection(t: Harness) {
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
	await t.mutation(internal.templates.activateTemplateListProjection, {});
}

async function authenticatedFixture(t: Harness) {
	const tokenIdentifier = 'https://issuer.example|bounded-template-list';
	const email = 'bounded-template-list@example.test';
	const userId = await t.run((ctx) =>
		ctx.db.insert('users', {
			tokenIdentifier,
			email,
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
	const orgId = await t.run((ctx) =>
		ctx.db.insert('organizations', {
			name: 'Bounded Template List Org',
			slug: 'bounded-template-list-org',
			maxSeats: 10,
			maxTemplatesMonth: 1_000,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: true,
			updatedAt: Date.now()
		})
	);
	await t.run((ctx) =>
		ctx.db.insert('orgMemberships', {
			userId,
			orgId,
			role: 'member',
			joinedAt: Date.now()
		})
	);
	return {
		userId,
		orgId,
		authenticated: t.withIdentity({
			subject: 'bounded-template-list',
			issuer: 'https://issuer.example',
			tokenIdentifier,
			email
		})
	};
}

function templateValue(index: number, userId: Id<'users'>, orgId: Id<'organizations'>) {
	return {
		slug: `bounded-template-${String(index).padStart(3, '0')}`,
		title: `Bounded template ${String(index).padStart(3, '0')}`,
		description: 'Compact authenticated list projection fixture',
		domain: 'civic',
		topics: [],
		type: 'email',
		deliveryMethod: 'email',
		preview: 'Preview',
		messageBody: 'Message',
		deliveryConfig: {},
		recipientConfig: {},
		status: 'draft',
		isPublic: false,
		verifiedSends: 0,
		uniqueDistricts: 0,
		topicEmbedding: index === 0 ? Array.from({ length: 768 }, () => 0.25) : undefined,
		embeddingVersion: 'test-v1',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		userId,
		orgId,
		updatedAt: 1_800_000_000_000 + index
	};
}

describe('bounded authenticated template lists', () => {
	it('preserves legacy array results exactly when the whole range fits the bound', async () => {
		const t = newHarness();
		const { authenticated, userId, orgId } = await authenticatedFixture(t);
		await t.run(async (ctx) => {
			for (const index of [2, 0, 1]) {
				await ctx.db.insert('templates', templateValue(index, userId, orgId));
			}
		});
		await migrateAndActivateTemplateListProjection(t);

		const byUser = await authenticated.query(api.templates.listByUser, {});
		expect(byUser).toHaveLength(3);
		expect(byUser[0]).not.toHaveProperty('topicEmbedding');

		const byOrg = await authenticated.query(api.templates.listByOrg, {
			slug: 'bounded-template-list-org'
		});
		expect(byOrg.map(({ title }) => title)).toEqual([
			'Bounded template 000',
			'Bounded template 001',
			'Bounded template 002'
		]);
	});

	it('paginates user and org ranges while legacy array contracts fail explicitly on overflow', async () => {
		const t = newHarness();
		const { authenticated, userId, orgId } = await authenticatedFixture(t);
		await t.run(async (ctx) => {
			for (let index = 0; index < 55; index += 1) {
				await ctx.db.insert('templates', templateValue(index, userId, orgId));
			}
		});
		await migrateAndActivateTemplateListProjection(t);

		await expect(authenticated.query(api.templates.listByUser, {})).rejects.toThrow(
			'TEMPLATE_LIST_PAGINATION_REQUIRED'
		);
		await expect(
			authenticated.query(api.templates.listByOrg, { slug: 'bounded-template-list-org' })
		).rejects.toThrow('TEMPLATE_LIST_PAGINATION_REQUIRED');

		const userFirst = await authenticated.query(api.templates.listByUserPage, {
			paginationOpts: { numItems: 500, cursor: null }
		});
		expect(userFirst.page).toHaveLength(50);
		expect(userFirst.isDone).toBe(false);
		expect(userFirst.page[0]).not.toHaveProperty('topicEmbedding');

		const userSecond = await authenticated.query(api.templates.listByUserPage, {
			paginationOpts: { numItems: 50, cursor: userFirst.continueCursor }
		});
		expect(userSecond.page).toHaveLength(5);
		expect(userSecond.isDone).toBe(true);

		const orgFirst = await authenticated.query(api.templates.listByOrgPage, {
			slug: 'bounded-template-list-org',
			paginationOpts: { numItems: 500, cursor: null }
		});
		expect(orgFirst.page).toHaveLength(50);
		expect(orgFirst.isDone).toBe(false);
		expect(Object.keys(orgFirst.page[0]).sort()).toEqual(['_id', 'title']);

		const orgSecond = await authenticated.query(api.templates.listByOrgPage, {
			slug: 'bounded-template-list-org',
			paginationOpts: { numItems: 50, cursor: orgFirst.continueCursor }
		});
		expect(orgSecond.page).toHaveLength(5);
		expect(orgSecond.isDone).toBe(true);
	});

	it('rejects invalid page sizes before reading the template range', async () => {
		const t = newHarness();
		const { authenticated } = await authenticatedFixture(t);
		await migrateAndActivateTemplateListProjection(t);

		await expect(
			authenticated.query(api.templates.listByUserPage, {
				paginationOpts: { numItems: 0, cursor: null }
			})
		).rejects.toThrow('INVALID_TEMPLATE_LIST_PAGE_SIZE');
	});
});
