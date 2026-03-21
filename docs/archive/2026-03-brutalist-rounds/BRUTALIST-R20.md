# Brutalist Assessment Round 20 — Page Route Serialization Boundary

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Claude (MCP roast, 5 parallel audit agents), validated by direct code reads
> **Prior rounds**: R1-R19 (144+ findings addressed)

## Methodology

Targeted page routes (+page.server.ts) and their server→client serialization boundary. Focus on data passed into SvelteKit page data that clients shouldn't see. Key themes: **calls page as 6th sibling regression**, **report page DM emails to viewers**, **governance page zero auth**.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| R20-03: SMS detail page raw phones | REJECTED — No SMS detail page route exists. Only API endpoint (fixed in R19). |
| R20-05: s/[slug] user email + identity_commitment | REJECTED — User's own data returned to themselves. SvelteKit per-request serialization, not cached. |
| R20-07: localStorage customRecipients/recipientEmails | ACCEPTED — Client-side storage of user's own draft data. Cleared on submit. No cross-user exposure. |
| R20-08: Campaign title/body unbounded | ACCEPTED — Editor-only, bounded by DB column limits (VARCHAR/TEXT). Not a security issue. |
| R20-09: DM detail over-projection | REJECTED — DM phone/email are public representative contact info (official government records). |
| R20-11: Supporters phone in page data | REJECTED — Grep confirms no phone field in supporters page server. |
| R20-12: TEMPLATE_LIST_SELECT fetches recipient_config | REJECTED — recipient_config is set to null at serialization boundary (fixed in R17). DB fetch isn't a leak. |
| R20-13: parseFilter unsafe cast | ACCEPTED — Filter comes from form data within authenticated editor context. Zod would be better but manual validation is sufficient. |

---

## Validated Findings

### P1 — High (3)

#### F-R20-01: Governance page has zero authentication

**File**: `src/routes/governance/+page.server.ts:96`
**What**: The load function signature is `async ({ url })` — no `locals` parameter, no auth check, no feature flag. Any visitor can enumerate all pending governance cases with full argument bodies, AI evaluation scores, stake amounts, and miner evaluations. Currently the DEBATE feature flag is `false` so no data exists, but the route is live and will expose data when debates are enabled.
**Impact**: When debate feature is enabled, unauthenticated access to all governance cases with internal AI scoring data.

**Solution**: Add auth + feature flag:
```ts
export const load: PageServerLoad = async ({ url, locals }) => {
    if (!FEATURES.DEBATE) throw error(404, 'Not found');
    if (!locals.user) throw error(401, 'Authentication required');
    // ... rest of load
};
```

**Pitfall**: Governance reviewers may need a specific role. For now, auth is the minimum bar. Consider requiring admin role later.

---

#### F-R20-02: Calls page leaks supporterEmail + unmasked targetPhone (6th sibling regression)

**File**: `src/routes/org/[slug]/calls/+page.server.ts:46-47`
**What**: R19 fixed the API endpoints (`api/org/[slug]/calls` and `api/v1/calls`). But the PAGE route still passes:
- `supporterEmail: c.supporter?.email ?? ''` (line 46) — full supporter email, never rendered in the svelte component
- `targetPhone: c.targetPhone` (line 47) — full DM phone number, unmasked

No `requireRole` check — any org member (viewer) sees this data in page source.

**Impact**: Viewer-level access to supporter emails and full DM phone numbers. This is the **6th sibling route regression**.

**Solution**: Mask both fields and add role check:
```ts
supporterEmail: undefined, // remove — never rendered
targetPhone: c.targetPhone ? '***' + c.targetPhone.slice(-4) : null,
```

---

#### F-R20-03: Report page exposes DM target emails to all org members

**File**: `src/routes/org/[slug]/campaigns/[id]/report/+page.server.ts:10,18-23`
**What**: `loadReportPreview()` returns `targets` array with `.email` (DM email addresses). The load function uses `await parent()` which only requires org membership (not editor role). The svelte component uses `t.email` in the send form (line 18,35). Any viewer sees DM emails in page data. The `send` action IS gated behind editor, but the load isn't.

R19 already masked `loadPastDeliveries`, but `loadReportPreview.targets` still leaks.

**Impact**: Viewers see all decision-maker email addresses the campaign targets.

**Solution**: Gate the report page behind editor role:
```ts
export const load: PageServerLoad = async ({ params, parent, locals }) => {
    if (!locals.user) throw redirect(302, '/auth/login');
    const { org } = await parent();
    const { membership } = await loadOrgContext(params.slug, locals.user.id);
    requireRole(membership.role, 'editor');
    // ... rest of load
};
```

**Pitfall**: This changes the page from member-visible to editor-only. If viewers should see the report preview (without emails), a more nuanced approach would mask emails for non-editors. But since the entire page is about sending reports (an editor action), gating the whole page is cleaner.

---

### P2 — Medium (2)

#### F-R20-04: Event checkinCode exposed to all org members

**File**: `src/routes/org/[slug]/events/[id]/+page.server.ts:69`
**What**: `checkinCode: event.checkinCode` passed to all org members. The checkin code is a security-sensitive value — knowing it allows attendees to mark themselves as "verified" at the event. Should be editor/admin only.
**Impact**: Viewer/member role can see and share the checkin code, enabling unverified attendance claims.

**Solution**: Gate behind role:
```ts
checkinCode: ['editor', 'admin', 'owner'].includes(membership.role) ? event.checkinCode : null,
```

---

#### F-R20-05: billingEmail exposed to all org roles

**File**: `src/routes/org/[slug]/+page.server.ts:394`
**What**: `billingEmail: orgBilling.billing_email` returned to all members. Comment says "for onboarding checklist only" but available to viewers.
**Impact**: Minor PII leak — billing contact email visible to all org members.

**Solution**: Only include for admin/owner:
```ts
billingEmail: ['admin', 'owner'].includes(membership.role) ? orgBilling.billing_email : null,
```

---

## Task Graph

### Cycle 1: All fixes (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R20-01: Governance auth + feature flag | F-R20-01 | `governance/+page.server.ts` | auth-eng |
| T-R20-02: Calls page PII masking | F-R20-02 | `org/[slug]/calls/+page.server.ts` | pii-eng |
| T-R20-03: Report page editor gate | F-R20-03 | `campaigns/[id]/report/+page.server.ts` | auth-eng |
| T-R20-04: checkinCode role gate | F-R20-04 | `events/[id]/+page.server.ts` | auth-eng |
| T-R20-05: billingEmail role gate | F-R20-05 | `org/[slug]/+page.server.ts` | pii-eng |

**Review Gate G-R20-01**: Verify governance auth, calls masked, report gated, checkinCode gated, billingEmail gated.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R20-01 | DONE | auth-eng | FEATURES.DEBATE + locals.user auth guard |
| T-R20-02 | DONE | pii-eng | supporterEmail removed, targetPhone masked to last 4 |
| T-R20-03 | DONE | auth-eng | requireRole('editor') on report page load |
| T-R20-04 | DONE | auth-eng | checkinCode gated to editor/admin/owner |
| T-R20-05 | DONE | pii-eng | billingEmail gated to admin/owner |
| G-R20-01 | PASSED | team-lead | All 5 fixes verified via grep |
