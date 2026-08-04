/**
 * Safety classification via GROQ (gpt-oss-safeguard-20b)
 *
 * Content moderation using MLCommons hazard taxonomy.
 * Optimized for civic content with electoral misinformation (S13)
 * and defamation (S5) detection.
 *
 * Previously used Llama Guard 4 12B, but that model is no longer
 * available on the free tier. gpt-oss-safeguard-20b is a reasoning
 * model that supports bring-your-own-policy safety classification.
 *
 * @see https://console.groq.com/docs/content-moderation
 */

import type { MLCommonsHazard, SafetyResult } from './types';
import { HAZARD_DESCRIPTIONS, BLOCKING_HAZARDS } from './types';
import { GroqTransportError, requestGroqChatCompletion } from './groq-transport';
import { sanitizeProviderErrorMessage } from '$lib/core/agents/provider-error';

const MODEL = 'openai/gpt-oss-safeguard-20b';
export const SAFETY_INPUT_MAX_BYTES = 64 * 1024;

const SAFETY_SYSTEM_PROMPT = `Classify user content safety using MLCommons taxonomy. Respond ONLY with: safe OR unsafe followed by comma-separated hazard codes (e.g. unsafe,S1,S5).

Hazard categories:
S1: Violent crimes
S2: Non-violent crimes
S3: Sex-related crimes
S4: Child sexual exploitation
S5: Defamation
S6: Specialized advice
S7: Privacy
S8: Intellectual property
S9: Indiscriminate weapons
S10: Hate
S11: Suicide & self-harm
S12: Sexual content
S13: Elections (misinformation)
S14: Code interpreter abuse`;

/**
 * Parse safety model response into structured result
 *
 * Handles both formats:
 * - Llama Guard: "unsafe\nS1" or "unsafe\nS1,S2"
 * - gpt-oss-safeguard: "unsafe,S1" or "unsafe,S1,S5"
 *
 * PERMISSIVE POLICY: Only BLOCKING_HAZARDS (S1, S4) cause safe=false.
 * All other hazards are logged but content proceeds.
 */
function parseResponse(response: string): {
	safe: boolean;
	hazards: MLCommonsHazard[];
	blocking_hazards: MLCommonsHazard[];
} {
	const trimmed = response.trim().toLowerCase();

	if (trimmed === 'safe') {
		return { safe: true, hazards: [], blocking_hazards: [] };
	}

	if (trimmed.startsWith('unsafe')) {
		// An unsafe decision without at least one valid taxonomy code is not a
		// permissive result. Treat bare/ambiguous provider output as unavailable.
		if (!/^unsafe(?:[\s,]+S(?:1[0-4]|[1-9]))+(?:[\s,]*)$/iu.test(trimmed)) {
			throw new Error('Safety classifier returned an invalid response');
		}
		const hazardMatches = trimmed.match(/S(?:1[0-4]|[1-9])/giu) ?? [];
		const hazards = [
			...new Set(hazardMatches.map((hazard) => hazard.toUpperCase() as MLCommonsHazard))
		];

		// Only BLOCKING_HAZARDS (S1, S4) cause rejection
		const blocking_hazards = hazards.filter((h) =>
			BLOCKING_HAZARDS.includes(h)
		) as MLCommonsHazard[];

		// Safe if no blocking hazards detected (non-blocking hazards are allowed)
		const safe = blocking_hazards.length === 0;

		return { safe, hazards, blocking_hazards };
	}

	throw new Error('Safety classifier returned an invalid response');
}

/**
 * Classify content safety via GROQ
 *
 * @param content - Text content to classify
 * @returns SafetyResult with hazard categories
 * @throws Error whenever the provider is unavailable or its decision is malformed
 */
export async function classifySafety(
	content: string,
	options: { signal?: AbortSignal } = {}
): Promise<SafetyResult> {
	if (new TextEncoder().encode(content).byteLength > SAFETY_INPUT_MAX_BYTES) {
		throw new RangeError(`Safety moderation input exceeds ${SAFETY_INPUT_MAX_BYTES} bytes`);
	}

	const startTime = Date.now();

	let data: {
		choices?: Array<{ message?: { content?: unknown } }>;
		usage?: { total_tokens?: unknown };
	};
	try {
		data = await requestGroqChatCompletion<typeof data>(
			{
				model: MODEL,
				messages: [
					{ role: 'system', content: SAFETY_SYSTEM_PROMPT },
					{ role: 'user', content }
				],
				temperature: 0,
				max_tokens: 64
			},
			{ signal: options.signal }
		);
	} catch (error) {
		if (
			error !== null &&
			typeof error === 'object' &&
			'name' in error &&
			(error as { name?: unknown }).name === 'AbortError'
		) {
			throw error;
		}
		// Handle rate limiting — user should retry
		if (error instanceof GroqTransportError && error.status === 429) {
			console.error('[safety] Rate limited by GROQ');
			throw new Error('Safety check rate limited. Please try again in a moment.');
		}

		console.error('[safety] GROQ API error:', sanitizeProviderErrorMessage(error));
		throw new Error('Safety moderation service unavailable');
	}

	const modelResponse = data.choices?.[0]?.message?.content;
	if (typeof modelResponse !== 'string' || modelResponse.length > 4_000) {
		throw new Error('Safety classifier returned an invalid response');
	}
	const { safe, hazards, blocking_hazards } = parseResponse(modelResponse);

	const latencyMs = Date.now() - startTime;

	// Log all hazards but only reject on blocking ones
	if (hazards.length > 0) {
		console.debug(`[safety] Classification complete in ${latencyMs}ms:`, {
			safe,
			all_hazards: hazards,
			blocking_hazards,
			tokens: typeof data.usage?.total_tokens === 'number' ? data.usage.total_tokens : undefined
		});
	} else {
		console.debug(`[safety] Classification complete in ${latencyMs}ms: safe`);
	}

	return {
		safe,
		hazards,
		blocking_hazards,
		hazard_descriptions: hazards.map((h) => HAZARD_DESCRIPTIONS[h]),
		reasoning: modelResponse,
		timestamp: new Date().toISOString(),
		model: MODEL
	};
}

/**
 * Batch classify multiple content pieces
 * Respects GROQ rate limits (30 req/min)
 *
 * @param contents - Array of content strings
 * @returns Array of SafetyResults
 */
export async function classifySafetyBatch(
	contents: string[],
	options: { signal?: AbortSignal } = {}
): Promise<SafetyResult[]> {
	const results: SafetyResult[] = [];

	for (let i = 0; i < contents.length; i++) {
		if (options.signal?.aborted) {
			throw options.signal.reason instanceof Error
				? options.signal.reason
				: new DOMException('Safety batch aborted', 'AbortError');
		}
		const result = await classifySafety(contents[i], options);
		results.push(result);

		// Rate limit: 30 req/min = 1 req per 2 seconds
		// Add buffer for safety
		if (i < contents.length - 1) {
			await new Promise<void>((resolve, reject) => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const onAbort = () => {
					if (timer !== undefined) clearTimeout(timer);
					reject(
						options.signal?.reason instanceof Error
							? options.signal.reason
							: new DOMException('Safety batch aborted', 'AbortError')
					);
				};
				options.signal?.addEventListener('abort', onAbort, { once: true });
				timer = setTimeout(() => {
					options.signal?.removeEventListener('abort', onAbort);
					resolve();
				}, 2100);
			});
		}
	}

	return results;
}
