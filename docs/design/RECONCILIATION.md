# Design Documentation Reconciliation

**Status:** Active reconciliation register
**Created:** 2026-04-30
**Scope:** Design-system, voice, product-surface, and UX-spec documentation

This document explains how to read Commons design docs when older specs,
aspirational specs, and shipped-code divergence banners disagree.

---

## Authority Order

Resolve conflicts in this order:

1. `docs/design/design-system.md` - visual philosophy, containment, typography, color, motion, and dimensional primitives.
2. `docs/design/voice.md` - product language, audience register, privacy copy, and primary-vs-popover detail.
3. `src/lib/design/DESIGN.md` - short agent/developer contract for implementation.
4. Shipped code plus explicit divergence banners - current implementation reality.
5. Feature specs - local intent. Aspirational specs do not override the design system unless they declare a scoped exception.

The design system is the constitution. Feature specs are case law. Divergence
banners are current-fact corrections.

---

## Settled Reconciliations

### 1. Global Semantic Color

Commons has three global semantic colors:

- Teal: routes, connections, active coordination
- Emerald: verified, delivered, proven
- Indigo: sharing, spreading, secondary actions

Local categorical palettes are permitted only when they classify local domain
taxonomy: topic neighborhoods, map fills, power levels, source types, party
indicators, or debate-local states. They must be redundant with shape, position,
or text and cannot style CTAs, verification, delivery, proof strength, or global
navigation.

### 2. Staffer-Facing Proof

`VERIFICATION-LEGIBILITY.md` governs recipient/staffer-facing packets. Reports,
proof pages, and acquisition specimens lead with:

- Verified constituent count
- Jurisdiction/geography
- Verification method
- Authorship/composition
- Timing/date range
- Deduplication

Do not headline engagement tier names (`Pillar`, `Veteran`, `Established`,
`Active`) or raw integrity scores (`GDS`, `ALD`, entropy, `CAI`) to recipients.
Those remain valuable internal/org audit metrics.

### 3. Engagement Depth

Engagement is a real dimension, but its audience is scoped. Use it for org
operations, debate weighting, rate limiting, platform analytics, and a person's
own civic record. Outside those contexts, translate it into plain behavioral
evidence or keep it in collapsed audit details.

### 4. Containment

Use the minimum visible structure needed to perceive, chunk, and act.

- Default: proximity and typographic hierarchy.
- Cards: bounded artifacts only, such as proof specimens, email previews,
  template objects, and addressable decision-maker objects.
- Radius: `rounded-lg` (8px) maximum for cards, `rounded` (4px) for inputs.
  Older specs that say `rounded-xl` or 12px radius normalize to 8px.
- White surfaces are artifacts, not generic layout containers.

### 5. Motion

Only coordination signals animate: send, share, count updates, route drawing,
and dimensional field transitions. Use `SPRINGS` from `$lib/design/motion`;
do not invent spring constants in specs or implementation.

### 6. Voice

Primary UI states what is. Technical mechanism belongs in popovers. Person-layer
surfaces use location names, templates, counts, and imperative actions; avoid
"campaigns" except in org-layer technical contexts.

---

## Reading Old Specs

When an older spec shows a useful structure with stale styling, preserve the
structure and normalize the styling. Examples:

- A 12px white card becomes an 8px `Artifact` or an `EntityCluster`, depending
  on whether the object is truly bounded.
- A blue/violet/amber action color becomes teal, emerald, or indigo unless the
  color is local categorical encoding.
- A report block that says `GDS 0.91` becomes staffer-legible geography or
  authorship language, with raw metrics in audit details.
- A person-layer "campaigns in your area" phrase becomes a location name or
  "templates" language.

Do not delete old specs just because they drift. Add reconciliation notes at the
top when their product idea remains useful but their implementation vocabulary
is stale.

---

## Implementation Checklist

Before building or reviewing a UI change:

- Read `src/lib/design/DESIGN.md`.
- Check whether the surface is person-facing, org-facing, acquisition, or
  recipient-facing.
- Ask whether each number has dimensions behind it.
- Use `Datum`, `Cite`, `Ratio`, `Pulse`, `Rings`, `Artifact`, and
  `EntityCluster` before inventing new presentation primitives.
- Keep raw audit metrics out of recipient headlines.
- Verify every color is either a global semantic color or a documented local
  categorical palette.

---

*Commons PBC | Design Documentation Reconciliation | 2026-04*
