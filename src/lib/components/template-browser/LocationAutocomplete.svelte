<script lang="ts">
	/**
	 * LocationAutocomplete: Interactive breadcrumb with location editing
	 *
	 * UX PATTERN:
	 * - Hover → pencil icon fades in (affordance)
	 * - Click → autocomplete dropdown opens
	 * - Type → debounced API search (300ms)
	 * - Select → location updates, templates re-filter
	 *
	 * ACCESSIBILITY:
	 * - Keyboard navigation (Tab, Enter, Escape, Arrow keys)
	 * - ARIA labels for screen readers
	 * - Focus trap within dropdown
	 */

	import { searchLocations, type LocationHierarchy } from '$lib/core/location/location-search';
	import { browser } from '$app/environment';

	interface LocationAutocompleteProps {
		label: string; // Display label (e.g., "California", "San Francisco")
		level: 'country' | 'state' | 'city' | 'district'; // Geographic level
		mode?: 'omnibar' | 'scoped'; // omnibar: search any place; scoped: constrained to level
		currentCountry?: string; // Filter results to country
		currentState?: string; // Filter results to state
		isSelected?: boolean; // Whether this breadcrumb is currently filtering
		suggestedLocations?: string[]; // Array of suggested location strings
		onselect?: (data: LocationHierarchy) => void;
		onfilter?: (level: 'country' | 'state' | 'city' | 'district') => void;
	}

	let {
		label,
		level,
		mode = 'scoped',
		currentCountry,
		currentState,
		isSelected = false,
		suggestedLocations = [],
		onselect,
		onfilter
	}: LocationAutocompleteProps = $props();

	// State
	let isHovering = $state(false);
	let isOpen = $state(false);
	let searchQuery = $state('');
	let results = $state<LocationHierarchy[]>([]);
	let selectedIndex = $state(0);
	let isLoading = $state(false);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	// Refs for click-outside detection
	let containerRef: HTMLDivElement | null = $state(null);
	let inputRef: HTMLInputElement | null = $state(null);

	// Debounced search function
	async function handleSearch(query: string) {
		if (!query || query.trim().length < 2) {
			results = [];
			isLoading = false;
			return;
		}

		isLoading = true;

		try {
			// Omnibar: no scope constraint. Scoped: map level to search scope.
			const scope = mode === 'omnibar'
				? 'any'
				: level === 'country' ? 'country' : level === 'state' ? 'state' : 'city';

			const searchResults = await searchLocations(query, scope, currentCountry, currentState);

			results = searchResults;
			selectedIndex = 0; // Reset selection on new results
		} catch (error) {
			console.error('[LocationAutocomplete] Search failed:', error);
			results = [];
		} finally {
			isLoading = false;
		}
	}

	// Debounce input changes
	function onInput(e: Event) {
		const target = e.target as HTMLInputElement;
		searchQuery = target.value;

		// Clear existing timeout
		if (searchTimeout) {
			clearTimeout(searchTimeout);
		}

		// Set new timeout (300ms debounce)
		searchTimeout = setTimeout(() => {
			handleSearch(searchQuery);
		}, 300);
	}

	// Handle result selection
	function handleSelect(result: LocationHierarchy, index: number) {
		onselect?.(result);
		closeDropdown();
	}

	// Handle filter click (toggle scope filtering)
	function handleFilterClick() {
		if (!isOpen) {
			onfilter?.(level);
		}
	}

	// Open dropdown
	function openDropdown() {
		isOpen = true;
		searchQuery = '';
		results = [];
		selectedIndex = 0;

		// Focus input after dropdown opens
		setTimeout(() => {
			inputRef?.focus();
		}, 0);
	}

	// Close dropdown
	function closeDropdown() {
		isOpen = false;
		searchQuery = '';
		results = [];
		selectedIndex = 0;
	}

	// Keyboard navigation
	function handleKeydown(e: KeyboardEvent) {
		if (!isOpen) {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openDropdown();
			}
			return;
		}

		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				closeDropdown();
				break;

			case 'ArrowDown':
				e.preventDefault();
				selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
				break;

			case 'ArrowUp':
				e.preventDefault();
				selectedIndex = Math.max(selectedIndex - 1, 0);
				break;

			case 'Enter':
				e.preventDefault();
				if (results.length > 0 && selectedIndex >= 0) {
					handleSelect(results[selectedIndex], selectedIndex);
				}
				break;
		}
	}

	// Click outside to close
	function handleClickOutside(e: MouseEvent) {
		if (containerRef && !containerRef.contains(e.target as Node)) {
			closeDropdown();
		}
	}

	// Attach/detach click-outside listener (browser only - prevents SSR crash)
	$effect(() => {
		if (browser && isOpen) {
			document.addEventListener('click', handleClickOutside);
			return () => {
				document.removeEventListener('click', handleClickOutside);
			};
		}
	});

	// Cleanup timeout on unmount (prevents memory leaks and stale API calls)
	$effect(() => {
		return () => {
			if (searchTimeout) {
				clearTimeout(searchTimeout);
				searchTimeout = null;
			}
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={containerRef}
	class="relative inline-flex"
	role="group"
	onmouseenter={() => (isHovering = true)}
	onmouseleave={() => (isHovering = false)}
>
	<!-- Breadcrumb button (filter + edit affordance) -->
	<button
		onclick={() => {
			if (isOpen) {
				closeDropdown();
			} else {
				handleFilterClick();
				openDropdown();
			}
		}}
		onkeydown={handleKeydown}
		class="group relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors hover:bg-slate-100"
		class:bg-slate-100={isSelected}
		class:text-slate-900={isSelected}
		class:text-slate-700={!isSelected}
		aria-label="Filter by {label}"
		aria-haspopup="listbox"
		aria-expanded={isOpen}
	>
		<span>{label}</span>

		<!-- Edit icon (pencil) - shown on hover, now a span to avoid nested button -->
		{#if isHovering || isOpen}
			<span
				class="inline-flex items-center transition-opacity"
				class:opacity-100={isHovering || isOpen}
				class:opacity-0={!isHovering && !isOpen}
				aria-hidden="true"
			>
				<svg
					class="h-3 w-3 text-slate-400 transition-colors hover:text-slate-600"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
					/>
				</svg>
			</span>
		{/if}
	</button>

	<!-- Autocomplete dropdown -->
	{#if isOpen}
		<div
			class="absolute left-0 top-full z-50 mt-2 w-80 rounded-lg border border-slate-200 bg-white shadow-md ring-1 ring-slate-900/5"
		>
			<!-- Search input -->
			<div class="border-b border-slate-100 p-3">
				<input
					bind:this={inputRef}
					type="text"
					value={searchQuery}
					oninput={onInput}
					onkeydown={handleKeydown}
					placeholder={mode === 'omnibar'
						? 'Search any place...'
						: `Search ${level === 'country' ? 'countries' : level === 'state' ? 'states' : 'cities'}...`}
					class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
					autocomplete="off"
					spellcheck="false"
				/>
			</div>

			<!-- Results list -->
			<ul
				role="listbox"
				aria-label="{level.charAt(0).toUpperCase() + level.slice(1)} search results"
				class="max-h-64 overflow-y-auto py-1"
			>
				{#if isLoading}
					<!-- Loading state -->
					<li class="px-3 py-2 text-center text-sm text-slate-500">
						<svg class="mx-auto h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							></circle>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							></path>
						</svg>
						<span class="mt-1 block">Searching...</span>
					</li>
				{:else if results.length === 0 && searchQuery.trim().length === 0 && suggestedLocations.length > 0}
					<!-- Suggested Locations -->
					<li
						class="bg-slate-50/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400"
					>
						Suggested
					</li>
					{#each suggestedLocations as suggestion}
						<li
							class="cursor-pointer px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
							onclick={() => {
								searchQuery = suggestion;
								handleSearch(suggestion);
								inputRef?.focus();
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									searchQuery = suggestion;
									handleSearch(suggestion);
									inputRef?.focus();
								}
							}}
							tabindex="0"
							role="option" aria-selected={false}
						>
							<div class="flex items-center gap-2">
								<svg
									class="h-3.5 w-3.5 text-participation-primary-500"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M13 10V3L4 14h7v7l9-11h-7z"
									/>
								</svg>
								{suggestion}
							</div>
						</li>
					{/each}
				{:else if results.length === 0}
					<!-- Empty state -->
					<li class="px-3 py-6 text-center text-sm text-slate-500">
						{#if searchQuery.trim().length >= 2}
							No results found
						{:else}
							Type to search
						{/if}
					</li>
				{:else}
					<!-- Results -->
					{#each ['city', 'state', 'country'] as groupLevel}
						{@const groupResults = results.filter((r) => {
							if (groupLevel === 'city') return r.city;
							if (groupLevel === 'state') return !r.city && r.state;
							if (groupLevel === 'country') return !r.city && !r.state && r.country;
							return false;
						})}

						{#if groupResults.length > 0}
							<li
								class="sticky top-0 bg-slate-50/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400"
							>
								{groupLevel === 'city'
									? 'Cities'
									: groupLevel === 'state'
										? 'States / Provinces'
										: 'Countries'}
							</li>
						{/if}

						{#each groupResults as result}
							{@const originalIndex = results.indexOf(result)}
							<li
								role="option"
								aria-selected={originalIndex === selectedIndex}
								tabindex={originalIndex === selectedIndex ? 0 : -1}
								onclick={() => handleSelect(result, originalIndex)}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										handleSelect(result, originalIndex);
									}
								}}
								class="cursor-pointer px-3 py-2 text-sm transition-colors"
								class:bg-blue-50={originalIndex === selectedIndex}
								class:text-blue-900={originalIndex === selectedIndex}
								class:hover:bg-slate-50={originalIndex !== selectedIndex}
							>
								<div class="font-medium text-slate-900">
									{#if mode === 'omnibar'}
										{result.city?.name || result.state?.name || result.country.name}
									{:else if level === 'country'}
										{result.country.name}
									{:else if level === 'state'}
										{result.state?.name || result.display_name}
									{:else}
										{result.city?.name || result.display_name}
									{/if}
								</div>
								<div class="mt-0.5 text-xs text-slate-500">{result.display_name}</div>
							</li>
						{/each}
					{/each}
				{/if}
			</ul>
		</div>
	{/if}
</div>
