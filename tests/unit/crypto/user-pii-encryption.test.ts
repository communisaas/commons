/**
 * User PII Encryption Tests (C-3)
 *
 * Validates AES-256-GCM encryption at rest for user email/name,
 * and HMAC-SHA256 email hashing for lookups.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	computeEmailHash,
	encryptPii,
	decryptPii,
	tryDecryptPii,
	encryptUserPii,
	decryptUserPii,
	type EncryptedPii
} from '$lib/core/crypto/user-pii-encryption';

// Test keys: 32 bytes (64 hex chars) — NOT used in production
const TEST_PII_KEY = 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2';
const TEST_EMAIL_KEY = 'c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3';

describe('User PII Encryption', () => {
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

	describe('computeEmailHash', () => {
		it('produces a deterministic hash for the same email', async () => {
			const hash1 = await computeEmailHash('user@example.com');
			const hash2 = await computeEmailHash('user@example.com');
			expect(hash1).toBe(hash2);
		});

		it('normalizes email case', async () => {
			const hash1 = await computeEmailHash('User@Example.COM');
			const hash2 = await computeEmailHash('user@example.com');
			expect(hash1).toBe(hash2);
		});

		it('trims whitespace', async () => {
			const hash1 = await computeEmailHash('  user@example.com  ');
			const hash2 = await computeEmailHash('user@example.com');
			expect(hash1).toBe(hash2);
		});

		it('produces different hashes for different emails', async () => {
			const hash1 = await computeEmailHash('alice@example.com');
			const hash2 = await computeEmailHash('bob@example.com');
			expect(hash1).not.toBe(hash2);
		});

		it('returns a 64-character hex string', async () => {
			const hash = await computeEmailHash('user@example.com');
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});

		it('does not contain the plaintext email', async () => {
			const hash = await computeEmailHash('user@example.com');
			expect(hash).not.toContain('user');
			expect(hash).not.toContain('example');
		});

		it('returns null when EMAIL_LOOKUP_KEY is not set', async () => {
			delete process.env.EMAIL_LOOKUP_KEY;
			const hash = await computeEmailHash('user@example.com');
			expect(hash).toBeNull();
		});
	});

	describe('encryptPii / decryptPii round-trip', () => {
		it('round-trips a typical email', async () => {
			const email = 'alice@example.com';
			const encrypted = await encryptPii(email, 'user-123');
			expect(encrypted).not.toBeNull();
			expect(encrypted!.ciphertext).toBeTruthy();
			expect(encrypted!.iv).toBeTruthy();

			const decrypted = await decryptPii(encrypted!, 'user-123');
			expect(decrypted).toBe(email);
		});

		it('round-trips a name with unicode characters', async () => {
			const name = 'María García-López 日本語';
			const encrypted = await encryptPii(name, 'user-456');
			const decrypted = await decryptPii(encrypted!, 'user-456');
			expect(decrypted).toBe(name);
		});

		it('round-trips an empty string', async () => {
			const encrypted = await encryptPii('', 'user-789');
			const decrypted = await decryptPii(encrypted!, 'user-789');
			expect(decrypted).toBe('');
		});

		it('different users get different ciphertexts for same email', async () => {
			const email = 'shared@example.com';
			const enc1 = await encryptPii(email, 'user-A');
			const enc2 = await encryptPii(email, 'user-B');

			// Different keys → different ciphertexts
			expect(enc1!.ciphertext).not.toBe(enc2!.ciphertext);

			// Each decrypts correctly with its own user's key
			expect(await decryptPii(enc1!, 'user-A')).toBe(email);
			expect(await decryptPii(enc2!, 'user-B')).toBe(email);
		});

		it('same user, same email produces different ciphertext each time (random IV)', async () => {
			const enc1 = await encryptPii('test@test.com', 'user-X');
			const enc2 = await encryptPii('test@test.com', 'user-X');

			expect(enc1!.iv).not.toBe(enc2!.iv);
			expect(enc1!.ciphertext).not.toBe(enc2!.ciphertext);
		});

		it('cannot decrypt with wrong userId', async () => {
			const encrypted = await encryptPii('secret@email.com', 'user-A');
			await expect(decryptPii(encrypted!, 'user-B')).rejects.toThrow();
		});
	});

	describe('tryDecryptPii', () => {
		it('returns decrypted value on success', async () => {
			const encrypted = await encryptPii('test@example.com', 'user-1');
			const result = await tryDecryptPii(encrypted, 'user-1');
			expect(result).toBe('test@example.com');
		});

		it('returns null for null/undefined input', async () => {
			expect(await tryDecryptPii(null, 'user-1')).toBeNull();
			expect(await tryDecryptPii(undefined, 'user-1')).toBeNull();
		});

		it('returns null on decryption failure (wrong key)', async () => {
			const encrypted = await encryptPii('test@example.com', 'user-A');
			const result = await tryDecryptPii(encrypted, 'user-B');
			expect(result).toBeNull();
		});
	});

	describe('encryptUserPii', () => {
		it('encrypts email and name together', async () => {
			const result = await encryptUserPii('alice@example.com', 'Alice Smith', 'user-100');
			expect(result.encrypted_email).toBeTruthy();
			expect(result.encrypted_name).toBeTruthy();
			expect(result.email_hash).toBeTruthy();

			// encrypted_email and encrypted_name are JSON strings
			const encEmail = JSON.parse(result.encrypted_email!);
			expect(encEmail.ciphertext).toBeTruthy();
			expect(encEmail.iv).toBeTruthy();
		});

		it('handles null name', async () => {
			const result = await encryptUserPii('bob@example.com', null, 'user-200');
			expect(result.encrypted_email).toBeTruthy();
			expect(result.encrypted_name).toBeNull();
			expect(result.email_hash).toBeTruthy();
		});
	});

	describe('decryptUserPii', () => {
		it('decrypts encrypted fields', async () => {
			const pii = await encryptUserPii('carol@example.com', 'Carol', 'user-300');
			expect(pii.encrypted_email).not.toBeNull();
			const user = {
				id: 'user-300',
				encrypted_email: pii.encrypted_email!,
				encrypted_name: pii.encrypted_name
			};

			const result = await decryptUserPii(user);
			expect(result.email).toBe('carol@example.com');
			expect(result.name).toBe('Carol');
		});

		it('throws on decryption error (no plaintext fallback)', async () => {
			const user = {
				id: 'user-500',
				encrypted_email: '{"ciphertext":"invalid","iv":"invalid"}',
				encrypted_name: null
			};

			await expect(decryptUserPii(user)).rejects.toThrow();
		});

		it('throws clear error on empty string encrypted_email (poison pill guard)', async () => {
			const user = { id: 'user-600', encrypted_email: '', encrypted_name: null };
			await expect(decryptUserPii(user)).rejects.toThrow('empty encrypted_email');
		});
	});

	describe('missing ENV keys', () => {
		it('encryptPii returns null when PII_ENCRYPTION_KEY is not set', async () => {
			delete process.env.PII_ENCRYPTION_KEY;
			const result = await encryptPii('test@test.com', 'user-1');
			expect(result).toBeNull();
		});

		it('decryptPii throws when PII_ENCRYPTION_KEY is not set', async () => {
			const encrypted: EncryptedPii = { ciphertext: 'abc', iv: 'def' };
			delete process.env.PII_ENCRYPTION_KEY;
			await expect(decryptPii(encrypted, 'user-1')).rejects.toThrow('PII_ENCRYPTION_KEY not set');
		});
	});
});
