<script lang="ts">
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	type Bill = {
		id: string;
		externalId: string;
		title: string;
		summary: string | null;
		status: string;
		statusDate: string;
		jurisdiction: string;
		jurisdictionLevel?: string;
		chamber: string | null;
		sourceUrl?: string;
	};

	type WatchedBill = {
		id: string;
		billId: string;
		reason: string;
		position: string | null;
		createdAt: string | null;
		bill: Bill;
	};

	type RelevantBill = {
		id: string;
		billId: string;
		score: number;
		matchedOn: string[];
		bill: Bill;
	};

	type ViewData = Omit<PageData, 'watching' | 'relevant'> & {
		watching: WatchedBill[];
		relevant: RelevantBill[];
	};

	let { data }: { data: ViewData } = $props();

	// Search state
	let searchQuery = $state('');
	let searchTimeout: ReturnType<typeof setTimeout> | undefined;
	let searchResults = $state<
		Array<{
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
		}>
	>([]);
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

	const watchedCount = $derived(watchedBillIds.size);
	const positionedCount = $derived(Object.values(positions).filter(Boolean).length);
	const relevantCount = $derived(data.relevant.length);

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
			const res = await fetch(
				`/api/org/${data.org.slug}/bills/search?q=${encodeURIComponent(q)}&limit=10`
			);
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
			case 'introduced':
				return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
			case 'committee':
				return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20';
			case 'floor':
				return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
			case 'passed':
				return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'failed':
				return 'bg-red-500/15 text-red-400 border-red-500/20';
			case 'signed':
				return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'vetoed':
				return 'bg-red-500/15 text-red-400 border-red-500/20';
			default:
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
		}
	}

	function positionBadgeClass(position: string | null): string {
		switch (position) {
			case 'support':
				return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'oppose':
				return 'bg-red-500/15 text-red-400 border-red-500/20';
			default:
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
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
	<div class="space-y-4">
		<div class="space-y-2">
			<div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 class="text-text-primary font-sans text-2xl font-semibold">Bills</h1>
					<p class="text-text-tertiary mt-1 max-w-2xl text-sm leading-6">
						Search federal bills, watch the ones that matter, and set your organization's position.
					</p>
				</div>
				<div
					class="border-surface-border bg-surface-border grid grid-cols-3 gap-px overflow-hidden rounded-md border text-right"
				>
					<div class="bg-surface-base px-3 py-2">
						<p class="text-text-primary font-mono text-lg font-semibold tabular-nums">
							<Datum value={watchedCount} />
						</p>
						<p class="text-text-quaternary font-mono text-[9px] tracking-[0.12em] uppercase">
							watched
						</p>
					</div>
					<div class="bg-surface-base px-3 py-2">
						<p class="text-text-primary font-mono text-lg font-semibold tabular-nums">
							<Datum value={relevantCount} />
						</p>
						<p class="text-text-quaternary font-mono text-[9px] tracking-[0.12em] uppercase">
							relevant
						</p>
					</div>
					<div class="bg-surface-base px-3 py-2">
						<p class="text-text-primary font-mono text-lg font-semibold tabular-nums">
							<Datum value={positionedCount} />
						</p>
						<p class="text-text-quaternary font-mono text-[9px] tracking-[0.12em] uppercase">
							positions
						</p>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Search -->
	<div id="bill-search" class="space-y-3">
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
				placeholder="Search bills by title or keyword..."
				value={searchQuery}
				oninput={onSearchInput}
				class="participation-input w-full py-2 pr-4 pl-10 text-sm"
			/>
			{#if searching}
				<svg
					class="text-text-quaternary absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
					></path>
				</svg>
			{/if}
		</div>

		<!-- Search results -->
		{#if hasSearched}
			<div class="bg-surface-base border-surface-border overflow-hidden rounded-md border">
				{#if searchResults.length === 0}
					<div class="p-6 text-center">
						<p class="text-text-tertiary text-sm">No bills found for "{searchQuery}"</p>
					</div>
				{:else}
					<div class="divide-surface-border divide-y">
						{#each searchResults as bill (bill.id)}
							<div class="hover:bg-surface-raised p-4 transition-colors">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0 flex-1">
										<div class="mb-1 flex items-center gap-2">
											<h3 class="text-text-primary truncate text-sm font-medium">{bill.title}</h3>
											<span
												class="inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] {statusBadgeClass(
													bill.status
												)}"
											>
												{bill.status}
											</span>
										</div>
										{#if bill.summary}
											<p class="text-text-tertiary mb-1.5 text-xs">{truncate(bill.summary, 150)}</p>
										{/if}
										<div class="text-text-quaternary flex items-center gap-3 text-[10px]">
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
												class="border-surface-border text-text-tertiary inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors hover:border-red-500/30 hover:text-red-400 disabled:opacity-50"
												onclick={() => unwatchBill(bill.id)}
											>
												Unwatch
											</button>
										{:else}
											<button
												type="button"
												disabled={pendingAction === bill.id}
												class="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
												onclick={() => watchBill(bill.id)}
											>
												{#if pendingAction === bill.id}
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
												Watch
											</button>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
					{#if searchTotal > searchResults.length}
						<div class="bg-surface-raised text-text-quaternary px-4 py-2 text-center text-xs">
							Showing {searchResults.length} of {searchTotal} results
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>

	<!-- Watching Section -->
	<section id="bill-watchlist" class="space-y-3">
		<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">
			Watched terrain
		</h2>

		{#if data.watching.length === 0}
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
							d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
						/>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
						/>
					</svg>
				</div>
				<p class="text-text-tertiary text-sm">
					No bills being watched. Use the search above to find and watch bills.
				</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each data.watching as watch (watch.id)}
					{@const bill = watch.bill}
					{@const pos = positions[watch.billId] ?? null}
					<div
						class="bg-surface-base border-surface-border hover:bg-surface-raised rounded-md border p-4 transition-colors"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<div class="mb-1 flex items-center gap-2">
									<h3 class="text-text-primary text-sm font-medium">{bill.title}</h3>
									<span
										class="inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] {statusBadgeClass(
											bill.status
										)}"
									>
										{bill.status}
									</span>
									{#if pos}
										<span
											class="inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] {positionBadgeClass(
												pos
											)}"
										>
											{pos}
										</span>
									{/if}
								</div>
								{#if bill.summary}
									<p class="text-text-tertiary mb-1.5 text-xs">{truncate(bill.summary, 200)}</p>
								{/if}
								<div class="text-text-quaternary flex items-center gap-3 text-[10px]">
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
						<div class="border-surface-border mt-3 flex items-center justify-between border-t pt-3">
							<div class="flex items-center gap-1">
								<span class="text-text-quaternary mr-2 text-[10px]">Position:</span>
								<button
									type="button"
									class="rounded px-2 py-0.5 text-[10px] transition-colors {pos === 'support'
										? 'bg-emerald-500/20 text-emerald-400'
										: 'text-text-quaternary hover:bg-emerald-500/10 hover:text-emerald-400'}"
									onclick={() => setPosition(watch.billId, 'support')}
								>
									Support
								</button>
								<button
									type="button"
									class="rounded px-2 py-0.5 text-[10px] transition-colors {pos === 'oppose'
										? 'bg-red-500/20 text-red-400'
										: 'text-text-quaternary hover:bg-red-500/10 hover:text-red-400'}"
									onclick={() => setPosition(watch.billId, 'oppose')}
								>
									Oppose
								</button>
								<button
									type="button"
									class="rounded px-2 py-0.5 text-[10px] transition-colors {pos === null
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
								class="border-surface-border text-text-tertiary inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors hover:border-red-500/30 hover:text-red-400 disabled:opacity-50"
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
	<section id="bill-relevance" class="space-y-3">
		<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">Org relevance</h2>
		{#if data.relevant.length === 0}
			<div class="bg-surface-base border-surface-border rounded-md border p-6">
				<p class="text-text-tertiary text-sm">
					No relevance rows are loaded for this org. Bill relevance is computed from org
					issue-domain embeddings when the sync/rescore path has evidence to rank.
				</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each data.relevant as rel (rel.id)}
					{@const bill = rel.bill}
					<div
						class="bg-surface-base border-surface-border hover:bg-surface-raised rounded-md border p-4 transition-colors"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								<div class="mb-1 flex items-center gap-2">
									<h3 class="text-text-primary text-sm font-medium">{bill.title}</h3>
									<span
										class="inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] {statusBadgeClass(
											bill.status
										)}"
									>
										{bill.status}
									</span>
								</div>
								{#if bill.summary}
									<p class="text-text-tertiary mb-1.5 text-xs">{truncate(bill.summary, 200)}</p>
								{/if}
								<div class="text-text-quaternary flex items-center gap-3 text-[10px]">
									<span class="font-mono">{bill.externalId}</span>
									<span>{bill.jurisdiction}</span>
									{#if bill.chamber}
										<span>{bill.chamber}</span>
									{/if}
									<span>{formatDate(bill.statusDate)}</span>
								</div>
								<!-- Relevance indicator -->
								<div class="mt-2 flex items-center gap-2">
									<div
										class="bg-surface-overlay h-1.5 max-w-32 flex-1 overflow-hidden rounded-full"
									>
										<div
											class="h-full rounded-full bg-teal-500"
											style="width: {relevanceBar(rel.score)}"
										></div>
									</div>
									<span class="text-text-quaternary font-mono text-[10px]"
										>{relevanceBar(rel.score)} match</span
									>
									{#if rel.matchedOn.length > 0}
										<span class="text-text-quaternary text-[10px]">
											({rel.matchedOn.slice(0, 3).join(', ')})
										</span>
									{/if}
								</div>
							</div>
							<div class="flex-shrink-0">
								{#if watchedBillIds.has(bill.id)}
									<span
										class="inline-flex items-center rounded-md border border-teal-500/20 bg-teal-500/10 px-2.5 py-1 text-xs text-teal-400"
									>
										Watching
									</span>
								{:else}
									<button
										type="button"
										disabled={pendingAction === bill.id}
										class="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
										onclick={() => watchBill(bill.id)}
									>
										{#if pendingAction === bill.id}
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
										Watch
									</button>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
