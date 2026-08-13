import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockConvexQuery,
	mockConvexConstructor,
	mockGetInternalSecret,
	mockMatchInternalSecret,
	mockRuntimeConvexUrl,
	api
} = vi.hoisted(() => ({
		mockConvexQuery: vi.fn(),
		mockConvexConstructor: vi.fn(),
		mockGetInternalSecret: vi.fn(),
		mockMatchInternalSecret: vi.fn(),
		mockRuntimeConvexUrl: vi.fn(),
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
	getRuntimeConvexUrl: mockRuntimeConvexUrl
}));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: mockGetInternalSecret,
	matchInternalSecret: mockMatchInternalSecret
}));

import {
	GET,
	_clearHealthProbeCacheForTests,
	_normalizeExactReleaseSha
} from '../../../src/routes/api/health/+server';

const PRODUCTION_CONVEX_URL = 'https://quirky-chinchilla-352.convex.cloud';
const HEALTH_ENV = {
	ATLAS_BASE_URL: 'https://atlas.commons.email',
	EXPECTED_CELL_MAP_ROOT: `0x${'a'.repeat(64)}`,
	EXPECTED_CELL_MAP_DEPTH: '20',
	PUBLIC_CONVEX_URL: PRODUCTION_CONVEX_URL,
	PUBLIC_RELEASE_TRANSACTION_ID: '123456789-2',
	EXA_API_KEY: 'health-exa-provider-key',
	FIRECRAWL_API_KEY: 'health-firecrawl-provider-key',
	GEMINI_API_KEY: 'health-gemini-provider-key',
	GROQ_API_KEY: 'health-groq-provider-key',
	PAID_PROVIDER_OPERATOR_USER_IDS: 'health-launch-operator',
	SESSION_CREATION_SECRET: 'health-session-creation-secret-32-byte-padding',
	SESSION_COOKIE_SIGNING_SECRET: 'health-cookie-signing-secret-32-byte-padding',
	CONVEX_WORK_BUDGET: {
		get: vi.fn(),
		idFromName: vi.fn()
	} as unknown as DurableObjectNamespace,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: {
		get: vi.fn(),
		idFromName: vi.fn()
	} as unknown as DurableObjectNamespace,
	PUBLIC_DISCOVERY_R2: {
		delete: vi.fn(),
		get: vi.fn(),
		put: vi.fn(),
		list: vi.fn()
	}
};

function publicationState(
	key: string,
	certifiedAt: number,
	publicationLag: {
		startedAt: number;
		lastObservedAt: number;
		targetGeneration: string;
		terminalCode: string | null;
	} | null = null
) {
	const encodedRealm = /^public-discovery\/v8\/([^/]+)\/control\/manifest\/state\.json$/.exec(
		key
	)?.[1];
	if (!encodedRealm) return null;
	const manifest = {
		list: {
			ready: true,
			retiredRevision: 0,
			revision: 1,
			updatedAt: 100,
			withdrawalEpoch: 0
		},
		relations: {
			ready: true,
			retiredRevision: 0,
			revision: 1,
			updatedAt: 100,
			withdrawalEpoch: 0
		}
	};
	const body = JSON.stringify({
		certifiedAt,
		manifest,
		pendingRetireGenerations: { graph: [], list: [] },
		payloadGenerations: {
			graph: ['list=1:100;relations=1:100'],
			list: ['1:100']
		},
		phase: 'ready',
		publicationLag,
		realm: decodeURIComponent(encodedRealm),
		schema: 2,
		withdrawalFloors: { list: 0, relations: 0 },
		writtenAt: certifiedAt
	});
	return {
		customMetadata: { kind: 'manifest-ready', schema: '2' },
		etag: 'publication-health-etag',
		key,
		size: new TextEncoder().encode(body).byteLength,
		text: vi.fn(async () => body),
		uploaded: new Date(certifiedAt)
	};
}

function event(
	env: typeof HEALTH_ENV | (Omit<typeof HEALTH_ENV, 'PUBLIC_DISCOVERY_R2'> & { PUBLIC_DISCOVERY_R2?: undefined }) =
		HEALTH_ENV,
		authenticated = true
) {
	const url = new URL('https://commons.example/api/health');
	return {
		platform: { env },
		request: new Request(url, {
			headers: authenticated ? { 'x-internal-secret': 'deploy-probe-secret' } : undefined
		}),
		url,
		locals: {}
	} as never;
}

const REQUIRED_LAUNCH_PLANES = [
	'discoverySource',
	'endorsementCounts',
	'templateList',
	'recipientMetrics',
	'sessionAuthority',
	'campaignReadModel',
	'campaignCounters',
	'debateReadModel',
	'organizationDirectory',
	'coalitionMetrics',
	'networkCharters',
	'supporterBrowse',
	'supporterAudienceActions',
	'accountabilityReadModel',
	'planUsage',
	'workflowExecutionCounts',
	'donationConfirmationSummaries',
	'smsReplySummaries'
] as const;

function readyProducerStatus(overrides: Record<string, unknown> = {}) {
	return {
		ok: true,
		storageReadable: true,
		discoveryManifestPresent: true,
		discoverySourcePlaneReady: true,
		discoveryEndorsementCountsReady: true,
		templateListProjectionReady: true,
		recipientMetricsReady: true,
		launchProjectionPlanes: Object.fromEntries(
			REQUIRED_LAUNCH_PLANES.map((name) => [
				name,
				{ status: 'ready', ready: true, failureCode: null }
			])
		),
		launchProjectionsReady: true,
		discoveryProducerHealthy: true,
		discoveryProducerOverdueAt: null,
		...overrides
	};
}

describe('/api/health', () => {
	beforeEach(() => {
		_clearHealthProbeCacheForTests();
		mockConvexQuery.mockReset();
		mockConvexConstructor.mockReset();
		mockGetInternalSecret.mockReset();
		mockMatchInternalSecret.mockReset();
		mockRuntimeConvexUrl.mockReset();
		mockRuntimeConvexUrl.mockReturnValue(PRODUCTION_CONVEX_URL);
		mockMatchInternalSecret.mockReturnValue({ ok: true });
		mockGetInternalSecret.mockReturnValue('health-probe-internal-secret-32-byte-padding');
		vi.mocked(HEALTH_ENV.PUBLIC_DISCOVERY_R2.get).mockReset();
		// Model an object that already existed when the request began. The status
		// reader intentionally captures its observation clock before awaiting R2;
		// minting certifiedAt inside this async GET can fabricate a future receipt.
		const publicationCertifiedAt = Date.now();
		vi.mocked(HEALTH_ENV.PUBLIC_DISCOVERY_R2.get).mockImplementation(async (key: string) =>
			publicationState(key, publicationCertifiedAt)
		);
		vi.mocked(HEALTH_ENV.PUBLIC_DISCOVERY_R2.list).mockClear();
		vi.mocked(HEALTH_ENV.PUBLIC_DISCOVERY_R2.put).mockClear();
		vi.mocked(HEALTH_ENV.PUBLIC_DISCOVERY_R2.delete).mockClear();
		vi.stubGlobal('caches', undefined);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
	});

	afterEach(() => {
		_clearHealthProbeCacheForTests();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('uses the secret-gated singleton producer probe and reports a healthy dependency set', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus());

		const response = await GET(event());
		const body = await response.json();

		expect(response.status, JSON.stringify(body)).toBe(200);
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
			convexRealm: 'production',
			atlas: { status: 'ok' },
			publicDiscoveryCache: {
				status: 'ok',
				r2Bound: true,
				refreshGateBound: true,
				workBudgetBound: true,
				publication: { healthy: true, status: 'ready', terminalCode: null }
			},
			release: {
				status: 'ok',
				sha: expect.stringMatching(/^[a-f0-9]{40}$/),
				transactionId: HEALTH_ENV.PUBLIC_RELEASE_TRANSACTION_ID
			},
			sessionCookieAuthority: { status: 'ok', keysIsolated: true },
			paidProvider: {
				status: 'ok',
				budgetCoordinatorBound: true,
				operatorAllowlistConfigured: true,
				providerSecretsConfigured: true,
				missingBindings: []
			}
		});
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(HEALTH_ENV.PUBLIC_DISCOVERY_R2.get).toHaveBeenCalledOnce();
		expect(HEALTH_ENV.PUBLIC_DISCOVERY_R2.get).toHaveBeenCalledWith(
			'public-discovery/v8/backend%3Dhttps%3A%2F%2Fquirky-chinchilla-352.convex.cloud/control/manifest/state.json'
		);
		expect(HEALTH_ENV.PUBLIC_DISCOVERY_R2.list).not.toHaveBeenCalled();
		expect(HEALTH_ENV.PUBLIC_DISCOVERY_R2.put).not.toHaveBeenCalled();
		expect(HEALTH_ENV.PUBLIC_DISCOVERY_R2.delete).not.toHaveBeenCalled();
	});

	it('fails readiness immediately on terminal publication while the served authority is fresh', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus());
		const certifiedAt = Date.now();
		vi.mocked(HEALTH_ENV.PUBLIC_DISCOVERY_R2.get).mockImplementation(async (key: string) => {
			return publicationState(key, certifiedAt, {
				startedAt: certifiedAt - 1_000,
				lastObservedAt: certifiedAt,
				targetGeneration: 'list=2:200;relations=2:200',
				terminalCode: 'REPAIR_EXHAUSTED'
			});
		});

		const response = await GET(event());

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			status: 'down',
			publicDiscoveryCache: {
				status: 'down',
				publication: {
					healthy: false,
					status: 'terminal',
					terminalCode: 'REPAIR_EXHAUSTED'
				}
			}
		});
	});

	it('allows the exact production tree to probe the approved nonproduction runtime realm', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus());
		const nonproduction = 'https://outstanding-firefly-831.convex.cloud';

		const response = await GET(
			event({ ...HEALTH_ENV, PUBLIC_CONVEX_URL: nonproduction } as typeof HEALTH_ENV)
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			convex: true,
			convexRealm: 'nonproduction'
		});
		expect(mockConvexConstructor).toHaveBeenCalledWith(
			nonproduction,
			expect.objectContaining({ logger: false, fetch: expect.any(Function) })
		);
	});

	it('rejects anonymous readiness probes before any Convex, Atlas, R2, or cache work', async () => {
		mockMatchInternalSecret.mockReturnValue({ ok: false, reason: 'invalid' });

		const response = await GET(event(HEALTH_ENV, false));

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({
			status: 'unauthorized',
			liveness: '/api/live'
		});
		expect(mockConvexConstructor).not.toHaveBeenCalled();
		expect(mockConvexQuery).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('bypasses cached readiness for an authenticated deployment probe', async () => {
		mockConvexQuery.mockResolvedValueOnce(readyProducerStatus());

		const first = await GET(event());
		mockConvexQuery.mockRejectedValueOnce(new Error('deployment disabled'));
		const fresh = await GET(event(HEALTH_ENV, true));

		expect(first.status).toBe(200);
		expect(fresh.status).toBe(503);
		expect(mockConvexQuery).toHaveBeenCalledTimes(2);
		expect(mockMatchInternalSecret).toHaveBeenLastCalledWith('deploy-probe-secret');
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
		const response = await GET(event({ ...HEALTH_ENV, PUBLIC_CONVEX_URL: convexUrl }));

		expect(response.status).toBe(503);
		expect(mockConvexConstructor).not.toHaveBeenCalled();
		expect(mockConvexQuery).not.toHaveBeenCalled();
		expect(mockGetInternalSecret).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toMatchObject({ status: 'down', convex: false });
	});

	it('does not let a mutable runtime fallback approve its own Convex tenant', async () => {
		mockRuntimeConvexUrl.mockReturnValue('https://attacker-owned.convex.cloud');
		const { PUBLIC_CONVEX_URL: _configuredRealm, ...envWithoutConfiguredRealm } = HEALTH_ENV;

		const response = await GET(event(envWithoutConfiguredRealm as never));

		expect(response.status).toBe(503);
		expect(mockConvexConstructor).not.toHaveBeenCalled();
		expect(mockConvexQuery).not.toHaveBeenCalled();
		expect(mockGetInternalSecret).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toMatchObject({
			status: 'down',
			convex: false,
			convexRealm: 'unknown'
		});
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

	it('fails readiness when the public discovery R2 binding is missing', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus());

		const response = await GET(
			event({ ...HEALTH_ENV, PUBLIC_DISCOVERY_R2: undefined } as Omit<
				typeof HEALTH_ENV,
				'PUBLIC_DISCOVERY_R2'
			> & { PUBLIC_DISCOVERY_R2?: undefined })
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			status: 'down',
			convex: true,
			atlas: { status: 'ok' },
			publicDiscoveryCache: { status: 'down', r2Bound: false }
		});
	});

	it('fails readiness when the public discovery refresh gate binding is missing', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus());
		const response = await GET(
			event({
				...HEALTH_ENV,
				PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: undefined
			} as unknown as typeof HEALTH_ENV)
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			status: 'down',
			publicDiscoveryCache: {
				status: 'down',
				r2Bound: true,
				refreshGateBound: false
			}
		});
	});

	it('fails readiness when the Convex work-budget binding is missing', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus());
		const response = await GET(
			event({ ...HEALTH_ENV, CONVEX_WORK_BUDGET: undefined } as unknown as typeof HEALTH_ENV)
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			status: 'down',
			publicDiscoveryCache: { status: 'down', workBudgetBound: false },
			paidProvider: { status: 'down', budgetCoordinatorBound: false }
		});
	});

	it.each([
		['EXA_API_KEY', undefined],
		['FIRECRAWL_API_KEY', ''],
		['GEMINI_API_KEY', ' short '],
		['GROQ_API_KEY', 'bad\nkey'],
		['PAID_PROVIDER_OPERATOR_USER_IDS', 'launch-operator, launch-backup'],
		['PAID_PROVIDER_OPERATOR_USER_IDS', 'launch-operator,launch-operator']
	] as const)('fails paid-provider readiness for malformed %s', async (binding, value) => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus());
		const response = await GET(event({ ...HEALTH_ENV, [binding]: value }));

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({
			status: 'down',
			paidProvider: {
				status: 'down',
				missingBindings: expect.arrayContaining([binding])
			}
		});
	});

	it('fails readiness when cookie signing authority is missing or reuses a creation key', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus());
		const previousCreation = 'health-session-creation-previous-32-byte-pad';
		const previousCookie = 'health-cookie-signing-previous-32-byte-pad';

		for (const env of [
			{ ...HEALTH_ENV, SESSION_COOKIE_SIGNING_SECRET: undefined },
			{
				...HEALTH_ENV,
				SESSION_COOKIE_SIGNING_SECRET: HEALTH_ENV.SESSION_CREATION_SECRET
			},
			{
				...HEALTH_ENV,
				SESSION_CREATION_SECRET_PREVIOUS: previousCreation,
				SESSION_COOKIE_SIGNING_SECRET: previousCreation
			},
			{
				...HEALTH_ENV,
				SESSION_CREATION_SECRET_PREVIOUS: previousCreation,
				SESSION_COOKIE_SIGNING_SECRET_PREVIOUS: HEALTH_ENV.SESSION_CREATION_SECRET
			},
			{
				...HEALTH_ENV,
				SESSION_CREATION_SECRET_PREVIOUS: previousCreation,
				SESSION_COOKIE_SIGNING_SECRET_PREVIOUS: previousCreation
			},
			{
				...HEALTH_ENV,
				SESSION_COOKIE_SIGNING_SECRET_PREVIOUS: previousCookie,
				SESSION_COOKIE_SIGNING_SECRET: previousCookie
			}
		]) {
			const response = await GET(event(env as typeof HEALTH_ENV));
			expect(response.status).toBe(503);
			await expect(response.json()).resolves.toMatchObject({
				status: 'down',
				sessionCookieAuthority: { status: 'down', keysIsolated: false }
			});
		}
	});

	it('accepts only one exact lowercase Git SHA as artifact identity', () => {
		const exactSha = 'a'.repeat(40);
		expect(_normalizeExactReleaseSha(exactSha)).toBe(exactSha);
		for (const releaseSha of [undefined, null, 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), 'main']) {
			expect(_normalizeExactReleaseSha(releaseSha)).toBeNull();
		}
	});

	it('reports not ready when the discovery manifest singleton is missing', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus({ discoveryManifestPresent: false }));

		const response = await GET(event());
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body).toMatchObject({ status: 'down', convex: false, atlas: { status: 'ok' } });
	});

	it('reports not ready before the compact discovery source cutover', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus({ discoverySourcePlaneReady: false }));

		const response = await GET(event());
		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({ status: 'down', convex: false });
	});

	it('reports not ready before exact endorsement counters are reconciled', async () => {
		mockConvexQuery.mockResolvedValue(
			readyProducerStatus({ discoveryEndorsementCountsReady: false })
		);

		const response = await GET(event());
		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({ status: 'down', convex: false });
	});

	it('reports not ready before the authenticated template-list projection is reconciled', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus({ templateListProjectionReady: false }));

		const response = await GET(event());

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({ status: 'down', convex: false });
	});

	it('reports not ready before compact recipient metrics are reconciled', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus({ recipientMetricsReady: false }));

		const response = await GET(event());

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({ status: 'down', convex: false });
	});

	it('fails closed when any required launch projection is missing or unhealthy', async () => {
		const missing = readyProducerStatus();
		delete (missing.launchProjectionPlanes as Record<string, unknown>).supporterBrowse;
		mockConvexQuery.mockResolvedValueOnce(missing);

		const missingResponse = await GET(event());
		expect(missingResponse.status).toBe(503);

		const unhealthy = readyProducerStatus();
		(unhealthy.launchProjectionPlanes as Record<string, unknown>).accountabilityReadModel = {
			status: 'blocked',
			ready: false,
			failureCode: 'ACCOUNTABILITY_MIGRATION_BLOCKED'
		};
		mockConvexQuery.mockResolvedValueOnce(unhealthy);

		const unhealthyResponse = await GET(event());
		expect(unhealthyResponse.status).toBe(503);
	});

	it('reports not ready while a public-discovery producer failure is outstanding', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus({ discoveryProducerHealthy: false }));

		const response = await GET(event());
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body).toMatchObject({ status: 'down', convex: false, atlas: { status: 'ok' } });
	});

	it('reports not ready after a dirty producer misses its scheduled refresh grace period', async () => {
		mockConvexQuery.mockResolvedValue(readyProducerStatus({ discoveryProducerOverdueAt: 1 }));

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
			return readyProducerStatus();
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
