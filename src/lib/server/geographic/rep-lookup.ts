/**
 * International representative lookup service.
 *
 * Routes to the correct data source based on country code:
 * - US: Shadow Atlas officials
 * - GB/CA/AU: DecisionMaker table (with ExternalId for constituency lookup)
 */

import { db } from '$lib/core/db';
import type { CountryCode, InternationalRepresentativeData } from './types';
import { SUPPORTED_RESOLVER_COUNTRIES } from './types';

export interface RepresentativeResult {
	id: string;
	name: string;
	party: string | null;
	chamber: string | null;
	office: string | null;
	phone: string | null;
	email: string | null;
	websiteUrl: string | null;
	countryCode: string;
	constituencyId: string;
	constituencyName: string;
}

/**
 * Look up representatives for a given country + district.
 *
 * For US, delegates to Shadow Atlas getOfficials().
 * For international countries, queries the DecisionMaker table.
 */
export async function lookupRepresentatives(
	countryCode: string,
	districtId: string
): Promise<RepresentativeResult[]> {
	const code = countryCode.toUpperCase() as CountryCode;

	if (!SUPPORTED_RESOLVER_COUNTRIES.includes(code)) {
		return [];
	}

	if (code === 'US') {
		return lookupUSRepresentatives(districtId);
	}

	return lookupInternationalRepresentatives(code, districtId);
}

/**
 * US representative lookup via Shadow Atlas.
 */
async function lookupUSRepresentatives(districtCode: string): Promise<RepresentativeResult[]> {
	try {
		const { getOfficials } = await import('$lib/core/shadow-atlas/client');
		const officials = await getOfficials(districtCode);

		if (!officials.officials || officials.officials.length === 0) {
			return [];
		}

		return officials.officials.map((o) => ({
			id: `us-${districtCode}-${o.bioguide_id || o.name}`.toLowerCase().replace(/\s+/g, '-'),
			name: o.name,
			party: o.party ?? null,
			chamber: o.chamber ?? null,
			office: o.office ?? null,
			phone: o.phone ?? null,
			email: null,
			websiteUrl: o.website_url ?? null,
			countryCode: 'US',
			constituencyId: districtCode,
			constituencyName: officials.district_code
		}));
	} catch (err) {
		console.error('[rep-lookup] US lookup failed:', err instanceof Error ? err.message : err);
		return [];
	}
}

/**
 * International representative lookup from the DecisionMaker table.
 * Uses ExternalId with system='constituency' for constituency matching.
 */
async function lookupInternationalRepresentatives(
	countryCode: CountryCode,
	constituencyId: string
): Promise<RepresentativeResult[]> {
	// Find decision-makers by jurisdiction (country) + constituency external ID
	const externalIds = await db.externalId.findMany({
		where: {
			system: 'constituency',
			value: constituencyId,
			decisionMaker: {
				jurisdiction: countryCode
			}
		},
		include: {
			decisionMaker: true
		}
	});

	return externalIds.map((ext): RepresentativeResult => {
		const dm = ext.decisionMaker;
		return {
			id: dm.id,
			name: dm.name,
			party: dm.party,
			chamber: null, // chamber is now implied by institutionId
			office: dm.title,
			phone: dm.phone,
			email: dm.email,
			websiteUrl: dm.websiteUrl,
			countryCode: dm.jurisdiction ?? countryCode,
			constituencyId,
			constituencyName: dm.district ?? constituencyId
		};
	});
}

/**
 * List all representatives for a country, optionally filtered by constituency.
 */
export async function listRepresentatives(
	countryCode: string,
	constituencyId?: string,
	cursor?: string | null,
	limit = 50
): Promise<{ data: InternationalRepresentativeData[]; nextCursor: string | null; hasMore: boolean }> {
	const where: Record<string, unknown> = {
		jurisdiction: countryCode.toUpperCase(),
		jurisdictionLevel: 'international'
	};

	const findArgs: Record<string, unknown> = {
		where,
		take: limit + 1,
		orderBy: { name: 'asc' as const },
		include: {
			externalIds: {
				where: { system: 'constituency' },
				select: { value: true }
			}
		}
	};

	if (cursor) {
		findArgs.cursor = { id: cursor };
		findArgs.skip = 1;
	}

	// If filtering by constituency, find via ExternalId join
	if (constituencyId) {
		(where as Record<string, unknown>).externalIds = {
			some: { system: 'constituency', value: constituencyId }
		};
	}

	const reps = await db.decisionMaker.findMany(
		findArgs as Parameters<typeof db.decisionMaker.findMany>[0]
	);

	const hasMore = reps.length > limit;
	const items = reps.slice(0, limit);
	const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

	const data: InternationalRepresentativeData[] = items.map((r: any) => ({
		id: r.id,
		countryCode: (r.jurisdiction ?? countryCode) as CountryCode,
		constituencyId: r.externalIds?.[0]?.value ?? '',
		constituencyName: r.district ?? '',
		name: r.name,
		party: r.party,
		chamber: null, // chamber implied by institutionId
		office: r.title,
		phone: r.phone,
		email: r.email,
		websiteUrl: r.websiteUrl
	}));

	return { data, nextCursor, hasMore };
}
