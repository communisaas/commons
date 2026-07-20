import { beforeEach, describe, expect, it, vi } from 'vitest';

const { MockBackfillIncompleteError, mockMatch, mockMatchValues, mockRefresh } = vi.hoisted(() => {
	class BackfillIncompleteError extends Error {}
	return {
		MockBackfillIncompleteError: BackfillIncompleteError,
		mockMatch: vi.fn(),
		mockMatchValues: vi.fn(),
		mockRefresh: vi.fn()
	};
});

vi.mock('$lib/server/public-discovery-manifest-refresh-auth', () => ({
	matchPublicDiscoveryManifestRefreshSecret: mockMatch,
	matchPublicDiscoveryManifestRefreshSecretValues: mockMatchValues
}));
vi.mock('$lib/server/public-template-queries', () => ({
	PublicTemplatePageBackfillIncompleteError: MockBackfillIncompleteError,
	refreshPublicDiscoveryManifestControl: mockRefresh
}));

import { POST } from '../../../src/routes/api/internal/public-discovery-manifest-refresh/+server';

function event(
	secret: string | null = 'manifest-refresh-secret-that-is-long-enough',
	platform: App.Platform | null = { env: {} } as App.Platform
): Parameters<typeof POST>[0] {
	const headers = new Headers();
	if (secret !== null) {
		headers.set('x-public-discovery-manifest-refresh-secret', secret);
	}
	return {
		locals: {
			reservePublicTemplateOgQueueAttempts: vi.fn(async () => ({
				remaining: 499,
				resetAtMs: Date.UTC(2026, 6, 21),
				status: 'reserved' as const
			}))
		},
		request: new Request(
			'https://commons.example/api/internal/public-discovery-manifest-refresh',
			{ headers, method: 'POST' }
		),
		platform: platform ?? undefined
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/internal/public-discovery-manifest-refresh', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockMatch.mockReturnValue({ ok: true });
		mockMatchValues.mockReturnValue({ ok: true });
		mockRefresh.mockResolvedValue({
			manifest: {
				list: {
					ready: true,
					retiredRevision: 4,
					revision: 5,
					updatedAt: 500,
					withdrawalEpoch: 2
				},
				relations: {
					ready: true,
					retiredRevision: 4,
					revision: 5,
					updatedAt: 500,
					withdrawalEpoch: 1
				}
			},
			withdrawalFloors: { list: 4, relations: 4 }
		});
	});

	it.each([
		[{ ok: false, reason: 'invalid' }, 401],
		[{ ok: false, reason: 'not_configured' }, 503]
	] as const)('authenticates before any platform, R2, or Convex work', async (auth, status) => {
		mockMatch.mockReturnValue(auth);
		const response = await POST(event(null, null));

		expect(response.status).toBe(status);
		expect(mockRefresh).not.toHaveBeenCalled();
	});

	it('rejects a missing Cloudflare platform only after authentication', async () => {
		const response = await POST(event(undefined, null));

		expect(response.status).toBe(503);
		expect(mockMatch).toHaveBeenCalledOnce();
		expect(mockRefresh).not.toHaveBeenCalled();
	});

	it('runs the bounded writer and reports only public control coordinates', async () => {
		const platform = { env: {} } as App.Platform;
		const response = await POST(event(undefined, platform));

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-public-discovery-generation')).toBe(
			'list=5:500;relations=5:500'
		);
		await expect(response.json()).resolves.toEqual({
			generation: 'list=5:500;relations=5:500',
			ok: true,
			list: { ready: true, retiredRevision: 4, revision: 5, withdrawalEpoch: 2 },
			relations: { ready: true, retiredRevision: 4, revision: 5, withdrawalEpoch: 1 }
		});
		expect(mockRefresh).toHaveBeenCalledWith({
			platform,
			allowPageArtifactBackfill: false,
			reserveOgQueueAttempts: expect.any(Function)
		});
	});

	it('fails closed when the lease-bound Queue budget callback is absent', async () => {
		const input = event();
		delete input.locals.reservePublicTemplateOgQueueAttempts;
		const response = await POST(input);

		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockRefresh).not.toHaveBeenCalled();
	});

	it('returns the bounded 202 continuation protocol for a resumable immutable backfill', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		mockRefresh.mockRejectedValue(new MockBackfillIncompleteError('batch complete'));
		const response = await POST(event());

		expect(response.status).toBe(202);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('retry-after')).toBe('120');
		expect(response.headers.get('x-public-discovery-page-backfill-continuation')).toBe('1');
		await expect(response.json()).resolves.toEqual({
			code: 'PUBLIC_TEMPLATE_PAGE_BACKFILL_INCOMPLETE',
			ok: false,
			retryAfterSeconds: 120,
			retryable: true
		});
	});

	it('uses deployed platform values as the authoritative active/previous verifier input', async () => {
		const active = 'active-'.padEnd(64, 'a');
		const previous = 'previous-'.padEnd(64, 'p');
		const platform = {
			env: {
				DISCOVERY_MANIFEST_REFRESH_SECRET: active,
				DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS: previous
			}
		} as unknown as App.Platform;

		const response = await POST(event(previous, platform));

		expect(response.status).toBe(200);
		expect(mockMatchValues).toHaveBeenCalledWith(previous, active, previous);
		expect(mockMatch).not.toHaveBeenCalled();
	});

	it('does not reflect either secret generation in an authorization failure', async () => {
		const active = 'active-'.padEnd(64, 'a');
		const previous = 'previous-'.padEnd(64, 'p');
		mockMatchValues.mockReturnValue({ ok: false, reason: 'invalid' });
		const platform = {
			env: {
				DISCOVERY_MANIFEST_REFRESH_SECRET: active,
				DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS: previous
			}
		} as unknown as App.Platform;

		const response = await POST(event('attacker', platform));
		const body = await response.text();

		expect(response.status).toBe(401);
		expect(body).toContain('Unauthorized');
		expect(body).not.toContain(active);
		expect(body).not.toContain(previous);
		expect(mockRefresh).not.toHaveBeenCalled();
	});
});
