/**
 * F1 Revocation Flow Integration Tests
 *
 * Stage 5 — verifies the Convex-side state machine:
 *   verifyAddress patch  -> revocationStatus='pending'
 *   emitOnChainRevocation success  -> revocationStatus='confirmed' + txHash
 *   emitOnChainRevocation failures with retry budget exhausted -> 'failed'
 *   rescheduleStuckRevocations picks up credentials >1h pending
 *
 * Tests run against an in-memory mock of the Convex runtime. We mock
 * `fetch` to simulate the internal emit endpoint and verify the state
 * transitions without actually reaching a relayer wallet.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type RevocationStatus = 'pending' | 'confirmed' | 'failed';

interface CredentialRow {
	_id: string;
	userId: string;
	districtCommitment?: string;
	revokedAt?: number;
	revocationStatus?: RevocationStatus;
	revocationTxHash?: string;
	revocationAttempts?: number;
	revocationLastAttemptAt?: number;
}

// Minimal mock of the emit flow transferred out of convex/users.ts. This
// mirrors the logic without needing a running Convex dev server.
const MAX_REVOCATION_ATTEMPTS = 6;
const BACKOFF_MS: number[] = [
	60_000,
	5 * 60_000,
	30 * 60_000,
	3 * 60 * 60_000,
	12 * 60 * 60_000,
	24 * 60 * 60_000,
];
const STUCK_PENDING_AGE_MS = 60 * 60_000;

class MockConvex {
	public credentials = new Map<string, CredentialRow>();
	public scheduledEmits: Array<{ credentialId: string; delayMs: number }> = [];

	markRevoked(credentialId: string, now: number): { scheduled: boolean } {
		const cred = this.credentials.get(credentialId);
		if (!cred) return { scheduled: false };
		if (cred.revokedAt) return { scheduled: false };
		cred.revokedAt = now;
		const scheduled = Boolean(cred.districtCommitment);
		if (scheduled) {
			cred.revocationStatus = 'pending';
			cred.revocationAttempts = 0;
			cred.revocationLastAttemptAt = now;
			this.scheduledEmits.push({ credentialId, delayMs: 0 });
		}
		return { scheduled };
	}

	async emitOnChainRevocation(
		credentialId: string,
		fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
	): Promise<void> {
		const cred = this.credentials.get(credentialId);
		if (!cred) return;
		if (cred.revocationStatus === 'confirmed' || cred.revocationStatus === 'failed') return;
		if (!cred.districtCommitment) {
			cred.revocationStatus = 'failed';
			cred.revocationLastAttemptAt = Date.now();
			return;
		}
		const attempts = (cred.revocationAttempts ?? 0) + 1;
		cred.revocationAttempts = attempts;
		cred.revocationLastAttemptAt = Date.now();

		try {
			const response = await fetchImpl('https://internal/api/internal/emit-revocation', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': 'test-secret',
				},
				body: JSON.stringify({
					credentialId,
					districtCommitment: cred.districtCommitment,
				}),
			});
			const body = (await response.json().catch(() => ({}))) as {
				success?: boolean;
				txHash?: string;
			};

			if (response.ok && body.success === true) {
				cred.revocationStatus = 'confirmed';
				cred.revocationTxHash = body.txHash;
				return;
			}

			if (attempts >= MAX_REVOCATION_ATTEMPTS) {
				cred.revocationStatus = 'failed';
				return;
			}
			this.scheduledEmits.push({
				credentialId,
				delayMs: BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
			});
		} catch {
			if (attempts >= MAX_REVOCATION_ATTEMPTS) {
				cred.revocationStatus = 'failed';
				return;
			}
			this.scheduledEmits.push({
				credentialId,
				delayMs: BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
			});
		}
	}

	rescheduleStuckRevocations(now: number): string[] {
		const rescheduled: string[] = [];
		for (const cred of this.credentials.values()) {
			if (cred.revocationStatus !== 'pending') continue;
			const last = cred.revocationLastAttemptAt ?? 0;
			if (now - last < STUCK_PENDING_AGE_MS) continue;
			if ((cred.revocationAttempts ?? 0) >= MAX_REVOCATION_ATTEMPTS) continue;
			this.scheduledEmits.push({ credentialId: cred._id, delayMs: 0 });
			rescheduled.push(cred._id);
		}
		return rescheduled;
	}
}

describe('F1 revocation flow', () => {
	let convex: MockConvex;

	beforeEach(() => {
		convex = new MockConvex();
		convex.credentials.set('cred_A', {
			_id: 'cred_A',
			userId: 'user_1',
			districtCommitment: '0xabc',
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('verifyAddress sets revocationStatus=pending on revoked credentials', () => {
		const res = convex.markRevoked('cred_A', 1000);
		expect(res.scheduled).toBe(true);
		const cred = convex.credentials.get('cred_A')!;
		expect(cred.revokedAt).toBe(1000);
		expect(cred.revocationStatus).toBe('pending');
		expect(cred.revocationAttempts).toBe(0);
		expect(convex.scheduledEmits).toHaveLength(1);
	});

	it('credential without districtCommitment does not schedule on-chain emit', () => {
		convex.credentials.set('cred_B', {
			_id: 'cred_B',
			userId: 'user_2',
		});
		const res = convex.markRevoked('cred_B', 1000);
		expect(res.scheduled).toBe(false);
		const cred = convex.credentials.get('cred_B')!;
		expect(cred.revokedAt).toBe(1000);
		expect(cred.revocationStatus).toBeUndefined();
	});

	it('emitOnChainRevocation success path: pending -> confirmed + txHash', async () => {
		convex.markRevoked('cred_A', 1000);
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ success: true, txHash: '0xdeadbeef' }), {
					status: 200,
				}),
			);

		await convex.emitOnChainRevocation('cred_A', mockFetch);

		const cred = convex.credentials.get('cred_A')!;
		expect(cred.revocationStatus).toBe('confirmed');
		expect(cred.revocationTxHash).toBe('0xdeadbeef');
		expect(cred.revocationAttempts).toBe(1);
	});

	it('emitOnChainRevocation transient failure: retry scheduled with backoff', async () => {
		convex.markRevoked('cred_A', 1000);
		convex.scheduledEmits = []; // drop the initial scheduling

		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ success: false, error: 'rpc_transient' }), {
					status: 500,
				}),
			);

		await convex.emitOnChainRevocation('cred_A', mockFetch);

		const cred = convex.credentials.get('cred_A')!;
		expect(cred.revocationStatus).toBe('pending');
		expect(cred.revocationAttempts).toBe(1);
		expect(convex.scheduledEmits).toHaveLength(1);
		expect(convex.scheduledEmits[0].delayMs).toBe(BACKOFF_MS[0]); // 1 minute
	});

	it('emitOnChainRevocation exhausts retry budget -> failed', async () => {
		convex.markRevoked('cred_A', 1000);
		const cred = convex.credentials.get('cred_A')!;
		// Simulate 5 prior failed attempts so the next call trips the budget.
		cred.revocationAttempts = MAX_REVOCATION_ATTEMPTS - 1;

		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ success: false, error: 'rpc_transient' }), {
					status: 500,
				}),
			);

		await convex.emitOnChainRevocation('cred_A', mockFetch);

		const after = convex.credentials.get('cred_A')!;
		expect(after.revocationStatus).toBe('failed');
		expect(after.revocationAttempts).toBe(MAX_REVOCATION_ATTEMPTS);
	});

	it('emitOnChainRevocation network throw: treated as transient', async () => {
		convex.markRevoked('cred_A', 1000);
		convex.scheduledEmits = [];
		const mockFetch = vi.fn().mockRejectedValueOnce(new Error('network down'));

		await convex.emitOnChainRevocation('cred_A', mockFetch);

		const cred = convex.credentials.get('cred_A')!;
		expect(cred.revocationStatus).toBe('pending');
		expect(convex.scheduledEmits).toHaveLength(1);
	});

	it('rescheduleStuckRevocations re-queues pending credentials older than 1h', () => {
		convex.markRevoked('cred_A', 1000);
		convex.scheduledEmits = [];

		// Advance clock: lastAttemptAt=1000, now=1h+1s later.
		const stuck = convex.rescheduleStuckRevocations(1000 + STUCK_PENDING_AGE_MS + 1);
		expect(stuck).toEqual(['cred_A']);
		expect(convex.scheduledEmits).toHaveLength(1);
	});

	it('rescheduleStuckRevocations skips fresh-attempt rows', () => {
		convex.markRevoked('cred_A', 1000);
		convex.scheduledEmits = [];

		// Only 5 minutes elapsed - well within TTL.
		const stuck = convex.rescheduleStuckRevocations(1000 + 5 * 60_000);
		expect(stuck).toEqual([]);
		expect(convex.scheduledEmits).toHaveLength(0);
	});

	it('rescheduleStuckRevocations does not revive failed credentials', () => {
		convex.markRevoked('cred_A', 1000);
		const cred = convex.credentials.get('cred_A')!;
		cred.revocationStatus = 'failed';
		convex.scheduledEmits = [];

		const stuck = convex.rescheduleStuckRevocations(1000 + STUCK_PENDING_AGE_MS + 1);
		expect(stuck).toEqual([]);
	});

	it('rescheduleStuckRevocations respects retry budget', () => {
		convex.markRevoked('cred_A', 1000);
		const cred = convex.credentials.get('cred_A')!;
		cred.revocationAttempts = MAX_REVOCATION_ATTEMPTS;
		convex.scheduledEmits = [];

		const stuck = convex.rescheduleStuckRevocations(1000 + STUCK_PENDING_AGE_MS + 1);
		expect(stuck).toEqual([]);
	});
});
