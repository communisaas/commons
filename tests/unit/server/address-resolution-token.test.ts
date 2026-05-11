/**
 * F-2.4 — address-resolution-token primitive tests.
 *
 * Covers: address canonicalization stability, token issue/verify round-trip,
 * tampered-coordinate detection, expiry, version mismatch, malformed tokens.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ADDRESS_RESOLUTION_TOKEN_SECRET: 'a'.repeat(64)
	}
}));

import {
	canonicalizeAddress,
	computeAddressHash,
	issueAddressResolutionToken,
	issueGeolocationResolutionToken,
	verifyAddressResolutionToken
} from '../../../src/lib/server/auth/address-resolution-token';

const ADDRESS = {
	street: '12 Mint Plaza',
	city: 'San Francisco',
	state: 'CA',
	zip: '94103',
	country: 'US' as const
};

describe('canonicalizeAddress', () => {
	it('lowercases street + city, uppercases state/zip/country', () => {
		const c = canonicalizeAddress(ADDRESS);
		expect(c).toBe('US|CA|94103|san francisco|12 mint plaza');
	});

	it('is whitespace-stable', () => {
		const c1 = canonicalizeAddress({ ...ADDRESS, street: '  12  Mint   Plaza  ' });
		const c2 = canonicalizeAddress(ADDRESS);
		expect(c1).toBe(c2);
	});

	it('defaults country to US when missing', () => {
		const { country: _country, ...noCountry } = ADDRESS;
		const c = canonicalizeAddress(noCountry);
		expect(c.startsWith('US|')).toBe(true);
	});

	it('produces different hashes for different addresses', async () => {
		const h1 = await computeAddressHash(ADDRESS);
		const h2 = await computeAddressHash({ ...ADDRESS, street: '99 Mint Plaza' });
		expect(h1).not.toBe(h2);
		expect(h1).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('issueAddressResolutionToken / verifyAddressResolutionToken', () => {
	const FAKE_USER = 'user_abc123';
	const COORDS = { lat: 37.781, lng: -122.408 };

	it('round-trips a fresh token successfully', async () => {
		const issued = await issueAddressResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			address: ADDRESS
		});
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			addressHash: issued.addressHash
		});
		expect(result.valid).toBe(true);
	});

	it('rejects a token whose lat is altered (coordinate substitution)', async () => {
		const issued = await issueAddressResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			address: ADDRESS
		});
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: 40.0, // wrong lat
			lng: COORDS.lng,
			addressHash: issued.addressHash
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('signature_mismatch');
	});

	it('rejects a token whose lng is altered', async () => {
		const issued = await issueAddressResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			address: ADDRESS
		});
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: -100.0,
			addressHash: issued.addressHash
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('signature_mismatch');
	});

	it('rejects a token replayed across users', async () => {
		const issued = await issueAddressResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			address: ADDRESS
		});
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: 'user_different',
			lat: COORDS.lat,
			lng: COORDS.lng,
			addressHash: issued.addressHash
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('signature_mismatch');
	});

	it('rejects a token whose addressHash is altered', async () => {
		const issued = await issueAddressResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			address: ADDRESS
		});
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			addressHash: '0'.repeat(64)
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('signature_mismatch');
	});

	it('rejects malformed tokens', async () => {
		const r1 = await verifyAddressResolutionToken({
			token: 'not-a-token',
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			addressHash: 'abc'
		});
		expect(r1.valid).toBe(false);
		expect(r1.reason).toBe('malformed');

		const r2 = await verifyAddressResolutionToken({
			token: 'v1.addr.123.deadbeef.extra',
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			addressHash: 'abc'
		});
		expect(r2.valid).toBe(false);
		expect(r2.reason).toBe('malformed');
	});

	it('rejects expired tokens', async () => {
		const issued = await issueAddressResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			address: ADDRESS
		});
		// Reach into the token shape: replace expiresAt with a past timestamp.
		// The signature won't match (binds expiresAt) so we get signature_mismatch
		// for a forged-past token; explicitly testing the expiry check requires
		// crafting a token with a past expiresAt and matching signature, which
		// requires the secret — so issue a fresh one and roll the clock forward.
		vi.useFakeTimers();
		try {
			vi.setSystemTime(Date.now() + 31 * 60 * 1000); // > 30 min TTL
			const result = await verifyAddressResolutionToken({
				token: issued.token,
				userId: FAKE_USER,
				lat: COORDS.lat,
				lng: COORDS.lng,
				addressHash: issued.addressHash
			});
			expect(result.valid).toBe(false);
			expect(result.reason).toBe('expired');
		} finally {
			vi.useRealTimers();
		}
	});

	it('rejects tokens with unsupported version prefix', async () => {
		const result = await verifyAddressResolutionToken({
			token: 'v9.addr.9999999999999.deadbeef',
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			addressHash: 'abc'
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('unsupported_version');
	});

	it('rejects tokens with unsupported mode', async () => {
		const result = await verifyAddressResolutionToken({
			token: 'v1.weird.9999999999999.deadbeef',
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			addressHash: 'abc'
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('unsupported_mode');
	});

	it('rejects a token whose signature is shorter than the expected HMAC length', async () => {
		// timingSafeEqual throws on length mismatch, so
		// the verify function early-returns before the constant-time compare.
		// This test pins that contract: a malicious client providing a
		// truncated signature must hit signature_mismatch deterministically.
		const issued = await issueGeolocationResolutionToken({
			userId: 'user_abc123',
			lat: 37.781,
			lng: -122.408
		});
		// Valid format `v1.geo.<expiresAt>.<sig>`; truncate the signature.
		const segments = issued.token.split('.');
		const truncatedToken = `${segments[0]}.${segments[1]}.${segments[2]}.deadbeef`;
		const result = await verifyAddressResolutionToken({
			token: truncatedToken,
			userId: 'user_abc123',
			lat: 37.781,
			lng: -122.408
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('signature_mismatch');
	});

	it('rejects an addr-mode token presented without addressHash', async () => {
		const issued = await issueAddressResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			address: ADDRESS
		});
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			addressHash: null
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('mode_mismatch');
	});
});

describe('issueGeolocationResolutionToken (geo mode)', () => {
	const FAKE_USER = 'user_abc123';
	const COORDS = { lat: 37.781, lng: -122.408 };

	it('round-trips a geo-mode token', async () => {
		const issued = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		expect(issued.addressHash).toBeNull();
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		expect(result.valid).toBe(true);
		expect(result.mode).toBe('geo');
	});

	it('rejects a geo-mode token presented WITH an addressHash claim', async () => {
		// Defense against an attacker upgrading a geo-mode token into a
		// faux-addr-mode by tacking on a hash field at verify time.
		const issued = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			addressHash: 'a'.repeat(64)
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('mode_mismatch');
	});

	it('rejects a geo-mode token whose lat is altered', async () => {
		const issued = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: 40.0,
			lng: COORDS.lng
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('signature_mismatch');
	});

	it('rejects an addr-mode token presented as geo-mode', async () => {
		// Defense against the inverse: an attacker stripping addressHash
		// from an addr-mode token to bypass the addr-mode validation.
		const issued = await issueAddressResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng,
			address: { street: '12 Mint Plaza', city: 'San Francisco', state: 'CA', zip: '94103' }
		});
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
			// addressHash omitted
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('mode_mismatch');
	});
});
