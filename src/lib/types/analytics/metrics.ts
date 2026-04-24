/**
 * Analytics Metrics & Dimension Definitions
 *
 * Whitelists for allowed values. Anything not on these lists is rejected.
 */

// =============================================================================
// METRICS
// =============================================================================

/**
 * Allowed metric names
 *
 * These are the ONLY metrics that can be incremented.
 * Grouped by category for clarity.
 */
export const METRICS = {
	// Template lifecycle
	template_view: 'template_view',
	template_use: 'template_use',
	template_share: 'template_share',

	// Delivery outcomes
	delivery_attempt: 'delivery_attempt',
	delivery_success: 'delivery_success',
	delivery_fail: 'delivery_fail',

	// Authentication
	auth_start: 'auth_start',
	auth_complete: 'auth_complete',

	// Re-grounding (address change by verified constituent)
	address_changed: 'address_changed',

	// Errors (categorized, never raw messages)
	error_network: 'error_network',
	error_validation: 'error_validation',
	error_auth: 'error_auth',
	error_timeout: 'error_timeout',
	error_unknown: 'error_unknown',

	// Funnel progression
	funnel_1: 'funnel_1',
	funnel_2: 'funnel_2',
	funnel_3: 'funnel_3',
	funnel_4: 'funnel_4',
	funnel_5: 'funnel_5',

	// Cohort tracking
	cohort_first_seen: 'cohort_first_seen',
	cohort_return: 'cohort_return'
} as const;

export type Metric = (typeof METRICS)[keyof typeof METRICS];

export const METRIC_VALUES = Object.values(METRICS);

/**
 * Domain size for k-ary Randomized Response
 *
 * Used in debiasing calculations on the server side.
 */
export const METRIC_DOMAIN_SIZE = METRIC_VALUES.length;

// =============================================================================
// DIMENSIONS
// =============================================================================

/**
 * Delivery methods
 */
export const DELIVERY_METHODS = {
	cwc: 'cwc', // Communicating With Congress
	email: 'email',
	certified: 'certified'
} as const;

export type DeliveryMethod = (typeof DELIVERY_METHODS)[keyof typeof DELIVERY_METHODS];

/**
 * Error types (categorized)
 *
 * Raw error messages are NEVER stored. They are mapped to these
 * categories to prevent PII leakage through stack traces.
 */
export const ERROR_TYPES = {
	network: 'error_network',
	validation: 'error_validation',
	auth: 'error_auth',
	timeout: 'error_timeout',
	unknown: 'error_unknown'
} as const;

export type ErrorType = (typeof ERROR_TYPES)[keyof typeof ERROR_TYPES];

/**
 * Dimensions for aggregation
 *
 * CRITICAL: No session_id, no user_id, no ip_address, no fingerprint
 */
export interface Dimensions {
	/** Template identifier (public, non-PII) */
	template_id?: string;
	/** State code only (2 uppercase chars), NEVER district */
	jurisdiction?: string;
	/** Delivery method from whitelist */
	delivery_method?: DeliveryMethod;
	/** UTM source (sanitized, alphanumeric only) */
	utm_source?: string;
	/** Error type from categorized whitelist */
	error_type?: ErrorType;
	/** Cohort token (random UUID, optional) */
	cohort_token?: string;
}

/**
 * Dimension keys for grouping queries
 */
export type DimensionKey = keyof Dimensions;

export const DIMENSION_KEYS: DimensionKey[] = [
	'template_id',
	'jurisdiction',
	'delivery_method',
	'utm_source',
	'error_type'
];

// =============================================================================
// PRIVACY CONFIGURATION
// =============================================================================

/**
 * Differential Privacy Parameters
 *
 * These values control the privacy-utility tradeoff. Lower epsilon means
 * stronger privacy but less accurate results. Higher epsilon means weaker
 * privacy but more accurate results.
 *
 * EPSILON (ε) INTERPRETATION:
 * - ε = 0.1: Very strong privacy (high noise, low accuracy)
 * - ε = 1.0: Strong privacy (moderate noise, good accuracy) ← SERVER_EPSILON
 * - ε = 2.0: Moderate privacy (low noise, high accuracy) ← CLIENT_EPSILON
 * - ε = 10+: Weak privacy (minimal noise, highest accuracy) ← Daily budget
 *
 * FORMAL GUARANTEE:
 * For any two datasets D and D' differing by one person's data:
 *   Pr[M(D) ∈ S] ≤ e^ε × Pr[M(D') ∈ S]
 *
 * This bounds how much the output changes when one person opts out.
 *
 * COMPOSITION:
 * - Running k queries with ε₁, ε₂, ..., εₖ gives total budget Σεᵢ
 * - Each snapshot materialization: ε = 1.0
 * - Daily budget: ε = 10.0 (allows 10 snapshots or equivalent)
 *
 * CALIBRATION:
 * - Laplace noise scale: λ = Δ/ε = 1/ε (since sensitivity Δ = 1)
 * - SERVER_EPSILON = 1.0 → λ = 1.0 (standard deviation ≈ 1.41)
 * - CLIENT_EPSILON = 2.0 → randomized response with p = e^2/(e^2 + k - 1)
 */
export const PRIVACY = {
	/**
	 * Local DP epsilon (client-side noise)
	 *
	 * ε = 2.0 for k-ary Randomized Response
	 *
	 * Applied BEFORE data leaves the client browser.
	 * Protects individual events from being traced to a specific user.
	 *
	 * With k = 24 metrics:
	 * - Truth probability: p = e^2 / (e^2 + 23) ≈ 0.24
	 * - Lie probability: (1-p) / (k-1) ≈ 0.033 per alternative metric
	 *
	 * This means each metric report has a 76% chance of being randomized,
	 * making it impossible to confidently attribute an event to a user.
	 */
	CLIENT_EPSILON: 2.0,

	/**
	 * Central DP epsilon (server-side noise)
	 *
	 * ε = 1.0 for Laplace mechanism
	 *
	 * Applied ONCE per day during snapshot materialization at 00:05 UTC.
	 * Protects aggregate counts from revealing individual contributions.
	 *
	 * With sensitivity Δ = 1 (rate limiting ensures each user contributes ≤1):
	 * - Noise scale: λ = 1/ε = 1.0
	 * - Standard deviation: σ = λ√2 ≈ 1.41
	 * - 95% CI: count ± 2.77 (approximately)
	 *
	 * This means for a true count of 100, the noisy count will be
	 * in [97, 103] about 68% of the time, and [95, 105] about 95% of the time.
	 */
	SERVER_EPSILON: 1.0,

	/**
	 * Sensitivity for counting queries
	 *
	 * Δ = 1 (maximum change in count when one person opts out)
	 *
	 * This is enforced by rate limiting: each user can contribute at most
	 * MAX_DAILY_CONTRIBUTIONS events per metric per day. For counting queries,
	 * this bounds the sensitivity to 1.
	 */
	SENSITIVITY: 1,

	/**
	 * Daily query budget (privacy budget)
	 *
	 * ε_total = 10.0 per day
	 *
	 * Tracked in privacy_budget table. Each snapshot materialization
	 * consumes SERVER_EPSILON = 1.0, allowing 10 snapshots per day.
	 *
	 * When budget is exceeded, queries are blocked to prevent privacy leakage.
	 * Budget resets daily at 00:00 UTC.
	 */
	MAX_DAILY_EPSILON: 10.0,

	/** Coarsening threshold (roll up counts below this) */
	COARSEN_THRESHOLD: 5,

	/** Maximum date range for queries */
	MAX_QUERY_DAYS: 90,

	/** Maximum batch size for increments */
	MAX_BATCH_SIZE: 100,

	/** Cohort token TTL in days */
	COHORT_TTL_DAYS: 30,

	/**
	 * Maximum contributions per metric per day per client
	 *
	 * Ensures sensitivity Δ = 1 for differential privacy.
	 * Rate limiting enforced server-side using hashed IP addresses.
	 */
	MAX_DAILY_CONTRIBUTIONS: 100
} as const;

// =============================================================================
// TYPE GUARDS
// =============================================================================

export function isMetric(value: string): value is Metric {
	return METRIC_VALUES.includes(value as Metric);
}

export function isDeliveryMethod(value: string): value is DeliveryMethod {
	return Object.values(DELIVERY_METHODS).includes(value as DeliveryMethod);
}

export function isErrorType(value: string): value is ErrorType {
	return Object.values(ERROR_TYPES).includes(value as ErrorType);
}

export function isDimensionKey(value: string): value is DimensionKey {
	return DIMENSION_KEYS.includes(value as DimensionKey);
}
