/**
 * Unit Tests: Representative lookup service.
 *
 * The current service is an explicit fail-closed boundary until
 * country-specific representative data sources are wired in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	RepresentativeLookupNotConfiguredError,
	lookupRepresentatives
} from '$lib/server/geographic/rep-lookup';
import type { CountryCode } from '$lib/server/geographic/types';

let debugSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
	debugSpy.mockRestore();
});

describe('lookupRepresentatives', () => {
	it.each([
		['US', 'CA-12'],
		['GB', 'E14000639'],
		['CA', '35075'],
		['AU', 'sydney']
	] satisfies Array<[CountryCode, string]>)(
		'fails closed for %s until data sources are configured',
		async (countryCode, districtId) => {
			await expect(lookupRepresentatives(countryCode, districtId)).rejects.toMatchObject({
				code: 'REP_LOOKUP_NOT_CONFIGURED',
				countryCode,
				districtId
			});
		}
	);

	it('logs the boundary lookup for observability', async () => {
		await expect(lookupRepresentatives('GB', 'E14000639')).rejects.toBeInstanceOf(
			RepresentativeLookupNotConfiguredError
		);

		expect(debugSpy).toHaveBeenCalledWith(
			'[rep-lookup] Boundary: lookupRepresentatives(GB, E14000639) has no configured data source'
		);
	});

	it('names valid but currently unsupported future countries as dependency-first', async () => {
		await expect(lookupRepresentatives('FR', '75001')).rejects.toThrow(
			'Representative lookup is not configured for FR'
		);
	});
});
