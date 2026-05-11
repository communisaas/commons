/**
 * PATCH /api/org/[slug]/campaigns/targeting — Update campaign geographic targeting.
 * Requires editor+ role.
 */

import { json, error } from '@sveltejs/kit';
import { VALID_JURISDICTIONS, VALID_COUNTRY_CODES } from '$lib/server/geographic/types';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const { campaignId, targetJurisdiction, targetCountry } = body;

	// Convex doc ids are typically 32 chars; cap at 64.
	if (!campaignId || typeof campaignId !== 'string' || campaignId.length > 64) {
		throw error(400, 'campaignId is required (≤64 characters)');
	}

	// Validate jurisdiction if provided
	if (targetJurisdiction !== undefined && targetJurisdiction !== null) {
		if (!VALID_JURISDICTIONS.includes(targetJurisdiction)) {
			throw error(400, `Invalid jurisdiction: ${targetJurisdiction}`);
		}
	}

	// Validate country if provided
	if (targetCountry !== undefined) {
		if (!VALID_COUNTRY_CODES.includes(targetCountry)) {
			throw error(400, `Invalid country code: ${targetCountry}`);
		}
	}

	if (targetJurisdiction === undefined && targetCountry === undefined) {
		throw error(400, 'No targeting fields provided');
	}

	await serverMutation(api.campaigns.update, {
		campaignId: campaignId as Id<'campaigns'>,
		slug: params.slug,
		...(targetJurisdiction !== undefined ? { targetJurisdiction } : {})
	});
	return json({ success: true, data: { id: campaignId, targetJurisdiction, targetCountry } });
};
