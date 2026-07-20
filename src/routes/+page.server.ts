import type { PageServerLoad } from './$types';
import { FEATURES } from '$lib/config/features';

import { selectLandingSurface } from '$lib/core/topic/landing-surface';
import {
	getCachedPublicDiscoveryGraphSurface,
	getCachedPublicTemplates
} from '$lib/server/public-template-queries';

type PublicTemplates = Awaited<ReturnType<typeof getCachedPublicTemplates>>;
type PublicGraphRelations = Pick<
	Awaited<ReturnType<typeof getCachedPublicDiscoveryGraphSurface>>,
	'conceptRelations' | 'twinEdges'
>;

export const load: PageServerLoad = async ({ depends, setHeaders, url, platform }) => {
	// Cache across client-side navigations — only re-fetch when invalidated
	depends('data:templates');
	const showGraph = selectLandingSurface(url) === 'graph';
	const excludeCwc = !FEATURES.CONGRESSIONAL;

	// Degrade gracefully when the producer-published R2 generation is missing,
	// expired, or fails its public contract. Anonymous SSR never falls through to
	// Convex; an empty homepage is safer than inventing mixed cache authority.
	const cacheContext = { url, platform };
	let templatesLoadFailed = false;
	let templates: PublicTemplates = [];
	let relations: PublicGraphRelations = {
		twinEdges: [],
		conceptRelations: { edges: [], conceptMap: {} }
	};
	if (showGraph) {
		try {
			const graph = await getCachedPublicDiscoveryGraphSurface(cacheContext, excludeCwc);
			// Exact-deployment release probes use this as a direct assertion that
			// the atomic list+relations artifact was present and validated. It is
			// deliberately absent from every fallback/error response.
			setHeaders({
				'x-public-discovery-graph': 'ready',
				'x-public-discovery-graph-generation': graph.generation
			});
			templates = graph.templates;
			relations = {
				twinEdges: graph.twinEdges,
				conceptRelations: graph.conceptRelations
			};
		} catch (err) {
			templatesLoadFailed = true;
			console.error(
				'[Page] public discovery graph R2 publication unavailable:',
				err instanceof Error ? err.message : String(err)
			);
			// The graph is one atomic public artifact. Do not spend a third R2 read
			// or combine independently certified generations when it is missing.
		}
	} else {
		try {
			templates = await getCachedPublicTemplates(cacheContext, excludeCwc);
		} catch (err) {
			templatesLoadFailed = true;
			console.error(
				'[Page] public template-list R2 publication unavailable:',
				err instanceof Error ? err.message : String(err)
			);
		}
	}

	return {
		templates,
		templatesLoadFailed,
		relationEdges: relations.twinEdges,
		conceptRelations: relations.conceptRelations
	};
};
