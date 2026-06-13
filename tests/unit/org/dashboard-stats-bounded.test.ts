/**
 * getDashboardStats reads counters + bounded ranges — never an unbounded scan.
 *
 * The handler previously `.collect()`ed every supporter AND every verified
 * campaignAction, which throws past the per-query document cap and 500s the
 * dashboard once an org passes ~16K of either. It now:
 *   - reads the supporter funnel (imported/postalResolved/identityVerified) from
 *     the O(1) org.supporterStats counters,
 *   - reads the engagement-tier histogram from the O(1) monotonic
 *     org.actionTierCounts counter (engagementTier is immutable post-creation),
 *   - computes districtVerified via the SHARED bounded scan (computeDistrictVerified,
 *     capped at 10K) — the same path getDistrictVerifiedCount uses,
 *   - computes growth via two BOUNDED sentAt range reads (computeGrowthWindow),
 *     one week's volume each, never the lifetime table.
 *
 * convex-test isn't wired in this repo, so these exercise the real helpers
 * against a fake ctx.db query chain that RECORDS the index + bound predicates —
 * so we pin both the behavior and the source invariant that no scalable
 * collection is `.collect()`ed (the chain throws if `.collect()` is reached).
 */

import { describe, it, expect } from 'vitest';
import {
	computeDistrictVerified,
	computeGrowthWindow,
	DISTRICT_SCAN_CAP,
	GROWTH_WEEK_CAP,
	WEEK_MS
} from '../../../convex/_dashboardStats';

type Row = { supporterId?: string; districtHash?: string; verified?: boolean; sentAt?: number };

interface Recorded {
	index: string;
	eqs: Record<string, unknown>;
	gte?: { field: string; value: number };
	lt?: { field: string; value: number };
	ordered?: 'asc' | 'desc';
	takeN?: number;
}

/**
 * Minimal fake of the Convex query chain. `select` decides which rows the index
 * read returns given the recorded bounds; the fake records every call so the
 * test can assert the index/bounds and that `.collect()` is never reached.
 */
function fakeCtx(select: (r: Recorded, rows: Row[]) => Row[], rows: Row[]) {
	const calls: Recorded[] = [];
	return {
		calls,
		ctx: {
			db: {
				query(_table: string) {
					return {
						withIndex(name: string, fn: (q: unknown) => unknown) {
							const rec: Recorded = { index: name, eqs: {} };
							const q = {
								eq(field: string, value: unknown) {
									rec.eqs[field] = value;
									return q;
								},
								gte(field: string, value: number) {
									rec.gte = { field, value };
									return q;
								},
								lt(field: string, value: number) {
									rec.lt = { field, value };
									return q;
								}
							};
							fn(q);
							const builder = {
								order(dir: 'asc' | 'desc') {
									rec.ordered = dir;
									return builder;
								},
								async take(n: number) {
									rec.takeN = n;
									calls.push(rec);
									return select(rec, rows).slice(0, n);
								},
								async collect() {
									throw new Error(
										'getDashboardStats must not .collect() a scalable collection'
									);
								}
							};
							return builder;
						}
					};
				}
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any
	};
}

const ORG = 'org_1' as unknown as Parameters<typeof computeDistrictVerified>[1];

describe('computeDistrictVerified (shared bounded scan)', () => {
	it('counts distinct supporters with a districtHash, bounded by take(CAP+1)', async () => {
		const rows: Row[] = [
			{ supporterId: 'a', districtHash: 'd1' },
			{ supporterId: 'a', districtHash: 'd2' }, // same supporter, two districts → 1
			{ supporterId: 'b', districtHash: 'd1' },
			{ supporterId: 'c' }, // no districtHash → not counted
			{ districtHash: 'd3' } // no supporterId → not counted
		];
		const { ctx, calls } = fakeCtx((_r, rs) => rs, rows);
		const r = await computeDistrictVerified(ctx, ORG);
		expect(r.districtVerified).toBe(2);
		expect(r.truncated).toBe(false);
		expect(r.scanLimit).toBe(DISTRICT_SCAN_CAP);
		// Index + bound invariants: by_orgId_verified, desc, take(CAP+1).
		expect(calls).toHaveLength(1);
		expect(calls[0].index).toBe('by_orgId_verified');
		expect(calls[0].eqs.orgId).toBe(ORG);
		expect(calls[0].ordered).toBe('desc');
		expect(calls[0].takeN).toBe(DISTRICT_SCAN_CAP + 1);
	});

	it('flags truncated when the scan saturates the cap (count is a floor)', async () => {
		const rows: Row[] = Array.from({ length: DISTRICT_SCAN_CAP + 500 }, (_, i) => ({
			supporterId: `s${i}`,
			districtHash: `d${i}`
		}));
		const { ctx } = fakeCtx((_r, rs) => rs, rows);
		const r = await computeDistrictVerified(ctx, ORG);
		expect(r.truncated).toBe(true);
		expect(r.districtVerified).toBe(DISTRICT_SCAN_CAP);
	});

	it('an org exactly at the cap is complete, not truncated', async () => {
		const rows: Row[] = Array.from({ length: DISTRICT_SCAN_CAP }, (_, i) => ({
			supporterId: `s${i}`,
			districtHash: `d${i}`
		}));
		const { ctx } = fakeCtx((_r, rs) => rs, rows);
		const r = await computeDistrictVerified(ctx, ORG);
		expect(r.truncated).toBe(false);
		expect(r.districtVerified).toBe(DISTRICT_SCAN_CAP);
	});
});

describe('computeGrowthWindow (two bounded sentAt range reads)', () => {
	const NOW = 1_000_000_000_000;

	it('partitions verified actions into this-week vs last-week by sentAt range', async () => {
		const all: Row[] = [
			{ verified: true, sentAt: NOW - 1 * 60_000 }, // this week
			{ verified: true, sentAt: NOW - WEEK_MS + 1 }, // this week (edge, >= thisWeekStart)
			{ verified: true, sentAt: NOW - WEEK_MS - 60_000 }, // last week
			{ verified: true, sentAt: NOW - 2 * WEEK_MS + 60_000 }, // last week
			{ verified: true, sentAt: NOW - 3 * WEEK_MS } // older than both windows
		];
		// The fake honors the recorded gte/lt bounds so we exercise the real
		// range arithmetic, not a hand-fed split.
		const select = (rec: Recorded, rows: Row[]) =>
			rows.filter((row) => {
				if (row.sentAt === undefined) return false;
				if (rec.gte && row.sentAt < rec.gte.value) return false;
				if (rec.lt && row.sentAt >= rec.lt.value) return false;
				return true;
			});
		const { ctx, calls } = fakeCtx(select, all);
		const g = await computeGrowthWindow(ctx, ORG, NOW);
		expect(g.thisWeek).toBe(2);
		expect(g.lastWeek).toBe(2);
		expect(g.thisWeekTruncated).toBe(false);
		expect(g.lastWeekTruncated).toBe(false);

		// Two reads, both on the range index, both verified=true, both capped.
		expect(calls).toHaveLength(2);
		for (const c of calls) {
			expect(c.index).toBe('by_orgId_verified_sentAt');
			expect(c.eqs.orgId).toBe(ORG);
			expect(c.eqs.verified).toBe(true);
			expect(c.takeN).toBe(GROWTH_WEEK_CAP + 1);
		}
		// This-week read: gte thisWeekStart, no upper bound.
		expect(calls[0].gte?.value).toBe(NOW - WEEK_MS);
		expect(calls[0].lt).toBeUndefined();
		// Last-week read: [lastWeekStart, thisWeekStart).
		expect(calls[1].gte?.value).toBe(NOW - 2 * WEEK_MS);
		expect(calls[1].lt?.value).toBe(NOW - WEEK_MS);
	});

	it('surfaces a saturated week as a floor (truncated), never an unbounded count', async () => {
		const all: Row[] = Array.from({ length: GROWTH_WEEK_CAP + 50 }, () => ({
			verified: true,
			sentAt: NOW - 1_000
		}));
		const select = (rec: Recorded, rows: Row[]) =>
			rows.filter((row) => (rec.gte ? (row.sentAt ?? 0) >= rec.gte.value : true));
		const { ctx } = fakeCtx(select, all);
		const g = await computeGrowthWindow(ctx, ORG, NOW);
		expect(g.thisWeek).toBe(GROWTH_WEEK_CAP);
		expect(g.thisWeekTruncated).toBe(true);
	});
});

/**
 * Tier histogram is a monotonic org-level counter bumped once per insert in
 * createCampaignAction (engagementTier is immutable — no .patch/.replace of it
 * exists on campaignActions). This mirrors that bump + the getDashboardStats
 * read mapping, pinning correctness from zero and out-of-range rejection.
 */
describe('actionTierCounts monotonic histogram', () => {
	const TIER_LABELS = ['New', 'Active', 'Established', 'Veteran', 'Pillar'];

	/** Mirror of the createCampaignAction bump. */
	function bump(counts: number[] | undefined, tier: number): number[] {
		const next = [...(counts ?? [0, 0, 0, 0, 0])];
		while (next.length < 5) next.push(0);
		if (typeof tier === 'number' && tier >= 0 && tier <= 4) {
			next[tier] = (next[tier] ?? 0) + 1;
		}
		return next.slice(0, 5);
	}

	/** Mirror of the getDashboardStats read mapping. */
	function tiers(counts: number[] | undefined) {
		return TIER_LABELS.map((label, tier) => ({ tier, label, count: (counts ?? [])[tier] ?? 0 }));
	}

	it('an org with no actions yields an all-zero, 5-slot histogram', () => {
		const t = tiers(undefined);
		expect(t).toHaveLength(5);
		expect(t.every((x) => x.count === 0)).toBe(true);
		expect(t.map((x) => x.label)).toEqual(TIER_LABELS);
	});

	it('counts every action by tier from zero (verified and unverified alike)', () => {
		let c: number[] | undefined;
		c = bump(c, 0);
		c = bump(c, 2);
		c = bump(c, 2);
		c = bump(c, 4);
		expect(tiers(c).map((x) => x.count)).toEqual([1, 0, 2, 0, 1]);
	});

	it('ignores out-of-range tiers (no slot grows, no array extension)', () => {
		let c = bump(undefined, 2);
		c = bump(c, 7); // out of range → ignored
		c = bump(c, -1); // out of range → ignored
		expect(c).toHaveLength(5);
		expect(tiers(c).map((x) => x.count)).toEqual([0, 0, 1, 0, 0]);
	});

	it('pads a legacy short array to 5 slots without losing existing counts', () => {
		const c = bump([3, 1], 3); // legacy 2-slot doc
		expect(c).toEqual([3, 1, 0, 1, 0]);
	});
});
