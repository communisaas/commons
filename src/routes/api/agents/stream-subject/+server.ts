/**
 * Streaming Subject Line Generation API
 *
 * POST /api/agents/stream-subject
 *
 * Returns Server-Sent Events (SSE) stream with:
 * - thought: Model's reasoning summaries (streamed in real-time)
 * - complete: Final structured output
 * - error: Error message if generation fails
 *
 * Perceptual Engineering: Instead of a spinner, users see the agent
 * "thinking out loud" - building accurate mental model of system behavior.
 *
 * Key insight: responseMimeType='application/json' suppresses thoughts.
 * Solution: Use generateStreamWithThoughts which doesn't use responseMimeType
 * and parses JSON manually, allowing thoughts to flow through.
 *
 * Rate Limiting: 5/hour for guests, 15/hour for authenticated, 30/hour for verified.
 */

import type { RequestHandler } from './$types';
import { generateStreamWithThoughts } from '$lib/core/agents/gemini-client';
import { SUBJECT_LINE_PROMPT } from '$lib/core/agents/prompts/subject-line';
import { SUBJECT_LINE_SCHEMA } from '$lib/core/agents/schemas';
import { buildClarificationPrompt } from '$lib/core/agents/agents/subject-line';
import type { ConversationContext } from '$lib/core/agents/types';
import { cleanThoughtForDisplay } from '$lib/core/agents/utils/thought-filter';
import type { SubjectLineResponseWithClarification, TokenUsage } from '$lib/core/agents/types';
import { createSSEStream, SSE_HEADERS } from '$lib/server/sse-stream';
import {
	enforceLLMRateLimit,
	rateLimitResponse,
	addRateLimitHeaders,
	getUserContext,
	logLLMOperation
} from '$lib/server/llm-cost-protection';
import { moderatePromptOnly } from '$lib/core/server/moderation';

interface RequestBody {
	message: string;
	conversationContext?: ConversationContext;
}

export const POST: RequestHandler = async (event) => {
	const rateLimitCheck = await enforceLLMRateLimit(event, 'subject-line');
	if (!rateLimitCheck.allowed) {
		return rateLimitResponse(rateLimitCheck);
	}
	const userContext = getUserContext(event);
	const startTime = Date.now();
	const traceId = crypto.randomUUID();

	let body: RequestBody;
	try {
		body = (await event.request.json()) as RequestBody;
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid request body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!body.message?.trim()) {
		return new Response(JSON.stringify({ error: 'Message is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	console.log('[stream-subject] trace:', {
		traceId,
		userId: userContext.userId,
		messageLength: body.message.length
	});

	// Prompt injection detection
	const injectionCheck = await moderatePromptOnly(body.message);
	if (!injectionCheck.safe) {
		console.log('[stream-subject] Prompt injection detected:', {
			score: injectionCheck.score.toFixed(4),
			threshold: injectionCheck.threshold
		});
		return new Response(
			JSON.stringify({ error: 'Content flagged by safety filter', code: 'PROMPT_INJECTION_DETECTED' }),
			{
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}

	const prompt = body.conversationContext
		? buildClarificationPrompt(body.conversationContext)
		: `Analyze this issue and generate a subject line:\n\n${body.message}`;

	// Inject temporal context into system prompt
	const currentDate = new Date().toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
	const currentYear = String(new Date().getFullYear());
	const systemPrompt = SUBJECT_LINE_PROMPT.replace('{CURRENT_DATE}', currentDate).replace(
		'{CURRENT_YEAR}',
		currentYear
	) + `\n\n## RESPONSE SCHEMA\n\nYour JSON output MUST conform to this exact structure:\n${JSON.stringify(SUBJECT_LINE_SCHEMA, null, 2)}`;

	const { stream, emitter } = createSSEStream({
		traceId,
		endpoint: 'subject-line',
		userId: userContext.userId
	});

	(async () => {
		let streamSuccess = false;
		let resultTokenUsage: TokenUsage | undefined;

		try {
			const generator = generateStreamWithThoughts<SubjectLineResponseWithClarification>(prompt, {
				systemInstruction: systemPrompt,
				temperature: 0.4,
				thinkingLevel: 'high'
			});

			let iterResult = await generator.next();

			while (!iterResult.done) {
				const chunk = iterResult.value;

				switch (chunk.type) {
					case 'thought':
						emitter.send('thought', {
							content: cleanThoughtForDisplay(chunk.content)
						});
						break;

					case 'text':
						// Don't stream partial JSON - wait for complete
						break;

					case 'complete':
						// Final parsing happens in generator return value
						break;

					case 'error':
						emitter.error(chunk.content);
						break;
				}

				iterResult = await generator.next();
			}

			// Get the final parsed result from the generator
			if (iterResult.done && iterResult.value) {
				const result = iterResult.value;
				resultTokenUsage = result.tokenUsage;

				if (result.parseSuccess && result.data) {
					const data = result.data;

					// Validate: if needs_clarification but no questions, override
					if (
						data.needs_clarification &&
						(!data.clarification_questions || data.clarification_questions.length === 0)
					) {
						data.needs_clarification = false;
					}

					if (data.needs_clarification) {
						emitter.send('clarification', { data });
						console.log('[stream-subject] clarification:', {
							traceId,
							questionCount: data.clarification_questions?.length ?? 0
						});
					} else {
						emitter.complete({ data });
						console.log('[stream-subject] generation:', {
							traceId,
							hasSubjectLine: !!data.subject_line,
							topicCount: data.topics?.length ?? 0
						});
					}
					streamSuccess = true;
				} else {
					console.error('[stream-subject] JSON parse error:', result.parseError);
					emitter.error('Failed to parse response');
				}
			}
		} catch (error) {
			console.error('[stream-subject] Stream error:', error);
			emitter.error(error instanceof Error ? error.message : 'Generation failed');
		} finally {
			logLLMOperation(
				'subject-line',
				userContext,
				{
					durationMs: Date.now() - startTime,
					success: streamSuccess,
					tokenUsage: resultTokenUsage
				},
				traceId
			);
			emitter.close();
		}
	})().catch((err) => {
		console.error('[stream-subject] Unhandled IIFE error:', err);
		try { emitter.error('Internal error'); emitter.close(); } catch { /* already closed */ }
	});

	const headers = new Headers(SSE_HEADERS);
	addRateLimitHeaders(headers, rateLimitCheck);

	return new Response(stream, { headers });
};

