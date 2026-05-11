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
import { env as publicEnv } from '$env/dynamic/public';
import { displayDistrictToGEOID } from './district-format.js';

// Atlas host. Defaults to the reference commons.email deployment;
// peer implementations override via PUBLIC_ATLAS_HOST. The default is
// preserved so commons.email's current deployment is unaffected.
const ATLAS_HOST = publicEnv.PUBLIC_ATLAS_HOST || 'https://atlas.commons.email';

interface SourceManifest {
	currentVersion: string;
}

let manifestPromise: Promise<SourceManifest | null> | null = null;

/**
 * Default manifest fetch timeout. A degraded edge that takes >5s to serve a
 * 1 KB JSON response is effectively unreachable for our purposes. Without
 * this, any caller that doesn't pass its own AbortSignal can hang the UX
 * indefinitely on app load (G6r finding).
 */
const MANIFEST_FETCH_TIMEOUT_MS = 5_000;

/**
 * Fetch the source manifest. Caches SUCCESSFUL results for the page lifetime
 * (browser HTTP cache also absorbs repeat fetches via Cache-Control). Failures
 * are NOT cached — without this, one transient 503 at app boot poisons
 * district boundary rendering AND the migration check for the entire session
 * (G6r CRITICAL finding: cache poisoning affects production code beyond G6).
 */
async function getManifest(signal?: AbortSignal): Promise<SourceManifest | null> {
	if (manifestPromise) return manifestPromise;

	// Compose a timeout signal with the optional caller signal so app-load
	// callers that pass nothing still get bounded latency.
	const timeoutSignal = AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS);
	const composedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

	const attempt = fetch(`${ATLAS_HOST}/source/manifest.json`, { signal: composedSignal })
		.then((r) => (r.ok ? (r.json() as Promise<SourceManifest>) : null))
		.catch(() => null);

	manifestPromise = attempt;

	// Clear the cache on null so a transient outage doesn't poison the rest
	// of the session. Subsequent calls will retry.
	const result = await attempt;
	if (result === null && manifestPromise === attempt) {
		manifestPromise = null;
	}
	return result;
}

/**
 * G6: get the current atlas version string for migration delta checks.
 * Returns null if the manifest cannot be fetched (network failure, atlas
 * not yet published). Callers MUST tolerate null — a missing version
 * doesn't mean "no migration needed," it means "we don't know."
 */
export async function getCurrentAtlasVersion(
	signal?: AbortSignal,
): Promise<string | null> {
	const manifest = await getManifest(signal);
	return manifest?.currentVersion ?? null;
}

/**
 * G6: reset the in-memory manifest cache. Tests only — production paths
 * should let the page-lifetime memoization stand.
 */
export function _resetManifestCacheForTest(): void {
	manifestPromise = null;
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
