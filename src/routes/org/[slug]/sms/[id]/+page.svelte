<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import SmsReplyRegister from '$lib/components/sms/SmsReplyRegister.svelte';
	import SmsMessageTable from '$lib/components/sms/SmsMessageTable.svelte';
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
	import type { Id } from '$convex/_generated/dataModel';
	import type { PageData } from './$types';
	import type { EncryptedTextRecipient } from '$lib/services/client-text-sender';

	let { data }: { data: PageData } = $props();

	let deleting = $state(false);
	let dispatching = $state(false);
	let dispatchError = $state<string | null>(null);
	type TextDispatchSummary = {
		totalRecipients: number;
		sentCount: number;
		failedCount: number;
		message: string;
	};
	let dispatchResult = $state<TextDispatchSummary | null>(null);
	let dispatchProgress = $state<{
		total: number;
		ready: number;
		failed: number;
		status: string;
	} | null>(null);

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
	type TextDispatchCohort = {
		eligibleCount: number;
		dispatchedCount: number;
		remainingCount: number;
		batchLimit: number;
		truncated: boolean;
		hasMore: boolean;
		recipients: EncryptedTextRecipient[];
	};

	const statusColors: Record<string, string> = {
		draft: 'bg-surface-border-strong text-text-secondary',
		sending: 'bg-yellow-900/50 text-yellow-400',
		sent: 'bg-green-900/50 text-green-400',
		failed: 'bg-red-900/50 text-red-400'
	};
	const statusLabels: Record<string, string> = {
		draft: 'draft',
		sending: 'dispatching',
		sent: 'dispatched',
		failed: 'failed'
	};
	const base = $derived(`/org/${data.org.slug}`);
	const replyCount = $derived(data.replies.length);
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
				draftCount: 1,
				plannedRecipientCount: data.blast.totalRecipients,
				sentCount: data.blast.sentCount,
				deliveredCount: data.blast.deliveredCount,
				failedCount: data.blast.failedCount,
				messageCount: data.messages.length,
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
	const textCarrierProofRows = $derived<TextCarrierProofRow[]>(
		textDeliveryReadiness.proofRows.map((row) => ({
			...row,
			href:
				row.id === 'saved-draft-packet'
					? '#text-packet'
					: row.id === 'audience-scope'
						? '#text-audience'
						: row.id === 'browser-phone-custody' || row.id === 'scope-revalidation'
							? '#text-dispatch-status'
							: row.id === 'carrier-acceptance' || row.id === 'receipt-anchoring'
								? '#carrier-receipts'
								: row.id === 'reply-register'
									? '#text-replies'
									: row.href
		}))
	);
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
	const routeDispatchBlockers = $derived(
		data.textDispatchRuntimeMissing.filter((item) => item !== 'browser phone custody')
	);
	const canAttemptClientDispatch = $derived(
		(data.blast.status === 'draft' || data.blast.status === 'sending') &&
			!!data.orgKeyVerifier &&
			routeDispatchBlockers.length === 0
	);
	const textCarrierCounterCount = $derived(
		data.blast.sentCount + data.blast.deliveredCount + data.blast.failedCount
	);
	const textCarrierCounterEvidenceObserved = $derived(
		data.messages.length > 0 || textCarrierCounterCount > 0
	);
	const textDispatchStatusEvidenceObserved = $derived(
		textCarrierCounterEvidenceObserved ||
			!!data.blast.sentAt ||
			data.blast.status === 'sent' ||
			data.blast.status === 'failed'
	);
	const textAudienceEvidenceLabel = $derived(
		textCarrierCounterEvidenceObserved
			? 'Text carrier execution evidence'
			: 'Saved text custody evidence'
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
			href: textPacketScopeProofRow?.href ?? '#text-packet',
			metric: textPacketScopeProofRow?.metric ?? {
				value: data.blast.body.length,
				label: 'characters',
				cite: 'smsBlasts.body'
			}
		},
		{
			id: 'phone-custody',
			label: 'Phone custody',
			state: textPhoneCustodyProofRow?.state ?? textDeliveryReadiness.state,
			title: textPhoneCustodyProofRow?.handoff ?? 'Org-key phone decrypt',
			action: textPhoneCustodyProofRow?.action ?? 'read custody boundary',
			detail:
				textPhoneCustodyProofRow?.effect ??
				'Phone decrypt stays route-local and bounded before carrier dispatch.',
			gate: textPhoneCustodyProofRow?.gate ?? textDeliveryReadiness.gate,
			href: textPhoneCustodyProofRow?.href ?? '#text-dispatch-status',
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
			href: nextTextProofLiftRow?.href ?? '#carrier-receipts',
			metric: nextTextProofLiftRow?.metric ?? {
				value: textDeliveryReadiness.nextGate.downstream,
				label: 'downstream gates',
				cite: textDeliveryReadiness.nextGate.id
			}
		}
	]);
	const capabilityItems = $derived<CapabilityItem[]>(
		textDeliveryRows.map((row) => ({
			label: row.id === 'text-draft-packets' ? 'Saved text packet' : row.label,
			state: row.state,
			phase: row.phase,
			cluster: row.clusters,
			action: row.id === 'text-draft-packets' ? 'read packet' : row.action,
			detail:
				row.id === 'text-draft-packets'
					? 'The SMS body is preserved as a packet, but no carrier side effect is implied.'
					: row.ground,
			unlock: row.boundary,
			href:
				row.id === 'text-draft-packets'
					? '#text-packet'
					: row.id === 'text-audience-snapshots'
						? '#text-audience'
						: row.id === 'carrier-receipt-evidence'
							? '#carrier-receipts'
							: row.id === 'bulk-dispatch-runner'
								? '#text-dispatch-status'
								: row.id === 'reader-reply-register'
									? '#text-replies'
									: row.href,
			metric:
				row.id === 'text-draft-packets'
					? {
							value: data.blast.body.length,
							label: 'characters',
							cite: 'smsBlasts.body'
						}
					: row.metric
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

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(iso));
	}

	async function deleteBlast() {
		if (!confirm('Delete this text delivery draft? This cannot be undone.')) return;
		deleting = true;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/sms/${data.blast.id}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				window.location.href = `/org/${data.org.slug}/sms`;
			}
		} catch {
			/* ignore */
		} finally {
			deleting = false;
		}
	}

	async function dispatchTextCohort() {
		if (!canAttemptClientDispatch) {
			dispatchError =
				routeDispatchBlockers.length > 0
					? `Carrier dispatch is still held by ${routeDispatchBlockers.join(', ')}.`
					: data.blast.status !== 'draft' && data.blast.status !== 'sending'
						? 'Only draft or sending text delivery records can continue browser dispatch.'
						: 'Org-key verifier is required before browser-side phone decrypt can run.';
			return;
		}
		if (
			!confirm(
				'Dispatch this text draft to the eligible subscribed-phone cohort? Plaintext phone numbers stay in bounded browser requests and are not persisted.'
			)
		) {
			return;
		}

		dispatching = true;
		dispatchError = null;
		dispatchResult = null;
		dispatchProgress = { total: 0, ready: 0, failed: 0, status: 'decrypting' };

		try {
			const { useConvexClient } = await import('convex-sveltekit');
			const { api } = await import('$lib/convex');
			const { getOrPromptOrgKey } = await import('$lib/services/org-key-manager');
			const { sendTextBatchFromClient } = await import('$lib/services/client-text-sender');
			const convex = useConvexClient();
			const loadCohort = () =>
				convex.query(api.sms.getEncryptedRecipientsForBlast, {
					slug: data.org.slug,
					blastId: data.blast.id as Id<'smsBlasts'>
				}) as Promise<TextDispatchCohort>;
			let cohort = await loadCohort();
			if (cohort.eligibleCount === 0) {
				throw new Error('No subscribed encrypted phone recipients match this text draft.');
			}
			if (cohort.remainingCount === 0) {
				throw new Error(
					'All eligible subscribed-phone recipients are already recorded for this draft.'
				);
			}

			const orgKey = data.orgKeyVerifier
				? await getOrPromptOrgKey(data.org.id, data.orgKeyVerifier)
				: null;
			if (!orgKey) {
				throw new Error('Org key is required before encrypted phones can be prepared.');
			}

			let batchCount = 0;
			let latestResult: TextDispatchSummary | null = null;
			while (cohort.recipients.length > 0) {
				const recordedBefore = cohort.dispatchedCount;
				const failedBefore = latestResult?.failedCount ?? data.blast.failedCount;
				const finalBatch = !cohort.hasMore;
				batchCount += 1;

				const result = await sendTextBatchFromClient({
					orgSlug: data.org.slug,
					blastId: data.blast.id,
					orgKey,
					encryptedRecipients: cohort.recipients,
					expectedTotalRecipients: cohort.eligibleCount,
					finalBatch,
					onProgress: (progress) => {
						dispatchProgress = {
							total: cohort.eligibleCount,
							ready: Math.min(cohort.eligibleCount, recordedBefore + progress.ready),
							failed: failedBefore + progress.failed,
							status: progress.status
						};
					}
				});

				latestResult = {
					totalRecipients: result.totalRecipients,
					sentCount: result.sentCount,
					failedCount: result.failedCount,
					message: `${batchCount} browser-dispatched batch${
						batchCount === 1 ? '' : 'es'
					} recorded; plaintext phones were not persisted.`
				};
				dispatchProgress = {
					total: result.totalRecipients,
					ready: result.recordedCount ?? result.sentCount + result.failedCount,
					failed: result.failedCount,
					status: finalBatch ? 'complete' : 'sending'
				};

				if (finalBatch) break;
				cohort = await loadCohort();
				if (cohort.remainingCount === 0) break;
			}

			dispatchResult = latestResult;
			window.location.reload();
		} catch (err) {
			dispatchError = err instanceof Error ? err.message : 'Text dispatch failed.';
		} finally {
			dispatching = false;
		}
	}
</script>

<svelte:head>
	<title>Text Delivery Draft | {data.org.name}</title>
</svelte:head>

<div id="text-delivery-detail" class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<a
			href="/org/{data.org.slug}/sms"
			class="text-text-tertiary hover:text-text-primary mb-6 inline-block text-sm"
		>
			&larr; Text delivery
		</a>

		<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
			<div>
				<div class="mb-2 flex items-center gap-3">
					<h1 class="text-text-primary text-2xl font-bold">Text delivery draft</h1>
					<span
						class="rounded-full px-2.5 py-0.5 text-xs font-medium {statusColors[
							data.blast.status
						] ?? 'bg-surface-border-strong text-text-secondary'}"
					>
						{statusLabels[data.blast.status] ?? data.blast.status}
					</span>
				</div>
				<p class="text-text-tertiary text-sm">Created {formatDate(data.blast.createdAt)}</p>
				{#if data.blast.sentAt}
					<p class="text-text-tertiary text-sm">Dispatched {formatDate(data.blast.sentAt)}</p>
				{/if}
			</div>

			<div class="flex gap-2">
				{#if data.blast.status === 'draft' || data.blast.status === 'sent'}
					<button
						onclick={deleteBlast}
						disabled={deleting}
						class="rounded-lg border border-red-800/60 px-3 py-1.5 text-sm text-red-400 hover:border-red-600 hover:text-red-300 disabled:opacity-50"
					>
						Delete
					</button>
				{/if}
			</div>
		</div>

		<WorkspaceCapabilityStrip label="Text detail capability" items={capabilityItems} />

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
			id="text-dispatch-status"
			class="my-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3"
		>
			<p class="text-sm font-medium text-amber-300">Dispatch boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				{textDispatchRow?.ground ?? textDeliveryReadiness.detail}
			</p>
		</div>

		{#if data.blast.status === 'draft' || data.blast.status === 'sending'}
			<div class="border-surface-border bg-surface-base mb-6 rounded-md border p-4">
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p class="text-text-primary text-sm font-semibold">Browser text dispatch</p>
						<p class="text-text-tertiary mt-1 text-sm">
							{#if canAttemptClientDispatch}
								Org-key decrypt can prepare the eligible cohort in bounded browser requests.
							{:else if routeDispatchBlockers.length > 0}
								Carrier dispatch is held by {routeDispatchBlockers.join(', ')}.
							{:else if data.blast.status !== 'draft' && data.blast.status !== 'sending'}
								This record is closed to browser dispatch.
							{:else}
								Org-key verifier is required before encrypted phones can be prepared.
							{/if}
						</p>
						<p class="text-text-tertiary mt-2 text-xs">
							<Datum value={100} cite="SMS client dispatch batch limit" /> recipients per request. Plaintext
							phones are sent only to each dispatch API request.
						</p>
					</div>
					<button
						type="button"
						onclick={dispatchTextCohort}
						disabled={dispatching || !canAttemptClientDispatch}
						class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
					>
						{dispatching ? 'Dispatching...' : 'Dispatch eligible cohort'}
					</button>
				</div>
				{#if dispatchProgress}
					<p class="text-text-tertiary mt-3 text-xs">
						{dispatchProgress.status}: {dispatchProgress.ready}/{dispatchProgress.total} recorded,
						{dispatchProgress.failed} failed
					</p>
				{/if}
				{#if dispatchError}
					<p class="mt-3 text-sm text-red-400">{dispatchError}</p>
				{/if}
				{#if dispatchResult}
					<p class="mt-3 text-sm text-emerald-400">
						{dispatchResult.sentCount}/{dispatchResult.totalRecipients} accepted by carrier proxy.
						{dispatchResult.message}
					</p>
				{/if}
			</div>
		{/if}

		<div
			id="text-audience"
			class="mb-6 grid grid-cols-4 gap-3"
			aria-label={textAudienceEvidenceLabel}
		>
			<div class="border-surface-border rounded-lg border p-4">
				<p class="text-text-tertiary text-xs font-medium">Planned recipients</p>
				<p class="text-text-primary mt-1 text-lg font-bold">
					<Datum value={data.blast.totalRecipients} cite="smsBlasts.totalRecipients" />
				</p>
			</div>
			{#if textCarrierCounterEvidenceObserved}
				<div class="border-surface-border rounded-lg border p-4">
					<p class="text-text-tertiary text-xs font-medium">Accepted</p>
					<p class="text-text-primary mt-1 text-lg font-bold">
						<Datum value={data.blast.sentCount} cite="smsBlasts.sentCount" />
					</p>
				</div>
				<div class="border-surface-border rounded-lg border p-4">
					<p class="text-text-tertiary text-xs font-medium">Confirmed</p>
					<p class="mt-1 text-lg font-bold text-green-400">
						<Datum value={data.blast.deliveredCount} cite="smsBlasts.deliveredCount" />
					</p>
				</div>
				<div class="border-surface-border rounded-lg border p-4">
					<p class="text-text-tertiary text-xs font-medium">Failed</p>
					<p class="mt-1 text-lg font-bold text-red-400">
						<Datum value={data.blast.failedCount} cite="smsBlasts.failedCount" />
					</p>
				</div>
			{:else}
				<div class="border-surface-border rounded-lg border p-4">
					<p class="text-text-tertiary text-xs font-medium">Browser route</p>
					<p class="text-text-primary mt-1 text-lg font-bold">
						<Datum
							value={data.textDispatchClientBatchRouteMounted ? 1 : 0}
							cite="getTextDispatchReadiness.clientBatchRouteMounted"
						/>
					</p>
				</div>
				<div class="border-surface-border rounded-lg border p-4">
					<p class="text-text-tertiary text-xs font-medium">Held checks</p>
					<p class="text-text-primary mt-1 text-lg font-bold">
						<Datum
							value={data.textDispatchRuntimeMissing.length}
							cite="getTextDispatchReadiness.missing"
						/>
					</p>
				</div>
				<div class="border-surface-border rounded-lg border p-4">
					<p class="text-text-tertiary text-xs font-medium">Carrier counters</p>
					<p class="text-text-secondary mt-1 text-sm leading-tight">
						{textDispatchStatusEvidenceObserved
							? 'status recorded; counters not loaded'
							: 'hidden until receipt rows exist'}
					</p>
				</div>
			{/if}
		</div>

		<div id="text-packet" class="border-surface-border mb-6 rounded-lg border p-4">
			<h3 class="text-text-tertiary mb-3 text-sm font-medium">Message</h3>
			<div class="bg-surface-base rounded-lg px-4 py-3">
				<p class="text-text-primary text-sm whitespace-pre-wrap">{data.blast.body}</p>
			</div>
		</div>

		<div id="carrier-receipts">
			<h3 class="text-text-tertiary mb-3 text-sm font-medium">Carrier receipt log</h3>
			{#if !textCarrierCounterEvidenceObserved}
				<p class="text-text-tertiary mb-3 text-xs">
					Carrier counters stay hidden until receipt rows or nonzero carrier outcomes exist, so this
					draft cannot read as a zero-delivery send.
				</p>
			{/if}
			<SmsMessageTable messages={data.messages} />
		</div>

		<div id="text-replies" class="border-surface-border bg-surface-base mt-6 rounded-md border p-4">
			<div class="mb-4 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h3 class="text-text-secondary text-sm font-medium">Reply register</h3>
					<p class="text-text-tertiary mt-1 text-xs">
						Reader replies linked to this text record, without phone-number exposure.
					</p>
				</div>
				<div class="bg-surface-overlay rounded-md px-4 py-3 text-right">
					<p class="text-text-primary text-xl leading-none font-semibold">
						<Datum value={replyCount} cite="sms.listReplies blastId" />
					</p>
					<p class="text-text-tertiary mt-1 text-xs">linked replies</p>
				</div>
			</div>
			<SmsReplyRegister replies={data.replies} orgSlug={data.org.slug} />
			<p class="text-text-tertiary mt-3 text-xs">
				This register does not claim assignment, autoresponse, legal-policy review, or office
				notifications.
			</p>
		</div>
	</div>
</div>
