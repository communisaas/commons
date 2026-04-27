import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockDev,
	mockPrivateEnv,
	mockFeatures,
	mockSignerConfig,
	mockSignRequestObject
} = vi.hoisted(() => ({
	mockDev: { value: false },
	mockPrivateEnv: { INTERNAL_API_SECRET: 'test-secret' } as Record<string, string | undefined>,
	mockFeatures: {
		MDL_ANDROID_OID4VP: true,
		MDL_BRIDGE: true,
		MDL_DIRECT_QR: true,
		MDL_MDOC: false,
		MDL_IOS: false
	},
	mockSignerConfig: vi.fn(),
	mockSignRequestObject: vi.fn()
}));

vi.mock('$app/environment', () => ({
	get dev() {
		return mockDev.value;
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, prop: string) => mockPrivateEnv[prop]
	})
}));

vi.mock('$lib/config/features', () => ({
	FEATURES: mockFeatures,
	MDL_DIRECT_QR_ALLOWED_ORIGIN: 'https://staging.commons.email',
	OPENID4VP_DC_API_PROTOCOL: 'openid4vp-v1-unsigned',
	isMdlBridgeEnabled: () => mockFeatures.MDL_BRIDGE && mockFeatures.MDL_ANDROID_OID4VP,
	isMdlDirectQrEnabled: () => mockFeatures.MDL_DIRECT_QR && mockFeatures.MDL_ANDROID_OID4VP
}));

vi.mock('$lib/server/direct-mdl-request-object', () => ({
	DIRECT_MDL_REQUEST_OBJECT_CONTENT_TYPE: 'application/oauth-authz-req+jwt',
	DIRECT_MDL_REQUEST_URI_METHOD: 'post',
	getDirectMdlRequestObjectSignerConfig: (...args: unknown[]) => mockSignerConfig(...args),
	signDirectMdlRequestObject: (...args: unknown[]) => mockSignRequestObject(...args)
}));

import { GET } from '../../../src/routes/api/internal/identity/mdl-readiness/+server';

const kv = {
	get: vi.fn(),
	put: vi.fn(),
	delete: vi.fn()
};

function makeEvent(options: {
	headers?: Record<string, string>;
	origin?: string;
	platformEnv?: Record<string, unknown>;
} = {}): Parameters<typeof GET>[0] {
	const origin = options.origin ?? 'https://staging.commons.email';
	const url = new URL(`${origin}/api/internal/identity/mdl-readiness`);
	const request = new Request(url.toString(), {
		method: 'GET',
		headers: { 'x-internal-secret': 'test-secret', ...options.headers }
	});
	return {
		request,
		url,
		platform: {
			env: {
				PUBLIC_APP_URL: origin,
				DC_SESSION_KV: kv,
				BRIDGE_SESSION_KV: kv,
				DIRECT_MDL_SESSION_KV: kv,
				BRIDGE_ENCRYPTION_KEY: 'a'.repeat(64),
				MDL_DIRECT_QR_REQUEST_PRIVATE_KEY: 'configured',
				MDL_DIRECT_QR_REQUEST_X5C: 'configured',
				...options.platformEnv
			}
		}
	} as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	mockDev.value = false;
	mockPrivateEnv.INTERNAL_API_SECRET = 'test-secret';
	process.env.BRIDGE_ENCRYPTION_KEY = 'a'.repeat(64);
	mockFeatures.MDL_ANDROID_OID4VP = true;
	mockFeatures.MDL_BRIDGE = true;
	mockFeatures.MDL_DIRECT_QR = true;
	mockFeatures.MDL_MDOC = false;
	mockFeatures.MDL_IOS = false;
	mockSignerConfig.mockReturnValue({ privateKeyPem: 'configured', x5c: ['configured'] });
	mockSignRequestObject.mockResolvedValue('signed.jwt');
});

afterEach(() => {
	delete process.env.BRIDGE_ENCRYPTION_KEY;
});

describe('GET /api/internal/identity/mdl-readiness', () => {
	it('requires the internal secret', async () => {
		await expect(GET(makeEvent({ headers: { 'x-internal-secret': 'wrong' } }))).rejects.toMatchObject({
			status: 403
		});
	});

	it('fails closed when the internal secret is not configured', async () => {
		mockPrivateEnv.INTERNAL_API_SECRET = undefined;
		await expect(GET(makeEvent())).rejects.toMatchObject({ status: 503 });
	});

	it('returns ok when the staging smoke surface is fully configured', async () => {
		const response = await GET(makeEvent());
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('ok');
		expect(body.blockers).toEqual([]);
		expect(body.featureFlags.MDL_DIRECT_QR).toBe(true);
		expect(body.directRequest).toMatchObject({
			allowedOrigin: 'https://staging.commons.email',
			requestUriMethod: 'post',
			requestObjectContentType: 'application/oauth-authz-req+jwt',
			walletNonceRequired: true
		});
		expect(mockSignRequestObject).toHaveBeenCalledOnce();
	});

	it('blocks direct smoke when the direct QR build flag is off', async () => {
		mockFeatures.MDL_DIRECT_QR = false;
		const response = await GET(makeEvent());
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.status).toBe('blocked');
		expect(body.blockers).toContain('direct_qr_enabled');
	});

	it('blocks when PUBLIC_APP_URL points at a different deployed origin', async () => {
		const response = await GET(
			makeEvent({
				origin: 'https://staging.commons.email',
				platformEnv: { PUBLIC_APP_URL: 'https://commons.email' }
			})
		);
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.blockers).toContain('public_app_url');
		expect(body.blockers).toContain('direct_request_signer');
	});

	it('reports fallback KV bindings as warnings, not blockers', async () => {
		const response = await GET(
			makeEvent({
				platformEnv: {
					BRIDGE_SESSION_KV: undefined,
					DIRECT_MDL_SESSION_KV: undefined
				}
			})
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.warnings).toEqual(['bridge_session_kv', 'direct_mdl_session_kv']);
		expect(body.blockers).toEqual([]);
	});

	it('blocks when bridge encryption is missing on a deployed build', async () => {
		delete process.env.BRIDGE_ENCRYPTION_KEY;
		const response = await GET(makeEvent({ platformEnv: { BRIDGE_ENCRYPTION_KEY: undefined } }));
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.blockers).toContain('bridge_encryption_key');
	});

	it('blocks when the direct request signer cannot sign', async () => {
		mockSignRequestObject.mockRejectedValueOnce(new Error('bad key'));
		const response = await GET(
			makeEvent({
				platformEnv: {
					MDL_DIRECT_QR_REQUEST_PRIVATE_KEY: 'sensitive-private-key-value',
					MDL_DIRECT_QR_REQUEST_X5C: 'sensitive-cert-chain-value'
				}
			})
		);
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.blockers).toContain('direct_request_signer');
		expect(JSON.stringify(body)).not.toContain('sensitive-private-key-value');
		expect(JSON.stringify(body)).not.toContain('sensitive-cert-chain-value');
	});
});
