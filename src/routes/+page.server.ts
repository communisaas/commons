import type { PageServerLoad } from './$types';
import { FEATURES } from '$lib/config/features';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ depends }) => {
	// Cache across client-side navigations — only re-fetch when invalidated
	depends('data:templates');

	// Degrade gracefully: a transient SSR→Convex failure (e.g. an intermittent
	// connect-timeout) should render an empty homepage, not a hard 500. Mirrors
	// the guarded Convex calls in +layout.server.ts.
	const templates = await serverQuery(api.templates.listPublic, {
		// Keep CWC templates out of public discovery until congressional launch.
		excludeCwc: !FEATURES.CONGRESSIONAL
	}).catch((err) => {
		console.error(
			'[Page] templates.listPublic failed (transient):',
			err instanceof Error ? err.message : String(err)
		);
		return [];
	});

	// The measured-twin relatedness edges over the public set. The server-only
	// embeddings stay server-only — this returns ONLY {a, b, score, kind} tuples
	// keyed by template id, never a vector. Guarded the same way as the templates
	// load so a transient Convex timeout degrades to a no-edge map (every template
	// honestly alone), never a hard 500.
	const relationEdges = await serverQuery(api.templates.relatednessEdges, {}).catch((err) => {
		console.error(
			'[Page] templates.relatednessEdges failed (transient):',
			err instanceof Error ? err.message : String(err)
		);
		return [];
	});

	// The shared-concept relations over the same public set: tags that cluster
	// tightly in mean-centered space fold into one concept, and templates sharing
	// a tight concept get a subordinate `kind:'concept'` edge. The server-only tag
	// vectors are consumed there and never cross — only `{a,b,concept,kind}` tuples
	// and a tag→concept label map do. Guarded the same way as the edges above so a
	// transient Convex timeout degrades to no concept edges (the graph still paints
	// twin + family), never a hard 500. At a corpus too thin to form any tight
	// cross-template concept — the honest state at the seed, before tag embeddings
	// are backfilled — `edges` is simply empty, and the graph's concept legend item
	// stays hidden. That empty result is expected, not a failure.
	const conceptRelations = await serverQuery(api.templates.conceptRelations, {}).catch((err) => {
		console.error(
			'[Page] templates.conceptRelations failed (transient):',
			err instanceof Error ? err.message : String(err)
		);
		return { edges: [], conceptMap: {} };
	});

	return { templates, relationEdges, conceptRelations };
};
