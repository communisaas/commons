/**
 * Australian postcode resolver tests.
 *
 * The old AUResolver class was deleted; current code resolves Australian
 * postcodes through resolveAustraliaPostcode().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	isValidAustraliaPostcode,
	resolveAustraliaPostcode
} from '$lib/core/location/resolvers/australia-aec';

describe('Australia postcode resolver', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe('isValidAustraliaPostcode', () => {
		it('accepts four-digit Australian postcodes', () => {
			expect(isValidAustraliaPostcode('2000')).toBe(true);
			expect(isValidAustraliaPostcode(' 3000 ')).toBe(true);
		});

		it('rejects malformed postcodes', () => {
			expect(isValidAustraliaPostcode('K1A 0A9')).toBe(false);
			expect(isValidAustraliaPostcode('20000')).toBe(false);
		});
	});

	describe('resolveAustraliaPostcode', () => {
		it('resolves an electorate from AEC array responses', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => [
					{
						id: 'sydney',
						name: 'Sydney',
						state: 'NSW'
					}
				]
			});

			const result = await resolveAustraliaPostcode('2000');

			expect(globalThis.fetch).toHaveBeenCalledWith(
				'https://electorate.aec.gov.au/api/Electorates?postcode=2000',
				expect.objectContaining({
					headers: { Accept: 'application/json' }
				})
			);
			expect(result).toEqual({
				electorateId: 'sydney',
				electorateName: 'Sydney',
				state: 'NSW'
			});
		});

		it('resolves an electorate from object-wrapped responses', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					electorates: [
						{
							electorate_name: 'Melbourne',
							state_ab: 'VIC'
						}
					]
				})
			});

			const result = await resolveAustraliaPostcode('3000');

			expect(result).toEqual({
				electorateId: '',
				electorateName: 'Melbourne',
				state: 'VIC'
			});
		});

		it('normalizes electorate names into IDs when an explicit ID is missing', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					results: [
						{
							name: 'North Sydney',
							state: 'NSW'
						}
					]
				})
			});

			const result = await resolveAustraliaPostcode('2060');

			expect(result.electorateId).toBe('north-sydney');
		});

		it('rejects invalid postcode input without calling fetch', async () => {
			await expect(resolveAustraliaPostcode('not-valid')).rejects.toThrow(
				'Invalid Australian postcode format'
			);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});

		it('rejects API failures', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 503
			});

			await expect(resolveAustraliaPostcode('2000')).rejects.toThrow('AEC API returned 503');
		});

		it('rejects when no electorate is found', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => []
			});

			await expect(resolveAustraliaPostcode('9999')).rejects.toThrow(
				'No electorate found for postcode'
			);
		});
	});
});
