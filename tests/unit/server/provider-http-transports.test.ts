import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	ExaTransportError,
	requestExa
} from '$lib/server/exa/client';
import {
	FirecrawlTransportError,
	requestFirecrawlScrape
} from '$lib/server/firecrawl/client';

function abortablePendingFetch(
	_input: string | URL | Request,
	init?: RequestInit
): Promise<Response> {
	return new Promise((_resolve, reject) => {
		const signal = init?.signal;
		if (!signal) return;
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		signal.addEventListener('abort', () => reject(signal.reason), { once: true });
	});
}

describe('paid provider HTTP transports', () => {
	beforeEach(() => {
		process.env.EXA_API_KEY = 'exa-test-key';
		process.env.FIRECRAWL_API_KEY = 'firecrawl-test-key';
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('passes Exa Retry-After metadata to the reviewed limiter', async () => {
		const googleKey = `AIza${'a'.repeat(35)}`;
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ error: 'rate limited' }), {
				status: 429,
				headers: {
					'content-type': 'application/json',
					'retry-after': '2',
					'set-cookie': `session=${googleKey}`,
					'x-api-key': googleKey
				}
			})
		);

		await expect(
			requestExa('/search', { query: 'test', numResults: 10, contents: false })
		).rejects.toMatchObject({
			status: 429,
			headers: { 'retry-after': '2' }
		});
	});

	it('scrubs and byte-bounds Exa error bodies before constructing a transport error', async () => {
		const bearer = `Bearer ${'b'.repeat(48)}`;
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({ error: `upstream\r\n${bearer}\u0000 ${'\ud83d\udea8'.repeat(10_000)}` }),
				{ status: 500, headers: { 'content-type': 'application/json' } }
			)
		);

		let failure: ExaTransportError | undefined;
		try {
			await requestExa('/search', { query: 'test', numResults: 10, contents: false });
		} catch (error) {
			if (error instanceof ExaTransportError) failure = error;
		}

		expect(failure).toBeInstanceOf(ExaTransportError);
		const message = failure?.message ?? '';
		expect(new TextEncoder().encode(message).byteLength).toBeLessThanOrEqual(512);
		expect(message).not.toContain(bearer);
		expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
	});

	it('actively aborts Exa at its deadline with no hidden SDK retry', async () => {
		vi.useFakeTimers();
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(abortablePendingFetch);

		const request = requestExa('/search', { query: 'test' }, { timeoutMs: 25 });
		const rejection = expect(request).rejects.toMatchObject({
			code: 'ETIMEDOUT'
		});
		await vi.advanceTimersByTimeAsync(25);

		await rejection;
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('actively aborts Firecrawl at its deadline with no hidden SDK retry', async () => {
		vi.useFakeTimers();
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(abortablePendingFetch);

		const request = requestFirecrawlScrape('https://example.com', {
			formats: ['markdown'],
			timeoutMs: 25
		});
		const rejection = expect(request).rejects.toMatchObject({
			code: 'ETIMEDOUT'
		});
		await vi.advanceTimersByTimeAsync(25);

		await rejection;
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('parses one successful bounded Firecrawl response', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					success: true,
					data: { markdown: '# Page', links: [], metadata: { statusCode: 200 } }
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);

		const result = await requestFirecrawlScrape('https://example.com', {
			formats: ['markdown', 'links']
		});

		expect(result.markdown).toBe('# Page');
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fetchSpy.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
	});

	it('scrubs Firecrawl error bodies and retains only bounded Retry-After metadata', async () => {
		const firecrawlKey = `fc-${'f'.repeat(40)}`;
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					success: false,
					error: `scrape\r\n${firecrawlKey}\u0000 ${'x'.repeat(10_000)}`
				}),
				{
					status: 503,
					headers: {
						'content-type': 'application/json',
						'retry-after': '3',
						'set-cookie': `session=${firecrawlKey}`
					}
				}
			)
		);

		let failure: FirecrawlTransportError | undefined;
		try {
			await requestFirecrawlScrape('https://example.com', { formats: ['markdown'] });
		} catch (error) {
			if (error instanceof FirecrawlTransportError) failure = error;
		}

		expect(failure).toBeInstanceOf(FirecrawlTransportError);
		const message = failure?.message ?? '';
		expect(new TextEncoder().encode(message).byteLength).toBeLessThanOrEqual(512);
		expect(message).not.toContain(firecrawlKey);
		expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
		expect(failure?.headers).toEqual({ 'retry-after': '3' });
	});
});
