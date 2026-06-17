/**
 * Logout must sweep the wrapped org keys + the device master keystore.
 *
 * `clearAllClientCaches` deleted five IndexedDB DBs on logout but never
 * `commons-org-keys` (wrapped org keys) nor `commons-keystore` (the device
 * master). `discardDerivedKeys()` only cleared an in-memory Map — it left the
 * on-disk stores AND the in-memory `cachedMasterBytes`. On a shared browser the
 * next user could re-derive any per-user key from the surviving master and
 * decrypt cached org PII.
 *
 * This pins the module-owned teardown helpers (which `clearAllClientCaches` now
 * calls) against real fake-indexeddb behavior, proves the key DATA is wiped even
 * when `deleteDatabase` is blocked by another open connection, and source-pins
 * the logout wiring.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
	getOrCreateMasterBytes,
	encryptCredential,
	clearKeystore
} from '$lib/core/identity/credential-encryption';
import { cacheOrgKey, getOrPromptOrgKey, clearAllOrgKeys } from '$lib/services/org-key-manager';
import { deriveOrgKey, createKeyVerifier } from '$lib/core/crypto/org-pii-encryption';

function dbExists(name: string): Promise<boolean> {
	return new Promise((resolve) => {
		let existed = true;
		const req = indexedDB.open(name);
		req.onupgradeneeded = () => {
			// open() with no version creates the DB if absent → upgradeneeded fires
			// only when it did not already exist.
			existed = false;
		};
		req.onsuccess = () => {
			req.result.close();
			// Only delete the probe DB if WE created it (it didn't pre-exist) — a
			// blanket delete would tear down a DB the test still depends on.
			if (!existed) {
				indexedDB.deleteDatabase(name);
			}
			resolve(existed);
		};
		req.onerror = () => resolve(false);
	});
}

describe('device keystore teardown', () => {
	it('clearKeystore deletes commons-keystore and nulls the in-memory master bytes', async () => {
		// Materialize the device master on disk + in memory.
		const first = await getOrCreateMasterBytes();
		expect(first.byteLength).toBe(32);
		// Encrypt something so the keystore is genuinely populated.
		const encrypted = await encryptCredential({ secret: 'x' }, 'user-1');
		expect(encrypted.ciphertext.length).toBeGreaterThan(0);

		await clearKeystore();

		// The on-disk store is gone...
		expect(await dbExists('commons-keystore')).toBe(false);

		// ...and the in-memory master cache was nulled: the next call regenerates
		// fresh 32-byte material rather than handing back the discarded buffer.
		const regenerated = await getOrCreateMasterBytes();
		expect(regenerated.byteLength).toBe(32);
		expect(new Uint8Array(regenerated)).not.toEqual(new Uint8Array(first));

		await clearKeystore();
	});
});

describe('wrapped org-key teardown', () => {
	it('clearAllOrgKeys deletes commons-org-keys so no wrapped key survives', async () => {
		const orgId = 'org_abc';
		const passphrase = 'correct horse battery staple';
		const orgKey = await deriveOrgKey(passphrase, orgId);
		const verifier = await createKeyVerifier(orgKey);

		await cacheOrgKey(orgKey, orgId);
		// The wrapped key round-trips before teardown.
		expect(await getOrPromptOrgKey(orgId, verifier)).not.toBeNull();

		await clearAllOrgKeys();

		// After the sweep there is no wrapped key for the next user to unwrap.
		expect(await getOrPromptOrgKey(orgId, verifier)).toBeNull();
	});
});

describe('key DATA is wiped even when deleteDatabase is blocked by an open connection', () => {
	// A second open connection (e.g. another tab) blocks `deleteDatabase`, so the
	// empty DB shell may linger. But the SENSITIVE data must already be gone: a
	// readwrite `objectStore.clear()` is NOT blocked by other connections, so the
	// teardown clears the store contents first, then best-effort deletes the DB
	// (resolving even on blocked). The logout path can then safely redirect.

	function openRaw(name: string): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open(name);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	function getRecord(db: IDBDatabase, store: string, key: string): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(store, 'readonly');
			const req = tx.objectStore(store).get(key);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	it('clearKeystore resolves and wipes the master record even though a second connection blocks the DB delete', async () => {
		// Materialize the device master on disk.
		const first = await getOrCreateMasterBytes();
		expect(first.byteLength).toBe(32);
		// Encrypt something so the keystore is genuinely populated.
		await encryptCredential({ secret: 'x' }, 'user-1');

		// Hold a second open connection so the internal deleteDatabase BLOCKS —
		// only the readwrite clear() (which isn't blocked) can wipe the data.
		const holder = await openRaw('commons-keystore');

		// Must RESOLVE (not reject): the store CONTENTS are cleared even though the
		// best-effort DB-shell delete is blocked by `holder`.
		await expect(clearKeystore()).resolves.toBeUndefined();

		// Close the holder so the now-pending (previously blocked) delete can drain
		// before we re-open. (A real second tab closing does the same.)
		holder.close();

		// The master record is GONE: re-opening regenerates fresh material rather
		// than handing back the discarded buffer.
		const regenerated = await getOrCreateMasterBytes();
		expect(regenerated.byteLength).toBe(32);
		expect(new Uint8Array(regenerated)).not.toEqual(new Uint8Array(first));

		await clearKeystore();
	});

	it('clearAllOrgKeys resolves and wipes the wrapped key even though a second connection blocks the DB delete', async () => {
		const orgId = 'org_blocked';
		const passphrase = 'correct horse battery staple';
		const orgKey = await deriveOrgKey(passphrase, orgId);
		const verifier = await createKeyVerifier(orgKey);

		await cacheOrgKey(orgKey, orgId);
		expect(await getOrPromptOrgKey(orgId, verifier)).not.toBeNull();

		// Hold a second open connection so the internal deleteDatabase BLOCKS.
		const holder = await openRaw('commons-org-keys');

		// Must RESOLVE — the wrapped key is cleared even though the shell delete
		// is blocked.
		await expect(clearAllOrgKeys()).resolves.toBeUndefined();

		// Assert the wrapped-key row is gone directly on the holder connection
		// (the contents were cleared while it was still open).
		expect(await getRecord(holder, 'wrapped-keys', orgId)).toBeUndefined();

		// Close the holder so the pending delete can drain, then confirm no wrapped
		// key survives for the next user to unwrap.
		holder.close();
		expect(await getOrPromptOrgKey(orgId, verifier)).toBeNull();

		await clearAllOrgKeys();
	});
});

describe('logout wiring delegates both stores to their owning teardown', () => {
	const source = readFileSync(
		path.resolve(process.cwd(), 'src/lib/core/identity/cache-invalidation.ts'),
		'utf8'
	);

	it('clearAllClientCaches calls the module-owned teardown for both stores', () => {
		const from = source.indexOf('export async function clearAllClientCaches');
		expect(from).toBeGreaterThan(-1);
		const body = source.slice(from, source.indexOf('async function clearDatabase', from));
		// The keystore sweep (which nulls cachedMasterBytes + deletes the DB) and
		// the org-key sweep both run on logout — not just the old in-memory-only
		// discardDerivedKeys().
		expect(body).toContain('clearKeystore');
		expect(body).toContain('clearAllOrgKeys');
	});
});
