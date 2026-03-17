# Design Documentation

**Design system and voice for Commons.**

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

### [ORG-UX-AUDIT.md](ORG-UX-AUDIT.md) — Org Layer UX Audit (2026-03-17)

**Critical finding: the org layer implementation diverged from PERCEPTUAL-BRIDGE.md.** Multi-agent critique (Claude, Codex, Gemini) + adversarial debate. 13 findings, all validated. The interface makes verification a feature of a CRM instead of making CRM a consequence of verification. Read this before any org-layer work.

### [ORG-REDESIGN-THESIS.md](ORG-REDESIGN-THESIS.md) — Org Layer Redesign Direction

**The fix: invert the information hierarchy.** Every screen opens with proof/power/verification state, arrives at operational tools secondarily. Prioritized implementation plan (P0-P3). Derived from the audit findings + the original PERCEPTUAL-BRIDGE.md vision.

### [jurisdiction-ux-strategy.md](jurisdiction-ux-strategy.md) — Jurisdiction UX

**Plain language to structured geospatial data.** Agent-assisted jurisdiction assignment for template creators.

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
