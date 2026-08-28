import { describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_DISCOVERY_MANIFEST_BOOTSTRAP_MAXIMUM_ATTEMPTS,
	PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
	PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_ATTEMPTS,
	parsePublicDiscoveryManifestSeedArgs,
	seedPublicDiscoveryManifest,
	seedPublicDiscoveryManifestFromEnvironment,
	validatePublicDiscoveryManifestSeedEndpoint,
	validatePublicDiscoveryOriginAccessToken
} from '../../../scripts/seed-public-discovery-manifest.mjs';

const releaseSha = 'a'.repeat(40);
const releaseTransaction = '123456789-7';
const startedAtMilliseconds = Date.parse('2026-07-20T00:00:00.000Z');
const receiptVerificationDeadlineAt = '2026-07-20T00:27:00.000Z';
const qualificationReserveMilliseconds = 5 * 60 * 1_000;
const seedCompletionDeadlineAt = '2026-07-20T00:22:00.000Z';
const bootstrapAuthorityLeaseId = '123e4567-e89b-42d3-a456-426614174000';
const bootstrapAuthorityNotAfter = '2026-07-20T01:00:00.000Z';
const bootstrapCleanupReserveMilliseconds = 10 * 60 * 1_000;
const bootstrapSeedCompletionDeadlineAt = '2026-07-20T00:50:00.000Z';
const refreshSecret = 'r'.repeat(64);
const internalSecret = 'i'.repeat(64);
const accessClientId = `${'c'.repeat(32)}.access`;
const accessClientSecret = 's'.repeat(64);
const originAccessToken = JSON.stringify({
	'cf-access-client-id': accessClientId,
	'cf-access-client-secret': accessClientSecret
});
const successBody = {
	generation: 'list=5:500;relations=7:700',
	ok: true,
	list: { ready: true, retiredRevision: 4, revision: 5, withdrawalEpoch: 2 },
	relations: { ready: true, retiredRevision: 6, revision: 7, withdrawalEpoch: 1 }
};

function response(
	body: unknown,
	options: {
		bootstrapBoundary?: string;
		continuation?: string;
		contentType?: string;
		generation?: string;
		protocol?: string;
		retryAfter?: string;
		status?: number;
		extraHeaders?: HeadersInit;
	} = {}
) {
	const headers = new Headers({
		'cache-control': 'no-store',
		'content-type': options.contentType ?? 'application/json; charset=utf-8',
		'x-public-discovery-refresh-gate-protocol': options.protocol ?? '3',
		...options.extraHeaders
	});
	if (options.bootstrapBoundary !== undefined) {
		headers.set('x-commons-public-discovery-bootstrap-boundary', options.bootstrapBoundary);
	}
	if (options.continuation !== undefined) {
		headers.set('x-public-discovery-page-backfill-continuation', options.continuation);
	}
	if (options.generation !== undefined) {
		headers.set('x-public-discovery-generation', options.generation);
	}
	if (options.retryAfter !== undefined) headers.set('retry-after', options.retryAfter);
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		headers,
		status: options.status ?? 200
	});
}

function successResponse(body: unknown = successBody) {
	return response(body, { generation: successBody.generation });
}

function bootstrapSuccessResponse(body: unknown = successBody) {
	return response(body, { bootstrapBoundary: 'v1', generation: successBody.generation });
}

function coalescedResponse(retryAfterSeconds = 37) {
	return response(
		{ coalesced: true, gateProtocol: '3', ok: true, retryAfterSeconds },
		{ retryAfter: String(retryAfterSeconds), status: 202 }
	);
}

function incompleteResponse() {
	return response(
		{
			code: 'PUBLIC_TEMPLATE_PAGE_BACKFILL_INCOMPLETE',
			ok: false,
			retryAfterSeconds: 120,
			retryable: true
		},
		{ continuation: '1', retryAfter: '120', status: 202 }
	);
}

function seed(overrides: Record<string, unknown> = {}) {
	return seedPublicDiscoveryManifest({
		endpoint: PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
		expectedReleaseSha: releaseSha,
		expectedReleaseTransaction: releaseTransaction,
		fetchFn: vi.fn(async () => successResponse()),
		internalSecret,
		originAccessToken,
		qualificationReserveMilliseconds,
		receiptVerificationDeadlineAt,
		refreshSecret,
		sleepFn: vi.fn(async () => undefined),
		nowFn: () => startedAtMilliseconds,
		...overrides
	});
}

describe('public-discovery manifest deploy seed', () => {
	it('posts the exact release tuple and trusted hidden-origin forwarding contract', async () => {
		const requests: Array<{ endpoint: RequestInfo | URL; init?: RequestInit }> = [];
		const fetchFn = vi.fn(async (endpoint: RequestInfo | URL, init?: RequestInit) => {
			requests.push({ endpoint, init });
			return successResponse();
		});

		const proof = await seed({ fetchFn });

		expect(requests).toHaveLength(1);
		expect(requests[0].endpoint).toBe(
			'https://pages-origin.commons.email/api/internal/public-discovery-manifest-refresh'
		);
		expect(requests[0].init).toMatchObject({ body: '{}', method: 'POST', redirect: 'error' });
		expect(requests[0].init?.signal).toBeInstanceOf(AbortSignal);
		const headers = new Headers(requests[0].init?.headers);
		expect(Object.fromEntries(headers)).toEqual({
			'content-type': 'application/json',
			'x-commons-edge-public-host': 'commons.email',
			'x-commons-edge-release-sha': releaseSha,
			'x-commons-edge-release-transaction': releaseTransaction,
			'x-commons-pages-origin-access': originAccessToken,
			'x-expected-release-sha': releaseSha,
			'x-expected-release-transaction': releaseTransaction,
			'x-forwarded-host': 'commons.email',
			'x-forwarded-proto': 'https',
			'x-internal-secret': internalSecret,
			'x-public-discovery-manifest-refresh-secret': refreshSecret,
			'x-public-discovery-refresh-purpose': 'deploy-seed'
		});
		expect(proof).toEqual({
			proof: 'public-discovery-manifest-deploy-seed',
			gateProtocol: '3',
			endpoint: PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
			expectedReleaseSha: releaseSha,
			expectedReleaseTransaction: releaseTransaction,
			receiptVerificationDeadlineAt,
			qualificationReserveMilliseconds,
			seedCompletionDeadlineAt,
			attempts: 1,
			continuationUsed: false,
			generation: successBody.generation,
			list: successBody.list,
			relations: successBody.relations
		});
		expect(JSON.stringify(proof)).not.toContain(refreshSecret);
		expect(JSON.stringify(proof)).not.toContain(internalSecret);
		expect(JSON.stringify(proof)).not.toContain(accessClientSecret);
	});

	it('uses the isolated bootstrap lease, boundary, and sixty-minute deadline contract', async () => {
		const requests: RequestInit[] = [];
		const fetchFn = vi.fn(async (_endpoint: RequestInfo | URL, init?: RequestInit) => {
			requests.push(init ?? {});
			return bootstrapSuccessResponse();
		});

		const proof = await seed({
			bootstrapAuthorityLeaseId,
			bootstrapAuthorityNotAfter,
			bootstrapCleanupReserveMilliseconds,
			fetchFn,
			qualificationReserveMilliseconds: undefined,
			receiptVerificationDeadlineAt: undefined
		});

		expect(fetchFn).toHaveBeenCalledOnce();
		const headers = new Headers(requests[0]?.headers);
		expect(headers.get('x-public-discovery-refresh-purpose')).toBe('deploy-seed');
		expect(headers.get('x-public-discovery-bootstrap-provenance')).toBe(
			'public-discovery-corpus-bootstrap'
		);
		expect(headers.get('x-public-discovery-bootstrap-lease')).toBe(bootstrapAuthorityLeaseId);
		expect(proof).toEqual({
			proof: 'public-discovery-manifest-bootstrap-seed',
			gateProtocol: '3',
			endpoint: PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
			expectedReleaseSha: releaseSha,
			expectedReleaseTransaction: releaseTransaction,
			bootstrapAuthorityLeaseId,
			bootstrapAuthorityNotAfter,
			bootstrapCleanupReserveMilliseconds,
			seedCompletionDeadlineAt: bootstrapSeedCompletionDeadlineAt,
			attempts: 1,
			continuationUsed: false,
			generation: successBody.generation,
			list: successBody.list,
			relations: successBody.relations
		});
	});

	it('fails closed when normal and bootstrap route boundaries are crossed', async () => {
		const crossedNormal = vi.fn(async () => bootstrapSuccessResponse());
		await expect(seed({ fetchFn: crossedNormal })).rejects.toThrow(
			/failed without a retryable protocol response/i
		);
		expect(crossedNormal).toHaveBeenCalledOnce();
		const crossedBootstrap = vi.fn(async () => successResponse());
		await expect(
			seed({
				bootstrapAuthorityLeaseId,
				bootstrapAuthorityNotAfter,
				bootstrapCleanupReserveMilliseconds,
				fetchFn: crossedBootstrap,
				qualificationReserveMilliseconds: undefined,
				receiptVerificationDeadlineAt: undefined
			})
		).rejects.toThrow(/failed without a retryable protocol response/i);
		expect(crossedBootstrap).toHaveBeenCalledOnce();
	});

	it('canonicalizes the protected Access token JSON without exposing its component headers', async () => {
		const prettyToken = JSON.stringify(
			{
				'cf-access-client-secret': accessClientSecret,
				'cf-access-client-id': accessClientId
			},
			null,
			2
		);
		const fetchFn = vi.fn(async (_endpoint: RequestInfo | URL, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			expect(headers.get('x-commons-pages-origin-access')).toBe(originAccessToken);
			expect(headers.get('cf-access-client-id')).toBeNull();
			expect(headers.get('cf-access-client-secret')).toBeNull();
			expect(headers.get('cf-access-token')).toBeNull();
			return successResponse();
		});

		await expect(seed({ fetchFn, originAccessToken: prettyToken })).resolves.toMatchObject({
			attempts: 1
		});
		expect(fetchFn).toHaveBeenCalledOnce();
	});

	it('handles only protocol-3 coalescing and typed continuations before success', async () => {
		const responses = [
			coalescedResponse(37),
			incompleteResponse(),
			coalescedResponse(1),
			successResponse()
		];
		const continuationHeaders: Array<string | null> = [];
		const fetchFn = vi.fn(async (_endpoint: RequestInfo | URL, init?: RequestInit) => {
			continuationHeaders.push(
				new Headers(init?.headers).get('x-public-discovery-page-backfill-continuation')
			);
			const next = responses.shift();
			if (!next) throw new Error('unexpected request');
			return next;
		});
		const sleepFn = vi.fn(async (_delayMilliseconds: number) => undefined);

		await expect(seed({ fetchFn, sleepFn })).resolves.toMatchObject({
			attempts: 4,
			continuationUsed: true
		});
		expect(continuationHeaders).toEqual([null, null, '1', '1']);
		expect(sleepFn.mock.calls.map(([delay]) => delay)).toEqual([38_000, 121_000, 2_000]);
	});

	it('retries an exact timeout only and preserves the 19-attempt ceiling', async () => {
		const timeout = new Error('simulated timeout');
		timeout.name = 'TimeoutError';
		const fetchFn = vi
			.fn()
			.mockRejectedValueOnce(timeout)
			.mockResolvedValueOnce(successResponse());
		const sleepFn = vi.fn(async () => undefined);

		await expect(seed({ fetchFn, sleepFn })).resolves.toMatchObject({ attempts: 2 });
		expect(sleepFn).toHaveBeenCalledWith(61_000);

		const alwaysCoalesced = vi.fn(async () => coalescedResponse(1));
		const boundedSleep = vi.fn(async () => undefined);
		await expect(
			seed({ fetchFn: alwaysCoalesced, sleepFn: boundedSleep })
		).rejects.toThrow(/exhausted 19 attempts/i);
		expect(alwaysCoalesced).toHaveBeenCalledTimes(PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_ATTEMPTS);
		expect(boundedSleep).toHaveBeenCalledTimes(
			PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_ATTEMPTS - 1
		);
	});

	it('fails closed before a request whose full timeout could cross the seed deadline', async () => {
		let clockReads = 0;
		const completionDeadlineMilliseconds =
			Date.parse(receiptVerificationDeadlineAt) - qualificationReserveMilliseconds;
		const nowFn = vi.fn(() => {
			clockReads += 1;
			return clockReads === 1
				? startedAtMilliseconds
				: completionDeadlineMilliseconds - 19_999;
		});
		const fetchFn = vi.fn(async () => successResponse());

		await expect(seed({ fetchFn, nowFn })).rejects.toThrow(
			/cannot start attempt 1 within its bounded completion window/i
		);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('fails closed before a retry sleep that cannot preserve a full next request window', async () => {
		let now = startedAtMilliseconds;
		const completionDeadlineMilliseconds =
			Date.parse(receiptVerificationDeadlineAt) - qualificationReserveMilliseconds;
		const fetchFn = vi.fn(async () => {
			now = completionDeadlineMilliseconds - 60_000;
			return incompleteResponse();
		});
		const sleepFn = vi.fn(async () => undefined);

		await expect(seed({ fetchFn, nowFn: () => now, sleepFn })).rejects.toThrow(
			/cannot wait for attempt 2 within its bounded completion window/i
		);
		expect(fetchFn).toHaveBeenCalledOnce();
		expect(sleepFn).not.toHaveBeenCalled();
	});

	it('rejects a response that completes after the seed deadline', async () => {
		let now = startedAtMilliseconds;
		const completionDeadlineMilliseconds =
			Date.parse(receiptVerificationDeadlineAt) - qualificationReserveMilliseconds;
		const fetchFn = vi.fn(async () => {
			now = completionDeadlineMilliseconds + 1;
			return successResponse();
		});

		await expect(seed({ fetchFn, nowFn: () => now })).rejects.toThrow(
			/response crossed its bounded completion window/i
		);
	});

	it('does not retry ordinary transport failures or reflect their messages', async () => {
		const fetchFn = vi.fn(async () => {
			throw new Error(`${refreshSecret}:${internalSecret}:${accessClientSecret}`);
		});
		const sleepFn = vi.fn(async () => undefined);
		let errorMessage = '';
		await seed({ fetchFn, sleepFn }).catch((value: unknown) => {
			errorMessage = value instanceof Error ? value.message : String(value);
		});

		expect(errorMessage).toBe(
			'Manifest seed request failed without a retryable protocol response.'
		);
		expect(errorMessage).not.toContain(refreshSecret);
		expect(errorMessage).not.toContain(internalSecret);
		expect(errorMessage).not.toContain(accessClientSecret);
		expect(fetchFn).toHaveBeenCalledOnce();
		expect(sleepFn).not.toHaveBeenCalled();
	});

	it('bounds the entire fetch-and-body attempt, including a body that never settles', async () => {
		const fetchFn = vi.fn(
			async () =>
				new Response(new ReadableStream({ pull: () => new Promise(() => undefined) }), {
					headers: {
						'cache-control': 'no-store',
						'content-type': 'application/json',
						'x-public-discovery-refresh-gate-protocol': '3'
					}
				})
		);

		await expect(
			seed({ fetchFn, maximumAttempts: 1, requestTimeoutMilliseconds: 5 })
		).rejects.toThrow(/exhausted 1 attempt/i);
		expect(fetchFn).toHaveBeenCalledOnce();
	});

	it('accepts exactly 4 KiB while rejecting zero-byte chunk work amplification', async () => {
		const source = JSON.stringify(successBody);
		const padded = new TextEncoder().encode(`${source}${' '.repeat(4_096 - source.length)}`);
		let offset = 0;
		const exactFetch = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						pull(controller) {
							if (offset === padded.length) controller.close();
							else controller.enqueue(padded.subarray(offset, ++offset));
						}
					}),
					{
						headers: {
							'cache-control': 'no-store',
							'content-type': 'application/json',
							'x-public-discovery-generation': successBody.generation,
							'x-public-discovery-refresh-gate-protocol': '3'
						}
					}
				)
		);
		await expect(seed({ fetchFn: exactFetch })).resolves.toMatchObject({ attempts: 1 });

		let pulls = 0;
		const hostileFetch = vi.fn(
			async () =>
				new Response(
					new ReadableStream({
						pull(controller) {
							pulls += 1;
							controller.enqueue(new Uint8Array());
						}
					}),
					{
						headers: {
							'cache-control': 'no-store',
							'content-type': 'application/json',
							'x-public-discovery-refresh-gate-protocol': '3'
						}
					}
				)
		);
		await expect(seed({ fetchFn: hostileFetch })).rejects.toThrow();
		expect(hostileFetch).toHaveBeenCalledOnce();
		expect(pulls).toBeLessThanOrEqual(4_098);
	});

	it.each([
		'http://pages-origin.commons.email/api/internal/public-discovery-manifest-refresh',
		'https://commons.email/api/internal/public-discovery-manifest-refresh',
		'https://staging.commons.email/api/internal/public-discovery-manifest-refresh',
		'https://pages-origin-staging.commons.email/api/internal/public-discovery-manifest-refresh',
		'https://user:password@pages-origin.commons.email/api/internal/public-discovery-manifest-refresh',
		'https://pages-origin.commons.email:444/api/internal/public-discovery-manifest-refresh',
		'https://pages-origin.commons.email/api/internal/public-discovery-manifest-refresh/',
		'https://pages-origin.commons.email/api/internal/public-discovery-manifest-refresh?next=evil',
		'https://pages-origin.commons.email/api/internal/public-discovery-manifest-refresh#secret',
		'https://pages-origin.commons.email/api/internal/%70ublic-discovery-manifest-refresh'
	])('rejects endpoint capability exfiltration or aliasing: %s', async (endpoint) => {
		expect(() => validatePublicDiscoveryManifestSeedEndpoint(endpoint)).toThrow(
			/exact Access-protected production origin/i
		);
		await expect(seed({ endpoint })).rejects.toThrow(/exact Access-protected production origin/i);
	});

	it.each([
		['uppercase SHA', { expectedReleaseSha: 'A'.repeat(40) }],
		['short SHA', { expectedReleaseSha: 'a'.repeat(39) }],
		['zero transaction run', { expectedReleaseTransaction: '0-1' }],
		['zero transaction attempt', { expectedReleaseTransaction: '1-0' }],
		['oversized transaction', { expectedReleaseTransaction: `${'1'.repeat(21)}-1` }],
		['short refresh secret', { refreshSecret: 'r'.repeat(31) }],
		['short internal secret', { internalSecret: 'i'.repeat(31) }],
		['control in refresh secret', { refreshSecret: `${'r'.repeat(31)}\n` }],
		['reused application secret', { internalSecret: refreshSecret }],
		['too many attempts', { maximumAttempts: 20 }],
		['unbounded timeout', { requestTimeoutMilliseconds: 20_001 }],
		['short qualification reserve', { qualificationReserveMilliseconds: 29_999 }],
		['oversized qualification reserve', { qualificationReserveMilliseconds: 1_620_001 }],
		['noncanonical deadline', { receiptVerificationDeadlineAt: '2026-07-20T00:27:00Z' }],
		['expired deadline', { receiptVerificationDeadlineAt: '2026-07-19T23:59:59.999Z' }],
		['far-future deadline', { receiptVerificationDeadlineAt: '2026-07-20T00:27:00.001Z' }]
	])('fails before fetch for invalid authority input: %s', async (_label, overrides) => {
		const fetchFn = vi.fn(async () => successResponse());
		await expect(seed({ fetchFn, ...overrides })).rejects.toThrow();
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('requires an exact, dedicated production Access capability', async () => {
		for (const token of [
			'not-json'.repeat(10),
			JSON.stringify({
				'cf-access-client-id': accessClientId,
				'cf-access-client-secret': accessClientSecret,
				extra: true
			}),
			JSON.stringify({
				'cf-access-client-id': 'short',
				'cf-access-client-secret': accessClientSecret
			}),
			JSON.stringify({
				'cf-access-client-id': accessClientId,
				'cf-access-client-secret': 'short'
			})
		]) {
			expect(() => validatePublicDiscoveryOriginAccessToken(token)).toThrow();
			await expect(seed({ originAccessToken: token })).rejects.toThrow();
		}
		const reusedAccessToken = JSON.stringify({
			'cf-access-client-id': accessClientId,
			'cf-access-client-secret': internalSecret
		});
		await expect(seed({ originAccessToken: reusedAccessToken })).rejects.toThrow(/distinct/i);
	});

	it.each([
		['wrong status', response(successBody, { generation: successBody.generation, status: 201 })],
		['wrong protocol', response(successBody, { generation: successBody.generation, protocol: '2' })],
		[
			'wrong content type',
			response(successBody, { contentType: 'text/plain', generation: successBody.generation })
		],
		[
			'missing no-store',
			new Response(JSON.stringify(successBody), {
				headers: {
					'content-type': 'application/json',
					'x-public-discovery-generation': successBody.generation,
					'x-public-discovery-refresh-gate-protocol': '3'
				}
			})
		],
		[
			'location header',
			response(successBody, {
				extraHeaders: { location: 'https://evil.example/' },
				generation: successBody.generation
			})
		],
		['invalid JSON', response('{', { generation: successBody.generation })],
		[
			'oversized body',
			response('x'.repeat(4_097), {
				extraHeaders: { 'content-length': '4097' },
				generation: successBody.generation
			})
		],
		[
			'extra success key',
			response({ ...successBody, extra: true }, { generation: successBody.generation })
		],
		[
			'not ready',
			response(
				{ ...successBody, list: { ...successBody.list, ready: false } },
				{ generation: successBody.generation }
			)
		],
		[
			'fractional revision',
			response(
				{ ...successBody, list: { ...successBody.list, revision: 5.5 } },
				{ generation: successBody.generation }
			)
		],
		[
			'non-retired revision',
			response(
				{ ...successBody, list: { ...successBody.list, retiredRevision: 5 } },
				{ generation: successBody.generation }
			)
		],
		[
			'negative withdrawal',
			response(
				{ ...successBody, relations: { ...successBody.relations, withdrawalEpoch: -1 } },
				{ generation: successBody.generation }
			)
		],
		[
			'generation header mismatch',
			response(successBody, { generation: 'list=5:501;relations=7:700' })
		],
		[
			'generation revision mismatch',
			response(
				{ ...successBody, generation: 'list=6:500;relations=7:700' },
				{ generation: 'list=6:500;relations=7:700' }
			)
		],
		[
			'success retry header',
			response(successBody, { generation: successBody.generation, retryAfter: '1' })
		]
	])('fails closed without retry for malformed success: %s', async (_label, malformed) => {
		const fetchFn = vi.fn(async () => malformed);
		const sleepFn = vi.fn(async () => undefined);
		await expect(seed({ fetchFn, sleepFn })).rejects.toThrow();
		expect(fetchFn).toHaveBeenCalledOnce();
		expect(sleepFn).not.toHaveBeenCalled();
	});

	it('rejects redirects even when an injected fetch follows one', async () => {
		const redirected = successResponse();
		Object.defineProperties(redirected, {
			redirected: { value: true },
			url: { value: 'https://evil.example/result' }
		});
		const fetchFn = vi.fn(async () => redirected);

		await expect(seed({ fetchFn })).rejects.toThrow();
		expect(fetchFn).toHaveBeenCalledOnce();
	});

	it.each([
		['retry-after zero', coalescedResponse(0)],
		['retry-after above bound', coalescedResponse(301)],
		[
			'noncanonical retry-after',
			response(
				{ coalesced: true, gateProtocol: '3', ok: true, retryAfterSeconds: 1 },
				{ retryAfter: '01', status: 202 }
			)
		],
		[
			'retry mismatch',
			response(
				{ coalesced: true, gateProtocol: '3', ok: true, retryAfterSeconds: 4 },
				{ retryAfter: '5', status: 202 }
			)
		],
		[
			'extra coalesced key',
			response(
				{ coalesced: true, extra: true, gateProtocol: '3', ok: true, retryAfterSeconds: 5 },
				{ retryAfter: '5', status: 202 }
			)
		],
		[
			'continuation on coalesced shape',
			response(
				{ coalesced: true, gateProtocol: '3', ok: true, retryAfterSeconds: 5 },
				{ continuation: '1', retryAfter: '5', status: 202 }
			)
		]
	])('does not retry malformed ordinary 202: %s', async (_label, malformed) => {
		const fetchFn = vi.fn(async () => malformed);
		const sleepFn = vi.fn(async () => undefined);
		await expect(seed({ fetchFn, sleepFn })).rejects.toThrow();
		expect(fetchFn).toHaveBeenCalledOnce();
		expect(sleepFn).not.toHaveBeenCalled();
	});

	it.each([
		[
			'missing continuation header',
			response(
				{
					code: 'PUBLIC_TEMPLATE_PAGE_BACKFILL_INCOMPLETE',
					ok: false,
					retryAfterSeconds: 120,
					retryable: true
				},
				{ retryAfter: '120', status: 202 }
			)
		],
		[
			'wrong continuation value',
			response(
				{
					code: 'PUBLIC_TEMPLATE_PAGE_BACKFILL_INCOMPLETE',
					ok: false,
					retryAfterSeconds: 120,
					retryable: true
				},
				{ continuation: '2', retryAfter: '120', status: 202 }
			)
		],
		[
			'wrong typed retry',
			response(
				{
					code: 'PUBLIC_TEMPLATE_PAGE_BACKFILL_INCOMPLETE',
					ok: false,
					retryAfterSeconds: 119,
					retryable: true
				},
				{ continuation: '1', retryAfter: '119', status: 202 }
			)
		],
		[
			'extra typed key',
			response(
				{
					code: 'PUBLIC_TEMPLATE_PAGE_BACKFILL_INCOMPLETE',
					extra: true,
					ok: false,
					retryAfterSeconds: 120,
					retryable: true
				},
				{ continuation: '1', retryAfter: '120', status: 202 }
			)
		]
	])('does not retry malformed typed incomplete 202: %s', async (_label, malformed) => {
		const fetchFn = vi.fn(async () => malformed);
		const sleepFn = vi.fn(async () => undefined);
		await expect(seed({ fetchFn, sleepFn })).rejects.toThrow();
		expect(fetchFn).toHaveBeenCalledOnce();
		expect(sleepFn).not.toHaveBeenCalled();
	});

	it('reads secrets only from the fixed protected environment names', async () => {
		const fetchFn = vi.fn(async (_endpoint: RequestInfo | URL, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			expect(headers.get('x-public-discovery-manifest-refresh-secret')).toBe(refreshSecret);
			expect(headers.get('x-internal-secret')).toBe(internalSecret);
			expect(headers.get('x-commons-pages-origin-access')).toBe(originAccessToken);
			return successResponse();
		});

		await expect(
			seedPublicDiscoveryManifestFromEnvironment({
				endpoint: PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				environment: {
					DISCOVERY_MANIFEST_REFRESH_SECRET: refreshSecret,
					INTERNAL_API_SECRET: internalSecret,
					PAGES_ORIGIN_ACCESS_TOKEN: originAccessToken
				},
				expectedReleaseSha: releaseSha,
				expectedReleaseTransaction: releaseTransaction,
				receiptVerificationDeadlineAt,
				qualificationReserveMilliseconds,
				fetchFn,
				sleepFn: vi.fn(async () => undefined),
				nowFn: () => startedAtMilliseconds
			})
		).resolves.toMatchObject({ attempts: 1 });
	});

	it('parses the required non-secret deadline contract and bounded optional attempt count', () => {
		expect(
			parsePublicDiscoveryManifestSeedArgs([
				'--expected-release-transaction',
				releaseTransaction,
				'--endpoint',
				PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				'--expected-release-sha',
				releaseSha,
				'--receipt-verification-deadline',
				receiptVerificationDeadlineAt,
				'--qualification-reserve-milliseconds',
				String(qualificationReserveMilliseconds),
				'--maximum-attempts',
				'1'
			])
		).toEqual({
			endpoint: PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
			expectedReleaseSha: releaseSha,
			expectedReleaseTransaction: releaseTransaction,
			receiptVerificationDeadlineAt,
			qualificationReserveMilliseconds,
			maximumAttempts: 1
		});
		expect(
			parsePublicDiscoveryManifestSeedArgs([
				'--endpoint',
				PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				'--expected-release-sha',
				releaseSha,
				'--expected-release-transaction',
				releaseTransaction,
				'--receipt-verification-deadline',
				receiptVerificationDeadlineAt,
				'--qualification-reserve-milliseconds',
				String(qualificationReserveMilliseconds)
			])
		).toMatchObject({ maximumAttempts: PUBLIC_DISCOVERY_MANIFEST_SEED_MAXIMUM_ATTEMPTS });
		for (const args of [
			['--endpoint', PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT],
			[
				'--endpoint',
				PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				'--endpoint',
				PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				'--expected-release-sha',
				releaseSha,
				'--receipt-verification-deadline',
				receiptVerificationDeadlineAt,
				'--qualification-reserve-milliseconds',
				String(qualificationReserveMilliseconds)
			],
			[
				'--endpoint',
				PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				'--expected-release-sha',
				releaseSha,
				'--expected-release-transaction',
				releaseTransaction,
				'--receipt-verification-deadline',
				receiptVerificationDeadlineAt,
				'--qualification-reserve-milliseconds',
				String(qualificationReserveMilliseconds),
				'--secret',
				refreshSecret
			],
			[
				'--endpoint',
				PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				'--expected-release-sha',
				releaseSha,
				'--expected-release-transaction',
				releaseTransaction,
				'--receipt-verification-deadline',
				receiptVerificationDeadlineAt,
				'--qualification-reserve-milliseconds',
				String(qualificationReserveMilliseconds),
				'--maximum-attempts',
				'20'
			],
			[
				'--endpoint',
				PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				'--expected-release-sha',
				releaseSha,
				'--expected-release-transaction',
				releaseTransaction,
				'--receipt-verification-deadline',
				receiptVerificationDeadlineAt,
				'--qualification-reserve-milliseconds',
				'030000'
			]
		]) {
			expect(() => parsePublicDiscoveryManifestSeedArgs(args)).toThrow();
		}
	});

	it('parses a mutually exclusive bounded bootstrap authority contract', () => {
		expect(
			parsePublicDiscoveryManifestSeedArgs([
				'--endpoint',
				PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				'--expected-release-sha',
				releaseSha,
				'--expected-release-transaction',
				releaseTransaction,
				'--bootstrap-authority-lease',
				bootstrapAuthorityLeaseId,
				'--bootstrap-authority-not-after',
				bootstrapAuthorityNotAfter,
				'--bootstrap-cleanup-reserve-milliseconds',
				String(bootstrapCleanupReserveMilliseconds)
			])
		).toEqual({
			bootstrapAuthorityLeaseId,
			bootstrapAuthorityNotAfter,
			bootstrapCleanupReserveMilliseconds,
			endpoint: PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
			expectedReleaseSha: releaseSha,
			expectedReleaseTransaction: releaseTransaction,
			maximumAttempts: PUBLIC_DISCOVERY_MANIFEST_BOOTSTRAP_MAXIMUM_ATTEMPTS
		});
		for (const args of [
			[
				'--endpoint',
				PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				'--expected-release-sha',
				releaseSha,
				'--expected-release-transaction',
				releaseTransaction,
				'--bootstrap-authority-lease',
				bootstrapAuthorityLeaseId
			],
			[
				'--endpoint',
				PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				'--expected-release-sha',
				releaseSha,
				'--expected-release-transaction',
				releaseTransaction,
				'--bootstrap-authority-lease',
				bootstrapAuthorityLeaseId,
				'--bootstrap-authority-not-after',
				bootstrapAuthorityNotAfter,
				'--bootstrap-cleanup-reserve-milliseconds',
				String(bootstrapCleanupReserveMilliseconds),
				'--receipt-verification-deadline',
				receiptVerificationDeadlineAt,
				'--qualification-reserve-milliseconds',
				String(qualificationReserveMilliseconds)
			],
			[
				'--endpoint',
				PUBLIC_DISCOVERY_MANIFEST_SEED_ENDPOINT,
				'--expected-release-sha',
				releaseSha,
				'--expected-release-transaction',
				releaseTransaction,
				'--bootstrap-authority-lease',
				bootstrapAuthorityLeaseId,
				'--bootstrap-authority-not-after',
				bootstrapAuthorityNotAfter,
				'--bootstrap-cleanup-reserve-milliseconds',
				String(bootstrapCleanupReserveMilliseconds),
				'--maximum-attempts',
				'26'
			]
		]) {
			expect(() => parsePublicDiscoveryManifestSeedArgs(args)).toThrow();
		}
	});
});
