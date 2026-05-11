import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { lookupDistrict, getOfficials, resolveLocation } from '$lib/core/shadow-atlas/client';
import { issueGeolocationResolutionToken } from '$lib/server/auth/address-resolution-token';

/**
 * POST /api/location/resolve
 *
 * Unified coordinate → district resolution endpoint.
 *
 * Architecture:
 *   Shadow Atlas handles all resolution (cell_id, district, officials)
 *   via H3 + R-tree spatial index and pre-ingested IPFS data.
 *   Zero external government API calls.
 *
 * The client sends ONLY coordinates. This endpoint handles all calls
 * server-side via Shadow Atlas.
 *
 * PRIVACY:
 * - Accepts COORDINATES only — never addresses.
 * - Rejects requests containing address-like fields.
 * - Never logs cell_id values.
 * - Does NOT update trust_tier or any user database record.
 */

const resolveSchema = z.object({
	lat: z.number().min(-90).max(90),
	lng: z.number().min(-180).max(180),
	signal_type: z.enum(['browser', 'verified']),
	confidence: z.number().min(0).max(1),
	cell_id: z.string().regex(/^[0-9a-fA-F]{11,15}$/).optional(),
	country_code: z.string().length(2).optional()
});

export const POST: RequestHandler = async ({ request, locals }) => {
	// Auth check
	if (!locals.user) {
		return json({ resolved: false, error: 'Authentication required' }, { status: 401 });
	}

	try {
		const body = await request.json();

		// Privacy guard: reject requests containing address fields
		const bodyKeys = Object.keys(body);
		const addressFields = ['street', 'city', 'address', 'zipCode', 'zip_code', 'postal_code', 'zip', 'home_address', 'addr'];
		const leaked = bodyKeys.filter((k) => addressFields.includes(k));
		if (leaked.length > 0) {
			return json(
				{ resolved: false, error: 'Address fields must not be sent to this endpoint' },
				{ status: 400 }
			);
		}

		// Validate request body
		const parseResult = resolveSchema.safeParse(body);
		if (!parseResult.success) {
			return json(
				{
					resolved: false,
					error: 'Invalid request',
					details: parseResult.error.issues.map((i) => i.message)
				},
				{ status: 400 }
			);
		}

		const { lat, lng, signal_type, confidence, cell_id: clientCellId, country_code: _country_code } = parseResult.data;

		// District resolution
		let resolvedDistrictCode: string | null = null;
		let districtName: string | null = null;
		let districtState: string | null = null;
		let resolvedCellId: string | null = clientCellId ?? null;

		// Officials resolution
		let officials: Array<{
			name: string;
			office: string;
			chamber: string;
			party: string;
			state: string;
			district: string;
			bioguide_id: string;
			is_voting_member: boolean;
			delegate_type?: string | null;
		}> = [];
		let specialStatus: {
			type: string;
			message: string;
			has_senators: boolean;
			has_voting_representative: boolean;
		} | null = null;
		let officialsResolved = false;

		// Try composite call first (saves a round-trip vs. separate lookup + officials)
		try {
			const composite = await resolveLocation(lat, lng);
			resolvedDistrictCode = composite.district.district.id;
			districtName = composite.district.district.name;
			const parts = resolvedDistrictCode.split('-');
			if (parts.length >= 2) {
				districtState = parts[0];
			}

			// Use cell_id from Shadow Atlas if client didn't provide one
			if (!resolvedCellId && composite.district.cell_id) {
				resolvedCellId = composite.district.cell_id;
			}

			// Officials already resolved in composite response
			if (composite.officials) {
				officialsResolved = true;
				if (composite.officials.special_status) {
					specialStatus = composite.officials.special_status;
				}
				officials = composite.officials.officials.map((official) => ({
					name: official.name,
					office: official.office,
					chamber: official.chamber,
					party: official.party,
					state: official.state,
					district:
						official.chamber === 'house'
							? composite.officials!.district_code ||
								`${official.state}-${official.district || '00'}`
							: official.state,
					bioguide_id: official.bioguide_id,
					is_voting_member: official.is_voting ?? true,
					delegate_type: official.delegate_type,
				}));
				console.log('[Location Resolve] District + officials resolved via composite call');
			}
		} catch {
			// Fallback to separate lookupDistrict call
			try {
				const lookupResult = await lookupDistrict(lat, lng);
				resolvedDistrictCode = lookupResult.district.id;
				districtName = lookupResult.district.name;
				const parts = resolvedDistrictCode.split('-');
				if (parts.length >= 2) {
					districtState = parts[0];
				}

				// Use cell_id from Shadow Atlas lookup if client didn't provide one
				if (!resolvedCellId && lookupResult.cell_id) {
					resolvedCellId = lookupResult.cell_id;
				}
			} catch (lookupError) {
				console.warn(
					'[Location Resolve] Shadow Atlas district lookup failed:',
					lookupError instanceof Error ? lookupError.message : lookupError
				);
			}
		}

		if (!resolvedDistrictCode) {
			return json({
				resolved: false,
				district: null,
				officials: [],
				special_status: null,
				zk_eligible: false,
				confidence,
				signal_type
			});
		}

		// Fetch officials separately if not already resolved (fallback path)
		if (!officialsResolved) {
			try {
				const officialsResponse = await getOfficials(resolvedDistrictCode);

				if (officialsResponse.special_status) {
					specialStatus = officialsResponse.special_status;
				}

				officials = officialsResponse.officials.map((official) => ({
					name: official.name,
					office: official.office,
					chamber: official.chamber,
					party: official.party,
					state: official.state,
					district:
						official.chamber === 'house'
							? officialsResponse.district_code ||
								`${official.state}-${official.district || '00'}`
							: official.state,
					bioguide_id: official.bioguide_id,
					is_voting_member: official.is_voting ?? true,
					delegate_type: official.delegate_type
				}));
				console.log('[Location Resolve] Officials resolved via Shadow Atlas');
			} catch (officialsError) {
				// Shadow Atlas down — return empty officials rather than failing
				console.warn(
					'[Location Resolve] Shadow Atlas officials unavailable:',
					officialsError instanceof Error ? officialsError.message : officialsError
				);
			}
		}

		// ZK eligibility: requires cell_id
		const zk_eligible = resolvedCellId != null;

		// F-2.4 follow-up: mint a geo-mode address-resolution token so the
		// browser-geolocation path can pass /api/identity/verify-address's
		// "coordinates require token" gate. Geo-mode binds (userId, lat, lng,
		// expiresAt) without an addressHash. This does not authenticate GPS —
		// `navigator.geolocation` remains client-spoofable — but it closes
		// the bypass where a manual-address client could omit the
		// address_hash to skip the verify-address token check.
		const issued = await issueGeolocationResolutionToken({
			userId: locals.user.id,
			lat,
			lng
		});

		return json({
			resolved: true,
			district: {
				code: resolvedDistrictCode,
				name: districtName || resolvedDistrictCode,
				state: districtState || resolvedDistrictCode.split('-')[0]
			},
			officials,
			special_status: specialStatus,
			zk_eligible,
			...(resolvedCellId ? { cell_id: resolvedCellId } : {}),
			confidence,
			signal_type,
			addressToken: issued.token,
			addressTokenExpiresAt: issued.expiresAt
		});
	} catch (error) {
		console.error(
			'[Location Resolve] Error:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		return json(
			{ resolved: false, error: 'Location resolution service temporarily unavailable' },
			{ status: 500 }
		);
	}
};
