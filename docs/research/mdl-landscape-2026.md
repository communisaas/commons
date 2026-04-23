# US Mobile Driver's License Landscape — March 2026

> ⚠️ **2026-04-23 audit — Commons-side claims verify clean; two small
> gaps in the research narrative:**
>
> - **Add explicit browser baseline.** `src/lib/core/identity/digital-credentials-api.ts:~7`
>   documents: *"Chrome 141+ (`org-iso-mdoc` + `openid4vp`), Safari 26+
>   (`org-iso-mdoc` only)."* Surfacing this keeps ops aligned when
>   debugging wallet flows.
> - **Apple Business Connect enrollment is still ops-pending** for
>   iOS Safari wallet verification. Not in code as a blocker; worth
>   calling out as a gating external dependency.
> - **Verified against code:** mDL/DCAPI as sole active intake;
>   OID4VP JWT sig verification (ES256/384/512, JWK + x5c); bifurcated
>   nonce validation (hard in OID4VP, presence-only in
>   `org-iso-mdoc` with T3 deferral); `self.xyz` / `Didit` as
>   backward-compat-only enums; cross-device bridge required on
>   desktop.

## Our Current Coverage

16 states/territories in IACA trust store: **AK, AZ, CA, CO, GA, HI, IL, MD, MT, ND, NM, OH, PR, UT, VA, WV**

Source: `src/lib/core/identity/iaca-roots.ts` (static, updated 2026-03-05)

### Runtime Coverage (VICAL Service)

In addition to the 16 static IACA roots, the runtime VICAL service (`src/lib/core/identity/vical-service.ts`) dynamically fetches and caches IACA roots from the AAMVA VICAL at verification time. Any state published to the VICAL is automatically covered without code changes.

| Coverage Layer | States | Mechanism |
|----------------|--------|-----------|
| **Static trust store** | 16 (AK, AZ, CA, CO, GA, HI, IL, MD, MT, ND, NM, OH, PR, UT, VA, WV) | Hardcoded in `iaca-roots.ts` |
| **Runtime VICAL** | 10 (AK, AZ, CO, GA, IL, MD, MT, ND, UT, VA) | Fetched from AAMVA, KV-cached |
| **Unique coverage** | 16 | 6 states only via static (.gov downloads): CA, HI, NM, OH, PR, WV |

Note: Runtime VICAL overlaps with static for 10 states. The 6 .gov-download states (CA, HI, NM, OH, PR, WV) are not in the VICAL — they remain static-only.

---

## 1. Current State: Live mDL Programs

### TSA-Accepted (22 jurisdictions)

| # | State | Wallet / App | Vendor | ISO 18013-5 | In Our Trust Store |
|---|-------|-------------|--------|-------------|-------------------|
| 1 | **Alaska** | Alaska Mobile ID (state app) | Thales | Yes | ✅ |
| 2 | **Arizona** | Apple, Google, Samsung Wallet | IDEMIA | Yes | ✅ |
| 3 | **Arkansas** | State app, Google, Samsung Wallet | IDEMIA | Yes | ❌ |
| 4 | **California** | CA DMV Wallet, Apple, Google | SpruceID | Yes | ✅ |
| 5 | **Colorado** | Apple, Google, Samsung Wallet | Thales | Yes | ✅ |
| 6 | **Georgia** | Apple, Google, Samsung Wallet | Thales | Yes | ✅ |
| 7 | **Hawaii** | Apple Wallet | — | Yes | ✅ |
| 8 | **Illinois** | Apple Wallet | — (procurement) | Yes | ✅ |
| 9 | **Iowa** | State app, Apple, Google, Samsung | IDEMIA | Yes | ❌ |
| 10 | **Kentucky** | State app (Jan 2026) | IDEMIA | Yes | ❌ |
| 11 | **Louisiana** | LA Wallet (Envoc) | Envoc | **No** (pre-standard) | N/A |
| 12 | **Maryland** | Apple, Google, Samsung Wallet | Thales (backend) | Yes | ✅ |
| 13 | **Montana** | Apple, Google Wallet | — | Yes | ✅ |
| 14 | **New Mexico** | Apple, Google Wallet | — | Yes | ✅ |
| 15 | **New York** | NY Mobile ID (IDEMIA app) | IDEMIA | Yes | ❌ |
| 16 | **North Dakota** | Apple, Google, Samsung Wallet | — | Yes | ✅ |
| 17 | **Ohio** | Apple Wallet | — | Yes | ✅ |
| 18 | **Puerto Rico** | PR Movil, Apple, Google | — | Yes | ✅ |
| 19 | **Utah** | GET Mobile ID | GET Group NA | Yes (UL-certified) | ✅ |
| 20 | **Virginia** | VA Mobile ID (CBN) | Canadian Bank Note | Yes | ✅ |
| 21 | **West Virginia** | State app, Apple, Samsung | IDEMIA | Yes | ✅ |

**Our gap: 4 TSA-accepted ISO 18013-5 states NOT in our trust store:**
- Arkansas, Iowa, Kentucky, New York

**Louisiana is NOT verifiable** via ISO 18013-5 — proprietary Envoc format. Skip for now.

### Live but NOT TSA-Accepted

| State | App | Notes |
|-------|-----|-------|
| **Delaware** | Delaware Mobile ID (IDEMIA) | Live since 2021, ~11,500 issued. One of the earliest US mDL programs. |

### Total Summary

| Category | Count |
|----------|-------|
| TSA-accepted jurisdictions | 22 (21 states + PR) |
| ISO 18013-5 compliant of those | 21 (all except Louisiana) |
| In our trust store (static) | 16 |
| Runtime VICAL coverage | 10 (subset of static 16) |
| **Gap to close** | **5** (AR, DE, IA, KY, NY) |

---

## VICAL Re-parse Results (2026-03-05)

Latest VICAL version: `vc-2026-03-05-1772747750907`

### Findings

Re-parsed the AAMVA VICAL to check whether the 6 gap states had been added since our initial trust store build.

**Result: 0 of 6 gap states found.**

| Gap State | In VICAL? | IACA Source |
|-----------|-----------|-------------|
| **Arkansas** | No | IDEMIA — requires direct acquisition |
| **Delaware** | No | IDEMIA — requires direct acquisition |
| **Iowa** | No | IDEMIA — requires direct acquisition |
| **Kentucky** | No | IDEMIA — requires direct acquisition |
| **New York** | No | IDEMIA — requires direct acquisition |
| **West Virginia** | No | **ACQUIRED** — direct .gov download, added to static trust store |

### VICAL Contents (20 certs, 10 states)

AK, AZ, CO, GA, IL, MD, MT, ND, UT, VA — includes both P-256 and P-384 certs where applicable (commit `53358be2` fixed P-384 parsing).

### Root Cause: IDEMIA Vendor Distribution Gap

All 6 gap states use **IDEMIA** as their mDL vendor. IDEMIA does not publish IACA roots through the AAMVA VICAL. This is a vendor distribution choice, not a technical limitation:

- **Thales states** (AK, CO, GA, MD): all in VICAL
- **IDEMIA states** (AR, DE, IA, KY, NY, WV): none in VICAL
- **Other vendors** (SpruceID/CA, GET/UT, CBN/VA): mixed (UT, VA in VICAL; CA not)

The runtime VICAL service (`vical-service.ts`) will automatically pick up IDEMIA states if/when IDEMIA begins publishing to the VICAL. Until then, direct acquisition is required.

---

## Current Acquisition Pipeline (2026-03-05)

Three strategies running in parallel to close the remaining 5-state IDEMIA gap:

### Strategy Status

| Strategy | Channel | States Targeted | Status | Expected Timeline |
|----------|---------|----------------|--------|-------------------|
| **Direct state outreach** | Email to state DMV/DOT | AR, IA, DE, KY, NY | Outreach emails drafted (`docs/outreach/`), not yet sent | 1-4 weeks after sending |
| **IDEMIA Experience Portal** | Vendor portal registration | All IDEMIA states | Identified as acquisition channel, not yet registered | Unknown — requires account |
| **VICAL monitoring** | Runtime `vical-service.ts` | Any future IDEMIA additions | Automatic — zero code changes needed | Ongoing, no action required |

### Per-State Acquisition Status

| State | Pop. | Status | Acquisition Path | Next Step |
|-------|------|--------|-----------------|-----------|
| **WV** | 1.8M | **DONE** | Direct .gov download | Merged to static trust store |
| **AR** | 3.0M | Outreach drafted | Email to AR DFA | Send email |
| **IA** | 3.2M | Outreach drafted | Email to IA DOT | Send email |
| **DE** | 1.0M | Outreach drafted | Email to DE DMV | Send email |
| **KY** | 4.5M | Pending | Contact form submission | Draft and submit KY contact form |
| **NY** | 20.2M | Pending | Contact form submission | Draft and submit NY DMV contact form |

### Human Actions Required

These steps require a person — they cannot be automated:

1. **Send 3 outreach emails** (drafts ready in `docs/outreach/`):
   - Arkansas Department of Finance and Administration
   - Iowa Department of Transportation
   - Delaware Division of Motor Vehicles

2. **Submit 2 contact forms** (drafts needed):
   - Kentucky Transportation Cabinet — mDL contact form
   - New York DMV — NY Mobile ID program contact

3. **Register for IDEMIA Experience Portal** — potential parallel channel for all IDEMIA state IACA roots. Requires organizational account registration.

### Coverage Trajectory

| Milestone | Static States | Gap | When |
|-----------|--------------|-----|------|
| Pre-expansion | 15 | 6 | 2026-03-04 |
| **Current** | **16** (+ WV) | **5** | **2026-03-05** |
| After outreach responses | 17-19 (+ AR, IA, DE) | 2-4 | Est. Q1-Q2 2026 |
| After contact form responses | 20-21 (+ KY, NY) | 0-2 | Est. Q2 2026 |
| **Full IDEMIA closure** | **21** | **0** | Target: end of Q2 2026 |

Note: Runtime VICAL service provides automatic expansion for any IDEMIA state that begins publishing — coverage gains with zero code changes.

---

## 2. Next Wave: 2026-2027 Launches

### Tier 1: Very High Probability (2026)

| State | Population | Status | Notes |
|-------|-----------|--------|-------|
| **Texas** | 30M | HB 3426 signed 2025. DPS mandated to issue mDL. ISO 18013-5 required in statute. | Largest potential mDL rollout in US history. DPS RFP expected 2026. |
| **North Carolina** | 10.7M | HB 199 signed July 2024. DMV study complete (Jan 2025). Vendor procurement active. | 12-month timeline if leveraging existing vendor. Est. $750K-$1.4M. |
| **New Jersey** | 9.3M | Legislation signed July 2025. $1.5M budget allocated. | Implementation required by 2031 (deadline is far, but funding is now). |

### Tier 2: Probable (2026-2027)

| State | Population | Status | Notes |
|-------|-----------|--------|-------|
| **Idaho** | 1.9M | HB 78 passed House 37-33. Pending Senate. | Narrow partisan vote — may face Senate resistance. |
| **Alabama** | 5.1M | HB 110 pre-filed for 2026 session. $15 fee model. | Session started Jan 2026. Passage not guaranteed. |
| **Oklahoma** | 4.0M | Full DL system overhaul with Thales + IDEMIA. | Had mDL, paused, retooling. Apple Wallet committed. |
| **Connecticut** | 3.6M | Committed to Apple Wallet mDL. No timeline. | Announced but no legislation or procurement visible. |
| **Mississippi** | 3.0M | Committed to Apple Wallet mDL. IDEMIA contract. | Announced but no firm date. |

### Tier 3: Later (2027+)

| State | Status |
|-------|--------|
| **Pennsylvania** | HB 1247 stalled in committee since March 2024. Large population (13M). |
| **Indiana** | Plans announced 2024, no legislation signed. |
| **D.C.** | Plans announced 2024, no live program. |
| **Florida** | Program killed July 2024 (DeSantis). Could re-emerge under new administration. |

### Explicitly Absent

**Texas** was absent but is now in Tier 1 (HB 3426 signed). **Florida** rejected mDL (program killed July 2024).

---

## 3. Vendor Landscape

### Market Share

| Vendor | States | Notes |
|--------|--------|-------|
| **IDEMIA** | AZ, AR, DE, IA, KY, MS, NY, WV + Samsung Wallet integrations | Market leader. 10-year GSA agreement for Login.gov. Trinsic partnership (Feb 2026) for remote verification. |
| **Thales** | AK, CO, GA, HI, MD (backend), OK (retool) | Physical card production for 17 NA agencies. Biometric enrollment kiosks in GA. |
| **SpruceID** | CA | Open-source reader (OpenCred on GitHub). NIST NCCoE partner. |
| **GET Group NA** | UT | Only US mDL with full UL ISO 18013-5 certification (all interaction modes). |
| **CBN** | VA | Canadian Bank Note Company. VA-only in US market. |
| **Envoc** | LA | Proprietary pre-standard format. ~2M mDLs issued (most in US). NOT ISO 18013-5 compliant. |

### Wallet Distribution

| Wallet | States | Notes |
|--------|--------|-------|
| Apple Wallet | 14 states + PR (live), 5 more committed | Dominant in states with wallet integration |
| Google Wallet | 10 states (live), 3 announced | Trailing Apple by ~4 states |
| Samsung Wallet | ~7 states | Bundled with IDEMIA platform states |
| State-only apps | LA, NY, UT, VA, AK, KY, DE | No OS wallet integration (yet) |

### Non-ISO 18013-5 Implementations

**Louisiana (LA Wallet / Envoc)** is the only confirmed non-compliant state:
- Launched 2018, before ISO 18013-5 was finalized (2021)
- Proprietary QR-code-based format
- TSA accepts it, but it's not verifiable via standard COSE/CBOR pipeline
- Open feature request for ISO 18013-5 conformance (not retrofitted as of 2026)
- ~2M mDLs issued — largest single-state program by far

All other live programs use ISO 18013-5 compliant implementations.

### Fragmentation Note

As of Oct 2025: ~21 states live, **17 different wallet implementations**. 9 states issue only into standalone apps; 10 offer state app + OS wallet. The AAMVA VICAL solves the trust layer but not the transport layer (NFC vs QR vs BLE vs OpenID4VP varies by state).

---

## 4. IACA Certificate Distribution

### Distribution Methods

| Method | States | Ease of Acquisition |
|--------|--------|-------------------|
| **AAMVA VICAL** | All DTS members | Click-through T&C, free, CBOR-encoded. Universal source. |
| **Direct .gov download** | CA, GA, AZ, NM, HI, OH, PR | Public URL, no agreement needed. Best for us. |
| **Vendor SDK bundle** | IDEMIA states (via SDK) | Requires vendor relationship. Not public. |
| **Request-only** | Some states | Email/form required. Slow. |

### AAMVA VICAL Details

- URL: `https://vical.dts.aamva.org/currentVical`
- Format: CBOR-encoded signed list per ISO 18013-5 Annex B
- Access: Free, T&C click-through (not org-gated)
- Coverage: Growing — not all live states are in VICAL yet
- Refresh: We already parse this via `scripts/parse-vical.ts`
- **This is our primary acquisition channel.** Run the parse script quarterly (or when VICAL version increments).

### States with Direct Public IACA Downloads

| State | URL |
|-------|-----|
| California | `https://trust.dmv.ca.gov/certificates/ca-dmv-iaca-root-ca-crt.cer` |
| Georgia | `https://dds.georgia.gov/document/document/ga-mdl-rootzip/download` |
| Arizona | `https://azmvdnow.gov/certificates` (JS-rendered page) |
| New Mexico | `https://www.mvd.newmexico.gov/wp-content/uploads/2025/10/New-Mexico-IACA-Certificate.zip` |
| Hawaii | `https://hidot.hawaii.gov/highways/files/2024/08/2024_HI_IACA_Root.zip` |
| Ohio | `https://bmvonline.dps.ohio.gov` (ohio_mdl_iaca_root_2024.zip) |
| Puerto Rico | `https://docs.pr.gov/files/ID_movil-mDL/Certificado_IACA/PRDTOPProdCA.pem` |

---

## 5. Coverage Prioritization: Next States to Add

### Scoring Criteria

- **Population:** Voter reach (larger = more impact)
- **IACA ease:** Already in VICAL or public .gov download = easy
- **mDL adoption:** Active program with growing user base
- **Political diversity:** Need red, blue, purple for credibility
- **ISO compliance:** Must be 18013-5 (skip Louisiana)

### Priority Ranking (revised post-VICAL re-parse)

VICAL re-parse confirmed all 6 gap states are IDEMIA and NOT in VICAL. WV acquired via direct .gov download (2026-03-05). 5 remaining require outreach.

| Priority | State | Pop. | Political Lean | IACA Source | mDL Status | Rationale |
|----------|-------|------|---------------|-------------|------------|-----------|
| **P0** | **New York** | 20.2M | Blue | Direct acquisition (IDEMIA) | Live, 246K users, growing fast | Largest uncovered state. Blue state balance. |
| **P0** | **Iowa** | 3.2M | Red/Purple | Direct acquisition (IDEMIA) | Live, multi-wallet | Purple state. All major wallets. Outreach email drafted (`docs/outreach/`). |
| **P0** | **Arkansas** | 3.0M | Red | Direct acquisition (IDEMIA) | Live since Mar 2025 | Deep red state. Balance for credibility. Outreach email drafted (`docs/outreach/`). |
| **P1** | **Kentucky** | 4.5M | Red | Direct acquisition (IDEMIA) | Live since Jan 2026 | Red state. IDEMIA platform. Larger pop than WV. |
| ~~P1~~ | ~~**West Virginia**~~ | ~~1.8M~~ | ~~Red~~ | ~~Direct acquisition~~ | ~~Live~~ | **DONE** — direct .gov download, added to trust store 2026-03-05. |
| **P2** | **Delaware** | 1.0M | Blue | Direct acquisition (IDEMIA) | Live since 2021 | Oldest US mDL. Small pop. Not TSA-accepted. |
| **P2** | **Texas** | 30.0M | Red | TBD (not yet launched) | HB 3426 signed, DPS procurement | Largest prize. Not live yet — monitor for RFP/launch. |
| **P2** | **North Carolina** | 10.7M | Purple | TBD (not yet launched) | Vendor procurement active | Large purple state. Watch for 2026 launch. |

### Recommended Action Plan (revised 2026-03-05)

**Immediate — human actions needed (see "Current Acquisition Pipeline" above):**
1. ~~Re-run VICAL parse~~ — DONE. Zero IDEMIA states. VICAL path eliminated.
2. ~~Acquire WV IACA root~~ — DONE. Direct .gov download. Trust store now 16 states.
3. **Send 3 outreach emails** for AR, IA, DE (drafts in `docs/outreach/`).
4. **Submit 2 contact forms** for KY and NY DMV.
5. **Register for IDEMIA Experience Portal** — parallel acquisition channel.

**Near-term (Q2 2026):**
6. Monitor Texas DPS for RFP announcement and mDL launch timeline
7. Monitor North Carolina vendor selection
8. Follow up on outreach responses — escalate if no reply within 3 weeks

**Ongoing:**
9. Runtime VICAL service auto-covers any IDEMIA state that starts publishing — no code changes needed
10. Track ISO 18013-5 2nd edition (DIS ballot closes March 26, 2026; final expected July 2026)
11. Watch ISO/IEC TS 18013-7 (online mDL) adoption — affects our OpenID4VP flow

---

## 6. Standards Timeline

| Standard | Status | Impact |
|----------|--------|--------|
| **ISO 18013-5 Ed. 1** | Published Sep 2021 | Current basis for all verification |
| **ISO 18013-5 Ed. 2** | DIS ballot Feb-Mar 2026, final ~July 2026 | May affect certificate handling, MSO structure |
| **ISO/IEC TS 18013-7** | Published Oct 2024 | Online mDL verification (our OpenID4VP flow) |
| **AAMVA Guidelines v1.5** | Published May 2025 | Added 18013-7 alignment + W3C Digital Credentials API |
| **REAL ID enforcement** | Live since May 7, 2025 | Accelerated state mDL programs. mDL is addendum, not replacement. |
| **NIST NCCoE mDL** | Resources published Sep 2025 | Reference architectures for financial + government KYC |

---

## Sources

### Official
- [TSA Participating States](https://www.tsa.gov/digital-id/participating-states)
- [TSA mDL Final Rule (Oct 2024)](https://www.tsa.gov/news/press/releases/2024/10/24/tsa-announces-final-rule-enables-continued-acceptance-mobile-drivers)
- [AAMVA DTS for Relying Parties](https://www.aamva.org/identity/mobile-driver-license-digital-trust-service/for-relying-parties)
- [AAMVA VICAL Portal](https://vical.dts.aamva.org/)
- [ISO DIS 18013-5 Ed. 2](https://www.iso.org/standard/91081.html)
- [NIST NCCoE mDL Resources (Sep 2025)](https://www.nist.gov/news-events/news/2025/09/new-nist-nccoe-mobile-drivers-licenses-project-resources-now-available)

### State Programs
- [California DMV Developer Page](https://www.dmv.ca.gov/portal/ca-dmv-wallet/mdl-for-technology-developers/)
- [Georgia DDS Digital ID](https://dds.georgia.gov/georgia-licenseid/ga-digital-id/ga-digital-drivers-license-and-id)
- [NJ mDL Legislation (Jul 2025)](https://www.nj.gov/governor/news/news/562025/approved/20250723c.shtml)
- [Texas HB 3426](https://legiscan.com/TX/bill/HB3426/2025)
- [NC mDL Strategic Study (ID Tech Wire)](https://idtechwire.com/north-carolina-to-launch-digital-drivers-licenses-by-mid-2025/)

### Industry
- [Apple Wallet States (MacRumors Nov 2025)](https://www.macrumors.com/2025/11/19/wallet-app-drivers-licenses-all-states/)
- [Google Wallet States (9to5Google Oct 2025)](https://9to5google.com/2025/10/11/google-wallet-state-ids/)
- [IDEMIA + Trinsic Partnership (Feb 2026)](https://www.prnewswire.com/news-releases/idemia-public-security-and-trinsic-partner-to-accelerate-mobile-drivers-license-adoption-across-the-us-302698566.html)
- [mDL Fragmentation Analysis (Biometric Update Oct 2025)](https://www.biometricupdate.com/202510/mdl-fragmentation-clouds-us-digital-id-landscape-as-adoption-ticks-steadily-up)
- [Slow Adoption Analysis (Biometric Update Jun 2025)](https://www.biometricupdate.com/202506/american-mdl-uptake-suggests-digital-id-mass-adoption-caught-in-the-slow-lane)
- [State Legislation Roundup (Biometric Update Mar 2025)](https://www.biometricupdate.com/202503/more-state-legislation-as-mobile-drivers-licenses-roll-through-gears-of-government)
- [GET Group UL Certification](https://getgroupna.com/get-mobile-id-certified-by-ul-for-all-interaction-modes-of-iso-iec-18013-5/)
- [SpruceID + California](https://blog.spruceid.com/spruceid-partners-with-ca-dmv-on-mdl/)
