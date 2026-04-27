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

import { POST } from '../../../src/routes/api/identity/direct-mdl/cancel/+server';
import {
	createDirectMdlSession,
	getDirectMdlSession
} from '../../../src/lib/server/direct-mdl-session';

const ORIGIN = 'https://commons.test';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = 'user-direct-cancel-001';

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
	return { platform: { env: { DIRECT_MDL_SESSION_KV: kv, PUBLIC_APP_URL: ORIGIN } } } as any;
}

function makeEvent({
	platform,
	sessionId = SESSION_ID,
	userId = USER_ID
}: {
	platform: any;
	sessionId?: string;
	userId?: string;
}) {
	return {
		request: new Request(`${ORIGIN}/api/identity/direct-mdl/cancel`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ sessionId })
		}),
		locals: {
			session: { id: 'session-001', userId, createdAt: new Date(), expiresAt: new Date() }
		},
		platform,
		url: new URL(`${ORIGIN}/api/identity/direct-mdl/cancel`),
		params: {},
		cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, serialize: () => '' },
		fetch: globalThis.fetch,
		getClientAddress: () => '127.0.0.1',
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false,
		route: { id: '/api/identity/direct-mdl/cancel' }
	} as any;
}

async function seedSession(platform: any) {
	return createDirectMdlSession(
		{
			id: SESSION_ID,
			desktopUserId: USER_ID,
			clientId: 'x509_san_dns:commons.test',
			responseUri: `${ORIGIN}/api/identity/direct-mdl/complete`,
			requestUri: `${ORIGIN}/api/identity/direct-mdl/request/${SESSION_ID}`,
			nonce: 'nonce_direct_cancel',
			state: 'state_direct_cancel',
			transactionId: 'tx_direct_cancel_001'
		},
		platform
	);
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

describe('POST /api/identity/direct-mdl/cancel', () => {
	it('stays hidden while MDL_DIRECT_QR is disabled', async () => {
		mocks.featureEnabled = false;
		const { platform } = makePlatform();

		await expectHttpStatus(POST(makeEvent({ platform })), 404);
	});

	it('marks an owned direct session failed so old QR payloads stop completing', async () => {
		const { platform } = makePlatform();
		await seedSession(platform);

		const response = await POST(makeEvent({ platform }));
		const session = await getDirectMdlSession(SESSION_ID, platform);

		expect(response.status).toBe(200);
		expect(session).toMatchObject({
			status: 'failed',
			errorMessage: 'Direct QR session replaced'
		});
	});

	it('rejects cancellation of another user direct session', async () => {
		const { platform } = makePlatform();
		await seedSession(platform);

		await expectHttpStatus(POST(makeEvent({ platform, userId: 'other-user' })), 403);
	});
});
