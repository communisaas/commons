import { describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_DISCOVERY_CACHE_PROOF,
	PUBLIC_DISCOVERY_PROOF_URL,
	provePublicDiscoveryEdgeCache,
	validatePublicDiscoveryCacheResponse
} from '../../../scripts/prove-public-discovery-edge-cache.mjs';

const publicCacheControl = 'public, max-age=60, stale-while-revalidate=300';
const publicCdnCacheControl = 'public, s-maxage=60, stale-while-revalidate=300';

function cacheResponse(
	cacheStatus: 'bypass' | 'hit' | 'miss' | 'stale',
	age: number,
	headers: Record<string, string> = {}
): Response {
	return new Response('<!doctype html><title>Commons</title>', {
		headers: {
			age: String(age),
			'cache-control': publicCacheControl,
			'cache-tag': 'public-discovery',
			'cdn-cache-control': publicCdnCacheControl,
			'cloudflare-cdn-cache-control': publicCdnCacheControl,
			'content-type': 'text/html; charset=utf-8',
			vary: 'Accept-Encoding',
			'x-commons-public-discovery-cache': cacheStatus,
			...headers
		},
		status: 200
	});
}

describe('public discovery trusted-edge cache proof', () => {
	it('allows convergence from miss or stale and completes only on a fresh hit', async () => {
		const responses = [
			cacheResponse('miss', 0),
			cacheResponse('stale', 60),
			cacheResponse('hit', 4)
		];
		const fetchImpl = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
				responses.shift() ?? cacheResponse('hit', 5)
		);
		const sleepImpl = vi.fn(async () => undefined);

		await expect(
			provePublicDiscoveryEdgeCache({
				attempts: 3,
				fetchImpl: fetchImpl as typeof fetch,
				intervalMilliseconds: 0,
				sleepImpl
			})
		).resolves.toEqual({
			age: 4,
			attempts: 3,
			cacheStatus: 'hit',
			proof: PUBLIC_DISCOVERY_CACHE_PROOF,
			url: PUBLIC_DISCOVERY_PROOF_URL
		});
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		for (const [url, init] of fetchImpl.mock.calls) {
			expect(url).toBe('https://commons.email/');
			expect(init).toMatchObject({
				credentials: 'omit',
				headers: { Accept: 'text/html' },
				method: 'GET',
				redirect: 'manual'
			});
			expect(new Headers(init?.headers).has('authorization')).toBe(false);
			expect(new Headers(init?.headers).has('cookie')).toBe(false);
			expect(new URL(String(url)).search).toBe('');
		}
		expect(sleepImpl).toHaveBeenCalledTimes(2);
	});

	it('retries bounded transport failures but never reports success without a hit', async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValueOnce(new Error('temporary transport failure'))
			.mockResolvedValueOnce(cacheResponse('miss', 0));

		await expect(
			provePublicDiscoveryEdgeCache({
				attempts: 2,
				fetchImpl: fetchImpl as typeof fetch,
				intervalMilliseconds: 0,
				sleepImpl: async () => undefined
			})
		).rejects.toThrow(/no trusted hit after 2 attempts.*lastStatus=miss/u);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('fails closed on bypass, widened policy, cookies, metadata leaks, or invalid age', () => {
		expect(() => validatePublicDiscoveryCacheResponse(cacheResponse('bypass', 0))).toThrow(
			/cache status/u
		);
		expect(() =>
			validatePublicDiscoveryCacheResponse(
				cacheResponse('hit', 0, { 'cache-control': 'public, max-age=3600' })
			)
		).toThrow(/cache-control/u);
		expect(() =>
			validatePublicDiscoveryCacheResponse(cacheResponse('hit', 0, { 'set-cookie': 'sid=x' }))
		).toThrow(/set a cookie/u);
		expect(() =>
			validatePublicDiscoveryCacheResponse(
				cacheResponse('hit', 0, {
					'x-commons-public-discovery-cache-stored-at': '1234'
				})
			)
		).toThrow(/internal cache metadata/u);
		expect(() => validatePublicDiscoveryCacheResponse(cacheResponse('hit', 60))).toThrow(
			/hit age/u
		);
		expect(() => validatePublicDiscoveryCacheResponse(cacheResponse('stale', 59))).toThrow(
			/stale age/u
		);
	});
});
