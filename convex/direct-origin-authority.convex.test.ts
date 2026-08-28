/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { makeFunctionReference, type FunctionReference } from 'convex/server';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'direct-origin-authority-secret-32-byte-padding';
const NOW = Date.parse('2026-07-20T12:00:00.000Z');
type Harness = TestConvex<typeof schema>;

const verifyWithoutSecret = makeFunctionReference<'query'>(
	'verify:getCampaignForVerify'
) as unknown as FunctionReference<'query', 'public', { campaignId: string }, unknown>;

async function seedPublicRows(t: Harness): Promise<{
	eventId: Id<'events'>;
	campaignId: Id<'campaigns'>;
	decisionMakerId: Id<'decisionMakers'>;
}> {
	return await t.run(async (ctx) => {
		const orgId = await ctx.db.insert('organizations', {
			name: 'Direct Origin Authority Org',
			slug: 'direct-origin-authority',
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: true,
			updatedAt: NOW
		});
		const eventId = await ctx.db.insert('events', {
			orgId,
			title: 'Authority Town Hall',
			eventType: 'IN_PERSON',
			startAt: NOW + 86_400_000,
			timezone: 'UTC',
			waitlistEnabled: false,
			rsvpCount: 0,
			goingCount: 0,
			maybeCount: 0,
			attendeeCount: 0,
			verifiedAttendees: 0,
			requireVerification: false,
			status: 'PUBLISHED',
			updatedAt: NOW
		});
		const campaignId = await ctx.db.insert('campaigns', {
			orgId,
			type: 'FUNDRAISER',
			title: 'Authority Fundraiser',
			status: 'ACTIVE',
			debateEnabled: false,
			debateThreshold: 50,
			raisedAmountCents: 0,
			donorCount: 0,
			targetCountry: 'US',
			goalAmountCents: 100_000,
			donationCurrency: 'usd',
			updatedAt: NOW
		});
		const decisionMakerId = await ctx.db.insert('decisionMakers', {
			type: 'legislator',
			name: 'Retired Surface Representative',
			lastName: 'Representative',
			jurisdiction: 'US',
			active: true,
			updatedAt: NOW
		});
		return { eventId, campaignId, decisionMakerId };
	});
}

describe('direct Convex origin authority', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('rejects omitted and wrong server credentials before serving public rows', async () => {
		const t = convexTest(schema, modules);
		const { eventId, campaignId } = await seedPublicRows(t);

		await expect(t.query(verifyWithoutSecret, { campaignId })).rejects.toThrow(/_secret/);
		await expect(t.query(api.events.getPublic, { _secret: 'wrong', eventId })).rejects.toThrow(
			'Unauthorized'
		);
		await expect(
			t.query(api.verify.getCampaignForVerify, {
				_secret: 'wrong',
				campaignId
			})
		).rejects.toThrow('Unauthorized');

		await expect(
			t.query(api.events.getPublic, { _secret: SECRET, eventId })
		).resolves.toMatchObject({
			_id: eventId,
			title: 'Authority Town Hall'
		});
		await expect(
			t.query(api.campaigns.getPublic, { _secret: SECRET, campaignId })
		).resolves.toMatchObject({ _id: campaignId, type: 'FUNDRAISER' });
	});

	it('rejects donation work before campaign/provider access when the secret is wrong', async () => {
		const t = convexTest(schema, modules);
		const { campaignId } = await seedPublicRows(t);
		await expect(
			t.action(api.donations.processCheckout, {
				_secret: 'wrong',
				campaignId,
				email: 'donor@example.test',
				name: 'Donor',
				amountCents: 500,
				recurring: false,
				successUrl: 'https://example.test/success',
				cancelUrl: 'https://example.test/cancel'
			})
		).rejects.toThrow('Unauthorized');
	});

	it('keeps retired high-I/O browse functions as pre-I/O coded tombstones', async () => {
		const t = convexTest(schema, modules);
		const { decisionMakerId } = await seedPublicRows(t);
		await expect(t.query(api.legislation.listBills, {})).rejects.toThrow(
			'LEGISLATION_PUBLIC_BILL_LIST_RETIRED'
		);
		await expect(t.query(api.legislation.getScorecard, { decisionMakerId })).rejects.toThrow(
			'LEGISLATION_PUBLIC_SCORECARD_HISTORY_RETIRED'
		);
	});
});
