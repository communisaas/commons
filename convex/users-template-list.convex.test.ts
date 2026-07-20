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

async function authenticatedUser(t: Harness) {
	const tokenIdentifier = 'https://issuer.example|profile-template-list';
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
			subject: 'profile-template-list',
			issuer: 'https://issuer.example',
			tokenIdentifier
		})
	};
}

function templateValue(index: number, userId: Id<'users'>) {
	return {
		slug: `profile-template-${String(index).padStart(3, '0')}`,
		title: `Profile template ${String(index).padStart(3, '0')}`,
		description: 'Profile template pagination fixture',
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
		updatedAt: 1_800_000_000_000 + index
	};
}

describe('users authored-template pagination', () => {
	it('keeps the deprecated compact array exact for a bounded account', async () => {
		const t = newHarness();
		const { authenticated, userId } = await authenticatedUser(t);
		await t.run(async (ctx) => {
			for (let index = 0; index < 3; index += 1) {
				await ctx.db.insert('templates', templateValue(index, userId));
			}
		});
		await migrateAndActivateTemplateListProjection(t);

		const legacy = await authenticated.query(api.users.getMyTemplates, {});
		expect(legacy).toHaveLength(3);
		expect(legacy[0]).not.toHaveProperty('topicEmbedding');
		expect(legacy[0]).not.toHaveProperty('deliveryConfig');
		expect(legacy[0]).not.toHaveProperty('recipientConfig');
	});

	it('paginates compact projections and explicitly rejects legacy overflow', async () => {
		const t = newHarness();
		const { authenticated, userId } = await authenticatedUser(t);
		await t.run(async (ctx) => {
			for (let index = 0; index < 55; index += 1) {
				await ctx.db.insert('templates', templateValue(index, userId));
			}
		});
		await migrateAndActivateTemplateListProjection(t);

		await expect(authenticated.query(api.users.getMyTemplates, {})).rejects.toThrow(
			'PROFILE_TEMPLATE_PAGINATION_REQUIRED'
		);

		const first = await authenticated.query(api.users.getMyTemplatesPage, {
			paginationOpts: { numItems: 500, cursor: null }
		});
		expect(first.page).toHaveLength(50);
		expect(first.isDone).toBe(false);
		expect(first.page[0]).not.toHaveProperty('topicEmbedding');
		expect(Object.keys(first.page[0]).sort()).toEqual([
			'_creationTime',
			'_id',
			'isPublic',
			'slug',
			'status',
			'title'
		]);

		const second = await authenticated.query(api.users.getMyTemplatesPage, {
			paginationOpts: { numItems: 50, cursor: first.continueCursor }
		});
		expect(second.page).toHaveLength(5);
		expect(second.isDone).toBe(true);
	});

	it('rejects invalid page sizes before reading templates', async () => {
		const t = newHarness();
		const { authenticated } = await authenticatedUser(t);
		await migrateAndActivateTemplateListProjection(t);

		await expect(
			authenticated.query(api.users.getMyTemplatesPage, {
				paginationOpts: { numItems: 0, cursor: null }
			})
		).rejects.toThrow('INVALID_PROFILE_TEMPLATE_PAGE_SIZE');
	});
});
