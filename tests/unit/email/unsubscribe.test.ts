import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		UNSUBSCRIBE_SECRET: 'test-secret-' + 'a'.repeat(48),
		PUBLIC_BASE_URL: 'https://commons.email'
	}
}));

import {
	generateUnsubscribeToken,
	buildUnsubscribeUrl,
	verifyUnsubscribeToken
} from '$lib/server/email/unsubscribe';
import { env } from '$env/dynamic/private';

describe('unsubscribe token (HMAC-SHA256)', () => {
	beforeEach(() => {
		(env as Record<string, string>).UNSUBSCRIBE_SECRET = 'test-secret-' + 'a'.repeat(48);
		(env as Record<string, string>).PUBLIC_BASE_URL = 'https://commons.email';
	});

	it('emits 64 hex characters (SHA-256 output)', () => {
		const token = generateUnsubscribeToken('sup_alpha', 'org_beta');
		expect(token).toHaveLength(64);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is deterministic — same (supporterId, orgId) produces the same token', () => {
		const a = generateUnsubscribeToken('sup_alpha', 'org_beta');
		const b = generateUnsubscribeToken('sup_alpha', 'org_beta');
		expect(a).toBe(b);
	});

	it('isolates across orgs — same supporter, different orgs → different tokens', () => {
		const inOrgA = generateUnsubscribeToken('sup_alpha', 'org_one');
		const inOrgB = generateUnsubscribeToken('sup_alpha', 'org_two');
		expect(inOrgA).not.toBe(inOrgB);
	});

	it('isolates across supporters — different supporters in same org → different tokens', () => {
		const supA = generateUnsubscribeToken('sup_alpha', 'org_one');
		const supB = generateUnsubscribeToken('sup_beta', 'org_one');
		expect(supA).not.toBe(supB);
	});

	it('throws when UNSUBSCRIBE_SECRET is unset (Phase 0.5 launch-gate)', () => {
		const original = (env as Record<string, string>).UNSUBSCRIBE_SECRET;
		(env as Record<string, string>).UNSUBSCRIBE_SECRET = '';
		expect(() => generateUnsubscribeToken('sup_alpha', 'org_one')).toThrow(
			/UNSUBSCRIBE_SECRET/
		);
		(env as Record<string, string>).UNSUBSCRIBE_SECRET = original;
	});

	it('verifyUnsubscribeToken accepts the matching token', () => {
		const token = generateUnsubscribeToken('sup_alpha', 'org_one');
		expect(verifyUnsubscribeToken('sup_alpha', 'org_one', token)).toBe(true);
	});

	it('verifyUnsubscribeToken rejects a tampered token (one byte flipped)', () => {
		const token = generateUnsubscribeToken('sup_alpha', 'org_one');
		const flipped = (parseInt(token[0], 16) ^ 0x1).toString(16) + token.slice(1);
		expect(verifyUnsubscribeToken('sup_alpha', 'org_one', flipped)).toBe(false);
	});

	it('verifyUnsubscribeToken rejects a length-mismatched token (early return path)', () => {
		const token = generateUnsubscribeToken('sup_alpha', 'org_one');
		expect(verifyUnsubscribeToken('sup_alpha', 'org_one', token + 'a')).toBe(false);
		expect(verifyUnsubscribeToken('sup_alpha', 'org_one', token.slice(0, -1))).toBe(false);
	});

	it('verifyUnsubscribeToken rejects a token from a different (supporter, org) pair', () => {
		const wrongPair = generateUnsubscribeToken('sup_alpha', 'org_one');
		expect(verifyUnsubscribeToken('sup_beta', 'org_one', wrongPair)).toBe(false);
		expect(verifyUnsubscribeToken('sup_alpha', 'org_two', wrongPair)).toBe(false);
	});
});

describe('buildUnsubscribeUrl', () => {
	beforeEach(() => {
		(env as Record<string, string>).UNSUBSCRIBE_SECRET = 'test-secret-' + 'a'.repeat(48);
		(env as Record<string, string>).PUBLIC_BASE_URL = 'https://commons.email';
	});

	it('embeds baseUrl + supporterId + orgId + token in canonical order', () => {
		const url = buildUnsubscribeUrl('sup_alpha', 'org_beta');
		expect(url).toMatch(
			/^https:\/\/commons\.email\/unsubscribe\/sup_alpha\/org_beta\/[0-9a-f]{64}$/
		);
	});

	it('respects PUBLIC_BASE_URL override', () => {
		(env as Record<string, string>).PUBLIC_BASE_URL = 'https://peer.example.org';
		const url = buildUnsubscribeUrl('sup_x', 'org_y');
		expect(url.startsWith('https://peer.example.org/unsubscribe/sup_x/org_y/')).toBe(true);
	});

	it('falls back to https://commons.email when PUBLIC_BASE_URL is unset', () => {
		(env as Record<string, string>).PUBLIC_BASE_URL = '';
		const url = buildUnsubscribeUrl('sup_a', 'org_b');
		expect(url.startsWith('https://commons.email/unsubscribe/sup_a/org_b/')).toBe(true);
	});

	it('emits the same token that verifyUnsubscribeToken accepts (round-trip)', () => {
		const url = buildUnsubscribeUrl('sup_alpha', 'org_beta');
		const token = url.split('/').pop()!;
		expect(verifyUnsubscribeToken('sup_alpha', 'org_beta', token)).toBe(true);
	});
});

describe('rotation-window previous secret', () => {
	beforeEach(() => {
		(env as Record<string, string | undefined>).UNSUBSCRIBE_SECRET = 'a'.repeat(64);
		delete (env as Record<string, string | undefined>).UNSUBSCRIBE_SECRET_PREVIOUS;
		(env as Record<string, string>).PUBLIC_BASE_URL = 'https://commons.email';
	});

	it('verifies a token issued under the previous secret during rotation', async () => {
		const tokenUnderA = generateUnsubscribeToken('sup_alpha', 'org_beta');
		// Rotate: old becomes _PREVIOUS, new is active.
		(env as Record<string, string>).UNSUBSCRIBE_SECRET_PREVIOUS = 'a'.repeat(64);
		(env as Record<string, string>).UNSUBSCRIBE_SECRET = 'b'.repeat(64);
		// In-flight email link (held under old secret) must still verify.
		expect(verifyUnsubscribeToken('sup_alpha', 'org_beta', tokenUnderA)).toBe(true);
	});

	it('rejects a token that matches NEITHER active nor previous secret', () => {
		(env as Record<string, string>).UNSUBSCRIBE_SECRET = 'c'.repeat(64);
		const tokenUnderC = generateUnsubscribeToken('sup_alpha', 'org_beta');
		(env as Record<string, string>).UNSUBSCRIBE_SECRET = 'd'.repeat(64);
		(env as Record<string, string>).UNSUBSCRIBE_SECRET_PREVIOUS = 'e'.repeat(64);
		expect(verifyUnsubscribeToken('sup_alpha', 'org_beta', tokenUnderC)).toBe(false);
	});

	it('ignores under-length _PREVIOUS (does NOT brick active-secret verification)', () => {
		// An operator typo in _PREVIOUS must not take down valid email
		// unsubscribe links signed under the active secret. The verifier
		// logs a warning and treats _PREVIOUS as unset.
		(env as Record<string, string>).UNSUBSCRIBE_SECRET_PREVIOUS = 'short';
		const valid = generateUnsubscribeToken('sup_alpha', 'org_beta');
		expect(verifyUnsubscribeToken('sup_alpha', 'org_beta', valid)).toBe(true);
	});

	it('mints exclusively under the active secret (never the previous)', () => {
		(env as Record<string, string>).UNSUBSCRIBE_SECRET = 'a'.repeat(64);
		(env as Record<string, string>).UNSUBSCRIBE_SECRET_PREVIOUS = 'b'.repeat(64);
		const tokenUnderActive = generateUnsubscribeToken('sup_alpha', 'org_beta');
		// Swap which is active vs previous; the token issued earlier must
		// verify because A is now _PREVIOUS — confirms mint is single-secret.
		(env as Record<string, string>).UNSUBSCRIBE_SECRET = 'b'.repeat(64);
		(env as Record<string, string>).UNSUBSCRIBE_SECRET_PREVIOUS = 'a'.repeat(64);
		expect(verifyUnsubscribeToken('sup_alpha', 'org_beta', tokenUnderActive)).toBe(true);
	});

	it('throws on under-length active secret (matches MIN_SECRET_BYTES floor)', () => {
		(env as Record<string, string>).UNSUBSCRIBE_SECRET = 'a'.repeat(31);
		expect(() => generateUnsubscribeToken('sup_alpha', 'org_beta')).toThrow(/>= 32 bytes/);
	});
});
