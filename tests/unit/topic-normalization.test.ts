/**
 * Unit Tests — Topic Normalization + Location Filtering
 *
 * Tests normalizeTopics and deriveCategory from the shared utility module.
 * Verifies that location names leaked by the LLM into topics are stripped
 * when detected_location is available.
 */

import { describe, it, expect } from 'vitest';
import { normalizeTopics, deriveCategory } from '$lib/utils/topic-normalization';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeTopics', () => {

	describe('basic normalization (no location)', () => {
		it('lowercases and hyphenates topics', () => {
			expect(normalizeTopics(['Tuition Hikes', 'Public Health']))
				.toEqual(['tuition-hikes', 'public-health']);
		});

		it('strips non-alphanumeric characters', () => {
			expect(normalizeTopics(["worker's rights", 'budget (2025)']))
				.toEqual(['workers-rights', 'budget-2025']);
		});

		it('returns empty array for empty input', () => {
			expect(normalizeTopics([])).toEqual([]);
		});
	});

	describe('location filtering', () => {
		it('strips "san-francisco" when detected_location is "San Francisco, CA"', () => {
			const result = normalizeTopics(
				['san-francisco', 'transportation', 'towing'],
				'San Francisco, CA'
			);
			expect(result).toEqual(['transportation', 'towing']);
		});

		it('strips "portland" when detected_location is "Portland, OR"', () => {
			const result = normalizeTopics(
				['portland', 'education', 'budget'],
				'Portland, OR'
			);
			expect(result).toEqual(['education', 'budget']);
		});

		it('strips state name from topics', () => {
			const result = normalizeTopics(
				['california', 'housing', 'rent-control'],
				'Los Angeles, California'
			);
			expect(result).toEqual(['housing', 'rent-control']);
		});

		it('strips multi-word city names', () => {
			const result = normalizeTopics(
				['new-york', 'transit', 'mta'],
				'New York, NY'
			);
			expect(result).toEqual(['transit', 'mta']);
		});

		it('does not strip topics that partially overlap with location', () => {
			// "san" appears in "San Francisco" but "san-antonio" has "antonio" which doesn't
			const result = normalizeTopics(
				['san-antonio', 'transportation'],
				'San Francisco, CA'
			);
			expect(result).toEqual(['san-antonio', 'transportation']);
		});

		it('does not strip topics when no detected_location', () => {
			const result = normalizeTopics(
				['san-francisco', 'transportation'],
				null
			);
			expect(result).toEqual(['san-francisco', 'transportation']);
		});

		it('does not strip topics when detected_location is empty', () => {
			const result = normalizeTopics(
				['san-francisco', 'transportation'],
				''
			);
			expect(result).toEqual(['san-francisco', 'transportation']);
		});

		it('handles state abbreviation in location', () => {
			// "ca" is a token from "San Francisco, CA" — a topic "ca" alone should be stripped
			const result = normalizeTopics(
				['ca', 'housing'],
				'San Francisco, CA'
			);
			expect(result).toEqual(['housing']);
		});

		it('preserves all topics when none match location', () => {
			const result = normalizeTopics(
				['healthcare', 'drug-pricing', 'insulin'],
				'Washington, DC'
			);
			expect(result).toEqual(['healthcare', 'drug-pricing', 'insulin']);
		});
	});

	describe('category derivation (title-casing)', () => {
		it('produces "Transportation" not "San" for SF towing template', () => {
			// The exact bug we fixed: agent returns ["san-francisco", "transportation", "towing"]
			const category = deriveCategory(
				['san-francisco', 'transportation', 'towing'],
				'San Francisco, CA'
			);
			expect(category).toBe('Transportation');
		});

		it('produces "Education" not "Portland" for Portland schools template', () => {
			const category = deriveCategory(
				['portland', 'education', 'budget'],
				'Portland, OR'
			);
			expect(category).toBe('Education');
		});

		it('title-cases multi-word topics correctly', () => {
			const category = deriveCategory(['public-health'], null);
			expect(category).toBe('Public Health');
		});

		it('falls back to "General" when all topics are location names', () => {
			const category = deriveCategory(
				['san-francisco', 'ca'],
				'San Francisco, CA'
			);
			expect(category).toBe('General');
		});
	});
});
