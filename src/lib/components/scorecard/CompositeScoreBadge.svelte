<script lang="ts">
	let { score }: { score: number | null } = $props();

	let displayScore = $derived(score != null ? Math.round(score) : null);

	let color = $derived(
		score == null
			? { stroke: '#94a3b8', text: 'text-slate-400' }
			: score >= 67
				? { stroke: '#16a34a', text: 'text-green-600' }
				: score >= 34
					? { stroke: '#d97706', text: 'text-amber-600' }
					: { stroke: '#dc2626', text: 'text-red-600' }
	);

	// SVG circular gauge: radius=45, circumference=2*PI*45 ~= 282.74
	const RADIUS = 45;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	let dashOffset = $derived(
		score != null ? CIRCUMFERENCE - (score / 100) * CIRCUMFERENCE : CIRCUMFERENCE
	);
</script>

<div
	class="relative inline-flex items-center justify-center"
	role="img"
	aria-label={displayScore != null ? `Composite score: ${displayScore} out of 100` : 'No score available'}
>
	<svg width="120" height="120" viewBox="0 0 120 120">
		<!-- Background circle -->
		<circle
			cx="60"
			cy="60"
			r={RADIUS}
			fill="none"
			stroke="#e2e8f0"
			stroke-width="8"
		/>
		<!-- Score arc -->
		<circle
			cx="60"
			cy="60"
			r={RADIUS}
			fill="none"
			stroke={color.stroke}
			stroke-width="8"
			stroke-linecap="round"
			stroke-dasharray={CIRCUMFERENCE}
			stroke-dashoffset={dashOffset}
			transform="rotate(-90 60 60)"
			class="transition-all duration-500"
		/>
	</svg>
	<div class="absolute inset-0 flex flex-col items-center justify-center">
		{#if displayScore != null}
			<span class="text-3xl font-bold {color.text}">{displayScore}</span>
			<span class="text-xs text-slate-400">/ 100</span>
		{:else}
			<span class="text-lg font-semibold text-slate-400">N/A</span>
			<span class="text-xs text-slate-400">insufficient data</span>
		{/if}
	</div>
</div>
