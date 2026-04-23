# Feature Documentation

**Feature implementation guides - what Commons actually implements (thin client).**

> ⚠️ **2026-04-23 audit — corrections:**
>
> - **`embeddings.md` link is broken** (reading-order section for
>   backend engineers). That content was merged into
>   `features/search.md`; point there instead.
> - **"Congressional email lookup (Hunter.io for template creators)"**
>   is not a shipped feature. Decision-maker enrichment uses a Gemini
>   agent pipeline + Firecrawl (`/api/agents/stream-decision-makers`).
>   No Hunter.io integration.
> - **Missing feature-gate banners.** `CONGRESSIONAL=false`,
>   `PASSKEY=false`, `DELEGATION=false`, `ENGAGEMENT_METRICS=false`
>   — items like "Congressional email lookup" (L~14) and
>   passkey-auth should carry `FEATURE-GATED` banners matching the
>   DEBATE row at L~145.
> - **"Token storage in database"** framing is stale — backend is
>   Convex-only.
> - **Terminology:** "Congressional email lookup" and "Congressional
>   delivery" refer to the same feature (flag-gated off either way);
>   standardize on "Congressional delivery" per
>   `docs/congressional/delivery.md`.

---

## Responsibility Separation

**Commons implements**:
- ✅ Template system (create, customize, moderate)
- ✅ OAuth authentication (Google, Facebook, Twitter, LinkedIn, Discord)
- ✅ UI for address collection
- ✅ Semantic search (Google Gemini embeddings)
- ✅ Congressional email lookup (Hunter.io for template creators)
- ✅ Universal sharing (navigator.share API)

**voter-protocol owns** (Commons just calls as thin client):
- ❌ District verification (Shadow Atlas, geocoding, Noir proofs)
- ❌ Merkle trees (built off-chain, published to IPFS)
- ❌ Smart contracts (Scroll zkEVM)
- ❌ Reputation tracking (ERC-8004 on-chain)

**See**: [integration.md](../integration.md) for complete architecture separation.

---

## Core Features (Start Here)

### 1. [templates.md](templates.md) - Template System

Variable extraction, customization, multi-agent content moderation.

**What it does**: Users create/customize message templates, AI agents moderate for quality.

**Dependencies**: None (core feature)

**Implementation**: Commons feature (not voter-protocol)

---

### 2. [template-variables.md](template-variables.md) - Template Variables

Variable syntax, auto-fill system variables, user-editable personalization fields.

**What it does**: `[Name]`, `[Representative]` auto-fill from profile; `[Personal Connection]` opens inline editor for user testimony.

**Dependencies**: templates.md

**Implementation**: Client-side resolution via `templateResolver.ts`

---

### 3. [creator.md](creator.md) - Template Creator

CodeMirror editor, jurisdiction picker, variable extraction UI.

**What it does**: Rich text editor for creating templates with jurisdiction targeting.

**Dependencies**: templates.md

**Implementation**: Commons UI (calls congressional email lookup)

---

## Authentication & Onboarding

### 4. [oauth.md](oauth.md) - OAuth Integration

Google, Facebook, Twitter, LinkedIn, Discord authentication. Token persistence and management.

**What it does**: Single sign-on, encrypted token storage, user can revoke anytime.

**Dependencies**: None

**Implementation**: Commons feature (token storage in database)

---

### 5. [onboarding.md](onboarding.md) - Progressive Onboarding

Progressive disclosure patterns, step-by-step user activation.

**What it does**: Gradual feature introduction, reduces cognitive load.

**Dependencies**: oauth.md

**Implementation**: Commons UI flow

---

## Discovery & Search

### 6. [search.md](search.md) - Semantic Search

Template discovery via semantic embeddings, natural language queries.

**What it does**: "Find templates about housing" → relevant templates ranked by semantic similarity.

**Dependencies**: Gemini embeddings (integrated)

**Implementation**: Commons feature (Google Gemini API integration)

---

### 7. [jurisdiction.md](jurisdiction.md) - Jurisdiction Targeting

Geographic targeting for templates (city council, state legislature, congressional district).

**What it does**: Templates can target specific elected officials by geography.

**Dependencies**: templates.md

**Implementation**: Commons feature (TemplateJurisdiction database model)

---

## Org Layer Features

### 8. [coordination-integrity.md](coordination-integrity.md) - Coordination Integrity Scores

Five metrics (GDS, ALD, temporal entropy, burst velocity, CAI) that measure whether campaign participation is organic and diverse. Appears on campaign dashboards, proof reports, and public verification pages.

**What it does**: Computes geographic diversity, message authenticity, timing patterns, action rate, and engagement depth — with k-anonymity privacy.

**Dependencies**: Campaign actions, supporter engagement tiers

**Implementation**: `src/lib/server/campaigns/verification.ts`

---

### 9. [live-updates.md](live-updates.md) - Live Updates Architecture

Campaign action SSE stream for real-time verification packet updates.

**What it does**: Server-Sent Events push verification packet changes to org dashboards every 30s.

**Dependencies**: `createSSEStream()` in `src/lib/server/sse-stream.ts`

**Implementation**: `/api/org/[slug]/campaigns/[campaignId]/stream` (P0 DONE), KV cache pending (P1)

---

### 10. [debates.md](debates.md) - Debate Markets

> STATUS: FEATURE-GATED (`DEBATE = false`)

LMSR-based debate markets where verified participants stake on SUPPORT/OPPOSE/AMEND with structured arguments.

**What it does**: Campaign-linked debates with AI evaluation, cosigning, resolution.

**Dependencies**: Debate smart contracts (voter-protocol), engagement tiers

**Implementation**: 9 Svelte 5 components, 6 API routes, debate-scoped ZK proofs

---

## Discovery & Advanced

### 11. Gemini Embeddings (integrated into search.md)

Google Gemini integration for semantic search and template discovery.

**What it does**: Generate vector embeddings for templates, enable semantic search via pgvector.

**Dependencies**: None (standalone service)

**Implementation**: Commons feature (Google Gemini API). See [search.md](search.md) for the full search pipeline including embeddings.

---

### 12. [sharing.md](sharing.md) - Universal Sharing

Native share API (mobile) + clipboard (desktop). Platform-agnostic sharing patterns.

**What it does**: One button shares everywhere (WhatsApp, Discord, Slack, Twitter, email, SMS).

**Dependencies**: templates.md

**Implementation**: Commons UI feature (navigator.share API)

---

### 13. [abstraction.md](abstraction.md) - Legislative Abstraction

Adapter pattern for different legislative bodies (US Congress, state legislatures, city councils).

**What it does**: Unified interface for delivering messages to any legislative body.

**Dependencies**: None (architecture pattern)

**Implementation**: Commons adapter layer (US Congress implemented, UK/EU planned)

---

## What Features Are NOT Here

**These are voter-protocol responsibilities** (NOT Commons features):

❌ **District verification** → voter-protocol provides `@voter-protocol/noir-prover`
- Shadow Atlas (Merkle trees, district boundaries)
- Geocoding services (Geocodio/Nominatim abstraction)
- Noir WASM proving (browser-native ZK proofs)
- See: `/docs/integration.md`

❌ **Reputation tracking** → voter-protocol smart contracts
- ERC-8004 on-chain reputation
- Multi-agent treasury management (Phase 2)
- Token rewards (Phase 2)
- See: `/docs/integration.md`

❌ **Blockchain infrastructure** → voter-protocol contracts
- Scroll zkEVM deployment
- DistrictRegistry.sol, DistrictGate.sol, HonkVerifier.sol
- See: voter-protocol repository

---

## Cross-References

**OAuth setup guide** → See `/docs/features/oauth.md`

**Database schema** → See `/docs/development/database.md`

**Congressional delivery** → See `/docs/congressional/delivery.md`

**Decision-maker enrichment pipeline** → See `/docs/specs/decision-maker-enrichment-pipeline.md`

**Privacy-preserving analytics** → See `/docs/specs/analytics/` (7 comprehensive docs)

**District verification (voter-protocol)** → See `/docs/integration.md`

---

## Implementation Status

| Feature | Status | Priority | Owner |
|---------|--------|----------|-------|
| templates.md | ✅ Complete | P0 (core) | Commons |
| creator.md | ✅ Complete | P0 (core) | Commons |
| oauth.md | ✅ Complete | P0 (core) | Commons |
| onboarding.md | ✅ Complete (includes decision-maker enrichment) | P0 (core) | Commons |
| jurisdiction.md | ✅ Complete | P1 | Commons |
| sharing.md | ✅ Complete | P1 | Commons |
| abstraction.md | ✅ Complete (US) | P1 | Commons |
| coordination-integrity.md | ✅ Complete | P0 (core) | Commons |
| live-updates.md | ✅ P0 done, P1 pending | P0/P1 | Commons |
| debates.md | ✅ Complete (FEATURE-GATED) | P2 | Commons |
| search.md | ✅ Complete | P2 | Commons |
| ~~embeddings.md~~ (merged into search.md) | ✅ Complete | P2 | Commons |
| **Decision-maker enrichment** | ✅ Complete (3-phase AI pipeline) | P0 (core) | Commons |
| **Privacy-preserving analytics** | ✅ Complete | P1 | Commons |
| **Multi-target delivery** | ✅ Complete | P0 (core) | Commons |
| **District verification** | ✅ Complete | P0 | **voter-protocol** |
| **Reputation tracking** | ✅ Complete | P0 | **voter-protocol** |

---

## Reading Order

**New developers**: templates.md → creator.md → oauth.md

**UX designers**: onboarding.md → sharing.md → search.md

**Backend engineers**: abstraction.md → embeddings.md → onboarding.md (decision-maker enrichment)

**Understanding voter-protocol integration**: See `/docs/integration.md` first

**Understanding blockchain integration**: See `/docs/integration.md`
