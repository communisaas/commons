import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';

// Generate a stable 32-byte wrapping key for tests
const TEST_WRAPPING_KEY_HEX = crypto.randomBytes(32).toString('hex');
const TEST_ORG_ID = 'org_test_unseal_123';

describe('Org Key Seal/Unseal', () => {
	let sealOrgKey: typeof import('../../../convex/_orgKeyUnseal').sealOrgKey;
	let unsealOrgKey: typeof import('../../../convex/_orgKeyUnseal').unsealOrgKey;
	let getOrgKeyForAction: typeof import('../../../convex/_orgKeyUnseal').getOrgKeyForAction;

	beforeEach(async () => {
		// Set the wrapping key env var before importing the module
		process.env.ORG_KEY_WRAPPING_KEY = TEST_WRAPPING_KEY_HEX;

		// Dynamic import to pick up env var; reset module cache each time
		vi.resetModules();
		const mod = await import('../../../convex/_orgKeyUnseal');
		sealOrgKey = mod.sealOrgKey;
		unsealOrgKey = mod.unsealOrgKey;
		getOrgKeyForAction = mod.getOrgKeyForAction;
	});

	afterEach(() => {
		delete process.env.ORG_KEY_WRAPPING_KEY;
		vi.restoreAllMocks();
	});

	/**
	 * Helper: generate a random 32-byte key and return as base64.
	 */
	function randomKeyBase64(): string {
		const bytes = crypto.randomBytes(32);
		return bytes.toString('base64');
	}

	describe('seal → unseal round-trip', () => {
		it('produces the same key bytes after round-trip', async () => {
			const rawKeyBase64 = randomKeyBase64();
			const sealedBlob = await sealOrgKey(rawKeyBase64, TEST_ORG_ID);
			const unsealedKey = await unsealOrgKey(sealedBlob, TEST_ORG_ID);

			// importOrgKey sets extractable=false, so we verify by encrypting
			// with the unsealed key and comparing against a fresh import of the
			// same raw bytes.
			const { importOrgKey } = await import('../../../convex/_orgKey');
			const rawBytes = Buffer.from(rawKeyBase64, 'base64');
			const originalKey = await globalThis.crypto.subtle.importKey(
				'raw',
				rawBytes,
				{ name: 'AES-GCM', length: 256 },
				true, // extractable so we can compare
				['encrypt', 'decrypt']
			);

			// Encrypt with the unsealed key, decrypt with the original
			const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
			const testData = new TextEncoder().encode('round-trip-test');

			const ciphertext = await globalThis.crypto.subtle.encrypt(
				{ name: 'AES-GCM', iv },
				unsealedKey,
				testData
			);

			const decrypted = await globalThis.crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv },
				originalKey,
				ciphertext
			);

			expect(Buffer.from(decrypted).toString('hex')).toBe(
				Buffer.from(testData).toString('hex')
			);
		});
	});

	describe('AAD binding', () => {
		it('wrong orgId in unseal fails (AAD mismatch)', async () => {
			const rawKeyBase64 = randomKeyBase64();
			const sealedBlob = await sealOrgKey(rawKeyBase64, TEST_ORG_ID);

			await expect(
				unsealOrgKey(sealedBlob, 'org_wrong_id')
			).rejects.toThrow();
		});
	});

	describe('wrapping key mismatch', () => {
		it('wrong wrapping key fails to unseal', async () => {
			const rawKeyBase64 = randomKeyBase64();
			const sealedBlob = await sealOrgKey(rawKeyBase64, TEST_ORG_ID);

			// Change the wrapping key env var and re-import
			process.env.ORG_KEY_WRAPPING_KEY = crypto.randomBytes(32).toString('hex');
			vi.resetModules();
			const mod2 = await import('../../../convex/_orgKeyUnseal');

			await expect(
				mod2.unsealOrgKey(sealedBlob, TEST_ORG_ID)
			).rejects.toThrow();
		});
	});

	describe('key size validation', () => {
		it('rejects non-32-byte key input (16 bytes)', async () => {
			const shortKey = crypto.randomBytes(16).toString('base64');

			await expect(
				sealOrgKey(shortKey, TEST_ORG_ID)
			).rejects.toThrow('Org key must be 32 bytes');
		});

		it('rejects non-32-byte key input (64 bytes)', async () => {
			const longKey = crypto.randomBytes(64).toString('base64');

			await expect(
				sealOrgKey(longKey, TEST_ORG_ID)
			).rejects.toThrow('Org key must be 32 bytes');
		});
	});

	describe('sealed blob format', () => {
		it('has version "seal-1"', async () => {
			const rawKeyBase64 = randomKeyBase64();
			const sealedBlob = await sealOrgKey(rawKeyBase64, TEST_ORG_ID);

			const parsed = JSON.parse(sealedBlob);
			expect(parsed.v).toBe('seal-1');
		});

		it('contains ciphertext and iv as base64 strings', async () => {
			const rawKeyBase64 = randomKeyBase64();
			const sealedBlob = await sealOrgKey(rawKeyBase64, TEST_ORG_ID);

			const parsed = JSON.parse(sealedBlob);
			expect(typeof parsed.ciphertext).toBe('string');
			expect(typeof parsed.iv).toBe('string');
			// base64 should decode without error
			expect(() => Buffer.from(parsed.ciphertext, 'base64')).not.toThrow();
			expect(() => Buffer.from(parsed.iv, 'base64')).not.toThrow();
		});

		it('IV is 12 bytes (96-bit nonce)', async () => {
			const rawKeyBase64 = randomKeyBase64();
			const sealedBlob = await sealOrgKey(rawKeyBase64, TEST_ORG_ID);

			const parsed = JSON.parse(sealedBlob);
			const ivBytes = Buffer.from(parsed.iv, 'base64');
			expect(ivBytes.length).toBe(12);
		});
	});

	describe('getOrgKeyForAction', () => {
		it('returns null when org has no serverSealedOrgKey (db context)', async () => {
			const mockCtx = {
				db: {
					get: vi.fn().mockResolvedValue({ id: TEST_ORG_ID })
					// no serverSealedOrgKey field
				}
			};

			const result = await getOrgKeyForAction(mockCtx, TEST_ORG_ID);
			expect(result).toBeNull();
		});

		it('returns null when org does not exist (db context)', async () => {
			const mockCtx = {
				db: {
					get: vi.fn().mockResolvedValue(null)
				}
			};

			const result = await getOrgKeyForAction(mockCtx, 'org_nonexistent');
			expect(result).toBeNull();
		});

		it('returns null when ctx has neither db nor runQuery', async () => {
			const mockCtx = {};
			const result = await getOrgKeyForAction(mockCtx, TEST_ORG_ID);
			expect(result).toBeNull();
		});

		it('returns CryptoKey when org has serverSealedOrgKey (db context)', async () => {
			const rawKeyBase64 = randomKeyBase64();
			const sealedBlob = await sealOrgKey(rawKeyBase64, TEST_ORG_ID);

			const mockCtx = {
				db: {
					get: vi.fn().mockResolvedValue({
						id: TEST_ORG_ID,
						serverSealedOrgKey: sealedBlob
					})
				}
			};

			const result = await getOrgKeyForAction(mockCtx, TEST_ORG_ID);
			expect(result).not.toBeNull();
			expect(result!.type).toBe('secret');
			expect(result!.algorithm).toMatchObject({ name: 'AES-GCM' });
		});
	});

	describe('wrapping key env var', () => {
		it('throws when ORG_KEY_WRAPPING_KEY is not set', async () => {
			delete process.env.ORG_KEY_WRAPPING_KEY;
			vi.resetModules();
			const mod = await import('../../../convex/_orgKeyUnseal');

			await expect(
				mod.sealOrgKey(randomKeyBase64(), TEST_ORG_ID)
			).rejects.toThrow('ORG_KEY_WRAPPING_KEY not configured');
		});

		it('throws when ORG_KEY_WRAPPING_KEY is wrong length', async () => {
			process.env.ORG_KEY_WRAPPING_KEY = 'aabb'; // 2 bytes, not 32
			vi.resetModules();
			const mod = await import('../../../convex/_orgKeyUnseal');

			await expect(
				mod.sealOrgKey(randomKeyBase64(), TEST_ORG_ID)
			).rejects.toThrow('ORG_KEY_WRAPPING_KEY must be 32 bytes');
		});
	});
});
