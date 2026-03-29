# ZKP Integrity Task Graph

**Status**: REVIEWED — 6 brutalist critics, findings validated against code
**Date**: 2026-03-29
**Reviewed**: 2026-03-29 — Architecture (3 critics) + Security (3 critics)
**Scope**: Shadow Atlas integration, client-side ZKP, verification wiring, root lifecycle
**Repos**: `commons`, `voter-protocol`

---

## Problem Statement

The shadow-atlas three-tree ZKP system has a complete **generation** path but an incomplete **verification** path. Six distinct proof code paths exist in commons; only the debate paths verify proofs on-chain. The constituent message path — the primary civic action — generates proofs that are stored but never cryptographically verified before congressional delivery.

Additionally, Tree 1 (user identity) Merkle roots go stale with every new registration, and no refresh mechanism exists. Once verification is wired, stored proofs will fail against the current root unless clients can refresh their tree state.

### Six Proof Paths (Current State)

| Path | Circuit | Verification | Status |
|------|---------|-------------|--------|
| Constituent messages | three-tree (31 inputs) | **NONE** | Proof is cargo |
| Debate arguments | three-tree (31 inputs) | DistrictGate on-chain | Verified |
| Debate co-signs | three-tree (31 inputs) | DistrictGate on-chain | Verified |
| Debate commit/reveal | debate-weight (2 inputs) | DebateMarket on-chain | Verified |
| Community field | bubble-membership (5 inputs) | **NONE** | Proof forwarded unverified |
| Position settlement | position-note (5 inputs) | On-chain (future) | Not yet wired |

### Three Root Staleness Problems

1. **Tree 1 (User Identity)**: Root changes per registration. No refresh API. No client polling. `updateTreeState()` has zero callers.
2. **Tree 2 (Cell-District)**: Root changes quarterly (redistricting). Anchored in SnapshotAnchor on Scroll. Client caches 7-day TTL chunks from IPFS. Manageable.
3. **Tree 3 (Engagement)**: Root changes per engagement event. Falls back to zero-hash gracefully. Circuit still verifies at tier-0.

---

## Architecture Context

### Contract Verification Chain (DistrictGate.sol)

`verifyThreeTreeProof()` performs these checks in order:

1. EIP-712 signature validation (signer + nonce + deadline)
2. `UserRootRegistry.isValidUserRoot(publicInputs[0])` — Tree 1 root must be registered and active
3. `CellMapRegistry.isValidCellMapRoot(publicInputs[1])` — Tree 2 root must be registered and active
4. Country match: UserRoot country == CellMapRoot country
5. Depth consistency across all three registries
6. `allowedActionDomains[publicInputs[27]]` — action domain must be whitelisted (SA-001)
7. `actionDomainMinAuthority[domain] <= publicInputs[28]` — minimum authority level
8. `EngagementRootRegistry.isValidEngagementRoot(publicInputs[29])` — Tree 3 root must be registered
9. Depth-specific HonkVerifier contract: `verifier.verify(proof, publicInputs)` — ZK proof validity
10. `NullifierRegistry.recordNullifier(actionDomain, nullifier, userRoot)` — atomic nullifier recording

### Constituent Message Pipeline (Current)

```
ProofGenerator.svelte
  → generateThreeTreeProof() (Noir WASM, ~16KB proof)
  → encryptWitness() (X25519→XChaCha20 to TEE pubkey)
  → POST /api/submissions/create
    → convex/submissions.create (Convex action)
      → insertSubmission (nullifier dedup: LOCAL DB ONLY)
      → schedule deliverToCongress
        → TEE_RESOLVER_URL/resolve (decrypt witness)
        → CWC batch submission
```

**Gap**: Between `insertSubmission` and `deliverToCongress`, no proof verification occurs. The proof hex is stored with `verificationStatus: "pending"` which never transitions.

### Debate Argument Pipeline (Partial Reference)

```
DebateProofGenerator.svelte
  → generateThreeTreeProof()
  → POST /api/debates/[id]/arguments
    → debate-market-client.submitArgument()
      → EIP-712 sign (relayer wallet)
      → DebateMarket.submitArgument(proof, publicInputs, sig)
        → DistrictGate.verifyThreeTreeProof() ← ON-CHAIN VERIFICATION
        → NullifierRegistry.recordNullifier() ← ATOMIC
    → Convex createArgument (stores txHash)
```

**Caveat (brutalist-validated)**: The debate path **fails open** when blockchain is not configured. `arguments/+server.ts:140-151` sets `serverVerified = true` on blockchain misconfiguration or import failure. The cosign path has the identical pattern (`cosign/+server.ts:102-113`). This path is a reference for the *structure* but not the *trust model*.

### Key Differences

1. The debate path delegates verification to the contract atomically. The constituent path skips it entirely.
2. The debate path fails open on misconfiguration. The constituent path has no verification to fail.
3. Delivery routes via encrypted witness address, not proof-bound districts — the proof proves identity + district, but `deliverToCongress` uses `resolved.constituent.congressionalDistrict` from TEE-decrypted witness data (`submissions.ts:248`).

---

## Brutalist Review Findings (2026-03-29)

Six critics (3 architecture, 3 security) reviewed this task graph. All claims below are **verified against code** — speculative or overstated findings are excluded.

### Validated Critical Findings

**F1. `promoteTier` escalation via garbage submission**
`convex/submissions.ts:87` schedules `promoteTier` fire-and-forget on every submission. `promoteTier` (line 365-380) unconditionally patches `trustTier: 2` when current tier < 2. No dependency on proof validity, verification status, or delivery success. A garbage submission immediately upgrades trust tier.

**F2. Delivery routes via witness address, not proof-bound districts**
`witness-encryption.ts:76-86`: `deliveryAddress` in the encrypted witness is explicitly "not used in proof." `submissions.ts:248` uses `resolved.constituent.congressionalDistrict` (from TEE-decrypted witness) to look up officials. The ZK proof binds to districts via Tree 2, but **delivery ignores the proof binding entirely**. Even with verification wired, an attacker with a valid proof for District A could forge the witness to route to District B.

**F3. Debate path fails open — not a reliable reference**
`arguments/+server.ts:140-151`: When blockchain is "not configured" (line 140) OR the import throws (line 150-151), `serverVerified = true` is set anyway. Same in cosign path (lines 102-113).

**F4. Action domain includes templateId — governance doesn't scale**
`action-domain-builder.ts:151-165`: `templateId` is part of the keccak hash. Post-genesis, every user-created template needs a 7-day governance proposal. This is on the critical path.

### Validated High Findings

**F5. Root registration cadence is the real staleness problem (reframe)**
The problem isn't client staleness — it's on-chain registry staleness. Clients always get the LATEST root from registration. The `UserRootRegistry` is the one that's behind. The refresh endpoint (0A) must return proof against the most-recently-REGISTERED root, not just current tree state.

**F6. `isNullifierUsed()` returns `false` on misconfiguration**
`district-gate-client.ts:576`: Returns `false` (available) when blockchain isn't configured. Defense-in-depth degrades to nothing silently. Must fail closed.

**F7. Demo mode silently marks deliveries as "delivered"**
`submissions.ts:272-281`: If `CWC_API_URL` unset, submissions get `deliveryStatus: "delivered"` with `demo-` prefix. No error to user. Configuration-dependent silent failure.

### Overruled Findings

- **NonceManager per-isolate collision**: Valid concern but premature — depends on 2A architecture decision. Noted for 2B implementation, not a task graph gap.
- **TEE public key MITM**: Out of scope for ZKP task graph. Separate TEE hardening concern.
- **5-minute refresh TTL attack window**: Multi-root registry with 30-day sunset makes this unexploitable.
- **Template content mutability**: By design — proof binds to identity/district, not template content.

### Consensus Across All Critics

**Layer 3 (contract state) is the true first blocker, not Layer 1 (root refresh).** UserRootRegistry accepts multiple active roots, so client staleness is an availability issue. Unregistered roots, unregistered domains, and unregistered engagement roots are verification blockers. The task graph is reordered accordingly.

---

## Task Graph — Implementation→Review Cycles

Each cycle is implemented, reviewed (brutalist or manual), and merged before the next begins. Cycles are ordered by blast radius and dependency chain.

### Cycle 0: Immediate Stopgaps (zero dependencies, deployable now)

**Goal**: Close the two most exploitable gaps before any infrastructure work.

#### S1 — Remove `promoteTier` from submission pipeline

**Domain**: Backend (Convex mutation)
**Repo**: commons
**Severity**: CRITICAL — exploitable today

`convex/submissions.ts:87` schedules `promoteTier` unconditionally. Delete the scheduler line. Trust tier promotion must wait until verification status lifecycle (Cycle 2) is wired — only promote after `verificationStatus === 'verified'`.

**Files**: `convex/submissions.ts`

---

#### S2 — Add server-side proof structural validation at submission

**Domain**: Backend (SvelteKit API route)
**Repo**: commons
**Severity**: CRITICAL — garbage proofs currently accepted

`src/routes/api/submissions/create/+server.ts:63-74` validates field presence only. Add:
1. `publicInputs` is array of exactly 31 elements
2. Each element is valid BN254 field element (< modulus)
3. `proof` is valid hex of expected length (>1KB, <64KB)
4. `nullifier` matches `publicInputs[26]`
5. `actionDomain` consistency check against `publicInputs[27]`

This blocks structurally invalid proofs at the door. It does NOT verify the ZK proof cryptographically (that's Cycle 2), but it eliminates garbage submissions.

**Files**: `src/routes/api/submissions/create/+server.ts`

---

**Review gate**: Verify S1 and S2 don't break existing tests. Run full test suite. Check that legitimate submissions still succeed while garbage is rejected.

---

### Cycle 1: Contract State (true first blockers)

**Goal**: Register all roots and action domains so DistrictGate can accept proofs.

#### 3A — Define action domain taxonomy

**Domain**: Ops (analysis)
**Repo**: commons

`buildActionDomain()` in `action-domain-builder.ts:151-165` hashes `(protocol, country, jurisdictionType, recipientSubdivision, templateId, sessionId)`. Inventory all current domains.

---

#### 3A-R — Resolve templateId-in-domain scaling (NEW — brutalist finding F4)

**Domain**: Architecture (decision + implementation)
**Repo**: commons
**Depends**: 3A
**Blocks**: 3B

**Options**:
- **(a)** Remove `templateId` from hash → one domain per `(country, jurisdiction, subdivision, session)`. Simplest. Users can submit multiple templates to the same rep (nullifier scoped to jurisdiction+session, not template). Off-chain template tracking.
- **(b)** Use `DistrictGate.registerDerivedDomain()` for template variants. DistrictGate already supports authorized derivers creating derived domains from a base domain. Templates become derived domains from a base jurisdiction domain.
- **(c)** Wildcard/prefix registration model. Requires contract changes.

**Recommendation**: **(b)** — register base domains per `(country, jurisdiction, subdivision, session)`, then derive template-scoped domains via the existing `registerDerivedDomain()` mechanism. This preserves per-template nullifiers without 7-day governance per template.

**Files**: `src/lib/core/zkp/action-domain-builder.ts`, `DistrictGate.sol`

---

#### 3B — Register action domains on DistrictGate

**Domain**: Contract ops (Foundry, governance txs)
**Repo**: voter-protocol
**Depends**: 3A-R
**Blocks**: Cycle 2

`DistrictGate.sol:610` — `allowedActionDomains[domain]` must be `true`.
- Genesis (not sealed): `registerActionDomainGenesis(bytes32)` — direct
- Post-genesis (sealed): `proposeActionDomain()` → 7-day timelock → `executeActionDomain()`

---

#### 3C — Register current UserRoot in UserRootRegistry

**Domain**: Contract ops (governance tx)
**Repo**: voter-protocol
**Blocks**: Cycle 2

```solidity
registerUserRoot(root, "USA", 20)
```

UserRootRegistry accepts MULTIPLE active roots. Old roots remain valid until governance deactivates (7-day timelock + 30-day grace). Root refresh (Cycle 3) is about ensuring clients have a root that IS in the registry.

**Reframe (brutalist F5)**: The on-chain registry is the stale component, not the client. Register current root AND establish a cadence for future registrations (daily batches recommended: ~$1/month on Scroll, max 24h staleness window).

---

#### 3D — Register current CellMapRoot in CellMapRegistry

**Domain**: Contract ops (governance tx)
**Repo**: voter-protocol
**Blocks**: Cycle 2

```solidity
registerCellMapRoot(root, "USA", 20)
```

DistrictGate checks CellMapRegistry, NOT SnapshotAnchor directly. 90-day grace period.

---

#### 3E — Register zero EngagementRoot in EngagementRootRegistry

**Domain**: Contract ops (governance tx)
**Repo**: voter-protocol
**Blocks**: Cycle 2

`proof-input-mapper.ts:130` falls back to `ZERO_HASH` for engagement root.

```solidity
registerEngagementRoot(ZERO_HASH, 20)
```

180-day auto-expiry (SM-4 fix). The circuit still enforces identity binding at tier-0 (same `identityCommitment` in nullifier and engagement leaf). Zero engagement is safe.

**Open question**: Is `0x000...000` a valid Poseidon2 empty-tree root? Or should it be the precomputed empty root (recursive hash of empty leaves)? Verify against circuit test vectors.

---

**Review gate**: Verify all roots and domains are registered on-chain. Query registries to confirm `isValidUserRoot()`, `isValidCellMapRoot()`, `isValidEngagementRoot()`, and `allowedActionDomains[]` all return true for the expected values.

---

### Cycle 2: Verification Wiring (closes the trust anchor)

**Goal**: Proofs are cryptographically verified before delivery. Verification status lifecycle is real.

#### 2A — Verification timing decision (RESOLVED)

**Decision**: Hybrid — **(c) server-side Barretenberg verify at submission** + **(b) async on-chain verify before delivery**.

Rationale:
- Server-side verify (sub-second, no gas) blocks invalid proofs immediately at the SvelteKit endpoint. Uses `@voter-protocol/noir-prover` verify().
- Async on-chain verify (in `deliverToCongress`, before TEE decryption) records the nullifier with blockchain finality.
- If server-side passes but on-chain rejects → `verification_failed` status, no delivery.
- This avoids the SvelteKit↔Convex boundary problem: server-side verify is in SvelteKit, on-chain verify configuration moves to Convex env vars.

---

#### 2B — Server-side proof verification at submission

**Domain**: Backend (SvelteKit API route)
**Repo**: commons
**Depends**: Cycle 1 complete (domains + roots registered)

Add `noir-prover.verify(proof, publicInputs)` call in `/api/submissions/create` endpoint, after structural validation (S2) and before Convex dispatch. Reject immediately if proof is cryptographically invalid.

**Boundary**: This runs in SvelteKit where `$env/dynamic/private` is available. The server-side verifier doesn't need blockchain config — it verifies the ZK proof math only.

**Files**:
- `src/routes/api/submissions/create/+server.ts`
- `src/lib/core/zkp/server-verifier.ts` (NEW — thin wrapper around noir-prover verify)

---

#### 2B-chain — Async on-chain verification in delivery pipeline

**Domain**: Backend (Convex action, ethers.js)
**Repo**: commons
**Depends**: 2B, Cycle 1 complete

Wire `verifyOnChain()` into `deliverToCongress` **BEFORE** TEE decryption (line 228). Convex action calls back to a SvelteKit webhook endpoint for the blockchain transaction (preserves `$env/dynamic/private` boundary).

Pipeline becomes:
```
deliverToCongress:
  1. Mark verifying
  2. Call /api/submissions/verify-onchain webhook
     → verifyOnChain(proof, publicInputs, depth)
     → Returns { success, txHash } or { error }
  3. If success → mark verified → TEE decrypt → CWC deliver
  4. If failure → mark verification_failed → STOP (no delivery)
```

**Files**:
- `convex/submissions.ts` (deliverToCongress)
- `src/routes/api/submissions/verify-onchain/+server.ts` (NEW webhook)
- `src/lib/core/blockchain/district-gate-client.ts`

---

#### 2C — On-chain nullifier check (fail-closed)

**Domain**: Backend (SvelteKit API route)
**Repo**: commons
**Depends**: Cycle 1 (3B)
**Parallel with**: 2B

Add `isNullifierUsed(actionDomain, nullifier)` check in SvelteKit endpoint before Convex dispatch.

**Reframe (brutalist F6)**: Must fail CLOSED when blockchain is not configured. If `getContractInstance()` returns null, reject the submission — do not silently pass.

**Files**: `src/routes/api/submissions/create/+server.ts`

---

#### 2D — Verification status lifecycle

**Domain**: Backend (Convex schema + mutations)
**Repo**: commons
**Depends**: 2B-chain

State machine:
```
pending → verifying → verified → delivered
                   → verification_failed
```

Gate `deliverToCongress` on verification phase. Update Convex schema if needed.

**Files**: `convex/submissions.ts`, `convex/schema.ts`

---

#### 2E — Gate promoteTier on verification (NEW — brutalist F1)

**Domain**: Backend (Convex mutation)
**Repo**: commons
**Depends**: 2D

Re-enable `promoteTier` (removed in S1), but only schedule it AFTER `verificationStatus === 'verified'`. Move the scheduler call from `create` action into `deliverToCongress` after successful verification.

**Files**: `convex/submissions.ts`

---

#### 2F — Cross-check proof districts against witness district (NEW — brutalist F2)

**Domain**: Backend (Convex action)
**Repo**: commons
**Depends**: 2B-chain

After TEE decryption in `deliverToCongress`, cross-check:
- `publicInputs[2-25]` → 24 district field elements (from verified proof)
- `resolved.constituent.congressionalDistrict` → district from witness

Decode the district field elements back to district codes. If the witness district is NOT in the proof's district set, reject delivery. This closes the astroturfing-via-witness-forgery attack.

**Files**: `convex/submissions.ts` (deliverToCongress, after TEE decrypt)

---

**Review gate**: End-to-end test with real proof generation. Verify: (1) garbage proofs rejected at submission, (2) valid proofs pass server-side verify, (3) on-chain verify records nullifier, (4) delivery only proceeds after verified status, (5) witness district matches proof districts, (6) promoteTier only fires after verification.

---

### Cycle 3: Root Refresh (availability under growth)

**Goal**: Clients can refresh stale tree state. System remains functional as registration rate grows.

#### 0A — Add `/v1/proof-refresh/{leafIndex}` to Shadow Atlas serve

**Domain**: Protocol (TypeScript, HTTP API)
**Repo**: voter-protocol
**Blocks**: 1A

`merkle-tree.ts:366` has `generateProof(address)` — O(depth) sibling collection.

**Reframe (brutalist F5)**: Must return proof against the most-recently-REGISTERED root (matching a root in UserRootRegistry), not just the current tree state. Otherwise, clients get proofs against unregistered roots.

**Design**: Accept optional `registeredRoot` parameter. If provided, generate proof using that root's tree snapshot. If omitted, use the most recent snapshot that corresponds to a registered root.

**Privacy**: Require authentication. Rate-limit to prevent leaf index enumeration. The response reveals only public tree data (sibling hashes), but request patterns are a timing side-channel.

**Files**:
- `voter-protocol/packages/shadow-atlas/src/serving/api.ts`
- `voter-protocol/packages/shadow-atlas/src/merkle-tree.ts`

---

#### 0B — Root-change event emission from registration service

**Domain**: Protocol (TypeScript, event system)
**Repo**: voter-protocol

`registration-service.ts:242` returns new root to registrant only. Need event/callback for downstream systems.

Recommended: EventEmitter on RegistrationService (in-process). Simple, no external dependencies. Listeners: root registration automation (5D), NDJSON log.

**Files**: `voter-protocol/packages/shadow-atlas/src/serving/registration-service.ts`

---

#### 1A — Add `/api/shadow-atlas/refresh` endpoint

**Domain**: Backend (SvelteKit API route)
**Repo**: commons
**Depends**: 0A

Authenticated endpoint. Looks up user's leafIndex from Convex, proxies to voter-protocol 0A. Returns fresh tree state.

**Security**: Validate requesting user owns the leafIndex.

**Files**:
- `src/routes/api/shadow-atlas/refresh/+server.ts` (NEW)
- `src/lib/core/shadow-atlas/client.ts`

---

#### 1B — Wire `updateTreeState()`

**Domain**: Client (IndexedDB)
**Repo**: commons
**Depends**: 1A

`session-credentials.ts:846` exists with zero callers. Wire into refresh response handler. Preserve identity secrets.

**Files**: `src/lib/core/identity/session-credentials.ts`

---

#### 1C — Pre-proof freshness check in ProofGenerator

**Domain**: Client (Svelte components)
**Repo**: commons
**Depends**: 1A, 1B

Change BR5-010 from reactive to proactive. Before proof assembly, check root freshness. Refresh if stale (>5 min since last check). Same for DebateProofGenerator.

**Files**:
- `src/lib/components/template/ProofGenerator.svelte`
- `src/lib/components/debate/DebateProofGenerator.svelte`

---

**Review gate**: Test root refresh end-to-end. Register a new user (changes root), verify existing user can refresh and generate a valid proof against the new tree state.

---

### Cycle 4: Engagement Pipeline (adds signal)

**Goal**: Tree 3 produces real engagement tiers. Engagement data flows back to clients.

**Note (brutalist)**: Once 4C registers real engagement roots AND the zero-hash is deactivated, Tree 3 becomes a hard dependency for ALL proof paths. 4C is a "point of no return" — do not deactivate the zero-hash root until client engagement refresh (4B) is confirmed working.

#### 3F — Populate ActionCategoryRegistry

**Domain**: Ops (JSON configuration)
**Repo**: voter-protocol
**Depends**: 3A-R (domain taxonomy finalized)

Map each whitelisted action domain hash → category (1-5). Loaded via `ACTION_CATEGORY_REGISTRY` env var.

---

#### 4A — Wire ChainScanner → EngagementService → Tree 3

**Domain**: Protocol (ops + configuration)
**Repo**: voter-protocol
**Depends**: Cycle 2 (events must exist), 3F

Configure serve command with `CHAIN_RPC_URL`, `DISTRICT_GATE_ADDRESS`, `ACTION_CATEGORY_REGISTRY`.

---

#### 4B — Engagement data reverse flow to client

**Domain**: Client + Backend
**Repo**: commons
**Depends**: 4A, 1B (updateTreeState wired)

Fetch endpoint exists: `src/routes/api/shadow-atlas/engagement/+server.ts`. Wire into proof generation flow: before generating proof, fetch current engagement data, update IndexedDB.

---

#### 4C — Register real EngagementRoots on-chain

**Domain**: Contract ops
**Repo**: voter-protocol
**Depends**: 4A, 4B confirmed working

**Point of no return**: Only deactivate the zero-hash root (3E) AFTER confirming 4B works end-to-end. Otherwise all proofs fail.

---

**Review gate**: Verify engagement tiers appear in proofs. Verify clients can refresh engagement data. Verify zero-hash root remains active until 4B is confirmed.

---

### Cycle 5: Hardening & Cleanup

#### 5A — Deprecate two_tree_membership circuit (voter-protocol)
#### 5B — Community field proof verification (commons)
#### 5C — Tier 2→5 cellId reconciliation (commons)
#### 5D — UserRootRegistry automation (voter-protocol, depends on 0B)
#### 5E — Debate path fail-closed hardening (commons, finding F3)

Harden `arguments/+server.ts` and `cosign/+server.ts` to NOT set `serverVerified = true` when blockchain is misconfigured. Fail closed instead.

#### 5F — Demo mode delivery warning (commons, finding F7)

When `CWC_API_URL` is unset, log a warning AND set `deliveryStatus: "demo"` instead of `"delivered"`. Ensure UI distinguishes demo from real delivery.

#### 5G — Convert `updateMdlVerification` to internalMutation (brutalist R2 finding)

`convex/users.ts:updateMdlVerification` is a public `mutation` that patches `trustTier: 5` with no server-side mDL proof validation. Any authenticated user can call it directly via Convex client SDK with fabricated args. Convert to `internalMutation` and ensure it's only called from the SvelteKit mDL verification endpoint after `processMdocResponse()` succeeds.

#### 5H — Scope debate fail-closed to all 7 endpoints (brutalist R2 finding)

5E originally targeted only `arguments/+server.ts` and `cosign/+server.ts`. Expand to all debate endpoints with fail-open patterns: `create`, `commit`, `reveal`, `resolve`, `claim`.

---

**Review gate**: Full system audit. All proof paths verified or explicitly gated.

---

## Dependency Graph (Revised)

```
CYCLE 0 (immediate)
  S1, S2 ──────────────────────────────────────────────────┐
                                                            │
CYCLE 1 (contract state)                                    │
  3A → 3A-R → 3B ─────────────────────────┐                │
  3C ──────────────────────────────────────┤                │
  3D ──────────────────────────────────────┤                │
  3E ──────────────────────────────────────┤                │
                                           │                │
CYCLE 2 (verification wiring)              │                │
  2B (server-side verify) ←────────────────┤← S2            │
  2B-chain (on-chain verify) ←─────────────┘                │
  2C (nullifier check, fail-closed)                         │
  2D (status lifecycle) ←── 2B-chain                        │
  2E (gate promoteTier) ←── 2D ←── S1                      │
  2F (district cross-check) ←── 2B-chain                    │
                                                            │
CYCLE 3 (root refresh)                                      │
  0A → 1A → 1B → 1C                                        │
  0B                                                        │
                                                            │
CYCLE 4 (engagement)                                        │
  3F → 4A → 4B (needs 1B) → 4C                             │
                                                            │
CYCLE 5 (hardening)                                         │
  5A, 5B, 5C, 5D, 5E, 5F                                   │
```

### Critical Path (15 tasks to verified constituent messages)

```
S1, S2 (immediate) ──→ Cycle 1 review gate
3A → 3A-R → 3B ───────┐
3C ────────────────────┤
3D ────────────────────┼──→ Cycle 1 review gate ──→ 2B → 2B-chain → 2D → 2E
3E ────────────────────┘                            2C (parallel)    2F (parallel)
                                                    ──→ Cycle 2 review gate
```

---

## Resolved Questions

1. **Action domain scope**: CONFIRMED — `templateId` is in the hash. Resolution: use derived domains (3A-R option b).
2. **Root registration cadence**: Daily batches (~$1/month). Max 24h staleness. Refresh endpoint returns registered-root proofs.
3. **Verification boundary**: Hybrid — server-side verify in SvelteKit endpoint, on-chain verify via Convex→SvelteKit webhook callback.
4. **Proof refresh privacy**: Require authentication. Rate-limit. Return registered-root proofs only.
5. **Engagement root bootstrap**: Verify zero-hash against circuit test vectors before registering.
6. **Community field verification**: Deferred to Cycle 5. Lower priority than constituent messages.

---

## Engineering Domain Summary

| Domain | Tasks | Repo | Cycle |
|--------|-------|------|-------|
| Backend (immediate) | S1, S2 | commons | 0 |
| Contract Ops | 3A-R, 3B, 3C, 3D, 3E | voter-protocol | 1 |
| Ops/Analysis | 3A | commons | 1 |
| Backend (verification) | 2B, 2B-chain, 2C, 2D, 2E, 2F | commons | 2 |
| Protocol | 0A, 0B | voter-protocol | 3 |
| Client + Backend | 1A, 1B, 1C | commons | 3 |
| Ops | 3F | voter-protocol | 4 |
| Protocol + Client | 4A, 4B, 4C | both | 4 |
| Cleanup | 5A-5F | both | 5 |
