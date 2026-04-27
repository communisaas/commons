import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	featureEnabled: true,
	processCredentialResponse: vi.fn(),
	serverMutation: vi.fn()
}));

vi.mock('$lib/config/features', async () => {
	const actual = await vi.importActual<Record<string, unknown>>('$lib/config/features');
	return {
		...actual,
		requireMdlDirectQrEnabled: () => {
			if (!mocks.featureEnabled) throw new Error('MDL_DIRECT_QR_DISABLED');
		}
	};
});

vi.mock('$lib/core/identity/mdl-verification', () => ({
	processCredentialResponse: mocks.processCredentialResponse
}));

vi.mock('convex-sveltekit', () => ({
	serverMutation: mocks.serverMutation
}));

vi.mock('$lib/convex', () => ({
	internal: {
		users: {
			finalizeMdlVerification: 'internal.users.finalizeMdlVerification'
		}
	}
}));

import { POST } from '../../../src/routes/api/identity/direct-mdl/complete/+server';
import {
	DIRECT_MDL_TRANSPORT,
	createDirectMdlSession,
	getDirectMdlSession,
	markDirectMdlRequestFetched
} from '../../../src/lib/server/direct-mdl-session';
import { OPENID4VP_DC_API_PROTOCOL } from '../../../src/lib/config/features';

const ORIGIN = 'https://commons.test';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const STATE = 'state_direct_00123';
const NONCE = 'nonce_direct_00123';
const WALLET_NONCE = 'wallet_nonce_00123';
const RESPONSE_URI = `${ORIGIN}/api/identity/direct-mdl/complete`;
const REQUEST_URI = `${ORIGIN}/api/identity/direct-mdl/request/${SESSION_ID}`;
const CLIENT_ID = 'x509_san_dns:commons.test';
const VP_TOKEN = { mdl: ['QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo'] };

function makePlatform() {
	const store = new Map<string, string>();
	const kv = {
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		})
	};

	return {
		store,
		platform: {
			env: {
				DIRECT_MDL_SESSION_KV: kv,
				PUBLIC_APP_URL: ORIGIN
			}
		}
	} as any;
}

async function createSession(platform: any, fetched = true) {
	const handle = await createDirectMdlSession(
		{
			id: SESSION_ID,
			desktopUserId: 'user-direct-001',
			clientId: CLIENT_ID,
			responseUri: RESPONSE_URI,
			requestUri: REQUEST_URI,
			nonce: NONCE,
			state: STATE,
			transactionId: 'tx_direct_001234'
		},
		platform
	);
	if (fetched) {
		await markDirectMdlRequestFetched(
			handle.id,
			{
				transport: DIRECT_MDL_TRANSPORT,
				walletNonce: WALLET_NONCE,
				requestObjectJwt: 'header.payload.signature'
			},
			platform
		);
	}
	return handle;
}

function formBody(values: Record<string, string | undefined> = {}) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined) params.set(key, value);
	}
	return params.toString();
}

function makeEvent({
	platform,
	body = formBody({ state: STATE, vp_token: JSON.stringify(VP_TOKEN) }),
	headers = {}
}: {
	platform: any;
	body?: string;
	headers?: Record<string, string>;
}) {
	return {
		request: new Request(`${ORIGIN}/api/identity/direct-mdl/complete`, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				...headers
			},
			body
		}),
		params: {},
		platform,
		locals: {},
		url: new URL(`${ORIGIN}/api/identity/direct-mdl/complete`),
		cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, serialize: () => '' },
		fetch: globalThis.fetch,
		getClientAddress: () => '127.0.0.1',
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false,
		route: { id: '/api/identity/direct-mdl/complete' }
	} as any;
}

async function expectHttpStatus(result: unknown, status: number) {
	try {
		await result;
		throw new Error('Expected handler to throw');
	} catch (err: any) {
		expect(err.status).toBe(status);
	}
}

function mockSuccessfulVerification() {
	mocks.processCredentialResponse.mockResolvedValue({
		success: true,
		district: 'CA-12',
		state: 'CA',
		credentialHash: 'b'.repeat(64),
		cellId: '060750101001',
		identityCommitment: 'c'.repeat(64)
	});
	mocks.serverMutation.mockResolvedValue({ userId: 'user-direct-001', requireReauth: false });
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.featureEnabled = true;
	mockSuccessfulVerification();
});

describe('POST /api/identity/direct-mdl/complete', () => {
	it('stays hidden while MDL_DIRECT_QR is disabled', async () => {
		mocks.featureEnabled = false;
		const { platform } = makePlatform();

		await expectHttpStatus(POST(makeEvent({ platform })), 404);
	});

	it('verifies a direct_post mso_mdoc response and finalizes the desktop-bound user', async () => {
		const { platform } = makePlatform();
		await createSession(platform);

		const response = await POST(makeEvent({ platform }));
		const body = await response.json();
		const stored = await getDirectMdlSession(SESSION_ID, platform);

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			success: true,
			district: 'CA-12',
			state: 'CA',
			requireReauth: false
		});
		expect(body.transactionId).toBeUndefined();
		expect(mocks.processCredentialResponse).toHaveBeenCalledWith(
			{ vp_token: VP_TOKEN },
			OPENID4VP_DC_API_PROTOCOL,
			expect.anything(),
			NONCE,
			expect.objectContaining({
				directPost: {
					clientId: CLIENT_ID,
					responseUri: RESPONSE_URI,
					allowLocalhostHttp: expect.any(Boolean)
				}
			})
		);
		expect(mocks.serverMutation).toHaveBeenCalledWith('internal.users.finalizeMdlVerification', {
			userId: 'user-direct-001',
			identityCommitment: 'c'.repeat(64),
			credentialHash: 'b'.repeat(64),
			nonce: NONCE,
			protocol: OPENID4VP_DC_API_PROTOCOL,
			sessionChannel: 'direct',
			verifiedAt: expect.any(Number),
			addressVerificationMethod: 'mdl',
			documentType: 'mdl'
		});
		expect(stored).toMatchObject({
			status: 'completed',
			result: {
				district: 'CA-12',
				state: 'CA',
				credentialHash: 'b'.repeat(64),
				cellId: '060750101001',
				identityCommitmentBound: true
			}
		});
	});

	it('rejects duplicate direct_post completions after terminal success', async () => {
		const { platform } = makePlatform();
		await createSession(platform);
		await POST(makeEvent({ platform }));

		await expectHttpStatus(POST(makeEvent({ platform })), 409);
	});

	it('requires a fetched request object before direct_post completion', async () => {
		const { platform } = makePlatform();
		await createSession(platform, false);

		await expectHttpStatus(POST(makeEvent({ platform })), 409);
	});

	it('rejects stale or malformed completion forms without finalizing', async () => {
		const { platform } = makePlatform();

		await expectHttpStatus(POST(makeEvent({ platform })), 410);
		await expectHttpStatus(
			POST(makeEvent({ platform, headers: { 'content-type': 'application/json' }, body: '{}' })),
			415
		);
		await expectHttpStatus(POST(makeEvent({ platform, body: formBody({ state: STATE }) })), 400);
		expect(mocks.serverMutation).not.toHaveBeenCalled();
	});

	it('ignores OpenID4VP extension response parameters while consuming required fields', async () => {
		const { platform } = makePlatform();
		await createSession(platform);

		const response = await POST(
			makeEvent({
				platform,
				body: formBody({
					state: STATE,
					vp_token: JSON.stringify(VP_TOKEN),
					presentation_submission: '{"id":"submission"}',
					wallet_extension: 'ignored'
				})
			})
		);

		expect(response.status).toBe(200);
		expect(mocks.processCredentialResponse).toHaveBeenCalledWith(
			{ vp_token: VP_TOKEN },
			OPENID4VP_DC_API_PROTOCOL,
			expect.anything(),
			NONCE,
			expect.anything()
		);
	});

	it('accepts wallet error responses without making the session terminal', async () => {
		const { platform } = makePlatform();
		await createSession(platform);

		const response = await POST(
			makeEvent({
				platform,
				body: formBody({
					state: STATE,
					error: 'access_denied',
					error_description: 'User cancelled'
				})
			})
		);
		const stored = await getDirectMdlSession(SESSION_ID, platform);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: 'wallet_error' });
		expect(stored?.status).toBe('request_fetched');
		expect(mocks.processCredentialResponse).not.toHaveBeenCalled();
		expect(mocks.serverMutation).not.toHaveBeenCalled();
	});

	it('returns verification failures without making the session terminal', async () => {
		const { platform } = makePlatform();
		await createSession(platform);
		mocks.processCredentialResponse.mockResolvedValue({
			success: false,
			error: 'invalid_format',
			message: 'bad presentation'
		});

		const response = await POST(makeEvent({ platform }));
		const stored = await getDirectMdlSession(SESSION_ID, platform);

		expect(response.status).toBe(422);
		expect(stored?.status).toBe('request_fetched');
		expect(mocks.serverMutation).not.toHaveBeenCalled();
	});

	it('surfaces credential reuse without completing the direct session', async () => {
		const { platform } = makePlatform();
		await createSession(platform);
		mocks.serverMutation.mockRejectedValue(new Error('MDL_CREDENTIAL_HASH_REUSED'));

		const response = await POST(makeEvent({ platform }));
		const stored = await getDirectMdlSession(SESSION_ID, platform);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ error: 'credential_reuse_detected' });
		expect(stored?.status).toBe('request_fetched');
	});

	it('surfaces nonce reuse without completing the direct session', async () => {
		const { platform } = makePlatform();
		await createSession(platform);
		mocks.serverMutation.mockRejectedValue(new Error('MDL_SESSION_NONCE_REUSED'));

		const response = await POST(makeEvent({ platform }));
		const stored = await getDirectMdlSession(SESSION_ID, platform);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ error: 'credential_reuse_detected' });
		expect(stored?.status).toBe('request_fetched');
	});
});
