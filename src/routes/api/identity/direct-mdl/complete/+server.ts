import { dev } from '$app/environment';
import { error, isHttpError, json } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import type { RequestHandler } from './$types';
import { internal } from '$lib/convex';
import { OPENID4VP_DC_API_PROTOCOL, requireMdlDirectQrEnabled } from '$lib/config/features';
import { processCredentialResponse } from '$lib/core/identity/mdl-verification';
import {
	DIRECT_MDL_TRANSPORT,
	completeDirectMdlSession,
	failDirectMdlSession,
	getDirectMdlSessionByState
} from '$lib/server/direct-mdl-session';

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const MAX_DIRECT_POST_BODY_BYTES = 80 * 1024;
const MAX_VP_TOKEN_BYTES = 64 * 1024;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,512}$/;

type DirectPostForm = {
	state: string;
	vpToken?: unknown;
	walletError?: string;
};

let placeholderPrivateKeyPromise: Promise<CryptoKey> | null = null;

export const POST: RequestHandler = async ({ request, platform }) => {
	try {
		requireMdlDirectQrEnabled();
	} catch {
		throw error(404, 'Not found');
	}

	const form = await parseDirectPostForm(request);
	const session = await getDirectMdlSessionByState(form.state, platform);
	if (!session) throw error(410, 'Direct mDL session expired or not found');
	if (session.state !== form.state) throw error(403, 'Direct mDL state mismatch');
	if (session.status === 'completed' || session.status === 'failed') {
		throw error(409, `Direct mDL session is ${session.status}`);
	}
	if (session.status !== 'request_fetched') {
		throw error(409, 'Direct mDL request object was not fetched');
	}
	if (form.walletError) {
		await failDirectMdlSession(
			session.id,
			'Wallet did not complete the presentation',
			platform,
			DIRECT_MDL_TRANSPORT
		);
		return json(
			{
				error: 'wallet_error',
				message: 'Wallet did not complete the presentation'
			},
			{ status: 400 }
		);
	}
	if (form.vpToken === undefined) {
		throw error(400, 'vp_token parameter is required exactly once');
	}

	const placeholderPrivateKey = await getPlaceholderPrivateKey();
	const result = await processCredentialResponse(
		{ vp_token: form.vpToken },
		OPENID4VP_DC_API_PROTOCOL,
		placeholderPrivateKey,
		session.nonce,
		{
			vicalKv: platform?.env?.VICAL_KV,
			directPost: {
				clientId: session.clientId,
				responseUri: session.responseUri,
				allowLocalhostHttp: dev
			}
		}
	);

	if (!result.success) {
		await failDirectMdlSession(session.id, result.message ?? 'Verification failed', platform);
		return json({ error: result.error, message: result.message }, { status: 422 });
	}
	if (!result.identityCommitment) {
		await failDirectMdlSession(session.id, 'Identity fields not disclosed by wallet', platform);
		return json(
			{
				error: 'missing_identity_fields',
				message: 'Wallet must disclose birth date and document number'
			},
			{ status: 422 }
		);
	}

	let bindingResult;
	try {
		bindingResult = await serverMutation(internal.users.finalizeMdlVerification, {
			userId: session.desktopUserId as any,
			identityCommitment: result.identityCommitment,
			credentialHash: result.credentialHash,
			nonce: session.nonce,
			protocol: OPENID4VP_DC_API_PROTOCOL,
			sessionChannel: 'direct',
			verifiedAt: Date.now(),
			addressVerificationMethod: 'mdl',
			documentType: 'mdl'
		});
	} catch (err) {
		if (isMdlCredentialReuseError(err)) {
			await failDirectMdlSession(
				session.id,
				'This wallet presentation was already used. Start a new verification session.',
				platform
			);
			return json(
				{
					error: 'credential_reuse_detected',
					message: 'This wallet presentation was already used. Start a new verification session.'
				},
				{ status: 409 }
			);
		}
		await failDirectMdlSession(session.id, 'Verification could not be finalized', platform);
		throw err;
	}

	await completeDirectMdlSession(
		session.id,
		{
			transport: DIRECT_MDL_TRANSPORT,
			state: session.state,
			result: {
				district: result.district,
				state: result.state,
				credentialHash: result.credentialHash,
				cellId: result.cellId ?? undefined,
				identityCommitmentBound: true,
				requireReauth: bindingResult.requireReauth ?? false
			}
		},
		platform
	);

	return json({
		success: true,
		district: result.district,
		state: result.state,
		requireReauth: bindingResult.requireReauth ?? false
	});
};

async function parseDirectPostForm(request: Request): Promise<DirectPostForm> {
	const contentType = request.headers.get('content-type') ?? '';
	if (!hasMediaType(contentType, FORM_CONTENT_TYPE)) {
		throw error(415, 'Direct mDL completion requires form-urlencoded body');
	}

	const contentLength = request.headers.get('content-length');
	if (contentLength) {
		const parsedContentLength = Number(contentLength);
		if (!Number.isFinite(parsedContentLength) || parsedContentLength < 0) {
			throw error(400, 'Content-Length is invalid');
		}
		if (parsedContentLength > MAX_DIRECT_POST_BODY_BYTES) {
			throw error(413, 'Direct mDL completion form is too large');
		}
	}

	const raw = await readBoundedText(request, MAX_DIRECT_POST_BODY_BYTES);
	const params = new URLSearchParams(raw);

	validateSingleParam(params, 'state');
	const state = params.get('state') ?? '';
	if (!TOKEN_RE.test(state)) throw error(400, 'state is invalid');

	const walletError = getOptionalSingleParam(params, 'error');
	if (walletError !== undefined) {
		if (params.getAll('vp_token').length > 0) {
			throw error(400, 'Direct mDL completion cannot include both error and vp_token');
		}
		if (!/^[A-Za-z0-9_.-]{1,128}$/.test(walletError)) {
			throw error(400, 'error parameter is invalid');
		}
		return { state, walletError };
	}

	validateSingleParam(params, 'vp_token');
	const vpTokenRaw = params.get('vp_token') ?? '';
	if (vpTokenRaw.length === 0 || new TextEncoder().encode(vpTokenRaw).length > MAX_VP_TOKEN_BYTES) {
		throw error(400, 'vp_token is invalid');
	}

	return {
		state,
		vpToken: parseVpToken(vpTokenRaw)
	};
}

function parseVpToken(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed.startsWith('{')) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('vp_token JSON must be an object');
			}
			return parsed;
		} catch {
			throw error(400, 'vp_token JSON is invalid');
		}
	}
	return value;
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
			if (received > maxBytes) throw error(413, 'Direct mDL completion form is too large');
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		return text;
	} catch (err) {
		if (isHttpError(err)) throw err;
		throw error(400, 'Direct mDL completion form must be UTF-8');
	}
}

function validateSingleParam(params: URLSearchParams, name: string): void {
	if (params.getAll(name).length !== 1) {
		throw error(400, `${name} parameter is required exactly once`);
	}
}

function getOptionalSingleParam(params: URLSearchParams, name: string): string | undefined {
	const values = params.getAll(name);
	if (values.length > 1) {
		throw error(400, `Duplicate ${name} parameter`);
	}
	return values[0];
}

function hasMediaType(headerValue: string, mediaType: string): boolean {
	return headerValue
		.split(',')
		.map((part) => part.split(';')[0]?.trim().toLowerCase())
		.includes(mediaType);
}

function isMdlCredentialReuseError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return (
		message.includes('MDL_CREDENTIAL_HASH_REUSED') ||
		message.includes('MDL_SESSION_NONCE_REUSED')
	);
}

async function getPlaceholderPrivateKey(): Promise<CryptoKey> {
	if (!placeholderPrivateKeyPromise) {
		placeholderPrivateKeyPromise = crypto.subtle
			.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
			.then((keyPair) => keyPair.privateKey);
	}
	return placeholderPrivateKeyPromise;
}
