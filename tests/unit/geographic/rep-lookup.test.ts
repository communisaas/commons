/**
 * Unit Tests: Representative lookup service.
 *
 * The current service is an explicit no-data stub until country-specific
 * representative data sources are wired in.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupRepresentatives } from '$lib/server/geographic/rep-lookup';
import type { CountryCode } from '$lib/server/geographic/types';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('lookupRepresentatives', () => {
	it.each([
		['US', 'CA-12'],
		['GB', 'E14000639'],
		['CA', '35075'],
		['AU', 'sydney']
	] satisfies Array<[CountryCode, string]>)(
		'returns an empty list for %s until data sources are configured',
		async (countryCode, districtId) => {
			await expect(lookupRepresentatives(countryCode, districtId)).resolves.toEqual([]);
		}
	);

	it('logs the stub lookup for observability', async () => {
		const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

		await lookupRepresentatives('GB', 'E14000639');

		expect(debugSpy).toHaveBeenCalledWith(
			'[rep-lookup] Stub: lookupRepresentatives(GB, E14000639) — no data source configured'
		);
	});

	it('returns an empty list for valid but currently unsupported future countries', async () => {
		await expect(lookupRepresentatives('FR', '75001')).resolves.toEqual([]);
	});
});
