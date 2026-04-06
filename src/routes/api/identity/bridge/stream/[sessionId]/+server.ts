import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSSEStream } from '$lib/server/sse-stream';
import { getBridgeSession } from '$lib/server/bridge-session';

/**
 * Bridge SSE Stream — desktop listens for mobile verification result.
 *
 * Polls KV every 3s for status transitions. Sends typed events:
 * heartbeat, claimed, completed, failed, expired.
 * Closes on terminal state or TTL expiry.
 */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const { sessionId } = params;
	if (!sessionId) {
		throw error(400, 'Missing session ID');
	}

	// Verify desktop user owns this session
	const bridgeSession = await getBridgeSession(sessionId, platform);
	if (!bridgeSession) {
		throw error(404, 'Bridge session not found or expired');
	}
	if (bridgeSession.desktopUserId !== session.userId) {
		throw error(403, 'Session ownership mismatch');
	}

	const abortController = new AbortController();
	const { stream, emitter } = createSSEStream({
		traceId: `bridge-${sessionId.slice(0, 8)}`,
		endpoint: 'bridge/stream',
		userId: session.userId,
		abortController
	});

	// Poll KV for status changes
	let lastStatus = bridgeSession.status;
	const startTime = Date.now();
	const maxDuration = 5 * 60 * 1000; // 5 minutes

	const pollInterval = setInterval(async () => {
		if (abortController.signal.aborted) {
			clearInterval(pollInterval);
			return;
		}

		// Check TTL
		if (Date.now() - startTime > maxDuration) {
			emitter.send('expired', { message: 'Bridge session expired' });
			emitter.close();
			clearInterval(pollInterval);
			return;
		}

		try {
			const current = await getBridgeSession(sessionId, platform);

			if (!current) {
				// Session expired or deleted from KV
				emitter.send('expired', { message: 'Bridge session expired' });
				emitter.close();
				clearInterval(pollInterval);
				return;
			}

			if (current.status !== lastStatus) {
				lastStatus = current.status;

				switch (current.status) {
					case 'claimed':
						emitter.send('claimed', { claimedAt: current.claimedAt });
						break;
					case 'completed':
						emitter.send('completed', {
							district: current.result?.district,
							state: current.result?.state,
							cellId: current.result?.cellId,
							identityCommitmentBound: current.result?.identityCommitmentBound
						});
						emitter.close();
						clearInterval(pollInterval);
						return;
					case 'failed':
						emitter.send('failed', { error: current.errorMessage ?? 'Verification failed' });
						emitter.close();
						clearInterval(pollInterval);
						return;
				}
			} else {
				// No state change — send heartbeat
				emitter.send('heartbeat', { elapsed: Date.now() - startTime });
			}
		} catch {
			// KV read error — send heartbeat anyway, don't crash the stream
			emitter.send('heartbeat', { elapsed: Date.now() - startTime });
		}
	}, 3000);

	// Send initial heartbeat immediately
	emitter.send('heartbeat', { elapsed: 0, status: bridgeSession.status });

	// Clean up on abort
	abortController.signal.addEventListener('abort', () => {
		clearInterval(pollInterval);
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-store, must-revalidate',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
