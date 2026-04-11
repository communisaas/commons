<script lang="ts">
	import { enhance } from '$app/forms';
	import { browser } from '$app/environment';
	import { FEATURES } from '$lib/config/features';
	import VerificationPacket from '$lib/components/org/VerificationPacket.svelte';
	import DeliveryMetrics from '$lib/components/org/DeliveryMetrics.svelte';
	import VerificationTimeline from '$lib/components/org/VerificationTimeline.svelte';
	import GeographicSpread from '$lib/components/org/GeographicSpread.svelte';
	import CoordinationIntegrity from '$lib/components/org/CoordinationIntegrity.svelte';
	import CountrySelector from '$lib/components/geographic/CountrySelector.svelte';
	import JurisdictionPicker from '$lib/components/geographic/JurisdictionPicker.svelte';
	import DebateSettlement from '$lib/components/debate/DebateSettlement.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Live verification packet — starts from server data, updates via SSE
	let packet = $state(data.packet);

	// SSE connection for live packet updates on active campaigns
	$effect(() => {
		if (!browser) return;
		if (!data.packet) return;
		if (data.campaign.status !== 'ACTIVE' && data.campaign.status !== 'PAUSED') return;

		const es = new EventSource(`/api/org/${data.org.slug}/campaigns/${data.campaign.id}/stream`);

		es.addEventListener('packet', (e: MessageEvent) => {
			try {
				packet = JSON.parse(e.data);
			} catch {
				// Invalid JSON, skip
			}
		});

		es.addEventListener('error', () => {
			// SSE disconnected — browser will auto-reconnect
		});

		return () => es.close();
	});

	// Live debate data — starts from server, updates via SSE
	let liveDebate = $state(data.debate);

	// Debate SSE connection for real-time updates
	$effect(() => {
		if (!browser) return;
		if (!FEATURES.DEBATE) return;
		if (!liveDebate?.id) return;
		if (liveDebate.status === 'resolved') return;

		const es = new EventSource(`/api/debates/${liveDebate.id}/stream`);

		es.addEventListener('debate:argument', (e: MessageEvent) => {
			try {
				const d = JSON.parse(e.data);
				if (liveDebate && typeof d.argumentCount === 'number') {
					liveDebate = { ...liveDebate, argumentCount: d.argumentCount, uniqueParticipants: d.uniqueParticipants ?? liveDebate.uniqueParticipants };
				}
			} catch { /* skip */ }
		});

		es.addEventListener('debate:position', (e: MessageEvent) => {
			try {
				const d = JSON.parse(e.data);
				if (liveDebate && typeof d.uniqueParticipants === 'number') {
					liveDebate = { ...liveDebate, uniqueParticipants: d.uniqueParticipants };
				}
			} catch { /* skip */ }
		});

		es.addEventListener('debate:settled', (e: MessageEvent) => {
			try {
				const d = JSON.parse(e.data);
				if (liveDebate) {
					liveDebate = { ...liveDebate, status: 'resolved', winningStance: d.winningStance ?? liveDebate.winningStance };
				}
			} catch { /* skip */ }
		});

		// Also handle other resolution events
		for (const evt of ['resolved_with_ai', 'resolution_finalized']) {
			es.addEventListener(evt, (e: MessageEvent) => {
				try {
					const d = JSON.parse(e.data);
					if (liveDebate) {
						liveDebate = { ...liveDebate, status: 'resolved', winningStance: d.winningStance ?? liveDebate.winningStance };
					}
				} catch { /* skip */ }
			});
		}

		es.addEventListener('error', () => {
			// Browser auto-reconnects SSE
		});

		return () => es.close();
	});

	let debateEnabled = $state(data.campaign.debateEnabled);
	let targetCountry = $state(data.campaign.targetCountry ?? 'US');
	let targetJurisdiction = $state(data.campaign.targetJurisdiction ?? '');
	let embedOpen = $state(false);
	let embedCopied = $state(false);

	const embedCode = $derived(
		`<iframe\n  src="https://commons.email/embed/campaign/${data.campaign.id}"\n  style="width:100%;border:none;min-height:400px"\n  sandbox="allow-forms allow-scripts allow-same-origin"\n  loading="lazy"\n></iframe>`
	);

	async function copyEmbed() {
		if (!browser) return;
		try {
			await navigator.clipboard.writeText(embedCode);
			embedCopied = true;
			setTimeout(() => { embedCopied = false; }, 2000);
		} catch {
			// Fallback for older browsers
			const textarea = document.createElement('textarea');
			textarea.value = embedCode;
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
			embedCopied = true;
			setTimeout(() => { embedCopied = false; }, 2000);
		}
	}

	const canEdit = $derived(
		data.membership.role === 'owner' || data.membership.role === 'editor'
	);

	const isEditable = $derived(data.campaign.status !== 'COMPLETE');

	// Status transition helpers
	const transitions = $derived(getTransitions(data.campaign.status));

	function getTransitions(status: string): Array<{ target: string; label: string; style: string }> {
		switch (status) {
			case 'DRAFT':
				return [
					{ target: 'ACTIVE', label: 'Go Live', style: 'bg-emerald-600 hover:bg-emerald-500 text-white' }
				];
			case 'ACTIVE':
				return [
					{ target: 'PAUSED', label: 'Pause', style: 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-600/30' },
					{ target: 'COMPLETE', label: 'Complete', style: 'bg-surface-overlay hover:bg-surface-raised text-text-primary' }
				];
			case 'PAUSED':
				return [
					{ target: 'ACTIVE', label: 'Resume', style: 'bg-emerald-600 hover:bg-emerald-500 text-white' },
					{ target: 'COMPLETE', label: 'Complete', style: 'bg-surface-overlay hover:bg-surface-raised text-text-primary' }
				];
			default:
				return [];
		}
	}

	function statusBadgeClass(status: string): string {
		switch (status) {
			case 'DRAFT':
				return 'bg-text-quaternary/20 text-text-tertiary border-text-quaternary/30';
			case 'ACTIVE':
				return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'PAUSED':
				return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
			case 'COMPLETE':
				return 'bg-text-tertiary/15 text-text-tertiary border-text-tertiary/20';
			default:
				return 'bg-text-tertiary/15 text-text-tertiary border-text-tertiary/20';
		}
	}

	function typeBadgeClass(type: string): string {
		switch (type) {
			case 'LETTER':
				return 'bg-teal-500/15 text-teal-400 border-teal-500/20';
			case 'EVENT':
				return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20';
			case 'FORM':
				return 'bg-text-tertiary/15 text-text-tertiary border-text-tertiary/20';
			default:
				return 'bg-text-tertiary/15 text-text-tertiary border-text-tertiary/20';
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

	function debateStatusBadge(status: string): { label: string; classes: string } {
		switch (status) {
			case 'active':
				return { label: 'Active', classes: 'bg-blue-500/15 text-blue-400 border-blue-500/20' };
			case 'resolving':
				return { label: 'Resolving', classes: 'bg-amber-500/15 text-amber-400 border-amber-500/20' };
			case 'resolved':
				return { label: 'Resolved', classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' };
			default:
				return { label: status, classes: 'bg-text-tertiary/15 text-text-tertiary border-text-tertiary/20' };
		}
	}

	function timeRemaining(deadline: string): string {
		const diff = new Date(deadline).getTime() - Date.now();
		if (diff <= 0) return 'Expired';
		const hours = Math.floor(diff / (1000 * 60 * 60));
		const days = Math.floor(hours / 24);
		if (days > 0) return `${days}d ${hours % 24}h remaining`;
		const mins = Math.floor((diff / (1000 * 60)) % 60);
		return `${hours}h ${mins}m remaining`;
	}

	const debateThresholdPct = $derived(
		data.actionCount != null && data.campaign.debateThreshold
			? Math.min(100, Math.round((data.actionCount / data.campaign.debateThreshold) * 100))
			: 0
	);
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
		<span class="text-text-tertiary truncate">{data.campaign.title}</span>
	</nav>

	<!-- Status bar -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<span class="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-mono {statusBadgeClass(data.campaign.status)}">
				{data.campaign.status}
			</span>
			<span class="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-mono {typeBadgeClass(data.campaign.type)}">
				{data.campaign.type}
			</span>
			<span class="font-mono text-xs text-text-tertiary">
				Updated {formatDate(data.campaign.updatedAt)}
			</span>
		</div>

		{#if canEdit && transitions.length > 0}
			<div class="flex items-center gap-2">
				{#each transitions as t}
					<form method="POST" action="?/updateStatus" use:enhance>
						<input type="hidden" name="status" value={t.target} />
						<button
							type="submit"
							class="rounded-lg px-4 py-2 text-sm font-medium transition-colors {t.style}"
						>
							{t.label}
						</button>
					</form>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Error/success messages -->
	{#if form?.error}
		<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
			{form.error}
		</div>
	{/if}
	{#if form?.success}
		<div class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
			{form.newStatus ? `Status updated to ${form.newStatus}` : 'Campaign saved'}
		</div>
	{/if}

	<!-- HERO: Verification Packet — the proof this campaign has assembled -->
	<VerificationPacket
		packet={packet}
		showDebate={data.campaign.debateEnabled}
	>
		{#snippet actions()}
			{#if data.campaign.status === 'ACTIVE' || data.campaign.status === 'PAUSED' || data.campaign.status === 'COMPLETE'}
				<div class="flex gap-3 pt-2">
					<a href="/org/{data.org.slug}/campaigns/{data.campaign.id}/report"
					   class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-500 transition-colors">
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
						</svg>
						Deliver Proof
					</a>
				</div>
			{/if}
		{/snippet}
	</VerificationPacket>

	<!-- Inline Debate Section -->
	{#if FEATURES.DEBATE}
		{#if liveDebate}
			{@const badge = debateStatusBadge(liveDebate.status)}
			<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-medium text-text-secondary">Adversarial Debate</h3>
					<span class="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-mono {badge.classes}">
						{badge.label}
					</span>
				</div>

				<p class="text-sm text-text-tertiary leading-relaxed">{liveDebate.propositionText}</p>

				<div class="flex items-center gap-4 text-xs text-text-tertiary font-mono">
					<span>{liveDebate.argumentCount} argument{liveDebate.argumentCount === 1 ? '' : 's'}</span>
					<span class="text-text-quaternary">&middot;</span>
					<span>{liveDebate.uniqueParticipants} participant{liveDebate.uniqueParticipants === 1 ? '' : 's'}</span>
					{#if liveDebate.status === 'active'}
						<span class="text-text-quaternary">&middot;</span>
						<span class="text-blue-400">{timeRemaining(liveDebate.deadline)}</span>
					{/if}
				</div>

				{#if liveDebate.status === 'resolved' && liveDebate.winningStance}
					<div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
						<div class="flex items-center gap-2">
							<span class="text-xs font-medium text-emerald-400">Winning stance: {liveDebate.winningStance}</span>
							{#if liveDebate.aiPanelConsensus != null}
								<span class="text-xs text-text-quaternary">&middot;</span>
								<span class="text-xs font-mono text-text-tertiary">
									{Math.round(liveDebate.aiPanelConsensus * 100)}% AI consensus
								</span>
							{/if}
						</div>
						{#if liveDebate.winningArgument}
							<p class="text-sm text-text-tertiary leading-relaxed">
								{liveDebate.winningArgument.body.length > 200
									? liveDebate.winningArgument.body.slice(0, 200) + '...'
									: liveDebate.winningArgument.body}
							</p>
						{/if}
					</div>
				{/if}

				<!-- Settlement controls (org admins only, active debates) -->
				<DebateSettlement
					debateId={liveDebate.id}
					debateStatus={liveDebate.status}
					winningStance={liveDebate.winningStance}
					reasoning={liveDebate.governanceJustification ?? null}
					canSettle={canEdit}
					onSettled={(result) => {
						if (liveDebate) {
							liveDebate = { ...liveDebate, status: 'resolved', winningStance: result.outcome.toUpperCase() };
						}
					}}
				/>

				<a
					href="/s/{liveDebate.templateSlug}/debate/{liveDebate.id}"
					class="inline-flex items-center gap-2 text-sm text-teal-400 hover:text-teal-300 transition-colors"
				>
					View full debate
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
					</svg>
				</a>
			</div>
		{:else if data.campaign.debateEnabled && !data.campaign.debateId && data.actionCount != null}
			<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-3">
				<h3 class="text-sm font-medium text-text-secondary">Adversarial Debate</h3>
				<p class="text-sm text-text-tertiary">
					{data.actionCount} of {data.campaign.debateThreshold} verified actions — debate activates at threshold
				</p>
				<div class="h-1.5 rounded-full bg-surface-raised overflow-hidden">
					<div
						class="h-full rounded-full bg-teal-600/60 transition-all"
						style="width: {debateThresholdPct}%"
					></div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Decision-Maker Targets -->
	<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
		<h3 class="text-sm font-medium text-text-secondary">Decision-Maker Targets</h3>

		{#if Array.isArray(data.campaign.targets) && data.campaign.targets.length > 0}
			<div class="overflow-x-auto">
				<table class="w-full text-left">
					<thead>
						<tr class="border-b border-surface-border">
							<th class="pb-2 text-xs font-medium text-text-tertiary w-6"></th>
							<th class="pb-2 text-xs font-medium text-text-tertiary">Name</th>
							<th class="pb-2 text-xs font-medium text-text-tertiary">Email</th>
							<th class="pb-2 text-xs font-medium text-text-tertiary">Title</th>
							<th class="pb-2 text-xs font-medium text-text-tertiary">District</th>
							{#if canEdit}
								<th class="pb-2 text-xs font-medium text-text-tertiary"></th>
							{/if}
						</tr>
					</thead>
					<tbody>
						{#each data.campaign.targets as target}
							<tr class="border-b border-surface-border">
								<td class="py-2 pr-2 text-emerald-400" title="Resolved">&#x25CF;</td>
								<td class="py-2 pr-4 text-sm text-text-secondary">{target.name}</td>
								<td class="py-2 pr-4 text-sm text-text-tertiary font-mono">{target.email}</td>
								<td class="py-2 pr-4 text-sm text-text-tertiary">{target.title ?? '—'}</td>
								<td class="py-2 pr-4 text-sm text-text-tertiary">{target.district ?? '—'}</td>
								{#if canEdit}
									<td class="py-2 text-right">
										<form method="POST" action="?/removeTarget" use:enhance class="inline">
											<input type="hidden" name="email" value={target.email} />
											<button type="submit" class="text-xs text-red-400 hover:text-red-300 transition-colors">
												Remove
											</button>
										</form>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-sm text-text-tertiary">No targets added. Add decision-makers to enable report delivery.</p>
		{/if}

		{#if canEdit}
			<form method="POST" action="?/addTarget" use:enhance class="space-y-3 border-t border-surface-border pt-4">
				<p class="text-xs font-medium text-text-tertiary">Add Target</p>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<input
						type="text"
						name="name"
						required
						placeholder="Name (required)"
						class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
					/>
					<input
						type="email"
						name="email"
						required
						placeholder="Email (required)"
						class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
					/>
					<input
						type="text"
						name="title"
						placeholder="Title (optional)"
						class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
					/>
					<input
						type="text"
						name="district"
						placeholder="District (optional)"
						class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
					/>
				</div>
				<button
					type="submit"
					class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 transition-colors"
				>
					Add Target
				</button>
			</form>
		{/if}
	</div>

	<!-- Embed widget -->
	{#if data.campaign.status === 'ACTIVE' || data.campaign.status === 'PAUSED'}
		<div class="rounded-md border border-surface-border bg-surface-base">
			<button
				type="button"
				onclick={() => { embedOpen = !embedOpen; }}
				class="flex w-full items-center justify-between px-6 py-4 text-left"
			>
				<div class="flex items-center gap-3">
					<svg class="h-4 w-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
					</svg>
					<span class="text-sm font-medium text-text-secondary">Embed Widget</span>
				</div>
				<svg
					class="h-4 w-4 text-text-tertiary transition-transform {embedOpen ? 'rotate-180' : ''}"
					fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
				</svg>
			</button>

			{#if embedOpen}
				<div class="border-t border-surface-border px-6 py-4 space-y-3">
					<p class="text-xs text-text-tertiary">
						Each person who takes action through this widget strengthens your proof packet.
						{#if packet}
							<span class="font-mono tabular-nums text-teal-400">{packet.verified}</span> verified and counting.
						{/if}
					</p>
					<div class="relative">
						<pre class="overflow-x-auto rounded-lg border border-surface-border-strong bg-surface-raised px-4 py-3 font-mono text-xs text-text-secondary leading-relaxed">{embedCode}</pre>
						<button
							type="button"
							onclick={copyEmbed}
							class="absolute right-2 top-2 rounded-md border border-surface-border-strong bg-surface-overlay px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-surface-raised transition-colors"
						>
							{embedCopied ? 'Copied!' : 'Copy'}
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Campaign settings -->
	<details open={data.campaign.status === 'DRAFT'}>
		<summary class="cursor-pointer rounded-md border border-surface-border bg-surface-base px-6 py-4 text-sm font-medium text-text-secondary hover:text-text-primary">
			Campaign settings
		</summary>
		<div class="mt-2">
			<form method="POST" action="?/update" use:enhance class="space-y-6">
				<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-5">
					<!-- Title -->
					<div>
						<label for="title" class="block text-sm font-medium text-text-secondary mb-1.5">Title</label>
						<input
							type="text"
							id="title"
							name="title"
							required
							disabled={!canEdit || !isEditable}
							value={data.campaign.title}
							class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						/>
					</div>

					<!-- Type -->
					<div>
						<label for="type" class="block text-sm font-medium text-text-secondary mb-1.5">Type</label>
						<select
							id="type"
							name="type"
							required
							disabled={!canEdit || !isEditable}
							class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<option value="LETTER" selected={data.campaign.type === 'LETTER'}>Letter</option>
							<option value="EVENT" selected={data.campaign.type === 'EVENT'}>Event</option>
							<option value="FORM" selected={data.campaign.type === 'FORM'}>Form</option>
						</select>
					</div>

					<!-- Body -->
					<div>
						<label for="body" class="block text-sm font-medium text-text-secondary mb-1.5">
							Description
							<span class="text-text-quaternary font-normal">(optional)</span>
						</label>
						<textarea
							id="body"
							name="body"
							rows="4"
							disabled={!canEdit || !isEditable}
							placeholder="Describe this campaign's purpose and goals..."
							class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors resize-y disabled:opacity-50 disabled:cursor-not-allowed"
						>{data.campaign.body ?? ''}</textarea>
					</div>

					<!-- Template -->
					<div>
						<label for="templateId" class="block text-sm font-medium text-text-secondary mb-1.5">
							Template
							<span class="text-text-quaternary font-normal">(optional)</span>
						</label>
						<select
							id="templateId"
							name="templateId"
							disabled={!canEdit || !isEditable}
							class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<option value="">None</option>
							{#each data.templates as template}
								<option value={template.id} selected={data.campaign.templateId === template.id}>
									{template.title}
								</option>
							{/each}
						</select>
					</div>

					<!-- Geographic targeting -->
					<div class="rounded-lg border border-surface-border bg-surface-raised p-4 space-y-4">
						<div>
							<p class="text-sm font-medium text-text-secondary">Geographic Targeting</p>
							<p class="text-xs text-text-tertiary mt-0.5">Country and jurisdiction for this campaign</p>
						</div>

						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div>
								<label for="targetCountry" class="block text-sm font-medium text-text-secondary mb-1.5">Country</label>
								<input type="hidden" name="targetCountry" value={targetCountry} />
								{#if canEdit && isEditable}
									<CountrySelector value={targetCountry} onchange={(c) => { targetCountry = c; targetJurisdiction = ''; }} />
								{:else}
									<p class="py-2 text-sm text-text-tertiary">{targetCountry}</p>
								{/if}
							</div>
							<div>
								<label for="targetJurisdiction" class="block text-sm font-medium text-text-secondary mb-1.5">Jurisdiction</label>
								<input type="hidden" name="targetJurisdiction" value={targetJurisdiction} />
								{#if canEdit && isEditable}
									<JurisdictionPicker value={targetJurisdiction || null} country={targetCountry} onchange={(j) => { targetJurisdiction = j; }} />
								{:else}
									<p class="py-2 text-sm text-text-tertiary">{targetJurisdiction || 'Not set'}</p>
								{/if}
							</div>
						</div>

						{#if targetJurisdiction}
							<p class="text-xs text-text-tertiary">
								Targeting <span class="text-text-secondary font-medium">{targetJurisdiction}</span> in <span class="text-text-secondary font-medium">{targetCountry}</span>
							</p>
						{/if}
					</div>

					<!-- Debate settings -->
					<div class="rounded-lg border border-surface-border bg-surface-raised p-4 space-y-4">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium text-text-secondary">Debate Market</p>
								<p class="text-xs text-text-tertiary mt-0.5">When enough supporters act, an adversarial debate strengthens your proof</p>
							</div>
							<label class="relative inline-flex items-center cursor-pointer">
								<input
									type="checkbox"
									name="debateEnabled"
									class="sr-only peer"
									disabled={!canEdit || !isEditable}
									bind:checked={debateEnabled}
								/>
								<div class="w-9 h-5 bg-surface-border-strong peer-focus:ring-2 peer-focus:ring-teal-500/40 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-text-tertiary after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600 peer-checked:after:bg-white disabled:opacity-50"></div>
							</label>
						</div>

						{#if debateEnabled}
							<p class="text-xs text-text-tertiary mt-2">
								When {data.campaign.debateThreshold ?? 10} supporters take action, an adversarial debate spawns. The strongest arguments surface and attach to your proof packet.
							</p>
							<div>
								<label for="debateThreshold" class="block text-sm font-medium text-text-secondary mb-1.5">
									Threshold
									<span class="text-text-quaternary font-normal">(minimum verified participants)</span>
								</label>
								<input
									type="number"
									id="debateThreshold"
									name="debateThreshold"
									min="1"
									disabled={!canEdit || !isEditable}
									value={data.campaign.debateThreshold}
									class="w-32 rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm font-mono text-text-primary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
								/>
							</div>
						{/if}
					</div>

					<!-- Save button -->
					{#if canEdit && isEditable}
						<div class="pt-2">
							<button
								type="submit"
								class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-500 transition-colors"
							>
								Save Changes
							</button>
						</div>
					{/if}
				</div>
			</form>
		</div>
	</details>

	<!-- Analytics detail -->
	{#if data.analytics}
		<details>
			<summary class="cursor-pointer rounded-md border border-surface-border bg-surface-base px-6 py-4 text-sm font-medium text-text-secondary hover:text-text-primary">
				Analytics detail
			</summary>
			<div class="mt-2 space-y-6">
				<!-- Email Delivery Metrics -->
				{#if FEATURES.ENGAGEMENT_METRICS}
					<DeliveryMetrics metrics={data.analytics.delivery} />
				{/if}

				<!-- Verification Timeline -->
				<VerificationTimeline timeline={data.analytics.timeline} />

				<!-- Analytics: two-column layout for geographic + coordination -->
				<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
					<!-- Geographic Spread -->
					<GeographicSpread
						topDistricts={data.analytics.topDistricts}
						districtCount={packet?.districtCount ?? 0}
					/>

					<!-- Coordination Integrity -->
					{#if packet}
						<CoordinationIntegrity packet={packet} />
					{/if}
				</div>
			</div>
		</details>
	{/if}

	<!-- Metadata footer -->
	<div class="flex items-center gap-6 text-xs text-text-quaternary border-t border-surface-border pt-4">
		<span>ID: <code class="font-mono text-text-tertiary">{data.campaign.id}</code></span>
		<span>Created: <span class="font-mono text-text-tertiary">{formatDate(data.campaign.createdAt)}</span></span>
	</div>
</div>
