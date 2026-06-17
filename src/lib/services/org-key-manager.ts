/**
 * Org key lifecycle for the browser.
 *
 * - First use: prompt for passphrase, derive key, cache wrapped in IndexedDB
 * - Subsequent uses: unwrap from device cache
 * - Verification: check passphrase against stored verifier
 *
 * IndexedDB pattern follows credential-encryption.ts (separate DB, cached connection).
 */

import {
	deriveOrgKey,
	verifyOrgKey,
	wrapOrgKeyForDevice,
	unwrapOrgKeyFromDevice
} from '$lib/core/crypto/org-pii-encryption';
import { getOrCreateMasterBytes } from '$lib/core/identity/credential-encryption';

const ORG_KEY_DB_NAME = 'commons-org-keys';
const ORG_KEY_STORE_NAME = 'wrapped-keys';

let dbInstance: IDBDatabase | null = null;

async function openOrgKeyDB(): Promise<IDBDatabase> {
	if (dbInstance) return dbInstance;

	return new Promise((resolve, reject) => {
		const request = indexedDB.open(ORG_KEY_DB_NAME, 1);

		request.onerror = () => reject(request.error);

		request.onsuccess = () => {
			dbInstance = request.result;
			dbInstance.onclose = () => {
				dbInstance = null;
			};
			resolve(dbInstance);
		};

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(ORG_KEY_STORE_NAME)) {
				db.createObjectStore(ORG_KEY_STORE_NAME, { keyPath: 'orgId' });
			}
		};
	});
}

async function getCachedWrapped(orgId: string): Promise<string | null> {
	const db = await openOrgKeyDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(ORG_KEY_STORE_NAME, 'readonly');
		const store = tx.objectStore(ORG_KEY_STORE_NAME);
		const request = store.get(orgId);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result?.wrapped ?? null);
	});
}

async function storeCachedWrapped(orgId: string, wrapped: string): Promise<void> {
	const db = await openOrgKeyDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(ORG_KEY_STORE_NAME, 'readwrite');
		const store = tx.objectStore(ORG_KEY_STORE_NAME);
		const request = store.put({ orgId, wrapped, cachedAt: Date.now() });
		request.onerror = () => reject(request.error);
		tx.oncomplete = () => resolve();
	});
}

async function clearCachedWrapped(orgId: string): Promise<void> {
	const db = await openOrgKeyDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(ORG_KEY_STORE_NAME, 'readwrite');
		const store = tx.objectStore(ORG_KEY_STORE_NAME);
		const request = store.delete(orgId);
		request.onerror = () => reject(request.error);
		tx.oncomplete = () => resolve();
	});
}

/**
 * Try to get a cached org key. Returns null if no cache or passphrase changed.
 */
export async function getOrPromptOrgKey(
	orgId: string,
	verifier: string
): Promise<CryptoKey | null> {
	const wrapped = await getCachedWrapped(orgId);
	if (!wrapped) return null;

	try {
		const deviceBytes = await getOrCreateMasterBytes();
		const key = await unwrapOrgKeyFromDevice(wrapped, deviceBytes);
		const valid = await verifyOrgKey(key, verifier);
		if (valid) return key;
	} catch {
		// Unwrap failed — device key rotated or corrupt
	}

	// Invalid cache — passphrase changed or device key rotated
	await clearCachedWrapped(orgId);
	return null;
}

/**
 * Derive an org key from passphrase, verify against the stored verifier,
 * and cache it wrapped with the device master key.
 *
 * Returns null if the passphrase is wrong.
 */
export async function deriveAndCacheOrgKey(
	passphrase: string,
	orgId: string,
	verifier: string
): Promise<CryptoKey | null> {
	const key = await deriveOrgKey(passphrase, orgId);
	const valid = await verifyOrgKey(key, verifier);
	if (!valid) return null;

	const deviceBytes = await getOrCreateMasterBytes();
	const wrapped = await wrapOrgKeyForDevice(key, deviceBytes);
	await storeCachedWrapped(orgId, wrapped);

	return key;
}

/**
 * Cache an already-derived org key on this device. Avoids re-deriving via PBKDF2
 * when we already hold the key in memory (e.g., during initial setup).
 */
export async function cacheOrgKey(orgKey: CryptoKey, orgId: string): Promise<void> {
	const deviceBytes = await getOrCreateMasterBytes();
	const wrapped = await wrapOrgKeyForDevice(orgKey, deviceBytes);
	await storeCachedWrapped(orgId, wrapped);
}

/**
 * Clear the cached org key for an org (e.g., on logout or passphrase change).
 */
export { clearCachedWrapped as clearCachedOrgKey };

/**
 * Wipe every wrapped org key from this device.
 *
 * Logout has no list of which orgs the user unwrapped, so a per-org
 * `clearCachedOrgKey(orgId)` cannot sweep them all. We must clear the whole
 * store so no wrapped org key survives for the next user on a shared browser
 * to re-derive and decrypt cached org PII.
 *
 *   1. Clear the ORG_KEY_STORE_NAME ('wrapped-keys') object-store CONTENTS in a
 *      readwrite transaction. Unlike `deleteDatabase`, `objectStore.clear()` is
 *      NOT blocked by other open connections, so the wrapped keys are
 *      guaranteed gone from disk even if a second tab holds the DB open.
 *   2. Best-effort delete the database to drop the empty shell — resolve on
 *      success, error, AND blocked, since the sensitive data is already gone.
 */
export async function clearAllOrgKeys(): Promise<void> {
	// Step 1 — guaranteed wipe: clear the store contents. clear() in a readwrite
	// transaction succeeds even while another tab holds the DB open.
	try {
		const db = await openOrgKeyDB();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(ORG_KEY_STORE_NAME, 'readwrite');
			const store = tx.objectStore(ORG_KEY_STORE_NAME);
			store.clear();
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} catch (err) {
		if (err instanceof DOMException && err.name === 'NotFoundError') {
			// Benign: the store/DB never existed, so there are no wrapped keys to wipe.
			console.debug('[OrgKeyManager] Org-key clear skipped (store/DB absent):', err);
		} else {
			// A real transaction failure means wrapped org keys may STILL be on disk.
			// Surface it and rethrow so logout records a failed key sweep rather than
			// silently reporting success.
			console.error('[OrgKeyManager] Org-key content wipe FAILED — wrapped keys may persist:', err);
			throw err;
		}
	}

	// Close our handle so the best-effort delete below isn't blocked by us.
	if (dbInstance) {
		dbInstance.close();
		dbInstance = null;
	}

	// Step 2 — best-effort: drop the now-empty DB shell. The wrapped keys are
	// already cleared in step 1, so resolve on success, error, AND blocked. A
	// blocked delete only leaves an EMPTY database behind until other tabs close.
	return new Promise((resolve) => {
		const request = indexedDB.deleteDatabase(ORG_KEY_DB_NAME);
		request.onsuccess = () => resolve();
		request.onerror = () => resolve();
		request.onblocked = () => resolve();
	});
}
