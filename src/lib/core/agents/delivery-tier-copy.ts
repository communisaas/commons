/**
 * Human copy for one delivery tier. It never turns the tier into a grade.
 *
 * DOWNGRADE-ONLY. The tier that reaches a rendering surface has travelled
 * through a persisted `recipient_config` written by the author's own client,
 * and the request envelope only length-caps the field
 * (`src/lib/server/agent-request-envelope.ts:243`) — it never checks the value.
 * A persisted tier is therefore a claim, not a measurement
 * (`src/lib/types/template.ts:313`: "Never trusted from client input").
 *
 * So this module speaks only about the restrictive case: a sentence for `'C'`,
 * and nothing at all for `'A'`, `'B'`, an unrecognised value, or absence. A
 * forged `'A'` buys silence — exactly the pixels of no data — and can never
 * manufacture a positive claim. Absence is likewise no statement, not a zero
 * and not a reassurance.
 *
 * The runtime checks are plain string comparisons against `unknown` on purpose;
 * the `DeliveryTier` type is imported for documentation only, because the value
 * arriving here is not known to be well-typed.
 */

import type { DeliveryTier } from '$lib/core/agents/target-class';

/** The one tier this module is willing to say anything about. */
const UNESTABLISHED: DeliveryTier = 'C';

/**
 * One sentence for the restrictive tier, `null` for everything else.
 *
 * The sentence names what was not established without calling the address
 * unverified or untrusted — the mailbox may be perfectly real; what is missing
 * is evidence that the institution publishes it as a channel for this decision.
 * It never renders the tier letter and never echoes the internal `reason` code.
 */
export function describeDeliveryTier(tier: unknown): string | null {
	if (tier !== UNESTABLISHED) return null;
	return 'This address was not established as an official channel for this decision.';
}

/**
 * How many entries carry the restrictive tier. Tolerant of non-objects, missing
 * fields, and a missing list; it never throws, because the array it counts is
 * client-supplied and may hold anything.
 */
export function countUnestablishedTargets(list: readonly unknown[] | undefined): number {
	if (!Array.isArray(list)) return 0;
	let count = 0;
	for (const entry of list) {
		if (typeof entry !== 'object' || entry === null) continue;
		if ((entry as { deliveryTier?: unknown }).deliveryTier === UNESTABLISHED) count += 1;
	}
	return count;
}
