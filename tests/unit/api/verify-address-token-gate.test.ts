/**
 * Handler-level coverage for the F-2.4 token gate at /api/identity/verify-address.
 *
 * Exists alongside `verify-address-throttle.test.ts` (which mocks the token
 * helper to always-valid because its scope is throttle/error surfacing).
 * THIS file does NOT mock the token primitive — it exercises the wiring
 * between the handler and the real `verifyAddressResolutionToken`, so a
 * refactor that drops the 400 status, mangles the `code` mapping, or skips
 * the gate condition will fail loudly.
 *
 * Brutalist test_coverage roast: the handler-level wiring of token
 * verification was 100% uncovered because the only handler test file
 * mocks the entire helper module.
 */

import { describe, it, expect, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
	envMock: { ADDRESS_RESOLUTION_TOKEN_SECRET: 'a'.repeat(64) } as Record<
		string,
		string | undefined
	>
}));
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

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
		users: { getDidKey: 'users.getDidKey', verifyAddress: 'users.verifyAddress' }
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
// FU-1.1 commitment authenticity is exercised by other suites; mock to no-op
// so this suite stays focused on the F-2.4 token gate.
vi.mock('$lib/server/identity/verify-commitment', () => ({
	verifyDistrictCommitment: vi
		.fn()
		.mockResolvedValue({ matches: true, expectedCommitment: '0x' + 'a'.repeat(64) })
}));

import { POST } from '../../../src/routes/api/identity/verify-address/+server';
import {
	issueAddressResolutionToken,
	issueGeolocationResolutionToken
} from '../../../src/lib/server/auth/address-resolution-token';

const FAKE_USER = 'user_abc';
const COORDS = { lat: 37.781, lng: -122.408 };
const ADDRESS = {
	street: '12 Mint Plaza',
	city: 'San Francisco',
	state: 'CA',
	zip: '94103',
	country: 'US' as const
};

function buildEvent(body: unknown) {
	return {
		request: { json: async () => body },
		locals: { user: { id: FAKE_USER } }
	} as unknown as Parameters<typeof POST>[0];
}

describe('F-2.4 gate at POST /api/identity/verify-address', () => {
	it('400 ADDRESS_TOKEN_MISSING when coordinates supplied with no address_token', async () => {
		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'shadow_atlas',
				district_commitment: '0x' + 'a'.repeat(64),
				coordinates: COORDS
			})
		);
		expect(response.status).toBe(400);
		const json = await response.json();
		expect(json.code).toBe('ADDRESS_TOKEN_MISSING');
		expect(json.success).toBe(false);
	});

	it('400 ADDRESS_TOKEN_INVALID when token signature does not match', async () => {
		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'shadow_atlas',
				district_commitment: '0x' + 'a'.repeat(64),
				coordinates: COORDS,
				address_token: 'v1.geo.9999999999999.deadbeef'
			})
		);
		expect(response.status).toBe(400);
		const json = await response.json();
		expect(json.code).toBe('ADDRESS_TOKEN_INVALID');
	});

	it('400 ADDRESS_TOKEN_EXPIRED when an issued token has aged past TTL', async () => {
		const issued = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		vi.useFakeTimers();
		try {
			vi.setSystemTime(Date.now() + 31 * 60 * 1000); // > 30-min TTL
			const response = await POST(
				buildEvent({
					district: 'CA-12',
					verification_method: 'shadow_atlas',
					district_commitment: '0x' + 'a'.repeat(64),
					coordinates: COORDS,
					address_token: issued.token
				})
			);
			expect(response.status).toBe(400);
			const json = await response.json();
			expect(json.code).toBe('ADDRESS_TOKEN_EXPIRED');
		} finally {
			vi.useRealTimers();
		}
	});

	it('400 ADDRESS_TOKEN_INVALID when geo-mode token is presented for a different user', async () => {
		const issued = await issueGeolocationResolutionToken({
			userId: 'user_OTHER',
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'shadow_atlas',
				district_commitment: '0x' + 'a'.repeat(64),
				coordinates: COORDS,
				address_token: issued.token
			})
		);
		expect(response.status).toBe(400);
		const json = await response.json();
		expect(json.code).toBe('ADDRESS_TOKEN_INVALID');
	});

	it('400 ADDRESS_TOKEN_INVALID when addr-mode token is presented without address_hash (mode mismatch)', async () => {
		const issued = await issueAddressResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			address: ADDRESS
		});
		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'shadow_atlas',
				district_commitment: '0x' + 'a'.repeat(64),
				coordinates: COORDS,
				address_token: issued.token
				// address_hash deliberately omitted
			})
		);
		expect(response.status).toBe(400);
		const json = await response.json();
		expect(json.code).toBe('ADDRESS_TOKEN_INVALID');
	});

	it('400 ADDRESS_TOKEN_INVALID when geo-mode token is presented WITH address_hash (mode mismatch)', async () => {
		const issued = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'shadow_atlas',
				district_commitment: '0x' + 'a'.repeat(64),
				coordinates: COORDS,
				address_token: issued.token,
				address_hash: 'a'.repeat(64) // attacker tries to upgrade geo to faux-addr
			})
		);
		expect(response.status).toBe(400);
		const json = await response.json();
		expect(json.code).toBe('ADDRESS_TOKEN_INVALID');
	});

	it('passes the gate when a valid geo-mode token matches the supplied coordinates', async () => {
		mockServerQuery.mockResolvedValue({ didKey: null });
		mockServerMutation.mockResolvedValue({
			districtCredentialId: 'cred_123',
			districtHash: 'hash',
			expiresAt: Date.now() + 1_000_000
		});
		const issued = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'shadow_atlas',
				district_commitment: '0x' + 'a'.repeat(64),
				coordinates: COORDS,
				address_token: issued.token
			})
		);
		// The gate passed (no 400 ADDRESS_TOKEN_*); whatever happens downstream
		// is covered by other suites. We assert the response is NOT a token-gate
		// rejection.
		const json = await response.json();
		if (response.status === 400) {
			expect(json.code).not.toBe('ADDRESS_TOKEN_MISSING');
			expect(json.code).not.toBe('ADDRESS_TOKEN_INVALID');
			expect(json.code).not.toBe('ADDRESS_TOKEN_EXPIRED');
		}
	});

	it('passes the gate when a valid addr-mode token matches coordinates AND address_hash', async () => {
		mockServerQuery.mockResolvedValue({ didKey: null });
		mockServerMutation.mockResolvedValue({
			districtCredentialId: 'cred_123',
			districtHash: 'hash',
			expiresAt: Date.now() + 1_000_000
		});
		const issued = await issueAddressResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			address: ADDRESS
		});
		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'shadow_atlas',
				district_commitment: '0x' + 'a'.repeat(64),
				coordinates: COORDS,
				address_token: issued.token,
				address_hash: issued.addressHash
			})
		);
		const json = await response.json();
		if (response.status === 400) {
			expect(json.code).not.toBe('ADDRESS_TOKEN_MISSING');
			expect(json.code).not.toBe('ADDRESS_TOKEN_INVALID');
			expect(json.code).not.toBe('ADDRESS_TOKEN_EXPIRED');
		}
	});

	it('skips the gate entirely when no coordinates are supplied', async () => {
		// civic_api method without coordinates: F-2.4 gate must not fire.
		mockServerQuery.mockResolvedValue({ didKey: null });
		mockServerMutation.mockResolvedValue({
			districtCredentialId: 'cred_456',
			districtHash: 'hash',
			expiresAt: Date.now() + 1_000_000
		});
		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api',
				officials: []
			})
		);
		const json = await response.json();
		// Whatever the downstream outcome, it should not be ADDRESS_TOKEN_*.
		if (response.status === 400) {
			expect(json.code).not.toBe('ADDRESS_TOKEN_MISSING');
		}
	});
});
