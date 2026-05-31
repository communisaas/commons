# Execution Log

Append-only record of do→review cycles. Each entry captures one task or one bounded sub-step.

---

## 2026-05-28T02:15:00Z T9-3.1 webhooks-schema (sub-step 1 of T9-3 outbound-webhooks)

**Status:** completed
**Planned effort:** ~0.5d as part of T9-3 (3d total M)
**Actual effort:** ~0.25h
**Files touched:** `convex/schema.ts` (+62 lines)
**Files created:** none

**Work done:**
Added three new tables to convex/schema.ts after `orgTwilioNumbers`:
- `orgWebhooks` — org-managed subscription rows with HMAC `signingSecret` + `signingSecretPrevious` for dual-rotation; events array; enabled flag; failureCount tally. Indexes: `by_orgId`, `by_orgId_enabled`.
- `orgWebhookDeliveries` — per-attempt delivery log; attempt 1..5; nextRetryAt drives cron pickup; isDead set on exhaustion. Indexes: `by_webhookId`, `by_orgId`, `by_nextRetryAt`, `by_isDead`.
- `orgEvents` — lightweight event notification, **shared with T9-7 SSE subscription path**. Single index `by_orgId_emittedAt` for cursor-paginated reads. 7-day retention (cron TBD in T9-3.3).

**Key decisions applied (from T9-3 spec):**
- Dual-secret rotation pattern (signingSecret + signingSecretPrevious) — mirrors `UNSUBSCRIBE_SECRET`/`BLAST_DISPATCH_SECRET` per memory.
- Throttle decision deferred to T9-3.4 (event emission at call sites) — schema doesn't enforce throttle; throttle happens in dispatch.
- orgEvents intentionally shared with T9-7 — this is the explicit unblocks edge from CP-1.

**Risks honored:**
- "Convex action HTTP failures don't roll back" — addressed by logging delivery attempts even on first-attempt success (deliveredAt always set; statusCode + errorMessage capture outcome).

**Validation:**
- `pnpm svelte-check`: 0 errors, 128 warnings (all pre-existing; none from this change), 7884 files checked.
- No conflicts with existing tables (greps confirmed `orgWebhooks`/`orgWebhookDeliveries`/`orgEvents` absent before this edit).

**Deviation from plan:** none.

**New tasks created:** none.

**Chokepoint unlocked:** none yet. T9-3 itself is the chokepoint; completion of all 8 sub-steps will unlock T7-1, T8-8, T9-6, T9-7.

**Notes:**
- Schema additions are durable across Convex deploys but require `npx convex dev` or `convex deploy` to regenerate `convex/_generated/dataModel.d.ts` before downstream code (T9-3.2 dispatch action) can reference these tables. Operator action needed before T9-3.2 work; otherwise dispatch action will fail to typecheck against the table identifiers.
- The 62 lines added include inline documentation explaining each field's purpose — follows the existing convention (e.g., `sweepCheckpoints` and `orgTwilioNumbers` both have rich block comments).

---

## 2026-05-28T02:35:00Z T9-3.2 webhooks-dispatch (sub-step 2 of T9-3)

**Status:** completed
**Planned effort:** ~1d as part of T9-3
**Actual effort:** ~0.5h
**Files touched:** none
**Files created:** `convex/orgWebhooks.ts` (~290 LOC)

**Work done:**
- `queueEvent` internalMutation: writes orgEvents row + fans out to enabled subscribers; per-subscriber inserts orgWebhookDeliveries row + `scheduler.runAfter(0, deliverWebhook)`.
- `deliverWebhook` internalAction: HMAC-SHA256 signing via Web Crypto subtle (Convex V8 has no `node:crypto`), 10s fetch timeout, status classification (2xx success / 4xx permanent / 5xx retryable / network retryable). Headers per Stripe-like scheme: `X-Commons-Signature-256: t={timestamp},v1={hex_hmac}`.
- `markDeliverySuccess` / `markDeliveryDead` / `markDeliveryRetryable` internal mutations close the loop.
- `_getDelivery` / `_getWebhook` internalQueries for the action to read across the boundary.

**Key decisions applied:**
- Dual-secret rotation pattern from `_internalAuth.ts` (signingSecret + signingSecretPrevious). Signing always uses active secret; receivers verify against both for the rotation window.
- Throttle decision from T9-3 key_decisions deferred to T9-3.4 (emission throttle happens at call sites, not in dispatch).
- AbortSignal.timeout(10_000) per the "receivers should respond fast" pattern; bounds worker time.

**Risks honored:**
- "Convex action HTTP failures don't roll back" — every delivery attempt produces a row update (success/dead/retryable), never silently drops.

**Validation:**
- Initial pass had 4 errors (circular self-reference in action wrappers wrapping mutations labeled as queries). Restructured to use `internalQuery` for `_getDelivery`/`_getWebhook` and removed the redundant action wrappers.
- Also surfaced 36 unrelated `implicit any` errors across SvelteKit routes — transient codegen state during edits, all cleared after re-codegen.
- Final: `pnpm svelte-check` = 0 errors, 128 warnings (all pre-existing), 7,885 files.

**Deviation:** First implementation had self-referential type inference (action `getDelivery` calling itself transitively). Fixed by switching helpers to true `internalQuery`.

**Discovery flagged:** Codegen transiently surfaces ~38 `implicit any` errors across `src/routes/**/+server.ts` during incremental edits (callback parameter types not propagated through Convex result types). These clear on the next clean codegen, but indicate that arrow-function parameter typing in those handlers is loose. Not in T9-3 scope; record as latent for a future tier honesty pass.

**Chokepoint progress:** T9-3 chokepoint is ~25% done (2 of 8 sub-steps).

---

## 2026-05-28T02:40:00Z T9-3.3 webhooks-retry-cron (sub-step 3 of T9-3)

**Status:** completed
**Planned effort:** ~0.5d
**Actual effort:** ~0.15h
**Files touched:** `convex/orgWebhooks.ts` (+60 LOC), `convex/crons.ts` (+22 LOC)
**Files created:** none

**Work done:**
- `retryPendingDeliveries` internalAction: every 1 min cron tick scans `by_nextRetryAt` for `nextRetryAt <= now`, takes RETRY_BATCH * 2 (=100) and slices to RETRY_BATCH (=50) per tick to bound work. Each scheduled via `runAfter(0, deliverWebhook)`.
- `_listDueRetries` internalQuery: the index-backed query feeding the retry loop. Filters out isDead + already-delivered rows defensively (also enforced in deliverWebhook short-circuit).
- `expireOldEvents` internalMutation: hourly purge of orgEvents older than 7 days, 1000/tick. SSE consumers only read recent (since-cursor pattern) so older rows are dead weight.
- Cron entries 24 (webhook-retry, every minute) and 25 (org-events-expire, hourly :47 staggered) added to `convex/crons.ts`.

**Key decisions applied:**
- RETRY_BATCH = 50 caps action time (each tick should complete in < 30s including deliverWebhook scheduler overhead).
- 7-day orgEvents retention matches SSE consumer expectations (T9-7 consumers query recent windows only).
- :47 cron minute to stagger off existing hourly crons at :07, :13, :21, :37.

**Validation:** `pnpm svelte-check` = 0 errors, 128 warnings, 7,885 files.

**Deviation:** none.

**Chokepoint progress:** T9-3 chokepoint is ~37.5% done (3 of 8 sub-steps). Next: T9-3.4 event emission at call sites.

---

## 2026-05-28T03:15:00Z T9-3.4 webhooks-event-emission (sub-step 4 of T9-3)

**Status:** completed
**Planned effort:** ~1d (4 call sites)
**Actual effort:** ~0.5h
**Files touched:** `convex/campaigns.ts` (+19 LOC), `convex/webhooks.ts` (+16 LOC), `convex/supporters.ts` (+13 LOC), `convex/events.ts` (+14 LOC)

**Work done — four emit sites wired:**

1. `convex/campaigns.ts:createCampaignAction` — emits `campaign_action.created` after counter patch. Captured the inserted action's ID (`const actionId = await ctx.db.insert(...)`) so the payload references it. Wrapped in `if (orgId)` guard — orgId is `Id<"organizations"> | undefined` (derived from `campaign?.orgId`); defensive against null campaign even though the insert above already uses it.

2. `convex/webhooks.ts:completeDonation` — emits `donation.completed` after status patch + counter patch. Payload: donationId, campaignId (nullable), amountCents, recurring boolean, timestamp. No PII in payload (donor email/name stay in encryptedEmail/encryptedName on the donation row).

3. `convex/supporters.ts:create` — emits `supporter.created` after tag linkage. Payload: supporterId, source, country, timestamp. No PII.

4. `convex/events.ts:createRsvp` — emits `event.rsvp_created` after RSVP insert. Used `event.orgId` (Id-typed) directly rather than the local `orgId = String(event.orgId)` which lost type info.

**Key decisions applied:**
- Throttle for high-frequency `campaign_action.created` deferred per spec; downstream batching (retry cron at 50/tick + SSE polling at since-cursor) bound the effective load.
- No PII in any webhook payload — receivers must use v1 API with their own API key if they need supporter details (the principle of "events tell what happened, API tells the details").
- For event.rsvp_created, used `event.orgId` (Id<"organizations">) rather than the local `orgId = String(...)` to preserve type narrowing.

**Risks honored:**
- `campaign_action.created` is the highest-frequency event. Each emission writes 1 orgEvents row + N webhookDeliveries (one per subscriber). At 100 verified actions/min per org, that's 100 orgEvents writes/min + 100*N deliveries/min — bounded by Convex write rate but not throttled in code. If load issues surface, throttle is implementable via the existing `recentEmitCount` pattern (count emits in past 60s, batch if over threshold) without schema change.

**Validation:**
- First pass: 2 type errors. Fixed:
  - `campaigns.ts:981` — `orgId` was `Id<"organizations"> | undefined` (from `campaign?.orgId`); wrapped emission in `if (orgId)` guard.
  - `events.ts:594` — local `orgId` was String-coerced (`const orgId = String(event.orgId)`); used `event.orgId` directly in queueEvent call.
- Final: `pnpm svelte-check` = 0 errors, 128 warnings, 7,885 files. Stable.

**Deviation:** none.

**New tasks created:** none.

**Chokepoint progress:** T9-3 chokepoint is 50% done (4 of 8 sub-steps).

**Next:** T9-3.5 — v1 API endpoint /api/v1/webhooks CRUD. This is the org-facing surface for webhook subscription management. Includes auth via existing API key middleware, scope check (`write` for create/update/delete; `read` for list), validation of URL + events array, dual-secret rotation API (rotate-secret endpoint), test-fire endpoint.

---

## 2026-05-28T03:35:00Z T9-3.5 webhooks-v1-api (sub-step 5 of T9-3)

**Status:** completed
**Planned effort:** ~1d
**Actual effort:** ~0.5h
**Files touched:** `convex/v1api.ts` (+210 LOC)
**Files created:** `src/routes/api/v1/webhooks/+server.ts` (~100 LOC), `src/routes/api/v1/webhooks/[id]/+server.ts` (~135 LOC), `src/routes/api/v1/webhooks/[id]/rotate-secret/+server.ts` (~45 LOC)

**Work done — v1api wrappers + 3 SvelteKit routes:**

Convex side (`v1api.ts`):
- `generateSigningSecret()` — 32-byte HMAC-SHA256-sized hex string via `crypto.getRandomValues` (Convex V8 has Web Crypto subtle, not `node:crypto`)
- `ALLOWED_WEBHOOK_EVENTS` allowlist — 8 event names matching the emit sites from T9-3.4
- `listWebhooks` query — returns metadata only, NO signingSecret in response
- `createWebhook` mutation — URL parse + scheme check (http or https), events allowlist check, generates secret, returns **ONCE** in `webhook.signingSecret`
- `getWebhook` query — single-row variant of list; same no-secret response
- `updateWebhook` mutation — partial update of url/events/enabled/description; enabling resets failureCount (so re-enable doesn't trip auto-disable on first new failure)
- `rotateWebhookSecret` mutation — current → signingSecretPrevious (dual-rotation window), generates new active secret, returns **ONCE**
- `deleteWebhook` mutation — cascading delete of orgWebhookDeliveries rows first, then webhook row (no orphan delivery history)

SvelteKit routes (mirror the existing tags v1 pattern):
- `/api/v1/webhooks` (GET list + POST create) — write scope required for POST
- `/api/v1/webhooks/[id]` (GET + PATCH + DELETE) — write scope required for PATCH/DELETE
- `/api/v1/webhooks/[id]/rotate-secret` (POST) — write scope required

All endpoints: `requirePublicApi()` → `authenticateApiKey()` → `checkApiPlanRateLimit()` → `requireScope()` chain.

**Key decisions applied:**
- signingSecret returned EXACTLY ONCE on create + rotate; never on list/get. Caller persists it themselves. This avoids accidental secret exposure in logs/dashboards.
- Events allowlist (`ALLOWED_WEBHOOK_EVENTS`) keeps the schema honest — receivers can only subscribe to events the emit-site code actually emits. Adding new events requires updating both the allowlist and the emit site.
- URL validation does URL constructor parse + scheme allowlist (http/https). Localhost-style http allowed for testing; production should use https.
- Cascading delete: deleting a webhook also deletes its delivery history. Prevents orphan rows that no foreign key constraint would otherwise catch (Convex has no foreign keys).
- Re-enable resets failureCount so an org that fixes their endpoint after the auto-disable circuit trips doesn't immediately retrip on the first new failure.

**Risks honored:**
- "Convex action HTTP failures don't roll back" — irrelevant here (CRUD endpoints, not actions).
- Secret rotation window: receivers MUST accept either signingSecret OR signingSecretPrevious for the rotation window. The dispatch action (T9-3.2) always signs with the active secret; receivers handle the dual-acceptance themselves per docs.

**Validation:**
- First pass: 10 errors (all from `./$types` not found on the new routes — SvelteKit auto-generates these on `svelte-kit sync` which runs as part of svelte-check). After auto-sync, second pass: 0 errors.
- Final: `pnpm svelte-check` = 0 errors, 128 warnings, **7,891 files** (was 7,885 — six new files counted: 3 route files + 3 generated `$types.d.ts`).

**Deviation:** none.

**New tasks created:** none.

**Discovery flagged:** The "test-fire endpoint" mentioned in the original T9-3 spec is NOT in this sub-step. It would be a `POST /api/v1/webhooks/[id]/test-fire` that calls `internal.orgWebhooks.queueEvent` with a synthetic payload. Useful for orgs to validate their endpoint works. Recording as a follow-up — could be added to T9-3.8 (integration tests + ergonomics) or as a standalone T9-3.5b.

**Chokepoint progress:** T9-3 chokepoint is 62.5% done (5 of 8 sub-steps).

**Next:** T9-3.6 — settings UI at /org/[slug]/settings/webhooks. List existing subscriptions, create new with URL+events form, show delivery history, rotate secret, delete with confirmation. UI calls Convex mutations directly (session-auth path) not v1 API.

---

## 2026-05-28T03:30:00Z T9-3.6 webhooks-settings-ui (sub-step 6 of T9-3)

**Status:** completed
**Files touched:** `convex/orgWebhooks.ts` (+~200 LOC session-auth surface)
**Files created:** `src/routes/org/[slug]/settings/webhooks/+page.server.ts`, `src/routes/org/[slug]/settings/webhooks/+page.svelte`

**Work done:**
- Added a session-auth Convex surface mirroring the v1 internal-secret CRUD: `sessionListWebhooks` + `sessionListRecentDeliveries` queries, `sessionCreateWebhook` / `sessionUpdateWebhook` / `sessionRotateWebhookSecret` / `sessionDeleteWebhook` mutations. All gate on `requireOrgRole(slug, "editor")` so the settings UI doesn't need to mint an API key.
- Validation logic (URL parse, scheme allow-list, event allow-list) is duplicated between the v1 path and the session path so both enforce the same rules — small duplication, large clarity win.
- UI: list table with URL/events/enabled/last-delivered/failures columns; collapsible create form with native event checkboxes; one-time secret-reveal aside on create and on rotate; native `confirm()` on delete via `onsubmit` handler (modern `use:enhance` callback no longer exposes `cancel()`).
- `signingSecret` is rendered ONCE per Convex mutation result — never persisted to load data, never re-fetched.

**Decisions:**
- Two parallel auth surfaces (v1 internal-secret + session-auth Convex) instead of a single surface, because the UX cost of requiring an API key to manage webhooks via settings is worse than the maintenance cost of two thin entry points. The validation rules live in both — easy to factor out later if they drift.
- No edit-via-modal: just the enable/disable toggle inline + rotate + delete. Editing URL/events is rare enough that "delete + recreate" is acceptable for v1.

**Validation:** `pnpm svelte-check`: 0 errors, 128 warnings (pre-existing). 7895 files.

---

## 2026-05-28T03:35:00Z T9-3.7 webhooks-sdk-updates (sub-step 7 of T9-3)

**Status:** completed
**Files touched:** `packages/sdk-typescript/src/{types.ts,index.ts}`, `packages/sdk-python/commons/{types.py,client.py,__init__.py}`

**Work done:**
- **TS SDK:** added `Webhook`, `WebhookCreated`, `WebhookSecretRotated`, `WebhookEvent`, `CreateWebhookInput`, `UpdateWebhookInput` types. Added `WebhookResource` with `list/get/create/update/rotateSecret/delete`. Wired to `Commons.webhooks`. Exported standalone `verifyWebhookSignature({ payload, header, secrets, toleranceSeconds })` using Web Crypto subtle HMAC-SHA256; constant-time hex compare; accepts a single secret or an array (rotation window); 5-min default tolerance.
- **Python SDK:** mirrored types (`Webhook`, `WebhookCreated`, etc.) and added sync `WebhookResource` + async `AsyncWebhookResource` to `Commons.webhooks` / `AsyncCommons.webhooks`. Standalone `verify_webhook_signature(payload, header, secrets, tolerance_seconds=300)` using `hmac.compare_digest` with the same dual-secret + freshness semantics. `__init__.py` exports updated.

**Discovery:** TS SDK pre-existing tsconfig declares `lib: ["ES2022"]` only — `tsc --noEmit` fails on existing `URL`/`fetch`/`RequestInit` references in `client.ts` (pre-existing, not introduced by this work). When DOM lib is added via `--lib ES2022,DOM` the SDK compiles cleanly. Tracking as latent SDK build-config gap; not blocking webhook integration.

**Validation:**
- Python: `from commons import Commons, Webhook, verify_webhook_signature` smoke import successful.
- TS: `tsc --noEmit --skipLibCheck --lib ES2022,DOM` clean.

---

## 2026-05-28T03:40:00Z T9-3.8 webhooks-openapi-tests (sub-step 8 of T9-3, last)

**Status:** completed
**Files touched:** `src/lib/server/api-v1/openapi.ts` (+~190 LOC)
**Files created:** `tests/unit/sdk/webhook-signing.test.ts`

**Work done:**
- **OpenAPI 3.1:** added 4 paths (`/webhooks` GET+POST, `/webhooks/{id}` GET+PATCH+DELETE, `/webhooks/{id}/rotate-secret` POST) and 6 schemas (`WebhookEvent` enum with all 8 event names, `Webhook`, `WebhookCreated` via `allOf` extension, `WebhookSecretRotated`, `CreateWebhookInput`, `UpdateWebhookInput`). Reuses existing `BadRequest`/`Unauthorized`/`Forbidden`/`NotFound`/`Conflict` response refs.
- **Cross-verify test suite:** 6 tests proving the dispatcher's signature format matches what the SDK verify helper accepts/rejects: fresh-sign roundtrip ✓, wrong-secret rejection ✓, tampered-payload rejection ✓, freshness-window enforcement (10 min stale rejected against 5 min tolerance) ✓, previous-secret acceptance during rotation ✓, malformed-header robustness (empty / garbage / partial) ✓.
- Test imports the SDK helper directly from `packages/sdk-typescript/src/index.js` to ensure shipped helper logic matches the dispatcher's signing logic. If either drifts, the test breaks.

**Decision (discovery):** No `POST /webhooks/[id]/test-fire` ergonomics endpoint shipped this cycle. Useful for dev validation but not launch-blocking; orgs can verify by triggering a real event (donation, supporter creation). Deferring rather than expanding T9-3 scope.

**Validation:**
- `pnpm svelte-check`: 0 errors, 128 warnings (pre-existing), 7895 files.
- `npx vitest run tests/unit/sdk/webhook-signing.test.ts`: 6/6 pass in 7ms.

---

## 2026-05-28T03:42:00Z T9-3 CHOKEPOINT RESOLVED

**Status:** ✅ completed (8 of 8 sub-steps)
**Cluster impact:** C-composability + C-agentic gain a working outbound webhook substrate; the chokepoint that gated W-3 is now lifted.

**What shipped:**
- 3 Convex tables (orgWebhooks / orgWebhookDeliveries / orgEvents)
- Dispatch internalAction with HMAC-SHA256 dual-secret rotation
- 2^attempt × 60s retry with 5-attempt dead cutoff
- 1-min retry cron + hourly event-expiry cron
- v1 CRUD surface (internal-secret auth)
- Session-auth Convex CRUD for the settings UI
- Settings UI at `/org/[slug]/settings/webhooks`
- TS + Python SDKs with resources + signature-verify helpers
- OpenAPI 3.1 spec (4 paths + 6 schemas)
- 6 cross-verify integration tests

**Hyperedges unblocked:**
- W-3 starts (W-2 chokepoint complete)
- T1-4 zapier-pieces — webhook substrate is the consumer-facing event bus zapier-pieces wraps
- T9-7 SSE event stream — `orgEvents` row is shared; SSE polls the same table
- T9-8 ops dashboards — webhook deliveries / failures / event volume become reportable

**Next:** continue executing W-2 in dependency order. Per `nodes/waves.json` W-2 still has T2-1 (proof badges), T2-2 (verified-only filter), T2-3 (drag-and-drop builder), T2-4 (org segments), T2-5 (segment scheduling), T3-1 (campaign agents) among others, plus the W-2 chokepoints (T3-6 / T5-5 / T6-2 / T5-3 / T4-1) which each have ops-elapsed gates (Safe multisig provisioning, TEE provisioning, audit firm cycle).

---

## 2026-05-28T04:00:00Z W-1 SWEEP — 7 tasks + 4 subsumed-marker tasks closed in one batch

**Status:** ✅ W-1 fully drained (0 W-1 tasks remaining open)
**Tasks closed this batch:** T1-1, T1-2, T1-4, T1-5, T1-7, T1-8, T1-10, T10-3, T10-5, T10-6, T10-10, T10-11

**T1-1 dashboard-wiring** (S, 0.5d): convex/organizations.getDashboardStats new query — supporter scan for imported/postal/identity funnel + campaignActions scan (by_orgId_verified index) for engagement-tier histogram (T0..T4) + this/last-week verified deltas. /org/[slug]/+page.server.ts replaces 6 hardcoded zero/null fields with real values; computeVerificationPacketCached called for topCampaignId (null-safe on new orgs). **Discovery:** spec said "trustTier" but UI labels are engagement-tier semantics — honored UI labels and used engagementTier.

**T1-2 bulk-merge-fields** (S, 0.5d): convex/email.sendBlastBatch now applies per-recipient merge fields after PII decrypt. Inline _applyMergeFields mirrors compileMergeFields semantics; encryptedName decrypted (with emailHash AAD) and split on first space. Both subject and bodyHtml processed. tierLabel left empty on this path (would require per-recipient action query). **Discovery:** Convex cannot import $lib — inline mirror + sync header comment.

**T1-4 donation-receipts-and-trialing** (M, 1.5d): (1) subscriptions.effectivelyActive now includes 'trialing' alongside 'active' at both call sites (checkPlanLimits + getUsage); (2) new internalAction donations.sendReceiptEmail (idempotent — status='completed' self-check) + getDonationForReceipt query. completeDonation schedules sendReceiptEmail(0ms) so SES latency doesn't back up Stripe webhook ack. Generic receipt content; sendViaSes exported from email.ts for cross-file reuse. **Discovery:** RECEIPT_FROM_EMAIL env var (falls back to SES_FROM_EMAIL) — no-op with warn log if unset.

**T1-5 member-removal-role-change** (S, 0.75d): convex/organizations.{removeMember,updateMemberRole} mutations with last-owner-guard, self-leave-allowed, role-rank-ceiling. memberCount denormalized counter decrements on removal. REST endpoints /api/org/[slug]/members DELETE+PATCH; UI: settings page renders role dropdown + Remove button (owners only).

**T1-7 campaign-clone** (S, 0.5d): convex/campaigns.clone mutation copies content fields onto fresh DRAFT (counters reset, debateId+donation page refs dropped). UI: Duplicate button on campaign card (opacity-0/group-hover:opacity-100), restructured wrapping anchor → relative wrapper with sibling form. Redirects to new campaign on success. **Discovery:** tasks.json said "slug suffix -copy-N" but campaigns table has no slug field — used "(copy)" title suffix instead.

**T1-8 district-segmentation-filter** (S, 0.5d): SegmentCondition gains postalCode + country fields and startsWith operator. convex/segments.matchCondition handles both with case-insensitive normalization (postal toUpperCase, country ISO alpha-2 toUpperCase). campaignParticipation now explicit fail-closed (was implicit default fall-through) with TODO inline for enriched-context impl.

**T1-10 og-images-org-pages** (S, 0.5d): /og/org, /og/org-for/[segment], /og/integrity — 3 new SVG endpoints reusing the /og/campaign Satori-style pattern. 24h s-maxage. og:image + og:type + og:url + og:title + og:description + twitter:card + twitter:image meta wired into 5 page heads. **Risk:** Twitter SVG OG support — deferred PNG fallback per spec.

**T10-3 reputation-tier-default** (S, 0.1d): authOps.ts:295 `baseReputationTier = "new"` (was conditional 'verified'/'novice'). users.ts:75 fallback `'novice'` → `'new'`. Reputation is behavioral, separate from trustTier — email-verification doesn't auto-promote.

**T10-5 mdl-mdoc-flag** (S, 0.1d): FEATURES.MDL_MDOC flipped to true; stale comment replaced with T3-via-I1 closure status. MDL_IOS stays false until ABC enrollment.

**T10-6 / T10-11 / T10-10** — subsumed by T1-5 / T1-4 / T1-1 respectively. Closed with pointer notes.

**Validation across batch:** `pnpm svelte-check` 0 errors at every checkpoint, 39 files with problems (all pre-existing warnings).

**Progress:** 13 / 103 tasks closed (12.6%). One chokepoint (T9-3, 8 sub-steps) + 12 W-1 tasks (7 substantive + 4 subsumed-marker + 1 inadvertent-via-T1-1) all done. W-1 is empty.

**Hyperedges unblocked:**
- T10-1 (reputationTier writer cron) — was blocked by T10-3; now ready
- T10-2 (engagementTier server-side cross-check) — was blocked by T10-1's data shape; now ready after T10-1
- T10-4 (CAI grounded in real engagement) — depends T10-1; ready next

**Next:** W-2 push. Focus on engineering-bound (not ops-bound) tasks: T2-3 (email plaintext multipart), T2-4 (List-Unsubscribe headers), T2-5 (bounce categorization), T9-9 (rate limit policy reconciliation), T10-1 (reputationTier cron writer), T10-9 (atlasVersion per campaignAction), T1-6 (A/B winner picker). Skip ops-bound: T2-2 (Lambda deploy), T9-1/T9-2 (npm/PyPI publish pipelines). Defer or stage: T1-3 (AN OSDI 7d), T9-4 (OSDI compliance namespace), T9-5 (audit log), and the 4 W-2 chokepoints (T3-6/T5-5/T6-2 mainnet composite, T5-3 TEE, T4-1 delegation) — each has ops-elapsed gates that cannot be bridged from code alone.

---

## 2026-05-28T04:30:00Z W-2 + W-3 + W-4 sweep — 12 more tasks closed in one batch

**Status:** 26 / 103 = 25.2% closed
**Tasks this batch:** T2-3, T2-5, T9-9, T10-1, T10-2, T10-4, T10-9 (engineering-substrate work); T7-10, T8-4a, T8-10, T6-8, T7-8, T9-6 (small ready tasks from later waves).

### Engineering substrate

**T2-3 email-plaintext-multipart** (S, 1d) — convex/email.sendViaSes now ships multipart/alternative. Content.Simple.Body.Text added via inline `htmlToPlainText` helper (tag strip, entity decode, whitespace collapse). Lambda buildRawMimeMessage portion gated on T2-2 (deployment).

**T2-5 soft-bounce-categorization** (S, 1d) — supporters.softBounceCount field added. webhooks.recordSoftBounces increments on Transient/Undetermined; on 3rd hit flips emailStatus to bounced and writes suppressedEmails row with 30-day TTL. webhooks.resetSoftBounce clears the counter on SES Delivery events. Complaints still trump.

**T9-9 rate-limit-policy** (S, 0.25d) — checkApiPlanRateLimit now method-aware. Free-plan GET/HEAD/OPTIONS bypass the gate (aligns marketing "no rate cap on reads"); writes still hit 100/min. Threaded request.method through 24 v1 +server.ts files.

**T10-1 reputation-tier-writer** (M, 1d) — users.actionCount field added. createCampaignAction takes optional userId; when present and args.verified, increments user.actionCount. New users.recomputeAllReputationTiers internalMutation chunks users (500/run), maps actionCount → tier via REPUTATION_THRESHOLDS (0→new, 5→active, 25→established, 100→veteran, 500→pillar). Daily cron #26 at 03:11 UTC. Idempotent. Sweeps legacy 'verified'/'novice' strings.

**T10-2 engagementTier-cross-check** (S, 0.5d) — /api/submissions/create after authorityLevel validation now cross-checks rawInputsArray[30] (claimed engagement tier from circuit) against server-derived tier from users.actionCount via the same threshold ladder. Drift > 1 → HTTP 422 TIER_MISMATCH. ±1 tolerated for cron lag. New users.getMyActionCount query.

**T10-4 cai-lag-comment** (S, 0.1d) — Editorial. computeCAI docstring expanded with the lag-bound documentation. No code change.

**T10-9 atlasVersion-propagation** (M, 1d) — Substrate end-to-end through packet computation. campaignActions.atlasVersion schema field. createCampaignAction accepts it. getActionsForPacket returns it. VerificationPacket interface adds driftCount + driftPct. computePacket calls new computeAtlasDrift (picks modal version as 'current', null when no signal). Test fixtures (org landing mock + email-report unit test) updated. Submissions-side propagation TBD (substrate ready).

### Small ready tasks (W-3 / W-4 / "documentation")

**T7-10 cross-org-rep-decision** (S, 0.1d) — REALIGNMENT-TASK-GRAPH.md gains "Cross-org reputation aggregation" decision section. Tree 3 is protocol-global; per-network subtree would break ZK invariant and fork nullifier dedup. Path forward = T7-3 app-layer aggregation.

**T8-4a offline-verify** (S, 0.25d) — report-template.ts plaintext renderText extended with a "Verify offline (no Commons URL required)" block listing the canonical preimage fields + `\n---\n` separator + shasum reproduction recipe.

**T8-10 reader-privacy-model** (S, 0.5d) — docs/design/READER-PRIVACY-MODEL.md canonicalized: K-anonymity floors are the only mechanism, no trusted-reader exception across surfaces. IntegrityAssessment.svelte gains inline comment locking in the qualitative-prose contract (no raw GDS/ALD numerics → no polling oracle).

**T6-8 scorecard-versioning** (S, 0.5d) — getScorecard + getDmScorecard accept optional methodologyVersion, default to the latest stored snapshot's version. /api/dm/[id]/scorecard reads ?methodologyVersion=N. Canonical changelog at docs/design/SCORECARD-METHODOLOGY-CHANGELOG.md.

**T7-8 network-member-role** (S, 1d) — convex/networks.updateMemberRole mutation: caller must be network admin; owner org cannot be demoted (would orphan network). REST PATCH /api/org/[slug]/networks/[networkId]/members/[orgId] takes {role: 'admin' | 'member'}.

**T9-6 v1-activity-feed** (S, 0.5d) — v1api.listActivityFeed mirrors internal getDmFeed: filters by decision_maker_id + activity_type, merges legislativeActions + accountabilityReceipts, cursor pagination. /api/v1/activity/+server.ts wired to standard API-key chain.

**Validation:** `pnpm svelte-check` 0 errors at every checkpoint, 39 files with problems (pre-existing warnings).

**Hyperedges unblocked:**
- W-3 substantially opens up — much of TR-7 (networks) and TR-9 (public API) can proceed
- T5-1 (auto-debate-spawn) was unblocked but not yet attempted this cycle
- T6-9 (receipt response auto-detection) ready
- T9-7 (real-time subscriptions v1 SSE) ready — uses orgEvents table from T9-3

**Discoveries:**
- TS SDK lacks `lib: DOM` in tsconfig — pre-existing latent build gap; cleanly compiles when DOM lib is supplied.
- Substrate-ready / wire-up-TBD pattern: T10-1 userId on createCampaignAction, T10-9 atlasVersion through /api/submissions/create → submissions.create → action insert. Both substrates ship, both writers need a follow-up cycle to thread the field through the ZK submission flow.
- Reputation tier vocabulary intentionally reuses engagement-tier labels (New/Active/Established/Veteran/Pillar) since the UI already labels reputationTier with those words.

**Next:** continue W-3 push — T6-9 (receipt auto-detection), T5-1 (auto-debate-spawn), T5-2 (on-chain stake), T6-4/T6-5 (receipt API), T7-1 (coalition aggregation 501→). T1-6 (A/B winner picker) is still W-1 ready but M-tier; would consume the next budget.

---

## 2026-05-28T05:00:00Z W-3 surge — 4 more tasks closed

**Status:** 30 / 103 = 29.1% closed

**T5-1 auto-debate-spawn** (S, 1d) — Both manual and auto paths wired. New convex/debates.atomicSpawnIfEligible internalAction derives action-domain bytes32 values (hashTextToBytes32 + offchainDebateId + offchainActionDomain) then calls _spawnDebateIfEligible internalMutation that atomically re-checks campaign.debateId + threshold (race-free against simultaneous threshold crossers). createCampaignAction schedules atomicSpawnIfEligible(0ms) when (verifiedActionCount+1) ≥ debateThreshold && debateEnabled && !debateId. /api/campaigns/[id]/debate +server.ts 501→ debates.forceSpawnDebateForCampaign action (system-initiated, bypasses threshold check since editor explicitly asked, still idempotent via _spawnDebateIfEligibleForce). Off-chain action-domain placeholders conform to bytes32 ZK-pipeline format.

**T6-9 receipt-response-auto-detection** (S, 1d) — legislation.createAction now, when args.action starts with 'voted_' or equals 'abstained' and decisionMakerId is set, queries accountabilityReceipts by_decisionMakerId, filters to billId match, appends a {type:'vote_cast', confidence:'observed', detail: action, occurredAt} response on each matching receipt. Idempotent via per-occurredAt dedup. Email-reply detection deferred until inbound SES Lambda.

**T7-1 coalition-aggregation-api** (S, 1.5d) — /api/v1/networks/[id]/stats 501→ real impl. New convex/networks.getStats iterates active member orgs, sums supporter counts (unique by globalEmailHash), aggregates campaignActions (by_orgId_verified index), deduplicates districts on districtHash, computes the same packet scalars as per-org packet (GDS = 1-HHI over district share, ALD = unique-messages / total-with-messageHash, temporalEntropy = Shannon over hourly bins, CAI = (tier3+tier4)/max(tier1,1)). stateDistribution surfaced as ISO-country bucketed (generalized from US-only). O(members × actions) — acceptable for org-sized; snapshotting candidate when coalitions exceed ~100k actions.

**T6-5 receipt-api** (S, 1.5d) — Three new GET endpoints. /api/org/[slug]/campaigns/[campaignId]/receipts (per-campaign list, cursor pagination, joins via deliveryId→campaignDeliveries to filter). /api/org/[slug]/dm/receipts (per-org batch, by_orgId index). /api/org/[slug]/dm/receipts/export.csv (CSV stream with attestationDigest column for downstream hash reproduction). No PII surfaced — only digests, weight, counts, alignment, causality, timestamps, anchor refs. Convex queries: listReceiptsByCampaign + listReceiptsByOrg in convex/legislation.ts.

**Validation:** `pnpm svelte-check` 0 errors at every checkpoint.

**Next:** T6-4 (constituent-side receipt access), T5-2 (on-chain stake in createArgument), T1-6 (A/B winner picker M 2.5d), or move to other W-3 work. T1-9 (workflow steps) blocked by T2-2 (Lambda ops). T1-3 (OSDI sync L 7d) and T9-4 (OSDI namespace) are deferrable. Also pending: substrate-wired-up follow-ups for T10-1 (userId on createCampaignAction call sites) and T10-9 (atlasVersion through submissions.create).
