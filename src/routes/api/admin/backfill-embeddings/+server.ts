import { json, error } from '@sveltejs/kit';
// CONVEX: Keep SvelteKit — Gemini embeddings external API
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { generateBatchEmbeddings } from '$lib/core/search/gemini-embeddings';
import { env } from '$env/dynamic/private';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

/** In-memory guard to prevent concurrent backfill runs */
let backfillRunning = false;

/** Admin user IDs — populated from ADMIN_USER_IDS env var (comma-separated) */
const ADMIN_USER_IDS = new Set((env.ADMIN_USER_IDS || '').split(',').filter(Boolean));

/**
 * POST /api/admin/backfill-embeddings
 *
 * Repairs at most 100 public templates that have never completed an embedding
 * write, using the exact bounded Convex index. Processes in Gemini batches of
 * 20; repeat the operation to drain a larger legacy backlog.
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

	// Concurrency guard
	if (backfillRunning) {
		throw error(429, 'Backfill already in progress. Please wait for it to complete.');
	}

	backfillRunning = true;

	try {
		// Find templates missing embeddings via Convex
		const internalSecret = getInternalSecret();
		const missing = await serverQuery(api.templates.listMissingEmbeddings, {
			_secret: internalSecret,
			limit: 100
		});

		if (missing.length === 0) {
			return json({ processed: 0, message: 'All templates have embeddings' });
		}

		const BATCH_SIZE = 20;
		let totalProcessed = 0;
		const errors: Array<{ id: string; error: string }> = [];

		for (let i = 0; i < missing.length; i += BATCH_SIZE) {
			const batch = missing.slice(i, i + BATCH_SIZE);

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

				// Write embeddings back via Convex
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
		}

		if (totalProcessed > 0) {
			await serverMutation(api.templates.rebuildHomepageSnapshotsAfterBackfill, {
				_secret: internalSecret
			});
		}

		console.log(
			`[backfill] Processed ${totalProcessed}/${missing.length} templates, ${errors.length} errors`
		);

		return json({
			processed: totalProcessed,
			total_missing: missing.length,
			batch_cap: 100,
			may_have_more: missing.length === 100,
			errors: errors.length > 0 ? errors : undefined
		});
	} finally {
		backfillRunning = false;
	}
};
