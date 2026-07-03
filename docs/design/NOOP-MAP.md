# EXHAUSTIVE NOOP MAP — resolution / freshness / metering arc
Organized by flip-lever: "if I do X, these N things go live." Verified inventory 2026-07-03; prod = CF Pages `production` + Convex quirky-chinchilla-352, running pre-arc code.

**R0 — COMMIT + MERGE + DEPLOY (root lever; nothing below is reachable without it).** Both repos (commons `p0-resolution-build`, voter-protocol `p0-freshness-producers`) have ZERO commits ahead of main — the whole arc is working-tree only (~55 files commons, ~10 voter-protocol). Today: prod `/api/v1/resolve-address` is a plain 404; no metering functions/tables exist. Forgotten: machine loss erases the arc; every lever below is dead.

## A — Operator publish-dispatch (quarterly `shadow-atlas-quarterly.yml` with real vintage + trust pins) — 3 things go live
- **A1. Two freshness clocks + redraw guard.** Live manifest (v20260512) has no `tigerVintage`/`officialsGenerated` → `redraw-guard.ts:99-104` clamps 100% of resolutions to 0.4 confidence with "boundary vintage unknown"; redraw branch (`:132-146`) and the 6-state REDRAW_SIGNAL seed are unreachable. Producer stamps exist uncommitted (`build-chunked-mapping.ts:267-272, 285, 844`). Forgotten: the paid API's headline feature ships as a permanent 40%-confidence warning on perfect resolves; /v/[hash] renders a bare "Match confidence 40%".
- **A2. Officials clock freshness.** `readOfficialsGenerated` (`build-chunked-mapping.ts:216-245`) reads live officials.db whose only success row is 2026-02-26 — first publish honestly stamps a 4-month-stale clock unless `ingest-legislators` → `publish:source --tiger-vintage` (required non-dry-run, `publish-source.ts:571`) runs pre-dispatch. Forgotten: "fresh clocks" debut showing 4-month-old officials.
- **A3. Post-dispatch env ritual (recurring, not an outage today).** Bump path-pinned `ATLAS_BASE_URL` (`/vYYYYMMDD`) + re-pin `EXPECTED_CELL_MAP_ROOT/DEPTH` each release; prod currently healthy (`rootPinned/depthPinned: true`). Forgotten: republishing changes nothing — clients stay pinned to the old path.

## B — Convex deploy + env — 5 things (incl. the most dangerous ordering on the board)
- **B1. Metering functions + `usageRecords`/`usagePeriodTotals` tables.** Not on prod Convex; route-first ship → typed 502 `METERING_UNAVAILABLE` (`+server.ts:135`) on every resolve. Fail-closed — never silent free resolves. Flip: `npx convex deploy --env-file` after B2.
- **B2. Deploy CLI unblocked.** `.env.local` sets both `CONVEX_SELF_HOSTED_*` and `CONVEX_DEPLOYMENT` — comment out one family or no cloud deploy happens at all.
- **B3. ORDERING CONSTRAINT: Convex deploy MUST precede the CF Pages code deploy.** New code sends 4 provenance keys unconditionally (`ground-service.ts:224-227`); old prod `verifyAddress` validators reject unknown args (`users.ts:624-627`, `schema.ts:888-891` uncommitted). Ship-code-first bricks ALL address verification with 500s — fail-loud, total.
- **B4. `INTERNAL_API_SECRET` before the C1 redeploy.** `crons.ts:573` serializes `process.env.INTERNAL_API_SECRET ?? ""` at push time — deploy-while-unset freezes `""` into the cron arm; every tick throws Unauthorized (Convex-log-only) until the NEXT deploy. Must match CF Pages, ≥32 bytes. Prod presence unverified.
- **B5. `PUBLIC_BASE_URL` per deployment.** Stripe drain branch hardcodes `https://commons.email` as default (`metering.ts:286`) — a stripe-flipped non-prod Convex POSTs prod's report-usage with the wrong secret (403 loop; fail-closed but cross-env).

## C — CRON_PROFILE flip (prod Convex env + redeploy; profile is deploy-frozen) — 1 thing
- **C1. `drain-usage` cron registers.** `crons.ts:568-575` gated `enabled("operational")`; prod frozen `essential` (PR #56). Today rows accumulate `reportedToProvider: undefined` forever; quota gate UNAFFECTED (counter written in-transaction at record time, `metering.ts:90-99`). Flip `CRON_PROFILE=operational` + redeploy — AFTER B1/B4, NEVER before D1 (see D2). Backlog drains 500/15min. Joins the existing launch-flip obligation (cron-profile tiering).

## D — Stripe provisioning at customer-close (posture-correct: nothing here is a defect pre-customer) — 7 things
- **D1. `BILLING_PROVIDER` noop on BOTH sides** (`providers/index.ts:16-21` Pages; `metering.ts:374-375` Convex). Flip both atomically; verify with one drain tick's `{provider, reported}` return.
- **D2. THE SEQUENCING FOOTGUN: noop drain permanently consumes rows.** Noop stamps `reportedToProvider:true, providerEventId:'noop:…'` (`metering.ts:392, :242`); drain selects only `undefined` (`:207`). C1-flipped-while-D1-noop makes all accumulated usage unbillable forever — silent revenue write-off, no error anywhere.
- **D3. Desync guard is one-directional.** Stripe drain rejects `noop:` ids (`metering.ts:337`) — but Convex=noop/Pages=stripe half-flip takes the inline noop path and stamps rows without calling the endpoint: same permanent loss, looks correct from the Pages side.
- **D4. Stripe Meter objects unprovisioned.** `stripe-adapter.ts:31-32` presumes dashboard Meters named `resolve_address` etc.; nothing creates them. Flip without Meters → every create rejects, rows stay unreported, infinite retry, console-only signal. Provision Meters + `STRIPE_SECRET_KEY` with D1.
- **D5. `POST /api/internal/billing/report-usage` triple-gated** (undeployed × cron unregistered × noop). Correct seam, fail-closed (typed 502 `REPORT_FAILED` stamps nothing). No standalone action — inherits R0/C1/D1.
- **D6. Trial/inactive orgs unbillable-by-design** (drain drops customer-less rows via `requireStripeCustomer`, `metering.ts:223`) — correct, but 500+ consecutive unbillable rows at the index head starve billable rows per batch tick, no alert (`metering.ts:191-196`). Revisit at trial volume.
- **D7. Metered overage bills $0 even fully flipped** — no metered Price exists anywhere (`plans.ts` flat `stripePriceId` only; checkout sends one flat line_item). Explicit policy: hard 402 at quota IS the monetization. If intent shifts: metered Prices + checkout line_item + subscription migration.

## E — Schedule enablement (GitHub; registers only from default branch, so gated on R0) — 2 things
- **E1. Quarterly cron is an ALARM, never a publish.** `yml:76-77` (`0 2 1 1,4,7,10 *`); scheduled runs have empty inputs → `tiger_vintage='unknown'` → `tiger-vintage.ts:32` throws → deliberate red run meaning "republish now." Forgotten: red runs normalized as CI noise and the ONE staleness signal gets ignored; also GitHub auto-disables schedules after 60d repo inactivity.
- **E2. `shadow-atlas-change-check.yml` unreachable + R2-gated.** Untracked; R2 steps skip without secrets (`:77, :93`); durable DB `change-detection/shadow-atlas.db` can't exist yet — every run starts fresh and reports everything 'new' (meaningless signal). Flip: merge + confirm R2 repo secrets; first run seeds the DB.

## F — Design-deferred capability build (stays noop by decision — except F1)
- **F1. CRITICAL-PATH OUTLIER: no live geocoder.** `client.ts:1229` defaults `${SHADOW_ATLAS_URL}/nominatim`, `SHADOW_ATLAS_URL` = `localhost:3000` (`:43`); `NOMINATIM_URL` in no env doc; `shadow-atlas.commons.email` is NXDOMAIN. Every resolve — paid v1, person-layer, TEE gate-3 — 502s per-request as the mislabeled `RESOLVE_FAILED` (`+server.ts:228`), unbilled. All other levers flipped, the flagship endpoint is still 100% dead.
- **F2. Detection alerting sink missing.** `check-changes.ts:39-45` console.log + exit 0 on detections — a real TIGER redraw is visible only inside a green Actions log.
- **F3. Detection scope = exactly 2 congressional URLs** (`change-detector.ts:154-167`). "We have boundary change detection" must stay scoped to that.
- **F4. RedrawSignalSource is shape-only** — sole impl is 6 hand-curated states (`redraw-signal.data.ts`, through TX HB4 2025-08-29). Post-A1, a 7th-state mid-cycle redraw serves confidently-WRONG districts at full confidence — the exact failure the guard exists to prevent.
- **F5. Guard `warning` dropped on the person-layer path** — internal resolve returns clocks/confidence but not `warning`; `AddressVerificationFlow` issues a credential on confidence-0 with zero in-flow notice; only paid v1 surfaces it (`+server.ts:159`).
- **F6. No vintage cross-check** — quarterly stamps the chunked manifest solely from dispatch input; source-manifest stamp (`publish-source.ts:864`) is write-only. A wrong stamp (TIGER2024 over 2023 geometry) is WORSE than 'unknown': re-arms full confidence and mis-keys redraw comparison.
- **F7. 24-slot read path dead while the DATA is live** — `lookupAllDistricts`/`slotToDistrict` have zero runtime callers; live chunk populates 8 slots (2,401 cells); everything reads `slots[0]`. First future caller inherits a latent bug: missing `ContentNotFoundError→AtlasInfraError` classification.
- **F8. `districtConfidence` non-enacted rungs dead** (sole call argless, `client.ts:1367` → always 'enacted' 1.0); two parallel confidence ladders drift silently.
- **F9. `cwc_code: null` hardcoded on the IPFS officials path** (`client.ts:1036`) → `cwcEligible` always false via atlas; CWC never signaled here.
- **F10. Officials store is congressional-only** (438 districts / 1,302 officials). Resolve-API "officials" = federal-only; keep competitive claims scoped.
- **F11. `GET /api/v1/usage` omits the resolve meter entirely** despite 1k/25k/150k/500k plan caps — a resolve customer's first quota signal is the 402; billed usage invisible to the billed party.
- **F12. Resolve product undiscoverable** — `/developers` has zero resolve mentions; only public contract is the OpenAPI JSON (key issuance itself IS self-serve).
- **F13. OpenAPI drift ON THE PAID SURFACE** — spec advertises `provenance.authorityLevel` (typed string) + `dataVersion` (`openapi.ts:2062-2066`); producer emits only `{source, tigerVintage}` (`client.ts:1356-1358`); code types authorityLevel as number (`provenance.ts:21`). First paying customer codes against fields that never arrive. Fix before first customer — cheap.
- **F14. TEE resolver stub + half-flip hazard** — setting `TEE_PUBLIC_KEY_URL` without an enclave fails ALL T3+ deliveries typed; set both TEE envs together only after enclave deploy (Track B).
- **F15. Write-relay + engagement lanes point at localhost/NXDOMAIN** — Tree-1 ZK registration + Tree-3 engagement can't succeed outside local dev (fail-loud); reads look healthy meanwhile.
- **F16. Rate-limit call in resolve route sits outside any try** — fresh env without `RATE_LIMITER_ALLOW_MEMORY` throws a raw 500 (breaks the route's typed-502 posture); rpm caps are per-isolate advisory (monthly 402 is the only global backstop).
- **F17. IPFS gateway arm documented-dormant by design** (`getSources()` = [r2] only). No action.

## G — Dead code / decide-to-delete (no runtime risk; write-cost + confusion-cost)
- **G1.** `usageRecords` indexes `by_orgId_occurredAt`/`by_orgId_meter_period` — zero readers (metering queries hit same-named indexes on `usagePeriodTotals`); delete or build the per-org audit read.
- **G2.** `usageRecords.keyId` written, never read — latent per-API-key attribution slot.
- **G3.** `resolve_district`/`resolve_officials` meter enums — zero writers; future endpoint slots.
- **G4.** HTTP officials fallback (`client.ts:1054+`, NXDOMAIN target) — false redundancy; delete or deploy a relay.
- **G5.** Server-side Tree-2 proof loop is self-referential (`getCellProof:702` ↔ `cell-tree-snapshot.ts:299`; `merkle-snapshot.json` 404s live) — delete, or publish the snapshot + on-chain trustedRoot fallback.
- **G6.** `healthCheck()`/`checkIPFSHealth` — zero callers; two divergent "atlas healthy" definitions; converge or delete.
- **G7.** `getDistrictsForSlot` — zero consumers; `findDistrictHex` only ever slot 0.
- **G8.** `Resolution` interface in `provenance.ts` — type-only, zero importers.
- **G9.** /v/[hash] Topic block + `participantCount` unreachable (`topic: null` hardcoded, `+page.server.ts:65,137`); `location.method` never rendered.

## H — Test-fidelity (green CI does not execute the real thing)
- **H1. Convex metering tests are disclosed mirrors** (`convex/metering.test.ts` mock ledger; `drain-hardening.test.ts` mirrors drain stamping) — an index-name typo or transactionality divergence in the real handlers passes CI and surfaces first in prod at the B1 deploy. Flip: wire `convex-test`, port the mirrors.
- **H2. Tests-ahead-of-deploy** — workflow-shape + branch tests exercise code no prod caller reaches until R0; "green suite" overstates deployed reality.

## Cascade
Minimal ordered sequence, all-noop → fully live:

1. **R0** — commit both repos → PR (`test` CI) → merge main
2. **B2** — fix `.env.local` env-family conflict so the Convex CLI can deploy at all
3. **B4** — set `INTERNAL_API_SECRET` on prod Convex (before any deploy that arms the cron)
4. **B1** — Convex deploy (`--env-file`) — MUST precede step 5 (B3 bricks all address verification otherwise)
5. **CF Pages deploy** — promote `production` branch
6. **A2** — `ingest-legislators` → `publish:source --tiger-vintage`
7. **A1** — operator `workflow_dispatch` with real `tiger_vintage` + manifest SHA + secrets
8. **A3** — bump `ATLAS_BASE_URL` `/vYYYYMMDD` + re-pin cell-map root/depth
9. **F1** — provision Nominatim + set `NOMINATIM_URL` on CF Pages (+ `RATE_LIMITER_ALLOW_MEMORY` per F16) — this blocks ALL resolves regardless of everything above
10. **E1/E2** — alarm + change-check enablement (F2 sink when built)
11. **At customer-close, as one unit**: D4 Stripe Meters + `STRIPE_SECRET_KEY` → D1 `BILLING_PROVIDER=stripe` on BOTH sides (+B5 `PUBLIC_BASE_URL`) → C1 `CRON_PROFILE=operational` + redeploy. D before/with C, never C alone — D2/D3 silently and permanently write off revenue otherwise.

Deliberately left noop: all of **F** except F1 (capability build, cost-posture/design-gated — F13 is the one cheap exception worth fixing pre-first-customer), all of **G** (delete-or-build decisions, zero runtime risk), all of **H** (test-fidelity debt, acceptable until the B1 deploy makes mirror-divergence a live hazard). D7 stays by policy. F14/F15/F17 stay per Track-B / relay / ecosystem posture. N-class items (blank /v/[hash] freshness section, session-credential clocks, packet phrases) auto-resolve at deploy/launch with no lever.

## Honest surface today
A real integrator hitting production right now gets nothing: `/api/v1/resolve-address` is a plain 404 because the entire arc — route, metering, provenance, redraw guard, producers — is uncommitted working-tree on one machine; there is no resolve mention on /developers, no resolve meter in /api/v1/usage, and no deployed OpenAPI entry, so the product is undiscoverable and nonexistent in equal measure. The only live adjacent surface is the pre-arc person-layer verify flow reading the healthy R2 atlas (v20260512, congressional-only officials, slot-0 reads), with no freshness clocks anywhere and a /v/[hash] page that renders no freshness section. And merging alone fixes nothing: deploy in the wrong order and you brick all address verification (B3); deploy in the right order and every resolve still 502s — first as `METERING_UNAVAILABLE` until Convex ships, then as `RESOLVE_FAILED` forever, because no geocoder backend exists anywhere (F1). Between the integrator and a single successful billed resolve stand one commit, two ordered deploys, one operator publish ritual, and one piece of infrastructure that has never been provisioned.
