<script lang="ts">
	import { ChevronRight, PenLine, Landmark, Building2, Mail, Users, Search } from '@lucide/svelte';
	import { preloadData } from '$app/navigation';
	import type { Template, TemplateGroup } from '$lib/types/template';
	import Badge from '$lib/components/ui/Badge.svelte';
	import MessageMetrics from './MessageMetrics.svelte';
	import SkeletonTemplate from '$lib/components/ui/SkeletonTemplate.svelte';
	import { deriveTargetPresentation } from '$lib/utils/deriveTargetPresentation';
	import { topicHue } from '$lib/utils/topic-hue';
	import { scoreTemplate, sortTemplatesByScore } from '$lib/utils/template-scoring';
	import { FEATURES } from '$lib/config/features';

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

	/**
	 * PERCEPTUAL ENGINEERING: Progressive Rendering Constants
	 *
	 * These constants define the rhythm of template materialization.
	 * - INITIAL_VISIBLE: Must be tall enough to push sentinel below viewport
	 * - BATCH_SIZE: Cognitive chunk size for progressive loading
	 * - VIEWPORT_BUFFER: Distance before bottom edge to trigger next batch
	 *
	 * CRITICAL: Initial batch must exceed viewport height + buffer to prevent
	 * immediate sentinel visibility on mount (causes runaway observer firing)
	 *
	 * Math: Template height ~120px × 12 templates = 1440px
	 * Mobile viewport: 667px, Desktop: 1080px
	 * Buffer: 200px
	 * Result: 1440px > (1080px + 200px) ✓ Sentinel starts off-screen
	 */
	const INITIAL_VISIBLE = 12; // Increased from 8 to ensure sentinel below viewport
	const BATCH_SIZE = 8;
	const VIEWPORT_BUFFER = 200; // Reduced from 400px to prevent overeager triggering

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

	/**
	 * PERCEPTUAL ENGINEERING: Viewport-Aware Progressive Rendering
	 *
	 * Instead of "show more" buttons (discrete state change), we use IntersectionObserver
	 * to progressively reveal templates as the user scrolls (continuous revelation).
	 *
	 * Cognitive Benefits:
	 * - Preserves spatial memory (templates above don't shift)
	 * - Matches prediction (templates appear at scrolling rhythm)
	 * - Zero interaction cost (scrolling IS the query)
	 * - Peripheral awareness (motion signals "more below")
	 */

	/**
	 * PERCEPTUAL ENGINEERING: Progressive rendering state
	 *
	 * We track visible counts separately from initialization to avoid circular dependencies.
	 * - visibleCounts: Mutable map updated by IntersectionObserver
	 * - getVisibleCount(): Reads from visibleCounts, falls back to INITIAL_VISIBLE
	 *
	 * This avoids the effect_update_depth_exceeded error by never writing to
	 * visibleCounts in a reactive context that reads from it.
	 */
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

	/**
	 * Svelte Action: Register sentinel element and setup observer
	 *
	 * CRITICAL FIXES (per brutalist feedback):
	 * 1. rootMargin must specify ALL sides (top, right, bottom, left)
	 *    - '400px' applies 400px to ALL sides (creates 800x800px trigger zone)
	 *    - '0px 0px 200px 0px' applies buffer ONLY to bottom edge
	 * 2. Delay observer initialization until after layout completes
	 *    - Double RAF ensures templates have rendered and calculated heights
	 *    - Prevents immediate intersection on mount
	 * 3. Remove redundant Map recreation (Svelte 5 $state tracks Map.set())
	 */
	function registerSentinel(element: HTMLElement, groupTitle: string) {
		sentinelElements.set(groupTitle, element);

		let observer: IntersectionObserver | null = null;

		// CRITICAL: Wait for browser layout to complete before observing
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				// Double RAF ensures initial templates have rendered + layout calculated
				observer = new IntersectionObserver(
					(entries) => {
						entries.forEach((entry) => {
							console.log('[IntersectionObserver]', {
								groupTitle,
								isIntersecting: entry.isIntersecting,
								intersectionRatio: entry.intersectionRatio,
								boundingRect: entry.boundingClientRect,
								rootBounds: entry.rootBounds
							});

							if (entry.isIntersecting) {
								// User scrolled near sentinel, load next batch
								const current = visibleCounts.get(groupTitle) || INITIAL_VISIBLE;
								const newCount = current + BATCH_SIZE;
								console.log('[Progressive Load]', {
									groupTitle,
									current,
									newCount,
									totalTemplates: filteredGroups.find((g) => g.title === groupTitle)?.templates
										.length
								});

								// CRITICAL: Svelte 5 $state requires reassignment for Map reactivity
								// .set() alone doesn't trigger - must create new Map
								visibleCounts = new Map(visibleCounts.set(groupTitle, newCount));
							}
						});
					},
					{
						// CRITICAL: Apply buffer ONLY to bottom (not all sides)
						rootMargin: `0px 0px ${VIEWPORT_BUFFER}px 0px`,
						threshold: 0
					}
				);

				observer.observe(element);
				console.log('[Sentinel Registered]', { groupTitle, element });
			});
		});

		return {
			destroy() {
				console.log('[Sentinel Destroyed]', { groupTitle });
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
		<!-- Loading State using SkeletonTemplate -->
		{#each Array(4) as _, index}
			<SkeletonTemplate variant="list" animate={true} classNames="template-loading-{index}" />
		{/each}
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

		<!-- Create New Template Card -->
		{#if onCreateTemplate}
			<button
				type="button"
				onclick={onCreateTemplate}
				class="group relative flex w-full items-center gap-4 rounded-md border-2 border-dashed border-slate-300 bg-slate-50/50 p-4 text-left transition-all duration-300 hover:border-cyan-400 hover:bg-cyan-50/50 hover:shadow-md md:p-5"
			>
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 transition-colors group-hover:bg-cyan-100"
				>
					<PenLine class="h-5 w-5 text-slate-500 transition-colors group-hover:text-cyan-600" />
				</div>
				<div>
					<h3 class="font-medium text-slate-700 transition-colors group-hover:text-cyan-700">
						Start something new
					</h3>
					<p class="text-sm text-slate-500">Write the message others will send</p>
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
					{@const isCongressional = template.deliveryMethod === 'cwc'}
					{@const isHovered = hoveredTemplate === template.id}
					{@const globalIndex = allTemplates.findIndex((t) => t.id === template.id)}
					{@const targetInfo = deriveTargetPresentation(template)}
					{@const isNewlyRevealed = templateIndex >= INITIAL_VISIBLE}
					{@const hue = topicHue(template.domain, template.topics, template.domainHue)}
					<button
						type="button"
						data-template-button
						data-template-id={template.id}
						data-testid="template-button-{template.id}"
						class="template-card card-topic relative flex w-full items-start justify-between gap-3 rounded-md p-3 text-left transition-all duration-300 hover:scale-[1.02] motion-reduce:transition-none motion-reduce:hover:scale-100 md:p-4 {isCongressional
							? 'card-weight-heavy'
							: 'card-weight-light'}"
						class:newly-revealed={isNewlyRevealed}
						class:initial-reveal={justLoaded}
						class:card-selected={selectedId === template.id}
						style="--card-hue: {hue}; will-change: transform; backface-visibility: hidden;{justLoaded ? ` animation-delay: ${templateIndex * 60}ms;` : ''}"
						class:cursor-pointer={selectedId !== template.id}
						class:cursor-default={selectedId === template.id}
						onmouseenter={() => handleTemplateHover(template.id, true)}
						onmouseleave={() => handleTemplateHover(template.id, false)}
						onclick={() => onSelect(template.id)}
						onkeydown={(e) => handleKeydown(e, template.id, globalIndex)}
					>
						<div class="min-w-0 flex-1">
							{#if targetInfo.type === 'multi-level'}
								<!-- Multi-Level: Stacked jurisdiction lines -->
								<div class="mb-1.5 space-y-0.5">
									{#each targetInfo.targets as target}
										<div class="flex items-center gap-1.5">
											{#if target.emphasis === 'federal'}
												<Landmark class="h-3.5 w-3.5 shrink-0 card-icon" />
												<span class="font-brand text-xs font-medium card-label">{target.primary}</span>
											{:else}
												<Building2 class="h-3.5 w-3.5 shrink-0 card-icon" />
												<span class="font-brand text-xs font-semibold card-label">{target.primary}</span>
											{/if}
											{#if target.secondary}
												<span class="text-xs font-medium text-slate-500">{target.secondary}</span>
											{/if}
										</div>
									{/each}
								</div>
							{:else if isCongressional}
								<!-- Congressional -->
								<div class="mb-1.5 flex items-center gap-1.5">
									<Landmark class="h-3.5 w-3.5 shrink-0 card-icon" />
									<span class="font-brand text-xs font-medium card-label">{targetInfo.primary}</span>
								</div>
							{:else}
								<!-- Direct/Universal: Name-forward -->
								<div class="mb-1.5 flex items-center gap-1.5">
									{#if targetInfo.icon === 'Building'}
										<Building2 class="h-3.5 w-3.5 shrink-0 card-icon" />
									{:else if targetInfo.icon === 'Users'}
										<Users class="h-3.5 w-3.5 shrink-0 card-icon-muted" />
									{:else}
										<Mail class="h-3.5 w-3.5 shrink-0 card-icon-muted" />
									{/if}
									<span class="font-brand text-sm font-bold card-label">{targetInfo.primary}</span>
									{#if targetInfo.secondary}
										<span class="text-xs font-medium text-slate-500">{targetInfo.secondary}</span>
									{/if}
								</div>
							{/if}

							<h3 class="truncate font-medium text-gray-900">
								{template.title}
							</h3>

							<p class="mb-2 line-clamp-2 text-xs text-gray-600 md:mb-3 md:text-sm">
								{template.description}
							</p>

							<MessageMetrics {template} />

							{#if FEATURES.DEBATE && template.hasActiveDebate}
								<div class="mt-1 flex items-center gap-2 text-sm">
									<span class="debate-pulse h-2 w-2 shrink-0 rounded-full bg-amber-500"></span>
									<span class="font-brand text-amber-600">Deliberating</span>
								</div>
							{/if}

							{#if template.domain}
								<span class="topic-ground">{template.domain}</span>
							{/if}
						</div>

						<!-- Mobile indicator -->
						<div class="shrink-0 text-slate-400 md:hidden">
							<ChevronRight class="h-5 w-5" />
						</div>
					</button>
				{/each}

				<!-- Sentinel Element for Infinite Scroll -->
				<!--
					PERCEPTUAL ENGINEERING: This invisible element triggers the next batch.
					When it enters the viewport (+ buffer), the IntersectionObserver fires.

					Why this works:
					- Zero interaction cost (scrolling IS the query)
					- Preserves spatial memory (no layout shifts)
					- Peripheral motion signals "more below" naturally
				-->
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

	/*
	 * Topic Ground — anchoring context at the card's base.
	 *
	 * Sits below metrics, flush to the card's bottom edge.
	 * Reads as provenance — like a postmark or a colophon.
	 * The eye catches it at the end of a downward scan,
	 * confirming domain after the content has spoken.
	 *
	 * Normal case, 500 weight, neutral — editorial, not decorative.
	 */
	.topic-ground {
		display: block;
		font-size: 0.6875rem;
		color: oklch(0.58 0.04 var(--card-hue));
		font-weight: 400;
		letter-spacing: 0.01em;
		line-height: 1.3;
		margin-top: 0.375rem;
	}

	/**
	 * PERCEPTUAL ENGINEERING: Template Entrance Animation
	 *
	 * Newly revealed templates fade in with subtle upward motion.
	 * This creates peripheral awareness without demanding focal attention.
	 *
	 * Timing: 200ms ease-out (natural deceleration, like friction)
	 * Motion: 8px upward (just enough for motion detection)
	 */
	.template-card.newly-revealed {
		animation: reveal 200ms ease-out forwards;
	}

	/* Staggered entrance when skeleton → content transition completes */
	.template-card.initial-reveal {
		opacity: 0;
		animation: initial-reveal 250ms ease-out forwards;
	}

	@keyframes initial-reveal {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes reveal {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
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

	/* Debate Deliberation Indicator (Ambient Status Signal) */
	.debate-pulse {
		animation: debate-pulse 1.4s ease-in-out infinite;
	}

	@keyframes debate-pulse {
		0%,
		100% {
			opacity: 0.5;
		}
		50% {
			opacity: 1;
		}
	}

	/* Respect vestibular preferences */
	@media (prefers-reduced-motion: reduce) {
		.template-card.newly-revealed,
		.template-card.initial-reveal {
			animation: none;
			opacity: 1;
		}

		.debate-pulse,
		.pulse-dot {
			animation: none;
		}
	}

</style>
