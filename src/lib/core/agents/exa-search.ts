/**
 * Search & Page Fetch — Agentic Tool Wrappers
 *
 * - searchWeb() — Exa semantic search, metadata only (10-result price tier)
 * - readPage() — Firecrawl headless browser scrape (full JS rendering)
 *
 * Architecture: Exa finds pages (semantic search strength),
 * Firecrawl reads them (headless browser captures JS-rendered content,
 * mailto: links, and dynamic contact widgets that text extraction misses).
 *
 * @module agents/exa-search
 */

import { requestExa, getSearchRateLimiter, getContentsRateLimiter } from '$lib/server/exa';
import { requestFirecrawlScrape, getFirecrawlRateLimiter } from '$lib/server/firecrawl';
import { extractContactHints } from '$lib/core/agents/agents/decision-maker';
import type { ProvenanceSignals } from '$lib/core/agents/types';
import { parsePublicHttpUrl } from '$lib/core/security/public-external-url';
import { absent, blocked, present, type Fact } from '$lib/core/fact';
import { sanitizeProviderControlledText, sanitizeProviderErrorMessage } from './provider-error';
import { sameInstitutionLinks } from './link-graph';
import { segmentRecordBlocks, type SegmentResult } from './record-blocks';
import {
	CONTACT_EMAIL_BLOCK_HEADINGS,
	isUsableContactEmail,
	stripNonContentMarkup
} from './contact-email';
import {
	classifyRetrievalBlock,
	hasUsableRetrievalContact,
	pageRetrievalAbsent,
	pageRetrievalBlocked,
	pageRetrievalOk,
	type AbsentReason,
	type PageRetrievalOutcome
} from './retrieval-outcome';

export { PAGE_EMAIL_MAX_BYTES, isUsableContactEmail } from './contact-email';

const SEARCH_QUERY_MAX_BYTES = 512;
const SEARCH_RESULT_URL_MAX_BYTES = 512;
const SEARCH_RESULT_TITLE_MAX_BYTES = 240;
const SEARCH_RESULT_AUTHOR_MAX_BYTES = 160;
const SEARCH_RESULT_DATE_MAX_BYTES = 64;
const SEARCH_RESULT_QUERY_PARAM_LIMIT = 12;
const PAGE_LINK_INSPECTION_LIMIT = 256;
const PAGE_LINK_MAX_BYTES = 512;
const PAGE_RAW_HTML_SCAN_MAX_CHARACTERS = 500_000;
const PAGE_EXTRACTED_EMAIL_LIMIT = 64;
const EXA_INTERSTITIAL_MAX_CHARACTERS = 200;

const SENSITIVE_QUERY_PARAMETER =
	/^(?:api[-_]?key|key|token|access[-_]?token|auth(?:orization)?|credential|password|secret|signature|sig|x-amz-.+)$/iu;
const TRACKING_QUERY_PARAMETER = /^(?:utm_.+|gclid|fbclid|msclkid)$/iu;

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate and normalize an untrusted external URL before it enters a prompt,
 * client payload, trace, or paid page-read call.
 */
export function normalizeExternalHttpUrl(value: unknown): string | null {
	const parsed = parsePublicHttpUrl(value);
	if (!parsed) return null;

	try {
		let decodedPath: string;
		try {
			decodedPath = decodeURIComponent(parsed.pathname);
		} catch {
			return null;
		}
		if (
			/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(decodedPath) ||
			sanitizeProviderControlledText(decodedPath).includes('[redacted-credential]')
		) {
			return null;
		}

		const queryEntries = Array.from(parsed.searchParams.entries());
		parsed.search = '';
		for (const [rawKey, rawValue] of queryEntries.slice(0, SEARCH_RESULT_QUERY_PARAM_LIMIT)) {
			if (SENSITIVE_QUERY_PARAMETER.test(rawKey) || TRACKING_QUERY_PARAMETER.test(rawKey)) continue;
			const key = sanitizeProviderControlledText(rawKey, 64);
			const queryValue = sanitizeProviderControlledText(rawValue, 128);
			if (
				!key ||
				key.includes('[redacted-credential]') ||
				queryValue.includes('[redacted-credential]')
			) {
				continue;
			}
			parsed.searchParams.append(key, queryValue);
		}
		parsed.hash = '';

		const normalized = parsed.toString();
		if (utf8ByteLength(normalized) > SEARCH_RESULT_URL_MAX_BYTES) return null;
		return normalized;
	} catch {
		return null;
	}
}

/**
 * Log labels deliberately omit query text, URL userinfo/query/fragment, and
 * provider titles. These values can carry user secrets or provider-controlled
 * control text even when the underlying request/result remains valid.
 */
function queryLogLabel(query: string): string {
	return `queryChars=${query.length}`;
}

export function providerUrlLogLabel(rawUrl: unknown): string {
	if (typeof rawUrl !== 'string') return 'invalid-url';
	try {
		const parsed = new URL(rawUrl);
		const origin = parsed.origin === 'null' ? parsed.protocol : parsed.origin;
		return sanitizeProviderControlledText(
			`${origin} pathChars=${parsed.pathname.length}`,
			192,
			'url unavailable'
		);
	} catch {
		return `invalid-url chars=${rawUrl.length}`;
	}
}

function titleLogLabel(title: string): string {
	return `titleChars=${title.length}`;
}

/** Extract email addresses from raw HTML, filtering common false positives */
function extractEmailsFromHtml(html: string, limit = PAGE_EXTRACTED_EMAIL_LIMIT): string[] {
	const emailRe =
		/(?<![a-zA-Z0-9._%+\-])[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]{1,187}\.[a-zA-Z]{2,63}(?![a-zA-Z0-9\-])/g;
	const emails: string[] = [];
	const seen = new Set<string>();
	// Script, JSON-LD, style, and comment addresses are page source with no inbound
	// intent. They are ineligible, not merely low-confidence contact candidates.
	const contentHtml = stripNonContentMarkup(html);
	for (const match of contentHtml.slice(0, PAGE_RAW_HTML_SCAN_MAX_CHARACTERS).matchAll(emailRe)) {
		if (emails.length >= limit) break;
		const e = match[0];
		const lower = e.toLowerCase();
		if (!isUsableContactEmail(e) || seen.has(lower)) {
			continue;
		}
		seen.add(lower);
		emails.push(e);
	}
	return emails;
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
	text: string; // full rendered markdown from headless browser
	highlights?: string[]; // always [] — Firecrawl captures everything inline
	/**
	 * Same-institution links harvested from the page's own link list. THREE states,
	 * not two, and each is a distinct fact about what retrieval actually produced:
	 *
	 * - key ABSENT (`undefined`) — no link graph was produced on this retrieval path.
	 *   Either the Exa-contents fallback served the page (it has no structured link
	 *   list to read), or Firecrawl returned no `links` array.
	 * - `[]` — a link graph WAS retrieved and evaluated, and nothing survived
	 *   same-registrable-domain filtering.
	 * - non-empty — the survivors, in document order, at most 32.
	 *
	 * Consumers MUST check `'links' in page` / `page.links === undefined` BEFORE
	 * checking `page.links.length === 0`. The two lead to different honest outcomes
	 * ("we could not look here" vs. "we looked and this institution links nowhere")
	 * and must not be collapsed. Do not defensively initialise the field.
	 */
	links?: string[];
	/**
	 * Structural record-block observation. Unlike the legacy optional arrays, this
	 * reports whether raw HTML was actually available to inspect:
	 *
	 * - present — eligible blocks/institution addresses were observed, or the
	 *   bounded scan produced a partial result (`value.truncated === true`).
	 * - absent — raw HTML was retrieved and completely scanned; nothing eligible
	 *   was published in it.
	 * - blocked — this retrieval path produced no raw HTML, so no claim of
	 *   emptiness is permitted.
	 */
	recordBlocks: Fact<SegmentResult>;
	publishedDate?: string;
	statusCode?: number;
}

function observedRecordBlocks(result: SegmentResult): Fact<SegmentResult> {
	return result.truncated || result.blocks.length > 0 || result.institutionBoundAddresses.length > 0
		? present(result)
		: absent();
}

// ============================================================================
// searchWeb — Agent tool wrapper for Exa search
// ============================================================================

/**
 * Search the web via Exa. Returns metadata only (no page content).
 * Rate-limited to 4 RPS with exponential backoff.
 *
 * @param query - Search query string
 * @param options - Optional: maxResults (default 10, hard-capped to the base price tier)
 * @returns Array of search hits with URL, title, publishedDate
 */
/** Extended search options — backwards compatible with original { maxResults } interface */
export interface SearchWebOptions {
	maxResults?: number;
	/** Cancels the transport and every rate-limit backoff before another attempt. */
	signal?: AbortSignal;
	/** Exa domain filter: only return results from these domains (e.g., ['.gov', '.gov.uk']) */
	includeDomains?: string[];
	/** Exa domain filter: exclude results from these domains */
	excludeDomains?: string[];
	/** Exa category filter: 'news', 'research paper', 'company', etc. */
	category?:
		| 'company'
		| 'research paper'
		| 'news'
		| 'pdf'
		| 'tweet'
		| 'personal site'
		| 'financial report'
		| 'people';
	/** ISO date string — only return results published after this date */
	startPublishedDate?: string;
	/** Strings that must NOT appear in result text */
	excludeText?: string[];
}

export async function searchWeb(
	query: string,
	options?: SearchWebOptions
): Promise<ExaSearchHit[]> {
	const boundedQuery = sanitizeProviderControlledText(query, SEARCH_QUERY_MAX_BYTES);
	if (!boundedQuery.trim()) {
		throw new TypeError('Search query must contain visible text');
	}

	const requestedResults = options?.maxResults ?? 10;
	const maxResults = Number.isSafeInteger(requestedResults)
		? Math.min(Math.max(requestedResults, 1), 10)
		: 10;
	const rateLimiter = getSearchRateLimiter();
	const queryLabel = queryLogLabel(boundedQuery);

	console.debug(`[exa-search] searchWeb: ${queryLabel}`);

	// Build Exa search params — only include optional fields when provided
	const searchParams: Record<string, unknown> = {
		numResults: maxResults,
		type: 'auto',
		contents: false as const
	};
	if (options?.includeDomains?.length) {
		searchParams.includeDomains = options.includeDomains
			.slice(0, 10)
			.map((value) => value.slice(0, 253));
	}
	if (options?.excludeDomains?.length) {
		searchParams.excludeDomains = options.excludeDomains
			.slice(0, 10)
			.map((value) => value.slice(0, 253));
	}
	if (options?.category) searchParams.category = options.category;
	if (options?.startPublishedDate) searchParams.startPublishedDate = options.startPublishedDate;
	if (options?.excludeText?.length) {
		searchParams.excludeText = options.excludeText.slice(0, 10).map((value) => value.slice(0, 512));
	}

	const result = await rateLimiter.execute(
		() =>
			requestExa<{ results?: unknown }>(
				'/search',
				{
					query: boundedQuery,
					...searchParams,
					contents: undefined
				},
				{ signal: options?.signal }
			),
		`exa-search ${queryLabel}`,
		options?.signal
	);

	if (!result.success) {
		const safeError = sanitizeProviderErrorMessage(result.error);
		console.error(`[exa-search] searchWeb failed:`, safeError);
		throw new Error(sanitizeProviderErrorMessage(`Search failed: ${safeError}`));
	}

	if (result.wasRateLimited) {
		console.debug(
			`[exa-search] searchWeb succeeded after rate limit retry (${result.attempts} attempts)`
		);
	}

	const rawResults = Array.isArray(result.data?.results) ? result.data.results : [];
	const hits: ExaSearchHit[] = [];
	for (const rawResult of rawResults.slice(0, maxResults)) {
		if (!rawResult || typeof rawResult !== 'object') continue;
		const raw = rawResult as Record<string, unknown>;
		const url = normalizeExternalHttpUrl(raw.url);
		if (!url) continue;

		const publishedDate = sanitizeProviderControlledText(
			raw.publishedDate,
			SEARCH_RESULT_DATE_MAX_BYTES
		);
		const author = sanitizeProviderControlledText(raw.author, SEARCH_RESULT_AUTHOR_MAX_BYTES);
		const score =
			typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : undefined;
		hits.push({
			url,
			title: sanitizeProviderControlledText(raw.title, SEARCH_RESULT_TITLE_MAX_BYTES),
			...(publishedDate ? { publishedDate } : {}),
			...(author ? { author } : {}),
			...(score !== undefined ? { score } : {})
		});
	}

	console.debug(`[exa-search] searchWeb: ${hits.length} results for ${queryLabel}`);
	return hits;
}

// ============================================================================
// readPage — Firecrawl headless browser scrape
// ============================================================================

/** Safety cap: discard content beyond this to prevent pathological pages from consuming memory. */
const PAGE_CONTENT_HARD_CAP = 200_000;

function normalizedMailtoEmail(link: unknown): string | null {
	if (
		typeof link !== 'string' ||
		link.length > PAGE_LINK_MAX_BYTES ||
		utf8ByteLength(link) > PAGE_LINK_MAX_BYTES ||
		!link.toLowerCase().startsWith('mailto:')
	) {
		return null;
	}
	let candidate = link.slice('mailto:'.length).split('?')[0];
	try {
		candidate = decodeURIComponent(candidate);
	} catch {
		return null;
	}
	if (
		!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/u.test(candidate) ||
		!isUsableContactEmail(candidate)
	) {
		return null;
	}
	return candidate;
}

function appendEmailBlock(
	text: string,
	heading: string,
	candidates: readonly string[]
): { text: string; appended: string[] } {
	let boundedText = text.slice(0, PAGE_CONTENT_HARD_CAP);
	const appended: string[] = [];
	for (const email of candidates) {
		const addition = `${appended.length === 0 ? heading : '\n'}${email}`;
		if (boundedText.length + addition.length > PAGE_CONTENT_HARD_CAP) break;
		boundedText += addition;
		appended.push(email);
	}
	return { text: boundedText, appended };
}

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
/**
 * Exa contents fallback — used when Firecrawl fails or returns empty.
 * Loses Firecrawl's unique capabilities (mailto: links, JS rendering, raw HTML)
 * but recovers text content for pages Firecrawl can't reach.
 */
async function fetchViaExaFallback(
	url: string,
	signal?: AbortSignal
): Promise<PageRetrievalOutcome<ExaPageContent>> {
	try {
		const rateLimiter = getContentsRateLimiter();
		const urlLabel = providerUrlLogLabel(url);

		const result = await rateLimiter.execute(
			// Exa returns extracted text on this path, not a raw-HTML field. Do not
			// manufacture script/style markers: when only a tiny stop-title survives,
			// the transport classifier below blocks without inventing a vendor.
			() => requestExa<{ results?: unknown }>('/contents', { urls: [url], text: true }, { signal }),
			`exa-contents ${urlLabel}`,
			signal
		);

		if (!result.success) {
			console.debug(
				`[page-fetch] Exa fallback failed for ${urlLabel}:`,
				sanitizeProviderErrorMessage(result.error)
			);
			return pageRetrievalBlocked(url, 'transport', 'exa_failed');
		}

		const results = Array.isArray(result.data?.results) ? result.data.results : [];
		if (results.length === 0) {
			console.debug(`[page-fetch] Exa fallback: no results for ${urlLabel}`);
			return pageRetrievalBlocked(url, 'transport', 'exa_no_result');
		}

		const first = results[0];
		if (!isRecord(first)) return pageRetrievalBlocked(url, 'transport', 'exa_malformed_result');
		const text = (typeof first.text === 'string' ? first.text : '').slice(0, PAGE_CONTENT_HARD_CAP);
		if (!text) {
			console.debug(`[page-fetch] Exa fallback: empty text for ${urlLabel}`);
			// Fact.absent: the provider returned a result and its parsed text was empty.
			return pageRetrievalAbsent(url, 'empty');
		}

		// Extract emails from Exa text as a best-effort (no structured mailto: access)
		const htmlEmails = extractEmailsFromHtml(text);
		const title = sanitizeProviderControlledText(first.title, SEARCH_RESULT_TITLE_MAX_BYTES);
		const blockSignal = classifyRetrievalBlock({ title, text });
		if (blockSignal) {
			console.debug(
				`[page-fetch] Exa fallback: blocked page ${urlLabel} (vendor=${blockSignal.vendor}, evidence=${blockSignal.evidence})`
			);
			return pageRetrievalBlocked(url, blockSignal);
		}

		const content: ExaPageContent = {
			url,
			title,
			text,
			highlights: htmlEmails,
			// Exa /contents returns extracted text, never the raw HTML required for
			// structural segmentation. This is BLOCKED, not an observed empty array.
			recordBlocks: blocked('exa_contents_returned_no_raw_html'),
			publishedDate:
				sanitizeProviderControlledText(first.publishedDate, SEARCH_RESULT_DATE_MAX_BYTES) ||
				undefined,
			statusCode: undefined
		};
		const transportDetail = exaFallbackTransportBlockedDetail(content);
		if (transportDetail) {
			console.debug(
				`[page-fetch] Exa fallback: blocked response for ${urlLabel} (status=${content.statusCode ?? '?'})`
			);
			return pageRetrievalBlocked(url, 'transport', transportDetail);
		}
		const absentReason = exaFallbackAbsentReason(content);
		if (absentReason) {
			console.debug(
				`[page-fetch] Exa fallback: dropping unusable page ${urlLabel} (${titleLogLabel(content.title)}, chars=${content.text.length})`
			);
			// Fact.absent: Exa returned readable text whose parsed title is an
			// observed not-found result, not a transport fallback.
			return pageRetrievalAbsent(url, absentReason);
		}
		console.debug(
			`[page-fetch] Exa fallback: recovered ${text.length} chars from ${urlLabel} (${titleLogLabel(typeof first.title === 'string' ? first.title : '')})`
		);
		return pageRetrievalOk(content);
	} catch (err) {
		console.debug(
			`[page-fetch] Exa fallback threw for ${providerUrlLogLabel(url)}:`,
			sanitizeProviderErrorMessage(err)
		);
		return pageRetrievalBlocked(url, 'transport', 'exa_exception');
	}
}

export async function readPageOutcome(
	url: string,
	options?: { maxCharacters?: number; signal?: AbortSignal }
): Promise<PageRetrievalOutcome<ExaPageContent>> {
	const rateLimiter = getFirecrawlRateLimiter();
	const urlLabel = providerUrlLogLabel(url);
	const normalizedUrl = normalizeExternalHttpUrl(url);
	if (!normalizedUrl) {
		console.warn(`[page-fetch] Rejected invalid external URL: ${urlLabel}`);
		return pageRetrievalBlocked(url, 'not_attempted', 'invalid_url');
	}
	url = normalizedUrl;

	console.debug(`[page-fetch] readPage: ${urlLabel}`);

	const result = await rateLimiter.execute(
		() =>
			requestFirecrawlScrape(url, {
				formats: ['markdown', 'links', 'rawHtml'],
				signal: options?.signal
			}),
		`firecrawl ${urlLabel}`,
		options?.signal
	);

	if (!result.success) {
		if (result.completionUnknown || options?.signal?.aborted) {
			console.warn(
				`[page-fetch] Firecrawl completion unknown for ${urlLabel}; suppressing overlapping fallback`
			);
			return pageRetrievalBlocked(
				url,
				'transport',
				options?.signal?.aborted ? 'aborted' : 'firecrawl_completion_unknown'
			);
		}
		console.warn(
			`[page-fetch] Firecrawl failed for ${urlLabel}: ${sanitizeProviderErrorMessage(result.error)} — trying Exa fallback`
		);
		return await fetchViaExaFallback(url, options?.signal);
	}

	const scrapeData: unknown = result.data;
	if (!isRecord(scrapeData) || typeof scrapeData.markdown !== 'string' || !scrapeData.markdown) {
		console.debug(`[page-fetch] Firecrawl empty for ${urlLabel} — trying Exa fallback`);
		return await fetchViaExaFallback(url, options?.signal);
	}
	const metadata = isRecord(scrapeData.metadata) ? scrapeData.metadata : {};
	const statusCode =
		typeof metadata.statusCode === 'number' &&
		Number.isSafeInteger(metadata.statusCode) &&
		metadata.statusCode >= 100 &&
		metadata.statusCode <= 599
			? metadata.statusCode
			: undefined;

	// Start with the rendered markdown (apply safety cap to prevent pathological pages)
	let text = scrapeData.markdown.slice(0, PAGE_CONTENT_HARD_CAP);
	const title = sanitizeProviderControlledText(metadata.title, SEARCH_RESULT_TITLE_MAX_BYTES);
	const blockSignal = classifyRetrievalBlock({
		statusCode,
		title,
		text,
		rawHtml: typeof scrapeData.rawHtml === 'string' ? scrapeData.rawHtml : undefined
	});
	if (blockSignal) {
		console.debug(
			`[page-fetch] readPage: blocked page ${urlLabel} (vendor=${blockSignal.vendor}, evidence=${blockSignal.evidence})`
		);
		return pageRetrievalBlocked(url, blockSignal);
	}

	// Extract emails from mailto: links — these are structurally extracted
	// and may include addresses that appear only as link targets, not in
	// visible page text (e.g., obfuscated or JS-generated mailto: hrefs)
	const links = Array.isArray(scrapeData.links)
		? scrapeData.links.slice(0, PAGE_LINK_INSPECTION_LIMIT)
		: [];
	// Same-institution link graph reads the RAW link list, not the mailto slice
	// above: it has its own scan/retain caps and shares no state with email
	// extraction. `url` is already the normalized page URL, so the self-link
	// comparison inside compares like with like.
	const sameDomainLinks = sameInstitutionLinks(url, scrapeData.links);
	const mailtoEmails: string[] = [];
	const seenEmails = new Set<string>();
	for (const link of links) {
		if (mailtoEmails.length >= PAGE_EXTRACTED_EMAIL_LIMIT) break;
		const email = normalizedMailtoEmail(link);
		const lower = email?.toLowerCase();
		if (!email || !lower || seenEmails.has(lower)) continue;
		seenEmails.add(lower);
		mailtoEmails.push(email);
	}

	if (mailtoEmails.length > 0) {
		const appended = appendEmailBlock(
			text,
			`\n\n${CONTACT_EMAIL_BLOCK_HEADINGS[0]}\n`,
			mailtoEmails
		);
		text = appended.text;
		mailtoEmails.splice(0, mailtoEmails.length, ...appended.appended);
		console.debug(
			`[page-fetch] readPage: ${mailtoEmails.length} mailto emails appended for ${urlLabel}`
		);
	}

	// Extract emails from raw HTML that markdown conversion may have missed.
	// Government CMS pages often have emails as plain text in <p> tags
	// or in HTML attributes that don't survive markdown conversion.
	let recordBlocks: Fact<SegmentResult> = blocked('firecrawl_returned_no_raw_html');
	if (typeof scrapeData.rawHtml === 'string') {
		const segmentedRecords = await segmentRecordBlocks(scrapeData.rawHtml);
		recordBlocks = observedRecordBlocks(segmentedRecords);
		const htmlEmails = extractEmailsFromHtml(
			scrapeData.rawHtml,
			PAGE_EXTRACTED_EMAIL_LIMIT - mailtoEmails.length
		);
		const existingLower = new Set([
			...seenEmails,
			...extractEmailsFromHtml(text).map((email) => email.toLowerCase())
		]);
		const newEmails = htmlEmails.filter((email) => !existingLower.has(email.toLowerCase()));
		if (newEmails.length > 0) {
			const appended = appendEmailBlock(
				text,
				`\n\n${CONTACT_EMAIL_BLOCK_HEADINGS[1]}\n`,
				newEmails
			);
			text = appended.text;
			mailtoEmails.push(...appended.appended);
			console.debug(
				`[page-fetch] readPage: ${appended.appended.length} HTML-only emails appended for ${urlLabel}`
			);
		}
	}
	text = text.slice(0, PAGE_CONTENT_HARD_CAP);

	const content: ExaPageContent = {
		url,
		title,
		text,
		highlights: mailtoEmails,
		// Key ABSENT when no link graph was evaluable, PRESENT (even at `[]`) when one
		// was. A conditional spread is what keeps those two facts distinguishable —
		// writing `links: sameDomainLinks` unconditionally would stamp an explicit
		// `links: undefined` key onto the object and make `hasOwnProperty` lie.
		...(sameDomainLinks === undefined ? {} : { links: sameDomainLinks }),
		recordBlocks,
		publishedDate: undefined,
		statusCode
	};

	// Drop 404 / empty / not-found pages so they don't poison synthesis context.
	// Without this gate they're counted in "N pages readable" and the LLM sees
	// "Not Found | SF.gov" alongside real pages.
	if (isUnusablePage(content)) {
		const transportDetail = transportBlockedDetail(content);
		if (transportDetail) {
			console.debug(
				`[page-fetch] readPage: blocked response ${urlLabel} (status=${content.statusCode ?? '?'})`
			);
			return pageRetrievalBlocked(url, 'transport', transportDetail);
		}
		console.debug(
			`[page-fetch] readPage: dropping unusable page ${urlLabel} (status=${content.statusCode ?? '?'}, ${titleLogLabel(content.title)}, chars=${content.text.length}, emails=${mailtoEmails.length})`
		);
		return pageRetrievalAbsent(url, unusablePageReason(content), content.statusCode);
	}

	console.debug(
		`[page-fetch] readPage: ${content.text.length} chars from ${urlLabel} (${titleLogLabel(content.title)})`
	);
	return pageRetrievalOk(content);
}

export async function readPage(
	url: string,
	options?: { maxCharacters?: number; signal?: AbortSignal }
): Promise<ExaPageContent | null> {
	const result = await readPageOutcome(url, options);
	return result.outcome === 'ok' ? result.page : null;
}

/**
 * Reject pages whose content can't meaningfully inform synthesis:
 * - HTTP 4xx/5xx (statusCode present and >= 400)
 * - Title matches a broken-page pattern (404, gone, forbidden, etc.) anywhere
 *   in the title — common CMS formats interleave prefix/suffix branding.
 * - Body under 200 chars AND no extracted email evidence in EITHER Exa
 *   highlights OR the body markdown (concise official contact pages
 *   routinely surface emails in markdown only).
 */
/** Phrase forms only — bare lexemes like "gone", "forbidden", and "500" trip
 * legitimate titles ("Gone with the Wind: Voting Rights", "500 Cities Project").
 * 404 stays as a single token: it's overwhelmingly an HTTP status in title
 * context and the false-positive surface is narrow. */
const UNUSABLE_TITLE_RE =
	/(^|\W)(not found|page not found|page missing|404|403 forbidden|access denied|server error|service unavailable)(\W|$)/i;
const EXA_NOT_FOUND_TITLE_RE = /(^|\W)(not found|page not found|page missing|404)(\W|$)/i;
const EXA_STOP_TITLE_RE =
	/(^|\W)(just a moment|access denied|access to this page has been denied|403 forbidden|server error|service unavailable)(\W|$)/i;
const EMAIL_IN_BODY_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Same false-positive filter the HTML extractor uses (see extractEmailsFromHtml).
 * A short page whose only email is `noreply@…` or `example.com` is still empty
 * from a recipient-extraction perspective. */
function hasUsableBodyEmail(text: string): boolean {
	const matches = text.match(EMAIL_IN_BODY_RE);
	if (!matches) return false;
	return matches.some(isUsableContactEmail);
}

function hasUsablePageContact(content: ExaPageContent): boolean {
	return (
		(content.highlights?.some(isUsableContactEmail) ?? false) ||
		hasUsableRetrievalContact(`${content.title}\n${content.text}`)
	);
}

function isUnusablePage(content: ExaPageContent): boolean {
	if (typeof content.statusCode === 'number' && content.statusCode >= 400) return true;
	if (UNUSABLE_TITLE_RE.test(content.title) && !hasUsablePageContact(content)) return true;
	if (content.text.length < 200) {
		const hasHighlightEmail = (content.highlights?.length ?? 0) > 0;
		if (!hasHighlightEmail && !hasUsableBodyEmail(content.text)) return true;
	}
	return false;
}

/**
 * Exa has no response status and returns extracted text only. Generic stop
 * titles can license BLOCKED only with the full surviving provider shape: tiny
 * visible text and no usable contact. Not-found titles are handled separately
 * as observed ABSENT results after Exa returned and we parsed their text.
 */
function exaFallbackTransportBlockedDetail(content: ExaPageContent): string | null {
	if (
		EXA_STOP_TITLE_RE.test(content.title) &&
		content.text.length < EXA_INTERSTITIAL_MAX_CHARACTERS &&
		!hasUsablePageContact(content)
	) {
		return 'unusable_title';
	}
	if (
		!EXA_NOT_FOUND_TITLE_RE.test(content.title) &&
		content.text.length < EXA_INTERSTITIAL_MAX_CHARACTERS &&
		!hasUsablePageContact(content)
	) {
		return 'short_unusable_body';
	}
	return null;
}

/**
 * Exa licenses ABSENT only after it returned and parsed a not-found source. A
 * short nonempty extraction is not proof that the source published nothing;
 * without a not-found signal it remains BLOCKED/transport above. Only the
 * truly empty provider result is observed ABSENT/empty at the fetch boundary.
 */
function exaFallbackAbsentReason(content: ExaPageContent): AbsentReason | null {
	if (hasUsablePageContact(content)) return null;
	if (EXA_NOT_FOUND_TITLE_RE.test(content.title)) return 'not_found';
	return null;
}

/**
 * A non-not-found HTTP error or an unusable-title interstitial means the source
 * refused or failed before a page could be read. That is BLOCKED under the shared
 * Fact contract, not an observed empty source. WAF-attributed responses have
 * already returned above.
 */
function transportBlockedDetail(content: ExaPageContent): string | null {
	if (
		typeof content.statusCode === 'number' &&
		content.statusCode >= 400 &&
		content.statusCode !== 404 &&
		content.statusCode !== 410
	) {
		return `http_status_${content.statusCode}`;
	}
	if (EXA_STOP_TITLE_RE.test(content.title) && !hasUsablePageContact(content)) {
		return 'unusable_title';
	}
	return null;
}

function unusablePageReason(content: ExaPageContent): AbsentReason {
	if (
		content.statusCode === 404 ||
		content.statusCode === 410 ||
		EXA_NOT_FOUND_TITLE_RE.test(content.title)
	) {
		return 'not_found';
	}
	return 'empty';
}

// ============================================================================
// prunePageContent — Contact-priority content assembly
// ============================================================================

const PRUNE_TARGET_CHARS = 15_000;
const LINK_CLUSTER_MIN_LINKS = 3;
const LINK_CLUSTER_RATIO = 0.5;

const BOILERPLATE_PATTERNS = [
	'cookie',
	'privacy policy',
	'terms of service',
	'terms of use',
	'subscribe to our newsletter',
	'sign up for',
	'skip to content',
	'skip to main',
	'all rights reserved',
	'©'
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
		.filter((n) => n && n !== 'UNKNOWN')
		.flatMap((n) => {
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
	const enum ParagraphClass {
		PROTECTED,
		NOISE,
		CONTEXT
	}
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
			nameFragments.some((name) => paraLower.includes(name));

		if (hasContactSignal) {
			classes[i] = ParagraphClass.PROTECTED;
			continue;
		}

		// Check for noise
		const linkCount = countLinks(para);
		const linkCharCount = countLinkChars(para);
		const isLinkCluster =
			linkCount >= LINK_CLUSTER_MIN_LINKS &&
			para.length > 0 &&
			linkCharCount / para.length >= LINK_CLUSTER_RATIO;

		const isBoilerplate = BOILERPLATE_PATTERNS.some((p) => paraLower.includes(p));

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
			charsRemaining -= part.length + 2;
		}
		if (contextBlock.length > 0) {
			result = contextBlock.join('\n\n') + '\n\n' + result;
		}
	}

	// Safety invariant: verify no contact signals lost
	const prunedSignals = extractContactHints(result);
	const emailsLost = fullSignals.emails.filter(
		(e) => !prunedSignals.emails.some((pe) => pe.toLowerCase() === e.toLowerCase())
	);
	const phonesLost = fullSignals.phones.filter((p) => !prunedSignals.phones.includes(p));

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
export function pruneSourceContent(
	text: string,
	maxChars: number = SOURCE_PRUNE_TARGET_CHARS
): string {
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
			/\b(?:H\.?R\.?\s*\d|S\.?\s*\d|bill|resolution|ordinance|statute|vote[ds]?\s+\d|passed\s+\d|enacted)\b/i.test(
				para
			) ||
			// Dates with context (not just bare years)
			/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/.test(
				para
			) ||
			// Methodology / research signals
			/\b(?:sample size|n\s*=\s*\d|confidence interval|margin of error|statistically|regression|survey(?:ed)?|respondents)\b/i.test(
				para
			) ||
			// Specific findings language
			/\b(?:found that|results show|data (?:shows?|indicates?|reveals?)|according to the)\b/i.test(
				para
			);

		if (hasFactualSignal) {
			classes[i] = PARA_PROTECTED;
			continue;
		}

		// Check for noise (same patterns as prunePageContent)
		const linkCount = countLinks(para);
		const linkCharCount = countLinkChars(para);
		const isLinkCluster =
			linkCount >= LINK_CLUSTER_MIN_LINKS &&
			para.length > 0 &&
			linkCharCount / para.length >= LINK_CLUSTER_RATIO;

		const isBoilerplate = BOILERPLATE_PATTERNS.some((p) => paraLower.includes(p));

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
			charsRemaining -= part.length + 2;
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
	const hasMethodology =
		/\b(?:methodology|sample size|n\s*=\s*\d|confidence interval|margin of error|statistically significant|regression analysis)\b/i.test(
			text
		);

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
	const missionMatch = text
		.slice(0, 2000)
		.match(
			/(?:is a|is an|is the)\s+((?:non-?profit|organization|institute|foundation|center|association|agency|bureau|department)[^.]{10,200}\.)/i
		);
	if (missionMatch) {
		return missionMatch[0].trim().slice(0, 300);
	}

	return undefined;
}

/** Classify source as primary, secondary, opinion, or unknown */
function classifySourceOrder(text: string): 'primary' | 'secondary' | 'opinion' | 'unknown' {
	const isOpinion =
		/\b(?:editorial|op-?ed|opinion|commentary|perspective|column|my view|I (?:believe|think|argue))\b/i.test(
			text
		);
	if (isOpinion) return 'opinion';

	// Secondary signals: reporting on others' data/research
	const secondarySignals =
		/\b(?:according to|a report by|data from|published by|researchers found|a study by)\b/i.test(
			text
		);
	// Primary signals: this source produced the data itself
	const primarySignals =
		/\b(?:our (?:survey|study|analysis|research|findings|report)|we (?:found|collected|analyzed|surveyed|measured)|methodology|sample size|n\s*=\s*\d)\b/i.test(
			text
		);

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
