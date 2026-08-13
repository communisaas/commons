import { json, error } from '@sveltejs/kit';
import { ConvexError } from 'convex/values';
// CONVEX: Keep SvelteKit — Gemini embeddings external API
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import {
	EMBEDDING_CONFIG,
	generateBatchEmbeddings,
	truncateText
} from '$lib/core/search/gemini-embeddings';
import { env } from '$env/dynamic/private';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { projectToHue } from '$lib/utils/domain-hue-projection';
import { enforceLLMRateLimit, rateLimitResponse } from '$lib/server/llm-cost-protection';

const BATCH_SIZE = 20;
const FALLBACK_CONCURRENCY = 4;
const EMBEDDING_TASK = { taskType: 'RETRIEVAL_DOCUMENT' as const };
const FALLBACK_EMBEDDING_TASK = { ...EMBEDDING_TASK, maxRetries: 1 as const };
const TEMPLATE_SPECIFIC_BATCH_FAILURE_PATTERNS = [
	/\binvalid (?:input|argument)\b/i,
	/\btext too long\b/i,
	/\b(?:safety|content)\b.{0,80}\b(?:block|filter|policy|prohibit|reject)/i,
	/\b(?:block|filter|prohibit|reject)\w*\b.{0,80}\b(?:safety|content)\b/i
] as const;

type BackfillError =
	| { stage: 'embedding_generation' | 'embedding_write'; id: string; error: string }
	| { stage: 'snapshot_rebuild'; error: string };

function embeddingFailureMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function embeddingFailureCode(error: unknown): string | undefined {
	const data =
		error instanceof ConvexError
			? error.data
			: error !== null && typeof error === 'object' && 'data' in error
				? (error as { data?: unknown }).data
				: undefined;
	if (typeof data === 'string') return data;
	if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
		const code = (data as { code?: unknown }).code;
		return typeof code === 'string' ? code : undefined;
	}
	return undefined;
}

/**
 * Per-template retries are useful only when one row can poison an otherwise
 * valid batch. Global auth, quota, timeout, and unknown service failures must
 * stop after the already-retried batch call instead of multiplying external
 * requests by the number of templates.
 */
function shouldIsolateTemplateFailures(error: unknown): boolean {
	if (
		error !== null &&
		typeof error === 'object' &&
		'code' in error &&
		(error as { code?: unknown }).code === 'INVALID_ARGUMENT'
	) {
		return true;
	}
	const message = embeddingFailureMessage(error);
	return TEMPLATE_SPECIFIC_BATCH_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

/** Admin user IDs — populated from ADMIN_USER_IDS env var (comma-separated) */
const ADMIN_USER_IDS = new Set((env.ADMIN_USER_IDS || '').split(',').filter(Boolean));

/**
 * POST /api/admin/backfill-embeddings
 *
 * Repairs at most 20 public templates that have never completed an embedding
 * write, using the exact bounded Convex index. Repeat the operation to drain a
 * larger legacy backlog. A durable Convex lease coordinates independent Pages
 * isolates; each successful write also durably schedules the relation refresh,
 * so worker eviction before the immediate rebuild cannot strand stale data.
 *
 * Requires authentication + admin role.
 */
export const POST: RequestHandler = async (event) => {
	const { locals } = event;
	// Auth gate
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	// Admin check
	if (!ADMIN_USER_IDS.has(locals.user.id)) {
		throw error(403, 'Admin access required');
	}

	const internalSecret = getInternalSecret();
	const leaseToken = crypto.randomUUID();
	const lease = await serverMutation(api.templates.claimEmbeddingBackfillLease, {
		_secret: internalSecret,
		token: leaseToken
	});
	if (!lease.acquired) {
		throw error(429, `Backfill already in progress. Retry after ${lease.retryAt}.`);
	}

	try {
		// Find templates missing embeddings via Convex
		const missing = await serverQuery(api.templates.listMissingEmbeddings, {
			_secret: internalSecret,
			limit: BATCH_SIZE
		});

		if (missing.length === 0) {
			return json({ processed: 0, message: 'All templates have embeddings' });
		}

		const batch = missing.slice(0, BATCH_SIZE);
		let totalProcessed = 0;
		const errors: BackfillError[] = [];
		// One conservative weighted reservation covers the bounded batch and its
		// input-specific fallback fanout. Empty backlogs consume no provider budget.
		const rateLimitCheck = await enforceLLMRateLimit(event, 'embedding-backfill');
		if (!rateLimitCheck.allowed) return rateLimitResponse(rateLimitCheck);

		// Leave one token of headroom because truncateText may append an ellipsis.
		// Embeddings are derived search material; the stored/public semantic fields
		// remain untouched.
		const maxEmbeddingTokens = EMBEDDING_CONFIG.maxInputTokens - 1;
		const textPairs = batch.map((template) => [
			truncateText(
				`${template.title} ${template.description || ''} ${template.domain}`,
				maxEmbeddingTokens
			),
			truncateText(
				`${template.title} ${template.description || ''} ${template.messageBody}`,
				maxEmbeddingTokens
			)
		]);
		const texts = textPairs.flat();

		const writeEmbeddings = async (
			templateId: (typeof batch)[number]['_id'],
			embeddings: number[][]
		) => {
			try {
				await serverMutation(api.templates.updateMissingEmbeddingsForBackfill, {
					templateId,
					locationEmbedding: embeddings[0],
					topicEmbedding: embeddings[1],
					domainHue: projectToHue(embeddings[1]),
					_secret: internalSecret,
					leaseToken
				});
				totalProcessed++;
				return true;
			} catch (writeErr) {
				const message = embeddingFailureMessage(writeErr);
				errors.push({
					stage: 'embedding_write',
					id: templateId,
					error: message
				});
				// Once this worker loses or outlives its lease, every later write
				// would fail the same authoritative Convex check.
				return !embeddingFailureCode(writeErr)?.startsWith('EMBEDDING_BACKFILL_LEASE_');
			}
		};

		try {
			const embeddings = await generateBatchEmbeddings(texts, EMBEDDING_TASK);

			// Write embeddings back via Convex. Every successful mutation marks the
			// relation materialization dirty in the same transaction.
			for (let j = 0; j < batch.length; j++) {
				const keepWriting = await writeEmbeddings(batch[j]._id, [
					embeddings[j * 2],
					embeddings[j * 2 + 1]
				]);
				if (!keepWriting) break;
			}
		} catch (batchErr) {
			const batchMessage = embeddingFailureMessage(batchErr);
			if (!shouldIsolateTemplateFailures(batchErr)) {
				console.warn(
					'[backfill] Batch embedding generation failed globally; skipping per-template fallback:',
					batchMessage
				);
				for (const template of batch) {
					errors.push({
						stage: 'embedding_generation',
						id: template._id,
						error: batchMessage
					});
				}
			} else {
				console.warn(
					'[backfill] Batch contains invalid content; isolating individual templates:',
					batchMessage
				);

				// One malformed/safety-rejected template must not pin the first page of
				// missing rows forever. The efficient one-call batch remains the normal
				// path; only an input-specific failure falls back to bounded four-way
				// isolation, with Gemini's internal retries disabled because the batch
				// already exhausted them. Successful siblings advance and the exact failed
				// IDs are reported.
				let keepWriting = true;
				for (let offset = 0; offset < batch.length && keepWriting; offset += FALLBACK_CONCURRENCY) {
					const candidates = batch.slice(offset, offset + FALLBACK_CONCURRENCY);
					const outcomes = await Promise.all(
						candidates.map(async (template, candidateIndex) => {
							try {
								const embeddings = await generateBatchEmbeddings(
									textPairs[offset + candidateIndex],
									FALLBACK_EMBEDDING_TASK
								);
								return { template, embeddings };
							} catch (templateError) {
								return { template, error: templateError };
							}
						})
					);

					for (const outcome of outcomes) {
						if ('error' in outcome) {
							errors.push({
								stage: 'embedding_generation',
								id: outcome.template._id,
								error: embeddingFailureMessage(outcome.error)
							});
							continue;
						}

						keepWriting = await writeEmbeddings(outcome.template._id, outcome.embeddings);
						if (!keepWriting) break;
					}
				}
			}
		}

		if (totalProcessed > 0) {
			try {
				await serverMutation(api.templates.rebuildHomepageSnapshotsAfterBackfill, {
					_secret: internalSecret,
					leaseToken
				});
			} catch (rebuildError) {
				const message = embeddingFailureMessage(rebuildError);
				errors.push({ stage: 'snapshot_rebuild', error: message });
				console.error('[backfill] Immediate snapshot rebuild failed', rebuildError);
			}
		}

		console.log(
			`[backfill] Processed ${totalProcessed}/${batch.length} templates, ${errors.length} errors`
		);

		return json({
			processed: totalProcessed,
			total_missing: batch.length,
			batch_cap: BATCH_SIZE,
			may_have_more: missing.length >= BATCH_SIZE,
			errors: errors.length > 0 ? errors : undefined
		});
	} finally {
		// A reclaimed lease has a different token, so an old isolate can never
		// clear the new owner's generation. Expiry remains the eviction fallback.
		try {
			await serverMutation(api.templates.releaseEmbeddingBackfillLease, {
				_secret: internalSecret,
				token: leaseToken
			});
		} catch (releaseError) {
			console.error('[backfill] Failed to release distributed lease', releaseError);
		}
	}
};
