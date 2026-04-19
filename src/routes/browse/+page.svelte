<script lang="ts">
	import { goto } from '$app/navigation';
	import { Search, Filter } from '@lucide/svelte';
	import TemplateCard from '$lib/components/template/TemplateCard.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import type { PageData } from './$types';

	// Load data from server
	let { data }: { data: PageData } = $props();

	// State management with Svelte 5 runes
	let searchQuery = $state<string>('');
	let selectedDomain = $state<string>('all');

	// Available domains derived from server data
	const domains = $derived(['all', ...new Set(data.templates.map((t) => t.domain).filter(Boolean))]);

	// Filtered templates based on search and domain
	const filteredTemplates = $derived(
		data.templates.filter((template) => {
			// Domain filter
			if (selectedDomain !== 'all' && template.domain !== selectedDomain) {
				return false;
			}

			// Search filter
			if (searchQuery.trim()) {
				const query = searchQuery.toLowerCase();
				return (
					template.title.toLowerCase().includes(query) ||
					template.description.toLowerCase().includes(query) ||
					template.domain.toLowerCase().includes(query)
				);
			}

			return true;
		})
	);

	// Overflow detection for domain filter scroll masks
	let scrollWrapper: HTMLDivElement | undefined = $state();
	let hasOverflow = $state(false);

	function checkOverflow() {
		if (!scrollWrapper) return;
		const scrollEl = scrollWrapper.querySelector('.domain-filter-scroll');
		if (scrollEl) {
			hasOverflow = scrollEl.scrollWidth > scrollEl.clientWidth;
		}
	}

	$effect(() => {
		checkOverflow();
		window.addEventListener('resize', checkOverflow);
		return () => window.removeEventListener('resize', checkOverflow);
	});

	// Handle template selection
	function handleTemplateSelect(slug: string) {
		goto(`/s/${slug}`);
	}
</script>

<svelte:head>
	<title>Browse Templates | Commons</title>
	<meta
		name="description"
		content="Browse templates to contact your representatives about issues that matter to you."
	/>
</svelte:head>

<div class="min-h-screen bg-gray-50 pb-12">
	<!-- Header Section -->
	<div>
		<div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
			<h1 class="text-3xl font-bold text-gray-900 md:text-4xl">Browse Templates</h1>
			<p class="mt-2 text-lg text-gray-600">
				Find templates to contact your representatives about issues that matter to you
			</p>
		</div>
	</div>

	<!-- Filters and Search -->
	<div class="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
		<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
			<!-- Search Input -->
			<div class="relative flex-1 md:max-w-md">
				<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
					<Search class="h-5 w-5 text-gray-400" aria-hidden="true" />
				</div>
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search templates..."
					class="block w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm placeholder-gray-400 focus:border-congressional-500 focus:outline-none focus:ring-1 focus:ring-congressional-500"
					aria-label="Search templates"
				/>
			</div>

			<!-- Domain Filter -->
			<div class="flex min-w-0 flex-1 items-center gap-2">
				<Filter class="h-5 w-5 shrink-0 text-gray-500" aria-hidden="true" />
				<div bind:this={scrollWrapper} class="domain-filter-scroll-wrapper relative min-w-0 flex-1" class:has-overflow={hasOverflow}>
					<div class="domain-filter-scroll flex gap-2 overflow-x-auto py-1">
						{#each domains as domain}
							<button
								type="button"
								class="whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition-colors"
								class:border-congressional-400={selectedDomain === domain}
								class:bg-congressional-50={selectedDomain === domain}
								class:text-congressional-700={selectedDomain === domain}
								class:border-gray-300={selectedDomain !== domain}
								class:bg-white={selectedDomain !== domain}
								class:text-gray-700={selectedDomain !== domain}
								class:hover:border-gray-400={selectedDomain !== domain}
								onclick={() => (selectedDomain = domain)}
								aria-pressed={selectedDomain === domain}
							>
								{domain === 'all' ? 'All' : domain}
							</button>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- Results Count -->
		<div class="mt-6 flex items-center justify-between">
			<p class="text-sm text-gray-600">
				{filteredTemplates.length}
				{filteredTemplates.length === 1 ? 'template' : 'templates'}
				{#if searchQuery || selectedDomain !== 'all'}
					<span class="text-gray-500">
						{#if searchQuery}
							matching "{searchQuery}"
						{/if}
						{#if selectedDomain !== 'all'}
							in {selectedDomain}
						{/if}
					</span>
				{/if}
			</p>
		</div>
	</div>

	<!-- Template Grid -->
	<div class="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
		{#if filteredTemplates.length === 0}
			<!-- Empty State -->
			<div class="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
				<Search class="mx-auto h-12 w-12 text-gray-400" />
				<h3 class="mt-2 text-sm font-medium text-gray-900">No templates found</h3>
				<p class="mt-1 text-sm text-gray-500">
					Try adjusting your search or filter to find what you're looking for.
				</p>
				<button
					type="button"
					class="mt-4 rounded-lg bg-congressional-500 px-4 py-2 text-sm font-medium text-white hover:bg-congressional-600"
					onclick={() => {
						searchQuery = '';
						selectedDomain = 'all';
					}}
				>
					Clear filters
				</button>
			</div>
		{:else}
			<!-- Grid Layout -->
			<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3" data-testid="template-grid">
				{#each filteredTemplates as template (template.id)}
					<TemplateCard
						template={template as unknown as import('$lib/types/template').Template}
						variant="grid"
						onSelect={() => handleTemplateSelect(template.slug)}
					/>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.domain-filter-scroll {
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
	}

	.domain-filter-scroll::-webkit-scrollbar {
		display: none;
	}

	.domain-filter-scroll > :global(button) {
		scroll-snap-align: start;
	}

	/* Fade masks appear only when the scroll container overflows.
	   Uses CSS containment: the wrapper clips, masks sit at edges.
	   Color matches bg-gray-50 (rgb(249,250,251) ≈ oklch(0.98 0.002 247)). */
	.domain-filter-scroll-wrapper.has-overflow::before,
	.domain-filter-scroll-wrapper.has-overflow::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1.5rem;
		pointer-events: none;
		z-index: 1;
	}

	.domain-filter-scroll-wrapper.has-overflow::before {
		left: 0;
		background: linear-gradient(to right, rgb(249 250 251), transparent);
	}

	.domain-filter-scroll-wrapper.has-overflow::after {
		right: 0;
		background: linear-gradient(to left, rgb(249 250 251), transparent);
	}
</style>
