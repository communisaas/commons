/**
 * Canadian Country Resolver
 *
 * Resolves coordinates to federal electoral districts (ridings) and
 * fetches Members of Parliament from the House of Commons.
 *
 * Data sources:
 * - District resolution: represent.opennorth.ca (lat/lng → riding)
 * - Officials: ourcommons.ca (Members of Parliament)
 *
 * The represent.opennorth.ca API supports coordinate-based lookups,
 * which avoids the need for postal code input.
 */

import type { CountryResolver, DistrictResult, Official } from '../country-resolver';

/** Rate limit: represent.opennorth.ca has no documented limit but be respectful */
const FETCH_TIMEOUT_MS = 8_000;

export class CAResolver implements CountryResolver {
	readonly country = 'CA';

	async resolveDistrict(lat: number, lng: number): Promise<DistrictResult | null> {
		try {
			// represent.opennorth.ca supports coordinate-based boundary lookup
			const url = `https://represent.opennorth.ca/boundaries/?contains=${lat},${lng}&sets=federal-electoral-districts`;
			const response = await fetch(url, {
				headers: {
					Accept: 'application/json',
					'User-Agent': 'Commons/1.0 (https://commons.email)',
				},
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});

			if (!response.ok) {
				console.warn(`[CA Resolver] represent.opennorth.ca returned ${response.status}`);
				return null;
			}

			const data = await response.json();
			const boundaries = data.objects ?? data;

			if (!Array.isArray(boundaries) || boundaries.length === 0) {
				return null;
			}

			const riding = boundaries[0];
			const ridingId = riding.external_id || riding.name || '';
			const ridingName = riding.name || 'Unknown Riding';
			const province = riding.metadata?.province || riding.province || '';

			return {
				districtId: ridingId,
				districtName: ridingName,
				districtType: 'riding',
				country: 'CA',
				extra: province ? { province } : undefined,
			};
		} catch (err) {
			console.warn(
				'[CA Resolver] District resolution failed:',
				err instanceof Error ? err.message : err
			);
			return null;
		}
	}

	async getOfficials(districtCode: string): Promise<Official[]> {
		try {
			// House of Commons open data — search by riding name or ID
			// The represent.opennorth.ca API also provides representative data
			const url = `https://represent.opennorth.ca/representatives/house-of-commons/?riding=${encodeURIComponent(districtCode)}`;
			const response = await fetch(url, {
				headers: {
					Accept: 'application/json',
					'User-Agent': 'Commons/1.0 (https://commons.email)',
				},
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});

			if (!response.ok) {
				console.warn(`[CA Resolver] Officials lookup returned ${response.status}`);
				return [];
			}

			const data = await response.json();
			const reps = data.objects ?? data;

			if (!Array.isArray(reps)) {
				return [];
			}

			return reps.map(
				(rep: {
					name: string;
					party_name?: string;
					district_name?: string;
					elected_office?: string;
					personal_url?: string;
					email?: string;
					url?: string;
					extra?: Record<string, string>;
				}) => ({
					id: `ca-mp-${(rep.name || '').toLowerCase().replace(/\s+/g, '-')}`,
					name: rep.name || 'Unknown',
					party: rep.party_name || 'Unknown',
					chamber: 'house-of-commons',
					region: rep.district_name || districtCode,
					district: districtCode,
					office: rep.elected_office || 'Member of Parliament',
					phone: rep.extra?.phone ?? null,
					email: rep.email || null,
					contactFormUrl: rep.url || null,
					websiteUrl: rep.personal_url || null,
					isVoting: true,
				})
			);
		} catch (err) {
			console.warn(
				'[CA Resolver] Officials lookup failed:',
				err instanceof Error ? err.message : err
			);
			return [];
		}
	}

	getJurisdictionLevels(): string[] {
		return ['federal', 'provincial', 'municipal'];
	}
}
