/**
 * Supporter PII Encryption Tests (S-3)
 *
 * Validates:
 * - Info string is "supporter:{id}" (not orgId:email)
 * - tryDecryptSupporterEmail round-trips correctly
 * - Plaintext fallback when encrypted_email is absent or decryption fails
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	encryptPii,
	decryptPii,
	tryDecryptSupporterEmail,
	computeEmailHash
} from '$lib/core/crypto/user-pii-encryption';

// Test keys: 32 bytes (64 hex chars) — NOT used in production
const TEST_PII_KEY = 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2';
const TEST_EMAIL_KEY = 'c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3';

describe('Supporter PII Encryption', () => {
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

	describe('info string is supporter:{id}', () => {
		it('should encrypt with supporter:{id} info string', async () => {
			const supporterId = crypto.randomUUID();
			const email = 'voter@example.com';
			const infoString = `supporter:${supporterId}`;

			const encrypted = await encryptPii(email, infoString);
			expect(encrypted).not.toBeNull();

			const decrypted = await decryptPii(encrypted!, infoString);
			expect(decrypted).toBe(email);
		});

		it('should NOT decrypt with old orgId:email info string', async () => {
			const supporterId = crypto.randomUUID();
			const orgId = crypto.randomUUID();
			const email = 'voter@example.com';

			// Encrypt with correct info string
			const encrypted = await encryptPii(email, `supporter:${supporterId}`);
			expect(encrypted).not.toBeNull();

			// Attempting to decrypt with the old info string should fail
			await expect(
				decryptPii(encrypted!, `supporter:${orgId}:${email}`)
			).rejects.toThrow();
		});

		it('should produce different ciphertexts for different supporter IDs', async () => {
			const email = 'same@example.com';
			const enc1 = await encryptPii(email, `supporter:${crypto.randomUUID()}`);
			const enc2 = await encryptPii(email, `supporter:${crypto.randomUUID()}`);

			expect(enc1!.ciphertext).not.toBe(enc2!.ciphertext);
		});
	});

	describe('tryDecryptSupporterEmail', () => {
		it('should decrypt encrypted_email with supporter:{id} info', async () => {
			const supporterId = crypto.randomUUID();
			const email = 'supporter@test.org';
			const encrypted = await encryptPii(email, `supporter:${supporterId}`);

			const result = await tryDecryptSupporterEmail({
				id: supporterId,
				email: 'supporter@test.org',
				encrypted_email: JSON.stringify(encrypted)
			});

			expect(result).toBe(email);
		});

		it('should fall back to plaintext when encrypted_email is null', async () => {
			const result = await tryDecryptSupporterEmail({
				id: crypto.randomUUID(),
				email: 'plain@example.com',
				encrypted_email: null
			});

			expect(result).toBe('plain@example.com');
		});

		it('should fall back to plaintext when encrypted_email is undefined', async () => {
			const result = await tryDecryptSupporterEmail({
				id: crypto.randomUUID(),
				email: 'plain@example.com'
			});

			expect(result).toBe('plain@example.com');
		});

		it('should fall back to plaintext when decryption fails (wrong key)', async () => {
			const supporterId = crypto.randomUUID();
			const email = 'supporter@test.org';

			// Encrypt with a different supporter ID (simulating corrupted data)
			const encrypted = await encryptPii(email, `supporter:${crypto.randomUUID()}`);

			const result = await tryDecryptSupporterEmail({
				id: supporterId,
				email: 'supporter@test.org',
				encrypted_email: JSON.stringify(encrypted)
			});

			// Falls back to plaintext because decryption with wrong key fails
			expect(result).toBe('supporter@test.org');
		});

		it('should fall back to plaintext when encrypted_email is invalid JSON', async () => {
			const result = await tryDecryptSupporterEmail({
				id: crypto.randomUUID(),
				email: 'plain@example.com',
				encrypted_email: 'not-valid-json'
			});

			expect(result).toBe('plain@example.com');
		});

		it('should fall back to plaintext when PII_ENCRYPTION_KEY is missing', async () => {
			const supporterId = crypto.randomUUID();
			const email = 'supporter@test.org';

			// Encrypt while key is available
			const encrypted = await encryptPii(email, `supporter:${supporterId}`);

			// Remove the key
			delete process.env.PII_ENCRYPTION_KEY;

			const result = await tryDecryptSupporterEmail({
				id: supporterId,
				email: 'supporter@test.org',
				encrypted_email: JSON.stringify(encrypted)
			});

			// Falls back to plaintext
			expect(result).toBe('supporter@test.org');
		});
	});

	describe('email_hash for supporter lookup', () => {
		it('should produce deterministic hash for the same email', async () => {
			const hash1 = await computeEmailHash('supporter@example.com');
			const hash2 = await computeEmailHash('supporter@example.com');
			expect(hash1).toBe(hash2);
		});

		it('should normalize case for consistent lookup', async () => {
			const hash1 = await computeEmailHash('Supporter@Example.COM');
			const hash2 = await computeEmailHash('supporter@example.com');
			expect(hash1).toBe(hash2);
		});
	});
});
