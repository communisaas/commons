import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConvexQuery, mockConvexConstructor, mockGetInternalSecret, api } = vi.hoisted(() => ({
	mockConvexQuery: vi.fn(),
	mockConvexConstructor: vi.fn(),
	mockGetInternalSecret: vi.fn(),
	api: {
		observability: {
			discoveryProducerStatus: 'observability.discoveryProducerStatus'
		}
	}
}));

vi.mock('convex/browser', () => ({
	ConvexHttpClient: class {
		constructor(url: string, options: unknown) {
			mockConvexConstructor(url, options);
		}

		query = mockConvexQuery;
	}
}));
vi.mock('$lib/convex', () => ({
	api,
	CONVEX_URL: 'https://health-probe.convex.cloud'
}));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: mockGetInternalSecret
}));

import { GET } from '../../../src/routes/api/health/+server';

const HEALTH_ENV = {
	ATLAS_BASE_URL: 'https://atlas.commons.email',
	EXPECTED_CELL_MAP_ROOT: `0x${'a'.repeat(64)}`,
	EXPECTED_CELL_MAP_DEPTH: '20',
	PUBLIC_CONVEX_URL: 'https://health-probe.convex.cloud',
	PUBLIC_DISCOVERY_KV: {
		get: vi.fn(),
		put: vi.fn(),
		list: vi.fn()
	}
};

function event() {
	return { platform: { env: HEALTH_ENV } } as never;
}

describe('/api/health', () => {
	beforeEach(() => {
		mockConvexQuery.mockReset();
		mockConvexConstructor.mockReset();
		mockGetInternalSecret.mockReset();
		mockGetInternalSecret.mockReturnValue('health-probe-internal-secret-32-byte-padding');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('uses the secret-gated singleton producer probe and reports a healthy dependency set', async () => {
		mockConvexQuery.mockResolvedValue({
			ok: true,
			storageReadable: true,
			discoveryManifestPresent: true,
			discoveryProducerHealthy: true,
			discoveryProducerOverdueAt: null
		});

		const response = await GET(event());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(mockConvexConstructor).toHaveBeenCalledWith(
			HEALTH_ENV.PUBLIC_CONVEX_URL,
			expect.objectContaining({ logger: false, fetch: expect.any(Function) })
		);
		expect(mockConvexQuery).toHaveBeenCalledOnce();
		expect(mockConvexQuery).toHaveBeenCalledWith(api.observability.discoveryProducerStatus, {
			_secret: 'health-probe-internal-secret-32-byte-padding'
		});
		expect(body).toMatchObject({
			status: 'ok',
			convex: true,
			atlas: { status: 'ok' },
			publicDiscoveryCache: { status: 'ok', kvBound: true }
		});
	});

	it.each([
		['an off-domain host', 'https://attacker.example'],
		['another Convex tenant', 'https://attacker-owned.convex.cloud'],
		['plain HTTP', 'http://health-probe.convex.cloud'],
		['embedded credentials', 'https://user:pass@health-probe.convex.cloud'],
		['a non-root path', 'https://health-probe.convex.cloud/collect'],
		['query parameters', 'https://health-probe.convex.cloud?target=attacker'],
		['a URL fragment', 'https://health-probe.convex.cloud#attacker'],
		['a non-standard port', 'https://health-probe.convex.cloud:444']
	])('rejects %s before constructing a client or reading the secret', async (_label, convexUrl) => {
		const response = await GET({
			platform: { env: { ...HEALTH_ENV, PUBLIC_CONVEX_URL: convexUrl } }
		} as never);

		expect(response.status).toBe(503);
		expect(mockConvexConstructor).not.toHaveBeenCalled();
		expect(mockConvexQuery).not.toHaveBeenCalled();
		expect(mockGetInternalSecret).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toMatchObject({ status: 'down', convex: false });
	});

	it('fails closed when the server-side internal secret is unavailable', async () => {
		mockGetInternalSecret.mockImplementation(() => {
			throw new Error('INTERNAL_API_SECRET not configured');
		});

		const response = await GET(event());

		expect(response.status).toBe(503);
		expect(mockConvexQuery).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toMatchObject({ status: 'down', convex: false });
	});

	it('reports cache degradation without taking core application health down', async () => {
		mockConvexQuery.mockResolvedValue({
			ok: true,
			storageReadable: true,
			discoveryManifestPresent: true,
			discoveryProducerHealthy: true,
			discoveryProducerOverdueAt: null
		});

		const response = await GET({
			platform: { env: { ...HEALTH_ENV, PUBLIC_DISCOVERY_KV: undefined } }
		} as never);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			status: 'ok',
			convex: true,
			atlas: { status: 'ok' },
			publicDiscoveryCache: { status: 'degraded', kvBound: false }
		});
	});

	it('reports not ready when the discovery manifest singleton is missing', async () => {
		mockConvexQuery.mockResolvedValue({
			ok: true,
			storageReadable: true,
			discoveryManifestPresent: false,
			discoveryProducerHealthy: true,
			discoveryProducerOverdueAt: null
		});

		const response = await GET(event());
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body).toMatchObject({ status: 'down', convex: false, atlas: { status: 'ok' } });
	});

	it('reports not ready while a public-discovery producer failure is outstanding', async () => {
		mockConvexQuery.mockResolvedValue({
			ok: true,
			storageReadable: true,
			discoveryManifestPresent: true,
			discoveryProducerHealthy: false,
			discoveryProducerOverdueAt: null
		});

		const response = await GET(event());
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body).toMatchObject({ status: 'down', convex: false, atlas: { status: 'ok' } });
	});

	it('reports not ready after a dirty producer misses its scheduled refresh grace period', async () => {
		mockConvexQuery.mockResolvedValue({
			ok: true,
			storageReadable: true,
			discoveryManifestPresent: true,
			discoveryProducerHealthy: true,
			discoveryProducerOverdueAt: 1
		});

		const response = await GET(event());
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body).toMatchObject({ status: 'down', convex: false, atlas: { status: 'ok' } });
	});

	it('returns 503 when the Convex deployment is disabled', async () => {
		mockConvexQuery.mockRejectedValue(new Error('deployment disabled'));

		const response = await GET(event());
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body).toMatchObject({ status: 'down', convex: false, atlas: { status: 'ok' } });
	});

	it('aborts a never-settling Convex fetch and reports it unhealthy', async () => {
		vi.useFakeTimers();
		let aborted = false;
		vi.stubGlobal(
			'fetch',
			vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input).includes('convex.cloud')) {
					return new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener(
							'abort',
							() => {
								aborted = true;
								reject(new DOMException('Aborted', 'AbortError'));
							},
							{ once: true }
						);
					});
				}
				return Promise.resolve(new Response(null, { status: 200 }));
			})
		);
		mockConvexQuery.mockImplementation(async () => {
			const options = mockConvexConstructor.mock.calls.at(-1)?.[1] as
				| { fetch?: typeof fetch }
				| undefined;
			if (!options?.fetch) throw new Error('missing abortable Convex fetch');
			await options.fetch(`${HEALTH_ENV.PUBLIC_CONVEX_URL}/api/query`, { method: 'POST' });
			return {
				ok: true,
				storageReadable: true,
				discoveryManifestPresent: true,
				discoveryProducerHealthy: true,
				discoveryProducerOverdueAt: null
			};
		});

		const responsePromise = GET(event());
		await vi.advanceTimersByTimeAsync(5_000);
		const response = await responsePromise;
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body).toMatchObject({ status: 'down', convex: false, atlas: { status: 'ok' } });
		expect(aborted).toBe(true);
	});
});
