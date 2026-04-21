<script lang="ts">
	/**
	 * Ratio — Dimensional composition at citation scale.
	 *
	 * A thin segmented bar that shows what a number is MADE OF.
	 * No labels. No text. Pure proportion felt as color.
	 *
	 * 248 verified → bar shows: 40% deep emerald (gov ID),
	 * 35% teal (address), 25% muted (email). The identity
	 * dimension, experienced as visual weight, not read as text.
	 *
	 * Lives inside Cite provenance slots, or standalone as
	 * a subordinate element below any count.
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
		/** Bar height in px. Default 3 — subordinate. Use 5 for emphasis. */
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
