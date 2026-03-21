<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Search / filter state
	let searchQuery = $state('');
	let partyFilter = $state('');
	let jurisdictionFilter = $state('');
	let searchTimeout: ReturnType<typeof setTimeout> | undefined;
	let searchResults = $state<typeof data.discover>([]);
	let searching = $state(false);
	let hasSearched = $state(false);

	// Track follow state locally for instant UI updates
	let followedIds = $state(new Set(data.followed.map((f) => f.decisionMaker.id)));

	$effect(() => {
		followedIds = new Set(data.followed.map((f) => f.decisionMaker.id));
	});

	// Filtered followed list
	const filteredFollowed = $derived(
		data.followed.filter((f) => {
			const dm = f.decisionMaker;
			if (partyFilter && dm.party !== partyFilter) return false;
			if (jurisdictionFilter && dm.jurisdiction !== jurisdictionFilter) return false;
			if (searchQuery) {
				const q = searchQuery.toLowerCase();
				if (!dm.name.toLowerCase().includes(q)) return false;
			}
			return true;
		})
	);

	// Filtered discover list
	const filteredDiscover = $derived(
		data.discover.filter((dm) => {
			if (followedIds.has(dm.id)) return false;
			if (partyFilter && dm.party !== partyFilter) return false;
			if (jurisdictionFilter && dm.jurisdiction !== jurisdictionFilter) return false;
			if (searchQuery) {
				const q = searchQuery.toLowerCase();
				if (!dm.name.toLowerCase().includes(q)) return false;
			}
			return true;
		})
	);

	// Unique jurisdictions from all DMs for filter
	const allJurisdictions = $derived.by(() => {
		const jurisdictions = new Set<string>();
		for (const f of data.followed) {
			if (f.decisionMaker.jurisdiction) jurisdictions.add(f.decisionMaker.jurisdiction);
		}
		for (const r of data.discover) {
			if (r.jurisdiction) jurisdictions.add(r.jurisdiction);
		}
		return [...jurisdictions].sort();
	});

	// Party badge helpers (DB stores abbreviations: D, R, I, L)
	function partyColor(party: string | null): string {
		switch (party) {
			case 'D': return 'bg-blue-600';
			case 'R': return 'bg-red-600';
			case 'I': return 'bg-purple-600';
			case 'L': return 'bg-amber-600';
			default: return 'bg-gray-500';
		}
	}

	function partyAbbr(party: string | null): string {
		return party ?? '?';
	}

	function locationLabel(jurisdiction: string | null, district: string | null): string {
		if (!jurisdiction) return '';
		return district ? `${jurisdiction}-${district}` : jurisdiction;
	}

	function initials(name: string): string {
		return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
	}

	// Follow/unfollow
	let pendingAction = $state<string | null>(null);

	async function followDM(dmId: string) {
		pendingAction = dmId;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/decision-makers/${dmId}/follow`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			if (res.ok) {
				followedIds = new Set([...followedIds, dmId]);
			}
		} finally {
			pendingAction = null;
		}
	}

	async function unfollowDM(dmId: string) {
		pendingAction = dmId;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/decision-makers/${dmId}/follow`, {
				method: 'DELETE'
			});
			if (res.ok) {
				const next = new Set(followedIds);
				next.delete(dmId);
				followedIds = next;
			}
		} finally {
			pendingAction = null;
		}
	}

	function clearFilters() {
		searchQuery = '';
		partyFilter = '';
		jurisdictionFilter = '';
	}

	const hasFilters = $derived(!!searchQuery || !!partyFilter || !!jurisdictionFilter);
</script>

<div class="space-y-6">
	<!-- Header -->
	<div>
		<h1 class="text-xl font-semibold text-text-primary">Decision Makers</h1>
		<p class="text-sm text-text-tertiary mt-1">
			Following {data.followedCount} decision maker{data.followedCount === 1 ? '' : 's'}
		</p>
	</div>

	<!-- Search and Filters -->
	<div class="space-y-3">
		<div class="relative">
			<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
			</svg>
			<input
				type="text"
				placeholder="Search by name..."
				bind:value={searchQuery}
				class="participation-input pl-10 pr-4 py-2 text-sm w-full"
			/>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<!-- Party filter -->
			<select
				class="rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 text-xs text-text-tertiary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
				bind:value={partyFilter}
			>
				<option value="">All parties</option>
				<option value="D">Democrat</option>
				<option value="R">Republican</option>
				<option value="I">Independent</option>
			</select>

			<!-- Jurisdiction filter -->
			<select
				class="rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 text-xs text-text-tertiary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
				bind:value={jurisdictionFilter}
			>
				<option value="">All jurisdictions</option>
				{#each allJurisdictions as j}
					<option value={j}>{j}</option>
				{/each}
			</select>

			{#if hasFilters}
				<button
					type="button"
					class="text-xs text-text-quaternary hover:text-text-tertiary transition-colors"
					onclick={clearFilters}
				>
					Clear filters
				</button>
			{/if}
		</div>
	</div>

	<!-- Following Section -->
	<section class="space-y-3">
		<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider">Following</h2>

		{#if filteredFollowed.length === 0}
			<div class="rounded-xl bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-8 text-center">
				<div class="mx-auto w-10 h-10 rounded-full bg-surface-overlay flex items-center justify-center mb-3">
					<svg class="w-5 h-5 text-text-quaternary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
					</svg>
				</div>
				<p class="text-sm text-text-tertiary">
					{#if hasFilters}
						No followed decision makers match your filters.
					{:else}
						No decision makers followed yet. Discover decision makers below.
					{/if}
				</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{#each filteredFollowed as follow (follow.id)}
					{@const dm = follow.decisionMaker}
					<div class="rounded-xl bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-4 hover:bg-surface-raised transition-colors">
						<div class="flex items-start gap-3">
							<!-- Photo or initials -->
							{#if dm.photoUrl}
								<img
									src={dm.photoUrl}
									alt={dm.name}
									class="w-10 h-10 rounded-full object-cover flex-shrink-0"
								/>
							{:else}
								<div class="w-10 h-10 rounded-full bg-surface-overlay flex items-center justify-center text-text-tertiary font-medium text-sm flex-shrink-0">
									{initials(dm.name)}
								</div>
							{/if}

							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<a href="/org/{data.org.slug}/representatives/{dm.id}" class="text-sm font-medium text-text-primary truncate hover:text-teal-400 transition-colors">{dm.name}</a>
									{#if dm.party}
										<span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white {partyColor(dm.party)}">
											{partyAbbr(dm.party)}
										</span>
									{/if}
								</div>
								<p class="text-xs text-text-tertiary mt-0.5">
									{#if dm.title}{dm.title}{/if}
									{#if dm.jurisdiction}
										{#if dm.title}<span class="text-text-quaternary mx-1">&middot;</span>{/if}
										{locationLabel(dm.jurisdiction, dm.district)}
									{/if}
								</p>
								{#if !dm.active}
									<span class="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400 mt-1">
										Inactive
									</span>
								{/if}
							</div>
						</div>

						<div class="mt-3 flex items-center justify-between">
							<span class="text-[10px] text-text-quaternary font-mono">
								{follow.reason === 'campaign_delivery' ? 'via delivery' : 'manual'}
							</span>
							<button
								type="button"
								disabled={pendingAction === dm.id}
								class="inline-flex items-center gap-1 rounded-md border border-surface-border px-2.5 py-1 text-xs text-text-tertiary hover:text-red-400 hover:border-red-500/30 transition-colors disabled:opacity-50"
								onclick={() => unfollowDM(dm.id)}
							>
								{#if pendingAction === dm.id}
									<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
										<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
										<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
									</svg>
								{/if}
								Unfollow
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if data.hasMore}
			<div class="flex justify-center pt-2">
				<a
					href="?cursor={data.nextCursor}"
					class="inline-flex items-center gap-2 rounded-lg border border-surface-border-strong bg-surface-raised px-5 py-2.5 text-sm text-text-secondary hover:bg-surface-overlay transition-colors"
				>
					Load more
				</a>
			</div>
		{/if}
	</section>

	<!-- Discover Section -->
	{#if filteredDiscover.length > 0}
		<section class="space-y-3">
			<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider">Discover</h2>
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{#each filteredDiscover as dm (dm.id)}
					<div class="rounded-xl bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-4 hover:bg-surface-raised transition-colors">
						<div class="flex items-start gap-3">
							{#if dm.photoUrl}
								<img
									src={dm.photoUrl}
									alt={dm.name}
									class="w-10 h-10 rounded-full object-cover flex-shrink-0"
								/>
							{:else}
								<div class="w-10 h-10 rounded-full bg-surface-overlay flex items-center justify-center text-text-tertiary font-medium text-sm flex-shrink-0">
									{initials(dm.name)}
								</div>
							{/if}

							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<a href="/org/{data.org.slug}/representatives/{dm.id}" class="text-sm font-medium text-text-primary truncate hover:text-teal-400 transition-colors">{dm.name}</a>
									{#if dm.party}
										<span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white {partyColor(dm.party)}">
											{partyAbbr(dm.party)}
										</span>
									{/if}
								</div>
								<p class="text-xs text-text-tertiary mt-0.5">
									{#if dm.title}{dm.title}{/if}
									{#if dm.jurisdiction}
										{#if dm.title}<span class="text-text-quaternary mx-1">&middot;</span>{/if}
										{locationLabel(dm.jurisdiction, dm.district)}
									{/if}
								</p>
							</div>
						</div>

						<div class="mt-3 flex justify-end">
							<button
								type="button"
								disabled={pendingAction === dm.id}
								class="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-50"
								onclick={() => followDM(dm.id)}
							>
								{#if pendingAction === dm.id}
									<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
										<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
										<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
									</svg>
								{/if}
								<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
								</svg>
								Follow
							</button>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
