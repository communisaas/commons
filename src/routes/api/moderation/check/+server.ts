/**
 * Moderation Check API Endpoint
 *
 * Exposes the moderation pipeline for testing and validation.
 * This endpoint allows direct testing of content moderation
 * without going through the full template creation flow.
 *
 * POST /api/moderation/check
 * Body: { title: string, description: string, preview: string, message_body: string }
 * Returns: ModerationResult
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildTemplateModerationContent, moderateTemplate } from '$lib/core/server/moderation';
import {
	PromptGuardInputTooLongError,
	assertPromptGuardInputBudget
} from '$lib/core/server/moderation/prompt-guard-budget';
import { requireAuthenticatedAgentRequest } from '$lib/server/agent-request-authority';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';
import {
	addRateLimitHeaders,
	enforceLLMRateLimit,
	rateLimitResponse
} from '$lib/server/llm-cost-protection';

function invalidInput(summary: string, status: 400 | 413 = 400): Response {
	return json(
		{
			approved: false,
			rejection_reason: 'invalid_input',
			summary
		},
		{ status }
	);
}

export const POST: RequestHandler = async (event) => {
	const authenticatedUserId = requireAuthenticatedAgentRequest(event);
	if (authenticatedUserId instanceof Response) return authenticatedUserId;

	let body: unknown;
	try {
		body = await readBoundedJsonRequest(event.request, 12 * 1024, {
			maxArrayItems: 4,
			maxDepth: 2,
			maxNodes: 16,
			maxObjectKeys: 8,
			maxStringBytes: 2_000
		});
	} catch (error) {
		if (error instanceof BoundedJsonRequestError) return invalidInput(error.message, error.status);
		return invalidInput('Invalid request body');
	}

	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		return invalidInput('title and message_body are required strings');
	}
	const { title, message_body, description, preview } = body as Record<string, unknown>;

	if (typeof title !== 'string' || typeof message_body !== 'string') {
		return invalidInput('title and message_body are required strings');
	}
	if (typeof description !== 'string') {
		return invalidInput('description is a required string');
	}
	if (typeof preview !== 'string') {
		return invalidInput('preview is a required string');
	}

	if (title.length > 200) {
		return invalidInput('title must be ≤200 characters');
	}
	if (description.length > 1_000) {
		return invalidInput('description must be ≤1,000 characters');
	}
	if (preview.length > 500) {
		return invalidInput('preview must be ≤500 characters');
	}
	try {
		assertPromptGuardInputBudget(
			buildTemplateModerationContent({ title, message_body, description, preview })
		);
	} catch (error) {
		if (error instanceof PromptGuardInputTooLongError) return invalidInput(error.message);
		throw error;
	}

	// The diagnostic can buy two Groq calls, so authentication alone is not a
	// cost boundary. Reserve globally before either provider is invoked.
	const rateLimitCheck = await enforceLLMRateLimit(event, 'moderation-check');
	if (!rateLimitCheck.allowed) return rateLimitResponse(rateLimitCheck);
	const headers = new Headers();
	addRateLimitHeaders(headers, rateLimitCheck);

	try {
		const result = await moderateTemplate(
			{ title, message_body, description, preview },
			{ signal: event.request.signal }
		);

		return json(result, { headers, status: result.approved ? 200 : 400 });
	} catch (error) {
		console.error('[moderation/check] Error:', error);

		return json(
			{
				approved: false,
				rejection_reason: 'moderation_error',
				summary: error instanceof Error ? error.message : 'Unknown error'
			},
			{ headers, status: 503 }
		);
	}
};
