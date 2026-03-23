/**
 * User PII Encryption at Rest (C-3)
 *
 * Encrypts email and name before storing in Postgres.
 * Uses Web Crypto API (CF Workers compatible) — AES-256-GCM with HKDF-derived per-user keys.
 *
 * Key derivation: HKDF(PII_ENCRYPTION_KEY, userId, "commons-pii-encryption-v1")
 * Email lookup:   HMAC-SHA256(normalize(email), EMAIL_LOOKUP_KEY)
 *
 * Same pattern as oauth-token-encryption.ts but scoped to User PII.
 */

/** Encrypted PII field stored as JSON string in the database */
export interface EncryptedPii {
	ciphertext: string; // base64
	iv: string; // base64
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let _warnedPiiKey = false;
let _warnedEmailKey = false;

// =============================================================================
// ENV KEY ACCESS
// =============================================================================

function getPiiEncryptionKey(): string | null {
	try {
		return process.env.PII_ENCRYPTION_KEY || null;
	} catch {
		return null;
	}
}

function getEmailLookupKey(): string | null {
	try {
		return process.env.EMAIL_LOOKUP_KEY || null;
	} catch {
		return null;
	}
}

// =============================================================================
// EMAIL HASH (deterministic — same email = same hash for lookups)
// =============================================================================

/**
 * Normalize email for consistent hashing: trim + lowercase.
 */
function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Compute a deterministic email hash for database lookups.
 * HMAC-SHA256(normalize(email), EMAIL_LOOKUP_KEY)
 *
 * Returns null if EMAIL_LOOKUP_KEY is not configured (dev environments).
 */
export async function computeEmailHash(email: string): Promise<string | null> {
	const keyHex = getEmailLookupKey();
	if (!keyHex) {
		if (!_warnedEmailKey) {
			console.warn(
				'[PII] EMAIL_LOOKUP_KEY not set — email_hash not computed. ' +
					'Generate with: openssl rand -hex 32'
			);
			_warnedEmailKey = true;
		}
		return null;
	}

	const keyBytes = hexToBytes(keyHex);
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		keyBytes as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);

	const normalized = normalizeEmail(email);
	const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(normalized));
	return bytesToHex(new Uint8Array(sig));
}

// =============================================================================
// PII ENCRYPTION (per-user key — different users, different ciphertexts)
// =============================================================================

/**
 * Import the master PII key from hex string for HKDF derivation.
 */
async function importPiiMasterKey(hexKey: string): Promise<CryptoKey> {
	const keyBytes = hexToBytes(hexKey);
	if (keyBytes.length !== 32) {
		throw new Error('PII_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
	}
	return crypto.subtle.importKey('raw', keyBytes as BufferSource, 'HKDF', false, ['deriveKey']);
}

/**
 * Derive a per-user AES-256-GCM key using HKDF.
 * info = userId (binds key to specific user)
 * salt = "commons-pii-encryption-v1" (domain separation)
 */
async function derivePiiKey(masterKey: CryptoKey, userId: string): Promise<CryptoKey> {
	const info = encoder.encode(userId);
	const salt = encoder.encode('commons-pii-encryption-v1');

	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt, info },
		masterKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

/**
 * Encrypt a PII field (email or name) for database storage.
 *
 * @param plaintext - The raw PII string
 * @param userId - User ID for per-user key derivation
 * @returns Encrypted PII object, or null if encryption unavailable
 */
export async function encryptPii(
	plaintext: string,
	userId: string
): Promise<EncryptedPii | null> {
	const masterKeyHex = getPiiEncryptionKey();
	if (!masterKeyHex) {
		if (!_warnedPiiKey) {
			console.warn(
				'[PII] PII_ENCRYPTION_KEY not set — PII stored in plaintext. ' +
					'Generate with: openssl rand -hex 32'
			);
			_warnedPiiKey = true;
		}
		return null;
	}

	const masterKey = await importPiiMasterKey(masterKeyHex);
	const userKey = await derivePiiKey(masterKey, userId);

	const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
	const ciphertextBuf = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		userKey,
		encoder.encode(plaintext)
	);

	return {
		ciphertext: bytesToBase64(new Uint8Array(ciphertextBuf)),
		iv: bytesToBase64(iv)
	};
}

/**
 * Decrypt a PII field from database storage.
 *
 * @param encrypted - The encrypted PII object (ciphertext + IV)
 * @param userId - User ID for per-user key derivation
 * @returns Decrypted plaintext string
 */
export async function decryptPii(encrypted: EncryptedPii, userId: string): Promise<string> {
	const masterKeyHex = getPiiEncryptionKey();
	if (!masterKeyHex) {
		throw new Error(
			'PII_ENCRYPTION_KEY not set — cannot decrypt PII. ' +
				'Set the same key that was used to encrypt.'
		);
	}

	const masterKey = await importPiiMasterKey(masterKeyHex);
	const userKey = await derivePiiKey(masterKey, userId);

	const ciphertext = base64ToBytes(encrypted.ciphertext);
	const iv = base64ToBytes(encrypted.iv);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS lib mismatch: Uint8Array<ArrayBufferLike> vs BufferSource
	const plaintextBuf = await (crypto.subtle.decrypt as any)({ name: 'AES-GCM', iv }, userKey, ciphertext);
	return decoder.decode(plaintextBuf);
}

/**
 * Try to decrypt a PII field, returning null on failure (wrong key, corrupted data).
 * Used during transition when some rows may have stale or invalid encrypted data.
 */
export async function tryDecryptPii(
	encrypted: EncryptedPii | null | undefined,
	userId: string
): Promise<string | null> {
	if (!encrypted?.ciphertext || !encrypted?.iv) return null;
	try {
		return await decryptPii(encrypted, userId);
	} catch {
		return null;
	}
}

// =============================================================================
// CONVENIENCE: Encrypt all User PII fields at once
// =============================================================================

export interface UserPiiEncrypted {
	encrypted_email: string | null; // JSON string of EncryptedPii, or null if encryption unavailable
	encrypted_name: string | null; // JSON string of EncryptedPii, or null
	email_hash: string | null; // HMAC hex, or null if key unavailable
}

/**
 * Encrypt user PII fields for database storage.
 * Returns JSON-serialized encrypted values ready for Prisma.
 */
export async function encryptUserPii(
	email: string,
	name: string | null,
	userId: string
): Promise<UserPiiEncrypted> {
	const [encEmail, encName, emailHash] = await Promise.all([
		encryptPii(email, userId),
		name ? encryptPii(name, userId) : Promise.resolve(null),
		computeEmailHash(email)
	]);

	return {
		encrypted_email: encEmail ? JSON.stringify(encEmail) : null,
		encrypted_name: encName ? JSON.stringify(encName) : null,
		email_hash: emailHash
	};
}

/**
 * Decrypt user PII from database row.
 * Post-backfill: encrypted columns are authoritative — no plaintext fallback.
 */
export async function decryptUserPii(
	user: {
		id: string;
		encrypted_email?: string | null;
		encrypted_name?: string | null;
	}
): Promise<{ email: string; name: string | null }> {
	if (!user.encrypted_email) {
		// Pre-backfill user: read plaintext from DB (column still exists, just not in schema)
		const { db } = await import('$lib/core/db');
		const rows = await (db as unknown as { $queryRaw: (sql: TemplateStringsArray, ...values: unknown[]) => Promise<{ email: string; name: string | null }[]> })
			.$queryRaw`SELECT email, name FROM "user" WHERE id = ${user.id} LIMIT 1`;
		if (rows[0]) {
			return { email: rows[0].email, name: rows[0].name };
		}
		throw new Error(`[PII] User ${user.id} missing encrypted_email and plaintext fallback`);
	}

	const encEmail: EncryptedPii = JSON.parse(user.encrypted_email);
	const decryptedEmail = await decryptPii(encEmail, user.id);

	let decryptedName: string | null = null;
	if (user.encrypted_name) {
		const encName: EncryptedPii = JSON.parse(user.encrypted_name);
		decryptedName = await decryptPii(encName, user.id);
	}

	return { email: decryptedEmail, name: decryptedName };
}

// =============================================================================
// CONVENIENCE: Decrypt supporter email (info string = "supporter:{id}")
// =============================================================================

/**
 * Decrypt a supporter's encrypted email.
 * Post-backfill: encrypted_email is authoritative — no plaintext fallback.
 * Info string for supporter encryption is "supporter:{supporterId}".
 */
export async function tryDecryptSupporterEmail(supporter: {
	id: string;
	encrypted_email?: string | null;
}): Promise<string> {
	if (!supporter.encrypted_email) {
		throw new Error(`[PII] Supporter ${supporter.id} missing encrypted_email — backfill incomplete`);
	}

	const enc: EncryptedPii = JSON.parse(supporter.encrypted_email);
	return await decryptPii(enc, 'supporter:' + supporter.id);
}

// =============================================================================
// BYTE UTILITIES (no Node.js Buffer — CF Workers compatible)
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

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
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
