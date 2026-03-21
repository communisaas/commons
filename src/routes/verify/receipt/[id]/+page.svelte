<script lang="ts">
	import { ShieldCheck, ExternalLink, Copy, Check } from '@lucide/svelte';

	let { data } = $props();

	const r = $derived(data.receipt);
	const bill = $derived(data.bill);

	// Status badge colors
	const statusColor = $derived.by(() => {
		switch (bill.status) {
			case 'passed': return 'bg-green-100 text-green-800';
			case 'failed': return 'bg-red-100 text-red-800';
			case 'floor': return 'bg-yellow-100 text-yellow-800';
			case 'committee': return 'bg-blue-100 text-blue-800';
			default: return 'bg-slate-100 text-slate-700';
		}
	});

	// Causality badge
	const causalityColor = $derived.by(() => {
		switch (r.causalityClass) {
			case 'strong': return 'bg-green-100 text-green-800';
			case 'moderate': return 'bg-yellow-100 text-yellow-800';
			case 'weak': return 'bg-orange-100 text-orange-800';
			case 'none': return 'bg-red-100 text-red-800';
			default: return 'bg-slate-100 text-slate-600';
		}
	});

	// Alignment display
	const alignmentLabel = $derived.by(() => {
		if (r.alignment > 0.3) return { text: 'Aligned', color: 'text-green-700' };
		if (r.alignment < -0.3) return { text: 'Opposed', color: 'text-red-700' };
		return { text: 'Neutral', color: 'text-slate-600' };
	});

	// Action display
	const actionLabel = $derived.by(() => {
		switch (r.dmAction) {
			case 'voted_yes': return 'Voted Yes';
			case 'voted_no': return 'Voted No';
			case 'abstained': return 'Abstained';
			case 'sponsored': return 'Sponsored';
			case 'co-sponsored': return 'Co-sponsored';
			default: return r.dmAction?.replace(/_/g, ' ') ?? 'Pending';
		}
	});

	// Copy-to-clipboard
	let copied = $state(false);
	function copyDigest() {
		navigator.clipboard.writeText(r.attestationDigest);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '--';
		return new Date(iso).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function pct(v: number | null): string {
		if (v === null || v === undefined) return '--';
		return `${(v * 100).toFixed(0)}%`;
	}
</script>

<svelte:head>
	<title>Accountability Receipt | {r.dmName} | Commons</title>
	<meta name="description" content="Verified accountability receipt for {r.dmName} on {bill.title}" />
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-12">
	<!-- Header -->
	<div class="mb-8">
		<div class="mb-3 flex items-center gap-2">
			<div class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
				<ShieldCheck class="h-5 w-5 text-green-600" aria-hidden="true" />
			</div>
			<span class="text-sm font-medium text-green-700">Verified Accountability Receipt</span>
		</div>
		<h1 class="text-xl font-bold text-slate-900 sm:text-2xl">{bill.title}</h1>
		<div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
			{#if bill.externalId}
				<span class="font-mono text-slate-500">{bill.externalId}</span>
			{/if}
			<span class="rounded-full px-2.5 py-0.5 text-xs font-medium {statusColor}" aria-label="Bill status: {bill.status}">
				{bill.status}
			</span>
			{#if bill.chamber}
				<span class="text-slate-400">{bill.chamber}</span>
			{/if}
			{#if bill.jurisdiction}
				<span class="text-slate-400">{bill.jurisdiction}</span>
			{/if}
		</div>
	</div>

	<!-- Decision Maker -->
	<section class="mb-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="dm-heading">
		<h2 id="dm-heading" class="mb-1 text-sm font-medium text-slate-500">Decision Maker</h2>
		<p class="text-lg font-semibold text-slate-900">{r.dmName}</p>
		{#if r.bioguideId}
			<p class="mt-0.5 font-mono text-xs text-slate-400">{r.bioguideId}</p>
		{/if}
	</section>

	<!-- Proof Strength -->
	<section class="mb-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="proof-heading">
		<h2 id="proof-heading" class="mb-3 text-sm font-medium text-slate-500">Proof Strength</h2>

		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
			<div>
				<p class="text-xs text-slate-400">Verified Constituents</p>
				<p class="text-lg font-semibold text-slate-900">
					{r.verifiedCount !== null ? r.verifiedCount.toLocaleString('en-US') : '< 5'}
				</p>
			</div>
			<div>
				<p class="text-xs text-slate-400">Districts</p>
				<p class="text-lg font-semibold text-slate-900">
					{r.districtCount !== null ? r.districtCount : '< 3'}
				</p>
			</div>
			<div>
				<p class="text-xs text-slate-400">Total Signers</p>
				<p class="text-lg font-semibold text-slate-900">
					{r.totalCount !== null ? r.totalCount.toLocaleString('en-US') : '< 5'}
				</p>
			</div>
		</div>

		<!-- Proof Weight Bar -->
		<div class="mt-4">
			<div class="mb-1 flex items-center justify-between">
				<span class="text-xs text-slate-400">Proof Weight</span>
				<span class="text-xs font-medium text-slate-600">{(r.proofWeight * 100).toFixed(0)}%</span>
			</div>
			<div class="h-2 w-full rounded-full bg-slate-100" role="progressbar" aria-valuenow={r.proofWeight * 100} aria-valuemin={0} aria-valuemax={100} aria-label="Proof weight">
				<div
					class="h-2 rounded-full bg-green-500 transition-all"
					style="width: {Math.min(r.proofWeight * 100, 100)}%"
				></div>
			</div>
		</div>

		<!-- Coordination Integrity -->
		{#if r.gds !== null || r.ald !== null || r.cai !== null}
			<div class="mt-4 border-t border-slate-100 pt-3">
				<p class="mb-2 text-xs text-slate-400">Coordination Integrity</p>
				<div class="grid grid-cols-3 gap-3">
					<div>
						<p class="text-xs text-slate-500">GDS</p>
						<p class="font-mono text-sm font-medium text-slate-700">{pct(r.gds)}</p>
					</div>
					<div>
						<p class="text-xs text-slate-500">ALD</p>
						<p class="font-mono text-sm font-medium text-slate-700">{pct(r.ald)}</p>
					</div>
					<div>
						<p class="text-xs text-slate-500">CAI</p>
						<p class="font-mono text-sm font-medium text-slate-700">{pct(r.cai)}</p>
					</div>
				</div>
			</div>
		{/if}
	</section>

	<!-- Action -->
	<section class="mb-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="action-heading">
		<h2 id="action-heading" class="mb-3 text-sm font-medium text-slate-500">Decision Maker Action</h2>
		<div class="flex items-center gap-3">
			<span class="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-800">
				{actionLabel}
			</span>
			{#if r.actionOccurredAt}
				<span class="text-sm text-slate-500">{formatDate(r.actionOccurredAt)}</span>
			{/if}
		</div>
		{#if r.actionSourceUrl}
			<a
				href={r.actionSourceUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
			>
				View source <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
			</a>
		{/if}
	</section>

	<!-- Accountability -->
	<section class="mb-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="accountability-heading">
		<h2 id="accountability-heading" class="mb-3 text-sm font-medium text-slate-500">Accountability</h2>

		<div class="mb-3 flex flex-wrap items-center gap-3">
			<div>
				<p class="text-xs text-slate-400">Alignment</p>
				<p class="text-sm font-semibold {alignmentLabel.color}">
					{alignmentLabel.text}
					<span class="font-mono text-xs font-normal text-slate-400">({r.alignment.toFixed(2)})</span>
				</p>
			</div>
			<div>
				<p class="text-xs text-slate-400">Causality</p>
				<span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium {causalityColor}" aria-label="Causality class: {r.causalityClass}">
					{r.causalityClass}
				</span>
			</div>
		</div>

		<p class="text-sm leading-relaxed text-slate-700">{r.narrative}</p>
	</section>

	<!-- Timeline -->
	<section class="mb-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="timeline-heading">
		<h2 id="timeline-heading" class="mb-3 text-sm font-medium text-slate-500">Timeline</h2>
		<dl class="space-y-2 text-sm">
			<div class="flex justify-between">
				<dt class="text-slate-500">Proof Delivered</dt>
				<dd class="font-medium text-slate-700">{formatDate(r.proofDeliveredAt)}</dd>
			</div>
			<div class="flex justify-between">
				<dt class="text-slate-500">Proof Verified</dt>
				<dd class="font-medium text-slate-700">{formatDate(r.proofVerifiedAt)}</dd>
			</div>
			<div class="flex justify-between">
				<dt class="text-slate-500">Action Occurred</dt>
				<dd class="font-medium text-slate-700">{formatDate(r.actionOccurredAt)}</dd>
			</div>
		</dl>
	</section>

	<!-- Attestation & Anchor -->
	<section class="mb-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="attestation-heading">
		<h2 id="attestation-heading" class="mb-3 text-sm font-medium text-slate-500">Cryptographic Attestation</h2>
		<div class="flex items-center gap-2">
			<code class="flex-1 truncate rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
				{r.attestationDigest}
			</code>
			<button
				onclick={copyDigest}
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600"
				aria-label="Copy attestation digest"
			>
				{#if copied}
					<Check class="h-4 w-4 text-green-500" />
				{:else}
					<Copy class="h-4 w-4" />
				{/if}
			</button>
		</div>
		{#if r.anchorCid}
			<div class="mt-3">
				<p class="mb-1 text-xs text-slate-400">IPFS Anchor</p>
				<a
					href="https://dweb.link/ipfs/{r.anchorCid}"
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:text-blue-800"
				>
					{r.anchorCid.slice(0, 16)}...{r.anchorCid.slice(-8)}
					<ExternalLink class="h-3 w-3" aria-hidden="true" />
				</a>
			</div>
		{/if}
	</section>

	<div class="text-center">
		<a href="/" class="text-sm text-slate-500 underline hover:text-slate-700">
			Back to Commons
		</a>
	</div>
</div>
