/**
 * Session Credential Cache (IndexedDB)
 *
 * Client-side caching of verification credentials to avoid repeated verification.
 *
 * Why IndexedDB (not localStorage):
 * - Can store Uint8Array (for future ZK proof caching)
 * - Larger storage capacity (>50MB vs 5MB)
 * - Better performance for structured data
 * - Async API (non-blocking)
 *
 * Privacy:
 * - NO PII stored (only verification status + district)
 * - Encrypted blob ID points to server storage
 * - Session expires after 3-6 months
 * - User can clear at any time
 *
 * Security (ISSUE-004):
 * - Credentials encrypted with Web Crypto API before storage
 * - Device-bound, non-extractable AES-256-GCM key
 * - Protects against XSS, malicious extensions, devtools inspection
 *
 * Progressive Verification:
 * - First visit: Full verification required
 * - Return visits: Skip verification (if not expired)
 * - Template submission: Check credential, skip if valid
 * - Expiration: Graceful re-verification prompt
 */

import {
	encryptCredential,
	decryptCredential,
	isEncryptionAvailable,
	type EncryptedCredential
} from './credential-encryption';

// ============================================================================
// Types
// ============================================================================

export interface SessionCredential {
	/** User identifier */
	userId: string;
	/** Verification status */
	isVerified: boolean;
	/** Verification method used */
	verificationMethod: 'digital-credentials-api' | 'mdl' | 'nfc-passport' | 'government-id';
	/** Congressional district (e.g., "CA-12") */
	congressionalDistrict?: string;
	/** Encrypted blob ID (Convex `_id` as string) */
	blobId: string;
	/** When the blob was encrypted */
	encryptedAt: string;
	/** Session expiration date */
	expiresAt: string;
	/** Optional: ZK proof witness data (Phase 2) */
	zkProofWitness?: Uint8Array;
}

/**
 * Stored credential wrapper
 *
 * Can contain either:
 * - encrypted: New encrypted format
 * - Legacy plaintext fields (for migration)
 */
interface StoredCredential {
	/** User ID (always stored in plaintext for indexing) */
	userId: string;

	/** Encrypted credential data (new format) */
	encrypted?: EncryptedCredential;

	/** Expiration date (stored in plaintext for index queries) */
	expiresAt: string;

	// Legacy plaintext fields (for migration detection)
	isVerified?: boolean;
	verificationMethod?: 'nfc-passport' | 'government-id';
	congressionalDistrict?: string;
	blobId?: string;
	encryptedAt?: string;
	zkProofWitness?: Uint8Array;
}

// ============================================================================
// IndexedDB Setup
// ============================================================================

const DB_NAME = 'commons-sessions';
const DB_VERSION = 2; // Bumped for encryption migration
const STORE_NAME = 'verification-credentials';

/**
 * Open IndexedDB database
 */
async function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;

			// Create object store if it doesn't exist
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
				// Create index for quick expiration checks
				objectStore.createIndex('expiresAt', 'expiresAt', { unique: false });
			}

			// Version 2: Added encryption support
			// No schema changes needed - we store encrypted data in the same store
			// Migration happens lazily on read/write
			console.debug('[Session Cache] Database upgraded to v2 (encryption support)');
		};
	});
}

// ============================================================================
// Encryption Helpers
// ============================================================================

/**
 * Check if a stored credential is in legacy plaintext format
 */
function isLegacyPlaintext(stored: StoredCredential): boolean {
	return !stored.encrypted && stored.blobId !== undefined;
}

/**
 * Convert stored credential to SessionCredential
 */
function storedToSessionCredential(stored: StoredCredential): SessionCredential {
	return {
		userId: stored.userId,
		isVerified: stored.isVerified!,
		verificationMethod: stored.verificationMethod!,
		congressionalDistrict: stored.congressionalDistrict,
		blobId: stored.blobId!,
		encryptedAt: stored.encryptedAt!,
		expiresAt: stored.expiresAt,
		zkProofWitness: stored.zkProofWitness
	};
}

/**
 * Serialize SessionCredential for encryption (handle Uint8Array)
 */
function serializeForEncryption(credential: SessionCredential): object {
	let zkProofWitnessBase64: string | undefined;

	if (credential.zkProofWitness) {
		// Convert Uint8Array to base64 for JSON serialization
		let binary = '';
		for (let i = 0; i < credential.zkProofWitness.length; i++) {
			binary += String.fromCharCode(credential.zkProofWitness[i]);
		}
		zkProofWitnessBase64 = btoa(binary);
	}

	return {
		...credential,
		zkProofWitness: zkProofWitnessBase64
	};
}

/**
 * Deserialize SessionCredential after decryption (restore Uint8Array)
 */
function deserializeAfterDecryption(data: Record<string, unknown>): SessionCredential {
	return {
		userId: data.userId as string,
		isVerified: data.isVerified as boolean,
		verificationMethod: data.verificationMethod as SessionCredential['verificationMethod'],
		congressionalDistrict: data.congressionalDistrict as string | undefined,
		blobId: data.blobId as string,
		encryptedAt: data.encryptedAt as string,
		expiresAt: data.expiresAt as string,
		// Convert base64 back to Uint8Array
		zkProofWitness: data.zkProofWitness
			? new Uint8Array(
					atob(data.zkProofWitness as string)
						.split('')
						.map((c) => c.charCodeAt(0))
			  )
			: undefined
	};
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Store session credential in IndexedDB
 *
 * Encrypts the credential using Web Crypto API before storage.
 * Throws if encryption is unavailable (will not store plaintext).
 *
 * @param credential - Session credential to store
 * @throws Error if Web Crypto API is unavailable (insecure context, old browser)
 */
export async function storeSessionCredential(credential: SessionCredential): Promise<void> {
	try {
		const db = await openDatabase();
		const transaction = db.transaction([STORE_NAME], 'readwrite');
		const store = transaction.objectStore(STORE_NAME);

		let storedCredential: StoredCredential;

		if (!isEncryptionAvailable()) {
			throw new Error(
				'[Session Cache] Cannot store credentials: Web Crypto API is unavailable. ' +
				'Credential storage requires a secure context (HTTPS or localhost) with Web Crypto support. ' +
				'Refusing to store credentials in plaintext.'
			);
		}

		// Serialize and encrypt credential data
		const serialized = serializeForEncryption(credential);
		const encrypted = await encryptCredential(serialized, credential.userId);

		storedCredential = {
			userId: credential.userId,
			encrypted,
			expiresAt: credential.expiresAt
		};

		console.debug('[Session Cache] Stored encrypted credential for user:', credential.userId.slice(0, 8));

		return new Promise((resolve, reject) => {
			const request = store.put(storedCredential);

			request.onsuccess = () => resolve();

			request.onerror = () => {
				console.error('[Session Cache] Failed to store credential:', request.error);
				reject(request.error);
			};

			transaction.oncomplete = () => db.close();
		});
	} catch (error) {
		console.error('[Session Cache] Store failed:', error);
		throw error;
	}
}

/**
 * Retrieve session credential from IndexedDB
 *
 * Automatically handles:
 * - Decryption of encrypted credentials
 * - Migration of legacy plaintext credentials
 * - Expiration checking
 *
 * @param userId - User identifier
 * @returns Session credential if exists, null otherwise
 */
export async function getSessionCredential(userId: string): Promise<SessionCredential | null> {
	try {
		const db = await openDatabase();
		const transaction = db.transaction([STORE_NAME], 'readonly');
		const store = transaction.objectStore(STORE_NAME);

		return new Promise((resolve, reject) => {
			const request = store.get(userId);

			request.onsuccess = async () => {
				const stored = request.result as StoredCredential | undefined;

				if (!stored) {
					console.debug('[Session Cache] No credential found for user:', userId.slice(0, 8));
					resolve(null);
					return;
				}

				// Check expiration (using plaintext expiresAt)
				const expiresAt = new Date(stored.expiresAt);
				const now = new Date();

				if (expiresAt < now) {
					console.debug('[Session Cache] Credential expired for user:', userId.slice(0, 8));
					// Auto-delete expired credential
					deleteSessionCredential(userId);
					resolve(null);
					return;
				}

				let credential: SessionCredential;

				if (stored.encrypted) {
					// Decrypt the credential
					try {
						const decrypted = await decryptCredential<Record<string, unknown>>(stored.encrypted, userId);
						credential = deserializeAfterDecryption(decrypted);
						console.debug('[Session Cache] Retrieved encrypted credential for user:', userId.slice(0, 8));
					} catch (decryptError) {
						console.error('[Session Cache] Decryption failed:', decryptError);
						// Key may have been rotated or device changed - clear invalid credential
						deleteSessionCredential(userId);
						resolve(null);
						return;
					}
				} else if (isLegacyPlaintext(stored)) {
					// Legacy plaintext format - migrate to encrypted
					credential = storedToSessionCredential(stored);

					// Migrate to encrypted format in background
					if (isEncryptionAvailable()) {
						storeSessionCredential(credential).catch((error) => {
							console.error('[Session Cache] Migration failed:', error);
						});
						console.debug('[Session Cache] Migrating to encrypted format:', userId.slice(0, 8));
					}

					console.debug('[Session Cache] Retrieved plaintext credential for user:', userId.slice(0, 8));
				} else {
					console.error('[Session Cache] Invalid stored format for user:', userId.slice(0, 8));
					resolve(null);
					return;
				}

				resolve(credential);
			};

			request.onerror = () => {
				console.error('[Session Cache] Failed to retrieve credential:', request.error);
				reject(request.error);
			};

			transaction.oncomplete = () => db.close();
		});
	} catch (error) {
		console.error('[Session Cache] Retrieve failed:', error);
		return null;
	}
}

/**
 * Delete session credential from IndexedDB
 *
 * @param userId - User identifier
 */
export async function deleteSessionCredential(userId: string): Promise<void> {
	try {
		const db = await openDatabase();
		const transaction = db.transaction([STORE_NAME], 'readwrite');
		const store = transaction.objectStore(STORE_NAME);

		return new Promise((resolve, reject) => {
			const request = store.delete(userId);

			request.onsuccess = () => {
				console.debug('[Session Cache] Deleted credential for user:', userId.slice(0, 8));
				resolve();
			};

			request.onerror = () => {
				console.error('[Session Cache] Failed to delete credential:', request.error);
				reject(request.error);
			};

			transaction.oncomplete = () => db.close();
		});
	} catch (error) {
		console.error('[Session Cache] Delete failed:', error);
		throw error;
	}
}

/**
 * Clear all expired credentials (maintenance)
 */
export async function clearExpiredCredentials(): Promise<number> {
	try {
		const db = await openDatabase();
		const transaction = db.transaction([STORE_NAME], 'readwrite');
		const store = transaction.objectStore(STORE_NAME);
		const index = store.index('expiresAt');

		const now = new Date().toISOString();
		let deletedCount = 0;

		return new Promise((resolve, reject) => {
			// Get all credentials with expiration before now
			const request = index.openCursor(IDBKeyRange.upperBound(now));

			request.onsuccess = (event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

				if (cursor) {
					cursor.delete();
					deletedCount++;
					cursor.continue();
				} else {
					console.debug('[Session Cache] Cleared expired credentials:', deletedCount);
					resolve(deletedCount);
				}
			};

			request.onerror = () => {
				console.error('[Session Cache] Failed to clear expired credentials:', request.error);
				reject(request.error);
			};

			transaction.oncomplete = () => db.close();
		});
	} catch (error) {
		console.error('[Session Cache] Clear expired failed:', error);
		return 0;
	}
}

/**
 * Check if user has valid session (convenience function)
 *
 * @param userId - User identifier
 * @returns True if valid session exists, false otherwise
 */
export async function hasValidSession(userId: string): Promise<boolean> {
	const credential = await getSessionCredential(userId);
	return credential !== null && credential.isVerified;
}

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Migrate all plaintext credentials to encrypted format
 *
 * Call this on app startup to ensure all credentials are encrypted.
 * Safe to call multiple times - skips already encrypted credentials.
 *
 * @returns Number of credentials migrated
 */
export async function migrateToEncrypted(): Promise<number> {
	if (!isEncryptionAvailable()) {
		console.debug('[Session Cache] Encryption unavailable, skipping migration');
		return 0;
	}

	try {
		const db = await openDatabase();
		const transaction = db.transaction([STORE_NAME], 'readonly');
		const store = transaction.objectStore(STORE_NAME);

		return new Promise((resolve, reject) => {
			const request = store.getAll();

			request.onsuccess = async () => {
				const allStored = request.result as StoredCredential[];
				let migratedCount = 0;

				for (const stored of allStored) {
					// Skip already encrypted
					if (stored.encrypted) {
						continue;
					}

					// Skip if not valid plaintext format
					if (!isLegacyPlaintext(stored)) {
						continue;
					}

					// Convert and re-store with encryption
					const credential = storedToSessionCredential(stored);
					await storeSessionCredential(credential);
					migratedCount++;
				}

				if (migratedCount > 0) {
					console.debug(`[Session Cache] Migrated ${migratedCount} credentials to encrypted storage`);
				}

				resolve(migratedCount);
			};

			request.onerror = () => {
				console.error('[Session Cache] Migration failed:', request.error);
				reject(request.error);
			};

			transaction.oncomplete = () => db.close();
		});
	} catch (error) {
		console.error('[Session Cache] Migration failed:', error);
		return 0;
	}
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize session cache (run on app startup)
 *
 * Clears expired credentials and migrates plaintext to encrypted storage.
 */
export async function initializeSessionCache(): Promise<void> {
	try {
		// Clear expired credentials on startup
		await clearExpiredCredentials();

		// Migrate any remaining plaintext to encrypted
		await migrateToEncrypted();

		console.debug('[Session Cache] Initialized');
	} catch (error) {
		console.error('[Session Cache] Initialization failed:', error);
		throw error;
	}
}
