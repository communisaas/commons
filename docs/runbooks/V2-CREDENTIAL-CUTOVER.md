# V2 Credential Cutover Runbook

> **Status:** DRAFT, operator-run
> **Companion:** `voter-protocol/specs/CIRCUIT-REVISION-MIGRATION.md`, `voter-protocol/contracts/DEPLOYMENT-V2.md`

This document covers the Commons-side steps to retire every v1 `districtCredentials` row and seed `RevocationRegistry` with the matching revocation nullifiers at the v1 -> v2 circuit cutover.

---

## 0. Prerequisites

The chain-side deployment (`DEPLOYMENT-V2.md`) must already be in a state where:

- `RevocationRegistry` is deployed.
- The Commons relayer signer is an authorized relayer on the registry.
- `DistrictGate.revocationRegistry` points at the deployed registry (either via genesis or executed timelock).
- v2 HonkVerifiers are deployed and queued or active in `VerifierRegistry`.

The Commons-side deployment must have:

- Convex schema bumped to Stage 5 (`districtCredentials.revocationStatus`, `revocationTxHash`, `revocationAttempts`, `revocationLastAttemptAt`).
- `internal.users.emitOnChainRevocation` action available in Convex.
- `reschedule-stuck-revocations` cron registered.
- `/api/internal/emit-revocation` HTTP endpoint live and wired to the relayer wallet.

## 1. Pre-launch assumption — explicit

**Commons has no production users as of this cutover.** Every active
credential is a beta/test credential. Operator signs off on this assumption
before running the script.

If any production user exists:
- Send re-verification comms at least 72 hours before cutover.
- Shrink the cutover window to minimize the gap during which all users must
  re-verify.
- Expect a one-time spike in `verifyAddress` calls — the Stage 1 rate limit
  (24h cooldown per user) will absorb normal traffic, but a global forced
  migration may require temporarily relaxing throttles.

## 2. Dry run

```bash
cd commons
export CONVEX_URL=https://<deployment>.convex.cloud
export CONVEX_ADMIN_KEY=<ops key>

npx tsx scripts/cutover-v1-credentials.ts
```

Output lists every active credential that would be patched. No DB write.
Read and verify:
- Total count matches expectation (beta-tester count).
- `With districtCommitment` bucket should be ~= total (post-sponge-24
  credentials are the common path).

## 3. Notify beta testers (if any)

Send email / in-app notice:
- "One-time security upgrade: you will be prompted to re-verify your address
  on your next visit. This is expected. Nothing else changes."

## 4. Execute the cutover

```bash
npx tsx scripts/cutover-v1-credentials.ts --execute
```

Runs:
- For each active credential: sets `revokedAt: now`.
- Where `districtCommitment` is set: also sets `revocationStatus: "pending"`
  and schedules `internal.users.emitOnChainRevocation(credentialId)`.

Expected time: ~1 minute per 1K credentials. Convex mutations are serialized
per-row so parallelism is safe.

## 5. Monitor on-chain propagation

Poll the Convex dashboard or run:

```bash
# In Convex dashboard query console:
#   districtCredentials.filter(c => c.revocationStatus === 'pending')
```

Expected progression over ~30 minutes:
- `pending` count should drop steadily as the scheduled emits land.
- `confirmed` count grows with `revocationTxHash` populated.
- `failed` count should be 0. If non-zero: operator investigation required.

Cron `reschedule-stuck-revocations` (every 15 min) re-queues credentials
whose `revocationLastAttemptAt` is older than 1 hour. Up to
`MAX_REVOCATION_ATTEMPTS` (6) retries with exponential backoff.

## 6. Post-cutover verification

1. Log into the app as a beta tester.
2. Attempt to submit a proof. Expected: `CREDENTIAL_MIGRATION_REQUIRED` or
   "your proof credential needs to be updated" prompt.
3. Re-verify address via the normal flow.
4. After re-verify, confirm a new `districtCredentials` row exists with
   `revocationStatus = undefined` (fresh credential; will be revoked on
   next rotation, not now).
5. Generate a v2 proof and submit. Expected: proof verifies on-chain via
   `verifyThreeTreeProofV2`.

## 6.5. Recovery — rescuing `failed` revocations

When an on-chain revocation emit exhausts its 6-attempt exponential-backoff
budget, the credential's `revocationStatus` flips to `failed` and an alert
fires via `/api/internal/alert` (code `REVOCATION_EMIT_FAILED`). The credential
is still revoked server-side (`revokedAt` is set) so no submissions proceed,
but the on-chain set is out of sync. The Stage 5.5c rescue path gives operators
a first-class replay mechanism.

### Find failed rows

Via the Convex dashboard query console:

```
internal.users.listFailedRevocations({})
```

Returns up to 100 rows (pass `{limit: 500}` for the full cap). Each row
carries the minimum for triage: `_id`, `userId`, `revokedAt`,
`revocationAttempts`, `revocationLastAttemptAt`, `hasDistrictCommitment`.

No PII is included — correlate via Convex dashboard if an operator needs to
tie a row to an end-user.

### Diagnose

Before retrying, determine WHY the prior emits failed — a blind retry just
burns the retry budget again. Check in order:

1. **Sentry** for `REVOCATION_EMIT_FAILED` alerts — the alert payload includes
   `lastError` (first 200 chars) which usually points at the class of
   failure (`rpc_transient`, `contract_revert`, or `config`).
2. **Relayer balance** — `getRelayerHealth()` surface exposed at the internal
   admin endpoint. If `balanceStatus === 'critical'`, top up the relayer
   before retrying.
3. **Scroll RPC health** — the circuit breaker in `district-gate-client.ts`
   opens after 3 failures in 60s; check `getCircuitBreakerState()`. A
   chronically-open breaker indicates an RPC-provider issue.
4. **Registry authorization** — if the relayer was recently rotated and the
   new signer hasn't completed the 10-minute timelocked authorization
   proposal, every emit will revert `UnauthorizedRelayer`.
5. **Registry paused state** — governance may have paused the registry
   during incident response.

### Replay

Once the root cause is remediated, replay a single failed row:

```
internal.users.rescueFailedRevocation({credentialId: "<the Convex Id>"})
```

Returns `{rescued: true}` on success or `{rescued: false, reason: "..."}` on
a no-op. The rescue:

- resets `revocationStatus` → `pending`, `revocationAttempts` → `0`,
  `revocationLastAttemptAt` → `now`;
- schedules `internal.users.emitOnChainRevocation` immediately.

The standard 6-attempt exponential-backoff resumes from attempt 1. Confirm
success by re-querying `listFailedRevocations` — the row should be gone.

### Batch replay

For bulk recovery (e.g., after a multi-hour Scroll RPC outage), script the
rescue loop off the cutover pattern:

```bash
# From the cutover script's environment:
# fetch failed rows, then iterate rescueFailedRevocation per-_id.
# Respect the 60-req/min relayer rate limit.
```

No dedicated script is shipped because failed-row volume is expected to be
near-zero; the cron-level retries cover transient failures before they reach
`failed`. If failed volume grows beyond ~10 rows, investigate the systemic
cause rather than replaying individually.

## 7. Rollback

If a critical defect emerges within 24 hours:

1. `cast send $DISTRICT_GATE "pause()"` — immediate halt to new submissions.
2. Restore the Convex backup taken before the cutover. DO NOT manually reset
   individual rows — the on-chain revocation emits are irreversible, so
   partial rollback creates desync between DB state and on-chain state.
3. Coordinate with the on-chain rollback procedure in
   `voter-protocol/contracts/DEPLOYMENT-V2.md#rollback`.

The on-chain revocations cannot be un-emitted; a Commons rollback to v1
means those old credentials are revoked on-chain forever but no v1 proof
consults the registry, so they are harmless.

## 8. Known limitations

- **No dry-run for on-chain emits.** The script schedules emits that execute
  immediately. If the relayer endpoint is down, emits fail and retry; if it
  is misconfigured, the entire batch could land as `failed`. Verify
  `/api/internal/emit-revocation` is live BEFORE running with `--execute`.
- **Rate limit on the relayer endpoint.** `INTERNAL_API_SECRET` is not rate
  limited, but the relayer wallet can emit only ~one tx per block on
  Scroll. ~3 seconds per emit. 1K credentials = ~50 minutes of cron churn.
- **No reversal of `revokedAt`.** Once set, a credential is dead. Users must
  re-verify.
