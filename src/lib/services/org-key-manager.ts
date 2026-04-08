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
 * Clear the cached org key for an org (e.g., on logout or passphrase change).
 */
export { clearCachedWrapped as clearCachedOrgKey };
