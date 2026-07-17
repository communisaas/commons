import { json, error } from '@sveltejs/kit';
// CONVEX: Keep SvelteKit — Gemini embeddings external API
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { generateBatchEmbeddings } from '$lib/core/search/gemini-embeddings';
import { env } from '$env/dynamic/private';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

const BATCH_SIZE = 20;

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
		const errors: Array<{ id: string; error: string }> = [];

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
						_secret: internalSecret
					});
					totalProcessed++;
				} catch (writeErr) {
					errors.push({
						id: templateId,
						error: writeErr instanceof Error ? writeErr.message : String(writeErr)
					});
				}
			}
		} catch (batchErr) {
			// Entire batch failed (Gemini API error)
			for (const t of batch) {
				errors.push({
					id: t._id,
					error: batchErr instanceof Error ? batchErr.message : String(batchErr)
				});
			}
		}

		if (totalProcessed > 0) {
			await serverMutation(api.templates.rebuildHomepageSnapshotsAfterBackfill, {
				_secret: internalSecret
			});
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
