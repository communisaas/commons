import { CompactSign, importPKCS8, type CompactJWSHeaderParameters, type CryptoKey } from 'jose';
import {
	normalizeOpenId4VpClientId,
	normalizeOpenId4VpResponseUri
} from '$lib/core/identity/oid4vp-direct-handover';
import { extractEcPublicKeyFromDER, extractValidityPeriod } from '$lib/core/identity/cose-verify';
import {
	DIRECT_MDL_SESSION_TTL_SECONDS,
	DIRECT_MDL_TRANSPORT,
	type DirectMdlSession
} from '$lib/server/direct-mdl-session';

export const DIRECT_MDL_REQUEST_OBJECT_CONTENT_TYPE = 'application/oauth-authz-req+jwt';
export const DIRECT_MDL_REQUEST_OBJECT_TYP = 'oauth-authz-req+jwt';
export const DIRECT_MDL_AUTHORIZATION_REQUEST_SCHEME = 'openid4vp://authorize';
export const DIRECT_MDL_REQUEST_URI_METHOD = 'post';

export interface DirectMdlRequestObjectSignerConfig {
	privateKeyPem: string;
	x5c: string[];
	alg?: string;
	kid?: string;
	audience?: string;
}

export interface DirectMdlRequestObjectEnv {
	MDL_DIRECT_QR_REQUEST_PRIVATE_KEY?: string;
	MDL_DIRECT_QR_REQUEST_X5C?: string;
	MDL_DIRECT_QR_REQUEST_ALG?: string;
	MDL_DIRECT_QR_REQUEST_KID?: string;
	MDL_DIRECT_QR_REQUEST_AUD?: string;
}

export interface DirectMdlRequestObjectOptions {
	walletNonce?: string;
	allowLocalhostHttp?: boolean;
	expectedRequestUri?: string;
	expectedResponseUri?: string;
	now?: number;
}

export interface DirectMdlSignerValidationOptions {
	now?: number;
}

export type DirectMdlRequestObjectPayload = {
	client_id: string;
	response_uri: string;
	response_type: 'vp_token';
	response_mode: typeof DIRECT_MDL_TRANSPORT;
	nonce: string;
	state: string;
	wallet_nonce?: string;
	client_metadata: {
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
				id:
					| 'resident_postal_code'
					| 'resident_city'
					| 'resident_state'
					| 'birth_date'
					| 'document_number';
				path: ['org.iso.18013.5.1', string];
				intent_to_retain: false;
			}>;
		}>;
	};
};

type RequestUriValidationOptions = { allowLocalhostHttp?: boolean };

const DEFAULT_SIGNING_ALG = 'ES256';
const DEFAULT_REQUEST_OBJECT_AUDIENCE = 'https://self-issued.me/v2';
const SUPPORTED_SIGNING_ALGS = new Set(['ES256']);
const X509_SAN_DNS_CLIENT_ID_PREFIX = 'x509_san_dns:';
const SUBJECT_ALT_NAME_OID = new Uint8Array([0x06, 0x03, 0x55, 0x1d, 0x11]);
const importedKeys = new Map<string, Promise<CryptoKey>>();

export function getDirectMdlRequestObjectSignerConfig(
	env: DirectMdlRequestObjectEnv | undefined
): DirectMdlRequestObjectSignerConfig {
	const privateKeyPem = normalizePem(env?.MDL_DIRECT_QR_REQUEST_PRIVATE_KEY);
	const x5c = parseX5c(env?.MDL_DIRECT_QR_REQUEST_X5C);
	const alg = env?.MDL_DIRECT_QR_REQUEST_ALG?.trim() || DEFAULT_SIGNING_ALG;
	const kid = env?.MDL_DIRECT_QR_REQUEST_KID?.trim() || undefined;
	const audience = env?.MDL_DIRECT_QR_REQUEST_AUD?.trim() || DEFAULT_REQUEST_OBJECT_AUDIENCE;

	if (!privateKeyPem) throw new Error('DIRECT_MDL_REQUEST_PRIVATE_KEY_MISSING');
	if (x5c.length === 0) throw new Error('DIRECT_MDL_REQUEST_X5C_MISSING');
	if (!SUPPORTED_SIGNING_ALGS.has(alg)) throw new Error('DIRECT_MDL_REQUEST_ALG_UNSUPPORTED');
	if (!audience) throw new Error('DIRECT_MDL_REQUEST_AUD_MISSING');

	return { privateKeyPem, x5c, alg, kid, audience };
}

export async function validateDirectMdlRequestObjectSignerConfig(
	config: DirectMdlRequestObjectSignerConfig,
	expectedDnsName: string,
	options: DirectMdlSignerValidationOptions = {}
): Promise<void> {
	const leafCertificate = config.x5c[0];
	if (!leafCertificate) throw new Error('DIRECT_MDL_REQUEST_X5C_MISSING');

	const leafDer = base64ToUint8Array(leafCertificate);
	const expected = expectedDnsName.trim().toLowerCase();
	if (!isDnsName(expected)) throw new Error('DIRECT_MDL_CLIENT_ID_INVALID_X509_SAN_DNS');
	if (!certificateHasDnsSan(leafDer, expected)) {
		throw new Error('DIRECT_MDL_REQUEST_X5C_SAN_MISMATCH');
	}

	const { notBefore, notAfter } = extractValidityPeriod(leafDer);
	const now = new Date(options.now ?? Date.now());
	if (now < notBefore) throw new Error('DIRECT_MDL_REQUEST_X5C_NOT_YET_VALID');
	if (now > notAfter) throw new Error('DIRECT_MDL_REQUEST_X5C_EXPIRED');

	await verifyEcPrivateKeyMatchesCertificate(config.privateKeyPem, leafDer);
}

export function buildDirectMdlAuthorizationRequestUrl(input: {
	clientId: string;
	requestUri: string;
	authorizationEndpoint?: string;
	allowLocalhostHttp?: boolean;
}): string {
	const authorizationEndpoint =
		input.authorizationEndpoint ?? DIRECT_MDL_AUTHORIZATION_REQUEST_SCHEME;
	const parsedEndpoint = new URL(authorizationEndpoint);
	if (parsedEndpoint.protocol !== 'openid4vp:' && parsedEndpoint.protocol !== 'https:') {
		throw new Error('DIRECT_MDL_AUTHORIZATION_ENDPOINT_UNSUPPORTED');
	}
	if (parsedEndpoint.search || parsedEndpoint.hash) {
		throw new Error('DIRECT_MDL_AUTHORIZATION_ENDPOINT_MUST_NOT_INCLUDE_PARAMS');
	}

	const clientId = normalizeOpenId4VpClientId(input.clientId, {
		allowLocalhostHttp: input.allowLocalhostHttp
	});
	assertSignedRequestClientIdPrefix(clientId);
	const requestUri = normalizeDirectMdlRequestUri(input.requestUri, {
		allowLocalhostHttp: input.allowLocalhostHttp
	});

	parsedEndpoint.searchParams.set('client_id', clientId);
	parsedEndpoint.searchParams.set('request_uri', requestUri);
	parsedEndpoint.searchParams.set('request_uri_method', DIRECT_MDL_REQUEST_URI_METHOD);
	return parsedEndpoint.toString();
}

export function buildDirectMdlRequestObjectPayload(
	session: DirectMdlSession,
	options: DirectMdlRequestObjectOptions = {}
): DirectMdlRequestObjectPayload {
	assertDirectMdlRequestSession(session, options);

	const payload: DirectMdlRequestObjectPayload = {
		client_id: session.clientId,
		response_uri: session.responseUri,
		response_type: 'vp_token',
		response_mode: DIRECT_MDL_TRANSPORT,
		nonce: session.nonce,
		state: session.state,
		client_metadata: {
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

	if (options.walletNonce) payload.wallet_nonce = options.walletNonce;
	return payload;
}

export async function signDirectMdlRequestObject(
	session: DirectMdlSession,
	config: DirectMdlRequestObjectSignerConfig,
	options: DirectMdlRequestObjectOptions = {}
): Promise<string> {
	const alg = config.alg ?? DEFAULT_SIGNING_ALG;
	if (!SUPPORTED_SIGNING_ALGS.has(alg)) throw new Error('DIRECT_MDL_REQUEST_ALG_UNSUPPORTED');

	const payload = buildDirectMdlRequestObjectPayload(session, options);
	const key = await importDirectMdlSigningKey(config.privateKeyPem, alg);
	const now = Math.floor((options.now ?? Date.now()) / 1000);
	const expiresAt = Math.min(
		Math.floor(session.expiresAt / 1000),
		now + DIRECT_MDL_SESSION_TTL_SECONDS
	);
	const protectedHeader: CompactJWSHeaderParameters = {
		alg,
		typ: DIRECT_MDL_REQUEST_OBJECT_TYP,
		x5c: config.x5c
	};
	if (config.kid) protectedHeader.kid = config.kid;

	const jwtPayload = {
		iss: session.clientId,
		aud: config.audience ?? DEFAULT_REQUEST_OBJECT_AUDIENCE,
		...payload,
		iat: now,
		exp: expiresAt
	};
	const payloadBytes = new Uint8Array(new TextEncoder().encode(JSON.stringify(jwtPayload)));

	return new CompactSign(payloadBytes).setProtectedHeader(protectedHeader).sign(key);
}

export function assertDirectMdlRequestSession(
	session: DirectMdlSession,
	options: DirectMdlRequestObjectOptions = {}
): void {
	if (session.transport !== DIRECT_MDL_TRANSPORT) {
		throw new Error('DIRECT_MDL_TRANSPORT_MISMATCH');
	}
	if (session.expiresAt <= (options.now ?? Date.now())) {
		throw new Error('DIRECT_MDL_SESSION_NOT_FOUND_OR_EXPIRED');
	}

	const clientId = normalizeOpenId4VpClientId(session.clientId, {
		allowLocalhostHttp: options.allowLocalhostHttp
	});
	const responseUri = normalizeOpenId4VpResponseUri(session.responseUri, {
		allowLocalhostHttp: options.allowLocalhostHttp
	});
	const requestUri = normalizeDirectMdlRequestUri(session.requestUri, {
		allowLocalhostHttp: options.allowLocalhostHttp
	});

	if (
		clientId !== session.clientId ||
		responseUri !== session.responseUri ||
		requestUri !== session.requestUri
	) {
		throw new Error('DIRECT_MDL_REQUEST_VALUE_NORMALIZED');
	}
	assertSignedRequestClientId(clientId, responseUri);
	if (options.expectedRequestUri && requestUri !== options.expectedRequestUri) {
		throw new Error('DIRECT_MDL_REQUEST_URI_MISMATCH');
	}
	if (options.expectedResponseUri && responseUri !== options.expectedResponseUri) {
		throw new Error('DIRECT_MDL_RESPONSE_URI_MISMATCH');
	}
}

function assertSignedRequestClientId(clientId: string, responseUri: string): void {
	assertSignedRequestClientIdPrefix(clientId);

	if (clientId.startsWith(X509_SAN_DNS_CLIENT_ID_PREFIX)) {
		const dnsName = clientId.slice(X509_SAN_DNS_CLIENT_ID_PREFIX.length).toLowerCase();
		const responseHost = new URL(responseUri).hostname.toLowerCase();
		if (responseHost !== dnsName) {
			throw new Error('DIRECT_MDL_RESPONSE_URI_HOST_MISMATCH');
		}
	}
}

function assertSignedRequestClientIdPrefix(clientId: string): void {
	if (clientId.startsWith('redirect_uri:')) {
		throw new Error('DIRECT_MDL_SIGNED_CLIENT_ID_UNSUPPORTED');
	}
	if (clientId.startsWith(X509_SAN_DNS_CLIENT_ID_PREFIX)) {
		const dnsName = clientId.slice(X509_SAN_DNS_CLIENT_ID_PREFIX.length);
		if (!isDnsName(dnsName)) throw new Error('DIRECT_MDL_CLIENT_ID_INVALID_X509_SAN_DNS');
		return;
	}
	throw new Error('DIRECT_MDL_CLIENT_ID_PREFIX_UNSUPPORTED');
}

function normalizeDirectMdlRequestUri(
	requestUri: string,
	options: RequestUriValidationOptions = {}
): string {
	if (typeof requestUri !== 'string' || requestUri.length === 0) {
		throw new Error('DIRECT_MDL_REQUEST_URI_REQUIRED');
	}
	if (requestUri.trim() !== requestUri) {
		throw new Error('DIRECT_MDL_REQUEST_URI_WHITESPACE');
	}

	let parsed: URL;
	try {
		parsed = new URL(requestUri);
	} catch {
		throw new Error('DIRECT_MDL_REQUEST_URI_INVALID');
	}

	if (parsed.username || parsed.password || parsed.hash || parsed.search) {
		throw new Error('DIRECT_MDL_REQUEST_URI_FORBIDDEN_PARTS');
	}
	if (parsed.protocol !== 'https:' && !(options.allowLocalhostHttp && isLocalHttpUrl(parsed))) {
		throw new Error('DIRECT_MDL_REQUEST_URI_MUST_USE_HTTPS');
	}

	return requestUri;
}

function parseX5c(raw: string | undefined): string[] {
	if (!raw) return [];
	const trimmed = raw.trim();
	if (!trimmed) return [];

	let values: string[];
	if (trimmed.startsWith('[')) {
		const parsed = JSON.parse(trimmed) as unknown;
		if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
			throw new Error('DIRECT_MDL_REQUEST_X5C_INVALID');
		}
		values = parsed;
	} else {
		values = trimmed.split(/[\n,]+/);
	}

	const normalized = values.map(normalizeX5cEntry).filter((value) => value.length > 0);
	if (normalized.some((value) => !/^[A-Za-z0-9+/=]+$/.test(value))) {
		throw new Error('DIRECT_MDL_REQUEST_X5C_INVALID');
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
	const normalized = value.replace(/\s+/g, '');
	const binary = atob(normalized);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function importDirectMdlSigningKey(privateKeyPem: string, alg: string): Promise<CryptoKey> {
	const cacheKey = `${alg}:${privateKeyPem}`;
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
	if (curve !== 'P-256') throw new Error('DIRECT_MDL_REQUEST_X5C_CURVE_UNSUPPORTED');

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
	const privateKey = await importDirectMdlSigningKey(privateKeyPem, 'ES256');
	const challenge = new TextEncoder().encode('commons-direct-mdl-request-object-signer-check');
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
	if (!verified) throw new Error('DIRECT_MDL_REQUEST_X5C_KEY_MISMATCH');
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function certificateHasDnsSan(certificateDer: Uint8Array, expectedDnsName: string): boolean {
	const expected = expectedDnsName.toLowerCase();
	let searchOffset = 0;
	while (searchOffset < certificateDer.length) {
		const oidOffset = findLocalBytes(certificateDer, SUBJECT_ALT_NAME_OID, searchOffset);
		if (oidOffset === -1) return false;
		searchOffset = oidOffset + 1;

		let pos = oidOffset + SUBJECT_ALT_NAME_OID.length;
		if (certificateDer[pos] === 0x01) {
			const criticalLength = parseLocalDerLength(certificateDer, pos + 1);
			if (!criticalLength) continue;
			pos = criticalLength.offset + criticalLength.length;
		}
		if (certificateDer[pos] !== 0x04) continue;
		const extensionValue = parseLocalDerLength(certificateDer, pos + 1);
		if (!extensionValue) continue;
		const extensionEnd = extensionValue.offset + extensionValue.length;
		if (extensionEnd > certificateDer.length) continue;
		if (
			subjectAltNameExtensionHasDnsName(
				certificateDer.slice(extensionValue.offset, extensionEnd),
				expected
			)
		) {
			return true;
		}
	}
	return false;
}

function subjectAltNameExtensionHasDnsName(
	extensionDer: Uint8Array,
	expectedDnsName: string
): boolean {
	if (extensionDer[0] !== 0x30) return false;
	const sequence = parseLocalDerLength(extensionDer, 1);
	if (!sequence) return false;
	let pos = sequence.offset;
	const end = sequence.offset + sequence.length;
	if (end > extensionDer.length) return false;
	while (pos < end) {
		const tag = extensionDer[pos];
		const length = parseLocalDerLength(extensionDer, pos + 1);
		if (!length) return false;
		const valueEnd = length.offset + length.length;
		if (valueEnd > end) return false;
		if (tag === 0x82) {
			const value = new TextDecoder().decode(extensionDer.slice(length.offset, valueEnd));
			if (/^[A-Za-z0-9.-]+$/.test(value) && value.toLowerCase() === expectedDnsName) {
				return true;
			}
		}
		pos = valueEnd;
	}
	return false;
}

function parseLocalDerLength(
	data: Uint8Array,
	offset: number
): { length: number; offset: number } | null {
	if (offset >= data.length) return null;
	const first = data[offset];
	if (first < 0x80) return { length: first, offset: offset + 1 };
	const lengthBytes = first & 0x7f;
	if (lengthBytes === 0 || lengthBytes > 4 || offset + lengthBytes >= data.length) return null;
	let length = 0;
	for (let i = 1; i <= lengthBytes; i++) {
		length = (length << 8) | data[offset + i];
	}
	return { length, offset: offset + 1 + lengthBytes };
}

function findLocalBytes(haystack: Uint8Array, needle: Uint8Array, start = 0): number {
	outer: for (let i = start; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) continue outer;
		}
		return i;
	}
	return -1;
}

function isLocalHttpUrl(url: URL): boolean {
	return (
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
	);
}

function isDnsName(value: string): boolean {
	if (value.length < 1 || value.length > 253) return false;
	if (value.endsWith('.')) return false;
	const labels = value.split('.');
	if (labels.length < 2) return false;
	return labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}
