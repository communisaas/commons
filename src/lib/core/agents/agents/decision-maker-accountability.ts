/**
 * Phase 4: Accountability & Classification Agent
 *
 * Takes validated decision-makers from Phase 3 output and generates:
 * - Accountability opener per person (factual, specific, 1-2 sentences)
 * - Role category classification per person
 * - Relevance rank (1 = most direct power)
 * - Public actions per person
 * - Personal prompt for the template (one question for all recipients)
 *
 * This is a single non-agentic LLM call using generateWithThoughts().
 * No function calling, no search tools. Pure structured reasoning.
 *
 * Phase 4 failure is NON-FATAL. If it fails, the pipeline continues
 * without openers and the UI handles null openers gracefully.
 */

import { generateWithThoughts } from '../gemini-client';
import { extractJsonFromGroundingResponse, isSuccessfulExtraction } from '../utils/grounding-json';
import {
	ACCOUNTABILITY_OPENER_PROMPT,
	buildAccountabilityPrompt
} from '../prompts/accountability-opener';
import { cleanThoughtForDisplay } from '../utils/thought-filter';
import type { ThoughtEmitter } from '$lib/core/thoughts/emitter';
import type { TokenUsage } from '../types';
import type { RoleCategory } from '$lib/types/template';

// ============================================================================
// Types
// ============================================================================

/** Per-person accountability data returned by Phase 4 */
export interface AccountabilityOpener {
	accountabilityOpener: string;
	roleCategory: RoleCategory;
	relevanceRank: number;
	publicActions: string[];
}

/** Full result from Phase 4 accountability generation */
export interface AccountabilityResult {
	openers: Map<string, AccountabilityOpener>;
	personalPrompt: string;
	tokenUsage?: TokenUsage;
}

/** Raw JSON response shape from the LLM */
interface AccountabilityLLMResponse {
	openers: Array<{
		name: string;
		accountability_opener: string;
		role_category: string;
		relevance_rank: number;
		public_actions: string[];
	}>;
	personal_prompt: string;
}

/** Context required for accountability generation */
export interface AccountabilityContext {
	subjectLine: string;
	coreMessage: string;
	topics: string[];
	decisionMakers: Array<{
		name: string;
		title: string;
		organization: string;
		reasoning: string;
	}>;
}

// ============================================================================
// Constants
// ============================================================================

const VALID_ROLE_CATEGORIES: Set<string> = new Set([
	'votes',
	'executes',
	'shapes',
	'funds',
	'oversees'
]);

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generate accountability openers and role classifications for decision-makers.
 *
 * Makes ONE LLM call to generate all openers + classifications.
 * Uses the same generateWithThoughts() pattern as Phase 2a — non-agentic,
 * single call, structured JSON output.
 *
 * @param context - Issue context and validated decision-makers
 * @param emitter - ThoughtEmitter for streaming updates to the UI
 * @returns AccountabilityResult with openers map and personal prompt
 * @throws Error if LLM call fails or response is unparseable
 */
export async function generateAccountabilityOpeners(
	context: AccountabilityContext,
	emitter: ThoughtEmitter
): Promise<AccountabilityResult> {
	const { subjectLine, coreMessage, topics, decisionMakers } = context;

	if (decisionMakers.length === 0) {
		return {
			openers: new Map(),
			personalPrompt: ''
		};
	}

	// 1. Build prompts
	const currentDate = new Date().toISOString().split('T')[0];
	const systemPrompt = ACCOUNTABILITY_OPENER_PROMPT.replace(/{CURRENT_DATE}/g, currentDate);
	const userPrompt = buildAccountabilityPrompt(subjectLine, coreMessage, topics, decisionMakers);

	console.debug(
		`[decision-maker-accountability] Phase 4: Generating openers for ${decisionMakers.length} decision-makers`
	);

	// 2. Single LLM call — generateWithThoughts, NOT agentic
	const result = await generateWithThoughts<AccountabilityLLMResponse>(
		userPrompt,
		{
			stage: 'decision-accountability',
			systemInstruction: systemPrompt,
			temperature: 0.2,
			thinkingLevel: 'medium'
		},
		(thought) => {
			const cleaned = cleanThoughtForDisplay(thought);
			if (cleaned) {
				emitter.think(cleaned);
			}
		}
	);

	// 3. Parse JSON response
	const extraction = extractJsonFromGroundingResponse<AccountabilityLLMResponse>(
		result.rawText || '{}'
	);

	if (!isSuccessfulExtraction(extraction) || !extraction.data?.openers?.length) {
		console.error(
			'[decision-maker-accountability] Phase 4: Failed to parse accountability response',
			extraction.error
		);
		throw new Error(
			`Accountability generation failed: ${extraction.error || 'empty response'}`
		);
	}

	const parsed = extraction.data;

	// 4. Map results — keyed by name for O(1) lookup in orchestrator
	const openers = new Map<string, AccountabilityOpener>();

	for (const opener of parsed.openers) {
		// Validate role category — fall back to 'shapes' if invalid
		const roleCategory = VALID_ROLE_CATEGORIES.has(opener.role_category)
			? (opener.role_category as RoleCategory)
			: 'shapes';

		openers.set(opener.name, {
			accountabilityOpener: opener.accountability_opener || '',
			roleCategory,
			relevanceRank: typeof opener.relevance_rank === 'number' ? opener.relevance_rank : 99,
			publicActions: Array.isArray(opener.public_actions) ? opener.public_actions : []
		});
	}

	console.debug(
		`[decision-maker-accountability] Phase 4: Generated ${openers.size} openers, ` +
			`categories: ${[...openers.values()].map((o) => o.roleCategory).join(', ')}`
	);

	return {
		openers,
		personalPrompt: parsed.personal_prompt || '',
		tokenUsage: result.tokenUsage
	};
}
