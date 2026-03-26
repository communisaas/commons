/**
 * Representative Lookup — Stub
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

/**
 * Look up representatives for a country and district.
 *
 * Stub implementation: returns an empty array.
 * The resolvers for CA/GB/AU are documented stubs
 * (see docs/design/CROSS-BORDER-PLAN.md).
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
		`[rep-lookup] Stub: lookupRepresentatives(${countryCode}, ${districtId}) — no data source configured`
	);
	return [];
}
