# Typography System

**Words in Satoshi. Numbers in Mono.**

This document provides detailed usage patterns and examples for Commons's typography system. For core rules and design tokens, see `docs/design/design-system.md`.

---

## Core Principle

**Satoshi** for words. **JetBrains Mono** for numbers.

### Why this split exists

The typographic register encodes epistemic status. JetBrains Mono signals "this is verifiable" — counts, scores, dates, hashes, district codes. Anything a third party could audit. Satoshi signals "this is interpretive" — explanations, descriptions, calls to action, editorial context. The reader learns, without being told, which parts of the surface are proven and which are contextual.

This is not a decorative choice. It's a consequence of Principle 4 (verifiable or honestly interpretive, `CONSTITUTION.md` §2.1): every visual element is either verifiable or honestly labeled as interpretive. The font face IS the label. See `docs/design/design-system.md` for the full nine-principle framework.

---

## Usage Patterns

### ✅ CORRECT Examples

```svelte
<!-- Template title: Satoshi Bold -->
<h1 class="font-brand text-3xl font-bold">
  Tell Spotify: Fair artist pay
</h1>

<!-- Coordination count: JetBrains Mono Medium -->
<p class="font-mono text-sm font-medium text-emerald-600">
  1,247 sent this
</p>

<!-- Button text: Satoshi Medium -->
<button class="font-brand font-medium">
  Send Now
</button>

<!-- Body copy: Satoshi Regular -->
<p class="font-brand text-base">
  Your message will be encrypted and delivered via certified channels.
</p>

<!-- Timestamp: JetBrains Mono Regular -->
<time class="font-mono text-xs text-slate-500">
  2025-11-18 16:30:00
</time>

<!-- District code: JetBrains Mono Bold -->
<span class="font-mono text-lg font-bold">
  CA-11
</span>
```

### ❌ WRONG Examples

```svelte
<!-- DON'T: Use mono for UI copy -->
<button class="font-mono">Send Message</button>

<!-- DON'T: Use brand font for metrics -->
<span class="font-brand">1,247</span>

<!-- DON'T: Mix fonts within same semantic unit -->
<h1>
  <span class="font-brand">Total:</span>
  <span class="font-mono">1,247</span> <!-- WRONG: Split number from label -->
</h1>

<!-- CORRECT version -->
<div class="flex items-baseline gap-2">
  <h2 class="font-brand text-sm uppercase tracking-wide text-slate-600">Total</h2>
  <span class="font-mono text-3xl font-bold">1,247</span>
</div>
```

---

## Component-Specific Patterns

### Coordination Ticker

```svelte
<div class="flex items-baseline gap-1.5">
  <!-- Label: Satoshi Medium -->
  <span class="font-brand text-sm font-medium text-slate-600">
    Coordinating
  </span>

  <!-- Count: JetBrains Mono Bold with spring animation -->
  <span class="font-mono text-2xl font-bold text-emerald-600 tabular-nums">
    {Math.floor($displayCount)}
  </span>
</div>
```

**Key:** `tabular-nums` ensures consistent width for animated numbers.

### Template Card

```svelte
<!-- Title: Satoshi Bold -->
<h3 class="font-brand text-lg font-bold text-slate-900">
  {template.title}
</h3>

<!-- Description: Satoshi Regular -->
<p class="font-brand text-sm text-slate-600">
  {template.description}
</p>

<!-- Metrics: JetBrains Mono Medium -->
<div class="flex gap-4 font-mono text-xs font-medium text-slate-500">
  <span>{template.sent_count} sent</span>
  <span>{template.district_count} districts</span>
</div>
```

### Verification Status

```svelte
<!-- Typographic annotation — no pill, no badge container -->
<span class="font-mono text-xs text-emerald-600">
  ZK verified
</span>
```

Verification status is a typographic annotation, not a badge. No `rounded-full`, no `bg-{color}-50`, no `border`. The information is in the words and the color (emerald = verified). The container adds nothing. See containment policy in `docs/design/design-system.md`.

---

## Display Scale

Display scale typography lives in active-field surfaces (homepage masthead, debate index, atlas activity overlay). Per `CONSTITUTION.md` §2.2 and `design-system.md` Axis 2, the same typographic register (Satoshi for words, JetBrains Mono for verifiable claims) applies at both ends of the spectrum — only the size and the structural role change.

### Display sizes

Tailwind defaults provide the display scale. There is no separate display-scale primitive — the typography is set at the call site via Tailwind utilities. The `<Datum>` primitive remains size-agnostic.

```svelte
<!-- text-5xl: 3rem / 48px — section masthead -->
<h2 class="font-brand text-5xl font-bold tracking-tight">Coalition</h2>

<!-- text-6xl: 3.75rem / 60px — secondary hero -->
<h2 class="font-brand text-6xl font-bold tracking-tight">In flight</h2>

<!-- text-7xl: 4.5rem / 72px — primary hero metric (verifiable) -->
<span class="font-mono text-7xl font-bold tabular-nums">14,200</span>

<!-- text-8xl: 6rem / 96px — masthead anchor (interpretive) -->
<h1 class="font-brand text-8xl font-bold tracking-tight">Commons</h1>

<!-- text-9xl: 8rem / 128px — page-defining anchor (verifiable) -->
<span class="font-mono text-9xl font-bold tabular-nums">248</span>
```

### Rules at display scale

- **`tabular-nums` is mandatory for any verifiable count.** Without it, numerals shift width during animation, which reads as instability and contradicts the "this number could be audited" claim.
- **`tracking-tight` for display headlines in Satoshi.** Satoshi at 60px+ benefits from `-0.025em` letterspacing. Numbers in JetBrains Mono do not — they're already tabular.
- **`font-bold` (700) for hero metrics; `font-medium` (500) for the labels around them.** The metric is the headline; the label is the context. Satoshi 700 pairs with JetBrains Mono 500-700 depending on emphasis.
- **No display weights below 500.** A 96px Satoshi Regular looks ghostly on warm cream — it reads as draft, not authoritative. If display-scale text needs to feel quieter, drop the size, not the weight.
- **No drop shadows, gradients, or strokes on display type.** Per Axis 1 (dimensional causation), type effects must cite a substrate fact. They don't.
- **Axis 1 still binds.** A display-scale number must cite its provenance — either via `<Cite>` whisper, an adjacent `<Pulse>`/`<Ratio>`/`<Rings>` rendering its dimensions, or a `<RegistryMark>` linking the substrate hash. An uncited hero metric is unauthorized.

### Hero metric pattern (citation + display)

The display hero is always a **scalar over a dimension**: the count is the headline, the dimensions behind it (Pulse, Ratio, Rings) are the proof.

```svelte
<!-- 248 verified, with provenance -->
<div class="flex items-baseline gap-4">
  <Datum value={248} class="font-mono text-8xl font-bold tabular-nums" />
  <span class="font-brand text-2xl font-medium text-slate-600">verified</span>
</div>
<div class="mt-3 flex items-center gap-3">
  <Pulse values={arrivalRhythm} width={200} height={48} />
  <Ratio segments={identityBreakdown} height={16} class="flex-1" />
  <Rings tiers={tierDistribution} size={48} />
</div>
```

The dimensional primitives at display scale (Pulse 200×48, Ratio 16, Rings 48) cite the same substrate facts as their citation-scale counterparts (Pulse 56×12, Ratio 3, Rings 14). The composition reads as a single hero unit; the proof is structurally inseparable from the headline.

---

## Font Loading Performance

**Target:** <100ms FOIT (Flash of Invisible Text)

**Strategy:**
1. **Preload** critical fonts (Medium, Bold) in `<head>`
2. **font-display: swap** prevents invisible text, shows fallback immediately
3. **Self-hosted Satoshi** eliminates external DNS lookup (location: `/static/fonts/satoshi/`)
4. **WOFF2 format** provides best compression (30-50% smaller than WOFF)

**Expected load times:**
- Satoshi-Medium.woff2: ~40-60ms
- Satoshi-Bold.woff2: ~40-60ms
- JetBrains Mono (Google Fonts): ~80-120ms (cached: <10ms)

---

*Commons Typography System | Maintained by Communiqué PBC*
