/**
 * Shared bounded reads for the org dashboard aggregates.
 *
 * District-of-record cardinality is no longer computed here. The v2 supporter
 * audience projection maintains organizations.districtVerifiedSupporterCount
 * on first/last qualifying-action transitions, and its reader is readiness
 * gated. Keeping the old bounded action scan as an importable helper would make
 * it too easy for a future route to reintroduce 10,001-row reads.
 */

import type { QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

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
