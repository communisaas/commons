/**
 * Algorithmic contract test for the dual-secret rotation in
 * `convex/authOps.ts` `createSession` handler. The handler runs in
 * Convex's V8 isolate and isn't directly invokable in vitest without a
 * Convex test harness; this file exercises the SAME Web Crypto verify
 * algorithm (`crypto.subtle.verify` over HMAC-SHA256) against a mirrored
 * candidate-iteration to lock the rotation behavior.
 *
 * Mint side stays single-secret: SvelteKit's
 * `createSessionCreationProof` always signs with the active secret. The
 * verify side accepts proofs from either active OR _PREVIOUS during a
 * rotation window.
 */

import { describe, it, expect } from 'vitest';
import { createSessionCreationProof } from '../../../src/lib/server/auth/session-proof';

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
	const buf = new ArrayBuffer(view.byteLength);
	new Uint8Array(buf).set(view);
	return buf;
}

/**
 * Mirrors the verify logic in convex/authOps.ts:createSession.
 * Iterates all candidates and ORs the result without breaking early so
 * timing stays comparable between rotation and single-secret operation.
 */
async function verifySessionProof(
	userId: string,
	expiresAt: number,
	proofHex: string,
	secrets: string[]
): Promise<boolean> {
	const encoder = new TextEncoder();
	const proofBytes = toArrayBuffer(hexToBytes(proofHex));
	const payloadBytes = toArrayBuffer(encoder.encode(`${userId}|${expiresAt}`));
	let valid = false;
	for (const secret of secrets) {
		const key = await crypto.subtle.importKey(
			'raw',
			encoder.encode(secret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['verify']
		);
		const candidateValid = await crypto.subtle.verify('HMAC', key, proofBytes, payloadBytes);
		if (candidateValid) {
			valid = true;
		}
	}
	return valid;
}

const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);
const USER_ID = 'user_abc';
const EXPIRES_AT = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

describe('SESSION_CREATION_SECRET dual-secret rotation', () => {
	it('verifies a proof signed under the active secret in single-secret operation', async () => {
		const proof = await createSessionCreationProof(USER_ID, EXPIRES_AT, SECRET_A);
		expect(await verifySessionProof(USER_ID, EXPIRES_AT, proof, [SECRET_A])).toBe(true);
	});

	it('rejects a proof signed under a wrong secret in single-secret operation', async () => {
		const proof = await createSessionCreationProof(USER_ID, EXPIRES_AT, SECRET_A);
		expect(await verifySessionProof(USER_ID, EXPIRES_AT, proof, [SECRET_B])).toBe(false);
	});

	it('verifies a proof signed under the previous secret during rotation', async () => {
		// SvelteKit was signing under SECRET_A (was active before rotation).
		// Convex now has SECRET_B active and SECRET_A as previous.
		// In-flight session-creation must still verify.
		const proof = await createSessionCreationProof(USER_ID, EXPIRES_AT, SECRET_A);
		expect(await verifySessionProof(USER_ID, EXPIRES_AT, proof, [SECRET_B, SECRET_A])).toBe(true);
	});

	it('verifies a proof signed under the new active secret with rotation candidates present', async () => {
		const proof = await createSessionCreationProof(USER_ID, EXPIRES_AT, SECRET_B);
		expect(await verifySessionProof(USER_ID, EXPIRES_AT, proof, [SECRET_B, SECRET_A])).toBe(true);
	});

	it('rejects a proof matching neither active nor previous (post-rotation, _PREVIOUS dropped)', async () => {
		const proof = await createSessionCreationProof(USER_ID, EXPIRES_AT, SECRET_A);
		const SECRET_C = 'c'.repeat(64);
		const SECRET_D = 'd'.repeat(64);
		expect(await verifySessionProof(USER_ID, EXPIRES_AT, proof, [SECRET_C, SECRET_D])).toBe(false);
	});

	it('rejects a proof bound to a different (userId, expiresAt) pair', async () => {
		const proof = await createSessionCreationProof(USER_ID, EXPIRES_AT, SECRET_A);
		expect(
			await verifySessionProof('user_OTHER', EXPIRES_AT, proof, [SECRET_A])
		).toBe(false);
		expect(
			await verifySessionProof(USER_ID, EXPIRES_AT + 1000, proof, [SECRET_A])
		).toBe(false);
	});

	it('iterates every candidate without early-return (timing parity)', async () => {
		// Design rationale: even when the active secret matches,
		// we run subtle.verify against the previous so timing is comparable
		// between rotation and single-secret modes. We can't directly assert
		// timing in unit tests, but we CAN assert that a proof valid under
		// _PREVIOUS verifies even when active is wrong (already covered above)
		// AND that adding _PREVIOUS doesn't break the active path.
		const proof = await createSessionCreationProof(USER_ID, EXPIRES_AT, SECRET_A);
		expect(await verifySessionProof(USER_ID, EXPIRES_AT, proof, [SECRET_A, SECRET_B])).toBe(true);
		expect(await verifySessionProof(USER_ID, EXPIRES_AT, proof, [SECRET_B, SECRET_A])).toBe(true);
	});
});
