import { dev } from '$app/environment';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireMdlDirectQrEnabled } from '$lib/config/features';
import {
	buildDirectMdlAuthorizationRequestUrl,
	getDirectMdlRequestObjectSignerConfig,
	signDirectMdlRequestObject
} from '$lib/server/direct-mdl-request-object';
import {
	DIRECT_MDL_SESSION_TTL_SECONDS,
	DIRECT_MDL_TRANSPORT,
	createDirectMdlSession,
	type DirectMdlSession
} from '$lib/server/direct-mdl-session';

function sanitizeLabel(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s
		.replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
		.trim();
}

function desktopUserLabelFromSession(user: App.Locals['user']): string {
	if (!user?.email) return 'Signed-in Commons account';
	const label = sanitizeLabel(user.email);
	return label.length > 0 ? label : 'Signed-in Commons account';
}

export const POST: RequestHandler = async ({ locals, platform, url }) => {
	try {
		requireMdlDirectQrEnabled();
	} catch {
		throw error(404, 'Not found');
	}

	const session = locals.session;
	if (!session?.userId || !locals.user || locals.user.id !== session.userId) {
		throw error(401, 'Authentication required');
	}

	const canonicalOrigin = platform?.env?.PUBLIC_APP_URL;
	if (!dev && !canonicalOrigin) {
		console.error('[Direct mDL Start] PUBLIC_APP_URL not configured in production');
		throw error(500, 'Direct mDL verifier misconfigured');
	}

	try {
		const signerConfig = getDirectMdlRequestObjectSignerConfig(platform?.env);

		const origin = canonicalOrigin ?? url.origin;
		const sessionId = crypto.randomUUID();
		const requestUri = new URL(`/api/identity/direct-mdl/request/${sessionId}`, origin).toString();
		const responseUri = new URL('/api/identity/direct-mdl/complete', origin).toString();
		const responseHost = new URL(responseUri).hostname.toLowerCase();
		const clientId = `x509_san_dns:${responseHost}`;
		await signDirectMdlRequestObject(
			{
				id: sessionId,
				desktopUserId: session.userId,
				transport: DIRECT_MDL_TRANSPORT,
				clientId,
				responseUri,
				requestUri,
				nonce: 'direct-signer-preflight-nonce',
				state: 'direct-signer-preflight-state',
				transactionId: 'direct-signer-preflight-transaction',
				status: 'created',
				createdAt: Date.now(),
				expiresAt: Date.now() + DIRECT_MDL_SESSION_TTL_SECONDS * 1000
			} satisfies DirectMdlSession,
			signerConfig,
			{
				allowLocalhostHttp: dev,
				expectedRequestUri: requestUri,
				expectedResponseUri: responseUri
			}
		);

		const directSession = await createDirectMdlSession(
			{
				id: sessionId,
				desktopUserId: session.userId,
				clientId,
				responseUri,
				requestUri
			},
			platform
		);

		const qrUrl = buildDirectMdlAuthorizationRequestUrl({
			clientId: directSession.clientId,
			requestUri: directSession.requestUri,
			allowLocalhostHttp: dev
		});

		return json({
			sessionId: directSession.id,
			transactionId: directSession.transactionId,
			qrUrl,
			accountLabel: desktopUserLabelFromSession(locals.user),
			expiresAt: directSession.expiresAt
		});
	} catch (err) {
		console.error('[Direct mDL Start] Error:', err);
		throw error(500, 'Failed to create direct mDL session');
	}
};
