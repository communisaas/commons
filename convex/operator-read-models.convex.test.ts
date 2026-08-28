/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import { computeGlobalPhoneHash } from './_orgHash';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const TOKEN = 'https://issuer.example|operator-read-models';
const SLUG = 'operator-read-models';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
type Harness = TestConvex<typeof schema>;

async function seedLegacyPlanes(t: Harness) {
	const fromPhone = '+15551234567';
	const toPhone = '+15557654321';
	const globalPhoneHash = await computeGlobalPhoneHash(fromPhone);
	return await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier: TOKEN,
			email: 'operator-read-models@example.test',
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
			name: 'Operator Read Models',
			slug: SLUG,
			maxSeats: 5,
			maxTemplatesMonth: 100,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', { userId, orgId, role: 'owner', joinedAt: NOW });
		const campaignId = await ctx.db.insert('campaigns', {
			orgId,
			type: 'FUNDRAISER',
			title: 'Foundation Fundraiser',
			status: 'ACTIVE',
			debateEnabled: false,
			debateThreshold: 0,
			raisedAmountCents: 0,
			donorCount: 0,
			targetCountry: 'US',
			updatedAt: NOW
		});
		const supporterId = await ctx.db.insert('supporters', {
			orgId,
			encryptedEmail: 'ciphertext',
			emailHash: 'email-hash',
			encryptedPhone: 'phone-ciphertext',
			phoneHash: 'org-phone-hash',
			globalPhoneHash,
			verified: true,
			emailStatus: 'subscribed',
			smsStatus: 'subscribed',
			updatedAt: NOW
		});
		const blastId = await ctx.db.insert('smsBlasts', {
			orgId,
			campaignId,
			body: 'Reply to this message',
			fromNumber: toPhone,
			totalRecipients: 1,
			sentCount: 1,
			deliveredCount: 1,
			failedCount: 0,
			status: 'sent',
			updatedAt: NOW
		});
		await ctx.db.insert('smsMessages', {
			blastId,
			supporterId,
			body: 'Reply to this message',
			status: 'delivered'
		});
		await ctx.db.insert('orgTwilioNumbers', { orgId, phoneNumber: toPhone, updatedAt: NOW });

		const workflowId = await ctx.db.insert('workflows', {
			orgId,
			name: 'Legacy workflow',
			trigger: { type: 'campaign_action' },
			steps: [],
			enabled: false,
			updatedAt: NOW
		});
		for (let index = 0; index < 2; index += 1) {
			await ctx.db.insert('workflowExecutions', {
				workflowId,
				supporterId,
				triggerEvent: { index },
				status: 'completed',
				currentStep: 0,
				completedAt: NOW + index
			});
		}

		for (const donation of [
			{
				status: 'completed' as const,
				confirmationEmailStatus: 'sent' as const,
				confirmationEmailProviderMessageId: 'ses-accepted'
			},
			{ status: 'completed' as const },
			{ status: 'failed' as const }
		]) {
			await ctx.db.insert('donations', {
				orgId,
				campaignId,
				supporterId,
				amountCents: 1_000,
				currency: 'USD',
				recurring: false,
				engagementTier: 1,
				updatedAt: NOW,
				...donation
			});
		}

		await ctx.db.insert('smsReplies', {
			orgId,
			supporterId,
			blastId,
			body: 'First reply',
			receivedAt: NOW - 1_000
		});
		await ctx.db.insert('smsReplies', {
			orgId,
			body: 'Second reply',
			receivedAt: NOW
		});
		return { orgId, campaignId, supporterId, workflowId, fromPhone, toPhone };
	});
}

async function migrateAndActivate(t: Harness): Promise<void> {
	let workflow = await t.mutation(internal.workflows.migrateWorkflowExecutionCounts, {});
	for (let page = 0; workflow.status === 'running' && page < 10; page += 1) {
		workflow = await t.mutation(internal.workflows.migrateWorkflowExecutionCounts, {
			cursor: workflow.cursor ?? null
		});
	}
	expect(workflow.status).toBe('migrated');
	await t.mutation(internal.workflows.activateWorkflowExecutionCounts, {});

	const donation = await t.mutation(internal.donations.migrateDonationConfirmationSummaries, {});
	expect(donation.status).toBe('migrated');
	await t.mutation(internal.donations.activateDonationConfirmationSummaries, {});

	const sms = await t.mutation(internal.sms.migrateSmsReplySummaries, {});
	expect(sms.status).toBe('migrated');
	await t.mutation(internal.sms.activateSmsReplySummaries, {});
}

describe('operator-facing exact read models', () => {
	it('fails closed before migration, then projects legacy history exactly', async () => {
		const t = convexTest({ schema, modules });
		const fixture = await seedLegacyPlanes(t);
		const authenticated = t.withIdentity({ tokenIdentifier: TOKEN });

		await expect(authenticated.query(api.workflows.list, { slug: SLUG })).rejects.toThrow(
			'WORKFLOW_EXECUTION_COUNTS_NOT_READY'
		);
		await expect(
			authenticated.query(api.donations.getConfirmationSummary, { orgSlug: SLUG })
		).rejects.toThrow('DONATION_CONFIRMATION_SUMMARIES_NOT_READY');
		await expect(authenticated.query(api.sms.getReplySummary, { slug: SLUG })).rejects.toThrow(
			'SMS_REPLY_SUMMARY_NOT_READY'
		);

		await migrateAndActivate(t);

		await expect(authenticated.query(api.workflows.list, { slug: SLUG })).resolves.toMatchObject([
			{ _id: fixture.workflowId, executionCount: 2 }
		]);
		const orgDonationSummary = await authenticated.query(api.donations.getConfirmationSummary, {
			orgSlug: SLUG
		});
		expect(orgDonationSummary).toEqual({
			completed: 2,
			sent: 1,
			sending: 0,
			skipped: 0,
			failed: 0,
			notRecorded: 1,
			providerAccepted: 1,
			attempted: 1
		});
		await expect(
			authenticated.query(api.donations.getConfirmationSummary, {
				orgSlug: SLUG,
				campaignId: fixture.campaignId
			})
		).resolves.toEqual(orgDonationSummary);
		await expect(authenticated.query(api.sms.getReplySummary, { slug: SLUG })).resolves.toEqual({
			replyCount: 2,
			matchedSupporterCount: 1,
			linkedBlastCount: 1,
			latestReceivedAt: NOW
		});
	});

	it('maintains all three projections in the source-row write transaction', async () => {
		const t = convexTest({ schema, modules });
		const fixture = await seedLegacyPlanes(t);
		await migrateAndActivate(t);
		const authenticated = t.withIdentity({ tokenIdentifier: TOKEN });

		await t.mutation(internal.workflows.createExecution, {
			workflowId: fixture.workflowId,
			supporterId: fixture.supporterId,
			triggerEvent: { source: 'test' }
		});

		const pendingDonationId = await t.run((ctx) =>
			ctx.db.insert('donations', {
				orgId: fixture.orgId,
				campaignId: fixture.campaignId,
				supporterId: fixture.supporterId,
				amountCents: 2_500,
				currency: 'USD',
				recurring: false,
				status: 'pending',
				engagementTier: 1,
				updatedAt: NOW
			})
		);
		await t.mutation(internal.donations.updateStatus, {
			donationId: pendingDonationId,
			status: 'completed'
		});
		await t.mutation(internal.donations.claimConfirmationEmailSend, {
			donationId: pendingDonationId
		});
		await t.mutation(internal.donations.recordConfirmationEmailResult, {
			donationId: pendingDonationId,
			status: 'sent',
			provider: 'ses',
			providerMessageId: 'ses-new'
		});

		const inbound = await t.mutation(internal.webhooks.handleInboundSms, {
			from: fixture.fromPhone,
			to: fixture.toPhone,
			messageSid: 'SM-new-reply',
			body: 'I have a question'
		});
		if (!inbound.jobId) throw new Error('expected durable SMS reply fanout job');
		// Signed ingress now commits a compact job before acknowledging; the
		// bounded worker owns reply insertion + summary projection.
		await t.mutation(internal.webhooks.processContactFanoutPage, {
			jobId: inbound.jobId,
			asOf: Date.now() + 1
		});

		await expect(authenticated.query(api.workflows.list, { slug: SLUG })).resolves.toMatchObject([
			{ _id: fixture.workflowId, executionCount: 3 }
		]);
		await expect(
			authenticated.query(api.donations.getConfirmationSummary, { orgSlug: SLUG })
		).resolves.toEqual({
			completed: 3,
			sent: 2,
			sending: 0,
			skipped: 0,
			failed: 0,
			notRecorded: 1,
			providerAccepted: 2,
			attempted: 2
		});
		await expect(authenticated.query(api.sms.getReplySummary, { slug: SLUG })).resolves.toEqual({
			replyCount: 3,
			matchedSupporterCount: 2,
			linkedBlastCount: 2,
			latestReceivedAt: expect.any(Number)
		});
	});
});
