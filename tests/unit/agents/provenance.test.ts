import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mockSearch = vi.fn();
const mockScrapeUrl = vi.fn();

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
		scrapeUrl: mockScrapeUrl
	}),
	getFirecrawlRateLimiter: () => mockFirecrawlRateLimiter
}));

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

import { extractProvenance, pruneSourceContent } from '$lib/core/agents/exa-search';
import type { ExaPageContent } from '$lib/core/agents/exa-search';

// ============================================================================
// Helper: create a mock ExaPageContent
// ============================================================================

function makePage(overrides: Partial<ExaPageContent> = {}): ExaPageContent {
	return {
		url: 'https://example.com/article',
		title: 'Test Article',
		text: 'Some default content.',
		highlights: [],
		...overrides
	};
}

// ============================================================================
// extractProvenance
// ============================================================================

describe('extractProvenance', () => {
	it('detects government page with methodology → primary, hasMethodology: true', () => {
		const page = makePage({
			url: 'https://bls.gov/employment-report',
			title: 'Employment Situation Report',
			text: `Bureau of Labor Statistics
Employment Situation Report — March 2026

## Methodology
The Current Population Survey (CPS) is a monthly survey with a sample size of approximately 60,000 households. The establishment survey has a sample size of approximately 131,000 businesses.

Total nonfarm payroll employment rose by 303,000 in March. The unemployment rate was 3.8%.

Confidence interval for the monthly change in total nonfarm employment is approximately ±100,000.`
		});

		const signals = extractProvenance(page);

		expect(signals.sourceOrder).toBe('primary');
		expect(signals.hasMethodology).toBe(true);
		expect(signals.publisher).toBe('bls.gov');
	});

	it('detects news article with "according to" → secondary', () => {
		const page = makePage({
			url: 'https://nytimes.com/2026/03/10/economy/jobs-report.html',
			title: 'Jobs Report Shows Strong Hiring',
			text: `By Dana Goldstein

The economy added 303,000 jobs in March, according to a report by the Bureau of Labor Statistics released Friday.

Economists had expected a gain of about 200,000, according to a Bloomberg poll.`
		});

		const signals = extractProvenance(page);

		expect(signals.sourceOrder).toBe('secondary');
		expect(signals.hasMethodology).toBe(false);
		expect(signals.author).toBe('Dana Goldstein');
	});

	it('detects op-ed/editorial → opinion', () => {
		const page = makePage({
			url: 'https://washingtonpost.com/opinions/2026/03/climate',
			title: 'Opinion: The Climate Crisis Demands Action Now',
			text: `Editorial Board

The climate crisis demands immediate action from our leaders. I believe we must act now before it's too late. This editorial represents the views of the board.`
		});

		const signals = extractProvenance(page);

		expect(signals.sourceOrder).toBe('opinion');
	});

	it('extracts funding disclosure', () => {
		const page = makePage({
			text: `The Center for Economic Policy Analysis

This research was funded by the Ford Foundation and the Open Society Foundations.

Housing affordability has declined 23% since 2020.`
		});

		const signals = extractProvenance(page);

		expect(signals.fundingDisclosure).toBeDefined();
		expect(signals.fundingDisclosure).toContain('funded by');
		expect(signals.fundingDisclosure).toContain('Ford Foundation');
	});

	it('extracts "supported by" funding pattern', () => {
		const page = makePage({
			text: `This work was supported by a grant from the Robert Wood Johnson Foundation.`
		});

		const signals = extractProvenance(page);

		expect(signals.fundingDisclosure).toBeDefined();
		expect(signals.fundingDisclosure).toContain('supported by');
	});

	it('extracts "grant from" funding pattern', () => {
		const page = makePage({
			text: `This analysis was made possible by a grant from the National Science Foundation.`
		});

		const signals = extractProvenance(page);

		expect(signals.fundingDisclosure).toBeDefined();
		expect(signals.fundingDisclosure).toContain('grant from');
	});

	it('detects advocacy indicators', () => {
		const page = makePage({
			url: 'https://sierraclub.org/climate-action',
			title: 'Climate Action Now',
			text: `Our mission is to protect wild places and promote clean energy.

We advocate for strong environmental regulations at every level of government.

The EPA reports that carbon emissions rose 2% last year.`
		});

		const signals = extractProvenance(page);

		expect(signals.advocacyIndicators.length).toBeGreaterThanOrEqual(2);
		expect(signals.advocacyIndicators.some(a => a.toLowerCase().includes('mission'))).toBe(true);
		expect(signals.advocacyIndicators.some(a => a.toLowerCase().includes('advocate'))).toBe(true);
	});

	it('detects "dedicated to" advocacy pattern', () => {
		const page = makePage({
			text: `The Freedom Institute is dedicated to promoting individual liberty and free markets.`
		});

		const signals = extractProvenance(page);

		expect(signals.advocacyIndicators.length).toBeGreaterThanOrEqual(1);
		expect(signals.advocacyIndicators[0]).toContain('dedicated to');
	});

	it('returns minimal signals for page with no provenance markers', () => {
		const page = makePage({
			url: 'https://randomsite.com/article',
			title: 'Some Article',
			text: 'This is a short article with no provenance signals whatsoever. Just random content.'
		});

		const signals = extractProvenance(page);

		expect(signals.publisher).toBe('randomsite.com');
		expect(signals.orgDescription).toBeUndefined();
		expect(signals.fundingDisclosure).toBeUndefined();
		expect(signals.sourceOrder).toBe('unknown');
		expect(signals.advocacyIndicators).toEqual([]);
		expect(signals.author).toBeUndefined();
		expect(signals.hasMethodology).toBe(false);
	});

	it('handles empty page content gracefully', () => {
		const page = makePage({
			url: 'https://example.com',
			title: '',
			text: ''
		});

		const signals = extractProvenance(page);

		expect(signals.publisher).toBe('example.com');
		expect(signals.sourceOrder).toBe('unknown');
		expect(signals.advocacyIndicators).toEqual([]);
		expect(signals.hasMethodology).toBe(false);
	});

	it('extracts author byline', () => {
		const page = makePage({
			text: `by Sarah Johnson

The city council voted 8-3 to approve the new housing ordinance yesterday.`
		});

		const signals = extractProvenance(page);

		expect(signals.author).toBe('Sarah Johnson');
	});

	it('extracts "Written by" author pattern', () => {
		const page = makePage({
			text: `Written by Michael Chen

A new study reveals that commute times have increased by 15%.`
		});

		const signals = extractProvenance(page);

		expect(signals.author).toBe('Michael Chen');
	});

	it('extracts org description from About section', () => {
		const page = makePage({
			text: `# About Us
The Brookings Institution is a nonprofit public policy organization based in Washington, D.C. Our mission is to conduct in-depth research that leads to new ideas for solving problems facing society.


# Research
Housing costs have risen 40% in major metro areas since 2020.`
		});

		const signals = extractProvenance(page);

		expect(signals.orgDescription).toBeDefined();
		expect(signals.orgDescription).toContain('Brookings');
	});

	it('extracts org description from meta-description pattern', () => {
		const page = makePage({
			text: `The Urban Institute is a nonprofit research organization established in 1968 that provides data and evidence to help advance upward mobility.

Housing affordability has declined in 47 states.`
		});

		const signals = extractProvenance(page);

		expect(signals.orgDescription).toBeDefined();
		expect(signals.orgDescription).toContain('nonprofit');
	});

	it('detects methodology with "n=" pattern', () => {
		const page = makePage({
			text: `We surveyed 2,500 residents (n=2,500) across five metropolitan areas.

Results show that 67% of respondents favor increased transit funding.`
		});

		const signals = extractProvenance(page);

		expect(signals.hasMethodology).toBe(true);
		expect(signals.sourceOrder).toBe('primary');
	});

	it('extracts publisher from URL hostname', () => {
		const page = makePage({
			url: 'https://www.census.gov/data/population.html',
			text: 'Population estimates for 2025.'
		});

		const signals = extractProvenance(page);

		expect(signals.publisher).toBe('census.gov');
	});
});

// ============================================================================
// pruneSourceContent
// ============================================================================

describe('pruneSourceContent', () => {
	it('returns short text unchanged', () => {
		const text = 'This is a short article about housing policy.';
		expect(pruneSourceContent(text)).toBe(text);
	});

	it('returns text under 3K chars unchanged', () => {
		const text = 'A'.repeat(2999);
		expect(pruneSourceContent(text)).toBe(text);
	});

	it('returns text exactly at budget unchanged', () => {
		const text = 'A'.repeat(3000);
		expect(pruneSourceContent(text)).toBe(text);
	});

	it('preserves statistics and dollar amounts', () => {
		const stats = 'The program cost $2.3 million and served 15,000 residents in 2025.';
		const filler = Array.from({ length: 20 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
		const text = filler + '\n\n' + stats + '\n\n' + filler;

		const result = pruneSourceContent(text);

		expect(result).toContain('$2.3 million');
		expect(result).toContain('15,000');
		expect(result.length).toBeLessThanOrEqual(3000);
	});

	it('preserves percentages', () => {
		const stats = 'Housing costs increased by 23.5% since 2020, affecting low-income families.';
		const filler = Array.from({ length: 20 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
		const text = filler + '\n\n' + stats + '\n\n' + filler;

		const result = pruneSourceContent(text);

		expect(result).toContain('23.5%');
	});

	it('preserves direct quotes', () => {
		const quote = '\u201CWe must act now to address the housing crisis,\u201D said Mayor Johnson at the press conference.';
		const filler = Array.from({ length: 20 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
		const text = filler + '\n\n' + quote + '\n\n' + filler;

		const result = pruneSourceContent(text);

		expect(result).toContain('We must act now');
	});

	it('preserves legislative references', () => {
		const legRef = 'H.R. 4521, the CHIPS and Science Act, was passed by the Senate with a vote of 64-33.';
		const filler = Array.from({ length: 20 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
		const text = filler + '\n\n' + legRef + '\n\n' + filler;

		const result = pruneSourceContent(text);

		expect(result).toContain('H.R. 4521');
		expect(result).toContain('CHIPS and Science Act');
	});

	it('preserves bill references', () => {
		const legRef = 'The bill was introduced on January 15, 2026 and passed the House 245-190.';
		const filler = Array.from({ length: 20 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
		const text = filler + '\n\n' + legRef + '\n\n' + filler;

		const result = pruneSourceContent(text);

		expect(result).toContain('bill');
		expect(result).toContain('passed');
	});

	it('preserves dates with context', () => {
		const dated = 'On January 15, 2026 the city council approved the new zoning ordinance unanimously.';
		const filler = Array.from({ length: 20 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
		const text = filler + '\n\n' + dated + '\n\n' + filler;

		const result = pruneSourceContent(text);

		expect(result).toContain('January 15, 2026');
	});

	it('preserves methodology mentions', () => {
		const method = 'We surveyed 1,200 respondents with a confidence interval of ±3%.';
		const filler = Array.from({ length: 20 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
		const text = filler + '\n\n' + method + '\n\n' + filler;

		const result = pruneSourceContent(text);

		expect(result).toContain('surveyed');
		expect(result).toContain('confidence interval');
	});

	it('preserves findings language', () => {
		const finding = 'The data shows that transit ridership increased 12% in the first quarter of 2026.';
		const filler = Array.from({ length: 20 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
		const text = filler + '\n\n' + finding + '\n\n' + filler;

		const result = pruneSourceContent(text);

		expect(result).toContain('data shows');
	});

	it('strips cookie banners and boilerplate', () => {
		const cookie = 'We use cookies to improve your experience. Read our Privacy Policy.';
		const content = 'The city allocated $5 million for infrastructure repairs in 2026.';
		const filler = Array.from({ length: 30 }, (_, i) => `Background info paragraph number ${i} with some extra words to pad it out a bit more.`).join('\n\n');
		const text = [cookie, filler, content, filler].join('\n\n');

		expect(text.length).toBeGreaterThan(3000);
		const result = pruneSourceContent(text);

		expect(result).not.toContain('cookies');
		expect(result).toContain('$5 million');
	});

	it('strips navigation link clusters', () => {
		const nav = '[Home](/) [About](/about) [Contact](/contact) [News](/news) [Events](/events)';
		const content = 'The report found that 67% of residents support the transit expansion.';
		const filler = Array.from({ length: 30 }, (_, i) => `Background info paragraph number ${i} with some extra words to pad it out a bit more.`).join('\n\n');
		const text = [nav, filler, content, filler].join('\n\n');

		expect(text.length).toBeGreaterThan(3000);
		const result = pruneSourceContent(text);

		expect(result).toContain('67%');
		expect(result).not.toContain('[Home]');
	});

	it('strips duplicate paragraphs', () => {
		const repeated = 'This is a repeated paragraph that appears multiple times in the content for some reason.';
		const content = 'Employment rose by 303,000 in March 2026.';
		const text = [repeated, repeated, repeated, content, 'C'.repeat(3000)].join('\n\n');

		const result = pruneSourceContent(text);

		expect(result).toContain('303,000');
		// Only first occurrence should survive
		const matchCount = (result.match(/repeated paragraph/g) || []).length;
		expect(matchCount).toBeLessThanOrEqual(1);
	});

	it('protects first 2-3 non-noise paragraphs as article lede', () => {
		const lede1 = 'The Denver City Council approved a sweeping housing reform package on Tuesday evening.';
		const lede2 = 'The 9-4 vote came after months of contentious public hearings and a last-minute amendment.';
		const later = 'For more information, contact the city clerk.';
		const filler = Array.from({ length: 8 }, (_, i) => `Background paragraph ${i} with no special signals, just filler text ${'R'.repeat(300)}`).join('\n\n');
		const text = [lede1, lede2, filler, later].join('\n\n');

		const result = pruneSourceContent(text);

		// Lede paragraphs should be preserved
		expect(result).toContain('Denver City Council');
		expect(result).toContain('9-4 vote');
	});

	it('respects custom maxChars budget', () => {
		const paragraphs = Array.from({ length: 20 }, (_, i) =>
			`Paragraph ${i}: ${'P'.repeat(200)}`
		);
		const text = paragraphs.join('\n\n');

		const result = pruneSourceContent(text, 1000);

		expect(result.length).toBeLessThanOrEqual(1000);
	});

	it('respects default 3000 char budget', () => {
		const paragraphs = Array.from({ length: 20 }, (_, i) =>
			`Paragraph ${i}: ${'Q'.repeat(300)}`
		);
		const text = paragraphs.join('\n\n');

		const result = pruneSourceContent(text);

		expect(result.length).toBeLessThanOrEqual(3000);
	});

	it('handles text with only boilerplate gracefully', () => {
		const text = [
			'We use cookies to improve your experience.',
			'Skip to main content',
			'© 2026 All rights reserved',
			'Subscribe to our newsletter for updates',
			'Terms of service apply'
		].join('\n\n');

		const result = pruneSourceContent(text);

		// Short enough to return as-is (under 3K)
		expect(result).toBe(text);
	});

	it('truncates when protected content alone exceeds budget', () => {
		// Many paragraphs with statistics that are all "protected"
		const paragraphs = Array.from({ length: 20 }, (_, i) =>
			`The study found that ${i * 5 + 10}% of residents in district ${i + 1} reported problems costing $${(i + 1) * 100},000.`
		);
		const text = paragraphs.join('\n\n');

		const result = pruneSourceContent(text, 500);

		expect(result.length).toBeLessThanOrEqual(500);
	});

	it('preserves vote count patterns', () => {
		const vote = 'The ordinance was enacted after a close vote, with the resolution passing 7-5 along party lines.';
		const filler = Array.from({ length: 20 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
		const text = filler + '\n\n' + vote + '\n\n' + filler;

		const result = pruneSourceContent(text);

		expect(result).toContain('enacted');
	});
});
