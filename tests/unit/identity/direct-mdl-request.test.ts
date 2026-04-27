import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { decodeJwt, decodeProtectedHeader } from 'jose';

const featureState = vi.hoisted(() => ({ enabled: true }));

vi.mock('$lib/config/features', async () => {
	const actual = await vi.importActual<Record<string, unknown>>('$lib/config/features');
	return {
		...actual,
		requireMdlDirectQrEnabled: () => {
			if (!featureState.enabled) throw new Error('MDL_DIRECT_QR_DISABLED');
		}
	};
});

import { POST } from '../../../src/routes/api/identity/direct-mdl/request/[sessionId]/+server';
import {
	DIRECT_MDL_SESSION_TTL_SECONDS,
	DIRECT_MDL_TRANSPORT,
	createDirectMdlSession,
	getDirectMdlSession
} from '../../../src/lib/server/direct-mdl-session';
import { DIRECT_MDL_REQUEST_OBJECT_CONTENT_TYPE } from '../../../src/lib/server/direct-mdl-request-object';

const BASE_TIME = Date.UTC(2026, 0, 1, 12, 0, 0);
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://commons.test';
const RESPONSE_URI = `${ORIGIN}/api/identity/direct-mdl/complete`;
const REQUEST_URI = `${ORIGIN}/api/identity/direct-mdl/request/${SESSION_ID}`;
const CLIENT_ID = 'x509_san_dns:commons.test';
const WALLET_NONCE = 'wallet-nonce-001';

let privateKeyPem = '';

type KvStore = Map<string, string>;

function makePlatform() {
	const store: KvStore = new Map();
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
				PUBLIC_APP_URL: ORIGIN,
				MDL_DIRECT_QR_REQUEST_PRIVATE_KEY: privateKeyPem,
				MDL_DIRECT_QR_REQUEST_X5C: 'MIIDfakecert==',
				MDL_DIRECT_QR_REQUEST_ALG: 'ES256',
				MDL_DIRECT_QR_REQUEST_KID: 'direct-route-test'
			}
		}
	} as any;
}

async function createSession(platform: any, overrides: Record<string, unknown> = {}) {
	return createDirectMdlSession(
		{
			id: SESSION_ID,
			desktopUserId: 'user-direct-001',
			clientId: CLIENT_ID,
			responseUri: RESPONSE_URI,
			requestUri: REQUEST_URI,
			nonce: 'server-nonce-001',
			state: 'server-state-001',
			transactionId: 'desktop-transaction-001',
			...overrides
		},
		platform
	);
}

function requestUriBody(values: Record<string, string | undefined> = {}): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined) params.set(key, value);
	}
	return params.toString();
}

function makeEvent({
	sessionId = SESSION_ID,
	platform,
	body = requestUriBody({
		wallet_metadata: JSON.stringify({ vp_formats_supported: { mso_mdoc: {} } }),
		wallet_nonce: WALLET_NONCE
	}),
	headers = {}
}: {
	sessionId?: string;
	platform: any;
	body?: string;
	headers?: Record<string, string>;
}) {
	return {
		request: new Request(`${ORIGIN}/api/identity/direct-mdl/request/${sessionId}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				accept: DIRECT_MDL_REQUEST_OBJECT_CONTENT_TYPE,
				...headers
			},
			body
		}),
		params: { sessionId },
		platform,
		locals: {},
		url: new URL(`${ORIGIN}/api/identity/direct-mdl/request/${sessionId}`),
		cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, serialize: () => '' },
		fetch: globalThis.fetch,
		getClientAddress: () => '127.0.0.1',
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false,
		route: { id: '/api/identity/direct-mdl/request/[sessionId]' }
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

beforeAll(() => {
	const { privateKey } = generateKeyPairSync('ec', {
		namedCurve: 'P-256',
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' }
	});
	privateKeyPem = privateKey;
});

beforeEach(() => {
	featureState.enabled = true;
	vi.useFakeTimers();
	vi.setSystemTime(BASE_TIME);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('POST /api/identity/direct-mdl/request/[sessionId]', () => {
	it('stays hidden while MDL_DIRECT_QR is disabled', async () => {
		featureState.enabled = false;
		const { platform } = makePlatform();

		await expectHttpStatus(POST(makeEvent({ platform })), 404);
	});

	it('returns a signed request object and records the immutable fetch result', async () => {
		const { platform } = makePlatform();
		await createSession(platform);

		const response = await POST(makeEvent({ platform }));
		const jwt = await response.text();
		const header = decodeProtectedHeader(jwt);
		const payload = decodeJwt(jwt);
		const stored = await getDirectMdlSession(SESSION_ID, platform);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain(DIRECT_MDL_REQUEST_OBJECT_CONTENT_TYPE);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(header).toMatchObject({
			alg: 'ES256',
			typ: 'oauth-authz-req+jwt',
			kid: 'direct-route-test',
			x5c: ['MIIDfakecert==']
		});
		expect(payload).toMatchObject({
			iss: CLIENT_ID,
			aud: 'https://self-issued.me/v2',
			client_id: CLIENT_ID,
			response_uri: RESPONSE_URI,
			response_type: 'vp_token',
			response_mode: 'direct_post',
			nonce: 'server-nonce-001',
			state: 'server-state-001',
			wallet_nonce: WALLET_NONCE
		});
		expect(payload.request_uri).toBeUndefined();
		expect(payload.request_uri_method).toBeUndefined();
		expect(stored).toMatchObject({
			status: 'request_fetched',
			walletNonce: WALLET_NONCE,
			requestObjectJwt: jwt
		});
	});

	it('returns the exact same request object on an idempotent refetch', async () => {
		const { platform } = makePlatform();
		await createSession(platform);

		const first = await POST(makeEvent({ platform }));
		const firstJwt = await first.text();
		vi.setSystemTime(BASE_TIME + 10_000);
		const second = await POST(makeEvent({ platform }));
		const secondJwt = await second.text();

		expect(secondJwt).toBe(firstJwt);
	});

	it('rejects duplicate request fetches with a different wallet nonce', async () => {
		const { platform } = makePlatform();
		await createSession(platform);
		await POST(makeEvent({ platform }));

		await expectHttpStatus(
			POST(
				makeEvent({
					platform,
					body: requestUriBody({
						wallet_metadata: JSON.stringify({ vp_formats_supported: { mso_mdoc: {} } }),
						wallet_nonce: 'wallet-nonce-002'
					})
				})
			),
			409
		);
	});

	it('rejects expired sessions before signing a request object', async () => {
		const { platform } = makePlatform();
		await createSession(platform);
		vi.setSystemTime(BASE_TIME + DIRECT_MDL_SESSION_TTL_SECONDS * 1000 + 1);

		await expectHttpStatus(POST(makeEvent({ platform })), 404);
	});

	it('rejects sessions whose request_uri is not the current endpoint', async () => {
		const { platform } = makePlatform();
		await createSession(platform, {
			requestUri: `${ORIGIN}/api/identity/direct-mdl/request/33333333-3333-4333-8333-333333333333`
		});

		await expectHttpStatus(POST(makeEvent({ platform })), 404);
	});

	it('rejects sessions whose response_uri is not the direct completion endpoint', async () => {
		const { platform } = makePlatform();
		await createSession(platform, {
			responseUri: `${ORIGIN}/api/identity/direct-mdl/other-complete`
		});

		await expectHttpStatus(POST(makeEvent({ platform })), 500);
	});

	it('rejects unsupported stored transports', async () => {
		const { platform, store } = makePlatform();
		await createSession(platform);
		const key = `direct-mdl:${SESSION_ID}`;
		const stored = JSON.parse(store.get(key) ?? '{}');
		store.set(key, JSON.stringify({ ...stored, transport: 'dc_api' }));

		await expectHttpStatus(POST(makeEvent({ platform })), 404);
	});

	it('rejects unsupported request_uri form surfaces', async () => {
		const { platform } = makePlatform();
		await createSession(platform);

		await expectHttpStatus(
			POST(makeEvent({ platform, headers: { 'content-type': 'application/json' }, body: '{}' })),
			415
		);
		await expectHttpStatus(
			POST(makeEvent({ platform, headers: { accept: 'application/json' } })),
			406
		);
		await expectHttpStatus(POST(makeEvent({ platform, headers: { accept: '' } })), 406);
		await expectHttpStatus(POST(makeEvent({ platform, headers: { accept: '*/*' } })), 406);
		await expectHttpStatus(
			POST(
				makeEvent({
					platform,
					headers: { accept: `${DIRECT_MDL_REQUEST_OBJECT_CONTENT_TYPE};q=0` }
				})
			),
			406
		);
		await expectHttpStatus(
			POST(
				makeEvent({
					platform,
					body: requestUriBody({ wallet_nonce: WALLET_NONCE, unexpected: '1' })
				})
			),
			400
		);
		await expectHttpStatus(
			POST(
				makeEvent({
					platform,
					body: requestUriBody({ wallet_nonce: 'not.url.safe' })
				})
			),
			400
		);
		await expectHttpStatus(
			POST(
				makeEvent({
					platform,
					body: requestUriBody({
						wallet_metadata: JSON.stringify({ vp_formats_supported: { mso_mdoc: {} } })
					})
				})
			),
			400
		);
	});
});
