# Brutalist Assessment Round 11 — Post-Hardening Full Sweep

> **Status**: COMPLETE — 8 tasks done, 1 review gate passed
> **Date**: 2026-03-19
> **Source**: Claude (5-agent, 10 findings) + Codex (10 findings), validated by 2 parallel Explore agents
> **Prior rounds**: R1-R10 (79+ findings addressed)

## Methodology

Full `src/` codebase roast by Claude (5-agent parallel, 10 findings) and Codex (10 findings). Gemini errored out. Cross-validated against actual code by 2 parallel agents. 5 rejected, 4 accepted risk (scalability), 8 validated findings documented below.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| R11-01: Bill watch missing requireRole | INVALID — `orgBillWatch.position` is decoupled from scorecards. Scorecards use `campaign.position`. Confirmed twice (R10, R11). |
| C-09: DP analytics math wrong when enabled | INVALID — `correctKaryRR()` returns aggregate corrected counts. `processBatch()` bins by bucket key, applies corrected count per-aggregate, not per-row. Math is correct. |
| C-06: Analytics increment unbounded array | INVALID — Rate limiting enforced per item (MAX_DAILY per metric per IP). Oversized payloads waste parse CPU but don't bypass limits. Recommend Zod `.max()` as future hardening. |
| C-10: API key no mandatory expiry | INVALID — Optional expiry by design. Expiry validation works when set. No mandatory rotation requirement in product spec. |
| R11-07/08/09/10: Unbounded queries (scorecard, accountability, network) | ACCEPTED — Scalability concerns at current scale. Will need `take` limits and cursor pagination as data grows. Known gap. |

---

## Validated Findings

### P0 — Critical (2)

#### F-R11-01: totalCount bypasses k-anonymity on public receipt page

**File**: `src/routes/verify/receipt/[id]/+page.server.ts:52`
**What**: R10 fixed `verifiedCount` and `districtCount` suppression, but `totalCount` is still returned raw. When `verifiedCount=null` (suppressed, pool <5) but `totalCount=3`, an observer deduces the exact pool size — defeating k-anonymity.
**Impact**: Privacy invariant violated. Small group sizes identifiable on public unauthenticated page.

**Solution**: Suppress `totalCount` using the same threshold as `verifiedCount`:
```ts
const safeTotalCount = receipt.totalCount >= 5 ? receipt.totalCount : null;
```
Return `safeTotalCount` instead of `receipt.totalCount`.

**Pitfall**: Check that the Svelte component handles null `totalCount` gracefully. The narrative generator may also reference it.

---

#### F-R11-02: Scorecard receipt lookup uses substring match — wrong DM receipts corrupt scores

**File**: `src/lib/server/legislation/scorecard/compute.ts:347-364`
**What**: Receipt lookup uses `dmName: { contains: lastNameSubstring, mode: 'insensitive' }` which generates `ILIKE '%smith%'`. Short surnames (Lee, Li, Kim, Cole) match dozens of unrelated DMs. Corrupted receipts feed into `computeProofWeightedScore()`.
**Impact**: Scorecard alignment scores silently corrupted in proportion to surname commonality.

**Solution**: Use exact match on `decisionMakerId` instead of name substring:
```ts
where: { decisionMakerId: target.dmId, orgId }
```
If `dmId` is not available in the target context, fall back to `startsWith` (prefix match) instead of `contains` (substring), and add a `take: 100` limit.

**Pitfall**: Check the target object structure — does it carry `dmId`? If the target comes from campaign deliveries, it should have the DM relation. Trace the data flow to confirm.

---

### P1 — High (5)

#### F-R11-03: Alert generator TOCTOU — duplicate alerts on overlapping cron

**File**: `src/lib/server/legislation/alerts/generator.ts:141-163`
**What**: `findFirst` then `create` with no unique constraint on `(orgId, billId, type)`. Two overlapping cron runs both pass the dedup check and create duplicate alerts.
**Impact**: Duplicate alerts in user-facing digest emails.

**Solution**: Replace findFirst→create with upsert or raw SQL `INSERT ... ON CONFLICT DO NOTHING`:
```ts
await db.$executeRaw`
    INSERT INTO "LegislativeAlert" ("id", "orgId", "billId", "type", ...)
    VALUES (${id}, ${orgId}, ${billId}, ${alertType}, ...)
    ON CONFLICT ("orgId", "billId", "type") DO NOTHING
`;
```
Also add a unique constraint migration: `@@unique([orgId, billId, type])`.

**Pitfall**: Adding the unique constraint requires a migration. Check for existing duplicates in the database first — clean them before adding the constraint.

---

#### F-R11-04: upsertBill TOCTOU — bills silently dropped on concurrent ingestion

**File**: `src/lib/server/legislation/ingest/congress-gov.ts:336-381`
**What**: Separate lookup-then-insert calls instead of a single atomic upsert. Concurrent ingestion causes unique-index violations, and the error handler silently drops the bill.
**Impact**: Bills missing from the database after ingestion runs.

**Solution**: Collapse into one Convex mutation that looks up via `by_externalId` and either patches or inserts atomically:
```ts
export const upsertBill = mutation({
  args: { bill: v.any() },
  handler: async (ctx, { bill }) => {
    const existing = await ctx.db
      .query("bills")
      .withIndex("by_externalId", (q) => q.eq("externalId", bill.externalId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { title: bill.title, status: bill.status, /* ... */ });
    } else {
      await ctx.db.insert("bills", bill);
    }
  },
});
```

**Pitfall**: Ensure the patch path refreshes every field that should be kept current, not just those populated on insert.

---

#### F-R11-05: Missing requireRole on 3 PII endpoints — members read donor/supporter data

**Files**:
1. `src/routes/api/org/[slug]/fundraising/[id]/donors/+server.ts:15` — donor name + email
2. `src/routes/api/org/[slug]/workflows/[id]/executions/+server.ts:15` — supporter email
3. `src/routes/api/org/[slug]/segments/+server.ts:173` — full supporter CSV export (email, name, phone, tags)

**What**: All three call `loadOrgContext` (member-level) but not `requireRole('editor')`. Any org member can read PII.
**Impact**: Low-privilege members access donor and supporter PII. Segment export is particularly dangerous — full CRM dump.

**Solution**: Add `requireRole(membership.role, 'editor')` after `loadOrgContext` in each file.

**Pitfall**: Segment export already has rate limiting (1/min), but that doesn't replace authorization. The donors endpoint may be intentionally member-visible for fundraising transparency — check product intent before gating.

---

#### F-R11-06: getClientIP trusts spoofable headers before Cloudflare headers

**File**: `src/routes/api/analytics/increment/+server.ts:46-65`
**What**: Header priority: `x-forwarded-for` → `x-real-ip` → `cf-connecting-ip` → `true-client-ip`. On CF Workers, `cf-connecting-ip` is set by Cloudflare (trusted), but `x-forwarded-for` is checked first and is attacker-controlled.
**Impact**: Attackers can rotate fake IPs to bypass analytics rate limits (10/day per IP per metric).

**Solution**: Reorder to prefer Cloudflare-set headers:
```ts
const headers = ['cf-connecting-ip', 'true-client-ip', 'x-forwarded-for', 'x-real-ip'];
```

**Pitfall**: In non-CF environments (local dev), `cf-connecting-ip` won't be set. The fallback chain still works — just ensure dev isn't broken.

---

#### F-R11-07: Hardcoded user-seed-1 bypasses rate limiting + admin gate

**Files**: `src/routes/api/admin/backfill-embeddings/+server.ts:10`, `src/hooks.server.ts:273`
**What**: `ADMIN_USER_IDS = new Set(['user-seed-1'])` is the only admin check. In hooks.server.ts, `user-seed-1` bypasses ALL rate limiting. If this account exists in production, it's a universal bypass.
**Impact**: Compromise of one account disables all rate limiting. Admin access hardcoded to a seed user ID.

**Solution**:
1. Replace hardcoded admin check with a database `isAdmin` flag or role
2. Remove the rate limit bypass in hooks.server.ts — admin users should still be rate-limited (or use a separate, higher limit)

**Pitfall**: If backfill endpoint is dev-only, gate it behind `dev` import. Don't remove the endpoint if it's still needed for operations — just fix the auth check.

---

### P2 — Medium (1)

#### F-R11-08: Campaign detail sends target emails to all org roles

**File**: `src/routes/org/[slug]/campaigns/[id]/+page.server.ts:99`
**What**: The loader returns `campaign.targets` (with emails) to all org members. R10 stripped emails from the public page at `c/[slug]`, but this org-scoped loader was not gated. The UI hides edit controls behind `canEdit`, but `__data.json` exposes everything.
**Impact**: Any org member can extract DM emails from campaign detail.

**Solution**: Strip emails unless user has editor role:
```ts
targets: membership.role === 'member'
    ? targets?.map(t => ({ name: t.name, title: t.title, district: t.district }))
    : targets,
```

**Pitfall**: Ensure the component doesn't break for members (no mailto links visible to non-editors).

---

## Task Graph

### Cycle 1: All findings (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R11-01: Suppress totalCount for k-anonymity | F-R11-01 | `verify/receipt/[id]/+page.server.ts` | security-eng |
| T-R11-02: Scorecard receipt exact match | F-R11-02 | `scorecard/compute.ts` | security-eng |
| T-R11-03: Alert generator upsert | F-R11-03 | `alerts/generator.ts` | security-eng |
| T-R11-04: upsertBill atomic mutation | F-R11-04 | `congress-gov.ts` | api-eng |
| T-R11-05: requireRole on 3 PII endpoints | F-R11-05 | donors, executions, segments | api-eng |
| T-R11-06: getClientIP header order | F-R11-06 | `analytics/increment/+server.ts` | api-eng |
| T-R11-07: Remove user-seed-1 hardcoded bypass | F-R11-07 | `backfill-embeddings`, `hooks.server.ts` | api-eng |
| T-R11-08: Campaign detail target emails role-gated | F-R11-08 | `campaigns/[id]/+page.server.ts` | api-eng |

**Review Gate G-R11-01**: Verify totalCount suppressed, receipt lookup exact/prefix, alert upsert, bill upsert, 3 endpoints require editor, IP header order, seed user removed, campaign emails gated.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R11-01 | **done** | security-eng | safeTotalCount >= 5 threshold, Svelte renders "< 5" when suppressed |
| T-R11-02 | **done** | security-eng | Exact decisionMakerId match when resolved; startsWith + take:100 fallback |
| T-R11-03 | **done** | security-eng | try/catch P2002, @@unique([orgId, billId, type]) added to schema |
| T-R11-04 | **done** | api-eng | db.bill.upsert() replaces findUnique→create TOCTOU |
| T-R11-05 | **done** | api-eng | requireRole('editor') on donors, executions, segment export_csv |
| T-R11-06 | **done** | api-eng | cf-connecting-ip first, x-forwarded-for last |
| T-R11-07 | **done** | api-eng | ADMIN_USER_IDS from env var, rate limit bypass removed from hooks |
| T-R11-08 | **done** | api-eng | safeTargets strips email for member role |
| G-R11-01 | **passed** | team-lead | 8/8 checkpoints verified against code |
