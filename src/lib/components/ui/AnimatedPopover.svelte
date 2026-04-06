<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { tick as _tick } from 'svelte';
	import type { PopoverSlots as _PopoverSlots, TriggerAction } from '$lib/types/popover';
	import type { Snippet } from 'svelte';
	import { addEventListener, addDocumentEventListener } from '$lib/utils/browserUtils';
	interface Props {
		id: string;
		animationStyle?: 'scale' | 'fly' | 'expand';
		duration?: number;
		trigger?: Snippet<[{ triggerAction: TriggerAction }]>;
		children?: Snippet<[{ open: boolean }]>;
	}

	const { id, animationStyle = 'expand', duration = 200, trigger, children }: Props = $props();

	let popoverElement: HTMLDivElement | undefined = $state();
	let containerElement: HTMLDivElement;
	let contentWrapper: HTMLDivElement | undefined = $state();
	let _position = $state('bottom');
	let isPositioned = $state(false);

	let open = $state(false);
	let closeTimeout: ReturnType<typeof setTimeout> | null = null;

	// Portal: a persistent div on document.body that we move content into
	let portalDiv: HTMLDivElement | null = null;

	const triggerAction: TriggerAction = (_node) => {
		return { destroy: () => {} };
	};

	function handleScroll() {
		if (open && containerElement) {
			const rect = containerElement.getBoundingClientRect();
			if (rect.bottom < -20 || rect.top > window.innerHeight + 20) {
				open = false;
			} else {
				requestAnimationFrame(updatePosition);
			}
		}
	}

	function handleResize() {
		if (open && isPositioned) {
			requestAnimationFrame(updatePosition);
		}
	}

	let cleanupFunctions: (() => void)[] = [];

	onMount(() => {
		// Create portal div on body
		portalDiv = document.createElement('div');
		portalDiv.dataset.popoverPortal = id;
		portalDiv.style.cssText = 'position:fixed; z-index:9999; pointer-events:none; top:0; left:0; width:0; height:0;';
		document.body.appendChild(portalDiv);

		const scrollCleanup = addEventListener('scroll', handleScroll, true);
		const resizeCleanup = addEventListener('resize', handleResize);

		const handleGlobalClick = (event: MouseEvent) => {
			if (isTouch) return;
			if (!containerElement || !popoverElement) return;
			const target = event.target as Node;
			if (popoverElement.contains(target) && isFormElement(event.target)) return;
			if (!containerElement.contains(target) && !popoverElement.contains(target)) {
				open = false;
			}
		};
		const clickCleanup = addDocumentEventListener('click', handleGlobalClick, true);

		const handleGlobalTouch = (event: TouchEvent) => {
			if (!isTouch || !containerElement || !popoverElement) return;
			const target = event.target as Node;
			if (popoverElement.contains(target) && isFormElement(event.target)) return;
			if (!containerElement.contains(target) && !popoverElement.contains(target)) {
				open = false;
			}
		};
		const touchCleanup = addDocumentEventListener('touchstart', handleGlobalTouch, {
			capture: true, passive: false
		});

		cleanupFunctions = [scrollCleanup, resizeCleanup, clickCleanup, touchCleanup].filter(Boolean) as (() => void)[];
	});

	onDestroy(() => {
		cleanupFunctions.forEach((fn) => fn());
		if (closeTimeout) clearTimeout(closeTimeout);
		if (touchTimeout) clearTimeout(touchTimeout);
		if (portalDiv?.parentNode) {
			portalDiv.parentNode.removeChild(portalDiv);
			portalDiv = null;
		}
	});

	// Move the Svelte-rendered content into the portal when it appears
	$effect(() => {
		if (open && contentWrapper && portalDiv) {
			// Move the content wrapper into the portal
			portalDiv.appendChild(contentWrapper);
			popoverElement = contentWrapper;

			_tick().then(() => {
				updatePosition();
				// Animate in
				requestAnimationFrame(() => {
					if (contentWrapper) {
						contentWrapper.style.opacity = '1';
						contentWrapper.style.transform = 'scale(1)';
					}
				});
			});
		}
	});

	// When closing, move content back before Svelte destroys it
	$effect(() => {
		if (!open && contentWrapper && portalDiv) {
			isPositioned = false;
			popoverElement = undefined;
		}
	});

	let isTouch = false;
	let touchTimeout: ReturnType<typeof setTimeout> | null = null;

	function handleMouseEnter() {
		if (!isTouch) {
			if (closeTimeout) { clearTimeout(closeTimeout); closeTimeout = null; }
			open = true;
		}
	}

	function handleMouseLeave(event: MouseEvent) {
		if (!isTouch) {
			const delay = popoverElement ? getCloseDelay(event, popoverElement) : 150;
			closeTimeout = setTimeout(() => { open = false; closeTimeout = null; }, delay);
		}
	}

	function handlePopoverMouseEnter() {
		if (!isTouch) {
			if (closeTimeout) { clearTimeout(closeTimeout); closeTimeout = null; }
		}
	}

	function handlePopoverMouseLeave(event: MouseEvent) {
		if (!isTouch) {
			const delay = containerElement ? getCloseDelay(event, containerElement) : 150;
			closeTimeout = setTimeout(() => { open = false; closeTimeout = null; }, delay);
		}
	}

	function getCloseDelay(event: MouseEvent, target: HTMLElement): number {
		const rect = target.getBoundingClientRect();
		const isHeadingToward =
			event.clientY >= rect.top - 20 && event.clientY <= rect.bottom + 20 &&
			event.clientX >= rect.left - 20 && event.clientX <= rect.right + 20;
		return isHeadingToward ? 300 : 150;
	}

	function isFormElement(target: EventTarget | null): boolean {
		if (!target || !(target instanceof Element)) return false;
		const formTags = ['input', 'textarea', 'select', 'button'];
		return formTags.includes(target.tagName.toLowerCase()) ||
			(target as HTMLElement).contentEditable === 'true' ||
			target.closest('input, textarea, select, button') !== null;
	}

	function handleTouchStart(event: TouchEvent) {
		isTouch = true;
		const target = event.target as Element;
		if (popoverElement?.contains(target) && isFormElement(event.target)) return;
		event.stopPropagation();
		if (touchTimeout) clearTimeout(touchTimeout);
		open = !open;
		if (open) _tick().then(updatePosition);
		touchTimeout = setTimeout(() => { isTouch = false; touchTimeout = null; }, 1000);
	}

	function handleTouchEnd(event: TouchEvent) {
		if (!isFormElement(event.target)) event.preventDefault();
	}

	function updatePosition() {
		if (!popoverElement || !containerElement) return;

		const triggerRect = containerElement.getBoundingClientRect();
		const viewportHeight = window.innerHeight;
		const viewportWidth = window.innerWidth;
		const margin = 8;
		const GAP = 6;

		const innerCard = popoverElement.querySelector('.popover-card') as HTMLElement;
		// scrollHeight gives natural content height even when max-height is constraining
		const cardHeight = innerCard?.scrollHeight || 50;
		const popoverWidth = innerCard?.offsetWidth || popoverElement.offsetWidth || 250;

		const spaceBelow = viewportHeight - triggerRect.bottom - GAP - margin;
		const spaceAbove = triggerRect.top - GAP - margin;

		const verticalPosition: 'top' | 'bottom' =
			spaceBelow >= cardHeight || spaceBelow >= spaceAbove ? 'bottom' : 'top';

		const availableHeight = verticalPosition === 'bottom' ? spaceBelow : spaceAbove;

		// Constrain card height when content exceeds available viewport space
		let effectiveCardHeight = cardHeight;
		if (innerCard) {
			if (cardHeight > availableHeight && availableHeight > 0) {
				effectiveCardHeight = Math.max(availableHeight, 100);
				innerCard.style.maxHeight = `${effectiveCardHeight}px`;
				innerCard.style.overflowY = 'auto';
				innerCard.style.overscrollBehavior = 'contain';
			} else {
				innerCard.style.maxHeight = '';
				innerCard.style.overflowY = '';
				innerCard.style.overscrollBehavior = '';
			}
		}

		const totalHeight = effectiveCardHeight + GAP;

		let top: number;
		if (verticalPosition === 'bottom') {
			top = triggerRect.bottom;
			_position = 'bottom';
		} else {
			top = triggerRect.top - totalHeight;
			_position = 'top';
		}

		const idealLeft = triggerRect.left + triggerRect.width / 2 - popoverWidth / 2;
		let left: number;
		if (idealLeft < margin) left = margin;
		else if (idealLeft + popoverWidth > viewportWidth - margin) left = viewportWidth - popoverWidth - margin;
		else left = idealLeft;

		top = Math.max(margin, Math.min(top, viewportHeight - totalHeight - margin));

		popoverElement.style.top = `${top}px`;
		popoverElement.style.left = `${left}px`;

		if (!isPositioned) isPositioned = true;
	}
</script>

<div class="contents">
	<div
		bind:this={containerElement}
		class="relative inline-block"
		style="touch-action: manipulation;"
		onmouseenter={handleMouseEnter}
		onmouseleave={handleMouseLeave}
		ontouchstart={handleTouchStart}
		ontouchend={handleTouchEnd}
		role="button"
		tabindex="0"
		aria-haspopup="true"
		aria-expanded={open}
	>
		{#if trigger}
			{@render trigger({ triggerAction })}
		{/if}
	</div>

	{#if open}
		<div
			bind:this={contentWrapper}
			class="fixed min-w-[200px] max-w-[320px]"
			style="z-index: 9999; pointer-events: auto; opacity: 0; transform: scale(0.95); transition: opacity 150ms ease-out, transform 150ms ease-out; padding-top: {_position === 'bottom' ? '6px' : '0'}; padding-bottom: {_position === 'top' ? '6px' : '0'};"
			onmouseenter={handlePopoverMouseEnter}
			onmouseleave={handlePopoverMouseLeave}
			ontouchstart={(e) => e.stopPropagation()}
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => { if (e.key === 'Escape') open = false; }}
			role="dialog"
			aria-modal="false"
			tabindex="0"
		>
			<div class="popover-card whitespace-normal rounded-lg border border-gray-200 bg-white shadow-lg">
				<div class="px-3 py-2 text-sm">
					{#if children}
						{@render children({ open })}
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
