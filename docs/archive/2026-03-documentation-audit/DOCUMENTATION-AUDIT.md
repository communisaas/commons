# Documentation Audit & Cleanup Plan

> commons.email — March 8, 2026
>
> 5-agent parallel audit of ~150 markdown files. Cross-referenced every doc against actual codebase, routes, schema, feature flags, and deployment config.

---

## Executive Summary

The product is well-built. The documentation tells three different stories depending on where you read:

1. **Strategy layer** describes a viral person-facing civic tool (Jan 2025 framing)
2. **Product roadmap** describes an org-facing verification platform replacing Action Network (Mar 2026 framing)
3. **Specs layer** describes advanced cryptographic infrastructure (ZK, debates, TEE) that's built but feature-gated

These aren't contradictions — they're the natural evolution of the product. But the docs haven't been synchronized to reflect that evolution. The voice is consistent (pragmatic cypherpunk, excellent). The structure is the problem.

**Additionally**: The `docs/README.md` documentation map references **12 files that don't exist**, the deployment docs point to the wrong platform, and multiple aspirational specs are indistinguishable from shipped features.

---

## Findings by Severity

### CRITICAL: Wrong or Broken

#### 1. README references 12 phantom files

`docs/README.md` (the documentation map) links to files that don't exist:

| Referenced File | Status |
|---|---|
| `docs/DOCUMENTATION-CLEANUP-PLAN.md` | Does not exist |
| `docs/features/identity-verification.md` | Does not exist |
| `docs/specs/portable-identity.md` | Does not exist (archived to `archive/2026-02-superseded/`) |
| `docs/specs/header-redesign.md` | Does not exist |
| `docs/specs/analytics-funnel.md` | Does not exist |
| `docs/design/ux-responsibilities.md` | Does not exist |
| `docs/design/colors.md` | Does not exist |
| `docs/design/motion.md` | Does not exist |
| `docs/architecture/progressive-precision.md` | Does not exist |
| `docs/congressional/dashboard.md` | Does not exist |
| `docs/strategy/launch-checklist.md` | Does not exist |
| `docs/strategy/beta-strategy.md` | Does not exist |
| `docs/implementation/current-work.md` | Does not exist |

**Impact**: Anyone using README.md as a navigation aid hits dead links immediately. Undermines the "every piece of information has ONE home" principle stated in the same file.

#### 2. Deployment docs point to wrong platform

The project deploys to **Cloudflare Workers** (confirmed: `wrangler.toml`, `svelte.config.js` adapter-cloudflare, `package.json` deploy script). These docs describe AWS:

| File | Problem |
|---|---|
| `docs/development/aws-deployment.md` | 210 lines of AWS Nitro Enclaves setup — completely unusable |
| `docs/development/deployment.md` | 16 lines, just links to `aws-deployment.md` |
| `DEPLOYMENT_CHECKLIST.md` | Actually a Firecrawl provider checklist, misleading filename |

**Impact**: New developer wastes hours following wrong deployment guide.

#### 3. TEE platform contradiction

Two docs recommend different TEE providers with no cross-reference:
- `docs/research/tee-security.md` → recommends **AWS Nitro** (ARM Graviton)
- `docs/strategy/delivery-verification.md` → references **GCP Confidential Space** (AMD SEV-SNP)

**Impact**: Phase 2 implementation has no clear decision on infrastructure.

---

### HIGH: Structurally Misleading

#### 4. Strategy index tells the wrong story

`docs/strategy/index.md` leads with `launch.md` (Jan 2025, 13 months stale) and doesn't reference `product-roadmap.md` (Mar 2026, the actual current plan). The two product layers — Person and Org — are acknowledged in `docs/README.md` but not in `strategy/index.md`.

**Result**: "Read these in order to understand Commons's strategic direction" sends readers to a 13-month-old plan first.

#### 5. Feature flags hide production-ready code, docs don't say so

The implementation verifier found massive working systems behind `false` flags:

```
FEATURES.DEBATE = false          // 52KB functional debate market code
FEATURES.CONGRESSIONAL = false   // Full CWC API integration
FEATURES.WALLET = false          // EVM + NEAR infrastructure
FEATURES.STANCE_POSITIONS = false // Models + API
```

Docs describe these as "built" or "production" without noting they're invisible to users. A reader of `docs/specs/CAMPAIGN-ORCHESTRATION-SPEC.md` or `docs/features/debates.md` would assume these are live.

#### 6. "Phase 1" means three different things

| Document | "Phase 1" means | Written |
|---|---|---|
| `strategy/launch.md` | 3-month startup sprint | Jan 2025 |
| `strategy/viral.md` | Shareable cards | Jan 2025 |
| `strategy/product-roadmap.md` | Verified Campaign Infrastructure | Mar 2026 |

No doc references the others. Timeline confusion is inevitable.

#### 7. Aspirational specs indistinguishable from shipped specs

These specs have no implementation but read identically to shipped specs:

| Spec | Status | Code exists? |
|---|---|---|
| `specs/progressive-template-sections.md` | ASPIRATIONAL | No |
| `specs/POSTAL-BUBBLE-SPEC.md` | ASPIRATIONAL | Backend only, no UI |
| `specs/POWER-LANDSCAPE-SPEC.md` | ASPIRATIONAL | No UI |
| `specs/SPATIAL-BROWSE-SPEC.md` | ASPIRATIONAL | Incomplete |
| `specs/interactive-location-breadcrumb.md` | ASPIRATIONAL | Static breadcrumb, not interactive |
| `specs/location-picker-spec.md` | ASPIRATIONAL | No Nominatim, static fallback |

**Impact**: Engineers can't tell what to build vs. what's already built.

---

### MEDIUM: Redundant or Misplaced

#### 8. Duplicate architecture docs

| Files | Overlap | Action |
|---|---|---|
| `architecture/graduated-trust.md` + `architecture/graduated-trust-implementation.md` | 95% overlap, same tier system | Consolidate |
| `shadow-atlas-integration.md` + `SHADOW-ATLAS-UNIFIED-BACKEND.md` | Same system, two perspectives | Consolidate |
| `strategy/roadmap.md` (template variables) vs. `features/templates.md` | Template variables documented in strategy | Move to features |

#### 9. Root-level cruft

These root-level `.md` files are implementation artifacts that belong in `docs/`:

| File | Recommendation |
|---|---|
| `ZK-PROVER-INTEGRATION-SUMMARY.md` | Move to `docs/implementation/` |
| `CONGRESSIONAL-SUBMIT-IMPLEMENTATION.md` | Move to `docs/implementation/` |
| `commons-desktop-a11y.md` | Investigate — likely abandoned |
| `E2E-TESTING-GUIDE.md` | Move to `docs/testing/` |
| `DEPLOYMENT_CHECKLIST.md` | Rename to clarify it's Firecrawl-specific |

#### 10. Self-marked superseded docs still in active directories

| File | Self-declares | Location |
|---|---|---|
| `docs/development/ownership.md` | "SUPERSEDED" in header | Still in active `development/` dir |
| `docs/specs/ALIEN-PROTOCOL-INTEGRATION-RESEARCH.md` | "PARTIALLY SUPERSEDED" | Still in active `specs/` dir |
| `docs/architecture/TECHNICAL-DEBT-AUDIT-2025-01.md` | Findings addressed in Wave 1-3 | Never updated post-remediation |
| `docs/architecture/REMAINING-GAPS.md` | Stale post-Wave-3 | Never refreshed |

---

### LOW: Polish and Accuracy

#### 11. Stale implementation status references

- `docs/strategy/coordination.md` — implementation status table marks items as "In Progress" that are now complete
- `docs/strategy/viral.md` — Phases 2-4 written as implementation instructions with file paths, but are speculative
- `docs/strategy/organizing.md` — reads as immediate roadmap, actually Phase 2+ (12-18 months)

#### 12. Missing documentation for built features

These are implemented with no dedicated docs:

| Feature | Code Location | Gap |
|---|---|---|
| Moderation system | `/api/moderation/check`, Groq Llama Guard | No doc on thresholds, appeals |
| AI agent infrastructure | `src/lib/core/agents/` | No cost model or tuning guide |
| Rate limiting | `src/hooks.server.ts`, KV-backed | No DDoS strategy doc |
| Location intelligence | `src/lib/core/location/` | No privacy/accuracy assessment |
| Email variable substitution | Email compiler | No template author guide |

---

## Ground Truth: What's Actually Shipped

From the Implementation Verifier agent — the reality against which all docs should be measured.

### Production-Active

| System | Evidence |
|---|---|
| **Org layer** (campaigns, supporters, email, RBAC) | Routes at `/org/[slug]/*`, full CRUD |
| **mDL identity verification** | COSE-Sign1, IACA roots, VICAL caching, 8665 LOC |
| **Action Network sync** | OSDI v2 client, incremental import, dedup |
| **Email delivery** | SES backend, bounce tracking, unsubscribe |
| **Embeddable campaign widget** | `/embed/campaign/[slug]`, postMessage API |
| **Template system** | CRUD, variables, moderation, jurisdiction scoping |
| **Analytics with differential privacy** | Budget enforcement, Laplace noise, snapshots |
| **Congressional delivery (CWC)** | Senate + House API, encrypted storage |
| **OAuth** | Google, Facebook, LinkedIn, Coinbase, passkeys |
| **Cloudflare Workers deployment** | Hyperdrive, ALS, KV namespaces |

### Built but Feature-Gated (DEBATE/CONGRESSIONAL/WALLET/STANCE = false)

| System | Status |
|---|---|
| **Debate markets** | LMSR on Scroll Sepolia, full UI, AI evaluation |
| **Congressional routing UI** | CWC integration complete, UX review pending |
| **Wallet integration** | EVM + NEAR providers, EIP-712 signing |
| **Stance registration** | DB models, API endpoints, no UI |
| **ZK proof generation** | Browser WASM prover, witness building |

### Documented but Unbuilt

| System | Notes |
|---|---|
| **TEE message delivery** | Deferred to voter-protocol monorepo |
| **Mainnet blockchain deployment** | Testnet only |
| **Multi-agent treasury** | Phase 2 |
| **Shadow Atlas IPFS pinning** | Dev/test only |
| **Portable identity (IPFS)** | Spec archived |
| **Gamification (badges, leaderboards)** | Speculative |

---

## Execution Plan

### Wave 1: Fix What's Broken ✅ COMPLETE (2026-03-08)

Stop the bleeding. Fix the README, deployment docs, and the most misleading structural issues.

**1.1 — Fix `docs/README.md`** ✅
- Removed all 12 phantom file references
- Rewrote folder descriptions against actual file inventory
- Established `strategy/product-roadmap.md` as canonical timeline reference
- Updated file counts, dates, and navigation structure

**1.2 — Fix deployment docs** ✅
- Archived `docs/development/aws-deployment.md` → `docs/archive/2026-03-documentation-audit/`
- Rewrote `docs/development/deployment.md` — now describes Cloudflare Workers (wrangler, Hyperdrive, KV, ALS, secrets, constraints)
- Renamed `DEPLOYMENT_CHECKLIST.md` → `docs/development/firecrawl-deployment-checklist.md`

**1.3 — Archive self-declared dead docs** ✅
- Moved `docs/development/ownership.md` → archive (self-marked SUPERSEDED)
- Moved `docs/specs/ALIEN-PROTOCOL-INTEGRATION-RESEARCH.md` → archive (self-marked SUPERSEDED)
- Moved `docs/architecture/TECHNICAL-DEBT-AUDIT-2025-01.md` → archive (findings addressed)
- Moved `docs/architecture/REMAINING-GAPS.md` → archive (stale post-Wave-3)

**1.4 — Relocate root-level cruft** ✅
- `ZK-PROVER-INTEGRATION-SUMMARY.md` → `docs/implementation/zk-prover-integration.md`
- `CONGRESSIONAL-SUBMIT-IMPLEMENTATION.md` → `docs/implementation/congressional-submit.md`
- `E2E-TESTING-GUIDE.md` → `docs/testing/e2e-testing-guide.md`
- `commons-desktop-a11y.md` → archived (Playwright a11y tree snapshot, zero references in src/)

**1.5 — Fix broken references (found during review)** ✅
Review cycle found 10 broken internal references from moved/archived files. All fixed:
- `docs/development/index.md` — removed dead sections 8 (aws-deployment) and 10 (ownership), fixed cross-ref links
- `docs/research/index.md` — updated aws-deployment ref → deployment.md (Cloudflare Workers)
- `docs/implementation-status.md` — 3 REMAINING-GAPS.md refs → product-roadmap.md or removed
- `docs/integration.md` — CONGRESSIONAL-SUBMIT ref → new path; REMAINING-GAPS ref → mdl-landscape-2026.md
- `docs/architecture.md` — ZK-PROVER-INTEGRATION-SUMMARY ref → new path
- `docs/architecture/graduated-trust-implementation.md` — REMAINING-GAPS ref → mdl-landscape-2026.md
- `docs/adr/010-analytics-system-consolidation.md` — TECHNICAL-DEBT-AUDIT ref → archive path
- `docs/adr/WP-008-house-cwc-delivery-fix.md` — TECHNICAL-DEBT-AUDIT ref → archive path
- `docs/specs/INTEGRATION-REMEDIATION-PLAN.md` — 3 refs to moved/archived files → new paths
- `docs/testing/e2e-testing-guide.md` — 2 dead links → new implementation/ paths
- `docs/implementation/zk-prover-integration.md` — self-reference updated

**New finding during Wave 1:**
- `docs/development/index.md` lines 144-150 still reference phantom cross-ref files (`/docs/architecture/tee.md`, `/docs/INTEGRATION-GUIDE.md`, `/docs/FRONTEND-ARCHITECTURE.md`). Fixed to correct paths during this wave.

### Wave 2: Structural Coherence — PARTIALLY COMPLETE (2026-03-08)

Make the strategy layer tell one coherent story.

**2.1 — Rewrite `docs/strategy/index.md`** ✅
- Leads with `product-roadmap.md` as the current plan
- Names the two product layers explicitly (Person Layer + Org Layer)
- Marks `launch.md` as historical context
- Links to `economics.md` and `competitive-analysis.md`
- Marks `organizing.md` as Phase 2+ (12-18 months post-launch)

**2.2 — Add status headers to aspirational specs** ✅
Added `> STATUS: ASPIRATIONAL` callout to 6 unimplemented specs:
- `specs/progressive-template-sections.md` ✅
- `specs/POSTAL-BUBBLE-SPEC.md` ✅
- `specs/POWER-LANDSCAPE-SPEC.md` ✅
- `specs/SPATIAL-BROWSE-SPEC.md` ✅
- `specs/interactive-location-breadcrumb.md` ✅
- `specs/location-picker-spec.md` ✅

Added `> STATUS: FEATURE-GATED` to:
- `features/debates.md` ✅
- `specs/analytics/dp-hardening-guide.md` ✅

**2.3 — Consolidate redundant docs** ✅ COMPLETE (2026-03-09)
- [x] `graduated-trust.md` + `graduated-trust-implementation.md`: Added "Implementation Progress" summary table to architecture doc (15 cycles). Archived implementation journal to `archive/2026-03-documentation-audit/`. Updated refs in README.md, implementation-status.md.
- [x] `shadow-atlas-integration.md` + `SHADOW-ATLAS-UNIFIED-BACKEND.md`: Merged into single `shadow-atlas-integration.md` covering ZK proofs + officials resolution + implementation status. Archived UNIFIED-BACKEND to archive. Updated refs in README.md, graduated-trust.md.
- [x] `strategy/roadmap.md` → `features/templates.md`: Moved Phase 2 data provider vision into templates.md "Future: Data Provider Integration" section. Archived roadmap.md. Updated refs in strategy/index.md, README.md, flags.md (3 refs).

**2.4 — Resolve TEE platform conflict** ✅
- Decision confirmed: **AWS Nitro Enclaves** (ARM Graviton)
- `strategy/delivery-verification.md` already correct (says AWS Nitro on line 9)
- Fixed `features/templates.md` line 51: "GCP Confidential Space" → "AWS Nitro Enclaves"
- Fixed `architecture/graduated-trust.md` line 420: marked GCP provider as dead code to remove
- `research/tee-security.md` correctly recommends AWS Nitro (no change needed)
- Remaining GCP references are in archived docs or in tee-security.md's comparison table (correct context)

### Wave 3: Freshness Pass ✅ COMPLETE (2026-03-08)

Update stale content across strategy, feature, and development docs.

**3.1 — Strategy doc freshness** ✅
- `strategy/launch.md` — added `STATUS: HISTORICAL` header, points to `product-roadmap.md` and `index.md`
- `strategy/coordination.md` — added `STATUS: HISTORICAL` header, annotated implementation status table as outdated with note on what shipped since, updated footer
- `strategy/viral.md` — added `STATUS: SPECULATIVE` callouts to Phases 2-4, marked growth model and implementation roadmap sections as speculative
- `strategy/organizing.md` — already had Phase 2+ header from Wave 2 ✅
- `research/power-structures.md` — added `STATUS: RESEARCH AGENDA` header, links to product-roadmap.md

**3.2 — Feature doc accuracy** ✅
- `features/templates.md` — fixed delivery step (TEE not implemented, marked Phase 2; on-chain marked feature-gated); fixed 3 stale cross-reference links (FRONTEND-ARCHITECTURE, INTEGRATION-GUIDE, DEVELOPMENT)
- `features/creator.md` — verified accurate, no changes needed
- `features/oauth.md` — verified accurate (updated 2026-01-31), no changes needed

**3.3 — Development doc cleanup** ✅
- `development/quickstart.md` — fixed 5 stale cross-references (INTEGRATION-GUIDE intro, Resources section, Next Steps section)
- `development/index.md` — fixed "For New Developers" section (FRONTEND-ARCHITECTURE, CYPHERPUNK-ARCHITECTURE → correct paths)
- `development/integrations/aws-lambda-workers.md` — added clarifying header (Lambda for CWC delivery, not app hosting; links to deployment.md)

**3.4 — Broken reference sweep (found during review)** ✅
Review cycle found 17 additional broken references across 12 files. All fixed:
- `docs/frontend.md` — 3 fixes (TEMPLATE-SYSTEM, INTEGRATION-GUIDE, DEVELOPMENT → correct paths)
- `docs/specs/universal-credibility.md` — 2 fixes (CYPHERPUNK-ARCHITECTURE, PHASE-1-REPUTATION → correct paths)
- `docs/specs/zk-proof-integration.md` — 3 fixes (PROGRESSIVE-VERIFICATION, CYPHERPUNK-ARCHITECTURE, UNIVERSAL-CREDIBILITY → correct paths)
- `docs/strategy/delivery-verification.md` — 1 fix (INTEGRATION-GUIDE → integration.md)
- `docs/features/index.md` — 2 fixes (INTEGRATION-GUIDE → integration.md)
- `docs/research/index.md` — 1 fix (CYPHERPUNK-ARCHITECTURE → architecture.md)
- `docs/implementation/congressional-submit.md` — 2 fixes (ZK-IMPLEMENTATION, CYPHERPUNK-ARCHITECTURE → correct paths)
- `docs/congressional/index.md` — 2 fixes (INTEGRATION-GUIDE → integration.md, tee.md → tee-systems.md)
- `docs/WP-004-transaction-safety-implementation.md` — 2 fixes (CYPHERPUNK-ARCHITECTURE, ZK-IMPLEMENTATION → correct paths)

### Wave 4: Fill Gaps ✅ COMPLETE (2026-03-09)

Document what's built but undocumented.

**4.1 — Write missing docs for shipped features** ✅
1. [x] Rate limiting — expanded `architecture/rate-limiting.md` with API route limits (18 routes, sliding window, 429 headers), LLM cost protection tiers, external API circuit breakers. Existing analytics DP content preserved under nested headings.
2. [x] AI agents — wrote `development/agents.md`: three-agent architecture (subject line, decision maker, message writer), Gemini 3 Flash config, SSE streaming, cost model per-operation, per-user quotas by trust tier, error handling.
3. [x] Moderation — wrote `development/moderation.md`: two-layer automated pipeline (Prompt Guard + Llama Guard 4), blocking vs non-blocking hazards, integration points (template creation, agent streams, personalization), intentional omissions (no admin dashboard, no appeals — by design).
4. [x] Template variables — wrote `features/template-variables.md`: bracket syntax, system variables (auto-fill from profile/district), user-editable variables (inline editors), resolution logic, authoring guide for template creators.
5. [x] Location privacy — wrote `architecture/location-privacy.md`: five-signal progressive inference, client-side storage architecture, privacy boundaries (mDL, ZK, CWC), data flow diagram, risk analysis with mitigations, multi-country support.

**4.2 — Cloudflare deployment guide** ✅ (already complete from Wave 1)
`development/deployment.md` already covers all listed items: Wrangler config, Hyperdrive, KV namespaces, secrets, build→deploy→rollback, monitoring, key constraints.

**Index updates**: README.md (file counts, new entries), development/index.md (agents + moderation sections), features/index.md (template-variables entry).

---

## Verification Checklist

After all waves, verify:

- [x] `docs/README.md` links resolve to real files (zero 404s) — ✅ Wave 1
- [x] Every aspirational spec has a STATUS callout — ✅ Wave 2 (8 specs tagged)
- [x] `strategy/index.md` leads with `product-roadmap.md` — ✅ Wave 2
- [x] No doc in active directories self-declares as "SUPERSEDED" — ✅ Wave 1
- [x] Deployment docs describe Cloudflare Workers (not AWS) — ✅ Wave 1
- [x] No root-level implementation `.md` files remain — ✅ Wave 1
- [x] TEE platform decision is consistent across all docs — ✅ Wave 2.4 (AWS Nitro confirmed)
- [x] "Phase 1" has a single canonical meaning (from `product-roadmap.md`) — ✅ Wave 2
- [x] Historical/speculative strategy docs have STATUS callouts — ✅ Wave 3 (5 docs tagged)
- [x] Feature docs match current implementation — ✅ Wave 3 (templates fixed, creator/oauth verified)
- [x] Cross-references use canonical file paths — ✅ Wave 3 (17 broken refs fixed across 12 files)
- [x] Remaining specs get STATUS callouts (SHIPPED/FEATURE-GATED/ASPIRATIONAL/VISION) — ✅ Final pass (10 specs tagged)
- [x] Doc consolidation (graduated-trust, shadow-atlas, roadmap) — ✅ Wave 2.3
- [x] Missing docs written for shipped features — ✅ Wave 4 (5 docs: rate limiting, agents, moderation, template variables, location privacy)

---

## What's Working Well (Don't Touch)

These were verified as accurate, coherent, and well-maintained:

- **Voice**: `design/voice.md` — consistently applied everywhere
- **Design system**: `design/design-system.md` — colors, typography, components
- **Product roadmap**: `strategy/product-roadmap.md` — the authoritative plan
- **Research**: `competitive-analysis.md`, `mdl-landscape-2026.md`, `action-network-migration-research.md` — all current (within 3 days)
- **Economics**: `strategy/economics.md` — tight financial modeling
- **Vision**: `strategy/vision.md` — north star, accurate
- **ADRs**: All 5 current and well-structured
- **Planning summaries**: All 18 phase summaries have commit verification
- **Code-embedded docs**: Agent provider architecture (README, ARCHITECTURE, QUICK_START)
- **Core architecture**: `architecture.md`, `org-data-model.md`, `rate-limiting.md`
- **Database**: `development/database.md`
- **Testing**: `development/testing.md`
- **Cron**: `development/cron-setup.md`

---

*Audit methodology: 5 parallel agents (specs/architecture, strategy/research, dev/operations, planning/embedded, implementation verifier) reading all 150 markdown files and cross-referencing against codebase, routes, schema, feature flags, and deployment config.*
