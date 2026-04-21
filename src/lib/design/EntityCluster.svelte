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
    'default'  — 32px gap (8:32 = 1:4 ratio with typical 8px internal)
    'tight'    — 24px gap (for constrained spaces, still 1:3+)
    'spacious' — 48px gap (for hero layouts, 1:6 ratio)

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
		density?: 'tight' | 'default' | 'spacious';
		/** Wrapper element. Use 'ul' for lists. */
		as?: 'div' | 'ul' | 'section';
		/** Additional CSS classes */
		class?: string;
		children: Snippet;
	} = $props();

	const GAP_MAP = { tight: 'gap-6', default: 'gap-8', spacious: 'gap-12' } as const;
	const gapClass = $derived(GAP_MAP[density]);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:element
	this={as}
	class="flex flex-col {gapClass} {className}"
>
	{@render children()}
</svelte:element>
