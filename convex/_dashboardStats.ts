/**
 * Shared bounded reads for the org dashboard aggregates.
 *
 * Both the always-on funnel (organizations.getDashboardStats) and the lazy
 * district-of-record query (supporters.getDistrictVerifiedCount) need distinct
 * supporters with at least one verified action carrying a districtHash. That is
 * SET cardinality, not a per-row scalar, so it can't be a denormalized counter
 * without double-counting a supporter active in two districts. It is computed
 * on demand here — but the scan is CAPPED so it can never throw the per-query
 * document-cap error the way an unbounded .collect() does once an org passes
 * ~16K actions. When the cap saturates, `truncated` is surfaced so the consumer
 * can present a floor (">= N") instead of a wrong exact number.
 *
 * Factored into one path so the two callers share a single bounded scan rather
 * than each rebuilding it (and drifting on the cap).
 */

import type { QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

/** Cap on the district-of-record scan. Bounded so it never hits the doc cap. */
export const DISTRICT_SCAN_CAP = 10_000;

export interface DistrictVerifiedResult {
	districtVerified: number;
	truncated: boolean;
	scanLimit: number;
}

/**
 * Distinct supporters with a verified action carrying a districtHash, bounded
 * to DISTRICT_SCAN_CAP actions (most recent first). `truncated` is true when the
 * org has more verified actions than the cap, so the count is a floor.
 */
export async function computeDistrictVerified(
	ctx: QueryCtx,
	orgId: Id<'organizations'>
): Promise<DistrictVerifiedResult> {
	const scanned = await ctx.db
		.query('campaignActions')
		.withIndex('by_orgId_verified', (idx) => idx.eq('orgId', orgId).eq('verified', true))
		.order('desc')
		.take(DISTRICT_SCAN_CAP + 1);

	const truncated = scanned.length > DISTRICT_SCAN_CAP;
	const districtSupporters = new Set<string>();
	for (const action of scanned.slice(0, DISTRICT_SCAN_CAP)) {
		if (action.supporterId && action.districtHash) {
			districtSupporters.add(action.supporterId);
		}
	}

	return {
		districtVerified: districtSupporters.size,
		truncated,
		scanLimit: DISTRICT_SCAN_CAP
	};
}

/** Cap on each week's verified-action range read for the growth window. */
export const GROWTH_WEEK_CAP = 10_000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface GrowthWindow {
	/** Verified actions with sentAt >= (now - WEEK_MS), capped. */
	thisWeek: number;
	/** Verified actions with (now - 2*WEEK_MS) <= sentAt < (now - WEEK_MS), capped. */
	lastWeek: number;
	/** True if either week saturated the cap (count is then a floor). */
	thisWeekTruncated: boolean;
	lastWeekTruncated: boolean;
}

/**
 * Verified-action counts for this week vs last week via two BOUNDED sentAt range
 * reads on `by_orgId_verified_sentAt`. Each read is capped at GROWTH_WEEK_CAP + 1:
 * one week's volume is bounded, never the lifetime table, so this never collects
 * the whole history. If a week saturates the cap the count is surfaced as a floor.
 */
export async function computeGrowthWindow(
	ctx: QueryCtx,
	orgId: Id<'organizations'>,
	now: number = Date.now()
): Promise<GrowthWindow> {
	const thisWeekStart = now - WEEK_MS;
	const lastWeekStart = now - 2 * WEEK_MS;

	const thisWeekRows = await ctx.db
		.query('campaignActions')
		.withIndex('by_orgId_verified_sentAt', (idx) =>
			idx.eq('orgId', orgId).eq('verified', true).gte('sentAt', thisWeekStart)
		)
		.take(GROWTH_WEEK_CAP + 1);

	const lastWeekRows = await ctx.db
		.query('campaignActions')
		.withIndex('by_orgId_verified_sentAt', (idx) =>
			idx
				.eq('orgId', orgId)
				.eq('verified', true)
				.gte('sentAt', lastWeekStart)
				.lt('sentAt', thisWeekStart)
		)
		.take(GROWTH_WEEK_CAP + 1);

	const thisWeekTruncated = thisWeekRows.length > GROWTH_WEEK_CAP;
	const lastWeekTruncated = lastWeekRows.length > GROWTH_WEEK_CAP;

	return {
		thisWeek: Math.min(thisWeekRows.length, GROWTH_WEEK_CAP),
		lastWeek: Math.min(lastWeekRows.length, GROWTH_WEEK_CAP),
		thisWeekTruncated,
		lastWeekTruncated
	};
}
