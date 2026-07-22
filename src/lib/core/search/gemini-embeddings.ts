/**
 * Google Gemini Embedding Integration
 *
 * Replaces OpenAI text-embedding-3-large with Google gemini-embedding-001
 *
 * Benefits:
 * - Better performance: 66.3% vs 64.6% MTEB benchmark
 * - Free-tier availability is account/model dependent; launch requires a
 *   Free-plan key with billing and pay-as-you-go disabled
 * - Multilingual: 100+ languages
 * - Flexible dimensions: 768, 1536, or 3072 (lossless truncation via MRL)
 *
 * API: @google/genai v1.28.0+
 * Model: gemini-embedding-001
 * Dimensions: 768 (recommended for production)
 * Cost: $0.15 per 1M tokens (or FREE in Google AI Studio)
 */

import { GoogleGenAI } from '@google/genai';
import { sanitizeProviderErrorMessage } from '$lib/core/agents/provider-error';

/**
 * Embedding configuration
 */
export const EMBEDDING_CONFIG = {
	model: 'gemini-embedding-001' as const,
	dimensions: 768, // Recommended: 768, 1536, or 3072
	maxInputTokens: 2048,
	batchSize: 100, // Max texts per batch request
	timeout: 30000 // 30 second timeout for API calls
} as const;

/**
 * Task types for Gemini embeddings
 * Optimizes embeddings for specific use cases
 */
export type EmbeddingTaskType =
	| 'RETRIEVAL_DOCUMENT' // Indexing documents for search (templates)
	| 'RETRIEVAL_QUERY' // User search queries
	| 'SEMANTIC_SIMILARITY' // Text similarity comparison
	| 'CLASSIFICATION' // Text categorization
	| 'CLUSTERING'; // Grouping similar texts

/**
 * Embedding generation options
 */
export interface EmbeddingOptions {
	/** Task type (default: RETRIEVAL_DOCUMENT) */
	taskType?: EmbeddingTaskType;
	/** Output dimensions (default: 768) */
	dimensions?: number;
	/** Compatibility field; the reviewed embedding envelope permits exactly one attempt. */
	maxRetries?: 1;
	/** Abort the local SDK request. The provider may still bill already-started work. */
	signal?: AbortSignal;
}

function embeddingError(error: unknown, batch: boolean): Error {
	const prefix = batch ? 'batch embeddings' : 'embedding';
	const safeDetail = sanitizeProviderErrorMessage(error);
	if (error !== null && typeof error === 'object' && 'code' in error) {
		const code = (error as { code?: unknown }).code;
		if (code === 'INVALID_ARGUMENT') {
			return new Error(sanitizeProviderErrorMessage(`Invalid input: ${safeDetail}`));
		}
		if (code === 'UNAUTHENTICATED') {
			return new Error('Invalid GEMINI_API_KEY. Get key from: https://aistudio.google.com/apikey');
		}
	}
	return new Error(
		sanitizeProviderErrorMessage(`Failed to generate ${prefix} after 1 attempt: ${safeDetail}`)
	);
}

function embeddingRequestConfig(
	options: EmbeddingOptions,
	taskType: EmbeddingTaskType,
	dimensions: number
) {
	if (options.maxRetries !== undefined && options.maxRetries !== 1) {
		throw new RangeError('Embedding provider envelope permits exactly one attempt');
	}
	if (dimensions !== EMBEDDING_CONFIG.dimensions) {
		throw new RangeError(
			`Embedding provider envelope requires exactly ${EMBEDDING_CONFIG.dimensions} dimensions`
		);
	}
	return {
		outputDimensionality: dimensions,
		taskType,
		httpOptions: {
			timeout: EMBEDDING_CONFIG.timeout,
			retryOptions: { attempts: 1 }
		},
		...(options.signal ? { abortSignal: options.signal } : {})
	};
}

export function validateEmbeddingVector(values: unknown, index?: number): number[] {
	const label = index === undefined ? 'Embedding' : `Embedding ${index}`;
	if (!Array.isArray(values) || values.length !== EMBEDDING_CONFIG.dimensions) {
		throw new Error(`${label} must contain exactly ${EMBEDDING_CONFIG.dimensions} numeric values`);
	}
	if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
		throw new Error(`${label} contains a non-finite numeric value`);
	}
	return values;
}

/**
 * Initialize Gemini AI client
 */
function getGeminiClient(): GoogleGenAI {
	const apiKey = process.env.GEMINI_API_KEY;

	if (!apiKey) {
		throw new Error(
			'GEMINI_API_KEY environment variable not set. Get key from: https://aistudio.google.com/apikey'
		);
	}

	return new GoogleGenAI({ apiKey });
}

/**
 * Generate embedding for a single text
 *
 * @param text - Text to embed (max 2,048 tokens)
 * @param options - Embedding options
 * @returns Float array of embedding values
 *
 * @example
 * ```typescript
 * const embedding = await generateEmbedding('Hello world');
 * console.log(embedding.length); // 768
 * ```
 */
export async function generateEmbedding(
	text: string,
	options: EmbeddingOptions = {}
): Promise<number[]> {
	const { taskType = 'RETRIEVAL_DOCUMENT', dimensions = EMBEDDING_CONFIG.dimensions } = options;

	const ai = getGeminiClient();

	// Validate input length (rough estimate: 1 token ≈ 4 characters)
	const estimatedTokens = Math.ceil(text.length / 4);
	if (estimatedTokens > EMBEDDING_CONFIG.maxInputTokens) {
		throw new Error(
			`Text too long: ${estimatedTokens} tokens (max: ${EMBEDDING_CONFIG.maxInputTokens}). Truncate input.`
		);
	}

	try {
		const result = await ai.models.embedContent({
			model: EMBEDDING_CONFIG.model,
			contents: [text],
			config: embeddingRequestConfig(options, taskType, dimensions)
		});

		if (!result.embeddings || result.embeddings.length === 0) {
			throw new Error('No embeddings returned from Gemini API');
		}

		return validateEmbeddingVector(result.embeddings[0].values);
	} catch (error) {
		throw embeddingError(error, false);
	}
}

/**
 * Generate embeddings for multiple texts in a single batch request
 *
 * More efficient than calling generateEmbedding() multiple times.
 * Uses batch API endpoint with better rate limits.
 *
 * @param texts - Array of texts to embed (max 100 texts, each max 2,048 tokens)
 * @param options - Embedding options
 * @returns Array of float arrays (one per text)
 *
 * @example
 * ```typescript
 * const embeddings = await generateBatchEmbeddings([
 *   'First text',
 *   'Second text',
 *   'Third text'
 * ]);
 * console.log(embeddings.length); // 3
 * console.log(embeddings[0].length); // 768
 * ```
 */
export async function generateBatchEmbeddings(
	texts: string[],
	options: EmbeddingOptions = {}
): Promise<number[][]> {
	if (texts.length === 0) {
		return [];
	}

	if (texts.length > EMBEDDING_CONFIG.batchSize) {
		throw new Error(
			`Batch size too large: ${texts.length} (max: ${EMBEDDING_CONFIG.batchSize}). Split into multiple batches.`
		);
	}

	const { taskType = 'RETRIEVAL_DOCUMENT', dimensions = EMBEDDING_CONFIG.dimensions } = options;

	const ai = getGeminiClient();

	// Validate input lengths
	for (const text of texts) {
		const estimatedTokens = Math.ceil(text.length / 4);
		if (estimatedTokens > EMBEDDING_CONFIG.maxInputTokens) {
			throw new Error(
				`Text too long: ${estimatedTokens} tokens (max: ${EMBEDDING_CONFIG.maxInputTokens}). Truncate input.`
			);
		}
	}

	try {
		const result = await ai.models.embedContent({
			model: EMBEDDING_CONFIG.model,
			contents: texts,
			config: embeddingRequestConfig(options, taskType, dimensions)
		});

		if (!result.embeddings || result.embeddings.length !== texts.length) {
			throw new Error(`Expected ${texts.length} embeddings, got ${result.embeddings?.length || 0}`);
		}

		return result.embeddings.map((embedding, index) =>
			validateEmbeddingVector(embedding.values, index)
		);
	} catch (error) {
		throw embeddingError(error, true);
	}
}

/**
 * Estimate token count for a text
 *
 * Rough approximation: 1 token ≈ 4 characters
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Estimate cost for embedding generation
 *
 * Pricing: $0.15 per 1M tokens (or FREE in Google AI Studio)
 *
 * @param tokens - Number of tokens
 * @returns Estimated cost in USD
 */
export function estimateCost(tokens: number): number {
	return (tokens / 1_000_000) * 0.15;
}

/**
 * Check if text exceeds max input length
 *
 * @param text - Text to check
 * @returns true if text is too long
 */
export function exceedsMaxLength(text: string): boolean {
	return estimateTokens(text) > EMBEDDING_CONFIG.maxInputTokens;
}

/**
 * Truncate text to fit within max input length
 *
 * Preserves whole words when possible.
 *
 * @param text - Text to truncate
 * @param maxTokens - Maximum tokens (default: 2048)
 * @returns Truncated text
 */
export function truncateText(
	text: string,
	maxTokens: number = EMBEDDING_CONFIG.maxInputTokens
): string {
	const estimatedTokens = estimateTokens(text);

	if (estimatedTokens <= maxTokens) {
		return text;
	}

	// Calculate max characters (1 token ≈ 4 chars)
	const maxChars = maxTokens * 4;

	// Find last space before max chars to avoid cutting words
	const truncated = text.slice(0, maxChars);
	const lastSpace = truncated.lastIndexOf(' ');

	if (lastSpace > maxChars * 0.8) {
		// If last space is within 80% of max, truncate there
		return truncated.slice(0, lastSpace) + '...';
	}

	// Otherwise truncate at max chars
	return truncated + '...';
}
