<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { fade } from 'svelte/transition';
	import { X } from '@lucide/svelte';

	let {
		title = '',
		showClose = true,
		closeOnBackdrop = true,
		maxWidth = 'max-w-2xl',
		onclose,
		children
	}: {
		title?: string;
		showClose?: boolean;
		closeOnBackdrop?: boolean;
		maxWidth?: string;
		onclose?: () => void;
		children?: import('svelte').Snippet;
	} = $props();

	let dialogElement: HTMLDivElement | undefined = $state(undefined);
	let isOpen = $state(false);
	let scrollPosition: number;
	let mouseDownOnBackdrop = $state(false);

	function handleClose() {
		onclose?.();
		isOpen = false;
	}

	function handleMouseDown(e: MouseEvent) {
		// Track if mousedown started on backdrop (not modal content)
		mouseDownOnBackdrop = e.target === dialogElement;
	}

	function handleBackdropClick(e: MouseEvent) {
		// Only close if BOTH mousedown AND mouseup were on backdrop
		// This prevents accidental closes from text selection that drifts to backdrop
		if (closeOnBackdrop && e.target === dialogElement && mouseDownOnBackdrop) {
			handleClose();
		}
		mouseDownOnBackdrop = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			handleClose();
		}
	}

	function lockScroll() {
		if (!browser) return;
		scrollPosition = window.scrollY;
		document.body.style.position = 'fixed';
		document.body.style.top = `-${scrollPosition}px`;
		document.body.style.width = '100%';
		document.body.style.overflow = 'hidden';
	}

	function unlockScroll() {
		if (!browser) return;
		document.body.style.position = '';
		document.body.style.top = '';
		document.body.style.width = '';
		document.body.style.overflow = '';
		window.scrollTo(0, scrollPosition);
	}

	onMount(() => {
		isOpen = true;
		lockScroll();
		document.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		unlockScroll();
		document.removeEventListener('keydown', handleKeydown);
	});
</script>

{#if isOpen}
	<div
		bind:this={dialogElement}
		class="fixed inset-0 z-[1010] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
		onmousedown={handleMouseDown}
		onclick={handleBackdropClick}
		onkeydown={(e: MouseEvent | KeyboardEvent) => {
			if ((e as KeyboardEvent).key === 'Escape') handleClose();
			if (((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') && e.target === e.currentTarget) {
				handleBackdropClick(e as MouseEvent);
			}
		}}
		role="dialog"
		aria-modal="true"
		aria-label={title || 'Modal dialog'}
		tabindex="0"
		in:fade={{ duration: 200 }}
		out:fade={{ duration: 150 }}
	>
		<div
			class="relative w-full {maxWidth} flex max-h-[90vh] flex-col overflow-hidden rounded-lg bg-white shadow-md"
			role="document"
		>
			{#if title || showClose}
				<div class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
					{#if title}
						<h2 class="text-lg font-semibold text-slate-900">{title}</h2>
					{:else}
						<div></div>
					{/if}
					{#if showClose}
						<button
							onclick={handleClose}
							class="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
							aria-label="Close modal"
						>
							<X class="h-5 w-5" />
						</button>
					{/if}
				</div>
			{/if}

			<div class="flex-1 overflow-y-auto">
				{@render children?.()}
			</div>
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
