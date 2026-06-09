<script lang="ts">
	import DonationMetrics from '$lib/components/fundraising/DonationMetrics.svelte';
	import DonorTable from '$lib/components/fundraising/DonorTable.svelte';
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
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
	import { Datum, Ratio } from '$lib/design';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

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

	const statusColors: Record<string, string> = {
		DRAFT: 'border-surface-border-strong bg-surface-overlay text-text-secondary',
		ACTIVE: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
		COMPLETE: 'border-blue-500/30 bg-blue-500/10 text-blue-300'
	};

	const isActive = $derived(data.campaign.status === 'ACTIVE');
	const base = $derived(`/org/${data.org.slug}`);
	const publicHref = $derived(`/d/${data.campaign.id}`);
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
	const receiptPolicy = $derived(data.campaign.donationReceiptPolicy);
	const receiptPolicyConfigured = $derived(Boolean(receiptPolicy));
	const receiptPolicyLabel = $derived(
		receiptPolicy?.mode === 'tax_acknowledgment_policy'
			? 'Tax acknowledgment policy'
			: receiptPolicy?.mode === 'confirmation_only'
				? 'Confirmation only'
				: 'No saved receipt policy'
	);
	const fundraiserRecordGate = getGateEvidence('CP-coordination-integrity', ['T10-10'], {
		name: 'Fundraiser record integrity',
		downstream: 1,
		dependency: 'Saved record integrity + packet-local coordination metrics'
	});
	const donationConfirmationGate = getGateEvidence('CP-donation-confirmation', ['T1-4'], {
		name: 'Donation confirmation outcome register',
		downstream: 1,
		dependency: 'Donation completion webhook + SES configuration + org-key decrypt'
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
				fundraiserCount: 1,
				activeCount: isActive ? 1 : 0,
				raisedAmountCents: data.campaign.raisedAmountCents,
				donationCount: data.campaign.donorCount,
				receiptPolicyCount: receiptPolicyConfigured ? 1 : 0,
				confirmationCompleted: confirmationCompletedCount,
				confirmationSent: confirmationSentCount,
				confirmationAttempted: confirmationAttemptedCount,
				confirmationProviderAccepted: confirmationProviderAcceptedCount
			},
			gates: {
				fundraiserRecordGate,
				donationConfirmationGate,
				donationReceiptGate
			}
		})
	);
	const fundraisingRows = $derived<FundraisingReadinessRow[]>(
		fundraisingReadiness.rows.map((row) => ({
			...row,
			href:
				row.id === 'fundraiser-record'
					? '#fundraiser-record'
					: row.id === 'public-donation-page'
						? isActive
							? publicHref
							: '#fundraiser-publication'
						: row.id === 'stripe-checkout'
							? '#fundraiser-checkout-boundary'
							: row.id === 'donor-confirmation' ||
								  row.id === 'provider-send-evidence' ||
								  row.id === 'receipt-policy-register' ||
								  row.id === 'tax-anchored-receipts'
								? '#fundraiser-receipt-boundary'
								: row.href
		}))
	);
	const capabilityItems = $derived<CapabilityItem[]>(
		fundraisingRows.map((row) => ({
			label: row.label,
			state: row.state,
			phase: row.phase,
			cluster: row.clusters,
			action: row.action,
			detail: row.ground,
			unlock: row.boundary,
			href: row.href,
			metric: row.metric
		}))
	);
	const fundraisingReceiptProofRows = $derived<FundraisingReceiptProofRow[]>(
		fundraisingReadiness.proofRows.map((row) => ({
			...row,
			href:
				row.id === 'fundraiser-record-ground'
					? '#fundraiser-record'
					: row.id === 'public-intake-scope'
						? '#fundraiser-publication'
						: row.id === 'payment-provider-handoff' || row.id === 'webhook-completion'
							? '#fundraiser-checkout-boundary'
							: row.id === 'confirmation-outcome-register' ||
								  row.id === 'provider-send-acceptance' ||
								  row.id === 'receipt-policy-custody' ||
								  row.id === 'tax-anchoring-boundary'
								? '#fundraiser-receipt-boundary'
								: row.href
		}))
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
			href: fundingGroundProofRow?.href ?? '#fundraiser-record',
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
			href: confirmationRegisterProofRow?.href ?? '#fundraiser-receipt-boundary',
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
			href: nextReceiptLiftProofRow?.href ?? '#fundraiser-receipt-boundary',
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

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(iso));
	}
</script>

<svelte:head>
	<title>{data.campaign.title} | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<a
			href="/org/{data.org.slug}/fundraising"
			class="text-text-tertiary hover:text-text-primary inline-block text-sm"
		>
			Fundraising records / back
		</a>

		<div id="fundraiser-record" class="flex flex-wrap items-start justify-between gap-4">
			<div class="min-w-0">
				<div class="mb-2 flex items-center gap-3">
					<h1 class="text-text-primary text-xl font-semibold">{data.campaign.title}</h1>
					<span
						class="rounded-md border px-2 py-0.5 font-mono text-xs font-semibold {statusColors[
							data.campaign.status
						] ?? 'border-surface-border-strong bg-surface-overlay text-text-secondary'}"
					>
						{data.campaign.status}
					</span>
				</div>
				<p class="text-text-tertiary text-sm">Created {formatDate(data.campaign.createdAt)}</p>
			</div>

			<div class="flex flex-wrap justify-end gap-2">
				{#if isActive}
					<a
						href={publicHref}
						target="_blank"
						rel="noopener"
						class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm"
					>
						Open donation page
					</a>
				{:else}
					<span
						class="border-surface-border text-text-quaternary rounded-md border px-3 py-1.5 text-sm"
					>
						Donation page draft-only
					</span>
				{/if}
			</div>
		</div>

		<WorkspaceCapabilityStrip label="Fundraiser packet capability" items={capabilityItems} />

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

		{#if form?.error}
			<div class="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
				{form.error}
			</div>
		{/if}
		{#if form?.statusChanged}
			<div
				class="rounded-md border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300"
			>
				Fundraiser status changed to {form.statusChanged}.
			</div>
		{/if}
		{#if form?.receiptPolicySaved}
			<div
				class="rounded-md border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300"
			>
				Receipt policy register saved.
			</div>
		{/if}

		<div
			id="fundraiser-publication"
			class="border-surface-border bg-surface-base rounded-md border p-4"
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p class="text-text-primary text-sm font-medium">Public donation surface</p>
					<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
						{#if isActive}
							This fundraiser can accept public checkout attempts through its donation page.
						{:else}
							This fundraiser is not accepting public checkout attempts while it is {data.campaign.status.toLowerCase()}.
						{/if}
					</p>
				</div>

				{#if data.canManageFundraiser}
					<div class="flex flex-wrap gap-2">
						{#if data.campaign.status === 'DRAFT'}
							<form method="POST" action="?/publish">
								<button
									type="submit"
									class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-500"
								>
									Publish donation page
								</button>
							</form>
						{/if}
						{#if data.campaign.status === 'ACTIVE'}
							<form method="POST" action="?/complete">
								<button
									type="submit"
									class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm"
								>
									Close fundraiser
								</button>
							</form>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<DonationMetrics campaign={data.campaign} />

		{#if data.campaign.body}
			<div class="border-surface-border bg-surface-base rounded-md border p-4">
				<h3 class="text-text-tertiary mb-2 text-sm font-medium">Story</h3>
				<p class="text-text-secondary text-sm whitespace-pre-line">{data.campaign.body}</p>
			</div>
		{/if}

		<div class="grid gap-4 lg:grid-cols-2">
			<div
				id="fundraiser-checkout-boundary"
				class="rounded-md border border-amber-500/30 bg-amber-500/10 p-4"
			>
				<p class="text-sm font-medium text-amber-300">Checkout boundary</p>
				<p class="text-text-tertiary mt-1 text-sm">
					Public checkout creates an encrypted pending donation and hands off to Stripe. Stripe
					secret configuration, webhook delivery, and org-key encryption are operational
					dependencies, not claims this page can prove.
				</p>
			</div>

			<div
				id="fundraiser-receipt-boundary"
				class="border-surface-border bg-surface-base rounded-md border p-4"
			>
				<p class="text-text-primary text-sm font-medium">Confirmation and receipt boundary</p>
				<p class="text-text-tertiary mt-1 text-sm">
					Completed donations record baseline confirmation email outcomes. This is not a tax
					acknowledgment, not an EIN disclosure workflow, and not a Merkle-anchored receipt trail.
				</p>
				<div class="mt-4" aria-label={receiptBoundaryEvidenceLabel}>
					{#if confirmationOutcomeEvidenceObserved}
						<div class="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
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
						</div>
					{:else}
						<div class="grid gap-2 text-center sm:grid-cols-3">
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
									<Datum
										value={receiptPolicyConfigured ? 1 : 0}
										cite="campaigns.donationReceiptPolicy"
									/>
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
							acceptance evidence exist, so this fundraiser cannot read as a zero-send receipt
							register.
						</p>
					{/if}
				</div>
				<div class="border-surface-border mt-4 border-t pt-4">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="text-text-quaternary font-mono text-[0.65rem] tracking-wider uppercase">
								Receipt policy register
							</p>
							<p class="text-text-primary mt-1 text-sm font-medium">{receiptPolicyLabel}</p>
						</div>
						<span
							class="rounded-md border px-2 py-0.5 font-mono text-[0.65rem] font-semibold uppercase {receiptPolicyConfigured
								? 'border-teal-500/30 bg-teal-500/10 text-teal-300'
								: 'border-surface-border-strong bg-surface-overlay text-text-tertiary'}"
						>
							{receiptPolicyConfigured ? 'saved context' : 'not configured'}
						</span>
					</div>
					{#if receiptPolicy?.legalName}
						<p class="text-text-tertiary mt-3 text-sm">
							Legal sender name: <span class="text-text-secondary">{receiptPolicy.legalName}</span>
						</p>
					{/if}
					{#if receiptPolicy?.acknowledgmentText}
						<p
							class="text-text-secondary bg-surface-overlay border-surface-border mt-3 rounded-md border p-3 text-sm whitespace-pre-line"
						>
							{receiptPolicy.acknowledgmentText}
						</p>
					{/if}

					{#if data.canManageFundraiser}
						<form method="POST" action="?/saveReceiptPolicy" class="mt-4 space-y-3">
							<div class="grid gap-3 md:grid-cols-2">
								<label class="block">
									<span class="text-text-tertiary text-xs font-medium">Mode</span>
									<select
										name="receipt_policy_mode"
										class="border-surface-border bg-surface-overlay text-text-primary mt-1 w-full rounded-md border px-3 py-2 text-sm"
									>
										<option value="none" selected={!receiptPolicy}>No saved policy</option>
										<option
											value="confirmation_only"
											selected={receiptPolicy?.mode === 'confirmation_only'}
										>
											Confirmation only
										</option>
										<option
											value="tax_acknowledgment_policy"
											selected={receiptPolicy?.mode === 'tax_acknowledgment_policy'}
										>
											Tax acknowledgment policy
										</option>
									</select>
								</label>
								<label class="block">
									<span class="text-text-tertiary text-xs font-medium">Legal sender name</span>
									<input
										name="receipt_legal_name"
										maxlength="200"
										value={receiptPolicy?.legalName ?? ''}
										class="border-surface-border bg-surface-overlay text-text-primary placeholder:text-text-quaternary mt-1 w-full rounded-md border px-3 py-2 text-sm"
										placeholder="Organization legal sender"
									/>
								</label>
							</div>
							<label class="block">
								<span class="text-text-tertiary text-xs font-medium">Acknowledgment text</span>
								<textarea
									name="receipt_acknowledgment_text"
									maxlength="1000"
									rows="4"
									class="border-surface-border bg-surface-overlay text-text-primary placeholder:text-text-quaternary mt-1 w-full rounded-md border px-3 py-2 text-sm"
									placeholder="Operator-authored boundary or donor acknowledgment language"
									>{receiptPolicy?.acknowledgmentText ?? ''}</textarea
								>
							</label>
							<div class="flex flex-wrap items-center justify-between gap-3">
								<p class="text-text-quaternary text-xs">
									This text can render in baseline donor confirmations; it does not validate tax
									status or issue anchored receipts.
								</p>
								<button
									type="submit"
									class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-500"
								>
									Save receipt policy
								</button>
							</div>
						</form>
					{/if}
				</div>
			</div>
		</div>

		<div id="fundraiser-donors" class="space-y-3">
			<div class="flex items-center justify-between gap-3">
				<h3 class="text-text-tertiary text-sm font-medium">Donations ({data.donors.length})</h3>
				<span class="text-text-quaternary font-mono text-xs tracking-wider uppercase">
					PII encrypted at rest
				</span>
			</div>
			<DonorTable donors={data.donors} currency={data.campaign.donationCurrency} />
		</div>
	</div>
</div>
