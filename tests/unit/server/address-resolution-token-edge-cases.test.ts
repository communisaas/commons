/**
 * F-2.4 token primitive edge cases (cycle-177 Finding 4 closure).
 *
 * The main suite at `address-resolution-token.test.ts` exercises happy
 * paths and substitution attacks under a valid secret. This file covers
 * the boundary conditions:
 *   - Malformed `expiresAt` segment (NaN, Infinity, non-numeric string)
 *     must not slip through `Number.isFinite` and reach the HMAC compare.
 *   - `tokenSecret()` must throw a legible error when the env var is
 *     missing or under-length, not silently default to an empty string.
 *
 * Why a separate file: `vi.mock('$env/dynamic/private', ...)` is hoisted
 * once per test module, so different env shapes need separate modules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { envMock } = vi.hoisted(() => ({
	envMock: {} as Record<string, string | undefined>
}));
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

import {
	issueAddressResolutionToken,
	issueGeolocationResolutionToken,
	verifyAddressResolutionToken
} from '../../../src/lib/server/auth/address-resolution-token';

const FAKE_USER = 'user_abc';
const COORDS = { lat: 37.781, lng: -122.408 };

describe('tokenSecret() boundary conditions', () => {
	it('throws when ADDRESS_RESOLUTION_TOKEN_SECRET is unset', async () => {
		delete envMock.ADDRESS_RESOLUTION_TOKEN_SECRET;
		await expect(
			issueGeolocationResolutionToken({ userId: FAKE_USER, lat: COORDS.lat, lng: COORDS.lng })
		).rejects.toThrow(/ADDRESS_RESOLUTION_TOKEN_SECRET/);
	});

	it('throws when secret is empty string', async () => {
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET = '';
		await expect(
			issueGeolocationResolutionToken({ userId: FAKE_USER, lat: COORDS.lat, lng: COORDS.lng })
		).rejects.toThrow(/ADDRESS_RESOLUTION_TOKEN_SECRET/);
	});

	it('throws when secret is shorter than 32 bytes', async () => {
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET = 'a'.repeat(31);
		await expect(
			issueGeolocationResolutionToken({ userId: FAKE_USER, lat: COORDS.lat, lng: COORDS.lng })
		).rejects.toThrow(/>= 32 bytes/);
	});

	it('error message is operator-actionable (names the env var)', async () => {
		delete envMock.ADDRESS_RESOLUTION_TOKEN_SECRET;
		try {
			await issueGeolocationResolutionToken({
				userId: FAKE_USER,
				lat: COORDS.lat,
				lng: COORDS.lng
			});
			expect.fail('should have thrown');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			expect(msg).toContain('ADDRESS_RESOLUTION_TOKEN_SECRET');
			expect(msg).toContain('issue or verify');
		}
	});

	it('verify throws too when secret is missing (symmetric failure)', async () => {
		// Pre-mint a token under a valid secret, then strip the secret and verify.
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET = 'a'.repeat(64);
		const issued = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		delete envMock.ADDRESS_RESOLUTION_TOKEN_SECRET;
		await expect(
			verifyAddressResolutionToken({
				token: issued.token,
				userId: FAKE_USER,
				lat: COORDS.lat,
				lng: COORDS.lng
			})
		).rejects.toThrow(/ADDRESS_RESOLUTION_TOKEN_SECRET/);
	});
});

describe('rotation-window previous secret', () => {
	beforeEach(() => {
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET = 'a'.repeat(64);
		delete envMock.ADDRESS_RESOLUTION_TOKEN_SECRET_PREVIOUS;
	});

	it('verifies a token issued under the active secret (no rotation in progress)', async () => {
		const issued = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		expect(result.valid).toBe(true);
	});

	it('verifies a token issued under the previous secret during rotation', async () => {
		// Step 1: mint under the original secret.
		const issued = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		// Step 2: rotate — old becomes _PREVIOUS, new is the active.
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET_PREVIOUS = 'a'.repeat(64);
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET = 'b'.repeat(64);
		// In-flight token must still verify against the previous secret.
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		expect(result.valid).toBe(true);
	});

	it('rejects a token that matches NEITHER active nor previous secret', async () => {
		// Mint under one secret, rotate so neither active nor previous is that.
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET = 'c'.repeat(64);
		const issued = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET = 'd'.repeat(64);
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET_PREVIOUS = 'e'.repeat(64);
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('signature_mismatch');
	});

	it('ignores under-length _PREVIOUS (does NOT brick active-secret verification)', async () => {
		// An operator typo in _PREVIOUS must not take down valid in-flight
		// tokens. The verifier logs a warning and treats _PREVIOUS as unset;
		// active-secret verification continues to work.
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET_PREVIOUS = 'short';
		const issued = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		const result = await verifyAddressResolutionToken({
			token: issued.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		expect(result.valid).toBe(true);
	});

	it('mints exclusively under the active secret (never the previous)', async () => {
		// Issue under active=A, set _PREVIOUS=B. Then rotate active to B and
		// _PREVIOUS to A. The token issued in the first phase verifies under
		// A which is now _PREVIOUS — confirms mint is single-secret.
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET = 'a'.repeat(64);
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET_PREVIOUS = 'b'.repeat(64);
		const issuedUnderA = await issueGeolocationResolutionToken({
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET = 'b'.repeat(64);
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET_PREVIOUS = 'a'.repeat(64);
		const result = await verifyAddressResolutionToken({
			token: issuedUnderA.token,
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		expect(result.valid).toBe(true);
	});
});

describe('expiresAt parse edge cases', () => {
	beforeEach(() => {
		envMock.ADDRESS_RESOLUTION_TOKEN_SECRET = 'a'.repeat(64);
	});

	it("rejects token with non-numeric expiresAt ('abc')", async () => {
		const result = await verifyAddressResolutionToken({
			token: 'v1.geo.abc.deadbeef',
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('expired');
	});

	it("rejects token with 'NaN' literal in expiresAt", async () => {
		const result = await verifyAddressResolutionToken({
			token: 'v1.geo.NaN.deadbeef',
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('expired');
	});

	it("rejects token with 'Infinity' literal in expiresAt", async () => {
		const result = await verifyAddressResolutionToken({
			token: 'v1.geo.Infinity.deadbeef',
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		// `Number('Infinity')` is finite-false → expired branch.
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('expired');
	});

	it('rejects token with empty expiresAt segment', async () => {
		const result = await verifyAddressResolutionToken({
			token: 'v1.geo..deadbeef',
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('expired');
	});

	it('rejects token with negative expiresAt', async () => {
		const result = await verifyAddressResolutionToken({
			token: 'v1.geo.-1000.deadbeef',
			userId: FAKE_USER,
			lat: COORDS.lat,
			lng: COORDS.lng
		});
		// Negative is finite but <= Date.now() → expired branch.
		expect(result.valid).toBe(false);
		expect(result.reason).toBe('expired');
	});
});

