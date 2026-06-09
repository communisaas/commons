<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import { FEATURES } from '$lib/config/features';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import {
		buildSendReadiness,
		formatGateEvidence,
		getGateEvidence,
		type SendReadinessMode
	} from '$lib/data/capability-hypergraph';
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	type CapabilityState = 'live' | 'partial' | 'draft-only' | 'gated';
	type EmailSendPressureReadout = {
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

	let { data }: { data: PageData } = $props();

	const canCreate = $derived(data.membership.role === 'owner' || data.membership.role === 'editor');
	const draftCount = $derived(data.blasts.filter((blast) => blast.status === 'draft').length);
	const sentCount = $derived(data.blasts.filter((blast) => blast.status === 'sent').length);
	const failedCount = $derived(data.blasts.filter((blast) => blast.status === 'failed').length);
	const emailReceiptResponseGate = getGateEvidence(
		'CP-receipt-anchoring',
		['T6-1', 'T6-2', 'T8-8'],
		{
			name: 'Email receipt and response',
			downstream: 8,
			dependency: 'Receipt writer/mainnet anchoring + reader-side notifications'
		}
	);
	const emailProxyGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Email send proxy',
		dependency: 'AWS Lambda deploy + BLAST receipts secret sync'
	});
	const abAutomationGate = getGateEvidence('CP-ab-automated-dispatch', ['T1-6b'], {
		name: 'A/B automated dispatch',
		downstream: 1,
		dependency: 'Idempotent test-cohort and winning-remainder send runner'
	});
	const smsDispatchGate = getGateEvidence('CP-sms-dispatch', ['T2-1'], {
		name: 'SMS dispatch',
		downstream: 2,
		dependency: 'Client-side phone decryptor + Twilio proxy'
	});
	const eventArtifactGate = getGateEvidence('CP-event-artifacts', ['T6-7'], {
		name: 'Event artifacts',
		downstream: 1,
		dependency: 'Calendar-provider sync, QR check-in, and anchored event receipts'
	});
	const workflowEffectsGate = getGateEvidence('CP-workflow-execution', ['T1-9a'], {
		name: 'Bounded workflow runner',
		downstream: 3,
		dependency: 'Trigger dispatch + tag/branch/delay runner'
	});
	const congressionalLaunchGate = getGateEvidence('CP-congressional-launch', ['NEW-A-7'], {
		name: 'Congressional launch gate',
		dependency: 'CWC production credentials + proof-authority launch flag'
	});
	const base = $derived(`/org/${data.org.slug}`);
	const emailDeliveryHref = $derived(`${base}/emails/compose#email-delivery`);
	const emailDelivery = $derived(data.spaces.operating?.emailDelivery ?? null);
	const textDelivery = $derived(data.spaces.operating?.textDelivery ?? null);
	const congressionalDelivery = $derived(data.spaces.operating?.congressionalDelivery ?? null);
	const sendReadiness = $derived(
		buildSendReadiness({
			base,
			emailDeliveryHref,
			canPublish: canCreate,
			emailDelivery,
			textDispatch: textDelivery
				? {
						runtimeReady: textDelivery.dispatchRuntimeReady,
						runtimeMissing: textDelivery.dispatchRuntimeMissing,
						runtimeDependency: textDelivery.dispatchRuntimeDependency,
						runtimeMessage: textDelivery.dispatchRuntimeMessage,
						clientBatchRouteMounted: textDelivery.dispatchClientBatchRouteMounted
					}
				: null,
			congressionalDelivery,
			fallbackSubscribedCount: data.spaces.base?.emailHealth.subscribed ?? null,
			features: {
				EMAIL_CLIENT_DIRECT_MERGE: FEATURES.EMAIL_CLIENT_DIRECT_MERGE,
				EMAIL_SERVER_DISPATCH: FEATURES.EMAIL_SERVER_DISPATCH,
				AB_TESTING: FEATURES.AB_TESTING,
				SMS_DISPATCH: FEATURES.SMS_DISPATCH,
				EVENTS: FEATURES.EVENTS,
				WORKFLOW_EXECUTION: FEATURES.WORKFLOW_EXECUTION,
				CONGRESSIONAL: FEATURES.CONGRESSIONAL
			},
			gates: {
				emailProxyGate,
				abAutomationGate,
				smsDispatchGate,
				eventArtifactGate,
				workflowEffectsGate,
				congressionalLaunchGate
			}
		})
	);
	const sendReadinessModes = $derived<SendReadinessMode[]>(sendReadiness.modes);
	const abBlasts = $derived(data.blasts.filter((blast) => blast.isAbTest));
	const abGroupCount = $derived(
		new Set(abBlasts.map((blast) => blast.abParentId ?? blast.id)).size
	);
	const abDraftCount = $derived(abBlasts.filter((blast) => blast.status === 'draft').length);

	function requiredSendMode(
		modes: SendReadinessMode[],
		key: SendReadinessMode['key']
	): SendReadinessMode {
		const mode = modes.find((candidate) => candidate.key === key);
		if (!mode) throw new Error(`Missing send readiness mode: ${key}`);
		return mode;
	}

	const browserDirectMode = $derived(requiredSendMode(sendReadinessModes, 'browser-direct'));
	const serverDispatchMode = $derived(requiredSendMode(sendReadinessModes, 'server-email'));
	const abContinuationMode = $derived(requiredSendMode(sendReadinessModes, 'ab-automation'));
	const abContinuationStateLabel = $derived(operatorCapabilityStateLabel(abContinuationMode.state));
	const deliveryRecordState = $derived<CapabilityState>(
		data.blasts.length > 0 ? 'partial' : 'draft-only'
	);
	const deliveryRecordGate = $derived(
		formatGateEvidence(emailReceiptResponseGate, {
			prefix: 'Anchor email receipt batches and add reader-side response notifications.'
		})
	);
	const nextSendLiftMode = $derived(sendReadiness.nextHeldMode ?? serverDispatchMode);
	const emailSendPressureReadouts = $derived<EmailSendPressureReadout[]>([
		{
			id: 'delivery-ground',
			label: 'Delivery ground',
			state: deliveryRecordState,
			title: 'Delivery records',
			action: data.blasts.length > 0 ? 'read delivery records' : 'compose delivery',
			detail:
				data.blasts.length > 0
					? 'Saved email delivery records are visible; execution posture stays owned by each send path.'
					: 'No email delivery record exists yet; the composer starts as a draft until a send path is armed.',
			gate: deliveryRecordGate,
			href:
				data.blasts.length > 0
					? `/org/${data.org.slug}/emails`
					: `/org/${data.org.slug}/emails/compose#email-delivery`,
			metric: {
				value: data.blasts.length,
				label: 'records',
				cite: 'email.listBlasts'
			}
		},
		{
			id: 'browser-send-path',
			label: 'Browser path',
			state: browserDirectMode.state,
			title: browserDirectMode.handoff,
			action: browserDirectMode.action,
			detail: browserDirectMode.effect,
			gate: browserDirectMode.unlock,
			href: browserDirectMode.route,
			metric: browserDirectMode.metric ?? {
				value: data.spaces.base?.emailHealth.subscribed ?? null,
				label: 'subscribed cohort',
				cite: 'supporters.getSummaryStats.emailHealth'
			}
		},
		{
			id: 'next-send-lift',
			label: 'Next send lift',
			state: nextSendLiftMode.state,
			title: nextSendLiftMode.label,
			action: nextSendLiftMode.action,
			detail: nextSendLiftMode.effect,
			gate: nextSendLiftMode.unlock,
			href: nextSendLiftMode.route,
			metric: nextSendLiftMode.metric ?? {
				value: sendReadiness.heldCount,
				label: 'held send modes',
				cite: 'buildSendReadiness heldCount'
			}
		}
	]);
	const capabilityItems = $derived([
		{
			label: 'Delivery records',
			state: deliveryRecordState,
			phase: 'SEND / AGGREGATE',
			cluster: 'reader-side UX / accountability',
			action: data.blasts.length > 0 ? 'read delivery' : 'compose delivery',
			detail:
				data.blasts.length > 0
					? 'Draft and sent email records are visible; each delivery path states its own execution boundary in the composer.'
					: 'No email delivery record exists yet; composing starts as a draft until a send path is armed.',
			unlock: deliveryRecordGate,
			href:
				data.blasts.length > 0
					? `/org/${data.org.slug}/emails`
					: `/org/${data.org.slug}/emails/compose#email-delivery`,
			metric: {
				value: data.blasts.length,
				label: 'records',
				cite: 'email.listBlasts'
			}
		},
		{
			label: 'Browser-direct delivery',
			state: browserDirectMode.state,
			phase: 'SEND',
			cluster: 'reach / data sovereignty',
			action: browserDirectMode.action,
			detail: browserDirectMode.effect,
			unlock: browserDirectMode.unlock,
			href: emailDeliveryHref,
			metric: browserDirectMode.metric
		},
		{
			label: 'Server dispatch',
			state: serverDispatchMode.state,
			phase: 'SEND',
			cluster: 'accountability / data sovereignty',
			action: serverDispatchMode.action,
			detail: serverDispatchMode.effect,
			unlock: serverDispatchMode.unlock,
			href: emailDeliveryHref,
			metric: {
				value: draftCount,
				label: 'drafts',
				cite: 'emailBlasts.status'
			}
		},
		{
			label: 'A/B continuation',
			state: abContinuationMode.state,
			phase: abContinuationMode.phase,
			cluster: 'coordination integrity / reader-side UX',
			action: abContinuationMode.action,
			detail: abContinuationMode.effect,
			unlock: abContinuationMode.unlock,
			href: `${base}/emails#ab-continuation-boundary`,
			metric: {
				value: abGroupCount,
				label: 'A/B groups',
				cite: 'email.listBlasts abParentId'
			}
		},
		{
			label: 'Send boundary',
			state: sendReadiness.nextHeldMode?.state ?? sendReadiness.state,
			phase: 'SEND',
			cluster: 'coordination integrity',
			action: sendReadiness.nextHeldMode?.action ?? 'open email composer',
			detail:
				sendReadiness.heldCount > 0
					? `${sendReadiness.heldModeSummary}; ${sendReadiness.sendBoundarySummary}`
					: sendReadiness.sendBoundarySummary,
			unlock: sendReadiness.sendBoundaryGate,
			href: emailDeliveryHref,
			metric: {
				value: sendReadiness.heldCount,
				label: 'held send modes',
				cite: 'buildSendReadiness heldCount'
			}
		}
	]);

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

	function statusBadgeClass(status: string): string {
		switch (status) {
			case 'draft':
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
			case 'sending':
				return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
			case 'sent':
				return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'failed':
				return 'bg-red-500/15 text-red-400 border-red-500/20';
			default:
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
		}
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '--';
		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-text-primary text-xl font-semibold">Email delivery</h1>
			<p class="text-text-tertiary mt-1 text-sm">
				{data.blasts.length} delivery record{data.blasts.length === 1 ? '' : 's'} ·
				{sentCount} sent · {draftCount} draft{draftCount === 1 ? '' : 's'}{#if failedCount > 0}
					· {failedCount} failed{/if}
			</p>
		</div>
		{#if canCreate}
			<a
				href="/org/{data.org.slug}/emails/compose"
				class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500"
			>
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
				</svg>
				Compose delivery
			</a>
		{/if}
	</div>

	<WorkspaceCapabilityStrip label="Email delivery capability" items={capabilityItems} />

	<div class="grid gap-3 md:grid-cols-3" aria-label="Email send pressure">
		{#each emailSendPressureReadouts as readout (readout.id)}
			<a
				href={readout.href}
				class={pressureCellClass(readout.state)}
				data-sveltekit-preload-data="off"
				aria-label={`${readout.label}: ${operatorCapabilityStateLabel(readout.state)}; ${readout.detail}; ${readout.gate}`}
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

	<div
		id="ab-continuation-boundary"
		class="border-surface-border bg-surface-base rounded-md border p-5"
	>
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div class="min-w-0">
				<p class="font-mono text-xs tracking-[0.18em] text-teal-300 uppercase">A/B continuation</p>
				<h2 class="text-text-primary mt-1 text-lg font-medium">Experiment dispatch boundary</h2>
				<p class="text-text-tertiary mt-2 max-w-3xl text-sm">
					{abContinuationMode.effect}
				</p>
			</div>
			<a
				href="/org/{data.org.slug}/emails/compose#email-ab-test"
				class="border-surface-border bg-surface-overlay text-text-secondary hover:text-text-primary inline-flex rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:border-[var(--coord-route-solid)]"
			>
				Create A/B drafts
			</a>
		</div>
		<div class="mt-4 grid gap-3 text-sm sm:grid-cols-3">
			<div class="border-surface-border bg-surface-overlay rounded-md border px-3 py-2.5">
				<p class="text-text-quaternary text-xs">A/B groups</p>
				<p class="text-text-primary font-mono text-lg tabular-nums">{abGroupCount}</p>
				<p class="text-text-tertiary text-xs">email.listBlasts abParentId</p>
			</div>
			<div class="border-surface-border bg-surface-overlay rounded-md border px-3 py-2.5">
				<p class="text-text-quaternary text-xs">Variant drafts</p>
				<p class="text-text-primary font-mono text-lg tabular-nums">{abDraftCount}</p>
				<p class="text-text-tertiary text-xs">emailBlasts.status</p>
			</div>
			<div class="border-surface-border bg-surface-overlay rounded-md border px-3 py-2.5">
				<p class="text-text-quaternary text-xs">Send mode</p>
				<p class="text-text-primary font-mono text-lg tabular-nums">
					{abContinuationStateLabel}
				</p>
				<p class="text-text-tertiary text-xs">{abContinuationMode.handoff}</p>
			</div>
		</div>
		<p class="text-text-tertiary mt-4 text-sm">{abContinuationMode.unlock}</p>
	</div>

	<!-- Blast list -->
	{#if data.blasts.length === 0}
		<div class="bg-surface-base border-surface-border rounded-md border p-12 text-center">
			<div
				class="bg-surface-overlay mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
			>
				<svg
					class="text-text-quaternary h-6 w-6"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
					/>
				</svg>
			</div>
			<p class="text-text-tertiary text-sm">
				No delivery records yet. Compose a proof-aware email and the composer will mark which send
				path is armed.
			</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each data.blasts.filter((b) => !b.isAbTest || b.abVariant === 'A' || (!b.abVariant && !b.isAbTest)) as blast (blast.id)}
				{@const isAb = blast.isAbTest && blast.abVariant === 'A'}
				<a
					href="/org/{data.org.slug}/emails/{blast.id}"
					class="bg-surface-base border-surface-border block rounded-md border p-5 transition-colors hover:border-[var(--coord-route-solid)]"
				>
					<div class="flex items-start justify-between gap-4">
						<div class="min-w-0 flex-1">
							<div class="mb-2 flex items-center gap-3">
								<h2 class="text-text-primary truncate text-lg font-medium">
									{blast.subject}
								</h2>
								{#if isAb}
									<span
										class="inline-flex items-center rounded-md border border-teal-500/20 bg-teal-500/15 px-2 py-0.5 font-mono text-xs text-teal-400"
									>
										A/B
									</span>
								{/if}
								<span
									class="inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs {statusBadgeClass(
										blast.status
									)}"
								>
									{blast.status}
								</span>
							</div>

							<div class="text-text-tertiary flex items-center gap-4 text-xs">
								{#if blast.campaignTitle}
									<span class="flex items-center gap-1">
										<svg
											class="h-3 w-3"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="1.5"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
											/>
										</svg>
										Action: {blast.campaignTitle}
									</span>
								{/if}

								{#if FEATURES.ENGAGEMENT_METRICS}
									<span class="font-mono tabular-nums">
										{blast.totalSent.toLocaleString()} sent
									</span>

									{#if blast.totalBounced > 0}
										<span class="font-mono text-red-400 tabular-nums">
											{blast.totalBounced.toLocaleString()} bounced
										</span>
									{/if}
								{/if}

								<span class="font-mono tabular-nums">
									{formatDate(blast.sentAt ?? blast.createdAt)}
								</span>
							</div>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
