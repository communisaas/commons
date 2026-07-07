# Self-Healing Data Ops — Shadow Atlas source freshness

**Status:** DESIGN (approved shape for hypergraph nodes P14 + P15)
**Founder directives (2026-07-04):** (1) resolve every district possible; (2) "agentically
address data that fails to update after a certain number of retries over the preset update
interval."
**Cost posture:** no recurring paid services. Everything below runs on GitHub Actions
(public repo — standard-runner minutes are free) plus infra that already exists (the R2
bucket and the change-detection SQLite DB that already round-trips through it). The only
metered spend is Anthropic API usage in the remediation lane, which is zero in steady
state and fires only on an SLO breach, bounded by hard caps (§Failure modes).

All `file:line` references are `voter-protocol/packages/shadow-atlas/` unless prefixed.

---

## The loop

```
        (exists today)                      (P14 — new)
┌───────────────────────────┐   ┌────────────────────────────────┐
│ FETCH LANE                │   │ PROBE LANE                     │
│ daily change-check        │   │ same scheduled job, new step:  │
│ (schedule 06:00 +         │   │ method-appropriate reachability│
│ dispatch): checksum       │   │ probes (HEAD / conditional GET │
│ compare over              │   │ / range-GET first-bytes) for   │
│ getAllCanonicalSources =  │   │ EVERY registry source the      │
│ muni-derived sources + 2  │   │ fetch lane never touches: NAD, │
│ congressional seeds ONLY; │   │ ADDRFEAT, BAF, tract-centroids,│
│ HEAD ×3 backoff,          │   │ TIGER national + next-vintage, │
│ download ×6 (retry lane)  │   │ tigerweb-cd, intl officials…   │
└─────────────┬─────────────┘   └───────────────┬────────────────┘
              │     every attempt, either lane   │
              ▼                                  ▼
   ┌─────────────────────────────────────────────────────┐
   │ health ledger row (P14) — same SQLite DB, same R2   │
   │ round-trip; the quarterly full fetch ALSO writes    │
   │ attempts, but only when the operator dispatches it  │
   └──────────────────────────┬──────────────────────────┘
                              ▼
   ┌──────────────────────────────────────┐   ┌──────────────────────────┐
   │ breach evaluation (P14)              │   │ agentic remediation lane │
   │ fetch-breach: failures ≥ retryBudget │──▶│ (P15): diagnose →        │
   │ staleness: past expectedInterval     │   │ test-gated fix PR — or — │
   │ → structured breach record + deduped │   │ escalation w/ evidence;  │
   │   `atlas-slo-breach` issue           │   │ HUMAN MERGES (auto-merge │
   └──────────────────────────────────────┘   │ NEVER); operator publish │
                                              │ unchanged                │
                                              └──────────────────────────┘
```

Two lanes, because the daily change-check does NOT cover the full source registry —
see §Daily probe lane for the explicit coverage split. Exactly one lane owns each
source's daily reachability clock; the operator-dispatched quarterly is a third,
*unscheduled* writer that additionally proves full-fetch/parse health when it runs.

Detection and retry already exist and are not redesigned here:

- **Detection**: `.github/workflows/shadow-atlas-change-check.yml` runs daily
  (`cron '0 6 * * *'`, L31-34), round-trips `change-detection/shadow-atlas.db` through R2
  (get L80-90, put L99-110), runs `npm run changes:check` (`src/scripts/check-changes.ts`),
  and raises a deduped `atlas-change-alert` GitHub issue on detections (L112-153).
  `ChangeDetector.checkForChange` (`src/acquisition/change-detector.ts:201-247`) does
  HEAD → etag ‖ last-modified ‖ body-sha256, with 3-attempt exponential backoff
  (L86-91) and a 5s timeout (L96).
- **Retry**: `src/distribution/addresses/download-pool.ts` — `downloadWithRetry`
  (L142-184): 6 retries, 2s→60s backoff, jitter, `Retry-After` honored on 429/503,
  fail-loud exhaustion; `downloadZipToCache` (L217-247) with zip-completeness resume
  cache. Plus the SQLite download DLQ (`src/acquisition/download-dlq.ts`).

What is missing — and what this design adds — is the seam between them and action.
There are **two** gaps, not one:

1. **Error-swallow.** A fetch error inside `checkForChange` is swallowed as "no change"
   (`change-detector.ts:238-246`), so a source the daily check *does* cover can
   silently die forever.
2. **Coverage punt — stated plainly.** The daily change-check only ever fetches
   `getAllCanonicalSources` = muni-derived selected sources + the 2 congressional
   seeds (`congress-legislators-current`, `tiger-cd119`) appended to them
   (`change-detector.ts:647-733`, seeds L154-174). NAD, ADDRFEAT, BAF,
   tract-centroids, the TIGER national layers, tigerweb-cd, and the UK/CA/AU/NZ
   officials sources are fetched ONLY by the operator-dispatched quarterly or by
   unscheduled scripts. Without a new daily touchpoint their `last_attempt` /
   `consecutive_failures` never advance between quarterlies, and fetch-breach is
   **structurally dead** for exactly the sources most likely to rot.

The loop closes both: every attempt outcome from either lane lands in a **health
ledger** (P14), a **daily probe lane** (P14, §Daily probe lane) reaches every registry
source the fetch lane doesn't, the scheduled run evaluates **SLO breaches** against a
**source registry** (P14), and a breach fires the **agentic lane** (P15) which either
opens a test-gated fix PR against source-acquisition config/code or escalates with
evidence. A human merges. The operator-dispatched publish
(`shadow-atlas-quarterly.yml`) is untouched.

---

## Source registry + SLOs

One typed config, `packages/shadow-atlas/src/acquisition/source-health.ts`, is the
single source of truth. Shape:

```ts
interface SourceHealthConfig {
  id: string;                     // stable key, matches detector sourceIds where they exist
  class: 'boundary-geometry' | 'boundary-assignment' | 'municipal'
       | 'address' | 'officials' | 'signal' | 'infra';
  url: string | { template: string; params: string[] };  // or ref to existing config site
  configSite: string;             // file:line where the URL/vintage actually lives —
                                  //   this is the agent's edit target on breach
  expectedIntervalDays: number | null;  // freshness window; null = frozen product
  retryBudget: number;            // consecutive failed attempts before fetch-breach
  freshness: 'vintage' | 'rolling' | 'frozen' | 'manual';
  ownerSlots?: string;            // which atlas slots go stale if this dies (jurisdiction.ts:262)
  // Daily-lane assignment. INVARIANT: exactly one lane owns each source's
  // reachability clock (dual writes would let a bare probe 200 reset
  // consecutive_failures accumulated by a failing checksum fetch).
  //   'fetch' — covered by getAllCanonicalSources (muni-derived + the 2 seeds)
  //   'probe' — daily reachability probe (§Daily probe lane)
  //   'none'  — manual/dormant rows, skipped by both lanes
  lane: 'fetch' | 'probe' | 'none';
  probe?: {                       // required when lane === 'probe'
    method: 'head' | 'conditional-get' | 'get';  // first choice; prober auto-falls
                                  //   back HEAD → range-GET (`Range: bytes=0-0`)
                                  //   on 405/501/hang — www2.census.gov mishandles
                                  //   HEAD intermittently
    url?: string;                 // override when probe target ≠ fetch URL
                                  //   (directory listing, sample county, service root)
    sample?: 'rotate-daily';      // per-file families (BAF ×56, per-state TIGER):
                                  //   probe ONE date-rotated representative per day
    nextVintage?: {               // vintage sources only: window-gated probe of the
      template: string;           //   NEXT vintage URL, recorded on the derived
      windowMonths: number[];     //   `<id>@next-vintage` ledger row
    };
  };
}
```

Two breach semantics share the config (both are the founder's "fails to update after a
certain number of retries over the preset update interval"):

- **fetch-breach** — `consecutive_failures >= retryBudget`. The source is unreachable or
  unparseable. Applies to every class.
- **staleness-breach** — `now - last_success > expectedIntervalDays`. For
  `freshness: 'vintage'` sources this means the *next expected vintage* never appeared
  inside its release window (e.g. TIGER2025 URL still 404 in October) — the **probe
  lane** probes the next-vintage URL daily while inside the release window, recording
  outcomes on a derived `<id>@next-vintage` ledger row (§Daily probe lane); the breach
  fires when the window closes without a 2xx. Current-vintage reachability probes
  deliberately do NOT advance a vintage source's staleness clock — a 200 on TIGER2024
  proves the old file still serves, not that TIGER2025 arrived. `frozen` products never
  staleness-breach; `manual` rows are skipped entirely.

Full enumeration of current upstreams (intervals matched to real upstream cadence —
TIGER annual, congress-legislators weekly, NAD quarterly, court redraws sporadic):

| id | class | config site | upstream cadence | expectedInterval | retryBudget | owner slots |
|---|---|---|---|---|---|---|
| `tiger-cd119` | boundary-geometry | `providers/tiger-manifest.ts:107`; detector seed `acquisition/change-detector.ts:167` | annual (July) + redistricting years [2021,2022,2031,2032] + census 2030 | 400d | 3 | cd (slot 0) |
| `tiger-state-{cd,sldu,sldl,county}` (per-state) | boundary-geometry | `acquisition/change-detection-adapter.ts:233-242` (URL template) | annual | 400d | 3 | cd/sldu/sldl per BAF map |
| `tiger-place` | boundary-geometry | `providers/tiger-place.ts:423`; national `providers/census/census-tiger-parser.ts:260` | annual | 400d | 3 | place |
| `tiger-tract-centroids` | boundary-geometry | `hydration/tract-centroid-index.ts:49,126` (TIGER2024/TRACT) | annual | 400d | 3 | PIP substrate (all slots) |
| `tiger-national-{aiannh,cbsa,state,county,zcta520,uac,mil}` | boundary-geometry | `providers/tiger-manifest.ts:93-183` | annual | 400d | 3 | context + aiannh |
| `bef-cd119` | boundary-geometry | `hydration/bef-overlay.ts:33` | per-congress (~2y) | 800d | 3 | cd overlay |
| `baf-2020-{ST}` (56 files) | boundary-assignment | `hydration/baf-downloader.ts:8,49`; entities L10-13 | frozen 2020 product; revised only on mid-decade redistricting | null (frozen) — daily probe lane, date-rotated sample (§Daily probe lane) | 3 | slots 0-5, 7-9, 20-21 (`jurisdiction.ts:262`) |
| `ward-arcgis-{city}` | municipal | `hydration/ward-registry.ts:34` (per-city FeatureServer URLs) | sporadic municipal redistricting; endpoints are the most fragile upstreams we have | 30d reachability | 5 | ward (slot 6) |
| `addrfeat-{vintage}` | address | `scripts/build-address-index.ts:336` (directory-index crawl), `--addrfeat-vintage` L164-165 | annual (TIGER) | 400d | 3 | address src:1 |
| `nad` | address | quarterly workflow input `nad_url` (`shadow-atlas-quarterly.yml:78-84`); vintage gate `distribution/addresses/nad-vintage.ts:18-35` | quarterly | 120d | 3 | address src:0 |
| `congress-legislators-current` | officials | detector seed `acquisition/change-detector.ts:154-174`; ingest `scripts/ingest-legislators.ts:85-86` | repo commits ~weekly; membership changes sporadic | 7d | 3 | US federal officials |
| `tigerweb-cd` | officials | `providers/international/us-provider.ts:216-217` | service availability | 30d | 3 | CD geometry service |
| `uk-mps` | officials | `scripts/ingest-uk-mps.ts:102` (members-api.parliament.uk) | API; elections sporadic | 30d | 3 | UK officials |
| `ca-mps` | officials | `scripts/ingest-canadian-mps.ts:93` (represent.opennorth.ca) | API | 30d | 3 | CA officials |
| `au-mps` | officials | `scripts/ingest-au-mps.ts:9` (aph.gov.au **scrape**) | scrape — fragile | 30d | 5 | AU officials |
| `nz-mps` | officials | `scripts/ingest-nz-mps.ts` | scrape/API | 30d | 5 | NZ officials |
| `redraw-signal` | signal | commons `src/lib/core/shadow-atlas/redraw-guard.ts` + `redraw-signal.data.ts` | court redraws — sporadic; TODAY hand-curated (6 states), no feed wired | `manual` until a feed is provisioned (ledger item, ELEVATED 2026-07-04) | — | redraw guard |
| `dc-urls` | infra (dormant) | `config/providers.ts:132` | referenced | manual | — | DC |
| `ipfs-gateways` | infra | `config/providers.ts:174-180` | distribution-side availability | 7d reachability | 3 | serving, not acquisition — **escalate-only**, never in the fix lane |

Lane assignment for `ward-arcgis-{city}` is **explicit `lane: 'fetch'`**: its per-city
FeatureServer endpoints enter through the change-DB muni selections that
`getAllCanonicalSources` walks, and they are deliberately excluded from the probe list
(lane exclusivity — a probe 200 would reset `consecutive_failures` accrued by failing
content fetches).

**Implemented truth: id shape.** `getAllCanonicalSources` emits NUMERIC autoincrement
ids for every muni-derived source (`sources.id INTEGER PRIMARY KEY AUTOINCREMENT`,
`db/schema.sql`) — never a synthetic `ward-arcgis-{city}` string. The `ward-arcgis`
registry row is therefore a template, evaluated by **aggregating every real ledger row
whose recorded URL matches the ward-arcgis family** (`isWardArcgisFamilyUrl`: a
FeatureServer/MapServer REST path), not by an id prefix. The aggregate takes the WORST
city's `consecutive_failures` (one fragile endpoint failing shouldn't be diluted by many
healthy ones) and the MOST RECENT success across the family. Because `ward-registry.ts`
derives from `attributed-council-districts.json` rather than the change DB's
source→selection walk, the prober **asserts at startup** that at least one real
`getAllCanonicalSources` entry's URL matches the ward-arcgis family this run, recording a
(persisted, not console-only) fetch-lane config breach when none does — absence is loud,
never a silent neither-lane gap.

**Implemented truth: staleness driver.** The design table lists `ward-arcgis-{city}`'s
SLO as "30d **reachability**", not content staleness — and muni content checks are
due-filtered to ~once/year (annual, July), which cannot service a 30-day interval on its
own (see "Implemented truth: cadence" below). This row's staleness therefore keys off the
daily reachability-probe clock (`last_probe_at`, aggregated the same worst/most-recent way
as above), not the content-check clock. Its fetch-breach still reads the content clock's
`consecutive_failures` — a real failing FeatureServer endpoint on an actual checksum check
is what that alarm means.

Directive (1) — *resolve every district possible* — is why `ownerSlots` is a first-class
column: a breach report names exactly which resolution slots go stale, and the future
wave (reserved slots 10-19: community-college / water / fire / transit / hospital /
library / park / conservation / utility / judicial special districts,
`jurisdiction.ts:255-305`, "to be populated via the ingestion platform's scanner
infrastructure") onboards into this loop by adding a registry row — no new machinery.
Note there is no source labeled "P12" anywhere in either repo; the future-wave sources
are exactly the reserved-slot list above plus the commons-side `REDRAW_SIGNAL` feed.

---

## Daily probe lane

**Why this lane exists.** The daily change-check's fetch surface is
`getAllCanonicalSources` = muni-derived selected sources + the 2 congressional seeds,
and nothing else (`change-detector.ts:647-733`, seeds L154-174). Every other registry
source — NAD, ADDRFEAT, BAF, tract-centroids, the TIGER national layers, tigerweb-cd,
the UK/CA/AU/NZ officials sources — is fetched only when the operator dispatches the
quarterly or runs an unscheduled script. **Full-fetch failures for quarterly-only
sources can therefore only be observed when the quarterly actually runs.** Without this
lane, those sources' `last_attempt`/`consecutive_failures` never advance daily and
fetch-breach is structurally dead for them — the punt earlier drafts of this design
buried. The probe lane is the cure: a lightweight prober that runs as a step **in the
same scheduled change-check workflow**, iterates the FULL source registry, and issues a
method-appropriate reachability probe for every `lane: 'probe'` row.

**Mechanics.** New module `src/acquisition/source-prober.ts` (thin CLI wrapper
`src/scripts/probe-sources.ts`, `--db` flag like `check-changes.ts`), wired into
`shadow-atlas-change-check.yml` after the R2 DB get and **before the breach-evaluation
pass**, so probe attempts are visible to the same run's evaluation; the DB put stays
after both lanes and before the alert steps. Per source, per its registry `probe`
config:

- **HEAD** first; on 405/501/hang, automatic fallback to **range-GET**
  (`Range: bytes=0-0`, 206 or 200 = success) — `www2.census.gov` intermittently
  mishandles HEAD, which is why the fallback is built in, not bolted on;
- **conditional GET** (`If-None-Match` / `If-Modified-Since`) where we hold a
  validator — a 304 is a success;
- plain **GET first-bytes** for API/scrape targets that reject HEAD (ArcGIS service
  roots, aph.gov.au).

Outcome semantics: 200/206/304 = attempt **success** (stamps `last_attempt_at`, resets
`consecutive_failures`); 4xx/5xx/timeout/DNS failure = attempt **failure** (stamps
`last_attempt_at`, increments `consecutive_failures`, stores `last_error`). Same 5s
timeout and ×3 backoff posture as the detector.

**A probe outcome is NOT content-change detection.** A 304/200 HEAD proves
reachability and advances the fetch-breach clock; checksum change detection stays the
change-detector's job where it runs, and content/parse integrity for quarterly-only
sources still comes only from the quarterly full fetch. Clock rules, per freshness
class:

| freshness | probe success advances staleness clock (`last_success_at`)? | staleness driver |
|---|---|---|
| `rolling` | yes — endpoint alive IS the freshness signal at this SLO | no successful touch in `expectedIntervalDays` |
| `frozen` | moot — frozen never staleness-breaches | none (fetch-breach only) |
| `vintage` | **no** — old-vintage reachability ≠ new vintage arrived | window-gated `<id>@next-vintage` probe: still no 2xx when the window closes |
| quarterly ingest products (NAD) | **no** | last successful quarterly ingest older than `expectedIntervalDays` — an explicit operator-nudge alarm, not a probe artifact |

**Lane exclusivity invariant.** The prober's CONTENT-clock pass skips every
`lane: 'fetch'` row. In particular `congress-legislators-current` is NOT content-probed —
dual-writing to `consecutive_failures`/`last_success_at` would let a bare HEAD 200 reset
failures accumulated by a failing checksum check, masking exactly the failure class the
ledger exists to catch.

**Implemented truth: cadence.** The daily change-check runs `checkScheduledSources`,
which due-filters to sources whose `updateTriggers` apply NOW — `congress-legislators-
current` only in January, `tiger-cd119`/ward munis only in July. That is NOT "a daily
fetch lane" for those rows; it is an annual content check. Fixed on both sides:

- **The 2 congressional seeds check DAILY, for real.** `check-changes.ts` explicitly
  content-checks `congress-legislators-current` and `tiger-cd119` on every run — not via
  a scheduler rewrite, but by additionally calling `checkSourcesBatch` on the 2 seeds
  whenever the due-filter didn't already include them this run. These are 2 cheap
  HEAD/checksum requests; their `consecutive_failures`/`last_success_at` now genuinely
  advance daily, servicing their 7d/400d SLOs as designed.
- **Muni rows (including ward-arcgis) stay content-check due-filtered** (annual, July) —
  that invariant is unchanged. But the prober ADDITIONALLY runs a daily reachability
  probe (`probeFetchLaneReachability`, source-prober.ts) over the fetch lane: the 2 seeds
  (redundant with the always-due content check above, cheap) plus a date-rotated SAMPLE
  of muni sources (bounded volume — `getAllCanonicalSources` can return thousands of
  municipalities; probing all of them daily would blow the "~a dozen requests/day" cost
  posture). This probe writes ONLY two SEPARATE columns —
  `probe_consecutive_failures`/`last_probe_at` — and NEVER
  `consecutive_failures`/`last_success_at`, the columns the content/checksum clock alone
  owns. A probe 200 can never mask a failing content fetch; a probe failure can never
  fabricate one. The two clocks are structurally disjoint columns on the same row, not
  merely disjoint lanes on different rows.

**Probe target list** (the `lane: 'probe'` complement of the fetch lane):

| source | probe |
|---|---|
| `nad` | HEAD the configured/last-known release zip URL (`nad_url`) |
| `addrfeat-{vintage}` | GET the TIGER ADDRFEAT directory listing + HEAD one sample county zip |
| `baf-2020-{ST}` | HEAD one date-rotated representative state zip (full 56-file family covered over the rotation) |
| `tiger-tract-centroids` | HEAD one sample TRACT zip under the pinned vintage |
| `tiger-national-{aiannh,cbsa,state,county,zcta520,uac,mil}` | HEAD one date-rotated manifest layer |
| `tiger-state-{cd,sldu,sldl,county}` | HEAD one date-rotated (state, layer) sample from the URL template |
| `tiger-place` | HEAD the national places zip |
| `bef-cd119` | HEAD |
| `tiger-cd119` next vintage | window-gated HEAD of the `TIGER{next}` CD URL (July–Oct), recorded on `tiger-cd119@next-vintage` |
| `tigerweb-cd` | GET service root `?f=json`, first bytes |
| `uk-mps` | HEAD/GET members-api.parliament.uk endpoint |
| `ca-mps` | GET represent.opennorth.ca (tiny response) |
| `au-mps` | GET first-bytes (scrape target; HEAD often blocked) |
| `nz-mps` | GET first-bytes |
| `ipfs-gateways` | HEAD gateway roots (registry already marks escalate-only) |

**Cost:** ~a dozen HEAD-class requests/day (family sampling keeps BAF/ADDRFEAT/
per-state templates at one representative each), on free public-repo runner minutes.
$0, no new secrets, no new infra — consistent with the cost posture at the top of
this doc.

---

## Health ledger

**No new infra.** The ledger lives inside the same SQLite DB that already round-trips
R2 in the change-check workflow (`CHANGE_DB_KEY: change-detection/shadow-atlas.db`,
`shadow-atlas-change-check.yml:67`; get-before L80-90, put-after L99-110, secret-gated
no-op fallback). Fresh DBs get schema via the same `createSQLiteAdapter` path that fixed
the `no such table: municipalities` bootstrap (`check-changes.ts:31-35`), so the ledger
table is added there:

```sql
CREATE TABLE IF NOT EXISTS source_health (
  source_id            TEXT PRIMARY KEY,      -- matches SourceHealthConfig.id
  last_attempt_at      TEXT,
  last_success_at      TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,                  -- 'HTTP 404 …' / 'timeout' / 'parse: …'
  breach_state         TEXT NOT NULL DEFAULT 'ok',
                       -- ok | breached | remediating | escalated | manual
  breach_opened_at     TEXT,
  remediation_ref      TEXT,                  -- breach-issue / fix-PR URL
  probe_consecutive_failures INTEGER NOT NULL DEFAULT 0,
                       -- daily reachability probe clock for lane:'fetch'
                       -- rows (see "Implemented truth: cadence" above) —
                       -- NEVER written by content checks, never read for
                       -- fetch-breach except by ward-arcgis's staleness
                       -- driver (an explicit "reachability" SLO)
  last_probe_at         TEXT,
  registered_at         TEXT                  -- first attempt of any kind
                       -- ever recorded for this row — the real, persisted
                       -- anchor for the never-succeeded staleness grace
                       -- (previously re-derived as "now" on every run,
                       -- making that grace infinite in production; fixed by
                       -- stamping this column on first insert and threading
                       -- it into evaluateSourceHealth from check-changes.ts)
);
```

The one code change this requires outside new files: `checkForChange` collapses fetch
errors to `null` ("no change", `change-detector.ts:238-246`) — correct for checksum
semantics, fatal for health. P14 threads an attempt-outcome hook out of the detector
(success / failure + error string per sourceId) **without changing what counts as a
change** — no spurious `modified` events, checksum behavior byte-identical.

Write ordering in the workflow stays as today, with the probe step slotted in: get DB
→ run probe lane (`probe-sources`, attempt rows for every `lane: 'probe'` source) →
run checks (fetch lane, ledger rows written per attempt) → evaluate breaches → **put
DB** → alert steps — so ledger durability survives alert failure, same reasoning as
the existing put-before-alert placement (L99-110). Both lanes write the same
`source_health` rows; window-gated next-vintage probes write derived
`<id>@next-vintage` rows (same DDL, derived key — no schema change). Precedents this copies rather than invents: the JSON checksum cache with Zod
+ safe-empty fallback (`change-detection-adapter.ts:93-120`), the download DLQ's
persist-immediately/restart-safe posture (`download-dlq.ts:1-60`), and the event-log-as-
durable-KV trick for state with no owning row (`change-detector.ts:407-496, 709-719`).
The officials side keeps its existing, separate freshness story (`ingestion_log` DDL
`db/officials-schema.sql:213`, reader `hydration/freshness-monitor.ts:70,186-220`,
CLI `hydration/check-freshness.ts`); the ingest scripts' success/failure rows become
ledger attempts when those scripts run in CI, but the officials DB itself is not merged
into the change-detection DB.

---

## Breach evaluation

Runs inside the existing scheduled change-check job — no new workflow for detection.
`check-changes.ts` gains a post-check evaluation pass (pure function
`evaluateSourceHealth(ledger, registry, now)` in `source-health.ts`, unit-testable
with injected clock):

```
for each registry row (skip lane = 'none' / freshness = 'manual'):
  fetch-breach:     consecutive_failures >= retryBudget
                    (counter advanced DAILY by the row's one owning lane —
                     fetch lane or probe lane)
  staleness-breach: expectedIntervalDays != null
                    AND now - last_success_at > expectedIntervalDays
                    (last_success_at advanced per the freshness-class clock
                     rules in §Daily probe lane; vintage sources additionally
                     require the in-window <id>@next-vintage probe to have
                     never returned 2xx)
  grace:            a source that has never succeeded gets one expectedInterval
                    from registration before staleness-breach can fire
                    (fetch-breach still applies)
```

**The two lanes, stated explicitly, because breach evaluation is only as live as the
attempts feeding it:**

- **Fetch lane** (exists today): the change-detector's checksum checks over
  `getAllCanonicalSources` — muni-derived selected sources + the 2 congressional
  seeds, and nothing else. These rows get real fetch/parse outcomes daily via the
  P14 outcome hook.
- **Probe lane** (P14, §Daily probe lane): every other registry source gets a daily
  method-appropriate reachability probe. These rows get reachability outcomes daily;
  their **full-fetch/parse failures can only be observed when the operator-dispatched
  quarterly actually runs** — that structural fact is WHY the probe lane exists.
  Without it, fetch-breach for quarterly-only sources could never fire between
  quarterlies, and their staleness intervals would be decoupled from any live signal.

A breach emits a **structured breach record** to `--health-summary ./health-summary.json`
(sibling of the existing `--summary` detections file, same exit-0 posture — the issue is
the alarm, not a red run):

```json
{
  "breaches": [{
    "sourceId": "tiger-cd119",
    "breachType": "staleness",
    "class": "boundary-geometry",
    "configSite": "packages/shadow-atlas/src/providers/tiger-manifest.ts:107",
    "expectedIntervalDays": 400,
    "retryBudget": 3,
    "lastSuccessAt": "2025-08-14T06:02:11Z",
    "consecutiveFailures": 5,
    "attempts": [{ "at": "…", "error": "HTTP 404 https://www2.census.gov/…" }],
    "urlChecked": "https://www2.census.gov/geo/tiger/TIGER2025/CD/…",
    "ownerSlots": "cd (slot 0)"
  }]
}
```

The workflow then mirrors the proven alert pattern (`shadow-atlas-change-check.yml:
112-153`): `jq '.breaches|length'` → `$GITHUB_OUTPUT`; gated on
`R2_ACCESS_KEY_ID != '' && breaches > 0`; idempotent `gh label create atlas-slo-breach`;
**one open issue per source** (title `SLO breach: <sourceId>`, comment-if-open else
create) with the breach record verbatim in a fenced JSON block — that block is the
remediation lane's machine-readable input. The record also flips the ledger row to
`breached` + stamps `breach_opened_at`/`remediation_ref`. Recovery is automatic at the
detection layer: the next successful check resets `consecutive_failures`, flips
`breached → ok`, and comments "recovered" on + closes the breach issue.

---

## The agentic lane

A separate workflow, `.github/workflows/shadow-atlas-remediate.yml`, so its permissions
and secrets are isolated from the change-check job.

**Trigger:** `issues: [labeled]` filtered to `atlas-slo-breach` (fires exactly once per
label transition — natural storm damper) plus `workflow_dispatch` (inputs:
`issue_number`, `source_id`, `dry_run` default `true`) for operator-driven runs.

**Runner choice — `anthropics/claude-code-action@v1` in explicit-prompt automation
mode.** Grounded basis: automation mode takes a `prompt` input directly (no `@claude`
mention needed; works on `schedule`/`workflow_dispatch`/issue events), with
`claude_args` as a CLI passthrough for `--allowedTools "…"`, `--model`, `--max-turns N`,
plus `anthropic_api_key`, `github_token`, and `settings` inputs. The action is a
maintained wrapper over the `claude` CLI, so it buys the mode-detection and GitHub-token
plumbing while `--allowedTools` retains exactly the tool-scoping control we need.
**Fallback documented, not chosen:** plain `npm install -g @anthropic-ai/claude-code`
+ `claude -p "<prompt>" --allowedTools … --output-format json` — take this path only if
we need bespoke stdout parsing beyond what "write your conclusion to a file, workflow
jq's it" covers (that file-based pattern is already how the change-check consumes
`--summary`). Minimal shape:

```yaml
- uses: anthropics/claude-code-action@v1
  with:
    prompt: ${{ steps.contract.outputs.prompt }}
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    claude_args: |
      --allowedTools "Read,Grep,Glob,Edit,Write,Bash(npm run changes:check*),Bash(npx vitest run packages/shadow-atlas*),Bash(curl -I *),Bash(git checkout -b remediate/*),Bash(git add *),Bash(git commit *),Bash(git push origin remediate/*),Bash(gh pr create *),Bash(gh issue comment *)"
      --max-turns 30
```

**Diagnosis prompt contract.** IN (assembled by a workflow step, fully self-contained):

1. the breach record JSON, verbatim from the issue body's fenced block;
2. the source's full registry row — critically `configSite`, the `file:line` the fix
   almost certainly lives at;
3. the recent attempt/error tail from the ledger (last 10 attempts);
4. repo facts: npm not pnpm; the acquisition test command; the allowed edit surface;
   the guardrails block verbatim.

OUT — exactly one of, never neither:

- **Fix PR**: branch `remediate/<source-id>/<YYYYMMDD>`, edits confined to
  source-acquisition config/code (`packages/shadow-atlas/src/{acquisition,providers,
  hydration,config,scripts}` + tests). Expected fix classes: vintage path bump
  (TIGER2024→TIGER2025), moved URL, renamed ArcGIS layer id, schema/Zod drift, header
  or throttle requirement, backoff tuning. PR body sections are mandatory: **Breach
  evidence** (record verbatim) / **Diagnosis** / **What was tried** (probe transcript)
  / **Fix** / **Proof** (test output + live-probe exit code) / **Rollback note**.
- **Escalation**: a comment on the breach issue carrying the same evidence triad —
  what failed, what was tried, proposed fix (or "no automatable fix: <reason>") — plus
  label `atlas-needs-human`.

**Test gates the PR must pass (in-job, before `gh pr create`):**

1. `npx vitest run packages/shadow-atlas/src/__tests__/unit/acquisition/` green;
2. `npm run changes:check -- --db /tmp/fresh.db --summary /tmp/s.json` completes exit 0
   on a fresh DB (bootstrap path intact);
3. a live HEAD probe of the corrected URL returns 2xx/3xx, transcript pasted into
   the PR's Proof section.

These run **inside the remediate job** because PRs created with the default
`GITHUB_TOKEN` do not trigger `pull_request` workflows (GitHub's anti-recursion rule) —
so repo CI on the PR requires either a human close/reopen or a repo-scoped fine-grained
PAT (`REMEDIATION_PAT`) later; in-job gates are the floor either way, and their output
in the PR body is the reviewable evidence.

**Auto-merge NEVER — a human merges.** On PR open the ledger row moves to
`remediating` with `remediation_ref` = PR URL; it returns to `ok` only when a
subsequent scheduled check actually succeeds (merged fix proven by the loop itself,
not by the merge event).

---

## Guardrails

Verbatim, non-negotiable, from the founder directive block:

> the agent lane fixes SOURCE-ACQUISITION config/code via TEST-GATED PRs only; it NEVER
> touches published artifacts, the signed manifest, trust pins, or the operator-
> dispatched publish; escalation must carry evidence (what failed, what was tried,
> proposed fix).

Operationalized:

- **Edit surface allowlist**: `packages/shadow-atlas/src/{acquisition,providers,
  hydration,config,scripts}` + their tests. Explicit denies: `.github/workflows/**`
  (no self-modification, no publish-workflow tampering), distribution signing /
  manifest / pin code, any published artifact path. Enforced twice: in
  `--allowedTools` scoping AND as a diff-check step that fails the job if the branch
  touches a denied path.
- **Secrets / token scoping per job**:
  - change-check job (exists): R2 keys (scoped use: the `change-detection/*` key only)
    + `GITHUB_TOKEN` with `issues: write, contents: read` — unchanged.
  - remediate job: `ANTHROPIC_API_KEY` in the agent step only; `GITHUB_TOKEN` with
    `contents: write` (branch push), `pull-requests: write`, `issues: write` — and
    nothing else: **no `actions:` permission** (cannot dispatch the quarterly publish),
    **no R2 secrets in its env, ever** (cannot write the checksum store, the atlas DB,
    or any artifact), no `id-token`. Read-only everywhere except branch-push and
    PR/issue creation.
  - dry-run job variant carries `issues: write` **only** — it cannot push even if
    prompted to.
- **The publish stays operator-dispatched**: `shadow-atlas-quarterly.yml` is human-
  triggered, and its manifest-pinned download + sha256 verification chain
  (L326-329, 429-449, 524-542) is the boundary the agent lane structurally cannot
  cross — there is no code path from a merged acquisition-config PR to a published
  artifact without the operator running the publish and its pin checks passing.
- **Blast radius of a wrong merge**: acquisition code only. The worst outcome of a
  bad agent PR that a human mistakenly merges is a broken *check*, which the next
  daily run surfaces red or as a fresh breach — never a corrupted published atlas.

---

## Failure modes of the loop itself

1. **Agent can't fix it** (upstream product discontinued, licensing wall, CAPTCHA,
   politics): escalation comment with the evidence triad + `atlas-needs-human` label;
   ledger → `escalated`; the lane will not re-fire for that source until a human
   removes the label. Silence is impossible by contract — a post-step asserts exactly
   one of {PR exists, escalation comment exists} and reddens the run otherwise (the
   meta-alarm).
2. **Runner quota / cost**: Actions minutes are free (public repo, standard runners).
   Anthropic API spend is the only metered cost: bounded by `--max-turns`, **one
   remediation run per source per 24h**, and a **global cap of 3 runs/day** (pre-flight
   step counts today's workflow runs and no-ops beyond the cap). Steady state = $0.
3. **Loop storm**: one open breach issue per source (dedupe-by-title, as P5 does);
   the `labeled` trigger fires once per transition; the pre-flight guard no-ops if an
   open PR matches `remediate/<source-id>/*` or ledger state is
   `remediating`/`escalated`; 72h cooldown after a merged fix that did not heal before
   a second attempt on the same source.
4. **Plausible-but-wrong fix**: human merge + the three in-job gates + the live-probe
   requirement; see blast-radius note above — published artifacts are unreachable.
5. **False-positive breach** (transient upstream outage — Census maintenance windows
   are real): retryBudget × daily cadence means ≥3 consecutive days of failure before a
   fetch-breach; tune budgets during the observation phase, not after arming.
6. **Fresh-ledger noise**: parallels the known first-R2-seeded-run caveat in the
   change-check (`shadow-atlas-change-check.yml:122-125`). Never-succeeded sources get
   one expectedInterval of staleness grace from registration; fetch-breach still
   applies so a genuinely dead new source is caught.
7. **The loop's own workflow breaks** (YAML rot, action deprecation, expired key): the
   daily schedule reddens — deliberately the same red-run-as-staleness-alarm posture
   the quarterly already uses (`shadow-atlas-quarterly.yml:87-97`).

---

## Rollout

1. **P14 first — observe only.** Registry + ledger + daily probe lane + breach
   evaluation + deduped breach issues, all inside the existing change-check workflow.
   No agent. Bake for ≥2 weeks of daily runs; tune `retryBudget`/
   `expectedIntervalDays` — and per-source probe methods against real upstream HEAD
   behavior — against the observed false-positive rate (target: zero spurious breach
   issues in a quiet week).
2. **P15 second — dry-run before arming.** Ship `shadow-atlas-remediate.yml` with
   `dry_run` defaulting `true`: the diagnose-only job (issues:write only) posts its
   diagnosis + proposed fix as a breach-issue comment — no branch, no PR, structurally
   no push permission. Human grades several real or induced-breach diagnoses.
3. **Arm.** Flip the default to `dry_run: false`; the PR lane goes live. Auto-merge
   stays off permanently; the operator publish ritual is unchanged.
4. **Growth.** New sources — slots 10-19 special districts via the scanner
   infrastructure (`jurisdiction.ts:255-305`), the provisioned `REDRAW_SIGNAL` feed
   (commons `redraw-guard.ts`, ledger-elevated), international expansions — join by
   adding one registry row each. That is the whole onboarding cost, and it is how
   directive (1) compounds: every district we can resolve stays resolvable because the
   source that feeds it cannot die silently.
