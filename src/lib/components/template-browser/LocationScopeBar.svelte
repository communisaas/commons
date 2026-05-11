<script lang="ts">
	/**
	 * LocationScopeBar — geographic scope selector and breadcrumb display.
	 *
	 * Renders in one of three states:
	 *   invitation — no scope set; the bar is the search field
	 *   display    — scope set; breadcrumb chips with search and clear actions
	 *   searching  — input active; grouped results dropdown
	 *
	 * Each breadcrumb chip toggles scope filtering (city/state/country).
	 * Selecting a result resolves to a GeoScope and emits onScopeChange.
	 */

	import { searchLocations, type LocationHierarchy } from '$lib/core/location/location-search';
	import {
		resolveToGeoScope,
		stateCodeToName,
		countryCodeToName
	} from '$lib/core/location/location-resolver';
	import type { GeoScope } from '$lib/core/agents/types';
	import type { GeographicScope } from '$lib/core/location/template-filter';
	import { browser } from '$app/environment';

	interface Props {
		scope: GeoScope | null;
		inferred?: boolean;
		onScopeChange: (scope: GeoScope | null) => void;
	}

	let { scope, onScopeChange, inferred = false }: Props = $props();

	// ---------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------

	let isSearching = $state(false);
	let searchQuery = $state('');
	let results = $state<LocationHierarchy[]>([]);
	let selectedIndex = $state(-1);
	let isLoading = $state(false);
	let selectedFilter = $state<GeographicScope>(null);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	let containerRef: HTMLDivElement | null = $state(null);
	let inputRef: HTMLInputElement | null = $state(null);

	// ---------------------------------------------------------------------------
	// Derived breadcrumb labels
	// ---------------------------------------------------------------------------

	const breadcrumbCountry = $derived.by(() => {
		if (!scope) return null;
		if (scope.type === 'international') return null;
		return countryCodeToName(scope.country) || scope.country;
	});

	const breadcrumbState = $derived.by(() => {
		if (!scope || scope.type !== 'subnational' || !scope.subdivision) return null;
		const stateCode = scope.subdivision.split('-')[1];
		if (!stateCode) return null;
		return stateCodeToName(stateCode, scope.country) || stateCode;
	});

	const breadcrumbCity = $derived.by(() => {
		if (!scope || scope.type !== 'subnational') return null;
		return scope.locality || null;
	});

	const hasScope = $derived(scope != null && scope.type !== 'international');

	// ---------------------------------------------------------------------------
	// Search logic
	// ---------------------------------------------------------------------------

	function openSearch() {
		isSearching = true;
		searchQuery = '';
		results = [];
		selectedIndex = -1;
		setTimeout(() => inputRef?.focus(), 0);
	}

	function closeSearch() {
		isSearching = false;
		searchQuery = '';
		results = [];
		selectedIndex = -1;
		if (searchTimeout) {
			clearTimeout(searchTimeout);
			searchTimeout = null;
		}
	}

	async function executeSearch(query: string) {
		if (!query || query.trim().length < 2) {
			results = [];
			isLoading = false;
			return;
		}

		isLoading = true;
		try {
			const searchResults = await searchLocations(query, 'any');
			results = searchResults;
			selectedIndex = searchResults.length > 0 ? 0 : -1;
		} catch {
			results = [];
		} finally {
			isLoading = false;
		}
	}

	function onInput(e: Event) {
		const target = e.target as HTMLInputElement;
		searchQuery = target.value;
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => executeSearch(searchQuery), 300);
	}

	function handleSelect(result: LocationHierarchy) {
		const geoScope = resolveToGeoScope(result);
		selectedFilter = null;
		onScopeChange(geoScope);
		closeSearch();
	}

	function handleClear() {
		selectedFilter = null;
		onScopeChange(null);
	}

	function handleScopeFilter(filterScope: GeographicScope) {
		selectedFilter = selectedFilter === filterScope ? null : filterScope;
	}

	function fillExample(text: string) {
		searchQuery = text;
		executeSearch(text);
	}

	// ---------------------------------------------------------------------------
	// Result helpers
	// ---------------------------------------------------------------------------

	function getResultLevel(result: LocationHierarchy): 'city' | 'state' | 'country' {
		if (result.city) return 'city';
		if (result.state) return 'state';
		return 'country';
	}

	function getResultPrimary(result: LocationHierarchy): string {
		if (result.city) return result.city.name;
		if (result.state) return result.state.name;
		return result.country.name;
	}

	function getResultContext(result: LocationHierarchy): string {
		const parts: string[] = [];
		if (result.city && result.state) parts.push(result.state.name);
		if (result.country) parts.push(result.country.name);
		return parts.join(', ');
	}

	const groupedResults = $derived.by(() => {
		const groups: { key: string; label: string; items: LocationHierarchy[] }[] = [];

		const cities = results.filter((r) => r.city);
		const states = results.filter((r) => !r.city && r.state);
		const countries = results.filter((r) => !r.city && !r.state);

		if (cities.length > 0) groups.push({ key: 'city', label: 'Cities', items: cities });
		if (states.length > 0)
			groups.push({ key: 'state', label: 'States & Provinces', items: states });
		if (countries.length > 0)
			groups.push({ key: 'country', label: 'Countries', items: countries });

		return groups;
	});

	const flatResults = $derived(groupedResults.flatMap((g) => g.items));

	// ---------------------------------------------------------------------------
	// Keyboard navigation
	// ---------------------------------------------------------------------------

	function handleKeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				closeSearch();
				break;
			case 'ArrowDown':
				e.preventDefault();
				if (flatResults.length > 0) {
					selectedIndex = Math.min(selectedIndex + 1, flatResults.length - 1);
					scrollSelectedIntoView();
				}
				break;
			case 'ArrowUp':
				e.preventDefault();
				if (flatResults.length > 0) {
					selectedIndex = Math.max(selectedIndex - 1, 0);
					scrollSelectedIntoView();
				}
				break;
			case 'Enter':
				e.preventDefault();
				if (flatResults.length > 0 && selectedIndex >= 0) {
					handleSelect(flatResults[selectedIndex]);
				}
				break;
		}
	}

	function scrollSelectedIntoView() {
		requestAnimationFrame(() => {
			const el = containerRef?.querySelector(`[data-result-index="${selectedIndex}"]`);
			el?.scrollIntoView({ block: 'nearest' });
		});
	}

	// ---------------------------------------------------------------------------
	// Click-outside and cleanup
	// ---------------------------------------------------------------------------

	function handlePointerDownOutside(e: PointerEvent) {
		if (containerRef && !containerRef.contains(e.target as Node)) {
			closeSearch();
		}
	}

	$effect(() => {
		if (browser && isSearching) {
			// Use pointerdown (not click) for outside detection. pointerdown fires
			// BEFORE onclick handlers, so:
			// 1. The opening button is still in the DOM during the check
			// 2. Hint pills / result buttons haven't re-rendered yet
			// This avoids the orphaned-target race condition where a click removes
			// its own element from the DOM before propagation reaches document.
			document.addEventListener('pointerdown', handlePointerDownOutside);
			return () => document.removeEventListener('pointerdown', handlePointerDownOutside);
		}
	});

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
<div bind:this={containerRef} class="location-bar" class:is-searching={isSearching}>
	{#if isSearching}
		<!-- ===== SEARCH MODE ===== -->
		<div class="bar-input">
			<svg
				class="bar-search-icon"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
			<input
				bind:this={inputRef}
				type="text"
				value={searchQuery}
				oninput={onInput}
				onkeydown={handleKeydown}
				placeholder="Search any city, state, or country..."
				autocomplete="off"
				spellcheck="false"
			/>
			<button class="bar-close-btn" onclick={closeSearch} aria-label="Close search">
				<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Search results dropdown -->
		<div class="search-dropdown" role="listbox" aria-label="Location search results">
			{#if isLoading}
				<div class="dropdown-status">
					<svg class="spinner" fill="none" viewBox="0 0 24 24">
						<circle
							class="spinner-track"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							stroke-width="4"
						></circle>
						<path
							class="spinner-head"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						></path>
					</svg>
				</div>
			{:else if results.length === 0 && searchQuery.trim().length >= 2}
				<div class="dropdown-status">No places found</div>
			{:else if results.length === 0}
				<!-- Affordance hints: clickable examples that concretize multi-level search -->
				<div class="dropdown-hints">
					<span class="hints-label">Try</span>
					<button class="hint-pill" onclick={() => fillExample('Oakland')}>Oakland</button>
					<span class="hints-sep" aria-hidden="true">&middot;</span>
					<button class="hint-pill" onclick={() => fillExample('Texas')}>Texas</button>
					<span class="hints-sep" aria-hidden="true">&middot;</span>
					<button class="hint-pill" onclick={() => fillExample('Canada')}>Canada</button>
				</div>
			{:else}
				<!-- Grouped results with level badges -->
				{#each groupedResults as group}
					<div class="result-group-header">{group.label}</div>
					{#each group.items as result}
						{@const flatIndex = flatResults.indexOf(result)}
						{@const level = getResultLevel(result)}
						<button
							class="result-item"
							class:result-selected={flatIndex === selectedIndex}
							role="option"
							aria-selected={flatIndex === selectedIndex}
							data-result-index={flatIndex}
							onclick={() => handleSelect(result)}
						>
							<div class="result-content">
								<div class="result-primary">{getResultPrimary(result)}</div>
								{#if getResultContext(result)}
									<div class="result-context">{getResultContext(result)}</div>
								{/if}
							</div>
							<span
								class="level-badge"
								class:level-city={level === 'city'}
								class:level-state={level === 'state'}
								class:level-country={level === 'country'}
							>
								{level}
							</span>
						</button>
					{/each}
				{/each}
			{/if}
		</div>
	{:else if hasScope}
		<!-- ===== BREADCRUMB DISPLAY MODE ===== -->
		<div class="bar-display">
			<nav class="breadcrumb-chips" aria-label="Geographic scope">
				{#if breadcrumbCountry}
					<button
						class="chip"
						class:chip-active={selectedFilter === 'nationwide'}
						onclick={() => handleScopeFilter('nationwide')}
					>
						{breadcrumbCountry}
					</button>
				{/if}

				{#if breadcrumbState}
					<span class="chip-sep" aria-hidden="true">&rsaquo;</span>
					<button
						class="chip"
						class:chip-active={selectedFilter === 'state'}
						onclick={() => handleScopeFilter('state')}
					>
						{breadcrumbState}
					</button>
				{/if}

				{#if breadcrumbCity}
					<span class="chip-sep" aria-hidden="true">&rsaquo;</span>
					<button
						class="chip"
						class:chip-active={selectedFilter === 'city'}
						onclick={() => handleScopeFilter('city')}
					>
						{breadcrumbCity}
					</button>
				{/if}
			</nav>

			<div class="bar-actions">
				<button
					class="action-btn"
					onclick={openSearch}
					aria-label="Search for a different location"
					title="Search for a different location"
				>
					<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
				</button>
				<button
					class="action-btn action-clear"
					onclick={handleClear}
					aria-label="Clear location"
					title="Clear location"
				>
					<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>
		</div>

		{#if inferred}
			<div class="privacy-note">
				<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
					/>
				</svg>
				<span>Approximated from your connection</span>
			</div>
		{/if}
	{:else}
		<!-- ===== EMPTY STATE: SEARCH INVITATION ===== -->
		<button class="bar-invitation" onclick={openSearch}>
			<svg
				class="bar-search-icon"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
			<div class="invitation-content">
				<span class="invitation-primary">Search any city, state, or country.</span>
				<span class="invitation-hint">Templates and decision-makers near you.</span>
			</div>
		</button>
	{/if}
</div>

<style>
	/* =========================================================================
	 * BAR CONTAINER — consistent shape across all states
	 * ========================================================================= */

	.location-bar {
		position: relative;
		background: oklch(0.975 0.006 250);
		border-radius: 8px;
		border: 1px solid transparent;
		transition:
			background 150ms ease-out,
			border-color 150ms ease-out,
			box-shadow 150ms ease-out;
	}

	.location-bar.is-searching {
		border-color: oklch(0.55 0.15 195);
		box-shadow: 0 0 0 3px oklch(0.7 0.1 195 / 0.12);
	}

	/* =========================================================================
	 * SEARCH MODE — input row
	 * ========================================================================= */

	.bar-input {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
	}

	.bar-search-icon {
		height: 1rem;
		width: 1rem;
		flex-shrink: 0;
		color: oklch(0.55 0.02 250);
	}

	.bar-input input {
		flex: 1;
		border: none;
		outline: none;
		font-size: 0.875rem;
		color: oklch(0.15 0.02 250);
		background: transparent;
		font-family: 'Satoshi', system-ui, sans-serif;
	}

	.bar-input input::placeholder {
		color: oklch(0.6 0.015 250);
	}

	.bar-close-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		border-radius: 50%;
		border: none;
		background: transparent;
		color: oklch(0.55 0.02 250);
		cursor: pointer;
		transition: all 100ms ease-out;
	}

	.bar-close-btn svg {
		height: 0.875rem;
		width: 0.875rem;
	}

	.bar-close-btn:hover {
		background: oklch(0.94 0.015 250);
		color: oklch(0.3 0.03 250);
	}

	/* =========================================================================
	 * SEARCH DROPDOWN
	 * ========================================================================= */

	.search-dropdown {
		position: absolute;
		left: -1px;
		right: -1px;
		top: calc(100% + 0.25rem);
		z-index: 50;
		max-height: 20rem;
		overflow-y: auto;
		background: white;
		border-radius: 8px;
		border: 1px solid oklch(0.92 0.01 250);
		box-shadow:
			0 8px 24px oklch(0 0 0 / 0.08),
			0 2px 8px oklch(0 0 0 / 0.04);
	}

	.dropdown-status {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 1.25rem;
		font-size: 0.8125rem;
		color: oklch(0.55 0.02 250);
		font-family: 'Satoshi', system-ui, sans-serif;
	}

	.spinner {
		height: 1rem;
		width: 1rem;
		animation: spin 1s linear infinite;
	}

	.spinner-track {
		opacity: 0.2;
	}

	.spinner-head {
		opacity: 0.75;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* --- Affordance hints --- */

	.dropdown-hints {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem 1rem;
		font-family: 'Satoshi', system-ui, sans-serif;
	}

	.hints-label {
		font-size: 0.8125rem;
		color: oklch(0.6 0.015 250);
	}

	.hint-pill {
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.4 0.06 250);
		background: oklch(0.97 0.008 250);
		padding: 0.1875rem 0.5rem;
		border-radius: 0.375rem;
		border: 1px solid oklch(0.93 0.01 250);
		cursor: pointer;
		transition: all 100ms ease-out;
		font-family: 'Satoshi', system-ui, sans-serif;
	}

	.hint-pill:hover {
		background: oklch(0.95 0.015 250);
		border-color: oklch(0.88 0.02 250);
		color: oklch(0.3 0.08 250);
	}

	.hints-sep {
		color: oklch(0.75 0.01 250);
		font-size: 0.75rem;
	}

	/* --- Result groups --- */

	.result-group-header {
		position: sticky;
		top: 0;
		padding: 0.4375rem 1rem;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: oklch(0.55 0.02 250);
		background: oklch(0.985 0.003 250);
		border-bottom: 1px solid oklch(0.95 0.005 250);
		font-family: 'Satoshi', system-ui, sans-serif;
	}

	.result-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		padding: 0.5rem 1rem;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		transition: background 80ms ease-out;
		font-family: 'Satoshi', system-ui, sans-serif;
	}

	.result-item:hover,
	.result-item.result-selected {
		background: oklch(0.97 0.008 250);
	}

	.result-content {
		flex: 1;
		min-width: 0;
	}

	.result-primary {
		font-size: 0.875rem;
		font-weight: 500;
		color: oklch(0.15 0.02 250);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.result-context {
		font-size: 0.75rem;
		color: oklch(0.55 0.015 250);
		margin-top: 0.0625rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Level annotations — typographic mono, color-tinted text only */

	.level-badge {
		flex-shrink: 0;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-feature-settings: 'tnum';
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.level-city {
		color: oklch(0.42 0.1 165);
	}

	.level-state {
		color: oklch(0.42 0.1 250);
	}

	.level-country {
		color: oklch(0.42 0.1 55);
	}

	/* =========================================================================
	 * BREADCRUMB DISPLAY MODE
	 * ========================================================================= */

	.bar-display {
		display: flex;
		align-items: center;
		padding: 0.375rem 0.5rem;
		gap: 0.25rem;
	}

	.breadcrumb-chips {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.5rem;
		border-radius: 0.375rem;
		border: none;
		background: transparent;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.35 0.025 250);
		cursor: pointer;
		transition: all 120ms ease-out;
		font-family: 'Satoshi', system-ui, sans-serif;
		white-space: nowrap;
	}

	.chip:hover {
		background: oklch(0.955 0.01 250);
		color: oklch(0.2 0.03 250);
	}

	.chip.chip-active {
		background: oklch(0.93 0.025 250);
		color: oklch(0.2 0.04 250);
	}

	.chip-sep {
		color: oklch(0.72 0.01 250);
		font-size: 1rem;
		line-height: 1;
		user-select: none;
		padding: 0 0.0625rem;
	}

	.bar-actions {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		flex-shrink: 0;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.375rem;
		border-radius: 0.375rem;
		border: none;
		background: transparent;
		color: oklch(0.55 0.015 250);
		cursor: pointer;
		transition: all 100ms ease-out;
	}

	.action-btn svg {
		height: 0.875rem;
		width: 0.875rem;
	}

	.action-btn:hover {
		background: oklch(0.955 0.01 250);
		color: oklch(0.35 0.04 250);
	}

	.action-clear:hover {
		color: oklch(0.45 0.08 15);
	}

	/* =========================================================================
	 * EMPTY / INVITATION STATE
	 * ========================================================================= */

	.bar-invitation {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: none;
		border-radius: 8px;
		background: transparent;
		cursor: pointer;
		transition: background 120ms ease-out;
		font-family: 'Satoshi', system-ui, sans-serif;
		text-align: left;
	}

	.bar-invitation:hover {
		background: oklch(0.965 0.008 250);
	}

	.invitation-content {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
	}

	.invitation-primary {
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.5 0.02 250);
	}

	.invitation-hint {
		font-size: 0.6875rem;
		color: oklch(0.65 0.01 250);
	}

	/* =========================================================================
	 * PRIVACY NOTE
	 * ========================================================================= */

	.privacy-note {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0 0.75rem;
		padding: 0.375rem 0;
		border-top: 1px solid oklch(0.955 0.005 250);
		font-size: 0.6875rem;
		color: oklch(0.62 0.015 250);
		font-family: 'Satoshi', system-ui, sans-serif;
	}

	.privacy-note svg {
		height: 0.6875rem;
		width: 0.6875rem;
		flex-shrink: 0;
	}
</style>
