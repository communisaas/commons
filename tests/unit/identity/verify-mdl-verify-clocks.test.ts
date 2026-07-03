/**
 * Unit tests: /api/identity/verify-mdl/verify — resolver freshness clock hop.
 *
 * The success JSON must carry the privacy-boundary result's freshness clocks
 * VERBATIM across the HTTP hop:
 *   - boundaryAsOf / officialsAsOf pass through directly (null survives JSON —
 *     it is a real honestly-unknown value, never borrowed from the other clock)
 *   - tigerVintage / resolutionConfidence are spread only-when-present, so an
 *     absent field stays absent in the response body
 *   - nothing is fabricated endpoint-side (no now()-derived timestamps)
 *
 * processCredentialResponse is mocked at the module boundary — the live
 * resolver→result population is covered by mdl-mdoc.test.ts and
 * oid4vp-verify.test.ts; this file covers only the endpoint hop.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { mockServerMutation, mockProcessCredentialResponse } = vi.hoisted(() => ({
	mockServerMutation: vi.fn(),
	mockProcessCredentialResponse: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({
	serverMutation: mockServerMutation
}));

vi.mock('$lib/convex', () => ({
	api: {
		users: {
			finalizeMdlVerification: 'users.finalizeMdlVerification'
		}
	}
}));

vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: () => 'test-internal-secret'
}));

vi.mock('$lib/config/features', () => ({
	isAnyMdlProtocolEnabled: () => true,
	isMdlProtocolEnabled: () => true
}));

vi.mock('$lib/core/identity/mdl-verification', () => ({
	processCredentialResponse: mockProcessCredentialResponse
}));

import { POST } from '../../../src/routes/api/identity/verify-mdl/verify/+server';

const TEST_USER_ID = 'user-clock-hop-1';
const TEST_PROTOCOL = 'openid4vp-v1-signed';

let privateKeyJwk: JsonWebKey;

beforeAll(async () => {
	// Real P-256 ECDH key — the route imports it via crypto.subtle before
	// reaching the privacy boundary, so the JWK must be structurally valid.
	const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
		'deriveKey',
		'deriveBits'
	]);
	privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
});

// In-memory KV stub standing in for DC_SESSION_KV (avoids the dev-store fallback).
const kvStore = new Map<string, string>();
const kvStub = {
	get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
	delete: vi.fn(async (key: string) => {
		kvStore.delete(key);
	})
};

function seedSession(nonce: string) {
	kvStore.set(
		`mdl-session:${nonce}`,
		JSON.stringify({
			privateKeyJwk,
			userId: TEST_USER_ID,
			origin: 'https://verifier.example',
			allowedProtocols: [TEST_PROTOCOL]
		})
	);
}

function buildEvent(nonce: string) {
	const request = new Request('http://localhost/api/identity/verify-mdl/verify', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ protocol: TEST_PROTOCOL, data: 'stub-credential-data', nonce })
	});
	return {
		request,
		locals: { session: { userId: TEST_USER_ID } },
		platform: { env: { DC_SESSION_KV: kvStub } }
	} as unknown as Parameters<typeof POST>[0];
}

const BASE_SUCCESS_RESULT = {
	success: true as const,
	district: 'CA-12',
	state: 'CA',
	credentialHash: 'ab'.repeat(32),
	verificationMethod: 'mdl' as const,
	identityCommitment: 'cd'.repeat(32),
	cellId: '872830828ffffff'
};

beforeEach(() => {
	vi.clearAllMocks();
	kvStore.clear();
	mockServerMutation.mockResolvedValue({
		userId: TEST_USER_ID,
		requireReauth: false,
		linkedToExisting: false
	});
});

describe('POST /api/identity/verify-mdl/verify — freshness clock hop', () => {
	it('echoes present clocks verbatim and preserves null as null in the success JSON', async () => {
		const nonce = 'nonce-clock-hop-present';
		seedSession(nonce);
		mockProcessCredentialResponse.mockResolvedValueOnce({
			...BASE_SUCCESS_RESULT,
			boundaryAsOf: '2024-09-14T00:00:00Z',
			// officialsAsOf null: an independent clock that is honestly-unknown.
			// It must survive the hop as null — never borrowed from boundaryAsOf.
			officialsAsOf: null,
			tigerVintage: 'TIGER2024',
			resolutionConfidence: 0.85
		});

		const response = await POST(buildEvent(nonce));
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.boundaryAsOf).toBe('2024-09-14T00:00:00Z');
		expect(body.officialsAsOf).toBeNull();
		expect(body.tigerVintage).toBe('TIGER2024');
		expect(body.resolutionConfidence).toBe(0.85);
	});

	it('omits tigerVintage and resolutionConfidence from the JSON when absent on the result', async () => {
		const nonce = 'nonce-clock-hop-absent';
		seedSession(nonce);
		// Result carries NO clock fields at all (resolver reported nothing).
		mockProcessCredentialResponse.mockResolvedValueOnce({ ...BASE_SUCCESS_RESULT });

		const response = await POST(buildEvent(nonce));
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.success).toBe(true);
		// Absent stays absent across the hop — no key, not a null placeholder,
		// and no fabricated now()-derived stand-in.
		expect(body).not.toHaveProperty('boundaryAsOf');
		expect(body).not.toHaveProperty('officialsAsOf');
		expect(body).not.toHaveProperty('tigerVintage');
		expect(body).not.toHaveProperty('resolutionConfidence');
		expect(JSON.stringify(body)).not.toContain(new Date().toISOString().slice(0, 10));
	});

	it('preserves both null clocks independently when the resolver was honestly-unknown', async () => {
		const nonce = 'nonce-clock-hop-null';
		seedSession(nonce);
		mockProcessCredentialResponse.mockResolvedValueOnce({
			...BASE_SUCCESS_RESULT,
			boundaryAsOf: null,
			officialsAsOf: null
		});

		const response = await POST(buildEvent(nonce));
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.boundaryAsOf).toBeNull();
		expect(body.officialsAsOf).toBeNull();
		expect(body).not.toHaveProperty('tigerVintage');
		expect(body).not.toHaveProperty('resolutionConfidence');
	});
});
