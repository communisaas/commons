/**
 * Aggregate Types
 *
 * Types for the aggregation data model.
 */

import type { Metric, Dimensions, DimensionKey, DeliveryMethod, ErrorType } from './metrics';

// =============================================================================
// DATABASE RECORD
// =============================================================================

/**
 * Aggregate record as stored in database
 */
export interface AggregateRecord {
	id: string;
	date: Date;
	metric: Metric;
	template_id: string | null;
	jurisdiction: string | null;
	delivery_method: DeliveryMethod | null;
	utm_source: string | null;
	error_type: ErrorType | null;
	count: number;
	noise_applied: number;
	epsilon: number;
}

/**
 * Increment request (single)
 */
export interface Increment {
	metric: Metric;
	dimensions?: Dimensions;
}

/**
 * Batch increment request
 */
export interface IncrementBatch {
	increments: Increment[];
}

/**
 * Increment response
 */
export interface IncrementResponse {
	success: boolean;
	processed: number;
	dropped: number;
}

// =============================================================================
// QUERY TYPES
// =============================================================================

/**
 * Query parameters
 */
export interface AggregateQuery {
	metric: Metric;
	start: Date;
	end: Date;
	groupBy?: DimensionKey[];
	filters?: {
		template_id?: string;
		jurisdiction?: string;
		delivery_method?: DeliveryMethod;
	};
}

/**
 * Single query result row
 */
export interface AggregateResult {
	dimensions: Partial<Record<DimensionKey, string | null>>;
	count: number; // Always noisy
	coarsened: boolean;
	coarsen_level?: string;
	original_level?: string;
}

/**
 * Privacy metadata included in responses
 */
export interface PrivacyMetadata {
	epsilon: number;
	differential_privacy: boolean;
	ldp_corrected: boolean;
	coarsening_applied: boolean;
	coarsen_threshold: number;
}

/**
 * Full query response
 */
export interface AggregateQueryResponse {
	success: boolean;
	metric: Metric;
	date_range: {
		start: string;
		end: string;
	};
	results: AggregateResult[];
	privacy: PrivacyMetadata;
}

// =============================================================================
// DASHBOARD TYPES
// =============================================================================

/**
 * Platform health metrics
 */
export interface HealthMetrics {
	template_adoption: {
		views_30d: number;
		uses_30d: number;
		conversion_rate: number;
	};
	delivery_health: {
		attempted_7d: number;
		succeeded_7d: number;
		failed_7d: number;
		success_rate: number;
	};
	error_summary: {
		network_7d: number;
		validation_7d: number;
		auth_7d: number;
	};
}

/**
 * Health dashboard response
 */
export interface HealthResponse {
	success: boolean;
	metrics: HealthMetrics;
	privacy: PrivacyMetadata;
	generated_at: string;
}
