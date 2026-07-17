# App-wide Convex query-efficiency audit

Audit date: 2026-07-16

This audit covers exported public queries under `convex/`, SvelteKit
`serverQuery(api.*)` call sites, common authorization helpers, and the local
query-budget/log tooling. It follows the public-discovery incident documented in
`CONVEX-PUBLIC-DISCOVERY-IO.md`; the repaired homepage snapshot path is no longer
the largest _remaining_ read risk once it is deployed and populated.

## Static inventory

The module-aware guardrail currently sees:

- 231 exported public Convex queries in 36 modules;
- 131 syntactic `.collect()` calls across 90 public queries;
- 13 Convex query-builder `.filter()` calls across 10 public queries; and
- 23 clock reads across 20 public queries.

These figures are a debt inventory, not a claim that every occurrence costs the
same. An indexed collection of three rows is different from a full scan of
embedding-bearing documents. The scanner follows statically resolved local and
relative-import helper calls, so these totals include helper-factored hazards.
It still cannot measure a large `.take(10_001)`, repeated SSR queries, dynamic
dispatch, or an N+1 loop. The ranked findings below include those manually
traced dependencies.

The completion audit removed one especially dangerous baseline exception:
`templates.listMissingEmbeddings` is now secret-gated and uses the exact
`(status, isPublic, topicEmbeddingsUpdatedAt)` index with a 100-row hard cap. Both
the SvelteKit admin repair route and the Convex-native backfill publish the
homepage materializations once after a batch instead of scheduling one heavy
composite rebuild per template.

Eighty-five public queries call `requireOrgRole` directly and another 40 call
`requireAuth` directly. `requireOrgRole` itself reads the caller's `users` row,
the `organizations` row selected by slug, and `orgMemberships` before the domain
query starts (`convex/_authHelpers.ts:23-46,52-65,71-85,105-119`). This shared
edge matters for both bytes and invalidation fanout.

## Ranked remediation

### P0 — real pagination for supporters

`supporters.list` is cursor-shaped but not database-paginated. Every invocation
reads up to 10,001 supporters, filters and slices them in memory, then collects
tag links and loads tags per returned supporter (`convex/supporters.ts:157-298`).
The browser export and full-row scan call this query repeatedly with successive
cursors (`src/routes/org/[slug]/supporters/+page.svelte:208-219,420-438`). At a
10,000-row org, a 100-row export can therefore revisit roughly one million
supporter documents before tag joins.

Implement a true `.paginate()` path for the unfiltered list first. Add only the
composite indexes justified by active filters (`orgId + emailStatus`, `orgId +
verified`, and `orgId + source` are the obvious candidates), and invert the tag
path through `supporterTags.by_tagId`. Preserve an explicit, separately gated
bulk-export path instead of making every page query a disguised export.

### P0 — stop hydrating every org workspace on every navigation

The org layout deliberately mounts all workspaces and starts about twenty domain
queries for every real org navigation (`src/routes/org/[slug]/+layout.server.ts:145-262`).
The result spans campaigns, supporters, receipts, segments, donations,
workflows, SMS, calls, networks, events, API state, decision-maker follows,
bills, and scorecards. Inactive workspaces therefore consume reads and inherit
invalidations from tables the user is not viewing.

There is also a concrete duplicate today: `organizations.getDashboardStats`
calls `computeDistrictVerified`, which reads up to 10,001 verified actions
(`convex/organizations.ts:277-290`, `convex/_dashboardStats.ts:35-57`), while the
same layout also calls `supporters.getDistrictVerifiedCount`, which invokes the
same helper (`src/routes/org/[slug]/+layout.server.ts:211-217`,
`convex/supporters.ts:540-550`). The layout can use
`dashboardStats.funnel.districtVerified` for both consumers and remove the
second scan without changing the displayed value.

Do not replace the twenty calls with one permanent mega-query: that would make
every write to any participating table invalidate the entire shell. Prefer four
workspace-sized queries, load the active workspace first, prefetch the others
after interaction/idle, and reuse parent data in deep routes.

### P0 — remove global auth and API-key cache churn

Every request carrying `auth-session` calls `authOps.validateSession`
(`src/hooks.server.ts:87-105`). The query reads a session and the full user row,
then uses `Date.now()` for expiry and renewal (`convex/authOps.ts:484-520`). This
puts a time-sensitive query and a potentially wide user document on the hottest
request path. The root layout then reads the same user again with
`users.getProfile` and calls `organizations.getMyMemberships`
(`src/routes/+layout.server.ts:6-20`); the latter collects every membership and
then every campaign for each org just to count active campaigns
(`convex/organizations.ts:392-424`).

A safe session refactor is to query static session material (session creation
time, stored expiry, and a narrow user projection) and perform exact clock
comparisons in the SvelteKit hook. Deleting or updating the session still
invalidates the cached material. The signed Convex JWT already places the user
ID in `sub` (`src/lib/server/convex-jwt.ts:110-141`), so `requireAuth` can validate
and normalize that subject before falling back to the user index; it need not
make every authorized domain query depend on an otherwise unrelated user-row
update.

The v1 path contains an even tighter invalidation loop. Authentication reads the
`apiKeys` document and calls `Date.now()`, then every successful request
fire-and-forgets `trackApiKeyUsage`, which patches `lastUsedAt` and
`requestCount` on that same document (`convex/v1api.ts:30-77`,
`src/lib/server/api-v1/auth.ts:43-60`). The write invalidates the auth query that
read it. Put mutable usage telemetry in a separate counter/bucket document (or
batch it), leaving credential/scopes/revocation state stable and cacheable.

### P0 — retire repeated public share-page scans

The public `/s/[slug]` page starts message-district, total-state, debate,
position-count, existing-position, and relation queries in its first batch
(`src/routes/s/[slug]/+page.server.ts:107-192`), then scans position registrations
again for district engagement (`src/routes/s/[slug]/+page.server.ts:292-298`).

Three reads are immediately suspect:

- `templatePage.getTotalStates` collects every active decision maker and returns
  a number (`convex/templatePage.ts:53-70`), but the caller reads it as
  `{ count: number }`, so the current rendered value falls back to `50`
  (`src/routes/s/[slug]/+page.server.ts:194-201`). Removing the query and using
  the existing constant preserves current behavior.
- `templatePage.getMessageDistrictCounts` collects the legacy `messages` range
  (`convex/templatePage.ts:21-48`). There is no in-tree writer to `messages`.
  Verified-delivery district counts are already maintained on the template by
  `submissions.incrementTemplateReach` (`convex/submissions.ts:2010-2037`). Return
  the K-floored aggregate from the public detail projection and remove the dead
  scan after a parity/backfill check.
- `positions.getCounts` and `positions.getEngagementByDistrict` each collect the
  same template's registrations (`convex/positions.ts:17-40,160-223`). Return the
  headline counts with the engagement result, or maintain one compact
  per-template stats document transactionally from the registration mutations.

### P1 — split embedding-heavy template records from read models

`templates` co-locates public content, reach arrays, sources, and three families
of 768-dimensional embeddings (`convex/schema.ts:251-283`). Projection after a
read prevents vector egress but does not prevent Convex from reading the vector
bytes.

Remaining exposed paths include:

- `users.getMyTemplates`, which returns every raw template document even though
  the profile uses only ID, title, slug, status, visibility, and creation time
  (`convex/users.ts:92-100`, `src/routes/profile/+page.server.ts:118-140`);
- `templates.listByUser` and `templates.listByOrg`, which collect all heavy rows
  before projecting small DTOs (`convex/templates.ts:1307-1366`); and
- `templates.getBySlugPublic`, which reads one heavy row on each cache miss and
  is called by the share layout, OG image, and template modal
  (`convex/templates.ts:990-1049`, `src/routes/s/[slug]/+layout.server.ts:19`,
  `src/routes/s/[slug]/og-image/+server.ts:10`,
  `src/routes/template-modal/[slug]/+page.server.ts:10`).

Cap and explicitly project raw-return queries now to reduce response leakage,
but treat that only as containment. The durable fix is a compact template
metadata/detail table or moving embeddings and large research caches to sidecar
documents. Reach-counter writes should not invalidate and force rereads of
embedding payloads.

### P1 — remove coalition and accountability N+1 reads

`networks.getStats` collects active members, then all supporters per member org,
then all campaign actions per member org, and finally reads all campaign actions
again to compute GDS (`convex/networks.ts:801-905`). Use the existing
`orgNetworkMembers.by_networkId_status` index and build the district histogram in
the first action pass. Longer term, materialize per-org network inputs.

`networks.list` similarly collects all memberships, filters status in memory,
and collects the complete member set for every resulting network
(`convex/networks.ts:40-89`) despite existing status indexes
(`convex/schema.ts:1657-1669`).

`legislation.listMyReceipts` performs an unindexed `campaignActions.supporterId`
filter for each supporter, followed by deliveries and receipts per action
(`convex/legislation.ts:1353-1408`). Add `campaignActions.by_supporterId`, bound
and paginate the traversal, or materialize the identity-to-receipt relationship.
`legislation.listOrgScorecards` collects all receipts for each decision maker and
then filters by org (`convex/legislation.ts:2467-2501`); add
`accountabilityReceipts.by_orgId_decisionMakerId` or maintain an org/DM summary.

### P1 — finish denormalizing the always-on org shell

- `workflows.list` collects every execution for every workflow just to count
  them (`convex/workflows.ts:319-347`). Maintain `executionCount`.
- `sms.listBlasts` loads all messages for each of up to 200 blasts despite blast
  counters, and `sms.getReplySummary` collects every reply for the org
  (`convex/sms.ts:254-366`). Use validated blast counters and an org reply
  summary.
- `donations.getConfirmationSummary` collects every donation for the org, while
  `donations.listByOrgWithDonors` accepts a cursor but ignores it and collects all
  org campaigns (`convex/donations.ts:114-165,670-714`). Maintain confirmation
  counters and use a real campaign type/status index plus pagination.
- `organizations.getSettingsData` combines four collects, member joins,
  `Date.now()`, in-memory invite filtering, and an all-campaign sum
  (`convex/organizations.ts:723-825`). Add an active-invite index/state and read
  a period/org usage counter instead of campaign history.

### P2 — bound lower-frequency public/admin surfaces

`organizations.listPublic` scans all organizations before applying `isPublic`
and offset slicing (`convex/organizations.ts:100-136`). Use an indexed public
directory snapshot or a compound public/name ordering. Similar baseline entries
remain for governance, exports, admin embedding backfills, and v1 list
endpoints; prioritize them using runtime byte totals rather than source order.

## Query-dependency hypergraph

The table expresses each request root as a hyperedge: one route depends on many
functions/tables, while shared auth documents connect many otherwise unrelated
functions. Any write to a read dependency can invalidate the corresponding
cached query result.

| Request root | Function hyperedge | Principal tables/read ranges | High-fanout invalidators |
| --- | --- | --- | --- |
| Any cookie-bearing request | `hooks.server` → `authOps.validateSession` | `sessions`, `users` | session renewal/revocation; any patch to the returned user; time-based cache churn |
| Any org-authorized public query | query → `requireOrgRole` | `users.by_tokenIdentifier`, `organizations.by_slug`, `orgMemberships.by_userId_orgId`, plus domain tables | profile changes, mutable org counters, membership changes invalidate domain-query caches |
| `/org/[slug]/*` shell | context + dashboard + supporters + receipts + segments + fundraising + workflows + SMS/calls + networks + events/API + legislation | union of `organizations`, `campaigns`, `campaignActions`, `supporters`, `accountabilityReceipts`, `segments`, `donations`, `workflows`, `workflowExecutions`, `smsBlasts`, `smsMessages`, `smsReplies`, `patchThroughCalls`, `orgNetworkMembers`, `orgEvents`, bill/follow/scorecard tables | almost any operational org write; duplicated district-action scan |
| Supporters page/export | `supporters.list` (+ summary/tags/campaigns/segments) | up to 10,001 `supporters` per cursor call, then `supporterTags` and `tags` joins | supporter imports/status edits, tags, org counter patches; each export cursor repeats the large range |
| `/s/[slug]` | template detail + message/state/debate/position/relation queries | heavy `templates`, legacy `messages`, `decisionMakers`, `debates`, `debateArguments`, `positionRegistrations`, `userDmRelations` | template reach updates reread heavy doc; every position write invalidates two aggregate scans |
| `/api/v1/*` | `authenticateApiKey` → endpoint query → `trackApiKeyUsage` | `apiKeys`, `organizations`, `subscriptions`, endpoint domain tables | usage mutation patches the auth document after every successful request |
| Network detail/report/stats API | `networks.get` + `getStats` + proof pressure | `orgNetworkMembers`, member `organizations`, all member `supporters`, repeated `campaignActions`, receipts/external IDs | any member action/supporter/member-roster write |
| Profile/receipts | profile + templates + representatives + reverification + receipt traversal | `users`, heavy `templates`, `userDmRelations`, `districtCredentials`, `supporters`, actions, deliveries, receipts | user/profile/credential writes; any authored-template update; receipt/action chain writes |

The most important structural edge is `requireOrgRole`: because it returns the
full mutable org document, a supporter-count or sent-email counter patch can
invalidate cached queries for workflows, bills, networks, SMS, and other domains
that only needed the org ID for authorization. After the immediate query fixes,
introduce an ID-based membership helper for calls that do not need org fields,
or a compact access record, and pass the already-resolved org ID from the parent
layout. Membership checking must remain inside every public function.

## Guardrail now enforced

`scripts/check-convex-query-efficiency.mjs` parses TypeScript modules and finds
exported public queries through direct, renamed, or namespace imports of the
generated `query` factory and named export forms. It follows reachable top-level
local and relative-import helpers, propagates destructured/aliased `db` and
query-builder parameters, and distinguishes query-builder `.filter()` from
JavaScript array filtering. An unresolved delegated handler fails closed. The
exact existing debt lives in `scripts/convex-query-efficiency-baseline.json`.

Each baseline entry contains rule counts, an owner, a reason, and an expiry. The
check fails when:

- a new public query introduces one of the three hazards;
- an existing query increases or decreases a hazard count without updating the
  baseline;
- a stale baseline entry remains after its debt is removed;
- an entry lacks an owner/specific reason/valid expiry; or
- an exception expires (the current baseline expires 2027-01-31).

Run it locally with:

```sh
npm run check:convex-queries
```

Baseline regeneration is deliberately not a one-command rubber stamp. It
requires an explicit acknowledgement plus owner, reason, and future expiry; it
preserves metadata for unchanged entries and applies the supplied metadata only
to new or changed debt:

```sh
CONVEX_QUERY_BASELINE_OWNER='@your-handle' \
CONVEX_QUERY_BASELINE_REASON='Specific reviewed reason for retaining this debt.' \
CONVEX_QUERY_BASELINE_EXPIRES='2026-09-30' \
node scripts/check-convex-query-efficiency.mjs \
  --print-current --accept-baseline-update \
  | npx prettier --parser json
```

`CONVEX_QUERY_EFFICIENCY_TODAY` is rejected; expiry always uses the runner's UTC
clock. Review and apply only the intended baseline delta. The npm `ci` aggregate
and `.github/workflows/ci.yml` both run the guardrail.

The AST guard deliberately does not pretend to prove efficiency. It cannot see
computed/dynamic dispatch, runtime package behavior, document byte size, N+1
joins, `.take(10_001)`, or route-level repetition. Those require transaction
budgets and runtime logs.

## Transaction-budget follow-ups

The repository already has the right primitive. `convex-test` exposes
`ctx.meta.getTransactionMetrics()` and transaction limits for bytes, documents,
and database-query count. `convex/templates-read-budget.convex.test.ts:16-28,36-44`
uses embedding-heavy fixtures and asserts compact snapshot reads below 2 KB;
`convex/observability-service-ping.convex.test.ts:17-35` proves the health probe
performs one indexed manifest read, returns one document, and stays below 2 KB.

Add representative budgets in this order:

| Budget case | Fixture/claim |
| --- | --- |
| `supporters.list`, unfiltered first and later pages | Compare small and 10k-row orgs; documents/bytes for one page must stay proportional to page size, and a later cursor must not reread the prefix. Include tag links. |
| Org shell critical slice | Seed 10k verified actions; the shell must execute the district scan once, not twice. Record the sum of per-function bytes for the initial active workspace. |
| Session validation | Heavy user fixture; after refactor, require one session plus a compact user/auth record and assert bytes, not only document count. Verify expiry in the SvelteKit hook separately. |
| `/s/[slug]` aggregate bundle | Seed a heavy template plus many messages/positions; detail reads must not hydrate embeddings, and district/position aggregates must be O(1) or one bounded read. |
| `networks.getStats` | Seed multiple member orgs and action histories; assert each action range is read once and member-status selection uses the composite index. |
| API-key authentication | Repeated auth plus usage tracking must not make auth depend on a mutable usage document. Verify query bytes and runtime cache-hit behavior. |
| Scorecards/receipts | Large cross-org DM receipt fixture; org/DM reads must remain bounded to that org and receipt traversal must paginate. |

Prefer cardinality-slope assertions (10 rows versus 10,000) over generous absolute
caps. An absolute limit can still allow O(N) behavior until production crosses
it; a slope test catches the algorithmic regression.

## Runtime usage tooling

There is no repository script that currently aggregates Convex function logs by
read I/O. The installed CLI can emit historical successful executions as JSONL:

```sh
npx convex logs --prod --history 10000 --success --jsonl
```

Its completion records include `identifier`, `cachedResult`, `returnBytes`, and
`usageStats.databaseIoReadBytes`, `databaseReadBytes`, and
`databaseReadDocuments`. Add a read-only report that groups by function
identifier and reports total I/O, executions, cache-miss count/rate, bytes per
miss, and p50/p95/p99 bytes. Store no arguments or PII. Run it daily and alert
on both team quota (50/75/90%) and per-function regressions against a rolling
baseline.

Static route-to-function mapping from this hypergraph plus function-log totals
is enough to rank remediation without adding application writes. Send frequent
process-liveness traffic only to the zero-dependency `/api/live` endpoint, never
to a dynamic product page. Probe the one-document, indexed `/api/health`
readiness control plane separately at a five-minute cadence.
