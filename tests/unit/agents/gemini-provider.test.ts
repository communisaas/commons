/**
 * Unit Tests — Gemini Client + Gemini Provider
 *
 * Covers gemini-client.ts (singleton, generate, streaming, retries, token usage)
 * and gemini-provider.ts (parallel orchestration, email grounding, caching).
 *
 * All Gemini SDK calls are mocked — no real API traffic.
 */

import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';

// ============================================================================
// Hoisted mocks — must be defined before vi.mock()
// ============================================================================

const mockGenerateContent = vi.hoisted(() => vi.fn());
const mockGenerateContentStream = vi.hoisted(() => vi.fn());

// Mock the Google GenAI SDK
vi.mock('@google/genai', () => {
	class MockGoogleGenAI {
		models = {
			generateContent: mockGenerateContent,
			generateContentStream: mockGenerateContentStream
		};
		constructor(_opts: { apiKey: string }) {}
	}
	return { GoogleGenAI: MockGoogleGenAI };
});

// Mock decision-maker (breaks circular import chain)
vi.mock('$lib/core/agents/agents/decision-maker', () => ({
	getAgentToolDeclarations: () => [],
	processGeminiFunctionCall: vi.fn(),
	classifyUrl: vi.fn().mockReturnValue('other'),
	extractContactHints: vi.fn().mockReturnValue({ emails: [], phones: [], socialUrls: [] })
}));

// Mock exa-search
vi.mock('$lib/core/agents/exa-search', () => ({
	searchWeb: vi.fn().mockResolvedValue([]),
	readPage: vi.fn().mockResolvedValue(null),
	prunePageContent: vi.fn().mockImplementation((text: string) => text)
}));

// Mock contact cache
vi.mock('$lib/core/agents/utils/contact-cache', () => ({
	getCachedContacts: vi.fn().mockResolvedValue([]),
	upsertResolvedContacts: vi.fn().mockResolvedValue(undefined),
	normalizeOrgKey: (key: string) => key.trim().toUpperCase().replace(/\s+/g, ':'),
}));

// Mock thought emitter
vi.mock('$lib/core/thoughts/emitter', () => ({
	ThoughtEmitter: class {
		constructor(_cb: unknown) {}
	}
}));

// Mock prompts module (decision-maker prompts)
vi.mock('$lib/core/agents/prompts/decision-maker', () => ({
	ROLE_DISCOVERY_PROMPT: 'system prompt',
	buildRoleDiscoveryPrompt: vi.fn().mockReturnValue('role prompt'),
	IDENTITY_EXTRACTION_PROMPT: 'identity system {CURRENT_DATE}',
	buildIdentityExtractionPrompt: vi.fn().mockReturnValue('identity prompt'),
	SINGLE_CONTACT_PROMPT: 'single contact {MAX_SEARCHES} {MAX_PAGE_READS} {DOMAIN_HINT} {CURRENT_DATE}',
	buildSingleContactPrompt: vi.fn().mockReturnValue('single contact prompt'),
	generateDomainHintForOrg: vi.fn().mockReturnValue(''),
	PAGE_SELECTION_PROMPT: 'page selection {CURRENT_DATE} {MAX_PAGES_TOTAL}',
	buildPageSelectionPrompt: vi.fn().mockReturnValue('page selection prompt'),
	CONTACT_SYNTHESIS_PROMPT: 'contact synthesis {CURRENT_DATE} {DOMAIN_CONTEXT}',
	buildContactSynthesisPrompt: vi.fn().mockReturnValue('contact synthesis prompt'),
	detectOrgTypes: vi.fn().mockReturnValue([]),
	generateDomainContext: vi.fn().mockReturnValue('')
}));

// ============================================================================
// Import SUT (after mocks are registered)
// ============================================================================

import {
	getGeminiClient,
	generate,
	generateStream,
	generateStreamWithThoughts,
	generateWithThoughts,
	interact,
	extractTokenUsage,
	GEMINI_CONFIG
} from '$lib/core/agents/gemini-client';
import { GeminiDecisionMakerProvider } from '$lib/core/agents/providers/gemini-provider';
import type { ResolveContext } from '$lib/core/agents/providers/types';

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal Gemini SDK response */
function makeResponse(text: string, opts: {
	usageMetadata?: Record<string, number>;
	finishReason?: string;
	candidates?: unknown[];
	functionCalls?: unknown[];
} = {}) {
	return {
		text,
		usageMetadata: opts.usageMetadata ?? {
			promptTokenCount: 100,
			candidatesTokenCount: 50,
			totalTokenCount: 150
		},
		candidates: opts.candidates ?? [{
			content: { parts: [{ text }] },
			finishReason: opts.finishReason ?? 'STOP'
		}],
		functionCalls: opts.functionCalls ?? undefined
	};
}

/** Build an async iterable for stream mocking */
function makeStream(chunks: Array<{ text?: string; thought?: boolean; groundingMetadata?: unknown; usageMetadata?: unknown }>) {
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
						content: { parts },
						groundingMetadata: chunk.groundingMetadata
					}],
					usageMetadata: chunk.usageMetadata
				};
			}
		}
	};
}

// ============================================================================
// Tests: Gemini Client — Singleton & Configuration
// ============================================================================

describe('Gemini Client — Singleton & Configuration', () => {
	beforeEach(() => {
		// Reset the singleton by clearing the module-level variable
		// We do this by re-setting the env and allowing getGeminiClient to be called fresh
		process.env.GEMINI_API_KEY = 'test-api-key';
	});

	it('GEMINI_CONFIG exposes expected model name', () => {
		expect(GEMINI_CONFIG.model).toBe('gemini-3-flash-preview');
	});

	it('GEMINI_CONFIG has sensible defaults', () => {
		expect(GEMINI_CONFIG.defaults.temperature).toBe(0.3);
		expect(GEMINI_CONFIG.defaults.maxOutputTokens).toBe(65536);
		expect(GEMINI_CONFIG.defaults.thinkingLevel).toBe('medium');
	});

	it('getGeminiClient returns a client when API key is set', () => {
		const client = getGeminiClient();
		expect(client).toBeDefined();
		expect(client.models).toBeDefined();
	});

	it('getGeminiClient returns the same singleton instance on repeated calls', () => {
		const client1 = getGeminiClient();
		const client2 = getGeminiClient();
		expect(client1).toBe(client2);
	});
});

// ============================================================================
// Tests: extractTokenUsage
// ============================================================================

describe('extractTokenUsage', () => {
	it('returns undefined when usageMetadata is absent', () => {
		const response = { text: 'hello' } as never;
		expect(extractTokenUsage(response)).toBeUndefined();
	});

	it('extracts all token counts', () => {
		const response = makeResponse('hello', {
			usageMetadata: {
				promptTokenCount: 1500,
				candidatesTokenCount: 800,
				thoughtsTokenCount: 2000,
				totalTokenCount: 4300
			}
		});
		const usage = extractTokenUsage(response as never);
		expect(usage).toEqual({
			promptTokens: 1500,
			candidatesTokens: 800,
			thoughtsTokens: 2000,
			totalTokens: 4300
		});
	});

	it('defaults missing counts to 0 (not NaN)', () => {
		const response = { text: 'hello', usageMetadata: {} } as never;
		const usage = extractTokenUsage(response);
		expect(usage).toEqual({
			promptTokens: 0,
			candidatesTokens: 0,
			thoughtsTokens: undefined,
			totalTokens: 0
		});
	});

	it('handles partial usageMetadata gracefully', () => {
		const response = {
			text: 'hello',
			usageMetadata: { promptTokenCount: 500, totalTokenCount: 500 }
		} as never;
		const usage = extractTokenUsage(response);
		expect(usage?.promptTokens).toBe(500);
		expect(usage?.candidatesTokens).toBe(0);
		expect(usage?.thoughtsTokens).toBeUndefined();
	});
});

// ============================================================================
// Tests: generate — Happy Path
// ============================================================================

describe('generate — happy path', () => {
	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		mockGenerateContent.mockReset();
	});

	it('generates content with default options', async () => {
		mockGenerateContent.mockResolvedValueOnce(makeResponse('Hello world'));
		const response = await generate('test prompt');
		expect(response.text).toBe('Hello world');
	});

	it('passes temperature and maxOutputTokens to config', async () => {
		mockGenerateContent.mockResolvedValueOnce(makeResponse('result'));
		await generate('test', { temperature: 0.9, maxOutputTokens: 1024 });

		expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
			config: expect.objectContaining({
				temperature: 0.9,
				maxOutputTokens: 1024
			})
		}));
	});

	it('uses GEMINI_CONFIG defaults when options are omitted', async () => {
		mockGenerateContent.mockResolvedValueOnce(makeResponse('result'));
		await generate('test');

		expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
			config: expect.objectContaining({
				temperature: 0.3,
				maxOutputTokens: 65536
			})
		}));
	});

	it('passes systemInstruction when provided', async () => {
		mockGenerateContent.mockResolvedValueOnce(makeResponse('result'));
		await generate('test', { systemInstruction: 'You are a helper' });

		expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
			config: expect.objectContaining({
				systemInstruction: 'You are a helper'
			})
		}));
	});

	it('sends prompt as contents', async () => {
		mockGenerateContent.mockResolvedValueOnce(makeResponse('result'));
		await generate('my test prompt');

		expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
			contents: 'my test prompt',
			model: GEMINI_CONFIG.model
		}));
	});
});

// ============================================================================
// Tests: generate — Grounding vs JSON Schema
// ============================================================================

describe('generate — grounding vs JSON schema', () => {
	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		mockGenerateContent.mockReset();
	});

	it('enables Google Search grounding when enableGrounding is true', async () => {
		mockGenerateContent.mockResolvedValueOnce(makeResponse('grounded result'));
		await generate('test', { enableGrounding: true });

		const callConfig = mockGenerateContent.mock.calls[0][0].config;
		expect(callConfig.tools).toEqual([{ googleSearch: {} }]);
		expect(callConfig.responseMimeType).toBeUndefined();
	});

	it('enables JSON schema when responseSchema is provided (no grounding)', async () => {
		const schema = { type: 'object', properties: { name: { type: 'string' } } };
		mockGenerateContent.mockResolvedValueOnce(makeResponse('{"name":"test"}'));
		await generate('test', { responseSchema: schema });

		const callConfig = mockGenerateContent.mock.calls[0][0].config;
		expect(callConfig.responseMimeType).toBe('application/json');
		expect(callConfig.responseSchema).toBe(schema);
		expect(callConfig.tools).toBeUndefined();
	});

	it('grounding takes precedence over JSON schema (they are incompatible)', async () => {
		const schema = { type: 'object' };
		mockGenerateContent.mockResolvedValueOnce(makeResponse('grounded'));
		await generate('test', { enableGrounding: true, responseSchema: schema });

		const callConfig = mockGenerateContent.mock.calls[0][0].config;
		expect(callConfig.tools).toEqual([{ googleSearch: {} }]);
		// Schema should NOT be applied when grounding is on
		expect(callConfig.responseMimeType).toBeUndefined();
	});
});

// ============================================================================
// Tests: generate — Retry Logic
// ============================================================================

describe('generate — retry logic', () => {
	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		mockGenerateContent.mockReset();
		// Stub setTimeout to resolve immediately — avoids real backoff waits
		// while still exercising the retry loop.
		vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
			if (typeof fn === 'function') fn();
			return 0 as unknown as ReturnType<typeof setTimeout>;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('retries on RESOURCE_EXHAUSTED and succeeds on third attempt', async () => {
		const rateLimitError = Object.assign(new Error('Rate limited'), { code: 'RESOURCE_EXHAUSTED' });
		mockGenerateContent
			.mockRejectedValueOnce(rateLimitError)
			.mockRejectedValueOnce(rateLimitError)
			.mockResolvedValueOnce(makeResponse('finally'));

		const result = await generate('test');

		expect(result.text).toBe('finally');
		expect(mockGenerateContent).toHaveBeenCalledTimes(3);
	});

	it('throws after max retries (3) on persistent rate limiting', async () => {
		const rateLimitError = Object.assign(new Error('Rate limited'), { code: 'RESOURCE_EXHAUSTED' });
		mockGenerateContent
			.mockRejectedValueOnce(rateLimitError)
			.mockRejectedValueOnce(rateLimitError)
			.mockRejectedValueOnce(rateLimitError);

		await expect(generate('test')).rejects.toThrow(/Failed to generate content after 3 attempts/);
		expect(mockGenerateContent).toHaveBeenCalledTimes(3);
	});

	it('does not retry on INVALID_ARGUMENT (immediate failure)', async () => {
		const invalidError = Object.assign(new Error('Bad input'), { code: 'INVALID_ARGUMENT' });
		mockGenerateContent.mockRejectedValueOnce(invalidError);

		await expect(generate('test')).rejects.toThrow(/Invalid input/);
		expect(mockGenerateContent).toHaveBeenCalledTimes(1);
	});

	it('does not retry on UNAUTHENTICATED (immediate failure)', async () => {
		const authError = Object.assign(new Error('Bad key'), { code: 'UNAUTHENTICATED' });
		mockGenerateContent.mockRejectedValueOnce(authError);

		await expect(generate('test')).rejects.toThrow(/Invalid GEMINI_API_KEY/);
		expect(mockGenerateContent).toHaveBeenCalledTimes(1);
	});

	it('retries on unknown errors and recovers', async () => {
		mockGenerateContent
			.mockRejectedValueOnce(new Error('Network error'))
			.mockResolvedValueOnce(makeResponse('recovered'));

		const result = await generate('test');

		expect(result.text).toBe('recovered');
		expect(mockGenerateContent).toHaveBeenCalledTimes(2);
	});

	it('calls setTimeout with exponential backoff delays (1s, 2s)', async () => {
		const rateLimitError = Object.assign(new Error('Rate limited'), { code: 'RESOURCE_EXHAUSTED' });
		mockGenerateContent
			.mockRejectedValueOnce(rateLimitError)
			.mockRejectedValueOnce(rateLimitError)
			.mockResolvedValueOnce(makeResponse('ok'));

		await generate('test');

		const setTimeoutCalls = (globalThis.setTimeout as unknown as Mock).mock.calls;
		// First retry: 1000 * 2^0 = 1000
		expect(setTimeoutCalls[0][1]).toBe(1000);
		// Second retry: 1000 * 2^1 = 2000
		expect(setTimeoutCalls[1][1]).toBe(2000);
	});
});

// ============================================================================
// Tests: generate — Truncation & JSON Recovery
// ============================================================================

describe('generate — truncation and JSON recovery', () => {
	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		mockGenerateContent.mockReset();
	});

	it('returns valid JSON response as-is', async () => {
		const jsonText = '{"subject_line": "Test Subject"}';
		mockGenerateContent.mockResolvedValueOnce(makeResponse(jsonText));
		const result = await generate('test', {
			responseSchema: { type: 'object' }
		});
		expect(result.text).toBe(jsonText);
	});

	it('recovers partial JSON from truncated response', async () => {
		// Simulate a truncated response with partial JSON that contains extractable fields
		const truncatedJson = '{"subject_line": "Test Subject", "core_message": "Test message", "topics": ["env';
		mockGenerateContent.mockResolvedValueOnce({
			...makeResponse(truncatedJson, { finishReason: 'MAX_TOKENS' }),
			text: truncatedJson
		});

		const result = await generate('test', {
			responseSchema: { type: 'object' }
		});

		// Should recover partial data
		const parsed = JSON.parse(result.text!);
		expect(parsed.subject_line).toBe('Test Subject');
	});

	it('recovers empty object from garbled text with braces (best-effort recovery)', async () => {
		// The recovery system tries to extract anything with braces.
		// When text has no useful structure, it recovers an empty or minimal object.
		const garbled = '{{not valid}}';
		mockGenerateContent.mockResolvedValueOnce({
			...makeResponse(garbled),
			text: garbled
		});

		// Should not throw — the recovery extracts something
		const result = await generate('test', {
			responseSchema: { type: 'object' }
		});
		expect(result.text).toBeDefined();
	});

	it('returns non-JSON response without schema validation', async () => {
		mockGenerateContent.mockResolvedValueOnce(makeResponse('plain text answer'));
		const result = await generate('test');
		expect(result.text).toBe('plain text answer');
	});
});

// ============================================================================
// Tests: generateStream
// ============================================================================

describe('generateStream', () => {
	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		mockGenerateContentStream.mockReset();
	});

	it('yields thought chunks for thought parts', async () => {
		mockGenerateContentStream.mockResolvedValueOnce(
			makeStream([
				{ text: 'thinking about the problem', thought: true },
				{ text: 'final answer' }
			])
		);

		const chunks = [];
		for await (const chunk of generateStream('test')) {
			chunks.push(chunk);
		}

		expect(chunks[0]).toEqual({ type: 'thought', content: 'thinking about the problem' });
		expect(chunks[1]).toEqual({ type: 'text', content: 'final answer' });
		expect(chunks[2]).toEqual({ type: 'complete', content: 'final answer' });
	});

	it('yields text chunks for regular parts', async () => {
		mockGenerateContentStream.mockResolvedValueOnce(
			makeStream([{ text: 'part1' }, { text: 'part2' }])
		);

		const chunks = [];
		for await (const chunk of generateStream('test')) {
			chunks.push(chunk);
		}

		const textChunks = chunks.filter(c => c.type === 'text');
		expect(textChunks).toHaveLength(2);
	});

	it('yields a complete chunk with full accumulated text', async () => {
		mockGenerateContentStream.mockResolvedValueOnce(
			makeStream([{ text: 'Hello ' }, { text: 'World' }])
		);

		const chunks = [];
		for await (const chunk of generateStream('test')) {
			chunks.push(chunk);
		}

		const complete = chunks.find(c => c.type === 'complete');
		expect(complete?.content).toBe('Hello World');
	});

	it('yields error chunk on stream failure', async () => {
		mockGenerateContentStream.mockRejectedValueOnce(new Error('Stream crashed'));

		const chunks = [];
		for await (const chunk of generateStream('test')) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(1);
		expect(chunks[0].type).toBe('error');
		expect(chunks[0].content).toContain('Stream crashed');
	});

	it('configures thinking budget based on thinkingLevel', async () => {
		mockGenerateContentStream.mockResolvedValueOnce(makeStream([{ text: 'result' }]));

		// Consume the generator
		for await (const _ of generateStream('test', { thinkingLevel: 'high' })) {}

		const callConfig = mockGenerateContentStream.mock.calls[0][0].config;
		expect(callConfig.thinkingConfig.thinkingBudget).toBe(8192);
	});

	it('uses low thinking budget for thinkingLevel=low', async () => {
		mockGenerateContentStream.mockResolvedValueOnce(makeStream([{ text: 'result' }]));
		for await (const _ of generateStream('test', { thinkingLevel: 'low' })) {}

		const callConfig = mockGenerateContentStream.mock.calls[0][0].config;
		expect(callConfig.thinkingConfig.thinkingBudget).toBe(1024);
	});

	it('uses medium thinking budget by default', async () => {
		mockGenerateContentStream.mockResolvedValueOnce(makeStream([{ text: 'result' }]));
		for await (const _ of generateStream('test')) {}

		const callConfig = mockGenerateContentStream.mock.calls[0][0].config;
		expect(callConfig.thinkingConfig.thinkingBudget).toBe(4096);
	});
});

// ============================================================================
// Tests: generateStreamWithThoughts
// ============================================================================

describe('generateStreamWithThoughts', () => {
	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		mockGenerateContentStream.mockReset();
	});

	it('appends JSON output instruction to system prompt', async () => {
		mockGenerateContentStream.mockResolvedValueOnce(makeStream([{ text: '{"data": "test"}' }]));

		const gen = generateStreamWithThoughts('test', { systemInstruction: 'Be helpful' });
		let iterResult = await gen.next();
		while (!iterResult.done) { iterResult = await gen.next(); }

		const callConfig = mockGenerateContentStream.mock.calls[0][0].config;
		expect(callConfig.systemInstruction).toContain('Be helpful');
		expect(callConfig.systemInstruction).toContain('CRITICAL: Your response MUST be valid JSON');
	});

	it('parses JSON from streamed text output', async () => {
		const json = '{"subject_line": "Test", "topics": ["env"]}';
		mockGenerateContentStream.mockResolvedValueOnce(makeStream([{ text: json }]));

		const gen = generateStreamWithThoughts<{ subject_line: string }>('test');
		let iterResult = await gen.next();
		while (!iterResult.done) { iterResult = await gen.next(); }

		const result = iterResult.value;
		expect(result.parseSuccess).toBe(true);
		expect(result.data?.subject_line).toBe('Test');
	});

	it('captures grounding metadata from stream chunks', async () => {
		const groundingMeta = {
			webSearchQueries: ['test query'],
			groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
			groundingSupports: [{ segment: { startIndex: 0, endIndex: 10 } }],
			searchEntryPoint: { renderedContent: '<div>test</div>' }
		};

		mockGenerateContentStream.mockResolvedValueOnce(
			makeStream([{ text: '{"data": true}', groundingMetadata: groundingMeta }])
		);

		const gen = generateStreamWithThoughts('test', { enableGrounding: true });
		let iterResult = await gen.next();
		while (!iterResult.done) { iterResult = await gen.next(); }

		const result = iterResult.value;
		expect(result.groundingMetadata).toBeDefined();
		expect(result.groundingMetadata?.webSearchQueries).toEqual(['test query']);
		expect(result.groundingMetadata?.groundingChunks).toHaveLength(1);
	});

	it('captures token usage from stream (latest wins)', async () => {
		mockGenerateContentStream.mockResolvedValueOnce(
			makeStream([
				{ text: 'part1', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } },
				{ text: 'part2', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 } }
			])
		);

		const gen = generateStreamWithThoughts('test');
		let iterResult = await gen.next();
		while (!iterResult.done) { iterResult = await gen.next(); }

		const result = iterResult.value;
		expect(result.tokenUsage?.totalTokens).toBe(150); // Latest chunk wins
	});

	it('returns parse error when JSON extraction fails', async () => {
		mockGenerateContentStream.mockResolvedValueOnce(
			makeStream([{ text: 'not json at all just text' }])
		);

		const gen = generateStreamWithThoughts<{ foo: string }>('test');
		let iterResult = await gen.next();
		while (!iterResult.done) { iterResult = await gen.next(); }

		const result = iterResult.value;
		expect(result.parseSuccess).toBe(false);
		expect(result.data).toBeNull();
	});

	it('handles stream error gracefully', async () => {
		mockGenerateContentStream.mockRejectedValueOnce(new Error('API down'));

		const gen = generateStreamWithThoughts('test');
		const chunks = [];
		let iterResult = await gen.next();
		while (!iterResult.done) {
			chunks.push(iterResult.value);
			iterResult = await gen.next();
		}

		const result = iterResult.value;
		expect(result.parseSuccess).toBe(false);
		expect(result.parseError).toContain('API down');

		// Should have yielded an error chunk
		expect(chunks.some(c => c.type === 'error')).toBe(true);
	});

	it('enables grounding in config when enableGrounding is set', async () => {
		mockGenerateContentStream.mockResolvedValueOnce(makeStream([{ text: '{}' }]));

		const gen = generateStreamWithThoughts('test', { enableGrounding: true });
		let iterResult = await gen.next();
		while (!iterResult.done) { iterResult = await gen.next(); }

		const callConfig = mockGenerateContentStream.mock.calls[0][0].config;
		expect(callConfig.tools).toEqual([{ googleSearch: {} }]);
	});
});

// ============================================================================
// Tests: generateWithThoughts (convenience wrapper)
// ============================================================================

describe('generateWithThoughts', () => {
	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		mockGenerateContentStream.mockReset();
	});

	it('collects thoughts and calls onThought callback', async () => {
		mockGenerateContentStream.mockResolvedValueOnce(
			makeStream([
				{ text: 'reasoning step 1', thought: true },
				{ text: 'reasoning step 2', thought: true },
				{ text: '{"answer": 42}' }
			])
		);

		const thoughts: string[] = [];
		const result = await generateWithThoughts('test', {}, (thought) => {
			thoughts.push(thought);
		});

		expect(thoughts).toHaveLength(2);
		expect(thoughts[0]).toContain('reasoning step 1');
		expect(result.data).toEqual({ answer: 42 });
	});

	it('returns parsed data and rawText', async () => {
		const json = '{"subject_line": "Test"}';
		mockGenerateContentStream.mockResolvedValueOnce(makeStream([{ text: json }]));

		const result = await generateWithThoughts<{ subject_line: string }>('test');
		expect(result.rawText).toBe(json);
		expect(result.data?.subject_line).toBe('Test');
		expect(result.parseSuccess).toBe(true);
	});

	it('returns fallback when generator fails to produce a result', async () => {
		// Create a stream that immediately completes without data
		mockGenerateContentStream.mockResolvedValueOnce({
			[Symbol.asyncIterator]: async function* () {
				// yield nothing
			}
		});

		const result = await generateWithThoughts('test');
		// Fallback: generator returns but rawText might be empty
		expect(result.rawText).toBeDefined();
	});
});

// ============================================================================
// Tests: interact (multi-turn)
// ============================================================================

describe('interact', () => {
	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		mockGenerateContent.mockReset();
	});

	it('returns InteractionResponse with id, outputs, model', async () => {
		mockGenerateContent.mockResolvedValueOnce(makeResponse('Hello'));
		const result = await interact('test input');

		expect(result.id).toBeDefined();
		expect(result.id).toMatch(/^interaction-/);
		expect(result.outputs).toBe('Hello');
		expect(result.model).toBe(GEMINI_CONFIG.model);
	});

	it('reuses previousInteractionId when provided', async () => {
		mockGenerateContent.mockResolvedValueOnce(makeResponse('Follow-up'));
		const result = await interact('follow-up', { previousInteractionId: 'existing-123' });

		expect(result.id).toBe('existing-123');
	});

	it('generates unique IDs for new interactions', async () => {
		mockGenerateContent.mockResolvedValueOnce(makeResponse('A'));
		mockGenerateContent.mockResolvedValueOnce(makeResponse('B'));

		const r1 = await interact('first');
		const r2 = await interact('second');

		expect(r1.id).not.toBe(r2.id);
	});
});

// ============================================================================
// Tests: GeminiDecisionMakerProvider
// ============================================================================

describe('GeminiDecisionMakerProvider', () => {
	let provider: GeminiDecisionMakerProvider;

	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		provider = new GeminiDecisionMakerProvider();
		mockGenerateContent.mockReset();
		mockGenerateContentStream.mockReset();
	});

	describe('canResolve', () => {
		it('returns true when subjectLine is non-empty', () => {
			const ctx: ResolveContext = {
				targetType: 'congress',
				subjectLine: 'Stop pollution',
				coreMessage: 'Test',
				topics: ['environment']
			};
			expect(provider.canResolve(ctx)).toBe(true);
		});

		it('returns false when subjectLine is empty', () => {
			const ctx: ResolveContext = {
				targetType: 'congress',
				subjectLine: '',
				coreMessage: 'Test',
				topics: []
			};
			expect(provider.canResolve(ctx)).toBe(false);
		});

		it('accepts any targetType (open-ended resolver)', () => {
			for (const targetType of ['congress', 'corporate', 'nonprofit', 'school_board', 'custom_xyz']) {
				const ctx: ResolveContext = {
					targetType,
					subjectLine: 'Test',
					coreMessage: 'Test',
					topics: []
				};
				expect(provider.canResolve(ctx)).toBe(true);
			}
		});
	});

	describe('provider metadata', () => {
		it('has name gemini-search', () => {
			expect(provider.name).toBe('gemini-search');
		});

		it('has empty supportedTargetTypes', () => {
			expect(provider.supportedTargetTypes).toEqual([]);
		});
	});

	describe('resolve — error handling', () => {
		it('returns empty result on phase 1 JSON extraction failure', async () => {
			mockGenerateContentStream.mockResolvedValue(
				makeStream([{ text: 'NOT VALID JSON AT ALL %%^&' }])
			);

			const ctx: ResolveContext = {
				targetType: 'congress',
				subjectLine: 'Test issue',
				coreMessage: 'Fix this',
				topics: ['policy']
			};

			const result = await provider.resolve(ctx);
			expect(result.decisionMakers).toEqual([]);
			expect(result.provider).toBe('gemini-search');
		});

		it('returns empty result when phase 1 finds zero roles', async () => {
			// Phase 1 returns valid JSON but with empty roles array
			mockGenerateContentStream.mockResolvedValue(
				makeStream([{ text: '{"roles": []}' }])
			);

			const ctx: ResolveContext = {
				targetType: 'congress',
				subjectLine: 'Test issue',
				coreMessage: 'Fix this',
				topics: ['policy']
			};

			const result = await provider.resolve(ctx);
			expect(result.decisionMakers).toEqual([]);
			expect(result.researchSummary).toContain('No positions');
		});

		it('catches errors and returns empty result (never throws to caller)', async () => {
			// Simulate complete API failure
			mockGenerateContentStream.mockRejectedValue(new Error('Total API failure'));

			const ctx: ResolveContext = {
				targetType: 'congress',
				subjectLine: 'Test issue',
				coreMessage: 'Fix this',
				topics: ['policy']
			};

			const result = await provider.resolve(ctx);
			expect(result.decisionMakers).toEqual([]);
			expect(result.provider).toBe('gemini-search');
		});
	});

	describe('processOneCandidate — email grounding', () => {
		// Access private method for unit testing email verification
		function processOneCandidate(candidate: Record<string, unknown>, pages: Array<{ url: string; title: string; text: string }>) {
			return (provider as any).processOneCandidate(candidate, pages);
		}

		const pages = [
			{
				url: 'https://city.gov/staff',
				title: 'Staff Directory',
				text: 'Mayor Jane Doe\nEmail: mayor@city.gov\nPhone: 555-1234'
			},
			{
				url: 'https://news.com/article',
				title: 'News Article',
				text: 'Jane Doe was elected mayor.'
			}
		];

		it('marks email as grounded when found in page content', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Has authority',
				email: 'mayor@city.gov',
				email_source: 'https://city.gov/staff',
				recency_check: 'Current'
			};

			const result = processOneCandidate(candidate, pages);
			expect(result).not.toBeNull();
			expect(result.emailGrounded).toBe(true);
			expect(result.email).toBe('mayor@city.gov');
			expect(result.emailSource).toBe('https://city.gov/staff');
		});

		it('marks email as ungrounded when not found in any page', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Has authority',
				email: 'fabricated@nowhere.com',
				recency_check: 'Current'
			};

			const result = processOneCandidate(candidate, pages);
			expect(result.emailGrounded).toBe(false);
		});

		it('searches all pages when email_source page does not contain email', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Has authority',
				email: 'mayor@city.gov',
				email_source: 'https://news.com/article', // wrong source
				recency_check: 'Current'
			};

			const result = processOneCandidate(candidate, pages);
			expect(result.emailGrounded).toBe(true);
			// Should find it in the staff page
			expect(result.emailSource).toBe('https://city.gov/staff');
		});

		it('handles NO_EMAIL_FOUND sentinel', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Has authority',
				email: 'NO_EMAIL_FOUND',
				recency_check: 'Current'
			};

			const result = processOneCandidate(candidate, pages);
			expect(result.email).toBeUndefined();
			expect(result.emailGrounded).toBeUndefined();
		});

		it('handles case-insensitive NO_EMAIL_FOUND', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Has authority',
				email: 'no_email_found',
				recency_check: 'Current'
			};

			const result = processOneCandidate(candidate, pages);
			expect(result.email).toBeUndefined();
		});

		it('handles email without @ symbol', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Has authority',
				email: 'not-an-email',
				recency_check: 'Current'
			};

			const result = processOneCandidate(candidate, pages);
			expect(result.email).toBeUndefined();
		});

		it('handles empty email string', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Has authority',
				email: '',
				recency_check: 'Current'
			};

			const result = processOneCandidate(candidate, pages);
			expect(result.email).toBeUndefined();
		});

		it('trusts cache hits without re-grounding', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Has authority',
				email: 'cached@elsewhere.com',
				email_source: 'https://old.gov/page',
				recency_check: 'Cached',
				cacheHit: true
			};

			// Even though email is NOT in any page, cache hits are trusted
			const result = processOneCandidate(candidate, pages);
			expect(result.emailGrounded).toBe(true);
			expect(result.email).toBe('cached@elsewhere.com');
		});

		it('case-insensitive email matching in page content', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Has authority',
				email: 'MAYOR@CITY.GOV', // uppercase
				recency_check: 'Current'
			};

			const result = processOneCandidate(candidate, pages);
			expect(result.emailGrounded).toBe(true);
		});

		it('builds provenance string with reasoning and source info', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Controls municipal budget',
				email: 'mayor@city.gov',
				email_source: 'https://city.gov/staff',
				recency_check: 'Confirmed in office as of 2026'
			};

			const result = processOneCandidate(candidate, pages);
			expect(result.provenance).toContain('Controls municipal budget');
			expect(result.provenance).toContain('Person verified via');
			expect(result.provenance).toContain('Email VERIFIED');
		});

		it('uses source_url as fallback when email_source is empty', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Has authority',
				email: '',
				source_url: 'https://news.com/article',
				recency_check: 'Current'
			};

			const result = processOneCandidate(candidate, pages);
			expect(result.source).toBe('https://news.com/article');
		});

		it('sets isAiResolved to true', () => {
			const candidate = {
				name: 'Jane Doe',
				title: 'Mayor',
				organization: 'City of Example',
				reasoning: 'Has authority',
				email: '',
				recency_check: ''
			};

			const result = processOneCandidate(candidate, pages);
			expect(result.isAiResolved).toBe(true);
		});
	});

	describe('processDecisionMakers — filtering', () => {
		function processDecisionMakers(candidates: Array<Record<string, unknown>>, pages: Array<{ url: string; title: string; text: string }>) {
			return (provider as any).processDecisionMakers(candidates, pages);
		}

		it('filters out unnamed candidates (name is UNKNOWN)', () => {
			const candidates = [
				{ name: 'UNKNOWN', title: 'CEO', organization: 'Corp', reasoning: '', email: '', recency_check: '' },
				{ name: 'Jane Doe', title: 'CEO', organization: 'Corp', reasoning: '', email: '', recency_check: '' }
			];
			const result = processDecisionMakers(candidates, []);
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('Jane Doe');
		});

		it('filters out candidates with name N/A', () => {
			const candidates = [
				{ name: 'N/A', title: 'CEO', organization: 'Corp', reasoning: '', email: '', recency_check: '' }
			];
			const result = processDecisionMakers(candidates, []);
			expect(result).toHaveLength(0);
		});

		it('filters out candidates with empty name', () => {
			const candidates = [
				{ name: '', title: 'CEO', organization: 'Corp', reasoning: '', email: '', recency_check: '' }
			];
			const result = processDecisionMakers(candidates, []);
			expect(result).toHaveLength(0);
		});

		it('processes valid candidates into ProcessedDecisionMaker format', () => {
			const candidates = [
				{
					name: 'Jane Doe',
					title: 'CEO',
					organization: 'Corp',
					reasoning: 'Controls budget',
					email: '',
					recency_check: 'Current'
				}
			];
			const result = processDecisionMakers(candidates, []);
			expect(result).toHaveLength(1);
			expect(result[0]).toHaveProperty('name', 'Jane Doe');
			expect(result[0]).toHaveProperty('isAiResolved', true);
		});
	});
});

// ============================================================================
// Tests: Safety & Edge Cases
// ============================================================================

describe('Safety & Edge Cases', () => {
	beforeEach(() => {
		process.env.GEMINI_API_KEY = 'test-api-key';
		mockGenerateContent.mockReset();
		mockGenerateContentStream.mockReset();
	});

	it('generate handles response with no text', async () => {
		mockGenerateContent.mockResolvedValueOnce({
			...makeResponse(''),
			text: ''
		});
		const result = await generate('test');
		expect(result.text).toBe('');
	});

	it('generateStream handles empty stream', async () => {
		mockGenerateContentStream.mockResolvedValueOnce({
			[Symbol.asyncIterator]: async function* () {
				// Empty stream
			}
		});

		const chunks = [];
		for await (const chunk of generateStream('test')) {
			chunks.push(chunk);
		}

		// Should still yield a complete chunk
		expect(chunks).toHaveLength(1);
		expect(chunks[0].type).toBe('complete');
		expect(chunks[0].content).toBe('');
	});

	it('generateStreamWithThoughts extracts JSON wrapped in markdown code blocks', async () => {
		const wrappedJson = '```json\n{"result": "success"}\n```';
		mockGenerateContentStream.mockResolvedValueOnce(
			makeStream([{ text: wrappedJson }])
		);

		const gen = generateStreamWithThoughts<{ result: string }>('test');
		let iterResult = await gen.next();
		while (!iterResult.done) { iterResult = await gen.next(); }

		const result = iterResult.value;
		expect(result.parseSuccess).toBe(true);
		expect(result.data?.result).toBe('success');
	});

	it('generateStreamWithThoughts handles JSON surrounded by preamble text', async () => {
		const withPreamble = 'Here is the analysis:\n\n{"result": "found"}\n\nHope this helps!';
		mockGenerateContentStream.mockResolvedValueOnce(
			makeStream([{ text: withPreamble }])
		);

		const gen = generateStreamWithThoughts<{ result: string }>('test');
		let iterResult = await gen.next();
		while (!iterResult.done) { iterResult = await gen.next(); }

		const result = iterResult.value;
		expect(result.parseSuccess).toBe(true);
		expect(result.data?.result).toBe('found');
	});
});
