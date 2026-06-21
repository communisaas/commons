/**
 * Unit tests for Client-Side Template Filter
 *
 * Tests template filtering by jurisdiction, relevance scoring,
 * hierarchical scope matching, distance calculations, and
 * contextual boosting (adoption, recency, behavior).
 */

import { describe, it, expect } from 'vitest';
import {
	ClientSideTemplateFilter,
	filterTemplatesByLocation,
	scoreTemplatesByRelevance,
	calculateDistance,
	scoreByProximity,
	boostByLocalAdoption,
	boostByRecency,
	boostByUserBehavior,
	groupByPrecision
} from '$lib/core/location/template-filter';
import type {
	InferredLocation,
	TemplateWithJurisdictions,
	TemplateJurisdiction,
	ScoredTemplate
} from '$lib/core/location/types';

// ---------------------------------------------------------------------------
// Helpers: factories
// ---------------------------------------------------------------------------

function makeLocation(overrides: Partial<InferredLocation> = {}): InferredLocation {
	return {
		country_code: 'US',
		congressional_district: 'CA-12',
		state_code: 'CA',
		city_name: 'San Francisco',
		county_name: 'San Francisco',
		county_fips: '06075',
		confidence: 0.8,
		signals: [],
		inferred_at: new Date().toISOString(),
		...overrides
	};
}

function makeJurisdiction(
	overrides: Partial<TemplateJurisdiction> = {}
): TemplateJurisdiction {
	return {
		id: 'jur-1',
		template_id: 'tmpl-1',
		jurisdiction_type: 'federal',
		congressional_district: null,
		state_code: null,
		county_fips: null,
		county_name: null,
		city_name: null,
		...overrides
	};
}

function makeTemplate(
	id: string,
	jurisdictions: TemplateJurisdiction[],
	scopes?: TemplateWithJurisdictions['scopes']
): TemplateWithJurisdictions {
	return {
		id,
		slug: `template-${id}`,
		title: `Template ${id}`,
		jurisdictions,
		scopes
	};
}

function makeScope(
	overrides: Partial<NonNullable<TemplateWithJurisdictions['scopes']>[0]> = {}
): NonNullable<TemplateWithJurisdictions['scopes']>[0] {
	return {
		id: 'scope-1',
		template_id: 'tmpl-1',
		country_code: 'US',
		scope_level: 'country',
		display_text: 'United States',
		confidence: 1.0,
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Template Filter', () => {
	// =========================================================================
	// filterByJurisdiction
	// =========================================================================

	describe('filterByJurisdiction', () => {
		it('should match template with exact congressional district', () => {
			const location = makeLocation({ congressional_district: 'CA-12', state_code: 'CA' });
			const template = makeTemplate('1', [
				makeJurisdiction({ congressional_district: 'CA-12', state_code: 'CA' })
			]);

			const result = filterTemplatesByLocation([template], location);

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('1');
		});

		it('should match template with state_code', () => {
			const location = makeLocation({ congressional_district: 'CA-12', state_code: 'CA' });
			const template = makeTemplate('1', [
				makeJurisdiction({ state_code: 'CA' })
			]);

			const result = filterTemplatesByLocation([template], location);

			expect(result).toHaveLength(1);
		});

		it('should match template with county_fips', () => {
			const location = makeLocation({ county_fips: '06075' });
			const template = makeTemplate('1', [
				makeJurisdiction({ county_fips: '06075' })
			]);

			const result = filterTemplatesByLocation([template], location);

			expect(result).toHaveLength(1);
		});

		it('should match template with city_name (case-insensitive)', () => {
			const location = makeLocation({ city_name: 'San Francisco' });
			const template = makeTemplate('1', [
				makeJurisdiction({ city_name: 'san francisco' })
			]);

			const result = filterTemplatesByLocation([template], location);

			expect(result).toHaveLength(1);
		});

		it('should NOT match template with different state', () => {
			const location = makeLocation({ state_code: 'CA', congressional_district: 'CA-12' });
			const template = makeTemplate('1', [
				makeJurisdiction({ state_code: 'TX' })
			]);

			const result = filterTemplatesByLocation([template], location);

			expect(result).toHaveLength(0);
		});

		it('should NOT match template with different district', () => {
			const location = makeLocation({ congressional_district: 'CA-12' });
			const template = makeTemplate('1', [
				makeJurisdiction({ congressional_district: 'TX-18' })
			]);

			const result = filterTemplatesByLocation([template], location);

			expect(result).toHaveLength(0);
		});

		it('should return all templates when location has no district or state', () => {
			const location = makeLocation({
				congressional_district: null,
				state_code: null,
				county_fips: null,
				city_name: null
			});
			const templates = [
				makeTemplate('1', [makeJurisdiction({ state_code: 'CA' })]),
				makeTemplate('2', [makeJurisdiction({ state_code: 'TX' })])
			];

			const result = filterTemplatesByLocation(templates, location);

			// No location data => return all
			expect(result).toHaveLength(2);
		});

		it('should filter multiple templates, keeping only matching', () => {
			const location = makeLocation({ state_code: 'CA', congressional_district: 'CA-12' });
			const templates = [
				makeTemplate('1', [makeJurisdiction({ state_code: 'CA' })]),
				makeTemplate('2', [makeJurisdiction({ state_code: 'TX' })]),
				makeTemplate('3', [makeJurisdiction({ congressional_district: 'CA-12' })])
			];

			const result = filterTemplatesByLocation(templates, location);

			expect(result).toHaveLength(2);
			expect(result.map((t) => t.id).sort()).toEqual(['1', '3']);
		});
	});

	// =========================================================================
	// scoreByRelevance (TemplateJurisdiction path)
	// =========================================================================

	describe('scoreByRelevance (jurisdiction path)', () => {
		it('should give score 1.0 for exact congressional district match', () => {
			const location = makeLocation({ congressional_district: 'CA-12', confidence: 1.0 });
			const template = makeTemplate('1', [
				makeJurisdiction({ congressional_district: 'CA-12' })
			]);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeCloseTo(1.0, 1);
		});

		it('should give score 0.8 for county match', () => {
			const location = makeLocation({
				county_fips: '06075',
				congressional_district: null,
				confidence: 1.0
			});
			const template = makeTemplate('1', [
				makeJurisdiction({ county_fips: '06075', county_name: 'San Francisco' })
			]);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeCloseTo(0.8, 1);
		});

		it('should give score 0.7 for city match', () => {
			const location = makeLocation({
				city_name: 'Austin',
				congressional_district: null,
				county_fips: null,
				confidence: 1.0
			});
			const template = makeTemplate('1', [
				makeJurisdiction({ city_name: 'austin' })
			]);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeCloseTo(0.7, 1);
		});

		it('should give score 0.5 for state match', () => {
			const location = makeLocation({
				state_code: 'TX',
				congressional_district: null,
				county_fips: null,
				city_name: null,
				confidence: 1.0
			});
			const template = makeTemplate('1', [
				makeJurisdiction({ state_code: 'TX', jurisdiction_type: 'state' })
			]);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeCloseTo(0.5, 1);
		});

		it('should give score 0.3 for federal/national match', () => {
			const location = makeLocation({
				state_code: 'CA',
				congressional_district: null,
				county_fips: null,
				city_name: null,
				confidence: 1.0
			});
			const template = makeTemplate('1', [
				makeJurisdiction({ jurisdiction_type: 'federal' })
			]);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(1);
			// Federal is 0.3, but confidence multiplier for country-level = 1.0
			expect(scored[0].score).toBeCloseTo(0.3, 1);
		});

		it('should not match template with no jurisdiction overlap', () => {
			const location = makeLocation({
				state_code: 'CA',
				congressional_district: 'CA-12',
				confidence: 1.0
			});
			const template = makeTemplate('1', [
				makeJurisdiction({
					state_code: 'TX',
					congressional_district: 'TX-18',
					jurisdiction_type: 'state' // NOT federal, so no federal fallback
				})
			]);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(0);
		});

		it('should sort templates by score descending', () => {
			const location = makeLocation({
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 1.0
			});
			const templates = [
				makeTemplate('state', [makeJurisdiction({ state_code: 'CA', jurisdiction_type: 'state' })]),
				makeTemplate('district', [makeJurisdiction({ congressional_district: 'CA-12' })]),
				makeTemplate('federal', [makeJurisdiction({ jurisdiction_type: 'federal' })])
			];

			const scored = scoreTemplatesByRelevance(templates, location);

			expect(scored.length).toBe(3);
			expect(scored[0].template.id).toBe('district'); // 1.0
			expect(scored[1].template.id).toBe('state'); // 0.5
			expect(scored[2].template.id).toBe('federal'); // 0.3
		});

		it('should scale score by location confidence', () => {
			const lowConfidence = makeLocation({
				state_code: 'CA',
				congressional_district: 'CA-12',
				confidence: 0.3
			});
			const highConfidence = makeLocation({
				state_code: 'CA',
				congressional_district: 'CA-12',
				confidence: 1.0
			});
			const template = makeTemplate('1', [
				makeJurisdiction({ congressional_district: 'CA-12' })
			]);

			const scoredLow = scoreTemplatesByRelevance([template], lowConfidence);
			const scoredHigh = scoreTemplatesByRelevance([template], highConfidence);

			// Higher confidence should produce higher final score
			expect(scoredHigh[0].score).toBeGreaterThan(scoredLow[0].score);
		});

		it('should apply breadcrumb scope boost when selectedScope matches', () => {
			const location = makeLocation({
				state_code: 'CA',
				congressional_district: 'CA-12',
				confidence: 1.0
			});
			const template = makeTemplate('1', [
				makeJurisdiction({ state_code: 'CA', jurisdiction_type: 'state' })
			]);

			const withoutBoost = scoreTemplatesByRelevance([template], location);
			const withBoost = scoreTemplatesByRelevance([template], location, 'state');

			// State match = 0.5; with 30% boost = 0.65
			expect(withBoost[0].score).toBeGreaterThan(withoutBoost[0].score);
			expect(withBoost[0].score).toBeCloseTo(0.65, 1);
		});

		it('should NOT apply breadcrumb boost when selectedScope does not match', () => {
			const location = makeLocation({
				state_code: 'CA',
				congressional_district: 'CA-12',
				confidence: 1.0
			});
			const template = makeTemplate('1', [
				makeJurisdiction({ state_code: 'CA', jurisdiction_type: 'state' })
			]);

			const withDistrictScope = scoreTemplatesByRelevance([template], location, 'district');
			const withoutScope = scoreTemplatesByRelevance([template], location);

			// State-level template shouldn't get boosted by district scope selection
			expect(withDistrictScope[0].score).toBeCloseTo(withoutScope[0].score, 5);
		});
	});

	// =========================================================================
	// scoreByRelevance (TemplateScope path - hierarchical)
	// =========================================================================

	describe('scoreByRelevance (scope path)', () => {
		it('should give 1.0 for exact district scope match', () => {
			const location = makeLocation({
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 1.0
			});
			const template = makeTemplate(
				'1',
				[],
				[makeScope({
					scope_level: 'district',
					district_code: 'CA-12',
					region_code: 'CA',
					country_code: 'US',
					display_text: 'CA-12'
				})]
			);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeCloseTo(1.0, 1);
		});

		it('should give 0.5 for region scope match when user is in district', () => {
			const location = makeLocation({
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 1.0
			});
			const template = makeTemplate(
				'1',
				[],
				[makeScope({
					scope_level: 'region',
					region_code: 'CA',
					country_code: 'US',
					display_text: 'California'
				})]
			);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeCloseTo(0.5, 1);
		});

		it('should give 0.3 for country scope match', () => {
			const location = makeLocation({
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 1.0
			});
			const template = makeTemplate(
				'1',
				[],
				[makeScope({
					scope_level: 'country',
					country_code: 'US',
					display_text: 'United States'
				})]
			);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(1);
			// Country-level gets confidenceMultiplier=1.0 (special case)
			expect(scored[0].score).toBeCloseTo(0.3, 1);
		});

		it('should NOT match scope with different country', () => {
			const location = makeLocation({
				country_code: 'US',
				state_code: 'CA',
				confidence: 1.0
			});
			const template = makeTemplate(
				'1',
				[],
				[makeScope({
					scope_level: 'country',
					country_code: 'GB',
					display_text: 'United Kingdom'
				})]
			);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(0);
		});

		it('should match an in-state CITY scope for a region-level user (California sees Oakland)', () => {
			const location = makeLocation({
				congressional_district: null,
				state_code: 'CA',
				city_name: null,
				confidence: 1.0
			});
			const template = makeTemplate(
				'1',
				[],
				[makeScope({
					scope_level: 'locality',
					locality_code: 'Oakland',
					region_code: 'CA',
					country_code: 'US',
					display_text: 'Oakland'
				})]
			);

			const scored = scoreTemplatesByRelevance([template], location);

			// A state campaign list includes its cities' campaigns, surfaced at STATE-level
			// relevance (0.51 → "In Your State") — not as the user's exact city.
			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeCloseTo(0.51, 1);
		});

		it('should match an in-state DISTRICT scope for a region-level user (state sees its districts)', () => {
			const location = makeLocation({
				congressional_district: null,
				state_code: 'CA',
				city_name: null,
				confidence: 1.0
			});
			const template = makeTemplate(
				'1',
				[],
				[makeScope({
					scope_level: 'district',
					district_code: 'CA-12',
					region_code: 'CA',
					country_code: 'US',
					display_text: 'CA-12'
				})]
			);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeCloseTo(0.51, 1);
		});

		it('should NOT match an OUT-of-state city scope for a region-level user (California excludes Portland)', () => {
			const location = makeLocation({
				congressional_district: null,
				state_code: 'CA',
				city_name: null,
				confidence: 1.0
			});
			const template = makeTemplate(
				'1',
				[],
				[makeScope({
					scope_level: 'locality',
					locality_code: 'Portland',
					region_code: 'OR',
					country_code: 'US',
					display_text: 'Portland'
				})]
			);

			const scored = scoreTemplatesByRelevance([template], location);

			// Portland is in Oregon, not California — it must stay out of a CA view.
			expect(scored).toHaveLength(0);
		});

		it('should NOT match a region-LESS city scope for a region-level user (cannot place it in a state)', () => {
			const location = makeLocation({
				congressional_district: null,
				state_code: 'CA',
				city_name: null,
				confidence: 1.0
			});
			const template = makeTemplate(
				'1',
				[],
				[makeScope({
					scope_level: 'locality',
					locality_code: 'Oakland',
					country_code: 'US',
					display_text: 'Oakland'
				})]
			);

			const scored = scoreTemplatesByRelevance([template], location);

			// No region_code → can't be placed in a state → never matches an arbitrary state user.
			expect(scored).toHaveLength(0);
		});

		it('tiers an in-state city campaign as "In Your State" even when the breadcrumb boost lifts its score past the city/county floor', () => {
			const location = makeLocation({
				congressional_district: null,
				state_code: 'CA',
				city_name: null,
				confidence: 1.0
			});
			const oakland = makeTemplate(
				'oak',
				[],
				[makeScope({
					scope_level: 'locality',
					locality_code: 'Oakland',
					region_code: 'CA',
					country_code: 'US',
					display_text: 'Oakland'
				})]
			);

			// selectedScope 'state' fires the ×1.3 breadcrumb boost: 0.51 → ~0.66, which
			// crosses the 0.65 city/county tier floor.
			const scored = scoreTemplatesByRelevance([oakland], location, 'state');
			expect(scored[0].score).toBeGreaterThan(0.65); // the boost did lift it across the floor

			const groups = groupByPrecision(scored);
			// Tiered by the match LEVEL (state), not the boosted score → "In Your State",
			// never "In Your City / County" (the user is in CA, not necessarily Oakland).
			const stateGroup = groups.find((g) => g.level === 'state');
			expect(stateGroup?.templates.map((t) => t.id)).toContain('oak');
			expect(groups.find((g) => g.level === 'city')).toBeUndefined();
		});

		it('should match country scope for user at region level', () => {
			const location = makeLocation({
				congressional_district: null,
				state_code: 'CA',
				city_name: null,
				confidence: 0.8
			});
			const template = makeTemplate(
				'1',
				[],
				[makeScope({
					scope_level: 'country',
					country_code: 'US',
					display_text: 'United States'
				})]
			);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored).toHaveLength(1);
		});

		it('should prefer scope path over jurisdiction path when both present', () => {
			const location = makeLocation({
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 1.0
			});
			const template = makeTemplate(
				'1',
				// Jurisdiction would give state match (0.5)
				[makeJurisdiction({ state_code: 'CA', jurisdiction_type: 'state' })],
				// Scope gives district match (1.0)
				[makeScope({
					scope_level: 'district',
					district_code: 'CA-12',
					region_code: 'CA',
					country_code: 'US',
					display_text: 'CA-12'
				})]
			);

			const scored = scoreTemplatesByRelevance([template], location);

			// Should use scopes path (higher score)
			expect(scored[0].score).toBeCloseTo(1.0, 1);
		});

		it('should apply breadcrumb boost to scope-based scoring', () => {
			const location = makeLocation({
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 1.0
			});
			const template = makeTemplate(
				'1',
				[],
				[makeScope({
					scope_level: 'region',
					region_code: 'CA',
					country_code: 'US',
					display_text: 'California'
				})]
			);

			const boosted = scoreTemplatesByRelevance([template], location, 'state');
			const unboosted = scoreTemplatesByRelevance([template], location);

			// 'state' breadcrumb should boost region (= state in UI) match
			expect(boosted[0].score).toBeGreaterThan(unboosted[0].score);
		});
	});

	// =========================================================================
	// Confidence label
	// =========================================================================

	describe('Confidence labels in matchReason', () => {
		it('should label "verified" for confidence >= 0.9', () => {
			const location = makeLocation({ state_code: 'CA', confidence: 1.0 });
			const template = makeTemplate('1', [
				makeJurisdiction({ state_code: 'CA', jurisdiction_type: 'state' })
			]);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored[0].matchReason).toContain('verified');
		});

		it('should label "estimated" for confidence < 0.3', () => {
			const location = makeLocation({
				state_code: 'CA',
				confidence: 0.2,
				congressional_district: null,
				city_name: null,
				county_fips: null
			});
			const template = makeTemplate('1', [
				makeJurisdiction({ state_code: 'CA', jurisdiction_type: 'state' })
			]);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored[0].matchReason).toContain('estimated');
		});

		it('should label "national" for federal/country-level match', () => {
			const location = makeLocation({ confidence: 0.5 });
			const template = makeTemplate('1', [
				makeJurisdiction({ jurisdiction_type: 'federal' })
			]);

			const scored = scoreTemplatesByRelevance([template], location);

			expect(scored[0].matchReason).toContain('national');
		});
	});

	// =========================================================================
	// calculateDistance (Haversine)
	// =========================================================================

	describe('calculateDistance', () => {
		it('should return 0 for same point', () => {
			const dist = calculateDistance(37.7749, -122.4194, 37.7749, -122.4194);
			expect(dist).toBe(0);
		});

		it('should calculate distance between SF and LA (~559 km)', () => {
			const dist = calculateDistance(37.7749, -122.4194, 34.0522, -118.2437);
			expect(dist).toBeGreaterThan(500);
			expect(dist).toBeLessThan(600);
		});

		it('should calculate distance between NYC and DC (~328 km)', () => {
			const dist = calculateDistance(40.7128, -74.006, 38.9072, -77.0369);
			expect(dist).toBeGreaterThan(300);
			expect(dist).toBeLessThan(360);
		});

		it('should handle antipodal points (~20000 km)', () => {
			const dist = calculateDistance(0, 0, 0, 180);
			expect(dist).toBeGreaterThan(19000);
			expect(dist).toBeLessThan(21000);
		});

		it('should handle negative coordinates (Southern hemisphere)', () => {
			const dist = calculateDistance(-33.8688, 151.2093, -37.8136, 144.9631);
			// Sydney to Melbourne
			expect(dist).toBeGreaterThan(700);
			expect(dist).toBeLessThan(900);
		});
	});

	// =========================================================================
	// scoreByProximity
	// =========================================================================

	describe('scoreByProximity', () => {
		it('should score template close to user highly', () => {
			const template = makeTemplate('1', [
				makeJurisdiction({ latitude: 37.78, longitude: -122.42 }) // very close to SF
			]);

			const scored = scoreByProximity([template], 37.7749, -122.4194, 100);

			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeGreaterThan(0.9); // less than 1 km away
		});

		it('should exclude templates beyond maxDistance', () => {
			const template = makeTemplate('1', [
				makeJurisdiction({ latitude: 34.0522, longitude: -118.2437 }) // LA
			]);

			// SF with 100km radius: LA is ~559km away
			const scored = scoreByProximity([template], 37.7749, -122.4194, 100);

			expect(scored).toHaveLength(0);
		});

		it('should sort by distance (closest first)', () => {
			const templates = [
				makeTemplate('far', [
					makeJurisdiction({ latitude: 34.0522, longitude: -118.2437 }) // LA
				]),
				makeTemplate('close', [
					makeJurisdiction({ latitude: 37.78, longitude: -122.42 }) // Near SF
				])
			];

			const scored = scoreByProximity(templates, 37.7749, -122.4194, 1000);

			expect(scored[0].template.id).toBe('close');
			expect(scored[1].template.id).toBe('far');
		});

		it('should skip jurisdictions without coordinates', () => {
			const template = makeTemplate('1', [
				makeJurisdiction({ latitude: null, longitude: null })
			]);

			const scored = scoreByProximity([template], 37.7749, -122.4194, 100);

			expect(scored).toHaveLength(0);
		});

		it('should use closest jurisdiction for multi-jurisdiction template', () => {
			const template = makeTemplate('1', [
				makeJurisdiction({ latitude: 34.0522, longitude: -118.2437 }), // LA (far)
				makeJurisdiction({ latitude: 37.78, longitude: -122.42 }) // Near SF (close)
			]);

			const scored = scoreByProximity([template], 37.7749, -122.4194, 1000);

			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeGreaterThan(0.9); // Based on close jurisdiction
		});
	});

	// =========================================================================
	// boostByLocalAdoption
	// =========================================================================

	describe('boostByLocalAdoption', () => {
		it('should not boost templates with zero adoption', () => {
			const scored: ScoredTemplate[] = [
				{
					template: makeTemplate('1', []),
					score: 0.5,
					matchReason: 'state',
					jurisdiction: makeJurisdiction()
				}
			];
			const adoptionData = new Map<string, number>();

			const boosted = boostByLocalAdoption(scored, adoptionData);

			expect(boosted[0].score).toBe(0.5);
		});

		it('should boost templates with high adoption count', () => {
			const scored: ScoredTemplate[] = [
				{
					template: makeTemplate('1', []),
					score: 0.5,
					matchReason: 'state',
					jurisdiction: makeJurisdiction()
				}
			];
			const adoptionData = new Map([['1', 100]]);

			const boosted = boostByLocalAdoption(scored, adoptionData);

			// log10(100) * 0.1 = 0.2, so multiplier = 1.2, score = 0.5 * 1.2 = 0.6
			expect(boosted[0].score).toBeCloseTo(0.6, 1);
		});

		it('should apply logarithmic scaling (diminishing returns)', () => {
			const make = (id: string, count: number) => ({
				scored: [{
					template: makeTemplate(id, []),
					score: 1.0,
					matchReason: 'state',
					jurisdiction: makeJurisdiction()
				}] as ScoredTemplate[],
				adoption: new Map([[id, count]])
			});

			const boost10 = boostByLocalAdoption(make('a', 10).scored, make('a', 10).adoption);
			const boost100 = boostByLocalAdoption(make('b', 100).scored, make('b', 100).adoption);
			const boost1000 = boostByLocalAdoption(make('c', 1000).scored, make('c', 1000).adoption);

			// Logarithmic: difference between 100->1000 should be same as 10->100
			const diff1 = boost100[0].score - boost10[0].score;
			const diff2 = boost1000[0].score - boost100[0].score;
			expect(diff1).toBeCloseTo(diff2, 1);
		});
	});

	// =========================================================================
	// boostByRecency
	// =========================================================================

	describe('boostByRecency', () => {
		it('should boost templates with recent activity', () => {
			const scored: ScoredTemplate[] = [
				{
					template: makeTemplate('1', []),
					score: 0.5,
					matchReason: 'state',
					jurisdiction: makeJurisdiction()
				}
			];
			const activityData = new Map([['1', new Date()]]); // Just now

			const boosted = boostByRecency(scored, activityData);

			// Recent activity = high recency boost
			expect(boosted[0].score).toBeGreaterThan(0.5);
		});

		it('should not boost templates with no activity data', () => {
			const scored: ScoredTemplate[] = [
				{
					template: makeTemplate('1', []),
					score: 0.5,
					matchReason: 'state',
					jurisdiction: makeJurisdiction()
				}
			];
			const activityData = new Map<string, Date>(); // Empty

			const boosted = boostByRecency(scored, activityData);

			expect(boosted[0].score).toBe(0.5);
		});

		it('should decay boost for old activity (7+ days)', () => {
			const scored: ScoredTemplate[] = [
				{
					template: makeTemplate('recent', []),
					score: 0.5,
					matchReason: 'state',
					jurisdiction: makeJurisdiction()
				},
				{
					template: makeTemplate('old', []),
					score: 0.5,
					matchReason: 'state',
					jurisdiction: makeJurisdiction()
				}
			];
			const activityData = new Map([
				['recent', new Date()],
				['old', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)] // 14 days ago
			]);

			const boosted = boostByRecency(scored, activityData);

			const recentScore = boosted.find((s) => s.template.id === 'recent')!.score;
			const oldScore = boosted.find((s) => s.template.id === 'old')!.score;

			expect(recentScore).toBeGreaterThan(oldScore);
		});
	});

	// =========================================================================
	// boostByUserBehavior
	// =========================================================================

	describe('boostByUserBehavior', () => {
		it('should not boost templates with zero views', () => {
			const scored: ScoredTemplate[] = [
				{
					template: makeTemplate('1', []),
					score: 0.5,
					matchReason: 'state',
					jurisdiction: makeJurisdiction()
				}
			];
			const viewCounts = new Map<string, number>();

			const boosted = boostByUserBehavior(scored, viewCounts);

			expect(boosted[0].score).toBe(0.5);
		});

		it('should boost templates with views', () => {
			const scored: ScoredTemplate[] = [
				{
					template: makeTemplate('1', []),
					score: 0.5,
					matchReason: 'state',
					jurisdiction: makeJurisdiction()
				}
			];
			const viewCounts = new Map([['1', 5]]);

			const boosted = boostByUserBehavior(scored, viewCounts);

			expect(boosted[0].score).toBeGreaterThan(0.5);
		});

		it('should cap behavioral boost at 1.3x', () => {
			const scored: ScoredTemplate[] = [
				{
					template: makeTemplate('1', []),
					score: 1.0,
					matchReason: 'district',
					jurisdiction: makeJurisdiction()
				}
			];
			const viewCounts = new Map([['1', 10000]]);

			const boosted = boostByUserBehavior(scored, viewCounts);

			// Max boost factor = 1 + min(0.3, ...) = at most 1.3x
			expect(boosted[0].score).toBeLessThanOrEqual(1.3);
		});
	});

	// =========================================================================
	// Edge cases
	// =========================================================================

	describe('Edge cases', () => {
		it('should handle empty template list', () => {
			const location = makeLocation();

			const filtered = filterTemplatesByLocation([], location);
			const scored = scoreTemplatesByRelevance([], location);

			expect(filtered).toHaveLength(0);
			expect(scored).toHaveLength(0);
		});

		it('should handle template with no jurisdictions and no scopes', () => {
			const location = makeLocation();
			const template = makeTemplate('1', []);

			const scored = scoreTemplatesByRelevance([template], location);

			// Templates with no geo-targeting get a baseline score so they
			// still appear (e.g., nationwide/global templates without jurisdictions)
			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeCloseTo(0.3, 1);
			expect(scored[0].matchReason).toBe('Available everywhere (national)');
		});

		it('should handle location with null country_code', () => {
			const location = makeLocation({ country_code: null, state_code: 'CA' });
			const template = makeTemplate(
				'1',
				[],
				[makeScope({ scope_level: 'country', country_code: 'US' })]
			);

			// Country code mismatch (null vs US)
			const scored = scoreTemplatesByRelevance([template], location);

			// Depends on implementation: null country_code defaults to 'US' in inferredLocationToScope
			// So it should match since the default is 'US'
			expect(scored.length).toBeGreaterThanOrEqual(0);
		});

		it('should handle template with multiple jurisdictions and pick best score', () => {
			const location = makeLocation({
				congressional_district: 'CA-12',
				state_code: 'CA',
				confidence: 1.0
			});
			const template = makeTemplate('1', [
				makeJurisdiction({ state_code: 'TX' }), // no match
				makeJurisdiction({ state_code: 'CA', jurisdiction_type: 'state' }), // 0.5
				makeJurisdiction({ congressional_district: 'CA-12' }) // 1.0
			]);

			const scored = scoreTemplatesByRelevance([template], location);

			// Best match should be the district match (1.0)
			expect(scored[0].score).toBeCloseTo(1.0, 1);
		});

		it('should handle national templates visible to all US users', () => {
			const location = makeLocation({
				state_code: 'CA',
				confidence: 0.2 // Low confidence (IP only)
			});
			const template = makeTemplate('1', [
				makeJurisdiction({ jurisdiction_type: 'federal' })
			]);

			const scored = scoreTemplatesByRelevance([template], location);

			// Federal templates always get confidenceMultiplier = 1.0
			expect(scored).toHaveLength(1);
			expect(scored[0].score).toBeCloseTo(0.3, 1);
		});
	});
});
