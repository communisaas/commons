/**
 * Denormalized supporter breakdown counters — single source of delta math.
 *
 * organizations.supporterStats backs the verification funnel + list-health
 * summary so those reads never scan the whole supporters table (the scan
 * throws once an org's roster passes the per-query document cap). The counters
 * stay exact only if EVERY writer that creates, deletes, or transitions a
 * counted supporter status applies the matching delta. To keep that math from
 * drifting between call sites, the arithmetic lives here once: every writer
 * calls `applySupporterStatsDelta(ctx, orgId, before, after)`.
 *
 *   - create: before = null, after = the inserted row's countable fields
 *   - delete: before = the row's countable fields, after = null
 *   - status transition: before = the pre-patch row, after = the post-patch row
 *
 * Every count is a per-supporter scalar tally, so a transition decrements the
 * old bucket and increments the new one. District-of-record is intentionally
 * NOT here: it is set cardinality (a supporter active in two districts would
 * double-count a scalar), and is served by a separate bounded query.
 */

import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

/**
 * The subset of supporter fields the counters are derived from. Accepts a
 * full supporter doc (extra fields ignored) or a hand-built shape at insert
 * time before the doc is read back.
 */
export interface CountableSupporter {
	emailStatus: string;
	smsStatus: string;
	source?: string;
	postalCode?: string;
	encryptedPhone?: string;
	phoneHash?: string;
	identityCommitment?: string;
	verified?: boolean;
	emailConsentSource?: string;
	emailConsentedAt?: number;
	emailConsentText?: string;
	smsConsentSource?: string;
	smsConsentedAt?: number;
	smsConsentText?: string;
}

export interface SupporterStats {
	identityVerified: number;
	postalResolved: number;
	phonePresent: number;
	emailSubscribed: number;
	emailUnsubscribed: number;
	emailBounced: number;
	emailComplained: number;
	smsSubscribed: number;
	smsUnsubscribed: number;
	smsStopped: number;
	smsNone: number;
	emailConsentEvidence: number;
	emailSubscribedConsentEvidence: number;
	smsConsentEvidence: number;
	smsSubscribedConsentEvidence: number;
	sourceCounts: Record<string, number>;
}

const SCALAR_KEYS = [
	'identityVerified',
	'postalResolved',
	'phonePresent',
	'emailSubscribed',
	'emailUnsubscribed',
	'emailBounced',
	'emailComplained',
	'smsSubscribed',
	'smsUnsubscribed',
	'smsStopped',
	'smsNone',
	'emailConsentEvidence',
	'emailSubscribedConsentEvidence',
	'smsConsentEvidence',
	'smsSubscribedConsentEvidence'
] as const;

type ScalarKey = (typeof SCALAR_KEYS)[number];

export function emptySupporterStats(): SupporterStats {
	return {
		identityVerified: 0,
		postalResolved: 0,
		phonePresent: 0,
		emailSubscribed: 0,
		emailUnsubscribed: 0,
		emailBounced: 0,
		emailComplained: 0,
		smsSubscribed: 0,
		smsUnsubscribed: 0,
		smsStopped: 0,
		smsNone: 0,
		emailConsentEvidence: 0,
		emailSubscribedConsentEvidence: 0,
		smsConsentEvidence: 0,
		smsSubscribedConsentEvidence: 0,
		sourceCounts: {}
	};
}

function sourceValue(s: CountableSupporter): string {
	const raw = typeof s.source === 'string' ? s.source.trim() : '';
	if (!raw) return 'unknown';
	// A user label must never equal the reserved overflow sentinel, or a real
	// source would be indistinguishable from the folded tail (and corrupt the
	// decrement). Remap the (vanishingly rare) collision to a visible label.
	return raw === OTHER_SOURCE_KEY ? 'other (label)' : raw;
}

/**
 * `source` is a user-controlled import label, so the distinct-source set is
 * unbounded in principle — left unchecked it grows the org document toward
 * Convex's ~1MB cap. Bound it: once the map holds MAX_SOURCE_KEYS distinct
 * sources, fold new ones into OTHER_SOURCE_KEY. The breakdown is display-only,
 * so an approximate tail is acceptable; the common handful of sources stay exact.
 *
 * OTHER_SOURCE_KEY is a sentinel (`__other__`) that real user input can't equal:
 * `sourceValue` trims and falls back to 'unknown', and a literal '__other__'
 * label would be indistinguishable from the fold bucket — using a sentinel that
 * is documented as reserved avoids a real source colliding with the overflow tail.
 *
 * The real-key set only GROWS (zero-count keys are never pruned — see
 * computeSupporterStats), so once a source has been folded into the sentinel the
 * map stays full and that source stays folded forever. This makes the decrement
 * heuristic unambiguous: a present key is decremented directly; an absent key
 * was provably folded, so the sentinel is decremented. The bound holds at
 * MAX_SOURCE_KEYS real keys + the single sentinel.
 */
const MAX_SOURCE_KEYS = 32;
const OTHER_SOURCE_KEY = '__other__';

/**
 * Read-boundary filter: strip zero-count source buckets before returning to the
 * UI. Because computeSupporterStats no longer prunes keys (the stable-fold
 * invariant requires a monotonically growing real-key set), a source whose
 * supporters were all deleted persists as `{ "csv": 0 }`. Filtering at the read
 * boundary keeps the breakdown display honest without re-introducing the
 * prune-induced decrement ambiguity. Sum-of-buckets still equals the active
 * total because zero buckets contribute nothing.
 */
export function visibleSourceCounts(sourceCounts: Record<string, number>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [key, count] of Object.entries(sourceCounts)) {
		if (count > 0) out[key] = count;
	}
	return out;
}

function hasEmailConsent(s: CountableSupporter): boolean {
	return Boolean(s.emailConsentSource || s.emailConsentedAt || s.emailConsentText);
}

function hasSmsConsent(s: CountableSupporter): boolean {
	return Boolean(s.smsConsentSource || s.smsConsentedAt || s.smsConsentText);
}

/**
 * The scalar contributions a single supporter makes to the breakdown. Used to
 * derive a +1 (create), -1 (delete), or transition (sub before, add after)
 * delta. Mirrors getSummaryStats' per-row tally exactly.
 */
function contributions(s: CountableSupporter): Record<ScalarKey, number> {
	const emailConsent = hasEmailConsent(s);
	const smsConsent = hasSmsConsent(s);
	return {
		identityVerified: s.identityCommitment && s.verified ? 1 : 0,
		postalResolved: s.postalCode ? 1 : 0,
		phonePresent: s.encryptedPhone || s.phoneHash ? 1 : 0,
		emailSubscribed: s.emailStatus === 'subscribed' ? 1 : 0,
		emailUnsubscribed: s.emailStatus === 'unsubscribed' ? 1 : 0,
		emailBounced: s.emailStatus === 'bounced' ? 1 : 0,
		emailComplained: s.emailStatus === 'complained' ? 1 : 0,
		smsSubscribed: s.smsStatus === 'subscribed' ? 1 : 0,
		smsUnsubscribed: s.smsStatus === 'unsubscribed' ? 1 : 0,
		smsStopped: s.smsStatus === 'stopped' ? 1 : 0,
		smsNone: s.smsStatus === 'none' ? 1 : 0,
		emailConsentEvidence: emailConsent ? 1 : 0,
		emailSubscribedConsentEvidence: emailConsent && s.emailStatus === 'subscribed' ? 1 : 0,
		smsConsentEvidence: smsConsent ? 1 : 0,
		smsSubscribedConsentEvidence: smsConsent && s.smsStatus === 'subscribed' ? 1 : 0
	};
}

/**
 * Compute the new stats from the current stats and a before/after supporter
 * pair. Pure — no ctx, no IO — so the delta math is unit-testable in isolation.
 * `before === null` is a create; `after === null` is a delete.
 *
 * Counts are clamped at 0 (Math.max). A defensively-clamped negative can only
 * happen if a counter was already drifted (e.g. a pre-existing org whose
 * supporterStats is being populated incrementally for the first time); clamping
 * keeps the funnel non-negative rather than surfacing a nonsense value.
 */
export function computeSupporterStats(
	current: SupporterStats | undefined,
	before: CountableSupporter | null,
	after: CountableSupporter | null
): SupporterStats {
	const next = current ? { ...current, sourceCounts: { ...current.sourceCounts } } : emptySupporterStats();

	const beforeC = before ? contributions(before) : null;
	const afterC = after ? contributions(after) : null;

	for (const key of SCALAR_KEYS) {
		let delta = 0;
		if (beforeC) delta -= beforeC[key];
		if (afterC) delta += afterC[key];
		if (delta !== 0) {
			next[key] = Math.max(0, next[key] + delta);
		}
	}

	// source is immutable after create, so in practice a transition leaves the
	// source unchanged (sub then add the same key → net zero). Handling it
	// generally still keeps the map correct if a writer ever changes source.
	if (before) {
		let key = sourceValue(before);
		// Stable fold: the real-key set never shrinks (we don't prune zeros), so
		// a key absent from the map was provably folded into the sentinel at
		// create time. Present key → decrement it directly; absent key → it was
		// folded, decrement the sentinel. No heuristic ambiguity: a real key
		// pruned-to-zero can never reappear as "absent" because we never prune.
		if (next.sourceCounts[key] === undefined) {
			key = OTHER_SOURCE_KEY;
		}
		next.sourceCounts[key] = Math.max(0, (next.sourceCounts[key] ?? 0) - 1);
		// Intentionally NOT deleting zero-count keys: a stable (monotonically
		// growing) real-key set is what makes the decrement above unambiguous.
		// Zero-count buckets are stripped at the READ boundary, not here.
	}
	if (after) {
		let key = sourceValue(after);
		// Bound the key space: a new source is folded into the sentinel once the
		// REAL-key set is full, so a messy/hostile import can't grow the org doc
		// unbounded. The sentinel itself doesn't count toward MAX_SOURCE_KEYS, so
		// the map is bounded at MAX_SOURCE_KEYS real keys + the single sentinel.
		if (next.sourceCounts[key] === undefined) {
			const realKeyCount =
				Object.keys(next.sourceCounts).length -
				(next.sourceCounts[OTHER_SOURCE_KEY] !== undefined ? 1 : 0);
			if (realKeyCount >= MAX_SOURCE_KEYS) {
				key = OTHER_SOURCE_KEY;
			}
		}
		next.sourceCounts[key] = (next.sourceCounts[key] ?? 0) + 1;
	}

	return next;
}

/**
 * Apply a supporter create/delete/transition to the org's denormalized
 * supporterStats. Reads the org, recomputes, patches. No-op if the org is gone
 * (a webhook can race a deleted org) so a missing org never throws a writer.
 */
export async function applySupporterStatsDelta(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	before: CountableSupporter | null,
	after: CountableSupporter | null
): Promise<void> {
	const org = await ctx.db.get(orgId);
	if (!org) return;
	const updated = computeSupporterStats(org.supporterStats, before, after);
	await ctx.db.patch(orgId, { supporterStats: updated });
}

/**
 * Batch variant for a single org: fold every before/after pair into the org's
 * stats and patch ONCE. A per-row patch inside a 5000-row import loop would do
 * 5000 org reads + writes; folding in memory does one of each.
 */
export async function applySupporterStatsDeltaBatch(
	ctx: MutationCtx,
	orgId: Id<'organizations'>,
	pairs: Array<{ before: CountableSupporter | null; after: CountableSupporter | null }>
): Promise<void> {
	if (pairs.length === 0) return;
	const org = await ctx.db.get(orgId);
	if (!org) return;
	let stats = org.supporterStats;
	for (const { before, after } of pairs) {
		stats = computeSupporterStats(stats, before, after);
	}
	await ctx.db.patch(orgId, { supporterStats: stats });
}
