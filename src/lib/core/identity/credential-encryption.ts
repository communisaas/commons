/**
 * Credential Encryption Service (v2 — Per-User HKDF Isolation)
 *
 * Uses Web Crypto API to encrypt session credentials before IndexedDB storage.
 *
 * v2 changes (multi-user device isolation):
 * - Device master key is now raw 256-bit entropy stored in IndexedDB
 * - Per-user AES-256-GCM keys derived via HKDF(masterKey, userId)
 * - Record IDs are HMAC(userId, masterKey) — User B cannot enumerate User A's records
 * - Derived keys are held in-memory only, discarded on logout
 * - Legacy v1 device key (AES-GCM CryptoKey) retained for migration decryption
 *
 * Security model:
 * - Same-origin scripts with full DOM access can still invoke decrypt()
 * - Protects against: devtools inspection, cross-site exfiltration, non-privileged extensions
 * - NEW: Cross-user isolation on shared devices (library, family laptop)
 *
 * @module credential-encryption
 */

// ============================================================================
// Constants
// ============================================================================

const KEY_DB_NAME = 'commons-keystore';
const KEY_STORE_NAME = 'encryption-keys';
const DEVICE_KEY_ID = 'device-credential-key';
const DERIVATION_KEY_ID = 'device-derivation-key-v2';

// FROZEN: changing this salt would break decryption of all existing encrypted credentials
const HKDF_SALT = new TextEncoder().encode('commons-credential-v2');

/** Current encryption version for migration support */
const ENCRYPTION_VERSION = 2;

// ============================================================================
// Types
// ============================================================================

/**
 * Encrypted credential wrapper
 */
export interface EncryptedCredential {
	/** Base64-encoded ciphertext */
	ciphertext: string;
	/** Base64-encoded IV (initialization vector) */
	iv: string;
	/** Encryption version for future migrations */
	version: number;
}

/**
 * Stored credential wrapper (may be encrypted or plaintext for migration)
 */
export interface StoredCredentialWrapper<T> {
	/** Original credential data (for backward compatibility detection) */
	data?: T;
	/** Encrypted credential (when encryption is used) */
	encrypted?: EncryptedCredential;
	/** Expiration timestamp (kept unencrypted for index queries) */
	expiresAt?: Date | string;
}

// ============================================================================
// Database Management
// ============================================================================

/** Cached database connection */
let keyDBInstance: IDBDatabase | null = null;

/**
 * Open the key storage database
 *
 * Uses a separate database from credential storage for security isolation.
 */
async function openKeyDB(): Promise<IDBDatabase> {
	if (keyDBInstance) {
		return keyDBInstance;
	}

	return new Promise((resolve, reject) => {
		const request = indexedDB.open(KEY_DB_NAME, 1);

		request.onerror = () => {
			console.error('[CredentialEncryption] Failed to open key database:', request.error);
			reject(request.error);
		};

		request.onsuccess = () => {
			keyDBInstance = request.result;

			keyDBInstance.onclose = () => {
				keyDBInstance = null;
			};

			resolve(keyDBInstance);
		};

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
				db.createObjectStore(KEY_STORE_NAME, { keyPath: 'id' });
				console.debug('[CredentialEncryption] Key store created');
			}
		};
	});
}

// ============================================================================
// Key Management — v2 (Per-User HKDF)
// ============================================================================

/** Cached master key bytes */
let cachedMasterBytes: ArrayBuffer | null = null;

/** Serialization lock — prevents concurrent callers from generating duplicate master keys */
let masterKeyPromise: Promise<ArrayBuffer> | null = null;

/** Cached per-user derived keys: Map<recordId, CryptoKey> */
const derivedKeyCache = new Map<string, CryptoKey>();

/**
 * Get or create the device master key material (256-bit random bytes).
 *
 * Stored as raw bytes in IndexedDB. Unlike v1's CryptoKey, raw bytes can be
 * imported as HKDF key material for per-user derivation.
 */
export async function getOrCreateMasterBytes(): Promise<ArrayBuffer> {
	if (cachedMasterBytes) {
		return cachedMasterBytes;
	}

	// Serialize concurrent callers to prevent duplicate key generation.
	// storeSessionCredential calls Promise.all([encryptCredential(identity), encryptCredential(treeState)])
	// — both call getOrCreateMasterBytes() concurrently on first load. Without this lock,
	// both see cachedMasterBytes=null, both generate random bytes, second put() wins,
	// and the first encryption becomes undecryptable.
	if (!masterKeyPromise) {
		masterKeyPromise = (async () => {
			try {
				const db = await openKeyDB();

				// Try to get existing derivation key
				const existing = await new Promise<ArrayBuffer | null>((resolve, reject) => {
					const tx = db.transaction(KEY_STORE_NAME, 'readonly');
					const store = tx.objectStore(KEY_STORE_NAME);
					const request = store.get(DERIVATION_KEY_ID);

					request.onerror = () => reject(request.error);
					request.onsuccess = () => {
						const result = request.result;
						resolve(result?.rawBytes ?? null);
					};
				});

				if (existing) {
					cachedMasterBytes = existing;
					console.debug('[CredentialEncryption] Retrieved existing derivation master key');
					return existing;
				}

				// Generate 256-bit random master key material
				const rawBytes = crypto.getRandomValues(new Uint8Array(32)).buffer;

				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
					const store = tx.objectStore(KEY_STORE_NAME);
					const request = store.put({
						id: DERIVATION_KEY_ID,
						rawBytes,
						createdAt: new Date().toISOString()
					});

					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve();
				});

				cachedMasterBytes = rawBytes;
				console.debug('[CredentialEncryption] Created new derivation master key');
				return rawBytes;
			} finally {
				masterKeyPromise = null;
			}
		})();
	}

	return masterKeyPromise;
}

/**
 * Derive a per-user AES-256-GCM key via HKDF.
 *
 * HKDF(SHA-256, masterKey, salt="commons-credential-v2", info=userId) -> AES-256-GCM
 *
 * The derived key is:
 * - Deterministic: same master + same userId = same key (survives page reload)
 * - Non-extractable: cannot be exported from Web Crypto
 * - In-memory only: discarded on logout/page close, re-derived on next login
 */
async function deriveUserKey(userId: string): Promise<CryptoKey> {
	const masterBytes = await getOrCreateMasterBytes();

	// Import master bytes as HKDF base key
	const hkdfKey = await crypto.subtle.importKey(
		'raw',
		masterBytes,
		{ name: 'HKDF' },
		false,
		['deriveKey']
	);

	// Derive per-user AES-256-GCM key
	const info = new TextEncoder().encode(userId);
	const derivedKey = await crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: HKDF_SALT,
			info
		},
		hkdfKey,
		{ name: 'AES-GCM', length: 256 },
		false, // non-extractable
		['encrypt', 'decrypt']
	);

	return derivedKey;
}

/**
 * Get (or derive + cache) the per-user encryption key.
 *
 * @param userId - The authenticated user's ID
 * @returns Per-user AES-256-GCM CryptoKey
 */
async function getUserKey(userId: string): Promise<CryptoKey> {
	const recordId = await computeRecordId(userId);
	const cached = derivedKeyCache.get(recordId);
	if (cached) {
		return cached;
	}

	const key = await deriveUserKey(userId);
	derivedKeyCache.set(recordId, key);
	return key;
}

/**
 * Compute an opaque record ID for a userId.
 *
 * Uses HMAC-SHA-256(userId, masterKeyBytes) so that:
 * - User B cannot determine User A's record IDs by inspecting IndexedDB
 * - The mapping is deterministic (same user always gets same record ID)
 *
 * @param userId - The authenticated user's ID
 * @returns Hex-encoded HMAC digest (64 chars)
 */
export async function computeRecordId(userId: string): Promise<string> {
	const masterBytes = await getOrCreateMasterBytes();

	// Import master bytes as HMAC key
	const hmacKey = await crypto.subtle.importKey(
		'raw',
		masterBytes,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);

	const data = new TextEncoder().encode(userId);
	const signature = await crypto.subtle.sign('HMAC', hmacKey, data);

	return bufferToHex(signature);
}

/**
 * Discard all cached per-user derived keys.
 *
 * Call this on logout. The ciphertext remains in IndexedDB but is inert
 * without re-deriving the key (which requires the userId + master key).
 */
export function discardDerivedKeys(): void {
	derivedKeyCache.clear();
	console.debug('[CredentialEncryption] All derived keys discarded');
}

// ============================================================================
// Legacy v1 Key Management (for migration)
// ============================================================================

/** Cached legacy device key */
let cachedLegacyKey: CryptoKey | null = null;

/**
 * Get the legacy v1 device key (if it exists).
 * Used only for decrypting v1-encrypted credentials during migration.
 */
async function getLegacyDeviceKey(): Promise<CryptoKey | null> {
	if (cachedLegacyKey) {
		return cachedLegacyKey;
	}

	const db = await openKeyDB();

	const existing = await new Promise<CryptoKey | null>((resolve, reject) => {
		const tx = db.transaction(KEY_STORE_NAME, 'readonly');
		const store = tx.objectStore(KEY_STORE_NAME);
		const request = store.get(DEVICE_KEY_ID);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			resolve(request.result?.key ?? null);
		};
	});

	if (existing) {
		cachedLegacyKey = existing;
	}
	return existing;
}

/**
 * Decrypt a v1-encrypted credential using the legacy device key.
 *
 * @throws Error if legacy key doesn't exist or decryption fails
 */
export async function decryptLegacyCredential<T>(encrypted: EncryptedCredential): Promise<T> {
	const key = await getLegacyDeviceKey();
	if (!key) {
		throw new Error('[CredentialEncryption] No legacy device key found for v1 decryption');
	}

	const ivBuffer = base64ToBuffer(encrypted.iv);
	const ciphertext = base64ToBuffer(encrypted.ciphertext);

	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: ivBuffer },
		key,
		ciphertext
	);

	const json = new TextDecoder().decode(plaintext);
	return JSON.parse(json);
}

// ============================================================================
// Encoding Utilities
// ============================================================================

function bufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

function bufferToHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// ============================================================================
// Encryption Operations (v2 — Per-User)
// ============================================================================

/**
 * Encrypt a credential object for a specific user.
 *
 * Uses per-user AES-256-GCM key derived via HKDF from device master key.
 *
 * @param credential - Credential object to encrypt
 * @param userId - The authenticated user's ID
 * @returns Encrypted credential wrapper (version 2)
 */
export async function encryptCredential<T>(credential: T, userId: string): Promise<EncryptedCredential> {
	const key = await getUserKey(userId);

	const iv = crypto.getRandomValues(new Uint8Array(12));
	const plaintext = JSON.stringify(credential);
	const data = new TextEncoder().encode(plaintext);

	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

	return {
		ciphertext: bufferToBase64(ciphertext),
		iv: bufferToBase64(iv.buffer),
		version: ENCRYPTION_VERSION
	};
}

/**
 * Decrypt a stored credential for a specific user.
 *
 * Handles both v2 (per-user HKDF) and v1 (legacy device key) formats.
 *
 * @param encrypted - Encrypted credential wrapper
 * @param userId - The authenticated user's ID
 * @returns Decrypted credential object
 * @throws Error if decryption fails
 */
export async function decryptCredential<T>(encrypted: EncryptedCredential, userId: string): Promise<T> {
	// v2: per-user HKDF-derived key
	if (encrypted.version >= 2) {
		const key = await getUserKey(userId);

		const ivBuffer = base64ToBuffer(encrypted.iv);
		const ciphertext = base64ToBuffer(encrypted.ciphertext);

		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: ivBuffer },
			key,
			ciphertext
		);

		const json = new TextDecoder().decode(plaintext);
		return JSON.parse(json);
	}

	// v1 fallback: legacy device-bound key
	return decryptLegacyCredential<T>(encrypted);
}

// ============================================================================
// Capability Detection
// ============================================================================

/**
 * Check if encryption is available (Web Crypto API present)
 */
export function isEncryptionAvailable(): boolean {
	if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
		console.warn('[CredentialEncryption] Web Crypto API not available');
		return false;
	}

	if (typeof indexedDB === 'undefined') {
		console.warn('[CredentialEncryption] IndexedDB not available');
		return false;
	}

	if (typeof window !== 'undefined' && !window.isSecureContext) {
		console.warn('[CredentialEncryption] Not in secure context (HTTPS required)');
		return false;
	}

	return true;
}

/**
 * Check if a stored object is encrypted
 */
export function isEncryptedCredential(stored: unknown): stored is { encrypted: EncryptedCredential } {
	if (!stored || typeof stored !== 'object') {
		return false;
	}

	const obj = stored as Record<string, unknown>;

	if (!obj.encrypted || typeof obj.encrypted !== 'object') {
		return false;
	}

	const encrypted = obj.encrypted as Record<string, unknown>;

	return (
		typeof encrypted.ciphertext === 'string' &&
		typeof encrypted.iv === 'string' &&
		typeof encrypted.version === 'number'
	);
}

// ============================================================================
// Key Rotation Support
// ============================================================================

/**
 * Rotate the device master key.
 *
 * Generates new master bytes. Caller must re-encrypt all stored credentials.
 * Returns old master bytes for re-encryption migration.
 */
export async function rotateMasterKey(): Promise<{
	oldMasterBytes: ArrayBuffer | null;
	newMasterBytes: ArrayBuffer;
}> {
	const db = await openKeyDB();
	const oldMasterBytes = cachedMasterBytes;

	const newRawBytes = crypto.getRandomValues(new Uint8Array(32)).buffer;

	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
		const store = tx.objectStore(KEY_STORE_NAME);
		const request = store.put({
			id: DERIVATION_KEY_ID,
			rawBytes: newRawBytes,
			createdAt: new Date().toISOString(),
			rotatedFrom: oldMasterBytes ? new Date().toISOString() : undefined
		});

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});

	cachedMasterBytes = newRawBytes;
	derivedKeyCache.clear();

	console.debug('[CredentialEncryption] Master key rotated, derived key cache cleared');

	return { oldMasterBytes, newMasterBytes: newRawBytes };
}

/**
 * Clear all key material (full data wipe).
 *
 * WARNING: This will make all encrypted credentials unreadable!
 */
export async function clearAllKeys(): Promise<void> {
	const db = await openKeyDB();

	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
		const store = tx.objectStore(KEY_STORE_NAME);

		// Clear both legacy and v2 keys
		store.delete(DEVICE_KEY_ID);
		const request = store.delete(DERIVATION_KEY_ID);

		request.onerror = () => reject(request.error);
		tx.oncomplete = () => resolve();
	});

	cachedMasterBytes = null;
	masterKeyPromise = null;
	cachedLegacyKey = null;
	derivedKeyCache.clear();

	console.debug('[CredentialEncryption] All key material cleared');
}

// Legacy aliases for backward compatibility during migration
export const clearDeviceKey = clearAllKeys;
export const rotateDeviceKey = async () => {
	const result = await rotateMasterKey();
	return {
		oldKey: null as CryptoKey | null,
		newKey: null as unknown as CryptoKey
	};
};
