import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockSearch = vi.fn();
// `scrape` is the v4+ Firecrawl SDK method; `scrapeUrl` is the legacy
// alias. Production code calls `firecrawl.scrape(url, { formats: [...] })`
// (see exa-search.ts:253), so the mock client must expose `scrape`.
const mockScrape = vi.fn();

// Mock rate limiter that executes immediately without throttling
const createMockRateLimiter = () => ({
	execute: async <T>(fn: () => Promise<T>, _context: string) => {
		try {
			const data = await fn();
			return { success: true, data, attempts: 1, wasRateLimited: false };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				attempts: 1,
				wasRateLimited: false
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
	getExaClient: () => ({
		search: mockSearch
	}),
	getSearchRateLimiter: () => mockSearchRateLimiter
}));

vi.mock('$lib/server/firecrawl', () => ({
	getFirecrawlClient: () => ({
		scrape: mockScrape
	}),
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

describe('searchWeb', () => {
	beforeEach(() => {
		mockSearch.mockReset();
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

	it('defaults to 25 results', async () => {
		mockSearch.mockResolvedValue({ results: [] });

		await searchWeb('test query');

		const options = mockSearch.mock.calls[0][1];
		expect(options.numResults).toBe(25);
	});

	it('respects custom maxResults', async () => {
		mockSearch.mockResolvedValue({ results: [] });

		await searchWeb('test query', { maxResults: 10 });

		const options = mockSearch.mock.calls[0][1];
		expect(options.numResults).toBe(10);
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

	it('throws when search fails', async () => {
		mockSearch.mockRejectedValue(new Error('Rate limited'));

		await expect(searchWeb('test')).rejects.toThrow('Search failed');
	});
});

describe('readPage', () => {
	beforeEach(() => {
		mockScrape.mockReset();
	});

	it('calls firecrawl.scrapeUrl with markdown+links+rawHtml format', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: '# Test Page\nSome content',
			links: [],
			metadata: { title: 'Test', statusCode: 200 }
		});

		await readPage('https://example.com');

		expect(mockScrape).toHaveBeenCalledTimes(1);
		const [url, options] = mockScrape.mock.calls[0];
		expect(url).toBe('https://example.com');
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
	});

	it('captures emails from JS-rendered pages that Exa would miss', async () => {
		// Firecrawl renders the full page with headless browser —
		// emails in mailto: links and contact widgets are captured inline
		mockScrape.mockResolvedValue({
			success: true,
			markdown: 'The Federal Trade Commission\n\nContact us: [opa@ftc.gov](mailto:opa@ftc.gov)\n\nOffice of Public Affairs',
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

	it('returns null when scrape has no markdown content', async () => {
		mockScrape.mockResolvedValue({
			success: true,
			markdown: '',
			metadata: { title: 'Empty', statusCode: 200 }
		});

		const result = await readPage('https://example.com');
		expect(result).toBeNull();
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

	it('handles missing metadata gracefully', async () => {
		// Body must be ≥200 chars to clear the isUnusablePage gate on metadata-less pages
		// (no statusCode, no title → only the text-length/email check can save it).
		const body = '# Content here\n\n' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(6);
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
			rawHtml: '<html><body><p><strong>Media inquiries only</strong><br/>720-805-8487<br/>MOComms@denvergov.org</p></body></html>',
			metadata: { title: 'Contact', statusCode: 200 }
		});

		const result = await readPage('https://denvergov.org/contact');

		expect(result!.text).toContain('MOComms@denvergov.org');
		expect(result!.text).toContain('CONTACT EMAILS (from page HTML)');
		expect(result!.highlights).toContain('MOComms@denvergov.org');
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
			rawHtml: '<html><body><img src="logo@2x.png"/><a href="mailto:noreply@system.gov">No reply</a><p>real@agency.gov</p></body></html>',
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
		const body = 'Content without HTML. ' + 'This page intentionally has no raw HTML returned. '.repeat(6);
		mockScrape.mockResolvedValue({
			success: true,
			markdown: body,
			links: [],
			metadata: { title: 'Page', statusCode: 200 }
		});

		const result = await readPage('https://example.com');

		expect(result!.text).toBe(body);
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
		const text = [boilerplate, filler1, content, filler2, 'Subscribe to our newsletter for updates'].join('\n\n');

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
		const paragraphs = Array.from({ length: 50 }, (_, i) =>
			`Paragraph ${i}: ${'G'.repeat(500)}`
		);
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
		const paragraphs = emails.map(e => `Contact: ${e}\n${'H'.repeat(800)}`);
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
