<script lang="ts">
	import SmsReplyRegister from '$lib/components/sms/SmsReplyRegister.svelte';
	import SmsMessageTable from '$lib/components/sms/SmsMessageTable.svelte';
	import BoundedNotice from '$lib/components/org/BoundedNotice.svelte';
	import {
		MAX_DECRYPTED_SMS_DISPATCH,
		textDeliveryLimitNotice
	} from '$lib/data/org-limit-sentences';
	import { Datum } from '$lib/design';
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
	const replyCount = $derived(data.replies.length);
	const textLimitNotice = $derived(
		data.textDispatchRuntimeReady
			? null
			: textDeliveryLimitNotice(
					{
						dispatchRuntimeMissing: data.textDispatchRuntimeMissing,
						dispatchRuntimeDependency: data.textDispatchRuntimeDependency,
						dispatchRuntimeMessage: data.textDispatchRuntimeMessage
					},
					{ artifactExists: data.blast.status === 'draft' }
				)
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
					? "Sending isn't available yet."
					: data.blast.status !== 'draft' && data.blast.status !== 'sending'
						? 'This text has already been sent.'
						: 'Your organization passphrase is required before phone numbers can be decrypted.';
			return;
		}
		if (
			!confirm(
				'Send this text to all eligible subscribed phones? Phone numbers are decrypted in your browser only for sending and are never stored.'
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
					message: `Sent in ${batchCount} batch${batchCount === 1 ? '' : 'es'} from this browser.`
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
	<title>Text | {data.org.name}</title>
</svelte:head>

<div id="text-delivery-detail" class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<a
			href="/org/{data.org.slug}/sms"
			class="text-text-tertiary hover:text-text-primary mb-6 inline-block text-sm"
		>
			&larr; Texts
		</a>

		<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
			<div>
				<div class="mb-2 flex items-center gap-3">
					<h1 class="text-text-primary text-2xl font-bold">Text blast</h1>
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

		{#if textLimitNotice}
			<div
				id="text-dispatch-status"
				class="border-surface-border bg-surface-base my-6 rounded-md border px-4 py-3"
			>
				<BoundedNotice notice={textLimitNotice} />
			</div>
		{/if}

		{#if data.blast.status === 'draft' || data.blast.status === 'sending'}
			<div class="border-surface-border bg-surface-base mb-6 rounded-md border p-4">
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p class="text-text-primary text-sm font-semibold">Send from this browser</p>
						<p class="text-text-tertiary mt-1 text-sm">
							{#if canAttemptClientDispatch}
								Recipient phone numbers are decrypted in your browser and sent in batches of {MAX_DECRYPTED_SMS_DISPATCH}.
							{:else if routeDispatchBlockers.length > 0}
								Sending isn't available yet.
							{:else if data.blast.status !== 'draft' && data.blast.status !== 'sending'}
								This text has already been sent.
							{:else}
								Your organization passphrase is required before phone numbers can be decrypted.
							{/if}
						</p>
					</div>
					<button
						type="button"
						onclick={dispatchTextCohort}
						disabled={dispatching || !canAttemptClientDispatch}
						class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
					>
						{dispatching ? 'Sending...' : 'Send to eligible recipients'}
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
						{dispatchResult.sentCount}/{dispatchResult.totalRecipients} sent.
						{dispatchResult.message}
					</p>
				{/if}
			</div>
		{/if}

		<div
			id="text-audience"
			class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
			aria-label="Text delivery counts"
		>
			<div class="border-surface-border rounded-lg border p-4">
				<p class="text-text-tertiary text-xs font-medium">Planned recipients</p>
				<p class="text-text-primary mt-1 text-lg font-bold">
					<Datum value={data.blast.totalRecipients} />
				</p>
			</div>
			{#if textCarrierCounterEvidenceObserved}
				<div class="border-surface-border rounded-lg border p-4">
					<p class="text-text-tertiary text-xs font-medium">Accepted</p>
					<p class="text-text-primary mt-1 text-lg font-bold">
						<Datum value={data.blast.sentCount} />
					</p>
				</div>
				<div class="border-surface-border rounded-lg border p-4">
					<p class="text-text-tertiary text-xs font-medium">Confirmed</p>
					<p class="mt-1 text-lg font-bold text-green-400">
						<Datum value={data.blast.deliveredCount} />
					</p>
				</div>
				<div class="border-surface-border rounded-lg border p-4">
					<p class="text-text-tertiary text-xs font-medium">Failed</p>
					<p class="mt-1 text-lg font-bold text-red-400">
						<Datum value={data.blast.failedCount} />
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
			<h3 class="text-text-tertiary mb-3 text-sm font-medium">Delivery log</h3>
			{#if !textCarrierCounterEvidenceObserved}
				<p class="text-text-tertiary mb-3 text-xs">
					Per-recipient delivery results appear here after this text is sent.
				</p>
			{/if}
			<SmsMessageTable messages={data.messages} />
		</div>

		<div id="text-replies" class="border-surface-border bg-surface-base mt-6 rounded-md border p-4">
			<div class="mb-4 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h3 class="text-text-secondary text-sm font-medium">Replies</h3>
					<p class="text-text-tertiary mt-1 text-xs">
						Replies to this text, shown without exposing phone numbers.
					</p>
				</div>
				<div class="bg-surface-overlay rounded-md px-4 py-3 text-right">
					<p class="text-text-primary text-xl leading-none font-semibold">
						<Datum value={replyCount} />
					</p>
					<p class="text-text-tertiary mt-1 text-xs">linked replies</p>
				</div>
			</div>
			<SmsReplyRegister replies={data.replies} orgSlug={data.org.slug} />
		</div>
	</div>
</div>
