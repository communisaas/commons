# Critical Path — The 4 Chokepoints

Four tasks (or composites) block the largest fan-outs. Closing them first unblocks parallel work everywhere else. Their elapsed-time dependencies determine the calendar timeline for the whole implementation.

## CP-1: Outbound Webhooks (T9-3)

**Track:** TR-9 Developer Platform | **Wave:** W-2 | **Effort:** M (3 days)

**Why it's a chokepoint:** The event-emission substrate. Not just a developer-platform feature — the `orgEvents` table this creates is shared infrastructure for real-time subscriptions, reader-side notifications, and coalition aggregation triggers.

**Direct downstream (4):**
```
T9-3 ──┬──▶ T9-7  Real-time subscriptions v1 (SSE reads orgEvents)
       ├──▶ T8-8  Reader-side webhook notifier (office incoming alerts)
       ├──▶ T9-8  Developer portal documentation
       └──▶ T6-9  Receipt response email reply detection (via webhook fan-out)
```

**Elapsed time:** No external dependency. 3 days engineering.

**Ship priority:** First week of Wave 2. Sequence before T9-7, T8-8, T9-8.

---

## CP-2: Scroll Mainnet Deployment (Composite: T3-6 + T5-5 + T6-2)

**Track:** TR-3 + TR-5 + TR-6 | **Wave:** W-3 | **Effort:** L (1-2 weeks engineering + 2-4 weeks elapsed)

**Why it's a chokepoint:** `DeployScrollMainnet.s.sol` has never been broadcast. DebateMarket is commented out in the script. SnapshotAnchor is not in the script at all. Until mainnet ships, accountability anchoring is testnet-only, debate stake verification is $1 placeholder, mainnet DistrictRegistry is missing, and 5-year-survivable claims are aspirational.

**Composite members:**
- T3-6 Shadow Atlas mainnet DistrictRegistry deployment
- T5-5 Mainnet DebateMarket deployment (uncomment + add AIEvaluationRegistry)
- T6-2 Mainnet SnapshotAnchor deployment (new script — was not in original)

**Direct downstream (8):**
```
T3-6+T5-5+T6-2 ──┬──▶ T5-2 production  On-chain stake verification (mainnet path)
                 ├──▶ T5-1 real-economics  Auto-debate-spawn with real USDC stakes
                 ├──▶ T5-6b  On-chain Engagement Tree update
                 ├──▶ T6-1  Receipt Merkle anchoring pipeline (mainnet)
                 ├──▶ T6-7  Browser verification UI (verifies against mainnet root)
                 ├──▶ T6-10  Long-term archive Merkle proof
                 ├──▶ T8-4b  IPFS-pinned campaign report artifact
                 └──▶ T8-6  Long-term-survivable artifact pattern
```

**Elapsed time dependencies (operations, not code):**
- Complete DEPLOY-CHECKLIST.md requirements (security audit verification)
- Deploy three-tree HonkVerifier_20 to Scroll Mainnet
- Configure 3-of-5 Safe multisig as GOVERNANCE_ADDRESS
- AIEvaluationRegistry: pre-register 5 model signer keys (currently absent from script)
- Bridge Scroll Mainnet ETH for gas
- Bridge Scroll Mainnet USDC for DebateMarket testing

**Ship priority:** Start security audit + Safe setup concurrent with W-2 work. Execute mainnet deployment as one ops event at start of W-3.

---

## CP-3: TEE Nitro Enclave Deployment (T5-3)

**Track:** TR-5 Quality Signaling | **Wave:** W-3 | **Effort:** L (3 weeks elapsed; 1 week engineering interspersed)

**Why it's a chokepoint:** Long-lead-time infra. `NitroEnclaveResolver` is a wired stub; `LocalConstituentResolver` is the active path. Without TEE, the "AI panel verdicts are themselves verifiable" claim is positional only, and TEE-attested constituent resolution stays aspirational.

**Direct downstream (3):**
```
T5-3 ──┬──▶ T5-4  TEE-attested AI panel execution
       ├──▶ Cluster 1 substrate completeness (LocalResolver → AttestedResolver)
       └──▶ T5-7  Position privacy attestation chain
```

**Elapsed time dependencies:**
- AWS Nitro Enclave-capable account setup
- m6g.xlarge ARM Graviton EC2 in us-east-1 (~$150/month)
- Enclave image build pipeline (`nitro-cli build-enclave`)
- PCR0 measurement publication to `atlas.commons.email/enclave/manifest.json`
- vsock proxy implementation (~300 LOC) for parent↔enclave I/O
- Attestation document chain verification client-side

**Ship priority:** Start in parallel with W-2 ops work. Independent of all code waves. T5-4 (W-4) cannot start until T5-3 completes.

---

## CP-4: Delegation Executor + ZK Proof Attachment (T4-1 + T4-2)

**Track:** TR-4 Agentic Systems | **Wave:** W-3 | **Effort:** L (5-6 weeks combined)

**Why it's a chokepoint:** "Agent-as-civic-actor with cryptographic provenance" is the headline categorical differentiator. `FEATURES.DELEGATION=false` today. Convex CRUD is complete; no executor exists. Without it, Cluster 4 stays as "we have some AI for org users" rather than "AI on action with provenance."

**Internal sequencing:**
- T4-2 (ZK proof attachment + draftedMessages table) lands first (1.5-2 weeks)
- T4-1 (Delegation executor) lands after (3-4 weeks)
- Combined unblocks 7 downstream items

**Direct downstream (7):**
```
T4-1+T4-2 ──┬──▶ T4-3  Per-supporter bill alerts
            ├──▶ T4-4  Agentic legislative monitoring across 24 boundary types
            ├──▶ T4-5  Cross-org agent action portability
            ├──▶ T4-6  Agent-as-civic-actor pricing model
            ├──▶ T4-7  Message-writer proof binding (needs draftedMessages from T4-2)
            ├──▶ T4-8  Agent trace observability extension
            ├──▶ T4-9  Delegation UI for constituents
            └──▶ T4-10 Coordinated multi-agent flows (subsumed in executor)
```

**Note: T4-4 also requires T3-1 + T3-2.** Agentic monitoring across 24 boundary types is unblocked by T4-1 + T3 state/local data combined.

**Ship priority:** Start in W-3 after Wave 2 substrate (T10-1 reputationTier writer needs to be in place; T4-1 executor relies on tier state being honest).

---

## Critical-path summary chart

```
W-1 ─────────────► W-2 ─────────────────► W-3 ──────────────────► W-4 ─────────► W-5
                                          │
        ┌─ T9-3 ──┬───────────────────────┼─────────► T9-7, T8-8, T6-9
        │  (3d)  │                       │
        │        │                       │
        │        │           T3-6+T5-5+T6-2 ──┬──► T5-1, T5-2, T5-6, T6-1, T8-4b
        │        │           (2 wks eng + 2-4 wks elapsed)
        │        │                       │
        │        │                       │── T5-3 ──► T5-4 (W-4)
        │        │                       │  (3 wks elapsed)
        │        │                       │
        │        │           T4-2 → T4-1 ──┬──► T4-3, T4-4, T4-5, T4-6, T4-8, T4-9
        │        │           (5-6 wks combined)
        │        │
        └─ Wave 1 sales blocker fixes (parallel)
```

## The four chokepoints, ordered by sequence

| Order | Chokepoint | Wave | Engineering | Elapsed |
|---|---|---|---|---|
| 1 | CP-1 Outbound Webhooks (T9-3) | W-2 | 3 days | 3 days |
| 2 | CP-3 TEE Deployment (T5-3) | W-3 (start early) | 1 week | 3 weeks |
| 3 | CP-2 Mainnet Deployment (composite) | W-3 | 2 weeks | 4-6 weeks |
| 4 | CP-4 Delegation Executor (T4-1+T4-2) | W-3 | 5-6 weeks | 5-6 weeks |

CP-2 and CP-3 elapsed times can overlap. CP-4 engineering can begin once T4-2 lands; T4-1 development can parallel CP-2 and CP-3 ops work. Optimistic critical path: end of W-3 (~3 months from start).

## Removing chokepoints (alternative architectures)

Should we revisit a chokepoint:

- **CP-1 alternative:** If outbound webhooks blocked, polling-based event consumption is the fallback (the SSE in T9-7 is already a 5s poll pattern; reader-side notification could be email-only without webhooks). Cost: customers cannot react in real-time to Commons events from their own systems. Acceptable degradation.
- **CP-2 alternative:** No mainnet alternative. Sepolia-only operation means accountability anchoring is on testnet, which fails the "5-year-survivable artifact" claim. Unblock-by-deferral: ship without mainnet anchoring as long as the rest of the system works; revisit when funding/ops capacity allow.
- **CP-3 alternative:** Stay with `LocalConstituentResolver` indefinitely. Document the trust model explicitly in `/about/integrity`. The "TEE attests the resolver code path" claim is removed; the substrate is honest about platform-trust rather than enclave-trust.
- **CP-4 alternative:** Manual agent (constituent-initiated each time) instead of delegated agent. Loses the "agent acts autonomously within scope" claim; keeps the "AI-assisted civic action with proof" claim. Significant product downgrade but engineering chokepoint removed.

If timeline pressure forces choices, CP-3 is the most deferrable; CP-4 is the most product-load-bearing; CP-1 + CP-2 are necessary for any meaningful version of capability transcendence.
