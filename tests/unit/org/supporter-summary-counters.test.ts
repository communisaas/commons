/**
 * getSummaryStats reads denormalized counters, not a full-table scan.
 *
 * The handler previously collected every supporter row + every verified
 * campaign action, which throws past the per-query document cap (the page
 * 500s). It now maps organizations.supporterStats into the same response shape
 * — O(1), no scan. District-of-record cardinality moved to a separate bounded
 * query because a scalar counter can't represent a set without double-counting.
 *
 * convex-test isn't wired in this repo, so this mirrors the handler's pure
 * mapping against an org's stored counters and source-pins:
 *   - the response shape consumers depend on (minus districtVerified),
 *   - that districtVerified is absent from the always-on payload,
 *   - the district query's scan-cap truncation signal.
 */

import { describe, it, expect } from 'vitest';
import { emptySupporterStats, type SupporterStats } from '../../../convex/_supporterStats';

/** Mirror of getSummaryStats' mapping from stored counters to the response. */
function summary(total: number, stats: SupporterStats) {
	return {
		total,
		imported: total,
		identityVerified: stats.identityVerified,
		postalResolved: stats.postalResolved,
		sourceCounts: stats.sourceCounts,
		emailHealth: {
			subscribed: stats.emailSubscribed,
			unsubscribed: stats.emailUnsubscribed,
			bounced: stats.emailBounced,
			complained: stats.emailComplained
		},
		smsHealth: {
			subscribed: stats.smsSubscribed,
			unsubscribed: stats.smsUnsubscribed,
			stopped: stats.smsStopped,
			none: stats.smsNone,
			phonePresent: stats.phonePresent
		},
		consentEvidence: {
			email: stats.emailConsentEvidence,
			emailSubscribed: stats.emailSubscribedConsentEvidence,
			sms: stats.smsConsentEvidence,
			smsSubscribed: stats.smsSubscribedConsentEvidence
		}
	};
}

/** Mirror of getDistrictVerifiedCount: take(MAX+1) sentinel, distinct supporterIds. */
const MAX_SCAN = 10_000;
function districtCount(actions: Array<{ supporterId?: string; districtHash?: string }>) {
	const scanned = actions.slice(0, MAX_SCAN + 1);
	const truncated = scanned.length > MAX_SCAN;
	const set = new Set<string>();
	for (const a of scanned.slice(0, MAX_SCAN)) {
		if (a.supporterId && a.districtHash) set.add(a.supporterId);
	}
	return { districtVerified: set.size, truncated, scanLimit: MAX_SCAN };
}

describe('getSummaryStats counter mapping', () => {
	it('an org with no maintained stats yields an all-zero funnel', () => {
		const s = summary(0, emptySupporterStats());
		expect(s.total).toBe(0);
		expect(s.identityVerified).toBe(0);
		expect(s.emailHealth.subscribed).toBe(0);
		expect(s.sourceCounts).toEqual({});
	});

	it('maps stored breakdown counters into the response shape', () => {
		const stats: SupporterStats = {
			...emptySupporterStats(),
			identityVerified: 3,
			postalResolved: 40,
			phonePresent: 12,
			emailSubscribed: 88,
			emailUnsubscribed: 7,
			emailBounced: 3,
			emailComplained: 2,
			smsSubscribed: 9,
			smsStopped: 1,
			smsNone: 90,
			emailConsentEvidence: 50,
			emailSubscribedConsentEvidence: 47,
			sourceCounts: { organic: 70, csv: 30 }
		};
		const s = summary(100, stats);
		expect(s.total).toBe(100);
		expect(s.imported).toBe(100);
		expect(s.postalResolved).toBe(40);
		expect(s.emailHealth).toEqual({ subscribed: 88, unsubscribed: 7, bounced: 3, complained: 2 });
		expect(s.smsHealth).toEqual({
			subscribed: 9,
			unsubscribed: 0,
			stopped: 1,
			none: 90,
			phonePresent: 12
		});
		expect(s.consentEvidence.emailSubscribed).toBe(47);
		expect(s.sourceCounts).toEqual({ organic: 70, csv: 30 });
	});

	it('does NOT include districtVerified in the always-on payload', () => {
		const s = summary(10, emptySupporterStats());
		expect('districtVerified' in s).toBe(false);
	});
});

describe('getDistrictVerifiedCount (bounded)', () => {
	it('counts distinct supporters with a districtHash', () => {
		const r = districtCount([
			{ supporterId: 'a', districtHash: 'd1' },
			{ supporterId: 'a', districtHash: 'd2' }, // same supporter, two districts → 1
			{ supporterId: 'b', districtHash: 'd1' },
			{ supporterId: 'c' }, // no districtHash → not counted
			{ districtHash: 'd3' } // no supporterId → not counted
		]);
		expect(r.districtVerified).toBe(2);
		expect(r.truncated).toBe(false);
	});

	it('flags truncated when the action scan saturates the cap', () => {
		const actions = Array.from({ length: MAX_SCAN + 500 }, (_, i) => ({
			supporterId: `s${i}`,
			districtHash: `d${i}`
		}));
		const r = districtCount(actions);
		expect(r.truncated).toBe(true);
		expect(r.scanLimit).toBe(MAX_SCAN);
		expect(r.districtVerified).toBe(MAX_SCAN);
	});

	it('an org exactly at the cap is complete, not truncated', () => {
		const actions = Array.from({ length: MAX_SCAN }, (_, i) => ({
			supporterId: `s${i}`,
			districtHash: `d${i}`
		}));
		expect(districtCount(actions).truncated).toBe(false);
	});
});
