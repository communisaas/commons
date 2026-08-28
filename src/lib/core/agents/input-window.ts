/**
 * Input windows — the published deadline for submitting input to a decision
 * maker, carried as a third non-scoring fact alongside standing and provenance.
 *
 * Three rules hold this module together:
 *
 * 1. Grounding is byte containment. `open` or `closed` is reachable only when
 *    the caller hands over a date whose published phrase literally appears in
 *    page text fetched this run. No fuzzy matching, no stemming, no word
 *    boundary relaxation; normalization is exactly NFKC + whitespace-collapse +
 *    trim applied identically to both sides.
 * 2. Never infer a deadline nobody published. There is no default window, no
 *    "30 days", no "first Tuesday", no timezone guessing beyond the documented
 *    UTC end-of-published-day rule. A window we cannot ground stays
 *    `not_resolved`, and renderers print that rather than hiding the row.
 * 3. The clock is not a score. It is never folded into confidence, never
 *    summed, never multiplied into a scalar, and never rendered as colour.
 *
 * The module is deliberately dependency-free (no `$lib`, no `$convex`, no node
 * builtins) so it stays Workers-safe and cheap to pull into a Svelte component,
 * and it is network-free and total: every failed precondition returns the
 * shared `INPUT_WINDOW_NOT_RESOLVED` singleton. It takes its clock as an
 * argument rather than reading the ambient time, so it is deterministic.
 */

/**
 * Four states, deliberately distinct:
 *
 * - `not_resolved` — we never established whether a window exists. The default.
 * - `none_published` — we read the publisher's page and it names no deadline.
 * - `open` — a published last day that has not yet passed.
 * - `closed` — a published last day that has passed.
 *
 * `none_published` and `not_resolved` are different facts (we looked and found
 * nothing vs. we never looked) and must not be collapsed into one another.
 */
export type InputWindow =
	| { readonly state: 'not_resolved' }
	| { readonly state: 'none_published'; readonly source: string }
	| {
			readonly state: 'open';
			readonly closesOn: string;
			readonly publishedText: string;
			readonly source: string;
	  }
	| {
			readonly state: 'closed';
			readonly closedOn: string;
			readonly publishedText: string;
			readonly source: string;
	  };

/**
 * The single shared not-resolved value. Every failure path returns this exact
 * object, so callers and tests can compare by reference.
 */
export const INPUT_WINDOW_NOT_RESOLVED: InputWindow = Object.freeze({
	state: 'not_resolved'
} as const);

/**
 * The one normalization both sides of the containment check pass through.
 * NFKC folds compatibility forms (including U+00A0 to a plain space), the
 * `\s+` collapse handles wrapped and doubled whitespace, and trim removes the
 * edges. Nothing else — no case folding, no punctuation stripping.
 */
function norm(value: string): string {
	return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/**
 * URL policy diverges deliberately from `normalizedPublicSource`
 * (`convex/lib/publicRecipientProvenance.ts:56-73`). We adopt its https-only
 * half and reject `http:`, but we do NOT adopt its rejection of `search` and
 * `hash`: agenda and docket URLs legitimately carry query strings (Legistar
 * `MeetingDetail.aspx?ID=…`, regulations.gov docket links), and this `source`
 * never enters the HMAC signature domain in this module. Anything that later
 * crosses into the public attestation must re-pass that stricter check there.
 */
function isGroundedSource(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0) return false;
	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * An ISO calendar day, validated by shape and by round trip. The round trip is
 * what rejects dates that parse but do not exist ('2026-02-30' normalizes to
 * March 2), so a nonexistent day never becomes a deadline.
 */
function isCalendarDay(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Arguments for {@link resolveInputWindowFromPage}. Deliberately not exported —
 * the module's public surface is exactly the four functions, the union and the
 * singleton; callers that need this shape read it off the function via
 * `Parameters<typeof resolveInputWindowFromPage>[0]`.
 */
interface ResolveInputWindowFromPageInput {
	/** The deadline phrase exactly as the publisher wrote it. */
	readonly publishedText: string;
	/** The calendar day that phrase names, as `YYYY-MM-DD`. */
	readonly isoDate: string;
	/** The https page the phrase was read from. */
	readonly source: string;
	/** Text of that page as fetched this run. */
	readonly pageText: string;
	/** The comparison clock, supplied by the caller. */
	readonly asOf: Date;
}

/**
 * Resolve a window from a page read. Total: no failure path produces a
 * partially-built object, and an unmet precondition always yields the shared
 * `INPUT_WINDOW_NOT_RESOLVED` singleton.
 */
export function resolveInputWindowFromPage(input: ResolveInputWindowFromPageInput): InputWindow {
	const { publishedText, isoDate, source, pageText, asOf } = input;

	if (typeof publishedText !== 'string' || publishedText.trim().length === 0) {
		return INPUT_WINDOW_NOT_RESOLVED;
	}
	if (typeof pageText !== 'string') return INPUT_WINDOW_NOT_RESOLVED;
	if (!norm(pageText).includes(norm(publishedText))) return INPUT_WINDOW_NOT_RESOLVED;
	if (!isCalendarDay(isoDate)) return INPUT_WINDOW_NOT_RESOLVED;
	if (!isGroundedSource(source)) return INPUT_WINDOW_NOT_RESOLVED;
	if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) return INPUT_WINDOW_NOT_RESOLVED;

	const year = Number(isoDate.slice(0, 4));
	const month = Number(isoDate.slice(5, 7));
	const day = Number(isoDate.slice(8, 10));

	// Publishers name the last day they accept input, so the named day itself
	// counts as open.
	const endOfPublishedDayUtc = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
	if (asOf.getTime() <= endOfPublishedDayUtc) {
		return { state: 'open', closesOn: isoDate, publishedText, source };
	}
	return { state: 'closed', closedOn: isoDate, publishedText, source };
}

/**
 * The verdict for a page we read that names no deadline at all. Distinct from
 * `not_resolved`, which means we never established anything.
 */
export function inputWindowNonePublished(source: string): InputWindow {
	if (!isGroundedSource(source)) return INPUT_WINDOW_NOT_RESOLVED;
	return { state: 'none_published', source };
}

/**
 * The one rendering of a window. Four frozen strings, no colour, no urgency
 * vocabulary, no days-remaining. An absent window reads exactly like an
 * explicitly unresolved one, because they are the same fact to an author.
 */
export function formatInputWindow(window: InputWindow | undefined): string {
	const w: InputWindow = window ?? INPUT_WINDOW_NOT_RESOLVED;
	switch (w.state) {
		case 'not_resolved':
			return 'input window: not resolved';
		case 'none_published':
			return 'input window: none published';
		case 'open':
			return `input window: open until ${w.closesOn}`;
		case 'closed':
			return `input window: closed ${w.closedOn}`;
		default: {
			const _exhaustive: never = w;
			void _exhaustive;
			return 'input window: not resolved';
		}
	}
}

/**
 * An ordering bucket for the standing → clock → provenance sort. It is NOT a
 * score: it must never be rendered, never summed, and never multiplied into a
 * scalar.
 *
 * `none_published` and `not_resolved` deliberately share bucket 1 so that two
 * rows we cannot distinguish sort — and therefore render — as ties. `open` rows
 * are never sub-ranked by how soon they close.
 *
 * Seam: R3 owns `compareTargetOrder({ standing?, clockRank?: number,
 * routeProvenance? })` (`nodes/R3.md:241-242,297-298`), and this function is the
 * intended producer of that `clockRank`. This module writes no comparator and
 * calls none.
 */
export function inputWindowSortBucket(window: InputWindow | undefined): 0 | 1 | 2 {
	if (!window) return 1;
	switch (window.state) {
		case 'open':
			return 0;
		case 'closed':
			return 2;
		default:
			return 1;
	}
}
