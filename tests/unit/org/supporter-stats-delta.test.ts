/**
 * Denormalized supporter breakdown counters — delta math.
 *
 * organizations.supporterStats backs the verification funnel + list-health
 * summary so those reads avoid a full-table scan (which throws past the
 * per-query document cap). The counters stay exact only if the delta applied at
 * every writer (create / delete / status transition) matches what a full re-scan
 * would compute. These tests pin computeSupporterStats against that invariant:
 * a sequence of deltas equals a fresh tally of the surviving rows.
 */

import { describe, it, expect } from 'vitest';
import {
	computeSupporterStats,
	emptySupporterStats,
	type CountableSupporter,
	type SupporterStats
} from '../../../convex/_supporterStats';

function subscribed(overrides: Partial<CountableSupporter> = {}): CountableSupporter {
	return { emailStatus: 'subscribed', smsStatus: 'none', source: 'organic', ...overrides };
}

/** Ground truth: tally the breakdown directly from a row set (what a full scan would do). */
function tally(rows: CountableSupporter[]): SupporterStats {
	let stats = emptySupporterStats();
	for (const r of rows) stats = computeSupporterStats(stats, null, r);
	return stats;
}

describe('computeSupporterStats — create deltas', () => {
	it('counts a fresh subscribed row as emailSubscribed + smsNone + source', () => {
		const s = computeSupporterStats(undefined, null, subscribed());
		expect(s.emailSubscribed).toBe(1);
		expect(s.smsNone).toBe(1);
		expect(s.sourceCounts.organic).toBe(1);
		expect(s.postalResolved).toBe(0);
		expect(s.phonePresent).toBe(0);
		expect(s.identityVerified).toBe(0);
	});

	it('counts postal, phone, and consent contributions', () => {
		const s = computeSupporterStats(undefined, null, {
			emailStatus: 'subscribed',
			smsStatus: 'subscribed',
			source: 'csv',
			postalCode: '94110',
			phoneHash: 'abc',
			emailConsentSource: 'web-form',
			smsConsentedAt: 1
		});
		expect(s.postalResolved).toBe(1);
		expect(s.phonePresent).toBe(1);
		expect(s.smsSubscribed).toBe(1);
		expect(s.emailConsentEvidence).toBe(1);
		expect(s.emailSubscribedConsentEvidence).toBe(1);
		expect(s.smsConsentEvidence).toBe(1);
		expect(s.smsSubscribedConsentEvidence).toBe(1);
		expect(s.sourceCounts.csv).toBe(1);
	});

	it('identityVerified requires BOTH identityCommitment and verified', () => {
		expect(
			computeSupporterStats(undefined, null, subscribed({ identityCommitment: 'c' }))
				.identityVerified
		).toBe(0);
		expect(
			computeSupporterStats(undefined, null, subscribed({ verified: true })).identityVerified
		).toBe(0);
		expect(
			computeSupporterStats(undefined, null, subscribed({ identityCommitment: 'c', verified: true }))
				.identityVerified
		).toBe(1);
	});

	it('uses "unknown" when source is missing or blank', () => {
		const s = computeSupporterStats(undefined, null, { emailStatus: 'subscribed', smsStatus: 'none' });
		expect(s.sourceCounts.unknown).toBe(1);
	});
});

describe('computeSupporterStats — transitions', () => {
	it('subscribed → bounced moves the email bucket without touching totals', () => {
		const before = subscribed();
		let s = computeSupporterStats(undefined, null, before);
		expect(s.emailSubscribed).toBe(1);
		s = computeSupporterStats(s, before, { ...before, emailStatus: 'bounced' });
		expect(s.emailSubscribed).toBe(0);
		expect(s.emailBounced).toBe(1);
		// source tally unchanged across a transition
		expect(s.sourceCounts.organic).toBe(1);
	});

	it('subscribed-with-consent → unsubscribed drops emailSubscribedConsentEvidence but keeps emailConsentEvidence', () => {
		const before = subscribed({ emailConsentSource: 'web-form' });
		let s = computeSupporterStats(undefined, null, before);
		expect(s.emailSubscribedConsentEvidence).toBe(1);
		s = computeSupporterStats(s, before, { ...before, emailStatus: 'unsubscribed' });
		expect(s.emailSubscribedConsentEvidence).toBe(0);
		expect(s.emailConsentEvidence).toBe(1); // evidence on file regardless of status
		expect(s.emailUnsubscribed).toBe(1);
	});

	it('sms none → stopped → subscribed lands in the right buckets', () => {
		const r0 = subscribed();
		let s = computeSupporterStats(undefined, null, r0);
		expect(s.smsNone).toBe(1);
		s = computeSupporterStats(s, r0, { ...r0, smsStatus: 'stopped' });
		expect(s.smsNone).toBe(0);
		expect(s.smsStopped).toBe(1);
		const r1 = { ...r0, smsStatus: 'stopped' };
		s = computeSupporterStats(s, r1, { ...r1, smsStatus: 'subscribed' });
		expect(s.smsStopped).toBe(0);
		expect(s.smsSubscribed).toBe(1);
	});

	it('gaining a postal code increments postalResolved exactly once', () => {
		const before = subscribed();
		let s = computeSupporterStats(undefined, null, before);
		s = computeSupporterStats(s, before, { ...before, postalCode: '94110' });
		expect(s.postalResolved).toBe(1);
	});
});

describe('computeSupporterStats — delete deltas + drift invariant', () => {
	it('deleting a row restores the empty tally', () => {
		const row = subscribed({ postalCode: '94110', phoneHash: 'x' });
		let s = computeSupporterStats(undefined, null, row);
		s = computeSupporterStats(s, row, null);
		expect(s).toEqual(emptySupporterStats());
	});

	it('a stream of mixed deltas equals a fresh tally of the survivors', () => {
		const a = subscribed({ source: 'organic', postalCode: '1' });
		const b = subscribed({ source: 'csv', phoneHash: 'p', smsStatus: 'subscribed' });
		const c = subscribed({ source: 'organic' });

		// create a, b, c
		let s = computeSupporterStats(undefined, null, a);
		s = computeSupporterStats(s, null, b);
		s = computeSupporterStats(s, null, c);
		// b unsubscribes
		const bAfter = { ...b, emailStatus: 'unsubscribed' as const };
		s = computeSupporterStats(s, b, bAfter);
		// delete c
		s = computeSupporterStats(s, c, null);

		// Survivors: a (subscribed), b (unsubscribed). Fresh tally must match.
		expect(s).toEqual(tally([a, bAfter]));
	});

	it('clamps counters at zero so a drifted decrement never goes negative', () => {
		const row = subscribed();
		// Decrement from an empty baseline (simulating a pre-existing org whose
		// stats were never maintained) must floor at 0, not go negative.
		const s = computeSupporterStats(undefined, row, null);
		expect(s.emailSubscribed).toBe(0);
		expect(s.smsNone).toBe(0);
		expect(s.sourceCounts.organic).toBeUndefined();
	});

	it('source key is removed from the map when its count hits zero', () => {
		const row = subscribed({ source: 'csv' });
		let s = computeSupporterStats(undefined, null, row);
		expect(s.sourceCounts.csv).toBe(1);
		s = computeSupporterStats(s, row, null);
		expect(s.sourceCounts.csv).toBeUndefined();
	});
});
