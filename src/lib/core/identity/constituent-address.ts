/**
 * Constituent Address Store
 *
 * Encrypted client-side cache for the constituent delivery address.
 *
 * Privacy scope (F-1.2 honesty pass): the plaintext address does NOT reach
 * our server through THIS storage path. However:
 *  - During address verification, the manual-entry fallback (Path B in
 *    `AddressVerificationFlow.svelte`) sends the full address to our
 *    self-hosted geocoder server-side; we discard it after the district is
 *    derived but before it ever reaches this store.
 *  - The Shadow Atlas client-side ZKP path (Path A) computes the district
 *    commitment in the browser; only the commitment + approximate coordinates
 *    transit the server (the latter for the F-1.1 authenticity gate).
 *  - From this store onwards, only encrypted forms reach the server: CWC
 *    delivery uses the encrypted blob as ZKP witness payload; the server
 *    never decrypts.
 *
 * Why we keep the address client-side: CWC delivery requires the full address
 * encrypted into the ZKP witness, and users shouldn't re-enter it every
 * session. AES-256-GCM, device-bound key, auto-expires with the session
 * credential (6 months).
 *
 * Threat model: Same as session-credentials.ts — protects against XSS,
 * malicious extensions, devtools inspection. Same-origin scripts with full
 * DOM access can still invoke decrypt(). Defense-in-depth.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
	encryptCredential,
	decryptCredential,
	isEncryptionAvailable
} from './credential-encryption';

// ============================================================================
// Types
// ============================================================================

export interface ConstituentAddress {
	street: string;
	city: string;
	state: string;
	zip: string;
	/** Congressional district (e.g., "CA-12") — cached to avoid re-geocoding */
	district?: string;
}

interface StoredAddress {
	userId: string;
	encrypted?: import('./credential-encryption').EncryptedCredential;
	expiresAt: Date;
}

interface AddressDB extends DBSchema {
	addresses: {
		key: string; // userId
		value: StoredAddress;
	};
}

// ============================================================================
// Database
// ============================================================================

const DB_NAME = 'commons-address';
const DB_VERSION = 1;
const STORE_NAME = 'addresses';
/** 6 months in milliseconds */
const TTL_MS = 6 * 30 * 24 * 60 * 60 * 1000;

let dbInstance: IDBPDatabase<AddressDB> | null = null;

async function getDB(): Promise<IDBPDatabase<AddressDB>> {
	if (dbInstance) return dbInstance;

	dbInstance = await openDB<AddressDB>(DB_NAME, DB_VERSION, {
		upgrade(db) {
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
			}
		},
		blocking() {
			dbInstance?.close();
			dbInstance = null;
		},
		terminated() {
			dbInstance = null;
		}
	});

	return dbInstance;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Store constituent address encrypted in IndexedDB.
 * Expires after 6 months (aligned with session credential TTL).
 */
export async function storeConstituentAddress(
	userId: string,
	address: ConstituentAddress
): Promise<void> {
	if (!isEncryptionAvailable()) {
		console.warn('[ConstituentAddress] Encryption unavailable — address not persisted');
		return;
	}

	const db = await getDB();
	const encrypted = await encryptCredential(address, userId);
	const expiresAt = new Date(Date.now() + TTL_MS);

	await db.put(STORE_NAME, { userId, encrypted, expiresAt });

	console.debug('[ConstituentAddress] Stored (encrypted):', {
		userId,
		district: address.district,
		expiresAt: expiresAt.toISOString()
	});
}

/**
 * Retrieve constituent address from encrypted IndexedDB.
 * Returns null if expired, missing, or decryption fails (device change).
 */
export async function getConstituentAddress(
	userId: string
): Promise<ConstituentAddress | null> {
	try {
		const db = await getDB();
		const stored = await db.get(STORE_NAME, userId);

		if (!stored?.encrypted) return null;

		// Check expiration
		const expiresAt =
			stored.expiresAt instanceof Date ? stored.expiresAt : new Date(stored.expiresAt);
		if (expiresAt < new Date()) {
			await clearConstituentAddress(userId);
			return null;
		}

		const address = await decryptCredential<ConstituentAddress>(stored.encrypted, userId);
		return address;
	} catch (e) {
		console.warn('[ConstituentAddress] Retrieval failed:', e);
		return null;
	}
}

/**
 * Clear stored address (logout, re-verification, demo reset).
 */
export async function clearConstituentAddress(userId: string): Promise<void> {
	try {
		const db = await getDB();
		await db.delete(STORE_NAME, userId);
	} catch (e) {
		console.warn('[ConstituentAddress] Clear failed:', e);
	}
}
