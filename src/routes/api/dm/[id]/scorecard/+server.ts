import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { canonicalizeOrRedirect } from '$lib/server/canonical-slug';
import type { RequestHandler } from './$types';

/**
 * GET /api/dm/[id]/scorecard
 *
 * Public endpoint — no auth required.
 * Returns latest scorecard snapshot + 12-period history for a decision-maker.
 * Redirects 302 to the canonical-slug form when called with a Convex doc id.
 *
 * Response contract (informational; v1 stable):
 *   { canonicalSlug, decisionMaker, current, history }
 * `canonicalSlug` is the slug the redirect points to — consumers can use it
 * to canonicalize their own URL state without re-following the redirect.
 * Field added 2026-05-07 alongside the F-77/F-80 canonicalization cures.
 */
export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;

	const result = await serverQuery(api.v1api.getDmScorecard, {
		_secret: getInternalSecret(),
		identifier: id});
	if (!result) {
		throw error(404, 'Decision-maker not found');
	}

	canonicalizeOrRedirect(
		result.canonicalSlug,
		id,
		(slug) => `/api/dm/${slug}/scorecard`
	);

	return json(result);
};
