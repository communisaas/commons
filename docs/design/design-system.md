# Commons Design System

**Verified voice, directed.**

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

## What We're Not

We're not a SaaS product. We're not a consumer app. We're not a petition platform.

We're civic infrastructure. The design should feel like a well-made envelope — professional, solid, carrying something real. Not a weapon. Not a dashboard. Not a game.

**We design for conviction, not momentum. Credibility, not polish. Gravity, not weight.**

---

## The Visual Identity: Coordination Graph

The RelayLoom component defines our visual language. It shows what Commons actually does:

- **Nodes** — People and targets, connected
- **Edges** — Messages flowing from many senders to decision-makers
- **Animation** — Flow that reveals collective action in progress

This is the honest aesthetic. Not gradients and glows. A graph of coordination.

### Colors Derived from RelayLoom

```css
/* Coordination flow */
--teal-route: rgba(59, 196, 184, 0.9);    /* #3BC4B8 — Message routes to targets */
--indigo-share: rgba(79, 70, 229, 0.9);   /* #4F46E5 — Sharing/spreading connections */

/* Verification */
--emerald-verified: #10b981;               /* Delivery confirmed, identity verified */

/* Surfaces */
--surface-base: #ffffff;
--surface-node: rgba(255, 255, 255, 0.9);  /* Node cards with blur */
--border-node: rgba(148, 163, 184, 0.45);  /* Subtle node borders */

/* Text */
--text-primary: #0f172a;                   /* Slate-900 */
--text-secondary: #475569;                 /* Slate-600 */
--text-muted: #94a3b8;                     /* Slate-400 */
```

**That's it.** Teal for routes. Indigo for sharing. Emerald for verification. No violet accent. No participation-primary gradients. No five-color palette.

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

**Nothing else.** Privacy badges don't animate. Forms don't animate. Cards hover-lift slightly, that's it.

### The Physics

```typescript
// Spring physics for coordination counts
spring(count, { stiffness: 0.2, damping: 0.8 })
```

Numbers should tick like scoreboards—weighted, inevitable. Not bouncy or playful.

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

Use the minimum structure the task requires for the user to perceive, chunk, and act. No pattern is ideologically forbidden; every pattern must earn its place.

- **Proximity ratio** — default for entity lists. No borders, no backgrounds.
- **Cards** — reserved for the message preview artifact (it IS a bounded object — an email).
- **Borders** — reserved for major section breaks, not entity separation.
- **Background shifts** — reserved for interactive states (hover, active), not resting state.

### Action Affordances

Action links are latent at rest (slate-400) and activate on hover (teal). The chevron appears with the color. This means the entity feels like information at rest and becomes interactive when you engage. No hover backgrounds — the text itself activates.

## Components

### Nodes (from RelayLoom)

The node card is the visualization unit. White with slight blur, subtle border, soft shadow. Used in RelayLoom and template browser cards — contexts where items are browsable objects.

```css
.node {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 12px;
  backdrop-filter: blur(4px);
  box-shadow:
    inset 0 1px 6px rgba(0, 0, 0, 0.08),
    0 20px 50px -28px rgba(15, 23, 42, 0.45);
}
```

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

- campaigns, issues, community, platform, content, engagement, solutions, empower

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
/* These pass */
color: #0f172a; /* on white: 16.8:1 */
color: #10b981; /* emerald on white: 3.2:1 (large text only) */
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

## What's Implemented vs. Aspirational

### Implemented (Ship Today)

- Satoshi + JetBrains Mono typography
- Button.svelte with paper plane physics
- ShareButton.svelte with particle burst
- RelayLoom.svelte coordination graph
- ChannelExplainer.svelte channel cards
- Teal/indigo/emerald color vocabulary

### Not Yet Implemented

- Coordination count ticker with spring animation
- Reputation gain feedback
- Live activity pulse
- Graph aesthetic extended to template cards

---

## Decision Rules

### "Should this animate?"

**Yes** if it's a coordination signal (send, share, count update).
**No** if it's anything else.

### "What color?"

**Teal** — Routes, connections, active coordination
**Emerald** — Verification, delivery confirmed
**Indigo** — Sharing, spreading, secondary actions

### "Satoshi or Mono?"

**Satoshi** — Words
**Mono** — Numbers

---

## The Standard

When reviewing design work, ask:

1. **Does this make the action feel real?** — conviction for the sender, substance for the collective, credibility for the recipient
2. Is the animation communicating information or just decorating?
3. Would this work if we removed all color except teal and emerald?
4. Can you scan this surface by hopping between typographic peaks?
5. **Does this feel honest?** — not "infrastructure vs. consumer app" but does every element earn its place?

If it manipulates rather than serves, it's wrong. If it decorates rather than communicates, it's wrong. If it gamifies rather than informs, it's wrong.

---

*Commons PBC | Design System | 2025-11*
