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

import { boundPromptGuardInput } from './prompt-guard-budget';
import { GroqTransportError, requestGroqChatCompletion } from './groq-transport';
import { sanitizeProviderErrorMessage } from '$lib/core/agents/provider-error';

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
 * Fail-closed sentinel returned when the guard service is unreachable.
 * score = -1 is a sentinel: real scores are [0, 1]. Callers and traces
 * can distinguish "guard unavailable" from "guard said safe" (score ~0).
 */
function unavailableResult(threshold: number, reason: string): PromptGuardResult {
	console.error(
		`[prompt-guard] Guard unavailable — holding content: ${sanitizeProviderErrorMessage(reason)}`
	);
	return {
		safe: false,
		score: -1,
		threshold,
		timestamp: new Date().toISOString(),
		model: 'llama-prompt-guard-2-86m'
	};
}

/**
 * Detect prompt injection attacks using Llama Prompt Guard 2
 *
 * Fail-closed design: if GROQ is down, rate-limited, or returns garbage,
 * the function returns safe=false with score=-1 (sentinel). Pipeline wrappers
 * convert that sentinel into an availability error, so unavailable moderation
 * can never be mistaken for a safe decision.
 *
 * @param content - User input to check for injection attempts
 * @param threshold - Score threshold (default 0.5, higher = more permissive)
 * @returns PromptGuardResult with score and classification
 * Inputs longer than the model's reviewed window are truncated before classification.
 */
export async function detectPromptInjection(
	content: string,
	threshold: number = DEFAULT_THRESHOLD,
	options: { signal?: AbortSignal } = {}
): Promise<PromptGuardResult> {
	const guarded = boundPromptGuardInput(content);
	if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
		throw new RangeError('Prompt-guard threshold must be between 0 and 1');
	}

	const startTime = Date.now();

	let data: Record<string, unknown>;
	try {
		data = await requestGroqChatCompletion<Record<string, unknown>>(
			{
				model: MODEL,
				messages: [{ role: 'user', content: guarded }],
				temperature: 0,
				max_tokens: 16
			},
			{
				signal: options.signal
			}
		);
	} catch (err) {
		if (
			err !== null &&
			typeof err === 'object' &&
			'name' in err &&
			(err as { name?: unknown }).name === 'AbortError'
		) {
			throw err;
		}
		// 403 on Groq for prompt-guard models is almost always a model-permission
		// block at the org or project level (see
		// https://console.groq.com/docs/model-permissions). Surface the specific
		// code so an operator can flip the right toggle instead of chasing a
		// generic "GROQ 403". Other 4xx/5xx fall through to a plain log.
		if (err instanceof GroqTransportError && err.status === 403) {
			const code = err.code ? sanitizeProviderErrorMessage(err.code) : undefined;
			const remediation =
				code === 'model_permission_blocked_org'
					? 'org admin must enable meta-llama/llama-prompt-guard-2-86m at console.groq.com/settings'
					: code === 'model_permission_blocked_project'
						? 'project admin must enable meta-llama/llama-prompt-guard-2-86m for this Groq project'
						: 'check Groq API key scope and model permissions';
			console.error(
				`[prompt-guard] LAYER 1 MODERATION DISABLED — Groq 403${code ? ` (${code})` : ''}: ${remediation}`
			);
		}
		return unavailableResult(threshold, sanitizeProviderErrorMessage(err));
	}

	const scoreValue = (data.choices as Array<{ message?: { content?: unknown } }>)?.[0]?.message
		?.content;
	const scoreString = typeof scoreValue === 'string' ? scoreValue.trim() : '';
	const exactDecimal = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu;
	const score = exactDecimal.test(scoreString) ? Number(scoreString) : Number.NaN;

	if (!Number.isFinite(score) || score < 0 || score > 1) {
		return unavailableResult(
			threshold,
			sanitizeProviderErrorMessage(`GROQ returned invalid score: "${scoreString}"`)
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
export async function isPromptInjection(
	content: string,
	options: { signal?: AbortSignal } = {}
): Promise<boolean> {
	const result = await detectPromptInjection(content, DEFAULT_THRESHOLD, options);
	return !result.safe;
}
