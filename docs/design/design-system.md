# Commons Design System

**Civic Proof.**

---

## The Generative Constraints

Two rules produce every visual decision:

> **1. Every visual element is either verifiable or honestly labeled as interpretive.**

> **2. Information has shape. Express the shape, not just the value.**

The first constraint generates the typographic system — which register a claim belongs to. The second generates the dimensional system — how compressed data decompresses into the fields it was measured from.

"248 verified" is not a number. It is a compression of geography (where those people are), time (when they acted), identity depth (how strongly they're verified), and voice (whether they composed or echoed). Rendering it as three digits in a monospace font expresses one dimension — quantity — and erases the rest. The design system's job is to make the erased dimensions available.

- **Typographic register = epistemic status.** JetBrains Mono for verifiable claims — counts, scores, dates, hashes, district codes. Anything a third party could audit. Satoshi for interpretive context — explanations, descriptions, calls to action, editorial framing. The reader learns, without being told, which parts of the surface are proven and which are contextual.
- **Numbers are compressions, not endpoints.** "248 verified constituents" is backed by a geographic distribution, a temporal arrival pattern, an identity tier structure, and an authorship texture. The scalar is the headline. The dimensions behind it are the story. Both must be accessible.
- **Dimensions are visual, not textual.** A geographic distribution is a spatial field, not "GDS: 0.94." A temporal pattern is a rhythm, not "14 days." An identity composition is a depth gradient, not "104 gov ID, 89 address." If a dimension can be felt as shape, show the shape. Text descriptions of dimensions are a design failure.
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

### Cross-Dimensional Interaction

Dimensions are not independent. Geography × Time = "where did the surge come from?" Identity × Geography = "are the gov-ID-verified people concentrated or spread?" Voice × Time = "did the individual compositions come first, then the template echoes?"

When the design system matures, dimensional primitives should cross-filter: hover on a geographic cluster → the temporal Pulse highlights when that cluster acted → the identity Rings show the depth of that cluster. This is how an information space becomes navigable — by making the dimensions talk to each other.

---

## Color

Three semantic colors. No others.

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

Teal for routes. Indigo for sharing. Emerald for verification. **No other semantic colors.** Violet, purple, blue as semantic accent colors are prohibited — they fragment the vocabulary. If you reach for violet, ask whether the element is a route (teal), a share (indigo), or a verification signal (emerald). It's always one of the three.

**Scoped exceptions:**
- **Debate subsystem** — violet is permitted within `src/lib/components/debate/` as an AI-reasoning / evaluation-phase signal. It separates AI-contributed outputs (machine scores, AI evaluation phase) from human deliberation (amber) and semantic verdicts (emerald/red/amber). This is subsystem-local vocabulary, not a global semantic. Prohibited outside the debate subsystem.
- **Party indicators** — purple for Independent is a political convention, not a design decision. Permitted on representative/decision-maker indicators only.

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
- **`rounded-xl` (12px)** — prohibited. Civic infrastructure has edges. Use `rounded-lg` (8px) sparingly for actual cards. `rounded` (4px) for inputs. Nothing for typographic layouts.
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

### Core Principles

From voice.md—still accurate:

1. **Confident & Direct** — State what is. Don't justify.
2. **Technical Details in Popovers** — Primary UI stays simple.
3. **Imperative Voice** — Commands, not suggestions.
4. **No Category Labels** — "CA-11" not "Campaigns in CA-11"

### What We Don't Say

- issues, community, platform, content, engagement, solutions, empower
- "campaigns" on person-layer surfaces (org layer uses it as a technical noun — see voice.md)

### What We Do Say

- Send. Coordinate. Verify.
- Location names stand alone: "California" / "CA-11"
- Counts speak for themselves: "847 sent this"

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

The design philosophy is encoded as components. Import from `$lib/design`. See `$lib/design/DESIGN.md` for the agent-readable decision tree.

### Register Layer
- **`Datum`** — Verifiable numeric claim. Always JetBrains Mono + tabular-nums. Optional spring animation, optional cite provenance. The font IS the truth claim.
- **`Cite`** — Contextual provenance. Four forms: whisper (materializes on hover), mark (dotted underline), footnote (collects at Artifact bottom), ghost (aria-only). Provenance should be visual (use dimensional primitives inside), not textual.

### Dimensional Layer
- **`Ratio`** — Composition as color proportion. A thin segmented bar showing what a count is made of. 3-5px tall. No labels. For identity breakdown, authorship texture, geographic distribution.
- **`Pulse`** — Temporal rhythm as sparkline. A tiny smooth curve showing when things happened. 56×12px default. For arrival cadence, momentum patterns.
- **`Rings`** — Depth/tier as concentric glyph. 14-16px. Shows how deep verification goes. Citation-scale TrustTierIndicator.

### Spatial Layer
- **`Artifact`** — Bounded white object that earns card treatment. Proof specimens, email previews, templates. Provides footnote context for Cite footnotes.
- **`EntityCluster`** — Proximity-ratio layout. Generous void between entities (32px default). No borders. The void IS the boundary.

### Motion Layer
- **`SPRINGS`** — Six canonical spring configs. See Motion section above.
- **`COORD_COLORS`** — The three semantic colors as JS constants.
- **`TIMING`** — CSS transition durations (150/220/320ms).

---

## Decision Rules

### "Does this number have dimensions behind it?"

**If yes**, express them. Use Ratio (composition), Pulse (time), Rings (depth). Prefer visual shape over text description. A scalar with its dimensions hidden is an incomplete rendering.

### "Should this animate?"

**Yes** if it's a coordination signal (send, share, count update, dimension transition).
**No** if it's anything else.

### "What color?"

**Teal** — Routes, connections, active coordination
**Emerald** — Verification, delivery confirmed
**Indigo** — Sharing, spreading, secondary actions

### "Satoshi or Mono?"

**Satoshi** — Words, explanations, citations (interpretive)
**Mono** — Numbers, dates, hashes, district codes (verifiable)

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

*Commons PBC | Design System | 2026-04*
