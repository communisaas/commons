/**
 * Non-streaming Subject Line Generation API
 *
 * POST /api/agents/generate-subject
 *
 * Used for clarification follow-ups where streaming thoughts
 * aren't needed — the user already saw the thinking on turn 1.
 *
 * Rate Limiting: 3/hour for guests, 5/hour for authenticated and verified.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateSubjectLine } from '$lib/core/agents/agents/subject-line';
import {
	enforceLLMRateLimit,
	rateLimitResponse,
	addRateLimitHeaders,
	getUserContext,
	logLLMOperation
} from '$lib/server/llm-cost-protection';
import { moderatePromptOnly } from '$lib/core/server/moderation';
import {
	agentPromptGuardContent,
	readBoundedAgentRequest
} from '$lib/server/agent-request-envelope';

export const POST: RequestHandler = async (event) => {
	const requestEnvelope = await readBoundedAgentRequest(event, 'generate-subject');
	if (requestEnvelope instanceof Response) return requestEnvelope;
	const body = requestEnvelope;

	const rateLimitCheck = await enforceLLMRateLimit(event, 'subject-line');
	if (!rateLimitCheck.allowed) {
		return rateLimitResponse(rateLimitCheck);
	}
	const userContext = getUserContext(event);
	const startTime = Date.now();
	const traceId = crypto.randomUUID();

	console.log('[generate-subject] trace:', {
		traceId,
		userId: userContext.userId,
		messageLength: body.message.length,
		hasConversationContext: !!body.conversationContext,
		turn: body.conversationContext ? 2 : 1
	});

	// Prompt injection detection over the full untrusted prompt surface
	const injectionCheck = await moderatePromptOnly(
		agentPromptGuardContent('generate-subject', body)
	);
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

		console.log('[generate-subject] generation:', {
			traceId,
			hasSubjectLine: !!result.data.subject_line,
			needsClarification: result.data.needs_clarification,
			turn: body.conversationContext ? 2 : 1,
			durationMs
		});

		logLLMOperation(
			'subject-line',
			userContext,
			{
				durationMs,
				success: true,
				tokenUsage: result.tokenUsage
			},
			traceId
		);

		return new Response(JSON.stringify(result.data), { headers });
	} catch (error) {
		const durationMs = Date.now() - startTime;
		console.error('[generate-subject] Generation failed:', error);

		logLLMOperation(
			'subject-line',
			userContext,
			{
				durationMs,
				success: false
			},
			traceId
		);

		return json(
			{ error: error instanceof Error ? error.message : 'Generation failed' },
			{ status: 500 }
		);
	}
};
