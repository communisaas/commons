import type { ContactRouteVerdict } from '$lib/core/agents/contact-route-verdict';
import {
	classifySeatRoute,
	compareTargetOrder,
	deriveRouteProvenance,
	type RouteProvenance,
	type SeatRouteVerdict,
	type StandingVerdict
} from '$lib/core/agents/seat-route';

/**
 * Display ordering for recipient rows, built on `compareTargetOrder` and on
 * MEASURED axes only.
 *
 * This module exists rather than living in `seat-route.ts` because
 * `tests/unit/agents/seat-route.test.ts` asserts that module's entire reachable
 * function surface is exactly four names; any helper added there fails that
 * lock. Nothing here mutates or re-exports that module.
 */

type RouteEvidenceInput = {
	name: string;
	email?: string;
	emailGrounded?: boolean;
	emailSource?: string;
	contactRoute?: ContactRouteVerdict;
};

export type RouteEvidence = {
	seatRoute: SeatRouteVerdict | undefined;
	routeProvenance: RouteProvenance;
};

/**
 * Derive, for one row, the two measured facts about how its address was
 * published. Pure: no env, no network, no `$lib/server` — identical on the
 * server render and in the browser.
 *
 * `classifySeatRoute` throws unless `candidateName` is an OWN key of the options
 * object (`seat-route.ts:110-112`), so the object literal is always passed
 * explicitly, never spread in conditionally.
 *
 * `deriveRouteProvenance` reads `input.contactRouteStatus ?? 'unknown'`
 * (`seat-route.ts:169`), so a row whose `contactRoute` is absent and a row
 * carrying the wire's `{ status: 'unknown' }` (`+server.ts:357`) agree exactly.
 */
export function routeEvidenceFor<T extends RouteEvidenceInput>(row: T): RouteEvidence {
	const seatRoute = classifySeatRoute(row.email, { candidateName: row.name });
	const routeProvenance = deriveRouteProvenance({
		seat: seatRoute,
		emailGrounded: row.emailGrounded,
		emailSource: row.emailSource,
		contactRouteStatus: row.contactRoute?.status
	});

	return { seatRoute, routeProvenance };
}

/**
 * `standing` reaches the comparator only on a MEASURED basis.
 *
 * (a) `deriveStanding` is called in exactly one place in this tree, with
 *     `{ title, roleCategory }` only (`src/lib/core/agents/agents/decision-maker.ts:893`),
 *     so 100% of production standings carry basis `title-inferred` or
 *     `model-inferred`.
 * (b) No producer anywhere feeds `pageStatedRole` or `registryRoleField`, the
 *     two measured bases. This branch is therefore unreachable today. It is kept
 *     to hold R3's contract open, not to rank anyone.
 * (c) `standing` is not even on the wire: the SSE projection at
 *     `src/routes/api/agents/stream-decision-makers/+server.ts:352-376` does not
 *     send it, so on the person path this guard is always false.
 *
 * Ordering people by a title regex would present an inference as a measurement —
 * the same defect this tree already removed from `measuredRouteRow`
 * (`src/lib/core/agents/reach-census.ts:112-120`).
 */
function measuredStanding(row: { standing?: StandingVerdict }): boolean {
	return row.standing?.basis === 'page-stated' || row.standing?.basis === 'registry-field';
}

/**
 * `clockRank` is NEVER passed. Nothing in the tree constructs an `inputWindow`:
 * the type is declared at `src/lib/types/template.ts:301`, passed through at
 * `src/lib/components/template/templateDraft.ts:331` and
 * `src/lib/components/org/studio/studio-draft-bridge.ts:47`, and rendered at
 * `DecisionMakerGrouped.svelte:291` — with zero producers. A comparator argument
 * that cannot discriminate is noise dressed as an axis.
 */

type OrderableRow = RouteEvidenceInput & { standing?: StandingVerdict };

/**
 * Order display rows by measured route provenance, stably and without mutating
 * or cloning anything.
 *
 * Returns a NEW array holding the SAME object references, so any index a caller
 * decorated onto a row (`originalIndex`) still addresses the source array.
 *
 * Stability is load-bearing, not incidental: a full tie is the common case
 * (single-provenance groups, all-ungrounded groups), and an unstable sort would
 * shuffle tied rows between the server render and hydration — a list that reads
 * as a ranking changing its mind. Hence decorate-with-index and a final
 * index tiebreak.
 */
export function orderTargetsForDisplay<T extends OrderableRow>(rows: readonly T[]): T[] {
	const decorated = rows.map((row, index) => ({ row, index, evidence: routeEvidenceFor(row) }));

	decorated.sort((a, b) => {
		const verdict = compareTargetOrder(
			{
				routeProvenance: a.evidence.routeProvenance,
				...(measuredStanding(a.row) ? { standing: a.row.standing } : {})
			},
			{
				routeProvenance: b.evidence.routeProvenance,
				...(measuredStanding(b.row) ? { standing: b.row.standing } : {})
			}
		);
		if (verdict !== 0) return verdict;
		return a.index - b.index;
	});

	return decorated.map((entry) => entry.row);
}
