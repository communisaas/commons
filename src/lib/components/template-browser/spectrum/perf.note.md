# Spectrum field — performance + timing notes

Evidence and rationale for the topical field's timing guarantees. Not imported by
any module (markdown is not part of the client bundle); this is engineering
documentation living beside the code it describes.

## Grouping + aggregation budget (<100ms)

Per render, the field does the whole compute pass over its template list:

- `groupByDomain` — bucket templates by civic domain, order the bands along the
  hue spectrum (`resolveDomainHue`), sort within each band by civic relevance.
- per band: `aggregateArrivals` (element-wise sum of the 30-day rhythm) and
  `bandMomentum` (verified reach roll-up).

Measured cost (median of repeated runs; see
`tests/unit/topic/grouping-perf.test.ts`):

| Field                          | Compute pass |
| ------------------------------ | ------------ |
| Real seed (~15 templates)      | ~0.05 ms     |
| Synthetic 200-template field   | ~0.14 ms     |
| Synthetic 400-template field   | ~0.24 ms     |

All three are three orders of magnitude inside the 100 ms causality budget, and the
growth from 100→400 templates stays comfortably sub-quadratic — the pass is
O(n log n) (a single bucket map, one sort per band, linear roll-ups). The suite
pins an absolute ceiling and a scaling ceiling, so a future change that makes the
pipeline super-linear fails the gate rather than merely feeling slow.

## Memoization (no regroup on unrelated state)

Grouping is a Svelte `$derived` keyed on the `templates` array reference. It
recomputes only when that reference changes — never on an unrelated state change
(a spine bloom, a lens flip, a band expanding). The within-band recency clock is
captured once per mount, so the grouping is a pure function of the template array:
the same templates always produce the identical field, and a re-render driven by
unrelated state cannot reshuffle the bands under the eye. A regression test pins
this stability across an unrelated re-render.

## No layout shift on data resolution (CLS ≈ 0)

The templates are hydrated from the server payload on mount, so the field paints
with data rather than blank-then-fill. The overview map reserves a stable
min-height in both of its forms — the desktop ribbon (the server default) and the
mobile scrubber (the client reconciles to it at the narrow breakpoint) — so the
ribbon→scrubber swap on mount holds the same vertical footprint and shifts nothing
below it.

Measured with `PerformanceObserver({ type: 'layout-shift' })` across a fresh load:
**CLS = 0** at 1440px (ribbon) and at 375px (scrubber). Zero layout-shift entries
in both modes.

## SSR-safe

No browser globals at module top level or in the synchronous component body.
Every `window` / `document` / `sessionStorage` / `matchMedia` access lives inside
an effect, an event handler, or a Svelte action — none of which run during SSR.
The grouping, hue resolution, and aggregation modules are pure (no wall-clock at
module load, no randomness, no globals), so the server and client render the same
field. SSR render of the landscape route returns 200 with the field present in the
raw HTML.

## Reduced motion

Verified across the three motion surfaces:

- **Overview bloom** — the band-jump handler returns before setting the bloom when
  `prefers-reduced-motion: reduce`, so no spine flares; the jump is an instant
  (`auto`) scroll that still offsets for the sticky map.
- **Band expand** — tiles revealed past the lead set carry an entrance (fade +
  rise) that the tile's own reduced-motion block zeroes (animation: none, opacity:
  1), so the band grows without movement.
- **The dive** — the scrim drops its backdrop blur (the expensive, vestibular
  channel) and keeps only the cheap warm dim; the risen surface appears at once
  rather than animating up.

## Progressive reveal

A band reveals in bounded steps (a cap of ~100 tiles per "more" click) so one click
never mounts an unbounded run of DOM nodes. The cap engages only where a band runs
past that size; an ordinary band (the whole seed, anything shy of one step) reveals
its full remainder in a single click exactly as before. No virtualization is added
ahead of data that needs it — at the seed no band approaches the threshold.
