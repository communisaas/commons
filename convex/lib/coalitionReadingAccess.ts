/**
 * Reader-side access rule for the coalition empirical readings.
 *
 * `gds`, `ald`, `temporalEntropy` and `cai` are empirical coordination models.
 * They are permitted to PAYING organizations only — never to a message
 * recipient, never to a public page, never to a marketing surface. Coalition
 * membership is not a purchase: an org can hold an active membership row while
 * its own subscription sits at the unpaid floor, and a lapsed org keeps that
 * row indefinitely. So the read resolves the READER org's own plan every time.
 *
 * Redaction is added on top of authorization, never in place of it — the caller
 * still has to prove membership before anything is read. What a non-paying
 * member org keeps is everything that is not an empirical model: the roster,
 * the counts, the district count, the state distribution.
 *
 * The predicate is CLOCK-FREE, because it is called from a public Convex query
 * and a wall-clock read there defeats query caching and reactive invalidation.
 * The past-due runway is durable ROW STATE, not arithmetic on `now`: when a
 * subscription enters `past_due`, `convex/subscriptions.ts` schedules
 * `expirePastDueGrace` at the deadline, which patches the row to `canceled`;
 * `sweepPastDueGrace` is the bounded backstop that adopts any row the scheduler
 * missed. A row that still READS `past_due` is therefore inside its runway by
 * construction, so evaluating at `pastDueSince` is the same answer the clock
 * would give — and it stays stable until the row itself changes. This is the
 * shape the individual-authoring limit in `convex/templates.ts` already uses.
 *
 * Accepted residual: if the expiry scheduler is dead, an exhausted runway keeps
 * reading. That is the same residual `convex/templates.ts` already accepts, and
 * it fails toward a member org keeping a reading it was recently paying for —
 * never toward an unpaid org gaining one.
 *
 * The runway rule itself still lives in exactly one place: `effectivePlanWithGrace`
 * in `convex/_brandingGate.ts`. Nothing here re-derives the window length.
 */

import { effectivePlanWithGrace, type SubGraceLike } from '../_brandingGate';

/**
 * True when the reader org's subscription confers paid access. Evaluated at
 * `pastDueSince` for a row still carrying the `past_due` runway, and at the
 * epoch otherwise — where the `active`/`trialing`/absent arms of the rule do
 * not consult the instant at all. A `past_due` row with no `pastDueSince` has
 * no runway to stand on and fails closed.
 */
export function coalitionReadingsPermitted(sub: SubGraceLike): boolean {
	const evaluatedAt =
		sub?.status === 'past_due' && typeof sub.pastDueSince === 'number' ? sub.pastDueSince : 0;
	return effectivePlanWithGrace(sub, evaluatedAt) !== 'inactive';
}

/** The four empirical readings, and nothing else. */
export type CoalitionReadings = {
	gds: number | null;
	ald: number | null;
	temporalEntropy: number | null;
	cai: number | null;
};

/**
 * Return the stats untouched for a paying reader; otherwise null exactly the
 * four readings and pass every other field through unchanged.
 *
 * `readingsWithheld` is the discriminator the payload needs, and it carries
 * exactly one fact:
 *
 *  1. WITHHELD (`true`) covers only a reading that EXISTED and was routed
 *     behind payment. It is never claimed about data that was never produced.
 *  2. Four nulls that were never computed stay ABSENT — `readingsWithheld`
 *     reads `false` for the paid and the unpaid reader alike, because on that
 *     coalition there is nothing to withhold and nothing to sell.
 *  3. `null` on this path already means ABSENT ("never computed" — see
 *     `readCoalitionStats`), so without the discriminator a paid gate would be
 *     indistinguishable on the wire from a coalition whose models have not been
 *     computed yet. WITHHELD and ABSENT are different facts and have to render
 *     differently.
 *
 * A partially-computed coalition — any one of the four present — is still
 * withheld in full: the flag reports less, it never redacts less.
 */
export function redactCoalitionReadings<T extends CoalitionReadings>(
	stats: T,
	permitted: boolean
): T & { readingsWithheld: boolean } {
	if (permitted) return { ...stats, readingsWithheld: false };
	const anyReadingPresent =
		stats.gds !== null ||
		stats.ald !== null ||
		stats.temporalEntropy !== null ||
		stats.cai !== null;
	return {
		...stats,
		readingsWithheld: anyReadingPresent,
		gds: null,
		ald: null,
		temporalEntropy: null,
		cai: null
	};
}
