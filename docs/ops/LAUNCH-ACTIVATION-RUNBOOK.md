# Launch Activation Runbook — resolution / freshness / metering arc

Operator sequence that takes the resolve-address arc from **all-noop to live**. The canonical
lever inventory is `docs/design/NOOP-MAP.md` — every step ID below (R0, A1-A3, B1-B5, C1,
D1-D4, E1/E2, F1) is a NOOP-MAP lever, and the ordering follows its Cascade section
(`docs/design/NOOP-MAP.md:68-83`). This document sequences the flips; it changes nothing by
itself.

**Targets:** CF Pages project `communique-site` — `production` branch builds to
`https://commons.email`; prod Convex deployment `quirky-chinchilla-352` (deployed via
`--env-file .env.production`, see step 4).

**Discipline:** every step ends with a fenced Verify command whose success criterion is
observable command output (HTTP code, jq field, `gh run` status, env value). Do not mark a
step done on prose alone.

**Three orderings are load-bearing (hard requirements, not suggestions):**

1. **B4 before B1** — the drain cron freezes the secret at push time (`convex/crons.ts:573`).
2. **B1 (Convex) before the CF Pages deploy** — otherwise B3 bricks all address verification.
3. **D4/D1/B5 before or with C1 — never C1 alone** — otherwise D2/D3 silently write off revenue.

---

## Step 1 — R0: commit, PR, merge (both repos)

The entire arc is working-tree only on one machine: commons branch `p0-resolution-build`
(~55 files) and voter-protocol branch `p0-freshness-producers` (~10 files) have zero commits
ahead of `main`. Commit both, open PRs, and land them. **A human lands the push/merge** —
commons `main` requires the `test` CI check before merge. All voter-protocol commands use
**npm** (never pnpm).

Merging alone activates nothing in prod (NOOP-MAP "Honest surface": prod
`/api/v1/resolve-address` stays a plain 404 until the deploys below).

Verify: both PRs merged with green required checks:

```bash
gh pr list --repo communisaas/commons --state merged --head p0-resolution-build \
  --json number,mergedAt,title
gh pr list --repo communisaas/voter-protocol --state merged --head p0-freshness-producers \
  --json number,mergedAt,title
```

Expected: each command prints one merged PR with a non-null `mergedAt`.

## Step 2 — B2: unblock the Convex CLI (`.env.local` env-family conflict)

`.env.local` currently sets **both** the self-hosted family (`CONVEX_SELF_HOSTED_URL` /
`CONVEX_SELF_HOSTED_ADMIN_KEY`, `.env.local:47-48`) and the cloud family
(`CONVEX_DEPLOYMENT`, `.env.local:80`). With both present the Convex CLI refuses to target a
cloud deployment — no prod deploy happens at all. Comment out one family; for the prod cloud
deploy in step 4, comment out the `CONVEX_SELF_HOSTED_*` pair.

Verify: exactly one family remains active:

```bash
grep -nE '^(CONVEX_SELF_HOSTED_(URL|ADMIN_KEY)|CONVEX_DEPLOYMENT)=' .env.local
```

Expected: only `CONVEX_DEPLOYMENT=` prints (the two `CONVEX_SELF_HOSTED_*` lines are
commented out), or vice versa for local work — never both families at once.

## Step 3 — B4: set `INTERNAL_API_SECRET` on prod Convex BEFORE any deploy

`convex/crons.ts:573` arms the drain cron with
`{ _secret: process.env.INTERNAL_API_SECRET ?? "" }` — the value is **serialized at push
time**. Deploying while it is unset freezes `""` into the cron arm; every tick then throws
Unauthorized (visible only in Convex logs) until the NEXT deploy. Set it before step 4 and
before any future C1 redeploy.

Requirements: at least 32 bytes, **byte-identical** to the `INTERNAL_API_SECRET` already set
on the CF Pages project (read it from the CF dashboard; rotate both together if rotating).

```bash
read -rs SECRET   # paste the CF Pages INTERNAL_API_SECRET value; no echo, no shell history
npx convex env set INTERNAL_API_SECRET "$SECRET" --env-file .env.production
```

Verify: length and cross-system equality by hash (never print the plaintext):

```bash
npx convex env get INTERNAL_API_SECRET --env-file .env.production | tr -d '\n' | wc -c
npx convex env get INTERNAL_API_SECRET --env-file .env.production | tr -d '\n' | shasum -a 256
printf '%s' "$SECRET" | shasum -a 256
```

Expected: first command prints >= 32; the two hashes are identical.

## Step 4 — B1: deploy Convex (metering functions + tables)

Ships the metering functions and the `usageRecords` / `usagePeriodTotals` tables to prod.
Until this lands, every resolve returns the typed 502 `METERING_UNAVAILABLE`
(`src/routes/api/v1/resolve-address/+server.ts:135`) — fail-closed, never a silent free
resolve.

```bash
npx convex deploy --env-file .env.production
```

**Never run bare `npx convex deploy -y`** — it silently fails to reach the prod deployment
in this repo. `--env-file .env.production` is the only deploy form verified to land on prod.

Verify: metering functions exist on the prod deployment:

```bash
npx convex function-spec --env-file .env.production | grep -c 'metering'
```

Expected: a count greater than 0 (the `metering.*` function identifiers are listed).

## Step 5 — CF Pages deploy (promote `production`) — B3 ordering constraint

```text
+------------------------------------------------------------------------------+
| ORDERING CONSTRAINT (B3): the Convex deploy MUST precede this CF Pages       |
| deploy. The new Pages code sends four provenance keys unconditionally on     |
| every address verification (src/lib/server/ground/ground-service.ts:224-227: |
| boundaryAsOf, officialsAsOf, tigerVintage, resolutionConfidence). Old prod   |
| Convex rejects unknown args — those validator fields exist only in the new   |
| deploy (convex/users.ts:624-627). Ship Pages first and ALL address           |
| verification bricks with 500s — fail-loud and total, for every user, until   |
| Convex catches up. Complete steps 3-4 first, then this step.                 |
+------------------------------------------------------------------------------+
```

Promote by pushing `main` to the `production` branch (CF Pages builds that branch to
`commons.email`). A human lands the push.

Verify: new route live (auth-gated, not missing) and address verification not bricked:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://commons.email/api/v1/resolve-address \
  -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://commons.email/api/identity/verify-address \
  -H 'content-type: application/json' -d '{}'
```

Expected: first prints `401` (API key required — NOT `404` route-missing, NOT `500`);
second prints `401` (authentication required, `+server.ts:329` — NOT `500`). Then complete
**one real end-to-end address verification in a browser as a signed-in user** and confirm a
credential is issued, not a 500 — that is the actual B3 evidence; the curls only prove the
routes are deployed.

## Step 6 — A2: refresh the officials clock, publish the source snapshot

The chunked build stamps `officialsGenerated` from the officials DB's `ingestion_log`
(voter-protocol `packages/shadow-atlas/scripts/build-chunked-mapping.ts:216-245`). The live
DB's only success row is months old — dispatching A1 without a fresh ingest debuts the
"fresh clocks" feature showing stale officials. Run in voter-protocol (npm):

```bash
cd packages/shadow-atlas
npm run ingest:legislators
npm run publish:source -- --tiger-vintage TIGER2024   # substitute the real current TIGER vintage
```

Notes: `publish:source` requires `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in the
environment, and a non-dry run **refuses** any vintage label not matching `TIGER20YY`
(`scripts/publish-source.ts:571` calls `resolveTigerVintage`, which throws at
`src/distribution/snapshots/tiger-vintage.ts:32`). **Record the sha256 the publish emits** —
it is the `expected_manifest_sha256` input for step 7.

Verify: the ingestion log carries a success row from this run:

```bash
sqlite3 officials.db "SELECT run_at FROM ingestion_log WHERE source='congress-legislators' AND status='success' ORDER BY run_at DESC LIMIT 1"
```

Expected: the timestamp of the ingest just performed (today), not a months-old date.

## Step 7 — A1: operator publish dispatch (quarterly workflow)

Dispatch `shadow-atlas-quarterly.yml` with a real vintage and the manifest SHA from step 6.
Confirm the Ed25519 manifest-signing public key pin is configured in the repo before
dispatching (the download-verification step prefers signature verification when the public
key is set — `shadow-atlas-quarterly.yml:134`); never bypass verification with
`allow_unverified`.

```bash
gh workflow run shadow-atlas-quarterly.yml --repo communisaas/voter-protocol \
  -f tiger_vintage=TIGER2024 \
  -f expected_manifest_sha256=<sha256 emitted by publish:source in step 6>
```

Verify: run green, then the published manifest actually carries both freshness clocks
(their absence in the previous live manifest is exactly what this publish fixes):

```bash
gh run list --repo communisaas/voter-protocol \
  --workflow=shadow-atlas-quarterly.yml --limit 1 \
  --json status,conclusion,displayTitle
```

Expected: `"status": "completed"`, `"conclusion": "success"`. Then, with the versioned
`ATLAS_BASE_URL` printed in the run summary:

```bash
curl -s "https://atlas.commons.email/v<YYYYMMDD>/US/manifest.json" | jq '{tigerVintage, officialsGenerated}'
```

Expected: `tigerVintage` = the dispatched `TIGER20YY` value and `officialsGenerated` = the
step-6 ingest timestamp — neither null nor missing. Missing clocks mean every resolution is
clamped to 0.4 confidence with "boundary vintage unknown"
(`src/lib/core/shadow-atlas/redraw-guard.ts:88-104`).

## Step 8 — A3: point prod at the new atlas version (env pins)

When step 7 was dispatched with `push_cids=true` (the default,
`shadow-atlas-quarterly.yml:47`), the workflow's `push-cids` job (`:854-935`) **pushes
`ATLAS_BASE_URL`, `VITE_ATLAS_BASE_URL`, `EXPECTED_CELL_MAP_ROOT`, and
`EXPECTED_CELL_MAP_DEPTH` to the CF Pages project automatically** and prints all four to the
run summary — this step is then *verify-in-summary*, not a hand-bump. Hand-edit the CF Pages
env vars only if `push_cids=false` was chosen or the job failed, and remember a CF Pages env
change takes effect on the next deployment.

This is a **recurring ritual**: every future republish must re-point the version-pinned path
(`/vYYYYMMDD`) and re-pin root/depth, or clients silently stay on the old atlas.

Verify: prod health reports the new pinned atlas:

```bash
curl -s https://commons.email/api/health | jq '.atlas'
```

Expected: `"baseUrl"` ends in the new `/vYYYYMMDD`, and `configured`, `rootPinned`,
`depthPinned`, `manifest`, `districtIndex` are all `true` with `"status": "ok"`.

---

Ordering note for steps 9-10: NOOP-MAP's cascade lists F1 ninth and E1/E2 tenth. The two are
order-independent (no dependency edge between them); this runbook puts schedule enablement
first because it needs only the step-1 merge, while the geocoder waits on a provisioning
decision.

## Step 9 — E1 + E2: schedule enablement

**E1 — quarterly staleness alarm.** The cron `0 2 1 1,4,7,10 *`
(`shadow-atlas-quarterly.yml:77`) registers only once the workflow is on the default branch
(after step 1). Its semantics, verbatim from the workflow's own comment (`yml:68-76`): on a
`schedule` event the `inputs` context is empty, so `tiger_vintage` resolves to `'unknown'`
and the build **fails fast before any manifest is written** — "This is intentional and
fail-closed: a silent stale publish is impossible. A RED quarterly run means 'time to
republish' ... The schedule is the reminder; the dispatch is the publish."

**A red scheduled run is the republish alarm working as designed. Do not silence it, do not
normalize it as CI noise** — answer it by running steps 6-8. Also note GitHub auto-disables
schedules after 60 days without repo activity; re-enable from the Actions UI if that
happens.

**E2 — boundary change-check.** Daily cron `0 6 * * *` (`shadow-atlas-change-check.yml:34`).
The R2 round-trip steps skip cleanly when `R2_ACCESS_KEY_ID` is absent
(`shadow-atlas-change-check.yml:84,104,126`) — but without the R2 repo secrets every run
starts from a fresh DB and reports every source as "new" (meaningless signal). Confirm the
R2 secrets are present; the first real run seeds the durable detection DB.

Verify: workflows registered and runnable, R2 secrets present:

```bash
gh workflow list --repo communisaas/voter-protocol
gh secret list --repo communisaas/voter-protocol | grep -i 'R2'
gh run list --repo communisaas/voter-protocol \
  --workflow=shadow-atlas-change-check.yml --limit 1 --json status,conclusion
```

Expected: both shadow-atlas workflows listed `active`; R2 secret names listed; the latest
change-check run `completed`/`success` (a fresh-DB first run reporting everything new is
expected exactly once).

## Step 10 — F1: live geocoder (PLACEHOLDER — pending the geocoder decision)

**This step cannot be executed from this runbook yet.** No geocoding backend exists
anywhere: the resolver defaults `NOMINATIM_URL` to `${SHADOW_ATLAS_URL}/nominatim`
(`src/lib/core/shadow-atlas/client.ts:1210`) and `SHADOW_ATLAS_URL` to `localhost:3000`
(`client.ts:43`); no deployed environment sets either to a live host.

Consequence, stated plainly: with every step above complete, **every resolve — paid v1 and
person-layer alike — still returns a 502**: `METERING_UNAVAILABLE`
(`+server.ts:135`) until step 4 lands, then `RESOLVE_FAILED` (`+server.ts:228`) on every
request forever after. The flagship endpoint stays 100% dead until this step closes.

Defer to the geocoder decision brief at `docs/design/GEOCODER-OPTIONS.md` for the
provisioning path (decided direction: a **self-hosted** Nominatim instance first — the exact
contract the resolver already speaks — with an atlas-native address layer to retire the
dependency later). **Hard constraint: only self-hosted, infrastructure-we-control geocoding
is permissible. The raw user address must never leave infrastructure we operate; no hosted
geocoding service may be substituted, whatever the provisioning friction.**

When a backend is provisioned: set `NOMINATIM_URL` on the CF Pages project (plus
`RATE_LIMITER_ALLOW_MEMORY=1` — NOOP-MAP F16: the resolve route's rate-limit call sits
outside any try and throws a raw 500 on a fresh env without it) and redeploy.

Verify: backend alive, then one real end-to-end resolve:

```bash
curl -s "$NOMINATIM_URL/status"
```

Expected: HTTP 200 with body `OK` (Nominatim status endpoint).

```bash
curl -s -X POST https://commons.email/api/v1/resolve-address \
  -H "Authorization: Bearer $API_KEY" -H 'content-type: application/json' \
  -d '{"address":"1600 Pennsylvania Ave NW, Washington, DC 20500"}' | jq '.'
```

Expected: a resolved district payload with provenance — not
`{"error":{"code":"RESOLVE_FAILED"}}`.

---

## Appendix — customer-close: billing activation as ONE atomic unit (D4 → D1+B5 → C1)

Run this appendix only when the first paying resolve customer closes, and run it **as one
unit, in this order**. Nothing in it is a defect before then — the noop provider is the
correct pre-customer posture.

```text
+------------------------------------------------------------------------------+
| SILENT REVENUE WRITE-OFF (D2/D3): the noop drain PERMANENTLY consumes usage  |
| rows. The noop path stamps reportedToProvider: true with a noop:<requestId>  |
| event id (convex/metering.ts:392 via the markReported stamp at :241-243),    |
| and the drain only ever selects rows still at undefined                      |
| (convex/metering.ts:207). Flip C1 while D1 is still noop (D2) — or half-flip |
| Convex=noop / Pages=stripe (D3) — and every accumulated usage row is stamped |
| reported without ever reaching Stripe: revenue written off silently and      |
| permanently, with no error anywhere. The Stripe drain rejects noop: ids      |
| (metering.ts:337) but nothing guards the reverse direction.                  |
|                                                                              |
| D BEFORE / WITH C. NEVER C ALONE.                                            |
+------------------------------------------------------------------------------+
```

The quota gate is unaffected by C1 timing — the per-period counter is written
in-transaction at record time (`convex/metering.ts:91-104`), so the 402 at plan cap holds
whether or not the drain cron is running. Only *reporting to the provider* is at stake here.

### D4 — provision Stripe Meters + `STRIPE_SECRET_KEY`

In the Stripe dashboard, create a billing Meter whose **event name equals each billable
meter enum value** — `resolve_address` (`convex/schema.ts:2250-2251`); the adapter posts
meter events under exactly that name
(`src/lib/server/billing/providers/stripe-adapter.ts:31-32`, `event_name: r.meter`).
Flipping D1 without Meters means every meter-event create rejects, rows stay unreported, and
the only signal is console noise — infinite retry. Set `STRIPE_SECRET_KEY` on the CF Pages
project (the SvelteKit internal endpoint owns the Stripe SDK).

Verify: the Meters exist under the same key the app will use:

```bash
curl -s https://api.stripe.com/v1/billing/meters -u "$STRIPE_SECRET_KEY:" | jq -r '.data[].event_name'
```

Expected: output includes `resolve_address`.

### D1 + B5 — flip `BILLING_PROVIDER=stripe` on BOTH sides; set `PUBLIC_BASE_URL` on Convex

The provider is selected independently on each side: CF Pages reads it lazily in
`getBillingProvider()` (`src/lib/server/billing/providers/index.ts:16-21`); Convex reads it
inline in `providerName()` (`convex/metering.ts:374-376`). Flip **both** — a half-flip is
the D3 write-off above.

B5: the Convex Stripe-drain branch defaults `PUBLIC_BASE_URL` to `https://commons.email`
(`convex/metering.ts:286`). Any stripe-flipped non-prod Convex deployment would therefore
POST **prod's** report-usage endpoint with the wrong secret (a 403 loop — fail-closed but
cross-env). Set `PUBLIC_BASE_URL` explicitly on every Convex deployment that ever flips to
stripe.

```bash
npx convex env set BILLING_PROVIDER stripe --env-file .env.production
npx convex env set PUBLIC_BASE_URL https://commons.email --env-file .env.production
```

Then set `BILLING_PROVIDER=stripe` on the CF Pages project env (dashboard) in the same
sitting — remember Pages env changes apply on the next deployment.

Verify: both Convex values readable, Pages side confirmed before proceeding:

```bash
npx convex env get BILLING_PROVIDER --env-file .env.production
npx convex env get PUBLIC_BASE_URL --env-file .env.production
```

Expected: `stripe` and `https://commons.email`. For the Pages side, confirm the project env
var reads `stripe` in the CF dashboard — do not start C1 until both sides show stripe.

### C1 — `CRON_PROFILE=operational` + redeploy

The `drain-usage` cron registers only under the `operational` profile
(`convex/crons.ts:568-575`), and the profile is **deploy-frozen** — setting the env var
without redeploying changes nothing (see `docs/ops/CRON-PROFILES.md`). B4 must already be
set (step 3): the same freeze-at-push applies to the cron's secret argument
(`convex/crons.ts:573`).

```bash
npx convex env set CRON_PROFILE operational --env-file .env.production
npx convex deploy --env-file .env.production
```

Verify: one real drain tick's return value is the cross-side proof:

```bash
npx convex run metering:drainUsageToProvider \
  '{"_secret": "<the INTERNAL_API_SECRET value>"}' --env-file .env.production
```

Expected: `{"provider": "stripe", "reported": <N>}`. The `provider` field MUST read
`stripe`. If it reads `noop`, the D1 Convex flip did not land — **STOP immediately**: every
row drained in that state is stamped reported and becomes unbillable forever (the boxed
warning above). Backlog drains at 500 rows per 15-minute tick.
