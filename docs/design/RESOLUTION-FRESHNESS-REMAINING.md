# Resolution + Freshness — Remaining Work Ledger

Living tracker for the address→district resolution + freshness arc (keyed API,
provenance return, portable metering, freshness activation). Two axes: **operator**
(ops/provisioning a human must do) and **implementation** (code still to build).
Grounded against the code on branches `p0-resolution-build` (commons) and
`p0-freshness-producers` (voter-protocol). Honest framing: this is auditability +
activation, **not** fresher-than-Cicero — provenance ≠ recency.

Check items off as they land; keep the WHERE anchors current.

**Companion:** `docs/design/NOOP-MAP.md` — the exhaustive flip-lever map of everything
still no-op (R0 commit/deploy → A publish → B convex+env ordering → C cron → D Stripe
sequencing footguns → E schedules → F/G/H deliberate noops), with the minimal cascade
and the honest integrator-surface-today. Grounded 2026-07-03.

## Shippability-gaps sweep — CLOSED (brutalist assessment → 9-node hypergraph)

The 12-finding shippability assessment (both brutalist passes) is closed on the
implementation side. Landed: G1 effective-plan gate (canceled/past-due orgs floor to
inactive via `effectivePlanWithGrace`; anti-revert source test); G2 officials clock
reads the real officials DB (`--officials-db` + workflow download; fixture-masking
fixed); G3+G3b provenance clocks captured at issuance AND threaded through the mDL
flows into all ThreeTree requests (SessionCredential lane has a real producer now);
G4 drain hardening (allSettled per-record, poison rows skipped, `getUsageForPeriod`
secret-gated); G5 `AtlasInfraError` (infra ≠ billable coverage miss) + `place_rank`
confidence via `format=jsonv2`; G6 redraw guard full-ISO conservative compare; G7
endpoint contract (infra→502 unbilled, payload-bound injective Idempotency-Key,
CA→400, typed auth outage, OpenAPI matches the handler).
Deferred by design: 24-slot multi-district (capability build; contract honest today);
quota TOCTOU (bounded soft-overshoot); cwc_code null (trivial). Known caveat: Convex
drain-side unit tests are honest disclosed mirrors (`convex-test` not wired).

## Operator axis (ops — human only)

- [ ] **Operator-dispatch the quarterly Shadow Atlas publish** — BLOCKER, the only freshness path.
  Run `Shadow Atlas Quarterly Update` via `workflow_dispatch` with a real `tiger_vintage` (TIGER20YY), operator-pasted `expected_manifest_sha256`, and the Ed25519 trust-pin set.
  WHERE: `voter-protocol/.github/workflows/shadow-atlas-quarterly.yml` (inputs ~L16-67); needs provisioned R2 keys + `CLOUDFLARE_ACCOUNT_ID`, `MANIFEST_SIGNING_PUBLIC_KEY`, `CLOUDFLARE_API_TOKEN` + `COMMONS_DEPLOY_TOKEN`, `DEPLOYER_PRIVATE_KEY` + `SCROLL_RPC_URL` + `SNAPSHOT_ANCHOR_ADDRESS`.
  WHY: only path that republishes fresh boundaries/officials to R2 + anchors on-chain. `officialsAsOf`/`boundaryAsOf` stay `null` until a republish. A `schedule` event leaves inputs empty → vintage `'unknown'` → throws (fail-closed by design). Fix the FRESH-A2 argv guard (impl) first.

- [ ] **`convex deploy` the new schema + metering functions to prod** — BLOCKER, metering 500s without it.
  WHERE: `commons/convex/schema.ts` (`usageRecords` table + 4 indexes; `districtCredentials` provenance fields) + `commons/convex/metering.ts` (`recordUsage`/`getUsageForPeriod`/`drainUsageToProvider`).
  WHY: `recordUsage` (`resolve-address/+server.ts:110`) writes a table that does not exist on prod until deployed → the whole `/api/v1/resolve-address` metering path is broken in prod. Gated behind the env fix below.

- [ ] **Disambiguate the local Convex env contradiction** — enabler, gates the deploy from this machine.
  WHERE: `commons/.env.local` — both `CONVEX_SELF_HOSTED_URL`/`CONVEX_SELF_HOSTED_ADMIN_KEY` AND `CONVEX_DEPLOYMENT` set; the CLI refuses both → blocks `convex codegen`/`deploy`. Local-dev hygiene, not a prod-runtime issue.

- [ ] **Flip `CRON_PROFILE` → `operational` on prod Convex + redeploy** — BLOCKER, the drain never registers otherwise.
  WHERE: `commons/convex/crons.ts` (`drain-usage` gated `if (enabled("operational"))`; prod frozen at `'essential'`). Cron passes `_secret: INTERNAL_API_SECRET` — that secret must match on prod Convex. Do AFTER the deploy (table must exist before drain runs).

- [ ] **Provision Stripe account/keys when metering goes live** — posture-gated: do NOT provision until a paying metering customer closes.
  WHERE: `commons/src/lib/server/billing/providers/`. Necessary-but-insufficient — the Convex drain's Stripe branch is unimplemented (see impl "Wire Stripe drain branch"). Sequence: land the code, then flip `BILLING_PROVIDER=stripe`.

- [ ] **Enable the quarterly `schedule:` trigger on the default branch** — LOW, alarm/reminder only.
  WHERE: same workflow file (`schedule: - cron: '0 2 1 1,4,7,10 *'`). GitHub registers scheduled workflows only from the default branch; auto-disables after 60d inactivity. A scheduled run only fails loud ("time to republish"); value is purely the reminder.

- [ ] **Schedule `check-changes.ts`** — LOW/latent, needs a durable-DB decision.
  WHERE: `voter-protocol/packages/shadow-atlas/src/scripts/check-changes.ts` (no invoker in `.github/`). Detector is real but never fires autonomously. Durable checksum-DB location is the cost-posture blocker (CI SQLite is ephemeral).

- [ ] **Provision a real `REDRAW_SIGNAL` feed source** — LOW / by-design-manual.
  WHERE: `commons/src/lib/core/shadow-atlas/redraw-guard.ts` (6 hand-curated states; no feed/cron wired). Mid-cycle redraws beyond the 6 coded states go undetected.

Operator-adjacent (not launch blockers): `INTERNAL_API_SECRET` must match on CF Pages + prod Convex (unverified against live prod env); orgs need issued `apiKeys` rows to call the resolve API (customer onboarding).

## Implementation axis (code)

The implementation axis is **closed** (built + adversarially reviewed + integrated-reviewed; all green). What remains is operator/posture-gated (above) and the two deferred design-gated pieces noted below.

- [x] **Stripe drain branch (+ org→customer mapping)** — CODE done. `drainUsageToProvider` selects via `getBillingProvider()`; mapping uses the stored `organizations.stripeCustomerId` (not orgId); Noop stays default; drain skips `noop:` ids when stripe is expected (fail-closed, no silent under-bill). Provisioning + `BILLING_PROVIDER=stripe` flips remain operator/posture-gated (above).
- [x] **Broaden `getAllCanonicalSources` for congressional/TIGER detection** — done. Congressional/TIGER source path + per-type `updateTriggers`; checksums persist via the event store (`getEventsByRun` reads newest-first, so the latest survives >LIMIT churn).
- [~] **`REDRAW_SIGNAL`** — PARTIAL by design. Externalized to `redraw-signal.data.ts` (per-row `{stateFips, effectiveDate, source}`) + loader + a pluggable-source seam. A live ingestion FEED is deferred (depends on an external litigation/enacted-plan source choice + cost posture).
- [x] **`check-changes.ts` scheduler seam** — done. Scheduled Action (`shadow-atlas-change-check.yml`) runs `changes:check`; durable checksums via R2 (get-before/put-after); fresh-DB bootstrap fixed (`createSQLiteAdapter` inits schema). Turning the schedule ON stays operator-gated (above).
- [x] **`build-chunked-mapping.ts` argv guard** — done (`resolveOutputDir` ignores leading-`--`).
- [x] **Both resolve-endpoint error-envelope nits** — done (typed `METERING_UNAVAILABLE`; metering-write failure distinguished, fail-closed).

**Found + fixed during the integrated review (was NOT in the original ledger):**
- [x] **Quota gate capped paid orgs at ~16k** (HIGH, was launch-blocking): `USAGE_SCAN_CAP` saturated the count → 402 at 16k regardless of the 25k/150k/500k allowance. Fixed with an O(1) `usagePeriodTotals` counter (atomic with the ledger insert, dedup-safe). Paid orgs now get their full allowance.

Confirmed DONE: B1 officials-clock read; A2 officials producer stamp; B3 `/v/[hash]` provenance + credential persistence.

**Known non-blocking caveats (not yet addressed):** the quota gate read/write is not atomic across the two Convex calls → bounded soft-overshoot at the allowance boundary under concurrency (pre-existing; acceptable for a soft over-bill guard). The `by_requestId` resolve idempotency is dead code for the live caller (fresh UUID per attempt) → a narrow double-bill window on post-commit transport drop + client retry; making it real needs a client-supplied idempotency key (contract decision).

## Sequencing

**Critical path → "freshness serves fresh data in prod" (2):**
1. Land the FRESH-A2 argv guard (impl, tiny).
2. Operator-dispatch the quarterly publish with real vintage + SHA + trust pins (provisioned R2/Ed25519/Scroll secrets). The single load-bearing act — it flips `officialsAsOf`/`boundaryAsOf` from `null` to real. The `schedule:` trigger, `check-changes` scheduler, and `REDRAW_SIGNAL` feed are alarming/automation, NOT on this path.

**Critical path → "metering bills a real customer" (3):**
1. Disambiguate the local Convex env (ops, tiny) — gates the deploy.
2. `convex deploy` the schema + `metering.ts` to prod — without `usageRecords`, `recordUsage` 500s.
3. Wire the Stripe drain branch + org→customer mapping (impl, medium). Then the flip-switches: `CRON_PROFILE→operational` + redeploy, and Stripe provisioning — per bootstrapping posture, only once a paying metering customer closes.

The two P0 error-labeling nits are cheap and live on the metering route but only misbehave during a Convex outage — fix alongside the Stripe wiring, not ahead of the load-bearing deploy.
