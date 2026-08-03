/**
 * One home for what a public template aggregate may reveal, and what shape it
 * has on disk.
 *
 * Suppression floors. Public counters K-floor at 5 (3 for unique districts):
 * a published count of 1-4 names a small cohort, and a sub-K cohort size
 * identifies specific submitters. Above the floor, counts are exact —
 * template visibility is the product. Array-bucket fields (daily arrivals,
 * trust-tier counts) zero their sub-K entries rather than nulling the field,
 * so a singleton day cannot reveal that day's only sender while the shape of
 * the series stays readable. District rows below the floor drop out of the
 * public payload entirely and are re-reported only as suppressed totals, so
 * consumers see the visible shape without the thin-cohort contributions.
 * Routing every public mapper through these helpers is what keeps org pages,
 * share cards, the public API, and future surfaces on one policy instead of
 * each re-implementing the floor.
 *
 * Aggregate shape. The rolling arrival window, the district-count cap, the
 * trust-tier bucket count, and the day-bucket width live here because two
 * writers patch the same template fields: the live delivery counter and the
 * historical backfill. When their notions of the window size disagree, the
 * next verified send silently zeroes the whole arrival history — a size
 * disagreement is data loss, not a type error, so the two writers must read
 * one symbol.
 *
 * This module deliberately uses only language built-ins so the SvelteKit HTTP
 * boundary and the Convex runtime can enforce one identical policy.
 */

export const PUBLIC_COUNTER_K_FLOOR = 5;
export const PUBLIC_DISTRICT_K_FLOOR = 3;
export const TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS = 30;
export const TEMPLATE_DISTRICT_COUNT_CAP = 500;
export const TRUST_TIER_BUCKET_COUNT = 6;
export const DAILY_ARRIVAL_BUCKET_MS = 86_400_000;

export interface DistrictCountRow {
	code: string;
	count: number;
}

/** Publish an exact counter at or above the floor; below it, publish nothing. */
export function kFloorCounter(count: number): number | null {
	return count < PUBLIC_COUNTER_K_FLOOR ? null : count;
}

/** The unique-district counter carries its own, lower floor. */
export function kFloorDistrictCount(count: number): number | null {
	return count < PUBLIC_DISTRICT_K_FLOOR ? null : count;
}

/** Bucket form of the counter floor: array entries zero instead of nulling. */
export function zeroBelowCounterFloor(count: number): number {
	return count < PUBLIC_COUNTER_K_FLOOR ? 0 : count;
}

/**
 * Split per-district rows into what the public payload carries and what it
 * withholds. One predicate, so the two halves can never be changed apart.
 */
export function partitionDistrictCountsByFloor(rows: readonly DistrictCountRow[]): {
	visible: DistrictCountRow[];
	suppressed: DistrictCountRow[];
} {
	const visible: DistrictCountRow[] = [];
	const suppressed: DistrictCountRow[] = [];
	for (const row of rows) {
		if (row.count >= PUBLIC_COUNTER_K_FLOOR) visible.push(row);
		else suppressed.push(row);
	}
	return { visible, suppressed };
}

/** A fresh, caller-owned arrival window. Call sites mutate the result. */
export function emptyDailyArrivalWindow(): number[] {
	return new Array<number>(TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS).fill(0);
}

/** True when a stored arrival window is the shape both writers agree on. */
export function isDailyArrivalWindowShape(arrivals: readonly number[]): boolean {
	return arrivals.length === TEMPLATE_DAILY_ARRIVAL_WINDOW_DAYS;
}

/** A fresh, caller-owned tier-bucket array. Call sites mutate the result. */
export function emptyTrustTierBuckets(): number[] {
	return new Array<number>(TRUST_TIER_BUCKET_COUNT).fill(0);
}

/** True when a stored tier-bucket array is the shape both writers agree on. */
export function isTrustTierBucketShape(buckets: readonly number[]): boolean {
	return buckets.length === TRUST_TIER_BUCKET_COUNT;
}
