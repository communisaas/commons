# V2 Prover Cutover Runbook

> **Status:** DRAFT, post-launch operator-run
> **Companions:** `V2-CREDENTIAL-CUTOVER.md` (preceding step), `REGROUNDING-LAUNCH-READINESS.md` Phase R2
> **Wave:** 3 (KG-1 closure)

Wave 3 transitions client proof generation from V1 (31 public inputs) to V2 (33 inputs, F1 closure with `revocation_nullifier` + `revocation_registry_root`). The server side already accepts both during the migration window — the cutover is unilaterally a client-side feature flag flip.

---

## 0. Prerequisites — HARD GATE

Do not proceed unless ALL of the following are true. Each is a separate ship-block.

- [ ] **`@voter-protocol/noir-prover@2.x` published to npm** with `getThreeTreeProverForDepth` returning a V2 prover that accepts `revocationPath` + `revocationPathBits` witnesses and produces 33 public inputs.
- [ ] **Cross-impl SMT byte-equality test passes**:
      `cd voter-protocol/packages/crypto/noir/three_tree_membership && nargo test test_smt_cross`
      AND
      `cd commons && npx vitest run tests/unit/server/revocation-smt-cross-impl.test.ts`
      Both sides MUST agree on the empty-tree root and the slot-0 / slot-1 single-insert roots. If either fails, the V2 circuit and the off-chain SMT have drifted; abort.
- [ ] **`RevocationRegistry` deployed with matching `EMPTY_TREE_ROOT`.**
      The contract's constructor `_emptyTreeRoot` argument MUST equal the value asserted by both the Noir test (`SMT_CROSS_IMPL_EMPTY_ROOT`) AND the TS helper's `getEmptyTreeRoot()`. **HARD GATE — call the deploy-time check (FU-3.3) and assert the response body, not just HTTP status:**
      ```bash
      RESPONSE=$(curl -fsS -H "X-Internal-Secret: $INTERNAL_API_SECRET" \
        https://your-deploy/api/internal/health/empty-tree-root)
      echo "$RESPONSE" | jq -e '.status == "ok"' >/dev/null \
        || { echo "EMPTY_TREE_ROOT gate failed: $RESPONSE"; exit 1; }
      ```
      Status semantics:
      - `200 {status:"ok"}` → contract matches; proceed
      - `200 {status:"config_missing"}` → only in non-prod or with `?allow_missing=1`; do NOT treat as success in production deploys (the script above rejects it)
      - `500 {status:"mismatch"}` → contract was deployed wrong; abort deploy, redeploy with the value in `body.computedEmpty`
      - `502` → transient RPC failure; retry up to 3 times with 10s backoff before hard-failing
      - `503` → production deploy missing `REVOCATION_REGISTRY_ADDRESS` env var; fix env and redeploy

      The reconciliation cron (`reconcileSMTRoot`) catches drift hourly post-launch; this synchronous endpoint closes the 1h pre-cron deploy window.
- [ ] **V2 verifying key registered in `DistrictGate.VerifierRegistry`** for the same depth Commons uses (CIRCUIT_DEPTH = 20). Verify via `DistrictGate.verifierForDepthV2(20)` returning a non-zero address.
- [ ] **V2-CREDENTIAL-CUTOVER complete.** Every active production credential carries a `districtCommitment` (the V2 prover derives `revocation_nullifier` from it). Convex query: `db.districtCredentials.filter(c => !c.revokedAt && !c.districtCommitment).count()` returns 0.
- [ ] **`reconcileSMTRoot` cron healthy for ≥ 24h.** Convex SMT root and on-chain `currentRoot` agree; no `severity: 'critical'` or `severity: 'high'` events. Verify halt is NOT active:
      ```bash
      npx convex run revocations:getRevocationHaltStatus
      # Expected: { halted: false, ... }
      ```

### If the kill-switch fires (FU-2.1 incident response)

When `reconcileSMTRoot` detects critical or high-severity drift, it calls `setRevocationHalt`, which sets `revocationFlags.isHalted = true` and appends a row to `revocationHaltAuditLog`. Subsequent emit attempts return `kind: 'config'` terminal errors.

To investigate:
1. Check current state: `npx convex run revocations:getRevocationHaltStatus`
2. Review the audit log: `npx convex run revocations:getRevocationHaltAuditLog`
3. Investigate the drift cause (chain RPC, Convex state, contract redeploy).

To clear the halt after investigation:
```bash
npx convex run revocations:operatorClearRevocationHalt \
  --arg confirmation:'"i-have-investigated-the-drift"' \
  --arg incidentRef:'"INC-XXX"' \
  --arg actorPrincipal:'"oncall-name"'
```

The clear is gated on (a) the confirmation string, (b) a non-trivial incident ref, (c) a non-empty actor principal. The mutation is `internalMutation` — invocable only with `CONVEX_DEPLOY_KEY`. Every clear (including no-op clears against an inactive halt) is recorded in the append-only audit log.

---

## 1. Canary plan (Phase R2)

`FEATURES.V2_PROOF_GENERATION` in `src/lib/config/features.ts` is a **compile-time constant**. The Wave 3b implementation wires it into `ProofGenerator.svelte:177-200`: when `true`, the client fetches the V2 non-membership witness via `/api/proofs/revocation-witness` and threads `revocationPath` + `revocationPathBits` + `revocationRegistryRoot` into `mapCredentialToProofInputs`. Build-time flip = binary cohort behavior in that build.

**Honest constraint:** Commons does NOT have runtime feature-flag infrastructure for this flag. "10% canary" cannot be implemented as a runtime split inside one bundle. Two routes are available:

- **Path A — runtime flag (preferred but not built):** add a Convex `featureFlags` query that returns per-user-or-per-session V2 enablement. Replace the `FEATURES.V2_PROOF_GENERATION` static check with the runtime read. Requires a separate ticket.
- **Path B — staged build deploys (available today):** deploy a `V2_PROOF_GENERATION: false` build to production, then deploy a separate `true` build to a staging environment under a flag (e.g., a "canary" subdomain). Direct 10% of session traffic to the canary via DNS or CDN routing. This is a deployment-procedure choice, not a code-level toggle.

Until Path A exists, percentage figures below describe the FRACTION OF TRAFFIC routed to the V2-enabled build, not a runtime split inside one bundle. Day 0 = 10% of sessions hit the V2 build; day 7 = 100%.

If neither runtime flag nor staged-build routing is set up, a single binary cutover (`false` → `true` → redeploy) is the only option, and the canary plan reduces to "smoke-test on staging, then flip prod."

**Day 0 — 10% canary (24h soak)**

1. Deploy V2-aware bundle (Path A: feature-flag user cohort; Path B: routed canary subdomain).
2. Watch the Day-0 metrics below for 24 hours.
3. Abort criteria — any one fails:
   - `verification_rejected` rate > 1% with on-chain revert reason mentioning `verifier_unavailable` or unregistered verifying key
   - `proof_generation_failure` rate > 2% with stage in {`v2_witness_fetch`, `v2_path_validation`, prover-init failures}
   - Any `submission delivered` for a credential whose `districtCommitment`-derived nullifier returns true from `RevocationRegistry.isRevoked` (= F1 attack succeeded)
   - `reconcileSMTRoot` cron returns `severity: 'critical'` in the canary window (`empty_tree_root_mismatch` or unexplained drift)

**Important:** the runbook's prior assertion that the submission endpoint "cross-checks `revocationRegistryRoot` against Convex `currentRoot`" was aspirational. The current submission endpoint validates the proof's structural shape and BN254 ranges; the application-layer freshness check against Convex is **not yet wired**. The on-chain `RevocationRegistry.isRootAcceptable` view (with the 1-hour archive TTL) is the operative defense. Track `revocation_root_stale` only after that application-layer check exists; until then, expect to see archive-TTL rejections surfacing as on-chain reverts, not as a categorized server-side error.

**Day 3 — 50% (4-day soak)**

Same gates. Halve the abort thresholds (V2 should be steady state at this point).

**Day 7 — 100%**

All sessions on V2.

**Day 14 — V1 deprecation**

Hard-flip the V1 generation path off in client. Server keeps V1 verifier indefinitely for grandfathered submissions. Update `REGROUNDING-LAUNCH-READINESS.md` to mark KG-1 closed.

---

## 2. Day-0 monitoring

Watch in addition to standard launch dashboards:

| Metric | Healthy | Investigate | Abort |
|---|---|---|---|
| `proof_generation_v2_count` | rising in proportion to flag % | flat at 0 (flag not flipped) | — |
| `verification_rejected{error="verifier_unavailable"}` | 0 | > 0 (any) | > 1% canary |
| chain reverts citing `RevocationRegistry.isRootAcceptable=false` | 0 | > 0 — implies either Convex drift or stale proof beyond archive TTL | > 0.5% canary |
| `proof_generation_failure{stage="v2_witness_fetch"}` | 0 | > 0 (any) | > 2% canary |
| `proof_generation_failure{stage="v2_path_validation"}` | 0 | > 0 — partial-input bug, malformed Convex response | any |
| `revocation_root_skew_ms` (Convex root - on-chain root timestamp) | < 5min | 5–60min | > 60min |
| `reconcileSMTRoot` `severity` | `ok` or `genesis` | `high` | `critical` |

---

## 3. Witness path data flow (V2)

Client-side per-proof flow:

1. Compute `district_commitment` = Poseidon2 sponge over user's 24 cell-district slots (already done in V1).
2. Compute `revocation_nullifier` = `H2(district_commitment, REVOCATION_DOMAIN)`.
   _(REVOCATION_DOMAIN is FROZEN at `0x636f6d6d6f6e732d7265766f636174696f6e2d7631` — UTF-8 "commons-revocation-v1".)_
3. Fetch non-membership path from Convex:
   ```ts
   const { path, pathBits, currentRoot } = await client.query(
     internal.revocations.getRevocationNonMembershipPath,
     { revocationNullifier }
   );
   ```
4. Replace any `null` siblings with the depth-d empty-subtree value (computed via `getEmptyTreeRoot()`-style recurrence).
5. Pass to prover:
   ```ts
   await generateThreeTreeProof({
     ...v1Inputs,
     revocationPath: filledPath,
     revocationPathBits: pathBits,
     revocationRegistryRoot: currentRoot ?? computedEmptyRoot,
   });
   ```
   The prover exposes `revocationRegistryRoot` as public input [32]; **the
   submission endpoint does NOT currently cross-check this against Convex's
   `currentRoot`** (planned, see post-launch tracker). On-chain
   `RevocationRegistry.isRootAcceptable` (with 1-hour archive TTL) is the
   operative defense today.
6. Submit. Resolver-gates routes by `publicInputsArray.length` (33 → V2). On-chain `verifyThreeTreeProofV2` validates.

---

## 4. Rollback

If any abort criterion fires:

1. Flip `FEATURES.V2_PROOF_GENERATION` to `false`. Redeploy.
2. In-flight V2 proofs continue to verify (server keeps both verifiers).
3. New proofs return to V1 path. No data migration needed.
4. Investigate root cause; do not re-attempt cutover without a documented fix.

---

## 5. Known V1/V2 coexistence semantics

- **Verifier:** Both V1 and V2 verifying keys live in `VerifierRegistry`. `verifyThreeTreeProof` → V1, `verifyThreeTreeProofV2` → V2.
- **Submission endpoint:** `/api/submissions/create` accepts 31 OR 33 public inputs. The structural validator at `src/routes/api/submissions/create/+server.ts:128-147` keys off length.
- **TEE resolver gate:** `src/lib/server/tee/resolver-gates.ts` accepts both. Witness-commitment binding (Stage 2.7) operates the same in both modes — it consumes `districtCommitment` from the SessionCredential, not a circuit input.
- **Action domain:** v2 includes `districtCommitment` in the keccak preimage. Both V1 and V2 proofs are bound to the same domain when issued under v2 SessionCredentials.
- **Revocation set:** V2 proofs verify non-membership against the on-chain SMT root. V1 proofs do NOT consult the SMT — they are blocked at the Stage 1 server gate (`hasActiveDistrictCredential`) instead. F1 attack is closed at the server boundary for V1 traffic and at the cryptographic boundary for V2 traffic.

---

## 6. Verification commands

```bash
# Confirm V2 prover is installed and usable
cd commons
node -e "import('@voter-protocol/noir-prover').then(m => console.log(Object.keys(m)))"

# Sanity-check the V2 verifier address is set
cast call $DISTRICT_GATE_ADDRESS "verifierForDepthV2(uint8)(address)" 20 --rpc-url $SCROLL_RPC_URL

# Confirm the SMT root agrees on both sides
cast call $REVOCATION_REGISTRY_ADDRESS "currentRoot()(bytes32)" --rpc-url $SCROLL_RPC_URL
# Compare to:
npx convex run revocations:getRevocationRoot
```
