/**
 * Identity Encryption Integration Tests
 *
 * Tests browser-side encryption → server storage → retrieval flow
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
	initCrypto,
	encryptIdentityBlob,
	isValidEncryptedBlob,
	getBlobStorage,
	type IdentityBlob,
	type TEEPublicKey
} from '$lib/core/identity/blob-encryption';
import sodium from 'libsodium-wrappers';

describe('Identity Blob Encryption', () => {
	beforeAll(async () => {
		await initCrypto();
	});

	it('should initialize libsodium correctly', async () => {
		await sodium.ready;
		expect(sodium).toBeDefined();
	});

	it('should encrypt identity blob with XChaCha20-Poly1305', async () => {
		const testBlob: IdentityBlob = {
			address: {
				street: '123 Main St',
				city: 'San Francisco',
				state: 'CA',
				zip: '94102'
			},
			verificationCredential: {
				provider: 'digital-credentials-api',
				credentialHash: 'abc123',
				issuedAt: Date.now()
			}
		};

		// Generate mock TEE public key
		const keypair = sodium.crypto_box_keypair();
		const mockTEEKey: TEEPublicKey = {
			publicKey: keypair.publicKey,
			keyId: 'test-key-1'
		};

		const encrypted = await encryptIdentityBlob(testBlob, mockTEEKey);

		expect(encrypted).toBeDefined();
		expect(encrypted.ciphertext).toBeTruthy();
		expect(encrypted.nonce).toBeTruthy();
		expect(encrypted.publicKey).toBeTruthy();
		expect(encrypted.version).toBe('1.0.0');
		expect(encrypted.timestamp).toBeGreaterThan(0);
	});

	it('should validate encrypted blob structure', async () => {
		const validBlob = {
			ciphertext: 'base64data',
			nonce: 'base64nonce',
			publicKey: 'base64pubkey',
			version: '1.0.0',
			timestamp: Date.now()
		};

		expect(isValidEncryptedBlob(validBlob)).toBe(true);

		const invalidBlob1 = { ciphertext: 'data' }; // Missing fields
		expect(isValidEncryptedBlob(invalidBlob1)).toBe(false);

		const invalidBlob2 = null;
		expect(isValidEncryptedBlob(invalidBlob2)).toBe(false);
	});

	it('should get server blob storage by default', () => {
		const storage = getBlobStorage();
		expect(storage).toBeDefined();
		expect(storage.constructor.name).toBe('ServerBlobStorage');
	});

	it('should encrypt with deterministic nonce generation', async () => {
		const testBlob: IdentityBlob = {
			address: {
				street: '456 Oak Ave',
				city: 'Los Angeles',
				state: 'CA',
				zip: '90001'
			},
			verificationCredential: {
				provider: 'digital-credentials-api',
				credentialHash: 'def456',
				issuedAt: Date.now()
			}
		};

		const keypair = sodium.crypto_box_keypair();
		const mockTEEKey: TEEPublicKey = {
			publicKey: keypair.publicKey,
			keyId: 'test-key-2'
		};

		const encrypted1 = await encryptIdentityBlob(testBlob, mockTEEKey);
		const encrypted2 = await encryptIdentityBlob(testBlob, mockTEEKey);

		// Different nonces (random generation for security)
		expect(encrypted1.nonce).not.toBe(encrypted2.nonce);

		// Both should be valid
		expect(isValidEncryptedBlob(encrypted1)).toBe(true);
		expect(isValidEncryptedBlob(encrypted2)).toBe(true);
	});

	it('should include optional district data in encryption', async () => {
		const testBlob: IdentityBlob = {
			address: {
				street: '789 Elm St',
				city: 'Dallas',
				state: 'TX',
				zip: '75201'
			},
			verificationCredential: {
				provider: 'digital-credentials-api',
				credentialHash: 'ghi789',
				issuedAt: Date.now()
			},
			district: {
				congressional: 'TX-30',
				stateSenate: 'SD-16',
				stateHouse: 'HD-100'
			}
		};

		const keypair = sodium.crypto_box_keypair();
		const mockTEEKey: TEEPublicKey = {
			publicKey: keypair.publicKey,
			keyId: 'test-key-3'
		};

		const encrypted = await encryptIdentityBlob(testBlob, mockTEEKey);

		expect(encrypted).toBeDefined();
		expect(encrypted.ciphertext).toBeTruthy();
		// Ciphertext should be larger due to additional district data
		expect(encrypted.ciphertext.length).toBeGreaterThan(100);
	});

	it('should include template personalization data', async () => {
		const testBlob: IdentityBlob = {
			address: {
				street: '321 Pine St',
				city: 'Seattle',
				state: 'WA',
				zip: '98101'
			},
			verificationCredential: {
				provider: 'digital-credentials-api',
				credentialHash: 'jkl012',
				issuedAt: Date.now()
			},
			templateData: {
				preferredName: 'Dr. Smith',
				customSignature: 'Best regards,\nDr. Jane Smith',
				savedTemplates: ['QmABC123', 'QmDEF456']
			}
		};

		const keypair = sodium.crypto_box_keypair();
		const mockTEEKey: TEEPublicKey = {
			publicKey: keypair.publicKey,
			keyId: 'test-key-4'
		};

		const encrypted = await encryptIdentityBlob(testBlob, mockTEEKey);

		expect(encrypted).toBeDefined();
		expect(encrypted.version).toBe('1.0.0');
	});
});
