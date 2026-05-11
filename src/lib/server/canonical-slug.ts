import { redirect } from '@sveltejs/kit';

// Redirect to the canonical-slug form when the request slug differs.
// Resolves the F-84 duplication across /dm/[id], /accountability/[id],
// /dm/[id]/scorecard, and /api/dm/[id]/scorecard. 302 (not 301) bounds CDN
// cache exposure if the slug-priority chain is ever extended (a future
// externalId acquisition could shift the canonical form for a given DM).
//
// CONSTITUTION.md §1.3 permanence over product cycles — public URLs do not
// encode storage ids; storage-id slugs canonicalize to the implementation-
// stable externalId form (bioguide → constituency → openstates → wikidata).
//
// `buildPath` receives the canonical slug already URI-encoded so callers do
// not have to remember the defensive wrap.
export function canonicalizeOrRedirect(
	canonical: string | null,
	requested: string,
	buildPath: (slug: string) => string
): void {
	if (canonical && canonical !== requested) {
		throw redirect(302, buildPath(encodeURIComponent(canonical)));
	}
}
