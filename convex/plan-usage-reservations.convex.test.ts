/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import {
	blockEmailReservation,
	reconcileEmailReservation,
	reserveEmailUsage
} from './lib/planUsageReservations';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const PERIOD_START = Date.parse('2026-07-01T00:00:00.000Z');
const PERIOD_END = Date.parse('2026-08-01T00:00:00.000Z');

async function seedReadyOrg(t: Harness, sent = 0) {
	return await t.run(async (ctx) => {
		const orgId = await ctx.db.insert('organizations', {
			name: 'Reservation Proof Org',
			slug: `reservation-proof-${sent}`,
			maxSeats: 5,
			maxTemplatesMonth: 100,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: false,
			memberCount: 1,
			verifiedActionsLifetime: 0,
			verifiedActionsPeriodBaseline: 0,
			verifiedActionsPeriodBaselineAt: PERIOD_START,
			sentEmailCount: sent,
			sentEmailPeriodBaseline: 0,
			sentEmailPeriodBaselineAt: PERIOD_START,
			emailReservedCount: 0,
			emailReservationPeriodStart: PERIOD_START,
			emailReservationState: 'ready',
			smsSentCount: 0,
			smsSentPeriodBaseline: 0,
			smsSentPeriodBaselineAt: PERIOD_START,
			updatedAt: NOW
		});
		await ctx.db.insert('subscriptions', {
			orgId,
			plan: 'starter',
			priceCents: 1_000,
			status: 'active',
			paymentMethod: 'stripe',
			stripeSubscriptionId: `sub_${sent}`,
			currentPeriodStart: PERIOD_START,
			currentPeriodEnd: PERIOD_END,
			updatedAt: NOW
		});
		await ctx.db.insert('planUsageMigrations', {
			key: 'v1',
			status: 'ready',
			runToken: 'reservation-ready',
			phase: 'complete',
			verifiedActions: 0,
			emailsSent: 0,
			emailReserved: 0,
			smsSent: 0,
			restarts: 0,
			scannedOrganizations: 1,
			projectedOrganizations: 1,
			scannedSourceRows: 0,
			startedAt: NOW,
			completedAt: NOW,
			updatedAt: NOW
		});
		await ctx.db.insert('contactAuthorityMigrations', {
			key: 'contact-authority-v1',
			status: 'ready',
			scanned: 0,
			startedAt: NOW,
			completedAt: NOW,
			updatedAt: NOW
		});
		const campaignId = await ctx.db.insert('campaigns', {
			orgId,
			type: 'LETTER',
			title: 'Reservation source',
			status: 'ACTIVE',
			debateEnabled: false,
			debateThreshold: 0,
			raisedAmountCents: 0,
			donorCount: 0,
			targetCountry: 'US',
			updatedAt: NOW
		});
		return { orgId, campaignId };
	});
}

async function insertDelivery(
	t: Harness,
	orgId: Id<'organizations'>,
	campaignId: Id<'campaigns'>,
	label: string,
	status = 'queued'
) {
	return await t.run((ctx) =>
		ctx.db.insert('campaignDeliveries', {
			campaignId,
			orgId,
			targetEmail: `${label}@example.test`,
			targetName: label,
			targetTitle: '',
			status,
			createdAt: NOW
		})
	);
}

async function reserveDelivery(
	t: Harness,
	orgId: Id<'organizations'>,
	deliveryId: Id<'campaignDeliveries'>,
	currentEmailsSent: number,
	leaseExpiresAt = NOW + 60_000
) {
	return await t.run(async (ctx) => {
		const reservation = await reserveEmailUsage(ctx, {
			orgId,
			sourceType: 'campaignDelivery',
			sourceId: String(deliveryId),
			requestedCount: 1,
			admission: {
				periodStart: PERIOD_START,
				currentEmailsSent,
				maxEmails: 20_000
			},
			leaseExpiresAt
		});
		await ctx.db.patch(deliveryId, { planUsageReservationId: reservation._id });
		return reservation;
	});
}

async function insertSendingBlastReservation(
	t: Harness,
	orgId: Id<'organizations'>,
	recipientCount: number
) {
	return await t.run(async (ctx) => {
		const blastId = await ctx.db.insert('emailBlasts', {
			orgId,
			subject: 'Carrier boundary proof',
			bodyHtml: '<p>Proof</p>',
			fromName: 'Commons',
			fromEmail: 'commons@example.test',
			status: 'sending',
			totalRecipients: recipientCount,
			totalSent: 0,
			totalBounced: 0,
			totalOpened: 0,
			totalClicked: 0,
			totalComplained: 0,
			updatedAt: NOW,
			sealedOrgKey: 'sealed-test-key',
			sendMode: 'tee-sealed',
			isAbTest: false
		});
		const reservation = await reserveEmailUsage(ctx, {
			orgId,
			sourceType: 'emailBlast',
			sourceId: String(blastId),
			requestedCount: recipientCount,
			admission: {
				periodStart: PERIOD_START,
				currentEmailsSent: 0,
				maxEmails: 20_000
			},
			leaseExpiresAt: NOW + 60_000
		});
		await ctx.db.patch(blastId, { planUsageReservationId: reservation._id });
		return { blastId, reservationId: reservation._id };
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe('durable email quota reservations', () => {
	it('serializes concurrent claims and cannot overshoot the final slot', async () => {
		const t = convexTest({ schema, modules });
		const { orgId, campaignId } = await seedReadyOrg(t, 19_999);
		const first = await insertDelivery(t, orgId, campaignId, 'first');
		const second = await insertDelivery(t, orgId, campaignId, 'second');

		const results = await Promise.allSettled([
			reserveDelivery(t, orgId, first, 19_999),
			reserveDelivery(t, orgId, second, 19_999)
		]);
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
		expect(
			String(
				(results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason
			)
		).toContain('EMAIL_QUOTA_EXCEEDED');

		const state = await t.run(async (ctx) => ({
			org: await ctx.db.get(orgId),
			reservations: await ctx.db.query('planUsageReservations').collect()
		}));
		expect(state.org?.emailReservedCount).toBe(1);
		expect(state.reservations).toHaveLength(1);
		expect(state.reservations[0]).toMatchObject({
			requestedCount: 1,
			remainingCount: 1,
			sentCount: 0,
			releasedCount: 0,
			status: 'active'
		});
	});

	it('is idempotent by source identity and converts reserved to sent exactly once', async () => {
		const t = convexTest({ schema, modules });
		const { orgId, campaignId } = await seedReadyOrg(t);
		const deliveryId = await insertDelivery(t, orgId, campaignId, 'idempotent');
		const first = await reserveDelivery(t, orgId, deliveryId, 0);
		const replay = await reserveDelivery(t, orgId, deliveryId, 0);
		expect(replay._id).toBe(first._id);
		expect((await t.run((ctx) => ctx.db.get(orgId)))?.emailReservedCount).toBe(1);

		await t.run((ctx) =>
			reconcileEmailReservation(ctx, {
				reservationId: first._id,
				absoluteSentCount: 1,
				terminal: true,
				terminalReason: 'TEST_ACCEPTED'
			})
		);
		await t.run((ctx) =>
			reconcileEmailReservation(ctx, {
				reservationId: first._id,
				absoluteSentCount: 1,
				terminal: true,
				terminalReason: 'TEST_ACCEPTED_REPLAY'
			})
		);
		await expect(t.run((ctx) => ctx.db.get(orgId))).resolves.toMatchObject({
			sentEmailCount: 1,
			emailReservedCount: 0
		});
		await expect(t.run((ctx) => ctx.db.get(first._id))).resolves.toMatchObject({
			status: 'settled',
			remainingCount: 0,
			sentCount: 1,
			releasedCount: 0
		});
	});

	it('releases only stale pre-authority queues and blocks stale carrier-boundary sends', async () => {
		const t = convexTest({ schema, modules });
		const { orgId, campaignId } = await seedReadyOrg(t);
		const queuedId = await insertDelivery(t, orgId, campaignId, 'queued');
		const sendingId = await insertDelivery(t, orgId, campaignId, 'sending', 'sending');
		const queued = await reserveDelivery(t, orgId, queuedId, 0, NOW - 1);
		const sending = await reserveDelivery(t, orgId, sendingId, 0, NOW - 1);

		await expect(t.mutation(internal.planUsage.sweepStaleReservations, {})).resolves.toMatchObject({
			released: 1,
			blocked: 1,
			scanned: 2
		});
		await expect(t.run((ctx) => ctx.db.get(queued._id))).resolves.toMatchObject({
			status: 'released',
			releasedCount: 1
		});
		await expect(t.run((ctx) => ctx.db.get(sending._id))).resolves.toMatchObject({
			status: 'blocked',
			remainingCount: 1
		});
		await expect(t.run((ctx) => ctx.db.get(orgId))).resolves.toMatchObject({
			emailReservationState: 'blocked',
			emailReservedCount: 1
		});
	});

	it('reconciles a deleted source only from complete audited carrier evidence', async () => {
		const t = convexTest({ schema, modules });
		const { orgId, campaignId } = await seedReadyOrg(t);
		const deliveryId = await insertDelivery(t, orgId, campaignId, 'evidence', 'sending');
		const reservation = await reserveDelivery(t, orgId, deliveryId, 0);
		await t.run(async (ctx) => {
			await blockEmailReservation(ctx, reservation._id, 'SES_OUTCOME_AMBIGUOUS');
			await ctx.db.delete(deliveryId);
		});

		await expect(
			t.mutation(internal.planUsage.reconcileBlockedReservation, {
				reservationId: reservation._id
			})
		).rejects.toThrow('PLAN_USAGE_RESERVATION_EVIDENCE_INCOMPLETE');
		const evidenceId = await t.mutation(internal.planUsage.ingestCarrierEvidence, {
			reservationId: reservation._id,
			evidenceIdentity: 'ses-case-0001',
			operatorRef: 'incident-42',
			carrierMessageIds: ['ses-message-accepted-1'],
			absoluteSentCount: 1,
			absoluteFailedCount: 0,
			observedAt: NOW + 5_000
		});
		await expect(
			t.mutation(internal.planUsage.ingestCarrierEvidence, {
				reservationId: reservation._id,
				evidenceIdentity: 'ses-case-0001',
				operatorRef: 'incident-42',
				carrierMessageIds: ['ses-message-accepted-1'],
				absoluteSentCount: 1,
				absoluteFailedCount: 0,
				observedAt: NOW + 5_000
			})
		).resolves.toBe(evidenceId);
		await expect(
			t.mutation(internal.planUsage.reconcileBlockedReservation, {
				reservationId: reservation._id
			})
		).resolves.toMatchObject({ status: 'settled' });
		await expect(t.run((ctx) => ctx.db.get(reservation._id))).resolves.toMatchObject({
			status: 'settled',
			sentCount: 1,
			remainingCount: 0
		});
		await expect(t.run((ctx) => ctx.db.get(orgId))).resolves.toMatchObject({
			sentEmailCount: 1,
			emailReservedCount: 0,
			emailReservationState: 'blocked'
		});
	});

	it('binds workflow reservations to one execution-step coordinate', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedReadyOrg(t);
		const { executionId } = await t.run(async (ctx) => {
			const supporterId = await ctx.db.insert('supporters', {
				orgId,
				encryptedEmail: 'workflow-email-ciphertext',
				emailHash: 'workflow-org-email-hash',
				globalEmailHash: 'workflow-global-email-hash',
				verified: true,
				emailStatus: 'subscribed',
				smsStatus: 'none',
				updatedAt: NOW
			});
			const workflowId = await ctx.db.insert('workflows', {
				orgId,
				name: 'Reserved workflow',
				trigger: { type: 'supporter_created' },
				steps: [{ type: 'send_email', emailSubject: 'Hi', emailBody: '<p>Hi</p>' }],
				enabled: true,
				updatedAt: NOW
			});
			const executionId = await ctx.db.insert('workflowExecutions', {
				workflowId,
				supporterId,
				triggerEvent: {},
				status: 'running',
				currentStep: 0
			});
			return { executionId };
		});
		const claim = await t.mutation(internal.workflows.claimWorkflowEmailDispatch, {
			executionId,
			stepIndex: 0
		});
		expect(claim).toMatchObject({ ok: true, alreadySent: false });
		if (!claim.ok) throw new Error(`unexpected workflow skip: ${claim.reason}`);
		await expect(
			t.mutation(internal.workflows.claimWorkflowEmailDispatch, {
				executionId,
				stepIndex: 0
			})
		).rejects.toThrow('WORKFLOW_EMAIL_DISPATCH_NOT_RETRYABLE:sending');
		await t.mutation(internal.workflows.settleWorkflowEmailDispatch, {
			dispatchId: claim.dispatchId,
			messageId: 'ses-workflow-message-1'
		});
		await expect(t.run((ctx) => ctx.db.get(claim.reservationId!))).resolves.toMatchObject({
			sourceType: 'workflowEmail',
			sourceId: String(executionId),
			sourceStepIndex: 0,
			status: 'settled',
			sentCount: 1
		});
	});

	it('rechecks contact authority in the quota-claim transaction and skips without reserving', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedReadyOrg(t);
		const { executionId } = await t.run(async (ctx) => {
			const globalEmailHash = 'workflow-denied-global-email-hash';
			const supporterId = await ctx.db.insert('supporters', {
				orgId,
				encryptedEmail: 'workflow-denied-ciphertext',
				emailHash: 'workflow-denied-org-hash',
				globalEmailHash,
				verified: false,
				emailStatus: 'subscribed',
				smsStatus: 'none',
				updatedAt: NOW
			});
			await ctx.db.insert('contactAuthorities', {
				channel: 'email',
				contactHash: globalEmailHash,
				state: 'email_complained',
				source: 'ses',
				version: 1,
				projectionBytes: 128,
				updatedAt: NOW
			});
			const workflowId = await ctx.db.insert('workflows', {
				orgId,
				name: 'Consent race workflow',
				trigger: { type: 'supporter_created' },
				steps: [{ type: 'send_email', emailSubject: 'Hi', emailBody: '<p>Hi</p>' }],
				enabled: true,
				updatedAt: NOW
			});
			const executionId = await ctx.db.insert('workflowExecutions', {
				workflowId,
				supporterId,
				triggerEvent: {},
				status: 'running',
				currentStep: 0
			});
			return { executionId };
		});

		const first = await t.mutation(internal.workflows.claimWorkflowEmailDispatch, {
			executionId,
			stepIndex: 0
		});
		expect(first).toMatchObject({
			ok: false,
			skipped: true,
			reason: 'CONTACT_AUTHORITY_EMAIL_DENIED'
		});
		await expect(
			t.mutation(internal.workflows.claimWorkflowEmailDispatch, {
				executionId,
				stepIndex: 0
			})
		).resolves.toEqual(first);

		const state = await t.run(async (ctx) => ({
			org: await ctx.db.get(orgId),
			reservations: await ctx.db.query('planUsageReservations').collect(),
			dispatches: await ctx.db.query('workflowEmailDispatches').collect()
		}));
		expect(state.org?.emailReservedCount).toBe(0);
		expect(state.reservations).toEqual([]);
		expect(state.dispatches).toHaveLength(1);
		expect(state.dispatches[0]).toMatchObject({
			status: 'failed',
			failureCode: 'WORKFLOW_EMAIL_RECIPIENT_NOT_AUTHORIZED:CONTACT_AUTHORITY_EMAIL_DENIED'
		});
		expect(state.dispatches[0]?.reservationId).toBeUndefined();
	});

	it('issues exactly one durable TEE carrier grant for an exact cohort', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedReadyOrg(t);
		const { blastId, reservationId } = await insertSendingBlastReservation(t, orgId, 3);

		await expect(
			t.mutation(internal.blasts.verifyBlastCarrierBoundary, {
				blastId,
				observedRecipientCount: 3,
				expectedContactAuthorityEpoch: 0
			})
		).resolves.toEqual({ ok: true });
		await expect(
			t.mutation(internal.blasts.verifyBlastCarrierBoundary, {
				blastId,
				observedRecipientCount: 3,
				expectedContactAuthorityEpoch: 0
			})
		).resolves.toEqual({ ok: false, reason: 'BLAST_CARRIER_AUTHORITY_ALREADY_ISSUED' });

		await expect(t.run((ctx) => ctx.db.get(blastId))).resolves.toMatchObject({
			status: 'sending',
			carrierAuthorityIssuedAt: NOW,
			carrierAuthorityEpoch: 0,
			carrierAuthorityRecipientCount: 3
		});
		await expect(t.run((ctx) => ctx.db.get(reservationId))).resolves.toMatchObject({
			status: 'active',
			remainingCount: 3
		});
	});

	it.each([
		['shrunk', 2],
		['grown', 4]
	] as const)(
		'refuses a %s mutable cohort and releases capacity before carrier authority',
		async (_, observed) => {
			const t = convexTest({ schema, modules });
			const { orgId } = await seedReadyOrg(t);
			const { blastId, reservationId } = await insertSendingBlastReservation(t, orgId, 3);

			await expect(
				t.mutation(internal.blasts.verifyBlastCarrierBoundary, {
					blastId,
					observedRecipientCount: observed,
					expectedContactAuthorityEpoch: 0
				})
			).resolves.toEqual({
				ok: false,
				reason: 'EMAIL_BLAST_COHORT_RESERVATION_PARITY_MISMATCH'
			});
			await expect(t.run((ctx) => ctx.db.get(blastId))).resolves.toMatchObject({
				status: 'failed'
			});
			expect((await t.run((ctx) => ctx.db.get(blastId)))?.carrierAuthorityIssuedAt).toBeUndefined();
			await expect(t.run((ctx) => ctx.db.get(reservationId))).resolves.toMatchObject({
				status: 'released',
				remainingCount: 0,
				releasedCount: 3
			});
			await expect(t.run((ctx) => ctx.db.get(orgId))).resolves.toMatchObject({
				emailReservedCount: 0
			});
		}
	);

	it('invalidates a materialized cohort when contact authority changes before the grant', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedReadyOrg(t);
		const { blastId, reservationId } = await insertSendingBlastReservation(t, orgId, 2);
		await t.run(async (ctx) => {
			await ctx.db.insert('contactAuthorityEpochs', {
				key: 'global',
				epoch: 2,
				updatedAt: NOW
			});
		});

		await expect(
			t.mutation(internal.blasts.verifyBlastCarrierBoundary, {
				blastId,
				observedRecipientCount: 2,
				expectedContactAuthorityEpoch: 1
			})
		).resolves.toEqual({
			ok: false,
			reason: 'EMAIL_BLAST_COHORT_RESERVATION_PARITY_MISMATCH'
		});
		await expect(t.run((ctx) => ctx.db.get(reservationId))).resolves.toMatchObject({
			status: 'released',
			releasedCount: 2
		});
		expect((await t.run((ctx) => ctx.db.get(blastId)))?.carrierAuthorityIssuedAt).toBeUndefined();
	});
});
