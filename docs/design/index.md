# Design Documentation

**Design system, voice, architecture plans, and security hardening for Commons.**

---

## Start Here

### [design-system.md](design-system.md) — The Design System

**Philosophy, color, typography, motion, components.**

Start here. Everything else references this.

### [voice.md](voice.md) — Voice & Language

**How Commons speaks.** Pragmatic cypherpunk. Direct. No corporate speak.

### [TYPOGRAPHY-SYSTEM.md](TYPOGRAPHY-SYSTEM.md) — Typography Implementation

**Satoshi + JetBrains Mono.** Font loading, Tailwind classes, migration guide.

### [PERCEPTUAL-BRIDGE.md](PERCEPTUAL-BRIDGE.md) — Person Layer / Org Layer Bridge

**How one verified action appears in three worlds.** The design philosophy connecting the person-facing experience (built) to the org-facing experience (building). Read this before designing any org-layer surface.

### [ORG-UX-AUDIT.md](ORG-UX-AUDIT.md) — Org Layer UX Audit (COMPLETE)

Multi-agent critique found the org layer diverged from PERCEPTUAL-BRIDGE.md — built CRM patterns instead of verification-first. 13 findings, all validated. Redesign completed 2026-03-17.

### [ORG-REDESIGN-THESIS.md](ORG-REDESIGN-THESIS.md) — Org Layer Redesign (COMPLETE)

Inverted information hierarchy: proof/power/verification state leads every screen. 18 tasks, 4 review gates, all passed. The canonical reference for org-layer design philosophy.

### [jurisdiction-ux-strategy.md](jurisdiction-ux-strategy.md) — Jurisdiction UX

**Plain language to structured geospatial data.** Agent-assisted jurisdiction assignment for template creators.

---

## Intelligence & Accountability

### [INTELLIGENCE-LOOP-PLAN.md](INTELLIGENCE-LOOP-PLAN.md) — Decision-Maker Intelligence Loop

**The 6-phase feedback loop: monitor → alert → mobilize → deliver → track → score.** Implemented 2026-03-17/18. Phases A-F with 3 review gates. Federal + state bill ingestion, pgvector relevance, SES delivery tracking, vote correlation, per-DM scorecards.

### [INTELLIGENCE-LOOP-DEPTH.md](INTELLIGENCE-LOOP-DEPTH.md) — Intelligence Loop Depth Expansion

**From campaign-scoped to relationship-scoped.** Canonical Representative entity, bill full-text search, org→DM follow/watch, activity feed, org discovery. The missing layers that make this an intelligence platform rather than a campaign tool with analytics.

### [ACCOUNTABILITY-RECEIPT.md](ACCOUNTABILITY-RECEIPT.md) — Proof-Weighted Decision-Maker Tracking

**What did the decision-maker do given what they provably knew?** Cryptographic accountability receipts: proof weight, temporal causality chains, SHA-256 attestations, cross-org proof pressure, Merkle anchoring. Implemented 2026-03-17.

---

## Completed Architecture Plans

### [SEAM-RESOLUTION-PLAN.md](SEAM-RESOLUTION-PLAN.md) — Seam Resolution (COMPLETE)

3 seams, 19 tasks, 3 review gates. CongressionalRep→DecisionMaker migration, batch ingestion optimization, debate integration.

### [PROCEED-PLAN.md](PROCEED-PLAN.md) — Post-Redesign Work (COMPLETE)

Usage enforcement (6 surfaces), OG images, campaign SSE stream, report hints, /about/integrity page.

### [SECURITY-HARDENING-LOG.md](SECURITY-HARDENING-LOG.md) — Security Hardening Log

27 rounds of brutalist security auditing. 180+ findings across PII projection, input validation, authorization, race conditions, authentication, and infrastructure. Comprehensive accepted risk register.

---

## Future Plans

### [AUTOMATION-UI-PLAN.md](AUTOMATION-UI-PLAN.md) — Automation UI (~695 LoC)
### [DEBATE-CAMPAIGN-PLAN.md](DEBATE-CAMPAIGN-PLAN.md) — Debate Integration (~5 days)
### [SMS-RENABLE-PLAN.md](SMS-RENABLE-PLAN.md) — SMS Re-enablement (~6 hours + TCPA)
### [CROSS-BORDER-PLAN.md](CROSS-BORDER-PLAN.md) — Cross-Border Coalitions (~5 weeks, Canada first)

---

## UX Patterns

Specific solutions for common design challenges.

### [patterns/location-filtering.md](patterns/location-filtering.md)

Location as filter, not category. Progressive precision. No "campaigns in."

### [patterns/template-discovery.md](patterns/template-discovery.md)

Template browsing, filtering, recommendation UX.

### [patterns/privacy-governance.md](patterns/privacy-governance.md)

Privacy-preserving governance UI. Zero-knowledge patterns.

### [patterns/identity-verification.md](patterns/identity-verification.md)

Identity verification flows. "Stealthily cypherpunk."

---

## Quick Reference

**"What color should this be?"**
- Teal — Routes, connections, active coordination
- Emerald — Verification, delivery confirmed
- Indigo — Sharing, spreading, secondary actions

**"Satoshi or Mono?"**
- Satoshi — Words
- Mono — Numbers

**"Should this animate?"**
- Yes — Coordination signals (send, share, count update)
- No — Everything else

**"Does this language work?"**
- No: campaigns, issues, community, platform, solutions, empower
- Yes: Send. Coordinate. Verify. Location names. Counts.

---

## For Developers

1. Read [design-system.md](design-system.md)
2. Check [TYPOGRAPHY-SYSTEM.md](TYPOGRAPHY-SYSTEM.md) for implementation
3. Reference [patterns/](patterns/) for specific UX solutions

## For Designers

1. Read [design-system.md](design-system.md) — Philosophy and standards
2. Read [voice.md](voice.md) — Writing style
3. Check the standard: "Does this make coordination feel heavier?"

---

*Commons | Design Documentation | 2026-03*
