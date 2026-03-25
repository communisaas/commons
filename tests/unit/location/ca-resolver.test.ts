/**
 * Canadian Resolver Tests
 *
 * Tests coordinate → riding resolution and MP lookup via mocked API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CAResolver } from '$lib/server/location/resolvers/ca';

describe('CAResolver', () => {
	const resolver = new CAResolver();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe('resolveDistrict', () => {
		it('should resolve Ottawa coordinates to a riding', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					objects: [
						{
							external_id: '35075',
							name: 'Ottawa Centre',
							metadata: { province: 'ON' },
						},
					],
				}),
			});

			const result = await resolver.resolveDistrict(45.4215, -75.6972);
			expect(result).not.toBeNull();
			expect(result!.districtId).toBe('35075');
			expect(result!.districtName).toBe('Ottawa Centre');
			expect(result!.districtType).toBe('riding');
			expect(result!.country).toBe('CA');
			expect(result!.extra?.province).toBe('ON');
		});

		it('should return null for coordinates outside Canada', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					objects: [],
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

			const result = await resolver.resolveDistrict(45.4215, -75.6972);
			expect(result).toBeNull();
		});

		it('should return null on network error', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('Network error')
			);

			const result = await resolver.resolveDistrict(45.4215, -75.6972);
			expect(result).toBeNull();
		});
	});

	describe('getOfficials', () => {
		it('should return MP for a riding', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					objects: [
						{
							name: 'Yasir Naqvi',
							party_name: 'Liberal',
							district_name: 'Ottawa Centre',
							elected_office: 'MP',
							email: 'yasir.naqvi@parl.gc.ca',
							personal_url: 'https://yasirnaqvi.libparl.ca',
						},
					],
				}),
			});

			const officials = await resolver.getOfficials('35075');
			expect(officials.length).toBe(1);
			expect(officials[0].name).toBe('Yasir Naqvi');
			expect(officials[0].party).toBe('Liberal');
			expect(officials[0].chamber).toBe('house-of-commons');
			expect(officials[0].email).toBe('yasir.naqvi@parl.gc.ca');
			expect(officials[0].isVoting).toBe(true);
		});

		it('should return empty array on API failure', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 500,
			});

			const officials = await resolver.getOfficials('35075');
			expect(officials).toEqual([]);
		});

		it('should return empty array on network error', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('Network error')
			);

			const officials = await resolver.getOfficials('35075');
			expect(officials).toEqual([]);
		});
	});

	describe('getJurisdictionLevels', () => {
		it('should return federal, provincial, municipal', () => {
			expect(resolver.getJurisdictionLevels()).toEqual([
				'federal',
				'provincial',
				'municipal',
			]);
		});
	});

	it('should have country = CA', () => {
		expect(resolver.country).toBe('CA');
	});
});
