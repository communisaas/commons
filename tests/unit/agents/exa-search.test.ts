import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockSearch = vi.fn();
const mockGetContents = vi.fn();
const observedRateLimiterContexts: string[] = [];
// `scrape` is the v4+ Firecrawl SDK method; `scrapeUrl` is the legacy
// alias. Production code calls `firecrawl.scrape(url, { formats: [...] })`
// (see exa-search.ts:253), so the mock client must expose `scrape`.
const mockScrape = vi.fn();

// Mock rate limiter that executes immediately without throttling
const createMockRateLimiter = () => ({
	execute: async <T>(fn: () => Promise<T>, _context: string) => {
		observedRateLimiterContexts.push(_context);
		try {
			const data = await fn();
			return { success: true, data, attempts: 1, wasRateLimited: false };
		} catch (error) {
			const status =
				error && typeof error === 'object' && 'status' in error
					? (error as { status?: unknown }).status
					: undefined;
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				attempts: 1,
				wasRateLimited: false,
				completionUnknown: typeof status !== 'number'
			};
		}
	},
	getState: () => ({
		requestTimestamps: [],
		circuitState: 'closed' as const,
		circuitOpenedAt: null,
		consecutiveFailures: 0
	}),
	reset: vi.fn()
});

const mockSearchRateLimiter = createMockRateLimiter();
const mockFirecrawlRateLimiter = createMockRateLimiter();

vi.mock('$lib/server/exa', () => ({
	requestExa: (
		endpoint: '/search' | '/contents',
		body: Record<string, unknown>,
		_options?: unknown
	) => {
		if (endpoint === '/contents') {
			return mockGetContents(body.urls, { text: body.text, highlights: body.highlights });
		}
		const { query, ...searchOptions } = body;
		return mockSearch(query, { ...searchOptions, contents: false });
	},
	getSearchRateLimiter: () => mockSearchRateLimiter,
	getContentsRateLimiter: () => mockSearchRateLimiter
}));

vi.mock('$lib/server/firecrawl', () => ({
	requestFirecrawlScrape: (url: string, options: unknown) => mockScrape(url, options),
	getFirecrawlRateLimiter: () => mockFirecrawlRateLimiter
}));

// prunePageContent must exercise the production extractor, not a stale test copy.
vi.mock('$lib/core/agents/agents/decision-maker', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/core/agents/agents/decision-maker')
	>('$lib/core/agents/agents/decision-maker');
	return { extractContactHints: actual.extractContactHints };
});

import { searchWeb, readPage, prunePageContent } from '$lib/core/agents/exa-search';

describe('searchWeb', () => {
	beforeEach(() => {
		mockSearch.mockReset();
		mockGetContents.mockReset();
		mockGetContents.mockResolvedValue({ results: [] });
		observedRateLimiterContexts.length = 0;
	});

	it('calls exa.search with metadata-only (contents: false)', async () => {
		mockSearch.mockResolvedValue({ results: [] });

		await searchWeb('Portland mayor contact');

		expect(mockSearch).toHaveBeenCalledTimes(1);
		const [query, options] = mockSearch.mock.calls[0];
		expect(query).toBe('Portland mayor contact');
		expect(options.contents).toBe(false);
		expect(options.type).toBe('auto');
	});

	it('defaults to and hard-caps the base 10-result price tier', async () => {
		mockSearch.mockResolvedValue({ results: [] });

		await searchWeb('test query');

		expect(mockSearch.mock.calls[0][1].numResults).toBe(10);

		await searchWeb('oversized result request', { maxResults: 25 });
		expect(mockSearch.mock.calls[1][1].numResults).toBe(10);
	});

	it('respects custom maxResults', async () => {
		mockSearch.mockResolvedValue({ results: [] });

		await searchWeb('test query', { maxResults: 10 });

		const options = mockSearch.mock.calls[0][1];
		expect(options.numResults).toBe(10);
	});

	it('rejects blank or control-only queries before provider admission', async () => {
		await expect(searchWeb(' \r\n\t\u0000 ')).rejects.toThrow(
			'Search query must contain visible text'
		);

		expect(mockSearch).not.toHaveBeenCalled();
		expect(observedRateLimiterContexts).toEqual([]);
	});

	it('returns correctly shaped search hits', async () => {
		mockSearch.mockResolvedValue({
			results: [
				{
					url: 'https://portland.gov/mayor',
					title: 'Mayor of Portland',
					publishedDate: '2025-01-01',
					author: 'City of Portland',
					score: 0.95
				},
				{
					url: 'https://oregonlive.com/mayor',
					title: 'Portland Mayor Profile',
					score: 0.8
				}
			]
		});

		const hits = await searchWeb('Portland mayor');

		expect(hits).toHaveLength(2);
		expect(hits[0]).toEqual({
			url: 'https://portland.gov/mayor',
			title: 'Mayor of Portland',
			publishedDate: '2025-01-01',
			author: 'City of Portland',
			score: 0.95
		});
		expect(hits[1].url).toBe('https://oregonlive.com/mayor');
		expect(hits[1].publishedDate).toBeUndefined();
	});

	it('caps provider over-return and validates every result field at the shared boundary', async () => {
		const apiKey = `fc-${'k'.repeat(40)}`;
		mockSearch.mockResolvedValue({
			results: Array.from({ length: 40 }, (_, index) => ({
				url: `https://example.com/result/${index}?page=${index}&api_key=${apiKey}#private`,
				title: `Result ${index}\r\n${apiKey}\u0000${'\ud83d\udea8'.repeat(1_000)}`,
				publishedDate: `2026-07-${String(index + 1).padStart(2, '0')}${'x'.repeat(1_000)}`,
				author: `Author ${index}${'\ud83d\udea8'.repeat(1_000)}`,
				score: index === 0 ? Number.POSITIVE_INFINITY : index
			}))
		});

		const hits = await searchWeb('bounded provider results', { maxResults: 3 });

		expect(hits).toHaveLength(3);
		expect(mockSearch.mock.calls[0][1].numResults).toBe(3);
		for (const hit of hits) {
			expect(new TextEncoder().encode(hit.url).byteLength).toBeLessThanOrEqual(512);
			expect(new TextEncoder().encode(hit.title).byteLength).toBeLessThanOrEqual(240);
			expect(new TextEncoder().encode(hit.author ?? '').byteLength).toBeLessThanOrEqual(160);
			expect(new TextEncoder().encode(hit.publishedDate ?? '').byteLength).toBeLessThanOrEqual(64);
			expect(hit.url).not.toContain(apiKey);
			expect(hit.url).not.toContain('#private');
			expect(hit.title).not.toContain(apiKey);
			expect(hit.title).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
		}
		expect(hits[0].score).toBeUndefined();
	});

	it('drops malformed, credential-bearing, and non-HTTP provider result URLs', async () => {
		mockSearch.mockResolvedValue({
			results: [
				{ url: 'not a url', title: 'bad' },
				{ url: 'file:///etc/passwd', title: 'bad' },
				{ url: 'https://user:password@example.com/private', title: 'bad' },
				{ url: 'https://example.com/valid', title: 'good' }
			]
		});

		const hits = await searchWeb('validate URLs');

		expect(hits).toEqual([
			{
				url: 'https://example.com/valid',
				title: 'good'
			}
		]);
	});

	it('throws when search fails', async () => {
		mockSearch.mockRejectedValue(new Error('Rate limited'));

		await expect(searchWeb('test')).rejects.toThrow('Search failed');
	});

	it('does not expose provider credentials or control text in its outward error', async () => {
		const googleKey = `AIza${'a'.repeat(35)}`;
		mockSearch.mockRejectedValue(
			new Error(`upstream\r\n${googleKey}\u0000 ${'\ud83d\udea8'.repeat(10_000)}`)
		);

		let failure: Error | undefined;
		try {
			await searchWeb('test');
		} catch (error) {
			if (error instanceof Error) failure = error;
		}

		expect(failure).toBeInstanceOf(Error);
		const message = failure?.message ?? '';
		expect(new TextEncoder().encode(message).byteLength).toBeLessThanOrEqual(512);
		expect(message).not.toContain(googleKey);
		expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
	});

	it('logs only a bounded query label, never raw user query text', async () => {
		const secret = `Bearer ${'q'.repeat(40)}`;
		const query = `mayor contact\r\n${secret}\u0000${'private'.repeat(2_000)}`;
		mockSearch.mockResolvedValue({ results: [] });
		const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

		try {
			await searchWeb(query);
			const lines = debug.mock.calls.map((call) => call.map(String).join(' '));
			const diagnostics = [...lines, ...observedRateLimiterContexts];

			expect(diagnostics.join(' ')).not.toContain('mayor contact');
			expect(diagnostics.join(' ')).not.toContain(secret);
			const querySize = diagnostics
				.map((line) => /queryChars=(\d+)/u.exec(line)?.[1])
				.find(Boolean);
			expect(Number(querySize)).toBeGreaterThan(0);
			expect(Number(querySize)).toBeLessThanOrEqual(512);
			expect(diagnostics.every((line) => line.length <= 256)).toBe(true);
			expect(diagnostics.every((line) => !/[\u0000-\u001f\u007f-\u009f]/u.test(line))).toBe(
				true
			);
		} finally {
			debug.mockRestore();
		}
	});
});

describe('readPage', () => {
	beforeEach(() => {
		mockScrape.mockReset();
		mockGetContents.mockReset();
		mockGetContents.mockResolvedValue({ results: [] });
		observedRateLimiterContexts.length = 0;
	});

	it('calls the abortable Firecrawl transport with markdown+links+rawHtml format', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: '# Test Page\nSome content',
			links: [],
			metadata: { title: 'Test', statusCode: 200 }
		});

		await readPage('https://example.com');

		expect(mockScrape).toHaveBeenCalledTimes(1);
		const [url, options] = mockScrape.mock.calls[0];
		expect(url).toBe('https://example.com/');
		expect(options.formats).toEqual(['markdown', 'links', 'rawHtml']);
	});

	it('returns page content with correct shape', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Mayor Ted Wheeler\nEmail: mayor@portlandoregon.gov',
			links: ['mailto:mayor@portlandoregon.gov'],
			metadata: { title: 'Staff Directory', statusCode: 200 }
		});

		const result = await readPage('https://portland.gov/staff');

		expect(result).toMatchObject({
			url: 'https://portland.gov/staff',
			title: 'Staff Directory',
			statusCode: 200
		});
		expect(result!.text).toContain('Mayor Ted Wheeler');
		expect(result!.text).toContain('mayor@portlandoregon.gov');
		// mailto emails are extracted to highlights
		expect(result!.highlights).toEqual(['mayor@portlandoregon.gov']);
		expect(result!.recordBlocks).toEqual({
			state: 'blocked',
			why: 'firecrawl_returned_no_raw_html'
		});
	});

	it('logs bounded URL and title labels without credentials or provider-controlled text', async () => {
		const apiKey = `fc-${'k'.repeat(40)}`;
		const pathSecret = `private-path-${'p'.repeat(40)}`;
		const url = `https://example.com/public/${pathSecret}?api_key=${apiKey}#private`;
		const titleSecret = `provider title\r\n${apiKey}\u0000${'oversized'.repeat(2_000)}`;
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Safe rendered page content. '.repeat(20),
			links: [],
			metadata: { title: titleSecret, statusCode: 200 }
		});
		const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

		try {
			const result = await readPage(url);
			expect(result?.url).toBe(`https://example.com/public/${pathSecret}`);
			expect(new TextEncoder().encode(result?.title ?? '').byteLength).toBeLessThanOrEqual(240);
			expect(result?.title).not.toContain(apiKey);
			expect(result?.title).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);

			const lines = debug.mock.calls.map((call) => call.map(String).join(' '));
			const diagnostics = [...lines, ...observedRateLimiterContexts];
			const combined = diagnostics.join(' ');

			expect(combined).toContain('https://example.com');
			expect(combined).toContain(`titleChars=${result?.title.length}`);
			expect(combined).not.toContain(pathSecret);
			expect(combined).not.toContain(apiKey);
			expect(combined).not.toContain('provider title');
			expect(combined).not.toContain('api_key=');
			expect(combined).not.toContain('#private');
			expect(diagnostics.every((line) => line.length <= 256)).toBe(true);
			expect(diagnostics.every((line) => !/[\u0000-\u001f\u007f-\u009f]/u.test(line))).toBe(
				true
			);
		} finally {
			debug.mockRestore();
		}
	});

	it('rejects URL userinfo before starting a paid page read', async () => {
		const result = await readPage('https://user:password@example.com/private');

		expect(result).toBeNull();
		expect(mockScrape).not.toHaveBeenCalled();
		expect(observedRateLimiterContexts).toEqual([]);
	});

	it('captures emails from JS-rendered pages that Exa would miss', async () => {
		// Firecrawl renders the full page with headless browser —
		// emails in mailto: links and contact widgets are captured inline
		mockScrape.mockResolvedValue({
			success: true,
			markdown:
				'The Federal Trade Commission\n\nContact us: [opa@ftc.gov](mailto:opa@ftc.gov)\n\nOffice of Public Affairs',
			links: ['mailto:opa@ftc.gov', 'https://ftc.gov/about'],
			metadata: { title: 'About the FTC', statusCode: 200 }
		});

		const result = await readPage('https://ftc.gov/about');

		expect(result!.text).toContain('opa@ftc.gov');
		expect(result!.text).toContain('CONTACT EMAILS');
		expect(result!.title).toBe('About the FTC');
		expect(result!.highlights).toEqual(['opa@ftc.gov']);
	});

	it('ignores legacy maxCharacters option (returns full text)', async () => {
		const longContent = 'A'.repeat(20000);
		mockScrape.mockResolvedValue({
			success: true,
			markdown: longContent,
			links: [],
			metadata: { title: 'Long Page', statusCode: 200 }
		});

		const result = await readPage('https://example.com', { maxCharacters: 5000 });

		// maxCharacters is no longer honored — full text returned for grounding
		expect(result!.text.length).toBe(20000);
	});

	it('returns full page content (no artificial truncation)', async () => {
		const longContent = 'B'.repeat(50000);
		mockScrape.mockResolvedValue({
			success: true,
			markdown: longContent,
			links: [],
			metadata: { title: 'Long Page', statusCode: 200 }
		});

		const result = await readPage('https://example.com');

		expect(result!.text.length).toBe(50000);
	});

	it('applies 200K safety cap on pathological pages', async () => {
		const hugeContent = 'X'.repeat(300000);
		mockScrape.mockResolvedValue({
			success: true,
			markdown: hugeContent,
			links: [],
			metadata: { title: 'Huge Page', statusCode: 200 }
		});

		const result = await readPage('https://example.com');

		expect(result!.text.length).toBe(200000);
	});

	it('re-enforces the 200K cap after contact enrichment', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'X'.repeat(200000),
			links: ['mailto:mayor@city.gov'],
			rawHtml: '<p>clerk@city.gov</p>',
			metadata: { title: 'Full Page', statusCode: 200 }
		});

		const result = await readPage('https://city.gov/full');

		expect(result?.text).toHaveLength(200000);
		expect(result?.highlights).toEqual([]);
	});

	it('validates Firecrawl shapes and caps inspected links plus extracted emails', async () => {
		const links: unknown[] = [
			{ href: 'mailto:object@city.gov' },
			42,
			`mailto:${'x'.repeat(1_000)}@city.gov`,
			...Array.from({ length: 500 }, (_, index) => `mailto:person${index}@city.gov`)
		];
		const rawHtml = Array.from(
			{ length: 500 },
			(_, index) => `<p>html${index}@agency.gov</p>`
		).join('');
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Official public contact directory. '.repeat(20),
			links,
			rawHtml,
			metadata: { title: 'Directory', statusCode: '200' }
		});

		const result = await readPage('https://city.gov/directory');

		expect(result).not.toBeNull();
		expect(result?.highlights).toHaveLength(64);
		expect(result?.highlights?.every((email) => new TextEncoder().encode(email).byteLength <= 254)).toBe(
			true
		);
		expect(result?.highlights).not.toContain('object@city.gov');
		expect(result?.text.length).toBeLessThanOrEqual(200000);
		expect(result?.statusCode).toBeUndefined();
	});

	it('retains only same-institution links from the scraped link graph', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Official public contact directory. '.repeat(20),
			links: [
				'mailto:mayor@city.gov',
				'https://vendor.example.com/analytics',
				'https://clerk.city.gov/records',
				'/departments',
				'https://notcity.gov/impostor',
				'https://city.gov/directory'
			],
			rawHtml: '<p>Directory</p>',
			metadata: { title: 'Directory', statusCode: 200 }
		});

		const result = await readPage('https://city.gov/directory');

		expect(result?.links).toEqual([
			'https://clerk.city.gov/records',
			'https://city.gov/departments'
		]);
		expect(result?.highlights).toContain('mayor@city.gov');
	});

	it('omits the links key entirely when Firecrawl returns no link array', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Official public contact directory. '.repeat(20),
			rawHtml: '<p>Directory</p>',
			metadata: { title: 'Directory', statusCode: 200 }
		});

		const result = await readPage('https://city.gov/directory');

		expect(result).not.toBeNull();
		// Key ABSENT, not `links: undefined` and not `[]` — no link graph was evaluable
		// on this path, which is a different fact from "evaluated, nothing survived".
		expect(result && Object.prototype.hasOwnProperty.call(result, 'links')).toBe(false);
		expect(result?.links).toBeUndefined();
	});

	it('keeps the links key present and empty when a link graph was scanned with zero survivors', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Official public contact directory. '.repeat(20),
			links: [],
			rawHtml: '<p>Directory</p>',
			metadata: { title: 'Directory', statusCode: 200 }
		});

		const empty = await readPage('https://city.gov/directory');

		expect(empty).not.toBeNull();
		expect(empty && Object.prototype.hasOwnProperty.call(empty, 'links')).toBe(true);
		expect(empty?.links).toEqual([]);

		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Official public contact directory. '.repeat(20),
			links: ['https://vendor.example.com/analytics', 'https://notcity.gov/impostor'],
			rawHtml: '<p>Directory</p>',
			metadata: { title: 'Directory', statusCode: 200 }
		});

		const filtered = await readPage('https://city.gov/directory');

		expect(filtered).not.toBeNull();
		expect(filtered && Object.prototype.hasOwnProperty.call(filtered, 'links')).toBe(true);
		expect(filtered?.links).toEqual([]);
	});

	it('falls back safely when Firecrawl fields and Exa contents results have invalid shapes', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: { text: 'not a string' },
			links: 'mailto:bad@city.gov',
			rawHtml: { html: '<p>bad@city.gov</p>' },
			metadata: 'not metadata'
		});
		mockGetContents.mockResolvedValue({ results: { 0: { text: 'not an array' } } });

		await expect(readPage('https://city.gov/malformed')).resolves.toBeNull();
	});

	it('returns null when scrape has no markdown content', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: '',
			metadata: { title: 'Empty', statusCode: 200 }
		});

		const result = await readPage('https://example.com');
		expect(result).toBeNull();
	});

	it('uses only the text content type for the Exa fallback', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: '',
			metadata: { title: 'Empty', statusCode: 200 }
		});
		mockGetContents.mockResolvedValue({
			results: [
				{
					text: `Official contact: mayor@city.gov. ${'Current office information. '.repeat(10)}`,
					title: 'Official contact'
				}
			]
		});

		const result = await readPage('https://city.gov/contact');

		expect(mockGetContents).toHaveBeenCalledWith(['https://city.gov/contact'], {
			text: true,
			highlights: undefined
		});
		expect(result?.highlights).toEqual(['mayor@city.gov']);
	});

	it('leaves links undefined on the Exa contents fallback', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: '',
			metadata: { title: 'Empty', statusCode: 200 }
		});
		mockGetContents.mockResolvedValue({
			results: [
				{
					text: `Official contact: mayor@city.gov. ${'Current office information. '.repeat(10)}`,
					title: 'Official contact'
				}
			]
		});

		const result = await readPage('https://city.gov/contact');

		expect(result).not.toBeNull();
		// `undefined`, not `[]` — the fallback path retrieved no link graph at all,
		// which is a different fact from "retrieved one and nothing survived".
		expect(result?.links).toBeUndefined();
		expect(result && Object.prototype.hasOwnProperty.call(result, 'links')).toBe(false);
		expect(result?.recordBlocks).toEqual({
			state: 'blocked',
			why: 'exa_contents_returned_no_raw_html'
		});
		expect(result && Object.prototype.hasOwnProperty.call(result, 'blocks')).toBe(false);
		expect(
			result && Object.prototype.hasOwnProperty.call(result, 'institutionBoundAddresses')
		).toBe(false);
	});

	it('returns null when scrape fails', async () => {
		mockScrape.mockResolvedValue({
			success: false,
			error: 'Page not found'
		});

		const result = await readPage('https://example.com');
		expect(result).toBeNull();
	});

	it('returns null when scrapeUrl throws', async () => {
		mockScrape.mockRejectedValue(new Error('Network error'));

		const result = await readPage('https://example.com');
		expect(result).toBeNull();
	});

	it('does not start Exa fallback when Firecrawl completion is ambiguous', async () => {
		mockScrape.mockRejectedValue(
			Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' })
		);

		const result = await readPage('https://example.com/slow');

		expect(result).toBeNull();
		expect(mockGetContents).not.toHaveBeenCalled();
	});

	it('handles missing metadata gracefully', async () => {
		// Body must be ≥200 chars to clear the isUnusablePage gate on metadata-less pages
		// (no statusCode, no title → only the text-length/email check can save it).
		const body =
			'# Content here\n\n' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(6);
		mockScrape.mockResolvedValue({
			success: true,
			markdown: body,
			links: [],
			metadata: {}
		});

		const result = await readPage('https://example.com');

		expect(result!.title).toBe('');
		expect(result!.text).toBe(body);
	});

	it('extracts emails from rawHtml that markdown missed', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Mayor Mike Johnston\nContact the office for inquiries.',
			links: [],
			rawHtml:
				'<html><body><p><strong>Media inquiries only</strong><br/>720-805-8487<br/>MOComms@denvergov.org</p></body></html>',
			metadata: { title: 'Contact', statusCode: 200 }
		});

		const result = await readPage('https://denvergov.org/contact');

		expect(result!.text).toContain('MOComms@denvergov.org');
		expect(result!.text).toContain('CONTACT EMAILS (from page HTML)');
		expect(result!.highlights).toContain('MOComms@denvergov.org');
	});

	it('carries producer-shaped record blocks from Firecrawl raw HTML as a present Fact', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Official staff directory for the public works department.',
			links: [],
			rawHtml: `<div class="staff-row">
				<span>Name: Dana Reyes</span><span>Public Works Director</span>
				<a href="mailto:dana.reyes@city.gov">dana.reyes@city.gov</a>
			</div>`,
			metadata: { title: 'Staff directory', statusCode: 200 }
		});

		const result = await readPage('https://city.gov/directory');

		expect(result?.recordBlocks).toMatchObject({
			state: 'present',
			value: {
				truncated: false,
				institutionBoundAddresses: [],
					blocks: [
						{
							address: 'dana.reyes@city.gov',
							bindingScope: 'office',
							names: ['Dana Reyes'],
							titleLine: 'Public Works Director',
							bindingRejectedReason: 'person-evidence-insufficient'
						}
					]
				}
			});
		});

		it('keeps six office-title second-field costumes office-scoped through the real producer', async () => {
			const rows = [
				['Fire Marshal', '(555) 555-1212', 'fire.marshal@county.gov'],
				['Code Enforcement', 'Room 214', 'code.enforcement@city.gov'],
				['Public Works', 'Mon-Fri 8:00-4:30', 'public.works@city.gov'],
				['City Attorney', 'Legal Department', 'city.attorney@townname.gov'],
				['Building Inspector', '123 Main Street', 'building.inspector@borough.gov'],
				['District Ranger', 'Fax: (555) 555-0100', 'district.ranger@parks.gov']
			] as const;
			mockScrape.mockResolvedValue({
				success: true,
				markdown: 'Official municipal directory. '.repeat(12),
				links: [],
				rawHtml: rows
					.map(
						([officeTitle, ordinaryField, address]) =>
							`<div><span>${officeTitle}</span><span>${ordinaryField}</span><a href="mailto:${address}">${address}</a></div>`
					)
					.join(''),
				metadata: { title: 'Municipal directory', statusCode: 200 }
			});

			const result = await readPage('https://city.gov/office-directory');
			expect(result?.recordBlocks.state).toBe('present');
			if (result?.recordBlocks.state !== 'present') throw new Error('expected record blocks');
			expect(
				result.recordBlocks.value.blocks.map(({ address, names, titleLine, bindingScope }) => ({
					address,
					names,
					titleLine,
					bindingScope
				}))
			).toEqual(
				rows.map(([officeTitle, ordinaryField, address]) => ({
					address,
					names: [officeTitle],
					titleLine: ordinaryField,
					bindingScope: 'office'
				}))
			);
		});

	it('distinguishes an observed empty record scan from a truncated partial scan', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Official directory content. '.repeat(12),
			links: [],
			rawHtml: '<p>Directory with no published address</p>',
			metadata: { title: 'Directory', statusCode: 200 }
		});
		const empty = await readPage('https://city.gov/empty-directory');
		expect(empty?.recordBlocks).toEqual({ state: 'absent' });

		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Official directory content. '.repeat(12),
			links: [],
			rawHtml: `<div>Dana Reyes <a href="mailto:dana.reyes@city.gov">Email</a></div>${'x'.repeat(500_000)}`,
			metadata: { title: 'Directory', statusCode: 200 }
		});
		const partial = await readPage('https://city.gov/large-directory');
		expect(partial?.recordBlocks).toMatchObject({
			state: 'present',
			value: { truncated: true }
		});
	});

	it('keeps a truncated zero-record scan distinct from a completed absent scan', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Official directory content. '.repeat(12),
			links: [],
			rawHtml: `<div>${'No published address. '.repeat(30_000)}</div>`,
			metadata: { title: 'Large directory', statusCode: 200 }
		});

		const result = await readPage('https://city.gov/large-empty-directory');

		expect(result?.recordBlocks).toEqual({
			state: 'present',
			value: {
				blocks: [],
				institutionBoundAddresses: [],
				truncated: true
			}
		});
	});

	it('does not append addresses found only in scripts, styles, JSON-LD, or comments', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Planning office contact information.',
			links: [],
			rawHtml: `<html><body>
				<script>var tracker = "tracker@vendor.io";</script>
				<script type="application/ld+json">{"email":"schema@site.org"}</script>
				<style>/* ui@site.org */</style>
				<!-- hidden@site.org -->
				<a href="mailto:planning@city.gov">planning@city.gov</a>
			</body></html>`,
			metadata: { title: 'Planning contact', statusCode: 200 }
		});

		const result = await readPage('https://city.gov/planning');

		expect(result!.text).toContain('planning@city.gov');
		expect(result!.text).not.toContain('tracker@vendor.io');
		expect(result!.text).not.toContain('schema@site.org');
		expect(result!.text).not.toContain('ui@site.org');
		expect(result!.text).not.toContain('hidden@site.org');
	});

	it('does not duplicate emails already in markdown', async () => {
		// Body must be ≥200 chars so isUnusablePage doesn't drop the page —
		// the email being only in markdown text (no mailto link) leaves highlights
		// empty, which trips the short-text-no-email branch unless we pad.
		const body =
			'Contact: mayor@city.gov for questions. ' +
			'The mayors office handles inquiries from residents on a rolling basis. '.repeat(4);
		mockScrape.mockResolvedValue({
			success: true,
			markdown: body,
			links: [],
			rawHtml: `<html><body><p>${body}</p></body></html>`,
			metadata: { title: 'Contact', statusCode: 200 }
		});

		const result = await readPage('https://example.com');

		// Email already in markdown — should NOT appear in "from page HTML" block
		expect(result!.text).not.toContain('CONTACT EMAILS (from page HTML)');
		// Should still be in the text from markdown
		expect(result!.text).toContain('mayor@city.gov');
	});

	it('filters false positive emails from HTML (image filenames, noreply)', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Some content here',
			links: [],
			rawHtml:
				'<html><body><img src="logo@2x.png"/><a href="mailto:noreply@system.gov">No reply</a><p>real@agency.gov</p></body></html>',
			metadata: { title: 'Page', statusCode: 200 }
		});

		const result = await readPage('https://example.com');

		expect(result!.text).toContain('real@agency.gov');
		// noreply should be filtered
		expect(result!.highlights).not.toContain('noreply@system.gov');
	});

	it('works when rawHtml is not returned', async () => {
		// Body must be ≥200 chars so isUnusablePage doesn't drop the page —
		// no mailto links and no rawHtml means highlights stays empty, which
		// trips the short-text-no-email branch unless we pad the body.
		const body =
			'Content without HTML. ' + 'This page intentionally has no raw HTML returned. '.repeat(6);
		mockScrape.mockResolvedValue({
			success: true,
			markdown: body,
			links: [],
			metadata: { title: 'Page', statusCode: 200 }
		});

		const result = await readPage('https://example.com');

		expect(result!.text).toBe(body);
		expect(result!.recordBlocks).toEqual({
			state: 'blocked',
			why: 'firecrawl_returned_no_raw_html'
		});
	});

	// Affirmative gate tests — prove `isUnusablePage` filters what the comment
	// claims, not just that happy paths still work with padded fixtures.
	it('drops a page when statusCode is 404', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Real-looking long content '.repeat(50),
			links: [],
			metadata: { title: 'Some Title', statusCode: 404 }
		});

		const result = await readPage('https://example.com/missing');
		expect(result).toBeNull();
	});

	it('drops a page when title matches broken-page suffix pattern (regex covers suffix form)', async () => {
		// "Page Not Found | SF.gov" — common CMS pattern where the error
		// indicator follows the site brand. The original anchored regex
		// `^(not found|...)` missed this; the fix uses word-boundary matching.
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Long body that would otherwise pass the short-text check. '.repeat(20),
			links: [],
			metadata: { title: 'Page Not Found | SF.gov', statusCode: 200 }
		});

		const result = await readPage('https://example.com/broken');
		expect(result).toBeNull();
	});

	it('keeps a SHORT page when its markdown body contains a contact email (no false-drop)', async () => {
		// Concise official contact pages (e.g., "Email: mayor@city.gov") legitimately
		// fall under the 200-char floor. The original gate only checked Exa highlights
		// for email evidence and would false-drop these. The fix scans the body markdown
		// for email patterns before deciding the page is empty.
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Contact: mayor@city.gov',
			links: [],
			metadata: { title: 'Contact', statusCode: 200 }
		});

		const result = await readPage('https://example.com/contact');
		expect(result).not.toBeNull();
		expect(result!.text).toContain('mayor@city.gov');
	});

	it('drops a short page when there are neither highlights nor markdown emails', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Short.',
			links: [],
			metadata: { title: 'Stub', statusCode: 200 }
		});

		const result = await readPage('https://example.com/stub');
		expect(result).toBeNull();
	});

	it('does NOT trip the title regex on legitimate phrases containing bare lexemes', async () => {
		// "Gone with the Wind: Voting Rights" and "500 Cities Project" are real
		// page titles that the original bare-lexeme regex would have false-dropped.
		// The tightened phrase-form regex keeps these alive.
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Long article body about voting rights. '.repeat(20),
			links: [],
			metadata: { title: 'Gone with the Wind: Voting Rights', statusCode: 200 }
		});

		const result = await readPage('https://example.com/article');
		expect(result).not.toBeNull();
	});

	it('drops a short page whose only email is noreply@ (junk filter)', async () => {
		// Body-email fallback shares the same false-positive filter as the HTML
		// extractor — noreply / example.com / asset extensions don't count as
		// genuine contact value.
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'Auto-reply only: noreply@city.gov',
			links: [],
			metadata: { title: 'System', statusCode: 200 }
		});

		const result = await readPage('https://example.com/auto');
		expect(result).toBeNull();
	});
});

describe('prunePageContent', () => {
	it('returns short text unchanged', () => {
		const text = 'Mayor Jane Smith\nEmail: mayor@city.gov\nPhone: (555) 123-4567';
		expect(prunePageContent(text)).toBe(text);
	});

	it('preserves email-bearing paragraphs', () => {
		const paragraphs = [
			'A'.repeat(10000),
			'Contact: mayor@denvergov.org for questions.',
			'B'.repeat(10000)
		];
		const text = paragraphs.join('\n\n');

		const result = prunePageContent(text);

		expect(result).toContain('mayor@denvergov.org');
	});

	it('preserves phone-bearing paragraphs', () => {
		const paragraphs = [
			'A'.repeat(10000),
			'Call us at (303) 555-1234 for assistance.',
			'B'.repeat(10000)
		];
		const text = paragraphs.join('\n\n');

		const result = prunePageContent(text);

		expect(result).toContain('(303) 555-1234');
	});

	it('preserves paragraphs containing protected names', () => {
		const paragraphs = [
			'A'.repeat(10000),
			'Mike Johnston serves as the current Mayor of Denver.',
			'B'.repeat(10000)
		];
		const text = paragraphs.join('\n\n');

		const result = prunePageContent(text, ['Mike Johnston']);

		expect(result).toContain('Mike Johnston');
	});

	it('matches on last name alone', () => {
		const paragraphs = [
			'A'.repeat(10000),
			'The Johnston administration has prioritized housing.',
			'B'.repeat(10000)
		];
		const text = paragraphs.join('\n\n');

		const result = prunePageContent(text, ['Mike Johnston']);

		expect(result).toContain('Johnston administration');
	});

	it('strips navigation link clusters', () => {
		const navBar = '[Home](/) [About](/about) [Contact](/contact) [News](/news) [Events](/events)';
		const content = 'Mayor Mike Johnston\nEmail: mayor@denvergov.org';
		// Space navBar away from content so context expansion doesn't protect it
		const filler1 = 'C'.repeat(8000);
		const filler2 = 'C'.repeat(8000);
		const text = [navBar, filler1, content, filler2, navBar].join('\n\n');

		const result = prunePageContent(text, ['Mike Johnston']);

		expect(result).toContain('mayor@denvergov.org');
		// Both navBars should be stripped (link clusters far from protected content)
		const navCount = (result.match(/\[Home\]\(\/\)/g) || []).length;
		expect(navCount).toBeLessThanOrEqual(1);
	});

	it('strips boilerplate paragraphs', () => {
		const boilerplate = 'We use cookies to improve your experience. Read our Privacy Policy.';
		const content = 'Contact: info@agency.gov';
		// Boilerplate must be far from protected content to not get context-expanded
		const filler1 = 'D'.repeat(8000);
		const filler2 = 'D'.repeat(8000);
		const text = [
			boilerplate,
			filler1,
			content,
			filler2,
			'Subscribe to our newsletter for updates'
		].join('\n\n');

		const result = prunePageContent(text);

		expect(result).toContain('info@agency.gov');
		expect(result).not.toContain('Subscribe to our newsletter');
	});

	it('strips duplicate paragraphs', () => {
		const repeated = 'The Department of Commerce oversees trade policy.';
		const content = 'Email: commerce@state.gov for inquiries.';
		// Space duplicates away from content so they're not context-expanded
		const filler1 = 'E'.repeat(8000);
		const filler2 = 'E'.repeat(8000);
		const text = [repeated, filler1, content, filler2, repeated, repeated].join('\n\n');

		const result = prunePageContent(text);

		expect(result).toContain('commerce@state.gov');
		// First occurrence may survive as context, but dupes should be stripped
		const matchCount = (result.match(/Department of Commerce/g) || []).length;
		expect(matchCount).toBeLessThanOrEqual(2);
	});

	it('includes ±1 context around protected paragraphs', () => {
		const before = 'Office of the Mayor';
		const protected_ = 'Contact: mayor@city.gov';
		const after = 'Hours: Monday through Friday, 8am-5pm';
		const filler = 'F'.repeat(14000);
		const text = [filler, before, protected_, after, filler].join('\n\n');

		const result = prunePageContent(text);

		expect(result).toContain('mayor@city.gov');
		expect(result).toContain('Office of the Mayor');
		expect(result).toContain('Hours: Monday through Friday');
	});

	it('respects PRUNE_TARGET_CHARS budget', () => {
		const paragraphs = Array.from({ length: 50 }, (_, i) => `Paragraph ${i}: ${'G'.repeat(500)}`);
		paragraphs[25] = 'Contact: test@example.gov';
		const text = paragraphs.join('\n\n');

		const result = prunePageContent(text);

		expect(result.length).toBeLessThanOrEqual(15000);
		expect(result).toContain('test@example.gov');
	});

	it('falls back to truncation if safety invariant fails', () => {
		// Create a scenario where an email could be lost by pruning.
		// This is hard to trigger since protected paragraphs are always kept,
		// but we test by verifying the function never drops an email.
		const emails = Array.from({ length: 20 }, (_, i) => `user${i}@test.gov`);
		const paragraphs = emails.map((e) => `Contact: ${e}\n${'H'.repeat(800)}`);
		const text = paragraphs.join('\n\n');

		const result = prunePageContent(text);

		// All emails present in result (either via pruning or fallback truncation)
		for (const email of emails) {
			if (text.indexOf(email) < 15000) {
				expect(result).toContain(email);
			}
		}
	});

	it('does not strip link clusters that contain emails', () => {
		const staffDir = [
			'[John Smith, Mayor](mailto:john@city.gov)',
			'[Jane Doe, Manager](mailto:jane@city.gov)',
			'[Bob Wilson, Director](mailto:bob@city.gov)',
			'[Alice Chen, Clerk](mailto:alice@city.gov)'
		].join('\n');
		const filler = 'I'.repeat(10000);
		const text = [filler, staffDir, filler].join('\n\n');

		const result = prunePageContent(text);

		expect(result).toContain('john@city.gov');
		expect(result).toContain('jane@city.gov');
	});
});
