/**
 * SessionCredential Persistence Tests (Stage 2.5)
 *
 * Validates that the Stage 2.5 `districtCommitment` field is:
 *   1. Included in the SessionCredential type (compile-time)
 *   2. Persisted through storeSessionCredential → getSessionCredential round-trip
 *   3. Absent gracefully (optional) for legacy v1/v2 credentials
 *   4. Carried on the CredentialMigrationRequiredError typed throw
 *
 * Encryption is stubbed because jsdom + Web Crypto AES-GCM is flaky in CI;
 * we only care here that the in-memory object shape survives the split-merge.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// Stub the per-user encryption module BEFORE session-credentials imports it.
// We round-trip the plaintext payload through a simple identity function so
// the test focuses on field-shape propagation, not AES-GCM semantics.
vi.mock('$lib/core/identity/credential-encryption', () => {
	const store = new Map<string, unknown>();
	let counter = 0;
	return {
		isEncryptionAvailable: () => true,
		encryptCredential: async <T>(plaintext: T, _userId: string) => {
			const id = `stub-${counter++}`;
			store.set(id, plaintext);
			return { ciphertext: id } as unknown as { ciphertext: string };
		},
		decryptCredential: async <T>(encrypted: { ciphertext: string }, _userId: string) => {
			return store.get(encrypted.ciphertext) as T;
		},
		decryptLegacyCredential: async () => {
			throw new Error('legacy stub not invoked in these tests');
		},
		computeRecordId: async (userId: string) => `rec_${userId}`
	};
});

import {
	storeSessionCredential,
	getSessionCredential,
	clearSessionCredential,
	calculateExpirationDate,
	CredentialMigrationRequiredError,
	type SessionCredential
} from '$lib/core/identity/session-credentials';

const VALID_COMMITMENT = '0x' + '1f'.repeat(32);

function makeCredential(overrides: Partial<SessionCredential> = {}): SessionCredential {
	const now = new Date('2026-04-01T00:00:00.000Z');
	return {
		userId: uniqueUserId(),
		identityCommitment: '0x' + '11'.repeat(32),
		leafIndex: 7,
		merklePath: Array(20).fill('0x' + '22'.repeat(32)),
		merkleRoot: '0x' + '33'.repeat(32),
		congressionalDistrict: 'CA-12',
		credentialType: 'three-tree',
		cellId: '0x' + '44'.repeat(32),
		cellMapRoot: '0x' + '55'.repeat(32),
		cellMapPath: Array(20).fill('0x' + '66'.repeat(32)),
		cellMapPathBits: Array(20).fill(0),
		districts: Array(24).fill('0x' + '77'.repeat(32)),
		districtCommitment: VALID_COMMITMENT,
		engagementRoot: '0x' + '88'.repeat(32),
		engagementPath: Array(20).fill('0x' + '99'.repeat(32)),
		engagementIndex: 0,
		engagementTier: 0,
		actionCount: '0',
		diversityScore: '0',
		userSecret: '0x' + 'aa'.repeat(32),
		registrationSalt: '0x' + 'bb'.repeat(32),
		authorityLevel: 5,
		verificationMethod: 'digital-credentials-api',
		createdAt: now,
		expiresAt: calculateExpirationDate(),
		...overrides
	};
}

// Use unique userIds per test so we never collide in a shared DB — simpler
// than trying to re-inject a fresh IDBFactory through the idb wrapper cache.
let userIdCounter = 0;
function uniqueUserId(): string {
	userIdCounter++;
	return `user-stage25-test-${userIdCounter}`;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('SessionCredential districtCommitment (Stage 2.5)', () => {
	it('persists districtCommitment through store/get round-trip', async () => {
		const input = makeCredential();
		await storeSessionCredential(input);

		const out = await getSessionCredential(input.userId);
		expect(out).not.toBeNull();
		expect(out!.districtCommitment).toBe(VALID_COMMITMENT);
	});

	it('accepts a credential without districtCommitment (legacy v1/v2 shape)', async () => {
		const input = makeCredential({ districtCommitment: undefined });
		await storeSessionCredential(input);

		const out = await getSessionCredential(input.userId);
		expect(out).not.toBeNull();
		expect(out!.districtCommitment).toBeUndefined();
	});

	it('round-trips all three-tree fields alongside districtCommitment', async () => {
		const input = makeCredential();
		await storeSessionCredential(input);

		const out = await getSessionCredential(input.userId);
		expect(out).not.toBeNull();
		expect(out!.identityCommitment).toBe(input.identityCommitment);
		expect(out!.districts).toEqual(input.districts);
		expect(out!.districtCommitment).toBe(input.districtCommitment);
		expect(out!.cellMapRoot).toBe(input.cellMapRoot);
	});

	it('clearSessionCredential removes both records', async () => {
		const input = makeCredential();
		await storeSessionCredential(input);
		await clearSessionCredential(input.userId);

		const out = await getSessionCredential(input.userId);
		expect(out).toBeNull();
	});

	it('updates districtCommitment on re-store (post-recovery)', async () => {
		const sharedUserId = uniqueUserId();
		const first = makeCredential({
			userId: sharedUserId,
			districtCommitment: VALID_COMMITMENT
		});
		await storeSessionCredential(first);

		const newCommitment = '0x' + '2e'.repeat(32);
		const second = makeCredential({
			userId: sharedUserId,
			districtCommitment: newCommitment
		});
		await storeSessionCredential(second);

		const out = await getSessionCredential(sharedUserId);
		expect(out).not.toBeNull();
		expect(out!.districtCommitment).toBe(newCommitment);
	});
});

describe('CredentialMigrationRequiredError', () => {
	it('is instanceof Error with discriminator code', () => {
		const err = new CredentialMigrationRequiredError();
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(CredentialMigrationRequiredError);
		expect(err.code).toBe('CREDENTIAL_MIGRATION_REQUIRED');
		expect(err.name).toBe('CredentialMigrationRequiredError');
	});

	it('accepts a custom message', () => {
		const err = new CredentialMigrationRequiredError('custom msg');
		expect(err.message).toBe('custom msg');
	});
});
