/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest } from 'convex-test';

import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const responseEnvelope = Array.from({ length: 128 }, (_, index) => ({
	type: 'clicked_verify' as const,
	detail: `https://commons.email/v/existing-${index}`,
	confidence: 'observed',
	occurredAt: NOW + index
}));

async function seedFixture() {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const orgId = await ctx.db.insert('organizations', {
			name: 'Webhook Bounds Org',
			slug: 'webhook-bounds-org',
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			updatedAt: NOW
		});
		const campaignId = await ctx.db.insert('campaigns', {
			orgId,
			type: 'LETTER',
			title: 'Webhook bounds campaign',
			status: 'ACTIVE',
			debateEnabled: false,
			debateThreshold: 0,
			raisedAmountCents: 0,
			donorCount: 0,
			targetCountry: 'US',
			updatedAt: NOW
		});
		const deliveryOnlyId = await ctx.db.insert('campaignDeliveries', {
			campaignId,
			targetEmail: 'delivery@example.test',
			targetName: 'Delivery Only',
			targetTitle: 'Office',
			status: 'delivered',
			sesMessageId: 'ses-delivery-only',
			responses: responseEnvelope,
			createdAt: NOW
		});
		const decisionMakerId = await ctx.db.insert('decisionMakers', {
			type: 'legislator',
			name: 'Representative Bounds',
			lastName: 'Bounds',
			active: true,
			updatedAt: NOW
		});
		const billId = await ctx.db.insert('bills', {
			externalId: 'webhook-bounds-bill',
			jurisdiction: 'us-federal',
			jurisdictionLevel: 'federal',
			chamber: 'house',
			title: 'Webhook Bounds Act',
			status: 'introduced',
			statusDate: NOW,
			committees: [],
			sourceUrl: 'https://example.test/bill',
			topics: [],
			entities: [],
			updatedAt: NOW
		});
		const receiptDeliveryId = await ctx.db.insert('campaignDeliveries', {
			campaignId,
			decisionMakerId,
			billId,
			targetEmail: 'receipt@example.test',
			targetName: 'Representative Bounds',
			targetTitle: 'Representative',
			status: 'delivered',
			sesMessageId: 'ses-receipt',
			createdAt: NOW
		});
		const receiptId = await ctx.db.insert('accountabilityReceipts', {
			decisionMakerId,
			dmName: 'Representative Bounds',
			billId,
			orgId,
			deliveryId: receiptDeliveryId,
			verifiedCount: 5,
			totalCount: 5,
			districtCount: 3,
			proofWeight: 1,
			attestationDigest: 'attestation',
			packetDigest: 'packet',
			proofDeliveredAt: NOW,
			causalityClass: 'pending',
			alignment: 0,
			status: 'pending_response',
			responses: responseEnvelope,
			updatedAt: NOW
		});
		return { deliveryOnlyId, receiptDeliveryId, receiptId };
	});
	return { t, ...ids };
}

describe('SES response history bounds', () => {
	it('fails explicitly without growing a full delivery-local response envelope', async () => {
		const { t, deliveryOnlyId } = await seedFixture();
		await expect(
			t.mutation(internal.webhooks.handleDeliveryEvent, {
				sesMessageId: 'ses-delivery-only',
				notificationType: 'Click',
				linkUrl: 'https://commons.email/v/new-proof'
			})
		).rejects.toThrow('CAMPAIGN_DELIVERY_RESPONSE_LIMIT_EXCEEDED');
		const delivery = await t.run((ctx) => ctx.db.get(deliveryOnlyId));
		expect(delivery?.responses).toHaveLength(128);
		expect(delivery?.status).toBe('delivered');
	});

	it('fails explicitly without growing a full accountability receipt envelope', async () => {
		const { t, receiptDeliveryId, receiptId } = await seedFixture();
		await expect(
			t.mutation(internal.webhooks.handleDeliveryEvent, {
				sesMessageId: 'ses-receipt',
				notificationType: 'Click',
				linkUrl: 'https://commons.email/v/new-proof'
			})
		).rejects.toThrow('ACCOUNTABILITY_RESPONSE_LIMIT_EXCEEDED');
		const [delivery, receipt] = await t.run(async (ctx) => [
			await ctx.db.get(receiptDeliveryId),
			await ctx.db.get(receiptId)
		]);
		expect(receipt?.responses).toHaveLength(128);
		expect(delivery?.status).toBe('delivered');
	});

	it('keeps a duplicate retry idempotent even when the envelope is full', async () => {
		const { t, receiptId } = await seedFixture();
		await expect(
			t.mutation(internal.webhooks.handleDeliveryEvent, {
				sesMessageId: 'ses-receipt',
				notificationType: 'Click',
				linkUrl: 'https://commons.email/v/existing-0'
			})
		).resolves.toEqual({ found: true });
		expect((await t.run((ctx) => ctx.db.get(receiptId)))?.responses).toHaveLength(128);
	});
});
