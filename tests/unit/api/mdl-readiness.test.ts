import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockDev,
	mockPrivateEnv,
	mockFeatures,
	mockDcSignerConfig,
	mockValidateDcSignerConfig,
	mockBuildDcPayload,
	mockSignDcRequest,
	mockCalculateJwkThumbprint,
	mockProcessCredentialResponse
} = vi.hoisted(() => ({
	mockDev: { value: false },
	mockPrivateEnv: { INTERNAL_API_SECRET: 'test-secret' } as Record<string, string | undefined>,
	mockFeatures: {
		MDL_ANDROID_OID4VP: true,
		MDL_MDOC: false,
		MDL_IOS: false
	},
	mockDcSignerConfig: vi.fn(),
	mockValidateDcSignerConfig: vi.fn(),
	mockBuildDcPayload: vi.fn(),
	mockSignDcRequest: vi.fn(),
	mockCalculateJwkThumbprint: vi.fn(),
	mockProcessCredentialResponse: vi.fn()
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
	OPENID4VP_DC_API_PROTOCOL: 'openid4vp-v1-signed'
}));

vi.mock('$lib/server/dc-api-openid4vp-request', () => ({
	DC_API_OPENID4VP_RESPONSE_MODE: 'dc_api.jwt',
	getDcApiOpenId4VpSignerConfig: (...args: unknown[]) => mockDcSignerConfig(...args),
	validateDcApiOpenId4VpSignerConfig: (...args: unknown[]) => mockValidateDcSignerConfig(...args),
	buildDcApiOpenId4VpRequestPayload: (...args: unknown[]) => mockBuildDcPayload(...args),
	calculateJwkThumbprintBytes: (...args: unknown[]) => mockCalculateJwkThumbprint(...args),
	signDcApiOpenId4VpRequest: (...args: unknown[]) => mockSignDcRequest(...args)
}));

vi.mock('$lib/core/identity/mdl-verification', () => ({
	processCredentialResponse: (...args: unknown[]) => mockProcessCredentialResponse(...args)
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
				MDL_OPENID4VP_REQUEST_PRIVATE_KEY: 'configured',
				MDL_OPENID4VP_REQUEST_X5C: 'configured',
				...options.platformEnv
			}
		}
	} as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	mockDev.value = false;
	mockPrivateEnv.INTERNAL_API_SECRET = 'test-secret';
	mockFeatures.MDL_ANDROID_OID4VP = true;
	mockFeatures.MDL_MDOC = false;
	mockFeatures.MDL_IOS = false;
	kv.get.mockResolvedValue('ok');
	kv.put.mockResolvedValue(undefined);
	kv.delete.mockResolvedValue(undefined);
	mockDcSignerConfig.mockReturnValue({ privateKeyPem: 'configured', x5c: ['configured'] });
	mockValidateDcSignerConfig.mockResolvedValue(undefined);
	mockBuildDcPayload.mockResolvedValue({
		client_id: 'x509_hash:readiness',
		response_type: 'vp_token',
		response_mode: 'dc_api.jwt',
		nonce: 'readinessNonce0001',
		expected_origins: ['https://staging.commons.email'],
		client_metadata: { jwks: { keys: [] }, vp_formats_supported: { mso_mdoc: {} } },
		dcql_query: { credentials: [] }
	});
	mockSignDcRequest.mockResolvedValue('signed.dc.jwt');
	mockCalculateJwkThumbprint.mockResolvedValue(new Uint8Array(32).fill(1));
	mockProcessCredentialResponse.mockResolvedValue({
		success: false,
		error: 'invalid_format',
		message: 'OpenID4VP vp_token object does not contain an mso_mdoc credential array'
	});
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

	it('returns ok when the browser-mediated staging smoke surface is configured', async () => {
		const response = await GET(makeEvent());
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('ok');
		expect(body.blockers).toEqual([]);
		expect(body.warnings).toEqual([]);
		expect(body.featureFlags).toEqual({
			MDL_ANDROID_OID4VP: true,
			MDL_MDOC: false,
			MDL_IOS: false
		});
		expect(body.bindings).toEqual({ DC_SESSION_KV: true });
		expect(body.digitalCredentials).toMatchObject({
			protocol: 'openid4vp-v1-signed',
			responseMode: 'dc_api.jwt',
			requestObject: 'signed'
		});
		expect(body).not.toHaveProperty('directRequest');
		expect(JSON.stringify(body)).not.toContain('DIRECT_MDL');
		expect(JSON.stringify(body)).not.toContain('MDL_DIRECT');
		expect(mockValidateDcSignerConfig).toHaveBeenCalledWith(
			{ privateKeyPem: 'configured', x5c: ['configured'] },
			expect.objectContaining({ now: expect.any(Number) })
		);
			expect(mockSignDcRequest).toHaveBeenCalledOnce();
			expect(kv.put).toHaveBeenCalledWith(expect.stringMatching(/^mdl-readiness:/), 'ok', {
				expirationTtl: 60
			});
			expect(kv.get).toHaveBeenCalledWith(expect.stringMatching(/^mdl-readiness:/));
			expect(kv.delete).toHaveBeenCalledWith(expect.stringMatching(/^mdl-readiness:/));
			expect(mockProcessCredentialResponse).toHaveBeenCalledWith(
			expect.any(String),
			'openid4vp-v1-signed',
			expect.any(Object),
			'readinessNonce0001',
			expect.objectContaining({
				verifierOrigin: 'https://staging.commons.email',
				dcApiJwkThumbprint: new Uint8Array(32).fill(1)
			})
		);
	});

	it('accepts a canonical origin override for immutable deployment readiness probes', async () => {
		const response = await GET(
			makeEvent({
				origin: 'https://production.communique-site.pages.dev',
				headers: { 'x-readiness-origin': 'https://commons.email' },
				platformEnv: { PUBLIC_APP_URL: 'https://commons.email' }
			})
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.status).toBe('ok');
		expect(body.blockers).toEqual([]);
	});

	it('blocks readiness origin overrides that do not match PUBLIC_APP_URL', async () => {
		const response = await GET(
			makeEvent({
				origin: 'https://production.communique-site.pages.dev',
				headers: { 'x-readiness-origin': 'https://evil.example' },
				platformEnv: { PUBLIC_APP_URL: 'https://commons.email' }
			})
		);
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.blockers).toContain('public_app_url');
		expect(mockSignDcRequest).not.toHaveBeenCalled();
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
		expect(body.blockers).toContain('dc_api_request_signer');
	});

		it('blocks when DC_SESSION_KV is missing', async () => {
		const response = await GET(
			makeEvent({
				platformEnv: {
					DC_SESSION_KV: undefined
				}
			})
		);
		expect(response.status).toBe(503);
			const body = await response.json();
			expect(body.blockers).toContain('dc_session_kv');
		});

		it('blocks when DC_SESSION_KV cannot write and read verifier sessions', async () => {
			kv.get.mockResolvedValueOnce(null);
			const response = await GET(makeEvent());
			expect(response.status).toBe(503);
			const body = await response.json();
			expect(body.blockers).toContain('dc_session_kv');
			expect(body.checks.find((check: { id: string }) => check.id === 'dc_session_kv').message).toContain(
				'KV_READ_MISMATCH'
			);
		});

	it('blocks when the browser-mediated OpenID4VP signer cannot validate', async () => {
		mockValidateDcSignerConfig.mockRejectedValueOnce(new Error('bad dc certificate'));
		const response = await GET(
			makeEvent({
				platformEnv: {
					MDL_OPENID4VP_REQUEST_PRIVATE_KEY: 'sensitive-openid4vp-private-key',
					MDL_OPENID4VP_REQUEST_X5C: 'sensitive-openid4vp-cert-chain'
				}
			})
		);
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.blockers).toContain('dc_api_request_signer');
		expect(JSON.stringify(body)).not.toContain('sensitive-openid4vp-private-key');
		expect(JSON.stringify(body)).not.toContain('sensitive-openid4vp-cert-chain');
		expect(mockSignDcRequest).not.toHaveBeenCalled();
	});

	it('blocks when the browser-mediated OpenID4VP signer cannot sign', async () => {
		mockSignDcRequest.mockRejectedValueOnce(new Error('bad dc key'));
		const response = await GET(
			makeEvent({
				platformEnv: {
					MDL_OPENID4VP_REQUEST_PRIVATE_KEY: 'sensitive-openid4vp-private-key',
					MDL_OPENID4VP_REQUEST_X5C: 'sensitive-openid4vp-cert-chain'
				}
			})
		);
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.blockers).toContain('dc_api_request_signer');
		expect(JSON.stringify(body)).not.toContain('sensitive-openid4vp-private-key');
		expect(JSON.stringify(body)).not.toContain('sensitive-openid4vp-cert-chain');
	});

	it('blocks when the browser-mediated encrypted response probe cannot decrypt', async () => {
		mockProcessCredentialResponse.mockResolvedValueOnce({
			success: false,
			error: 'decryption_failed',
			message: 'Failed to decrypt OpenID4VP dc_api.jwt response'
		});
		const response = await GET(makeEvent());
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.blockers).toContain('dc_api_request_signer');
		expect(JSON.stringify(body)).not.toContain('signed.dc.jwt');
	});
});
