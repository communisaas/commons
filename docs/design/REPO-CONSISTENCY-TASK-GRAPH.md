# Repo Consistency Task Graph

**Status:** consistency priorities implemented; repo-wide baseline remains red  
**Date:** 2026-05-01  
**Scope:** reconcile repository state after the Ground Vault PRF work so active UI,
runtime flags, docs, and verification gates describe the same system.

## Priorities

| Priority | Problem | Target State | Owner |
| --- | --- | --- | --- |
| P1-A | Repo-wide `npm run check` fails with a large baseline. | Burn down high-leverage first errors without broad refactors; record residual baseline honestly. | Check-health worker |
| P1-B | Congressional/CWC docs imply implementation while runtime flags hide the surface. | Runtime flags, route behavior, and status docs agree on launched vs launch-gated state. | Launch-state worker |
| P1-C | PRF unlock works only when a wrapper existed at address-save time. | Passkey registration can rewrap an active readable ground vault; unsupported PRF falls back to re-entry. | Vault worker |
| P2-A | Profile and design docs still contain rejected or ambiguous ground/trust copy. | Profile copy separates address readability from verification status; docs retire signal-strength framing. | Copy worker |
| P2-B | TEE docs still mix deployed and planned trust boundaries. | Active docs state `LocalConstituentResolver` is current; Nitro/TEE remains planned/scaffolded. | TEE worker |

## State Machines To Preserve

### Ground Vault

```text
absent
  -> pending_create
  -> unlocked
  -> locked
  -> rewrap_needed
  -> unavailable
  -> retired

unlocked + passkey_registered + prf_available
  -> wrapper_added
  -> unlockable_on_new_prf_capable_device

unlocked + passkey_registered + prf_unavailable
  -> readable_here_without_wrapper
  -> reentry_fallback_when_local_plaintext_lost
```

### Congressional Launch

```text
implemented_not_launched
  -> launch_gate_satisfied
  -> visible_templates
  -> tier4_proof_required
  -> cwc_delivery
```

The repo must not call a gated surface "live" unless the flag, route loaders,
verification path, and delivery boundary are all live together.

## Do/Review Gates

| Gate | Do | Review |
| --- | --- | --- |
| G1 | Patch the five independent priority slices with disjoint ownership. | Inspect diffs for ownership conflicts and state-machine regressions. |
| G2 | Run focused tests/greps for changed slices. | Confirm no deprecated identity-blob trajectory or stale copy remains in active paths. |
| G3 | Run repo-wide checks after focused gates. | Distinguish fixed errors from remaining baseline; do not claim global green unless true. |
| G4 | Brutalist review on changed architecture/code/docs. | Patch accepted findings or explicitly record why they are out of scope. |

## Cycle Ledger

| Cycle | Status | Findings | Review Result |
| --- | --- | --- | --- |
| 1 | Complete | Workers patched the five initial slices: CWC is explicitly launch-gated, passkey registration can backfill a PRF wrapper from readable local ground, profile copy uses readable/locked/re-entry language, TEE docs name `LocalConstituentResolver` as current, and first check-health errors were reduced. | Review found one PRF lifecycle bug: an old active wrapper could block wrapping for a newly registered passkey. Patched by retiring old wrappers when re-encrypting for the current passkey. Repo-wide check remains red. |
| 2 | Complete | Launch-state grep found two residual docs saying CWC was live/production: `docs/strategy/product-roadmap.md` and `docs/integration.md`. | Patched both to say implemented/launch-gated and removed current-flow TEE zeroization claims. Focused review gates pending. |
| 3 | Complete | Brutalist review found valid boundary issues: CWC launch gate existed only in UI/routes, profile serialized full vault/wrapper material, new ground writes left old vaults active, passkey removal left wrappers active, delivery comments still said TEE, and PRF backfill could trust mismatched local district text. | Patched `/api/submissions/create` with a backend launch gate, redacted profile ground state, retired superseded vaults/wrappers, revoked wrappers on passkey removal, aligned the template badge with Tier 4+, renamed delivery comments to resolver gates, and added a district-consistency guard before PRF backfill mutates the vault. |
| 4 | Complete | Focused gates passed: PRF/vault tests, profile component test, Convex codegen with typecheck disabled, diff whitespace, and stale-copy/TEE/CWC/profile-secret greps. | Repo-wide `npm run check` still fails on the existing baseline. First failures are Convex deep type-instantiation in `_rateLimit.ts`, `analytics.ts`, and `authOps.ts`, followed by stale broader Convex/test/source diagnostics. This graph is complete for the identified consistency priorities but not a global typecheck burn-down. |
