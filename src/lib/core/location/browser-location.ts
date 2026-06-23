/**
 * Browser Location Utilities
 *
 * Browser geolocation and timezone-based location inference.
 */

import type { LocationSignal } from './types';
import { timezoneToCountry } from './tz-country';

// ============================================================================
// Browser Geolocation Utilities
// ============================================================================

/**
 * Get browser geolocation (requires user permission)
 */
export async function getBrowserGeolocation(): Promise<LocationSignal | null> {
	// Check if geolocation is supported
	if (!navigator.geolocation) {
		console.warn('Geolocation API not supported');
		return null;
	}

	return new Promise((resolve) => {
		navigator.geolocation.getCurrentPosition(
			(position) => {
				const { latitude, longitude } = position.coords;

				// Return minimal signal with coordinates only.
				// District resolution happens server-side via /api/location/resolve
				// (Shadow Atlas for districts/officials).
				resolve({
					signal_type: 'browser',
					confidence: 0.6,
					// Coordinates alone don't reveal a country — reverse geocoding happens
					// server-side via /api/location/resolve. Leave country unset so the
					// fusion takes it from a signal that actually knows it (IP/timezone),
					// instead of mislabeling every GPS user as US.
					country_code: null,
					congressional_district: null,
					state_code: null,
					city_name: null,
					county_fips: null,
					latitude,
					longitude,
					source: 'browser.geolocation',
					timestamp: new Date().toISOString()
				});
			},
			(error) => {
				console.warn('Geolocation permission denied or unavailable:', error.message);
				resolve(null);
			},
			{
				enableHighAccuracy: true,
				timeout: 30000, // 30 seconds for geolocation
				maximumAge: 0
			}
		);
	});
}

/**
 * Get timezone-based location inference (country-level only).
 *
 * Design principle: timezone → country is reliable (IANA zone names are
 * geographically scoped). Timezone → state is NOT (US Eastern covers 20+
 * states, Canada and US share the America/* prefix). We intentionally do NOT
 * infer state/province from timezone — that's what IP lookup and user
 * selection are for.
 *
 * Coverage is the complete IANA zone → country map (see ./tz-country), so any
 * country resolves. Unknown zones return null.
 */
export function getTimezoneLocation(): LocationSignal | null {
	try {
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		console.debug(`[Location] Detected timezone: ${timezone}`);

		const countryCode = timezoneToCountry(timezone);

		if (!countryCode) {
			console.debug(`[Location] No country mapping for timezone: ${timezone}`);
			return null;
		}

		return {
			signal_type: 'ip',
			confidence: 0.15, // Very low — country-level hint only
			country_code: countryCode,
			state_code: null, // Intentionally null: timezone cannot reliably infer state
			city_name: null,
			congressional_district: null,
			county_fips: null,
			latitude: null,
			longitude: null,
			source: 'browser.timezone',
			timestamp: new Date().toISOString(),
			metadata: {
				timezone
			}
		};
	} catch (error) {
		console.error('Failed to extract timezone location:', error);
		return null;
	}
}
