const HANDOVER_IDENTIFIER = 'OpenID4VPHandover' as const;

export type OpenId4VpDirectHandoverInfo = [
	clientId: string,
	nonce: string,
	jwkThumbprint: Uint8Array | null,
	responseUri: string
];
export type OpenId4VpDirectHandover = [typeof HANDOVER_IDENTIFIER, Uint8Array];
export type OpenId4VpDirectSessionTranscript = [null, null, OpenId4VpDirectHandover];

export interface OpenId4VpDirectSessionTranscriptInput {
	clientId: string;
	nonce: string;
	responseUri: string;
	/**
	 * OpenID4VP uses null for direct_post and a SHA-256 JWK thumbprint when
	 * the response is encrypted with direct_post.jwt.
	 */
	jwkThumbprint?: Uint8Array | ArrayBuffer | null;
	allowLocalhostHttp?: boolean;
}

export interface OpenId4VpDirectSessionTranscriptParts {
	handoverInfo: OpenId4VpDirectHandoverInfo;
	handoverInfoBytes: Uint8Array;
	handoverInfoHash: Uint8Array;
	handover: OpenId4VpDirectHandover;
	sessionTranscript: OpenId4VpDirectSessionTranscript;
	sessionTranscriptBytes: Uint8Array;
}

export async function buildOpenId4VpDirectSessionTranscript({
	clientId,
	nonce,
	responseUri,
	jwkThumbprint = null,
	allowLocalhostHttp = false
}: OpenId4VpDirectSessionTranscriptInput): Promise<OpenId4VpDirectSessionTranscriptParts> {
	const normalizedClientId = normalizeOpenId4VpClientId(clientId, { allowLocalhostHttp });
	const normalizedResponseUri = normalizeOpenId4VpResponseUri(responseUri, {
		allowLocalhostHttp
	});
	const handoverInfo: OpenId4VpDirectHandoverInfo = [
		normalizedClientId,
		normalizeOpenId4VpNonce(nonce),
		normalizeJwkThumbprint(jwkThumbprint),
		normalizedResponseUri
	];
	const handoverInfoBytes = encodeOpenId4VpCbor(handoverInfo);
	const handoverInfoHash = new Uint8Array(
		await crypto.subtle.digest('SHA-256', handoverInfoBytes as BufferSource)
	);
	const handover: OpenId4VpDirectHandover = [HANDOVER_IDENTIFIER, handoverInfoHash];
	const sessionTranscript: OpenId4VpDirectSessionTranscript = [null, null, handover];
	const sessionTranscriptBytes = encodeOpenId4VpCbor(sessionTranscript);

	return {
		handoverInfo,
		handoverInfoBytes,
		handoverInfoHash,
		handover,
		sessionTranscript,
		sessionTranscriptBytes
	};
}

export function normalizeOpenId4VpClientId(
	clientId: string,
	options: { allowLocalhostHttp?: boolean } = {}
): string {
	if (typeof clientId !== 'string' || clientId.length === 0) {
		throw new Error('OpenID4VP client_id is required');
	}
	if (clientId.trim() !== clientId) {
		throw new Error('OpenID4VP client_id must not include leading or trailing whitespace');
	}
	if (clientId.startsWith('redirect_uri:')) {
		const redirectUri = clientId.slice('redirect_uri:'.length);
		normalizeOpenId4VpResponseUri(redirectUri, options);
	}
	return clientId;
}

export function normalizeOpenId4VpResponseUri(
	responseUri: string,
	options: { allowLocalhostHttp?: boolean } = {}
): string {
	if (typeof responseUri !== 'string' || responseUri.length === 0) {
		throw new Error('OpenID4VP response_uri is required');
	}
	if (responseUri.trim() !== responseUri) {
		throw new Error('OpenID4VP response_uri must not include leading or trailing whitespace');
	}

	let parsed: URL;
	try {
		parsed = new URL(responseUri);
	} catch {
		throw new Error('OpenID4VP response_uri must be a valid URL');
	}

	if (parsed.username || parsed.password || parsed.hash) {
		throw new Error('OpenID4VP response_uri must not include credentials or fragment');
	}
	if (parsed.protocol !== 'https:' && !(options.allowLocalhostHttp && isLocalHttpUrl(parsed))) {
		throw new Error('OpenID4VP response_uri must use https outside local development');
	}

	return responseUri;
}

function normalizeOpenId4VpNonce(nonce: string): string {
	if (typeof nonce !== 'string' || nonce.length === 0) {
		throw new Error('OpenID4VP nonce is required');
	}
	if (nonce.trim() !== nonce) {
		throw new Error('OpenID4VP nonce must not include leading or trailing whitespace');
	}
	return nonce;
}

function normalizeJwkThumbprint(
	jwkThumbprint: Uint8Array | ArrayBuffer | null | undefined
): Uint8Array | null {
	if (jwkThumbprint == null) return null;

	const bytes = jwkThumbprint instanceof Uint8Array ? jwkThumbprint : new Uint8Array(jwkThumbprint);
	if (bytes.length !== 32) {
		throw new Error('OpenID4VP JWK thumbprint must be a 32-byte SHA-256 digest');
	}
	return new Uint8Array(bytes);
}

function isLocalHttpUrl(url: URL): boolean {
	return (
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
	);
}

type OpenId4VpCborValue = string | Uint8Array | null | readonly OpenId4VpCborValue[];

function encodeOpenId4VpCbor(value: OpenId4VpCborValue): Uint8Array {
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
		return concatBytes([encodeCborHead(4, value.length), ...value.map(encodeOpenId4VpCbor)]);
	}
	throw new Error('Unsupported OpenID4VP CBOR value');
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
