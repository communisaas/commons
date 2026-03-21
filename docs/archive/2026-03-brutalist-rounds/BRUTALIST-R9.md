# Brutalist Assessment Round 9 — Post-Hardening Full Sweep

> **Status**: COMPLETE — 6 tasks done, 1 review gate passed
> **Date**: 2026-03-19
> **Source**: Claude critic against `src/`, validated by 2 parallel Explore agents
> **Prior rounds**: R1-R8 (64+ findings addressed)

## Methodology

Full `src/` codebase roast by Claude (10 raw findings). Gemini errored out. Cross-validated against actual code by 2 parallel agents. 4 rejected, 6 validated findings documented below. All 6 findings are in the legislation/accountability subsystem (newest, least-audited code).

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| F-R9-03: DM activity endpoint not org-scoped for LegislativeAction | INVALID — LegislativeAction is inherently global (a legislator's votes/sponsorships are canonical facts, not org-specific). AccountabilityReceipts correctly org-scoped. Design is intentional. |
| F-R9-06: Alerts PATCH no Zod, status transition not enforced | INVALID — `validStatuses` whitelist (`['seen', 'dismissed', 'acted']`) explicitly excludes `'pending'`. Forward-only transitions enforced. Manual validation sufficient. |
| F-R9-07: Content-Disposition header injection via org.slug | INVALID — `org.slug` is a trusted DB value from `loadOrgContext`, not direct user input. Slugs are normalized at creation. Segments endpoint uses only `Date.now()`. |
| F-R9-09: API keys in URL query strings logged to console | ACCEPTED — Commons API uses session cookies + Authorization header, never query-string auth. Theoretical risk only. Client-side logging of full URLs is standard practice. |

---

## Validated Findings

### P0 — Critical (1)

#### F-R9-01: Accountability page leaks cross-org receipt data

**File**: `src/routes/accountability/[bioguideId]/+page.server.ts:38-52`
**What**: Public page (no auth required). Fetches ALL `accountabilityReceipt` records for a DM across ALL orgs — no `orgId` filter. Returns per-receipt detail: proof weights, alignment, causality classes, bill associations. Exposes `uniqueOrgs` count (line 72) revealing how many organizations are engaging each legislator.
**Impact**: Anyone can enumerate DM bioguide IDs and learn which orgs are engaging which legislators, and with what intensity. Cross-org intelligence leak.

**Solution**: Aggregate receipts into summary stats that don't reveal per-org detail:
```ts
// Instead of returning raw receipts, aggregate
const summary = {
    totalWeight: receipts.reduce((sum, r) => sum + r.proofWeight, 0),
    receiptCount: receipts.length,
    // Remove uniqueOrgs count — reveals coalition size
    avgAlignment: receipts.reduce((sum, r) => sum + (r.alignment ?? 0), 0) / receipts.length,
    billCount: new Set(receipts.flatMap(r => r.billIds ?? [])).size
};
```

**Pitfall**: The `+page.svelte` component reads individual receipt data for the timeline view. The aggregation must be compatible with what the component renders. Check `$page.data.receipts` usage in the Svelte file to confirm which fields the timeline needs. If per-receipt detail is needed, strip `orgId` and any org-identifying fields from each receipt before returning.

---

### P1 — High (1)

#### F-R9-02: tsquery injection in bill search

**File**: `src/routes/api/org/[slug]/bills/search/+server.ts:47-53`
**What**: The regex on line 50 preserves hyphens: `w.replace(/[^a-zA-Z0-9-]/g, '')`. Hyphens are tsquery NOT operators. Input like `not-a-bill` produces `not-a-bill:*` which PostgreSQL's `to_tsquery()` interprets as `not:* & !(a:*) & bill:*` — semantic corruption. Crafted inputs with multiple hyphens can cause `to_tsquery()` parse errors (500 DoS).
**Impact**: Search result manipulation and potential 500 errors on bill search.

**Solution**: Replace `to_tsquery` with `websearch_to_tsquery` which handles natural language input safely:
```ts
// Line 83: Replace to_tsquery with websearch_to_tsquery
ts_rank(b.fts, websearch_to_tsquery('english', ${rawQuery})) AS rank
```
Where `rawQuery` is the original trimmed search input (no manual tsquery construction needed).

**Pitfall**: `websearch_to_tsquery` doesn't support prefix matching (`:*`). If prefix matching is required, strip hyphens in the regex instead: `w.replace(/[^a-zA-Z0-9]/g, '')`. This is simpler and preserves the existing `to_tsquery` + prefix pattern.

---

### P2 — Medium (4)

#### F-R9-03: loadOrgContext returns stripe_customer_id, wallet_address, billing_email

**File**: `src/lib/server/org.ts:52-72`
**What**: `loadOrgContext` returns `stripe_customer_id`, `wallet_address`, `billing_email` to all 68+ consumers. Any endpoint that does `return json({ org })` leaks payment infrastructure.
**Impact**: Defense-in-depth concern. No current confirmed leak path, but high blast radius if any consumer serializes the full org object.

**Solution**: Remove sensitive fields from the default `OrgContext` return. Add a separate `loadOrgBilling()` helper for the 2-3 endpoints that need billing fields:
```ts
// Default projection (all 68+ consumers)
select: { id, name, slug, description, avatar, mission, websiteUrl, logoUrl, plan, ... }

// Billing projection (billing/webhook, settings only)
export async function loadOrgBilling(orgId: string) { ... }
```

**Pitfall**: Grep for `org.stripe_customer_id`, `org.billing_email`, `org.wallet_address` to find all consumers that actually need these fields before removing them from the default projection.

---

#### F-R9-04: Issue domain endpoints missing Zod

**File**: `src/routes/api/org/[slug]/issue-domains/+server.ts:35-40, 126-132`
**What**: POST and PATCH use `as` type assertion (compile-time only). Manual validation is present (lines 42-52, 142-159) but duplicated between handlers and not schema-driven.
**Impact**: Inconsistent with project-standard Zod validation. Risk of POST/PATCH validation divergence.

**Solution**: Add shared Zod schema:
```ts
const IssueDomainSchema = z.object({
    label: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional().nullable(),
    weight: z.number().min(0.5).max(2.0).optional()
});
```
Use `.parse()` on POST (full schema) and `.partial().parse()` on PATCH.

**Pitfall**: PATCH allows partial updates. Use `IssueDomainSchema.partial()` for PATCH, not the full schema.

---

#### F-R9-05: Responses endpoint — no length limit on detail field

**File**: `src/routes/api/campaigns/[campaignId]/responses/+server.ts:31`
**What**: `detail` field is trimmed but has no `.max()` constraint. An attacker can submit multi-megabyte detail strings that get stored in PostgreSQL.
**Impact**: Storage DoS via bloated response records.

**Solution**: Add length validation:
```ts
const detail = body.detail?.trim()?.slice(0, 2000) || undefined;
```
Or better, add a Zod schema for the full request body.

**Pitfall**: Check if any legitimate use case produces detail strings > 2000 chars. Email bounce-back details can be verbose — 2000 is generous.

---

#### F-R9-06: 3 cron endpoints use process.env instead of $env/dynamic/private

**Files**: `legislation-sync/+server.ts`, `alert-digest/+server.ts`, `vote-tracker/+server.ts`, `scorecard-recompute/+server.ts`
**What**: Use `process.env.CRON_SECRET` directly. On CF Workers, `process.env` is empty — these endpoints return 500 (fail-safe but broken). The `ab-winner` endpoint correctly uses `$env/dynamic/private`.
**Impact**: Cron functionality broken on CF Workers. Not a security issue (fail-safe), but platform incompatibility.

**Solution**: Replace `process.env.CRON_SECRET` with `env.CRON_SECRET` from `$env/dynamic/private` in all 4 files, matching the `ab-winner` pattern.

**Pitfall**: Some of these files may already import `env` for other variables. Check existing imports before adding duplicates.

---

## Task Graph

### Cycle 1: All findings (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R9-01: Fix accountability cross-org leak | F-R9-01 | `accountability/[bioguideId]/+page.server.ts`, check `+page.svelte` | security-eng |
| T-R9-02: Fix tsquery injection | F-R9-02 | `bills/search/+server.ts` | security-eng |
| T-R9-03: Split loadOrgContext projections | F-R9-03 | `org.ts`, grep consumers | api-eng |
| T-R9-04: Zod for issue-domains POST/PATCH | F-R9-04 | `issue-domains/+server.ts` | api-eng |
| T-R9-05: Length limit on responses detail | F-R9-05 | `responses/+server.ts` | api-eng |
| T-R9-06: Cron endpoints $env/dynamic/private | F-R9-06 | 4 cron files | api-eng |

**Review Gate G-R9-01**: Verify accountability page strips org detail, tsquery uses websearch_to_tsquery or strips hyphens, loadOrgContext omits billing fields, issue-domains has Zod, responses has length cap, crons use $env.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R9-01 | **done** | security-eng | Removed uniqueOrgs count + UI block. Receipt-level data was already clean (orgId never in billMap projection). |
| T-R9-02 | **done** | security-eng | Stripped hyphens from regex: `[^a-zA-Z0-9-]` → `[^a-zA-Z0-9]` |
| T-R9-03 | **done** | api-eng | Billing fields removed from OrgContext. `loadOrgBilling()` added. 3 consumers updated (checkout, portal, org page). |
| T-R9-04 | **done** | api-eng | IssueDomainSchema: label trim+min+max, description trim+max, weight min/max. POST full, PATCH partial. |
| T-R9-05 | **done** | api-eng | `.slice(0, 2000)` after `.trim()` on detail field |
| T-R9-06 | **done** | api-eng | All 4 cron files switched to `$env/dynamic/private`. Also migrated CONGRESS_API_KEY, OPEN_STATES_API_KEY. Note: 3 more crons (cleanup-witness, debate-resolution, analytics-snapshot) still use process.env — out of scope. |
| G-R9-01 | **passed** | team-lead | 6/6 checkpoints verified against code |
