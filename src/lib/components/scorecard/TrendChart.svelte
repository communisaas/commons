<script lang="ts">
	import type { Fact } from '$lib/core/fact';

	type HistoryPoint = {
		period: string;
		responsiveness: number | null;
		alignment: number | null;
	};

	let {
		history
	}: {
		history: Fact<HistoryPoint[]>;
	} = $props();

	// Reverse so oldest is on the left
	let data = $derived(history.state === 'present' ? [...history.value].reverse() : []);

	// SVG dimensions
	const WIDTH = 400;
	const HEIGHT = 160;
	const PADDING = { top: 10, right: 10, bottom: 25, left: 35 };
	const chartW = WIDTH - PADDING.left - PADDING.right;
	const chartH = HEIGHT - PADDING.top - PADDING.bottom;

	function toPath(points: Array<{ period: string; value: number | null }>): string {
		const valid = points
			.map((p, i) => (p.value != null ? { x: i, y: p.value } : null))
			.filter((p): p is { x: number; y: number } => p != null);

		if (valid.length < 2) return '';

		const xScale = chartW / Math.max(points.length - 1, 1);
		// Scorecard snapshots carry ratios in [0, 1].
		const yScale = chartH;

		return valid
			.map((p, i) => {
				const x = PADDING.left + p.x * xScale;
				const y = PADDING.top + chartH - p.y * yScale;
				return `${i === 0 ? 'M' : 'L'}${x},${y}`;
			})
			.join(' ');
	}

	let responsivenessPath = $derived(
		toPath(data.map((d) => ({ period: d.period, value: d.responsiveness })))
	);
	let alignmentPath = $derived(toPath(data.map((d) => ({ period: d.period, value: d.alignment }))));

	// Y-axis labels
	const yLabels = [0, 0.25, 0.5, 0.75, 1];
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4">
	<h3 class="mb-3 text-sm font-semibold text-slate-700">
		Historical activity{#if history.state === 'present'}
			<span> ({data.length} periods)</span>{/if}
	</h3>

	{#if history.state === 'absent'}
		<p class="py-8 text-center text-sm text-slate-400">No historical snapshots are recorded.</p>
	{:else if history.state === 'withheld'}
		<p class="py-8 text-center text-sm text-slate-400">Public historical trends are withheld.</p>
	{:else if history.state === 'blocked'}
		<p class="py-8 text-center text-sm text-slate-400">
			Historical trends are temporarily unavailable.
		</p>
	{:else if data.length < 2}
		<p class="py-8 text-center text-sm text-slate-400">Not enough data for trend chart</p>
	{:else}
		<svg
			viewBox="0 0 {WIDTH} {HEIGHT}"
			class="w-full"
			aria-label="Accountability activity trend chart"
		>
			<!-- Grid lines -->
			{#each yLabels as label}
				{@const y = PADDING.top + chartH - label * chartH}
				<line
					x1={PADDING.left}
					y1={y}
					x2={WIDTH - PADDING.right}
					y2={y}
					stroke="#e2e8f0"
					stroke-width="1"
				/>
				<text x={PADDING.left - 5} y={y + 3} text-anchor="end" fill="#94a3b8" font-size="9">
					{Math.round(label * 100)}
				</text>
			{/each}

			<!-- Period labels (first, middle, last) -->
			{#if data.length > 0}
				<text x={PADDING.left} y={HEIGHT - 5} text-anchor="start" fill="#94a3b8" font-size="9">
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
			{#if responsivenessPath}
				<path
					d={responsivenessPath}
					fill="none"
					stroke="#0ea5e9"
					stroke-width="1.5"
					stroke-dasharray="4,3"
				/>
			{/if}
			{#if alignmentPath}
				<path
					d={alignmentPath}
					fill="none"
					stroke="#8b5cf6"
					stroke-width="1.5"
					stroke-dasharray="4,3"
				/>
			{/if}
		</svg>

		<!-- Legend -->
		<div class="mt-2 flex items-center justify-center gap-4 text-xs text-slate-500">
			<div class="flex items-center gap-1">
				<div class="h-0.5 w-4 border-t-2 border-dashed border-sky-500"></div>
				<span>Responsiveness</span>
			</div>
			<div class="flex items-center gap-1">
				<div class="h-0.5 w-4 border-t-2 border-dashed border-violet-500"></div>
				<span>Alignment</span>
			</div>
		</div>
	{/if}
</div>
