<script lang="ts">
	/// <reference types="dom" />
	import { browser } from '$app/environment';
	import type { Template } from '$lib/types/template';
	import { onDestroy, onMount, tick } from 'svelte';
	import { spring } from 'svelte/motion';
	import { isMobile } from '$lib/utils/browserUtils';
	import { coordinated, useTimerCleanup } from '$lib/utils/timerCoordinator';
	import { topicHue } from '$lib/utils/topic-hue';
	import { PreviewContent, ActionBar } from './parts';

	const componentId = 'TemplatePreview_' + Math.random().toString(36).substr(2, 9);

	let {
		template,
		inModal = false,
		context = 'list',
		user = null,
		onScroll = () => {
			/* Optional scroll handler */
		},
		onOpenModal = null,
		onSendMessage = null,
		showEmailModal: externalShowEmailModal = false,
		onEmailModalClose = () => {
			/* Optional email modal close handler */
		},
		expandToContent = false,
		debateResolution = null,
		personalConnectionValue = $bindable('')
	}: {
		template: Template;
		inModal?: boolean;
		context?: 'list' | 'page' | 'modal';
		user?: { id: string; name: string | null; trust_tier?: number } | null;
		onScroll?: (isAtBottom: boolean, scrollProgress?: number) => void;
		onOpenModal?: (() => void) | null;
		onSendMessage?: (() => void) | null;
		showEmailModal?: boolean;
		onEmailModalClose?: () => void;
		expandToContent?: boolean;
		debateResolution?: { winningStance: string; participants: number } | null;
		personalConnectionValue?: string;
	} = $props();

	const hue = $derived(topicHue(template?.category ?? '', template?.topics));

	let localShowEmailModal = $state(false);
	const showEmailModal = $derived(externalShowEmailModal || localShowEmailModal);
	let actionProgress = $state(spring(0, { stiffness: 0.2, damping: 0.8 }));

	// Set actionProgress when modal is externally controlled
	$effect(() => {
		if (externalShowEmailModal) {
			actionProgress.set(1);
		} else if (!showEmailModal) {
			actionProgress.set(0);
		}
	});

	// Persist and restore personalization data across OAuth flow
	$effect(() => {
		if (browser && personalConnectionValue) {
			// Save to session storage whenever it changes
			sessionStorage.setItem(
				`template_${template.id}_personalization`,
				JSON.stringify({
					personalConnection: personalConnectionValue,
					timestamp: Date.now()
				})
			);
		}
	});

	let previewContainer: HTMLDivElement;
	let firstFocusableElement: HTMLButtonElement | HTMLAnchorElement | HTMLInputElement;
	let lastFocusableElement: HTMLButtonElement | HTMLAnchorElement | HTMLInputElement;
	let templateListButtons: HTMLButtonElement[];

	function handleKeyboardNav(_event: KeyboardEvent) {
		// Allow focus events to pass through for popover triggers
		if ((_event.target as HTMLElement).closest('[aria-haspopup="true"]')) {
			return;
		}

		if (_event.key === 'Tab') {
			const templateButtons = templateListButtons;
			const selectedIndex = templateButtons.findIndex(
				(button) => button.getAttribute('data-template-id') === template.id.toString()
			);
			const lastTemplateIndex = templateButtons.length - 1;

			if (_event.shiftKey) {
				// Handle shift+tab from first element
				if (document.activeElement === firstFocusableElement) {
					_event.preventDefault();
					// Focus the current template button
					templateButtons[selectedIndex]?.focus();
				}
			} else {
				// Handle forward tab from last element
				if (document.activeElement === lastFocusableElement) {
					// If we're not at the last template in the list,
					// move focus to the next template
					if (selectedIndex < lastTemplateIndex) {
						_event.preventDefault();
						templateButtons[selectedIndex + 1]?.focus();
					}
					// Otherwise, let focus continue naturally
				}
			}
		}
	}

	// Listen for focus move request (when template is selected)
	onMount(() => {
		// Restore personalization data if returning from OAuth
		if (browser) {
			const savedData = sessionStorage.getItem(`template_${template.id}_personalization`);
			if (savedData) {
				try {
					const parsed = JSON.parse(savedData);
					// Only restore if data is less than 30 minutes old
					if (parsed.timestamp && Date.now() - parsed.timestamp < 30 * 60 * 1000) {
						personalConnectionValue = parsed.personalConnection || '';
					} else {
						sessionStorage.removeItem(`template_${template.id}_personalization`);
					}
				} catch (error) {
					console.error('[TemplatePreview] Failed to restore personalization:', error instanceof Error ? error.message : String(error));
				}
			}
		}

		const handleMovePreviewFocus = () => {
			if (firstFocusableElement) {
				firstFocusableElement.focus();
			}
		};

		window.addEventListener('movePreviewFocus', handleMovePreviewFocus);

		return () => {
			window.removeEventListener('movePreviewFocus', handleMovePreviewFocus);
		};
	});

	// Find first and last focusable elements after template changes
	$effect(() => {
		if (template && previewContainer) {
			tick().then(() => {
				// Re-check previewContainer as it might have become null during async operation
				if (!previewContainer) return;

				const focusableElements = previewContainer.querySelectorAll(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
				);
				firstFocusableElement = focusableElements[0] as
					| HTMLButtonElement
					| HTMLAnchorElement
					| HTMLInputElement;
				lastFocusableElement = focusableElements[focusableElements.length - 1] as
					| HTMLButtonElement
					| HTMLAnchorElement
					| HTMLInputElement;

				// Get reference to template list buttons
				templateListButtons = Array.from(document.querySelectorAll('[data-template-button]'));
			});
		}
	});

	onDestroy(() => {
		useTimerCleanup(componentId)();
	});

	function handleMobileClick(_event: MouseEvent) {
		// Don't intercept button clicks
		const target = _event.target as HTMLElement;
		if (target.tagName === 'BUTTON' || target.closest('button')) {
			return;
		}

		const isMobileDevice = isMobile();

		if (!inModal && onOpenModal && isMobileDevice) {
			_event.preventDefault();
			_event.stopPropagation();
			onOpenModal();
		}
	}
</script>

<div
	bind:this={previewContainer}
	data-testid="template-preview"
	style="--card-hue: {hue}"
	class="card-topic card-weight-heavy
               {inModal ? 'h-full' : 'rounded-xl'}
               {inModal ? 'p-5 sm:p-8' : 'p-4 sm:p-5 md:p-6 lg:p-8'}
               {inModal ? '' : expandToContent ? '' : 'sm:sticky sm:top-8'}
               {inModal ? '' : expandToContent ? '' : 'h-[calc(100vh-4rem)]'}
               {!inModal && onOpenModal ? 'cursor-pointer md:cursor-default' : ''}
               flex flex-col {expandToContent ? '' : 'overflow-hidden'}"
	onclick={handleMobileClick}
	role={!inModal && onOpenModal ? 'button' : 'region'}
	{...!inModal && onOpenModal ? { tabindex: 0 } : {}}
	aria-label={!inModal && onOpenModal ? 'Open template in modal' : 'Template preview'}
>
	{#if template}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			role="region"
			aria-label="Template preview navigation"
			onkeydown={handleKeyboardNav}
			class="flex flex-1 cursor-default flex-col {inModal ? 'overflow-hidden' : 'overflow-visible'} border-0 bg-transparent text-left outline-none"
		>
			<PreviewContent
				{template}
				{inModal}
				{context}
				{user}
				{onScroll}
				bind:personalConnectionValue
				{componentId}
				{expandToContent}
				{debateResolution}
			/>

			<!-- Only show ActionBar in list/modal contexts, not on page -->
			{#if context !== 'page'}
				<ActionBar
					{template}
					{user}
					{personalConnectionValue}
					{onSendMessage}
					bind:localShowEmailModal
					bind:actionProgress
					{onEmailModalClose}
					{componentId}
				/>
			{/if}
		</div>
	{:else}
		<div class="py-12 text-center text-slate-500">Select a template to preview</div>
	{/if}
</div>

<!-- Email Loading Modal - Integrated inline -->
{#if showEmailModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
		<div
			class="animate-in zoom-in-95 mx-4 w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl duration-200"
		>
			<div class="text-center">
				<!-- Animated mail icon -->
				<div class="relative mb-4">
					<svg
						class="mx-auto h-16 w-16 animate-pulse text-participation-primary-600"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
						/>
					</svg>
					<!-- Flying papers animation -->
					<div
						class="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-participation-primary-400"
					></div>
				</div>

				<h3 class="mb-2 text-lg font-semibold text-slate-900">Opening your email app...</h3>
				<p class="mb-4 text-sm text-slate-600">
					Your message is ready with your information pre-filled.
				</p>

				<!-- Animated progress bar -->
				<div class="mx-auto h-2 w-32 overflow-hidden rounded-full bg-slate-200">
					<div
						class="h-full rounded-full bg-gradient-to-r from-participation-primary-500 to-participation-primary-600 transition-all duration-1000 ease-out"
						style="width: {$actionProgress * 100}%"
					></div>
				</div>
			</div>
		</div>
	</div>
{/if}
