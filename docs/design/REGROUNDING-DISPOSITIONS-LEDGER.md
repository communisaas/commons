# Re-grounding Dispositions Ledger

Stage 4d — every CRITICAL and HIGH finding from adversarial reviews 0 through 5.5, mapped to the file location where it was closed and the test that asserts the fix. The four known-gap items from Stage 4 preamble are tracked at the bottom.

Finding ID schema: `R{review}-{severity}-{ordinal}` — for example, `R2.5-CRIT-1` is the first CRITICAL finding from Review 2.5.

## Review 0 — initial threat model (F1 / F2 definition)

| ID | Severity | Finding | Resolution | File:line | Test |
|---|---|---|---|---|---|
| R0-CRIT-1 | CRIT | F1: stale-proof replay — a client with a revoked credentialHash could still submit proofs server-side | Active-credential gate at submission-insert: reject `NO_ACTIVE_DISTRICT_CREDENTIAL` | `convex/submissions.ts:51-63` | `regrounding-attack-sims.test.ts` → F1 (i) |
| R0-CRIT-2 | CRIT | F2: district-hopping — re-verifying to different districts spawned new nullifier scopes each time, enabling N-fold amplification | Re-verification throttle (24h / 6-per-180d) + email-sybil gate | `convex/users.ts:405-432` | `regrounding-attack-sims.test.ts` → F2 throttle + sybil |

## Review 1 — server hardening (Stage 1 delivery)

| ID | Severity | Finding | Resolution | File:line | Test |
|---|---|---|---|---|---|
| R1-CRIT-1 | CRIT | TOCTOU window: revocation could fire AFTER submission was accepted but BEFORE delivery dispatched | Delivery recheck via `isCredentialActive` → `credential_revoked_or_expired` | `convex/submissions.ts:967-992` | `regrounding-attack-sims.test.ts` → F1 (ii) |
| R1-HIGH-1 | HIGH | verificationMethod was client-supplied; a client could claim "mdl" to skip the tier-3 throttle bypass | Allowlist check at verifyAddress | `convex/users.ts:395-398` | verified via manual code review; allowlist constant `ADDRESS_VERIFICATION_METHODS` at `convex/users.ts:357` |
| R1-HIGH-2 | HIGH | Throttle used `issuedAt` but didn't scope by userId leak vector; malicious proxy could bypass throttle via new account | Email-sybil gate scoped by `users._creationTime` caps distinct userIds per emailHash within 180d | `convex/users.ts:416-431` | `regrounding-attack-sims.test.ts` → F2 email-sybil |
| R1-HIGH-3 | HIGH | Reports leaked tier-3 membership via non-partition counts | Tier-3 partition in analytics reports | verified in `convex/submissions.ts` reports path (Stage 1 deliverable) | not test-asserted (partition is a query-shape change; inspection-only) |

## Review 2 — action_domain v2 (districtCommitment binding)

| ID | Severity | Finding | Resolution | File:line | Test |
|---|---|---|---|---|---|
| R2-CRIT-1 | CRIT | action_domain did not include districtCommitment — a leaked credentialHash let attacker reuse action_domain across districts | v2 preimage binds districtCommitment: `keccak(templateId ‖ actionId ‖ districtCommitment ‖ chainId)` | `src/lib/core/crypto/action-domain.ts` (v2 builder) | covered by `tests/unit/crypto/action-domain.test.ts` pre-existing |

## Review 2.5 — integration (SessionCredential + ProofGenerator)

| ID | Severity | Finding | Resolution | File:line | Test |
|---|---|---|---|---|---|
| R2.5-CRIT-1 | CRIT | SessionCredential schema lacked `districtCommitment`; ProofGenerator fell back to undefined and produced invalid action_domain | SessionCredential now carries `districtCommitment`; server canonical recompute threads it | `src/lib/core/identity/session-credential.ts`, `src/lib/core/zkp/ProofGenerator.ts` | `regrounding-cross-state.test.ts` → "getActiveCredentialDistrictCommitment returns the NEW commitment" |
| R2.5-HIGH-1 | HIGH | Migration: v1 credentials (no districtCommitment) would silently fail canonical match | `CREDENTIAL_MIGRATION_REQUIRED` error path forces re-verify | `convex/submissions.ts:993-1022` (`credential_commitment_missing` delivery error) | verified via `regrounding-cross-state.test.ts` → "credential without a prior districtCommitment does not schedule on-chain emit" (edge-case handling) |
| R2.5-HIGH-2 | HIGH | Stale SessionCredential cache: non-regrounding re-verify left the prior commitment cached client-side, wedging subsequent sends | `clearSessionCredential(userId)` called unconditionally on successful re-verify | `src/lib/components/auth/AddressVerificationFlow.svelte:517-528` | covered by the pre-existing `AddressChangeFlow.test.ts` (excluded from vitest run per config; verified via inspection) |

## Review 2.7 — TEE witness-to-commitment binding

| ID | Severity | Finding | Resolution | File:line | Test |
|---|---|---|---|---|---|
| R2.7-CRIT-1 | CRIT | Resolver did not verify witness.districts hashed to the server commitment. A prover with leaked `credentialHash` could learn a victim's `districtCommitment`, construct `action_domain` against it, then submit a proof generated with THEIR OWN districts — other gates would still pass | `verifyWitnessDistrictCommitment` hashes `witness.districts` via `poseidon2Sponge24` and constant-time-compares to `expected.districtCommitment` | `src/lib/server/tee/resolver-gates.ts:195-237` | `regrounding-attack-sims.test.ts` → F1 (iii) witness-commitment-mismatch + happy-path control |
| R2.7-HIGH-1 | HIGH | Missing `expected.districtCommitment` fail-opened to old behavior | Defensive reject: treat empty commitment as `witness_districts_malformed` | `src/lib/server/tee/resolver-gates.ts:210-216` | covered by `tests/unit/tee/resolver-gates.test.ts` (pre-existing) |

## Review 3 + 3.5 + 3.7 — UI (AddressChangeFlow re-grounding)

| ID | Severity | Finding | Resolution | File:line | Test |
|---|---|---|---|---|---|
| R3-CRIT-1 | CRIT | Witnessing list used timers, not real async boundaries — user could dismiss mid-retire leaving a half-retired state | Witnessing bound to REAL async: `clearConstituentAddress` + `clearSessionCredential` happen in `Promise.all`, then `/api/identity/verify-address` fires with in-flight indicator | `src/lib/components/auth/AddressVerificationFlow.svelte:392-447` | not directly asserted in new tests; regression-tested by the single-flight handler path in cross-state test |
| R3-HIGH-1 | HIGH | Close × during witnessing could leave partial state | `beforeunload` guard + ESC guard + disabled close button during phase='witnessing' | `src/routes/profile/+page.svelte:167-216` | inspection only; UI behavior is out-of-scope for vitest integration tests |
| R3.5-HIGH-1 | HIGH | Grid-morph from vertical stack to horizontal WAS/IS grid was a structural remount — the old-ground pane dismounted, breaking continuity | Single-surface composition: Zone 1 stays mounted; grid is a class toggle on the parent div | `src/lib/components/auth/AddressChangeFlow.svelte:129-196` | inspection only |
| R3.7-HIGH-1 | HIGH | "Your representatives have changed" headline was just text, not anchored to an actual diff — could show even when reps carried over | `districtChanged` / `stateChanged` derived booleans drive the three-way headline (reps changed / senators changed / reps carry forward) | `src/lib/components/auth/AddressVerificationFlow.svelte:1441-1452` | inspection only |

## Review 5 — crypto closure (Noir V2 + RevocationRegistry)

| ID | Severity | Finding | Resolution | File:line | Test |
|---|---|---|---|---|---|
| R5-CRIT-1 | CRIT | F1 closure at circuit layer: V1 proofs had no revocation_nullifier public input — attacker with stolen keys could generate fresh proofs forever | V2 circuit adds `revocation_nullifier` (index 31) + `revocation_registry_root` (index 32); `verifyThreeTreeProofV2` checks non-membership | Noir V2 circuit + `src/lib/core/blockchain/district-gate-client.ts` (V1/V2 routing) | NOT in new test suite — V2 prover npm package unpublished; defense-in-depth at server level still asserted (see R0-CRIT-1, R1-CRIT-1, R2.7-CRIT-1) |
| R5-CRIT-2 | CRIT | RevocationRegistry needed: a smart-contract-resident set of revoked nullifiers that verifiers can check on-chain | `RevocationRegistry.sol` (SMT-based) deployed on Scroll L2 | contract source in voter-protocol repo; Convex `emitOnChainRevocation` action wires it | `revocation-stress.test.ts` → emit flow (state machine only; contract integration dormant until V2 prover ships) |
| R5-HIGH-1 | HIGH | Emit action must not block verifyAddress; must handle transient RPC failures without losing credentials | Exponential backoff (6 tries, 1m→24h) + stuck-pending cron (1h) + rescueFailedRevocation operator mutation | `convex/users.ts:1350-1434` (emitOnChainRevocation + rescueFailedRevocation); `revocation-stress.test.ts` → all retry/reschedule tests | `revocation-stress.test.ts` (6 tests) |

## Review 5.5 — wire end-to-end

| ID | Severity | Finding | Resolution | File:line | Test |
|---|---|---|---|---|---|
| R5.5-HIGH-1 | HIGH | Emit path needed relayer shim; direct contract call from Convex action impossible | `/api/internal/emit-revocation` endpoint (INTERNAL_API_SECRET-gated) + district-gate-client V1/V2 routing | `src/routes/api/internal/emit-revocation/+server.ts` | inspection (endpoint not exercised by these tests — it wraps the same state machine covered by `revocation-stress.test.ts`) |
| R5.5-HIGH-2 | HIGH | Terminal statuses (confirmed / failed) should short-circuit retries — a confirmed emit should never re-fire | Terminal-kind guard at top of `emitOnChainRevocation` | `convex/users.ts` emitOnChainRevocation early-exit branch | covered by `tests/integration/revocation-flow.test.ts` (pre-existing) — "does not revive failed credentials" + "retry budget respected" |

---

## Known-gap items from Stage 4 preamble (non-blocking)

| ID | Severity | Gap | Launch impact | Tracking |
|---|---|---|---|---|
| KG-1 | LOW | V2 Noir prover npm package unpublished; all live submissions are V1 (31 public inputs) | Not launch-blocking. Defense-in-depth at server level (R0-CRIT-1, R1-CRIT-1, R2.7-CRIT-1) still active — F1 is closed at three server surfaces independent of V2 rollout | post-launch: publish `@voter-protocol/noir-prover@2.x` and flip `FEATURES.V2_PROOFS` |
| KG-2 | LOW | SMT root computation in `/api/internal/emit-revocation` is placeholder (keccak cascade, not a real SMT) | Not launch-blocking. RevocationRegistry's flat `isRevoked[r]` mapping is the operative F1 defense on-chain; the SMT is for future V2 prover non-membership checks | post-launch: replace with canonical SMT implementation before V2 prover flip |
| KG-3 | LOW | Grid-morph animation in AddressChangeFlow is class toggle (CSS transition), not FLIP / view-transition | Polish only. No state is at risk. | post-launch polish |
| KG-4 | LOW | `hasActiveDistrictCredential` (submissions.ts) and `getActiveCredentialDistrictCommitment` (users.ts) use different credential-selection ordering. Only safe because `verifyAddress` revokes prior BEFORE issuing the new row (single active row invariant) | Not launch-blocking as long as verifyAddress atomicity holds. Cross-state test asserts "exactly one active credential per user" invariant | `regrounding-cross-state.test.ts` + `revocation-stress.test.ts` "same userId re-verifying 10 times ends with exactly 1 active row" — if the invariant breaks, both tests fail |
