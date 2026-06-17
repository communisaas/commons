# Capability Transcendence

> How Commons goes beyond what each platform — or the union of all of them — currently provides.
>
> **Date:** 2026-05-27
> **Status:** Strategy framing. Substrate is largely shipped; full transcendence requires closing the seven Phase 3 surfaces enumerated below.

## The framing

Feature-by-feature comparison hits a ceiling fast. Even the union of every incumbent — Action Network's list management + Quorum's legislative intelligence + Bonterra's CRM + Engaging Networks' multi-country routing + Civitech's officeholder database + Empower's friend-network organizing + ActBlue's fundraising rails + Hustle's P2P texting + Resistbot's citizen-direct multi-channel — produces "more efficient unverified noise" and nothing more. The 18M-of-22M-fake comments at the 2017 FCC net neutrality docket happened because no participant in the union could verify the action. The 92% of staffers who say individualized communication has "a lot of positive influence" (CMF 2017) keep receiving an undifferentiated flood because no platform's substrate distinguishes authentic constituent contact from manufactured volume.

The transcendent move is not "more features." It is composing **capabilities** the union cannot. Verification is one capability among several. The others — reach, agentic systems, composability, quality signaling, accountability, coordination integrity, reader-side UX, data sovereignty — each goes beyond what any incumbent offers individually. Composed, they constitute a different category of civic action infrastructure.

This doc is the strategy framing. It does not describe what Commons could become if it built another suite of features. It describes how the capabilities Commons already has and is finishing compose into something the landscape cannot reach by any combination of its existing tools.

## The ceiling of the union

If you sat a congressional staffer in front of the most credentialed bundle the market can assemble in 2026, here's what arrives in their inbox over a single week:

- A campaign from a list-first platform with N signatures, no identity verification, district from self-reported ZIP through Cicero (~$0.03/lookup), authorship indistinguishable from form mail; Action Network, EveryAction/NGP VAN, NationBuilder, Mailchimp, Salsa Engage, Mobilize, ActBlue, Engaging Networks, CiviCRM, and Salesforce/Nonprofit Cloud exports are dialects of this import problem, not the product frame.
- A grassroots message from Quorum with one of 300 AI-generated subject-line variants designed to defeat the dedup filter, sender identity unverifiable.
- A VoterVoice email with SmartCheck-tuned ChatGPT subject line, sender enrolled in some org's list at some point, no proof of constituency.
- A patch-through call from Capitol Canary, caller's district unverified before the dial.
- A Resistbot SMS or fax composed by AI co-author for a sender Resistbot itself has no way to verify.
- An Engaging Networks-routed email that might come from US, UK, or AU — provenance opaque.
- A coalition message from a Bonterra org that was structurally prohibited from working with conservative groups (Senate Commerce 2024 investigation, primary-source documented).

Each carries the residue of the platform that produced it: petition iframes, CRM enrollment funnels, VoterVoice's templating. None carries the residue of the constituent. The Fireside21 inbox (FiscalNote, ~150 House office installs) groups identical subject lines and the rest decays to noise; the IQ/Leidos IQ inbox (~65% of Congress) does the same.

This is what the *entire union* delivers — not a single platform, not a single product gap. The whole landscape's collective output to a congressional office.

What the union cannot reach, no matter how many tools are bundled:

1. **Identity verification of the action.** Requires ZK circuits, mDL parsing, browser-side proving, on-chain registries. Cannot be retrofitted to app-layer competitors.
2. **24 boundary types per location.** Requires owning the district layer. Quorum Local covers cities ≥3K population + ~75K official profiles; Cicero ~400 cities; FiscalNote Curate 16K entities; none of them cover the 39,555 special districts (water/fire/transit/library/hospital/judicial/etc.) governing 84K elected officials.
3. **Protocol-level identity portability.** Requires a shared on-chain identity commitment. App-layer platforms cannot compose at the data layer — each customer is per-vendor.
4. **Cryptographically-bound agentic action.** Requires the verification substrate as the agent's authority. Quincy/Que/SmartCheck/Agentforce all ship AI for the org user; none of them put AI on the constituent side with provenance.
5. **Quality signaling beyond volume.** Requires a market mechanism + AI evaluator with attestation. Debate markets with LMSR + EIP-712 multi-model AI panel signatures don't exist anywhere else in the advocacy stack.
6. **Long-term-survivable accountability artifacts.** Requires on-chain Merkle anchoring. Automation ladders and reports live in vendor silos; nothing in the landscape produces audit-survivable receipts.
7. **Reader-side independent verifiability.** Requires the platform to not be the trust anchor. FiscalNote owns both sides (VoterVoice + Fireside21) but in a structural conflict, not a public verifiability gift.
8. **$0-marginal-cost district resolution.** Requires owning the district layer post-Google-Civic-shutdown. Cicero is the effective monopolist at $0.03–$0.04/lookup.
9. **Country-code-keyed cross-border composition.** Requires protocol-level identity per jurisdiction. Engaging Networks routes multi-country but without verification or composition.

These nine are the union ceiling. The landscape cannot, by any combination of its tools, produce them. They are the categories Commons can occupy.

## The capability clusters

Each cluster below is independently transcendent — it goes beyond what any incumbent offers in that dimension. Composed, the clusters form a different category of product than "advocacy CRM" or "petition platform."

### Realization status

Two sweeps closed against this thesis. Each row tracks (v1 completed / v1 total) → (v2 completed / v2 total).

**v1 — 2026-05-28** (103 tasks: 42 completed + 61 deferred): the initial sweep against capability transcendence. Closed the v1 hypergraph at `docs/strategy/implementation-hypergraph/`.

**v2 — 2026-05-28** (73 tasks: 12 completed + 61 deferred): substrate-honesty cleanup + W-0 ops triage. Closed the v2 hypergraph at `docs/strategy/next-implementation-hypergraph/`. The five v2-completed substrate wire-ups (NEW-E-1..5) lift v1 "shipped substrate, writer not threaded" cases into honest user-visible features.

**v3 — 2026-05-28** (37 tasks: 17 completed + 20 deferred): data audit. Verified the 10 substrate claims from v1+v2 — 6 HONEST, 4 GAP. Each GAP got a FIX task; 3 fixes shipped (V-3, V-4, V-5 → FIX-V3/4/5), 1 deferred to broader integration sprint (V-2 → FIX-V2). Schema drift catalogs landed (D-1: 6 fields + 1 tombstone; D-2: 87 orphan indexes; D-3: 1 unmaintained counter `smsSentCount`). Closed at `docs/strategy/data-hypergraph/`.

| Cluster | v1 sweep | v2 sweep | Status after v2 |
| --- | --- | --- | --- |
| C-coordination-integrity | 4 / 4 (**realized**) | 2 / 2 (**realized**) | **REALIZED across both sweeps** — reputation cron has real data via userId thread (NEW-E-1). **v3 data-honesty update:** NEW-E-2 atlasVersion server-side thread is honest, and both `/c/[slug]` verified-address submissions and `/embed/campaign/[slug]` district-evidence submissions now carry H3 cell + atlas version after successful resolver output. Packet driftCount is available when action rows carry atlas evidence; postal-only/skipped district-evidence actions remain outside that broad claim. |
| C-composability | 5 / 9 | 2 / 5 (**partial**) | T7-3 cross-org reputation portability + E-4 branding accent UI shipped this sweep; T7-2 (supporter pools), T7-4/T7-6 (cross-border) deferred |
| C-quality-signaling | 2 / 10 | 1 / 8 (**partial**) | E-3 debate field populator shipped this sweep; on-chain stake / LMSR / TEE AI panel chain deferred on T6-2 mainnet + T5-3 TEE |
| C-reader-side | 3 / 9 | 1 / 8 (**partial**) | E-5 AttestationVerifier mounted at /v/[hash] this sweep; DM enrichment + dashboard + CRM deferred to post-launch UX |
| C-verification | 3 / 5 | 0 / 3 (**fully deferred**) | T3-6 DistrictRegistry, T5-3 TEE, A-2 MDL_IOS flip all ops/audit-gated |
| C-accountability | 5 / 10 | 0 / 6 (**fully deferred**) | Anchor pipeline (T6-1) + mainnet (T6-2) + state-bill ingestion (T6-6) + archive (T6-10) + DM-webhook (T8-8) all upstream-gated |
| C-agentic | 1 / 10 | 0 / 9 (**fully deferred**) | Delegation executor + all dependents deferred on T5-3 TEE |
| C-reach | 0 / 10 | 0 / 10 (**fully deferred**) | International + multi-state expansion deferred to Phase 2 / partnership coordination |
| C-data-sovereignty | 0 / 3 | 0 / 3 (**fully deferred**) | All mainnet-deploy-gated |

What ops/partnership/audit gates unblock the deferred tasks:

- **CP-1 Apple Business Connect** — iOS Safari mDL flow (NEW-A-2)
- **CP-2 ses-proxy Lambda deploy** — email blast + workflow runner + List-Unsubscribe + bounce attribution + weekly digest (10 tasks)
- **CP-3 Mainnet deploy composite** — SnapshotAnchor + DistrictRegistry + DebateMarket + anchor pipeline + on-chain stake (13 tasks)
- **CP-4 TEE Nitro Enclave** — delegation executor + AI panel + agent ZK + delegation UI (7 tasks)
- **CP-5 Sentry on-call** — audit log + observability digests + agent trace alerts (3 tasks)
- **Platform/RFP partnership outcome** — first selected platform-format sync runner (T1-3), OSDI namespace only where an adapter actually speaks OSDI (T9-4), state-bill ingestion (T6-6), then vendor-specific API runners beyond CSV export profiles
- **Multi-state Phase 2 sprint** — OpenStates (T3-1), special districts (T3-2), TIGER monitoring (T3-7), multi-jurisdiction routing (T3-8), per-district feed (T3-10), Postal Bubble UX (T3-9), agentic monitoring (T4-4), per-supporter bill alerts (T4-3)
- **International Phase 2** — CA/GB/AU rep-lookup (T3-3/4/5), cross-border schema (T7-4), multi-country delivery (T7-6)
- **Post-launch UX iteration** — DM enrichment chain (T8-1a/1b/5/7), white-label domain (T2-6), embed enhancements (T9-10), custom fields (T10-7), template library (T2-7), staffer dashboard (T8-1b)

Per-cluster file:line evidence is in `docs/strategy/implementation-hypergraph/docs/EXECUTION_LOG.md` (v1) and `docs/strategy/next-implementation-hypergraph/docs/EXECUTION_LOG.md` (v2). Each task's `completion_notes` cites the specific files + line ranges touched.

### Cluster 1: Verification

This is the substrate. It's not the whole story but it's the prerequisite for several other capabilities below.

**Shipped:** mDL Android OID4VP production with full HPKE decrypt + COSE_Sign1 against IACA roots + MSO digest verification + I1 SessionTranscript binding. Three-tree ZK circuit (identity + cell-district SMT + engagement) via `@voter-protocol/noir-prover` browser WASM. Witness encryption (X25519 + BLAKE2b frozen domain + XChaCha20-Poly1305). Cross-Device Bridge (KV+SSE, HMAC, AES-256-GCM, 6 brutalist cycles). 858 Foundry tests across 13 contracts on Scroll Sepolia.

**What transcends:** No incumbent has this. FiscalNote's April 2026 PolicyNote API explicitly markets district matching as a moat — an incumbent in going-concern restating the Shadow Atlas thesis under pressure. The substrate took years to build and cannot be retrofitted.

**Gap to close:** Mainnet contracts (Sepolia only). TEE Nitro Enclave deployment (LocalConstituentResolver active path).

### Cluster 2: Reach

**Shipped:** Shadow Atlas with 24 boundary types per H3 res-7 cell, 94,166 districts ingested, R-tree p95 <50ms, R2-chunked distribution at $0 marginal per lookup. Country-code-keyed `DistrictRegistry` contract. Atlas Worker pipeline live on Cloudflare R2.

**What transcends:**
- **Local government void.** The 39,555 special districts governing 84K officials are addressable only here. Quorum Local: ~75K official profiles, cities ≥3K population, 0 special districts. Cicero: ~400 cities. VoterVoice: areas >250K population only. List-first petition tools do not own this terrain. Commons: 24 boundary types including water/fire/transit/hospital/library/park/judicial/township/precinct/tribal.
- **Independence from the dying API layer.** Google Civic shut April 2025; ProPublica Congress API shut July 2024; OpenSecrets API shut April 2025; Congress.gov API outage August 2025 with no restoration timeline. Cicero is the effective monopolist at $0.03–$0.04/lookup. Commons owns the layer; $0 marginal cost; 24x the boundary coverage.
- **International extensibility.** Per-country district trees keyed on country code. UK/CA/AU postal resolvers are staged behind the `LIVE_RESOLVER_COUNTRIES = ['US']` gate, and representative lookup now fails closed instead of returning hollow empty results. The protocol structure supports any country whose boundary data is ingestible.

**Gap to close:** Local-government officeholder data (only federal `congress-legislators` is ingested; state and local rely on agentic Exa search). CA/GB/AU rep-lookup hydration. Mainnet `DistrictRegistry` deployment.

### Cluster 3: Composability

**Shipped:** Protocol-level identity commitment as a BN254 field element shared across orgs. Engagement Tree 3 leaf reads same tier for same person across every org on the protocol. `verifyMdocDeviceAuth` shared helper across OID4VP DC API + raw mdoc lanes (post-I1). Verification packet computation produces a portable artifact with SHA-256 attestation hash referenced to `REPORT-ATTESTATION-SPEC v1`.

**What transcends:**
- **Cross-org reputation portability.** A constituent who hits Veteran tier on their union local's campaign brings that tier to their environmental coalition, their school PTA, their healthcare advocacy. The tier doesn't reset per org. App-layer platforms cannot match this — each platform customer is per-vendor; the LinkedIn-style portable identity does not exist anywhere else in the advocacy stack.
- **Coalition aggregation at protocol layer.** 12 orgs running campaigns on Commons can produce a coalition-level verification packet that's protocol-native, not a manual export-import-aggregate exercise. "4,847 verified constituents across 3 states from 12 organizations" is a query the protocol answers; the data model supports it. Current network stats are live through `networks.getStats`; durable cross-border coalition artifacts and data-sharing policy remain bounded.
- **Cross-border composition.** Country-code-keyed registries mean a climate coalition can run a single campaign delivering verified packets to MPs in UK + reps in CA + senators in US, each constituent verified against their own country's district tree, aggregated into a single coalition packet.

**Gap to close:** Cross-border campaign data model (single `targetCountry` field today). Cross-org reputation aggregation query. Durable coalition artifact settlement/cache for large networks.

### Cluster 4: Agentic systems

This is where the AI race in the advocacy market intersects with Commons's substrate to produce a categorical differentiator.

Every incumbent in 2025–2026 is shipping AI for the org user. None puts AI on the constituent side with cryptographic provenance.

| Platform | AI Product | Principal | ZK on action? |
|---|---|---|---|
| Quorum Quincy 2.0 | Bill summarization | Lobbyist | No |
| Bonterra Que | Fundraising coaching | Development director | No |
| FiscalNote PolicyNote | Policy intelligence | Public-affairs analyst | No |
| VoterVoice SmartCheck | Subject line tuning | Campaign manager | No |
| Salesforce Agentforce Nonprofit | Prospect research | Gift officer | No |
| Bonterra Action Network Boost | Chat with data | Org admin | No |
| New/Mode | Message variation | Org user | No |
| Resistbot AI co-author | Letter drafting | Constituent | No verification |
| Hustle AI Script Assistant | Script drafting | Org user | No |
| **Commons (shipped)** | **DM resolution agent, message writer agent, subject line agent** | **Constituent** (template creator) | Partially — proof exists, not yet attached to every AI-assisted action |
| **Commons (Phase 3)** | **Verified delegation + agentic legislative monitoring** | **Constituent** (delegating principal) | **Yes** — ZK proof on every agent action |

The pattern across incumbents: AI for the org user, no AI on the action's authenticity, no AI on the constituent side with provenance. The constituent appears in the data only after an unverified human or unverified AI wrote the message for them.

**Shipped agentic capabilities:**
- **3-phase agentic DM resolution.** Role discovery → identity resolution → contact hunting (Gemini function-calling with 1 search + 2 reads per identity budget) → email deliverability → accountability openers. The decision-maker substrate is built agentic-first.
- **Message writer agent.** Grounding-verified composition with citation validation. The constituent's message comes from an agent that proves its claims.
- **Subject line agent.** Multi-turn clarification via structured JSON output. Retry with forced output. Gemini-backed.
- **AI panel for debate resolution.** `@voter-protocol/ai-evaluator` with 5-model panel + EIP-712 multi-model signatures + on-chain `submitAIEvaluation` + `resolveDebateWithAI`. Daily cron fan-out. The AI's verdict itself is verifiable.

**What transcends (when Phase 3 ships):**

*Agent-as-civic-actor with cryptographic provenance.* The transcendent move is making verification the agent's authority. An agent can only act on Commons because the principal is a verified constituent. The proof scope is bounded by delegation grant. Every action emits a nullifier preventing double-counting. The cryptography forces the agent to operate within actual authority — no astroturfing, no scale-degrades-credibility tradeoff.

*Multi-jurisdiction agentic monitoring across 24 boundary types per H3 cell.* Quorum's monitoring: federal + 50 states + ~75K local officials. Commons agentic monitoring (Phase 3): the constituent's specific H3 cell → all 24 jurisdictions populated for that cell → bill/agenda/vote feeds across all of them → drafted personalized response → submitted with ZK proof attached. No incumbent has the substrate.

This is not "Quincy but for citizens." It is a categorically new product. Quincy helps a lobbyist analyze federal bills. Commons agentic monitoring helps a verified constituent participate across federal + state + county + municipal + water district + school board, all from a single delegation grant, with cryptographic accountability back to the actions taken.

*Cross-org agent action portability.* A constituent grants their agent scope across all orgs they participate in. Agent acts in the union's labor campaign, the environmental coalition's climate work, the school PTA's bond measure response — same identity commitment, same tier accumulating, same delegation grant. Orgs see verified actions contribute to their packets; the constituent sees their reputation accumulate; the agent has private memory that's not the platform's. Every action is nullifier-deduped at the protocol layer.

*Trustworthy AI-mediated participation at scale.* Resistbot's AI co-author + 10M users is a potential astroturfing tool at scale, even if Resistbot's intent is benign. The next AI-native advocacy entrant faces the same Faustian bargain: efficiency degrades signal. Commons resolves this — the more agentic action runs through the protocol, the *more* verified actions exist, raising the legibility of authentic constituent contact above the noise floor flooding every other platform.

*Agent-as-civic-actor pricing inversion.* Every incumbent's pricing tier sells *org capacity* — seats, supporter counts, email volume. Commons can sell *agent action volume*. Each agent action is verified, attributed, contributes to verification packets, generates accountability receipts. Orgs subscribe to N agent-assisted verified actions per period (paid against $0.01 LLM COGS vs. $0.015 verified-action revenue per the monetization-policy doc, ~70%+ gross margin). The constituent never pays. The org pays for outcomes (verified actions, scorecards built from accountability receipts), not for software seats.

**Gap to close:** Delegation executor (Convex CRUD complete, `FEATURES.DELEGATION=false`, no agent calls `delegation.recordAction`). Per-supporter bill alerts (legislativeAlerts is org-scoped only). TEE Nitro Enclave for attested AI panel execution.

### Cluster 5: Quality signaling

**Shipped:** DebateMarket contract on Scroll Sepolia (~6,550 LOC tests across 4 files: DebateMarket.t.sol, LMSR.t.sol, AIResolution.t.sol, PositionPrivacy.t.sol). LMSR via PRB-math SD59x18 in `LMSRMath.sol`. Commit-reveal trade scheme with ZK debate-weight proofs. Phase 2 position privacy via `IDebateWeightVerifier`/`IPositionNoteVerifier`. AI panel submission via `IAIEvaluationRegistry`. `stancePositions` table with identity-commitment-keyed nullifier dedup. Argument scoring weight: `sqrt(stake) * 2^tier`.

**What transcends:**
- **Quality, not volume.** Every advocacy platform measures count. Commons measures *count + reasoning quality + position uncertainty*. A campaign with debate market = "247 verified constituents in CA-12 + 62% AMEND market position (depth $247) + top argument 'Index to CPI not flat rate' scored 0.84 by 5-model AI panel attested via EIP-712." That's a multi-dimensional signal no incumbent can produce. Quorum's 300 AI-generated message variants are noise diversity; this is quality measurement.
- **Position privacy with verification.** ZK position-note proofs let a constituent stake on SUPPORT/OPPOSE/AMEND without revealing the position publicly until reveal phase. The position is provable, the privacy preserved. Commit-reveal architecture is standard in DeFi; nobody else applies it to civic advocacy.
- **AI verdicts that are themselves verifiable.** When TEE Nitro Enclave deploys, the AI evaluator's execution becomes attestable on-chain. The 5-model panel's reasoning runs inside an enclave whose attestation hash is verifiable. AI-as-judge becomes AI-as-judge-with-receipt.

**Gap to close:** Campaign threshold debate spawn and manual campaign debate creation are wired through T5-1; the remaining quality-signaling gaps are on-chain stake verification in `createArgument` (currently caps at $1 placeholder), TEE-attested AI panel execution, active market epoch machinery, and mainnet DebateMarket deployment.

### Cluster 6: Accountability

**Shipped:** `accountabilityReceipts` schema with `attestationDigest` + `packetDigest` + `proofWeight` + `responses[]` (replied/meeting_requested/vote_cast/public_statement). Legislator scorecards via `scorecardSnapshots` (responsiveness + alignment + composite, 90-day rolling, methodologyVersion + snapshotHash, 12-period history). `SnapshotAnchor` contract live on Scroll Sepolia with `updateSnapshot()` transaction anchoring `https://atlas.commons.email/v20260512`.

**What transcends:**
- **Long-term-survivable artifacts.** Receipts anchor to Merkle roots on Scroll. A scorecard built today is auditable in 5 years even if the platform goes away. No app-layer competitor produces this — reports live in vendor databases and product-line silos. Commons receipts can survive the platform.
- **Decision-maker scoring across jurisdictions.** Federal + state + local + international DMs all use the same scoring methodology (`computeScorecards` is DM-agnostic). When state-bill ingestion ships, scorecards extend without code changes.
- **Independent verification.** The `/v/[hash]` page is reader-side proof verification. No Commons account required. A staffer who receives a campaign report verifies the attestation hash against the public Merkle root. The artifact is self-contained.

**Gap to close:** Receipt Merkle anchoring pipeline (SnapshotAnchor live but only anchors Shadow Atlas content root, not receipt batches). Mainnet contracts.

### Cluster 7: Coordination integrity

**Shipped:** All 4 metrics + CAI implemented in `src/lib/server/verification-packet.ts`. GDS (geographic dispersion via 1 − HHI), ALD (authorship linkage via unique-messageHash ratio), temporal entropy (Shannon entropy over hourly bins), burst velocity (peak/mean of hourly bins), CAI (Coordination Authenticity Index = (tier3 + tier4) / max(tier1, 1)). Anti-astroturf signal surfacing: burst velocity > 5 → amber warning; ALD < 0.50 → explicit identical-content threshold flag in the admin coordination panel; absent geographic signal when actions exist → explicit warning in the admin coordination panel; GDS < 0.7 + ALD < 0.7 → qualitative reader prose via `IntegrityAssessment.svelte`.

**What transcends:** Walker & Le (Socius 2023) is the peer-reviewed evidence that astroturfing measurably harms trust in legitimate advocacy orgs. Every incumbent's volume signal is gameable by AI-generated form mail; nobody else publishes mathematical credibility metrics with their campaign output. Commons makes anti-astroturf a math claim, not a vendor's assurance.

**Gap to close:** Coordination integrity score history (current scores work; no historical trend stored or charted).

### Cluster 8: Reader-side

This is the cluster nobody else even competes in. Every advocacy tool optimizes for the org buyer; the reader (LC/LA/staffer triaging 1,000+ messages/day) is not the customer.

**Shipped:** Verification packet rendered as staffer-legible evidence (identity-method bar, authorship bar, geography bar, date range, K-anonymity-floored counts). Campaign report HTML template with attestation hash and verification URL. `/v/[hash]` page for independent verification.

**What transcends:**
- **Reader UX as gift.** The verification packet is designed for the staffer's eye, not for the org's dashboard reformatted for export. The visual hierarchy is "what would the LC look for in 15 seconds": verified count + districts + identity method.
- **Independent verifiability.** The /v/[hash] page works without any Commons account. Staffer pastes the hash, confirms against the public Merkle root. Independence from the platform IS the credibility argument.
- **Survival beyond the platform.** Because attestation is anchored on-chain, a report sent today remains verifiable in 5 years even if Commons is gone. This collapses the FiscalNote dual-ownership conflict (they own buyer + reader but in a structural conflict, with no public verifiability) into a structurally honest gift.

**Future surface:** Opt-in reader dashboard where a Congressional office can subscribe to all verified incoming for their district from any org on the protocol. This collapses Indigov's freshman-cohort displacement of Fireside21 against Commons becoming the *protocol* the modern CRM reads from. Commons doesn't sell to the reader — verification is a UX gift — but the reader-side surface compounds the gravity well.

### Cluster 9: Data sovereignty

**Shipped:** Shadow Atlas owned in-house, $0 marginal per lookup, 24 boundary types, 94,166 districts. PII-free architecture (encrypted PII via org key; user PII fully eliminated 2026-04-10 — `_pii.ts`, `user-pii-encryption.ts`, `PII_ENCRYPTION_KEY`, `EMAIL_LOOKUP_KEY` all removed). Voter-protocol/* domain strings frozen post-launch.

**What transcends:**
- **Independence from the dying civic-data API layer.** Google Civic shut April 2025. ProPublica Congress API shut July 2024. OpenSecrets API shut April 2025. Congress.gov API outage August 2025 with no restoration timeline. Cicero is the effective monopolist at $0.03–$0.04/lookup. Commons sits outside the entire decay.
- **Platform cannot be subpoenaed for data it doesn't possess.** PII-free architecture means a court order on Commons returns identity commitments (cryptographic hashes), not PII. This is structural privacy, not policy privacy.
- **No PE/VC extraction logic.** Action Network's 501(c)(4) ownership structure protects it from PE; Commons's substrate (voter-protocol crypto contracts, frozen domain strings, public-good architecture) operates outside the rollup cycle that consumed Bonterra/Apax + Quorum/Serent + FiscalNote (delisted Apr 2026, going-concern).

**Gap to close:** Census/DOGE risk to TIGER quality (cumulative degradation over 2–3 year horizon; TIGER 2025 still functional). Mainnet contracts (still on Sepolia testnet).

## How the capabilities compose

The clusters above are not a list to check off. They compose into actions and artifacts the union of incumbents cannot produce.

### Composition 1: Verified agentic monitoring across 24 boundary types
**Capabilities:** Verification + Reach + Agentic + Composability

A constituent grants their agent scope: "watch every school board agenda in CA-SCH-3 for budget cuts; draft a response matching my positions on equity; notify me before sending." The agent queries Shadow Atlas for the constituent's 24 jurisdictions (Cluster 2: Reach), monitors via per-district feed, drafts grounded message (Cluster 4: Agentic — message writer agent), submits with ZK proof attached (Cluster 1: Verification). The proof scope is bounded by the delegation grant; nullifier prevents double-counting; trust tier portable across all orgs the constituent participates in (Cluster 3: Composability).

No incumbent can build this. Quorum lacks the boundary substrate. AN lacks legislator matching. Resistbot lacks verification. Quincy serves the lobbyist, not the constituent.

### Composition 2: Coalition packet at protocol layer
**Capabilities:** Verification + Composability + Reach + Accountability

12 orgs running campaigns on Commons aggregate their verified constituent counts into a single coalition packet via shared identity commitments (Cluster 3: Composability). The packet covers federal + state + local + special districts (Cluster 2: Reach). Each contributor's coordination integrity scores (Cluster 7) compose into the coalition's GDS/ALD/temporal entropy / CAI metrics. The aggregated packet's attestation hash anchors to Scroll via SnapshotAnchor (Cluster 6: Accountability). The receiving legislator's office can verify the entire coalition's claim independently via /v/[hash] (Cluster 8: Reader-side).

The result: "4,847 verified constituents across 3 states from 12 organizations + GDS 0.91 + ALD 0.87 + receipts anchored at block N + 247 deliveries acknowledged" — a single composable artifact. The AN + EveryAction + Engaging Networks union cannot produce this because each org's data lives in a separate vendor silo.

### Composition 3: Quality-signaled cross-border campaign
**Capabilities:** Verification + Reach + Quality signaling + Agentic

A climate coalition runs a campaign across UK + CA + US simultaneously (Cluster 2: Reach with country-code-keyed registries). Each constituent verified against own country's district tree (Cluster 1). Coalition spawns a debate market when traffic threshold hits (Cluster 5: Quality signaling). 5-model AI panel evaluates the top arguments via EIP-712 multi-model attestations. Resolution anchors on-chain. The coalition's packet to MPs/MPs/senators carries: verified-constituent count + per-country geographic spread + debate market position with quality-scored top arguments + attestation hash.

Engaging Networks does multi-country routing but without verification or composition. Avaaz has global membership but without per-country legislator matching. No incumbent composes these capabilities.

### Composition 4: Decision-maker accountability ledger with reader-verifiable receipts
**Capabilities:** Verification + Accountability + Reader-side + Composability

Every verified action contributes to an accountability receipt for the receiving decision-maker. Receipts contain `attestationDigest` + `packetDigest` + `proofWeight` + `responses[]` (vote, reply, meeting). Receipts feed legislator scorecards (responsiveness + alignment + composite over 90-day rolling windows). Scorecards' methodology version + snapshotHash provide auditability. Cross-org orgs reading the same scorecard see the same DM record because the substrate is shared.

When receipt Merkle anchoring ships (currently SnapshotAnchor anchors only Shadow Atlas content root), the entire decision-maker record becomes long-term-survivable. A scorecard built in 2026 is auditable in 2031 against the public chain.

Quorum's vote tracking is org-internal. FiscalNote's PolicyNote is policy-team-internal. AN doesn't track legislator response. Nobody else produces a cryptographically-survivable accountability ledger that scales across orgs.

### Composition 5: Agentic action with reputation accrual
**Capabilities:** Agentic + Composability + Verification + Coordination integrity

A constituent's agent takes 30 actions over a month across 12 orgs. Each action verified, each carries the constituent's identity commitment, each accrues to engagement tier (Cluster 3: Composability — tier portable across orgs). Coordination integrity scores (Cluster 7) are computed across the constituent's action set. Tier-promotion logic (when wired — currently `reputationTier` has no writer post-signup per `tier-system-structural-gaps`) lifts the constituent to a higher tier earned through actual civic labor.

The agent doesn't replace civic action; it makes civic action programmable. The constituent's authority compounds across orgs because the protocol's identity is shared. No incumbent's identity model supports this.

## What's shipped vs. what's gap

Honest mapping per cluster:

| Cluster | Substrate shipped | Surface to close |
|---|---|---|
| 1. Verification | mDL Android, ZK circuit, Cross-Device Bridge, 858 contract tests | Mainnet contracts; TEE deployment; per-supporter proof attached to every AI-assisted action |
| 2. Reach | 24 boundary types, Shadow Atlas, country-code registries, federal data | Local/state officeholder data (only agentic Exa today); CA/GB/AU rep-lookup; mainnet `DistrictRegistry` |
| 3. Composability | Protocol identity, verification packet, `verifyMdocDeviceAuth` shared; coalition aggregate stats live through the network stats route | Cross-border campaign schema (single targetCountry today); cross-org reputation query; coalition settlement/cache for large networks |
| 4. Agentic | DM resolution, message writer, subject line, AI evaluator, debate AI panel | Delegation executor (`FEATURES.DELEGATION=false`, no executor); per-supporter bill alerts; agentic monitoring |
| 5. Quality signaling | DebateMarket on Sepolia, campaign threshold debate trigger, manual campaign debate route, AI panel + EIP-712, stancePositions, position-privacy ZK | On-chain stake verification (capped at $1 placeholder); active market epoch machinery; TEE-attested AI execution |
| 6. Accountability | Receipts schema, scorecards (90-day rolling), SnapshotAnchor live | Receipt Merkle anchoring pipeline; mainnet anchor; state-bill ingestion |
| 7. Coordination integrity | GDS, ALD, temporal entropy, burst velocity, CAI, engagement-depth histogram, identical-content threshold flag, and absent-geography warning computed and rendered | Score history (no time-series) |
| 8. Reader-side | Verification packet UX, /v/[hash] page, attestation hash + spec | Reader dashboard for staffers; Indigov-class CRM integration |
| 9. Data sovereignty | Shadow Atlas owned, PII-free architecture, frozen domains | Mainnet (still Sepolia); resilience to Census/DOGE TIGER degradation |

The substrate carries the transcendent claim. Most of what makes Commons categorically different is built. The items to close map to **agentic execution** (delegation executor + per-supporter alerts), **coalition composition** (cross-border + durable artifacts + mainnet contracts), **quality maturation** (on-chain stake verification + active market epochs + TEE), and **accountability anchoring** (receipt Merkle pipeline).

## The agentic dimension, stated plainly

The advocacy software market currently sells one product to one customer: an org buys software to send mass communications, the staffer triages those as noise, the constituent's actual participation is laundered through unverified rows in a vendor's database. Every incumbent is shipping AI to make this faster, none to make it more authentic. The dependency-API layer just collapsed. Cicero is the effective monopolist on district matching.

Into this market Commons can position not as "another advocacy CRM" but as **agentic civic infrastructure** built on a capability composition the union cannot match:

1. The action carries proof — identity, constituency, district across 24 boundary types, jurisdiction across borders. (Clusters 1 + 2)
2. The action composes — into verification packets, coalition aggregates, accountability receipts that survive the platform. (Clusters 3 + 6)
3. The action is agentic — verified agents act on behalf of verified principals with cryptographically-bound delegation grants, scoped authority, ZK proofs attached. AI scale doesn't degrade signal credibility. (Cluster 4)
4. The action is portable — constituent's reputation accumulates across every org, verification packet is verifiable independent of Commons, attestation anchored to a public chain. (Clusters 3 + 6 + 8)
5. The action is quality-signaled — debate markets attach reasoning quality to high-stakes positions, AI panel verdicts are themselves verifiable. (Cluster 5)

These five claims compose into the categorical reframing: **civic action as cryptographic primitive, with agentic systems as the compose layer.**

Email/SMS/calling/petitions/events/donations/debate/monitoring all get reinstantiated on top of this. Each modality becomes a different kind of object because the unit of advocacy is a cryptographic proof, executable by an agent acting under verified authority, contributing to a portable reputation, generating a survivable accountability artifact.

The substrate to make this real is largely shipped. The path forward is not "build more competitive features." It is closing the remaining Phase 3 surfaces (delegation executor, per-supporter alerts, cross-border, mainnet, TEE, receipt anchoring, and quality settlement) and shipping the reinstantiation of every existing advocacy modality through the capability composition.

## What this means for positioning

When asked "what does Commons do that list CRMs and legislative-intelligence platforms do not?" — the answer is not "we verify." The answer is the capability composition above, of which verification is one cluster among nine.

When asked "what's the AI strategy?" — the answer is not "we have agents too." The answer is "every incumbent ships AI for the org user; Commons ships AI for the constituent side with cryptographic provenance, and ships AI verdicts (debate panel) that are themselves verifiable. Different category."

When asked "how do you compete with the entire landscape?" — the answer is not "we have features they don't." The answer is "the union of the landscape produces more efficient unverified noise; we produce civic action as a programmable cryptographic primitive that composes across orgs, jurisdictions, borders, and agents. The capability stack composes into a category they cannot reach."

When asked "what's the moat?" — the answer is the substrate (Clusters 1 + 2 + 9) cannot be retrofitted to app-layer competitors. FiscalNote's April 2026 District Matching API launch under going-concern pressure is the market validation: an incumbent in distress argued that owning district infrastructure is a moat. They're right. Commons owns the substrate; they don't.

---

*Cross-references: `docs/research/competitive-analysis.md` (Material Updates — May 2026), `docs/design/ORG-CAPABILITY-SCOPE.md` (what's shipped/stubbed/planned with file:line citations), `docs/strategy/product-roadmap.md` (Phase 0–3 sequencing), `docs/strategy/monetization-policy.md` (pricing model + 70%+ margin per verified action). Memory cross-refs: [[org-capability-scope-2026-05]], [[competitive-landscape-refresh-2026-05]], [[tier-system-structural-gaps]], [[org-launch-blockers-top10]], [[civic-data-api-collapse]], [[fiscalnote-distress]], [[conservative-gap-primary-sources]].*
