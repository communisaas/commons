<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { tick as _tick } from 'svelte';
	import type { PopoverSlots as _PopoverSlots } from '$lib/types/popover';
	import { browser } from '$app/environment';
	import { coordinated, useTimerCleanup, timerCoordinator } from '$lib/utils/timerCoordinator';
	import type { Snippet } from 'svelte';
	import type { TriggerAction } from '$lib/types/any-replacements.js';

	interface Props {
		open?: boolean;
		id?: string;
		trigger?: Snippet<[TriggerAction]>;
		children?: Snippet<[{ open: boolean }]>;
	}

	let {
		open = $bindable(false),
		id = `popover-${Math.random().toString(36).substr(2, 9)}`,
		trigger,
		children
	}: Props = $props();

	let popoverElement: HTMLDivElement | undefined = $state();
	let containerElement: HTMLDivElement | undefined = $state();

	// Create the trigger action (derived so it stays reactive with id prop)
	const triggerAction: TriggerAction = $derived({
		trigger: () => {
			open = !open;
		},
		'aria-controls': id
	});

	// Track events that should trigger position updates
	function handleScroll() {
		if (open) {
			open = false;

		}
	}

	function handleResize() {
		if (open) {
			requestAnimationFrame(updatePosition);
		}
	}

	onMount(() => {
		// Add event listeners
		window.addEventListener('scroll', handleScroll, true); // true for capture phase to catch all scroll events
		window.addEventListener('resize', handleResize);
	});

	onDestroy(() => {
		// Clean up event listeners
		if (browser) {
			window.removeEventListener('scroll', handleScroll, true);
			window.removeEventListener('resize', handleResize);
		}
		useTimerCleanup(componentId)();
	});

	async function handleMouseEnter() {
		open = true;

		await _tick();
		updatePosition();
	}

	function handleMouseLeave() {
		open = false;

	}

	function updatePosition() {
		if (!popoverElement || !containerElement) return;

		const triggerRect = containerElement.getBoundingClientRect();
		const popoverRect = popoverElement.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		// Find the closest modal parent if it exists
		const modalParent = containerElement.closest('[role="document"]');
		let modalTransform = { x: 0, y: 0 };

		if (modalParent) {
			// Extract transform values from the modal
			const transform = window.getComputedStyle(modalParent).transform;
			if (transform && transform !== 'none') {
				const matrix = new DOMMatrix(transform);
				modalTransform = {
					x: matrix.m41,
					y: matrix.m42
				};
			}
		}

		// Calculate available space in each direction
		const spaceAbove = triggerRect.top;
		const spaceBelow = viewportHeight - triggerRect.bottom;

		// Determine vertical position
		let verticalPosition: 'top' | 'bottom' =
			spaceBelow >= popoverRect.height || spaceBelow > spaceAbove ? 'bottom' : 'top';

		// Calculate positions
		let top: number;
		let left = triggerRect.left;

		// Vertical positioning with modal offset compensation
		if (verticalPosition === 'bottom') {
			top = triggerRect.bottom + 8 - modalTransform.y;
		} else {
			top = triggerRect.top - popoverRect.height - 8 - modalTransform.y;
		}

		// Horizontal positioning
		if (left + popoverRect.width > viewportWidth - 16) {
			left = triggerRect.right - popoverRect.width;
		}
		if (left < 16) {
			left = Math.max(
				16,
				Math.min(
					triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2,
					viewportWidth - popoverRect.width - 16
				)
			);
		}

		// Apply positions with modal transform offset
		popoverElement.style.position = 'fixed';
		popoverElement.style.top = `${top - modalTransform.y}px`;
		popoverElement.style.left = `${left - modalTransform.x}px`;
		popoverElement.style.maxWidth = `${viewportWidth - 32}px`;
	}

	function handleFocus() {
		open = true;

		_tick().then(updatePosition);
	}

	function handleBlur(__event: FocusEvent) {
		const currentTarget = __event.currentTarget as HTMLElement;
		const relatedTarget = __event.relatedTarget as Node | null;

		if (currentTarget && relatedTarget && !currentTarget.contains(relatedTarget)) {
			open = false;

		}
	}

	function handleKeydown(__event: KeyboardEvent) {
		if (__event.key === 'Escape' && open) {
			open = false;

		}
	}

	let _isTouch = false;
	let touchTimeout: string | null = null;

	// Component ID for timer coordination
	const componentId = 'popover-' + Math.random().toString(36).substring(2, 15);

	function handleTouchStart(__event: TouchEvent) {
		// Don't handle touch events from within the popover content
		if (popoverElement?.contains(__event.target as Node)) {
			return;
		}

		_isTouch = true;
		// Clear any existing timeout
		if (touchTimeout) {
			timerCoordinator.clearTimer(touchTimeout);
		}

		open = !open;
		if (open) {
	
			_tick().then(updatePosition);
		} else {

		}

		// Reset isTouch after a delay to allow mouse events again
		touchTimeout = coordinated.setTimeout(
			() => {
				_isTouch = false;
				touchTimeout = null;
			},
			500,
			'gesture',
			componentId
		);
	}
</script>

<div
	bind:this={containerElement}
	class="relative inline-block"
	role="button"
	tabindex="-1"
	onmouseenter={handleMouseEnter}
	onmouseleave={handleMouseLeave}
	ontouchstart={handleTouchStart}
	onkeydown={handleKeydown}
	onfocusin={handleFocus}
	onfocusout={handleBlur}
	aria-haspopup="true"
	aria-expanded={open}
>
	{@render trigger?.(triggerAction)}

	{#if open}
		<!-- Update z-index to be higher than modal -->
		<div
			class="fixed z-[99]"
			role="presentation"
			onmouseenter={handleMouseEnter}
			onmouseleave={handleMouseLeave}
			style="
                left: {containerElement?.getBoundingClientRect().left}px;
                width: {containerElement?.getBoundingClientRect().width}px;
                top: {containerElement?.getBoundingClientRect().bottom}px;
                height: 8px;
            "
		></div>

		<div
			bind:this={popoverElement}
			{id}
			role="tooltip"
			class="z-[100] rounded-md border border-slate-200 bg-white shadow-md"
			transition:fade={{ duration: 200 }}
			style="position: fixed; isolation: isolate;"
			onmouseenter={handleMouseEnter}
			onmouseleave={handleMouseLeave}
		>
			{@render children?.({ open })}
		</div>
	{/if}
</div>
