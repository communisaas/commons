/**
 * Bridge Session Encryption — AES-256-GCM + HKDF
 *
 * Encrypts sensitive bridge session fields before KV storage.
 * Key derivation: HKDF(masterKey, sessionId, "commons-bridge-session-v1")
 * Each session gets a unique derived key via HKDF info binding.
 *
 * Follows the same pattern as user-pii-encryption.ts.
 */

import { dev } from '$app/environment';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let _warnedKey = false;

// ---------- Types ----------

export interface SensitiveFields {
	secret: string;
	ephemeralPrivateKeyJwk: JsonWebKey;
	desktopUserLabel: string;
	requests: Array<{ protocol: string; data: unknown }>;
	nonce: string;
}

export interface EncryptedBlob {
	ciphertext: string; // base64
	iv: string; // base64
	version: number;
}

// ---------- Key access ----------

function getMasterKeyHex(): string | null {
	try {
		return process.env.BRIDGE_ENCRYPTION_KEY || process.env.PII_ENCRYPTION_KEY || null;
	} catch {
		return null;
	}
}

// ---------- Key derivation ----------

async function importMasterKey(hexKey: string): Promise<CryptoKey> {
	const keyBytes = hexToBytes(hexKey);
	if (keyBytes.length !== 32) {
		throw new Error('Bridge encryption key must be exactly 32 bytes (64 hex characters)');
	}
	return crypto.subtle.importKey('raw', keyBytes as BufferSource, 'HKDF', false, ['deriveKey']);
}

async function deriveSessionKey(masterKey: CryptoKey, sessionId: string): Promise<CryptoKey> {
	const salt = encoder.encode('commons-bridge-session-v1');
	const info = encoder.encode(sessionId);

	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt, info },
		masterKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

// ---------- Encrypt / Decrypt ----------

/**
 * Encrypt sensitive bridge session fields for KV storage.
 * Returns null in dev if no encryption key is configured.
 * Throws in production — bridge sessions must never be stored in plaintext.
 */
export async function encryptBridgeFields(
	sessionId: string,
	fields: SensitiveFields
): Promise<EncryptedBlob | null> {
	const masterKeyHex = getMasterKeyHex();
	if (!masterKeyHex) {
		if (dev) {
			if (!_warnedKey) {
				console.warn(
					'[bridge-crypto] No encryption key — bridge sessions stored in plaintext (dev only)'
				);
				_warnedKey = true;
			}
			return null;
		}
		throw new Error('[bridge-crypto] BRIDGE_ENCRYPTION_KEY required in production');
	}

	const masterKey = await importMasterKey(masterKeyHex);
	const sessionKey = await deriveSessionKey(masterKey, sessionId);

	const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
	const plaintext = encoder.encode(JSON.stringify(fields));
	const ciphertextBuf = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		sessionKey,
		plaintext
	);

	return {
		ciphertext: bytesToBase64(new Uint8Array(ciphertextBuf)),
		iv: bytesToBase64(iv),
		version: 1
	};
}

/**
 * Decrypt sensitive bridge session fields from KV storage.
 * Throws if decryption key is unavailable or ciphertext is invalid.
 */
export async function decryptBridgeFields(
	sessionId: string,
	blob: EncryptedBlob
): Promise<SensitiveFields> {
	const masterKeyHex = getMasterKeyHex();
	if (!masterKeyHex) {
		throw new Error(
			'[bridge-crypto] BRIDGE_ENCRYPTION_KEY / PII_ENCRYPTION_KEY not set — ' +
				'cannot decrypt bridge session. Set the same key used to encrypt.'
		);
	}

	const masterKey = await importMasterKey(masterKeyHex);
	const sessionKey = await deriveSessionKey(masterKey, sessionId);

	const ciphertext = base64ToBytes(blob.ciphertext);
	const iv = base64ToBytes(blob.iv);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS lib mismatch: Uint8Array<ArrayBufferLike> vs BufferSource
	const plaintextBuf = await (crypto.subtle.decrypt as any)(
		{ name: 'AES-GCM', iv },
		sessionKey,
		ciphertext
	);
	return JSON.parse(decoder.decode(plaintextBuf)) as SensitiveFields;
}

// ---------- Byte utilities (CF Workers compatible — no Node Buffer) ----------

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (clean.length % 2 !== 0) throw new Error('Invalid hex string: odd length');
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
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

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
