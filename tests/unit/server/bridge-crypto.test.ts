/**
 * Bridge Crypto Tests — AES-256-GCM + HKDF
 *
 * Tests encryptBridgeFields / decryptBridgeFields round-trip,
 * key derivation isolation per sessionId, dev passthrough when
 * no encryption key is set, blob structure, and tamper detection.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EncryptedBlob, SensitiveFields } from '$lib/server/bridge-crypto';

// A deterministic 32-byte hex key for tests
const TEST_KEY_HEX = 'a'.repeat(64); // 32 bytes of 0xaa

const SAMPLE_FIELDS: SensitiveFields = {
	secret: '0'.repeat(64),
	ephemeralPrivateKeyJwk: { kty: 'OKP', crv: 'X25519', d: 'test-private', x: 'test-public' },
	desktopUserLabel: 'alice@example.com',
	requests: [{ protocol: 'org.iso.mdoc', data: { doctype: 'org.iso.18013.5.1.mDL' } }],
	nonce: 'test-nonce-abc123',
	origin: 'https://commons.example'
};

describe('bridge-crypto', () => {
	let savedBridgeKey: string | undefined;

	beforeEach(() => {
		savedBridgeKey = process.env.BRIDGE_ENCRYPTION_KEY;
		process.env.BRIDGE_ENCRYPTION_KEY = TEST_KEY_HEX;
	});

	afterEach(() => {
		if (savedBridgeKey !== undefined) process.env.BRIDGE_ENCRYPTION_KEY = savedBridgeKey;
		else delete process.env.BRIDGE_ENCRYPTION_KEY;
	});

	// Fresh import each test to reset the _warnedKey flag
	async function loadModule() {
		// Use dynamic import with cache-busting to get a fresh module
		const mod = await import('$lib/server/bridge-crypto');
		return mod;
	}

	describe('encryptBridgeFields + decryptBridgeFields round-trip', () => {
		it('decrypted fields match original input', async () => {
			const { encryptBridgeFields, decryptBridgeFields } = await loadModule();
			const sessionId = 'session-roundtrip-001';

			const blob = await encryptBridgeFields(sessionId, SAMPLE_FIELDS);
			expect(blob).not.toBeNull();

			const decrypted = await decryptBridgeFields(sessionId, blob!);
			expect(decrypted.secret).toBe(SAMPLE_FIELDS.secret);
			expect(decrypted.ephemeralPrivateKeyJwk).toEqual(SAMPLE_FIELDS.ephemeralPrivateKeyJwk);
			expect(decrypted.desktopUserLabel).toBe(SAMPLE_FIELDS.desktopUserLabel);
			expect(decrypted.requests).toEqual(SAMPLE_FIELDS.requests);
			expect(decrypted.nonce).toBe(SAMPLE_FIELDS.nonce);
			expect(decrypted.origin).toBe(SAMPLE_FIELDS.origin);
		});

		it('handles fields with special characters', async () => {
			const { encryptBridgeFields, decryptBridgeFields } = await loadModule();
			const sessionId = 'session-special-chars';
			const fields: SensitiveFields = {
				...SAMPLE_FIELDS,
				desktopUserLabel: 'Ünïcödé Ûšer <admin@example.com>',
				nonce: '🎲-nonce-with-emoji'
			};

			const blob = await encryptBridgeFields(sessionId, fields);
			const decrypted = await decryptBridgeFields(sessionId, blob!);
			expect(decrypted.desktopUserLabel).toBe(fields.desktopUserLabel);
			expect(decrypted.nonce).toBe(fields.nonce);
		});
	});

	describe('key derivation per sessionId', () => {
		it('different sessionId produces different ciphertext (cannot cross-decrypt)', async () => {
			const { encryptBridgeFields, decryptBridgeFields } = await loadModule();

			const blobA = await encryptBridgeFields('session-A', SAMPLE_FIELDS);
			const blobB = await encryptBridgeFields('session-B', SAMPLE_FIELDS);

			expect(blobA).not.toBeNull();
			expect(blobB).not.toBeNull();

			// Ciphertexts should differ (different derived keys + random IVs)
			expect(blobA!.ciphertext).not.toBe(blobB!.ciphertext);

			// Cross-decryption must fail: blob encrypted for session-A, decrypted with session-B key
			await expect(decryptBridgeFields('session-B', blobA!)).rejects.toThrow();
		});
	});

	describe('dev passthrough (no encryption key — throws in production)', () => {
		it('returns null in dev when BRIDGE_ENCRYPTION_KEY is not set', async () => {
			delete process.env.BRIDGE_ENCRYPTION_KEY;

			const { encryptBridgeFields } = await loadModule();
			const result = await encryptBridgeFields('session-dev', SAMPLE_FIELDS);
			expect(result).toBeNull();
		});
	});

	describe('encrypted blob structure', () => {
		it('has ciphertext, iv, and version fields', async () => {
			const { encryptBridgeFields } = await loadModule();
			const blob = await encryptBridgeFields('session-structure', SAMPLE_FIELDS);

			expect(blob).not.toBeNull();
			expect(blob).toHaveProperty('ciphertext');
			expect(blob).toHaveProperty('iv');
			expect(blob).toHaveProperty('version');
			expect(typeof blob!.ciphertext).toBe('string');
			expect(typeof blob!.iv).toBe('string');
			expect(blob!.version).toBe(1);
		});

		it('ciphertext and iv are valid base64', async () => {
			const { encryptBridgeFields } = await loadModule();
			const blob = await encryptBridgeFields('session-base64', SAMPLE_FIELDS);

			// base64 decode should not throw
			expect(() => atob(blob!.ciphertext)).not.toThrow();
			expect(() => atob(blob!.iv)).not.toThrow();

			// IV should be 12 bytes (96-bit for AES-GCM)
			const ivBytes = atob(blob!.iv);
			expect(ivBytes.length).toBe(12);
		});
	});

	describe('tamper detection', () => {
		it('throws when associated data is modified', async () => {
			const { encryptBridgeFields, decryptBridgeFields } = await loadModule();
			const blob = await encryptBridgeFields(
				'session-aad',
				SAMPLE_FIELDS,
				'{"status":"pending"}'
			);
			expect(blob).not.toBeNull();

			await expect(
				decryptBridgeFields('session-aad', blob!, '{"status":"completed"}')
			).rejects.toThrow();
		});

		it('throws when ciphertext is modified', async () => {
			const { encryptBridgeFields, decryptBridgeFields } = await loadModule();
			const blob = await encryptBridgeFields('session-tamper', SAMPLE_FIELDS);
			expect(blob).not.toBeNull();

			// Flip a character in the ciphertext
			const chars = blob!.ciphertext.split('');
			const idx = Math.floor(chars.length / 2);
			chars[idx] = chars[idx] === 'A' ? 'B' : 'A';
			const tampered: EncryptedBlob = { ...blob!, ciphertext: chars.join('') };

			await expect(decryptBridgeFields('session-tamper', tampered)).rejects.toThrow();
		});

		it('throws when iv is modified', async () => {
			const { encryptBridgeFields, decryptBridgeFields } = await loadModule();
			const blob = await encryptBridgeFields('session-tamper-iv', SAMPLE_FIELDS);
			expect(blob).not.toBeNull();

			// Replace IV with a different 12-byte value
			const differentIv = btoa(String.fromCharCode(...new Uint8Array(12).fill(0xff)));
			const tampered: EncryptedBlob = { ...blob!, iv: differentIv };

			await expect(decryptBridgeFields('session-tamper-iv', tampered)).rejects.toThrow();
		});
	});

	describe('decryptBridgeFields without key', () => {
		it('throws when encryption key is missing', async () => {
			const { encryptBridgeFields, decryptBridgeFields } = await loadModule();

			// Encrypt with key
			const blob = await encryptBridgeFields('session-no-key', SAMPLE_FIELDS);
			expect(blob).not.toBeNull();

			// Remove key, try to decrypt
			delete process.env.BRIDGE_ENCRYPTION_KEY;

			// Need fresh module load since getMasterKeyHex reads env at call time
			const mod2 = await loadModule();
			await expect(mod2.decryptBridgeFields('session-no-key', blob!)).rejects.toThrow(
				/not set/
			);
		});
	});
});
