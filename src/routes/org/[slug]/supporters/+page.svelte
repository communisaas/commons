<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import SegmentBuilder from '$lib/components/segments/SegmentBuilder.svelte';
	import VerificationPipeline from '$lib/components/org/VerificationPipeline.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Segment builder toggle
	let showSegmentBuilder = $state(false);

	// Tag manager state
	let showTagManager = $state(false);
	let newTagName = $state('');
	let tagError = $state('');
	let editingTagId = $state<string | null>(null);
	let editingTagName = $state('');
	let deletingTagId = $state<string | null>(null);

	// Local state for "load more" accumulation
	let allSupporters = $state(data.supporters);
	let hasMore = $state(data.hasMore);
	let nextCursor = $state(data.nextCursor);
	let loadingMore = $state(false);

	// Reset accumulated list when filters/data change from URL navigation
	$effect(() => {
		allSupporters = data.supporters;
		hasMore = data.hasMore;
		nextCursor = data.nextCursor;
	});

	// Search debounce
	let searchInput = $state(data.filters.q);
	let searchTimeout: ReturnType<typeof setTimeout> | undefined;

	function onSearchInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		searchInput = value;
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			updateFilter('q', value || null);
		}, 300);
	}

	// Filter helpers
	function updateFilter(key: string, value: string | null) {
		const url = new URL($page.url);
		if (value) {
			url.searchParams.set(key, value);
		} else {
			url.searchParams.delete(key);
		}
		// Reset cursor when filters change
		url.searchParams.delete('cursor');
		goto(url.toString(), { replaceState: true, keepFocus: true });
	}

	function removeFilter(key: string) {
		updateFilter(key, null);
		if (key === 'q') searchInput = '';
	}

	// Active filter chips
	const activeChips = $derived(buildActiveChips());

	function buildActiveChips(): Array<{ key: string; label: string }> {
		const chips: Array<{ key: string; label: string }> = [];
		if (data.filters.q) chips.push({ key: 'q', label: `Search: "${data.filters.q}"` });
		if (data.filters.status) chips.push({ key: 'status', label: `Status: ${data.filters.status}` });
		if (data.filters.verified) chips.push({ key: 'verified', label: data.filters.verified === 'true' ? 'Verified' : 'Unverified' });
		if (data.filters.source) chips.push({ key: 'source', label: `Source: ${sourceLabel(data.filters.source)}` });
		if (data.filters.tagId) {
			const tag = data.tags.find((t) => t.id === data.filters.tagId);
			if (tag) chips.push({ key: 'tag', label: `Tag: ${tag.name}` });
		}
		return chips;
	}

	// Load more
	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const url = new URL($page.url);
			url.searchParams.set('cursor', nextCursor);
			const response = await fetch(url.toString(), {
				headers: { accept: 'application/json' }
			});
			// SvelteKit returns the page data when fetching with the same URL
			// We need to use goto and accumulate instead
			// Actually, let's use the __data.json endpoint
			const dataUrl = new URL($page.url);
			dataUrl.searchParams.set('cursor', nextCursor);
			// Navigate but capture the data
			goto(dataUrl.toString(), { replaceState: true, keepFocus: true, noScroll: true });
		} catch {
			// ignore
		} finally {
			loadingMore = false;
		}
	}

	// Role check
	const canEdit = $derived(
		data.membership.role === 'owner' || data.membership.role === 'editor'
	);

	// Verification status helper
	function verificationState(s: typeof data.supporters[0]): 'Verified' | 'Resolved' | 'Imported' {
		if (s.identityVerified) return 'Verified';
		if (s.postalCode) return 'Resolved';
		return 'Imported';
	}

	// Source label
	function sourceLabel(source: string | null): string {
		switch (source) {
			case 'csv': return 'CSV';
			case 'action_network': return 'AN';
			case 'organic': return 'ORG';
			case 'widget': return 'WID';
			default: return '\u2014';
		}
	}

	// Relative time formatting
	function relativeTime(iso: string): string {
		const now = Date.now();
		const then = new Date(iso).getTime();
		const diffMs = now - then;
		const diffMin = Math.floor(diffMs / 60000);
		const diffHr = Math.floor(diffMs / 3600000);
		const diffDay = Math.floor(diffMs / 86400000);

		if (diffMin < 1) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		if (diffHr < 24) return `${diffHr}h ago`;
		if (diffDay < 7) return `${diffDay}d ago`;

		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	// Format number with commas
	function fmt(n: number): string {
		return n.toLocaleString('en-US');
	}

	// Email status filters
	const emailStatuses = ['subscribed', 'unsubscribed', 'bounced', 'complained'] as const;

	// Source options
	const sourceOptions = [
		{ value: 'csv', label: 'CSV' },
		{ value: 'action_network', label: 'Action Network' },
		{ value: 'organic', label: 'Organic' },
		{ value: 'widget', label: 'Widget' }
	] as const;
</script>

<div class="space-y-5">
	<!-- Header -->
	<div class="flex items-center justify-between gap-4">
		<div class="flex items-baseline gap-3">
			<h1 class="text-xl font-semibold text-text-primary">Supporters</h1>
			<span class="font-mono tabular-nums text-lg text-text-tertiary">{fmt(data.total)}</span>
		</div>
		<div class="flex items-center gap-3">
			{#if canEdit}
				<a
					href="/org/{data.org.slug}/supporters/import"
					class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 transition-colors"
				>
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
					</svg>
					Import
				</a>
			{/if}
		</div>
	</div>

	<!-- Verification Pipeline Hero -->
	{#if data.total > 0}
		<VerificationPipeline
			total={data.total}
			postalResolved={data.summary.postal + data.summary.verified}
			identityVerified={data.summary.verified}
			districtVerified={data.summary.verified}
		/>
	{/if}

	<!-- Email Health -->
	{#if data.total > 0}
		<div class="flex items-center gap-6 rounded-md border border-surface-border bg-surface-base px-5 py-3">
			<span class="text-xs font-medium text-text-secondary">Email Health</span>
			<span class="inline-flex items-center gap-1.5 text-xs">
				<span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
				<span class="text-text-tertiary">{fmt(data.emailHealth.subscribed)} subscribed</span>
			</span>
			<span class="inline-flex items-center gap-1.5 text-xs">
				<span class="inline-block w-2 h-2 rounded-full bg-yellow-500"></span>
				<span class="text-text-tertiary">{fmt(data.emailHealth.unsubscribed)} unsubscribed</span>
			</span>
			<span class="inline-flex items-center gap-1.5 text-xs">
				<span class="inline-block w-2 h-2 rounded-full bg-red-500"></span>
				<span class="text-text-tertiary">{fmt(data.emailHealth.bounced)} bounced</span>
			</span>
			<span class="inline-flex items-center gap-1.5 text-xs">
				<span class="inline-block w-2 h-2 rounded-full bg-red-700"></span>
				<span class="text-text-tertiary">{fmt(data.emailHealth.complained)} complained</span>
			</span>
		</div>
	{/if}

	<!-- Search -->
	<div class="relative">
		<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
			<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
		</svg>
		<input
			type="text"
			placeholder="Search by name or email..."
			value={searchInput}
			oninput={onSearchInput}
			class="participation-input pl-10 pr-4 py-2 text-sm"
		/>
	</div>

	<!-- Filter bar -->
	<div class="flex flex-wrap items-center gap-3">
		<!-- Verification toggle (primary filter) -->
		<div class="flex items-center gap-1 rounded-lg border border-surface-border p-0.5">
			<button
				type="button"
				class="px-3 py-1.5 text-xs rounded-md transition-colors {!data.filters.verified
					? 'bg-surface-overlay text-text-primary'
					: 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => removeFilter('verified')}
			>
				All
			</button>
			<button
				type="button"
				class="px-3 py-1.5 text-xs rounded-md transition-colors {data.filters.verified === 'true'
					? 'bg-surface-overlay text-text-primary'
					: 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => updateFilter('verified', 'true')}
			>
				Verified
			</button>
			<button
				type="button"
				class="px-3 py-1.5 text-xs rounded-md transition-colors {data.filters.verified === 'false'
					? 'bg-surface-overlay text-text-primary'
					: 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => updateFilter('verified', 'false')}
			>
				Unverified
			</button>
		</div>

		<!-- Email status pills -->
		<div class="flex items-center gap-1 rounded-lg border border-surface-border p-0.5">
			<button
				type="button"
				class="px-3 py-1.5 text-xs rounded-md transition-colors {!data.filters.status
					? 'bg-surface-overlay text-text-primary'
					: 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => removeFilter('status')}
			>
				All
			</button>
			{#each emailStatuses as status}
				<button
					type="button"
					class="px-3 py-1.5 text-xs rounded-md capitalize transition-colors {data.filters.status === status
						? 'bg-surface-overlay text-text-primary'
						: 'text-text-tertiary hover:text-text-secondary'}"
					onclick={() => updateFilter('status', status)}
				>
					{status}
				</button>
			{/each}
		</div>

		<!-- Tag dropdown -->
		{#if data.tags.length > 0}
			<select
				class="rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 text-xs text-text-tertiary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
				onchange={(e) => {
					const val = (e.target as HTMLSelectElement).value;
					updateFilter('tag', val || null);
				}}
			>
				<option value="" selected={!data.filters.tagId}>All tags</option>
				{#each data.tags as tag}
					<option value={tag.id} selected={data.filters.tagId === tag.id}>{tag.name}</option>
				{/each}
			</select>
		{/if}

		<!-- Manage Tags toggle (editor+) -->
		{#if canEdit}
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors {showTagManager
					? 'border-teal-500/30 bg-teal-500/10 text-teal-400'
					: 'border-surface-border text-text-tertiary hover:text-text-secondary hover:border-surface-border-strong'}"
				onclick={() => (showTagManager = !showTagManager)}
			>
				<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6z" />
				</svg>
				Manage Tags
			</button>
		{/if}

		<!-- Source dropdown -->
		<select
			class="rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 text-xs text-text-tertiary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
			onchange={(e) => {
				const val = (e.target as HTMLSelectElement).value;
				updateFilter('source', val || null);
			}}
		>
			<option value="" selected={!data.filters.source}>All sources</option>
			{#each sourceOptions as opt}
				<option value={opt.value} selected={data.filters.source === opt.value}>{opt.label}</option>
			{/each}
		</select>

		<!-- Segment builder toggle -->
		<button
			type="button"
			class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors {showSegmentBuilder
				? 'border-teal-500/30 bg-teal-500/10 text-teal-400'
				: 'border-surface-border text-text-tertiary hover:text-text-secondary hover:border-surface-border-strong'}"
			onclick={() => (showSegmentBuilder = !showSegmentBuilder)}
		>
			<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
			</svg>
			Segments
		</button>
	</div>

	<!-- Segment Builder Panel -->
	{#if showSegmentBuilder}
		<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-5">
			<SegmentBuilder
				orgSlug={data.org.slug}
				tags={data.tags}
				campaigns={data.campaigns}
				showBulkActions={true}
			/>
		</div>
	{/if}

	<!-- Tag Manager Panel -->
	{#if showTagManager && canEdit}
		<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-5 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-medium text-text-primary">Manage Tags</h2>
				<button
					type="button"
					class="text-text-quaternary hover:text-text-tertiary transition-colors"
					title="Close tag manager"
					onclick={() => (showTagManager = false)}
				>
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Create new tag -->
			<form
				method="POST"
				action="?/createTag"
				use:enhance={() => {
					tagError = '';
					return async ({ result }) => {
						if (result.type === 'failure') {
							tagError = (result.data as { error?: string })?.error ?? 'Failed to create tag';
						} else if (result.type === 'success') {
							newTagName = '';
							tagError = '';
							// Invalidate to reload data
							goto($page.url.toString(), { replaceState: true, invalidateAll: true });
						}
					};
				}}
				class="flex items-center gap-2"
			>
				<input
					type="text"
					name="name"
					bind:value={newTagName}
					placeholder="New tag name..."
					class="participation-input px-3 py-1.5 text-sm flex-1"
				/>
				<button
					type="submit"
					disabled={!newTagName.trim()}
					class="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
					</svg>
					Add
				</button>
			</form>
			{#if tagError}
				<p class="text-xs text-red-400">{tagError}</p>
			{/if}

			<!-- Tag list -->
			{#if data.tags.length === 0}
				<p class="text-sm text-text-quaternary">No tags yet. Create one above.</p>
			{:else}
				<div class="divide-y divide-surface-border rounded-lg border border-surface-border overflow-hidden">
					{#each data.tags as tag (tag.id)}
						<div class="flex items-center justify-between px-3 py-2 bg-surface-raised hover:bg-surface-overlay transition-colors group">
							{#if editingTagId === tag.id}
								<!-- Inline rename form -->
								<form
									method="POST"
									action="?/renameTag"
									use:enhance={() => {
										return async ({ result }) => {
											if (result.type === 'failure') {
												tagError = (result.data as { error?: string })?.error ?? 'Failed to rename tag';
											} else if (result.type === 'success') {
												editingTagId = null;
												editingTagName = '';
												tagError = '';
												goto($page.url.toString(), { replaceState: true, invalidateAll: true });
											}
										};
									}}
									class="flex items-center gap-2 flex-1"
								>
									<input type="hidden" name="tagId" value={tag.id} />
									<input
										type="text"
										name="name"
										bind:value={editingTagName}
										class="participation-input px-2 py-1 text-sm flex-1"
									/>
									<button
										type="submit"
										disabled={!editingTagName.trim() || editingTagName.trim() === tag.name}
										class="text-xs text-teal-400 hover:text-teal-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
									>
										Save
									</button>
									<button
										type="button"
										class="text-xs text-text-quaternary hover:text-text-tertiary transition-colors"
										onclick={() => { editingTagId = null; editingTagName = ''; tagError = ''; }}
									>
										Cancel
									</button>
								</form>
							{:else if deletingTagId === tag.id}
								<!-- Delete confirmation -->
								<div class="flex items-center gap-2 flex-1">
									<span class="text-xs text-red-400">Delete "{tag.name}"? This removes it from {tag.supporterCount} supporter{tag.supporterCount === 1 ? '' : 's'}.</span>
									<form
										method="POST"
										action="?/deleteTag"
										use:enhance={() => {
											return async ({ result }) => {
												if (result.type === 'failure') {
													tagError = (result.data as { error?: string })?.error ?? 'Failed to delete tag';
												} else if (result.type === 'success') {
													deletingTagId = null;
													tagError = '';
													goto($page.url.toString(), { replaceState: true, invalidateAll: true });
												}
											};
										}}
										class="inline-flex items-center gap-2"
									>
										<input type="hidden" name="tagId" value={tag.id} />
										<button
											type="submit"
											class="text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
										>
											Confirm
										</button>
									</form>
									<button
										type="button"
										class="text-xs text-text-quaternary hover:text-text-tertiary transition-colors"
										onclick={() => { deletingTagId = null; tagError = ''; }}
									>
										Cancel
									</button>
								</div>
							{:else}
								<!-- Normal display -->
								<div class="flex items-center gap-2 flex-1 min-w-0">
									<span class="inline-flex items-center rounded-full bg-surface-overlay px-2 py-0.5 text-xs text-text-secondary">
										{tag.name}
									</span>
									<span class="text-xs text-text-quaternary font-mono tabular-nums">
										{tag.supporterCount}
									</span>
								</div>
								<div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
									<button
										type="button"
										class="p-1 rounded text-text-quaternary hover:text-text-secondary hover:bg-surface-overlay transition-colors"
										title="Rename tag"
										onclick={() => { editingTagId = tag.id; editingTagName = tag.name; tagError = ''; }}
									>
										<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
										</svg>
									</button>
									<button
										type="button"
										class="p-1 rounded text-text-quaternary hover:text-red-400 hover:bg-surface-overlay transition-colors"
										title="Delete tag"
										onclick={() => { deletingTagId = tag.id; tagError = ''; }}
									>
										<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
											<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
										</svg>
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Active filter chips -->
	{#if activeChips.length > 0}
		<div class="flex flex-wrap items-center gap-2">
			{#each activeChips as chip}
				<button
					type="button"
					class="inline-flex items-center gap-1.5 rounded-full bg-surface-overlay px-3 py-1 text-xs text-text-secondary hover:bg-surface-raised transition-colors"
					onclick={() => removeFilter(chip.key)}
				>
					{chip.label}
					<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			{/each}
			{#if activeChips.length > 1}
				<button
					type="button"
					class="text-xs text-text-quaternary hover:text-text-tertiary transition-colors"
					onclick={() => {
						const url = new URL($page.url);
						url.search = '';
						searchInput = '';
						goto(url.toString(), { replaceState: true });
					}}
				>
					Clear all
				</button>
			{/if}
		</div>
	{/if}


	<!-- Table -->
	{#if allSupporters.length === 0}
		<!-- Empty state -->
		<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-12 text-center">
			<div class="mx-auto w-12 h-12 rounded-full bg-surface-overlay flex items-center justify-center mb-4">
				<svg class="w-6 h-6 text-text-quaternary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
				</svg>
			</div>
			<p class="text-sm text-text-tertiary mb-1">No supporters yet.</p>
			<p class="text-sm text-text-tertiary">
				{#if canEdit}
					<a href="/org/{data.org.slug}/supporters/import" class="text-teal-400 hover:text-teal-300 transition-colors">Import from CSV or Action Network</a> to get started.
				{:else}
					Ask an editor to import supporters.
				{/if}
			</p>
		</div>
	{:else}
		<div class="rounded-md border border-surface-border overflow-hidden">
			<div class="overflow-x-auto">
				<table class="w-full text-left">
					<thead>
						<tr class="border-b border-surface-border bg-surface-raised">
							<th class="px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider w-24">Status</th>
							<th class="px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Name</th>
							<th class="px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider">Email</th>
							<th class="px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider hidden lg:table-cell">Postal</th>
							<th class="px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider hidden xl:table-cell">Tags</th>
							<th class="px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider hidden lg:table-cell w-16">Source</th>
							<th class="px-4 py-3 text-xs font-medium text-text-tertiary uppercase tracking-wider hidden md:table-cell w-24">Added</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-surface-border">
						{#each allSupporters as supporter (supporter.id)}
							{@const vState = verificationState(supporter)}
							<tr class="hover:bg-surface-raised transition-colors group">
								<!-- Verification status -->
								<td class="px-4 py-3">
									{#if vState === 'Verified'}
										<span class="inline-flex items-center gap-1.5">
											<span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
											<span class="text-xs text-emerald-400">Verified</span>
										</span>
									{:else if vState === 'Resolved'}
										<span class="inline-flex items-center gap-1.5">
											<span class="inline-block w-2.5 h-2.5 rounded-full border-2 border-teal-500 bg-teal-500/30"></span>
											<span class="text-xs text-teal-400">Resolved</span>
										</span>
									{:else}
										<span class="inline-flex items-center gap-1.5">
											<span class="inline-block w-2.5 h-2.5 rounded-full bg-text-quaternary"></span>
											<span class="text-xs text-text-tertiary">Imported</span>
										</span>
									{/if}
								</td>

								<!-- Name -->
								<td class="px-4 py-3">
									<a
										href="/org/{data.org.slug}/supporters/{supporter.id}"
										class="text-sm text-text-primary hover:text-teal-400 transition-colors"
									>
										{supporter.name || '\u2014'}
									</a>
								</td>

								<!-- Email with status dot -->
								<td class="px-4 py-3">
									<div class="flex items-center gap-1.5 min-w-0">
										{#if supporter.emailStatus === 'unsubscribed'}
											<span class="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500 flex-shrink-0"></span>
										{:else if supporter.emailStatus === 'bounced'}
											<span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"></span>
										{:else if supporter.emailStatus === 'complained'}
											<span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"></span>
										{/if}
										<span class="text-sm truncate max-w-48 {supporter.emailStatus === 'complained' ? 'text-text-tertiary line-through' : 'text-text-tertiary'}">
											{supporter.email}
										</span>
									</div>
								</td>

								<!-- Postal -->
								<td class="px-4 py-3 hidden lg:table-cell">
									<span class="font-mono tabular-nums text-sm text-text-tertiary">{supporter.postalCode || '\u2014'}</span>
								</td>

								<!-- Tags -->
								<td class="px-4 py-3 hidden xl:table-cell">
									{#if supporter.tags.length > 0}
										<div class="flex items-center gap-1 flex-wrap">
											{#each supporter.tags.slice(0, 3) as tag}
												<span class="inline-flex items-center rounded-full bg-surface-overlay px-2 py-0.5 text-xs text-text-tertiary">
													{tag.name}
												</span>
											{/each}
											{#if supporter.tags.length > 3}
												<span class="text-xs text-text-quaternary">+{supporter.tags.length - 3} more</span>
											{/if}
										</div>
									{:else}
										<span class="text-text-quaternary">&mdash;</span>
									{/if}
								</td>

								<!-- Source -->
								<td class="px-4 py-3 hidden lg:table-cell">
									<span class="inline-flex items-center rounded bg-surface-overlay px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary uppercase">
										{sourceLabel(supporter.source)}
									</span>
								</td>

								<!-- Added -->
								<td class="px-4 py-3 hidden md:table-cell">
									<span class="font-mono tabular-nums text-xs text-text-quaternary">{relativeTime(supporter.createdAt)}</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Load more -->
		{#if hasMore}
			<div class="flex justify-center pt-2">
				<button
					type="button"
					disabled={loadingMore}
					class="inline-flex items-center gap-2 rounded-lg border border-surface-border-strong bg-surface-raised px-5 py-2.5 text-sm text-text-secondary hover:bg-surface-overlay hover:border-surface-border-strong transition-colors disabled:opacity-50"
					onclick={loadMore}
				>
					{#if loadingMore}
						<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						Loading...
					{:else}
						Load more
					{/if}
				</button>
			</div>
		{/if}
	{/if}
</div>
