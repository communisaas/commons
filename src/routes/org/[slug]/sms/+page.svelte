<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import SmsReplyRegister from '$lib/components/sms/SmsReplyRegister.svelte';
	import SmsBlastCard from '$lib/components/sms/SmsBlastCard.svelte';
	import { FEATURES } from '$lib/config/features';
	import { Datum, Ratio } from '$lib/design';
	import {
		buildTextDeliveryReadiness,
		getGateEvidence,
		type CapabilityState,
		type TextCarrierProofRow,
		type TextDeliveryReadinessRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments
	} from '$lib/data/capability-state-labels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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
	type TextDeliveryPressureReadout = {
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
	const draftCount = $derived(data.blasts.length);
	const plannedRecipients = $derived(
		data.blasts.reduce((sum, blast) => sum + blast.totalRecipients, 0)
	);
	const sentCount = $derived(data.blasts.reduce((sum, blast) => sum + blast.sentCount, 0));
	const deliveredCount = $derived(
		data.blasts.reduce((sum, blast) => sum + blast.deliveredCount, 0)
	);
	const failedCount = $derived(data.blasts.reduce((sum, blast) => sum + blast.failedCount, 0));
	const messageCount = $derived(data.blasts.reduce((sum, blast) => sum + blast.messageCount, 0));
	const replyCount = $derived(data.replySummary.replyCount);
	const smsDispatchGate = getGateEvidence('CP-sms-dispatch', ['T2-1'], {
		name: 'SMS dispatch',
		downstream: 2,
		dependency: 'Browser phone custody and Twilio dispatch runner'
	});
	const smsReceiptAnchoringGate = getGateEvidence('CP-receipt-anchoring', ['T6-1', 'T6-2'], {
		name: 'SMS receipt anchoring',
		downstream: 8,
		dependency: 'SMS dispatch evidence plus receipt writer/mainnet anchoring'
	});
	const textReplyRegisterGate = getGateEvidence(
		'CP-reader-office-profile',
		['T8-1a', 'T8-1b', 'T8-8'],
		{
			name: 'Text reply workflow',
			downstream: 3,
			dependency: 'Reader-office profiles, office-response workflow, and notification webhooks'
		}
	);
	const textDeliveryReadiness = $derived(
		buildTextDeliveryReadiness({
			base,
			text: {
				enabled: true,
				dispatchEnabled: FEATURES.SMS_DISPATCH,
				loaded: true,
				draftCount,
				plannedRecipientCount: plannedRecipients,
				sentCount,
				deliveredCount,
				failedCount,
				messageCount,
				replyCount,
				subscribedPhoneCount: data.smsHealth.subscribed,
				unsubscribedPhoneCount: data.smsHealth.unsubscribed,
				stoppedPhoneCount: data.smsHealth.stopped,
				noSmsStatusCount: data.smsHealth.none,
				phonePresentCount: data.smsHealth.phonePresent,
				smsConsentEvidenceCount: data.consentEvidence.sms,
				subscribedSmsConsentEvidenceCount: data.consentEvidence.smsSubscribed,
				dispatchRuntimeReady: data.textDispatchRuntimeReady,
				dispatchRuntimeMissing: data.textDispatchRuntimeMissing,
				dispatchRuntimeDependency: data.textDispatchRuntimeDependency,
				dispatchRuntimeMessage: data.textDispatchRuntimeMessage,
				dispatchClientBatchRouteMounted: data.textDispatchClientBatchRouteMounted
			},
			gates: {
				smsDispatchGate,
				smsReceiptAnchoringGate,
				textReplyRegisterGate
			}
		})
	);
	const textDeliveryRows = $derived<TextDeliveryReadinessRow[]>(textDeliveryReadiness.rows);
	const textCarrierProofRows = $derived<TextCarrierProofRow[]>(textDeliveryReadiness.proofRows);
	const textCarrierProofStateCounts = $derived(
		textCarrierProofRows.reduce(
			(counts, row) => {
				counts[row.state] += 1;
				return counts;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const textCarrierProofSegments = $derived(
		operatorCapabilityStateRatioSegments(textCarrierProofStateCounts, {
			labelSuffix: ' carrier proof rows'
		})
	);
	const heldTextCarrierProofCount = $derived(
		textCarrierProofStateCounts['draft-only'] + textCarrierProofStateCounts.gated
	);
	const textDispatchRow = $derived(
		textDeliveryRows.find((row) => row.id === 'bulk-dispatch-runner')
	);
	const textPacketScopeProofRow = $derived(
		textCarrierProofRows.find((row) => row.id === 'saved-draft-packet') ??
			textCarrierProofRows.find((row) => row.id === 'audience-scope') ??
			null
	);
	const textPhoneCustodyProofRow = $derived(
		textCarrierProofRows.find((row) => row.id === 'browser-phone-custody') ??
			textCarrierProofRows.find((row) => row.id === 'scope-revalidation') ??
			null
	);
	const nextTextProofLiftRow = $derived(
		textCarrierProofRows.find(
			(row) =>
				(row.id === 'carrier-acceptance' ||
					row.id === 'reply-register' ||
					row.id === 'receipt-anchoring') &&
				row.state !== 'live'
		) ??
			textCarrierProofRows.find((row) => row.id === 'receipt-anchoring') ??
			null
	);
	const textDeliveryPressureReadouts = $derived<TextDeliveryPressureReadout[]>([
		{
			id: 'packet-scope',
			label: 'Packet scope',
			state: textPacketScopeProofRow?.state ?? textDeliveryReadiness.state,
			title: textPacketScopeProofRow?.handoff ?? textDeliveryReadiness.handoff,
			action: textPacketScopeProofRow?.action ?? textDeliveryReadiness.action,
			detail: textPacketScopeProofRow?.effect ?? textDeliveryReadiness.signal,
			gate: textPacketScopeProofRow?.gate ?? textDeliveryReadiness.gate,
			href: textPacketScopeProofRow?.href ?? `${base}/sms/new#text-message`,
			metric: textPacketScopeProofRow?.metric ?? textDeliveryReadiness.metric
		},
		{
			id: 'phone-custody',
			label: 'Phone custody',
			state: textPhoneCustodyProofRow?.state ?? textDeliveryReadiness.state,
			title: textPhoneCustodyProofRow?.handoff ?? 'Browser phone custody',
			action: textPhoneCustodyProofRow?.action ?? 'read custody boundary',
			detail:
				textPhoneCustodyProofRow?.effect ??
				'Phone decrypt stays route-local and bounded before carrier dispatch.',
			gate: textPhoneCustodyProofRow?.gate ?? textDeliveryReadiness.gate,
			href: textPhoneCustodyProofRow?.href ?? '#sms-dispatch-boundary',
			metric: textPhoneCustodyProofRow?.metric ?? {
				value: data.textDispatchClientBatchRouteMounted ? 1 : 0,
				label: 'browser route',
				cite: 'getTextDispatchReadiness.clientBatchRouteMounted'
			}
		},
		{
			id: 'next-proof-lift',
			label: 'Next proof lift',
			state: nextTextProofLiftRow?.state ?? textDeliveryReadiness.state,
			title: nextTextProofLiftRow?.handoff ?? textDeliveryReadiness.nextGate.name,
			action: nextTextProofLiftRow?.action ?? 'read text boundary',
			detail:
				nextTextProofLiftRow?.effect ??
				'Carrier acceptance, reply handling, and durable receipt proof stay separated.',
			gate: nextTextProofLiftRow?.gate ?? textDeliveryReadiness.gate,
			href: nextTextProofLiftRow?.href ?? '#text-receipts',
			metric: nextTextProofLiftRow?.metric ?? {
				value: textDeliveryReadiness.nextGate.downstream,
				label: 'downstream gates',
				cite: textDeliveryReadiness.nextGate.id
			}
		}
	]);
	const capabilityItems = $derived<CapabilityItem[]>(
		textDeliveryRows.map((row) => ({
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
	<title>Text Delivery | {data.org.name}</title>
</svelte:head>

<div id="text-delivery" class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<div class="mb-8 flex items-center justify-between">
			<div>
				<h1 class="text-text-primary text-2xl font-bold">Text delivery</h1>
				<p class="text-text-tertiary mt-1 text-sm">
					{textDeliveryReadiness.effect}
				</p>
			</div>
			<a
				href="/org/{data.org.slug}/sms/new"
				class="bg-surface-overlay text-text-primary hover:bg-surface-base rounded-md px-4 py-2 text-sm font-semibold"
			>
				Compose text draft
			</a>
		</div>

		<WorkspaceCapabilityStrip label="Text delivery capability" items={capabilityItems} />

		<div class="mt-4 grid gap-3 md:grid-cols-3" aria-label="Text delivery pressure">
			{#each textDeliveryPressureReadouts as readout (readout.id)}
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

		<section
			id="text-carrier-proof-contract"
			class="border-surface-border bg-surface-base my-6 rounded-md border p-4"
			aria-labelledby="text-carrier-proof-contract-title"
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p class="text-text-tertiary text-xs font-semibold tracking-[0.18em] uppercase">
						Carrier dispatch proof
					</p>
					<h2
						id="text-carrier-proof-contract-title"
						class="text-text-primary mt-1 text-lg font-semibold"
					>
						What must be true before texts leave Commons
					</h2>
				</div>
				<div
					class="bg-surface-overlay min-w-48 rounded-md px-4 py-3 text-right"
					aria-label={`${textCarrierProofRows.length} carrier proof rows; ${textCarrierProofStateCounts.live} armed; ${textCarrierProofStateCounts.partial} bounded; ${heldTextCarrierProofCount} held`}
				>
					<p class="text-text-primary text-xl leading-none font-semibold">
						<Datum
							value={textCarrierProofRows.length}
							cite="buildTextDeliveryReadiness proofRows"
						/>
					</p>
					<p class="text-text-tertiary mt-1 text-xs">
						proof rows ·
						<Datum value={textCarrierProofStateCounts.partial} cite="text carrier proof contract" />
						bounded
					</p>
				</div>
			</div>
			<div class="mt-4">
				<Ratio segments={textCarrierProofSegments} height={8} />
			</div>
			<div class="mt-4 grid gap-2" aria-label="Text carrier dispatch proof contract">
				{#each textCarrierProofRows as row (row.id)}
					<a
						href={row.href}
						class="border-surface-border hover:border-surface-border-strong grid gap-3 rounded-md border px-3 py-3 text-sm transition md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.35fr)_8rem]"
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
						<span class="text-text-secondary text-xs">
							<Datum value={row.metric.value} cite={row.metric.cite} />
							{row.metric.label}
						</span>
					</a>
				{/each}
			</div>
		</section>

		<div
			id="sms-dispatch-boundary"
			class="my-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3"
		>
			<p class="text-sm font-medium text-amber-300">Dispatch boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				{textDispatchRow?.ground ?? textDeliveryReadiness.detail}
			</p>
		</div>

		<div id="text-replies" class="border-surface-border bg-surface-base mb-6 rounded-md border p-4">
			<div class="mb-4 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 class="text-text-secondary text-sm font-medium">Reply register</h2>
					<p class="text-text-tertiary mt-1 text-xs">
						Inbound free-text SMS replies are response evidence, not a routed inbox.
					</p>
				</div>
				<div class="bg-surface-overlay rounded-md px-4 py-3 text-right">
					<p class="text-text-primary text-2xl leading-none font-semibold">
						<Datum value={replyCount} cite="sms.listReplies" />
					</p>
					<p class="text-text-tertiary mt-1 text-xs">recorded replies</p>
				</div>
			</div>
			<SmsReplyRegister replies={data.recentReplies} orgSlug={data.org.slug} />
			<p class="text-text-tertiary mt-3 text-xs">
				Autoresponse, assignment, legal-policy review, and reader-office notification remain
				gate-backed.
			</p>
		</div>

		{#if data.blasts.length === 0}
			<div class="border-surface-border rounded-md border py-16 text-center">
				<p class="text-text-tertiary text-lg">No text delivery drafts yet.</p>
				<p class="text-text-tertiary mt-1 text-sm">
					{textDeliveryReadiness.detail}
				</p>
				<a
					href="/org/{data.org.slug}/sms/new"
					class="bg-surface-overlay text-text-primary hover:bg-surface-base mt-4 inline-block rounded-md px-4 py-2 text-sm font-semibold"
				>
					Compose text draft
				</a>
			</div>
		{:else}
			<div id="text-audience-snapshot" class="space-y-3">
				{#each data.blasts as blast (blast.id)}
					<a href="/org/{data.org.slug}/sms/{blast.id}" class="block">
						<SmsBlastCard {blast} />
					</a>
				{/each}
			</div>
			<div id="text-receipts" class="sr-only">Carrier receipt evidence summary</div>
		{/if}
	</div>
</div>
