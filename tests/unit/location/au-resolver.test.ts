/**
 * Australian Resolver Tests
 *
 * Tests coordinate → electorate resolution and MP lookup via mocked API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AUResolver } from '$lib/server/location/resolvers/au';

describe('AUResolver', () => {
	const resolver = new AUResolver();
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe('resolveDistrict', () => {
		it('should resolve Sydney coordinates to an electorate', async () => {
			// First call: Nominatim reverse geocode
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					address: {
						postcode: '2000',
						state: 'New South Wales',
					},
				}),
			});

			// Second call: AEC electorate lookup
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => [
					{
						id: 'sydney',
						name: 'Sydney',
						state: 'NSW',
					},
				],
			});

			const result = await resolver.resolveDistrict(-33.8688, 151.2093);
			expect(result).not.toBeNull();
			expect(result!.districtId).toBe('sydney');
			expect(result!.districtName).toBe('Sydney');
			expect(result!.districtType).toBe('electorate');
			expect(result!.country).toBe('AU');
			expect(result!.extra?.state).toBe('NSW');
		});

		it('should return null when Nominatim fails', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 500,
			});

			const result = await resolver.resolveDistrict(-33.8688, 151.2093);
			expect(result).toBeNull();
		});

		it('should return null when no postcode in geocode result', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					address: {
						state: 'New South Wales',
					},
				}),
			});

			const result = await resolver.resolveDistrict(-33.8688, 151.2093);
			expect(result).toBeNull();
		});

		it('should return null when AEC returns no electorates', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					address: { postcode: '9999' },
				}),
			});

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => [],
			});

			const result = await resolver.resolveDistrict(-33.8688, 151.2093);
			expect(result).toBeNull();
		});

		it('should return null on network error', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('Network error')
			);

			const result = await resolver.resolveDistrict(-33.8688, 151.2093);
			expect(result).toBeNull();
		});

		it('should handle AEC API failure gracefully', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					address: { postcode: '2000' },
				}),
			});

			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 503,
			});

			const result = await resolver.resolveDistrict(-33.8688, 151.2093);
			expect(result).toBeNull();
		});
	});

	describe('getOfficials', () => {
		it('should return MP for an electorate', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => [
					{
						person_id: '10001',
						full_name: 'Tanya Plibersek',
						party: 'Australian Labor Party',
						electorate: 'Sydney',
					},
				],
			});

			const officials = await resolver.getOfficials('Sydney');
			expect(officials.length).toBe(1);
			expect(officials[0].name).toBe('Tanya Plibersek');
			expect(officials[0].party).toBe('Australian Labor Party');
			expect(officials[0].chamber).toBe('house-of-representatives');
			expect(officials[0].isVoting).toBe(true);
		});

		it('should construct name from first/last when full_name missing', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => [
					{
						person_id: '10002',
						first_name: 'John',
						last_name: 'Doe',
						party: 'Independent',
						electorate: 'Test',
					},
				],
			});

			const officials = await resolver.getOfficials('Test');
			expect(officials[0].name).toBe('John Doe');
		});

		it('should return empty array on API failure', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 500,
			});

			const officials = await resolver.getOfficials('Sydney');
			expect(officials).toEqual([]);
		});

		it('should return empty array on network error', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error('Network error')
			);

			const officials = await resolver.getOfficials('Sydney');
			expect(officials).toEqual([]);
		});
	});

	describe('getJurisdictionLevels', () => {
		it('should return federal, state, local', () => {
			expect(resolver.getJurisdictionLevels()).toEqual([
				'federal',
				'state',
				'local',
			]);
		});
	});

	it('should have country = AU', () => {
		expect(resolver.country).toBe('AU');
	});
});
