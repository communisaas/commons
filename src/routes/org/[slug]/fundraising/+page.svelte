<script lang="ts">
	import FundraiserCard from '$lib/components/fundraising/FundraiserCard.svelte';
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import { Datum, Ratio } from '$lib/design';
	import {
		buildFundraisingReadiness,
		getGateEvidence,
		type FundraisingReadinessRow,
		type FundraisingReceiptProofRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments
	} from '$lib/data/capability-state-labels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type CapabilityState = 'live' | 'partial' | 'draft-only' | 'gated';
	type CapabilityItem = {
		label: string;
		state: CapabilityState;
		phase: string;
		cluster: string;
		action: string;
		detail: string;
		unlock: string;
		href: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};
	type FundingReceiptProofPressureReadout = {
		id: string;
		label: string;
		state: CapabilityState;
		title: string;
		action: string;
		detail: string;
		gate: string;
		href: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	const base = $derived(`/org/${data.org.slug}`);
	const fundraiserCount = $derived(data.campaigns.length);
	const activeCount = $derived(
		data.campaigns.filter((campaign) => campaign.status === 'ACTIVE').length
	);
	const raisedAmountCents = $derived(
		data.campaigns.reduce((sum, campaign) => sum + campaign.raisedAmountCents, 0)
	);
	const donationCount = $derived(
		data.campaigns.reduce((sum, campaign) => sum + campaign.donorCount, 0)
	);
	const receiptPolicyCount = $derived(
		data.campaigns.filter((campaign) => campaign.receiptPolicyConfigured).length
	);
	const confirmationCompletedCount = $derived(data.confirmationSummary.completed);
	const confirmationSentCount = $derived(data.confirmationSummary.sent);
	const confirmationFailedCount = $derived(data.confirmationSummary.failed);
	const confirmationSkippedCount = $derived(data.confirmationSummary.skipped);
	const confirmationNotRecordedCount = $derived(data.confirmationSummary.notRecorded);
	const confirmationProviderAcceptedCount = $derived(data.confirmationSummary.providerAccepted);
	const confirmationAttemptedCount = $derived(
		confirmationSentCount +
			confirmationFailedCount +
			confirmationSkippedCount +
			confirmationNotRecordedCount
	);
	const confirmationOutcomeEvidenceObserved = $derived(
		confirmationCompletedCount > 0 ||
			confirmationAttemptedCount > 0 ||
			confirmationProviderAcceptedCount > 0
	);
	const receiptBoundaryEvidenceLabel = $derived(
		confirmationOutcomeEvidenceObserved
			? 'Donor confirmation outcome evidence'
			: 'Donation receipt boundary evidence'
	);
	const fundraiserRecordGate = getGateEvidence('CP-coordination-integrity', ['T10-10'], {
		name: 'Fundraiser record integrity',
		downstream: 1,
		dependency: 'Saved record integrity + packet-local coordination metrics'
	});
	const emailProxyGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Donor confirmation email delivery',
		dependency: 'SES configuration + proxy-backed email delivery'
	});
	const donationReceiptGate = getGateEvidence('CP-donation-receipt-compliance', ['T6-1', 'T6-2'], {
		name: 'Donation receipt compliance',
		downstream: 4,
		dependency: 'Receipt policy workflow + mainnet anchoring'
	});
	const fundraisingReadiness = $derived(
		buildFundraisingReadiness({
			base,
			fundraising: {
				enabled: true,
				loaded: true,
				fundraiserCount,
				activeCount,
				raisedAmountCents,
				donationCount,
				receiptPolicyCount,
				confirmationCompleted: confirmationCompletedCount,
				confirmationSent: confirmationSentCount,
				confirmationAttempted: confirmationAttemptedCount,
				confirmationProviderAccepted: confirmationProviderAcceptedCount
			},
			gates: {
				fundraiserRecordGate,
				donationConfirmationGate: emailProxyGate,
				donationReceiptGate
			}
		})
	);
	const fundraisingRows = $derived<FundraisingReadinessRow[]>(fundraisingReadiness.rows);
	const capabilityItems = $derived<CapabilityItem[]>(
		fundraisingRows.map((row) => ({
			label: row.label,
			state: row.state,
			phase: row.phase,
			cluster: row.clusters,
			action: row.action,
			detail: row.ground,
			unlock: row.boundary,
			href:
				row.id === 'fundraiser-record' || row.id === 'public-donation-page'
					? '#fundraiser-records'
					: row.href,
			metric: row.metric
		}))
	);
	const fundraisingReceiptProofRows = $derived<FundraisingReceiptProofRow[]>(
		fundraisingReadiness.proofRows
	);
	const fundingGroundProofRow = $derived(
		fundraisingReceiptProofRows.find((row) => row.id === 'fundraiser-record-ground') ?? null
	);
	const confirmationRegisterProofRow = $derived(
		fundraisingReceiptProofRows.find((row) => row.id === 'confirmation-outcome-register') ?? null
	);
	const taxAnchoringProofRow = $derived(
		fundraisingReceiptProofRows.find((row) => row.id === 'tax-anchoring-boundary') ?? null
	);
	const heldFundingReceiptProofRows = $derived(
		fundraisingReceiptProofRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const nextReceiptLiftProofRow = $derived(
		taxAnchoringProofRow?.state === 'live'
			? (heldFundingReceiptProofRows[0] ?? taxAnchoringProofRow)
			: (taxAnchoringProofRow ?? heldFundingReceiptProofRows[0] ?? null)
	);
	const fundingReceiptProofPressureReadouts = $derived<FundingReceiptProofPressureReadout[]>([
		{
			id: 'funding-ground',
			label: 'Funding ground',
			state: fundingGroundProofRow?.state ?? fundraisingReadiness.state,
			title: fundingGroundProofRow?.handoff ?? fundraisingReadiness.handoff,
			action: fundingGroundProofRow?.action ?? fundraisingReadiness.action,
			detail: fundingGroundProofRow?.effect ?? fundraisingReadiness.signal,
			gate: fundingGroundProofRow?.gate ?? fundraisingReadiness.gate,
			href: fundingGroundProofRow?.href ?? '#fundraiser-records',
			metric: fundingGroundProofRow?.metric ?? fundraisingReadiness.metric
		},
		{
			id: 'confirmation-register',
			label: 'Confirmation register',
			state: confirmationRegisterProofRow?.state ?? fundraisingReadiness.state,
			title: confirmationRegisterProofRow?.handoff ?? 'Donor confirmation outcome',
			action: confirmationRegisterProofRow?.action ?? 'read confirmation boundary',
			detail:
				confirmationRegisterProofRow?.effect ??
				'Confirmation outcomes begin only after completed donation rows exist.',
			gate:
				confirmationRegisterProofRow?.gate ??
				'Confirmation outcomes are transactional donor evidence only.',
			href: confirmationRegisterProofRow?.href ?? '#fundraising-receipt-boundary',
			metric: confirmationRegisterProofRow?.metric ?? {
				value: confirmationSentCount,
				label: 'confirmations sent',
				cite: 'donations.getConfirmationSummary'
			}
		},
		{
			id: 'next-receipt-lift',
			label: 'Next receipt lift',
			state: nextReceiptLiftProofRow?.state ?? fundraisingReadiness.state,
			title: nextReceiptLiftProofRow?.handoff ?? fundraisingReadiness.nextGate.name,
			action: nextReceiptLiftProofRow?.action ?? 'read receipt boundary',
			detail:
				nextReceiptLiftProofRow?.effect ??
				'Tax acknowledgment and anchored receipt proof remain outside baseline confirmations.',
			gate: nextReceiptLiftProofRow?.gate ?? fundraisingReadiness.gate,
			href: nextReceiptLiftProofRow?.href ?? '#fundraising-receipt-boundary',
			metric: nextReceiptLiftProofRow?.metric ?? {
				value: fundraisingReadiness.nextGate.downstream,
				label: 'downstream gates',
				cite: fundraisingReadiness.nextGate.id
			}
		}
	]);
	const fundraisingReceiptProofStateCounts = $derived(
		fundraisingReceiptProofRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const fundraisingReceiptProofSegments = $derived(
		operatorCapabilityStateRatioSegments(fundraisingReceiptProofStateCounts, {
			labelSuffix: ' receipt proof rows'
		})
	);
	const heldFundraisingReceiptProofCount = $derived(
		fundraisingReceiptProofStateCounts['draft-only'] + fundraisingReceiptProofStateCounts.gated
	);

	function stateLabel(state: CapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function actionLabel(state: CapabilityState, action: string): string {
		return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });
	}

	function pressureCellClass(state: CapabilityState): string {
		const stateClass =
			state === 'live'
				? 'border-teal-500/35 bg-teal-500/10'
				: state === 'partial'
					? 'border-blue-500/30 bg-blue-500/10'
					: state === 'draft-only'
						? 'border-amber-500/30 bg-amber-500/10'
						: 'border-surface-border-strong bg-surface-overlay';
		return `rounded-md border p-3 text-left transition hover:border-text-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 ${stateClass}`;
	}
</script>

<svelte:head>
	<title>Fundraising records | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<nav class="text-text-tertiary mb-3 flex items-center gap-2 text-sm">
					<a href="/org/{data.org.slug}/studio" class="hover:text-text-secondary transition-colors">
						Studio
					</a>
					<span aria-hidden="true">/</span>
					<span>Fundraising records</span>
				</nav>
				<h1 class="text-text-primary text-xl font-semibold">Fundraising records</h1>
				<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
					Use fundraising as a SEND mode for donation intake and donor confirmation. Money movement
					is live; tax and anchored receipt claims stay qualified.
				</p>
			</div>
			<a
				href="/org/{data.org.slug}/fundraising/new"
				class="bg-surface-overlay text-text-primary hover:bg-surface-base rounded-md px-4 py-2 text-sm font-semibold transition-colors"
			>
				Create fundraiser
			</a>
		</div>

		<WorkspaceCapabilityStrip label="Fundraising capability" items={capabilityItems} />

		<section
			id="fundraising-receipt-proof-contract"
			class="border-surface-border bg-surface-base rounded-md border p-4"
			aria-labelledby="fundraising-receipt-proof-title"
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p class="text-text-tertiary text-xs font-semibold tracking-[0.18em] uppercase">
						Funding receipt proof
					</p>
					<h2
						id="fundraising-receipt-proof-title"
						class="text-text-primary mt-1 text-lg font-semibold"
					>
						What must be true before donation evidence becomes receipt posture
					</h2>
				</div>
				<div
					class="bg-surface-overlay min-w-48 rounded-md px-4 py-3 text-right"
					aria-label={`${fundraisingReceiptProofRows.length} receipt proof rows; ${fundraisingReceiptProofStateCounts.live} armed; ${fundraisingReceiptProofStateCounts.partial} bounded; ${heldFundraisingReceiptProofCount} held`}
				>
					<p class="text-text-primary text-xl leading-none font-semibold">
						<Datum
							value={fundraisingReceiptProofRows.length}
							cite="buildFundraisingReadiness proofRows"
						/>
					</p>
					<p class="text-text-tertiary mt-1 text-xs">
						proof rows ·
						<Datum
							value={fundraisingReceiptProofStateCounts.partial}
							cite="funding receipt proof contract"
						/>
						bounded
					</p>
				</div>
			</div>
			<div class="mt-4">
				<Ratio segments={fundraisingReceiptProofSegments} height={8} />
			</div>
			<div class="mt-4 grid gap-3 md:grid-cols-3" aria-label="Funding receipt proof pressure">
				{#each fundingReceiptProofPressureReadouts as readout (readout.id)}
					<a
						href={readout.href}
						class={pressureCellClass(readout.state)}
						data-sveltekit-preload-data="off"
						aria-label={`${readout.label}: ${stateLabel(readout.state)}; ${readout.detail}; ${readout.gate}`}
					>
						<span
							class="text-text-quaternary block font-mono text-[0.65rem] tracking-[0.18em] uppercase"
							>{readout.label}</span
						>
						<span class="text-text-primary mt-2 block text-sm font-semibold">{readout.title}</span>
						<span class="text-text-secondary mt-2 flex items-baseline gap-1 text-xs">
							<Datum value={readout.metric.value} cite={readout.metric.cite} />
							<span>{readout.metric.label}</span>
						</span>
						<span class="text-text-tertiary mt-2 block text-xs leading-relaxed">
							{readout.detail}
						</span>
						<span class="mt-3 block text-xs font-semibold text-teal-300">
							{actionLabel(readout.state, readout.action)}
						</span>
						<span class="text-text-quaternary mt-2 block text-xs leading-relaxed">
							{readout.gate}
						</span>
					</a>
				{/each}
			</div>
			<div class="mt-4 grid gap-2" aria-label="Funding receipt proof contract">
				{#each fundraisingReceiptProofRows as row (row.id)}
					<a
						href={row.href}
						class="border-surface-border hover:border-surface-border-strong grid gap-3 rounded-md border px-3 py-3 text-sm transition md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.15fr)_minmax(0,1.1fr)_8rem]"
						data-sveltekit-preload-data="off"
					>
						<span class="min-w-0">
							<span class="text-text-primary block font-medium">{row.label}</span>
							<span class="text-text-tertiary mt-1 block text-xs">{row.handoff}</span>
						</span>
						<span class="text-text-secondary text-xs font-semibold uppercase"
							>{stateLabel(row.state)}</span
						>
						<span class="text-text-tertiary">{row.effect}</span>
						<span class="text-text-secondary text-xs">{row.gate}</span>
						<span class="text-text-secondary text-xs">
							<Datum value={row.metric.value} cite={row.metric.cite} />
							{row.metric.label}
						</span>
					</a>
				{/each}
			</div>
		</section>

		<div
			id="fundraising-receipt-boundary"
			class="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3"
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div class="max-w-2xl">
					<p class="text-sm font-medium text-amber-300">Confirmation and receipt boundary</p>
					<p class="text-text-tertiary mt-1 text-sm">
						Stripe completion can schedule a baseline email confirmation. It is not an IRS
						charitable acknowledgment, not a decision-maker accountability receipt, and not
						Merkle-anchored.
					</p>
				</div>
				<div
					class="w-full min-w-0 text-center sm:min-w-[320px] lg:w-auto"
					aria-label={receiptBoundaryEvidenceLabel}
				>
					{#if confirmationOutcomeEvidenceObserved}
						<div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
							<div>
								<p class="font-mono text-sm font-bold text-teal-300">
									<Datum
										value={confirmationSentCount}
										cite="donations.getConfirmationSummary.sent"
									/>
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">sent</p>
							</div>
							<div>
								<p class="font-mono text-sm font-bold text-red-300">
									<Datum
										value={confirmationFailedCount}
										cite="donations.getConfirmationSummary.failed"
									/>
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">failed</p>
							</div>
							<div>
								<p class="font-mono text-sm font-bold text-amber-300">
									<Datum
										value={confirmationSkippedCount}
										cite="donations.getConfirmationSummary.skipped"
									/>
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">skipped</p>
							</div>
							<div>
								<p class="text-text-tertiary font-mono text-sm font-bold">
									<Datum
										value={confirmationNotRecordedCount}
										cite="donations.getConfirmationSummary.notRecorded"
									/>
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">untracked</p>
							</div>
							<div>
								<p class="font-mono text-sm font-bold text-blue-300">
									<Datum
										value={confirmationProviderAcceptedCount}
										cite="donations.confirmationEmailProviderMessageId"
									/>
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">provider accepted</p>
							</div>
							<div class="col-span-2 border-t border-amber-500/20 pt-2 sm:col-span-5">
								<p class="text-text-tertiary font-mono text-sm font-bold">
									<Datum value={receiptPolicyCount} cite="campaigns.donationReceiptPolicy" />
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">receipt policy register</p>
							</div>
						</div>
					{:else}
						<div class="grid gap-2 sm:grid-cols-3">
							<div>
								<p class="text-text-tertiary font-mono text-sm font-bold">
									<Datum
										value={confirmationCompletedCount}
										cite="donations.getConfirmationSummary.completed"
									/>
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">completed rows</p>
							</div>
							<div>
								<p class="text-text-tertiary font-mono text-sm font-bold">
									<Datum value={receiptPolicyCount} cite="campaigns.donationReceiptPolicy" />
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">policy custody</p>
							</div>
							<div>
								<p class="text-text-tertiary font-mono text-sm font-bold">
									<Datum
										value={heldFundraisingReceiptProofCount}
										cite="buildFundraisingReadiness proofRows"
									/>
								</p>
								<p class="text-text-quaternary text-[0.65rem] uppercase">held proof rows</p>
							</div>
						</div>
						<p class="text-text-quaternary mt-2 text-xs">
							Confirmation outcome counters stay hidden until completed donation rows or provider
							acceptance evidence exist, so empty fundraising cannot read as a zero-send receipt
							register.
						</p>
					{/if}
				</div>
			</div>
		</div>

		{#if data.campaigns.length === 0}
			<div class="border-surface-border bg-surface-base rounded-md border py-14 text-center">
				<p class="text-text-primary text-base font-medium">No fundraising records yet.</p>
				<p class="text-text-tertiary mt-1 text-sm">
					Create a draft first, then publish it when the public donation page should accept money.
				</p>
				<a
					href="/org/{data.org.slug}/fundraising/new"
					class="bg-surface-overlay text-text-primary hover:bg-surface-raised mt-4 inline-block rounded-md px-4 py-2 text-sm font-semibold transition-colors"
				>
					Create fundraiser
				</a>
			</div>
		{:else}
			<div id="fundraiser-records" class="space-y-3">
				<div class="grid gap-3 sm:grid-cols-4">
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							{fundraiserCount}
						</p>
						<p class="text-text-tertiary text-xs">records</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">{activeCount}</p>
						<p class="text-text-tertiary text-xs">active</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							{donationCount}
						</p>
						<p class="text-text-tertiary text-xs">completed donations</p>
					</div>
					<div class="border-surface-border bg-surface-base rounded-md border p-3">
						<p class="text-text-primary font-mono text-lg font-bold tabular-nums">
							{raisedAmountCents}
						</p>
						<p class="text-text-tertiary text-xs">cents raised</p>
					</div>
				</div>

				{#each data.campaigns as campaign (campaign.id)}
					<a href="/org/{data.org.slug}/fundraising/{campaign.id}" class="block">
						<FundraiserCard {campaign} />
					</a>
				{/each}
			</div>
		{/if}
	</div>
</div>
