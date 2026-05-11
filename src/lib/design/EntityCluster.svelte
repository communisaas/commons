<!--
  EntityCluster — Proximity-ratio layout primitive.

  Implements the containment-without-containers principle:
  tight internal spacing within each entity, generous void
  between entities. The ratio (1:4+) lets the visual system
  chunk each cluster as a unit — no border needed.

  The void IS the boundary.

  Usage:
    <EntityCluster>
      <div>Entity name, title, action — tight cluster</div>
      <div>Another entity — separated by void</div>
    </EntityCluster>

  Internal spacing (within each slotted child): handled by the
  child component itself (use gap-1 / gap-1.5 / space-y-1).

  EntityCluster handles only the BETWEEN-entity spacing.

  Density:
    'tight'    — 24px gap (constrained spaces, still 1:3+ ratio)
    'default'  — 32px gap (8:32 = 1:4 with typical 8px internal)
    'spacious' — 48px gap (citation-scale hero layouts, 1:6 ratio)
    'display'  — 80px gap (active-field hero, 1:10+ ratio)

  The display density is for active-field surfaces where the void
  between entities reads as architectural space, not spatial rhythm.
  Per Axis 2 (CONSTITUTION.md §2.2 / docs/design/design-system.md),
  the same primitive serves both content states.

  The component also provides a subtle visual "peak" for scanning:
  each direct child is positioned as a cluster on the ground plane.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		density = 'default',
		as = 'div',
		class: className = '',
		children
	}: {
		/** Gap between entities. */
		density?: 'tight' | 'default' | 'spacious' | 'display';
		/** Wrapper element. Use 'ul' for lists. */
		as?: 'div' | 'ul' | 'section';
		/** Additional CSS classes */
		class?: string;
		children: Snippet;
	} = $props();

	const GAP_MAP = {
		tight: 'gap-6',     // 24px
		default: 'gap-8',    // 32px
		spacious: 'gap-12',  // 48px
		display: 'gap-20'    // 80px — active-field hero
	} as const;
	const gapClass = $derived(GAP_MAP[density]);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:element
	this={as}
	class="flex flex-col {gapClass} {className}"
>
	{@render children()}
</svelte:element>
