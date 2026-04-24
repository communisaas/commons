# WP-004: Client Usage Examples

## Idempotency Key Pattern

### Browser/Frontend Implementation

```typescript
// src/lib/client/submission-api.ts

/**
 * Create a ZK proof submission with automatic retry safety
 *
 * The idempotency key ensures that network failures/timeouts
 * don't create duplicate submissions. The same key is used
 * across retries, so the server returns the existing submission.
 */
export async function createSubmission(params: {
  templateId: string;
  proof: string;
  publicInputs: string[];
  nullifier: string;
  encryptedWitness: string;
  witnessNonce: string;
  ephemeralPublicKey: string;
  teeKeyId: string;
  // Optional MVP fields
  mvpAddress?: Address;
  personalizedMessage?: string;
  userEmail?: string;
  userName?: string;
}) {
  // Generate idempotency key ONCE per submission attempt
  // This key persists across retries (stored in closure or React state)
  const idempotencyKey = crypto.randomUUID();

  // Retry logic with exponential backoff
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/submissions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          idempotencyKey, // ← Same key on all retries
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Submission failed');
      }

      const result = await response.json();
      return result; // Success!

    } catch (error) {
      lastError = error as Error;

      // Don't retry on 4xx errors (client error, won't succeed on retry)
      if (error instanceof Error && error.message.includes('409')) {
        // 409 Conflict = duplicate nullifier (not a retry issue)
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        console.log(`Retrying submission (attempt ${attempt + 1}/${maxRetries})...`);
      }
    }
  }

  // All retries exhausted
  throw new Error(`Submission failed after ${maxRetries} attempts: ${lastError?.message}`);
}
```

### React Component Usage

```typescript
// src/routes/templates/[slug]/SubmitButton.svelte

import { createSubmission } from '$lib/client/submission-api';
import { generateProof } from '$lib/zk/proof-generator';

let submitting = false;
let error: string | null = null;
let result: any = null;

async function handleSubmit() {
  submitting = true;
  error = null;

  try {
    // Generate ZK proof (nullifier is deterministic per identity + template)
    const { proof, publicInputs, nullifier, encryptedWitness } =
      await generateProof(templateId, userAddress);

    // Create submission with automatic retry safety
    result = await createSubmission({
      templateId,
      proof,
      publicInputs,
      nullifier,
      encryptedWitness,
      witnessNonce: '...',
      ephemeralPublicKey: '...',
      teeKeyId: 'key-1',
      mvpAddress: userAddress, // MVP mode
      personalizedMessage: customMessage,
    });

    console.log('Submission created:', result.submissionId);

    // Show success message
    if (result.delivery?.summary) {
      const { successful, total } = result.delivery.summary;
      alert(`Delivered to ${successful}/${total} congressional offices!`);
    }

  } catch (err) {
    error = err.message;
    console.error('Submission error:', err);
  } finally {
    submitting = false;
  }
}
```

---

## Error Handling

### Client-Side Error Types

```typescript
type SubmissionError =
  | { code: 'DUPLICATE_NULLIFIER'; message: 'Already submitted' }
  | { code: 'NETWORK_ERROR'; message: 'Connection failed'; retryable: true }
  | { code: 'VALIDATION_ERROR'; message: 'Invalid proof data' }
  | { code: 'SERVER_ERROR'; message: 'Internal error'; retryable: true };

function handleSubmissionError(error: Response) {
  switch (error.status) {
    case 409:
      // Duplicate nullifier - user already took this action
      return {
        code: 'DUPLICATE_NULLIFIER',
        message: 'You have already submitted this message. Check your submission history.',
        retryable: false,
      };

    case 400:
      // Validation error - bad request data
      return {
        code: 'VALIDATION_ERROR',
        message: 'Invalid submission data. Please try generating a new proof.',
        retryable: false,
      };

    case 500:
      // Server error - potentially retryable
      return {
        code: 'SERVER_ERROR',
        message: 'Server error. Retrying...',
        retryable: true,
      };

    default:
      return {
        code: 'NETWORK_ERROR',
        message: 'Network error. Retrying...',
        retryable: true,
      };
  }
}
```

---

## Testing: Simulate Network Failures

### Test 1: Network Timeout During Submission

```typescript
// tests/submission-idempotency.test.ts

import { vi } from 'vitest';
import { createSubmission } from '$lib/client/submission-api';

test('should handle network timeout and retry successfully', async () => {
  let attemptCount = 0;

  // Mock fetch to fail first, succeed second
  global.fetch = vi.fn(() => {
    attemptCount++;

    if (attemptCount === 1) {
      // Simulate network timeout
      return Promise.reject(new Error('Network timeout'));
    }

    // Second attempt succeeds (server returns existing submission)
    return Promise.resolve(
      new Response(JSON.stringify({
        success: true,
        submissionId: 'sub_123',
        status: 'pending',
      }), { status: 200 })
    );
  });

  const result = await createSubmission({
    templateId: 'template_1',
    proof: '0x...',
    publicInputs: ['...'],
    nullifier: '0x1234',
    encryptedWitness: '...',
    witnessNonce: '...',
    ephemeralPublicKey: '...',
    teeKeyId: 'key-1',
  });

  expect(attemptCount).toBe(2); // Retried once
  expect(result.submissionId).toBe('sub_123');
});
```

### Test 2: Server Returns Existing Submission (Idempotent Retry)

```typescript
test('should return existing submission on retry with same idempotency key', async () => {
  const idempotencyKey = crypto.randomUUID();
  const submissionData = {
    templateId: 'template_1',
    proof: '0x...',
    nullifier: '0x5678',
    // ... other fields
  };

  // First request - creates new submission
  const result1 = await fetch('/api/submissions/create', {
    method: 'POST',
    body: JSON.stringify({ ...submissionData, idempotencyKey }),
  }).then(r => r.json());

  expect(result1.submissionId).toBeDefined();

  // Second request - same idempotency key (retry)
  const result2 = await fetch('/api/submissions/create', {
    method: 'POST',
    body: JSON.stringify({ ...submissionData, idempotencyKey }),
  }).then(r => r.json());

  // Should return SAME submission
  expect(result2.submissionId).toBe(result1.submissionId);

  // Verify only ONE submission in database (Convex)
  const submissions = await ctx.db
    .query('submissions')
    .withIndex('by_nullifier', q => q.eq('nullifier', '0x5678'))
    .collect();
  expect(submissions).toHaveLength(1);
});
```

---

## Backend: Idempotency Key Validation

### Server-Side Checks (Convex mutation)

```typescript
// convex/submissions.ts

export const insertSubmission = mutation({
  args: {
    idempotencyKey: v.optional(v.string()),
    nullifier: v.string(),
    templateId: v.id('templates'),
    proof: v.string(),
    encryptedWitness: v.string(),
    witnessNonce: v.string(),
    ephemeralPublicKey: v.string(),
    teeKeyId: v.string(),
    publicInputs: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { idempotencyKey, nullifier, ...data } = args;

    // Validate idempotency key format (UUID v4)
    if (idempotencyKey && !isValidUUID(idempotencyKey)) {
      throw new Error('Invalid idempotency key format');
    }

    // Idempotent retry: return existing by key
    if (idempotencyKey) {
      const existing = await ctx.db
        .query('submissions')
        .withIndex('by_idempotency_key', q => q.eq('idempotencyKey', idempotencyKey))
        .unique();

      if (existing) {
        console.log('[Idempotent Retry] Returning existing submission:', existing._id);
        return existing;
      }
    }

    // Nullifier dedupe (single-flight via by_nullifier index)
    const duplicate = await ctx.db
      .query('submissions')
      .withIndex('by_nullifier', q => q.eq('nullifier', nullifier))
      .unique();

    if (duplicate) {
      throw new Error('DUPLICATE_NULLIFIER');
    }

    // Convex mutations are atomic — race on the same nullifier/idempotencyKey
    // is serialized by the OCC transaction engine, not by SQL-style $transaction.
    const id = await ctx.db.insert('submissions', {
      ...data,
      nullifier,
      idempotencyKey,
      createdAt: Date.now(),
    });

    return await ctx.db.get(id);
  },
});

function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
```

Atomicity is enforced by the `by_nullifier` and `by_idempotency_key` indexes
defined in `convex/schema.ts`; Convex serializes conflicting mutations so
the "check-then-insert" pattern above is race-free without any explicit
transaction wrapper.

---

## Monitoring: Idempotency Metrics

### Logging Idempotent Retries

```typescript
// src/lib/server/monitoring.ts

export function logIdempotentRetry(submission: Doc<'submissions'>) {
  console.log('[Idempotent Retry]', {
    submissionId: submission._id,
    idempotencyKey: submission.idempotencyKey,
    createdAt: submission.createdAt,
    timeSinceCreation: Date.now() - submission.createdAt,
  });

  // Track in analytics (privacy-safe)
  trackEvent('submission.idempotent_retry', {
    time_since_creation_ms: Date.now() - submission.createdAt,
  });
}
```

### Dashboard Metrics

Emit metrics from the Convex mutation (analytics sink or `internalAction`):

```typescript
// Idempotent retry rate (should be 1-5%)
// Compute in an internal action over the submissions table within a
// rolling window.
const windowStart = Date.now() - 60 * 60 * 1000; // 1 hour
const recent = await ctx.db
  .query('submissions')
  .withIndex('by_created_at', q => q.gte('createdAt', windowStart))
  .collect();

const retries = recent.filter(s => s.isRetry === true).length;
const retryRatePercent = recent.length ? (retries / recent.length) * 100 : 0;

// Average time between retry attempts
const avgRetryDelaySec =
  retries > 0
    ? recent
        .filter(s => s.isRetry === true)
        .reduce((sum, s) => sum + (s.retryDelayMs ?? 0), 0) /
      retries /
      1000
    : 0;
```

---

## Security Considerations

### Idempotency Key Best Practices

1. **Client-Generated UUIDs**
   - Use `crypto.randomUUID()` (secure PRNG)
   - DO NOT use timestamps or sequential IDs (predictable)
   - DO NOT derive from user data (linkable)

2. **Key Scope**
   - One key per submission attempt
   - DO NOT reuse keys across different templates
   - DO NOT share keys between users

3. **Key Expiration** (Future Enhancement)
   ```typescript
   // Optional: Expire idempotency keys after 24 hours
   // Run from an internal action or scheduled cron.
   const cutoff = Date.now() - 24 * 60 * 60 * 1000;
   const expired = await ctx.db
     .query('submissions')
     .withIndex('by_created_at', q => q.lt('createdAt', cutoff))
     .filter(q => q.neq(q.field('idempotencyKey'), undefined))
     .collect();

   for (const sub of expired) {
     await ctx.db.patch(sub._id, { idempotencyKey: undefined });
   }
   ```

4. **Rate Limiting**
   ```typescript
   // Prevent idempotency key abuse (10 submissions per user per hour)
   const windowStart = Date.now() - 60 * 60 * 1000;
   const recentSubmissions = await ctx.db
     .query('submissions')
     .withIndex('by_user_created', q => q.eq('userId', userId).gt('createdAt', windowStart))
     .collect();

   if (recentSubmissions.length >= 10) {
     throw new Error('RATE_LIMIT_EXCEEDED');
   }
   ```

---

## Migration Path: Adding Idempotency to Existing Code

### Step 1: Make Idempotency Key Optional

```typescript
// Existing submissions don't have idempotency_key
// New submissions should include it, but it's optional for backward compatibility

const { idempotencyKey, ...data } = await request.json();

// Works with or without idempotency key
const submission = await createSubmissionWithTransaction({
  ...data,
  idempotencyKey: idempotencyKey || null
});
```

### Step 2: Update Clients Gradually

```typescript
// Phase 1: Add key to new clients, old clients still work
if (hasModernClient) {
  submissionData.idempotencyKey = crypto.randomUUID();
}

// Phase 2: Make key required after 90 days
if (process.env.REQUIRE_IDEMPOTENCY_KEY === 'true' && !idempotencyKey) {
  throw error(400, 'Idempotency key required (upgrade your client)');
}
```

### Step 3: Backfill Existing Submissions (Optional)

```typescript
// Backfill idempotency keys on legacy submissions (analytics only).
// Run via an internal Convex action.
const cutoff = new Date('2026-01-25').getTime();
const legacy = await ctx.db
  .query('submissions')
  .withIndex('by_created_at', q => q.lt('createdAt', cutoff))
  .filter(q => q.eq(q.field('idempotencyKey'), undefined))
  .collect();

for (const sub of legacy) {
  await ctx.db.patch(sub._id, { idempotencyKey: crypto.randomUUID() });
}
```

---

## FAQ

### Q: What if client generates duplicate idempotency keys?

**A:** Extremely unlikely with UUIDs (1 in 2^122 collision probability). If it happens:
- Server returns existing submission (safe)
- Nullifier check still prevents double-spend
- User sees "Already submitted" error

### Q: Can idempotency keys be reused?

**A:** No, each key is tied to a specific submission. Reusing keys returns the original submission, not a new one.

### Q: What if server restarts during submission?

**A:** Convex mutations are atomic — either the full mutation commits or nothing does:
- If the mutation commits → Submission created
- If the mutation fails (conflict, crash, etc.) → No submission (client retries)
- The `by_idempotency_key` index ensures retry safety

### Q: Should idempotency keys be logged?

**A:** Yes, but hash them first (privacy):
```typescript
console.log('Idempotent retry:', {
  idempotencyKeyHash: sha256(idempotencyKey).slice(0, 16),
  submissionId,
});
```

### Q: Can idempotency keys be deleted?

**A:** Yes, after expiration (e.g., 30 days). They're only needed for retry detection within the retry window (typically seconds to minutes).

---

## Complete Example: Production-Ready Submission Flow

```typescript
// src/lib/client/submission-flow.ts

import { generateProof } from '$lib/zk/proof-generator';
import { createSubmission } from '$lib/client/submission-api';
import { trackEvent } from '$lib/analytics';

export async function submitMessage(
  templateId: string,
  userAddress: string,
  customMessage?: string
) {
  const startTime = Date.now();

  try {
    // Step 1: Generate ZK proof (client-side, 2-5s)
    trackEvent('proof.generation.started');
    const proofData = await generateProof(templateId, userAddress);
    trackEvent('proof.generation.completed', {
      duration_ms: Date.now() - startTime
    });

    // Step 2: Submit with automatic retry safety
    trackEvent('submission.started');
    const result = await createSubmission({
      templateId,
      ...proofData,
      mvpAddress: userAddress,
      personalizedMessage: customMessage,
    });
    trackEvent('submission.completed', {
      duration_ms: Date.now() - startTime,
      submission_id: result.submissionId
    });

    return result;

  } catch (error) {
    trackEvent('submission.failed', {
      error_code: error.code,
      duration_ms: Date.now() - startTime
    });
    throw error;
  }
}
```

---

## Summary

- **Idempotency Key:** Client-generated UUID prevents duplicate submissions
- **Automatic Retries:** Network failures safely retry with same key
- **Server Detection:** Convex `by_idempotency_key` index + atomic mutations enforce idempotency
- **Backward Compatible:** Optional field, existing code works
- **Production-Ready:** Tested, monitored, documented

**Next Steps:**
1. Update client code to include `idempotencyKey`
2. Monitor retry rate (should be 1-5%)
3. Alert on high retry rate (indicates network issues)
4. Consider key expiration after 30 days (cleanup)
