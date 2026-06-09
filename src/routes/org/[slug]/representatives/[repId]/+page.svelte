<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import {
		buildPowerTargetDetailRows,
		getGateEvidence,
		type PowerTargetDetailRow
	} from '$lib/data/capability-hypergraph';
	import type { PageData } from './$types';

	type CapabilityItem = {
		label: string;
		state: PowerTargetDetailRow['state'];
		phase: string;
		cluster: string;
		action: string;
		handoff?: string;
		detail: string;
		unlock: string;
		href: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type DecisionMaker = {
		id: string;
		name: string;
		photoUrl?: string | null;
		party: string | null;
		active: boolean;
		title?: string | null;
		jurisdiction: string | null;
		district: string | null;
		termStart: string | null;
		termEnd: string | null;
		phone?: string | null;
		email?: string | null;
		websiteUrl?: string | null;
		officeAddress?: string | null;
	};

	type BillSummary = {
		id: string;
		externalId: string | null;
		title: string;
	};

	type DecisionMakerAction = {
		id: string;
		action: string;
		detail?: string | null;
		sourceUrl?: string | null;
		occurredAt: string;
		bill: BillSummary;
	};

	type ProofReceipt = {
		id: string;
		proofWeight: number;
		dmAction?: string | null;
		alignment?: string | null;
		causalityClass?: string | null;
		status: string;
		proofDeliveredAt: string;
		bill: BillSummary;
	};

	type ViewData = Omit<PageData, 'decisionMaker' | 'actions' | 'receipts'> & {
		decisionMaker: DecisionMaker;
		actions: DecisionMakerAction[];
		receipts: ProofReceipt[];
	};

	let { data }: { data: ViewData } = $props();

	const dm = $derived(data.decisionMaker);
	const base = $derived(`/org/${data.org.slug}`);

	// Follow state
	let isFollowed = $state(!!data.follow);
	let followPending = $state(false);
	const hasContactRoute = $derived(
		Boolean(dm.phone || dm.email || dm.websiteUrl || dm.officeAddress)
	);
	const timelineCount = $derived(data.actions.length + data.receipts.length);
	const stateLocalTerrainGate = getGateEvidence(
		'CP-state-local-terrain',
		['T3-1', 'T3-2', 'T3-10'],
		{
			name: 'State/local power terrain',
			downstream: 3,
			dependency: 'OpenStates, special-district officeholders, and per-district feeds'
		}
	);
	const readerOfficeGate = getGateEvidence('CP-reader-office-profile', ['T8-1a', 'T8-1b', 'T8-8'], {
		name: 'Reader office response terrain',
		downstream: 4,
		dependency:
			'Decision-maker office profile enrichment, office-response workflow, and notification webhooks'
	});
	const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2', 'T6-9'], {
		name: 'Receipt anchoring + response detection',
		downstream: 4,
		dependency: 'Receipt writer/mainnet anchoring + event-stream response detection'
	});
	const powerTargetDetailRows = $derived<PowerTargetDetailRow[]>(
		buildPowerTargetDetailRows({
			base,
			target: {
				id: dm.id,
				isFollowed,
				hasContactRoute,
				timelineCount,
				receiptCount: data.accountability.receiptCount
			},
			gates: {
				stateLocalTerrainGate,
				readerOfficeGate,
				receiptAnchoringGate
			}
		})
	);
	const capabilityItems = $derived<CapabilityItem[]>([
		...powerTargetDetailRows.map((row) => ({
			label: row.label,
			state: row.state,
			phase: row.phase,
			cluster: row.clusters,
			action: row.action,
			handoff: row.handoff,
			detail: row.ground,
			unlock: row.boundary,
			href: row.href,
			metric: row.metric
		}))
	]);

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

	function partyLabel(party: string | null): string {
		switch (party) {
			case 'D':
				return 'Democrat';
			case 'R':
				return 'Republican';
			case 'I':
				return 'Independent';
			case 'L':
				return 'Libertarian';
			default:
				return 'Unknown';
		}
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

	function actionLabel(action: string): string {
		switch (action) {
			case 'voted_yes':
				return 'Yea';
			case 'voted_no':
				return 'Nay';
			case 'abstained':
				return 'Abstained';
			case 'sponsored':
				return 'Sponsored';
			case 'co-sponsored':
				return 'Co-sponsored';
			default:
				return action;
		}
	}

	function actionBadgeColor(action: string): string {
		switch (action) {
			case 'voted_yes':
				return 'bg-green-500/15 text-green-400';
			case 'voted_no':
				return 'bg-red-500/15 text-red-400';
			case 'abstained':
				return 'bg-amber-500/15 text-amber-400';
			case 'sponsored':
			case 'co-sponsored':
				return 'bg-blue-500/15 text-blue-400';
			default:
				return 'bg-gray-500/15 text-gray-400';
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
		class="text-text-tertiary hover:text-text-secondary inline-flex items-center gap-1.5 text-sm transition-colors"
	>
		<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
			<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
		</svg>
		Power targets
	</a>

	<WorkspaceCapabilityStrip label="Power target detail capability" items={capabilityItems} />

	<!-- Header card -->
	<div id="target-posture" class="bg-surface-base border-surface-border rounded-md border p-6">
		<div class="flex items-start gap-4">
			<!-- Photo or initials -->
			{#if dm.photoUrl}
				<img
					src={dm.photoUrl}
					alt={dm.name}
					class="h-16 w-16 flex-shrink-0 rounded-full object-cover"
				/>
			{:else}
				<div
					class="bg-surface-overlay text-text-tertiary flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full text-lg font-semibold"
				>
					{initials(dm.name)}
				</div>
			{/if}

			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-3">
					<h1 class="text-text-primary text-xl font-semibold">{dm.name}</h1>
					{#if dm.party}
						<span
							class="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-bold text-white {partyColor(
								dm.party
							)}"
						>
							{partyLabel(dm.party)}
						</span>
					{/if}
					{#if !dm.active}
						<span
							class="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-400"
						>
							Inactive
						</span>
					{/if}
				</div>

				<p class="text-text-tertiary mt-1 text-sm">
					{#if dm.title}{dm.title}{/if}
					{#if dm.jurisdiction}
						{#if dm.title}<span class="text-text-quaternary mx-1">&middot;</span>{/if}
						{locationLabel(dm.jurisdiction, dm.district)}
					{/if}
				</p>

				{#if dm.termStart || dm.termEnd}
					<p class="text-text-quaternary mt-1 text-xs">
						Term: {dm.termStart ? formatDate(dm.termStart) : '?'}
						&ndash; {dm.termEnd ? formatDate(dm.termEnd) : 'present'}
					</p>
				{/if}
			</div>

			<!-- Follow/unfollow button -->
			<button
				type="button"
				disabled={followPending}
				class="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 {isFollowed
					? 'border-surface-border text-text-tertiary border hover:border-red-500/30 hover:text-red-400'
					: 'bg-teal-600 text-white hover:bg-teal-500'}"
				onclick={toggleFollow}
			>
				{#if followPending}
					<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
						></circle>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
						></path>
					</svg>
				{/if}
				{isFollowed ? 'Unfollow' : 'Follow'}
			</button>
		</div>
	</div>

	<!-- Contact info -->
	<div id="target-contact-boundary">
		{#if dm.phone || dm.email || dm.websiteUrl || dm.officeAddress}
			<div class="bg-surface-base border-surface-border rounded-md border p-5">
				<h2 class="text-text-secondary mb-3 text-sm font-medium tracking-wider uppercase">
					Contact
				</h2>
				<div class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
					{#if dm.phone}
						<div class="text-text-tertiary flex items-center gap-2">
							<svg
								class="h-4 w-4 flex-shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
								/>
							</svg>
							<a href="tel:{dm.phone}" class="hover:text-text-secondary transition-colors"
								>{dm.phone}</a
							>
						</div>
					{/if}
					{#if dm.email}
						<div class="text-text-tertiary flex items-center gap-2">
							<svg
								class="h-4 w-4 flex-shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
								/>
							</svg>
							<a
								href="mailto:{dm.email}"
								class="hover:text-text-secondary truncate transition-colors">{dm.email}</a
							>
						</div>
					{/if}
					{#if dm.websiteUrl}
						<div class="text-text-tertiary flex items-center gap-2">
							<svg
								class="h-4 w-4 flex-shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
								/>
							</svg>
							<a
								href={dm.websiteUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="hover:text-text-secondary truncate transition-colors">{dm.websiteUrl}</a
							>
						</div>
					{/if}
					{#if dm.officeAddress}
						<div class="text-text-tertiary flex items-start gap-2">
							<svg
								class="mt-0.5 h-4 w-4 flex-shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
								/>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
								/>
							</svg>
							<span>{dm.officeAddress}</span>
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<div class="bg-surface-base border-surface-border rounded-md border p-5">
				<h2 class="text-text-secondary mb-2 text-sm font-medium tracking-wider uppercase">
					Contact route boundary
				</h2>
				<p class="text-text-tertiary text-sm">
					No public contact route is loaded for this target. Resolve delivery through Studio or the
					current campaign target list before claiming a send path.
				</p>
			</div>
		{/if}
	</div>

	<!-- Accountability summary -->
	{#if data.accountability.receiptCount > 0}
		<div
			id="target-accountability"
			class="bg-surface-base border-surface-border rounded-md border p-5"
		>
			<h2 class="text-text-secondary mb-3 text-sm font-medium tracking-wider uppercase">
				Accountability Summary
			</h2>
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<div>
					<p class="text-text-primary text-2xl font-semibold">{data.accountability.receiptCount}</p>
					<p class="text-text-quaternary mt-0.5 text-xs">Proof receipts</p>
				</div>
				<div>
					<p class="text-text-primary text-2xl font-semibold">
						{data.accountability.avgProofWeight}
					</p>
					<p class="text-text-quaternary mt-0.5 text-xs">Avg proof weight</p>
				</div>
				<div>
					<p class="text-2xl font-semibold text-green-400">{data.accountability.alignedCount}</p>
					<p class="text-text-quaternary mt-0.5 text-xs">Aligned actions</p>
				</div>
				<div>
					<p class="text-2xl font-semibold text-red-400">{data.accountability.opposedCount}</p>
					<p class="text-text-quaternary mt-0.5 text-xs">Opposed actions</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Activity timeline -->
	<section
		class="space-y-3"
		id={data.accountability.receiptCount > 0 ? undefined : 'target-accountability'}
	>
		<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">Activity</h2>

		{#if timeline.length === 0}
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
							d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				</div>
				<p class="text-text-tertiary text-sm">No recorded activity yet.</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each timeline as item (item.id)}
					<div
						class="bg-surface-base border-surface-border hover:bg-surface-raised rounded-md border p-4 transition-colors"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 flex-1">
								{#if item.type === 'vote'}
									<div class="flex flex-wrap items-center gap-2">
										<span
											class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium {actionBadgeColor(
												item.action as string
											)}"
										>
											{actionLabel(item.action as string)}
										</span>
										<span class="text-text-primary truncate text-sm">
											{item.bill.title}
										</span>
									</div>
									{#if item.bill.externalId}
										<p class="text-text-quaternary mt-1 font-mono text-xs">
											{item.bill.externalId}
										</p>
									{/if}
								{:else if item.type === 'sponsor'}
									<div class="flex flex-wrap items-center gap-2">
										<span
											class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium {actionBadgeColor(
												item.action as string
											)}"
										>
											{actionLabel(item.action as string)}
										</span>
										<span class="text-text-primary truncate text-sm">
											{item.bill.title}
										</span>
									</div>
									{#if item.bill.externalId}
										<p class="text-text-quaternary mt-1 font-mono text-xs">
											{item.bill.externalId}
										</p>
									{/if}
								{:else if item.type === 'receipt'}
									<div class="flex flex-wrap items-center gap-2">
										<span
											class="inline-flex items-center rounded-full bg-teal-500/15 px-2 py-0.5 text-[11px] font-medium text-teal-400"
										>
											Proof delivered
										</span>
										<span class="text-text-primary truncate text-sm">
											{item.bill.title}
										</span>
									</div>
									<p class="text-text-quaternary mt-1 text-xs">
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

							<span class="text-text-quaternary flex-shrink-0 text-xs whitespace-nowrap">
								{formatDate(item.date)}
							</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
