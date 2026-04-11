<script lang="ts">
	/// <reference types="dom" />
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { scale } from 'svelte/transition';
	import { X } from '@lucide/svelte';
	import { tweened, spring } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	// // import { fade } from 'svelte/transition';
	import type { ModalScrollState } from '$lib/types/modal';
	import { coordinated, useTimerCleanup } from '$lib/utils/timerCoordinator';

	let {
		onclose,
		_onscrollStateChange,
		_inModal,
		children
	}: {
		onclose?: () => void;
		_onscrollStateChange?: (state: ModalScrollState) => void;
		_inModal?: boolean;
		children?: import('svelte').Snippet;
	} = $props();

	let dialogElement: HTMLDivElement | undefined = $state(undefined);
	let isOpen = $state(false);
	let scrollPosition: number;
	let modalContent: HTMLDivElement | undefined = $state(undefined);
	let touchStart = 0;
	let _currentTouchY = 0;
	let isDismissing = false;
	let swipeDirection: 'up' | 'down' | null = $state(null);

	const translateY = spring(0, {
		stiffness: 0.35,
		damping: 0.4,
		precision: 0.0001
	});

	const dismissHintOpacity = tweened(0, {
		duration: 200,
		easing: cubicOut
	});

	let _scrollState: ModalScrollState & {
		touchState?: {
			touchY: number;
			deltaY: number;
			isScrolling: boolean;
			isAtTop: boolean;
			isAtBottom: boolean;
		};
	} = {
		canDismissTop: true,
		canDismissBottom: true,
		scrollProgress: 0
	};

	let _touchStartTarget: EventTarget | null = null;
	let activeScrollableEl: HTMLElement | null = null;
	let gestureMode: 'scroll' | 'dismiss' | null = $state(null);

	let viewportHeight = 0;

	// Calculate thresholds based on viewport height
	const dismissThreshold = $derived(viewportHeight * 0.15); // 15% of viewport height
	const dismissHintThreshold = $derived(viewportHeight * 0.15); // 15% of viewport height
	const dismissAnimationDistance = $derived(viewportHeight); // Full viewport height for dismiss animation

	// Update resistance based on viewport height
	const resistance = $derived(Math.max(0.3, Math.min(0.5, viewportHeight / 1000)));

	// Add a store for the hint scale animation
	const hintScale = tweened(0.8, {
		duration: 100,
		easing: cubicOut
	});

	// Add a store for the blur amount with shorter duration for smoother updates
	const blurAmount = tweened(0, {
		duration: 0, // No duration for immediate response
		easing: cubicOut
	});

	let isPastThreshold = $state(false);

	let lastTouchTime: number;
	let lastTouchY: number;
	let velocity = 0;

	let scrollableContent = {
		isScrollable: false,
		isAtTop: true,
		isAtBottom: true,
		touchY: 0,
		touchStartY: 0,
		scrollPosition: 0,
		maxScroll: 0
	};

	// Component ID for timer coordination
	const componentId = 'modal-' + Math.random().toString(36).substring(2, 15);

	// Add new state for tracking dismissal transition
	let initialDismissY: number | null = null;
	let dismissStartTranslateY = 0; // Track where the modal was when dismissal started

	// Add gesture state tracking
	let isInDismissalGesture = false;

	// Add a new store for gesture progress at the top with other stores
	const gestureProgress = tweened(0, {
		duration: 0, // No duration for immediate response
		easing: cubicOut
	});

	function updateViewportHeight() {
		viewportHeight = window.innerHeight;
	}

	function handleModalInteraction(e: MouseEvent | KeyboardEvent) {
		if (!isOpen) return;

		if (e.type === 'click') {
			const mouseEvent = e as MouseEvent;
			const clickedElement = mouseEvent.target as HTMLElement;

			// Close when clicking the backdrop (dialogElement)
			if (clickedElement === dialogElement) {
				close();
			}
		}

		if (e.type === 'keydown' && (e as KeyboardEvent).key === 'Escape') {
			close();
		}
	}

	function close() {
		unlockScroll(); // Ensure scroll is unlocked when closing via any method
		onclose?.();
		closeModal();
	}

	function closeModal() {
		if (isDismissing) {
			preventScroll(false); // Re-enable scrolling
		}
		unlockScroll(); // Restore page scrolling when modal closes
		isOpen = false;
	}

	function lockScroll() {
		if (!browser) return;
		scrollPosition = window.scrollY;
		document.body.style.position = 'fixed';
		document.body.style.top = `-${scrollPosition}px`;
		document.body.style.width = '100%';
	}

	function unlockScroll() {
		if (!browser) return;
		document.body.style.position = '';
		document.body.style.top = '';
		document.body.style.width = '';
		window.scrollTo(0, scrollPosition);
	}

	function handleTouchStart(e: TouchEvent) {
		touchStart = e.touches[0].clientY;
		_currentTouchY = touchStart;
		isInDismissalGesture = isDismissing; // Track if we started in dismissal
		initialDismissY = null; // Reset the initial dismiss position
		dismissStartTranslateY = $translateY; // Capture starting position
		_touchStartTarget = e.target;
		activeScrollableEl = (e.target as HTMLElement)?.closest(
			'.overflow-y-auto, .overflow-auto, .overflow-scroll'
		) as HTMLElement | null;
		gestureMode = null;

		// Reset velocity tracking
		lastTouchTime = Date.now();
		lastTouchY = touchStart;
		velocity = 0;
	}

	function preventScroll(pr_event: boolean) {
		// Find all scrollable elements within the modal
		const scrollableElements = modalContent?.querySelectorAll('.overflow-y-auto, .overflow-auto');

		scrollableElements?.forEach((element) => {
			if (pr_event) {
				(element as HTMLElement).style.overflow = 'hidden';
			} else {
				(element as HTMLElement).style.overflow = '';
			}
		});
	}

	function handleTouchMove(e: TouchEvent) {
		const isPopoverTrigger = (e.target as HTMLElement).closest('[aria-haspopup="true"]');
		// Check if the touch started on a popover trigger
		if (isPopoverTrigger) {
			return; // Let the popover handle its own touch events
		}

		// If the touch is inside a scrollable element and that element can continue scrolling
		// in the swipe direction, do not engage modal dismissal.
		const scrollableTarget = (e.target as HTMLElement).closest('.overflow-y-auto, .overflow-auto');
		if (scrollableTarget) {
			const el = scrollableTarget as HTMLElement;
			const currentY = e.touches[0].clientY;
			const directionDown = currentY > touchStart;
			const isAtTop = el.scrollTop <= 0;
			const isAtBottom = Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 1;

			// If we can scroll within the target in the swipe direction, ignore modal logic
			if ((directionDown && !isAtTop) || (!directionDown && !isAtBottom)) {
				// Allow native scrolling by not calling preventDefault and exiting early
				return;
			}
		}

		const currentTime = Date.now();
		const currentY = e.touches[0].clientY;
		const deltaYFromStart = currentY - touchStart;
		// If swiping within a scrollable element and it can scroll further in the
		// swipe direction, treat this gesture as content scroll, not modal dismiss.
		if (activeScrollableEl) {
			const el = activeScrollableEl;
			const isAtTopEl = el.scrollTop <= 0;
			const isAtBottomEl = Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 1;
			const directionDown = deltaYFromStart > 0;

			if (gestureMode === null) {
				if ((directionDown && !isAtTopEl) || (!directionDown && !isAtBottomEl)) {
					gestureMode = 'scroll';
				} else {
					gestureMode = 'dismiss';
				}
			}

			if (gestureMode === 'scroll') {
				return; // allow native scrolling to proceed
			}
		}

		const deltaTime = currentTime - lastTouchTime;

		if (deltaTime > 0) {
			velocity = (currentY - lastTouchY) / deltaTime;
		}

		lastTouchTime = currentTime;
		lastTouchY = currentY;

		const shouldHandleModal =
			isInDismissalGesture || // If we're in a dismissal gesture, keep control
			isDismissing ||
			!scrollableContent.isScrollable ||
			(!isDismissing &&
				((scrollableContent.isAtTop && currentY > touchStart) ||
					(scrollableContent.isAtBottom && currentY < touchStart)));

		if (shouldHandleModal) {
			isInDismissalGesture = true; // Set when we take control
			// Calculate the current movement direction
			const currentDeltaY = currentY - (initialDismissY ?? currentY);
			const newDirection = currentDeltaY > 0 ? 'down' : 'up';

			// CHANGE: Separate the scroll-to-dismiss transition logic
			if (!isDismissing) {
				// Initial transition from scroll to dismiss
				initialDismissY = currentY;
				dismissStartTranslateY = $translateY;
				isDismissing = true;
				swipeDirection = newDirection;
				preventScroll(true);
				// Only disable native scrolling if content isn't scrollable
				if (modalContent && !scrollableContent.isScrollable) {
					modalContent.style.touchAction = 'none';
				}
				// Add touchStart reset to align with new gesture
				touchStart = currentY;
				// Notify child components of dismissal state
				modalContent?.dispatchEvent(
					new CustomEvent('dismissStateChange', {
						detail: { isDismissing: true },
						bubbles: true
					})
				);
			} else if (
				swipeDirection &&
				newDirection !== swipeDirection &&
				Math.abs(currentDeltaY) > dismissHintThreshold * 0.5
			) {
				// Direction reversal during dismissal
				initialDismissY = currentY;
				dismissStartTranslateY = $translateY;
				swipeDirection = newDirection;
				touchStart = currentY;
			}

			e.preventDefault();

			// Calculate movement relative to where dismissal started
			const dismissDeltaY = currentY - (initialDismissY ?? currentY);

			// Apply resistance and add to the starting position
			const resistanceFactor = resistance;
			const newTranslateY = dismissStartTranslateY + dismissDeltaY * resistanceFactor;

			translateY.set(newTranslateY, {
				hard: isPastThreshold // Use hard animation when past threshold
			});

			// Calculate and update gesture progress independently
			const progress = Math.abs(newTranslateY) / dismissHintThreshold;
			gestureProgress.set(progress);

			// Update other visual feedback
			const dismissProgress = Math.pow(progress, 1.2);
			dismissHintOpacity.set(dismissProgress);
			hintScale.set(0.8 + dismissProgress * 0.2);
			blurAmount.set(Math.pow(progress, 2) * 6);

			isPastThreshold = Math.abs(newTranslateY) > dismissThreshold;
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (isDismissing) {
			// Release touch capture and restore scrolling
			modalContent?.releasePointerCapture?.(e.changedTouches[0].identifier);
			if (browser) {
				document.body.style.overflow = '';
			}
			if (modalContent) {
				modalContent.style.touchAction = '';
			}

			// Calculate final velocity and direction
			const endTime = Date.now();
			const deltaTime = endTime - lastTouchTime;
			if (deltaTime > 0) {
				velocity = (e.changedTouches[0].clientY - lastTouchY) / deltaTime;
			}

			const finalVelocity = Math.abs(velocity);
			const velocityThreshold = 0.5;

			if (isPastThreshold || finalVelocity > velocityThreshold) {
				// Direct dismissal without spring animation
				const dismissDistance =
					swipeDirection === 'down' ? dismissAnimationDistance : -dismissAnimationDistance;

				translateY.set(dismissDistance, {
					hard: true
				});

				dismissHintOpacity.set(0);
				hintScale.set(0.8);
				blurAmount.set(0);
				gestureProgress.set(0);

				coordinated.setTimeout(
					() => {
						close();
					},
					200,
					'modal',
					componentId
				);
			} else {
				// Always reset to 0 (initial position) regardless of swipe direction
				translateY.set(0);
				dismissHintOpacity.set(0);
				blurAmount.set(0);
				gestureProgress.set(0);
				preventScroll(false);
				if (modalContent) {
					modalContent.style.touchAction = '';
				}
			}
		}

		velocity = 0;
		isDismissing = false;
		initialDismissY = null;
		swipeDirection = null;
		isPastThreshold = false;
		isInDismissalGesture = false; // Reset only when touch ends
		activeScrollableEl = null;
		gestureMode = null;

		// Reset gesture progress
		gestureProgress.set(0);
	}

	// Create a function to handle scroll state updates
	function handleScrollStateChange(__event: CustomEvent) {
		scrollableContent = { ...scrollableContent, ...__event.detail };
	}

	function handleTouchStateChange(__event: CustomEvent) {
		const newState = __event.detail;
		scrollableContent = { ...scrollableContent, ...newState };
	}

	// Add a derived value for smoother blur
	const blurStyle = $derived(`blur(${$blurAmount}px)`);

	// Svelte action to attach a non-passive touchmove handler
	function nonPassiveTouchMove(node: HTMLElement) {
		const onStart = (__event: TouchEvent) => handleTouchStart(__event);
		const onMove = (__event: TouchEvent) => handleTouchMove(__event);
		const onEnd = (__event: TouchEvent) => handleTouchEnd(__event);
		const onCancel = (__event: TouchEvent) => handleTouchEnd(__event);
		node.addEventListener('touchstart', onStart, { passive: false });
		node.addEventListener('touchmove', onMove, { passive: false });
		node.addEventListener('touchend', onEnd, { passive: true });
		node.addEventListener('touchcancel', onCancel, { passive: true });
		return {
			destroy() {
				node.removeEventListener('touchstart', onStart);
				node.removeEventListener('touchmove', onMove);
				node.removeEventListener('touchend', onEnd);
				node.removeEventListener('touchcancel', onCancel);
			}
		};
	}

	onMount(() => {
		isOpen = true; // Set isOpen to true so dialog element renders
		updateViewportHeight();
		window.addEventListener('resize', updateViewportHeight);
		document.addEventListener('keydown', handleModalInteraction);
		document.addEventListener('click', handleModalInteraction);
		modalContent?.addEventListener('scrollStateChange', (__event: Event) => {
			handleScrollStateChange(__event as CustomEvent);
		});
		modalContent?.addEventListener('touchStateChange', (__event: Event) => {
			handleTouchStateChange(__event as CustomEvent);
		});
		lockScroll();
	});

	onDestroy(() => {
		window.removeEventListener('resize', updateViewportHeight);
		document.removeEventListener('keydown', handleModalInteraction);
		document.removeEventListener('click', handleModalInteraction);
		modalContent?.removeEventListener('scrollStateChange', (__event: Event) => {
			handleScrollStateChange(__event as CustomEvent);
		});
		modalContent?.removeEventListener('touchStateChange', (__event: Event) => {
			handleTouchStateChange(__event as CustomEvent);
		});
		unlockScroll();
		preventScroll(false); // Ensure scrolling is re-enabled when component is destroyed
		useTimerCleanup(componentId)();

		// Stop tweened animations to prevent memory leaks
		dismissHintOpacity.set(0, { duration: 0 });
		hintScale.set(0.8, { duration: 0 });
		blurAmount.set(0, { duration: 0 });
		gestureProgress.set(0, { duration: 0 });
	});

	// Export methods for external component binding
	function _open(_data?: unknown): void {
		isOpen = true;
		lockScroll();
		updateViewportHeight();
	}

	// Note: open and close functions are available for internal use
	// In Svelte 5, use $bindable() for exported component methods if needed
</script>

{#if isOpen}
	<div
		bind:this={dialogElement}
		class="fixed inset-0 z-[1010] m-0 flex h-full w-full items-center justify-center backdrop-blur-sm"
		onclick={handleModalInteraction}
		onkeydown={(e) => {
			if (e.key === 'Escape') handleModalInteraction(e);
		}}
		role="dialog"
		aria-modal="true"
		aria-label="Modal dialog"
		tabindex="0"
	>
		<div
			bind:this={modalContent}
			class="modal-content relative mx-4 flex max-h-[90vh] w-full max-w-2xl touch-pan-y flex-col overflow-hidden rounded-md bg-white shadow-md sm:mx-6"
			style="transform: translateY({$translateY}px)"
			use:nonPassiveTouchMove
			role="document"
			tabindex="-1"
		>
			<!-- Close button -->
			<button
				onclick={close}
				class="absolute right-2 top-2 z-20 rounded-full bg-white/80
                           p-2 shadow-sm backdrop-blur-sm
                           transition-colors hover:bg-gray-100"
				aria-label="Close modal"
			>
				<X class="h-5 w-5 text-gray-600" />
			</button>

			<!-- Content -->
			<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
				<div class="relative flex flex-1 flex-col">
					{@render children?.()}
				</div>
			</div>

			<!-- Blur effect container - positioned after content -->
			<div
				class="pointer-events-none absolute inset-0 transition-[backdrop-filter] duration-75"
				style="backdrop-filter: {blurStyle};
                           background: rgba(241, 245, 249, {$gestureProgress * 0.1})"
			>
				<!-- Background gradients -->
				{#if swipeDirection === 'down'}
					<div
						class="absolute inset-0 bg-gradient-to-t from-slate-900/40 via-slate-900/20 to-transparent"
						style="opacity: {$dismissHintOpacity}"
					></div>
				{:else if swipeDirection === 'up'}
					<div
						class="absolute inset-0 bg-gradient-to-b from-slate-900/40 via-slate-900/20 to-transparent"
						style="opacity: {$dismissHintOpacity}"
					></div>
				{/if}
			</div>

			<!-- Dismissal hint -->
			{#if $dismissHintOpacity > 0}
				<div
					class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
					style="opacity: {$dismissHintOpacity}"
				>
					<!-- Centered hint message -->
					<div
						class="flex items-center gap-3
                                   rounded-lg border
                                   border-slate-200 bg-white px-4
                                   py-2.5 shadow-lg"
						style="transform: scale({$hintScale})
                                    translateY({swipeDirection === 'down' ? 20 : -20}px)"
					>
						<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600"></span>
						<div class="relative h-[20px] w-[180px]">
							{#key isPastThreshold}
								<span
									class="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-sm font-medium text-slate-900"
									in:scale={{ duration: 100, start: 0.8 }}
									out:scale|local={{ duration: 100, start: 1.2 }}
								>
									{isPastThreshold ? 'Release to close' : 'Keep swiping to close'}
								</span>
							{/key}
						</div>
						<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600"></span>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Customize scrollbar */
	div::-webkit-scrollbar {
		width: 8px;
	}

	div::-webkit-scrollbar-track {
		background: transparent;
	}

	div::-webkit-scrollbar-thumb {
		background-color: rgba(156, 163, 175, 0.5);
		border-radius: 4px;
	}

	div::-webkit-scrollbar-thumb:hover {
		background-color: rgba(156, 163, 175, 0.7);
	}
</style>
