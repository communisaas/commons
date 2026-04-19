/**
 * Server-side Witness Decryption
 *
 * Mirrors client-side encryption (src/lib/core/proof/witness-encryption.ts).
 * Decrypts witness data encrypted to the server's X25519 public key.
 *
 * Crypto: X25519 ECDH -> BLAKE2b KDF -> XChaCha20-Poly1305
 *
 * Uses @noble libraries (pure JS, no WASM) for Cloudflare Workers compatibility.
 * Client-side encryption uses libsodium (browser WASM) — the wire format is identical.
 */

import { x25519 } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2b';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

export interface EncryptedWitnessPayload {
	/** Base64-encoded ciphertext */
	ciphertext: string;
	/** Base64-encoded nonce (24 bytes) */
	nonce: string;
	/** Hex-encoded ephemeral X25519 public key */
	ephemeralPublicKey: string;
}

/**
 * Decrypt witness data using server's X25519 private key.
 *
 * @param encrypted - Encrypted witness payload from client
 * @param privateKeyHex - Server's X25519 private key (hex-encoded, from env var)
 * @returns Parsed witness data (WitnessData shape, but typed as Record for flexibility)
 */
export async function decryptWitness(
	encrypted: EncryptedWitnessPayload,
	privateKeyHex?: string
): Promise<Record<string, unknown>> {
	// Get server private key from env or parameter
	const keyHex = privateKeyHex || process.env.WITNESS_ENCRYPTION_PRIVATE_KEY;
	if (!keyHex) {
		throw new Error('WITNESS_ENCRYPTION_PRIVATE_KEY not configured');
	}

	// Parse inputs
	const privateKey = hexToBytes(keyHex);
	const ephemeralPublicKey = hexToBytes(encrypted.ephemeralPublicKey);
	const ciphertext = base64ToBytes(encrypted.ciphertext);
	const nonce = base64ToBytes(encrypted.nonce);

	// Step 1: Derive shared secret via X25519 ECDH
	// Matches client: sodium.crypto_scalarmult(privateKey, publicKey)
	const sharedSecret = x25519.getSharedSecret(privateKey, ephemeralPublicKey);

	// Step 2: Derive encryption key via BLAKE2b
	// MUST use same context string as client
	// Matches client: sodium.crypto_generichash(32, sharedSecret, key)
	// libsodium's crypto_generichash with a key uses BLAKE2b with personalization
	// The third arg to sodium.crypto_generichash is a key, mapped to BLAKE2b's `key` option
	const encryptionKey = blake2b(sharedSecret, {
		dkLen: 32,
		// FROZEN: must match client-side domain in witness-encryption.ts
		key: new TextEncoder().encode('commons-witness-encryption-v1')
	});

	// Step 3: Decrypt with XChaCha20-Poly1305
	// Matches client: sodium.crypto_aead_xchacha20poly1305_ietf_encrypt
	const cipher = xchacha20poly1305(encryptionKey, nonce);
	const plaintext = cipher.decrypt(ciphertext);

	// Step 4: Parse JSON
	const witnessJson = new TextDecoder().decode(plaintext);
	return JSON.parse(witnessJson);
}

function hexToBytes(hex: string): Uint8Array {
	const cleanHex = hex.replace(/^0x/, '');
	const bytes = new Uint8Array(cleanHex.length / 2);
	for (let i = 0; i < cleanHex.length; i += 2) {
		bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
	}
	return bytes;
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
