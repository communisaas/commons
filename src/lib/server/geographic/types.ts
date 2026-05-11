/**
 * Geographic expansion type definitions.
 */

// ── Jurisdiction types ──

/** US 24-slot jurisdictions + international equivalents */
export type JurisdictionType =
	| 'congressional'
	| 'federal-senate'
	| 'state-senate'
	| 'state-house'
	| 'county'
	| 'city'
	| 'city-council'
	| 'unified-school'
	| 'elementary-school'
	| 'secondary-school'
	| 'community-college'
	| 'water'
	| 'fire'
	| 'transit'
	| 'hospital'
	| 'library'
	| 'park'
	| 'conservation'
	| 'utility'
	| 'judicial'
	| 'township'
	| 'precinct'
	// International
	| 'uk-constituency'
	| 'uk-council'
	| 'ca-riding'
	| 'au-electorate';

export type CountryCode = 'US' | 'GB' | 'CA' | 'AU' | 'FR' | 'JP' | 'BR';

export interface ResolverResult {
	districtId: string;
	districtName: string;
	districtType: JurisdictionType;
	country: CountryCode;
	/** Additional data from resolver (council, province, state, etc.) */
	extra?: Record<string, string>;
}

export interface InternationalRepresentativeData {
	id: string;
	countryCode: CountryCode;
	constituencyId: string;
	constituencyName: string;
	name: string;
	party: string | null;
	chamber: string | null;
	office: string | null;
	phone: string | null;
	email: string | null;
	websiteUrl: string | null;
}

export interface FuzzyMatchResult {
	pattern: string;
	canonical: string;
	country: CountryCode;
	scopeLevel: 'country' | 'region' | 'locality' | 'district';
	confidence: number;
}

// ── Validation ──

export const VALID_JURISDICTIONS: JurisdictionType[] = [
	'congressional', 'federal-senate', 'state-senate', 'state-house',
	'county', 'city', 'city-council',
	'unified-school', 'elementary-school', 'secondary-school', 'community-college',
	'water', 'fire', 'transit', 'hospital', 'library', 'park',
	'conservation', 'utility', 'judicial', 'township', 'precinct',
	'uk-constituency', 'uk-council', 'ca-riding', 'au-electorate'
];

export const VALID_COUNTRY_CODES: CountryCode[] = ['US', 'GB', 'CA', 'AU', 'FR', 'JP', 'BR'];

/**
 * Countries the resolver dispatcher and type system know about — the design
 * surface. Adding a country here without also adding it to
 * `LIVE_RESOLVER_COUNTRIES` tells consumers the API surface exists but
 * representative lookup is not yet wired.
 */
export const SUPPORTED_RESOLVER_COUNTRIES: CountryCode[] = ['US', 'GB', 'CA', 'AU'];

/**
 * Countries with real `lookupRepresentatives` data sources wired and live —
 * the operational surface. Public endpoints reject countries that are
 * `SUPPORTED` but not `LIVE` so international users don't receive a hollow
 * `representatives: []` response dressed up as success, and so onboarding
 * stays inside the countries we've actually scoped legal-compliance work for.
 *
 * To promote a country: implement `lookupRepresentatives` for it in
 * `src/lib/server/geographic/rep-lookup.ts`, then resolve the legal-compliance
 * gate (GDPR / privacy / consent ledger as applicable for the jurisdiction).
 */
export const LIVE_RESOLVER_COUNTRIES: CountryCode[] = ['US'];

export const COUNTRY_LABELS: Record<CountryCode, string> = {
	US: 'United States',
	GB: 'United Kingdom',
	CA: 'Canada',
	AU: 'Australia',
	FR: 'France',
	JP: 'Japan',
	BR: 'Brazil'
};
