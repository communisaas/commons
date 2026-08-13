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

/**
 * Build a DOH JSON response with MX records. `Status: 0` is NOERROR — real
 * Cloudflare always carries a numeric RCODE, and the module now gates on it.
 */
function mxResponse(domain: string) {
	return {
		Status: 0,
		Answer: [
			{ name: domain, type: 15, data: `10 mail.${domain}` }
		]
	};
}

/** Build a NOERROR DOH JSON response carrying no MX records. */
function noMxResponse() {
	return { Status: 0, Answer: [] };
}

/** Build a NOERROR DOH JSON response with only non-MX records. */
function nonMxResponse() {
	return {
		Status: 0,
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
		// A DNS answer was actually parsed — this is an observation, not a block
		expect(results.get('mayor@sfgov.org')?.mxObserved).toBe(true);
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
		// Blocked, not absent: nothing was observed, so nothing may be persisted
		expect(results.get('user@example.com')?.mxObserved).toBe(false);
		expect(results.get('user@example.com')?.reason).toContain('MX lookup unavailable');
	});

	it('fails open (risky) when fetch throws (timeout/network error)', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('TimeoutError'));

		const results = await verifyEmailBatch(['user@example.com']);

		expect(results.get('user@example.com')?.verdict).toBe('risky');
		expect(results.get('user@example.com')?.mxObserved).toBe(false);
		expect(results.get('user@example.com')?.reason).toContain('MX lookup unavailable');
	});

	// -------------------------------------------------------------------------
	// DNS response codes. Only NOERROR (0) and NXDOMAIN (3) mean the resolver
	// answered the question; every other RCODE is a failed lookup wearing a 200.
	// Reading one as "no MX records" would delete a reachable recipient.
	// -------------------------------------------------------------------------

	/** Serve a DOH body verbatim with a 200, the way a resolver failure arrives. */
	function serve(body: unknown) {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify(body), { status: 200 })
		);
	}

	it('treats SERVFAIL (Status 2) as blocked, not as an absence', async () => {
		serve({ Status: 2 });

		const results = await verifyEmailBatch(['user@example.com']);

		expect(results.get('user@example.com')?.verdict).toBe('risky');
		expect(results.get('user@example.com')?.mxObserved).toBe(false);
		expect(results.get('user@example.com')?.reason).toContain('MX lookup unavailable');
	});

	it('treats REFUSED (Status 5) as blocked, not as an absence', async () => {
		serve({ Status: 5 });

		const results = await verifyEmailBatch(['user@example.com']);

		expect(results.get('user@example.com')?.verdict).toBe('risky');
		expect(results.get('user@example.com')?.mxObserved).toBe(false);
		expect(results.get('user@example.com')?.reason).toContain('MX lookup unavailable');
	});

	it('treats NXDOMAIN (Status 3) as a real observed absence', async () => {
		// Real Cloudflare omits `Answer` entirely on NXDOMAIN.
		serve({ Status: 3 });

		const results = await verifyEmailBatch(['user@no-such-domain.fake']);

		expect(results.get('user@no-such-domain.fake')?.verdict).toBe('undeliverable');
		expect(results.get('user@no-such-domain.fake')?.mxObserved).toBe(true);
	});

	it('treats NOERROR with no Answer as a real observed absence', async () => {
		serve({ Status: 0 });

		const results = await verifyEmailBatch(['user@no-mail.example']);

		expect(results.get('user@no-mail.example')?.verdict).toBe('undeliverable');
		expect(results.get('user@no-mail.example')?.mxObserved).toBe(true);
	});

	it('treats a 200 body with no DNS status as blocked (proxy interstitial)', async () => {
		serve({});

		const results = await verifyEmailBatch(['user@example.com']);

		expect(results.get('user@example.com')?.verdict).toBe('risky');
		expect(results.get('user@example.com')?.mxObserved).toBe(false);
		expect(results.get('user@example.com')?.reason).toContain('MX lookup unavailable');
	});

	it('does not memoize a blocked lookup — a later resolution retries', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify(mxResponse('example.com')), { status: 200 })
			);

		const first = await verifyEmailBatch(['user@example.com']);
		expect(first.get('user@example.com')?.mxObserved).toBe(false);

		// Same module instance, same domain: the non-observation must not have
		// been cached, so a DNS incident cannot pin the domain for the isolate.
		const second = await verifyEmailBatch(['user@example.com']);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(second.get('user@example.com')?.mxObserved).toBe(true);
		expect(second.get('user@example.com')?.verdict).toBe('risky');
	});

	it('caps MX lookups at maxDomains distinct domains without dropping addresses', async () => {
		// Fresh Response per call — a Response body is consumable exactly once
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(
				async () => new Response(JSON.stringify(mxResponse('first.org')), { status: 200 })
			);

		const results = await verifyEmailBatch(
			['a@first.org', 'b@second.org', 'c@third.org', 'd@fourth.org'],
			{ maxDomains: 2 }
		);

		// Exactly two domains admitted → exactly two DOH calls
		expect(fetchSpy).toHaveBeenCalledTimes(2);

		expect(results.get('a@first.org')?.mxObserved).toBe(true);
		expect(results.get('b@second.org')?.mxObserved).toBe(true);

		// Ceiling-skipped addresses stay in the map and stay risky — never dropped,
		// never 'undeliverable'
		for (const email of ['c@third.org', 'd@fourth.org']) {
			expect(results.has(email), email).toBe(true);
			expect(results.get(email)?.verdict, email).toBe('risky');
			expect(results.get(email)?.mxObserved, email).toBe(false);
			expect(results.get(email)?.reason, email).toContain('domain ceiling reached');
		}
	});

	it('counts the maxDomains ceiling by domain, not by address', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(JSON.stringify(mxResponse('sfgov.org')), { status: 200 }));

		const emails = Array.from({ length: 8 }, (_, i) => `person${i}@sfgov.org`);
		const results = await verifyEmailBatch(emails, { maxDomains: 2 });

		// Eight addresses, one domain — the memo makes the extras free
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(results.size).toBe(8);
		for (const email of emails) {
			expect(results.get(email)?.verdict, email).toBe('risky');
			expect(results.get(email)?.mxObserved, email).toBe(true);
		}
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
