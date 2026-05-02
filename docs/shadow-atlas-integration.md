# Shadow Atlas Integration

**Last Updated:** 2026-02-22
**Status:** ✅ API Client + Officials Endpoint Implemented

> ⚠️ **2026-04-23 audit — architecture claims are mostly accurate; a
> few concrete items need correction before building against this doc:**
>
> - **Submit endpoint** in the integration-flow section is wrong.
>   `/api/congressional/submit` does not exist. Use
>   `POST /api/submissions/create`
>   (`src/routes/api/submissions/create/+server.ts`).
> - **(RESOLVED 2026-05-02)** Storacha sunsets 2026-05-31; uploads were
>   disabled 2026-04-15. R2 (`atlas.commons.email`) carries the
>   production read path via `src/lib/core/shadow-atlas/ipfs-store.ts`.
>   IPFS pinning is paused until the ecosystem matures — Pinata,
>   Lighthouse, and Fleek service implementations are preserved in
>   voter-protocol for future reactivation. The Storacha provider was
>   removed from voter-protocol rather than swapped. See
>   `docs/specs/CHUNKED-ATLAS-PIPELINE-SPEC.md` §4 and the
>   `storacha_sunset_migration` memory entry.
> - **Chunked pipeline shape:** the API docs suggest per-district merkle
>   roots, but the live architecture has a **single `cellMapRoot`
>   (Tree 2)** valid for all cells in an epoch; clients fetch
>   `{parentCell}.json` and extract districts + SMT path in one call.
> - **TEE is Planned; `LocalConstituentResolver` is the active path**
>   (`src/lib/server/tee/local-resolver.ts`). In-process decryption,
>   function-scoped PII — will be replaced by an AWS Nitro Enclave.
> - **Nullifier semantics (NUL-001):** `H2(identityCommitment, actionDomain)`
>   (`src/lib/server/shadow-atlas-handler.ts:~106`); engagement tier
>   range is 0–4. Worth adding to the Privacy Model section.
> - **Correct as-is:** three-tree architecture, 31 public inputs,
>   `FEATURES.SHADOW_ATLAS_VERIFICATION=true`, Convex backend on the
>   submit path.

Shadow Atlas provides district lookup, Merkle proof generation for ZK proofs, and representative resolution. It replaces runtime dependencies on Congress.gov, Census Bureau client-side calls, and Google Civic API.

**Cross-Repository References:**
- voter-protocol implementation: [SHADOW-ATLAS-SPEC.md](/Users/noot/Documents/voter-protocol/specs/SHADOW-ATLAS-SPEC.md)
- Proof architecture: [UNIFIED-PROOF-ARCHITECTURE.md](/Users/noot/Documents/voter-protocol/specs/UNIFIED-PROOF-ARCHITECTURE.md)
- Remediation status: [REMEDIATION-WAVE-PLAN.md](/Users/noot/Documents/voter-protocol/specs/REMEDIATION-WAVE-PLAN.md)

---

## Problem Statement

Commons's address verification pipeline had four structural defects:

1. **Double Census API hit.** `api/address/verify/+server.ts` called Census Bureau directly, then `addressLookupService.lookupRepsByAddress()` called Census *again* internally. Every verification triggered two identical geocoding requests.

2. **Uncached 535-member Congress roster fetch.** `fetchAllMembers()` paginated through ALL current Congress members on every representative lookup. Three paginated requests (250+250+35) to Congress.gov API per address verification.

3. **Congress.gov API unreliable.** Infinite redirect loop August 22-25, 2025. ProPublica Congress API shut down July 2024. Google Civic Representatives API shut down April 2025.

4. **Client-side government API calls.** `census-api.ts` called Census Bureau via JSONP from the browser.

## Architecture Decision

Shadow Atlas is the unified backend for district resolution AND representative data. No runtime calls to Congress.gov. No client-side calls to Census Bureau. Shadow Atlas serves pre-ingested, periodically refreshed data from its own SQLite database.

### Data Flow

```
Browser                     Commons Server               Shadow Atlas
───────                     ─────────────────               ────────────
User enters address ──→  POST /api/address/verify
                               │
                               ├─→ Census Bureau geocoder (ONE call)
                               │   Returns: lat/lng, cell_id, CD
                               │
                               └─→ Shadow Atlas GET /v1/officials?cell_id=XXX
                                      │
                                      ├─→ Federal + state reps (from SQLite)
                                      ├─→ 24 district hex IDs
                                      └─→ Human-readable district names

                     ←── { district, cell_id, representatives[], zk_eligible }
```

### Privacy Model

The privacy boundary is clean. Shadow Atlas sees: leaf hashes (Tree 1), cell_ids (Tree 2 queries), identity commitments (Tree 3). Representative metadata (names, parties, phones, CWC codes) maps hex IDs to human-readable data — never enters the ZK circuit.

---

## Client Implementation

**Location:** `src/lib/core/shadow-atlas/shadow-atlas-handler.ts`

### Core Client Usage

```typescript
import { ShadowAtlasClient } from '$lib/core/shadow-atlas/shadow-atlas-handler';

const client = new ShadowAtlasClient({
  baseUrl: process.env.SHADOW_ATLAS_API_URL
});

// Lookup district by coordinates
const districts = await client.lookup(37.7749, -122.4194);
// Returns: { congressional: "CA-12", merkleRoot: "0x..." }

// Get Merkle proof for identity commitment
const proof = await client.getProof(districtId, identityCommitment);
// Returns: { path: [...], index: 1234, root: "0x...", depth: 20 }

// Register identity commitment
const registration = await client.register({
  identityCommitment,  // Poseidon2 hash
  lat,
  lng
});
// Returns: { leafIndex, merklePath, merkleRoot, districtId }

// Look up officials by district
const officials = await client.getOfficials('CA-12');
// Returns: { officials: [...], specialStatus?: {...} }
```

---

## API Endpoints

### District Lookup
```
GET /v1/lookup?lat={latitude}&lng={longitude}
```

**Response:**
```json
{
  "districts": {
    "congressional": "CA-12",
    "state_senate": "CA-SD-11",
    "state_house": "CA-AD-17",
    "city_council": "SF-D5"
  },
  "merkleRoots": {
    "congressional": "0x...",
    "state_senate": "0x..."
  }
}
```

### Identity Registration
```
POST /v1/register
Content-Type: application/json

{
  "identityCommitment": "0x...",  // Poseidon2 hash
  "lat": 37.7749,
  "lng": -122.4194
}
```

**Response:**
```json
{
  "leafIndex": 1234,
  "merklePath": ["0x...", "0x...", "..."],
  "merkleRoot": "0x...",
  "districtId": "CA-12",
  "depth": 20
}
```

### Merkle Proof Retrieval
```
GET /v1/proof?district={district_id}&leaf={leaf_hash}
```

**Response:**
```json
{
  "path": ["0x...", "0x...", "..."],
  "index": 1234,
  "root": "0x...",
  "depth": 20
}
```

### Officials Lookup
```
GET /v1/officials?cell_id={cell_id}
GET /v1/officials?district={district_code}
```

Resolves via Tree 2 district hex IDs → federal officials from SQLite.

**Response:**
```json
{
  "officials": [
    {
      "bioguide_id": "S001150",
      "name": "Nancy Pelosi",
      "party": "Democrat",
      "chamber": "house",
      "state": "CA",
      "district": "12",
      "cwc_code": "HCA12",
      "office": "House Representative, CA-12",
      "is_voting": true
    }
  ],
  "specialStatus": null
}
```

CWC codes are deterministic for House: `"H" + state + lpad(district, 2, '0')`. Senate requires `bioguide_id` + contact form URL mapping.

**Cache-Control:** 1 hour (officials change infrequently). Returns 501 if officials DB not populated.

---

## Security Considerations

### URL Validation (SA-009)

All Shadow Atlas URLs are validated against an allowlist before fetching:

```typescript
import { validateURL } from '../security/input-validator';

if (!validateURL(url)) {
  throw new Error(`URL not in allowlist: ${url}`);
}
```

### Rate Limiting (SA-010)

```typescript
const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 10 });
if (!limiter.consume(clientId)) {
  throw new Error('Rate limit exceeded');
}
```

### JSON Validation (SA-014)

All incoming JSON is validated with Zod schemas:

```typescript
import { DiscoveryResultSchema } from '../security/input-validator';
const results = DiscoveryResultSchema.parse(JSON.parse(data));
```

---

## Error Handling

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Invalid coordinates | Check lat/lng format |
| 401 | Unauthorized | Check API key |
| 404 | District not found | Coordinates outside coverage |
| 409 | Duplicate registration | Identity already registered |
| 429 | Rate limited | Retry after cooldown |
| 501 | Officials DB not populated | Graceful degradation |
| 503 | Tree rebuilding | Retry in 30s |

---

## Integration Flow

```
1. User verifies identity (mDL via Digital Credentials API)
   └→ Generates identity_commitment (Poseidon2 hash)

2. User provides address
   └→ Geocode to coordinates (lat, lng)

3. Register with Shadow Atlas
   └→ POST /v1/register { identityCommitment, lat, lng }
   └→ Receive { leafIndex, merklePath, merkleRoot, districtId }

4. Store registration locally (IndexedDB)
   └→ { identityCommitment, leafIndex, merklePath, merkleRoot, districtId }

5. Generate ZK proof (browser WASM)
   └→ Use merklePath as witness
   └→ Prove district membership without revealing identity

6. Submit congressional message
   └→ POST /api/congressional/submit { proof, publicInputs, ... }
```

---

## Data Sources

| Source | Level | License | Status |
|--------|-------|---------|--------|
| `unitedstates/congress-legislators` (GitHub) | Federal (541) | CC0 | Primary federal source |
| Open States (openstates.org) | State (~7,386) | CC0 | Primary state source (deferred) |
| Census TIGER/Line shapefiles | Boundaries | Public domain | District geometry |
| Municipal GIS Portals (716 cities) | Local | Public domain | City council wards |

**Dead sources (do not use):** ProPublica Congress API (July 2024), Google Civic Representatives API (April 2025), Congress.gov API v3 (unreliable since Aug 2025).

---

## Implementation Status

### Phase A: Fix Commons Pipeline — ✅ DONE
- Member cache (5-min TTL with concurrent dedup)
- Double Census call eliminated
- Zero GEOID data logging

### Phase B: Shadow Atlas Officials Endpoint — ✅ DONE (federal)
- SQLite schema for officials (`federal_members`, `ingestion_log`)
- Ingestion pipeline: congress-legislators YAML → 538 members
- API endpoint: `/v1/officials` with Zod validation + rate limiting
- 26 unit tests

### Phase C: Commons Switchover — ✅ DONE (C1 + C2)
- `getOfficials()` client method with full type support
- Verify endpoint rewired: shadow-atlas primary, Congress.gov fallback
- Dead code deletion (C3) and JSONP removal (C4) deferred until shadow-atlas is deployed

### Open Questions
1. Open States CSV column schema — needs validation before first state-level ingest
2. Senate CWC code derivation — requires additional mapping beyond district data
3. `/v1/districts/:hexId` enrichment — deferred (additive, backwards-compatible)

---

## Environment Configuration

```bash
# Shadow Atlas API
SHADOW_ATLAS_API_URL=https://shadow-atlas.voter-protocol.org

# For development
SHADOW_ATLAS_API_URL=http://localhost:3001
```

---

## Testing

- 84 security tests (input-validator, rate-limiter)
- 26 unit tests (officials service + API response formatting)
- Integration tests in `src/lib/core/shadow-atlas/__tests__/`
- E2E proof generation tests in voter-protocol
