/**
 * Bill Embedding Generator
 *
 * Computes 768-dim embeddings for Bill rows using Gemini embedding model.
 * Stores via raw SQL UPDATE with ::vector(768) cast.
 *
 * Batch processing: up to 100 bills per embedding call (Gemini batch limit).
 * If summary is null, embeds title only (shorter but sufficient for relevance).
 */

import { db } from '$lib/core/db';
import { Prisma } from '@prisma/client';
import {
	generateBatchEmbeddings,
	truncateText,
	EMBEDDING_CONFIG
} from '$lib/core/search/gemini-embeddings';

/** Track which embedding model version was used (for future recomputation) */
export const BILL_EMBEDDING_MODEL = EMBEDDING_CONFIG.model;

const BATCH_SIZE = 100; // Gemini batch limit

/**
 * Build the text to embed for a bill.
 * Combines title + summary for richer semantic representation.
 * Falls back to title-only if summary is null.
 */
function buildEmbeddingText(title: string, summary: string | null): string {
	if (!summary) return title;
	return truncateText(`${title}\n\n${summary}`);
}

/**
 * Generate and store embeddings for bills that don't have them yet.
 *
 * @param limit - Max bills to process (default 100)
 * @returns Number of bills embedded
 */
export async function embedNewBills(limit: number = BATCH_SIZE): Promise<number> {
	// Find bills without embeddings
	// topicEmbedding is Unsupported type in Prisma, so use raw SQL to check NULL
	const bills = await db.$queryRaw<Array<{ id: string; title: string; summary: string | null }>>`
		SELECT id, title, summary
		FROM bill
		WHERE topic_embedding IS NULL
		ORDER BY created_at DESC
		LIMIT ${limit}
	`;

	if (bills.length === 0) return 0;

	// Build texts for batch embedding
	const texts = bills.map((b) => buildEmbeddingText(b.title, b.summary));

	// Process in batches of BATCH_SIZE
	let totalEmbedded = 0;

	for (let i = 0; i < texts.length; i += BATCH_SIZE) {
		const batchTexts = texts.slice(i, i + BATCH_SIZE);
		const batchBills = bills.slice(i, i + BATCH_SIZE);

		const embeddings = await generateBatchEmbeddings(batchTexts, {
			taskType: 'RETRIEVAL_DOCUMENT'
		});

		// F-R6-07: Validate each embedding sub-array for NaN/Infinity
		for (const emb of embeddings) {
			if (!emb.every(Number.isFinite)) {
				throw new Error('Invalid embedding from AI model: contains NaN or Infinity');
			}
		}

		// Store embeddings via single batch UPDATE...FROM
		const values = batchBills.map((bill, j) => {
			const vectorStr = `[${embeddings[j].join(',')}]`;
			return Prisma.sql`(${bill.id}::text, ${vectorStr}::vector(768))`;
		});
		await db.$executeRaw`
			UPDATE bill SET topic_embedding = v.embedding
			FROM (VALUES ${Prisma.join(values)}) AS v(id, embedding)
			WHERE bill.id = v.id
		`;

		totalEmbedded += batchBills.length;
	}

	console.log(`[bill-embedder] Generated embeddings for ${totalEmbedded} bills`);
	return totalEmbedded;
}

/**
 * Re-embed a specific bill (e.g., after summary update).
 *
 * @param billId - Database ID of the bill to re-embed
 */
export async function reembedBill(billId: string): Promise<void> {
	const bill = await db.bill.findUnique({
		where: { id: billId },
		select: { title: true, summary: true }
	});

	if (!bill) {
		throw new Error(`Bill not found: ${billId}`);
	}

	const text = buildEmbeddingText(bill.title, bill.summary);
	const embeddings = await generateBatchEmbeddings([text], {
		taskType: 'RETRIEVAL_DOCUMENT'
	});

	if (!embeddings[0].every(Number.isFinite)) {
		throw new Error('Invalid embedding from AI model: contains NaN or Infinity');
	}

	const vectorStr = `[${embeddings[0].join(',')}]`;

	await db.$executeRaw`
		UPDATE bill
		SET topic_embedding = ${vectorStr}::vector(768)
		WHERE id = ${billId}
	`;
}
