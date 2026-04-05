/**
 * Streaming Decision-Maker Resolution API
 *
 * POST /api/agents/stream-decision-makers
 *
 * Returns Server-Sent Events (SSE) stream with:
 * - segment: ThoughtSegment objects for real-time reasoning display
 * - complete: Final result with verified decision-makers
 * - error: Error message if resolution fails
 *
 * All emails are verified against grounded sources. Unverified emails are filtered out.
 *
 * Rate Limiting: BLOCKED for guests (quota = 0), 3/hour authenticated, 10/hour verified.
 */

import type { RequestHandler } from './$types';
import { resolveDecisionMakers } from '$lib/core/agents/agents';
import type { SegmentOrRevealEvent } from '$lib/core/agents/agents';
import { createSSEStream, SSE_HEADERS } from '$lib/server/sse-stream';
import {
	enforceLLMRateLimit,
	rateLimitResponse,
	addRateLimitHeaders,
	getUserContext,
	logLLMOperation
} from '$lib/server/llm-cost-protection';
import { moderatePromptOnly } from '$lib/core/server/moderation';

interface RequestBody {
	subject_line: string;
	core_message: string;
	topics: string[];
	voice_sample?: string;
	target_type?: string;
	target_entity?: string;
	audience_guidance?: string;
}

export const POST: RequestHandler = async (event) => {
	const rateLimitCheck = await enforceLLMRateLimit(event, 'decision-makers');
	if (!rateLimitCheck.allowed) {
		return rateLimitResponse(rateLimitCheck);
	}
	const userContext = getUserContext(event);
	const startTime = Date.now();

	let body: RequestBody;
	try {
		body = (await event.request.json()) as RequestBody;
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const { subject_line, core_message, topics, voice_sample, audience_guidance } = body;

	if (!subject_line?.trim()) {
		return new Response(JSON.stringify({ error: 'Subject line is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!core_message?.trim()) {
		return new Response(JSON.stringify({ error: 'Core message is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!topics || topics.length === 0) {
		return new Response(JSON.stringify({ error: 'At least one topic is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Auth check
	const session = event.locals.session;
	if (!session?.userId) {
		return new Response(JSON.stringify({ error: 'Authentication required' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const userId = session.userId;
	const traceId = crypto.randomUUID();

	console.log('[stream-decision-makers] trace:', {
		traceId,
		userId,
		subjectLength: subject_line.length,
		coreMessageLength: core_message.length,
		topicCount: topics.length,
		hasVoiceSample: !!voice_sample,
		hasAudienceGuidance: !!audience_guidance,
		targetType: body.target_type || 'local_government'
	});

	// Prompt injection detection
	// NOTE: core_message is AI-refined (from subject-line agent), not raw user input.
	// The AI's paraphrasing uses phrases like "The user is demanding that..." which
	// Prompt Guard interprets as indirect injection (meta-reference + imperative).
	// The raw input was already checked at the subject-line step, so we use a higher
	// threshold here (0.8) to avoid false positives on AI-generated descriptions
	// while still catching clear attacks (which score 0.9+).
	const contentToCheck = `${subject_line}\n${core_message}\n${topics.join(' ')}${audience_guidance ? `\n${audience_guidance}` : ''}`;
	const injectionCheck = await moderatePromptOnly(contentToCheck, 0.8);

	if (!injectionCheck.safe) {
		console.log('[stream-decision-makers] Prompt injection detected:', {
			score: injectionCheck.score.toFixed(4),
			threshold: injectionCheck.threshold
		});

		return new Response(
			JSON.stringify({
				error: 'Content flagged by safety filter',
				code: 'PROMPT_INJECTION_DETECTED'
			}),
			{
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}

	console.log('[stream-decision-makers] Starting resolution:', {
		userId,
		subject: subject_line.substring(0, 50),
		topics,
		targetType: body.target_type,
		targetEntity: body.target_entity,
		hasAudienceGuidance: !!audience_guidance
	});

	// Abort on client disconnect OR 8-minute server ceiling.
	// request.signal fires when the client closes the connection (refresh/navigate away).
	// 8 minutes accommodates: Phase 1 (~15s) + Phase 2a (~20s) + Stage 1-3 (~60s)
	// + Stage 4 parallel chunks (~30s) + verification (~15s) + margin.
	const abortController = new AbortController();
	const serverTimeout = setTimeout(() => abortController.abort(), 480_000);
	event.request.signal.addEventListener('abort', () => {
		console.debug(`[stream-decision-makers] Client disconnected, aborting resolution (trace: ${traceId})`);
		abortController.abort();
	});

	const { stream, emitter } = createSSEStream({
		traceId,
		endpoint: 'decision-makers',
		userId,
		abortController
	});

	(async () => {
		let streamSuccess = false;
		let resultTokenUsage: import('$lib/core/agents/types').TokenUsage | undefined;
		let resultExternalCounts: import('$lib/core/agents/types').ExternalApiCounts | undefined;

		// Heartbeat: send a keepalive every 30s so the client idle timer resets.
		// Stage 4 parallel synthesis can be silent for 30-60s during generate() calls.
		const heartbeat = setInterval(() => {
			if (!abortController.signal.aborted) {
				emitter.send('segment', { content: '' });
			}
		}, 30_000);

		try {
			const context = {
				targetType: body.target_type || 'local_government',
				targetEntity: body.target_entity,
				subjectLine: subject_line,
				coreMessage: core_message,
				topics,
				voiceSample: voice_sample,
				audienceGuidance: audience_guidance,
				signal: abortController.signal
			};

			const result = await resolveDecisionMakers(context, (segment: SegmentOrRevealEvent) => {
				// Route progressive reveal events to their own SSE event types
				if (segment.type === 'identity-found') {
					emitter.send('identity-found', segment.metadata.identities);
				} else if (segment.type === 'candidate-resolved') {
					emitter.send('candidate-resolved', segment.metadata.candidate);
				} else if (segment.type === 'verification') {
					emitter.send('verification', segment.metadata);
				} else {
					emitter.send('segment', segment);
				}
			});

			resultTokenUsage = result.tokenUsage;
			resultExternalCounts = result.metadata?.externalCounts as import('$lib/core/agents/types').ExternalApiCounts | undefined;

			// Build response - source is the email source (verified)
			const response = {
				decision_makers: result.decisionMakers.map((dm) => ({
					name: dm.name,
					title: dm.title,
					organization: dm.organization,
					email: dm.email || '',
					reasoning: dm.reasoning,
					sourceUrl: dm.emailSource || dm.source || '',
					sourceTitle: dm.emailSourceTitle || '',
					provenance: dm.provenance,
					discovered: dm.discovered || false,
					emailGrounded: dm.emailGrounded || false,
					emailSource: dm.emailSource || '',
					confidence: dm.confidence,
					contactNotes: dm.contactNotes,
					// Phase 4: Accountability & Classification
					accountabilityOpener: dm.accountabilityOpener || null,
					roleCategory: dm.roleCategory || null,
					relevanceRank: dm.relevanceRank ?? null,
					publicActions: dm.publicActions || [],
					personalPrompt: dm.personalPrompt || null
				})),
				research_summary: result.researchSummary || 'Decision-makers resolved successfully.',
				pipeline_stats: {
					total_resolved: result.decisionMakers.length + ((result.metadata?.droppedEmailless as number) || 0),
					candidates_found: result.decisionMakers.length,
					verified_emails: result.decisionMakers.length,
					total_latency_ms: result.latencyMs
				}
			};

			emitter.complete(response);
			streamSuccess = true;

			console.log('[stream-decision-makers] Resolution complete:', {
				userId,
				contactable: result.decisionMakers.length,
				droppedEmailless: (result.metadata?.droppedEmailless as number) || 0,
				latencyMs: Date.now() - startTime
			});

			// Trace resolution outcome — the data SSE streams vanish after delivery
			console.log('[stream-decision-makers] result:', {
				traceId,
				contactable: result.decisionMakers.length,
				droppedEmailless: (result.metadata?.droppedEmailless as number) || 0,
				provider: result.provider,
				latencyMs: result.latencyMs,
			});
		} catch (error) {
			console.error('[stream-decision-makers] Resolution failed:', error);
			emitter.error(error instanceof Error ? error.message : 'Resolution failed');
		} finally {
			clearInterval(heartbeat);
			clearTimeout(serverTimeout);
			logLLMOperation(
				'decision-makers',
				userContext,
				{
					durationMs: Date.now() - startTime,
					success: streamSuccess,
					tokenUsage: resultTokenUsage,
					externalCounts: resultExternalCounts
				},
				traceId
			);
			emitter.close();
		}
	})();

	const headers = new Headers(SSE_HEADERS);
	addRateLimitHeaders(headers, rateLimitCheck);

	return new Response(stream, { headers });
};
