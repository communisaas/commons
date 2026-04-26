/**
 * Wave 5 R1 fix — endpoint test for FU-3.3 health gate.
 *
 * Pins the auth + status-code semantics so the runbook's deploy-pipeline curl
 * command can rely on them:
 *   - Missing or wrong x-internal-secret → 403
 *   - Production missing REVOCATION_REGISTRY_ADDRESS → 503 (REVIEW 5-1 fix)
 *   - Non-prod missing config (or ?allow_missing=1) → 200 status:'config_missing'
 *   - Mismatch → 500 status:'mismatch'
 *   - RPC failure → 502
 *   - Match → 200 status:'ok'
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
	mockPrivateEnv,
	mockGetRevocationRegistryAddress,
	mockGetRevocationRegistryEmptyTreeRoot,
	mockGetEmptyTreeRoot
} = vi.hoisted(() => ({
	mockPrivateEnv: { INTERNAL_API_SECRET: 'test-secret' } as Record<string, string | undefined>,
	mockGetRevocationRegistryAddress: vi.fn(),
	mockGetRevocationRegistryEmptyTreeRoot: vi.fn(),
	mockGetEmptyTreeRoot: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_t, prop: string) => mockPrivateEnv[prop]
	})
}));

vi.mock('$lib/core/blockchain/district-gate-client', () => ({
	getRevocationRegistryAddress: (...args: unknown[]) => mockGetRevocationRegistryAddress(...args),
	getRevocationRegistryEmptyTreeRoot: (...args: unknown[]) =>
		mockGetRevocationRegistryEmptyTreeRoot(...args)
}));

vi.mock('$lib/server/smt/revocation-smt', () => ({
	getEmptyTreeRoot: (...args: unknown[]) => mockGetEmptyTreeRoot(...args)
}));

import { GET } from '../../../src/routes/api/internal/health/empty-tree-root/+server';

const MATCHING_ROOT = '0x1f8c48df6299bc1b35a8c7f81fc9a26dd50d15020b1a6d76db8f2769675e3c42';
const DIVERGENT_ROOT = '0xdeadbeef' + '0'.repeat(56);

function makeEvent(headers: Record<string, string> = {}, urlSuffix = ''): Parameters<typeof GET>[0] {
	const url = new URL('https://example.test/api/internal/health/empty-tree-root' + urlSuffix);
	const request = new Request(url.toString(), {
		method: 'GET',
		headers: { 'x-internal-secret': 'test-secret', ...headers }
	});
	return { request, url } as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	mockPrivateEnv.INTERNAL_API_SECRET = 'test-secret';
	mockPrivateEnv.NODE_ENV = 'development';
	mockGetRevocationRegistryAddress.mockReturnValue('0x1234');
	mockGetRevocationRegistryEmptyTreeRoot.mockResolvedValue(MATCHING_ROOT);
	mockGetEmptyTreeRoot.mockResolvedValue(MATCHING_ROOT);
});

afterEach(() => {
	vi.restoreAllMocks();
	mockPrivateEnv.INTERNAL_API_SECRET = 'test-secret';
});

describe('GET /api/internal/health/empty-tree-root', () => {
	it('rejects missing x-internal-secret with 403', async () => {
		const url = new URL('https://example.test/api/internal/health/empty-tree-root');
		const request = new Request(url.toString(), { method: 'GET' });
		await expect(
			GET({ request, url } as Parameters<typeof GET>[0])
		).rejects.toMatchObject({ status: 403 });
	});

	it('rejects wrong x-internal-secret with 403', async () => {
		await expect(
			GET(makeEvent({ 'x-internal-secret': 'nope' }))
		).rejects.toMatchObject({ status: 403 });
	});

	it('returns 503 when INTERNAL_API_SECRET unset', async () => {
		mockPrivateEnv.INTERNAL_API_SECRET = undefined;
		await expect(GET(makeEvent())).rejects.toMatchObject({ status: 503 });
	});

	it('PROD + missing contract address: 503 (fail-CLOSED, REVIEW 5-1 fix)', async () => {
		// Critical regression guard: this must NEVER return 200 — operators
		// who forget the env var must get a deploy failure, not a green light.
		mockPrivateEnv.NODE_ENV = 'production';
		mockGetRevocationRegistryAddress.mockReturnValueOnce('');
		await expect(GET(makeEvent())).rejects.toMatchObject({ status: 503 });
	});

	it('PROD + missing contract + ?allow_missing=1: 200 config_missing (staging escape hatch)', async () => {
		mockPrivateEnv.NODE_ENV = 'production';
		mockGetRevocationRegistryAddress.mockReturnValueOnce('');
		const response = await GET(makeEvent({}, '?allow_missing=1'));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('config_missing');
	});

	it('non-PROD + missing contract: 200 config_missing (no escape hatch needed)', async () => {
		// In dev/test/staging the soft-skip is appropriate by default.
		mockGetRevocationRegistryAddress.mockReturnValueOnce('');
		const response = await GET(makeEvent());
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('config_missing');
	});

	it('match: 200 status=ok', async () => {
		const response = await GET(makeEvent());
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('ok');
		expect(body.emptyTreeRoot).toBe(MATCHING_ROOT);
	});

	it('mismatch: 500 status=mismatch (HARD FAIL deploy)', async () => {
		mockGetRevocationRegistryEmptyTreeRoot.mockResolvedValueOnce(DIVERGENT_ROOT);
		const response = await GET(makeEvent());
		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body.status).toBe('mismatch');
		expect(body.onChainEmpty).toBe(DIVERGENT_ROOT);
		expect(body.computedEmpty).toBe(MATCHING_ROOT);
	});

	it('on-chain RPC failure: 502 transient (deploy pipeline retries)', async () => {
		mockGetRevocationRegistryEmptyTreeRoot.mockRejectedValueOnce(new Error('rpc timeout'));
		await expect(GET(makeEvent())).rejects.toMatchObject({ status: 502 });
	});

	it('on-chain returns null: 502 transient', async () => {
		mockGetRevocationRegistryEmptyTreeRoot.mockResolvedValueOnce(null);
		await expect(GET(makeEvent())).rejects.toMatchObject({ status: 502 });
	});

	it('case-insensitive comparison (chain may upper-case hex)', async () => {
		mockGetRevocationRegistryEmptyTreeRoot.mockResolvedValueOnce(MATCHING_ROOT.toUpperCase());
		const response = await GET(makeEvent());
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('ok');
	});
});
