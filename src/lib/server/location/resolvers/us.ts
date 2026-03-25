/**
 * US Country Resolver
 *
 * Wraps the existing Shadow Atlas + IPFS pipeline for US district resolution.
 * This is the canonical US path — extracts the existing logic into the
 * CountryResolver interface without modifying behavior.
 */

import type { CountryResolver, DistrictResult, Official } from '../country-resolver';

export class USResolver implements CountryResolver {
	readonly country = 'US';

	async resolveDistrict(lat: number, lng: number): Promise<DistrictResult | null> {
		try {
			const { lookupDistrict } = await import('$lib/core/shadow-atlas/client');
			const result = await lookupDistrict(lat, lng);

			return {
				districtId: result.district.id,
				districtName: result.district.name,
				districtType: 'congressional',
				country: 'US',
			};
		} catch {
			return null;
		}
	}

	async getOfficials(districtCode: string): Promise<Official[]> {
		try {
			const { getOfficials } = await import('$lib/core/shadow-atlas/client');
			const response = await getOfficials(districtCode);

			return response.officials.map((o) => ({
				id: o.bioguide_id,
				name: o.name,
				party: o.party,
				chamber: o.chamber,
				region: o.state,
				district: o.district,
				office: o.office,
				phone: o.phone,
				email: null,
				contactFormUrl: o.contact_form_url,
				websiteUrl: o.website_url,
				isVoting: o.is_voting,
			}));
		} catch {
			return [];
		}
	}

	getJurisdictionLevels(): string[] {
		return ['federal', 'state', 'county', 'city', 'local'];
	}
}
