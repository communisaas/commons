<script lang="ts">
	/**
	 * Pulse — Temporal rhythm at citation scale.
	 *
	 * A tiny sparkline that shows WHEN things happened.
	 * Not a chart. Not data viz. A heartbeat.
	 *
	 * 248 verified over 14 days → the pulse shows arrival
	 * rhythm: thin early, surge middle, taper end. The
	 * temporal dimension, felt as shape.
	 *
	 * 48-64px wide, 10-14px tall. Lives inside Cite provenance
	 * or standalone as a subordinate rhythm below any count.
	 */

	let {
		values,
		width = 56,
		height = 12,
		color = 'var(--coord-route-solid, #3bc4b8)',
		fill = true,
		class: className = ''
	}: {
		/** Ordered values representing intensity over time. */
		values: number[];
		/** Total width in px. Default 56. */
		width?: number;
		/** Total height in px. Default 12. */
		height?: number;
		/** Stroke/fill color. Default: teal (coordination route). */
		color?: string;
		/** Fill under the curve. Default true. */
		fill?: boolean;
		/** Additional CSS classes */
		class?: string;
	} = $props();

	const max = $derived(Math.max(...values, 1));
	const pad = 1; // 1px padding top/bottom

	const points = $derived(
		values.map((v, i) => {
			const x = values.length > 1 ? (i / (values.length - 1)) * width : width / 2;
			const y = height - pad - ((v / max) * (height - pad * 2));
			return { x, y };
		})
	);

	// Build smooth SVG path using cardinal spline interpolation
	const linePath = $derived(buildPath(points));
	const fillPath = $derived(
		`${linePath} L ${width},${height} L 0,${height} Z`
	);

	function buildPath(pts: { x: number; y: number }[]): string {
		if (pts.length === 0) return '';
		if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;

		let d = `M ${pts[0].x},${pts[0].y}`;

		for (let i = 0; i < pts.length - 1; i++) {
			const p0 = pts[Math.max(0, i - 1)];
			const p1 = pts[i];
			const p2 = pts[i + 1];
			const p3 = pts[Math.min(pts.length - 1, i + 2)];

			// Catmull-Rom to Bezier conversion (tension = 0.5)
			const cp1x = p1.x + (p2.x - p0.x) / 6;
			const cp1y = p1.y + (p2.y - p0.y) / 6;
			const cp2x = p2.x - (p3.x - p1.x) / 6;
			const cp2y = p2.y - (p3.y - p1.y) / 6;

			d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
		}

		return d;
	}

	const ariaLabel = $derived(
		`Rhythm: ${values.length} intervals, peak ${Math.max(...values)}`
	);
</script>

<svg
	class="pulse {className}"
	{width}
	{height}
	viewBox="0 0 {width} {height}"
	role="img"
	aria-label={ariaLabel}
>
	{#if fill}
		<path d={fillPath} fill={color} opacity="0.15" />
	{/if}
	<path d={linePath} fill="none" stroke={color} stroke-width="1.5" stroke-linecap="round" />
</svg>

<style>
	.pulse {
		display: block;
		opacity: 0.85;
	}
</style>
