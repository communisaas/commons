/**
 * Representative Lookup boundary
 *
 * Looks up elected representatives for a given country + district.
 * Used by the /api/geographic/resolve endpoint for GB/CA/AU resolution.
 *
 * Production note: Wire to real data sources per country:
 * - GB: TheyWorkForYou API / UK Parliament API
 * - CA: OpenParliament API
 * - AU: openaustralia.org.au API
 */

import type { CountryCode, InternationalRepresentativeData } from './types';

export class RepresentativeLookupNotConfiguredError extends Error {
	readonly code = 'REP_LOOKUP_NOT_CONFIGURED';

	constructor(
		readonly countryCode: CountryCode,
		readonly districtId: string
	) {
		super(
			`Representative lookup is not configured for ${countryCode}; country resolver claims stay dependency-first until rep-lookup data is hydrated.`
		);
		this.name = 'RepresentativeLookupNotConfiguredError';
	}
}

/**
 * Look up representatives for a country and district.
 *
 * Boundary implementation: fail closed until country data sources are wired.
 * Returning [] would make an unsupported representative lookup look like a
 * successful district with no officials.
 *
 * @param countryCode - ISO country code
 * @param districtId - District identifier from resolver
 * @returns Array of representative records
 */
export async function lookupRepresentatives(
	countryCode: CountryCode,
	districtId: string
): Promise<InternationalRepresentativeData[]> {
	console.debug(
		`[rep-lookup] Boundary: lookupRepresentatives(${countryCode}, ${districtId}) has no configured data source`
	);
	throw new RepresentativeLookupNotConfiguredError(countryCode, districtId);
}
