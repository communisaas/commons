# Brutalist Assessment Round 14 — Automation, Email, Networks, Embeds

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Claude (5-agent, 31 findings) + Gemini (5 findings), validated by direct code reads
> **Prior rounds**: R1-R13 (100+ findings addressed)

## Methodology

Full roast targeting verticals not saturated by R3-R13: automation workflows, email/campaign delivery, network membership, embed routes, geographic resolver. Cross-validated every finding against actual code. Key themes: **executor safety** (no circuit breaker), **cross-org data leakage** (SES event correlation), **PII exposure** (template pages still leaking recipient emails after R10 campaign fix).

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| R14-01: District code client-supplied in verify-address | ACCEPTED — Known architectural trade-off. Client calls Civic API, server receives result. `verification_method` field tracks provenance. Server-side Civic API call would require API key exposure to server. |
| R14-02: Phantom DM creation from client officials | ACCEPTED — Create path needed for new legislators not yet in congress-gov sync. Low risk: phantom DMs unused unless org follows them. Sync is authoritative source. |
| R14-09: Network ops no org-level requireRole | ACCEPTED — Network admin role is the authorization gate, not org role. `loadOrgContext` confirms user belongs to org. Network admin is an org-level delegation. |
| R14-15: Member removal ID mismatch claim | REJECTED — API uses `params.orgId` in compound key `networkId_orgId`. Client sends orgId, not row ID. API is correct. |
| R14-19: hashDistrict unsalted SHA-256 | ACCEPTED — Documented limitation. ~435 possible values. DB access required for exploitation. Salting deferred to Phase 4 with Poseidon2 migration. |
| R14-21: Embed postMessage wildcard `'*'` | ACCEPTED — Only sends public campaign data (title, action count). No PII in message payload. |
| R14-24: process.env district hash salt fallback | ACCEPTED — `handlePlatformEnv` shim copies to process.env on first request. Hardcoded fallback only used if env var missing (dev). |
| R14-25/26/27: Length limits, workflow count | ACCEPTED — Scalability concerns, not security. P3 backlog. |
| Gemini V-01: Campaign action district spoofing | ACCEPTED — `engagementTier` on campaign actions ≠ identity `trust_tier`. Verification packets distinguish verified constituents (trust_tier ≥ 2) from unverified actions. Separate concepts. |
| Gemini V-03: Unauthenticated workflow triggering | ACCEPTED — By design. Campaign actions trigger automations. Rate limiting (10 req/min per IP) on embed routes. |
| Gemini V-04: Supporter metadata hijacking (null fields) | ACCEPTED — Intentional UX: enriching supporter records with name/postalCode when originally imported without them. Only null fields updated, never overwrites existing data. |

---

## Validated Findings

### P0 — Critical (2 security + 1 functional)

#### F-R14-01: Automation executor infinite loop — no circuit breaker

**File**: `src/lib/server/automation/executor.ts:33,63-65`
**What**: Condition steps return `result.nextStep` which is set from user-defined `thenStepIndex`/`elseStepIndex`. If a condition points backward (e.g., step 3 → step 0), the `while (currentStep < steps.length)` loop runs forever. No max iteration counter, no timeout, no backward-jump guard.
**Impact**: Worker hangs indefinitely. Single malicious/misconfigured workflow = denial of service for all scheduled automations.

**Solution**: Add max iteration guard and optional backward-jump prevention:
```ts
const MAX_ITERATIONS = 200; // No real workflow needs 200+ steps
let iterations = 0;
while (currentStep < steps.length) {
    if (++iterations > MAX_ITERATIONS) {
        await db.workflowExecution.update({
            where: { id: executionId },
            data: { status: 'failed', error: 'Max iterations exceeded (possible infinite loop)' }
        });
        return;
    }
    // ... existing step processing
}
```

**Pitfall**: Don't set MAX_ITERATIONS too low — legitimate workflows with many steps + conditions could hit the limit. 200 is generous (most workflows are <20 steps).

---

#### F-R14-02: Scheduler sets status to 'running' before executor — delay steps never resume

**File**: `src/lib/server/automation/scheduler.ts:32-34`
**What**: Scheduler line 34 sets `status: 'running'` before calling `executeWorkflow()`. The executor's atomic guard (line 17) checks `status: { in: ['pending', 'paused'] }`. Since scheduler already set it to 'running', the guard always fails → `count === 0` → returns immediately. **Every delay step silently fails to resume.**
**Impact**: Automation delay feature is completely broken. No delay step ever completes.

**Solution**: Remove the status set from scheduler — let executor handle it atomically:
```ts
// scheduler.ts — just clear nextRunAt, don't touch status
await db.workflowExecution.update({
    where: { id: execution.id },
    data: { nextRunAt: null }  // Remove: status: 'running'
});
await executeWorkflow(execution.id);
```

**Pitfall**: Without the scheduler setting 'running', there's a brief window where another scheduler invocation could pick up the same execution. But `executeWorkflow` already handles this with `updateMany` + `count === 0` guard. The executor's atomic transition IS the concurrency protection.

---

#### F-R14-03: Embed routes blocked by global CSP frame-ancestors: 'none' + COEP

**Files**: `svelte.config.js:43`, `src/hooks.server.ts:217`
**What**: CSP sets `frame-ancestors: ['none']` globally — ALL pages reject framing. COEP sets `require-corp` globally — embedded pages can't load cross-origin resources. `/embed/*` routes exist but can never be framed by any site.
**Impact**: Embed feature is non-functional. Not a security vulnerability, but a P0 functional bug.

**Solution**: Exempt `/embed/*` routes from frame-ancestors restriction and COEP:
```ts
// hooks.server.ts — handleSecurityHeaders
const isEmbed = event.url.pathname.startsWith('/embed/');
if (!isEmbed) {
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
}
```
For CSP frame-ancestors, override via response header for embed routes (SvelteKit CSP config doesn't support per-route directives).

**Pitfall**: Don't use `frame-ancestors: *` — restrict to known embedding domains or at minimum validate the embed origin. Consider an allowlist stored per-org.

---

### P1 — High (6)

#### F-R14-04: SES Open/Click events cross-org misattribution

**File**: `src/routes/api/ses-webhook/+server.ts:170-228`
**What**: Open handler (line 174) finds the most recent `emailBlast` globally with `status: 'sent'` — no orgId filter. If two orgs email the same person, the most recent blast gets credit. Click fallback (lines 205-209) is worse: finds ANY sent blast with batches, completely unscoped — not even email matching.
**Impact**: Cross-org analytics corruption. Inflated/deflated open/click metrics. Could affect A/B test winner selection.

**Solution**: Correlate via `sesMessageId` (already stored on CampaignDelivery). For EmailBlast, store `sesMessageId` per batch item and correlate directly:
```ts
// Short-term: scope blast lookup to org via the recipient's supporter record
const supporter = await db.supporter.findFirst({
    where: { email },
    select: { orgId: true }
});
if (supporter) {
    blast = await db.emailBlast.findFirst({
        where: { status: 'sent', orgId: supporter.orgId, batches: { some: {} } },
        orderBy: { sentAt: 'desc' }
    });
}
```

**Pitfall**: A supporter may exist in multiple orgs. The short-term fix still has ambiguity. Long-term: store `sesMessageId` per blast batch item and correlate exactly.

---

#### F-R14-05: Recipient emails exposed on public template pages

**Files**: `src/routes/s/[slug]/+layout.server.ts:107-108`
**What**: `recipient_config` (raw JSON with target emails) and `recipientEmails` (extracted email array) are returned to unauthenticated visitors on the public template page. R10 stripped target emails from campaign pages, but template pages were missed.
**Impact**: Decision-maker email addresses exposed to the public. PII leakage.

**Solution**: Strip email addresses from the public projection:
```ts
// Strip PII from public template page
delivery_config: template.delivery_config,
recipient_config: null, // Never send raw config to public
recipientEmails: [], // Don't expose emails
```

**Pitfall**: Check if `recipientEmails` is used client-side for anything beyond display. If the mailto flow needs them, fetch via an authenticated endpoint instead.

---

#### F-R14-06: OG image endpoint ignores is_public flag

**File**: `src/routes/s/[slug]/og-image/+server.ts:9-18`
**What**: Queries `findUnique({ where: { slug } })` with no `is_public` filter. Private template metadata (title, description, category, action counts) leaked via OG image generation.
**Impact**: Private template metadata exposure.

**Solution**: Add `is_public` check:
```ts
const template = await prisma.template.findFirst({
    where: { slug: params.slug, is_public: true },
    // ...
});
if (!template) return new Response('Not found', { status: 404 });
```

---

#### F-R14-07: V1 API campaign detail leaks target emails

**File**: `src/routes/api/v1/campaigns/[id]/+server.ts:39`
**What**: `targets: campaign.targets` returns raw targets JSON including decision-maker email addresses. The org page (fixed in R11) gates these by role, but the V1 API doesn't.
**Impact**: Any API key with `read` scope gets decision-maker emails.

**Solution**: Strip emails from target objects in V1 response:
```ts
targets: Array.isArray(campaign.targets)
    ? (campaign.targets as any[]).map(t => ({
        name: t.name, title: t.title, district: t.district
    }))
    : campaign.targets,
```

---

#### F-R14-08: Automation cron secret not timing-safe

**File**: `src/routes/api/automation/process/+server.ts:19`
**What**: `if (secret !== expected)` — plain JavaScript equality, not `timingSafeEqual`. R4 swept 10 cron endpoints but missed this one.
**Impact**: Timing side-channel for secret extraction.

**Solution**:
```ts
import { timingSafeEqual } from 'crypto';
const secretBuf = Buffer.from(secret || '');
const expectedBuf = Buffer.from(expected);
if (secretBuf.length !== expectedBuf.length || !timingSafeEqual(secretBuf, expectedBuf)) {
    throw error(401, 'Invalid secret');
}
```

---

#### F-R14-09: Pending orgs can view full network detail

**File**: `src/routes/org/[slug]/networks/[networkId]/+page.server.ts:27-29`
**What**: `if (!currentMembership || currentMembership.status === 'removed')` — only blocks 'removed' status. Pending orgs (status: 'pending', invited but not yet accepted) pass through and see all network data: member orgs, supporter counts per org, proof pressure data.
**Impact**: Data exposure before consent to join. Competitive supporter counts visible.

**Solution**: Require 'active' status:
```ts
if (!currentMembership || currentMembership.status !== 'active') {
    // Pending orgs see only the invitation, not full network data
    if (currentMembership?.status === 'pending') {
        return { network: { id: network.id, name: network.name }, isPending: true, members: [], stats: {} };
    }
    throw error(403, 'Not a member of this network');
}
```

---

### P2 — Medium (3)

#### F-R14-10: Email subject CRLF/length unsanitized

**File**: `src/routes/org/[slug]/emails/compose/+page.server.ts:150`
**What**: Subject passes through with only `.trim()`. No control character stripping, no length limit.

**Solution**: Strip control chars, cap at 998 chars (RFC 2822):
```ts
const sanitizedSubject = subject.trim().replace(/[\r\n\x00-\x1f]/g, '').slice(0, 998);
```

---

#### F-R14-11: Leave endpoint allows leaving from 'removed' status

**File**: `src/routes/api/org/[slug]/networks/[networkId]/leave/+server.ts:34-38`
**What**: Only checks `if (!member)`, not `member.status`. Admin-removed org can call leave → hard-deletes the record, erasing the removal audit trail.

**Solution**: Block leaving from non-active states:
```ts
if (!member || member.status !== 'active') {
    throw error(404, 'Not an active member of this network');
}
```

---

#### F-R14-12: Report fromName passes unsanitized org name to SES

**File**: `src/lib/server/campaigns/report.ts:598`
**What**: `org!.name` used directly as SES display name. Could contain angle brackets or misleading characters.

**Solution**: Sanitize display name:
```ts
const safeName = org!.name.replace(/[<>"'\r\n]/g, '').slice(0, 64);
```

---

## Task Graph

### Cycle 1: P0 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R14-01: Executor circuit breaker | F-R14-01 | `executor.ts` | automation-eng |
| T-R14-02: Scheduler status fix | F-R14-02 | `scheduler.ts` | automation-eng |
| T-R14-03: Embed CSP/COEP exemption | F-R14-03 | `hooks.server.ts`, `svelte.config.js` | platform-eng |

**Review Gate G-R14-01**: Verify executor has max iteration guard, scheduler doesn't pre-set 'running', embed routes allow framing.

### Cycle 2: P1 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R14-04: SES webhook org-scoped correlation | F-R14-04 | `ses-webhook/+server.ts` | email-eng |
| T-R14-05: Strip template page recipient emails | F-R14-05 | `s/[slug]/+layout.server.ts` | security-eng |
| T-R14-06: OG image is_public check | F-R14-06 | `og-image/+server.ts` | security-eng |
| T-R14-07: V1 API strip campaign target emails | F-R14-07 | `v1/campaigns/[id]/+server.ts` | api-eng |
| T-R14-08: Automation cron timingSafeEqual | F-R14-08 | `automation/process/+server.ts` | security-eng |
| T-R14-09: Network page require active status | F-R14-09 | `networks/[networkId]/+page.server.ts` | network-eng |

**Review Gate G-R14-02**: Verify SES correlation scoped, template emails stripped, OG image gated, V1 targets stripped, cron timing-safe, network status checked.

### Cycle 3: P2 (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R14-10: Email subject sanitization | F-R14-10 | `compose/+page.server.ts` | email-eng |
| T-R14-11: Leave endpoint status check | F-R14-11 | `leave/+server.ts` | network-eng |
| T-R14-12: Report fromName sanitization | F-R14-12 | `report.ts` | email-eng |

**Review Gate G-R14-03**: Verify subject sanitized, leave blocked for non-active, fromName sanitized.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R14-01 | DONE | automation-eng | MAX_ITERATIONS=200 circuit breaker |
| T-R14-02 | DONE | automation-eng | Scheduler no longer pre-sets 'running' |
| T-R14-03 | DONE | platform-eng | COEP skip + frame-ancestors override for /embed/* |
| T-R14-04 | DONE | email-eng | Supporter orgId scoping on Open/Click handlers |
| T-R14-05 | DONE | security-eng | recipient_config: null, recipientEmails: [] |
| T-R14-06 | DONE | security-eng | findFirst with is_public: true |
| T-R14-07 | DONE | api-eng | Targets projected to {name,title,district,state,party} |
| T-R14-08 | DONE | security-eng | timingSafeEqual with length check |
| T-R14-09 | DONE | network-eng | Pending orgs get minimal data + isPending flag |
| T-R14-10 | DONE | inline | Subject CRLF stripped + 998 char cap |
| T-R14-11 | DONE | network-eng | Leave requires active status |
| T-R14-12 | DONE | inline | fromName control chars + angle brackets stripped |
| G-R14-01 | PASSED | team-lead | Executor, scheduler, embed all verified |
| G-R14-02 | PASSED | team-lead | SES, template PII, OG, V1, timing, network all verified |
| G-R14-03 | PASSED | team-lead | Subject, leave, fromName all verified |
