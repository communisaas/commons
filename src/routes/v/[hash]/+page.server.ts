/**
 * Verification Page Server Load
 *
 * Resolves a verification hash to sender verification data.
 * Currently returns the hash for display — full user lookup
 * will be added when Convex verification endpoint is built.
 */
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { hash } = params;

	if (!hash || hash.length < 6) {
		throw error(404, 'Invalid verification link');
	}

	// For now, return the hash — the page displays a static verification.
	// Future: query Convex for user verification state by hash prefix.
	return {
		hash,
		// Static verification data until backend endpoint exists
		verified: true,
		method: 'Commons verification',
		locationVerified: true,
		identityVerified: false,
		govCredential: false
	};
};
