/**
 * /api/internal/emit-revocation endpoint tests (Stage 5.5a).
 *
 * Covers:
 *   - 403 on missing / wrong X-Internal-Secret header
 *   - 400 on malformed body (missing districtCommitment)
 *   - 400 on bad districtCommitment hex shape
 *   - 400 when caller passes only `revocationNullifier` (F-1.5: branch removed
 *     so the server is the single source of truth for the derivation domain)
 *   - Happy path → 200 with txHash + blockNumber
 *   - Contract revert → 502 with kind='contract_revert'
 *   - Missing REVOCATION_REGISTRY_ADDRESS → 500 with kind='config'
 *
 * Uses the same hoisted-mock pattern as the district-gate-client tests so
 * $env/dynamic/private is controllable per-test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
	mockPrivateEnv,
	mockEmitOnChainRevocation,
	mockGetRevocationRegistryAddress,
	mockComputeRevocationNullifier,
	mockEnforceInternalRateLimit,
	mockInsertRevocationNullifier
} = vi.hoisted(() => ({
	mockPrivateEnv: {
		INTERNAL_API_SECRET: 'test-secret'
	} as Record<string, string | undefined>,
	mockEmitOnChainRevocation: vi.fn(),
	mockGetRevocationRegistryAddress: vi.fn(),
	mockComputeRevocationNullifier: vi.fn(),
	mockEnforceInternalRateLimit: vi.fn(),
	mockInsertRevocationNullifier: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_t, prop: string) => mockPrivateEnv[prop]
	})
}));

vi.mock('$lib/core/blockchain/district-gate-client', () => ({
	emitOnChainRevocation: (...args: unknown[]) => mockEmitOnChainRevocation(...args),
	getRevocationRegistryAddress: (...args: unknown[]) => mockGetRevocationRegistryAddress(...args)
}));

vi.mock('$lib/core/crypto/poseidon', () => ({
	computeRevocationNullifier: (...args: unknown[]) => mockComputeRevocationNullifier(...args)
}));

vi.mock('$lib/server/internal/rate-limit', () => ({
	enforceInternalRateLimit: (...args: unknown[]) => mockEnforceInternalRateLimit(...args)
}));

// Wave 2 — emit-revocation now delegates root computation to the SMT helper
// (replacing the keccak placeholder). The mock returns a deterministic newRoot
// per test so we can verify the on-chain call receives the SMT-derived value.
vi.mock('$lib/server/smt/revocation-smt', () => ({
	insertRevocationNullifier: (...args: unknown[]) => mockInsertRevocationNullifier(...args)
}));

// Import AFTER mocks are set up.
import { POST } from '../../../src/routes/api/internal/emit-revocation/+server';

// Test constants — canonical 32-byte hex values.
const VALID_DISTRICT_COMMITMENT = '0x' + 'ab'.repeat(32);
const VALID_NULLIFIER = '0x' + 'cd'.repeat(32);
const VALID_ROOT = '0x' + 'ef'.repeat(32);

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
	return new Request('https://example.test/api/internal/emit-revocation', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-internal-secret': 'test-secret',
			...headers
		},
		body: JSON.stringify(body)
	});
}

// SvelteKit-style event shape — only `request` is consumed by the handler.
function buildEvent(request: Request): Parameters<typeof POST>[0] {
	return { request } as Parameters<typeof POST>[0];
}

describe('POST /api/internal/emit-revocation', () => {
	beforeEach(() => {
		mockEnforceInternalRateLimit.mockResolvedValue(undefined);
		mockGetRevocationRegistryAddress.mockReturnValue(
			'0x1234567890123456789012345678901234567890'
		);
		mockComputeRevocationNullifier.mockResolvedValue(VALID_NULLIFIER);
		// SMT helper returns a fresh root + sequence number on every insert.
		mockInsertRevocationNullifier.mockResolvedValue({
			newRoot: VALID_ROOT,
			newSequenceNumber: 1,
			leafCount: 1,
			isFresh: true
		});
		mockEmitOnChainRevocation.mockResolvedValue({
			success: true,
			kind: 'success',
			txHash: '0xdeadbeef',
			blockNumber: 42
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		// Restore INTERNAL_API_SECRET which some tests mutate.
		mockPrivateEnv.INTERNAL_API_SECRET = 'test-secret';
	});

	// -------------------------------------------------------------------------
	// Auth
	// -------------------------------------------------------------------------

	it('rejects missing X-Internal-Secret header with 403', async () => {
		const req = new Request('https://example.test/api/internal/emit-revocation', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ districtCommitment: VALID_DISTRICT_COMMITMENT })
		});
		await expect(POST(buildEvent(req))).rejects.toMatchObject({ status: 403 });
	});

	it('rejects wrong X-Internal-Secret header with 403', async () => {
		const req = makeRequest(
			{ districtCommitment: VALID_DISTRICT_COMMITMENT },
			{ 'x-internal-secret': 'wrong-secret' }
		);
		await expect(POST(buildEvent(req))).rejects.toMatchObject({ status: 403 });
	});

	it('fails fast with 503 when INTERNAL_API_SECRET is not configured', async () => {
		mockPrivateEnv.INTERNAL_API_SECRET = undefined;
		const req = makeRequest({ districtCommitment: VALID_DISTRICT_COMMITMENT });
		await expect(POST(buildEvent(req))).rejects.toMatchObject({ status: 503 });
	});

	// -------------------------------------------------------------------------
	// Body validation
	// -------------------------------------------------------------------------

	it('rejects empty body with 400', async () => {
		const req = makeRequest({});
		await expect(POST(buildEvent(req))).rejects.toMatchObject({ status: 400 });
	});

	it('rejects malformed districtCommitment (wrong length) with 400', async () => {
		const req = makeRequest({ districtCommitment: '0xdead' });
		await expect(POST(buildEvent(req))).rejects.toMatchObject({ status: 400 });
	});

	it('rejects malformed districtCommitment (non-hex) with 400', async () => {
		const req = makeRequest({ districtCommitment: '0x' + 'zz'.repeat(32) });
		await expect(POST(buildEvent(req))).rejects.toMatchObject({ status: 400 });
	});

	it('rejects when districtCommitment is missing with 400', async () => {
		const req = makeRequest({ credentialId: 'cred_abc' });
		await expect(POST(buildEvent(req))).rejects.toMatchObject({ status: 400 });
	});

	it('rejects when caller supplies only revocationNullifier (F-1.5 branch removed) with 400', async () => {
		// The endpoint used to accept a caller-supplied `revocationNullifier`
		// as an alternative to deriving from `districtCommitment`. F-1.5
		// removed that branch so the server is the single source of truth
		// for `REVOCATION_DOMAIN` — closes a body-injection vector where a
		// leaked INTERNAL_API_SECRET could submit arbitrary nullifiers.
		const req = makeRequest({
			credentialId: 'cred_abc',
			revocationNullifier: VALID_NULLIFIER
		});
		await expect(POST(buildEvent(req))).rejects.toMatchObject({ status: 400 });
		// Server-side derivation was NOT attempted (no districtCommitment).
		expect(mockComputeRevocationNullifier).not.toHaveBeenCalled();
		// Chain-write path was NOT invoked.
		expect(mockEmitOnChainRevocation).not.toHaveBeenCalled();
	});

	it('rejects non-string credentialId with 400', async () => {
		const req = makeRequest({
			credentialId: 123,
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});
		await expect(POST(buildEvent(req))).rejects.toMatchObject({ status: 400 });
	});

	// -------------------------------------------------------------------------
	// Happy path
	// -------------------------------------------------------------------------

	it('returns 200 with txHash + blockNumber on success (derives nullifier from commitment)', async () => {
		const req = makeRequest({
			credentialId: 'cred_abc',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});

		const response = await POST(buildEvent(req));
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body).toEqual({
			success: true,
			txHash: '0xdeadbeef',
			blockNumber: 42
		});

		// Nullifier was derived from the provided commitment.
		expect(mockComputeRevocationNullifier).toHaveBeenCalledWith(VALID_DISTRICT_COMMITMENT);
		// The contract call received both nullifier and a newRoot.
		expect(mockEmitOnChainRevocation).toHaveBeenCalledWith(
			expect.objectContaining({
				revocationNullifier: VALID_NULLIFIER,
				newRoot: expect.stringMatching(/^0x[0-9a-fA-F]{64}$/)
			})
		);
	});

	// -------------------------------------------------------------------------
	// Contract revert
	// -------------------------------------------------------------------------

	it('returns 502 with kind=contract_revert on AlreadyRevoked', async () => {
		mockEmitOnChainRevocation.mockResolvedValueOnce({
			success: false,
			kind: 'contract_revert',
			error: 'AlreadyRevoked()'
		});

		const req = makeRequest({
			credentialId: 'cred_abc',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});

		const response = await POST(buildEvent(req));
		expect(response.status).toBe(502);

		const body = await response.json();
		expect(body).toEqual({
			success: false,
			kind: 'contract_revert',
			error: 'AlreadyRevoked()'
		});
	});

	it('returns 502 with kind=rpc_transient on network error', async () => {
		mockEmitOnChainRevocation.mockResolvedValueOnce({
			success: false,
			kind: 'rpc_transient',
			error: 'socket hang up'
		});

		const req = makeRequest({
			credentialId: 'cred_abc',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});

		const response = await POST(buildEvent(req));
		expect(response.status).toBe(502);

		const body = await response.json();
		expect(body.kind).toBe('rpc_transient');
	});

	// -------------------------------------------------------------------------
	// Config errors
	// -------------------------------------------------------------------------

	it('returns 500 with kind=config when REVOCATION_REGISTRY_ADDRESS is not set', async () => {
		mockGetRevocationRegistryAddress.mockReturnValueOnce('');

		const req = makeRequest({
			credentialId: 'cred_abc',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});

		const response = await POST(buildEvent(req));
		expect(response.status).toBe(500);

		const body = await response.json();
		expect(body).toEqual({
			success: false,
			kind: 'config',
			error: 'REVOCATION_REGISTRY_ADDRESS not configured'
		});

		// The chain-write path was NOT invoked when config is missing.
		expect(mockEmitOnChainRevocation).not.toHaveBeenCalled();
	});

	it('returns 500 with kind=config from the underlying client', async () => {
		mockEmitOnChainRevocation.mockResolvedValueOnce({
			success: false,
			kind: 'config',
			error: 'Relayer not configured (missing: SCROLL_PRIVATE_KEY)'
		});

		const req = makeRequest({
			credentialId: 'cred_abc',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});

		const response = await POST(buildEvent(req));
		expect(response.status).toBe(500);

		const body = await response.json();
		expect(body.kind).toBe('config');
	});

	// -------------------------------------------------------------------------
	// Rate limiting
	// -------------------------------------------------------------------------

	it('passes through rate-limiter rejections (429)', async () => {
		mockEnforceInternalRateLimit.mockRejectedValueOnce(
			Object.assign(new Error('rate limited'), { status: 429 })
		);

		const req = makeRequest({
			credentialId: 'cred_abc',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});

		await expect(POST(buildEvent(req))).rejects.toMatchObject({ status: 429 });
		// Downstream path never invoked when rate-limited.
		expect(mockEmitOnChainRevocation).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// Wave 2 — SMT-specific failure paths
	// -------------------------------------------------------------------------

	it('idempotent re-emit: SMT leaf exists, chain emit STILL fires (recovers stuck state)', async () => {
		// REVIEW 1 finding: previous version threw DUPLICATE_REVOCATION when
		// Convex had the leaf, short-circuiting the chain emit. That stranded
		// the system in "Convex ahead of chain, retry refuses chain emit" if
		// the first chain write failed. Fixed: SMT helper returns isFresh=false
		// with the existing root, the endpoint proceeds to chain emit, the
		// chain decides terminality (success or AlreadyRevoked).
		mockInsertRevocationNullifier.mockResolvedValueOnce({
			newRoot: VALID_ROOT,
			newSequenceNumber: 7,
			leafCount: 7,
			isFresh: false // already present in Convex
		});

		const req = makeRequest({
			credentialId: 'cred_dup',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});
		const response = await POST(buildEvent(req));

		// Chain emit was attempted with the existing root.
		expect(mockEmitOnChainRevocation).toHaveBeenCalledWith(
			expect.objectContaining({
				revocationNullifier: VALID_NULLIFIER,
				newRoot: VALID_ROOT
			})
		);
		// Default mock: chain write succeeds → endpoint returns 200.
		expect(response.status).toBe(200);
	});

	it('idempotent re-emit + chain AlreadyRevoked: classified as SUCCESS (recovers stuck status)', async () => {
		// REVIEW 2 fix: previous behavior returned 502 contract_revert here,
		// which the Convex worker mapped to revocationStatus='failed'. But
		// `isFresh: false + AlreadyRevoked` means BOTH layers agree the
		// credential is revoked — the on-chain state matches what the worker
		// wanted. Classify as success so the worker marks 'confirmed' instead
		// of incorrectly flipping to 'failed'.
		mockInsertRevocationNullifier.mockResolvedValueOnce({
			newRoot: VALID_ROOT,
			newSequenceNumber: 7,
			leafCount: 7,
			isFresh: false
		});
		mockEmitOnChainRevocation.mockResolvedValueOnce({
			success: false,
			kind: 'contract_revert',
			error: 'AlreadyRevoked()'
		});

		const req = makeRequest({
			credentialId: 'cred_dup_terminal',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});
		const response = await POST(buildEvent(req));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.recoveredFromIdempotentRetry).toBe(true);
		// No fresh tx hash — the original tx is what landed.
		expect(body.txHash).toBeUndefined();
	});

	it('FRESH emit + chain AlreadyRevoked: still classified as 502 contract_revert (genuine drift)', async () => {
		// Counter-case: when isFresh=true (Convex did NOT have the leaf) but
		// the chain says AlreadyRevoked, the local SMT and on-chain state
		// genuinely disagree — Convex thinks empty, chain thinks present.
		// This is real drift; surface as terminal contract_revert so the
		// reconciliation cron has something to investigate.
		mockInsertRevocationNullifier.mockResolvedValueOnce({
			newRoot: VALID_ROOT,
			newSequenceNumber: 1,
			leafCount: 1,
			isFresh: true
		});
		mockEmitOnChainRevocation.mockResolvedValueOnce({
			success: false,
			kind: 'contract_revert',
			error: 'AlreadyRevoked()'
		});

		const req = makeRequest({
			credentialId: 'cred_drift',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});
		const response = await POST(buildEvent(req));
		expect(response.status).toBe(502);
		const body = await response.json();
		expect(body.kind).toBe('contract_revert');
	});

	it('returns 502 with kind=rpc_transient when SMT seq conflict exhausts retries', async () => {
		// 3 retries failed — likely concurrent emit storm. Convex worker
		// requeues with backoff.
		mockInsertRevocationNullifier.mockRejectedValueOnce(
			new Error('SMT_SEQUENCE_CONFLICT_EXHAUSTED')
		);

		const req = makeRequest({
			credentialId: 'cred_busy',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});
		const response = await POST(buildEvent(req));

		expect(response.status).toBe(502);
		const body = await response.json();
		expect(body.kind).toBe('rpc_transient');
		expect(mockEmitOnChainRevocation).not.toHaveBeenCalled();
	});

	it('returns 500 with kind=config when SMT helper throws unexpected error', async () => {
		// Unknown errors from the SMT helper (Convex outage, schema drift, etc.)
		// surface as terminal config errors so the Convex worker alerts ops.
		mockInsertRevocationNullifier.mockRejectedValueOnce(
			new Error('Convex connection lost')
		);

		const req = makeRequest({
			credentialId: 'cred_err',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});
		const response = await POST(buildEvent(req));

		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body.kind).toBe('config');
		expect(body.error).toBe('smt_insert_failed');
		expect(mockEmitOnChainRevocation).not.toHaveBeenCalled();
	});

	it('passes the SMT-derived newRoot to the on-chain emit', async () => {
		// Confirms the contract receives the SMT root (not the keccak placeholder).
		const SMT_ROOT = '0x' + '11'.repeat(32);
		mockInsertRevocationNullifier.mockResolvedValueOnce({
			newRoot: SMT_ROOT,
			newSequenceNumber: 5,
			leafCount: 5
		});

		const req = makeRequest({
			credentialId: 'cred_root',
			districtCommitment: VALID_DISTRICT_COMMITMENT
		});
		const response = await POST(buildEvent(req));
		expect(response.status).toBe(200);

		expect(mockEmitOnChainRevocation).toHaveBeenCalledWith(
			expect.objectContaining({
				revocationNullifier: VALID_NULLIFIER,
				newRoot: SMT_ROOT
			})
		);
	});
});
