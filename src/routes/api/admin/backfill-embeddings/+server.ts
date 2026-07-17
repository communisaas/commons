import { json, error } from '@sveltejs/kit';
// CONVEX: Keep SvelteKit — Gemini embeddings external API
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { generateBatchEmbeddings } from '$lib/core/search/gemini-embeddings';
import { env } from '$env/dynamic/private';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

const BATCH_SIZE = 20;

type BackfillError =
	| { stage: 'embedding_generation' | 'embedding_write'; id: string; error: string }
	| { stage: 'snapshot_rebuild'; error: string };

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
export const POST: RequestHandler = async ({ locals }) => {
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

		// Build text pairs: [location0, topic0, location1, topic1, ...]
		const texts: string[] = [];
		for (const t of batch) {
			const locationText = `${t.title} ${t.description || ''} ${t.domain}`;
			const topicText = `${t.title} ${t.description || ''} ${t.messageBody}`;
			texts.push(locationText, topicText);
		}

		try {
			const embeddings = await generateBatchEmbeddings(texts, {
				taskType: 'RETRIEVAL_DOCUMENT'
			});

			// Write embeddings back via Convex. Every successful mutation marks the
			// relation materialization dirty in the same transaction.
			for (let j = 0; j < batch.length; j++) {
				const templateId = batch[j]._id;

				try {
					await serverMutation(api.templates.updateMissingEmbeddingsForBackfill, {
						templateId,
						locationEmbedding: embeddings[j * 2],
						topicEmbedding: embeddings[j * 2 + 1],
						_secret: internalSecret,
						leaseToken
					});
					totalProcessed++;
				} catch (writeErr) {
					const message = writeErr instanceof Error ? writeErr.message : String(writeErr);
					errors.push({
						stage: 'embedding_write',
						id: templateId,
						error: message
					});
					// Once this worker loses or outlives its lease, every later write
					// would fail the same authoritative Convex check.
					if (message.includes('EMBEDDING_BACKFILL_LEASE_')) break;
				}
			}
		} catch (batchErr) {
			// Entire batch failed (Gemini API error)
			for (const t of batch) {
				errors.push({
					stage: 'embedding_generation',
					id: t._id,
					error: batchErr instanceof Error ? batchErr.message : String(batchErr)
				});
			}
		}

		if (totalProcessed > 0) {
			try {
				await serverMutation(api.templates.rebuildHomepageSnapshotsAfterBackfill, {
					_secret: internalSecret,
					leaseToken
				});
			} catch (rebuildError) {
				const message = rebuildError instanceof Error ? rebuildError.message : String(rebuildError);
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
