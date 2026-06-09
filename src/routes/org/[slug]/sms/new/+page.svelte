<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import CharacterCounter from '$lib/components/sms/CharacterCounter.svelte';
	import { FEATURES } from '$lib/config/features';
	import { Datum } from '$lib/design';
	import {
		buildTextDeliveryReadiness,
		getGateEvidence,
		type CapabilityState,
		type TextCarrierProofRow,
		type TextDeliveryReadinessRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let body = $state('');
	let campaignId = $state('');
	let saving = $state(false);
	let errorMsg = $state('');
	let selectedTagIds = $state<string[]>([]);
	let excludedTagIds = $state<string[]>([]);
	let selectedSegmentIds = $state<string[]>([]);
	// svelte-ignore state_referenced_locally
	let audienceCount = $state(data.initialAudienceCount);
	// svelte-ignore state_referenced_locally
	let audienceBatchLimit = $state(data.initialAudienceBatchLimit);
	// svelte-ignore state_referenced_locally
	let audienceHasMoreThanBatchLimit = $state(data.initialAudienceHasMoreThanBatchLimit);
	let audienceCounting = $state(false);
	let audienceCountError = $state('');
	let audienceFirstRun = true;
	let audienceRequestSeq = 0;

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

	const bodyLength = $derived(body.length);
	const segmentCount = $derived(Math.ceil(bodyLength / 160) || 1);
	const isValid = $derived(body.trim().length > 0 && bodyLength <= 1600);
	const canContinueToDispatch = $derived(isValid && audienceCount > 0 && !audienceCounting);
	const base = $derived(`/org/${data.org.slug}`);
	const hasAudienceFilter = $derived(
		selectedTagIds.length > 0 || excludedTagIds.length > 0 || selectedSegmentIds.length > 0
	);
	const recipientFilterPayload = $derived(
		hasAudienceFilter
			? {
					tags: selectedTagIds.length ? selectedTagIds : undefined,
					segments: selectedSegmentIds.length ? selectedSegmentIds : undefined,
					excludeTags: excludedTagIds.length ? excludedTagIds : undefined
				}
			: null
	);
	const audienceFilterKey = $derived(JSON.stringify(recipientFilterPayload ?? {}));
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
				draftCount: 0,
				plannedRecipientCount: audienceCount,
				sentCount: 0,
				deliveredCount: 0,
				failedCount: 0,
				messageCount: 0,
				replyCount: 0,
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
					? '#text-message'
					: row.id === 'audience-scope'
						? '#text-audience-snapshot'
						: row.id === 'browser-phone-custody' || row.id === 'scope-revalidation'
							? '#text-dispatch'
							: row.href
		}))
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
			state: body.trim()
				? 'draft-only'
				: (textPacketScopeProofRow?.state ?? textDeliveryReadiness.state),
			title: 'SMS body and audience scope',
			action: body.trim()
				? 'save packet'
				: (textPacketScopeProofRow?.action ?? 'compose text draft'),
			detail: body.trim()
				? `Draft body has ${bodyLength} characters across ${segmentCount} carrier segment${
						segmentCount === 1 ? '' : 's'
					}; ${audienceCount} eligible phones match the current scope.`
				: (textPacketScopeProofRow?.effect ?? textDeliveryReadiness.signal),
			gate:
				textPacketScopeProofRow?.gate ??
				'Saved audience scope is not phone decrypt, carrier delivery, reply handling, or receipt proof.',
			href: '#text-message',
			metric: {
				value: bodyLength,
				label: 'characters',
				cite: 'local composer count'
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
			href: textPhoneCustodyProofRow?.href ?? '#text-dispatch',
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
			href: nextTextProofLiftRow?.href ?? '#text-dispatch',
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
			state: row.id === 'text-draft-packets' && body.trim() ? 'draft-only' : row.state,
			phase: row.phase,
			cluster: row.clusters,
			action:
				row.id === 'text-draft-packets'
					? 'save packet'
					: row.id === 'text-audience-snapshots'
						? 'shape audience'
						: row.action,
			detail:
				row.id === 'text-draft-packets'
					? `Draft body has ${bodyLength} characters across ${segmentCount} carrier segment${segmentCount === 1 ? '' : 's'} if later dispatched.`
					: row.id === 'text-audience-snapshots'
						? `${audienceCount} subscribed-phone recipients match this draft audience after status and filter rules.`
						: row.ground,
			unlock: row.boundary,
			href:
				row.id === 'text-draft-packets'
					? '#text-message'
					: row.id === 'text-audience-snapshots'
						? '#text-audience-snapshot'
						: row.href,
			metric:
				row.id === 'text-draft-packets'
					? {
							value: bodyLength,
							label: 'characters',
							cite: 'local composer count'
						}
					: row.id === 'text-audience-snapshots'
						? {
								value: audienceCount,
								label: 'eligible phones',
								cite: 'sms.countEligibleRecipientsForFilter'
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

	function toggle(list: string[], id: string): string[] {
		return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
	}

	function toggleIncludedTag(tagId: string) {
		selectedTagIds = toggle(selectedTagIds, tagId);
		if (selectedTagIds.includes(tagId))
			excludedTagIds = excludedTagIds.filter((id) => id !== tagId);
	}

	function toggleExcludedTag(tagId: string) {
		excludedTagIds = toggle(excludedTagIds, tagId);
		if (excludedTagIds.includes(tagId))
			selectedTagIds = selectedTagIds.filter((id) => id !== tagId);
	}

	function toggleSegment(segmentId: string) {
		selectedSegmentIds = toggle(selectedSegmentIds, segmentId);
	}

	$effect(() => {
		const key = audienceFilterKey;
		void key;

		if (audienceFirstRun) {
			audienceFirstRun = false;
			return;
		}

		const seq = ++audienceRequestSeq;
		const payload = recipientFilterPayload;
		audienceCounting = true;
		audienceCountError = '';

		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/org/${data.org.slug}/sms/audience-count`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ recipientFilter: payload ?? {} })
				});
				const result = await res.json().catch(() => null);
				if (seq !== audienceRequestSeq) return;
				if (!res.ok) {
					audienceCountError =
						result?.message ?? result?.error ?? `Unable to count audience (${res.status})`;
					return;
				}
				audienceCount = Number(result?.eligibleCount ?? 0);
				audienceBatchLimit = Number(result?.batchLimit ?? audienceBatchLimit);
				audienceHasMoreThanBatchLimit = Boolean(result?.hasMoreThanBatchLimit);
			} catch {
				if (seq === audienceRequestSeq) audienceCountError = 'Unable to count audience';
			} finally {
				if (seq === audienceRequestSeq) audienceCounting = false;
			}
		}, 350);

		return () => clearTimeout(timer);
	});

	async function saveDraft(continueToDispatch = false) {
		if (!body.trim()) {
			errorMsg = 'Message body is required';
			return;
		}
		if (bodyLength > 1600) {
			errorMsg = 'Message exceeds 1600 character limit';
			return;
		}
		if (continueToDispatch && audienceCount < 1) {
			errorMsg = 'Choose an audience with at least one eligible subscribed phone before dispatch.';
			return;
		}

		saving = true;
		errorMsg = '';

		try {
			const res = await fetch(`/api/org/${data.org.slug}/sms`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					body: body.trim(),
					campaignId: campaignId || null,
					recipientFilter: recipientFilterPayload
				})
			});

			if (res.ok) {
				const result = await res.json();
				window.location.href = continueToDispatch
					? `/org/${data.org.slug}/sms/${result.id}?dispatch=1#text-dispatch-status`
					: `/org/${data.org.slug}/sms/${result.id}`;
			} else {
				const err = await res.json().catch(() => null);
				errorMsg = err?.error ?? `Failed to save (${res.status})`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Compose Text Draft | {data.org.name}</title>
</svelte:head>

<div id="text-delivery-draft" class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<a
			href="/org/{data.org.slug}/sms"
			class="text-text-tertiary hover:text-text-primary mb-6 inline-block text-sm"
		>
			&larr; Text delivery
		</a>

		<h1 class="text-text-primary mb-2 text-2xl font-bold">Compose text draft</h1>
		<p class="text-text-tertiary mb-6 text-sm">
			{textDeliveryReadiness.effect}
		</p>

		<WorkspaceCapabilityStrip label="Text draft capability" items={capabilityItems} />

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

		<div
			id="text-dispatch"
			class="my-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3"
		>
			<p class="text-sm font-medium text-amber-300">Dispatch boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				{textDispatchRow?.ground ?? textDeliveryReadiness.detail}
			</p>
		</div>

		{#if errorMsg}
			<div
				class="mb-6 rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400"
			>
				{errorMsg}
			</div>
		{/if}

		<div id="text-message" class="border-surface-border mb-6 rounded-md border p-4">
			<label for="sms-body" class="text-text-tertiary mb-2 block text-sm font-medium">Message</label
			>
			<textarea
				id="sms-body"
				bind:value={body}
				placeholder="Write the SMS copy..."
				rows="5"
				maxlength={1600}
				class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
			></textarea>
			<div class="mt-2">
				<CharacterCounter length={bodyLength} />
			</div>
			{#if segmentCount > 1}
				<p class="text-text-tertiary mt-1 text-xs">
					If later dispatched, this packet occupies {segmentCount} carrier segments.
				</p>
			{/if}
		</div>

		<div id="action-record-link" class="border-surface-border mb-6 rounded-md border p-4">
			<label for="sms-campaign" class="text-text-tertiary mb-2 block text-sm font-medium"
				>Link to action record (optional)</label
			>
			<select
				id="sms-campaign"
				bind:value={campaignId}
				class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
			>
				<option value="">No action record</option>
				{#each data.campaigns as campaign (campaign.id)}
					<option value={campaign.id}>{campaign.title}</option>
				{/each}
			</select>
		</div>

		<div
			id="text-audience-snapshot"
			class="border-surface-border bg-surface-base mb-6 rounded-md border p-4"
		>
			<div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
				<div>
					<h2 class="text-text-secondary text-sm font-medium">Audience snapshot</h2>
					<p class="text-text-tertiary mt-1 text-xs">
						Counted after SMS subscription, encrypted phone presence, and saved filter rules.
					</p>
				</div>
				<div class="bg-surface-overlay rounded-md px-4 py-3 text-right">
					<p class="text-text-primary text-2xl leading-none font-semibold">
						<Datum value={audienceCount} cite="sms.countEligibleRecipientsForFilter" />
					</p>
					<p class="text-text-tertiary mt-1 text-xs">
						{audienceCounting ? 'counting...' : 'eligible phones'}
					</p>
				</div>
			</div>

			<div class="mt-4 grid gap-4">
				{#if data.segments.length > 0}
					<div>
						<p class="text-text-tertiary mb-2 text-xs font-medium">Saved segments</p>
						<div class="flex flex-wrap gap-2">
							{#each data.segments as segment (segment.id)}
								<button
									type="button"
									aria-pressed={selectedSegmentIds.includes(segment.id)}
									onclick={() => toggleSegment(segment.id)}
									class="rounded-md border px-2.5 py-1 text-xs transition-colors {selectedSegmentIds.includes(
										segment.id
									)
										? 'border-teal-500/30 bg-teal-500/20 text-teal-300'
										: 'bg-surface-overlay text-text-tertiary border-surface-border-strong hover:border-text-quaternary'}"
								>
									{segment.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if data.tags.length > 0}
					<div>
						<p class="text-text-tertiary mb-2 text-xs font-medium">Include tags</p>
						<div class="flex flex-wrap gap-2">
							{#each data.tags as tag (tag.id)}
								<button
									type="button"
									aria-pressed={selectedTagIds.includes(tag.id)}
									onclick={() => toggleIncludedTag(tag.id)}
									class="rounded-md border px-2.5 py-1 text-xs transition-colors {selectedTagIds.includes(
										tag.id
									)
										? 'border-teal-500/30 bg-teal-500/20 text-teal-300'
										: 'bg-surface-overlay text-text-tertiary border-surface-border-strong hover:border-text-quaternary'}"
								>
									{tag.name}
								</button>
							{/each}
						</div>
					</div>

					<div>
						<p class="text-text-tertiary mb-2 text-xs font-medium">Exclude tags</p>
						<div class="flex flex-wrap gap-2">
							{#each data.tags as tag (tag.id)}
								<button
									type="button"
									aria-pressed={excludedTagIds.includes(tag.id)}
									onclick={() => toggleExcludedTag(tag.id)}
									class="rounded-md border px-2.5 py-1 text-xs transition-colors {excludedTagIds.includes(
										tag.id
									)
										? 'border-red-500/30 bg-red-500/15 text-red-300'
										: 'bg-surface-overlay text-text-tertiary border-surface-border-strong hover:border-text-quaternary'}"
								>
									{tag.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<div
				class="border-surface-border-strong/70 bg-surface-overlay mt-4 grid gap-3 rounded-md border px-3 py-3 text-xs md:grid-cols-3"
			>
				<div>
					<p class="text-text-tertiary">Batch limit</p>
					<p class="text-text-primary mt-1 font-mono tabular-nums">
						<Datum value={audienceBatchLimit} cite="sms.getEncryptedRecipientsForBlast" />
					</p>
				</div>
				<div>
					<p class="text-text-tertiary">Dispatch route</p>
					<p class="text-text-primary mt-1">
						{data.textDispatchClientBatchRouteMounted ? 'detail browser batch' : 'not mounted'}
					</p>
				</div>
				<div>
					<p class="text-text-tertiary">Saved filter</p>
					<p class="text-text-primary mt-1">{hasAudienceFilter ? 'scoped' : 'all eligible'}</p>
				</div>
			</div>

			{#if audienceHasMoreThanBatchLimit}
				<p class="text-text-tertiary mt-3 text-xs">
					Dispatch continues through saved {audienceBatchLimit}-recipient browser-decrypted batches
					on the detail route.
				</p>
			{/if}
			{#if audienceCountError}
				<p class="mt-3 text-xs text-red-400">{audienceCountError}</p>
			{/if}
			{#if data.tags.length === 0 && data.segments.length === 0}
				<p class="text-text-tertiary mt-3 text-xs">
					No saved tags or segments are available; this draft targets all eligible subscribed
					phones.
				</p>
			{/if}
		</div>

		{#if body.trim()}
			<div class="border-surface-border mb-6 rounded-md border p-4">
				<h2 class="text-text-tertiary mb-3 text-sm font-medium">Preview</h2>
				<div class="bg-surface-overlay mx-auto max-w-xs rounded-lg px-4 py-3">
					<p class="text-text-primary text-sm whitespace-pre-wrap">{body.trim()}</p>
				</div>
			</div>
		{/if}

		<div class="flex items-center justify-end gap-3">
			<a
				href="/org/{data.org.slug}/sms"
				class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-lg border px-4 py-2 text-sm"
			>
				Cancel
			</a>
			<button
				onclick={() => saveDraft(false)}
				disabled={saving || !isValid}
				class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-4 py-2 text-sm disabled:opacity-50"
			>
				{saving ? 'Saving...' : 'Save draft'}
			</button>
			<button
				onclick={() => saveDraft(true)}
				disabled={saving || !canContinueToDispatch}
				class="border-surface-border-strong text-text-secondary rounded-md border px-4 py-2 text-sm hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50"
			>
				{saving ? 'Saving...' : 'Save and open dispatch'}
			</button>
		</div>
	</div>
</div>
