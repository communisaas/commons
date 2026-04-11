<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let activeFilter = $state('ALL');

	const filtered = $derived(
		activeFilter === 'ALL'
			? data.campaigns
			: data.campaigns.filter((c) => c.status === activeFilter)
	);

	const canCreate = $derived(
		data.membership.role === 'owner' || data.membership.role === 'editor'
	);

	const filters = ['ALL', 'DRAFT', 'ACTIVE', 'COMPLETE'] as const;

	function typeBadgeClass(type: string): string {
		switch (type) {
			case 'LETTER':
				return 'bg-teal-500/15 text-teal-400 border-teal-500/20';
			case 'EVENT':
				return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20';
			case 'FORM':
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
			default:
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
		}
	}

	function statusBadgeClass(status: string): string {
		switch (status) {
			case 'DRAFT':
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
			case 'ACTIVE':
				return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'PAUSED':
				return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
			case 'COMPLETE':
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
			default:
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
		}
	}

	function formatDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function preview(body: string | null): string {
		if (!body) return '';
		return body.length > 120 ? body.slice(0, 120) + '...' : body;
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold text-text-primary">Campaigns</h1>
			<p class="text-sm text-text-tertiary mt-1">
				{data.counts.ALL} campaign{data.counts.ALL === 1 ? '' : 's'}
			</p>
		</div>
		{#if canCreate}
			<a
				href="/org/{data.org.slug}/campaigns/new"
				class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 transition-colors"
			>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
				</svg>
				Assemble Proof
			</a>
		{/if}
	</div>

	<!-- Filter tabs -->
	<div class="flex gap-1 border-b border-surface-border">
		{#each filters as filter}
			<button
				type="button"
				class="px-4 py-2 text-sm border-b-2 transition-colors {activeFilter === filter
					? 'border-teal-400 text-text-primary'
					: 'border-transparent text-text-tertiary hover:text-text-secondary'}"
				onclick={() => (activeFilter = filter)}
			>
				{filter === 'ALL' ? 'All' : filter.charAt(0) + filter.slice(1).toLowerCase()}
				<span class="ml-1 font-mono tabular-nums text-xs text-text-quaternary">{data.counts[filter] ?? 0}</span>
			</button>
		{/each}
	</div>

	<!-- Campaign cards -->
	{#if filtered.length === 0}
		<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-12 text-center">
			<div class="mx-auto w-12 h-12 rounded-full bg-surface-overlay flex items-center justify-center mb-4">
				<svg class="w-6 h-6 text-text-quaternary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
				</svg>
			</div>
			<p class="text-sm text-text-tertiary">
				{#if activeFilter === 'ALL'}
					No proof packets yet. Assemble your first to direct verified constituent support at decision-makers.
				{:else}
					No {activeFilter.toLowerCase()} campaigns.
				{/if}
			</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each filtered as campaign (campaign.id)}
				<a
					href="/org/{data.org.slug}/campaigns/{campaign.id}"
					class="block rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-5 hover:bg-surface-raised hover:border-[var(--coord-route-solid)] transition-colors group"
				>
					<div class="flex items-start justify-between gap-4">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-3 mb-2">
								<h2 class="text-lg font-medium text-text-primary truncate group-hover:text-teal-400 transition-colors">
									{campaign.title}
								</h2>
								<span class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono {typeBadgeClass(campaign.type)}">
									{campaign.type}
								</span>
								<span class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono {statusBadgeClass(campaign.status)}">
									{campaign.status}
								</span>
							</div>

							{#if campaign.body}
								<p class="text-sm text-text-tertiary mb-2">{preview(campaign.body)}</p>
							{/if}

							<div class="flex items-center gap-4 text-xs text-text-tertiary">
								{#if campaign.templateTitle}
									<span class="flex items-center gap-1">
										<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
											<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
										</svg>
										{campaign.templateTitle}
									</span>
								{/if}
								{#if campaign.debateEnabled}
									<span class="flex items-center gap-1">
										<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
											<path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
										</svg>
										Debate (threshold: {campaign.debateThreshold})
									</span>
								{/if}
								<span class="font-mono tabular-nums">{formatDate(campaign.updatedAt)}</span>
							</div>
						</div>

						<svg class="w-5 h-5 text-text-quaternary group-hover:text-text-tertiary transition-colors flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
						</svg>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
