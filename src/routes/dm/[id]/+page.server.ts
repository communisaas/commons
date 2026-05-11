import { error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { canonicalizeOrRedirect } from '$lib/server/canonical-slug';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { id } = params;

	// `getDmPublicProfile` accepts either an externalId (bioguide / constituency /
	// openstates / wikidata) or a Convex `decisionMakers` doc id via `identifier`.
	// The function returns `canonicalSlug` (the implementation-stable public form
	// — bioguide preferred, falling through the externalId priority chain) when
	// one exists; redirect when the request slug differs so public URLs in the
	// public record do not encode internal storage ids (CONSTITUTION.md §1.3
	// permanence over product cycles).
	const result = await serverQuery(api.legislation.getDmPublicProfile, { identifier: id });

	if (!result) {
		throw error(404, 'Decision-maker not found');
	}

	canonicalizeOrRedirect(result.canonicalSlug, id, (slug) => `/dm/${slug}`);

	return {
		routeIdentifier: id,
		decisionMakerId: result.decisionMakerId,
		decisionMaker: result.decisionMaker,
		summary: result.summary,
		bills: result.bills
	};
};
