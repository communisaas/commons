import { error } from '@sveltejs/kit';
import { createSSEStream, SSE_HEADERS } from '$lib/server/sse-stream';
import { computeVerificationPacketCached } from '$lib/server/campaigns/verification';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';
import type { Id } from '$convex/_generated/dataModel';

/** Minimal debate snapshot for change detection. */
interface DebateSnapshot {
	id: string;
	status: string;
	argumentCount: number;
	uniqueParticipants: number;
	winningStance: string | null;
	aiPanelConsensus: number | null;
}

async function fetchDebateSnapshot(debateId: Id<'debates'>): Promise<DebateSnapshot | null> {
	return serverQuery(api.debates.getSnapshot, { debateId });
}

/**
 * GET /api/org/[slug]/campaigns/[campaignId]/stream
 *
 * SSE stream for live verification packet updates on a campaign.
 * Polls every 30s and emits `packet` events when data changes.
 * Also emits debate events when debate state changes.
 * Heartbeat every 15s keeps the connection alive.
 *
 * Auth: session cookie + org membership (viewer+).
 */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	// Validate org membership via Convex
	const orgContext = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
	if (!orgContext) {
		throw error(404, 'Organization not found');
	}
	const orgId = orgContext.org._id;

	// Verify campaign belongs to org and is active
	const campaign = await serverQuery(api.campaigns.get, {
		campaignId: params.campaignId as Id<'campaigns'>
	});

	if (!campaign || campaign.orgId !== orgId || !['ACTIVE', 'PAUSED'].includes(campaign.status)) {
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
	let lastDebateId = campaign.debateId ?? null;
	let lastDebate: DebateSnapshot | null = null;

	// Send initial packet immediately
	try {
		const packet = await computeVerificationPacketCached(campaign._id, orgId, packetKV);
		lastPacketJson = JSON.stringify(packet);
		emitter.send('packet', packet);
	} catch {
		emitter.error('Failed to compute initial packet', 'INIT_ERROR');
	}

	// Send initial debate state if exists and feature is enabled
	if (FEATURES.DEBATE && lastDebateId) {
		try {
			lastDebate = await fetchDebateSnapshot(lastDebateId);
		} catch {
			// Skip — will pick up on next poll
		}
	}

	// Poll every 30s, emit only if packet/debate changed
	const pollTimer = setInterval(async () => {
		if (closed) return;
		try {
			const packet = await computeVerificationPacketCached(campaign._id, orgId, packetKV);
			const json = JSON.stringify(packet);
			if (json !== lastPacketJson) {
				lastPacketJson = json;
				emitter.send('packet', packet);
			}
		} catch {
			// Query error — skip this poll, don't kill the stream
		}

		// Poll debate state (gated behind DEBATE feature flag)
		if (!FEATURES.DEBATE) return;
		try {
			// Re-check campaign for newly spawned debate
			const freshDebateId = await serverQuery(api.campaigns.getDebateId, {
				campaignId: campaign._id
			});
			const currentDebateId = freshDebateId?.debateId ?? null;

			// Debate just spawned
			if (currentDebateId && !lastDebateId) {
				lastDebateId = currentDebateId;
				const snap = await fetchDebateSnapshot(currentDebateId);
				if (snap) {
					lastDebate = snap;
					emitter.send('debate:spawned', {
						debateId: snap.id,
						status: snap.status,
						argumentCount: snap.argumentCount,
						uniqueParticipants: snap.uniqueParticipants
					});
				}
				return;
			}

			if (!currentDebateId) return;

			const snap = await fetchDebateSnapshot(currentDebateId);
			if (!snap || !lastDebate) {
				lastDebate = snap;
				return;
			}

			// Detect argument/participant changes
			if (
				snap.argumentCount !== lastDebate.argumentCount ||
				snap.uniqueParticipants !== lastDebate.uniqueParticipants
			) {
				emitter.send('debate:argument', {
					debateId: snap.id,
					argumentCount: snap.argumentCount,
					uniqueParticipants: snap.uniqueParticipants
				});
			}

			// Detect status change
			if (snap.status !== lastDebate.status) {
				emitter.send('debate:status', {
					debateId: snap.id,
					status: snap.status
				});

				// Emit resolved event with outcome details
				if (snap.status === 'resolved') {
					emitter.send('debate:resolved', {
						debateId: snap.id,
						status: 'resolved',
						winningStance: snap.winningStance,
						consensus: snap.aiPanelConsensus,
						argumentCount: snap.argumentCount,
						participants: snap.uniqueParticipants
					});
				}
			}

			lastDebate = snap;
		} catch {
			// Query error — skip debate poll, don't kill the stream
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
