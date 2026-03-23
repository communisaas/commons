/**
 * OAuth Token Encryption at Rest
 *
 * Encrypts OAuth access_token, refresh_token, and id_token before storing in Postgres.
 * Uses Web Crypto API (CF Workers compatible) — AES-256-GCM with HKDF-derived per-account keys.
 *
 * Key derivation: HKDF(OAUTH_ENCRYPTION_KEY, provider + providerAccountId)
 * This ensures each provider+account pair gets a unique encryption key,
 * so compromising one account's ciphertext reveals nothing about another.
 */

/** Encrypted token stored as JSON in the database */
export interface EncryptedToken {
	ciphertext: string; // base64
	iv: string; // base64
}

/**
 * Import the master key from hex string into a CryptoKey for HKDF derivation.
 */
async function importMasterKey(hexKey: string): Promise<CryptoKey> {
	const keyBytes = hexToBytes(hexKey);
	if (keyBytes.length !== 32) {
		throw new Error('OAUTH_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
	}
	return crypto.subtle.importKey('raw', keyBytes as BufferSource, 'HKDF', false, ['deriveKey']);
}

/**
 * Derive a per-account AES-256-GCM key using HKDF.
 * The info parameter binds the key to a specific provider+account pair.
 */
async function deriveAccountKey(
	masterKey: CryptoKey,
	provider: string,
	providerAccountId: string
): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	const info = encoder.encode(`commons-oauth-token-v1:${provider}:${providerAccountId}`);
	const salt = encoder.encode('commons-oauth-encryption-v1');

	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt, info },
		masterKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

/**
 * Get the master encryption key from environment.
 * Returns null if not configured (graceful fallback for dev).
 */
function getMasterKeyHex(): string | null {
	// Try SvelteKit $env first (CF Workers), fall back to process.env (Node.js/tests)
	try {
		// Dynamic import not possible here — caller must pass env or we use process.env
		const key = process.env.OAUTH_ENCRYPTION_KEY;
		return key || null;
	} catch {
		return null;
	}
}

/**
 * Encrypt an OAuth token for database storage.
 *
 * @param plaintext - The raw token string
 * @param provider - OAuth provider name (e.g. 'google', 'twitter')
 * @param providerAccountId - Provider-specific account identifier
 * @returns Encrypted token object with ciphertext and IV (both base64), or null if encryption unavailable
 */
export async function encryptOAuthToken(
	plaintext: string,
	provider: string,
	providerAccountId: string
): Promise<EncryptedToken | null> {
	const masterKeyHex = getMasterKeyHex();
	if (!masterKeyHex) {
		console.warn(
			'[OAuth Encryption] OAUTH_ENCRYPTION_KEY not set — tokens stored in plaintext. ' +
				'Generate with: openssl rand -hex 32'
		);
		return null;
	}

	const masterKey = await importMasterKey(masterKeyHex);
	const accountKey = await deriveAccountKey(masterKey, provider, providerAccountId);

	const encoder = new TextEncoder();
	const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM

	const ciphertextBuf = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		accountKey,
		encoder.encode(plaintext)
	);

	return {
		ciphertext: bytesToBase64(new Uint8Array(ciphertextBuf)),
		iv: bytesToBase64(iv)
	};
}

/**
 * Decrypt an OAuth token from database storage.
 *
 * @param encrypted - The encrypted token object (ciphertext + IV)
 * @param provider - OAuth provider name
 * @param providerAccountId - Provider-specific account identifier
 * @returns Decrypted plaintext token
 */
export async function decryptOAuthToken(
	encrypted: EncryptedToken,
	provider: string,
	providerAccountId: string
): Promise<string> {
	const masterKeyHex = getMasterKeyHex();
	if (!masterKeyHex) {
		throw new Error(
			'OAUTH_ENCRYPTION_KEY not set — cannot decrypt token. ' +
				'Set the same key that was used to encrypt.'
		);
	}

	const masterKey = await importMasterKey(masterKeyHex);
	const accountKey = await deriveAccountKey(masterKey, provider, providerAccountId);

	const ciphertext = base64ToBytes(encrypted.ciphertext);
	const iv = base64ToBytes(encrypted.iv);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS lib mismatch: Uint8Array<ArrayBufferLike> vs BufferSource
	const plaintextBuf = await (crypto.subtle.decrypt as any)({ name: 'AES-GCM', iv }, accountKey, ciphertext);

	return new TextDecoder().decode(plaintextBuf);
}

// =============================================================================
// BYTE UTILITIES (no Node.js Buffer dependency — CF Workers compatible)
// =============================================================================

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
	// Use btoa which is available in both Node.js 16+ and CF Workers
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
