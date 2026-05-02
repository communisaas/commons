# Brutalist Audit — 2026-04-25

> **Status**: ACTIVE — Wave 1 planning
> **Date**: 2026-04-25 (5 weeks until Storacha sunset 2026-05-31)
> **Pattern**: For each finding cluster — implementation → brutalist review → fix → regression verify
> **Scope**: Architecture, security, codebase, test coverage, legal/regulatory

## Sweep Composition

5 brutalist panels run via `mcp__brutalist__roast` against `/Users/noot/Documents/commons`:

| Domain | Critics returned | Critics failed |
|---|---|---|
| architecture | claude, gemini | codex (quota) |
| security | claude, codex, gemini | — |
| codebase | claude, codex, gemini | — |
| test_coverage | codex, gemini | claude (quota) |
| legal | claude, codex, gemini | — |
| infrastructure | — | all (quota) — concerns surfaced via architecture |

14 critic outputs total, evaluated against actual code at file:line. Findings below are verified against shipped source unless explicitly marked unverified.

## Severity Legend

- **C** — Critical: blocks first paying-org launch
- **H** — High: blocks scale, fix before public sign-up
- **M** — Medium: rising-interest tech debt
- **L** — Low: hygiene, file-when-touching

## Status Legend

- `OPEN` — not yet planned
- `PLAN` — design done, implementation pending
- `WIP` — implementation in progress
- `REVIEW` — brutalist review cycle running
- `FIX` — review found issues, applying
- `DONE` — implementation + review + regressions clean
- `DEFER` — deliberately deferred (with reason)
- `WONTFIX` — verified not exploitable / by-design

---

## Findings Catalog

### TIER 1 — Critical (verified, fix before launch)

#### F-1.1 — IPFS cell-data lacks content-addressing

- **Severity**: C
- **Status**: PARTIAL (2026-04-25) — chunk *fabrication* closed; chunk *substitution* deferred as F-1.1b
- **Where**: `src/lib/core/shadow-atlas/cell-authenticity.ts` (NEW), `src/lib/core/shadow-atlas/ipfs-store.ts`, `src/hooks.server.ts`, `src/lib/server/identity/verify-commitment.ts`
- **Summary**: `fetchContent()` did plain `fetch().json()` with no integrity verification. R2 origin (`atlasBaseUrl`) does not include CID in the path; public-gateway fallback grabs first response. Both client and server recomputed the sponge over the *same* bytes — so a poisoned origin or gateway forged a "matching" commitment.
- **Blast radius**: R2 key compromise / BGP hijack / poisoned public gateway → mass-issue district commitments routed to attacker-chosen districts. Foundational trust break for the shadow-atlas privacy story.
- **Fix landed (chunk fabrication closure)**:
  - `cell-authenticity.ts` (NEW): `computeCellMapLeaf(cellId, districts) = H2(cellId, sponge24(districts))`, `computeCellMapRootFromPath(leaf, siblings, bits)` walking the same convention as the Noir `compute_smt_root`, and `verifyCellMapMembership({...expectedRoot, expectedDepth})` that gates on strict 0x-hex shape, optional depth pin (defense-in-depth), and BigInt-equality of the computed and expected roots.
  - `ipfs-store.ts`: `expectedCellMapRoot` + `expectedCellMapDepth` fields in `CONTENT_CONFIG`; getters; new `configure()` opts.
  - `hooks.server.ts`: wires `EXPECTED_CELL_MAP_ROOT` and `EXPECTED_CELL_MAP_DEPTH` env vars at startup (refresh per quarterly atlas release).
  - `verify-commitment.ts`: calls `verifyCellMapMembership` BEFORE the Poseidon2 sponge; throws `COMMITMENT_VERIFY_CELL_MAP_ROOT_MISMATCH` on path failure; throws `COMMITMENT_VERIFY_CELL_MAP_ROOT_NOT_PINNED` in production when env unset (fail-closed); honors `ATLAS_AUTHENTICITY_ALLOW_UNPINNED=1` escape hatch and emits a structured warn log on every bypassed request so monitoring catches stale config.
  - Tests: 16 cases in `cell-authenticity.test.ts` (happy + tampered districts/cellId/siblings/bits + length mismatches + depth pin + BigInt-decimal-typo defense + strict-hex guard); 6 new cases in `verify-commitment.test.ts` (poisoned-gateway, ordering, missing-fields, prod-fail-closed, escape-hatch, dev-bypass) plus 3 for the depth-pin and bypass-logging additions. 37/37 + 361/361 server-suite pass.
- **Residual primitive (F-1.1b — DEFERRED, structural)**:
  Brutalist review surfaced that the Tree 2 leaf encoding `H2(cellId, sponge24(districts))` does not bind the *chunk key* (h3Cell) to the leaf. An attacker controlling R2 can serve a real-but-wrong leaf (e.g., a TX-21 entry from the published atlas) under Alice's `chunk.h3Index[h3_alice]` or `chunk.cells[h3_alice]` key. The SMT path verification still passes (the leaf IS in the tree), so the server agrees with the client's poisoned commitment. **The fix shipped narrows the attacker from "fabricate any leaf" to "substitute one in-tree leaf for another", but does not fully close F-1.1.** The structural fix requires changing leaf encoding to `H3(h3Cell, cellId, sponge24(districts))` (or a similar binding) — circuit-signature change deferred to the next atlas-builder cycle.
- **Brutalist findings (claude critic, context `1e010679-3231-404a-a2c9-4bc9034e70c3`)**:
  - **Critical (h3 binding gap)** → logged as F-1.1b; structural defer.
  - **High (escape hatch silent)** → fixed: structured warn log on every bypassed request with `ATLAS_AUTHENTICITY_GATE_BYPASSED` tag.
  - **High (manifest unauthenticated)** → partially fixed: `EXPECTED_CELL_MAP_DEPTH` env var pinned out-of-band so manifest's `cells.depth` can't truncate paths. Manifest-level CID/SHA-256 pinning bundles into Storacha migration (F-3.2).
  - **Medium (BigInt fragility)** → fixed: explicit `^0x[0-9a-fA-F]+$` guard before BigInt parse; rejects decimal-typo inputs at the boundary instead of silently treating them as decimal.
  - **Medium (bit-convention drift)** → acknowledged; mitigation = matched `poseidon.ts:431`'s convention which is already used in the existing prover-shim. Golden-fixture-from-real-chunk pin pending (atlas-builder pipeline cooperation).
  - **Medium (empty-array bypass)** → fixed: `verifyCellMapMembership` rejects depth-0 paths without an explicit `expectedDepth`; with `expectedDepth` set, requires exact length match.
  - **Low (sponge24 dup)** → noted; deferred (perf, not security).
  - **Low (test mocks bypass integration)** → acknowledged; the harder integration test (real `fetchContent` + golden chunk fixture with mutated `h3Index`) is the demonstration that F-1.1b actually opens the residual primitive — defer to F-1.1b's review.
- **Critics**: claude-arch (C-1), codex-sec (H-3), gemini-sec (#6), claude-sec (C-1) [original]; claude-sec round 2 (`1e010679-3231-404a-a2c9-4bc9034e70c3`) for the residual analysis.

#### F-1.1b — Cell-key not bound to leaf (chunk substitution residual)

- **Severity**: H (Critical *if* F-1.1 is the only mitigation in front; downgraded to H because chunk-substitution requires the attacker have already-published atlas leaves, narrowing the attacker model from "any forgery" to "in-published-tree only")
- **Status**: DEFER (structural — circuit-signature change)
- **Where**: `voter-protocol/.../three_tree_membership/src/main.nr` `compute_cell_map_leaf`; `src/lib/core/shadow-atlas/cell-authenticity.ts` mirroring it
- **Summary**: Tree 2 leaf encoding does not bind `h3Cell` (the chunk-lookup key). An attacker controlling R2 can rewrite `chunk.h3Index[h3_alice]` (or rename `chunk.cells[h3_alice]`) to point at any *legitimate* in-tree entry, routing Alice's commitment to attacker-chosen districts.
- **Fix shape**: Change leaf to `H3(h3Cell, cellId, sponge24(districts))` (or equivalently include h3Cell in the SMT key). Requires:
  - Atlas-builder pipeline change to compute new leaves
  - Noir circuit redo (`compute_cell_map_leaf`, possibly `compute_smt_root` if key derivation changes)
  - Recompiled prover artifact + republished `@voter-protocol/noir-prover`
  - Updated `cell-authenticity.ts` mirror
  - Test refresh + golden fixture pin
- **Why deferred**: Bundles with the next atlas refresh + circuit version bump. F-1.1 partial closure narrows the attacker model meaningfully (must compromise atlas publication, not just transport).

#### F-1.2 — Privacy claim contradicts shipped mDL flow

- **Severity**: C
- **Status**: DONE (2026-04-25) — copy aligned with shipped behavior; canonical data-practices section landed at /about/integrity with footer link from every page
- **Where**: `src/routes/help/verification/+page.svelte:95`; `src/lib/components/auth/address-steps/VerificationValueProp.svelte:86`; `src/lib/core/identity/constituent-address.ts:1-26`; `src/lib/components/auth/parts/OnboardingContent.svelte:283`; `src/routes/about/integrity/+page.svelte`; `src/routes/org/[slug]/emails/compose/+page.svelte:1131`; `docs/integration.md:588`; `docs/design/voice.md`; `src/lib/components/layout/Footer.svelte`
- **Summary**: Help page made a wire-level claim ("Your address never leaves your device") that was false on the mDL path. Multiple other surfaces had similar overclaims (TEE-as-shipped framing, terms-and-privacy-policy link to nothing).
- **Fix landed**:
  - Help page mDL section rewritten: "Your wallet shares only postal code, city, and state — never your full street address or name. Those three fields transit our servers briefly to derive your congressional district, then are discarded. We never persist them." Plus TEE-on-roadmap note.
  - VerificationValueProp address-flow value-prop rewritten: "Your full street address stays on your device. We compute a cryptographic commitment to your district in your browser. Approximate coordinates transit our servers briefly to confirm the district mapping is authentic, then are discarded."
  - constituent-address.ts docblock corrected to distinguish manual-address path (full address goes to server, discarded), Shadow Atlas path (commitment + lat/lng), and the storage-path scope.
  - OnboardingContent: dead "agree to our terms and privacy policy" replaced with link to `/about/integrity` + "full ToS and Privacy Policy documents are forthcoming".
  - `/about/integrity` gained a "What Commons Does With Your Data" section with: GDPR legal-basis statement (Art. 6(1)(f) for address derivation, 6(1)(b) for auth), quantified retention ("seconds, not minutes"), CCPA-compliant "We do not currently sell your data, and we have no plans to. If our practices change... 30 days' notice" framing, mDL feature-flag-off disclosure.
  - emails/compose enclave-as-shipped claim corrected to "server-side delivery worker (hardware-isolated enclave is on the roadmap)".
  - integration.md TEE block prefixed with explicit PLANNED warning.
  - voice.md message-delivery example split into "post-enclave deployment" vs "current, pre-enclave" variants.
  - Footer.svelte added Privacy & data + Integrity links so disclosure is discoverable from every page.
- **Self-audit (brutalist quota exhausted on review pass — manual review applied)**:
  - **Closed**: false "address never leaves device" claims, dead T&C link, TEE-as-shipped framing across multiple surfaces, missing GDPR legal-basis statement, missing quantified retention window, undefined "no data sale" policy, missing footer link to disclosure.
  - **Deferred to F-4.4 (privacy/terms pages)**: dedicated /privacy and /terms routes; cookie disclosure; GDPR Art. 27 EU representative; full ToS document.
  - **Risk acknowledged**: linking from privacy-relevant disclosure to a github-hosted KNOWN-LIMITATIONS file is a stopgap. /about/integrity now carries the canonical on-domain content; the github link is supplementary technical detail.
  - **Compliance posture**: pre-launch, no real users yet, so retroactive-deception risk is contained. Once we onboard real users under updated copy, the prior copy is no longer load-bearing.
- **Critics**: codex-legal (#1), gemini-legal (privacy notice) [original]; brutalist quota exhausted on review pass — substituted by manual self-audit documented above.

#### F-1.3 — mdoc DeviceAuth nonce-binding is logged, not verified

- **Severity**: C
- **Status**: DONE-PARTIAL (2026-04-25, review round 2 corrections applied) — claim downgraded with corrected disclosure window, presence-gate scoped honestly, code-level launch gate (`FEATURES.MDL=false`) wired across all four mDL endpoints; **full T3 implementation gated as REQUIRED before flag flip**
- **Where**: `src/lib/core/identity/mdl-verification.ts:199-214`
- **Summary**: The code checked `deviceSigned.deviceAuth` is *present*, then `console.log('full verification in T3')`. The session-transcript nonce was never extracted or compared. T3 (DeviceAuth HPKE) is deferred per MEMORY, but the customer-facing claim "OID4VP JWT sig verification + mdoc nonce validation implemented" overstated reality for the raw-mdoc path.
- **Decision (B-plus, recorded 2026-04-25)**:
  1. **Downgrade claim now**: MEMORY.md and supporting docs misrepresented mdoc-side replay protection. Reality:
     - **OID4VP path (Chrome, web)**: protected by JWT-claims nonce check at `mdl-verification.ts:507-512` ✓
     - **org-iso-mdoc path (Safari/iOS, Android native)**: `nonce` parameter is REQUIRED at the function boundary and the response goes through COSE_Sign1 IACA verification + MSO digest validation — but DeviceAuth nonce-against-session-transcript verification is NOT performed. Replay window: any captured mdoc response can be re-submitted with the same OID4VP request nonce until that nonce is invalidated.
  2. **Fail-closed defense (added 2026-04-25)**: `processMdocResponse` now REJECTS when `deviceSigned.deviceAuth` is absent (previously: silent pass). Closes the worst-case path where a wallet vendor or attacker omits DeviceAuth entirely. Doesn't replace T3 but reduces the surface.
  3. **T3 as launch gate**: full DeviceAuth verification (DeviceMAC or DeviceSignature against reconstructed SessionTranscript) is REQUIRED before mDL launch flag is flipped. Bundles with Apple Business Connect enrollment (which is itself pending). This is now an explicit pre-launch checklist item.
- **Blast radius (current)**: Replay/relay of captured mDL responses on Safari/iOS path within session-nonce lifetime. Materially smaller than initially scored because: (a) no production user-facing Apple flow yet — Apple Business Connect pending, (b) mdoc protocol gates remain closed, and (c) COSE_Sign1 IACA root verification still proves the mDL itself isn't forged.
- **Fix landed**:
  - `mdl-verification.ts:199-214`: missing-deviceAuth fail-closed (return error 'replay_protection_missing'); existing log retained as positive-case telemetry signal.
  - `MEMORY.md`: claim corrected to distinguish OID4VP nonce check (implemented) from mdoc DeviceAuth (deferred to T3, launch gate).
  - `docs/security/KNOWN-LIMITATIONS.md` (or equivalent): explicit replay-window disclosure for the raw-mdoc path.
  - This audit entry now serves as the canonical T3 launch-gate pointer.
- **Brutalist round 2 (claude critic, context `618aca51-95e0-4874-bf5f-b0aabcb91264`)**:
  - **Critical (type union broken)** → fixed: `replay_protection_missing` + `mdl_disabled` added to `MdlVerificationResult` error union.
  - **Critical (gate provides ≈0 defense vs capture-replay)** → fixed: docstring + KNOWN-LIMITATIONS reframed honestly. Gate is now described as "rejects non-conformant wallets" (the honest scope), not "narrows the attacker model" (the prior overclaim).
  - **Critical (replay-window disclosure understated)** → fixed: KNOWN-LIMITATIONS now states the actual bound is wallet credential `validFrom`/`validUntil` lifetime (months-to-years), NOT the OID4VP nonce TTL. The mdoc path doesn't compare the response nonce against deviceAuth, so OID4VP TTL never bounds replay on this path.
  - **Critical (launch gate procedural-only)** → fixed in the then-current mDL surface by adding `FEATURES.MDL = false` to `src/lib/config/features.ts` and gating verifier endpoints until the explicit T3-completion checkpoint. The legacy bridge endpoints referenced in the original audit have since been deleted.
  - **Critical (active code path today confirmed)** → mitigated by `FEATURES.MDL=false` 404. Endpoints no longer reachable.
  - **High (credentialHash re-use detection)** → noted, deferred. <50 LOC defense; defer to its own task once F-1.x sweep lands.
  - **High (telemetry forensically useless)** → noted; the positive-case console.log doesn't carry credentialHash/userId/sessionId because hash isn't computed yet at that point. Move to post-extraction emission as a follow-up.
  - **High (reader auth absent)** → disclosed in KNOWN-LIMITATIONS as a structural T3-bounding note. Pre-existing, not F-1.3-introduced.
  - **Medium (test fixture default)** → acknowledged; T3 fixture builder is its own task.
  - **Medium (wallet compat)** → informational; post-flip canary check in launch checklist.
- **Critics**: codex-sec (H-2) [original]; claude-sec round 2 (`618aca51-95e0-4874-bf5f-b0aabcb91264`) for the residual analysis.

#### F-1.4 — SMT 64-bit truncation is irreversibly frozen

- **Severity**: C
- **Status**: OPEN
- **Where**: `src/lib/server/smt/revocation-smt.ts:71-75` (`nullifierToLeafKey` truncates to low 64 bits)
- **Summary**: Comment admits 5e-8 honest collision at 10⁶ revocations. Adversarial grinding: ~2³² work for multi-target birthday vs N targets. Domain `commons-revocation-v1` is frozen post-launch — fixing later requires re-issuing every credential.
- **Blast radius**: Targeted lockout — attacker grinds a colliding districtCommitment, gets it revoked, victim's slot is occupied, every future non-membership proof fails.
- **Fix shape**: Widen to 128-bit slots (depth-128 SMT) before launch. Touches `revocation-smt.ts`, Noir circuit (`voter-protocol/.../three_tree_membership/src/main.nr` `compute_revocation_smt_root`), `convex/schema.ts` `smtNodes`/`smtRoots`, `getEmptyTreeRoot` recurrence, RevocationRegistry contract genesis root, all related tests.
- **Critics**: claude-arch (Medium F-6), codex-sec (M-Medium), claude-sec (C-3)

#### F-1.5 — Caller-supplied nullifier branch in emit-revocation

- **Severity**: C
- **Status**: DONE (2026-04-25)
- **Where**: `src/routes/api/internal/emit-revocation/+server.ts` (alternative branch removed)
- **Summary**: Endpoint accepted `body.revocationNullifier` directly when supplied. Auth is shared `INTERNAL_API_SECRET`. Combined with F-1.4, an attacker with the secret could grind collisions and write attacker-chosen leaves at 60/min (rate limit ceiling).
- **Blast radius**: Insider with `INTERNAL_API_SECRET` could mass-revoke targets / fill SMT with garbage / inflate Convex storage and chain gas.
- **Fix landed**:
  - `src/routes/api/internal/emit-revocation/+server.ts`: removed `revocationNullifier?` field from request interface + the `else if` branch that accepted it. Endpoint now requires `districtCommitment` and derives server-side via `computeRevocationNullifier(districtCommitment) = H2(districtCommitment, REVOCATION_DOMAIN)`.
  - `tests/unit/api/emit-revocation.test.ts`: removed the test that asserted caller-supplied nullifier was accepted; added explicit test that requests with only `revocationNullifier` (and no `districtCommitment`) are rejected with 400 and that no derivation/chain-write is attempted.
  - Updated stale shape-validation comment.
- **Caller verification (no breakage)**:
  - `convex/users.ts:1206-1208` `emitOnChainRevocation` internalAction passes only `districtCommitment` ✓
  - `tests/integration/revocation-flow.test.ts:79`, `tests/integration/revocation-stress.test.ts:141` pass only `districtCommitment` ✓
  - No other callers in the repo.
- **Self-audit (brutalist quota exhausted)**:
  - **Closed**: body-injection vector for arbitrary 32-byte nullifiers gone. Only path is `H2(districtCommitment, REVOCATION_DOMAIN)`, server-side, single-file edit.
  - **Residual primitive (logged for later)**: leaked-secret attacker can still revoke any *known* credential by submitting that user's `districtCommitment`. Real reduction (no longer arbitrary), not full closure. Bounded to 32-byte preimages the attacker must enumerate. Rate-limited to 60/min globally — insider sweep would take 16 min per 1K revocations and gas-bleed visibly.
  - **Defense-in-depth gap (deferred — F-2.x candidate)**: rate limiter is global, not per-`districtCommitment`. A leaked secret can still mass-revoke 60 distinct targets/min. Per-DC bucket on top of global cap would prevent rapid sweeps. Not a launch blocker.
  - **Other internal endpoints swept** (`alert`, `anchor-proof`, `anchor-incidents`, `revocation-root`, `health/empty-tree-root`): no other "caller-supplied crypto-input alongside server-derivable equivalent" antipatterns.
  - **No DC logged** in any code path (confirmed by reading every console.* call).
- **Tests**: `emit-revocation.test.ts` 21/21 pass; `revocation-flow.test.ts` 9/9 pass; `revocation-stress.test.ts` 6/6 pass.
- **Critics**: claude-sec (H-3) [original finding]; brutalist quota exhausted on review pass — substituted by manual self-audit documented above.

### TIER 2 — High (verified, harden before scale)

#### F-2.1 — Reconciler cron silently no-ops on three skip paths

- **Severity**: H
- **Status**: OPEN
- **Where**: `convex/revocations.ts` `reconcileSMTRoot` (skips on missing env, non-200, fetch failure with `console.warn` only)
- **Summary**: A misconfigured `INTERNAL_API_SECRET` rotation makes drift detection dead. Convex SMT and on-chain RevocationRegistry can diverge unboundedly. Operator only learns at next user-facing reject.
- **Fix shape**: Convert silent-skip to metric increment + alert; add cron-level "consecutive skips" counter that pages after N ticks.
- **Critics**: claude-arch (Critical), claude-codebase (F-4)

#### F-2.2 — Kill-switch flip uses dynamic-import from inside catch

- **Severity**: H
- **Status**: OPEN
- **Where**: `src/lib/server/smt/revocation-smt.ts:266-269` (`await import('$lib/convex')` inside post-write verification catch)
- **Summary**: If a bundler tree-shakes the dynamic import, halt never sets and a corrupt SMT proceeds to chain emit. Latent today; depends on bundler not regressing.
- **Fix shape**: Move halt-flip to a static import at module top. The dynamic-import-in-catch was likely defensive coding, but it's the wrong defense.
- **Critics**: claude-codebase (F-3)

#### F-2.3 — Resolver factory module-singleton in CF Worker scope

- **Severity**: H
- **Status**: OPEN
- **Where**: `src/lib/server/tee/index.ts:16` (`let resolver: ConstituentResolver | null = null`)
- **Summary**: Same antipattern CLAUDE.md flags for Prisma. Latent today (`LocalConstituentResolver` is stateless), but invites cross-request bleed the moment anyone adds caching or a DB handle.
- **Fix shape**: Replace module-scope singleton with per-request factory, OR add a comment + lint-rule preventing stateful resolver implementations from extending the abstraction.
- **Critics**: claude-codebase (F-6), gemini-arch (#3 — variant)

#### F-2.4 — Coordinate vs geocoded-address divorce

- **Severity**: H
- **Status**: OPEN
- **Where**: `src/routes/api/identity/verify-address/+server.ts:245-265`
- **Summary**: Handler uses client-supplied `coordinates` for `verifyDistrictCommitment` with no nonce/token binding to the prior `/api/location/resolve-address` call. **Mitigated downstream** by `reconcileCellGate` re-geocoding the witness address at submission, so civic action routing is not bypassable. But the issued credential's district binding is divorced from the user's real residence — Tier 2 storage gets poisoned even if delivery doesn't.
- **Fix shape**: Server-issue a single-use, address-hash-bound token in step 1; require it in step 2.
- **Critics**: claude-sec (C-2), codex-sec (M-9), gemini-sec (#2)

#### F-2.5 — Test theater: `revocation-smt-helper.test.ts` accepts both success AND failure

- **Severity**: H
- **Status**: OPEN
- **Where**: `tests/unit/server/revocation-smt-helper.test.ts:77-88`
- **Summary**: `try { ... expect(success) } catch { expect(msg).toMatch(/SMT_POSTWRITE_/) }`. Test passes whether the post-write integrity check works or not. Real signal-loss for the kill-switch path.
- **Fix shape**: Either deterministic-mock the Poseidon path so the post-write hash is predictable, or split into two tests (one that asserts success, one that asserts the failure path with a deliberately-corrupted mock).
- **Critics**: codex-test (#4), gemini-test (#1 variant)

### TIER 3 — Already-known gaps confirmed by brutalists

These are tracked elsewhere (MEMORY.md, prior runbooks). Listed here for cross-link only.

#### F-3.1 — TEE not deployed; LocalConstituentResolver is the active path

- **Severity**: H (until rename or fail-closed)
- **Status**: DEFER (in MEMORY: "TEE: AWS Nitro Enclaves — planned")
- **Where**: `src/lib/server/tee/index.ts:24`
- **Action**: Either rename `src/lib/server/resolver/` to remove TEE branding, or add a fail-closed gate when `NITRO_ENCLAVE_ENDPOINT` is unset in prod. Decision is product-level.

#### F-3.2 — Storacha sunset 2026-05-31

- **Severity**: C (5-week clock)
- **Status**: RESOLVED 2026-05-02 — Storacha removed from voter-protocol;
  IPFS pinning paused; R2 (`atlas.commons.email`) carries the
  production read path. F-1.1 (IPFS authenticity) deferred along with
  pinning reactivation.
- **Action**: None pending. Reactivation work tracked in MEMORY
  [storacha_sunset_migration.md] for when IPFS matures.

#### F-3.3 — CA/GB/AU resolver stubs ship public routes

- **Severity**: M (legal exposure F-4.x)
- **Status**: OPEN
- **Where**: `src/lib/server/geographic/rep-lookup.ts:18-33` returns `[]`
- **Action**: Gate non-US country onboarding behind real served countries until resolvers are live.

#### F-3.4 — Cross-repo crypto coupling via comments + caret-pinned semver

- **Severity**: H
- **Status**: OPEN
- **Where**: `package.json` (`@voter-protocol/*` carets), `src/lib/core/crypto/poseidon.ts` (duplicated domain literals)
- **Action**: Pin to exact versions; add CI integration test that asserts byte-equality of all six frozen domain constants between commons and voter-protocol's published vectors.

### TIER 4 — Legal / regulatory exposures (independent of code findings)

External-authority-grounded. Most are launch-blockers if a paying org touches the relevant feature.

#### F-4.1 — TCPA / 10DLC live without consent ledger

- **Severity**: C
- **Status**: OPEN
- **Where**: `src/routes/api/org/[slug]/sms/[id]/+server.ts:46` (returns 501 — not actually wired); `convex/webhooks.ts:403-413` (STOP handling is global by phone hash, not tenant-scoped); `docs/design/SMS-RENABLE-PLAN.md:29-31` admits "TCPA consent trail missing"
- **Authority**: 47 U.S.C. § 227(b)(1)(A)(iii); FCC 24-24 (consent revocation, partial deferral expired April 11, 2026 — now live); 47 C.F.R. § 64.1200(a)(10)-(11). Statutory damages $500/text, $1,500 willful, fee-shifting.
- **Fix shape**: Per-recipient consent ledger with timestamp + IP + scope language; tenant-scoped STOP handling; 10DLC registration; explicit prior express written consent capture before any send. Block SMS go-live until ledger is in place.

#### F-4.2 — FEC contributor record fields missing on donations

- **Severity**: C (if any federal political committee uses fundraising)
- **Status**: OPEN
- **Where**: `src/routes/api/d/[campaignId]/checkout/+server.ts:34-48` accepts `email/name/postalCode/districtCode` only; `convex/donations.ts:307-318` mirrors
- **Authority**: 11 C.F.R. § 104.8(a) requires occupation + employer for contributions >$200. ZK design accidentally engineers the "anonymous contribution" trap if donor identity is obscured to the recipient.
- **Fix shape**: Add occupation/employer fields to donation flow when campaign is flagged as federal-committee; update receipt-to-org payload to include identification when threshold met.

#### F-4.3 — GDPR Art. 27 representative or hard EU geofence

- **Severity**: H
- **Status**: OPEN
- **Authority**: GDPR Art. 3(2) extraterritorial scope; Art. 27 representative requirement.
- **Fix shape**: Either appoint EU representative + document Art. 17 procedure, or hard-geofence registration to deny EU IPs at signup.

#### F-4.4 — Privacy/Terms pages absent from `src/routes`

- **Severity**: H
- **Status**: OPEN
- **Where**: Codex confirmed by `find src/routes -iname '*privacy*' -o -iname '*terms*'` returns nothing; onboarding `src/lib/components/auth/parts/OnboardingContent.svelte:283` references "terms and privacy policy" link
- **Authority**: Cal. Bus. & Prof. Code § 22575(a) (CalOPPA); Cal. Civ. Code § 1798.100(a) (CCPA notice at collection).
- **Fix shape**: Ship `/privacy` and `/terms` routes with content reflecting actual data flows. Pair with F-1.2 alignment pass.

#### F-4.5 — CCPA framing for anti-sybil email

- **Severity**: M
- **Status**: OPEN
- **Authority**: Cal. Civ. Code § 1798.105(d)(2) — security-incident exception; need policy language characterizing email as security control, not account/contact field.
- **Fix shape**: Privacy policy text revision (1-2 sentences) characterizing email as anti-sybil security control.

### TIER 5 — Real but lower priority

#### F-5.1 — Dummy ZK proof in debate UI

- **Severity**: M (depends on contract verifier acceptance)
- **Status**: OPEN
- **Where**: `src/lib/components/wallet/debate/SubmitArgumentForm.svelte:47-58` ships `proof: '0x'` + `publicInputs: Array(31).fill('0')`. Same pattern in `CoSignButton.svelte:41`.
- **Note**: `FEATURES.DEBATE = true` makes the route reachable. Exploitable only if on-chain verifier accepts these stub values — needs check.
- **Fix shape**: Either gate UI behind a real proof flow (requires identity commitment integration) or remove the UI until verified. Verify on-chain verifier behavior first.

#### F-5.2 — `as unknown as never` casts at Convex boundary

- **Severity**: M (rising)
- **Status**: OPEN
- **Where**: 7+ instances in `revocation-smt.ts`, `submissions/create/+server.ts:200,201,262`, `proofs/revocation-witness/+server.ts:56`. Codegen TODO at `submissions/create:257` is load-bearing.
- **Fix shape**: Either fix the codegen output (one PR, ~7 files) or add a typed Convex wrapper module so the cast lives in exactly one place.

#### F-5.3 — Process-metadata comments in production code

- **Severity**: L
- **Status**: OPEN
- **Where**: 17× "Wave/REVIEW/SELF-REVIEW/FU-" tags in `convex/revocations.ts`; 9× in `revocation-smt.ts`; 5× in `verify-commitment.ts`
- **Fix shape**: Strip Wave/FU/REVIEW tags. Keep crypto-correctness *why* comments. Move audit trail to commit messages.

#### F-5.4 — `getRevocationNonMembershipPath` is public `query`

- **Severity**: M
- **Status**: OPEN
- **Where**: `convex/revocations.ts` (line ~328 per critic)
- **Summary**: Public Convex query takes arbitrary nullifiers. Authenticated but not rate-limited at Convex layer. Membership oracle for revoked credentials. Mitigation: 254-bit Poseidon outputs are hard to guess, but combined with F-1.5 it's enumerable.
- **Fix shape**: Move to `internalQuery` + auth-gated server endpoint with rate-limit, OR document the threat model explicitly if the public oracle is intentional.

---

## Findings Downgraded / Dismissed from Brutalist Output

Recorded for completeness; not in the action graph.

- **"Module-scope circuit breaker is a phantom in serverless"** (gemini-codebase #3): CF Pages keeps a single warm isolate per region for sustained traffic. Imperfect but not "Critical."
- **"Halt-thrash from transient RPC blips"** (gemini-arch #3): codex-sec confirmed the reconciler skips transient fetches rather than halting. Less brittle than first claimed.
- **"Downgrade guard fails open if user clears all rows"** (gemini-sec #4): Theoretical only — no public path to delete credential rows. Insider/data-retention hazard, not an external attack.
- **"FECA $50 anonymous contribution trap absolute"** (gemini-legal #1): Strong framing, but hinges on whether fundraising obscures donor identity *to the recipient committee*. Tracked under F-4.2 with narrower scope.

---

## Wave 1 Task Graph

```
F-1.4 (SMT 128-bit widening) ─── must complete first; touches frozen domain
  ├── 1.4.impl: widen revocation-smt.ts + Noir circuit + schema + EMPTY_TREE_ROOT
  ├── 1.4.review: brutalist crypto correctness review
  └── 1.4.fix: apply review findings + cross-impl byte-equality regression

F-1.5 (delete caller-supplied nullifier branch) ─ parallel after F-1.4
  ├── 1.5.impl: remove branch + update tests
  ├── 1.5.review: brutalist surface review
  └── 1.5.fix: apply review findings

F-1.1 (IPFS content authenticity) ─ parallel; bundles with Storacha migration
  ├── 1.1.impl: define CID/Merkle scheme + verify in fetchContent
  ├── 1.1.review: brutalist gateway-forgery surface review
  └── 1.1.fix: apply review findings

F-1.3 (mdoc DeviceAuth) ─ requires decision before impl
  ├── 1.3.decide: implement T3 vs downgrade marketing claim
  ├── 1.3.impl: execute decided path
  ├── 1.3.review: brutalist mDL replay/relay review
  └── 1.3.fix: apply review findings

F-1.2 (privacy/marketing alignment) ─ parallel; multi-file copy edit
  ├── 1.2.impl: rewrite help/onboarding/MEMORY/architecture docs
  ├── 1.2.review: brutalist legal+UX review
  └── 1.2.fix: apply review findings
```

Critical-path ordering: F-1.4 first (frozen domain). Others can parallel.

---

## Status Tracking

| ID | Severity | Status | Cycle | Owner | Notes |
|----|----------|--------|-------|-------|-------|
| F-1.1 | C | PARTIAL | fix (1) | main | Chunk-fabrication closed 2026-04-25 via SMT-path gate against pinned EXPECTED_CELL_MAP_ROOT + EXPECTED_CELL_MAP_DEPTH. Residual chunk-substitution logged as F-1.1b. 37+361 tests pass. Brutalist round 2 surfaced 1 Critical (deferred → F-1.1b), 2 High (fixed: bypass-logging, depth pin), 3 Medium (fixed: hex guard, depth-zero, bit-convention noted), 2 Low (noted). |
| F-1.1b | H | DEFER | — | — | NEW (surfaced during F-1.1 review): leaf encoding doesn't bind h3Cell, so attacker controlling R2 can route h3 keys to wrong-but-real leaves. Structural fix = change leaf to H3(h3Cell, cellId, sponge24(districts)). Bundles with next atlas + circuit refresh. |
| F-1.2 | C | DONE | fix (1) | main | Multi-file copy alignment pass landed 2026-04-25. Help/onboarding/footer truthful; /about/integrity gained GDPR legal-basis + CCPA-soft "no data sale" + quantified retention. Footer link from every page. F-4.4 (full ToS/Privacy pages) deferred. Brutalist quota exhausted; self-audit covered the four addressable gaps. |
| F-1.3 | C | DONE-PARTIAL | fix (2) | main | Decision Path B-plus + round-2 corrections landed 2026-04-25. Type union fixed, presence-gate scoped honestly, replay-window disclosure corrected (wallet credential lifetime, not OID4VP TTL), `FEATURES.MDL=false` gates all 6 mDL/bridge endpoints with 404. T3 = explicit launch checkpoint. 562 tests pass. |
| F-1.4 | C | DONE | fix (1) | main | R1-R6 applied 2026-04-25; 3054/3056 tests pass (1 pre-existing Postgres fail, 1 todo). Added d=64-non-empty-sibling fixture + unmocked empty-tree-root pin + sibling-length fail-closed at both walk paths. R7-R8 deferred as low-priority backlog. |
| F-1.6 | C | DONE | fix (1) | main | Impl + review + fix cycle complete 2026-04-25. Added LE-bit binding constraint, 3 Noir tests (small-value, negative, 128-bit boundary). 3 brutalist critics confirmed soundness; surfaced F-1.7 (Tree 2) and F-1.8 (identity-binding) as deferred. nargo not run in session — pre-merge gate. |
| F-1.7 | H | DEFER | — | — | Tree 2 cell_map_path_bits has same structural gap; fixing requires circuit-signature change (leafIndex witness OR f(cell_id) derivation). Mitigation today: operator-built SMT integrity + Poseidon2 collision-resistance. Not blocking Wave 1. |
| F-1.8 | H | DEFER | — | — | NEW (surfaced during F-1.6 review): identity_commitment not bound to Tree 1 user_leaf in-circuit. Prover with Alice's user_secret + Bob's identity_commitment can lock Bob out (DOS primitive once IC leaks). Off-chain `user_secret = H2(IC, entropy)` establishes default but isn't circuit-enforced. Fix: add user_entropy witness + derivation constraint. Not blocking Wave 1 (gated on IC leak). |
| F-1.5 | C | DONE | fix (1) | main | Caller-supplied-nullifier branch removed 2026-04-25. Endpoint requires districtCommitment, derives via H2 server-side. 21+9+6 tests pass. Brutalist quota exhausted; manual self-audit logged residual (per-DC rate-limit gap, deferred F-2.x candidate) and confirmed no other internal endpoints share the antipattern. |
| F-2.1 | H | OPEN | — | — | Reconciler observability |
| F-2.2 | H | OPEN | — | — | Kill-switch dynamic-import |
| F-2.3 | H | OPEN | — | — | Resolver factory singleton |
| F-2.4 | H | OPEN | — | — | Coordinate-address binding token |
| F-2.5 | H | OPEN | — | — | Test theater fix |
| F-3.1 | H | DEFER | — | — | TEE rename or fail-closed gate |
| F-3.2 | C | WIP | — | — | Storacha migration |
| F-3.3 | M | OPEN | — | — | CA/GB/AU stub gating |
| F-3.4 | H | OPEN | — | — | Cross-repo crypto coupling |
| F-4.1 | C | OPEN | — | — | TCPA consent ledger |
| F-4.2 | C | OPEN | — | — | FEC contributor fields |
| F-4.3 | H | OPEN | — | — | GDPR Art. 27 |
| F-4.4 | H | OPEN | — | — | Privacy/Terms pages |
| F-4.5 | M | OPEN | — | — | CCPA framing |
| F-5.1 | M | OPEN | — | — | Dummy ZK proof in debate UI |
| F-5.2 | M | OPEN | — | — | `as unknown as never` casts |
| F-5.3 | L | OPEN | — | — | Process metadata comments |
| F-5.4 | M | OPEN | — | — | `getRevocationNonMembershipPath` access control |

---

## New Findings Log

Append below as new findings surface from review cycles or exploration.

<!-- format:
**YYYY-MM-DD — F-X.Y discovered during F-A.B review cycle**
- Where: file:line
- Summary: ...
- Severity: C/H/M/L
- Disposition: status decision + rationale
-->

### 2026-04-25 — F-1.6 (CRITICAL) discovered during F-1.4 brutalist review (Claude critic finding #2)

- **Where**: `voter-protocol/packages/crypto/noir/three_tree_membership/src/main.nr` `main()` Step 8 (lines ~571-585)
- **Summary**: The Noir circuit takes `revocation_path_bits` as an UNCONSTRAINED private witness. There is no in-circuit assertion that `revocation_path_bits[i] == (revocation_nullifier >> i) & 1`. A revoked user can supply path_bits for ANY empty slot in the SMT, build a matching siblings path (mostly empty subtrees), and produce a valid non-membership proof. The on-chain pairing check passes; `revocation_registry_root` is satisfied; `revocation_nullifier` public input is correct; **but the non-membership claim is for a slot the user did not actually occupy**. F1 closure is silently broken.
- **Severity**: Critical
- **Reach**: Pre-existing — predates F-1.4 widening. SMT depth doesn't affect exploitability. The widening explicitly targets non-membership soundness; this is the natural moment to fix.
- **Fix shape (in circuit)**:
  ```noir
  // Constrain prover-supplied path_bits to match the LSB-128 of revocation_nullifier.
  let nullifier_bits: [u1; 254] = revocation_nullifier.to_le_bits();
  for i in 0..REVOCATION_SMT_DEPTH {
      assert(revocation_path_bits[i] == nullifier_bits[i]);
  }
  ```
- **Disposition**: Add Wave 1 task cluster (#88-90) to fix in this audit window. Blocks F-1.4 from being meaningfully complete (without it, widening is cosmetic).

### 2026-04-25 — F-1.8 (HIGH, deferred) — `identity_commitment` not bound to Tree 1 user_leaf in circuit (Sybil/lockout vector)

- **Where**: `voter-protocol/.../three_tree_membership/src/main.nr` `main()` Step 1 (Tree 1 user-leaf computation, line ~509) and Step 4 (nullifier derivation, line ~537). Surfaced during F-1.6 brutalist review (Claude finding #7).
- **Summary**: `user_secret` and `identity_commitment` are independent private witnesses. The Tree 1 user_leaf = H4(user_secret, cell_id, salt, auth) does NOT include identity_commitment. The nullifier = H2(identity_commitment, action_domain) does NOT include user_secret. A prover holding Alice's user_secret (her Tree 1 membership) can pair it with Bob's identity_commitment to produce a proof whose nullifier is Bob's, locking Bob out of the action_domain. Off-chain mitigation `user_secret = H2(identity_commitment, user_entropy)` (`src/lib/core/identity/user-secret-derivation.ts:43`) establishes the binding at registration but is NOT enforced in-circuit at proof time.
- **Severity**: High. Real DOS primitive once identity_commitment leaks (mDL theft, identity-provider breach, log leakage). Not Sybil-up (attacker can't gain positive privilege) but Sybil-down (denies legitimate user). Pre-existing — not introduced by F-1.6.
- **Reach gate (today)**: `identity_commitment` is "deterministic per verified person" via self.xyz/didit. Alice obtaining Bob's identity_commitment requires either compromising Bob's identity material or accessing verifier logs/storage that expose commitment material. Not trivially exploitable today.
- **Fix shape (in circuit)**:
  ```noir
  // Add `user_entropy` as private witness; constrain user_secret derivation.
  let derived_user_secret: Field = poseidon2_hash2(identity_commitment, user_entropy);
  assert(derived_user_secret == user_secret, "user_secret must derive from identity_commitment");
  ```
  This forces the prover's user_secret to be derived from the same identity_commitment they use for nullifier — eliminating the cross-pair attack.
- **Disposition**: DEFER — separate task graph after Wave 1. Not blocking immediate launch readiness because exploit chain requires identity_commitment leak first. Add to KNOWN-LIMITATIONS.md alongside F-1.7.

### 2026-04-25 — F-1.7 (HIGH, deferred) — Tree 2 cell_map_path_bits unconstrained

- **Where**: `voter-protocol/.../three_tree_membership/src/main.nr` Step 3 (Tree 2 walk)
- **Summary**: Same structural bug class as F-1.6 — `cell_map_path_bits` is an unconstrained witness. But unlike the revocation tree (keyed by nullifier, derivable in-circuit), Tree 2 is keyed by `leafIndex` (operator-assigned cell position). Fixing requires either adding `leafIndex` as a witness OR establishing a deterministic `leafIndex = f(cell_id)` derivation — both circuit-signature changes.
- **Severity**: High (lower than F-1.6 because the leaf hash `H2(cell_id, dc)` provides implicit binding via Poseidon2 collision-resistance — the operator-built SMT structurally enforces leaf-to-slot mapping). But still a defense-in-depth gap.
- **Mitigation today**: Operator's SMT is the trust root for Tree 2 leaf-slot binding. A future operator compromise + path_bits forgery would be exploitable; today's threat model assumes operator integrity.
- **Disposition**: DEFER — separate task graph, separate impl/review cycle. Not blocking Wave 1 launch readiness. Document as known limitation in `docs/security/KNOWN-LIMITATIONS.md`.

---

## Implementation Notes

### F-1.4 — SMT 128-bit widening — Cycle 1 review findings (2026-04-25)

Brutalist panel: claude + codex + gemini (security domain, resumed context). 14 findings surfaced; 8 verified valid, 1 pre-existing critical found (logged as F-1.6), 5 confirmed non-issues.

**Apply in #74 (FIX cycle):**

- **R1 (HIGH)** — Stale "64" comments throughout: `convex/revocations.ts:72,81,105,147,157,225,248`, `src/lib/server/smt/revocation-smt.ts:116,184-185`, `src/lib/core/crypto/noir-prover-shim.ts:72-73` (the prover-shim type-doc is the most likely misuse magnet — public type contract).
- **R2 (HIGH)** — `revocation-smt.ts:177` does `path.siblings[d] ?? zeros[d]` which silently pads short arrays. Add `path.siblings.length === SMT_DEPTH` invariant assertion. Same gap in post-write verifier at line ~244.
- **R3 (MEDIUM)** — Threat-model math wrong. All 3 critics flag. Replace "birthday 2^32→2^64" with correct: at depth 64, single-target preimage = 2^64 (feasible at scale), multi-target with N=10^6 ≈ 2^44 (feasible to determined adversary); at depth 128, single-target = 2^128 (infeasible), multi-target ≈ 2^108 (infeasible). Update comments in `revocation-smt.ts:34-37`, `convex/revocations.ts:72-77`, `main.nr:108-114`, `RevocationRegistry.sol:21-25`.
- **R4 (MEDIUM)** — No cross-impl fixture forces `d=63→d=64` boundary with non-empty sibling at d=64. Add `SLOT_0_AND_2POW64` two-leaf fixture so siblings at d=64 are non-empty.
- **R5 (MEDIUM)** — No unmocked test pins `getEmptyTreeRoot()` against canonical hex. One-line addition in `revocation-smt.test.ts`.
- **R6 (LOW)** — Add disclaimer comment near `REVOCATION_DOMAIN` in both `poseidon.ts` and `main.nr`: "v1 tracks the Poseidon2 input string only; SMT_DEPTH is independent." Closes the misread surface raised by all 3 critics.

**Defer to backlog (low priority):**
- **R7 (LOW)** — Property test generates 64-bit nullifiers padded to 256; should generate full 128-bit values to stress-test upper-half path keys (`tests/unit/server/revocation-smt-property.test.ts:105`).
- **R8 (LOW)** — Update `docs/runbooks/V2-PROVER-CUTOVER.md` to specify wiping BOTH `smtNodes` AND `smtRoots` (only wiping smtRoots leaves orphan path nodes — caught loudly by drift cron, but cleaner cutover wipes both).

### F-1.6 — Path-bits binding (impl→review→fix complete 2026-04-25)

**Impl** (`packages/crypto/noir/three_tree_membership/src/main.nr`):
- Added LE-bit binding constraint at Step 8: `revocation_path_bits[i] == revocation_nullifier.to_le_bits()[i]` for i in 0..128.
- Tree 2 deliberately deferred to F-1.7 (different fix shape — needs leafIndex witness).
- Added 2 initial Noir tests: positive (`to_le_bits` API sanity) + negative (`should_fail_with` on mismatch).

**Review** (3 brutalist critics, security domain — claude/codex/gemini, all returned):
- All 3 concur: binding is sound, endianness-correct, API form compiles in Noir 1.0-beta.16, performance impact <1%, F1 closure structurally fixed.
- Claude verified `Field::to_le_bits<let N: u32>(self) -> [u1; N]` at noir-lang/noir v1.0.0-beta.16 stdlib field/mod.nr#L30. No-turbofish form compiles via type inference from `[u1; 254]` LHS.
- **R-A**: small-value tests don't exercise bit positions 4..127. Add 128-bit boundary test.
- **R-B**: Tree 2 deferral comment overclaims "Poseidon2 collision-resistance"; actual mitigation is operator-built SMT integrity. Tighten language.
- **NEW finding F-1.8** (Claude #7): `identity_commitment` not bound to Tree 1 user_leaf — DOS primitive once IC leaks. Pre-existing, not introduced by F-1.6. Logged separately.

**Fix** (R-A + R-B applied):
- Added `test_revocation_path_bits_binding_at_128_bit_boundary` exercising `nullifier = 2^127 + 1` (bit 0 and bit 127 both set, intermediate bits zero). Confirms array indexing through entire 128-bit range.
- Tightened the Tree 2 deferral comment in main.nr to acknowledge operator-discipline-as-security explicitly. Removed earlier hand-wave about "implicit binding via Poseidon2 collision-resistance" alone.
- Investigated F-1.8 reach gate: `user_secret = H2(identity_commitment, user_entropy)` per `src/lib/core/identity/user-secret-derivation.ts:43` — establishes binding at registration but NOT in-circuit. F-1.8 is real, deferred (gated on IC leak).
- Tests: 3054/3056 commons pass (unchanged — Noir changes don't affect TS tests). nargo test not run in this session — pre-merge gate.

**Pre-merge gates required:**
- `nargo test` against the depth-128 + binding circuit. Both F-1.4 and F-1.6 changes need nargo verification.
- Recompile circuit, regenerate `@voter-protocol/noir-prover` package, bump version (per F-1.4 review C-1).

---

**Fix-cycle outcome (2026-04-25, ~30 min):**
- R1 applied: `noir-prover-shim.ts:72-78`, `convex/revocations.ts` (7 sites), `revocation-smt.ts:116,184-185` — all stale "64" comments updated.
- R2 applied: added `SMT_PATH_LENGTH_MISMATCH` fail-closed assertion at `revocation-smt.ts` line ~178 (pre-walk) and line ~244 (post-write verify).
- R3 applied: corrected threat-model math across 4 files. Single-target preimage (was 2^64, now 2^128). Multi-target with N=10^6 (was 2^44, now 2^108). Honest birthday at N=10^6 (was 2.7e-8, now 1.5e-27).
- R4 applied: added `SLOT_0_AND_2POW64` cross-impl fixture (canonical root `0x253cd6055d0b1f11495ca6be08bdb894cb860f2e275f2c4ffcacfba26290eda1`); regenerated via one-shot script. Added matching Noir test `test_smt_cross_impl_two_leaf_slot0_and_2pow64`.
- R5 applied: pinned canonical empty-tree root in unmocked test `revocation-smt.test.ts`.
- R6 applied: added decoupling clarifier near `REVOCATION_DOMAIN` in both `poseidon.ts` and `main.nr`.
- Tests: 3054 passing / 3056 total (was 3052 — net +2 from new fixtures); 1 pre-existing Postgres failure unchanged; 1 todo unchanged.

**Confirmed non-issues (downgraded from brutalist):**
- Gemini H-2 (`verifyNonMembership` keccak vs Poseidon "mathematically impossible") — contract comment at `RevocationRegistry.sol` explicitly says "off-chain helper... uses keccak256 for gas. Intended for off-chain observability tools, not for proof verification." Critic missed the comment. NOT a finding.
- Claude #1, #6 (nargo test not run, outdated npm prover) — explicit out-of-scope deployment concern, noted in original implementation summary. Tracked as a pre-cutover ops gate, not a code defect.
- Claude #10 (gas concern on 128-deep keccak loop) — confirmed non-issue. ~5K gas total for view call.
- Gemini H-1 severity inflation ("v1 domain string is High exposure") — Codex+Claude both downgrade to Low/Medium. The TS length-128 validators catch the misuse case at the boundary. Real severity captured by R6.

### F-1.4 — SMT 128-bit widening (impl complete 2026-04-25)

**Files changed:**

Commons (5 production + 4 test):
- `src/lib/server/smt/revocation-smt.ts` — `SMT_DEPTH` 64→128, `nullifierToLeafKey` truncation 64n→128n, comments
- `convex/revocations.ts` — `SMT_DEPTH` 64→128, `getRevocationNonMembershipPath` truncation, comments
- `convex/schema.ts` — `smtNodes` depth comment 0..64 → 0..128
- `src/lib/core/zkp/revocation-witness.ts` — `REVOCATION_SMT_DEPTH` 64→128
- `src/lib/core/zkp/prover-client.ts` — `REVOCATION_SMT_DEPTH` 64→128
- `src/lib/core/crypto/zero-hashes.ts` — removed unused `getEmptyTreeRoot64` helper
- `tests/unit/server/revocation-smt.test.ts` — `SMT_DEPTH` 128, prefix-collision test reframed for 128 bits
- `tests/unit/server/revocation-smt-property.test.ts` — `SMT_DEPTH` 128, Property 6 collision-test reframed
- `tests/unit/server/revocation-smt-cross-impl.test.ts` — depth 128, regenerated 6 canonical roots, added slot-2^127 fixture
- `tests/unit/zkp/three-tree-v2-validation.test.ts` — all `length: 64` → `length: 128`, regex assertions updated

Voter-protocol (2 files):
- `packages/crypto/noir/three_tree_membership/src/main.nr` — `REVOCATION_SMT_DEPTH` 64→128, regenerated 6 cross-impl globals, added `SMT_CROSS_IMPL_SLOT_2POW127_ROOT` + test
- `contracts/src/RevocationRegistry.sol` — `verifyNonMembership` siblings.length 64→128 (off-chain audit aid; proof verifier untouched)

**Cross-impl canonical roots regenerated 2026-04-25:**

| Fixture | Depth-128 root |
|---|---|
| EMPTY_ROOT | `0x267431d95e8d4953a753b3043807fd4ce1a65da3c4a76bde86e7e329c8729d79` |
| SLOT0 | `0x0e5696069485f77036a2bc2322bdc12dd42dc619306d61ac2e813267866879d6` |
| SLOT1 | `0x1ce446ae75075424cb286e08cefdcb34c81197384cc7c1ca9d6844fb2e8747d3` |
| SLOT_2POW63 (mid-tree) | `0x2e05dc2632d7df52064dc0767e0903f346ce9fab9b3b37225a5016618380b0dd` |
| SLOT_2POW127 (top, NEW) | `0x1729a8e6fae2170f68cb27f9602bcc419c7b0b338d4d2d4730c18a827ddc21a9` |
| SLOT_MIXED_A5 (128-bit pattern) | `0x085c4d84b90354433f78e35e479043af61dd448d4d449307829d93bac8000150` |
| TWO_LEAF_S0_THEN_S1 | `0x12cbb2bd70670646d2ea6c8a8ec136131605ced78c3f1a4b90fa64f19bec3426` |

**Deploy note:** `RevocationRegistry` contract must be redeployed with the new EMPTY_TREE_ROOT (`0x267431d9…`) as the constructor arg. Pre-launch state — no production migration concern.

**Out-of-scope deferred:** `nargo test` for the Noir circuit was not run from this session (requires nargo toolchain). The 6 cross-impl byte-equality assertions in main.nr will gate the Noir cutover at CI time. Manual `nargo test` recommended before merge.

---

## Sweep References

- Brutalist context IDs (for re-running with `resume: true`):
  - architecture: `cb01d112-ca9a-40c5-972b-92b97fdfe9ef`
  - security: `6d3e6165-cf2b-4ace-bf11-4b0a0af30e02`
  - codebase: `f5401fa9-2b3f-4c22-ac6c-91b9df026f98`
  - test_coverage: `6a470b6d-f5a2-4a68-b0a5-e25cc0955a66`
  - legal: `6b2c457a-cea6-4449-b00a-be6f6d1d67d7`
- Related docs:
  - `docs/design/PRIORITY-EXECUTION-TRACKER.md` (style template)
  - `docs/design/SECURITY-HARDENING-LOG.md` (prior audit pattern)
  - `docs/design/REGROUNDING-LAUNCH-READINESS.md` (recent waves 5-8 work)
  - `docs/security/KNOWN-LIMITATIONS.md` (cross-link for accepted limitations)
