# Wave-by-Wave Execution Sequence

## Wave 1: Sales-Blocker Fixes (days 1-7)

**Goal:** Stop showing prospects empty bars and broken features. Eleven items, all under 1 day each, no blocking dependencies between them.

**Tasks:**
| ID | Name | Effort | Track |
|---|---|---|---|
| T1-1 | Dashboard wiring | 0.5d | Launch Readiness |
| T1-2 | Bulk merge fields applied at send | 0.5d | Launch Readiness |
| T1-4 | Donation receipts + Stripe trialing | 1.5d | Launch Readiness |
| T1-5 | Member removal + role change | 0.75d | Launch Readiness |
| T1-7 | Campaign clone | 0.5d | Launch Readiness |
| T1-8 | District segmentation filter | 0.5d | Launch Readiness |
| T1-10 | OG images on /org pages | 0.5d | Launch Readiness |
| T10-3 | tierMap key mismatch fix | 0.1d | Tier Cleanup |
| T10-5 | MDL_MDOC flag flip | 0.1d | Tier Cleanup |
| (T10-6, T10-11 = dedup pointers to T1-5, T1-4) | | | |

**Parallelization:** All independent. 3 engineers ship Wave 1 in 2-3 days. Single engineer = 4-5 days.

**Completion signal:** Demo at `/org/[slug]` renders real packet, real funnel, real tier distribution. `{{firstName}}` no longer ships as literal. Donation receipts send. Multi-person orgs work. Acquisition pages have OG images. All 23 critical stubs from `org_critical_stubs_inventory` that are W-1 eligible are closed.

---

## Wave 2: Launch Enablement (weeks 1-4)

**Goal:** First-paying-org operational. Larger items, parallelizable across four tracks.

### Track A: Comms infrastructure (Lane 2)

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T2-2 | ses-proxy Lambda deployment | 1d | First (unblocks client-direct blasts) |
| T2-3 | Email plaintext multipart | 1d | Batched with T2-4 |
| T2-4 | List-Unsubscribe on Convex path | 2d | After T2-3 (both touch sendViaSes) |
| T2-5 | Soft-bounce categorization | 1d | Independent |
| T2-1 | SMS blast dispatch (client-side) | 3d | Independent of email |

### Track B: Developer platform (Lane 9)

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T9-1 | TS SDK npm publish | 1d | Independent |
| T9-2 | Python SDK PyPI publish | 0.5d | Independent |
| T9-9 | Rate limit policy reconciliation | 0.25d | Independent |
| **T9-3 (CHOKEPOINT)** | **Outbound webhooks** | **3d** | **Foundation for W-3/W-4 dependents** |

### Track C: Migration unblockers (Lane 1 + 9)

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T1-3 | AN OSDI sync shipped | 7d | Independent |
| T9-4 | OSDI compliance (/api/osdi/v1/) | 2d | Independent |
| T1-6 | A/B winner picker | 2.5d | Independent |
| T1-9 | Workflow send_email + add_tag | 2d | Depends on T2-2 |

### Track D: Substrate honesty (Lane 10)

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T10-1 | reputationTier writer post-signup | 1d | Sequenced after T10-3 (W-1) |
| T10-2 | engagementTier server-side cross-check | 0.5d | After T10-1 |
| T10-4 | CAI grounded in real engagement | 0.1d | Editorial after T10-1+T10-3 |
| T10-9 | atlasVersion per campaignAction | 1d | Independent |
| T10-10 | Engagement tier histogram in UI | 0.5d | After T10-1 |

### Other Wave 2 items

| ID | Name | Effort | Track |
|---|---|---|---|
| T9-5 | Audit log API (= T10-8 dedup) | 2d | Developer Platform |

**Parallelization:** Four tracks fully parallel. 4 engineers ship Wave 2 in 2-3 weeks. Single engineer = 6-8 weeks (sequential).

**Chokepoint:** T9-3 outbound webhooks unblocks T9-7, T8-8, T9-8 in later waves.

**Completion signal:** First org signs up, imports from AN via OSDI sync, sends a verified campaign, dispatches SMS, receives donation receipts, manages team. Substrate metrics (CAI, tier distribution) reflect real engagement. Outbound webhooks live. SDKs published. ses-proxy Lambda deployed in prod.

---

## Wave 3: Capability Realization (months 1-3)

**Goal:** Capability transcendence claims start being true at substrate level.

### Mainnet deployment cluster (CHOKEPOINT CP-2)

**Composite ops event:** Execute three deployments together.

| ID | Name | Effort | Note |
|---|---|---|---|
| T3-6 | Shadow Atlas mainnet DistrictRegistry | 7d | Core registry deployment |
| T5-5 | Mainnet DebateMarket (uncomment + AIEvaluationRegistry) | 7d | Must add to DeployScrollMainnet.s.sol |
| T6-2 | Mainnet SnapshotAnchor (new script) | 1d | Two instances: atlas + receipts |

**Elapsed dependencies:** Security audit completion, 3-of-5 Safe multisig setup, HonkVerifier_20 pre-deployment, AIEvaluationRegistry model signer key management. Plan ~4 weeks elapsed total.

### TEE Nitro Enclave (CHOKEPOINT CP-3) — parallel with mainnet

| ID | Name | Effort | Elapsed |
|---|---|---|---|
| T5-3 | TEE Nitro Enclave deployment | 1 week eng | 3 weeks elapsed |

Independent of all code work. Software waves continue around it.

### Agentic systems substrate (CHOKEPOINT CP-4)

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T4-2 | ZK proof attachment + draftedMessages | 1.5-2 wks | Foundation |
| T4-1 | Delegation executor | 3-4 wks | After T4-2 |
| T4-6 | Agent-as-civic-actor pricing | 0.75 wk | After T4-1 |
| T4-7 | Message-writer proof binding | 1 wk | After T4-2 |
| T4-8 | Agent trace observability extension | 0.75 wk | After T4-1 |
| T4-9 | Delegation UI | 2 wks | After T4-1+T4-2+T4-7+T4-8 |
| T4-10 | Multi-agent flows | 0d | Subsumed in T4-1 |

### Accountability anchoring pipeline

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T6-1 | Receipt Merkle anchoring pipeline | 3-4d | After T6-2 |
| T6-3 | Anchoring cadence cron | 0.5d | After T6-1 |
| T6-4 | Constituent-side receipt access | 1.5d | Independent |
| T6-5 | Receipt API for orgs | 1.5d | Independent |
| T6-7 | Browser-based receipt verification UI | 2d | After T6-1 |
| T6-10 | Long-term archive manifest | 1d | After T6-1 |

### Composability surfaces

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T7-1 | Coalition aggregation API (replace 501) | 1.5d | Foundation |
| T7-2 | Shared supporter pools | 3d | After T7-1 |
| T7-3 | Cross-org reputation portability | 2d | After T7-1 |
| T7-4 | Cross-border campaign schema | 2d | Independent |
| T7-5 | Coalition packet computation | 1d | After T7-1 |
| T7-9 | Network rate limit on stats | 0.5d | After T7-1 |
| T7-10 | Cross-org Merkle decision (docs) | 0.1d | Independent |

### Quality signaling (Sepolia-side)

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T5-1 | Auto-debate-spawn | 1d | Independent |
| T5-2 | On-chain stake verification | 2d | Independent |
| T5-6 | Debate → tier promotion | 6d | After T5-2+T10-1 |
| T5-7 | Position privacy UX | 5d | After T5-8 |
| T5-8 | LMSR live price feed | 4d | After T5-2 |
| T5-9 | Org-side debate signal | 3d | After T5-1+T5-8 |
| T5-10 | Debate market in verification packet | 1.5d | After T5-1 |

### Reach extension

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T3-1 | State legislator data (OpenStates) | 10d | Foundation for W-4 reach work |
| T3-2 | Special district officeholder data | 14d | Parallel with T3-1 |
| T3-3 | CA rep-lookup wiring | 3d | After hydration runs |
| T3-4 | GB rep-lookup wiring | 3d | After hydration runs |
| T3-5 | AU rep-lookup wiring | 3d | After hydration runs |
| T3-7 | TIGER 2026 monitoring | 3d | Independent |
| T3-9 | Postal Bubble disambiguation | 10d | Independent |

### Reader-side foundation

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T8-2 | /v/[hash] enhancements | 2d | Foundation |
| T8-3 | In-browser attestation verify | 1d | After T8-2 |
| T8-4a | Offline-verify instructions (Tier A) | 0.25d | Independent |
| T8-10 | Reader-side privacy model docs | 0.5d | Independent |

### Tier system completion

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T10-7 | Custom fields type system | 2d | Independent |

**Parallelization:** 5-6 engineers running 7 sub-tracks in parallel. Full Wave 3 = 3 months elapsed (bounded by mainnet + TEE elapsed times).

**Completion signal:** Mainnet contracts live. TEE attesting constituent resolution. Delegation executor running. Receipt Merkle anchoring pipeline operational. Coalition aggregation API working. Cross-border campaign schema shipped. State legislator data ingested for all 50 states. Three countries live (CA, GB, AU). `/v/[hash]` is staffer-grade. **Capability transcendence claims are substrate-true.**

---

## Wave 4: Phase 3 Differentiators (months 3-6)

**Goal:** Realize categorical differentiators no incumbent can match.

### Agentic Phase 3 (depends on W-3 executor)

| ID | Name | Effort |
|---|---|---|
| T4-3 | Per-supporter bill alerts | 10d |
| T4-4 | Agentic legislative monitoring 24 boundary types | 15d |
| T4-5 | Cross-org agent action portability | 4d |

### Multi-jurisdiction routing

| ID | Name | Effort | Dependency |
|---|---|---|---|
| T3-8 | Multi-jurisdiction routing at campaign layer | 20d | T3-1 + T3-2 |
| T3-10 | Per-district feed infrastructure | 14d | T3-1 + T3-2 |

### Reader-side dashboard

| ID | Name | Effort | Sequence |
|---|---|---|---|
| T8-1a | DM office profile + email domain verification | 7d | Foundation |
| T8-1b | Reader dashboard UI | 10d | After T8-1a |
| T8-5 | CRM integration feed | 8d | After T8-1a |
| T8-7 | Per-DM profile enhancements | 5d | Independent |
| T8-8 | Webhook notification API | 1d | After T8-1a + T9-3 |
| T8-9 | Weekly digest | 2d | After T8-1a |

### Quality TEE AI panel

| ID | Name | Effort | Dependency |
|---|---|---|---|
| T5-4 | TEE-attested AI panel execution | 21d | After T5-3 |

### Coalition Phase 3

| ID | Name | Effort |
|---|---|---|
| T7-6 | Coalition campaign delivery (multi-country) | 2d |
| T7-7 | White-label branding (Layer a) | 2d |
| T7-8 | Member role update mutation | 1d |

### Accountability extensions

| ID | Name | Effort |
|---|---|---|
| T6-6 | State-bill ingestion (OpenStates for scorecards) | 3d |
| T6-8 | Scorecard methodology versioning | 0.5d |
| T6-9 | Receipt response auto-detection (vote_cast path) | 1d |

### Developer platform Phase 3

| ID | Name | Effort | Dependency |
|---|---|---|---|
| T9-6 | Activity feed v1 endpoint | 0.5d | Independent |
| T9-7 | Real-time subscriptions v1 (SSE) | 1.5d | T9-3 |
| T9-10 | Embed widget enhancements (postal + analytics) | 1.5d | Independent |

**Parallelization:** 4 engineers running 6 sub-tracks in parallel. Wave 4 = 3 months elapsed.

**Completion signal:** A constituent's agent monitors all 24 jurisdictions for their H3 cell. A single campaign delivers to federal + state + local + special district officials in one operation. A staffer with verified office profile sees verified incoming in a dashboard. Indigov-class CRM consumes Commons feed via `/api/v1/reader/incoming`. Coalition tier features fully justify $200/mo differential.

---

## Wave 5: Continuous / J-phase (ongoing)

Items operating on slower cadences, post-first-paying-org.

| ID | Name | Effort | Dependency |
|---|---|---|---|
| T2-6 | Custom domain + DKIM/DMARC per org | 14d (XL) | First customer demand |
| T2-8 | A2P 10DLC compliance plumbing | 8d | T2-1 + first SMS customer |
| T2-9 | MMS support | 2d | T2-1 + T2-8 |
| T8-4b | IPFS-pinned campaign report artifact (Tier B) | 10d | T6-1 + T6-2 |
| T8-6 | Long-term-survivable artifact pattern | 1.5d | T6-10 |
| T9-8 | Developer portal | 2d | T9-3 + T9-4 + T9-6 + T9-7 |

**Parallelization:** 1-2 engineers continuous. No discrete completion milestone.

**External W-5 items (ops, not engineering):**
- CivicEngine / Civitech licensing decision
- Open-weight models in TEE enclave (16 GiB instance upgrade)
- Provincial / state-second-chamber legislators internationally
- Indigov partnership signed

---

## Engineering capacity model

| Engineer Count | W-1 | W-2 | W-3 | W-4 | W-5 | Total to W-4 complete |
|---|---|---|---|---|---|---|
| 1 | 5 days | 6 weeks | bottlenecked by elapsed | bottlenecked | continuous | 9-12 months |
| 3 | 2 days | 2 weeks | 3 months | 2 months | continuous | 6 months |
| 5-6 | 1 day | 1 week | 3 months (elapsed-bound) | 1.5 months | continuous | 5 months |

The bound at 5+ engineers is **elapsed time** (mainnet deployment + TEE deployment + AN/state portal partnerships), not engineering. Adding more engineers past 5-6 has diminishing return.
