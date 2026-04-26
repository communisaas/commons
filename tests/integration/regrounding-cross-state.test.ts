/**
 * Stage 4a — Cross-state re-grounding E2E simulation.
 *
 * Simulates a user verified at OR-03 re-verifying to WA-07 and asserts the
 * full state transition closes the structural invariants:
 *
 *   1. Prior credential row transitions to revokedAt=now (non-null)
 *   2. Prior credential's revocationStatus flips to 'pending' (because it
 *      carried a districtCommitment — Stage 5 F1 closure)
 *   3. A new credential row is inserted with the NEW districtCommitment
 *   4. The user's districtHash is replaced
 *   5. getActiveCredentialDistrictCommitment returns the NEW commitment
 *   6. isCredentialActive on the OLD credentialId returns {active:false, reason:'revoked'}
 *   7. isCredentialActive on the NEW credentialId returns {active:true}
 *
 * Pattern note: we use an in-memory mock of the Convex runtime (matching the
 * pattern already established by tests/integration/revocation-flow.test.ts)
 * rather than a live Convex dev server. The verifyAddress / isCredentialActive /
 * getActiveCredentialDistrictCommitment logic is mirrored here with the same
 * ordering discipline as convex/users.ts and convex/submissions.ts. The point
 * of this test is the state-transition sequence — not the Convex transport.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Domain types mirrored from convex/schema.ts ─────────────────────────────
type RevocationStatus = 'pending' | 'confirmed' | 'failed';

interface CredentialRow {
	_id: string;
	_creationTime: number;
	userId: string;
	credentialType: 'district_residency';
	congressionalDistrict: string;
	verificationMethod: 'shadow_atlas' | 'civic_api' | 'postal';
	issuedAt: number;
	expiresAt: number;
	credentialHash: string;
	districtCommitment?: string;
	slotCount?: number;
	revokedAt?: number;
	revocationStatus?: RevocationStatus;
	revocationAttempts?: number;
	revocationLastAttemptAt?: number;
}

interface UserRow {
	_id: string;
	tokenIdentifier: string;
	trustTier: number;
	emailHash?: string;
	districtVerified?: boolean;
	districtHash?: string;
	addressVerifiedAt?: number;
	verificationMethod?: string;
	isVerified?: boolean;
	_creationTime: number;
}

// ── Mirrored from convex/users.ts constants ─────────────────────────────────
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ONE_EIGHTY_DAYS_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_REVERIFICATIONS_PER_180D = 6;
const CREDENTIAL_TTL_TIER2_MS = 90 * 24 * 60 * 60 * 1000; // TIER_CREDENTIAL_TTL[2]

class MockConvex {
	public users = new Map<string, UserRow>();
	public credentials = new Map<string, CredentialRow>();
	public scheduledEmits: Array<{ credentialId: string; delayMs: number }> = [];
	private nextCredId = 1;
	// Monotonic counter mirroring Convex's `_creationTime` semantics — one per
	// document insert, strictly increasing. Used by selectActiveCredential as
	// deterministic tiebreak when two rows share the same issuedAt ms.
	private nextCreationTime = 1;

	// Mirrors convex/users.ts verifyAddress logic (lines 363–584). The throttle
	// branch is scoped by trustTier<3; tier-3+ bypass lives here intentionally.
	verifyAddress(args: {
		userId: string;
		district: string;
		verificationMethod: 'shadow_atlas' | 'civic_api' | 'postal';
		credentialHash: string;
		districtCommitment: string;
		districtHash: string;
		expiresAt: number;
		now: number;
	}): { newCredentialId: string; revokedCredentialIds: string[] } {
		const user = this.users.get(args.userId);
		if (!user) throw new Error('User not found');
		const now = args.now;

		const existing = Array.from(this.credentials.values()).filter(
			(c) => c.userId === args.userId
		);

		// Throttle gate — identical shape to convex/users.ts:405-432
		if (user.trustTier < 3) {
			const within24h = existing.filter((c) => now - c.issuedAt < TWENTY_FOUR_HOURS_MS);
			if (within24h.length >= 1) {
				throw new Error('ADDRESS_VERIFICATION_THROTTLED_24H');
			}
			const within180d = existing.filter((c) => now - c.issuedAt < ONE_EIGHTY_DAYS_MS);
			if (within180d.length >= MAX_REVERIFICATIONS_PER_180D) {
				throw new Error('ADDRESS_VERIFICATION_THROTTLED_180D');
			}
		}

		// Revoke all prior unexpired credentials. Schedule on-chain emit only for
		// rows with districtCommitment (matches convex/users.ts:443-463).
		const revokedIds: string[] = [];
		for (const cred of existing) {
			if (!cred.revokedAt) {
				cred.revokedAt = now;
				if (cred.districtCommitment) {
					cred.revocationStatus = 'pending';
					cred.revocationAttempts = 0;
					cred.revocationLastAttemptAt = now;
					this.scheduledEmits.push({ credentialId: cred._id, delayMs: 0 });
				}
				revokedIds.push(cred._id);
			}
		}

		// Insert new credential row.
		const newId = `cred_${this.nextCredId++}`;
		this.credentials.set(newId, {
			_id: newId,
			_creationTime: this.nextCreationTime++,
			userId: args.userId,
			credentialType: 'district_residency',
			congressionalDistrict: args.district,
			verificationMethod: args.verificationMethod,
			issuedAt: now,
			expiresAt: args.expiresAt,
			credentialHash: args.credentialHash,
			districtCommitment: args.districtCommitment,
		});

		// Patch the user row (mirrors convex/users.ts:480-494).
		user.trustTier = Math.max(user.trustTier, 2);
		user.districtVerified = true;
		user.addressVerifiedAt = now;
		user.verificationMethod = args.verificationMethod;
		user.isVerified = true;
		user.districtHash = args.districtHash;

		return { newCredentialId: newId, revokedCredentialIds: revokedIds };
	}

	// Mirrors convex/submissions.ts isCredentialActive (lines 245-254).
	isCredentialActive(credentialId: string, now: number): { active: boolean; reason?: string } {
		const cred = this.credentials.get(credentialId);
		if (!cred) return { active: false, reason: 'not_found' };
		if (cred.revokedAt) return { active: false, reason: 'revoked' };
		if (cred.expiresAt < now) return { active: false, reason: 'expired' };
		return { active: true };
	}

	// Mirrors convex/_credentialSelect.ts selectActiveCredentialForUser.
	// Both hasActiveDistrictCredential and getActiveCredentialDistrictCommitment
	// route through this — KG-4 invariant: same row, both call sites, always.
	selectActiveCredential(userId: string, now: number): CredentialRow | null {
		const active = Array.from(this.credentials.values()).filter(
			(c) => c.userId === userId && !c.revokedAt && c.expiresAt > now
		);
		if (active.length === 0) return null;
		active.sort(
			(a, b) => b.issuedAt - a.issuedAt || b._creationTime - a._creationTime
		);
		return active[0];
	}

	// Mirrors convex/users.ts getActiveCredentialDistrictCommitment.
	getActiveCredentialDistrictCommitment(
		userId: string,
		now: number
	): { districtCommitment: string } | null {
		const active = this.selectActiveCredential(userId, now);
		if (!active || !active.districtCommitment) return null;
		return { districtCommitment: active.districtCommitment };
	}
}

describe('Stage 4a — Cross-state re-grounding (OR-03 → WA-07)', () => {
	let convex: MockConvex;
	const USER_ID = 'user_portland_to_seattle';
	// The key invariant: each credential issue carries a NEW commitment. The
	// exact bytes don't matter for this test — what matters is that the pre-
	// and post-move commitments differ, and the server-canonical resolver
	// surfaces the NEW one after verifyAddress.
	const OLD_COMMITMENT = '0x' + 'a'.repeat(64); // OR-03 slots
	const NEW_COMMITMENT = '0x' + 'b'.repeat(64); // WA-07 slots
	const OLD_HASH = '0xhash_old_or03';
	const NEW_HASH = '0xhash_new_wa07';
	const OLD_DISTRICT_HASH = 'h_or03';
	const NEW_DISTRICT_HASH = 'h_wa07';

	let initialIssuedAt: number;
	let oldCredentialId: string;

	beforeEach(() => {
		convex = new MockConvex();
		// Seed: a tier-2 verified user currently attested at OR-03. The original
		// issuance must be >24h ago so the throttle doesn't trip (this test is
		// scoped to state-transition semantics, not throttle — that's in the
		// attack-sim file).
		initialIssuedAt = 1_700_000_000_000;
		convex.users.set(USER_ID, {
			_id: USER_ID,
			tokenIdentifier: 'token_' + USER_ID,
			trustTier: 2,
			emailHash: 'email_alice',
			_creationTime: initialIssuedAt - ONE_EIGHTY_DAYS_MS, // account age > 180d
		});
		// Manually seed the old credential (pretending verifyAddress ran earlier).
		oldCredentialId = 'cred_seed_or03';
		convex.credentials.set(oldCredentialId, {
			_id: oldCredentialId,
			_creationTime: initialIssuedAt,
			userId: USER_ID,
			credentialType: 'district_residency',
			congressionalDistrict: 'OR-03',
			verificationMethod: 'shadow_atlas',
			issuedAt: initialIssuedAt,
			expiresAt: initialIssuedAt + CREDENTIAL_TTL_TIER2_MS,
			credentialHash: OLD_HASH,
			districtCommitment: OLD_COMMITMENT,
		});
		// Reflect seed on user row so districtHash diff can be asserted.
		const u = convex.users.get(USER_ID)!;
		u.districtHash = OLD_DISTRICT_HASH;
		u.districtVerified = true;
	});

	it('revokes the OR-03 credential and issues a new WA-07 credential', () => {
		const now = initialIssuedAt + TWENTY_FOUR_HOURS_MS + 60_000; // past throttle
		const { newCredentialId, revokedCredentialIds } = convex.verifyAddress({
			userId: USER_ID,
			district: 'WA-07',
			verificationMethod: 'shadow_atlas',
			credentialHash: NEW_HASH,
			districtCommitment: NEW_COMMITMENT,
			districtHash: NEW_DISTRICT_HASH,
			expiresAt: now + CREDENTIAL_TTL_TIER2_MS,
			now,
		});

		// Assertion 1: exactly the old OR-03 credential was revoked.
		expect(revokedCredentialIds).toEqual([oldCredentialId]);

		// Assertion 2: OR-03 row has revokedAt + revocationStatus='pending'.
		// Stage 5: commitment-bearing credentials also enqueue the on-chain emit.
		const oldCred = convex.credentials.get(oldCredentialId)!;
		expect(oldCred.revokedAt).toBe(now);
		expect(oldCred.revocationStatus).toBe('pending');
		expect(oldCred.revocationAttempts).toBe(0);
		expect(convex.scheduledEmits).toHaveLength(1);
		expect(convex.scheduledEmits[0].credentialId).toBe(oldCredentialId);

		// Assertion 3: new WA-07 credential carries the new districtCommitment
		// and has no revokedAt. This is the Stage 2.5 invariant — the new
		// SessionCredential the client stores derives from this row.
		const newCred = convex.credentials.get(newCredentialId)!;
		expect(newCred).toBeDefined();
		expect(newCred.congressionalDistrict).toBe('WA-07');
		expect(newCred.districtCommitment).toBe(NEW_COMMITMENT);
		expect(newCred.credentialHash).toBe(NEW_HASH);
		expect(newCred.revokedAt).toBeUndefined();
		expect(newCred.revocationStatus).toBeUndefined();
	});

	it('updates the user districtHash and verification timestamps', () => {
		const now = initialIssuedAt + TWENTY_FOUR_HOURS_MS + 60_000;
		convex.verifyAddress({
			userId: USER_ID,
			district: 'WA-07',
			verificationMethod: 'shadow_atlas',
			credentialHash: NEW_HASH,
			districtCommitment: NEW_COMMITMENT,
			districtHash: NEW_DISTRICT_HASH,
			expiresAt: now + CREDENTIAL_TTL_TIER2_MS,
			now,
		});

		const u = convex.users.get(USER_ID)!;
		expect(u.districtHash).toBe(NEW_DISTRICT_HASH);
		expect(u.districtHash).not.toBe(OLD_DISTRICT_HASH);
		expect(u.addressVerifiedAt).toBe(now);
		expect(u.isVerified).toBe(true);
		expect(u.verificationMethod).toBe('shadow_atlas');
		// trustTier is Math.max-ed — a tier-4 user staying tier-4 would be fine,
		// a tier-2 user stays tier-2. We seeded tier-2, so it remains 2.
		expect(u.trustTier).toBe(2);
	});

	it('getActiveCredentialDistrictCommitment returns the NEW commitment (not OLD)', () => {
		const now = initialIssuedAt + TWENTY_FOUR_HOURS_MS + 60_000;
		// Before: OLD commitment is active.
		expect(convex.getActiveCredentialDistrictCommitment(USER_ID, now)).toEqual({
			districtCommitment: OLD_COMMITMENT,
		});

		convex.verifyAddress({
			userId: USER_ID,
			district: 'WA-07',
			verificationMethod: 'shadow_atlas',
			credentialHash: NEW_HASH,
			districtCommitment: NEW_COMMITMENT,
			districtHash: NEW_DISTRICT_HASH,
			expiresAt: now + CREDENTIAL_TTL_TIER2_MS,
			now,
		});

		// After: NEW commitment is active. Critical for Stage 2.5 — the server
		// canonical recompute at submissions/create sources from this query.
		const active = convex.getActiveCredentialDistrictCommitment(USER_ID, now);
		expect(active).toEqual({ districtCommitment: NEW_COMMITMENT });
	});

	it('isCredentialActive: OLD credential rejected with reason=revoked; NEW accepted', () => {
		const now = initialIssuedAt + TWENTY_FOUR_HOURS_MS + 60_000;
		const { newCredentialId } = convex.verifyAddress({
			userId: USER_ID,
			district: 'WA-07',
			verificationMethod: 'shadow_atlas',
			credentialHash: NEW_HASH,
			districtCommitment: NEW_COMMITMENT,
			districtHash: NEW_DISTRICT_HASH,
			expiresAt: now + CREDENTIAL_TTL_TIER2_MS,
			now,
		});

		// This is the (1f) gate surface — the recheck deliverToCongress runs.
		// Old credential MUST be rejected; delivery error 'credential_revoked'
		// is the F1 closure.
		const oldStatus = convex.isCredentialActive(oldCredentialId, now);
		expect(oldStatus.active).toBe(false);
		expect(oldStatus.reason).toBe('revoked');

		const newStatus = convex.isCredentialActive(newCredentialId, now);
		expect(newStatus.active).toBe(true);
		expect(newStatus.reason).toBeUndefined();
	});

	it('credential without a prior districtCommitment does not schedule on-chain emit', () => {
		// Replace the seeded old credential with a legacy (pre-Stage-5) row that
		// has no commitment. Per convex/users.ts:447-461 this path must NOT set
		// revocationStatus — legacy rows are gated solely at the Stage 1 server
		// layer, never reach the circuit, no revocation_nullifier to emit.
		convex.credentials.delete(oldCredentialId);
		convex.credentials.set(oldCredentialId, {
			_id: oldCredentialId,
			_creationTime: initialIssuedAt,
			userId: USER_ID,
			credentialType: 'district_residency',
			congressionalDistrict: 'OR-03',
			verificationMethod: 'civic_api',
			issuedAt: initialIssuedAt,
			expiresAt: initialIssuedAt + CREDENTIAL_TTL_TIER2_MS,
			credentialHash: OLD_HASH,
			// districtCommitment OMITTED — legacy
		});
		convex.scheduledEmits = [];

		const now = initialIssuedAt + TWENTY_FOUR_HOURS_MS + 60_000;
		convex.verifyAddress({
			userId: USER_ID,
			district: 'WA-07',
			verificationMethod: 'shadow_atlas',
			credentialHash: NEW_HASH,
			districtCommitment: NEW_COMMITMENT,
			districtHash: NEW_DISTRICT_HASH,
			expiresAt: now + CREDENTIAL_TTL_TIER2_MS,
			now,
		});

		const legacyCred = convex.credentials.get(oldCredentialId)!;
		expect(legacyCred.revokedAt).toBe(now);
		expect(legacyCred.revocationStatus).toBeUndefined();
		expect(convex.scheduledEmits).toHaveLength(0);
	});

	it('cross-state round trip: re-verification chain produces monotonic commitment history', () => {
		// Simulate OR-03 → WA-07 → WA-09 to confirm each re-ground revokes the
		// immediately prior row, not just the original. This exercises the
		// Stage 1 invariant: verifyAddress revokes ALL unrevoked rows, not just
		// the first one it finds.
		let now = initialIssuedAt + TWENTY_FOUR_HOURS_MS + 60_000;
		const { newCredentialId: wa07Id } = convex.verifyAddress({
			userId: USER_ID,
			district: 'WA-07',
			verificationMethod: 'shadow_atlas',
			credentialHash: NEW_HASH,
			districtCommitment: NEW_COMMITMENT,
			districtHash: NEW_DISTRICT_HASH,
			expiresAt: now + CREDENTIAL_TTL_TIER2_MS,
			now,
		});

		now += TWENTY_FOUR_HOURS_MS + 60_000; // advance past 24h throttle
		const THIRD_COMMITMENT = '0x' + 'c'.repeat(64);
		const { newCredentialId: wa09Id } = convex.verifyAddress({
			userId: USER_ID,
			district: 'WA-09',
			verificationMethod: 'shadow_atlas',
			credentialHash: '0xhash_wa09',
			districtCommitment: THIRD_COMMITMENT,
			districtHash: 'h_wa09',
			expiresAt: now + CREDENTIAL_TTL_TIER2_MS,
			now,
		});

		// All prior rows MUST be revoked.
		expect(convex.credentials.get(oldCredentialId)!.revokedAt).toBeTruthy();
		expect(convex.credentials.get(wa07Id)!.revokedAt).toBeTruthy();
		// Only the latest remains active.
		expect(convex.credentials.get(wa09Id)!.revokedAt).toBeUndefined();
		// Active commitment = third.
		expect(convex.getActiveCredentialDistrictCommitment(USER_ID, now)).toEqual({
			districtCommitment: THIRD_COMMITMENT,
		});
	});
});
