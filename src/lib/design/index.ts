/**
 * Commons Design System — Structural Primitives
 *
 * These components encode the design philosophy as composition,
 * not documentation. Import from '$lib/design'.
 *
 * See DESIGN.md in this directory for the decision tree.
 */

// Motion system — canonical spring configs
export { SPRINGS, COORD_COLORS, TIMING, EASING } from './motion';

// Semantic typography
export { default as Datum } from './Datum.svelte';

// Citation — contextual provenance
export { default as Cite } from './Cite.svelte';

// Micro-dimensions — visual provenance at citation scale
export { default as Ratio } from './Ratio.svelte';
export { default as Pulse } from './Pulse.svelte';
export { default as Rings } from './Rings.svelte';

// Spatial primitives
export { default as Artifact } from './Artifact.svelte';
export { default as EntityCluster } from './EntityCluster.svelte';
