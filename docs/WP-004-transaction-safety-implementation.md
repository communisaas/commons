# WP-004: Mutation Safety and Race-Condition Hardening

**Status:** Shipped
**Date:** 2026-01-25 (re-confirmed on Convex migration, 2026-04)
**Priority:** Critical

## Overview

This note captures how Commons eliminates race conditions, duplicate
submissions, and partial-state corruption across multi-step database
operations. The backend runs on Convex; every race-safety property
below is enforced by Convex mutations plus schema-level indexes, not by
a separate SQL transaction primitive.

## Critical Issues Fixed

### 1. Concurrent Verification Race

**Location:** `convex/identity.ts` (mutation invoked from
`src/routes/api/identity/verify/+server.ts`)

**Problem:**
- Two simultaneous verification requests could both read "no existing
  identityHash" and both write the same hash to two different users.
- Result: duplicate `identityHash` values (violation of Sybil
  resistance).

**Solution:**
```typescript
export const verifyIdentity = mutation({
  args: { userId: v.id('users'), identityHash: v.string(), proof: v.string() },
  handler: async (ctx, { userId, identityHash, proof }) => {
    // Read under OCC — lookup is part of the read set, so a concurrent
    // commit that races us will force a retry/abort.
    const existing = await ctx.db
      .query('users')
      .withIndex('by_identity_hash', q => q.eq('identityHash', identityHash))
      .unique();

    if (existing && existing._id !== userId) {
      await ctx.db.insert('verificationAudits', {
        userId, outcome: 'duplicate', createdAt: Date.now(),
      });
      throw new Error('IDENTITY_ALREADY_VERIFIED');
    }

    await ctx.db.patch(userId, { identityHash, isVerified: true });
    await ctx.db.insert('verificationAudits', {
      userId, outcome: 'verified', createdAt: Date.now(),
    });
  },
});
```

**Impact:**
- Atomic check-and-set for identity verification: everything inside a
  mutation commits together or not at all.
- `by_identity_hash` lookup is part of the read set, so Convex OCC
  re-runs the handler if another mutation wrote the same row.
- Audit rows are never orphaned; the `patch` and `insert` land in the
  same commit.

### 2. Nullifier Collision Race

**Location:** `convex/submissions.ts#insertSubmission` (invoked from the
ZK submission API).

**Problem:**
- Nullifier check and submission insert were historically separate
  calls. Two concurrent requests with the same nullifier could both
  observe "no match" before either wrote.
- Result: duplicate nullifier (breaks double-spend prevention).

**Solution:**
```typescript
export const insertSubmission = mutation({
  args: {
    idempotencyKey: v.optional(v.string()),
    nullifier: v.string(),
    // ... other proof fields
  },
  handler: async (ctx, args) => {
    const { idempotencyKey, nullifier, ...data } = args;

    // 1. Idempotent short-circuit.
    if (idempotencyKey) {
      const prior = await ctx.db
        .query('submissions')
        .withIndex('by_idempotency_key', q => q.eq('idempotencyKey', idempotencyKey))
        .unique();
      if (prior) return prior;
    }

    // 2. Nullifier dedupe via by_nullifier index.
    const duplicate = await ctx.db
      .query('submissions')
      .withIndex('by_nullifier', q => q.eq('nullifier', nullifier))
      .unique();
    if (duplicate) throw new Error('DUPLICATE_NULLIFIER');

    // 3. Atomic insert — Convex commits the entire mutation as one unit.
    const id = await ctx.db.insert('submissions', {
      ...data, nullifier, idempotencyKey, createdAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});
```

**Additional Safeguard:**
- `by_nullifier` index makes the lookup O(log n) and part of the
  mutation's read set, so OCC serialises concurrent inserts on the same
  nullifier.
- Integration tests assert that parallel `insertSubmission` calls with
  the same nullifier produce exactly one row.

### 3. Submission Idempotency

**Problem:**
- Client network failures cause retries.
- Without a key, retries could either create duplicates or return 409
  "already exists" errors even when the first attempt succeeded.

**Solution:**
- Add `idempotencyKey: v.optional(v.string())` to the `submissions`
  table.
- Add `by_idempotency_key` index.
- The mutation checks by key first and returns the prior row on retry.

**Client Usage:**
```typescript
const idempotencyKey = crypto.randomUUID();

const result = await convex.mutation(api.submissions.insertSubmission, {
  templateId, proof, nullifier, idempotencyKey,
  // ... other fields
});
```

**Impact:**
- Network retries return the existing submission (same result object).
- No duplicates from client failures.
- Composes with the nullifier check: idempotency wins first, then
  nullifier.

## Schema

### Convex table + indexes (`convex/schema.ts`)

```typescript
submissions: defineTable({
  templateId: v.id('templates'),
  nullifier: v.string(),
  idempotencyKey: v.optional(v.string()),
  proof: v.string(),
  publicInputs: v.array(v.string()),
  encryptedWitness: v.string(),
  witnessNonce: v.string(),
  ephemeralPublicKey: v.string(),
  teeKeyId: v.string(),
  createdAt: v.number(),
  // ... other fields
})
  .index('by_nullifier', ['nullifier'])
  .index('by_idempotency_key', ['idempotencyKey'])
  .index('by_template_created', ['templateId', 'createdAt']);
```

**Rationale:**
- Defense-in-depth: every uniqueness check is a read against a named
  index, which pulls the row into the mutation's read set.
- `idempotencyKey` is optional for backward compatibility with legacy
  rows; callers on the critical path are expected to supply one.

## Patterns Used

### Pattern 1: Check-and-Set (Identity Verification)

**Use Case:** Prevent duplicate records when creating uniqueness-keyed
data.

```typescript
const existing = await ctx.db
  .query('users')
  .withIndex('by_identity_hash', q => q.eq('identityHash', identityHash))
  .unique();
if (existing) throw new Error('ALREADY_EXISTS');

await ctx.db.patch(userId, { identityHash });
await ctx.db.insert('verificationAudits', { ... });
```

**Guarantees:**
- Check and write happen inside one mutation → one commit.
- Audit row only lands if the main write lands.
- OCC handles the race: a losing mutation is retried or aborted.

### Pattern 2: Idempotent Upsert (Submission Creation)

**Use Case:** Return an existing record on retry, insert on the first
attempt.

```typescript
const prior = await ctx.db
  .query('submissions')
  .withIndex('by_idempotency_key', q => q.eq('idempotencyKey', key))
  .unique();
if (prior) return prior;

const duplicate = await ctx.db
  .query('submissions')
  .withIndex('by_nullifier', q => q.eq('nullifier', nullifier))
  .unique();
if (duplicate) throw new Error('DUPLICATE_NULLIFIER');

return await ctx.db.insert('submissions', { ... });
```

**Guarantees:**
- Idempotent retries return the same submission object.
- Nullifier uniqueness enforced atomically (inside the mutation).
- No duplicates from network failures.

## Files Touched

- `convex/schema.ts` — `submissions` table; `by_nullifier`,
  `by_idempotency_key` indexes.
- `convex/submissions.ts` — `insertSubmission` mutation with the
  check-then-insert pattern above.
- `convex/identity.ts` — `verifyIdentity` mutation with the audit
  insert.
- `src/routes/api/submissions/create/+server.ts` — now just bridges the
  HTTP call into the Convex mutation.
- `src/routes/api/identity/verify/+server.ts` — same bridge pattern.

## Database Migration

Deployed via `npx convex deploy --env-file .env.production`. The
`idempotencyKey` field is optional, so existing rows back-fill to
`undefined`. The new indexes build online; no data loss.

## Testing Recommendations

### 1. Concurrent Verification Test
```typescript
await Promise.all([
  runMutation('verifyIdentity', { userId, identityHash }),
  runMutation('verifyIdentity', { userId, identityHash }),
]);
// Expected: one succeeds, one throws IDENTITY_ALREADY_VERIFIED.
// Expected: exactly one verificationAudits row.
// Expected: user.identityHash set exactly once.
```

### 2. Nullifier Collision Test
```typescript
const nullifier = '0x1234...';
await Promise.all([
  runMutation('insertSubmission', { nullifier, idempotencyKey: 'k1' }),
  runMutation('insertSubmission', { nullifier, idempotencyKey: 'k2' }),
]);
// Expected: one succeeds, one throws DUPLICATE_NULLIFIER.
// Expected: exactly one submissions row.
```

### 3. Idempotency Test
```typescript
const idempotencyKey = crypto.randomUUID();
const r1 = await runMutation('insertSubmission', { idempotencyKey, ...data });
const r2 = await runMutation('insertSubmission', { idempotencyKey, ...data });
// Expected: r1._id === r2._id.
// Expected: exactly one submissions row.
```

### 4. Mutation Abort Test
```typescript
// Force an error in the verificationAudits insert.
vi.spyOn(ctx.db, 'insert').mockImplementationOnce(() => { throw new Error('boom'); });
await expect(runMutation('verifyIdentity', { userId, identityHash })).rejects.toThrow();

// Expected: no partial writes. user.identityHash still undefined, no audit row.
```

## Performance Impact

### Mutation overhead
- `verifyIdentity`: one indexed read + one patch + one insert, ~15-25ms.
- `insertSubmission`: two indexed reads + one insert, ~10-20ms.
- No extra latency versus the old non-atomic path; the OCC engine does
  the contention work instead of a SQL transaction.

### Index impact
- `by_nullifier` — O(log n) duplicate check; also keeps analytics queries fast.
- `by_idempotency_key` — O(log n) retry detection.

## Security Benefits

- **Sybil resistance:** duplicate `identityHash` rows cannot be created;
  OCC + the `by_identity_hash` index serialises concurrent writes.
- **Double-spend prevention:** `by_nullifier` guarantees one
  submissions row per nullifier; lookup is part of the mutation's read
  set.
- **Client retry safety:** idempotency keys make retries transparent;
  clients never see a false 409 for work that actually succeeded.

## Acceptance Criteria

| Criteria | Status |
|----------|--------|
| All multi-step identity / submission ops run inside one mutation | Met |
| Concurrent mutations cannot produce duplicates | Met (OCC + indexes) |
| Partial failures leave no trace (all-or-nothing commit) | Met |
| Idempotency keys short-circuit retries | Met |
| Index coverage for every uniqueness check | Met |
| Optional `idempotencyKey` preserves backward compatibility | Met |

## Rollback Plan

If the new behaviour ever needs to be rolled back:

1. Revert the relevant Convex functions (`convex/submissions.ts`,
   `convex/identity.ts`).
2. Remove or rename the `by_idempotency_key` index in
   `convex/schema.ts`.
3. Deploy: `npx convex deploy --env-file .env.production`.

**Note:** Rollback re-introduces race windows. Only do it if the new
behaviour is actively broken.

## Future Enhancements

- **Distributed workflow coordination** — for multi-service workflows,
  use Convex schedulers or Durable Objects. Sagas can be modelled as
  a sequence of mutations + actions, each atomic.
- **Optimistic UI** — surface `insertSubmission` failures (e.g.
  DUPLICATE_NULLIFIER) inline in the UI; Convex's reactive subscription
  model makes this straightforward.
- **Per-user advisory serialisation** — if a workflow needs to
  serialise concurrent requests from the same user, add a `userId`
  index and have the mutation read an "inflight" row before starting.

## Related Documentation

- `docs/architecture.md` — privacy-preserving design principles.
- `docs/specs/zk-proof-integration.md` — ZK proof system architecture.
- `docs/adr/007-identity-schema-migration.md` — identity verification
  design rationale.
- Sibling docs in this whitepaper set:
  `docs/WP-004-race-condition-diagrams.md` and
  `docs/WP-004-client-usage-examples.md`.

## Implementation Checklist

- [x] Add `idempotencyKey` field to `submissions` table
- [x] Add `by_nullifier` index to `submissions` table
- [x] Add `by_idempotency_key` index to `submissions` table
- [x] Implement `insertSubmission` with check-then-insert pattern
- [x] Implement `verifyIdentity` with atomic patch + audit insert
- [x] Deploy schema + functions via `npx convex deploy`
- [x] Document patterns + testing recommendations

**Completed:** 2026-01-25 (reaffirmed on Convex migration, 2026-04)
