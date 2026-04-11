<script lang="ts">
	/**
	 * BubbleStatus — Resolution readout and precision indicator.
	 *
	 * Shows which district layers are resolved (center is unambiguously
	 * inside one district) vs ambiguous (a fence crosses the bubble).
	 * Precision bar: 4-segment visual (postal → county → state → congressional).
	 */

	import { bubbleState, type LayerResolution } from '$lib/core/bubble/bubble-state.svelte';
	import { FENCE_LAYER_COLORS, FENCE_DEFAULT_COLOR } from './bubble-terrain-style';

	const LAYER_LABELS: Record<string, string> = {
		cd: 'Congressional',
		sldu: 'State Senate',
		sldl: 'State House',
		can: 'Federal Riding',
		county: 'County'
	};

	const PRECISION_SEGMENTS = ['postal', 'county', 'state', 'congressional'] as const;

	const precisionIndex = $derived.by(() => {
		switch (bubbleState.precision) {
			case 'none':
				return -1;
			case 'postal':
				return 0;
			case 'ambiguous':
				return 1;
			case 'resolved':
				return 3;
			default:
				return -1;
		}
	});

	function layerColor(layer: string): string {
		return FENCE_LAYER_COLORS[layer] ?? FENCE_DEFAULT_COLOR;
	}

	function layerLabel(layer: string): string {
		return LAYER_LABELS[layer] ?? layer;
	}
</script>

{#if bubbleState.phase !== 'idle'}
	<div
		class="rounded-lg border border-slate-200 bg-white/90 p-3 text-sm"
		role="status"
		aria-live="polite"
	>
		<!-- Precision bar -->
		<div class="mb-2 flex items-center gap-1">
			<span class="mr-2 text-xs font-medium text-slate-500">Precision</span>
			{#each PRECISION_SEGMENTS as seg, i}
				<div
					class="h-1.5 flex-1 rounded-full transition-colors duration-300"
					class:bg-blue-400={i <= precisionIndex}
					class:bg-slate-200={i > precisionIndex}
					aria-hidden="true"
				></div>
			{/each}
		</div>

		<!-- Layer resolution badges -->
		{#if bubbleState.layerResolutions.length > 0}
			<div class="flex flex-wrap gap-1.5">
				{#each bubbleState.layerResolutions as lr (lr.layer)}
					<div
						class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
						class:bg-slate-100={lr.resolved}
						class:text-slate-700={lr.resolved}
						class:bg-amber-50={!lr.resolved}
						class:text-amber-700={!lr.resolved}
					>
						<!-- Status dot -->
						<span
							class="inline-block h-2 w-2 rounded-full"
							style="background-color: {layerColor(lr.layer)}; opacity: {lr.resolved ? 1 : 0.5};"
							aria-hidden="true"
						></span>

						{#if lr.resolved}
							<span>{lr.districtName}</span>
							<span class="sr-only">{layerLabel(lr.layer)} resolved</span>
						{:else}
							<span class="italic">{layerLabel(lr.layer)}</span>
							<span class="sr-only">{layerLabel(lr.layer)} ambiguous — tighten bubble to resolve</span>
						{/if}
					</div>
				{/each}
			</div>
		{:else if bubbleState.phase === 'loading'}
			<p class="text-xs text-slate-400">Loading districts...</p>
		{:else if bubbleState.phase === 'error'}
			<p class="text-xs text-red-500">{bubbleState.errorMessage ?? 'Failed to load districts'}</p>
		{/if}

		<!-- Officials (if available) -->
		{#if bubbleState.officials.length > 0}
			<div class="mt-2 border-t border-slate-100 pt-2">
				<p class="mb-1 text-xs font-medium text-slate-500">Representatives</p>
				<div class="space-y-0.5">
					{#each bubbleState.officials as official}
						<div class="flex items-center gap-1 text-xs text-slate-600">
							<span
								class="inline-block h-1.5 w-1.5 rounded-full"
								class:bg-blue-500={official.party === 'D'}
								class:bg-red-500={official.party === 'R'}
								class:bg-slate-400={official.party !== 'D' && official.party !== 'R'}
							></span>
							<span class="font-medium">{official.name}</span>
							<span class="text-slate-400">— {official.title}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Radius readout -->
		<div class="mt-2 text-xs text-slate-400">
			{#if bubbleState.radius < 1000}
				{Math.round(bubbleState.radius)}m radius
			{:else}
				{(bubbleState.radius / 1000).toFixed(1)}km radius
			{/if}
			{#if bubbleState.postalCode}
				&middot; {bubbleState.postalCode}
			{/if}
		</div>
	</div>
{/if}
