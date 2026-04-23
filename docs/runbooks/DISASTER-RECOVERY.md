# Disaster Recovery Runbook

> ⚠️ **CRITICAL (2026-04-23 audit) — DO NOT EXECUTE §1–6 AS WRITTEN.**
> This runbook describes the pre-Convex Postgres backup/restore flow.
> **Postgres + Prisma + Hyperdrive were removed 2026-03-26; the
> Postgres backup GitHub Actions workflow + `scripts/backup-db.ts` +
> `scripts/restore-db.ts` were deleted 2026-04-21.** None of the
> commands, environment variables, or scripts below exist anymore.
>
> ### Current DR posture (interim — needs a full rewrite)
>
> - **Primary data store: Convex** (`convex/schema.ts`, ~71 tables).
>   Convex provides native point-in-time recovery / snapshots via its
>   dashboard + CLI (`npx convex export`). This runbook needs to
>   document the Convex-side procedures before the next incident.
> - **Shadow Atlas pinning — OPERATIONAL DR RISK**: `pin-to-ipfs.ts`
>   is hardcoded to Storacha. **Storacha uploads disabled 2026-04-15;
>   full sunset 2026-05-31.** Client-side ZKP fetches cell chunks
>   through `storacha.link/ipfs` — post-sunset that gateway 404s.
>   Pinata import exists but is never instantiated. Pinning-provider
>   migration must complete before 2026-05-31 or Shadow Atlas restore
>   fails. See `docs/specs/CHUNKED-ATLAS-PIPELINE-SPEC.md` §4.4.
> - **PII encryption keys remain FROZEN** (AES-256-GCM). Doc is
>   correct that loss is unrecoverable. Add per-org sealed keys
>   (`convex/_orgKey.ts`, `sealedOrgKey`), `ENTROPY_ENCRYPTION_KEY`,
>   and Bridge KV (`bridge-crypto.ts`, HKDF-derived AES-256-GCM).
> - **TEE recovery is not covered**: TEE is Planned, witness decryption
>   currently runs in `LocalConstituentResolver` (CF Worker process).
>   No HSM / sealed recovery yet.
> - **Deploy cutover:** `npm run build && wrangler pages deploy
>   .svelte-kit/cloudflare --project-name commons --branch production`
>   + `npx convex deploy --env-file .env.production` (note: `-y`
>   silently fails for prod). No Hyperdrive / Prisma steps.
> - **Rate limiter:** SlidingWindowRateLimiter uses REDIS_URL if set;
>   otherwise in-memory. DR-sensitive: restoring to an env without
>   Redis loses rate-limit state across restarts.
>
> Until this file is rewritten, treat the §1–6 checklist as
> historical. Contact ops for current DR procedures.

**RTO**: 4 hours | **RPO**: 24 hours (daily backup cadence)

## Prerequisites

- AWS CLI configured with access to the S3 backup bucket
- `BACKUP_ENCRYPTION_KEY` — retrieve from Cloudflare Workers Secrets or your secrets manager
- `pg_restore` available (PostgreSQL client tools)
- Node.js 20+ with project dependencies installed (`npm ci`)

## 1. Assess

1. Determine the failure mode: data corruption, accidental deletion, full DB loss, or infrastructure failure.
2. Identify the last clean backup timestamp. List available backups:

```bash
aws s3 ls s3://commons-backups/daily/ --region us-east-1
```

3. Calculate data loss window: time between last backup and incident.

## 2. Notify

- Alert engineering team and stakeholders with:
  - Incident description
  - Estimated data loss window
  - Expected RTO (target: 4 hours from incident detection)

## 3. Provision Target Database

**Option A: Restore to existing instance** (data corruption / accidental deletion)

```bash
# No provisioning needed — restore directly to the existing database
```

**Option B: Restore to new instance** (full infrastructure failure)

```bash
# Provision a new PostgreSQL instance (Neon, RDS, or local Docker)
docker compose up -d
# Wait for readiness
docker compose exec postgres pg_isready -U commons
```

## 4. Restore

Run the restore script with the S3 key and target database URL:

```bash
export BACKUP_ENCRYPTION_KEY="<retrieved-from-secrets-manager>"
export AWS_ACCESS_KEY_ID="<your-key>"
export AWS_SECRET_ACCESS_KEY="<your-secret>"
export AWS_REGION="us-east-1"
export S3_BACKUP_BUCKET="commons-backups"

npx tsx scripts/restore-db.ts \
  "daily/commons-backup-2026-03-23T02-00-00-000Z.dump.gz.enc" \
  "postgresql://user:pass@host:5432/commons"
```

The script will:
1. Download the encrypted backup from S3
2. Decrypt with AES-256-CBC (pbkdf2 key derivation)
3. Decompress gzip
4. Restore via `pg_restore --format=custom --clean --if-exists`

**Note**: `--clean --if-exists` drops and recreates objects. This is safe for full restores but destructive for partial recovery. For partial recovery, omit `--clean` and restore to a separate database first.

## 5. Validate

After restore completes:

```bash
# 1. Verify schema is intact
npx prisma db push --accept-data-loss=false

# 2. Run integration tests against the restored database
DATABASE_URL="<restored-db-url>" npm run test:integration

# 3. Spot-check critical tables
npx prisma studio
```

Check these tables specifically:
- `User` — row count matches expectations
- `Organization` — org data intact
- `Template` — templates and recipient configs present
- `AccountabilityReceipt` — anchor roots preserved
- `DecisionMaker` — DM records present

## 6. Cutover

1. Update `DATABASE_URL` in Cloudflare Workers Secrets to point to the restored database
2. If using Hyperdrive, update the Hyperdrive config:
   ```bash
   wrangler hyperdrive update commons-db --connection-string="<new-db-url>"
   ```
3. Redeploy the application:
   ```bash
   npm run deploy
   ```
4. Verify the live site is operational: check `commons.email` health

## 7. Post-Incident

1. Document the incident: root cause, timeline, data loss, and resolution
2. Verify the next daily backup succeeds (check GitHub Actions run at 02:00 UTC)
3. Review and update this runbook if any steps were missing or incorrect

---

## PII Encryption Keys

Database backups contain PII encrypted with `commons-credential-v2` domain AES-256-GCM keys. The backup is usable only if both are available:

| Secret | Purpose | Storage |
|--------|---------|---------|
| `BACKUP_ENCRYPTION_KEY` | Encrypts the backup file itself | Secrets Manager / CF Workers Secrets |
| `ENTROPY_ENCRYPTION_KEY` | Decrypts user entropy at rest | CF Workers Secrets (`$env/dynamic/private`) |
| `IDENTITY_HASH_SALT` | Identity commitment hashing | CF Workers Secrets |
| `IDENTITY_SIGNING_KEY` | Credential issuance (Ed25519) | CF Workers Secrets |

**Critical**: These keys are FROZEN post-launch. Loss of these keys means encrypted PII in the restored database is unrecoverable. Ensure they are backed up separately from the database.

---

## Validation Schedule

| Cadence | Activity |
|---------|----------|
| Daily | Automated backup runs at 02:00 UTC (GitHub Actions) |
| Monthly | Restore latest backup to staging DB, run integration tests |
| Quarterly | Full DR drill — restore to production-like environment, validate cutover |
| Quarterly | Key rotation test — update backup encryption key, verify old backups still decrypt with old key |
