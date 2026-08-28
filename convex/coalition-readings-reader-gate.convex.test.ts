/// <reference types="vite/client" />

/**
 * The paying-reader gate on the signed-in coalition surface.
 *
 * `/org/[slug]/networks/[networkId]` is the primary product surface for the
 * coalition readings, and it reaches `networks.getStats` on the `orgSlug`
 * branch — no internal secret, no API key, just a member of a member org. This
 * suite exercises that branch end to end against a real Convex transaction:
 * membership alone must not buy the empirical models, and a caller must not be
 * able to borrow a paying org's entitlement by naming it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const TOKEN = 'coalition-reader-gate-token';
type Harness = TestConvex<typeof schema>;

function orgValue(name: string, slug: string) {
	return {
		name,
		slug,
		maxSeats: 10,
		maxTemplatesMonth: 100,
		dmCacheTtlDays: 30,
		countryCode: 'US',
		isPublic: true,
		updatedAt: NOW
	};
}

type Fixture = {
	networkId: Id<'orgNetworks'>;
	readerOrgId: Id<'organizations'>;
	payingOrgId: Id<'organizations'>;
};

async function seed(t: Harness): Promise<Fixture> {
	return await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier: TOKEN,
			email: 'reader@example.test',
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
		const readerOrgId = await ctx.db.insert('organizations', orgValue('Reader Org', 'reader-org'));
		const payingOrgId = await ctx.db.insert(
			'organizations',
			orgValue('Paying Partner', 'paying-partner')
		);
		await ctx.db.insert('orgMemberships', {
			userId,
			orgId: readerOrgId,
			role: 'member',
			joinedAt: NOW - 10
		});
		// The partner org pays. The reader org does not — and never learns the
		// difference except by asking for a reading.
		await ctx.db.insert('subscriptions', {
			orgId: payingOrgId,
			plan: 'coalition',
			priceCents: 20_000,
			status: 'active',
			currentPeriodStart: NOW,
			currentPeriodEnd: NOW + 30 * 24 * 60 * 60 * 1000,
			paymentMethod: 'stripe',
			updatedAt: NOW
		});
		const networkId = await ctx.db.insert('orgNetworks', {
			name: 'Reader Gate Coalition',
			slug: 'reader-gate-coalition',
			ownerOrgId: payingOrgId,
			status: 'active',
			applicableCountries: ['US'],
			coalitionMembershipRevision: 1,
			updatedAt: NOW
		});
		for (const orgId of [readerOrgId, payingOrgId]) {
			await ctx.db.insert('orgNetworkMembers', {
				networkId,
				orgId,
				role: orgId === payingOrgId ? 'admin' : 'member',
				status: 'active',
				joinedAt: NOW - 5
			});
		}
		await ctx.db.insert('coalitionMetricsMigrations', {
			key: 'v1',
			status: 'ready',
			runToken: 'reader-gate',
			phase: 'complete',
			scannedSupporters: 0,
			projectedSupporters: 0,
			scannedActions: 0,
			projectedActions: 0,
			scannedReceipts: 0,
			projectedReceipts: 0,
			networksScheduled: 1,
			networksReady: 1,
			startedAt: NOW,
			completedAt: NOW,
			updatedAt: NOW
		});
		await ctx.db.insert('coalitionNetworkAggregates', {
			networkId,
			version: 1,
			status: 'ready',
			activeGeneration: 1,
			revision: 4,
			memberCount: 2,
			totalSupporters: 300,
			uniqueSupporters: 300,
			verifiedSupporters: 300,
			totalCampaignActions: 300,
			verifiedCampaignActions: 300,
			messageHashedTotal: 300,
			uniqueMessages: 300,
			districtCount: 300,
			districtSquareSum: 300,
			hourCountXLogXSum: 300,
			tier1: 100,
			tier3: 100,
			tier4: 100,
			stateDistribution: [{ code: 'US', count: 300 }],
			stateDistributionOtherCount: 0,
			gds: 0.99,
			ald: 1,
			temporalEntropy: 4,
			cai: 2,
			updatedAt: NOW
		});
		return { networkId, readerOrgId, payingOrgId };
	});
}

function asReader(t: Harness) {
	return t.withIdentity({
		subject: 'coalition-reader',
		issuer: 'https://issuer.example',
		tokenIdentifier: TOKEN,
		email: 'reader@example.test'
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('signed-in coalition reader — membership does not buy the empirical models', () => {
	it('withholds the readings from an active member org with no subscription row', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seed(t);
		const stats = await asReader(t).query(api.networks.getStats, {
			networkId: fixture.networkId,
			orgSlug: 'reader-org'
		});
		expect(stats.readingsWithheld).toBe(true);
		expect(stats.gds).toBeNull();
		expect(stats.ald).toBeNull();
		expect(stats.temporalEntropy).toBeNull();
		expect(stats.cai).toBeNull();
		// Everything that is not an empirical model still arrives.
		expect(stats.memberCount).toBe(2);
		expect(stats.verifiedSupporters).toBe(300);
		expect(stats.districtCount).toBe(300);
		expect(stats.stateDistribution).toEqual({ US: 300 });
		expect(stats.revision).toBe(4);
	});

	it('returns the readings once that same org is paying', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seed(t);
		await t.run(async (ctx) => {
			await ctx.db.insert('subscriptions', {
				orgId: fixture.readerOrgId,
				plan: 'starter',
				priceCents: 1_000,
				status: 'active',
				currentPeriodStart: NOW,
				currentPeriodEnd: NOW + 30 * 24 * 60 * 60 * 1000,
				paymentMethod: 'stripe',
				updatedAt: NOW
			});
		});
		const stats = await asReader(t).query(api.networks.getStats, {
			networkId: fixture.networkId,
			orgSlug: 'reader-org'
		});
		expect(stats.readingsWithheld).toBe(false);
		expect(stats.gds).toBeCloseTo(0.99, 10);
		expect(stats.ald).toBe(1);
		expect(stats.temporalEntropy).toBe(4);
		expect(stats.cai).toBe(2);
		// The floored counts are reader-independent — identical either way.
		expect(stats.memberCount).toBe(2);
		expect(stats.verifiedSupporters).toBe(300);
		expect(stats.districtCount).toBe(300);
		expect(stats.stateDistribution).toEqual({ US: 300 });
	});

	it('refuses to borrow a paying org entitlement named by the caller', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seed(t);
		const stats = await asReader(t).query(api.networks.getStats, {
			networkId: fixture.networkId,
			orgSlug: 'reader-org',
			// The escalation attempt: a signed-in caller from the unpaid org names
			// the paying partner as the reader. `readerOrgId` is honoured only on
			// the internal-secret branch, so this argument changes nothing.
			readerOrgId: fixture.payingOrgId
		});
		expect(stats.readingsWithheld).toBe(true);
		expect(stats.gds).toBeNull();
		expect(stats.ald).toBeNull();
		expect(stats.temporalEntropy).toBeNull();
		expect(stats.cai).toBeNull();
	});

	it('reports a coalition with nothing computed as absent, not as withheld', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seed(t);
		// The day-one state of every coalition: member orgs have taken no actions,
		// so the aggregate is ready and generation-bearing but carries no readings.
		await t.run(async (ctx) => {
			const aggregate = await ctx.db
				.query('coalitionNetworkAggregates')
				.withIndex('by_networkId', (q) => q.eq('networkId', fixture.networkId))
				.unique();
			if (!aggregate) throw new Error('fixture aggregate missing');
			await ctx.db.patch(aggregate._id, {
				gds: undefined,
				ald: undefined,
				temporalEntropy: undefined,
				cai: undefined
			});
		});
		const stats = await asReader(t).query(api.networks.getStats, {
			networkId: fixture.networkId,
			orgSlug: 'reader-org'
		});
		// Nothing exists to withhold, so the unpaid reader is told nothing is on
		// record — the same fact a paying reader would get, not a purchase prompt.
		expect(stats.readingsWithheld).toBe(false);
		expect(stats.gds).toBeNull();
		expect(stats.ald).toBeNull();
		expect(stats.temporalEntropy).toBeNull();
		expect(stats.cai).toBeNull();
		// The census survives untouched.
		expect(stats.memberCount).toBe(2);
		expect(stats.verifiedSupporters).toBe(300);
		expect(stats.districtCount).toBe(300);
		expect(stats.stateDistribution).toEqual({ US: 300 });
	});
});
