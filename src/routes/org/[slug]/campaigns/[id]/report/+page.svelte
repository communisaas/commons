<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { FEATURES } from '$lib/config/features';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let selectedTargets = $state<Set<string>>(new Set());
	let logResponseDeliveryId = $state<string | null>(null);
	let logResponseType = $state('replied');
	let logResponseDetail = $state('');
	let logResponseLoading = $state(false);

	const selectedCount = $derived(selectedTargets.size);
	const hasTargets = $derived(data.targets.length > 0);

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
				return 'bg-purple-400';
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
	<nav class="flex items-center gap-2 text-sm text-text-tertiary">
		<a href="/org/{data.org.slug}/campaigns" class="hover:text-text-secondary transition-colors">
			Campaigns
		</a>
		<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
		</svg>
		<a href="/org/{data.org.slug}/campaigns/{data.campaign.id}" class="hover:text-text-secondary transition-colors">
			{data.campaign.title}
		</a>
		<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
		</svg>
		<span class="text-text-tertiary">Deliver Proof</span>
	</nav>

	<!-- Error/success messages -->
	{#if form?.error}
		<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
			{form.error}
		</div>
	{/if}
	{#if form?.success}
		<div class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
			Proof delivered to {form.sentCount} decision-maker{form.sentCount === 1 ? '' : 's'}
		</div>
	{/if}

	<!-- Proof context -->
	<div class="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-6 py-4">
		<p class="text-sm text-text-secondary">
			You're about to deliver cryptographic proof of constituent support.
		</p>
		{#if data.packet}
			<p class="text-sm text-text-tertiary mt-1">
				{#if FEATURES.ENGAGEMENT_METRICS}
					This packet contains <span class="font-mono tabular-nums text-emerald-400 font-semibold">{data.packet.verified.toLocaleString('en-US')}</span> verified actions
					across <span class="font-mono tabular-nums text-teal-400">{data.packet.districtCount}</span> districts.
				{/if}
				Each recipient will see verification they cannot fabricate or dismiss.
			</p>
		{/if}
	</div>

	<!-- Targets + Send -->
	<form method="POST" action="?/send" use:enhance={({ cancel }) => {
		if (!confirm(`Deliver proof packet to ${selectedCount} decision-maker${selectedCount === 1 ? '' : 's'}? This delivers a cryptographic verification report.`)) {
			cancel();
			return;
		}
		return async ({ update }) => {
			await update({ reset: false });
		};
	}} class="space-y-6">
		<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
			<div class="flex items-center justify-between">
				<p class="text-xs font-mono uppercase tracking-wider text-text-tertiary">Decision-maker recipients</p>
				{#if hasTargets}
					<button
						type="button"
						onclick={toggleAll}
						class="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
					>
						{selectedTargets.size === data.targets.length ? 'Deselect all' : 'Select all'}
					</button>
				{/if}
			</div>

			{#if !hasTargets}
				<div class="py-4 text-center">
					<p class="text-sm text-text-tertiary">No decision-makers targeted.</p>
					<p class="text-xs text-text-quaternary mt-1">
						Add recipients in campaign settings to enable proof delivery.
					</p>
				</div>
			{:else}
				<div class="space-y-2">
					{#each data.targets as target}
						{@const isSelected = selectedTargets.has(target.email)}
						<label
							class="flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors
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
								class="rounded border-text-quaternary bg-surface-overlay text-teal-500 focus:ring-teal-500/40 focus:ring-offset-0"
							/>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<span class="text-sm text-text-primary truncate">
										{target.name ?? target.email}
									</span>
									{#if target.title}
										<span class="text-xs text-text-tertiary truncate">{target.title}</span>
									{/if}
								</div>
								<div class="flex items-center gap-3 mt-0.5">
									<span class="text-xs font-mono text-text-tertiary">{target.email}</span>
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
		<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
			<p class="text-xs font-mono uppercase tracking-wider text-text-tertiary">Email Preview</p>
			<div class="rounded-lg border border-surface-border bg-surface-raised overflow-hidden" style="max-height: 600px; overflow-y: auto;">
				<iframe
					srcdoc={data.renderedHtml}
					title="Report email preview"
					class="w-full border-0"
					style="height: 600px; background: #09090b;"
					sandbox=""
				></iframe>
			</div>
		</div>

		<!-- Send button -->
		{#if hasTargets}
			<div class="flex items-center gap-4">
				<button
					type="submit"
					disabled={selectedCount === 0}
					class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-6 py-3 text-sm font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
				>
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
					</svg>
					Deliver proof to {selectedCount} decision-maker{selectedCount === 1 ? '' : 's'}
				</button>
				<a
					href="/org/{data.org.slug}/campaigns/{data.campaign.id}"
					class="rounded-lg bg-surface-overlay px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-raised transition-colors"
				>
					Back to campaign
				</a>
			</div>
		{:else}
			<a
				href="/org/{data.org.slug}/campaigns/{data.campaign.id}"
				class="inline-flex rounded-lg bg-surface-overlay px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-surface-raised transition-colors"
			>
				Back to campaign
			</a>
		{/if}
	</form>

	<!-- Delivery Timeline -->
	{#if data.pastDeliveries.length > 0}
		<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-6">
			<p class="text-xs font-mono uppercase tracking-wider text-text-tertiary">Proof delivery arc</p>

			{#each data.pastDeliveries as delivery}
				<div class="rounded-lg border border-surface-border bg-surface-raised p-4 space-y-3">
					<!-- Delivery header -->
					<div class="flex items-start justify-between gap-4">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<span class="text-sm text-text-primary font-medium truncate">
									{delivery.targetName ?? delivery.targetEmail}
								</span>
								<span class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono {statusBadgeClass(delivery.status)}">
									{delivery.status}
								</span>
							</div>
							<div class="flex items-center gap-3 mt-0.5">
								{#if delivery.targetName}
									<span class="text-xs font-mono text-text-tertiary">{delivery.targetEmail}</span>
								{/if}
								{#if delivery.targetTitle}
									<span class="text-xs text-text-quaternary">{delivery.targetTitle}</span>
								{/if}
								{#if delivery.targetDistrict}
									<span class="text-xs text-teal-500/60">{delivery.targetDistrict}</span>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-2 shrink-0">
							{#if delivery.proofStrength}
								<span class="text-xs font-mono tabular-nums text-emerald-400">{delivery.proofStrength.verified.toLocaleString('en-US')}</span>
								<span class="text-xs text-text-quaternary">/</span>
								<span class="text-xs font-mono tabular-nums text-teal-400">{delivery.proofStrength.districtCount}d</span>
							{/if}
						</div>
					</div>

					<!-- Timeline -->
					<div class="relative ml-2 border-l border-surface-border pl-4 space-y-2">
						<!-- Sent event (always present) -->
						<div class="relative flex items-start gap-2">
							<div class="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-teal-400 ring-2 ring-surface-raised"></div>
							<div class="flex-1">
								<span class="text-xs text-text-secondary">Sent</span>
								<span class="text-xs font-mono tabular-nums text-text-quaternary ml-2">
									{delivery.sentAt ? formatDate(delivery.sentAt) : formatDate(delivery.createdAt)}
								</span>
							</div>
						</div>

						<!-- Response events -->
						{#each delivery.responses as response}
							<div class="relative flex items-start gap-2">
								<div class="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full {eventDotColor(response.type)} ring-2 ring-surface-raised"></div>
								<div class="flex-1">
									<span class="text-xs text-text-secondary">{eventLabel(response.type)}</span>
									<span class="text-xs font-mono {confidenceBadge(response.confidence)} ml-1">
										{response.confidence}
									</span>
									<span class="text-xs font-mono tabular-nums text-text-quaternary ml-2">
										{formatDate(response.occurredAt)}
									</span>
									{#if response.detail}
										<p class="text-xs text-text-tertiary mt-0.5 italic">{response.detail}</p>
									{/if}
								</div>
							</div>
						{/each}
					</div>

					<!-- Log Response button -->
					<div class="pt-1">
						<button
							type="button"
							onclick={() => { logResponseDeliveryId = delivery.id; }}
							class="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
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
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
			<div class="rounded-md border border-surface-border bg-surface-base p-6 w-full max-w-md space-y-4">
				<h3 class="text-sm font-semibold text-text-primary">Log Decision-Maker Response</h3>

				<div class="space-y-3">
					<div>
						<label for="response-type" class="block text-xs font-mono text-text-tertiary mb-1">Response type</label>
						<select
							id="response-type"
							bind:value={logResponseType}
							class="w-full rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-teal-500/40"
						>
							<option value="replied">Replied</option>
							<option value="meeting_requested">Meeting Requested</option>
							<option value="vote_cast">Vote Cast</option>
							<option value="public_statement">Public Statement</option>
						</select>
					</div>

					<div>
						<label for="response-detail" class="block text-xs font-mono text-text-tertiary mb-1">Detail (optional)</label>
						<textarea
							id="response-detail"
							bind:value={logResponseDetail}
							rows="3"
							placeholder="e.g., Reply excerpt, vote direction, statement summary..."
							class="w-full rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder:text-text-quaternary focus:outline-none focus:ring-1 focus:ring-teal-500/40 resize-none"
						></textarea>
					</div>
				</div>

				<div class="flex items-center gap-3 justify-end">
					<button
						type="button"
						onclick={() => { logResponseDeliveryId = null; }}
						class="rounded-lg px-4 py-2 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={logResponseLoading}
						onclick={submitLogResponse}
						class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-40"
					>
						{logResponseLoading ? 'Saving...' : 'Log Response'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
