/**
 * Gemini AI Client for Agent Infrastructure
 *
 * Centralized SDK wrapper for Gemini 3 Flash Preview integration with:
 * - Singleton client initialization
 * - Structured output with JSON schemas
 * - Google Search grounding
 * - Multi-turn conversations (simulated until Interactions API is available)
 * - Retry logic with exponential backoff (1s, 2s, 4s)
 * - Max 3 retries for RESOURCE_EXHAUSTED errors
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
	model: 'gemini-3-flash-preview',
	defaults: {
		temperature: 0.3,
		maxOutputTokens: 65536,
		thinkingLevel: 'medium' as const
	}
} as const;

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
 * Includes retry logic for rate limits (RESOURCE_EXHAUSTED).
 * Uses exponential backoff: 1s, 2s, 4s.
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
	options: GenerateOptions = {}
): Promise<GenerateContentResponse> {
	const ai = getGeminiClient();

	const config: GenerateContentConfig = {
		temperature: options.temperature ?? GEMINI_CONFIG.defaults.temperature,
		maxOutputTokens: options.maxOutputTokens ?? GEMINI_CONFIG.defaults.maxOutputTokens
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

	// Note: thinkingConfig.thinkingLevel is not yet supported in SDK v1.28.0
	// Keeping parameter for future API compatibility
	// When available, uncomment:
	// if (options.thinkingLevel) {
	//   config.thinkingConfig = { thinkingLevel: options.thinkingLevel };
	// }

	// Retry logic with exponential backoff
	const maxRetries = 3;
	const retryDelay = 1000; // 1 second base delay

	for (let attempt = 0; attempt < maxRetries; attempt++) {
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
						console.debug(
							'[agents/gemini-client] Truncated but recoverable - extracted fields:',
							Object.keys(recovery.data)
						);
						// Patch the response with recovered partial JSON
						const patchedResponse = {
							...response,
							text: JSON.stringify(recovery.data)
						} as GenerateContentResponse;
						return patchedResponse;
					}

					// Recovery failed completely
					console.error(
						'[agents/gemini-client] JSON parse failed and recovery unsuccessful. Last chars:',
						recovery.lastChars
					);
					throw new Error(
						'[agents/gemini-client] Response contains malformed JSON that could not be recovered'
					);
				}
			}

			return response;
		} catch (error) {
			const isLastAttempt = attempt === maxRetries - 1;

			// Check for specific error types
			if (error && typeof error === 'object' && 'code' in error) {
				const errorCode = (error as { code: string }).code;

				if (errorCode === 'RESOURCE_EXHAUSTED') {
					// Rate limit exceeded - retry with exponential backoff
					if (!isLastAttempt) {
						const delay = retryDelay * Math.pow(2, attempt);
						console.warn(
							`[agents/gemini-client] Rate limit exceeded, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`
						);
						await new Promise((resolve) => setTimeout(resolve, delay));
						continue;
					}
				} else if (errorCode === 'INVALID_ARGUMENT') {
					// Invalid input - don't retry
					throw new Error(
						`[agents/gemini-client] Invalid input: ${error instanceof Error ? error.message : String(error)}`
					);
				} else if (errorCode === 'UNAUTHENTICATED') {
					// Invalid API key - don't retry
					throw new Error(
						'[agents/gemini-client] Invalid GEMINI_API_KEY. Get key from: https://aistudio.google.com/apikey'
					);
				}
			}

			// Unknown error or last attempt - throw
			if (isLastAttempt) {
				console.error('[agents/gemini-client] Generation failed:', error);
				throw new Error(
					`[agents/gemini-client] Failed to generate content after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`
				);
			}

			// Retry with exponential backoff
			const delay = retryDelay * Math.pow(2, attempt);
			console.warn(`[agents/gemini-client] Generation failed, retrying in ${delay}ms...`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw new Error('[agents/gemini-client] Max retries exceeded (should not reach here)');
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
	options: GenerateOptions = {}
): AsyncGenerator<StreamChunk> {
	const ai = getGeminiClient();

	const config: GenerateContentConfig = {
		temperature: options.temperature ?? GEMINI_CONFIG.defaults.temperature,
		maxOutputTokens: options.maxOutputTokens ?? GEMINI_CONFIG.defaults.maxOutputTokens,
		// Enable thinking with summaries
		thinkingConfig: {
			includeThoughts: true,
			thinkingBudget:
				options.thinkingLevel === 'high' ? 8192 : options.thinkingLevel === 'low' ? 1024 : 4096
		}
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
		console.error('[agents/gemini-client] Stream error:', error);
		yield {
			type: 'error',
			content: error instanceof Error ? error.message : 'Stream generation failed'
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
	options: GenerateOptions = {}
): AsyncGenerator<StreamChunk, StreamResultWithThoughts<T>> {
	const ai = getGeminiClient();

	// Append JSON instruction to system prompt
	const systemInstruction = options.systemInstruction
		? options.systemInstruction + JSON_OUTPUT_INSTRUCTION
		: JSON_OUTPUT_INSTRUCTION;

	const config: GenerateContentConfig = {
		temperature: options.temperature ?? GEMINI_CONFIG.defaults.temperature,
		maxOutputTokens: options.maxOutputTokens ?? GEMINI_CONFIG.defaults.maxOutputTokens,
		systemInstruction,
		// Enable thinking with summaries
		thinkingConfig: {
			includeThoughts: true,
			thinkingBudget:
				options.thinkingLevel === 'high' ? 8192 : options.thinkingLevel === 'low' ? 1024 : 4096
		}
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
			parseError: extraction.error,
			groundingMetadata,
			tokenUsage
		};
	} catch (error) {
		console.error('[agents/gemini-client] Stream error:', error);
		yield {
			type: 'error',
			content: error instanceof Error ? error.message : 'Stream generation failed'
		};

		return {
			thoughts,
			rawText: fullText,
			data: null,
			parseSuccess: false,
			parseError: error instanceof Error ? error.message : 'Stream generation failed',
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
	options: GenerateOptions = {},
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
	options: GenerateOptions = {}
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
