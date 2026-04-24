# Architecture: Commons + voter-protocol

**Date:** 2026-03-19 (audited 2026-04-23)
**Status:** Production — commons.email deployed on Cloudflare Pages

> **⚠️ Known divergences from implementation (verified against `main`, 2026-04-23):**
> - **Backend:** Canonical schema lives in `convex/schema.ts` (~71 tables, 232 indexes). Field names are camelCase.
> - **Auth:** `FEATURES.PASSKEY = false` (`src/lib/config/features.ts:79`). Passkey / WebAuthn / did:key flows exist in code but no UI path activates them today.
> - **Identity providers:** self.xyz and Didit were retired in Cycle 15; mDL via the W3C Digital Credentials API is the sole active provider. OAuth (Google/Facebook/LinkedIn/Coinbase) still authenticates, but is not a verification provider.
> - **TEE:** AWS Nitro Enclave deployment is **Planned** per `docs/implementation-status.md:~113`. Witness encryption is scaffolded (`src/lib/core/proof/witness-encryption.ts` + `/api/tee/public-key`), but the enclave itself is not deployed. `LocalConstituentResolver` is the only active resolver. Debate-evaluation TEE is entirely unbuilt.
> - **Circuit:** The live circuit is `three_tree_membership`; `district_membership` is legacy / dead (see `voter-protocol/specs/CRYPTOGRAPHY-SPEC.md §11.1`).
> - **Gas / cost:** "~2.2M gas" and per-verification cost figures cited below are unverified estimates — no UltraHonk gas harness in `voter-protocol/contracts/test/`.
> - **Submission endpoint:** `/api/submissions/create` is correct and in place; any reference to `/api/congressional/submit` in sibling docs is stale.

---

## Executive Summary

**Commons** is the full-stack application for verified civic action. SvelteKit 5 frontend + API layer that orchestrates identity verification, campaign management, email delivery, and proof assembly. Deployed on Cloudflare Pages. Backend runs on **Convex**.

**voter-protocol** is the cryptographic infrastructure. Noir/UltraHonk zero-knowledge proofs, Shadow Atlas district trees, AWS Nitro Enclave encrypted delivery (planned), ERC-8004 reputation, smart contracts on Scroll zkEVM.

Together they form a system where every civic action carries a cryptographic proof of identity without revealing who you are.

---

## Separation of Concerns

### Commons (this repo)

- **SvelteKit 5 Frontend** — Runes-based state, SSR, Svelte 5 component architecture
- **Convex backend** — 71 tables in `convex/schema.ts`, ~180 functions, auth bridge via RS256 JWT → `ctx.auth.getUserIdentity()`
- **OAuth Auth** — Google, Facebook, LinkedIn, Coinbase (passkey / WebAuthn / did:key code exists but gated off via `FEATURES.PASSKEY = false`)
- **Identity Verification UI** — mDL via W3C Digital Credentials API (sole active provider; self.xyz and Didit retired Cycle 15)
- **Template System** — Creation, moderation (2-layer Llama Guard via Groq), customization
- **AI Agents** — DM discovery, message writer, subject line generation (Gemini API)
- **Org Layer** — Campaign management, email engine (SES), supporter management, billing (Stripe), events, fundraising, automation workflows, SMS/calling (Twilio), multi-org networks, public API v1
- **Verification Packets** — Coordination integrity scores (GDS, ALD, temporal entropy, burst velocity, CAI)
- **Browser Encryption** — XChaCha20-Poly1305 address encryption to TEE public key (scaffolded; enclave itself not deployed)
- **Intelligence Layer** — DecisionMaker entity, bill ingestion, activity feed, accountability receipts

### voter-protocol (sibling repo)

- **Noir ZK Circuits** — `three_tree_membership` (current) at depths 18/20/22/24 for 260K–16M leaves; `district_membership` is legacy / dead code
- **Browser WASM Prover** — Noir/UltraHonk compiled to WASM (600ms–10s proving)
- **Solidity Verifier** — On-chain UltraHonk proof verification (gas figures in this doc are unverified estimates — no harness)
- **AWS Nitro Enclaves** — TEE deployment for witness decryption — **Planned** (not deployed). Debate-evaluation TEE unbuilt.
- **CWC API Integration** — Congressional message delivery (planned to run inside TEE; currently via `LocalConstituentResolver`)
- **ERC-8004 Reputation** — On-chain reputation tracking with time decay
- **Smart Contracts** — DistrictGate, VerifierRegistry, UserRootRegistry, CellMapRegistry, NullifierRegistry, DistrictRegistry, CampaignRegistry
- **Shadow Atlas** — 94,166 districts, 24 boundary types, chunked IPFS (977 H3 chunks)

### What stays where

| Concern | Owner |
|---------|-------|
| UI, routing, SSR | Commons |
| Database, ORM, migrations | Commons |
| OAuth, sessions, RBAC | Commons |
| Campaign lifecycle, email, reports | Commons |
| Supporter CRM, billing, analytics | Commons |
| ZK circuits, provers, verifiers | voter-protocol |
| Smart contracts, blockchain | voter-protocol |
| TEE deployment, attestation | voter-protocol |
| Shadow Atlas, Merkle trees | voter-protocol |
| Geospatial data, district resolution | voter-protocol |

---

## Cypherpunk Principles

### Principle 1: Browser-Native ZK Proving

- Noir/UltraHonk circuits are production-ready in voter-protocol
- Browser WASM proving via `@voter-protocol/noir-prover` (600ms–10s)
- No server-side proving — cypherpunk-compliant
- Address never leaves browser — encrypted to TEE public key, destroyed after proving

### Principle 2: Session-Based Verification

```
FIRST TIME (one-time identity verification):
1. User verifies via mDL (Digital Credentials API)
2. Browser encrypts address to TEE public key (XChaCha20-Poly1305)
3. Encrypted blob stored in PostgreSQL (platform cannot decrypt)
4. TEE decrypts in isolated memory, geocodes to district
5. TEE generates session credential: "Verified constituent, TX-07"
6. Address DESTROYED (existed only in TEE memory)
7. Session credential cached on device (90-day absolute expiry)
8. User is now verified — no re-verification needed

SUBSEQUENT SENDS (using cached credential):
1. User selects template, adds personal story
2. Message content is PUBLIC (decision-makers read this)
3. User signs message with cached session credential
4. Platform verifies signature (proves valid session)
5. Moderation reviews PUBLIC content (2-layer Llama Guard)
6. Message delivered with verification proof
7. Decision-maker sees: PUBLIC message + proof sender is verified constituent
```

**What's Private:**
- Your address (verified once, cached as session credential)
- Your real identity (employer can't link pseudonymous ID)
- PII linkage (decision-maker can't Google your name)

**What's Public:**
- Message content (decision-makers READ this)
- Template adoption ("247 constituents sent variations")
- Community voice ("TX-07 cares about healthcare 34%")
- Verification status ("Verified constituent in TX-07")

**What's Pseudonymous:**
- Reputation score (on-chain, not linked to real identity)
- Message history (traceable to pseudonym, not to you)

### Principle 3: Encrypted Blob Storage

**Current (PostgreSQL):**
Encrypted blob stored in PostgreSQL — platform cannot decrypt (TEE private key never leaves enclave). XChaCha20-Poly1305 with X25519 ephemeral key exchange.

**Future (IPFS + On-Chain Pointer):**
Encrypted blob on IPFS, pointer on Scroll zkEVM. 99.97% cost reduction ($500/month → $10 one-time). Users own their blob — portable across platforms.

See `docs/specs/portable-identity.md` for full analysis.

---

## Privacy Architecture

### Data Boundaries

**Allowed in database:**
- Pseudonymous user IDs (deterministic from passkey)
- Email (OAuth login only)
- Verification status + method (`digital-credentials-api`)
- District hash (SHA-256 of congressional district — NOT plaintext)
- Session credential (cached verification, expires)
- Engagement tier (0–4, earned through civic participation)
- Trust tier (0–5, identity verification level)

**Forbidden (NEVER stored):**
- Plaintext address, city, state, zip, lat/long
- IP address, user agent, behavioral tracking
- Name, phone, PII linkage to real identity
- Trust/civic scores used for profiling

### What the Decision-Maker Sees

```
FROM: Verified Constituent (TX-07)
TIER: Veteran (3) — 18 months civic participation
VERIFICATION: mDL (Digital Credentials API)

MESSAGE:
[Public template content — plaintext]

Personal story:
"I'm a nurse at Memorial Hospital. I've seen firsthand..."

VERIFICATION PACKET:
- 248 verified constituents in your district
- Tier distribution: 12 Pillars, 43 Veterans, 89 Established, 104 Active
- GDS: 0.91 (geographic diversity)
- ALD: 0.87 (message authenticity)
- CAI: 0.73 (coordination authenticity)
```

**What the office DOESN'T see:** name, address, any PII, real-world identity linkage, browsing history or metadata.

**The Protection:**
- Employer can't Google your name and find your political messages
- Government can't link pseudonymous ID to real identity
- Decision-maker CAN read what you're saying (message content is PUBLIC)
- Moderators CAN review content quality (2-layer Llama Guard consensus)
- Community CAN see aggregate themes (privacy-preserving analytics with differential privacy)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ USER BROWSER (SvelteKit 5 Frontend)                              │
├─────────────────────────────────────────────────────────────────┤
│ 1. OAuth Login (Google/Facebook/LinkedIn/Coinbase/Passkey)       │
│ 2. Identity Verification UI (mDL via Digital Credentials API)    │
│ 3. Address Encryption (XChaCha20-Poly1305 to TEE public key)    │
│ 4. ZK Proof Generation (WASM Noir/UltraHonk prover, 600ms-10s) │
│ 5. Template Customization (PUBLIC content + personal story)      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ COMMONS BACKEND (Cloudflare Pages — SvelteKit API Routes)        │
├─────────────────────────────────────────────────────────────────┤
│ Person Layer:                                                    │
│ • Identity verification, ZK proof orchestration                  │
│ • Template CRUD, AI agents, congressional submission             │
│ • Encrypted blob storage, session management                     │
│                                                                  │
│ Org Layer:                                                       │
│ • Campaign lifecycle, email engine (SES), verification packets   │
│ • Supporter management, billing (Stripe), RBAC                   │
│ • Events, fundraising, automation, SMS/calling (Twilio)          │
│ • Public API v1, multi-org networks, geographic targeting        │
│                                                                  │
│ Intelligence Layer:                                              │
│ • DecisionMaker entity, bill ingestion, activity feed            │
│ • Accountability receipts, legislator scorecards                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ CONVEX (managed backend — convex.dev)                             │
├─────────────────────────────────────────────────────────────────┤
│ • ~71 tables, 232 indexes in `convex/schema.ts`                   │
│ • 180+ functions (queries, mutations, actions, HTTP actions)      │
│ • Convex vector index for semantic search (Gemini embeddings)     │
│ • submissions (ciphertext, proofBytes — platform cannot decrypt) │
│ • DecisionMaker + Institution (universal, multi-system identity) │
│ • Auth bridge: RS256 JWT (hooks.server.ts) → ctx.auth.getUser…() │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ VOTER-PROTOCOL SERVICES                                          │
├─────────────────────────────────────────────────────────────────┤
│ • Shadow Atlas (94,166 districts, chunked IPFS, 24 boundary      │
│   types, R-tree <50ms p95)                                       │
│ • Geocoding (Census Bureau + Geocodio)                           │
│ • District resolution (any level: federal → water district)      │
│ • Merkle tree registration + proof generation                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ AWS NITRO ENCLAVES (Trusted Execution Environment)               │
├─────────────────────────────────────────────────────────────────┤
│ 1. Fetch encrypted blob from PostgreSQL                          │
│ 2. Decrypt address inside hardware enclave (ARM Graviton)        │
│ 3. Address exists ONLY in TEE memory (never persisted)           │
│ 4. Call CWC API with plaintext address (inside enclave)          │
│ 5. Receive delivery confirmation                                 │
│ 6. ZERO all secrets (address destroyed)                          │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ SCROLL zkEVM (Ethereum L2 Settlement)                            │
├─────────────────────────────────────────────────────────────────┤
│ • UserRootRegistry (on-chain identity commitments)               │
│ • NullifierRegistry (double-action prevention)                   │
│ • DistrictGate (UltraHonk proof verifier, ~2.2M gas)            │
│ • ERC-8004 Reputation (time-decay, portable engagement tiers)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Two Product Layers

Commons serves **people** and **organizations** through the same platform, connected by verification.

### Person Layer (Verified Civic Speech)

A person uses commons.email to send a verified letter to their representative. The flow: identity verification (mDL) → ZK proof generated in browser → message composed → delivered with proof to decision-maker. Trust tiers (0–5) track identity verification depth. Engagement tiers (0–4) track civic participation, portable on-chain.

### Org Layer (Advocacy Infrastructure)

An organization uses commons.email to mobilize supporters and deliver verified constituent signals at scale. The flow: create campaign → supporters take verified action → verification packet assembles → org sends proof report to decision-maker. The decision-maker sees constituent count, tier distribution, coordination integrity scores.

The org layer competes directly with Action Network, EveryAction, and Quorum — but it's built on top of the person layer, which none of them have. Every org-layer feature carries verification context that no competitor can produce.

---

## The Reality-Based Narrative

**What we're solving:**
- Systematic pathway problem ([McDonald et al., 2020](https://doi.org/10.1080/19331681.2020.1740907) documented this)
- Signal-from-noise filtering (reputation + verification)
- Tool inadequacy (replace "painfully slow" databases with fast dashboard)
- Employment protection (subset who can't participate due to career risk)

**What we're NOT solving:**
- Lobbying money dominance ($4.4B corporate vs constituent voice)
- Representatives who genuinely don't care what constituents think
- Structural power imbalances in democracy

**The Honest Claim:**
> Congressional offices can't hear you. Not because they don't care, but because they can't verify you're real.
>
> Staff report most digital contact has minimal policy value ([McDonald et al., 2020](https://doi.org/10.1080/19331681.2020.1740907)). Staffers desperate for quality signals.
>
> We're building cryptographic verification that makes every civic action carry proof.
>
> Offices can finally identify constituent expertise.
> What they do with it is their choice.
>
> But we're removing the excuse that they can't find you in the noise.

**We're removing one bottleneck in a system with many bottlenecks.**

---

## References

| Topic | Document |
|-------|----------|
| Current implementation status | `docs/implementation-status.md` |
| Deployment guide | `docs/development/deployment.md` |
| Frontend patterns | `docs/frontend.md` |
| Integration (CWC, OAuth, mDL, TEE) | `docs/integration.md` |
| ZK proof integration | `docs/specs/zk-proof-integration.md` |
| Portable identity (Phase 2 IPFS) | `docs/specs/portable-identity.md` |
| Security hardening (27 rounds) | `docs/design/SECURITY-HARDENING-LOG.md` |
| Trust tiers & authority levels | `docs/architecture/graduated-trust.md` |
| voter-protocol architecture | `voter-protocol/ARCHITECTURE.md` |

---

*Commons | Architecture | 2026-03-19*
