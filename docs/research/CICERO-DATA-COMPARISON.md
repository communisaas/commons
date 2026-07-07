# Cicero vs. Shadow Atlas — Founder Comparison (from the verified mapping, all sources re-fetched 2026-07-04)

## The catalog gap

Cicero's data breadth genuinely exceeds ours, and by a lot: they serve 13 live district types (8 legislative plus school, judicial, census, county, watershed — confirmed in their API enum) across a curated catalog of ~380 US local jurisdictions and ~55 Canadian ones, plus national/provincial coverage in the UK, Germany, Australia, and New Zealand, against our one live slot — US congressional. They claim 10,000+ current US officials with structured contact fields including 12 social account types [vendor-claimed, sponsored SD Times piece 2025-10-03]; we serve exactly 537, with state/local reach only via paid per-query agentic search and empty international tables. They are also the incumbent Google itself named as a successor when the Civic Representatives API shut down 2025-04-30 [verified]. Our county/sldu/sldl data exists in the source DB but is unserved; the 24-slot architecture is latent, theirs is shipping. That is a multi-year data-operations catalog we do not have, and no positioning language changes it.

## Class-by-class table

| Class | What we have live | What Cicero has | Cadence: us / them | Who wins + why |
|---|---|---|---|---|
| **1. Boundary geometry** | US congressional only, served; county/sldu/sldl ingested but unserved; 24-slot architecture latent. Per-resolve `tigerVintage`/`boundaryAsOf` | 13 district types incl. school/judicial/county/census/watershed; ~380 US + ~55 CA local jurisdictions; UK/DE/AU/NZ national+provincial; catalog doc dated 2022-11-29, pre-acquisition [verified] | TIGER-annual, published / 2-week post-approval upload [vendor-claimed 2021, never benchmarked; public tracker frozen at the 2020 cycle] | **Cicero on breadth, decisively.** We win boundary provenance — they expose no boundary-source vintage at all [verified absence]. Their cadence claim beats ours but is unauditable: frame as "claimed-faster, unauditable," never concede "faster" |
| **2. Officials** | Exactly 537 (congress-legislators); state/local via agentic search, no DB; intl empty. `officialsAsOf` clock per resolve | "10,000+ current US officials" [vendor-claimed] spanning federal/state exec+leg + curated local; intl MPs; rich contact fields, 12 social types; committees self-admitted stale; no staff fields | Nightly-adjacent ours (clocked) / "daily refresh," same-day post-election [vendor-claimed]; per-record `last_update_date` only | **Cicero, ~20x on structured breadth.** Do not contest this class on coverage. Our only edges: the as-of clock, exactness of what we do claim, zero address egress |
| **3. Address layer** | Atlas-native geocoder, self-hosted NAD + ADDRFEAT; raw address never leaves infra we control (hard constraint, satisfied by design) | Hosted geocode via unnamed third party (omgeo-schema inference, evidenced both ends); "rooftop" + 150M-address claims [vendor PR, no methodology]; no on-prem; addresses stored under a purpose-limited but transferable/sublicensable license, best-efforts deletion [verified ToU] | NAD quarterly + ADDRFEAT annual, published / Melissa address base, unspecified | **Split.** Assume Melissa wins raw precision until we benchmark (their claims are PR, but the prior favors a first-rank address company). We win custody outright and permanently — architecturally unfixable for a hosted product |
| **4. Redraw signal** | 6 hand-curated state effective-dates; resolver fail-louds a confidence downgrade; no live feed | 2-week commitment [vendor, 2021]; `valid_on_or_after` future districts; free `redistricting_event` endpoint; tracker frozen 2021; zero public evidence on any 2023-26 redraw (AL/GA/NC/NY/LA/TX/MO/OH/CA) [verified absence of evidence] | Manual, published dates / claimed-fast, black-box since 2022 | **Split.** They win claimed 50-state coverage at low-medium confidence; we win auditability at high confidence. The asymmetry is the product: their freshness is a trust-me, ours is a show-you |
| **5. Trust pins / provenance** | sha256 + Ed25519 signed manifests, on-chain anchoring, three independent per-resolve as-of clocks | `valid_from`/`valid_to`/`last_update_date` + geocode `score`/`partial_match`. That is the entire surface — no dataset clocks, no boundary vintage, no changelog, no versioned releases, no signatures [verified absence] | Quarterly signed releases / none | **Us, outright.** No Cicero analogue exists. This plus Class-3 custody is the spearhead |

Pricing context for every row: Cicero is $0.0596/lookup at 5K down to $0.0088 at 1M [verified at cicerodata.com/pricing]. The old "$0.03-0.04" figure is true only at the 10K-25K tiers. Do not build a price umbrella above ~$0.01 for volume buyers.

## What Cicero structurally cannot offer

Only claims that survived verification:

1. **Address sovereignty.** Every Cicero lookup ships the raw address to their hosted cloud and onward to an unnamed third-party geocoder, stored under a purpose-limited but transferable/sublicensable license with best-efforts-only deletion and no on-prem option [verified: API docs + ToU]. As a hosted product this is architecturally unfixable. It is our hard constraint, satisfied by design.
2. **Auditable freshness.** They publish no boundary vintage, no dataset as-of clocks, no changelog, no versioned or signed releases [verified absence across docs, site, terms]. A customer cannot distinguish a Cicero district resolved against a current map from one resolved against a stale one. Our three per-resolve clocks and published effective dates make staleness inspectable.
3. **Cryptographic verifiability.** No signatures, no anchoring, no manifest hashes — a category they lack entirely, reinforced by ~4 years of dormant public comms and a tracker frozen at the 2020 cycle [verified].
4. **Fail-loud redraw semantics.** Cicero returns districts with no signal that a map is contested or newly redrawn; our resolver downgrades confidence and says so. Their mid-decade record 2023-26 is a public black box [verified absence of evidence — cite it as exactly that].
5. **Honest coverage enumeration, ironically.** Their own artifacts triply contradict the "9 countries at all levels" homepage claim (availability PDF: 7 countries; Melissa's own acquisition PR: 6, with UK/DE/AU/NZ explicitly national+provincial only) [verified]. Usable offensively, and a standard we must hold ourselves to.

## What this means for P11 + the refresh roadmap

The comparison does not change the top of the roadmap — it sharpens why it's the top, and it reorders the middle.

1. **The first operator-dispatched quarterly publish is now the whole ballgame, not just a checklist item.** Our entire winning axis is provable freshness, and until that dispatch lands, `officialsAsOf`/`boundaryAsOf` read `null` in prod. Cicero's weakness is unauditable freshness; ours today is *auditably null* — the worst possible version of our own pitch. Nothing else on the refresh roadmap matters until this flips.
2. **Do not chase their cadence.** Daily-officials parity is a data-ops treadmill Melissa already funds, against a vendor-claimed number we can't falsify. Our differentiation is not recency, it's provable recency: quarterly-with-clocks beats claimed-daily-without-clocks for any buyer who needs to audit. Skip cadence-parity investments entirely.
3. **The redraw-signal feed rises in relative priority.** The ledger ranks it LOW; the verified mid-decade black box argues it's the highest-leverage refresh item *after* the publish. Publishing effective dates + fail-loud downgrades for the 2023-26 redraws is a demonstrable, benchmarkable win in the one arena where Cicero has zero public record. Keep it posture-gated on feed-source cost, but move it ahead of the schedule-trigger and check-changes alarms in intent.
4. **Refresh unit economics must survive sub-cent competition.** At 100K+ credits Cicero is $0.009-0.016/lookup [verified]. Per-resolve refresh cost has to stay compatible with that, or we price on the provenance axis (verified-resolve premium) rather than the commodity-lookup axis. The comparison says: price the axis we win.
5. **Do not spend refresh money broadening the officials catalog pre-revenue.** 537 exact + agentic tail is the honest posture; a structured 10K-row DB is Cicero's moat, not ours.

## Claims discipline

What we still must not say:

- **Never "fresher than Cicero"** — congressional or otherwise. Their claimed cadence beats TIGER-annual. Correct frame: "their freshness is claimed and unauditable; ours is published and signed."
- **Never contest live breadth.** Our live reach is congressional-only. Do not cite the 24-slot architecture or CHUNKED-ATLAS spec slots as live coverage.
- **Never quote "$0.03-0.04/lookup" as Cicero's price.** Tier-bound: true only at 10K-25K; $0.009-0.016 at volume.
- **Never pitch their ToU as an unrestricted data land-grab.** The license grant is purpose-limited with a deletion clause. The honest — and still damning — form: hosted-only, raw addresses transit and are stored on infra they control under a transferable/sublicensable grant, best-efforts deletion, no on-prem.
- **Never say Cicero "missed" the 2023-25 redraws.** No public evidence either way. Say: "no auditable public record of handling any post-2022 redraw."
- **Mark as vendor-claimed, always:** 10,000+ officials, daily refresh, 2-week redistricting, rooftop precision, 3%/150M. None independently benchmarked.
- **Don't demo the clocks as live proof until the quarterly publish lands.** They read null in prod today. Provenance ≠ recency, and we've written that into our own ledger — keep it in the pitch.

Sources: cicerodata.com/pricing, app.cicerodata.com/docs, Cicero availability PDF (2022-11-29), Medium FAQ (2021-08-24), GlobeNewswire 2024-03-27, SD Times sponsored 2025-10-03, Yahoo 2024-11-13, dev.to ProgramEquity 2022-12-22, Google Civic turndown notice — all re-fetched 2026-07-04 per the verified mapping. Our-side facts: `docs/design/RESOLUTION-FRESHNESS-REMAINING.md` (commons), shadow-atlas live-reach memory (congressional-only, PRs #60/#61).

---
## CORRECTION (2026-07-04, post-publication — verified against the source DB + build code)
The "one live slot" framing UNDERSTATES our data. The source DB carries ~93K districts
across TEN slot types (cd 444, sldu 1,964, sldl 4,879, county 3,235, place 32,620,
unsd/elsd/scsd 13,330, cousub 36,492, aiannh 864), and `build-h3-mapping.ts` maps ALL of
them into the cell chunks (no layer filter; complete prefix→slot alias map). What is
congressional-only is (a) the commons CONSUMER (`cellDistrictsToDistrict` reads slot 0;
`lookupAllDistricts` has zero callers) and (b) OFFICIALS attachment (537 federal). The
honest boundary-type gap vs Cicero's 13 is therefore "10 shipped-in-data vs 13, consumer
wire-up pending (M9)" — they hold judicial/watershed/census we lack; we hold township/
tribal/3-way-school granularity. Officials depth, international, curated local
jurisdictions: their lead is unchanged. FOUNDER DIRECTIVE (2026-07-04): the empty slots
(6, 10, 11-19, 21) "can't be left missing" — sourcing hunt + ingest waves tracked in
docs/design/MISSING-SLOTS-SOURCING.md. Pending verification: slot occupancy in the BUILT
chunks (assert against the new build's chunk-index when the publish lands).

---
## PARITY LEDGER (2026-07-04 — directive: "resolve all public data Cicero has — and more")

Type-by-type against Cicero's 13-type API enum (8 legislative + school/judicial/census/
county/watershed). Status legend: **LIVE** = served today · **IN-DATA** = in source DB +
chunks, consumer wire-up = M9 · **W1/W2** = approved ingest wave (D2) · **GAP** = named,
with the honest reason.

| # | Cicero type | Our slot | Status | Path to parity-or-beyond |
|---|---|---|---|---|
| 1 | NATIONAL_LOWER (US House) | 0 | **LIVE** | — (the served slot) |
| 2 | NATIONAL_UPPER (US Senate) | 1 | **LIVE** | 100 senators attach via state match |
| 3 | NATIONAL_EXEC | n/a | GAP (trivial) | no polygon needed; static executive attach when officials lane opens |
| 4 | STATE_UPPER | 2 | **IN-DATA** (1,964) | M9 |
| 5 | STATE_LOWER | 3 | **IN-DATA** (4,879) | M9 |
| 6 | STATE_EXEC | state poly | boundary ✔ / officials GAP | 50-row static gubernatorial table is cheap; officials lane deliberately unchased pre-revenue (roadmap §5) |
| 7 | LOCAL (council) | 6 | **W2** | WI LTSB + ALGED (~150 cities) + big-city portals; place polys (slot 5, 32,620) live as city-level fallback. Cicero's own local coverage is ~380 CURATED jurisdictions — per-metro labels make our honest tail comparable, not embarrassing |
| 8 | LOCAL_EXEC (mayor) | 5 | boundary **IN-DATA** / officials GAP | same officials lane |
| 9 | COUNTY | 4 | **IN-DATA** (3,235) | M9 |
| 10 | SCHOOL | 7/8/9 | **IN-DATA** (13,330) | M9 — and 3-way unified/elementary/secondary granularity vs their single type |
| 11 | JUDICIAL | 19 | **W1** | federal 94 via §§81-131 statute-dissolve; state circuits W2 (whole-county states); sub-county circuits not derivable from open sources — labeled |
| 12 | CENSUS | 23 | **W1** | TIGER tracts ~85K, `statistical` label |
| 13 | WATERSHED | 23/17 | **W1 (addendum)** | USGS WBD HUC-8/10/12, PD national, `hydrologic` label — was the one unassigned type; closed by the 2026-07-04 addendum |

**The "and more" column — in-data or approved, no Cicero analogue:** VTDs/precincts
(slot 21, W1, CC0, "2020-vintage frozen until 2030"); townships/county-subdivisions
(slot 20, IN-DATA 36,492); tribal AIANNH (slot 22, IN-DATA 864); drinking-water service
areas (slot 11, W1, O8-gated); electric retail territories (slot 18, W1, O8-gated);
CO's six special-district slots + TX water districts (W2, per-state); school-type
granularity; and the provenance axis itself (three per-resolve clocks, signed manifests,
on-chain anchoring — category-absent at Cicero).

**Honest residual gaps after all approved waves:** structured officials depth (their
10K+ vendor-claimed vs our 537-exact + agentic tail — deliberate, roadmap §5; cheap
partial moves exist when wanted: 50 governors static, openstates/people CC0 ≈7.4K state
legislators); international boundaries (their UK/DE/AU/NZ national+provincial + ~55 CA
local vs our 4 officials-only ingest scripts — OSM/ODbL share-alike license review
required before any signed republish, design-deferred); sub-county judicial; MT/OR VTD
partial; CA community-college (blocked on FoundationCCC license). Serving gate for every
row above: **M9**, then the built-chunk occupancy assertion.
