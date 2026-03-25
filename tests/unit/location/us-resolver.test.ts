/**
 * US Resolver Tests
 *
 * Tests that existing Shadow Atlas logic works correctly through
 * the CountryResolver interface. Mocks the shadow-atlas client imports.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { USResolver } from '$lib/server/location/resolvers/us';

// Mock the shadow-atlas client
vi.mock('$lib/core/shadow-atlas/client', () => ({
	lookupDistrict: vi.fn(),
	getOfficials: vi.fn(),
}));

describe('USResolver', () => {
	const resolver = new USResolver();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should have country = US', () => {
		expect(resolver.country).toBe('US');
	});

	describe('resolveDistrict', () => {
		it('should resolve coordinates via shadow atlas', async () => {
			const { lookupDistrict } = await import('$lib/core/shadow-atlas/client');
			(lookupDistrict as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				district: {
					id: 'CA-12',
					name: "California's 12th Congressional District",
					jurisdiction: 'congressional',
					districtType: 'congressional',
				},
				merkleProof: null,
				cell_id: '872830828ffffff',
			});

			const result = await resolver.resolveDistrict(37.7749, -122.4194);
			expect(result).not.toBeNull();
			expect(result!.districtId).toBe('CA-12');
			expect(result!.districtName).toBe("California's 12th Congressional District");
			expect(result!.districtType).toBe('congressional');
			expect(result!.country).toBe('US');
		});

		it('should return null when shadow atlas throws', async () => {
			const { lookupDistrict } = await import('$lib/core/shadow-atlas/client');
			(lookupDistrict as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('No district data')
			);

			const result = await resolver.resolveDistrict(0, 0);
			expect(result).toBeNull();
		});
	});

	describe('getOfficials', () => {
		it('should return officials from shadow atlas', async () => {
			const { getOfficials } = await import('$lib/core/shadow-atlas/client');
			(getOfficials as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				officials: [
					{
						bioguide_id: 'P000197',
						name: 'Nancy Pelosi',
						party: 'Democrat',
						chamber: 'house' as const,
						state: 'CA',
						district: '12',
						office: 'Representative, CA',
						phone: '202-225-4965',
						contact_form_url: null,
						website_url: 'https://pelosi.house.gov',
						cwc_code: null,
						is_voting: true,
						delegate_type: null,
					},
				],
				district_code: 'CA-12',
				state: 'CA',
				special_status: null,
				source: 'congress-legislators' as const,
				cached: true,
			});

			const officials = await resolver.getOfficials('CA-12');
			expect(officials.length).toBe(1);
			expect(officials[0].id).toBe('P000197');
			expect(officials[0].name).toBe('Nancy Pelosi');
			expect(officials[0].party).toBe('Democrat');
			expect(officials[0].chamber).toBe('house');
			expect(officials[0].region).toBe('CA');
			expect(officials[0].isVoting).toBe(true);
		});

		it('should return empty array when shadow atlas throws', async () => {
			const { getOfficials } = await import('$lib/core/shadow-atlas/client');
			(getOfficials as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('Officials unavailable')
			);

			const officials = await resolver.getOfficials('XX-00');
			expect(officials).toEqual([]);
		});
	});

	describe('getJurisdictionLevels', () => {
		it('should return US jurisdiction hierarchy', () => {
			const levels = resolver.getJurisdictionLevels();
			expect(levels).toEqual(['federal', 'state', 'county', 'city', 'local']);
		});
	});
});
