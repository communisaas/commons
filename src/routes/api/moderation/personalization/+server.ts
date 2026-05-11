import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { moderatePersonalization } from '$lib/core/server/moderation';

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
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const text = body?.text;

		if (typeof text !== 'string') {
			return json({ error: 'text field required (string)' }, { status: 400 });
		}

		// bound input length before paid Groq moderation call.
		// Personalization deltas are short user inserts; 10,000 is generous.
		if (text.length > 10_000) {
			return json({ error: 'text must be ≤10,000 characters' }, { status: 400 });
		}

		const result = await moderatePersonalization(text);

		return json({
			approved: result.approved,
			summary: result.summary,
			latency_ms: result.latency_ms
		});
	} catch (error) {
		console.error('[moderation/personalization] Error:', error);
		return json({ error: 'Moderation service error' }, { status: 500 });
	}
};
