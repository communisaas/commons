import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	decodeJwt,
	decodeProtectedHeader,
	importSPKI,
	jwtVerify
} from 'jose';
import {
	DC_API_OPENID4VP_REQUEST_TYP,
	DC_API_OPENID4VP_RESPONSE_MODE,
	buildDcApiOpenId4VpRequestPayload,
	calculateJwkThumbprintBytes,
	getDcApiOpenId4VpSignerConfig,
	signDcApiOpenId4VpRequest,
	validateDcApiOpenId4VpSignerConfig
} from '../../../src/lib/server/dc-api-openid4vp-request';

const BASE_TIME = Date.UTC(2026, 0, 1, 12, 0, 0);
const CERT_B64 = 'ZmFrZWNlcnQ=';

function makeEcKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
	const { privateKey, publicKey } = generateKeyPairSync('ec', {
		namedCurve: 'P-256',
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' }
	});
	return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

async function makeEncryptionPublicJwk(): Promise<JsonWebKey> {
	const keyPair = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveKey', 'deriveBits']
	);
	return crypto.subtle.exportKey('jwk', keyPair.publicKey);
}

async function makeWebCryptoSigningMaterial(): Promise<{
	privateKeyPem: string;
	certificateB64: string;
}> {
	const keyPair = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify']
	);
	const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
	const certDer = await buildMinimalCert(keyPair.publicKey);
	return {
		privateKeyPem: pemFromDer('PRIVATE KEY', pkcs8),
		certificateB64: uint8ArrayToBase64(certDer)
	};
}

function pemFromDer(label: string, bytes: Uint8Array): string {
	const b64 = uint8ArrayToBase64(bytes);
	const lines = b64.match(/.{1,64}/g) ?? [];
	return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

async function buildMinimalCert(publicKey: CryptoKey): Promise<Uint8Array> {
	const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
	const ecOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
	const curveOid = new Uint8Array([
		0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07
	]);
	const algId = wrapDERSequence(concatBytes(ecOid, curveOid));
	const bitStringContent = concatBytes(new Uint8Array([0x00]), rawKey);
	const bitString = new Uint8Array([
		0x03,
		...encodeDERLength(bitStringContent.length),
		...bitStringContent
	]);
	const spki = wrapDERSequence(concatBytes(algId, bitString));
	const version = new Uint8Array([0xa0, 0x03, 0x02, 0x01, 0x02]);
	const serial = new Uint8Array([0x02, 0x01, 0x01]);
	const sigAlgOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
	const sigAlg = wrapDERSequence(sigAlgOid);
	const cnOid = new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03]);
	const cnValue = new Uint8Array([0x0c, 0x04, 0x54, 0x65, 0x73, 0x74]);
	const rdnSeq = wrapDERSequence(concatBytes(cnOid, cnValue));
	const rdnSet = new Uint8Array([0x31, ...encodeDERLength(rdnSeq.length), ...rdnSeq]);
	const issuer = wrapDERSequence(rdnSet);
	const notBefore = new Uint8Array([0x17, 0x0d, ...new TextEncoder().encode('250101000000Z')]);
	const notAfter = new Uint8Array([0x17, 0x0d, ...new TextEncoder().encode('351231235959Z')]);
	const validity = wrapDERSequence(concatBytes(notBefore, notAfter));
	const tbsCert = wrapDERSequence(
		concatBytes(version, serial, sigAlg, issuer, validity, issuer, spki)
	);
	const dummySig = new Uint8Array([0x03, 0x03, 0x00, 0x30, 0x00]);
	return wrapDERSequence(concatBytes(tbsCert, sigAlg, dummySig));
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const array of arrays) {
		result.set(array, offset);
		offset += array.length;
	}
	return result;
}

function encodeDERLength(len: number): Uint8Array {
	if (len < 0x80) return new Uint8Array([len]);
	if (len < 0x100) return new Uint8Array([0x81, len]);
	return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function wrapDERSequence(content: Uint8Array): Uint8Array {
	return new Uint8Array([0x30, ...encodeDERLength(content.length), ...content]);
}

describe('DC API OpenID4VP signed request object', () => {
	it('builds the signed cross-device request payload with encryption metadata', async () => {
		const encryptionPublicJwk = await makeEncryptionPublicJwk();
		const payload = await buildDcApiOpenId4VpRequestPayload({
			nonce: 'nonce-001',
			origin: 'https://commons.email',
			encryptionPublicJwk,
			leafCertificateX5c: CERT_B64
		});

		expect(payload.client_id).toMatch(/^x509_hash:/);
		expect(payload.expected_origins).toEqual(['https://commons.email']);
		expect(payload.response_mode).toBe(DC_API_OPENID4VP_RESPONSE_MODE);
		expect(payload.client_metadata.jwks.keys[0]).toMatchObject({
			kty: 'EC',
			crv: 'P-256',
			use: 'enc',
			kid: '1',
			alg: 'ECDH-ES'
		});
		expect(payload.client_metadata.vp_formats_supported.mso_mdoc).toEqual({
			deviceauth_alg_values: [-7],
			issuerauth_alg_values: [-7]
		});
		expect(payload.dcql_query.credentials[0].claims.map((claim) => claim.id)).toEqual([
			'resident_postal_code',
			'resident_city',
			'resident_state',
			'birth_date',
			'document_number'
		]);
		expect(
			payload.dcql_query.credentials[0].claims.every((claim) => claim.intent_to_retain === false)
		).toBe(true);
	});

	it('signs the request object as an OAuth authorization request JWT', async () => {
		const { privateKeyPem, publicKeyPem } = makeEcKeyPair();
		const encryptionPublicJwk = await makeEncryptionPublicJwk();
		const payload = await buildDcApiOpenId4VpRequestPayload({
			nonce: 'nonce-002',
			origin: 'https://commons.email',
			encryptionPublicJwk,
			leafCertificateX5c: CERT_B64
		});
		const jwt = await signDcApiOpenId4VpRequest(
			payload,
			{ privateKeyPem, x5c: [CERT_B64], alg: 'ES256', kid: 'dc-api-test' },
			{ now: BASE_TIME, expiresAt: BASE_TIME + 300_000 }
		);

		const publicKey = await importSPKI(publicKeyPem, 'ES256');
		const verified = await jwtVerify(jwt, publicKey, {
			algorithms: ['ES256'],
			currentDate: new Date(BASE_TIME + 1_000)
		});
		const header = decodeProtectedHeader(jwt);
		const decoded = decodeJwt(jwt);

		expect(header).toMatchObject({
			alg: 'ES256',
			typ: DC_API_OPENID4VP_REQUEST_TYP,
			kid: 'dc-api-test',
			x5c: [CERT_B64]
		});
		expect(verified.payload).toMatchObject({
			iss: payload.client_id,
			aud: 'https://self-issued.me/v2',
			client_id: payload.client_id,
			response_mode: DC_API_OPENID4VP_RESPONSE_MODE,
			expected_origins: ['https://commons.email'],
			iat: Math.floor(BASE_TIME / 1000),
			exp: Math.floor((BASE_TIME + 300_000) / 1000)
		});
		expect(decoded.client_metadata).toEqual(payload.client_metadata);
	});

	it('normalizes signer env and computes stable encryption JWK thumbprints', async () => {
		const { privateKeyPem } = makeEcKeyPair();
		const config = getDcApiOpenId4VpSignerConfig({
			MDL_OPENID4VP_REQUEST_PRIVATE_KEY: privateKeyPem.replace(/\n/g, '\\n'),
			MDL_OPENID4VP_REQUEST_X5C: `-----BEGIN CERTIFICATE-----\n${CERT_B64}\n-----END CERTIFICATE-----`,
			MDL_OPENID4VP_REQUEST_KID: 'kid-001'
		});
		const encryptionPublicJwk = await makeEncryptionPublicJwk();
		const first = await calculateJwkThumbprintBytes(encryptionPublicJwk);
		const second = await calculateJwkThumbprintBytes({ ...encryptionPublicJwk, kid: 'different' });

		expect(config).toMatchObject({
			alg: 'ES256',
			x5c: [CERT_B64],
			kid: 'kid-001',
			audience: 'https://self-issued.me/v2'
		});
		expect(config.privateKeyPem).toContain('BEGIN PRIVATE KEY');
		expect(Array.from(first)).toEqual(Array.from(second));
	});

	it('rejects missing or unsupported signer config', () => {
		const { privateKeyPem } = makeEcKeyPair();

		expect(() => getDcApiOpenId4VpSignerConfig({})).toThrow(
			'MDL_OPENID4VP_REQUEST_PRIVATE_KEY_MISSING'
		);
		expect(() =>
			getDcApiOpenId4VpSignerConfig({
				MDL_OPENID4VP_REQUEST_PRIVATE_KEY: privateKeyPem,
				MDL_OPENID4VP_REQUEST_X5C: CERT_B64,
				MDL_OPENID4VP_REQUEST_ALG: 'RS256'
			})
		).toThrow('MDL_OPENID4VP_REQUEST_ALG_UNSUPPORTED');
	});

	it('validates certificate validity and private-key binding for readiness', async () => {
		const { privateKeyPem, certificateB64 } = await makeWebCryptoSigningMaterial();

		await expect(
			validateDcApiOpenId4VpSignerConfig(
				{ privateKeyPem, x5c: [certificateB64], alg: 'ES256' },
				{ now: BASE_TIME }
			)
		).resolves.toBeUndefined();
	});

	it('rejects browser-mediated signer configs whose key does not match the certificate', async () => {
		const { certificateB64 } = await makeWebCryptoSigningMaterial();
		const { privateKeyPem: wrongPrivateKeyPem } = await makeWebCryptoSigningMaterial();

		await expect(
			validateDcApiOpenId4VpSignerConfig(
				{ privateKeyPem: wrongPrivateKeyPem, x5c: [certificateB64], alg: 'ES256' },
				{ now: BASE_TIME }
			)
		).rejects.toThrow('MDL_OPENID4VP_REQUEST_X5C_KEY_MISMATCH');
	});
});
