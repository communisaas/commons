import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { resolveAddress } from '$lib/core/shadow-atlas/client';

/**
 * POST /api/location/resolve-address
 *
 * Authenticated proxy to Shadow Atlas's self-hosted address resolution.
 * All geocoding, district lookup, and officials resolution happens server-side
 * in Shadow Atlas (Nominatim + R-tree + SQLite). Zero external government API calls.
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

		// Extract district code from Shadow Atlas response
		const districtCode = result.officials?.district_code ?? null;
		const stateCode = result.officials?.state ?? state.toUpperCase();

		// Privacy: log only district code, never address
		console.info(`[resolve-address] Resolved via Shadow Atlas district=${districtCode}`);

		return json({
			resolved: true,
			address: {
				matched: result.geocode.matched_address,
				...parseMatchedAddress(result.geocode.matched_address, {
					street,
					city,
					state,
					zip,
					country: country ?? result.geocode.country
				})
			},
			coordinates: {
				lat: result.geocode.lat,
				lng: result.geocode.lng
			},
			district: districtCode
				? {
						code: districtCode,
						name: result.district?.name ?? `Congressional District`,
						state: stateCode
					}
				: null,
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
			county_fips: null
		});
	} catch (error) {
		console.error(
			'[resolve-address] Unhandled error:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		return json(
			{
				resolved: false,
				error: 'Address resolution service temporarily unavailable'
			},
			{ status: 500 }
		);
	}
};

/**
 * Parse matched address into components without trusting comma position.
 *
 * Shadow Atlas can return either a compact canonical address:
 *   "12 MINT PLZ, SAN FRANCISCO, CA, 94103"
 * or a Nominatim display_name:
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
