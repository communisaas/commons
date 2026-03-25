/**
 * UK Country Resolver
 *
 * Resolves coordinates to Westminster parliamentary constituencies
 * and fetches Members of Parliament.
 *
 * Data sources:
 * - District resolution: postcodes.io (lat/lng → constituency via nearest postcode)
 * - Officials: members-api.parliament.uk (Members of Parliament)
 */

import type { CountryResolver, DistrictResult, Official } from '../country-resolver';

const FETCH_TIMEOUT_MS = 8_000;

export class GBResolver implements CountryResolver {
	readonly country = 'GB';

	async resolveDistrict(lat: number, lng: number): Promise<DistrictResult | null> {
		try {
			// postcodes.io supports reverse geocoding: lat/lng → nearest postcode → constituency
			const url = `https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1`;
			const response = await fetch(url, {
				headers: {
					Accept: 'application/json',
					'User-Agent': 'Commons/1.0 (https://commons.email)',
				},
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});

			if (!response.ok) {
				console.warn(`[GB Resolver] postcodes.io returned ${response.status}`);
				return null;
			}

			const data = await response.json();

			if (data.status !== 200 || !data.result || data.result.length === 0) {
				return null;
			}

			const postcode = data.result[0];
			const constituencyId =
				postcode.codes?.parliamentary_constituency ?? postcode.parliamentary_constituency ?? '';
			const constituencyName = postcode.parliamentary_constituency ?? 'Unknown Constituency';
			const region = postcode.region ?? '';
			const council = postcode.admin_district ?? '';

			return {
				districtId: constituencyId,
				districtName: constituencyName,
				districtType: 'constituency',
				country: 'GB',
				extra: {
					...(region ? { region } : {}),
					...(council ? { council } : {}),
				},
			};
		} catch (err) {
			console.warn(
				'[GB Resolver] District resolution failed:',
				err instanceof Error ? err.message : err
			);
			return null;
		}
	}

	async getOfficials(districtCode: string): Promise<Official[]> {
		try {
			// UK Parliament Members API — search by constituency
			const searchUrl = `https://members-api.parliament.uk/api/Members/Search?ConstituencyName=${encodeURIComponent(districtCode)}&IsCurrentMember=true&House=1`;
			const response = await fetch(searchUrl, {
				headers: {
					Accept: 'application/json',
					'User-Agent': 'Commons/1.0 (https://commons.email)',
				},
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});

			if (!response.ok) {
				console.warn(`[GB Resolver] Parliament API returned ${response.status}`);
				return [];
			}

			const data = await response.json();
			const items = data.items ?? [];

			if (!Array.isArray(items)) {
				return [];
			}

			return items.map(
				(item: {
					value?: {
						id?: number;
						nameFullTitle?: string;
						nameDisplayAs?: string;
						latestParty?: { name?: string };
						latestHouseMembership?: {
							membershipFrom?: string;
						};
						thumbnailUrl?: string;
					};
				}) => {
					const member = item.value;
					if (!member) return null;
					return {
						id: `gb-mp-${member.id ?? 'unknown'}`,
						name: member.nameDisplayAs || member.nameFullTitle || 'Unknown',
						party: member.latestParty?.name || 'Unknown',
						chamber: 'house-of-commons',
						region: member.latestHouseMembership?.membershipFrom || districtCode,
						district: districtCode,
						office: 'Member of Parliament',
						phone: null,
						email: null,
						contactFormUrl: null,
						websiteUrl: member.id
							? `https://members.parliament.uk/member/${member.id}/contact`
							: null,
						isVoting: true,
					};
				}
			).filter((o: Official | null): o is Official => o !== null);
		} catch (err) {
			console.warn(
				'[GB Resolver] Officials lookup failed:',
				err instanceof Error ? err.message : err
			);
			return [];
		}
	}

	getJurisdictionLevels(): string[] {
		return ['federal', 'devolved', 'local'];
	}
}
