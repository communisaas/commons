<!--
DetailDrawer: Slide-in panel from right showing expanded citation/action details

PERCEPTUAL ENGINEERING:
- Slides alongside stream (continuity, no replacement)
- Semi-transparent overlay provides context (not total modal takeover)
- Easy escape hatches (overlay click, X, Escape key)
- Content stays in view while drawer open (progressive disclosure)
- Focus trap prevents keyboard navigation escape
- L3 Document view: Stream de-emphasizes (40% opacity) for focal immersion

ACCESSIBILITY:
- Focus trap within drawer when open
- Escape key to close
- Screen reader announces drawer opening
- Touch/click overlay to close
- Proper ARIA roles and labels
-->
<script lang="ts">
	import type { Citation, ActionTrace, KeyMoment } from '$lib/core/thoughts/types';
	import type { ParsedDocument } from '$lib/server/reducto/types';
	import { fly, fade } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import { X, ArrowLeft } from '@lucide/svelte';
	import CitationDetail from './CitationDetail.svelte';
	import ActionDetail from './ActionDetail.svelte';
	import DocumentDetail from './DocumentDetail.svelte';

	/**
	 * Drawer view mode:
	 * - 'citation': L1/L2 citation or action detail
	 * - 'document': L3 full document analysis
	 */
	type DrawerView = 'citation' | 'document';

	interface Props {
		open: boolean;
		content: Citation | ActionTrace | null;
		/** ParsedDocument for L3 document view */
		parsedDocument?: ParsedDocument | null;
		onclose: () => void;
		/** Callback when user requests a document (L3) - parent should fetch and set parsedDocument prop */
		onrequestdocument?: (documentId: string) => void;
		/** Callback when user enters L3 view - parent can capture Key Moment */
		ondocumentview?: (doc: ParsedDocument, sourceCitation: Citation | null) => void;
		/** Bindable: true when L3 document view is active (for stream de-emphasis) */
		isL3Active?: boolean;
	}

	let {
		open = $bindable(false),
		content,
		parsedDocument = null,
		onclose,
		onrequestdocument,
		ondocumentview,
		isL3Active = $bindable(false)
	}: Props = $props();

	// Track current view mode and navigation history
	let currentView = $state<DrawerView>('citation');
	let previousCitation = $state<Citation | null>(null);

	// When document is set, switch to document view
	$effect(() => {
		if (parsedDocument && open) {
			// Store current citation for "back" navigation
			if (isCitation(content)) {
				previousCitation = content;
			}
			currentView = 'document';
			// Notify parent for Key Moment capture
			ondocumentview?.(parsedDocument, previousCitation);
		}
	});

	// Reset view when drawer closes
	$effect(() => {
		if (!open) {
			// Delay reset to allow exit animation
			setTimeout(() => {
				currentView = 'citation';
				previousCitation = null;
			}, 250);
		}
	});

	// Sync isL3Active bindable prop when L3 view state changes
	$effect(() => {
		isL3Active = currentView === 'document' && open;
	});

	// Handle "View Full Document" click from CitationDetail
	function handleViewDocument(documentId: string) {
		onrequestdocument?.(documentId);
	}

	// Handle "Back to citation" from document view
	function handleBackToCitation() {
		currentView = 'citation';
		// Clear document reference (parent can also clear via prop)
	}

	// Type guards
	function isCitation(item: unknown): item is Citation {
		return item !== null && typeof item === 'object' && 'sourceType' in item && 'excerpt' in item;
	}

	function isActionTrace(item: unknown): item is ActionTrace {
		return item !== null && typeof item === 'object' && 'type' in item && 'target' in item;
	}

	// Title determination based on current view
	function getTitle(item: Citation | ActionTrace | null, doc: ParsedDocument | null, view: DrawerView): string {
		if (view === 'document' && doc) {
			return doc.title;
		}
		if (!item) return '';
		if (isCitation(item)) return item.label;
		if (isActionTrace(item)) {
			const typeLabels: Record<string, string> = {
				research: 'Research',
				retrieve: 'Retrieval',
				analyze: 'Analysis',
				search: 'Search'
			};
			return `${typeLabels[item.type] || item.type}: ${item.target}`;
		}
		return 'Details';
	}

	// Handle escape key
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			onclose();
		}
	}

	// Focus trap - capture Tab within drawer
	let drawerElement = $state<HTMLElement>(null!);

	function trapFocus(e: KeyboardEvent) {
		if (!open || e.key !== 'Tab') return;

		const focusableElements = drawerElement?.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
		);

		if (!focusableElements || focusableElements.length === 0) return;

		const firstElement = focusableElements[0];
		const lastElement = focusableElements[focusableElements.length - 1];

		if (e.shiftKey && document.activeElement === firstElement) {
			e.preventDefault();
			lastElement.focus();
		} else if (!e.shiftKey && document.activeElement === lastElement) {
			e.preventDefault();
			firstElement.focus();
		}
	}

	// Auto-focus drawer when it opens
	$effect(() => {
		if (open && drawerElement) {
			// Focus the close button as the first interactive element
			const closeButton = drawerElement.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
			closeButton?.focus();
		}
	});

</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- Overlay backdrop -->
	<div
		class="drawer-overlay fixed inset-0 z-50 bg-black/25 backdrop-blur-sm"
		onclick={onclose}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				onclose();
			}
		}}
		role="presentation"
		aria-hidden="true"
		in:fade={{ duration: 200 }}
		out:fade={{ duration: 200 }}
		tabindex="-1"
	></div>

	<!-- Drawer panel -->
	<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
	<aside
		bind:this={drawerElement}
		class="detail-drawer fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-hidden shadow-md"
		class:drawer-l3={isL3Active}
		style="
			background: oklch(0.995 0.003 60);
			border-left: 1px solid oklch(0.85 0.01 60 / 0.3);
		"
		role="dialog"
		aria-modal="true"
		aria-label={getTitle(content, parsedDocument, currentView)}
		in:fly={{ x: 300, duration: 250, easing: quintOut }}
		out:fly={{ x: 300, duration: 200, easing: quintOut }}
		onkeydown={trapFocus}
	>
		<!-- Header -->
		<header
			class="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4"
			style="border-color: oklch(0.88 0.01 60 / 0.25);"
		>
			<div class="flex min-w-0 flex-1 items-center gap-3">
				<!-- Back button (visible in L3 document view with previous citation) -->
				{#if currentView === 'document' && previousCitation}
					<button
						onclick={handleBackToCitation}
						class="shrink-0 rounded-lg p-2 transition-all duration-150
							hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
						style="color: oklch(0.45 0.02 60);"
						aria-label="Back to citation"
						in:fly={{ x: -10, duration: 150 }}
					>
						<ArrowLeft class="h-5 w-5" />
					</button>
				{/if}
				<div class="min-w-0 flex-1">
					<h3 class="text-lg font-semibold leading-tight" style="color: oklch(0.15 0.02 60);">
						{getTitle(content, parsedDocument, currentView)}
					</h3>
					<!-- Breadcrumb when in L3 view -->
					{#if currentView === 'document' && previousCitation}
						<p class="mt-1 text-xs" style="color: oklch(0.5 0.02 60);">
							From: {previousCitation.label}
						</p>
					{/if}
				</div>
			</div>

			<button
				onclick={onclose}
				class="shrink-0 rounded-lg p-2 transition-all duration-150
					hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
				style="color: oklch(0.45 0.02 60);"
				aria-label="Close"
			>
				<X class="h-5 w-5" />
			</button>
		</header>

		<!-- Content area - scrollable, with view transitions -->
		<div class="flex-1 overflow-y-auto px-6 py-5">
			{#if currentView === 'document' && parsedDocument}
				<!-- L3: Full Document Analysis -->
				<div in:fly={{ x: 50, duration: 200, delay: 50 }} out:fly={{ x: 50, duration: 150 }}>
					<DocumentDetail
						document={parsedDocument}
						onClose={previousCitation ? handleBackToCitation : onclose}
					/>
				</div>
			{:else if isCitation(content)}
				<!-- L1/L2: Citation Detail -->
				<div in:fly={{ x: -50, duration: 200, delay: 50 }} out:fly={{ x: -50, duration: 150 }}>
					<CitationDetail
						citation={content}
						onViewDocument={handleViewDocument}
					/>
				</div>
			{:else if isActionTrace(content)}
				<!-- L2: Action Detail -->
				<ActionDetail action={content} />
			{:else}
				<p class="text-sm" style="color: oklch(0.45 0.02 60);">No content available</p>
			{/if}
		</div>
	</aside>
{/if}

<style>
	/* Custom scrollbar for drawer content */
	.detail-drawer {
		scrollbar-width: thin;
		scrollbar-color: oklch(0.7 0.01 60 / 0.3) transparent;
		width: 100%;
	}

	/* Default width on larger screens */
	@media (min-width: 640px) {
		.detail-drawer {
			width: 480px;
		}
	}

	/* L3 document view: wider drawer for better reading */
	@media (min-width: 640px) {
		.detail-drawer.drawer-l3 {
			width: 640px;
		}
	}

	@media (min-width: 1024px) {
		.detail-drawer.drawer-l3 {
			width: 720px;
		}
	}

	.detail-drawer::-webkit-scrollbar {
		width: 6px;
	}

	.detail-drawer::-webkit-scrollbar-track {
		background: transparent;
	}

	.detail-drawer::-webkit-scrollbar-thumb {
		background: oklch(0.7 0.01 60 / 0.3);
		border-radius: 3px;
	}

	.detail-drawer::-webkit-scrollbar-thumb:hover {
		background: oklch(0.6 0.01 60 / 0.4);
	}

	/* Ensure drawer is above everything except toast notifications */
	.drawer-overlay,
	.detail-drawer {
		position: fixed;
	}
</style>
