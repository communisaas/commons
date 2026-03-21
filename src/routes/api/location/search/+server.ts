/**
 * Server-side Nominatim search proxy for location autocomplete.
 *
 * Replaces direct browser->Nominatim calls (geocoding-api.ts) with a server
 * proxy that enforces rate limiting, transforms results, and respects the
 * Nominatim usage policy (1 req/sec, valid User-Agent).
 *
 * No auth required -- this powers public template browsing.
 *
 * Usage Policy: https://operations.osmfoundation.org/policies/nominatim/
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStateCode } from '$lib/core/location/state-codes';

/** Structured location hierarchy returned to clients. */
interface LocationHierarchy {
	country: { code: string; name: string };
	state: { code: string; name: string; country_code: string } | null;
	city: { name: string; state_code: string | null; country_code: string; lat: number; lon: number } | null;
	display_name: string;
}

// ---------------------------------------------------------------------------
// Rate limiting (module-level singleton -- survives across requests)
// ---------------------------------------------------------------------------

let lastNominatimTime = 0;
const NOMINATIM_INTERVAL = 1100; // ms -- Nominatim policy: max 1 req/sec

/**
 * Wait until at least NOMINATIM_INTERVAL ms have elapsed since the last
 * Nominatim request. Queues callers rather than rejecting them.
 */
async function enforceRateLimit(): Promise<void> {
	const now = Date.now();
	const elapsed = now - lastNominatimTime;
	if (elapsed < NOMINATIM_INTERVAL) {
		await new Promise((resolve) => setTimeout(resolve, NOMINATIM_INTERVAL - elapsed));
	}
	lastNominatimTime = Date.now();
}

// ---------------------------------------------------------------------------
// Nominatim result type (raw JSON shape)
// ---------------------------------------------------------------------------

interface NominatimResult {
	display_name: string;
	lat: string;
	lon: string;
	address: {
		country?: string;
		country_code?: string;
		state?: string;
		province?: string; // Canadian provinces use this field, not 'state'
		state_district?: string;
		'ISO3166-2-lvl4'?: string; // e.g., "CA-ON", "US-CA" — reliable state/province code
		city?: string;
		town?: string;
		county?: string;
		municipality?: string;
		village?: string;
	};
}

// ---------------------------------------------------------------------------
// Transform helpers
// ---------------------------------------------------------------------------

function transformResult(r: NominatimResult): LocationHierarchy {
	const countryCode = r.address.country_code?.toUpperCase() || '';
	// Nominatim uses 'state' for US/AU but 'province' for Canada
	const stateName = r.address.state || r.address.province;
	const cityName = r.address.city || r.address.town || r.address.municipality || r.address.village;

	// State code resolution: try getStateCode first, then parse ISO3166-2-lvl4
	let stateCode = getStateCode(stateName, countryCode);
	if (!stateCode && r.address['ISO3166-2-lvl4']) {
		// "CA-ON" → "ON", "US-CA" → "CA"
		const parts = r.address['ISO3166-2-lvl4'].split('-');
		if (parts.length === 2) {
			stateCode = parts[1];
		}
	}

	return {
		country: {
			code: countryCode,
			name: r.address.country || ''
		},
		state: stateName
			? {
					code: stateCode || stateName,
					name: stateName,
					country_code: countryCode
				}
			: null,
		city: cityName
			? {
					name: cityName,
					state_code: stateCode,
					country_code: countryCode,
					lat: parseFloat(r.lat),
					lon: parseFloat(r.lon)
				}
			: null,
		display_name: r.display_name
	};
}

function filterByScope(
	results: LocationHierarchy[],
	scope: 'country' | 'state' | 'city' | 'any'
): LocationHierarchy[] {
	if (scope === 'any') return results;

	return results.filter((loc) => {
		if (scope === 'country') return loc.country.code && !loc.state && !loc.city;
		if (scope === 'state') return !!loc.state && !loc.city;
		if (scope === 'city') return !!loc.city;
		return true;
	});
}

// ---------------------------------------------------------------------------
// GET /api/location/search
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ url }) => {
	// -- Parse & validate query params ----------------------------------------

	const q = url.searchParams.get('q')?.trim() ?? '';
	const scope = (url.searchParams.get('scope') ?? 'city') as 'country' | 'state' | 'city' | 'any';
	const country = url.searchParams.get('country') ?? undefined;
	const state = url.searchParams.get('state') ?? undefined;
	const rawLimit = parseInt(url.searchParams.get('limit') ?? '5', 10);

	if (!q || q.length < 2) {
		return json(
			{ error: 'Query parameter "q" is required and must be at least 2 characters' },
			{ status: 400 }
		);
	}

	if (q.length > 200) {
		return json(
			{ error: 'Query too long (200 character maximum)' },
			{ status: 400 }
		);
	}

	if (!['country', 'state', 'city', 'any'].includes(scope)) {
		return json(
			{ error: 'Invalid scope. Must be one of: country, state, city, any' },
			{ status: 400 }
		);
	}

	const limit = Math.max(1, Math.min(rawLimit, 10));

	// -- Build Nominatim request -----------------------------------------------

	let searchQuery = q;
	if (scope === 'city' && state) {
		searchQuery = `${q}, ${state}`;
	}

	const params = new URLSearchParams({
		q: searchQuery,
		format: 'json',
		addressdetails: '1',
		limit: String(limit)
	});

	if (country) {
		params.set('countrycodes', country.toLowerCase());
	}

	// -- Rate limit & fetch ----------------------------------------------------

	await enforceRateLimit();

	let nominatimResults: NominatimResult[];

	try {
		const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
			headers: {
				'User-Agent': 'Commons/1.0 (https://commons.email)'
			},
			signal: AbortSignal.timeout(10_000)
		});

		if (!response.ok) {
			console.error('[location/search] Nominatim HTTP error:', response.status, response.statusText);
			// Graceful degradation: return empty array, not an error
			return json([], {
				headers: { 'Cache-Control': 'public, max-age=60' } // Short cache on failure
			});
		}

		nominatimResults = await response.json();
	} catch (error) {
		console.error(
			'[location/search] Nominatim fetch failed:',
			error instanceof Error ? error.message : error
		);
		// Graceful degradation
		return json([], {
			headers: { 'Cache-Control': 'public, max-age=60' }
		});
	}

	// -- Transform & filter ----------------------------------------------------

	const transformed = nominatimResults.map(transformResult);
	const filtered = filterByScope(transformed, scope);

	// Deduplicate country-scope results by country code (Nominatim can return
	// multiple entries for the same country with different bounding boxes)
	if (scope === 'country') {
		const seen = new Set<string>();
		const deduped: typeof filtered = [];
		for (const loc of filtered) {
			if (!seen.has(loc.country.code)) {
				seen.add(loc.country.code);
				deduped.push(loc);
			}
		}
		return json(deduped, {
			headers: { 'Cache-Control': 'public, max-age=3600' }
		});
	}

	return json(filtered, {
		headers: {
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
