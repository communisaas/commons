<script lang="ts">
	/**
	 * Ratio — Dimensional composition. Scales from citation to display.
	 *
	 * A segmented bar that shows what a number is MADE OF.
	 * No labels. No text. Pure proportion felt as color.
	 *
	 * 248 verified → bar shows: 40% deep emerald (gov ID),
	 * 35% teal (address), 25% muted (email). The identity
	 * dimension, experienced as visual weight, not read as text.
	 *
	 * Citation scale (default 3px, 5px for emphasis): lives inside
	 * Cite provenance or standalone as a subordinate element below
	 * any count.
	 *
	 * Display scale (12-24px): lives in active-field surfaces where
	 * the composition is the headline, not a footnote. Border-radius
	 * scales with height so the bar reads as a unified ribbon at any
	 * size.
	 *
	 * Per CONSTITUTION.md §2.2 (information has shape), the same
	 * primitive serves both content states (Axis 2). The dimension
	 * cited (composition) and the substrate facts driving each
	 * segment (per-action trustTier/compositionMode) are constant
	 * across scales (Axis 1).
	 */

	interface Segment {
		/** Numeric value (proportional, not percentage) */
		value: number;
		/** CSS color — use semantic vars: var(--coord-verified), var(--coord-route-solid) */
		color: string;
		/** Accessible label (not displayed, announced by screen readers) */
		label?: string;
	}

	let {
		segments,
		height = 3,
		class: className = ''
	}: {
		/** Composition segments. Order = left to right. */
		segments: Segment[];
		/** Bar height in px. Default 3 (citation: subordinate). 5 for citation emphasis. Display range: 12-24. */
		height?: number;
		/** Additional CSS classes */
		class?: string;
	} = $props();

	const total = $derived(segments.reduce((s, seg) => s + seg.value, 0));
	const pcts = $derived(
		segments.map((seg) => (total > 0 ? (seg.value / total) * 100 : 0))
	);
	const ariaLabel = $derived(
		segments
			.filter((s) => s.value > 0)
			.map((s) => {
				const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
				return `${s.label ?? 'segment'}: ${pct}%`;
			})
			.join(', ')
	);
</script>

<div
	class="ratio {className}"
	role="img"
	aria-label={ariaLabel}
	style="height: {height}px; border-radius: {height / 2}px;"
>
	{#each segments as seg, i}
		{#if seg.value > 0}
			<div
				class="ratio-segment"
				style="
					width: {pcts[i]}%;
					background: {seg.color};
					border-radius: {i === 0 ? `${height / 2}px 0 0 ${height / 2}px` : i === segments.length - 1 || segments.slice(i + 1).every(s => s.value === 0) ? `0 ${height / 2}px ${height / 2}px 0` : '0'};
				"
			></div>
		{/if}
	{/each}
</div>

<style>
	.ratio {
		display: flex;
		width: 100%;
		overflow: hidden;
		opacity: 0.85;
	}

	.ratio-segment {
		height: 100%;
		transition: width 500ms cubic-bezier(0.4, 0, 0.2, 1);
	}
</style>
