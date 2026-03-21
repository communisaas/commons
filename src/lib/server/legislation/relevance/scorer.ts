/**
 * Relevance Scorer: bill embedding ↔ org issue domain cosine similarity
 *
 * ARCHITECTURE: Set-based SQL, NOT per-org loop.
 * For each newly embedded bill, ONE query scores ALL orgs simultaneously.
 * Complexity is O(bills), not O(bills × orgs).
 */

import { db } from '$lib/core/db';

export interface RelevanceMatch {
	orgId: string;
	label: string;
	score: number;
}

export interface ScoringResult {
	billId: string;
	matchesFound: number;
	rowsUpserted: number;
}

/** Minimum cosine similarity to persist an OrgBillRelevance row */
const RELEVANCE_THRESHOLD = 0.6;

/**
 * Score a single bill against ALL org issue domains in one query.
 * Returns the number of OrgBillRelevance rows upserted.
 */
export async function scoreBillRelevance(billId: string): Promise<ScoringResult> {
	// Single query: compute cosine similarity between this bill's embedding
	// and every org issue domain embedding that exceeds the threshold.
	const matches = await db.$queryRaw<RelevanceMatch[]>`
		SELECT
			oid.org_id AS "orgId",
			oid.label,
			1 - (b.topic_embedding <=> oid.embedding) AS score
		FROM org_issue_domain oid
		CROSS JOIN bill b
		WHERE b.id = ${billId}
			AND b.topic_embedding IS NOT NULL
			AND oid.embedding IS NOT NULL
			AND 1 - (b.topic_embedding <=> oid.embedding) > ${RELEVANCE_THRESHOLD}
		ORDER BY score DESC
	`;

	if (matches.length === 0) {
		return { billId, matchesFound: 0, rowsUpserted: 0 };
	}

	// Group matches by org — one OrgBillRelevance row per org,
	// using the best score and collecting all matched domain labels.
	const orgMap = new Map<string, { bestScore: number; labels: string[] }>();
	for (const m of matches) {
		const existing = orgMap.get(m.orgId);
		if (existing) {
			existing.labels.push(m.label);
			if (m.score > existing.bestScore) existing.bestScore = m.score;
		} else {
			orgMap.set(m.orgId, { bestScore: m.score, labels: [m.label] });
		}
	}

	// Upsert OrgBillRelevance rows via Prisma — safe, typed, no SQL injection risk.
	// Uses createMany where possible; falls back to individual upserts for ON CONFLICT.
	let rowsUpserted = 0;
	const entries = Array.from(orgMap.entries());

	for (const [orgId, { bestScore, labels }] of entries) {
		await db.orgBillRelevance.upsert({
			where: { orgId_billId: { orgId, billId } },
			create: {
				orgId,
				billId,
				score: bestScore,
				matchedOn: labels
			},
			update: {
				score: bestScore,
				matchedOn: labels
			}
		});
		rowsUpserted++;
	}

	return { billId, matchesFound: matches.length, rowsUpserted };
}

/**
 * Score multiple bills. Returns aggregate results.
 * Errors on individual bills are logged but don't abort the batch.
 */
export async function scoreBillsBatch(
	billIds: string[]
): Promise<{ results: ScoringResult[]; errors: Array<{ billId: string; error: string }> }> {
	const results: ScoringResult[] = [];
	const errors: Array<{ billId: string; error: string }> = [];

	for (const billId of billIds) {
		try {
			const result = await scoreBillRelevance(billId);
			results.push(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown scoring error';
			console.error(`[scorer] Failed to score bill ${billId}:`, message);
			errors.push({ billId, error: message });
		}
	}

	return { results, errors };
}
