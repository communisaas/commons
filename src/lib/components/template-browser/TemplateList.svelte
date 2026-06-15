<script lang="ts">
	import { PenLine, Search } from '@lucide/svelte';
	import { preloadData } from '$app/navigation';
	import type { TemplateGroup } from '$lib/types/template';
	import SkeletonTemplate from '$lib/components/ui/SkeletonTemplate.svelte';
	import TemplateTile from './spectrum/TemplateTile.svelte';
	import { scoreTemplate, sortTemplatesByScore } from '$lib/utils/template-scoring';

	interface Props {
		groups: TemplateGroup[];
		selectedId: string | null;
		onSelect: (id: string) => void;
		onCreateTemplate?: () => void;
		loading?: boolean;
	}

	let { groups, selectedId, onSelect, onCreateTemplate, loading = false }: Props = $props();

	// Track loading → loaded transition for staggered entrance animation
	let wasLoading = $state(false);
	let justLoaded = $state(false);

	$effect(() => {
		if (loading) {
			wasLoading = true;
		} else if (wasLoading) {
			wasLoading = false;
			justLoaded = true;
			// Clear after animation window
			const timer = setTimeout(() => { justLoaded = false; }, 600);
			return () => clearTimeout(timer);
		}
	});

	// Initial batch must exceed viewport height + buffer so the sentinel starts
	// below the fold; otherwise the IntersectionObserver fires on mount and
	// loads the rest of the list in one tick. At ~120px per template, 12 rows
	// = 1440px > (desktop 1080 + buffer 200).
	const INITIAL_VISIBLE = 12;
	const BATCH_SIZE = 8;
	const VIEWPORT_BUFFER = 200;

	// Search state
	let searchQuery = $state('');

	// Enrich templates with scoring metrics and sort by displayScore
	const scoredGroups = $derived.by(() => {
		const now = new Date();

		return groups.map((group) => {
			// Enrich each template with scoring metrics
			const enriched = group.templates.map((t) => ({
				...t,
				...scoreTemplate(
					{
						send_count: t.send_count || 0,
						created_at: new Date(t.createdAt),
						updated_at: new Date(t.updatedAt || t.createdAt)
					},
					now
				)
			}));

			// Sort by displayScore (descending)
			const sorted = sortTemplatesByScore(enriched);

			return {
				...group,
				templates: sorted
			};
		});
	});

	// Client-side filter (instant - no debounce needed)
	const filteredGroups = $derived.by(() => {
		if (!searchQuery.trim()) return scoredGroups;

		const query = searchQuery.toLowerCase();

		return scoredGroups
			.map((group) => ({
				...group,
				templates: group.templates.filter(
					(t) =>
						t.title.toLowerCase().includes(query) ||
						t.description?.toLowerCase().includes(query) ||
						t.domain?.toLowerCase().includes(query)
				)
			}))
			.filter((group) => group.templates.length > 0); // Remove empty groups
	});

	// Match count for feedback
	const matchCount = $derived(filteredGroups.reduce((sum, g) => sum + g.templates.length, 0));

	// Visible counts are tracked separately from initialization to avoid
	// reactive cycles. The IntersectionObserver writes; getVisibleCount reads.
	// Writing inside a $derived that reads from visibleCounts triggers
	// effect_update_depth_exceeded.
	let visibleCounts = $state<Map<string, number>>(new Map());

	// Sentinel elements for intersection observation (one per group)
	let sentinelElements = $state<Map<string, HTMLElement>>(new Map());

	// Flatten groups into single array for keyboard navigation
	const allTemplates = $derived(filteredGroups.flatMap((g) => g.templates));

	let hoveredTemplate = $state<string | null>(null);

	/**
	 * Get visible template count for a group
	 * Starts at INITIAL_VISIBLE, grows in BATCH_SIZE increments as user scrolls
	 */
	function getVisibleCount(group: TemplateGroup): number {
		const currentCount = visibleCounts.get(group.title) || INITIAL_VISIBLE;
		return Math.min(currentCount, group.templates.length);
	}

	/**
	 * Increment visible count for a group when sentinel enters viewport
	 */
	function incrementVisibleCount(groupTitle: string): void {
		const current = visibleCounts.get(groupTitle) || INITIAL_VISIBLE;
		const newCount = current + BATCH_SIZE;
		visibleCounts.set(groupTitle, newCount);
		// Trigger reactivity by creating new Map
		visibleCounts = new Map(visibleCounts);
	}

	// rootMargin needs all four sides — `0px 0px ${VIEWPORT_BUFFER}px 0px`
	// applies the buffer only to the bottom edge so the observer doesn't
	// trigger from off-screen above. Double-RAF delays observation until
	// the initial templates have rendered and layout has settled; observing
	// earlier fires immediately on mount. Map reassignment is required for
	// Svelte 5 $state reactivity — `.set()` alone doesn't trigger.
	function registerSentinel(element: HTMLElement, groupTitle: string) {
		sentinelElements.set(groupTitle, element);

		let observer: IntersectionObserver | null = null;

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				observer = new IntersectionObserver(
					(entries) => {
						entries.forEach((entry) => {
							if (entry.isIntersecting) {
								const current = visibleCounts.get(groupTitle) || INITIAL_VISIBLE;
								const newCount = current + BATCH_SIZE;
								visibleCounts = new Map(visibleCounts.set(groupTitle, newCount));
							}
						});
					},
					{
						rootMargin: `0px 0px ${VIEWPORT_BUFFER}px 0px`,
						threshold: 0
					}
				);

				observer.observe(element);
			});
		});

		return {
			destroy() {
				observer?.disconnect();
				sentinelElements.delete(groupTitle);
			}
		};
	}

	function handleTemplateHover(templateId: string, isHovering: boolean) {
		hoveredTemplate = isHovering ? templateId : null;

		// Preload template page on hover
		if (isHovering) {
			const template = allTemplates.find((t) => t.id === templateId);
			if (template?.slug) {
				preloadData(`/s/${template.slug}`);
			}
		}
	}

	function handleKeydown(__event: KeyboardEvent, templateId: string, index: number) {
		if (__event.key === 'Enter' || __event.key === ' ') {
			__event.preventDefault();
			onSelect(templateId);
			// Dispatch custom event to notify parent to move focus
			const customEvent = new CustomEvent('movePreviewFocus');
			window.dispatchEvent(customEvent);
		} else if (__event.key === 'Tab' && __event.shiftKey) {
			// If we're at the first template and shift+tab, let it go to previous element
			if (index === 0) return;

			// Otherwise, prevent default to handle our own focus management
			__event.preventDefault();
			const buttons = document.querySelectorAll('[data-template-button]');
			const prevButton = buttons[index - 1] as HTMLElement;
			prevButton?.focus();
		} else if (__event.key === 'Tab' && !__event.shiftKey) {
			// When reaching the last template
			if (index === allTemplates.length - 1) {
				// If this template is selected, let focus continue naturally
				if (templateId === selectedId) return;

				// Otherwise, dispatch event to move focus to current preview
				__event.preventDefault();
				const customEvent = new CustomEvent('movePreviewFocus');
				window.dispatchEvent(customEvent);
				return;
			}

			// Otherwise continue with template list navigation
			__event.preventDefault();
			const buttons = document.querySelectorAll('[data-template-button]');
			const nextButton = buttons[index + 1] as HTMLElement;
			nextButton?.focus();
		}
	}
</script>

<div class="space-y-6 md:space-y-8" data-testid="template-list">
	{#if loading}
		<!-- Loading State: wrapped in group-level spacing to match real card containers -->
		<div class="space-y-3 md:space-y-4">
			<!-- Group header skeleton -->
			<div class="flex items-center justify-between">
				<div class="h-3.5 w-20 rounded bg-slate-200/50"></div>
				<div class="h-3 w-16 rounded bg-slate-200/40"></div>
			</div>
			{#each Array(4) as _, index}
				<SkeletonTemplate variant="list" animate={true} classNames="template-loading-{index}" />
			{/each}
		</div>
	{:else}
		<!-- Search UI -->
		<div class="search-container">
			<div class="search-input-wrapper">
				<Search class="search-icon" size={18} />
				<input
					type="search"
					class="search-input"
					placeholder="Search templates..."
					bind:value={searchQuery}
				/>
			</div>

			{#if searchQuery && matchCount > 0}
				<p class="search-results-count">
					{matchCount}
					{matchCount === 1 ? 'template' : 'templates'} match "{searchQuery}"
				</p>
			{/if}

			{#if searchQuery && matchCount === 0}
				<p class="no-results">No templates match "{searchQuery}"</p>
			{/if}
		</div>

		{#if onCreateTemplate}
			<button
				type="button"
				onclick={onCreateTemplate}
				class="group flex w-full items-center gap-3 rounded-lg border border-dashed border-slate-300 p-4 text-left transition-colors hover:border-teal-400 md:p-5"
			>
				<PenLine class="h-5 w-5 shrink-0 text-slate-500 transition-colors group-hover:text-teal-600" />
				<div>
					<h3 class="font-brand text-base font-semibold text-slate-800">
						Write a new template.
					</h3>
					<p class="font-brand text-sm text-slate-500">
						The message others will send.
					</p>
				</div>
			</button>
		{/if}

		{#each filteredGroups as group, groupIndex (group.title)}
			<!-- Section Header -->
			<div class="space-y-3 md:space-y-4">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold uppercase tracking-wide text-slate-700">
						{group.title}
					</h3>
					<span class="text-xs font-medium text-slate-500">
						{group.templates.length}
						{group.templates.length === 1 ? 'template' : 'templates'}
					</span>
				</div>

				<!-- Templates in this group (viewport-aware progressive rendering) -->
				{#each group.templates.slice(0, getVisibleCount(group)) as template, templateIndex (template.id)}
					{@const globalIndex = allTemplates.findIndex((t) => t.id === template.id)}
					<TemplateTile
						{template}
						selected={selectedId === template.id}
						index={globalIndex}
						newlyRevealed={templateIndex >= INITIAL_VISIBLE}
						{justLoaded}
						animationDelay={templateIndex * 60}
						onSelect={onSelect}
						onHover={handleTemplateHover}
						onKeydown={handleKeydown}
					/>
				{/each}

				<!-- Sentinel: when it enters the viewport (plus buffer), the observer loads the next batch -->
				{#if getVisibleCount(group) < group.templates.length}
					<div
						class="sentinel"
						use:registerSentinel={group.title}
						data-group={group.title}
						aria-hidden="true"
					>
						<!-- Loading indicator (peripheral awareness) -->
						<div class="loading-pulse">
							<div class="pulse-dot"></div>
							<div class="pulse-dot"></div>
							<div class="pulse-dot"></div>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<style>
	/* Search UI Styles */
	.search-container {
		margin-bottom: 1.5rem;
	}

	.search-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-input-wrapper :global(.search-icon) {
		position: absolute;
		left: 1rem;
		color: oklch(0.5 0.02 250);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 0.75rem 1rem 0.75rem 2.75rem;
		border: 1px solid oklch(0.85 0.02 250);
		border-radius: 8px;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		background: white;
		transition: border-color 150ms ease-out;
	}

	.search-input:focus {
		outline: none;
		border-color: oklch(0.65 0.12 195);
		box-shadow: 0 0 0 3px oklch(0.65 0.12 195 / 0.1);
	}

	.search-results-count {
		margin-top: 0.5rem;
		font-size: 0.875rem;
		color: oklch(0.5 0.02 250);
	}

	.no-results {
		margin-top: 0.5rem;
		font-size: 0.875rem;
		color: oklch(0.45 0.02 250);
		font-style: italic;
	}

	/* Sentinel Element (Intersection Observer Target) */
	.sentinel {
		display: flex;
		justify-content: center;
		align-items: center;
		padding: 2rem 0;
		margin-top: 0.75rem;
		min-height: 60px;
	}

	/* Loading Pulse Animation (Peripheral Awareness Signal) */
	.loading-pulse {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.pulse-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: oklch(0.7 0.05 195);
		animation: pulse 1.4s ease-in-out infinite;
	}

	.pulse-dot:nth-child(2) {
		animation-delay: 0.2s;
	}

	.pulse-dot:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.3;
			transform: scale(0.8);
		}
		50% {
			opacity: 1;
			transform: scale(1.2);
		}
	}

	/* Respect vestibular preferences */
	@media (prefers-reduced-motion: reduce) {
		.pulse-dot {
			animation: none;
		}
	}
</style>
