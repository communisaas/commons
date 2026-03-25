/**
 * Supporter PII Encryption Tests (S-3)
 *
 * Validates:
 * - Info string is "supporter:{id}" (not orgId:email)
 * - tryDecryptSupporterEmail round-trips correctly
 * - Throws when encrypted_email is absent (post-backfill — no plaintext fallback)
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
				encrypted_email: JSON.stringify(encrypted)
			});

			expect(result).toBe(email);
		});

		it('should throw clear error on empty string encrypted_email (poison pill guard)', async () => {
			await expect(
				tryDecryptSupporterEmail({
					id: crypto.randomUUID(),
					encrypted_email: ''
				})
			).rejects.toThrow('empty encrypted_email');
		});

		it('should throw when decryption fails (wrong key)', async () => {
			const supporterId = crypto.randomUUID();
			const email = 'supporter@test.org';

			// Encrypt with a different supporter ID (simulating corrupted data)
			const encrypted = await encryptPii(email, `supporter:${crypto.randomUUID()}`);

			await expect(
				tryDecryptSupporterEmail({
					id: supporterId,
					encrypted_email: JSON.stringify(encrypted)
				})
			).rejects.toThrow();
		});

		it('should throw when encrypted_email is invalid JSON', async () => {
			await expect(
				tryDecryptSupporterEmail({
					id: crypto.randomUUID(),
					encrypted_email: 'not-valid-json'
				})
			).rejects.toThrow();
		});

		it('should throw when PII_ENCRYPTION_KEY is missing', async () => {
			const supporterId = crypto.randomUUID();
			const email = 'supporter@test.org';

			// Encrypt while key is available
			const encrypted = await encryptPii(email, `supporter:${supporterId}`);

			// Remove the key
			delete process.env.PII_ENCRYPTION_KEY;

			await expect(
				tryDecryptSupporterEmail({
					id: supporterId,
					encrypted_email: JSON.stringify(encrypted)
				})
			).rejects.toThrow('PII_ENCRYPTION_KEY not set');
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
