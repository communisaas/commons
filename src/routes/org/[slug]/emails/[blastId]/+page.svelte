<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import { FEATURES } from '$lib/config/features';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import {
		buildEmailDeliveryEvidenceReadiness,
		getGateEvidence,
		type CapabilityState,
		type EmailDeliveryEvidenceRow
	} from '$lib/data/capability-hypergraph';
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	type EmailBlast = {
		id: string;
		subject: string;
		status: string;
		abVariant?: string | null;
		totalRecipients: number;
		totalSent: number;
		totalBounced: number;
		totalOpened: number;
		totalClicked: number;
		totalComplained?: number;
		sentAt: string | null;
		createdAt?: string;
		abWinnerPickedAt?: string | null;
	};

	type BounceEvent = {
		email: string;
		timestamp: string | null;
	};

	type ViewData = Omit<PageData, 'blast' | 'variants' | 'winnerBlast' | 'bounceEvents'> & {
		abConfig?: {
			winnerMetric?: string | null;
			winnerMetricSupported?: boolean;
			winnerBlastId?: string | null;
			testGroupPct?: number | null;
			splitPct?: number | null;
			cohortSnapshot?: {
				totalCount?: number | null;
				testCount?: number | null;
				variantACount?: number | null;
				variantBCount?: number | null;
				remainderCount?: number | null;
			} | null;
		} | null;
		abCohort?: {
			totalCount: number;
			testCount: number;
			variantACount: number;
			variantBCount: number;
			remainderCount: number;
			remainderBlastId: string | null;
		} | null;
		blast: EmailBlast;
		variants: Array<EmailBlast | null>;
		remainderDraft: EmailBlast | null;
		winnerBlast: EmailBlast | null;
		receiptSummary: {
			pageCount: number;
			sentCount: number;
			failedCount: number;
			hasMore: boolean;
		};
		bounceEvents: BounceEvent[];
		serverDispatchRuntimeReady: boolean;
	};
	type AbContinuationPressureReadout = {
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

	let { data, form }: { data: ViewData; form?: { error?: string; errorCode?: string } } = $props();

	function pct(num: number, denom: number): string {
		if (denom === 0) return '0.0%';
		return ((num / denom) * 100).toFixed(1) + '%';
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '--';
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	const metricLabels: Record<string, string> = {
		open: 'Open Rate',
		click: 'Click Rate'
	};

	function winnerMetricLabel(metric: string | null | undefined): string {
		if (!metric) return metricLabels.open;
		return metricLabels[metric] ?? 'Unsupported metric';
	}

	function bounceRate(bounced: number, sent: number): number {
		if (sent === 0) return 0;
		return (bounced / sent) * 100;
	}

	function bounceRateColor(rate: number): string {
		if (rate < 2) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
		if (rate <= 5) return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
		return 'bg-red-500/15 text-red-400 border-red-500/20';
	}

	// Compute total bounced/sent across all relevant blasts
	const totalBounced = $derived(
		data.isAbTest
			? data.variants.reduce((sum, v) => sum + (v?.totalBounced ?? 0), 0)
			: data.blast.totalBounced
	);
	const totalSent = $derived(
		data.isAbTest
			? data.variants.reduce((sum, v) => sum + (v?.totalSent ?? 0), 0)
			: data.blast.totalSent
	);
	const totalOpened = $derived(
		data.isAbTest
			? data.variants.reduce((sum, v) => sum + (v?.totalOpened ?? 0), 0)
			: data.blast.totalOpened
	);
	const totalClicked = $derived(
		data.isAbTest
			? data.variants.reduce((sum, v) => sum + (v?.totalClicked ?? 0), 0)
			: data.blast.totalClicked
	);
	const totalComplained = $derived(
		data.isAbTest
			? data.variants.reduce((sum, v) => sum + (v?.totalComplained ?? 0), 0)
			: (data.blast.totalComplained ?? 0)
	);
	const rate = $derived(bounceRate(totalBounced, totalSent));
	const abWinnerPickedAt = $derived(
		data.variants.find((variant) => variant?.abWinnerPickedAt)?.abWinnerPickedAt ?? null
	);
	const recordedWinnerBlastId = $derived(data.abConfig?.winnerBlastId ?? null);
	const abWinnerMetricSupported = $derived(data.abConfig?.winnerMetricSupported !== false);
	const canMaterializeAbRemainder = $derived(
		abWinnerMetricSupported || Boolean(recordedWinnerBlastId)
	);
	const abWinnerVariant = $derived(data.variants.find((variant) => isWinner(variant)) ?? null);
	const hasExperimentView = $derived(data.isAbTest && data.variants.length >= 2);
	const suppressedSignal = $derived(totalBounced + totalComplained);
	const abRemainderSignal = $derived(
		data.abCohort?.remainderCount ?? data.abConfig?.cohortSnapshot?.remainderCount ?? null
	);
	const hasDraftAbVariant = $derived(data.variants.some((variant) => variant?.status === 'draft'));
	const hasQueuedOrSentAbVariant = $derived(
		data.variants.some((variant) =>
			['scheduled', 'sending', 'sent'].includes(variant?.status ?? '')
		)
	);
	const hasDraftRemainder = $derived(data.remainderDraft?.status === 'draft');
	const hasQueuedOrSentRemainder = $derived(
		!!data.remainderDraft && ['scheduled', 'sending', 'sent'].includes(data.remainderDraft.status)
	);
	const serverDispatchRuntimeArmed = $derived(
		FEATURES.EMAIL_SERVER_DISPATCH && data.serverDispatchRuntimeReady
	);
	const base = $derived(`/org/${data.org.slug}`);
	const emailProxyGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Email send proxy',
		dependency: 'AWS Lambda deploy + BLAST receipts secret sync'
	});
	const receiptAnchoringGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2', 'T8-8'], {
		name: 'Email receipt and response',
		downstream: 8,
		dependency: 'Receipt writer/mainnet anchoring + reader-side notifications'
	});
	const abAutomationGate = getGateEvidence('CP-ab-automated-dispatch', ['T1-6b'], {
		name: 'A/B automated dispatch',
		downstream: 1,
		dependency: 'Idempotent test-cohort and winning-remainder send runner'
	});
	const listHealthGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Bounce and complaint attribution',
		dependency: 'SES webhook correlation + List-Unsubscribe receipt path'
	});
	const engagementTelemetryGate = getGateEvidence('CP-email-engagement-attribution', ['T2-10'], {
		name: 'Email engagement attribution',
		downstream: 1,
		dependency: 'SES open/click attribution + Configuration Set evidence'
	});

	const emailDeliveryEvidence = $derived(
		buildEmailDeliveryEvidenceReadiness({
			base,
			blastId: data.blast.id,
			delivery: {
				status: data.blast.status,
				totalSent,
				totalOpened,
				totalClicked,
				totalBounced,
				totalComplained,
				receiptPageCount: data.receiptSummary.pageCount,
				receiptSentCount: data.receiptSummary.sentCount,
				receiptFailedCount: data.receiptSummary.failedCount,
				receiptHasMore: data.receiptSummary.hasMore,
				engagementMetricsEnabled: FEATURES.ENGAGEMENT_METRICS,
				hasExperimentView,
				abWinnerPickedAt,
				hasDraftAbVariant,
				hasQueuedOrSentAbVariant,
				hasDraftRemainder,
				hasQueuedOrSentRemainder,
				hasRemainderDraft: !!data.remainderDraft,
				abRemainderCount: abRemainderSignal,
				serverDispatchRuntimeArmed
			},
			gates: {
				emailProxyGate,
				receiptAnchoringGate,
				abAutomationGate,
				listHealthGate,
				engagementTelemetryGate
			}
		})
	);

	function emailDetailHref(row: EmailDeliveryEvidenceRow): string {
		if (row.id === 'delivery-record') return '#email-record';
		if (row.id === 'engagement-telemetry') return '#email-engagement-telemetry';
		if (row.id === 'receipt-evidence') return '#email-receipt-evidence';
		if (row.id === 'experiment-continuation') {
			return hasExperimentView ? '#email-experiment-boundary' : row.href;
		}
		if (row.id === 'list-health-response') return '#email-list-health';
		return row.href;
	}

	const capabilityItems = $derived(
		emailDeliveryEvidence.detailRows.map((row) => ({
			...row,
			href: emailDetailHref(row)
		}))
	);
	const experimentContinuationRow = $derived(
		emailDeliveryEvidence.detailRows.find((row) => row.id === 'experiment-continuation') ?? null
	);
	const abSnapshotCount = $derived(
		data.abCohort?.totalCount ?? data.abConfig?.cohortSnapshot?.totalCount ?? null
	);
	const abContinuationPressureReadouts = $derived<AbContinuationPressureReadout[]>([
		{
			id: 'ab-snapshot-ground',
			label: 'Snapshot ground',
			state: data.abCohort ? 'partial' : data.abConfig?.cohortSnapshot ? 'draft-only' : 'gated',
			title: 'Exact cohort snapshot',
			action: data.abCohort ? 'read cohort snapshot' : 'create exact test',
			detail: data.abCohort
				? 'Stored email-hash cohorts define the test split and held-back remainder; tags and segments are not reselected at dispatch.'
				: 'No stored A/B cohort snapshot is loaded for this record; continuation cannot claim exact cohort custody.',
			gate:
				experimentContinuationRow?.unlock ??
				'Exact A/B continuation requires stored cohort snapshots and runtime-gated dispatch.',
			href: '#email-experiment-boundary',
			metric: {
				value: abSnapshotCount,
				label: 'snapshot people',
				cite: data.abCohort ? 'emailAbTestCohorts.totalCount' : 'abTestConfig.cohortSnapshot'
			}
		},
		{
			id: 'ab-held-remainder',
			label: 'Held remainder',
			state:
				abRemainderSignal !== null ? (data.remainderDraft ? 'partial' : 'draft-only') : 'gated',
			title: data.remainderDraft ? 'Remainder draft materialized' : 'Remainder held',
			action: data.remainderDraft ? 'open remainder draft' : 'create remainder draft',
			detail:
				abRemainderSignal !== null
					? 'The held-back cohort stays exact until a recorded winner materializes the remainder draft or runtime-ready dispatch queues it.'
					: 'No held-back remainder count is available for this experiment record.',
			gate: abWinnerMetricSupported
				? (experimentContinuationRow?.unlock ??
					'A/B continuation remains held by the server-dispatch gate.')
				: 'Verified-action A/B winner selection is not armed; a recorded winner id is required before remainder materialization.',
			href: '#email-experiment-boundary',
			metric: {
				value: abRemainderSignal,
				label: 'held-back people',
				cite: 'emailAbTestCohorts.remainderCount'
			}
		},
		{
			id: 'ab-dispatch-gate',
			label: 'Dispatch gate',
			state: experimentContinuationRow?.state ?? 'draft-only',
			title: serverDispatchRuntimeArmed ? 'Runtime checks clear' : 'Server dispatch held',
			action: experimentContinuationRow?.action ?? 'read experiment boundary',
			detail: serverDispatchRuntimeArmed
				? 'Exact test and remainder queue actions can pass through the runtime-gated server dispatch path.'
				: 'Exact queue hooks exist, but variants and remainder stay preserved drafts until SES, org-key, unsubscribe, and public URL checks pass.',
			gate:
				experimentContinuationRow?.unlock ??
				'A/B continuation stays dependency-first until server-dispatch runtime evidence clears.',
			href: '#email-experiment-boundary',
			metric: {
				value: serverDispatchRuntimeArmed ? 1 : 0,
				label: 'runtime ready',
				cite: 'EMAIL_SERVER_DISPATCH + getEmailServerDispatchReadiness'
			}
		}
	]);
	const engagementTelemetryGateSummary = $derived(
		emailDeliveryEvidence.detailRows.find((row) => row.id === 'engagement-telemetry')?.unlock ??
			emailDeliveryEvidence.gate
	);

	function isWinner(variant: (typeof data.variants)[0]): boolean {
		if (!data.isAbTest || data.variants.length < 2) return false;
		if (recordedWinnerBlastId) return variant?.id === recordedWinnerBlastId;
		if (!abWinnerMetricSupported) return false;
		const a = data.variants[0];
		const b = data.variants[1];
		if (!a || !b) return false;
		const metric = data.abConfig?.winnerMetric ?? 'open';
		const scoreA = getScore(a, metric);
		const scoreB = getScore(b, metric);
		if (variant?.abVariant === 'A') return scoreA >= scoreB;
		return scoreB > scoreA;
	}

	function getScore(v: (typeof data.variants)[0], metric: string): number {
		if (!v) return 0;
		const sent = v.totalSent || 1;
		if (metric === 'click') return v.totalClicked / sent;
		return v.totalOpened / sent;
	}

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

<div class="space-y-6">
	<!-- Header -->
	<div id="email-record" class="flex scroll-mt-24 items-center gap-4">
		<a
			href="/org/{data.org.slug}/emails"
			class="text-text-tertiary hover:text-text-secondary transition-colors"
			aria-label="Back to emails"
		>
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
				/>
			</svg>
		</a>
		<div class="flex items-center gap-3">
			<div>
				<h1 class="text-text-primary text-xl font-semibold">
					{#if data.isAbTest}A/B Test Group{:else}Email Details{/if}
				</h1>
				<p class="text-text-tertiary mt-1 text-sm">
					{data.blast.subject}
				</p>
			</div>
			{#if FEATURES.ENGAGEMENT_METRICS && totalSent > 0}
				<span
					class="inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs {bounceRateColor(
						rate
					)}"
				>
					{rate.toFixed(1)}% bounced
				</span>
			{/if}
		</div>
	</div>

	<WorkspaceCapabilityStrip label="Email detail capability" items={capabilityItems} />

	{#if !FEATURES.ENGAGEMENT_METRICS}
		<div
			id="email-engagement-telemetry"
			class="border-surface-border bg-surface-base rounded-md border p-4"
			aria-label="Email engagement telemetry boundary"
		>
			<p class="text-text-secondary text-sm font-medium">Engagement telemetry boundary</p>
			<p class="font-brand text-text-tertiary mt-1 text-xs">{engagementTelemetryGateSummary}</p>
		</div>
	{/if}

	{#if data.isAbTest && data.variants.length >= 2}
		{@const config = data.abConfig}

		<div class="grid gap-3 md:grid-cols-3" aria-label="A/B continuation pressure">
			{#each abContinuationPressureReadouts as readout (readout.id)}
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

		<!-- Config summary -->
		<div
			class="border-surface-border bg-surface-base text-text-tertiary flex items-center gap-6 rounded-lg border px-4 py-3 text-xs"
		>
			<span
				>Winner by: <span class="text-text-secondary"
					>{winnerMetricLabel(config?.winnerMetric)}</span
				></span
			>
			<span>Test group: <span class="text-text-secondary">{config?.testGroupPct ?? 20}%</span></span
			>
			<span
				>Split: <span class="text-text-secondary"
					>{config?.splitPct ?? 50}/{100 - (config?.splitPct ?? 50)}</span
				></span
			>
			{#if abWinnerPickedAt}
				<span
					>Winner picked: <span class="text-text-secondary">{formatDate(abWinnerPickedAt)}</span
					></span
				>
			{:else}
				<span class="text-amber-400">Waiting for results...</span>
			{/if}
		</div>

		<!-- Side-by-side comparison -->
		<div
			id={FEATURES.ENGAGEMENT_METRICS ? 'email-engagement-telemetry' : undefined}
			class="grid grid-cols-1 gap-4 md:grid-cols-2"
		>
			{#each data.variants as variant, i (variant?.id ?? i)}
				{#if variant}
					{@const winner = isWinner(variant)}
					<div
						class="rounded-md border {winner
							? 'border-teal-500/30 bg-teal-500/5'
							: 'border-surface-border bg-surface-base'} space-y-4 p-6"
					>
						<div class="flex items-center justify-between">
							<h2 class="text-text-primary text-lg font-medium">Variant {variant.abVariant}</h2>
							{#if winner && abWinnerPickedAt}
								<span
									class="rounded-md border border-teal-500/20 bg-teal-500/15 px-2 py-0.5 font-mono text-xs text-teal-400"
									>WINNER</span
								>
							{/if}
						</div>

						<p class="text-text-secondary truncate text-sm">{variant.subject}</p>

						<div class="grid grid-cols-2 gap-3">
							<div class="bg-surface-overlay rounded-lg px-3 py-2.5">
								<p class="text-text-tertiary text-xs">Status</p>
								<p class="text-text-primary font-mono text-lg tabular-nums">{variant.status}</p>
							</div>
							<div class="bg-surface-overlay rounded-lg px-3 py-2.5">
								<p class="text-text-tertiary text-xs">Sent</p>
								<p class="text-text-primary font-mono text-lg tabular-nums">
									{variant.totalSent.toLocaleString()}
								</p>
							</div>
							{#if FEATURES.ENGAGEMENT_METRICS}
								<div class="bg-surface-overlay rounded-lg px-3 py-2.5">
									<p class="text-text-tertiary text-xs">Opened</p>
									<p class="text-text-primary font-mono text-lg tabular-nums">
										{variant.totalOpened.toLocaleString()}
									</p>
									<p class="text-text-tertiary font-mono text-xs">
										{pct(variant.totalOpened, variant.totalSent)}
									</p>
								</div>
								<div class="bg-surface-overlay rounded-lg px-3 py-2.5">
									<p class="text-text-tertiary text-xs">Clicked</p>
									<p class="text-text-primary font-mono text-lg tabular-nums">
										{variant.totalClicked.toLocaleString()}
									</p>
									<p class="text-text-tertiary font-mono text-xs">
										{pct(variant.totalClicked, variant.totalSent)}
									</p>
								</div>
								<div class="bg-surface-overlay rounded-lg px-3 py-2.5">
									<p class="text-text-tertiary text-xs">Bounced</p>
									<p class="text-text-primary font-mono text-lg tabular-nums">
										{variant.totalBounced.toLocaleString()}
									</p>
									<p class="text-text-tertiary font-mono text-xs">
										{pct(variant.totalBounced, variant.totalSent)}
									</p>
								</div>
							{/if}
						</div>

						<p class="text-text-quaternary text-xs">Sent {formatDate(variant.sentAt)}</p>
					</div>
				{/if}
			{/each}
		</div>

		<div
			id="email-experiment-boundary"
			class="border-surface-border bg-surface-base space-y-2 rounded-md border p-6"
		>
			<h3 class="text-text-secondary text-sm font-medium">A/B continuation</h3>
			{#if data.abCohort}
				<div class="grid grid-cols-2 gap-3 py-2 text-xs md:grid-cols-4">
					<div>
						<p class="text-text-quaternary">Snapshot</p>
						<p class="text-text-secondary font-mono tabular-nums">
							{data.abCohort.totalCount.toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-text-quaternary">Test cohort</p>
						<p class="text-text-secondary font-mono tabular-nums">
							{data.abCohort.testCount.toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-text-quaternary">Variant split</p>
						<p class="text-text-secondary font-mono tabular-nums">
							{data.abCohort.variantACount.toLocaleString()} / {data.abCohort.variantBCount.toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-text-quaternary">Remainder</p>
						<p class="text-text-secondary font-mono tabular-nums">
							{data.abCohort.remainderCount.toLocaleString()}
						</p>
					</div>
				</div>
			{/if}
			{#if !abWinnerMetricSupported}
				<div class="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
					<p class="text-xs font-medium text-amber-300">
						Verified-action A/B winner selection is not armed
					</p>
					<p class="text-text-tertiary mt-1 text-xs leading-relaxed">
						This older experiment names a winner metric that is not backed by the current picker. A
						recorded winner id can still preserve exact remainder custody; otherwise create a new
						open/click experiment.
					</p>
				</div>
			{/if}
			{#if abWinnerPickedAt && data.remainderDraft}
				<p class="text-text-tertiary text-sm">
					Winner marker recorded for Variant {abWinnerVariant?.abVariant ?? 'A'}. The held-back
					remainder cohort has been materialized as an exact draft with status
					<span class="text-text-secondary font-mono">{data.remainderDraft.status}</span>.
				</p>
				<div class="flex flex-wrap gap-2 pt-1">
					{#if serverDispatchRuntimeArmed && hasDraftRemainder}
						<form method="POST" action="?/sendRemainder">
							<input
								type="hidden"
								name="winnerBlastId"
								value={abWinnerVariant?.id ?? data.blast.id}
							/>
							<button
								type="submit"
								class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
							>
								Queue remainder send
							</button>
						</form>
					{/if}
					<a
						href="/org/{data.org.slug}/emails/{data.remainderDraft.id}"
						class="inline-flex rounded-md border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 text-sm font-medium text-teal-300 transition-colors hover:bg-teal-500/15"
					>
						Open remainder draft
					</a>
				</div>
			{:else if abWinnerPickedAt && data.abCohort?.remainderCount && canMaterializeAbRemainder}
				<p class="text-text-tertiary text-sm">
					Winner marker recorded for Variant {abWinnerVariant?.abVariant ?? 'A'}. Create a follow-up
					draft for the held-back cohort using the winning subject and body.
				</p>
				{#if serverDispatchRuntimeArmed}
					<form method="POST" action="?/sendRemainder" class="pt-1">
						<input
							type="hidden"
							name="winnerBlastId"
							value={abWinnerVariant?.id ?? data.blast.id}
						/>
						<button
							type="submit"
							class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
						>
							Create and queue remainder
						</button>
					</form>
				{:else}
					<form method="POST" action="?/createRemainderDraft" class="pt-1">
						<input
							type="hidden"
							name="winnerBlastId"
							value={abWinnerVariant?.id ?? data.blast.id}
						/>
						<button
							type="submit"
							class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
						>
							Create remainder draft
						</button>
					</form>
				{/if}
			{:else if abWinnerPickedAt && data.abCohort?.remainderCount}
				<p class="text-text-tertiary text-sm">
					Winner marker exists, but this experiment has no recorded winner id for its unsupported
					metric. The held-back cohort remains preserved; create a new open/click experiment before
					claiming automated continuation.
				</p>
			{:else if abWinnerPickedAt}
				<p class="text-text-tertiary text-sm">
					Winner marker recorded for Variant {abWinnerVariant?.abVariant ?? 'A'}, but this older
					test has no stored cohort snapshot. Create a new A/B test to preserve the remainder
					contract.
				</p>
			{:else if hasDraftAbVariant}
				<p class="text-text-tertiary text-sm">
					Linked variant drafts exist{data.abCohort ? ' with exact test-cohort filters' : ''}. The
					runner will not reselect tags or saved segments.
				</p>
				{#if serverDispatchRuntimeArmed}
					<form method="POST" action="?/sendTestCohorts" class="pt-1">
						<button
							type="submit"
							class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
						>
							Queue test cohorts
						</button>
					</form>
				{:else}
					<p class="text-text-quaternary text-xs">
						Exact test-cohort queueing is wired, but this runtime keeps the variants draft-only
						until SES, org-key, and unsubscribe dependencies pass.
					</p>
				{/if}
			{:else}
				<p class="text-text-tertiary text-sm">
					Sibling variants are visible here. The winner picker can mark the stronger sent variant;
					the stored runner keeps test and remainder dispatch bounded by exact cohort snapshots.
				</p>
			{/if}
			{#if form?.error}
				<p class="text-sm text-red-400">{form.error}</p>
			{/if}
		</div>
	{:else}
		<!-- Non-A/B blast detail -->
		{#if FEATURES.ENGAGEMENT_METRICS}
			<div
				id="email-engagement-telemetry"
				class="border-surface-border bg-surface-base rounded-md border p-6"
			>
				<div class="grid grid-cols-2 gap-4 md:grid-cols-4">
					<div>
						<p class="text-text-tertiary text-xs">Sent</p>
						<p class="text-text-primary font-mono text-xl tabular-nums">
							{data.blast.totalSent.toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-text-tertiary text-xs">Opened</p>
						<p class="text-text-primary font-mono text-xl tabular-nums">
							{data.blast.totalOpened.toLocaleString()}
						</p>
						<p class="text-text-tertiary font-mono text-xs">
							{pct(data.blast.totalOpened, data.blast.totalSent)}
						</p>
					</div>
					<div>
						<p class="text-text-tertiary text-xs">Clicked</p>
						<p class="text-text-primary font-mono text-xl tabular-nums">
							{data.blast.totalClicked.toLocaleString()}
						</p>
						<p class="text-text-tertiary font-mono text-xs">
							{pct(data.blast.totalClicked, data.blast.totalSent)}
						</p>
					</div>
					<div>
						<p class="text-text-tertiary text-xs">Bounced</p>
						<p class="text-text-primary font-mono text-xl tabular-nums">
							{data.blast.totalBounced.toLocaleString()}
						</p>
						<p class="text-text-tertiary font-mono text-xs">
							{pct(data.blast.totalBounced, data.blast.totalSent)}
						</p>
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Delivery receipts surface — bounded per-recipient send register -->
	<div
		id="email-receipt-evidence"
		class="border-surface-border bg-surface-base flex items-center justify-between gap-4 rounded-md border p-6"
	>
		<div>
			<h3 class="text-text-secondary text-sm font-medium">Delivery receipts</h3>
			<p class="font-brand text-text-tertiary mt-1 text-xs">
				Per-recipient SES messageId, status, and error appear when this blast has receipt rows. Sent
				counters alone are not treated as durable receipt proof.
				{#if data.receiptSummary.pageCount > 0}
					Loaded {data.receiptSummary.pageCount} receipt row{data.receiptSummary.pageCount === 1
						? ''
						: 's'}{data.receiptSummary.hasMore ? ' on the first page' : ''}.
				{:else}
					No receipt rows are loaded for this record.
				{/if}
			</p>
		</div>
		<a href="receipts" class="font-brand text-sm font-medium text-indigo-600 hover:text-indigo-800">
			View receipts →
		</a>
	</div>

	<div
		id="email-list-health"
		class="border-surface-border bg-surface-base space-y-2 rounded-md border p-6"
	>
		<div class="flex items-baseline justify-between gap-4">
			<h3 class="text-text-secondary text-sm font-medium">List-health response</h3>
			<span class="text-text-tertiary font-mono text-xs">
				{suppressedSignal.toLocaleString()} bounce/complaint counter{suppressedSignal === 1
					? ''
					: 's'}
			</span>
		</div>
		<p class="font-brand text-text-tertiary text-xs">
			Bounce and complaint counters are delivery-record evidence. People suppression updates remain
			the list-health source of truth; this page does not invent a complete campaign-level complaint
			metric.
		</p>
	</div>

	<!-- Bounced Recipients -->
	{#if FEATURES.ENGAGEMENT_METRICS && data.bounceEvents.length > 0}
		<div class="border-surface-border bg-surface-base space-y-3 rounded-md border p-6">
			<h3 class="text-text-secondary text-sm font-medium">
				Bounced Recipients
				<span class="text-text-tertiary ml-2 font-mono">{data.bounceEvents.length}</span>
			</h3>
			<div class="divide-surface-border divide-y">
				{#each data.bounceEvents as event}
					<div class="flex items-center justify-between py-2 text-sm">
						<span class="text-text-tertiary font-mono">{event.email}</span>
						<span class="text-text-quaternary text-xs">{formatDate(event.timestamp)}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
