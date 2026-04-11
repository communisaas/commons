<script lang="ts">
	/**
	 * BubbleView — The living bubble composition.
	 *
	 * Wires together:
	 * - BubbleTerrain (MapLibre map layer, z-0)
	 * - Bubble (SVG circle + gesture layer, z-10/z-20)
	 * - BubbleStatus (resolution readout, positioned bottom-left)
	 *
	 * This is the single import for pages that need the bubble.
	 */

	import BubbleTerrain from './BubbleTerrain.svelte';
	import Bubble from './Bubble.svelte';
	import BubbleStatus from './BubbleStatus.svelte';
	import { bubbleState } from '$lib/core/bubble/bubble-state.svelte';

	let {
		class: className = ''
	}: {
		class?: string;
	} = $props();

	let terrainRef = $state<ReturnType<typeof BubbleTerrain> | null>(null);
</script>

<div
	class="relative overflow-hidden rounded-md border border-slate-200 bg-slate-50 {className}"
	style="min-height: 320px;"
	role="region"
	aria-label="Geographic bubble — your privacy-preserving location"
>
	<!-- Layer 0: Muted terrain basemap -->
	<BubbleTerrain bind:this={terrainRef} />

	<!-- Layers 1-2: SVG bubble + gesture capture -->
	<Bubble terrain={terrainRef} />

	<!-- Status overlay: bottom-left -->
	{#if bubbleState.phase !== 'idle'}
		<div class="absolute bottom-3 left-3 z-30 max-w-xs">
			<BubbleStatus />
		</div>
	{/if}

	<!-- Loading state -->
	{#if bubbleState.phase === 'loading'}
		<div class="absolute inset-0 z-40 flex items-center justify-center bg-white/50">
			<div class="flex items-center gap-2 text-sm text-slate-500">
				<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
					<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
					<path
						d="M4 12a8 8 0 018-8"
						stroke="currentColor"
						stroke-width="3"
						stroke-linecap="round"
						class="opacity-75"
					/>
				</svg>
				Loading districts...
			</div>
		</div>
	{/if}
</div>
