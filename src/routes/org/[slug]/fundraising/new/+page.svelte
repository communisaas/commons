<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import {
		buildFundraisingReadiness,
		getGateEvidence,
		type FundraisingReadinessRow,
		type FundraisingReceiptProofRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import { Datum } from '$lib/design';
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

	let title = $state(form?.values?.title ?? '');
	let description = $state(form?.values?.description ?? '');
	let goalAmount = $state(form?.values?.goal_amount ?? '');
	let currency = $state(form?.values?.currency ?? 'usd');
	let publishNow = $state(form?.values?.publish_now ?? false);
	const fundraiserRecordGate = getGateEvidence('CP-coordination-integrity', ['T10-10'], {
		name: 'Fundraiser record integrity',
		downstream: 1,
		dependency: 'Saved record integrity + packet-local coordination metrics'
	});
	const donationReceiptGate = getGateEvidence('CP-donation-receipt-compliance', ['T6-1', 'T6-2'], {
		name: 'Donation receipt compliance',
		downstream: 4,
		dependency: 'Receipt policy workflow + mainnet anchoring'
	});
	const emailProxyGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Donor confirmation email delivery',
		dependency: 'SES configuration + proxy-backed email delivery'
	});
	const draftFundraiserCount = $derived(
		title.trim() || description.trim() || goalAmount.trim() ? 1 : 0
	);
	const fundraisingReadiness = $derived(
		buildFundraisingReadiness({
			base: `/org/${data.org.slug}`,
			context: 'creation',
			fundraising: {
				enabled: true,
				loaded: true,
				fundraiserCount: 0,
				activeCount: publishNow ? 1 : 0,
				raisedAmountCents: 0,
				donationCount: 0,
				receiptPolicyCount: 0,
				confirmationCompleted: 0,
				confirmationSent: 0,
				confirmationAttempted: 0,
				confirmationProviderAccepted: 0,
				draftFundraiserCount,
				publishRequested: publishNow
			},
			gates: {
				fundraiserRecordGate,
				donationConfirmationGate: emailProxyGate,
				donationReceiptGate
			},
			hrefs: {
				'fundraiser-record': '#fundraiser-definition',
				'public-donation-page': '#fundraiser-publication',
				'stripe-checkout': '#fundraiser-checkout-boundary',
				'donor-confirmation': '#fundraiser-receipt-boundary',
				'provider-send-evidence': '#fundraiser-receipt-boundary',
				'receipt-policy-register': '#fundraiser-receipt-boundary',
				'tax-anchored-receipts': '#fundraiser-receipt-boundary'
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
			href: row.href,
			metric: row.metric
		}))
	);
	const fundraisingReceiptProofRows = $derived<FundraisingReceiptProofRow[]>(
		fundraisingReadiness.proofRows.map((row) => ({
			...row,
			href:
				row.id === 'fundraiser-record-ground'
					? '#fundraiser-definition'
					: row.id === 'public-intake-scope'
						? '#fundraiser-publication'
						: row.id === 'payment-provider-handoff' || row.id === 'webhook-completion'
							? '#fundraiser-checkout-boundary'
							: '#fundraiser-receipt-boundary'
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
			href: fundingGroundProofRow?.href ?? '#fundraiser-definition',
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
				value: 0,
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
	<title>Create fundraiser | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<div>
			<nav class="text-text-tertiary mb-3 flex items-center gap-2 text-sm">
				<a href="/org/{data.org.slug}/studio" class="hover:text-text-secondary transition-colors">
					Studio
				</a>
				<span aria-hidden="true">/</span>
				<a
					href="/org/{data.org.slug}/fundraising"
					class="hover:text-text-secondary transition-colors"
				>
					Fundraising records
				</a>
				<span aria-hidden="true">/</span>
				<span>Create</span>
			</nav>
			<h1 class="text-text-primary text-xl font-semibold">Create fundraiser</h1>
			<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
				Define the fundraising record first. Publishing opens the public donation page; receipts
				stay bounded to payment confirmation unless stronger receipt infrastructure is present.
			</p>
		</div>

		<WorkspaceCapabilityStrip label="Fundraiser creation capability" items={capabilityItems} />

		<div class="grid gap-3 md:grid-cols-3" aria-label="Funding receipt proof pressure">
			{#each fundingReceiptProofPressureReadouts as readout (readout.id)}
				<a
					href={readout.href}
					class={pressureCellClass(readout.state)}
					data-sveltekit-preload-data="off"
					aria-label={`${readout.label}: ${stateLabel(readout.state)}; ${readout.detail}; ${readout.gate}`}
				>
					<span
						class="text-text-quaternary block font-mono text-[0.65rem] tracking-[0.18em] uppercase"
					>
						{readout.label}
					</span>
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

		{#if form?.error}
			<div class="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
				{form.error}
			</div>
		{/if}

		<form method="POST" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<div
				id="fundraiser-definition"
				class="border-surface-border bg-surface-base space-y-4 rounded-md border p-5"
			>
				<div>
					<p class="text-text-tertiary font-mono text-xs font-semibold tracking-wider uppercase">
						Fundraiser definition
					</p>
					<p class="text-text-tertiary mt-1 text-sm">
						The saved record is the live capability; public checkout depends on active status.
					</p>
				</div>

				<label class="block">
					<span class="text-text-secondary mb-1.5 block text-sm font-medium">Title</span>
					<input
						name="title"
						bind:value={title}
						required
						minlength="3"
						maxlength="200"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
						placeholder="Legal defense fund"
					/>
				</label>

				<label class="block">
					<span class="text-text-secondary mb-1.5 block text-sm font-medium">Story</span>
					<textarea
						name="description"
						bind:value={description}
						rows="5"
						maxlength="5000"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full resize-y rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
						placeholder="Why this contribution matters and what it funds."
					></textarea>
				</label>

				<div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
					<label class="block">
						<span class="text-text-secondary mb-1.5 block text-sm font-medium"> Goal amount </span>
						<input
							name="goal_amount"
							type="number"
							min="1"
							step="0.01"
							bind:value={goalAmount}
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 font-mono text-sm focus:border-teal-500 focus:outline-none"
							placeholder="optional"
						/>
					</label>
					<label class="block">
						<span class="text-text-secondary mb-1.5 block text-sm font-medium">Currency</span>
						<input
							name="currency"
							bind:value={currency}
							maxlength="8"
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 font-mono text-sm uppercase focus:border-teal-500 focus:outline-none"
						/>
					</label>
				</div>
			</div>

			<div class="space-y-4">
				<div
					id="fundraiser-publication"
					class="border-surface-border bg-surface-base rounded-md border p-4"
				>
					<p class="text-text-primary text-sm font-medium">Public donation page</p>
					<label class="mt-3 flex items-start gap-3">
						<input
							name="publish_now"
							type="checkbox"
							bind:checked={publishNow}
							class="border-surface-border-strong bg-surface-raised mt-1 h-4 w-4 rounded text-teal-500 focus:ring-teal-500"
						/>
						<span>
							<span class="text-text-secondary block text-sm">Publish immediately</span>
							<span class="text-text-tertiary mt-0.5 block text-xs">
								When checked, /d/[campaignId] can accept Stripe checkout attempts after creation.
							</span>
						</span>
					</label>
				</div>

				<div
					id="fundraiser-checkout-boundary"
					class="rounded-md border border-amber-500/30 bg-amber-500/10 p-4"
				>
					<p class="text-sm font-medium text-amber-300">Checkout boundary</p>
					<p class="text-text-tertiary mt-1 text-xs leading-5">
						The public checkout action requires org-key encryption and Stripe configuration at
						runtime. This form does not prove those operator dependencies are configured.
					</p>
				</div>

				<div
					id="fundraiser-receipt-boundary"
					class="border-surface-border bg-surface-base rounded-md border p-4"
				>
					<p class="text-text-primary text-sm font-medium">Receipt boundary</p>
					<p class="text-text-tertiary mt-1 text-xs leading-5">
						Completed donations can schedule a baseline email confirmation. Tax acknowledgment, EIN
						disclosure, and anchored public receipt trails remain separate.
					</p>
				</div>

				<div class="flex flex-col gap-2">
					<button
						type="submit"
						class="rounded-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-500"
					>
						{publishNow ? 'Create and publish' : 'Save draft fundraiser'}
					</button>
					<a
						href="/org/{data.org.slug}/fundraising"
						class="text-text-tertiary hover:text-text-primary rounded-md px-4 py-2.5 text-center text-sm transition-colors"
					>
						Cancel
					</a>
				</div>
			</div>
		</form>
	</div>
</div>
