import { error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { authenticateApiKey, requireScope } from '$lib/server/api-v1/auth';
import { requirePublicApi } from '$lib/server/api-v1/gate';
import { checkApiPlanRateLimit } from '$lib/server/api-v1/rate-limit';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import type { RequestHandler } from './$types';

/**
 * GET /api/v1/stream
 *
 * Server-Sent Events stream of org-scoped events. Polls orgEvents (5s
 * interval), sends `data: { event, payload, emittedAt }` lines per new row.
 * Heartbeat comment every 30s so intermediaries don't time out idle
 * connections.
 *
 * Auth: Bearer API key (same as other v1 endpoints) — orgId is derived from
 * the authenticated key context, not URL params.
 */
export const GET: RequestHandler = async ({ request }) => {
	requirePublicApi();
	const auth = await authenticateApiKey(request);
	if (auth instanceof Response) return auth;
	const scopeErr = requireScope(auth, 'read');
	if (scopeErr) return scopeErr;
	const rateLimit = await checkApiPlanRateLimit(auth, { method: request.method });
	if (rateLimit) return rateLimit;

	const POLL_MS = 5_000;
	const HEARTBEAT_MS = 30_000;
	const orgId = auth.orgId;

	let sinceMs = Date.now();
	let stopped = false;
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			const send = (line: string) => {
				if (stopped) return;
				try {
					controller.enqueue(encoder.encode(line));
				} catch {
					stopped = true;
				}
			};

			// Initial comment so clients know the stream opened.
			send(': open\n\n');

			const tick = async () => {
				if (stopped) return;
				try {
					const events = await serverQuery(api.v1api.pollOrgEvents, {
						_secret: getInternalSecret(),
						orgId,
						sinceMs,
						limit: 100
					});
					for (const e of events) {
						sinceMs = Math.max(sinceMs, e.emittedAt);
						const data = {
							id: String(e.id),
							event: e.event,
							payload: JSON.parse(e.payload || '{}'),
							emittedAt: e.emittedAt
						};
						send(`event: ${e.event}\n`);
						send(`data: ${JSON.stringify(data)}\n\n`);
					}
				} catch (e) {
					send(`: poll-error ${e instanceof Error ? e.message.slice(0, 100) : 'unknown'}\n\n`);
				}
			};

			pollTimer = setInterval(tick, POLL_MS);
			heartbeatTimer = setInterval(() => send(`: heartbeat ${Date.now()}\n\n`), HEARTBEAT_MS);
			// Kick off first tick immediately so subscribers see existing recent events.
			tick();
		},
		cancel() {
			stopped = true;
			if (pollTimer) clearInterval(pollTimer);
			if (heartbeatTimer) clearInterval(heartbeatTimer);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};

void error; // keep import shape consistent with other v1 routes
