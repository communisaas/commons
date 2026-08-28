import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { resolveAddress } from '$lib/core/shadow-atlas/client';
import { DISTRICT_COVERAGE } from '$lib/core/shadow-atlas/coverage';
import { issueAddressResolutionToken } from '$lib/server/auth/address-resolution-token';

/**
 * POST /api/location/resolve-address
 *
 * Authenticated proxy to Shadow Atlas's sovereign address resolution.
 * All geocoding, district lookup, and officials resolution happens server-side
 * in Shadow Atlas (atlas-native geocoder over our published address-index
 * artifacts + H3 district lookup). Zero external API calls — the address never
 * leaves infrastructure we control.
 *
 * PRIVACY:
 * - Logs NOTHING about the address itself.
 * - Only logs success/failure + district code (neighborhood-level, not PII).
 */

const addressSchema = z.object({
	street: z.string().min(1).max(200),
	city: z.string().min(1).max(100),
	state: z.string().length(2),
	zip: z.string().regex(/^\d{5}(-\d{4})?$|^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/),
	country: z.enum(['US', 'CA']).optional()
});

export const POST: RequestHandler = async ({ request, locals }) => {
	// ---- Auth ----
	if (!locals.user) {
		return json({ resolved: false, error: 'Authentication required' }, { status: 401 });
	}

	try {
		const body = await request.json();

		// ---- Validate input ----
		const parseResult = addressSchema.safeParse(body);
		if (!parseResult.success) {
			return json(
				{
					resolved: false,
					error: 'Invalid request',
					details: parseResult.error.issues.map((i) => i.message)
				},
				{ status: 400 }
			);
		}

		const { street, city, state, zip, country } = parseResult.data;

		// ================================================================
		// Shadow Atlas (fully sovereign — zero external calls)
		// ================================================================
		const result = await resolveAddress({ street, city, state, zip, country });

		// District code comes from the resolver's own district hit first, officials
		// second. `getOfficials` sets `district_code: districtCode` FROM `district.id`
		// (src/lib/core/shadow-atlas/client.ts:1342), so the two sources are
		// byte-identical whenever officials resolve; this ordering changes behaviour
		// only on the path where the officials fetch was swallowed as non-fatal.
		//
		// INVARIANT: an officials-fetch failure is a retrieval failure (BLOCKED), not
		// an absence of representation (ABSENT). The two must never be collapsed —
		// losing the roster must never be reported to the person as "no district".
		const districtCode = result.district?.id ?? result.officials?.district_code ?? null;
		// Keep `state` coherent with whichever source produced `districtCode`. On the
		// officials-failure path the district id is now the only evidence, and the old
		// fallback would pair a resolved code like 'IL-18' with the user-typed 'IA'.
		// Officials-first precedence leaves every pre-existing response byte-identical.
		const stateCode =
			result.officials?.state ?? result.district?.id?.split('-')[0] ?? state.toUpperCase();

		// Privacy: log only district code, never address
		console.info(`[resolve-address] Resolved via Shadow Atlas district=${districtCode}`);

		// F-2.4 — bind the geocoded coordinates to the user-supplied address
		// via an HMAC token so a downstream verify-address call cannot
		// substitute coordinates without server-side detection. The client is
		// expected to echo `addressToken` + `addressHash` back in the
		// verify-address request.
		const parsedAddress = parseMatchedAddress(result.geocode.matched_address, {
			street,
			city,
			state,
			zip,
			country: country ?? result.geocode.country
		});
		const issued = await issueAddressResolutionToken({
			userId: locals.user.id,
			lat: result.geocode.lat,
			lng: result.geocode.lng,
			address: {
				street: parsedAddress.street,
				city: parsedAddress.city,
				state: parsedAddress.state,
				zip: parsedAddress.zip,
				country: country ?? result.geocode.country
			}
		});

		return json({
			resolved: true,
			address: {
				matched: result.geocode.matched_address,
				...parsedAddress
			},
			coordinates: {
				lat: result.geocode.lat,
				lng: result.geocode.lng
			},
			addressToken: issued.token,
			addressHash: issued.addressHash,
			addressTokenExpiresAt: issued.expiresAt,
			district: districtCode
				? {
						code: districtCode,
						// No fabricated label: when the resolver did not name the
						// district, say so with null rather than inventing one.
						name: result.district?.name ?? null,
						state: stateCode
					}
				: null,
			// Additive multi-type view — key names and shapes copied verbatim from the
			// paid lane (src/routes/api/v1/resolve-address/+server.ts). Every populated,
			// served boundary type for the resolved cell, in the canonical slot order
			// resolveAddress returned (congressional first). These entries ride the
			// SINGLE chunk fetch already performed for the congressional lookup, so
			// this adds no atlas work: no extra read, no extra network call.
			districts: result.districts ?? [],
			// Static machine-readable coverage disclosure. `coverage` NEVER ships
			// without `districts`: an absent 'partial' type is a possible ingest gap,
			// not evidence that the district does not exist, so the reader must always
			// hold the disclosure alongside the list to interpret an absence honestly.
			coverage: DISTRICT_COVERAGE,
			officials: result.officials?.officials.map((o) => ({
				name: o.name,
				office: o.office,
				chamber: o.chamber,
				party: o.party,
				state: o.state,
				district:
					o.chamber === 'senate'
						? o.state
						: `${o.state}-${o.district ?? ''}`,
				bioguide_id: o.bioguide_id,
				is_voting_member: o.is_voting,
				delegate_type: o.delegate_type,
				phone: o.phone ?? undefined,
				office_code: o.cwc_code ?? undefined
			})) ?? [],
			special_status: result.officials?.special_status ?? null,
			cell_id: result.cell_id,
			zk_eligible: result.cell_id != null,
			county_fips: null,
			// Resolution freshness provenance — verbatim from resolveAddress.
			// boundary_as_of and officials_as_of are TWO INDEPENDENT clocks; one
			// is never copied into or defaulted from the other. `null` means
			// honestly-unknown and passes through as JSON null — never replaced
			// with a fabricated timestamp. The 'unknown' tigerVintage sentinel is
			// externalized as null, never as the literal string 'unknown'.
			boundary_as_of: result.boundaryAsOf,
			officials_as_of: result.officialsAsOf,
			resolution_confidence: result.confidence,
			tiger_vintage:
				result.provenance.tigerVintage === 'unknown' ? null : result.provenance.tigerVintage
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error('[resolve-address] Unhandled error:', message);
		return json(
			{
				resolved: false,
				// Surface the real message in dev so missing env vars / config drift
				// show up in the browser instead of the generic prod copy. Prod
				// callers still see the opaque "temporarily unavailable" string.
				error: dev ? message : 'Address resolution service temporarily unavailable'
			},
			{ status: 500 }
		);
	}
};

/**
 * Parse matched address into components without trusting comma position.
 *
 * Shadow Atlas returns a compact canonical address:
 *   "12 MINT PLZ, SAN FRANCISCO, CA, 94103"
 * but this parser also survives a verbose display_name (Nominatim-era format,
 * kept as a defensive parse):
 *   "12, Mint Plaza, Tenderloin, San Francisco, California, 94103, United States"
 *
 * The latter includes neighborhoods between street and city, so positional
 * parsing corrupts fields. Use the submitted structured address as the fallback
 * and only lift geocoder components when they are identifiable.
 */
function parseMatchedAddress(
	matched: string,
	fallback: { street: string; city: string; state: string; zip: string; country?: 'US' | 'CA' }
): {
	street: string;
	city: string;
	state: string;
	zip: string;
} {
	const parts = matched
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
	const fallbackAddress = {
		street: fallback.street.trim(),
		city: fallback.city.trim(),
		state: fallback.state.trim().toUpperCase(),
		zip: fallback.zip.trim().toUpperCase()
	};

	if (parts.length === 4) {
		const state = normalizeRegionCode(parts[2], fallback.country);
		if (state && isPostalCode(parts[3])) {
			return {
				street: parts[0],
				city: parts[1],
				state,
				zip: parts[3].trim().toUpperCase()
			};
		}
	}

	const zip = parts.find(isPostalCode)?.toUpperCase() ?? fallbackAddress.zip;
	const state =
		parts.map((part) => normalizeRegionCode(part, fallback.country)).find(Boolean) ??
		fallbackAddress.state;
	const cityIndex = parts.findIndex((part) => sameToken(part, fallbackAddress.city));
	const city = cityIndex >= 0 ? parts[cityIndex] : fallbackAddress.city;

	return {
		street: parseStreetFromParts(parts, cityIndex, fallbackAddress.street),
		city,
		state,
		zip
	};
}

function parseStreetFromParts(parts: string[], cityIndex: number, fallbackStreet: string): string {
	const streetParts = cityIndex > 0 ? parts.slice(0, cityIndex) : parts;
	const first = streetParts[0] ?? '';
	const second = streetParts[1] ?? '';
	if (/^\d+[A-Za-z]?$/.test(first) && second) return `${first} ${second}`;
	if (/\d/.test(first)) return first;
	return fallbackStreet;
}

function isPostalCode(value: string): boolean {
	return /^\d{5}(-\d{4})?$|^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(value.trim());
}

function sameToken(left: string, right: string): boolean {
	return normalizeToken(left) === normalizeToken(right);
}

function normalizeToken(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeRegionCode(value: string, country: 'US' | 'CA' = 'US'): string | null {
	const trimmed = value.trim();
	if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
	const key = normalizeToken(trimmed);
	const map = country === 'CA' ? CANADIAN_PROVINCE_CODES : US_STATE_CODES;
	return map[key] ?? null;
}

const US_STATE_CODES: Record<string, string> = {
	alabama: 'AL',
	alaska: 'AK',
	arizona: 'AZ',
	arkansas: 'AR',
	california: 'CA',
	colorado: 'CO',
	connecticut: 'CT',
	delaware: 'DE',
	'district of columbia': 'DC',
	florida: 'FL',
	georgia: 'GA',
	hawaii: 'HI',
	idaho: 'ID',
	illinois: 'IL',
	indiana: 'IN',
	iowa: 'IA',
	kansas: 'KS',
	kentucky: 'KY',
	louisiana: 'LA',
	maine: 'ME',
	maryland: 'MD',
	massachusetts: 'MA',
	michigan: 'MI',
	minnesota: 'MN',
	mississippi: 'MS',
	missouri: 'MO',
	montana: 'MT',
	nebraska: 'NE',
	nevada: 'NV',
	'new hampshire': 'NH',
	'new jersey': 'NJ',
	'new mexico': 'NM',
	'new york': 'NY',
	'north carolina': 'NC',
	'north dakota': 'ND',
	ohio: 'OH',
	oklahoma: 'OK',
	oregon: 'OR',
	pennsylvania: 'PA',
	'rhode island': 'RI',
	'south carolina': 'SC',
	'south dakota': 'SD',
	tennessee: 'TN',
	texas: 'TX',
	utah: 'UT',
	vermont: 'VT',
	virginia: 'VA',
	washington: 'WA',
	'west virginia': 'WV',
	wisconsin: 'WI',
	wyoming: 'WY'
};

const CANADIAN_PROVINCE_CODES: Record<string, string> = {
	alberta: 'AB',
	'british columbia': 'BC',
	manitoba: 'MB',
	'new brunswick': 'NB',
	'newfoundland and labrador': 'NL',
	'nova scotia': 'NS',
	'ontario': 'ON',
	'prince edward island': 'PE',
	quebec: 'QC',
	saskatchewan: 'SK',
	'northwest territories': 'NT',
	nunavut: 'NU',
	yukon: 'YT'
};
