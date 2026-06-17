<script lang="ts">
	import { enhance } from '$app/forms';
	import { browser } from '$app/environment';
	import { FEATURES } from '$lib/config/features';
	import VerificationPacket from '$lib/components/org/VerificationPacket.svelte';
	import DeliveryMetrics from '$lib/components/org/DeliveryMetrics.svelte';
	import VerificationTimeline from '$lib/components/org/VerificationTimeline.svelte';
	import GeographicSpread from '$lib/components/org/GeographicSpread.svelte';
	import CoordinationIntegrity from '$lib/components/org/CoordinationIntegrity.svelte';
	import IntegrityAssessment from '$lib/components/org/IntegrityAssessment.svelte';
	import CountrySelector from '$lib/components/geographic/CountrySelector.svelte';
	import JurisdictionPicker from '$lib/components/geographic/JurisdictionPicker.svelte';
	import DebateSettlement from '$lib/components/debate/DebateSettlement.svelte';
	import type { PageData, ActionData } from './$types';

	type CampaignView = PageData['campaign'] & {
		districtCode?: string;
		districtCentroid?: { lat: number; lng: number };
	};

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const campaign = $derived(data.campaign as CampaignView);

	// Live verification packet — starts from server data, updates via SSE
	let packetOverride = $state<PageData['packet'] | undefined>();
	const packet = $derived(packetOverride === undefined ? data.packet : packetOverride);

	$effect(() => {
		data.campaign.id;
		packetOverride = undefined;
	});

	// SSE connection for live packet updates on active campaigns
	$effect(() => {
		if (!browser) return;
		if (!data.packet) return;
		if (data.campaign.status !== 'ACTIVE' && data.campaign.status !== 'PAUSED') return;

		const es = new EventSource(`/api/org/${data.org.slug}/campaigns/${data.campaign.id}/stream`);

		es.addEventListener('packet', (e: MessageEvent) => {
			try {
				packetOverride = JSON.parse(e.data);
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
	let liveDebateOverride = $state<PageData['debate'] | undefined>();
	const liveDebate = $derived(liveDebateOverride === undefined ? data.debate : liveDebateOverride);

	$effect(() => {
		data.debate?.id;
		liveDebateOverride = undefined;
	});

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
					liveDebateOverride = {
						...liveDebate,
						argumentCount: d.argumentCount,
						uniqueParticipants: d.uniqueParticipants ?? liveDebate.uniqueParticipants
					};
				}
			} catch {
				/* skip */
			}
		});

		es.addEventListener('debate:position', (e: MessageEvent) => {
			try {
				const d = JSON.parse(e.data);
				if (liveDebate && typeof d.uniqueParticipants === 'number') {
					liveDebateOverride = { ...liveDebate, uniqueParticipants: d.uniqueParticipants };
				}
			} catch {
				/* skip */
			}
		});

		es.addEventListener('debate:settled', (e: MessageEvent) => {
			try {
				const d = JSON.parse(e.data);
				if (liveDebate) {
					liveDebateOverride = {
						...liveDebate,
						status: 'resolved',
						winningStance: d.winningStance ?? liveDebate.winningStance
					};
				}
			} catch {
				/* skip */
			}
		});

		// Also handle other resolution events
		for (const evt of ['resolved_with_ai', 'resolution_finalized']) {
			es.addEventListener(evt, (e: MessageEvent) => {
				try {
					const d = JSON.parse(e.data);
					if (liveDebate) {
						liveDebateOverride = {
							...liveDebate,
							status: 'resolved',
							winningStance: d.winningStance ?? liveDebate.winningStance
						};
					}
				} catch {
					/* skip */
				}
			});
		}

		es.addEventListener('error', () => {
			// Browser auto-reconnects SSE
		});

		return () => es.close();
	});

	let debateEnabledOverride = $state<boolean | undefined>();
	let targetCountryOverride = $state<string | undefined>();
	let targetJurisdictionOverride = $state<string | undefined>();
	const debateEnabled = $derived(debateEnabledOverride ?? data.campaign.debateEnabled);
	const targetCountry = $derived(targetCountryOverride ?? data.campaign.targetCountry ?? 'US');
	const targetJurisdiction = $derived(
		targetJurisdictionOverride ?? data.campaign.targetJurisdiction ?? ''
	);
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
			setTimeout(() => {
				embedCopied = false;
			}, 2000);
		} catch {
			// Fallback for older browsers
			const textarea = document.createElement('textarea');
			textarea.value = embedCode;
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
			embedCopied = true;
			setTimeout(() => {
				embedCopied = false;
			}, 2000);
		}
	}

	const canEdit = $derived(data.membership.role === 'owner' || data.membership.role === 'editor');

	const isEditable = $derived(data.campaign.status !== 'COMPLETE');

	// Status transition helpers
	const transitions = $derived(getTransitions(data.campaign.status));

	function getTransitions(status: string): Array<{ target: string; label: string; style: string }> {
		switch (status) {
			case 'DRAFT':
				return [
					{
						target: 'ACTIVE',
						label: 'Go Live',
						style: 'bg-emerald-600 hover:bg-emerald-500 text-white'
					}
				];
			case 'ACTIVE':
				return [
					{
						target: 'PAUSED',
						label: 'Pause',
						style: 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-600/30'
					},
					{
						target: 'COMPLETE',
						label: 'Complete',
						style: 'bg-surface-overlay hover:bg-surface-raised text-text-primary'
					}
				];
			case 'PAUSED':
				return [
					{
						target: 'ACTIVE',
						label: 'Resume',
						style: 'bg-emerald-600 hover:bg-emerald-500 text-white'
					},
					{
						target: 'COMPLETE',
						label: 'Complete',
						style: 'bg-surface-overlay hover:bg-surface-raised text-text-primary'
					}
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

	function targetResolved(target: { decisionMakerId?: unknown }): boolean {
		return typeof target.decisionMakerId === 'string' && target.decisionMakerId.length > 0;
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
				return {
					label: 'Resolving',
					classes: 'bg-amber-500/15 text-amber-400 border-amber-500/20'
				};
			case 'resolved':
				return {
					label: 'Resolved',
					classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
				};
			default:
				return {
					label: status,
					classes: 'bg-text-tertiary/15 text-text-tertiary border-text-tertiary/20'
				};
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
	<nav class="text-text-tertiary flex items-center gap-2 text-sm">
		<a href="/org/{data.org.slug}/campaigns" class="hover:text-text-secondary transition-colors">
			Action records
		</a>
		<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
		</svg>
		<span class="text-text-tertiary truncate">{data.campaign.title}</span>
	</nav>

	<!-- Status bar -->
	<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
		<div class="flex flex-wrap items-center gap-3">
			<span
				class="inline-flex items-center rounded-md border px-2.5 py-1 font-mono text-xs {statusBadgeClass(
					data.campaign.status
				)}"
			>
				{data.campaign.status}
			</span>
			<span
				class="inline-flex items-center rounded-md border px-2.5 py-1 font-mono text-xs {typeBadgeClass(
					data.campaign.type
				)}"
			>
				{data.campaign.type}
			</span>
			<span class="text-text-tertiary font-mono text-xs">
				Updated {formatDate(data.campaign.updatedAt)}
			</span>
		</div>

		{#if canEdit && transitions.length > 0}
			<div class="flex flex-wrap items-center gap-2">
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
		<div
			class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400"
		>
			{form.newStatus ? `Status updated to ${form.newStatus}` : 'Action saved'}
		</div>
	{/if}

	<!-- HERO: Verification Packet — the proof this action has assembled -->
	<VerificationPacket
		{packet}
		districtCode={campaign.districtCode}
		districtCentroid={campaign.districtCentroid}
		interactive
	>
		{#snippet actions()}
			{#if data.campaign.status === 'ACTIVE' || data.campaign.status === 'PAUSED' || data.campaign.status === 'COMPLETE'}
				<div class="flex gap-3 pt-2">
					<a
						href="/org/{data.org.slug}/campaigns/{data.campaign.id}/report"
						class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
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
						Open proof delivery
					</a>
				</div>
			{/if}
		{/snippet}
	</VerificationPacket>

	<!-- Participation integrity: one plain-language reading; raw scores stay in the collapsed audit -->
	{#if packet}
		<div class="border-surface-border bg-surface-base space-y-3 rounded-md border p-6">
			<h3 class="text-text-secondary text-sm font-medium">Participation integrity</h3>
			<IntegrityAssessment {packet} />
			<div class="border-surface-border border-t pt-3">
				<CoordinationIntegrity {packet} />
			</div>
		</div>
	{/if}

	<!-- Inline Debate Section -->
	{#if FEATURES.DEBATE}
		{#if liveDebate}
			{@const badge = debateStatusBadge(liveDebate.status)}
			<div class="border-surface-border bg-surface-base space-y-4 rounded-md border p-6">
				<div class="flex items-center justify-between">
					<h3 class="text-text-secondary text-sm font-medium">Adversarial Debate</h3>
					<span
						class="inline-flex items-center rounded-md border px-2.5 py-1 font-mono text-xs {badge.classes}"
					>
						{badge.label}
					</span>
				</div>

				<p class="text-text-tertiary text-sm leading-relaxed">{liveDebate.propositionText}</p>

				<div class="text-text-tertiary flex items-center gap-4 font-mono text-xs">
					<span>{liveDebate.argumentCount} argument{liveDebate.argumentCount === 1 ? '' : 's'}</span
					>
					<span class="text-text-quaternary">&middot;</span>
					<span
						>{liveDebate.uniqueParticipants} participant{liveDebate.uniqueParticipants === 1
							? ''
							: 's'}</span
					>
					{#if liveDebate.status === 'active'}
						<span class="text-text-quaternary">&middot;</span>
						<span class="text-blue-400">{timeRemaining(liveDebate.deadline)}</span>
					{/if}
				</div>

				{#if liveDebate.status === 'resolved' && liveDebate.winningStance}
					<div class="space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
						<div class="flex items-center gap-2">
							<span class="text-xs font-medium text-emerald-400"
								>Winning stance: {liveDebate.winningStance}</span
							>
							{#if liveDebate.aiPanelConsensus != null}
								<span class="text-text-quaternary text-xs">&middot;</span>
								<span class="text-text-tertiary font-mono text-xs">
									{Math.round(liveDebate.aiPanelConsensus * 100)}% AI consensus
								</span>
							{/if}
						</div>
						{#if liveDebate.winningArgument}
							<p class="text-text-tertiary text-sm leading-relaxed">
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
							liveDebateOverride = {
								...liveDebate,
								status: 'resolved',
								winningStance: result.outcome.toUpperCase()
							};
						}
					}}
				/>

				<a
					href="/s/{liveDebate.templateSlug}/debate/{liveDebate.id}"
					class="inline-flex items-center gap-2 text-sm text-teal-400 transition-colors hover:text-teal-300"
				>
					View full debate
					<svg
						class="h-3.5 w-3.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
						/>
					</svg>
				</a>
			</div>
		{:else if data.campaign.debateEnabled && !data.campaign.debateId && data.actionCount != null}
			<div class="border-surface-border bg-surface-base space-y-3 rounded-md border p-6">
				<h3 class="text-text-secondary text-sm font-medium">Adversarial Debate</h3>
				<p class="text-text-tertiary text-sm">
					{data.actionCount} of {data.campaign.debateThreshold} verified actions — debate activates at
					threshold
				</p>
				<div class="bg-surface-raised h-1.5 overflow-hidden rounded-full">
					<div
						class="h-full rounded-full bg-teal-600/60 transition-all"
						style="width: {debateThresholdPct}%"
					></div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Decision-maker recipients -->
	<div
		id="decision-maker-recipients"
		class="border-surface-border bg-surface-base scroll-mt-24 space-y-4 rounded-md border p-6"
	>
		<h3 class="text-text-secondary text-sm font-medium">Decision-maker recipients</h3>

		{#if Array.isArray(data.campaign.targets) && data.campaign.targets.length > 0}
			<div class="overflow-x-auto">
				<table class="w-full text-left">
					<thead>
						<tr class="border-surface-border border-b">
							<th class="text-text-tertiary w-6 pb-2 text-xs font-medium"></th>
							<th class="text-text-tertiary pb-2 text-xs font-medium">Name</th>
							<th class="text-text-tertiary pb-2 text-xs font-medium">Email</th>
							<th class="text-text-tertiary pb-2 text-xs font-medium">Title</th>
							<th class="text-text-tertiary pb-2 text-xs font-medium">District</th>
							{#if canEdit}
								<th class="text-text-tertiary pb-2 text-xs font-medium"></th>
							{/if}
						</tr>
					</thead>
					<tbody>
						{#each data.campaign.targets as target}
							<tr class="border-surface-border border-b">
								<td
									class="py-2 pr-2"
									title={targetResolved(target) ? 'Power target' : 'Manual entry'}
								>
									<span
										class="inline-block h-2 w-2 rounded-full {targetResolved(target)
											? 'bg-emerald-400'
											: 'bg-text-quaternary'}"
									></span>
								</td>
								<td class="text-text-secondary py-2 pr-4 text-sm">{target.name}</td>
								<td class="text-text-tertiary py-2 pr-4 font-mono text-sm">{target.email}</td>
								<td class="text-text-tertiary py-2 pr-4 text-sm">{target.title ?? '—'}</td>
								<td class="text-text-tertiary py-2 pr-4 text-sm">{target.district ?? '—'}</td>
								{#if canEdit}
									<td class="py-2 text-right">
										<form method="POST" action="?/removeTarget" use:enhance class="inline">
											<input type="hidden" name="email" value={target.email} />
											<button
												type="submit"
												class="text-xs text-red-400 transition-colors hover:text-red-300"
											>
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
			<p class="text-text-tertiary text-sm">
				No decision-makers added. Add recipients to enable proof delivery.
			</p>
		{/if}

		{#if canEdit}
			<form
				method="POST"
				action="?/addTarget"
				use:enhance
				class="border-surface-border space-y-3 border-t pt-4"
			>
				<p class="text-text-tertiary text-xs font-medium">Add recipient</p>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<input
						type="text"
						name="name"
						required
						placeholder="Name (required)"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					/>
					<input
						type="email"
						name="email"
						required
						placeholder="Email (required)"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					/>
					<input
						type="text"
						name="title"
						placeholder="Title (optional)"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					/>
					<input
						type="text"
						name="district"
						placeholder="District (optional)"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					/>
				</div>
				<button
					type="submit"
					class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500"
				>
					Add recipient
				</button>
			</form>
		{/if}
	</div>

	<!-- Embed widget -->
	{#if data.campaign.status === 'ACTIVE' || data.campaign.status === 'PAUSED'}
		<div
			id="reader-action-embed"
			class="border-surface-border bg-surface-base scroll-mt-24 rounded-md border"
		>
			<button
				type="button"
				onclick={() => {
					embedOpen = !embedOpen;
				}}
				class="flex w-full items-center justify-between px-6 py-4 text-left"
			>
				<div class="flex items-center gap-3">
					<svg
						class="text-text-tertiary h-4 w-4"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
						/>
					</svg>
					<span class="text-text-secondary text-sm font-medium">Reader action embed</span>
				</div>
				<svg
					class="text-text-tertiary h-4 w-4 transition-transform {embedOpen ? 'rotate-180' : ''}"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
				</svg>
			</button>

			{#if embedOpen}
				<div class="border-surface-border space-y-3 border-t px-6 py-4">
					<p class="text-text-tertiary text-xs">
						Each person who takes action through this embed strengthens your proof packet.
						{#if packet && packet.verified > 0}
							<span class="font-mono text-teal-400 tabular-nums">{packet.verified}</span> verified and
							counting.
						{/if}
					</p>
					<div class="relative">
						<pre
							class="border-surface-border-strong bg-surface-raised text-text-secondary overflow-x-auto rounded-lg border px-4 py-3 font-mono text-xs leading-relaxed">{embedCode}</pre>
						<button
							type="button"
							onclick={copyEmbed}
							class="border-surface-border-strong bg-surface-overlay text-text-secondary hover:bg-surface-raised absolute top-2 right-2 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
						>
							{embedCopied ? 'Copied!' : 'Copy'}
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Action settings -->
	<details id="action-settings" class="scroll-mt-24" open={data.campaign.status === 'DRAFT'}>
		<summary
			class="border-surface-border bg-surface-base text-text-secondary hover:text-text-primary cursor-pointer rounded-md border px-6 py-4 text-sm font-medium"
		>
			Action settings
		</summary>
		<div class="mt-2">
			<form method="POST" action="?/update" use:enhance class="space-y-6">
				<div class="border-surface-border bg-surface-base space-y-5 rounded-md border p-6">
					<!-- Title -->
					<div>
						<label for="title" class="text-text-secondary mb-1.5 block text-sm font-medium"
							>Title</label
						>
						<input
							type="text"
							id="title"
							name="title"
							required
							disabled={!canEdit || !isEditable}
							value={data.campaign.title}
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
						/>
					</div>

					<!-- Type -->
					<div>
						<label for="type" class="text-text-secondary mb-1.5 block text-sm font-medium"
							>Type</label
						>
						<select
							id="type"
							name="type"
							required
							disabled={!canEdit || !isEditable}
							class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
						>
							<option value="LETTER" selected={data.campaign.type === 'LETTER'}>Letter</option>
							<option value="EVENT" selected={data.campaign.type === 'EVENT'}>Event</option>
							<option value="FORM" selected={data.campaign.type === 'FORM'}>Form</option>
						</select>
					</div>

					<!-- Body -->
					<div>
						<label for="body" class="text-text-secondary mb-1.5 block text-sm font-medium">
							Description
							<span class="text-text-quaternary font-normal">(optional)</span>
						</label>
						<textarea
							id="body"
							name="body"
							rows="4"
							disabled={!canEdit || !isEditable}
							placeholder="Describe this action's purpose and goals..."
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full resize-y rounded-lg border px-3 py-2 text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
							>{data.campaign.body ?? ''}</textarea
						>
					</div>

					<!-- Template -->
					<div>
						<label for="templateId" class="text-text-secondary mb-1.5 block text-sm font-medium">
							Template
							<span class="text-text-quaternary font-normal">(optional)</span>
						</label>
						<select
							id="templateId"
							name="templateId"
							disabled={!canEdit || !isEditable}
							class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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
					<div class="border-surface-border bg-surface-raised space-y-4 rounded-lg border p-4">
						<div>
							<p class="text-text-secondary text-sm font-medium">Geographic Targeting</p>
							<p class="text-text-tertiary mt-0.5 text-xs">
								Country and jurisdiction for this action
							</p>
						</div>

						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div>
								<label
									for="targetCountry"
									class="text-text-secondary mb-1.5 block text-sm font-medium">Country</label
								>
								<input type="hidden" name="targetCountry" value={targetCountry} />
								{#if canEdit && isEditable}
									<CountrySelector
										value={targetCountry}
										onchange={(c) => {
											targetCountryOverride = c;
											targetJurisdictionOverride = '';
										}}
									/>
								{:else}
									<p class="text-text-tertiary py-2 text-sm">{targetCountry}</p>
								{/if}
							</div>
							<div>
								<label
									for="targetJurisdiction"
									class="text-text-secondary mb-1.5 block text-sm font-medium">Jurisdiction</label
								>
								<input type="hidden" name="targetJurisdiction" value={targetJurisdiction} />
								{#if canEdit && isEditable}
									<JurisdictionPicker
										value={targetJurisdiction || null}
										country={targetCountry}
										onchange={(j) => {
											targetJurisdictionOverride = j;
										}}
									/>
								{:else}
									<p class="text-text-tertiary py-2 text-sm">{targetJurisdiction || 'Not set'}</p>
								{/if}
							</div>
						</div>

						{#if targetJurisdiction}
							<p class="text-text-tertiary text-xs">
								Targeting <span class="text-text-secondary font-medium">{targetJurisdiction}</span>
								in <span class="text-text-secondary font-medium">{targetCountry}</span>
							</p>
						{/if}
					</div>

					<!-- Debate settings -->
					<div class="border-surface-border bg-surface-raised space-y-4 rounded-lg border p-4">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-text-secondary text-sm font-medium">Debate Market</p>
								<p class="text-text-tertiary mt-0.5 text-xs">
									When enough verified participants act, an adversarial debate strengthens your
									proof
								</p>
							</div>
							<label class="relative inline-flex cursor-pointer items-center">
								<input
									type="checkbox"
									name="debateEnabled"
									class="peer sr-only"
									disabled={!canEdit || !isEditable}
									checked={debateEnabled}
									onchange={(e) => {
										debateEnabledOverride = (e.currentTarget as HTMLInputElement).checked;
									}}
								/>
								<div
									class="bg-surface-border-strong peer after:bg-text-tertiary h-5 w-9 rounded-full peer-checked:bg-teal-600 peer-focus:ring-2 peer-focus:ring-teal-500/40 after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white peer-checked:after:bg-white disabled:opacity-50"
								></div>
							</label>
						</div>

						{#if debateEnabled}
							<p class="text-text-tertiary mt-2 text-xs">
								When {data.campaign.debateThreshold ?? 10} verified participants take action, an adversarial
								debate spawns. The strongest arguments surface and attach to your proof packet.
							</p>
							<div>
								<label
									for="debateThreshold"
									class="text-text-secondary mb-1.5 block text-sm font-medium"
								>
									Threshold
									<span class="text-text-quaternary font-normal"
										>(minimum verified participants)</span
									>
								</label>
								<input
									type="number"
									id="debateThreshold"
									name="debateThreshold"
									min="1"
									disabled={!canEdit || !isEditable}
									value={data.campaign.debateThreshold}
									class="border-surface-border-strong bg-surface-raised text-text-primary w-32 rounded-lg border px-3 py-2 font-mono text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
								/>
							</div>
						{/if}
					</div>

					<!-- Save button -->
					{#if canEdit && isEditable}
						<div class="pt-2">
							<button
								type="submit"
								class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
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
			<summary
				class="border-surface-border bg-surface-base text-text-secondary hover:text-text-primary cursor-pointer rounded-md border px-6 py-4 text-sm font-medium"
			>
				Analytics detail
			</summary>
			<div class="mt-2 space-y-6">
				<!-- Email Delivery Metrics -->
				{#if FEATURES.ENGAGEMENT_METRICS}
					<DeliveryMetrics metrics={data.analytics.delivery} />
				{/if}

				<!-- Verification Timeline -->
				<VerificationTimeline timeline={data.analytics.timeline} />

				<!-- Geographic Spread -->
				<GeographicSpread
					topDistricts={data.analytics.topDistricts}
					districtCount={packet?.districtCount ?? 0}
				/>
			</div>
		</details>
	{/if}

	<!-- Metadata footer -->
	<div
		class="text-text-quaternary border-surface-border flex items-center gap-6 border-t pt-4 text-xs"
	>
		<span>ID: <code class="text-text-tertiary font-mono">{data.campaign.id}</code></span>
		<span
			>Created: <span class="text-text-tertiary font-mono"
				>{formatDate(data.campaign.createdAt)}</span
			></span
		>
	</div>
</div>
