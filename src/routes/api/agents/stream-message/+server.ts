/**
 * Streaming Message Generation API — Two-Phase Source Verification
 *
 * POST /api/agents/stream-message
 *
 * Returns Server-Sent Events (SSE) stream with:
 * - phase: Current pipeline phase (sources | message | complete)
 * - thought: Agent reasoning during source discovery and writing
 * - complete: Final message with bounded source ground
 * - error: Error message if generation fails
 *
 * Two-Phase Pipeline:
 * 1. Source Discovery: Find and validate URLs via web search
 * 2. Message Generation: Write using ONLY bounded source ground
 *
 * This prevents citation hallucination: every URL in the output comes from the
 * bounded source-ground pool, while evaluated/search-only status remains visible.
 *
 * Rate Limiting: BLOCKED for guests, 10/hour authenticated, 30/hour verified.
 */

import type { RequestHandler } from './$types';
import {
	generateMessage,
	type PipelinePhase,
	type SourceEvidenceUpdate
} from '$lib/core/agents/agents/message-writer';
import type { ProviderVisibleSourceStage } from '$lib/core/agents/agents/message-source-ground';
import { filterThoughtForDisplay } from '$lib/core/agents/utils/thought-filter';
import { createSSEStream, SSE_HEADERS } from '$lib/server/sse-stream';
import {
	enforceLLMRateLimit,
	rateLimitResponse,
	addRateLimitHeaders,
	getUserContext,
	logLLMOperation,
	computeCostUsd
} from '$lib/server/llm-cost-protection';
import { classifySafety, moderatePromptOnly } from '$lib/core/server/moderation';
import { getMessageGenerationReadiness } from '$lib/server/agents/message-generation-readiness';
import { serverQuery, serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { EvaluatedSource } from '$lib/core/agents/types';
import { encryptMessageJobResult } from '$lib/server/message-job-encryption';
import { traceStart, traceEnd, traceEvent } from '$lib/server/agent-trace';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { requireAuthenticatedAgentRequest } from '$lib/server/agent-request-authority';
import {
	agentPromptGuardContent,
	readBoundedAgentRequest
} from '$lib/server/agent-request-envelope';
import { computeSourceCacheInputHash } from '$lib/server/source-cache-key';

const TRACE_ENDPOINT = 'message-generation';

/**
 * Truncate a stack trace to the first 20 frames, joined back into a string.
 * Keeps the trace replay-useful without exploding the payload on deep
 * V8 stacks.
 */
function truncatedStack(err: unknown): string | undefined {
	if (!(err instanceof Error) || !err.stack) return undefined;
	return err.stack.split('\n').slice(0, 20).join('\n');
}

/** 72-hour cache TTL for template source cache */
const SOURCE_CACHE_TTL_MS = 72 * 60 * 60 * 1000;
/** Short recovery window: enough for tab hibernation, not a long-lived draft archive. */
const MESSAGE_JOB_TTL_MS = 2 * 60 * 60 * 1000;

function isFreshSourceCacheTimestamp(value: unknown, now: number): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= now &&
		now - value < SOURCE_CACHE_TTL_MS
	);
}

type MessageJob = {
	jobId: string;
	inputHash: string;
	status: string;
	encryptedResult?: unknown;
	errorMessage?: string | null;
};

function replayMessageJob(job: MessageJob, userId: string): Response {
	const traceId = crypto.randomUUID();
	const { stream, emitter } = createSSEStream({
		traceId,
		endpoint: TRACE_ENDPOINT,
		userId
	});

	emitter.send('job', {
		jobId: job.jobId,
		inputHash: job.inputHash,
		status: job.status,
		traceId
	});

	if (job.status === 'completed') {
		emitter.send('job-complete', { job: { ...job, traceId } });
	} else if (job.status === 'pending' || job.status === 'running') {
		emitter.send('job-running', { job: { ...job, traceId } });
	} else {
		emitter.error(job.errorMessage || 'Message generation job is not recoverable');
	}
	emitter.close();

	return new Response(stream, { headers: SSE_HEADERS });
}

async function failMessageJob(job: MessageJob | null, errorCode: string, errorMessage: string) {
	if (!job) return;
	await serverMutation(api.messageJobs.fail, {
		jobId: job.jobId,
		errorCode,
		errorMessage
	}).catch((error: unknown) => {
		console.warn('[stream-message] Message job preflight failure could not be persisted:', error);
	});
}

export const POST: RequestHandler = async (event) => {
	const authenticatedUserId = requireAuthenticatedAgentRequest(event);
	if (authenticatedUserId instanceof Response) return authenticatedUserId;
	const requestEnvelope = await readBoundedAgentRequest(event, 'stream-message');
	if (requestEnvelope instanceof Response) return requestEnvelope;
	const body = requestEnvelope;

	const session = event.locals.session!;

	const usesRecoverableJob = Boolean(
		body.job_id || body.input_hash || body.recovery_public_key_jwk
	);
	let messageJob: MessageJob | null = null;

	// The authenticated Convex mutation is the concurrency gate. It atomically
	// creates the caller-owned job or returns the existing caller-owned job.
	// Replays stop here, before any paid-provider admission or moderation call.
	if (usesRecoverableJob) {
		try {
			const start = await serverMutation(api.messageJobs.startOrGet, {
				jobId: body.job_id!,
				inputHash: body.input_hash!,
				recoveryPublicKeyJwk: body.recovery_public_key_jwk!,
				expiresAt: Date.now() + MESSAGE_JOB_TTL_MS
			});
			messageJob = start.job;
			if (!start.created) return replayMessageJob(messageJob, session.userId);
		} catch (jobError) {
			console.error('[stream-message] Message job start failed:', jobError);
			return new Response(JSON.stringify({ error: 'Could not start message generation job' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	const runtimeReadiness = getMessageGenerationReadiness({
		GEMINI_API_KEY: process.env.GEMINI_API_KEY,
		EXA_API_KEY: process.env.EXA_API_KEY,
		FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY
	});
	if (!runtimeReadiness.ready) {
		await failMessageJob(
			messageJob,
			'MESSAGE_GENERATION_RUNTIME_NOT_CONFIGURED',
			runtimeReadiness.message
		);
		return new Response(
			JSON.stringify({
				error: runtimeReadiness.message,
				code: 'message_generation_runtime_not_configured',
				missing: runtimeReadiness.missing,
				dependency: runtimeReadiness.dependency
			}),
			{
				status: 503,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}

	const rateLimitCheck = await enforceLLMRateLimit(event, 'message-generation');
	if (!rateLimitCheck.allowed) {
		await failMessageJob(
			messageJob,
			'MESSAGE_GENERATION_ADMISSION_DENIED',
			rateLimitCheck.reason || 'Message generation admission denied'
		);
		return rateLimitResponse(rateLimitCheck);
	}
	const userContext = getUserContext(event);
	const startTime = Date.now();

	const traceId = crypto.randomUUID();

	console.log('[stream-message] trace:', {
		traceId,
		userId: session.userId,
		subjectLength: body.subject_line.length,
		coreMessageLength: body.core_message.length,
		topicCount: body.topics?.length || 0,
		decisionMakerCount: body.decision_makers?.length || 0,
		hasVoiceSample: !!body.voice_sample,
		geographicScopeType: body.geographic_scope?.type || null
	});

	// Emit trace.start with the FULL input snapshot. Privacy posture: TTL
	// (default 7d) + `_secret`-gated reads carry the privacy load; full
	// capture is required for replay.
	traceStart(traceId, TRACE_ENDPOINT, session.userId, {
		inputHash: body.input_hash ?? null,
		templateId: body.template_id ?? null,
		usesRecoverableJob,
		hasRecoveryKey: Boolean(body.recovery_public_key_jwk),
		subjectLine: body.subject_line,
		coreMessage: body.core_message,
		topics: body.topics ?? [],
		decisionMakers: body.decision_makers ?? [],
		voiceSample: body.voice_sample ?? null,
		rawInput: body.raw_input ?? null,
		geographicScope: body.geographic_scope ?? null,
		sizes: {
			subjectLength: body.subject_line.length,
			coreMessageLength: body.core_message.length,
			topicCount: (body.topics ?? []).length,
			decisionMakerCount: (body.decision_makers ?? []).length,
			voiceSampleLength: (body.voice_sample ?? '').length,
			rawInputLength: (body.raw_input ?? '').length
		}
	});

	// Prompt injection detection
	// Content includes AI-refined text (core_message, voice_sample) which can contain
	// meta-phrasing like "The user is demanding..." that triggers false positives.
	// Raw input was already checked at subject-line step; use 0.8 threshold here.
	const contentToCheck = agentPromptGuardContent('stream-message', body);

	let injectionCheck: Awaited<ReturnType<typeof moderatePromptOnly>>;
	try {
		injectionCheck = await moderatePromptOnly(contentToCheck, 0.8, {
			signal: event.request.signal
		});
	} catch (error) {
		console.error('[stream-message] Prompt-injection moderation unavailable:', error);
		traceEvent(traceId, TRACE_ENDPOINT, 'error', {
			phase: 'prompt-injection-moderation',
			code: 'MODERATION_UNAVAILABLE',
			errorName: error instanceof Error ? error.name : 'unknown',
			errorMessage: error instanceof Error ? error.message : String(error),
			stack: truncatedStack(error)
		});
		traceEnd(traceId, TRACE_ENDPOINT, false, Date.now() - startTime, {
			finalPhase: 'prompt-injection-moderation',
			errorCode: 'MODERATION_UNAVAILABLE'
		});
		await failMessageJob(
			messageJob,
			'MODERATION_UNAVAILABLE',
			'Content moderation is temporarily unavailable'
		);
		return new Response(
			JSON.stringify({
				error: 'Content moderation is temporarily unavailable',
				code: 'moderation_unavailable'
			}),
			{
				status: 503,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}

	traceEvent(traceId, TRACE_ENDPOINT, 'prompt-injection', {
		score: injectionCheck.score,
		threshold: injectionCheck.threshold,
		safe: injectionCheck.safe,
		contentLength: contentToCheck.length
	});

	if (!injectionCheck.safe) {
		console.log('[stream-message] Prompt injection detected:', {
			score: injectionCheck.score.toFixed(4),
			threshold: injectionCheck.threshold
		});

		traceEvent(traceId, TRACE_ENDPOINT, 'error', {
			phase: 'prompt-injection',
			code: 'PROMPT_INJECTION_DETECTED',
			score: injectionCheck.score,
			threshold: injectionCheck.threshold
		});
		traceEnd(traceId, TRACE_ENDPOINT, false, Date.now() - startTime, {
			finalPhase: 'prompt-injection',
			errorCode: 'PROMPT_INJECTION_DETECTED'
		});
		await failMessageJob(
			messageJob,
			'PROMPT_INJECTION_DETECTED',
			'Content flagged by safety filter'
		);

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

	console.log('[stream-message] Starting streaming generation:', {
		userId: session.userId,
		subjectLength: body.subject_line.length,
		decisionMakerCount: body.decision_makers?.length || 0
	});

	// Create SSE stream
	const { stream, emitter } = createSSEStream({
		traceId,
		endpoint: 'message-generation',
		userId: session.userId
	});
	const waitUntil = event.platform?.context?.waitUntil?.bind(event.platform.context);

	// Run generation in background. When Cloudflare exposes waitUntil, keep the
	// job alive long enough to persist an encrypted recovery envelope even if the
	// browser stream disconnects during tab hibernation.
	const generationTask = (async () => {
		let streamSuccess = false;
		let resultTokenUsage: import('$lib/core/agents/types').TokenUsage | undefined;
		let resultExternalCounts: import('$lib/core/agents/types').ExternalApiCounts | undefined;

		try {
			if (messageJob) {
				emitter.send('job', {
					jobId: messageJob.jobId,
					inputHash: messageJob.inputHash,
					status: messageJob.status,
					traceId
				});

				await serverMutation(api.messageJobs.markRunning, {
					jobId: messageJob.jobId,
					phase: 'sources'
				});
			}

			// ================================================================
			// Template source cache: lookup
			// ================================================================
			let cacheHit = false;
			let verifiedSources: EvaluatedSource[] | undefined;
			let sourceCacheInputHash: string | null = null;

			if (body.template_id) {
				try {
					sourceCacheInputHash = await computeSourceCacheInputHash({
						subjectLine: body.subject_line,
						coreMessage: body.core_message,
						topics: body.topics || [],
						geographicScope: body.geographic_scope,
						decisionMakers: body.decision_makers || []
					});
				} catch (cacheKeyError) {
					// A cache-key failure must lose the optimization, never the message.
					console.warn('[stream-message] Source cache key failed:', cacheKeyError);
				}

				try {
					const template = await serverQuery(api.templates.getSourceCache, {
						_secret: getInternalSecret(),
						userId: session.userId as Id<'users'>,
						templateId: body.template_id as Id<'templates'>
					});

					const cacheCheckedAt = Date.now();
					if (
						sourceCacheInputHash &&
						template?.cachedSources &&
						isFreshSourceCacheTimestamp(template.sourcesCachedAt, cacheCheckedAt) &&
						template.sourceCacheInputHash === sourceCacheInputHash
					) {
						cacheHit = true;
						verifiedSources = template.cachedSources as unknown as EvaluatedSource[];
						console.log('[stream-message] Source cache hit:', {
							templateId: body.template_id,
							sourceCount: verifiedSources.length,
							cachedAge: Math.round((cacheCheckedAt - template.sourcesCachedAt) / 60000) + 'min'
						});
					}
				} catch (cacheErr) {
					// Cache lookup failure is non-fatal — proceed without cache
					console.warn('[stream-message] Source cache lookup failed:', cacheErr);
				}

				console.log('[stream-message] source-cache:', {
					traceId,
					cacheHit,
					templateId: body.template_id,
					sourceCount: verifiedSources?.length ?? 0
				});

				traceEvent(traceId, TRACE_ENDPOINT, 'source-cache', {
					templateId: body.template_id,
					cacheHit,
					sourceCount: verifiedSources?.length ?? 0,
					// Capture URLs/titles explicitly when the cache hits so a
					// cache-served trace can be replayed without parsing the
					// prompt block in `message-write`.
					sources: cacheHit
						? (verifiedSources ?? []).map((s) => ({
								num: s.num,
								title: s.title,
								url: s.url,
								type: s.type
							}))
						: []
				});

				// When the cache hits, source-discovery is bypassed entirely
				// (no source-search / source-fetch / source-evaluation events
				// will fire). Emit an explicit skip so an operator reading
				// the trace doesn't suspect data loss between source-cache
				// and message-write.
				if (cacheHit) {
					traceEvent(traceId, TRACE_ENDPOINT, 'source-discovery-skipped', {
						reason: 'cache-hit',
						templateId: body.template_id,
						sourceCount: verifiedSources?.length ?? 0
					});
				}
			}

			const result = await generateMessage({
				subjectLine: body.subject_line,
				coreMessage: body.core_message,
				topics: body.topics || [],
				decisionMakers: body.decision_makers || [],
				voiceSample: body.voice_sample,
				rawInput: body.raw_input,
				geographicScope: body.geographic_scope,
				verifiedSources,
				traceId,
				classifyProviderVisibleSources: async (
					providerVisibleText: string,
					stage: ProviderVisibleSourceStage
				) => {
					// This is the exact, globally bounded source schema later placed in
					// Gemini's prompt. It shares the request's one provider reservation;
					// cached source ground takes the same fail-closed path as fresh reads.
					const indirectInjectionCheck = await moderatePromptOnly(providerVisibleText, 0.8, {
						signal: event.request.signal
					});
					traceEvent(traceId, TRACE_ENDPOINT, 'indirect-prompt-injection', {
						stage,
						score: indirectInjectionCheck.score,
						threshold: indirectInjectionCheck.threshold,
						safe: indirectInjectionCheck.safe,
						contentLength: providerVisibleText.length
					});
					if (!indirectInjectionCheck.safe) {
						throw new Error('A retrieved source failed safety review');
					}
				},
				onThought: (thought: string, phase?: PipelinePhase) => {
					const cleaned = filterThoughtForDisplay(thought, body.verbose ? 'verbose' : 'strict');
					if (cleaned) {
						emitter.send('thought', { content: cleaned, phase: phase || 'message' });
					}
				},
				onPhase: (phase: PipelinePhase, message: string) => {
					emitter.send('phase', { phase, message });
					if (messageJob) {
						serverMutation(api.messageJobs.checkpointPhase, {
							jobId: messageJob.jobId,
							phase
						}).catch((err: unknown) => {
							console.warn('[stream-message] Message job phase checkpoint failed:', err);
						});
					}
				},
				onSourceEvidence: (evidence: SourceEvidenceUpdate) => {
					emitter.send('source-evidence', evidence);
					traceEvent(traceId, TRACE_ENDPOINT, 'source-evidence', evidence);
				}
			});

			// Strip tokenUsage and externalCounts from SSE payload (internal concern)
			const { tokenUsage, externalCounts, ...clientResult } = result;
			resultTokenUsage = tokenUsage;
			resultExternalCounts = externalCounts;

			// This adds one Groq safeguard call per generated message. It is authorized
			// because the drafted body is the delivery surface and must fail closed before
			// encrypted persistence or client delivery. Request recipients are caller
			// controlled, so this boundary intentionally uses the strict unknown policy.
			let draftedMessageSafety: Awaited<ReturnType<typeof classifySafety>>;
			try {
				draftedMessageSafety = await classifySafety(
					[body.subject_line, result.message].join('\n\n'),
					{ signal: event.request.signal }
				);
			} catch (error) {
				console.error('[stream-message] Drafted-message moderation unavailable:', error);
				traceEvent(traceId, TRACE_ENDPOINT, 'error', {
					phase: 'drafted-message-moderation',
					code: 'MODERATION_UNAVAILABLE',
					errorName: error instanceof Error ? error.name : 'unknown',
					errorMessage: error instanceof Error ? error.message : String(error),
					stack: truncatedStack(error)
				});
				await failMessageJob(
					messageJob,
					'MODERATION_UNAVAILABLE',
					'Content moderation is temporarily unavailable'
				);
				emitter.error('Content moderation is temporarily unavailable');
				return;
			}

			if (!draftedMessageSafety.safe) {
				traceEvent(traceId, TRACE_ENDPOINT, 'error', {
					phase: 'drafted-message-moderation',
					code: 'CONTENT_FLAGGED',
					hazards: draftedMessageSafety.blocking_hazards
				});
				await failMessageJob(
					messageJob,
					'CONTENT_FLAGGED',
					'The drafted message was blocked by the safety filter'
				);
				emitter.error('The drafted message was blocked by the safety filter');
				return;
			}

			if (messageJob && body.recovery_public_key_jwk && body.input_hash) {
				try {
					const encrypted = await encryptMessageJobResult(
						clientResult,
						body.recovery_public_key_jwk,
						messageJob.jobId,
						body.input_hash
					);
					await serverMutation(api.messageJobs.completeEncrypted, {
						jobId: messageJob.jobId,
						encryptedResult: encrypted.encryptedResult,
						encryptionMeta: encrypted.encryptionMeta
					});
				} catch (encryptionErr) {
					console.error('[stream-message] Message job encrypted completion failed:', encryptionErr);
					await serverMutation(api.messageJobs.fail, {
						jobId: messageJob.jobId,
						errorCode: 'RECOVERY_ENCRYPTION_FAILED',
						errorMessage: 'Message generated, but encrypted recovery storage failed'
					}).catch(() => {});
				}
			}

			// Send final result
			emitter.complete(clientResult);
			streamSuccess = true;

			// ================================================================
			// Template source cache: write (lifetime-bound, response-independent)
			// Cache miss + template_id + non-empty sources → write cache
			// ================================================================
			if (
				body.template_id &&
				!cacheHit &&
				result.evaluatedSources &&
				result.evaluatedSources.length > 0 &&
				sourceCacheInputHash
			) {
				const sourceCacheWrite = serverMutation(api.templates.updateSourceCache, {
					_secret: getInternalSecret(),
					userId: session.userId as Id<'users'>,
					templateId: body.template_id as Id<'templates'>,
					cachedSources: result.evaluatedSources,
					sourcesCachedAt: Date.now(),
					sourceCacheInputHash
				}).catch((err: unknown) => {
					console.warn('[stream-message] Source cache write failed:', err);
				});

				// A floating mutation may be cancelled as soon as the SSE stream closes.
				// Cloudflare tracks this cache write independently so the completed client
				// response stays fast. Non-Cloudflare runtimes await it as the safe fallback.
				if (waitUntil) {
					waitUntil(sourceCacheWrite);
				} else {
					await sourceCacheWrite;
				}
			}

			console.log('[stream-message] Two-phase generation complete:', {
				userId: session.userId,
				messageLength: result.message.length,
				sourceGroundCount: result.sources.length,
				evaluatedSourceCount:
					result.evaluatedSources?.filter(
						(source) => !source.credibility_rationale.startsWith('Evaluation unavailable')
					).length ?? result.sources.length,
				searchOnlySourceCount:
					result.evaluatedSources?.filter((source) =>
						source.credibility_rationale.startsWith('Evaluation unavailable')
					).length ?? 0,
				latencyMs: Date.now() - startTime
			});
		} catch (error) {
			console.error('[stream-message] Generation failed:', error);
			traceEvent(traceId, TRACE_ENDPOINT, 'error', {
				phase: 'generation',
				errorName: error instanceof Error ? error.name : 'unknown',
				errorMessage: error instanceof Error ? error.message : String(error),
				stack: truncatedStack(error)
			});
			if (messageJob) {
				await serverMutation(api.messageJobs.fail, {
					jobId: messageJob.jobId,
					errorCode: 'GENERATION_FAILED',
					errorMessage: error instanceof Error ? error.message : 'Generation failed'
				}).catch(() => {});
			}
			emitter.error(error instanceof Error ? error.message : 'Generation failed');
		} finally {
			// trace.end MUST fire on every exit from generationTask — success or error.
			// logLLMOperation also fires traceCompletion for the cost record;
			// the two events coexist (different eventTypes). Hoist costUsd to
			// the top-level column so `recentByEndpoint` summaries surface it
			// without joining against the completion event.
			const finalBreakdown = computeCostUsd(resultTokenUsage, resultExternalCounts);
			traceEnd(
				traceId,
				TRACE_ENDPOINT,
				streamSuccess,
				Date.now() - startTime,
				{
					finalPhase: streamSuccess ? 'completed' : 'error',
					hasRecoverableJob: Boolean(messageJob),
					inputTokens: resultTokenUsage?.promptTokens,
					outputTokens: resultTokenUsage?.candidatesTokens,
					thoughtsTokens: resultTokenUsage?.thoughtsTokens,
					totalTokens: resultTokenUsage?.totalTokens,
					externalCounts: resultExternalCounts
				},
				finalBreakdown?.totalCostUsd
			);
			logLLMOperation(
				'message-generation',
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

	if (waitUntil) {
		waitUntil(generationTask);
	} else {
		generationTask.catch((err) => {
			console.error('[stream-message] Background generation task failed:', err);
		});
	}

	const headers = new Headers(SSE_HEADERS);
	addRateLimitHeaders(headers, rateLimitCheck);

	return new Response(stream, { headers });
};
