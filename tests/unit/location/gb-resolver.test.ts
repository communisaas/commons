/**
 * UK Resolver Tests
 *
 * Tests coordinate → constituency resolution and MP lookup via mocked API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GBResolver } from '$lib/server/location/resolvers/gb';

describe('GBResolver', () => {
	const resolver = new GBResolver();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe('resolveDistrict', () => {
		it('should resolve London coordinates to a constituency', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					status: 200,
					result: [
						{
							parliamentary_constituency: 'Cities of London and Westminster',
							codes: {
								parliamentary_constituency: 'E14000639',
							},
							region: 'London',
							admin_district: 'City of London',
						},
					],
				}),
			});

			const result = await resolver.resolveDistrict(51.5128, -0.0918);
			expect(result).not.toBeNull();
			expect(result!.districtId).toBe('E14000639');
			expect(result!.districtName).toBe('Cities of London and Westminster');
			expect(result!.districtType).toBe('constituency');
			expect(result!.country).toBe('GB');
			expect(result!.extra?.region).toBe('London');
			expect(result!.extra?.council).toBe('City of London');
		});

		it('should return null for coordinates outside UK', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					status: 200,
					result: [],
				}),
			});

			const result = await resolver.resolveDistrict(0, 0);
			expect(result).toBeNull();
		});

		it('should return null on API failure', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 500,
			});

			const result = await resolver.resolveDistrict(51.5074, -0.1278);
			expect(result).toBeNull();
		});

		it('should return null on network error', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('Network error')
			);

			const result = await resolver.resolveDistrict(51.5074, -0.1278);
			expect(result).toBeNull();
		});

		it('should handle postcodes.io non-200 status', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					status: 404,
					result: null,
				}),
			});

			const result = await resolver.resolveDistrict(51.5074, -0.1278);
			expect(result).toBeNull();
		});
	});

	describe('getOfficials', () => {
		it('should return MP for a constituency', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [
						{
							value: {
								id: 4514,
								nameDisplayAs: 'Nickie Aiken',
								nameFullTitle: 'Mrs Nickie Aiken MP',
								latestParty: { name: 'Conservative' },
								latestHouseMembership: {
									membershipFrom: 'Cities of London and Westminster',
								},
							},
						},
					],
				}),
			});

			const officials = await resolver.getOfficials('Cities of London and Westminster');
			expect(officials.length).toBe(1);
			expect(officials[0].name).toBe('Nickie Aiken');
			expect(officials[0].party).toBe('Conservative');
			expect(officials[0].chamber).toBe('house-of-commons');
			expect(officials[0].isVoting).toBe(true);
			expect(officials[0].websiteUrl).toContain('4514');
		});

		it('should return empty array on API failure', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 500,
			});

			const officials = await resolver.getOfficials('Cities of London and Westminster');
			expect(officials).toEqual([]);
		});

		it('should return empty array on network error', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('Network error')
			);

			const officials = await resolver.getOfficials('Cities of London and Westminster');
			expect(officials).toEqual([]);
		});

		it('should handle empty items array', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					items: [],
				}),
			});

			const officials = await resolver.getOfficials('NonexistentConstituency');
			expect(officials).toEqual([]);
		});
	});

	describe('getJurisdictionLevels', () => {
		it('should return federal, devolved, local', () => {
			expect(resolver.getJurisdictionLevels()).toEqual([
				'federal',
				'devolved',
				'local',
			]);
		});
	});

	it('should have country = GB', () => {
		expect(resolver.country).toBe('GB');
	});
});
