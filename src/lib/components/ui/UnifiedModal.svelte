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
		ariaLabel = '',
		size = 'md',
		showCloseButton = true,
		closeOnBackdrop = true,
		closeOnEscape = true,
		children
	}: {
		id: string;
		type: ModalType;
		title?: string;
		/**
		 * Fallback aria-label when `title` is empty. Without it,
		 * `aria-labelledby` becomes undefined when title is unset,
		 * leaving titleless modals (debate-modal, wallet-connect-modal,
		 * sign-in-modal, identity-verification-modal) as unnamed dialogs
		 * for screen readers. If neither title nor ariaLabel is provided,
		 * falls back to "Modal dialog" as a last resort so the dialog at
		 * minimum has a name.
		 */
		ariaLabel?: string;
		size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
		showCloseButton?: boolean;
		closeOnBackdrop?: boolean;
		closeOnEscape?: boolean;
		children: Snippet<[any]>;
	} = $props();

	// Connect to modal system (one-shot init with prop values)
	const modal = untrack(() => createModalStore(id, type));

	// Focus management. WCAG 2.1 + 2.4.3 / 4.1.2.
	// Track the previously-focused element so we can restore focus on close.
	// Capture inside an $effect that fires on `modal.isOpen` flipping true;
	// move focus into the dialog; restore on flip-back-to-false.
	let dialogEl = $state<HTMLDivElement | null>(null);
	let containerEl = $state<HTMLDivElement | null>(null);
	let previouslyFocused: HTMLElement | null = null;

	$effect(() => {
		if (!modal.isOpen) {
			// Restore focus to the trigger element if we tracked one.
			if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
				try {
					previouslyFocused.focus();
				} catch {
					/* element may have been removed from DOM — silent */
				}
				previouslyFocused = null;
			}
			return;
		}
		// Modal opened — capture current focus (the trigger) BEFORE moving
		// focus inside, so we can restore on close.
		if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
			previouslyFocused = document.activeElement;
		}
		// Move focus into the dialog. Prefer the first focusable element
		// inside the container so a screen reader announces it; fall back
		// to the dialog itself if there's no focusable child.
		queueMicrotask(() => {
			if (!containerEl) return;
			const focusables = containerEl.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			);
			const first = focusables[0];
			if (first) {
				first.focus();
			} else if (dialogEl) {
				dialogEl.focus();
			}
		});
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && closeOnEscape) {
			modal.close();
			return;
		}
		// Focus trap: cycle Tab within the dialog so keyboard users can't
		// escape into the background page.
		if (e.key === 'Tab' && containerEl) {
			const focusables = Array.from(
				containerEl.querySelectorAll<HTMLElement>(
					'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
				)
			);
			if (focusables.length === 0) {
				e.preventDefault();
				return;
			}
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			const active = document.activeElement;
			if (e.shiftKey && active === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && active === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}

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
		bind:this={dialogEl}
		class="modal-backdrop fixed inset-0 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
		style="z-index: {modal.zIndex}"
		in:fade={{ duration: 200 }}
		out:fade={{ duration: 200 }}
		onclick={(e) => {
			if (e.target === e.currentTarget && closeOnBackdrop) {
				modal.close();
			}
		}}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby={title ? `${id}-title` : undefined}
		aria-label={!title ? (ariaLabel || 'Modal dialog') : undefined}
		tabindex="-1"
	>
		<!-- Modal Container -->
		<div
			bind:this={containerEl}
			class="relative flex min-h-0 w-full flex-col overflow-hidden rounded-lg bg-white shadow-md {sizeClasses[
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
