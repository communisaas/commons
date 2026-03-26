import { error } from '@sveltejs/kit';
import { createSSEStream, SSE_HEADERS } from '$lib/server/sse-stream';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/alerts/stream
 *
 * SSE stream for live legislative alert updates.
 * Polls every 30s and emits `alerts` events when new pending alerts appear.
 * Heartbeat every 15s keeps the connection alive.
 *
 * Auth: session cookie + org membership (any role).
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	// Validate org membership via Convex
	const orgContext = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
	if (!orgContext) {
		throw error(404, 'Organization not found');
	}
	const orgId = orgContext.org._id;

	const { stream, emitter } = createSSEStream({
		traceId: crypto.randomUUID(),
		endpoint: 'alert-stream',
		userId: locals.user.id
	});

	let closed = false;
	let lastAlertIds = '';

	// Fetch pending alerts helper via Convex
	async function fetchPendingAlerts() {
		return serverQuery(api.legislation.getPendingAlertsByOrgId, { orgId, limit: 10 });
	}

	// Send initial state immediately
	try {
		const alerts = await fetchPendingAlerts();
		lastAlertIds = alerts.map((a: { id: string }) => a.id).join(',');
		emitter.send('alerts', {
			count: alerts.length,
			alerts
		});
	} catch {
		emitter.error('Failed to fetch initial alerts', 'INIT_ERROR');
	}

	// Poll every 30s, emit only if alert set changed
	const pollTimer = setInterval(async () => {
		if (closed) return;
		try {
			const alerts = await fetchPendingAlerts();
			const ids = alerts.map((a: { id: string }) => a.id).join(',');
			if (ids !== lastAlertIds) {
				lastAlertIds = ids;
				emitter.send('alerts', {
					count: alerts.length,
					alerts
				});
			}
		} catch {
			// Query error — skip this poll, don't kill the stream
		}
	}, 30_000);

	// Heartbeat every 15s
	const heartbeatTimer = setInterval(() => {
		if (closed) return;
		emitter.send('heartbeat', {});
	}, 15_000);

	// Cleanup on client disconnect
	const originalStream = stream;
	const wrappedStream = new ReadableStream({
		start(controller) {
			const reader = originalStream.getReader();
			(async () => {
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						controller.enqueue(value);
					}
					controller.close();
				} catch {
					controller.close();
				} finally {
					closed = true;
					clearInterval(pollTimer);
					clearInterval(heartbeatTimer);
				}
			})();
		},
		cancel() {
			closed = true;
			clearInterval(pollTimer);
			clearInterval(heartbeatTimer);
			emitter.close();
		}
	});

	return new Response(wrappedStream, { headers: SSE_HEADERS });
};
