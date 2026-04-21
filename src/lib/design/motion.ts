/**
 * Commons Motion System
 *
 * Canonical spring configurations for all animated values.
 * Named by semantic purpose, not by component.
 *
 * Design rule: numbers tick like scoreboards — weighted, inevitable, not bouncy.
 * Only coordination signals animate. Nothing else.
 *
 * Usage:
 *   import { SPRINGS } from '$lib/design/motion';
 *   const count = spring(0, SPRINGS.COUNT_TICK);
 */

import type { SpringOptions } from 'svelte/motion';

// ─── Spring Configurations ───────────────────────────────────────────
//
// Each config encodes a specific feeling:
//
//   COUNT_TICK  — The canonical "scoreboard" spring. Numbers arriving with weight.
//                 Used for: verified counts, district counts, supporter totals,
//                 any number that represents accumulated civic action.
//
//   METRIC      — Slightly slower than COUNT_TICK. Dashboard-scale numbers where
//                 several values animate together. Used for: org metrics panels,
//                 verification packets, delivery stats.
//
//   DEPARTURE   — Slow, heavy. Something leaving — a message, a paper plane.
//                 The weight says: this action has consequence.
//                 Used for: Button flight animation.
//
//   SCORE_BAR   — Snappy width fill. A bar reaching its destination.
//                 Used for: AI score breakdowns, progress indicators,
//                 any horizontal bar that fills to a value.
//
//   SIGNAL      — Very slow, gentle settle. Something growing into view.
//                 Used for: Signal strength bars, trust tier indicators,
//                 elements that represent accumulated state rather than events.
//
//   ENTRANCE    — Panel or element sliding into view. Firm arrival, minimal
//                 overshoot. Used for: compose panes, expanding sections.

export const SPRINGS = {
	/** Scoreboard numbers — weighted, inevitable. stiffness: 0.2, damping: 0.8 */
	COUNT_TICK: { stiffness: 0.2, damping: 0.8 } satisfies SpringOptions,

	/** Dashboard metrics — several values settling together. stiffness: 0.15, damping: 0.8 */
	METRIC: { stiffness: 0.15, damping: 0.8 } satisfies SpringOptions,

	/** Message departure — slow, consequential. stiffness: 0.08, damping: 0.85 */
	DEPARTURE: { stiffness: 0.08, damping: 0.85 } satisfies SpringOptions,

	/** Bar fills — snappy, precise. stiffness: 0.3, damping: 0.85 */
	SCORE_BAR: { stiffness: 0.3, damping: 0.85 } satisfies SpringOptions,

	/** Growing into view — slow, gentle. stiffness: 0.06, damping: 0.75 */
	SIGNAL: { stiffness: 0.06, damping: 0.75 } satisfies SpringOptions,

	/** Panel entrance — firm arrival, no bounce. stiffness: 0.25, damping: 0.85 */
	ENTRANCE: { stiffness: 0.25, damping: 0.85 } satisfies SpringOptions
} as const;

// ─── Semantic Color (for motion-adjacent use) ────────────────────────
//
// These are the three coordination colors, exported as constants
// so components can reference them without reaching for Tailwind.
// Teal = routes. Emerald = verified. Indigo = sharing.

export const COORD_COLORS = {
	/** Routes, connections, active coordination */
	ROUTE: { solid: '#3bc4b8', alpha: 'rgba(59, 196, 184, 0.9)' },
	/** Delivery confirmed, identity verified, proof success */
	VERIFIED: { solid: '#10b981', alpha: 'rgba(16, 185, 129, 0.9)' },
	/** Sharing, spreading, secondary actions */
	SHARE: { solid: '#4f46e5', alpha: 'rgba(79, 70, 229, 0.9)' }
} as const;

// ─── Timing ──────────────────────────────────────────────────────────
//
// CSS transition durations for non-spring animations (hover, focus, etc.)
// These match the CSS custom properties in app.css.

export const TIMING = {
	/** Fast interactions: hover, focus ring. 150ms */
	FAST: 150,
	/** Standard transitions: color change, opacity. 220ms */
	NORMAL: 220,
	/** Deliberate transitions: layout shift, panel. 320ms */
	SLOW: 320
} as const;

/** Standard easing — matches --header-easing in app.css */
export const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
