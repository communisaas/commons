/**
 * Country Resolver Framework Tests
 *
 * Tests the factory, interface compliance, and per-country resolver behavior.
 * External API calls are mocked — these are unit tests, not integration tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	getCountryResolver,
	isSupportedCountry,
	SUPPORTED_COUNTRIES,
	detectCountryFromCoordinates,
} from '$lib/server/location/resolver-factory';
import type { CountryResolver } from '$lib/server/location/country-resolver';

// ============================================================================
// Factory Tests
// ============================================================================

describe('Country Resolver Factory', () => {
	describe('getCountryResolver', () => {
		it('should return a US resolver for "US"', () => {
			const resolver = getCountryResolver('US');
			expect(resolver.country).toBe('US');
		});

		it('should return a CA resolver for "CA"', () => {
			const resolver = getCountryResolver('CA');
			expect(resolver.country).toBe('CA');
		});

		it('should return a GB resolver for "GB"', () => {
			const resolver = getCountryResolver('GB');
			expect(resolver.country).toBe('GB');
		});

		it('should return an AU resolver for "AU"', () => {
			const resolver = getCountryResolver('AU');
			expect(resolver.country).toBe('AU');
		});

		it('should be case-insensitive', () => {
			expect(getCountryResolver('us').country).toBe('US');
			expect(getCountryResolver('ca').country).toBe('CA');
			expect(getCountryResolver('gb').country).toBe('GB');
			expect(getCountryResolver('au').country).toBe('AU');
		});

		it('should throw for unsupported countries', () => {
			expect(() => getCountryResolver('FR')).toThrow('Unsupported country: FR');
			expect(() => getCountryResolver('JP')).toThrow('Unsupported country: JP');
			expect(() => getCountryResolver('XX')).toThrow('Unsupported country: XX');
		});

		it('should cache resolver instances (same object returned)', () => {
			const first = getCountryResolver('CA');
			const second = getCountryResolver('CA');
			expect(first).toBe(second);
		});
	});

	describe('isSupportedCountry', () => {
		it('should return true for supported countries', () => {
			expect(isSupportedCountry('US')).toBe(true);
			expect(isSupportedCountry('CA')).toBe(true);
			expect(isSupportedCountry('GB')).toBe(true);
			expect(isSupportedCountry('AU')).toBe(true);
		});

		it('should return false for unsupported countries', () => {
			expect(isSupportedCountry('FR')).toBe(false);
			expect(isSupportedCountry('DE')).toBe(false);
			expect(isSupportedCountry('XX')).toBe(false);
		});
	});

	describe('SUPPORTED_COUNTRIES', () => {
		it('should include exactly US, CA, GB, AU', () => {
			expect(SUPPORTED_COUNTRIES).toEqual(['US', 'CA', 'GB', 'AU']);
		});
	});

	describe('interface compliance', () => {
		const countries = ['US', 'CA', 'GB', 'AU'] as const;

		for (const code of countries) {
			it(`${code} resolver implements CountryResolver interface`, () => {
				const resolver: CountryResolver = getCountryResolver(code);
				expect(typeof resolver.country).toBe('string');
				expect(typeof resolver.resolveDistrict).toBe('function');
				expect(typeof resolver.getOfficials).toBe('function');
				expect(typeof resolver.getJurisdictionLevels).toBe('function');
			});

			it(`${code} resolver returns jurisdiction levels`, () => {
				const resolver = getCountryResolver(code);
				const levels = resolver.getJurisdictionLevels();
				expect(Array.isArray(levels)).toBe(true);
				expect(levels.length).toBeGreaterThan(0);
				expect(levels[0]).toBe('federal');
			});
		}
	});
});

// ============================================================================
// detectCountryFromCoordinates Tests
// ============================================================================

describe('detectCountryFromCoordinates', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('should return country code from Nominatim response', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				address: { country_code: 'us' },
			}),
		});

		const result = await detectCountryFromCoordinates(38.8977, -77.0365);
		expect(result).toBe('US');
	});

	it('should return null when Nominatim fails', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 500,
		});

		const result = await detectCountryFromCoordinates(0, 0);
		expect(result).toBeNull();
	});

	it('should return null when fetch throws', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error('Network error')
		);

		const result = await detectCountryFromCoordinates(0, 0);
		expect(result).toBeNull();
	});

	it('should uppercase the country code', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				address: { country_code: 'gb' },
			}),
		});

		const result = await detectCountryFromCoordinates(51.5074, -0.1278);
		expect(result).toBe('GB');
	});
});
