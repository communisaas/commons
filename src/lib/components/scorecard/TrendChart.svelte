<script lang="ts">
	let {
		history
	}: {
		history: Array<{
			period: string;
			responsiveness: number | null;
			alignment: number | null;
			composite: number | null;
		}>;
	} = $props();

	// Reverse so oldest is on the left
	let data = $derived([...history].reverse());

	// SVG dimensions
	const WIDTH = 400;
	const HEIGHT = 160;
	const PADDING = { top: 10, right: 10, bottom: 25, left: 35 };
	const chartW = WIDTH - PADDING.left - PADDING.right;
	const chartH = HEIGHT - PADDING.top - PADDING.bottom;

	function toPath(
		points: Array<{ period: string; value: number | null }>,
	): string {
		const valid = points
			.map((p, i) => (p.value != null ? { x: i, y: p.value } : null))
			.filter((p): p is { x: number; y: number } => p != null);

		if (valid.length < 2) return '';

		const xScale = chartW / Math.max(points.length - 1, 1);
		const yScale = chartH / 100;

		return valid
			.map((p, i) => {
				const x = PADDING.left + p.x * xScale;
				const y = PADDING.top + chartH - p.y * yScale;
				return `${i === 0 ? 'M' : 'L'}${x},${y}`;
			})
			.join(' ');
	}

	let compositePath = $derived(
		toPath(data.map((d) => ({ period: d.period, value: d.composite })))
	);
	let responsivenessPath = $derived(
		toPath(data.map((d) => ({ period: d.period, value: d.responsiveness })))
	);
	let alignmentPath = $derived(
		toPath(data.map((d) => ({ period: d.period, value: d.alignment })))
	);

	// Y-axis labels
	const yLabels = [0, 25, 50, 75, 100];
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4">
	<h3 class="mb-3 text-sm font-semibold text-slate-700">Trend (last {data.length} periods)</h3>

	{#if data.length < 2}
		<p class="py-8 text-center text-sm text-slate-400">Not enough data for trend chart</p>
	{:else}
		<svg viewBox="0 0 {WIDTH} {HEIGHT}" class="w-full" aria-label="Score trend chart">
			<!-- Grid lines -->
			{#each yLabels as label}
				{@const y = PADDING.top + chartH - (label / 100) * chartH}
				<line
					x1={PADDING.left}
					y1={y}
					x2={WIDTH - PADDING.right}
					y2={y}
					stroke="#e2e8f0"
					stroke-width="1"
				/>
				<text
					x={PADDING.left - 5}
					y={y + 3}
					text-anchor="end"
					fill="#94a3b8"
					font-size="9"
				>
					{label}
				</text>
			{/each}

			<!-- Period labels (first, middle, last) -->
			{#if data.length > 0}
				<text
					x={PADDING.left}
					y={HEIGHT - 5}
					text-anchor="start"
					fill="#94a3b8"
					font-size="9"
				>
					{data[0].period}
				</text>
				<text
					x={WIDTH - PADDING.right}
					y={HEIGHT - 5}
					text-anchor="end"
					fill="#94a3b8"
					font-size="9"
				>
					{data[data.length - 1].period}
				</text>
			{/if}

			<!-- Lines -->
			{#if compositePath}
				<path d={compositePath} fill="none" stroke="#6366f1" stroke-width="2.5" />
			{/if}
			{#if responsivenessPath}
				<path d={responsivenessPath} fill="none" stroke="#0ea5e9" stroke-width="1.5" stroke-dasharray="4,3" />
			{/if}
			{#if alignmentPath}
				<path d={alignmentPath} fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="4,3" />
			{/if}
		</svg>

		<!-- Legend -->
		<div class="mt-2 flex items-center justify-center gap-4 text-xs text-slate-500">
			<div class="flex items-center gap-1">
				<div class="h-0.5 w-4 bg-indigo-500"></div>
				<span>Composite</span>
			</div>
			<div class="flex items-center gap-1">
				<div class="h-0.5 w-4 border-t-2 border-dashed border-sky-500"></div>
				<span>Responsiveness</span>
			</div>
			<div class="flex items-center gap-1">
				<div class="h-0.5 w-4 border-t-2 border-dashed border-emerald-500"></div>
				<span>Alignment</span>
			</div>
		</div>
	{/if}
</div>
