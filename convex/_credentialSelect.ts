/**
 * Canonical active-credential selector.
 *
 * The operative invariant — "exactly one active districtCredential per user" —
 * is enforced by `verifyAddress` (revoke-prior-before-issue, atomic). If that
 * invariant ever breaks (mid-flight failure, concurrent writes, legacy drift),
 * two independently-ordered queries could previously pick DIFFERENT rows:
 *
 *   - `hasActiveDistrictCredential` used `.find()` on ascending `by_userId_expiresAt`
 *     (picking the oldest-expiring active row).
 *   - `getActiveCredentialDistrictCommitment` used descending order with a
 *     commitment filter (picking the latest-expiring commitment-bearing row).
 *
 * Same single-row input → same output; divergent multi-row input → split state.
 * KG-4 (re-grounding launch readiness) called this out as "brittle, safe only
 * because verifyAddress is atomic."
 *
 * This helper is the single point of truth. Both call sites route through it.
 * Canonical ordering: most-recently-issued active credential wins, with
 * `_creationTime` as deterministic tiebreak for same-millisecond issuances.
 */

import type { QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

/**
 * Return the single authoritative active districtCredential row for a user,
 * or null if none is active. "Active" means: revokedAt is unset AND expiresAt
 * lies in the future.
 *
 * Does NOT filter by `districtCommitment` presence — callers that require a
 * v2-style commitment-bearing credential must check the returned row's
 * `districtCommitment` field and surface CREDENTIAL_MIGRATION_REQUIRED if absent.
 * This keeps the "which row" decision separate from the "what does that row
 * support" decision.
 */
export async function selectActiveCredentialForUser(
	ctx: QueryCtx,
	userId: Id<'users'>,
	asOf: number
): Promise<Doc<'districtCredentials'> | null> {
	// The exact revokedAt=undefined prefix excludes every retired credential at
	// the storage layer. Ordering by issuedAt (then Convex's implicit
	// _creationTime suffix) gives one deterministic winner at constant
	// cardinality even if a legacy/concurrent-write drift left multiple rows
	// unrevoked. We deliberately do not fall back to an older row when the
	// canonical newest issuance is expired: resurrecting an older credential
	// would be a fail-open interpretation of inconsistent history.
	const credential = await ctx.db
		.query('districtCredentials')
		.withIndex('by_userId_revokedAt_issuedAt', (q) =>
			q.eq('userId', userId).eq('revokedAt', undefined)
		)
		.order('desc')
		.first();
	if (!credential || credential.expiresAt <= asOf) return null;
	return credential;
}
