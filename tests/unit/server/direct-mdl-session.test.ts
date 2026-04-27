/**
 * Direct mDL Session Tests — feature-isolated direct OpenID4VP QR lifecycle.
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DIRECT_MDL_SESSION_TTL_SECONDS,
	DIRECT_MDL_TRANSPORT,
	completeDirectMdlSession,
	createDirectMdlSession,
	failDirectMdlSession,
	getDirectMdlSession,
	markDirectMdlRequestFetched
} from '$lib/server/direct-mdl-session';

const BASE_TIME = 1_800_000_000_000;
const TEST_INPUT = {
	desktopUserId: 'user-direct-001',
	clientId: 'redirect_uri:https://commons.example/api/identity/direct-mdl/complete',
	responseUri: 'https://commons.example/api/identity/direct-mdl/complete',
	requestUri: 'https://commons.example/api/identity/direct-mdl/request/session-001',
	nonce: 'nonce_0012345678',
	state: 'state_0012345678',
	transactionId: 'tx_0012345678901'
};

function makePlatform() {
	const store = new Map<string, string>();
	const puts: Array<{ key: string; value: string; ttl?: number }> = [];
	const deletes: string[] = [];
	const platform = {
		env: {
			DIRECT_MDL_SESSION_KV: {
				get: vi.fn(async (key: string) => store.get(key) ?? null),
				put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
					store.set(key, value);
					puts.push({ key, value, ttl: options?.expirationTtl });
				}),
				delete: vi.fn(async (key: string) => {
					store.delete(key);
					deletes.push(key);
				})
			}
		}
	};
	return { platform, store, puts, deletes };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(BASE_TIME);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('direct-mdl-session lifecycle', () => {
	it('stores direct sessions under an isolated prefix with direct_post transport', async () => {
		const { platform, store, puts } = makePlatform();
		const handle = await createDirectMdlSession(TEST_INPUT, platform);

		expect(handle).toMatchObject({
			id: expect.any(String),
			transactionId: 'tx_0012345678901',
			nonce: 'nonce_0012345678',
			state: 'state_0012345678',
			transport: DIRECT_MDL_TRANSPORT,
			expiresAt: BASE_TIME + DIRECT_MDL_SESSION_TTL_SECONDS * 1000
		});
		expect([...store.keys()]).toEqual([`direct-mdl:${handle.id}`]);
		expect(puts[0].ttl).toBe(DIRECT_MDL_SESSION_TTL_SECONDS);

		const stored = await getDirectMdlSession(handle.id, platform);
		expect(stored).toMatchObject({
			id: handle.id,
			desktopUserId: 'user-direct-001',
			transport: DIRECT_MDL_TRANSPORT,
			status: 'created',
			clientId: TEST_INPUT.clientId,
			responseUri: TEST_INPUT.responseUri,
			requestUri: TEST_INPUT.requestUri
		});
	});

	it('records the first request_uri fetch without changing immutable request fields', async () => {
		const { platform } = makePlatform();
		const handle = await createDirectMdlSession(TEST_INPUT, platform);
		vi.setSystemTime(BASE_TIME + 1_000);

		const fetched = await markDirectMdlRequestFetched(
			handle.id,
			{ transport: DIRECT_MDL_TRANSPORT, walletNonce: 'wallet-nonce-001' },
			platform
		);

		expect(fetched.status).toBe('request_fetched');
		expect(fetched.requestFetchedAt).toBe(BASE_TIME + 1_000);
		expect(fetched.walletNonce).toBe('wallet-nonce-001');
		expect(fetched.clientId).toBe(TEST_INPUT.clientId);
		expect(fetched.responseUri).toBe(TEST_INPUT.responseUri);
	});

	it('keeps duplicate request_uri fetches idempotent only for the same wallet nonce', async () => {
		const { platform } = makePlatform();
		const handle = await createDirectMdlSession(TEST_INPUT, platform);
		await markDirectMdlRequestFetched(
			handle.id,
			{ transport: DIRECT_MDL_TRANSPORT, walletNonce: 'wallet-nonce-001' },
			platform
		);

		await expect(
			markDirectMdlRequestFetched(
				handle.id,
				{ transport: DIRECT_MDL_TRANSPORT, walletNonce: 'wallet-nonce-001' },
				platform
			)
		).resolves.toMatchObject({ status: 'request_fetched', walletNonce: 'wallet-nonce-001' });
		await expect(
			markDirectMdlRequestFetched(
				handle.id,
				{ transport: DIRECT_MDL_TRANSPORT, walletNonce: 'different-wallet-nonce' },
				platform
			)
		).rejects.toThrow('DIRECT_MDL_WALLET_NONCE_MISMATCH');
	});

	it('rejects transport mismatches before mutating a session', async () => {
		const { platform } = makePlatform();
		const handle = await createDirectMdlSession(TEST_INPUT, platform);

		await expect(
			markDirectMdlRequestFetched(handle.id, { transport: 'dc_api' }, platform)
		).rejects.toThrow('DIRECT_MDL_TRANSPORT_MISMATCH');
		await expect(
			completeDirectMdlSession(handle.id, { transport: 'dc_api', state: TEST_INPUT.state }, platform)
		).rejects.toThrow('DIRECT_MDL_TRANSPORT_MISMATCH');

		const stored = await getDirectMdlSession(handle.id, platform);
		expect(stored?.status).toBe('created');
	});

	it('requires request fetch and exact state before completion', async () => {
		const { platform } = makePlatform();
		const handle = await createDirectMdlSession(TEST_INPUT, platform);

		await expect(
			completeDirectMdlSession(
				handle.id,
				{ transport: DIRECT_MDL_TRANSPORT, state: TEST_INPUT.state },
				platform
			)
		).rejects.toThrow('DIRECT_MDL_SESSION_REQUEST_NOT_FETCHED');

		await markDirectMdlRequestFetched(handle.id, { transport: DIRECT_MDL_TRANSPORT }, platform);
		await expect(
			completeDirectMdlSession(
				handle.id,
				{ transport: DIRECT_MDL_TRANSPORT, state: 'wrong-state' },
				platform
			)
		).rejects.toThrow('DIRECT_MDL_STATE_MISMATCH');

		const completed = await completeDirectMdlSession(
			handle.id,
			{ transport: DIRECT_MDL_TRANSPORT, state: TEST_INPUT.state },
			platform
		);
		expect(completed.status).toBe('completed');
		expect(completed.completedAt).toBe(BASE_TIME);
	});

	it('rejects duplicate terminal transitions', async () => {
		const { platform } = makePlatform();
		const handle = await createDirectMdlSession(TEST_INPUT, platform);
		await markDirectMdlRequestFetched(handle.id, { transport: DIRECT_MDL_TRANSPORT }, platform);
		await completeDirectMdlSession(
			handle.id,
			{ transport: DIRECT_MDL_TRANSPORT, state: TEST_INPUT.state },
			platform
		);

		await expect(
			completeDirectMdlSession(
				handle.id,
				{ transport: DIRECT_MDL_TRANSPORT, state: TEST_INPUT.state },
				platform
			)
		).rejects.toThrow('DIRECT_MDL_SESSION_TERMINAL');
		await failDirectMdlSession(handle.id, 'late failure', platform);

		const stored = await getDirectMdlSession(handle.id, platform);
		expect(stored?.status).toBe('completed');
		expect(stored?.errorMessage).toBeUndefined();
	});

	it('bounds and normalizes stored failure messages', async () => {
		const { platform } = makePlatform();
		const handle = await createDirectMdlSession(TEST_INPUT, platform);
		await failDirectMdlSession(
			handle.id,
			`\u202E wallet\tfailed ${'x'.repeat(400)}`,
			platform
		);

		const stored = await getDirectMdlSession(handle.id, platform);
		expect(stored?.status).toBe('failed');
		expect(stored?.errorMessage).not.toContain('\u202E');
		expect(stored?.errorMessage).not.toContain('\t');
		expect(stored?.errorMessage?.length).toBeLessThanOrEqual(256);
	});

	it('treats stale sessions as expired before lifecycle mutation', async () => {
		const { platform, deletes } = makePlatform();
		const handle = await createDirectMdlSession(TEST_INPUT, platform);
		vi.setSystemTime(BASE_TIME + DIRECT_MDL_SESSION_TTL_SECONDS * 1000 + 1);

		await expect(getDirectMdlSession(handle.id, platform)).resolves.toBeNull();
		expect(deletes).toContain(`direct-mdl:${handle.id}`);
		await expect(
			markDirectMdlRequestFetched(handle.id, { transport: DIRECT_MDL_TRANSPORT }, platform)
		).rejects.toThrow('DIRECT_MDL_SESSION_NOT_FOUND_OR_EXPIRED');
	});
});
