/**
 * Wave 7 / FU-4.1 — Playwright authentication fixture.
 *
 * Run before all E2E tests to persist a session cookie as `storageState`,
 * including IndexedDB, which downstream tests load to skip OAuth and start
 * with a locally-held current address.
 *
 * Why a dev-only endpoint instead of replaying real OAuth: real OAuth
 * requires a live Auth0/Google flow which Playwright can't drive without
 * shipping test credentials. A dev-only endpoint short-circuits that —
 * it's safe in non-production builds because (a) `NODE_ENV` gates it and
 * (b) the token gates it within non-prod environments.
 *
 * Activation:
 *   - Set PLAYWRIGHT_DEV_LOGIN_TOKEN in the test runner.
 *   - playwright.config.ts forwards that value as DEV_LOGIN_TOKEN to the
 *     non-production webServer and forces SHADOW_ATLAS_VERIFICATION off so
 *     the spec drives the address-input path.
 */

import { test as setup, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_STATE_PATH = path.join(__dirname, '.auth', 'storageState.json');

const CURRENT_ADDRESS = {
	street: '123 Burnside Ave',
	city: 'Portland',
	state: 'OR',
	zip: '97214',
	district: 'OR-03'
};

async function seedEncryptedAddress(page: Page, userId: string) {
	await page.evaluate(
		async ({ address, userId }) => {
			const encoder = new TextEncoder();

			function openDb(
				name: string,
				version: number,
				onUpgrade: (db: IDBDatabase) => void
			): Promise<IDBDatabase> {
				return new Promise((resolve, reject) => {
					const request = indexedDB.open(name, version);
					request.onerror = () => reject(request.error);
					request.onsuccess = () => resolve(request.result);
					request.onupgradeneeded = () => onUpgrade(request.result);
				});
			}

			function transactionDone(tx: IDBTransaction): Promise<void> {
				return new Promise((resolve, reject) => {
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
					tx.onabort = () => reject(tx.error);
				});
			}

			function toBase64(buffer: ArrayBuffer): string {
				const bytes = new Uint8Array(buffer);
				let binary = '';
				for (const byte of bytes) binary += String.fromCharCode(byte);
				return btoa(binary);
			}

			const keyDb = await openDb('commons-keystore', 1, (db) => {
				if (!db.objectStoreNames.contains('encryption-keys')) {
					db.createObjectStore('encryption-keys', { keyPath: 'id' });
				}
			});

			let masterBytes = await new Promise<ArrayBuffer | null>((resolve, reject) => {
				const tx = keyDb.transaction('encryption-keys', 'readonly');
				const request = tx.objectStore('encryption-keys').get('device-derivation-key-v2');
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const raw = request.result?.rawBytes;
					resolve(raw instanceof ArrayBuffer ? raw : null);
				};
			});

			if (!masterBytes) {
				masterBytes = crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer;
				const tx = keyDb.transaction('encryption-keys', 'readwrite');
				tx.objectStore('encryption-keys').put({
					id: 'device-derivation-key-v2',
					rawBytes: masterBytes,
					createdAt: new Date().toISOString()
				});
				await transactionDone(tx);
			}

			const hkdfKey = await crypto.subtle.importKey(
				'raw',
				masterBytes,
				{ name: 'HKDF' },
				false,
				['deriveKey']
			);
			const userKey = await crypto.subtle.deriveKey(
				{
					name: 'HKDF',
					hash: 'SHA-256',
					salt: encoder.encode('commons-credential-v2'),
					info: encoder.encode(userId)
				},
				hkdfKey,
				{ name: 'AES-GCM', length: 256 },
				false,
				['encrypt', 'decrypt']
			);
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const ciphertext = await crypto.subtle.encrypt(
				{ name: 'AES-GCM', iv },
				userKey,
				encoder.encode(JSON.stringify(address))
			);

			const addressDb = await openDb('commons-address', 1, (db) => {
				if (!db.objectStoreNames.contains('addresses')) {
					db.createObjectStore('addresses', { keyPath: 'userId' });
				}
			});
			const tx = addressDb.transaction('addresses', 'readwrite');
			tx.objectStore('addresses').put({
				userId,
				encrypted: {
					ciphertext: toBase64(ciphertext),
					iv: toBase64(iv.buffer as ArrayBuffer),
					version: 2
				},
				expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
			});
			await transactionDone(tx);
		},
		{ address: CURRENT_ADDRESS, userId }
	);
}

setup('authenticate as test user via dev-login endpoint', async ({ page }) => {
	const devLoginToken = process.env.PLAYWRIGHT_DEV_LOGIN_TOKEN;

	setup.skip(
		!devLoginToken,
		'PLAYWRIGHT_DEV_LOGIN_TOKEN not set — auth-state setup intentionally skipped.'
	);

	const response = await page.context().request.post('/api/internal/dev-login', {
		headers: { 'X-Dev-Login-Token': devLoginToken! },
		data: {
			email: 'regrounding-e2e@example.test',
			principalName: 'E2E Test User'
		}
	});
	expect(response.ok(), 'dev-login endpoint must return 2xx').toBe(true);
	const body = (await response.json()) as { userId: string };
	expect(body.userId, 'dev-login response must include userId').toBeTruthy();

	await page.goto('/profile');
	await expect(page).not.toHaveURL(/\/login/);
	await seedEncryptedAddress(page, body.userId);
	await page.reload();
	await expect(page.getByTestId('ground-i-moved')).toBeVisible();

	await page.context().storageState({ path: STORAGE_STATE_PATH, indexedDB: true });
});
