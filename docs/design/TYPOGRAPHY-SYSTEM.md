# Typography System

**Words in Satoshi. Numbers in Mono.**

This document provides detailed usage patterns and examples for Commons's typography system. For core rules and design tokens, see `docs/design/design-system.md`.

---

## Core Principle

**Satoshi** for words. **JetBrains Mono** for numbers.

### Why this split exists

The typographic register encodes epistemic status. JetBrains Mono signals "this is verifiable" — counts, scores, dates, hashes, district codes. Anything a third party could audit. Satoshi signals "this is interpretive" — explanations, descriptions, calls to action, editorial context. The reader learns, without being told, which parts of the surface are proven and which are contextual.

This is not a decorative choice. It's a consequence of the generative constraint: every visual element is either verifiable or honestly labeled as interpretive. The font face IS the label. See `docs/design/design-system.md` for the full constraint.

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

*Commons PBC | Typography System | 2026-04*
