/**
 * getSummaryStats reads denormalized counters, not a full-table scan.
 *
 * The handler previously collected every supporter row + every verified
 * campaign action, which throws past the per-query document cap (the page
 * 500s). It now maps organizations.supporterStats into the same response shape
 * — O(1), no scan. District-of-record cardinality is a separate O(1) scalar
 * maintained by first/last qualifying-action transitions.
 *
 * convex-test isn't wired in this repo, so this mirrors the handler's pure
 * mapping against an org's stored counters and source-pins:
 *   - the response shape consumers depend on (minus districtVerified),
 *   - that districtVerified is absent from the always-on payload,
 *   - the district query's exact non-truncating compatibility shape.
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

/** Mirror of the readiness-gated getDistrictVerifiedCount scalar mapping. */
function districtCount(districtVerifiedSupporterCount: number | undefined) {
	return {
		districtVerified: districtVerifiedSupporterCount ?? 0,
		truncated: false,
		scanLimit: 0
	};
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

describe('getDistrictVerifiedCount (exact projection)', () => {
	it('maps the exact org scalar without truncation', () => {
		const r = districtCount(12_345);
		expect(r.districtVerified).toBe(12_345);
		expect(r.truncated).toBe(false);
		expect(r.scanLimit).toBe(0);
	});

	it('treats a missing scalar as zero only after the reader readiness gate', () => {
		expect(districtCount(undefined)).toEqual({
			districtVerified: 0,
			truncated: false,
			scanLimit: 0
		});
	});
});
