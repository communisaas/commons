/**
 * COGS-fanout guard for decision-maker resolution.
 *
 * Per-message COGS scales with the number of discovered roles/identities: each
 * role drives an Exa identity search, then a per-identity contact search, then
 * Firecrawl page reads, then chunked Gemini synthesis. Phase 1 (role discovery)
 * is an unbounded LLM enumeration — a broad subject can return many roles, and
 * the fanout (and its cost) grows ~linearly with that count. Without a bound a
 * single authoring run could exceed the reviewed provider allowance.
 *
 * This guard caps the role count BEFORE the fanout begins, so the downstream
 * Exa/Firecrawl/Gemini work is deterministically bounded regardless of how many
 * roles Phase 1 enumerates. It lives in its own module (no Gemini/Exa imports)
 * so the bound is unit-testable.
 *
 * Exact retry-aware arithmetic lives in provider-call-envelope.ts. At 12
 * uncached roles it permits at most 72 Exa searches ($0.504 at $0.007), 24 Exa
 * contents pages ($0.024), 24 Firecrawl credits, 13 Gemini calls, one Groq call,
 * and an element-wise ceiling of 12 MX lookups across cache splits — MX is
 * bounded by an enforced distinct-domain ceiling, not by contact count, since
 * one DNS lookup serves every contact sharing a domain. No single execution
 * exceeds the separately enumerated 146-call scalar ceiling. The
 * shared UTC-month envelope is separately sized to keep
 * every operation mix inside Exa/Firecrawl launch allowances; it is not a
 * substitute for provider account Free-plan, billing-disabled, no-PAYG proof.
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
