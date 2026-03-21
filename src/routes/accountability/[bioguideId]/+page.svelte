<script lang="ts">
	import {
		ShieldCheck,
		ChevronDown,
		ChevronUp,
		ExternalLink,
		Scale,
		Users,
		FileText,
		TrendingUp,
		Weight,
		Link2
	} from '@lucide/svelte';

	let { data } = $props();

	let expandedBills = $state<Set<string>>(new Set());

	function toggleBill(billId: string) {
		const next = new Set(expandedBills);
		if (next.has(billId)) {
			next.delete(billId);
		} else {
			next.add(billId);
		}
		expandedBills = next;
	}

	function scoreColor(score: number): string {
		if (score >= 67) return 'text-green-700 bg-green-100 border-green-300';
		if (score >= 34) return 'text-amber-700 bg-amber-100 border-amber-300';
		return 'text-red-700 bg-red-100 border-red-300';
	}

	function scoreLabel(score: number): string {
		if (score >= 67) return 'High';
		if (score >= 34) return 'Mixed';
		return 'Low';
	}

	function alignmentIcon(alignment: number): { symbol: string; class: string; label: string } {
		if (alignment >= 0.5) return { symbol: '\u2713', class: 'text-green-700 bg-green-100', label: 'Aligned' };
		if (alignment <= -0.5) return { symbol: '\u2717', class: 'text-red-700 bg-red-100', label: 'Opposed' };
		return { symbol: '\u2014', class: 'text-slate-500 bg-slate-100', label: 'Neutral' };
	}

	function causalityBadge(cls: string): { label: string; class: string } {
		switch (cls) {
			case 'strong':
				return { label: 'Strong', class: 'bg-green-100 text-green-800 border-green-300' };
			case 'moderate':
				return { label: 'Moderate', class: 'bg-amber-100 text-amber-800 border-amber-300' };
			case 'weak':
				return { label: 'Weak', class: 'bg-slate-100 text-slate-600 border-slate-300' };
			default:
				return { label: 'Pending', class: 'bg-slate-50 text-slate-500 border-slate-200' };
		}
	}

	function formatAction(action: string | null): string {
		if (!action) return 'No action recorded';
		switch (action) {
			case 'voted_yes':
				return 'Voted Yes';
			case 'voted_no':
				return 'Voted No';
			case 'abstained':
				return 'Abstained';
			case 'sponsored':
				return 'Sponsored';
			case 'co-sponsored':
				return 'Co-sponsored';
			default:
				return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function proofWeightPercent(weight: number): number {
		// Normalize: proof weight of 1.0 = 100%, cap at 100
		return Math.min(Math.round(weight * 100), 100);
	}
</script>

<svelte:head>
	<title>Accountability Report: {data.dmName} — Commons</title>
	<meta property="og:title" content="Accountability Report: {data.dmName}" />
	<meta
		property="og:description"
		content="Proof-weighted accountability tracking across {data.summary.uniqueBills} bills"
	/>
	<meta property="og:type" content="profile" />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-12">
	<!-- Header -->
	<header class="mb-8 text-center">
		<div
			class="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100"
		>
			<ShieldCheck class="h-8 w-8 text-indigo-600" />
		</div>
		<h1 class="text-2xl font-bold text-slate-900">{data.dmName}</h1>
		<p class="mt-1 font-mono text-sm text-slate-500">{data.decisionMakerId}</p>
		<p class="mt-2 text-sm font-medium text-indigo-600">Accountability Report</p>
	</header>

	<!-- Summary Card -->
	<section
		class="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
		aria-label="Summary statistics"
	>
		<h2 class="sr-only">Summary</h2>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
			<!-- Accountability Score -->
			<div class="col-span-2 sm:col-span-1">
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">
					Accountability Score
				</div>
				<div class="mt-1 flex items-center gap-2">
					<span
						class="inline-flex items-center rounded-lg border px-3 py-1.5 text-2xl font-bold {scoreColor(
							data.summary.accountabilityScore
						)}"
						role="img"
						aria-label="{scoreLabel(data.summary.accountabilityScore)} accountability: {data
							.summary.accountabilityScore} out of 100"
					>
						{data.summary.accountabilityScore}
					</span>
					<span class="text-xs text-slate-400">/ 100</span>
				</div>
				<div class="mt-1 text-xs text-slate-500">
					{scoreLabel(data.summary.accountabilityScore)} alignment
				</div>
			</div>

			<!-- Total Receipts -->
			<div>
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">
					<span class="mr-1 inline-block"><FileText class="inline h-3.5 w-3.5" /></span>
					Receipts
				</div>
				<div class="mt-1 text-xl font-bold text-slate-900">
					{data.summary.totalReceipts}
				</div>
			</div>

			<!-- Verified Constituents -->
			<div>
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">
					<span class="mr-1 inline-block"><Users class="inline h-3.5 w-3.5" /></span>
					Verified
				</div>
				<div class="mt-1 text-xl font-bold text-slate-900">
					{#if data.summary.totalVerifiedConstituents !== null}
						{data.summary.totalVerifiedConstituents.toLocaleString('en-US')}
					{:else}
						<span
							class="text-sm font-normal text-slate-400"
							title="Suppressed for privacy (fewer than 5 verified constituents)"
							>suppressed</span
						>
					{/if}
				</div>
			</div>

			<!-- Bills Tracked -->
			<div>
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">
					<span class="mr-1 inline-block"><Scale class="inline h-3.5 w-3.5" /></span>
					Bills Tracked
				</div>
				<div class="mt-1 text-xl font-bold text-slate-900">
					{data.summary.uniqueBills}
				</div>
			</div>

			<!-- Causality Rate -->
			<div>
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">
					<span class="mr-1 inline-block"><TrendingUp class="inline h-3.5 w-3.5" /></span>
					Causality Rate
				</div>
				<div class="mt-1 text-xl font-bold text-slate-900">
					{Math.round(data.summary.causalityRate * 100)}%
				</div>
				<div class="text-xs text-slate-400">strong + moderate</div>
			</div>

			<!-- Avg Proof Weight -->
			<div>
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">
					<span class="mr-1 inline-block"><Weight class="inline h-3.5 w-3.5" /></span>
					Avg Proof Weight
				</div>
				<div class="mt-2">
					<div
						class="h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
						role="progressbar"
						aria-valuenow={proofWeightPercent(data.summary.avgProofWeight)}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-label="Average proof weight: {Math.round(data.summary.avgProofWeight * 100)}%"
					>
						<div
							class="h-full rounded-full bg-indigo-500 transition-all"
							style="width: {proofWeightPercent(data.summary.avgProofWeight)}%"
						></div>
					</div>
					<div class="mt-0.5 text-xs text-slate-500">
						{(data.summary.avgProofWeight * 100).toFixed(0)}%
					</div>
				</div>
			</div>
		</div>

	</section>

	<!-- Bills List -->
	<section aria-label="Bills tracked">
		<h2 class="mb-4 text-lg font-semibold text-slate-900">Bills</h2>

		{#each data.bills as billEntry (billEntry.bill.id)}
			{@const isExpanded = expandedBills.has(billEntry.bill.id)}
			{@const align = alignmentIcon(
				billEntry.receipts.reduce((s, r) => s + r.alignment, 0) / billEntry.receipts.length
			)}

			<div class="mb-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
				<!-- Bill Header (clickable) -->
				<button
					class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
					onclick={() => toggleBill(billEntry.bill.id)}
					aria-expanded={isExpanded}
				>
					<!-- Alignment indicator -->
					<span
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold {align.class}"
						aria-label={align.label}
					>
						{align.symbol}
					</span>

					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="truncate text-sm font-semibold text-slate-900">
								{billEntry.bill.title}
							</span>
							<span
								class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
							>
								{billEntry.bill.status}
							</span>
						</div>
						<div class="mt-1 flex items-center gap-3 text-xs text-slate-500">
							{#if billEntry.latestAction}
								<span>{formatAction(billEntry.latestAction)}</span>
							{/if}
							<span>{billEntry.receipts.length} receipt{billEntry.receipts.length !== 1 ? 's' : ''}</span>
							{#if billEntry.bill.jurisdiction}
								<span class="font-mono">{billEntry.bill.jurisdiction}</span>
							{/if}
						</div>

						<!-- Proof weight bar -->
						<div class="mt-1.5">
							<div
								class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
								role="progressbar"
								aria-valuenow={proofWeightPercent(billEntry.maxProofWeight)}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-label="Max proof weight: {Math.round(billEntry.maxProofWeight * 100)}%"
							>
								<div
									class="h-full rounded-full bg-indigo-400"
									style="width: {proofWeightPercent(billEntry.maxProofWeight)}%"
								></div>
							</div>
						</div>
					</div>

					<!-- Expand/collapse -->
					<span class="shrink-0 text-slate-400">
						{#if isExpanded}
							<ChevronUp class="h-4 w-4" />
						{:else}
							<ChevronDown class="h-4 w-4" />
						{/if}
					</span>
				</button>

				<!-- Expanded: individual receipts -->
				{#if isExpanded}
					<div class="border-t border-slate-100 bg-slate-50/50">
						<div class="overflow-x-auto">
							<table class="w-full text-xs">
								<thead>
									<tr class="border-b border-slate-200 text-left text-slate-500">
										<th class="px-4 py-2 font-medium">Delivered</th>
										<th class="px-4 py-2 font-medium">Weight</th>
										<th class="px-4 py-2 font-medium">Verified</th>
										<th class="px-4 py-2 font-medium">Causality</th>
										<th class="px-4 py-2 font-medium">Action</th>
										<th class="px-4 py-2 font-medium">
											<span class="sr-only">Verify</span>
										</th>
									</tr>
								</thead>
								<tbody>
									{#each billEntry.receipts as receipt (receipt.id)}
										{@const causality = causalityBadge(receipt.causalityClass)}
										<tr class="border-b border-slate-100 last:border-0">
											<td class="px-4 py-2 text-slate-700">
												{formatDate(receipt.proofDeliveredAt)}
											</td>
											<td class="px-4 py-2">
												<div class="flex items-center gap-1.5">
													<div class="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200">
														<div
															class="h-full rounded-full bg-indigo-500"
															style="width: {proofWeightPercent(receipt.proofWeight)}%"
														></div>
													</div>
													<span class="text-slate-600"
														>{(receipt.proofWeight * 100).toFixed(0)}%</span
													>
												</div>
											</td>
											<td class="px-4 py-2 text-slate-700">
												{#if receipt.verifiedCount !== null}
													{receipt.verifiedCount.toLocaleString('en-US')}
												{:else}
													<span class="text-slate-400" title="Suppressed for k-anonymity"
														>&lt; 5</span
													>
												{/if}
											</td>
											<td class="px-4 py-2">
												<span
													class="inline-block rounded border px-1.5 py-0.5 text-xs {causality.class}"
												>
													{causality.label}
												</span>
											</td>
											<td class="px-4 py-2 text-slate-700">
												{#if receipt.dmAction}
													{formatAction(receipt.dmAction)}
													{#if receipt.actionOccurredAt}
														<span class="text-slate-400">
															({formatDate(receipt.actionOccurredAt)})
														</span>
													{/if}
												{:else}
													<span class="text-slate-400">--</span>
												{/if}
											</td>
											<td class="px-4 py-2">
												<a
													href="/verify/receipt/{receipt.id}"
													class="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
													title="Verify receipt"
												>
													<Link2 class="h-3.5 w-3.5" />
												</a>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</section>

	<!-- Footer -->
	<footer class="mt-12 border-t border-slate-200 pt-6 text-center text-xs text-slate-500">
		<p>
			Data from <a href="/" class="font-medium text-indigo-600 hover:text-indigo-800">Commons</a>
			— Proof-weighted accountability for governance
		</p>
		<p class="mt-1">
			<a href="/" class="underline hover:text-slate-700">commons.email</a>
		</p>
	</footer>
</div>
