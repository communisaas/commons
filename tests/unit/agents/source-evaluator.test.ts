/**
 * Unit Tests — Source Evaluator (Gemini Incentive-Aware Ranking)
 *
 * Tests the evaluateSources() function which:
 *   - Receives SourceCandidate[] with content excerpts and provenance signals
 *   - Calls Gemini with structured JSON output (responseSchema, no grounding)
 *   - Returns EvaluatedSource[] with credibility rationale and incentive analysis
 *
 * All Gemini SDK calls are mocked via $lib/core/agents/gemini-client.
 *
 * Run: npm test -- --run tests/unit/agents/source-evaluator.test.ts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockGenerate = vi.hoisted(() => vi.fn());
const mockExtractTokenUsage = vi.hoisted(() => vi.fn());

vi.mock('$lib/core/agents/gemini-client', () => ({
	generate: mockGenerate,
	extractTokenUsage: mockExtractTokenUsage
}));

// ============================================================================
// Import SUT
// ============================================================================

import { evaluateSources } from '$lib/core/agents/agents/source-evaluator';
import type { SourceCandidate, EvaluatedSource } from '$lib/core/agents/types';

// ============================================================================
// Helpers
// ============================================================================

/** Build a SourceCandidate fixture */
function makeCandidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
	return {
		url: 'https://example.gov/report',
		title: 'Example Government Report',
		publishedDate: '2026-02-15',
		exaScore: 0.92,
		stratum: 'gov',
		excerpt: 'According to the latest data, 47% of surveyed residents reported contamination in their water supply. The methodology used a sample size of 2,400 households.',
		provenance: {
			publisher: 'Example Government Agency',
			orgDescription: 'Federal agency responsible for environmental protection',
			fundingDisclosure: undefined,
			sourceOrder: 'primary',
			advocacyIndicators: [],
			author: 'Bureau of Environmental Analysis',
			hasMethodology: true
		},
		...overrides
	};
}

/** Build a standard evaluation response with the specified number of sources */
function makeEvaluationResponse(
	candidateCount: number,
	sourceCount?: number
): { sources: Array<Record<string, unknown>> } {
	const count = sourceCount ?? Math.min(candidateCount, 4);
	const sources: Array<Record<string, unknown>> = [];

	for (let i = 0; i < count; i++) {
		sources.push({
			candidate_index: i,
			title: `Source ${i + 1}`,
			url: `https://source-${i + 1}.example.com`,
			type: i === 0 ? 'government' : i === 1 ? 'journalism' : 'research',
			snippet: `Summary of source ${i + 1}`,
			relevance: `Supports the citizen's argument through data point ${i + 1}`,
			date: '2026-02-15',
			publisher: `Publisher ${i + 1}`,
			excerpt: `Key finding: metric ${i + 1} shows 47% increase in the target area`,
			credibility_rationale: `This source is credible because it represents ${i === 0 ? 'official government data' : 'independent reporting'} on the topic.`,
			incentive_position: i === 0 ? 'adversarial' : i === 1 ? 'neutral' : 'aligned',
			source_order: i === 0 ? 'primary' : 'secondary'
		});
	}

	return { sources };
}

/** Create a mock Gemini response object */
function makeMockResponse(text: string | null) {
	return {
		text: text,
		candidates: [{ content: { parts: [{ text }] } }],
		usageMetadata: {
			promptTokenCount: 1200,
			candidatesTokenCount: 800,
			totalTokenCount: 2000
		}
	};
}

/** Standard evaluation context */
const baseContext = {
	subjectLine: 'Urgent: Water Quality Crisis',
	coreMessage: 'Our water is contaminated and we demand action',
	topics: ['water', 'environment', 'public health'],
	geographicScope: {
		type: 'subnational',
		country: 'US',
		subdivision: 'MI',
		locality: 'Flint'
	},
	decisionMakers: [
		{ name: 'Mayor Jane Smith', title: 'Mayor', organization: 'City of Flint' }
	]
};

// ============================================================================
// Tests
// ============================================================================

describe('Source Evaluator — evaluateSources', () => {
	beforeEach(() => {
		mockGenerate.mockReset();
		mockExtractTokenUsage.mockReset();
		mockExtractTokenUsage.mockReturnValue({
			promptTokens: 1200,
			candidatesTokens: 800,
			totalTokens: 2000
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ====================================================================
	// Test 1: 6 candidates -> evaluator returns 3-6 sources
	// ====================================================================

	it('evaluates 6 candidates and returns 3-6 sources with incentive_position and credibility_rationale', async () => {
		const candidates = Array.from({ length: 6 }, (_, i) =>
			makeCandidate({
				url: `https://source-${i}.example.com`,
				title: `Candidate Source ${i}`,
				stratum: i < 2 ? 'gov' : i < 4 ? 'news' : 'general'
			})
		);

		const evalResponse = makeEvaluationResponse(6, 4);
		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(JSON.stringify(evalResponse))
		);

		const result = await evaluateSources(candidates, baseContext);

		expect(result.sources.length).toBeGreaterThanOrEqual(3);
		expect(result.sources.length).toBeLessThanOrEqual(6);

		// Every source should have incentive_position and credibility_rationale
		for (const source of result.sources) {
			expect(source.incentive_position).toBeDefined();
			expect(['adversarial', 'neutral', 'aligned']).toContain(source.incentive_position);
			expect(source.credibility_rationale).toBeDefined();
			expect(source.credibility_rationale.length).toBeGreaterThan(0);
		}
	});

	// ====================================================================
	// Test 2: 0 candidates -> returns empty array gracefully
	// ====================================================================

	it('returns empty array gracefully when 0 candidates provided', async () => {
		const result = await evaluateSources([], baseContext);

		expect(result.sources).toEqual([]);
		expect(result.tokenUsage).toBeUndefined();
		// Should NOT call generate() at all
		expect(mockGenerate).not.toHaveBeenCalled();
	});

	// ====================================================================
	// Test 3: Adversarial source correctly mapped via candidate_index
	// ====================================================================

	it('correctly resolves candidate_index to map adversarial sources', async () => {
		const candidates = [
			makeCandidate({
				url: 'https://industry-trade.org/report',
				title: 'Trade Association Economic Impact Study',
				stratum: 'general',
				provenance: {
					publisher: 'National Manufacturing Association',
					orgDescription: 'Industry trade association',
					fundingDisclosure: 'Funded by member companies',
					sourceOrder: 'primary',
					advocacyIndicators: ['dedicated to promoting manufacturing interests'],
					hasMethodology: true
				}
			}),
			makeCandidate({
				url: 'https://epa.gov/water-quality',
				title: 'EPA Water Quality Report',
				stratum: 'gov'
			}),
			makeCandidate({
				url: 'https://localnews.com/investigation',
				title: 'Local News Investigation',
				stratum: 'news',
				provenance: {
					publisher: 'Local News Daily',
					sourceOrder: 'secondary',
					advocacyIndicators: [],
					hasMethodology: false
				}
			})
		];

		// Gemini selects candidate_index 0 (trade association) as adversarial
		const evalResponse = {
			sources: [
				{
					candidate_index: 1,
					title: 'EPA Water Quality Report',
					url: 'https://epa.gov/water-quality',
					type: 'government',
					snippet: 'Official water quality data',
					relevance: 'Primary government data source',
					date: '2026-02-15',
					publisher: 'EPA',
					excerpt: 'EPA found 47% contamination rate',
					credibility_rationale: 'Government primary data source with reproducible methodology.',
					incentive_position: 'neutral',
					source_order: 'primary'
				},
				{
					candidate_index: 0,
					title: 'Trade Association Economic Impact Study',
					url: 'https://industry-trade.org/report',
					type: 'research',
					snippet: 'Industry data inadvertently confirms contamination',
					relevance: 'Adversarial citation — industry data supports citizen claim',
					date: '2026-01-10',
					publisher: 'National Manufacturing Association',
					excerpt: 'Even the trade association data shows 32% rise in contaminants near facilities',
					credibility_rationale: 'Industry-funded study whose own data contradicts the industry position on safety.',
					incentive_position: 'adversarial',
					source_order: 'primary'
				},
				{
					candidate_index: 2,
					title: 'Local News Investigation',
					url: 'https://localnews.com/investigation',
					type: 'journalism',
					snippet: 'Investigative report on water crisis',
					relevance: 'Recent local coverage establishes urgency',
					date: '2026-02-20',
					publisher: 'Local News Daily',
					excerpt: 'Three-month investigation reveals ongoing contamination',
					credibility_rationale: 'Local journalism with direct community access.',
					incentive_position: 'neutral',
					source_order: 'secondary'
				}
			]
		};

		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(JSON.stringify(evalResponse))
		);

		const result = await evaluateSources(candidates, baseContext);

		expect(result.sources).toHaveLength(3);

		// The adversarial source (candidate_index 0) should be resolved correctly
		const adversarial = result.sources.find(s => s.incentive_position === 'adversarial');
		expect(adversarial).toBeDefined();
		expect(adversarial!.url).toBe('https://industry-trade.org/report');
		expect(adversarial!.credibility_rationale).toContain('industry');

		// The government source (candidate_index 1) should be neutral
		const gov = result.sources.find(s => s.url === 'https://epa.gov/water-quality');
		expect(gov).toBeDefined();
		expect(gov!.incentive_position).toBe('neutral');
		expect(gov!.source_order).toBe('primary');
	});

	// ====================================================================
	// Test 4: Schema output parsing into EvaluatedSource[]
	// ====================================================================

	it('correctly parses Gemini JSON response into EvaluatedSource[]', async () => {
		const candidates = [
			makeCandidate({ url: 'https://source-a.com', title: 'Source A' }),
			makeCandidate({ url: 'https://source-b.com', title: 'Source B' })
		];

		const evalResponse = {
			sources: [
				{
					candidate_index: 0,
					title: 'Source A',
					url: 'https://source-a.com',
					type: 'government',
					snippet: 'Key government data',
					relevance: 'Official data directly relevant',
					date: '2026-01-20',
					publisher: 'Govt Agency',
					excerpt: 'Data shows 47% increase in affected area',
					credibility_rationale: 'Primary government data from the responsible agency.',
					incentive_position: 'neutral',
					source_order: 'primary'
				},
				{
					candidate_index: 1,
					title: 'Source B',
					url: 'https://source-b.com',
					type: 'journalism',
					snippet: 'Investigative journalism',
					relevance: 'Recent coverage of the issue',
					date: '2026-02-10',
					publisher: 'News Outlet',
					excerpt: 'Investigation reveals significant policy gaps',
					credibility_rationale: 'Independent journalism with investigative methodology.',
					incentive_position: 'aligned',
					source_order: 'secondary'
				}
			]
		};

		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(JSON.stringify(evalResponse))
		);

		const result = await evaluateSources(candidates, baseContext);

		expect(result.sources).toHaveLength(2);

		// Verify EvaluatedSource structure
		const first = result.sources[0];
		expect(first.num).toBe(1);
		expect(first.title).toBe('Source A');
		expect(first.url).toBe('https://source-a.com');
		expect(first.type).toBe('government');
		expect(first.snippet).toBe('Key government data');
		expect(first.relevance).toBe('Official data directly relevant');
		expect(first.date).toBe('2026-01-20');
		expect(first.publisher).toBe('Govt Agency');
		expect(first.excerpt).toBe('Data shows 47% increase in affected area');
		expect(first.credibility_rationale).toBe('Primary government data from the responsible agency.');
		expect(first.incentive_position).toBe('neutral');
		expect(first.source_order).toBe('primary');

		const second = result.sources[1];
		expect(second.num).toBe(2);
		expect(second.type).toBe('journalism');
		expect(second.incentive_position).toBe('aligned');
		expect(second.source_order).toBe('secondary');

		// Token usage should be extracted
		expect(result.tokenUsage).toBeDefined();
	});

	// ====================================================================
	// Test 5: Gemini call config — enableGrounding=false, responseSchema set
	// ====================================================================

	it('calls generate() with enableGrounding=false and responseSchema set', async () => {
		const candidates = [makeCandidate()];

		const evalResponse = makeEvaluationResponse(1, 1);
		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(JSON.stringify(evalResponse))
		);

		await evaluateSources(candidates, baseContext);

		expect(mockGenerate).toHaveBeenCalledTimes(1);

		const callArgs = mockGenerate.mock.calls[0];
		const prompt = callArgs[0];
		const options = callArgs[1];

		// Prompt should contain message context
		expect(prompt).toContain('Urgent: Water Quality Crisis');
		expect(prompt).toContain('Our water is contaminated');
		expect(prompt).toContain('water');

		// Options: no grounding, structured output schema
		expect(options.enableGrounding).toBe(false);
		expect(options.responseSchema).toBeDefined();
		expect(options.responseSchema).toHaveProperty('type', 'object');
		expect(options.responseSchema).toHaveProperty('properties');
		expect(options.responseSchema.properties).toHaveProperty('sources');

		// Schema should require sources array
		expect(options.responseSchema.required).toContain('sources');

		// Schema items should require candidate_index, credibility_rationale, incentive_position, source_order
		const itemRequired = options.responseSchema.properties.sources.items.required;
		expect(itemRequired).toContain('candidate_index');
		expect(itemRequired).toContain('credibility_rationale');
		expect(itemRequired).toContain('incentive_position');
		expect(itemRequired).toContain('source_order');
	});

	// ====================================================================
	// Test 6: Empty response handling — generate() returns empty text
	// ====================================================================

	it('returns empty array when generate() returns empty text', async () => {
		const candidates = [makeCandidate(), makeCandidate()];

		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(null)
		);

		const result = await evaluateSources(candidates, baseContext);

		expect(result.sources).toEqual([]);
		expect(result.tokenUsage).toBeDefined(); // token usage still extracted
	});

	it('returns empty array when generate() returns unparseable JSON', async () => {
		const candidates = [makeCandidate()];

		mockGenerate.mockResolvedValueOnce(
			makeMockResponse('this is not valid json at all @@##')
		);

		const result = await evaluateSources(candidates, baseContext);

		expect(result.sources).toEqual([]);
	});

	it('returns empty array when response JSON is missing sources array', async () => {
		const candidates = [makeCandidate()];

		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(JSON.stringify({ not_sources: [] }))
		);

		const result = await evaluateSources(candidates, baseContext);

		expect(result.sources).toEqual([]);
	});

	// ====================================================================
	// Additional edge case tests
	// ====================================================================

	it('falls back to candidate data when response fields are missing', async () => {
		const candidate = makeCandidate({
			url: 'https://fallback.gov/data',
			title: 'Fallback Title',
			publishedDate: '2026-03-01'
		});

		// Response with minimal fields — missing title, url, date, publisher
		const evalResponse = {
			sources: [{
				candidate_index: 0,
				type: 'government',
				relevance: 'Relevant data',
				credibility_rationale: 'Credible source.',
				incentive_position: 'neutral',
				source_order: 'primary'
			}]
		};

		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(JSON.stringify(evalResponse))
		);

		const result = await evaluateSources([candidate], baseContext);

		expect(result.sources).toHaveLength(1);
		// Should fall back to candidate data
		expect(result.sources[0].title).toBe('Fallback Title');
		expect(result.sources[0].url).toBe('https://fallback.gov/data');
		expect(result.sources[0].date).toBe('2026-03-01');
		expect(result.sources[0].publisher).toBe('Example Government Agency');
	});

	it('assigns sequential num values to evaluated sources', async () => {
		const candidates = Array.from({ length: 5 }, (_, i) =>
			makeCandidate({
				url: `https://source-${i}.com`,
				title: `Source ${i}`
			})
		);

		const evalResponse = makeEvaluationResponse(5, 5);
		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(JSON.stringify(evalResponse))
		);

		const result = await evaluateSources(candidates, baseContext);

		// Verify sequential numbering
		for (let i = 0; i < result.sources.length; i++) {
			expect(result.sources[i].num).toBe(i + 1);
		}
	});

	it('handles invalid candidate_index gracefully', async () => {
		const candidates = [makeCandidate()];

		const evalResponse = {
			sources: [{
				candidate_index: 99, // Out of range
				title: 'Out of Range Source',
				url: 'https://outofrange.com',
				type: 'other',
				relevance: 'Some relevance',
				credibility_rationale: 'Test rationale.',
				incentive_position: 'neutral',
				source_order: 'secondary'
			}]
		};

		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(JSON.stringify(evalResponse))
		);

		const result = await evaluateSources(candidates, baseContext);

		expect(result.sources).toHaveLength(1);
		// Should use the response values since candidate_index is invalid
		expect(result.sources[0].title).toBe('Out of Range Source');
		expect(result.sources[0].url).toBe('https://outofrange.com');
	});

	it('calls onThought callback with evaluation summary', async () => {
		const candidates = [
			makeCandidate(),
			makeCandidate({ url: 'https://news.com/story', stratum: 'news' })
		];

		const evalResponse = {
			sources: [
				{
					candidate_index: 0,
					title: 'Gov Source',
					url: 'https://example.gov/report',
					type: 'government',
					relevance: 'Official data',
					credibility_rationale: 'Government data.',
					incentive_position: 'adversarial',
					source_order: 'primary'
				},
				{
					candidate_index: 1,
					title: 'News Source',
					url: 'https://news.com/story',
					type: 'journalism',
					relevance: 'Local coverage',
					credibility_rationale: 'Independent journalism.',
					incentive_position: 'neutral',
					source_order: 'secondary'
				}
			]
		};

		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(JSON.stringify(evalResponse))
		);

		const thoughts: string[] = [];
		await evaluateSources(candidates, baseContext, (thought) => thoughts.push(thought));

		expect(thoughts).toHaveLength(1);
		expect(thoughts[0]).toContain('Evaluated 2 sources');
		expect(thoughts[0]).toContain('1 adversarial');
		expect(thoughts[0]).toContain('1 neutral');
	});

	it('includes geographic and decision-maker context in prompt', async () => {
		const candidates = [makeCandidate()];

		const evalResponse = makeEvaluationResponse(1, 1);
		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(JSON.stringify(evalResponse))
		);

		await evaluateSources(candidates, {
			...baseContext,
			geographicScope: {
				type: 'subnational',
				country: 'US',
				subdivision: 'MI',
				locality: 'Flint'
			},
			decisionMakers: [
				{ name: 'Governor Smith', title: 'Governor', organization: 'State of Michigan' }
			]
		});

		const prompt = mockGenerate.mock.calls[0][0];
		expect(prompt).toContain('Flint');
		expect(prompt).toContain('Governor Smith');
		expect(prompt).toContain('State of Michigan');
	});

	it('includes system instruction in generate() call', async () => {
		const candidates = [makeCandidate()];

		const evalResponse = makeEvaluationResponse(1, 1);
		mockGenerate.mockResolvedValueOnce(
			makeMockResponse(JSON.stringify(evalResponse))
		);

		await evaluateSources(candidates, baseContext);

		const options = mockGenerate.mock.calls[0][1];
		expect(options.systemInstruction).toBeDefined();
		expect(options.systemInstruction).toContain('source credibility evaluator');
	});
});
