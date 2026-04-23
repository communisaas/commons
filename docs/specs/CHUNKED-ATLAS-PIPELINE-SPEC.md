# Chunked Atlas Pipeline Specification

> **Spec ID:** CHUNKED-ATLAS-001
> **Version:** 1.0.0
> **Status:** LIVE (code landed) — one load-bearing migration task open: **Storacha pinning sunset on 2026-05-31** (see §4.4).
> **Date:** 2026-03-15 (design); 2026-04-23 (status reconciled)
> **Repos:** `commons` (consumer), `voter-protocol` (producer)
> **Supersedes:** Monolithic H3 mapping pipeline (ipfs-store.ts v1/v2, build-h3-mapping.ts)

## Implementation reconciliation (2026-04-23)

Components the spec originally marked as "to implement" are shipped:
- `build-chunked-mapping.ts` (partition by H3 res-3) — `voter-protocol/packages/shadow-atlas/scripts/build-chunked-mapping.ts`
- `pin-to-ipfs.ts` (directory mode + gateway verification) — same path
- `push-cids.ts` (CID → Cloudflare secrets) — same path
- `export-officials.ts` (queries `federal_members`, not the fabricated `officials` table) — same path
- `validate-build.ts` (7-check gate) — same path
- `ipfs-store.ts` (LRU + 7-day TTL + gateway failover) — `commons/src/lib/core/shadow-atlas/ipfs-store.ts`

Remaining rot and load-bearing gaps:

1. **Storacha is hardcoded as the primary pinning service** and Storacha is sunsetting on **2026-05-31** (~38 days from spec reconciliation). `pin-to-ipfs.ts` instantiates only Storacha; the "Pinata backup" referenced in its header comment is imported but never constructed. The `storacha.link/ipfs` fallback gateway listed in §5 will 404 after sunset. **Action required before 2026-05-31:** either refresh Storacha credentials (not possible if the space is being sunset) or wire Pinata / NFT.storage / alternative as primary, update the gateway chain, and re-pin.
2. **Chunk-count numbers in this spec are inconsistent.** §3 says ~783 chunks (res-3 parents of continental US); §7 example validation output shows 4,698 chunks; memory notes say 977. The 4,698 figure is almost certainly the multi-country × multi-slot total (US + CA + GB + AU + NZ across populated slots), not the per-country `cd` count. The spec should either pick one number and explain the scope, or show all three with their scopes.
3. **Example validation output (§7 lines 509-517) is presented as if from a real run** — precise cell counts, district counts, official counts. These were aspirational when the spec was DESIGN COMPLETE; now that the build has run in production, either replace with real output or label as "expected output format, illustrative."

The rest of this document describes the live pipeline. Where a claim is
Phase-2 / Storacha-post-sunset / unmeasured, a callout appears inline.

### Additional gaps (2026-04-23 audit addendum)

4. **Storacha uploads already disabled.** The provider cut off writes on
   **2026-04-15** — any quarterly build after that date cannot pin new
   content via the current Storacha wiring. Timeline is: write-disabled
   2026-04-15 → full sunset 2026-05-31. No "failed upload" diagnostic
   documented in the pipeline runbook.
5. **BEF redistricting fix (2026-03-29) is not reflected here.** 119th
   Congress redistricting touched ~1.08M blocks and a full-US re-pin
   completed on that date. Spec should name the CID rotation + record
   that clients have been cut over (or otherwise call out any
   stragglers). See MEMORY `bittensor_subnet_status.md` and the 03-29
   CI/CD cleanup entry.
6. **On-chain root anchor (Scroll L2 `SnapshotAnchor` contract) is
   unmentioned.** Quarterly root is anchored on Scroll per MEMORY; the
   client-side verification path that reads the contract belongs in
   this spec (or needs an explicit cross-reference). If the anchor is
   still pre-launch, mark it as Phase N.
7. **R2 versioning / cache-invalidation strategy for quarterly rebuilds
   is underspecified.** The doc notes a 7-day TTL but not whether
   paths are immutable-by-version or mutated in place, nor how the
   client detects a new quarterly root.

---

## 1. Problem Statement

The Shadow Atlas data pipeline is architecturally sound but operationally broken. Three critical failures prevent district data from reaching users:

1. **Memory impossibility.** The monolithic H3 mapping is 355 MB decompressed JSON. Cloudflare Workers have a 128 MB memory limit. The current `getDistrictMapping()` fetches the entire blob — it literally cannot work in production.

2. **Officials export is broken.** The quarterly pipeline's `export-officials` job queries `SELECT * FROM officials` — but the table is `federal_members`. The output format is a raw SQLite dump, not the district-keyed structure Commons expects. Officials have never been validly pinned to IPFS.

3. **CIDs never reach the app.** `pin-to-ipfs.ts` outputs `pin-results.json` with CIDs, but there is no automation to set `IPFS_CID_*` as Cloudflare secrets. The `.env` files are empty. The quarterly cron is commented out.

Additional structural debts:

- **Slot index mismatch.** Commons' `US_SLOT_NAMES` (client.ts:267-292) diverges from voter-protocol's canonical `CIRCUIT_SLOT_NAMES` (authority-mapper.ts:276-301) at slots 10-21. This is a correctness bug — proof verification will fail if slot semantics differ between proof generation and district lookup.
- **US-only address schema.** `ConstituentAddress` has no `country_code` field. The resolve-address endpoint hardcodes `z.enum(['US', 'CA'])`. International providers exist in voter-protocol (Canada, UK, Australia, NZ) but have no consumption path.
- **14 of 24 slots unpopulated.** Only slots 0-5 have nationwide US coverage. Slots 6-23 are sparse or empty, but the monolithic architecture makes it impossible to incrementally add layers.
- **Deprecated code persists.** `ingest-legislators.ts` is marked `@deprecated` but not removed. `convertV1CellDistricts()` handles a dead format. The HTTP fallback in `getOfficials()` is dead code.

This specification defines a replacement that eliminates all of the above.

---

## 2. Architecture Overview

### 2.1 Core Principle: One CID, Many Paths

Replace three separate IPFS CIDs with a single **UnixFS directory DAG** pinned to IPFS. All data is addressable via path resolution from one root CID:

```
GET /ipfs/{rootCID}/manifest.json                                    → 2 KB
GET /ipfs/{rootCID}/US/districts/cd/8728308ffffff.json               → 8 KB
GET /ipfs/{rootCID}/US/officials/CA-12.json                          → 2 KB
GET /ipfs/{rootCID}/US/merkle/cell-tree-snapshot.json                → 15-25 MB
GET /ipfs/{rootCID}/CA/districts/fed/832e349ffffffff.json            → 6 KB
```

IPFS gateways natively resolve paths within UnixFS directories. No CID-per-chunk management. No routing tables. One secret (`IPFS_CID_ROOT`), one TTL, one cache invalidation signal.

### 2.2 Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                         QUARTERLY BUILD                              │
│                                                                      │
│  shadow-atlas-full.db ──┬── build-chunked-mapping.ts ──→ chunks/    │
│                         ├── export-officials.ts ────────→ officials/ │
│                         └── build-cell-tree-snapshot.ts ─→ merkle/   │
│                                        │                             │
│                              validate-build.ts                       │
│                                   │ EXIT 0                           │
│                              pin-to-ipfs.ts ──→ rootCID              │
│                                   │                                  │
│                              push-cids.ts ──→ CF Pages secret        │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         RUNTIME LOOKUP                               │
│                                                                      │
│  hooks.server.ts: setRootCID(env.IPFS_CID_ROOT)                     │
│       │                                                              │
│  resolve-address endpoint                                            │
│       │                                                              │
│  1. Nominatim geocode ──→ (lat, lng)                                │
│  2. latLngToCell(lat, lng, 7) ──→ cellIndex                         │
│  3. cellToParent(cellIndex, 3) ──→ parentCell                        │
│  4. fetch /ipfs/{root}/{country}/districts/{layer}/{parent}.json     │
│     ~~8 KB per layer, LRU cached~~                                   │
│  5. chunk.cells[cellIndex] ──→ districtId                            │
│       │                                                              │
│  6. fetch /ipfs/{root}/{country}/officials/{districtId}.json         │
│     ~~2 KB, LRU cached~~                                             │
│       │                                                              │
│  7. Return district + officials to client                            │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.3 Memory Budget

| Component | Current | New |
|-----------|---------|-----|
| District mapping | 355 MB (impossible on CF Workers) | ~8 KB per chunk, LRU 50 = 400 KB |
| Officials dataset | ~504 KB (full dataset in memory) | ~2 KB per district, LRU 20 = 40 KB |
| Manifest | N/A | ~2 KB (one per CID) |
| Merkle snapshot | 15-25 MB (client-side only) | Unchanged (client-side) |
| **Total Worker memory** | **>355 MB (BROKEN)** | **~500 KB typical** |

---

## 3. Directory DAG Structure

```
shadow-atlas-v3/
│
├── manifest.json
│
├── US/
│   ├── districts/
│   │   ├── cd/                          # Slot 0: Congressional District
│   │   │   ├── 8728308ffffff.json       # Chunk: all res-7 cells under this res-3 parent
│   │   │   ├── 872830afffffff.json
│   │   │   └── ...                      # ~783 chunks for continental US
│   │   ├── sldu/                        # Slot 2: State Senate
│   │   │   └── ...
│   │   ├── sldl/                        # Slot 3: State House
│   │   │   └── ...
│   │   ├── county/                      # Slot 4: County
│   │   │   └── ...
│   │   ├── city/                        # Slot 5: City/Municipality
│   │   │   └── ...
│   │   ├── council/                     # Slot 6: City Council (where populated)
│   │   │   └── ...
│   │   ├── school-unified/              # Slot 7: Unified School District
│   │   │   └── ...
│   │   ├── township/                    # Slot 20: Township/MCD
│   │   │   └── ...
│   │   └── tribal/                      # Slot 21: Tribal/Native Area
│   │       └── ...
│   ├── officials/
│   │   ├── CA-12.json                   # One file per congressional district
│   │   ├── NY-14.json
│   │   ├── DC-AL.json
│   │   └── ...                          # ~441 files (435 + 6 non-voting)
│   └── merkle/
│       └── cell-tree-snapshot.json       # Sparse Merkle tree for ZK proofs
│
├── CA/                                   # Canada
│   ├── districts/
│   │   └── fed/                          # Slot 0: House of Commons ridings
│   │       └── ...
│   └── officials/
│       └── ...
│
├── GB/                                   # United Kingdom
│   ├── districts/
│   │   └── westminster/                  # Slot 0: Westminster constituencies
│   │       └── ...
│   └── officials/
│       └── ...
│
└── AU/                                   # Australia
    ├── districts/
    │   └── fed/                          # Slot 0: Electoral divisions
    │       └── ...
    └── officials/
        └── ...
```

### 3.1 Layer Directory Names → Slot Indices

Canonical mapping. This table is the **single source of truth** for directory-name-to-slot-index mapping. Both the build pipeline and consumption code derive from this table. Any drift is a regression.

| Slot | `CIRCUIT_SLOT_NAMES` (voter-protocol) | Directory Name | US Coverage |
|------|--------------------------------------|----------------|-------------|
| 0 | `CONGRESSIONAL` | `cd` | 100% |
| 1 | `FEDERAL_SENATE` | `senate` | 100% (state-wide, not chunked — single file) |
| 2 | `STATE_SENATE` | `sldu` | 100% |
| 3 | `STATE_HOUSE` | `sldl` | 100% |
| 4 | `COUNTY` | `county` | 100% |
| 5 | `CITY` | `city` | 100% |
| 6 | `CITY_COUNCIL` | `council` | ~50% (major metros) |
| 7 | `SCHOOL_UNIFIED` | `school-unified` | Partial |
| 8 | `SCHOOL_ELEMENTARY` | `school-elementary` | Rare |
| 9 | `SCHOOL_SECONDARY` | `school-secondary` | Rare |
| 10 | `COMMUNITY_COLLEGE` | `community-college` | ~1,000 districts |
| 11 | `WATER_SEWER` | `water` | CA primarily |
| 12 | `FIRE_EMS` | `fire` | CA, WA, OR, CO, TX |
| 13 | `TRANSIT` | `transit` | Minimal |
| 14 | `HOSPITAL` | `hospital` | CA, TX |
| 15 | `LIBRARY` | `library` | CA, IL, OR |
| 16 | `PARK_REC` | `park` | Minimal |
| 17 | `CONSERVATION` | `conservation` | Minimal |
| 18 | `UTILITY` | `utility` | Minimal |
| 19 | `JUDICIAL` | `judicial` | No state-wide |
| 20 | `TOWNSHIP` | `township` | Midwest/NE |
| 21 | `VOTING_PRECINCT` | `precinct` | Optional |
| 22 | `TRIBAL` | `tribal` | AIANNH areas |
| 23 | `OVERFLOW` | `overflow` | Reserved |

**Slot alignment status:** All three sources — `CIRCUIT_SLOT_NAMES` (authority-mapper.ts), `US_JURISDICTION` (jurisdiction.ts), and `DISTRICT-TAXONOMY` spec — now agree. Commons' `US_SLOT_NAMES` (client.ts) has been updated to match.

### 3.2 Chunk File Schema

```typescript
interface ChunkFile {
  /** Schema version. Must be 3. */
  version: 3;
  /** ISO 3166-1 alpha-2 country code */
  country: string;
  /** Layer directory name (e.g., "cd", "sldu") */
  layer: string;
  /** Circuit slot index (0-23) this layer maps to */
  slotIndex: number;
  /** H3 cell index of the res-3 parent cell */
  parentCell: string;
  /** H3 resolution of parent cell */
  parentResolution: 3;
  /** H3 resolution of child cells */
  cellResolution: 7;
  /** ISO 8601 generation timestamp */
  generated: string;
  /** Map of H3 cell index → district identifier string */
  cells: Record<string, string>;
  /** Count of entries in `cells` (for integrity check) */
  cellCount: number;
  /** SHA-256 hex digest of JSON.stringify(Object.entries(cells).sort()) */
  checksum: string;
}
```

**Size analysis:**
- Average ~2,400 res-7 cells per res-3 parent (1.88M cells / 783 parents)
- Each entry: ~30 bytes (15-char H3 key + 6-char district ID + JSON overhead)
- Average chunk: ~2,400 × 30 = ~72 KB uncompressed
- With gzip (IPFS gateway default): ~8-12 KB per chunk

### 3.3 Manifest Schema

```typescript
interface Manifest {
  /** Schema version. Must be 3. */
  version: 3;
  /** ISO 8601 generation timestamp */
  generated: string;
  /** Countries included in this build */
  countries: Record<string, CountryManifest>;
  /** Build pipeline metadata */
  pipeline: {
    /** Git commit hash of the build */
    buildCommit: string;
    /** Total build duration */
    buildDuration: string;
    /** Whether validate-build.ts passed */
    validationPassed: true;
    /** Canonical slot definitions (for client verification) */
    slotDefinitions: Array<{ index: number; name: string; directory: string }>;
  };
}

interface CountryManifest {
  /** Active layers for this country */
  layers: Record<string, LayerManifest>;
  /** Number of officials files */
  officialsDistrictCount: number;
  /** Merkle tree root hash (hex), null if no merkle snapshot */
  merkleRoot: string | null;
  /** Merkle tree depth */
  merkleDepth: number | null;
}

interface LayerManifest {
  /** Circuit slot index (0-23) */
  slotIndex: number;
  /** Number of chunk files */
  chunkCount: number;
  /** Total cell count across all chunks */
  cellCount: number;
  /** H3 resolution of parent cells */
  parentResolution: 3;
}
```

### 3.4 Officials File Schema

```typescript
interface OfficialsFile {
  /** Schema version. Must be 2. */
  version: 2;
  /** District code in commons format (e.g., "CA-12", "NY-14", "DC-AL") */
  district_code: string;
  /** State code */
  state: string;
  /** Congress number (e.g., "119th") */
  vintage: string;
  /** Array of officials serving this district */
  officials: Official[];
  /** Special status (e.g., "at-large", "non-voting") or null */
  special_status: string | null;
}

interface Official {
  bioguide_id: string;
  name: string;
  first_name: string;
  last_name: string;
  party: string;
  chamber: 'house' | 'senate';
  state: string;
  district: string | null;
  senate_class: number | null;
  phone: string | null;
  office_address: string | null;
  contact_form_url: string | null;
  website_url: string | null;
  cwc_code: string | null;
  is_voting: boolean;
  delegate_type: string | null;
}
```

---

## 4. Build Pipeline (voter-protocol)

### 4.1 `build-chunked-mapping.ts`

**Replaces:** `build-h3-mapping.ts`

**Reuses from predecessor:**
- Parallel worker architecture (fork + block-stride partitioning, 8 workers)
- R-tree PIP resolution logic (GeoJSON point-in-polygon with candidate ranking)
- Region enumeration (contiguous US + Hawaii + Alaska main + Aleutians)
- Ocean pre-filter via res-4 parent probe

**Changes to merge/output step:**

The current `build-h3-mapping.ts` (lines 357-713) collects all NDJSON lines into a single `mapping: Record<string, DistrictMapping>` object and writes one monolithic JSON file. The new script:

1. Receives NDJSON lines from workers: `{ cell: string, districts: (string|null)[] }`
2. For each cell, computes `parentCell = cellToParent(cell, 3)` using `h3-js`
3. For each non-null slot value, appends `{ cell, districtId }` to a per-layer, per-parent accumulator:
   ```
   accumulators[layer][parentCell][cell] = districtId
   ```
4. After all workers complete, writes each accumulator entry as a chunk file to:
   ```
   output/shadow-atlas-v3/{country}/districts/{layerDir}/{parentCell}.json
   ```
5. Computes SHA-256 checksum for each chunk
6. Writes `manifest.json` with chunk counts, cell counts, and slot definitions

**Parent resolution choice: res-3.**

| Resolution | Parent count | Avg cells/parent | Avg chunk size (uncompressed) |
|------------|-------------|-------------------|-------------------------------|
| 2 | ~127 | ~14,800 | ~444 KB |
| 3 | ~783 | ~2,401 | ~72 KB |
| 4 | ~5,481 | ~343 | ~10 KB |

Res-3 balances chunk count (manageable for IPFS directory) against chunk size (small enough for single-request fetch, large enough to amortize HTTP overhead). A single lookup fetches ~8-12 KB compressed.

**File:** `voter-protocol/packages/shadow-atlas/scripts/build-chunked-mapping.ts`

### 4.2 `export-officials.ts`

**Replaces:** Broken `export-officials` workflow job (wrong table name, wrong schema)

**Implementation:**

```
1. Open shadow-atlas-full.db (contains federal_members table)
2. Instantiate OfficialsService from src/serving/officials-service.ts
3. For each unique (state, district) pair in federal_members:
   a. Call officialsService.getOfficialsForDistrict(state, district)
   b. Transform to OfficialsFile schema (Section 3.4)
   c. Write to output/shadow-atlas-v3/{country}/officials/{districtCode}.json
4. Log summary: total districts, total officials, any vacancies
```

**Key correctness constraint:** The OfficialsService queries the `federal_members` table (not `officials`). The service already handles:
- House members: keyed by state + district number
- Senate members: keyed by state (always 2 per state)
- Non-voting delegates: DC, PR, GU, VI, AS, MP (keyed by territory code)
- CWC code generation: `H` + state FIPS + zero-padded district

**International extension:** If `canada_mps`, `uk_mps`, `au_mps` tables exist in the database, export those as well to `CA/`, `GB/`, `AU/` directories using the corresponding provider's official format.

**File:** `voter-protocol/packages/shadow-atlas/scripts/export-officials.ts`

### 4.3 `build-cell-tree-snapshot.ts` (Update)

**Existing file, modified** to read from chunked format instead of monolithic mapping.

**Change:** Replace the monolithic JSON load with a directory walk:

```
1. Walk output/shadow-atlas-v3/US/districts/*/
2. For each chunk file, read cells and accumulate into a flat cell→districts map
3. Proceed with existing Merkle tree construction (unchanged)
```

The Merkle tree structure itself is unchanged — it still produces a sparse Merkle tree over all cells with their 24-slot district commitments. Only the input reading changes.

**File:** `voter-protocol/packages/shadow-atlas/scripts/build-cell-tree-snapshot.ts`

### 4.4 `pin-to-ipfs.ts` (Update)

**Existing file, extended** with `--directory` mode.

**New behavior with `--directory`:**

```
1. Receive --directory output/shadow-atlas-v3/
2. Use Storacha client's uploadDirectory() to pin entire tree as UnixFS DAG
3. Storacha returns one root CID covering all files
4. Verify: HEAD request to gateway for manifest.json, one random chunk, one officials file
5. Write pin-results.json with rootCid, timestamp, verification status
```

**Backward compatibility:** `--artifact` mode retained during migration period, removed in Phase 5 cleanup.

**File:** `voter-protocol/packages/shadow-atlas/scripts/pin-to-ipfs.ts`

### 4.5 `push-cids.ts` (New)

**Purpose:** Automate CID → Cloudflare Pages secret, eliminating manual `wrangler pages secret put`.

```
1. Read pin-results.json → extract rootCid
2. Call Cloudflare API:
   PATCH /client/v4/accounts/{accountId}/pages/projects/{projectName}
   Body: { deployment_configs: { production: { env_vars: { IPFS_CID_ROOT: { type: "secret_text", value: rootCid } } } } }
3. Log confirmation with CID and project name
```

**Required secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

**File:** `voter-protocol/packages/shadow-atlas/scripts/push-cids.ts`

---

## 5. Validation Infrastructure

Validation is the gatekeeper between build and pin. No data reaches IPFS without passing every check. This is the primary regression prevention mechanism.

### 5.1 Build-Time Validation (`validate-build.ts`)

**File:** `voter-protocol/packages/shadow-atlas/scripts/validate-build.ts`

Runs after build, before pin. Exit 0 = proceed. Exit 1 = halt pipeline.

**Check 1: Manifest Structural Integrity**
```
- manifest.json exists and parses as valid JSON
- manifest.version === 3
- manifest.pipeline.slotDefinitions has exactly 24 entries
- Each slot definition's index, name, and directory match the canonical SLOT_REGISTRY (Section 3.1)
- Every country in manifest.countries has at least one layer
- Every layer has chunkCount > 0 and cellCount > 0
```

**Check 2: Chunk File Integrity**
```
For each layer declared in the manifest:
  For each chunk file on disk under that layer's directory:
    - File parses as valid JSON
    - chunk.version === 3
    - chunk.country matches parent directory
    - chunk.layer matches layer directory
    - chunk.slotIndex matches manifest's declared slotIndex for that layer
    - chunk.cellCount === Object.keys(chunk.cells).length
    - Recompute SHA-256 of JSON.stringify(Object.entries(chunk.cells).sort())
      → must match chunk.checksum
    - Every cell key is a valid H3 res-7 index (15-char hex, h3IsValid())
    - cellToParent(cellKey, 3) === chunk.parentCell for every cell
```

**Check 3: Coverage Completeness**
```
For each layer:
  - Union of all chunk cell sets === complete layer cell set
  - No cell appears in more than one chunk (disjoint partition)
  - Total cells across chunks === manifest's declared cellCount
  - For 'cd' layer specifically: total cells >= 1,800,000 (sanity floor)
```

**Check 4: Cross-Layer Consistency**
```
- Every cell in 'cd' (slot 0) also appears in 'county' (slot 4)
  (Congressional districts don't cross county lines for most cells)
- Warning (not error) if cell appears in 'cd' but not in 'sldu' or 'sldl'
```

**Check 5: Officials Completeness**
```
- Every unique district ID in the 'cd' layer has a corresponding officials file
- Every officials file has at least 1 official (warn on 0 — vacancy)
- Total officials files >= 435 (US House) + 100 (Senate) deduplicated by district
- Every official has a non-empty bioguide_id matching /^[A-Z]\d{6}$/
- Every house member has a cwc_code matching /^H[A-Z]{2}\d{2}$/
```

**Check 6: Slot Definition Alignment**
```
- manifest.pipeline.slotDefinitions matches CIRCUIT_SLOT_NAMES from authority-mapper.ts
  (This catches slot index drift between build and consumption)
```

**Check 7: Merkle Snapshot Consistency**
```
If US/merkle/cell-tree-snapshot.json exists:
  - Total cells in snapshot === union of all cells across all US layers (slot 0)
  - Snapshot root hash is a valid BN254 field element (< BN254_MODULUS)
  - manifest.countries.US.merkleRoot === snapshot root hash
```

**Output format:**
```
[PASS] Manifest integrity: 24 slots, 1 country, 6 layers
[PASS] Chunk integrity: 4,698 chunks, 0 checksum failures
[PASS] Coverage: 1,883,843 cells in 'cd', complete partition
[PASS] Cross-layer: 99.7% cd↔county overlap (4,892 edge cells excused)
[PASS] Officials: 441 districts, 541 officials, 0 vacancies
[PASS] Slot alignment: matches CIRCUIT_SLOT_NAMES
[PASS] Merkle consistency: root 0x1a2b... matches 1,883,843 cells

VALIDATION PASSED — safe to pin
```

### 5.2 Runtime Validation (in ipfs-store.ts)

Every fetched artifact is validated before caching:

**Manifest validation:**
```typescript
function validateManifest(data: unknown): Manifest {
  // 1. version === 3
  // 2. countries is non-empty object
  // 3. pipeline.slotDefinitions has 24 entries
  // 4. Each slot definition matches hardcoded SLOT_REGISTRY
  // Throws ManifestValidationError on failure → retry from fallback gateway
}
```

**Chunk validation:**
```typescript
function validateChunk(data: unknown, expectedParent: string, expectedLayer: string): ChunkFile {
  // 1. version === 3
  // 2. layer matches expectedLayer
  // 3. parentCell matches expectedParent
  // 4. cellCount === Object.keys(cells).length
  // 5. Recompute checksum → must match
  // Throws ChunkValidationError on failure → retry from fallback gateway
}
```

**Officials validation:**
```typescript
function validateOfficials(data: unknown, expectedDistrict: string): OfficialsFile {
  // 1. version === 2
  // 2. district_code matches expectedDistrict
  // 3. officials array is non-empty
  // Throws OfficialsValidationError on failure → retry from fallback gateway
}
```

### 5.3 Regression Detection: Implementation→Review Waves

Each implementation phase produces testable artifacts. Regressions are caught by layered checks before they compound.

**Wave structure:**

```
┌─────────────────────────────────────────────────────────────────┐
│  WAVE N: Implement                                               │
│    │                                                             │
│    ├── Unit tests for new code (vitest)                          │
│    ├── Integration test: build pipeline produces valid chunks    │
│    ├── Validation gate: validate-build.ts passes                 │
│    │                                                             │
│  WAVE N+1: Review                                                │
│    │                                                             │
│    ├── Diff audit: every deleted line has a replacement          │
│    ├── Slot alignment check: commons ↔ voter-protocol match     │
│    ├── Import graph: no dead imports, no circular deps           │
│    ├── Type check: tsc --noEmit passes in both repos            │
│    ├── Test count: must be ≥ previous wave (no test regression)  │
│    │                                                             │
│  Gate: WAVE N+1 review passes → proceed to WAVE N+2             │
└─────────────────────────────────────────────────────────────────┘
```

**Concrete review checks per wave:**

| Wave | Implementation | Review Gate |
|------|---------------|-------------|
| 1 | `build-chunked-mapping.ts` | Chunks validate with `validate-build.ts`; cell count matches monolithic |
| 2 | `export-officials.ts` | Every CD has officials; schema matches `OfficialsFile` type |
| 3 | `validate-build.ts` itself | Run against known-good AND known-bad fixtures; all checks fire |
| 4 | `ipfs-store.ts` rewrite | Existing tests pass; new chunk fetch tests pass; dual-mode works |
| 5 | `client.ts` slot fix + chunk lookup | Slot indices match canonical; lookup returns same districts as monolithic |
| 6 | `pin-to-ipfs.ts` directory mode | Pin + gateway fetch of random chunk succeeds |
| 7 | `push-cids.ts` | CID appears in Cloudflare project settings |
| 8 | Cleanup (delete old code) | `tsc --noEmit` passes; no dead imports; test count unchanged |

---

## 6. Consumption Pipeline (commons)

### 6.1 `ipfs-store.ts` Rewrite

**Current interface (to be replaced):**
```typescript
// OLD — fetches 355 MB monolith
export function setCIDs(cids: { districtMapping: string; officials: string; merkleSnapshot: string }): void;
export function isIPFSConfigured(): boolean;
export async function getDistrictMapping(): Promise<DistrictMappingData>;
export async function getOfficialsDataset(): Promise<OfficialsDataset>;
export async function getMerkleSnapshot(): Promise<MerkleSnapshotData>;
```

**New interface:**
```typescript
// NEW — on-demand chunk fetch
export function setRootCID(cid: string): void;
export function isIPFSConfigured(): boolean;
export async function getManifest(): Promise<Manifest>;
export async function getDistrictsForCell(country: string, layer: string, cellIndex: string): Promise<string | null>;
export async function getDistrictsForCellAllLayers(country: string, cellIndex: string): Promise<Record<string, string>>;
export async function getOfficials(country: string, districtCode: string): Promise<OfficialsFile>;
export async function getMerkleSnapshot(country: string): Promise<MerkleSnapshotData>;
export function clearCache(): void;
```

**Cache architecture:**

```typescript
// Per-isolate caches (CF Workers create new isolates per request batch)
const manifestCache: { cid: string; data: Manifest; fetchedAt: number } | null;

// LRU with 7-day TTL, keyed by "{country}/{layer}/{parentCell}"
const chunkCache: LRUCache<string, ChunkFile>;  // maxSize: 100, ~800 KB

// LRU with 7-day TTL, keyed by "{country}/{districtCode}"
const officialsCache: LRUCache<string, OfficialsFile>;  // maxSize: 50, ~100 KB
```

**LRU implementation:** Simple Map-based LRU (no external dependency). On set, if size exceeds max, delete oldest entry. On get, move to end. Total implementation: ~30 lines.

**Gateway fallback chain:**
```typescript
const GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs',
  'https://dweb.link/ipfs',
  'https://storacha.link/ipfs',
];

async function fetchFromIPFS(path: string): Promise<Response> {
  for (const gw of GATEWAYS) {
    try {
      const res = await fetch(`${gw}/${ROOT_CID}/${path}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return res;
    } catch { continue; }
  }
  throw new Error(`All IPFS gateways failed for ${path}`);
}
```

### 6.2 `client.ts` Updates

**6.2.1 Fix slot index mismatch**

Replace `US_SLOT_NAMES` (client.ts:267-292) with a mapping derived from the canonical `CIRCUIT_SLOT_NAMES`. The new mapping must match voter-protocol's `authority-mapper.ts:276-301` exactly:

```typescript
/**
 * Canonical slot → jurisdiction mapping.
 * MUST match voter-protocol's CIRCUIT_SLOT_NAMES (authority-mapper.ts:276-301).
 * Any divergence is a correctness bug — ZK proofs will verify against wrong slots.
 */
const SLOT_REGISTRY: ReadonlyArray<{
  slotIndex: number;
  name: string;
  directory: string;
  jurisdiction: string;
  label: string;
}> = [
  { slotIndex: 0,  name: 'CONGRESSIONAL',     directory: 'cd',               jurisdiction: 'congressional',     label: 'Congressional District' },
  { slotIndex: 1,  name: 'FEDERAL_SENATE',     directory: 'senate',           jurisdiction: 'federal-senate',    label: 'Federal Senate' },
  { slotIndex: 2,  name: 'STATE_SENATE',       directory: 'sldu',             jurisdiction: 'state-senate',      label: 'State Senate' },
  { slotIndex: 3,  name: 'STATE_HOUSE',        directory: 'sldl',             jurisdiction: 'state-house',       label: 'State House/Assembly' },
  { slotIndex: 4,  name: 'COUNTY',             directory: 'county',           jurisdiction: 'county',            label: 'County' },
  { slotIndex: 5,  name: 'CITY',               directory: 'city',             jurisdiction: 'city',              label: 'City/Municipality' },
  { slotIndex: 6,  name: 'CITY_COUNCIL',       directory: 'council',          jurisdiction: 'city-council',      label: 'City Council Ward' },
  { slotIndex: 7,  name: 'SCHOOL_UNIFIED',     directory: 'school-unified',   jurisdiction: 'school-unified',    label: 'Unified School District' },
  { slotIndex: 8,  name: 'SCHOOL_ELEMENTARY',  directory: 'school-elementary', jurisdiction: 'school-elementary', label: 'Elementary School District' },
  { slotIndex: 9,  name: 'SCHOOL_SECONDARY',   directory: 'school-secondary', jurisdiction: 'school-secondary',  label: 'Secondary School District' },
  { slotIndex: 10, name: 'COMMUNITY_COLLEGE',  directory: 'community-college', jurisdiction: 'community-college', label: 'Community College District' },
  { slotIndex: 11, name: 'WATER_SEWER',        directory: 'water',            jurisdiction: 'water-sewer',       label: 'Water/Sewer District' },
  { slotIndex: 12, name: 'FIRE_EMS',           directory: 'fire',             jurisdiction: 'fire',              label: 'Fire/EMS District' },
  { slotIndex: 13, name: 'TRANSIT',            directory: 'transit',          jurisdiction: 'transit',           label: 'Transit District' },
  { slotIndex: 14, name: 'HOSPITAL',           directory: 'hospital',         jurisdiction: 'hospital',          label: 'Hospital District' },
  { slotIndex: 15, name: 'LIBRARY',            directory: 'library',          jurisdiction: 'library',           label: 'Library District' },
  { slotIndex: 16, name: 'PARK_REC',           directory: 'park',             jurisdiction: 'park',              label: 'Parks/Recreation District' },
  { slotIndex: 17, name: 'CONSERVATION',       directory: 'conservation',     jurisdiction: 'conservation',      label: 'Conservation District' },
  { slotIndex: 18, name: 'UTILITY',            directory: 'utility',          jurisdiction: 'utility',           label: 'Utility District' },
  { slotIndex: 19, name: 'JUDICIAL',           directory: 'judicial',         jurisdiction: 'judicial',          label: 'Judicial District' },
  { slotIndex: 20, name: 'TOWNSHIP',           directory: 'township',         jurisdiction: 'township',          label: 'Township/MCD' },
  { slotIndex: 21, name: 'VOTING_PRECINCT',    directory: 'precinct',         jurisdiction: 'precinct',          label: 'Voting Precinct' },
  { slotIndex: 22, name: 'TRIBAL',             directory: 'tribal',           jurisdiction: 'tribal',            label: 'Tribal/Native Area' },
  { slotIndex: 23, name: 'OVERFLOW',           directory: 'overflow',         jurisdiction: 'overflow',          label: 'Other Special District' },
];
```

**NOTE ON PRIOR SLOT DRIFT:** `CIRCUIT_SLOT_NAMES` in `authority-mapper.ts` previously diverged from `US_JURISDICTION` in `jurisdiction.ts` at slots 10-23. This has been resolved — all three sources (authority-mapper, jurisdiction.ts, DISTRICT-TAXONOMY spec) now agree. Commons' `US_SLOT_NAMES` has been updated to match. Since no IPFS CIDs were ever set in production, no user data is affected.

**6.2.2 Replace monolithic lookup with per-chunk fetch**

```typescript
// OLD
export async function lookupDistrict(lat: number, lng: number): Promise<DistrictLookupResult> {
  const mapping = await getDistrictMapping();    // 355 MB
  const cellIndex = latLngToCell(lat, lng, H3_RESOLUTION);
  const cellDistricts = mapping.mapping[cellIndex];
  // ...
}

// NEW
export async function lookupDistrict(
  lat: number,
  lng: number,
  country: string = 'US',
): Promise<DistrictLookupResult> {
  const cellIndex = latLngToCell(lat, lng, H3_RESOLUTION);
  const districtId = await getDistrictsForCell(country, 'cd', cellIndex);
  if (!districtId) {
    throw new Error(`No district data for cell ${cellIndex}`);
  }
  return {
    district: { id: districtId, name: '...', jurisdiction: 'congressional', districtType: 'cd' },
    merkleProof: null,
    cell_id: cellIndex,
  };
}
```

**6.2.3 Replace monolithic officials lookup**

```typescript
// OLD
export async function getOfficials(districtCode: string): Promise<OfficialsResponse> {
  if (isIPFSConfigured()) {
    const dataset = await getOfficialsDataset();  // 504 KB entire dataset
    const entry = dataset.districts[districtCode];
    // ...
  }
  // HTTP fallback...
}

// NEW
export async function getOfficialsForDistrict(
  districtCode: string,
  country: string = 'US',
): Promise<OfficialsResponse> {
  const officials = await getOfficials(country, districtCode);  // ~2 KB single file
  return {
    officials: officials.officials,
    district_code: officials.district_code,
    state: officials.state,
    special_status: officials.special_status,
    source: 'congress-legislators',
    cached: false,
  };
}
```

**6.2.4 Remove dead code**

| Code | Location | Why |
|------|----------|-----|
| `convertV1CellDistricts()` | ipfs-store.ts | v1 format is dead; no CIDs were ever set |
| `CellDistrictsV1` interface | ipfs-store.ts | Same |
| `getDistrictMapping()` | ipfs-store.ts | Replaced by `getDistrictsForCell()` |
| `getOfficialsDataset()` | ipfs-store.ts | Replaced by `getOfficials()` |
| HTTP fallback in `getOfficials()` | client.ts:1001-1029 | IPFS is always-on in v3 |
| `toSubstrateDistrictKey()` | client.ts:155-166 | Officials keyed by commons format now |
| `IPFS_CIDS` 3-field object | ipfs-store.ts:41-48 | Replaced by single `ROOT_CID` |
| Old `setCIDs()` function | ipfs-store.ts:54-58 | Replaced by `setRootCID()` |

### 6.3 `hooks.server.ts` Update

```typescript
// OLD (3 CIDs)
setCIDs({
  districtMapping: process.env.IPFS_CID_DISTRICT_MAPPING || '',
  officials: process.env.IPFS_CID_OFFICIALS || '',
  merkleSnapshot: process.env.IPFS_CID_MERKLE_SNAPSHOT || '',
});

// NEW (1 CID)
setRootCID(process.env.IPFS_CID_ROOT || '');
```

### 6.4 Address Schema Internationalization

**File:** `src/lib/core/identity/constituent-address.ts`

Add `country_code` field:
```typescript
export interface ConstituentAddress {
  street: string;
  city: string;
  state: string;          // US/CA/AU: state code; GB/NZ: empty string
  zip: string;            // US: ZIP; CA: A1A 1A1; GB: postcode; AU/NZ: 4-digit
  country_code?: string;  // ISO 3166-1 alpha-2, defaults to 'US'
  district?: string;
}
```

**File:** `src/routes/api/location/resolve-address/+server.ts`

Expand validation:
```typescript
const addressSchema = z.object({
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  state: z.string().max(10),  // Relaxed from .length(2) for international
  zip: z.string().regex(
    /^\d{5}(-\d{4})?$|^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$|^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$|^\d{4}$/
    //  US ZIP          | CA postal                       | UK postcode                          | AU/NZ
  ),
  country: z.enum(['US', 'CA', 'GB', 'AU', 'NZ']).default('US'),
});
```

---

## 7. Quarterly Pipeline (GitHub Actions)

**File:** `voter-protocol/.github/workflows/shadow-atlas-quarterly.yml` — full rewrite.

### 7.1 Pipeline Structure

```
┌──────────────────────────────────────────────────────────────┐
│  TRIGGER: workflow_dispatch OR cron (quarterly)               │
│  INPUTS: db_source (URL), countries (comma-separated)         │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  JOB: build (90 min)                                          │
│  1. Download shadow-atlas-full.db                             │
│  2. For each country: build-chunked-mapping.ts                │
│  3. export-officials.ts                                       │
│  4. build-cell-tree-snapshot.ts (reads from chunks)           │
│  5. validate-build.ts → EXIT 0 required                       │
│  6. Upload artifact: shadow-atlas-v3/                         │
└──────────────┬───────────────────────────────────────────────┘
               │ (only if validate passes)
               ▼
┌──────────────────────────────────────────────────────────────┐
│  JOB: pin (30 min)                                            │
│  1. Download build artifact                                   │
│  2. pin-to-ipfs.ts --directory shadow-atlas-v3/               │
│  3. Verify: gateway fetch of manifest + random chunk          │
│  4. Output: root_cid                                          │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  JOB: deploy-cids (5 min, environment: production)            │
│  1. push-cids.ts --project commons --variable IPFS_CID_ROOT   │
│  2. Verify: read back secret via CF API                       │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  JOB: notify (always)                                         │
│  1. Create GitHub issue with results                          │
│  2. Optional Slack webhook                                    │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Quarterly Schedule

```yaml
schedule:
  # Quarterly: 1st day of Jan, Apr, Jul, Oct at 2 AM UTC
  - cron: '0 2 1 1,4,7,10 *'
```

This replaces the currently commented-out cron. The schedule aligns with congressional session boundaries and Census data refresh cycles.

---

## 8. Deprecation & Removal Ledger

Every removal has a replacement. No code is deleted without its successor being tested.

### 8.1 voter-protocol Removals

| File/Code | Status | Replacement | Remove In |
|-----------|--------|-------------|-----------|
| `scripts/build-h3-mapping.ts` | DEPRECATED by this spec | `scripts/build-chunked-mapping.ts` | Phase 5 |
| `src/scripts/ingest-legislators.ts` | Already marked `@deprecated` | `scripts/export-officials.ts` | Phase 5 |
| `shadow-atlas-quarterly.yml` (old jobs) | Broken | New workflow (Section 7) | Phase 5 |
| `output/h3-district-mapping.json.br` | Build artifact | Chunk files under `shadow-atlas-v3/` | Phase 5 |
| `output/h3-mapping-metadata.json` | Build artifact | `manifest.json` | Phase 5 |
| `pin-results.json` (old format) | Output artifact | New format with `rootCid` field | Phase 5 |

### 8.2 commons Removals

| Code | File | Lines | Replacement | Remove In |
|------|------|-------|-------------|-----------|
| `IPFS_CIDS` (3-field object) | `ipfs-store.ts` | 41-48 | Single `ROOT_CID` string | Phase 5 |
| `setCIDs()` | `ipfs-store.ts` | 54-58 | `setRootCID()` | Phase 5 |
| `CellDistrictsV1` interface | `ipfs-store.ts` | ~90-95 | Dead — never used in production | Phase 5 |
| `convertV1CellDistricts()` | `ipfs-store.ts` | ~100-107 | Dead — never used in production | Phase 5 |
| `getDistrictMapping()` | `ipfs-store.ts` | ~272-290 | `getDistrictsForCell()` | Phase 5 |
| `getOfficialsDataset()` | `ipfs-store.ts` | ~298 | `getOfficials()` (per-district) | Phase 5 |
| `US_SLOT_NAMES` (wrong slots 10-21) | `client.ts` | 267-292 | `SLOT_REGISTRY` (canonical) | Phase 3 |
| `toSubstrateDistrictKey()` | `client.ts` | ~155-166 | Officials keyed by commons format | Phase 5 |
| HTTP fallback in `getOfficials()` | `client.ts` | ~1001-1029 | IPFS-only path | Phase 5 |
| 3 env vars in `hooks.server.ts` | `hooks.server.ts` | 33-37 | Single `IPFS_CID_ROOT` | Phase 5 |
| Old env vars in Cloudflare | CF Pages settings | N/A | `IPFS_CID_ROOT` | Phase 5 |

### 8.3 Removal Safety Protocol

Before deleting any code:

1. **Grep for all references.** Every import, every call site, every test reference.
2. **Verify replacement is tested.** The new code path has tests that cover the same cases.
3. **Type-check both repos.** `tsc --noEmit` must pass after removal.
4. **Run full test suite.** Test count must not decrease (tests that tested old code must be migrated to test new code, or explicitly removed with justification).

---

## 9. Design Patterns & Abstractions

### 9.1 Strategy Pattern: Country-Specific Cell Resolution

Different countries use different geographic cell systems. The H3 grid works well for the US but may not be optimal for all countries. Encapsulate cell resolution behind a strategy interface:

```typescript
interface CellResolutionStrategy {
  /** Compute the cell index for a coordinate */
  coordinateToCell(lat: number, lng: number): string;
  /** Compute the parent cell for chunking */
  cellToChunkKey(cellIndex: string): string;
  /** Resolution level name (for logging/debugging) */
  readonly resolution: string;
}

class H3CellStrategy implements CellResolutionStrategy {
  coordinateToCell(lat: number, lng: number): string {
    return latLngToCell(lat, lng, 7);
  }
  cellToChunkKey(cellIndex: string): string {
    return cellToParent(cellIndex, 3);
  }
  readonly resolution = 'h3-res7';
}
```

Initially all countries use H3. The strategy pattern allows future countries to use national statistical geographies (UK output areas, Canadian dissemination areas) without changing the fetch pipeline.

### 9.2 Registry Pattern: Canonical Slot Definitions

The slot registry is the single source of truth shared between build and consumption. Both repos must derive their slot logic from the same canonical definition. In voter-protocol, this is `CIRCUIT_SLOT_NAMES` in `authority-mapper.ts`. In commons, this becomes `SLOT_REGISTRY`.

**Invariant:** `SLOT_REGISTRY[i].name === CIRCUIT_SLOT_NAMES[i]` for all `i` in `[0, 23]`.

**Enforcement:** `validate-build.ts` Check 6 verifies the manifest's slot definitions match the canonical list. The manifest carries the slot definitions so the consumer can verify at runtime that its `SLOT_REGISTRY` matches the producer's definitions.

### 9.3 Builder Pattern: Chunk Accumulator

The build pipeline uses an accumulator that collects cells from worker NDJSON output and partitions them into chunk files:

```typescript
class ChunkAccumulator {
  private chunks: Map<string, Map<string, Map<string, string>>>;
  // chunks[layer][parentCell][cellIndex] = districtId

  addCell(cellIndex: string, slotIndex: number, districtId: string): void;
  flush(outputDir: string, country: string, generated: string): FlushResult;
}
```

The accumulator handles:
- Partitioning cells by `cellToParent(cell, 3)` into chunk groups
- Mapping slot indices to layer directory names
- Computing SHA-256 checksums per chunk
- Writing chunk files with correct schema
- Generating the manifest

### 9.4 Cache-Aside Pattern: LRU with TTL

The chunk cache uses a cache-aside pattern: the caller checks the cache first, and on miss, fetches from IPFS, validates, and populates the cache.

```typescript
class TTLCache<K, V> {
  private map: Map<K, { value: V; insertedAt: number }>;
  private readonly maxSize: number;
  private readonly ttlMs: number;

  get(key: K): V | undefined;
  set(key: K, value: V): void;
  clear(): void;
}
```

**Eviction policy:** On `set`, if `map.size >= maxSize`, delete the oldest entry (first key in Map iteration order — Maps preserve insertion order). On `get`, if `Date.now() - insertedAt > ttlMs`, delete and return undefined.

**Why not a library:** The implementation is ~25 lines. Adding a dependency for this would be overengineering. CF Workers have constrained module budgets.

### 9.5 Gateway Failover Pattern

The `fetchFromIPFS` function implements ordered failover across IPFS gateways. Each gateway is tried in priority order. On success, the response is returned immediately. On failure (network error, HTTP error, timeout), the next gateway is tried.

```typescript
async function fetchFromIPFS<T>(
  path: string,
  validate: (data: unknown) => T,
): Promise<T> {
  const errors: Error[] = [];
  for (const gateway of GATEWAYS) {
    try {
      const res = await fetch(`${gateway}/${ROOT_CID}/${path}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return validate(data);  // Validate before caching
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }
  throw new AggregateError(errors, `All gateways failed for ${path}`);
}
```

The validate function runs **before** the result enters the cache, ensuring corrupted or tampered data never persists.

---

## 10. Implementation Phases

### Phase 1: Build Pipeline Foundation (voter-protocol)

**No breaking changes. Old pipeline untouched.**

| Task | File | Description |
|------|------|-------------|
| 1.1 | `scripts/build-chunked-mapping.ts` | Port worker architecture from `build-h3-mapping.ts`; change merge step to partition by parent cell + layer |
| 1.2 | `scripts/export-officials.ts` | Query `federal_members` table; group by state+district; write per-district JSON |
| 1.3 | `scripts/validate-build.ts` | Implement all 7 validation checks (Section 5.1) |
| 1.4 | Test fixtures | Create known-good and known-bad fixture directories for validation testing |

**Review gate:** Run `build-chunked-mapping.ts` on real `shadow-atlas-full.db`. Run `validate-build.ts` on output. Cell count must match monolithic build (1,883,843). All 7 checks must pass.

### Phase 2: IPFS Adaptation (voter-protocol)

**No breaking changes. Old `--artifact` mode preserved.**

| Task | File | Description |
|------|------|-------------|
| 2.1 | `scripts/pin-to-ipfs.ts` | Add `--directory` mode using `uploadDirectory()` |
| 2.2 | `scripts/push-cids.ts` | Cloudflare API integration for secret management |
| 2.3 | Test | Pin a test build to Storacha; verify gateway access to manifest + random chunk + officials file |

**Review gate:** Root CID resolves. `GET /ipfs/{rootCID}/manifest.json` returns valid manifest. Random chunk at `GET /ipfs/{rootCID}/US/districts/cd/{parent}.json` returns valid chunk. Officials file at `GET /ipfs/{rootCID}/US/officials/CA-12.json` returns valid officials.

### Phase 3: Commons Consumption (commons)

**Backward compatible. Dual-mode: old CIDs or new root CID.**

| Task | File | Description |
|------|------|-------------|
| 3.1 | `src/lib/core/shadow-atlas/ipfs-store.ts` | Rewrite with `setRootCID()`, `getDistrictsForCell()`, `getOfficials()`, TTL cache, gateway failover |
| 3.2 | `src/lib/core/shadow-atlas/client.ts` | Fix `US_SLOT_NAMES` → `SLOT_REGISTRY`; replace `lookupDistrict()` internals; replace `getOfficials()` internals; add `country` parameter |
| 3.3 | `src/hooks.server.ts` | Read `IPFS_CID_ROOT` alongside old vars (dual-mode) |
| 3.4 | `src/lib/core/identity/constituent-address.ts` | Add `country_code?: string` |
| 3.5 | `src/routes/api/location/resolve-address/+server.ts` | Expand country enum, expand postal regex |
| 3.6 | Tests | Unit tests for chunk fetch, validation, cache eviction, slot mapping |

**Review gate:**
- `tsc --noEmit` passes
- All existing tests pass (dual-mode ensures old paths still work)
- New tests: chunk fetch mock, cache miss/hit, validation rejection, slot alignment
- Slot alignment: `SLOT_REGISTRY[i].name` matches `CIRCUIT_SLOT_NAMES[i]` for all `i`

### Phase 4: First Live Migration

| Task | Description |
|------|-------------|
| 4.1 | Run new pipeline end-to-end via GitHub Actions workflow dispatch |
| 4.2 | `validate-build.ts` gates the pin (must pass) |
| 4.3 | `push-cids.ts` sets `IPFS_CID_ROOT` on Cloudflare Pages |
| 4.4 | Verify: Commons picks up chunked mode (check logs for "chunked mode active") |
| 4.5 | Monitor: Worker memory usage, response times, error rates for 48 hours |
| 4.6 | Smoke test: resolve a known address (e.g., 12 Mint Plaza, SF, CA 94103) and verify district + officials return correctly |

**Review gate:** Address resolution returns correct congressional district (CA-11 or CA-12 depending on redistricting). Officials include correct house member and both CA senators. Worker memory stays under 10 MB. Response time under 500ms for cold lookup, under 50ms for cached.

### Phase 5: Cleanup

| Task | File | Description |
|------|------|-------------|
| 5.1 | `voter-protocol` | Delete `build-h3-mapping.ts` |
| 5.2 | `voter-protocol` | Delete `ingest-legislators.ts` |
| 5.3 | `voter-protocol` | Rewrite `shadow-atlas-quarterly.yml` (Section 7) |
| 5.4 | `commons/ipfs-store.ts` | Remove dual-mode shim; remove `setCIDs()`, `IPFS_CIDS`, v1/v2 compat |
| 5.5 | `commons/client.ts` | Remove `toSubstrateDistrictKey()`, HTTP fallback, old `getOfficials()` |
| 5.6 | `commons/hooks.server.ts` | Remove old `setCIDs()` call |
| 5.7 | Cloudflare | Remove `IPFS_CID_DISTRICT_MAPPING`, `IPFS_CID_OFFICIALS`, `IPFS_CID_MERKLE_SNAPSHOT` env vars |
| 5.8 | `pin-to-ipfs.ts` | Remove `--artifact` mode (directory-only) |

**Review gate:**
- `tsc --noEmit` passes in both repos
- `grep -r 'setCIDs\|IPFS_CIDS\|getDistrictMapping\|getOfficialsDataset\|CellDistrictsV1\|convertV1\|toSubstrateDistrictKey\|ingest-legislators' src/` returns zero results
- Test count ≥ Phase 4 test count
- No dead imports (verified by `tsc --noEmit` + manual grep)

### Phase 6: International Extension

| Task | Description |
|------|-------------|
| 6.1 | Run `build-chunked-mapping.ts --country CA` for Canada federal ridings |
| 6.2 | Run `build-chunked-mapping.ts --country GB` for UK Westminster constituencies |
| 6.3 | Run `export-officials.ts` with international tables |
| 6.4 | Pin combined US+CA+GB directory DAG |
| 6.5 | Verify: Commons auto-discovers CA and GB from manifest |
| 6.6 | Enable quarterly cron in workflow |

**Review gate:** Address in Toronto resolves to correct federal riding. Address in London resolves to correct Westminster constituency. Manifest shows 3 countries.

---

## 11. Regression Prevention Matrix

Each regression vector has a corresponding automated check.

| Regression Vector | Detection Mechanism | When |
|-------------------|---------------------|------|
| Slot index drift between repos | `validate-build.ts` Check 6 + runtime manifest slot verification | Build-time + runtime |
| Chunk checksum corruption | SHA-256 recomputation in `validate-build.ts` Check 2 + runtime `validateChunk()` | Build-time + runtime |
| Missing officials for district | `validate-build.ts` Check 5 | Build-time |
| Cell coverage regression (fewer cells than expected) | `validate-build.ts` Check 3 (floor check: ≥ 1,800,000 for US `cd`) | Build-time |
| Cell appearing in multiple chunks | `validate-build.ts` Check 3 (disjoint partition) | Build-time |
| Gateway returning stale data | CID change detection in `setRootCID()` clears all caches | Runtime |
| Worker memory regression | LRU max size is hardcoded; chunks are ~8 KB; worst case = `maxSize * 12 KB` | Design-time |
| Dead code accumulation | Phase 5 grep audit (Section 8.3) | Review-time |
| Test count regression | Wave review gate: test count ≥ previous wave | Review-time |
| Type drift after refactor | `tsc --noEmit` in both repos | Review-time |
| Import graph pollution | `tsc --noEmit` catches unused imports; CI lint | Review-time |
| Quarterly pipeline silent failure | Notify job runs `if: always()` — creates GitHub issue regardless of outcome | Pipeline-time |
| CID not reaching Cloudflare | `push-cids.ts` reads back the secret after setting it | Pipeline-time |

---

## 12. Completion Tracking

### Phase 1: Build Pipeline Foundation
- [ ] 1.1 `build-chunked-mapping.ts` — worker architecture ported, merge step rewritten
- [ ] 1.2 `export-officials.ts` — reads `federal_members`, writes per-district JSON
- [ ] 1.3 `validate-build.ts` — all 7 checks implemented
- [ ] 1.4 Test fixtures — known-good and known-bad directories
- [ ] 1.R **Review gate passed** — cell count matches monolithic, all checks pass

### Phase 2: IPFS Adaptation
- [ ] 2.1 `pin-to-ipfs.ts` — `--directory` mode with `uploadDirectory()`
- [ ] 2.2 `push-cids.ts` — CF API integration
- [ ] 2.3 Gateway verification — manifest + chunk + officials accessible
- [ ] 2.R **Review gate passed** — root CID resolves all paths

### Phase 3: Commons Consumption
- [ ] 3.1 `ipfs-store.ts` rewrite — setRootCID, chunk fetch, TTL cache, gateway failover
- [ ] 3.2 `client.ts` — SLOT_REGISTRY fix, per-chunk lookup, country param
- [ ] 3.3 `hooks.server.ts` — IPFS_CID_ROOT (dual-mode)
- [ ] 3.4 `constituent-address.ts` — country_code field
- [ ] 3.5 `resolve-address/+server.ts` — expanded validation
- [ ] 3.6 Tests — chunk fetch, validation, cache, slot alignment
- [ ] 3.R **Review gate passed** — tsc passes, all tests pass, slot alignment verified

### Phase 4: First Live Migration
- [ ] 4.1 Pipeline end-to-end run
- [ ] 4.2 Validation passed
- [ ] 4.3 CID pushed to Cloudflare
- [ ] 4.4 Chunked mode active in production
- [ ] 4.5 48-hour monitoring clean
- [ ] 4.6 Smoke test passed (known address returns correct data)
- [ ] 4.R **Review gate passed** — memory, latency, correctness all green

### Phase 5: Cleanup
- [ ] 5.1 `build-h3-mapping.ts` deleted
- [ ] 5.2 `ingest-legislators.ts` deleted
- [ ] 5.3 `shadow-atlas-quarterly.yml` rewritten
- [ ] 5.4 `ipfs-store.ts` dual-mode removed
- [ ] 5.5 `client.ts` dead code removed
- [ ] 5.6 `hooks.server.ts` old setCIDs removed
- [ ] 5.7 Old CF env vars removed
- [ ] 5.8 `pin-to-ipfs.ts` artifact mode removed
- [ ] 5.R **Review gate passed** — zero grep hits on deprecated symbols, tsc clean, test count stable

### Phase 6: International Extension
- [ ] 6.1 Canada chunks built
- [ ] 6.2 UK chunks built
- [ ] 6.3 International officials exported
- [ ] 6.4 Multi-country DAG pinned
- [ ] 6.5 Commons discovers international countries from manifest
- [ ] 6.6 Quarterly cron enabled
- [ ] 6.R **Review gate passed** — international address resolution works

---

## 13. Open Questions & New Findings

### 13.1 Findings During Specification

1. **Slot mismatch is worse than initially thought.** Commons `US_SLOT_NAMES` diverges at slot 10 (`COMMUNITY_COLLEGE` vs `SCHOOL_BOARD`) and all subsequent slots are shifted. This means slots 10-21 would be misinterpreted if any IPFS data were served. Fortunately, no IPFS CIDs were ever set in production, so no user data is affected.

2. **The monolithic mapping literally cannot work on CF Workers.** 355 MB exceeds the 128 MB Worker memory limit. The current architecture was DOA from the start. Any testing done with it was either in Node.js dev mode (not CF Workers) or never actually loaded the mapping.

3. **Officials export has never worked.** The quarterly pipeline queries a non-existent `officials` table. The `ingest-legislators.ts` script that creates the correct `federal_members` table is marked deprecated. There is no script that has ever produced a valid officials dataset for IPFS.

4. **RESOLVED: The `COMMUNITY_COLLEGE` vs `SCHOOL_BOARD` discrepancy.** `authority-mapper.ts` had drifted from `jurisdiction.ts` and `DISTRICT-TAXONOMY`. The canonical source is `US_JURISDICTION` in `jurisdiction.ts` (what the build pipeline imports) and `DISTRICT-TAXONOMY` spec (both use `COMMUNITY_COLLEGE` at slot 10). `authority-mapper.ts` has been corrected to match.

5. **Federal Senate (slot 1) doesn't need H3 chunking.** Senate representation is state-wide. A single file per state (50 entries) is simpler than thousands of chunks where every cell in a state maps to the same two senators. Consider: for slot 1, store `US/districts/senate.json` as a flat `{ "CA": "CA-senate", "NY": "NY-senate", ... }` file instead of 783 chunks.

### 13.2 Open Decisions

1. **Res-3 vs Res-4 chunking?** Res-3 produces ~783 chunks averaging ~72 KB uncompressed (~8-12 KB gzipped). Res-4 produces ~5,481 chunks averaging ~10 KB uncompressed (~1.5 KB gzipped). Res-4 has smaller chunks but more IPFS directory overhead. Recommendation: Res-3 for simplicity. Can revisit if chunk sizes prove problematic.

2. **Should the Merkle snapshot be chunked too?** The cell-tree-snapshot is 15-25 MB — large but loaded client-side (browser), not in CF Workers. Browser IndexedDB handles this fine. No chunking needed for now.

3. **RESOLVED: Slot 10 discrepancy.** `CIRCUIT_SLOT_NAMES` in `authority-mapper.ts` had `SCHOOL_BOARD` at slot 10, diverging from both `US_JURISDICTION` (jurisdiction.ts) and `DISTRICT-TAXONOMY` spec which use `COMMUNITY_COLLEGE`. The build pipeline (`build-h3-mapping.ts`) imports from `jurisdiction.ts` and the actual built artifact (h3-mapping-metadata.json) confirms `Community College District` at slot 10. Fixed: `authority-mapper.ts` aligned to match `US_JURISDICTION` and `DISTRICT-TAXONOMY`. `boundaryTypeToSlot()` slot assignments updated. Commons' `US_SLOT_NAMES` updated to match.

4. **Storacha `uploadDirectory()` vs CLI `storacha up`.** The script uses the SDK; the user has the CLI. Either path works. The SDK is preferred for CI automation; the CLI is convenient for manual runs.

---

## 14. Related Specifications

| Spec | Relationship |
|------|-------------|
| `SHADOW-ATLAS-SPEC.md` (voter-protocol) | Parent spec for Shadow Atlas data acquisition. This spec replaces its IPFS export infrastructure. |
| `DISTRICT-TAXONOMY.md` (voter-protocol) | Canonical 24-slot definition. Slot 10 discrepancy noted in Section 13.1. |
| `TWO-TREE-ARCHITECTURE-SPEC.md` (voter-protocol) | Tree 2 (Cell-District Mapping) is built from the same H3 data. Cell tree snapshot is included in the DAG. |
| `POSTAL-BUBBLE-SPEC.md` (commons) | Postal code formats for international geocoding. Informs Section 6.4 postal regex. |
| `GEOGRAPHIC-IDENTITY-ROUTING.md` (commons) | Downstream consumer of district lookup results. |
| `zk-proof-integration.md` (commons) | Client-side Merkle proof computation. Consumes cell-tree-snapshot from the DAG. |
