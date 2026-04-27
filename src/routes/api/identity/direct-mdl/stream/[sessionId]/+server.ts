import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireMdlDirectQrEnabled } from '$lib/config/features';
import { getDirectMdlSession, type DirectMdlSession } from '$lib/server/direct-mdl-session';
import { createSSEStream } from '$lib/server/sse-stream';

function sendTerminal(
	emitter: ReturnType<typeof createSSEStream>['emitter'],
	session: DirectMdlSession
): boolean {
	if (session.status === 'completed') {
		emitter.send('completed', {
			district: session.result?.district,
			state: session.result?.state,
			cellId: session.result?.cellId,
			credentialHash: session.result?.credentialHash,
			identityCommitmentBound: session.result?.identityCommitmentBound,
			requireReauth: session.result?.requireReauth
		});
		emitter.close();
		return true;
	}
	if (session.status === 'failed') {
		emitter.send('failed', { error: session.errorMessage ?? 'Verification failed' });
		emitter.close();
		return true;
	}
	return false;
}

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	try {
		requireMdlDirectQrEnabled();
	} catch {
		throw error(404, 'Not found');
	}

	const session = locals.session;
	if (!session?.userId) {
		throw error(401, 'Authentication required');
	}

	const { sessionId } = params;
	if (!sessionId) {
		throw error(400, 'Missing session ID');
	}

	const directSession = await getDirectMdlSession(sessionId, platform);
	if (!directSession) {
		throw error(404, 'Direct mDL session not found or expired');
	}
	if (directSession.desktopUserId !== session.userId) {
		throw error(403, 'Session ownership mismatch');
	}

	const abortController = new AbortController();
	const { stream, emitter } = createSSEStream({
		traceId: `direct-mdl-${sessionId.slice(0, 8)}`,
		endpoint: 'direct-mdl/stream',
		userId: session.userId,
		abortController
	});

	if (sendTerminal(emitter, directSession)) {
		return directStreamResponse(stream);
	}

	let lastStatus = directSession.status;
	const startTime = Date.now();
	const maxDuration = 5 * 60 * 1000;

	const pollInterval = setInterval(async () => {
		if (abortController.signal.aborted) {
			clearInterval(pollInterval);
			return;
		}

		if (Date.now() - startTime > maxDuration) {
			emitter.send('expired', { message: 'Direct mDL session expired' });
			emitter.close();
			clearInterval(pollInterval);
			return;
		}

		try {
			const current = await getDirectMdlSession(sessionId, platform);
			if (!current) {
				emitter.send('expired', { message: 'Direct mDL session expired' });
				emitter.close();
				clearInterval(pollInterval);
				return;
			}

			if (current.status !== lastStatus) {
				lastStatus = current.status;
				if (current.status === 'request_fetched') {
					emitter.send('request_fetched', { requestFetchedAt: current.requestFetchedAt });
				}
				if (sendTerminal(emitter, current)) {
					clearInterval(pollInterval);
				}
			} else {
				emitter.send('heartbeat', { elapsed: Date.now() - startTime });
			}
		} catch {
			emitter.send('heartbeat', { elapsed: Date.now() - startTime });
		}
	}, 3000);

	emitter.send('heartbeat', { elapsed: 0, status: directSession.status });

	abortController.signal.addEventListener('abort', () => {
		clearInterval(pollInterval);
	});

	return directStreamResponse(stream);
};

function directStreamResponse(stream: ReadableStream<Uint8Array>): Response {
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-store, must-revalidate',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
}
