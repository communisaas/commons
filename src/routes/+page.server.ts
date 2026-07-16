import type { PageServerLoad } from './$types';
import { FEATURES } from '$lib/config/features';

import { selectLandingSurface } from '$lib/core/topic/landing-surface';
import {
	getCachedPublicRelations,
	getCachedPublicTemplates
} from '$lib/server/public-template-queries';

export const load: PageServerLoad = async ({ depends, url, platform }) => {
	// Cache across client-side navigations — only re-fetch when invalidated
	depends('data:templates');
	const showGraph = selectLandingSurface(url) === 'graph';

	// Degrade gracefully: a transient SSR→Convex failure (e.g. an intermittent
	// connect-timeout) should render an empty homepage, not a hard 500. Mirrors
	// the guarded Convex calls in +layout.server.ts.
	const cacheContext = { url, platform };
	const templatesPromise = getCachedPublicTemplates(
		cacheContext,
		// Keep CWC templates out of public discovery until congressional launch.
		!FEATURES.CONGRESSIONAL
	).catch((err) => {
		console.error(
			'[Page] templates.listPublic failed (transient):',
			err instanceof Error ? err.message : String(err)
		);
		return [];
	});

	// One materialized relation read over the public set: measured twins plus tags
	// that cluster tightly in mean-centered space fold into one concept, and templates sharing
	// a tight concept get a subordinate `kind:'concept'` edge. The server-only tag
	// vectors are consumed there and never cross — only `{a,b,concept,kind}` tuples
	// and a tag→concept label map do. Guarded the same way as the edges above so a
	// transient Convex timeout degrades to no concept edges (the graph still paints
	// twin + family), never a hard 500. At a corpus too thin to form any tight
	// cross-template concept — the honest state at the seed, before tag embeddings
	// are backfilled — `edges` is simply empty, and the graph's concept legend item
	// stays hidden. That empty result is expected, not a failure.
	const relationsPromise = showGraph
		? getCachedPublicRelations(cacheContext).catch((err) => {
				console.error(
					'[Page] templates.publicDiscoveryRelations failed (transient):',
					err instanceof Error ? err.message : String(err)
				);
				return {
					twinEdges: [],
					conceptRelations: { edges: [], conceptMap: {} }
				};
			})
		: Promise.resolve({
				twinEdges: [],
				conceptRelations: { edges: [], conceptMap: {} }
			});

	// The list and combined-relation reads share one latency window. List and
	// spectrum surfaces skip the relation read entirely.
	const [templates, relations] = await Promise.all([templatesPromise, relationsPromise]);

	return {
		templates,
		relationEdges: relations.twinEdges,
		conceptRelations: relations.conceptRelations
	};
};
