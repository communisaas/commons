# Commons Design System

**Civic Proof.**

---

## Authority

This document is the canonical design contract for the reference implementation of Commons. When docs conflict, resolve them in this order:

1. `CONSTITUTION.md` (root) — the design constitution promulgated by `docs/record/vol-1/issue-1.md`. Nine principles in three layers. Supreme authority for the reference implementation.
2. `docs/design/design-system.md` (this document) — visual philosophy, generative axes, typography, color, motion, structural primitives.
3. `src/lib/design/DESIGN.md` — short agent/developer contract that implements this document.
4. Shipped code plus explicit divergence banners for current implementation reality.
5. Feature specs for local intent. Aspirational specs do not override the constitution or this document unless they declare a scoped exception.

`docs/design/voice.md` is **SUPERSEDED** by `CONSTITUTION.md` §3.3 (plain English) effective with the publication of `docs/record/vol-1/issue-1.md` on 2026-05-06. It is retained for historical reference and is not in the authority chain.

Feature specs may define local patterns, but they cannot redefine the global visual vocabulary. If an older spec says `rounded-xl`, uses a non-core color as a semantic action/status color, or headlines a platform-internal metric to a recipient, normalize it back to this contract.

---

## The Generative Framework

The reference implementation is governed by **nine principles**, codified in `CONSTITUTION.md`, organized in three layers:

**Substrate** — what holds plurality together
1. The mathematics is the only authority (`CONSTITUTION.md` §1.1)
2. Federation by default (§1.2)
3. Permanence over product cycles (§1.3)

**Artifact** — every entry in the public record is an artifact
4. Verifiable or honestly interpretive (§2.1)
5. Information has shape; express the shape (§2.2)
6. The cryptographic substrate is visible as registry marks (§2.3)

**Commons** — how plurality coexists
7. Plurality encoded, not curated (§3.1)
8. Decision-makers and constitutional moments share the substrate (§3.2)
9. Plain English (§3.3)

These nine principles produce every visual decision through two derived axes — one generative, one structural.

### Axis 1 — Dimensional causation (generative)

> **Every visual variation cites a substrate entity, and its rendering is governed by the entity's dimensions or proof state — not by a designer's hierarchy preference.**

For any variation in scale, position, motion, density, color emphasis, or composition, name:
1. The substrate entity it cites.
2. The citizen dimension (geography / time / identity / voice / engagement) or proof state (verified / pending / expired / revoked) that drives it.

If both cannot be named, the variation is unauthorized. This is the rule that distinguishes controlled chaos from decorative chaos. Without it, principle 5 ("information has shape") collapses into ornament and principle 7 ("plurality encoded, not curated") collapses into stylistic posture.

This axis is invariant. It applies to every surface regardless of content state.

### Axis 2 — Content state (structural)

> **Surfaces vary by content state on a single spectrum: settled artifact ⇄ active field. The same primitives, register, prohibitions, and voice apply at both ends. Only occupancy density varies.**

**Settled artifacts** are closed-and-hashed: the constitution, the verification packet, the receipt, errata, audit records, the finalized coalition charter. Their content is one entity in one state. They collapse to a single ledger column with generous margins. No multi-region composition.

**Active fields** are open-and-living: the homepage masthead, the debate index, the atlas activity overlay, the public DM activity stream. Their content is many entities cited at once. They expand to multi-region composition where the same dimensions that govern Axis 1 drive scale, position, and motion.

A constitution should not look like a homepage. A homepage should not look like a constitution. Both should read as expressions of the same system. A surface that needs to communicate both states (an artifact-of-record nested in a coalition's living operating page) renders the artifact in settled mode inside an active-field frame.

### How the framework cashes out at the visual layer

"248 verified" is not a number. It is a compression of geography (where those people are), time (when they acted), identity depth (how strongly they're verified), and voice (whether they composed or echoed). Rendering it as three digits in a monospace font expresses one dimension — quantity — and erases the rest. The design system's job is to make the erased dimensions available.

- **Typographic register = epistemic status.** JetBrains Mono for verifiable claims — counts, scores, dates, hashes, district codes. Anything a third party could audit. Satoshi for interpretive context — explanations, descriptions, calls to action, editorial framing. The reader learns, without being told, which parts of the surface are proven and which are contextual. (Principle 4.)
- **Numbers are compressions, not endpoints.** "248 verified constituents" is backed by a geographic distribution, a temporal arrival pattern, an identity tier structure, and an authorship texture. The scalar is the headline. The dimensions behind it are the story. Both must be accessible. (Principle 5.)
- **Dimensions are visual, not textual.** A geographic distribution is a spatial field, not "GDS: 0.94." A temporal pattern is a rhythm, not "14 days." An identity composition is a depth gradient, not "104 gov ID, 89 address." If a dimension can be felt as shape, show the shape. Text descriptions of dimensions are a design failure. (Principle 5.)
- **The cryptographic substrate is always visible.** Hashes, nullifiers, Merkle roots, signatures, and version anchors appear in margins and footers as marks of the substrate, not behind copy. The reader of any artifact can find the cryptographic facts that hold the artifact together without leaving the artifact. The `<RegistryMark>` primitive expresses this. (Principle 6.)
- **The warm cream ground says "institution."** Content sits ON the ground, not IN white boxes. White is reserved for bounded artifacts — the proof specimen, the email preview — objects that need to float above the ground plane.
- **Borders earn their place.** A hairline rule between the specimen and contextual copy says "these are different registers." A border around a card says "this is a bounded object." Borders that say nothing are decoration. Kill them.

---

## The Design Language: Civic Proof

The aesthetic of infrastructure that knows what it can prove. Warm, not cold. Precise, not flashy. Confident enough to leave space empty.

The visual identity is the proof specimen — the verification packet rendered as a navigable information space. Not a text document with label-value pairs. An object with dimensions: a geographic field showing where constituents are, a temporal rhythm showing when they acted, an identity stratigraphy showing how deeply they're verified, an authorship texture showing whether they composed or echoed. These dimensions are primary. The scalars (counts, scores, percentages) are summaries that compress them — useful headlines, but not the information itself.

The specimen is the centerpiece — not because we decided it should be, but because when you remove everything that isn't verifiable or necessary, the specimen is what remains. And when you look at the specimen honestly, it is not a flat report. It is multi-dimensional civic evidence that a decision-maker should be able to *inhabit* — rotating between geography, time, identity, and voice to understand the signal.

The closest analog: not a government report — a weather station. Radar showing geographic spread. Pressure gradients showing temporal momentum. Stratification showing depth. A meteorologist doesn't read the weather as a table of numbers. They read it as interacting fields. A staffer reading a verification packet should feel the same thing: not "248" but the spatial, temporal, and social dimensions that produced 248.

---

## Philosophy

Commons is civic infrastructure for verified voice. One person writes to a decision-maker. Their identity is verified. Their message arrives. Others join. The coordination accumulates weight.

The design system exists to make civic action feel **real**.

Every pixel answers one question: **does this make the action feel real?**

"Real" means three things simultaneously:
- **For the sender:** conviction — my message carries proof, is directed at a specific person, and will arrive
- **For the collective:** substance — the coordination numbers have gravity, not decoration
- **For the recipient:** credibility — this sender is verified, and I can check

---

## What We Are

Civic infrastructure. The design feels like a navigable information space — where verified civic action has geographic extent, temporal rhythm, identity depth, and compositional texture. Every dimension is expressible. Every compression is honest about what it erased.

**We design for conviction, not momentum. Credibility, not polish. Gravity, not weight.**

---

## The Five Dimensions

Every verified action has five dimensions. The design system must express all of them — not as scalars, but as fields.

### Geography — WHERE

Each action comes from a place. A district. A community. The geographic dimension is a spatial distribution, not a count. "47 districts" is a compression. The field — which districts, how dense, where the gaps are — is the information. Express it as spatial weight: density gradients, proportional segments, coverage patterns. A staffer should see at a glance whether the signal comes from one neighborhood or spans their entire district.

Data: per-action `districtHash` → `geography: DistrictWeight[]` on the packet.
Primitives: `Ratio` (proportional bar), future geographic map component.

### Time — WHEN

Each action has a timestamp. The temporal dimension is a rhythm, not a date range. "14 days" is a compression. The shape — early adopters, then a surge, then steady accumulation — is the story. Express it as a pulse: the arrival cadence, the momentum, the organic-vs-manufactured pattern. A campaign that built over two weeks feels different from one that spiked in an hour. Both say "248." Only the temporal dimension shows the difference.

Data: per-action `sentAt` → `temporal: TemporalField` (hourly bins) on the packet.
Primitives: `Pulse` (sparkline rhythm). Scalars derived: `temporalEntropy`, `burstVelocity`.

### Identity — HOW DEEP

Each action carries a trust tier: unverified, email, address, government ID. The identity dimension is a stratigraphy, not four buckets. Express it as depth: concentric rings that fill as verification deepens. The deeper the identity, the stronger the signal. A packet with 200 email-only and 48 gov-ID-verified has a different identity topology than one with 248 gov-ID. Both say "248 verified." Only the identity dimension shows the difference.

Data: per-action `trustTier` → `identityBreakdown` + `tiers[]` on the packet.
Primitives: `Rings` (concentric depth glyph), `Ratio` (identity composition bar).

### Voice — WHAT THEY SAID

Each action has an authorship mode: individually composed, template-shared, edited. The voice dimension is a compositional texture, not two counts. 200 individually composed messages carry different weight than 200 copies of the same template. Express it as texture: the ratio of original to echoed, the diversity of message hashes, the spread of compositional effort.

Data: per-action `messageHash` + `compositionMode` → `authorship` + `ald` on the packet.
Primitives: `Ratio` (composed vs shared).

### Engagement — HOW COMMITTED

Each action carries an engagement tier: new, active, established, veteran, pillar. The engagement dimension is a depth distribution, not a single ratio (CAI). Express it as accumulated weight: how many people have deep, sustained, multi-campaign participation vs first-time actors. A campaign backed by 12 pillars and 43 veterans feels different from one backed by 248 first-timers.

Data: per-action `engagementTier` → `tiers[]` + `cai` on the packet.
Primitives: `Rings` (tier depth), tier distribution bars.

**Audience scope:** Engagement depth is real, but it is not a default staffer-facing trust claim. Use engagement for org operations, debate weighting, rate limiting, platform analytics, and the individual's own civic record. Decision-maker packets should lead with constituency, identity verification method, authorship, geography, timing, and deduplication. If engagement appears outside internal/org contexts, translate it into plain behavioral evidence ("12 supporters with 2+ years sustained engagement") or move it into collapsed audit details. Do not headline `Pillar`, `Veteran`, `GDS`, `ALD`, entropy, or CAI to recipients.

### Cross-Dimensional Interaction

Dimensions are not independent. Geography × Time = "where did the surge come from?" Identity × Geography = "are the gov-ID-verified people concentrated or spread?" Voice × Time = "did the individual compositions come first, then the template echoes?"

When the design system matures, dimensional primitives should cross-filter: hover on a geographic cluster → the temporal Pulse highlights when that cluster acted → the identity Rings show the depth of that cluster. This is how an information space becomes navigable — by making the dimensions talk to each other.

---

## Color

Three global semantic colors. No other global semantic colors.

```css
/* Semantic */
--teal-route: rgba(59, 196, 184, 0.9);    /* #3BC4B8 — Routes, connections, active coordination */
--indigo-share: rgba(79, 70, 229, 0.9);   /* #4F46E5 — Sharing, spreading, secondary actions */
--emerald-verified: #10b981;               /* Delivery confirmed, identity verified */

/* Surfaces */
--surface-base: oklch(0.995 0.004 55);     /* Warm cream — the institutional ground */
--surface-artifact: #ffffff;               /* Bounded objects that float: specimens, email previews */
--surface-node: rgba(255, 255, 255, 0.9);  /* Node cards in RelayLoom visualization */
--border-node: rgba(148, 163, 184, 0.45);  /* Subtle node borders */

/* Text */
--text-primary: #0f172a;                   /* Slate-900 */
--text-secondary: #475569;                 /* Slate-600 */
--text-muted: #94a3b8;                     /* Slate-400 */
```

Teal for routes. Indigo for sharing. Emerald for verification. **No other global semantic colors.** Violet, purple, blue as action/status/proof accent colors are prohibited — they fragment the vocabulary. If you reach for violet as a product semantic, ask whether the element is a route (teal), a share (indigo), or a verification signal (emerald). It's always one of the three.

**Scoped exceptions:**
- **Local categorical palettes** — permitted when color classifies a local domain taxonomy, not product semantics. Examples: Spatial Browse topic neighborhoods, map country fills, power-level categories, source-type categories in intelligence panels. These palettes must be confined to the component/spec, redundant with shape/position/text, and unavailable for CTAs, verification status, delivery status, proof strength, or global navigation.
- **Debate subsystem** — violet is permitted within `src/lib/components/debate/` as an AI-reasoning / evaluation-phase signal. It separates AI-contributed outputs (machine scores, AI evaluation phase) from human deliberation (amber) and semantic verdicts (emerald/red/amber). This is subsystem-local vocabulary, not a global semantic. Prohibited outside the debate subsystem.
- **Party indicators** — purple for Independent is a political convention, not a design decision. Permitted on representative/decision-maker indicators only.
- **Email shell (`src/lib/server/email/`)** — emails render in clients we do not control (Outlook, Gmail, Apple Mail, dozens of mobile clients) where warm cream surfaces drift toward pink/peach under client-imposed colour adjustments. The email shell uses a dark cabinet palette (`#09090b` outer, `#18181b` card, `#27272a` border, `#d4d4d8` body text) for cross-client predictability and to read as "from the platform" against an inbox of arbitrary-coloured messages. The embedded verification block uses muted slate tones inside that cabinet for high-contrast staffer reading on phone. This is a register-rule, not a free choice — outside `src/lib/server/email/` the canonical warm-cream substrate applies. The compose preview deliberately renders inside the same dark shell so authors see what recipients see.

---

## Typography

### The System: Satoshi + JetBrains Mono

**Satoshi (Words)** — Headlines, UI copy, buttons, CTAs, body text, navigation. Geometric but warm. Not corporate bland (Arial, Helvetica). Not crypto tacky (Poppins).

**JetBrains Mono (Numbers)** — Counts, metrics, codes, timestamps, technical data. Tabular figures align. Numbers tick like scoreboards. Technical credibility.

### The Rule

**Words in Satoshi. Numbers in Mono.**

If it's a word, use Satoshi. If it's a number, use JetBrains Mono.

```svelte
<!-- Location + count -->
<h1 class="font-brand text-2xl font-bold">California</h1>
<p class="font-mono text-sm font-medium">47 coordinating</p>

<!-- Template metrics -->
<span class="font-mono tabular-nums font-bold">1,247</span> sent
<span class="font-mono tabular-nums">94</span> districts

<!-- District code -->
<span class="font-mono text-lg font-bold">CA-11</span>
```

### Weights

**Satoshi:**
- **700 (Bold)** — Headlines, emphasis, CTAs
- **500 (Medium)** — UI elements, labels, navigation
- **400 (Regular)** — Body text, descriptions

**JetBrains Mono:**
- **700 (Bold)** — Large numbers, hero metrics
- **500 (Medium)** — Emphasized counts
- **400 (Regular)** — Standard metrics

### Tailwind Classes

```html
<!-- DEFAULT: Satoshi for all text -->
<p>This uses Satoshi by default</p>

<!-- EXPLICIT: Use brand font (Satoshi) -->
<h1 class="font-brand">Coordination Infrastructure</h1>

<!-- DATA: Use mono font for metrics -->
<span class="font-mono tabular-nums">1,247</span>
```

### Size Scale

```css
--text-xs: 0.75rem / 1rem;      /* 12px / 16px */
--text-sm: 0.875rem / 1.25rem;  /* 14px / 20px */
--text-base: 1rem / 1.5rem;     /* 16px / 24px */
--text-lg: 1.125rem / 1.75rem;  /* 18px / 28px */
--text-xl: 1.25rem / 1.75rem;   /* 20px / 28px */
--text-2xl: 1.5rem / 2rem;      /* 24px / 32px */
--text-3xl: 1.875rem / 2.25rem; /* 30px / 36px */
--text-4xl: 2.25rem / 2.5rem;   /* 36px / 40px */
```

**Minimum sizes:**
- Body text: 16px (1rem) — WCAG AA compliance, prevents iOS zoom on input
- Small text: 14px (0.875rem)
- Micro text: 12px (0.75rem) — use sparingly

### Font Loading Performance

**Target:** <100ms FOIT (Flash of Invisible Text)

**Strategy:**
1. **Preload** critical fonts (Medium, Bold) in `<head>`
2. **font-display: swap** prevents invisible text, shows fallback immediately
3. **Self-hosted Satoshi** eliminates external DNS lookup
4. **WOFF2 format** provides best compression (30-50% smaller than WOFF)

**Location:** `/static/fonts/satoshi/` (Satoshi-Regular.woff2, Satoshi-Medium.woff2, Satoshi-Bold.woff2)

**JetBrains Mono:** Via Google Fonts with `display=swap` for reliable CDN and subset optimization

---

## Motion

### What Gets Animated

**Coordination signals:**
- Paper plane flight (Button.svelte) — Message leaving
- Particle burst (ShareButton.svelte) — Template spreading
- Count increment — Numbers ticking up with spring physics
- Route flow (RelayLoom.svelte) — Edges drawing on load
- Dimensional transitions — fields filling, rhythms drawing, rings expanding

**Nothing else.** Privacy badges don't animate. Forms don't animate. Cards hover-lift slightly, that's it.

### The Physics

Canonical spring configs live in `$lib/design/motion.ts`. Named by semantic purpose:

```typescript
import { SPRINGS } from '$lib/design/motion';

SPRINGS.COUNT_TICK   // { stiffness: 0.2, damping: 0.8 }  — scoreboard numbers
SPRINGS.METRIC       // { stiffness: 0.15, damping: 0.8 } — dashboard panels
SPRINGS.DEPARTURE    // { stiffness: 0.08, damping: 0.85 } — message leaving
SPRINGS.SCORE_BAR    // { stiffness: 0.3, damping: 0.85 }  — bar fills
SPRINGS.SIGNAL       // { stiffness: 0.06, damping: 0.75 } — slow growth
SPRINGS.ENTRANCE     // { stiffness: 0.25, damping: 0.85 } — panel slide-in
```

Never invent new spring params. Import from `$lib/design/motion`.

Numbers should tick like scoreboards — weighted, inevitable. Not bouncy or playful.

### Dimensional Motion

Temporal rhythm IS motion. A `Pulse` sparkline doesn't just show a shape — the shape itself encodes tempo, momentum, and organic vs manufactured timing. When a Pulse draws on load, the eye traces the arrival cadence. This is motion without animation: the shape communicates dynamics.

### Performance Budget

- Max 3 animated elements per viewport
- GPU-accelerated only (transform, opacity)
- `prefers-reduced-motion` respected

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Spatial Rhythm: The Primary Structural Tool

Figure-ground without cards. Entities are text clusters, not containers.

### The Proximity Ratio

Internal spacing within an entity must be dramatically tighter than the void between entities. When the ratio is 1:4 or more, the visual system chunks each cluster as a unit — no border needed.

```
Entity (tight cluster)          ← name + title + action, 4-8px internal gaps
                                ← 40px of composed silence
Entity (tight cluster)          ← next cluster
```

The void IS the boundary. It has positive shape — defined by the clusters above and below.

### Typographic Topography

Entity names at text-xl (20px) create **topographic peaks** on the continuous surface. Your eye hops from peak to peak when scanning. Everything between peaks (titles, actions) is valley — detail you dip into when you've found the entity you want.

```svelte
<!-- Peak: the entity IS this name -->
<h4 class="text-xl font-bold font-brand">Chuck Grassley</h4>
<!-- Valley: subordinate, tight to name -->
<p class="mt-0.5 text-sm text-slate-500">Chair, Senate Judiciary Committee</p>
<!-- Latent: activates on hover -->
<span class="text-sm text-slate-400 group-hover:text-teal">Write to them</span>
```

### Containment Policy

Use the minimum structure the task requires for the user to perceive, chunk, and act. Every container must earn its place.

- **Proximity ratio** — the default. Entity lists, form sections, metric displays, settings groups. No borders, no backgrounds, no cards. Tight internal spacing (4-8px), generous void between clusters (32-48px). The void IS the boundary.
- **Cards** — ONLY for bounded artifacts. The email preview IS a card (it's a document). A template card IS a card (it's a browsable object). The proof specimen IS a card (it's evidence). A list of supporters is NOT a card. A settings section is NOT a card. A metric display is NOT a card.
- **`rounded-xl` (12px)** — prohibited. Civic infrastructure has edges. Use `rounded-lg` (8px) sparingly for actual cards. `rounded` (4px) for inputs. Nothing for typographic layouts. If an older feature spec says 12px radius, normalize to 8px unless a shipped shared primitive explicitly owns a different radius.
- **`shadow-sm` on static elements** — prohibited. Shadow means "this floats above the ground plane." If nothing is below it, the shadow is lying. Reserve shadow for overlays, dropdowns, and modals — things that genuinely occlude content below them.
- **`bg-white` containers** — prohibited as a default wrapper. The warm cream ground (`--surface-base`) is the surface. Content sits on it. White (`--surface-artifact`) is reserved for artifacts that need to feel like documents placed on a desk.
- **Pill badges** (`rounded-full bg-{color}-50 text-{color}-700 text-xs px-2 py-0.5`) — prohibited. Replace with typographic annotations: mono text at reduced size, no background, no border. The information is in the words, not the container.
- **Borders** — hairline rules between register changes (the specimen and its context, role groups in a list). Not `border border-slate-200` on every container.
- **Background shifts** — reserved for interactive states (hover, active), not resting state.

### Action Affordances

Action links are latent at rest (slate-400) and activate on hover (teal). The chevron appears with the color. This means the entity feels like information at rest and becomes interactive when you engage. No hover backgrounds — the text itself activates.

## Components

### RelayLoom (Person-Layer Visualization)

RelayLoom shows coordination as a graph — people and targets connected by message routes. It appears on the person-layer homepage. It is a visualization component, not the visual identity. The visual identity is the proof specimen (see "The Design Language" above).

### Nodes (RelayLoom + Template Browser)

The node card is the visualization unit. White with slight blur, subtle border, soft shadow. Used in RelayLoom and template browser cards — contexts where items are browsable objects.

```css
.node {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 8px;    /* rounded-lg — the maximum for cards */
  backdrop-filter: blur(4px);
  box-shadow:
    inset 0 1px 6px rgba(0, 0, 0, 0.08),
    0 20px 50px -28px rgba(15, 23, 42, 0.45);
}
```

Note: Node cards are bounded artifacts (browsable objects) — cards are permitted here per the containment policy. The shadow is earned because nodes float above the RelayLoom canvas.

### Buttons

```svelte
<!-- Primary action: Teal route color -->
<Button variant="verified" enableFlight={true}>
  Send to Congress
</Button>

<!-- Secondary action: Indigo share color -->
<Button variant="primary">
  Send to Decision-Makers
</Button>
```

The paper plane animation is sophisticated. Keep it. It's earned.

### Edges (Connection Lines)

SVG paths with stroke-dasharray animation. Draw on load, then static.

```css
.edge {
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.12));
}

/* Teal for routes to targets */
.edge-route { stroke: rgba(59, 196, 184, 0.9); }

/* Indigo for share connections */
.edge-share { stroke: rgba(79, 70, 229, 0.9); }
```

---

## Voice

The voice register is **plain English**, per `CONSTITUTION.md` §3.3. Sentences a fourteen-year-old reads without help. No marketing superlatives. No emotional manipulation. No cypherpunk performance. Honest about what the system does and does not do.

The supersession is recorded in `docs/record/vol-1/issue-1.md` §B *Editorial note: voice register supersession* (2026-05-06). The prior register documented in `docs/design/voice.md` ("Direct. Specific. Institutional.") is retained for historical reference and is not the operative guide.

### What this means in practice

- **State what is, plainly.** "Issues in CA-11" beats both "Find campaigns in your area" (marketing) and "Civic-action templates filtered by user-resolved district" (technical density).
- **Honest about gaps.** When the system does not yet do something, say so. The constitution itself models this with "Currently observed / Currently absent" gap markers in §1, §2, §3.
- **Plural, not directive.** Plain English serves all readers — civic staffers, citizens, designers, auditors, and future maintainers reading at a thirty-year horizon. No reader population is privileged.
- **Imperative is permitted, not required.** "Send. Coordinate. Verify." is fine when an action is being requested. Imperative is one tone the voice can take, not the voice itself.

### What we don't say

- Marketing fillers: empower, solutions, engagement (as a verb), platform, community, content
- Hype superlatives: revolutionary, the only, perfect, finally
- Cypherpunk performance: trustless, sovereign, immutable (without explanation), cryptographic (as boast)

### What we do say

- Send. Coordinate. Verify.
- Locations stand alone: "California" / "CA-11"
- Counts speak for themselves: "847 sent this"
- Plain naming of state: "verified" / "pending" / "expired" / "revoked"

---

## Accessibility

Non-negotiable.

### Contrast

WCAG AA minimum. Body text 4.5:1, large text 3:1.

```css
/* These pass on warm cream (oklch 0.995 0.004 55) — contrast ratios similar to white */
color: #0f172a; /* on cream: ~16.5:1 */
color: #10b981; /* emerald on cream: ~3.1:1 (large text only) */
/* On artifact white (#fff), ratios are marginally higher */
```

### Focus States

Visible rings. High contrast.

```css
:focus-visible {
  outline: none;
  ring: 2px solid var(--indigo-share);
  ring-offset: 2px;
}
```

### Touch Targets

44px minimum. No exceptions.

### Reduced Motion

Already covered. All animations respect `prefers-reduced-motion`.

---

## Structural Primitives (`$lib/design/`)

The design philosophy is encoded as components. Import from `$lib/design`. See `$lib/design/DESIGN.md` for the agent-readable decision tree. All primitives are governed by Axis 1 (dimensional causation) and apply at both ends of Axis 2 (content state).

### Register Layer
- **`Datum`** — Verifiable numeric claim. Always JetBrains Mono + tabular-nums. Optional spring animation, optional cite provenance. The font IS the truth claim.
- **`Cite`** — Contextual provenance. Four forms: whisper (materializes on hover), mark (dotted underline), footnote (collects at Artifact bottom), ghost (aria-only). Provenance should be visual (use dimensional primitives inside), not textual.

### Substrate Layer
- **`RegistryMark`** — Cryptographic substrate visible as a mark, per `CONSTITUTION.md` §2.3. Eight variants (sha256, nullifier, merkle-root, signature, version, commit, block, tag) × full or truncate display × span/button/anchor element. Always JetBrains Mono with tabular-nums. Click-to-copy copies the FULL value regardless of truncation. Aria-label decodes variant + value + interaction. Lives in margins and footers, not behind copy.

### Dimensional Layer
- **`Ratio`** — Composition as color proportion. A segmented bar showing what a count is made of. **Citation:** 3-5px. **Display:** 12-24px. No labels. For identity breakdown, authorship texture, geographic distribution.
- **`Pulse`** — Temporal rhythm as sparkline. A smooth curve showing when things happened. **Citation:** 56×12px default. **Display:** 120-400×32-120px (stroke width and padding auto-scale with height; pass `strokeWidth` to override). For arrival cadence, momentum patterns.
- **`Rings`** — Depth/tier as concentric glyph. **Citation:** 14-16px. **Display:** 48-128px (stroke and ring spacing auto-scale). Shows how deep verification goes. The TrustTierIndicator at any scale.

> All four dimensional primitives — `Ratio`, `Pulse`, `Rings`, `EntityCluster` — serve both ends of Axis 2 (citation ⇄ display) without forking the API. The same component is used at both scales: stroke widths, padding, and ring spacing scale automatically with size; `EntityCluster` exposes `density="display"` (80px gap) for active-field hero spacing. Display-scale typography is achieved at the call site via Tailwind text-5xl through text-9xl — see `docs/design/TYPOGRAPHY-SYSTEM.md` §Display Scale.

### Spatial Layer
- **`Artifact`** — Bounded white object that earns card treatment. Proof specimens, email previews, templates. Provides footnote context for Cite footnotes. The only surface where `bg-white` is permitted.
- **`EntityCluster`** — Proximity-ratio layout. The void IS the boundary. Densities: `tight` (24px), `default` (32px), `spacious` (48px), `display` (80px, active-field hero spacing). No borders.

### Motion Layer
- **`SPRINGS`** — Six canonical spring configs. See Motion section above.
- **`COORD_COLORS`** — The three semantic colors as JS constants.
- **`TIMING`** — CSS transition durations (150/220/320ms).

---

## Decision Rules

### "Is this visual variation authorized?" (Axis 1 — dimensional causation)

For every variation in scale, position, motion, density, color emphasis, or composition, name:
1. The substrate entity it cites.
2. The citizen dimension (geography / time / identity / voice / engagement) or proof state (verified / pending / expired / revoked) that drives it.

If both cannot be named, the variation is unauthorized. Remove it. This is the rule that distinguishes controlled chaos from decorative chaos.

### "What is the content state of this surface?" (Axis 2 — settled ⇄ active)

If the surface is **settled** (closed-and-hashed: constitution, verification packet, receipt, errata, audit record, finalized coalition charter) — collapse to a single ledger column. One entity. One state. Generous margins. No multi-region composition.

If the surface is **active** (open-and-living: homepage masthead, debate index, atlas activity overlay, public DM activity stream) — expand to multi-region composition. Many entities cited at once. Composition density is data-driven (Axis 1 governs).

A surface that needs to communicate both states (artifact-of-record nested in a living operating page) renders the artifact in settled mode inside an active-field frame.

### "Is this hash, nullifier, signature, or version anchor?"

→ Use `<RegistryMark>` from `$lib/design`. Per `CONSTITUTION.md` §2.3, registry marks live in margins and footers as marks of the substrate, not behind copy. Don't card-chrome them.

### "Does this number have dimensions behind it?"

**If yes**, express them. Use Ratio (composition), Pulse (time), Rings (depth). Prefer visual shape over text description. A scalar with its dimensions hidden is an incomplete rendering.

### "Should this animate?"

**Yes** if it's a coordination signal (send, share, count update, dimension transition) — and the variation passes Axis 1 (a substrate event drives it).
**No** if it's anything else. Hover scale transitions, scroll-triggered fade-ins, gradient sweeps fail Axis 1 regardless of how they look.

### "What color?"

**Teal** — Routes, connections, active coordination
**Emerald** — Verification, delivery confirmed
**Indigo** — Sharing, spreading, secondary actions

### "Satoshi or Mono?"

**Satoshi** — Words, explanations, citations (interpretive)
**Mono** — Numbers, dates, hashes, district codes (verifiable)
**Mono via `<RegistryMark>`** — Verifiable cryptographic strings (not numeric counts)

### "Text or shape?"

If the information is a composition → **Ratio** (color proportion, not "40% gov ID").
If the information is temporal → **Pulse** (rhythm, not "14 days").
If the information is depth → **Rings** (strata, not "T3: 12").
If you're writing a sentence that describes what a visual could show, you've chosen wrong.

---

## The Standard

When reviewing design work, ask:

1. **Does this make the action feel real?** — conviction for the sender, substance for the collective, credibility for the recipient
2. **Are the dimensions expressed or erased?** — Can I feel WHERE, WHEN, HOW DEEP, and WHAT WAS SAID? Or just see a count?
3. Is the animation communicating information or just decorating?
4. Would this work if we removed all color except teal and emerald?
5. Can you scan this surface by hopping between typographic peaks?
6. **Does this feel honest?** — does every element earn its place? Is every compression acknowledged?
7. **Could a staffer inhabit this information?** — Not read it. Inhabit it. Rotate between geography, time, identity, voice. Understand the signal as a field, not a number.

If it manipulates rather than serves, it's wrong. If it decorates rather than communicates, it's wrong. If it gamifies rather than informs, it's wrong. If it compresses without offering decompression, it's incomplete.

---

*Commons Design System | Maintained by Communiqué PBC | Aligned to CONSTITUTION.md@v1.0.0*
