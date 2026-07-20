/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const SECRET = 'test-internal-secret-campaign-launch-invariants';
type Harness = TestConvex<typeof schema>;

function identity(subject: string, email: string) {
	return {
		subject,
		issuer: 'https://issuer.example',
		tokenIdentifier: `https://issuer.example|${subject}`,
		email
	};
}

async function seedOrg(t: Harness) {
	return t.run(async (ctx) => {
		const orgId = await ctx.db.insert('organizations', {
			name: 'Launch Invariants Org',
			slug: 'launch-invariants-org',
			maxSeats: 10,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			updatedAt: NOW
		});
		return orgId;
	});
}

async function seedUser(t: Harness, subject: string, email: string, trustTier = 3) {
	return t.run((ctx) =>
		ctx.db.insert('users', {
			tokenIdentifier: `https://issuer.example|${subject}`,
			email,
			identityCommitment: `identity-${subject}`,
			updatedAt: NOW,
			isVerified: true,
			authorityLevel: trustTier,
			trustTier,
			trustScore: 100,
			reputationTier: 'veteran',
			districtVerified: true,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 1,
			profileVisibility: 'private'
		})
	);
}

describe('campaign launch authorization and attribution invariants', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it('exposes settlement authority only for campaign-org editors and owners', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		const ownerId = await seedUser(t, 'settlement-owner', 'owner@example.test');
		const editorId = await seedUser(t, 'settlement-editor', 'editor@example.test');
		const memberId = await seedUser(t, 'settlement-member', 'member@example.test');

		const debateId = await t.run(async (ctx) => {
			for (const [userId, role] of [
				[ownerId, 'owner'],
				[editorId, 'editor'],
				[memberId, 'member']
			] as const) {
				await ctx.db.insert('orgMemberships', { userId, orgId, role, joinedAt: NOW });
			}
			const templateId = await ctx.db.insert('templates', {
				slug: 'settlement-template',
				title: 'Settlement template',
				description: 'Campaign settlement authorization fixture',
				type: 'email',
				deliveryMethod: 'email',
				preview: 'Preview',
				messageBody: 'Message',
				deliveryConfig: {},
				recipientConfig: {},
				status: 'published',
				isPublic: true,
				verifiedSends: 0,
				uniqueDistricts: 0,
				embeddingVersion: 'test-v1',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: NOW,
				userId: ownerId,
				orgId
			});
			const debateId = await ctx.db.insert('debates', {
				templateId,
				debateIdOnchain: `0x${'11'.repeat(32)}`,
				actionDomain: `0x${'22'.repeat(32)}`,
				propositionHash: `0x${'33'.repeat(32)}`,
				propositionText: 'Should editors settle this campaign debate?',
				deadline: NOW,
				jurisdictionSize: 100,
				status: 'active',
				argumentCount: 0,
				uniqueParticipants: 0,
				totalStake: 0,
				resolvedFromChain: false,
				proposerAddress: `0x${'00'.repeat(20)}`,
				proposerBond: 0,
				marketStatus: 'pre_market',
				currentEpoch: 0,
				updatedAt: NOW
			});
			await ctx.db.insert('campaigns', {
				orgId,
				type: 'LETTER',
				title: 'Settlement campaign',
				status: 'ACTIVE',
				debateEnabled: true,
				debateThreshold: 10,
				debateId,
				raisedAmountCents: 0,
				donorCount: 0,
				targetCountry: 'US',
				updatedAt: NOW
			});
			return debateId;
		});

		const queryFor = (subject: string, email: string) =>
			t.withIdentity(identity(subject, email)).query(api.campaigns.getCampaignByDebateId, {
				debateId
			});
		await expect(queryFor('settlement-owner', 'owner@example.test')).resolves.toMatchObject({
			settlementRole: 'owner'
		});
		await expect(queryFor('settlement-editor', 'editor@example.test')).resolves.toMatchObject({
			settlementRole: 'editor'
		});
		await expect(queryFor('settlement-member', 'member@example.test')).resolves.toMatchObject({
			settlementRole: null
		});
	});

	it('binds identity once, schedules bounded receipt reprojection, and rejects conflicts', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t);
		const supporterId = await t.run((ctx) =>
			ctx.db.insert('supporters', {
				orgId,
				encryptedEmail: 'ciphertext',
				emailHash: 'org-email-hash',
				verified: true,
				emailStatus: 'subscribed',
				smsStatus: 'none',
				updatedAt: NOW
			})
		);
		const args = {
			orgId,
			emailHash: 'org-email-hash',
			encryptedEmail: 'ciphertext',
			identityCommitment: '  identity-bound-once  ',
			source: 'campaign'
		};

		await expect(t.mutation(internal.campaigns.findOrCreateSupporter, args)).resolves.toEqual({
			supporterId,
			isNew: false
		});
		const afterBind = await t.run((ctx) => ctx.db.get(supporterId));
		expect(afterBind?.identityCommitment).toBe('identity-bound-once');

		const jobsAfterBind = await t.run((ctx) =>
			ctx.db.system.query('_scheduled_functions').collect()
		);
		expect(jobsAfterBind).toHaveLength(1);
		expect(jobsAfterBind[0].name).toBe(
			'accountabilityReadModel:reprojectSupporterIdentityReceipts'
		);

		await t.mutation(internal.campaigns.findOrCreateSupporter, args);
		const jobsAfterRetry = await t.run((ctx) =>
			ctx.db.system.query('_scheduled_functions').collect()
		);
		expect(jobsAfterRetry).toHaveLength(1);
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const completedJobs = await t.run((ctx) =>
			ctx.db.system.query('_scheduled_functions').collect()
		);
		expect(completedJobs[0].state.kind).toBe('success');

		await expect(
			t.mutation(internal.campaigns.findOrCreateSupporter, {
				...args,
				identityCommitment: 'identity-conflict'
			})
		).rejects.toThrow('SUPPORTER_IDENTITY_CONFLICT');
		expect((await t.run((ctx) => ctx.db.get(supporterId)))?.identityCommitment).toBe(
			'identity-bound-once'
		);
		await expect(
			t.mutation(internal.campaigns.findOrCreateSupporter, {
				...args,
				emailHash: 'blank-identity-email-hash',
				identityCommitment: '   '
			})
		).rejects.toThrow('IDENTITY_COMMITMENT_BLANK');

		const created = await t.mutation(internal.campaigns.findOrCreateSupporter, {
			orgId,
			emailHash: 'new-org-email-hash',
			encryptedEmail: 'new-ciphertext',
			source: ' campaign-widget '
		});
		expect(created.isNew).toBe(true);
		await expect(t.run((ctx) => ctx.db.get(created.supporterId))).resolves.toMatchObject({
			browseSource: 'campaign-widget',
			browseTagIds: [],
			supporterBrowseVersion: 1
		});
	});

	it('derives attribution only from the canonical authenticated user id and exact email match', async () => {
		const t = convexTest(schema, modules);
		const userId = await seedUser(t, 'canonical-submit', 'Person@Example.Test', 4);

		await expect(
			t.query(internal.campaigns.getAuthenticatedCampaignSubmitter, { userId })
		).resolves.toEqual({
			userId,
			normalizedEmail: 'person@example.test',
			identityCommitment: 'identity-canonical-submit',
			trustTier: 4,
			engagementTier: 3
		});

		await expect(
			t.action(api.campaigns.submitAction, {
				_secret: SECRET,
				campaignId: 'missing-campaign',
				email: 'attacker@example.test',
				name: 'Attacker',
				authenticatedUserId: userId
			})
		).rejects.toThrow('AUTHENTICATED_SUBMITTER_MISMATCH');

		await expect(
			t.action(api.campaigns.submitAction, {
				_secret: SECRET,
				campaignId: 'missing-campaign',
				email: 'PERSON@example.test',
				name: 'Canonical User',
				authenticatedUserId: userId
			})
		).rejects.toThrow('Campaign not found or inactive');
	});
});
