/**
 * Location Resolver
 *
 * Converts LocationHierarchy (from Nominatim) to GeoScope (for storage/agents)
 * and provides display utilities for human-readable location strings.
 *
 * Design principle: "Preserve the original"
 * - Store displayName alongside codes so reconstruction is lossless
 * - Fallback to code-to-name mappings when displayName is missing
 */

import type { LocationHierarchy } from './location-search';
import type { GeoScope } from '../agents/types';

// ============================================================================
// Reverse Mappings: Code -> Name (for fallback display)
// ============================================================================

/**
 * ISO 3166-1 alpha-2 country codes to names
 * Subset of most common countries; extend as needed
 */
const COUNTRY_CODES: Record<string, string> = {
	US: 'United States',
	CA: 'Canada',
	GB: 'United Kingdom',
	AU: 'Australia',
	DE: 'Germany',
	FR: 'France',
	ES: 'Spain',
	IT: 'Italy',
	JP: 'Japan',
	CN: 'China',
	IN: 'India',
	BR: 'Brazil',
	MX: 'Mexico',
	NZ: 'New Zealand',
	IE: 'Ireland',
	NL: 'Netherlands',
	SE: 'Sweden',
	NO: 'Norway',
	DK: 'Denmark',
	FI: 'Finland',
	CH: 'Switzerland',
	AT: 'Austria',
	BE: 'Belgium',
	PT: 'Portugal',
	PL: 'Poland',
	KR: 'South Korea',
	SG: 'Singapore',
	HK: 'Hong Kong',
	TW: 'Taiwan',
	IL: 'Israel',
	ZA: 'South Africa',
	AR: 'Argentina',
	CL: 'Chile',
	CO: 'Colombia',
	PH: 'Philippines'
};

/**
 * US state codes to names (ISO 3166-2:US)
 */
const US_STATE_CODES: Record<string, string> = {
	AL: 'Alabama',
	AK: 'Alaska',
	AZ: 'Arizona',
	AR: 'Arkansas',
	CA: 'California',
	CO: 'Colorado',
	CT: 'Connecticut',
	DE: 'Delaware',
	DC: 'District of Columbia',
	FL: 'Florida',
	GA: 'Georgia',
	HI: 'Hawaii',
	ID: 'Idaho',
	IL: 'Illinois',
	IN: 'Indiana',
	IA: 'Iowa',
	KS: 'Kansas',
	KY: 'Kentucky',
	LA: 'Louisiana',
	ME: 'Maine',
	MD: 'Maryland',
	MA: 'Massachusetts',
	MI: 'Michigan',
	MN: 'Minnesota',
	MS: 'Mississippi',
	MO: 'Missouri',
	MT: 'Montana',
	NE: 'Nebraska',
	NV: 'Nevada',
	NH: 'New Hampshire',
	NJ: 'New Jersey',
	NM: 'New Mexico',
	NY: 'New York',
	NC: 'North Carolina',
	ND: 'North Dakota',
	OH: 'Ohio',
	OK: 'Oklahoma',
	OR: 'Oregon',
	PA: 'Pennsylvania',
	RI: 'Rhode Island',
	SC: 'South Carolina',
	SD: 'South Dakota',
	TN: 'Tennessee',
	TX: 'Texas',
	UT: 'Utah',
	VT: 'Vermont',
	VA: 'Virginia',
	WA: 'Washington',
	WV: 'West Virginia',
	WI: 'Wisconsin',
	WY: 'Wyoming',
	PR: 'Puerto Rico',
	GU: 'Guam',
	VI: 'U.S. Virgin Islands',
	AS: 'American Samoa',
	MP: 'Northern Mariana Islands'
};

/**
 * Canadian province codes to names (ISO 3166-2:CA)
 */
const CA_PROVINCE_CODES: Record<string, string> = {
	AB: 'Alberta',
	BC: 'British Columbia',
	MB: 'Manitoba',
	NB: 'New Brunswick',
	NL: 'Newfoundland and Labrador',
	NT: 'Northwest Territories',
	NS: 'Nova Scotia',
	NU: 'Nunavut',
	ON: 'Ontario',
	PE: 'Prince Edward Island',
	QC: 'Quebec',
	SK: 'Saskatchewan',
	YT: 'Yukon'
};

/**
 * Australian state codes to names (ISO 3166-2:AU)
 */
const AU_STATE_CODES: Record<string, string> = {
	NSW: 'New South Wales',
	VIC: 'Victoria',
	QLD: 'Queensland',
	SA: 'South Australia',
	WA: 'Western Australia',
	TAS: 'Tasmania',
	NT: 'Northern Territory',
	ACT: 'Australian Capital Territory'
};

// ============================================================================
// Code-to-Name Lookup Functions
// ============================================================================

/**
 * Lazily-constructed ISO 3166-1 region display-name resolver.
 *
 * `Intl.DisplayNames` covers every ISO 3166-1 alpha-2 region (~249), so we no
 * longer depend on the hand-maintained COUNTRY_CODES table — which stopped at a
 * few dozen and left codes like "MY" rendering raw. Supported in all evergreen
 * browsers and the Cloudflare Workers runtime. Cached because constructing it is
 * comparatively expensive; `undefined` = not yet attempted, `null` = unavailable.
 */
let regionDisplayNames: Intl.DisplayNames | null | undefined;

function getRegionDisplayNames(): Intl.DisplayNames | null {
	if (regionDisplayNames !== undefined) return regionDisplayNames;
	try {
		regionDisplayNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
	} catch {
		regionDisplayNames = null;
	}
	return regionDisplayNames;
}

/**
 * Convert country code to human-readable name
 *
 * @param code - ISO 3166-1 alpha-2 code (e.g., 'US', 'CA')
 * @returns Country name or null if not found
 */
export function countryCodeToName(code: string): string | null {
	const upper = code.toUpperCase();
	// ISO 3166-1 alpha-2 only. (Intl.DisplayNames also accepts UN M49 numerics,
	// but our inputs are always two-letter country codes.)
	if (!/^[A-Z]{2}$/.test(upper)) return null;

	const display = getRegionDisplayNames();
	if (display) {
		try {
			// fallback:'none' → undefined for unassigned codes (e.g. "XX").
			const name = display.of(upper);
			if (name) return name;
		} catch {
			// Fall through to the static table.
		}
	}

	return COUNTRY_CODES[upper] || null;
}

/**
 * Convert state/subdivision code to human-readable name
 *
 * @param stateCode - State code (e.g., 'CA', 'ON', 'NSW')
 * @param countryCode - Parent country code (e.g., 'US', 'CA', 'AU')
 * @returns State name or null if not found
 */
export function stateCodeToName(stateCode: string, countryCode: string): string | null {
	const upperState = stateCode.toUpperCase();
	const upperCountry = countryCode.toUpperCase();

	switch (upperCountry) {
		case 'US':
			return US_STATE_CODES[upperState] || null;
		case 'CA':
			return CA_PROVINCE_CODES[upperState] || null;
		case 'AU':
			return AU_STATE_CODES[upperState] || null;
		default:
			return null;
	}
}

// ============================================================================
// Location Resolution Functions
// ============================================================================

/**
 * Convert Nominatim result to GeoScope with display preservation
 *
 * The resolver infers scope type from hierarchy depth:
 * - Country only -> nationwide
 * - Country + state -> subnational (state-level)
 * - Country + state + city -> subnational (city-level)
 *
 * @param location - LocationHierarchy from Nominatim search
 * @returns GeoScope with displayName populated
 */
export function resolveToGeoScope(location: LocationHierarchy): GeoScope {
	const { country, state, city } = location;

	// City-level (most specific)
	if (city) {
		return {
			type: 'subnational',
			country: country.code,
			subdivision: state ? `${country.code}-${state.code}` : undefined,
			subdivisionName: state?.name,
			locality: city.name,
			displayName: formatDisplayName(location)
		};
	}

	// State-level
	if (state) {
		return {
			type: 'subnational',
			country: country.code,
			subdivision: `${country.code}-${state.code}`,
			subdivisionName: state.name,
			displayName: formatDisplayName(location)
		};
	}

	// Country-level
	return {
		type: 'nationwide',
		country: country.code,
		displayName: country.name
	};
}

/**
 * Format hierarchy into clean display string
 *
 * Nominatim returns verbose: "San Francisco, San Francisco County, California, United States"
 * We want concise: "San Francisco, California, United States"
 *
 * @param location - LocationHierarchy to format
 * @returns Concise display string
 */
export function formatDisplayName(location: LocationHierarchy): string {
	const parts: string[] = [];

	if (location.city) parts.push(location.city.name);
	if (location.state) parts.push(location.state.name);
	if (location.country) parts.push(location.country.name);

	return parts.join(', ');
}

/**
 * Display a GeoScope as human-readable text
 *
 * Uses displayName if available, otherwise reconstructs from codes.
 * This fallback ensures backward compatibility with existing GeoScope
 * data that doesn't have displayName populated.
 *
 * @param scope - GeoScope to display
 * @returns Human-readable location string
 */
export function displayGeoScope(scope: GeoScope): string {
	if (scope.type === 'international') return 'Worldwide';

	// Prefer stored display name (lossless)
	if ('displayName' in scope && scope.displayName) {
		return scope.displayName;
	}

	// Fallback: reconstruct from codes (lossy but functional)
	if (scope.type === 'nationwide') {
		return countryCodeToName(scope.country) || scope.country;
	}

	// Subnational fallback reconstruction
	const parts: string[] = [];

	if (scope.locality) {
		parts.push(scope.locality);
	}

	if (scope.subdivision) {
		// Prefer the preserved subdivision name; otherwise reverse the code
		// ("US-CA" -> "CA" -> "California"), falling back to the bare code.
		const stateCode = scope.subdivision.split('-')[1];
		const stateName =
			scope.subdivisionName ||
			(stateCode ? stateCodeToName(stateCode, scope.country) : null) ||
			stateCode;
		if (stateName) parts.push(stateName);
	}

	const countryName = countryCodeToName(scope.country);
	parts.push(countryName || scope.country);

	return parts.join(', ');
}
