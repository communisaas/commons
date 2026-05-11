<script lang="ts">
	import type { PageData } from './$types';
	import { Datum, RegistryMark } from '$lib/design';

	let { data }: { data: PageData } = $props();

	function partyColor(party: string | null): string {
		// Party-as-categorical is a permitted local palette exception per
		// design-system.md (Party indicators), redundant with the letter itself.
		if (party === 'D' || party === 'Democratic') return 'text-blue-700';
		if (party === 'R' || party === 'Republican') return 'text-red-700';
		if (party === 'I' || party === 'Independent') return 'text-purple-700';
		return 'text-slate-600';
	}

	const party = $derived(data.decisionMaker.party);
	const totalReceipts = $derived(data.summary.totalReceipts);
	const verifiedContacts = $derived(data.summary.totalVerifiedConstituents);
	const causalityPct = $derived(Math.round(data.summary.causalityRate * 100));
	const hasActivity = $derived(totalReceipts > 0);
	const billsTracked = $derived(data.bills.filter((b) => b.bill !== null));
</script>

<svelte:head>
	<title>{data.decisionMaker.name} — Commons</title>
	<meta
		name="description"
		content="Public profile for {data.decisionMaker.name}{data.decisionMaker.district
			? ` (${data.decisionMaker.district})`
			: ''}."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-4 py-12">
	<header class="mb-10">
		<div class="flex items-start gap-6">
			{#if data.decisionMaker.photoUrl}
				<img
					src={data.decisionMaker.photoUrl}
					alt={data.decisionMaker.name}
					class="h-24 w-24 rounded-lg object-cover"
				/>
			{/if}
			<div class="min-w-0 flex-1">
				<h1 class="font-brand text-3xl font-bold text-slate-900">
					{data.decisionMaker.name}
				</h1>
				{#if data.decisionMaker.title}
					<p class="mt-1 font-brand text-base text-slate-600">
						{data.decisionMaker.title}
					</p>
				{/if}
				<p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
					{#if party}
						<span class="font-mono text-xs font-semibold {partyColor(party)}">
							{party}
						</span>
					{/if}
					{#if data.decisionMaker.district}
						<span class="font-mono text-xs text-slate-600"
							>{data.decisionMaker.district}</span
						>
					{/if}
					{#if data.decisionMaker.jurisdiction}
						<span class="font-brand text-xs text-slate-500"
							>{data.decisionMaker.jurisdiction}</span
						>
					{/if}
				</p>
				<p class="mt-3">
					<RegistryMark
						variant="tag"
						value={data.routeIdentifier}
						truncate={false}
						class="text-[11px] text-slate-500"
					/>
				</p>
			</div>
		</div>
	</header>

	{#if !hasActivity}
		<section class="my-10 border-y border-slate-200 py-10 text-center">
			<p class="font-brand text-base font-medium text-slate-700">
				No public Commons activity tracked yet.
			</p>
			<p class="mx-auto mt-2 max-w-md font-brand text-sm text-slate-500">
				When constituents send messages here that reach this decision-maker, the
				delivery enters the public record alongside any subsequent action.
			</p>
		</section>
	{:else}
		<section class="mb-10 border-y border-slate-200 py-6">
			<h2 class="sr-only">Aggregate signal</h2>
			<dl class="grid grid-cols-2 gap-6 sm:grid-cols-4">
				<div>
					<dt class="font-brand text-xs uppercase tracking-wide text-slate-500">
						Bills tracked
					</dt>
					<dd class="mt-1">
						<Datum
							value={data.summary.uniqueBills}
							class="text-2xl font-bold text-slate-900"
						/>
					</dd>
				</div>
				<div>
					<dt class="font-brand text-xs uppercase tracking-wide text-slate-500">
						Evidence records
					</dt>
					<dd class="mt-1">
						<Datum
							value={totalReceipts}
							class="text-2xl font-bold text-slate-900"
						/>
					</dd>
				</div>
				<div>
					<dt class="font-brand text-xs uppercase tracking-wide text-slate-500">
						Verified contacts
					</dt>
					<dd class="mt-1">
						{#if verifiedContacts !== null}
							<Datum
								value={verifiedContacts}
								class="text-2xl font-bold text-slate-900"
							/>
						{:else}
							<span
								class="font-mono text-2xl font-bold tabular-nums text-slate-400"
								>&lt; 5</span
							>
							<p class="mt-0.5 font-brand text-[11px] text-slate-500">
								suppressed for privacy
							</p>
						{/if}
					</dd>
				</div>
				<div>
					<dt class="font-brand text-xs uppercase tracking-wide text-slate-500">
						Action followed
					</dt>
					<dd class="mt-1">
						<span class="font-mono text-2xl font-bold tabular-nums text-slate-900"
							>{causalityPct}%</span
						>
						<p class="mt-0.5 font-brand text-[11px] text-slate-500">
							share where this decision-maker acted within the tracking window
						</p>
					</dd>
				</div>
			</dl>
		</section>

		{#if billsTracked.length > 0}
			<section class="mb-10">
				<h2 class="font-brand text-base font-semibold text-slate-900">
					Bills tracked
				</h2>
				<ul class="mt-3 divide-y divide-slate-100">
					{#each billsTracked as entry (entry.bill?._id)}
						<li class="py-3">
							<div class="flex items-baseline justify-between gap-3">
								<p class="min-w-0 flex-1 font-brand text-sm font-medium text-slate-800">
									{entry.bill?.title}
								</p>
								<span class="shrink-0 font-mono text-[11px] text-slate-500">
									{entry.bill?.status}
								</span>
							</div>
							<p class="mt-0.5 font-brand text-xs text-slate-500">
								<Datum
									value={entry.receipts.length}
									class="font-medium text-slate-700"
								/>
								{entry.receipts.length === 1 ? 'evidence record' : 'evidence records'}
								{#if entry.latestAction}
									· latest action: {entry.latestAction}
								{/if}
							</p>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="mb-10">
			<h2 class="font-brand text-base font-semibold text-slate-900">
				Per-bill detail
			</h2>
			<p class="mt-2 font-brand text-sm text-slate-600">
				Per-receipt alignment, proof weights, and action timing are at the
				accountability view.
			</p>
			<p class="mt-4">
				<a
					href="/accountability/{data.routeIdentifier}"
					class="inline-flex items-center gap-1 font-brand text-sm font-medium text-indigo-600 hover:text-indigo-800"
				>
					View {totalReceipts}
					{totalReceipts === 1 ? 'evidence record' : 'evidence records'} →
				</a>
			</p>
		</section>
	{/if}

	<footer class="mt-12 border-t border-slate-200 pt-6 text-center">
		<p class="font-brand text-xs text-slate-500">
			Public profile — data from
			<a href="/" class="font-medium text-indigo-600 hover:text-indigo-800">Commons</a>.
		</p>
	</footer>
</main>
