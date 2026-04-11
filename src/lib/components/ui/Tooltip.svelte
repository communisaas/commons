<script lang="ts">
	import { Info } from '@lucide/svelte';
	import { onMount, onDestroy, tick as _tick, type Snippet } from 'svelte';
	import { get } from 'svelte/store';
	import { activeTooltipId } from '$lib/stores/tooltip';

	interface Props {
		content: string;
		containerClass?: string;
		showInfoIcon?: boolean;
		children?: Snippet;
	}

	const { content, containerClass = '', showInfoIcon = true, children }: Props = $props();

	// Generate unique ID for this tooltip instance
	const id = `tooltip-${Math.random().toString(36).substr(2, 9)}`;
	let show = $state(false);

	// Update show state based on active tooltip
	const unsubscribe = activeTooltipId.subscribe((activeId) => {
		show = activeId === id;
	});

	onDestroy(() => {
		unsubscribe();
	});

	let isTouchInteraction = false;

	function handleTouch(__event: TouchEvent | MouseEvent) {
		if (__event instanceof MouseEvent) {
			if (!window.matchMedia('(hover: hover)').matches) {
				__event.preventDefault();
				__event.stopPropagation();
				toggleTooltip();
			}
		} else if (__event.type === 'touchstart') {
			isTouchInteraction = true;
			toggleTooltip();
		}
	}

	function toggleTooltip() {
		if (get(activeTooltipId) === id) {
			activeTooltipId.set(null);
		} else {
			activeTooltipId.set(id);
		}
	}

	let isPositioned = $state(false);

	async function handleMouseEnter() {
		// Calculate position before showing
		show = true;
		isPositioned = false;

		// Wait for next tick to ensure DOM is updated
		await _tick();
		updatePosition();
		isPositioned = true;
	}

	function handleMouseLeave() {
		show = false;
		isPositioned = false;
	}

	// Handle clicks/touches outside of tooltips
	function handleGlobalClick(__event: MouseEvent | TouchEvent) {
		// Don't handle if the event was already handled by a tooltip
		if (__event.defaultPrevented) return;

		// If this is a touch event and we're in a touch interaction, only handle touchstart
		if (__event instanceof TouchEvent) {
			if (__event.type !== 'touchstart') return;

			const target = __event.target as HTMLElement;
			if (!target.closest(`[data-tooltip-id="${id}"]`) && !target.closest('[role="tooltip"]')) {
				activeTooltipId.set(null);
			}
			return;
		}

		// For mouse clicks, close if clicking outside
		const target = __event.target as HTMLElement;
		if (!target.closest('[role="tooltip"]')) {
			activeTooltipId.set(null);
		}
	}

	function handleTouchEnd(__event: TouchEvent) {
		// Prevent touchend from triggering click events
		if (isTouchInteraction) {
			__event.preventDefault();
			isTouchInteraction = false;
		}
	}

	// Add keyboard handler
	function handleKeyDown(__event: KeyboardEvent) {
		if (__event.key === 'Enter' || __event.key === ' ') {
			__event.preventDefault();
			if (get(activeTooltipId) === id) {
				activeTooltipId.set(null);
			} else {
				activeTooltipId.set(id);
			}
		}
	}

	let tooltipElement: HTMLDivElement | undefined = $state();
	let containerElement: HTMLSpanElement;
	let infoIconElement: HTMLDivElement | undefined = $state();
	let position: 'top' | 'bottom' | 'left' | 'right' = $state('top');

	function updatePosition() {
		if (!tooltipElement || !containerElement) return;

		// Get the reference element for positioning
		const referenceRect =
			showInfoIcon && infoIconElement
				? infoIconElement.getBoundingClientRect()
				: containerElement.getBoundingClientRect();

		const viewportHeight = window.innerHeight;
		const viewportWidth = window.innerWidth;
		const margin = 16;

		// Calculate available space in each direction from the reference center
		const spaceAbove = referenceRect.top;
		const spaceBelow = viewportHeight - referenceRect.bottom;
		const spaceLeft = referenceRect.left;
		const spaceRight = viewportWidth - referenceRect.right;

		// Find the direction with most space
		const spaces = [
			{ dir: 'top', space: spaceAbove },
			{ dir: 'bottom', space: spaceBelow },
			{ dir: 'left', space: spaceLeft },
			{ dir: 'right', space: spaceRight }
		];

		position = spaces.reduce((prev, curr) => (curr.space > prev.space ? curr : prev))
			.dir as typeof position;

		// Reset styles for recalculation
		tooltipElement.style.width = 'fit-content';
		tooltipElement.style.maxWidth = '';

		// Get the natural content width
		const tooltipRect = tooltipElement.getBoundingClientRect();
		const contentWidth = tooltipRect.width;

		// Calculate optimal width based on position
		const isVertical = position === 'top' || position === 'bottom';
		if (isVertical) {
			const referenceCenterX = referenceRect.left + referenceRect.width / 2;
			const maxLeftWidth = referenceCenterX - margin;
			const maxRightWidth = viewportWidth - referenceCenterX - margin;

			const maxWidth = Math.min(
				Math.max(maxLeftWidth, maxRightWidth) * 2,
				viewportWidth - margin * 2
			);

			tooltipElement.style.maxWidth = `${Math.max(contentWidth, maxWidth)}px`;
		} else {
			// For left/right positioning, use most of the available space
			const availableWidth =
				position === 'left'
					? referenceRect.left - margin
					: viewportWidth - referenceRect.right - margin;
			tooltipElement.style.maxWidth = `${Math.max(
				contentWidth,
				availableWidth * 0.9 // Use 90% of available space
			)}px`;
		}

		// Calculate position coordinates for fixed positioning
		let top = 0;
		let left = 0;

		if (position === 'top') {
			top = referenceRect.top - tooltipElement.offsetHeight - 8;
			left = referenceRect.left + referenceRect.width / 2 - tooltipElement.offsetWidth / 2;
		} else if (position === 'bottom') {
			top = referenceRect.bottom + 8;
			left = referenceRect.left + referenceRect.width / 2 - tooltipElement.offsetWidth / 2;
		} else if (position === 'left') {
			top = referenceRect.top + referenceRect.height / 2 - tooltipElement.offsetHeight / 2;
			left = referenceRect.left - tooltipElement.offsetWidth - 8;
		} else if (position === 'right') {
			top = referenceRect.top + referenceRect.height / 2 - tooltipElement.offsetHeight / 2;
			left = referenceRect.right + 8;
		}

		// Ensure tooltip stays within viewport bounds
		top = Math.max(margin, Math.min(top, viewportHeight - tooltipElement.offsetHeight - margin));
		left = Math.max(margin, Math.min(left, viewportWidth - tooltipElement.offsetWidth - margin));

		tooltipElement.style.top = `${top}px`;
		tooltipElement.style.left = `${left}px`;
	}

	$effect(() => {
		if (show) {
			_tick().then(updatePosition);
		}
	});

	function handleScroll() {
		if (show) {
			// Hide tooltip on scroll to prevent it from becoming detached
			activeTooltipId.set(null);
		}
	}

	onMount(() => {
		window.addEventListener('resize', updatePosition);
		window.addEventListener('scroll', handleScroll, true);
		document.addEventListener('touchstart', handleGlobalClick, true);
		document.addEventListener('touchend', handleTouchEnd, true);
		document.addEventListener('click', handleGlobalClick, true);

		return () => {
			window.removeEventListener('resize', updatePosition);
			window.removeEventListener('scroll', handleScroll, true);
			document.removeEventListener('touchstart', handleGlobalClick, true);
			document.removeEventListener('touchend', handleTouchEnd, true);
			document.removeEventListener('click', handleGlobalClick, true);
		};
	});
</script>

<!-- 
  Using span with ARIA attributes for tooltip functionality.
  We're ignoring a11y warnings because this is a custom tooltip implementation
  that needs to work both standalone and nested within interactive elements.
-->
<span
	bind:this={containerElement}
	role="button"
	data-tooltip-id={id}
	aria-label={content}
	class="group relative inline-flex cursor-help items-center {containerClass}"
	onmouseenter={handleMouseEnter}
	tabindex="0"
	onmouseleave={handleMouseLeave}
	onclick={handleTouch}
	ontouchstart={handleTouch}
	ontouchend={(e) => {
		e.preventDefault();
		handleTouch(e);
	}}
	onkeydown={handleKeyDown}
>
	<div class="min-w-0 truncate">
		{#if children}
			{@render children()}
		{/if}
	</div>
	{#if showInfoIcon}
		<div bind:this={infoIconElement} class="relative">
			<Info class="ml-1 h-4 w-4 shrink-0 text-slate-400" />

			<div
				bind:this={tooltipElement}
				class="fixed z-[100] min-w-[12rem] whitespace-normal rounded bg-slate-800 px-2.5 py-1.5 text-sm
                       text-white shadow-md
                       {show ? 'opacity-100' : 'pointer-events-none opacity-0'}
                       {isPositioned ? 'transition-opacity duration-150' : 'transition-none'}"
				style="top: 0; left: 0;"
			>
				{content}

				<div
					class="absolute h-0 w-0 border-[6px] border-transparent
                            {position === 'top'
						? 'left-1/2 top-full -translate-x-1/2 border-t-slate-800'
						: ''}
                            {position === 'bottom'
						? 'bottom-full left-1/2 -translate-x-1/2 border-b-slate-800'
						: ''}
                            {position === 'left'
						? 'left-full top-1/2 -translate-y-1/2 border-l-slate-800'
						: ''}
                            {position === 'right'
						? 'right-full top-1/2 -translate-y-1/2 border-r-slate-800'
						: ''}"
				></div>
			</div>
		</div>
	{:else}
		<div
			bind:this={tooltipElement}
			class="fixed z-[100] min-w-[12rem] whitespace-normal rounded-lg bg-slate-800 px-3 py-2 text-sm
                   text-white shadow-lg
                   {show ? 'opacity-100' : 'pointer-events-none opacity-0'}
                   {isPositioned ? 'transition-opacity duration-150' : 'transition-none'}"
			style="top: 0; left: 0;"
		>
			{content}

			<div
				class="absolute h-0 w-0 border-[6px] border-transparent
                        {position === 'top'
					? 'left-1/2 top-full -translate-x-1/2 border-t-slate-800'
					: ''}
                        {position === 'bottom'
					? 'bottom-full left-1/2 -translate-x-1/2 border-b-slate-800'
					: ''}
                        {position === 'left'
					? 'left-full top-1/2 -translate-y-1/2 border-l-slate-800'
					: ''}
                        {position === 'right'
					? 'right-full top-1/2 -translate-y-1/2 border-r-slate-800'
					: ''}"
			></div>
		</div>
	{/if}
</span>
