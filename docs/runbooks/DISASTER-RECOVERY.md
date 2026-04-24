# Disaster Recovery Runbook

**RTO**: 4 hours | **RPO**: Continuous (Convex point-in-time recovery)

## Current DR Posture

- **Primary data store: Convex** (`convex/schema.ts`, ~71 tables). Convex
  provides native point-in-time recovery and snapshots via its dashboard
  and CLI (`npx convex export`).
- **Shadow Atlas pinning — OPERATIONAL DR RISK**: `pin-to-ipfs.ts` is
  hardcoded to Storacha. **Storacha uploads disabled 2026-04-15; full
  sunset 2026-05-31.** Client-side ZKP fetches cell chunks through
  `storacha.link/ipfs` — post-sunset that gateway 404s. Pinata import
  exists but is never instantiated. **Pinning-provider migration must
  complete before 2026-05-31** or Shadow Atlas restore fails. See
  `docs/specs/CHUNKED-ATLAS-PIPELINE-SPEC.md` §4.4.
- **PII encryption keys remain FROZEN** (AES-256-GCM). Loss is
  unrecoverable. Per-org sealed keys (`convex/_orgKey.ts`,
  `sealedOrgKey`), `ENTROPY_ENCRYPTION_KEY`, and Bridge KV
  (`bridge-crypto.ts`, HKDF-derived AES-256-GCM) must all be backed up
  separately.
- **TEE recovery is not yet covered**: TEE is Planned; witness
  decryption currently runs in `LocalConstituentResolver` (CF Worker
  process). No HSM / sealed recovery yet.
- **Deploy cutover:** `npm run build && wrangler pages deploy
  .svelte-kit/cloudflare --project-name commons --branch production` +
  `npx convex deploy --env-file .env.production` (note: `-y` silently
  fails for prod — always pass `--env-file`).
- **Rate limiter:** `SlidingWindowRateLimiter` uses `REDIS_URL` if set;
  otherwise in-memory. DR-sensitive: restoring to an env without Redis
  loses rate-limit state across restarts.

## Prerequisites

- Convex CLI (`npm i -g convex` or `npx convex`)
- Access to the Convex dashboard for the production deployment
- Cloudflare Pages dashboard access (to roll back frontend deploys)
- Access to the secrets manager holding PII encryption keys

## 1. Assess

1. Determine the failure mode: data corruption, accidental deletion,
   full deployment loss, or infrastructure failure.
2. Identify the last clean snapshot via the Convex dashboard.
3. Calculate data loss window: time between last snapshot and incident.

## 2. Notify

- Alert engineering team and stakeholders with:
  - Incident description
  - Estimated data loss window
  - Expected RTO (target: 4 hours from incident detection)

## 3. Restore via Convex

**Option A: Point-in-time recovery on the existing deployment**

Use the Convex dashboard → Data → Restore. Pick the latest clean
timestamp. Convex applies the restore in-place; no re-provisioning
needed.

**Option B: Restore to a new deployment** (full infrastructure failure)

1. Provision a new Convex deployment (dashboard → Projects → New
   deployment).
2. Export the latest snapshot:
   ```bash
   npx convex export --path ./convex-snapshot.zip
   ```
   (From the Convex dashboard if the old deployment is unreachable.)
3. Import into the new deployment:
   ```bash
   npx convex import --table <tableName> ./convex-snapshot/<tableName>.jsonl
   ```
   Repeat for each table, or use the dashboard's import UI.

## 4. Validate

After restore completes:

```bash
# Deploy the current schema + functions against the restored data
npx convex deploy --env-file .env.production

# Run the integration test suite against the restored deployment
PUBLIC_CONVEX_URL=<restored-url> npm run test:integration
```

Spot-check these tables via the Convex dashboard or a quick query:

- `users` — row count matches expectations
- `organizations` — org data intact
- `templates` — templates and `recipientConfig` present
- `accountabilityReceipts` — anchor roots preserved
- `decisionMakers` — DM records present

## 5. Cutover

1. If you restored to a new Convex deployment, update the Cloudflare
   Pages env:
   ```bash
   wrangler pages secret put PUBLIC_CONVEX_URL    # new deployment URL
   ```
2. Redeploy the frontend so it picks up the new env:
   ```bash
   npm run build
   npx wrangler pages deploy .svelte-kit/cloudflare \
     --project-name commons --branch production
   ```
3. Verify the live site is operational: check `commons.email` health.

## 6. Post-Incident

1. Document the incident: root cause, timeline, data loss, and
   resolution.
2. Verify Convex snapshots are continuing to run (dashboard → Data →
   History).
3. Review and update this runbook if any steps were missing or incorrect.

---

## PII Encryption Keys

User PII is encrypted with `commons-credential-v2` domain AES-256-GCM
keys. A Convex restore is only usable if the corresponding keys are
still available:

| Secret | Purpose | Storage |
|--------|---------|---------|
| `ENTROPY_ENCRYPTION_KEY` | Decrypts user entropy at rest | CF Workers Secrets (`$env/dynamic/private`) |
| `IDENTITY_HASH_SALT` | Identity commitment hashing | CF Workers Secrets |
| `IDENTITY_SIGNING_KEY` | Credential issuance (Ed25519) | CF Workers Secrets |
| `BRIDGE_ENCRYPTION_KEY` | Bridge KV session crypto (HKDF-derived) | CF Workers Secrets |
| `ORG_KEY_WRAPPING_KEY` | Wraps per-org sealed keys | CF Workers Secrets |

**Critical**: These keys are FROZEN post-launch. Loss means encrypted
PII in the restored Convex dataset is unrecoverable. Ensure they are
backed up separately from the dataset.

---

## Pinning Provider (Shadow Atlas)

**Until the Storacha → successor migration completes**, a Shadow Atlas
restore requires:

1. A pinning provider that still holds the root CID + all 977 H3
   chunks.
2. A gateway that resolves them (currently `storacha.link/ipfs`;
   post-sunset, migrate to the new provider's gateway).

If either is missing at restore time, client-side ZKP verification will
fail for affected districts. Treat the migration as a DR prerequisite.

---

## Validation Schedule

| Cadence | Activity |
|---------|----------|
| Continuous | Convex native snapshot retention |
| Monthly | Export latest snapshot, import to a staging deployment, run integration tests |
| Quarterly | Full DR drill — restore to a production-like deployment, validate cutover |
| Quarterly | PII key rotation test — confirm old encrypted data still decrypts with archived keys |
