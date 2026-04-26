const HANDOVER_IDENTIFIER = 'OpenID4VPDCAPIHandover' as const;

export type OpenId4VpDcApiHandoverInfo = [origin: string, nonce: string, jwkThumbprint: Uint8Array | null];
export type OpenId4VpDcApiHandover = [typeof HANDOVER_IDENTIFIER, Uint8Array];
export type OpenId4VpDcApiSessionTranscript = [null, null, OpenId4VpDcApiHandover];

export interface OpenId4VpDcApiSessionTranscriptInput {
	origin: string;
	nonce: string;
	/**
	 * OpenID4VP uses null for response_mode=dc_api and a SHA-256 JWK thumbprint
	 * when the response is encrypted.
	 */
	jwkThumbprint?: Uint8Array | ArrayBuffer | null;
}

export interface OpenId4VpDcApiSessionTranscriptParts {
	handoverInfo: OpenId4VpDcApiHandoverInfo;
	handoverInfoBytes: Uint8Array;
	handoverInfoHash: Uint8Array;
	handover: OpenId4VpDcApiHandover;
	sessionTranscript: OpenId4VpDcApiSessionTranscript;
	sessionTranscriptBytes: Uint8Array;
}

export async function buildOpenId4VpDcApiSessionTranscript({
	origin,
	nonce,
	jwkThumbprint = null
}: OpenId4VpDcApiSessionTranscriptInput): Promise<OpenId4VpDcApiSessionTranscriptParts> {
	const handoverInfo: OpenId4VpDcApiHandoverInfo = [
		normalizeDcApiOrigin(origin),
		normalizeDcApiNonce(nonce),
		normalizeJwkThumbprint(jwkThumbprint)
	];
	const handoverInfoBytes = encodeDcApiCbor(handoverInfo);
	const handoverInfoHash = new Uint8Array(
		await crypto.subtle.digest('SHA-256', handoverInfoBytes as BufferSource)
	);
	const handover: OpenId4VpDcApiHandover = [HANDOVER_IDENTIFIER, handoverInfoHash];
	const sessionTranscript: OpenId4VpDcApiSessionTranscript = [null, null, handover];
	const sessionTranscriptBytes = encodeDcApiCbor(sessionTranscript);

	return {
		handoverInfo,
		handoverInfoBytes,
		handoverInfoHash,
		handover,
		sessionTranscript,
		sessionTranscriptBytes
	};
}

export function normalizeDcApiOrigin(origin: string): string {
	if (typeof origin !== 'string' || origin.length === 0) {
		throw new Error('DC API origin is required');
	}
	if (origin.trim() !== origin) {
		throw new Error('DC API origin must not include leading or trailing whitespace');
	}
	if (origin.startsWith('origin:')) {
		throw new Error('DC API origin must not include the origin: verifier-audience prefix');
	}
	if (origin.startsWith('android:apk-key-hash:')) {
		const hash = origin.slice('android:apk-key-hash:'.length);
		if (!hash || /\s/.test(hash)) {
			throw new Error('DC API Android origin must include a non-empty APK key hash');
		}
		return origin;
	}

	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		throw new Error('DC API origin must be a valid web origin');
	}

	if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
		throw new Error('DC API origin must not include credentials, path, query, or fragment');
	}
	if (parsed.protocol !== 'https:' && !isLocalHttpOrigin(parsed)) {
		throw new Error('DC API web origin must use https except for localhost development');
	}

	return parsed.origin;
}

export function normalizeDcApiWebOrigin(
	origin: string,
	options: { allowLocalhostHttp?: boolean } = {}
): string {
	const normalized = normalizeDcApiOrigin(origin);
	if (normalized.startsWith('android:apk-key-hash:')) {
		throw new Error('DC API web origin must be a URL origin');
	}
	if (!options.allowLocalhostHttp && normalized.startsWith('http:')) {
		throw new Error('DC API web origin must use https outside local development');
	}
	return normalized;
}

function normalizeDcApiNonce(nonce: string): string {
	if (typeof nonce !== 'string' || nonce.length === 0) {
		throw new Error('DC API nonce is required');
	}
	if (nonce.trim() !== nonce) {
		throw new Error('DC API nonce must not include leading or trailing whitespace');
	}
	return nonce;
}

function normalizeJwkThumbprint(
	jwkThumbprint: Uint8Array | ArrayBuffer | null | undefined
): Uint8Array | null {
	if (jwkThumbprint == null) return null;

	const bytes =
		jwkThumbprint instanceof Uint8Array
			? jwkThumbprint
			: new Uint8Array(jwkThumbprint);
	if (bytes.length !== 32) {
		throw new Error('DC API JWK thumbprint must be a 32-byte SHA-256 digest');
	}
	return new Uint8Array(bytes);
}

function isLocalHttpOrigin(url: URL): boolean {
	return (
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
	);
}

type DcApiCborValue = string | Uint8Array | null | readonly DcApiCborValue[];

function encodeDcApiCbor(value: DcApiCborValue): Uint8Array {
	if (typeof value === 'string') {
		return encodeCborBytes(3, new TextEncoder().encode(value));
	}
	if (value instanceof Uint8Array) {
		return encodeCborBytes(2, value);
	}
	if (value === null) {
		return new Uint8Array([0xf6]);
	}
	if (Array.isArray(value)) {
		return concatBytes([encodeCborHead(4, value.length), ...value.map(encodeDcApiCbor)]);
	}
	throw new Error('Unsupported DC API CBOR value');
}

function encodeCborBytes(majorType: number, bytes: Uint8Array): Uint8Array {
	return concatBytes([encodeCborHead(majorType, bytes.length), bytes]);
}

function encodeCborHead(majorType: number, length: number): Uint8Array {
	if (majorType < 0 || majorType > 7) throw new Error('Invalid CBOR major type');
	if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid CBOR length');

	const prefix = majorType << 5;
	if (length < 24) return new Uint8Array([prefix | length]);
	if (length <= 0xff) return new Uint8Array([prefix | 24, length]);
	if (length <= 0xffff) return new Uint8Array([prefix | 25, length >> 8, length & 0xff]);
	if (length <= 0xffffffff) {
		return new Uint8Array([
			prefix | 26,
			(length >>> 24) & 0xff,
			(length >>> 16) & 0xff,
			(length >>> 8) & 0xff,
			length & 0xff
		]);
	}
	throw new Error('CBOR length too large');
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}
