# Rate Limiting Architecture

Multi-layer rate limiting for Commons, covering API abuse prevention and differential privacy budget enforcement.

---

## TL;DR

- **API layer**: Sliding window rate limits per route, integrated in `hooks.server.ts`
- **Analytics layer**: DP contribution limits (in-memory or Postgres-backed)
- **External API layer**: Circuit breakers with exponential backoff (Exa, Firecrawl)
- **Agent layer**: Per-session and per-tier LLM quotas
- **Backend**: In-memory per-isolate by default; Redis supported via `REDIS_URL` for distributed rate limiting
- **Privacy note**: For differential privacy, exact rate limiting is NOT required

---

## API Rate Limiting

**Implementation**: `src/lib/core/security/rate-limiter.ts` + `src/hooks.server.ts`

Sliding window log algorithm applied per route. Executes in the `handleRateLimit` hook after auth (so user ID is available for user-keyed limits).

### Route Limits

| Route Pattern | Limit | Window | Key | Purpose |
|---|---|---|---|---|
| `/api/identity/` | 10/min | 60s | IP | Verification abuse |
| `/api/shadow-atlas/register` | 5/min | 60s | User | Registration abuse |
| `/api/shadow-atlas/cell-proof` | 10/min | 60s | User | Cell ID enumeration |
| `/api/legislative/submit` | 3/hr | 3600s | User | Legislative spam (renamed from `/api/congressional/submit`) |
| `/api/auth/passkey/register` | 5/min | 60s | User | Registration attempts |
| `/api/auth/passkey/authenticate` | 10/min | 60s | IP | Authentication brute-force |
| `/api/location/` | 5/min | 60s | IP | District lookup throttle |
| `/api/submissions/` | 5/min | 60s | IP | CWC submission spam |
| `/api/templates` | 10/day | 86400s | User | Template farming (anti-astroturf) |
| `/api/moderation/` | 30/min | 60s | IP | Moderation abuse |
| `/api/email/` | 10/min | 60s | User | Email send throttle |
| `/api/emails/` | 5/min | 60s | User | Bounce report throttle |
| `/api/email/confirm/` | 10/min | 60s | IP | Confirmation brute-force |
| `/api/debates/` | 20/min | 60s | User | Debate market browsing |
| `/api/wallet/nonce` | 10/min | 60s | IP | Nonce generation |
| `/api/wallet/connect` | 5/min | 60s | User | Wallet binding |
| `/api/wallet/near/sponsor` | 10/min | 60s | User | Meta-transaction relay |
| `/api/wallet/balance` | 30/min | 60s | IP | Balance endpoint |

**Exempt paths** (separately authenticated): `/api/health`, `/api/cron/`

### 429 Response

```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1741536000
Retry-After: 45
```

### Hook Execution Order

```
handlePlatformEnv → handleAuth → handleRateLimit → handleCsrfGuard → handleSecurityHeaders → handleRejectionMonitoring
```

Rate limiting runs after auth so user-keyed limits can use the authenticated user ID. IP-keyed limits work for unauthenticated requests.

### Storage

- **Development**: In-memory Map (zero config, 5-minute cleanup interval). Also the fallback for dev/test when `REDIS_URL` is unset.
- **Production**: Redis (via `REDIS_URL`). **Constructor throws at boot** if `NODE_ENV=production` and `REDIS_URL` is unset, unless `RATE_LIMITER_ALLOW_MEMORY=1` explicitly opts in (useful for single-isolate local-prod smoke tests only). Per-isolate memory state was rejected as load-bearing in prod because CF Workers spawn many isolates and memory counters drift. See `src/lib/core/security/rate-limiter.ts:283+`.
- **Rejection monitoring**: Async webhook alerts when rejection rate exceeds threshold (`REJECTION_THRESHOLD_PERCENT`, default 1%)

---

## LLM Cost Protection

**Implementation**: `src/lib/server/llm-cost-protection.ts`

Per-user quotas for AI agent operations, tiered by trust level.

**Canonical source:** `src/lib/server/llm-cost-protection.ts` (`QUOTAS` map, ~line 52). Values below verified against that file on 2026-04-23.

| Operation | Guest | Authenticated | Verified |
|---|---|---|---|
| Subject line | 3/hr | 5/hr | 5/hr |
| Decision makers | 0 (blocked) | 2/hr | 3/hr |
| Message generation | 0 (blocked) | 3/hr | 5/hr |
| Embeddings | 0 (blocked) | 20/hr | 20/hr |
| Daily global (circuit breaker) | 3/day | 10/day | 15/day |

Trust tiers: guest (no session), authenticated (logged in), verified (trust_tier ≥ 2, address attested).

> **Note:** Earlier revisions of this doc published a 10–30× higher quota table. The numbers above are the actual enforced limits. If you see older documents citing "15/hr" or "30/day verified" for any of these operations, treat those as stale.

---

## External API Circuit Breakers

**Implementation**: `src/lib/server/exa/rate-limiter.ts`, `src/lib/server/firecrawl/rate-limiter.ts`

Circuit breaker pattern (closed → open → half-open) with exponential backoff for external API calls.

| Service | QPS Limit | Retries | Base Delay | Reset Timeout |
|---|---|---|---|---|
| Exa Search | 4 | 3 | 1s | 30s |
| Exa Contents | 40 | 2 | 500ms | 15s |
| Firecrawl | 10 | 2 | 1s | 30s |

Backoff: `baseDelay × 2^(attempt-1) + jitter(0-200ms)`. Respects `Retry-After` headers.

---

## Analytics Rate Limiting (Differential Privacy)

### Why Exact Rate Limiting Doesn't Matter for DP

The analytics system uses differential privacy (DP) to protect user privacy. Rate limiting exists to **bound sensitivity** - the maximum impact any single user can have on aggregate statistics.

**Key insight**: The privacy guarantee comes from the Laplace noise added to query results, not from exact rate limit enforcement.

If someone sends 150 contributions instead of 100 due to multi-instance race conditions:
- The DP noise parameters are calibrated for sensitivity=1
- Each individual contribution still has sensitivity=1
- The privacy guarantee (epsilon) remains intact
- The only impact is slightly more "true signal" in the data (acceptable)

**Bottom line**: Approximate rate limiting is acceptable for privacy. The limit exists to prevent unbounded influence, not exact enforcement.

---

### Option 1: In-Memory (Current)

**Status**: Active in production

**Implementation**: `src/lib/core/analytics/aggregate.ts` and `src/lib/server/rate-limiter.ts`

```typescript
const rateLimits = new Map<string, { count: number; windowStart: number }>();
```

**Pros**:
- Zero latency (no network round-trip)
- Zero cost (no external service)
- Zero configuration
- Simple debugging

**Cons**:
- State lost on deploy
- Per-instance only (no cross-instance coordination)
- Memory growth with unique IPs (mitigated by cleanup)

**When to use**: MVP, single-instance Cloudflare Pages deployment

---

### Option 2: Postgres-Based (Recommended Upgrade)

**Status**: Implemented, behind feature flag

**Implementation**: `src/lib/core/analytics/rate-limit-db.ts`

```typescript
// Enable with environment variable
RATE_LIMIT_USE_DB=true

// Usage
const result = await checkContributionLimitDB(hashedIP, 'template_view');
if (result.allowed) {
  await incrementAggregate('template_view', dimensions);
}
```

### How It Works

1. **Atomic upsert** with conditional increment:

```sql
INSERT INTO rate_limits (key, window_start, count)
VALUES ($key, $today, 1)
ON CONFLICT (key, window_start)
DO UPDATE SET count = CASE
  WHEN rate_limits.count < $limit THEN rate_limits.count + 1
  ELSE rate_limits.count
END
RETURNING count, (count <= $limit) as allowed
```

2. **Single round-trip** per check (no read-then-write race)

3. **Day granularity** for windows (efficient storage, matches DP daily budget)

### Schema

```ts
// convex/schema.ts
rateLimits: defineTable({
  key: v.string(),              // "sha256(ip):metric_name"
  windowStart: v.number(),      // day-aligned epoch ms
  count: v.number(),            // default 1
})
  .index("by_key_window", ["key", "windowStart"])   // uniqueness enforced in mutation
  .index("by_windowStart", ["windowStart"])
```

### Cleanup

Daily cron job deletes entries older than 2 days:

```typescript
// In cron handler
await cleanupOldRateLimits(2);
```

**Pros**:
- Works across multiple instances
- Uses existing infrastructure (Neon Postgres)
- Atomic operations prevent race conditions
- Survives deploys

**Cons**:
- Database round-trip per check (~5-10ms to Neon)
- Connection pool usage
- Requires cleanup cron job

**When to use**: Multi-instance Cloudflare Pages deployment, or when exact cross-instance coordination matters

---

### Option 3: Hybrid Approach

**Status**: Implemented in `rate-limit-db.ts`

Combines in-memory fast-path with Postgres source of truth:

```typescript
const result = await checkContributionLimitHybrid(hashedIP, metric);
```

### How It Works

1. **Fast path**: Check local cache for known exceeded limits
   - If exceeded today, skip DB query entirely
   - Reduces DB load for repeat offenders

2. **Slow path**: Query Postgres for authoritative check
   - Update local cache when limit exceeded
   - Cache entries expire when window changes

```typescript
// Fast path
const cached = localCache.get(key);
if (cached && cached.windowStart === todayStart) {
  return { allowed: false, ... }; // Skip DB
}

// Slow path
const result = await checkContributionLimitDB(...);
if (!result.allowed) {
  localCache.set(key, { exceededAt: now, windowStart: todayStart });
}
```

**Tradeoffs**:
- Slightly more requests may get through (cache miss before DB limit hit)
- Per-instance cache, so blocked on one instance may not block on another
- For DP purposes, this approximation is acceptable

**When to use**: High-traffic scenarios where DB round-trips are a concern

---

### Option 4: Accept Approximate (Simplest)

**Status**: Always an option

For privacy purposes, approximate rate limiting is actually fine. Document that the limit is advisory and move on.

```typescript
// Document the approximation
// The 100/day limit is approximate in multi-instance deployments
// Privacy guarantee comes from DP noise, not rate limits
```

**When to use**: When simplicity matters more than exact enforcement

---

### Migration Path

### MVP (Now)
1. Use in-memory rate limiting
2. Single Cloudflare Pages instance
3. Circuit breaker ($5/day) as ultimate protection

### Growth (When Needed)
1. Add `RATE_LIMIT_USE_DB=true` to environment
2. Add `rateLimits` table to `convex/schema.ts` and deploy (`npx convex deploy --env-file .env.production`)
3. Add cleanup to daily cron job
4. Monitor DB connection usage

### Scale (10+ instances, 50K+ MAU)
1. Consider Redis if Postgres becomes bottleneck
2. One day of work when you have money and team

---

### Configuration

#### Environment Variables

```bash
# Enable Postgres-based rate limiting
RATE_LIMIT_USE_DB=true

# (Optional) Custom limits per metric - future enhancement
# RATE_LIMIT_TEMPLATE_VIEW=100
# RATE_LIMIT_DELIVERY_ATTEMPT=10
```

#### Constants

From `src/lib/types/analytics/metrics.ts`:

```typescript
export const PRIVACY = {
  // ...
  MAX_DAILY_CONTRIBUTIONS: 100  // Default limit per identifier per metric
};
```

---

### Monitoring

#### Stats Endpoint

```typescript
import { getRateLimitStats } from '$lib/core/analytics/rate-limit-db';

const stats = await getRateLimitStats();
// { activeEntries: 1234, todayEntries: 567, implementation: 'postgres' }
```

#### Logs

Rate limiting logs to console:
- `[RateLimitDB] Cleanup: deleted N entries older than 2 days`
- `[RateLimitDB] Error checking rate limit: ...`
- `[RateLimitDB] Local cache cleanup: removed N stale entries`

---

### Error Handling

#### Graceful Degradation

On any database error, rate limiting falls back to **permissive** (allowing the request):

```typescript
try {
  // Check rate limit
} catch (error) {
  console.error('[RateLimitDB] Error:', error);
  return { allowed: true, source: 'fallback' };
}
```

**Rationale**: Privacy > availability. We'd rather let through a few extra contributions than block legitimate users due to a transient DB issue.

#### Result Source

Every rate limit result includes `source` field:
- `'db'`: Result from Postgres (authoritative)
- `'fallback'`: Database error or feature flag disabled

---

### Security Considerations

#### IP Hashing

Client IPs are hashed before use as rate limit keys:

```typescript
function hashIP(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}
```

This prevents:
- IP addresses appearing in database
- Correlation attacks via rate limit keys
- PII leakage in logs

#### Rate Limit Keys

Format: `{hashed_ip}:{metric_name}`

Example: `a7f9b2c3d4e5f6...1234:template_view`

---

### Performance Characteristics

#### Postgres-Based

| Operation | Latency (Neon Serverless) |
|-----------|---------------------------|
| Single check | 5-15ms |
| Batch check (N keys) | 5-20ms |
| Cleanup (1000 entries) | 50-100ms |

#### Connection Pool Impact

Each rate limit check uses one connection briefly. With Neon's connection pooling:
- Serverless scales automatically
- No connection exhaustion under normal load
- Consider hybrid approach for very high traffic

---

### Future Enhancements

#### Per-Metric Limits

```typescript
const METRIC_LIMITS: Record<Metric, number> = {
  template_view: 100,
  delivery_attempt: 10,  // Lower limit for expensive operations
  // ...
};
```

#### Sliding Windows

Current: Fixed daily windows (midnight UTC to midnight UTC)
Future: True sliding windows (past 24 hours) for smoother rate limiting

#### Distributed Caching

If Postgres becomes a bottleneck:
1. Add Upstash Redis ($0.20/100K commands)
2. Use Redis for hot path, Postgres for durability
3. Still simpler than self-hosted Redis

---

---

## Key Files

| File | Purpose |
|---|---|
| `src/lib/core/security/rate-limiter.ts` | Sliding window API rate limiter |
| `src/hooks.server.ts` | Hook integration (handleRateLimit) |
| `src/lib/server/llm-cost-protection.ts` | LLM quota enforcement |
| `src/lib/core/analytics/rate-limit-db.ts` | Postgres-backed DP rate limiting |
| `src/lib/server/rate-limiter.ts` | In-memory rate limiter (internal APIs) |
| `src/lib/server/exa/rate-limiter.ts` | Exa circuit breaker |
| `src/lib/server/firecrawl/rate-limiter.ts` | Firecrawl circuit breaker |
| `src/lib/services/ai/rate-limiter.ts` | Client-side AI suggestion limiter |

## Related Documents

- `docs/specs/privacy-first-analytics.md` - DP implementation details
- `src/lib/types/analytics/metrics.ts` - PRIVACY constants
- `src/lib/core/analytics/aggregate.ts` - In-memory rate limiting
- `src/lib/server/rate-limiter.ts` - Generic rate limiter class
