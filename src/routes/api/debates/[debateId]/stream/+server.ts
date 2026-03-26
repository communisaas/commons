// CONVEX: Keep SvelteKit — SSE streaming with shadow-atlas proxy + Prisma polling.
// Cannot move to Convex: uses createSSEStream, ReadableStream piping, setInterval polling.
import { createSSEStream, SSE_HEADERS } from '$lib/server/sse-stream';
import { env } from '$env/dynamic/private';
import { prisma } from '$lib/core/db';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';
import { error } from '@sveltejs/kit';

/**
 * GET /api/debates/[debateId]/stream
 *
 * SSE stream for real-time debate updates.
 * Combines two event sources:
 * 1. Upstream shadow-atlas SSE (market price updates, trade activity)
 * 2. Local Prisma polling (AI resolution state transitions)
 *
 * Events emitted locally via Prisma polling:
 *   - evaluating: AI evaluation in progress (status → resolving)
 *   - ai_scores_submitted: Scores submitted on-chain (ai_signature_count populated)
 *   - resolved_with_ai: Debate resolved via AI+community blend
 *   - governance_escalated: Consensus failed, awaiting governance
 *   - appeal_started: Resolution under appeal
 *   - resolution_finalized: Appeal resolved or governance resolution finalized
 *   - debate:argument: New argument submitted (argument_count changed)
 *   - debate:position: New participant (unique_participants changed)
 *   - debate:settled: Debate settled by org admin (resolution_method = org_settlement)
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.DEBATE) {
		throw error(404, 'Not found');
	}

	if (!locals.session?.userId) {
		return new Response('Authentication required', { status: 401 });
	}

	const { debateId } = params;
	const shadowAtlasUrl = env.SHADOW_ATLAS_API_URL || 'http://localhost:3000';
	const { stream, emitter } = createSSEStream({
		traceId: crypto.randomUUID(),
		endpoint: 'debate-stream'
	});

	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let closed = false;

	// Track last-seen state to detect transitions
	let lastStatus: string | null = null;
	let lastSignatureCount: number | null = null;
	let lastArgumentCount: number | null = null;
	let lastParticipantCount: number | null = null;

	/**
	 * Poll Prisma for AI resolution state changes.
	 * Emits SSE events when status or ai_signature_count changes.
	 */
	async function pollResolutionState() {
		if (closed) return;

		try {
			const debate = await prisma.debate.findFirst({
				where: {
					OR: [
						{ id: debateId },
						{ debate_id_onchain: debateId }
					]
				},
				select: {
					status: true,
					ai_signature_count: true,
					ai_panel_consensus: true,
					resolution_method: true,
					winning_argument_index: true,
					winning_stance: true,
					appeal_deadline: true,
					argument_count: true,
					unique_participants: true,
					governance_justification: true
				}
			});

			if (!debate || closed) return;

			const currentStatus = debate.status;
			const currentSigCount = debate.ai_signature_count;

			// Detect AI signature count change (scores submitted)
			if (
				currentSigCount !== null &&
				currentSigCount !== lastSignatureCount &&
				lastSignatureCount !== currentSigCount
			) {
				emitter.send('ai_scores_submitted', {
					debateId,
					signatureCount: currentSigCount,
					panelConsensus: debate.ai_panel_consensus
				});
				lastSignatureCount = currentSigCount;
			}

			// Detect argument count changes
			if (
				lastArgumentCount !== null &&
				debate.argument_count !== lastArgumentCount
			) {
				emitter.send('debate:argument', {
					debateId,
					argumentCount: debate.argument_count,
					uniqueParticipants: debate.unique_participants
				});
			}
			lastArgumentCount = debate.argument_count;

			// Detect participant count changes
			if (
				lastParticipantCount !== null &&
				debate.unique_participants !== lastParticipantCount
			) {
				emitter.send('debate:position', {
					debateId,
					uniqueParticipants: debate.unique_participants
				});
			}
			lastParticipantCount = debate.unique_participants;

			// Detect status transitions
			if (currentStatus !== lastStatus) {
				const prevStatus = lastStatus;
				lastStatus = currentStatus;

				// Don't emit on initial load — only on transitions
				if (prevStatus === null) return;

				switch (currentStatus) {
					case 'resolving':
						emitter.send('evaluating', { debateId });
						break;

					case 'resolved':
						if (debate.resolution_method === 'org_settlement') {
							emitter.send('debate:settled', {
								debateId,
								winningStance: debate.winning_stance,
								resolutionMethod: 'org_settlement',
								reasoning: debate.governance_justification
							});
						} else if (debate.resolution_method === 'ai_community') {
							emitter.send('resolved_with_ai', {
								debateId,
								winningArgumentIndex: debate.winning_argument_index,
								winningStance: debate.winning_stance,
								resolutionMethod: debate.resolution_method
							});
						} else {
							emitter.send('resolution_finalized', {
								debateId,
								winningArgumentIndex: debate.winning_argument_index,
								winningStance: debate.winning_stance,
								resolutionMethod: debate.resolution_method
							});
						}
						// Stop polling once resolved
						if (pollTimer) {
							clearInterval(pollTimer);
							pollTimer = null;
						}
						break;

					case 'awaiting_governance':
						emitter.send('governance_escalated', {
							debateId,
							panelConsensus: debate.ai_panel_consensus
						});
						break;

					case 'under_appeal':
						emitter.send('appeal_started', {
							debateId,
							appealDeadline: debate.appeal_deadline?.toISOString() ?? null
						});
						break;
				}
			}
		} catch {
			// DB error — don't kill the stream, just skip this poll
		}
	}

	// Initialize: fetch current state so we only emit on transitions
	try {
		const initial = await prisma.debate.findFirst({
			where: {
				OR: [
					{ id: debateId },
					{ debate_id_onchain: debateId }
				]
			},
			select: {
				status: true,
				ai_signature_count: true,
				argument_count: true,
				unique_participants: true
			}
		});
		if (initial) {
			lastStatus = initial.status;
			lastSignatureCount = initial.ai_signature_count;
			lastArgumentCount = initial.argument_count;
			lastParticipantCount = initial.unique_participants;
		}
	} catch {
		// If DB is down, still proceed with upstream proxy
	}

	// Start polling for AI resolution state changes (5s interval)
	// Only poll if debate isn't already terminal
	if (lastStatus !== 'resolved') {
		pollTimer = setInterval(pollResolutionState, 5000);
	}

	// Connect to shadow-atlas SSE and forward events
	try {
		const upstream = await fetch(`${shadowAtlasUrl}/v1/debate/${debateId}/stream`, {
			headers: { Accept: 'text/event-stream' },
			signal: AbortSignal.timeout(10_000)
		});

		if (!upstream.ok || !upstream.body) {
			emitter.error(`Shadow atlas unavailable (${upstream.status})`, 'UPSTREAM_ERROR');
			// Don't close — local polling still provides value
		} else {
			// Pipe upstream SSE events to client
			const reader = upstream.body.getReader();
			const decoder = new TextDecoder();

			(async () => {
				try {
					while (!closed) {
						const { done, value } = await reader.read();
						if (done) break;
						const chunk = decoder.decode(value, { stream: true });
						for (const block of chunk.split('\n\n')) {
							if (!block.trim()) continue;
							const lines = block.split('\n');
							let eventType = 'message';
							let data = '';
							for (const line of lines) {
								if (line.startsWith('event: ')) eventType = line.slice(7).trim();
								if (line.startsWith('data: ')) data = line.slice(6);
								if (line.startsWith(':')) continue;
							}
							if (data && !closed) {
								try {
									emitter.send(eventType, JSON.parse(data));
								} catch {
									// Non-JSON data, skip
								}
							}
						}
					}
				} catch {
					// Upstream closed or errored
				}
			})();
		}
	} catch {
		emitter.error('Failed to connect to shadow atlas', 'CONNECTION_ERROR');
	}

	// Cleanup on stream close (client disconnect)
	// ReadableStream cancel callback
	const originalStream = stream;
	const wrappedStream = new ReadableStream({
		start(controller) {
			const reader = originalStream.getReader();
			let controllerClosed = false;
			(async () => {
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						controller.enqueue(value);
					}
					if (!controllerClosed) { controllerClosed = true; controller.close(); }
				} catch {
					if (!controllerClosed) { controllerClosed = true; controller.close(); }
				} finally {
					closed = true;
					if (pollTimer) {
						clearInterval(pollTimer);
						pollTimer = null;
					}
				}
			})();
		},
		cancel() {
			closed = true;
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
			emitter.close();
		}
	});

	return new Response(wrappedStream, { headers: SSE_HEADERS });
};
