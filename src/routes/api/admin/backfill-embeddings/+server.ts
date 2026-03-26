import { json, error } from '@sveltejs/kit';
// CONVEX: Keep SvelteKit — Gemini embeddings external API
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { generateBatchEmbeddings } from '$lib/core/search/gemini-embeddings';
import { env } from '$env/dynamic/private';

/** In-memory guard to prevent concurrent backfill runs */
let backfillRunning = false;

/** Admin user IDs — populated from ADMIN_USER_IDS env var (comma-separated) */
const ADMIN_USER_IDS = new Set((env.ADMIN_USER_IDS || '').split(',').filter(Boolean));

/**
 * POST /api/admin/backfill-embeddings
 *
 * Finds all templates where topicEmbedding is missing and regenerates
 * embeddings via Gemini batch API. Processes in batches of 20.
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
		const missing = await serverQuery(api.templates.listMissingEmbeddings, {});

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
				const locationText = `${t.title} ${t.description || ''} ${t.category}`;
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
						await serverMutation(api.templates.updateEmbeddings, {
							templateId: templateId as any,
							locationEmbedding: embeddings[j * 2],
							topicEmbedding: embeddings[j * 2 + 1]
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

		console.log(`[backfill] Processed ${totalProcessed}/${missing.length} templates, ${errors.length} errors`);

		return json({
			processed: totalProcessed,
			total_missing: missing.length,
			errors: errors.length > 0 ? errors : undefined
		});
	} finally {
		backfillRunning = false;
	}
};
