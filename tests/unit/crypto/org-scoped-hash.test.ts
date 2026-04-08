/**
 * Org-scoped deterministic hashing tests.
 *
 * Validates SHA-256 org-scoped hashing for dedup (no server keys).
 */

import { describe, it, expect } from 'vitest';
import {
	computeOrgScopedEmailHash,
	computeOrgScopedPhoneHash,
	normalizeEmail,
	normalizePhone
} from '$lib/core/crypto/org-scoped-hash';

const ORG_A = 'org_abc123';
const ORG_B = 'org_xyz789';

describe('Org-scoped hash', () => {
	describe('computeOrgScopedEmailHash', () => {
		it('is deterministic — same email + same org = same hash', async () => {
			const h1 = await computeOrgScopedEmailHash(ORG_A, 'user@example.com');
			const h2 = await computeOrgScopedEmailHash(ORG_A, 'user@example.com');
			expect(h1).toBe(h2);
		});

		it('is org-scoped — same email + different org = different hash', async () => {
			const hA = await computeOrgScopedEmailHash(ORG_A, 'user@example.com');
			const hB = await computeOrgScopedEmailHash(ORG_B, 'user@example.com');
			expect(hA).not.toBe(hB);
		});

		it('normalizes case', async () => {
			const lower = await computeOrgScopedEmailHash(ORG_A, 'user@example.com');
			const upper = await computeOrgScopedEmailHash(ORG_A, 'USER@EXAMPLE.COM');
			expect(lower).toBe(upper);
		});

		it('normalizes whitespace', async () => {
			const clean = await computeOrgScopedEmailHash(ORG_A, 'user@example.com');
			const padded = await computeOrgScopedEmailHash(ORG_A, '  user@example.com  ');
			expect(clean).toBe(padded);
		});

		it('returns a 64-char hex string', async () => {
			const hash = await computeOrgScopedEmailHash(ORG_A, 'test@test.com');
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});
	});

	describe('computeOrgScopedPhoneHash', () => {
		it('is deterministic — same phone + same org = same hash', async () => {
			const h1 = await computeOrgScopedPhoneHash(ORG_A, '+15551234567');
			const h2 = await computeOrgScopedPhoneHash(ORG_A, '+15551234567');
			expect(h1).toBe(h2);
		});

		it('is org-scoped — same phone + different org = different hash', async () => {
			const hA = await computeOrgScopedPhoneHash(ORG_A, '+15551234567');
			const hB = await computeOrgScopedPhoneHash(ORG_B, '+15551234567');
			expect(hA).not.toBe(hB);
		});

		it('normalizes E.164 — strips non-digits after +', async () => {
			const clean = await computeOrgScopedPhoneHash(ORG_A, '+15551234567');
			const formatted = await computeOrgScopedPhoneHash(ORG_A, '+1 (555) 123-4567');
			expect(clean).toBe(formatted);
		});

		it('returns a 64-char hex string', async () => {
			const hash = await computeOrgScopedPhoneHash(ORG_A, '+15551234567');
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});
	});

	describe('domain separation', () => {
		it('phone hash differs from email hash for the same input string', async () => {
			// "+15551234567" treated as both an email and phone
			const emailHash = await computeOrgScopedEmailHash(ORG_A, '+15551234567');
			const phoneHash = await computeOrgScopedPhoneHash(ORG_A, '+15551234567');
			expect(emailHash).not.toBe(phoneHash);
		});
	});

	describe('normalizeEmail', () => {
		it('lowercases and trims', () => {
			expect(normalizeEmail('  FOO@Bar.COM  ')).toBe('foo@bar.com');
		});
	});

	describe('normalizePhone', () => {
		it('strips non-digits after +', () => {
			expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
		});

		it('trims whitespace', () => {
			expect(normalizePhone('  +15551234567  ')).toBe('+15551234567');
		});

		it('throws if missing leading +', () => {
			expect(() => normalizePhone('15551234567')).toThrow("must start with '+'");
		});

		it('throws if too few digits', () => {
			expect(() => normalizePhone('+12345')).toThrow('expected 7-15');
		});

		it('throws if too many digits', () => {
			expect(() => normalizePhone('+1234567890123456')).toThrow('expected 7-15');
		});
	});
});
