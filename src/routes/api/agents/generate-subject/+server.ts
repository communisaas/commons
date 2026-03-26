/**
 * Non-streaming Subject Line Generation API
 *
 * POST /api/agents/generate-subject
 *
 * Used for clarification follow-ups where streaming thoughts
 * aren't needed — the user already saw the thinking on turn 1.
 *
 * Rate Limiting: 5/hour for guests, 15/hour for authenticated, 30/hour for verified.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateSubjectLine } from '$lib/core/agents/agents/subject-line';
import type { ConversationContext } from '$lib/core/agents/types';
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
	interactionId?: string;
	clarificationAnswers?: Record<string, string>;
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
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	if (!body.message?.trim()) {
		return json({ error: 'Message is required' }, { status: 400 });
	}

	traceRequest(traceId, 'subject-line', {
		metadata: {
			messageLength: body.message.length,
			hasConversationContext: !!body.conversationContext,
			turn: body.conversationContext ? 2 : 1
		},
		content: {
			message: body.message
		}
	}, { userId: userContext.userId });

	// Prompt injection detection
	const injectionCheck = await moderatePromptOnly(body.message);
	if (!injectionCheck.safe) {
		return json(
			{ error: 'Content flagged by safety filter', code: 'PROMPT_INJECTION_DETECTED' },
			{ status: 403 }
		);
	}

	try {
		const result = await generateSubjectLine({
			description: body.message,
			conversationContext: body.conversationContext,
			previousInteractionId: body.interactionId,
			clarificationAnswers: body.clarificationAnswers
		});

		const headers = new Headers({ 'Content-Type': 'application/json' });
		addRateLimitHeaders(headers, rateLimitCheck);

		const durationMs = Date.now() - startTime;

		traceEvent(traceId, 'subject-line', 'generation', {
			subject_line: result.data.subject_line,
			core_message: result.data.core_message,
			topics: result.data.topics,
			url_slug: result.data.url_slug,
			needs_clarification: result.data.needs_clarification,
			turn: body.conversationContext ? 2 : 1
		}, { userId: userContext.userId, success: true, durationMs });

		logLLMOperation('subject-line', userContext, {
			durationMs,
			success: true,
			tokenUsage: result.tokenUsage
		}, traceId);

		return new Response(JSON.stringify(result.data), { headers });
	} catch (error) {
		const durationMs = Date.now() - startTime;
		console.error('[generate-subject] Generation failed:', error);

		logLLMOperation('subject-line', userContext, {
			durationMs,
			success: false
		}, traceId);

		return json(
			{ error: error instanceof Error ? error.message : 'Generation failed' },
			{ status: 500 }
		);
	}
};
