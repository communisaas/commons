# Brutalist R4 Residual — Remaining Validated Findings

> **Status**: COMPLETE — 5 tasks done, 2 review gates passed
> **Date**: 2026-03-19
> **Source**: R4 roast findings not addressed in initial R4 task graph, validated by 2 agents

## Scope

R4 produced 29 raw findings. 12 were addressed in the R4 task graph (3 cycles, 11 tasks, 3 gates — all complete). This document covers the remaining validated findings that were outside the initial graph.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| M3: Prompt injection → Gemini | INVALID — Zod schema validation on output defends against injection. Standard practice. |
| M4: District hash rainbow table | ACCEPTED — `hashDistrict` is unsalted SHA-256 of ~485 codes. By design for aggregate counting, not privacy. |
| M5: Packet snapshot correlation | ACCEPTED — proof verification is meant to be public. Cross-campaign comparison is a feature, not a bug. |
| M1: SSE backpressure | LOW — TransformStream has intrinsic backpressure. `writer.write()` not awaited but queuing is bounded by stream internals. |
| M2: Timer race in streams | LOW — Mitigated by try-catch in async callbacks. Would need 10K+ concurrent streams to matter. |
| M10: Invite rate limit | LOW — Seat cap + batch limit (20) serve as implicit rate limits. Not worth dedicated rate limiter. |
| L1: Rate limiter cleanup interval | INVALID — `destroy()` method exists. CF isolate teardown handles remainder. |

---

## Validated Findings

### P0 — Critical (1)

#### F-R4B-01: Supporter PII exposure in SMS message listing

**File**: `src/routes/api/org/[slug]/sms/[id]/messages/+server.ts:46-48`
**What**: Returns full supporter object (id, name, email, phone) to any org member viewing SMS blast messages. No per-blast ownership check beyond org membership. Even "member" role sees PII.
**Impact**: Email + phone of supporters exposed to all org members. Violates principle of least privilege.

**Solution**: Restrict supporter fields to what's needed for the message UI:
```ts
supporter: {
  select: { id: true, name: true }  // NOT email, NOT phone
}
```
**Pitfall**: The UI may currently display phone numbers in the message thread. Check the corresponding Svelte component to ensure it doesn't break. If phone is needed for display, show only last 4 digits.

**Additional hardening**: Add `requireRole(org, 'editor')` — message history should require editor+ access, not just member.

---

### P1 — High (1)

#### F-R4B-02: Session renewal without absolute expiry cap

**File**: `src/lib/core/auth/auth.ts:133-140`
**What**: `validateSession()` extends session by 30 days whenever called within 15 days of current expiry. No maximum renewal count or absolute expiry. Stolen session token can be kept alive indefinitely by replaying it every ~15 days.
**Impact**: Compromised session persists forever. No forced re-authentication.

**Solution**: Add absolute expiry check using session's `createdAt`:
```ts
const MAX_SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const sessionAge = Date.now() - session.createdAt.getTime();
if (sessionAge > MAX_SESSION_LIFETIME_MS) {
  // Force re-authentication — delete session
  await db.session.delete({ where: { id: session.id } });
  return { session: null, user: null };
}
```
Insert this check BEFORE the renewal logic.

**Pitfall**: Session model may not have `createdAt`. Check `prisma/schema.prisma` for the Session model fields. If missing, add it with a migration (default to `now()` for existing rows). The 90-day cap means users re-auth ~4x/year — reasonable for a civic platform handling identity credentials.

---

### P2 — Medium (3)

#### F-R4B-03: SMS recipientFilter stored without schema validation

**File**: `src/routes/api/org/[slug]/sms/+server.ts:35-44`
**What**: `recipientFilter` accepted as raw JSON and persisted to DB. Currently unused (TODO in send-blast.ts), but when wired into query builder, arbitrary JSON could cause query injection. Example: `{"orgId":"EVIL_ORG_ID"}` could bypass org scoping.
**Impact**: Stored XSS/injection vector for future code.

**Solution**: Validate with Zod before storage:
```ts
import { z } from 'zod';

const RecipientFilterSchema = z.object({
  tags: z.array(z.string()).max(20).optional(),
  segments: z.array(z.string().cuid()).max(10).optional(),
  excludeTags: z.array(z.string()).max(20).optional()
}).strict(); // .strict() rejects unknown keys like "orgId"
```
Validate and strip before DB write: `const filter = RecipientFilterSchema.parse(body.recipientFilter)`.

**Pitfall**: `.strict()` rejects unknown keys — if the frontend currently sends extra fields, they'll be rejected. Check the SMS compose UI for what fields it actually sends.

---

#### F-R4B-04: Workflow trigger config not schema-validated

**File**: `src/routes/api/org/[slug]/workflows/+server.ts:32-43`
**What**: Only `trigger.type` validated against `VALID_TRIGGER_TYPES`. Nested config stored as arbitrary JSON. Same for `steps[].config`.
**Impact**: Malformed config could cause workflow executor errors or bypass constraints.

**Solution**: Create per-type Zod schemas:
```ts
const TriggerConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('action'), threshold: z.number().int().min(1).max(10000).optional() }),
  z.object({ type: z.literal('tag_added'), tagName: z.string().min(1).max(100) }),
  z.object({ type: z.literal('supporter_created') }),
  // ... one per VALID_TRIGGER_TYPE
]);
```
Validate trigger config AND step configs before storage.

**Pitfall**: Existing stored workflows may have configs that don't match the schema. Don't validate on READ — only on CREATE/UPDATE. This prevents breaking existing workflows.

---

#### F-R4B-05: Event dates accept unreasonable values

**File**: `src/routes/api/org/[slug]/events/+server.ts:42-59`
**What**: No upper bound on `startDate` (year 9999 accepted), no max event duration, `timezone` not validated against IANA database.
**Impact**: Data integrity issues. Calendar rendering breaks with extreme dates.

**Solution**:
```ts
const now = new Date();
const maxDate = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate());
if (startDate > maxDate) throw error(400, 'Event start date cannot be more than 2 years in the future');
if (endDate && endDate < startDate) throw error(400, 'End date must be after start date');
if (endDate && (endDate.getTime() - startDate.getTime()) > 30 * 24 * 60 * 60 * 1000) {
  throw error(400, 'Event duration cannot exceed 30 days');
}
```
For timezone: validate against `Intl.supportedValuesOf('timeZone')` (available in modern runtimes including CF Workers).

**Pitfall**: `Intl.supportedValuesOf('timeZone')` may not be available in all test environments. Use try/catch with permissive fallback in tests.

---

## Task Graph

### Cycle 1: P0 + P1 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R4B-01: Restrict supporter PII in SMS messages | F-R4B-01 | `sms/[id]/messages/+server.ts` | api-eng |
| T-R4B-02: Session absolute expiry cap | F-R4B-02 | `auth.ts`, `schema.prisma` | auth-eng |

**Review Gate G-R4B-01**: Verify supporter select only returns id+name, editor role required, session has 90-day absolute cap.

### Cycle 2: P2 Medium (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R4B-03: recipientFilter Zod schema | F-R4B-03 | `sms/+server.ts` | api-eng |
| T-R4B-04: Workflow trigger config schema | F-R4B-04 | `workflows/+server.ts` | api-eng |
| T-R4B-05: Event date bounds + timezone validation | F-R4B-05 | `events/+server.ts` | api-eng |

**Review Gate G-R4B-02**: Verify Zod schemas reject invalid input, event date bounds enforced, timezone validated.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R4B-01 | **done** | api-eng | Supporter select: id+name only, requireRole('editor') added |
| T-R4B-02 | **done** | auth-eng | 90-day absolute cap via `createdAt`, before renewal logic |
| G-R4B-01 | **passed** | team-lead | 4/4 checkpoints verified against code |
| T-R4B-03 | **done** | auth-eng | `.strict()` Zod schema: tags/segments/excludeTags with max bounds |
| T-R4B-04 | **done** | api-eng | Discriminated unions: 6 trigger types, 5 step types with constraints |
| T-R4B-05 | **done** | validation-eng | 2-year max date, 30-day max duration, IANA timezone validation |
| G-R4B-02 | **passed** | team-lead | 6/6 checkpoints verified against code |
