# GEOCODER OPTIONS — curing NOOP-MAP F1

Decision brief for D1. Research only — nothing here provisions anything or spends anything.
Sources are cited inline with access dates; internal anchors verified against the working tree 2026-07-03.

## The constraint

**Founder hard constraint (2026-07-03): no user address ever leaves infrastructure we control.**
A raw street address crossing to any third party fails the test — commercial geocoding APIs
*and* the federal Census Bureau geocoder alike (federal counts as third party). This eliminates
every hosted option **by policy, not price**: no pricing table below reverses it, and none of the
eliminated options can be revived by a discount. The eliminated options are retained in this doc
purely as the decision record.

This is not a new posture bolted on. The original design already encoded it:
`src/lib/core/shadow-atlas/client.ts:1229` defaults `NOMINATIM_URL` to
`${SHADOW_ATLAS_URL}/nominatim` — a **self-hosted relay mounted under our own atlas host** — and
the `resolveAddress` docstring (`client.ts:1231-1239`) names the pipeline "Fully sovereign …
Nominatim (self-hosted) … Zero external government API calls." The gap (NOOP-MAP F1) is that the
self-hosted instance the code was written for was never provisioned, not that the code ever
intended to send addresses elsewhere.

## The two-step pipeline

The Shadow Atlas resolves but cannot geocode today because resolution is two distinct steps and we
only built the second: **geocoding** (address text → coordinates) requires an address reference
dataset plus matching software, while **district resolution** (coordinates → H3 cell → district →
officials) is what the atlas actually is — 977 R2-hosted H3 cell chunks and a congressional
officials store, keyed by coordinates. The atlas has no address layer at all, so `resolveAddress`
(`client.ts:1245`) delegates step 1 to a Nominatim `/search` call and keeps steps 2–3 local; with
no live Nominatim anywhere (`shadow-atlas.commons.email` is NXDOMAIN, `NOMINATIM_URL` set in no
environment), every resolve — paid v1, person-layer verify, TEE gate-3 — dies at step 1 and
surfaces as the 502 `RESOLVE_FAILED` (`src/routes/api/v1/resolve-address/+server.ts:228`),
regardless of every other lever on the NOOP-MAP board (cascade step 9).

## The code contract

Whatever backs `NOMINATIM_URL` must speak this exact dialect (all anchors re-verified 2026-07-03):

| Anchor | Contract |
|---|---|
| `client.ts:1229` | `const NOMINATIM_URL = env.NOMINATIM_URL \|\| \`${SHADOW_ATLAS_URL}/nominatim\`` |
| `client.ts:43` | `SHADOW_ATLAS_URL` defaults to `http://localhost:3000` — the fallback is dead outside local dev |
| `client.ts:1256-1261` | `GET {NOMINATIM_URL}/search` with **structured** params: `street`, `city`, `state`, `postalcode`, `countrycodes` |
| `client.ts:1267-1269` | `format=jsonv2`, `limit=1`, `addressdetails=1` — jsonv2 is load-bearing: `place_rank` only exists in the jsonv2 shape |
| `client.ts:1271-1273` | `User-Agent: commons/1.0`, 15 s `AbortSignal.timeout` — **no auth param or header is sent** |
| `client.ts:1221-1226` | `geocodePrecision(place_rank)`: ≥28 → 1.0, 26–27 → 0.85, ≤25 or absent → 0.6 floor. A backend that omits `place_rank` flattens every resolution to 0.6 |
| `+server.ts:228` | Geocode failure surfaces as typed 502 `RESOLVE_FAILED` |

**Volume tiers used throughout** (the three paid resolve allowances,
`src/lib/server/billing/plans.ts:71/85/99`, verified 2026-07-03; the inactive floor is 1,000/mo at
`plans.ts:57`):

- **Tier S** — 25,000 resolves/mo (Starter cap) ≈ 0.010 req/s average
- **Tier O** — 150,000 resolves/mo (Organization cap) ≈ 0.058 req/s average
- **Tier C** — 500,000 resolves/mo (Coalition cap) ≈ 0.19 req/s average

Price benchmark: Cicero at **$0.03–0.04/lookup = $30–40 per 1k** (internal competitive-landscape
refresh 2026-05-26, `docs/research/competitive-analysis.md`). We make no claims of being fresher
than Cicero anywhere in this doc; the comparison is cost and sovereignty only.

## Live options

### Option 0 — Atlas-native address layer (FIRST-CLASS)

*"Why aren't we using the Shadow Atlas to geocode?" — because it has no address layer. This option
builds one, making the atlas geocoder-sovereign end to end.*

Ingest a public-domain address reference dataset into the shadow-atlas pipeline, build an
address→coordinate index distributed like the existing cell chunks (R2), normalize + match
server-side, and map match quality onto the existing `geocodePrecision` curve.

- **Data candidates** (all US-government/public-domain except OpenAddresses):
  - **Census TIGER/Line ADDRFEAT** — address-range features, the *same source family* as our
    boundary ingest; public domain; annual TIGER releases (census.gov TIGER/Line program).
    Range-interpolated, so precision maps to the 0.85 street band, not 1.0 rooftop.
  - **DOT National Address Database (NAD)** — ~**80 million address point records**, compiled
    2025-06-30 release (catalog.data.gov "National Address Database (NAD)", accessed 2026-07-03);
    public domain; partial state coverage (not all states contribute). Rooftop-grade points where
    present → honest 1.0 band.
  - **OpenAddresses** — "All data is openly licensed. Most sources only require attribution"
    (openaddresses.io, accessed 2026-07-03); per-source license review required before ingest —
    not uniformly public domain.
- **Serving cost at the 3 tiers** — effectively flat and negligible at all three. Index estimate
  5–15 GB compressed (ESTIMATE, scaled from 80M NAD records; unverified until built). R2 Standard:
  $0.015/GB-month storage, Class B reads $0.36/M, egress free (developers.cloudflare.com/r2/pricing,
  accessed 2026-07-03). At 15 GB + 2 chunk reads per resolve: **Tier S ≈ $0.24/mo, Tier O ≈
  $0.34/mo, Tier C ≈ $0.59/mo** — i.e. <$0.03 per 1k at Tier S falling to ~$0.001 per 1k at Tier C.
- **The real cost is the build, not the serving.** Ingest pipeline + normalization/matching
  (strict-normalized v1; libpostal as an option) + honest degradation ladder (exact point → 1.0,
  street/range interpolation → 0.85, ZIP-centroid fallback → 0.6 — reusing the existing
  `geocodePrecision` bands). **Matching quality is the risk**: the real geocoder moat is matching
  software, not data — "123 N Main St Apt 4" vs "123 North Main Street #4" is where geocoders live
  or die, and v1 strict normalization will miss real addresses that Nominatim's mature matcher
  catches. Build size ESTIMATE: weeks, and it **reopens buildable nodes** (see Phasing).
- **Freshness cadence**: NAD releases + annual TIGER carry naturally on the existing quarterly
  publish ritual (NOOP-MAP A-lever) — the address layer becomes one more artifact the quarterly
  dispatch stamps and ships.
- **License**: NAD/TIGER are US-government public domain — **no share-alike constraint at all**
  (explicitly unlike ODbL below). OpenAddresses: per-source attribution review before use.
- **Ops burden**: near zero once built (static R2 artifacts, no server to feed); the burden is
  upfront engineering + a permanent matching-quality QA obligation.
- **Time-to-live**: weeks (ESTIMATE) — too slow to be the F1 cure on its own.

### Option 1 — Self-hosted Nominatim (US extract)

Deploy `mediagis/nominatim` (single-container, current image `mediagis/nominatim:5.3`, Nominatim
5.3.2; import any region via `PBF_URL` — github.com/mediagis/nominatim-docker, accessed
2026-07-03) with the Geofabrik US extract, on hardware we control. Point `NOMINATIM_URL` at it.

- **Contract compatibility: exact.** It *is* Nominatim — structured `/search`, `jsonv2`,
  `place_rank` all native. Zero shim LOC. The `client.ts:1229` default was written for precisely
  this shape.
- **Import footprint** — verified planet numbers, US-extract estimates flagged as such:
  - `us-latest.osm.pbf` = **11.2 GB**, data through 2026-07-03 (download.geofabrik.de/north-america/us.html, accessed 2026-07-03).
  - Official docs only bracket the extremes: 2 GB RAM minimum; full planet wants **128 GB RAM,
    ≥1 TB disk, ~2.5 days** import on well-configured NVMe machines
    (nominatim.org/release-docs/latest/admin/Installation/, accessed 2026-07-03). No official
    US-extract sizing exists.
  - US-extract ESTIMATE (scaled, unverified until run): 32–64 GB RAM class for the import,
    ~150–300 GB NVMe, hours-to-a-day import. The import is the sizing driver, not query load.
- **Infra cost at the 3 tiers — flat**: one node covers all three (Tier C averages 0.19 req/s;
  even 50× bursts are trivial for a single Nominatim node). Verified price points, Hetzner
  15-June-2026 price table (docs.hetzner.com price-adjustment page, accessed 2026-07-03):
  - Dedicated-vCPU with verified RAM: **CCX33 16 GB €138.49/mo** (DE/FI; €140.99 US region),
    **CCX43 32 GB €275.99/mo** (DE/FI; €279.49 US region).
  - Shared-vCPU line runs €5.49–129.99/mo (CX23→CPX62, DE/FI); RAM per plan is not listed in that
    price table, so the cheap end is plausible-but-unverified for the import. A pragmatic pattern:
    import on a big box, then downsize to serve.
  - Hetzner auction/dedicated boxes are historically far cheaper per GB RAM but carry no
    price-stable citation — not counted on.
  - **Per-1k cost at CCX33 (€138.49/mo): Tier S €5.54/1k · Tier O €0.92/1k · Tier C €0.28/1k.**
    Every tier beats the Cicero benchmark ($30–40/1k) by 5×–140×; break-even vs Cicero-shaped
    pricing sits around 4k lookups/mo even on this deliberately conservative plan.
- **Cost posture, explicitly**: this is the arc's first recurring infra line (~€138/mo verified
  ceiling, likely less). Bootstrapping posture says recurring cost is customer-signing-gated —
  but F1 gates the *paid resolve API itself* (the P0 cold-start-escape), so the spend and the
  revenue path are the same lever. Whether that makes it the sanctioned exception or something to
  time against the first customer conversation is exactly the D1 call; the fallback that spends
  nothing is Option 4.
- **License — ODbL, with the nuance stated precisely: data-in, addresses never out.** ODbL governs
  the OSM *database* we import. Under the OSMF Geocoding Guideline, geocoding results are treated
  as insubstantial extracts; **share-alike does not apply to user queries/input addresses or to
  individual geocoding results**, and is only triggered by systematically reconstructing a
  substantial part of the OSM database. Attribution to OpenStreetMap is required on the
  app/geocoder surface, not on our stored resolutions (osmfoundation.org/wiki/Licence/
  Community_Guidelines/Geocoding_-_Guideline, accessed 2026-07-03). User addresses are sent only
  to our own instance — they never touch OSM infrastructure. Sovereignty test: **pass**.
- **Ops burden**: real but modest — one container + Postgres to patch, monitor, and re-import on a
  cadence (or run with OSM diff updates); disk growth watch; it joins the quarterly publish ritual
  naturally. This is the only live option with a server to babysit.
- **Time-to-live: days** (provision → import → smoke test → set `NOMINATIM_URL` +
  `RATE_LIMITER_ALLOW_MEMORY=1` per NOOP-MAP F16 → one real 200 resolve). O6 branch A executes it.

### Option 4 — Defer

Provision nothing. `/api/v1/resolve-address` keeps returning the typed 502 `RESOLVE_FAILED`
(`+server.ts:228`), and the person-layer address verify stays dead with it.

- **Cost at all 3 tiers: $0.** Perfectly aligned with the strictest reading of the bootstrapping
  posture.
- **What it actually means** (NOOP-MAP cascade step 9): with *every other lever flipped* — commit,
  both deploys, publish ritual, metering — the flagship endpoint still fails 100% of the time.
  Defer is only coherent if launch scope excludes address resolution entirely, which contradicts
  the resolve-API-as-P0-cold-start-escape strategy and leaves the paid surface undemonstrable to
  any prospect.
- **Ops burden**: zero. **Time-to-live**: n/a. **License**: n/a.

## Eliminated by constraint

Retained as the decision record. Facts below were verified before the constraint landed; none of
them change the outcome. **A raw user address leaving infrastructure we control fails the founder
test — eliminated by policy, not price.**

### ELIMINATED — Public nominatim.openstreetmap.org

The OSMF **usage policy** forbids this use regardless of the constraint: "an absolute maximum of
1 request per second," no heavy use, bulk geocoding "not encouraged," systematic queries forbidden,
periodic scripts capped at 4 req/min — the service exists "to power the search bar on
openstreetmap.org" on donated servers (operations.osmfoundation.org/policies/nominatim/, accessed
2026-07-03). The **rate limit** alone makes it an honest NO for a paid API; the address-egress
constraint makes it doubly dead. Contract-compatible (it is Nominatim), which is worth exactly
nothing here.

### ELIMINATED — LocationIQ (hosted Nominatim-compatible)

Free 5,000 req/day at 2 req/s, "Limited Commercial Use"; Developer $100/mo for 25,000/day; Startup
$200/mo for 60,000/day (locationiq.com/pricing, accessed 2026-07-03). Would have covered Tier
S–C at $100–200/mo (~$0.67–4.00/1k). Requires an auth key; `client.ts:1271-1273` sends no auth
param — a shim node would have been required. Every query is a user address on their servers.

### ELIMINATED — OpenCage (hosted)

X-Small €45/mo for 10,000 req/day ("about €0.15 per 1,000"); Small €110/mo for 30,000/day; Medium
€450/mo for 125,000/day (opencagedata.com/pricing, accessed 2026-07-03). Same auth-shim caveat,
same egress failure.

### ELIMINATED — geocode.maps.co (hosted)

Free 25,000 req/mo at 5 req/s (then throttled to 1 req/s); $15/mo for 100k; $40/mo for 300k;
$100/mo for 1M (geocode.maps.co, accessed 2026-07-03). The cheapest hosted path — Tier C for
~$40–100/mo — and the clearest demonstration that the elimination is policy, not price.

### ELIMINATED — Census Bureau geocoder

Free federal REST service, "only geocodes addresses that are within the United States, Puerto
Rico, and the U.S. Island Areas" (geocoding.geo.census.gov/geocoder/, accessed 2026-07-03). Not
Nominatim-shaped: returns TIGER-benchmark matches with **no `place_rank` equivalent**, so an
adapter node in `client.ts` (plus a precision mapping onto the `geocodePrecision` curve) would
have been required. Before the constraint this was the designated interim step-1 shim while the
atlas address layer was built (AMENDMENT 1). **Federal counts as third party** — every query is a
constituent's home address handed to a government server, which is precisely the trust posture
this product exists to avoid. The census-shim branch of O6/D1 is dead; TIGER data still flows
*into* Option 0 as public-domain source data — data-in is fine, addresses-out is not.

## Comparison table (live options only)

| | **0 · Atlas-native address layer** | **1 · Self-hosted Nominatim** | **4 · Defer** |
|---|---|---|---|
| Address egress | none — our R2 + our server | none — our instance | none — nothing runs |
| Contract compat | new code path (replaces the `/search` call; maps onto `geocodePrecision`) | exact, zero shim | n/a |
| `place_rank` fidelity | mapped: point→1.0, range→0.85, ZIP→0.6 | native | n/a |
| Infra $/mo | <$1 (R2; verified rates 2026-07-03) | €138.49/mo verified ceiling (CCX33 16 GB, Hetzner 2026-06-15 table); likely less | $0 |
| €/1k @ Tier S / O / C | ≈0.03 / 0.005 / 0.001 (serving only) | 5.54 / 0.92 / 0.28 (CCX33) | n/a |
| vs Cicero $30–40/1k | ~1000× cheaper (serving) | 5×–140× cheaper | ∞ (no product) |
| Build cost | weeks (ESTIMATE); reopens buildable nodes; matching-quality risk | none (config + import) | none |
| Ops burden | ~zero steady-state; matching QA forever | one server to babysit; re-import cadence | zero |
| License | NAD/TIGER public domain (no share-alike); OpenAddresses per-source review | ODbL: data-in only; addresses never out; app-level attribution | n/a |
| Time-to-live | weeks | **days** | never |

## Phasing

**Phase 1 — self-host Nominatim now.** O6 branch A: provision, import the 11.2 GB US extract, set
`NOMINATIM_URL` (+ `RATE_LIMITER_ALLOW_MEMORY=1`, F16) on CF Pages, verify one real 200 resolve.
Days to live, exact contract fit, zero code changes — no buildable nodes reopen. Sovereign from
day one: addresses go only to our instance.

**Phase 2 — atlas-native address layer later.** Ingest NAD + TIGER ADDRFEAT into the shadow-atlas
pipeline; publish the address index as R2 chunk artifacts on the existing quarterly ritual; match
server-side; retire the Nominatim dependency. Honest assessment: this is **weeks of build, not a
flip**, and it **reopens buildable nodes** — at minimum (1) an ingest/normalize pipeline node in
the shadow-atlas repo, (2) an address-match service node, (3) a `client.ts` node replacing the
`/search` call and mapping match class onto the `geocodePrecision` bands, plus test nodes for the
matching ladder. The matching-quality risk is real and should be measured against Phase 1's live
Nominatim before cutover (shadow-run both, compare match rates on real traffic).

**Both phases are sovereign, and OUR atlas stays the resolver in both.** Nominatim only ever
occupies step 1 (address → coordinates); steps 2–3 — H3 cell → district → officials — are the
atlas in Phase 1 and remain the atlas in Phase 2. Phase 1 throws nothing away: the confidence
curve, the route contract, and the resolution pipeline are untouched by the later swap. Phase 2's
trigger is economic and strategic (drop the last non-atlas dependency + the per-server ops line),
not corrective.

## Recommendation

**Option 1 — self-host Nominatim now — with Option 0 as the committed Phase 2.**

Among the live options: Option 4 (defer) is the only zero-cost path, but it leaves the P0
cold-start-escape endpoint failing 100% of requests after every other lever on the NOOP-MAP board
is flipped — deferring the geocoder is deferring the product. Option 0 alone is the right
destination but the wrong first move: weeks of build and an unproven matching ladder standing
between today and the first successful resolve, with the real geocoder risk (matching software
quality) unmeasurable until something live exists to compare against. Option 1 is exactly what
`client.ts:1229` was written for: exact contract fit, zero shim code, native `place_rank`, days to
live, and sovereign by construction — addresses never leave our infrastructure, and ODbL's
share-alike governs the map data we import, not the addresses our users type. Its verified cost
ceiling (€138.49/mo, Hetzner CCX33, 2026-06-15 price table; likely less after import-then-downsize)
beats the Cicero benchmark 5×–140× across all three plan tiers and is the single recurring line
that unblocks the surface meant to pay for it — the cleanest possible fit to the cost posture's
own exception logic, and the founder's call to make at D1. Run Phase 1 now; build Phase 2 behind
it and cut over only when shadow-run match rates say the atlas-native ladder is at parity.

DECISION: atlas-native straight — 2026-07-03 — founder call: geocoding joins the atlas (TIGER ADDRFEAT + NAD → R2 chunks + in-house normalizer/matcher on the existing CF footprint). <$1/mo marginal; the address never leaves our app server; no third party ever sees it; the build window costs nothing (no waiting customer). Nominatim bridge rejected (recurring €37–138/mo pre-customer + rented-metal trust class + singleton ops tail). Day-one match-rate metric is a hard condition of this decision — the confidence fail-down must never mask misses.
