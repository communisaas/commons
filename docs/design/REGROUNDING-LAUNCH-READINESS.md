# Re-grounding Launch Readiness

Stage 4g — final go/no-go assessment for the civic ZKP re-grounding / address-change work.

## Shipped scope

**Stage 1 (server hardening)**: Active-credential gate at `submissions.create` blocks stale-proof replay at the insert surface (`NO_ACTIVE_DISTRICT_CREDENTIAL`). Delivery recheck via `isCredentialActive` closes the TOCTOU window between submission and CWC dispatch (`credential_revoked_or_expired`). Re-verification throttle (24h between attempts, 6 per trailing 180d, email-sybil gate capped at 3 userIds per emailHash within 180d) with tier-3+ bypass. `verificationMethod` allowlist prevents client-supplied "mdl" forgery. Tier-3 partition in analytics reports. All gates live at `convex/users.ts:363-584` and `convex/submissions.ts:51-63, 210-254, 967-992`.

**Stage 2 (v2 action_domain)**: `action_domain = keccak(templateId ‖ actionId ‖ districtCommitment ‖ chainId)` binds each nullifier scope to a specific district commitment. A leaked credentialHash can no longer be replayed across districts because the prover would have to recompute action_domain against a different commitment than the one stored on the SessionCredential.

**Stage 2.5 (integration)**: `SessionCredential` schema carries `districtCommitment`; `ProofGenerator` and server canonical recompute both thread it. A v1 credential (no commitment) now surfaces `CREDENTIAL_MIGRATION_REQUIRED` via the `credential_commitment_missing` delivery error so the user can re-verify.

**Stage 2.7 (TEE witness binding)**: `src/lib/server/tee/resolver-gates.ts:195-237` computes `poseidon2Sponge24(witness.districts)` and constant-time-compares to the server-expected `districtCommitment`. A prover with a leaked credentialHash cannot submit a proof whose decrypted witness names districts different from the commitment the action_domain was bound to — `witness_commitment_mismatch` rejects with `DOMAIN_MISMATCH`.

**Stage 3 + 3.5 + 3.7 (UI)**: Re-grounding flow with witnessing list bound to real async boundaries (no timers), single-surface composition (Zone 1 stays mounted), document typography register, consequential diff with conditional "Your representatives have changed." headline wired to `districtChanged` / `stateChanged`, `Former` chip on prior ground, ESC/beforeunload guard during witnessing.

**Stage 5 (crypto closure)**: Noir circuit V2 with `revocation_nullifier` (public input index 31) and `revocation_registry_root` (index 32). `RevocationRegistry.sol` (SMT-based) deployed on Scroll L2. `DistrictGate.verifyThreeTreeProofV2` accepts 33 public inputs. Convex `emitOnChainRevocation` action with exponential backoff (6 tries, 1m→24h) and stuck-pending cron (1h).

**Stage 5.5 (wire end-to-end)**: `/api/internal/emit-revocation` endpoint (INTERNAL_API_SECRET-gated); `district-gate-client` V1/V2 routing; `rescueFailedRevocation` operator mutation; terminal-kind short-circuit on emit.

## Defense-in-depth stack

### F1 — stale-proof replay

Four independent layers, any one of which closes the class:

1. **Submission-insert gate** (`convex/submissions.ts:51-63`) — `hasActiveDistrictCredential` rejects a stale client before the submission is written.
2. **Delivery TOCTOU recheck** (`convex/submissions.ts:967-992`) — `isCredentialActive` rejects revocation that fired between submit and dispatch.
3. **Witness-to-commitment binding** (`src/lib/server/tee/resolver-gates.ts:195-237`) — even if a stale proof passes the first two gates, the TEE gate verifies the decrypted witness's districts match the server-canonical commitment.
4. **On-chain non-membership** (Noir V2 + RevocationRegistry) — dormant until V2 prover ships; once active, a revocation_nullifier in RevocationRegistry.SMT invalidates the proof at the pairing check level.

Layers 1, 2, 3 are live today. Layer 4 is wired (circuit, contract, Convex action) but gated on npm package publish.

### F2 — district-hop amplification

Three layers, all live:

1. **24h throttle** — no re-verification within 24h of the prior.
2. **180d throttle** — max 6 re-verifications per trailing 180d.
3. **Email-sybil gate** — max 3 userIds per emailHash within 180d (scoped by `users._creationTime` so accumulated-over-years accounts don't count against the cap).

Tier-3+ bypass is deliberate: mDL-verified identity can't be sybiled via email, so the cap would only create friction for legitimate moves.

## Known gaps — launch impact

- **KG-1 V2 Noir prover unpublished**: NOT launch-blocking. F1 has three live server-side layers. V2 is defense-in-depth. Wave 3 closure 2026-04-24: the engineering pre-conditions for the cutover are in place — cross-impl SMT byte-equality verified between TS helper and Noir circuit (6 fixtures: empty-tree, slot 0, slot 1, slot 2^63, mixed-bit 0xa5, two-leaf coexistence); `revocationRegistryRoot` threaded through `ThreeTreeProofInput` / `ThreeTreeProofInputs` / `ProofContext` with all-or-nothing V2 input validation; `FEATURES.V2_PROOF_GENERATION` wired into `ProofGenerator.svelte:177-200` to fetch the non-membership witness from Convex via `/api/proofs/revocation-witness`; ZERO_HASHES extracted to `src/lib/core/crypto/zero-hashes.ts` (single source of truth between server and browser); witness-fetch failures surface to the user instead of silently downgrading to V1; `getRevocationRegistryRoot` throws on RPC failure (no longer collapses transport errors with all-zero); reconciliation cron compares contract `EMPTY_TREE_ROOT` immutable against SvelteKit's `getEmptyTreeRoot()`. Two brutalist cycles + one fix iteration. Cutover plan: `docs/runbooks/V2-PROVER-CUTOVER.md`.

### Wave 3 follow-ups (post-launch, NON-BLOCKING)

- **FU-3.1 Prover-version capability check.** When V2 inputs are passed to a V1 prover, the npm package silently discards them and produces a 31-input proof. Validator catches partial-presence among V2 inputs but cannot detect "V2 fields supplied to a V1 npm package." Fix: at proof-generation time, after the prover returns, check that `result.publicInputs.length === 33` when V2 fields were supplied; throw if not. Or expose a version field from `@voter-protocol/noir-prover` and assert at module-load time.
- **FU-3.2 Submission endpoint freshness check.** The submission endpoint accepts V2 proofs and validates BN254 ranges, but does NOT cross-check the proof's `revocation_registry_root` (public input [32]) against Convex's `currentRoot`. The on-chain `RevocationRegistry.isRootAcceptable` view (with 1h archive TTL) is the operative defense today. Add an application-layer check before submitting on-chain so stale proofs are rejected at the SvelteKit boundary with a categorized error code (`revocation_root_stale`).
- **FU-3.3 Startup-time EMPTY_TREE_ROOT assertion.** Pre-cron deploy window: a fresh deploy with a contract whose `EMPTY_TREE_ROOT` immutable disagrees with SvelteKit's `getEmptyTreeRoot()` produces broken proofs for up to 1h until the cron catches it. Add a deploy-time check that hard-fails the deploy if the two diverge.
- **FU-3.4 Property-based SMT testing.** Cross-impl byte-equality fixtures are hand-picked (slot 0, 1, 2^63, mixed-bit, two-leaf). A bug in the production helper symmetric with a bug in the test reimpl could produce matching wrong roots. Add property-based tests that generate random SMT histories, derive canonical roots via the production helper, and assert the Noir circuit reproduces them.
- **FU-3.5 Runtime feature-flag infra.** `FEATURES.V2_PROOF_GENERATION` is compile-time. True percentage canary requires either a Convex `featureFlags` query (per-session bucket) OR CDN-fraction routing. Until one exists, cutover is binary or staged-build-only.
- **KG-2 SMT placeholder in emit endpoint**: CLOSED 2026-04-24 via Wave 2. Real Poseidon2 sparse Merkle tree (depth 64) persisted in Convex (`smtNodes` + `smtRoots` tables, `convex/revocations.ts`). SvelteKit-side SMT computation (`src/lib/server/smt/revocation-smt.ts`) reads path via `getRevocationSMTPath` (64 siblings batched via `Promise.all`), computes new path via `poseidon2Hash2`, writes via `applyRevocationSMTUpdate` with optimistic-concurrency seq check + path-key validation for depths 0..63. Idempotent retry: when the Convex leaf is already present (e.g., prior chain emit failed), helper returns `isFresh=false` + existing root so the chain emit can land. AlreadyRevoked-after-isFresh-false is classified as success (avoids false `revocationStatus='failed'`). Reconciliation cron (`reconcileSMTRoot`, hourly) compares Convex root vs on-chain root vs SvelteKit-computed empty-tree root vs contract's deployed `EMPTY_TREE_ROOT` immutable; healthy genesis carve-out prevents alert fatigue. Two brutalist review cycles (codex+claude+gemini) converged on closure with follow-ups below. 116 tests pass + 1 todo.

### Wave 2 follow-ups (post-launch, NON-BLOCKING)

- **FU-2.1 Drift kill-switch.** `reconcileSMTRoot` cron logs CRITICAL on detected drift but does NOT halt new emits. If divergence appears, every subsequent emit risks compounding it. Add a `smtRoots.haltEmits` boolean (or a separate flag table) checked at the top of `applyRevocationSMTUpdate`; reconciliation cron flips it on detected drift.
- **FU-2.2 Mutation-side root verification.** The Convex mutation accepts caller-computed `newRoot` without recomputing from the path (Poseidon2 doesn't run in Convex). Cheap structural validation already lands (path-key shifts, depth coverage, leaf-empty check). Defense-in-depth would be SvelteKit-side post-write read-back: re-fetch the path, recompute root via one Poseidon2 hash, compare. Adds one round trip + one hash per insert. Catches caller-bug drift before Wave 3 prover consumes the SMT.
- **FU-2.3 Mutation serial writes.** `applyRevocationSMTUpdate` reads existing rows in parallel (Wave 2 fix) but writes sequentially because Convex doesn't expose batched insert/patch. Throughput ceiling ~5–10 inserts/sec. Sufficient for launch volume; revisit if revocations ever spike.
- **FU-2.4 Cross-impl test for SMT hashing.** Add a test that runs the Noir circuit's `compute_revocation_smt_root` and the TS helper on identical input, asserts byte-equal root. Currently the agreement is by inspection only (both use `poseidon2_hash2(left, right)` walking 64 levels with bit-direction). Required before Wave 3 prover cutover.
- **KG-3 Grid-morph class toggle**: CLOSED 2026-04-24 via Wave 4. `AddressChangeFlow.svelte:93-130` wraps the phase=complete morph in `document.startViewTransition()` (with try/catch fallback to direct apply) so the vertical-stack → 2-column shift is a real animated position/size morph. The persistent prior-ground pane carries a per-instance `view-transition-name` (HMR / double-mount safe — REVIEW finding B) plus a `data-testid="prior-ground-pane"` hook for E2E. Pure UI polish, no backend changes.

### Wave 4 follow-ups (post-launch, NON-BLOCKING)

- **FU-4.1 Browser E2E auth fixture.** `tests/e2e/regrounding-flow.spec.ts` is a documented skeleton with `test.fixme()` markers. Three tests exercise browser-unique behavior (View Transitions API, Former-chip CSS leakage, beforeunload+ESC at OS event level) but require: (a) `auth.setup.ts` posting to a dev-only login endpoint to persist `storageState`, (b) test-build with `FEATURES.SHADOW_ATLAS_VERIFICATION=false` so the spec drives the address-input form (production routes through map-pin), (c) `data-step` anchors on AddressVerificationFlow's witnessing-list items so the ESC-during-witnessing assertion is tight (currently uses loose text matching).
- **FU-4.2 Witnessing-list data-step anchors.** Add `data-step="retire"|"attest"` to AddressVerificationFlow witnessing-list items so E2E and observability tools can target phase precisely. Today the only signal is text content, which is brittle to copy edits.

---

## Wave 1–4 closure summary (2026-04-24)

All four post-launch gaps closed. The system has gone from "GREEN to ship with 4 known gaps tracked" to "GREEN to ship with 4 closed + 12 documented post-launch follow-ups (FU-1.1–4.2)."

| Wave | Gap | Closure | Tests added |
|---|---|---|---|
| 1 + 1b | KG-4 ordering invariant | `convex/_credentialSelect.ts` + commitment-downgrade guard | 9 selector + 3 guard + 1 API |
| 2 + 2b | KG-2 SMT placeholder | Poseidon2-SMT in Convex + reconciliation cron | 12 correctness + 7 helper + 5 endpoint |
| 3 + 3b + 3c | KG-1 V2 prover wiring | Cross-impl byte-equality + V2 input shape + client glue + shared ZERO_HASHES | 7 cross-impl + 9 V2 validation |
| 4 + 4b | KG-3 grid-morph polish | View Transitions API + per-instance name + E2E skeleton | 3 fixme'd browser tests |

132 unit/integration tests passing + 1 todo + 3 fixme'd E2E. 8 brutalist review cycles across the four waves produced 12 documented follow-ups. None block launch.

---

## Waves 5–8 closure (2026-04-25)

All 14 documented follow-ups now closed across four additional waves. 3066 tests passing total (+ 1 pre-existing unrelated failure in `identity-encryption.test.ts` — stale Postgres reference, pre-Convex migration).

| Wave | Items | New tests | Brutalist cycles |
|---|---|---|---|
| 5 | FU-3.1 prover capability + FU-3.3 startup empty-tree gate + FU-2.1 drift kill-switch | 24 | 2 (+ 1 fix iteration) |
| 6 | FU-1.1 issuance-time authenticity + FU-3.2 freshness check + FU-1.3 commitment-gen metrics | 17 | 2 (self-review on quota exhaustion) |
| 7 | FU-1.2 helper extract + FU-3.4 property-based SMT + FU-4.1 E2E auth fixture + FU-4.2 data-step anchors | 25 | 1 |
| 8 | FU-2.2 mutation root verify + FU-2.3 throughput design (FU-1.4 + FU-3.5 reverted as overengineered) | ~5 | self-review on quota exhaustion |

### Reverts (2026-04-25)

After honest assessment of overengineering: reverted FU-1.4 and FU-3.5.
- **FU-1.4 reverted**: `credentialVersion` field on `districtCredentials` removed. The `!!c.districtCommitment` proxy in the downgrade guard works for the actual schema; the version field was forward-defense for a non-existent v3.
- **FU-3.5 reverted**: `featureFlags` Convex table + `convex/featureFlags.ts` + tests deleted. The runtime infra was built but never wired — the compile-time `FEATURES.V2_PROOF_GENERATION` is what `ProofGenerator.svelte` reads. The infra was speculative for a percentage canary that's not running.

Tracked as known limitations: when v3 schema actually emerges, add the version field; when a percentage canary actually runs, build the runtime infra.

### Fixes applied during review iterations

- **W5 R1**: fail-CLOSED on missing config in production (was 200 status:'config_missing'); content-validation in capability check (recomputed-root vs claimed-root); read-only contract instance decoupled from relayer wallet.
- **W5 R2**: separate `revocationFlags` table (no SMT pollution); `internalMutation` for operator-clear (was publicly callable); append-only `revocationHaltAuditLog`; bounded retry on cron halt-flip.
- **W6**: explicit IPFS timeout (8s); rate limit on metrics endpoint; CID alignment logged on mismatch.
- **W7**: actually removed mock-mirror (MockConvex now imports `applyDowngradeGuard`); fixed Property 4 dead loop.
- **W8**: post-write verification skips on concurrent-emit seq advance; verification failure flips kill-switch BEFORE throwing (prevents stranded "Convex ahead of chain" state).

### Engineering output

- **4 new Convex tables**: `smtNodes`, `smtRoots`, `revocationFlags`, `revocationHaltAuditLog` (`featureFlags` reverted)
- **6 new SvelteKit endpoints**: `/api/internal/health/empty-tree-root`, `/api/internal/metrics/client-event`, `/api/internal/revocation-root`, `/api/proofs/revocation-witness`, plus `/api/internal/emit-revocation` and `/api/identity/verify-address` rewrites
- **6 new shared modules**: `_credentialSelect.ts`, `_downgradeGuard.ts`, `revocation-smt.ts`, `revocation-witness.ts`, `verify-commitment.ts`, `zero-hashes.ts`
- **2 new design specs**: `REVOCATION-NULLIFIER-SPEC.md`, `SMT-WRITE-THROUGHPUT-DECISION.md`
- **1 new runbook**: `V2-PROVER-CUTOVER.md`
- **15 new test files** across unit + integration covering: SMT correctness, cross-impl byte-equality, V2 capability checks, kill-switch state, audit log, downgrade guard, property-based SMT, feature flags, witness fetch, prover validation
- **KG-4 Ordering-sensitive invariant** (`hasActiveDistrictCredential` vs `getActiveCredentialDistrictCommitment`): CLOSED 2026-04-24 via Wave 1 + 1b. Both queries now route through `convex/_credentialSelect.ts` `selectActiveCredentialForUser`. Canonical ordering: `issuedAt` desc primary, `_creationTime` desc tiebreak. Index-range optimization: `gt("expiresAt", now)` pushes expired-row exclusion to the storage layer. Paired with a commitment-downgrade guard in `verifyAddress` (`convex/users.ts:406-440`) that rejects verify requests omitting `districtCommitment` when the user has ever held one — prevents a silent client-side Poseidon failure from retiring a v2 credential and locking the user out of submissions. Covered by 37 passing tests across `credential-selector-invariant.test.ts`, `regrounding-cross-state.test.ts`, `regrounding-attack-sims.test.ts`, and `verify-address-throttle.test.ts`. Two brutalist review cycles (codex+claude+gemini) converged on closure with follow-ups below.

### Wave 1 follow-ups (post-launch, NON-BLOCKING)

- **FU-1.1 Issuance-time commitment authenticity.** The downgrade guard validates PRESENCE only. A malicious client can supply dummy hex and satisfy it; authenticity is enforced at the TEE gate (witness-commitment binding) downstream, where dummy commitments produce submissions that fail at the TEE gate. Server-side recomputation at verify time would close the residual surface but requires server access to H3 cell data (currently client-only). Track as separate initiative — not a Wave-2-dependency.
- **FU-1.2 Test-vs-production drift.** `MockConvex.verifyAddress` mirrors the mutation in-memory (~75 lines mirroring ~135). Any future mutation edit requires parallel mock edit. Mitigation path: extract `applyDowngradeGuard(existing, incoming)` as a pure helper, test it directly, or stand up convex-test harness. 30-minute task.
- **FU-1.3 Client-side commitment-failure observability.** If IPFS gateway is durably unavailable or a crypto regression hits production, users can't obtain a valid commitment and the guard will reject every verify attempt. Retries work (guard runs before throttle, so the throttle counter doesn't increment on rejection), but the user is pinned until their client dependency recovers. Add metrics: `verify_commitment_generation_failures_rate` client-side, alert threshold. Not blocking launch.
- **FU-1.4 Version field on credential schema.** Guard uses `!!c.districtCommitment` as a proxy for "user has held a v2-or-better credential." Future v3 schema evolution could silently misclassify. Add `credentialVersion: v.optional(v.number())` to `districtCredentials` when v3 is on the horizon.

## CI / ops checklist

### Environment variables (required for production)

Primary (Convex deploy + internal relayer):
- `INTERNAL_API_SECRET` — shared secret between Convex actions and `/api/internal/*` endpoints (emit-revocation, alert, anchor-proof, anchor-incidents).
- `CONVEX_DEPLOY_KEY` — Convex prod deploy; used for `rescueFailedRevocation` operator mutations.

On-chain (Scroll L2):
- `SCROLL_RPC_URL` — relayer RPC endpoint for DistrictGate + RevocationRegistry.
- `SCROLL_PRIVATE_KEY` — relayer wallet (funded with Scroll ETH).
- `DISTRICT_GATE_ADDRESS` — deployed DistrictGate contract.
- `REVOCATION_REGISTRY_ADDRESS` — deployed RevocationRegistry contract.
- `RELAYER_PRIVATE_KEY` — alternate name used in some services; confirm single canonical name pre-launch.

TEE:
- `TEE_RESOLVER_URL` — internal TEE resolver endpoint (Nitro Enclave).

### Cron enablement

- `reschedule-stuck-revocations` cron (`convex/crons.ts:199-201`) — calls `rescheduleStuckRevocations` every interval (default 1h). Required to drain the pending queue if a scheduler crashes mid-emit. Already active in `convex/crons.ts`; confirm enabled in prod.

### npm package publish step (post-launch)

To activate circuit-layer F1 closure (layer 4):

1. Publish `@voter-protocol/noir-prover@2.x` with `getThreeTreeProverForDepth` returning the V2 verifier (33 public inputs, revocation non-membership check).
2. In Commons: bump dependency, regenerate Convex types, redeploy.
3. Flip any V2 feature flag (confirm current shape — may be dynamic based on proof element count).
4. Replace the SMT placeholder in `/api/internal/emit-revocation` with a canonical sparse-merkle-tree implementation that RevocationRegistry.verifyNonMembership can consume.

Steps 1-3 unblock circuit-layer F1. Step 4 is required before non-membership checks can be published to the circuit — until then, the contract's flat `isRevoked[r]` mapping remains the on-chain source of truth.

## Rollout plan

### Phase R0 — current state (ready to ship)

- Feature flag: re-grounding UI already live via existing profile page integration (`handleChangeAddress`). No flag flip needed; the flow is reachable from `profile/+page.svelte`.
- All Stage 1/2/2.5/2.7/5 server gates live.
- V2 circuit layer dormant but harmless — V1 proofs continue to flow through three-gate resolver unchanged.

### Phase R1 — beta cohort monitoring (first 7 days post-launch)

Watch:
- `deliveryError === 'credential_revoked'` count — expect near-zero unless users are actually re-verifying. A spike means either active attack traffic (alert) or a bug in SessionCredential rotation (triage).
- `deliveryError === 'witness_commitment_mismatch'` count — should be zero from legitimate users. Any value > 0 is either active F1 attack traffic OR a poseidon sponge implementation drift between client and TEE (alert + triage).
- `ADDRESS_VERIFICATION_THROTTLED_24H` / `_180D` / `_EMAIL_SYBIL` rates — expected background noise. Document baseline.
- `rescheduleStuckRevocations` cron output — rescued count should be ≤ 5 per run under normal load. Higher = relayer is degraded.
- `revocationStatus === 'failed'` credentials count — should be 0. Any failed credential requires operator investigation via `rescueFailedRevocation`.

### Phase R2 — V2 prover enablement (post-launch, when npm package ships)

- Publish `@voter-protocol/noir-prover@2.x`.
- Canary: 10% of new proofs generated as V2 for 48h.
- Watch `verification_rejected` with `error === 'verifier_unavailable'` — this would indicate the npm package is installed but the V2 backend isn't available. Drop canary immediately if > 1%.
- Ramp: 50% at day 3, 100% at day 7.
- Deprecate V1 proof generation at day 14; keep V1 verifier indefinitely for grandfathered submissions.

### Abort criteria

Abort = "hold pre-launch revert, investigate before resuming":

- Any `witness_commitment_mismatch` from a known-good user whose credential is known-active (indicates a poseidon drift bug, not an attack).
- Any submission delivered after the issuing credential was `revokedAt` < now (would mean the TOCTOU gate is broken).
- Any user for whom `getActiveCredentialDistrictCommitment` returns a different value than `hasActiveDistrictCredential`'s selected row's commitment (would mean KG-4's ordering drift materialized).
- Any credential in `revocationStatus === 'failed'` on Scroll L2 within 48h of issue (would mean relayer or registry is broken).
- UI: any report of the re-grounding ceremony landing the user in a half-retired state (credential cleared client-side but not re-issued server-side). Requires log inspection + IndexedDB audit.

## Verdict

GREEN to ship. The four known gaps are non-blocking with explicit post-launch tracking. Defense-in-depth at F1 and F2 holds with three+ independent layers each. Test coverage (24 passing + 1 todo across cross-state / attack-sims / stress) asserts the invariants the design depends on. The dwell check confirms the UI atmosphere holds across every phase of the ceremony.
