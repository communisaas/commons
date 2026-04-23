# Cron Job Setup

> ⚠️ **FULLY OBSOLETE (2026-04-23 audit).** Every external trigger
> described below (GitHub Actions workflows, cron-job.org config,
> Upstash QStash, pg_cron, `CRON_SECRET`, `/api/cron/analytics-snapshot`
> HTTP endpoint) was removed. The three GitHub workflows this doc set
> up (`analytics-snapshot.yml`, `bounce-report-processing.yml`,
> `legislation-crons.yml`) were deleted 2026-03-28.
>
> ### Current cron architecture
>
> - **Single source of truth:** `convex/crons.ts` (~15 scheduled jobs).
>   Convex's native scheduler invokes them — no external triggers, no
>   secrets, no `CRON_SECRET`, no HTTP endpoints to hit.
> - **Analytics snapshot:** `convex/crons.ts:~90-94`
>   (`crons.daily(..., { hourUTC: 0, minuteUTC: 5 })` →
>   `internal.analytics.materializeSnapshot`). Previously a SvelteKit
>   route; that route is gone.
> - **Debate resolution:** defined but is a **log-only stub**
>   (`convex/debates.ts:~697-739` logs "Would evaluate..." and does
>   nothing on-chain; gated by `FEATURES.DEBATE=false`).
> - **Monitoring:** Convex dashboard / logs.
>
> Daily analytics snapshot materialization at 00:05 UTC.

---

## Comparison Table

| Solution | Cost | Reliability | Jitter | Setup Complexity | Notes |
|----------|------|-------------|--------|------------------|-------|
| **GitHub Actions** | Free (public repos) / 2000 min/month (private) | Good | 5-30 min typical | Easy | Recommended for Cloudflare Pages |
| **cron-job.org** | Free (unlimited jobs) | Excellent | <1 min | Very Easy | Best precision, external service |
| **Upstash QStash** | Free (1000 msg/day) | Excellent | <1 min | Medium | Guaranteed delivery, serverless |
| **Vercel Cron** | Free (2 jobs) | Excellent | <1 min | Easy | Only for Vercel deployments |
| **pg_cron (Neon)** | Free (paid tier only) | Compute-dependent | None | Complex | Requires 24/7 compute (no scale-to-zero) |
| **Railway Cron** | Free tier | Excellent | <1 min | Easy | Only for Railway deployments |

---

## Recommended: GitHub Actions + cron-job.org Backup

For Cloudflare Pages deployments, use **GitHub Actions as primary** with **cron-job.org as backup** for maximum reliability at zero cost.

### Why This Combination?

1. **GitHub Actions**: Native to your repo, easy monitoring, manual re-runs, free for OSS
2. **cron-job.org**: Sub-minute precision backup, catches missed GitHub runs
3. **Idempotent endpoint**: Safe to call twice if both fire (snapshots are immutable)

---

## Setup Instructions

### Step 1: Generate Cron Secret

```bash
# Generate a secure random secret
openssl rand -hex 32
# Example output: a3f8c2d1e4b5a6f7c8d9e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1
```

### Step 2: Add Secret to Cloudflare Pages

Add `CRON_SECRET` as an environment variable in the Cloudflare Pages dashboard under Settings > Environment variables.

### Step 3: Add Secrets to GitHub

Go to your repo Settings > Secrets and variables > Actions, add:

| Secret Name | Value |
|-------------|-------|
| `CRON_SECRET` | The same secret from Step 1 |
| `APP_URL` | Your Cloudflare Pages URL (e.g., `https://commons.pages.dev`) |

### Step 4: Create GitHub Workflow

The workflow file should already exist at `.github/workflows/analytics-snapshot.yml`. If not, create it with the content from the next section.

### Step 5: (Optional) Add cron-job.org Backup

1. Create free account at [cron-job.org](https://cron-job.org)
2. Add new cron job:
   - **URL**: `https://commons.pages.dev/api/cron/analytics-snapshot`
   - **Schedule**: `10 0 * * *` (00:10 UTC - 5 min after GitHub Actions)
   - **Request Method**: GET
   - **Headers**: `Authorization: Bearer <your-cron-secret>`
3. Enable failure notifications

---

## GitHub Actions Workflow

File: `.github/workflows/analytics-snapshot.yml`

```yaml
name: Daily Analytics Snapshot

on:
  schedule:
    # Run at 00:05 UTC daily
    # Note: GitHub Actions has 5-30 min jitter during high load
    - cron: '5 0 * * *'
  workflow_dispatch:
    # Allow manual triggering for recovery/testing

jobs:
  snapshot:
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: Trigger Analytics Snapshot
        run: |
          response=$(curl -s -w "\n%{http_code}" -X GET \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.APP_URL }}/api/cron/analytics-snapshot")

          http_code=$(echo "$response" | tail -n1)
          body=$(echo "$response" | head -n-1)

          echo "Response: $body"
          echo "HTTP Status: $http_code"

          if [ "$http_code" != "200" ]; then
            echo "::error::Snapshot failed with HTTP $http_code"
            exit 1
          fi

          # Parse and display results
          echo "::notice::Analytics snapshot completed successfully"

      - name: Report Failure
        if: failure()
        run: |
          echo "::error::Analytics snapshot failed - manual intervention may be required"
          echo "To manually trigger: curl -H 'Authorization: Bearer \$CRON_SECRET' ${{ secrets.APP_URL }}/api/cron/analytics-snapshot"
```

---

## Monitoring

### GitHub Actions

- **Run History**: Actions tab > Daily Analytics Snapshot
- **Failure Alerts**: Enable in repo Settings > Actions > Notifications
- **Manual Re-run**: Click "Re-run jobs" on any failed run

### Verification

Check if snapshots are being created:

```sql
-- In Neon console or Prisma Studio
SELECT date, template_id, metric, noisy_count, epsilon_spent, created_at
FROM "AnalyticsSnapshot"
ORDER BY created_at DESC
LIMIT 10;
```

### Manual Recovery

If a day is missed, manually trigger the endpoint:

```bash
# Trigger yesterday's snapshot (default behavior)
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://commons.pages.dev/api/cron/analytics-snapshot

# Check response
# Success: {"success":true,"date":"2025-01-11","snapshots_created":5,"epsilon_spent":0.5,"budget_remaining":0.5}
```

---

## Alternative: Database-Native Scheduling (pg_cron)

### Neon pg_cron Status

[Neon supports pg_cron](https://neon.com/docs/extensions/pg_cron), but with critical limitations:

**Requirements:**
- Paid Neon plan (not available on free tier)
- 24/7 active compute (no scale-to-zero)
- Manual setup via Neon support

**Why We Don't Use It:**
1. Requires paying for always-on compute (~$19+/month)
2. Defeats Neon's serverless cost benefits
3. Jobs only run when compute is active
4. More complex setup than external cron

### If You Want to Use pg_cron Anyway

1. Contact Neon support to enable pg_cron
2. Ensure compute is set to never scale to zero
3. After restart, create the extension and schedule:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily snapshot (00:05 UTC)
SELECT cron.schedule(
  'analytics-snapshot',
  '5 0 * * *',
  $$
  SELECT net.http_get(
    'https://commons.pages.dev/api/cron/analytics-snapshot',
    headers := '{"Authorization": "Bearer YOUR_SECRET"}'::jsonb
  )
  $$
);

-- Note: Requires pg_net extension for HTTP calls
```

---

## Scaling Considerations

### Current (0-10K users)

GitHub Actions alone is sufficient. Jitter is acceptable for daily analytics.

### Growth (10K-100K users)

Add cron-job.org backup for redundancy. Total cost: $0.

### Scale (100K-1M users)

Consider:
- **Upstash QStash** ($0-20/month): Guaranteed delivery, retries, dead letter queue
- **Multiple backup triggers**: GitHub + cron-job.org + QStash

### Enterprise (1M+ users)

Consider:
- **Dedicated scheduler**: AWS EventBridge ($1/million events)
- **Database triggers**: pg_cron with dedicated compute
- **Multi-region redundancy**: Multiple trigger sources

---

## Troubleshooting

### Snapshot Not Running

1. Check GitHub Actions run history
2. Verify `CRON_SECRET` matches between GitHub and Cloudflare Pages
3. Check `APP_URL` is correct and accessible
4. Try manual trigger via `workflow_dispatch`

### 401 Unauthorized

```bash
# Verify secret is set correctly in Cloudflare Pages dashboard

# Test locally
curl -v -H "Authorization: Bearer $CRON_SECRET" \
  https://commons.pages.dev/api/cron/analytics-snapshot
```

### 500 Internal Server Error

Check application logs in the Cloudflare Pages dashboard under Deployments > Functions logs.

Common causes:
- Database connection issues
- Missing analytics data for the day
- Privacy budget exhausted

### GitHub Actions Delays

If experiencing >30 min delays:
1. Avoid scheduling at :00 of any hour (high contention)
2. Add cron-job.org backup
3. Consider using `workflow_dispatch` API with external trigger

---

## Security

### Authentication

The endpoint requires `Authorization: Bearer <CRON_SECRET>` header. Without a valid secret, requests return 401.

### Secret Rotation

To rotate the cron secret:

```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. Update Cloudflare Pages
# Update CRON_SECRET in Cloudflare Pages dashboard > Settings > Environment variables

# 3. Update GitHub secret (manual via UI)

# 4. Update cron-job.org header (if using)
```

### Network Security

- Endpoint is publicly accessible but protected by secret
- Consider IP allowlisting if your platform supports it
- All requests should be HTTPS

---

## References

- [GitHub Actions Scheduled Workflows](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)
- [GitHub Actions Cron Delay Discussion](https://github.com/orgs/community/discussions/156282)
- [cron-job.org](https://cron-job.org/en/)
- [Upstash QStash](https://upstash.com/docs/qstash)
- [Neon pg_cron Extension](https://neon.com/docs/extensions/pg_cron)
