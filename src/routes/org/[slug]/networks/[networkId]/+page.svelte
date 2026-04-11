<script lang="ts">
	import CoalitionReport from '$lib/components/networks/CoalitionReport.svelte';
	import { FEATURES } from '$lib/config/features';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let inviteSlug = $state('');
	let inviting = $state(false);
	let removing = $state<string | null>(null);
	let errorMsg = $state('');

	let reportStats = $state<{
		orgCount: number;
		totalVerifiedActions: number;
		uniqueDistricts: number;
		verifiedSupporters: number;
		tierDistribution: { tier: number; count: number }[];
		stateDistribution: { state: string; count: number }[];
	} | null>(null);
	let reportLoading = $state(false);

	const statusColors: Record<string, string> = {
		active: 'bg-emerald-900/50 text-emerald-400',
		suspended: 'bg-red-900/50 text-red-400'
	};

	const roleColors: Record<string, string> = {
		admin: 'bg-teal-900/50 text-teal-400',
		member: 'bg-surface-border-strong text-text-secondary'
	};

	const activeMembers = $derived(data.members.filter((m) => m.status === 'active'));
	const pendingMembers = $derived(data.members.filter((m) => m.status === 'pending'));

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(iso));
	}

	async function inviteOrg() {
		const trimmed = inviteSlug.trim();
		if (!trimmed) return;

		inviting = true;
		errorMsg = '';

		try {
			const res = await fetch(`/api/org/${data.org.slug}/networks/${data.network.id}/invite`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ orgSlug: trimmed })
			});

			if (res.ok) {
				inviteSlug = '';
				window.location.reload();
			} else {
				const body = await res.json().catch(() => null);
				errorMsg = body?.error ?? `Failed to invite (${res.status})`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			inviting = false;
		}
	}

	async function removeMember(memberId: string) {
		removing = memberId;
		errorMsg = '';

		try {
			const res = await fetch(`/api/org/${data.org.slug}/networks/${data.network.id}/members/${memberId}`, {
				method: 'DELETE'
			});

			if (res.ok) {
				window.location.reload();
			} else {
				const body = await res.json().catch(() => null);
				errorMsg = body?.error ?? `Failed to remove (${res.status})`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			removing = null;
		}
	}

	async function generateReport() {
		reportLoading = true;
		errorMsg = '';

		try {
			const res = await fetch(`/api/org/${data.org.slug}/networks/${data.network.id}/report`);

			if (res.ok) {
				reportStats = await res.json();
			} else {
				const body = await res.json().catch(() => null);
				errorMsg = body?.error ?? `Failed to generate report (${res.status})`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			reportLoading = false;
		}
	}
</script>

<svelte:head>
	<title>{data.network.name} | {data.org.name}</title>
</svelte:head>

<div class="min-h-screen bg-surface-raised text-text-primary">
	<div class="mx-auto max-w-4xl px-4 py-8 space-y-6">
		<!-- Back link -->
		<a href="/org/{data.org.slug}/networks" class="inline-block text-sm text-text-tertiary hover:text-text-primary">
			&larr; All Networks
		</a>

		<!-- Header -->
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<div class="mb-1 flex items-center gap-3">
					<h1 class="text-2xl font-bold text-text-primary">{data.network.name}</h1>
					<span class="rounded-full px-2.5 py-0.5 text-xs font-medium {statusColors[data.network.status] ?? 'bg-surface-border-strong text-text-secondary'}">
						{data.network.status}
					</span>
				</div>
				{#if data.network.description}
					<p class="text-sm text-text-tertiary">{data.network.description}</p>
				{/if}
				<p class="mt-1 text-xs text-text-tertiary">
					Owned by {data.network.ownerOrg.name}
				</p>
			</div>
		</div>

		<!-- Error -->
		{#if errorMsg}
			<div class="rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
				{errorMsg}
			</div>
		{/if}

		<!-- Coalition Proof Power (HERO) -->
		<div class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-6 space-y-4">
			<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary">Coalition Proof Power</p>

			<div class="flex items-baseline gap-3">
				<p class="font-mono tabular-nums text-4xl font-bold text-emerald-400">
					{data.stats.verifiedSupporters.toLocaleString('en-US')}
				</p>
				<p class="text-lg text-text-secondary">verified supporters combined</p>
			</div>

			<div class="flex flex-wrap gap-6 text-sm text-text-tertiary">
				<span>
					<span class="font-mono tabular-nums text-text-secondary">{data.stats.memberCount}</span> organizations
				</span>
				<span>
					<span class="font-mono tabular-nums text-teal-400">{data.stats.uniqueSupporters.toLocaleString('en-US')}</span> unique supporters
				</span>
				<span>
					<span class="font-mono tabular-nums">{data.stats.totalSupporters.toLocaleString('en-US')}</span> total across all orgs
				</span>
			</div>

			{#if FEATURES.ENGAGEMENT_METRICS && reportStats}
				<div class="flex flex-wrap gap-6 text-sm text-text-tertiary pt-2 border-t border-surface-border">
					<span>
						<span class="font-mono tabular-nums text-emerald-400">{reportStats.totalVerifiedActions.toLocaleString('en-US')}</span> verified actions
					</span>
					<span>
						proof covers <span class="font-mono tabular-nums text-teal-400">{reportStats.uniqueDistricts}</span> districts
					</span>
				</div>
			{/if}
		</div>

		<!-- Proof Pressure -->
		{#if data.proofPressure.length > 0}
			<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
				<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary">Cross-Org Proof Pressure</p>

				<div class="overflow-x-auto rounded-lg border border-surface-border">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-surface-border text-xs text-text-tertiary">
								<th class="px-4 py-3 font-medium">Decision-Maker</th>
								<th class="px-4 py-3 font-medium">Orgs</th>
								<th class="px-4 py-3 font-medium">Proof Weight</th>
								<th class="px-4 py-3 font-medium">Verified</th>
								<th class="px-4 py-3 font-medium">Bills</th>
							</tr>
						</thead>
						<tbody>
							{#each data.proofPressure as dm (dm.decisionMakerId)}
								{@const maxWeight = data.proofPressure[0]?.combinedProofWeight ?? 1}
								{@const barWidth = Math.max(4, (dm.combinedProofWeight / maxWeight) * 100)}
								<tr class="border-b border-surface-border last:border-0">
									<td class="px-4 py-3">
										<a href="/accountability/{dm.decisionMakerId}" class="text-text-primary hover:text-teal-400 transition-colors font-medium">
											{dm.dmName}
										</a>
										<span class="block text-xs text-text-quaternary font-mono">{dm.decisionMakerId}</span>
									</td>
									<td class="px-4 py-3 text-text-secondary">{dm.orgCount} org{dm.orgCount !== 1 ? 's' : ''}</td>
									<td class="px-4 py-3 min-w-[140px]">
										<div class="flex items-center gap-2">
											<div class="h-2 rounded-full bg-emerald-500/20 flex-1 max-w-[100px]">
												<div class="h-full rounded-full bg-emerald-500" style="width: {barWidth}%"></div>
											</div>
											<span class="font-mono tabular-nums text-xs text-text-secondary">{dm.combinedProofWeight.toFixed(2)}</span>
										</div>
									</td>
									<td class="px-4 py-3 font-mono tabular-nums text-text-secondary text-xs">
										{dm.totalVerifiedConstituents.toLocaleString('en-US')}
										<span class="text-text-quaternary">across {dm.totalDistricts} district{dm.totalDistricts !== 1 ? 's' : ''}</span>
									</td>
									<td class="px-4 py-3">
										<div class="flex flex-wrap gap-1">
											{#each dm.bills as bill (bill.billId)}
												{@const alignColor = bill.alignment > 0 ? 'text-emerald-400' : bill.alignment < 0 ? 'text-red-400' : 'text-text-quaternary'}
												<span class="inline-flex items-center gap-1 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-mono">
													<span class={alignColor}>{bill.alignment > 0 ? '+' : ''}{bill.alignment.toFixed(1)}</span>
													<span class="text-text-tertiary truncate max-w-[120px]" title={bill.billTitle}>{bill.billTitle}</span>
													{#if bill.dmAction}
														<span class="text-teal-400">{bill.dmAction}</span>
													{/if}
												</span>
											{/each}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<p class="text-[10px] text-text-quaternary">
					Proof weight uses MAX across orgs to prevent inflation from sub-org splitting. {data.proofPressure.reduce((s, d) => s + d.receiptCount, 0)} total receipts across {data.proofPressure.length} decision-makers.
				</p>
			</div>
		{/if}

		<!-- Coalition Report CTA + Report -->
		<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
			<div class="flex items-center justify-between">
				<p class="text-sm font-medium text-text-secondary">Coalition Report</p>
				<button
					onclick={generateReport}
					disabled={reportLoading}
					class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50 transition-colors"
				>
					{reportLoading ? 'Generating...' : 'Generate Coalition Report'}
				</button>
			</div>
			<CoalitionReport stats={reportStats} loading={reportLoading} />
		</div>

		<!-- Membership Admin (collapsed) -->
		<details>
			<summary class="cursor-pointer rounded-md border border-surface-border bg-surface-base px-6 py-4 text-sm font-medium text-text-secondary hover:text-text-primary">
				Membership admin
				<span class="text-text-quaternary ml-1">&middot; {activeMembers.length} members</span>
			</summary>
			<div class="mt-2 space-y-6">
				<!-- Member Organizations Table -->
				<div>
					<h3 class="mb-3 text-sm font-medium text-text-tertiary">Member Organizations ({activeMembers.length})</h3>
					{#if activeMembers.length === 0}
						<p class="py-8 text-center text-sm text-text-tertiary">No active members</p>
					{:else}
						<div class="overflow-x-auto rounded-lg border border-surface-border">
							<table class="w-full text-left text-sm">
								<thead>
									<tr class="border-b border-surface-border text-xs text-text-tertiary">
										<th class="px-4 py-3 font-medium">Organization</th>
										<th class="px-4 py-3 font-medium">Role</th>
										<th class="px-4 py-3 font-medium">Supporters</th>
										<th class="px-4 py-3 font-medium">Joined</th>
										{#if data.isAdmin}
											<th class="px-4 py-3 font-medium"></th>
										{/if}
									</tr>
								</thead>
								<tbody>
									{#each activeMembers as member (member.id)}
										<tr class="border-b border-surface-border last:border-0">
											<td class="px-4 py-3 text-text-primary">{member.orgName}</td>
											<td class="px-4 py-3">
												<span class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {roleColors[member.role] ?? 'bg-surface-border-strong text-text-secondary'}">
													{member.role}
												</span>
											</td>
											<td class="px-4 py-3 text-text-secondary">{member.supporterCount.toLocaleString()}</td>
											<td class="px-4 py-3 text-text-tertiary">{formatDate(member.joinedAt)}</td>
											{#if data.isAdmin}
												<td class="px-4 py-3 text-right">
													{#if !member.isOwnerOrg}
														<button
															onclick={() => removeMember(member.id)}
															disabled={removing === member.id}
															class="text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
														>
															{removing === member.id ? 'Removing...' : 'Remove'}
														</button>
													{/if}
												</td>
											{/if}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>

				<!-- Pending Invitations (admin only) -->
				{#if data.isAdmin && pendingMembers.length > 0}
					<div>
						<h3 class="mb-3 text-sm font-medium text-text-tertiary">Pending Invitations ({pendingMembers.length})</h3>
						<div class="overflow-x-auto rounded-lg border border-surface-border">
							<table class="w-full text-left text-sm">
								<thead>
									<tr class="border-b border-surface-border text-xs text-text-tertiary">
										<th class="px-4 py-3 font-medium">Organization</th>
										<th class="px-4 py-3 font-medium">Status</th>
										<th class="px-4 py-3 font-medium">Invited</th>
									</tr>
								</thead>
								<tbody>
									{#each pendingMembers as member (member.id)}
										<tr class="border-b border-surface-border last:border-0">
											<td class="px-4 py-3 text-text-primary">{member.orgName}</td>
											<td class="px-4 py-3">
												<span class="inline-flex rounded-full bg-amber-900/50 px-2 py-0.5 text-xs font-medium text-amber-400">
													pending
												</span>
											</td>
											<td class="px-4 py-3 text-text-tertiary">{formatDate(member.joinedAt)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}

				<!-- Invite Organization (admin only) -->
				{#if data.isAdmin}
					<div class="rounded-lg border border-surface-border p-4">
						<h3 class="mb-3 text-sm font-medium text-text-tertiary">Invite Organization</h3>
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={inviteSlug}
								placeholder="Organization slug"
								class="flex-1 rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
							/>
							<button
								onclick={inviteOrg}
								disabled={inviting || !inviteSlug.trim()}
								class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
							>
								{inviting ? 'Inviting...' : 'Invite'}
							</button>
						</div>
					</div>
				{/if}
			</div>
		</details>
	</div>
</div>
