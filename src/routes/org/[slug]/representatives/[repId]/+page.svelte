<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const dm = $derived(data.decisionMaker);

	// Follow state
	let isFollowed = $state(!!data.follow);
	let followPending = $state(false);

	// Merge actions and receipts into a single timeline
	const timeline = $derived.by(() => {
		type TimelineItem = {
			type: 'vote' | 'sponsor' | 'receipt';
			date: string;
			id: string;
			bill: { id: string; externalId: string | null; title: string };
			[key: string]: unknown;
		};

		const items: TimelineItem[] = [];

		for (const a of data.actions) {
			const isVote = a.action.startsWith('voted_') || a.action === 'abstained';
			items.push({
				type: isVote ? 'vote' : 'sponsor',
				date: a.occurredAt,
				id: a.id,
				bill: a.bill,
				action: a.action,
				detail: a.detail,
				sourceUrl: a.sourceUrl
			});
		}

		for (const r of data.receipts) {
			items.push({
				type: 'receipt',
				date: r.proofDeliveredAt,
				id: r.id,
				bill: r.bill,
				proofWeight: r.proofWeight,
				dmAction: r.dmAction,
				alignment: r.alignment,
				causalityClass: r.causalityClass,
				status: r.status
			});
		}

		items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
		return items;
	});

	// Party helpers
	function partyColor(party: string | null): string {
		switch (party) {
			case 'D': return 'bg-blue-600';
			case 'R': return 'bg-red-600';
			case 'I': return 'bg-purple-600';
			case 'L': return 'bg-amber-600';
			default: return 'bg-gray-500';
		}
	}

	function partyLabel(party: string | null): string {
		switch (party) {
			case 'D': return 'Democrat';
			case 'R': return 'Republican';
			case 'I': return 'Independent';
			case 'L': return 'Libertarian';
			default: return 'Unknown';
		}
	}

	function locationLabel(jurisdiction: string | null, district: string | null): string {
		if (!jurisdiction) return '';
		return district ? `${jurisdiction}-${district}` : jurisdiction;
	}

	function initials(name: string): string {
		return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
	}

	function actionLabel(action: string): string {
		switch (action) {
			case 'voted_yes': return 'Yea';
			case 'voted_no': return 'Nay';
			case 'abstained': return 'Abstained';
			case 'sponsored': return 'Sponsored';
			case 'co-sponsored': return 'Co-sponsored';
			default: return action;
		}
	}

	function actionBadgeColor(action: string): string {
		switch (action) {
			case 'voted_yes': return 'bg-green-500/15 text-green-400';
			case 'voted_no': return 'bg-red-500/15 text-red-400';
			case 'abstained': return 'bg-amber-500/15 text-amber-400';
			case 'sponsored':
			case 'co-sponsored': return 'bg-blue-500/15 text-blue-400';
			default: return 'bg-gray-500/15 text-gray-400';
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	async function toggleFollow() {
		followPending = true;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/decision-makers/${dm.id}/follow`, {
				method: isFollowed ? 'DELETE' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: isFollowed ? undefined : JSON.stringify({})
			});
			if (res.ok) {
				isFollowed = !isFollowed;
			}
		} finally {
			followPending = false;
		}
	}
</script>

<div class="space-y-6">
	<!-- Back link -->
	<a
		href="/org/{data.org.slug}/representatives"
		class="inline-flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
	>
		<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
			<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
		</svg>
		Decision Makers
	</a>

	<!-- Header card -->
	<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-6">
		<div class="flex items-start gap-4">
			<!-- Photo or initials -->
			{#if dm.photoUrl}
				<img
					src={dm.photoUrl}
					alt={dm.name}
					class="w-16 h-16 rounded-full object-cover flex-shrink-0"
				/>
			{:else}
				<div class="w-16 h-16 rounded-full bg-surface-overlay flex items-center justify-center text-text-tertiary font-semibold text-lg flex-shrink-0">
					{initials(dm.name)}
				</div>
			{/if}

			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-3 flex-wrap">
					<h1 class="text-xl font-semibold text-text-primary">{dm.name}</h1>
					{#if dm.party}
						<span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold text-white {partyColor(dm.party)}">
							{partyLabel(dm.party)}
						</span>
					{/if}
					{#if !dm.active}
						<span class="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-400">
							Inactive
						</span>
					{/if}
				</div>

				<p class="text-sm text-text-tertiary mt-1">
					{#if dm.title}{dm.title}{/if}
					{#if dm.jurisdiction}
						{#if dm.title}<span class="text-text-quaternary mx-1">&middot;</span>{/if}
						{locationLabel(dm.jurisdiction, dm.district)}
					{/if}
				</p>

				{#if dm.termStart || dm.termEnd}
					<p class="text-xs text-text-quaternary mt-1">
						Term: {dm.termStart ? formatDate(dm.termStart) : '?'}
						&ndash; {dm.termEnd ? formatDate(dm.termEnd) : 'present'}
					</p>
				{/if}
			</div>

			<!-- Follow/unfollow button -->
			<button
				type="button"
				disabled={followPending}
				class="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 {isFollowed ? 'border border-surface-border text-text-tertiary hover:text-red-400 hover:border-red-500/30' : 'bg-teal-600 text-white hover:bg-teal-500'}"
				onclick={toggleFollow}
			>
				{#if followPending}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
				{/if}
				{isFollowed ? 'Unfollow' : 'Follow'}
			</button>
		</div>
	</div>

	<!-- Contact info -->
	{#if dm.phone || dm.email || dm.websiteUrl || dm.officeAddress}
		<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-5">
			<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider mb-3">Contact</h2>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
				{#if dm.phone}
					<div class="flex items-center gap-2 text-text-tertiary">
						<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
						</svg>
						<a href="tel:{dm.phone}" class="hover:text-text-secondary transition-colors">{dm.phone}</a>
					</div>
				{/if}
				{#if dm.email}
					<div class="flex items-center gap-2 text-text-tertiary">
						<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
						</svg>
						<a href="mailto:{dm.email}" class="hover:text-text-secondary transition-colors truncate">{dm.email}</a>
					</div>
				{/if}
				{#if dm.websiteUrl}
					<div class="flex items-center gap-2 text-text-tertiary">
						<svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
						</svg>
						<a href={dm.websiteUrl} target="_blank" rel="noopener noreferrer" class="hover:text-text-secondary transition-colors truncate">{dm.websiteUrl}</a>
					</div>
				{/if}
				{#if dm.officeAddress}
					<div class="flex items-start gap-2 text-text-tertiary">
						<svg class="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
						</svg>
						<span>{dm.officeAddress}</span>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Accountability summary -->
	{#if data.accountability.receiptCount > 0}
		<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-5">
			<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider mb-3">Accountability Summary</h2>
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
				<div>
					<p class="text-2xl font-semibold text-text-primary">{data.accountability.receiptCount}</p>
					<p class="text-xs text-text-quaternary mt-0.5">Proof receipts</p>
				</div>
				<div>
					<p class="text-2xl font-semibold text-text-primary">{data.accountability.avgProofWeight}</p>
					<p class="text-xs text-text-quaternary mt-0.5">Avg proof weight</p>
				</div>
				<div>
					<p class="text-2xl font-semibold text-green-400">{data.accountability.alignedCount}</p>
					<p class="text-xs text-text-quaternary mt-0.5">Aligned actions</p>
				</div>
				<div>
					<p class="text-2xl font-semibold text-red-400">{data.accountability.opposedCount}</p>
					<p class="text-xs text-text-quaternary mt-0.5">Opposed actions</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Activity timeline -->
	<section class="space-y-3">
		<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider">Activity</h2>

		{#if timeline.length === 0}
			<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-8 text-center">
				<div class="mx-auto w-10 h-10 rounded-full bg-surface-overlay flex items-center justify-center mb-3">
					<svg class="w-5 h-5 text-text-quaternary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
				</div>
				<p class="text-sm text-text-tertiary">No recorded activity yet.</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each timeline as item (item.id)}
					<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-4 hover:bg-surface-raised transition-colors">
						<div class="flex items-start justify-between gap-3">
							<div class="flex-1 min-w-0">
								{#if item.type === 'vote'}
									<div class="flex items-center gap-2 flex-wrap">
										<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium {actionBadgeColor(item.action as string)}">
											{actionLabel(item.action as string)}
										</span>
										<span class="text-sm text-text-primary truncate">
											{item.bill.title}
										</span>
									</div>
									{#if item.bill.externalId}
										<p class="text-xs text-text-quaternary mt-1 font-mono">{item.bill.externalId}</p>
									{/if}
								{:else if item.type === 'sponsor'}
									<div class="flex items-center gap-2 flex-wrap">
										<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium {actionBadgeColor(item.action as string)}">
											{actionLabel(item.action as string)}
										</span>
										<span class="text-sm text-text-primary truncate">
											{item.bill.title}
										</span>
									</div>
									{#if item.bill.externalId}
										<p class="text-xs text-text-quaternary mt-1 font-mono">{item.bill.externalId}</p>
									{/if}
								{:else if item.type === 'receipt'}
									<div class="flex items-center gap-2 flex-wrap">
										<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-teal-500/15 text-teal-400">
											Proof delivered
										</span>
										<span class="text-sm text-text-primary truncate">
											{item.bill.title}
										</span>
									</div>
									<p class="text-xs text-text-quaternary mt-1">
										Weight: {(item.proofWeight as number).toFixed(2)}
										{#if item.dmAction}
											<span class="mx-1">&middot;</span>
											Action: {item.dmAction}
										{/if}
										{#if item.causalityClass && item.causalityClass !== 'pending'}
											<span class="mx-1">&middot;</span>
											{item.causalityClass}
										{/if}
									</p>
								{/if}
							</div>

							<span class="text-xs text-text-quaternary whitespace-nowrap flex-shrink-0">
								{formatDate(item.date)}
							</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
