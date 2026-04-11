/**
 * Org-level PII encryption — passphrase-derived, multi-admin, device-independent.
 *
 * Key derivation:
 *   PBKDF2(passphrase, salt=orgId, iterations=600_000, hash=SHA-256) → 256-bit stretched
 *   HKDF(stretched, salt="commons-org-pii-v1", info=orgId) → AES-256-GCM key
 *
 * Domain separation from other keys:
 *   Credentials:   salt="commons-credential-v2"  (credential-encryption.ts)
 *   Org PII:       salt="commons-org-pii-v1"     (this file)
 *   Person email/name: plaintext (no longer encrypted)
 */

import { wordlist } from './bip39-english';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ORG_PII_HKDF_SALT = encoder.encode('commons-org-pii-v1');
const ORG_KEY_CACHE_SALT = encoder.encode('commons-org-key-cache-v1');
const KEY_CHECK_SENTINEL = 'commons-org-key-check-v1';
const PBKDF2_ITERATIONS = 600_000;

export interface OrgEncryptedPii {
	ciphertext: string; // base64
	iv: string; // base64
	v: 'org-1'; // version tag
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Derive an org-level AES-256-GCM key from a passphrase.
 * PBKDF2 stretches the passphrase, then HKDF domain-separates for org PII.
 */
export async function deriveOrgKey(passphrase: string, orgId: string): Promise<CryptoKey> {
	// Step 1: PBKDF2 stretch
	const passphraseKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(passphrase),
		'PBKDF2',
		false,
		['deriveBits']
	);

	const stretched = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: encoder.encode(orgId),
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256'
		},
		passphraseKey,
		256
	);

	// Step 2: HKDF domain separation
	const hkdfKey = await crypto.subtle.importKey('raw', stretched, 'HKDF', false, ['deriveKey']);

	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: ORG_PII_HKDF_SALT,
			info: encoder.encode(orgId)
		},
		hkdfKey,
		{ name: 'AES-GCM', length: 256 },
		true, // extractable — needed for wrapping/export
		['encrypt', 'decrypt']
	);
}

/**
 * Encrypt a PII field with the org key.
 * AES-256-GCM with AAD binding to entity + field.
 */
export async function encryptWithOrgKey(
	plaintext: string,
	orgKey: CryptoKey,
	entityId: string,
	fieldName: string
): Promise<OrgEncryptedPii> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const aad = encoder.encode(`${entityId}:${fieldName}`);

	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: aad },
		orgKey,
		encoder.encode(plaintext)
	);

	return {
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
		iv: bytesToBase64(iv),
		v: 'org-1'
	};
}

/**
 * Decrypt a PII field with the org key.
 */
export async function decryptWithOrgKey(
	encrypted: OrgEncryptedPii,
	orgKey: CryptoKey,
	entityId: string,
	fieldName: string
): Promise<string> {
	const ciphertext = base64ToBytes(encrypted.ciphertext);
	const iv = base64ToBytes(encrypted.iv);
	const aad = encoder.encode(`${entityId}:${fieldName}`);

	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv, additionalData: aad },
		orgKey,
		ciphertext
	);

	return decoder.decode(plaintext);
}

/**
 * Create a verifier blob that can later confirm a passphrase is correct.
 * Encrypts a known sentinel with the org key.
 */
export async function createKeyVerifier(orgKey: CryptoKey): Promise<string> {
	const blob = await encryptWithOrgKey(KEY_CHECK_SENTINEL, orgKey, 'verifier', 'sentinel');
	return JSON.stringify(blob);
}

/**
 * Verify that an org key matches the stored verifier.
 * Returns false on any error (wrong passphrase, corrupt data).
 */
export async function verifyOrgKey(orgKey: CryptoKey, verifier: string): Promise<boolean> {
	try {
		const encrypted: OrgEncryptedPii = JSON.parse(verifier);
		const plaintext = await decryptWithOrgKey(encrypted, orgKey, 'verifier', 'sentinel');
		return plaintext === KEY_CHECK_SENTINEL;
	} catch {
		return false;
	}
}

/**
 * Generate a 256-bit recovery key with BIP39-compliant 24-word mnemonic.
 * Includes SHA-256 checksum (first 8 bits) for typo detection.
 */
export async function generateRecoveryKey(): Promise<{ key: Uint8Array; words: string[] }> {
	const key = crypto.getRandomValues(new Uint8Array(32));

	// BIP39: 256 bits entropy + 8 bits checksum (SHA-256) = 264 bits = 24 × 11-bit words
	const hash = await crypto.subtle.digest('SHA-256', key);
	const checksum = new Uint8Array(hash)[0]; // first 8 bits of SHA-256(entropy)

	let bits = '';
	for (const byte of key) {
		bits += byte.toString(2).padStart(8, '0');
	}
	bits += checksum.toString(2).padStart(8, '0');

	const words: string[] = [];
	for (let i = 0; i < 24; i++) {
		const index = parseInt(bits.slice(i * 11, (i + 1) * 11), 2);
		words.push(wordlist[index]);
	}

	return { key, words };
}

/**
 * Convert a 24-word mnemonic back to a 256-bit recovery key.
 * Validates BIP39 checksum to detect transcription errors.
 */
export async function mnemonicToRecoveryKey(words: string[]): Promise<Uint8Array> {
	if (words.length !== 24) throw new Error('Recovery mnemonic must be 24 words');

	let bits = '';
	for (const word of words) {
		const idx = wordlist.indexOf(word.toLowerCase().trim());
		if (idx === -1) throw new Error(`Invalid recovery word: "${word}"`);
		bits += idx.toString(2).padStart(11, '0');
	}

	// First 256 bits = entropy, last 8 bits = checksum
	const key = new Uint8Array(32);
	for (let i = 0; i < 32; i++) {
		key[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
	}

	// Verify checksum
	const providedChecksum = parseInt(bits.slice(256, 264), 2);
	const hash = await crypto.subtle.digest('SHA-256', key);
	const expectedChecksum = new Uint8Array(hash)[0];
	if (providedChecksum !== expectedChecksum) {
		throw new Error('Invalid recovery mnemonic — checksum failed. Check for typos.');
	}

	return key;
}

/**
 * Wrap an org key for recovery: encrypt raw key bytes with AES-256-GCM
 * using the recovery key as key material.
 */
export async function wrapOrgKeyForRecovery(
	orgKey: CryptoKey,
	recoveryKey: Uint8Array
): Promise<string> {
	const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', orgKey));

	const wrappingKey = await crypto.subtle.importKey(
		'raw',
		recoveryKey,
		{ name: 'AES-GCM' },
		false,
		['encrypt']
	);

	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, rawKey);

	return JSON.stringify({
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
		iv: bytesToBase64(iv)
	});
}

/**
 * Unwrap an org key from a recovery key.
 */
export async function unwrapOrgKeyFromRecovery(
	wrapped: string,
	recoveryKey: Uint8Array
): Promise<CryptoKey> {
	const { ciphertext, iv } = JSON.parse(wrapped);

	const wrappingKey = await crypto.subtle.importKey(
		'raw',
		recoveryKey,
		{ name: 'AES-GCM' },
		false,
		['decrypt']
	);

	const rawKey = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: base64ToBytes(iv) },
		wrappingKey,
		base64ToBytes(ciphertext)
	);

	return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, true, [
		'encrypt',
		'decrypt'
	]);
}

/**
 * Wrap an org key for device-local caching.
 * Uses HKDF to derive a wrapping key from device master bytes.
 */
export async function wrapOrgKeyForDevice(
	orgKey: CryptoKey,
	deviceMasterBytes: ArrayBuffer
): Promise<string> {
	const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', orgKey));

	const masterBytes = new Uint8Array(deviceMasterBytes);
	const hkdfKey = await crypto.subtle.importKey('raw', masterBytes, 'HKDF', false, [
		'deriveKey'
	]);

	const wrappingKey = await crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: ORG_KEY_CACHE_SALT,
			info: new Uint8Array(0)
		},
		hkdfKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt']
	);

	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, rawKey);

	return JSON.stringify({
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
		iv: bytesToBase64(iv)
	});
}

/**
 * Unwrap an org key from device-local cache.
 */
export async function unwrapOrgKeyFromDevice(
	wrapped: string,
	deviceMasterBytes: ArrayBuffer
): Promise<CryptoKey> {
	const { ciphertext, iv } = JSON.parse(wrapped);

	const masterBytes = new Uint8Array(deviceMasterBytes);
	const hkdfKey = await crypto.subtle.importKey('raw', masterBytes, 'HKDF', false, [
		'deriveKey'
	]);

	const wrappingKey = await crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: ORG_KEY_CACHE_SALT,
			info: new Uint8Array(0)
		},
		hkdfKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['decrypt']
	);

	const rawKey = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: base64ToBytes(iv) },
		wrappingKey,
		base64ToBytes(ciphertext)
	);

	return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, true, [
		'encrypt',
		'decrypt'
	]);
}
