/**
 * Landing surface selection.
 *
 * The landing page offers three browsing worlds over the same templates: the
 * relatedness GRAPH (a map whose edges are measured semantic twins + civic-family
 * kinship), the hue-ordered topical SPECTRUM (the current default), and the flat
 * geographic LIST (a working fallback kept reachable without a code change). Which
 * one shows is derived purely from the URL, so the choice is a function of the URL
 * alone — addressable, shareable, and testable without rendering the page. The
 * page and its tests share this one source of truth rather than each re-reading
 * the parameters, so the default cannot silently drift apart between them.
 *
 * The rules, in precedence order:
 *
 *   1. `?view=graph` opens the relatedness graph. It is the most explicit opt-in,
 *      so it wins over the spectrum/list toggle — the graph view-swap is reachable
 *      on its own regardless of the `spectrum` parameter.
 *   2. Otherwise the spectrum is the default, and the list opens ONLY on an
 *      explicit `?spectrum=0`. Any other `spectrum` value (or none) resolves to
 *      the spectrum, so the default cannot silently move and a typo never strands
 *      the visitor on the fallback.
 */

/** The three discovery surfaces the landing can render. */
export type LandingSurface = 'graph' | 'spectrum' | 'list';

/** Resolve which discovery surface the landing renders for a given URL. */
export function selectLandingSurface(url: URL): LandingSurface {
	// The relatedness graph is the most explicit opt-in — an active `view=graph`
	// wins over the orthogonal spectrum/list toggle so the map stays reachable on
	// its own. (The graph is not yet the default; that flip is a separate change.)
	if (url.searchParams.get('view') === 'graph') return 'graph';

	// Otherwise the spectrum is the default; the list opens only on the explicit
	// opt-out so neither a missing nor a malformed parameter strands the visitor.
	return url.searchParams.get('spectrum') === '0' ? 'list' : 'spectrum';
}

/**
 * Whether the topical spectrum shows for this URL. Retained as the spectrum's own
 * predicate (the spectrum is true unless an explicit opt-out or the graph view
 * swap takes over) and expressed through {@link selectLandingSurface} so the two
 * cannot disagree.
 */
export function shouldShowSpectrum(url: URL): boolean {
	return selectLandingSurface(url) === 'spectrum';
}
