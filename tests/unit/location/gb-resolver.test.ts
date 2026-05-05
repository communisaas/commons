/**
 * UK postcode resolver tests.
 *
 * The old GBResolver class was deleted; current code resolves UK postcodes
 * through resolveUKPostcode().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	isValidUKPostcode,
	resolveUKPostcode
} from '$lib/core/location/resolvers/uk-postcodes';

describe('UK postcode resolver', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe('isValidUKPostcode', () => {
		it('accepts common UK postcode formats', () => {
			expect(isValidUKPostcode('SW1A 1AA')).toBe(true);
			expect(isValidUKPostcode('EC1A1BB')).toBe(true);
		});

		it('rejects malformed postcodes', () => {
			expect(isValidUKPostcode('2000')).toBe(false);
			expect(isValidUKPostcode('K1A 0A9')).toBe(false);
		});
	});

	describe('resolveUKPostcode', () => {
		it('resolves a parliamentary constituency', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					status: 200,
					result: {
						parliamentary_constituency: 'Cities of London and Westminster',
						codes: {
							parliamentary_constituency: 'E14000639'
						},
						region: 'London',
						admin_district: 'City of London'
					}
				})
			});

			const result = await resolveUKPostcode('SW1A 1AA');

			expect(globalThis.fetch).toHaveBeenCalledWith(
				'https://api.postcodes.io/postcodes/SW1A+1AA',
				expect.objectContaining({
					headers: { Accept: 'application/json' }
				})
			);
			expect(result).toEqual({
				constituencyId: 'E14000639',
				constituencyName: 'Cities of London and Westminster',
				council: 'City of London',
				region: 'London'
			});
		});

		it('falls back to constituency name when code is missing', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					status: 200,
					result: {
						parliamentary_constituency: 'Edinburgh East and Musselburgh'
					}
				})
			});

			const result = await resolveUKPostcode('EH8 8BG');

			expect(result).toEqual({
				constituencyId: 'Edinburgh East and Musselburgh',
				constituencyName: 'Edinburgh East and Musselburgh',
				council: 'Unknown',
				region: 'Unknown'
			});
		});

		it('rejects invalid postcode input without calling fetch', async () => {
			await expect(resolveUKPostcode('not-valid')).rejects.toThrow(
				'Invalid UK postcode format'
			);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});

		it('rejects API failures', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 500
			});

			await expect(resolveUKPostcode('SW1A 1AA')).rejects.toThrow(
				'postcodes.io returned 500'
			);
		});

		it('rejects postcodes.io non-200 result status', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					status: 404,
					result: null
				})
			});

			await expect(resolveUKPostcode('SW1A 1AA')).rejects.toThrow('Postcode not found');
		});
	});
});
