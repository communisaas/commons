<!--
KeyMoments: Sticky footer that captures important items as they appear in the stream

PERCEPTUAL ENGINEERING:
- Never scrolls away (maintains spatial constancy)
- Information scent via icon + label (pre-attentive processing)
- Horizontal layout minimizes vertical intrusion
- Subtle entrance animation (continuity of change)
- Semi-transparent to show it's auxiliary, not primary

ACCESSIBILITY:
- Keyboard navigation through chips
- Screen reader announces new moments
- Focus visible for keyboard users
- Touch targets meet 44px minimum
-->
<script lang="ts">
	import type { KeyMoment } from '$lib/core/thoughts/types';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	interface Props {
		moments: KeyMoment[];
		onmomentclick: (moment: KeyMoment) => void;
	}

	let { moments, onmomentclick }: Props = $props();

	// Track previous moment count for entrance animations
	let previousCount = $state(0);

	$effect(() => {
		if (moments.length > previousCount) {
			previousCount = moments.length;
		}
	});

	// Icon color schemes by type
	const typeSchemes = {
		citation: {
			bg: 'bg-blue-50/90 hover:bg-blue-100/95',
			border: 'border-blue-200/60',
			text: 'text-blue-700',
			ring: 'focus-visible:ring-blue-500/50'
		},
		action: {
			bg: 'bg-emerald-50/90 hover:bg-emerald-100/95',
			border: 'border-emerald-200/60',
			text: 'text-emerald-700',
			ring: 'focus-visible:ring-emerald-500/50'
		},
		insight: {
			bg: 'bg-amber-50/90 hover:bg-amber-100/95',
			border: 'border-amber-200/60',
			text: 'text-amber-700',
			ring: 'focus-visible:ring-amber-500/50'
		},
		decision_maker: {
			bg: 'bg-orange-50/90 hover:bg-orange-100/95',
			border: 'border-orange-200/60',
			text: 'text-orange-700',
			ring: 'focus-visible:ring-orange-500/50'
		},
		document: {
			bg: 'bg-indigo-50/90 hover:bg-indigo-100/95',
			border: 'border-indigo-200/60',
			text: 'text-indigo-700',
			ring: 'focus-visible:ring-indigo-500/50'
		}
	};

	function getScheme(type: KeyMoment['type']) {
		return typeSchemes[type];
	}
</script>

{#if moments.length > 0}
	<footer
		class="key-moments fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-md"
		style="
			background: linear-gradient(to top, oklch(0.995 0.003 60 / 0.95), oklch(0.99 0.003 60 / 0.92));
			border-color: oklch(0.88 0.01 60 / 0.25);
			box-shadow: 0 -4px 20px -8px oklch(0.2 0.02 60 / 0.15);
		"
		role="complementary"
		aria-label="Key moments from agent reasoning"
		in:fly={{ y: 100, duration: 300, easing: quintOut }}
	>
		<div class="mx-auto max-w-7xl px-4 py-3">
			<div class="flex items-center gap-3">
				<!-- Label -->
				<span
					class="shrink-0 text-xs font-medium uppercase tracking-wider"
					style="color: oklch(0.45 0.02 60);"
				>
					Key Moments
				</span>

				<!-- Moments row - horizontal scroll -->
				<div class="moments-row flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
					{#each moments as moment, i (moment.id)}
						{@const scheme = getScheme(moment.type)}
						<button
							class="moment-chip group flex shrink-0 items-center gap-2 rounded-full border px-3 py-2
								transition-all duration-200 ease-out
								focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1
								{scheme.bg} {scheme.border} {scheme.text} {scheme.ring}"
							style="min-height: 44px; min-width: 44px;"
							onclick={() => onmomentclick(moment)}
							aria-label="View {moment.label}"
							in:fly={{
								x: -20,
								duration: 200,
								delay: i === moments.length - 1 ? 100 : 0,
								easing: quintOut
							}}
						>
							<!-- Icon -->
							<span
								class="flex h-5 w-5 shrink-0 items-center justify-center text-sm transition-transform
									group-hover:scale-110"
								aria-hidden="true"
							>
								{moment.icon}
							</span>

							<!-- Label -->
							<span class="whitespace-nowrap text-sm font-medium">
								{moment.label}
							</span>
						</button>
					{/each}
				</div>
			</div>
		</div>
	</footer>
{/if}

<style>
	/* Custom scrollbar for moments row */
	.moments-row {
		scrollbar-width: thin;
		scrollbar-color: oklch(0.7 0.01 60 / 0.3) transparent;
	}

	.moments-row::-webkit-scrollbar {
		height: 4px;
	}

	.moments-row::-webkit-scrollbar-track {
		background: transparent;
	}

	.moments-row::-webkit-scrollbar-thumb {
		background: oklch(0.7 0.01 60 / 0.3);
		border-radius: 2px;
	}

	.moments-row::-webkit-scrollbar-thumb:hover {
		background: oklch(0.6 0.01 60 / 0.4);
	}

	/* Smooth scroll behavior */
	.moments-row {
		scroll-behavior: smooth;
		-webkit-overflow-scrolling: touch; /* iOS momentum scrolling */
	}

	/* Lift effect on hover */
	.moment-chip:hover {
		transform: translateY(-1px);
		box-shadow: 0 2px 8px oklch(0.2 0.02 60 / 0.12);
	}

	.moment-chip:active {
		transform: translateY(0);
	}
</style>
