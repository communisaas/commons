import { CompactSign, importPKCS8, type CompactJWSHeaderParameters, type JWK } from 'jose';
import { extractEcPublicKeyFromDER, extractValidityPeriod } from '$lib/core/identity/cose-verify';

export const DC_API_OPENID4VP_REQUEST_TYP = 'oauth-authz-req+jwt';
export const DC_API_OPENID4VP_RESPONSE_MODE = 'dc_api.jwt';

const DEFAULT_SIGNING_ALG = 'ES256';
const DEFAULT_REQUEST_OBJECT_AUDIENCE = 'https://self-issued.me/v2';
const SUPPORTED_SIGNING_ALGS = new Set(['ES256']);
const importedKeys = new Map<string, Promise<CryptoKey>>();

export interface DcApiOpenId4VpSignerEnv {
	MDL_OPENID4VP_REQUEST_PRIVATE_KEY?: string;
	MDL_OPENID4VP_REQUEST_X5C?: string;
	MDL_OPENID4VP_REQUEST_ALG?: string;
	MDL_OPENID4VP_REQUEST_KID?: string;
	MDL_OPENID4VP_REQUEST_AUD?: string;
}

export interface DcApiOpenId4VpSignerConfig {
	privateKeyPem: string;
	x5c: string[];
	alg?: string;
	kid?: string;
	audience?: string;
}

export interface DcApiOpenId4VpSignerValidationOptions {
	now?: number;
}

export type MdlClaimId =
	| 'resident_postal_code'
	| 'resident_city'
	| 'resident_state'
	| 'birth_date'
	| 'document_number';

export interface DcApiOpenId4VpRequestPayload {
	client_id: string;
	response_type: 'vp_token';
	response_mode: typeof DC_API_OPENID4VP_RESPONSE_MODE;
	nonce: string;
	expected_origins: string[];
	client_metadata: {
		jwks: {
			keys: JWK[];
		};
		vp_formats_supported: {
			mso_mdoc: {
				deviceauth_alg_values: number[];
				issuerauth_alg_values: number[];
			};
		};
	};
	dcql_query: {
		credentials: Array<{
			id: 'mdl';
			format: 'mso_mdoc';
			meta: { doctype_value: 'org.iso.18013.5.1.mDL' };
			claims: Array<{
				id: MdlClaimId;
				path: ['org.iso.18013.5.1', MdlClaimId];
				intent_to_retain: false;
			}>;
		}>;
	};
}

export function getDcApiOpenId4VpSignerConfig(
	env: DcApiOpenId4VpSignerEnv | undefined
): DcApiOpenId4VpSignerConfig {
	const privateKeyPem = normalizePem(env?.MDL_OPENID4VP_REQUEST_PRIVATE_KEY);
	const x5c = parseX5c(env?.MDL_OPENID4VP_REQUEST_X5C);
	const alg = env?.MDL_OPENID4VP_REQUEST_ALG?.trim() || DEFAULT_SIGNING_ALG;
	const kid = env?.MDL_OPENID4VP_REQUEST_KID?.trim() || undefined;
	const audience = env?.MDL_OPENID4VP_REQUEST_AUD?.trim() || DEFAULT_REQUEST_OBJECT_AUDIENCE;

	if (!privateKeyPem) throw new Error('MDL_OPENID4VP_REQUEST_PRIVATE_KEY_MISSING');
	if (x5c.length === 0) throw new Error('MDL_OPENID4VP_REQUEST_X5C_MISSING');
	if (!SUPPORTED_SIGNING_ALGS.has(alg)) throw new Error('MDL_OPENID4VP_REQUEST_ALG_UNSUPPORTED');
	if (!audience) throw new Error('MDL_OPENID4VP_REQUEST_AUD_MISSING');

	return { privateKeyPem, x5c, alg, kid, audience };
}

export async function buildDcApiOpenId4VpRequestPayload(input: {
	nonce: string;
	origin: string;
	encryptionPublicJwk: JWK;
	leafCertificateX5c: string;
}): Promise<DcApiOpenId4VpRequestPayload> {
	if (!input.nonce) throw new Error('MDL_OPENID4VP_REQUEST_NONCE_MISSING');
	if (!input.origin) throw new Error('MDL_OPENID4VP_REQUEST_ORIGIN_MISSING');

	const clientId = await buildX509HashClientId(input.leafCertificateX5c);
	const encryptionJwk = normalizeEncryptionPublicJwk(input.encryptionPublicJwk);

	return {
		client_id: clientId,
		response_type: 'vp_token',
		response_mode: DC_API_OPENID4VP_RESPONSE_MODE,
		nonce: input.nonce,
		expected_origins: [input.origin],
		client_metadata: {
			jwks: { keys: [encryptionJwk] },
			vp_formats_supported: {
				mso_mdoc: {
					deviceauth_alg_values: [-7],
					issuerauth_alg_values: [-7]
				}
			}
		},
		dcql_query: {
			credentials: [
				{
					id: 'mdl',
					format: 'mso_mdoc',
					meta: { doctype_value: 'org.iso.18013.5.1.mDL' },
					claims: [
						{
							id: 'resident_postal_code',
							path: ['org.iso.18013.5.1', 'resident_postal_code'],
							intent_to_retain: false
						},
						{
							id: 'resident_city',
							path: ['org.iso.18013.5.1', 'resident_city'],
							intent_to_retain: false
						},
						{
							id: 'resident_state',
							path: ['org.iso.18013.5.1', 'resident_state'],
							intent_to_retain: false
						},
						{
							id: 'birth_date',
							path: ['org.iso.18013.5.1', 'birth_date'],
							intent_to_retain: false
						},
						{
							id: 'document_number',
							path: ['org.iso.18013.5.1', 'document_number'],
							intent_to_retain: false
						}
					]
				}
			]
		}
	};
}

export async function signDcApiOpenId4VpRequest(
	payload: DcApiOpenId4VpRequestPayload,
	config: DcApiOpenId4VpSignerConfig,
	options: { now?: number; expiresAt?: number } = {}
): Promise<string> {
	const alg = config.alg ?? DEFAULT_SIGNING_ALG;
	if (!SUPPORTED_SIGNING_ALGS.has(alg)) throw new Error('MDL_OPENID4VP_REQUEST_ALG_UNSUPPORTED');

	const key = await importSigningKey(config.privateKeyPem, alg);
	const now = Math.floor((options.now ?? Date.now()) / 1000);
	const expiresAt = Math.floor((options.expiresAt ?? (options.now ?? Date.now()) + 300_000) / 1000);
	const protectedHeader: CompactJWSHeaderParameters = {
		alg,
		typ: DC_API_OPENID4VP_REQUEST_TYP,
		x5c: config.x5c
	};
	if (config.kid) protectedHeader.kid = config.kid;

	const jwtPayload = {
		iss: payload.client_id,
		aud: config.audience ?? DEFAULT_REQUEST_OBJECT_AUDIENCE,
		...payload,
		iat: now,
		exp: expiresAt
	};

	const payloadBytes = new Uint8Array(new TextEncoder().encode(JSON.stringify(jwtPayload)));
	return new CompactSign(payloadBytes).setProtectedHeader(protectedHeader).sign(key);
}

export async function validateDcApiOpenId4VpSignerConfig(
	config: DcApiOpenId4VpSignerConfig,
	options: DcApiOpenId4VpSignerValidationOptions = {}
): Promise<void> {
	const leafCertificate = config.x5c[0];
	if (!leafCertificate) throw new Error('MDL_OPENID4VP_REQUEST_X5C_MISSING');

	const leafDer = base64ToUint8Array(leafCertificate);
	const { notBefore, notAfter } = extractValidityPeriod(leafDer);
	const now = new Date(options.now ?? Date.now());
	if (now < notBefore) throw new Error('MDL_OPENID4VP_REQUEST_X5C_NOT_YET_VALID');
	if (now > notAfter) throw new Error('MDL_OPENID4VP_REQUEST_X5C_EXPIRED');

	await verifyEcPrivateKeyMatchesCertificate(config.privateKeyPem, leafDer);
}

export async function calculateJwkThumbprintBytes(publicJwk: JWK): Promise<Uint8Array> {
	const normalized = normalizeEncryptionPublicJwk(publicJwk);
	const canonical = JSON.stringify({
		crv: normalized.crv,
		kty: normalized.kty,
		x: normalized.x,
		y: normalized.y
	});
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
}

function normalizeEncryptionPublicJwk(jwk: JWK): JWK {
	const { kty, crv, x, y } = jwk;
	if (kty !== 'EC' || crv !== 'P-256' || typeof x !== 'string' || typeof y !== 'string') {
		throw new Error('MDL_OPENID4VP_ENCRYPTION_JWK_INVALID');
	}
	return {
		kty,
		crv,
		x,
		y,
		use: 'enc',
		kid: typeof jwk.kid === 'string' && jwk.kid ? jwk.kid : '1',
		alg: 'ECDH-ES'
	};
}

async function buildX509HashClientId(leafCertificateX5c: string): Promise<string> {
	const certificateDer = base64ToUint8Array(normalizeX5cEntry(leafCertificateX5c));
	const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', certificateDer));
	return `x509_hash:${base64UrlEncode(fingerprint)}`;
}

function parseX5c(raw: string | undefined): string[] {
	if (!raw) return [];
	const trimmed = raw.trim();
	if (!trimmed) return [];

	let values: string[];
	if (trimmed.startsWith('[')) {
		const parsed = JSON.parse(trimmed) as unknown;
		if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
			throw new Error('MDL_OPENID4VP_REQUEST_X5C_INVALID');
		}
		values = parsed;
	} else {
		values = trimmed.split(/[\n,]+/);
	}

	const normalized = values.map(normalizeX5cEntry).filter((value) => value.length > 0);
	if (normalized.some((value) => !/^[A-Za-z0-9+/=]+$/.test(value))) {
		throw new Error('MDL_OPENID4VP_REQUEST_X5C_INVALID');
	}
	return normalized;
}

function normalizeX5cEntry(value: string): string {
	return value
		.replace(/-----BEGIN CERTIFICATE-----/g, '')
		.replace(/-----END CERTIFICATE-----/g, '')
		.replace(/\s+/g, '')
		.trim();
}

function normalizePem(raw: string | undefined): string {
	return raw?.replace(/\\n/g, '\n').trim() ?? '';
}

function base64ToUint8Array(value: string): Uint8Array {
	const binary = atob(value.replace(/\s+/g, ''));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function importSigningKey(privateKeyPem: string, alg: string): Promise<CryptoKey> {
	const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(privateKeyPem));
	const cacheKey = `${alg}:${base64UrlEncode(new Uint8Array(fingerprint))}`;
	let keyPromise = importedKeys.get(cacheKey);
	if (!keyPromise) {
		keyPromise = importPKCS8(privateKeyPem, alg);
		importedKeys.set(cacheKey, keyPromise);
	}
	return keyPromise;
}

async function verifyEcPrivateKeyMatchesCertificate(
	privateKeyPem: string,
	certificateDer: Uint8Array
): Promise<void> {
	const { keyBytes, curve } = extractEcPublicKeyFromDER(certificateDer);
	if (curve !== 'P-256') throw new Error('MDL_OPENID4VP_REQUEST_X5C_CURVE_UNSUPPORTED');

	const publicKey = await crypto.subtle.importKey(
		'jwk',
		{
			kty: 'EC',
			crv: 'P-256',
			x: base64UrlEncode(keyBytes.slice(1, 33)),
			y: base64UrlEncode(keyBytes.slice(33, 65)),
			ext: false
		},
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['verify']
	);
	const privateKey = await importSigningKey(privateKeyPem, 'ES256');
	const challenge = new TextEncoder().encode('commons-openid4vp-request-object-signer-check');
	const signature = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		privateKey,
		challenge as BufferSource
	);
	const verified = await crypto.subtle.verify(
		{ name: 'ECDSA', hash: 'SHA-256' },
		publicKey,
		signature,
		challenge as BufferSource
	);
	if (!verified) throw new Error('MDL_OPENID4VP_REQUEST_X5C_KEY_MISMATCH');
}
