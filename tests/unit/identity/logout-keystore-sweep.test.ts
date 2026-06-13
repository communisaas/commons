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
 * calls) against real fake-indexeddb behavior, proves a blocked deletion is
 * surfaced rather than reported as success, and source-pins the logout wiring.
 */

import 'fake-indexeddb/auto';
import { afterEach, describe, it, expect } from 'vitest';
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
			// Clean up the probe DB so it doesn't pollute later assertions.
			indexedDB.deleteDatabase(name);
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

describe('blocked deletion is surfaced, not silently reported as success', () => {
	// A second open connection (e.g. another tab) blocks deleteDatabase: the key
	// DB stays on disk. The teardown must reject so the logout path logs the
	// incomplete wipe instead of redirecting as if the keys were gone.
	const realDeleteDatabase = indexedDB.deleteDatabase.bind(indexedDB);
	afterEach(() => {
		indexedDB.deleteDatabase = realDeleteDatabase;
	});

	function stubBlockedDeletion() {
		indexedDB.deleteDatabase = ((_name: string) => {
			const request: Record<string, unknown> = {};
			// Fire onblocked once the caller has wired its handler.
			queueMicrotask(() => {
				const handler = request.onblocked as (() => void) | undefined;
				handler?.();
			});
			return request as unknown as IDBOpenDBRequest;
		}) as typeof indexedDB.deleteDatabase;
	}

	it('clearKeystore rejects when the keystore deletion is blocked', async () => {
		stubBlockedDeletion();
		await expect(clearKeystore()).rejects.toThrow(/blocked/i);
	});

	it('clearAllOrgKeys rejects when the org-key deletion is blocked', async () => {
		stubBlockedDeletion();
		await expect(clearAllOrgKeys()).rejects.toThrow(/blocked/i);
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
