/**
 * A guest's raw postal address must never come to rest in web storage.
 *
 * A shared browser is not infrastructure we control, and a guest has no owner
 * hash by construction, so owner-keying cannot bound the blast radius. The only
 * honest bound is residency: the address lives in memory for the page that
 * collected it and nowhere else.
 *
 * These assertions read the storage envelope directly rather than through the
 * store's getters — the persisted blob is the trust boundary, and a test that
 * only round-trips the store API would certify a guard that never runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({
	browser: true,
	building: false,
	dev: true,
	version: 'test'
}));

const GUEST_STATE_KEY = 'commons_guest_template';
const RAW_ADDRESS = '742 Evergreen Terrace, Springfield, IL 62704';
const ADDRESS_FRAGMENTS = [RAW_ADDRESS, '742 Evergreen Terrace', 'Springfield', '62704'];
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

function memoryStorage(): Storage {
	const entries = new Map<string, string>();
	return {
		get length() {
			return entries.size;
		},
		clear: () => entries.clear(),
		getItem: (key: string) => entries.get(key) ?? null,
		key: (index: number) => [...entries.keys()][index] ?? null,
		removeItem: (key: string) => entries.delete(key),
		setItem: (key: string, value: string) => entries.set(key, String(value))
	} as Storage;
}

/** Every key and value a storage area holds, flattened for substring scanning. */
function dump(storage: Storage): string {
	const chunks: string[] = [];
	for (let index = 0; index < storage.length; index++) {
		const key = storage.key(index);
		if (key === null) continue;
		chunks.push(key, storage.getItem(key) ?? '');
	}
	return chunks.join('\n');
}

function expectNoAddressAnywhere(): void {
	const localDump = dump(localStorage);
	const sessionDump = dump(sessionStorage);
	for (const fragment of ADDRESS_FRAGMENTS) {
		expect(localDump).not.toContain(fragment);
		expect(sessionDump).not.toContain(fragment);
	}
}

async function loadGuestState() {
	vi.resetModules();
	const module = await import('$lib/stores/guestState.svelte');
	return module.guestState;
}

describe('guest address residency', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', memoryStorage());
		vi.stubGlobal('sessionStorage', memoryStorage());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('keeps a raw address out of the persisted envelope while the session still sees it', async () => {
		const guestState = await loadGuestState();

		guestState.setTemplate('climate-action', 'Climate Action', 'share');
		guestState.setAddress(RAW_ADDRESS);

		const raw = localStorage.getItem(GUEST_STATE_KEY);
		expect(raw).not.toBeNull();
		for (const fragment of ADDRESS_FRAGMENTS) {
			expect(raw).not.toContain(fragment);
		}
		expectNoAddressAnywhere();

		const envelope = JSON.parse(raw as string) as Record<string, unknown>;
		expect('address' in envelope).toBe(false);
		expect(Object.keys(envelope)).not.toContain('address');
		expect(envelope.templateSlug).toBe('climate-action');

		// The address-backed flow is unchanged for the life of the page: the
		// collected address is still readable in memory by the ZKP consumers.
		expect(guestState.state?.address).toBe(RAW_ADDRESS);
		expect(guestState.state?.templateSlug).toBe('climate-action');
	});

	it('discards an envelope written by an earlier build that carried a raw address', async () => {
		localStorage.setItem(
			GUEST_STATE_KEY,
			JSON.stringify({
				templateSlug: 'climate-action',
				templateTitle: 'Climate Action',
				source: 'share',
				timestamp: Date.now(),
				viewCount: 1,
				address: RAW_ADDRESS
			})
		);

		// Importing the module runs the real restore path.
		const guestState = await loadGuestState();

		expect(localStorage.getItem(GUEST_STATE_KEY)).toBeNull();
		expect(guestState.state).toBeNull();
		expectNoAddressAnywhere();
	});

	it('drops the persisted envelope once it is past its residency bound', async () => {
		const guestState = await loadGuestState();
		guestState.setTemplate('climate-action', 'Climate Action');

		const envelope = JSON.parse(localStorage.getItem(GUEST_STATE_KEY) as string) as Record<
			string,
			number
		>;
		expect(typeof envelope.expiresAt).toBe('number');
		expect(envelope.expiresAt).toBeGreaterThan(envelope.timestamp);

		localStorage.setItem(
			GUEST_STATE_KEY,
			JSON.stringify({
				...envelope,
				timestamp: Date.now() - EIGHT_DAYS_MS,
				expiresAt: Date.now() - 1
			})
		);
		guestState.restore();

		expect(localStorage.getItem(GUEST_STATE_KEY)).toBeNull();
		expect(guestState.state).toBeNull();
	});

	it('clears the envelope and the in-memory address together', async () => {
		const guestState = await loadGuestState();

		guestState.setTemplate('climate-action', 'Climate Action');
		guestState.setAddress(RAW_ADDRESS);
		guestState.clear();

		expect(localStorage.getItem(GUEST_STATE_KEY)).toBeNull();
		expect(guestState.state).toBeNull();
		expectNoAddressAnywhere();
	});
});
