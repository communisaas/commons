/**
 * Projection-only plan metering contracts.
 *
 * Runtime migration/repair behavior is covered by
 * convex/plan-usage-projection.convex.test.ts. These unit tests pin the pure
 * hot-read boundary: it is constant-cardinality, rejects stale/malformed
 * projections, and never performs a request-path history scan.
 */

import { describe, expect, it } from 'vitest';

import type { Doc } from '../../../convex/_generated/dataModel';
import {
	PLAN_USAGE_PERIOD_CLOCK_SKEW_MS,
	planUsagePeriodStart,
	projectedPlanUsageForPeriod
} from '../../../convex/lib/planUsage';

const PERIOD_START = Date.parse('2026-07-01T00:00:00.000Z');
const NOW = Date.parse('2026-07-19T12:00:00.000Z');

function organization(overrides: Partial<Doc<'organizations'>> = {}): Doc<'organizations'> {
	return {
		_id: 'org' as Doc<'organizations'>['_id'],
		_creationTime: NOW,
		name: 'Metered Org',
		slug: 'metered-org',
		maxSeats: 5,
		maxTemplatesMonth: 100,
		dmCacheTtlDays: 30,
		countryCode: 'US',
		updatedAt: NOW,
		verifiedActionsLifetime: 1_250,
		verifiedActionsPeriodBaseline: 1_000,
		verifiedActionsPeriodBaselineAt: PERIOD_START,
		sentEmailCount: 500,
		sentEmailPeriodBaseline: 400,
		sentEmailPeriodBaselineAt: PERIOD_START,
		emailReservedCount: 10,
		emailReservationPeriodStart: PERIOD_START,
		emailReservationState: 'ready',
		smsSentCount: 80,
		smsSentPeriodBaseline: 60,
		smsSentPeriodBaselineAt: PERIOD_START,
		...overrides,
		isPublic: overrides.isPublic ?? false
	};
}

function subscription(overrides: Partial<Doc<'subscriptions'>> = {}): Doc<'subscriptions'> {
	return {
		_id: 'subscription' as Doc<'subscriptions'>['_id'],
		_creationTime: NOW,
		plan: 'starter',
		priceCents: 1_000,
		status: 'active',
		paymentMethod: 'stripe',
		currentPeriodStart: PERIOD_START,
		currentPeriodEnd: Date.parse('2026-08-01T00:00:00.000Z'),
		updatedAt: NOW,
		...overrides
	};
}

describe('projection-only plan usage hot read', () => {
	it('subtracts the three exact period baselines without source history', () => {
		expect(projectedPlanUsageForPeriod(organization(), PERIOD_START)).toEqual({
			verifiedActions: 250,
			emailsSent: 100,
			emailsReserved: 10,
			smsSent: 20
		});
	});

	it('fails closed when any projection belongs to another period', () => {
		expect(() =>
			projectedPlanUsageForPeriod(
				organization({ smsSentPeriodBaselineAt: PERIOD_START - 1 }),
				PERIOD_START
			)
		).toThrow('PLAN_USAGE_NOT_READY:period');
	});

	it('rejects malformed counters and baselines ahead of lifetime', () => {
		expect(() =>
			projectedPlanUsageForPeriod(organization({ sentEmailCount: -1 }), PERIOD_START)
		).toThrow('PLAN_USAGE_INVALID:emailLifetime');
		expect(() =>
			projectedPlanUsageForPeriod(
				organization({ smsSentPeriodBaseline: 81 }),
				PERIOD_START
			)
		).toThrow('PLAN_USAGE_INVALID:baseline_ahead');
	});

	it('fails closed while durable email reservation accounting is not ready', () => {
		expect(() =>
			projectedPlanUsageForPeriod(
				organization({ emailReservationState: 'blocked', emailReservationFailureCode: 'evidence' }),
				PERIOD_START
			)
		).toThrow('PLAN_USAGE_RESERVATION_BLOCKED:evidence');
	});
});

describe('authoritative plan period', () => {
	it('uses the active Stripe period and rejects an early future reset', () => {
		expect(planUsagePeriodStart(subscription(), NOW)).toBe(PERIOD_START);
		expect(() =>
			planUsagePeriodStart(
				subscription({ currentPeriodStart: NOW + PLAN_USAGE_PERIOD_CLOCK_SKEW_MS + 1 }),
				NOW
			)
		).toThrow('PLAN_USAGE_INVALID:periodStart');
	});

	it('uses the UTC calendar month for inactive organizations', () => {
		expect(planUsagePeriodStart(subscription({ status: 'canceled' }), NOW)).toBe(PERIOD_START);
	});
});
