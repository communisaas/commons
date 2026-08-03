/**
 * Studio process registry — operator isolation.
 *
 * The org OS kernel caches every authoring loop (reasoning trace, resolved
 * decision-makers, composed message) in localStorage so a refresh does not
 * erase emitted work. That cache is scoped to the authenticated operator, not
 * the org: two staff members of the same org sharing one browser must not be
 * able to read each other's in-flight drafts. These are the cross-operator
 * read assertions.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The persistence layer is gated on `browser`; without this the whole suite
// would pass vacuously by never touching storage at all.
vi.mock('$app/environment', () => ({
	browser: true,
	dev: false,
	building: false,
	version: 'test'
}));

import { createOrgOS } from '$lib/components/org/os/orgOS.svelte';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

function memoryStorage(): Storage {
	const entries = new Map<string, string>();
	return {
		get length() {
			return entries.size;
		},
		clear: () => entries.clear(),
		getItem: (key) => entries.get(key) ?? null,
		key: (index) => [...entries.keys()][index] ?? null,
		removeItem: (key) => entries.delete(key),
		setItem: (key, value) => entries.set(key, String(value))
	};
}

const OWNER_A = 'a'.repeat(16);
const OWNER_B = 'b'.repeat(16);
const BASE = '/org/acme';
const OTHER_BASE = '/org/other';
const A_SUBJECT = 'Confidential ask about the water district settlement';

function intent(subjectLine: string) {
	return {
		subjectLine,
		coreMessage: 'Internal draft body that must not cross operators.',
		audienceGuidance: 'County commissioners'
	};
}

function storageKeys(storage: Storage): string[] {
	return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
		(key): key is string => key !== null
	);
}

describe('studio process registry is scoped to the authenticated operator', () => {
	let storage: Storage;

	beforeEach(() => {
		storage = memoryStorage();
		vi.stubGlobal('localStorage', storage);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('denies a second operator on the same org base any read of the first operator draft', () => {
		const a = createOrgOS('studio', BASE);
		a.setOwner(OWNER_A);
		a.spawnProcess(intent(A_SUBJECT));
		expect(a.processes).toHaveLength(1);

		const b = createOrgOS('studio', BASE);
		b.setOwner(OWNER_B);

		expect(b.processes).toHaveLength(0);
		expect(b.focusedProcess).toBeNull();
		expect(b.focusedProcessId).toBeNull();
	});

	it('keeps the first operator payload only under a key carrying their owner hash', () => {
		const a = createOrgOS('studio', BASE);
		a.setOwner(OWNER_A);
		a.spawnProcess(intent(A_SUBJECT));

		const carriers = storageKeys(storage).filter((key) =>
			(storage.getItem(key) ?? '').includes(A_SUBJECT)
		);
		expect(carriers).toHaveLength(1);
		expect(carriers[0]).toContain(OWNER_A);
		expect(carriers[0]).not.toContain(OWNER_B);

		const underB = storage.getItem(`commons_org_os_processes:${OWNER_B}:${BASE}`);
		expect(underB).toBeNull();
	});

	it('writes nothing at all while no operator is bound', () => {
		const kernel = createOrgOS('studio', BASE);
		kernel.spawnProcess(intent('Draft from an unidentified session'));

		expect(kernel.ownerHash).toBeNull();
		expect(kernel.processes).toHaveLength(1);
		expect(storage.length).toBe(0);
	});

	it('never adopts an unscoped registry left on the device', () => {
		const unscopedKey = `commons_org_os_processes:${BASE}`;
		const seeded = JSON.stringify({
			version: 1,
			savedAt: Date.now(),
			focusedProcessId: 'proc-unscoped',
			processes: [
				{
					id: 'proc-unscoped',
					title: 'Unscoped record',
					intent: intent('Subject from an unscoped record'),
					status: 'composed',
					entries: [],
					decisionMakers: [],
					sources: [],
					composedMessage: 'Body from an unscoped record',
					startedAt: Date.now(),
					endedAt: Date.now()
				}
			]
		});
		storage.setItem(unscopedKey, seeded);

		const kernel = createOrgOS('studio', BASE);
		expect(kernel.processes).toHaveLength(0);

		kernel.setOwner(OWNER_A);
		expect(kernel.processes).toHaveLength(0);
		expect(kernel.focusedProcess).toBeNull();
		// Untouched, not migrated and not purged.
		expect(storage.getItem(unscopedKey)).toBe(seeded);
	});

	it('clears live state and aborts running work when the operator changes', () => {
		const kernel = createOrgOS('studio', BASE);
		kernel.setOwner(OWNER_A);
		const proc = kernel.spawnProcess(intent(A_SUBJECT));

		kernel.setOwner(OWNER_B);

		expect(kernel.processes).toHaveLength(0);
		expect(kernel.focusedProcessId).toBeNull();
		expect(proc.abort?.signal.aborted).toBe(true);
	});

	it('restores the original operator own work when they rebind', () => {
		const kernel = createOrgOS('studio', BASE);
		kernel.setOwner(OWNER_A);
		kernel.spawnProcess(intent(A_SUBJECT));
		kernel.setOwner(OWNER_B);
		expect(kernel.processes).toHaveLength(0);

		kernel.setOwner(OWNER_A);

		expect(kernel.processes).toHaveLength(1);
		expect(kernel.processes[0].intent.subjectLine).toBe(A_SUBJECT);
		expect(kernel.focusedProcess?.intent.subjectLine).toBe(A_SUBJECT);
	});

	it('keeps the org base load-bearing in the key, not the owner hash alone', () => {
		const onAcme = createOrgOS('studio', BASE);
		onAcme.setOwner(OWNER_A);
		onAcme.spawnProcess(intent(A_SUBJECT));

		const onOther = createOrgOS('studio', OTHER_BASE);
		onOther.setOwner(OWNER_A);

		expect(onOther.processes).toHaveLength(0);
		expect(onOther.focusedProcess).toBeNull();
	});

	it('is inert when rebound to the same operator, so navigation cannot kill a running loop', () => {
		const kernel = createOrgOS('studio', BASE);
		kernel.setOwner(OWNER_A);
		const proc = kernel.spawnProcess(intent(A_SUBJECT));

		kernel.setOwner(OWNER_A);

		expect(kernel.processes).toHaveLength(1);
		expect(kernel.focusedProcessId).toBe(proc.id);
		expect(proc.abort?.signal.aborted).toBe(false);
	});
});

describe('the org layout binds the kernel to the signed-in operator', () => {
	const layout = src('src/routes/org/[slug]/+layout.svelte');

	it('derives the owner hash from the shared helper and binds it', () => {
		expect(layout).toContain('deriveOwnerHash');
		expect(layout).toContain('os.setOwner(');
		expect(layout).toContain('os.setOwner(null)');
		expect(layout).toContain('cancelled');
	});
});
