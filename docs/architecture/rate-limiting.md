# Rate Limiting Architecture

Multi-layer rate limiting for Commons, covering API abuse prevention and differential privacy budget enforcement.

---

## TL;DR

- **API layer**: Sliding window rate limits per route, integrated in `hooks.server.ts`
- **Analytics layer**: DP contribution limits (in-memory or Postgres-backed)
- **External API layer**: Circuit breakers with exponential backoff (Exa, Firecrawl)
- **Paid-provider layer**: Per-actor quotas plus one atomic account-wide Cloudflare Durable Object budget
- **Generic API backend**: In-memory in development; Redis is supported for distributed non-provider route limits
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
| `/api/do-not-contact/links` | 10/min | 60s | IP | Suppression-link mint floor — enforced in the handler, not in `hooks.server.ts`. The per-TARGET bound on the same route is a different axis; see [Per-recipient velocity](#per-recipient-velocity). |

**Exempt paths** (operational or separately authenticated): `/api/health`,
`/api/live`, `/api/cron/`

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

Paid AI work has two layers: per-actor quotas tiered by trust and one
account-wide weighted budget serialized by the SQLite-backed
`commons-convex-work-budget` Durable Object. Missing bindings, protocol drift,
timeouts, malformed state, unknown operations, and preview Pages all fail closed
before provider work.

**Canonical source:** `config/paid-provider-budget-policy.json`, validated by
`src/lib/server/paid-provider-budget-policy.ts`.

| Operation | Guest | Authenticated | Verified |
|---|---|---|---|
| Subject line | 0 (blocked) | 5/hr | 5/hr |
| Decision makers | 0 (blocked) | 2/hr | 3/hr |
| Message generation | 0 (blocked) | 3/hr | 5/hr |
| Embeddings | 0 (blocked) | 20/hr | 20/hr |
| Template search | 0 (blocked) | 20/hr | 30/hr |
| Template authoring | 0 (blocked) | 3/hr | 5/hr |
| Moderation check | 0 (blocked) | 5/hr | 5/hr |
| Moderation personalization | 0 (blocked) | 10/hr | 15/hr |
| Actor daily reservations | 0/day | 10/day | 15/day |

Trust tiers: guest (no session), authenticated (logged in), verified (trust_tier ≥ 2, address attested).

The platform ceiling is 1,000 weighted units/day and 2,632/UTC month across
production and preview. The monthly figure is not a preference: it is the
largest value the Exa free monthly credit funds under the `exa_monthly_headroom`
invariant (`src/lib/server/paid-provider-budget-policy.ts`), binding on
`decision-makers`. 2,633 fails that invariant at module load.

Ordinary users share operation-specific pools and a 750-unit daily public
tranche plus a monthly public **band**: 1,800 units guaranteed (the floor, and
what is enforced with no override written) up to 2,184 (the operator ceiling), so
a decision-maker flood cannot starve every other feature. An operator moves the
pool inside that band at runtime — through the admitting Durable Object's
`/pool-provider` path, reachable only from server code holding the binding, and
gated by the same server-derived operator allowlist — with no code change and no
redeploy. At the ceiling that is eight complete free journeys a month rather than
six; it is not unlimited, and the wall is the Exa free monthly credit.

The remaining 250 daily / 448 monthly units (the remainder at the ceiling) are
available only to an exact server-derived operator allowlist and stay inside—not
above—the hard platform cap. Payment never increases these limits. The override
accepts no payment, plan, or subscription input of any kind.

Every public admission performs at most eight SQLite row reads and writes. At
the 1,000-admission worst case that is 8,000 writes/day; combined with the
Pages-to-Convex coordinator's 81,920-row ceiling, it remains below Cloudflare's
100,000 free SQLite-row writes/day. The same stable object name is shared by
both realms, so a deploy, preview hostname, or new isolate cannot mint capacity.

> **Note:** Earlier revisions of this doc published a 10–30× higher quota table. The numbers above are the actual enforced limits. If you see older documents citing "15/hr" or "30/day verified" for any of these operations, treat those as stale.

---

## Per-recipient velocity

**Implementation**: `src/lib/server/recipient-velocity-policy.ts`,
`src/lib/server/recipient-velocity-client.ts`,
`workers/convex-work-budget.ts` (`/reserve-recipient`, `/status-recipient`),
`src/routes/api/do-not-contact/links/+server.ts`.
**Attack coverage**: `tests/unit/security/recipient-velocity-brigade.attack.test.ts`.

Every limit in the table above is keyed per-IP or per-user
(`src/lib/core/security/rate-limiter.ts:64` — `keyStrategy: 'ip' | 'user'`).
None of them bounds how many messages one *mailbox receives*. This section is
the only per-TARGET axis in the tree.

| Axis | Limit | Window | Key | Applies to |
|---|---|---|---|---|
| Suppression-link reservation | 3, plus at most 1 exact recovery response per reservation | UTC calendar day; recovery window 60s | SHA-256(`user:<id>` or `ip:<addr>`) × `computeGlobalEmailHash(address)` | Natural-person mailboxes only |

The three count is the admission ceiling. A reservation may return its same
deterministic link once inside 60 seconds so a lost response is recoverable. That
replay is bound to the exact source × target × template scope and persisted; a
different template consumes a new slot, and a second replay does too. Thus even
an adversarial no-delay loop has a finite ceiling of six link-bearing responses,
not the unbounded responses an ordinary time-only idempotency check would grant.

Non-congressional sends are client-assembled `mailto:`, so
`POST /api/do-not-contact/links` is the only server call that ever sees the
target address — and a send aborts when its suppression fact is not `present`.
That makes it the one seam where a per-recipient bound can exist at all, and it
costs no provider call, no Convex function, and no new binding.

**Who is bounded.** `classifyGovernmentalAddress(...).governmental === true` →
never, including a named official in that restricted registry.
`classifySeatRoute(...)?.form === 'person-form'` → bounded outside those
registries. `seat` → never.
Anything indeterminate or malformed → **bounded**, because missing evidence must
never widen a quota. The congressional relay returns before any of this:
petitioning an office is not harassment and is not throttled.

**Store.** The SQLite-backed `commons-convex-work-budget` Durable Object, on its
own object id (`recipient-velocity-v1`) so recipient admissions never serialize
behind paid-provider ones. In-memory counters are not an option here: "Per-isolate
memory state was rejected as load-bearing in prod because CF Workers spawn many
isolates and memory counters drift" (Storage, above). Redis was dropped
2026-05-16. Four tables: `recipient_velocity` (the bound),
`recipient_velocity_observed` (measurement, read by no admission), and
`recipient_velocity_mint` (the echo ledger, below), plus
`recipient_velocity_replay` (the exact-scope, bounded recovery ledger). Rows are keyed by hash — no
mailbox and no IP is ever stored or transmitted in plaintext. One Durable Object
request per send, batched across that send's whole roster, and at most three row
writes per granted address; rows are keyed by UTC day and are not swept, so the
store grows with distinct (source, target) pairs per day.

**Failure posture: this governor fails OPEN, and that diverges deliberately.**
Paid-provider work fails CLOSED (see LLM Cost Protection, above) because a
missed refusal there spends real money. Here, a missing binding, a timeout
(750ms), protocol drift, or a malformed response mints the links and records the
verdict as `unmeasured` — never as "within budget". Failing closed would turn any
Durable Object hiccup into a platform-wide gag on every private-mailbox send,
while granting an attacker nothing: anyone willing to open their own mail client
never touches this endpoint at all. The per-IP limiter in the route table stays
as the degraded floor.

**The echo ledger, and the disclosure it closes.** A refusal names the address
back to the caller only where that source has already minted for it *on this
template today*; an earlier 200 had already disclosed that the template publishes
that address, so the refusal adds nothing. A hold with no such prior mint emits
no entry at all and is indistinguishable from a roster miss. The cost is named,
not hidden: a sender who spent their quota on template A and then opens template
B sees the generic "could not be prepared for every recipient" message rather
than the honest volume copy.

### What this does NOT close

- **The multi-source brigade is counted, not blocked.** 200 senders from 200
  addresses each get their links. The observation row reads 200/200 and nothing
  refuses them. `/status-recipient` is currently an internal Durable Object
  protocol path exercised by the attack harness; no SvelteKit operator route is
  wired yet, so production operators cannot honestly be told that this is a
  dashboard or supported read surface.
- **Recovery responses add bounded reach.** Each of the three reservations may
  recover its deterministic link once within 60 seconds. A hostile rapid loop
  can therefore observe at most six link-bearing responses. Distinguishing a
  genuinely lost response from a caller who received it is impossible at this
  HTTP seam; the persisted one-replay cap makes that ambiguity finite.
- **Mixed-recipient sends pause as a whole.** An institutional address is never
  charged or held, but if the same browser-composed message also contains a held
  natural-person mailbox, the shared suppression fact is `withheld` and the
  whole message pauses. The sender-facing copy names the held mailbox; no
  recipient is silently dropped.
- **The `mailto` lane is bypassable in principle.** Anyone with their own
  mailto/SMTP tooling never calls this endpoint. This bounds *the platform as an
  instrument* — the share flow where thousands of ordinary participants click
  through the UI, which is the mode that actually produces a pile-on. No comment,
  doc line, or user-facing string may claim otherwise.
- **Shared-NAT collateral.** An office behind one IP shares one anonymous source
  key and can exhaust one target's three mints between them. Mitigated by
  preferring `user:<id>` where a session exists, by the narrowness of the scope
  (one mailbox, one day), and by honest copy. Accepted; the alternative is a
  global ceiling, which is worse — see below.
- **Nothing here suppresses anything.** The post-hoc `do-not-contact` opt-out is
  untouched, and a recipient's suppression link stays mintable by every sender
  who has not exhausted their own quota against that one mailbox.

### Open founder decision — `RECIPIENT_VELOCITY_GLOBAL_CEILING`

It ships as `null` and a test asserts it is still `null`, so nobody sets it
silently in code.

| Setting | What it would do | Evidence needed before choosing it |
|---|---|---|
| `null` (current) | Counts distinct sources and reservations but never refuses a new source globally | Current safe default while source identity is forgeable |
| Non-null, no identity floor | Stops new sources after the target-wide count reaches the number; burner IPs can weaponize it to silence others | Evidence that source keys resist cheap rotation and that false-positive censorship is acceptable |
| Non-null, verified-constituency floor | Lets proven constituents pass after the ceiling while refusing others | A founder decision that verification may become a speech precondition, plus measured exclusion/error rates |

> At what global volume to one private mailbox does the platform stop assisting
> *new* senders, and what must a sender show to keep sending past it — nothing, an
> account, `trust_tier >= 2`, or a proven district constituency?
>
> - Ceiling with no identity floor → weaponizable: burner IPs burn the target's
>   budget and silence the honest constituents behind them.
> - Ceiling gated on verified constituency → not weaponizable, but it makes
>   *verification a precondition of speech* above the threshold, which inverts the
>   product's stated posture that verification is demand-pull, and it excludes
>   people who cannot verify.
>
> Both are policy. The counter exists so the decision can be made on numbers.

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
1. Use the SQLite Durable Object as the paid-provider authority
2. Keep in-memory limits only for local development and approximate analytics
3. Fail provider work closed whenever the coordinator is unavailable

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
