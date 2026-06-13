/**
 * Per-campaign district-set + per-tag counts are BOUNDED reads — never an
 * unbounded `.collect()`.
 *
 * - `computeCampaignDistrictSets` (sub-class C, set cardinality): distinct
 *   verified districts can't be a scalar counter (a supporter active in two
 *   districts double-counts), so it's a bounded scan over `by_campaignId_verified`
 *   with a truncated floor. Pinned: the index/bound invariants, distinct counting
 *   (no double-count), tier-3 subset, and truncation.
 * - `countTagSupporters` / `collectTagSupporterIds` (sub-class B, pure count /
 *   bounded membership): a popular tag's link set can exceed the per-query doc
 *   cap, so both use `.take(cap+1)`. Pinned: count = link count, truncation
 *   floor, and that `.collect()` is never reached.
 *
 * convex-test isn't wired here, so these exercise the real helpers against a
 * fake `ctx.db` chain that records the index + `.take` bound and THROWS on
 * `.collect()`.
 */

import { describe, it, expect } from 'vitest';
import {
	computeCampaignDistrictSets,
	CAMPAIGN_DISTRICT_SCAN_CAP
} from '../../../convex/_campaignStats';
import { countTagSupporters, collectTagSupporterIds, TAG_SCAN_CAP } from '../../../convex/_tagCounts';

type ActionRow = { districtHash?: string; trustTier?: number; verified?: boolean };
type LinkRow = { supporterId: string };

interface Recorded {
	index: string;
	eqs: Record<string, unknown>;
	takeN?: number;
}

function fakeCtx(rows: Array<ActionRow | LinkRow>) {
	const calls: Recorded[] = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ctx: any = {
		db: {
			query(_table: string) {
				return {
					withIndex(name: string, fn: (q: unknown) => unknown) {
						const rec: Recorded = { index: name, eqs: {} };
						const q = {
							eq(field: string, value: unknown) {
								rec.eqs[field] = value;
								return q;
							}
						};
						fn(q);
						const builder = {
							async take(n: number) {
								rec.takeN = n;
								calls.push(rec);
								return rows.slice(0, n);
							},
							async collect() {
								throw new Error('bounded read must not .collect() a scalable collection');
							}
						};
						return builder;
					}
				};
			}
		}
	};
	return { calls, ctx };
}

const CAMPAIGN = 'campaign_1' as unknown as Parameters<typeof computeCampaignDistrictSets>[1];
const TAG = 'tag_1' as unknown as Parameters<typeof countTagSupporters>[1];

describe('computeCampaignDistrictSets (bounded set cardinality)', () => {
	it('counts DISTINCT verified districts — a supporter in two districts counts once per district, not per action', async () => {
		const rows: ActionRow[] = [
			{ verified: true, districtHash: 'd1', trustTier: 3 },
			{ verified: true, districtHash: 'd1', trustTier: 1 }, // same district, dup → 1
			{ verified: true, districtHash: 'd2', trustTier: 4 },
			{ verified: true, trustTier: 2 }, // no districtHash → not counted
			{ verified: true, districtHash: 'd3', trustTier: 0 }
		];
		const { ctx, calls } = fakeCtx(rows);
		const r = await computeCampaignDistrictSets(ctx, CAMPAIGN);
		// d1, d2, d3 distinct → 3 verified districts.
		expect(r.verifiedDistricts).toBe(3);
		// tier-3+ districts: d1 (tier3) + d2 (tier4) → 2.
		expect(r.tier3VerifiedDistricts).toBe(2);
		expect(r.truncated).toBe(false);
		// Index + bound invariants: by_campaignId_verified, verified=true, take(CAP+1).
		expect(calls).toHaveLength(1);
		expect(calls[0].index).toBe('by_campaignId_verified');
		expect(calls[0].eqs.campaignId).toBe(CAMPAIGN);
		expect(calls[0].eqs.verified).toBe(true);
		expect(calls[0].takeN).toBe(CAMPAIGN_DISTRICT_SCAN_CAP + 1);
	});

	it('flags truncated when the verified-action scan saturates the cap', async () => {
		const rows: ActionRow[] = Array.from({ length: CAMPAIGN_DISTRICT_SCAN_CAP + 200 }, (_, i) => ({
			verified: true,
			districtHash: `d${i}`,
			trustTier: 3
		}));
		const { ctx } = fakeCtx(rows);
		const r = await computeCampaignDistrictSets(ctx, CAMPAIGN);
		expect(r.truncated).toBe(true);
		// Counts are floors at the cap.
		expect(r.verifiedDistricts).toBe(CAMPAIGN_DISTRICT_SCAN_CAP);
		expect(r.tier3VerifiedDistricts).toBe(CAMPAIGN_DISTRICT_SCAN_CAP);
	});

	it('empty campaign yields zero districts, not truncated', async () => {
		const { ctx } = fakeCtx([]);
		const r = await computeCampaignDistrictSets(ctx, CAMPAIGN);
		expect(r.verifiedDistricts).toBe(0);
		expect(r.tier3VerifiedDistricts).toBe(0);
		expect(r.truncated).toBe(false);
	});
});

describe('countTagSupporters (bounded pure count)', () => {
	it('counts the tag link set, bounded by take(CAP+1)', async () => {
		const rows: LinkRow[] = Array.from({ length: 1234 }, (_, i) => ({ supporterId: `s${i}` }));
		const { ctx, calls } = fakeCtx(rows);
		const r = await countTagSupporters(ctx, TAG);
		expect(r.count).toBe(1234);
		expect(r.truncated).toBe(false);
		expect(calls[0].index).toBe('by_tagId');
		expect(calls[0].eqs.tagId).toBe(TAG);
		expect(calls[0].takeN).toBe(TAG_SCAN_CAP + 1);
	});

	it('truncates to a floor when the link set saturates the cap', async () => {
		const rows: LinkRow[] = Array.from({ length: TAG_SCAN_CAP + 50 }, (_, i) => ({
			supporterId: `s${i}`
		}));
		const { ctx } = fakeCtx(rows);
		const r = await countTagSupporters(ctx, TAG);
		expect(r.count).toBe(TAG_SCAN_CAP);
		expect(r.truncated).toBe(true);
	});
});

describe('collectTagSupporterIds (bounded membership set)', () => {
	it('returns the linked supporter id set, bounded', async () => {
		const rows: LinkRow[] = [{ supporterId: 'a' }, { supporterId: 'b' }, { supporterId: 'a' }];
		const { ctx } = fakeCtx(rows);
		const { supporterIds, truncated } = await collectTagSupporterIds(ctx, TAG);
		// Set dedupes the dup link.
		expect(supporterIds.size).toBe(2);
		expect(supporterIds.has('a' as never)).toBe(true);
		expect(supporterIds.has('b' as never)).toBe(true);
		expect(truncated).toBe(false);
	});

	it('truncates the membership set at the cap', async () => {
		const rows: LinkRow[] = Array.from({ length: TAG_SCAN_CAP + 10 }, (_, i) => ({
			supporterId: `s${i}`
		}));
		const { ctx } = fakeCtx(rows);
		const { supporterIds, truncated } = await collectTagSupporterIds(ctx, TAG);
		expect(supporterIds.size).toBe(TAG_SCAN_CAP);
		expect(truncated).toBe(true);
	});
});
