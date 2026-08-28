import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTrustedPagesReleaseEdge } from '../../../workers/trusted-pages-release-edge';
import {
	TRUSTED_PAGES_RELEASE_CACHE_POLICY,
	type TrustedCacheExecutionContext,
	type TrustedCacheLike
} from '../../../workers/trusted-pages-release-cache';

const sourceSha = 'a'.repeat(40);
const defaultTransaction = '123456789-1';
const releaseProbeSecret = 'p'.repeat(32);
const releaseOriginProofSecret = 'o'.repeat(32);
const pagesOriginAccessToken = JSON.stringify({
	'cf-access-client-id': `${'c'.repeat(32)}.access`,
	'cf-access-client-secret': 's'.repeat(64)
});

class EdgeMemoryCache implements TrustedCacheLike {
	readonly entries = new Map<string, Response>();
	readonly match = vi.fn(async (request: Request) => this.entries.get(request.url)?.clone());
	readonly put = vi.fn(async (request: Request, response: Response) => {
		this.entries.set(request.url, response.clone());
	});
}

function edgeContext(): TrustedCacheExecutionContext & { flush(): Promise<void> } {
	const work: Promise<unknown>[] = [];
	return {
		async flush() {
			while (work.length > 0) await Promise.all(work.splice(0));
		},
		waitUntil(promise) {
			work.push(promise);
		}
	};
}

type GateStatus = 'absent' | 'committed' | 'contained' | 'provisional' | 'qualified';

function gateNamespace(status: GateStatus | (() => GateStatus), transactionId: string) {
	const requests: Request[] = [];
	return {
		requests,
		namespace: {
			idFromName: vi.fn((name: string) => name),
			get: vi.fn(() => ({
				fetch: vi.fn(async (request: Request) => {
					requests.push(request);
					return new Response(null, {
						status: 200,
						headers: {
							'x-public-discovery-refresh-gate-protocol': '3',
							'x-public-template-og-release-sha': sourceSha,
							'x-public-template-og-release-transaction': transactionId,
							'x-commons-release-authority-status':
								typeof status === 'function' ? status() : status
						}
					});
				})
			}))
		}
	};
}

function originFetch(response: () => Response = () => new Response('origin')) {
	const requests: Request[] = [];
	return {
		requests,
		fetch: vi.fn(async (request: Request | string | URL) => {
			requests.push(typeof request === 'string' || request instanceof URL ? new Request(request) : request);
			return response();
		}) as typeof fetch
	};
}

function productionEnv(
	status: GateStatus,
	transactionId = defaultTransaction,
	origin = originFetch()
) {
	const gate = gateNamespace(status, transactionId);
	return {
		gate,
		origin,
		env: {
			PAGES_ORIGIN_ACCESS_TOKEN: pagesOriginAccessToken,
			PUBLIC_CONVEX_URL: 'https://quirky-chinchilla-352.convex.cloud',
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: gate.namespace,
			PUBLIC_RELEASE_TRANSACTION_ID: transactionId,
			RELEASE_ORIGIN_PROOF_SECRET: releaseOriginProofSecret
		}
	};
}

function stagingEnv(
	origin = originFetch(
		() =>
			new Response(null, {
				status: 204,
				headers: {
					'x-commons-origin-access-token': 'absent',
					'x-commons-preview-cache-api': 'unavailable'
				}
			})
	)
) {
	return {
		origin,
		env: {
			PAGES_ORIGIN_ACCESS_TOKEN: pagesOriginAccessToken,
			PUBLIC_RELEASE_TRANSACTION_ID: defaultTransaction,
			RELEASE_PROBE_SECRET: releaseProbeSecret
		}
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('trusted Pages release edge', () => {
	it('answers liveness without touching release authority or candidate origin', async () => {
		const runtime = productionEnv('absent', '123456789-2');
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: runtime.origin.fetch });

		const response = await edge.fetch(
			new Request('https://commons.email/api/live'),
			runtime.env
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			boundary: 'separate-access-pages-origin',
			release: { sha: sourceSha, transactionId: '123456789-2' },
			status: 'ok'
		});
		expect(runtime.gate.requests).toHaveLength(0);
		expect(runtime.origin.fetch).not.toHaveBeenCalled();
	});

	it.each(['absent', 'contained', 'provisional', 'qualified'] as const)(
		'denies production traffic for %s authority without calling the origin',
		async (status) => {
			const suffix = { absent: 10, contained: 11, provisional: 12, qualified: 13 }[status];
			const runtime = productionEnv(status, `123456789-${suffix}`);
			const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: runtime.origin.fetch });

			const response = await edge.fetch(
				new Request('https://commons.email/directory'),
				runtime.env
			);

			expect(response.status).toBe(503);
			expect(runtime.gate.requests).toHaveLength(1);
			expect(runtime.origin.fetch).not.toHaveBeenCalled();
		}
	);

	it('proxies committed production traffic through only the Access-protected origin', async () => {
		const transactionId = '123456789-20';
		const runtime = productionEnv(
			'committed',
			transactionId,
			originFetch(() => new Response('open', { headers: { 'cache-control': 'public, max-age=60' } }))
		);
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: runtime.origin.fetch });

		const response = await edge.fetch(
			new Request('https://commons.email/directory?limit=10', {
				headers: {
					authorization: 'Bearer public-session',
					'cf-access-client-secret': 'must-not-cross',
					'cf-access-token': 'must-not-cross',
					cookie: 'session=preserved; CF_Authorization=must-not-cross',
					'x-commons-edge-public-host': 'attacker.example'
				}
			}),
			runtime.env
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('open');
		expect(runtime.origin.requests).toHaveLength(1);
		const forwarded = runtime.origin.requests[0];
		expect(forwarded.url).toBe(
			'https://pages-origin.commons.email/directory?limit=10'
		);
		expect(forwarded.headers.get('authorization')).toBe('Bearer public-session');
		expect(forwarded.headers.get('cf-access-client-secret')).toBeNull();
		expect(forwarded.headers.get('cf-access-token')).toBeNull();
		expect(forwarded.headers.get('cookie')).toBe('session=preserved');
		expect(forwarded.headers.get('x-commons-pages-origin-access')).toBe(
			pagesOriginAccessToken
		);
		expect(forwarded.headers.get('x-commons-edge-public-host')).toBe('commons.email');
		expect(forwarded.headers.get('x-commons-edge-release-sha')).toBe(sourceSha);
		expect(forwarded.headers.get('x-commons-edge-release-transaction')).toBe(transactionId);
	});

	it('propagates a disconnect through a non-cacheable production bypass', async () => {
		const transactionId = '123456789-36';
		const runtime = productionEnv('committed', transactionId);
		const hiddenRequests: Request[] = [];
		const fetchOrigin = vi.fn((input: Request | string | URL) => {
			const request =
				typeof input === 'string' || input instanceof URL ? new Request(input) : input;
			hiddenRequests.push(request);
			return new Promise<Response>((_resolve, reject) => {
				request.signal.addEventListener(
					'abort',
					() => reject(new DOMException('client disconnected', 'AbortError')),
					{ once: true }
				);
			});
		});
		const edge = createTrustedPagesReleaseEdge({
			fetchOrigin: fetchOrigin as typeof fetch,
			sourceSha
		});
		const controller = new AbortController();
		const pending = edge.fetch(
			new Request('https://commons.email/directory?audit=1', { signal: controller.signal }),
			runtime.env
		);

		await vi.waitFor(() => expect(fetchOrigin).toHaveBeenCalledOnce());
		expect(hiddenRequests[0].signal.aborted).toBe(false);
		controller.abort(new Error('caller left'));

		expect((await pending).status).toBe(503);
		expect(hiddenRequests[0].signal.aborted).toBe(true);
	});

	it('proves the exact post-C Access-fronted production origin chain without cache I/O', async () => {
		const transactionId = '123456789-27';
		const runtime = productionEnv(
			'committed',
			transactionId,
			originFetch(
				() =>
					new Response(
						JSON.stringify({
							releaseSha: sourceSha,
							transactionId,
							originAccessToken: 'absent',
							cacheApi: 'unavailable',
							externalIo: 0
						}),
						{ headers: { 'content-type': 'application/json' }, status: 200 }
					)
			)
		);
		const cache = new EdgeMemoryCache();
		const edge = createTrustedPagesReleaseEdge({
			cacheStorage: { open: vi.fn(async () => cache) },
			fetchOrigin: runtime.origin.fetch,
			sourceSha
		});

		const response = await edge.fetch(
			new Request('https://commons.email/api/release-origin', {
				headers: {
					accept: 'application/json',
					'cf-access-token': 'must-not-cross',
					'x-commons-release-origin-proof-secret': releaseOriginProofSecret,
					'x-commons-release-origin-purpose': 'post-commit-v1'
				}
			}),
			runtime.env
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			releaseSha: sourceSha,
			transactionId,
			originAccessToken: 'absent',
			cacheApi: 'unavailable',
			externalIo: 0
		});
		expect(runtime.gate.requests).toHaveLength(1);
		expect(runtime.origin.requests).toHaveLength(1);
		const forwarded = runtime.origin.requests[0];
		expect(forwarded.url).toBe('https://pages-origin.commons.email/api/release-origin');
		expect(forwarded.headers.get('accept')).toBe('application/json');
		expect(forwarded.headers.get('cf-access-token')).toBeNull();
		expect(forwarded.headers.get('x-commons-release-origin-proof-secret')).toBeNull();
		expect(forwarded.headers.get('x-commons-release-origin-purpose')).toBe('post-commit-v1');
		expect(forwarded.headers.get('x-commons-edge-release-sha')).toBe(sourceSha);
		expect(forwarded.headers.get('x-commons-edge-release-transaction')).toBe(transactionId);
		expect(cache.match).not.toHaveBeenCalled();
		expect(cache.put).not.toHaveBeenCalled();
	});

	it('bypasses pre-C negative memory for the exact post-commit origin proof', async () => {
		const transactionId = '123456789-29';
		let status: GateStatus = 'qualified';
		const gate = gateNamespace(() => status, transactionId);
		const origin = originFetch(
			() =>
				new Response(
					JSON.stringify({
						releaseSha: sourceSha,
						transactionId,
						originAccessToken: 'absent',
						cacheApi: 'unavailable',
						externalIo: 0
					}),
					{ headers: { 'content-type': 'application/json' }, status: 200 }
				)
		);
		const env = {
			PAGES_ORIGIN_ACCESS_TOKEN: pagesOriginAccessToken,
			PUBLIC_CONVEX_URL: 'https://quirky-chinchilla-352.convex.cloud',
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: gate.namespace,
			PUBLIC_RELEASE_TRANSACTION_ID: transactionId,
			RELEASE_ORIGIN_PROOF_SECRET: releaseOriginProofSecret
		};
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: origin.fetch });

		const beforeCommit = await edge.fetch(new Request('https://commons.email/directory'), env);
		expect(beforeCommit.status).toBe(503);
		expect(gate.requests).toHaveLength(1);
		expect(origin.fetch).not.toHaveBeenCalled();

		status = 'committed';
		const proof = await edge.fetch(
			new Request('https://commons.email/api/release-origin', {
				headers: {
					accept: 'application/json',
					'x-commons-release-origin-proof-secret': releaseOriginProofSecret,
					'x-commons-release-origin-purpose': 'post-commit-v1'
				}
			}),
			env
		);

		expect(proof.status).toBe(200);
		expect(gate.requests).toHaveLength(2);
		expect(origin.fetch).toHaveBeenCalledOnce();
	});

	it.each([['missing', null], ['wrong', 'w'.repeat(32)]] as const)(
		'rejects an exact production-origin proof with a %s deploy capability before authority I/O',
		async (_label, capability) => {
			const runtime = productionEnv('committed', '123456789-31');
			const edge = createTrustedPagesReleaseEdge({
				sourceSha,
				fetchOrigin: runtime.origin.fetch
			});
			const headers = new Headers({
				accept: 'application/json',
				'x-commons-release-origin-purpose': 'post-commit-v1'
			});
			if (capability) headers.set('x-commons-release-origin-proof-secret', capability);

			const response = await edge.fetch(
				new Request('https://commons.email/api/release-origin', { headers }),
				runtime.env
			);

			expect(response.status).toBe(421);
			expect(runtime.gate.requests).toHaveLength(0);
			expect(runtime.origin.fetch).not.toHaveBeenCalled();
		}
	);

	it('coalesces authenticated pre-C proof checks without granting a public I/O amplifier', async () => {
		const transactionId = '123456789-32';
		const requests: Request[] = [];
		let releaseGate!: () => void;
		const gateLatch = new Promise<void>((resolve) => {
			releaseGate = resolve;
		});
		const namespace = {
			idFromName: vi.fn((name: string) => name),
			get: vi.fn(() => ({
				fetch: vi.fn(async (request: Request) => {
					requests.push(request);
					await gateLatch;
					return new Response(null, {
						status: 200,
						headers: {
							'x-public-discovery-refresh-gate-protocol': '3',
							'x-public-template-og-release-sha': sourceSha,
							'x-public-template-og-release-transaction': transactionId,
							'x-commons-release-authority-status': 'qualified'
						}
					});
				})
			}))
		};
		const origin = originFetch();
		const env = {
			PAGES_ORIGIN_ACCESS_TOKEN: pagesOriginAccessToken,
			PUBLIC_CONVEX_URL: 'https://quirky-chinchilla-352.convex.cloud',
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: namespace,
			PUBLIC_RELEASE_TRANSACTION_ID: transactionId,
			RELEASE_ORIGIN_PROOF_SECRET: releaseOriginProofSecret
		};
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: origin.fetch });
		const proofRequest = () =>
			edge.fetch(
				new Request('https://commons.email/api/release-origin', {
					headers: {
						accept: 'application/json',
						'x-commons-release-origin-proof-secret': releaseOriginProofSecret,
						'x-commons-release-origin-purpose': 'post-commit-v1'
					}
				}),
				env
			);
		const responses = Array.from({ length: 25 }, () => proofRequest());

		await vi.waitFor(() => expect(requests).toHaveLength(1));
		releaseGate();
		await expect(Promise.all(responses).then((items) => items.map((item) => item.status))).resolves.toEqual(
			Array.from({ length: 25 }, () => 503)
		);
		expect(requests).toHaveLength(2);
		expect(origin.fetch).not.toHaveBeenCalled();
	});

	it('retries one coalesced proof generation across a pre-C snapshot race', async () => {
		const transactionId = '123456789-33';
		let status: GateStatus = 'qualified';
		let authorityCalls = 0;
		let releaseFirst!: () => void;
		const firstResponseLatch = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const namespace = {
			idFromName: vi.fn((name: string) => name),
			get: vi.fn(() => ({
				fetch: vi.fn(async () => {
					authorityCalls += 1;
					const snapshot = status;
					if (authorityCalls === 1) await firstResponseLatch;
					return new Response(null, {
						status: 200,
						headers: {
							'x-public-discovery-refresh-gate-protocol': '3',
							'x-public-template-og-release-sha': sourceSha,
							'x-public-template-og-release-transaction': transactionId,
							'x-commons-release-authority-status': snapshot
						}
					});
				})
			}))
		};
		const origin = originFetch(
			() =>
				new Response(
					JSON.stringify({
						releaseSha: sourceSha,
						transactionId,
						originAccessToken: 'absent',
						cacheApi: 'unavailable',
						externalIo: 0
					}),
					{ headers: { 'content-type': 'application/json' }, status: 200 }
				)
		);
		const env = {
			PAGES_ORIGIN_ACCESS_TOKEN: pagesOriginAccessToken,
			PUBLIC_CONVEX_URL: 'https://quirky-chinchilla-352.convex.cloud',
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: namespace,
			PUBLIC_RELEASE_TRANSACTION_ID: transactionId,
			RELEASE_ORIGIN_PROOF_SECRET: releaseOriginProofSecret
		};
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: origin.fetch });
		const proofRequest = () =>
			edge.fetch(
				new Request('https://commons.email/api/release-origin', {
					headers: {
						accept: 'application/json',
						'x-commons-release-origin-proof-secret': releaseOriginProofSecret,
						'x-commons-release-origin-purpose': 'post-commit-v1'
					}
				}),
				env
			);

		const beforeCommit = proofRequest();
		await vi.waitFor(() => expect(authorityCalls).toBe(1));
		status = 'committed';
		const afterCommit = proofRequest();
		releaseFirst();

		await expect(Promise.all([beforeCommit, afterCommit]).then((items) => items.map((item) => item.status))).resolves.toEqual([
			200,
			200
		]);
		expect(authorityCalls).toBe(2);
		expect(origin.fetch).toHaveBeenCalledTimes(2);
	});

	it('uses the second coalesced proof attempt after a transient authority failure', async () => {
		const transactionId = '123456789-34';
		let authorityCalls = 0;
		const namespace = {
			idFromName: vi.fn((name: string) => name),
			get: vi.fn(() => ({
				fetch: vi.fn(async () => {
					authorityCalls += 1;
					if (authorityCalls === 1) throw new Error('transient authority failure');
					return new Response(null, {
						status: 200,
						headers: {
							'x-public-discovery-refresh-gate-protocol': '3',
							'x-public-template-og-release-sha': sourceSha,
							'x-public-template-og-release-transaction': transactionId,
							'x-commons-release-authority-status': 'committed'
						}
					});
				})
			}))
		};
		const origin = originFetch(
			() =>
				new Response(
					JSON.stringify({
						releaseSha: sourceSha,
						transactionId,
						originAccessToken: 'absent',
						cacheApi: 'unavailable',
						externalIo: 0
					}),
					{ headers: { 'content-type': 'application/json' }, status: 200 }
				)
		);
		const env = {
			PAGES_ORIGIN_ACCESS_TOKEN: pagesOriginAccessToken,
			PUBLIC_CONVEX_URL: 'https://quirky-chinchilla-352.convex.cloud',
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: namespace,
			PUBLIC_RELEASE_TRANSACTION_ID: transactionId,
			RELEASE_ORIGIN_PROOF_SECRET: releaseOriginProofSecret
		};
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: origin.fetch });

		const response = await edge.fetch(
			new Request('https://commons.email/api/release-origin', {
				headers: {
					accept: 'application/json',
					'x-commons-release-origin-proof-secret': releaseOriginProofSecret,
					'x-commons-release-origin-purpose': 'post-commit-v1'
				}
			}),
			env
		);

		expect(response.status).toBe(200);
		expect(authorityCalls).toBe(2);
		expect(origin.fetch).toHaveBeenCalledOnce();
	});

	it('rejects malformed production-origin proof requests before release or origin I/O', async () => {
		const runtime = productionEnv('committed', '123456789-28');
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: runtime.origin.fetch });

		const response = await edge.fetch(
			new Request('https://commons.email/api/release-origin', {
				headers: { accept: 'application/json' }
			}),
			runtime.env
		);

		expect(response.status).toBe(421);
		expect(runtime.gate.requests).toHaveLength(0);
		expect(runtime.origin.fetch).not.toHaveBeenCalled();
	});

	it('remembers terminal C per exact release and isolate', async () => {
		const transactionId = '123456789-21';
		const runtime = productionEnv('committed', transactionId);
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: runtime.origin.fetch });

		await edge.fetch(new Request('https://commons.email/first'), runtime.env);
		await edge.fetch(new Request('https://commons.email/second'), runtime.env);

		expect(runtime.gate.requests).toHaveLength(1);
		expect(runtime.origin.fetch).toHaveBeenCalledTimes(2);
	});

	it('caches only the anonymous landing response after terminal C succeeds', async () => {
		const transactionId = '123456789-25';
		const runtime = productionEnv(
			'committed',
			transactionId,
			originFetch(
				() =>
					new Response('<html>landing</html>', {
						headers: { 'content-type': 'text/html; charset=utf-8' }
					})
			)
		);
		const cache = new EdgeMemoryCache();
		const cacheStorage = { open: vi.fn(async () => cache) };
		const context = edgeContext();
		const edge = createTrustedPagesReleaseEdge({
			cacheStorage,
			fetchOrigin: runtime.origin.fetch,
			sourceSha
		});

		const first = await edge.fetch(
			new Request('https://commons.email/'),
			runtime.env,
			context
		);
		await context.flush();
		const second = await edge.fetch(
			new Request('https://commons.email/'),
			runtime.env,
			context
		);

		expect(await first.text()).toBe('<html>landing</html>');
		expect(await second.text()).toBe('<html>landing</html>');
		expect(second.headers.get('cache-control')).toBe(
			'public, max-age=60, stale-while-revalidate=300'
		);
		expect(second.headers.get('cache-tag')).toBe('public-discovery');
		expect(first.headers.get('x-commons-public-discovery-cache')).toBe('miss');
		expect(second.headers.get('x-commons-public-discovery-cache')).toBe('hit');
		expect(runtime.gate.requests).toHaveLength(1);
		expect(runtime.origin.fetch).toHaveBeenCalledOnce();
		expect(cacheStorage.open).toHaveBeenCalledOnce();
	});

	it('canonicalizes anonymous landing representation headers before caching', async () => {
		const transactionId = '123456789-37';
		const runtime = productionEnv('committed', transactionId);
		const hiddenRequests: Request[] = [];
		const fetchOrigin = vi.fn(async (input: Request | string | URL) => {
			const request =
				typeof input === 'string' || input instanceof URL ? new Request(input) : input;
			hiddenRequests.push(request);
			return new Response(
				request.headers.get('user-agent') === 'special-bot'
					? 'variant-for-special-bot'
					: 'canonical-landing',
				{
					headers: {
						'content-type': 'text/html; charset=utf-8',
						vary: 'Accept-Encoding'
					}
				}
			);
		});
		const cache = new EdgeMemoryCache();
		const context = edgeContext();
		const edge = createTrustedPagesReleaseEdge({
			cacheStorage: { open: vi.fn(async () => cache) },
			fetchOrigin: fetchOrigin as typeof fetch,
			sourceSha
		});

		const first = await edge.fetch(
			new Request('https://commons.email/', {
				headers: {
					accept: 'text/html;q=0.1, */*;q=1',
					'accept-language': 'xx-attacker',
					'sec-ch-ua': 'attacker-client-hint',
					'user-agent': 'special-bot'
				}
			}),
			runtime.env,
			context
		);
		await context.flush();
		const second = await edge.fetch(
			new Request('https://commons.email/', { headers: { 'user-agent': 'normal-browser' } }),
			runtime.env,
			context
		);

		expect(await first.text()).toBe('canonical-landing');
		expect(await second.text()).toBe('canonical-landing');
		expect(fetchOrigin).toHaveBeenCalledOnce();
		expect(hiddenRequests).toHaveLength(1);
		const canonical = hiddenRequests[0];
		expect(canonical.headers.get('accept')).toBe('text/html, application/xhtml+xml');
		expect(canonical.headers.get('accept-encoding')).toBe('gzip');
		expect(canonical.headers.get('accept-language')).toBeNull();
		expect(canonical.headers.get('sec-ch-ua')).toBeNull();
		expect(canonical.headers.get('user-agent')).toBeNull();
	});

	it('propagates a sole landing caller disconnect to the hidden origin', async () => {
		const transactionId = '123456789-38';
		const runtime = productionEnv('committed', transactionId);
		const cache = new EdgeMemoryCache();
		const hiddenRequests: Request[] = [];
		const fetchOrigin = vi
			.fn<(input: Request | string | URL) => Promise<Response>>()
			.mockImplementationOnce((input) => {
				const request =
					typeof input === 'string' || input instanceof URL ? new Request(input) : input;
				hiddenRequests.push(request);
				return new Promise<Response>((_resolve, reject) => {
					request.signal.addEventListener(
						'abort',
						() => reject(new DOMException('client disconnected', 'AbortError')),
						{ once: true }
					);
				});
			})
			.mockImplementationOnce(async (input) => {
				const request =
					typeof input === 'string' || input instanceof URL ? new Request(input) : input;
				hiddenRequests.push(request);
				return new Response('<html>recovered</html>', {
					headers: { 'content-type': 'text/html; charset=utf-8' }
				});
			});
		const edge = createTrustedPagesReleaseEdge({
			cacheStorage: { open: vi.fn(async () => cache) },
			fetchOrigin: fetchOrigin as typeof fetch,
			sourceSha
		});
		const controller = new AbortController();
		const pending = edge.fetch(
			new Request('https://commons.email/', { signal: controller.signal }),
			runtime.env
		);

		await vi.waitFor(() => expect(fetchOrigin).toHaveBeenCalledOnce());
		expect(hiddenRequests[0].signal.aborted).toBe(false);
		controller.abort(new Error('caller left'));
		expect((await pending).status).toBe(503);
		expect(hiddenRequests[0].signal.aborted).toBe(true);

		const recovered = await edge.fetch(new Request('https://commons.email/'), runtime.env);
		expect(await recovered.text()).toBe('<html>recovered</html>');
		expect(fetchOrigin).toHaveBeenCalledTimes(2);
	});

	it('propagates the cache origin deadline to the hidden-origin request and quarantines ignored aborts', async () => {
		vi.useFakeTimers();
		try {
			const transactionId = '123456789-35';
			const runtime = productionEnv('committed', transactionId);
			const cache = new EdgeMemoryCache();
			let settleFirstRaw!: (response: Response) => void;
			const firstRaw = new Promise<Response>((resolve) => {
				settleFirstRaw = resolve;
			});
			const originRequests: Request[] = [];
			const fetchOrigin = vi
				.fn<(request: Request | string | URL) => Promise<Response>>()
				.mockImplementationOnce((request) => {
					originRequests.push(
						typeof request === 'string' || request instanceof URL
							? new Request(request)
							: request
					);
					return firstRaw;
				})
				.mockImplementationOnce(async (request) => {
					originRequests.push(
						typeof request === 'string' || request instanceof URL
							? new Request(request)
							: request
					);
					return new Response('<html>recovered</html>', {
						headers: { 'content-type': 'text/html; charset=utf-8' }
					});
				});
			const edge = createTrustedPagesReleaseEdge({
				cacheStorage: { open: vi.fn(async () => cache) },
				fetchOrigin: fetchOrigin as typeof fetch,
				sourceSha
			});
			const request = () =>
				edge.fetch(new Request('https://commons.email/'), runtime.env);

			const first = request();
			await vi.advanceTimersByTimeAsync(0);
			expect(fetchOrigin).toHaveBeenCalledOnce();
			expect(originRequests).toHaveLength(1);
			const firstHiddenOrigin = originRequests[0];
			expect(firstHiddenOrigin.url).toBe('https://pages-origin.commons.email/');
			expect(firstHiddenOrigin.signal.aborted).toBe(false);

			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.originFetchTimeoutMs
			);
			expect((await first).status).toBe(503);
			expect(firstHiddenOrigin.signal.aborted).toBe(true);

			// The mock deliberately ignores Request.signal. Its raw fetch therefore
			// remains the one quarantined generation instead of admitting overlap.
			expect((await request()).status).toBe(503);
			await vi.advanceTimersByTimeAsync(
				TRUSTED_PAGES_RELEASE_CACHE_POLICY.originFetchTimeoutMs
			);
			expect((await request()).status).toBe(503);
			expect(fetchOrigin).toHaveBeenCalledOnce();

			settleFirstRaw(
				new Response('<html>late</html>', {
					headers: { 'content-type': 'text/html; charset=utf-8' }
				})
			);
			await vi.advanceTimersByTimeAsync(0);

			const recovered = await request();
			expect(await recovered.text()).toBe('<html>recovered</html>');
			expect(fetchOrigin).toHaveBeenCalledTimes(2);
			expect(originRequests[1].signal.aborted).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('never consults the landing cache before terminal release authority', async () => {
		const runtime = productionEnv('qualified', '123456789-26');
		const cache = new EdgeMemoryCache();
		const edge = createTrustedPagesReleaseEdge({
			cacheStorage: { open: vi.fn(async () => cache) },
			fetchOrigin: runtime.origin.fetch,
			sourceSha
		});

		const response = await edge.fetch(new Request('https://commons.email/'), runtime.env);

		expect(response.status).toBe(503);
		expect(cache.match).not.toHaveBeenCalled();
		expect(cache.put).not.toHaveBeenCalled();
		expect(runtime.origin.fetch).not.toHaveBeenCalled();
	});

	it('rewrites exact hidden-origin redirects back to the public authority', async () => {
		const runtime = productionEnv(
			'committed',
			'123456789-22',
			originFetch(
				() =>
					new Response(null, {
						status: 302,
						headers: { location: 'https://pages-origin.commons.email/account?next=%2F' }
					})
			)
		);
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: runtime.origin.fetch });

		const response = await edge.fetch(new Request('https://commons.email/login'), runtime.env);

		expect(response.headers.get('location')).toBe('https://commons.email/account?next=%2F');
	});

	it('proves the exact staging candidate without forwarding its probe capability', async () => {
		const runtime = stagingEnv();
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: runtime.origin.fetch });
		const response = await edge.fetch(
			new Request('https://staging.commons.email/api/release-candidate', {
				headers: {
					'x-release-probe-secret': releaseProbeSecret,
					'x-expected-release-sha': sourceSha,
					'x-expected-release-transaction': defaultTransaction
				}
			}),
			runtime.env
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			proof: 'candidate-fetch-completed',
			release: { sha: sourceSha, transactionId: defaultTransaction },
			status: 'ok'
		});
		expect(runtime.origin.requests).toHaveLength(1);
		const forwarded = runtime.origin.requests[0];
		expect(forwarded.url).toBe(
			'https://pages-origin-staging.commons.email/api/release-candidate'
		);
		expect(forwarded.headers.get('x-release-probe-secret')).toBeNull();
		expect(forwarded.headers.get('x-commons-pages-origin-access')).toBe(
			pagesOriginAccessToken
		);
		expect(forwarded.headers.get('authorization')).toBeNull();
		expect(forwarded.headers.get('cookie')).toBeNull();
		expect(forwarded.headers.get('x-commons-edge-public-host')).toBe(
			'staging.commons.email'
		);
	});

	it('rejects staging probes with a wrong tuple before any origin execution', async () => {
		const runtime = stagingEnv();
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: runtime.origin.fetch });

		const response = await edge.fetch(
			new Request('https://staging.commons.email/api/release-candidate', {
				headers: {
					'x-release-probe-secret': releaseProbeSecret,
					'x-expected-release-sha': sourceSha,
					'x-expected-release-transaction': '123456789-99'
				}
			}),
			runtime.env
		);

		expect(response.status).toBe(421);
		expect(runtime.origin.fetch).not.toHaveBeenCalled();
	});

	it('fails closed when either edge realm gains an undeclared capability', async () => {
		const production = productionEnv('committed', '123456789-23');
		const staging = stagingEnv();
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: production.origin.fetch });

		const productionResponse = await edge.fetch(
			new Request('https://commons.email/'),
			{ ...production.env, INTERNAL_API_SECRET: 'i'.repeat(32) }
		);
		const stagingResponse = await edge.fetch(
			new Request('https://staging.commons.email/api/live'),
			{ ...staging.env, PUBLIC_DISCOVERY_R2: {} }
		);

		expect(productionResponse.status).toBe(503);
		expect(stagingResponse.status).toBe(503);
		expect(production.gate.requests).toHaveLength(0);
		expect(production.origin.fetch).not.toHaveBeenCalled();
		expect(staging.origin.fetch).not.toHaveBeenCalled();
	});

	it.each([
		'http://commons.email/',
		'http://staging.commons.email/',
		'https://commons.email:8443/'
	])('rejects a non-canonical public authority before credential-bearing I/O: %s', async (url) => {
		const runtime = productionEnv('committed', '123456789-39');
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: runtime.origin.fetch });

		const response = await edge.fetch(new Request(url), runtime.env);

		expect(response.status).toBe(421);
		expect(runtime.gate.requests).toHaveLength(0);
		expect(runtime.origin.fetch).not.toHaveBeenCalled();
	});

	it.each([
		'https://pages-origin.commons.email/',
		'https://pages-origin-staging.commons.email/',
		'https://communique-site.pages.dev/',
		'https://attacker.example/'
	])('never accepts a non-public edge hostname: %s', async (url) => {
		const runtime = productionEnv('committed', '123456789-24');
		const edge = createTrustedPagesReleaseEdge({ sourceSha, fetchOrigin: runtime.origin.fetch });

		const response = await edge.fetch(new Request(url), runtime.env);

		expect(response.status).toBe(421);
		expect(runtime.gate.requests).toHaveLength(0);
		expect(runtime.origin.fetch).not.toHaveBeenCalled();
	});
});
