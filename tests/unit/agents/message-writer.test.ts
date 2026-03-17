/**
 * Unit Tests — Message Writer Agent + Source Discovery
 *
 * Tests the two-phase pipeline:
 *   Phase 1 (source-discovery.ts): Exa stratified search, Firecrawl fetch, Gemini evaluation
 *   Phase 2 (message-writer.ts): Citation-only-from-verified-pool enforcement
 *
 * All external API calls (Exa, Firecrawl, Gemini) are mocked.
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockGenerateContentStream = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => {
	class MockGoogleGenAI {
		models = {
			generateContent: vi.fn(),
			generateContentStream: mockGenerateContentStream
		};
		constructor(_opts: { apiKey: string }) {}
	}
	return { GoogleGenAI: MockGoogleGenAI };
});

// Mock Exa search + Firecrawl page fetch (source-discovery Phase 1a/1b)
const mockSearchWeb = vi.hoisted(() => vi.fn());
const mockReadPage = vi.hoisted(() => vi.fn());
const mockPruneSourceContent = vi.hoisted(() => vi.fn((text: string) => text.slice(0, 3000)));
const mockExtractProvenance = vi.hoisted(() => vi.fn(() => ({
	publisher: 'test-publisher.com',
	orgDescription: undefined,
	fundingDisclosure: undefined,
	sourceOrder: 'secondary' as const,
	advocacyIndicators: [],
	author: undefined,
	hasMethodology: false
})));

vi.mock('$lib/core/agents/exa-search', () => ({
	searchWeb: mockSearchWeb,
	readPage: mockReadPage,
	pruneSourceContent: mockPruneSourceContent,
	extractProvenance: mockExtractProvenance
}));

// Mock source evaluator (source-discovery Phase 1c)
const mockEvaluateSources = vi.hoisted(() => vi.fn());

vi.mock('$lib/core/agents/agents/source-evaluator', () => ({
	evaluateSources: mockEvaluateSources
}));

// Mock agent trace (fire-and-forget observability)
const mockTraceEvent = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/agent-trace', () => ({
	traceEvent: mockTraceEvent
}));

// ============================================================================
// Import SUT
// ============================================================================

import {
	discoverSources,
	formatSourcesForPrompt,
	type DiscoveredSource,
	type SourceDiscoveryOptions,
	type SourceDiscoveryResult
} from '$lib/core/agents/agents/source-discovery';
import { generateMessage, type GenerateMessageOptions } from '$lib/core/agents/agents/message-writer';
import type { EvaluatedSource, SourceCandidate } from '$lib/core/agents/types';
import type { ExaSearchHit } from '$lib/core/agents/exa-search';

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal async iterable for stream mocking */
function makeStream(chunks: Array<{ text?: string; thought?: boolean; usageMetadata?: unknown }>) {
	return {
		[Symbol.asyncIterator]: async function* () {
			for (const chunk of chunks) {
				const parts = chunk.text ? [{
					text: chunk.text,
					...(chunk.thought ? { thought: true } : {})
				}] : [];
				yield {
					text: chunk.text,
					candidates: [{
						content: { parts }
					}],
					usageMetadata: chunk.usageMetadata
				};
			}
		}
	};
}

/** Build an evaluated source fixture */
function makeEvaluatedSource(overrides: Partial<EvaluatedSource> = {}): EvaluatedSource {
	return {
		num: 1,
		title: 'Test Article',
		url: 'https://example.com/article',
		type: 'journalism',
		snippet: 'A test article about policy',
		relevance: 'Directly addresses the core issue',
		date: '2026-02-10',
		publisher: 'Test News',
		excerpt: 'Key content from the article about policy impacts.',
		credibility_rationale: 'Established journalism outlet with editorial standards.',
		incentive_position: 'neutral',
		source_order: 'secondary',
		...overrides
	};
}

/** Build a standard discovery response JSON */
function makeDiscoveryResponse(sources: Partial<DiscoveredSource>[] = []) {
	const defaultSources = sources.length > 0 ? sources : [
		{
			num: 1,
			title: 'EPA Report on Water Quality',
			url: 'https://epa.gov/water-report-2026',
			type: 'government',
			snippet: 'Latest water quality data',
			relevance: 'Primary government source',
			date: '2026-01-15',
			publisher: 'EPA'
		},
		{
			num: 2,
			title: 'Local News Coverage',
			url: 'https://news.com/water-crisis',
			type: 'journalism',
			snippet: 'Investigative report',
			relevance: 'Recent media coverage',
			date: '2026-02-01',
			publisher: 'Local News'
		},
		{
			num: 3,
			title: 'Academic Study on Contaminants',
			url: 'https://university.edu/study',
			type: 'research',
			snippet: 'Peer-reviewed findings',
			relevance: 'Scientific evidence',
			date: '2025-11-20',
			publisher: 'University Press'
		}
	];

	return JSON.stringify({
		search_queries: ['water quality EPA 2026', 'water contamination local news'],
		sources: defaultSources
	});
}

/** Build a message response JSON */
function makeMessageResponse(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		message: 'The water we drink tells a story about priorities. [Personal Connection]\n\nAccording to the latest EPA data [1], contamination levels have risen. Local reporting [2] confirms what residents already know.\n\nWe ask you to act now.',
		sources: [
			{ num: 1, title: 'EPA Report', url: 'https://epa.gov/water-report-2026', type: 'government' },
			{ num: 2, title: 'Local News', url: 'https://news.com/water-crisis', type: 'journalism' }
		],
		research_log: ['Searched EPA database', 'Found local coverage'],
		geographic_scope: { type: 'subnational', country: 'US', subdivision: 'MI', locality: 'Flint' },
		...overrides
	});
}

// ============================================================================
// Tests: Source Discovery (Phase 1)
// ============================================================================

describe('Source Discovery — discoverSources', () => {
	const baseOptions: SourceDiscoveryOptions = {
		coreMessage: 'Our water is contaminated',
		subjectLine: 'Urgent: Water Quality Crisis',
		topics: ['water', 'environment', 'public health']
	};

	/** Build a set of Exa search hits for a single stratum */
	function makeExaHits(count: number, prefix = 'https://example.com'): ExaSearchHit[] {
		return Array.from({ length: count }, (_, i) => ({
			url: `${prefix}/article-${i + 1}`,
			title: `Article ${i + 1}`,
			publishedDate: '2026-02-01',
			score: 0.9 - i * 0.1
		}));
	}

	/** Build a Firecrawl page result */
	function makePageContent(url: string, title = 'Test Page') {
		return {
			url,
			title,
			text: `Full article content from ${title}. According to the latest data, contamination levels have risen 15%.`,
			highlights: [],
			publishedDate: '2026-02-01',
			statusCode: 200
		};
	}

	/** Build an evaluator result with evaluated sources */
	function makeEvalResult(count: number, tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }): {
		sources: EvaluatedSource[];
		tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
	} {
		const sources: EvaluatedSource[] = Array.from({ length: count }, (_, i) => ({
			num: i + 1,
			title: `Evaluated Source ${i + 1}`,
			url: `https://example.com/article-${i + 1}`,
			type: 'journalism' as const,
			snippet: 'Investigative report on water quality',
			relevance: 'Directly supports the core message',
			date: '2026-02-01',
			publisher: 'example.com',
			excerpt: 'Contamination levels rose 15% year-over-year.',
			credibility_rationale: 'Independent reporting verified by multiple sources.',
			incentive_position: 'neutral' as const,
			source_order: 'secondary' as const
		}));
		return { sources, tokenUsage };
	}

	/** Set up mocks for a full successful pipeline (3 strata, page fetches, evaluation) */
	function setupSuccessfulPipeline(opts?: {
		govHits?: ExaSearchHit[];
		newsHits?: ExaSearchHit[];
		generalHits?: ExaSearchHit[];
		evalCount?: number;
		evalTokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
	}) {
		const govHits = opts?.govHits ?? makeExaHits(3, 'https://epa.gov');
		const newsHits = opts?.newsHits ?? makeExaHits(3, 'https://news.com');
		const generalHits = opts?.generalHits ?? makeExaHits(3, 'https://research.org');

		// searchWeb returns results for each stratum
		mockSearchWeb
			.mockResolvedValueOnce(govHits)
			.mockResolvedValueOnce(newsHits)
			.mockResolvedValueOnce(generalHits);

		// readPage returns content for each candidate
		mockReadPage.mockImplementation((url: string) =>
			Promise.resolve(makePageContent(url, `Page: ${url}`))
		);

		// evaluateSources returns evaluated sources
		const evalResult = makeEvalResult(
			opts?.evalCount ?? 3,
			opts?.evalTokenUsage
		);
		mockEvaluateSources.mockResolvedValueOnce(evalResult);

		return { govHits, newsHits, generalHits, evalResult };
	}

	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		mockSearchWeb.mockReset();
		mockReadPage.mockReset();
		mockPruneSourceContent.mockReset();
		mockPruneSourceContent.mockImplementation((text: string) => text.slice(0, 3000));
		mockExtractProvenance.mockReset();
		mockExtractProvenance.mockImplementation(() => ({
			publisher: 'test-publisher.com',
			orgDescription: undefined,
			fundingDisclosure: undefined,
			sourceOrder: 'secondary' as const,
			advocacyIndicators: [],
			author: undefined,
			hasMethodology: false
		}));
		mockEvaluateSources.mockReset();
		mockTraceEvent.mockReset();
	});

	it('runs stratified search with 3 Exa queries, deduplication, Firecrawl fetch, and evaluation', async () => {
		setupSuccessfulPipeline();

		const result = await discoverSources(baseOptions);

		// 3 Exa searches (gov, news, general)
		expect(mockSearchWeb).toHaveBeenCalledTimes(3);
		// readPage called for top candidates (up to 6)
		expect(mockReadPage).toHaveBeenCalled();
		// evaluator called once with fetched candidates
		expect(mockEvaluateSources).toHaveBeenCalledTimes(1);
		// Result contains evaluated sources
		expect(result.evaluated.length).toBeGreaterThan(0);
		expect(result.searchQueries).toHaveLength(3);
		expect(result.externalCounts.exaSearches).toBe(3);
	});

	it('continues with remaining results when one Exa stratum fails (Promise.allSettled)', async () => {
		// Gov search fails, news and general succeed
		mockSearchWeb
			.mockRejectedValueOnce(new Error('Exa gov search timeout'))
			.mockResolvedValueOnce(makeExaHits(3, 'https://news.com'))
			.mockResolvedValueOnce(makeExaHits(3, 'https://research.org'));

		mockReadPage.mockImplementation((url: string) =>
			Promise.resolve(makePageContent(url))
		);
		mockEvaluateSources.mockResolvedValueOnce(makeEvalResult(2));

		const result = await discoverSources(baseOptions);

		// Should still produce results from the other 2 strata
		expect(result.evaluated.length).toBeGreaterThan(0);
		expect(result.externalCounts.exaSearches).toBe(2); // Only 2 succeeded
	});

	it('returns empty result gracefully when all strata return empty', async () => {
		mockSearchWeb
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await discoverSources(baseOptions);

		expect(result.discovered).toHaveLength(0);
		expect(result.evaluated).toHaveLength(0);
		expect(result.failed).toHaveLength(0);
		expect(result.searchQueries).toHaveLength(3);
		// readPage and evaluator should not be called
		expect(mockReadPage).not.toHaveBeenCalled();
		expect(mockEvaluateSources).not.toHaveBeenCalled();
	});

	it('evaluator still gets remaining candidates when Firecrawl has partial failures', async () => {
		const hits = makeExaHits(4, 'https://example.com');
		mockSearchWeb
			.mockResolvedValueOnce(hits)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		// First 2 pages succeed, next 2 fail
		mockReadPage
			.mockResolvedValueOnce(makePageContent(hits[0].url))
			.mockResolvedValueOnce(makePageContent(hits[1].url))
			.mockResolvedValueOnce(null) // Firecrawl returns null on failure
			.mockResolvedValueOnce(null);

		mockEvaluateSources.mockResolvedValueOnce(makeEvalResult(2));

		const result = await discoverSources(baseOptions);

		// Evaluator should be called with the 2 successful fetches
		expect(mockEvaluateSources).toHaveBeenCalledTimes(1);
		const candidatesPassedToEvaluator = mockEvaluateSources.mock.calls[0][0];
		expect(candidatesPassedToEvaluator).toHaveLength(2);

		// Failed fetches tracked
		expect(result.failed).toHaveLength(2);
	});

	it('falls back to basic candidates when evaluator returns empty', async () => {
		const hits = makeExaHits(3, 'https://example.com');
		mockSearchWeb
			.mockResolvedValueOnce(hits)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		mockReadPage.mockImplementation((url: string) =>
			Promise.resolve(makePageContent(url))
		);

		// Evaluator throws — triggers fallback path
		mockEvaluateSources.mockRejectedValueOnce(new Error('Evaluator unavailable'));

		const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await discoverSources(baseOptions);

		// Should fall back to basic candidates derived from fetched pages
		expect(result.evaluated.length).toBeGreaterThan(0);
		expect(result.evaluated[0].credibility_rationale).toContain('Evaluation unavailable');

		warnSpy.mockRestore();
	});

	it('includes geographic scope in search queries', async () => {
		mockSearchWeb
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		await discoverSources({
			...baseOptions,
			geographicScope: {
				type: 'subnational',
				country: 'US',
				subdivision: 'MI',
				locality: 'Flint'
			}
		});

		// Gov query should include the locality
		const govQuery = mockSearchWeb.mock.calls[0][0];
		expect(govQuery).toContain('Flint');

		// News query should include the locality
		const newsQuery = mockSearchWeb.mock.calls[1][0];
		expect(newsQuery).toContain('Flint');
	});

	it('passes decision makers to evaluator context', async () => {
		setupSuccessfulPipeline();

		await discoverSources({
			...baseOptions,
			decisionMakers: [
				{ name: 'Mayor Jane Smith', title: 'Mayor', organization: 'City of Flint' }
			]
		});

		const evalContext = mockEvaluateSources.mock.calls[0][1];
		expect(evalContext.decisionMakers).toBeDefined();
		expect(evalContext.decisionMakers[0].name).toBe('Mayor Jane Smith');
		expect(evalContext.decisionMakers[0].title).toBe('Mayor');
		expect(evalContext.decisionMakers[0].organization).toBe('City of Flint');
	});

	it('fires trace events for source-search and source-evaluation when traceId provided', async () => {
		setupSuccessfulPipeline();

		await discoverSources({
			...baseOptions,
			traceId: 'test-trace-123'
		});

		// Should fire at least 2 trace events: source-search and source-evaluation
		expect(mockTraceEvent).toHaveBeenCalledWith(
			'test-trace-123',
			'message-generation',
			'source-search',
			expect.objectContaining({ exaSearches: 3 })
		);
		expect(mockTraceEvent).toHaveBeenCalledWith(
			'test-trace-123',
			'message-generation',
			'source-evaluation',
			expect.objectContaining({ candidatesIn: expect.any(Number) })
		);
	});

	it('does not fire trace events when no traceId provided', async () => {
		setupSuccessfulPipeline();

		await discoverSources(baseOptions);

		expect(mockTraceEvent).not.toHaveBeenCalled();
	});

	it('accumulates token usage from evaluator', async () => {
		setupSuccessfulPipeline({
			evalTokenUsage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 }
		});

		const result = await discoverSources(baseOptions);

		expect(result.tokenUsage).toBeDefined();
		expect(result.tokenUsage?.totalTokens).toBe(700);
	});

	it('calls onThought callback during pipeline phases', async () => {
		setupSuccessfulPipeline();

		const thoughts: string[] = [];
		await discoverSources({
			...baseOptions,
			onThought: (thought) => thoughts.push(thought)
		});

		expect(thoughts.length).toBeGreaterThan(0);
		// Should mention searching and fetching
		expect(thoughts.some(t => t.includes('Searching'))).toBe(true);
	});

	it('calls onPhase callbacks at each pipeline phase', async () => {
		setupSuccessfulPipeline();

		const phases: string[] = [];
		await discoverSources({
			...baseOptions,
			onPhase: (phase) => phases.push(phase)
		});

		expect(phases).toContain('discover');
		expect(phases).toContain('validate');
		expect(phases).toContain('complete');
	});

	it('deduplicates search results by normalized URL across strata', async () => {
		// Same URL appears in gov and news strata
		const govHits: ExaSearchHit[] = [
			{ url: 'https://epa.gov/report', title: 'EPA Report', score: 0.9 }
		];
		const newsHits: ExaSearchHit[] = [
			{ url: 'https://epa.gov/report/', title: 'EPA Report (dupe)', score: 0.8 }, // trailing slash = same
			{ url: 'https://news.com/unique', title: 'Unique News', score: 0.85 }
		];

		mockSearchWeb
			.mockResolvedValueOnce(govHits)
			.mockResolvedValueOnce(newsHits)
			.mockResolvedValueOnce([]);

		mockReadPage.mockImplementation((url: string) =>
			Promise.resolve(makePageContent(url))
		);
		mockEvaluateSources.mockResolvedValueOnce(makeEvalResult(2));

		const result = await discoverSources(baseOptions);

		// Only 2 unique URLs should be fetched (not 3)
		expect(mockReadPage).toHaveBeenCalledTimes(2);
	});

	it('renumbers evaluated sources sequentially', async () => {
		setupSuccessfulPipeline({ evalCount: 4 });

		const result = await discoverSources(baseOptions);

		for (let i = 0; i < result.evaluated.length; i++) {
			expect(result.evaluated[i].num).toBe(i + 1);
		}
	});

	it('returns latencyMs and externalCounts in result', async () => {
		setupSuccessfulPipeline();

		const result = await discoverSources(baseOptions);

		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
		expect(result.externalCounts).toBeDefined();
		expect(result.externalCounts.exaSearches).toBe(3);
		expect(result.externalCounts.firecrawlReads).toBeGreaterThanOrEqual(0);
		expect(result.externalCounts.groundingSearches).toBe(0);
		expect(result.groundingSearches).toBe(0); // Legacy field
	});

	it('evaluated array is populated by new pipeline', async () => {
		setupSuccessfulPipeline();

		const result = await discoverSources(baseOptions);

		expect(result.evaluated.length).toBeGreaterThan(0);
	});
});

// ============================================================================
// Tests: formatSourcesForPrompt
// ============================================================================

describe('formatSourcesForPrompt', () => {
	it('formats sources with citation numbers and URLs', () => {
		const sources: EvaluatedSource[] = [
			makeEvaluatedSource({ num: 1, title: 'EPA Report', url: 'https://epa.gov/report' }),
			makeEvaluatedSource({ num: 2, title: 'News Article', url: 'https://news.com/story' })
		];

		const formatted = formatSourcesForPrompt(sources);
		expect(formatted).toContain('[1] EPA Report');
		expect(formatted).toContain('URL: https://epa.gov/report');
		expect(formatted).toContain('[2] News Article');
		expect(formatted).toContain('URL: https://news.com/story');
	});

	it('returns no-citations message when sources array is empty', () => {
		const formatted = formatSourcesForPrompt([]);
		expect(formatted).toContain('No verified sources available');
		expect(formatted).toContain('without citations');
	});

	it('includes citation principles footer', () => {
		const sources: EvaluatedSource[] = [
			makeEvaluatedSource()
		];

		const formatted = formatSourcesForPrompt(sources);
		expect(formatted).toContain('CITATION PRINCIPLES');
		expect(formatted).toContain('Do not fabricate or modify URLs');
	});

	it('sorts sources by freshness (most recent first)', () => {
		const sources: EvaluatedSource[] = [
			makeEvaluatedSource({ num: 1, title: 'Old Article', date: '2025-01-01' }),
			makeEvaluatedSource({ num: 2, title: 'Fresh Article', date: '2026-02-20' }),
			makeEvaluatedSource({ num: 3, title: 'Medium Article', date: '2025-08-15' })
		];

		const formatted = formatSourcesForPrompt(sources);
		const oldIdx = formatted.indexOf('Old Article');
		const freshIdx = formatted.indexOf('Fresh Article');
		const mediumIdx = formatted.indexOf('Medium Article');

		// Fresh should appear before medium, medium before old
		expect(freshIdx).toBeLessThan(mediumIdx);
		expect(mediumIdx).toBeLessThan(oldIdx);
	});

	it('places unknown-date sources last', () => {
		const sources: EvaluatedSource[] = [
			makeEvaluatedSource({ num: 1, title: 'No Date', date: undefined }),
			makeEvaluatedSource({ num: 2, title: 'Has Date', date: '2026-02-01' })
		];

		const formatted = formatSourcesForPrompt(sources);
		const noDateIdx = formatted.indexOf('No Date');
		const hasDateIdx = formatted.indexOf('Has Date');
		expect(hasDateIdx).toBeLessThan(noDateIdx);
	});

	it('includes freshness summary when dates are available', () => {
		const sources: EvaluatedSource[] = [
			makeEvaluatedSource({ num: 1, date: '2026-02-20' })
		];

		const formatted = formatSourcesForPrompt(sources);
		expect(formatted).toContain('Freshest source:');
		expect(formatted).toContain('days old');
	});

	it('includes type, publisher, and credibility fields', () => {
		const source = makeEvaluatedSource({
			type: 'government',
			publisher: 'EPA',
			credibility_rationale: 'Official government data source'
		});

		const formatted = formatSourcesForPrompt([source]);
		expect(formatted).toContain('Type: government');
		expect(formatted).toContain('Publisher: EPA');
		expect(formatted).toContain('Credibility: Official government data source');
	});

	it('shows "Unknown" for missing publisher', () => {
		const source = makeEvaluatedSource({ publisher: undefined });
		const formatted = formatSourcesForPrompt([source]);
		expect(formatted).toContain('Publisher: Unknown');
	});

	it('annotates dates with days-ago calculation', () => {
		// Use a fixed recent date to test annotation
		const recentDate = new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0];
		const source = makeEvaluatedSource({ date: recentDate });

		const formatted = formatSourcesForPrompt([source]);
		expect(formatted).toMatch(/\d+ days ago/);
	});
});

// ============================================================================
// Tests: Message Writer (Phase 2)
// ============================================================================

describe('Message Writer — generateMessage', () => {
	const baseOptions: GenerateMessageOptions = {
		subjectLine: 'Urgent: Water Quality Crisis',
		coreMessage: 'Our water is contaminated and we demand action',
		topics: ['water', 'environment', 'public health'],
		decisionMakers: [
			{
				name: 'Mayor Jane Smith',
				title: 'Mayor',
				organization: 'City of Flint',
				email: 'mayor@flint.gov',
				reasoning: 'Controls municipal budget',
				sourceUrl: 'https://flint.gov/mayor',
				emailSource: 'https://flint.gov/contact',
				emailGrounded: true,
				confidence: 0.9,
				contactChannel: 'email'
			}
		]
	};

	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		mockGenerateContentStream.mockReset();
		mockSearchWeb.mockReset();
		mockReadPage.mockReset();
		mockEvaluateSources.mockReset();
		mockPruneSourceContent.mockReset();
		mockPruneSourceContent.mockImplementation((text: string) => text.slice(0, 3000));
		mockExtractProvenance.mockReset();
		mockExtractProvenance.mockImplementation(() => ({
			publisher: 'test-publisher.com',
			orgDescription: undefined,
			fundingDisclosure: undefined,
			sourceOrder: 'secondary' as const,
			advocacyIndicators: [],
			author: undefined,
			hasMethodology: false
		}));
		mockTraceEvent.mockReset();
	});

	describe('with pre-verified sources (Phase 1 skipped)', () => {
		it('generates message using pre-verified sources', async () => {
			const verifiedSources = [
				makeEvaluatedSource({ num: 1, title: 'EPA Report', url: 'https://epa.gov/report' }),
				makeEvaluatedSource({ num: 2, title: 'Local News', url: 'https://news.com/story' })
			];

			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			const result = await generateMessage({
				...baseOptions,
				verifiedSources
			});

			expect(result.message).toBeDefined();
			expect(result.message.length).toBeGreaterThan(0);
		});

		it('skips Phase 1 entirely when verifiedSources is provided', async () => {
			const verifiedSources = [makeEvaluatedSource()];

			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			await generateMessage({
				...baseOptions,
				verifiedSources
			});

			// Should only have 1 stream call (Phase 2), not 2 (Phase 1 + Phase 2)
			expect(mockGenerateContentStream).toHaveBeenCalledTimes(1);
		});

		it('replaces generated sources with verified source pool', async () => {
			const verifiedSources = [
				makeEvaluatedSource({ num: 1, title: 'VERIFIED Source', url: 'https://verified.gov/page' })
			];

			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			const result = await generateMessage({
				...baseOptions,
				verifiedSources
			});

			// Sources in output should be the verified ones, not what the model generated
			expect(result.sources[0].url).toBe('https://verified.gov/page');
			expect(result.sources[0].title).toBe('VERIFIED Source');
		});

		it('normalizes [Personal Connection] case variations', async () => {
			const messageJson = JSON.stringify({
				message: 'This matters to us. [personal connection] is why we care.',
				sources: [],
				geographic_scope: { type: 'subnational', country: 'US', locality: 'Flint' }
			});

			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: messageJson }])
			);

			const result = await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()]
			});

			expect(result.message).toContain('[Personal Connection]');
			expect(result.message).not.toContain('[personal connection]');
		});

		it('appends [Name] signature to message', async () => {
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			const result = await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()]
			});

			expect(result.message).toMatch(/\[Name\]$/);
		});

		it('disables grounding in Phase 2 (prevents URL hallucination)', async () => {
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()]
			});

			const callConfig = mockGenerateContentStream.mock.calls[0][0].config;
			// grounding should NOT be enabled in Phase 2
			expect(callConfig.tools).toBeUndefined();
		});

		it('uses temperature 0.8 for message generation (creative latitude)', async () => {
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()]
			});

			const callConfig = mockGenerateContentStream.mock.calls[0][0].config;
			expect(callConfig.temperature).toBe(0.8);
		});
	});

	describe('full pipeline (Phase 1 + Phase 2)', () => {
		/** Set up Phase 1 mocks (Exa search + Firecrawl + evaluator) */
		function setupPhase1(evalTokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }) {
			// 3 Exa strata
			mockSearchWeb
				.mockResolvedValueOnce([
					{ url: 'https://epa.gov/water-report-2026', title: 'EPA Report on Water Quality', score: 0.95, publishedDate: '2026-01-15' }
				])
				.mockResolvedValueOnce([
					{ url: 'https://news.com/water-crisis', title: 'Local News Coverage', score: 0.9, publishedDate: '2026-02-01' }
				])
				.mockResolvedValueOnce([
					{ url: 'https://university.edu/study', title: 'Academic Study on Contaminants', score: 0.85, publishedDate: '2025-11-20' }
				]);

			// Firecrawl page fetches
			mockReadPage.mockImplementation((url: string) => Promise.resolve({
				url,
				title: `Page: ${url}`,
				text: `Content from ${url}. According to the data, contamination rose 15%.`,
				highlights: [],
				statusCode: 200
			}));

			// Evaluator returns evaluated sources
			const evalSources: EvaluatedSource[] = [
				{
					num: 1, title: 'EPA Report on Water Quality', url: 'https://epa.gov/water-report-2026',
					type: 'government', snippet: 'Latest water quality data', relevance: 'Primary government source',
					date: '2026-01-15', publisher: 'epa.gov', excerpt: 'Contamination levels rose 15%.',
					credibility_rationale: 'Official government data', incentive_position: 'adversarial', source_order: 'primary'
				},
				{
					num: 2, title: 'Local News Coverage', url: 'https://news.com/water-crisis',
					type: 'journalism', snippet: 'Investigative report', relevance: 'Recent media coverage',
					date: '2026-02-01', publisher: 'news.com', excerpt: 'Residents report metallic taste.',
					credibility_rationale: 'Independent local journalism', incentive_position: 'neutral', source_order: 'secondary'
				},
				{
					num: 3, title: 'Academic Study on Contaminants', url: 'https://university.edu/study',
					type: 'research', snippet: 'Peer-reviewed findings', relevance: 'Scientific evidence',
					date: '2025-11-20', publisher: 'university.edu', excerpt: 'Study confirms elevated lead levels.',
					credibility_rationale: 'Peer-reviewed research', incentive_position: 'neutral', source_order: 'primary'
				}
			];
			mockEvaluateSources.mockResolvedValueOnce({ sources: evalSources, tokenUsage: evalTokenUsage });
		}

		it('runs source discovery then message generation', async () => {
			// Phase 1: Exa + Firecrawl + evaluator
			setupPhase1();

			// Phase 2: Gemini message generation
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			const result = await generateMessage(baseOptions);

			// Phase 1 uses Exa/Firecrawl/evaluator (not Gemini stream), Phase 2 uses Gemini stream
			expect(mockGenerateContentStream).toHaveBeenCalledTimes(1);
			expect(mockSearchWeb).toHaveBeenCalledTimes(3);
			expect(result.message).toBeDefined();
			expect(result.sources.length).toBeGreaterThan(0);
		});

		it('uses actual search queries as research_log (not model-fabricated ones)', async () => {
			// Phase 1
			setupPhase1();

			// Phase 2
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			const result = await generateMessage(baseOptions);

			// research_log should contain the REAL search queries built from input
			// (deterministically constructed from subject/message/topics/geo)
			expect(result.research_log).toHaveLength(3);
			expect(result.research_log[0]).toContain('water');
		});

		it('accumulates token usage across both phases', async () => {
			// Phase 1 with evaluator token usage
			setupPhase1({ promptTokens: 500, completionTokens: 200, totalTokens: 700 });

			// Phase 2 with Gemini token usage
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{
					text: makeMessageResponse(),
					usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, totalTokenCount: 1500 }
				}])
			);

			const result = await generateMessage(baseOptions);
			expect(result.tokenUsage).toBeDefined();
			expect(result.tokenUsage!.totalTokens).toBe(2200);
		});
	});

	describe('error handling', () => {
		it('throws user-friendly error on Phase 2 JSON extraction failure', async () => {
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: 'not valid JSON !!@@##' }])
			);

			await expect(generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()]
			})).rejects.toThrow(/hit a snag/);
		});

		it('throws user-friendly error on Zod validation failure', async () => {
			// Valid JSON but wrong structure
			const invalidStructure = JSON.stringify({
				not_message: 'wrong field',
				not_sources: []
			});

			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: invalidStructure }])
			);

			await expect(generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()]
			})).rejects.toThrow(/hit a snag/);
		});
	});

	describe('geographic scope coercion', () => {
		it('parses standard GeoScope object', async () => {
			const msgJson = JSON.stringify({
				message: 'Test message with [Personal Connection].',
				sources: [],
				geographic_scope: { type: 'nationwide', country: 'US' }
			});

			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: msgJson }])
			);

			const result = await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()]
			});

			expect(result.geographic_scope).toEqual({ type: 'nationwide', country: 'US' });
		});

		it('coerces plain string geographic_scope into subnational', async () => {
			const msgJson = JSON.stringify({
				message: 'Test message with [Personal Connection].',
				sources: [],
				geographic_scope: 'San Francisco, CA'
			});

			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: msgJson }])
			);

			const result = await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()]
			});

			expect(result.geographic_scope?.type).toBe('subnational');
		});

		it('coerces old { scope_level, scope_display } format', async () => {
			const msgJson = JSON.stringify({
				message: 'Test message with [Personal Connection].',
				sources: [],
				geographic_scope: { scope_level: 'national', scope_display: 'United States' }
			});

			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: msgJson }])
			);

			const result = await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()]
			});

			expect(result.geographic_scope?.type).toBe('nationwide');
		});
	});

	describe('prompt construction', () => {
		it('includes decision-maker names and titles in prompt', async () => {
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()]
			});

			const callContents = mockGenerateContentStream.mock.calls[0][0].contents;
			expect(callContents).toContain('Mayor Jane Smith');
			expect(callContents).toContain('Mayor');
			expect(callContents).toContain('City of Flint');
		});

		it('includes voice sample in prompt when provided', async () => {
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()],
				voiceSample: 'I am furious about the contamination in our water'
			});

			const callContents = mockGenerateContentStream.mock.calls[0][0].contents;
			expect(callContents).toContain('I am furious about the contamination');
		});

		it('includes raw input in prompt when provided', async () => {
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()],
				rawInput: 'The water tastes metallic and my kids are getting sick'
			});

			const callContents = mockGenerateContentStream.mock.calls[0][0].contents;
			expect(callContents).toContain('The water tastes metallic');
		});

		it('includes current date in system prompt', async () => {
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()]
			});

			const callConfig = mockGenerateContentStream.mock.calls[0][0].config;
			const currentYear = new Date().getFullYear();
			expect(callConfig.systemInstruction).toContain(String(currentYear));
		});

		it('includes verified sources block in prompt', async () => {
			const verifiedSources = [
				makeEvaluatedSource({ num: 1, title: 'Test EPA Report', url: 'https://epa.gov/test' })
			];

			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			await generateMessage({
				...baseOptions,
				verifiedSources
			});

			const callContents = mockGenerateContentStream.mock.calls[0][0].contents;
			expect(callContents).toContain('Test EPA Report');
			expect(callContents).toContain('https://epa.gov/test');
		});
	});

	describe('callbacks', () => {
		it('calls onPhase with phase transitions', async () => {
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			const phases: string[] = [];
			await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()],
				onPhase: (phase) => phases.push(phase)
			});

			expect(phases).toContain('message');
			expect(phases).toContain('complete');
		});

		it('calls onThought during message generation phase', async () => {
			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([
					{ text: 'thinking about emotional arc...', thought: true },
					{ text: makeMessageResponse() }
				])
			);

			const thoughts: Array<{ thought: string; phase?: string }> = [];
			await generateMessage({
				...baseOptions,
				verifiedSources: [makeEvaluatedSource()],
				onThought: (thought, phase) => thoughts.push({ thought, phase })
			});

			expect(thoughts.length).toBeGreaterThan(0);
			expect(thoughts[0].phase).toBe('message');
		});

		it('calls onPhase with source count in complete message', async () => {
			const verifiedSources = [
				makeEvaluatedSource({ num: 1 }),
				makeEvaluatedSource({ num: 2 })
			];

			mockGenerateContentStream.mockResolvedValueOnce(
				makeStream([{ text: makeMessageResponse() }])
			);

			let completeMessage = '';
			await generateMessage({
				...baseOptions,
				verifiedSources,
				onPhase: (phase, message) => {
					if (phase === 'complete') completeMessage = message;
				}
			});

			expect(completeMessage).toContain('2 verified sources');
		});
	});
});

// ============================================================================
// Tests: daysSince (tested indirectly via formatSourcesForPrompt)
// ============================================================================

describe('Source freshness ranking', () => {
	it('handles Unknown date gracefully', () => {
		const source = makeEvaluatedSource({ date: 'Unknown' });
		const formatted = formatSourcesForPrompt([source]);
		expect(formatted).toContain('Date: Unknown');
	});

	it('handles unparseable date strings', () => {
		const source = makeEvaluatedSource({ date: 'not a date' });
		const formatted = formatSourcesForPrompt([source]);
		// Should not crash
		expect(formatted).toContain('Date: not a date');
	});

	it('handles partial dates like "January 2026"', () => {
		const source = makeEvaluatedSource({ date: 'January 2026' });
		const formatted = formatSourcesForPrompt([source]);
		expect(formatted).toContain('January 2026');
		// Should parse and annotate with days ago
		expect(formatted).toMatch(/days ago/);
	});

	it('handles ISO date format', () => {
		const source = makeEvaluatedSource({ date: '2026-02-15' });
		const formatted = formatSourcesForPrompt([source]);
		expect(formatted).toContain('2026-02-15');
		expect(formatted).toMatch(/days ago/);
	});

	it('correctly orders multiple sources by freshness', () => {
		const sources: EvaluatedSource[] = [
			makeEvaluatedSource({ num: 1, title: 'A_OLDEST', date: '2024-01-01' }),
			makeEvaluatedSource({ num: 2, title: 'B_NEWEST', date: '2026-02-22' }),
			makeEvaluatedSource({ num: 3, title: 'C_MIDDLE', date: '2025-06-15' }),
			makeEvaluatedSource({ num: 4, title: 'D_NO_DATE', date: undefined })
		];

		const formatted = formatSourcesForPrompt(sources);
		const positions = {
			newest: formatted.indexOf('B_NEWEST'),
			middle: formatted.indexOf('C_MIDDLE'),
			oldest: formatted.indexOf('A_OLDEST'),
			noDate: formatted.indexOf('D_NO_DATE')
		};

		expect(positions.newest).toBeLessThan(positions.middle);
		expect(positions.middle).toBeLessThan(positions.oldest);
		expect(positions.oldest).toBeLessThan(positions.noDate);
	});
});
