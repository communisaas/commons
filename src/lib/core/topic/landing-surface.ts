/**
 * Landing surface selection.
 *
 * The landing page offers three browsing worlds over the same templates: the
 * relatedness GRAPH (a map whose edges are measured semantic twins + civic-family
 * kinship — now the default), the hue-ordered topical SPECTRUM (an explicit opt-in),
 * and the flat geographic LIST (a working fallback kept reachable without a code
 * change). Which one shows is derived purely from the URL, so the choice is a
 * function of the URL alone — addressable, shareable, and testable without rendering
 * the page. The page and its tests share this one source of truth rather than each
 * re-reading the parameters, so the default cannot silently drift apart between them.
 *
 * The rules, in precedence order:
 *
 *   1. `?view=spectrum` opens the hue-ordered topical spectrum (the former default,
 *      kept as an explicit opt-in).
 *   2. `?view=list` — or the back-compatible `?spectrum=0` — opens the flat list.
 *   3. Anything else (an explicit `?view=graph`, or no parameter at all) resolves to
 *      the relatedness graph: it is the default front door, so a missing or malformed
 *      parameter lands the visitor on the map rather than stranding them elsewhere.
 */

/** The three discovery surfaces the landing can render. */
export type LandingSurface = 'graph' | 'spectrum' | 'list';

/** Resolve which discovery surface the landing renders for a given URL. */
export function selectLandingSurface(url: URL): LandingSurface {
	const view = url.searchParams.get('view');

	// The spectrum and the list are explicit opt-ins off the graph default. The
	// list keeps its back-compatible `?spectrum=0` opt-out alongside `?view=list`.
	if (view === 'spectrum') return 'spectrum';
	if (view === 'list' || url.searchParams.get('spectrum') === '0') return 'list';

	// The relatedness graph is the default front door; an explicit `?view=graph`
	// resolves here too, and so does a missing or malformed parameter — the visitor
	// lands on the map rather than being stranded on a fallback.
	return 'graph';
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
