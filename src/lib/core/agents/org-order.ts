/**
 * Display ordering for institution (organization) cards, and the sentence that
 * states the basis on screen.
 *
 * Lives beside `target-order.ts` so the whole display-order family has one home.
 * Pure: no env, no network, no `$lib/server` — identical on the server render and
 * in the browser.
 *
 * The locale is pinned rather than ambient on purpose: `new Intl.Collator(undefined, …)`
 * resolves against the host's locale, which is the SSR machine on the server render and
 * the reader's browser on hydration — the same list would be ordered two different ways
 * across that boundary. 'en' makes server and client agree byte-for-byte. The collator is
 * constructed once, at module scope, so no render path pays for it twice or gets a
 * differently-configured one.
 *
 * This order is arbitrary with respect to power BY DESIGN: no measured basis for
 * institutional standing exists in this tree. `deriveStanding`
 * (src/lib/core/agents/seat-route.ts:249-274) accepts two measured bases,
 * `pageStatedRole` and `registryRoleField`, and nothing in the pipeline produces
 * either — revisit this order when a producer for one of them lands. Because the
 * basis is arbitrary, it is printed on screen (ORG_ORDER_BASIS) rather than left
 * for a reader to infer a ranking from.
 *
 * Do not "improve" this with a model scalar. The model's relevance-rank field is the
 * tempting wrong answer: it is on the wire
 * (src/routes/api/agents/stream-decision-makers/+server.ts:372), it is named
 * "relevance", and it defaults to 99 for unrouted rows
 * (src/lib/core/agents/agents/decision-maker-accountability.ts:170) — sorting by it
 * would quietly sink exactly the rows a person most needs to judge. It is deliberately
 * not spelled out or imported here so a grep for it over this file stays empty.
 * Nothing counted, inferred, or scored may order these cards.
 */
const ORG_NAME_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Printed above the list whenever more than one institution is shown. */
export const ORG_ORDER_BASIS = 'Organizations are listed alphabetically. This is not a ranking.';

/** Shown in place of a name when the pipeline resolved no organization at all. */
export const UNRESOLVED_ORG_LABEL = 'Organization not resolved';

/**
 * Total order over organization labels. Strict: distinct raw strings never
 * compare equal, so sort stability can never leave the model's emission order
 * standing under an alphabetical caption.
 */
export function compareOrgLabels(a: string, b: string): number {
	// Unresolved organizations sort last as a block: an empty name is the least
	// identified institution and must not be handed the top of the screen, which is
	// where a bare locale compare would put it.
	const aEmpty = a.trim() === '';
	const bEmpty = b.trim() === '';
	if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
	const byName = ORG_NAME_COLLATOR.compare(a, b);
	if (byName !== 0) return byName;
	// `sensitivity: 'base'` returns 0 for distinct names that fold together
	// ('Cafe Board' vs 'Café Board' — two distinct groups, since the group key keeps
	// the raw characters). Without this tiebreak, sort stability would silently leave
	// them in the model's emission order while the caption claims alphabetical, so the
	// raw-string comparison is load-bearing, not cosmetic.
	return a < b ? -1 : a > b ? 1 : 0;
}
