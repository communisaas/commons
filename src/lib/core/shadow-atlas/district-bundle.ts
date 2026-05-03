/**
 * District boundary fetch (browser-side, no server proxy).
 *
 * Replaces the deprecated /api/shadow-atlas/boundary handler. District
 * boundaries are public law — fetching them through an authenticated proxy
 * that takes lat/lng + session identity to return a polygon every constituent
 * of the same district receives leaks the user's location and identity for a
 * question whose answer is identical for everyone.
 *
 * This helper fetches directly from atlas.commons.email/source/{version}/us/cd/{id}.geojson.
 * Cloudflare's edge caches the file (immutable per version), so most requests
 * never reach our origin. The user's browser sends only the URL — no lat/lng,
 * no session cookie that's scoped to commons.email, no identifying metadata
 * beyond the inevitable HTTP request.
 *
 * Manifest currentVersion is fetched once per page load and memoized; bundle
 * URLs derive from it. When publish:source flips the pointer, the next
 * page-load fetch picks up the new version.
 */

import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { displayDistrictToGEOID } from './district-format.js';

const ATLAS_HOST = 'https://atlas.commons.email';

interface SourceManifest {
	currentVersion: string;
}

let manifestPromise: Promise<SourceManifest | null> | null = null;

/**
 * Fetch the source manifest. Cached for the page lifetime (browser HTTP cache
 * also absorbs repeat fetches via Cache-Control on the manifest).
 */
async function getManifest(signal?: AbortSignal): Promise<SourceManifest | null> {
	if (manifestPromise) return manifestPromise;
	manifestPromise = fetch(`${ATLAS_HOST}/source/manifest.json`, { signal })
		.then((r) => (r.ok ? (r.json() as Promise<SourceManifest>) : null))
		.catch(() => null);
	return manifestPromise;
}

export interface DistrictBoundary {
	geometry: Polygon | MultiPolygon;
	name: string;
}

/**
 * Fetch a US congressional district's boundary GeoJSON by display code.
 *
 * @param displayCode - "CA-11", "VT-AL", "TX-23", etc.
 * @param signal - optional AbortSignal for cancellation
 * @returns the polygon geometry + display name, or null if the lookup fails
 *          (unknown state, district file not found, network error)
 */
export async function getDistrictBoundary(
	displayCode: string,
	signal?: AbortSignal,
): Promise<DistrictBoundary | null> {
	const geoid = displayDistrictToGEOID(displayCode);
	if (!geoid) return null;

	const manifest = await getManifest(signal);
	if (!manifest) return null;

	const url = `${ATLAS_HOST}/source/${manifest.currentVersion}/us/cd/cd-${geoid}.geojson`;
	try {
		const response = await fetch(url, { signal });
		if (!response.ok) return null;
		const feature = (await response.json()) as Feature<Polygon | MultiPolygon>;
		if (!feature?.geometry) return null;
		return {
			geometry: feature.geometry,
			name: (feature.properties?.name as string | undefined) ?? displayCode,
		};
	} catch {
		// Network error, abort, or non-JSON body — handled by the caller as
		// "boundary unavailable, fall back to non-spatial UI."
		return null;
	}
}
