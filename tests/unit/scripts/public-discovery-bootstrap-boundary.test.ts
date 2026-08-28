import { describe, expect, it, vi } from 'vitest';

import {
	deriveRejectedPublicDiscoveryRefreshSecret,
	parsePublicDiscoveryBootstrapBoundaryArgs,
	provePublicDiscoveryBootstrapBoundary,
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_ENDPOINT
} from '../../../scripts/prove-public-discovery-bootstrap-boundary.mjs';

const sourceSha = 'a'.repeat(40);
const transactionId = '1753014600000-8';
const leaseId = '123e4567-e89b-42d3-a456-426614174000';
const refreshSecret = 'r'.repeat(64);
const previousRefreshSecret = 'p'.repeat(64);
const internalSecret = 'i'.repeat(64);
const originAccessToken = JSON.stringify({
	'cf-access-client-id': `${'c'.repeat(32)}.access`,
	'cf-access-client-secret': 's'.repeat(64)
});

function deniedResponse(overrides: ResponseInit = {}) {
	return new Response('Access denied', { status: 403, ...overrides });
}

function boundaryResponse(
	body: unknown = { error: 'Unauthorized' },
	overrides: ResponseInit = {}
) {
	return new Response(JSON.stringify(body), {
		headers: {
			'cache-control': 'no-store',
			'content-type': 'application/json; charset=utf-8',
			'x-commons-public-discovery-bootstrap-boundary': 'v1'
		},
		status: 401,
		...overrides
	});
}

function prove(fetchFn: typeof fetch) {
	return provePublicDiscoveryBootstrapBoundary({
		fetchFn,
		internalSecret,
		leaseId,
		originAccessToken,
		previousRefreshSecret,
		refreshSecret,
		sourceSha,
		transactionId
	});
}

describe('public-discovery production bootstrap boundary proof', () => {
	it('proves Access precedes the temporary Worker and app auth rejects the admitted canary', async () => {
		const requests: Array<{ endpoint: RequestInfo | URL; init?: RequestInit }> = [];
		const fetchFn = vi.fn(async (endpoint: RequestInfo | URL, init?: RequestInit) => {
			requests.push({ endpoint, init });
			return requests.length === 1 ? deniedResponse() : boundaryResponse();
		});

		await expect(prove(fetchFn)).resolves.toEqual({
			action: 'prove-public-discovery-bootstrap-boundary',
			accessDeniedBeforeWorker: true,
			applicationAuthenticationRejected: true,
			boundaryProtocol: 'v1',
			endpoint: PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_ENDPOINT,
			leaseId,
			sourceSha,
			transactionId
		});
		expect(requests).toHaveLength(2);
		for (const request of requests) {
			expect(request.endpoint).toBe(PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_ENDPOINT);
			expect(request.init).toMatchObject({ body: '{}', method: 'POST', redirect: 'error' });
			expect(request.init?.signal).toBeInstanceOf(AbortSignal);
		}
		const anonymous = new Headers(requests[0]?.init?.headers);
		const authenticated = new Headers(requests[1]?.init?.headers);
		expect(anonymous.get('x-commons-pages-origin-access')).toBeNull();
		expect(authenticated.get('x-commons-pages-origin-access')).toBe(originAccessToken);
		expect(Object.fromEntries(anonymous)).toMatchObject({
			'content-type': 'application/json',
			'x-commons-edge-public-host': 'commons.email',
			'x-commons-edge-release-sha': sourceSha,
			'x-commons-edge-release-transaction': transactionId,
			'x-expected-release-sha': sourceSha,
			'x-expected-release-transaction': transactionId,
			'x-forwarded-host': 'commons.email',
			'x-forwarded-proto': 'https',
			'x-internal-secret': internalSecret,
			'x-public-discovery-bootstrap-lease': leaseId,
			'x-public-discovery-bootstrap-provenance': 'public-discovery-corpus-bootstrap',
			'x-public-discovery-refresh-purpose': 'deploy-seed'
		});
		const rejected = anonymous.get('x-public-discovery-manifest-refresh-secret');
		expect(rejected).toMatch(/^[a-f0-9]{64}$/u);
		expect([refreshSecret, previousRefreshSecret, internalSecret]).not.toContain(rejected);
		expect(authenticated.get('x-public-discovery-manifest-refresh-secret')).toBe(rejected);
	});

	it('rejects an unauthenticated request that reaches the bootstrap adapter', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				deniedResponse({
					headers: { 'x-commons-public-discovery-bootstrap-boundary': 'v1' },
					status: 421
				})
			);

		await expect(prove(fetchFn)).rejects.toThrow(
			'Bootstrap route executed before Access denied the unauthenticated request.'
		);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it.each([200, 302, 404, 500])('rejects HTTP %s as an Access denial proof', async (status) => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(deniedResponse({ status }));
		await expect(prove(fetchFn)).rejects.toThrow(
			'Bootstrap route executed before Access denied the unauthenticated request.'
		);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('rejects a response that does not prove the authenticated adapter boundary', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(deniedResponse())
			.mockResolvedValueOnce(
				boundaryResponse(undefined, {
					headers: { 'cache-control': 'no-store', 'content-type': 'application/json' }
				})
			);

		await expect(prove(fetchFn)).rejects.toThrow(
			'Bootstrap authenticated boundary did not fail closed at application authentication.'
		);
	});

	it('rejects an unexpected application-authentication body', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(deniedResponse())
			.mockResolvedValueOnce(boundaryResponse({ error: 'Unauthorized', extra: true }));

		await expect(prove(fetchFn)).rejects.toThrow(
			'Bootstrap authenticated boundary returned an invalid rejection body.'
		);
	});

	it('derives a deterministic well-formed credential distinct from every live secret', () => {
		const input = {
			active: refreshSecret,
			internal: internalSecret,
			leaseId,
			previous: previousRefreshSecret,
			sourceSha,
			transactionId
		};
		const first = deriveRejectedPublicDiscoveryRefreshSecret(input);
		expect(first).toBe(deriveRejectedPublicDiscoveryRefreshSecret(input));
		expect(first).toMatch(/^[a-f0-9]{64}$/u);
		expect([refreshSecret, previousRefreshSecret, internalSecret]).not.toContain(first);
	});

	it('parses only the exact release tuple flags', () => {
		const args = [
			'--expected-release-sha',
			sourceSha,
			'--bootstrap-authority-lease',
			leaseId,
			'--expected-release-transaction',
			transactionId
		];
		expect(parsePublicDiscoveryBootstrapBoundaryArgs(args)).toEqual({
			leaseId,
			sourceSha,
			transactionId
		});
		expect(() => parsePublicDiscoveryBootstrapBoundaryArgs([...args, '--extra', 'value'])).toThrow(
			'Bootstrap boundary arguments are invalid.'
		);
		expect(() => parsePublicDiscoveryBootstrapBoundaryArgs(args.slice(0, -2))).toThrow(
			'Every bootstrap boundary argument is required exactly once.'
		);
	});

	it('validates every capability and release coordinate before network access', async () => {
		const fetchFn = vi.fn<typeof fetch>();
		await expect(
			provePublicDiscoveryBootstrapBoundary({
				fetchFn,
				internalSecret: 'short',
				leaseId,
				originAccessToken,
				refreshSecret,
				sourceSha,
				transactionId
			})
		).rejects.toThrow('INTERNAL_API_SECRET has an invalid byte length.');
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
