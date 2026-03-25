/**
 * Country Resolver Factory
 *
 * Returns the correct CountryResolver for a given ISO 3166-1 alpha-2 country code.
 * Resolvers are lazily instantiated and cached for the lifetime of the process.
 */

import type { CountryResolver } from './country-resolver';
import { USResolver } from './resolvers/us';
import { CAResolver } from './resolvers/ca';
import { GBResolver } from './resolvers/gb';
import { AUResolver } from './resolvers/au';

/** Supported country codes for district resolution */
export const SUPPORTED_COUNTRIES = ['US', 'CA', 'GB', 'AU'] as const;
export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];

/** Cached resolver instances (one per country, reused across requests) */
const resolverCache = new Map<string, CountryResolver>();

/**
 * Get the resolver for a given country code.
 *
 * @param countryCode - ISO 3166-1 alpha-2 code (e.g., 'US', 'CA', 'GB', 'AU')
 * @returns The country-specific resolver
 * @throws Error if the country is not supported
 */
export function getCountryResolver(countryCode: string): CountryResolver {
	const code = countryCode.toUpperCase();

	const cached = resolverCache.get(code);
	if (cached) return cached;

	let resolver: CountryResolver;

	switch (code) {
		case 'US':
			resolver = new USResolver();
			break;
		case 'CA':
			resolver = new CAResolver();
			break;
		case 'GB':
			resolver = new GBResolver();
			break;
		case 'AU':
			resolver = new AUResolver();
			break;
		default:
			throw new Error(
				`Unsupported country: ${countryCode}. Supported: ${SUPPORTED_COUNTRIES.join(', ')}`
			);
	}

	resolverCache.set(code, resolver);
	return resolver;
}

/**
 * Check if a country code is supported for district resolution.
 */
export function isSupportedCountry(countryCode: string): countryCode is SupportedCountry {
	return SUPPORTED_COUNTRIES.includes(countryCode.toUpperCase() as SupportedCountry);
}

/**
 * Detect country from geographic coordinates using reverse geocoding.
 * Returns the ISO 3166-1 alpha-2 country code, or null if detection fails.
 *
 * Uses Nominatim reverse geocoding with a coarse zoom level (country-level)
 * to minimize data transfer and respect rate limits.
 */
export async function detectCountryFromCoordinates(
	lat: number,
	lng: number
): Promise<string | null> {
	try {
		const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=3`;
		const response = await fetch(url, {
			headers: {
				Accept: 'application/json',
				'User-Agent': 'Commons/1.0 (https://commons.email)',
			},
			signal: AbortSignal.timeout(5_000),
		});

		if (!response.ok) return null;

		const data = await response.json();
		const countryCode = data.address?.country_code?.toUpperCase();

		return countryCode || null;
	} catch {
		return null;
	}
}
