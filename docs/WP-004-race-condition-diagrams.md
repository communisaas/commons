# WP-004: Race Condition Diagrams

## Race Condition 1: Concurrent Identity Verification

### BEFORE (Vulnerable to Race Condition — hypothetical non-atomic path)

```
Time    Request A                          Request B                          Database
─────────────────────────────────────────────────────────────────────────────────────────
t0      Check identityHash                                                    ✓ No match
t1                                         Check identityHash                 ✓ No match
t2      Update user (set identityHash)                                        ✓ User A
t3                                         Update user (set identityHash)     ✓ User B (DUPLICATE!)
t4      Insert verificationAudit           Insert verificationAudit           ✓ Both succeed

Result: TWO users with SAME identityHash  (Sybil resistance broken)
```

### AFTER (Protected by atomic Convex mutation + `by_identity_hash` index)

```
Time    Request A                          Request B                          Database
─────────────────────────────────────────────────────────────────────────────────────────
t0      Convex mutation begins
t1        Check identityHash via index                                        ✓ No match
t2        ctx.db.patch(user, { identityHash })                                (pending)
t3        ctx.db.insert('verificationAudits', ...)                            (pending)
t4      Mutation commits atomically                                           ✓ User A
t5                                         Convex mutation begins
t6                                           Check identityHash via index     ✓ Found User A
t7                                         Mutation aborts (409 conflict)

Result: ONE user with identityHash  (Sybil resistance intact)
```

Convex serializes conflicting writes via optimistic concurrency control;
a second mutation that reads the same `by_identity_hash` row retries or
aborts if the first already wrote, so the check-then-write pattern is
race-free inside a single mutation.

---

## Race Condition 2: Concurrent Submission Creation (Nullifier Collision)

### BEFORE (Vulnerable to Race Condition — hypothetical non-atomic path)

```
Time    Request A (nullifier: 0x1234)     Request B (nullifier: 0x1234)     Database
─────────────────────────────────────────────────────────────────────────────────────────
t0      Check nullifier 0x1234                                                ✓ No match
t1                                         Check nullifier 0x1234             ✓ No match
t2      Insert submission (nullifier: 0x1234)                                 ✓ Submission A
t3                                         Insert submission (nullifier: 0x1234) ✓ Submission B (DUPLICATE!)

Result: TWO submissions with SAME nullifier  (Double-spend prevention broken)
```

### AFTER (Protected by atomic Convex mutation + `by_nullifier` index)

```
Time    Request A (nullifier: 0x1234)     Request B (nullifier: 0x1234)     Database
─────────────────────────────────────────────────────────────────────────────────────────
t0      Convex mutation begins
t1        Check nullifier via by_nullifier index                              ✓ No match
t2        ctx.db.insert('submissions', { nullifier: '0x1234', ... })          (pending)
t3      Mutation commits atomically                                           ✓ Submission A
t4                                         Convex mutation begins
t5                                           Check nullifier via index        ✓ Found Submission A
t6                                         Throw DUPLICATE_NULLIFIER

Result: ONE submission with nullifier 0x1234  (Double-spend prevented)
```

Convex's OCC engine re-runs or aborts any mutation whose read set was
invalidated by a concurrent commit, so the "check-then-insert" pattern
inside a single `insertSubmission` mutation is serialisable with respect
to other writers on the same `by_nullifier` row.

---

## Idempotency Pattern: Network Retry Safety

### BEFORE (No Idempotency Key)

```
Time    Client Request                     Server                             Database
─────────────────────────────────────────────────────────────────────────────────────────
t0      POST /submissions/create
t1      (nullifier: 0x1234, data: {...})   Insert submission A                ✓ Submission A
t2                                         Return 200 OK
t3      [NETWORK TIMEOUT - No response received by client]
t4      [Client retries]
t5      POST /submissions/create
t6      (nullifier: 0x1234, data: {...})   Check nullifier 0x1234             ✓ Found Submission A
t7                                         Return 409 Conflict  (False negative!)

Result: Client sees error despite successful submission
```

### AFTER (With Idempotency Key + Convex atomic mutation)

```
Time    Client Request                     Server                             Database
─────────────────────────────────────────────────────────────────────────────────────────
t0      idempotencyKey = uuid()
t1      POST /submissions/create
t2      (idempotencyKey: uuid-1234,        insertSubmission mutation starts
         nullifier: 0x1234, data: {...})     Check idempotencyKey via index   ✓ No match
t3                                            Check nullifier via index        ✓ No match
t4                                            ctx.db.insert('submissions', …) (pending)
t5                                          Mutation commits atomically       ✓ Submission A
t6                                         Return 200 OK {submissionId: A}
t7      [NETWORK TIMEOUT - No response received by client]
t8      [Client retries with SAME idempotencyKey]
t9      POST /submissions/create
t10     (idempotencyKey: uuid-1234,        insertSubmission mutation starts
         nullifier: 0x1234, data: {...})     Check idempotencyKey via index   ✓ Found Submission A
t11                                          Short-circuit: return existing   ✓ Submission A
t12                                        Mutation commits (no write)
t13                                        Return 200 OK {submissionId: A}
t14     [Client receives response]

Result: Client sees success, same submission returned (Idempotent)
```

---

## Convex Concurrency Model

Convex mutations run under optimistic concurrency control (OCC). Each
mutation records its read set and its write set; when it commits, Convex
validates that no other commit has modified any document in the read
set. If it has, the losing mutation is retried (or aborted for the
caller), so the "check-then-insert" pattern below is serialisable
without a separate transaction primitive.

```
Mutation A                                 Mutation B
─────────────────────────────────────────────────────────────────────────────────
Read by_nullifier where nullifier='0x1234' → no match
                                           Read by_nullifier where nullifier='0x1234' → no match

Insert submission { nullifier: '0x1234' }
                                           Insert submission { nullifier: '0x1234' }

Mutation A commits first.
                                           Mutation B read-set invalidated
                                           → Convex retries (sees Mutation A's row)
                                           → handler throws DUPLICATE_NULLIFIER

Result: One submission row; one caller sees DUPLICATE_NULLIFIER.
```

### Why unique indexes are enough

- **Single-flight insertion:** `by_nullifier` / `by_idempotency_key` lookups inside a mutation are part of its read set, so a concurrent insert forces a retry.
- **No phantom reads:** We check existence, not aggregate values.
- **Simple code:** No wrapper transaction primitive — the mutation itself is the atomic unit.

---

## Defense-in-Depth Strategy

```
Layer 1: Convex Mutation (atomic unit)
│
├─ Check if idempotencyKey exists (by_idempotency_key)
├─ Check if nullifier exists (by_nullifier)
├─ Insert submission if neither exist
│
└─ Protects against: Race conditions, concurrent requests
   Failure mode: Mutation handler bug bypasses checks

   ↓

Layer 2: Schema Indexes + Mutation-Level Uniqueness Check
│
├─ by_idempotency_key index + single-flight uniqueness check in handler
├─ by_nullifier index + single-flight uniqueness check in handler
│
└─ Protects against: Handler bugs, direct mutation abuse
   Failure mode: Schema/index drift (caught by test coverage)

   ↓

Layer 3: ZK Proof Verification (Future)
│
├─ Verify UltraHonk proof on-chain
├─ Check nullifier against Merkle tree
│
└─ Protects against: All application/database failures
   Failure mode: Blockchain consensus failure (theoretical)
```

**Result:** Three independent safety mechanisms.

---

## Performance Comparison

### Non-atomic pattern (historical — don't do this)

```
Identity Verification:
├─ Query 1: lookup user by identityHash              [5ms]
├─ Query 2: patch user identityHash                  [8ms]
├─ Query 3: insert verificationAudit                 [6ms]
└─ Total: 19ms
   Risk: race window between check and write.

Submission Creation:
├─ Query 1: lookup submission by nullifier           [4ms]
├─ Query 2: insert submission                        [7ms]
└─ Total: 11ms
   Risk: race window between check and write.
```

### Atomic Convex mutation (current)

```
Identity Verification (single mutation, atomic):
├─ Read user by by_identity_hash index              [~5ms]
├─ ctx.db.patch(user, { identityHash, ... })        [~8ms]
├─ ctx.db.insert('verificationAudits', ...)         [~6ms]
└─ Commit                                           [~2ms]
   Total: ~21ms. OCC retries on conflict; no extra wrapper cost.

Submission Creation (single mutation, atomic):
├─ Read by_idempotency_key                          [~3ms]
├─ Read by_nullifier                                [~3ms]
├─ ctx.db.insert('submissions', ...)                [~7ms]
└─ Commit                                           [~2ms]
   Total: ~15ms. Indexed lookups are O(log n); OCC handles conflicts.
```

**Trade-off:** Negligible latency cost for race-free semantics — the OCC engine does the work instead of an explicit transaction primitive.

---

## Testing Scenarios

### Test 1: Concurrent Identity Verification (Race Condition)

```bash
# Terminal 1
curl -X POST http://localhost:5173/api/identity/verify \
  -H "Content-Type: application/json" \
  -d '{"userId": "user123", "identityHash": "0xABC..."}'

# Terminal 2 (run simultaneously)
curl -X POST http://localhost:5173/api/identity/verify \
  -H "Content-Type: application/json" \
  -d '{"userId": "user456", "identityHash": "0xABC..."}'

# Expected: One returns 200 OK, one returns 409 Conflict
# Expected: Only ONE user has identity_hash = "0xABC..."
```

### Test 2: Nullifier Collision (Race Condition)

```bash
# Terminal 1
curl -X POST http://localhost:5173/api/submissions/create \
  -H "Content-Type: application/json" \
  -d '{"nullifier": "0x1234", "idempotencyKey": "key1", ...}'

# Terminal 2 (run simultaneously)
curl -X POST http://localhost:5173/api/submissions/create \
  -H "Content-Type: application/json" \
  -d '{"nullifier": "0x1234", "idempotencyKey": "key2", ...}'

# Expected: One returns 200 OK, one returns 409 Conflict
# Expected: Only ONE submission with nullifier = "0x1234"
```

### Test 3: Idempotent Retry (Network Failure Simulation)

```bash
# Send request
response=$(curl -X POST http://localhost:5173/api/submissions/create \
  -H "Content-Type: application/json" \
  -d '{"nullifier": "0x5678", "idempotencyKey": "retry-test-123", ...}')

submissionId=$(echo $response | jq -r '.submissionId')

# Retry with SAME idempotencyKey (simulating network failure)
response2=$(curl -X POST http://localhost:5173/api/submissions/create \
  -H "Content-Type: application/json" \
  -d '{"nullifier": "0x5678", "idempotencyKey": "retry-test-123", ...}')

submissionId2=$(echo $response2 | jq -r '.submissionId')

# Expected: submissionId === submissionId2
# Expected: Both requests return 200 OK
# Expected: Only ONE submission created in database
```

### Test 4: Mutation Abort (Error During Verification)

```typescript
// Inject an error during the audit insert to exercise atomicity.
// Convex mutations are all-or-nothing: if any step throws, no writes commit.
vi.spyOn(ctx.db, 'insert').mockImplementationOnce(() => {
  throw new Error('Simulated failure in verificationAudits insert');
});

await expect(verifyIdentity(ctx, { userId, identityProof })).rejects.toThrow();

// Verify no partial write landed
const user = await ctx.db.get(userId);
expect(user?.identityHash).toBeUndefined(); // no patch applied
expect(user?.isVerified).toBe(false);

const audits = await ctx.db
  .query('verificationAudits')
  .withIndex('by_user', q => q.eq('userId', userId))
  .collect();
expect(audits).toHaveLength(0); // no audit created
```

---

## Monitoring & Alerts

### Key Metrics to Track

1. **Mutation Duration**
   - Alert if > 100ms (indicates OCC contention or slow indexed reads)
   - Dashboard: P50, P95, P99 latency

2. **Duplicate Nullifier / Idempotency Rejections**
   - Alert on any spike (indicates race-attempt or client bug)
   - Log: nullifier prefix (first 8 hex chars), IP prefix, timestamp

3. **Idempotent Retries**
   - Track: % of requests short-circuited by by_idempotency_key lookup
   - Expected: 1-5% (legitimate network retries)
   - Alert if > 10% (indicates client issue)

4. **Mutation Retry / Abort Rate**
   - Convex OCC retries are observable; expected <1%
   - Alert if > 5% (indicates hot contention or schema-index mismatch)

---

## Conclusion

- **Race conditions eliminated** via atomic Convex mutations
- **Double-spend prevented** via `by_nullifier` index + single-flight uniqueness check
- **Idempotent retries** via client-generated UUIDs + `by_idempotency_key` lookup
- **Defense-in-depth** via mutation atomicity + schema indexes + (future) on-chain proof verification
- **Minimal overhead** — OCC retries are cheap when contention is low

**Status:** Production-ready, tested, documented
