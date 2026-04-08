import { describe, it, expect } from 'vitest';
import {
	deriveOrgKey,
	encryptWithOrgKey,
	decryptWithOrgKey,
	createKeyVerifier,
	verifyOrgKey,
	generateRecoveryKey,
	mnemonicToRecoveryKey,
	wrapOrgKeyForRecovery,
	unwrapOrgKeyFromRecovery,
	wrapOrgKeyForDevice,
	unwrapOrgKeyFromDevice,
	type OrgEncryptedPii
} from '$lib/core/crypto/org-pii-encryption';
import { wordlist } from '$lib/core/crypto/bip39-english';

describe('Org PII Encryption', () => {
	const TEST_PASSPHRASE = 'test-org-passphrase-2026';
	const TEST_ORG_ID = 'org_test123';

	describe('deriveOrgKey', () => {
		it('same passphrase + org = same key (deterministic)', async () => {
			const key1 = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const key2 = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);

			const raw1 = new Uint8Array(await crypto.subtle.exportKey('raw', key1));
			const raw2 = new Uint8Array(await crypto.subtle.exportKey('raw', key2));

			expect(raw1).toEqual(raw2);
		});

		it('different passphrase = different key', async () => {
			const key1 = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const key2 = await deriveOrgKey('different-passphrase', TEST_ORG_ID);

			const raw1 = new Uint8Array(await crypto.subtle.exportKey('raw', key1));
			const raw2 = new Uint8Array(await crypto.subtle.exportKey('raw', key2));

			expect(raw1).not.toEqual(raw2);
		});

		it('different orgId = different key', async () => {
			const key1 = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const key2 = await deriveOrgKey(TEST_PASSPHRASE, 'org_other456');

			const raw1 = new Uint8Array(await crypto.subtle.exportKey('raw', key1));
			const raw2 = new Uint8Array(await crypto.subtle.exportKey('raw', key2));

			expect(raw1).not.toEqual(raw2);
		});
	});

	describe('encrypt/decrypt', () => {
		it('round-trip succeeds', async () => {
			const key = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const plaintext = 'supporter@example.com';

			const encrypted = await encryptWithOrgKey(plaintext, key, 'supporter:123', 'email');
			const decrypted = await decryptWithOrgKey(encrypted, key, 'supporter:123', 'email');

			expect(decrypted).toBe(plaintext);
		});

		it('different IVs each time (non-deterministic)', async () => {
			const key = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const plaintext = 'supporter@example.com';

			const enc1 = await encryptWithOrgKey(plaintext, key, 'supporter:123', 'email');
			const enc2 = await encryptWithOrgKey(plaintext, key, 'supporter:123', 'email');

			expect(enc1.iv).not.toBe(enc2.iv);
			expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
		});

		it('version tag is org-1', async () => {
			const key = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const encrypted = await encryptWithOrgKey('test', key, 'entity', 'field');
			expect(encrypted.v).toBe('org-1');
		});

		it('wrong key fails to decrypt', async () => {
			const key1 = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const key2 = await deriveOrgKey('wrong-passphrase', TEST_ORG_ID);

			const encrypted = await encryptWithOrgKey('secret', key1, 'entity', 'field');

			await expect(
				decryptWithOrgKey(encrypted, key2, 'entity', 'field')
			).rejects.toThrow();
		});

		it('wrong AAD fails to decrypt', async () => {
			const key = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);

			const encrypted = await encryptWithOrgKey('secret', key, 'entity:1', 'email');

			await expect(
				decryptWithOrgKey(encrypted, key, 'entity:2', 'email')
			).rejects.toThrow();
		});
	});

	describe('key verifier', () => {
		it('correct key verifies', async () => {
			const key = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const verifier = await createKeyVerifier(key);

			expect(await verifyOrgKey(key, verifier)).toBe(true);
		});

		it('wrong key fails verification', async () => {
			const key1 = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const key2 = await deriveOrgKey('wrong', TEST_ORG_ID);
			const verifier = await createKeyVerifier(key1);

			expect(await verifyOrgKey(key2, verifier)).toBe(false);
		});
	});

	describe('recovery', () => {
		it('generates 24 words', () => {
			const { words } = generateRecoveryKey();
			expect(words).toHaveLength(24);
		});

		it('words are from BIP39 wordlist', () => {
			const { words } = generateRecoveryKey();
			for (const word of words) {
				expect(wordlist).toContain(word);
			}
		});

		it('key is 32 bytes', () => {
			const { key } = generateRecoveryKey();
			expect(key).toHaveLength(32);
		});

		it('mnemonic round-trips to same key', () => {
			const { key, words } = generateRecoveryKey();
			const recovered = mnemonicToRecoveryKey(words);
			expect(recovered).toEqual(key);
		});

		it('wrap → unwrap round-trip', async () => {
			const orgKey = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const { key: recoveryKey } = generateRecoveryKey();

			const wrapped = await wrapOrgKeyForRecovery(orgKey, recoveryKey);
			const unwrapped = await unwrapOrgKeyFromRecovery(wrapped, recoveryKey);

			const raw1 = new Uint8Array(await crypto.subtle.exportKey('raw', orgKey));
			const raw2 = new Uint8Array(await crypto.subtle.exportKey('raw', unwrapped));
			expect(raw1).toEqual(raw2);
		});

		it('recovered key decrypts data from original key', async () => {
			const orgKey = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const { key: recoveryKey } = generateRecoveryKey();

			const encrypted = await encryptWithOrgKey('secret-data', orgKey, 'ent', 'field');
			const wrapped = await wrapOrgKeyForRecovery(orgKey, recoveryKey);
			const recovered = await unwrapOrgKeyFromRecovery(wrapped, recoveryKey);

			const decrypted = await decryptWithOrgKey(encrypted, recovered, 'ent', 'field');
			expect(decrypted).toBe('secret-data');
		});

		it('wrong recovery key fails to unwrap', async () => {
			const orgKey = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const { key: recoveryKey } = generateRecoveryKey();
			const { key: wrongKey } = generateRecoveryKey();

			const wrapped = await wrapOrgKeyForRecovery(orgKey, recoveryKey);

			await expect(
				unwrapOrgKeyFromRecovery(wrapped, wrongKey)
			).rejects.toThrow();
		});

		it('rejects invalid mnemonic length', () => {
			expect(() => mnemonicToRecoveryKey(['abandon'])).toThrow('24 words');
		});

		it('rejects invalid BIP39 words', () => {
			const words = Array(24).fill('notaword');
			expect(() => mnemonicToRecoveryKey(words)).toThrow('Invalid BIP39 word');
		});
	});

	describe('device caching', () => {
		it('wrap → unwrap round-trip', async () => {
			const orgKey = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const deviceBytes = crypto.getRandomValues(new Uint8Array(32)).buffer;

			const wrapped = await wrapOrgKeyForDevice(orgKey, deviceBytes);
			const unwrapped = await unwrapOrgKeyFromDevice(wrapped, deviceBytes);

			const raw1 = new Uint8Array(await crypto.subtle.exportKey('raw', orgKey));
			const raw2 = new Uint8Array(await crypto.subtle.exportKey('raw', unwrapped));
			expect(raw1).toEqual(raw2);
		});

		it('cached key decrypts data from original key', async () => {
			const orgKey = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const deviceBytes = crypto.getRandomValues(new Uint8Array(32)).buffer;

			const encrypted = await encryptWithOrgKey('cached-secret', orgKey, 'ent', 'field');
			const wrapped = await wrapOrgKeyForDevice(orgKey, deviceBytes);
			const cached = await unwrapOrgKeyFromDevice(wrapped, deviceBytes);

			const decrypted = await decryptWithOrgKey(encrypted, cached, 'ent', 'field');
			expect(decrypted).toBe('cached-secret');
		});

		it('wrong device key fails to unwrap', async () => {
			const orgKey = await deriveOrgKey(TEST_PASSPHRASE, TEST_ORG_ID);
			const device1 = crypto.getRandomValues(new Uint8Array(32)).buffer;
			const device2 = crypto.getRandomValues(new Uint8Array(32)).buffer;

			const wrapped = await wrapOrgKeyForDevice(orgKey, device1);

			await expect(
				unwrapOrgKeyFromDevice(wrapped, device2)
			).rejects.toThrow();
		});
	});
});
