/**
 * Search & Page Fetch — Agentic Tool Wrappers
 *
 * - searchWeb() — Exa semantic search, metadata only ($0.005/search)
 * - readPage() — Firecrawl headless browser scrape (full JS rendering)
 *
 * Architecture: Exa finds pages (semantic search strength),
 * Firecrawl reads them (headless browser captures JS-rendered content,
 * mailto: links, and dynamic contact widgets that text extraction misses).
 *
 * @module agents/exa-search
 */

import { getExaClient, getSearchRateLimiter } from '$lib/server/exa';
import { getFirecrawlClient, getFirecrawlRateLimiter } from '$lib/server/firecrawl';
import { extractContactHints } from '$lib/core/agents/agents/decision-maker';
import type { ProvenanceSignals } from '$lib/core/agents/types';

// ============================================================================
// Timeout Helper
// ============================================================================

/** Race a promise against a deadline. Rejects with a descriptive error on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
			ms
		);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const SEARCH_TIMEOUT_MS = 15_000;
const SCRAPE_TIMEOUT_MS = 20_000;

/** Extract email addresses from raw HTML, filtering common false positives */
function extractEmailsFromHtml(html: string): string[] {
	const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
	const raw = [...new Set(html.match(emailRe) || [])];
	return raw.filter(e => {
		const lower = e.toLowerCase();
		return !lower.endsWith('.png') &&
			!lower.endsWith('.jpg') &&
			!lower.endsWith('.gif') &&
			!lower.endsWith('.svg') &&
			!lower.endsWith('.webp') &&
			!lower.includes('noreply') &&
			!lower.includes('no-reply') &&
			!lower.includes('example.com') &&
			!lower.includes('sentry.io') &&
			!lower.includes('webpack') &&
			!lower.includes('localhost');
	});
}

// ============================================================================
// Types
// ============================================================================

/** A single search result from Exa (metadata only, no content) */
export interface ExaSearchHit {
	url: string;
	title: string;
	publishedDate?: string;
	author?: string;
	score?: number;
}

/** Resolved page content (Firecrawl headless browser render) */
export interface ExaPageContent {
	url: string;
	title: string;
	text: string;           // full rendered markdown from headless browser
	highlights?: string[];  // always [] — Firecrawl captures everything inline
	publishedDate?: string;
	statusCode?: number;
}

// ============================================================================
// searchWeb — Agent tool wrapper for Exa search
// ============================================================================

/**
 * Search the web via Exa. Returns metadata only (no page content).
 * Rate-limited to 4 RPS with exponential backoff.
 *
 * @param query - Search query string
 * @param options - Optional: maxResults (default 25, max before 5x price jump)
 * @returns Array of search hits with URL, title, publishedDate
 */
/** Extended search options — backwards compatible with original { maxResults } interface */
export interface SearchWebOptions {
	maxResults?: number;
	/** Exa domain filter: only return results from these domains (e.g., ['.gov', '.gov.uk']) */
	includeDomains?: string[];
	/** Exa domain filter: exclude results from these domains */
	excludeDomains?: string[];
	/** Exa category filter: 'news', 'research paper', 'company', etc. */
	category?: 'company' | 'research paper' | 'news' | 'pdf' | 'tweet' | 'personal site' | 'financial report' | 'people';
	/** ISO date string — only return results published after this date */
	startPublishedDate?: string;
	/** Strings that must NOT appear in result text */
	excludeText?: string[];
}

export async function searchWeb(
	query: string,
	options?: SearchWebOptions
): Promise<ExaSearchHit[]> {
	const maxResults = options?.maxResults ?? 25;
	const exa = getExaClient();
	const rateLimiter = getSearchRateLimiter();

	console.debug(`[exa-search] searchWeb: "${query}"`);

	// Build Exa search params — only include optional fields when provided
	const searchParams: Record<string, unknown> = {
		numResults: maxResults,
		type: 'auto',
		contents: false as const
	};
	if (options?.includeDomains?.length) searchParams.includeDomains = options.includeDomains;
	if (options?.excludeDomains?.length) searchParams.excludeDomains = options.excludeDomains;
	if (options?.category) searchParams.category = options.category;
	if (options?.startPublishedDate) searchParams.startPublishedDate = options.startPublishedDate;
	if (options?.excludeText?.length) searchParams.excludeText = options.excludeText;

	const result = await rateLimiter.execute(
		async () => withTimeout(
			exa.search(query, searchParams as Parameters<typeof exa.search>[1]),
			SEARCH_TIMEOUT_MS,
			`exa-search "${query.slice(0, 40)}"`
		),
		`exa-search-${query.slice(0, 40)}`
	);

	if (!result.success) {
		console.error(`[exa-search] searchWeb failed:`, result.error);
		throw new Error(`Search failed: ${result.error}`);
	}

	if (result.wasRateLimited) {
		console.debug(`[exa-search] searchWeb succeeded after rate limit retry (${result.attempts} attempts)`);
	}

	const hits: ExaSearchHit[] = result.data!.results.map((r) => ({
		url: r.url,
		title: r.title || '',
		publishedDate: r.publishedDate,
		author: r.author,
		score: r.score
	}));

	console.debug(`[exa-search] searchWeb: ${hits.length} results for "${query.slice(0, 50)}"`);
	return hits;
}

// ============================================================================
// readPage — Firecrawl headless browser scrape
// ============================================================================

/** Safety cap: discard content beyond this to prevent pathological pages from consuming memory. */
const PAGE_CONTENT_HARD_CAP = 200_000;

/**
 * Fetch full rendered page content via Firecrawl headless browser.
 * Renders JavaScript, captures mailto: links, dynamic contact widgets,
 * and everything the browser actually sees.
 * Rate-limited to 10 RPS with exponential backoff.
 *
 * Returns the full page text (up to 200K safety cap). Downstream consumers
 * use prunePageContent() to trim for Gemini's synthesis prompt while the
 * full text stays available for email grounding verification.
 *
 * @param url - URL to fetch content from
 * @returns Page content or null if fetch failed
 */
export async function readPage(
	url: string,
	_options?: { maxCharacters?: number }
): Promise<ExaPageContent | null> {
	const firecrawl = getFirecrawlClient();
	const rateLimiter = getFirecrawlRateLimiter();

	console.debug(`[page-fetch] readPage: ${url}`);

	const result = await rateLimiter.execute(
		async () => withTimeout(
			firecrawl.scrapeUrl(url, { formats: ['markdown', 'links', 'rawHtml'] }),
			SCRAPE_TIMEOUT_MS,
			`firecrawl "${url.slice(0, 60)}"`
		),
		`firecrawl-${url.slice(0, 60)}`
	);

	if (!result.success) {
		console.error(`[page-fetch] readPage failed for ${url}:`, result.error);
		return null;
	}

	const scrapeData = result.data;
	if (!scrapeData?.success || !scrapeData.markdown) {
		console.debug(`[page-fetch] readPage: no content for ${url}`);
		return null;
	}

	// Start with the rendered markdown (apply safety cap to prevent pathological pages)
	let text = scrapeData.markdown.slice(0, PAGE_CONTENT_HARD_CAP);

	// Extract emails from mailto: links — these are structurally extracted
	// and may include addresses that appear only as link targets, not in
	// visible page text (e.g., obfuscated or JS-generated mailto: hrefs)
	const links: string[] = Array.isArray(scrapeData.links) ? scrapeData.links : [];
	const mailtoEmails = links
		.filter((l: string) => l.startsWith('mailto:'))
		.map((l: string) => l.replace('mailto:', '').split('?')[0]);

	if (mailtoEmails.length > 0) {
		const emailBlock = '\n\n--- CONTACT EMAILS (from page links) ---\n' + mailtoEmails.join('\n');
		text += emailBlock;
		console.debug(`[page-fetch] readPage: ${mailtoEmails.length} mailto emails appended for ${url}`);
	}

	// Extract emails from raw HTML that markdown conversion may have missed.
	// Government CMS pages often have emails as plain text in <p> tags
	// or in HTML attributes that don't survive markdown conversion.
	if (scrapeData.rawHtml) {
		const htmlEmails = extractEmailsFromHtml(scrapeData.rawHtml);
		const existingLower = new Set(
			[...(text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi) || [])]
				.map(e => e.toLowerCase())
		);
		const newEmails = htmlEmails.filter(e => !existingLower.has(e.toLowerCase()));
		if (newEmails.length > 0) {
			text += '\n\n--- CONTACT EMAILS (from page HTML) ---\n' + newEmails.join('\n');
			mailtoEmails.push(...newEmails);
			console.debug(`[page-fetch] readPage: ${newEmails.length} HTML-only emails appended for ${url}`);
		}
	}

	const content: ExaPageContent = {
		url,
		title: scrapeData.metadata?.title || '',
		text,
		highlights: mailtoEmails,
		publishedDate: undefined,
		statusCode: scrapeData.metadata?.statusCode
	};

	console.debug(`[page-fetch] readPage: ${content.text.length} chars from "${content.title.slice(0, 60)}"`);
	return content;
}

// ============================================================================
// prunePageContent — Contact-priority content assembly
// ============================================================================

const PRUNE_TARGET_CHARS = 15_000;
const LINK_CLUSTER_MIN_LINKS = 3;
const LINK_CLUSTER_RATIO = 0.5;

const BOILERPLATE_PATTERNS = [
	'cookie', 'privacy policy', 'terms of service', 'terms of use',
	'subscribe to our newsletter', 'sign up for', 'skip to content',
	'skip to main', 'all rights reserved', '©'
];

/** Count markdown link syntax characters in a string: `[text](url)` */
function countLinkChars(text: string): number {
	let total = 0;
	for (const match of text.matchAll(/\[[^\]]*\]\([^)]*\)/g)) {
		total += match[0].length;
	}
	return total;
}

/** Count markdown links in a string */
function countLinks(text: string): number {
	return (text.match(/\[[^\]]*\]\([^)]*\)/g) || []).length;
}

/**
 * Prune page content for Gemini synthesis while preserving all contact signals.
 *
 * Strips navigation link clusters, boilerplate, and duplicate paragraphs.
 * Paragraphs containing email/phone/social/name signals are never stripped.
 * Falls back to simple truncation if any contact signal would be lost.
 *
 * @param text - Full page markdown text
 * @param protectedNames - Identity names to protect from stripping
 * @returns Pruned text ≤ PRUNE_TARGET_CHARS
 */
export function prunePageContent(text: string, protectedNames?: string[]): string {
	// Short-circuit: if text fits in budget, return as-is
	if (text.length <= PRUNE_TARGET_CHARS) {
		return text;
	}

	// Extract contact signals from the FULL text for safety invariant
	const fullSignals = extractContactHints(text);

	// Split into paragraphs (double newline boundaries)
	const paragraphs = text.split(/\n{2,}/);

	// Build lowercase name fragments for matching (skip single-word names < 3 chars)
	const nameFragments = (protectedNames || [])
		.filter(n => n && n !== 'UNKNOWN')
		.flatMap(n => {
			const parts: string[] = [n.toLowerCase()];
			// Also match last name alone if multi-word (e.g., "Johnston" from "Mike Johnston")
			const words = n.split(/\s+/);
			if (words.length >= 2) {
				const last = words[words.length - 1].toLowerCase();
				if (last.length >= 3) parts.push(last);
			}
			return parts;
		});

	// Classify each paragraph
	const enum ParagraphClass { PROTECTED, NOISE, CONTEXT }
	const classes: ParagraphClass[] = new Array(paragraphs.length);
	const seen = new Set<string>();

	for (let i = 0; i < paragraphs.length; i++) {
		const para = paragraphs[i];
		const paraLower = para.toLowerCase();

		// Check for contact signals
		const hasContactSignal =
			/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(para) ||
			/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(para) ||
			/https?:\/\/(?:www\.)?(?:twitter|x|linkedin|facebook)\.com\/[^\s)"\]]+/i.test(para) ||
			nameFragments.some(name => paraLower.includes(name));

		if (hasContactSignal) {
			classes[i] = ParagraphClass.PROTECTED;
			continue;
		}

		// Check for noise
		const linkCount = countLinks(para);
		const linkCharCount = countLinkChars(para);
		const isLinkCluster = linkCount >= LINK_CLUSTER_MIN_LINKS &&
			para.length > 0 &&
			(linkCharCount / para.length) >= LINK_CLUSTER_RATIO;

		const isBoilerplate = BOILERPLATE_PATTERNS.some(p => paraLower.includes(p));

		const trimmed = para.trim();
		const isDuplicate = seen.has(trimmed) && trimmed.length > 0;
		if (trimmed.length > 0) seen.add(trimmed);

		if (isLinkCluster || isBoilerplate || isDuplicate) {
			classes[i] = ParagraphClass.NOISE;
		} else {
			classes[i] = ParagraphClass.CONTEXT;
		}
	}

	// Context expansion: paragraphs adjacent to PROTECTED get upgraded
	for (let i = 0; i < paragraphs.length; i++) {
		if (classes[i] === ParagraphClass.PROTECTED) {
			if (i > 0 && classes[i - 1] !== ParagraphClass.PROTECTED) {
				classes[i - 1] = ParagraphClass.PROTECTED;
			}
			if (i < paragraphs.length - 1 && classes[i + 1] !== ParagraphClass.PROTECTED) {
				classes[i + 1] = ParagraphClass.PROTECTED;
			}
		}
	}

	// Assembly: PROTECTED always included, then CONTEXT until budget, NOISE dropped
	const protectedParts: string[] = [];
	const contextParts: string[] = [];
	let noiseCount = 0;

	for (let i = 0; i < paragraphs.length; i++) {
		if (classes[i] === ParagraphClass.PROTECTED) {
			protectedParts.push(paragraphs[i]);
		} else if (classes[i] === ParagraphClass.CONTEXT) {
			contextParts.push(paragraphs[i]);
		} else {
			noiseCount++;
		}
	}

	// Build output: protected first, then context to fill budget
	let result = protectedParts.join('\n\n');
	let charsRemaining = PRUNE_TARGET_CHARS - result.length;

	if (charsRemaining > 0 && contextParts.length > 0) {
		const contextBlock: string[] = [];
		for (const part of contextParts) {
			if (part.length + 2 > charsRemaining) break; // +2 for \n\n separator
			contextBlock.push(part);
			charsRemaining -= (part.length + 2);
		}
		if (contextBlock.length > 0) {
			result = contextBlock.join('\n\n') + '\n\n' + result;
		}
	}

	// Safety invariant: verify no contact signals lost
	const prunedSignals = extractContactHints(result);
	const emailsLost = fullSignals.emails.filter(
		e => !prunedSignals.emails.some(pe => pe.toLowerCase() === e.toLowerCase())
	);
	const phonesLost = fullSignals.phones.filter(
		p => !prunedSignals.phones.includes(p)
	);

	if (emailsLost.length > 0 || phonesLost.length > 0) {
		console.warn(
			`[prune] Safety invariant failed: lost ${emailsLost.length} emails, ${phonesLost.length} phones. Falling back to truncation.`,
			{ emailsLost, phonesLost }
		);
		return text.slice(0, PRUNE_TARGET_CHARS);
	}

	// Truncate to hard limit if protected content alone exceeds budget
	if (result.length > PRUNE_TARGET_CHARS) {
		result = result.slice(0, PRUNE_TARGET_CHARS);
	}

	console.debug(
		`[prune] ${text.length} → ${result.length} chars (dropped ${noiseCount} noise paragraphs, kept ${protectedParts.length} protected + ${contextParts.length} context)`
	);
	return result;
}

// ============================================================================
// pruneSourceContent — Factual-priority content assembly
// ============================================================================

const SOURCE_PRUNE_TARGET_CHARS = 3_000;

/**
 * Prune page content for source discovery, preserving factual density.
 *
 * Different from prunePageContent() which protects contact signals (emails, phones).
 * This variant protects:
 * - Statistics, data points, dollar amounts, percentages
 * - Direct quotes (text in quotation marks)
 * - Dates, legislative references, vote counts
 * - Methodology mentions (sample size, confidence intervals)
 * - The article's core finding/thesis (first 2-3 paragraphs)
 *
 * Strips navigation link clusters, boilerplate, and duplicate paragraphs.
 *
 * @param text - Full page markdown text
 * @param maxChars - Character budget (default 3,000)
 * @returns Pruned text ≤ maxChars
 */
export function pruneSourceContent(text: string, maxChars: number = SOURCE_PRUNE_TARGET_CHARS): string {
	if (text.length <= maxChars) {
		return text;
	}

	const paragraphs = text.split(/\n{2,}/);

	// Classify each paragraph
	const PARA_PROTECTED = 0;
	const PARA_NOISE = 1;
	const PARA_CONTEXT = 2;

	const classes: number[] = new Array(paragraphs.length);
	const seen = new Set<string>();

	for (let i = 0; i < paragraphs.length; i++) {
		const para = paragraphs[i];
		const paraLower = para.toLowerCase();

		// Protect paragraphs with factual signals
		const hasFactualSignal =
			// Statistics, dollar amounts, percentages
			/\$[\d,.]+|\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b/.test(para) ||
			// Direct quotes
			/[""\u201C\u201D][^""\u201C\u201D]{10,}[""\u201C\u201D]/.test(para) ||
			// Legislative references, bill numbers, vote counts
			/\b(?:H\.?R\.?\s*\d|S\.?\s*\d|bill|resolution|ordinance|statute|vote[ds]?\s+\d|passed\s+\d|enacted)\b/i.test(para) ||
			// Dates with context (not just bare years)
			/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/.test(para) ||
			// Methodology / research signals
			/\b(?:sample size|n\s*=\s*\d|confidence interval|margin of error|statistically|regression|survey(?:ed)?|respondents)\b/i.test(para) ||
			// Specific findings language
			/\b(?:found that|results show|data (?:shows?|indicates?|reveals?)|according to the)\b/i.test(para);

		if (hasFactualSignal) {
			classes[i] = PARA_PROTECTED;
			continue;
		}

		// Check for noise (same patterns as prunePageContent)
		const linkCount = countLinks(para);
		const linkCharCount = countLinkChars(para);
		const isLinkCluster = linkCount >= LINK_CLUSTER_MIN_LINKS &&
			para.length > 0 &&
			(linkCharCount / para.length) >= LINK_CLUSTER_RATIO;

		const isBoilerplate = BOILERPLATE_PATTERNS.some(p => paraLower.includes(p));

		const trimmed = para.trim();
		const isDuplicate = seen.has(trimmed) && trimmed.length > 0;
		if (trimmed.length > 0) seen.add(trimmed);

		if (isLinkCluster || isBoilerplate || isDuplicate) {
			classes[i] = PARA_NOISE;
		} else {
			classes[i] = PARA_CONTEXT;
		}
	}

	// Protect first 2-3 non-noise paragraphs (article thesis/lede)
	let ledeCount = 0;
	for (let i = 0; i < paragraphs.length && ledeCount < 3; i++) {
		if (classes[i] !== PARA_NOISE && paragraphs[i].trim().length > 30) {
			classes[i] = PARA_PROTECTED;
			ledeCount++;
		}
	}

	// Assembly: PROTECTED always included, then CONTEXT until budget, NOISE dropped
	const protectedParts: string[] = [];
	const contextParts: string[] = [];

	for (let i = 0; i < paragraphs.length; i++) {
		if (classes[i] === PARA_PROTECTED) {
			protectedParts.push(paragraphs[i]);
		} else if (classes[i] === PARA_CONTEXT) {
			contextParts.push(paragraphs[i]);
		}
	}

	// Build output: protected first, then context to fill budget
	let result = protectedParts.join('\n\n');

	if (result.length > maxChars) {
		// Protected content alone exceeds budget — truncate
		return result.slice(0, maxChars);
	}

	let charsRemaining = maxChars - result.length;

	if (charsRemaining > 0 && contextParts.length > 0) {
		const contextBlock: string[] = [];
		for (const part of contextParts) {
			if (part.length + 2 > charsRemaining) break;
			contextBlock.push(part);
			charsRemaining -= (part.length + 2);
		}
		if (contextBlock.length > 0) {
			result += '\n\n' + contextBlock.join('\n\n');
		}
	}

	return result;
}

// ============================================================================
// extractProvenance — Source provenance signal extraction
// ============================================================================

const FUNDING_PATTERNS = [
	/funded by\s+([^.]+)/i,
	/supported by\s+([^.]+)/i,
	/sponsored by\s+([^.]+)/i,
	/grant from\s+([^.]+)/i,
	/financial support from\s+([^.]+)/i
];

const ADVOCACY_PATTERNS = [
	/our mission is to\s+([^.]+)/i,
	/we advocate for\s+([^.]+)/i,
	/dedicated to\s+(?:promoting|advancing|protecting|fighting|opposing)\s+([^.]+)/i,
	/committed to\s+(?:ensuring|achieving|stopping)\s+([^.]+)/i
];

/**
 * Extract provenance signals from a fetched page.
 *
 * Targets page regions that mainstream content pruning discards as "boilerplate" —
 * About sections, footer disclaimers, author bios, funding acknowledgments.
 * These signals reveal *why* the source exists and feed the Gemini evaluator,
 * not the message writer.
 *
 * @param page - Firecrawl page content
 * @returns Provenance signals struct
 */
export function extractProvenance(page: ExaPageContent): ProvenanceSignals {
	const text = page.text;

	// Publisher: use page title domain or extract from content
	const publisher = extractPublisher(page);

	// Org description: look for "About Us" or mission statements
	const orgDescription = extractOrgDescription(text);

	// Funding disclosure
	let fundingDisclosure: string | undefined;
	for (const pattern of FUNDING_PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			fundingDisclosure = match[0].trim();
			break;
		}
	}

	// Advocacy indicators
	const advocacyIndicators: string[] = [];
	for (const pattern of ADVOCACY_PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			advocacyIndicators.push(match[0].trim());
		}
	}

	// Source order classification
	const sourceOrder = classifySourceOrder(text);

	// Author byline
	const author = extractAuthor(text);

	// Methodology detection
	const hasMethodology = /\b(?:methodology|sample size|n\s*=\s*\d|confidence interval|margin of error|statistically significant|regression analysis)\b/i.test(text);

	return {
		publisher,
		orgDescription,
		fundingDisclosure,
		sourceOrder,
		advocacyIndicators,
		author,
		hasMethodology
	};
}

/** Extract publisher identity from URL domain or page content */
function extractPublisher(page: ExaPageContent): string {
	// Try extracting from URL domain
	try {
		const hostname = new URL(page.url).hostname.replace(/^www\./, '');
		// Use domain as fallback publisher
		return hostname;
	} catch {
		return page.title || 'Unknown';
	}
}

/** Extract org description from About sections or mission statements */
function extractOrgDescription(text: string): string | undefined {
	// Look for "About Us" / "About [Org]" / "Our Mission" sections
	const aboutMatch = text.match(
		/(?:^|\n)#+\s*(?:About\s+(?:Us|the)|Our\s+Mission|Who\s+We\s+Are)\s*\n([\s\S]{10,300}?)(?:\n#|\n\n\n)/im
	);
	if (aboutMatch) {
		return aboutMatch[1].trim().slice(0, 300);
	}

	// Look for meta-description-style sentences near the top
	const missionMatch = text.slice(0, 2000).match(
		/(?:is a|is an|is the)\s+((?:non-?profit|organization|institute|foundation|center|association|agency|bureau|department)[^.]{10,200}\.)/i
	);
	if (missionMatch) {
		return missionMatch[0].trim().slice(0, 300);
	}

	return undefined;
}

/** Classify source as primary, secondary, opinion, or unknown */
function classifySourceOrder(text: string): 'primary' | 'secondary' | 'opinion' | 'unknown' {
	const isOpinion = /\b(?:editorial|op-?ed|opinion|commentary|perspective|column|my view|I (?:believe|think|argue))\b/i.test(text);
	if (isOpinion) return 'opinion';

	// Secondary signals: reporting on others' data/research
	const secondarySignals = /\b(?:according to|a report by|data from|published by|researchers found|a study by)\b/i.test(text);
	// Primary signals: this source produced the data itself
	const primarySignals = /\b(?:our (?:survey|study|analysis|research|findings|report)|we (?:found|collected|analyzed|surveyed|measured)|methodology|sample size|n\s*=\s*\d)\b/i.test(text);

	if (primarySignals) return 'primary';
	if (secondarySignals) return 'secondary';
	return 'unknown';
}

/** Extract author byline from page content */
function extractAuthor(text: string): string | undefined {
	// Common byline patterns — check first ~2000 chars (bylines are near the top)
	const header = text.slice(0, 2000);

	const bylinePatterns = [
		/\b[Bb]y[ \t]+([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})/m,
		/\b[Aa]uthor:[ \t]*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})/m,
		/\b[Ww]ritten[ \t]+[Bb]y[ \t]+([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,3})/m
	];

	for (const pattern of bylinePatterns) {
		const match = header.match(pattern);
		if (match) {
			return match[1].trim();
		}
	}

	return undefined;
}
