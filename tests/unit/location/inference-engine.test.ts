/**
 * Unit tests for Location Inference Engine
 *
 * Tests the 5-signal progressive inference system that fuses
 * IP, browser, OAuth, behavioral, and verified signals with
 * confidence weighting. All inference runs client-side.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LocationSignal, InferredLocation } from '$lib/core/location/types';
import {
	SIGNAL_CONFIDENCE_WEIGHTS,
	calculateWeightedConfidence,
	isSignalExpired,
	isLocationSignal,
	isInferredLocation,
	formatCongressionalDistrict,
	SIGNAL_EXPIRATION
} from '$lib/core/location/types';

// ---------------------------------------------------------------------------
// Mock dependencies: storage, browser-location, behavioral-tracker
// ---------------------------------------------------------------------------

const mockStorage = {
	getInferredLocation: vi.fn(),
	storeInferredLocation: vi.fn(),
	getSignals: vi.fn(),
	storeSignal: vi.fn(),
	clearExpiredSignals: vi.fn(),
	deleteSignalBySource: vi.fn(),
	clearAll: vi.fn()
};

const mockGetBrowserGeolocation = vi.fn();
const mockGetTimezoneLocation = vi.fn();
const mockBehavioralTracker = { inferFromBehavior: vi.fn() };

vi.mock('$lib/core/location/storage', () => ({
	locationStorage: mockStorage,
	LocationStorage: vi.fn()
}));

vi.mock('$lib/core/location/browser-location', () => ({
	getBrowserGeolocation: (...args: unknown[]) => mockGetBrowserGeolocation(...args),
	getTimezoneLocation: (...args: unknown[]) => mockGetTimezoneLocation(...args)
}));

vi.mock('$lib/core/location/behavioral-tracker', () => ({
	behavioralTracker: mockBehavioralTracker,
	BehavioralLocationTracker: vi.fn()
}));

// ---------------------------------------------------------------------------
// Helpers: signal factories
// ---------------------------------------------------------------------------

function makeSignal(overrides: Partial<LocationSignal> = {}): LocationSignal {
	return {
		signal_type: 'ip',
		confidence: 0.3,
		country_code: 'US',
		state_code: 'CA',
		city_name: null,
		congressional_district: null,
		county_fips: null,
		latitude: null,
		longitude: null,
		source: 'ip.geolocation',
		timestamp: new Date().toISOString(),
		...overrides
	};
}

function makeBrowserSignal(overrides: Partial<LocationSignal> = {}): LocationSignal {
	return makeSignal({
		signal_type: 'browser',
		confidence: 0.6,
		state_code: 'CA',
		congressional_district: 'CA-12',
		latitude: 37.7749,
		longitude: -122.4194,
		source: 'census.browser',
		...overrides
	});
}

function makeOAuthSignal(overrides: Partial<LocationSignal> = {}): LocationSignal {
	return makeSignal({
		signal_type: 'oauth',
		confidence: 0.8,
		state_code: 'TX',
		city_name: 'Austin',
		source: 'oauth.google',
		...overrides
	});
}

function makeVerifiedSignal(overrides: Partial<LocationSignal> = {}): LocationSignal {
	return makeSignal({
		signal_type: 'verified',
		confidence: 1.0,
		state_code: 'TX',
		congressional_district: 'TX-18',
		source: 'verification.identity',
		...overrides
	});
}

function makeBehavioralSignal(overrides: Partial<LocationSignal> = {}): LocationSignal {
	return makeSignal({
		signal_type: 'behavioral',
		confidence: 0.9,
		state_code: 'NY',
		congressional_district: 'NY-10',
		source: 'behavioral.template_views',
		...overrides
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Location Inference Engine', () => {
	let LocationInferenceEngine: typeof import('$lib/core/location/inference-engine').LocationInferenceEngine;
	let addOAuthLocationSignal: typeof import('$lib/core/location/inference-engine').addOAuthLocationSignal;
	let addVerifiedLocationSignal: typeof import('$lib/core/location/inference-engine').addVerifiedLocationSignal;
	let getUserLocation: typeof import('$lib/core/location/inference-engine').getUserLocation;
	let clearLocationData: typeof import('$lib/core/location/inference-engine').clearLocationData;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockStorage.getInferredLocation.mockResolvedValue(null);
		mockStorage.getSignals.mockResolvedValue([]);
		mockStorage.storeInferredLocation.mockResolvedValue(undefined);
		mockStorage.storeSignal.mockResolvedValue(undefined);
		mockStorage.clearExpiredSignals.mockResolvedValue(0);
		mockStorage.deleteSignalBySource.mockResolvedValue(undefined);
		mockStorage.clearAll.mockResolvedValue(undefined);
		mockGetTimezoneLocation.mockReturnValue(null);
		mockGetBrowserGeolocation.mockResolvedValue(null);

		// Re-import to get fresh instances
		const mod = await import('$lib/core/location/inference-engine');
		LocationInferenceEngine = mod.LocationInferenceEngine;
		addOAuthLocationSignal = mod.addOAuthLocationSignal;
		addVerifiedLocationSignal = mod.addVerifiedLocationSignal;
		getUserLocation = mod.getUserLocation;
		clearLocationData = mod.clearLocationData;
	});

	// =========================================================================
	// SIGNAL_CONFIDENCE_WEIGHTS
	// =========================================================================

	describe('SIGNAL_CONFIDENCE_WEIGHTS', () => {
		it('should define weights for all 6 signal types', () => {
			expect(SIGNAL_CONFIDENCE_WEIGHTS).toHaveProperty('ip', 0.2);
			expect(SIGNAL_CONFIDENCE_WEIGHTS).toHaveProperty('browser', 0.6);
			expect(SIGNAL_CONFIDENCE_WEIGHTS).toHaveProperty('oauth', 0.8);
			expect(SIGNAL_CONFIDENCE_WEIGHTS).toHaveProperty('behavioral', 0.9);
			expect(SIGNAL_CONFIDENCE_WEIGHTS).toHaveProperty('user_selected', 0.9);
			expect(SIGNAL_CONFIDENCE_WEIGHTS).toHaveProperty('verified', 1.0);
		});

		it('should have weights monotonically increasing by reliability', () => {
			expect(SIGNAL_CONFIDENCE_WEIGHTS.ip).toBeLessThan(SIGNAL_CONFIDENCE_WEIGHTS.browser);
			expect(SIGNAL_CONFIDENCE_WEIGHTS.browser).toBeLessThan(SIGNAL_CONFIDENCE_WEIGHTS.oauth);
			expect(SIGNAL_CONFIDENCE_WEIGHTS.oauth).toBeLessThan(SIGNAL_CONFIDENCE_WEIGHTS.behavioral);
			expect(SIGNAL_CONFIDENCE_WEIGHTS.behavioral).toBeLessThanOrEqual(
				SIGNAL_CONFIDENCE_WEIGHTS.verified
			);
		});
	});

	// =========================================================================
	// calculateWeightedConfidence
	// =========================================================================

	describe('calculateWeightedConfidence', () => {
		it('should return 0 for empty signal array', () => {
			expect(calculateWeightedConfidence([])).toBe(0);
		});

		it('should return confidence for a single IP signal', () => {
			const signals = [makeSignal({ confidence: 0.3 })];
			const result = calculateWeightedConfidence(signals);
			// weighted = 0.2 * 0.3 = 0.06; max = 0.2; result = 0.06/0.2 = 0.3
			expect(result).toBeCloseTo(0.3, 5);
		});

		it('should return 1.0 for a single verified signal at full confidence', () => {
			const signals = [makeVerifiedSignal({ confidence: 1.0 })];
			const result = calculateWeightedConfidence(signals);
			// weighted = 1.0 * 1.0 = 1.0; max = 1.0; result = 1.0
			expect(result).toBeCloseTo(1.0, 5);
		});

		it('should combine multiple signals with proper weighting', () => {
			const signals = [
				makeSignal({ confidence: 0.3 }), // ip: 0.2 * 0.3 = 0.06
				makeBrowserSignal({ confidence: 0.6 }) // browser: 0.6 * 0.6 = 0.36
			];
			const result = calculateWeightedConfidence(signals);
			// totalWeight = 0.06 + 0.36 = 0.42
			// maxPossible = 0.2 + 0.6 = 0.8
			// result = 0.42 / 0.8 = 0.525
			expect(result).toBeCloseTo(0.525, 3);
		});

		it('should give higher overall confidence when signals agree (high individual confidence)', () => {
			const agreeingSignals = [
				makeSignal({ confidence: 1.0 }),
				makeBrowserSignal({ confidence: 1.0 }),
				makeOAuthSignal({ confidence: 1.0 })
			];
			const result = calculateWeightedConfidence(agreeingSignals);
			// All at max: (0.2*1 + 0.6*1 + 0.8*1) / (0.2+0.6+0.8) = 1.6/1.6 = 1.0
			expect(result).toBeCloseTo(1.0, 5);
		});

		it('should reduce confidence when individual signals have low confidence', () => {
			const lowConfidenceSignals = [
				makeSignal({ confidence: 0.1 }),
				makeBrowserSignal({ confidence: 0.2 })
			];
			const result = calculateWeightedConfidence(lowConfidenceSignals);
			// (0.2*0.1 + 0.6*0.2) / (0.2+0.6) = (0.02+0.12)/0.8 = 0.14/0.8 = 0.175
			expect(result).toBeCloseTo(0.175, 3);
		});

		it('should weight verified signals most heavily', () => {
			const signals = [
				makeSignal({ confidence: 0.3 }), // ip
				makeVerifiedSignal({ confidence: 1.0 }) // verified
			];
			const result = calculateWeightedConfidence(signals);
			// (0.2*0.3 + 1.0*1.0) / (0.2+1.0) = (0.06+1.0)/1.2 = 1.06/1.2 = 0.883
			expect(result).toBeCloseTo(0.8833, 3);
		});
	});

	// =========================================================================
	// isSignalExpired
	// =========================================================================

	describe('isSignalExpired', () => {
		it('should not expire a signal created just now', () => {
			const signal = makeSignal({ timestamp: new Date().toISOString() });
			expect(isSignalExpired(signal)).toBe(false);
		});

		it('should expire an IP signal older than 24 hours', () => {
			const signal = makeSignal({
				signal_type: 'ip',
				timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
			});
			expect(isSignalExpired(signal)).toBe(true);
		});

		it('should not expire a browser signal at 3 days', () => {
			const signal = makeBrowserSignal({
				timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
			});
			expect(isSignalExpired(signal)).toBe(false);
		});

		it('should expire a browser signal after 7 days', () => {
			const signal = makeBrowserSignal({
				timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
			});
			expect(isSignalExpired(signal)).toBe(true);
		});

		it('should respect explicit expires_at over computed expiration', () => {
			const futureExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			const signal = makeSignal({
				signal_type: 'ip',
				timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
				expires_at: futureExpiry
			});
			// Even though IP normally expires at 24h and it's 48h old,
			// the explicit expires_at is in the future
			expect(isSignalExpired(signal)).toBe(false);
		});

		it('should expire when explicit expires_at is in the past', () => {
			const pastExpiry = new Date(Date.now() - 1000).toISOString();
			const signal = makeSignal({
				expires_at: pastExpiry,
				timestamp: new Date().toISOString()
			});
			expect(isSignalExpired(signal)).toBe(true);
		});

		it('should not expire a verified signal within 365 days', () => {
			const signal = makeVerifiedSignal({
				timestamp: new Date(Date.now() - 300 * 24 * 60 * 60 * 1000).toISOString()
			});
			expect(isSignalExpired(signal)).toBe(false);
		});

		it('should expire a verified signal after 365 days', () => {
			const signal = makeVerifiedSignal({
				timestamp: new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString()
			});
			expect(isSignalExpired(signal)).toBe(true);
		});
	});

	// =========================================================================
	// isLocationSignal type guard
	// =========================================================================

	describe('isLocationSignal', () => {
		it('should accept a valid signal', () => {
			expect(isLocationSignal(makeSignal())).toBe(true);
		});

		it('should reject null', () => {
			expect(isLocationSignal(null)).toBe(false);
		});

		it('should reject undefined', () => {
			expect(isLocationSignal(undefined)).toBe(false);
		});

		it('should reject object with invalid signal_type', () => {
			const invalid = { ...makeSignal(), signal_type: 'gps' };
			expect(isLocationSignal(invalid)).toBe(false);
		});

		it('should reject object with confidence > 1', () => {
			const invalid = { ...makeSignal(), confidence: 1.5 };
			expect(isLocationSignal(invalid)).toBe(false);
		});

		it('should reject object with negative confidence', () => {
			const invalid = { ...makeSignal(), confidence: -0.1 };
			expect(isLocationSignal(invalid)).toBe(false);
		});

		it('should accept all valid signal types', () => {
			for (const type of ['ip', 'browser', 'oauth', 'behavioral', 'user_selected', 'verified']) {
				const signal = makeSignal({ signal_type: type as LocationSignal['signal_type'] });
				expect(isLocationSignal(signal)).toBe(true);
			}
		});
	});

	// =========================================================================
	// isInferredLocation type guard
	// =========================================================================

	describe('isInferredLocation', () => {
		it('should accept valid InferredLocation', () => {
			const location: InferredLocation = {
				country_code: 'US',
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 0.6,
				signals: [makeBrowserSignal()],
				inferred_at: new Date().toISOString()
			};
			expect(isInferredLocation(location)).toBe(true);
		});

		it('should reject when confidence is out of range', () => {
			const location = {
				country_code: 'US',
				congressional_district: null,
				state_code: 'CA',
				confidence: 2.0,
				signals: [],
				inferred_at: new Date().toISOString()
			};
			expect(isInferredLocation(location)).toBe(false);
		});

		it('should reject null', () => {
			expect(isInferredLocation(null)).toBe(false);
		});

		it('should reject object missing signals array', () => {
			const location = {
				country_code: 'US',
				confidence: 0.5,
				inferred_at: new Date().toISOString()
			};
			expect(isInferredLocation(location)).toBe(false);
		});
	});

	// =========================================================================
	// formatCongressionalDistrict
	// =========================================================================

	describe('formatCongressionalDistrict', () => {
		it('should format TX-18 correctly', () => {
			expect(formatCongressionalDistrict('TX-18')).toBe('TX-18');
		});

		it('should pad single digit district numbers', () => {
			expect(formatCongressionalDistrict('CA-5')).toBe('CA-05');
		});

		it('should return null for null input', () => {
			expect(formatCongressionalDistrict(null)).toBeNull();
		});

		it('should uppercase and pad hyphenated strings', () => {
			// 'at-large' has a hyphen so it splits into ['at','large'] and formats as 'AT-large'
			expect(formatCongressionalDistrict('at-large')).toBe('AT-large');
		});

		it('should uppercase state codes', () => {
			expect(formatCongressionalDistrict('ny-10')).toBe('NY-10');
		});
	});

	// =========================================================================
	// LocationInferenceEngine - core inference
	// =========================================================================

	describe('LocationInferenceEngine.inferLocation', () => {
		it('should return empty location when no signals exist and generation fails', async () => {
			const engine = new LocationInferenceEngine();
			// No signals, no generated signals
			mockStorage.getSignals.mockResolvedValue([]);
			// IP lookup fails
			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: false,
				status: 500
			} as Response);
			mockGetTimezoneLocation.mockReturnValue(null);

			const result = await engine.inferLocation();

			expect(result.confidence).toBe(0);
			expect(result.signals).toHaveLength(0);
			expect(result.country_code).toBeNull();
			expect(result.congressional_district).toBeNull();
		});

		it('should return cached location if fresh (< 1 hour)', async () => {
			const engine = new LocationInferenceEngine();
			const cached: InferredLocation = {
				country_code: 'US',
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 0.6,
				signals: [makeBrowserSignal()],
				inferred_at: new Date().toISOString() // Now = fresh
			};
			mockStorage.getInferredLocation.mockResolvedValue(cached);

			const result = await engine.inferLocation();

			expect(result).toBe(cached);
			// Should NOT have called getSignals (no inference needed)
			expect(mockStorage.getSignals).not.toHaveBeenCalled();
		});

		it('should re-infer when cached location is older than 1 hour', async () => {
			const engine = new LocationInferenceEngine();
			const stale: InferredLocation = {
				country_code: 'US',
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 0.6,
				signals: [makeBrowserSignal()],
				inferred_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2 hours ago
			};
			mockStorage.getInferredLocation.mockResolvedValue(stale);
			mockStorage.getSignals.mockResolvedValue([makeBrowserSignal()]);

			const result = await engine.inferLocation();

			// Should have performed new inference
			expect(mockStorage.getSignals).toHaveBeenCalled();
			expect(result.inferred_at).not.toBe(stale.inferred_at);
		});

		it('should force refresh even with fresh cache when forceRefresh=true', async () => {
			const engine = new LocationInferenceEngine();
			const fresh: InferredLocation = {
				country_code: 'US',
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 0.6,
				signals: [makeBrowserSignal()],
				inferred_at: new Date().toISOString()
			};
			mockStorage.getInferredLocation.mockResolvedValue(fresh);
			mockStorage.getSignals.mockResolvedValue([makeBrowserSignal()]);

			const result = await engine.inferLocation(true);

			expect(mockStorage.getSignals).toHaveBeenCalled();
			expect(mockStorage.storeInferredLocation).toHaveBeenCalled();
		});

		it('should prevent concurrent inference (dedup)', async () => {
			const engine = new LocationInferenceEngine();
			const browserSignal = makeBrowserSignal();
			mockStorage.getSignals.mockResolvedValue([browserSignal]);

			// Fire two concurrent calls
			const [result1, result2] = await Promise.all([
				engine.inferLocation(),
				engine.inferLocation()
			]);

			// Both should return the same result
			expect(result1).toEqual(result2);
			// getSignals should only be called once (dedup)
			expect(mockStorage.clearExpiredSignals).toHaveBeenCalledTimes(1);
		});
	});

	// =========================================================================
	// Signal priority & extraction
	// =========================================================================

	describe('Signal priority enforcement', () => {
		it('should prefer verified signal over all others', async () => {
			const engine = new LocationInferenceEngine();
			const signals = [
				makeSignal({ confidence: 0.3 }), // ip
				makeBrowserSignal({ confidence: 0.6 }), // browser
				makeVerifiedSignal({ confidence: 1.0, state_code: 'TX', congressional_district: 'TX-18' })
			];
			mockStorage.getSignals.mockResolvedValue(signals);

			const result = await engine.inferLocation();

			expect(result.state_code).toBe('TX');
			expect(result.congressional_district).toBe('TX-18');
		});

		it('should prefer OAuth over IP and browser', async () => {
			const engine = new LocationInferenceEngine();
			const signals = [
				makeSignal({ confidence: 0.3, state_code: 'CA' }),
				makeOAuthSignal({ confidence: 0.8, state_code: 'TX', city_name: 'Austin' })
			];
			mockStorage.getSignals.mockResolvedValue(signals);

			const result = await engine.inferLocation();

			expect(result.state_code).toBe('TX');
			expect(result.city_name).toBe('Austin');
		});

		it('should use IP signal for country code when higher signals lack it', async () => {
			const engine = new LocationInferenceEngine();
			const signals = [
				makeSignal({ confidence: 0.3, country_code: 'US', state_code: 'CA' }),
				makeBehavioralSignal({
					confidence: 0.9,
					country_code: undefined,
					state_code: 'NY',
					congressional_district: 'NY-10'
				})
			];
			mockStorage.getSignals.mockResolvedValue(signals);

			const result = await engine.inferLocation();

			// Primary signal is behavioral (highest weight), so state/district from that
			expect(result.state_code).toBe('NY');
			expect(result.congressional_district).toBe('NY-10');
			// Country code should come from IP signal (first signal with country_code)
			expect(result.country_code).toBe('US');
		});
	});

	// =========================================================================
	// Multiple signals combining
	// =========================================================================

	describe('Multiple signal combination', () => {
		it('should boost overall confidence when signals agree on state', async () => {
			const engine = new LocationInferenceEngine();
			const signals = [
				makeSignal({ confidence: 0.6, state_code: 'CA', country_code: 'US' }),
				makeBrowserSignal({ confidence: 0.6, state_code: 'CA', country_code: 'US' }),
				makeOAuthSignal({ confidence: 0.8, state_code: 'CA', country_code: 'US' })
			];
			mockStorage.getSignals.mockResolvedValue(signals);

			const result = await engine.inferLocation();

			// Weighted confidence should be high when all 3 signals agree
			expect(result.confidence).toBeGreaterThan(0.6);
		});

		it('should produce lower confidence with only a single weak signal', async () => {
			const engine = new LocationInferenceEngine();
			const signals = [makeSignal({ confidence: 0.3, state_code: 'CA' })];
			mockStorage.getSignals.mockResolvedValue(signals);

			const result = await engine.inferLocation();

			expect(result.confidence).toBeCloseTo(0.3, 2);
		});

		it('should use the highest weighted signal for location data', async () => {
			const engine = new LocationInferenceEngine();
			const signals = [
				makeSignal({
					confidence: 0.6,
					state_code: 'CA',
					congressional_district: null,
					country_code: 'US'
				}),
				makeOAuthSignal({
					confidence: 0.8,
					state_code: 'TX',
					city_name: 'Austin',
					congressional_district: null,
					country_code: 'US'
				})
			];
			mockStorage.getSignals.mockResolvedValue(signals);

			const result = await engine.inferLocation();

			// OAuth has higher weighted confidence (0.8 * 0.8) > IP (0.2 * 0.6)
			expect(result.state_code).toBe('TX');
			expect(result.city_name).toBe('Austin');
		});
	});

	// =========================================================================
	// addSignal
	// =========================================================================

	describe('addSignal', () => {
		it('should delete existing signal from same source then add new one', async () => {
			const engine = new LocationInferenceEngine();
			const signal = makeOAuthSignal({ source: 'oauth.google' });
			mockStorage.getSignals.mockResolvedValue([signal]);

			await engine.addSignal(signal);

			expect(mockStorage.deleteSignalBySource).toHaveBeenCalledWith('oauth.google');
			expect(mockStorage.storeSignal).toHaveBeenCalledWith(signal);
		});

		it('should trigger re-inference after adding signal', async () => {
			const engine = new LocationInferenceEngine();
			const signal = makeVerifiedSignal();
			mockStorage.getSignals.mockResolvedValue([signal]);

			await engine.addSignal(signal);

			expect(mockStorage.storeInferredLocation).toHaveBeenCalled();
		});
	});

	// =========================================================================
	// addOAuthLocationSignal (public API)
	// =========================================================================

	describe('addOAuthLocationSignal', () => {
		it('should parse "Austin, TX" into city and state', async () => {
			mockStorage.getSignals.mockResolvedValue([]);

			await addOAuthLocationSignal('google', 'Austin, TX');

			const storedSignal = mockStorage.storeSignal.mock.calls[0]?.[0] as LocationSignal;
			// The addSignal path calls deleteSignalBySource then storeSignal
			expect(mockStorage.deleteSignalBySource).toHaveBeenCalledWith('oauth.google');
			expect(storedSignal).toBeDefined();
			expect(storedSignal.signal_type).toBe('oauth');
			expect(storedSignal.city_name).toBe('Austin');
			expect(storedSignal.state_code).toBe('TX');
			expect(storedSignal.confidence).toBe(0.8);
		});

		it('should parse two-letter state code "TX"', async () => {
			mockStorage.getSignals.mockResolvedValue([]);

			await addOAuthLocationSignal('facebook', 'TX');

			const storedSignal = mockStorage.storeSignal.mock.calls[0]?.[0] as LocationSignal;
			expect(storedSignal.state_code).toBe('TX');
			expect(storedSignal.city_name).toBeNull();
		});

		it('should parse full state name "California"', async () => {
			mockStorage.getSignals.mockResolvedValue([]);

			await addOAuthLocationSignal('linkedin', 'California');

			const storedSignal = mockStorage.storeSignal.mock.calls[0]?.[0] as LocationSignal;
			expect(storedSignal.state_code).toBe('CA');
		});

		it('should not store signal for unparseable location', async () => {
			await addOAuthLocationSignal('twitter', '');

			// Should not reach storeSignal if location is empty
			expect(mockStorage.storeSignal).not.toHaveBeenCalled();
		});

		it('should set default country code to US', async () => {
			mockStorage.getSignals.mockResolvedValue([]);

			await addOAuthLocationSignal('discord', 'NY');

			const storedSignal = mockStorage.storeSignal.mock.calls[0]?.[0] as LocationSignal;
			expect(storedSignal.country_code).toBe('US');
		});

		it('should accept custom country code', async () => {
			mockStorage.getSignals.mockResolvedValue([]);

			await addOAuthLocationSignal('google', 'Ontario, ON', 'CA');

			const storedSignal = mockStorage.storeSignal.mock.calls[0]?.[0] as LocationSignal;
			expect(storedSignal.country_code).toBe('CA');
		});
	});

	// =========================================================================
	// addVerifiedLocationSignal (public API)
	// =========================================================================

	describe('addVerifiedLocationSignal', () => {
		it('should create a verified signal with confidence 1.0', async () => {
			mockStorage.getSignals.mockResolvedValue([]);

			await addVerifiedLocationSignal('TX-18', 'TX');

			const storedSignal = mockStorage.storeSignal.mock.calls[0]?.[0] as LocationSignal;
			expect(storedSignal.signal_type).toBe('verified');
			expect(storedSignal.confidence).toBe(1.0);
			expect(storedSignal.congressional_district).toBe('TX-18');
			expect(storedSignal.state_code).toBe('TX');
		});

		it('should set source to verification.identity', async () => {
			mockStorage.getSignals.mockResolvedValue([]);

			await addVerifiedLocationSignal('CA-12', 'CA');

			const storedSignal = mockStorage.storeSignal.mock.calls[0]?.[0] as LocationSignal;
			expect(storedSignal.source).toBe('verification.identity');
		});
	});

	// =========================================================================
	// clearLocationData
	// =========================================================================

	describe('clearLocationData', () => {
		it('should call storage clearAll', async () => {
			await clearLocationData();
			expect(mockStorage.clearAll).toHaveBeenCalledOnce();
		});
	});

	// =========================================================================
	// pruneStaleSignals & export
	// =========================================================================

	describe('pruneStaleSignals', () => {
		it('should delegate to storage clearExpiredSignals', async () => {
			const engine = new LocationInferenceEngine();
			mockStorage.clearExpiredSignals.mockResolvedValue(3);

			const result = await engine.pruneStaleSignals();

			expect(result).toBe(3);
			expect(mockStorage.clearExpiredSignals).toHaveBeenCalled();
		});
	});

	describe('export', () => {
		it('should return current inferred location and signals', async () => {
			const engine = new LocationInferenceEngine();
			const inferredLocation: InferredLocation = {
				country_code: 'US',
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 0.6,
				signals: [],
				inferred_at: new Date().toISOString()
			};
			const signals = [makeBrowserSignal()];

			mockStorage.getInferredLocation.mockResolvedValue(inferredLocation);
			mockStorage.getSignals.mockResolvedValue(signals);

			const result = await engine.export();

			expect(result.inferred).toBe(inferredLocation);
			expect(result.signals).toBe(signals);
		});
	});

	// =========================================================================
	// SIGNAL_EXPIRATION constants
	// =========================================================================

	describe('SIGNAL_EXPIRATION', () => {
		it('IP signal expires in 24 hours', () => {
			expect(SIGNAL_EXPIRATION.ip).toBe(24 * 60 * 60 * 1000);
		});

		it('browser signal expires in 7 days', () => {
			expect(SIGNAL_EXPIRATION.browser).toBe(7 * 24 * 60 * 60 * 1000);
		});

		it('OAuth signal expires in 90 days', () => {
			expect(SIGNAL_EXPIRATION.oauth).toBe(90 * 24 * 60 * 60 * 1000);
		});

		it('behavioral signal expires in 30 days', () => {
			expect(SIGNAL_EXPIRATION.behavioral).toBe(30 * 24 * 60 * 60 * 1000);
		});

		it('verified signal expires in 365 days', () => {
			expect(SIGNAL_EXPIRATION.verified).toBe(365 * 24 * 60 * 60 * 1000);
		});
	});

	// =========================================================================
	// Edge cases
	// =========================================================================

	describe('Edge cases', () => {
		it('should handle signals with all null location fields', async () => {
			const engine = new LocationInferenceEngine();
			const signal = makeSignal({
				country_code: null,
				state_code: null,
				city_name: null,
				congressional_district: null,
				county_fips: null,
				latitude: null,
				longitude: null
			});
			mockStorage.getSignals.mockResolvedValue([signal]);

			const result = await engine.inferLocation();

			expect(result.country_code).toBeNull();
			expect(result.state_code).toBeNull();
			expect(result.congressional_district).toBeNull();
		});

		it('should cleanly handle single signal inference', async () => {
			const engine = new LocationInferenceEngine();
			const signal = makeVerifiedSignal();
			mockStorage.getSignals.mockResolvedValue([signal]);

			const result = await engine.inferLocation();

			expect(result.congressional_district).toBe('TX-18');
			expect(result.confidence).toBeCloseTo(1.0, 5);
		});

		it('lifts the region name from the IP signal metadata into state_name', async () => {
			const engine = new LocationInferenceEngine();
			// Forest City, Johor: Cloudflare returns regionCode "01" (ISO 3166-2:MY)
			// alongside the region name "Johor" (stashed in metadata.state_name).
			const ipSignal = makeSignal({
				country_code: 'MY',
				state_code: '01',
				source: 'ip.geolocation',
				metadata: { state_name: 'Johor' }
			});
			mockStorage.getSignals.mockResolvedValue([ipSignal]);

			const result = await engine.inferLocation();

			expect(result.country_code).toBe('MY');
			expect(result.state_code).toBe('01');
			// Without lifting the name, the display layer is left with only "01".
			expect(result.state_name).toBe('Johor');
		});

		it('should generate initial signals when storage is empty', async () => {
			const engine = new LocationInferenceEngine();
			// First call: empty, second call: with timezone signal
			const tzSignal = makeSignal({
				signal_type: 'ip',
				confidence: 0.2,
				state_code: 'NY',
				source: 'browser.timezone'
			});
			mockStorage.getSignals
				.mockResolvedValueOnce([]) // first check: empty
				.mockResolvedValueOnce([tzSignal]); // after generation

			mockGetTimezoneLocation.mockReturnValue(tzSignal);

			// Mock fetch for IP lookup (returns 500)
			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: false,
				status: 500
			} as Response);

			const result = await engine.inferLocation();

			expect(mockGetTimezoneLocation).toHaveBeenCalled();
			expect(mockStorage.storeSignal).toHaveBeenCalledWith(tzSignal);
		});
	});
});
