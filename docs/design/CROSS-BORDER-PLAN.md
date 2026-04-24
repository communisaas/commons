# Cross-Border Coalition Support — Design Plan

> **Status:** DESIGN — with blockers (see audit banner)
> **Date:** 2026-03-17
> **Depends on:** CHUNKED-ATLAS-PIPELINE-SPEC.md (Phase 6), billing plans, OrgNetwork model
> **Scope:** Canada (CA), United Kingdom (GB), Australia (AU)

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Postal-resolver layer
> works; almost everything downstream is a stub or an aspirational
> cross-repo dependency. Concrete blockers:
>
> - **Postal → constituency resolvers are live** for CA / GB / AU:
>   `src/lib/core/location/resolvers/{canada-postal,uk-postcodes,australia-aec}.ts`
>   call represent.opennorth.ca / postcodes.io / AEC. Keep this plan
>   language for these.
> - **Representative lookup is a stub.**
>   `src/lib/server/geographic/rep-lookup.ts:~26-34` returns `[]` for
>   all non-US countries. Plan language that treats rep-lookup as
>   "fallback" or "partially working" is inverted — postal resolvers
>   are fine; rep lookup is the gap.
> - **Legislative abstraction layer has only `types.ts`.** No registry,
>   no per-country adapters, no delivery pipeline. Any Phase 1 work in
>   this plan that depends on `abstraction.md` is blocked until that
>   doc's ASPIRATIONAL items land.
> - **Referenced pipeline scripts (`build-chunked-mapping.ts`,
>   `export-officials.ts`, `validate-build.ts`) don't exist in
>   commons.** They live in the shadow-atlas package inside
>   voter-protocol. Effort estimates that assume these are
>   in-commons-edit-in-place are wrong; cross-repo coordination is
>   required. See `docs/specs/CHUNKED-ATLAS-PIPELINE-SPEC.md`.
> - **US congressional delivery is gated off** (`FEATURES.CONGRESSIONAL
>   = false`). Cross-border coalitions cannot target US reps today,
>   so any coalition-flow example involving US reps is blocked until
>   the flag flips.
> - **Schema lives in Convex.** §8.1 edits target `convex/schema.ts`.
>   `applicableCountries` already exists on templates
>   (`src/lib/types/template.ts`), not on `orgNetworks` — confirm
>   which table actually needs it before adding the field.
> - **Cross-border verification packet (`§5 CrossBorderVerificationPacket`,
>   per-country GDS, etc.) has no code footprint.** `verification-packet.ts`
>   has no country-aware logic; treat §5 as sketch.
> - **Storacha sunset 2026-05-31** affects IPFS pinning for all country
>   atlases; not covered below. See `CHUNKED-ATLAS-PIPELINE-SPEC.md`.

---

## 1. Executive Summary

Commons currently resolves US districts via the Shadow Atlas chunked IPFS pipeline and has stub resolvers for CA, GB, and AU that hit external APIs at request time. This plan extends the full chunked pipeline to three international markets, adds coalition billing for cross-border org networks, and defines how verification packets aggregate across country boundaries.

**Recommended sequence:** Canada first (closest data model, English-only, smallest boundary count relative to US), then UK (high civic engagement culture, good open data), then Australia (smallest market, most different electoral system).

---

## 2. Data Sources Per Country

### 2.1 Canada — 338 Federal Electoral Districts (Ridings)

| Item | Detail |
|------|--------|
| **Boundary source** | Elections Canada Redistribution shapefiles (GeoJSON/Shapefile) |
| **URL** | `elections.ca/content.aspx?section=res&dir=cir/geo` |
| **Format** | ESRI Shapefile (.shp) — convert to GeoJSON with `ogr2ogr` |
| **Riding count** | 338 (post-2023 redistribution; 343 effective next election) |
| **Officials source** | House of Commons Open Data (`ourcommons.ca/members/en`) |
| **Officials format** | XML/JSON API — name, party, riding, province, email, phone |
| **Postal code → riding** | Already implemented: `represent.opennorth.ca` API in `canada-postal.ts` |
| **Update cadence** | Electoral boundaries: per redistribution (~10 years). MPs: per election or by-election |
| **Slot mapping** | Slot 0: `fed` (House of Commons riding). Canada has no elected Senate — skip slot 1. Provincial legislatures could use slots 2-3 in future. |
| **Provinces** | 10 provinces + 3 territories. Province code in `extra.province` from resolver. |

**Data quality notes:**
- Elections Canada shapefiles are authoritative and freely redistributable.
- The `represent.opennorth.ca` API is community-maintained but reliable; it covers federal, provincial, and municipal boundaries. For the chunked pipeline we need raw shapefiles, not the API.
- Canadian postal codes map to Forward Sortation Areas (FSAs, first 3 chars) which can span multiple ridings. H3 resolution-7 cells resolve this ambiguity via point-in-polygon.

### 2.2 United Kingdom — 650 Parliamentary Constituencies

| Item | Detail |
|------|--------|
| **Boundary source** | ONS (Office for National Statistics) / Ordnance Survey Open Geography Portal |
| **URL** | `geoportal.statistics.gov.uk` — Westminster Parliamentary Constituencies |
| **Format** | GeoJSON download (also Shapefile, KML) |
| **Constituency count** | 650 (post-2023 boundary review) |
| **Officials source** | UK Parliament Members API (`members-api.parliament.uk/api/Members`) |
| **Officials format** | JSON REST API — name, party, constituency, contact details |
| **Postcode → constituency** | Already implemented: `postcodes.io` API in `uk-postcodes.ts` |
| **Update cadence** | Boundaries: per boundary review (~8-12 years). MPs: per general election or by-election |
| **Slot mapping** | Slot 0: `westminster` (House of Commons constituency). No elected upper house. Devolved assemblies (Scotland, Wales, NI) could use slots 2-4 in future. |
| **Regions** | 9 England regions + Scotland + Wales + Northern Ireland. Region in resolver `extra.region`. |

**Data quality notes:**
- ONS boundary data is Crown Copyright but freely licensed under the Open Government Licence.
- The `postcodes.io` API is open source and high-availability.
- UK postcodes are much finer-grained than US ZIP codes (~15 addresses per postcode vs ~5,000 per ZIP), so H3 res-7 cells will almost always map to a single constituency.
- Northern Ireland has unique considerations (cross-community representation, Stormont assembly) — Westminster-only for v1.

### 2.3 Australia — 151 Federal Electoral Divisions

| Item | Detail |
|------|--------|
| **Boundary source** | AEC (Australian Electoral Commission) — Electoral boundary GIS data |
| **URL** | `aec.gov.au/Electorates/gis/` |
| **Format** | ESRI Shapefile + MapInfo TAB — convert to GeoJSON |
| **Division count** | 151 (post-2024 redistribution) |
| **Officials source** | `aph.gov.au` (Australian Parliament House) — Members dataset |
| **Officials format** | XML/CSV download — name, party, electorate, state, contact |
| **Postcode → electorate** | Already implemented: AEC API in `australia-aec.ts` |
| **Update cadence** | Boundaries: per redistribution (~7 years). MPs: per election |
| **Slot mapping** | Slot 0: `fed` (House of Representatives division). Senators are state-wide (slot 1 if needed). State electorates could use slots 2-3. |
| **States/Territories** | 6 states + 2 territories. State in resolver `extra.state`. |

**Data quality notes:**
- AEC data is freely available under Creative Commons.
- Australia's compulsory voting means near-100% electoral roll coverage — supporter verification has a strong baseline.
- Many Australian postcodes span multiple electorates (especially in rural areas), making H3 cell resolution valuable.

---

## 3. Pipeline Extension

### 3.1 Current Architecture (US-only)

The chunked pipeline (CHUNKED-ATLAS-PIPELINE-SPEC.md) already specifies a country-keyed directory structure:

```
shadow-atlas-v3/
├── manifest.json          ← countries: { US: {...}, CA: {...}, ... }
├── US/
│   ├── districts/cd/...
│   ├── officials/...
│   └── merkle/...
├── CA/
│   ├── districts/fed/...
│   └── officials/...
└── ...
```

The `getManifest(country)`, `getChunkForCell(cellIndex, country)`, and `getOfficialsForDistrict(districtCode, country)` functions in `ipfs-store.ts` already accept a `country` parameter. The directory structure and IPFS fetch paths are country-aware by design.

### 3.2 Build Script Changes

**`build-chunked-mapping.ts`** — Changes required:

1. **Add `--country` flag** (already specified in Phase 6 of the pipeline spec). Each country run produces its own subdirectory.
2. **Country-specific boundary ingestion.** The worker architecture (fork + block-stride, R-tree PIP) is reusable. Each country needs:
   - A GeoJSON boundary loader (shapefile → GeoJSON conversion as a pre-step)
   - A slot definition registry per country (see Section 3.3)
   - A geographic extent definition (bounding box + ocean pre-filter regions)
3. **H3 resolution stays res-7.** The H3 grid is global — same resolution works everywhere. Parent chunking at res-3 also works (Canada: ~120 chunks, UK: ~15 chunks, Australia: ~80 chunks).

**`export-officials.ts`** — Changes required:

1. **Country-specific official sources.** Add importer functions per country:
   - CA: Parse `ourcommons.ca` XML/JSON → `CA/officials/{ridingId}.json`
   - GB: Fetch `members-api.parliament.uk` → `GB/officials/{constituencyId}.json`
   - AU: Parse `aph.gov.au` dataset → `AU/officials/{electorateId}.json`
2. **Schema adaptation.** The `OfficialsFile` interface needs country-specific fields:
   ```typescript
   // Shared fields: name, party, district_code, contact info
   // Country-specific: chamber names differ
   //   CA: "house-of-commons" (no elected senate)
   //   GB: "house-of-commons" (no elected lords)
   //   AU: "house-of-representatives" + "senate"
   ```
3. **No CWC codes for international.** The `cwc_code` field is US House-specific. International officials get `cwc_code: null`.

**`validate-build.ts`** — Changes required:

1. **Per-country cell count floors:**
   - US: >= 1,800,000 cells (existing)
   - CA: >= 200,000 cells (continental Canada land area)
   - GB: >= 50,000 cells (relatively small land area)
   - AU: >= 150,000 cells (large land area, sparse interior)
2. **Cross-layer checks become country-aware.** Currently checks `cd ↔ county` overlap for US. International countries start with single-layer (federal only), so cross-layer checks are skipped until sub-national layers are added.
3. **Officials completeness per country:**
   - CA: >= 338 riding files
   - GB: >= 650 constituency files
   - AU: >= 151 division files

**`pin-to-ipfs.ts`** — No changes needed. The `--directory` mode already pins the entire tree including all country subdirectories as a single UnixFS DAG. One root CID covers all countries.

### 3.3 Country Slot Registries

Each country gets its own slot definition. Initially only slot 0 (federal lower house) is populated. Future work adds sub-national layers.

```
CA Slot Registry (v1):
  Slot 0: FEDERAL_RIDING    → directory: "fed"     → 338 ridings
  Slot 1: (reserved: Senate — appointed, not elected)
  Slot 2: PROVINCIAL         → directory: "prov"    → future (Ontario: 124, Quebec: 125, etc.)
  Slots 3-23: reserved

GB Slot Registry (v1):
  Slot 0: WESTMINSTER        → directory: "westminster" → 650 constituencies
  Slot 1: (reserved: House of Lords — not directly elected)
  Slot 2: SCOTTISH_PARLIAMENT → directory: "scottish"   → future (73 constituencies + 56 regional)
  Slot 3: WELSH_SENEDD        → directory: "senedd"     → future (60 members)
  Slot 4: NI_ASSEMBLY         → directory: "ni"         → future (90 members)
  Slots 5-23: reserved

AU Slot Registry (v1):
  Slot 0: FEDERAL_DIVISION   → directory: "fed"     → 151 divisions
  Slot 1: FEDERAL_SENATE     → directory: "senate"  → state-wide (76 senators)
  Slot 2: STATE_ELECTORATE   → directory: "state"   → future (NSW: 93, VIC: 88, etc.)
  Slots 3-23: reserved
```

### 3.4 Manifest Schema Extension

The manifest already supports `countries: Record<string, CountryManifest>`. Each country's manifest includes its slot registry so the consumer can verify alignment at runtime.

### 3.5 Runtime Changes in Commons

**`ipfs-store.ts`** — Minimal changes. The `getManifest(country)`, `getChunkForCell(cellIndex, country)`, and `getOfficialsForDistrict(districtCode, country)` APIs already accept country codes. Need to:

1. **Add per-country manifest caching.** Currently `manifestCache` holds one manifest. Change to `Map<string, ManifestCacheEntry>` keyed by country code.
2. **Country-aware LRU keys.** Already implemented — cache keys are `${country}/${parentCell}` and `${country}/${districtCode}`.

**`resolvers/index.ts`** — The existing `resolveDistrict()` dispatcher routes by country code. For chunked pipeline mode, add a `resolveDistrictFromAtlas(country, lat, lng)` path that uses `getChunkForCell()` instead of the external API resolvers. The external API resolvers become fallbacks for when the chunked data isn't available.

**`client.ts`** — The `lookupDistrict()` function gains a `country` parameter (already specified in the pipeline spec Section 6.2.2). The country-specific slot registry determines which layer directory to query.

---

## 4. Coalition Billing

### 4.1 Current State

The billing model (`plans.ts`) defines four tiers:

| Plan | Price | Max Verified Actions | Max Seats |
|------|-------|---------------------|-----------|
| Free | $0 | 100 | 2 |
| Starter | $10 | 1,000 | 5 |
| Organization | $75 | 5,000 | 10 |
| Coalition | $200 | 10,000 | 25 |

The `OrgNetwork` model supports parent/child relationships: one owner org creates the network, other orgs join as members. Coalition tier is required to create networks (`networks/new/+page.server.ts` checks `subscription.plan === 'coalition'`).

### 4.2 Cross-Border Coalition Model

A coalition network can contain orgs from different countries. The network itself has no country — it's a coordination layer above national boundaries.

**Schema additions to `orgNetworks`** (`convex/schema.ts`):

```typescript
orgNetworks: defineTable({
  // ... existing fields ...
  applicableCountries: v.array(v.string()),  // ISO 3166-1 alpha-2 codes
  // Empty = unrestricted (any country). Non-empty = only orgs in listed countries can join.
}),
```

**Schema additions to `organizations`** (`convex/schema.ts`):

```typescript
organizations: defineTable({
  // ... existing fields ...
  countryCode: v.string(),  // Primary operating country, default "US"
}),
```

### 4.3 Shared Supporter Pools

The network detail page (`networks/[networkId]/+page.server.ts`) already computes:
- Total supporters across member orgs
- Unique supporters by email (cross-org dedup)
- Verified supporter count

For cross-border coalitions, extend these queries with country grouping:

```typescript
// Group supporter counts by country (Convex query)
const countsByOrg = new Map<Id<"organizations">, number>();
for (const orgId of activeMemberOrgIds) {
  const count = await ctx.db
    .query("supporters")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect()
    .then((rows) => rows.length);
  countsByOrg.set(orgId, count);
}
// Then join with organizations.countryCode for per-country breakdown
```

**Privacy invariant:** Supporter PII never crosses org boundaries. The network sees aggregate counts only. An org in the UK cannot see individual supporters from a Canadian member org. This is enforced at the query level — the network stats endpoint only returns counts, never records.

### 4.4 Coalition Billing Extension

For cross-border coalitions, the billing question is: who pays?

**Option A: Owner pays for all (recommended for v1).**
- The network owner org must be on Coalition tier.
- Member orgs can be on any tier (even Free).
- The owner's action/email/seat limits apply to network-wide campaigns.
- Simple, matches existing gating in `networks/new/+page.server.ts`.

**Option B: Federated billing (future).**
- Each org pays for its own tier.
- Network-wide campaigns consume from each org's quota proportionally.
- Requires per-org metering within network campaigns — significant complexity.

**Recommendation:** Ship Option A. Revisit federated billing only if real coalition customers request it.

---

## 5. Cross-Border Verification Aggregation

### 5.1 Current Verification Packet

The `VerificationPacket` (`verification.ts`) computes:
- **GDS** (Geographic Diversity Score): 1 - HHI over districts
- **ALD** (Author Linkage Diversity): unique messages / total messages
- **Temporal entropy**: Shannon entropy over hourly bins
- **Burst velocity**: peak/average hourly rate
- **CAI** (Coordination Authenticity Index): engagement depth metric
- **Tier distribution**: count per engagement tier (0-4)
- **District count**: number of unique districts

All of these are country-agnostic in computation — they work on abstract district IDs and action metadata.

### 5.2 Cross-Border Packet Composition

For a coalition campaign spanning multiple countries, the verification packet needs a **per-country breakdown** plus a **combined summary**.

```typescript
interface CrossBorderVerificationPacket extends VerificationPacket {
  // Existing fields become the combined/aggregate values

  /** Per-country breakdown */
  countries: Record<string, {
    total: number;
    verified: number;
    verifiedPct: number;
    gds: number | null;
    districtCount: number;
    tiers: TierCount[];
  }>;

  /** Countries with at least one action */
  countryCount: number;
}
```

**GDS for cross-border campaigns:** The GDS formula (1 - HHI) works at any geographic granularity. For cross-border campaigns, compute GDS at two levels:
1. **Intra-country GDS:** Diversity of districts within each country (existing computation).
2. **Inter-country GDS:** Diversity across countries (treat each country as a "district" in the HHI formula). High inter-country GDS means the campaign has genuine multinational support, not just one country with a few token international actions.

### 5.3 Report Rendering

The report HTML (`report.ts`) needs a country breakdown section:

```
┌──────────────────────────────────────────────────┐
│  Verification Packet — Climate Action Coalition    │
│                                                    │
│  Combined: 2,847 actions from 3 countries          │
│  ├── Canada:    1,204 actions (89 ridings)         │
│  ├── UK:          943 actions (142 constituencies)  │
│  └── Australia:   700 actions (58 divisions)        │
│                                                    │
│  Geographic Spread (inter-country): 0.94           │
│  "Broad multinational participation"               │
│                                                    │
│  [Per-country detail sections below]               │
└──────────────────────────────────────────────────┘
```

### 5.4 Decision-Maker Targeting

Cross-border campaigns target decision-makers in multiple countries. The template model already has `applicable_countries: String[]` — this field drives which countries' officials receive the report.

For a coalition campaign:
1. Each country's portion of the report is delivered to that country's decision-makers.
2. The combined verification packet is included in all deliveries (a UK MP sees that the campaign also has Canadian and Australian support).
3. Country-specific officials are resolved from the chunked IPFS store: `getOfficialsForDistrict(districtCode, country)`.

---

## 6. Effort Estimates

### 6.1 Canada (First Market) — ~3 weeks

| Task | Effort | Notes |
|------|--------|-------|
| Shapefile acquisition + GeoJSON conversion | 1 day | Elections Canada data is clean, well-documented |
| `build-chunked-mapping.ts` country support | 3 days | Add `--country` flag, CA boundary loader, geographic extent |
| CA officials importer | 2 days | `ourcommons.ca` API → officials JSON files |
| `validate-build.ts` CA checks | 1 day | Cell count floor, officials completeness |
| `ipfs-store.ts` per-country manifest cache | 0.5 days | Minor refactor |
| `client.ts` + resolver atlas fallback | 1 day | Wire `lookupDistrict(lat, lng, 'CA')` through chunked path |
| `organizations.countryCode` field add | 0.5 days | Convex schema update + backfill existing orgs as 'US' |
| Network country breakdown UI | 2 days | Per-country stats on network detail page |
| Cross-border verification packet | 2 days | Country grouping in `computeVerificationPacket()` |
| Report rendering country sections | 1 day | HTML template for per-country breakdown |
| Testing | 2 days | Pipeline validation, resolver tests, packet aggregation tests |
| **Total** | **~16 days** | |

### 6.2 United Kingdom (Second Market) — ~2 weeks

| Task | Effort | Notes |
|------|--------|-------|
| ONS boundary GeoJSON download | 0.5 days | Already in GeoJSON format |
| UK boundary loader + geographic extent | 1 day | Small land area = fewer chunks (~15) |
| UK officials importer | 1.5 days | Parliament API is well-structured |
| `validate-build.ts` GB checks | 0.5 days | Cell count floor, officials completeness |
| UK-specific slot registry | 0.5 days | Westminster only for v1 |
| Testing | 1.5 days | |
| **Total** | **~8 days** | Faster because pipeline infrastructure from CA is reusable |

### 6.3 Australia (Third Market) — ~2 weeks

| Task | Effort | Notes |
|------|--------|-------|
| AEC shapefile acquisition + conversion | 1 day | MapInfo TAB → GeoJSON conversion |
| AU boundary loader + geographic extent | 1.5 days | Large land area but sparse interior (ocean pre-filter important) |
| AU officials importer | 1.5 days | `aph.gov.au` dataset |
| AU Senate (state-wide) handling | 1 day | Slot 1: 76 senators across 6 states + 2 territories |
| `validate-build.ts` AU checks | 0.5 days | |
| Testing | 1.5 days | |
| **Total** | **~8 days** | |

### 6.4 Cross-Cutting Work (Done Once)

| Task | Effort | Notes |
|------|--------|-------|
| Coalition billing — owner-pays model | 1 day | Already mostly gated; add country_code to org |
| Cross-border verification aggregation | 2 days | Country breakdown in packet + report |
| Network UI country breakdown | 1.5 days | Stats page per-country sections |
| Template `applicable_countries` UI in org campaign creator | 1 day | Multi-select country picker |
| **Total** | **~5.5 days** | |

### 6.5 Grand Total

| Phase | Effort | Cumulative |
|-------|--------|------------|
| Cross-cutting infrastructure | ~5.5 days | 5.5 days |
| Canada | ~16 days | 21.5 days |
| United Kingdom | ~8 days | 29.5 days |
| Australia | ~8 days | 37.5 days |

**Approximately 8 weeks of focused work for all three countries.**

---

## 7. Recommended Sequence

### 7.1 Why Canada First

1. **Closest data model.** Federal ridings are directly analogous to US congressional districts. Single lower chamber, no elected upper house. The pipeline extension is the smallest conceptual leap.
2. **Language.** English-language officials data (bilingual display is a future enhancement, not a blocker).
3. **Geographic adjacency.** Cross-border campaigns between US and Canadian orgs are the most natural first coalition use case (climate policy, Great Lakes, border communities).
4. **Data quality.** Elections Canada data is excellent — clean shapefiles, stable API, well-documented.
5. **Time zones.** Overlap with US time zones means shared campaign timing works naturally.

### 7.2 Then UK

1. **High civic engagement culture.** Strong tradition of writing to MPs.
2. **Excellent open data.** ONS boundaries + Parliament API are first-class.
3. **Small geography.** ~15 H3 res-3 chunks covers all of Great Britain — fast to build, validate, and iterate.
4. **Devolved governments.** Scotland, Wales, NI assemblies provide a natural path to sub-national layer expansion (slots 2-4).

### 7.3 Then Australia

1. **Compulsory voting.** Near-universal electoral participation means supporter verification has strong baseline trust.
2. **Elected Senate.** First country where we populate slot 1 (state-wide senators), testing the multi-slot international path.
3. **Geographic challenges.** Large land area with sparse interior tests the ocean/desert pre-filter logic and chunk efficiency.

### 7.4 First International Market Recommendation

**Canada.** Ship Canada support with the cross-cutting infrastructure. Use a real Canadian org as the first international customer to validate the full loop: import supporters → create campaign → verification packet assembles with riding data → report delivers to Canadian MPs.

The UK and Australia can follow as fast-follows once the Canada pipeline proves the international extension pattern works end-to-end.

---

## 8. File-Level Implementation Paths (Commons Codebase)

### 8.1 Schema Changes

| File | Change | Lines |
|------|--------|-------|
| `convex/schema.ts` | Add `countryCode: v.string()` (default "US") to `organizations` | ~1 line near existing table |
| `convex/schema.ts` | Add `applicableCountries: v.array(v.string())` (default []) to `orgNetworks` | ~1 line near existing table |

### 8.2 Runtime — District Resolution

| File | Change |
|------|--------|
| `src/lib/core/shadow-atlas/ipfs-store.ts` | Change `manifestCache` from single object to `Map<string, ManifestCacheEntry>`. LRU keys already country-aware (`${country}/${parentCell}`). |
| `src/lib/core/shadow-atlas/client.ts` | Add `country` parameter to `lookupDistrict()`. Route through chunked IPFS path when atlas data available for country. |
| `src/lib/core/shadow-atlas/browser-client.ts` | Add `country` parameter to `lookupDistrictsFromBrowser()`. Load country-specific manifest CIDs from `VITE_IPFS_CID_ROOT`. |
| `src/lib/core/geographic/resolvers/index.ts` | `resolveDistrict()` — add `resolveDistrictFromAtlas(country, lat, lng)` path that uses chunked IPFS instead of external API resolvers. External APIs become fallbacks. |
| `src/lib/core/geographic/resolvers/canada-postal.ts` | Existing stub → keep as fallback for postal code lookups when atlas unavailable |
| `src/lib/core/geographic/resolvers/uk-postcodes.ts` | Existing stub → keep as fallback |
| `src/lib/core/geographic/resolvers/australia-aec.ts` | Existing stub → keep as fallback |

### 8.3 Verification Packet

| File | Change |
|------|--------|
| `src/lib/server/campaigns/verification.ts` | `computeVerificationPacket()` — add `countries` breakdown: group actions by org country, compute per-country GDS/tier/district stats. Add `countryCount` and inter-country GDS. |
| `src/lib/server/campaigns/report.ts` | `renderReportHtml()` — add country breakdown section when `countryCount > 1`. Per-country action counts, districts, inter-country GDS label. |

### 8.4 Organization Country

| File | Change |
|------|--------|
| `src/routes/org/new/+page.svelte` | Add country selector dropdown (ISO 3166-1 alpha-2) to org creation form |
| `src/routes/org/[slug]/settings/+page.svelte` | Show country in org settings (read-only after creation, or editable with migration) |
| `src/routes/org/[slug]/networks/[networkId]/+page.server.ts` | Add per-country supporter count breakdown via `groupBy` + org country join |
| `src/routes/org/[slug]/networks/[networkId]/+page.svelte` | Render country breakdown in network stats |

### 8.5 Pipeline Scripts (voter-protocol or shadow-atlas repos)

| File | Change |
|------|--------|
| `scripts/build-chunked-mapping.ts` | Add `--country` flag. Country-specific boundary loader, geographic extent, slot registry. |
| `scripts/export-officials.ts` | Country-specific importer functions (CA: ourcommons.ca, GB: Parliament API, AU: aph.gov.au) |
| `scripts/validate-build.ts` | Per-country cell count floors and officials completeness checks |

### 8.6 Test Plan

| Test File | What to Test |
|-----------|-------------|
| `tests/unit/geographic/cross-border-resolution.test.ts` (new) | `resolveDistrictFromAtlas('CA', lat, lng)` returns Canadian riding |
| `tests/unit/campaigns/cross-border-verification.test.ts` (new) | `computeVerificationPacket()` with multi-country actions produces country breakdown |
| `tests/unit/campaigns/cross-border-report.test.ts` (new) | `renderReportHtml()` with country breakdown renders per-country sections |
| `tests/integration/shadow-atlas/multi-country.test.ts` (new) | End-to-end: load CA manifest → resolve cell → get officials |

---

## 9. Open Questions

1. **Provincial/state legislatures.** When do we add sub-national layers? Recommendation: defer until at least one country has federal-level adoption. Sub-national data is country-specific and multiplies maintenance burden.
2. **Bilingual support (CA).** French-language riding names and MP data. The pipeline stores both — UI localization is a separate concern.
3. **Devolved parliaments (GB).** Scottish Parliament, Welsh Senedd, NI Assembly. Same answer as provincial: defer until Westminster-level adoption proves demand.
4. **Electoral system differences.** Australia uses preferential voting, UK uses FPTP, Canada uses FPTP. These don't affect district resolution but may affect how "verified constituent" is presented to officials.
5. **Cross-border Merkle trees.** Currently the Merkle snapshot is US-only (for ZK district proofs). Do international countries get their own Merkle trees? Recommendation: yes, one per country, when the ZK proof system is extended. Not needed for v1 coalition support.
6. **Currency handling for international billing.** Coalition tier is $200 USD. International orgs pay in USD for v1. Multi-currency support is a Stripe feature we can enable later.
