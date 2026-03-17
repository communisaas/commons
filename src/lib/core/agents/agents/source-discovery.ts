/**
 * Source Discovery Agent — Exa Stratified Search + Firecrawl Content Fetch + Gemini Evaluation
 *
 * Phase 1a (Stratified Search): 3 parallel Exa queries — gov, news, general.
 *   - Deterministic query construction from subject/message/topics/geo.
 *   - Exa params: includeDomains, category, startPublishedDate per stratum.
 *   - Deduplication by normalized URL.
 *
 * Phase 1b (Content Fetch): Top 6 candidates fetched via Firecrawl.
 *   - Firecrawl scrape replaces URL validation (accessible page = valid URL).
 *   - pruneSourceContent() extracts citable excerpts (3K chars).
 *   - extractProvenance() extracts provenance signals per source.
 *
 * Phase 1c (Evaluation): Gemini source evaluator with incentive-aware ranking.
 *   - Structured JSON output (responseSchema, no grounding).
 *   - Evaluates credibility, incentive alignment, source order.
 *   - Returns 3-6 EvaluatedSource[] for the message writer.
 */

import { searchWeb, readPage, pruneSourceContent, extractProvenance } from '../exa-search';
import type { ExaSearchHit } from '../exa-search';
import { evaluateSources } from './source-evaluator';
import type { TokenUsage, SourceCandidate, EvaluatedSource } from '../types';
import { traceEvent } from '$lib/server/agent-trace';

// ============================================================================
// Types
// ============================================================================

export interface DiscoveredSource {
	/** Citation number for the message */
	num: number;
	/** Article/page title */
	title: string;
	/** Actual URL from search results */
	url: string;
	/** Source type for categorization */
	type: 'journalism' | 'research' | 'government' | 'legal' | 'advocacy' | 'other';
	/** Brief description of what this source covers */
	snippet: string;
	/** How this source supports the message */
	relevance: string;
	/** Publication date if available */
	date?: string;
	/** Publisher/organization name */
	publisher?: string;
}

export interface SourceDiscoveryResult {
	/** All sources discovered from search */
	discovered: DiscoveredSource[];
	/** Evaluated sources with incentive analysis (primary output) */
	evaluated: EvaluatedSource[];
	/** Sources that failed validation (for debugging) */
	failed: Array<{ source: DiscoveredSource; error: string }>;
	/** Search queries used */
	searchQueries: string[];
	/** Total discovery time in ms */
	latencyMs: number;
	/** Token usage from the source evaluation LLM call */
	tokenUsage?: TokenUsage;
	/** Number of Google Search grounding queries executed (legacy — always 0) */
	groundingSearches: number;
	/** External API call counts */
	externalCounts: {
		exaSearches: number;
		firecrawlReads: number;
		groundingSearches: number;
	};
}

export interface SourceDiscoveryOptions {
	/** Core message/topic to research */
	coreMessage: string;
	/** Subject line for context */
	subjectLine: string;
	/** Topic tags for search refinement */
	topics: string[];
	/** Geographic scope for local sources */
	geographicScope?: {
		type: 'international' | 'nationwide' | 'subnational';
		country?: string;
		subdivision?: string;
		locality?: string;
	};
	/** Decision makers receiving this message (for evaluator context) */
	decisionMakers?: Array<{ name: string; title: string; organization: string }>;
	/** Callback for streaming thoughts */
	onThought?: (thought: string) => void;
	/** Callback for phase updates */
	onPhase?: (phase: 'discover' | 'validate' | 'complete', message: string) => void;
	/** Trace ID for observability — enables fire-and-forget trace events */
	traceId?: string;
}

// ============================================================================
// Query Construction
// ============================================================================

/**
 * Build stratified search queries deterministically from structured input.
 * No LLM involved — queries are constructed from subject/message/topics/geo.
 */
function buildSearchQueries(
	subjectLine: string,
	coreMessage: string,
	topics: string[],
	geo?: SourceDiscoveryOptions['geographicScope']
): { gov: string; news: string; general: string } {
	const locationPrefix = geo?.locality
		? `${geo.locality} ${geo.subdivision || ''}`
		: geo?.subdivision || geo?.country || '';

	const year = new Date().getFullYear();
	const topicStr = topics.slice(0, 3).join(' ');

	return {
		gov: `${locationPrefix} ${topicStr} ${year}`.trim(),
		news: `${locationPrefix} ${subjectLine}`.trim(),
		general: `${coreMessage.slice(0, 120)}`.trim()
	};
}

// ============================================================================
// URL Normalization & Deduplication
// ============================================================================

/**
 * Normalize a URL for deduplication: strip trailing slash, query params, fragments.
 */
function normalizeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		// Strip query params and fragment
		return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, '');
	} catch {
		// If URL is malformed, just lowercase and strip trailing slash
		return url.toLowerCase().replace(/\/+$/, '');
	}
}

/**
 * Deduplicate search hits by normalized URL. First occurrence wins.
 */
function deduplicateHits(
	hits: Array<ExaSearchHit & { stratum: 'gov' | 'news' | 'general' }>
): Array<ExaSearchHit & { stratum: 'gov' | 'news' | 'general' }> {
	const seen = new Set<string>();
	return hits.filter((hit) => {
		const normalized = normalizeUrl(hit.url);
		if (seen.has(normalized)) return false;
		seen.add(normalized);
		return true;
	});
}

// ============================================================================
// Candidate Selection
// ============================================================================

/**
 * Select top candidates from deduplicated pool.
 * At least 1 per stratum if available, then by Exa score.
 */
function selectTopCandidates(
	hits: Array<ExaSearchHit & { stratum: 'gov' | 'news' | 'general' }>,
	maxCandidates: number = 6
): Array<ExaSearchHit & { stratum: 'gov' | 'news' | 'general' }> {
	if (hits.length <= maxCandidates) return hits;

	const selected: Array<ExaSearchHit & { stratum: 'gov' | 'news' | 'general' }> = [];
	const remaining: Array<ExaSearchHit & { stratum: 'gov' | 'news' | 'general' }> = [];

	// Guarantee at least 1 per stratum
	const strata: Array<'gov' | 'news' | 'general'> = ['gov', 'news', 'general'];
	const selectedStrata = new Set<string>();

	// Sort all hits by score descending
	const sortedHits = [...hits].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

	for (const hit of sortedHits) {
		if (!selectedStrata.has(hit.stratum) && selected.length < maxCandidates) {
			selected.push(hit);
			selectedStrata.add(hit.stratum);
		} else {
			remaining.push(hit);
		}
	}

	// Fill remaining slots by score
	for (const hit of remaining) {
		if (selected.length >= maxCandidates) break;
		selected.push(hit);
	}

	return selected;
}

// ============================================================================
// Main Discovery Function
// ============================================================================

/**
 * Discover, fetch, and evaluate sources for a civic message.
 *
 * Three-phase pipeline:
 * 1a. Stratified Exa search (gov, news, general) — parallel
 * 1b. Firecrawl content fetch — top 6 candidates, parallel
 * 1c. Gemini source evaluation — incentive-aware ranking
 */
export async function discoverSources(
	options: SourceDiscoveryOptions
): Promise<SourceDiscoveryResult> {
	const startTime = Date.now();
	const { coreMessage, subjectLine, topics, geographicScope, onThought, onPhase, traceId } = options;

	console.debug('[source-discovery] Starting Exa stratified search pipeline...');

	// ====================================================================
	// Phase 1a: Stratified Exa Search
	// ====================================================================

	onPhase?.('discover', 'Searching for credible sources...');

	const queries = buildSearchQueries(subjectLine, coreMessage, topics, geographicScope);
	const searchQueries = [queries.gov, queries.news, queries.general];

	onThought?.(`Searching 3 source strata: government, news, and general research...`);

	// Temporal filters
	const sixMonthsAgo = new Date();
	sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
	const twoYearsAgo = new Date();
	twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

	// Fire 3 parallel searches — each with stratum-specific Exa params
	const [govResults, newsResults, generalResults] = await Promise.allSettled([
		searchWeb(queries.gov, {
			maxResults: 10,
			includeDomains: ['.gov', '.gov.uk', '.gc.ca', '.gov.au', '.europa.eu'],
			startPublishedDate: twoYearsAgo.toISOString()
		}),
		searchWeb(queries.news, {
			maxResults: 10,
			category: 'news',
			excludeDomains: ['.gov'],
			startPublishedDate: sixMonthsAgo.toISOString()
		}),
		searchWeb(queries.general, {
			maxResults: 10,
			excludeDomains: ['.gov'],
			excludeText: ['subscribe to our newsletter'],
			startPublishedDate: twoYearsAgo.toISOString()
		})
	]);

	// Count successful searches
	let exaSearches = 0;

	// Tag each hit with its stratum and collect
	const allHits: Array<ExaSearchHit & { stratum: 'gov' | 'news' | 'general' }> = [];

	if (govResults.status === 'fulfilled') {
		exaSearches++;
		for (const hit of govResults.value) {
			allHits.push({ ...hit, stratum: 'gov' });
		}
	} else {
		console.warn('[source-discovery] Gov search failed:', govResults.reason);
	}

	if (newsResults.status === 'fulfilled') {
		exaSearches++;
		for (const hit of newsResults.value) {
			allHits.push({ ...hit, stratum: 'news' });
		}
	} else {
		console.warn('[source-discovery] News search failed:', newsResults.reason);
	}

	if (generalResults.status === 'fulfilled') {
		exaSearches++;
		for (const hit of generalResults.value) {
			allHits.push({ ...hit, stratum: 'general' });
		}
	} else {
		console.warn('[source-discovery] General search failed:', generalResults.reason);
	}

	console.debug('[source-discovery] Phase 1a complete:', {
		totalHits: allHits.length,
		govHits: govResults.status === 'fulfilled' ? govResults.value.length : 0,
		newsHits: newsResults.status === 'fulfilled' ? newsResults.value.length : 0,
		generalHits: generalResults.status === 'fulfilled' ? generalResults.value.length : 0
	});

	// Deduplicate by normalized URL
	const deduplicated = deduplicateHits(allHits);

	console.debug(`[source-discovery] Deduplicated: ${allHits.length} → ${deduplicated.length}`);

	// Trace: Phase 1a search results
	if (traceId) {
		traceEvent(traceId, 'message-generation', 'source-search', {
			exaSearches,
			totalHits: allHits.length,
			deduplicatedHits: deduplicated.length,
			govHits: govResults.status === 'fulfilled' ? govResults.value.length : 0,
			newsHits: newsResults.status === 'fulfilled' ? newsResults.value.length : 0,
			generalHits: generalResults.status === 'fulfilled' ? generalResults.value.length : 0,
			govFailed: govResults.status === 'rejected',
			newsFailed: newsResults.status === 'rejected',
			generalFailed: generalResults.status === 'rejected',
			searchQueries
		});
	}

	if (deduplicated.length === 0) {
		onPhase?.('complete', 'No sources found through search');
		return {
			discovered: [],
			evaluated: [],
			failed: [],
			searchQueries,
			latencyMs: Date.now() - startTime,
			groundingSearches: 0,
			externalCounts: { exaSearches, firecrawlReads: 0, groundingSearches: 0 }
		};
	}

	onThought?.(`Found ${deduplicated.length} unique candidates across ${exaSearches} searches. Fetching top sources...`);

	// ====================================================================
	// Phase 1b: Firecrawl Content Fetch (top 6 candidates)
	// ====================================================================

	onPhase?.('validate', `Fetching content from top sources...`);

	const topCandidates = selectTopCandidates(deduplicated, 6);

	console.debug('[source-discovery] Phase 1b: Fetching', topCandidates.length, 'pages...');

	// Parallel page fetches
	const pageResults = await Promise.allSettled(
		topCandidates.map((candidate) => readPage(candidate.url))
	);

	// Build SourceCandidate[] from successful fetches
	const candidates: SourceCandidate[] = [];
	const discovered: DiscoveredSource[] = [];
	const failed: Array<{ source: DiscoveredSource; error: string }> = [];
	let firecrawlReads = 0;

	for (let i = 0; i < topCandidates.length; i++) {
		const candidate = topCandidates[i];
		const pageResult = pageResults[i];

		// Build a DiscoveredSource for all attempted candidates
		const discoveredSource: DiscoveredSource = {
			num: i + 1,
			title: candidate.title,
			url: candidate.url,
			type: 'other',
			snippet: '',
			relevance: '',
			date: candidate.publishedDate,
			publisher: undefined
		};
		discovered.push(discoveredSource);

		if (pageResult.status === 'fulfilled' && pageResult.value) {
			firecrawlReads++;
			const page = pageResult.value;

			// Prune content to 3K citable excerpt
			const excerpt = pruneSourceContent(page.text);

			// Extract provenance signals
			const provenance = extractProvenance(page);

			candidates.push({
				url: page.url || candidate.url,
				title: page.title || candidate.title,
				publishedDate: candidate.publishedDate,
				exaScore: candidate.score,
				stratum: candidate.stratum,
				excerpt,
				provenance
			});

			// Update discovered source with fetched data
			discoveredSource.title = page.title || candidate.title;
			discoveredSource.publisher = provenance.publisher;
		} else {
			const error = pageResult.status === 'rejected'
				? String(pageResult.reason)
				: 'No content returned';
			failed.push({ source: discoveredSource, error });
			console.warn(`[source-discovery] Page fetch failed: ${candidate.url} - ${error}`);
		}
	}

	console.debug('[source-discovery] Phase 1b complete:', {
		fetched: firecrawlReads,
		candidates: candidates.length,
		failed: failed.length
	});

	if (candidates.length === 0) {
		onPhase?.('complete', 'No source content could be fetched');
		return {
			discovered,
			evaluated: [],
			failed,
			searchQueries,
			latencyMs: Date.now() - startTime,
			groundingSearches: 0,
			externalCounts: { exaSearches, firecrawlReads, groundingSearches: 0 }
		};
	}

	onThought?.(`Fetched ${candidates.length} pages. Evaluating source credibility and incentive alignment...`);

	// ====================================================================
	// Phase 1c: Gemini Source Evaluation
	// ====================================================================

	const evaluationContext = {
		subjectLine,
		coreMessage,
		topics,
		geographicScope: geographicScope ? {
			type: geographicScope.type,
			country: geographicScope.country,
			subdivision: geographicScope.subdivision,
			locality: geographicScope.locality
		} : undefined,
		decisionMakers: options.decisionMakers
	};

	let evaluated: EvaluatedSource[];
	let evaluationTokenUsage: TokenUsage | undefined;

	try {
		const evalResult = await evaluateSources(
			candidates,
			evaluationContext,
			onThought
		);
		evaluated = evalResult.sources;
		evaluationTokenUsage = evalResult.tokenUsage;
	} catch (error) {
		console.error('[source-discovery] Source evaluation failed, using candidates as fallback:', error);
		// Fallback: convert candidates to basic EvaluatedSource without Gemini evaluation
		evaluated = candidates.map((c, idx) => ({
			num: idx + 1,
			title: c.title,
			url: c.url,
			type: inferSourceType(c.url) as EvaluatedSource['type'],
			snippet: c.excerpt.slice(0, 200),
			relevance: `Found via ${c.stratum} search`,
			date: c.publishedDate,
			publisher: c.provenance.publisher,
			excerpt: c.excerpt,
			credibility_rationale: 'Evaluation unavailable — source included based on search relevance.',
			incentive_position: 'neutral' as const,
			source_order: c.provenance.sourceOrder === 'unknown' ? 'secondary' as const : c.provenance.sourceOrder === 'opinion' ? 'opinion' as const : c.provenance.sourceOrder as 'primary' | 'secondary'
		}));
	}

	// Renumber evaluated sources
	evaluated.forEach((source, index) => {
		source.num = index + 1;
	});

	// Trace: Phase 1c evaluation results
	if (traceId) {
		const incentiveBreakdown = {
			adversarial: evaluated.filter(s => s.incentive_position === 'adversarial').length,
			neutral: evaluated.filter(s => s.incentive_position === 'neutral').length,
			aligned: evaluated.filter(s => s.incentive_position === 'aligned').length
		};
		traceEvent(traceId, 'message-generation', 'source-evaluation', {
			candidatesIn: candidates.length,
			sourcesOut: evaluated.length,
			incentiveBreakdown,
			sourceOrders: {
				primary: evaluated.filter(s => s.source_order === 'primary').length,
				secondary: evaluated.filter(s => s.source_order === 'secondary').length,
				opinion: evaluated.filter(s => s.source_order === 'opinion').length
			},
			firecrawlReads,
			evaluationTokens: evaluationTokenUsage?.totalTokens ?? null
		});
	}

	const latencyMs = Date.now() - startTime;

	console.debug('[source-discovery] Pipeline complete:', {
		discovered: discovered.length,
		evaluated: evaluated.length,
		failed: failed.length,
		exaSearches,
		firecrawlReads,
		latencyMs
	});

	onPhase?.('complete', `Evaluated ${evaluated.length} sources from ${discovered.length} candidates`);

	return {
		discovered,
		evaluated,
		failed,
		searchQueries,
		latencyMs,
		tokenUsage: evaluationTokenUsage,
		groundingSearches: 0,
		externalCounts: { exaSearches, firecrawlReads, groundingSearches: 0 }
	};
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Infer source type from URL domain as a rough heuristic.
 */
function inferSourceType(url: string): string {
	try {
		const hostname = new URL(url).hostname.toLowerCase();
		if (hostname.endsWith('.gov') || hostname.includes('.gov.')) return 'government';
		if (hostname.endsWith('.edu') || hostname.includes('.edu.')) return 'research';
		if (hostname.includes('court') || hostname.includes('law') || hostname.includes('legal')) return 'legal';
		// Common news domains
		const newsDomains = ['nytimes', 'washingtonpost', 'reuters', 'apnews', 'bbc', 'cnn', 'npr', 'politico', 'thehill'];
		if (newsDomains.some(d => hostname.includes(d))) return 'journalism';
		return 'other';
	} catch {
		return 'other';
	}
}

/**
 * Parse a date string and return days since that date, or null if unparseable.
 * Handles ISO, English date formats, and partial dates (e.g., "January 2026").
 */
function daysSince(dateStr: string | undefined): number | null {
	if (!dateStr || dateStr === 'Unknown') return null;
	const parsed = new Date(dateStr);
	if (isNaN(parsed.getTime())) return null;
	return Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Format sources for inclusion in message generation prompt.
 *
 * Includes incentive context, credibility rationale, source order, and
 * citable excerpts for each EvaluatedSource.
 *
 * Sources are sorted by freshness (most recent first) and annotated
 * with days-ago to give the message writer unambiguous recency signals.
 */
export function formatSourcesForPrompt(sources: EvaluatedSource[]): string {
	if (sources.length === 0) {
		return 'No verified sources available. Write the message without citations.';
	}

	// Calculate freshness for each source
	const withAge = sources.map((s) => ({ source: s, age: daysSince(s.date) }));

	// Sort: known-recent first, then known-older, then unknown-date last
	withAge.sort((a, b) => {
		if (a.age === null && b.age === null) return 0;
		if (a.age === null) return 1;
		if (b.age === null) return -1;
		return a.age - b.age;
	});

	// Build freshness summary
	const knownAges = withAge.filter((w) => w.age !== null);
	const recentCount = knownAges.filter((w) => w.age! <= 30).length;
	const freshest = knownAges.length > 0 ? knownAges[0].age : null;
	const freshnessSummary =
		freshest !== null
			? `Freshest source: ${freshest} days old. ${recentCount} of ${sources.length} sources from the last 30 days.`
			: '';

	const formatted = withAge
		.map(({ source: s, age }) => {
			const dateField = s.date || 'Unknown';
			const ageAnnotation = age !== null ? ` (${age} days ago)` : '';

			const incentiveTag = {
				adversarial: 'ADVERSARIAL \u2014 this source\'s creator would prefer a different conclusion, yet the data supports your argument. Frame as: "Even [entity] acknowledges..." or "The [entity]\'s own data shows..."',
				neutral: 'NEUTRAL \u2014 this source has no stake in the outcome. Cite its findings directly.',
				aligned: 'ALIGNED \u2014 this source shares the citizen\'s position. Use for constituency signals, not as neutral authority.'
			}[s.incentive_position];

			return `[${s.num}] ${s.title}
   URL: ${s.url}
   Type: ${s.type} | Source Order: ${s.source_order} | Publisher: ${s.publisher || 'Unknown'}
   Date: ${dateField}${ageAnnotation}
   Credibility: ${s.credibility_rationale}
   Incentive Position: ${incentiveTag}

   KEY CONTENT:
   ${s.excerpt}`;
		})
		.join('\n\n---\n\n');

	return `## Verified Sources (cite using [1], [2], etc.)
${freshnessSummary ? `\n${freshnessSummary}\n` : ''}
${formatted}

CITATION PRINCIPLES:
- You have the actual content above \u2014 cite specific facts, statistics, and quotes, not summaries.
- Frame each citation according to its INCENTIVE POSITION. An adversarial citation framed as
  neutral wastes its persuasive power. An aligned citation framed as neutral overstates its authority.
- Primary sources should be cited with specifics from the excerpt. Secondary sources should be
  cited for their reporting, not as if they produced the underlying data.
- When a source contains a specific number, date, vote count, or finding, cite it precisely.
- Cite ONLY from this list using exact URLs. Do not fabricate or modify URLs.`;
}
