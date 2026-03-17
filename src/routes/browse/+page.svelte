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
	let selectedCategory = $state<string>('all');

	// Available categories derived from server data
	const categories = $derived(['all', ...new Set(data.templates.map((t) => t.category))]);

	// Filtered templates based on search and category
	const filteredTemplates = $derived(
		data.templates.filter((template) => {
			// Category filter
			if (selectedCategory !== 'all' && template.category !== selectedCategory) {
				return false;
			}

			// Search filter
			if (searchQuery.trim()) {
				const query = searchQuery.toLowerCase();
				return (
					template.title.toLowerCase().includes(query) ||
					template.description.toLowerCase().includes(query) ||
					template.category.toLowerCase().includes(query)
				);
			}

			return true;
		})
	);

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
	<div class="bg-white shadow-sm">
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

			<!-- Category Filter -->
			<div class="flex items-center gap-2">
				<Filter class="h-5 w-5 text-gray-500" aria-hidden="true" />
				<div class="flex flex-wrap gap-2">
					{#each categories as category}
						<button
							type="button"
							class="rounded-full border px-4 py-1.5 text-sm font-medium transition-colors"
							class:border-congressional-400={selectedCategory === category}
							class:bg-congressional-50={selectedCategory === category}
							class:text-congressional-700={selectedCategory === category}
							class:border-gray-300={selectedCategory !== category}
							class:bg-white={selectedCategory !== category}
							class:text-gray-700={selectedCategory !== category}
							class:hover:border-gray-400={selectedCategory !== category}
							onclick={() => (selectedCategory = category)}
							aria-pressed={selectedCategory === category}
						>
							{category === 'all' ? 'All' : category}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<!-- Results Count -->
		<div class="mt-6 flex items-center justify-between">
			<p class="text-sm text-gray-600">
				{filteredTemplates.length}
				{filteredTemplates.length === 1 ? 'template' : 'templates'}
				{#if searchQuery || selectedCategory !== 'all'}
					<span class="text-gray-500">
						{#if searchQuery}
							matching "{searchQuery}"
						{/if}
						{#if selectedCategory !== 'all'}
							in {selectedCategory}
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
						selectedCategory = 'all';
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
