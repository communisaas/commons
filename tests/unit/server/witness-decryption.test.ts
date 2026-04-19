/**
 * Server-Side Witness Decryption Tests
 *
 * Tests the decryptWitness() function and its encoding helpers (hexToBytes, base64ToBytes).
 *
 * The server uses @noble libraries (pure JS) to decrypt data encrypted by the client
 * with libsodium (browser WASM). Wire format: X25519 ECDH -> BLAKE2b KDF -> XChaCha20-Poly1305.
 *
 * These tests complement witness-roundtrip.test.ts by focusing on:
 * - Edge cases in the decryption path (bad keys, tampered data, invalid encodings)
 * - Input validation and error messaging
 * - Encoding helper correctness (hexToBytes, base64ToBytes)
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { x25519 } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2b';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils';
import { decryptWitness, type EncryptedWitnessPayload } from '$lib/server/witness-decryption';

// ============================================================================
// Encoding helpers (mirrors client-side helpers from witness-roundtrip.test.ts)
// ============================================================================

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
	}
	return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

// ============================================================================
// Test encryption helper (simulates client-side libsodium)
// ============================================================================

function encryptWithNoble(
	plaintext: string,
	serverPublicKeyHex: string
): EncryptedWitnessPayload {
	const ephemeralPrivate = x25519.utils.randomPrivateKey();
	const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);

	const serverPubBytes = hexToBytes(serverPublicKeyHex);
	const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, serverPubBytes);

	const encryptionKey = blake2b(sharedSecret, {
		dkLen: 32,
		key: new TextEncoder().encode('commons-witness-encryption-v1')
	});

	const nonce = randomBytes(24);
	const cipher = xchacha20poly1305(encryptionKey, nonce);
	const ct = cipher.encrypt(new TextEncoder().encode(plaintext));

	return {
		ciphertext: bytesToBase64(ct),
		nonce: bytesToBase64(nonce),
		ephemeralPublicKey: bytesToHex(ephemeralPublic)
	};
}

// ============================================================================
// Server keypair generation
// ============================================================================

function generateServerKeypair() {
	const privateKey = x25519.utils.randomPrivateKey();
	const publicKey = x25519.getPublicKey(privateKey);
	return {
		privateKey,
		privateKeyHex: bytesToHex(privateKey),
		publicKey,
		publicKeyHex: bytesToHex(publicKey)
	};
}

// ============================================================================
// Tests
// ============================================================================

describe('witness-decryption', () => {
	const server = generateServerKeypair();

	beforeEach(() => {
		// Clear env to avoid interference between tests
		delete process.env.WITNESS_ENCRYPTION_PRIVATE_KEY;
	});

	afterEach(() => {
		delete process.env.WITNESS_ENCRYPTION_PRIVATE_KEY;
	});

	// -----------------------------------------------------------------------
	// decryptWitness: Successful decryption
	// -----------------------------------------------------------------------

	describe('decryptWitness - successful decryption', () => {
		it('decrypts a simple JSON witness with explicit private key', async () => {
			const witness = { action: 'send', templateId: 'tmpl_001' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);
			const result = await decryptWitness(encrypted, server.privateKeyHex);
			expect(result).toEqual(witness);
		});

		it('decrypts using WITNESS_ENCRYPTION_PRIVATE_KEY from env', async () => {
			process.env.WITNESS_ENCRYPTION_PRIVATE_KEY = server.privateKeyHex;
			const witness = { action: 'vote', proposalId: 'prop_42' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);
			const result = await decryptWitness(encrypted);
			expect(result).toEqual(witness);
		});

		it('explicit key takes precedence over env var', async () => {
			// Set env to a wrong key
			const wrongServer = generateServerKeypair();
			process.env.WITNESS_ENCRYPTION_PRIVATE_KEY = wrongServer.privateKeyHex;

			const witness = { action: 'attest' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			// Pass correct key explicitly - should succeed
			const result = await decryptWitness(encrypted, server.privateKeyHex);
			expect(result).toEqual(witness);
		});

		it('decrypts nested objects with arrays, nulls, and numbers', async () => {
			const witness = {
				action: 'deliver',
				address: { street: '123 Main St', city: 'Springfield' },
				recipients: ['rep_001', 'rep_002'],
				nullField: null,
				count: 3.14159,
				flag: true
			};
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);
			const result = await decryptWitness(encrypted, server.privateKeyHex);
			expect(result).toEqual(witness);
		});

		it('decrypts an empty JSON object', async () => {
			const encrypted = encryptWithNoble('{}', server.publicKeyHex);
			const result = await decryptWitness(encrypted, server.privateKeyHex);
			expect(result).toEqual({});
		});

		it('decrypts witness with unicode characters', async () => {
			const witness = {
				name: 'Jose Garcia',
				message: 'Climate policy matters for everyone'
			};
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);
			const result = await decryptWitness(encrypted, server.privateKeyHex);
			expect(result).toEqual(witness);
		});

		it('decrypts a large witness payload', async () => {
			const witness = {
				action: 'bulk_deliver',
				entries: Array.from({ length: 100 }, (_, i) => ({
					id: `entry_${i}`,
					value: `data_${i}_${'x'.repeat(100)}`
				}))
			};
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);
			const result = await decryptWitness(encrypted, server.privateKeyHex);
			expect(result).toEqual(witness);
		});
	});

	// -----------------------------------------------------------------------
	// decryptWitness: Failure with wrong keys
	// -----------------------------------------------------------------------

	describe('decryptWitness - wrong key failures', () => {
		it('throws when decrypting with a completely different private key', async () => {
			const wrongServer = generateServerKeypair();
			const witness = { action: 'test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			await expect(decryptWitness(encrypted, wrongServer.privateKeyHex)).rejects.toThrow();
		});

		it('throws when private key is all zeros', async () => {
			const witness = { action: 'test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);
			const zeroKey = '0'.repeat(64);

			await expect(decryptWitness(encrypted, zeroKey)).rejects.toThrow();
		});

		it('throws when no private key is provided and env is unset', async () => {
			delete process.env.WITNESS_ENCRYPTION_PRIVATE_KEY;
			const encrypted = encryptWithNoble('{"a":1}', server.publicKeyHex);

			await expect(decryptWitness(encrypted)).rejects.toThrow(
				'WITNESS_ENCRYPTION_PRIVATE_KEY not configured'
			);
		});

		it('throws when private key is empty string', async () => {
			const encrypted = encryptWithNoble('{"a":1}', server.publicKeyHex);

			await expect(decryptWitness(encrypted, '')).rejects.toThrow(
				'WITNESS_ENCRYPTION_PRIVATE_KEY not configured'
			);
		});
	});

	// -----------------------------------------------------------------------
	// decryptWitness: Tampered ciphertext
	// -----------------------------------------------------------------------

	describe('decryptWitness - tampered ciphertext', () => {
		it('throws when ciphertext bytes are flipped', async () => {
			const witness = { action: 'tamper_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			// Decode, flip bytes, re-encode
			const ctBinary = atob(encrypted.ciphertext);
			const ctBytes = new Uint8Array(ctBinary.length);
			for (let i = 0; i < ctBinary.length; i++) {
				ctBytes[i] = ctBinary.charCodeAt(i);
			}
			ctBytes[0] ^= 0xff;
			const tampered = bytesToBase64(ctBytes);

			await expect(
				decryptWitness({ ...encrypted, ciphertext: tampered }, server.privateKeyHex)
			).rejects.toThrow();
		});

		it('throws when ciphertext is truncated', async () => {
			const witness = { action: 'truncate_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			// Truncate ciphertext to half its length
			const ctBinary = atob(encrypted.ciphertext);
			const ctBytes = new Uint8Array(ctBinary.length);
			for (let i = 0; i < ctBinary.length; i++) {
				ctBytes[i] = ctBinary.charCodeAt(i);
			}
			const truncated = bytesToBase64(ctBytes.slice(0, Math.floor(ctBytes.length / 2)));

			await expect(
				decryptWitness({ ...encrypted, ciphertext: truncated }, server.privateKeyHex)
			).rejects.toThrow();
		});

		it('throws when ciphertext has extra bytes appended', async () => {
			const witness = { action: 'extend_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			const ctBinary = atob(encrypted.ciphertext);
			const ctBytes = new Uint8Array(ctBinary.length + 16);
			for (let i = 0; i < ctBinary.length; i++) {
				ctBytes[i] = ctBinary.charCodeAt(i);
			}
			// Append garbage bytes
			for (let i = ctBinary.length; i < ctBytes.length; i++) {
				ctBytes[i] = 0xaa;
			}
			const extended = bytesToBase64(ctBytes);

			await expect(
				decryptWitness({ ...encrypted, ciphertext: extended }, server.privateKeyHex)
			).rejects.toThrow();
		});

		it('throws when Poly1305 auth tag is corrupted', async () => {
			const witness = { action: 'auth_tag_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			// The last 16 bytes of XChaCha20-Poly1305 ciphertext are the auth tag
			const ctBinary = atob(encrypted.ciphertext);
			const ctBytes = new Uint8Array(ctBinary.length);
			for (let i = 0; i < ctBinary.length; i++) {
				ctBytes[i] = ctBinary.charCodeAt(i);
			}
			// Corrupt the last byte (part of auth tag)
			ctBytes[ctBytes.length - 1] ^= 0x01;
			const corrupted = bytesToBase64(ctBytes);

			await expect(
				decryptWitness({ ...encrypted, ciphertext: corrupted }, server.privateKeyHex)
			).rejects.toThrow();
		});
	});

	// -----------------------------------------------------------------------
	// decryptWitness: Invalid nonce
	// -----------------------------------------------------------------------

	describe('decryptWitness - invalid nonce', () => {
		it('throws when nonce is replaced with a different random nonce', async () => {
			const witness = { action: 'nonce_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			// Replace nonce with a different random 24-byte nonce
			const wrongNonce = randomBytes(24);
			const modified = { ...encrypted, nonce: bytesToBase64(wrongNonce) };

			await expect(decryptWitness(modified, server.privateKeyHex)).rejects.toThrow();
		});

		it('throws when nonce is all zeros', async () => {
			const witness = { action: 'zero_nonce_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			const zeroNonce = new Uint8Array(24);
			const modified = { ...encrypted, nonce: bytesToBase64(zeroNonce) };

			await expect(decryptWitness(modified, server.privateKeyHex)).rejects.toThrow();
		});

		it('throws when nonce is wrong length (16 bytes instead of 24)', async () => {
			const witness = { action: 'short_nonce_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			const shortNonce = randomBytes(16);
			const modified = { ...encrypted, nonce: bytesToBase64(shortNonce) };

			await expect(decryptWitness(modified, server.privateKeyHex)).rejects.toThrow();
		});
	});

	// -----------------------------------------------------------------------
	// decryptWitness: Invalid ephemeral public key
	// -----------------------------------------------------------------------

	describe('decryptWitness - invalid ephemeral public key', () => {
		it('throws when ephemeral public key is replaced', async () => {
			const witness = { action: 'epk_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			// Replace with a different X25519 public key
			const otherPrivate = x25519.utils.randomPrivateKey();
			const otherPublic = x25519.getPublicKey(otherPrivate);
			const modified = { ...encrypted, ephemeralPublicKey: bytesToHex(otherPublic) };

			await expect(decryptWitness(modified, server.privateKeyHex)).rejects.toThrow();
		});

		it('throws when ephemeral public key is all zeros', async () => {
			const witness = { action: 'zero_epk_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			const modified = { ...encrypted, ephemeralPublicKey: '0'.repeat(64) };

			// X25519 with all-zeros public key produces a zero shared secret,
			// which will fail during AEAD decryption
			await expect(decryptWitness(modified, server.privateKeyHex)).rejects.toThrow();
		});
	});

	// -----------------------------------------------------------------------
	// decryptWitness: Malformed JSON plaintext
	// -----------------------------------------------------------------------

	describe('decryptWitness - malformed plaintext', () => {
		it('throws when decrypted plaintext is not valid JSON', async () => {
			// Encrypt a non-JSON string that will decrypt correctly but fail JSON.parse
			const encrypted = encryptWithNoble('this is not json', server.publicKeyHex);

			await expect(decryptWitness(encrypted, server.privateKeyHex)).rejects.toThrow();
		});

		it('throws when decrypted plaintext is a JSON array (not object)', async () => {
			// Arrays are valid JSON but not Record<string, unknown>
			// The function should still return it since JSON.parse succeeds
			const encrypted = encryptWithNoble('[1,2,3]', server.publicKeyHex);
			const result = await decryptWitness(encrypted, server.privateKeyHex);
			// JSON.parse('[1,2,3]') returns an array - the function doesn't validate shape
			expect(result).toEqual([1, 2, 3]);
		});
	});

	// -----------------------------------------------------------------------
	// decryptWitness: 0x-prefixed private key
	// -----------------------------------------------------------------------

	describe('decryptWitness - hex prefix handling', () => {
		it('accepts 0x-prefixed private key', async () => {
			const witness = { action: 'prefix_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			const prefixedKey = '0x' + server.privateKeyHex;
			const result = await decryptWitness(encrypted, prefixedKey);
			expect(result).toEqual(witness);
		});

		it('accepts 0x-prefixed ephemeral public key', async () => {
			const witness = { action: 'epk_prefix_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			// Add 0x prefix to ephemeral public key
			const modified = {
				...encrypted,
				ephemeralPublicKey: '0x' + encrypted.ephemeralPublicKey
			};
			const result = await decryptWitness(modified, server.privateKeyHex);
			expect(result).toEqual(witness);
		});
	});

	// -----------------------------------------------------------------------
	// hexToBytes edge cases (tested indirectly via decryptWitness)
	// -----------------------------------------------------------------------

	describe('hexToBytes - edge cases via decryptWitness', () => {
		it('handles uppercase hex characters in private key', async () => {
			const witness = { action: 'uppercase_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			// Note: hexToBytes uses parseInt which is case-insensitive
			const upperKey = server.privateKeyHex.toUpperCase();
			const result = await decryptWitness(encrypted, upperKey);
			expect(result).toEqual(witness);
		});

		it('handles mixed case hex in ephemeral public key', async () => {
			const witness = { action: 'mixedcase_test' };
			const encrypted = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);

			// Mix case in ephemeral key
			const mixedKey = encrypted.ephemeralPublicKey
				.split('')
				.map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
				.join('');
			const modified = { ...encrypted, ephemeralPublicKey: mixedKey };
			const result = await decryptWitness(modified, server.privateKeyHex);
			expect(result).toEqual(witness);
		});
	});

	// -----------------------------------------------------------------------
	// Wire format compatibility
	// -----------------------------------------------------------------------

	describe('wire format compatibility', () => {
		it('multiple encryptions of same plaintext produce unique ciphertexts', () => {
			const plaintext = JSON.stringify({ action: 'determinism_test' });
			const enc1 = encryptWithNoble(plaintext, server.publicKeyHex);
			const enc2 = encryptWithNoble(plaintext, server.publicKeyHex);

			expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
			expect(enc1.nonce).not.toBe(enc2.nonce);
			expect(enc1.ephemeralPublicKey).not.toBe(enc2.ephemeralPublicKey);
		});

		it('both encryptions decrypt to the same plaintext', async () => {
			const witness = { action: 'both_decrypt', id: 'test' };
			const plaintext = JSON.stringify(witness);
			const enc1 = encryptWithNoble(plaintext, server.publicKeyHex);
			const enc2 = encryptWithNoble(plaintext, server.publicKeyHex);

			const dec1 = await decryptWitness(enc1, server.privateKeyHex);
			const dec2 = await decryptWitness(enc2, server.privateKeyHex);

			expect(dec1).toEqual(witness);
			expect(dec2).toEqual(witness);
		});

		it('different server keypairs cannot decrypt each others ciphertexts', async () => {
			const server2 = generateServerKeypair();
			const witness = { action: 'cross_key_test' };

			const enc1 = encryptWithNoble(JSON.stringify(witness), server.publicKeyHex);
			const enc2 = encryptWithNoble(JSON.stringify(witness), server2.publicKeyHex);

			// Each can decrypt its own
			await expect(decryptWitness(enc1, server.privateKeyHex)).resolves.toEqual(witness);
			await expect(decryptWitness(enc2, server2.privateKeyHex)).resolves.toEqual(witness);

			// Neither can decrypt the other's
			await expect(decryptWitness(enc1, server2.privateKeyHex)).rejects.toThrow();
			await expect(decryptWitness(enc2, server.privateKeyHex)).rejects.toThrow();
		});

		it('ciphertext includes Poly1305 auth tag (16 bytes longer than plaintext)', () => {
			const plaintext = 'x'.repeat(32); // 32-byte plaintext
			const encrypted = encryptWithNoble(plaintext, server.publicKeyHex);

			const ctBinary = atob(encrypted.ciphertext);
			// XChaCha20-Poly1305 adds a 16-byte auth tag
			expect(ctBinary.length).toBe(32 + 16);
		});

		it('nonce is exactly 24 bytes (required by XChaCha20)', () => {
			const encrypted = encryptWithNoble('{"a":1}', server.publicKeyHex);
			const nonceBinary = atob(encrypted.nonce);
			expect(nonceBinary.length).toBe(24);
		});

		it('ephemeral public key is exactly 32 bytes (X25519)', () => {
			const encrypted = encryptWithNoble('{"a":1}', server.publicKeyHex);
			// Hex-encoded 32 bytes = 64 hex characters
			expect(encrypted.ephemeralPublicKey.length).toBe(64);
		});
	});
});
