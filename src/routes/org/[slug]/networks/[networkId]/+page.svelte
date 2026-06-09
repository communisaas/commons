<script lang="ts">
	import CoalitionReport from '$lib/components/networks/CoalitionReport.svelte';
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import { FEATURES } from '$lib/config/features';
	import {
		buildCoalitionReadiness,
		formatGateEvidence,
		getGateEvidence,
		type CoalitionReadinessRow
	} from '$lib/data/capability-hypergraph';
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
	type CapabilityState = 'live' | 'partial' | 'draft-only' | 'gated';
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
	const proofPressureState = $derived<CapabilityState>(
		data.proofPressure.length > 0 ? 'partial' : 'draft-only'
	);
	const crossBorderCoalitionGate = getGateEvidence(
		'CP-cross-border-coalition',
		['T7-4', 'T7-6', 'T6-2'],
		{
			name: 'Cross-border coalition routing',
			downstream: 3,
			dependency: 'International Phase 2 + mainnet settlement'
		}
	);
	const coalitionStatsGate = getGateEvidence('CP-coalition-aggregate-stats', ['T7-1'], {
		name: 'Coalition aggregate stats',
		downstream: 1,
		dependency: 'Network member aggregate query'
	});
	const proofPressureGate = getGateEvidence(
		'CP-coalition-proof-pressure',
		['T8-1b', 'T8-8', 'T6-9'],
		{
			name: 'Coalition proof pressure',
			downstream: 3,
			dependency: 'Reader-office response terrain + receipt response history'
		}
	);
	const proofPressureGateSummary = $derived(
		formatGateEvidence(proofPressureGate, {
			prefix:
				data.proofPressure.length > 0
					? 'Receipt-backed decision-maker pressure rows are visible; reader-office workflow and response notification claims remain bounded.'
					: 'No receipt-backed decision-maker pressure rows are loaded for this network; coalition totals are not converted into accountability-pressure claims.',
			density: 'operator'
		})
	);
	const coalitionArtifactGate = getGateEvidence('CP-coalition-artifact', ['T6-1', 'T6-2', 'T7-6'], {
		name: 'Durable coalition artifact',
		downstream: 4,
		dependency: 'Receipt anchoring + cross-border delivery path'
	});
	const coalitionReadiness = $derived(
		buildCoalitionReadiness({
			base: `/org/${data.org.slug}`,
			coalition: {
				enabled: FEATURES.NETWORKS,
				loaded: true,
				activeNetworkCount: 1,
				pendingInviteCount: pendingMembers.length,
				activeMemberRows: activeMembers.length,
				topActiveNetworkId: data.network.id
			},
			gates: {
				coalitionStatsGate,
				crossBorderCoalitionGate,
				coalitionArtifactGate
			}
		})
	);
	const coalitionRows = $derived<CoalitionReadinessRow[]>(
		coalitionReadiness.rows.map((row) => ({
			...row,
			href:
				row.id === 'network-memberships' || row.id === 'member-roster-aggregate'
					? '#network-members'
					: row.id === 'invite-response-queue'
						? '#network-members'
						: row.id === 'aggregate-proof-detail'
							? '#coalition-proof-posture'
							: row.id === 'cross-border-routing'
								? '#coalition-routing-boundary'
								: row.id === 'durable-coalition-artifact'
									? '#coalition-artifact-boundary'
									: row.href
		}))
	);
	const proofPressureCapabilityItem = $derived<CapabilityItem>({
		label: 'Proof-pressure terrain',
		state: proofPressureState,
		phase: 'RESOLVE / AGGREGATE',
		cluster: 'C-reader-side-ux / C-accountability',
		action: data.proofPressure.length > 0 ? 'read pressure' : 'read proof-pressure boundary',
		detail:
			data.proofPressure.length > 0
				? "Receipt-backed pressure rows group active-member evidence by decision-maker; weights use each org's strongest receipt so one org cannot inflate pressure by splitting deliveries."
				: 'No receipt-backed decision-maker pressure row is loaded; coalition totals remain aggregate posture, not pressure evidence.',
		unlock: proofPressureGateSummary,
		href: '#proof-pressure-boundary',
		metric: {
			value: data.proofPressure.length,
			label: 'pressure rows',
			cite: 'networks.getProofPressure'
		}
	});
	const capabilityItems = $derived<CapabilityItem[]>(
		coalitionRows.flatMap((row) => {
			const item = {
				label: row.label,
				state: row.state,
				phase: row.phase,
				cluster: row.clusters,
				action: row.action,
				detail: row.ground,
				unlock: row.boundary,
				href: row.href,
				metric: row.metric
			};
			return row.id === 'aggregate-proof-detail' ? [item, proofPressureCapabilityItem] : [item];
		})
	);

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
			&larr; Coalition layer
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

		<WorkspaceCapabilityStrip label="Coalition proof capability" items={capabilityItems} />

		<!-- Coalition proof posture -->
		<div
			id="coalition-proof-posture"
			class="bg-surface-base border-surface-border space-y-4 rounded-md border p-6"
		>
			<p class="text-text-quaternary font-mono text-[10px] tracking-wider uppercase">
				Coalition proof posture
			</p>

			<div class="flex items-baseline gap-3">
				<p class="font-mono text-4xl font-bold text-emerald-400 tabular-nums">
					<Datum
						value={data.stats.verifiedSupporters}
						cite="networks.getStats verifiedSupporters"
					/>
				</p>
				<p class="text-text-secondary text-lg">verified people in active-member ledgers</p>
			</div>

			<div class="text-text-tertiary flex flex-wrap gap-6 text-sm">
				<span>
					<span class="text-text-secondary font-mono tabular-nums">
						<Datum value={data.stats.memberCount} cite="networks.getStats memberCount" />
					</span> organizations
				</span>
				<span>
					<span class="font-mono text-teal-400 tabular-nums">
						<Datum value={data.stats.uniqueSupporters} cite="networks.getStats uniqueSupporters" />
					</span> unique people
				</span>
				<span>
					<span class="font-mono tabular-nums">
						<Datum value={data.stats.totalSupporters} cite="networks.getStats totalSupporters" />
					</span> people rows across orgs
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
								cite="networks.getStats verifiedCampaignActions"
							/>
						</span> verified actions
					</span>
					<span>
						proof covers <span class="font-mono text-teal-400 tabular-nums">
							<Datum value={reportStats.districtCount} cite="networks.getStats districtCount" />
						</span> districts
					</span>
				</div>
			{/if}
			<p class="text-text-quaternary text-[10px]">
				Descriptive aggregate stats are live through <code>networks.getStats</code>. Durable
				coalition artifacts, cross-border delivery, and reader-office notification loops remain
				gated below.
			</p>
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
										><Datum value={dm.orgCount} cite="networks.getProofPressure orgCount" /> org{dm.orgCount !==
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
													cite="networks.getProofPressure proofWeight"
												/></span
											>
										</div>
									</td>
									<td class="text-text-secondary px-4 py-3 font-mono text-xs tabular-nums">
										<Datum
											value={dm.verifiedActionEvidence}
											cite="networks.getProofPressure verifiedActionEvidence"
										/>
										<span class="text-text-quaternary"
											>across <Datum
												value={dm.districtSignalCount}
												cite="networks.getProofPressure districtSignalCount"
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
						cite="networks.getProofPressure receiptCount"
					/> receipt rows across <Datum
						value={data.proofPressure.length}
						cite="networks.getProofPressure rowCount"
					/> decision-makers.
				</p>
			</div>
		{:else}
			<div
				id="proof-pressure-boundary"
				class="rounded-md border border-amber-500/30 bg-amber-500/10 p-4"
			>
				<p class="text-sm font-medium text-amber-300">Proof-pressure boundary</p>
				<p class="text-text-tertiary mt-1 text-sm">
					{proofPressureGateSummary}
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

		<div
			id="coalition-routing-boundary"
			class="rounded-md border border-amber-500/30 bg-amber-500/10 p-4"
		>
			<p class="text-sm font-medium text-amber-300">Cross-border routing boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				This detail route can read active-member stats and receipt-backed pressure rows. It does not
				claim international delivery, settlement, or multi-country routing.
			</p>
		</div>

		<div
			id="coalition-artifact-boundary"
			class="rounded-md border border-amber-500/30 bg-amber-500/10 p-4"
		>
			<p class="text-sm font-medium text-amber-300">Coalition artifact boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				The report can describe active-member aggregate posture. Archive-grade coalition packets,
				cross-border delivery, and mainnet receipt anchoring remain dependency-first.
			</p>
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
