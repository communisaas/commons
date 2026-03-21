# Brutalist Assessment Round 19 — Server Library Layer

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Claude (MCP roast, 5 parallel audit agents), validated by direct code reads
> **Prior rounds**: R1-R18 (139+ findings addressed)

## Methodology

Targeted `src/lib/server/` shared utilities and the API routes that consume them. Focus on PII in report deliveries, sibling route regressions (org calls vs V1 calls, A/B subjects vs main subject), and internal operational data leakage. Cross-validated 58 raw findings from Claude MCP.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| R19-01: Segment campaignParticipation cross-org | REJECTED — Duplicate of R16-09 (accepted risk). Outer query scopes supporters to orgId. |
| R19-03: SES webhook logs bounce/complaint emails | ACCEPTED — Server-side console.error only. CF Workers logs are transient (real-time). Not client-exposed. |
| R19-04: Report logs full DM email on failure | ACCEPTED — Same as R19-03. Server-side console.error at report.ts:614. |
| R19-09: AN importer logs raw email in error array | ACCEPTED — Server-side only. Error array returned to editor calling the import. |
| R19-10: Automation emailBody bypasses HTML sanitization | REJECTED — Workflow email body is set by editors, not supporters. Editor-authored HTML is trusted (same as email compose). |
| R19-11: Refund webhook double-decrement race | ACCEPTED — Stripe sends webhook once per event. Replay attacks are idempotent via Stripe event ID dedup. |
| R19-13: Intelligence embedding missing Number.isFinite | REJECTED — Already fixed in R5 ("Embedding Number.isFinite at 3 sites"). |
| R19-14: autoArchiveDays unbounded | ACCEPTED — Validated in alert-preferences endpoint: `Math.max(1, Math.round(parsed.autoArchiveDays))`. Upper bound is theoretical concern only — archived alerts are soft-deleted, not deleted. |

---

## Validated Findings

### P1 — High (4)

#### F-R19-01: Report page exposes targetEmail to all org members (no role gate)

**File**: `src/routes/org/[slug]/campaigns/[id]/report/+page.server.ts:16,23` + `src/lib/server/campaigns/report.ts:698-702`
**What**: `loadPastDeliveries()` returns `targetEmail` (DM email addresses) at line 702. The report page load function (line 16) calls it without `requireRole` — it uses `await parent()` which only requires org membership. The `send` action IS gated behind editor role, but the load function isn't. Any viewer sees DM emails in the past deliveries section.
**Impact**: Viewers see all decision-maker email addresses the org has sent reports to.

**Solution**: Strip `targetEmail` in `loadPastDeliveries` and replace with masked version:
```ts
targetEmail: maskEmail(d.targetEmail),
```
Import `maskEmail` from `$lib/server/org/mask`.

**Pitfall**: The report page svelte component renders `delivery.targetEmail` at two locations (lines 314, 322). Masked emails still display meaningfully (e.g., `j***@senate.gov`).

---

#### F-R19-02: Org calls endpoint exposes full phones + twilioCallSid (sibling of R17-01)

**File**: `src/routes/api/org/[slug]/calls/+server.ts:162-169`
**What**: R17-01 fixed the V1 endpoint (`api/v1/calls/+server.ts`). But the ORG endpoint at `api/org/[slug]/calls/+server.ts` still returns:
- `targetPhone: c.targetPhone` (line 162) — full DM phone
- `twilioCallSid: c.twilioCallSid` (line 166) — internal Twilio ID
- `supporter.phone: c.supporter.phone` (line 169) — supporter's personal phone!

This is the **5th sibling route regression** (R12, R14, R16, R17, R19).

**Impact**: Editor-gated, but still leaks full phone numbers of supporters and DMs.

**Solution**: Mask phones and remove internal IDs:
```ts
targetPhone: c.targetPhone ? '***' + c.targetPhone.slice(-4) : null,
twilioCallSid: undefined, // remove
supporter: c.supporter
    ? { id: c.supporter.id, name: c.supporter.name }
    : null, // remove phone from supporter
```

---

#### F-R19-03: A/B test subjects missing CRLF sanitization (sibling of R14)

**File**: `src/routes/org/[slug]/emails/compose/+page.server.ts:246-247`
**What**: R14 fixed the main subject with `.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998)`. But the A/B variant subjects (`subjectA`, `subjectB`) at lines 246-247 use only `.trim()` — no CRLF stripping. These subjects are stored as email subjects, enabling email header injection in A/B test variants.
**Impact**: Editor can inject headers via A/B variant subjects.

**Solution**: Apply same sanitization as main subject:
```ts
const subjectA = formData.get('subjectA')?.toString().trim()?.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998);
const subjectB = formData.get('subjectB')?.toString().trim()?.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998);
```

---

#### F-R19-04: SMS messages endpoint returns full phone + twilioSid

**File**: `src/routes/api/org/[slug]/sms/[id]/messages/+server.ts:69-71`
**What**: Response includes `to: m.to` (full phone number, line 69) and `twilioSid: m.twilioSid` (internal Twilio ID, line 71). Editor-gated, but consistent PII masking should apply.
**Impact**: Full supporter phone numbers in API response.

**Solution**: Mask phone and remove twilioSid:
```ts
to: m.to ? '***' + m.to.slice(-4) : null,
// remove twilioSid from response
```

---

### P2 — Medium (1)

#### F-R19-05: Workflow executions expose supporter email

**File**: `src/routes/api/org/[slug]/workflows/[id]/executions/+server.ts:49,75`
**What**: The select clause includes `email: true` (line 49) and the response returns `email: e.supporter.email` (line 75). Editor-gated, but emails should be masked for consistency.
**Impact**: Supporter emails in workflow execution API response.

**Solution**: Either mask or remove email:
```ts
supporter: e.supporter
    ? { id: e.supporter.id, name: e.supporter.name }
    : null,
```

---

## Task Graph

### Cycle 1: All fixes (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R19-01: Mask targetEmail in loadPastDeliveries | F-R19-01 | `report.ts` | pii-eng |
| T-R19-02: Mask org calls phones, remove twilioCallSid | F-R19-02 | `org/[slug]/calls/+server.ts` | pii-eng |
| T-R19-03: CRLF sanitize A/B subjects | F-R19-03 | `compose/+page.server.ts` | email-eng |
| T-R19-04: Mask SMS message phones, remove twilioSid | F-R19-04 | `sms/[id]/messages/+server.ts` | pii-eng |
| T-R19-05: Remove supporter email from executions | F-R19-05 | `executions/+server.ts` | pii-eng |

**Review Gate G-R19-01**: Verify emails masked, phones masked, CRLF stripped, internal IDs removed.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R19-01 | DONE | pii-eng | maskEmail(d.targetEmail) in loadPastDeliveries |
| T-R19-02 | DONE | pii-eng | targetPhone masked, twilioCallSid+supporter.phone removed |
| T-R19-03 | DONE | email-eng | CRLF+control char strip + 998 char cap on subjectA/B |
| T-R19-04 | DONE | pii-eng | Phone masked to last 4, twilioSid removed |
| T-R19-05 | DONE | pii-eng | email removed from supporter select+response |
| G-R19-01 | PASSED | team-lead | All 5 fixes verified via grep |
