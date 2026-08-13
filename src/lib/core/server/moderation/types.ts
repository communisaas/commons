/**
 * Moderation Types - Target-Conditional Civic Platform Architecture
 *
 * Two-layer moderation system:
 *
 * 1. Prompt Injection Protection (REQUIRED)
 *    - Llama Prompt Guard 2 via GROQ
 *    - Protects AI agents from jailbreak/manipulation attacks
 *
 * 2. Content Safety (required at delivery/authoring boundaries)
 *    - `openai/gpt-oss-safeguard-20b` via GROQ
 *    - Government-registry targets retain the calibrated S1/S4-only policy
 *    - Other and unknown targets additionally block S5, S7, and S10
 *
 * Design principle: preserve the calibrated civic-speech policy only when a
 * server-derived government-registry classification establishes its scope.
 *
 * @see https://console.groq.com/docs/model/openai/gpt-oss-safeguard-20b
 * @see https://huggingface.co/meta-llama/Llama-Prompt-Guard-2
 */

import type { GovernmentalClass } from '$lib/core/agents/governmental-class';

// ============================================================================
// Prompt Injection Detection (Layer 0 - REQUIRED)
// ============================================================================

/**
 * Result from Llama Prompt Guard 2
 */
export interface PromptGuardResult {
	/** Whether input is safe (below injection probability threshold) */
	safe: boolean;
	/** Raw probability score: 0-1 from model, or -1 if guard was unavailable */
	score: number;
	/** Threshold used for classification */
	threshold: number;
	/** Processing timestamp */
	timestamp: string;
	/** Model used */
	model: 'llama-prompt-guard-2-86m';
}

// ============================================================================
// Content Safety (Layer 1 - REQUIRED unless a trusted caller explicitly skips it)
// ============================================================================

/**
 * MLCommons Hazard Categories (S1-S14)
 *
 * TARGET-CONDITIONAL POLICY: S1 (violent threats) and S4 (CSAM) always block.
 * S5 (defamation), S7 (privacy), and S10 (hate) additionally block unless a
 * server-derived government-registry classification is present.
 *
 * Rationale:
 * - S5 (Defamation): Political speech often contains accusations - ALLOW
 * - S10 (Hate): Edgy political speech may trigger - ALLOW
 * - S13 (Elections): Electoral opinions are protected speech - ALLOW
 */
export type MLCommonsHazard =
	| 'S1' // Violent Crimes - BLOCKS
	| 'S2' // Non-Violent Crimes - logged only
	| 'S3' // Sex-Related Crimes - logged only
	| 'S4' // Child Sexual Exploitation - BLOCKS
	| 'S5' // Defamation - logged only (political speech)
	| 'S6' // Specialized Advice - logged only
	| 'S7' // Privacy - logged only
	| 'S8' // Intellectual Property - logged only
	| 'S9' // Indiscriminate Weapons - logged only
	| 'S10' // Hate - logged only (political speech)
	| 'S11' // Suicide & Self-Harm - logged only
	| 'S12' // Sexual Content - logged only
	| 'S13' // Elections - logged only (political speech)
	| 'S14'; // Code Interpreter Abuse - logged only

/**
 * Human-readable descriptions for MLCommons hazards
 */
export const HAZARD_DESCRIPTIONS: Record<MLCommonsHazard, string> = {
	S1: 'Violent Crimes',
	S2: 'Non-Violent Crimes',
	S3: 'Sex-Related Crimes',
	S4: 'Child Sexual Exploitation',
	S5: 'Defamation',
	S6: 'Specialized Advice',
	S7: 'Privacy Violation',
	S8: 'Intellectual Property',
	S9: 'Indiscriminate Weapons',
	S10: 'Hate Speech',
	S11: 'Suicide & Self-Harm',
	S12: 'Sexual Content',
	S13: 'Electoral Misinformation',
	S14: 'Code Interpreter Abuse'
};

/**
 * Government-registry blocking hazards - content with these is rejected.
 *
 * Only truly illegal content that creates legal liability:
 * - S1: Violent threats (federal crime)
 * - S4: CSAM (federal crime, 18 USC 2252)
 */
export const BLOCKING_HAZARDS: MLCommonsHazard[] = ['S1', 'S4'];

/** Blocking hazards for non-governmental and unknown targets. */
export const NON_GOVERNMENTAL_BLOCKING_HAZARDS: MLCommonsHazard[] = ['S1', 'S4', 'S5', 'S7', 'S10'];

/**
 * Resolve the blocking policy from a server-derived registry observation.
 * Unknown or negative classifications fail closed to the stricter set; the
 * permissive set is available only when the measured verdict grants it.
 */
export function blockingHazardsForTarget(
	targetClass: GovernmentalClass | undefined
): MLCommonsHazard[] {
	return targetClass?.governmental === true ? BLOCKING_HAZARDS : NON_GOVERNMENTAL_BLOCKING_HAZARDS;
}

/**
 * Government-registry NON-BLOCKING hazards: the complement of the calibrated
 * governmental set only. Stricter target classes block S5, S7, and S10.
 *
 * These are flagged but ALLOWED because:
 * - Political speech is protected
 * - Platform is permissive by design
 * - Decision-makers can handle controversial content
 */
export const NON_BLOCKING_HAZARDS: MLCommonsHazard[] = [
	'S2',
	'S3',
	'S5',
	'S6',
	'S7',
	'S8',
	'S9',
	'S10',
	'S11',
	'S12',
	'S13',
	'S14'
];

/**
 * Safety result from the Layer 1 safety classifier.
 */
export interface SafetyResult {
	/** Content passed safety checks under the resolved target policy. */
	safe: boolean;
	/** All detected hazard categories (may include non-blocking hazards) */
	hazards: MLCommonsHazard[];
	/** Subset of hazards that caused blocking under the resolved target policy. */
	blocking_hazards: MLCommonsHazard[];
	/** Human-readable hazard descriptions */
	hazard_descriptions: string[];
	/** Raw model reasoning */
	reasoning: string;
	/** Processing timestamp */
	timestamp: string;
	/** Model used for classification */
	model: string;
}

/**
 * Combined moderation result
 */
export interface ModerationResult {
	/** Final approval decision */
	approved: boolean;
	/** Rejection reason (if not approved) */
	rejection_reason?: 'prompt_injection' | 'safety_violation';
	/** Prompt injection check result (Layer 0 - REQUIRED) */
	prompt_guard?: PromptGuardResult;
	/** Safety check result (Layer 1 - OPTIONAL) */
	safety?: SafetyResult;
	/** Human-readable summary */
	summary: string;
	/** Total processing time in ms */
	latency_ms: number;
}

/**
 * Input for template moderation.
 *
 * Every author-written field that the public surfaces serve is required here:
 * what a reader can see is what the classifiers reviewed.
 */
export interface TemplateModerationInput {
	title: string;
	description: string;
	preview: string;
	message_body: string;
}
