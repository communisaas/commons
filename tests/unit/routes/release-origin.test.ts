import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../../../src/routes/api/release-origin/+server';

const sourceSha = import.meta.env.VITE_RELEASE_SHA as string;
const transactionId = '123456789-7';

afterEach(() => {
	vi.unstubAllGlobals();
});

function event(
	url = 'https://commons.email/api/release-origin',
	{
		authoritySha = sourceSha,
		authorityTransaction = transactionId,
		environmentTransaction = transactionId,
		frozen = true,
		headers = { accept: 'application/json' }
	}: {
		authoritySha?: string;
		authorityTransaction?: string;
		environmentTransaction?: string;
		frozen?: boolean;
		headers?: HeadersInit;
	} = {}
) {
	const authority = {
		sourceSha: authoritySha,
		transactionId: authorityTransaction
	};
	if (frozen) Object.freeze(authority);
	return {
		locals: { releaseOriginAuthority: authority },
		platform: { env: { PUBLIC_RELEASE_TRANSACTION_ID: environmentTransaction } },
		request: new Request(url, { headers }),
		url: new URL(url)
	};
}

describe('/api/release-origin', () => {
	it('returns the exact inert post-commit origin proof without external I/O', async () => {
		vi.stubGlobal('caches', undefined);
		const externalFetch = vi.fn(async () => {
			throw new Error('release-origin proof must not perform external I/O');
		});
		vi.stubGlobal('fetch', externalFetch);

		const response = await GET(event() as never);

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
		expect(response.headers.get('cdn-cache-control')).toBe('no-store');
		expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
		expect(response.headers.get('x-commons-origin-access-token')).toBe('absent');
		expect(response.headers.get('x-commons-origin-proof-secret')).toBe('absent');
		expect(response.headers.get('x-commons-origin-cache-api')).toBe('unavailable');
		expect(response.headers.get('x-commons-origin-external-io')).toBe('0');
		expect(response.headers.get('x-commons-origin-release-sha')).toBe(sourceSha);
		expect(response.headers.get('x-commons-origin-release-transaction')).toBe(transactionId);
		await expect(response.json()).resolves.toEqual({
			releaseSha: sourceSha,
			transactionId,
			originAccessToken: 'absent',
			originProofSecret: 'absent',
			cacheApi: 'unavailable',
			externalIo: 0
		});
		expect(externalFetch).not.toHaveBeenCalled();
	});

	it.each([
		['query string', 'https://commons.email/api/release-origin?probe=1', sourceSha, transactionId, true],
		['wrong host', 'https://staging.commons.email/api/release-origin', sourceSha, transactionId, true],
		['wrong path', 'https://commons.email/api/release-candidate', sourceSha, transactionId, true],
		['wrong source', 'https://commons.email/api/release-origin', 'b'.repeat(40), transactionId, true],
		['wrong transaction', 'https://commons.email/api/release-origin', sourceSha, '123456789-8', true],
		['mutable authority', 'https://commons.email/api/release-origin', sourceSha, transactionId, false]
	])('rejects %s without proof work', async (_label, url, sha, transaction, frozen) => {
		const response = await GET(
			event(url, {
				authoritySha: sha,
				authorityTransaction: transaction,
				frozen
			}) as never
		);

		expect(response.status).toBe(404);
		expect(response.body).toBeNull();
	});

	it.each([
		'x-commons-release-origin-purpose',
		'x-commons-release-origin-proof-secret'
	])('rejects surviving %s transport authority at the route boundary', async (header) => {
		const response = await GET(
			event('https://commons.email/api/release-origin', {
				headers: {
					accept: 'application/json',
					[header]: 'must-be-consumed-before-origin'
				}
			}) as never
		);

		expect(response.status).toBe(404);
	});

	it('fails proof if the Access-fronted origin unexpectedly exposes Cache API', async () => {
		const match = vi.fn(async () => undefined);
		vi.stubGlobal('caches', { default: { match } });

		const response = await GET(event() as never);

		expect(response.status).toBe(503);
		expect(match).toHaveBeenCalledOnce();
	});
});
