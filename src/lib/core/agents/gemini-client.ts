/**
 * Gemini AI Client for Agent Infrastructure
 *
 * Centralized SDK wrapper for Gemini 3 Flash Preview integration with:
 * - Singleton client initialization
 * - Structured output with JSON schemas
 * - Google Search grounding
 * - Multi-turn conversations (simulated until Interactions API is available)
 * - Stage-specific prompt/output/timeout ceilings
 * - At most one retry, only for explicitly classified transient responses
 * - SDK abort propagation with hidden SDK retries disabled
 */

import { GoogleGenAI } from '@google/genai';
import type { GenerateContentResponse, GenerateContentConfig } from '@google/genai';
import type {
	GenerateOptions,
	GroundingMetadata,
	InteractionResponse,
	StreamChunk,
	StreamResultWithThoughts,
	TokenUsage
} from './types';
import { extractJsonFromGroundingResponse } from './utils/grounding-json';
import { recoverTruncatedJson } from './utils/truncation-recovery';
import { geminiStageEnvelope, type GeminiStageEnvelope } from './provider-call-envelope';
import { sanitizeProviderErrorMessage } from './provider-error';

// ============================================================================
// Gemini SDK Grounding Types
// ============================================================================

/** Gemini SDK grounding types — not exported by the SDK but present at runtime */
interface GeminiGroundingChunk {
	web?: { uri?: string; title?: string };
}

interface GeminiGroundingSupport {
	segment?: { startIndex: number; endIndex: number };
	groundingChunkIndices?: number[];
	confidenceScores?: number[];
}

interface GeminiGroundingMetadata {
	webSearchQueries?: string[];
	groundingChunks?: GeminiGroundingChunk[];
	groundingSupports?: GeminiGroundingSupport[];
	searchEntryPoint?: { renderedContent?: string };
}

// ============================================================================
// Client Singleton
// ============================================================================

let client: GoogleGenAI | null = null;

/**
 * Initialize and return the Gemini client
 *
 * Uses singleton pattern to reuse the same client instance.
 * Throws if GEMINI_API_KEY is not configured.
 *
 * @returns GoogleGenAI client instance
 * @throws Error if GEMINI_API_KEY environment variable not set
 */
export function getGeminiClient(): GoogleGenAI {
	if (!client) {
		const apiKey = process.env.GEMINI_API_KEY;
		if (!apiKey) {
			throw new Error(
				'GEMINI_API_KEY environment variable not set. Get key from: https://aistudio.google.com/apikey'
			);
		}
		client = new GoogleGenAI({ apiKey });
	}
	return client;
}

// ============================================================================
// Configuration
// ============================================================================

export const GEMINI_CONFIG = {
	// Latest stable flash. The prior `gemini-3-flash-preview` ran away under the
	// real agent prompts — generating to the 65k output cap (~64k tokens, ~200s,
	// MAX_TOKENS truncation) on every subject-line call. 3.5-flash returns the
	// same task cleanly in ~5s. Pinned (not `gemini-flash-latest`) so a future
	// Google rollout can't silently reintroduce the regression.
	model: 'gemini-3.5-flash',
	defaults: {
		temperature: 0.3,
		// A compatibility default for display/tests only. Real calls are governed
		// by their required stage envelope below.
		maxOutputTokens: 4096,
		thinkingLevel: 'low' as const
	}
} as const;

const THINKING_BUDGETS = Object.freeze({
	low: 512,
	medium: 1_024,
	high: 2_048
} as const);

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function promptBytes(
	prompt: string,
	options: GenerateOptions,
	systemInstruction: string | undefined
): number {
	let total = byteLength(prompt) + byteLength(systemInstruction ?? '');
	if (options.responseSchema) total += byteLength(JSON.stringify(options.responseSchema));
	return total;
}

function effectiveOutputTokens(options: GenerateOptions, envelope: GeminiStageEnvelope): number {
	const requested = options.maxOutputTokens ?? envelope.maxOutputTokens;
	if (!Number.isSafeInteger(requested) || requested <= 0 || requested > envelope.maxOutputTokens) {
		throw new RangeError(
			`[agents/gemini-client] ${options.stage} output exceeds ${envelope.maxOutputTokens} tokens`
		);
	}
	return requested;
}

function assertPromptEnvelope(
	prompt: string,
	options: GenerateOptions,
	systemInstruction: string | undefined
): GeminiStageEnvelope {
	const envelope = geminiStageEnvelope(options.stage);
	const bytes = promptBytes(prompt, options, systemInstruction);
	if (bytes > envelope.maxPromptBytes) {
		throw new RangeError(
			`[agents/gemini-client] ${options.stage} prompt exceeds ${envelope.maxPromptBytes} bytes`
		);
	}
	return envelope;
}

function thinkingBudget(options: GenerateOptions, envelope: GeminiStageEnvelope): number {
	const level = options.thinkingLevel ?? GEMINI_CONFIG.defaults.thinkingLevel;
	return Math.min(THINKING_BUDGETS[level], envelope.maxThinkingTokens);
}

function errorField(error: unknown, field: 'code' | 'status' | 'statusCode'): unknown {
	return error !== null && typeof error === 'object' && field in error
		? (error as Record<string, unknown>)[field]
		: undefined;
}

function errorName(error: unknown): string | undefined {
	return error instanceof Error ? error.name : undefined;
}

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException('The provider request was aborted', 'AbortError');
}

/** Wait between explicit transient attempts without outliving request cancellation. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	if (!signal) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
	if (signal.aborted) return Promise.reject(abortReason(signal));

	return new Promise((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onAbort = () => {
			if (timer !== undefined) clearTimeout(timer);
			reject(abortReason(signal));
		};
		signal.addEventListener('abort', onAbort, { once: true });
		timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
	});
}

/**
 * Only provider-declared capacity/unavailability responses are retryable.
 * Unknown network failures, local parsing/validation errors, and abort/timeouts
 * are deliberately terminal because the first request may already be billable.
 */
export function isRetryableGeminiError(error: unknown): boolean {
	if (errorName(error) === 'AbortError' || errorName(error) === 'TimeoutError') return false;
	const values = [
		errorField(error, 'code'),
		errorField(error, 'status'),
		errorField(error, 'statusCode')
	];
	return values.some((value) => {
		if (
			value === 8 ||
			value === 14 ||
			value === 429 ||
			value === 502 ||
			value === 503 ||
			value === 504
		) {
			return true;
		}
		if (typeof value !== 'string') return false;
		return ['8', '14', '429', '502', '503', '504', 'RESOURCE_EXHAUSTED', 'UNAVAILABLE'].includes(
			value.toUpperCase()
		);
	});
}

function terminalProviderError(error: unknown, attempts: number): Error {
	const code = errorField(error, 'code');
	const safeDetail = sanitizeProviderErrorMessage(error);
	if (code === 'INVALID_ARGUMENT') {
		return new Error(
			sanitizeProviderErrorMessage(`[agents/gemini-client] Invalid input: ${safeDetail}`)
		);
	}
	if (code === 'UNAUTHENTICATED') {
		return new Error(
			'[agents/gemini-client] Invalid GEMINI_API_KEY. Get key from: https://aistudio.google.com/apikey'
		);
	}
	return new Error(
		sanitizeProviderErrorMessage(
			`[agents/gemini-client] Failed to generate content after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${safeDetail}`
		)
	);
}

// ============================================================================
// Token Usage Extraction
// ============================================================================

/**
 * Extract TokenUsage from a Gemini API response.
 * Returns undefined if usageMetadata is not present.
 */
export function extractTokenUsage(response: GenerateContentResponse): TokenUsage | undefined {
	const meta = response.usageMetadata;
	if (!meta) return undefined;
	return {
		promptTokens: meta.promptTokenCount ?? 0,
		candidatesTokens: meta.candidatesTokenCount ?? 0,
		thoughtsTokens: meta.thoughtsTokenCount ?? undefined,
		totalTokens: meta.totalTokenCount ?? 0
	};
}

// ============================================================================
// Generate Content (Single-turn)
// ============================================================================

/**
 * Generate content using Gemini with optional grounding and structured output
 *
 * Single-turn generation with support for:
 * - Temperature control
 * - Google Search grounding
 * - JSON schema enforcement
 * - System instructions
 * - Thinking levels (low/medium/high) - not yet available in SDK v1.28.0
 *
 * Retry behavior is selected by the reviewed stage envelope. No stage can
 * exceed two attempts and local/ambiguous failures are never retried.
 *
 * @param prompt - User prompt to generate from
 * @param options - Generation configuration options
 * @returns Generated content response
 * @throws Error on API failures or invalid configuration
 *
 * @example
 * ```typescript
 * const response = await generate('Analyze this issue...', {
 *   temperature: 0.4,
 *   enableGrounding: true,
 *   responseSchema: SUBJECT_LINE_SCHEMA
 * });
 * ```
 */
export async function generate(
	prompt: string,
	options: GenerateOptions
): Promise<GenerateContentResponse> {
	const envelope = assertPromptEnvelope(prompt, options, options.systemInstruction);
	const ai = getGeminiClient();

	const config: GenerateContentConfig = {
		temperature: options.temperature ?? GEMINI_CONFIG.defaults.temperature,
		maxOutputTokens: effectiveOutputTokens(options, envelope),
		thinkingConfig: {
			thinkingBudget: thinkingBudget(options, envelope)
		},
		// The SDK defaults to five attempts when retryOptions is present without
		// an explicit value. Force one SDK attempt; our reviewed loop below owns
		// the only possible retry.
		httpOptions: {
			timeout: envelope.timeoutMs,
			retryOptions: { attempts: 1 }
		},
		...(options.signal ? { abortSignal: options.signal } : {})
	};

	// Add grounding if enabled
	// NOTE: Google Search grounding is INCOMPATIBLE with JSON response schema
	// When grounding is enabled, we must parse the response manually
	if (options.enableGrounding) {
		config.tools = [{ googleSearch: {} }];
		// Cannot use responseMimeType with tools - Gemini API limitation
		console.debug('[agents/gemini-client] Using grounding mode (no JSON schema)');
	} else if (options.responseSchema) {
		// Only add structured output if NOT using grounding
		config.responseMimeType = 'application/json';
		config.responseSchema = options.responseSchema;
		console.debug('[agents/gemini-client] Using JSON schema mode (no grounding)');
	}

	// Add system instruction if provided
	if (options.systemInstruction) {
		config.systemInstruction = options.systemInstruction;
	}

	for (let attempt = 0; attempt < envelope.maxAttempts; attempt++) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		try {
			const response = await ai.models.generateContent({
				model: GEMINI_CONFIG.model,
				contents: prompt,
				config
			});

			// Check for truncation (MAX_TOKENS finish reason)
			const finishReason = response.candidates?.[0]?.finishReason;
			const wasTruncated = finishReason === 'MAX_TOKENS';

			if (wasTruncated) {
				console.warn(
					'[agents/gemini-client] Response truncated (MAX_TOKENS). Output length:',
					response.text?.length
				);
			}

			// Validate JSON response if schema was requested
			if (options.responseSchema && response.text) {
				// Try to parse the JSON - if it fails, it's truncated
				try {
					JSON.parse(response.text);
					// Valid JSON, return as-is
					return response;
				} catch {
					// JSON is malformed/truncated - attempt best-effort recovery
					const recovery = recoverTruncatedJson<Record<string, unknown>>(response.text, []);

					if (recovery.data && Object.keys(recovery.data).length > 0) {
						console.debug('[agents/gemini-client] Truncated but recoverable structured response:', {
							fieldCount: Object.keys(recovery.data).length
						});
						// Patch the response with recovered partial JSON
						const patchedResponse = {
							...response,
							text: JSON.stringify(recovery.data)
						} as GenerateContentResponse;
						return patchedResponse;
					}

					// Recovery failed completely
					console.error('[agents/gemini-client] JSON parse failed and recovery unsuccessful:', {
						responseCharacters: response.text.length,
						recoverableFieldCount: 0
					});
					throw new Error(
						'[agents/gemini-client] Response contains malformed JSON that could not be recovered'
					);
				}
			}

			return response;
		} catch (error) {
			const attempts = attempt + 1;
			const isLastAttempt = attempts >= envelope.maxAttempts;
			if (isLastAttempt || !isRetryableGeminiError(error) || options.signal?.aborted) {
				throw terminalProviderError(error, attempts);
			}

			const delay = 500 * 2 ** attempt;
			console.warn(
				`[agents/gemini-client] ${options.stage} transient provider failure; retrying once in ${delay}ms`
			);
			await abortableDelay(delay, options.signal);
			if (options.signal?.aborted) throw abortReason(options.signal);
		}
	}

	throw new Error('[agents/gemini-client] Stage attempt envelope exhausted');
}

// ============================================================================
// Streaming Generation with Thoughts
// ============================================================================

/**
 * Stream content from Gemini with thinking summaries
 *
 * Uses generateContentStream with includeThoughts: true to provide
 * real-time visibility into the model's reasoning process.
 *
 * Yields chunks with type 'thought' for reasoning and 'text' for output.
 *
 * @param prompt - User prompt to generate from
 * @param options - Generation configuration options
 * @yields StreamChunk with type and content
 *
 * @example
 * ```typescript
 * for await (const chunk of generateStream('Analyze this...', {
 *   systemInstruction: SUBJECT_LINE_PROMPT,
 *   responseSchema: SUBJECT_LINE_SCHEMA
 * })) {
 *   if (chunk.type === 'thought') {
 *     console.log('Thinking:', chunk.content);
 *   } else if (chunk.type === 'text') {
 *     console.log('Output:', chunk.content);
 *   }
 * }
 * ```
 */
export async function* generateStream(
	prompt: string,
	options: GenerateOptions
): AsyncGenerator<StreamChunk> {
	const envelope = assertPromptEnvelope(prompt, options, options.systemInstruction);
	const ai = getGeminiClient();

	const config: GenerateContentConfig = {
		temperature: options.temperature ?? GEMINI_CONFIG.defaults.temperature,
		maxOutputTokens: effectiveOutputTokens(options, envelope),
		// Enable thinking with summaries
		thinkingConfig: {
			includeThoughts: true,
			thinkingBudget: thinkingBudget(options, envelope)
		},
		httpOptions: {
			timeout: envelope.timeoutMs,
			retryOptions: { attempts: 1 }
		},
		...(options.signal ? { abortSignal: options.signal } : {})
	};

	// Add response schema if provided (non-grounding mode)
	if (options.responseSchema) {
		config.responseMimeType = 'application/json';
		config.responseSchema = options.responseSchema;
	}

	// Add system instruction if provided
	if (options.systemInstruction) {
		config.systemInstruction = options.systemInstruction;
	}

	try {
		const response = await ai.models.generateContentStream({
			model: GEMINI_CONFIG.model,
			contents: prompt,
			config
		});

		let fullText = '';

		for await (const chunk of response) {
			// Check for parts with thought flag
			if (chunk.candidates?.[0]?.content?.parts) {
				for (const part of chunk.candidates[0].content.parts) {
					if (!part.text) continue;

					// Check if this is a thought part
					if ('thought' in part && part.thought) {
						yield { type: 'thought', content: part.text };
					} else {
						fullText += part.text;
						yield { type: 'text', content: part.text };
					}
				}
			} else if (chunk.text) {
				// Fallback for simpler response structure
				fullText += chunk.text;
				yield { type: 'text', content: chunk.text };
			}
		}

		yield { type: 'complete', content: fullText };
	} catch (error) {
		const safeError = sanitizeProviderErrorMessage(error, 'Stream generation failed');
		console.error('[agents/gemini-client] Stream error:', safeError);
		yield {
			type: 'error',
			content: safeError
		};
	}
}

// ============================================================================
// Streaming with Thoughts + JSON Parsing
// ============================================================================

/**
 * JSON instruction suffix appended to system prompts when streamThoughts=true
 * This ensures the model outputs valid JSON even without responseMimeType
 */
const JSON_OUTPUT_INSTRUCTION = `

CRITICAL: Your response MUST be valid JSON only. No markdown, no code blocks, no explanation text.
Output the JSON object directly, starting with { and ending with }.`;

/**
 * Stream content with thinking summaries and parse JSON at the end
 *
 * This function enables perceptual coupling between the user and agent activity
 * by streaming thought summaries in real-time while still getting structured output.
 *
 * Key insight: responseMimeType='application/json' suppresses thoughts with complex schemas.
 * Solution: Don't use responseMimeType, append JSON instructions to system prompt,
 * then parse manually using extractJsonFromGroundingResponse.
 *
 * @param prompt - User prompt to generate from
 * @param options - Generation configuration (streamThoughts should be true)
 * @yields StreamChunk for thoughts and text as they arrive
 * @returns Final StreamResultWithThoughts with parsed JSON data
 *
 * @example
 * ```typescript
 * const generator = generateStreamWithThoughts<SubjectLineResponse>('Analyze...', {
 *   systemInstruction: SUBJECT_LINE_PROMPT,
 *   streamThoughts: true
 * });
 *
 * const thoughts: string[] = [];
 * let result: StreamResultWithThoughts<SubjectLineResponse>;
 *
 * for await (const chunk of generator) {
 *   if (chunk.type === 'thought') {
 *     console.log('Thinking:', chunk.content);
 *     thoughts.push(chunk.content);
 *   }
 * }
 * result = generator.result; // Access final parsed result
 * ```
 */
export async function* generateStreamWithThoughts<T = unknown>(
	prompt: string,
	options: GenerateOptions
): AsyncGenerator<StreamChunk, StreamResultWithThoughts<T>> {
	// Append JSON instruction to system prompt
	const systemInstruction = options.systemInstruction
		? options.systemInstruction + JSON_OUTPUT_INSTRUCTION
		: JSON_OUTPUT_INSTRUCTION;
	const envelope = assertPromptEnvelope(prompt, options, systemInstruction);
	const ai = getGeminiClient();

	const config: GenerateContentConfig = {
		temperature: options.temperature ?? GEMINI_CONFIG.defaults.temperature,
		maxOutputTokens: effectiveOutputTokens(options, envelope),
		systemInstruction,
		// Enable thinking with summaries
		thinkingConfig: {
			includeThoughts: true,
			thinkingBudget: thinkingBudget(options, envelope)
		},
		httpOptions: {
			timeout: envelope.timeoutMs,
			retryOptions: { attempts: 1 }
		},
		...(options.signal ? { abortSignal: options.signal } : {})
		// NOTE: Do NOT use responseMimeType here - it suppresses thoughts
	};

	// Add grounding if enabled (Google Search for real-time data)
	if (options.enableGrounding) {
		config.tools = [{ googleSearch: {} }];
		console.debug('[agents/gemini-client] Stream+thoughts: grounding enabled');
	}

	const thoughts: string[] = [];
	let fullText = '';
	let groundingMetadata: GroundingMetadata | undefined;
	let tokenUsage: TokenUsage | undefined;

	try {
		const response = await ai.models.generateContentStream({
			model: GEMINI_CONFIG.model,
			contents: prompt,
			config
		});

		for await (const chunk of response) {
			// Capture grounding metadata (typically in final chunks when using Google Search)
			const chunkGrounding = chunk.candidates?.[0]?.groundingMetadata;
			if (chunkGrounding) {
				// Cast the parent object once — SDK types don't expose grounding fields
				const typed = chunkGrounding as GeminiGroundingMetadata;

				groundingMetadata = {
					webSearchQueries: typed.webSearchQueries,
					groundingChunks: typed.groundingChunks?.map((gc) => ({
						web: gc.web
					})),
					groundingSupports: typed.groundingSupports?.map((gs) => ({
						segment: gs.segment,
						groundingChunkIndices: gs.groundingChunkIndices,
						confidenceScores: gs.confidenceScores
					})),
					searchEntryPoint: typed.searchEntryPoint
				};
			}

			// Capture usageMetadata (latest wins — final chunk has totals)
			if (chunk.usageMetadata) {
				tokenUsage = {
					promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
					candidatesTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
					thoughtsTokens: chunk.usageMetadata.thoughtsTokenCount ?? undefined,
					totalTokens: chunk.usageMetadata.totalTokenCount ?? 0
				};
			}

			// Check for parts with thought flag
			if (chunk.candidates?.[0]?.content?.parts) {
				for (const part of chunk.candidates[0].content.parts) {
					if (!part.text) continue;

					// Check if this is a thought part
					if ('thought' in part && part.thought) {
						thoughts.push(part.text);
						yield { type: 'thought', content: part.text };
					} else {
						fullText += part.text;
						yield { type: 'text', content: part.text };
					}
				}
			} else if (chunk.text) {
				// Fallback for simpler response structure
				fullText += chunk.text;
				yield { type: 'text', content: chunk.text };
			}
		}

		yield { type: 'complete', content: fullText };

		// Log grounding info for debugging
		if (groundingMetadata) {
			console.debug('[agents/gemini-client] Grounding metadata captured:', {
				searchQueries: groundingMetadata.webSearchQueries?.length || 0,
				chunks: groundingMetadata.groundingChunks?.length || 0,
				supports: groundingMetadata.groundingSupports?.length || 0
			});
		}

		// Parse JSON from the collected text
		const extraction = extractJsonFromGroundingResponse<T>(fullText);

		return {
			thoughts,
			rawText: fullText,
			data: extraction.data,
			parseSuccess: extraction.success,
			parseError: extraction.error
				? sanitizeProviderErrorMessage(extraction.error, 'Structured response parsing failed')
				: undefined,
			groundingMetadata,
			tokenUsage
		};
	} catch (error) {
		const safeError = sanitizeProviderErrorMessage(error, 'Stream generation failed');
		console.error('[agents/gemini-client] Stream error:', safeError);
		yield {
			type: 'error',
			content: safeError
		};

		return {
			thoughts,
			rawText: fullText,
			data: null,
			parseSuccess: false,
			parseError: safeError,
			groundingMetadata,
			tokenUsage
		};
	}
}

/**
 * Convenience function to stream thoughts and get final parsed result
 *
 * Collects all stream output and returns the final result.
 * Use generateStreamWithThoughts directly if you need to process chunks in real-time.
 *
 * @param prompt - User prompt
 * @param options - Generation options
 * @param onThought - Callback for each thought (optional)
 * @returns Final result with thoughts and parsed data
 */
export async function generateWithThoughts<T = unknown>(
	prompt: string,
	options: GenerateOptions,
	onThought?: (thought: string) => void
): Promise<StreamResultWithThoughts<T>> {
	const generator = generateStreamWithThoughts<T>(prompt, options);
	const thoughts: string[] = [];
	let rawText = '';

	// Iterate through chunks, capturing the return value
	let iterResult = await generator.next();

	while (!iterResult.done) {
		const chunk = iterResult.value;

		if (chunk.type === 'thought') {
			thoughts.push(chunk.content);
			if (onThought) {
				onThought(chunk.content);
			}
		} else if (chunk.type === 'text') {
			rawText += chunk.content;
		}

		iterResult = await generator.next();
	}

	// When done=true, value contains the return value of the generator
	if (iterResult.done && iterResult.value) {
		return iterResult.value as StreamResultWithThoughts<T>;
	}

	// Fallback if something went wrong
	return {
		thoughts,
		rawText,
		data: null,
		parseSuccess: false,
		parseError: 'Generator did not return a result'
	};
}

// ============================================================================
// Stateful Interaction (Multi-turn)
// ============================================================================

/**
 * Create a stateful interaction for multi-turn conversations
 *
 * Note: The Gemini SDK's Interactions API is not yet available in v1.28.0.
 * This implementation simulates multi-turn conversations using generate()
 * with manual state tracking via interaction IDs.
 *
 * For true multi-turn support, the interaction ID should be used to
 * maintain conversation history in application state, then pass the full
 * conversation context to generate() on each turn.
 *
 * @param input - User input text
 * @param options - Generation configuration
 * @returns InteractionResponse with outputs and interaction ID
 *
 * @example
 * ```typescript
 * // First turn
 * const result1 = await interact('Analyze this issue...', {
 *   systemInstruction: SUBJECT_LINE_PROMPT,
 *   responseSchema: SUBJECT_LINE_SCHEMA
 * });
 *
 * // Refinement turn
 * const result2 = await interact('Make it more specific', {
 *   previousInteractionId: result1.id,
 *   systemInstruction: SUBJECT_LINE_PROMPT,
 *   responseSchema: SUBJECT_LINE_SCHEMA
 * });
 * ```
 */
export async function interact(
	input: string,
	options: GenerateOptions
): Promise<InteractionResponse> {
	// Use generate() since Interactions API isn't available yet in SDK v1.28.0
	// When ai.interactions.create() becomes available, replace this implementation
	const response = await generate(input, options);

	// Extract text from response
	const outputs = response.text || '';

	// Generate or reuse interaction ID for multi-turn tracking
	// In a real implementation, this ID would be used to retrieve conversation history
	const id =
		options.previousInteractionId ||
		`interaction-${Date.now()}-${Math.random().toString(36).substring(7)}`;

	return {
		id,
		outputs,
		model: GEMINI_CONFIG.model,
		tokenUsage: extractTokenUsage(response)
	};
}
