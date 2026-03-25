<script lang="ts">
	import CompositeScoreBadge from '$lib/components/scorecard/CompositeScoreBadge.svelte';
	import ResponsivenessGauge from '$lib/components/scorecard/ResponsivenessGauge.svelte';
	import AlignmentGauge from '$lib/components/scorecard/AlignmentGauge.svelte';
	import TrendChart from '$lib/components/scorecard/TrendChart.svelte';
	import TransparencyTable from '$lib/components/scorecard/TransparencyTable.svelte';
	import AttestationBlock from '$lib/components/scorecard/AttestationBlock.svelte';

	let { data } = $props();
	let dm = $derived(data.decisionMaker);
	let current = $derived(data.current);

	function partyColor(party: string | null): string {
		if (!party) return 'bg-slate-100 text-slate-600';
		const p = party.toLowerCase();
		if (p === 'democrat' || p === 'democratic') return 'bg-blue-100 text-blue-700';
		if (p === 'republican') return 'bg-red-100 text-red-700';
		return 'bg-slate-100 text-slate-600';
	}
</script>

<svelte:head>
	<title>Scorecard: {dm.name} — Commons</title>
	<meta property="og:title" content="Scorecard: {dm.name}" />
	<meta
		property="og:description"
		content="Proof-weighted accountability scorecard for {dm.name}{dm.title ? ` (${dm.title})` : ''}"
	/>
	<meta property="og:type" content="profile" />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-12">
	<!-- Hero -->
	<header class="mb-8 text-center">
		{#if dm.photoUrl}
			<img
				src={dm.photoUrl}
				alt={dm.name}
				class="mx-auto mb-4 h-20 w-20 rounded-full border-2 border-slate-200 object-cover"
			/>
		{:else}
			<div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-indigo-100 text-2xl font-bold text-indigo-600">
				{dm.name.charAt(0)}
			</div>
		{/if}

		<h1 class="text-2xl font-bold text-slate-900">{dm.name}</h1>

		<div class="mt-1 flex items-center justify-center gap-2 text-sm text-slate-500">
			{#if dm.title}
				<span>{dm.title}</span>
			{/if}
			{#if dm.party}
				<span class="rounded-full px-2 py-0.5 text-xs font-medium {partyColor(dm.party)}">
					{dm.party}
				</span>
			{/if}
		</div>

		{#if dm.district || dm.jurisdiction}
			<p class="mt-1 text-sm text-slate-400">
				{[dm.district, dm.jurisdiction].filter(Boolean).join(', ')}
			</p>
		{/if}

		<div class="mt-4 flex justify-center">
			<CompositeScoreBadge score={current?.composite ?? null} />
		</div>

		{#if current}
			<p class="mt-2 text-xs text-slate-400">
				Period: {current.period.start} to {current.period.end}
			</p>
		{/if}
	</header>

	<!-- Score Dimensions -->
	<section class="mb-8 grid gap-4 sm:grid-cols-2" aria-label="Score dimensions">
		<ResponsivenessGauge
			score={current?.responsiveness ?? null}
			sent={current?.deliveriesSent ?? 0}
			opened={current?.deliveriesOpened ?? 0}
			verified={current?.deliveriesVerified ?? 0}
			replied={current?.repliesReceived ?? 0}
		/>
		<AlignmentGauge
			score={current?.alignment ?? null}
			aligned={current?.alignedVotes ?? 0}
			total={current?.totalScoredVotes ?? 0}
		/>
	</section>

	<!-- Proof Weight -->
	{#if current}
		<section class="mb-8 rounded-lg border border-slate-200 bg-white p-4" aria-label="Proof weight exposure">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-semibold text-slate-700">Proof Weight Exposure</h3>
				<span class="text-lg font-bold text-slate-900">
					{current.proofWeightTotal.toFixed(1)}
				</span>
			</div>
			<p class="mt-1 text-xs text-slate-400">
				Total proof weight of verified constituent evidence delivered to this official
			</p>
		</section>
	{/if}

	<!-- Trend Chart -->
	<section class="mb-8" aria-label="Historical trend">
		<TrendChart history={data.history} />
	</section>

	<!-- Transparency Table -->
	<section class="mb-8" aria-label="Transparency data">
		<TransparencyTable
			transparency={current
				? {
						deliveriesSent: current.deliveriesSent,
						deliveriesOpened: current.deliveriesOpened,
						deliveriesVerified: current.deliveriesVerified,
						repliesReceived: current.repliesReceived,
						alignedVotes: current.alignedVotes,
						totalScoredVotes: current.totalScoredVotes
					}
				: null}
		/>
	</section>

	<!-- Attestation -->
	<section class="mb-8" aria-label="Attestation">
		<AttestationBlock
			hash={current?.attestationHash ?? null}
			version={current?.methodologyVersion ?? null}
		/>
	</section>

	<!-- Footer -->
	<footer class="mt-12 border-t border-slate-200 pt-6 text-center text-xs text-slate-500">
		<p>
			Scorecard powered by <a href="/" class="font-medium text-indigo-600 hover:text-indigo-800">Commons</a>
			— Proof-weighted accountability for governance
		</p>
		<p class="mt-1">
			<a href="/about/integrity" class="underline hover:text-slate-700">Methodology &amp; Integrity</a>
		</p>
	</footer>
</div>
