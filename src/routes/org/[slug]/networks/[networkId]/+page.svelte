<script lang="ts">
	import CoalitionReport from '$lib/components/networks/CoalitionReport.svelte';
	import { FEATURES } from '$lib/config/features';
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	type NetworkMember = {
		id: string;
		orgId?: string;
		orgName: string;
		orgSlug?: string;
		role: string;
		status: string;
		supporterCount: number;
		joinedAt: string;
		isOwnerOrg: boolean;
	};

	type ProofPressureBill = {
		billId: string;
		billTitle: string;
		alignment: number;
		dmAction?: string | null;
	};

	type ProofPressure = {
		decisionMakerId: string;
		canonicalSlug?: string | null;
		dmName: string;
		orgCount: number;
		combinedProofWeight: number;
		verifiedActionEvidence: number;
		districtSignalCount: number;
		receiptCount: number;
		latestReceiptAt: number;
		bills: ProofPressureBill[];
	};
	type CoalitionStats = {
		memberCount: number;
		totalSupporters: number;
		uniqueSupporters: number;
		verifiedSupporters: number;
		totalCampaignActions: number;
		verifiedCampaignActions: number;
		stateDistribution: Record<string, number>;
		gds: number | null;
		ald: number | null;
		temporalEntropy: number | null;
		cai: number | null;
		districtCount: number;
	};
	type ViewData = Omit<PageData, 'members' | 'proofPressure' | 'stats'> & {
		members: NetworkMember[];
		proofPressure: ProofPressure[];
		stats: CoalitionStats;
	};

	let { data }: { data: ViewData } = $props();

	let inviteSlug = $state('');
	let inviting = $state(false);
	let removing = $state<string | null>(null);
	let errorMsg = $state('');

	let reportStatsOverride = $state<CoalitionStats | null>(null);
	const reportStats = $derived(reportStatsOverride ?? data.stats);
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
			const res = await fetch(
				`/api/org/${data.org.slug}/networks/${data.network.id}/members/${memberId}`,
				{
					method: 'DELETE'
				}
			);

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
				const body = await res.json();
				reportStatsOverride = body.data;
			} else {
				const body = await res.json().catch(() => null);
				errorMsg = body?.error ?? `Failed to refresh report (${res.status})`;
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

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl space-y-6 px-4 py-8">
		<!-- Back link -->
		<a
			href="/org/{data.org.slug}/networks"
			class="text-text-tertiary hover:text-text-primary inline-block text-sm"
		>
			&larr; Networks
		</a>

		<!-- Header -->
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<div class="mb-1 flex items-center gap-3">
					<h1 class="text-text-primary text-2xl font-bold">{data.network.name}</h1>
					<span
						class="rounded-full px-2.5 py-0.5 text-xs font-medium {statusColors[
							data.network.status
						] ?? 'bg-surface-border-strong text-text-secondary'}"
					>
						{data.network.status}
					</span>
				</div>
				{#if data.network.description}
					<p class="text-text-tertiary text-sm">{data.network.description}</p>
				{/if}
				{#if data.network.ownerOrg}
					<p class="text-text-tertiary mt-1 text-xs">
						Owned by {data.network.ownerOrg.name}
					</p>
				{/if}
			</div>
		</div>

		<!-- Error -->
		{#if errorMsg}
			<div class="rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
				{errorMsg}
			</div>
		{/if}

		<!-- Coalition proof posture -->
		<div
			id="coalition-proof-posture"
			class="bg-surface-base border-surface-border space-y-4 rounded-md border p-6"
		>
			<p class="text-text-quaternary font-mono text-[10px] tracking-wider uppercase">
				Coalition reach
			</p>

			<div class="flex items-baseline gap-3">
				<p class="font-mono text-4xl font-bold text-emerald-400 tabular-nums">
					<Datum value={data.stats.verifiedSupporters} />
				</p>
				<p class="text-text-secondary text-lg">verified people across member organizations</p>
			</div>

			<div class="text-text-tertiary flex flex-wrap gap-6 text-sm">
				<span>
					<span class="text-text-secondary font-mono tabular-nums">
						<Datum value={data.stats.memberCount} />
					</span> organizations
				</span>
				<span>
					<span class="font-mono text-teal-400 tabular-nums">
						<Datum value={data.stats.uniqueSupporters} />
					</span> unique people
				</span>
				<span>
					<span class="font-mono tabular-nums">
						<Datum value={data.stats.totalSupporters} />
					</span> total people across orgs
				</span>
			</div>

			{#if FEATURES.ENGAGEMENT_METRICS && reportStats}
				<div
					class="text-text-tertiary border-surface-border flex flex-wrap gap-6 border-t pt-2 text-sm"
				>
					<span>
						<span class="font-mono text-emerald-400 tabular-nums">
							<Datum
								value={reportStats.verifiedCampaignActions}
							/>
						</span> verified actions
					</span>
					<span>
						proof covers <span class="font-mono text-teal-400 tabular-nums">
							<Datum value={reportStats.districtCount} />
						</span> districts
					</span>
				</div>
			{/if}
		</div>

		<!-- Proof Pressure -->
		{#if data.proofPressure.length > 0}
			<div
				id="proof-pressure-boundary"
				class="border-surface-border bg-surface-base space-y-4 rounded-md border p-6"
			>
				<p class="text-text-quaternary font-mono text-[10px] tracking-wider uppercase">
					Cross-Org Proof Pressure
				</p>

				<div class="border-surface-border overflow-x-auto rounded-lg border">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-surface-border text-text-tertiary border-b text-xs">
								<th class="px-4 py-3 font-medium">Decision-Maker</th>
								<th class="px-4 py-3 font-medium">Orgs</th>
								<th class="px-4 py-3 font-medium">Proof Weight</th>
								<th class="px-4 py-3 font-medium">Verified action evidence</th>
								<th class="px-4 py-3 font-medium">Bills</th>
							</tr>
						</thead>
						<tbody>
							{#each data.proofPressure as dm (dm.decisionMakerId)}
								{@const maxWeight = Math.max(data.proofPressure[0]?.combinedProofWeight ?? 0, 1)}
								{@const barWidth = Math.max(4, (dm.combinedProofWeight / maxWeight) * 100)}
								{@const slug = dm.canonicalSlug ?? dm.decisionMakerId}
								<tr class="border-surface-border border-b last:border-0">
									<td class="px-4 py-3">
										<a
											href="/accountability/{slug}"
											class="text-text-primary font-medium transition-colors hover:text-teal-400"
										>
											{dm.dmName}
										</a>
										<span class="text-text-quaternary block font-mono text-xs">{slug}</span>
									</td>
									<td class="text-text-secondary px-4 py-3"
										><Datum value={dm.orgCount} /> org{dm.orgCount !==
										1
											? 's'
											: ''}</td
									>
									<td class="min-w-[140px] px-4 py-3">
										<div class="flex items-center gap-2">
											<div class="h-2 max-w-[100px] flex-1 rounded-full bg-emerald-500/20">
												<div
													class="h-full rounded-full bg-emerald-500"
													style="width: {barWidth}%"
												></div>
											</div>
											<span class="text-text-secondary font-mono text-xs tabular-nums"
												><Datum
													value={Number(dm.combinedProofWeight.toFixed(2))}
												/></span
											>
										</div>
									</td>
									<td class="text-text-secondary px-4 py-3 font-mono text-xs tabular-nums">
										<Datum
											value={dm.verifiedActionEvidence}
										/>
										<span class="text-text-quaternary"
											>across <Datum
												value={dm.districtSignalCount}
											/> district signal{dm.districtSignalCount !== 1 ? 's' : ''}</span
										>
									</td>
									<td class="px-4 py-3">
										<div class="flex flex-wrap gap-1">
											{#each dm.bills as bill (bill.billId)}
												{@const alignColor =
													bill.alignment > 0
														? 'text-emerald-400'
														: bill.alignment < 0
															? 'text-red-400'
															: 'text-text-quaternary'}
												<span
													class="bg-surface-raised inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]"
												>
													<span class={alignColor}
														>{bill.alignment > 0 ? '+' : ''}{bill.alignment.toFixed(1)}</span
													>
													<span
														class="text-text-tertiary max-w-[120px] truncate"
														title={bill.billTitle}>{bill.billTitle}</span
													>
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

				<p class="text-text-quaternary text-[10px]">
					Proof weight sums each active org's strongest receipt for the decision-maker, preventing
					one org from inflating pressure by splitting deliveries. <Datum
						value={data.proofPressure.reduce((s, d) => s + d.receiptCount, 0)}
					/> receipt rows across <Datum
						value={data.proofPressure.length}
					/> decision-makers.
				</p>
			</div>
		{:else}
			<div
				id="proof-pressure-boundary"
				class="border-surface-border bg-surface-base rounded-md border p-4"
			>
				<p class="text-text-primary text-sm font-medium">Cross-org proof pressure</p>
				<p class="text-text-tertiary mt-1 text-sm">
					Nothing here yet. Pressure rows appear once member organizations deliver receipt-backed
					messages to shared decision-makers.
				</p>
			</div>
		{/if}

		<!-- Coalition Report CTA + Report -->
		<div class="border-surface-border bg-surface-base space-y-4 rounded-md border p-6">
			<div class="flex items-center justify-between">
				<p class="text-text-secondary text-sm font-medium">Coalition Report</p>
				<button
					onclick={generateReport}
					disabled={reportLoading}
					class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
				>
					{reportLoading ? 'Refreshing...' : 'Refresh coalition report'}
				</button>
			</div>
			<CoalitionReport
				stats={reportStats}
				loading={reportLoading}
				brandingAccent={data.org?.brandingAccent ?? null}
			/>
		</div>

		<!-- Membership Admin (collapsed) -->
		<details>
			<summary
				class="border-surface-border bg-surface-base text-text-secondary hover:text-text-primary cursor-pointer rounded-md border px-6 py-4 text-sm font-medium"
			>
				Network membership
				<span class="text-text-quaternary ml-1">&middot; {activeMembers.length} members</span>
			</summary>
			<div id="network-members" class="mt-2 space-y-6">
				<!-- Member Organizations Table -->
				<div>
					<h3 class="text-text-tertiary mb-3 text-sm font-medium">
						Member Organizations ({activeMembers.length})
					</h3>
					{#if activeMembers.length === 0}
						<p class="text-text-tertiary py-8 text-center text-sm">No active members</p>
					{:else}
						<div class="border-surface-border overflow-x-auto rounded-lg border">
							<table class="w-full text-left text-sm">
								<thead>
									<tr class="border-surface-border text-text-tertiary border-b text-xs">
										<th class="px-4 py-3 font-medium">Organization</th>
										<th class="px-4 py-3 font-medium">Role</th>
										<th class="px-4 py-3 font-medium">People rows</th>
										<th class="px-4 py-3 font-medium">Joined</th>
										{#if data.isAdmin}
											<th class="px-4 py-3 font-medium"></th>
										{/if}
									</tr>
								</thead>
								<tbody>
									{#each activeMembers as member (member.id)}
										<tr class="border-surface-border border-b last:border-0">
											<td class="text-text-primary px-4 py-3">{member.orgName}</td>
											<td class="px-4 py-3">
												<span
													class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {roleColors[
														member.role
													] ?? 'bg-surface-border-strong text-text-secondary'}"
												>
													{member.role}
												</span>
											</td>
											<td class="text-text-secondary px-4 py-3"
												>{member.supporterCount.toLocaleString()}</td
											>
											<td class="text-text-tertiary px-4 py-3">{formatDate(member.joinedAt)}</td>
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
						<h3 class="text-text-tertiary mb-3 text-sm font-medium">
							Pending Invitations ({pendingMembers.length})
						</h3>
						<div class="border-surface-border overflow-x-auto rounded-lg border">
							<table class="w-full text-left text-sm">
								<thead>
									<tr class="border-surface-border text-text-tertiary border-b text-xs">
										<th class="px-4 py-3 font-medium">Organization</th>
										<th class="px-4 py-3 font-medium">Status</th>
										<th class="px-4 py-3 font-medium">Invited</th>
									</tr>
								</thead>
								<tbody>
									{#each pendingMembers as member (member.id)}
										<tr class="border-surface-border border-b last:border-0">
											<td class="text-text-primary px-4 py-3">{member.orgName}</td>
											<td class="px-4 py-3">
												<span
													class="inline-flex rounded-full bg-amber-900/50 px-2 py-0.5 text-xs font-medium text-amber-400"
												>
													pending
												</span>
											</td>
											<td class="text-text-tertiary px-4 py-3">{formatDate(member.joinedAt)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}

				<!-- Invite Organization (admin only) -->
				{#if data.isAdmin}
					<div class="border-surface-border rounded-lg border p-4">
						<h3 class="text-text-tertiary mb-3 text-sm font-medium">Invite Organization</h3>
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={inviteSlug}
								placeholder="Organization slug"
								class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none"
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
