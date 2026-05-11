/**
 * Trust-tier prop clamp — defense-in-depth at the gate/component boundary.
 *
 * Tier props (`minimumTier`, `userTrustTier`) flow through Svelte props from
 * arbitrary callers — modal-data payloads cast loosely via
 * `as number | undefined`, session JWTs derived from Convex queries with
 * contract-drift risk, programmatic test fixtures. JavaScript's `>=`
 * coerces silently: `"2" >= 2`, `Infinity >= 2`, `0.5 >= 2` all evaluate to
 * `true` and would route around verification-decision logic.
 *
 * `clampTier(value, fallback)` enforces the documented [0,5] integer ladder
 * at the boundary. Anything outside collapses to `fallback`, which callers
 * should pick conservatively:
 *   - For `minimumTier`: pass `5` (strictest reading — assume the gating
 *     action demands the highest credential).
 *   - For `userTrustTier`: pass `0` (most-anonymous — never claim the user
 *     has more credential than the substrate proves).
 *
 * Used by `GovernmentCredentialVerification.svelte` and
 * `VerificationGate.svelte`; share via this module rather than duplicating
 * the contract across components.
 */
export function clampTier(value: number, fallback: number): number {
	if (!Number.isInteger(value) || value < 0 || value > 5) return fallback;
	return value;
}
