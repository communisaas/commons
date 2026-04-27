import { dev } from '$app/environment';
import { error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireMdlDirectQrEnabled } from '$lib/config/features';
import {
	DIRECT_MDL_REQUEST_OBJECT_CONTENT_TYPE,
	assertDirectMdlRequestSession,
	getDirectMdlRequestObjectSignerConfig,
	signDirectMdlRequestObject
} from '$lib/server/direct-mdl-request-object';
import {
	DIRECT_MDL_TRANSPORT,
	getDirectMdlSession,
	markDirectMdlRequestFetched
} from '$lib/server/direct-mdl-session';

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const MAX_FORM_BODY_BYTES = 16 * 1024;
const MAX_WALLET_METADATA_BYTES = 12 * 1024;
const MAX_WALLET_NONCE_BYTES = 512;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RequestUriForm = {
	walletNonce?: string;
};

export const POST: RequestHandler = async ({ request, params, platform, url }) => {
	try {
		requireMdlDirectQrEnabled(platform?.env?.PUBLIC_APP_URL, url.origin);
	} catch {
		throw error(404, 'Not found');
	}

	const sessionId = params.sessionId;
	if (!SESSION_ID_RE.test(sessionId)) {
		throw error(404, 'Not found');
	}

	const canonicalOrigin = platform?.env?.PUBLIC_APP_URL;
	if (!dev && !canonicalOrigin) {
		console.error('[Direct mDL Request] PUBLIC_APP_URL not configured in production');
		throw error(500, 'Direct mDL verifier misconfigured');
	}

	const form = await parseRequestUriForm(request);
	const expectedRequestUri = currentRequestUri(url, canonicalOrigin);
	const expectedResponseUri = currentRequestUri(
		new URL('/api/identity/direct-mdl/complete', canonicalOrigin ?? url.origin)
	);
	const allowLocalhostHttp = dev;

	try {
		const signerConfig = getDirectMdlRequestObjectSignerConfig(platform?.env);
		const session = await getDirectMdlSession(sessionId, platform);
		if (!session) throw new Error('DIRECT_MDL_SESSION_NOT_FOUND_OR_EXPIRED');

		assertDirectMdlRequestSession(session, {
			walletNonce: form.walletNonce,
			allowLocalhostHttp,
			expectedRequestUri,
			expectedResponseUri
		});

		if (session.status === 'request_fetched' && session.requestObjectJwt) {
			const fetched = await markDirectMdlRequestFetched(
				sessionId,
				{ transport: DIRECT_MDL_TRANSPORT, walletNonce: form.walletNonce },
				platform
			);
			return requestObjectResponse(fetched.requestObjectJwt ?? session.requestObjectJwt);
		}

		const requestObjectJwt = await signDirectMdlRequestObject(session, signerConfig, {
			walletNonce: form.walletNonce,
			allowLocalhostHttp,
			expectedRequestUri,
			expectedResponseUri
		});
		const fetched = await markDirectMdlRequestFetched(
			sessionId,
			{
				transport: DIRECT_MDL_TRANSPORT,
				walletNonce: form.walletNonce,
				requestObjectJwt
			},
			platform
		);
		return requestObjectResponse(fetched.requestObjectJwt ?? requestObjectJwt);
	} catch (err) {
		if (isHttpError(err)) throw err;
		throw mapDirectMdlRequestError(err);
	}
};

async function parseRequestUriForm(request: Request): Promise<RequestUriForm> {
	const contentType = request.headers.get('content-type') ?? '';
	if (!hasMediaType(contentType, FORM_CONTENT_TYPE)) {
		throw error(415, 'Request URI endpoint requires form-urlencoded body');
	}

	const accept = request.headers.get('accept') ?? '';
	if (!acceptsRequiredRequestObject(accept)) {
		throw error(406, 'Request object response type is not acceptable');
	}

	const contentLength = request.headers.get('content-length');
	if (contentLength) {
		const parsedContentLength = Number(contentLength);
		if (!Number.isFinite(parsedContentLength) || parsedContentLength < 0) {
			throw error(400, 'Content-Length is invalid');
		}
		if (parsedContentLength > MAX_FORM_BODY_BYTES) {
			throw error(413, 'Request URI form is too large');
		}
	}

	const raw = await readBoundedText(request, MAX_FORM_BODY_BYTES);

	const params = new URLSearchParams(raw);
	const keys = [...new Set([...params.keys()])];
	const unknown = keys.filter((key) => key !== 'wallet_metadata' && key !== 'wallet_nonce');
	if (unknown.length > 0) {
		throw error(400, 'Unsupported request URI form parameter');
	}

	validateSingleParam(params, 'wallet_metadata');
	validateSingleParam(params, 'wallet_nonce');
	const walletMetadata = params.get('wallet_metadata') ?? undefined;
	if (walletMetadata !== undefined) validateWalletMetadata(walletMetadata);

	const walletNonce = params.get('wallet_nonce') ?? undefined;
	if (walletNonce === undefined) throw error(400, 'wallet_nonce is required');
	validateWalletNonce(walletNonce);

	return { walletNonce };
}

async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
	if (!request.body) return '';
	const reader = request.body.getReader();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let received = 0;
	let text = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > maxBytes) throw error(413, 'Request URI form is too large');
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		return text;
	} catch (err) {
		if (isHttpError(err)) throw err;
		throw error(400, 'Request URI form must be UTF-8');
	}
}

function validateSingleParam(params: URLSearchParams, name: string): void {
	if (params.getAll(name).length > 1) {
		throw error(400, `Duplicate ${name} parameter`);
	}
}

function validateWalletMetadata(value: string): void {
	if (new TextEncoder().encode(value).length > MAX_WALLET_METADATA_BYTES) {
		throw error(413, 'wallet_metadata is too large');
	}
	if (hasControlCharacters(value)) {
		throw error(400, 'wallet_metadata contains control characters');
	}
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('metadata must be an object');
		}
	} catch {
		throw error(400, 'wallet_metadata must be a JSON object');
	}
}

function validateWalletNonce(value: string): void {
	if (value.length === 0 || new TextEncoder().encode(value).length > MAX_WALLET_NONCE_BYTES) {
		throw error(400, 'wallet_nonce is invalid');
	}
	if (hasControlCharacters(value) || /\s/.test(value)) {
		throw error(400, 'wallet_nonce is invalid');
	}
	if (!/^[A-Za-z0-9_-]{16,512}$/.test(value)) {
		throw error(400, 'wallet_nonce is invalid');
	}
}

function currentRequestUri(url: URL, canonicalOrigin?: string): string {
	if (url.search || url.hash) throw error(400, 'request_uri must not include query or fragment');
	const origin = canonicalOrigin ?? url.origin;
	return new URL(url.pathname, origin).toString();
}

function requestObjectResponse(jwt: string): Response {
	return new Response(jwt, {
		status: 200,
		headers: {
			'content-type': DIRECT_MDL_REQUEST_OBJECT_CONTENT_TYPE,
			'cache-control': 'no-store'
		}
	});
}

function mapDirectMdlRequestError(err: unknown): never {
	const message = err instanceof Error ? err.message : 'DIRECT_MDL_REQUEST_FAILED';
	if (message === 'DIRECT_MDL_SESSION_NOT_FOUND_OR_EXPIRED') {
		throw error(404, 'Request expired');
	}
	if (message === 'DIRECT_MDL_SESSION_TERMINAL' || message === 'DIRECT_MDL_WALLET_NONCE_MISMATCH') {
		throw error(409, 'Request object already fetched');
	}
	if (message === 'DIRECT_MDL_REQUEST_URI_MISMATCH') {
		throw error(404, 'Not found');
	}
	if (
		message === 'DIRECT_MDL_REQUEST_PRIVATE_KEY_MISSING' ||
		message === 'DIRECT_MDL_REQUEST_X5C_MISSING' ||
		message === 'DIRECT_MDL_REQUEST_ALG_UNSUPPORTED' ||
		message === 'DIRECT_MDL_REQUEST_AUD_MISSING'
	) {
		console.error('[Direct mDL Request] signer misconfigured:', message);
		throw error(500, 'Direct mDL verifier misconfigured');
	}
	if (
		message === 'DIRECT_MDL_RESPONSE_URI_MISMATCH' ||
		message === 'DIRECT_MDL_RESPONSE_URI_HOST_MISMATCH' ||
		message === 'DIRECT_MDL_SIGNED_CLIENT_ID_UNSUPPORTED' ||
		message === 'DIRECT_MDL_CLIENT_ID_PREFIX_UNSUPPORTED' ||
		message === 'DIRECT_MDL_CLIENT_ID_INVALID_X509_SAN_DNS'
	) {
		console.error('[Direct mDL Request] session misconfigured:', message);
		throw error(500, 'Direct mDL verifier misconfigured');
	}

	console.error('[Direct mDL Request] failed:', err);
	throw error(500, 'Failed to build direct mDL request object');
}

function hasMediaType(headerValue: string, mediaType: string): boolean {
	return headerValue
		.split(',')
		.map((part) => part.split(';')[0]?.trim().toLowerCase())
		.includes(mediaType);
}

function accepts(headerValue: string, mediaType: string): boolean {
	const expected = mediaType.toLowerCase();
	return headerValue.split(',').some((part) => {
		const [rawMediaType, ...params] = part.split(';');
		if (rawMediaType?.trim().toLowerCase() !== expected) return false;
		const qParam = params.find((param) => param.trim().toLowerCase().startsWith('q='));
		if (!qParam) return true;
		const q = Number(qParam.split('=')[1]?.trim());
		return Number.isFinite(q) && q > 0;
	});
}

function acceptsRequiredRequestObject(headerValue: string): boolean {
	return accepts(headerValue, DIRECT_MDL_REQUEST_OBJECT_CONTENT_TYPE);
}

function hasControlCharacters(value: string): boolean {
	// eslint-disable-next-line no-control-regex
	return /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(value);
}
