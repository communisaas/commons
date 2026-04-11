<!--
UNIFIED MODAL COMPONENT - Replaces scattered modal implementations

Coordinates with central modal system for proper z-index management,
backdrop handling, and keyboard navigation.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { quintOut, backOut } from 'svelte/easing';
	import { createModalStore, type ModalType } from '$lib/stores/modalSystem.svelte';
	import { X } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	let {
		id,
		type,
		title = '',
		size = 'md',
		showCloseButton = true,
		closeOnBackdrop = true,
		closeOnEscape = true,
		children
	}: {
		id: string;
		type: ModalType;
		title?: string;
		size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
		showCloseButton?: boolean;
		closeOnBackdrop?: boolean;
		closeOnEscape?: boolean;
		children: Snippet<[any]>;
	} = $props();

	// Connect to modal system (one-shot init with prop values)
	const modal = untrack(() => createModalStore(id, type));

	// Size classes
	const sizeClasses = {
		sm: 'max-w-md',
		md: 'max-w-lg',
		lg: 'max-w-2xl',
		xl: 'max-w-4xl',
		full: 'max-w-none w-full h-full'
	};

	// Open/close functions for external use
	export function open(data?: unknown) {
		modal.open(data, { closeOnBackdrop, closeOnEscape });
	}

	export function close() {
		modal.close();
	}
</script>

{#if modal.isOpen}
	<!-- Modal Backdrop -->
	<div
		class="modal-backdrop fixed inset-0 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
		style="z-index: {modal.zIndex}"
		in:fade={{ duration: 200 }}
		out:fade={{ duration: 200 }}
		onclick={(e) => {
			if (e.target === e.currentTarget && closeOnBackdrop) {
				modal.close();
			}
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape' && closeOnEscape) {
				modal.close();
			}
			if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && closeOnBackdrop) {
				modal.close();
			}
		}}
		role="dialog"
		aria-modal="true"
		aria-labelledby={title ? `${id}-title` : undefined}
		tabindex="0"
	>
		<!-- Modal Container -->
		<div
			class="relative flex min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-white shadow-md {sizeClasses[
				size
			]} max-h-[90dvh]"
			class:max-h-none={size === 'full'}
			class:h-full={size === 'full'}
			role="document"
			in:scale={{ duration: 300, start: 0.9, easing: backOut }}
			out:scale={{ duration: 200, start: 1, easing: quintOut }}
		>
			<!-- Modal Header -->
			{#if title}
				<div class="flex items-center justify-between border-b border-slate-100 p-6">
					<h2 id="{id}-title" class="text-xl font-semibold text-slate-900">
						{title}
					</h2>

					{#if showCloseButton}
						<button
							onclick={modal.close}
							class="rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
							aria-label="Close modal"
						>
							<X class="h-5 w-5" />
						</button>
					{/if}
				</div>
			{/if}

			<!-- Standalone close button when no title -->
			{#if !title && showCloseButton}
				<button
					onclick={modal.close}
					class="absolute right-4 top-4 z-10 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
					aria-label="Close modal"
				>
					<X class="h-5 w-5" />
				</button>
			{/if}

			<!-- Modal Content -->
			<div class="flex-1 overflow-y-auto">
				{@render children((modal.data || {}) as Record<string, unknown>)}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Ensure modal renders above everything */
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
	}
</style>
