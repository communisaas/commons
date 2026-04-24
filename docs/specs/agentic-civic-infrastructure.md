# Agentic Civic Infrastructure

> **STATUS: VISION** — Architectural vision document. Guides long-term design direction.

**Status:** Vision
**Author:** Architecture
**Created:** 2026-03-05
**Depends on:** Agent system (Cycle 35+), Shadow Atlas, Engagement Tiers, Debate Markets, ZK Identity

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Treat as vision framing;
> numeric and event specs drift from live code. Use
> `src/lib/server/ai/llm-cost-protection.ts` and
> `src/lib/core/agents/providers/gemini-provider.ts` as sources of truth.
>
> - **Rate limits below are 2–6× higher than enforced.** Live values
>   from `llm-cost-protection.ts:~52-85` (guest / auth / verified per
>   hour): subject-line `3/5/5`; decision-makers `0/2/3`;
>   message-generation `0/3/5`; embeddings `0/20/20`; daily global
>   `3/10/15`/day. Any "Auth 15/hr / Verified 30/hr" framing here is
>   wrong.
> - **Moderation Layer 1 model migrated.** `Llama Guard 4 12B` is no
>   longer on Groq's free tier; live Layer 1 is
>   `openai/gpt-oss-safeguard-20b` (`llama-guard.ts:20`). MLCommons
>   S1/S4 block policy is unchanged. (Layer 0 is still
>   `llama-prompt-guard-2-86m`; Layer 2 quality-assessment was never
>   built — pipeline is 2 layers, not 3.)
> - **SSE event vocabulary:** `/api/agents/stream-decision-makers`
>   emits `segment`, `identity-found`, `candidate-resolved`, **and
>   `verification`** (after DNS MX batch verification). Clients must
>   handle all four. `stream-subject` → `thought`, `clarification`;
>   `stream-message` → `thought`, `phase`.
> - **Pipeline phase numbering:** Live decision-maker pipeline is
>   single-provider **4 stages** (parallel contact searches → batch
>   page selection → parallel Firecrawl reads → chunked contact
>   synthesis) in `gemini-provider.ts`. The "Phase 1 / 2a / 2b /
>   Phase 4 accountability" labeling below is inconsistent; Phase 4 is
>   actually a post-pipeline step in `decision-maker.ts`
>   (`decision-maker-accountability.ts`), not part of the provider
>   pipeline.
> - **Agentic delegation is `FEATURES.DELEGATION=false`.** Code exists
>   for Tier 3+ but is gated off; any section implying delegation
>   endpoints resolve at runtime is aspirational.
> - **Correct as-is:** Gemini for agents (not Anthropic/OpenAI), Exa +
>   Firecrawl for search/scrape (no Hunter.io / Clearbit), mDL as sole
>   active identity intake, TEE Planned.

---

## Vision

Every advocacy platform in the market is adding AI as a convenience layer on top of unverified identity. Bonterra Que creates fundraising campaigns autonomously. Quorum Quincy analyzes legislation. AdvocacyAI auto-routes messages using 300M plaintext voter records.

Commons does something structurally different: AI as a **delegation layer** on top of **verified identity**. An agent acts on behalf of a cryptographically verified constituent, within delegated bounds, with auditable reasoning, and with privacy-preserving memory. Every action the agent takes carries the same ZK proof that a manual action carries.

The decision-maker's office doesn't have to trust the agent. They verify the proof.

---

## What Exists (Foundation)

Three production agents with tool-calling loops, grounding verification, streaming reasoning, cost tracking, and safety moderation.

### Subject Line Agent

`src/lib/core/agents/agents/subject-line.ts` (304 lines)

Multi-turn clarification flow. Infers geographic scope, target type, and location confidence. Generates subject line, core message, topics, URL slug, and voice sample (emotional peak from raw input). Supports `location_picker`, `open_text`, and `multiple_choice` clarification types. Rebuilds conversation context across turns via `buildClarificationPrompt()`.

**Endpoint:** `POST /api/agents/stream-subject`
**Rate:** Guest 5/hr, Auth 15/hr, Verified 30/hr

### Decision-Maker Resolution Agent

`src/lib/core/agents/agents/decision-maker.ts` (755 lines)

Three-phase pipeline with parallel mini-agents:
- **Phase 1:** Role discovery — structural reasoning about which positions have power over the issue
- **Phase 2a:** Parallel identity resolution — Exa semantic search + Gemini extraction
- **Phase 2b:** Per-identity contact hunting — N concurrent mini-agents with isolated budgets (`AgenticToolContext` with `maxSearches`/`maxPageReads` per identity)
- **Phase 4:** Accountability classification — generates context openers per decision-maker

Tool-calling loop via `processGeminiFunctionCall()`: `search_web` (Exa, 25 results), `read_page` (Firecrawl headless rendering), `analyze_document` (Reducto PDF parsing).

**Grounding requirement:** All emails must appear verbatim in fetched page content. `extractContactHints()` pre-extracts emails, phones, social URLs from page HTML. Unverified emails filtered before return.

**Progressive reveal:** `identity-found` and `candidate-resolved` events bypass ThoughtEmitter for direct SSE metadata, enabling incremental card rendering as resolution progresses.

**Endpoint:** `POST /api/agents/stream-decision-makers`
**Rate:** Guest BLOCKED, Auth 3/hr, Verified 10/hr

### Message Writer Agent

`src/lib/core/agents/agents/message-writer.ts` (336 lines)

Two-phase citation verification:
- **Phase 1 (Source Discovery):** Gemini with Google Search grounding → candidate URLs → HEAD validation → verified source pool
- **Phase 2 (Message Generation):** Writes using ONLY verified sources. Grounding disabled (sources already validated). Temperature 0.8 for full linguistic range. `[Personal Connection]` placeholders for constituent testimony.

Zero citation hallucination: every URL in output was validated accessible in Phase 1.

**Endpoint:** `POST /api/agents/stream-message`
**Rate:** Guest BLOCKED, Auth 10/hr, Verified 30/hr

### Supporting Infrastructure

| System | Location | Purpose |
|---|---|---|
| ThoughtEmitter | `src/lib/core/thoughts/emitter.ts` | Structured reasoning visualization with progressive disclosure, citations, action traces, Key Moments footer |
| Provider Router | `src/lib/core/agents/providers/router.ts` | Priority-based provider selection with fallback |
| Exa Search | `src/lib/core/agents/exa-search.ts` | Semantic web search ($0.005/search, 25 results, 4 RPS) |
| Firecrawl | `src/lib/core/agents/exa-search.ts` | Headless page rendering for JS-heavy sites (20s timeout) |
| Intelligence Service | `src/lib/server/intelligence/service.ts` | Convex `.vectorIndex(...)` semantic search, topic/entity/embedding storage, 90-day TTL |
| Prompt Guard | Endpoint middleware | Llama Prompt Guard 2 via Groq (threshold 0.7-0.8) |
| Cost Tracking | `CostBreakdown` type | Per-component: Gemini (input/output/thinking), Exa, Firecrawl, Grounding, Groq |
| Gemini Client | `src/lib/core/agents/gemini-client.ts` | Singleton client, gemini-3-flash-preview, exponential backoff, token tracking |

---

## Protocol Integration (voter-protocol)

The agentic layer does not require new protocol infrastructure. voter-protocol was designed for human-submitted proofs, but because it cleanly separates **identity verification** (ZK proofs, nullifiers) from **content** (arguments, messages), it is naturally agent-compatible. The only new protocol concept is **delegation** — formally recording that a constituent authorized an agent to act within bounds.

### The Proof Generation Boundary

ZK proofs generate in the browser via `@voter-protocol/noir-prover` (noir_js + bb.js WASM). The agent cannot generate proofs — it does not possess the private inputs (`user_secret`, `identity_commitment`, `registration_salt`). This enforces a clean separation:

```
AGENT DOMAIN (content + intelligence)       CONSTITUENT DOMAIN (identity + proof)
─────────────────────────────────────       ──────────────────────────────────────
Monitor legislation                         noir-prover: generateThreeTreeProof()
Draft messages (grounding-verified)         Private inputs: user_secret, cell_id,
Resolve decision-makers                       registration_salt, identity_commitment
Write debate arguments                      Merkle paths: userPath, cellMapPath,
Query Shadow Atlas API                        engagementPath
                                            Approve/reject agent actions
                                            Sign/revoke delegation

              ──── combine at submission ────
              Agent content + Constituent proof
              → DistrictGate.verifyThreeTreeProof(proof, publicInputs[0..30], depth)
              → NullifierRegistry.usedNullifiers[nullifier] = true
              → CampaignRegistry.participantCount++
```

The agent produces content. The constituent produces proof. The protocol validates the proof. The protocol does not know or care who authored the content.

### Three-Tree Circuit — What the Agent Sees

The three-tree circuit outputs 31 public inputs. The agent interacts with several:

```
PUBLIC INPUTS (visible to agent and on-chain):
  [0]  userRoot          — Tree 1 root (identity). Agent reads from UserRootRegistry.
  [1]  cellMapRoot       — Tree 2 root (cell mapping). Agent reads from CellMapRegistry.
  [2-25] districts[24]   — 24 district slots. Agent matches against legislation targets.
  [26] nullifier         — H2(identityCommitment, actionDomain). Agent checks NullifierRegistry
                           to avoid double-action before prompting constituent for proof.
  [27] actionDomain      — Template-scoped domain. Agent derives from campaign metadata:
                           keccak256("commons.v1" || country || legislature || template || session) % BN254
  [28] authorityLevel    — mDL verification tier [1-5]. Agent reads from last proof.
  [29] engagementRoot    — Tree 3 root. Agent reads from EngagementRootRegistry.
  [30] engagementTier    — Engagement tier [0-4]. Agent uses for delegation authority ceiling.

PRIVATE INPUTS (never visible to agent):
  user_secret, cell_id, registration_salt, identity_commitment
  All Merkle paths and indices
  action_count, diversity_score (raw engagement data)
```

### Shadow Atlas — Agent Query Patterns

The agent queries Shadow Atlas for district matching, not at the identity level:

```
LEGISLATIVE MONITORING (per-constituent, no ZK needed):
  Constituent's districts resolved from postal code or prior proof
  → Shadow Atlas /v1/lookup?lat=X&lng=Y (from geocoded postal code)
  → Returns: DistrictBoundary[] across all 24 BoundaryType slots
  → Agent matches: "Bill SB-1234 affects your state legislative district (CA sldl-22)"
  → Alert delivered to constituent via in-app notification or email digest

DECISION-MAKER RESOLUTION (per-campaign):
  → Shadow Atlas /v1/officials?district=CA-12
  → Returns: { name, title, party, phone, website } from officials.db
  → Agent enriches: decision-maker resolution pipeline adds email, staff, committees
  → Enrichment feeds back to shared intelligence cache

PROOF GENERATION (per-action, constituent-initiated):
  → Shadow Atlas /v1/cell-proof?cell_id=GEOID
  → Returns: { merkleProof: { path: Field[], bits: u1[] } } for Tree 2
  → Constituent's browser uses this as witness for noir circuit
  → Agent never touches this — it's constituent-side only
```

The `DistrictLookupService` uses R-tree spatial indexing (<50ms p95). The `BoundaryType` enum maps 50+ classifications to 24 circuit slots (`boundary.ts`). The agent operates on the org-level postal code → district resolution, not on the ZK layer.

### DebateMarket — Agent Participation Flow

The existing `DebateMarket.sol` (81KB, 193 tests) already supports everything an agent needs:

```
EXISTING CONTRACT INTERFACE:
  Argument {
    stance: SUPPORT | OPPOSE | AMEND
    bodyHash: bytes32              // keccak256(argument_text)
    stakeAmount: uint256
    engagementTier: uint8          // from proof publicInputs[30]
    weightedScore: uint256         // sqrt(stake) * 2^tier
  }

  // Commit-reveal batching (epoch = one Scroll block, ~3s)
  commitBatch(commitHash) → revealBatch(arguments[]) → executeBatch()

AGENT FLOW:
  1. Constituent configures: position (SUPPORT/OPPOSE/AMEND), stake limit, style
  2. Agent writes argument via two-phase message writer (grounding-verified citations)
  3. Agent computes: bodyHash = keccak256(argument_text)
  4. Agent checks: NullifierRegistry — has constituent already acted on this actionDomain?
  5. If not: constituent generates three-tree proof in browser (includes engagementTier)
  6. Agent submits via relayer: proof + publicInputs + Argument to DebateMarket
  7. Contract verifies proof via DistrictGate.verifyThreeTreeProof()
  8. Contract computes: weightedScore = sqrt(stakeAmount) * 2^engagementTier
  9. NullifierRegistry records nullifier (prevents double-participation)
  10. AI evaluator panel scores argument → EIP-712 attestation → on-chain resolution

ANTI-PLUTOCRATIC WEIGHTING (already implemented):
  Active   (tier 1, $100 stake): √100 × 2¹ = 20.0
  Pillar   (tier 4, $2 stake):   √2 × 2⁴  = 22.6
  → Engagement outweighs capital. Works identically for agent-submitted arguments.
```

The relayer submission in step 6 breaks the wallet-to-position link (existing privacy pattern). Phase 2 `debate_weight` and `position_note` circuits will add full position privacy.

### On-Chain Enforcement — What Already Works for Agents

| Mechanism | Contract | How It Works for Agents |
|---|---|---|
| **One-action-per-identity** | `NullifierRegistry` | `H2(identityCommitment, actionDomain)` is unique per identity per action domain. Agent submission uses same nullifier as manual — contract doesn't distinguish. |
| **Rate limiting** | `NullifierRegistry` | 60-second cooldown between actions per user. Applies regardless of submission source. |
| **Tier verification** | `DistrictGate` | `publicInputs[30]` = engagement tier. Contract reads it directly from proof. Agent cannot forge — it's a circuit output. |
| **District verification** | `DistrictGate` | `publicInputs[2-25]` = 24 district hashes. Each is `Poseidon(country, region, type, id, geometry, authority)`. Agent cannot target districts the constituent isn't in. |
| **Anti-astroturf** | `CampaignRegistry` | GDS = `districtCount / participantCount`. Computed from on-chain events. Agent-submitted actions produce identical events. If 500 agents submit identical arguments, ALD drops, entropy flags burst. |
| **LMSR pricing** | `DebateMarket` | `C(q) = b × ln(Σ exp(q_i / b))`. Market pricing is structural. Agent-submitted stakes move the market identically. |
| **AI evaluation** | `AIEvaluationRegistry` | 5-model median aggregation. EIP-712 attestation. Scores agent arguments identically to human ones — evaluator sees bodyHash content, not submission source. |

### Protocol Gaps (Only Two)

**Gap 1: Delegation Contract**

A new contract that records agent delegations. Small — the primitives exist:

```solidity
// contracts/src/AgentDelegation.sol (conceptual)

struct Delegation {
    bytes32 identityCommitmentHash;  // H(identityCommitment) — not the commitment itself
    uint8 maxTier;                    // authority ceiling (from last proof)
    bytes32[] allowedActionDomains;   // scoped to specific campaigns
    uint256 createdAt;
    uint256 expiresAt;                // optional
    bool revoked;
}

mapping(bytes32 => Delegation) public delegations;

function createDelegation(
    bytes calldata proof,
    bytes32[31] calldata publicInputs,
    uint8 verifierDepth,
    bytes32[] calldata allowedDomains,
    uint256 expiresAt
) external {
    // Verify three-tree proof to confirm identity and tier
    require(districtGate.verifyThreeTreeProof(proof, publicInputs, verifierDepth));
    uint8 tier = uint8(uint256(publicInputs[30]));
    bytes32 idHash = keccak256(abi.encodePacked(publicInputs[26])); // hash of nullifier base
    delegations[idHash] = Delegation(idHash, tier, allowedDomains, block.timestamp, expiresAt, false);
}

function revokeDelegation(bytes32 idHash) external {
    delegations[idHash].revoked = true;
}

function verifyDelegation(bytes32 idHash, bytes32 actionDomain, uint8 requiredTier) external view returns (bool) {
    Delegation memory d = delegations[idHash];
    return !d.revoked
        && (d.expiresAt == 0 || d.expiresAt > block.timestamp)
        && d.maxTier >= requiredTier
        && _containsDomain(d.allowedActionDomains, actionDomain);
}
```

Estimated scope: ~200 lines of Solidity + tests. Follows the same patterns as existing registries (`UserRootRegistry`, `EngagementRootRegistry`).

**Gap 2: Legislation Feed Ingestion**

Shadow Atlas currently serves static district boundaries. Legislative monitoring needs a feed ingestion service:

```typescript
// packages/shadow-atlas/src/serving/legislation-service.ts (conceptual)

interface LegislationItem {
  id: string;                    // e.g., "US-CA-SB1234-2026"
  source: 'congress_gov' | 'legiscan' | 'municipal_scrape';
  title: string;
  summary: string;
  status: 'introduced' | 'committee' | 'floor' | 'passed' | 'signed';
  affectedDistricts: {
    boundaryType: BoundaryType;  // existing enum (50+ types → 24 slots)
    jurisdiction: string;        // e.g., "CA", "CA-12"
  }[];
  introducedAt: Date;
  lastActionAt: Date;
}

class LegislationService {
  // Ingest from feeds (scheduled)
  async ingestFederal(): Promise<LegislationItem[]>;     // Congress.gov API (free)
  async ingestState(state: string): Promise<LegislationItem[]>;  // LegiScan Pull API
  async ingestLocal(url: string): Promise<LegislationItem[]>;   // Firecrawl scrape

  // Query by district (used by org monitors)
  async findByDistrict(
    boundaryType: BoundaryType,
    jurisdiction: string,
    since?: Date
  ): Promise<LegislationItem[]>;

  // Match against org topics (Gemini screening)
  async screenRelevance(
    items: LegislationItem[],
    topics: string[]
  ): Promise<{ item: LegislationItem; score: number }[]>;
}
```

This uses existing `BoundaryType` for district matching. Could live in Shadow Atlas or in the commons app — either way, it queries Shadow Atlas's district data for geographic matching.

---

## What Needs Building

### 1. Continuous Legislative Intelligence

**What it is:** A constituent-level agent that monitors legislation, regulatory actions, and public meetings across every district type where the constituent lives — school board agendas, water district rate hearings, transit authority proposals, city council ordinances. The constituent delegates monitoring authority and configures interest areas. Org campaigns are one activation path, but the agent independently surfaces relevant legislation based on the constituent's configured interests, even when no org has created a campaign around it.

**Why this transcends:** Quorum charges $10K+/year for AI bill tracking at federal and state level only. Commons monitors across all 24 district types. The constituent's agent watches their districts. The infrastructure screens efficiently through shared scanning — bills are screened once per topic cluster, not per person.

**Architecture:**

```
src/lib/core/agents/agents/legislative-monitor.ts

CONSTITUENT LAYER (per-person):
  delegation.topics[]                   // constituent's configured interests
  delegation.districtTypes[]            // which of 24 boundary types to monitor
  constituent.districts                 // from ZK proof or postal code resolution
                                        // e.g., { cd: CA-12, sldl: CA-22, school: SFUSD, ... }

SHARED SCANNING LAYER (infrastructure):
  Legislation screened once per topic cluster, shared across all constituents
  with similar interests. 200 climate-focused constituents don't each trigger
  independent scans — they share a single screening pass.

PIPELINE:
  1. Shared legislation ingestion (daily, infrastructure-level)
     ├── Federal: Congress.gov API (free, 5K req/hr)
     ├── State: LegiScan Pull API (per-state annual)
     ├── Local: Municipal agenda scraping (Firecrawl, 1 credit/page)
     ├── School: Board meeting agendas (Firecrawl)
     └── Special: Water/fire/transit board notices (Firecrawl)

  2. Topic-clustered relevance screening (Gemini Flash Lite — classification)
     ├── Input: legislation text + topic cluster
     ├── Output: relevance score [0-1]
     ├── Threshold: configurable per constituent (default 0.7)
     └── Shared: constituents with similar topics share screening results

  3. Per-constituent district matching (Shadow Atlas, no ZK needed)
     ├── Bill targets: which BoundaryType slots + jurisdictions?
     ├── Match against: constituent's districts (from delegation)
     ├── Uses: DistrictLookupService.lookupAll() — R-tree index, <50ms
     └── Result: "SB-1234 affects your state legislative district (CA sldl-22)"

  4. Alert generation (Gemini Flash — generation)
     ├── Summary: plain-language explanation of the bill
     ├── Decision-maker: pre-resolved via existing agent (or from intelligence cache)
     ├── Draft response: pre-written via existing message writer, personalized
     │   from constituent's encrypted civic memory (positions, style)
     └── Action link: constituent clicks → enters verified letter flow

  5. Delivery
     ├── In-app notification (primary)
     ├── Email digest (configurable frequency)
     └── Org campaigns: when an org creates a campaign on the same legislation,
         the constituent's agent surfaces the org's campaign alongside its own alert

ORG INTEGRATION:
  Orgs don't run the monitor — constituents' agents do. But orgs benefit:
  ├── Org creates campaign on SB-1234
  ├── Constituent agents already tracking SB-1234 surface the org's campaign
  ├── Pre-informed constituents take higher-quality verified action
  └── Org dashboard: "312 supporters' agents were already monitoring this bill"
```

**Key point:** The monitor serves the constituent, not the org. The ZK layer activates only when the constituent takes action — clicking through to send a verified letter. Monitoring uses postal codes and Shadow Atlas lookups (no identity layer needed). The shared scanning infrastructure keeps costs manageable: bills are screened once per topic cluster, not per person. At 10K constituents across ~50 topic clusters, scanning cost divides by ~200x vs naive per-person inference.

### 2. Graduated Agent Authority

**What it is:** Agent capabilities tied to engagement tiers. The same tier architecture (New → Active → Established → Veteran → Pillar) that governs debate market participation and proof weight now governs what an agent can do on a constituent's behalf.

**Architecture:**

```typescript
// src/lib/core/agents/delegation.ts

interface AgentDelegation {
  /** Identity commitment of the delegating constituent */
  identityCommitment: bigint;

  /** Current engagement tier (determines authority ceiling) */
  tier: EngagementTier;

  /** Constituent-configured permissions (cannot exceed tier ceiling) */
  permissions: AgentPermissions;

  /** Delegation created timestamp */
  createdAt: number;

  /** Optional expiry (constituent can set) */
  expiresAt?: number;

  /** Revocation: constituent can revoke at any time */
  revoked: boolean;
}

interface AgentPermissions {
  /** Can the agent monitor legislation? (tier >= New) */
  monitor: boolean;

  /** Can the agent draft messages? (tier >= Active) */
  draft: boolean;

  /** Can the agent send messages after explicit approval? (tier >= Established) */
  sendWithApproval: boolean;

  /** Can the agent participate in debate markets? (tier >= Veteran) */
  debateParticipation: boolean;

  /** Can the agent send without per-message approval? (tier >= Pillar) */
  sendAutonomous: boolean;

  /** District types the agent can act in (constituent-configured) */
  allowedDistrictTypes: BoundaryType[];

  /** Topic restrictions (optional) */
  topicAllowlist?: string[];
}
```

**Tier authority ceilings:**

| Tier | Monitor | Draft | Send (approved) | Debate | Send (autonomous) |
|---|---|---|---|---|---|
| New (0) | Yes | No | No | No | No |
| Active (1) | Yes | Yes | No | No | No |
| Established (2) | Yes | Yes | Yes | No | No |
| Veteran (3) | Yes | Yes | Yes | Yes | No |
| Pillar (4) | Yes | Yes | Yes | Yes | Yes (with bounds) |

**Enforcement:** The delegation is checked at the API endpoint layer before any agent action executes. The `AgentDelegation` is stored locally (encrypted to the constituent's identity commitment). The on-chain nullifier system prevents an agent from submitting actions that exceed its delegation tier — the smart contract validates the engagement tier proof before accepting the action.

**Revocation:** Instant. Constituent revokes delegation → all pending agent actions are canceled → agent memory becomes inaccessible (encrypted to revoked commitment). No grace period.

### 3. Privacy-Preserving Civic Memory

**What it is:** An agent memory system where the constituent's policy positions, legislative priorities, engagement patterns, and communication preferences are encrypted to their identity commitment. The agent can use this memory for personalization without the platform being able to read it.

**Architecture:**

```
MEMORY STRUCTURE (per constituent):

  positions/
    ├── climate-policy.enc        // Encrypted position statement
    ├── education-funding.enc     // Encrypted position statement
    └── housing-development.enc   // Encrypted position statement

  history/
    ├── actions.enc               // Past actions (letters sent, debates joined)
    ├── decision-makers.enc       // Previously resolved contacts (cached)
    └── legislation-tracked.enc   // Bills/ordinances being monitored

  preferences/
    ├── communication-style.enc   // Tone, formality, length preferences
    ├── notification-frequency.enc
    └── district-priorities.enc   // Which of 24 district types to monitor

ENCRYPTION:
  Key = derived from identity commitment + constituent passphrase
  Algorithm = XChaCha20-Poly1305 (from @noble/ciphers, already in deps)
  Storage = IndexedDB (client-side) + optional encrypted backup (R2)

AGENT ACCESS:
  Agent receives decrypted memory only during active session
  Memory decrypted client-side, passed to agent via secure context
  Platform server never sees plaintext memory
  If constituent revokes delegation, memory key is rotated
```

**What this means:** If Commons is subpoenaed for a constituent's policy positions, the response is ciphertext. The platform genuinely cannot comply because it does not possess the decryption key. This is the same privacy architecture as ZK proofs applied to agent memory.

**Difference from every competitor:** AdvocacyAI stores positions in a 300M-record plaintext voter file. Quorum stores policy preferences in a CRM. Bonterra Que stores fundraising history in a donor database. All fully subpoena-able. Commons stores encrypted blobs that only the constituent can unlock.

### 4. Agent-Mediated Deliberation

**What it is:** Verified constituents can instruct their agent to participate in debate markets on their behalf. The agent stakes positions, writes structured arguments, and responds to counterarguments — all carrying the same ZK proof and engagement tier weight as manual participation.

**Architecture:**

```
FLOW:

  1. Constituent configures debate delegation
     ├── Position: SUPPORT / OPPOSE / AMEND
     ├── Reasoning: constituent's own position statement (from memory)
     ├── Stake limit: maximum the agent can risk ($1-$50)
     ├── Argument style: formal / conversational / data-driven
     └── Auto-respond: whether agent can respond to counterarguments

  2. Agent enters debate market
     ├── Stakes position using existing DebateMarket contract
     ├── ZK proof attached (same as manual participation)
     ├── Engagement tier weight applied (same anti-plutocratic formula)
     └── Nullifier prevents duplicate participation (same as manual)

  3. Agent writes structured arguments
     ├── Uses two-phase message writer (grounding-verified citations)
     ├── Draws on constituent's encrypted position statement
     ├── Sources validated against web (no hallucinated evidence)
     └── Argument submitted to AI evaluator panel (same 5-model scoring)

  4. Integrity guarantees
     ├── Every agent participant bound to unique identity commitment
     ├── Cannot spin up multiple agents (nullifier enforcement)
     ├── GDS/ALD/temporal entropy apply to agent-generated content
     ├── AI evaluator scores agent arguments identically to human ones
     └── Coordination integrity detects agent swarm patterns
```

**Key insight:** The debate market's anti-astroturf system doesn't need to distinguish human from agent content. It detects coordination patterns regardless of source. If 500 agents submit identical arguments, the ALD (Author Linkage Diversity) score drops, the GDS (Geographic Diversity Score) flags clustering, and the temporal entropy detects burst injection. The structural observability works on actions, not on who typed them.

### 5. Decision-Maker Intelligence Network

**What it is:** The decision-maker resolution agent already resolves contacts for any public official. Extending this into a persistent, shared intelligence layer where resolutions from any constituent's agent enrich the network for everyone.

**Architecture:**

```
EXISTING:
  Resolution happens per-request
  14-day cache per decision-maker
  Each resolution costs: Exa searches + Firecrawl reads + Gemini calls

EXTENSION:
  src/lib/server/intelligence/decision-maker-network.ts

  SHARED CACHE (Convex table + .vectorIndex):
    decisionMakers table:
      _id, name, title, organization
      email (verified), emailSource, emailVerifiedAt
      phone, socialUrls
      districts[]              // which districts this person has authority over
      committeeAssignments[]
      policyPositions[]        // extracted from public statements
      lastVerified: number
      verificationCount: number  // how many independent resolutions confirmed this

  ENRICHMENT PIPELINE:
    1. When any constituent's agent resolves a decision-maker:
       ├── Check shared cache (if fresh + high verification_count → skip resolution)
       ├── If stale or missing → full resolution pipeline
       ├── Compare result against cached data
       └── If confirmed → increment verification_count
           If changed → update + reset verification_count

    2. Confidence scoring:
       ├── verification_count >= 3 → high confidence
       ├── last_verified within 30 days → fresh
       └── Stale entries trigger re-verification on next access

    3. Privacy boundary:
       ├── Shared cache contains ONLY public officials (not constituents)
       ├── No tracking of which constituent triggered which resolution
       └── Resolution logs aggregated (count only, no identity linkage)
```

**What this means:** The first constituent to contact their school board member pays the full resolution cost (3-5 Exa searches, 2-3 Firecrawl reads). The next 10,000 constituents in that district get instant resolution from cache. The network learns the power structure collectively while no individual's usage pattern is recorded.

**Contrast with AdvocacyAI:** They have 300M voter records (constituent surveillance data purchased from data brokers). We have a collectively-built map of public officials (decision-maker intelligence crowdsourced from verified constituent interactions). They surveil the people. We map the power.

### 6. MCP Civic Servers

**What it is:** The existing agents exposed as MCP servers, making verified civic action available to any MCP-compatible client — Claude, ChatGPT, custom agents, IDE integrations.

**Architecture:**

```
packages/mcp-civic/
├── servers/
│   ├── resolve-decision-maker.ts    // Wraps existing resolution agent
│   ├── draft-verified-letter.ts     // Wraps existing message writer
│   ├── check-district-membership.ts // Wraps Shadow Atlas lookup
│   ├── submit-verified-action.ts    // Submit action with ZK proof
│   ├── monitor-legislation.ts       // Legislative intelligence queries
│   └── browse-debate-markets.ts     // Read debate market state
├── auth/
│   ├── identity-verification.ts     // MCP auth bound to identity commitment
│   └── delegation-check.ts          // Verify agent has delegation authority
└── types/
    └── civic-tools.ts               // MCP tool definitions
```

**MCP Tool Definitions:**

```typescript
// resolve-decision-maker
{
  name: "resolve_decision_maker",
  description: "Find and verify contact information for public officials who have authority over a civic issue",
  inputSchema: {
    type: "object",
    properties: {
      issue: { type: "string", description: "The civic issue" },
      geographic_scope: {
        type: "object",
        properties: {
          country: { type: "string" },
          state: { type: "string" },
          locality: { type: "string" },
          district_type: { type: "string", enum: [...BoundaryTypes] }
        }
      }
    },
    required: ["issue"]
  }
}

// draft-verified-letter
{
  name: "draft_verified_letter",
  description: "Draft a letter to a decision-maker with grounding-verified citations. Returns draft for constituent approval.",
  inputSchema: {
    type: "object",
    properties: {
      decision_maker: { type: "object", description: "Resolved decision-maker" },
      position: { type: "string", description: "Constituent's position" },
      style: { type: "string", enum: ["formal", "conversational", "data-driven"] }
    },
    required: ["decision_maker", "position"]
  }
}

// submit-verified-action
{
  name: "submit_verified_action",
  description: "Submit a civic action with ZK proof of district membership. Requires constituent approval.",
  inputSchema: {
    type: "object",
    properties: {
      action_type: { type: "string", enum: ["letter", "debate_position"] },
      content: { type: "string" },
      decision_maker_id: { type: "string" },
      district_proof: { type: "string", description: "ZK proof of district membership" }
    },
    required: ["action_type", "content", "district_proof"]
  }
}
```

**Auth model:** MCP requests must carry a delegation token bound to the constituent's identity commitment. The server verifies: (1) delegation exists and is not revoked, (2) engagement tier permits the requested action, (3) district membership covers the target jurisdiction. Without valid delegation, the server returns tools as read-only (legislation monitoring, debate market browsing — no action submission).

**What this enables:** A constituent using any AI assistant can say "write my school board about the bond measure" and the assistant invokes Commons MCP servers to resolve the board members, draft a grounded message, and (with approval) submit it with a ZK proof. The civic infrastructure is not locked behind our UI.

MCP has 97M+ monthly SDK downloads. Building on it means Commons civic capabilities are accessible to the entire agent ecosystem from day one.

### 7. Democratic Guardrails

**What it is:** A guardrail layer specific to civic action. Current safety frameworks (LlamaFirewall, etc.) prevent prompt injection and code exploits. They don't address democratic threats.

**Guardrails:**

| Guardrail | Mechanism | Enforcement Layer |
|---|---|---|
| **One-person-one-agent** | Nullifier-bound delegation | Smart contract (on-chain) |
| **Anti-astroturf on agent content** | GDS/ALD/temporal entropy on all actions regardless of source | Coordination integrity system |
| **Tier authority ceiling** | Agent cannot exceed delegating constituent's engagement tier | API endpoint + smart contract |
| **District scope enforcement** | Agent cannot target decision-makers outside constituent's verified districts | Shadow Atlas membership check |
| **Rate limiting per identity** | Rate limits bound to identity commitment, not API key | Endpoint middleware |
| **Coercion resistance** | Agent cannot be instructed to impersonate or amplify beyond one voice | Nullifier uniqueness |
| **Revocation propagation** | Delegation revocation cancels all pending agent actions immediately | Client-side + contract |
| **Reasoning audit trail** | ThoughtEmitter traces preserved for every agent action | Intelligence service |

**Key architectural decision:** Democratic guardrails are enforced at the **protocol layer** (smart contracts, nullifiers, district proofs), not at the **application layer** (prompt engineering, output filters). This means they cannot be bypassed by a malicious client, a modified agent, or a compromised MCP server. The math doesn't care about the client.

### 8. Verifiable Agent Reasoning (Future)

**What it is:** ZKML proofs that an agent's scoring or evaluation was computed correctly. The AI evaluator already uses a 5-model panel with median aggregation. The extension: proving the computation was faithful.

**Current state of the field:** ZKML is approaching production viability for simple models (sub-second proving in 2026). Complex transformer inference is not yet provable in real-time. This is a research track, not a near-term build.

**When it becomes viable:**

```
PIPELINE:
  1. AI evaluator scores a debate position
  2. Score committed on-chain (already happens)
  3. ZK proof generated attesting:
     ├── The specified model was used
     ├── The specified inputs were provided
     ├── The computation was correct
     └── No post-hoc modification occurred
  4. Any constituent can verify the proof

BENEFIT:
  A constituent who disagrees with an AI evaluation
  can verify the computation, not just appeal to a human.
```

**Dependency:** ZKML proving infrastructure maturity. Monitor: EZKL, Modulus Labs, Giza. When proving time for a median-of-5 scoring operation drops below 30 seconds, this becomes buildable.

---

## Competitive Positioning (March 2026)

| Capability | AN | Quorum | Bonterra Que | AdvocacyAI | **Commons** |
|---|---|---|---|---|---|
| AI content generation | No | Drafts | Emails/forms | Ads/pages | **Grounding-verified** |
| AI legislative analysis | No | Federal+state ($10K+) | No | No | **All 24 district types (free)** |
| Agentic workflows | No | No | Fundraising | No | **Verified delegation** |
| Agent identity | No | No | No | No | **ZK-bound to mDL** |
| Agent reasoning proofs | No | No | No | No | **ZKML (future)** |
| Privacy-preserving memory | No | No | No | No | **Encrypted to identity** |
| Democratic guardrails | No | No | No | No | **Nullifier-enforced** |
| MCP civic infrastructure | No | No | No | No | **MCP servers** |
| Anti-astroturf on AI | No | No | No | No | **GDS/ALD/entropy** |
| Voter/constituent data | No | District mapping | 20M supporters | 300M voter records | **Zero PII (ZK proofs)** |

---

## Build Priority

| Priority | Component | Depends On | Estimated Scope |
|---|---|---|---|
| **P0** | Graduated agent authority (delegation model) | Engagement tiers | Types + enforcement middleware |
| **P0** | Privacy-preserving civic memory | Identity commitment, IndexedDB | Client-side encryption layer |
| **P1** | Legislative intelligence (federal + state) | Delegation model, message writer | Monitor agent + scheduling |
| **P1** | Decision-maker intelligence network | Existing resolution agent | Shared cache + enrichment pipeline |
| **P2** | Legislative intelligence (local + special districts) | Municipal agenda scraping | Firecrawl pipeline per district type |
| **P2** | Agent-mediated deliberation | Delegation model, debate markets | Debate market agent integration |
| **P2** | MCP civic servers | All above agents stabilized | MCP server wrappers + auth |
| **P3** | Verifiable agent reasoning (ZKML) | ZKML infrastructure maturity | Research track |

---

## Cost Structure (March 2026 Pricing)

### Per-Action Cost Breakdown

A single "verified letter" flow involves the full agent pipeline: subject line → decision-maker resolution → message generation → ZK proof → on-chain submission.

| Component | Service | Unit Cost | Per Letter |
|---|---|---|---|
| **Subject line generation** | Gemini 3 Flash (~2K in / ~1K out) | $0.50/$3.00 per 1M tokens | ~$0.004 |
| **Decision-maker resolution** | Gemini 3 Flash (~8K in / ~4K out) | $0.50/$3.00 per 1M tokens | ~$0.016 |
| | Exa search (2-3 searches) | $7.00 per 1K searches | ~$0.018 |
| | Firecrawl page reads (2-3 pages) | ~$0.83 per 1K credits (Standard) | ~$0.002 |
| **Message generation** | Gemini 3 Flash Phase 1 (~4K in / ~2K out) | $0.50/$3.00 per 1M tokens | ~$0.008 |
| | Gemini 3 Flash Phase 2 (~6K in / ~3K out) | $0.50/$3.00 per 1M tokens | ~$0.012 |
| **Prompt injection check** | Groq Llama 3.1 8B (~500 tokens) | $0.05/$0.08 per 1M tokens | ~$0.00004 |
| **ZK proof** | Browser-side (noir_js + bb.js) | $0 | $0 |
| **On-chain submission** | Scroll L2 | ~$0.01 per action | $0.01 |
| **Email delivery** | Amazon SES | $0.10 per 1K | $0.0001 |
| **Total per letter** | | | **~$0.07** |

**Cached resolution:** When the decision-maker is already in the shared intelligence network cache, the resolution step drops to near-zero (no Exa/Firecrawl calls). For a well-populated district, per-letter cost drops to **~$0.035**.

### Legislative Monitor Cost

The monitor runs per-constituent conceptually, but the scanning infrastructure is shared. Legislation is screened once per topic cluster — constituents with similar interests share results. District matching is per-constituent (Shadow Atlas lookups, <50ms). Alert delivery is email/notification cost ($0.0001/email), not inference.

| Component | Service | Cost |
|---|---|---|
| **Federal legislation** | Congress.gov API | Free (5K req/hr, public) |
| **State legislation (50 states)** | LegiScan Pull API | ~$2,000-5,000/year (per-state annual, volume discounts) |
| **Local agenda scraping** | Firecrawl Standard (100K credits/mo) | $83/month |
| **Relevance matching** | Gemini 3 Flash (~1K tokens per bill) | ~$0.004 per bill screened |
| **Alert generation** | Gemini 3 Flash (~2K in / ~1K out per alert) | ~$0.005 per alert |
| **Alert fan-out** | SES (email to affected supporters) | $0.10/1K emails |

**Per topic cluster estimate (daily scan):**

| Scenario | Bills screened/day | Alerts generated/day | Monthly cost (inference) |
|---|---|---|---|
| **Federal + state** | ~20 | ~1-2 | ~$3.00 |
| **+ county + municipal** | ~40 | ~3-5 | ~$6.50 |
| **All district types** | ~80 | ~5-10 | ~$13.00 |

At 10K constituents across ~50 topic clusters with average monitoring: **~$6,500/month** in screening inference. Per-constituent district matching and alert delivery is negligible (Shadow Atlas lookups + SES email).

### Infrastructure Cost (Agentic Layer Only)

Added to the existing platform COGS from `strategy/economics.md`:

| Component | Service | Monthly (10K constituents) |
|---|---|---|
| Gemini API (all agents) | Google AI | $2,000 |
| Exa search | Exa AI | $800 |
| Firecrawl | Firecrawl Standard | $83 |
| LegiScan | LegiScan Pull API | $300 |
| Legislative monitor inference | Gemini (screening + alerts) | $6,500 |
| Groq (moderation) | Groq | $10 |
| Intelligence DB (Convex `.vectorIndex`) | Convex (shared) | $0 (included in existing backend) |
| Scheduled compute (monitors) | Convex scheduled actions | $0 (included) |
| **Agentic COGS** | | **~$9,800** |

### Combined Platform COGS (10K constituents / ~1K orgs)

| Layer | Monthly |
|---|---|
| Existing platform (email, DB, storage, chain) | $7,000 |
| Agentic infrastructure | $9,700 |
| **Total COGS** | **~$16,700** |
| **Revenue** (from economics.md) | **$60,500** |
| **Gross margin** | **72%** |

The agentic layer adds ~$9,700/month at 10K constituents, dominated by legislative monitor inference ($6,500 — screening bills across all district types, shared per topic cluster). Margin drops from 87% to 72%.

### Cost Levers

1. **Model tiering.** Screening (is this bill relevant to this org's topics?) is a classification task suited for Gemini 3.1 Flash Lite ($0.25/$1.50 per 1M tokens — 50% cheaper than Flash). Reserve Flash for alert generation and message drafting. This alone cuts monitor inference ~40%.

2. **Shared screening.** 200 constituents interested in climate policy don't each need to screen the same climate bill independently. Topic-clustered constituents share a single screening pass. At 10K constituents with ~50 topic clusters, screening cost divides by ~200x vs naive per-person inference.

3. **Inference cost trajectory.** LLM pricing has dropped ~50% annually. Gemini 3 Flash is already 60% cheaper than Gemini 2.5 Flash was at launch. At current trajectory, the $6,500 monitor line becomes ~$3,200 in 12 months without any architectural optimization.

4. **Delegation tier gating.** Legislative monitoring requires Active tier (1) or above — the constituent must have demonstrated engagement before delegating monitoring authority. This naturally limits the monitoring population to engaged constituents, not every signup.

**With model tiering + shared screening (near-term optimizations):**

| Layer | Monthly |
|---|---|
| Existing platform | $7,000 |
| Agentic (optimized) | $4,500 |
| **Total COGS** | **~$11,500** |
| **Gross margin** | **81%** |

The per-person model scales better than per-org: as constituents cluster around similar topics and districts, shared screening amortizes costs. Each additional constituent in an existing topic cluster adds only district-matching cost (~$0), not screening cost.

---

## Design Constraints

1. **Agent actions are indistinguishable from manual actions on-chain.** The smart contract does not know or care whether an action was submitted by a human clicking a button or an agent executing a delegation. It validates the ZK proof, checks the nullifier, and records the action. This is by design — the verification is of the constituent's identity and district membership, not their input method.

2. **No agent action without delegation.** Even read-only monitoring requires an active, non-revoked delegation. There is no "background agent" that runs without the constituent's knowledge.

3. **Delegation is not identity.** The agent's delegation token proves "a verified constituent authorized this agent to act within these bounds." It does not reveal which constituent. The delegation is bound to the identity commitment (a hash), not to a name or address.

4. **Memory is the constituent's, not the platform's.** Agent memory is encrypted client-side. The platform stores ciphertext. If the constituent switches devices, they bring their passphrase. If they delete their account, the memory is irrecoverable. This is a feature, not a bug.

5. **Democratic guardrails are protocol-level.** They cannot be bypassed by prompt engineering, client modification, or MCP server compromise. The smart contract enforces tier ceilings and nullifier uniqueness regardless of how the action was submitted.
