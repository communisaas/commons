/**
 * Stage 4b — Attack simulation suite for the re-grounding work.
 *
 * Exercises the three attack classes the work was scoped to close:
 *
 *   F1 (stale-proof replay)       — credential revoked server-side but a stale
 *                                   client tries to use the revoked credentialId.
 *                                   Covered at two surfaces:
 *                                     (i)  submission insert path rejects on
 *                                          hasActiveDistrictCredential
 *                                     (ii) delivery dispatch rejects on
 *                                          isCredentialActive (TOCTOU window)
 *                                     (iii) TEE witness-to-commitment binding
 *                                          (Stage 2.7) rejects
 *                                          witness_commitment_mismatch when the
 *                                          witness names different districts
 *                                          than the server-canonical commitment.
 *
 *   F2 (district-hop amplification) — rapid re-verification from same userId OR
 *                                   distinct userIds sharing an emailHash.
 *                                   Covered: 24h throttle, 180d throttle,
 *                                   email-sybil gate, tier-3 bypass.
 *
 *   F3 (snapshot-boundary)         — quarterly anchor boundary; documented as
 *                                   an invariant assertion (convex-test cannot
 *                                   simulate time-travel across anchors).
 *
 * Pattern: in-memory Convex mock matching tests/integration/revocation-flow.test.ts,
 * plus a direct integration against src/lib/server/tee/resolver-gates.ts for the
 * witness-commitment path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
// FU-1.2 (Wave 7) — MockConvex now imports the production guard helper
// instead of reimplementing it inline. Eliminates the drift surface where
// the inline copy could diverge from `convex/users.ts:438`.
import { applyDowngradeGuard } from '../../convex/_downgradeGuard';

// ─────────────────────────────────────────────────────────────────────────────
// Mock poseidon for the TEE gate witness-binding path (Stage 2.7). We use the
// same deterministic FNV-style fold as tests/unit/tee/resolver-gates.test.ts so
// this file's mock behaves identically to the canonical gate tests.
// ─────────────────────────────────────────────────────────────────────────────
const { mockResolveAddress, mockVerifyProof, mockGetThreeTreeProverForDepth, mockPoseidonSponge24 } = vi.hoisted(() => ({
	mockResolveAddress: vi.fn(),
	mockVerifyProof: vi.fn().mockResolvedValue(true),
	mockGetThreeTreeProverForDepth: vi.fn(),
	mockPoseidonSponge24: vi.fn(async (districts: string[]) => {
		const combined = districts.join('|');
		let hash = 0n;
		for (let i = 0; i < combined.length; i++) {
			hash = (hash * 131n + BigInt(combined.charCodeAt(i))) & ((1n << 256n) - 1n);
		}
		return '0x' + hash.toString(16).padStart(64, '0');
	})
}));

vi.mock('$lib/core/shadow-atlas/client', () => ({
	resolveAddress: (...args: unknown[]) => mockResolveAddress(...args)
}));
vi.mock('$lib/core/crypto/noir-prover-shim', () => ({
	getThreeTreeProverForDepth: (...args: unknown[]) => mockGetThreeTreeProverForDepth(...args)
}));
vi.mock('$lib/core/crypto/poseidon', () => ({
	poseidon2Sponge24: (districts: string[]) => mockPoseidonSponge24(districts)
}));

import { verifyProofGate } from '$lib/server/tee/resolver-gates';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory Convex mock mirroring the verifyAddress throttle/sybil branches.
// Source of truth: convex/users.ts:357-432.
// ─────────────────────────────────────────────────────────────────────────────

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ONE_EIGHTY_DAYS_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_REVERIFICATIONS_PER_180D = 6;
const MAX_USERIDS_PER_EMAIL_HASH_180D = 3;
const CREDENTIAL_TTL_TIER2_MS = 90 * 24 * 60 * 60 * 1000;

interface UserRow {
	_id: string;
	tokenIdentifier: string;
	trustTier: number;
	emailHash?: string;
	_creationTime: number;
}

interface CredentialRow {
	_id: string;
	userId: string;
	issuedAt: number;
	expiresAt: number;
	revokedAt?: number;
	districtCommitment?: string;
	credentialHash: string;
}

interface SubmissionRow {
	_id: string;
	userId: string;
	issuingCredentialId: string;
	deliveryStatus: 'pending' | 'processing' | 'failed' | 'delivered';
	deliveryError?: string;
}

class MockConvex {
	public users = new Map<string, UserRow>();
	public credentials = new Map<string, CredentialRow>();
	public submissions = new Map<string, SubmissionRow>();
	private nextCredId = 1;
	private nextSubId = 1;

	// Mirrors convex/users.ts:363-432 — the throttle + sybil gate + downgrade
	// guard (Wave 1b). The issuing logic after that is covered by
	// tests/integration/regrounding-cross-state. `districtCommitment` is
	// optional to let tests simulate the "client-side Poseidon failed, proceeds
	// without commitment" scenario that the downgrade guard must reject.
	verifyAddress(
		userId: string,
		now: number,
		opts: { districtCommitment?: string } = {}
	): { credentialId: string } {
		const user = this.users.get(userId);
		if (!user) throw new Error('User not found');

		const existing = Array.from(this.credentials.values()).filter((c) => c.userId === userId);

		// (Wave 1b / Wave 7 FU-1.2) Commitment-downgrade guard via the
		// production helper. The mock auto-generates a default commitment for
		// convenience; an explicit empty string opts into "no commitment"
		// (simulating the silent-catch path the guard exists to reject).
		const incomingCommitment =
			opts.districtCommitment ?? '0x' + String(this.nextCredId).padStart(64, '0');
		const effectiveCommitment =
			opts.districtCommitment === '' ? undefined : incomingCommitment;
		const guardResult = applyDowngradeGuard(existing, effectiveCommitment);
		if (guardResult !== null) {
			throw new Error(guardResult);
		}

		if (user.trustTier < 3) {
			const within24h = existing.filter((c) => now - c.issuedAt < TWENTY_FOUR_HOURS_MS);
			if (within24h.length >= 1) {
				throw new Error('ADDRESS_VERIFICATION_THROTTLED_24H');
			}
			const within180d = existing.filter((c) => now - c.issuedAt < ONE_EIGHTY_DAYS_MS);
			if (within180d.length >= MAX_REVERIFICATIONS_PER_180D) {
				throw new Error('ADDRESS_VERIFICATION_THROTTLED_180D');
			}
			if (user.emailHash) {
				const siblingUsers = Array.from(this.users.values()).filter(
					(u) => u.emailHash === user.emailHash
				);
				const recentSiblings = siblingUsers.filter(
					(u) => now - u._creationTime < ONE_EIGHTY_DAYS_MS
				);
				if (recentSiblings.length > MAX_USERIDS_PER_EMAIL_HASH_180D) {
					throw new Error('ADDRESS_VERIFICATION_EMAIL_SYBIL');
				}
			}
		}

		// Revoke prior, issue new.
		for (const cred of existing) {
			if (!cred.revokedAt) cred.revokedAt = now;
		}
		const id = `cred_${this.nextCredId++}`;
		this.credentials.set(id, {
			_id: id,
			userId,
			issuedAt: now,
			expiresAt: now + CREDENTIAL_TTL_TIER2_MS,
			districtCommitment: effectiveCommitment,
			credentialHash: '0xhash_' + id,
		});
		return { credentialId: id };
	}

	// Mirrors convex/submissions.ts:210-235. F1 gate at submission-insert.
	hasActiveDistrictCredential(
		tokenIdentifier: string,
		now: number
	): { active: boolean; reason?: string; credentialId?: string } {
		const user = Array.from(this.users.values()).find(
			(u) => u.tokenIdentifier === tokenIdentifier
		);
		if (!user) return { active: false, reason: 'user_not_found' };
		const credentials = Array.from(this.credentials.values()).filter(
			(c) => c.userId === user._id
		);
		const active = credentials.find((c) => !c.revokedAt && c.expiresAt > now);
		if (!active) return { active: false, reason: 'revoked_or_expired' };
		return { active: true, credentialId: active._id };
	}

	// Mirrors convex/submissions.ts:245-254. F1 TOCTOU close at delivery.
	isCredentialActive(
		credentialId: string,
		now: number
	): { active: boolean; reason?: string } {
		const cred = this.credentials.get(credentialId);
		if (!cred) return { active: false, reason: 'not_found' };
		if (cred.revokedAt) return { active: false, reason: 'revoked' };
		if (cred.expiresAt < now) return { active: false, reason: 'expired' };
		return { active: true };
	}

	// Mirrors the submission-insert path's credential gate (convex/submissions.ts:51-63).
	// Throws NO_ACTIVE_DISTRICT_CREDENTIAL when the gate fails — same shape as
	// submissions/create action.
	insertSubmission(
		tokenIdentifier: string,
		issuingCredentialId: string,
		now: number
	): { submissionId: string } {
		const gate = this.hasActiveDistrictCredential(tokenIdentifier, now);
		if (!gate.active) throw new Error('NO_ACTIVE_DISTRICT_CREDENTIAL');
		const id = `sub_${this.nextSubId++}`;
		this.submissions.set(id, {
			_id: id,
			userId: gate.credentialId!.replace(/^cred_/, 'user_'),
			issuingCredentialId,
			deliveryStatus: 'pending',
		});
		return { submissionId: id };
	}

	// Mirrors convex/submissions.ts:967-992 credential_revoked_or_expired branch.
	// Returns deliveryError shape that would be persisted to the row.
	deliverToCongress(submissionId: string, now: number): { deliveryError?: string; delivered: boolean } {
		const sub = this.submissions.get(submissionId);
		if (!sub) return { delivered: false, deliveryError: 'not_found' };
		const status = this.isCredentialActive(sub.issuingCredentialId, now);
		if (!status.active) {
			const err = `credential_${status.reason}`;
			sub.deliveryStatus = 'failed';
			sub.deliveryError = err;
			return { delivered: false, deliveryError: err };
		}
		sub.deliveryStatus = 'delivered';
		return { delivered: true };
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// F1 — Stale-proof replay
// ═════════════════════════════════════════════════════════════════════════════

describe('F1 — stale-proof replay is blocked at two server surfaces', () => {
	let convex: MockConvex;
	const USER_ID = 'user_f1';
	const TOKEN_ID = 'token_f1';

	beforeEach(() => {
		convex = new MockConvex();
		convex.users.set(USER_ID, {
			_id: USER_ID,
			tokenIdentifier: TOKEN_ID,
			trustTier: 2,
			emailHash: 'email_f1',
			_creationTime: 1_000_000,
		});
	});

	it('(i) submission-insert rejects NO_ACTIVE_DISTRICT_CREDENTIAL after revocation', () => {
		const t0 = 2_000_000;
		// Initial issue.
		const { credentialId } = convex.verifyAddress(USER_ID, t0);
		// Revoke the credential manually (simulates background revocation).
		const cred = convex.credentials.get(credentialId)!;
		cred.revokedAt = t0 + 1000;

		// Client retries a submission against the stale credential.
		expect(() =>
			convex.insertSubmission(TOKEN_ID, credentialId, t0 + 2000)
		).toThrow('NO_ACTIVE_DISTRICT_CREDENTIAL');
	});

	it('(ii) deliverToCongress rejects credential_revoked at the TOCTOU window', () => {
		const t0 = 3_000_000;
		const { credentialId } = convex.verifyAddress(USER_ID, t0);
		// Submission accepted while credential still active.
		const { submissionId } = convex.insertSubmission(TOKEN_ID, credentialId, t0 + 100);
		// Revocation fires between submission and delivery (classic TOCTOU).
		convex.credentials.get(credentialId)!.revokedAt = t0 + 200;
		// Delivery recheck catches it.
		const result = convex.deliverToCongress(submissionId, t0 + 300);
		expect(result.delivered).toBe(false);
		expect(result.deliveryError).toBe('credential_revoked');
	});

	it('(ii) deliverToCongress rejects credential_expired when credential rolls over TTL', () => {
		const t0 = 4_000_000;
		const { credentialId } = convex.verifyAddress(USER_ID, t0);
		const { submissionId } = convex.insertSubmission(TOKEN_ID, credentialId, t0 + 100);
		// Fast-forward past expiresAt.
		const afterExpiry = t0 + CREDENTIAL_TTL_TIER2_MS + 1_000;
		const result = convex.deliverToCongress(submissionId, afterExpiry);
		expect(result.delivered).toBe(false);
		expect(result.deliveryError).toBe('credential_expired');
	});

	it('(iii) TEE witness-to-commitment binding rejects mismatched witness.districts', async () => {
		// Stage 2.7: a prover with a leaked credentialHash who forges a proof
		// with *different* districts than the server-canonical commitment must
		// be rejected with DOMAIN_MISMATCH / witness_commitment_mismatch.
		mockGetThreeTreeProverForDepth.mockResolvedValue({
			verifyProof: (...args: unknown[]) => mockVerifyProof(...args),
			generateProof: vi.fn(),
			destroy: vi.fn(),
		});
		mockVerifyProof.mockResolvedValue(true);

		const serverDistricts = Array.from({ length: 24 }, (_, i) =>
			'0x' + (i + 100).toString(16).padStart(64, '0')
		);
		const attackerDistricts = Array.from({ length: 24 }, (_, i) =>
			'0x' + (i + 999).toString(16).padStart(64, '0')
		);

		// The server-canonical commitment binds to serverDistricts (what was
		// attested at verifyAddress time). The attacker's witness names
		// attackerDistricts — the hashes diverge and the gate must reject.
		const serverCommitment = await mockPoseidonSponge24(serverDistricts);

		const nullifier = '0x000000000000000000000000000000000000000000000000000000000000beef';
		const actionDomain = '0x0000000000000000000000000000000000000000000000000000000000000001';
		const publicInputsArray = Array.from({ length: 31 }, (_, i) =>
			`0x${i.toString(16).padStart(64, '0')}`
		);
		publicInputsArray[26] = nullifier;
		publicInputsArray[27] = actionDomain;
		const proof = '0x' + 'ab'.repeat(1500);

		const result = await verifyProofGate({
			proof,
			publicInputs: { actionDomain, nullifier, publicInputsArray },
			expected: {
				actionDomain,
				templateId: 'tpl-1',
				districtCommitment: serverCommitment,
			},
			witness: {
				nullifier,
				districts: attackerDistricts, // The attack signature: witness ≠ commitment.
			},
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.errorCode).toBe('DOMAIN_MISMATCH');
			expect(result.error).toBe('witness_commitment_mismatch');
		}
	});

	it('(iii) TEE witness-to-commitment accepts matching districts (happy path control)', async () => {
		// Control case: when the witness districts DO hash to the server
		// commitment, the gate passes. Without this assertion the above
		// rejection test could be misinterpreted as "gate rejects everything."
		mockGetThreeTreeProverForDepth.mockResolvedValue({
			verifyProof: (...args: unknown[]) => mockVerifyProof(...args),
			generateProof: vi.fn(),
			destroy: vi.fn(),
		});
		mockVerifyProof.mockResolvedValue(true);

		const districts = Array.from({ length: 24 }, (_, i) =>
			'0x' + (i + 1).toString(16).padStart(64, '0')
		);
		const commitment = await mockPoseidonSponge24(districts);

		const nullifier = '0x000000000000000000000000000000000000000000000000000000000000beef';
		const actionDomain = '0x0000000000000000000000000000000000000000000000000000000000000001';
		const publicInputsArray = Array.from({ length: 31 }, (_, i) =>
			`0x${i.toString(16).padStart(64, '0')}`
		);
		publicInputsArray[26] = nullifier;
		publicInputsArray[27] = actionDomain;

		const result = await verifyProofGate({
			proof: '0x' + 'ab'.repeat(1500),
			publicInputs: { actionDomain, nullifier, publicInputsArray },
			expected: { actionDomain, templateId: 'tpl-1', districtCommitment: commitment },
			witness: { nullifier, districts },
		});
		expect(result.success).toBe(true);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// F2 — District-hop amplification (throttle + sybil + tier-3 bypass)
// ═════════════════════════════════════════════════════════════════════════════

describe('F2 — district-hop throttle + email-sybil', () => {
	let convex: MockConvex;

	beforeEach(() => {
		convex = new MockConvex();
	});

	it('second re-verification within 24h throws ADDRESS_VERIFICATION_THROTTLED_24H', () => {
		const USER_ID = 'user_24h';
		convex.users.set(USER_ID, {
			_id: USER_ID,
			tokenIdentifier: 't_24h',
			trustTier: 2,
			emailHash: 'email_24h',
			_creationTime: 1_000_000,
		});

		const t0 = 2_000_000;
		convex.verifyAddress(USER_ID, t0);
		// A second attempt before 24h have elapsed must be rejected.
		expect(() => convex.verifyAddress(USER_ID, t0 + TWENTY_FOUR_HOURS_MS - 1)).toThrow(
			'ADDRESS_VERIFICATION_THROTTLED_24H'
		);
		// Just past 24h — 24h gate clears.
		expect(() => convex.verifyAddress(USER_ID, t0 + TWENTY_FOUR_HOURS_MS + 1)).not.toThrow();
	});

	it('7th re-verification within 180d throws ADDRESS_VERIFICATION_THROTTLED_180D (time-skipped)', () => {
		const USER_ID = 'user_180d';
		convex.users.set(USER_ID, {
			_id: USER_ID,
			tokenIdentifier: 't_180d',
			trustTier: 2,
			emailHash: 'email_180d',
			_creationTime: 1_000_000,
		});

		// Six re-verifications spaced > 24h apart each. All must succeed.
		let t = 2_000_000;
		for (let i = 0; i < MAX_REVERIFICATIONS_PER_180D; i++) {
			expect(() => convex.verifyAddress(USER_ID, t)).not.toThrow();
			t += TWENTY_FOUR_HOURS_MS + 60_000; // advance past 24h window
		}
		// The 7th — within the 180d window — must trip the higher-level gate.
		// (t is now 6*(24h+60s) after t0; well under 180d.)
		expect(() => convex.verifyAddress(USER_ID, t)).toThrow('ADDRESS_VERIFICATION_THROTTLED_180D');
	});

	it('tier-3 bypass: an mDL-verified user can re-verify twice within 24h', () => {
		const USER_ID = 'user_tier3';
		convex.users.set(USER_ID, {
			_id: USER_ID,
			tokenIdentifier: 't_tier3',
			trustTier: 3, // mDL-verified identity — bypass the throttle
			emailHash: 'email_tier3',
			_creationTime: 1_000_000,
		});
		const t0 = 2_000_000;
		expect(() => convex.verifyAddress(USER_ID, t0)).not.toThrow();
		// Second attempt within 24h — tier-3 users skip the gate entirely.
		expect(() => convex.verifyAddress(USER_ID, t0 + 1_000)).not.toThrow();
	});

	it('email-sybil: 4th userId sharing emailHash throws ADDRESS_VERIFICATION_EMAIL_SYBIL', () => {
		// The threshold is > MAX_USERIDS_PER_EMAIL_HASH_180D (3). Seeding 4
		// accounts under one emailHash, all created within 180d, should trip the
		// gate when the 4th tries verifyAddress.
		const sharedEmailHash = 'email_sybil';
		for (let i = 0; i < 4; i++) {
			convex.users.set(`user_sybil_${i}`, {
				_id: `user_sybil_${i}`,
				tokenIdentifier: `t_sybil_${i}`,
				trustTier: 2,
				emailHash: sharedEmailHash,
				_creationTime: 1_000_000 + i * 1000, // all within 180d
			});
		}
		const t0 = 2_000_000;
		// First three users succeed — the gate check is `> 3`, not `>= 3`.
		// That permits exactly three legit accounts per email; the fourth trips.
		// Note: per the verifyAddress source, siblingUsers includes the acting
		// user itself, so once four rows exist on the index, any verification
		// attempt from any of them must fail.
		expect(() => convex.verifyAddress('user_sybil_0', t0)).toThrow(
			'ADDRESS_VERIFICATION_EMAIL_SYBIL'
		);
	});

	it('email-sybil: 3 userIds sharing emailHash still permitted (legitimate family/household)', () => {
		// Three distinct accounts under one email is common (family members
		// forwarded via one address). The gate uses a strict > comparison, so
		// 3 must pass.
		const sharedEmailHash = 'email_household';
		for (let i = 0; i < 3; i++) {
			convex.users.set(`user_household_${i}`, {
				_id: `user_household_${i}`,
				tokenIdentifier: `t_household_${i}`,
				trustTier: 2,
				emailHash: sharedEmailHash,
				_creationTime: 1_000_000 + i * 1000,
			});
		}
		const t0 = 2_000_000;
		expect(() => convex.verifyAddress('user_household_0', t0)).not.toThrow();
	});

	it('downgrade guard: user with prior v2 credential cannot verify without a new commitment', () => {
		// Wave 1b — self-DoS prevention. AddressCollectionForm.svelte silently
		// catches client-side Poseidon2 failures and re-submits verify-address
		// with no district_commitment. Pre-guard, that request would retire the
		// prior v2 row and issue a commitment-less one → every submission 403s
		// with CREDENTIAL_MIGRATION_REQUIRED until the 24h throttle expires.
		// Post-guard, the mutation rejects at the server boundary so the UI can
		// surface a retry-able error to the user.
		const USER_ID = 'user_downgrade';
		convex.users.set(USER_ID, {
			_id: USER_ID,
			tokenIdentifier: 't_downgrade',
			trustTier: 2,
			emailHash: 'email_downgrade',
			_creationTime: 1_000_000,
		});
		const t0 = 2_000_000;
		// Initial verification with a commitment succeeds (user has a v2 row).
		convex.verifyAddress(USER_ID, t0, { districtCommitment: '0xabc' + 'd'.repeat(61) });

		// 25h later (past the throttle), user re-verifies. Client-side Poseidon
		// sponge fails silently, so the form sends no commitment. The mutation
		// must reject — the user shouldn't silently downgrade.
		const t1 = t0 + TWENTY_FOUR_HOURS_MS + 60_000;
		expect(() => convex.verifyAddress(USER_ID, t1, { districtCommitment: '' })).toThrow(
			'ADDRESS_VERIFICATION_COMMITMENT_DOWNGRADE'
		);

		// Prior v2 row is still intact (not revoked) — the guard fires BEFORE
		// the revoke-prior step runs.
		const credentials = Array.from(convex.credentials.values()).filter(
			(c) => c.userId === USER_ID
		);
		expect(credentials.length).toBe(1);
		expect(credentials[0].revokedAt).toBeUndefined();
		expect(credentials[0].districtCommitment).toBe('0xabc' + 'd'.repeat(61));
	});

	it('downgrade guard: legacy user (never had commitment) can still verify without one', () => {
		// The guard must NOT break the v1 legacy path. Users who have never
		// held a commitment-bearing credential (civic_api/postal pre-Stage-5)
		// can continue to re-verify without one during the transition period.
		const USER_ID = 'user_legacy';
		convex.users.set(USER_ID, {
			_id: USER_ID,
			tokenIdentifier: 't_legacy',
			trustTier: 2,
			_creationTime: 1_000_000,
		});
		const t0 = 2_000_000;
		// Seed a v1 (commitment-less) credential manually — simulates a user
		// verified before the v2 rollout.
		convex.credentials.set('cred_seed_legacy', {
			_id: 'cred_seed_legacy',
			userId: USER_ID,
			issuedAt: t0 - 30 * 24 * 60 * 60 * 1000,
			expiresAt: t0 + 60 * 24 * 60 * 60 * 1000,
			credentialHash: '0xhash_legacy',
			// districtCommitment OMITTED — legacy row
		});
		// Re-verification without a commitment must STILL succeed for this user.
		const t1 = t0 + TWENTY_FOUR_HOURS_MS + 60_000;
		expect(() => convex.verifyAddress(USER_ID, t1, { districtCommitment: '' })).not.toThrow();
	});

	it('downgrade guard: revoked-but-had-commitment history still triggers the guard', () => {
		// A user whose ONLY commitment-bearing credential was revoked cannot
		// slide back to the legacy path. The guard scans full history, not
		// just active rows — once a user enters the v2 regime, they stay there.
		const USER_ID = 'user_revoked_v2';
		convex.users.set(USER_ID, {
			_id: USER_ID,
			tokenIdentifier: 't_revoked_v2',
			trustTier: 2,
			_creationTime: 1_000_000,
		});
		const t0 = 2_000_000;
		// Seed a REVOKED v2 row. The user should still be treated as a v2 user
		// for downgrade-guard purposes — once they've held a commitment, they
		// must continue to provide one.
		convex.credentials.set('cred_revoked_v2', {
			_id: 'cred_revoked_v2',
			userId: USER_ID,
			issuedAt: t0 - 60 * 24 * 60 * 60 * 1000,
			expiresAt: t0 + 30 * 24 * 60 * 60 * 1000,
			revokedAt: t0 - 1000, // revoked
			districtCommitment: '0xrevoked_but_existed',
			credentialHash: '0xhash_revoked_v2',
		});
		const t1 = t0 + TWENTY_FOUR_HOURS_MS + 60_000;
		expect(() => convex.verifyAddress(USER_ID, t1, { districtCommitment: '' })).toThrow(
			'ADDRESS_VERIFICATION_COMMITMENT_DOWNGRADE'
		);
	});

	it('email-sybil: accounts older than 180d do not count against the cap', () => {
		// Accumulated-over-years carve-out: users._creationTime > 180d ago are
		// excluded from the sibling count. So two old accounts + two fresh
		// accounts on the same email is fine.
		const t0 = 1_000_000_000_000;
		const sharedEmailHash = 'email_accumulated';
		// Two old accounts (created 200d ago).
		for (let i = 0; i < 2; i++) {
			convex.users.set(`user_old_${i}`, {
				_id: `user_old_${i}`,
				tokenIdentifier: `t_old_${i}`,
				trustTier: 2,
				emailHash: sharedEmailHash,
				_creationTime: t0 - 200 * 24 * 60 * 60 * 1000,
			});
		}
		// Two recent accounts (created within the last 180d).
		for (let i = 0; i < 2; i++) {
			convex.users.set(`user_new_${i}`, {
				_id: `user_new_${i}`,
				tokenIdentifier: `t_new_${i}`,
				trustTier: 2,
				emailHash: sharedEmailHash,
				_creationTime: t0 - 30 * 24 * 60 * 60 * 1000,
			});
		}
		// Only the 2 new accounts count for the cap → 2 ≤ 3 → permitted.
		expect(() => convex.verifyAddress('user_new_0', t0)).not.toThrow();
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// F3 — Snapshot-boundary invariant (descriptive / assert-as-doc)
// ═════════════════════════════════════════════════════════════════════════════

describe('F3 — snapshot-boundary invariant (descriptive)', () => {
	/**
	 * F3 in full requires time-travel across quarterly anchor roots, which the
	 * convex-test harness does not support cleanly. The invariant we are
	 * asserting here is a structural one: at any T, a single query for the
	 * user's active credential must return exactly one row (or none), and the
	 * commitment on that row matches the LATEST post-anchor value.
	 *
	 * In production this is enforced by getActiveCredentialDistrictCommitment
	 * filtering on !revokedAt ∧ expiresAt>now, indexed by_userId_expiresAt
	 * with order desc. The regrounding-cross-state test covers the same
	 * "latest commitment wins" invariant at the row level; this assertion is
	 * the scheme-level statement that carries forward into the on-chain
	 * anchor scope.
	 */
	it('invariant: at time T, exactly one active credential per user (or none)', () => {
		const convex = new MockConvex();
		const USER_ID = 'user_f3';
		convex.users.set(USER_ID, {
			_id: USER_ID,
			tokenIdentifier: 't_f3',
			trustTier: 2,
			_creationTime: 1_000_000,
		});

		// Before verification: no active credential.
		const t0 = 2_000_000;
		const before = Array.from(convex.credentials.values()).filter(
			(c) => c.userId === USER_ID && !c.revokedAt && c.expiresAt > t0
		);
		expect(before).toHaveLength(0);

		// After a single verification: exactly one active.
		convex.verifyAddress(USER_ID, t0);
		const after1 = Array.from(convex.credentials.values()).filter(
			(c) => c.userId === USER_ID && !c.revokedAt && c.expiresAt > t0
		);
		expect(after1).toHaveLength(1);

		// After a re-ground (past 24h throttle): still exactly one — the old one
		// revoked, the new one active.
		const t1 = t0 + TWENTY_FOUR_HOURS_MS + 60_000;
		convex.verifyAddress(USER_ID, t1);
		const after2 = Array.from(convex.credentials.values()).filter(
			(c) => c.userId === USER_ID && !c.revokedAt && c.expiresAt > t1
		);
		expect(after2).toHaveLength(1);
	});

	it.todo(
		'convex-test time-travel across quarterly anchor: old commitment ∈ prior-root SMT, new commitment ∈ post-root SMT (requires cross-anchor harness)'
	);
});
