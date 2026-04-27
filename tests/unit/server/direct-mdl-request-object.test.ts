import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	decodeJwt,
	decodeProtectedHeader,
	importSPKI,
	jwtVerify
} from 'jose';
import {
	DIRECT_MDL_AUTHORIZATION_REQUEST_SCHEME,
	DIRECT_MDL_REQUEST_OBJECT_TYP,
	buildDirectMdlAuthorizationRequestUrl,
	buildDirectMdlRequestObjectPayload,
	getDirectMdlRequestObjectSignerConfig,
	signDirectMdlRequestObject
} from '../../../src/lib/server/direct-mdl-request-object';
import {
	DIRECT_MDL_SESSION_TTL_SECONDS,
	DIRECT_MDL_TRANSPORT,
	type DirectMdlSession
} from '../../../src/lib/server/direct-mdl-session';

const BASE_TIME = Date.UTC(2026, 0, 1, 12, 0, 0);
const RESPONSE_URI = 'https://commons.email/api/identity/direct-mdl/complete';
const REQUEST_URI =
	'https://commons.email/api/identity/direct-mdl/request/11111111-1111-4111-8111-111111111111';
const CLIENT_ID = 'x509_san_dns:commons.email';

function session(overrides: Partial<DirectMdlSession> = {}): DirectMdlSession {
	return {
		id: '11111111-1111-4111-8111-111111111111',
		desktopUserId: 'user-direct-001',
		transport: DIRECT_MDL_TRANSPORT,
		clientId: CLIENT_ID,
		responseUri: RESPONSE_URI,
		requestUri: REQUEST_URI,
		nonce: 'server-nonce-001',
		state: 'server-state-001',
		transactionId: 'desktop-transaction-001',
		status: 'created',
		createdAt: BASE_TIME,
		expiresAt: BASE_TIME + DIRECT_MDL_SESSION_TTL_SECONDS * 1000,
		...overrides
	};
}

function makeEcKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
	const { privateKey, publicKey } = generateKeyPairSync('ec', {
		namedCurve: 'P-256',
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' }
	});
	return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

describe('direct mDL OpenID4VP request object', () => {
	it('builds the direct_post payload without leaking QR-only request_uri fields', () => {
		const payload = buildDirectMdlRequestObjectPayload(session(), {
			walletNonce: 'wallet-nonce-001',
			now: BASE_TIME
		});

		expect(payload).toMatchObject({
			client_id: CLIENT_ID,
			response_uri: RESPONSE_URI,
			response_type: 'vp_token',
			response_mode: 'direct_post',
			nonce: 'server-nonce-001',
			state: 'server-state-001',
			wallet_nonce: 'wallet-nonce-001'
		});
		expect(payload.dcql_query.credentials[0]).toMatchObject({
			id: 'mdl',
			format: 'mso_mdoc',
			meta: { doctype_value: 'org.iso.18013.5.1.mDL' }
		});
		expect(payload.dcql_query.credentials[0].claims.map((claim) => claim.id)).toEqual([
			'resident_postal_code',
			'resident_city',
			'resident_state',
			'birth_date',
			'document_number'
		]);
		expect(payload.dcql_query.credentials[0].claims.every((claim) => claim.intent_to_retain === false)).toBe(
			true
		);
		expect(payload.client_metadata.vp_formats_supported.mso_mdoc).toEqual({
			deviceauth_alg_values: [-7],
			issuerauth_alg_values: [-7]
		});
		expect('request_uri' in payload).toBe(false);
		expect('request_uri_method' in payload).toBe(false);
	});

	it('signs the request object with oauth-authz-req+jwt typ and x5c', async () => {
		const { privateKeyPem, publicKeyPem } = makeEcKeyPair();
		const jwt = await signDirectMdlRequestObject(
			session(),
			{ privateKeyPem, x5c: ['MIIDfakecert=='], alg: 'ES256', kid: 'direct-test' },
			{ walletNonce: 'wallet-nonce-001', now: BASE_TIME }
		);
		const publicKey = await importSPKI(publicKeyPem, 'ES256');
		const verified = await jwtVerify(jwt, publicKey, {
			algorithms: ['ES256'],
			currentDate: new Date(BASE_TIME + 1_000)
		});
		const header = decodeProtectedHeader(jwt);

		expect(header).toMatchObject({
			alg: 'ES256',
			typ: DIRECT_MDL_REQUEST_OBJECT_TYP,
			kid: 'direct-test',
			x5c: ['MIIDfakecert==']
		});
		expect(verified.payload).toMatchObject({
			iss: CLIENT_ID,
			aud: 'https://self-issued.me/v2',
			client_id: CLIENT_ID,
			response_uri: RESPONSE_URI,
			response_mode: 'direct_post',
			wallet_nonce: 'wallet-nonce-001',
			iat: Math.floor(BASE_TIME / 1000),
			exp: Math.floor((BASE_TIME + DIRECT_MDL_SESSION_TTL_SECONDS * 1000) / 1000)
		});
		expect(decodeJwt(jwt).request_uri_method).toBeUndefined();
	});

	it('builds a QR authorization request containing only client_id, request_uri, and request_uri_method', () => {
		const authorizationRequest = buildDirectMdlAuthorizationRequestUrl({
			clientId: CLIENT_ID,
			requestUri: REQUEST_URI
		});
		const parsed = new URL(authorizationRequest);

		expect(parsed.origin).toBe('null');
		expect(`${parsed.protocol}//${parsed.host}`).toBe(DIRECT_MDL_AUTHORIZATION_REQUEST_SCHEME);
		expect([...parsed.searchParams.keys()].sort()).toEqual([
			'client_id',
			'request_uri',
			'request_uri_method'
		]);
		expect(parsed.searchParams.get('client_id')).toBe(CLIENT_ID);
		expect(parsed.searchParams.get('request_uri')).toBe(REQUEST_URI);
		expect(parsed.searchParams.get('request_uri_method')).toBe('post');
	});

	it('rejects redirect_uri client_id values for signed request objects', () => {
		expect(() =>
			buildDirectMdlRequestObjectPayload(
				session({
					clientId: `redirect_uri:${RESPONSE_URI}`
				}),
				{ now: BASE_TIME }
			)
		).toThrow('DIRECT_MDL_SIGNED_CLIENT_ID_UNSUPPORTED');
	});

	it('rejects x509_san_dns client_id values that do not match response_uri host', () => {
		expect(() =>
			buildDirectMdlRequestObjectPayload(
				session({
					clientId: 'x509_san_dns:attacker.example'
				}),
				{ now: BASE_TIME }
			)
		).toThrow('DIRECT_MDL_RESPONSE_URI_HOST_MISMATCH');
	});

	it('rejects non-HTTPS request_uri values outside local development', () => {
		expect(() =>
			buildDirectMdlAuthorizationRequestUrl({
				clientId: 'x509_san_dns:example.com',
				requestUri: 'http://example.com/request'
			})
		).toThrow('DIRECT_MDL_REQUEST_URI_MUST_USE_HTTPS');
	});

	it('normalizes signer env x5c without accepting missing key material', () => {
		expect(() => getDirectMdlRequestObjectSignerConfig({})).toThrow(
			'DIRECT_MDL_REQUEST_PRIVATE_KEY_MISSING'
		);

		const { privateKeyPem } = makeEcKeyPair();
		const config = getDirectMdlRequestObjectSignerConfig({
			MDL_DIRECT_QR_REQUEST_PRIVATE_KEY: privateKeyPem.replace(/\n/g, '\\n'),
			MDL_DIRECT_QR_REQUEST_X5C: '-----BEGIN CERTIFICATE-----\nMIIDfakecert==\n-----END CERTIFICATE-----',
			MDL_DIRECT_QR_REQUEST_KID: 'kid-001'
		});

		expect(config).toMatchObject({
			alg: 'ES256',
			x5c: ['MIIDfakecert=='],
			kid: 'kid-001',
			audience: 'https://self-issued.me/v2'
		});
		expect(config.privateKeyPem).toContain('BEGIN PRIVATE KEY');
	});
});
