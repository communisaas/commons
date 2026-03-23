/**
 * Security Utilities
 *
 * Privacy-preserving fraud detection and cryptographic utilities.
 */

import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// =============================================================================
// ENTROPY ENCRYPTION (BR6-001)
// =============================================================================

const GCM_IV_LENGTH = 12;
const GCM_AUTH_TAG_LENGTH = 16;
const AES_KEY_LENGTH = 32; // AES-256

/**
 * Get encryption key from environment.
 * @throws if ENTROPY_ENCRYPTION_KEY is not set or wrong length
 */
function getEntropyKey(): Buffer {
	const keyHex = process.env.ENTROPY_ENCRYPTION_KEY;
	if (!keyHex) {
		throw new Error(
			'ENTROPY_ENCRYPTION_KEY environment variable not configured. ' +
				'Generate with: openssl rand -hex 32'
		);
	}
	const key = Buffer.from(keyHex, 'hex');
	if (key.length !== AES_KEY_LENGTH) {
		throw new Error('ENTROPY_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
	}
	return key;
}

/**
 * Encrypt user entropy with AES-256-GCM before storing in DB.
 * Output format: base64(iv || ciphertext || authTag)
 *
 * @param plaintext - Raw entropy hex string (e.g. "0xabc...")
 * @returns Encrypted string safe for DB storage
 */
export function encryptEntropy(plaintext: string): string {
	const key = getEntropyKey();
	const iv = randomBytes(GCM_IV_LENGTH);
	const cipher = createCipheriv('aes-256-gcm', key, iv);

	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();

	return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

/**
 * Decrypt user entropy from DB storage.
 * Handles legacy plaintext values (0x-prefixed hex) transparently.
 *
 * @param stored - Encrypted base64 string or legacy plaintext
 * @returns Raw entropy hex string
 */
export function decryptEntropy(stored: string): string {
	// Legacy detection: plaintext values are 0x-prefixed hex
	if (stored.startsWith('0x') && /^0x[0-9a-f]+$/i.test(stored)) {
		console.warn(
			'[Security] Legacy plaintext entropy detected — will be re-encrypted on next write'
		);
		return stored;
	}

	const key = getEntropyKey();
	const data = Buffer.from(stored, 'base64');

	if (data.length < GCM_IV_LENGTH + GCM_AUTH_TAG_LENGTH) {
		throw new Error('Invalid encrypted entropy: too short');
	}

	const iv = data.subarray(0, GCM_IV_LENGTH);
	const authTag = data.subarray(data.length - GCM_AUTH_TAG_LENGTH);
	const ciphertext = data.subarray(GCM_IV_LENGTH, data.length - GCM_AUTH_TAG_LENGTH);

	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(authTag);

	return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

// =============================================================================
// IP HASHING (DAILY SALT ROTATION VIA HKDF)
// =============================================================================

// Static fallback salt for dev/test environments where IP_HASH_SALT is not configured.
// NOT cryptographically meaningful — exists solely to keep dev environments functional.
const DEV_FALLBACK_SALT = 'commons-dev-ip-hash-fallback-not-for-production';

/**
 * Derive a daily HMAC key from the master salt using HKDF.
 *
 * Salt lifecycle:
 * - IP_HASH_SALT is a long-lived secret (set once in production, never rotated)
 * - The daily date string is used as HKDF info, producing a unique derived key per day
 * - This prevents cross-day IP correlation: the same IP hashes to a different value each day
 * - Within a single day, the same IP always produces the same hash (needed for rate limiting)
 *
 * Why daily rotation is safe for rate limiting:
 * Rate limit windows are at most 24 hours. When the salt rotates at midnight UTC,
 * any in-flight rate limit windows using the old salt will naturally expire within
 * their configured windowMs. The worst case is a brief reset of rate limit counters
 * at midnight, which is acceptable.
 */
function deriveDailySalt(masterSalt: string, dateStr: string): Buffer {
	const key = Buffer.from(masterSalt, 'utf8');
	const info = Buffer.from(`commons-ip-hash-v1:${dateStr}`, 'utf8');
	const salt = Buffer.from('commons-ip-daily-rotation', 'utf8');

	// HKDF-Extract: PRK = HMAC-SHA256(salt, IKM)
	const prk = createHmac('sha256', salt).update(key).digest();

	// HKDF-Expand: OKM = HMAC-SHA256(PRK, info || 0x01) — single block (32 bytes)
	return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([0x01])])).digest();
}

// Warning dedup flag (module-scoped, resets on isolate recycle)
let _warnedFallback = false;

/**
 * Hash IP address with daily-rotated HKDF salt (privacy-preserving fraud detection).
 *
 * @param ipAddress - Client IP address
 * @param dateOverride - Override date string for testing (YYYY-MM-DD format)
 * @returns SHA-256 HMAC hash (64-character hex)
 */
export function hashIPAddress(ipAddress: string, dateOverride?: string): string {
	const masterSalt = process.env.IP_HASH_SALT;

	if (!masterSalt) {
		if (process.env.NODE_ENV === 'production') {
			throw new Error(
				'IP_HASH_SALT environment variable not configured. ' +
					'Generate with: openssl rand -hex 32'
			);
		}
		// Dev/test fallback — log once per process
		if (!_warnedFallback) {
			console.warn('[Security] IP_HASH_SALT not set — using dev fallback (not for production)');
			_warnedFallback = true;
		}
	}

	const effectiveSalt = masterSalt || DEV_FALLBACK_SALT;
	const today = dateOverride || new Date().toISOString().split('T')[0]; // YYYY-MM-DD
	const dailyKey = deriveDailySalt(effectiveSalt, today);

	return createHmac('sha256', dailyKey).update(ipAddress).digest('hex');
}

/**
 * Generate cryptographic nonce (for session challenges)
 * @returns 32-character hex string (128 bits of entropy)
 */
export function generateNonce(): string {
	// Use crypto.randomBytes for cryptographically secure randomness
	return randomBytes(16).toString('hex'); // 16 bytes = 128 bits = 32 hex chars
}

/**
 * Generate verification session challenge (QR code data)
 * @returns Unique challenge string
 */
export function generateChallenge(): string {
	return randomBytes(32).toString('hex'); // 64-character hex string
}

/**
 * Validate that a timestamp is within acceptable window
 * @param timestamp - ISO timestamp string
 * @param maxAgeMs - Maximum age in milliseconds (default: 5 minutes)
 * @returns true if timestamp is fresh, false if expired
 */
export function isTimestampFresh(timestamp: string, maxAgeMs: number = 5 * 60 * 1000): boolean {
	const timestampDate = new Date(timestamp);
	const now = new Date();
	const ageMs = now.getTime() - timestampDate.getTime();

	return ageMs >= 0 && ageMs <= maxAgeMs;
}

// =============================================================================
// SAFE USER ID FOR LOGGING (A-4)
// =============================================================================

/**
 * Return an audit-safe user identifier for log output.
 *
 * Raw user IDs (CUIDs) are linkable PII in CF Workers tail/log forwarding.
 * This function returns a truncated HMAC so logs remain useful for debugging
 * without leaking the actual userId.
 *
 * @param userId - Raw user ID (CUID)
 * @returns 16-character hex prefix of HMAC-SHA256(userId)
 */
export function safeUserId(userId: string): string {
	return createHash('sha256').update('log-pseudonym:' + userId).digest('hex').slice(0, 16);
}

/**
 * Sanitize SDK response metadata (remove PII before storing)
 * @param metadata - Raw SDK response
 * @returns Sanitized metadata safe for audit logging
 */
export function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
	// Allowlist of safe fields (no PII)
	const safeFields = [
		'sdk_version',
		'verification_method',
		'timestamp',
		'success',
		'error_code',
		'challenge_id'
	];

	const sanitized: Record<string, unknown> = {};

	for (const field of safeFields) {
		if (field in metadata) {
			sanitized[field] = metadata[field];
		}
	}

	return sanitized;
}
