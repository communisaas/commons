/**
 * Landing intent selection.
 *
 * The landing page can be entered with one of two intents over the same writing
 * surface: AUTHOR a new campaign (the default front door — write-new) or FIND an
 * existing campaign to join. Which one the visitor arrives on is derived purely
 * from the URL, so the choice is a function of the URL alone — addressable,
 * shareable, and testable without rendering the page. The page and its tests share
 * this one source of truth rather than each re-reading the parameters, so the
 * default cannot silently drift apart between them.
 *
 * The landing intent (find-existing vs author-new) is orthogonal to the landing
 * SURFACE (which browsing world shows — list/graph/spectrum, resolved by the
 * sibling `landing-surface.ts`): a visitor can arrive with either intent on any
 * surface.
 *
 * The rules, in precedence order:
 *
 *   1. `?intent=find` lands the visitor focused on finding an existing campaign —
 *      an explicit, shareable opt-in off the author default.
 *   2. Anything else — an explicit `?intent=author`, a missing parameter, or a
 *      malformed value — resolves to author: it is the default front door
 *      (write-new), so a missing or malformed parameter lands the visitor on the
 *      authoring surface rather than the find-focused one. The opt-in is
 *      case-sensitive, exactly like the surface util's `?view=` handling.
 */

/** The two front-door intents the landing can open on. */
export type LandingIntent = 'find' | 'author';

/** Resolve which front-door intent the landing opens on for a given URL. */
export function selectLandingIntent(url: URL): LandingIntent {
	const intent = url.searchParams.get('intent');

	// Finding an existing campaign is an explicit opt-in off the author default.
	if (intent === 'find') return 'find';

	// Authoring a new campaign is the default front door; an explicit
	// `?intent=author` and any missing or malformed parameter all fall through
	// here — the visitor lands on the writing surface rather than the
	// find-focused one.
	return 'author';
}
