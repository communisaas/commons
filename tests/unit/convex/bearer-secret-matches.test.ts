/**
 * `bearerSecretMatches` constant-time rotation-aware compare
 * for the BLAST_RECEIPTS_SECRET Bearer-auth gate at /webhooks/blast-receipts.
 *
 * Exists because the Convex V8 isolate runtime doesn't expose
 * `node:crypto.timingSafeEqual`, so the helper rolls its own XOR-accumulator
 * over equal-length byte arrays. These tests lock the contract: rotation
 * accepts active OR previous; everything else rejects; empty inputs reject.
 */

import { describe, it, expect } from 'vitest';
import { bearerSecretMatches } from '../../../convex/http';

const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);

describe('bearerSecretMatches', () => {
	it('accepts the active secret in single-secret operation', () => {
		expect(bearerSecretMatches(SECRET_A, [SECRET_A])).toBe(true);
	});

	it('rejects a wrong secret in single-secret operation', () => {
		expect(bearerSecretMatches(SECRET_B, [SECRET_A])).toBe(false);
	});

	it('accepts a token under the previous secret during rotation', () => {
		// Lambda was sending under SECRET_B (was active before rotation).
		// Convex now has SECRET_A active and SECRET_B as previous.
		// In-flight invocation must still verify.
		expect(bearerSecretMatches(SECRET_B, [SECRET_A, SECRET_B])).toBe(true);
	});

	it('accepts the active secret when rotation candidates are present', () => {
		expect(bearerSecretMatches(SECRET_A, [SECRET_A, SECRET_B])).toBe(true);
	});

	it('rejects a token matching neither active nor previous', () => {
		const SECRET_C = 'c'.repeat(64);
		expect(bearerSecretMatches(SECRET_C, [SECRET_A, SECRET_B])).toBe(false);
	});

	it('rejects empty presented token', () => {
		expect(bearerSecretMatches('', [SECRET_A])).toBe(false);
	});

	it('rejects empty candidates array', () => {
		expect(bearerSecretMatches(SECRET_A, [])).toBe(false);
	});

	it('filters out empty-string candidates (operator misconfig caught)', () => {
		expect(bearerSecretMatches(SECRET_A, ['', SECRET_A])).toBe(true);
		expect(bearerSecretMatches(SECRET_A, ['', ''])).toBe(false);
	});

	it('rejects on length mismatch (different-length secrets do not collide)', () => {
		expect(bearerSecretMatches('a'.repeat(63), [SECRET_A])).toBe(false);
		expect(bearerSecretMatches('a'.repeat(65), [SECRET_A])).toBe(false);
	});

	it('rejects when only one byte differs', () => {
		const almostMatching = 'a'.repeat(63) + 'b';
		expect(bearerSecretMatches(almostMatching, [SECRET_A])).toBe(false);
	});

	it('handles multi-byte UTF-8 secrets correctly', () => {
		// TextEncoder produces multi-byte sequences for non-ASCII. Length
		// comparison happens in BYTES (after encoding), not characters.
		const utf8Secret = 'a'.repeat(60) + 'café'; // 60 ASCII + 4 chars (café = 5 bytes UTF-8)
		expect(bearerSecretMatches(utf8Secret, [utf8Secret])).toBe(true);
		expect(bearerSecretMatches('a'.repeat(60) + 'cafe', [utf8Secret])).toBe(false);
	});
});
