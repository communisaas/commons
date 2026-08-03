/**
 * Unified Moderation Pipeline - Permissive Civic Platform
 *
 * Two-layer moderation optimized for multi-stakeholder civic engagement:
 *
 * Layer 0: Llama Prompt Guard 2 (via GROQ) - REQUIRED
 *   - Prompt injection/jailbreak detection
 *   - Protects AI agents from manipulation attacks
 *   - 99.8% AUC for jailbreak detection
 *
 * Layer 1: `openai/gpt-oss-safeguard-20b` (via GROQ) - REQUIRED unless explicitly skipped by a trusted caller
 *   - MLCommons S1-S14 hazard taxonomy
 *   - PERMISSIVE: Only S1 (threats) and S4 (CSAM) block content
 *   - Political speech, defamation claims, electoral opinions ALLOWED
 *
 * Design principle: Be PERMISSIVE with user speech.
 * Platform serves ANY decision-maker (Congress, corporations, HOAs, etc.)
 * The real threat is prompt injection, not controversial opinions.
 */

import { classifySafety } from './llama-guard';
import { detectPromptInjection } from './prompt-guard';
import type {
	ModerationResult,
	SafetyResult,
	PromptGuardResult,
	TemplateModerationInput
} from './types';

// Re-export types for external consumers
export type { ModerationResult, SafetyResult, PromptGuardResult, TemplateModerationInput };
export type { MLCommonsHazard } from './types';
export { HAZARD_DESCRIPTIONS, BLOCKING_HAZARDS, NON_BLOCKING_HAZARDS } from './types';
export { classifySafety } from './llama-guard';
export { detectPromptInjection, isPromptInjection } from './prompt-guard';

/**
 * Moderation options
 */
export interface ModerationOptions {
	/** Skip prompt injection check (default: false) */
	skipPromptGuard?: boolean;
	/** Skip content safety check (default: false) */
	skipSafety?: boolean;
	/** Prompt injection threshold (default: 0.5, higher = more permissive) */
	injectionThreshold?: number;
	/** Abort both Groq calls when the owning request/job is cancelled. */
	signal?: AbortSignal;
}

/**
 * Compose the exact string the moderation layers review.
 *
 * Invariant: every non-blank author field appears in the returned content at
 * least once, and nothing is ever truncated. A field is skipped only when its
 * full trimmed text is already present in what has accumulated, so the omitted
 * bytes are still classified — no author string can escape review by being made
 * a substring of another.
 */
export function buildTemplateModerationContent(input: TemplateModerationInput): string {
	const segments: string[] = [];
	let content = '';

	for (const field of ['title', 'message_body', 'description', 'preview'] as const) {
		const value = input[field].trim();
		if (!value || content.includes(value)) continue;
		segments.push(value);
		content = segments.join('\n\n');
	}

	return content;
}

/**
 * Moderate template through the full pipeline
 *
 * Pipeline order:
 * 1. Prompt injection detection (blocks agent manipulation)
 * 2. Content safety (only S1/S4 block - threats, CSAM)
 *
 * @param template - Template content to moderate
 * @param options - Moderation options
 * @returns ModerationResult with all layer assessments
 */
export async function moderateTemplate(
	template: TemplateModerationInput,
	options: ModerationOptions = {}
): Promise<ModerationResult> {
	const startTime = Date.now();

	// Combine every publicly-served author field for comprehensive analysis
	const content = buildTemplateModerationContent(template);

	// =========================================================================
	// Layer 0: Prompt Injection Detection (REQUIRED)
	// Protects AI agents from manipulation attacks
	// =========================================================================
	if (!options.skipPromptGuard) {
		const promptGuard = await detectPromptInjection(content, options.injectionThreshold, {
			signal: options.signal
		});
		if (promptGuard.score < 0) {
			throw new Error('Prompt-injection moderation is unavailable');
		}

		if (!promptGuard.safe) {
			const latencyMs = Date.now() - startTime;
			console.log('[moderation] Template REJECTED - prompt injection detected:', {
				score: promptGuard.score.toFixed(4),
				threshold: promptGuard.threshold,
				latencyMs
			});

			return {
				approved: false,
				rejection_reason: 'prompt_injection',
				prompt_guard: promptGuard,
				summary: `Blocked: Detected potential prompt injection (score: ${(promptGuard.score * 100).toFixed(1)}%)`,
				latency_ms: latencyMs
			};
		}
	}

	// =========================================================================
	// Layer 1: Content Safety (PERMISSIVE POLICY, FAIL-CLOSED AVAILABILITY)
	// Only S1 (threats) and S4 (CSAM) actually block content
	// =========================================================================
	let safety: SafetyResult | undefined;

	if (!options.skipSafety) {
		safety = await classifySafety(content, { signal: options.signal });

		// Only block on BLOCKING_HAZARDS (S1, S4)
		if (!safety.safe) {
			const latencyMs = Date.now() - startTime;
			console.log('[moderation] Template REJECTED - illegal content detected:', {
				blocking_hazards: safety.blocking_hazards,
				all_hazards: safety.hazards,
				latencyMs
			});

			// Capture safety in local const to preserve TypeScript narrowing in closure
			const safetyResult = safety;
			const hazardDescriptions = safetyResult.blocking_hazards
				.map((h) => safetyResult.hazard_descriptions[safetyResult.hazards.indexOf(h)])
				.join(', ');

			return {
				approved: false,
				rejection_reason: 'safety_violation',
				safety,
				summary: `Blocked: ${hazardDescriptions}`,
				latency_ms: latencyMs
			};
		}

		// Log non-blocking hazards for analytics (but allow content)
		if (safety.hazards.length > 0) {
			console.log('[moderation] Non-blocking hazards detected (allowed):', {
				hazards: safety.hazards,
				descriptions: safety.hazard_descriptions
			});
		}
	}

	const latencyMs = Date.now() - startTime;

	console.log('[moderation] Template APPROVED:', {
		safetyModel: safety?.model || 'skipped',
		nonBlockingHazards: safety?.hazards.length || 0,
		latencyMs
	});

	return {
		approved: true,
		safety,
		summary: 'Approved',
		latency_ms: latencyMs
	};
}

/**
 * Prompt injection check only (fastest, lowest cost)
 *
 * Use for real-time validation of user input before it reaches agents.
 * This is the CRITICAL security layer.
 *
 * @param content - User input to check
 * @returns PromptGuardResult with score and classification
 */
export async function moderatePromptOnly(
	content: string,
	threshold?: number,
	options: { signal?: AbortSignal } = {}
): Promise<PromptGuardResult> {
	const result = await detectPromptInjection(content, threshold, options);
	if (result.score < 0) throw new Error('Prompt-injection moderation is unavailable');
	return result;
}

/**
 * Moderate user-supplied personalization text at send time.
 *
 * Prompt Guard + Llama Guard only. The template itself was already
 * moderated at creation time — this only checks the user's
 * personalization delta (e.g., [Personal Connection]).
 *
 * Designed for send-time latency: target < 500ms total.
 *
 * @param text - User-supplied personalization text
 * @returns ModerationResult (approved/rejected with reason)
 */
export async function moderatePersonalization(
	text: string,
	options: { signal?: AbortSignal } = {}
): Promise<ModerationResult> {
	const startTime = Date.now();

	// Skip empty text — nothing to moderate
	if (!text || text.trim().length === 0) {
		return {
			approved: true,
			summary: 'Empty personalization — skipped',
			latency_ms: Date.now() - startTime
		};
	}

	// Layer 0: Prompt injection detection
	const promptGuard = await detectPromptInjection(text, undefined, options);
	if (promptGuard.score < 0) {
		throw new Error('Prompt-injection moderation is unavailable');
	}

	if (!promptGuard.safe) {
		const latencyMs = Date.now() - startTime;
		console.log('[moderation] Personalization REJECTED — prompt injection:', {
			score: promptGuard.score.toFixed(4),
			latencyMs
		});

		return {
			approved: false,
			rejection_reason: 'prompt_injection',
			prompt_guard: promptGuard,
			summary: `Blocked: Detected potential prompt injection in personalization (score: ${(promptGuard.score * 100).toFixed(1)}%)`,
			latency_ms: latencyMs
		};
	}

	// Layer 1: Content safety (only S1/S4 block)
	const safety = await classifySafety(text, options);

	if (!safety.safe) {
		const latencyMs = Date.now() - startTime;
		console.log('[moderation] Personalization REJECTED — safety:', {
			blocking_hazards: safety.blocking_hazards,
			latencyMs
		});

		const safetyResult = safety;
		const hazardDescriptions = safetyResult.blocking_hazards
			.map((h) => safetyResult.hazard_descriptions[safetyResult.hazards.indexOf(h)])
			.join(', ');

		return {
			approved: false,
			rejection_reason: 'safety_violation',
			safety,
			summary: `Blocked: ${hazardDescriptions}`,
			latency_ms: latencyMs
		};
	}

	const latencyMs = Date.now() - startTime;
	console.log('[moderation] Personalization APPROVED:', { latencyMs });

	return {
		approved: true,
		safety,
		summary: 'Approved',
		latency_ms: latencyMs
	};
}
