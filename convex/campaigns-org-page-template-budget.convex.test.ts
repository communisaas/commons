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

async function orgFixture(t: Harness) {
	const tokenIdentifier = 'https://issuer.example|campaign-template-budget';
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
	const orgId = await t.run((ctx) =>
		ctx.db.insert('organizations', {
			name: 'Campaign Template Budget Org',
			slug: 'campaign-template-budget-org',
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
		orgId,
		authenticated: t.withIdentity({
			subject: 'campaign-template-budget',
			issuer: 'https://issuer.example',
			tokenIdentifier
		})
	};
}

function templateValue(index: number, orgId: Id<'organizations'>) {
	return {
		slug: `campaign-template-${String(index).padStart(3, '0')}`,
		title: `Campaign template ${String(index).padStart(3, '0')}`,
		description: 'Campaign detail template pagination fixture',
		domain: 'civic',
		topics: [],
		type: 'email',
		deliveryMethod: 'email' as const,
		preview: 'Preview',
		messageBody: 'Message',
		deliveryConfig: {},
		recipientConfig: {},
		status: 'published',
		isPublic: false,
		verifiedSends: 0,
		uniqueDistricts: 0,
		topicEmbedding: index === 0 ? Array.from({ length: 768 }, () => 0.25) : undefined,
		embeddingVersion: 'test-v1',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		orgId,
		updatedAt: 1_800_000_000_000 + index
	};
}

describe('campaign org-page template read budget', () => {
	it('bounds the org template range, exposes continuation, and retains the selected template', async () => {
		const t = newHarness();
		const { authenticated, orgId } = await orgFixture(t);
		let selectedTemplateId!: Id<'templates'>;
		const campaignId = await t.run(async (ctx) => {
			for (let index = 0; index < 55; index += 1) {
				const templateId = await ctx.db.insert('templates', templateValue(index, orgId));
				if (index === 0) selectedTemplateId = templateId;
			}
			const campaignId = await ctx.db.insert('campaigns', {
				orgId,
				templateId: selectedTemplateId,
				type: 'LETTER',
				title: 'Bounded campaign detail',
				status: 'DRAFT',
				debateEnabled: false,
				debateThreshold: 50,
				raisedAmountCents: 0,
				donorCount: 0,
				targetCountry: 'US',
				actionCount: 0,
				verifiedActionCount: 0,
				updatedAt: Date.now()
			});
			const debateId = await ctx.db.insert('debates', {
				templateId: selectedTemplateId,
				debateIdOnchain: 'bounded-debate',
				actionDomain: 'civic',
				propositionHash: 'bounded-proposition',
				propositionText: 'A bounded winning-argument lookup',
				deadline: Date.now() + 60_000,
				jurisdictionSize: 1,
				status: 'resolved',
				argumentCount: 10,
				uniqueParticipants: 10,
				totalStake: 10,
				winningArgumentIndex: 7,
				winningStance: 'SUPPORT',
				resolvedFromChain: false,
				proposerAddress: '0xbounded',
				proposerBond: 0,
				marketStatus: 'resolved',
				currentEpoch: 1,
				updatedAt: Date.now()
			});
			for (let argumentIndex = 0; argumentIndex < 10; argumentIndex += 1) {
				await ctx.db.insert('debateArguments', {
					debateId,
					argumentIndex,
					stance: argumentIndex === 7 ? 'SUPPORT' : 'OPPOSE',
					body:
						argumentIndex === 7 ? 'The exact winning argument' : `Losing argument ${argumentIndex}`,
					bodyHash: `argument-${argumentIndex}`,
					stakeAmount: 1,
					engagementTier: 1,
					weightedScore: argumentIndex,
					totalStake: 1,
					coSignCount: 0,
					positionCount: 1,
					verificationStatus: 'verified'
				});
			}
			await ctx.db.patch(campaignId, { debateId });
			return campaignId;
		});
		await migrateAndActivateTemplateListProjection(t);

		await expect(
			authenticated.query(api.campaigns.getForOrgPage, {
				slug: 'campaign-template-budget-org',
				campaignId
			})
		).rejects.toThrow('ORG_TEMPLATE_PAGINATION_REQUIRED');

		const first = await authenticated.query(api.campaigns.getForOrgPage, {
			slug: 'campaign-template-budget-org',
			campaignId,
			templatePaginationOpts: { numItems: 500, cursor: null }
		});
		expect(first).not.toBeNull();
		expect(first!.templatePagination.isDone).toBe(false);
		expect(first!.templates).toHaveLength(50);
		expect(first!.templates).toContainEqual({
			_id: selectedTemplateId,
			title: 'Campaign template 000'
		});
		expect(first!.campaign.templateTitle).toBe('Campaign template 000');
		expect(first!.templates[0]).not.toHaveProperty('topicEmbedding');
		expect(first!.debate?.winningArgument).toEqual({
			body: 'The exact winning argument',
			stance: 'SUPPORT'
		});

		const second = await authenticated.query(api.campaigns.getForOrgPage, {
			slug: 'campaign-template-budget-org',
			campaignId,
			templatePaginationOpts: {
				numItems: 50,
				cursor: first!.templatePagination.continueCursor
			}
		});
		expect(second!.templatePagination.isDone).toBe(true);
		expect(second!.templates).toHaveLength(6);
		expect(second!.templates).toContainEqual({
			_id: selectedTemplateId,
			title: 'Campaign template 000'
		});
	});

	it('rejects invalid page sizes before reading the org template range', async () => {
		const t = newHarness();
		const { authenticated, orgId } = await orgFixture(t);
		const campaignId = await t.run((ctx) =>
			ctx.db.insert('campaigns', {
				orgId,
				type: 'LETTER',
				title: 'Invalid page size fixture',
				status: 'DRAFT',
				debateEnabled: false,
				debateThreshold: 50,
				raisedAmountCents: 0,
				donorCount: 0,
				targetCountry: 'US',
				updatedAt: Date.now()
			})
		);
		await migrateAndActivateTemplateListProjection(t);
		await expect(
			authenticated.query(api.campaigns.getForOrgPage, {
				slug: 'campaign-template-budget-org',
				campaignId
			})
		).resolves.toMatchObject({
			templates: [],
			templatePagination: { isDone: true }
		});

		await expect(
			authenticated.query(api.campaigns.getForOrgPage, {
				slug: 'campaign-template-budget-org',
				campaignId,
				templatePaginationOpts: { numItems: 0, cursor: null }
			})
		).rejects.toThrow('INVALID_ORG_TEMPLATE_PAGE_SIZE');
	});
});
