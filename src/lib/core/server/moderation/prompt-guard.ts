/**
 * Llama Prompt Guard 2 via GROQ
 *
 * Prompt injection and jailbreak detection for agent protection.
 * Returns probability score (0-1) where higher = more likely attack.
 *
 * Performance (86M model):
 * - 99.8% AUC for English jailbreak detection
 * - 97.5% recall at 1% false positive rate
 * - 81.2% attack prevention rate
 *
 * Rate limits (Free tier):
 * - 30 requests/minute
 * - 14,400 requests/day
 *
 * @see https://console.groq.com/docs/model/meta-llama/llama-prompt-guard-2-86m
 */

import { env } from '$env/dynamic/private';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'meta-llama/llama-prompt-guard-2-86m';

/**
 * Default threshold for prompt injection detection.
 * Based on testing:
 * - Safe civic speech: 0.001-0.002 (0.1-0.2%)
 * - System prompt extraction: 0.59-0.999 (59-99%)
 * - [SYSTEM] override attacks: 0.999 (99.9%)
 *
 * Threshold of 0.5 catches obvious attacks while allowing borderline cases.
 * For stricter protection, use 0.3. For more permissive, use 0.7.
 */
const DEFAULT_THRESHOLD = 0.5;

export interface PromptGuardResult {
	/** Whether input is likely safe (below threshold) */
	safe: boolean;
	/** Raw probability score: 0-1 from model, or -1 if guard was unavailable */
	score: number;
	/** Threshold used for classification */
	threshold: number;
	/** Classification timestamp */
	timestamp: string;
	/** Model used */
	model: 'llama-prompt-guard-2-86m';
}

/**
 * Fail-open result returned when the guard service is unreachable.
 * score = -1 is a sentinel: real scores are [0, 1]. Callers and traces
 * can distinguish "guard unavailable" from "guard said safe" (score ~0).
 */
function unavailableResult(threshold: number, reason: string): PromptGuardResult {
	console.error(`[prompt-guard] Guard unavailable — failing open: ${reason}`);
	return {
		safe: true,
		score: -1,
		threshold,
		timestamp: new Date().toISOString(),
		model: 'llama-prompt-guard-2-86m'
	};
}

/**
 * Detect prompt injection attacks using Llama Prompt Guard 2
 *
 * Fail-open design: if GROQ is down, rate-limited, or returns garbage,
 * the function returns safe=true with score=-1 (sentinel). A third-party
 * outage must never become a denial-of-service against our own users.
 * The guard protects agents from manipulation — it is not a user-blocking gate.
 *
 * @param content - User input to check for injection attempts
 * @param threshold - Score threshold (default 0.5, higher = more permissive)
 * @returns PromptGuardResult with score and classification (never throws)
 */
export async function detectPromptInjection(
	content: string,
	threshold: number = DEFAULT_THRESHOLD
): Promise<PromptGuardResult> {
	const apiKey = env.GROQ_API_KEY;

	if (!apiKey) {
		console.warn('[prompt-guard] GROQ_API_KEY not configured, allowing by default');
		return unavailableResult(threshold, 'GROQ_API_KEY not configured');
	}

	const startTime = Date.now();

	// Prompt Guard 2 has 512 token context limit
	// Truncate long inputs to avoid context overflow
	const truncatedContent = content.slice(0, 2000);

	let response: Response;
	try {
		response = await fetch(GROQ_API_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: MODEL,
				messages: [{ role: 'user', content: truncatedContent }],
				temperature: 0
			})
		});
	} catch (err) {
		return unavailableResult(threshold, `fetch failed: ${err instanceof Error ? err.message : err}`);
	}

	if (!response.ok) {
		const errorText = await response.text().catch(() => '(unreadable)');
		return unavailableResult(threshold, `GROQ ${response.status}: ${errorText.slice(0, 200)}`);
	}

	let data: Record<string, unknown>;
	try {
		data = await response.json();
	} catch {
		return unavailableResult(threshold, 'GROQ returned unparseable JSON');
	}

	const scoreString = (data.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content || '0';
	const score = parseFloat(scoreString);

	if (Number.isNaN(score)) {
		// Cap echoed Groq response to 200 chars to bound log volume on
		// adversarial / pathological API output (matches the sibling
		// errorText path at line 114). (cure shipped).
		return unavailableResult(
			threshold,
			`GROQ returned non-numeric score: "${scoreString.slice(0, 200)}"`,
		);
	}

	const latencyMs = Date.now() - startTime;
	const safe = score < threshold;

	console.debug(`[prompt-guard] Detection complete in ${latencyMs}ms:`, {
		safe,
		score: score.toFixed(4),
		threshold
	});

	return {
		safe,
		score,
		threshold,
		timestamp: new Date().toISOString(),
		model: 'llama-prompt-guard-2-86m'
	};
}

/**
 * Check if content contains prompt injection (convenience function)
 *
 * @param content - User input to check
 * @returns true if injection detected
 */
export async function isPromptInjection(content: string): Promise<boolean> {
	const result = await detectPromptInjection(content);
	return !result.safe;
}
