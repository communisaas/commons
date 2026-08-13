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

// extractContactHints is used by prunePageContent — provide the real implementation
vi.mock('$lib/core/agents/agents/decision-maker', () => ({
	extractContactHints: (text: string) => {
		const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
		const phoneRe = /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
		const socialRe = /https?:\/\/(?:www\.)?(?:twitter|x|linkedin|facebook)\.com\/[^\s)"\]]+/gi;
		return {
			emails: [...new Set(text.match(emailRe) || [])],
			phones: [...new Set(text.match(phoneRe) || [])],
			socialUrls: [...new Set(text.match(socialRe) || [])].slice(0, 5)
		};
	}
}));

import { searchWeb, readPage, prunePageContent } from '$lib/core/agents/exa-search';
import { readPageOutcome } from '$lib/core/agents/exa-search';

const EXA_TEST_INTERSTITIAL_MAX_CHARACTERS = 200;

const blockedPage = {
	success: true,
	markdown:
		'CLOUDFLARE_CHALLENGE_BODY /cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1',
	rawHtml: '<html><title>Just a moment...</title></html>',
	links: [],
	metadata: { title: 'Just a moment...', statusCode: 200 }
};

const missingPage = {
	success: true,
	markdown: 'CommonSpirit Health branded page shell '.padEnd(141_000, 'x'),
	links: [],
	metadata: { title: '404 | CommonSpirit Health', statusCode: 404 }
};

const stubPage = {
	success: true,
	markdown: 'Tiny contact stub.',
	links: [],
	metadata: { title: 'Contact', statusCode: 200 }
};

const contactPage = {
	success: true,
	markdown: 'Office contact: clerk@county.gov',
	links: [],
	metadata: { title: 'County Clerk Contact', statusCode: 200 }
};

const capturedVendorBlocks = [
	{
		vendor: 'cloudflare',
		statusCode: 403,
		title: 'Just a moment...',
		text: 'Enable JavaScript and cookies to continue.',
		rawHtml:
			'<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'
	},
	{
		vendor: 'akamai',
		statusCode: 403,
		title: 'Access Denied',
		text:
			'Access denied. See https://errors&#46;edgesuite&#46;net/18.d0ac0317 for details.',
		rawHtml: ''
	},
	{
		vendor: 'perimeterx',
		statusCode: 403,
		title: 'Access to this page has been denied',
		text: 'Press and hold to confirm you are a human.',
		rawHtml: '<div id="px-captcha"></div>'
	},
	{
		vendor: 'vercel',
		statusCode: 429,
		title: 'Vercel Security Checkpoint',
		text: 'Please wait while the checkpoint completes.',
		rawHtml: ''
	},
	{
		vendor: 'radware',
		statusCode: 200,
		title: 'Radware Bot Manager Captcha',
		text: 'Complete the captcha to continue.',
		rawHtml: ''
	}
] as const;

const attributableExaFallbackBlocks = [
	{
		source: 'cisco.com 403',
		vendor: 'akamai',
		title: 'Access Denied',
		text: 'Access denied. See https://errors&#46;edgesuite&#46;net/18.d0ac0317.'
	},
	{
		source: 'sutterhealth.org 429',
		vendor: 'vercel',
		title: 'Vercel Security Checkpoint',
		text: 'Please wait while the checkpoint completes.'
	},
	{
		source: 'mn.gov 200',
		vendor: 'radware',
		title: 'Radware Bot Manager Captcha',
		text: 'Complete the captcha to continue.'
	}
] as const;

const unattributableExaFallbackStops = [
	{
		source: 'chla.org 403',
		unreachableVendor: 'cloudflare',
		title: 'Just a moment...',
		text: 'Just a moment...',
		textLength: 16
	},
	{
		source: 'zillow.com 403',
		unreachableVendor: 'perimeterx',
		title: 'Access to this page has been denied',
		text: 'Access to this page has been denied',
		textLength: 35
	}
] as const;

const bodyProseCloudflareBlocks = [
	{
		source: 'crunchbase.com Cloudflare 1020',
		statusCode: 403,
		title: 'Attention Required! | Cloudflare',
		text: 'Sorry, you have been blocked. Cloudflare Ray ID: 8f1234567890abcd'.padEnd(
			773,
			'x'
		),
		textLength: 773,
		evidence: 'cloudflare ray id:'
	}
] as const;

const indeedFirecrawlBlock = {
	source: 'indeed.com additional verification',
	statusCode: 403,
	title: 'Security Check - Indeed.com',
	markdown: 'Security verification page.'.padEnd(27, 'x'),
	rawHtml: [
		'<noscript><h1>Additional Verification Required</h1>',
		'Enable JavaScript and cookies to continue.</noscript>',
		'<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'
	].join('')
} as const;

const readableBodyProsePages = [
	{
		source: 'codeforces.com forum discussion',
		title: 'Browser errors discussed by contest users',
		text: 'A forum post quotes: Enable JavaScript and cookies to continue.'.padEnd(60_968, 'x'),
		textLength: 60_968
	},
	{
		source: 'dev.to support article',
		title: 'Debugging an edge security error',
		text: 'The article quotes: Sorry, you have been blocked. Cloudflare Ray ID: example'.padEnd(
			4_818,
			'x'
		),
		textLength: 4_818
	}
] as const;

describe('readPageOutcome', () => {
	beforeEach(() => {
		mockSearch.mockReset();
		mockGetContents.mockReset();
		mockGetContents.mockResolvedValue({ results: [] });
		mockScrape.mockReset();
		observedRateLimiterContexts.length = 0;
	});

	it('returns blocked for a Cloudflare body without retaining that body as a page', async () => {
		mockScrape.mockResolvedValue(blockedPage);

		const result = await readPageOutcome('https://example.com/challenge');

		expect(result.outcome).toBe('blocked');
		if (result.outcome !== 'blocked' || result.reason !== 'waf') {
			throw new Error('expected WAF-blocked outcome');
		}
		expect(result.signal.vendor).toBe('cloudflare');
		expect('page' in result).toBe(false);
		expect(JSON.stringify(result)).not.toContain(blockedPage.markdown);
	});

	it('returns absent/not_found for a branded 404 shell', async () => {
		mockScrape.mockResolvedValue(missingPage);

		const result = await readPageOutcome('https://example.com/missing');

		expect(result.outcome).toBe('absent');
		if (result.outcome !== 'absent') throw new Error('expected absent outcome');
		expect(result.reason).toBe('not_found');
	});

	it('returns absent/not_found for a rendered HTTP-200 soft-404 title', async () => {
		const markdown = 'CommonSpirit Health branded page shell '.padEnd(141_000, 'x');
		mockScrape.mockResolvedValue({
			success: true,
			markdown,
			links: [],
			metadata: { title: 'Page Not Found | CommonSpirit Health', statusCode: 200 }
		});

		const result = await readPageOutcome('https://example.com/soft-404');

		expect(result).toMatchObject({ outcome: 'absent', reason: 'not_found', statusCode: 200 });
		expect('page' in result).toBe(false);
		expect(JSON.stringify(result)).not.toContain(markdown);
	});

	it('keeps a rendered H.R. 404 page readable when Firecrawl returns a usable contact', async () => {
		const markdown =
			'H.R. 404 sponsors and committee information. Contact judiciary@mail.house.gov for records.'.padEnd(
				3_000,
				'x'
			);
		mockScrape.mockResolvedValue({
			success: true,
			markdown,
			links: [],
			metadata: { title: 'H.R. 404 - Sponsors | congress.gov', statusCode: 200 }
		});

		const result = await readPageOutcome('https://example.com/rendered-hr-404');

		expect(result.outcome).toBe('ok');
		if (result.outcome !== 'ok') throw new Error('expected ok outcome');
		expect(result.page.text).toBe(markdown);
		expect(result.page.text).toContain('judiciary@mail.house.gov');
	});

	it('returns blocked/transport for a read HTTP error that is not not-found', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'The upstream application is temporarily unavailable.'.padEnd(500, 'x'),
			links: [],
			metadata: { title: 'Temporary upstream error', statusCode: 503 }
		});

		const result = await readPageOutcome('https://example.com/upstream-error');

		expect(result).toMatchObject({
			outcome: 'blocked',
			reason: 'transport',
			detail: 'http_status_503'
		});
		expect('page' in result).toBe(false);
	});

	it('returns absent/empty for a short stub with no usable email', async () => {
		mockScrape.mockResolvedValue(stubPage);

		const result = await readPageOutcome('https://example.com/stub');

		expect(result.outcome).toBe('absent');
		if (result.outcome !== 'absent') throw new Error('expected absent outcome');
		expect(result.reason).toBe('empty');
	});

	it('returns ok with a real contact page', async () => {
		mockScrape.mockResolvedValue(contactPage);

		const result = await readPageOutcome('https://example.com/contact');

		expect(result.outcome).toBe('ok');
		if (result.outcome !== 'ok') throw new Error('expected ok outcome');
		expect(result.page.text).toContain('clerk@county.gov');
	});

	it.each(capturedVendorBlocks)(
		'blocks the captured $vendor marker on the Firecrawl path with status',
		async (capture) => {
			mockScrape.mockResolvedValue({
				success: true,
				markdown: capture.text,
				rawHtml: capture.rawHtml,
				links: [],
				metadata: { title: capture.title, statusCode: capture.statusCode }
			});

			const result = await readPageOutcome(`https://example.com/${capture.vendor}-firecrawl`);

			expect(result.outcome).toBe('blocked');
			if (result.outcome !== 'blocked' || result.reason !== 'waf') {
				throw new Error('expected WAF-blocked outcome');
			}
			expect(result.signal.vendor).toBe(capture.vendor);
			expect('page' in result).toBe(false);
			expect(JSON.stringify(result)).not.toContain(capture.text);
		}
	);

	it.each(bodyProseCloudflareBlocks)(
		'blocks body prose from $source on the Firecrawl path',
		async (capture) => {
			expect(capture.text).toHaveLength(capture.textLength);
			mockScrape.mockResolvedValue({
				success: true,
				markdown: capture.text,
				links: [],
				metadata: { title: capture.title, statusCode: capture.statusCode }
			});

			const result = await readPageOutcome('https://example.com/body-prose-firecrawl');

			expect(result.outcome).toBe('blocked');
			if (result.outcome !== 'blocked' || result.reason !== 'waf') {
				throw new Error('expected WAF-blocked outcome');
			}
			expect(result.signal).toMatchObject({
				vendor: 'cloudflare',
				evidence: capture.evidence,
				statusCode: capture.statusCode
			});
			expect('page' in result).toBe(false);
			expect(JSON.stringify(result)).not.toContain(capture.text);
		}
	);

	it('blocks the Indeed Firecrawl capture through raw challenge evidence, not noscript prose', async () => {
		expect(indeedFirecrawlBlock.markdown).toHaveLength(27);
		expect(indeedFirecrawlBlock.markdown).not.toContain('Enable JavaScript and cookies to continue');
		mockScrape.mockResolvedValue({
			success: true,
			markdown: indeedFirecrawlBlock.markdown,
			rawHtml: indeedFirecrawlBlock.rawHtml,
			links: [],
			metadata: {
				title: indeedFirecrawlBlock.title,
				statusCode: indeedFirecrawlBlock.statusCode
			}
		});

		const result = await readPageOutcome('https://example.com/indeed-firecrawl');

		expect(result.outcome).toBe('blocked');
		if (result.outcome !== 'blocked' || result.reason !== 'waf') {
			throw new Error('expected WAF-blocked outcome');
		}
		expect(result.signal).toMatchObject({
			vendor: 'cloudflare',
			evidence: '/cdn-cgi/challenge-platform/h/',
			statusCode: 403
		});
		expect('page' in result).toBe(false);
		expect(JSON.stringify(result)).not.toContain(indeedFirecrawlBlock.rawHtml);
	});

	it.each(readableBodyProsePages)(
		'keeps the HTTP-200 $source body-prose quotation readable on Firecrawl',
		async (capture) => {
			expect(capture.text).toHaveLength(capture.textLength);
			expect(capture.text).not.toContain('@');
			mockScrape.mockResolvedValue({
				success: true,
				markdown: capture.text,
				links: [],
				metadata: { title: capture.title, statusCode: 200 }
			});

			const result = await readPageOutcome('https://example.com/readable-body-prose-firecrawl');

			expect(result.outcome).toBe('ok');
			if (result.outcome !== 'ok') throw new Error('expected ok outcome');
			expect(result.page.text).toBe(capture.text);
		}
	);

	it.each(attributableExaFallbackBlocks)(
		'attributes the $source block to $vendor on honest Exa text',
		async (capture) => {
			mockScrape.mockRejectedValue(
				Object.assign(new Error('Firecrawl unavailable'), { status: 503 })
			);
			mockGetContents.mockResolvedValue({
				results: [{ title: capture.title, text: capture.text }]
			});

			const result = await readPageOutcome(`https://example.com/${capture.vendor}-exa`);

			expect(result.outcome).toBe('blocked');
			if (result.outcome !== 'blocked' || result.reason !== 'waf') {
				throw new Error('expected WAF-blocked outcome');
			}
			expect(result.signal.vendor).toBe(capture.vendor);
			expect('statusCode' in result.signal).toBe(false);
			expect('page' in result).toBe(false);
			expect(JSON.stringify(result)).not.toContain(capture.text);
			expect(mockGetContents).toHaveBeenCalledWith(
				[`https://example.com/${capture.vendor}-exa`],
				{ text: true, highlights: undefined }
			);
		}
	);

	it.each(bodyProseCloudflareBlocks)(
		'keeps body prose from $source readable on the status-less Exa path',
		async (capture) => {
			expect(capture.text).toHaveLength(capture.textLength);
			mockScrape.mockRejectedValue(
				Object.assign(new Error('Firecrawl unavailable'), { status: 503 })
			);
			mockGetContents.mockResolvedValue({
				results: [{ title: capture.title, text: capture.text }]
			});

			const result = await readPageOutcome('https://example.com/body-prose-exa');

			expect(result.outcome).toBe('ok');
			if (result.outcome !== 'ok') throw new Error('expected ok outcome');
			expect(result.page.text).toBe(capture.text);
			expect(mockGetContents).toHaveBeenCalledWith(
				['https://example.com/body-prose-exa'],
				{ text: true, highlights: undefined }
			);
		}
	);

	it('treats honest nonempty Indeed Exa text as blocked transport, not absence', async () => {
		const text = indeedFirecrawlBlock.markdown;
		expect(text).toHaveLength(27);
		expect(text).not.toContain('Additional Verification Required');
		expect(text).not.toContain('Enable JavaScript and cookies to continue');
		mockScrape.mockRejectedValue(
			Object.assign(new Error('Firecrawl unavailable'), { status: 503 })
		);
		mockGetContents.mockResolvedValue({
			results: [{ title: indeedFirecrawlBlock.title, text }]
		});

		const result = await readPageOutcome('https://example.com/indeed-exa');

		expect(result).toMatchObject({
			outcome: 'blocked',
			reason: 'transport',
			detail: 'short_unusable_body'
		});
		expect('signal' in result).toBe(false);
		expect('page' in result).toBe(false);
		expect(mockGetContents).toHaveBeenCalledWith(
			['https://example.com/indeed-exa'],
			{ text: true, highlights: undefined }
		);
	});

	it.each(readableBodyProsePages)(
		'keeps the status-less $source body-prose quotation readable on Exa',
		async (capture) => {
			expect(capture.text).toHaveLength(capture.textLength);
			expect(capture.text).not.toContain('@');
			mockScrape.mockRejectedValue(
				Object.assign(new Error('Firecrawl unavailable'), { status: 503 })
			);
			mockGetContents.mockResolvedValue({
				results: [{ title: capture.title, text: capture.text }]
			});

			const result = await readPageOutcome('https://example.com/readable-body-prose-exa');

			expect(result.outcome).toBe('ok');
			if (result.outcome !== 'ok') throw new Error('expected ok outcome');
			expect(result.page.text).toBe(capture.text);
			expect(mockGetContents).toHaveBeenCalledWith(
				['https://example.com/readable-body-prose-exa'],
				{ text: true, highlights: undefined }
			);
		}
	);

	it.each(unattributableExaFallbackStops)(
		'blocks the $source text-only stop as transport without inventing $unreachableVendor',
		async (capture) => {
			expect(capture.text).toHaveLength(capture.textLength);
			mockScrape.mockRejectedValue(
				Object.assign(new Error('Firecrawl unavailable'), { status: 503 })
			);
			mockGetContents.mockResolvedValue({
				results: [{ title: capture.title, text: capture.text }]
			});

			const result = await readPageOutcome(
				`https://example.com/${capture.unreachableVendor}-exa`
			);

			expect(result).toMatchObject({
				outcome: 'blocked',
				reason: 'transport',
				detail: 'unusable_title'
			});
			expect('signal' in result).toBe(false);
			expect('page' in result).toBe(false);
			expect(JSON.stringify(result)).not.toContain(capture.text);
			expect(mockGetContents).toHaveBeenCalledWith(
				[`https://example.com/${capture.unreachableVendor}-exa`],
				{ text: true, highlights: undefined }
			);
		}
	);

	it.each([
		{
			name: 'Cloudflare JS Detections',
			email: 'boardclerk@hospital.org',
			markdown: 'Hospital board members. Email boardclerk@hospital.org.'.padEnd(3_000, 'x'),
			rawHtml: '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'
		},
		{
			name: 'DataDome client tag',
			email: 'council@city.gov',
			markdown: 'City council agendas. Email council@city.gov.'.padEnd(3_000, 'x'),
			rawHtml: '<script src="https://js.datadome.co/tags.js"></script>'
		},
		{
			name: 'institutional Incident ID prose',
			email: 'records@city.gov',
			markdown:
				'Provide the Incident ID: 2024-01187 and email records@city.gov.'.padEnd(3_000, 'x'),
			rawHtml: '<main>Police records request instructions</main>'
		},
		{
			name: 'PerimeterX custom-prefix sensor',
			email: 'press@walmart.com',
			markdown: 'Corporate press resources. Email press@walmart.com.'.padEnd(4_000, 'x'),
			rawHtml: '<script src="/_px/PXu6b0qd2S/main.min.js"></script>'
		},
		{
			name: 'AWS WAF integration script',
			email: 'support@imdb.com',
			markdown: 'Help articles and customer support. Email support@imdb.com.'.padEnd(3_000, 'x'),
			rawHtml: '<script src="https://token.awswaf.com/challenge.js"></script>'
		},
		{
			name: 'full Imperva sensor and Incident ID conjunction',
			email: 'records@austintexas.gov',
			markdown:
				'Provide the Incident ID: 2024-01187 and email records@austintexas.gov.'.padEnd(
					3_136,
					'x'
				),
			rawHtml: '<script src="/_Incapsula_Resource?SWJIYLWA=1&ns=2&cb=123"></script>'
		},
		{
			name: 'Radware unusual-activity vendor disclosure',
			email: 'security@county.gov',
			markdown:
				'Our vendor list includes Radware Bot Manager, which flags unusual activity. Email security@county.gov.'.padEnd(
					3_000,
					'x'
				),
			rawHtml: '<main>County IT vendor disclosure</main>'
		},
		{
			name: 'cf-mitigated response-header documentation',
			email: 'security@county.gov',
			markdown:
				'This advisory discusses the cf-mitigated response header. Email security@county.gov.'.padEnd(
					3_000,
					'x'
				),
			rawHtml: '<main>HTTP response-header documentation</main>'
		}
	])('keeps a readable HTTP-200 page with $name as content', async ({ email, markdown, rawHtml }) => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown,
			rawHtml,
			links: [],
			metadata: { title: 'Official Contact Directory', statusCode: 200 }
		});

		const result = await readPageOutcome('https://example.com/official-contact');

		expect(result.outcome).toBe('ok');
		if (result.outcome !== 'ok') throw new Error('expected ok outcome');
		expect(result.page.text).toContain(email);
	});

	it('returns absent/not_found after Exa reads a status-less soft-404 result', async () => {
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl unavailable'), { status: 503 }));
		mockGetContents.mockResolvedValue({
			results: [
				{
					title: '404 | CommonSpirit Health',
					text: 'CommonSpirit Health branded page shell '.padEnd(141_000, 'x')
				}
			]
		});

		const result = await readPageOutcome('https://example.com/fallback-missing');

		expect(result).toMatchObject({
			outcome: 'absent',
			reason: 'not_found'
		});
		expect('page' in result).toBe(false);
		expect(mockGetContents).toHaveBeenCalledTimes(1);
	});

	it('keeps a congressional H.R. 404 page readable when Exa returns a usable contact', async () => {
		const text =
			'H.R. 404 sponsors and committee information. Contact judiciary@mail.house.gov for records.'.padEnd(
				3_000,
				'x'
			);
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl unavailable'), { status: 503 }));
		mockGetContents.mockResolvedValue({
			results: [{ title: 'H.R. 404 - Sponsors | congress.gov', text }]
		});

		const result = await readPageOutcome('https://example.com/hr-404');

		expect(result.outcome).toBe('ok');
		if (result.outcome !== 'ok') throw new Error('expected ok outcome');
		expect(result.page.text).toBe(text);
		expect(result.page.text).toContain('judiciary@mail.house.gov');
	});

	it('treats a status-less Access Denied title as blocked, not absent', async () => {
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl unavailable'), { status: 503 }));
		mockGetContents.mockResolvedValue({
			results: [
				{
					title: 'Access Denied',
					text: 'Reference 18.27f51602.1786144462.13d417a1'
				}
			]
		});

		await expect(
			readPageOutcome('https://example.com/fallback-access-denied')
		).resolves.toMatchObject({
			outcome: 'blocked',
			reason: 'transport',
			detail: 'unusable_title'
		});
	});

	it('keeps a full Exa page readable when only its title resembles a stop', async () => {
		const text = 'Meeting minutes begin with a brief “just a moment” note.'.padEnd(3_000, 'x');
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl unavailable'), { status: 503 }));
		mockGetContents.mockResolvedValue({
			results: [{ title: 'Just a moment...', text }]
		});

		const result = await readPageOutcome('https://example.com/readable-stop-title');

		expect(result.outcome).toBe('ok');
		if (result.outcome !== 'ok') throw new Error('expected ok outcome');
		expect(result.page.text).toBe(text);
	});

	it.each([
		'Access denied appeals: email clerk@county.gov.',
		'Access denied appeals: call the clerk at (555) 010-1234.'
	])('keeps a tiny stop-title Exa page with visible contact readable', async (text) => {
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl unavailable'), { status: 503 }));
		mockGetContents.mockResolvedValue({
			results: [{ title: 'Access Denied', text }]
		});

		const result = await readPageOutcome('https://example.com/stop-title-contact');

		expect(result.outcome).toBe('ok');
		if (result.outcome !== 'ok') throw new Error('expected ok outcome');
		expect(result.page.text).toBe(text);
	});

	it.each([
		{
			shape: '49-character township email stub',
			title: 'Township Officials',
			text: 'Email: clerk@township.gov'.padStart(49, 'x')
		},
		{
			shape: '43-character selectmen phone entry',
			title: 'Board of Selectmen',
			text: 'Call (555) 010-1234'.padStart(43, 'x')
		},
		{
			shape: '199-character official email page',
			title: 'Official Contact',
			text: 'Email: clerk@county.gov'.padStart(199, 'x')
		},
		{
			shape: 'access-denied title with email',
			title: 'Access Denied',
			text: 'Appeals: clerk@county.gov'
		},
		{
			shape: 'access-denied title with phone',
			title: 'Access Denied',
			text: 'Appeals: call (555) 010-1234'
		},
		{
			shape: 'page-not-found title with email',
			title: 'Page Not Found | County Records',
			text: 'Records: clerk@county.gov'
		},
		{
			shape: 'legislative 404 title with email',
			title: 'H.R. 404 - Sponsors',
			text: 'Committee: judiciary@mail.house.gov'
		},
		{
			shape: 'just-a-moment title with email',
			title: 'Just a moment...',
			text: 'Meeting clerk: clerk@county.gov'
		},
		{
			shape: 'service-unavailable title with phone',
			title: 'Service Unavailable',
			text: 'Service desk: phone (555) 010-1234'
		}
	])('keeps the short readable Exa shape $shape as content', async ({ title, text }) => {
		expect(text.length).toBeLessThan(EXA_TEST_INTERSTITIAL_MAX_CHARACTERS);
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl unavailable'), { status: 503 }));
		mockGetContents.mockResolvedValue({ results: [{ title, text }] });

		const result = await readPageOutcome('https://example.com/short-readable');

		expect(result.outcome).toBe('ok');
		if (result.outcome !== 'ok') throw new Error('expected ok outcome');
		expect(result.page.text).toBe(text);
	});

	it.each([
		{
			shape: '16-character meeting stub',
			title: 'Meeting note',
			text: 'Agenda follows...'
		},
		{
			shape: '76-character body-prose discussion',
			title: 'Browser automation discussion',
			text: 'Enable JavaScript and cookies to continue.'.padEnd(76, 'x')
		},
		{
			shape: '199-character contact-free page',
			title: 'Office information',
			text: 'Office information is being updated.'.padEnd(199, 'x')
		}
	])('routes the contact-free Exa $shape to blocked transport', async ({ title, text }) => {
		expect(text.length).toBeGreaterThan(0);
		expect(text.length).toBeLessThan(EXA_TEST_INTERSTITIAL_MAX_CHARACTERS);
		expect(text).not.toContain('@');
		expect(text).not.toMatch(/\d{3}/u);
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl unavailable'), { status: 503 }));
		mockGetContents.mockResolvedValue({ results: [{ title, text }] });

		await expect(readPageOutcome('https://example.com/contact-free-short')).resolves.toMatchObject({
			outcome: 'blocked',
			reason: 'transport',
			detail: 'short_unusable_body'
		});
	});

	it('treats an HTTP-200 unusable stop title as blocked, not absent', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'The upstream service returned an interstitial.'.padEnd(500, 'x'),
			links: [],
			metadata: { title: 'Service Unavailable', statusCode: 200 }
		});

		await expect(readPageOutcome('https://example.com/served-stop-title')).resolves.toMatchObject({
			outcome: 'blocked',
			reason: 'transport',
			detail: 'unusable_title'
		});
	});

	it.each([
		{
			name: 'generic Incident ID prose when the provider returned no status',
			text: 'Provide the Incident ID: 2024-01187 when requesting a copy.'.padEnd(900, 'x')
		},
		{
			name: 'public-records appeal instructions using Reference number prose',
			text:
				'If your request is access denied in whole or in part, cite the Reference # from your denial letter and email publicrecords@county.gov.'.padEnd(
					6_000,
					'x'
				)
		},
		{
			name: 'institutional prose mentioning its DataDome vendor',
			text: 'Our vendor list includes DataDome for bot mitigation.'.padEnd(3_000, 'x')
		}
	])('keeps readable Exa fallback content with $name', async ({ text }) => {
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl unavailable'), { status: 503 }));
		mockGetContents.mockResolvedValue({
			results: [{ title: 'County IT and Records', text }]
		});

		const result = await readPageOutcome('https://example.com/fallback-readable');

		expect(result.outcome).toBe('ok');
		if (result.outcome !== 'ok') throw new Error('expected ok outcome');
		expect(result.page.text).toBe(text);
		expect(mockGetContents).toHaveBeenCalledTimes(1);
	});

	it('blocks a generic challenge whose only address-shaped token is an image filename', async () => {
		const challengeBody = 'Request blocked. Asset reference: hero@2x.jpeg';
		mockScrape.mockResolvedValue({
			success: true,
			markdown: challengeBody,
			links: [],
			metadata: { title: 'Access Denied', statusCode: 403 }
		});

		const result = await readPageOutcome('https://example.com/image-token-challenge');

		expect(result.outcome).toBe('blocked');
		if (result.outcome !== 'blocked' || result.reason !== 'waf') {
			throw new Error('expected WAF-blocked outcome');
		}
		expect(result.signal).toMatchObject({
			vendor: 'unknown',
			evidence: 'access denied',
			statusCode: 403
		});
		expect('page' in result).toBe(false);
		expect(JSON.stringify(result)).not.toContain(challengeBody);
	});

	it('keeps the full former Imperva conjunction on an HTTP-200 records page', async () => {
		const markdown =
			'Austin Police records: provide the Incident ID: 2024-01187 and email records@austintexas.gov.'.padEnd(
				3_136,
				'x'
			);
		const rawHtml =
			'<script src="/_Incapsula_Resource?SWJIYLWA=1&ns=2&cb=123"></script>'.padEnd(
				108_286,
				'x'
			);
		mockScrape.mockResolvedValue({
			success: true,
			markdown,
			rawHtml,
			links: [],
			metadata: { title: 'Police Records | AustinTexas.gov', statusCode: 200 }
		});

		const result = await readPageOutcome('https://www.austintexas.gov/police/records');

		expect(result.outcome).toBe('ok');
		if (result.outcome !== 'ok') throw new Error('expected ok outcome');
		expect(result.page.text).toBe(markdown);
	});

	it('blocks the captured HTTP-200 Radware captcha title without retaining its body', async () => {
		const challengeBody = 'RADWARE_CHALLENGE_BODY Complete the captcha to continue.';
		mockScrape.mockResolvedValue({
			success: true,
			markdown: challengeBody,
			links: [],
			metadata: { title: 'Radware Bot Manager Captcha', statusCode: 200 }
		});

		const result = await readPageOutcome('https://example.com/radware-challenge');

		expect(result.outcome).toBe('blocked');
		if (result.outcome !== 'blocked' || result.reason !== 'waf') {
			throw new Error('expected WAF-blocked outcome');
		}
		expect(result.signal).toMatchObject({
			vendor: 'radware',
			evidence: 'radware bot manager captcha',
			statusCode: 200
		});
		expect(JSON.stringify(result)).not.toContain(challengeBody);
	});

	it('returns blocked/not_attempted for a malformed URL without dispatching a provider', async () => {
		const result = await readPageOutcome('not a public URL');

		expect(result).toMatchObject({
			outcome: 'blocked',
			reason: 'not_attempted',
			detail: 'invalid_url'
		});
		expect(mockScrape).not.toHaveBeenCalled();
		expect(mockGetContents).not.toHaveBeenCalled();
	});

	it('returns blocked/transport for a completion-unknown socket failure', async () => {
		mockScrape.mockRejectedValue(new Error('socket hang up'));

		const result = await readPageOutcome('https://example.com/socket-failure');

		expect(result).toMatchObject({
			outcome: 'blocked',
			reason: 'transport',
			detail: 'firecrawl_completion_unknown'
		});
		expect(mockGetContents).not.toHaveBeenCalled();
	});

	it('returns blocked/transport when Firecrawl and the Exa fallback both fail', async () => {
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl 503'), { status: 503 }));
		mockGetContents.mockRejectedValue(Object.assign(new Error('Exa 500'), { status: 500 }));

		const result = await readPageOutcome('https://example.com/provider-failure');

		expect(result).toMatchObject({
			outcome: 'blocked',
			reason: 'transport',
			detail: 'exa_failed'
		});
		expect(mockGetContents).toHaveBeenCalledTimes(1);
	});

	it('returns blocked/transport when the Exa fallback never returns a source result', async () => {
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl 503'), { status: 503 }));
		mockGetContents.mockResolvedValue({ results: [] });

		await expect(readPageOutcome('https://example.com/no-fallback-result')).resolves.toMatchObject({
			outcome: 'blocked',
			reason: 'transport',
			detail: 'exa_no_result'
		});
	});

	it('returns blocked/transport for a malformed Exa fallback result', async () => {
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl 503'), { status: 503 }));
		mockGetContents.mockResolvedValue({ results: [null] });

		await expect(readPageOutcome('https://example.com/malformed-fallback')).resolves.toMatchObject({
			outcome: 'blocked',
			reason: 'transport',
			detail: 'exa_malformed_result'
		});
	});

	it('returns absent/empty only after the Exa fallback returned an empty source body', async () => {
		mockScrape.mockRejectedValue(Object.assign(new Error('Firecrawl 503'), { status: 503 }));
		mockGetContents.mockResolvedValue({ results: [{ title: 'Empty page', text: '' }] });

		await expect(readPageOutcome('https://example.com/empty-fallback')).resolves.toMatchObject({
			outcome: 'absent',
			reason: 'empty'
		});
	});

	it('keeps readPage wrapper parity for blocked, missing, empty, and ok pages', async () => {
		mockScrape.mockResolvedValue(blockedPage);
		await expect(readPage('https://example.com/challenge')).resolves.toBeNull();

		mockScrape.mockResolvedValue(missingPage);
		await expect(readPage('https://example.com/missing')).resolves.toBeNull();

		mockScrape.mockResolvedValue(stubPage);
		await expect(readPage('https://example.com/stub')).resolves.toBeNull();

		mockScrape.mockResolvedValue(contactPage);
		await expect(readPage('https://example.com/contact')).resolves.toMatchObject({
			text: expect.stringContaining('clerk@county.gov')
		});
	});
});

void searchWeb;
void prunePageContent;
