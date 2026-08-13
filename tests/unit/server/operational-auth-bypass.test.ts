import { afterAll, describe, expect, it, vi } from 'vitest';

const convex = vi.hoisted(() => ({
	serverQuery: vi.fn(async () => ({ status: 'invalid' as const })),
	serverMutation: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/convex-work-budget', () => ({
	initConvex: vi.fn(),
	serverAction: vi.fn(),
	serverMutation: convex.serverMutation,
	serverQuery: convex.serverQuery
}));

vi.mock('$lib/server/convex-jwt', () => ({
	mintConvexToken: vi.fn(async () => null)
}));

vi.mock('@sentry/sveltekit', () => ({
	handleErrorWithSentry: vi.fn((handler: unknown) => handler),
	initCloudflareSentryHandle: vi.fn(
		() =>
		async ({ event, resolve }: { event: unknown; resolve: (event: unknown) => Promise<Response> }) =>
			resolve(event)
	),
	lastEventId: vi.fn(() => undefined),
	sentryHandle: vi.fn(
		() =>
		async ({ event, resolve }: { event: unknown; resolve: (event: unknown) => Promise<Response> }) =>
			resolve(event)
	)
}));

import { bypassSessionAuthorityForOperationalPath, handleAuth } from '../../../src/hooks.server';
import {
	sealSessionCookie,
	verifySessionCookie
} from '../../../src/lib/server/auth/session-cookie';

const NOW = Date.UTC(2026, 6, 21, 0, 0, 0);
const EXPIRES_AT = NOW + 60 * 60 * 1000;
const COOKIE_SECRET = 'operational-cookie-secret-'.padEnd(64, 'c');
const CREATION_SECRET = 'operational-creation-secret-'.padEnd(64, 's');
const ORIGINAL_ENV = {
	internalSecret: process.env.INTERNAL_API_SECRET,
	sessionCookieSigningSecret: process.env.SESSION_COOKIE_SIGNING_SECRET,
	sessionCreationSecret: process.env.SESSION_CREATION_SECRET
};

function restoreEnv(name: string, value: string | undefined) {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

afterAll(() => {
	restoreEnv('INTERNAL_API_SECRET', ORIGINAL_ENV.internalSecret);
	restoreEnv('SESSION_COOKIE_SIGNING_SECRET', ORIGINAL_ENV.sessionCookieSigningSecret);
	restoreEnv('SESSION_CREATION_SECRET', ORIGINAL_ENV.sessionCreationSecret);
});

async function hookInput(pathname: string) {
	vi.spyOn(Date, 'now').mockReturnValue(NOW);
	process.env.SESSION_COOKIE_SIGNING_SECRET = COOKIE_SECRET;
	process.env.SESSION_CREATION_SECRET = CREATION_SECRET;
	process.env.INTERNAL_API_SECRET = 'operational-internal-secret-'.padEnd(64, 'i');
	const cookie = await sealSessionCookie('session_operational_probe', EXPIRES_AT, COOKIE_SECRET);
	await expect(
		verifySessionCookie(cookie, {
			activeSecret: COOKIE_SECRET,
			now: NOW
		})
	).resolves.toMatchObject({ valid: true, sessionId: 'session_operational_probe' });

	const get = vi.fn(() => cookie);
	const deleteCookie = vi.fn();
	const request = new Request(`https://commons.email${pathname}`);
	const event = {
		cookies: { delete: deleteCookie, get, set: vi.fn() },
		locals: {
			convexToken: 'must-be-cleared',
			session: { userId: 'must-be-cleared' },
			user: { id: 'must-be-cleared' }
		},
		platform: { env: {} },
		request,
		url: new URL(request.url)
	};
	const resolve = vi.fn(async () => {
		expect(convex.serverQuery).not.toHaveBeenCalled();
		return new Response(null, { status: 204 });
	});
	return { deleteCookie, event, get, resolve };
}

describe('operational session-authority bypass', () => {
	it.each(['/api/live', '/api/health', '/api/containment-readiness'])(
		'keeps a valid signed cookie away from authority before %s resolves',
		async (pathname) => {
			const route = await hookInput(pathname);

			const response = await handleAuth({
				event: route.event as never,
				resolve: route.resolve as never
			});

			expect(response.status).toBe(204);
			expect(route.resolve).toHaveBeenCalledOnce();
			expect(route.get).not.toHaveBeenCalled();
			expect(route.deleteCookie).not.toHaveBeenCalled();
			expect(convex.serverQuery).not.toHaveBeenCalled();
			expect(route.event.locals).toMatchObject({ user: null, session: null });
			expect(route.event.locals.convexToken).toBeUndefined();
		}
	);

	it('matches only the exact operational paths', () => {
		for (const pathname of [
			'/api/live/',
			'/api/health/',
			'/api/containment-readiness/',
			'/api/liveness',
			'/api/healthcheck'
		]) {
			expect(bypassSessionAuthorityForOperationalPath(pathname), pathname).toBe(false);
		}
	});
});
