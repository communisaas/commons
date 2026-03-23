/**
 * OAuth Token Encryption Tests
 *
 * Validates AES-256-GCM encryption at rest for OAuth tokens.
 * Uses Web Crypto API (same as production CF Workers runtime).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	encryptOAuthToken,
	decryptOAuthToken,
	type EncryptedToken
} from '$lib/core/crypto/oauth-token-encryption';

// Test key: 32 bytes (64 hex chars) — NOT used in production
const TEST_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

describe('OAuth Token Encryption', () => {
	let originalEnv: string | undefined;

	beforeEach(() => {
		originalEnv = process.env.OAUTH_ENCRYPTION_KEY;
		process.env.OAUTH_ENCRYPTION_KEY = TEST_KEY;
	});

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.OAUTH_ENCRYPTION_KEY;
		} else {
			process.env.OAUTH_ENCRYPTION_KEY = originalEnv;
		}
	});

	describe('encrypt/decrypt round-trip', () => {
		it('round-trips a typical access token', async () => {
			const plaintext = 'ya29.a0ARrdaM-some-long-google-access-token-value';
			const encrypted = await encryptOAuthToken(plaintext, 'google', '12345');
			expect(encrypted).not.toBeNull();
			expect(encrypted!.ciphertext).toBeTruthy();
			expect(encrypted!.iv).toBeTruthy();

			const decrypted = await decryptOAuthToken(encrypted!, 'google', '12345');
			expect(decrypted).toBe(plaintext);
		});

		it('round-trips an empty string', async () => {
			const encrypted = await encryptOAuthToken('', 'google', '12345');
			expect(encrypted).not.toBeNull();

			const decrypted = await decryptOAuthToken(encrypted!, 'google', '12345');
			expect(decrypted).toBe('');
		});

		it('round-trips a refresh token with special characters', async () => {
			const plaintext = '1//0abc+def/ghi_jkl=mno';
			const encrypted = await encryptOAuthToken(plaintext, 'twitter', 'user_99');
			const decrypted = await decryptOAuthToken(encrypted!, 'twitter', 'user_99');
			expect(decrypted).toBe(plaintext);
		});

		it('round-trips a long JWT-style id_token', async () => {
			const plaintext = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.' +
				'eyJpc3MiOiJhY2NvdW50cy5nb29nbGUuY29tIiwiYXpwIjoiMTIzNCJ9.' +
				'signature_data_here_with_base64url_chars_-_';
			const encrypted = await encryptOAuthToken(plaintext, 'google', 'goog_789');
			const decrypted = await decryptOAuthToken(encrypted!, 'google', 'goog_789');
			expect(decrypted).toBe(plaintext);
		});
	});

	describe('key isolation', () => {
		it('different provider+accountId produces different ciphertext', async () => {
			const plaintext = 'same-token-value';

			const enc1 = await encryptOAuthToken(plaintext, 'google', '12345');
			const enc2 = await encryptOAuthToken(plaintext, 'twitter', '12345');
			const enc3 = await encryptOAuthToken(plaintext, 'google', '99999');

			// All should decrypt correctly
			expect(await decryptOAuthToken(enc1!, 'google', '12345')).toBe(plaintext);
			expect(await decryptOAuthToken(enc2!, 'twitter', '12345')).toBe(plaintext);
			expect(await decryptOAuthToken(enc3!, 'google', '99999')).toBe(plaintext);

			// Ciphertexts should differ (different keys + different IVs)
			expect(enc1!.ciphertext).not.toBe(enc2!.ciphertext);
			expect(enc1!.ciphertext).not.toBe(enc3!.ciphertext);
		});

		it('cannot decrypt with wrong provider', async () => {
			const encrypted = await encryptOAuthToken('secret', 'google', '12345');
			await expect(
				decryptOAuthToken(encrypted!, 'twitter', '12345')
			).rejects.toThrow();
		});

		it('cannot decrypt with wrong account ID', async () => {
			const encrypted = await encryptOAuthToken('secret', 'google', '12345');
			await expect(
				decryptOAuthToken(encrypted!, 'google', '99999')
			).rejects.toThrow();
		});
	});

	describe('missing ENV key', () => {
		it('returns null when OAUTH_ENCRYPTION_KEY is not set', async () => {
			delete process.env.OAUTH_ENCRYPTION_KEY;

			const result = await encryptOAuthToken('token', 'google', '12345');
			expect(result).toBeNull();
		});

		it('throws on decrypt when OAUTH_ENCRYPTION_KEY is not set', async () => {
			const encrypted: EncryptedToken = { ciphertext: 'abc', iv: 'def' };
			delete process.env.OAUTH_ENCRYPTION_KEY;

			await expect(
				decryptOAuthToken(encrypted, 'google', '12345')
			).rejects.toThrow('OAUTH_ENCRYPTION_KEY not set');
		});
	});

	describe('output format', () => {
		it('produces valid base64 strings', async () => {
			const encrypted = await encryptOAuthToken('test-token', 'discord', 'disc_1');
			expect(encrypted).not.toBeNull();

			// Verify base64 format (no errors on decode)
			expect(() => atob(encrypted!.ciphertext)).not.toThrow();
			expect(() => atob(encrypted!.iv)).not.toThrow();

			// IV should be 12 bytes = 16 base64 chars
			const ivBytes = atob(encrypted!.iv);
			expect(ivBytes.length).toBe(12);
		});

		it('same plaintext encrypts to different ciphertext each time (random IV)', async () => {
			const enc1 = await encryptOAuthToken('token', 'google', '12345');
			const enc2 = await encryptOAuthToken('token', 'google', '12345');

			// IVs should differ (random)
			expect(enc1!.iv).not.toBe(enc2!.iv);
			// Ciphertexts should differ (different IVs)
			expect(enc1!.ciphertext).not.toBe(enc2!.ciphertext);
		});

		it('encrypted token is JSON-serializable (for Prisma Json column)', async () => {
			const encrypted = await encryptOAuthToken('token', 'google', '12345');
			const json = JSON.stringify(encrypted);
			const parsed = JSON.parse(json);
			expect(parsed.ciphertext).toBe(encrypted!.ciphertext);
			expect(parsed.iv).toBe(encrypted!.iv);

			// Verify round-trip through JSON
			const decrypted = await decryptOAuthToken(parsed, 'google', '12345');
			expect(decrypted).toBe('token');
		});
	});
});
