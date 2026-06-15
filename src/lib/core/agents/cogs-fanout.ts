/**
 * COGS-fanout guard for decision-maker resolution.
 *
 * Per-message COGS scales with the number of discovered roles/identities: each
 * role drives an Exa identity search, then a per-identity contact search, then
 * Firecrawl page reads, then chunked Gemini synthesis. Phase 1 (role discovery)
 * is an unbounded LLM enumeration — a broad subject can return many roles, and
 * the fanout (and its cost) grows ~linearly with that count. Without a bound a
 * single authoring run could exceed the budgeted ~$0.22 ceiling.
 *
 * This guard caps the role count BEFORE the fanout begins, so the downstream
 * Exa/Firecrawl/Gemini work is deterministically bounded regardless of how many
 * roles Phase 1 enumerates. It lives in its own module (no Gemini/Exa imports)
 * so the bound is unit-testable.
 *
 * Budget arithmetic (canonical prices in llm-cost-protection.ts API_PRICING):
 * - Firecrawl reads are already capped at 20 (~$0.106 at $0.0053/read).
 * - Exa searches: ~1 identity search + ~1 contact search per role
 *   (~$0.007 each at $7/1K). At the cap below the Exa spend is bounded to
 *   2 * MAX_DECISION_MAKER_FANOUT searches.
 * - Gemini synthesis: chunked 3 identities/call, so calls scale with the cap.
 *
 * MAX_DECISION_MAKER_FANOUT = 12 keeps the worst-case external-API spend
 * (~12*2 Exa ≈ $0.17 + 20 Firecrawl ≈ $0.106, minus cache hits) within the same
 * order as the ~$0.22 budgeted ceiling while still surfacing a useful breadth of
 * decision-makers. Guided/explicitly-targeted roles are kept first so a precise
 * audience request is never truncated in favor of speculative breadth.
 */
export const MAX_DECISION_MAKER_FANOUT = 12;

/**
 * Bound a list of discovered roles to the COGS fanout cap. Stable: keeps the
 * first `max` after sorting guided roles ahead of speculative ones (a guided
 * role is one the user explicitly steered toward via audience guidance). Pure —
 * does not mutate the input.
 */
export function capFanout<T extends { guided?: boolean }>(
	roles: T[],
	max: number = MAX_DECISION_MAKER_FANOUT
): T[] {
	if (roles.length <= max) return roles;
	// Guided roles first (preserve precise targeting), then the rest in order.
	const guided = roles.filter((r) => r.guided === true);
	const rest = roles.filter((r) => r.guided !== true);
	return [...guided, ...rest].slice(0, max);
}
