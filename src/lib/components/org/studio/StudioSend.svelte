<!--
  StudioSend — consummation. The channels an authored action can leave by.

  Honesty law (non-negotiable): a gated channel is NEVER presented as live.
    · Public action draft — ready only after a composed message exists and the
                            operator has draft handoff authority.
    · Email composer draft — ready only after a composed message exists and the
                             operator has draft handoff authority. STUDIO prefills
                             subject/body plus non-secret provenance; the
                             composer still owns cohort selection, preview, and
                             send confirmation.
    · CWC     — NOT YET ARMED. The Congress Web Connector path is gated until
                the launch gate opens and a real handoff handler exists. It is
                rendered disabled with an explicit mark, never as a clickable
                send.

  Per the build doc's interaction grammar, Send is per-channel and produces a
  Results receipt. This surface separates the concrete Studio handoffs available
  from the shared OS send-mode readiness contract. Today Studio can hand off to
  the public template creator and the org email composer as populated drafts.
  CWC and other held modes remain visible as route/evidence boundaries, not
  executable side effects.
-->
<script lang="ts">
	import { FileUp, Landmark, Mail, type Icon } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import { Datum, Ratio } from '$lib/design';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import {
		formatGateEvidence,
		getGateEvidence,
		type CapabilityState,
		type SendReadinessMode,
		type SendReadinessSummary
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments
	} from '$lib/data/capability-state-labels';
	import { TIMING, EASING } from '$lib/design/motion';

	type SendChannel = {
		key: 'template' | 'email' | 'cwc';
		name: string;
		kind: string;
		state: CapabilityState;
		enabled: boolean;
		handler?: () => void;
		icon: Component<Icon>;
		posture: string;
		gate: string;
		action: string;
		title?: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
		contract: SendChannelContract;
		primary?: boolean;
	};
	type SendChannelContract = {
		phase: SendReadinessMode['phase'] | 'HANDOFF';
		cluster: string;
		handoff: string;
		effect: string;
		source: string;
	};

	let {
		ready,
		canPublish,
		sendReadiness = null,
		onpublish,
		onemail,
		oncwc
	}: {
		/** True once a composed message exists to send. */
		ready: boolean;
		/** Role-derived: members can watch; owner/editor can publish. Display gate. */
		canPublish: boolean;
		/** Shared OS delivery-mode readiness from buildSendReadiness. */
		sendReadiness?: SendReadinessSummary | null;
		onpublish?: () => void;
		onemail?: () => void;
		oncwc?: () => void;
	} = $props();

	// CWC needs both the configured launch gate and an actual handoff handler.
	// A configuration change alone must not make this channel appear live.
	const congressionalLaunchGate = getGateEvidence('CP-congressional-launch', ['NEW-A-7'], {
		name: 'Congressional delivery launch',
		downstream: 1,
		dependency: 'First-org staging confirmation + CWC launch flag'
	});
	const browserDirectMode = $derived(
		sendReadiness?.modes.find((mode) => mode.key === 'browser-direct') ?? null
	);
	const cwcSendMode = $derived(sendReadiness?.modes.find((mode) => mode.key === 'cwc') ?? null);
	const cwcArmed = $derived(cwcSendMode?.state === 'live');
	const publishReady = $derived(ready && canPublish && Boolean(onpublish));
	const emailReady = $derived(ready && canPublish && Boolean(onemail));
	const cwcReady = $derived(ready && canPublish && cwcArmed && Boolean(oncwc));
	const publicTemplateState = $derived<CapabilityState>(publishReady ? 'draft-only' : 'gated');
	const orgEmailState = $derived<CapabilityState>(emailReady ? 'draft-only' : 'gated');
	const cwcState = $derived<CapabilityState>(cwcReady ? 'live' : 'gated');

	function handoffPosture(handler: (() => void) | undefined): string {
		if (!ready) return 'No authored artifact to hand off yet.';
		if (!canPublish) return 'Org authority required before draft handoff.';
		if (!handler) return 'Draft handoff is not wired for this channel.';
		return 'Draft transfer only; the delivery surface owns final confirmation.';
	}

	function handoffTitle(handler: (() => void) | undefined): string | undefined {
		if (!ready) return 'Finish the authoring loop first';
		if (!canPublish)
			return 'Your role can preserve the artifact but not hand it to delivery surfaces';
		if (!handler) return 'Draft handoff handler is not wired for this channel';
		return 'Creates a draft handoff; the delivery surface owns final confirmation';
	}

	function handoffGate(kind: 'template' | 'email', handler: (() => void) | undefined): string {
		if (!ready) return 'Composed output required before any draft handoff.';
		if (!canPublish)
			return (
				sendReadiness?.sendBoundaryGate ??
				'Draft handoff authority is required before Studio can write into delivery surfaces.'
			);
		if (!handler) return 'Studio has no draft handoff handler for this channel.';
		return kind === 'template'
			? 'Writes resolved audience, sources, composed message, scope, recoverable job handle, and trace id into a public template draft; the creator owns publish confirmation.'
			: 'Writes subject, body, scope, and non-secret Studio provenance into an org email composer draft; cohort, preview, and dispatch remain composer-owned.';
	}

	const publicTemplateGate = $derived(handoffGate('template', onpublish));
	const orgEmailGate = $derived(handoffGate('email', onemail));
	const cwcGateSummary = $derived(
		cwcSendMode?.unlock ??
			formatGateEvidence(congressionalLaunchGate, {
				prefix: 'Congressional delivery remains dependency-first.'
			})
	);
	const cwcPosture = $derived(
		!cwcArmed
			? 'Proof delivery boundary only; no congressional side effect.'
			: !oncwc
				? 'Congress proof handoff is armed, but Studio has no handler.'
				: cwcReady
					? 'Proof handoff can open; transport still verifies downstream.'
					: !ready
						? 'No authored artifact to prepare for Congress yet.'
						: !canPublish
							? 'Org authority required before proof handoff.'
							: 'Congress proof handoff is armed, but Studio has no handler.'
	);

	const cwcTitle = $derived(!cwcArmed ? cwcGateSummary : handoffTitle(oncwc));
	const cwcGate = $derived(
		!cwcArmed
			? cwcGateSummary
			: !oncwc
				? 'Congressional launch is armed, but Studio has no proof handoff handler.'
				: cwcReady
					? 'CWC proof handoff can open after proof, routing, and transport checks.'
					: !ready
						? 'Composed output is required before congressional delivery.'
						: !canPublish
							? 'Draft handoff authority is required before Studio can open proof delivery.'
							: cwcGateSummary
	);
	const publicTemplateContract = $derived<SendChannelContract>({
		phase: 'HANDOFF',
		cluster: 'C-reader-side / C-data-sovereignty',
		handoff: 'Public template creator',
		effect: publishReady
			? 'Creates a public action draft from emitted audience, sources, message, scope, recovery handle, and trace id.'
			: 'Holds the authored artifact in Studio until draft handoff authority and a delivery surface are available.',
		source: 'saveStudioProcessAsTemplateDraft'
	});
	const orgEmailContract = $derived<SendChannelContract>({
		phase: browserDirectMode?.phase ?? 'SEND',
		cluster: browserDirectMode?.cluster ?? 'C-reader-side',
		handoff: browserDirectMode?.handoff ?? 'Email composer',
		effect: browserDirectMode
			? `${browserDirectMode.effect} Studio creates only an email composer draft; cohort, preview, and dispatch confirmation stay composer-owned.`
			: 'Studio creates only an email composer draft; the composer owns delivery readiness, cohort, preview, and dispatch confirmation.',
		source: browserDirectMode?.metric?.cite ?? 'buildSendReadiness browser-direct'
	});
	const cwcContract = $derived<SendChannelContract>({
		phase: cwcSendMode?.phase ?? 'SEND',
		cluster: cwcSendMode?.cluster ?? 'C-verification',
		handoff: cwcSendMode?.handoff ?? 'Proof delivery',
		effect:
			cwcSendMode?.effect ??
			'Proof delivery remains a read-only boundary until runtime evidence and the congressional launch gate agree.',
		source: cwcSendMode?.metric?.cite ?? congressionalLaunchGate.source
	});

	const channelRows = $derived<SendChannel[]>([
		{
			key: 'template',
			name: 'Public action draft',
			kind: 'template creator handoff',
			state: publicTemplateState,
			enabled: publishReady,
			handler: onpublish,
			icon: FileUp,
			posture: handoffPosture(onpublish),
			gate: publicTemplateGate,
			action: 'create template draft',
			title: handoffTitle(onpublish),
			metric: {
				value: publishReady ? 1 : 0,
				label: 'draft handoff',
				cite: 'saveStudioProcessAsTemplateDraft'
			},
			contract: publicTemplateContract,
			primary: true
		},
		{
			key: 'email',
			name: 'Email composer draft',
			kind: 'delivery composer handoff',
			state: orgEmailState,
			enabled: emailReady,
			handler: onemail,
			icon: Mail,
			posture: handoffPosture(onemail),
			gate: orgEmailGate,
			action: 'create email draft',
			title: handoffTitle(onemail),
			metric: {
				value: emailReady ? 1 : 0,
				label: 'draft handoff',
				cite: 'saveStudioProcessAsOrgEmailDraft'
			},
			contract: orgEmailContract
		},
		{
			key: 'cwc',
			name: 'Congress proof delivery',
			kind: 'proof delivery handoff',
			state: cwcState,
			enabled: cwcReady,
			handler: oncwc,
			icon: Landmark,
			posture: cwcPosture,
			gate: cwcGate,
			action: cwcReady ? 'prepare proof handoff' : 'read proof-delivery boundary',
			title: cwcTitle,
			metric: {
				value: cwcReady ? 1 : 0,
				label: cwcReady ? 'proof handoff' : 'armed handoffs',
				cite: cwcSendMode?.metric?.cite ?? congressionalLaunchGate.source
			},
			contract: cwcContract
		}
	]);
	const channelStateCounts = $derived({
		live: channelRows.filter((channel) => channel.state === 'live').length,
		partial: channelRows.filter((channel) => channel.state === 'partial').length,
		'draft-only': channelRows.filter((channel) => channel.state === 'draft-only').length,
		gated: channelRows.filter((channel) => channel.state === 'gated').length
	});
	const channelSegments = $derived(operatorCapabilityStateRatioSegments(channelStateCounts));
	const draftHandoffCount = $derived(
		channelRows.filter((channel) => channel.state === 'draft-only').length
	);
	const executionHandoffCount = $derived(
		channelRows.filter((channel) => channel.state === 'live').length
	);
	const firstHeldMode = $derived(sendReadiness?.nextHeldMode ?? null);
	const deliveryModeRows = $derived<SendReadinessMode[]>(sendReadiness?.modes ?? []);
	const deliveryModeStateCounts = $derived({
		live: deliveryModeRows.filter((mode) => mode.state === 'live').length,
		partial: deliveryModeRows.filter((mode) => mode.state === 'partial').length,
		'draft-only': deliveryModeRows.filter((mode) => mode.state === 'draft-only').length,
		gated: deliveryModeRows.filter((mode) => mode.state === 'gated').length
	});
	const deliveryModeSegments = $derived(
		operatorCapabilityStateRatioSegments(deliveryModeStateCounts)
	);
	const heldDeliveryModeCount = $derived(
		deliveryModeStateCounts['draft-only'] + deliveryModeStateCounts.gated
	);
	const deliveryBoundaryState = $derived<CapabilityState>(sendReadiness?.state ?? 'gated');
	const deliveryBoundarySummary = $derived(
		sendReadiness?.sendBoundarySummary ??
			'Operating delivery ground is unread; Studio counts no send side effect from this view.'
	);
	const deliveryHeldModeSummary = $derived(sendReadiness?.heldModeSummary ?? 'no held handoffs');
	const deliveryBoundaryGate = $derived(
		sendReadiness?.sendBoundaryGate ??
			'Load the operating email-delivery slice before claiming delivery-surface readiness.'
	);
	const deliveryBoundaryAction = $derived(
		firstHeldMode
			? stateActionLabel(firstHeldMode.state, firstHeldMode.action)
			: deliveryBoundaryState === 'live'
				? 'read delivery modes ->'
				: 'context / read delivery boundary'
	);

	function stateLabel(state: CapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function stateActionLabel(state: CapabilityState, action: string): string {
		return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });
	}

	function actionLabel(channel: SendChannel): string {
		return stateActionLabel(channel.state, channel.action);
	}

	function modeActionLabel(mode: SendReadinessMode): string {
		return stateActionLabel(mode.state, mode.action);
	}

	function channelAriaLabel(channel: SendChannel): string {
		return `${channel.name}: ${stateLabel(channel.state)}. ${channel.contract.handoff}. ${channel.contract.effect} Gate: ${channel.gate}`;
	}
</script>

<section
	id="studio-send"
	class="send"
	style="--timing-normal: {TIMING.NORMAL}ms; --easing: {EASING};"
	aria-label="Studio send capability contract"
>
	<header class="send-head">
		<div class="send-head-copy">
			<span class="send-title">Send</span>
			<span class="send-gloss">draft handoffs now; execution only where proof gates are armed</span>
		</div>
		<div class="send-head-metrics" aria-label="Send handoff counts">
			<span>
				<Datum value={draftHandoffCount} cite="StudioSend draft handoff rows" />
				draft
			</span>
			<span>
				<Datum value={executionHandoffCount} cite="StudioSend live execution rows" />
				execution
			</span>
		</div>
	</header>

	<div class="send-ratio" aria-label="Send channel state mix">
		<Ratio segments={channelSegments} height={8} />
	</div>

	<div
		class="send-boundary"
		data-state={deliveryBoundaryState}
		aria-label="Shared send readiness boundary"
	>
		<div class="send-boundary-main">
			<span class="send-boundary-kicker">Delivery boundary</span>
			<span class="send-boundary-title">{deliveryBoundarySummary}</span>
			<span class="send-boundary-gate">{deliveryBoundaryGate}</span>
		</div>
		<div class="send-boundary-side">
			<span class="send-boundary-state">{stateLabel(deliveryBoundaryState)}</span>
			<span class="send-boundary-metric">
				<Datum value={sendReadiness?.heldCount ?? null} cite="buildSendReadiness heldCount" />
				held modes
			</span>
			<span class="send-boundary-signal">{deliveryHeldModeSummary}</span>
			<span class="send-boundary-signal"
				>{sendReadiness?.browserDirectSignal ?? 'email ground unread'}</span
			>
		</div>
		{#if firstHeldMode}
			<a
				class="send-boundary-mode"
				href={firstHeldMode.route}
				data-state={firstHeldMode.state}
				data-sveltekit-preload-data="off"
			>
				<span class="send-boundary-mode-name">{firstHeldMode.label}</span>
				<span class="send-boundary-mode-cluster"
					>{firstHeldMode.phase} / {formatCapabilityClusters(firstHeldMode.cluster)}</span
				>
				<span class="send-boundary-mode-handoff">{firstHeldMode.handoff}</span>
				<span class="send-boundary-mode-action">{deliveryBoundaryAction}</span>
			</a>
		{/if}
	</div>

	<section class="mode-contract" aria-label="Shared delivery-mode readiness">
		<div class="mode-contract-head">
			<div>
				<span class="mode-kicker">Shared send modes</span>
				<h3>Armed, bounded, and held send paths</h3>
			</div>
			<span
				class="mode-count"
				aria-label={`${deliveryModeRows.length} shared send modes; ${deliveryModeStateCounts.live} armed; ${deliveryModeStateCounts.partial} bounded; ${heldDeliveryModeCount} held`}
			>
				<span class="mode-count-total">
					<Datum value={deliveryModeRows.length} cite="buildSendReadiness modes" />
					<span>modes</span>
				</span>
				<span class="mode-count-split">
					<span>
						<Datum value={deliveryModeStateCounts.live} cite="buildSendReadiness modes" />
						armed
					</span>
					<span class="mode-count-divider">/</span>
					<span>
						<Datum value={deliveryModeStateCounts.partial} cite="buildSendReadiness modes" />
						bounded
					</span>
					<span class="mode-count-divider">/</span>
					<span>
						<Datum value={heldDeliveryModeCount} cite="buildSendReadiness modes" />
						held
					</span>
				</span>
			</span>
		</div>
		<div class="mode-ratio" aria-label="Shared send mode state mix">
			<Ratio segments={deliveryModeSegments} height={8} />
		</div>
		<div class="mode-grid">
			{#each deliveryModeRows as mode (mode.key)}
				<a
					class="mode-row"
					href={mode.route}
					data-state={mode.state}
					data-sveltekit-preload-data="off"
					title={mode.unlock}
				>
					<span class="mode-main">
						<span class="mode-top">
							<span class="mode-label">{mode.label}</span>
							<span class="mode-state">{stateLabel(mode.state)}</span>
						</span>
						<span class="mode-effect">{mode.effect}</span>
						<span class="mode-gate">{mode.unlock}</span>
					</span>
					<span class="mode-side">
						<span class="mode-cluster">{mode.phase} / {formatCapabilityClusters(mode.cluster)}</span
						>
						<span class="mode-handoff">{mode.handoff}</span>
						<span class="mode-action">{modeActionLabel(mode)}</span>
						{#if mode.metric}
							<span class="mode-metric">
								<Datum value={mode.metric.value} cite={mode.metric.cite} />
								{mode.metric.label}
							</span>
						{/if}
					</span>
				</a>
			{/each}
		</div>
	</section>

	<div class="send-row" role="group" aria-label="Delivery channels">
		{#each channelRows as channel (channel.key)}
			{@const IconComponent = channel.icon}
			<button
				type="button"
				class="channel"
				class:channel--primary={channel.primary}
				disabled={!channel.enabled}
				data-state={channel.state}
				onclick={channel.handler}
				title={channel.title}
				aria-label={channelAriaLabel(channel)}
			>
				<span class="channel-mark" aria-hidden="true">
					<IconComponent {...{ size: 18, strokeWidth: 1.8 } as Record<string, unknown>} />
				</span>
				<span class="channel-body">
					<span class="channel-top">
						<span class="channel-name">{channel.name}</span>
						<span class="channel-state">{stateLabel(channel.state)}</span>
					</span>
					<span class="channel-kind">{channel.kind}</span>
					<span class="channel-posture">{channel.posture}</span>
					<span class="channel-contract" aria-label={`${channel.name} handoff-effect contract`}>
						<span class="channel-contract-head">
							<span
								>{channel.contract.phase} / {formatCapabilityClusters(
									channel.contract.cluster
								)}</span
							>
							<span>{channel.contract.handoff}</span>
						</span>
						<span class="channel-effect">{channel.contract.effect}</span>
						<span class="channel-source">{channel.contract.source}</span>
					</span>
					<span class="channel-gate">{channel.gate}</span>
					<span class="channel-foot">
						<span class="channel-action">{actionLabel(channel)}</span>
						<span class="channel-metric">
							<Datum value={channel.metric.value} cite={channel.metric.cite} />
							{channel.metric.label}
						</span>
					</span>
				</span>
			</button>
		{/each}
	</div>

	{#if !canPublish}
		<p class="send-note">
			Your role can author, watch, and preserve the artifact; draft handoff and execution side
			effects require org authority.
		</p>
	{/if}
</section>

<style>
	.send {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.send-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
	}

	.send-head-copy {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.send-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.send-gloss {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: var(--text-tertiary, #6b7280);
	}

	.send-head-metrics {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary, oklch(0.42 0.015 60));
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.send-head-metrics span {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
	}

	.send-ratio {
		width: min(100%, 32rem);
	}

	.send-boundary {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.75rem 1rem;
		align-items: start;
		padding: 0.875rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.88 0.009 60));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}

	.send-boundary[data-state='draft-only'] {
		border-color: oklch(0.78 0.12 82 / 0.62);
		background: oklch(0.985 0.006 70);
	}

	.send-boundary[data-state='gated'] {
		border-color: oklch(0.84 0.006 60 / 0.9);
		background: var(--surface-overlay, oklch(0.975 0.005 55));
	}

	.send-boundary[data-state='live'] {
		border-color: var(--coord-verified, #10b981);
	}

	.send-boundary-main {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.35rem;
	}

	.send-boundary-kicker,
	.send-boundary-state,
	.send-boundary-metric,
	.send-boundary-signal,
	.send-boundary-mode-cluster,
	.send-boundary-mode-handoff,
	.send-boundary-mode-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.send-boundary-kicker {
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.send-boundary-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 650;
		line-height: 1.35;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.send-boundary-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--text-tertiary, #6b7280);
	}

	.send-boundary-side {
		display: flex;
		min-width: 8.5rem;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.25rem;
		text-align: right;
	}

	.send-boundary-state {
		color: var(--text-tertiary, #6b7280);
	}

	.send-boundary[data-state='live'] .send-boundary-state {
		color: var(--coord-verified, #10b981);
	}

	.send-boundary[data-state='draft-only'] .send-boundary-state {
		color: oklch(0.52 0.12 82);
	}

	.send-boundary-metric,
	.send-boundary-signal {
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.send-boundary-mode {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto;
		gap: 0.5rem;
		align-items: center;
		padding-top: 0.625rem;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		color: inherit;
		text-decoration: none;
	}

	.send-boundary-mode-name {
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.send-boundary-mode-cluster,
	.send-boundary-mode-handoff,
	.send-boundary-mode-action {
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.send-boundary-mode[data-state='draft-only'] .send-boundary-mode-action {
		color: oklch(0.52 0.12 82);
	}

	.send-boundary-mode[data-state='gated'] .send-boundary-mode-action {
		color: var(--text-tertiary, #6b7280);
	}

	.send-row {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
		min-width: 0;
	}

	.mode-contract {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.875rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}

	.mode-contract-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.mode-kicker,
	.mode-count,
	.mode-state,
	.mode-cluster,
	.mode-handoff,
	.mode-action,
	.mode-metric {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.mode-kicker,
	.mode-count {
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.mode-count {
		display: flex;
		min-width: 11rem;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.25rem;
		text-align: right;
	}

	.mode-count-total,
	.mode-count-split,
	.mode-count-split span {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
	}

	.mode-count-total,
	.mode-count-split {
		justify-content: flex-end;
		flex-wrap: wrap;
	}

	.mode-count-split {
		color: var(--text-tertiary, #6b7280);
	}

	.mode-count-divider {
		color: oklch(0.68 0.01 60);
	}

	.mode-contract h3 {
		margin: 0.125rem 0 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.mode-ratio {
		width: 100%;
	}

	.mode-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.mode-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(8.5rem, auto);
		gap: 0.75rem;
		min-width: 0;
		min-height: 9.75rem;
		padding: 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.82));
		background: var(--surface-overlay, oklch(0.975 0.005 55));
		color: inherit;
		text-decoration: none;
		transition:
			border-color var(--timing-normal) var(--easing),
			background-color var(--timing-normal) var(--easing);
	}

	.mode-row:hover,
	.mode-row:focus-visible {
		border-color: var(--coord-route-solid, #3bc4b8);
		outline: none;
	}

	.mode-row[data-state='partial'],
	.mode-row[data-state='live'] {
		background: var(--surface-base, oklch(0.993 0.003 60));
	}

	.mode-row[data-state='draft-only'] {
		border-color: oklch(0.78 0.12 82 / 0.62);
		background: oklch(0.985 0.006 70);
	}

	.mode-row[data-state='gated'] {
		border-color: oklch(0.84 0.006 60 / 0.9);
		opacity: 0.82;
	}

	.mode-main,
	.mode-side {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.35rem;
	}

	.mode-side {
		align-items: flex-end;
		text-align: right;
	}

	.mode-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.mode-label {
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.mode-state,
	.mode-cluster,
	.mode-handoff,
	.mode-action,
	.mode-metric {
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.mode-row[data-state='live'] .mode-state,
	.mode-row[data-state='live'] .mode-action {
		color: var(--coord-verified, #10b981);
	}

	.mode-row[data-state='draft-only'] .mode-state,
	.mode-row[data-state='draft-only'] .mode-action {
		color: oklch(0.52 0.12 82);
	}

	.mode-effect,
	.mode-gate {
		min-width: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--text-tertiary, #6b7280);
		overflow-wrap: anywhere;
	}

	.mode-effect {
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.mode-metric {
		display: inline-flex;
		min-width: 0;
		max-width: 100%;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem;
	}

	.channel {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		box-sizing: border-box;
		min-width: 0;
		max-width: 100%;
		min-height: 10rem;
		padding: 0.875rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--timing-normal) var(--easing),
			background-color var(--timing-normal) var(--easing),
			box-shadow var(--timing-normal) var(--easing),
			transform var(--timing-normal) var(--easing);
		width: 100%;
	}

	.channel:hover:not(:disabled),
	.channel:focus-visible:not(:disabled) {
		border-color: var(--coord-route-solid, #3bc4b8);
		box-shadow: 0 10px 24px oklch(0.68 0.11 185 / 0.12);
		transform: translateY(-1px);
		outline: none;
	}

	.channel--primary {
		border-color: oklch(0.72 0.11 180 / 0.75);
	}

	.channel:disabled {
		cursor: not-allowed;
	}

	.channel[data-state='draft-only'] {
		background: oklch(0.985 0.006 70);
		border-color: oklch(0.78 0.12 82 / 0.62);
	}

	.channel[data-state='gated'] {
		background: var(--surface-overlay, oklch(0.975 0.005 55));
		border-color: oklch(0.84 0.006 60 / 0.9);
	}

	.channel[data-state='live'] {
		border-color: var(--coord-verified, #10b981);
	}

	.channel-mark {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 8px;
		color: var(--coord-route-solid, #3bc4b8);
		background: oklch(0.96 0.018 185);
	}
	.channel[data-state='draft-only'] .channel-mark {
		color: oklch(0.55 0.12 82);
		background: oklch(0.96 0.03 82);
	}
	.channel[data-state='gated'] .channel-mark {
		color: var(--text-tertiary, #9ca3af);
		background: oklch(0.94 0.004 60);
	}
	.channel-body {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
		width: 100%;
	}

	.channel-top,
	.channel-foot {
		display: flex;
		min-width: 0;
		max-width: 100%;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.channel-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.channel-state {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.625rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-tertiary, #6b7280);
	}

	.channel[data-state='live'] .channel-state {
		color: var(--coord-verified, #10b981);
	}

	.channel[data-state='draft-only'] .channel-state {
		color: oklch(0.52 0.12 82);
	}

	.channel-kind,
	.channel-posture,
	.channel-effect,
	.channel-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
	}

	.channel-kind {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.channel-posture {
		font-size: 0.75rem;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.channel-contract {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.25rem;
		padding-top: 0.375rem;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.76));
	}

	.channel-contract-head,
	.channel-source {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.channel-contract-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.channel-contract-head span,
	.channel-source {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.channel-contract-head span:last-child {
		text-align: right;
	}

	.channel-effect {
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--text-tertiary, #6b7280);
		overflow-wrap: anywhere;
	}

	.channel-source {
		color: var(--text-tertiary, #6b7280);
	}

	.channel-gate {
		display: block;
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--text-tertiary, #6b7280);
		overflow-wrap: anywhere;
	}

	.channel-action,
	.channel-metric {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}

	.channel-action {
		white-space: nowrap;
	}

	.channel-metric {
		display: inline-flex;
		min-width: 0;
		max-width: 100%;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem;
		text-align: right;
	}

	.send-note {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
	}

	@media (max-width: 760px) {
		.send-head {
			align-items: flex-start;
			flex-direction: column;
		}

		.send-row {
			grid-template-columns: 1fr;
		}

		.mode-contract-head {
			flex-direction: column;
		}

		.mode-count,
		.mode-count-total,
		.mode-count-split {
			align-items: flex-start;
			justify-content: flex-start;
			text-align: left;
		}

		.mode-grid,
		.mode-row {
			grid-template-columns: 1fr;
		}

		.mode-side {
			align-items: flex-start;
			text-align: left;
		}

		.send-boundary {
			grid-template-columns: 1fr;
		}

		.send-boundary-side {
			align-items: flex-start;
			text-align: left;
		}

		.send-boundary-mode {
			grid-template-columns: 1fr;
			align-items: start;
		}

		.channel-foot {
			justify-content: flex-start;
		}

		.channel-action {
			white-space: normal;
		}

		.channel-metric {
			text-align: left;
		}
	}
</style>
