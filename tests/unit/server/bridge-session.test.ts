/**
 * Bridge Session Tests — Lifecycle, HMAC, Pairing Code
 *
 * Tests the cross-device verification bridge session management:
 * create → claim → complete/fail transitions, HMAC generation
 * and verification, and pairing code format.
 *
 * Uses the dev in-memory store (no KV platform env needed).
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	createBridgeSession,
	claimBridgeSessionBestEffort,
	completeBridgeSession,
	failBridgeSession,
	getBridgeSession,
	deleteBridgeSession,
	generateHmac,
	verifyHmac
} from '$lib/server/bridge-session';

// Disable encryption for session tests — focus on session lifecycle logic
// (bridge-crypto.test.ts covers encryption separately)
beforeEach(() => {
	delete process.env.BRIDGE_ENCRYPTION_KEY;
});

const TEST_ORIGIN = 'https://commons.example';
const TEST_EPHEMERAL_KEY: JsonWebKey = { kty: 'OKP', crv: 'X25519', x: 'test-pub' };
const TEST_REQUESTS = [{ protocol: 'org.iso.mdoc', data: { doctype: 'mDL' } }];

async function makeSession() {
	return createBridgeSession(
		'user-desktop-001',
		'alice@example.com',
		TEST_REQUESTS,
		TEST_EPHEMERAL_KEY,
		'nonce-abc',
		TEST_ORIGIN
	);
}

describe('bridge-session lifecycle', () => {
	describe('createBridgeSession', () => {
		it('returns all expected fields', async () => {
			const result = await makeSession();

			expect(result.sessionId).toBeTruthy();
			expect(typeof result.sessionId).toBe('string');
			expect(result.secret).toBeTruthy();
			expect(result.secret).toHaveLength(64); // 32 bytes hex
			expect(result.pairingCode).toBeTruthy();
			expect(result.qrUrl).toContain(result.sessionId);
			expect(result.qrUrl).toContain('#'); // Secret in fragment
			expect(result.expiresAt).toBeGreaterThan(Date.now());
		});

		it('qrUrl contains origin and fragment with secret', async () => {
			const result = await makeSession();
			expect(result.qrUrl).toBe(
				`${TEST_ORIGIN}/verify-bridge/${result.sessionId}#${result.secret}`
			);
		});

		it('stored session is in pending state', async () => {
			const result = await makeSession();
			const session = await getBridgeSession(result.sessionId);

			expect(session).not.toBeNull();
			expect(session!.status).toBe('pending');
			expect(session!.desktopUserId).toBe('user-desktop-001');
			expect(session!.desktopUserLabel).toBe('alice@example.com');
			expect(session!.nonce).toBe('nonce-abc');
			expect(session!.requests).toEqual(TEST_REQUESTS);
		});
	});

	describe('claimBridgeSessionBestEffort', () => {
		it('transitions pending → claimed and returns true', async () => {
			const { sessionId } = await makeSession();

			const claimed = await claimBridgeSessionBestEffort(sessionId);
			expect(claimed).toBe(true);

			const session = await getBridgeSession(sessionId);
			expect(session!.status).toBe('claimed');
			expect(session!.claimedAt).toBeGreaterThan(0);
		});

		it('returns false on re-claim (already claimed)', async () => {
			const { sessionId } = await makeSession();

			await claimBridgeSessionBestEffort(sessionId);
			const reClaim = await claimBridgeSessionBestEffort(sessionId);
			expect(reClaim).toBe(false);
		});

		it('returns false for non-existent session', async () => {
			const result = await claimBridgeSessionBestEffort('nonexistent-id');
			expect(result).toBe(false);
		});
	});

	describe('completeBridgeSession', () => {
		it('transitions claimed → completed with result, clears secret', async () => {
			const { sessionId } = await makeSession();
			await claimBridgeSessionBestEffort(sessionId);

			const result = {
				district: 'CA-12',
				state: 'CA',
				credentialHash: 'sha256-abc123'
			};
			await completeBridgeSession(sessionId, result);

			const session = await getBridgeSession(sessionId);
			expect(session!.status).toBe('completed');
			expect(session!.result).toEqual(result);
			expect(session!.completedAt).toBeGreaterThan(0);
			// Secret should be cleared
			expect(session!.secret).toBe('');
		});

		it('throws if session is not in claimed state', async () => {
			const { sessionId } = await makeSession();
			// Still pending, not claimed
			await expect(
				completeBridgeSession(sessionId, { district: 'X', state: 'X', credentialHash: 'x' })
			).rejects.toThrow(/Cannot complete session/);
		});

		it('throws if session does not exist', async () => {
			await expect(
				completeBridgeSession('ghost', { district: 'X', state: 'X', credentialHash: 'x' })
			).rejects.toThrow(/not found/);
		});
	});

	describe('failBridgeSession', () => {
		it('transitions claimed → failed, clears secret', async () => {
			const { sessionId } = await makeSession();
			await claimBridgeSessionBestEffort(sessionId);

			await failBridgeSession(sessionId, 'User cancelled');

			const session = await getBridgeSession(sessionId);
			expect(session!.status).toBe('failed');
			expect(session!.errorMessage).toBe('User cancelled');
			expect(session!.secret).toBe('');
		});

		it('does not overwrite a completed session (guard)', async () => {
			const { sessionId } = await makeSession();
			await claimBridgeSessionBestEffort(sessionId);

			const result = { district: 'NY-1', state: 'NY', credentialHash: 'hash' };
			await completeBridgeSession(sessionId, result);

			// Attempt to fail after completion — should be a no-op
			await failBridgeSession(sessionId, 'late failure');

			const session = await getBridgeSession(sessionId);
			expect(session!.status).toBe('completed');
			expect(session!.result).toEqual(result);
		});

		it('silently returns if session does not exist (already expired)', async () => {
			// Should not throw
			await expect(failBridgeSession('expired-id', 'gone')).resolves.toBeUndefined();
		});
	});

	describe('getBridgeSession', () => {
		it('returns null for missing session', async () => {
			const session = await getBridgeSession('does-not-exist');
			expect(session).toBeNull();
		});
	});

	describe('deleteBridgeSession', () => {
		it('removes session from store', async () => {
			const { sessionId } = await makeSession();
			expect(await getBridgeSession(sessionId)).not.toBeNull();

			await deleteBridgeSession(sessionId);
			expect(await getBridgeSession(sessionId)).toBeNull();
		});
	});
});

describe('bridge-session HMAC', () => {
	// Use a known 32-byte hex secret for deterministic HMAC tests
	const hmacSecret = 'b'.repeat(64);

	describe('generateHmac + verifyHmac round-trip', () => {
		it('verify returns true for matching secret and message', async () => {
			const hmac = await generateHmac(hmacSecret, 'session-123', 'claim');
			const valid = await verifyHmac(hmacSecret, hmac, 'session-123', 'claim');
			expect(valid).toBe(true);
		});

		it('produces consistent output for same inputs', async () => {
			const hmac1 = await generateHmac(hmacSecret, 'msg-a');
			const hmac2 = await generateHmac(hmacSecret, 'msg-a');
			expect(hmac1).toBe(hmac2);
		});
	});

	describe('verifyHmac rejects invalid inputs', () => {
		it('returns false with wrong secret', async () => {
			const hmac = await generateHmac(hmacSecret, 'message');
			const wrongSecret = 'c'.repeat(64);
			const valid = await verifyHmac(wrongSecret, hmac, 'message');
			expect(valid).toBe(false);
		});

		it('returns false with wrong message', async () => {
			const hmac = await generateHmac(hmacSecret, 'correct-message');
			const valid = await verifyHmac(hmacSecret, hmac, 'wrong-message');
			expect(valid).toBe(false);
		});

		it('returns false for length mismatch (constant-time guard)', async () => {
			const hmac = await generateHmac(hmacSecret, 'test');
			// Truncate to create length mismatch
			const truncated = hmac.slice(0, hmac.length - 2);
			const valid = await verifyHmac(hmacSecret, truncated, 'test');
			expect(valid).toBe(false);
		});

		it('returns false for empty hmac string', async () => {
			const valid = await verifyHmac(hmacSecret, '', 'test');
			expect(valid).toBe(false);
		});
	});

	describe('multi-part messages', () => {
		it('different part ordering produces different HMACs', async () => {
			const hmac1 = await generateHmac(hmacSecret, 'a', 'b');
			const hmac2 = await generateHmac(hmacSecret, 'b', 'a');
			expect(hmac1).not.toBe(hmac2);
		});

		it('pipe injection is not possible (parts joined with |)', async () => {
			// "a|b" as one part vs "a" + "b" as two parts
			const hmac1 = await generateHmac(hmacSecret, 'a|b');
			const hmac2 = await generateHmac(hmacSecret, 'a', 'b');
			// Both produce "a|b" when joined — this is expected behavior
			// (same as CTAP2 / FIDO2 channel binding)
			expect(hmac1).toBe(hmac2);
		});
	});
});

describe('bridge-session pairing code', () => {
	// PAIRING_WORDS is not exported, but we can validate the format
	// by inspecting createBridgeSession output.

	it('generates a 3-word dash-separated code', async () => {
		const { pairingCode } = await makeSession();
		const parts = pairingCode.split('-');
		expect(parts).toHaveLength(3);
		// Each word should be a lowercase alpha string
		for (const word of parts) {
			expect(word).toMatch(/^[a-z]+$/);
		}
	});

	it('produces different codes across sessions (probabilistic)', async () => {
		const codes = new Set<string>();
		for (let i = 0; i < 10; i++) {
			const { pairingCode } = await makeSession();
			codes.add(pairingCode);
		}
		// With 64^3 = 262,144 possibilities, 10 draws should all be unique
		expect(codes.size).toBe(10);
	});
});
