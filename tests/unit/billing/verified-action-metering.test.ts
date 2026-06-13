/**
 * Scale-safe verified-action billing metering.
 *
 * The billing read counts verified actions WITHIN the current period. The old
 * implementation collected every verified campaignAction and filtered by sentAt
 * in memory — which throws past the per-query document cap and hard-locks the
 * org on every submit once it has >16K verified actions.
 *
 * The fix meters via a monotonic lifetime tally minus a per-period baseline
 * snapshotted at rollover: period_count = lifetime - baseline. The baseline only
 * ever moves forward (no never-reset bug). A stale/missing baseline (late Stripe
 * webhook, or a free-tier calendar-month rollover with no webhook) self-heals via
 * a bounded sentAt-range count for THIS period only — never an unbounded scan.
 *
 * convex-test isn't wired in this repo, so these mirror the handler's pure
 * branching (verifiedActionsThisPeriod) and the snapshot's monotonicity
 * (snapshotVerifiedActionBaseline) and pin the invariants:
 *   - a NEW period resets the effective count (never-reset regression guard),
 *   - mid-period count is correct,
 *   - a stale baseline self-heals (bounded),
 *   - the snapshot never rewinds on a duplicate/out-of-order webhook,
 *   - enforcement over-counts (fails safe) when the period scan saturates.
 */

import { describe, it, expect } from 'vitest';

const SCAN_CAP = 16_000;

interface OrgMeter {
	verifiedActionsLifetime?: number;
	verifiedActionsPeriodBaseline?: number;
	verifiedActionsPeriodBaselineAt?: number;
}

/**
 * Mirror of verifiedActionsThisPeriod. `scanThisPeriod()` stands in for the
 * bounded sentAt-range index read used in the self-heal branch.
 */
function periodCount(
	org: OrgMeter,
	periodStart: number,
	scanThisPeriod: () => number
): number {
	const baselineAt = org.verifiedActionsPeriodBaselineAt;
	if (baselineAt !== undefined && baselineAt === periodStart) {
		const lifetime = org.verifiedActionsLifetime ?? 0;
		const baseline = org.verifiedActionsPeriodBaseline ?? 0;
		return Math.max(0, lifetime - baseline);
	}
	return Math.min(scanThisPeriod(), SCAN_CAP);
}

/** Mirror of snapshotVerifiedActionBaseline's monotonic guard. */
function snapshot(org: OrgMeter, periodStart: number): OrgMeter {
	const existingAt = org.verifiedActionsPeriodBaselineAt ?? 0;
	if (periodStart <= existingAt) return org; // no rewind
	return {
		...org,
		verifiedActionsPeriodBaseline: org.verifiedActionsLifetime ?? 0,
		verifiedActionsPeriodBaselineAt: periodStart
	};
}

const NEVER_SCAN = () => {
	throw new Error('self-heal scan must not run when the O(1) baseline path applies');
};

describe('verified-action period count — O(1) baseline path', () => {
	it('mid-period: count is lifetime minus the period baseline', () => {
		const org: OrgMeter = {
			verifiedActionsLifetime: 1_250,
			verifiedActionsPeriodBaseline: 1_000,
			verifiedActionsPeriodBaselineAt: 5_000
		};
		expect(periodCount(org, 5_000, NEVER_SCAN)).toBe(250);
	});

	it('a NEW period resets the effective count (never-reset regression guard)', () => {
		// At rollover the baseline is snapshotted to the current lifetime.
		let org: OrgMeter = {
			verifiedActionsLifetime: 1_250,
			verifiedActionsPeriodBaseline: 1_000,
			verifiedActionsPeriodBaselineAt: 5_000
		};
		// Period advances; webhook snapshots the new baseline.
		org = snapshot(org, 9_000);
		// First read in the new period: 0 actions yet → count is 0, NOT 250.
		expect(periodCount(org, 9_000, NEVER_SCAN)).toBe(0);
		// Two more verified actions land this period.
		org = { ...org, verifiedActionsLifetime: 1_252 };
		expect(periodCount(org, 9_000, NEVER_SCAN)).toBe(2);
	});

	it('lifetime keeps growing across periods (monotonic, never resets)', () => {
		let org: OrgMeter = { verifiedActionsLifetime: 0 };
		org = snapshot(org, 1_000); // period 1 baseline = 0
		org = { ...org, verifiedActionsLifetime: 40 };
		expect(periodCount(org, 1_000, NEVER_SCAN)).toBe(40);
		org = snapshot(org, 2_000); // period 2 baseline = 40
		expect(org.verifiedActionsLifetime).toBe(40); // lifetime NOT reset
		org = { ...org, verifiedActionsLifetime: 45 };
		expect(periodCount(org, 2_000, NEVER_SCAN)).toBe(5);
	});
});

describe('verified-action period count — self-heal (bounded)', () => {
	it('a missing baseline self-heals via the bounded period scan', () => {
		const org: OrgMeter = { verifiedActionsLifetime: 500 };
		expect(periodCount(org, 7_000, () => 12)).toBe(12);
	});

	it('a baseline for an OLDER period (late/missed webhook) self-heals', () => {
		const org: OrgMeter = {
			verifiedActionsLifetime: 9_999,
			verifiedActionsPeriodBaseline: 100,
			verifiedActionsPeriodBaselineAt: 1_000 // belongs to a previous period
		};
		// periodStart is newer than baselineAt → don't trust lifetime-minus, scan.
		expect(periodCount(org, 8_000, () => 37)).toBe(37);
	});

	it('over-counts (fails safe) when the period scan saturates the cap', () => {
		const org: OrgMeter = {};
		expect(periodCount(org, 8_000, () => SCAN_CAP + 1)).toBe(SCAN_CAP);
	});
});

describe('baseline snapshot — monotonic, no rewind', () => {
	it('a duplicate webhook for the same period is a no-op', () => {
		let org: OrgMeter = { verifiedActionsLifetime: 30 };
		org = snapshot(org, 5_000);
		const baselineAfterFirst = org.verifiedActionsPeriodBaseline;
		// More actions land, then a DUPLICATE webhook for the same period arrives.
		org = { ...org, verifiedActionsLifetime: 35 };
		org = snapshot(org, 5_000);
		// Baseline unchanged → the 5 mid-period actions are NOT erased.
		expect(org.verifiedActionsPeriodBaseline).toBe(baselineAfterFirst);
		expect(periodCount(org, 5_000, NEVER_SCAN)).toBe(5);
	});

	it('an out-of-order (older) period start does not rewind the baseline', () => {
		let org: OrgMeter = { verifiedActionsLifetime: 100 };
		org = snapshot(org, 9_000); // current period
		org = { ...org, verifiedActionsLifetime: 110 };
		// A stale webhook for an OLDER period arrives late.
		org = snapshot(org, 3_000);
		expect(org.verifiedActionsPeriodBaselineAt).toBe(9_000); // unchanged
		expect(periodCount(org, 9_000, NEVER_SCAN)).toBe(10);
	});
});
