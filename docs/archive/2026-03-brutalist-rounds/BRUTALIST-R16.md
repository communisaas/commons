# Brutalist Assessment Round 16 — Legislation, SMS, Templates, Workflows, Wallet

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Claude (6-agent roast, 10 findings), validated by direct code reads
> **Prior rounds**: R1-R15 (127+ findings addressed)

## Methodology

Targeted last unaudited verticals: bills/legislation, SMS/Twilio, segments, templates, workflows, wallet, identity. Cross-validated all findings. Key themes: **template API PII leakage** (separate endpoint from R14 fix), **workflow logic bypass** (different from R14 infinite loop), **SMS input validation gaps**.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| R16-05: SMS recipientFilter not applied during send | ACCEPTED — Known gap documented in MEMORY.md. TODO comment in code. Segment query builder needs phone filtering support first. |
| R16-06: SMS blast creation no rate limiting | ACCEPTED — Requires editor role + starter plan. Creates draft only (send is separate action). Sufficient gating for draft creation. |
| R16-07: Wallet nonce deleted before user-scope check | REJECTED — Intentional design. Comment says "nonce is single-use regardless of outcome". Consuming the nonce before checking userId is MORE secure: prevents attacker from retrying with correct userId if they know the nonce. |
| R16-08: process.env in identity-binding | ACCEPTED — Fail-closed (throws if undefined). handlePlatformEnv shim populates process.env. Function validates salt exists before proceeding. |
| R16-09: Segment campaign filter not org-scoped | ACCEPTED — Outer query scopes supporters to orgId. Cross-org campaignId in filter returns empty results (no supporters have actions on other orgs' campaigns). Minimal theoretical info leak. |
| Bill search not org-scoped | REJECTED — Bills are public legislative records. Intentional design. |
| Segment query builder SQL injection | REJECTED — Queries run through the Convex typed query API; validateSegmentFilter whitelists fields/operators. |

---

## Validated Findings

### P0 — Critical (1)

#### F-R16-01: Public template API leaks recipient emails (unauthenticated)

**File**: `src/routes/api/templates/+server.ts:176,353-363`
**What**: The `GET /api/templates` endpoint (line 176) requires NO authentication. It returns all public templates with `recipientEmails` extracted from `recipient_config` (lines 353-363). R14-05 fixed the template PAGE (`s/[slug]/+layout.server.ts`), but this separate API endpoint was missed.
**Impact**: Any unauthenticated caller harvests decision-maker email addresses from all public templates.

**Solution**: Strip recipient emails from the API response:
```ts
recipientEmails: [], // Never expose on public API
```
Also strip `recipient_config` from the response (line 341 area if present).

**Pitfall**: Check if any client code depends on `recipientEmails` from this endpoint for the mailto flow. If so, fetch via authenticated endpoint.

---

### P1 — High (3)

#### F-R16-02: User templates endpoint returns all fields unfiltered

**File**: `src/routes/api/user/templates/+server.ts:11-20`
**What**: `findMany` with no `select` clause returns every column: `recipient_config` (with emails), `delivery_config`, `cwc_config`, `content_hash`, `consensus_approved`, `verification_status`, `reviewed_by`, embedding metadata. While scoped to own user, this leaks internal moderation state back to client.
**Impact**: Over-projection exposes internal fields + recipient PII in client-side data.

**Solution**: Add explicit select:
```ts
const userTemplates = await db.template.findMany({
    where: { userId: locals.user.id },
    orderBy: { updatedAt: 'desc' },
    select: {
        id: true, slug: true, title: true, description: true, body: true,
        category: true, status: true, is_public: true,
        createdAt: true, updatedAt: true
    }
});
```

---

#### F-R16-03: Workflow condition step index not bounds-checked — silent skip

**File**: `src/lib/server/automation/executor.ts:75-77`
**What**: R14-01 added `MAX_ITERATIONS=200` to prevent infinite loops. But a DIFFERENT issue: if condition returns `nextStep >= steps.length`, the while loop at line 36 (`while (currentStep < steps.length)`) exits immediately. Workflow completes "successfully" while skipping all remaining steps.
**Impact**: Editor creates condition with `thenStepIndex: 999`. When condition is true, remaining steps (emails, tag operations) silently skipped. Workflow reports success.

**Solution**: Bounds-check nextStep in executor:
```ts
if (result.nextStep !== undefined) {
    if (result.nextStep < 0 || result.nextStep >= steps.length) {
        await db.workflowExecution.update({
            where: { id: executionId },
            data: { status: 'failed', error: `Condition step index ${result.nextStep} out of bounds (0-${steps.length - 1})` }
        });
        return;
    }
    currentStep = result.nextStep;
}
```

Also add `max(steps.length - 1)` to the Zod schema validation in workflows POST/PATCH.

**Pitfall**: Can't add `.max()` at schema level since step count isn't known at validation time. Runtime bounds check in executor is the right approach.

---

#### F-R16-04: SMS fromNumber not E.164-validated

**File**: `src/routes/api/org/[slug]/sms/+server.ts:64`
**What**: `fromNumber: fromNumber || null` stored without any validation. R5 added E.164 validation on `to` numbers in twilio.ts but not on `from`.
**Impact**: Invalid from numbers stored, rejected by Twilio at send time. Attacker can probe which numbers are verified on the Twilio account.

**Solution**: Validate fromNumber if provided:
```ts
if (fromNumber) {
    const e164 = /^\+[1-9]\d{1,14}$/;
    if (!e164.test(fromNumber)) throw error(400, 'fromNumber must be in E.164 format (e.g., +15551234567)');
}
```

---

## Task Graph

### Cycle 1: P0 + P1 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R16-01: Strip recipient emails from template API | F-R16-01 | `api/templates/+server.ts` | security-eng |
| T-R16-02: Add select clause to user templates | F-R16-02 | `api/user/templates/+server.ts` | security-eng |
| T-R16-03: Executor step index bounds check | F-R16-03 | `executor.ts` | automation-eng |
| T-R16-04: SMS fromNumber E.164 validation | F-R16-04 | `api/org/[slug]/sms/+server.ts` | api-eng |

**Review Gate G-R16-01**: Verify template API emails stripped, user templates projected, executor bounds-checked, fromNumber validated.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R16-01 | DONE | security-eng | recipientEmails: [] on public API |
| T-R16-02 | DONE | security-eng | Explicit select with 11 safe fields |
| T-R16-03 | DONE | automation-eng | Bounds check [0, steps.length) with fail |
| T-R16-04 | DONE | api-eng | E.164 regex on fromNumber |
| G-R16-01 | PASSED | team-lead | All 4 fixes verified |
