/**
 * Unit Tests — Email Verification (MX via Cloudflare DOH)
 *
 * Mocks globalThis.fetch to simulate DOH responses.
 * Covers: syntax rejection, MX found, MX absent, DOH failure, timeout,
 * promise deduplication across shared domains, batch parallelism.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Reset module state (the mxCache Map) between tests
let verifyEmailBatch: typeof import('$lib/server/email-verification').verifyEmailBatch;

beforeEach(async () => {
	vi.resetModules();
	const mod = await import('$lib/server/email-verification');
	verifyEmailBatch = mod.verifyEmailBatch;
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a DOH JSON response with MX records. */
function mxResponse(domain: string) {
	return {
		Answer: [
			{ name: domain, type: 15, data: `10 mail.${domain}` }
		]
	};
}

/** Build a DOH JSON response with no MX records (e.g., NXDOMAIN). */
function noMxResponse() {
	return { Answer: [] };
}

/** Build a DOH JSON response with only non-MX records. */
function nonMxResponse() {
	return {
		Answer: [
			{ name: 'example.com', type: 1, data: '93.184.216.34' } // A record, not MX
		]
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyEmailBatch', () => {

	it('rejects invalid syntax as undeliverable without network call', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		const results = await verifyEmailBatch(['not-an-email', '@missing.com', 'no-at-sign']);

		expect(results.get('not-an-email')?.verdict).toBe('undeliverable');
		expect(results.get('@missing.com')?.verdict).toBe('undeliverable');
		expect(results.get('no-at-sign')?.verdict).toBe('undeliverable');
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('marks email as risky when domain has MX records', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify(mxResponse('sfgov.org')), { status: 200 })
		);

		const results = await verifyEmailBatch(['mayor@sfgov.org']);

		// 'risky' not 'deliverable' — MX proves the domain exists, not the mailbox
		expect(results.get('mayor@sfgov.org')?.verdict).toBe('risky');
		expect(results.get('mayor@sfgov.org')?.reason).toContain('MX lookup passed');
	});

	it('marks email as undeliverable when domain has no MX records', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify(noMxResponse()), { status: 200 })
		);

		const results = await verifyEmailBatch(['someone@nonexistent-domain-xyz.fake']);

		expect(results.get('someone@nonexistent-domain-xyz.fake')?.verdict).toBe('undeliverable');
		expect(results.get('someone@nonexistent-domain-xyz.fake')?.reason).toContain('No MX records');
	});

	it('marks email as undeliverable when DOH returns only non-MX records', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify(nonMxResponse()), { status: 200 })
		);

		const results = await verifyEmailBatch(['test@a-record-only.com']);

		expect(results.get('test@a-record-only.com')?.verdict).toBe('undeliverable');
	});

	it('fails open (risky) when DOH returns non-200', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('Service Unavailable', { status: 503 })
		);

		const results = await verifyEmailBatch(['user@example.com']);

		// Fail open — don't block the pipeline, but verdict is honest
		expect(results.get('user@example.com')?.verdict).toBe('risky');
	});

	it('fails open (risky) when fetch throws (timeout/network error)', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('TimeoutError'));

		const results = await verifyEmailBatch(['user@example.com']);

		expect(results.get('user@example.com')?.verdict).toBe('risky');
	});

	it('deduplicates DOH requests for the same domain', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify(mxResponse('sfgov.org')), { status: 200 })
		);

		const results = await verifyEmailBatch([
			'mayor@sfgov.org',
			'supervisor@sfgov.org',
			'clerk@sfgov.org'
		]);

		// All three share sfgov.org — should be one fetch, not three
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(results.get('mayor@sfgov.org')?.verdict).toBe('risky');
		expect(results.get('supervisor@sfgov.org')?.verdict).toBe('risky');
		expect(results.get('clerk@sfgov.org')?.verdict).toBe('risky');
	});

	it('handles mixed domains in a single batch', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
			if (url.includes('sfgov.org')) {
				return new Response(JSON.stringify(mxResponse('sfgov.org')), { status: 200 });
			}
			if (url.includes('dead-domain.fake')) {
				return new Response(JSON.stringify(noMxResponse()), { status: 200 });
			}
			return new Response(JSON.stringify(mxResponse('example.com')), { status: 200 });
		});

		const results = await verifyEmailBatch([
			'a@sfgov.org',
			'bad-syntax',
			'b@dead-domain.fake',
			'c@sfgov.org',
		]);

		expect(results.get('a@sfgov.org')?.verdict).toBe('risky');
		expect(results.get('bad-syntax')?.verdict).toBe('undeliverable');
		expect(results.get('b@dead-domain.fake')?.verdict).toBe('undeliverable');
		expect(results.get('c@sfgov.org')?.verdict).toBe('risky');

		// sfgov.org deduplicated, dead-domain.fake separate = 2 fetches
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('sends correct DOH request format', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify(mxResponse('example.com')), { status: 200 })
		);

		await verifyEmailBatch(['test@example.com']);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, opts] = fetchSpy.mock.calls[0];
		const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url;
		expect(urlStr).toContain('cloudflare-dns.com/dns-query');
		expect(urlStr).toContain('name=example.com');
		expect(urlStr).toContain('type=MX');
		expect((opts as RequestInit)?.headers).toEqual({ Accept: 'application/dns-json' });
	});
});
