import { describe, expect, it, vi } from 'vitest';
import { handlePublicDiscoveryManifestRefreshCapability } from '$lib/server/public-discovery-manifest-refresh-hook';
import { PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX } from '$lib/server/public-template-og-queue';
import hooksSource from '../../../src/hooks.server.ts?raw';
import {
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE
} from '$lib/server/public-discovery-bootstrap-runtime';

const activeSecret = 'manifest-refresh-active-'.padEnd(64, 'a');
const internalSecret = 'internal-release-seed-'.padEnd(64, 'i');
const backend = 'https://production.example.convex.cloud';
const releaseSha = import.meta.env.VITE_RELEASE_SHA as string;
const releaseTransactionId = '123456789-2';
const gateLease = '00000000-0000-4000-8000-000000000001';
const bootstrapLease = '00000000-0000-4000-8000-000000000077';

function authorizeBootstrap(route: ReturnType<typeof hookInput>) {
	const headers = route.event.request.headers;
	headers.set(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER, PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL);
	headers.set(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER, bootstrapLease);
	headers.set(PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER, PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE);
	headers.set('content-type', 'application/json');
	headers.set('x-commons-candidate-origin-host', 'pages-origin.commons.email');
	headers.set('x-commons-edge-public-host', 'commons.email');
	headers.set('x-commons-edge-release-sha', releaseSha);
	headers.set('x-commons-edge-release-transaction', releaseTransactionId);
	headers.set('x-expected-release-sha', releaseSha);
	headers.set('x-expected-release-transaction', releaseTransactionId);
	headers.set('x-forwarded-host', 'commons.email');
	headers.set('x-forwarded-proto', 'https');
	headers.set('x-internal-secret', internalSecret);
	headers.set('x-public-discovery-refresh-purpose', 'deploy-seed');
}

function gateDouble(
	fetch: ReturnType<typeof vi.fn> = vi.fn(
		async (request?: Request) => {
			const completion = request && new URL(request.url).pathname === '/complete';
			return new Response(null, {
				status: 200,
				headers: {
					'x-public-discovery-refresh-gate-protocol': '3',
					...(completion ? {} : { 'x-public-discovery-refresh-lease': gateLease })
				}
			});
		}
	)
) {
	const id = { toString: () => 'backend-gate-id' } as DurableObjectId;
	const get = vi.fn((_id: DurableObjectId) => ({ fetch }));
	const idFromName = vi.fn((_name: string) => id);
	return {
		fetch,
		get,
		idFromName,
		namespace: { get, idFromName } as DurableObjectNamespace
	};
}

function hookInput({
	gate = gateDouble(),
	method = 'POST',
	presented,
	path = '/api/internal/public-discovery-manifest-refresh',
	publicConvexUrl = backend,
	resolve = vi.fn(async () => new Response(null, { status: 204 }))
}: {
	gate?: ReturnType<typeof gateDouble> | null;
	method?: string;
	presented?: string;
	path?: string;
	publicConvexUrl?: string;
	resolve?: ReturnType<typeof vi.fn>;
}) {
	const headers = new Headers({ cookie: 'auth-session=valid-looking-session-cookie' });
	if (presented !== undefined) {
		headers.set('x-public-discovery-manifest-refresh-secret', presented);
	}
	const request = new Request(`https://commons.email${path}`, { method, headers });
	const locals: App.Locals = { session: null, user: null };
	const event = {
		locals,
		platform: {
			env: {
				DISCOVERY_MANIFEST_REFRESH_SECRET: activeSecret,
				INTERNAL_API_SECRET: internalSecret,
				PUBLIC_CONVEX_URL: publicConvexUrl,
				PUBLIC_RELEASE_TRANSACTION_ID: releaseTransactionId,
				...(gate ? { PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: gate.namespace } : {}),
				PUBLIC_DISCOVERY_R2: { get: vi.fn(), put: vi.fn(), delete: vi.fn() }
			}
		},
		request,
		url: new URL(request.url)
	};
	return { event, gate, locals, resolve };
}

describe('manifest refresh outer capability hook', () => {
	it('rejects a bad capability before a valid-looking session can reach dependency work', async () => {
		const route = hookInput({ presented: 'attacker-secret'.padEnd(64, 'x') });

		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: route.resolve as never
		});

		expect(response.status).toBe(401);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(route.resolve).not.toHaveBeenCalled();
		expect(route.gate?.idFromName).not.toHaveBeenCalled();
		expect(route.event.platform.env.PUBLIC_DISCOVERY_R2.get).not.toHaveBeenCalled();
		expect(route.event.platform.env.PUBLIC_DISCOVERY_R2.put).not.toHaveBeenCalled();
	});

	it('rejects unsupported methods without entering the session chain', async () => {
		const route = hookInput({ method: 'GET', presented: activeSecret });
		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: route.resolve as never
		});

		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
		expect(route.resolve).not.toHaveBeenCalled();
		expect(route.gate?.idFromName).not.toHaveBeenCalled();
	});

	it('marks the exact capability so general session authentication bypasses Convex', async () => {
		const route = hookInput({ presented: activeSecret });
		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: route.resolve as never
		});

		expect(response.status).toBe(204);
		expect(response.headers.get('x-public-discovery-refresh-gate-protocol')).toBe('3');
		expect(route.locals.publicDiscoveryManifestRefreshAuthenticated).toBe(true);
		expect(route.resolve).toHaveBeenCalledOnce();
		expect(route.gate?.idFromName).toHaveBeenCalledWith(`backend=${backend}`);
		expect(route.gate?.get).toHaveBeenCalledOnce();
		expect(route.gate?.fetch).toHaveBeenCalledTimes(2);
		expect(new URL((route.gate?.fetch.mock.calls[1]?.[0] as Request).url).pathname).toBe(
			'/complete'
		);
	});

	it('plumbs an atomic Queue-attempt reservation callback bound to the admitted lease', async () => {
		const fetch = vi.fn(async (request: Request) => {
			const pathname = new URL(request.url).pathname;
			if (pathname === '/reserve') {
				return new Response(null, {
					headers: {
						'x-public-discovery-refresh-gate-protocol': '3',
						'x-public-discovery-refresh-lease': gateLease
					},
					status: 200
				});
			}
			if (pathname === '/reserve-og-queue-attempts') {
				return Response.json(
					{
						remaining: PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX - 2,
						resetAtMs: Date.UTC(2026, 6, 21),
						status: 'reserved'
					},
					{
						headers: { 'x-public-discovery-refresh-gate-protocol': '3' },
						status: 200
					}
				);
			}
			return new Response(null, {
				headers: { 'x-public-discovery-refresh-gate-protocol': '3' },
				status: 200
			});
		});
		const messageKeys = [
			'https://production.example.convex.cloud|template-one|7|1',
			'https://production.example.convex.cloud|template-two|8|1'
		];
		const resolve = vi.fn(async (event: { locals: App.Locals }) => {
			await expect(
				event.locals.reservePublicTemplateOgQueueAttempts?.(messageKeys)
			).resolves.toEqual({
				remaining: PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX - 2,
				resetAtMs: Date.UTC(2026, 6, 21),
				status: 'reserved'
			});
			return new Response(null, { status: 204 });
		});
		const route = hookInput({ gate: gateDouble(fetch), presented: activeSecret, resolve });

		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: resolve as never
		});

		expect(response.status).toBe(204);
		expect(fetch.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([
			'/reserve',
			'/reserve-og-queue-attempts',
			'/complete'
		]);
		const budgetRequest = fetch.mock.calls[1]?.[0];
		await expect(budgetRequest?.json()).resolves.toEqual({
			leaseId: gateLease,
			messageKeys,
			sourceSha: releaseSha,
			transactionId: releaseTransactionId
		});
	});

	it('propagates a typed 429 Queue-attempt exhaustion without weakening the gate protocol', async () => {
		const fetch = vi.fn(async (request: Request) => {
			const pathname = new URL(request.url).pathname;
			if (pathname === '/reserve') {
				return new Response(null, {
					headers: {
						'x-public-discovery-refresh-gate-protocol': '3',
						'x-public-discovery-refresh-lease': gateLease
					},
					status: 200
				});
			}
			if (pathname === '/reserve-og-queue-attempts') {
				return Response.json(
					{ remaining: 0, resetAtMs: Date.UTC(2026, 6, 21), status: 'exhausted' },
					{
						headers: { 'x-public-discovery-refresh-gate-protocol': '3' },
						status: 429
					}
				);
			}
			return new Response(null, {
				headers: { 'x-public-discovery-refresh-gate-protocol': '3' },
				status: 200
			});
		});
		const resolve = vi.fn(async (event: { locals: App.Locals }) => {
			await expect(
				event.locals.reservePublicTemplateOgQueueAttempts?.([
					'https://production.example.convex.cloud|template-one|7|1'
				])
			).resolves.toEqual({
				remaining: 0,
				resetAtMs: Date.UTC(2026, 6, 21),
				status: 'exhausted'
			});
			return new Response(null, { status: 204 });
		});
		const route = hookInput({ gate: gateDouble(fetch), presented: activeSecret, resolve });

		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: resolve as never
		});

		expect(response.status).toBe(204);
		expect(fetch.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([
			'/reserve',
			'/reserve-og-queue-attempts',
			'/complete'
		]);
	});

	it('rejects malformed, oversized, or unavailable Queue-attempt responses fail closed', async () => {
		const cases: Array<{
			expected: string;
			reservation: () => Response;
		}> = [
			{
				expected: 'PUBLIC_TEMPLATE_OG_QUEUE_DAILY_BUDGET_PROTOCOL',
				reservation: () =>
					Response.json(
						{ remaining: 1, resetAtMs: Date.UTC(2026, 6, 21), status: 'exhausted' },
						{
							headers: { 'x-public-discovery-refresh-gate-protocol': '3' },
							status: 429
						}
					)
			},
			{
				expected: 'PUBLIC_TEMPLATE_OG_QUEUE_DAILY_BUDGET_PROTOCOL',
				reservation: () =>
					new Response('x'.repeat(513), {
						headers: { 'x-public-discovery-refresh-gate-protocol': '3' },
						status: 200
					})
			},
			{
				expected: 'PUBLIC_TEMPLATE_OG_QUEUE_DAILY_BUDGET_UNAVAILABLE',
				reservation: () =>
					new Response(null, {
						headers: { 'x-public-discovery-refresh-gate-protocol': '3' },
						status: 503
					})
			}
		];

		for (const testCase of cases) {
			const fetch = vi.fn(async (request: Request) => {
				const pathname = new URL(request.url).pathname;
				if (pathname === '/reserve') {
					return new Response(null, {
						headers: {
							'x-public-discovery-refresh-gate-protocol': '3',
							'x-public-discovery-refresh-lease': gateLease
						},
						status: 200
					});
				}
				if (pathname === '/reserve-og-queue-attempts') return testCase.reservation();
				return new Response(null, {
					headers: { 'x-public-discovery-refresh-gate-protocol': '3' },
					status: 200
				});
			});
			const resolve = vi.fn(async (event: { locals: App.Locals }) => {
				await expect(
					event.locals.reservePublicTemplateOgQueueAttempts?.([
						'https://production.example.convex.cloud|template-one|7|1'
					])
				).rejects.toThrow(testCase.expected);
				return new Response(null, { status: 204 });
			});
			const route = hookInput({ gate: gateDouble(fetch), presented: activeSecret, resolve });

			const response = await handlePublicDiscoveryManifestRefreshCapability({
				event: route.event as never,
				resolve: resolve as never
			});

			expect(response.status).toBe(204);
			expect(fetch).toHaveBeenCalledTimes(3);
		}
	});

	it('fails closed before resolve when the backend realm or gate binding is unavailable', async () => {
		const missing = hookInput({ gate: null, presented: activeSecret });
		const missingResponse = await handlePublicDiscoveryManifestRefreshCapability({
			event: missing.event as never,
			resolve: missing.resolve as never
		});
		expect(missingResponse.status).toBe(503);
		expect(missing.resolve).not.toHaveBeenCalled();

		const invalidBackend = hookInput({
			presented: activeSecret,
			publicConvexUrl: 'https://production.example.convex.cloud/unsafe'
		});
		const invalidResponse = await handlePublicDiscoveryManifestRefreshCapability({
			event: invalidBackend.event as never,
			resolve: invalidBackend.resolve as never
		});
		expect(invalidResponse.status).toBe(503);
		expect(invalidBackend.gate?.idFromName).not.toHaveBeenCalled();
		expect(invalidBackend.resolve).not.toHaveBeenCalled();
	});

	it('fails closed when the named Durable Object cannot reserve', async () => {
		const gate = gateDouble(vi.fn().mockRejectedValue(new Error('Durable Object unavailable')));
		const route = hookInput({ gate, presented: activeSecret });

		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: route.resolve as never
		});

		expect(response.status).toBe(503);
		expect(route.resolve).not.toHaveBeenCalled();
		expect(route.event.platform.env.PUBLIC_DISCOVERY_R2.get).not.toHaveBeenCalled();
		expect(route.event.platform.env.PUBLIC_DISCOVERY_R2.put).not.toHaveBeenCalled();
	});

	it('bounds a stalled gate to 750ms and fails closed on deadline abort', async () => {
		const timeoutSignal = AbortSignal.abort(new DOMException('deadline', 'TimeoutError'));
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
		const fetch = vi.fn(async (request: Request) => {
			if (request.signal.aborted) throw request.signal.reason;
			return new Response(null, {
				headers: { 'x-public-discovery-refresh-gate-protocol': '3' },
				status: 200
			});
		});
		const route = hookInput({ gate: gateDouble(fetch), presented: activeSecret });

		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: route.resolve as never
		});

		expect(response.status).toBe(503);
		expect(timeout).toHaveBeenCalledWith(750);
		expect(route.resolve).not.toHaveBeenCalled();
		timeout.mockRestore();
	});

	it('admits one of 100 valid-secret requests and safely coalesces the other 99', async () => {
		let reservations = 0;
		const gate = gateDouble(
			vi.fn(
				async (request: Request) => {
					if (new URL(request.url).pathname === '/complete') {
						return new Response(null, {
							status: 200,
							headers: { 'x-public-discovery-refresh-gate-protocol': '3' }
						});
					}
					return new Response(null, {
						status: reservations++ === 0 ? 200 : 202,
						headers: {
							'retry-after': '60',
							'x-public-discovery-refresh-gate-protocol': '3',
							...(reservations === 1
								? { 'x-public-discovery-refresh-lease': gateLease }
								: {})
						}
					});
				}
			)
		);
		const resolve = vi.fn(async () => new Response(null, { status: 204 }));
		const routes = Array.from({ length: 100 }, () =>
			hookInput({ gate, presented: activeSecret, resolve })
		);

		const responses: Response[] = [];
		for (const route of routes) {
			responses.push(
				await handlePublicDiscoveryManifestRefreshCapability({
					event: route.event as never,
					resolve: resolve as never
				})
			);
		}

		expect(responses.filter((response) => response.status === 204)).toHaveLength(1);
		expect(responses.filter((response) => response.status === 202)).toHaveLength(99);
		expect(resolve).toHaveBeenCalledOnce();
		expect(new Set(gate.idFromName.mock.calls.map((call) => String(call[0])))).toEqual(
			new Set([`backend=${backend}`])
		);
		for (const route of routes) {
			expect(route.event.platform.env.PUBLIC_DISCOVERY_R2.get).not.toHaveBeenCalled();
			expect(route.event.platform.env.PUBLIC_DISCOVERY_R2.put).not.toHaveBeenCalled();
		}
	});

	it('propagates bounded seed priority and retry timing without entering dependency work', async () => {
		const fetch = vi.fn(
			async (_request: Request) =>
				new Response(null, {
					status: 202,
					headers: {
						'retry-after': '37',
						'x-public-discovery-refresh-gate-protocol': '3'
					}
				})
		);
		const gate = gateDouble(fetch);
		const route = hookInput({ gate, presented: activeSecret });
		route.event.request.headers.set('x-public-discovery-refresh-purpose', 'deploy-seed');
		route.event.request.headers.set('x-expected-release-sha', releaseSha);
		route.event.request.headers.set('x-expected-release-transaction', releaseTransactionId);
		route.event.request.headers.set('x-internal-secret', internalSecret);

		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: route.resolve as never
		});

		expect(response.status).toBe(202);
		expect(response.headers.get('retry-after')).toBe('37');
		expect(response.headers.get('x-public-discovery-refresh-gate-protocol')).toBe('3');
		await expect(response.json()).resolves.toEqual({
			coalesced: true,
			gateProtocol: '3',
			ok: true,
			retryAfterSeconds: 37
		});
		const gateRequest = fetch.mock.calls[0]?.[0] as Request;
		expect(gateRequest.headers.get('x-public-discovery-refresh-purpose')).toBe('deploy-seed');
		expect(route.resolve).not.toHaveBeenCalled();
	});

	it('forwards only the producer continuation purpose into the gate reservation', async () => {
		const gate = gateDouble();
		const route = hookInput({ gate, presented: activeSecret });
		route.event.request.headers.set(
			'x-public-discovery-refresh-purpose',
			'page-backfill-continuation'
		);

		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: route.resolve as never
		});

		expect(response.status).toBe(204);
		const gateRequest = gate.fetch.mock.calls[0]?.[0] as Request;
		expect(gateRequest.headers.get('x-public-discovery-refresh-purpose')).toBe(
			'page-backfill-continuation'
		);
		expect(gateRequest.headers.get('x-public-discovery-page-backfill-continuation')).toBe('1');
	});

	it('reports only the resolved typed incomplete response against the one-shot lease', async () => {
		const gate = gateDouble();
		const resolve = vi.fn(
			async () =>
				new Response(null, {
					status: 202,
					headers: {
						'x-public-discovery-page-backfill-continuation': '1',
						'retry-after': '120'
					}
				})
		);
		const route = hookInput({ gate, presented: activeSecret, resolve });
		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: route.resolve as never
		});
		expect(response.status).toBe(202);
		const completion = gate.fetch.mock.calls[1]?.[0] as Request;
		expect(new URL(completion.url).pathname).toBe('/complete');
		expect(completion.headers.get('x-public-discovery-refresh-lease')).toBe(gateLease);
		expect(completion.headers.get('x-public-discovery-refresh-completion')).toBe('incomplete');
	});

	it('binds bootstrap Queue work and terminal completion to one adapter-attested ready proof', async () => {
		const generation = 'list=7:0;relations=8:0';
		const fetch = vi.fn(async (request: Request) => {
			const pathname = new URL(request.url).pathname;
			if (pathname === '/reserve') {
				return new Response(null, {
					headers: {
						[PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER]: bootstrapLease,
						[PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER]:
							PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
						'x-public-discovery-refresh-gate-protocol': '3',
						'x-public-discovery-refresh-lease': gateLease
					},
					status: 200
				});
			}
			if (pathname === '/reserve-og-queue-attempts') {
				return Response.json(
					{
						remaining: PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX - 1,
						resetAtMs: Date.UTC(2026, 6, 21),
						status: 'reserved'
					},
					{ headers: { 'x-public-discovery-refresh-gate-protocol': '3' } }
				);
			}
			return new Response(null, {
				headers: {
					[PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER]: bootstrapLease,
					[PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER]:
						PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
					'x-public-discovery-generation': generation,
					'x-public-discovery-refresh-gate-protocol': '3'
				},
				status: 200
			});
		});
		const resolve = vi.fn(async (event: { locals: App.Locals }) => {
			await event.locals.reservePublicTemplateOgQueueAttempts?.([
				'https://production.example.convex.cloud|template-one|7|1'
			]);
			return Response.json(
				{
					generation,
					list: { ready: true, retiredRevision: 6, revision: 7, withdrawalEpoch: 0 },
					ok: true,
					relations: { ready: true, retiredRevision: 7, revision: 8, withdrawalEpoch: 0 }
				},
				{
					headers: {
						'cache-control': 'no-store',
						'x-public-discovery-generation': generation
					}
				}
			);
		});
		const route = hookInput({
			gate: gateDouble(fetch),
			presented: activeSecret,
			publicConvexUrl: 'https://quirky-chinchilla-352.convex.cloud',
			resolve
		});
		authorizeBootstrap(route);

		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: resolve as never
		});

		expect(response.status).toBe(200);
		expect(fetch.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([
			'/reserve',
			'/reserve-og-queue-attempts',
			'/complete-bootstrap'
		]);
		const reservation = fetch.mock.calls[0]?.[0];
		expect(reservation?.headers.get(PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER)).toBe(
			bootstrapLease
		);
		const queueBody = await fetch.mock.calls[1]?.[0].json();
		expect(queueBody).toMatchObject({
			bootstrapLeaseId: bootstrapLease,
			bootstrapProvenance: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
			leaseId: gateLease
		});
		const completion = fetch.mock.calls[2]?.[0];
		expect(completion?.headers.get('x-public-discovery-refresh-completion')).toBe('ready');
		expect(completion?.headers.get('x-public-discovery-generation')).toBe(generation);
	});

	it('never calls bootstrap completion for a malformed HTTP-200 ready claim', async () => {
		const fetch = vi.fn(async (request: Request) => {
			if (new URL(request.url).pathname !== '/reserve') {
				throw new Error('completion must not run');
			}
			return new Response(null, {
				headers: {
					[PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER]: bootstrapLease,
					[PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER]:
						PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
					'x-public-discovery-refresh-gate-protocol': '3',
					'x-public-discovery-refresh-lease': gateLease
				},
				status: 200
			});
		});
		const resolve = vi.fn(async () =>
			Response.json(
				{
					generation: 'list=7:0;relations=8:0',
					list: { ready: false, retiredRevision: 6, revision: 7, withdrawalEpoch: 0 },
					ok: true,
					relations: { ready: true, retiredRevision: 7, revision: 8, withdrawalEpoch: 0 }
				},
				{
					headers: {
						'cache-control': 'no-store',
						'x-public-discovery-generation': 'list=7:0;relations=8:0'
					}
				}
			)
		);
		const route = hookInput({
			gate: gateDouble(fetch),
			presented: activeSecret,
			publicConvexUrl: 'https://quirky-chinchilla-352.convex.cloud',
			resolve
		});
		authorizeBootstrap(route);

		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: resolve as never
		});

		expect(response.status).toBe(503);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('rejects a forged deployment-seed lane before spending a DO request', async () => {
		const route = hookInput({ presented: activeSecret });
		route.event.request.headers.set('x-public-discovery-refresh-purpose', 'deploy-seed');
		route.event.request.headers.set('x-expected-release-sha', 'f'.repeat(40));
		route.event.request.headers.set('x-expected-release-transaction', releaseTransactionId);
		route.event.request.headers.set('x-internal-secret', internalSecret);

		const response = await handlePublicDiscoveryManifestRefreshCapability({
			event: route.event as never,
			resolve: route.resolve as never
		});

		expect(response.status).toBe(401);
		expect(route.gate?.idFromName).not.toHaveBeenCalled();
		expect(route.resolve).not.toHaveBeenCalled();
	});

	it('fails closed on an incompatible or unbounded gate response', async () => {
		for (const response of [
			new Response(null, { status: 200 }),
			new Response(null, {
				status: 202,
				headers: { 'x-public-discovery-refresh-gate-protocol': '3' }
			})
		]) {
			const route = hookInput({
				gate: gateDouble(vi.fn(async () => response)),
				presented: activeSecret
			});
			const result = await handlePublicDiscoveryManifestRefreshCapability({
				event: route.event as never,
				resolve: route.resolve as never
			});
			expect(result.status).toBe(503);
			expect(route.resolve).not.toHaveBeenCalled();
		}
	});

	it('is first in the normal application sequence and bypasses auth before cookie access', () => {
		const sequence = hooksSource.slice(hooksSource.indexOf('const applicationHandle = sequence('));
		expect(sequence.indexOf('handlePublicDiscoveryManifestRefreshCapability,')).toBeLessThan(
			sequence.indexOf('handleAuth,')
		);
		const authStart = hooksSource.indexOf('const handleAuth: Handle');
		const cookieRead = hooksSource.indexOf('event.cookies.get(SESSION_COOKIE)', authStart);
		const bypass = hooksSource.indexOf(
			'event.locals.publicDiscoveryManifestRefreshAuthenticated',
			authStart
		);
		expect(bypass).toBeGreaterThan(authStart);
		expect(bypass).toBeLessThan(cookieRead);
	});
});
