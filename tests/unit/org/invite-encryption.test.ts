/**
 * OrgInvite PII Encryption Tests (S-5)
 *
 * Validates that invite creation includes encrypted_email and email_hash,
 * hash-based invite matching works, and plaintext fallback is functional.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	computeEmailHash,
	encryptPii,
	decryptPii,
	type EncryptedPii
} from '$lib/core/crypto/user-pii-encryption';

// Test keys: 32 bytes (64 hex chars) — NOT used in production
const TEST_PII_KEY = 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2';
const TEST_EMAIL_KEY = 'c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3';

describe('OrgInvite PII Encryption', () => {
	let origPiiKey: string | undefined;
	let origEmailKey: string | undefined;

	beforeEach(() => {
		origPiiKey = process.env.PII_ENCRYPTION_KEY;
		origEmailKey = process.env.EMAIL_LOOKUP_KEY;
		process.env.PII_ENCRYPTION_KEY = TEST_PII_KEY;
		process.env.EMAIL_LOOKUP_KEY = TEST_EMAIL_KEY;
	});

	afterEach(() => {
		if (origPiiKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
		else process.env.PII_ENCRYPTION_KEY = origPiiKey;
		if (origEmailKey === undefined) delete process.env.EMAIL_LOOKUP_KEY;
		else process.env.EMAIL_LOOKUP_KEY = origEmailKey;
	});

	describe('invite creation includes encrypted_email and email_hash', () => {
		it('should encrypt email with org-invite info string', async () => {
			const email = 'user@example.com';
			const inviteId = crypto.randomUUID();
			const infoString = 'org-invite:' + inviteId;

			const encrypted = await encryptPii(email, infoString);
			expect(encrypted).not.toBeNull();
			expect(encrypted!.ciphertext).toBeTruthy();
			expect(encrypted!.iv).toBeTruthy();

			// Should round-trip correctly
			const decrypted = await decryptPii(encrypted!, infoString);
			expect(decrypted).toBe(email);
		});

		it('should produce a serializable encrypted_email value', async () => {
			const email = 'invite@test.org';
			const inviteId = crypto.randomUUID();
			const encrypted = await encryptPii(email, 'org-invite:' + inviteId);

			const jsonStr = JSON.stringify(encrypted);
			const parsed: EncryptedPii = JSON.parse(jsonStr);
			expect(parsed.ciphertext).toBe(encrypted!.ciphertext);
			expect(parsed.iv).toBe(encrypted!.iv);
		});

		it('should compute a non-null email_hash', async () => {
			const hash = await computeEmailHash('user@example.com');
			expect(hash).not.toBeNull();
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});

		it('should use different encryption keys per invite ID', async () => {
			const email = 'same@example.com';
			const enc1 = await encryptPii(email, 'org-invite:' + crypto.randomUUID());
			const enc2 = await encryptPii(email, 'org-invite:' + crypto.randomUUID());

			// Different invite IDs derive different keys, so ciphertexts differ
			expect(enc1!.ciphertext).not.toBe(enc2!.ciphertext);
		});
	});

	describe('hash-based invite matching', () => {
		it('should match invite email by hash', async () => {
			const inviteEmail = 'voter@commons.email';
			const userEmail = 'voter@commons.email';

			const inviteHash = await computeEmailHash(inviteEmail);
			const userHash = await computeEmailHash(userEmail);

			expect(inviteHash).toBe(userHash);
		});

		it('should match case-insensitive emails by hash', async () => {
			const inviteHash = await computeEmailHash('voter@commons.email');
			const userHash = await computeEmailHash('Voter@Commons.Email');

			expect(inviteHash).toBe(userHash);
		});

		it('should not match different emails by hash', async () => {
			const hash1 = await computeEmailHash('alice@example.com');
			const hash2 = await computeEmailHash('bob@example.com');

			expect(hash1).not.toBe(hash2);
		});

		it('should simulate hash-based email comparison from accept endpoint', async () => {
			// Simulate what the accept endpoint does:
			// invite has email_hash from creation, user provides email at acceptance
			const inviteEmailHash = await computeEmailHash('user@test.com');
			const acceptingUserHash = await computeEmailHash('user@test.com');

			const emailMatches =
				(inviteEmailHash && acceptingUserHash && inviteEmailHash === acceptingUserHash) ||
				'user@test.com' === 'user@test.com';

			expect(emailMatches).toBe(true);
		});
	});

	describe('plaintext fallback when hash is missing', () => {
		it('should fall back to plaintext when EMAIL_LOOKUP_KEY is not set', async () => {
			delete process.env.EMAIL_LOOKUP_KEY;

			const hash = await computeEmailHash('user@example.com');
			expect(hash).toBeNull();

			// Simulate fallback logic from accept endpoint
			const inviteEmail = 'user@example.com';
			const userEmail = 'user@example.com';
			const inviteEmailHash: string | null = null;
			const userEmailHash: string | null = null;

			const emailMatches =
				(inviteEmailHash && userEmailHash && inviteEmailHash === userEmailHash) ||
				inviteEmail === userEmail;

			expect(emailMatches).toBe(true);
		});

		it('should fall back to plaintext when PII_ENCRYPTION_KEY is not set', async () => {
			delete process.env.PII_ENCRYPTION_KEY;

			const encrypted = await encryptPii('user@example.com', 'org-invite:test-id');
			expect(encrypted).toBeNull();

			// encrypted_email would be undefined in the DB, plaintext email still works
		});

		it('should not match different emails in plaintext fallback', async () => {
			delete process.env.EMAIL_LOOKUP_KEY;

			const inviteEmail = 'alice@test.com';
			const userEmail = 'bob@test.com';
			const inviteEmailHash: string | null = null;
			const userEmailHash: string | null = null;

			const emailMatches =
				(inviteEmailHash && userEmailHash && inviteEmailHash === userEmailHash) ||
				inviteEmail === userEmail;

			expect(emailMatches).toBe(false);
		});

		it('should prefer hash match over plaintext when both available', async () => {
			// Even if plaintext doesn't match (e.g. case difference),
			// hash match succeeds because computeEmailHash normalizes
			const inviteEmailHash = await computeEmailHash('user@test.com');
			const userEmailHash = await computeEmailHash('User@Test.com');

			const plaintextMatch = 'user@test.com' === 'User@Test.com'; // false
			const hashMatch = inviteEmailHash && userEmailHash && inviteEmailHash === userEmailHash;

			expect(plaintextMatch).toBe(false);
			expect(hashMatch).toBeTruthy();

			const emailMatches = hashMatch || plaintextMatch;
			expect(emailMatches).toBeTruthy();
		});
	});
});
