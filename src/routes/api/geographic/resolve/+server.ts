/**
 * POST /api/geographic/resolve — Resolve international postcode/postal code to district + representatives.
 * Public endpoint (no auth required). Rate limited 10 req/min per IP.
 * US resolution uses /api/shadow-atlas/bubble — this endpoint is for GB/CA/AU.
 */

import { json } from '@sveltejs/kit';
import {
	LIVE_RESOLVER_COUNTRIES,
	SUPPORTED_RESOLVER_COUNTRIES
} from '$lib/server/geographic/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { countryCode, input } = body;

	if (!countryCode || !input) {
		return json({ error: 'countryCode and input are required' }, { status: 400 });
	}

	if (!SUPPORTED_RESOLVER_COUNTRIES.includes(countryCode)) {
		return json(
			{
				error: `Unsupported country: ${countryCode}. Supported: ${SUPPORTED_RESOLVER_COUNTRIES.join(', ')}`
			},
			{ status: 400 }
		);
	}

	if (countryCode === 'US') {
		return json(
			{ error: 'US resolution uses /api/shadow-atlas/bubble endpoint' },
			{ status: 400 }
		);
	}

	// Non-US countries are SUPPORTED at the resolver level (postcode → district
	// works) but `lookupRepresentatives` is unimplemented for them, and the
	// jurisdiction-specific legal-compliance work hasn't been scoped. Returning
	// a successful response with `representatives: []` would dress up an
	// inactive flow as success and accept legal exposure for users we can't
	// actually serve. Reject until the country is promoted to LIVE.
	if (!LIVE_RESOLVER_COUNTRIES.includes(countryCode)) {
		return json(
			{
				error: `District resolution for ${countryCode} is not yet available. Currently live: ${LIVE_RESOLVER_COUNTRIES.join(', ')}.`,
				code: 'COUNTRY_NOT_LIVE'
			},
			{ status: 503 }
		);
	}

	if (typeof input !== 'string' || input.length > 20) {
		return json({ error: 'Input must be a string of 20 characters or fewer' }, { status: 400 });
	}

	try {
		const { resolveDistrict } = await import('$lib/core/location/resolvers');
		const result = await resolveDistrict(countryCode, input);

		const { lookupRepresentatives } = await import('$lib/server/geographic/rep-lookup');
		const representatives = await lookupRepresentatives(countryCode, result.districtId);

		return json({
			success: true,
			data: {
				district: result,
				representatives
			}
		});
	} catch (error) {
		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			(error as { code?: unknown }).code === 'REP_LOOKUP_NOT_CONFIGURED'
		) {
			return json(
				{
					error:
						error instanceof Error
							? error.message
							: 'Representative lookup is not configured for this country.',
					code: 'REP_LOOKUP_NOT_CONFIGURED'
				},
				{ status: 503 }
			);
		}
		return json({ error: 'Could not resolve district for the given input' }, { status: 422 });
	}
};
