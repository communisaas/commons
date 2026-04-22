/**
 * GET /api/shadow-atlas/boundary?district=CA-11&lat=37.78&lng=-122.42
 *
 * Returns the GeoJSON boundary polygon for a congressional district.
 * Queries the Shadow Atlas bubble API with the provided centroid,
 * extracts the matching district's clipGeometry from the response.
 *
 * Auth: requires session. Cached in KV with 7-day TTL (boundaries
 * change quarterly with redistricting).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const SHADOW_ATLAS_URL = env.SHADOW_ATLAS_API_URL || 'http://localhost:3000';
const CACHE_TTL_SECONDS = 7 * 24 * 3600; // 7 days — boundaries change quarterly

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	if (!locals.session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const districtCode = url.searchParams.get('district');
	const lat = parseFloat(url.searchParams.get('lat') ?? '');
	const lng = parseFloat(url.searchParams.get('lng') ?? '');

	if (!districtCode || !districtCode.match(/^[A-Z]{2}-\d{1,2}$/)) {
		return json({ error: 'district must be format XX-NN (e.g., CA-11)' }, { status: 400 });
	}
	if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
		return json({ error: 'Valid lat/lng required' }, { status: 400 });
	}

	// Check KV cache
	const cacheKey = `boundary:${districtCode}`;
	const kv = (platform as { env?: { KV?: KVNamespace } })?.env?.KV;
	if (kv) {
		const cached = await kv.get(cacheKey);
		if (cached) {
			return json(JSON.parse(cached));
		}
	}

	// Query Shadow Atlas bubble API
	try {
		const response = await fetch(`${SHADOW_ATLAS_URL}/v1/bubble-query`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				center: { lat, lng },
				radius: 25000, // 25km — wide enough to capture the district
				layers: ['cd']  // Congressional districts only
			})
		});

		if (!response.ok) {
			return json({ error: 'Shadow Atlas query failed' }, { status: 502 });
		}

		const data = await response.json() as {
			districts?: Array<{
				id: string;
				name: string;
				layer: string;
				clipGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
			}>;
		};

		if (!data.districts?.length) {
			return json({ error: 'No districts found at coordinates' }, { status: 404 });
		}

		// Match by district code. Shadow Atlas returns districts with varying ID formats.
		// Try exact match first, then FIPS-based matching (state FIPS + zero-padded district).
		const stateCode = districtCode.split('-')[0]; // e.g., "CA"
		const districtNum = districtCode.split('-')[1]; // e.g., "11"
		const paddedNum = districtNum.padStart(2, '0'); // e.g., "11"

		const match = data.districts.find(d => {
			// Exact code match
			if (d.id === districtCode) return true;
			// FIPS GEOID match: state FIPS (2 digits) + district (2 digits), e.g., "0611" for CA-11
			if (d.id.length >= 4 && d.id.endsWith(paddedNum) && d.layer === 'cd') return true;
			return false;
		});

		if (!match) {
			return json({ error: `District ${districtCode} not found in response` }, { status: 404 });
		}

		const result = {
			districtCode,
			geometry: match.clipGeometry,
			name: match.name
		};

		// Cache in KV
		if (kv) {
			await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
		}

		return json(result);
	} catch (e) {
		console.error('[boundary] Shadow Atlas query failed:', e);
		return json({ error: 'Failed to fetch boundary' }, { status: 502 });
	}
};
