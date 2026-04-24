/**
 * Client-Side Embedding Search — Server-Delegated
 *
 * Delegates semantic search to `/api/templates/search` which runs a
 * Convex `.vectorIndex(...)` query + quality boost. This unifies the search
 * pipeline so client and server use the same ranking logic.
 *
 * The class interface is preserved for backward compatibility with
 * TemplateRanker and createSemanticSearch().
 */

import type { TemplateWithEmbedding, SearchQuery, SearchResult } from './types';
import { api } from '$lib/core/api/client';

/** Shape returned by the server search endpoint */
interface ServerSearchResult {
	id: string;
	slug: string;
	title: string;
	description: string;
	verified_sends: number;
	unique_districts: number;
	similarity: number | null;
}

interface ServerSearchResponse {
	templates: ServerSearchResult[];
	method: 'semantic' | 'keyword';
}

export class EmbeddingSearch {
	private templates: TemplateWithEmbedding[];
	private apiBaseURL: string;

	constructor(templates: TemplateWithEmbedding[], apiBaseURL = '/api') {
		this.templates = templates;
		this.apiBaseURL = apiBaseURL;
	}

	/**
	 * Generate embedding for search query via server endpoint.
	 * Kept for backward compatibility with TemplateRanker.rankWithMetadata().
	 * Returns empty array since server handles embedding internally.
	 */
	async generateQueryEmbedding(query: string): Promise<number[]> {
		if (!query || query.trim().length === 0) {
			throw new Error('Query cannot be empty');
		}

		// The server search endpoint generates embeddings internally.
		// Return empty array — callers use this only for metadata, not computation.
		return [];
	}

	/**
	 * Search templates via server-side semantic search endpoint.
	 * Server runs a Convex `.vectorIndex(...)` cosine search + quality boost + 0.40 floor.
	 */
	async search(query: SearchQuery): Promise<Array<TemplateWithEmbedding & { similarity: number }>> {
		const startTime = performance.now();

		const response = await api.post<ServerSearchResponse>(
			`${this.apiBaseURL}/templates/search`,
			{
				query: query.query,
				limit: query.limit ?? 20,
				excludeIds: []
			},
			{ showToast: false }
		);

		if (!response.success || !response.data) {
			console.warn('[embedding-search] Server search failed, returning empty results');
			return [];
		}

		const serverResults = response.data.templates;

		// Map server results back to TemplateWithEmbedding shape.
		// Merge with local template data for fields the server doesn't return.
		const templateMap = new Map(this.templates.map((t) => [t.id, t]));

		const results: Array<TemplateWithEmbedding & { similarity: number }> = [];
		for (const sr of serverResults) {
			const local = templateMap.get(sr.id);
			if (local) {
				results.push({
					...local,
					similarity: sr.similarity ?? 0
				});
			} else {
				// Template not in local cache — create minimal entry
				results.push({
					id: sr.id,
					slug: sr.slug,
					title: sr.title,
					description: sr.description,
					domain: '',
					location_embedding: null,
					topic_embedding: null,
					embedding_version: '',
					jurisdictions: [],
					quality_score: 0,
					created_at: '',
					similarity: sr.similarity ?? 0
				});
			}
		}

		const endTime = performance.now();
		console.debug(`[embedding-search] Server search completed in ${(endTime - startTime).toFixed(2)}ms`);

		return results;
	}

	/**
	 * Search with full result metadata
	 */
	async searchWithMetadata(query: SearchQuery): Promise<SearchResult> {
		const startTime = performance.now();
		const results = await this.search(query);

		return {
			results: results.map((r, index) => ({
				...r,
				boost: { geographic: 1, temporal: 1, network: 1, impact: 1 },
				final_score: r.similarity,
				rank: index + 1
			})),
			query: query.query,
			total_results: results.length,
			query_embedding: [], // Server handles embeddings internally
			search_time_ms: performance.now() - startTime,
			cached: false
		};
	}

	/**
	 * Update templates (e.g., after fetching fresh data)
	 */
	updateTemplates(templates: TemplateWithEmbedding[]): void {
		this.templates = templates;
	}

	/**
	 * Get all templates (for debugging)
	 */
	getTemplates(): TemplateWithEmbedding[] {
		return this.templates;
	}
}

/**
 * Create embedding search instance
 */
export function createEmbeddingSearch(templates: TemplateWithEmbedding[]): EmbeddingSearch {
	return new EmbeddingSearch(templates);
}
