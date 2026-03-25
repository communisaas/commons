# Production Hardening Plan

**Status**: Engineering Specification
**Date**: 2026-03-23
**Scope**: Pre-launch hardening for org onboarding (Phase 0 → Phase 1)
**Owner**: TBD

---

## Executive Summary

The commons platform has 6 production hardening gaps blocking org onboarding. This spec defines remediation for each, ordered by criticality.

| Gap | Current | Target | Complexity | Blocker |
|-----|---------|--------|-----------|---------|
| Billing enforcement | Field defined, not enforced | Quota gate in template creation | M | YES |
| Error monitoring | Manual logging | Sentry for CF Workers | L | YES |
| Backup/restore | No procedures | Encrypted backup automation | L | YES |
| Storage isolation | Shared across users on same device | Per-user keying + cleanup | M | NO |
| Rate limiter KV | In-memory per-isolate | CF KV or Upstash Redis | S | NO |
| Connection resilience | Good pattern, no timeouts | Add timeouts + health check | S | NO |

---

## 1. BILLING LIMIT ENFORCEMENT (CRITICAL)

### Current State
- **Schema**: `Organization.max_templates_month` (int, default: 100)
- **Sync**: Stripe webhook updates limits when subscription changes
- **Files**:
  - `/prisma/schema.prisma` (field definition)
  - `/src/routes/api/billing/webhook/+server.ts` (webhook handler)
  - `/src/lib/server/org.ts` (org loading)

- **Problem**: No enforcement gate. Template creation at `/src/routes/api/templates/+server.ts` POST handler (lines 379-700+) has **zero quota checks**.

### Target State
1. Track monthly template usage per org (not per user — org-scoped)
2. Reject template creation if org exceeds `max_templates_month`
3. Reset counter monthly (calendar month or billing cycle?)
4. Return 402 or 403 with usage info

### Design

#### Option A: Query-based Counting (Simple, ~O(1) if indexed)
Count templates created by ANY org member this calendar month:
```sql
SELECT COUNT(*) FROM template
WHERE org_id = $1
  AND date_trunc('month', created_at) = date_trunc('month', now())
```

**Pros**: Simple, accurate, no extra tables
**Cons**: Query on every template creation; needs index on (org_id, created_at)

#### Option B: Cached Counter Table (Fast, denormalized)
Add `OrgUsageTracker` model:
```prisma
model OrgUsageTracker {
  id       String    @id @default(cuid())
  org_id   String    @unique @map("org_id")
  month    DateTime  @map("month") // Start of month
  count    Int       @default(0)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([org_id, month])
}
```

**Pros**: O(1) lookup, fast
**Cons**: Must keep in sync; cron job or trigger needed to reset monthly

**Recommendation**: Start with Option A (query-based), migrate to Option B if template creation becomes bottleneck.

### Files Affected
- `/prisma/schema.prisma` (optional: add OrgUsageTracker if using Option B)
- `/src/routes/api/templates/+server.ts` (add enforcement gate before creation)
- `/src/lib/server/org.ts` (add `usage` field to org load query)
- New: `/src/lib/server/billing/usage.ts` (usage tracking helpers)

### Enforcement Logic

**Location**: `/src/routes/api/templates/+server.ts`, POST handler, after auth check (~line 502):

```typescript
if (user && user.orgId) {
  const org = await db.organization.findUnique({
    where: { id: user.orgId },
    select: { max_templates_month: true }
  });

  if (!org) {
    return json({ error: 'Org not found' }, { status: 404 });
  }

  // Count this month
  const thisMonth = new Date();
  thisMonth.setDate(1);
  thisMonth.setHours(0, 0, 0, 0);

  const count = await db.template.count({
    where: {
      // All org members' templates
      user: { orgMemberships: { some: { orgId: user.orgId } } },
      createdAt: { gte: thisMonth }
    }
  });

  if (count >= org.max_templates_month) {
    return json({
      error: 'Template quota exceeded',
      used: count,
      limit: org.max_templates_month
    }, { status: 403 });
  }
}
```

### Test Plan
1. **Unit**: Create template as org member, verify count incremented
2. **Unit**: Create template when at limit, verify 403 returned
3. **Integration**: Stripe webhook increases limit, verify more templates allowed
4. **Integration**: Month boundary, verify counter resets (or cron runs)
5. **Edge case**: Guest user (no org) can still create personal templates

### Migration Path
1. **Week 1**: Add usage query helper + enforcement gate (Option A)
2. **Week 2**: Test with staging org
3. **Week 3**: Monitor query performance in production; add index if needed
4. **Future**: Migrate to Option B if bottleneck detected

---

## 2. ERROR MONITORING (CRITICAL)

### Current State
- **Monitoring**: Manual `console.error()` and `console.warn()` scattered throughout codebase
- **Aggregation**: None — errors only visible in logs, no centralized dashboard
- **Alerting**: None — no incident detection or paging
- **Sampling**: No sampling strategy defined

- **Problem**:
  - Fire-and-forget patterns documented as intentional (background work) but errors silently fail
  - No visibility into rate limiter Redis connection failures
  - Template moderation failures have no trace
  - No error rate trends or anomaly detection

### Target State
1. Centralized error tracking via Sentry (or equivalent for CF Workers)
2. Source map support for minified code
3. Performance monitoring (request latency, template moderation time)
4. Automated alerting for critical errors (rate limiter down, moderation failures)
5. User context captured (userId, orgId) for debugging

### Design

#### Sentry for SvelteKit + Cloudflare Workers

**Provider**: Sentry (sentry.io)
**Package**: `@sentry/sveltekit` + `@sentry/integrations`
**Cost**: ~$29/month for 100k events (commons: estimate 10k-50k/month initially)

#### Architecture

1. **Server-side init** (`src/hooks.server.ts`):
```typescript
import * as Sentry from "@sentry/sveltekit";

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.ENVIRONMENT,
  tracesSampleRate: env.ENVIRONMENT === 'production' ? 0.1 : 1.0,
  profilesSampleRate: 0.1,
  integrations: [
    new Sentry.Replay({ maskAllText: true, blockAllMedia: true })
  ]
});
```

2. **Client-side init** (`src/routes/+layout.ts`):
```typescript
import * as Sentry from "@sentry/sveltekit";

Sentry.init({
  dsn: env.PUBLIC_SENTRY_DSN,
  environment: env.PUBLIC_ENVIRONMENT,
  tracesSampleRate: 0.1
});
```

3. **Handlers** (in API routes and server actions):
```typescript
try {
  // Template creation
} catch (error) {
  Sentry.captureException(error, {
    contexts: {
      template: {
        title: validData.title,
        org_id: user.orgId
      }
    },
    level: 'fatal'
  });
  throw error;
}
```

4. **Performance monitoring** (moderation, database):
```typescript
const transaction = Sentry.startTransaction({
  name: 'moderateTemplate',
  op: 'http.server'
});

const moderationResult = await moderateTemplate(data);

transaction.finish();
```

### Files Affected
- `/src/hooks.server.ts` (Sentry.init for server)
- `/src/routes/+layout.ts` (Sentry.init for client)
- `/src/lib/core/server/moderation.ts` (add captureException on failure)
- `/src/lib/core/security/rate-limiter.ts` (alert on Redis connection failure)
- `/src/lib/core/db.ts` (capture connection errors)
- New: `/src/lib/server/monitoring/sentry.ts` (helpers)

### Environment Variables
```
SENTRY_DSN="https://key@sentry.io/project-id"
PUBLIC_SENTRY_DSN="https://key@sentry.io/project-id"
ENVIRONMENT="production|staging|development"
PUBLIC_ENVIRONMENT="production|staging|development"
```

### Alerts Configuration (Sentry console)
1. **Critical**: Rate limiter Redis connection fails (error count > 0 in 5m)
2. **High**: Template moderation fails (error rate > 5% in 10m)
3. **High**: Database connection pool exhaustion (error keyword: "Cannot perform I/O")
4. **Medium**: Unhandled promise rejections in background tasks

### Test Plan
1. **Unit**: Manually throw error, verify Sentry capture
2. **Integration**: Test with staging Sentry project
3. **E2E**: Trigger rate limiter failure, verify alert fires
4. **E2E**: Trigger moderation failure, verify trace captured with context
5. **Performance**: Verify sampling doesn't lose critical errors

### Migration Path
1. **Week 1**: Add Sentry packages, init in hooks, deploy to staging
2. **Week 2**: Add captureException to critical paths (moderation, rate limiter, DB)
3. **Week 3**: Configure alerts in Sentry console
4. **Week 4**: Monitor baseline error rates, adjust sampling

---

## 3. BACKUP & DISASTER RECOVERY (CRITICAL)

### Current State
- **Backups**: None found. No scripts, cron jobs, or restore procedures
- **PII Encryption**: At rest via Prisma ORM (`commons-credential-v2` domain string for AES-256-GCM)
- **Key Storage**: Unknown — likely `$env/dynamic/private` but not documented
- **Recovery**: Unknown RTO/RPO SLAs

- **Problem**:
  - Encrypted PII means standard pg_dump plaintext backups won't help
  - No key versioning or rotation strategy
  - No documented disaster recovery procedure

### Target State
1. Automated daily backups with encryption key delivery
2. Point-in-time restore (PITR) testing 2x per month
3. RTO: 4 hours (restore and validate DB, deploy code)
4. RPO: 24 hours (acceptable 1-day data loss)
5. Documented runbook for restore scenario

### Design

#### Backup Architecture

**Provider**: AWS managed RDS backups (if migrating to RDS) OR manual pg_dump to S3

**Option A: RDS + AWS Backup** (Recommended for managed service)
- Automated daily snapshots retained 30 days
- Point-in-time recovery to any second in past 7 days
- Encryption key in AWS KMS (separate from app keys)
- Cost: ~$0.20/GB/month storage + data transfer

**Option B: Postgres pg_dump → S3 + encryption key in Secrets Manager**
- Daily pg_dump to S3 (encrypted at rest)
- Encryption key stored in Cloudflare Workers Secrets (or AWS Secrets Manager)
- Restore: download dump, decrypt key, restore locally
- Cost: ~$0.023/GB/month S3 storage

**Recommendation**: Start with Option B (simpler, portable). Migrate to RDS if operational overhead grows.

#### Key Management

**Encryption Keys for PII** (app-side, already encrypted):
- Domain string: `commons-credential-v2` (FROZEN post-launch)
- Stored in: `$env/dynamic/private` (Cloudflare Workers Secrets)
- Key rotation: Not implemented yet (defer to Phase 2)

**Backup Encryption Key** (separate):
- Use Cloudflare Workers KV or AWS Secrets Manager
- Rotate annually
- Never stored in code or version control

#### Script: Daily Backup (Cron)

**File**: `/scripts/backup-db.ts`

```typescript
import { exec } from 'child_process';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const s3 = new S3Client({ region: 'us-east-1' });
const secrets = new SecretsManagerClient({ region: 'us-east-1' });

async function backupDatabase() {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filename = `commons-backup-${timestamp}.sql.gz`;

  try {
    // Get backup encryption key from Secrets Manager
    const keyResponse = await secrets.send(
      new GetSecretValueCommand({ SecretId: 'commons/backup-key' })
    );
    const backupKey = keyResponse.SecretString;

    // pg_dump + gzip
    console.log('Starting database backup...');
    exec(
      `pg_dump --format=custom ${process.env.DATABASE_URL} | gzip | openssl enc -aes-256-cbc -pass pass:${backupKey} > /tmp/${filename}`,
      async (err) => {
        if (err) {
          console.error('pg_dump failed:', err);
          throw err;
        }

        // Upload to S3
        const fileBuffer = await readFile(`/tmp/${filename}`);
        await s3.send(
          new PutObjectCommand({
            Bucket: 'commons-backups',
            Key: `daily/${filename}`,
            Body: fileBuffer,
            ServerSideEncryption: 'AES256'
          })
        );

        console.log(`Backup uploaded: ${filename}`);

        // Cleanup
        exec(`rm /tmp/${filename}`);
      }
    );
  } catch (error) {
    console.error('Backup failed:', error);
    // Alert via Sentry
    Sentry.captureException(error, { level: 'fatal' });
    throw error;
  }
}

backupDatabase();
```

**Cron Setup** (AWS EventBridge or GitHub Actions):
- Trigger daily at 02:00 UTC (low-traffic window)
- Timeout: 1 hour
- Retry: 3x on failure, alert if all fail

#### Script: Restore Procedure (Manual)

**File**: `/scripts/restore-db.ts`

```typescript
import { exec } from 'child_process';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

async function restoreDatabase(backupDate: string, targetDb: string) {
  const filename = `commons-backup-${backupDate}.sql.gz`;

  try {
    // Download from S3
    const s3 = new S3Client({ region: 'us-east-1' });
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: 'commons-backups',
        Key: `daily/${filename}`
      })
    );

    // Decrypt + restore
    console.log(`Restoring from ${filename}...`);
    exec(
      `cat /tmp/${filename} | openssl enc -d -aes-256-cbc -pass pass:${backupKey} | gunzip | pg_restore --format=custom --clean --if-exists -d ${targetDb}`,
      (err) => {
        if (err) {
          console.error('Restore failed:', err);
          throw err;
        }
        console.log('Restore complete. Validate schema and run tests.');
      }
    );
  } catch (error) {
    console.error('Restore failed:', error);
    throw error;
  }
}

restoreDatabase(process.argv[2], process.argv[3]);
```

**Usage**:
```bash
# Restore 2026-03-15 backup to local test DB
npx ts-node scripts/restore-db.ts 2026-03-15 postgresql://user:pass@localhost:5432/commons_test
```

### Files Affected
- New: `/scripts/backup-db.ts` (daily backup automation)
- New: `/scripts/restore-db.ts` (manual restore)
- New: `/docs/runbooks/DISASTER-RECOVERY.md` (procedures)
- `.github/workflows/daily-backup.yml` (GitHub Actions cron trigger)
- `.env.example` (document backup key secret)

### Environment Variables
```
# Backup encryption (stored in Secrets Manager, not in .env)
AWS_BACKUP_KEY_SECRET_NAME="commons/backup-key"
AWS_REGION="us-east-1"
S3_BACKUP_BUCKET="commons-backups"

# For restore script
BACKUP_ENCRYPTION_PASSWORD="(retrieved from Secrets Manager at restore time)"
```

### Test Plan
1. **Monthly**: Run restore script to staging DB
2. **Monthly**: Validate schema with `pg_dump --schema-only` diff
3. **Monthly**: Run integration tests against restored DB
4. **Quarterly**: Full disaster recovery drill (restore to production-like environment, failover test)
5. **Quarterly**: Key rotation test (update backup key, verify old backups still decrypt)

### Runbook: Disaster Recovery

**File**: `/docs/runbooks/DISASTER-RECOVERY.md`

1. **Assess**: Determine data loss window (last clean backup available?)
2. **Notify**: Alert stakeholders of RTO/RPO
3. **Prepare**: Spin up clean PostgreSQL instance (RDS or self-managed)
4. **Restore**: Run `/scripts/restore-db.ts` targeting new instance
5. **Validate**: Run smoke tests, check row counts, verify encrypted fields still decrypt
6. **Switch**: Update HYPERDRIVE/DATABASE_URL to new instance
7. **Deploy**: Redeploy app code to trigger health checks
8. **Monitor**: Watch error rates for 1 hour

### Migration Path
1. **Week 1**: Create backup script, test locally with sample backup
2. **Week 2**: Set up S3 bucket, AWS Secrets Manager, GitHub Actions cron
3. **Week 3**: Run restore test against staging DB
4. **Week 4**: Document runbook, train on-call team
5. **Week 5**: Monthly validation runs begin (sustainable cadence)

---

## 4. CLIENT STORAGE ISOLATION (HIGH)

### Current State
- **templateDraftStore** (`/src/lib/stores/templateDraft.ts`):
  - Storage key: `'commons_template_drafts'` — **global, not per-user**
  - Draft format: `{ [draftId]: { data, lastSaved, ... } }`
  - Draft ID: `draft_${Date.now()}_${random}` — predictable, not user-bound
  - **Problem**: Multi-user device exposure. User A's drafts visible if User B logs in on same browser

- **Search cache** (`/src/lib/core/search/cache.ts`):
  - IndexedDB stores: `'commons-search-cache'` — global per browser
  - No userId keying; different users see each other's cached searches and embeddings

- **Trade preimages** (`/src/lib/core/wallet/trade-preimage-store.ts`):
  - Keyed by `[debateId, epoch]` — user-implicit but no explicit userId
  - Safe by accident (each user has different trades), but fragile

- **Good example**: Credential store (`/src/lib/core/identity/credential-store.ts`):
  - Per-user HMAC-based recordId — cannot enumerate other users' creds

### Target State
1. All client stores prefixed with userId or per-user encryption
2. Automatic cleanup on logout (clear user-scoped data)
3. No cross-user data visible even if browser cache not cleared
4. Graceful fallback if user context unavailable (SSR/offline)

### Design

#### Option A: Storage Key Prefix (Simple, backward-compatible)
Prefix all keys with userId:

```typescript
// Before: 'commons_template_drafts'
// After: `commons_template_drafts:${userId}`

const STORAGE_KEY = (userId: string) => `commons_template_drafts:${userId}`;
```

**Pros**: Simple, zero encryption overhead
**Cons**: Multiple users → multiple storage objects (unbounded growth)

#### Option B: Per-User Encryption + Single Shared Key (Secure, complex)
Encrypt draft data with per-user key derived from userId:

```typescript
async function deriveUserKey(userId: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(userId + 'commons-draft-v1'),
    { name: 'PBKDF2', hash: 'SHA-256', salt: ... , iterations: 100000 },
    false,
    ['encrypt', 'decrypt']
  );
  return key;
}
```

**Pros**: Single storage key, encrypted per-user
**Cons**: Overhead, key derivation per access

**Recommendation**: Use **Option A** (prefix). Simple, works now. Migrate to Option B if storage grows unbounded.

#### Implementation

**File 1: templateDraftStore** (`/src/lib/stores/templateDraft.ts`)

```typescript
// Import user context
import { get } from 'svelte/store';
import { page } from '$app/stores';

interface PendingSuggestion { ... }
interface DraftStorage { ... }

function createTemplateDraftStore(): TemplateDraftStore {
  const { subscribe, set, update } = writable<DraftStorage>({});

  // ✅ NEW: Generate user-scoped storage key
  function getStorageKey(userId: string): string {
    return `commons_template_drafts:${userId}`;
  }

  function loadDrafts(userId?: string): DraftStorage {
    if (typeof localStorage === 'undefined') return {};
    if (!userId) {
      console.warn('[TemplateDraft] No userId provided, returning empty store');
      return {};
    }

    try {
      const key = getStorageKey(userId);
      const stored = localStorage.getItem(key);
      if (stored) {
        // ... existing validation & cleanup logic
      }
    } catch (error) {
      console.warn('[TemplateDraft] Failed to load drafts:', error);
    }
    return {};
  }

  function saveDrafts(userId: string, drafts: DraftStorage) {
    if (typeof localStorage === 'undefined') return;
    try {
      const key = getStorageKey(userId);
      localStorage.setItem(key, JSON.stringify(drafts));
    } catch {
      console.warn('[TemplateDraft] Failed to save drafts');
    }
  }

  // ✅ NEW: Init with user context
  const pageStore = page;
  const user = derived(pageStore, ($page) => $page.data.user);

  user.subscribe((u) => {
    if (u?.id) {
      const initialDrafts = loadDrafts(u.id);
      set(initialDrafts);
    }
  });

  // ... rest of store with user.id passed to saveDrafts()
}
```

**File 2: SearchCache** (`/src/lib/core/search/cache.ts`)

```typescript
export class SearchCache {
  private userId: string | null = null;
  private dbName = (userId: string) => `commons-search-cache:${userId}`;
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

  constructor(userId?: string) {
    this.userId = userId || null;
  }

  private async ensureDB(): Promise<IDBDatabase> {
    if (!this.userId) {
      throw new Error('[SearchCache] No userId provided');
    }
    if (!this.db) {
      await this.init();
    }
    if (!this.db) {
      throw new Error('[SearchCache] Failed to initialize IndexedDB');
    }
    return this.db;
  }

  async init(): Promise<void> {
    if (!this.userId) {
      console.warn('[SearchCache] Cannot init without userId');
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName(this.userId!), this.dbVersion);
      // ... rest of init logic
    });
  }

  // ✅ NEW: Factory to create per-user instance
  static createForUser(userId: string): SearchCache {
    return new SearchCache(userId);
  }
}
```

**Usage in component** (`/src/routes/+layout.svelte`):
```typescript
import { page } from '$app/stores';
import { SearchCache } from '$lib/core/search/cache';

let searchCache: SearchCache | null = null;

page.subscribe((p) => {
  if (p.data.user?.id) {
    // Create new cache instance for logged-in user
    searchCache = SearchCache.createForUser(p.data.user.id);
  } else {
    // Clear cache for anonymous user
    searchCache = null;
  }
});
```

### Migration Path

**Phase 1: Non-breaking changes** (deploy without invalidating existing data)
1. Update `getStorageKey()` to return prefixed key
2. Implement fallback: if new key doesn't exist, load from old global key (one-time)
3. On first access, copy old data to new key

**Phase 2: Cleanup** (remove fallback after 2 weeks)
1. Monitor adoption (% users on new key)
2. After 90%+ adoption, remove fallback
3. Add warning for users still using old key

**Phase 3: Logout cleanup** (automatic per-user data deletion)
1. On logout, clear all user-scoped storage
2. Add `storage.clear()` to `/src/lib/core/auth/logout.ts`

### Files Affected
- `/src/lib/stores/templateDraft.ts` (prefix + userId context)
- `/src/lib/core/search/cache.ts` (per-user factory)
- `/src/lib/core/wallet/trade-preimage-store.ts` (add explicit userId keying, optional)
- `/src/lib/core/auth/logout.ts` (add storage cleanup)
- Tests: update all client storage tests to pass userId

### Test Plan
1. **Unit**: Create draft as User A, verify stored at `commons_template_drafts:userA`
2. **Unit**: Switch to User B, verify sees empty store (not User A's drafts)
3. **Unit**: User A returns, verify drafts still there
4. **Integration**: Delete localStorage.getItem(), verify graceful fallback
5. **Integration**: Logout, verify storage cleared
6. **E2E**: Multi-user device scenario (shared browser, different accounts)

### Complexity & Timeline
- **Complexity**: M (3-4 days development + testing)
- **Risk**: Medium (client storage used in multiple places, needs careful testing)
- **Breaking**: No (backward-compatible with fallback)

---

## 5. RATE LIMITER REDIS/KV (HIGH)

### Current State
- **Implementation**: Dual-backend (in-memory + Redis)
- **Current**: In-memory works per-isolate on CF Workers
- **Problem**: Per-isolate state resets when isolate recycles; **no validation that REDIS_URL is set in production**

### Target State
1. Validate REDIS_URL at startup (fail fast if production + no Redis)
2. Support Cloudflare Workers KV as alternative to Redis
3. Health check for rate limiter backend

### Design

#### Startup Validation

**File**: `/src/lib/core/security/rate-limiter.ts` (modify existing code)

```typescript
import { env } from '$env/dynamic/private';

export function getRateLimiter(): SlidingWindowRateLimiter {
  if (!rateLimiterInstance) {
    // ✅ NEW: Validate production configuration
    if (env.ENVIRONMENT === 'production' && !env.REDIS_URL) {
      const message = 'CRITICAL: Rate limiter requires REDIS_URL in production (per-isolate in-memory not sufficient)';
      console.error(message);

      // Fail loudly (block requests until fixed)
      throw new Error(message);
    }

    rateLimiterInstance = new SlidingWindowRateLimiter();

    const stats = rateLimiterInstance.getStats();
    if (stats.implementation === 'in-memory' && typeof caches !== 'undefined') {
      console.warn(
        '[RateLimiter] Using in-memory store on Workers — rate limiting is per-isolate only. Set REDIS_URL for distributed rate limiting.'
      );
    }
  }
  return rateLimiterInstance;
}
```

#### Cloudflare Workers KV Support (Optional)

**Note**: Upstash Redis is simpler (compatible with existing Redis client). KV is lower-cost but different API.

If cost is critical, add KV support:

```typescript
interface RateLimitStore {
  getTimestamps(key: string, windowMs: number): Promise<number[]>;
  addTimestamp(key: string, timestamp: number, windowMs: number): Promise<void>;
  getStats(): { implementation: string };
  destroy(): Promise<void>;
}

class CloudflareKVStore implements RateLimitStore {
  constructor(private kv: KVNamespace) {}

  async getTimestamps(key: string, windowMs: number): Promise<number[]> {
    const stored = await this.kv.get(key, 'json');
    if (!stored) return [];

    const now = Date.now();
    const cutoff = now - windowMs;
    return (stored as number[]).filter((ts) => ts > cutoff);
  }

  async addTimestamp(key: string, timestamp: number, windowMs: number): Promise<void> {
    const timestamps = await this.getTimestamps(key, windowMs);
    timestamps.push(timestamp);

    // KV TTL = 2x window (auto-cleanup)
    const ttl = Math.ceil((windowMs * 2) / 1000);
    await this.kv.put(key, JSON.stringify(timestamps), { expirationTtl: ttl });
  }

  getStats() {
    return { implementation: 'cloudflare-kv' };
  }

  async destroy(): Promise<void> {}
}
```

**Recommendation**: Start with **Upstash Redis** (drop-in compatible, ~$20/month). KV can be added later if cost optimization needed.

#### Health Check Endpoint

**File**: New `/src/routes/api/health/+server.ts`

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRateLimiter } from '$lib/core/security/rate-limiter';

export const GET: RequestHandler = async ({ locals }) => {
  const checks = {
    database: false,
    rateLimiter: false,
    timestamp: new Date().toISOString()
  };

  try {
    // Database check
    const user = await db.user.findFirst({ select: { id: true } });
    checks.database = true;
  } catch (error) {
    console.error('[Health] Database check failed:', error);
  }

  try {
    // Rate limiter check
    const limiter = getRateLimiter();
    const result = await limiter.check('health:check', { maxRequests: 100, windowMs: 60000 });
    checks.rateLimiter = result.allowed;
  } catch (error) {
    console.error('[Health] Rate limiter check failed:', error);
  }

  const status = Object.values(checks).every((v) => v === true || typeof v === 'string')
    ? 200
    : 503;

  return json(checks, { status });
};
```

**Usage**: `curl https://commons.email/api/health`

### Files Affected
- `/src/lib/core/security/rate-limiter.ts` (add startup validation, optional KV support)
- New: `/src/routes/api/health/+server.ts` (health endpoint)
- `.env.example` (document REDIS_URL requirement)

### Environment Variables
```
# Required in production
REDIS_URL="redis://default:password@upstash.io:port"

# Optional (if implementing KV)
CLOUDFLARE_KV_NAMESPACE="rate_limiter" (bound in wrangler.toml)
```

### Test Plan
1. **Unit**: Missing REDIS_URL in prod → throw error
2. **Unit**: Health check endpoint → 200 if all systems OK
3. **Integration**: Simulate Redis connection failure → health check → 503
4. **Integration**: Rate limit request, verify Redis backend used

### Complexity & Timeline
- **Startup validation**: S (1 day, ~20 lines)
- **Health endpoint**: S (1 day)
- **KV support**: M (optional, 2 days if implemented)

---

## 6. DATABASE CONNECTION RESILIENCE (MEDIUM)

### Current State
- **Architecture**: Hyperdrive + AsyncLocalStorage (ALS) pattern — **excellent**
- **Gaps**:
  - No connection timeout configuration
  - No explicit error handling for Hyperdrive unavailability
  - No retry logic (would hit raw CF Workers I/O error)
  - No health check endpoint

### Target State
1. Connection timeout: 5 second default
2. Automatic retry on transient failures (3 attempts, exponential backoff)
3. Health check validates DB connectivity (see #5 above)
4. Graceful degradation if DB unavailable (return cached data or error)

### Design

#### Timeout Configuration

**File**: `/src/lib/core/db.ts` (modify existing code)

```typescript
export function createRequestClient(connectionString: string): PrismaClient {
  if (dev) {
    // ... existing dev code
  }

  // ✅ NEW: Add connection timeout
  const adapter = new PrismaPg({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000, // 5s timeout
    idleTimeoutMillis: 30000, // 30s idle
    statement_timeout: 30000, // 30s per query
  });

  return new PrismaClient({
    adapter,
    log: ['error', 'warn']
  });
}
```

#### Retry Logic for Transient Failures

**File**: New `/src/lib/server/db-retry.ts`

```typescript
import { db } from '$lib/core/db';

interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 100,
  backoffMultiplier: 2,
  maxDelayMs: 1000
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Transient errors: timeout, pool exhaustion, network
      const isTransient =
        lastError.message.includes('timeout') ||
        lastError.message.includes('pool') ||
        lastError.message.includes('ECONNREFUSED');

      if (!isTransient || attempt === opts.maxAttempts) {
        throw lastError;
      }

      // Exponential backoff
      const delayMs = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
        opts.maxDelayMs
      );

      console.warn(
        `[DB Retry] Attempt ${attempt}/${opts.maxAttempts} failed, retrying in ${delayMs}ms:`,
        lastError.message
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

// Usage example:
// const user = await withRetry(() => db.user.findUnique({ ... }));
```

#### Error Handling in Routes

**File**: Example in `/src/routes/api/templates/+server.ts`

```typescript
import { withRetry } from '$lib/server/db-retry';

export const GET: RequestHandler = async () => {
  try {
    const templates = await withRetry(() =>
      db.template.findMany({
        where: { is_public: true },
        orderBy: { createdAt: 'desc' }
      })
    );

    return json({ success: true, data: { templates } });
  } catch (error) {
    console.error('[Templates] Unrecoverable DB error:', error);

    // Alert via Sentry
    Sentry.captureException(error, {
      level: 'fatal',
      tags: { endpoint: '/api/templates' }
    });

    return json(
      {
        success: false,
        error: 'Database temporarily unavailable. Please try again.'
      },
      { status: 503 }
    );
  }
};
```

### Files Affected
- `/src/lib/core/db.ts` (add timeout configuration)
- New: `/src/lib/server/db-retry.ts` (retry helper)
- API routes that do DB operations (incrementally add withRetry)

### Environment Variables
```
# Optional: override timeouts
DB_CONNECTION_TIMEOUT_MS="5000"
DB_IDLE_TIMEOUT_MS="30000"
DB_STATEMENT_TIMEOUT_MS="30000"
```

### Test Plan
1. **Unit**: withRetry succeeds on first attempt
2. **Unit**: withRetry retries on transient error, succeeds on attempt 2
3. **Unit**: withRetry exhausts max attempts → throws original error
4. **Integration**: Simulate Hyperdrive timeout, verify retry logic
5. **Integration**: Verify final error is captured and alerted via Sentry

### Complexity & Timeline
- **Timeout config**: S (1 day, already supported by PrismaPg)
- **Retry helper**: S (1 day, ~40 lines)
- **Route integration**: M (2-3 days, incrementally applied to critical paths)

---

## Implementation Timeline & Ownership

### Phase 1: CRITICAL (Week 1-2) — Pre-launch blocker
- [ ] **Billing enforcement** (Assignee: TBD) — 3-4 days
- [ ] **Error monitoring** (Assignee: TBD) — 2-3 days
- [ ] **Backup/restore** (Assignee: TBD) — 3-4 days

### Phase 2: HIGH (Week 2-3) — Before first org
- [ ] **Storage isolation** (Assignee: TBD) — 3-4 days
- [ ] **Rate limiter validation** (Assignee: TBD) — 1 day
- [ ] **DB health check** (Assignee: TBD) — 1 day

### Phase 3: MEDIUM (Week 3-4) — Post-launch improvements
- [ ] **Connection resilience** (retry + timeouts) (Assignee: TBD) — 2-3 days
- [ ] **Quarterly validation** (backup restore tests) (Assignee: TBD) — recurring

---

## Testing Strategy

### Unit Tests
- Billing quota: create template at limit, verify 403
- Rate limiter: missing Redis in prod → throw error
- Storage: draft IDs include userId, cannot see other users' data
- Retry: transient failure → succeed on retry; permanent failure → throw

### Integration Tests
- Billing: Stripe webhook increases limit, more templates allowed
- Error monitoring: Exception thrown → captured in Sentry with context
- Backup/restore: Restore from S3 backup → validate schema + run smoke tests

### E2E Tests
- Multi-user device: User A logs in, creates draft; User B logs in on same browser, sees empty store
- Rate limiting: Burst requests → rejected after limit
- Database failover: Hyperdrive connection drops → retry → succeed

### Monitoring & SLOs
- **Billing enforcement**: 100% of template creation requests gated (monitor in Sentry)
- **Error monitoring**: 95% of errors captured within 5 seconds
- **Backup automation**: 100% daily backup success rate (alert if failed)
- **Rate limiter**: 99.9% uptime (Redis connection failures < 0.1% of requests)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Billing gate blocks legitimate users | High | Test thoroughly; gradual rollout (10% → 50% → 100%); monitor quota errors |
| Sentry rate limit (100k events/month) | Medium | Implement sampling (10% in prod, 100% in staging); adjust as needed |
| Backup restore untested | High | Monthly dry-run restore to staging; quarterly full DR drill |
| Storage migration breaks existing drafts | Medium | Backward-compatible fallback; one-time migration on first access |
| Redis unavailability | High | Fail-fast validation; alert immediately; runbook documented |

---

## Sign-Off Checklist

- [ ] All 6 specs reviewed and approved
- [ ] Timeline confirmed with team
- [ ] Ownership assigned for each item
- [ ] Testing strategy documented and accepted
- [ ] Monitoring/alerting configuration in place
- [ ] Runbooks written (backup restore, error response, etc.)
- [ ] Pre-launch validation checklist created

---

## Appendix: References

- **Memory**: `/production_hardening_gaps.md` (assessment summary)
- **Rate Limiter**: `/src/lib/core/security/rate-limiter.ts` (703 lines, excellent)
- **Billing**: `/src/routes/api/billing/webhook/+server.ts` (Stripe sync)
- **Storage**: `/storage_isolation_gaps.md` (gap inventory)
- **Backup Domain Strings** (FROZEN): `commons-credential-v2` (PII encryption key domain)

---

**Document Version**: 1.0
**Last Updated**: 2026-03-23
**Next Review**: After Phase 1 completion (target: 2026-04-06)
