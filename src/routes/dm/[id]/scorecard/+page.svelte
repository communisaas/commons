<script lang="ts">
	import ResponsivenessGauge from '$lib/components/scorecard/ResponsivenessGauge.svelte';
	import AlignmentGauge from '$lib/components/scorecard/AlignmentGauge.svelte';
	import TrendChart from '$lib/components/scorecard/TrendChart.svelte';
	import TransparencyTable from '$lib/components/scorecard/TransparencyTable.svelte';
	import AttestationBlock from '$lib/components/scorecard/AttestationBlock.svelte';
	import type { PageData } from './$types';

	type DecisionMakerView = {
		id: string;
		name: string;
		title?: string | null;
		photoUrl?: string | null;
		party?: string | null;
		district?: string | null;
		jurisdiction?: string | null;
	};

	let { data }: { data: PageData } = $props();
	let dm = $derived(data.decisionMaker as DecisionMakerView);
	let currentFact = $derived(data.current);
	let current = $derived(currentFact.state === 'present' ? currentFact.value : null);

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
		content="Accountability scorecard for {dm.name}{dm.title ? ` (${dm.title})` : ''}"
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
			<div
				class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-indigo-100 text-2xl font-bold text-indigo-600"
			>
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

		{#if current}
			<p class="mt-4 text-sm text-slate-500" data-testid="scorecard-activity">
				{current.deliveriesSent} accountability receipts recorded · {current.deliveriesVerified}
				with a verification link followed · {current.repliesReceived} with a reply logged
			</p>
			<p class="mt-2 text-xs text-slate-400">
				Period: {current.period.start} to {current.period.end}
			</p>
		{:else if currentFact.state === 'absent'}
			<p class="mt-4 text-sm text-slate-500">
				No accountability receipts are recorded for this official.
			</p>
		{:else if currentFact.state === 'withheld'}
			<p class="mt-4 text-sm text-slate-500">
				Accountability activity is recorded, but public counts are withheld.
			</p>
		{:else}
			<p class="mt-4 text-sm text-slate-500">Accountability counts are temporarily unavailable.</p>
		{/if}
	</header>

	<section class="mb-8 grid gap-4 sm:grid-cols-2" aria-label="Accountability activity">
		<ResponsivenessGauge current={currentFact} />
		<AlignmentGauge current={currentFact} />
	</section>

	<!-- Trend Chart -->
	<section class="mb-8" aria-label="Historical trend">
		<TrendChart history={data.history} />
	</section>

	<!-- Transparency Table -->
	<section class="mb-8" aria-label="Transparency data">
		<TransparencyTable current={currentFact} />
	</section>

	<!-- Attestation -->
	<section class="mb-8" aria-label="Attestation">
		<AttestationBlock current={currentFact} />
	</section>

	<!-- Footer -->
	<footer class="mt-12 border-t border-slate-200 pt-6 text-center text-xs text-slate-500">
		<p>
			Scorecard powered by <a href="/" class="font-medium text-indigo-600 hover:text-indigo-800"
				>Commons</a
			>
		</p>
		<p class="mt-1">
			<a href="/about/integrity" class="underline hover:text-slate-700"
				>Methodology &amp; Integrity</a
			>
		</p>
	</footer>
</div>
