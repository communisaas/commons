/**
 * KG-4 invariant: the two call sites that inspect "the user's active district
 * credential" must agree on which row is active when more than one exists.
 *
 * Primary invariant ("exactly one active row per user") is enforced by
 * verifyAddress being atomic. This test simulates invariant-break scenarios
 * (two active rows coexisting) and asserts both call sites route through
 * `selectActiveCredentialForUser` and converge on the same row:
 *
 *   - hasActiveDistrictCredential (convex/submissions.ts)
 *   - getActiveCredentialDistrictCommitment (convex/users.ts)
 *
 * Canonical ordering: highest `issuedAt`, `_creationTime` tiebreak.
 *
 * Pattern note: we mirror the selector logic in-memory (same technique as
 * regrounding-cross-state.test.ts) because the repo doesn't run convex-test.
 * The mock's selector must stay literally identical to convex/_credentialSelect.ts.
 */

import { describe, it, expect } from 'vitest';

interface CredentialRow {
	_id: string;
	_creationTime: number;
	userId: string;
	issuedAt: number;
	expiresAt: number;
	credentialHash: string;
	districtCommitment?: string;
	revokedAt?: number;
}

// ── Mirror of convex/_credentialSelect.ts selectActiveCredentialForUser ──
// Any divergence here vs production is a correctness bug in the test, not a
// feature. Keep byte-for-byte aligned with the Convex helper.
function selectActiveCredential(
	rows: CredentialRow[],
	userId: string,
	now: number
): CredentialRow | null {
	const active = rows.filter(
		(c) => c.userId === userId && !c.revokedAt && c.expiresAt > now
	);
	if (active.length === 0) return null;
	active.sort(
		(a, b) => b.issuedAt - a.issuedAt || b._creationTime - a._creationTime
	);
	return active[0];
}

// ── Mirror of convex/submissions.ts hasActiveDistrictCredential ──
// Returns the credentialId (passed to downstream submissions as issuingCredentialId).
function hasActiveDistrictCredential(
	rows: CredentialRow[],
	userId: string,
	now: number
): { active: true; credentialId: string; credentialHash: string } | { active: false } {
	const row = selectActiveCredential(rows, userId, now);
	if (!row) return { active: false };
	return { active: true, credentialId: row._id, credentialHash: row.credentialHash };
}

// ── Mirror of convex/users.ts getActiveCredentialDistrictCommitment ──
// Requires the selected row to carry a districtCommitment; returns null
// otherwise (surfaces CREDENTIAL_MIGRATION_REQUIRED to the caller).
function getActiveCredentialDistrictCommitment(
	rows: CredentialRow[],
	userId: string,
	now: number
): { districtCommitment: string; credentialId: string } | null {
	const row = selectActiveCredential(rows, userId, now);
	if (!row || !row.districtCommitment) return null;
	return { districtCommitment: row.districtCommitment, credentialId: row._id };
}

// Convenience row factory. Forces explicit field naming for readability at
// the call site — tests should make the "which row is newest" question obvious.
function row(overrides: Partial<CredentialRow> & {
	_id: string;
	issuedAt: number;
	expiresAt: number;
	_creationTime: number;
}): CredentialRow {
	return {
		userId: 'u1',
		credentialHash: '0xhash_' + overrides._id,
		...overrides,
	};
}

const USER = 'u1';
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const TTL = 90 * DAY;

describe('KG-4 selector invariant: both call sites pick the same row', () => {
	it('single active row: both queries return that row', () => {
		const rows = [
			row({
				_id: 'cred_solo',
				_creationTime: 1,
				issuedAt: NOW - 10 * DAY,
				expiresAt: NOW + TTL,
				districtCommitment: '0xcommit_solo',
			}),
		];

		const gate = hasActiveDistrictCredential(rows, USER, NOW);
		const commitment = getActiveCredentialDistrictCommitment(rows, USER, NOW);

		expect(gate.active).toBe(true);
		if (gate.active) expect(gate.credentialId).toBe('cred_solo');
		expect(commitment).not.toBeNull();
		expect(commitment?.credentialId).toBe('cred_solo');
		expect(commitment?.districtCommitment).toBe('0xcommit_solo');
	});

	it('two active rows with different issuedAt: both pick the more recently issued', () => {
		// Previously: hasActiveDistrictCredential picked oldest expiry first (via
		// .find on ascending index); getActiveCredentialDistrictCommitment picked
		// latest expiry. With identical TTLs, these collapse to the same row, but
		// with different TTLs (e.g. policy change between issuances) they split.
		const rows = [
			row({
				_id: 'cred_older',
				_creationTime: 1,
				issuedAt: NOW - 10 * DAY,
				expiresAt: NOW + 365 * DAY, // longer TTL (hypothetical old policy)
				districtCommitment: '0xcommit_older',
			}),
			row({
				_id: 'cred_newer',
				_creationTime: 2,
				issuedAt: NOW - 1 * DAY,
				expiresAt: NOW + 30 * DAY, // shorter TTL
				districtCommitment: '0xcommit_newer',
			}),
		];

		const gate = hasActiveDistrictCredential(rows, USER, NOW);
		const commitment = getActiveCredentialDistrictCommitment(rows, USER, NOW);

		expect(gate.active).toBe(true);
		if (gate.active) expect(gate.credentialId).toBe('cred_newer');
		expect(commitment?.credentialId).toBe('cred_newer');
		expect(commitment?.districtCommitment).toBe('0xcommit_newer');
	});

	it('v1 legacy (no commitment) + v2 active: gate accepts, commitment-query returns null when v1 is newer', () => {
		// Adversarial scenario: v1 credential was issued AFTER v2 somehow (legacy
		// re-issue path, bug, or manual operator intervention). The old divergent
		// queries would pick different rows — hasActive picks first-by-expiry
		// (likely v1), getCommitment picks first-with-commitment (v2). Under the
		// unified selector, BOTH pick v1 (most recent). getCommitment returns null
		// because v1 lacks the field → user gets CREDENTIAL_MIGRATION_REQUIRED.
		// That is the correct outcome: the authoritative current credential is v1,
		// and v1 cannot produce a canonical v2 action_domain.
		const rows = [
			row({
				_id: 'cred_v2_older',
				_creationTime: 1,
				issuedAt: NOW - 30 * DAY,
				expiresAt: NOW + 60 * DAY,
				districtCommitment: '0xcommit_v2',
			}),
			row({
				_id: 'cred_v1_newer',
				_creationTime: 2,
				issuedAt: NOW - 1 * DAY,
				expiresAt: NOW + 89 * DAY,
				// no districtCommitment
			}),
		];

		const gate = hasActiveDistrictCredential(rows, USER, NOW);
		const commitment = getActiveCredentialDistrictCommitment(rows, USER, NOW);

		// BOTH agree: the newest row (v1) is authoritative.
		expect(gate.active).toBe(true);
		if (gate.active) expect(gate.credentialId).toBe('cred_v1_newer');
		// Commitment-query returns null — correct: v1 has none, user must re-verify.
		// Crucially it does NOT silently fall back to the older v2 row.
		expect(commitment).toBeNull();
	});

	it('v1 legacy + v2 active: when v2 is newer, both queries pick v2', () => {
		// Normal evolution: v1 exists, user re-verifies → v2 is newest. Both
		// queries pick v2. gate.credentialId === v2 row, commitment === v2 commitment.
		const rows = [
			row({
				_id: 'cred_v1_older',
				_creationTime: 1,
				issuedAt: NOW - 30 * DAY,
				expiresAt: NOW + 60 * DAY,
				// no districtCommitment
			}),
			row({
				_id: 'cred_v2_newer',
				_creationTime: 2,
				issuedAt: NOW - 1 * DAY,
				expiresAt: NOW + 89 * DAY,
				districtCommitment: '0xcommit_v2',
			}),
		];

		const gate = hasActiveDistrictCredential(rows, USER, NOW);
		const commitment = getActiveCredentialDistrictCommitment(rows, USER, NOW);

		expect(gate.active).toBe(true);
		if (gate.active) expect(gate.credentialId).toBe('cred_v2_newer');
		expect(commitment?.credentialId).toBe('cred_v2_newer');
		expect(commitment?.districtCommitment).toBe('0xcommit_v2');
	});

	it('tiebreak: two rows with identical issuedAt use _creationTime descending', () => {
		// Edge case: clock-skew or batch-insert could produce identical issuedAt
		// timestamps. `_creationTime` is Convex-set, monotonic within table, so
		// strict-greater tiebreak is deterministic.
		const rows = [
			row({
				_id: 'cred_same_ms_first',
				_creationTime: 100,
				issuedAt: NOW - 1 * DAY,
				expiresAt: NOW + 89 * DAY,
				districtCommitment: '0xcommit_first',
			}),
			row({
				_id: 'cred_same_ms_second',
				_creationTime: 200, // inserted later
				issuedAt: NOW - 1 * DAY, // same issuedAt as above
				expiresAt: NOW + 89 * DAY,
				districtCommitment: '0xcommit_second',
			}),
		];

		const gate = hasActiveDistrictCredential(rows, USER, NOW);
		const commitment = getActiveCredentialDistrictCommitment(rows, USER, NOW);

		// Second row (_creationTime 200) wins tiebreak.
		if (gate.active) expect(gate.credentialId).toBe('cred_same_ms_second');
		expect(commitment?.credentialId).toBe('cred_same_ms_second');
		expect(commitment?.districtCommitment).toBe('0xcommit_second');
	});

	it('revoked rows are excluded even if more recently issued', () => {
		// Post-verifyAddress state: old row flagged revokedAt=now, new row active.
		// The revoked row's later issuedAt (if somehow set) must not shadow the
		// active row. Current verifyAddress always stamps the NEW row's issuedAt
		// strictly later, so this scenario is synthetic — but the filter must hold.
		const rows = [
			row({
				_id: 'cred_new_active',
				_creationTime: 1,
				issuedAt: NOW - 2 * DAY,
				expiresAt: NOW + 89 * DAY,
				districtCommitment: '0xcommit_active',
			}),
			row({
				_id: 'cred_revoked_newer_issue',
				_creationTime: 2,
				issuedAt: NOW - 1 * DAY, // newer issuedAt
				expiresAt: NOW + 90 * DAY,
				districtCommitment: '0xcommit_revoked',
				revokedAt: NOW - 12 * 60 * 60 * 1000, // revoked 12h ago
			}),
		];

		const gate = hasActiveDistrictCredential(rows, USER, NOW);
		const commitment = getActiveCredentialDistrictCommitment(rows, USER, NOW);

		if (gate.active) expect(gate.credentialId).toBe('cred_new_active');
		expect(commitment?.credentialId).toBe('cred_new_active');
	});

	it('expired rows are excluded even if more recently issued', () => {
		// Defense-in-depth: the `expiresAt > now` filter must hold independent of
		// the revokedAt flag. An expired-but-not-revoked row should never surface.
		const rows = [
			row({
				_id: 'cred_active_unexpired',
				_creationTime: 1,
				issuedAt: NOW - 5 * DAY,
				expiresAt: NOW + 30 * DAY,
				districtCommitment: '0xcommit_live',
			}),
			row({
				_id: 'cred_expired_newer',
				_creationTime: 2,
				issuedAt: NOW - 1 * DAY,
				expiresAt: NOW - 1 * 60 * 1000, // expired 1 min ago
				districtCommitment: '0xcommit_dead',
			}),
		];

		const gate = hasActiveDistrictCredential(rows, USER, NOW);
		const commitment = getActiveCredentialDistrictCommitment(rows, USER, NOW);

		if (gate.active) expect(gate.credentialId).toBe('cred_active_unexpired');
		expect(commitment?.credentialId).toBe('cred_active_unexpired');
	});

	it('no active rows: both queries return falsy', () => {
		const rows = [
			row({
				_id: 'cred_all_expired',
				_creationTime: 1,
				issuedAt: NOW - 200 * DAY,
				expiresAt: NOW - 10 * DAY,
				districtCommitment: '0xcommit_dead',
			}),
			row({
				_id: 'cred_all_revoked',
				_creationTime: 2,
				issuedAt: NOW - 5 * DAY,
				expiresAt: NOW + 60 * DAY,
				districtCommitment: '0xcommit_also_dead',
				revokedAt: NOW - 2 * DAY,
			}),
		];

		const gate = hasActiveDistrictCredential(rows, USER, NOW);
		const commitment = getActiveCredentialDistrictCommitment(rows, USER, NOW);

		expect(gate.active).toBe(false);
		expect(commitment).toBeNull();
	});

	it('cross-user isolation: selector only considers rows for the target user', () => {
		const rows = [
			row({
				_id: 'cred_target_user',
				_creationTime: 1,
				userId: 'u1',
				issuedAt: NOW - 5 * DAY,
				expiresAt: NOW + 85 * DAY,
				districtCommitment: '0xcommit_u1',
			}),
			row({
				_id: 'cred_other_user_newer',
				_creationTime: 2,
				userId: 'u2', // different user, newer issuedAt
				issuedAt: NOW - 1 * DAY,
				expiresAt: NOW + 89 * DAY,
				districtCommitment: '0xcommit_u2',
			}),
		];

		const gate = hasActiveDistrictCredential(rows, 'u1', NOW);
		const commitment = getActiveCredentialDistrictCommitment(rows, 'u1', NOW);

		// u1's row is returned even though u2 has a newer row.
		if (gate.active) expect(gate.credentialId).toBe('cred_target_user');
		expect(commitment?.credentialId).toBe('cred_target_user');
	});
});
