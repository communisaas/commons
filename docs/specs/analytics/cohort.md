# Cohort Analysis

> **DEPRECATED**: Cohort tokens have been removed from the analytics system.
> Client-side tracking tokens created unnecessary linkability with no benefit.
> See [Phase 4 Cleanup](../../analytics-phase4-cleanup.md) for details.

**Module:** `src/lib/core/analytics/cohort.ts` (DELETED - backed up to `cohort.ts.bak`)
**Types:** `src/lib/types/analytics/cohort.ts` (preserved for potential server-side use)

---

## Deprecation Notice

As of 2026-01-12, the cohort token system has been **completely removed**:

1. **Client-side tokens were never used** - Server ignored `cohort_token` dimension
2. **Created linkability for zero benefit** - Tokens in logs/requests without purpose
3. **Violated privacy principles** - Unnecessary identifiers reduce privacy surface

**What was removed:**
- `src/lib/core/analytics/cohort.ts` - Token generation/storage (deleted)
- `getOrCreateCohortToken()` function (deleted)
- `clearCohortToken()` function (deleted)
- Client-side cohort token attachment in requests (removed)

**What remains:**
- Type definitions in `src/lib/types/analytics/cohort.ts` (for potential server-side use)
- Server-side aggregate cohort analysis (possible via aggregate patterns)

---

## Historical Context (Pre-Deprecation)

The following documentation describes the **former** cohort system for historical reference.

---

## Problem Statement

We need retention metrics:
- Is the movement growing or stalling?
- Do templates drive one-time use or sustained engagement?
- Are people coming back?

Traditional approach: Track user IDs across sessions. **We won't do this.**

---

## Solution: Random Cohort Tokens

A cohort token is:
- **Random UUID** — Not derived from identity
- **Browser-local** — Different token per device
- **Time-limited** — 30-day TTL, then expires
- **User-clearable** — Delete localStorage = new cohort
- **Not linked to accounts** — Anonymous by design

```typescript
// What a cohort token looks like
interface CohortToken {
  token: string;        // crypto.randomUUID()
  created: number;      // Date.now() when first generated
  expires: number;      // created + 30 days
}

// Stored in localStorage
localStorage.setItem('cohort', JSON.stringify({
  token: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  created: 1704067200000,
  expires: 1706659200000
}));
```

---

## How It Works

### Token Lifecycle

```
First action on device
        ↓
Generate random UUID → Store in localStorage (30-day TTL)
        ↓
Include token in increments (optional dimension)
        ↓
Server aggregates: "tokens first seen in Week N"
        ↓
Subsequent action
        ↓
Retrieve existing token → Include in increment
        ↓
Server aggregates: "tokens from Week N seen in Week N+1"
        ↓
Token expires (30 days) OR user clears localStorage
        ↓
Generate new token → Previous cohort forgotten
```

### Client Implementation

```typescript
// cohort.ts

const COHORT_KEY = 'analytics_cohort';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function getOrCreateToken(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(COHORT_KEY);

    if (stored) {
      const cohort: CohortToken = JSON.parse(stored);

      // Check expiration
      if (Date.now() < cohort.expires) {
        return cohort.token;
      }

      // Expired — remove and fall through to create new
      localStorage.removeItem(COHORT_KEY);
    }

    // Create new cohort token
    const token = crypto.randomUUID();
    const cohort: CohortToken = {
      token,
      created: Date.now(),
      expires: Date.now() + TTL_MS
    };

    localStorage.setItem(COHORT_KEY, JSON.stringify(cohort));
    return token;

  } catch {
    // localStorage unavailable (private browsing, etc.)
    return null;
  }
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(COHORT_KEY);
}
```

### Server Aggregation

Cohort retention is computed from aggregate data:

```typescript
// Server: cohort retention query
export async function getCohortRetention(
  cohortWeek: Date
): Promise<CohortRetention> {

  // Count unique tokens first seen in cohort week
  const initialSize = await db.analytics_aggregate.aggregate({
    where: {
      metric: 'cohort_first_seen',
      date: { gte: startOfWeek(cohortWeek), lte: endOfWeek(cohortWeek) }
    },
    _sum: { count: true }
  });

  // Count tokens from that cohort seen in subsequent weeks
  const week1 = await countCohortInWeek(cohortWeek, 1);
  const week2 = await countCohortInWeek(cohortWeek, 2);
  const week3 = await countCohortInWeek(cohortWeek, 3);
  const week4 = await countCohortInWeek(cohortWeek, 4);

  return {
    cohort_week: cohortWeek.toISOString(),
    initial_size: applyNoise(initialSize._sum.count),
    retention: {
      week_1: applyNoise(week1) / initialSize._sum.count,
      week_2: applyNoise(week2) / initialSize._sum.count,
      week_3: applyNoise(week3) / initialSize._sum.count,
      week_4: applyNoise(week4) / initialSize._sum.count,
    }
  };
}
```

---

## Privacy Properties

| Threat | Mitigation |
|--------|------------|
| Token links to user account | Token is random UUID, never stored with user_id |
| Cross-device tracking | Different token per device |
| Long-term profiling | 30-day TTL, then new token |
| User can't opt out | Clear localStorage = new cohort |
| Subpoena for user data | Tokens don't map to humans |

### What an adversary sees

```
Token a1b2c3d4... appeared in Week 1, Week 2, Week 3
Token e5f6g7h8... appeared in Week 1 only
Token i9j0k1l2... appeared in Week 2, Week 3
```

They **cannot** determine:
- Who these tokens belong to
- What device generated them
- If two tokens are the same person on different devices
- Anything about the human behind the token

---

## Schema Addition

```typescript
// convex/schema.ts
analyticsCohort: defineTable({
  // Cohort identification (YYYY-MM-DD of week start)
  cohortWeek: v.string(),

  // Retention metrics (all noisy when queried)
  initialSize: v.number(),
  week1Active: v.number(),
  week2Active: v.number(),
  week3Active: v.number(),
  week4Active: v.number(),

  // Noise metadata
  epsilon: v.number(),
}).index("by_cohort_week", ["cohortWeek"]);
```

---

## API

### GET /api/analytics/cohort

```typescript
// Request
GET /api/analytics/cohort?weeks=4

// Response
{
  "cohorts": [
    {
      "cohortWeek": "2025-01-06",
      "initialSize": 234,       // noisy
      "retention": {
        "week1": 0.67,          // noisy
        "week2": 0.45,
        "week3": 0.38,
        "week4": 0.31
      }
    },
    // ... more cohorts
  ],
  "privacy": {
    "epsilon": 1.0,
    "differentialPrivacy": true
  }
}
```

---

## Type Definitions

```typescript
// src/lib/types/analytics/cohort.ts

export interface CohortToken {
  token: string;
  created: number;
  expires: number;
}

export interface CohortRetention {
  cohortWeek: string;
  initialSize: number;
  retention: {
    week1: number;
    week2: number;
    week3: number;
    week4: number;
  };
}

export interface CohortQueryResponse {
  cohorts: CohortRetention[];
  privacy: {
    epsilon: number;
    differentialPrivacy: true;
  };
}
```

---

## Integration with Client

The cohort token is an **optional dimension** on increments:

```typescript
// client.ts
export function increment(metric: Metric, dimensions?: Dimensions): void {
  const cohortToken = cohort.getOrCreateToken();

  const fullDimensions: Dimensions = {
    ...sanitize(dimensions),
    cohortToken: cohortToken  // Added automatically
  };

  queue.add({ metric, dimensions: fullDimensions });
}
```

Server processes cohort tokens to compute weekly cohort membership, then **discards the raw token data**. Only aggregate cohort counts are stored.

---

*Cohort Analysis Specification | DEPRECATED 2026-01*
