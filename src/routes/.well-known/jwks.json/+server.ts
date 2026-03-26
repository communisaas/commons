/**
 * JWKS Endpoint — serves the public RSA key for Convex JWT verification.
 *
 * Convex's customJwt provider fetches this endpoint to get the public key
 * used to verify JWTs minted by SvelteKit's auth bridge.
 *
 * URL: https://commons.email/.well-known/jwks.json
 * Standard: RFC 7517 (JSON Web Key Set)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPublicJwk } from '$lib/server/convex-jwt';

export const GET: RequestHandler = async () => {
	const jwk = await getPublicJwk();

	if (!jwk) {
		// Key not configured — return empty key set.
		// Convex will reject all JWTs (expected when CONVEX_JWT_PRIVATE_KEY is unset).
		return json({ keys: [] }, {
			headers: {
				'Cache-Control': 'public, max-age=3600',
				'Access-Control-Allow-Origin': '*',
			},
		});
	}

	return json(
		{ keys: [jwk] },
		{
			headers: {
				// Cache for 1 hour — key rotation is rare, saves Convex from
				// fetching on every JWT verification.
				'Cache-Control': 'public, max-age=3600',
				// Convex cloud fetches cross-origin
				'Access-Control-Allow-Origin': '*',
			},
		}
	);
};
