/**
 * Unit tests for the location resolver display layer.
 *
 * Regression coverage for the "MY > 01" breadcrumb: a non-US/CA/AU subdivision
 * (ISO 3166-2:MY "01" = Johor) must render as its human-readable name, and the
 * country code "MY" must resolve to "Malaysia" rather than falling back to the
 * bare code. The fix carries the subdivision name through the pipeline and uses
 * Intl.DisplayNames for country names instead of a hand-maintained table.
 */

import { describe, it, expect } from 'vitest';
import {
	countryCodeToName,
	resolveToGeoScope,
	displayGeoScope
} from '$lib/core/location/location-resolver';
import { inferredLocationToGeoScope } from '$lib/core/location/template-filter';
import type { LocationHierarchy } from '$lib/core/location/location-search';
import type { InferredLocation } from '$lib/core/location/types';
import type { GeoScope } from '$lib/core/agents/types';

describe('countryCodeToName', () => {
	it('resolves ISO 3166-1 codes beyond the legacy table via Intl', () => {
		expect(countryCodeToName('MY')).toBe('Malaysia');
		expect(countryCodeToName('US')).toBe('United States');
		expect(countryCodeToName('JP')).toBe('Japan');
	});

	it('is case-insensitive', () => {
		expect(countryCodeToName('gb')).toBe('United Kingdom');
	});

	it('returns null for non-country input', () => {
		expect(countryCodeToName('XX')).toBeNull(); // unassigned alpha-2 code
		expect(countryCodeToName('01')).toBeNull(); // a subdivision code, not a country
		expect(countryCodeToName('USA')).toBeNull(); // alpha-3, not alpha-2
		expect(countryCodeToName('')).toBeNull();
	});
});

describe('resolveToGeoScope subdivision name', () => {
	it('carries the human-readable subdivision name from a search result', () => {
		const hierarchy: LocationHierarchy = {
			country: { code: 'MY', name: 'Malaysia' },
			state: { code: '01', name: 'Johor', country_code: 'MY' },
			city: {
				name: 'Iskandar Puteri',
				state_code: '01',
				country_code: 'MY',
				lat: 1.4,
				lon: 103.6
			},
			display_name: 'Iskandar Puteri, Johor, Malaysia'
		};

		const scope = resolveToGeoScope(hierarchy);

		expect(scope.type).toBe('subnational');
		if (scope.type === 'subnational') {
			expect(scope.subdivision).toBe('MY-01');
			expect(scope.subdivisionName).toBe('Johor');
			expect(scope.locality).toBe('Iskandar Puteri');
		}
	});
});

describe('displayGeoScope', () => {
	it('prefers subdivisionName over the bare code', () => {
		const scope: GeoScope = {
			type: 'subnational',
			country: 'MY',
			subdivision: 'MY-01',
			subdivisionName: 'Johor'
		};
		expect(displayGeoScope(scope)).toBe('Johor, Malaysia');
	});

	it('falls back to the bare subdivision code when no name is preserved', () => {
		const scope: GeoScope = {
			type: 'subnational',
			country: 'MY',
			subdivision: 'MY-01'
		};
		// Country still resolves via Intl; the unknown subdivision stays a code.
		expect(displayGeoScope(scope)).toBe('01, Malaysia');
	});

	it('still reverses US subdivision codes via the static table', () => {
		const scope: GeoScope = {
			type: 'subnational',
			country: 'US',
			subdivision: 'US-CA'
		};
		expect(displayGeoScope(scope)).toBe('California, United States');
	});

	it('names US territory subdivisions (fold-to-US keeps the territory label)', () => {
		// A territory inferred from IP/timezone folds to country 'US' with the
		// territory as the subdivision, so it reads as the territory, not a code.
		const scope: GeoScope = {
			type: 'subnational',
			country: 'US',
			subdivision: 'US-PR'
		};
		expect(displayGeoScope(scope)).toBe('Puerto Rico, United States');
	});
});

describe('inferredLocationToGeoScope — Forest City regression', () => {
	it('produces a named subdivision so the breadcrumb shows Johor, not 01', () => {
		const inferred: InferredLocation = {
			country_code: 'MY',
			congressional_district: null,
			state_code: '01',
			state_name: 'Johor',
			confidence: 0.3,
			signals: [],
			inferred_at: new Date().toISOString()
		};

		const scope = inferredLocationToGeoScope(inferred);

		expect(scope).not.toBeNull();
		expect(scope?.type).toBe('subnational');
		if (scope && scope.type === 'subnational') {
			expect(scope.subdivision).toBe('MY-01');
			expect(scope.subdivisionName).toBe('Johor');
			expect(displayGeoScope(scope)).toBe('Johor, Malaysia');
		}
	});

	it('omits subdivisionName when the inference has no region name', () => {
		const inferred: InferredLocation = {
			country_code: 'MY',
			congressional_district: null,
			state_code: '01',
			confidence: 0.3,
			signals: [],
			inferred_at: new Date().toISOString()
		};

		const scope = inferredLocationToGeoScope(inferred);

		if (scope && scope.type === 'subnational') {
			expect(scope.subdivisionName).toBeUndefined();
		}
	});
});
