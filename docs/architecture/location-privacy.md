# Location Intelligence & Privacy

**Status**: PARTIAL | Privacy-by-Architecture with Progressive Signal Inference (TEE boundary NOT deployed)

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Privacy design goals are
> sound, but this doc describes a TEE privacy boundary that is **not
> deployed**. Concrete corrections:
>
> - **TEE boundary is aspirational.** Witness encryption
>   (XChaCha20-Poly1305 + X25519, `/api/tee/public-key`) is scaffolded,
>   but there is no Nitro enclave. The active resolver is
>   `LocalConstituentResolver` (`src/lib/server/tee/local-resolver.ts`) —
>   witness decryption happens in-process on the server. Any section
>   below that frames the TEE as the privacy line should be read as
>   intended design, not current state. See
>   `docs/implementation-status.md:~113` ("TEE deployment | Planned").
> - **IP geolocation confidence values differ from the table.** Code at
>   `src/lib/core/location/inference-engine.ts:156` sets confidence as
>   `data.state_code ? 0.3 : 0.6` (country-only is **more** confident,
>   VPN-resistant), not the "0.2 state only" stated here.
> - **GeoLite2 fallback is not implemented.** The live fallback chain
>   (`src/routes/api/location/ip-lookup/+server.ts`) is Cloudflare
>   native → `cf-connecting-ip`/`cf-ipcountry` headers → mock (dev).
>   The "GeoLite2-City.mmdb" path described as operational is a comment,
>   not code.
> - **mDL verification is browser-side, not server-side HPKE/CBOR/COSE.**
>   W3C Digital Credentials API performs selective disclosure in the
>   browser; the server receives the disclosed fields via the API, not
>   raw encrypted mDL blobs. The "decrypt HPKE → CBOR → COSE_Sign1"
>   flow described in the privacy-boundary section is not the active
>   protocol.
> - **"14 governance layers" resolution is scoped.** For template
>   filtering and credential issuance, only the congressional district
>   is operationalized (`FEATURES.ADDRESS_SPECIFICITY='district'`); the
>   remaining layers are proof-internal or not yet wired.
> - **User table has a generic `location: v.optional(v.string())` field**
>   (`convex/schema.ts:~114`) — the doc's "no server-side storage of
>   any location fields" claim should explicitly say no street/city/
>   county/state, not "no location".
> - **Storacha sunsets 2026-05-31.** Shadow Atlas pinning migration
>   is ops-urgent — not called out below.

---

**The server never knows a user's exact address. Location is inferred progressively, stored client-side, and revealed only through user action. All geocoding runs on self-hosted open-source infrastructure (Shadow Atlas: Nominatim + R-tree + SQLite). No runtime API calls are made to government services or third parties. Census TIGER/Line data is the underlying source data, downloaded and processed locally.**

## Design Principle

Location data follows a one-way funnel: raw signals enter, only derived facts (district codes, hashes) leave the privacy boundary. The server learns location implicitly — through which templates a user selects — not through direct disclosure.

---

## Signal Types

Six location signals, ranked by confidence:

| Signal | Confidence | Granularity | Storage | Expiry |
|---|---|---|---|---|
| IP Geolocation | 0.2 | State only | Client (IndexedDB) | 24h |
| Browser Geolocation | 0.6 | Congressional district | Client (IndexedDB) | 7d |
| OAuth Profile | 0.8 | State/city | Client (IndexedDB) | 90d |
| User Selected | 0.9 | Congressional district | Client (IndexedDB) | 90d |
| Behavioral Patterns | 0.9 | Congressional district | Client (IndexedDB) | 30d |
| Identity Verification (mDL) | 1.0 | Congressional district | Server (hash only) | 365d |

The `user_selected` signal comes from the interactive location breadcrumb, where users explicitly choose their location. High confidence because it reflects direct user intent.

### IP Geolocation Constraints

IP can **only** determine state (not congressional district). This is enforced at the type system level:

```typescript
IPLocationSignal.congressional_district = null  // Type system prevents false precision
```

IP coordinates are city-center approximations. Using them for district lookup would produce false precision and wrong results (congressional districts don't align with city boundaries).

**Implementation**: Cloudflare native geolocation (zero-latency) → fallback to GeoLite2 database.

---

## Data Flow

```
User enters address (onboarding)
    ↓
Client-Side Resolution (Shadow Atlas)
├── Resolves all 14 governance layers
└── Stores in IndexedDB (NEVER transmitted to server)
    ↓
Server-Side: Implicit Disclosure Only
├── User selects template → server learns location from template tags
├── User submits congressional proof → district HASH revealed
└── User clicks local template → server infers city/county/state
    ↓
Privacy Boundary
├── Exact address: stays in browser
├── Cell ID (census block): only in ZK proofs as private witness
└── District: revealed through action or cryptographic proof
    ↓
Message Delivery
├── Federal (CWC): address sent to Congress (required for delivery)
├── State/Local: mailto opens user's email client (address stays local)
└── Platform sees: template ID, timestamp, inferred location level
```

---

## What's Stored Where

### Client-Side Only (IndexedDB)

- Full address (street, city, state, ZIP)
- GPS coordinates
- All 14 resolved district codes
- Location signal history

### Server-Side (Minimal)

| Field | Model | Content |
|---|---|---|
| `district_hash` | User | SHA-256 of congressional district (not plaintext) |
| `address_verified_at` | User | Timestamp of verification |
| `address_verification_method` | User | `'civic_api'` / `'postal'` / `'mdl'` |
| `identity_hash` | User | SHA-256 of identity attributes (sybil resistance) |

**No server-side storage of**: street address, city, state, ZIP code, GPS coordinates, census block ID.

---

## Governance Layers

The system resolves 14 governance layers from a single address:

| Slot | Layer | Example |
|---|---|---|
| 0 | Congressional District | CA-12 |
| 1 | Federal Senate | CA |
| 2 | State Senate | SD-11 |
| 3 | State House | AD-17 |
| 4 | County | 06075 (San Francisco) |
| 5 | City | San Francisco |
| 6 | City Council | District 5 |
| 7 | School (Unified) | SFUSD |
| 8 | School (Elementary) | — |
| 9 | School (Secondary) | — |
| 10-12 | Special Districts | Water, Fire, Transit |
| 13 | Voting Precinct | PCT-3721 |

All 14 stored as SHA-256 hashes in ZK proofs. Plaintext districts stay client-side.

---

## Privacy Boundaries

### mDL Verification

When a user verifies identity via mobile driver's license:

1. HPKE decrypt → CBOR decode → COSE_Sign1 verify against IACA roots
2. Extract address fields (postal_code, city, state)
3. Resolve congressional district
4. **Discard address fields** — only district leaves the boundary
5. Store `district_hash` (SHA-256) on User record

Raw address fields enter as input. Only the district hash exits.

### ZK Proofs

District proofs use Poseidon2 hashing:
- Identity commitment: `H(identity_commitment, user_entropy)`
- Nullifier: `Poseidon(user_secret, campaign_id, epoch_id)` — prevents double-voting
- Proof reveals 14 district hashes, no plaintext

### CWC Congressional Delivery

The one exception where address is transmitted: CWC (Congress) requires constituent address for delivery. This is:
- Encrypted in transit (TLS)
- Sent directly to congressional office systems
- Not stored by Commons after delivery

---

## Risk Analysis

| Risk | Severity | Mitigation |
|---|---|---|
| Template selection leakage | Medium | Action-based only; users can browse without revealing location |
| False precision from IP | High | Type system enforces `congressional_district = null` for IP signals |
| Cell ID exposure | High | Census block (600-3000 people) treated as PII; resolved locally, encrypted, never logged |
| Behavioral profiling | Medium | Client-side only; no server-side profile construction |
| CWC address transmission | Low | Required by Congress; encrypted; not retained by Commons |
| VPN/proxy circumvention | Low | Accepted limitation; IP used only for state-level filtering |
| Verification metadata leakage | Low | All methods produce same output (district hash); method doesn't leak additional info |

---

## Multi-Country Support

District configuration is polymorphic:

| Country | Primary District | Config |
|---|---|---|
| US | Congressional District | 14 governance layers |
| GB | Parliamentary Constituency | — |
| FR | Circonscription législative | — |
| JP | Senkyoku (選挙区) | — |
| BR | Distrito eleitoral | — |

Implementation: `src/lib/core/location/district-config.ts`

---

## Key Files

| File | Purpose |
|---|---|
| `src/lib/core/location/types.ts` | Location signal types, InferredLocation |
| `src/lib/core/location/district-config.ts` | Multi-country district configuration |
| `src/lib/core/location/census-api.ts` | Geocoding client (self-hosted Shadow Atlas) |
| `src/lib/core/location/inference-engine.ts` | Confidence-weighted location inference |
| `src/lib/core/location/template-filter.ts` | Location-based template filtering |
| `src/lib/core/identity/mdl-verification.ts` | mDL verification (privacy boundary) |
| `src/lib/core/identity/district-credential.ts` | District credential (W3C VC 2.0) |
| `src/routes/api/location/ip-lookup/+server.ts` | IP geolocation endpoint |
| `src/routes/api/location/resolve-address/+server.ts` | Address resolution endpoint |
| `docs/architecture/LOCATION-SIGNAL-ACCURACY-LIMITS.md` | Signal accuracy matrix |
| `docs/specs/GEOGRAPHIC-IDENTITY-ROUTING.md` | Geographic routing architecture |
| `docs/specs/POSTAL-BUBBLE-SPEC.md` | Postal bubble (spatial privacy) spec |
| `docs/design/patterns/privacy-governance.md` | Privacy governance UX patterns |
