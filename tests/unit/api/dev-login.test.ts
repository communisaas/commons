import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServerMutation } = vi.hoisted(() => ({
	mockServerMutation: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({
	serverMutation: (...args: unknown[]) => mockServerMutation(...args)
}));

vi.mock('$lib/convex', () => ({
	api: {
		authOps: {
			upsertFromOAuth: 'authOps.upsertFromOAuth',
			createSession: 'authOps.createSession'
		}
	}
}));

import { POST } from '../../../src/routes/api/internal/dev-login/+server';

function makeEvent({
	body = {
		email: 'regrounding-e2e@example.test',
		principalName: 'E2E Test User'
	},
	env = {
		ENABLE_DEV_LOGIN: '1',
		ENVIRONMENT: 'test',
		DEV_LOGIN_TOKEN: 'dev-token',
		SESSION_CREATION_SECRET: 'session-secret'
	},
	token = 'dev-token'
}: {
	body?: unknown;
	env?: Record<string, string | undefined>;
	token?: string | null;
} = {}): Parameters<typeof POST>[0] & { cookies: { set: ReturnType<typeof vi.fn> } } {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (token !== null) headers['X-Dev-Login-Token'] = token;

	return {
		request: new Request('https://example.test/api/internal/dev-login', {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
		}),
		platform: { env },
		cookies: { set: vi.fn() }
	} as unknown as Parameters<typeof POST>[0] & { cookies: { set: ReturnType<typeof vi.fn> } };
}

beforeEach(() => {
	vi.clearAllMocks();
	mockServerMutation
		.mockResolvedValueOnce({ userId: 'user_dev_login' })
		.mockResolvedValueOnce({ sessionId: 'session_dev_login' });
});

describe('POST /api/internal/dev-login', () => {
	it('404s unless the explicit test-only switch is enabled', async () => {
		await expect(
			POST(
				makeEvent({
					env: {
						ENVIRONMENT: 'test',
						DEV_LOGIN_TOKEN: 'dev-token',
						SESSION_CREATION_SECRET: 'session-secret'
					}
				})
			)
		).rejects.toMatchObject({ status: 404 });
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('404s outside ENVIRONMENT=test even when ENABLE_DEV_LOGIN is set', async () => {
		await expect(
			POST(
				makeEvent({
					env: {
						ENABLE_DEV_LOGIN: '1',
						ENVIRONMENT: 'staging',
						DEV_LOGIN_TOKEN: 'dev-token',
						SESSION_CREATION_SECRET: 'session-secret'
					}
				})
			)
		).rejects.toMatchObject({ status: 404 });
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('rejects non-test identities before creating a session', async () => {
		await expect(
			POST(makeEvent({ body: { email: 'admin@commons.email', principalName: 'Admin' } }))
		).rejects.toMatchObject({ status: 400 });
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('creates a session only for example.test identities with the correct token', async () => {
		const event = makeEvent();
		const response = await POST(event);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ ok: true, userId: 'user_dev_login' });
		expect(mockServerMutation).toHaveBeenCalledTimes(2);
		expect(mockServerMutation).toHaveBeenNthCalledWith(
			1,
			'authOps.upsertFromOAuth',
			expect.objectContaining({
				provider: 'dev-login',
				email: 'regrounding-e2e@example.test',
				emailVerified: true
			})
		);
		expect(event.cookies.set).toHaveBeenCalledWith(
			'auth-session',
			'session_dev_login',
			expect.objectContaining({
				httpOnly: true,
				sameSite: 'lax'
			})
		);
	});
});
