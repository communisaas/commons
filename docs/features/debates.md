# Staked Deliberation (Debates)

> **STATUS: LIVE** — `FEATURES.DEBATE = true` (flipped 2026-04, verified 2026-04-23).
>
> **Known divergences from implementation (still open):**
> - **`POST /api/debates/[id]/resolve` does NOT call `DebateMarket.resolveDebate()` on-chain.** It runs `ctx.runMutation(api.debates.updateStatus, …)` — a local Convex status update. No blockchain transaction is sent.
> - **`/resolve` does NOT block when AI evaluation has started.** The endpoint has no `aiResolution` / `resolution_method` guard; community resolution can still fire after AI has started.
> - **Settlement UI exists.** `src/lib/components/debate/DebateSettlement.svelte` is shipped.
>
> **Resolved during E-cycle (2026-04-23):**
> - **Daily resolution cron no longer a stub.** `convex/debates.ts:resolveExpiredDebates` now dispatches to `${baseUrl}/api/debates/[id]/evaluate` with the cron secret (B3 work). Fails-observable when env missing; skips debates with existing `aiResolution`, zero args, or no on-chain ID.

**Status:** Live on production (`FEATURES.DEBATE = true`). Frontend, API, on-chain contract integration, and daily AI-evaluation cron all wired. Remaining gap: `/resolve` does not settle on-chain itself — that's handled by contract-level resolution or via AI pipeline writing back.
**Tier Requirement:** 3+ (ZK-verified identity)
**Contract:** `voter-protocol/contracts/src/DebateMarket.sol` (1897 lines, 193 tests across 4 test files)
**Deployed:** `0xA07D6F620FEc31A163E1F888956e4c98D522B906` (Scroll Sepolia V11)
**Staking Token:** `0xe70623c79E3b3F7909bd3e989E50a18DdB13C95d` (tUSDC, 6 decimals)
**Spec:** `voter-protocol/specs/DEBATE-MARKET-SPEC.md`

---

## What It Is

When a user disagrees with a template's framing, they can open a *deliberation* -- a structured, anonymous, staked debate scoped to the template's jurisdiction. Arguments compete on merit weighted by engagement tier, not raw capital.

This is NOT a prediction market (bet on what will happen) or a vote (count heads). It is a *debate market*: stake on the quality of reasoning, weighted by earned credibility. The market uses LMSR (Logarithmic Market Scoring Rule) for continuous price discovery with commit-reveal privacy, and resolves via a hybrid of AI evaluation (40%) and tier-weighted community signal (60%).

The user on Commons sees two numbers side-by-side: **847 people sent this** and **the leading counter-argument (AMEND) holds 62% market share.** That changes the calculus for user 848.

---

## Scoring Formula

```
weighted_score = sqrt(stake_in_dollars) * 2^engagement_tier
```

| Participant | Stake | Tier | Weighted Score |
|---|---|---|---|
| Tier 3, small stake | $1 | 3 | sqrt(1) * 8 = **8** |
| Tier 3, large stake | $100 | 3 | sqrt(100) * 8 = **80** |
| Tier 4, small stake | $1 | 4 | sqrt(1) * 16 = **16** |
| Tier 1, large stake (newcomer) | $100 | 1 | sqrt(100) * 2 = **20** |
| Tier 4, small stake (pillar) | $2 | 4 | sqrt(2) * 16 = **22.6** |

The square root compresses the influence of money. The exponential amplifies earned credibility. A Tier 4 member staking $2 has more market impact than a Tier 1 newcomer staking $100.

This formula is used in two contexts:
1. **Argument weight** -- direct scoring of argument quality via stake + co-signs
2. **LMSR trade weight** -- `weightedAmount = floor(sqrt(stake)) * 2^tier` proven inside a ZK circuit so neither stake nor tier is revealed

---

## User Journey

### Discovery

Templates with active debates display an amber "Deliberating" indicator in the browse view. The indicator uses a pulsing amber dot with the word "Deliberating" in amber-600.

**Data flow:** The browse page server load and `/api/templates` GET endpoint query `SELECT DISTINCT template_id FROM debate WHERE status = 'active'` and set `hasActiveDebate: true` on matching templates. The indicator renders in `TemplateCard` (grid view) and `TemplateList` (list view).

The `DebateSurface` component renders on the template detail page (`/s/[slug]`):
- **Any user** if a debate exists (read-only for Tier 0-2)
- **Tier 3+ only** if no debate exists ("Challenge this framing" affordance)

### Initiation (Tier 3+)

1. User clicks "Challenge this framing" on a template without a debate
2. `DebateModal` opens in `proposition` phase
3. User writes a proposition (min 10 chars)
4. Selects stance: SUPPORT / OPPOSE / AMEND
5. Composes argument (min 20 chars, + amendment text if AMEND)
6. Sets stake via `StakeVisualizer` (range $1-$100, spring-animated formula display)
7. `DebateProofGenerator` generates three-tree ZK proof with debate-scoped action domain
8. Submits: `POST /api/debates/create` calls `DebateMarket.proposeDebate()` on-chain, then creates debate + first argument atomically via Convex mutation (`convex/debates.ts`)

Only one active debate per template is allowed (409 if duplicate attempted).

### Participation (Tier 3+)

1. User views active debate on template page
2. Reads existing arguments (sorted by weighted score, filterable by stance)
3. Clicks "Add your argument"
4. `DebateModal` opens in `stance-selection` phase (skips proposition)
5. Same flow: stance -> compose -> stake -> proof -> submit
6. `POST /api/debates/[debateId]/arguments` calls `DebateMarket.submitArgument()` with ZK proof + stake + beneficiary address

### Co-signing

Tier 3+ users can co-sign existing arguments via `POST /api/debates/[debateId]/cosign`, adding their stake and tier weight. Calls `DebateMarket.coSignArgument()` on-chain with ZK proof + stake + beneficiary address.

### Trading (Commit-Reveal LMSR)

The market uses Hanson's LMSR executed in batches per epoch:

**LMSR cost function:**
```
C(q) = b * ln(sum(exp(q_i / b)))
```

**Price of argument i:**
```
p_i = exp(q_i / b) / sum(exp(q_j / b))
```

Prices always sum to 1.

**Epoch lifecycle:**
```
Epoch N                          Epoch N+1
|- commit phase ----------||- reveal for N -||- execute N -||- commit ---- ...
|  traders submit         |  traders reveal  |  LMSR batch  |
|  H(trade, nonce)        |  preimages       |  update       |
```

1. **Commit** (`POST .../commit`): Submit `commitHash = H(argument_index, direction, weighted_amount, nonce)` with three-tree ZK proof. Calls `DebateMarket.commitTrade()` on-chain.
2. **Reveal** (`POST .../reveal`): Submit preimage (epoch, commitIndex, argumentIndex, direction, nonce) + `debateWeightProof` (2 public inputs). Calls `DebateMarket.revealTrade()` on-chain.
3. **Execute**: `DebateMarket.executeEpoch()` applies all valid reveals as a batch. All traders in an epoch receive the same average execution price -- no front-running, no MEV.

Epoch-scoped nullifiers prevent double-trading within an epoch while keeping cross-epoch trades unlinkable.

### Resolution

Three resolution paths:

**Path 1 -- AI + Community (primary):**
Triggered by the daily cron (`GET /api/cron/debate-resolution`, 02:00 UTC) or manually via `POST .../evaluate` (CRON_SECRET auth). The pipeline:
1. Fetches argument bodies from DB
2. Runs 5-model AI evaluation panel via `@voter-protocol/ai-evaluator`
3. Aggregates scores via median-of-N across 5 dimensions
4. Signs EIP-712 attestations and submits on-chain via `submitAIEvaluation()`
5. Alpha-blends: `final_score = 0.4 * ai_score + 0.6 * normalize(community_score)`
6. Highest `final_score` wins. Status -> `resolved`.

If AI quorum fails (< 4 of 5 model signatures) or consensus not reached, the debate escalates to governance.

**Path 2 -- Community Only:**
`POST .../resolve` (Tier 3+). Blocked if AI evaluation has started (`resolution_method` or `ai_resolution` populated). Determines winner by highest `weighted_score`. Calls `DebateMarket.resolveDebate()` on-chain. Status -> `resolved`.

**Path 3 -- Governance Override:**
When AI consensus fails, `escalateToGovernance()` is called on-chain. Status -> `awaiting_governance`. A governance-appointed reviewer submits resolution via `submitGovernanceResolution()` with a public justification.

### Appeal

Any Tier 3+ participant can appeal a resolved or resolving debate via `POST .../appeal`. Calls `DebateMarket.appealResolution()` on-chain. Status -> `under_appeal`. Requires 2x the proposer bond.

### Settlement

Two settlement paths via `POST .../claim`:

**Path 1 -- Simple claim (Phase 1):**
Calls `DebateMarket.claimSettlement(debateId, nullifier)`. Used when the user staked via `submitArgument`/`coSignArgument`. Requires ZK proof data (`nullifierHex`, `proofHex`, `publicInputs`).

**Path 2 -- Private position settlement (Phase 2):**
Calls `DebateMarket.settlePrivatePosition(debateId, positionProof, positionPublicInputs)`. Requires a position-note ZK proof (5 `bytes32` public inputs). Settles without revealing trading position or identity on-chain.

Payout formula:
```
payout = stake + (losing_pool * stake / winning_argument_total_stake)
```

---

## Architecture

### Data Model

**Debate** (28 fields)

| Group | Field | Type | Notes |
|---|---|---|---|
| Core | `_id` | `Id<'debates'>` | Convex document id |
| Core | `template_id` | `String` | FK to Template |
| Core | `debate_id_onchain` | `String @unique` | `bytes32` from `proposeDebate()` |
| Core | `action_domain` | `String` | `keccak256(debateId, "debate", propHash) mod BN254` |
| Core | `proposition_hash` | `String` | `keccak256(propositionText)` |
| Core | `proposition_text` | `String` | Human-readable claim |
| Core | `deadline` | `DateTime` | Debate end time |
| Core | `jurisdiction_size` | `Int` | Drives LMSR liquidity (`b = hint * baseLiquidityPerMember`) |
| Core | `status` | `String` | `'active' \| 'resolving' \| 'resolved' \| 'awaiting_governance' \| 'under_appeal'` |
| Core | `argument_count` | `Int` | Aggregate cache |
| Core | `unique_participants` | `Int` | Aggregate cache |
| Core | `total_stake` | `BigInt` | Aggregate cache |
| Resolution | `winning_argument_index` | `Int?` | Populated after resolution |
| Resolution | `winning_stance` | `String?` | `'SUPPORT' \| 'OPPOSE' \| 'AMEND'` |
| Resolution | `resolved_at` | `DateTime?` | |
| AI | `ai_resolution` | `Json?` | Full `AIResolutionData` blob |
| AI | `ai_signature_count` | `Int?` | Number of model signatures submitted |
| AI | `ai_panel_consensus` | `Float?` | Model agreement 0-1 |
| AI | `resolution_method` | `String?` | `'ai_community' \| 'governance_override' \| 'community_only'` |
| AI | `appeal_deadline` | `DateTime?` | |
| AI | `governance_justification` | `String?` | Public justification for governance override |
| Chain | `tx_hash` | `String?` | `proposeDebate()` transaction hash |
| Chain | `proposer_address` | `String` | Relayer wallet address |
| Chain | `proposer_bond` | `BigInt` | Bond in staking token (6 decimals) |
| LMSR | `market_status` | `String` | `'pre_market' \| 'active' \| 'resolved'` |
| LMSR | `market_liquidity` | `BigInt?` | LMSR `b` parameter (SD59x18 raw) |
| LMSR | `current_prices` | `Json?` | `{ "0": "0.333", "1": "0.333", "2": "0.333" }` |
| LMSR | `current_epoch` | `Int` | Current epoch number |
| LMSR | `trade_deadline` | `DateTime?` | Current epoch commit deadline |
| LMSR | `resolution_deadline` | `DateTime?` | Market resolution deadline |

Indexes: `template_id`, `status`, `debate_id_onchain`

**DebateArgument** (17 fields)

| Group | Field | Type | Notes |
|---|---|---|---|
| Core | `_id` | `Id<'debateArguments'>` | Convex document id |
| Core | `debate_id` | `String` | FK to Debate |
| Core | `argument_index` | `Int` | On-chain index; `@@unique([debate_id, argument_index])` |
| Content | `stance` | `String` | `'SUPPORT' \| 'OPPOSE' \| 'AMEND'` |
| Content | `body` | `String` | Full argument text |
| Content | `body_hash` | `String` | `keccak256(body)` |
| Content | `amendment_text` | `String?` | Only for AMEND stance |
| Content | `amendment_hash` | `String?` | `keccak256(amendmentText)` |
| Scoring | `stake_amount` | `BigInt` | 6-decimal staking token |
| Scoring | `engagement_tier` | `Int` | User's tier at submission time |
| Scoring | `weighted_score` | `BigInt` | `sqrt(stake) * 2^tier` |
| Scoring | `total_stake` | `BigInt` | Cumulative including co-signs |
| Scoring | `co_sign_count` | `Int` | Aggregate cache |
| LMSR | `current_price` | `String?` | Decimal string, e.g. `"0.42"` |
| LMSR | `price_history` | `Json?` | `[{ epoch, price, timestamp }]` |
| LMSR | `position_count` | `Int` | Unique traders on this argument |
| AI | `ai_scores` | `Json?` | `{ reasoning, accuracy, evidence, constructiveness, feasibility }` |
| AI | `ai_weighted` | `Int?` | Dimension-weighted AI score (0-10000 basis points) |
| AI | `final_score` | `Int?` | Alpha-blended final score (0-10000 bp) |
| AI | `model_agreement` | `Float?` | Fraction of models within 20% of median (0-1) |

Indexes: `debate_id`, `weighted_score`

No `CoSign` model -- co-signs are on-chain only (`stakeRecords` in DebateMarket.sol). The `co_sign_count` and `total_stake` fields are aggregate caches.

### AI Resolution

**5 Dimensions** (basis points, 0-10000):

| Dimension | Weight | What It Measures |
|---|---|---|
| Reasoning | 30% | Logical coherence, absence of fallacies |
| Accuracy | 25% | Verifiable claims supported by evidence |
| Evidence | 20% | Quality and relevance of citations |
| Constructiveness | 15% | Does the argument advance discourse? |
| Feasibility | 10% | If AMEND: is the proposed change actionable? |

**Alpha blend:** `alphaWeight: 4000` (40% AI, 60% community)

```
final_score = 0.4 * ai_weighted_score + 0.6 * normalize(community_score)
```

**Model agreement:** Fraction of models scoring within 20% of median (0-1). Quorum requires 4 of 5 model signatures.

**Consensus failure:** If quorum not met or consensus not achieved, the debate escalates to governance via `escalateToGovernance()` on-chain.

### ZK Integration

Three circuits:

| Circuit | Purpose | Public Inputs |
|---|---|---|
| **three-tree** | Membership + tier proof for argument/co-sign/commit | 31 inputs (standard three-tree circuit) |
| **debate-weight** | Proves `weightedAmount = floor(sqrt(stake)) * 2^tier` without revealing stake or tier | 2 inputs (`bytes32[2]`) |
| **position-note** | Proves note ownership for private settlement | 5 inputs (`bytes32[5]`) |

**Action domain derivation:**
```typescript
actionDomain = keccak256(baseDomain, "debate", propositionHash) % BN254_MODULUS
```

Mirrors `DebateMarket.deriveDomain()` on-chain. A user can send a message (template action domain) AND debate the same template (debate action domain) without nullifier collision.

### Components

23 components in `src/lib/components/debate/`:

**Core Flow:**

| Component | Lines | Purpose |
|---|---|---|
| `DebateSurface` | - | Container on template page |
| `ActiveDebatePanel` | - | Renders debate with arguments |
| `ArgumentCard` | - | Single argument display |
| `DebateMetrics` | - | Participants, stake, countdown |
| `PropositionDisplay` | - | Blockquote proposition + hash |
| `StanceSelector` | - | Three-option picker with spring physics |
| `StakeVisualizer` | - | Animated formula visualization |
| `DebateProofGenerator` | - | ZK proof with debate action domain |
| `DebateModal` | - | Full composition flow (rendered by ModalRegistry) |

**Market Trading:**

| Component | Lines | Purpose |
|---|---|---|
| `TradePanel` | 486 | Commit/reveal trading interface |
| `MarketPriceBar` | 179 | Horizontal price bar for all arguments |
| `EpochPhaseIndicator` | 109 | Shows commit/reveal/executing/idle phase with countdown |

**AI Resolution:**

| Component | Lines | Purpose |
|---|---|---|
| `ResolutionPanel` | 259 | Full resolution display with AI + community scores |
| `AIScoreBreakdown` | 115 | 5-dimension score breakdown per argument |
| `AlphaBlendBar` | 88 | Visual 40/60 AI/community weight bar |
| `ModelAgreementDots` | 65 | Dot indicators for model consensus |
| `AppealBanner` | 121 | Appeal status and deadline display |

**Cross-Surface Signaling:**

| Component | Lines | Purpose |
|---|---|---|
| `DebateSignal` | - | Inline debate signal on template card |
| `MobileDebateBanner` | - | Mobile-optimized debate banner |
| `DebateMarketCard` | - | Standalone debate market card |

**Supporting:**

| Component | Lines | Purpose |
|---|---|---|
| `ResolutionPhaseIndicator` | - | Shows resolution status badge |
| `PrivacyProofStatus` | - | ZK proof generation status |
| `TierExplanation` | - | Explains tier weight calculation |

### API Routes

14 endpoints + 1 cron:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/debates/create` | Tier 3+ | Create debate + first argument atomically. Calls `proposeDebate()` on-chain. |
| `GET` | `/api/debates/by-template/[templateId]` | Public | Fetch debate for a template |
| `GET` | `/api/debates/[debateId]/arguments` | Public | List arguments (filterable by stance) |
| `POST` | `/api/debates/[debateId]/arguments` | Tier 3+ | Submit argument with ZK proof. Calls `submitArgument()` on-chain. |
| `POST` | `/api/debates/[debateId]/cosign` | Tier 3+ | Co-sign argument with ZK proof. Calls `coSignArgument()` on-chain. |
| `POST` | `/api/debates/[debateId]/commit` | Tier 3+ | Submit trade commitment hash + three-tree proof. Calls `commitTrade()` on-chain. |
| `POST` | `/api/debates/[debateId]/reveal` | Tier 3+ | Reveal committed trade + debate-weight proof. Calls `revealTrade()` on-chain. |
| `POST` | `/api/debates/[debateId]/resolve` | Tier 3+ | Community-only resolution. Blocked if AI evaluation started. Calls `resolveDebate()` on-chain. |
| `POST` | `/api/debates/[debateId]/evaluate` | CRON_SECRET | Triggers 5-model AI evaluation pipeline. Rate limited: 1 concurrent/debate, 5-min debounce, 10/hour global. |
| `GET` | `/api/debates/[debateId]/ai-resolution` | Public | Fetch AI resolution data (scores, consensus, method) |
| `POST` | `/api/debates/[debateId]/appeal` | Tier 3+ | Appeal resolution (requires 2x bond). Calls `appealResolution()` on-chain. |
| `POST` | `/api/debates/[debateId]/claim` | Authenticated | Claim settlement. Two paths: simple claim or private position. |
| `GET` | `/api/debates/[debateId]/position-proof` | Public | Merkle proof for private settlement (proxied from shadow-atlas) |
| `GET` | `/api/debates/[debateId]/stream` | Public | SSE real-time updates (dual-source: shadow-atlas + Convex polling) |
| `GET` | `/api/cron/debate-resolution` | CRON_SECRET | Automated daily resolution at 02:00 UTC. Finds expired active debates and triggers evaluation. |

All `/api/debates/` routes (including GETs) are rate-limited at 20 req/min per user via sliding window in `hooks.server.ts`.

### SSE Real-Time Updates

`GET /api/debates/[debateId]/stream` combines two event sources:

1. **Shadow-atlas upstream** -- market price updates, trade activity, epoch execution
2. **Convex polling** (5s interval) -- AI resolution state transitions

**Event types:**

| Event | Source | Payload |
|---|---|---|
| `state` | shadow-atlas | `{ prices, epochPhase, epochSecondsRemaining }` |
| `epoch_executed` | shadow-atlas | `{ prices, pricesStale? }` |
| `trade_activity` | shadow-atlas | (stubbed -- no UI handler) |
| `evaluating` | Convex poll | `{ debateId }` -- status -> resolving |
| `ai_scores_submitted` | Convex poll | `{ debateId, signatureCount, panelConsensus }` |
| `ai_evaluation_submitted` | shadow-atlas | Same shape as `ai_scores_submitted` (shared handler) |
| `resolved_with_ai` | Convex poll | `{ debateId, winningArgumentIndex, winningStance, resolutionMethod }` |
| `governance_escalated` | Convex poll | `{ debateId, panelConsensus }` |
| `appeal_started` | Convex poll | `{ debateId, appealDeadline }` |
| `resolution_finalized` | Convex poll | `{ debateId, winningArgumentIndex, winningStance, resolutionMethod }` |
| `resolved` | shadow-atlas | Triggers full debate reload |

Client reconnects automatically after 5s on SSE error. Polling stops once debate is `resolved`.

### Routes

```
/s/[slug]                        -> template page with DebateSurface below preview
/s/[slug]/debate/[debateId]      -> deep link to specific debate (dedicated page)
```

---

## Design System

### Color Vocabularies

**Stance colors:**
- SUPPORT: indigo
- OPPOSE: red
- AMEND: amber

**Resolved outcome colors** (semantic shift from deliberation to validation):
- Won: emerald
- Lost: red
- Contested: amber

**AI contribution:**
- AI score: violet
- Community score: indigo
- `AlphaBlendBar` visualizes the 40/60 split

**Epoch phases:**
- Commit: green
- Reveal: blue
- Executing: amber
- Idle: slate

**Tier progression:**
- Tier 0: slate
- Tier 1: sky
- Tier 2: indigo
- Tier 3: violet
- Tier 4: amber

**Model consensus (`ModelAgreementDots`):**
- High (>= 0.8): emerald
- Moderate (0.5-0.8): amber
- Low (< 0.5): red

---

## Security Posture

| Aspect | Implementation |
|---|---|
| **Authentication** | Session-based via `locals.session`. All mutations require `session.userId`. |
| **Tier enforcement** | `user.trust_tier >= 3` checked server-side on all mutation endpoints. |
| **Tier clamping** | Tier values are capped server-side; client cannot inflate. |
| **Rate limiting** | 20 req/min per user on all `/api/debates/` routes (GETs included). User-keyed, falls back to IP for unauthenticated requests. |
| **Evaluate rate limiting** | Per-isolate: 1 concurrent per debate, 5-min debounce per debate, 10/hour global cap. CRON_SECRET auth. |
| **Proof randomness** | ZK proof nonces generated client-side in `DebateProofGenerator`. Commitment nonces stored locally for reveal phase. |
| **On-chain auth** | EIP-712 signatures target DistrictGate domain (proof verification delegation). Server-side relayer wallet submits transactions. |
| **CSRF** | `handleCsrfGuard` in hooks.server.ts covers debate mutation endpoints. |
| **Input validation** | Proposition >= 10 chars, argument >= 20 chars, direction 0/1, position proof exactly 5 bytes32 inputs. |
| **Duplicate prevention** | One active debate per template (409 on duplicate). Optimistic lock via `status: 'active'` WHERE clause on resolve. |

---

## Known Gaps (Resolve Later)

| Gap | Severity | Notes |
|---|---|---|
| No event indexer for on-chain state sync | **Medium** | Aggregate caches (`argument_count`, `unique_participants`, `total_stake`, `co_sign_count`, prices) updated in API handlers, not via chain events. Can drift. |
| Settlement has no frontend UI | **Medium** | Both on-chain settlement paths (`claimSettlement`, `settlePrivatePosition`) are wired in the API but no user-facing settlement component exists. |
| `trade_activity` SSE event has no client consumer | **Low** | Event emitted by shadow-atlas but no listener registered in `debateState.svelte.ts`. EventSource silently drops unhandled events. Re-register when TradePanel activity indicator is built. |
| `evaluate` rate limit is per-isolate on CF Workers | **Low** | `activeEvaluations` Set and `recentEvaluations` Map are module-scoped. On Workers, isolates do not share state. Acceptable because the endpoint is cron-only and Convex-level status checks provide the real guard. |
| No wallet integration UI | **Low** | Server-side relayer used for all on-chain transactions. No client-side wallet connect. |
| No content moderation for arguments | **Low** | Argument text is unfiltered. Needs extension of existing moderation pipeline. |

---

## Spec Divergences

Intentional departures from `DEBATE-MARKET-SPEC.md`:

| Area | Spec Says | Implementation Does | Rationale |
|---|---|---|---|
| **Tier threshold** | Tier 1+ (`engagement_tier >= 1`) | Tier 3+ (`trust_tier >= 3`) | Intentional tightening. Only identity-verified participants can create or participate in debates. Prevents Sybil attacks on market signal. |
| **AI evaluation** | TEE-attested evaluation: open-weight models inside Nitro Enclave, attestation hash on-chain, TEEEvaluationRegistry verifies PCR measurements | Centralized server calling 5 LLMs via `@voter-protocol/ai-evaluator` with CRON_SECRET auth | Pragmatic Phase 1 implementation. The evaluator runs server-side and signs EIP-712 attestations. TEE evaluation is the Phase 2 upgrade (~$0.12/debate, on-demand Graviton instances). Bittensor subnet explored but infeasible ($28K+ lock). |
| **Phase coverage** | Three deployment phases: Phase 1 (commit-reveal LMSR), Phase 2 (shielded position pool), Phase 3 (flow-encrypted batches) | Phase 1 and Phase 2 implemented. Phase 3 (flow-encrypted batches with ElGamal + threshold decryption) not implemented. | Phase 3 requires DKG ceremony infrastructure and threshold key management. |
| **Contract deployment** | Design status | Deployed to Scroll Sepolia at `0xA07D6F620FEc31A163E1F888956e4c98D522B906` (V11, hardened) | Testnet deployment; mainnet pending audit. |
| **Resolution timing** | 24h evaluation window after trade close | Daily cron at 02:00 UTC + on-demand via evaluate endpoint | Batched resolution is simpler operationally and reduces gas costs. |

---

## Contract Integration

**On-chain functions wired end-to-end** (server -> `debate-market-client.ts` -> Scroll Sepolia):

| Function | API Endpoint | Status |
|---|---|---|
| `proposeDebate()` | `POST /api/debates/create` | Wired. Falls back to off-chain in dev. |
| `submitArgument()` | `POST .../arguments` | Wired. |
| `coSignArgument()` | `POST .../cosign` | Wired. |
| `commitTrade()` | `POST .../commit` | Wired. Falls back to off-chain in dev. |
| `revealTrade()` | `POST .../reveal` | Wired. Falls back to off-chain in dev. |
| `executeEpoch()` | (called by relayer/keeper) | Available in client. No dedicated API endpoint. |
| `resolveDebate()` | `POST .../resolve` | Wired. Community-only path. |
| `submitAIEvaluation()` | `POST .../evaluate` (via ai-evaluator) | Wired. Submitter key from env. |
| `resolveDebateWithAI()` | `POST .../evaluate` (via ai-evaluator) | Wired. Called after submitAIEvaluation. |
| `escalateToGovernance()` | `POST .../evaluate` (on consensus failure) | Wired. |
| `submitGovernanceResolution()` | Not exposed via API | Available in client, no endpoint. |
| `appealResolution()` | `POST .../appeal` | Wired. |
| `finalizeAppeal()` | Not exposed via API | Available in client, no endpoint. |
| `claimSettlement()` | `POST .../claim` (Path 1) | Wired. |
| `settlePrivatePosition()` | `POST .../claim` (Path 2) | Wired. |

**View functions used:**
- `deriveDomain()` -- called during debate creation for action domain computation
- `getDebateState()` -- available but not actively polled (aggregate caches used instead)
- `aiArgumentScores()`, `aiSignatureCount()`, `aiEvalNonce()` -- available for verification

**Not yet wired:**
- Event indexer for `EpochExecuted`, `DebateResolvedWithAI`, `AIEvaluationSubmitted` events. Aggregate caches updated in API handlers instead.
- `submitGovernanceResolution()` and `finalizeAppeal()` have no API endpoints. Available in the client for future governance UI.
