# Disaster Recovery Runbook

**RTO**: 4 hours | **RPO**: Continuous (Convex point-in-time recovery)

## Current DR Posture

- **Primary data store: Convex** (`convex/schema.ts`, ~71 tables). Convex
  provides native point-in-time recovery and snapshots via its dashboard
  and CLI (`npx convex export`).
- **Shadow Atlas read path — R2 (Cloudflare)**: served via
  `atlas.commons.email` (Atlas Worker → R2 binding). DR posture is
  whatever Cloudflare R2 provides plus the build pipeline's ability
  to regenerate quarterly artifacts. IPFS pinning is paused (post
  Storacha sunset 2026-05-31); Pinata/Lighthouse/Fleek service
  implementations remain in `voter-protocol/packages/shadow-atlas/src/distribution/services/`
  for reactivation when IPFS matures. R2 is the only restore path
  until then.
- **PII encryption keys remain FROZEN** (AES-256-GCM). Loss is
  unrecoverable. Per-org sealed keys (`convex/_orgKey.ts`,
  `sealedOrgKey`) and `ENTROPY_ENCRYPTION_KEY` must all be backed up
  separately.
- **TEE recovery is not yet covered**: TEE is Planned; witness
  decryption currently runs in `LocalConstituentResolver` (CF Worker
  process). No HSM / sealed recovery yet.
- **Deploy cutover:** recover Convex documents first through point-in-time
  restore or an explicitly targeted backup ZIP import. Restore the deployment's
  environment variables separately; backups do not contain them. From the exact
  recovery release SHA, deploy its functions, schema, and indexes to that same
  target with `npx convex deploy --env-file .env.production`; this command does
  not restore documents. Rebuild and verify the v4 discovery snapshots, then use
  the gated `.github/workflows/deploy.yml` workflow for the exact release SHA.
  Direct `wrangler pages deploy` is prohibited because it bypasses recovery
  readiness and immutable-SHA evidence. (`-y` silently fails for Convex prod —
  always pass `--env-file`.)
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
2. Download the selected clean backup ZIP from the Convex dashboard. If the
   source deployment is reachable and known-clean, the CLI equivalent is:
   ```bash
   npx convex export --deployment <source-deployment> --include-file-storage --path ./convex-snapshot.zip
   ```
3. Import the untouched backup ZIP into the explicitly selected new deployment:
   ```bash
   npx convex import --deployment <new-deployment> --replace ./convex-snapshot.zip
   ```
   Importing the whole ZIP preserves document IDs, references, Convex value
   types, and any included file-storage metadata. Do not restore a full backup
   by iterating over per-table JSONL files.
4. Restore the new deployment's environment variables from the secrets manager.
   Convex backups contain documents and optional file storage, not environment
   variables, deployed code/configuration, or pending scheduled functions.

## 4. Validate

After restore completes:

Check out the exact recovery release SHA. Ensure `.env.production` contains a
deployment-scoped key for the restored target, and restore that deployment's
environment variables before invoking its functions.

```bash
# Deploy this release's functions, schema, and indexes. Data was restored above.
npx convex deploy --env-file .env.production

# Rebuild the derived discovery rows required by the frontend readiness gate
npx convex run templates:rebuildHomepageSnapshots '{}' --env-file .env.production
# Run with PUBLIC_CONVEX_URL and INTERNAL_API_SECRET restored in the process
# environment. Never place the discovery secret in CLI JSON or shell history.
npm run verify:public-discovery-readiness

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

1. If you restored to a new Convex deployment, update the reviewed production
   `PUBLIC_CONVEX_URL` mapping in `.github/workflows/deploy.yml` and
   `wrangler.toml` in the recovery release. Update any same-named Cloudflare
   Pages binding too. Changing only a Pages secret is insufficient: the gated
   workflow verifies its approved backend URL before upload and syncs that URL
   into the Wrangler configuration.
2. Redeploy the frontend so it picks up the new env:
   ```bash
   set -euo pipefail
   git fetch --no-tags origin production
   RELEASE_SHA=$(git rev-parse HEAD)
   if ! git merge-base --is-ancestor "$RELEASE_SHA" origin/production; then
     echo "Refusing deploy: $RELEASE_SHA is not contained in origin/production." >&2
     exit 1
   fi
   gh workflow run deploy.yml --ref production \
     -f branch=production \
     -f ref="$RELEASE_SHA"
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

User PII is encrypted with `voter-protocol-credential-v2` domain AES-256-GCM
keys. A Convex restore is only usable if the corresponding keys are
still available:

| Secret | Purpose | Storage |
|--------|---------|---------|
| `ENTROPY_ENCRYPTION_KEY` | Decrypts user entropy at rest | CF Workers Secrets (`$env/dynamic/private`) |
| `IDENTITY_HASH_SALT` | Identity commitment hashing | CF Workers Secrets |
| `IDENTITY_SIGNING_KEY` | Credential issuance (Ed25519) | CF Workers Secrets |
| `ORG_KEY_WRAPPING_KEY` | Wraps per-org sealed keys | CF Workers Secrets |

**Critical**: These keys are FROZEN post-launch. Loss means encrypted
PII in the restored Convex dataset is unrecoverable. Ensure they are
backed up separately from the dataset.

---

## Pinning Provider (Shadow Atlas)

**IPFS pinning is paused as of 2026-05-02.** Restore depends on R2
(`atlas.commons.email`) holding the latest quarterly artifacts plus
the ability to rebuild from voter-protocol. There is no IPFS fallback
until pinning is reactivated. When IPFS comes back, this section needs
the provider name + gateway domain captured before the next quarterly
build runs, and the gateway list in `CHUNKED-ATLAS-PIPELINE-SPEC.md` §5
needs to be re-populated to match.

---

## Validation Schedule

| Cadence | Activity |
|---------|----------|
| Continuous | Convex native snapshot retention |
| Monthly | Export latest snapshot, import to a staging deployment, run integration tests |
| Quarterly | Full DR drill — restore to a production-like deployment, validate cutover |
| Quarterly | PII key rotation test — confirm old encrypted data still decrypts with archived keys |
