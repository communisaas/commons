import { dev } from '$app/environment';
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import type { RequestHandler } from './$types';
import { api } from '$lib/convex';

const SESSION_COOKIE = 'auth-session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function envValue(event: RequestEvent, key: string): string | undefined {
	const platformEnv = event.platform?.env as Record<string, unknown> | undefined;
	const value = platformEnv?.[key] ?? process.env[key];
	return typeof value === 'string' ? value : undefined;
}

function isProduction(event: RequestEvent): boolean {
	const environment =
		envValue(event, 'ENVIRONMENT') ?? process.env.NODE_ENV ?? (dev ? 'development' : 'production');
	return !dev && environment === 'production';
}

function isDevLoginEnabled(event: RequestEvent): boolean {
	return (
		envValue(event, 'ENABLE_DEV_LOGIN') === '1' && (envValue(event, 'ENVIRONMENT') ?? '') === 'test'
	);
}

function timingSafeEqual(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	const left = encoder.encode(a);
	const right = encoder.encode(b);
	let diff = left.length ^ right.length;
	const max = Math.max(left.length, right.length);

	for (let i = 0; i < max; i++) {
		diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
	}

	return diff === 0;
}

async function createSessionProof(
	userId: string,
	expiresAt: number,
	secret: string
): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const proofBytes = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, encoder.encode(`${userId}|${expiresAt}`))
	);
	return Array.from(proofBytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

export const POST: RequestHandler = async (event) => {
	if (isProduction(event)) throw error(404, 'Not found');
	if (!isDevLoginEnabled(event)) throw error(404, 'Not found');

	const expectedToken = envValue(event, 'DEV_LOGIN_TOKEN');
	if (!expectedToken) throw error(404, 'Not found');

	const suppliedToken = event.request.headers.get('x-dev-login-token') ?? '';
	if (!timingSafeEqual(suppliedToken, expectedToken)) {
		throw error(401, 'Unauthorized');
	}

	const body = await event.request.json().catch(() => ({}));
	const email =
		typeof body.email === 'string' && body.email.trim()
			? body.email.trim().toLowerCase()
			: 'regrounding-e2e@example.test';
	if (!email.endsWith('@example.test')) {
		throw error(400, 'Dev login only accepts example.test identities');
	}
	const principalName =
		typeof body.principalName === 'string' && body.principalName.trim()
			? body.principalName.trim()
			: 'E2E Test User';

	const sessionSecret = envValue(event, 'SESSION_CREATION_SECRET');
	if (!sessionSecret) {
		throw error(503, 'SESSION_CREATION_SECRET not configured');
	}

	const result = await serverMutation(api.authOps.upsertFromOAuth, {
		provider: 'dev-login',
		providerAccountId: email,
		scope: 'dev-login',
		email,
		name: principalName,
		emailVerified: true
	});

	const userId = result.userId as string;
	const expiresAt = Date.now() + SESSION_DURATION_MS;
	const proof = await createSessionProof(userId, expiresAt, sessionSecret);
	const session = await serverMutation(api.authOps.createSession, {
		userId,
		expiresAt,
		proof
	});

	event.cookies.set(SESSION_COOKIE, session.sessionId, {
		path: '/',
		secure: !dev,
		httpOnly: true,
		maxAge: SESSION_DURATION_MS / 1000,
		sameSite: 'lax'
	});

	return json({ ok: true, userId });
};
