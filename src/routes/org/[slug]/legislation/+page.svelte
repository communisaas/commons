<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Search state
	let searchQuery = $state('');
	let searchTimeout: ReturnType<typeof setTimeout> | undefined;
	let searchResults = $state<Array<{
		id: string;
		externalId: string;
		title: string;
		summary: string | null;
		status: string;
		statusDate: string;
		jurisdiction: string;
		jurisdictionLevel: string;
		chamber: string | null;
		sourceUrl: string;
	}>>([]);
	let searching = $state(false);
	let hasSearched = $state(false);
	let searchTotal = $state(0);

	// Track watched bill IDs locally for instant UI updates
	let watchedBillIds = $state(new Set(data.watching.map((w) => w.billId)));

	$effect(() => {
		watchedBillIds = new Set(data.watching.map((w) => w.billId));
	});

	// Positions tracked locally
	let positions = $state<Record<string, string | null>>(
		Object.fromEntries(data.watching.map((w) => [w.billId, w.position]))
	);

	$effect(() => {
		positions = Object.fromEntries(data.watching.map((w) => [w.billId, w.position]));
	});

	function onSearchInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		searchQuery = value;
		clearTimeout(searchTimeout);
		if (!value.trim()) {
			searchResults = [];
			hasSearched = false;
			return;
		}
		searchTimeout = setTimeout(() => {
			doSearch(value.trim());
		}, 300);
	}

	async function doSearch(q: string) {
		searching = true;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/bills/search?q=${encodeURIComponent(q)}&limit=10`);
			if (res.ok) {
				const json = await res.json();
				searchResults = json.bills;
				searchTotal = json.total;
				hasSearched = true;
			}
		} finally {
			searching = false;
		}
	}

	// Watch/unwatch
	let pendingAction = $state<string | null>(null);

	async function watchBill(billId: string) {
		pendingAction = billId;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/bills/${billId}/watch`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			if (res.ok) {
				watchedBillIds = new Set([...watchedBillIds, billId]);
			}
		} finally {
			pendingAction = null;
		}
	}

	async function unwatchBill(billId: string) {
		pendingAction = billId;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/bills/${billId}/watch`, {
				method: 'DELETE'
			});
			if (res.ok) {
				const next = new Set(watchedBillIds);
				next.delete(billId);
				watchedBillIds = next;
			}
		} finally {
			pendingAction = null;
		}
	}

	async function setPosition(billId: string, position: string) {
		try {
			const res = await fetch(`/api/org/${data.org.slug}/bills/${billId}/watch`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ position })
			});
			if (res.ok) {
				positions = { ...positions, [billId]: position === 'neutral' ? null : position };
			}
		} catch {
			// ignore
		}
	}

	// Status badge
	function statusBadgeClass(status: string): string {
		switch (status) {
			case 'introduced': return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
			case 'committee': return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20';
			case 'floor': return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
			case 'passed': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'failed': return 'bg-red-500/15 text-red-400 border-red-500/20';
			case 'signed': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'vetoed': return 'bg-red-500/15 text-red-400 border-red-500/20';
			default: return 'bg-surface-overlay text-text-tertiary border-surface-border';
		}
	}

	function positionBadgeClass(position: string | null): string {
		switch (position) {
			case 'support': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'oppose': return 'bg-red-500/15 text-red-400 border-red-500/20';
			default: return 'bg-surface-overlay text-text-tertiary border-surface-border';
		}
	}

	function truncate(text: string | null, len: number): string {
		if (!text) return '';
		return text.length > len ? text.slice(0, len) + '...' : text;
	}

	function formatDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function relevanceBar(score: number): string {
		return `${Math.round(score * 100)}%`;
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div>
		<h1 class="text-xl font-semibold text-text-primary">Legislation</h1>
		<p class="text-sm text-text-tertiary mt-1">Search bills, track legislation, and set your org's position.</p>
	</div>

	<!-- Search -->
	<div class="space-y-3">
		<div class="relative">
			<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
			</svg>
			<input
				type="text"
				placeholder="Search bills by title or keyword..."
				value={searchQuery}
				oninput={onSearchInput}
				class="participation-input pl-10 pr-4 py-2 text-sm w-full"
			/>
			{#if searching}
				<svg class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-text-quaternary" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
				</svg>
			{/if}
		</div>

		<!-- Search results -->
		{#if hasSearched}
			<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] overflow-hidden">
				{#if searchResults.length === 0}
					<div class="p-6 text-center">
						<p class="text-sm text-text-tertiary">No bills found for "{searchQuery}"</p>
					</div>
				{:else}
					<div class="divide-y divide-surface-border">
						{#each searchResults as bill (bill.id)}
							<div class="p-4 hover:bg-surface-raised transition-colors">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-2 mb-1">
											<h3 class="text-sm font-medium text-text-primary truncate">{bill.title}</h3>
											<span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono {statusBadgeClass(bill.status)}">
												{bill.status}
											</span>
										</div>
										{#if bill.summary}
											<p class="text-xs text-text-tertiary mb-1.5">{truncate(bill.summary, 150)}</p>
										{/if}
										<div class="flex items-center gap-3 text-[10px] text-text-quaternary">
											<span class="font-mono">{bill.externalId}</span>
											<span>{bill.jurisdiction}</span>
											{#if bill.chamber}
												<span>{bill.chamber}</span>
											{/if}
											<span>{formatDate(bill.statusDate)}</span>
										</div>
									</div>
									<div class="flex-shrink-0">
										{#if watchedBillIds.has(bill.id)}
											<button
												type="button"
												disabled={pendingAction === bill.id}
												class="inline-flex items-center gap-1 rounded-md border border-surface-border px-2.5 py-1 text-xs text-text-tertiary hover:text-red-400 hover:border-red-500/30 transition-colors disabled:opacity-50"
												onclick={() => unwatchBill(bill.id)}
											>
												Unwatch
											</button>
										{:else}
											<button
												type="button"
												disabled={pendingAction === bill.id}
												class="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-50"
												onclick={() => watchBill(bill.id)}
											>
												{#if pendingAction === bill.id}
													<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
														<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
														<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
													</svg>
												{/if}
												Watch
											</button>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
					{#if searchTotal > searchResults.length}
						<div class="px-4 py-2 bg-surface-raised text-xs text-text-quaternary text-center">
							Showing {searchResults.length} of {searchTotal} results
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>

	<!-- Watching Section -->
	<section class="space-y-3">
		<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider">Watching</h2>

		{#if data.watching.length === 0}
			<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-8 text-center">
				<div class="mx-auto w-10 h-10 rounded-full bg-surface-overlay flex items-center justify-center mb-3">
					<svg class="w-5 h-5 text-text-quaternary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
					</svg>
				</div>
				<p class="text-sm text-text-tertiary">No bills being watched. Use the search above to find and watch bills.</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each data.watching as watch (watch.id)}
					{@const bill = watch.bill}
					{@const pos = positions[watch.billId] ?? null}
					<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-4 hover:bg-surface-raised transition-colors">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2 mb-1">
									<h3 class="text-sm font-medium text-text-primary">{bill.title}</h3>
									<span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono {statusBadgeClass(bill.status)}">
										{bill.status}
									</span>
									{#if pos}
										<span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono {positionBadgeClass(pos)}">
											{pos}
										</span>
									{/if}
								</div>
								{#if bill.summary}
									<p class="text-xs text-text-tertiary mb-1.5">{truncate(bill.summary, 200)}</p>
								{/if}
								<div class="flex items-center gap-3 text-[10px] text-text-quaternary">
									<span class="font-mono">{bill.externalId}</span>
									<span>{bill.jurisdiction}</span>
									{#if bill.chamber}
										<span>{bill.chamber}</span>
									{/if}
									<span>{formatDate(bill.statusDate)}</span>
								</div>
							</div>
						</div>

						<!-- Position selector + unwatch -->
						<div class="mt-3 flex items-center justify-between border-t border-surface-border pt-3">
							<div class="flex items-center gap-1">
								<span class="text-[10px] text-text-quaternary mr-2">Position:</span>
								<button
									type="button"
									class="px-2 py-0.5 rounded text-[10px] transition-colors {pos === 'support'
										? 'bg-emerald-500/20 text-emerald-400'
										: 'text-text-quaternary hover:text-emerald-400 hover:bg-emerald-500/10'}"
									onclick={() => setPosition(watch.billId, 'support')}
								>
									Support
								</button>
								<button
									type="button"
									class="px-2 py-0.5 rounded text-[10px] transition-colors {pos === 'oppose'
										? 'bg-red-500/20 text-red-400'
										: 'text-text-quaternary hover:text-red-400 hover:bg-red-500/10'}"
									onclick={() => setPosition(watch.billId, 'oppose')}
								>
									Oppose
								</button>
								<button
									type="button"
									class="px-2 py-0.5 rounded text-[10px] transition-colors {pos === null
										? 'bg-surface-overlay text-text-secondary'
										: 'text-text-quaternary hover:text-text-secondary'}"
									onclick={() => setPosition(watch.billId, 'neutral')}
								>
									Neutral
								</button>
							</div>
							<button
								type="button"
								disabled={pendingAction === watch.billId}
								class="inline-flex items-center gap-1 rounded-md border border-surface-border px-2.5 py-1 text-xs text-text-tertiary hover:text-red-400 hover:border-red-500/30 transition-colors disabled:opacity-50"
								onclick={() => unwatchBill(watch.billId)}
							>
								Unwatch
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Relevant Section -->
	{#if data.relevant.length > 0}
		<section class="space-y-3">
			<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider">Relevant to Your Org</h2>
			<div class="space-y-3">
				{#each data.relevant as rel (rel.id)}
					{@const bill = rel.bill}
					<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-4 hover:bg-surface-raised transition-colors">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2 mb-1">
									<h3 class="text-sm font-medium text-text-primary">{bill.title}</h3>
									<span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono {statusBadgeClass(bill.status)}">
										{bill.status}
									</span>
								</div>
								{#if bill.summary}
									<p class="text-xs text-text-tertiary mb-1.5">{truncate(bill.summary, 200)}</p>
								{/if}
								<div class="flex items-center gap-3 text-[10px] text-text-quaternary">
									<span class="font-mono">{bill.externalId}</span>
									<span>{bill.jurisdiction}</span>
									{#if bill.chamber}
										<span>{bill.chamber}</span>
									{/if}
									<span>{formatDate(bill.statusDate)}</span>
								</div>
								<!-- Relevance indicator -->
								<div class="mt-2 flex items-center gap-2">
									<div class="flex-1 max-w-32 h-1.5 rounded-full bg-surface-overlay overflow-hidden">
										<div
											class="h-full rounded-full bg-teal-500"
											style="width: {relevanceBar(rel.score)}"
										></div>
									</div>
									<span class="text-[10px] text-text-quaternary font-mono">{relevanceBar(rel.score)} match</span>
									{#if rel.matchedOn.length > 0}
										<span class="text-[10px] text-text-quaternary">
											({rel.matchedOn.slice(0, 3).join(', ')})
										</span>
									{/if}
								</div>
							</div>
							<div class="flex-shrink-0">
								{#if watchedBillIds.has(bill.id)}
									<span class="inline-flex items-center rounded-md border border-teal-500/20 bg-teal-500/10 px-2.5 py-1 text-xs text-teal-400">
										Watching
									</span>
								{:else}
									<button
										type="button"
										disabled={pendingAction === bill.id}
										class="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-50"
										onclick={() => watchBill(bill.id)}
									>
										{#if pendingAction === bill.id}
											<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
												<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
												<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
											</svg>
										{/if}
										Watch
									</button>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
