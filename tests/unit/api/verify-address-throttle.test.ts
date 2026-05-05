/**
 * Unit tests: Re-verification throttle + verificationMethod allowlist.
 *
 * Stage 1 (Re-grounding work, P0 server hardening) — covers:
 *   1c. 24h + 6-per-180d + email-sybil throttle
 *   1d. verificationMethod allowlist
 *
 * Pressure points:
 *   - Throttle errors surface as 429 with machine-readable `code` for UI
 *   - Allowlist errors surface as 400
 *   - Legitimate re-verifications within limits still succeed
 *   - Internal errors still surface as 500 (no leakage of sensitive stack)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockServerQuery, mockServerMutation } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	mockServerMutation: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery,
	serverMutation: mockServerMutation
}));

vi.mock('$lib/convex', () => ({
	api: {
		users: {
			getDidKey: 'users.getDidKey',
			verifyAddress: 'users.verifyAddress'
		}
	}
}));

vi.mock('$lib/core/identity/district-credential', () => ({
	issueDistrictCredential: vi.fn().mockResolvedValue({ proof: { proofValue: 'stub' } }),
	hashCredential: vi.fn().mockResolvedValue('deadbeef'.repeat(8)),
	hashDistrict: vi.fn().mockResolvedValue('cafef00d'.repeat(8))
}));

vi.mock('$lib/core/identity/credential-policy', () => ({
	TIER_CREDENTIAL_TTL: { 2: 6 * 30 * 24 * 60 * 60 * 1000 }
}));

// FU-1.1 (Wave 6) added a server-side commitment authenticity check that
// runs BEFORE the mutation. These tests target throttle surfacing post-
// mutation, so we mock the helper to a no-op success.
vi.mock('$lib/server/identity/verify-commitment', () => ({
	verifyDistrictCommitment: vi.fn().mockResolvedValue({
		matches: true,
		expectedCommitment: '0x' + 'a'.repeat(64)
	})
}));

import { POST } from '../../../src/routes/api/identity/verify-address/+server';

function buildEvent(body: unknown) {
	return {
		request: {
			json: async () => body
		},
		locals: {
			user: { id: 'user_abc' }
		}
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	mockServerQuery.mockResolvedValue({ didKey: null });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/identity/verify-address — throttle surfacing', () => {
	it('surfaces 24h throttle as 429 with THROTTLED_24H code', async () => {
		mockServerMutation.mockRejectedValueOnce(new Error('ADDRESS_VERIFICATION_THROTTLED_24H'));

		const response = await POST(
			buildEvent({
				district: 'OR-03',
				verification_method: 'shadow_atlas',
				district_commitment: '0x' + 'a'.repeat(64),
				// FU-1.1 (Wave 6): coordinates required when commitment is provided.
				coordinates: { lat: 45.5, lng: -122.7 }
			})
		);

		expect(response.status).toBe(429);
		const json = await response.json();
		expect(json.code).toBe('THROTTLED_24H');
		expect(json.error).toMatch(/24 hours/i);
	});

	it('surfaces 180d throttle as 429 with THROTTLED_180D code', async () => {
		mockServerMutation.mockRejectedValueOnce(new Error('ADDRESS_VERIFICATION_THROTTLED_180D'));

		const response = await POST(
			buildEvent({
				district: 'WA-07',
				verification_method: 'civic_api'
			})
		);

		expect(response.status).toBe(429);
		const json = await response.json();
		expect(json.code).toBe('THROTTLED_180D');
	});

	it('surfaces email-sybil rejection as 429 with EMAIL_SYBIL code', async () => {
		mockServerMutation.mockRejectedValueOnce(new Error('ADDRESS_VERIFICATION_EMAIL_SYBIL'));

		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api'
			})
		);

		expect(response.status).toBe(429);
		const json = await response.json();
		expect(json.code).toBe('EMAIL_SYBIL');
	});

	it('surfaces verificationMethod allowlist violation as 400 with INVALID_METHOD code', async () => {
		mockServerMutation.mockRejectedValueOnce(new Error('INVALID_VERIFICATION_METHOD'));

		const response = await POST(
			buildEvent({
				district: 'NY-14',
				verification_method: 'civic_api' // endpoint accepts; mutation rejects
			})
		);

		expect(response.status).toBe(400);
		const json = await response.json();
		expect(json.code).toBe('INVALID_METHOD');
	});

	it('does not leak stack/internals on generic 500', async () => {
		mockServerMutation.mockRejectedValueOnce(new Error('internal foo bar state'));

		const response = await POST(
			buildEvent({
				district: 'TX-35',
				verification_method: 'civic_api'
			})
		);

		expect(response.status).toBe(500);
		const json = await response.json();
		expect(json.error).not.toMatch(/foo bar/);
		expect(json.error).not.toMatch(/state/);
		expect(json.error).toBe('Failed to issue district credential. Please try again.');
	});

	it('returns 200 when mutation succeeds (happy path)', async () => {
		mockServerMutation.mockResolvedValueOnce({ districtCredentialId: 'cred_123' });

		const response = await POST(
			buildEvent({
				district: 'OR-03',
				verification_method: 'civic_api',
				officials: []
			})
		);

		expect(response.status).toBe(200);
		const json = await response.json();
		expect(json.success).toBe(true);
	});

	it('surfaces stale Convex credential contract as a retryable 503', async () => {
		mockServerMutation.mockResolvedValueOnce(undefined);

		const response = await POST(
			buildEvent({
				district: 'OR-03',
				verification_method: 'civic_api',
				officials: []
			})
		);

		expect(response.status).toBe(503);
		const json = await response.json();
		expect(json.code).toBe('GROUND_CREDENTIAL_CONTRACT_STALE');
		expect(json.error).toMatch(/server finishes updating/i);
	});

	it('surfaces COMMITMENT_AUTHENTICITY_REQUIRES_COORDINATES as 400 (FU-1.1)', async () => {
		// When district_commitment is supplied without coordinates, the
		// FU-1.1 server-side authenticity check refuses BEFORE any mutation.
		const response = await POST(
			buildEvent({
				district: 'OR-03',
				verification_method: 'shadow_atlas',
				district_commitment: '0x' + 'a'.repeat(64)
				// no coordinates
			})
		);
		expect(response.status).toBe(400);
		const json = await response.json();
		expect(json.code).toBe('COMMITMENT_AUTHENTICITY_REQUIRES_COORDINATES');
		// Mutation must not have been invoked.
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('surfaces commitment-downgrade rejection as 400 with COMMITMENT_DOWNGRADE code', async () => {
		// Wave 1b: verifyAddress now rejects when the user previously held a
		// commitment-bearing credential but the incoming request omits one. The
		// API must surface this as a 400 with a machine-readable code so the
		// UI can prompt the user to retry rather than silently succeed.
		mockServerMutation.mockRejectedValueOnce(
			new Error('ADDRESS_VERIFICATION_COMMITMENT_DOWNGRADE')
		);

		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api'
				// district_commitment intentionally omitted — simulates the
				// AddressCollectionForm.svelte silent-catch "proceeding without" path.
				// No coordinates needed (FU-1.1 only triggers WHEN commitment is supplied).
			})
		);

		expect(response.status).toBe(400);
		const json = await response.json();
		expect(json.code).toBe('COMMITMENT_DOWNGRADE');
		// Error message should be user-actionable, not internal-leaky.
		expect(json.error).toMatch(/commitment/i);
		expect(json.error).not.toMatch(/ADDRESS_VERIFICATION_/);
	});
});

// ============================================================================
// H1 — trust-context plumbing through the SvelteKit endpoint
// ============================================================================
//
// H0r CRITICAL: legacy callers must not retroactively manufacture trust state.
// These tests pin the contract:
//   - When the client sends cell_straddles / cell_anchor_mode / atlas_version,
//     the Convex mutation receives the corresponding camelCase fields.
//   - When the client omits any of those, the mutation must NOT receive a
//     literal default — the field stays undefined so the credential row's
//     downstream surfaces (H6) can render "unknown" rather than "false/clean".
describe('POST /api/identity/verify-address — H1 trust-context pass-through', () => {
	it('forwards cell_straddles / cell_anchor_mode / atlas_version to the mutation', async () => {
		mockServerMutation.mockResolvedValueOnce({ districtCredentialId: 'cred_h1_1' });

		await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api',
				officials: [],
				cell_straddles: true,
				cell_anchor_mode: 'address-resolved',
				atlas_version: 'v20260503'
			})
		);

		// First mutation call after getDidKey query — locate verifyAddress invocation.
		const verifyAddressCall = mockServerMutation.mock.calls.find(
			(c) => c[0] === 'users.verifyAddress'
		);
		expect(verifyAddressCall).toBeDefined();
		const args = verifyAddressCall![1] as Record<string, unknown>;
		expect(args.cellStraddles).toBe(true);
		expect(args.cellAnchorMode).toBe('address-resolved');
		expect(args.atlasVersion).toBe('v20260503');
	});

	it('omits trust-context fields entirely when client does not supply them (H0r: no default backfill)', async () => {
		mockServerMutation.mockResolvedValueOnce({ districtCredentialId: 'cred_h1_2' });

		await POST(
			buildEvent({
				district: 'OR-03',
				verification_method: 'civic_api',
				officials: []
			})
		);

		const verifyAddressCall = mockServerMutation.mock.calls.find(
			(c) => c[0] === 'users.verifyAddress'
		);
		expect(verifyAddressCall).toBeDefined();
		const args = verifyAddressCall![1] as Record<string, unknown>;
		// Critical: explicit `undefined`, NOT a default `false` / sentinel string.
		// The Convex args validator drops undefined; the row's fields stay unset.
		expect(args.cellStraddles).toBeUndefined();
		expect(args.cellAnchorMode).toBeUndefined();
		expect(args.atlasVersion).toBeUndefined();
	});

	it('drops cell_straddles when client sends a non-boolean (defensive validation)', async () => {
		mockServerMutation.mockResolvedValueOnce({ districtCredentialId: 'cred_h1_3' });

		await POST(
			buildEvent({
				district: 'NY-14',
				verification_method: 'civic_api',
				officials: [],
				// Hostile client sends a string where boolean is required.
				cell_straddles: 'maybe',
				cell_anchor_mode: 42
			})
		);

		const verifyAddressCall = mockServerMutation.mock.calls.find(
			(c) => c[0] === 'users.verifyAddress'
		);
		expect(verifyAddressCall).toBeDefined();
		const args = verifyAddressCall![1] as Record<string, unknown>;
		expect(args.cellStraddles).toBeUndefined();
		expect(args.cellAnchorMode).toBeUndefined();
	});

	it('surfaces INVALID_CELL_ANCHOR_MODE from the mutation as 500 (validation defends at handler)', async () => {
		// The endpoint accepts any string for cell_anchor_mode; the Convex handler
		// is the canonical allowlist and rejects unknown values. We assert the
		// rejection path round-trips coherently to the client.
		mockServerMutation.mockRejectedValueOnce(new Error('INVALID_CELL_ANCHOR_MODE'));

		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api',
				officials: [],
				cell_anchor_mode: 'galaxy-brain-mode' // not in allowlist
			})
		);

		// No bespoke surface for this code yet — falls through to generic 500.
		// If H6 wants a richer code, that's a follow-up; this test pins the
		// invariant that the request is NOT silently accepted.
		expect(response.status).toBe(500);
	});

	it('H1r F5 — drops atlas_version > 64 chars at the boundary (storage-abuse defense)', async () => {
		mockServerMutation.mockResolvedValueOnce({ districtCredentialId: 'cred_h1_f5_av' });

		await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api',
				officials: [],
				atlas_version: 'A'.repeat(1024) // hostile — way past the cap
			})
		);

		const verifyAddressCall = mockServerMutation.mock.calls.find(
			(c) => c[0] === 'users.verifyAddress'
		);
		expect(verifyAddressCall).toBeDefined();
		const args = verifyAddressCall![1] as Record<string, unknown>;
		expect(args.atlasVersion).toBeUndefined();
	});

	it('H1r F5 — drops cell_anchor_mode > 64 chars at the boundary', async () => {
		mockServerMutation.mockResolvedValueOnce({ districtCredentialId: 'cred_h1_f5_cam' });

		await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api',
				officials: [],
				cell_anchor_mode: 'B'.repeat(1024)
			})
		);

		const verifyAddressCall = mockServerMutation.mock.calls.find(
			(c) => c[0] === 'users.verifyAddress'
		);
		expect(verifyAddressCall).toBeDefined();
		const args = verifyAddressCall![1] as Record<string, unknown>;
		expect(args.cellAnchorMode).toBeUndefined();
	});

	it('H1r F5 — accepts atlas_version exactly at the 64-char cap (boundary inclusive)', async () => {
		mockServerMutation.mockResolvedValueOnce({ districtCredentialId: 'cred_h1_f5_b64' });

		await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api',
				officials: [],
				atlas_version: 'C'.repeat(64)
			})
		);

		const verifyAddressCall = mockServerMutation.mock.calls.find(
			(c) => c[0] === 'users.verifyAddress'
		);
		expect(verifyAddressCall).toBeDefined();
		const args = verifyAddressCall![1] as Record<string, unknown>;
		expect(args.atlasVersion).toBe('C'.repeat(64));
	});
});

// ============================================================================
// H5 — Self-attestation cross-check at the registration handler
// ============================================================================
//
// The Convex verifyAddress handler now structurally cross-checks
// cellAnchorMode against server-known facts (user.trustTier, allowlist).
// These tests pin the round-trip from the SvelteKit endpoint: when the
// mutation rejects with the H5 error codes, the API surfaces them.
describe('POST /api/identity/verify-address — H5 cross-check surfacing', () => {
	it('surfaces INVALID_CELL_ANCHOR_MODE_LEGACY_RESERVED on legacy-* writes', async () => {
		mockServerMutation.mockRejectedValueOnce(
			new Error('INVALID_CELL_ANCHOR_MODE_LEGACY_RESERVED')
		);

		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api',
				officials: [],
				cell_anchor_mode: 'legacy-inferred'
			})
		);

		// Like INVALID_CELL_ANCHOR_MODE in the H1 surface, this falls through
		// to the generic 500. The point: this is NOT silently accepted.
		expect(response.status).toBe(500);
	});

	it('surfaces INVALID_CELL_ANCHOR_MODE_TIER_MISMATCH on cross-tier mismatches', async () => {
		mockServerMutation.mockRejectedValueOnce(
			new Error('INVALID_CELL_ANCHOR_MODE_TIER_MISMATCH')
		);

		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api',
				officials: [],
				cell_anchor_mode: 'address-resolved'
			})
		);

		expect(response.status).toBe(500);
	});
});
