import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getCachedPublicData } from '$lib/server/public-discovery-cache';

type PublicQueryContext = {
	url: URL;
	platform?: App.Platform;
};

/** Cached public template cards, separated by the congressional visibility gate. */
export function getCachedPublicTemplates(context: PublicQueryContext, excludeCwc: boolean) {
	return getCachedPublicData(`templates:exclude-cwc=${excludeCwc ? '1' : '0'}`, context, () =>
		serverQuery(api.templates.listPublic, { excludeCwc })
	);
}

/** Cached measured-twin snapshot. Contains no embedding vectors. */
export function getCachedRelatednessEdges(context: PublicQueryContext) {
	return getCachedPublicData('relations:twins', context, () =>
		serverQuery(api.templates.relatednessEdges, {})
	);
}

/** Cached tag-concept snapshot. Contains labels and edge tuples only. */
export function getCachedConceptRelations(context: PublicQueryContext) {
	return getCachedPublicData('relations:concepts', context, () =>
		serverQuery(api.templates.conceptRelations, {})
	);
}
