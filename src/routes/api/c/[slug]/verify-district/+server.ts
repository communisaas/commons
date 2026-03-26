// CONVEX: Keep SvelteKit — Shadow Atlas proxy (resolveAddress: self-hosted Nominatim geocoding
// + R-tree district lookup), rate limiting (IP-based), address validation (zod).
import { json } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { FEATURES } from '$lib/config/features';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { resolveAddress } from '$lib/core/shadow-atlas/client';

/**
 * POST /api/c/[slug]/verify-district
 *
 * Public (unauthenticated) district verification for campaign action flow.
 * Resolves address to congressional district via Shadow Atlas (self-hosted).
 *
 * Gated behind FEATURES.ADDRESS_SPECIFICITY === 'district'.
 * Rate limited: 5 req/min per IP (matches /api/location/ pattern).
 *
 * PRIVACY:
 * - Logs only district code, never address.
 * - Returns only district code — no officials, no coordinates.
 * - Campaign ID validated to prevent blind enumeration.
 */

const addressSchema = z.object({
	street: z.string().min(1).max(200),
	city: z.string().min(1).max(100),
	state: z.string().length(2),
	zip: z.string().regex(/^\d{5}(-\d{4})?$/)
});

export const POST: RequestHandler = async ({ request, params, getClientAddress }) => {
	// Gate: only available when district verification is enabled
	if (FEATURES.ADDRESS_SPECIFICITY !== 'district') {
		return json({ resolved: false, error: 'District verification is not enabled' }, { status: 404 });
	}

	// Rate limit: 5 requests per minute per IP
	const ip = getClientAddress();
	const rlKey = `ratelimit:campaign-verify-district:${ip}`;
	const rl = await getRateLimiter().check(rlKey, { maxRequests: 5, windowMs: 60_000 });
	if (!rl.allowed) {
		return json({ resolved: false, error: 'Too many requests. Please try again later.' }, { status: 429 });
	}

	// Validate campaign exists (prevents blind address enumeration)
	const campaign = await db.campaign.findFirst({
		where: { id: params.slug, status: 'ACTIVE' },
		select: { id: true }
	});

	if (!campaign) {
		return json({ resolved: false, error: 'Campaign not found' }, { status: 404 });
	}

	try {
		const body = await request.json();

		const parseResult = addressSchema.safeParse(body);
		if (!parseResult.success) {
			return json(
				{ resolved: false, error: 'Invalid address', details: parseResult.error.issues.map(i => i.message) },
				{ status: 400 }
			);
		}

		const { street, city, state, zip } = parseResult.data;

		// Shadow Atlas: self-hosted Nominatim geocoding + R-tree district lookup
		const result = await resolveAddress({ street, city, state, zip });

		const districtCode = result.officials?.district_code ?? null;
		const stateCode = result.officials?.state ?? state.toUpperCase();

		if (!districtCode) {
			return json({ resolved: false, error: 'Congressional district could not be determined.' });
		}

		console.info(`[verify-district] Resolved district=${districtCode} campaign=${params.slug}`);

		return json({
			resolved: true,
			district: {
				code: districtCode,
				state: stateCode
			}
		});
	} catch (err) {
		console.error(
			'[verify-district] Error:',
			err instanceof Error ? err.message : 'Unknown error'
		);
		return json(
			{ resolved: false, error: 'Address resolution service temporarily unavailable' },
			{ status: 500 }
		);
	}
};
