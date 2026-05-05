/**
 * Type definitions for the semantic search facade.
 *
 * These are intentionally local to search so the client-side search helpers do
 * not depend on deleted Prisma model exports.
 */

export interface TemplateJurisdiction {
	jurisdiction_type?: 'federal' | 'state' | 'county' | 'city' | string;
	congressional_district?: string | null;
	state_code?: string | null;
	county_fips?: string | null;
	city_fips?: string | null;
}

export interface TemplateWithEmbedding {
	id: string;
	slug: string;
	title: string;
	description: string;
	domain: string;
	category?: string;
	location_embedding: number[] | null;
	topic_embedding: number[] | null;
	embedding_version: string;
	jurisdictions: TemplateJurisdiction[];
	quality_score: number;
	created_at: string;
}

export interface BoostingFactors {
	geographic: number;
	temporal: number;
	network: number;
	impact: number;
}

export interface RankedTemplate extends TemplateWithEmbedding {
	similarity: number;
	boost: BoostingFactors;
	final_score: number;
	rank: number;
}

export interface CachedSearchResult {
	query: string;
	results: RankedTemplate[];
	timestamp: string;
	expires_at: string;
}

export interface CachedEmbedding {
	text: string;
	embedding: number[];
	model: string;
	timestamp: string;
	expires_at: string;
}

export interface InferredLocation {
	congressional_district?: string | null;
	state_code?: string | null;
	county_fips?: string | null;
	city_fips?: string | null;
	city_name?: string | null;
	latitude?: number | null;
	longitude?: number | null;
	confidence?: number;
	source?: string;
}

export interface SearchQuery {
	query: string;
	userLocation?: InferredLocation;
	limit?: number;
	minSimilarity?: number;
	enableBoosting?: boolean;
	jurisdictionFilter?: {
		type: 'federal' | 'state' | 'county' | 'city';
		value: string;
	};
}

export interface SearchResult {
	results: RankedTemplate[];
	query: string;
	total_results: number;
	query_embedding: number[];
	search_time_ms: number;
	cached: boolean;
}

export interface RankingExplanation {
	template_id: string;
	title: string;
	similarity: number;
	boost: BoostingFactors;
	final_score: number;
	rank: number;
	explanation: string;
}
