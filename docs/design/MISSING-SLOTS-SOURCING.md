# Missing-Slots Sourcing — Founder Decision Brief

Status: **APPROVED — Wave 1 + Wave 2 in full** (founder sign-off 2026-07-04; see DECISION at bottom)
Evidence date: all web sources fetched and adversarially verified 2026-07-04; all repo
citations checked against `voter-protocol/packages/shadow-atlas` and `commons` the same day.
Companion docs: `docs/research/CICERO-DATA-COMPARISON.md` (slot-occupancy correction),
`docs/design/RESOLUTION-FRESHNESS-REMAINING.md` (refresh/publish ledger).

---

## The directive (empty slots must be filled — 2026-07-04)

Founder directive, 2026-07-04: the empty slots **"can't be left missing."**

Where the 24-slot registry (`PROTOCOL_DISTRICT_SLOTS = 24`, `shadow-atlas/src/jurisdiction.ts:80`;
US taxonomy at `jurisdiction.ts:271-304`) stands today:

- **10 slot types populated** in the source DB — **93,828 districts** total: cd 444 (slot 0),
  sldu 1,964 (slot 2), sldl 4,879 (slot 3), county 3,235 (slot 4), place 32,620 (slot 5),
  unsd/elsd/scsd 13,330 (slots 7-9), cousub 36,492 (slot 20), aiannh 864 (slot 22).
  [Source-DB counts, recorded in the CICERO-DATA-COMPARISON correction, 2026-07-04.]
- **12 slots empty** — the directive's target set: **6** (City Council Ward), **10** (Community
  College District), **11** (Water/Sewer), **12** (Fire/EMS), **13** (Transit), **14** (Hospital),
  **15** (Library), **16** (Park/Recreation), **17** (Conservation), **18** (Utility),
  **19** (Judicial), **21** (Voting Precinct).
- Slot 1 (Federal Senate) is statewide — no sub-state geometry to source. Slot 23 is overflow,
  proposed below for census tracts.

Constraints this brief operates under (all inherited, none new): open license compatible with a
**republished, signed, commercially-metered** atlas; **$0 recurring cost** (bootstrapping posture);
fits the existing shapefile/GeoJSON → prefix-id → rtree → H3 pipeline; raw addresses never leave
our infra (no hosted lookup APIs as sources).

Method: three parallel source-hunt briefs (slots 21+6; slots 11-18; slots 19+10+tracts), then one
adversarial verification pass that re-fetched every load-bearing license text, killed coverage
overclaims, and confirmed the repo wiring findings. Only verified claims appear below.

## Verified source table (slot × source × coverage × license × effort)

Ranked by coverage-per-ingest-effort under the constraints. License marks: ✔ = text verified
2026-07-04; ⚠ = one-time confirmation required before the signed publish includes it.

| # | Source | Slot(s) | Coverage | License (verified) | Effort | Honest label |
|---|--------|---------|----------|--------------------|--------|--------------|
| 1 | TIGER 2020 PL VTDs (Census) | 21 | National, MT/OR partial [data.gov series: "Only Montana and Oregon do not have complete coverage"] | CC0/public domain ✔ (data.gov record lists CC0 1.0; live HEAD 200, 42.96 MB for TX) | Trivial — existing TIGER path, canonical GEOID20 | "2020-vintage VTD, frozen until 2030" |
| 2 | Census tracts (TIGER annual) | 23 (overflow) | National, ~85K tracts | Public domain ✔ | Trivial — one config addition to the existing TIGER path | `statistical`, not governance |
| 3 | Federal judicial: 28 U.S.C. §§ 81-131 statute + TIGER county dissolve | 19 | National, 94 districts; DOJ UST county→district page as cross-check | Public domain (statute + TIGER) ✔ | Low — dissolve script + composition table; edge cases DC/PR/territories/Yellowstone-into-D.Wyo. | `derived:statute`, near-static |
| 4 | EPA Community Water System Service Area Boundaries v3 (March 2026) | 11 | National: 44,000+ systems, ~99% of served population | PD-basis, **no explicit grant on page** ⚠ — 60% state/utility-submitted geometry rides on EPA republication convention; one-time EPA confirm before signing | Low — single national layer, PWSID ids | `service-area` (drinking water, not sewer), per-feature authoritative (60%) / EPA-modeled (40%) |
| 5 | EIA Electric Retail Service Territories (U.S. Energy Atlas, ORNL-sourced) | 18 | National service territories incl. co-ops/PUDs/munis | EIA reuse policy PD-basis ⚠ — third-party-contributed carve-out + DOE-contractor provenance; one-time confirm at ingest | Low — single layer, EIA utility ids | `service-area`, incl. IOUs (no elected board) |
| 6 | CO DOLA "All Special Districts in Colorado" (Socrata) | 11, 12, 14, 15, 16, 17 (CO only) | CO statewide, 4,235 districts | Public Domain ✔ (Socrata metadata) | Low — Socrata export, LGID ids | Per-state; scanned-drawings accuracy caveat verbatim in provenance; data as of 2026-01-04 (not "fresh-daily" — verified) |
| 7 | WI LTSB Municipal Wards | 6 (WI only) | WI statewide, all municipalities; semiannual collections through 2026 | Open ✔ ("This is open and publicly available data…", owner `WI_Legislature`, no use restriction) | Low — semiannual refresh hook | Per-state |
| 8 | VEST 2020 precincts (Harvard Dataverse, doi:10.7910/DVN/XPW7T7) | 21 (enrichment) | 50 states + DC, 2016-2020 only; post-2021 cadence stalled | CC BY 4.0 ✔ (Dataverse API `termsOfUse`) | Medium — heterogeneous per-state fields | Optional election-results overlay; never "current precincts" |
| 9 | ALGED council shapefiles (OSF mv5e6) | 6 (seed) | ~150 cities + ~130 counties (approx — paper paywalled, counts PLAUSIBLE not confirmed; 1,747-locality parent study, 1989-2021) | CC BY 4.0 ✔ (OSF license API) | Medium — synthetic ids (place GEOID + district), per-city vintage check | Pre-2022-redistricting snapshot |
| 10 | State judicial statute-dissolves (+ AR/UT-style portals) | 19 (per-state) | Per-state; whole-county circuits only (sub-county units — e.g. Cook subcircuits, TX JP precincts — not derivable) | TIGER PD + per-portal check | Medium-high — per-state statute curation | Per-state, `derived:statute` |
| 11 | Community-college derivations (WI now; IL/TX curated) | 10 | Few states initially; WI's 16 tech-college districts re-derivable from TIGER school layers + WTCS policy manual | Re-derived from TIGER = PD ✔; **CA blocked** (FoundationCCC, licenseInfo null) | High — per-state statutory composition tables | Per-state only, never national |
| 12 | TCEQ TX water districts (MUD/WCID/SUD) | 11 (TX governance) | TX statewide | Unverified ⚠ — one-time check | Low-medium | Per-state |
| 13 | Big-city open-data portals (NYC/LA/Chicago…) | 6 | Incremental; top-100 cities ≈ 20% of US population | Per-portal review — ingest only explicit PD/CC0/open terms | Highest marginal — OpenAddresses-shaped license triage | Per-metro |
| 14 | USGS Watershed Boundary Dataset (WBD, HUC-8/10/12) | 23 overflow alongside tracts (or 17 if treated as conservation-adjacent — final assignment at ingest) | National, complete | US federal work → public domain (standard USGS terms; confirm at ingest, zero expected risk) | Low — single national layer via the existing national-layer path | `hydrologic` — hydrologic units, NOT governance districts; closes Cicero's WATERSHED type |

**Disqualified on verified grounds** (do not revisit without new facts):

- **RDH (Redistricting Data Hub)** — license text verified verbatim: "solely for noncommercial
  use, not for any resale" + viral no-redistribution clause. Incompatible with a signed,
  commercially-metered atlas. Existing repo wiring (VTD GEOID extraction: `rdh-vtd-extractor.ts`,
  `rdh-scanner.ts`, `publish-source.ts:443-444` allowlist, + 5 further touchpoints found in
  verification: `input-validator.ts:263`, `authority-registry.ts:556`, `gap-detector.ts:629`,
  `tiger-expected-counts.ts:684`, `.env.example:103-104`/`PRODUCTION_READINESS.md:146-147`)
  must be re-pointed to TIGER-direct. Verification also found `data/vtd-geoids/` holds only a
  README — the 124,179 extracted GEOIDs were never committed, so re-extraction is required
  regardless and no RDH-derived artifact purge is needed. Fix `docs/VTD_CANONICAL_GEOIDS.md:9`
  (VTDs absent from *annual* TIGER/Line but present in the 2020 PL 94-171 product).
- **CA community college layer** — ArcGIS item `licenseInfo` null AND the item is a document link
  to a FoundationCCC (nonprofit) map; needs written permission.
- **CSDA California special-districts map** — proprietary (California CAD Solutions), no bulk download.
- **OSM** — ODbL share-alike contaminates the signed republished atlas.
- **Esri Living Atlas** — master-agreement redistribution restrictions.
- **Cicero / BallotReady** — subscription; violates $0-recurring posture.
- **HIFLD Open** — discontinued 2025-08-26, portal offline; its fire/EMS/hospital layers were
  facility POINTS, never district polygons. SeerAI/DataLumos archives remain PD — cross-check only.
- **NYU Marron "Atlas of Special Districts"** — does not exist (phantom lead; Marron's atlas is
  the Atlas of Urban Expansion).
- **FL Special District Accountability Program** — directory (~1,900 districts), no boundary GIS.
- **Dartmouth Hospital Service Areas** — analytic constructs, not governance districts.
- **TX Comptroller SPD sales-tax files** — sales-tax-levying subset only; supplement, never backbone.

## The honest coverage ceiling

What the verification pass proves **cannot be national today**, at any effort level consistent
with the constraints:

1. **Special-district governance boundaries (slots 12-17)** — structurally impossible national.
   The 2022 Census of Governments counts **39,555 special district governments** and publishes
   **zero polygons**; TIGER has no special-district layer. No federal boundary product exists,
   HIFLD is dead, and the only comprehensive state maps are CO (open) and CA (proprietary).
2. **City council wards (slot 6)** — no open national aggregation exists. RDH's "local
   redistricting resources" is a link directory, not hosted data (verified), and its license bars
   use anyway.
3. **Community college districts (slot 10)** — no national layer (TIGER file-availability table
   verified: no CC layer, no judicial layer). Statutory-composition derivation works per-state only.
4. **State judicial (slot 19, state tier)** — no national source; whole-county circuits derivable
   per-state from statute, sub-county judicial units not derivable at all.
5. **Current precincts (slot 21)** — **no source at any price under the constraints supports a
   "current precincts" claim.** TIGER VTDs are 2020-frozen until the 2030 cycle; VEST stalls at
   2020 (50-state) / 2022-24 (state-selective); post-2020 precincts live behind RDH's
   incompatible license. Slot 21 ships honestly as "2020-vintage VTD, MT/OR partial."

What **is** national today: slots 21 (2020-frozen VTDs), 19 federal (94 statute-derived
districts), 23 (~85K statistical tracts), and two **service-area proxies** — slot 11 water
(44K+ systems, ~99% served population, 60/40 authoritative/modeled per-feature labels) and
slot 18 electric — which are honest only under a `service-area` label, never as governance
districts.

Everything below that line is **per-state coverage we label per-state**: CO is the sole
multi-type statewide fill (4,235 districts across six slots); WI fills slot 6 statewide;
TX fills slot 11 governance-side (pending license check); ALGED seeds ~150 cities at a
pre-2022 vintage; big-city portals add per-metro increments. Manifests must carry the Census
of Governments per-state counts as the honesty denominator (e.g., "CO: 4,235 of ~4,400
CoG-counted units mapped") and per-feature provenance labels (`service-area`,
`derived:statute`, `statistical`, vintage, source license).

## Proposed ingest waves

**Wave 1 — national, open-license, highest coverage-per-effort (ranks 1-5).**
Five sources, all $0, all pipeline-native:

| Order | Source → slot | Gate before signed publish |
|-------|---------------|---------------------------|
| 1 | TIGER 2020 PL VTDs → 21 | none — CC0 verified |
| 2 | Census tracts → 23 | none — PD; must carry `statistical` label |
| 3 | Federal judicial dissolve → 19 | none — PD²; DOJ UST crosswalk validation |
| 4 | EPA CWS SAB v3 → 11 | ⚠ one-time EPA license confirmation (60% submitted geometry has no explicit grant) |
| 5 | EIA Electric Retail Service Territories → 18 | ⚠ one-time EIA/ORNL license confirmation |

Wave-1 accompanying hygiene (blocking for the publish path, not for ingest dev): the **RDH
removal sweep** — re-point VTD GEOID extraction to TIGER-direct, drop `RDH_USERNAME`/
`RDH_PASSWORD` from the `publish-source.ts` allowlist, clear all 5 additional touchpoints
listed above, correct `VTD_CANONICAL_GEOIDS.md:9`.

Wave-1 outcome if signed off: slots 11, 18, 19, 21, 23 go from empty to nationally populated
(two of them as labeled service-area layers), leaving only 6, 10, 12-17 slot-empty at the
national level — which the coverage ceiling above shows is a data-reality boundary, not an
effort boundary.

**Wave 1 addendum (2026-07-04, Cicero-parity enumeration directive).** Rank 14 — USGS WBD
watersheds — joins Wave 1: it was the single Cicero district type with no wave assignment,
it is national + public-domain + pipeline-native like ranks 1-3, and it needs no license
gate. With it, Wave 1 closes every Cicero boundary type except the local-council long tail
(Wave 2) — see the parity ledger in `docs/research/CICERO-DATA-COMPARISON.md`.

**Slot-21 currency addendum (2026-07-04).** The founder's currency directive produced a
dedicated verified lane for CURRENT precincts on top of the rank-1 2020 baseline:
`docs/design/PRECINCT-CURRENCY-LANE.md` — 23 CONFIRMED statewide between-census-updated
sources (50.9% of US population), 4 plausible barred, 24 none; ingest tracked as P19.
VEST (rank 8) remains the historical-election enrichment overlay; the currency lane
supersedes it as the "freshest available" path.

**Wave 2 — state-portal long tail (ranks 6-13), per-state labels mandatory.**
CO DOLA (six slots, CO statewide) → WI LTSB wards (slot 6, WI) → TCEQ TX water (slot 11 TX,
after its one-time license check) → VEST 2020 enrichment (slot 21 overlay) → ALGED seed
(slot 6, ~150 cities, per-city vintage check) → state judicial statute-dissolves (slot 19,
whole-county states first) → CCD derivations (slot 10: WI now, IL/TX curated, CA blocked) →
big-city portals (slot 6, explicit-open-license portals only). Each Wave-2 source lands with
its own license record in per-district provenance; no source enters the signed publish with
an unverified license.

**Explicitly OUT** (license-encumbered, subscription, dead, or phantom — the full disqualified
list above is binding): RDH as a data source in any form; CA CCD layer without written
FoundationCCC permission; CSDA map; OSM (ODbL); Esri Living Atlas; Cicero/BallotReady or any
paid/subscription source; HIFLD Open (archives = offline cross-check only); NYU Marron atlas;
FL SDAP; Dartmouth HSAs; TX Comptroller SPD files as a backbone. Nothing in either wave incurs
recurring cost.

## Serving dependency

**None of this reaches users without the M9 multi-district consumer wire-up — the 10
already-populated slots prove it.** The build side is already multi-slot: `build-h3-mapping.ts`
maps **all** 93,828 districts across 10 slot types into the cell chunks (no layer filter,
complete prefix→slot alias map). Yet users see congressional only, because the commons consumer
is slot-0-hardwired:

- `src/lib/core/shadow-atlas/client.ts:354` — `cellDistrictsToDistrict()` reads
  `cellDistricts.slots[0]` and throws if empty; every live resolve flows through it
  (`client.ts:440`).
- `src/lib/core/shadow-atlas/client.ts:469` — `lookupAllDistricts()` (the multi-slot reader)
  has **zero callers** (verified by grep, 2026-07-04).
- `src/lib/core/shadow-atlas/district-format.ts:40` — `CONGRESSIONAL_SLOT_INDEX = 0` is the
  serving contract.

Ten slots of data have sat consumer-invisible through every release to date. Ingesting waves
1-2 without M9 changes **nothing** user-visible — it grows the same invisible inventory.
Sequencing consequence: **M9 lands with (or before) Wave 1**, and the wave-1 acceptance check
is a resolve that returns multi-slot output from the built chunks, not a build-side count.
One further verification remains open from the 2026-07-04 correction: assert slot occupancy in
the **built** chunk-index when the next publish lands (source-DB occupancy is verified; built-chunk
occupancy is asserted-but-unchecked until then).

## DECISION

DECISION: **APPROVED IN FULL — Wave 1 + Wave 2** (founder, 2026-07-04).

1. **Wave 1** = ranks 1-5, national open-license, now. The **RDH removal sweep** is mandatory
   and doubly grounded: the verified license (noncommercial, no redistribution) forbids our
   commercial signed republication, **and** the founder independently confirms RDH is not
   current enough regardless — its precinct inputs stall at the 2020-2022 era (consistent
   with the VEST cadence finding above). Either ground alone kills it.
2. **Wave 2** = the state-portal long tail with mandatory per-state coverage labels; no source
   enters the signed publish with an unverified license.
3. The two ⚠ one-time license confirmations (EPA CWS SAB, EIA territories) are **publish
   gates** — ingest development may proceed ahead of them; signing may not.
4. **M9 is sequenced with (or before) Wave 1** as the serving prerequisite; wave-1 acceptance
   is a live resolve returning multi-slot output from built chunks, not a build-side count.
