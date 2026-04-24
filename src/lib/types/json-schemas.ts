/**
 * Comprehensive type definitions for every JSON (v.any()) field in the Convex schema.
 * Provides type-safe access patterns for JsonValue data.
 */

/** JSON value type. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// ============= ANALYTICS SCHEMA TYPES =============

/**
 * Analytics Session entity - tracks user sessions with metrics
 */
export interface AnalyticsSession {
	id: string;
	session_id: string;
	user_id?: string | null;
	created_at: Date;
	updated_at: Date;
	metrics: AnalyticsSessionMetrics;
	device_data?: AnalyticsDeviceData;
	funnel_progress?: AnalyticsFunnelProgress;
	computed_metrics?: AnalyticsComputedMetrics;
}

export interface AnalyticsSessionMetrics {
	events_count: number;
	page_views: number;
	duration_ms: number;
	conversion_count: number;
	bounce_rate: number;
	funnel_conversions: number;
	last_event_timestamp: string;
	predictive_metrics: {
		lifetime_value_estimate: number;
		churn_probability: number;
		engagement_score: number;
	};
	performance_metrics: {
		error_count: number;
		load_time_avg: number;
		interaction_delay: number;
	};
}

export interface AnalyticsDeviceData {
	ip_address: string;
	user_agent: string;
	fingerprint: string;
	device_type: 'desktop' | 'mobile' | 'tablet';
	browser: string;
	os: string;
	viewport: {
		width: number;
		height: number;
	};
	connection_type: '3g' | '4g' | '5g' | 'wifi' | 'ethernet';
	accessibility: {
		screen_reader: boolean;
		high_contrast: boolean;
		reduced_motion: boolean;
	};
}

export interface AnalyticsFunnelProgress {
	[funnelId: string]: {
		current_step: number;
		completed_steps: number[];
		started_at: string;
		last_step_at: string;
		completion_rate: number;
	};
}

export interface AnalyticsEventProperties {
	[key: string]: unknown;
	// Common properties
	template_id?: string;
	variation?: string;
	step?: number;
	page?: string;
	language?: string;
	migration_source?: string;

	// Nested objects
	user_interaction?: {
		mouse_events: Array<{
			type: 'click' | 'hover' | 'scroll';
			target: string;
			timestamp: number;
		}>;
		keyboard_events: Array<{
			type: 'keydown' | 'keyup';
			key: string;
			timestamp: number;
		}>;
	};

	page_metadata?: {
		title: string;
		url: string;
		tags: string[];
		category: string;
	};

	performance_metrics?: {
		load_time: number;
		first_paint: number;
		largest_contentful_paint: number;
	};

	engagement_data?: {
		interactions: string[];
		time_on_page: number;
		scroll_depth: number;
	};

	// International and complex data
	international_text?: {
		chinese?: string;
		emoji?: string;
		arabic?: string;
	};

	special_characters?: {
		json_meta?: string;
		html_entities?: string;
		unicode_symbols?: string;
	};

	edge_cases?: {
		very_long_string?: string;
		empty_object?: Record<string, never>;
		null_prototype?: unknown;
	};

	// Arrays and mixed data
	mixed_array?: unknown[];
	user_journey?: Array<{
		step: string;
		timestamp: number;
		duration: number;
	}>;

	experimental_flags?: Array<{
		name: string;
		enabled: boolean;
		version: string;
	}>;
}

export interface AnalyticsComputedMetrics {
	engagement_score: number;
	conversion_probability: number;
	anomaly_detection: {
		is_anomaly: boolean;
		anomaly_score: number;
		explanation: string;
	};
	ml_insights: {
		clustering_assignment: string;
		propensity_scores: {
			advocacy: number;
			engagement: number;
			retention: number;
		};
	};
	calculation_metadata: {
		model_version: string;
		computed_at: string;
		confidence_interval: [number, number];
	};
	time_series_data: {
		hourly_engagement: Array<{
			hour: number;
			score: number;
		}>;
	};
	cohort_analysis: {
		ltv_estimate: number;
		retention_rate: number;
		churn_risk: number;
	};
	legacy_migration_flag?: boolean;
}

// ============= EXPERIMENT SCHEMA TYPES =============

/**
 * Analytics Experiment entity - for A/B tests, funnels, campaigns
 */
export interface AnalyticsExperiment {
	id: string;
	name: string;
	type: 'ab_test' | 'funnel' | 'campaign';
	status: 'draft' | 'active' | 'paused' | 'completed';
	created_at: Date;
	updated_at: Date;
	config: AnalyticsExperimentConfig;
	metrics_cache?: AnalyticsExperimentMetricsCache;
}

export interface AnalyticsExperimentConfig {
	steps?: Array<{
		goal_event: string;
		name: string;
		description: string;
	}>;

	variations?: Array<{
		name: string;
		weight: number;
		config: {
			auth_modal_style?: string;
			profile_required?: boolean;
			personalization_level?: string;
		};
	}>;

	targeting_rules?: {
		template_categories?: string[];
		geo_restrictions?: string[];
		geographic?: {
			included_countries: string[];
			excluded_regions: string[];
		};
		demographic?: {
			age_range: [number, number];
			languages: string[];
		};
	};

	optimization_goals?: {
		primary: string;
		secondary: string[];
	};

	statistical_config?: {
		confidence_level: number;
		minimum_sample_size: number;
		expected_effect_size: number;
	};

	// Campaign specific
	budget?: number;
	campaign_channels?: string[];
	kpi_targets?: {
		total_reach: number;
		conversion_rate: number;
		cost_per_acquisition: number;
	};
}

export interface AnalyticsExperimentMetricsCache {
	participants_count: number;
	conversion_rate: number;
	winning_variation?: string;
	statistical_significance?: number;
	recommendation?: string;
	error?: string;

	// Funnel specific
	funnel_completion_rate?: number;
	step_conversion_rates?: {
		[stepKey: string]: number;
	};
	drop_off_analysis?: {
		highest_drop_off_step: number;
		drop_off_reasons: string[];
	};

	// A/B Test specific
	variation_results?: {
		[variationName: string]: {
			conversion_rate: number;
			sample_size: number;
			confidence_interval: [number, number];
		};
	};

	// Campaign specific
	budget_spent?: number;
	cost_metrics?: {
		cost_per_click: number;
		cost_per_conversion: number;
		return_on_ad_spend: number;
	};

	// Funnel analysis
	funnel_completion_rates?: {
		overall: number;
		by_variation: Record<string, number>;
	};

	temporal_analysis?: {
		daily_conversion_rates: Array<{
			date: string;
			rate: number;
		}>;
	};
}

// ============= AGENT & DECISION TYPES =============

export interface AgentDecisionMultipliers {
	urgency: number;
	participation_score: number;
	market_conditions: number;
	time_decay: number;
	geographic_relevance: number;
	template_quality: number;
}

// ============= AUDIT & USER TYPES =============

export interface CertificationData {
	certificate_hash: string;
	issuer: string;
	verification_method: string;
	claims: Record<string, unknown>;
	expiry_date?: string;
	revocation_status?: 'active' | 'revoked' | 'expired';
}

// ============= TEMPLATE TYPES =============

/**
 * Template metrics as stored in JSON fields.
 * Distinct from TemplateMetrics in templateConfig.ts which tracks
 * delivery-oriented counters (sent/opened/clicked/responded).
 */
export interface JsonTemplateMetrics {
	page_views: number;
	events_count: number;
	conversion_count: number;
	delivered: number;
	success_rate: number;
	engagement_metrics: {
		time_on_page: number;
		scroll_depth: number;
		interaction_count: number;
	};
	geographic_distribution: Record<string, number>;
	temporal_analysis: {
		hourly_usage: number[];
		daily_trends: Array<{
			date: string;
			usage: number;
		}>;
	};
}

export interface CorrectionLog {
	changes: Array<{
		type: 'grammar' | 'clarity' | 'factual' | 'formatting';
		original: string;
		corrected: string;
		confidence: number;
		agent_source: string;
	}>;
	summary: {
		total_changes: number;
		severity_reduced: number;
		quality_improvement: number;
	};
	agent_consensus: {
		agreement_score: number;
		dissenting_agents: string[];
	};
}

// ============= TYPE GUARDS =============

export function isAnalyticsSessionMetrics(value: unknown): value is AnalyticsSessionMetrics {
	return (
		typeof value === 'object' &&
		value !== null &&
		'events_count' in value &&
		typeof (value as AnalyticsSessionMetrics).events_count === 'number'
	);
}

export function isAnalyticsDeviceData(value: unknown): value is AnalyticsDeviceData {
	return (
		typeof value === 'object' &&
		value !== null &&
		'device_type' in value &&
		typeof (value as AnalyticsDeviceData).device_type === 'string'
	);
}

export function isAnalyticsEventProperties(value: unknown): value is AnalyticsEventProperties {
	return typeof value === 'object' && value !== null;
}

export function isAnalyticsComputedMetrics(value: unknown): value is AnalyticsComputedMetrics {
	return (
		typeof value === 'object' &&
		value !== null &&
		'engagement_score' in value &&
		typeof (value as AnalyticsComputedMetrics).engagement_score === 'number'
	);
}

export function isAnalyticsExperimentConfig(value: unknown): value is AnalyticsExperimentConfig {
	return typeof value === 'object' && value !== null;
}

export function isAnalyticsExperimentMetricsCache(
	value: unknown
): value is AnalyticsExperimentMetricsCache {
	return (
		typeof value === 'object' &&
		value !== null &&
		'participants_count' in value &&
		typeof (value as AnalyticsExperimentMetricsCache).participants_count === 'number'
	);
}

export function isAgentDecisionMultipliers(value: unknown): value is AgentDecisionMultipliers {
	return (
		typeof value === 'object' &&
		value !== null &&
		'urgency' in value &&
		typeof (value as AgentDecisionMultipliers).urgency === 'number'
	);
}

export function isJsonTemplateMetrics(value: unknown): value is JsonTemplateMetrics {
	return (
		typeof value === 'object' &&
		value !== null &&
		'page_views' in value &&
		typeof (value as JsonTemplateMetrics).page_views === 'number'
	);
}

// ============= SAFE ACCESS HELPERS =============

export function getSessionMetrics(jsonValue: JsonValue): AnalyticsSessionMetrics {
	if (isAnalyticsSessionMetrics(jsonValue)) {
		return jsonValue;
	}

	// Return safe defaults
	return {
		events_count: 0,
		page_views: 0,
		duration_ms: 0,
		conversion_count: 0,
		bounce_rate: 0,
		funnel_conversions: 0,
		last_event_timestamp: new Date().toISOString(),
		predictive_metrics: {
			lifetime_value_estimate: 0,
			churn_probability: 0.5,
			engagement_score: 0
		},
		performance_metrics: {
			error_count: 0,
			load_time_avg: 0,
			interaction_delay: 0
		}
	};
}

export function getDeviceData(jsonValue: JsonValue): AnalyticsDeviceData {
	if (isAnalyticsDeviceData(jsonValue)) {
		return jsonValue;
	}

	return {
		ip_address: '0.0.0.0',
		user_agent: 'Unknown',
		fingerprint: '',
		device_type: 'desktop',
		browser: 'Unknown',
		os: 'Unknown',
		viewport: { width: 1920, height: 1080 },
		connection_type: 'wifi',
		accessibility: {
			screen_reader: false,
			high_contrast: false,
			reduced_motion: false
		}
	};
}

export function getEventProperties(jsonValue: JsonValue): AnalyticsEventProperties {
	if (isAnalyticsEventProperties(jsonValue)) {
		return jsonValue as AnalyticsEventProperties;
	}
	return {};
}

export function getComputedMetrics(jsonValue: JsonValue): AnalyticsComputedMetrics {
	if (isAnalyticsComputedMetrics(jsonValue)) {
		return jsonValue;
	}

	return {
		engagement_score: 0,
		conversion_probability: 0,
		anomaly_detection: {
			is_anomaly: false,
			anomaly_score: 0,
			explanation: 'No data available'
		},
		ml_insights: {
			clustering_assignment: 'unassigned',
			propensity_scores: {
				advocacy: 0,
				engagement: 0,
				retention: 0
			}
		},
		calculation_metadata: {
			model_version: 'v1.0.0',
			computed_at: new Date().toISOString(),
			confidence_interval: [0, 0]
		},
		time_series_data: {
			hourly_engagement: []
		},
		cohort_analysis: {
			ltv_estimate: 0,
			retention_rate: 0,
			churn_risk: 0.5
		}
	};
}

export function getExperimentConfig(jsonValue: JsonValue): AnalyticsExperimentConfig {
	if (isAnalyticsExperimentConfig(jsonValue)) {
		return jsonValue as AnalyticsExperimentConfig;
	}
	return {};
}

export function getExperimentMetricsCache(
	jsonValue: JsonValue
): AnalyticsExperimentMetricsCache {
	if (isAnalyticsExperimentMetricsCache(jsonValue)) {
		return jsonValue;
	}

	return {
		participants_count: 0,
		conversion_rate: 0
	};
}

export function getAgentDecisionMultipliers(jsonValue: JsonValue): AgentDecisionMultipliers {
	if (isAgentDecisionMultipliers(jsonValue)) {
		return jsonValue;
	}

	return {
		urgency: 1.0,
		participation_score: 1.0,
		market_conditions: 1.0,
		time_decay: 1.0,
		geographic_relevance: 1.0,
		template_quality: 1.0
	};
}

export function getJsonTemplateMetrics(jsonValue: JsonValue): JsonTemplateMetrics {
	if (isJsonTemplateMetrics(jsonValue)) {
		return jsonValue;
	}

	return {
		page_views: 0,
		events_count: 0,
		conversion_count: 0,
		delivered: 0,
		success_rate: 0,
		engagement_metrics: {
			time_on_page: 0,
			scroll_depth: 0,
			interaction_count: 0
		},
		geographic_distribution: {},
		temporal_analysis: {
			hourly_usage: new Array(24).fill(0),
			daily_trends: []
		}
	};
}

// ============= UTILITY FUNCTIONS =============

/**
 * Safely access nested properties in JSON data
 */
export function safeJsonAccess<T>(jsonValue: JsonValue, path: string, defaultValue: T): T {
	try {
		if (!jsonValue || typeof jsonValue !== 'object' || jsonValue === null) {
			return defaultValue;
		}

		const keys = path.split('.');
		let current: unknown = jsonValue;

		for (const key of keys) {
			if (current && typeof current === 'object' && key in current) {
				current = (current as Record<string, unknown>)[key];
			} else {
				return defaultValue;
			}
		}

		return current as T;
	} catch {
		return defaultValue;
	}
}

/**
 * Safely update nested properties in JSON data
 */
export function safeJsonUpdate<T extends Record<string, unknown>>(
	jsonValue: JsonValue,
	updates: Partial<T>
): T {
	const base = (typeof jsonValue === 'object' && jsonValue !== null ? jsonValue : {}) as T;
	return { ...base, ...updates };
}
