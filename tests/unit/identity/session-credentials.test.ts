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
	CELL_ANCHOR_MODES,
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
		h3Cell: '872830828ffffff',
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

	it('G7: round-trips h3Cell through extract/merge (regression test)', async () => {
		// G7r CRITICAL finding: extractTreeState + mergeToSessionCredential
		// dropped h3Cell, so every post-G7 credential degraded to pre-G7
		// equivalent on first IndexedDB reload, then failed at delivery.
		// This test exists to ensure h3Cell survives the round-trip.
		const input = makeCredential({ h3Cell: '8a2a1072b59ffff' });
		await storeSessionCredential(input);

		const out = await getSessionCredential(input.userId);
		expect(out).not.toBeNull();
		expect(out!.h3Cell).toBe('8a2a1072b59ffff');
	});

	it('G2: round-trips cellStraddles=true through extract/merge', async () => {
		// Same round-trip discipline as G7 h3Cell. Without this, mark-not-block
		// silently becomes mark-then-forget on the first IndexedDB reload —
		// G3 audit metrics would see uniformly false, G5 receipt UI never
		// surfaces the boundary-cell modifier.
		const input = makeCredential({ cellStraddles: true });
		await storeSessionCredential(input);

		const out = await getSessionCredential(input.userId);
		expect(out).not.toBeNull();
		expect(out!.cellStraddles).toBe(true);
	});

	it('G2: round-trips cellStraddles=false (default) through extract/merge', async () => {
		const input = makeCredential({ cellStraddles: false });
		await storeSessionCredential(input);

		const out = await getSessionCredential(input.userId);
		expect(out).not.toBeNull();
		expect(out!.cellStraddles).toBe(false);
	});

	it('G6: round-trips atlasVersion through extract/merge', async () => {
		// G6 needs the atlasVersion to survive the IndexedDB round-trip so
		// the migration delta check on app load has a comparison baseline.
		const input = makeCredential({ atlasVersion: 'v20260503' });
		await storeSessionCredential(input);

		const out = await getSessionCredential(input.userId);
		expect(out).not.toBeNull();
		expect(out!.atlasVersion).toBe('v20260503');
	});

	it('G8: round-trips cellAnchorMode through extract/merge', async () => {
		// Without round-trip, post-G1 audit cannot answer "what fraction of
		// T3+ registrations used the random-fallback path?" — credentials
		// would be bit-identical between modes after first reload.
		for (const mode of [
			'address-resolved',
			'random-fallback',
			'recovery-explicit',
			'recovery-pivot',
		] as const) {
			const input = makeCredential({ cellAnchorMode: mode });
			await storeSessionCredential(input);

			const out = await getSessionCredential(input.userId);
			expect(out).not.toBeNull();
			expect(out!.cellAnchorMode).toBe(mode);
		}
	});

	it('G8r: backfills legacy-inferred for pre-G8 T5 credentials with h3Cell', async () => {
		// Pre-G8 credential: cellAnchorMode absent, but T5 + h3Cell present
		// is structurally an address-resolved registration. Backfill marks
		// it 'legacy-inferred' so audit metrics can distinguish it from
		// primary writes.
		const input = makeCredential({ cellAnchorMode: undefined, h3Cell: '8a2a1072b59ffff' });
		await storeSessionCredential(input);

		const out = await getSessionCredential(input.userId);
		expect(out).not.toBeNull();
		expect(out!.cellAnchorMode).toBe('legacy-inferred');
	});

	it('G8r: backfills legacy-unknown for pre-G8 credentials without h3Cell', async () => {
		const input = makeCredential({ cellAnchorMode: undefined, h3Cell: undefined });
		await storeSessionCredential(input);

		const out = await getSessionCredential(input.userId);
		expect(out).not.toBeNull();
		expect(out!.cellAnchorMode).toBe('legacy-unknown');
	});

	it('G8r: validator rejects unknown cellAnchorMode values (defends against client garbage)', async () => {
		const { isCellAnchorMode } = await import(
			'$lib/core/identity/session-credentials'
		);
		expect(isCellAnchorMode('address-resolved')).toBe(true);
		expect(isCellAnchorMode('mdl-derived')).toBe(false); // pre-G8r legacy name
		expect(isCellAnchorMode('mdl_derived')).toBe(false); // typo guard
		expect(isCellAnchorMode('recovery-derived')).toBe(false); // split into two
		expect(isCellAnchorMode('')).toBe(false);
		expect(isCellAnchorMode(null)).toBe(false);
		expect(isCellAnchorMode(undefined)).toBe(false);
		expect(isCellAnchorMode(42)).toBe(false);
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

// ============================================================================
// H1r F2 — CELL_ANCHOR_MODES allowlist drift between client and server
// ============================================================================
//
// `convex/users.ts` duplicates the canonical CELL_ANCHOR_MODES list as a hand-
// maintained CELL_ANCHOR_MODES_ALLOWLIST const because Convex functions can't
// import from `src/lib`. If the canonical list grows and the server copy doesn't
// follow, the new value is rejected with INVALID_CELL_ANCHOR_MODE and the audit
// trail goes blind. This test compares the values textually — when it fires,
// update both copies in lockstep.
describe('H1r F2 — CELL_ANCHOR_MODES drift', () => {
	it('canonical CELL_ANCHOR_MODES (src/lib) matches the convex/users.ts allowlist', async () => {
		const fs = await import('node:fs/promises');
		const path = await import('node:path');
		// vitest runs from repo root; convex/users.ts is at <root>/convex/users.ts.
		const usersTsPath = path.resolve(process.cwd(), 'convex/users.ts');
		const usersTs = await fs.readFile(usersTsPath, 'utf8');
		const match = usersTs.match(
			/const CELL_ANCHOR_MODES_ALLOWLIST = \[([\s\S]*?)\] as const;/
		);
		expect(match, 'CELL_ANCHOR_MODES_ALLOWLIST const not found in convex/users.ts').toBeTruthy();
		const serverList = (match![1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)).sort();
		const clientList = [...CELL_ANCHOR_MODES].sort();
		expect(serverList).toEqual(clientList);
	});
});
