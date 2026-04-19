/**
 * Witness Encryption Round-Trip Tests
 *
 * Validates that the encrypt (client) -> decrypt (server) pipeline works correctly.
 *
 * Client encrypts with libsodium (browser WASM), server decrypts with @noble (pure JS).
 * Wire format: X25519 ECDH -> BLAKE2b KDF -> XChaCha20-Poly1305
 *
 * This test uses @noble libraries to simulate the client-side encryption,
 * then calls the REAL decryptWitness() server function to verify decryption.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { x25519 } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2b';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils';
import { decryptWitness, type EncryptedWitnessPayload } from '$lib/server/witness-decryption';

// ── Encoding helpers ──────────────────────────────────────────────────

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

// ── Test encryption helper (simulates client-side libsodium) ─────────

function encryptWithNoble(
	plaintext: string,
	serverPublicKeyHex: string
): EncryptedWitnessPayload {
	// 1. Generate ephemeral X25519 keypair
	const ephemeralPrivate = x25519.utils.randomPrivateKey();
	const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);

	// 2. ECDH: derive shared secret
	const serverPubBytes = hexToBytes(serverPublicKeyHex);
	const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, serverPubBytes);

	// 3. KDF: BLAKE2b with key = 'commons-witness-encryption-v1'
	const encryptionKey = blake2b(sharedSecret, {
		dkLen: 32,
		key: new TextEncoder().encode('commons-witness-encryption-v1')
	});

	// 4. Random 24-byte nonce for XChaCha20
	const nonce = randomBytes(24);

	// 5. Encrypt with XChaCha20-Poly1305
	const cipher = xchacha20poly1305(encryptionKey, nonce);
	const ct = cipher.encrypt(new TextEncoder().encode(plaintext));

	// 6. Encode for wire format
	return {
		ciphertext: bytesToBase64(ct),
		nonce: bytesToBase64(nonce),
		ephemeralPublicKey: bytesToHex(ephemeralPublic)
	};
}

// ── Server keypair generation for tests ──────────────────────────────

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

// ── Tests ────────────────────────────────────────────────────────────

describe('Witness Encryption Round-Trip', () => {
	const server = generateServerKeypair();

	it('encrypts and decrypts a JSON witness object', async () => {
		const witnessData = {
			action: 'template_send',
			templateId: 'tmpl_abc123',
			recipientCount: 42,
			timestamp: '2026-02-18T12:00:00Z'
		};

		const encrypted = encryptWithNoble(JSON.stringify(witnessData), server.publicKeyHex);
		const decrypted = await decryptWitness(encrypted, server.privateKeyHex);

		expect(decrypted).toEqual(witnessData);
	});

	it('fails decryption with wrong server private key', async () => {
		const witnessData = { action: 'vote', proposalId: 'prop_001' };
		const encrypted = encryptWithNoble(JSON.stringify(witnessData), server.publicKeyHex);

		// Generate a completely different server keypair
		const wrongServer = generateServerKeypair();

		await expect(decryptWitness(encrypted, wrongServer.privateKeyHex)).rejects.toThrow();
	});

	it('fails decryption when ciphertext is tampered', async () => {
		const witnessData = { action: 'attest', claimId: 'claim_xyz' };
		const encrypted = encryptWithNoble(JSON.stringify(witnessData), server.publicKeyHex);

		// Decode, flip a byte, re-encode
		const ctBinary = atob(encrypted.ciphertext);
		const ctBytes = new Uint8Array(ctBinary.length);
		for (let i = 0; i < ctBinary.length; i++) {
			ctBytes[i] = ctBinary.charCodeAt(i);
		}
		ctBytes[0] ^= 0xff; // Flip first byte
		const tampered = bytesToBase64(ctBytes);

		await expect(
			decryptWitness(
				{ ...encrypted, ciphertext: tampered },
				server.privateKeyHex
			)
		).rejects.toThrow();
	});

	it('produces unique ciphertexts for the same plaintext', () => {
		const plaintext = JSON.stringify({ action: 'send', id: 'same_data' });

		const encrypted1 = encryptWithNoble(plaintext, server.publicKeyHex);
		const encrypted2 = encryptWithNoble(plaintext, server.publicKeyHex);

		// Different ephemeral keys and nonces must produce different ciphertexts
		expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
		expect(encrypted1.nonce).not.toBe(encrypted2.nonce);
		expect(encrypted1.ephemeralPublicKey).not.toBe(encrypted2.ephemeralPublicKey);
	});

	it('round-trips complex nested witness data', async () => {
		const complexWitness = {
			action: 'deliver_message',
			templateId: 'tmpl_complex_001',
			deliveryAddress: {
				street: '123 Main St',
				city: 'Springfield',
				state: 'IL',
				zip: '62701',
				coordinates: {
					lat: 39.7817,
					lng: -89.6501
				}
			},
			paths: [
				'/api/templates/send',
				'/api/proof/submit',
				'/api/witness/record'
			],
			metadata: {
				version: 2,
				flags: ['encrypted', 'witnessed', 'notarized'],
				timestamps: {
					created: '2026-02-18T10:00:00Z',
					signed: '2026-02-18T10:00:01Z',
					submitted: '2026-02-18T10:00:02Z'
				}
			},
			recipientIds: ['user_001', 'user_002', 'user_003'],
			contentHash: 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
			nullValue: null,
			booleanFlag: true,
			numericPrecision: 3.141592653589793
		};

		const encrypted = encryptWithNoble(JSON.stringify(complexWitness), server.publicKeyHex);
		const decrypted = await decryptWitness(encrypted, server.privateKeyHex);

		expect(decrypted).toEqual(complexWitness);
	});
});
