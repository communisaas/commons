import { error } from '@sveltejs/kit';
import { createSSEStream, SSE_HEADERS } from '$lib/server/sse-stream';
import { loadOrgContext } from '$lib/server/org';
import { computeVerificationPacketCached } from '$lib/server/campaigns/verification';
import { db } from '$lib/core/db';
import type { RequestHandler } from './$types';

/**
 * GET /api/org/[slug]/campaigns/[campaignId]/stream
 *
 * SSE stream for live verification packet updates on a campaign.
 * Polls every 30s and emits `packet` events when data changes.
 * Heartbeat every 15s keeps the connection alive.
 *
 * Auth: session cookie + org membership (viewer+).
 */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const { org } = await loadOrgContext(params.slug, locals.user.id);

	// Verify campaign belongs to org and is active
	const campaign = await db.campaign.findFirst({
		where: { id: params.campaignId, orgId: org.id, status: { in: ['ACTIVE', 'PAUSED'] } },
		select: { id: true }
	});

	if (!campaign) {
		throw error(404, 'Campaign not found or not active');
	}

	const { stream, emitter } = createSSEStream({
		traceId: crypto.randomUUID(),
		endpoint: 'campaign-stream',
		userId: locals.user.id
	});

	const packetKV = platform?.env?.PACKET_CACHE_KV as
		| { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> }
		| undefined;

	let closed = false;
	let lastPacketJson = '';

	// Send initial packet immediately
	try {
		const packet = await computeVerificationPacketCached(campaign.id, org.id, packetKV);
		lastPacketJson = JSON.stringify(packet);
		emitter.send('packet', packet);
	} catch {
		emitter.error('Failed to compute initial packet', 'INIT_ERROR');
	}

	// Poll every 30s, emit only if packet changed
	const pollTimer = setInterval(async () => {
		if (closed) return;
		try {
			const packet = await computeVerificationPacketCached(campaign.id, org.id, packetKV);
			const json = JSON.stringify(packet);
			if (json !== lastPacketJson) {
				lastPacketJson = json;
				emitter.send('packet', packet);
			}
		} catch {
			// DB error — skip this poll, don't kill the stream
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
