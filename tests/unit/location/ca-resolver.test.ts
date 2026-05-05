/**
 * Canadian postal resolver tests.
 *
 * The old CAResolver class was deleted; current code resolves Canadian postal
 * codes through resolveCanadaPostalCode().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	isValidCanadaPostalCode,
	resolveCanadaPostalCode
} from '$lib/core/location/resolvers/canada-postal';

describe('Canada postal resolver', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	describe('isValidCanadaPostalCode', () => {
		it('accepts Canadian postal code formats with or without a space', () => {
			expect(isValidCanadaPostalCode('K1A 0A9')).toBe(true);
			expect(isValidCanadaPostalCode('K1A0A9')).toBe(true);
		});

		it('rejects malformed postal codes', () => {
			expect(isValidCanadaPostalCode('12345')).toBe(false);
			expect(isValidCanadaPostalCode('SW1A 1AA')).toBe(false);
		});
	});

	describe('resolveCanadaPostalCode', () => {
		it('resolves a federal riding from centroid boundaries', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					province: 'ON',
					boundaries_centroid: [
						{
							boundary_set_name: 'Federal electoral district',
							external_id: '35075',
							name: 'Ottawa Centre'
						}
					]
				})
			});

			const result = await resolveCanadaPostalCode('K1A 0A9');

			expect(globalThis.fetch).toHaveBeenCalledWith(
				'https://represent.opennorth.ca/postcodes/K1A0A9/',
				expect.objectContaining({
					headers: { Accept: 'application/json' }
				})
			);
			expect(result).toEqual({
				ridingId: '35075',
				ridingName: 'Ottawa Centre',
				province: 'ON'
			});
		});

		it('falls back to concordance boundaries when centroid has no federal riding', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					boundaries_centroid: [{ boundary_set_name: 'Municipal ward', name: 'Ward 1' }],
					boundaries_concordance: [
						{
							boundary_set_name: 'Federal electoral district',
							name: 'Toronto Centre',
							metadata: { province: 'ON' }
						}
					]
				})
			});

			const result = await resolveCanadaPostalCode('M5V 2T6');

			expect(result).toEqual({
				ridingId: 'Toronto Centre',
				ridingName: 'Toronto Centre',
				province: 'ON'
			});
		});

		it('rejects invalid postal code input without calling fetch', async () => {
			await expect(resolveCanadaPostalCode('not-valid')).rejects.toThrow(
				'Invalid Canadian postal code format'
			);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});

		it('rejects API failures', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 500
			});

			await expect(resolveCanadaPostalCode('K1A 0A9')).rejects.toThrow(
				'represent.opennorth.ca returned 500'
			);
		});

		it('rejects when no federal riding is found', async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					boundaries_centroid: [],
					boundaries_concordance: []
				})
			});

			await expect(resolveCanadaPostalCode('K1A 0A9')).rejects.toThrow(
				'No federal riding found for postal code'
			);
		});
	});
});
