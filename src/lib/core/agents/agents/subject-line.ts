/**
 * Subject Line Generator Agent
 *
 * Transforms raw issue descriptions into structured subject lines with
 * clarification follow-up support via Gemini Interactions API.
 *
 * Design:
 * - Agent has full autonomy to formulate clarifying questions
 * - Answers are flexible key-value pairs, interpreted by the agent
 * - Conversation, not forms
 */

import { z } from 'zod';
import { interact } from '../gemini-client';
import { SUBJECT_LINE_SCHEMA } from '../schemas';
import { SUBJECT_LINE_PROMPT } from '../prompts/subject-line';
import type {
	SubjectLineResponseWithClarification,
	ConversationContext,
	TokenUsage
} from '../types';

// ============================================================================
// Zod Schema for Runtime Validation
// ============================================================================

const ClarificationQuestionSchema = z.object({
	id: z.string(),
	question: z.string(),
	type: z.enum(['location_picker', 'open_text', 'multiple_choice']),
	placeholder: z.string().optional(),
	location_level: z.enum(['city', 'state', 'country']).optional(),
	suggested_locations: z.array(z.string()).optional(),
	options: z
		.array(z.object({ id: z.string(), label: z.string() }))
		.min(2)
		.max(4)
		.optional(),
	allow_other: z.boolean().optional(),
	required: z.boolean()
});

const InferredContextSchema = z.object({
	detected_location: z.string().nullable(),
	detected_scope: z.enum(['local', 'state', 'national', 'international']).nullable(),
	detected_target_type: z.enum(['government', 'corporate', 'institutional', 'other']).nullable(),
	detected_urgency: z.enum(['breaking', 'recent', 'ongoing', 'structural']).nullable().optional(),
	urgency_confidence: z.number().min(0).max(1).optional(),
	detected_ask: z.string().nullable().optional(),
	location_confidence: z.number().min(0).max(1),
	scope_confidence: z.number().min(0).max(1),
	target_type_confidence: z.number().min(0).max(1),
	reasoning: z.string()
});

const SubjectLineResponseSchema = z.object({
	needs_clarification: z.boolean(),
	clarification_questions: z.array(ClarificationQuestionSchema).optional(),
	subject_line: z.string().optional(),
	core_message: z.string().optional(),
	topics: z.array(z.string()).optional(),
	url_slug: z.string().optional(),
	voice_sample: z.string().optional(),
	detected_ask: z.string().nullable().optional(),
	inferred_context: InferredContextSchema
});

export interface GenerateSubjectOptions {
	description: string;
	previousInteractionId?: string;
	/** Full context for clarification turns */
	conversationContext?: ConversationContext;
	/** Abort in-flight Gemini work when the owning request is cancelled. */
	signal?: AbortSignal;
}

export interface GenerateSubjectResult {
	data: SubjectLineResponseWithClarification;
	interactionId: string;
	tokenUsage?: TokenUsage;
}

/**
 * Generate a subject line with structured metadata
 *
 * Supports a two-turn clarification flow:
 * 1. First call: Pass description, may get clarification questions or output
 * 2. Clarification: Pass conversationContext carrying the questions and answers
 *
 * The agent maintains conversation state across turns.
 */
/**
 * Build a turn-2 prompt from conversation context.
 * Shared between the non-streaming agent and the streaming endpoint.
 */
export function buildClarificationPrompt(ctx: ConversationContext): string {
	const answerLines = Object.entries(ctx.answers)
		.filter(([, v]: [string, string]) => v?.trim())
		.map(([questionId, answer]: [string, string]) => {
			const question = ctx.questionsAsked.find((q) => q.id === questionId);
			if (!question) return `- "${questionId}": ${answer}`;

			// For multiple_choice: handle multi-select (answers delimited by |||)
			if (question.type === 'multiple_choice' && question.options?.length) {
				const DELIMITER = '|||';
				const parts = answer.includes(DELIMITER)
					? answer.split(DELIMITER).map((s) => s.trim())
					: [answer];

				// Partition into matched options and custom text
				const selectedLabels: string[] = [];
				const customTexts: string[] = [];
				for (const part of parts) {
					if (question.options.some((o) => o.label === part)) {
						selectedLabels.push(part);
					} else if (part) {
						customTexts.push(part);
					}
				}

				const rejected = question.options
					.filter((o) => !selectedLabels.includes(o.label))
					.map((o) => o.label);

				const selectedStr =
					selectedLabels.length > 0
						? `Selected: ${selectedLabels.map((l) => `"${l}"`).join(', ')}`
						: '';
				const customStr =
					customTexts.length > 0
						? `Also wrote: ${customTexts.map((t) => `"${t}"`).join(', ')}`
						: '';
				const rejectedStr = rejected.length > 0 ? `(not: ${rejected.join('; ')})` : '';

				return `- "${question.question}": ${[selectedStr, customStr, rejectedStr].filter(Boolean).join(' ')}`;
			}

			return `- "${question.question}": ${answer}`;
		})
		.join('\n');

	return `## Original Issue
${ctx.originalDescription}

## Clarification Conversation

I asked:
${ctx.questionsAsked.map((q) => `- ${q.question}`).join('\n')}

User clarified:
${answerLines || '(User skipped - use your best judgment based on the original issue)'}

## My Previous Analysis
- Detected location: ${ctx.inferredContext.detected_location || 'unknown'}
- Detected scope: ${ctx.inferredContext.detected_scope || 'unknown'}
- Detected target: ${ctx.inferredContext.detected_target_type || 'unknown'}
- Reasoning: ${ctx.inferredContext.reasoning || 'none'}

Now generate the final subject_line, core_message, topics, url_slug, and voice_sample using this complete context.
Do not ask for more clarification - generate the output now.`;
}

export async function generateSubjectLine(
	options: GenerateSubjectOptions
): Promise<GenerateSubjectResult> {
	let prompt: string;

	if (options.conversationContext) {
		prompt = buildClarificationPrompt(options.conversationContext);
	} else {
		// Initial generation
		prompt = `Analyze this issue and generate a subject line:

${options.description}`;
	}

	// Inject temporal context
	const currentDate = new Date().toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
	const currentYear = String(new Date().getFullYear());
	const systemPrompt = SUBJECT_LINE_PROMPT.replace('{CURRENT_DATE}', currentDate).replace(
		'{CURRENT_YEAR}',
		currentYear
	);

	const response = await interact(prompt, {
		stage: 'subject-line',
		systemInstruction: systemPrompt,
		responseSchema: SUBJECT_LINE_SCHEMA,
		temperature: 0.7, // Creative latitude for sharp, resonant lines
		thinkingLevel: 'low', // Issue extraction + a short subject line — low reasoning is sufficient and avoids over-elaboration
		previousInteractionId: options.previousInteractionId,
		signal: options.signal
	});

	const pipelineTokenUsage: TokenUsage | undefined = response.tokenUsage;

	// Parse and validate the response
	const parsed = JSON.parse(response.outputs);
	const validationResult = SubjectLineResponseSchema.safeParse(parsed);

	if (!validationResult.success) {
		console.error('[subject-line] Invalid structured response:', {
			issueCount: validationResult.error.issues.length
		});
		throw new Error('Invalid subject line response: invalid structured response');
	}

	const data = validationResult.data as SubjectLineResponseWithClarification;

	// Validate: if needs_clarification is true but no questions provided, override to false
	// This handles cases where the agent hedges (says it needs clarification but doesn't ask)
	if (
		data.needs_clarification &&
		(!data.clarification_questions || data.clarification_questions.length === 0)
	) {
		console.debug(
			'[subject-line] Agent said needs_clarification but provided no questions - overriding to false'
		);
		data.needs_clarification = false;
	}

	// A schema-valid but semantically empty response is a local/model-quality
	// failure. Retrying it under the same reservation used to double paid work;
	// the caller may submit a new, separately admitted request instead.
	if (!data.needs_clarification && !data.subject_line) {
		throw new Error('Subject-line provider returned no usable subject line');
	}

	console.debug('[subject-line] Result:', {
		needs_clarification: data.needs_clarification,
		question_count: data.clarification_questions?.length ?? 0,
		has_subject_line: !!data.subject_line
	});

	return {
		data,
		interactionId: response.id,
		tokenUsage: pipelineTokenUsage
	};
}
