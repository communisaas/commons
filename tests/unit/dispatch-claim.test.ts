import { describe, it, expect } from 'vitest';
import {
	signDispatchClaim,
	verifyDispatchClaim
} from '$lib/server/email/dispatch-claim';

const SECRET = 'test-dispatch-secret-for-hmac-' + 'a'.repeat(34); // 32+ bytes
const PAYLOAD = {
	orgId: 'kg1org123',
	blastId: 'kn1blast456',
	allowedHashes: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]
};

describe('signDispatchClaim', () => {
	it('produces a token with payload.signature shape', () => {
		const claim = signDispatchClaim(PAYLOAD, SECRET);
		expect(claim).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
	});

	it('refuses empty secret', () => {
		expect(() => signDispatchClaim(PAYLOAD, '')).toThrow();
	});

	it('produces different signatures for different payloads', () => {
		const a = signDispatchClaim(PAYLOAD, SECRET);
		const b = signDispatchClaim({ ...PAYLOAD, blastId: 'kn1other' }, SECRET);
		expect(a).not.toBe(b);
	});
});

describe('verifyDispatchClaim', () => {
	it('verifies a token signed under the same secret', () => {
		const claim = signDispatchClaim(PAYLOAD, SECRET);
		const verified = verifyDispatchClaim(claim, SECRET);
		expect(verified).not.toBeNull();
		expect(verified!.orgId).toBe(PAYLOAD.orgId);
		expect(verified!.blastId).toBe(PAYLOAD.blastId);
		expect(verified!.allowedHashes).toEqual(PAYLOAD.allowedHashes);
		expect(verified!.exp).toBeGreaterThan(verified!.iat);
	});

	it('rejects token under a different secret', () => {
		const claim = signDispatchClaim(PAYLOAD, SECRET);
		expect(verifyDispatchClaim(claim, 'different-secret')).toBeNull();
	});

	it('rejects malformed token', () => {
		expect(verifyDispatchClaim('!!!.!!!', SECRET)).toBeNull();
		expect(verifyDispatchClaim('only-one-part', SECRET)).toBeNull();
		expect(verifyDispatchClaim('', SECRET)).toBeNull();
	});

	it('rejects token with tampered payload (signature must verify the new bytes)', () => {
		const claim = signDispatchClaim(PAYLOAD, SECRET);
		// Tamper the payload portion — keeps the signature length intact but
		// breaks the HMAC. The verifier must reject without timing leak.
		const [_payload, sig] = claim.split('.');
		// Substitute a payload that decodes to a different blastId.
		const tampered =
			Buffer.from(
				JSON.stringify({
					...PAYLOAD,
					blastId: 'kn1tampered',
					iat: Date.now(),
					exp: Date.now() + 60_000
				}),
				'utf-8'
			)
				.toString('base64')
				.replace(/\+/g, '-')
				.replace(/\//g, '_')
				.replace(/=+$/g, '') + '.' + sig;
		expect(verifyDispatchClaim(tampered, SECRET)).toBeNull();
	});

	it('rejects expired token', async () => {
		// Sign a claim with synthetic exp in the past.
		// Use signDispatchClaim then patch the payload to set exp < now.
		const claim = signDispatchClaim(PAYLOAD, SECRET);
		// The verifier checks Date.now() > payload.exp; we can't artificially
		// move the clock, so instead verify via a payload we know is expired.
		// Recompute manually: payload with exp = 0 and a fresh signature.
		const { createHmac } = await import('node:crypto');
		const expiredPayload = {
			orgId: PAYLOAD.orgId,
			blastId: PAYLOAD.blastId,
			allowedHashes: PAYLOAD.allowedHashes,
			iat: 0,
			exp: 0
		};
		const payloadJson = JSON.stringify(expiredPayload);
		const payloadB64 = Buffer.from(payloadJson, 'utf-8')
			.toString('base64')
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');
		const sig = createHmac('sha256', SECRET).update(payloadB64).digest();
		const sigB64 = sig
			.toString('base64')
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');
		const expiredClaim = `${payloadB64}.${sigB64}`;
		expect(verifyDispatchClaim(expiredClaim, SECRET)).toBeNull();
		// Sanity: the same claim with future exp WOULD verify
		expect(verifyDispatchClaim(claim, SECRET)).not.toBeNull();
	});
});

describe('verifyDispatchClaim — multi-secret rotation', () => {
	const SECRET_A = 'a'.repeat(64);
	const SECRET_B = 'b'.repeat(64);

	it('verifies a claim signed under SECRET_A when SECRET_A is in the candidates array', () => {
		const claim = signDispatchClaim(PAYLOAD, SECRET_A);
		expect(verifyDispatchClaim(claim, [SECRET_A, SECRET_B])).not.toBeNull();
	});

	it('verifies a claim signed under SECRET_B (in-flight rotation) when both are candidates', () => {
		// SvelteKit signed under SECRET_B (was the active before rotation).
		// Lambda has rotated: SECRET_A is now active, SECRET_B is _PREVIOUS.
		// Lambda must still accept the claim during the overlap window.
		const claim = signDispatchClaim(PAYLOAD, SECRET_B);
		expect(verifyDispatchClaim(claim, [SECRET_A, SECRET_B])).not.toBeNull();
	});

	it('rejects a claim that matches NEITHER candidate (post-rotation, old _PREVIOUS dropped)', () => {
		const claim = signDispatchClaim(PAYLOAD, SECRET_A);
		const SECRET_C = 'c'.repeat(64);
		const SECRET_D = 'd'.repeat(64);
		expect(verifyDispatchClaim(claim, [SECRET_C, SECRET_D])).toBeNull();
	});

	it('returns null when candidates array is empty', () => {
		const claim = signDispatchClaim(PAYLOAD, SECRET_A);
		expect(verifyDispatchClaim(claim, [])).toBeNull();
	});

	it('filters out empty-string secrets from the candidates array', () => {
		const claim = signDispatchClaim(PAYLOAD, SECRET_A);
		// Empty strings should be ignored — operator misconfig caught.
		expect(verifyDispatchClaim(claim, ['', SECRET_A])).not.toBeNull();
		expect(verifyDispatchClaim(claim, ['', ''])).toBeNull();
	});

	it('preserves backward-compat with single-string-secret signature', () => {
		const claim = signDispatchClaim(PAYLOAD, SECRET_A);
		// Existing callers can still pass a string instead of an array.
		expect(verifyDispatchClaim(claim, SECRET_A)).not.toBeNull();
		expect(verifyDispatchClaim(claim, SECRET_B)).toBeNull();
	});
});
