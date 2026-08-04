import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { moderatePersonalization } from '$lib/core/server/moderation';
import { requireAuthenticatedAgentRequest } from '$lib/server/agent-request-authority';
import { BoundedJsonRequestError, readBoundedJsonRequest } from '$lib/server/bounded-json-request';
import { PROMPT_GUARD_MAX_CHARACTERS } from '$lib/core/server/moderation/prompt-guard-budget';
import {
	addRateLimitHeaders,
	enforceLLMRateLimit,
	rateLimitResponse
} from '$lib/server/llm-cost-protection';

/**
 * Personalization Moderation Endpoint
 *
 * Moderates user-supplied personalization text at send time.
 * Runs Prompt Guard + Llama Guard only (no Gemini) for low latency.
 *
 * The template itself was already moderated at creation time.
 * This endpoint checks only the user's personalization delta
 * (e.g., [Personal Connection] text) for injection and safety.
 *
 * @see COORDINATION-INTEGRITY-SPEC.md § CI-004
 */
export const POST: RequestHandler = async (event) => {
	const authenticatedUserId = requireAuthenticatedAgentRequest(event);
	if (authenticatedUserId instanceof Response) return authenticatedUserId;

	let body: unknown;
	try {
		body = await readBoundedJsonRequest(event.request, 12 * 1024, {
			maxArrayItems: 2,
			maxDepth: 2,
			maxNodes: 8,
			maxObjectKeys: 4,
			maxStringBytes: PROMPT_GUARD_MAX_CHARACTERS
		});
	} catch (error) {
		if (error instanceof BoundedJsonRequestError) {
			return json({ error: error.message }, { status: error.status });
		}
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const text =
		body !== null && typeof body === 'object' && !Array.isArray(body)
			? (body as Record<string, unknown>).text
			: undefined;

	if (typeof text !== 'string') {
		return json({ error: 'text field required (string)' }, { status: 400 });
	}

	if (text.length > PROMPT_GUARD_MAX_CHARACTERS) {
		return json(
			{ error: `text must be ≤${PROMPT_GUARD_MAX_CHARACTERS} characters` },
			{ status: 400 }
		);
	}

	// Empty personalization has no provider-visible surface. Resolve it locally
	// before the shared reservation so an attacker cannot burn scarce public
	// moderation capacity with requests that deliberately cause zero Groq work.
	if (text.trim().length === 0) {
		return json({
			approved: true,
			summary: 'Empty personalization — skipped',
			latency_ms: 0
		});
	}

	const rateLimitCheck = await enforceLLMRateLimit(event, 'moderation-personalization');
	if (!rateLimitCheck.allowed) return rateLimitResponse(rateLimitCheck);

	try {
		const result = await moderatePersonalization(text, { signal: event.request.signal });
		const headers = new Headers();
		addRateLimitHeaders(headers, rateLimitCheck);
		return json(
			{
				approved: result.approved,
				summary: result.summary,
				latency_ms: result.latency_ms
			},
			{ headers, status: result.approved ? 200 : 400 }
		);
	} catch (error) {
		console.error('[moderation/personalization] Error:', error);
		return json(
			{ error: 'Moderation service unavailable', code: 'moderation_unavailable' },
			{ status: 503 }
		);
	}
};
