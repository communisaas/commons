/**
 * Australian Country Resolver
 *
 * Resolves coordinates to federal electoral divisions (electorates)
 * and fetches Members of Parliament from the House of Representatives.
 *
 * Data sources:
 * - District resolution: AEC (Australian Electoral Commission) electorate lookup
 * - Officials: openaustralia.org API
 *
 * Australia uses compulsory voting and has 151 federal electorates.
 */

import type { CountryResolver, DistrictResult, Official } from '../country-resolver';

const FETCH_TIMEOUT_MS = 8_000;

/**
 * State code from postcode first digit (approximate).
 * Australian postcodes: 2xxx=NSW, 3xxx=VIC, 4xxx=QLD, 5xxx=SA, 6xxx=WA, 7xxx=TAS
 */
const POSTCODE_STATE: Record<string, string> = {
	'0': 'NT',
	'2': 'NSW',
	'3': 'VIC',
	'4': 'QLD',
	'5': 'SA',
	'6': 'WA',
	'7': 'TAS',
};

export class AUResolver implements CountryResolver {
	readonly country = 'AU';

	async resolveDistrict(lat: number, lng: number): Promise<DistrictResult | null> {
		try {
			// Use OpenStreetMap Nominatim reverse geocode to get a postcode,
			// then use AEC API to resolve the electorate.
			// This is the most reliable publicly available approach.
			const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&countrycodes=au&zoom=10`;
			const nominatimResponse = await fetch(nominatimUrl, {
				headers: {
					Accept: 'application/json',
					'User-Agent': 'Commons/1.0 (https://commons.email)',
				},
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});

			if (!nominatimResponse.ok) {
				console.warn(`[AU Resolver] Nominatim returned ${nominatimResponse.status}`);
				return null;
			}

			const geoData = await nominatimResponse.json();
			const postcode = geoData.address?.postcode;
			const stateFromGeo =
				geoData.address?.state || geoData.address?.territory || '';

			if (!postcode) {
				return null;
			}

			// AEC electorate lookup by postcode
			const aecUrl = `https://electorate.aec.gov.au/api/Electorates?postcode=${postcode}`;
			const aecResponse = await fetch(aecUrl, {
				headers: {
					Accept: 'application/json',
					'User-Agent': 'Commons/1.0 (https://commons.email)',
				},
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});

			if (!aecResponse.ok) {
				console.warn(`[AU Resolver] AEC API returned ${aecResponse.status}`);
				return null;
			}

			const aecData = await aecResponse.json();
			const electorates = Array.isArray(aecData)
				? aecData
				: aecData.electorates || aecData.results || [];

			if (electorates.length === 0) {
				return null;
			}

			const electorate = electorates[0];
			const electorateId = (electorate.id || electorate.name || '')
				.toString()
				.toLowerCase()
				.replace(/\s+/g, '-');
			const electorateName =
				electorate.name || electorate.electorate_name || 'Unknown';
			const state =
				electorate.state ||
				electorate.state_ab ||
				stateFromGeo ||
				POSTCODE_STATE[postcode[0]] ||
				'';

			return {
				districtId: electorateId,
				districtName: electorateName,
				districtType: 'electorate',
				country: 'AU',
				extra: state ? { state } : undefined,
			};
		} catch (err) {
			console.warn(
				'[AU Resolver] District resolution failed:',
				err instanceof Error ? err.message : err
			);
			return null;
		}
	}

	async getOfficials(districtCode: string): Promise<Official[]> {
		try {
			// OpenAustralia API for representatives
			const url = `https://www.openaustralia.org.au/api/getRepresentatives?output=json&electorate=${encodeURIComponent(districtCode)}`;
			const response = await fetch(url, {
				headers: {
					Accept: 'application/json',
					'User-Agent': 'Commons/1.0 (https://commons.email)',
				},
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});

			if (!response.ok) {
				console.warn(`[AU Resolver] OpenAustralia API returned ${response.status}`);
				return [];
			}

			const data = await response.json();
			const reps = Array.isArray(data) ? data : data.results || [];

			if (!Array.isArray(reps)) {
				return [];
			}

			return reps.map(
				(rep: {
					person_id?: string;
					full_name?: string;
					first_name?: string;
					last_name?: string;
					party?: string;
					electorate?: string;
					house?: string;
					constituency?: string;
				}) => ({
					id: `au-mp-${rep.person_id ?? 'unknown'}`,
					name:
						rep.full_name ||
						`${rep.first_name || ''} ${rep.last_name || ''}`.trim() ||
						'Unknown',
					party: rep.party || 'Unknown',
					chamber: 'house-of-representatives',
					region: rep.electorate || rep.constituency || districtCode,
					district: districtCode,
					office: 'Member of Parliament',
					phone: null,
					email: null,
					contactFormUrl: null,
					websiteUrl: rep.person_id
						? `https://www.openaustralia.org.au/mp/?id=${rep.person_id}`
						: null,
					isVoting: true,
				})
			);
		} catch (err) {
			console.warn(
				'[AU Resolver] Officials lookup failed:',
				err instanceof Error ? err.message : err
			);
			return [];
		}
	}

	getJurisdictionLevels(): string[] {
		return ['federal', 'state', 'local'];
	}
}
