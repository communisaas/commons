import type { RequestEvent } from '@sveltejs/kit';

type AgentRequestEvent = Pick<RequestEvent, 'locals'>;

/**
 * Agent routes can reach metered model and search providers. Keep application
 * identity as the first handler statement so anonymous traffic cannot consume
 * provider work through a resettable per-isolate limiter.
 */
export function requireAuthenticatedAgentRequest(event: AgentRequestEvent): string | Response {
	const userId = event.locals.session?.userId;
	if (typeof userId === 'string' && userId.length > 0) return userId;

	return new Response(JSON.stringify({ error: 'Authentication required' }), {
		status: 401,
		headers: {
			'cache-control': 'private, no-store, max-age=0',
			'content-type': 'application/json; charset=utf-8'
		}
	});
}
