/**
 * Unit tests for Browser Location Utilities
 *
 * Tests getBrowserGeolocation and getTimezoneLocation functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Browser Location Module', () => {
	let getTimezoneLocation: typeof import('$lib/core/location/browser-location').getTimezoneLocation;
	let getBrowserGeolocation: typeof import('$lib/core/location/browser-location').getBrowserGeolocation;

	beforeEach(async () => {
		vi.clearAllMocks();
		const mod = await import('$lib/core/location/browser-location');
		getTimezoneLocation = mod.getTimezoneLocation;
		getBrowserGeolocation = mod.getBrowserGeolocation;
	});

	// =========================================================================
	// getTimezoneLocation
	// =========================================================================

	describe('getTimezoneLocation', () => {
		it('should return country-level signal for America/New_York', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'America/New_York' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();

			expect(signal).not.toBeNull();
			expect(signal!.signal_type).toBe('ip');
			expect(signal!.confidence).toBe(0.15);
			expect(signal!.country_code).toBe('US');
			expect(signal!.state_code).toBeNull();
			expect(signal!.source).toBe('browser.timezone');
		});

		it('should return US for America/Los_Angeles', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'America/Los_Angeles' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.country_code).toBe('US');
			expect(signal!.state_code).toBeNull();
		});

		it('should return US for America/Chicago', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'America/Chicago' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.country_code).toBe('US');
			expect(signal!.state_code).toBeNull();
		});

		it('should return US for America/Denver', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'America/Denver' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.country_code).toBe('US');
			expect(signal!.state_code).toBeNull();
		});

		it('should return US for America/Anchorage', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'America/Anchorage' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.country_code).toBe('US');
			expect(signal!.state_code).toBeNull();
		});

		it('should return US for Pacific/Honolulu', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'Pacific/Honolulu' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.country_code).toBe('US');
			expect(signal!.state_code).toBeNull();
		});

		it('should return the ISO code PR for America/Puerto_Rico', () => {
			// Territories carry their own ISO 3166-1 code (matches the IP path, which
			// surfaces 'PR' too) rather than being folded into 'US'.
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'America/Puerto_Rico' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.country_code).toBe('PR');
			expect(signal!.state_code).toBeNull();
		});

		it('should return GB for Europe/London', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'Europe/London' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal).not.toBeNull();
			expect(signal!.country_code).toBe('GB');
			expect(signal!.state_code).toBeNull();
		});

		it('should return null for an unknown (non-IANA) timezone', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'Fictional/Nowhere' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal).toBeNull();
		});

		it('resolves countries outside the legacy curated set (regression: Malaysia)', () => {
			// Asia/Kuala_Lumpur was absent from the old hand-maintained table, so a
			// Malaysian user got no timezone signal. The complete IANA map covers it.
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'Asia/Kuala_Lumpur' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.country_code).toBe('MY');
			expect(signal!.state_code).toBeNull();
		});

		it('should return null when Intl throws', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
				throw new Error('Intl not available');
			});

			const signal = getTimezoneLocation();
			expect(signal).toBeNull();
		});

		it('should include timezone in metadata', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'America/Detroit' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.metadata?.timezone).toBe('America/Detroit');
			expect(signal!.country_code).toBe('US');
			expect(signal!.state_code).toBeNull();
		});

		it('should resolve multi-segment Indiana timezone to US', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'America/Indiana/Indianapolis' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.country_code).toBe('US');
			expect(signal!.state_code).toBeNull();
		});

		it('should resolve multi-segment Kentucky timezone to US', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'America/Kentucky/Louisville' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.country_code).toBe('US');
			expect(signal!.state_code).toBeNull();
		});

		it('should set congressional_district to null (timezone cannot determine district)', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'America/New_York' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.congressional_district).toBeNull();
		});

		it('should return the ISO code GU for Pacific/Guam', () => {
			vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
				() =>
					({
						resolvedOptions: () => ({ timeZone: 'Pacific/Guam' })
					}) as Intl.DateTimeFormat
			);

			const signal = getTimezoneLocation();
			expect(signal!.country_code).toBe('GU');
			expect(signal!.state_code).toBeNull();
		});
	});

	// =========================================================================
	// getBrowserGeolocation
	// =========================================================================

	describe('getBrowserGeolocation', () => {
		it('should return null when geolocation is not supported', async () => {
			// Temporarily remove geolocation from navigator
			const origNav = window.navigator;
			Object.defineProperty(window, 'navigator', {
				value: { ...origNav, geolocation: undefined },
				writable: true,
				configurable: true
			});

			const result = await getBrowserGeolocation();

			expect(result).toBeNull();

			// Restore
			Object.defineProperty(window, 'navigator', {
				value: origNav,
				writable: true,
				configurable: true
			});
		});

		it('should return null when user denies permission', async () => {
			const mockGeolocation = {
				getCurrentPosition: vi.fn((_success: PositionCallback, error?: PositionErrorCallback) => {
					if (error) {
						error({
							code: 1,
							message: 'User denied Geolocation',
							PERMISSION_DENIED: 1,
							POSITION_UNAVAILABLE: 2,
							TIMEOUT: 3
						} as GeolocationPositionError);
					}
				})
			};

			Object.defineProperty(window.navigator, 'geolocation', {
				value: mockGeolocation,
				writable: true,
				configurable: true
			});

			const result = await getBrowserGeolocation();

			expect(result).toBeNull();
		});

		it('returns coordinates without assuming a country', async () => {
			const mockGeolocation = {
				getCurrentPosition: vi.fn((success: PositionCallback) => {
					success({
						coords: { latitude: 1.4, longitude: 103.6 },
						timestamp: 0
					} as GeolocationPosition);
				})
			};

			Object.defineProperty(window.navigator, 'geolocation', {
				value: mockGeolocation,
				writable: true,
				configurable: true
			});

			const result = await getBrowserGeolocation();

			expect(result).not.toBeNull();
			expect(result!.latitude).toBe(1.4);
			expect(result!.longitude).toBe(103.6);
			// Coordinates don't reveal a country — must not be hardcoded to US.
			expect(result!.country_code).toBeNull();
		});
	});
});
