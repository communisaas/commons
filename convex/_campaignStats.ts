/**
 * Shared bounded reads for per-campaign aggregates.
 *
 * A campaign's `campaignActions` collection grows with supporter activity, so
 * an unbounded `.collect()` over `by_campaignId` throws past the per-query
 * ~16K document cap once a campaign passes that many actions. Two distinct
 * shapes need different treatment (the Wave-1 discipline):
 *
 *   - PURE SUMS (verified count, tier-3 verified count, total count) are served
 *     by the denormalized campaign counters maintained in `createCampaignAction`
 *     (verifiedActionCount / tier3VerifiedActionCount / actionCount). A scalar
 *     counter is exact for a per-row tally that only increments on insert.
 *
 *   - SET CARDINALITY (distinct verified districts, distinct tier-3 districts)
 *     CANNOT be a scalar counter — a supporter active in two districts would be
 *     double-counted. It is computed on demand here via a BOUNDED scan over the
 *     `by_campaignId_verified` index (verified actions only, capped), mirroring
 *     `_dashboardStats.computeDistrictVerified`. When the cap saturates,
 *     `truncated` is surfaced so the consumer presents a floor.
 */

import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Cap on the per-campaign verified-action district scan. Bounded so it never hits the doc cap. */
export const CAMPAIGN_DISTRICT_SCAN_CAP = 10_000;

export interface CampaignDistrictSets {
  /** Distinct districtHashes across verified actions, bounded by the scan cap. */
  verifiedDistricts: number;
  /** Distinct districtHashes across tier-3+ verified actions, bounded by the scan cap. */
  tier3VerifiedDistricts: number;
  /** True when the verified-action scan saturated the cap (counts are then floors). */
  truncated: boolean;
  scanLimit: number;
}

/**
 * Distinct verified districts and distinct tier-3+ verified districts for one
 * campaign, computed from a single BOUNDED scan over `by_campaignId_verified`
 * (verified actions only, capped at CAMPAIGN_DISTRICT_SCAN_CAP). Set cardinality
 * — not a counter — so it never double-counts a supporter active in two
 * districts. `truncated` is true when the scan saturates the cap.
 */
export async function computeCampaignDistrictSets(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
): Promise<CampaignDistrictSets> {
  const scanned = await ctx.db
    .query("campaignActions")
    .withIndex("by_campaignId_verified", (idx) => idx.eq("campaignId", campaignId).eq("verified", true))
    .take(CAMPAIGN_DISTRICT_SCAN_CAP + 1);

  const truncated = scanned.length > CAMPAIGN_DISTRICT_SCAN_CAP;
  const verifiedDistrictSet = new Set<string>();
  const tier3DistrictSet = new Set<string>();
  for (const action of scanned.slice(0, CAMPAIGN_DISTRICT_SCAN_CAP)) {
    if (!action.districtHash) continue;
    verifiedDistrictSet.add(action.districtHash);
    if ((action.trustTier ?? 0) >= 3) {
      tier3DistrictSet.add(action.districtHash);
    }
  }

  return {
    verifiedDistricts: verifiedDistrictSet.size,
    tier3VerifiedDistricts: tier3DistrictSet.size,
    truncated,
    scanLimit: CAMPAIGN_DISTRICT_SCAN_CAP,
  };
}
