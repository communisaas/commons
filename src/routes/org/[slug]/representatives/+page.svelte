<script lang="ts">
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	type DecisionMaker = {
		id: string;
		name: string;
		photoUrl?: string | null;
		party: string | null;
		title?: string | null;
		jurisdiction: string | null;
		district: string | null;
		active?: boolean;
	};

	type FollowedDecisionMaker = {
		id: string;
		reason: string;
		alertsEnabled?: boolean;
		followedAt?: string;
		decisionMaker: DecisionMaker;
	};

	type ViewData = Omit<PageData, 'followed' | 'discover'> & {
		followed: FollowedDecisionMaker[];
		discover: DecisionMaker[];
	};

	let { data }: { data: ViewData } = $props();

	// Search / filter state
	let searchQuery = $state('');
	let partyFilter = $state('');
	let jurisdictionFilter = $state('');

	// Track follow state locally for instant UI updates
	// svelte-ignore state_referenced_locally — optimistic route state is resynced from data in the effect below.
	let localFollowed = $state<FollowedDecisionMaker[]>(data.followed);
	// svelte-ignore state_referenced_locally — optimistic route state is resynced from data in the effect below.
	let followedIds = $state(new Set(data.followed.map((f) => f.decisionMaker.id)));
	let followedCountDelta = $state(0);

	$effect(() => {
		localFollowed = data.followed;
		followedIds = new Set(data.followed.map((f) => f.decisionMaker.id));
		followedCountDelta = 0;
	});

	// Filtered followed list
	const filteredFollowed = $derived(
		localFollowed.filter((f) => {
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
		for (const f of localFollowed) {
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
			case 'D':
				return 'bg-blue-600';
			case 'R':
				return 'bg-red-600';
			case 'I':
				return 'bg-purple-600';
			case 'L':
				return 'bg-amber-600';
			default:
				return 'bg-gray-500';
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
		return name
			.split(' ')
			.map((w) => w[0])
			.filter(Boolean)
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	// Follow/unfollow
	let pendingAction = $state<string | null>(null);

	async function followDM(dmId: string) {
		pendingAction = dmId;
		const wasFollowed = followedIds.has(dmId);
		const dm = data.discover.find((candidate) => candidate.id === dmId);
		try {
			const res = await fetch(`/api/org/${data.org.slug}/decision-makers/${dmId}/follow`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			if (res.ok) {
				followedIds = new Set([...followedIds, dmId]);
				if (!wasFollowed && dm) {
					localFollowed = [
						{
							id: `local-${dmId}`,
							reason: 'manual',
							alertsEnabled: true,
							followedAt: new Date().toISOString(),
							decisionMaker: dm
						},
						...localFollowed
					];
					followedCountDelta += 1;
				}
			}
		} finally {
			pendingAction = null;
		}
	}

	async function unfollowDM(dmId: string) {
		pendingAction = dmId;
		const wasFollowed = followedIds.has(dmId);
		try {
			const res = await fetch(`/api/org/${data.org.slug}/decision-makers/${dmId}/follow`, {
				method: 'DELETE'
			});
			if (res.ok) {
				const next = new Set(followedIds);
				next.delete(dmId);
				followedIds = next;
				localFollowed = localFollowed.filter((follow) => follow.decisionMaker.id !== dmId);
				if (wasFollowed) {
					followedCountDelta -= 1;
				}
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
	const followedCount = $derived(Math.max(0, data.followedCount + followedCountDelta));
	const discoverCount = $derived(data.discover.filter((dm) => !followedIds.has(dm.id)).length);
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="space-y-4">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-text-primary text-xl font-semibold">Decision-makers</h1>
				<p class="text-text-tertiary mt-2 max-w-3xl text-sm">
					Follow the officials your organization works on, and discover more to follow.
				</p>
			</div>
			<div class="grid min-w-[180px] grid-cols-2 gap-2 text-center">
				<div>
					<p class="text-text-primary font-mono text-sm font-bold">
						<Datum value={followedCount} />
					</p>
					<p class="text-text-quaternary text-[0.65rem] uppercase">followed</p>
				</div>
				<div>
					<p class="font-mono text-sm font-bold text-teal-300">
						<Datum value={discoverCount} />
					</p>
					<p class="text-text-quaternary text-[0.65rem] uppercase">to discover</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Search and Filters -->
	<div id="power-filters" class="space-y-3">
		<div class="relative">
			<svg
				class="text-text-tertiary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
				/>
			</svg>
			<input
				type="text"
				placeholder="Search by name..."
				bind:value={searchQuery}
				class="participation-input w-full py-2 pr-4 pl-10 text-sm"
			/>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<!-- Party filter -->
			<select
				class="border-surface-border bg-surface-raised text-text-tertiary rounded-lg border px-3 py-1.5 text-xs transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
				bind:value={partyFilter}
			>
				<option value="">All parties</option>
				<option value="D">Democrat</option>
				<option value="R">Republican</option>
				<option value="I">Independent</option>
			</select>

			<!-- Jurisdiction filter -->
			<select
				class="border-surface-border bg-surface-raised text-text-tertiary rounded-lg border px-3 py-1.5 text-xs transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
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
					class="text-text-quaternary hover:text-text-tertiary text-xs transition-colors"
					onclick={clearFilters}
				>
					Clear filters
				</button>
			{/if}
		</div>
	</div>

	<!-- Following Section -->
	<section id="power-following" class="space-y-3">
		<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">Following</h2>

		{#if filteredFollowed.length === 0}
			<div class="bg-surface-base border-surface-border rounded-md border p-8 text-center">
				<div
					class="bg-surface-overlay mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full"
				>
					<svg
						class="text-text-quaternary h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z"
						/>
					</svg>
				</div>
				<p class="text-text-tertiary text-sm">
					{#if hasFilters}
						No followed power targets match your filters.
					{:else}
						No power targets followed yet. Discover targets below.
					{/if}
				</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each filteredFollowed as follow (follow.id)}
					{@const dm = follow.decisionMaker}
					<div
						class="bg-surface-base border-surface-border hover:bg-surface-raised rounded-md border p-4 transition-colors"
					>
						<div class="flex items-start gap-3">
							<!-- Photo or initials -->
							{#if dm.photoUrl}
								<img
									src={dm.photoUrl}
									alt={dm.name}
									class="h-10 w-10 flex-shrink-0 rounded-full object-cover"
								/>
							{:else}
								<div
									class="bg-surface-overlay text-text-tertiary flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium"
								>
									{initials(dm.name)}
								</div>
							{/if}

							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<a
										href="/org/{data.org.slug}/representatives/{dm.id}"
										class="text-text-primary truncate text-sm font-medium transition-colors hover:text-teal-400"
										>{dm.name}</a
									>
									{#if dm.party}
										<span
											class="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white {partyColor(
												dm.party
											)}"
										>
											{partyAbbr(dm.party)}
										</span>
									{/if}
								</div>
								<p class="text-text-tertiary mt-0.5 text-xs">
									{#if dm.title}{dm.title}{/if}
									{#if dm.jurisdiction}
										{#if dm.title}<span class="text-text-quaternary mx-1">&middot;</span>{/if}
										{locationLabel(dm.jurisdiction, dm.district)}
									{/if}
								</p>
								{#if !dm.active}
									<span
										class="mt-1 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400"
									>
										Inactive
									</span>
								{/if}
							</div>
						</div>

						<div class="mt-3 flex items-center justify-between">
							<span class="text-text-quaternary font-mono text-[10px]">
								{follow.reason === 'campaign_delivery' ? 'via delivery' : 'manual'}
							</span>
							<button
								type="button"
								disabled={pendingAction === dm.id}
								class="border-surface-border text-text-tertiary inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors hover:border-red-500/30 hover:text-red-400 disabled:opacity-50"
								onclick={() => unfollowDM(dm.id)}
							>
								{#if pendingAction === dm.id}
									<svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
										></path>
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
					class="border-surface-border-strong bg-surface-raised text-text-secondary hover:bg-surface-overlay inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm transition-colors"
				>
					Load more
				</a>
			</div>
		{/if}
	</section>

	<!-- Discover Section -->
	{#if filteredDiscover.length > 0}
		<section id="power-discover" class="space-y-3">
			<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">Discover</h2>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each filteredDiscover as dm (dm.id)}
					<div
						class="bg-surface-base border-surface-border hover:bg-surface-raised rounded-md border p-4 transition-colors"
					>
						<div class="flex items-start gap-3">
							{#if dm.photoUrl}
								<img
									src={dm.photoUrl}
									alt={dm.name}
									class="h-10 w-10 flex-shrink-0 rounded-full object-cover"
								/>
							{:else}
								<div
									class="bg-surface-overlay text-text-tertiary flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium"
								>
									{initials(dm.name)}
								</div>
							{/if}

							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<a
										href="/org/{data.org.slug}/representatives/{dm.id}"
										class="text-text-primary truncate text-sm font-medium transition-colors hover:text-teal-400"
										>{dm.name}</a
									>
									{#if dm.party}
										<span
											class="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white {partyColor(
												dm.party
											)}"
										>
											{partyAbbr(dm.party)}
										</span>
									{/if}
								</div>
								<p class="text-text-tertiary mt-0.5 text-xs">
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
								class="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
								onclick={() => followDM(dm.id)}
							>
								{#if pendingAction === dm.id}
									<svg class="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
										></path>
									</svg>
								{/if}
								<svg
									class="h-3 w-3"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
								>
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
