/**
 * Landing surface selection.
 *
 * The landing page offers three browsing worlds over the same templates: the flat
 * geographic LIST with its side-by-side template preview (the default front door),
 * the relatedness GRAPH (a map whose edges are measured semantic twins + civic-family
 * kinship — an explicit opt-in), and the hue-ordered topical SPECTRUM (also an
 * explicit opt-in). Which one shows is derived purely from the URL, so the choice is
 * a function of the URL alone — addressable, shareable, and testable without
 * rendering the page. The page and its tests share this one source of truth rather
 * than each re-reading the parameters, so the default cannot silently drift apart
 * between them.
 *
 * The rules, in precedence order:
 *
 *   1. `?view=graph` opens the relatedness graph (a spatial surface kept as an
 *      explicit opt-in off the list default).
 *   2. `?view=spectrum` opens the hue-ordered topical spectrum (likewise opt-in).
 *   3. Anything else — an explicit `?view=list`, the back-compatible `?spectrum=0`,
 *      or no parameter at all — resolves to the list: it is the default front door,
 *      so a missing or malformed parameter lands the visitor on the list-and-preview
 *      surface rather than stranding them on a spatial map.
 */

/** The three discovery surfaces the landing can render. */
export type LandingSurface = 'graph' | 'spectrum' | 'list';

/** Resolve which discovery surface the landing renders for a given URL. */
export function selectLandingSurface(url: URL): LandingSurface {
	const view = url.searchParams.get('view');

	// The graph and the spectrum are explicit opt-ins off the list default.
	if (view === 'graph') return 'graph';
	if (view === 'spectrum') return 'spectrum';

	// The list-and-preview surface is the default front door; an explicit
	// `?view=list`, the back-compatible `?spectrum=0` opt-out, and any missing or
	// malformed parameter all fall through here — the visitor lands on the list
	// rather than being stranded on a spatial surface.
	return 'list';
}

/**
 * Whether the topical spectrum shows for this URL. Retained as the spectrum's own
 * predicate (true only on its explicit `?view=spectrum` opt-in, since the list is
 * the default) and expressed through {@link selectLandingSurface} so the two cannot
 * disagree.
 */
export function shouldShowSpectrum(url: URL): boolean {
	return selectLandingSurface(url) === 'spectrum';
}
