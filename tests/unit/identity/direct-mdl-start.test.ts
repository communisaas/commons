import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	featureEnabled: true
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

import { POST } from '../../../src/routes/api/identity/direct-mdl/start/+server';
import { getDirectMdlSession } from '../../../src/lib/server/direct-mdl-session';

const TEST_ORIGIN = 'https://commons.test';
const TEST_USER_ID = 'user-direct-start-001';

function makeEcPrivateKeyPem(): string {
	const { privateKey } = generateKeyPairSync('ec', {
		namedCurve: 'P-256',
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' }
	});
	return privateKey;
}

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
				PUBLIC_APP_URL: TEST_ORIGIN,
				MDL_DIRECT_QR_REQUEST_PRIVATE_KEY: makeEcPrivateKeyPem(),
				MDL_DIRECT_QR_REQUEST_X5C: 'MIIDfakecert=='
			}
		}
	} as any;
}

function makeEvent({
	userEmail = 'alice@example.com',
	sessionUserId = TEST_USER_ID,
	userId = TEST_USER_ID,
	platform
}: {
	userEmail?: string | null;
	sessionUserId?: string;
	userId?: string;
	platform: any;
}) {
	return {
		request: new Request(`${TEST_ORIGIN}/api/identity/direct-mdl/start`, { method: 'POST' }),
		locals: {
			session: { id: 'session-001', userId: sessionUserId, createdAt: new Date(), expiresAt: new Date() },
			user: {
				id: userId,
				email: userEmail,
				name: null
			}
		},
		platform,
		url: new URL(`${TEST_ORIGIN}/api/identity/direct-mdl/start`),
		params: {},
		cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, serialize: () => '' },
		fetch: globalThis.fetch,
		getClientAddress: () => '127.0.0.1',
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false,
		route: { id: '/api/identity/direct-mdl/start' }
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

beforeEach(() => {
	vi.clearAllMocks();
	mocks.featureEnabled = true;
});

describe('POST /api/identity/direct-mdl/start', () => {
	it('stays hidden while MDL_DIRECT_QR is disabled', async () => {
		mocks.featureEnabled = false;
		const { platform } = makePlatform();

		await expectHttpStatus(POST(makeEvent({ platform })), 404);
	});

	it('creates a desktop-bound direct OpenID4VP QR session', async () => {
		const { platform } = makePlatform();

		const response = await POST(makeEvent({ platform }));
		const body = await response.json();
		const qr = new URL(body.qrUrl);
		const stored = await getDirectMdlSession(body.sessionId, platform);

		expect(response.status).toBe(200);
		expect(`${qr.protocol}//${qr.host}`).toBe('openid4vp://authorize');
		expect(qr.searchParams.get('client_id')).toBe('x509_san_dns:commons.test');
		expect(qr.searchParams.get('request_uri_method')).toBe('post');
		expect(qr.searchParams.get('request_uri')).toBe(
			`${TEST_ORIGIN}/api/identity/direct-mdl/request/${body.sessionId}`
		);
		expect(body.qrUrl).not.toContain('/verify-bridge/');
		expect(body.accountLabel).toBe('alice@example.com');
		expect(stored).toMatchObject({
			id: body.sessionId,
			desktopUserId: TEST_USER_ID,
			clientId: 'x509_san_dns:commons.test',
			responseUri: `${TEST_ORIGIN}/api/identity/direct-mdl/complete`,
			requestUri: `${TEST_ORIGIN}/api/identity/direct-mdl/request/${body.sessionId}`,
			status: 'created',
			transport: 'direct_post'
		});
	});

	it('sanitizes the account label from the authenticated server user', async () => {
		const { platform } = makePlatform();

		const response = await POST(
			makeEvent({ platform, userEmail: '  alice\u202E@example.com  ' })
		);
		const body = await response.json();

		expect(body.accountLabel).toBe('alice@example.com');
	});

	it('rejects inconsistent local session and user records', async () => {
		const { platform } = makePlatform();

		await expectHttpStatus(
			POST(makeEvent({ platform, sessionUserId: TEST_USER_ID, userId: 'different-user' })),
			401
		);
	});
});
