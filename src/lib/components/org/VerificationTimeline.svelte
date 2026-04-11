<script lang="ts">
	interface TimelineBucket {
		day: string;
		total: number;
		verified: number;
	}

	let { timeline }: { timeline: TimelineBucket[] } = $props();

	const isEmpty = $derived(timeline.length === 0);

	// SVG sparkline dimensions
	const W = 600;
	const H = 120;
	const PAD = { top: 8, right: 8, bottom: 24, left: 8 };
	const chartW = W - PAD.left - PAD.right;
	const chartH = H - PAD.top - PAD.bottom;

	// Compute paths and label data
	const chartData = $derived.by(() => {
		if (timeline.length === 0) return null;

		const maxVal = Math.max(...timeline.map((b) => b.total), 1);
		const n = timeline.length;

		// Compute x,y coordinates for each bucket
		const totalPoints = timeline.map((b, i) => ({
			x: PAD.left + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2),
			y: PAD.top + chartH - (b.total / maxVal) * chartH
		}));

		const verifiedPoints = timeline.map((b, i) => ({
			x: PAD.left + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2),
			y: PAD.top + chartH - (b.verified / maxVal) * chartH
		}));

		// Build SVG path strings
		const toLine = (pts: Array<{ x: number; y: number }>) =>
			pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

		const toArea = (pts: Array<{ x: number; y: number }>) => {
			const baseline = PAD.top + chartH;
			const line = toLine(pts);
			return `${line} L${pts[pts.length - 1].x.toFixed(1)},${baseline} L${pts[0].x.toFixed(1)},${baseline} Z`;
		};

		// X-axis labels (first, middle, last dates)
		const labels: Array<{ x: number; text: string }> = [];
		if (n >= 1) {
			labels.push({ x: totalPoints[0].x, text: formatShortDate(timeline[0].day) });
		}
		if (n >= 3) {
			const mid = Math.floor(n / 2);
			labels.push({ x: totalPoints[mid].x, text: formatShortDate(timeline[mid].day) });
		}
		if (n >= 2) {
			labels.push({ x: totalPoints[n - 1].x, text: formatShortDate(timeline[n - 1].day) });
		}

		// Summary stats
		const totalActions = timeline.reduce((s, b) => s + b.total, 0);
		const totalVerified = timeline.reduce((s, b) => s + b.verified, 0);

		return {
			totalLine: toLine(totalPoints),
			verifiedLine: toLine(verifiedPoints),
			verifiedArea: toArea(verifiedPoints),
			labels,
			totalActions,
			totalVerified
		};
	});

	function formatShortDate(iso: string): string {
		const d = new Date(iso + 'T00:00:00');
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-6 space-y-4">
	<div class="flex items-center justify-between">
		<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary">Verification Timeline</p>
		{#if chartData}
			<div class="flex items-center gap-4">
				<span class="flex items-center gap-1.5 text-[10px] font-mono text-text-tertiary">
					<span class="inline-block h-[2px] w-3 bg-text-tertiary rounded"></span> total
				</span>
				<span class="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
					<span class="inline-block h-[2px] w-3 bg-emerald-500 rounded"></span> verified
				</span>
			</div>
		{/if}
	</div>

	{#if isEmpty}
		<div class="py-6 text-center">
			<p class="text-sm text-text-quaternary">No activity recorded yet</p>
		</div>
	{:else if chartData}
		<!-- Summary -->
		<div class="flex items-center gap-6">
			<div>
				<span class="font-mono tabular-nums text-lg font-semibold text-text-primary">
					{chartData.totalActions.toLocaleString()}
				</span>
				<span class="text-[10px] text-text-quaternary ml-1">actions</span>
			</div>
			<div>
				<span class="font-mono tabular-nums text-lg font-semibold text-emerald-400">
					{chartData.totalVerified.toLocaleString()}
				</span>
				<span class="text-[10px] text-text-quaternary ml-1">verified</span>
			</div>
			<div class="text-[10px] font-mono text-text-tertiary">
				{timeline.length} day{timeline.length === 1 ? '' : 's'}
			</div>
		</div>

		<!-- SVG Chart -->
		<svg viewBox="0 0 {W} {H}" class="w-full" preserveAspectRatio="xMidYMid meet">
			<!-- Verified area fill -->
			<path d={chartData.verifiedArea} fill="rgba(16,185,129,0.1)" />

			<!-- Total line -->
			<path d={chartData.totalLine} fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />

			<!-- Verified line -->
			<path d={chartData.verifiedLine} fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />

			<!-- X-axis labels -->
			{#each chartData.labels as label}
				<text
					x={label.x}
					y={H - 4}
					text-anchor="middle"
					class="fill-text-quaternary"
					style="font-size: 10px; font-family: ui-monospace, monospace;"
				>
					{label.text}
				</text>
			{/each}
		</svg>
	{/if}
</div>
