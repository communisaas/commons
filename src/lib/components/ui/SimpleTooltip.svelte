<script lang="ts">
	import { fly, fade } from 'svelte/transition';

	interface Props {
		content: string;
		placement?: 'top' | 'bottom' | 'left' | 'right';
		show: boolean;
	}

	const { content, placement = 'top', show }: Props = $props();

	// Position classes based on placement
	const positionClasses = {
		top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
		bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
		left: 'right-full top-1/2 -translate-y-1/2 mr-2',
		right: 'left-full top-1/2 -translate-y-1/2 ml-2'
	};

	// Animation direction based on placement
	const animationProps = {
		top: { y: 5 },
		bottom: { y: -5 },
		left: { x: 5 },
		right: { x: -8 }
	};
</script>

{#if show}
	<div
		class="pointer-events-none absolute z-[9999] {positionClasses[placement]}"
		in:fly={{ ...animationProps[placement], duration: 150 }}
		out:fade={{ duration: 100 }}
	>
		<div class="relative">
			<div
				class="whitespace-nowrap rounded bg-gray-900 px-2 py-1.5 text-xs font-medium leading-none text-white shadow-md"
			>
				{content}
			</div>
			<!-- Arrow positioned outside the rounded container based on placement -->
			{#if placement === 'bottom'}
				<div
					class="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 transform bg-gray-900"
				></div>
			{:else if placement === 'top'}
				<div
					class="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 transform bg-gray-900"
				></div>
			{:else if placement === 'right'}
				<div
					class="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 transform bg-gray-900"
				></div>
			{:else if placement === 'left'}
				<div
					class="absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 transform bg-gray-900"
				></div>
			{/if}
		</div>
	</div>
{/if}
