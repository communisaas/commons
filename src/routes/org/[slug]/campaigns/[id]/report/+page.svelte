<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Datum } from '$lib/design';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let selectedTargets = $state<Set<string>>(new Set());
	let logResponseDeliveryId = $state<string | null>(null);
	let logResponseType = $state('replied');
	let logResponseDetail = $state('');
	let logResponseLoading = $state(false);

	const selectedCount = $derived(selectedTargets.size);
	const hasTargets = $derived(data.targets.length > 0);
	const packetVerified = $derived(data.packet ? data.packet.verified : null);
	const packetDistricts = $derived(data.packet ? data.packet.districtCount : null);

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
			return "Delivery receipt recorded. Permanent anchoring isn't available yet.";
		}
		if (delivery.receiptEligibility === 'eligible') {
			return "A receipt records automatically once delivery is accepted. Permanent anchoring isn't available yet.";
		}
		const blockers = delivery.receiptBlockers.map((blocker) =>
			blocker === 'missing_bill' ? 'a bill link' : 'a matched decision-maker'
		);
		return `This delivery needs ${blockers.join(' and ')} before a receipt can be recorded.`;
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
					<Datum value={packetVerified} />
				</span>
				verified actions across
				<span class="font-mono text-teal-400 tabular-nums">
					<Datum value={packetDistricts} />
				</span>
				districts.
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
