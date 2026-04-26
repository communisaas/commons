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
		mockServerMutation.mockResolvedValueOnce(undefined);

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
