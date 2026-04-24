# Commons Documentation Map

**Purpose:** Find what you need, fast. Every piece of information has ONE home.

---

## Quick Navigation

**"What's the current plan?"** → `strategy/product-roadmap.md`
**"What's the current status?"** → `implementation-status.md`
**"How does Commons work?"** → `architecture.md`
**"How does identity/trust work?"** → `architecture/graduated-trust.md`
**"How do I deploy?"** → `development/deployment.md` (Cloudflare Workers)
**"How do I integrate with voter-protocol?"** → `integration.md`
**"How does wallet / chain abstraction work?"** → `specs/chain-abstraction-architecture.md`
**"How do I build frontend features?"** → `frontend.md`
**"How do I test?"** → `development/testing.md`
**"Voice and design language?"** → `design/voice.md`
**"What changed and why?"** → `archive/2026-03-documentation-audit/DOCUMENTATION-AUDIT.md`

---

## Two Audiences, One Application

Commons serves **people** and **organizations** through the same platform.

**Person-facing** (verified civic speech): identity verification, spatial browse, postal bubble, power landscape, debate markets, proofs. A person uses commons.email to send a verified letter to their representative.

**Org-facing** (advocacy infrastructure): mass email, campaigns, list management, analytics, billing, multi-tenancy. An organization uses commons.email to mobilize supporters and deliver verified constituent signals at scale.

The org layer is what directly competes with Action Network, EveryAction, and Quorum — but it's built on top of the person layer, which none of them have.

---

## Core Documentation (root files)

| File | Purpose |
|------|---------|
| `README.md` | This documentation map |
| `archive/.../DOCUMENTATION-AUDIT.md` | Documentation health audit and cleanup tracker (completed 2026-03-09) |
| `implementation-status.md` | What's done, in progress, blocked |
| `architecture.md` | Commons/voter-protocol separation, privacy architecture |
| `integration.md` | CWC API, OAuth, voter-protocol, identity verification |
| `frontend.md` | SvelteKit 5, runes-based state, component patterns |
| `authority-levels.md` | Identity verification levels |
| `cryptography.md` | Cryptographic primitives reference |
| `shadow-atlas-integration.md` | Shadow Atlas: district lookup, ZK proofs, officials resolution |
| `authority-levels.md` | Redirect → `architecture/graduated-trust.md` |
| `WP-004-*.md` | Transaction safety whitepapers (3 files) |

---

## Folder Guide

### `strategy/` (10 files)
Business strategy, pricing, and launch planning.

**Start here:**
- `product-roadmap.md` — **Current plan.** Phase 1-3 feature sequence, key flows, competitive positioning
- `vision.md` — Product vision, design thesis, protocol layer diagram
- `economics.md` — Pricing tiers, unit economics, revenue projections

**Context:**
- `coordination.md` — Why coordination works, platform mechanics
- `organizing.md` — Phase 2+ organizing infrastructure strategy
- `viral.md` — Viral growth mechanics (Phase 1 partial, Phases 2-4 speculative)
- `delivery-verification.md` — TEE-based email verification roadmap
- `launch.md` — Historical: Jan 2025 launch planning
- `index.md` — Strategy reading guide

### `features/` (14 files)
Feature-specific documentation (person-facing).

- `templates.md` — Template system (creation, customization, moderation)
- `template-variables.md` — Variable syntax, auto-fill, authoring guide
- `creator.md` — Template creator UI (14 components, 3-agent SSE pipeline)
- `debates.md` — Debate markets (`DEBATE = true`, live as of 2026-04)
- `oauth.md` — OAuth provider flows
- `onboarding.md` — User onboarding flows
- `jurisdiction.md` — Jurisdiction system (TemplateJurisdiction model)
- `search.md` — Template search (Gemini `text-embedding-004` + Convex vector index)
- `sharing.md` — Sharing and social proof
- `abstraction.md` — Legislative body abstraction layer
- `coordination-integrity.md` — 5 coordination integrity metrics (GDS, ALD, entropy, burst, CAI)
- `live-updates.md` — Campaign SSE stream architecture
- `index.md` — Feature implementation guide

### `specs/` (18 files + analytics/)
Technical specifications and design docs.

**Core specs:**
- `agentic-civic-infrastructure.md` — Verified agentic civic action
- `chain-abstraction-architecture.md` — Wallet, signing, gas, funding layers
- `CAMPAIGN-ORCHESTRATION-SPEC.md` — Campaign lifecycle and delivery
- `IMPORT-SPEC.md` — Supporter import architecture
- `INTEGRATION-REMEDIATION-PLAN.md` — Multi-wave remediation plan
- `GEOGRAPHIC-IDENTITY-ROUTING.md` — District proof model
- `decision-maker-enrichment-pipeline.md` — Decision-maker discovery pipeline
- `LIST-NOTIFICATION-SPEC.md` — Supporter list and notification system
- `zk-proof-integration.md` — ZK proof integration phases

**Design specs (aspirational — not yet implemented):**
- `progressive-template-sections.md` — Template sectioning UX
- `POSTAL-BUBBLE-SPEC.md` — Postal bubble UI
- `POWER-LANDSCAPE-SPEC.md` — Power landscape visualization
- `SPATIAL-BROWSE-SPEC.md` — Spatial browsing interface
- `interactive-location-breadcrumb.md` — Location filter breadcrumb UI
- `location-picker-spec.md` — Location picker with autocomplete
- `proof-generation-ux.md` — Browser-native ZKP UX
- `subject-line-clarifying-questions.md` — Clarification UI design
- `universal-credibility.md` — Credential verification system

**Analytics specs** (`specs/analytics/`, 8 files): Differential privacy system — aggregation, coarsening, cohorts, noise, migration, hardening guide, k-ary randomized response.

**Other specs:**
- `INTELLIGENCE_PANEL_DESIGN_SPEC.md` — Intelligence panel component spec

### `development/` (17 files + integrations/)
Development workflows, guides, and testing.

- `deployment.md` — **Cloudflare Workers deployment** (wrangler, Convex, KV)
- `quickstart.md` — Getting started guide
- `database.md` — Convex schema (`convex/schema.ts`), deploy workflow, seeding
- `testing.md` — Integration-first test strategy
- `agents.md` — AI agent system (subject line, message writer, decision maker resolution)
- `moderation.md` — Content moderation pipeline (Llama Guard, prompt injection)
- `analytics.md` — Analytics system development
- `cron-setup.md` — Cron job configuration
- `flags.md` — Feature flag system
- `seeding.md` — Database seeding
- `maintenance.md` — Code quality standards
- `firecrawl-deployment-checklist.md` — Firecrawl provider deployment
- `index.md` — Development guide index
- `integrations/` — External service integrations (3 files)

### `architecture/` (11 files)
Architectural deep-dives.

- `graduated-trust.md` — Identity & trust tier architecture (Tiers 0-5) + authority levels
- `zk-prover-integration.md` — Browser WASM ZK prover integration
- `org-data-model.md` — Organization data model
- `platform-extension.md` — Org-facing platform architecture
- `rate-limiting.md` — Rate limiting (API routes, LLM quotas, circuit breakers, DP budget)
- `location-privacy.md` — Location intelligence privacy assessment
- `tee-systems.md` — TEE architecture
- `LOCATION-SIGNAL-ACCURACY-LIMITS.md` — Location signal accuracy matrix
- `civic-intelligence-cost-model.md` — Intelligence pipeline cost model
- `subscription-cost-model.md` — Subscription pricing model
- `decision-record.md` — Architecture decision log

### `design/` (20+ files + patterns/)
Design system, voice, architecture plans, and security hardening.

**Core design:**
- `design-system.md`, `voice.md`, `TYPOGRAPHY-SYSTEM.md` — Design system, voice, typography
- `PERCEPTUAL-BRIDGE.md` — Person/org layer design bridge
- `jurisdiction-ux-strategy.md` — Jurisdiction UX patterns
- `patterns/` — UX patterns (4 files): identity-verification, location-filtering, privacy-governance, template-discovery

**Architecture & intelligence:**
- `INTELLIGENCE-LOOP-PLAN.md`, `INTELLIGENCE-LOOP-DEPTH.md` — 6-phase DM intelligence loop
- `ACCOUNTABILITY-RECEIPT.md` — Proof-weighted DM tracking with cryptographic receipts
- `ORG-UX-AUDIT.md`, `ORG-REDESIGN-THESIS.md` — Org layer audit + redesign (COMPLETE)
- `SEAM-RESOLUTION-PLAN.md` — CongressionalRep→DecisionMaker migration (COMPLETE)

**Security:**
- `SECURITY-HARDENING-LOG.md` — 27 brutalist audit rounds, 180+ findings categorized

**Future plans:**
- `AUTOMATION-UI-PLAN.md`, `DEBATE-CAMPAIGN-PLAN.md`, `SMS-RENABLE-PLAN.md`, `CROSS-BORDER-PLAN.md`

**Index:** `index.md` — Full design documentation guide

### `research/` (6 files)
Research and analysis.

- `competitive-analysis.md` — Competitive landscape (AN, EveryAction, Quorum, NationBuilder)
- `action-network-migration-research.md` — AN data model and migration research
- `mdl-landscape-2026.md` — US mDL adoption status
- `tee-security.md` — TEE security analysis (AWS Nitro recommendation)
- `power-structures.md` — Multi-stakeholder power structure research (Phase 2+)
- `index.md` — Research index

### Other folders

| Folder | Files | Contents |
|--------|-------|---------|
| `congressional/` | 3 | Delivery system spec, congressional submit implementation, index |
| `adr/` | 5 | Architecture Decision Records (006, 007, 010, 011, WP-008) |
| `outreach/` | 2 | IACA gap tracker, request emails |
| `archive/` | 50+ | Superseded specs, completed migrations, historical planning, brutalist round docs |

---

## Information Ownership

| Topic | Home |
|-------|------|
| Current Plan & Timeline | `strategy/product-roadmap.md` |
| Implementation Status | `implementation-status.md` |
| Architecture | `architecture.md` |
| Identity & Trust Tiers | `architecture/graduated-trust.md` |
| Org Platform Extension | `architecture/platform-extension.md` |
| Agentic Civic Infrastructure | `specs/agentic-civic-infrastructure.md` |
| Chain Abstraction | `specs/chain-abstraction-architecture.md` |
| Intelligence Loop | `design/INTELLIGENCE-LOOP-DEPTH.md` |
| Security Hardening | `design/SECURITY-HARDENING-LOG.md` |
| Integration Remediation | `specs/INTEGRATION-REMEDIATION-PLAN.md` |
| Vision & Design Thesis | `strategy/vision.md` |
| Pricing & Economics | `strategy/economics.md` |
| Competitive Landscape | `research/competitive-analysis.md` |
| Deployment | `development/deployment.md` |
| Frontend | `frontend.md` |
| Features | `features/*.md` |
| Specs | `specs/*.md` |
| Development | `development/*.md` |
| Design | `design/*.md` |

**Principle:** Every piece of information has ONE home. No duplication.

---

*Commons | Documentation Map | 2026-03-19*
