import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/**
 * GET /api/embed/scorecard/[id]
 *
 * Public embed endpoint — returns lightweight JSON for external embedding.
 * Includes DM name, composite score, and link to full scorecard page.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const { id } = params;

	const result = await serverQuery(api.legislation.getDmScorecard, {
		identifier: id
	});
	if (!result) throw error(404, 'Decision-maker not found');

	// D-10: a scorecard is a shared (DM-scoped) entity, so white-label is opt-in
	// per embed via `?org=<slug>`. When the named org is on Coalition white-label,
	// the "powered by Commons" attribution is dropped from this OUTBOUND payload.
	// Absent / non-white-label org → Commons attribution stays. The /dm/[id]
	// scorecard PAGE itself keeps its Commons attestation regardless.
	const orgSlug = url.searchParams.get('org');
	let whiteLabel = false;
	if (orgSlug) {
		try {
			const branding = await serverQuery(api.organizations.getPublicBrandingBySlug, {
				slug: orgSlug
			});
			whiteLabel = branding?.whiteLabel ?? false;
		} catch {
			// Non-fatal — fall back to Commons attribution.
		}
	}

	// Embed consumers paste the URL into third-party pages where it is
	// effectively immutable; emit the canonical-slug form (CONSTITUTION.md
	// §1.3) regardless of what slug the caller supplied.
	const slug = result.canonicalSlug ?? id;
	const baseUrl = `${url.protocol}//${url.host}`;
	return json({
		decisionMaker: {
			id: result.decisionMaker._id,
			name: result.decisionMaker.name,
			title: result.decisionMaker.title,
			party: result.decisionMaker.party,
			district: result.decisionMaker.district
		},
		composite: result.current?.composite ?? null,
		responsiveness: result.current?.responsiveness ?? null,
		alignment: result.current?.alignment ?? null,
		period: result.current
			? {
					start: new Date(result.current.period.start).toISOString().slice(0, 10),
					end: new Date(result.current.period.end).toISOString().slice(0, 10)
				}
			: null,
		scorecardUrl: `${baseUrl}/dm/${slug}/scorecard`,
		// Omitted under white-label so embedders don't render Commons attribution.
		...(whiteLabel ? {} : { poweredBy: 'Commons' })
	});
};
