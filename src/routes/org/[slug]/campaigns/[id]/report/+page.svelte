<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import {
		buildResultsProofReadiness,
		formatGateEvidence,
		getGateEvidence,
		type CapabilityState,
		type ResultsProofRow
	} from '$lib/data/capability-hypergraph';
	import { FEATURES } from '$lib/config/features';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments
	} from '$lib/data/capability-state-labels';
	import { Datum, Ratio } from '$lib/design';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type ProofContractRow = {
		label: string;
		state: CapabilityState;
		action: string;
		effect: string;
		gate: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};
	type ResultsProofPressureReadout = {
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

	let selectedTargets = $state<Set<string>>(new Set());
	let logResponseDeliveryId = $state<string | null>(null);
	let logResponseType = $state('replied');
	let logResponseDetail = $state('');
	let logResponseLoading = $state(false);

	const selectedCount = $derived(selectedTargets.size);
	const hasTargets = $derived(data.targets.length > 0);
	const packetVerified = $derived(data.packet ? data.packet.verified : null);
	const packetTotal = $derived(data.packet ? data.packet.total : null);
	const packetDistricts = $derived(data.packet ? data.packet.districtCount : null);
	const sentRecordCount = $derived(
		data.pastDeliveries.filter((delivery) =>
			['sent', 'delivered', 'opened'].includes(delivery.status)
		).length
	);
	const deliveryRowCount = $derived(data.pastDeliveries.length);
	const receiptBackedCount = $derived(
		data.pastDeliveries.filter((delivery) => delivery.receiptBacked).length
	);
	const receiptEligibleCount = $derived(
		data.pastDeliveries.filter(
			(delivery) => delivery.receiptBacked || delivery.receiptEligibility === 'eligible'
		).length
	);
	const receiptBlockedCount = $derived(
		data.pastDeliveries.filter(
			(delivery) => !delivery.receiptBacked && delivery.receiptEligibility !== 'eligible'
		).length
	);
	const unresolvedReceiptTargetCount = $derived(
		data.pastDeliveries.filter((delivery) => delivery.receiptBlockers.includes('unresolved_target'))
			.length
	);
	const missingReceiptBillCount = $derived(
		data.pastDeliveries.filter((delivery) => delivery.receiptBlockers.includes('missing_bill'))
			.length
	);
	const responseCount = $derived(
		data.pastDeliveries.reduce((total, delivery) => total + delivery.responses.length, 0)
	);
	const packetArtifactState = $derived<CapabilityState>(data.packet ? 'live' : 'partial');
	const recipientState = $derived<CapabilityState>(
		hasTargets && selectedCount > 0 ? 'live' : 'gated'
	);
	const reportEmailState = $derived<CapabilityState>(data.renderedHtml ? 'live' : 'gated');
	const senderDeliveryState = $derived<CapabilityState>(
		deliveryRowCount > 0 ? 'partial' : selectedCount > 0 ? 'draft-only' : 'gated'
	);
	const responseArcState = $derived<CapabilityState>(
		responseCount > 0 ? 'partial' : deliveryRowCount > 0 ? 'draft-only' : 'gated'
	);
	const base = $derived(`/org/${data.org.slug}`);
	const actionRecordsHref = $derived(`${base}/campaigns`);
	const packetHref = $derived(`${base}/campaigns/${data.campaign.id}/report#proof-preview`);
	const proofDeliveryHref = $derived(`${base}/campaigns/${data.campaign.id}/report#proof-delivery`);
	const resultsPacketHref = $derived(`${base}#results-packet`);
	const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2'], {
		name: 'Receipt anchoring',
		downstream: 4,
		dependency: 'Receipt writer + mainnet anchoring'
	});
	const readerOfficeGate = getGateEvidence('CP-dm-office-profile', ['T8-1b', 'T8-8'], {
		name: 'Reader office response',
		downstream: 4,
		dependency: 'Reader-office surface + notification APIs'
	});
	const coordinationIntegrityGate = getGateEvidence('CP-coordination-integrity', ['T10-10'], {
		name: 'Coordination integrity history',
		downstream: 1,
		dependency: 'Longitudinal packet-local coordination metrics'
	});
	const resultsProofReadiness = $derived(
		buildResultsProofReadiness({
			base,
			hrefs: {
				actionRecordsHref,
				packetHref,
				resultsPacketHref,
				proofDeliveryHref
			},
			results: {
				loaded: true,
				hasPacket: !!data.packet,
				verifiedCount: packetVerified,
				totalCount: packetTotal,
				districtCount: packetDistricts,
				sentEmails: sentRecordCount,
				campaignCount: 1,
				receiptCount: receiptBackedCount,
				pendingReceiptCount: receiptBackedCount,
				responseLoggedReceiptCount: responseCount,
				anchorFieldCount: 0,
				receiptSampleLimit: deliveryRowCount,
				receiptProofWeightTotal: data.pastDeliveries.reduce(
					(total, delivery) => total + (delivery.proofStrength?.weight ?? 0),
					0
				)
			},
			features: {
				ACCOUNTABILITY: FEATURES.ACCOUNTABILITY
			},
			gates: {
				receiptAnchoringGate,
				readerOfficeGate,
				coordinationIntegrityGate
			}
		})
	);
	const resultsProofRows = $derived<ResultsProofRow[]>(resultsProofReadiness.rows);
	const packetArtifactResultsRow = $derived(
		resultsProofRows.find((row) => row.id === 'packet-artifact') ?? null
	);
	const receiptEvidenceResultsRow = $derived(
		resultsProofRows.find((row) => row.id === 'receipt-evidence') ?? null
	);
	const heldResultsProofRows = $derived(
		resultsProofRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const firstHeldResultsProofRow = $derived(
		heldResultsProofRows[0] ?? resultsProofRows.find((row) => row.state === 'partial') ?? null
	);
	const resultsProofStateCounts = $derived(
		resultsProofRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const resultsProofSegments = $derived(
		operatorCapabilityStateRatioSegments(resultsProofStateCounts)
	);
	const resultsProofPressureReadouts = $derived<ResultsProofPressureReadout[]>([
		{
			id: 'packet-ground',
			label: 'Packet ground',
			state: packetArtifactResultsRow?.state ?? resultsProofReadiness.state,
			title: packetArtifactResultsRow?.handoff ?? resultsProofReadiness.handoff,
			action: packetArtifactResultsRow?.action ?? resultsProofReadiness.action,
			detail: resultsProofReadiness.signal,
			gate: packetArtifactResultsRow?.boundary ?? resultsProofReadiness.gate,
			href: packetArtifactResultsRow?.href ?? packetHref,
			metric: packetArtifactResultsRow?.metric ?? resultsProofReadiness.metric
		},
		{
			id: 'receipt-evidence',
			label: 'Receipt evidence',
			state: receiptEvidenceResultsRow?.state ?? resultsProofReadiness.state,
			title: receiptEvidenceResultsRow?.handoff ?? 'Accountability receipts',
			action: receiptEvidenceResultsRow?.action ?? 'read receipt boundary',
			detail:
				receiptEvidenceResultsRow?.ground ??
				'Receipt evidence waits on eligible proof delivery rows.',
			gate: receiptEvidenceResultsRow?.boundary ?? resultsProofReadiness.gate,
			href: receiptEvidenceResultsRow?.href ?? resultsPacketHref,
			metric: receiptEvidenceResultsRow?.metric ?? {
				value: receiptBackedCount,
				label: 'receipt rows',
				cite: 'campaigns.getPastDeliveries receiptBacked'
			}
		},
		{
			id: 'next-proof-lift',
			label: 'Next proof lift',
			state: firstHeldResultsProofRow?.state ?? resultsProofReadiness.state,
			title: firstHeldResultsProofRow?.label ?? resultsProofReadiness.nextGate.name,
			action: firstHeldResultsProofRow?.action ?? 'read proof boundary',
			detail:
				firstHeldResultsProofRow?.ground ??
				'All visible proof rows are usable; the next lift is in the gate register.',
			gate: firstHeldResultsProofRow?.boundary ?? resultsProofReadiness.gate,
			href: firstHeldResultsProofRow?.href ?? resultsPacketHref,
			metric: {
				value:
					firstHeldResultsProofRow?.gate.downstream ??
					resultsProofReadiness.nextGate.downstream ??
					null,
				label: 'downstream',
				cite: firstHeldResultsProofRow?.gate.id ?? resultsProofReadiness.nextGate.id
			}
		}
	]);
	const proofContractRows = $derived<ProofContractRow[]>([
		{
			label: 'Packet artifact',
			state: packetArtifactState,
			action: data.packet ? 'preview packet' : 'open action',
			effect: data.packet
				? 'Rendered report carries the current packet summary, attestation hash, and verification URL.'
				: 'The report surface exists; packet metrics appear after verified actions accumulate.',
			gate: data.packet
				? formatGateEvidence(receiptAnchoringGate, {
						prefix: 'Keep receipt-root claims bounded.'
					})
				: 'Verified actions must accumulate before packet metrics can be claimed.',
			metric: {
				value: packetVerified,
				label: data.packet ? 'verified in packet' : 'packet pending',
				cite: 'computeVerificationPacketCached + renderReport'
			}
		},
		{
			label: 'Decision-maker recipients',
			state: recipientState,
			action: selectedCount > 0 ? 'queue proof' : 'select targets',
			effect:
				selectedCount > 0
					? 'Send action targets selected decision-maker emails and creates delivery records.'
					: 'No selected recipients; the send action cannot run.',
			gate: hasTargets
				? 'Per-send target cap is 50; editor role and plan limits still apply.'
				: 'Add decision-maker targets before delivery can run.',
			metric: {
				value: selectedCount,
				label: 'selected targets',
				cite: 'action target selection'
			}
		},
		{
			label: 'Report email',
			state: reportEmailState,
			action: 'preview email',
			effect: data.renderedHtml
				? 'Preview and send share the same rendered report HTML when the send action succeeds.'
				: 'No rendered report artifact is available for preview or delivery.',
			gate: data.renderedHtml
				? 'SES dispatch still depends on AWS credentials; missing ops config marks queued deliveries failed.'
				: 'Report rendering must succeed before this is deliverable.',
			metric: {
				value: data.renderedHtml ? 1 : 0,
				label: 'rendered artifact',
				cite: 'renderReport'
			}
		},
		{
			label: 'Sender delivery register',
			state: senderDeliveryState,
			action: deliveryRowCount > 0 ? 'read delivery arc' : 'queue proof first',
			effect:
				deliveryRowCount > 0
					? `${deliveryRowCount} sender-side delivery row${deliveryRowCount === 1 ? '' : 's'} are loaded; ${receiptEligibleCount} ${receiptEligibleCount === 1 ? 'is' : 'are'} receipt-eligible, ${receiptBackedCount} ${receiptBackedCount === 1 ? 'is' : 'are'} backed by accountability receipt rows, and ${receiptBlockedCount} remain blocked (${missingReceiptBillCount} missing bill link, ${unresolvedReceiptTargetCount} unresolved target).`
					: 'No sender-side delivery row exists yet; queueing creates delivery rows before any response or receipt proof can be claimed.',
			gate: formatGateEvidence(receiptAnchoringGate, {
				prefix:
					'Accepted, receipt-eligible delivery rows can become accountability receipts, but they are not Merkle-anchored; keep receipt-root claims bounded until mainnet survivability lands.'
			}),
			metric: {
				value: deliveryRowCount,
				label: receiptEligibleCount > 0 ? 'eligible rows' : 'sender rows',
				cite: 'campaigns.getPastDeliveries + receiptEligibility'
			}
		},
		{
			label: 'Manual response log',
			state: responseArcState,
			action: deliveryRowCount > 0 ? 'log response' : 'await delivery row',
			effect:
				responseCount > 0
					? `${responseCount} response annotation${responseCount === 1 ? '' : 's'} are loaded from accountability receipts or delivery-local response logs.`
					: deliveryRowCount > 0
						? 'Delivery rows can accept manually observed response annotations; no response evidence has been logged yet.'
						: 'No delivery row exists yet, so there is no response arc to annotate.',
			gate: formatGateEvidence(readerOfficeGate, {
				prefix:
					'Manual annotations are not a reader-office workflow; reader-office profiles and notification loops remain dependency-first.'
			}),
			metric: {
				value: responseCount,
				label: 'logged responses',
				cite: 'accountabilityReceipts responses + delivery-local responses'
			}
		}
	]);
	const proofStateCounts = $derived(
		proofContractRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const proofSegments = $derived(operatorCapabilityStateRatioSegments(proofStateCounts));

	$effect(() => {
		selectedTargets = new Set(data.targets.map((t: { email: string }) => t.email));
	});

	function toggleTarget(email: string) {
		const next = new Set(selectedTargets);
		if (next.has(email)) {
			next.delete(email);
		} else {
			next.add(email);
		}
		selectedTargets = next;
	}

	function toggleAll() {
		if (selectedTargets.size === data.targets.length) {
			selectedTargets = new Set();
		} else {
			selectedTargets = new Set(data.targets.map((t) => t.email));
		}
	}

	function statusBadgeClass(status: string): string {
		switch (status) {
			case 'sent':
				return 'bg-teal-500/15 text-teal-400 border-teal-500/20';
			case 'delivered':
				return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'opened':
				return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
			case 'bounced':
				return 'bg-red-500/15 text-red-400 border-red-500/20';
			case 'queued':
				return 'bg-text-tertiary/15 text-text-tertiary border-text-tertiary/20';
			default:
				return 'bg-text-tertiary/15 text-text-tertiary border-text-tertiary/20';
		}
	}

	function eventDotColor(type: string): string {
		switch (type) {
			case 'opened':
				return 'bg-emerald-400';
			case 'clicked_verify':
				return 'bg-teal-400';
			case 'replied':
				return 'bg-blue-400';
			case 'meeting_requested':
				return 'bg-teal-400';
			case 'vote_cast':
				return 'bg-amber-400';
			case 'public_statement':
				return 'bg-rose-400';
			default:
				return 'bg-zinc-400';
		}
	}

	function eventLabel(type: string): string {
		switch (type) {
			case 'opened':
				return 'Opened';
			case 'clicked_verify':
				return 'Clicked verify link';
			case 'replied':
				return 'Replied';
			case 'meeting_requested':
				return 'Meeting requested';
			case 'vote_cast':
				return 'Vote cast';
			case 'public_statement':
				return 'Public statement';
			default:
				return type;
		}
	}

	function confidenceBadge(confidence: string): string {
		switch (confidence) {
			case 'observed':
				return 'text-emerald-500';
			case 'inferred':
				return 'text-amber-500';
			case 'reported':
				return 'text-blue-400';
			default:
				return 'text-text-tertiary';
		}
	}

	function receiptBadgeClass(delivery: {
		receiptBacked: boolean;
		receiptEligibility: string;
	}): string {
		if (delivery.receiptBacked) return 'border-emerald-500/30 text-emerald-400';
		switch (delivery.receiptEligibility) {
			case 'eligible':
				return 'border-teal-500/30 text-teal-400';
			case 'missing_bill':
				return 'border-amber-500/30 text-amber-400';
			case 'unresolved_target':
				return 'border-red-500/30 text-red-400';
			case 'missing_bill_and_target':
				return 'border-red-500/30 text-red-400';
			default:
				return 'border-text-tertiary/20 text-text-tertiary';
		}
	}

	function receiptBadgeLabel(delivery: {
		receiptBacked: boolean;
		receiptEligibility: string;
	}): string {
		if (delivery.receiptBacked) return 'receipt-backed';
		if (delivery.receiptEligibility === 'eligible') return 'receipt-eligible';
		return 'not receipt-grade';
	}

	function receiptReadinessText(delivery: {
		receiptBacked: boolean;
		receiptEligibility: string;
		receiptBlockers: string[];
	}): string {
		if (delivery.receiptBacked) {
			return 'Accountability receipt row is present; anchoring remains bounded by the receipt-root gate.';
		}
		if (delivery.receiptEligibility === 'eligible') {
			return 'Power target and bill are bound; the receipt writer runs after SES accepts delivery, while mainnet anchoring remains gated.';
		}
		const blockers = delivery.receiptBlockers.map((blocker) =>
			blocker === 'missing_bill' ? 'bill link' : 'resolved Power target'
		);
		return `Missing ${blockers.join(' + ')} before this sender row can become receipt-grade.`;
	}

	function proofStateLabel(state: CapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function proofActionLabel(row: { state: CapabilityState; action: string }): string {
		return operatorCapabilityActionLabel(row.state, row.action, { appendReadyArrow: true });
	}

	function formatDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	async function submitLogResponse() {
		if (!logResponseDeliveryId) return;
		logResponseLoading = true;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/campaigns/${data.campaign.id}/responses`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					deliveryId: logResponseDeliveryId,
					type: logResponseType,
					detail: logResponseDetail || undefined
				})
			});
			if (res.ok) {
				logResponseDeliveryId = null;
				logResponseDetail = '';
				logResponseType = 'replied';
				await invalidateAll();
			}
		} finally {
			logResponseLoading = false;
		}
	}
</script>

<div class="space-y-6">
	<!-- Breadcrumb -->
	<nav class="text-text-tertiary flex items-center gap-2 text-sm">
		<a href="/org/{data.org.slug}/campaigns" class="hover:text-text-secondary transition-colors">
			Action records
		</a>
		<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
		</svg>
		<a
			href="/org/{data.org.slug}/campaigns/{data.campaign.id}"
			class="hover:text-text-secondary transition-colors"
		>
			{data.campaign.title}
		</a>
		<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
		</svg>
		<span class="text-text-tertiary">Proof delivery</span>
	</nav>

	<!-- Error/success messages -->
	{#if form?.error}
		<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
			{form.error}
		</div>
	{/if}
	{#if form?.success}
		<div
			class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400"
		>
			Proof queued for delivery to {form.sentCount} decision-maker{form.sentCount === 1 ? '' : 's'}
		</div>
	{/if}

	<!-- Proof context -->
	<div
		id="proof-context"
		class="scroll-mt-24 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-6 py-4"
	>
		<p class="text-text-secondary text-sm">
			You are preparing a reader-legible proof packet for decision-makers.
		</p>
		{#if data.packet}
			<p class="text-text-tertiary mt-1 text-sm">
				The artifact carries
				<span class="font-mono font-semibold text-emerald-400 tabular-nums">
					<Datum value={packetVerified} cite="packet.verified" />
				</span>
				verified actions across
				<span class="font-mono text-teal-400 tabular-nums">
					<Datum value={packetDistricts} cite="packet.districtCount" />
				</span>
				districts. The contract below marks which parts are armed, partial, or gated.
			</p>
		{/if}
	</div>

	<!-- Targets + Send -->
	<form
		id="proof-delivery"
		method="POST"
		action="?/send"
		use:enhance={({ cancel }) => {
			if (
				!confirm(
					`Queue proof packet for ${selectedCount} decision-maker${selectedCount === 1 ? '' : 's'}? SES dispatch and delivery status are recorded after queueing.`
				)
			) {
				cancel();
				return;
			}
			return async ({ update }) => {
				await update({ reset: false });
			};
		}}
		class="scroll-mt-24 space-y-6"
	>
		<div class="border-surface-border bg-surface-base rounded-md border p-6">
			<div class="proof-contract" aria-label="Results proof posture from OS readiness">
				<div class="proof-contract-head">
					<div>
						<p class="proof-contract-kicker">Results proof posture</p>
						<h3 class="proof-contract-title">What this report can prove back</h3>
					</div>
					<div class="proof-contract-count">
						<Datum value={resultsProofRows.length} cite="buildResultsProofReadiness" />
						<span>proof contracts</span>
					</div>
				</div>
				<p class="proof-contract-summary">{resultsProofReadiness.detail}</p>
				<Ratio segments={resultsProofSegments} height={8} />
				<div class="proof-pressure" aria-label="Report Results proof pressure">
					{#each resultsProofPressureReadouts as readout (readout.id)}
						<a
							class="proof-pressure-cell"
							href={readout.href}
							data-state={readout.state}
							data-sveltekit-preload-data="off"
							aria-label={`${readout.label}: ${proofStateLabel(readout.state)}; ${readout.detail}; ${readout.gate}`}
						>
							<span class="proof-pressure-kicker">{readout.label}</span>
							<span class="proof-pressure-title">{readout.title}</span>
							<span class="proof-pressure-metric">
								<Datum value={readout.metric.value} cite={readout.metric.cite} />
								<span>{readout.metric.label}</span>
							</span>
							<span class="proof-pressure-detail">{readout.detail}</span>
							<span class="proof-pressure-action">{proofActionLabel(readout)}</span>
							<span class="proof-pressure-gate">{readout.gate}</span>
						</a>
					{/each}
				</div>
				<div class="proof-contract-list">
					{#each resultsProofRows as row (row.id)}
						<a
							class="proof-contract-row proof-contract-row--link"
							href={row.href}
							data-state={row.state}
							data-sveltekit-preload-data="off"
						>
							<div class="proof-contract-main">
								<span class="proof-contract-name">{row.label}</span>
								<span class="proof-contract-meta">
									{row.phase} / {formatCapabilityClusters(row.clusters)}
								</span>
								<span class="proof-contract-handoff">{row.handoff}</span>
								<span class="proof-contract-effect">{row.ground}</span>
							</div>
							<span class="proof-contract-state">{proofStateLabel(row.state)}</span>
							<span class="proof-contract-metric">
								<Datum value={row.metric.value} cite={row.metric.cite} />
								<span>{row.metric.label}</span>
							</span>
							<span class="proof-contract-action">{proofActionLabel(row)}</span>
							<span class="proof-contract-gate">{row.boundary}</span>
						</a>
					{/each}
				</div>
			</div>
		</div>

		<div class="border-surface-border bg-surface-base rounded-md border p-6">
			<div class="proof-contract" aria-label="Proof delivery capability contract">
				<div class="proof-contract-head">
					<div>
						<p class="proof-contract-kicker">Proof delivery contract</p>
						<h3 class="proof-contract-title">Queue only what can be defended</h3>
					</div>
					<div class="proof-contract-count">
						<Datum value={sentRecordCount} cite="sent/delivered/opened proof deliveries" />
						<span>sent records</span>
					</div>
				</div>
				<Ratio segments={proofSegments} height={8} />
				<div class="proof-contract-list">
					{#each proofContractRows as row (row.label)}
						<div class="proof-contract-row" data-state={row.state}>
							<div class="proof-contract-main">
								<span class="proof-contract-name">{row.label}</span>
								<span class="proof-contract-effect">{row.effect}</span>
							</div>
							<span class="proof-contract-state">{proofStateLabel(row.state)}</span>
							<span class="proof-contract-metric">
								<Datum value={row.metric.value} cite={row.metric.cite} />
								<span>{row.metric.label}</span>
							</span>
							<span class="proof-contract-action">{proofActionLabel(row)}</span>
							<span class="proof-contract-gate">{row.gate}</span>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<div class="border-surface-border bg-surface-base space-y-4 rounded-md border p-6">
			<div class="flex items-center justify-between">
				<p class="text-text-tertiary font-mono text-xs tracking-wider uppercase">
					Decision-maker recipients
				</p>
				{#if hasTargets}
					<button
						type="button"
						onclick={toggleAll}
						class="text-text-tertiary hover:text-text-secondary text-xs transition-colors"
					>
						{selectedTargets.size === data.targets.length ? 'Deselect all' : 'Select all'}
					</button>
				{/if}
			</div>

			{#if !hasTargets}
				<div class="py-4 text-center">
					<p class="text-text-tertiary text-sm">No decision-makers targeted.</p>
					<p class="text-text-quaternary mt-1 text-xs">
						Add recipients in action settings to enable proof delivery.
					</p>
				</div>
			{:else}
				<div class="space-y-2">
					{#each data.targets as target}
						{@const isSelected = selectedTargets.has(target.email)}
						<label
							class="flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors
								{isSelected
								? 'border-teal-500/30 bg-teal-500/5'
								: 'border-surface-border bg-surface-raised opacity-60'}"
						>
							<input
								type="checkbox"
								name="target"
								value={target.email}
								checked={isSelected}
								onchange={() => toggleTarget(target.email)}
								class="border-text-quaternary bg-surface-overlay rounded text-teal-500 focus:ring-teal-500/40 focus:ring-offset-0"
							/>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="text-text-primary truncate text-sm">
										{target.name ?? target.email}
									</span>
									{#if target.title}
										<span class="text-text-tertiary truncate text-xs">{target.title}</span>
									{/if}
								</div>
								<div class="mt-0.5 flex items-center gap-3">
									<span class="text-text-tertiary font-mono text-xs">{target.email}</span>
									{#if target.district}
										<span class="text-xs text-teal-500/60">{target.district}</span>
									{/if}
								</div>
							</div>
						</label>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Email Preview -->
		<div
			id="proof-preview"
			class="border-surface-border bg-surface-base scroll-mt-24 space-y-4 rounded-md border p-6"
		>
			<div class="flex items-baseline justify-between gap-3">
				<p class="text-text-tertiary font-mono text-xs tracking-wider uppercase">Email Preview</p>
				<div class="flex items-center gap-3">
					<a
						href="email-html"
						target="_blank"
						rel="noopener"
						class="font-brand text-xs text-indigo-600 hover:text-indigo-800"
					>
						Open for printing →
					</a>
					<a
						href="email-html?download=1"
						class="font-brand text-xs text-indigo-600 hover:text-indigo-800"
					>
						Download HTML
					</a>
				</div>
			</div>
			<div
				class="border-surface-border bg-surface-raised overflow-hidden rounded-lg border"
				style="max-height: 600px; overflow-y: auto;"
			>
				<iframe
					srcdoc={data.renderedHtml}
					title="Report email preview"
					class="w-full border-0"
					style="height: 600px; background: #09090b;"
					sandbox=""
				></iframe>
			</div>
			<p class="font-brand text-text-tertiary text-[11px]">
				Open for printing renders the same email body as a standalone page; use your browser's File
				→ Print → Save as PDF for a staffer-grade artifact. The attestation hash on the page is
				exposed in the response's <code class="font-mono">X-Attestation-Hash</code> header for verification
				chain-of-custody.
			</p>
		</div>

		<!-- Send button -->
		{#if hasTargets}
			<div class="flex items-center gap-4">
				<button
					type="submit"
					disabled={selectedCount === 0}
					class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<svg
						class="h-4 w-4"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
						/>
					</svg>
					Queue proof for {selectedCount} decision-maker{selectedCount === 1 ? '' : 's'}
				</button>
				<a
					href="/org/{data.org.slug}/campaigns/{data.campaign.id}"
					class="bg-surface-overlay text-text-primary hover:bg-surface-raised rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
				>
					Back to action
				</a>
			</div>
		{:else}
			<a
				href="/org/{data.org.slug}/campaigns/{data.campaign.id}"
				class="bg-surface-overlay text-text-primary hover:bg-surface-raised inline-flex rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
			>
				Back to action
			</a>
		{/if}
	</form>

	<!-- Sender delivery arc -->
	{#if data.pastDeliveries.length > 0}
		<div
			id="proof-delivery-arc"
			class="border-surface-border bg-surface-base scroll-mt-24 space-y-6 rounded-md border p-6"
		>
			<p class="text-text-tertiary font-mono text-xs tracking-wider uppercase">
				Sender delivery arc
			</p>

			{#each data.pastDeliveries as delivery}
				<div class="border-surface-border bg-surface-raised space-y-3 rounded-lg border p-4">
					<!-- Delivery header -->
					<div class="flex items-start justify-between gap-4">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<span class="text-text-primary truncate text-sm font-medium">
									{delivery.targetName ?? delivery.targetEmail}
								</span>
								<span
									class="inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs {statusBadgeClass(
										delivery.status
									)}"
								>
									{delivery.status}
								</span>
							</div>
							<div class="mt-0.5 flex items-center gap-3">
								{#if delivery.targetName}
									<span class="text-text-tertiary font-mono text-xs">{delivery.targetEmail}</span>
								{/if}
								{#if delivery.targetTitle}
									<span class="text-text-quaternary text-xs">{delivery.targetTitle}</span>
								{/if}
								{#if delivery.targetDistrict}
									<span class="text-xs text-teal-500/60">{delivery.targetDistrict}</span>
								{/if}
							</div>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<span
								class="rounded border px-2 py-0.5 font-mono text-[10px] uppercase {receiptBadgeClass(
									delivery
								)}"
							>
								{receiptBadgeLabel(delivery)}
							</span>
							{#if delivery.receiptId}
								<a
									href="/verify/receipt/{delivery.receiptId}"
									class="text-text-tertiary hover:text-text-secondary font-mono text-[10px] uppercase transition-colors"
								>
									open receipt
								</a>
							{/if}
							{#if delivery.proofStrength}
								<span class="font-mono text-xs text-emerald-400 tabular-nums"
									>{delivery.proofStrength.verified.toLocaleString('en-US')}</span
								>
								<span class="text-text-quaternary text-xs">/</span>
								<span class="font-mono text-xs text-teal-400 tabular-nums"
									>{delivery.proofStrength.districtCount}d</span
								>
								<span
									class="text-text-quaternary font-mono text-[10px] tabular-nums"
									title="Proof weight">w {delivery.proofStrength.weight.toFixed(2)}</span
								>
							{/if}
						</div>
					</div>
					<p class="text-text-quaternary text-xs">{receiptReadinessText(delivery)}</p>

					<!-- Timeline -->
					<div class="border-surface-border relative ml-2 space-y-2 border-l pl-4">
						<!-- Sent event (always present) -->
						<div class="relative flex items-start gap-2">
							<div
								class="ring-surface-raised absolute top-1 -left-[21px] h-2.5 w-2.5 rounded-full bg-teal-400 ring-2"
							></div>
							<div class="flex-1">
								<span class="text-text-secondary text-xs">Sent</span>
								<span class="text-text-quaternary ml-2 font-mono text-xs tabular-nums">
									{delivery.sentAt ? formatDate(delivery.sentAt) : formatDate(delivery.createdAt)}
								</span>
							</div>
						</div>

						<!-- Response events -->
						{#each delivery.responses as response}
							<div class="relative flex items-start gap-2">
								<div
									class="absolute top-1 -left-[21px] h-2.5 w-2.5 rounded-full {eventDotColor(
										response.type
									)} ring-surface-raised ring-2"
								></div>
								<div class="flex-1">
									<span class="text-text-secondary text-xs">{eventLabel(response.type)}</span>
									<span class="font-mono text-xs {confidenceBadge(response.confidence)} ml-1">
										{response.confidence}
									</span>
									<span class="text-text-quaternary ml-2 font-mono text-xs tabular-nums">
										{formatDate(response.occurredAt)}
									</span>
									{#if response.detail}
										<p class="text-text-tertiary mt-0.5 text-xs italic">{response.detail}</p>
									{/if}
								</div>
							</div>
						{/each}
					</div>

					<!-- Log Response button -->
					<div class="pt-1">
						<button
							type="button"
							onclick={() => {
								logResponseDeliveryId = delivery.id;
							}}
							class="text-text-tertiary hover:text-text-secondary text-xs transition-colors"
						>
							+ Log response
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Log Response Modal -->
	{#if logResponseDeliveryId}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
			role="dialog"
			aria-modal="true"
		>
			<div
				class="border-surface-border bg-surface-base w-full max-w-md space-y-4 rounded-md border p-6"
			>
				<h3 class="text-text-primary text-sm font-semibold">Log manual response</h3>

				<div class="space-y-3">
					<div>
						<label for="response-type" class="text-text-tertiary mb-1 block font-mono text-xs"
							>Response type</label
						>
						<select
							id="response-type"
							bind:value={logResponseType}
							class="border-surface-border bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:ring-teal-500/40 focus:outline-none"
						>
							<option value="replied">Replied</option>
							<option value="meeting_requested">Meeting Requested</option>
							<option value="vote_cast">Vote Cast</option>
							<option value="public_statement">Public Statement</option>
						</select>
					</div>

					<div>
						<label for="response-detail" class="text-text-tertiary mb-1 block font-mono text-xs"
							>Detail (optional)</label
						>
						<textarea
							id="response-detail"
							bind:value={logResponseDetail}
							rows="3"
							placeholder="e.g., Reply excerpt, vote direction, statement summary..."
							class="border-surface-border bg-surface-raised text-text-primary placeholder:text-text-quaternary w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:ring-teal-500/40 focus:outline-none"
						></textarea>
					</div>
				</div>

				<div class="flex items-center justify-end gap-3">
					<button
						type="button"
						onclick={() => {
							logResponseDeliveryId = null;
						}}
						class="text-text-tertiary hover:text-text-secondary rounded-lg px-4 py-2 text-sm transition-colors"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={logResponseLoading}
						onclick={submitLogResponse}
						class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-40"
					>
						{logResponseLoading ? 'Saving...' : 'Log Response'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.proof-contract {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.proof-contract-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.proof-contract-kicker,
	.proof-contract-state,
	.proof-contract-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.2;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.proof-contract-kicker {
		color: oklch(0.52 0.012 250);
	}

	.proof-contract-title {
		margin: 0.125rem 0 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.95rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.proof-contract-summary {
		margin: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.proof-contract-count,
	.proof-contract-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		white-space: nowrap;
	}

	.proof-contract-list {
		display: grid;
		gap: 0.25rem;
	}

	.proof-pressure {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.proof-pressure-cell {
		display: grid;
		min-height: 9.5rem;
		align-content: start;
		gap: 0.25rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
		border-radius: 0.375rem;
		padding: 0.75rem;
		color: inherit;
		text-decoration: none;
		transition:
			border-color 160ms ease,
			background-color 160ms ease;
	}

	.proof-pressure-cell:hover,
	.proof-pressure-cell:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		background: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 94%);
		outline: none;
	}

	.proof-pressure-kicker,
	.proof-pressure-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.2;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.proof-pressure-kicker {
		color: oklch(0.52 0.012 250);
	}

	.proof-pressure-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.proof-pressure-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.proof-pressure-detail,
	.proof-pressure-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.proof-pressure-action {
		color: oklch(0.5 0.012 60);
		letter-spacing: 0;
		text-transform: none;
	}

	.proof-pressure-cell[data-state='live'] .proof-pressure-action {
		color: var(--coord-verified, #10b981);
	}

	.proof-pressure-cell[data-state='partial'] .proof-pressure-action {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.proof-pressure-cell[data-state='draft-only'],
	.proof-pressure-cell[data-state='gated'] {
		border-style: dashed;
	}

	.proof-pressure-cell[data-state='draft-only'] .proof-pressure-action {
		color: oklch(0.62 0.12 78);
	}

	.proof-pressure-cell[data-state='gated'] .proof-pressure-action {
		color: oklch(0.48 0.02 60);
	}

	@media (max-width: 780px) {
		.proof-pressure {
			grid-template-columns: 1fr;
		}
	}

	.proof-contract-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.35rem;
		padding: 0.625rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
		color: inherit;
		text-decoration: none;
	}

	.proof-contract-row--link {
		transition:
			border-color 160ms ease,
			background-color 160ms ease;
	}

	.proof-contract-row--link:hover,
	.proof-contract-row--link:focus-visible {
		border-top-color: var(--coord-route-solid, #3bc4b8);
		background: color-mix(in oklch, var(--coord-route-solid, #3bc4b8), transparent 94%);
		outline: none;
	}

	@media (min-width: 860px) {
		.proof-contract-row {
			grid-template-columns: minmax(10rem, 1fr) 5.25rem 7.75rem auto minmax(0, 1.15fr);
			align-items: baseline;
		}
	}

	.proof-contract-main {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.proof-contract-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.proof-contract-effect,
	.proof-contract-gate,
	.proof-contract-handoff,
	.proof-contract-meta {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.proof-contract-meta {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-quaternary, oklch(0.62 0.01 60));
	}

	.proof-contract-handoff {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		color: oklch(0.44 0.012 60);
	}

	.proof-contract-action {
		color: oklch(0.5 0.012 60);
		text-transform: none;
		letter-spacing: 0;
		white-space: nowrap;
	}

	.proof-contract-row[data-state='live'] .proof-contract-state,
	.proof-contract-row[data-state='live'] .proof-contract-action {
		color: var(--coord-verified, #10b981);
	}

	.proof-contract-row[data-state='partial'] .proof-contract-state,
	.proof-contract-row[data-state='partial'] .proof-contract-action {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.proof-contract-row[data-state='draft-only'] {
		border-top-style: dashed;
	}

	.proof-contract-row[data-state='draft-only'] .proof-contract-state,
	.proof-contract-row[data-state='draft-only'] .proof-contract-action {
		color: oklch(0.62 0.12 78);
	}

	.proof-contract-row[data-state='gated'] {
		border-top-style: dashed;
	}

	.proof-contract-row[data-state='gated'] .proof-contract-state,
	.proof-contract-row[data-state='gated'] .proof-contract-action {
		color: oklch(0.48 0.02 60);
	}
</style>
