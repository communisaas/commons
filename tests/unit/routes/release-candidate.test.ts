import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../../../src/routes/api/release-candidate/+server';

const sourceSha = '0'.repeat(40);
const transactionId = '123456789-7';

afterEach(() => {
	vi.unstubAllGlobals();
});

function event(
	url: string,
	{
		authoritySha = sourceSha,
		authorityTransaction = transactionId,
		environmentTransaction = transactionId,
		headers = {}
	}: {
		authoritySha?: string;
		authorityTransaction?: string;
		environmentTransaction?: string;
		headers?: HeadersInit;
	} = {}
) {
	return {
		locals: {
			releaseCandidateOriginAuthority: {
				sourceSha: authoritySha,
				transactionId: authorityTransaction
			}
		},
		platform: { env: { PUBLIC_RELEASE_TRANSACTION_ID: environmentTransaction } },
		request: new Request(url, { headers }),
		url: new URL(url)
	};
}

describe('/api/release-candidate', () => {
	it('returns one empty inert proof response for the exact staging release', async () => {
		const response = await GET(
			event('https://staging.commons.email/api/release-candidate') as never
		);

		expect(response.status).toBe(204);
		expect(response.body).toBeNull();
		expect(response.headers.get('cache-control')).toContain('no-store');
		expect(response.headers.get('x-commons-origin-access-token')).toBe('absent');
		expect(response.headers.get('x-commons-preview-cache-api')).toBe('unavailable');
	});

	it.each([
		['production host', 'https://commons.email/api/release-candidate', sourceSha, transactionId],
		[
			'query string',
			'https://staging.commons.email/api/release-candidate?probe=1',
			sourceSha,
			transactionId
		],
		[
			'wrong source',
			'https://staging.commons.email/api/release-candidate',
			'b'.repeat(40),
			transactionId
		],
		[
			'wrong transaction',
			'https://staging.commons.email/api/release-candidate',
			sourceSha,
			'123456789-8'
		]
	])('rejects %s without application work', async (_label, url, sha, transaction) => {
		const response = await GET(
			event(url, { authoritySha: sha, authorityTransaction: transaction }) as never
		);

		expect(response.status).toBe(404);
			expect(response.body).toBeNull();
		});

	it('rejects when the Access service credential survived the late transform', async () => {
		const response = await GET(
			event('https://staging.commons.email/api/release-candidate', {
				headers: { 'x-commons-pages-origin-access': 'must-not-reach-candidate' }
			}) as never
		);

		expect(response.status).toBe(404);
	});

	it('rejects a standard Access token header at the candidate boundary', async () => {
		const response = await GET(
			event('https://staging.commons.email/api/release-candidate', {
				headers: { 'cf-access-token': 'header.payload.signature' }
			}) as never
		);

		expect(response.status).toBe(404);
	});

	it('fails qualification if the Access-fronted preview unexpectedly has Cache API access', async () => {
		const match = vi.fn(async () => undefined);
		vi.stubGlobal('caches', { default: { match } });

		const response = await GET(
			event('https://staging.commons.email/api/release-candidate') as never
		);

		expect(response.status).toBe(503);
		expect(match).toHaveBeenCalledOnce();
	});
});
