import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateBridgeSession = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/bridge-session', () => ({
	createBridgeSession: mockCreateBridgeSession
}));

import { POST } from '../../../src/routes/api/identity/bridge/start/+server';

const TEST_USER_ID = 'user-bridge-start-001';
const TEST_ORIGIN = 'https://commons.example';
const MOCK_KEY_PAIR = {
	privateKey: { type: 'private', algorithm: { name: 'ECDH' } },
	publicKey: { type: 'public', algorithm: { name: 'ECDH' } }
};
const MOCK_PRIVATE_KEY_JWK = {
	kty: 'EC',
	crv: 'P-256',
	x: 'mock-x',
	y: 'mock-y',
	d: 'mock-d'
};

const originalCryptoSubtle = globalThis.crypto?.subtle;
const originalGetRandomValues = globalThis.crypto?.getRandomValues;

function makeEvent({
	body,
	userEmail = 'alice@example.com',
	sessionUserId = TEST_USER_ID,
	userId = TEST_USER_ID
}: {
	body?: unknown;
	userEmail?: string | null;
	sessionUserId?: string;
	userId?: string;
} = {}) {
	const requestInit: RequestInit = { method: 'POST' };
	if (body !== undefined) {
		requestInit.headers = { 'Content-Type': 'application/json' };
		requestInit.body = JSON.stringify(body);
	}

	return {
		request: new Request(`${TEST_ORIGIN}/api/identity/bridge/start`, requestInit),
		locals: {
			session: { id: 'session-001', userId: sessionUserId, createdAt: new Date(), expiresAt: new Date() },
			user: {
				id: userId,
				email: userEmail,
				name: null,
				avatar: null,
				is_verified: false,
				verification_method: null,
				verified_at: null,
				trust_tier: 1,
				passkey_credential_id: null,
				did_key: null,
				identity_commitment: null,
				district_hash: null,
				district_verified: false,
				role: null,
				organization: null,
				location: null,
				connection: null,
				profile_completed_at: null,
				profile_visibility: 'private',
				trust_score: 0,
				reputation_tier: 'novice',
				wallet_address: null,
				wallet_type: null,
				near_account_id: null,
				near_derived_scroll_address: null,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		},
		platform: { env: { PUBLIC_APP_URL: TEST_ORIGIN } },
		url: new URL(`${TEST_ORIGIN}/api/identity/bridge/start`),
		params: {},
		cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, serialize: () => '' },
		fetch: globalThis.fetch,
		getClientAddress: () => '127.0.0.1',
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false,
		route: { id: '/api/identity/bridge/start' }
	} as any;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockCreateBridgeSession.mockResolvedValue({
		sessionId: '00000000-0000-4000-8000-000000000001',
		secret: 'a'.repeat(64),
		qrUrl: `${TEST_ORIGIN}/verify-bridge/00000000-0000-4000-8000-000000000001#${'a'.repeat(64)}`,
		pairingCode: 'apple-bridge-candle',
		expiresAt: Date.now() + 300_000
	});

	Object.defineProperty(globalThis, 'crypto', {
		value: {
			subtle: {
				generateKey: vi.fn().mockResolvedValue(MOCK_KEY_PAIR),
				exportKey: vi.fn().mockResolvedValue(MOCK_PRIVATE_KEY_JWK)
			},
			getRandomValues: (arr: Uint8Array) => {
				for (let i = 0; i < arr.length; i += 1) arr[i] = (i * 13 + 17) % 256;
				return arr;
			}
		},
		writable: true,
		configurable: true
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	if (originalCryptoSubtle) {
		Object.defineProperty(globalThis, 'crypto', {
			value: {
				subtle: originalCryptoSubtle,
				getRandomValues: originalGetRandomValues
			},
			writable: true,
			configurable: true
		});
	}
});

describe('POST /api/identity/bridge/start account label', () => {
	it('derives the mobile confirmation label from the authenticated server user', async () => {
		const response = await POST(makeEvent());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.sessionId).toBe('00000000-0000-4000-8000-000000000001');
		expect(mockCreateBridgeSession).toHaveBeenCalledWith(
			TEST_USER_ID,
			'alice@example.com',
			expect.any(Array),
			MOCK_PRIVATE_KEY_JWK,
			expect.any(String),
			TEST_ORIGIN,
			expect.any(Object)
		);
	});

	it('ignores a spoofed client-supplied email label', async () => {
		await POST(makeEvent({ body: { userEmail: 'victim@example.org' } }));

		expect(mockCreateBridgeSession).toHaveBeenCalledWith(
			TEST_USER_ID,
			'alice@example.com',
			expect.any(Array),
			MOCK_PRIVATE_KEY_JWK,
			expect.any(String),
			TEST_ORIGIN,
			expect.any(Object)
		);
	});

	it('falls back to a generic server-derived label when the user has no email', async () => {
		await POST(makeEvent({ userEmail: null }));

		expect(mockCreateBridgeSession).toHaveBeenCalledWith(
			TEST_USER_ID,
			'Signed-in Commons account',
			expect.any(Array),
			MOCK_PRIVATE_KEY_JWK,
			expect.any(String),
			TEST_ORIGIN,
			expect.any(Object)
		);
	});

	it('rejects inconsistent local session and user records', async () => {
		await expect(
			POST(makeEvent({ sessionUserId: TEST_USER_ID, userId: 'different-user' }))
		).rejects.toMatchObject({ status: 401 });
	});
});
