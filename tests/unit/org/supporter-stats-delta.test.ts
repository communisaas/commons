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
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

	it('bounds the source key space: distinct sources past the cap fold into "other"', () => {
		// `source` is a user-controlled import label — an unbounded distinct set
		// would grow the org doc toward Convex's ~1MB cap. Build many distinct
		// sources and assert the map stays bounded (the overflow lands in 'other').
		let s = emptySupporterStats();
		for (let i = 0; i < 200; i++) {
			s = computeSupporterStats(s, null, subscribed({ source: `src-${i}` }));
		}
		const keyCount = Object.keys(s.sourceCounts).length;
		expect(keyCount).toBeLessThanOrEqual(33); // MAX_SOURCE_KEYS (32) + 'other'
		expect(s.sourceCounts.other).toBeGreaterThan(0);
		// Every supporter is still accounted for: the buckets sum to the total.
		const summed = Object.values(s.sourceCounts).reduce((a, b) => a + b, 0);
		expect(summed).toBe(200);
	});
});

describe('computeSupporterStats — SMS status transitions (updateSmsStatus path)', () => {
	it('moves a supporter between sms buckets on a status change', () => {
		// updateSmsStatus is a status writer like the webhook paths; the delta must
		// shift the sms buckets or they drift on every manual edit.
		const before = subscribed({ smsStatus: 'subscribed' });
		const after = { ...before, smsStatus: 'unsubscribed' };
		let s = computeSupporterStats(undefined, null, before);
		expect(s.smsSubscribed).toBe(1);
		expect(s.smsUnsubscribed).toBe(0);
		s = computeSupporterStats(s, before, after);
		expect(s.smsSubscribed).toBe(0);
		expect(s.smsUnsubscribed).toBe(1);
	});
});

describe('counter writers are wired (source pins for the fixed misses)', () => {
	const supportersSrc = readFileSync(
		path.resolve(process.cwd(), 'convex/supporters.ts'),
		'utf8'
	);
	const dashboardSrc = readFileSync(
		path.resolve(process.cwd(), 'convex/_dashboardStats.ts'),
		'utf8'
	);

	it('updateSmsStatus applies the supporter-stats delta', () => {
		const from = supportersSrc.indexOf('export const updateSmsStatus');
		const next = supportersSrc.indexOf('export const', from + 20);
		const body = supportersSrc.slice(from, next === -1 ? undefined : next);
		expect(body).toContain('applySupporterStatsDelta');
	});

	it('computeDistrictVerified counts only verified actions', () => {
		const from = dashboardSrc.indexOf('export async function computeDistrictVerified');
		const body = dashboardSrc.slice(from, dashboardSrc.indexOf('\n}', from));
		expect(body).toContain("eq('verified', true)");
	});
});
