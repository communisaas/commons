/**
 * Cost Monitor for legislation sync cron runs.
 *
 * Tracks API calls and embedding generations during a single cron invocation.
 * Returns a cost summary for observability — no external dependencies.
 */

/** Per-unit cost estimates (USD) */
const COST_PER_EMBEDDING = 0.00001; // Gemini text-embedding-004, 768-dim

export interface CostSummary {
	api_calls: {
		congress_gov: number;
		open_states: number;
	};
	embeddings: number;
	cosine_queries: number;
	estimated_usd: number;
}

export class CronCostMonitor {
	private congressGovCalls = 0;
	private openStatesCalls = 0;
	private embeddingsGenerated = 0;
	private cosineQueries = 0;

	trackCongressGovCall(count = 1): void {
		this.congressGovCalls += count;
	}

	trackOpenStatesCall(count = 1): void {
		this.openStatesCalls += count;
	}

	trackEmbeddings(count: number): void {
		this.embeddingsGenerated += count;
	}

	trackCosineQuery(count = 1): void {
		this.cosineQueries += count;
	}

	summarize(): CostSummary {
		const embeddingCost = this.embeddingsGenerated * COST_PER_EMBEDDING;
		// Congress.gov and Open States are free (API key based)
		// pgvector cosine similarity is negligible (local DB operation)
		return {
			api_calls: {
				congress_gov: this.congressGovCalls,
				open_states: this.openStatesCalls
			},
			embeddings: this.embeddingsGenerated,
			cosine_queries: this.cosineQueries,
			estimated_usd: Math.round(embeddingCost * 1_000_000) / 1_000_000 // 6 decimal places
		};
	}
}
