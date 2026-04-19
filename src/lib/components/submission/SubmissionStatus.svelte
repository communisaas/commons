<script lang="ts">
	import { CheckCircle2, Send, AlertCircle, ExternalLink, RotateCcw } from '@lucide/svelte';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { z } from 'zod';

	let {
		submissionId,
		initialStatus = 'sending',
		onOverride,
		onDelivered
	}: {
		submissionId: string;
		initialStatus?: 'sending' | 'delivered' | 'failed';
		onOverride?: () => void;
		onDelivered?: () => void;
	} = $props();

	let status = $state(untrack(() => initialStatus));
	let details = $state<string | null>(null);
	let deliveryCount = $state<number | null>(null);
	let canOverride = $state(true);
	let retrying = $state(false);

	// Zod schema for the submission status API response
	const StatusResponseSchema = z.object({
		status: z.enum(['pending', 'processing', 'delivered', 'partial', 'failed']),
		deliveryCount: z.number(),
		deliveredAt: z.string().nullable(),
		error: z.string().nullable()
	});

	// Poll interval handle
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	let abortController = new AbortController();

	// Track whether onDelivered has been called to avoid duplicate calls
	let deliveredCallbackFired = false;
	// Generation counter to discard stale poll responses after retry
	let pollGeneration = 0;

	/**
	 * Map backend delivery_status to UI status.
	 * - pending/processing -> 'sending' (progress animation)
	 * - delivered/partial  -> 'delivered'
	 * - failed             -> 'failed'
	 */
	function mapBackendStatus(backendStatus: string): 'sending' | 'delivered' | 'failed' {
		switch (backendStatus) {
			case 'pending':
			case 'processing':
				return 'sending';
			case 'delivered':
			case 'partial':
				return 'delivered';
			case 'failed':
				return 'failed';
			default:
				return 'sending';
		}
	}

	function isTerminalStatus(backendStatus: string): boolean {
		return backendStatus === 'delivered' || backendStatus === 'partial' || backendStatus === 'failed';
	}

	async function pollStatus() {
		const currentGeneration = pollGeneration;
		try {
			const response = await fetch(`/api/submissions/${submissionId}/status`, {
				signal: abortController.signal
			});

			// Discard stale responses from before a retry
			if (currentGeneration !== pollGeneration) return;

			// Terminal HTTP errors: stop polling (session expired, wrong user, not found)
			if (response.status === 401 || response.status === 403 || response.status === 404) {
				status = 'failed';
				details = response.status === 401 ? 'Session expired' : 'Unable to check status';
				stopPolling();
				return;
			}

			if (!response.ok) {
				console.warn('[SubmissionStatus] Poll returned', response.status);
				return;
			}

			const parsed = await response.json();
			const result = StatusResponseSchema.safeParse(parsed);

			if (!result.success) {
				console.warn('[SubmissionStatus] Invalid status response:', result.error.flatten());
				return;
			}

			const data = result.data;

			// Update UI state
			status = mapBackendStatus(data.status);
			deliveryCount = data.deliveryCount;

			if (data.error) {
				details = data.error;
			}

			// Fire onDelivered callback when reaching terminal success
			if (
				(data.status === 'delivered' || data.status === 'partial') &&
				!deliveredCallbackFired
			) {
				deliveredCallbackFired = true;
				onDelivered?.();
			}

			// Stop polling on terminal states
			if (isTerminalStatus(data.status)) {
				stopPolling();
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			console.error('[SubmissionStatus] Polling error:', err);
		}
	}

	function startPolling() {
		if (pollInterval) return;
		// Set interval first (prevents race if initial poll resolves synchronously),
		// then do immediate poll
		pollInterval = setInterval(pollStatus, 2000);
		pollStatus();
	}

	function stopPolling() {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
	}

	async function handleRetry() {
		retrying = true;
		try {
			const response = await fetch(`/api/submissions/${submissionId}/retry`, {
				method: 'POST'
			});

			if (response.ok) {
				// Bump generation to discard stale poll responses from before retry
				pollGeneration++;
				status = 'sending';
				details = null;
				deliveredCallbackFired = false;
				startPolling();
			} else {
				const data = await response.json();
				details = data.error || 'Retry failed';
			}
		} catch (err) {
			console.error('[SubmissionStatus] Retry error:', err);
			details = 'Failed to retry delivery';
		} finally {
			retrying = false;
		}
	}

	onMount(() => {
		startPolling();
	});

	onDestroy(() => {
		stopPolling();
		abortController.abort();
	});

	// Status display configuration - use derived for reactive updates
	const statusConfig = $derived({
		sending: {
			icon: Send,
			text: 'Message sent',
			description: 'Routing through delivery system',
			color: 'blue'
		},
		delivered: {
			icon: CheckCircle2,
			text: deliveryCount ? `Delivered to ${deliveryCount} offices` : 'Delivered to Congress',
			description: 'Message received by congressional offices',
			color: 'green'
		},
		failed: {
			icon: AlertCircle,
			text: 'Delivery failed',
			description: details || 'Unable to deliver message',
			color: 'red'
		}
	});

	const config = $derived(statusConfig[status]);
</script>

<div class="rounded-lg border border-slate-200 bg-white p-4">
	<div class="flex items-start justify-between">
		<div class="flex items-start gap-3">
			{#if config}
				{@const IconComponent = config.icon}
				<IconComponent
					class="mt-0.5 h-5 w-5 shrink-0 {config.color === 'blue'
						? 'text-participation-primary-600'
						: config.color === 'green'
							? 'text-green-600'
							: 'text-red-600'} {status === 'sending' ? 'animate-pulse' : ''}"
				/>
			{/if}

			<div>
				<h4 class="text-base font-medium text-slate-900">
					{config?.text || 'Processing'}
				</h4>
				<p class="mt-1 text-sm text-slate-600">
					{config?.description || ''}
				</p>

				{#if status === 'delivered' && details}
					<p class="mt-2 text-xs text-slate-500">
						{details}
					</p>
				{/if}
			</div>
		</div>

		{#if canOverride && onOverride && status === 'sending'}
			<button
				onclick={onOverride}
				class="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
			>
				Send anyway
				<ExternalLink class="h-3 w-3" />
			</button>
		{/if}
	</div>

	{#if status === 'failed'}
		<div class="mt-4 flex gap-3">
			<button
				onclick={handleRetry}
				disabled={retrying}
				class="flex items-center gap-1.5 rounded bg-participation-primary-600 px-3 py-2 text-sm text-white hover:bg-participation-primary-700 disabled:opacity-50"
			>
				<RotateCcw class="h-3.5 w-3.5 {retrying ? 'animate-spin' : ''}" />
				{retrying ? 'Retrying...' : 'Retry delivery'}
			</button>

			{#if onOverride}
				<button
					onclick={onOverride}
					class="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
				>
					Send as-is
				</button>
			{/if}
		</div>
	{/if}
</div>
