<script lang="ts">
	import { ShieldCheck, ExternalLink, Copy, Check, ChevronRight } from '@lucide/svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const r = $derived(data.receipt);
	const bill = $derived(data.bill);
	const billTitle = $derived(bill?.title ?? 'Unknown bill');
	const billStatus = $derived(bill?.status ?? 'unknown');

	// Status badge colors
	const statusColor = $derived.by(() => {
		switch (billStatus) {
			case 'passed': return 'bg-green-100 text-green-800';
			case 'failed': return 'bg-red-100 text-red-800';
			case 'floor': return 'bg-yellow-100 text-yellow-800';
			case 'committee': return 'bg-blue-100 text-blue-800';
			default: return 'bg-slate-100 text-slate-700';
		}
	});

	// Causality and alignment are INFERENCES from public records (the
	// scope section explicitly says so), not editorial judgments by the
	// substrate. Colored chips would imply substrate-issued approval. Per
	// design memory ("registry, not celebration"; "metrics are
	// infrastructure not headlines") the chips are uniformly slate — they
	// retain category as text but don't signal editorial color. Color is
	// reserved for genuinely categorical state (bill status).
	const causalityColor = $derived('bg-slate-100 text-slate-700');

	// Alignment display
	const alignmentLabel = $derived.by(() => {
		if (r.alignment > 0.3) return { text: 'Aligned', color: 'text-slate-700' };
		if (r.alignment < -0.3) return { text: 'Opposed', color: 'text-slate-700' };
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
	<meta name="description" content="Accountability receipt for {r.dmName} on {billTitle}" />
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-12">
	<!-- Header -->
	<!--
		Header uses slate registry voice rather than celebratory green.
		The "Verified" prefix is omitted because the receipt itemizes its
		verifications below — naming verification at the top is both
		redundant (the body proves it) and celebratory; the design memory
		retired the celebration register in favor of the registry voice.
	-->
	<div class="mb-8">
		<div class="mb-3 flex items-center gap-2">
			<div class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
				<ShieldCheck class="h-5 w-5 text-slate-500" aria-hidden="true" />
			</div>
			<span class="text-sm font-medium text-slate-700">Accountability receipt</span>
		</div>
		<h1 class="text-xl font-bold text-slate-900 sm:text-2xl">{billTitle}</h1>
		<div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
			{#if bill?.externalId}
				<span class="font-mono text-slate-500">{bill.externalId}</span>
			{/if}
			<span class="rounded-full px-2.5 py-0.5 text-xs font-medium {statusColor}" aria-label="Bill status: {billStatus}">
				{billStatus}
			</span>
			{#if bill?.chamber}
				<span class="text-slate-400">{bill.chamber}</span>
			{/if}
			{#if bill?.jurisdiction}
				<span class="text-slate-400">{bill.jurisdiction}</span>
			{/if}
		</div>
	</div>

	<!-- Decision Maker -->
	<section class="mb-6 rounded-lg border border-slate-200 bg-white p-5" aria-labelledby="dm-heading">
		<h2 id="dm-heading" class="mb-1 text-sm font-medium text-slate-500">Decision Maker</h2>
		<p class="text-lg font-semibold text-slate-900">{r.dmName}</p>
		{#if r.decisionMakerId}
			<p class="mt-0.5 font-mono text-xs text-slate-400">{r.decisionMakerId}</p>
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
		<!--
			Proof Weight rendered honestly. A green-500 fill would make an
			aggregate of audit signals (the same signals hidden behind
			<details> below as infrastructure) read as a celebratory
			headline. Per design memory "metrics are infrastructure not
			headlines", the fill is neutral slate-700 — present as a
			numeric reading, not an editorial judgment of "more = greener
			= better".
		-->
		<div class="mt-4">
			<div class="mb-1 flex items-center justify-between">
				<span class="text-xs text-slate-500">Proof Weight</span>
				<span class="text-xs font-medium text-slate-600">{(r.proofWeight * 100).toFixed(0)}%</span>
			</div>
			<div class="h-2 w-full rounded-full bg-slate-100" role="progressbar" aria-valuenow={r.proofWeight * 100} aria-valuemin={0} aria-valuemax={100} aria-label="Proof weight">
				<div
					class="h-2 rounded-full bg-slate-700 transition-all"
					style="width: {Math.min(r.proofWeight * 100, 100)}%"
				></div>
			</div>
		</div>

		<!--
			Coordination-integrity audit metrics. Per design memory:
			"tiers/metrics are infrastructure not headlines." These are
			anti-coordination-fraud audit signals (GDS = geographic
			spread, ALD = author independence, CAI = tier-mix
			authenticity) — they belong in an audit-on-demand
			disclosure, not the consumer headline. Consumers who want
			to verify the substrate can open the disclosure or read
			the full methodology at /about/integrity.
		-->
		{#if r.gds !== null || r.ald !== null || r.cai !== null}
			<details class="group mt-4 border-t border-slate-100 pt-3">
				<summary
					class="flex cursor-pointer list-none items-center gap-2 rounded text-xs text-slate-500 transition-colors hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
				>
					<ChevronRight class="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
					<span>Audit details</span>
				</summary>
				<div class="mt-3 grid grid-cols-3 gap-3">
					<div>
						<p class="text-xs text-slate-500">
							Geographic spread
							<span class="ml-1 font-mono text-xs uppercase tracking-wider text-slate-500">GDS</span>
						</p>
						<p class="mt-0.5 font-mono text-sm font-medium text-slate-700">{pct(r.gds)}</p>
					</div>
					<div>
						<p class="text-xs text-slate-500">
							Author independence
							<span class="ml-1 font-mono text-xs uppercase tracking-wider text-slate-500">ALD</span>
						</p>
						<p class="mt-0.5 font-mono text-sm font-medium text-slate-700">{pct(r.ald)}</p>
					</div>
					<div>
						<p class="text-xs text-slate-500">
							Tier-mix authenticity
							<span class="ml-1 font-mono text-xs uppercase tracking-wider text-slate-500">CAI</span>
						</p>
						<p class="mt-0.5 font-mono text-sm font-medium text-slate-700">{pct(r.cai)}</p>
					</div>
				</div>
				<p class="mt-3 text-xs text-slate-500">
					<a href="/about/integrity" class="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500">
						How these are computed →
					</a>
				</p>
			</details>
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

	<!--
		Honest scope. The page is named "Accountability Receipt" and
		correlates a constituent message with a legislator's later
		action. It is not a read-receipt: CWC has no acknowledgement
		channel and Congressional staff have no API to confirm a
		message was opened. The substrate proves delivery to the
		correct office and a verifiable record of the constituent's
		identity tier. Whether the legislator read or acted because
		of the message is observed via votes/sponsorships, not
		guaranteed by the receipt. Naming this here so the second-time
		user does not conclude the receipt is theatre.
	-->
	<section class="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-5" aria-labelledby="scope-heading">
		<h2 id="scope-heading" class="mb-3 text-sm font-medium text-slate-700">What this receipt proves</h2>
		<!-- Registry voice — facts about the artifact, not facts about
		     the reader. Serves the staffer and the org admin reading
		     the permalink without pronoun-swapping in their head. -->
		<ul class="list-disc space-y-1.5 pl-5 text-sm text-slate-600 marker:text-slate-700">
			<li>Message delivered to {r.dmName}'s office.</li>
			<li>Identity tier and constituency recorded at time of send and verifiable on the substrate.</li>
			<li>Later action on this bill recorded against the timeline above.</li>
		</ul>
		<h2 class="mt-4 mb-2 text-sm font-medium text-slate-500">What it does not prove</h2>
		<p class="text-sm leading-relaxed text-slate-600">
			Congressional offices do not return read-receipts. The receipt cannot
			confirm a staffer opened, read, or acted because of the message —
			only that the message arrived and the official acted. Alignment and
			causality above are inferences from public records, not guarantees.
		</p>
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
