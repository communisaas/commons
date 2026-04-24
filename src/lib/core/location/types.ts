/**
 * Client-Side Location Resolution Type Definitions
 *
 * Privacy-preserving, VPN-resistant location inference system.
 * All location resolution happens in the browser - server NEVER knows user location.
 */

// ============================================================================
// Location Signals (5-Signal Progressive Inference)
// ============================================================================

/**
 * Signal types in order of reliability (weakest to strongest)
 */
export type LocationSignalType =
	| 'ip'
	| 'browser'
	| 'oauth'
	| 'behavioral'
	| 'user_selected'
	| 'verified';

/**
 * Individual location signal with confidence scoring
 */
export interface LocationSignal {
	/** Signal type (determines reliability) */
	signal_type: LocationSignalType;

	/** Confidence score (0.0 = no confidence, 1.0 = absolute certainty) */
	confidence: number;

	/** Country code (e.g., "US", "CA", "GB") - ISO 3166-1 alpha-2 */
	country_code?: string | null;

	/** Congressional district (e.g., "TX-18") */
	congressional_district?: string | null;

	/** State upper house (senate) district */
	state_senate_district?: string | null;

	/** State lower house (assembly/house) district */
	state_house_district?: string | null;

	/** State code (e.g., "TX") */
	state_code?: string | null;

	/** City name (e.g., "Austin") */
	city_name?: string | null;

	/** County FIPS code (e.g., "48453" for Travis County, TX) */
	county_fips?: string | null;

	/** City council ward code */
	ward_code?: string | null;

	/** School district ID (NCES) */
	school_district_id?: string | null;

	/**
	 * Census Block GEOID (15-digit cell identifier)
	 *
	 * PRIVACY: This is neighborhood-level precision (600-3000 people).
	 * Treat as sensitive PII - never log, encrypt at rest.
	 */
	cell_id?: CellId | null;

	/** Latitude coordinate */
	latitude?: number | null;

	/** Longitude coordinate */
	longitude?: number | null;

	/** Signal source (e.g., "navigator.geolocation", "oauth.google") */
	source: string;

	/** Signal timestamp */
	timestamp: string;

	/** Signal expiration (if applicable) */
	expires_at?: string | null;

	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Inferred location from multiple signals
 */
export interface InferredLocation {
	/** Country code (e.g., "US", "CA", "GB") - ISO 3166-1 alpha-2 */
	country_code: string | null;

	/** Congressional district (highest confidence signal) */
	congressional_district: string | null;

	/** State upper house (senate) district — slot 2 */
	state_senate_district?: string | null;

	/** State lower house (assembly/house) district — slot 3 */
	state_house_district?: string | null;

	/** State code (highest confidence signal) */
	state_code: string | null;

	/** City name (optional, from highest confidence signal) */
	city_name?: string | null;

	/** County name (optional, from highest confidence signal) */
	county_name?: string | null;

	/** County FIPS code (optional, from highest confidence signal) */
	county_fips?: string | null;

	/** City council ward code — slot 6 */
	ward_code?: string | null;

	/** School district ID (NCES) — slot 7 */
	school_district_id?: string | null;

	/**
	 * Census Block GEOID (15-digit cell identifier)
	 * Only available from verified signals with high-precision geocoding.
	 */
	cell_id?: CellId | null;

	/** Overall confidence (weighted average of all signals) */
	confidence: number;

	/** All signals used in inference */
	signals: LocationSignal[];

	/** Timestamp of last inference */
	inferred_at: string;
}

// ============================================================================
// Signal Confidence Weights
// ============================================================================

/**
 * Confidence weights for each signal type
 * Reflects real-world reliability of each signal source
 */
export const SIGNAL_CONFIDENCE_WEIGHTS: Record<LocationSignalType, number> = {
	ip: 0.2, // Very low - VPNs break this
	browser: 0.6, // Medium - user can deny permission or spoof
	oauth: 0.8, // High - verified with OAuth provider
	behavioral: 0.9, // Very high - revealed preference from template engagement
	user_selected: 0.9, // Very high - explicit user intent from breadcrumb selection
	verified: 1.0 // Absolute - cryptographic proof from mDL Digital Credentials API
};

/**
 * Signal expiration times (in milliseconds)
 */
export const SIGNAL_EXPIRATION: Record<LocationSignalType, number> = {
	ip: 24 * 60 * 60 * 1000, // 24 hours (IP changes frequently)
	browser: 7 * 24 * 60 * 60 * 1000, // 7 days (coordinates stable)
	oauth: 90 * 24 * 60 * 60 * 1000, // 90 days (OAuth profile stable)
	behavioral: 30 * 24 * 60 * 60 * 1000, // 30 days (behavioral patterns stable)
	user_selected: 90 * 24 * 60 * 60 * 1000, // 90 days (user intent stable)
	verified: 365 * 24 * 60 * 60 * 1000 // 365 days (verified address rarely changes)
};

// ============================================================================
// Cell ID Types (Census Block GEOID)
// ============================================================================

/**
 * CellId: 15-digit Census Block GEOID (branded type for type safety)
 *
 * Structure: SSCCCTTTTTTBBBB
 * - SS: State FIPS code (2 digits)
 * - CCC: County FIPS code (3 digits)
 * - TTTTTT: Census Tract code (6 digits)
 * - BBBB: Census Block code (4 digits)
 *
 * Example: "060372086003001"
 *   06 = California
 *   037 = Los Angeles County
 *   208600 = Census Tract
 *   3001 = Census Block
 *
 * PRIVACY NOTE: Census Blocks contain 600-3000 people on average.
 * This is neighborhood-level precision and should be treated as sensitive PII.
 * Never log cell_id values; encrypt at rest; use only as ZK private witness.
 */
export type CellId = string & { readonly __brand: 'CellId' };

/**
 * Parsed components of a Census Block GEOID
 */
export interface CellIdComponents {
	/** State FIPS code (2 digits, e.g., "06" for California) */
	state_fips: string;
	/** County FIPS code (3 digits, e.g., "037" for Los Angeles) */
	county_fips: string;
	/** Census Tract code (6 digits, e.g., "208600") */
	tract: string;
	/** Census Block code (4 digits, e.g., "3001") */
	block: string;
	/** Full 15-digit GEOID */
	full_geoid: CellId;
}

/**
 * Type guard: Validate CellId format
 *
 * @param value - Value to check
 * @returns True if value is a valid 15-digit Census Block GEOID
 */
export function isCellId(value: unknown): value is CellId {
	if (typeof value !== 'string') return false;
	// Must be exactly 15 numeric digits
	return /^\d{15}$/.test(value);
}

/**
 * Parse CellId into its component parts
 *
 * @param cellId - Valid 15-digit Census Block GEOID
 * @returns Parsed components (state, county, tract, block)
 * @throws Error if cellId format is invalid
 */
export function parseCellId(cellId: CellId): CellIdComponents {
	if (!isCellId(cellId)) {
		throw new Error(`Invalid CellId format: expected 15 digits, got "${cellId}"`);
	}

	return {
		state_fips: cellId.slice(0, 2),
		county_fips: cellId.slice(2, 5),
		tract: cellId.slice(5, 11),
		block: cellId.slice(11, 15),
		full_geoid: cellId
	};
}

/**
 * Create a CellId from a raw string (with validation)
 *
 * @param value - Raw GEOID string from Census API
 * @returns CellId if valid, null if invalid
 */
export function createCellId(value: string | undefined | null): CellId | null {
	if (!value || !isCellId(value)) return null;
	return value as CellId;
}

// ============================================================================
// Template Filtering
// ============================================================================

/**
 * Template with jurisdiction information
 */
export interface TemplateWithJurisdictions {
	id: string;
	slug: string;
	title: string;
	description?: string;
	category?: string;
	jurisdictions: TemplateJurisdiction[];
	scopes?: Array<{
		id: string;
		template_id: string;
		country_code: string;
		region_code?: string | null;
		locality_code?: string | null;
		district_code?: string | null;
		display_text: string;
		scope_level: 'country' | 'region' | 'locality' | 'district';
		confidence: number;
		extraction_method?: string;
	}>;
}

/**
 * Template jurisdiction.
 */
export interface TemplateJurisdiction {
	id: string;
	template_id: string;
	jurisdiction_type: JurisdictionType;

	// Federal
	congressional_district?: string | null;
	senate_class?: string | null;

	// State
	state_code?: string | null;
	state_senate_district?: string | null;
	state_house_district?: string | null;

	// County
	county_fips?: string | null;
	county_name?: string | null;

	// City
	city_name?: string | null;
	city_fips?: string | null;

	// Ward/council
	ward_code?: string | null;

	// School district
	school_district_id?: string | null;
	school_district_name?: string | null;

	// Geospatial
	latitude?: number | null;
	longitude?: number | null;

	// Coverage metadata
	estimated_population?: bigint | null;
	coverage_notes?: string | null;
}

/**
 * Jurisdiction types
 */
export type JurisdictionType = 'federal' | 'state' | 'county' | 'city' | 'ward' | 'school_district';

/**
 * Template with relevance score
 */
export interface ScoredTemplate {
	template: TemplateWithJurisdictions;
	score: number;
	matchReason: string; // Human-readable explanation of why this matched
	jurisdiction: TemplateJurisdiction; // The specific jurisdiction that matched
}

// ============================================================================
// Behavioral Tracking
// ============================================================================

/**
 * Template view event (for behavioral inference)
 */
export interface TemplateViewEvent {
	template_id: string;
	template_slug: string;
	jurisdictions: TemplateJurisdiction[];
	viewed_at: string;
}

/**
 * Behavioral location pattern
 */
export interface BehavioralLocationPattern {
	congressional_district: string | null;
	state_code: string | null;
	view_count: number;
	confidence: number;
	first_seen: string;
	last_seen: string;
}

// ============================================================================
// IndexedDB Schema
// ============================================================================

/**
 * IndexedDB store names
 */
export const INDEXED_DB_STORES = {
	LOCATION_SIGNALS: 'location_signals',
	TEMPLATE_VIEWS: 'template_views',
	INFERRED_LOCATION: 'inferred_location'
} as const;

/**
 * IndexedDB database name and version
 */
export const INDEXED_DB_NAME = 'commons_location';
export const INDEXED_DB_VERSION = 3; // Bumped from 2 to force inferred_location schema fix

// ============================================================================
// OAuth Provider Location Data
// ============================================================================

/**
 * OAuth provider location data structure
 */
export interface OAuthLocationData {
	provider: 'google' | 'facebook' | 'linkedin' | 'twitter' | 'discord';
	locale?: string; // e.g., "en-US"
	location?: string; // e.g., "Austin, TX"
	timezone?: string; // e.g., "America/Chicago"
	extracted_state?: string; // Parsed state code
	extracted_city?: string; // Parsed city name
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard: Check if value is LocationSignal
 */
export function isLocationSignal(value: unknown): value is LocationSignal {
	if (typeof value !== 'object' || value === null) return false;

	const signal = value as Partial<LocationSignal>;

	return (
		typeof signal.signal_type === 'string' &&
		['ip', 'browser', 'oauth', 'behavioral', 'user_selected', 'verified'].includes(
			signal.signal_type
		) &&
		typeof signal.confidence === 'number' &&
		signal.confidence >= 0 &&
		signal.confidence <= 1 &&
		typeof signal.source === 'string' &&
		typeof signal.timestamp === 'string'
	);
}

/**
 * Type guard: Check if value is InferredLocation
 */
export function isInferredLocation(value: unknown): value is InferredLocation {
	if (typeof value !== 'object' || value === null) return false;

	const location = value as Partial<InferredLocation>;

	return (
		typeof location.confidence === 'number' &&
		location.confidence >= 0 &&
		location.confidence <= 1 &&
		Array.isArray(location.signals) &&
		location.signals.every(isLocationSignal) &&
		typeof location.inferred_at === 'string'
	);
}

/**
 * Type guard: Check if value is TemplateJurisdiction
 */
export function isTemplateJurisdiction(value: unknown): value is TemplateJurisdiction {
	if (typeof value !== 'object' || value === null) return false;

	const jurisdiction = value as Partial<TemplateJurisdiction>;

	return (
		typeof jurisdiction.id === 'string' &&
		typeof jurisdiction.template_id === 'string' &&
		typeof jurisdiction.jurisdiction_type === 'string' &&
		['federal', 'state', 'county', 'city', 'ward', 'school_district'].includes(
			jurisdiction.jurisdiction_type
		)
	);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate weighted confidence from multiple signals
 */
export function calculateWeightedConfidence(signals: LocationSignal[]): number {
	if (signals.length === 0) return 0;

	const totalWeight = signals.reduce(
		(sum, signal) => sum + SIGNAL_CONFIDENCE_WEIGHTS[signal.signal_type] * signal.confidence,
		0
	);

	const maxPossibleWeight = signals.reduce(
		(sum, signal) => sum + SIGNAL_CONFIDENCE_WEIGHTS[signal.signal_type],
		0
	);

	return maxPossibleWeight > 0 ? totalWeight / maxPossibleWeight : 0;
}

/**
 * Check if signal is expired
 */
export function isSignalExpired(signal: LocationSignal): boolean {
	if (signal.expires_at) {
		return new Date(signal.expires_at) < new Date();
	}

	const signalTime = new Date(signal.timestamp).getTime();
	const expirationTime = SIGNAL_EXPIRATION[signal.signal_type];
	const now = Date.now();

	return now - signalTime > expirationTime;
}

/**
 * Format congressional district for display
 */
export function formatCongressionalDistrict(district: string | null): string | null {
	if (!district) return null;

	// Handle "TX-18" format
	if (district.includes('-')) {
		const [state, num] = district.split('-');
		return `${state.toUpperCase()}-${num.padStart(2, '0')}`;
	}

	return district;
}
