# Brutalist Assessment Round 7 — Post-Hardening Full Sweep

> **Status**: COMPLETE — 6 tasks done, 2 review gates passed
> **Date**: 2026-03-19
> **Source**: Gemini critic against `src/`, validated by 2 parallel Explore agents
> **Prior rounds**: R1-R6 (70+ findings addressed)

## Methodology

Full `src/` codebase roast by Gemini critic (Claude hit buffer limit). ~6 raw findings cross-validated against actual code by 2 parallel agents. 2 rejected, 4 validated findings documented below.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| Gemini: handleAuth before handleRateLimit enables DB DoS | INVALID — Auth has early return when no session cookie exists (no DB lookup). Order is intentional: auth populates userId for user-keyed rate limits. |
| Gemini: InMemoryRateLimiter bypass on CF Workers | ACCEPTED — Old limiter only used by LLM cost protection (non-critical). New SlidingWindowRateLimiter in hooks has no bypass. Known gap documented in MEMORY.md; Redis migration planned. |

---

## Validated Findings

### P0 — Critical (1)

#### F-R7-01: Authority level grants Tier 3 from address-derived identity_commitment

**Files**: `src/routes/api/identity/verify-address/+server.ts:234`, `src/lib/core/identity/authority-level.ts:61-63`
**What**: `verify-address` sets `identity_commitment` (line 234) as a SHA-256 hash of `userId + district`. `computeAuthorityLevel()` in `authority-level.ts` checks only `user.identity_commitment` (line 61) to return Level 3 (Identity Verified). This means address verification (Tier 2) creates a synthetic commitment that satisfies the Tier 3 check — a tier escalation bug.
**Impact**: Any user who completes address verification is reported as "Identity Verified" (Level 3) by `computeAuthorityLevel()`, despite never presenting a government ID. Grants access to operations gated on identity verification.

**Solution**: Fix `authority-level.ts` to require both `identity_commitment` AND `trust_tier >= 3`:
```ts
// Level 3: ID card / drivers license (verified identity, not just address)
if (user.identity_commitment && user.trust_tier >= 3) {
    return 3;
}
```
Since `verify-address` only sets `trust_tier = GREATEST(trust_tier, 2)` and mDL sets `trust_tier = 5`, this correctly distinguishes address-verified (Level 2) from identity-verified (Level 3+).

**Pitfall**: Check that Level 4 (passport) also has `trust_tier >= 4` guard. Currently line 52-58 already checks `verification_method` and `document_type`, so it's safe. Also verify no UI or API logic relies on `computeAuthorityLevel()` returning 3 for address-only users.

---

### P1 — High (1)

#### F-R7-02: Identity endpoints lack Zod validation (3 endpoints)

**Files**:
- `src/routes/api/identity/verify-mdl/verify/+server.ts:26-31` — bare `request.json()` + manual string presence checks
- `src/routes/api/identity/store-blob/+server.ts:30-40` — `as StoreRequest` type assertion + manual presence checks
- `src/routes/api/auth/passkey/register/+server.ts:39,92-98` — bare `request.json()` + manual shape checks

**What**: All 3 endpoints accept external JSON input and perform only manual presence/typeof checks. No Zod schema validation, no format enforcement (base64, hex, length bounds), no enum validation.
**Impact**: Malformed input reaches crypto operations (SubtleCrypto, ECDH) and DB writes without schema validation. Silent parsing failures, uncaught crypto exceptions, or DB constraint violations.

**Solution**: Add Zod schemas to each endpoint:

For **verify-mdl/verify**:
```ts
const VerifyMdlSchema = z.object({
    protocol: z.string().min(1),
    data: z.string().min(1),
    nonce: z.string().min(1).max(128)
});
```

For **store-blob**:
```ts
const StoreBlobSchema = z.object({
    blob: z.object({
        ciphertext: z.string().min(1).max(1_000_000),
        nonce: z.string().min(1).max(256),
        publicKey: z.string().min(1).max(256),
        version: z.number().int().optional()
    })
});
```

For **passkey/register** (Step 2 only):
```ts
const PasskeyVerifySchema = z.object({
    response: z.object({
        id: z.string().min(1),
        rawId: z.string().min(1),
        response: z.object({}).passthrough(),
        type: z.literal('public-key'),
        clientExtensionResults: z.object({}).passthrough().optional(),
        authenticatorAttachment: z.string().optional()
    }),
    sessionId: z.string().min(1).max(128)
});
```

**Pitfall**: `verify-mdl/verify` has a dev-fallback path using `_dev-session-store` that parses session data with `JSON.parse` (line 56). This parsed data also needs validation — but since it comes from our own KV store (not user input), it's lower risk. Focus Zod on the request body.

---

### P2 — Medium (2)

#### F-R7-03: Agent trace fire-and-forget without waitUntil

**File**: `src/lib/server/agent-trace.ts:65`
**What**: `traceEvent()` fires un-awaited `db.agentTrace.create({ data }).catch()`. On CF Workers, promises not registered with `waitUntil` may be terminated after response is sent.
**Impact**: Trace rows (operational telemetry, cost tracking, transparency logs) silently lost when isolate is recycled before the write completes.

**Solution**: Accept optional `waitUntil` parameter and register the promise:
```ts
export function traceEvent(
    traceId: string,
    endpoint: string,
    eventType: string,
    payload: Record<string, unknown>,
    opts?: {
        userId?: string | null;
        success?: boolean;
        durationMs?: number;
        costUsd?: number;
        waitUntil?: (promise: Promise<unknown>) => void;
    }
): void {
    if (!isEnabled()) return;
    // ... build data ...
    const writePromise = db.agentTrace.create({ data }).catch(/* existing retry logic */);
    if (opts?.waitUntil) {
        opts.waitUntil(writePromise);
    }
}
```
Update critical call sites (SSE agent endpoints that have access to `event.platform`) to pass `waitUntil`.

**Pitfall**: Not all call sites have access to `platform`. The fallback (no waitUntil) is acceptable — it matches current behavior. Only upgrade call sites that have access to the request event.

---

#### F-R7-04: Account merge function lacks isolated test coverage

**File**: `src/lib/core/identity/identity-binding.ts:224-392`
**What**: `mergeAccountsInTx` handles 10+ models with unique constraints via per-row merge logic inside a `$transaction`. Code is defensive (conflict detection, role ranking, price comparison) but has no isolated unit test. Only tested indirectly via mDL verify integration tests.
**Impact**: Schema changes that add new unique relations could silently break merging. Low probability given the defensive code, but high blast radius.

**Solution**: Add isolated test that:
1. Creates two users with overlapping data (same org membership, same DM relations)
2. Calls `mergeAccountsInTx` directly
3. Asserts: source user's records moved to target, unique conflicts resolved correctly, source user deleted
4. Asserts: transaction atomicity (on failure, nothing changes)

**Pitfall**: Test needs a real database (Prisma $transaction + unique constraints). Use the existing vitest database test setup, not mocks.

---

## Task Graph

### Cycle 1: P0 + P1 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R7-01: Fix authority-level Tier 3 check | F-R7-01 | `authority-level.ts` | security-eng |
| T-R7-02: Zod for verify-mdl/verify | F-R7-02 | `verify-mdl/verify/+server.ts` | security-eng |
| T-R7-03: Zod for store-blob | F-R7-02 | `store-blob/+server.ts` | security-eng |
| T-R7-04: Zod for passkey/register | F-R7-02 | `passkey/register/+server.ts` | security-eng |

**Review Gate G-R7-01**: Verify authority-level requires trust_tier >= 3 for Level 3, all 3 identity endpoints have Zod schemas replacing manual checks.

### Cycle 2: P2 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R7-05: Agent trace waitUntil parameter | F-R7-03 | `agent-trace.ts` | api-eng |
| T-R7-06: Account merge isolated test | F-R7-04 | `identity-binding.test.ts` (new) | api-eng |

**Review Gate G-R7-02**: Verify traceEvent accepts waitUntil, merge test covers conflict resolution + atomicity.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R7-01 | **done** | security-eng | `identity_commitment && (trust_tier ?? 0) >= 3` for Level 3 |
| T-R7-02 | **done** | security-eng | VerifyMdlSchema: protocol, data, nonce (max 128) |
| T-R7-03 | **done** | security-eng | StoreBlobSchema: ciphertext (1MB), nonce/publicKey (256), version |
| T-R7-04 | **done** | security-eng | PasskeyVerifySchema: type literal 'public-key', response passthrough |
| G-R7-01 | **passed** | team-lead | 4/4 checkpoints verified against code |
| T-R7-05 | **done** | api-eng | waitUntil threaded through traceEvent, traceCompletion, traceRequest |
| T-R7-06 | **done** | api-eng | 21 tests: merge conflicts, role ranking, price comparison, atomicity |
| G-R7-02 | **passed** | team-lead | 2/2 checkpoints verified, 21/21 tests pass |
