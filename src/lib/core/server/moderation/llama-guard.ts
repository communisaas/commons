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

import { env } from '$env/dynamic/private';
import type { MLCommonsHazard, SafetyResult } from './types';
import { HAZARD_DESCRIPTIONS, BLOCKING_HAZARDS } from './types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-safeguard-20b';

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
		// Extract hazard codes from any format: "unsafe\nS1,S2" or "unsafe,S1,S5"
		const hazardMatches = response.match(/S\d{1,2}/gi) || [];
		const hazards = hazardMatches
			.map((h) => h.toUpperCase())
			.filter((h): h is MLCommonsHazard => /^S(1[0-4]|[1-9])$/.test(h));

		// Only BLOCKING_HAZARDS (S1, S4) cause rejection
		const blocking_hazards = hazards.filter((h) =>
			BLOCKING_HAZARDS.includes(h)
		) as MLCommonsHazard[];

		// Safe if no blocking hazards detected (non-blocking hazards are allowed)
		const safe = blocking_hazards.length === 0;

		return { safe, hazards, blocking_hazards };
	}

	// Default to safe if parsing fails (fail-open for edge cases)
	console.warn('[safety] Unexpected response format, defaulting to safe:', response);
	return { safe: true, hazards: [], blocking_hazards: [] };
}

/**
 * Classify content safety via GROQ
 *
 * @param content - Text content to classify
 * @returns SafetyResult with hazard categories
 * @throws Error if rate limited (429)
 */
export async function classifySafety(content: string): Promise<SafetyResult> {
	const apiKey = env.GROQ_API_KEY;

	if (!apiKey) {
		console.warn('[safety] GROQ_API_KEY not configured, defaulting to safe');
		return {
			safe: true,
			hazards: [],
			blocking_hazards: [],
			hazard_descriptions: [],
			reasoning: 'GROQ API key not configured - safety check skipped',
			timestamp: new Date().toISOString(),
			model: MODEL
		};
	}

	const startTime = Date.now();

	const response = await fetch(GROQ_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({
			model: MODEL,
			messages: [
				{ role: 'system', content: SAFETY_SYSTEM_PROMPT },
				{ role: 'user', content }
			],
			temperature: 0,
			max_tokens: 1000
		})
	});

	if (!response.ok) {
		const errorText = await response.text();

		// Handle rate limiting — user should retry
		if (response.status === 429) {
			console.error('[safety] Rate limited by GROQ:', errorText);
			throw new Error('Safety check rate limited. Please try again in a moment.');
		}

		// Non-rate-limit errors: fail-open so Groq outages don't block publishing
		console.error('[safety] GROQ API error (fail-open):', response.status, errorText);
		return {
			safe: true,
			hazards: [],
			blocking_hazards: [],
			hazard_descriptions: [],
			reasoning: `GROQ API returned ${response.status} - safety check skipped (fail-open)`,
			timestamp: new Date().toISOString(),
			model: MODEL
		};
	}

	const data = await response.json();
	const modelResponse = data.choices?.[0]?.message?.content || 'safe';
	const { safe, hazards, blocking_hazards } = parseResponse(modelResponse);

	const latencyMs = Date.now() - startTime;

	// Log all hazards but only reject on blocking ones
	if (hazards.length > 0) {
		console.debug(`[safety] Classification complete in ${latencyMs}ms:`, {
			safe,
			all_hazards: hazards,
			blocking_hazards,
			tokens: data.usage?.total_tokens
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
export async function classifySafetyBatch(contents: string[]): Promise<SafetyResult[]> {
	const results: SafetyResult[] = [];

	for (let i = 0; i < contents.length; i++) {
		const result = await classifySafety(contents[i]);
		results.push(result);

		// Rate limit: 30 req/min = 1 req per 2 seconds
		// Add buffer for safety
		if (i < contents.length - 1) {
			await new Promise((resolve) => setTimeout(resolve, 2100));
		}
	}

	return results;
}
