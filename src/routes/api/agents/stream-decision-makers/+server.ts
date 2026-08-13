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
import { serverMutation, serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { issuePublicRecipientProvenance } from '$convex/lib/publicRecipientProvenance';
import { computeGlobalEmailHash } from '$convex/_orgHash';
import { RECIPIENT_SUPPRESSION_BATCH_MAX } from '$convex/lib/contactAuthority';
import { requireAuthenticatedAgentRequest } from '$lib/server/agent-request-authority';
import {
	agentPromptGuardContent,
	readBoundedAgentRequest
} from '$lib/server/agent-request-envelope';
import { present, type Fact } from '$lib/core/fact';
import { paidProviderMonthlyCeilingWasReached } from '$lib/server/paid-provider-budget-client';
import { tallyContactRoutes } from '$lib/core/agents/contact-route-verdict';
import { reachCensus } from '$lib/core/agents/reach-census';
import { classifySeatRoute } from '$lib/core/agents/seat-route';
import { captureWithContext } from '$lib/server/monitoring/sentry';
import {
	coerceStage,
	describeResolveFailure,
	readProviderAttribution,
	type ResolveFailureBudget,
	type ResolveFailureStage
} from '$lib/core/agents/resolve-failure';

type AgenticProviderBalance = Readonly<{ balanceUnits: number; allowance: number }>;

function captureResolveFailure(
	error: unknown,
	context: Readonly<{
		stage: ResolveFailureStage;
		budget: ResolveFailureBudget;
		userId: string;
		level: 'error' | 'warning';
		traceId?: string;
	}>
) {
	const report = describeResolveFailure({
		stage: context.stage,
		error,
		budget: context.budget,
		providerAttribution: readProviderAttribution(error)
	});
	// The provider exception is used only to choose frozen tokens. Capturing a
	// new token-only exception prevents provider bodies or echoed prompt text
	// from entering Sentry as the exception message.
	const operatorError = new Error(report.signature);
	operatorError.name = 'ResolveFailure';
	captureWithContext(operatorError, {
		userId: context.userId,
		action: 'stream-decision-makers',
		level: context.level,
		detail: {
			stage: report.stage,
			signature: report.signature,
			budget: report.budget,
			provider: report.provider ?? 'unobserved',
			providerAttribution: report.providerAttribution,
			...(context.traceId ? { traceId: context.traceId } : {})
		}
	});
	return report;
}

function unavailableCapacityResponse(balance: Fact<AgenticProviderBalance>): Response {
	switch (balance.state) {
		case 'absent':
			return new Response(
				JSON.stringify({
					error: 'No settled agentic resolve capacity is available for this organization',
					code: 'AGENTIC_RESOLVE_PAYMENT_REQUIRED'
				}),
				{ status: 402, headers: { 'Content-Type': 'application/json' } }
			);
		case 'blocked':
			return new Response(
				JSON.stringify({
					error: 'Agentic capacity could not be confirmed for this organization',
					code: 'AGENTIC_CAPACITY_BLOCKED'
				}),
				{ status: 503, headers: { 'Content-Type': 'application/json' } }
			);
		case 'withheld':
			return new Response(
				JSON.stringify({
					error: 'Agentic capacity is not available through this route',
					code: 'AGENTIC_CAPACITY_WITHHELD'
				}),
				{ status: 403, headers: { 'Content-Type': 'application/json' } }
			);
		case 'present':
			throw new Error('AGENTIC_CAPACITY_RESPONSE_CALLED_FOR_PRESENT_FACT');
	}
}

export const POST: RequestHandler = async (event) => {
	const authenticatedUserId = requireAuthenticatedAgentRequest(event);
	if (authenticatedUserId instanceof Response) return authenticatedUserId;
	const requestEnvelope = await readBoundedAgentRequest(event, 'stream-decision-makers');
	if (requestEnvelope instanceof Response) return requestEnvelope;
	const body = requestEnvelope;

	let agenticAdmission;
	try {
		agenticAdmission = await serverQuery(api.metering.agenticResolveAdmission, {
			_secret: getInternalSecret(),
			userId: authenticatedUserId as Id<'users'>,
			orgSlug: body.org_slug
		});
	} catch (error) {
		captureResolveFailure(error, {
			stage: 'admission',
			budget: 'metering-unavailable',
			userId: authenticatedUserId,
			level: 'error'
		});
		// Fail closed: without the admission read, the org allowance cannot be
		// honestly enforced before provider capacity is reserved.
		return new Response(
			JSON.stringify({
				error: 'Agentic capacity metering temporarily unavailable',
				code: 'METERING_UNAVAILABLE'
			}),
			{
				status: 503,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}
	let paidOrgGrant:
		| {
				orgId: Id<'organizations'>;
				balanceUnits: number;
				periodStart: number;
				periodEnd: number;
		  }
		| undefined;
	if (agenticAdmission.scope === 'org') {
		const balance = agenticAdmission.providerBalance;
		if (balance.state !== 'present') {
			if (balance.state === 'blocked') {
				captureResolveFailure(new Error('unclassified'), {
					stage: 'budget',
					budget: 'denied-unconfirmed',
					userId: authenticatedUserId,
					level: 'warning'
				});
			}
			return unavailableCapacityResponse(balance);
		}
		if (!agenticAdmission.allowed) {
			return new Response(
				JSON.stringify({
					error: 'Agentic resolve quota exhausted for this plan period',
					code: 'AGENTIC_RESOLVE_QUOTA_EXCEEDED'
				}),
				{
					status: 402,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}
		paidOrgGrant = {
			orgId: agenticAdmission.orgId,
			balanceUnits: balance.value.balanceUnits,
			periodStart: agenticAdmission.billingPeriodStart,
			periodEnd: agenticAdmission.billingPeriodEnd
		};
	}

	const rateLimitCheck = await enforceLLMRateLimit(event, 'decision-makers', paidOrgGrant);
	if (!rateLimitCheck.allowed) {
		if (
			rateLimitCheck.providerCeiling &&
			paidProviderMonthlyCeilingWasReached(rateLimitCheck.providerCeiling)
		) {
			captureResolveFailure(new Error('quota exhausted'), {
				stage: 'budget',
				budget: 'denied-platform-ceiling',
				userId: authenticatedUserId,
				level: 'warning'
			});
			return new Response(
				JSON.stringify({
					error:
						"Agentic resolution is temporarily paused because the platform's monthly provider-spend ceiling was reached. Your organization's allowance was not consumed.",
					code: 'AGENTIC_PLATFORM_CAPACITY_BLOCKED',
					resetAt: rateLimitCheck.resetAt.toISOString()
				}),
				{
					status: 503,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}
		return rateLimitResponse(rateLimitCheck);
	}
	const userContext = getUserContext(event);
	const startTime = Date.now();

	const { subject_line, core_message, topics, voice_sample, audience_guidance } = body;

	const userId = authenticatedUserId;
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
	const injectionCheck = await moderatePromptOnly(
		agentPromptGuardContent('stream-decision-makers', body),
		0.8,
		{ signal: event.request.signal }
	);

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
		console.debug(
			`[stream-decision-makers] Client disconnected, aborting resolution (trace: ${traceId})`
		);
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
		let lastStage: ResolveFailureStage = 'research';
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
				verbose: body.verbose === true,
				signal: abortController.signal
			};

			if (agenticAdmission.scope === 'org') {
				await serverMutation(api.metering.recordUsage, {
					_secret: getInternalSecret(),
					orgId: agenticAdmission.orgId,
					meter: 'agentic_resolve',
					quantity: 1,
					occurredAt: Date.now(),
					requestId: traceId,
					billingPeriodStart: agenticAdmission.billingPeriodStart
				});
			}
			const result = await resolveDecisionMakers(context, (segment: SegmentOrRevealEvent) => {
				if ('phase' in segment && typeof segment.phase === 'string') {
					lastStage = coerceStage(segment.phase);
				} else if (segment.type === 'verification') {
					lastStage = 'verification';
				}
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
			resultExternalCounts = result.metadata?.externalCounts as
				| import('$lib/core/agents/types').ExternalApiCounts
				| undefined;
			lastStage = 'suppression';

			// A mailbox that asked to be left alone is dropped BEFORE anything is
			// minted for it. Doing it here rather than downstream is what makes the
			// removal stick: no provenance MAC ever exists for a suppressed address,
			// so no later surface can admit it on a signature this route issued.
			// Addresses are emitted raw on this path, so they are normalized to the
			// same trim+lowercase the global email hash uses, or the key misses.
			const resolvedAddresses = result.decisionMakers.map((dm) =>
				(dm.email ?? '').trim().toLowerCase()
			);
			const suppressionCandidates = [
				...new Set(resolvedAddresses.filter((email) => email.length > 0 && email.includes('@')))
			].slice(0, RECIPIENT_SUPPRESSION_BATCH_MAX);
			let suppressedAddresses = new Set<string>();
			if (suppressionCandidates.length > 0) {
				const hashes = await Promise.all(suppressionCandidates.map(computeGlobalEmailHash));
				// One batched query for the whole roster, never one per recipient.
				const denied = new Set(
					await serverQuery(api.email.filterSuppressedContactHashes, {
						_secret: getInternalSecret(),
						contactHashes: hashes
					})
				);
				suppressedAddresses = new Set(
					suppressionCandidates.filter((_, index) => denied.has(hashes[index]))
				);
			}
			result.decisionMakers = result.decisionMakers.filter(
				(_, index) => !suppressedAddresses.has(resolvedAddresses[index])
			);
			const contactRouteCounts = tallyContactRoutes(
				result.decisionMakers.map((dm) => dm.contactRoute)
			);
			result.metadata = { ...result.metadata, contactRouteCounts };
			const contactableTargets = result.decisionMakers.filter(
				(dm) => typeof dm.email === 'string' && dm.email.trim().length > 0
			).length;
			const unroutedTargets = result.decisionMakers.length - contactableTargets;
			const reachCensusFact = present(
				reachCensus(
					result.decisionMakers.map((dm) => ({
						contactRoute: dm.contactRoute,
						seatRoute: classifySeatRoute(dm.email, { candidateName: dm.name }),
						routeProvenance: dm.routeProvenance
					}))
				)
			);

			lastStage = 'completion';
			// Build response - source is the email source (verified). The public
			// recipient proof is author-bound and covers every field the anonymous
			// detail projection may publish; mutable client flags alone grant nothing.
			const provenanceIssuedAt = Date.now();
			const provenanceSecret = getInternalSecret();
			const decisionMakers = await Promise.all(
				result.decisionMakers.map(async (dm) => {
					const publicRecipientProvenance = await issuePublicRecipientProvenance(
						dm,
						String(userId),
						provenanceSecret,
						provenanceIssuedAt
					);
					return {
						name: dm.name,
						title: dm.title,
						organization: dm.organization,
						email: dm.email || '',
						contactRoute: dm.contactRoute ?? { status: 'unknown' },
						deliveryTier: dm.deliveryTier ?? null,
						reasoning: dm.reasoning,
						sourceUrl: dm.emailSource || dm.source || '',
						sourceTitle: dm.emailSourceTitle || '',
						provenance: dm.provenance,
						discovered: dm.discovered || false,
						isAiResolved: dm.isAiResolved === true,
						emailGrounded: dm.emailGrounded === true,
						emailSource: dm.emailSource || '',
						confidence: dm.confidence,
						contactNotes: dm.contactNotes,
						// Phase 4: Accountability & Classification
						accountabilityOpener: dm.accountabilityOpener || null,
						roleCategory: dm.roleCategory || null,
						relevanceRank: dm.relevanceRank ?? null,
						publicActions: dm.publicActions || [],
						personalPrompt: dm.personalPrompt || null,
						...(publicRecipientProvenance ? { publicRecipientProvenance } : {})
					};
				})
			);
			const response = {
				decision_makers: decisionMakers,
				research_summary: result.researchSummary || 'Decision-makers resolved successfully.',
				pipeline_stats: {
					total_resolved: result.decisionMakers.length,
					contactable_targets: contactableTargets,
					unrouted_targets: unroutedTargets,
					contact_routes: result.metadata.contactRouteCounts,
					reach_census: reachCensusFact,
					total_latency_ms: result.latencyMs
				}
			};

			emitter.complete(response);
			streamSuccess = true;

			console.log('[stream-decision-makers] Resolution complete:', {
				userId,
				totalResolved: result.decisionMakers.length,
				contactable: contactableTargets,
				contactRoutes: contactRouteCounts,
				latencyMs: Date.now() - startTime
			});

			// Trace resolution outcome — the data SSE streams vanish after delivery
			console.log('[stream-decision-makers] result:', {
				traceId,
				totalResolved: result.decisionMakers.length,
				contactable: contactableTargets,
				contactRoutes: contactRouteCounts,
				provider: result.provider,
				latencyMs: result.latencyMs
			});
		} catch (error) {
			console.error('[stream-decision-makers] Resolution failed:', error);
			const report = captureResolveFailure(error, {
				stage: abortController.signal.aborted ? 'timeout' : lastStage,
				budget: agenticAdmission.scope === 'org' ? 'granted-org' : 'granted-individual',
				userId,
				level: 'error',
				traceId
			});
			emitter.error(report.message, report.code);
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
