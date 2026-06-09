<script lang="ts">
	import NetworkCard from '$lib/components/networks/NetworkCard.svelte';
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import { FEATURES } from '$lib/config/features';
	import {
		buildCoalitionReadiness,
		formatGateEvidence,
		getGateEvidence,
		type CoalitionReadinessRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel
	} from '$lib/data/capability-state-labels';
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	type NetworkView = {
		id: string;
		name: string;
		slug: string;
		description: string | null;
		status: string;
		role: string;
		membershipStatus: 'active' | 'pending' | string;
		memberCount: number;
		ownerOrg: { id: string; name: string; slug: string };
		isOwner: boolean;
		joinedAt: string;
	};

	type RawNetworkView = Omit<
		NetworkView,
		'role' | 'membershipStatus' | 'memberCount' | 'ownerOrg'
	> & {
		role?: string | null;
		membershipStatus?: 'active' | 'pending' | string | null;
		memberCount?: number | null;
		ownerOrg?: Partial<NetworkView['ownerOrg']> | null;
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
	type CoalitionPressureReadout = {
		id: string;
		label: string;
		state: CapabilityState;
		title: string;
		action: string;
		detail: string;
		gate: string;
		href: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	let { data }: { data: PageData } = $props();
	const networks = $derived(
		((data.networks ?? []) as RawNetworkView[]).map((network) => ({
			...network,
			role: network.role ?? 'member',
			membershipStatus: network.membershipStatus ?? '',
			memberCount: network.memberCount ?? 0,
			ownerOrg: {
				id: network.ownerOrg?.id ?? '',
				name: network.ownerOrg?.name ?? 'network owner',
				slug: network.ownerOrg?.slug ?? ''
			}
		}))
	);

	let accepting = $state<string | null>(null);
	let declining = $state<string | null>(null);
	let errorMsg = $state('');

	const activeNetworks = $derived(networks.filter((n) => n.membershipStatus === 'active'));
	const pendingNetworks = $derived(networks.filter((n) => n.membershipStatus === 'pending'));
	const activeMemberRows = $derived(
		activeNetworks.reduce((sum, network) => sum + (network.memberCount ?? 0), 0)
	);
	const coalitionStatsGate = getGateEvidence('CP-coalition-aggregate-stats', ['T7-1'], {
		name: 'Coalition aggregate stats',
		downstream: 1,
		dependency: 'Network member aggregate query'
	});
	const crossBorderCoalitionGate = getGateEvidence(
		'CP-cross-border-coalition',
		['T7-4', 'T7-6', 'T6-2'],
		{
			name: 'Cross-border coalition routing',
			downstream: 3,
			dependency: 'International Phase 2 + mainnet settlement'
		}
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
				activeNetworkCount: activeNetworks.length,
				pendingInviteCount: pendingNetworks.length,
				activeMemberRows,
				topActiveNetworkId: activeNetworks[0]?.id ?? null
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
				row.id === 'network-memberships'
					? '#network-memberships'
					: row.id === 'invite-response-queue'
						? '#network-invites'
						: row.id === 'member-roster-aggregate'
							? '#network-memberships'
							: row.id === 'cross-border-routing'
								? '#coalition-routing-boundary'
								: row.id === 'durable-coalition-artifact'
									? '#coalition-artifact-boundary'
									: row.href
		}))
	);
	const capabilityItems = $derived<CapabilityItem[]>(
		coalitionRows.map((row) => ({
			label: row.label,
			state: row.state,
			phase: row.phase,
			cluster: row.clusters,
			action: row.action,
			detail: row.ground,
			unlock: row.boundary,
			href: row.href,
			metric: row.metric
		}))
	);
	const aggregateProofCoalitionRow = $derived(
		coalitionRows.find((row) => row.id === 'aggregate-proof-detail') ?? null
	);
	const heldCoalitionRows = $derived(
		coalitionRows.filter((row) => row.state === 'draft-only' || row.state === 'gated')
	);
	const firstHeldCoalitionRow = $derived(heldCoalitionRows[0] ?? null);
	const coalitionPressureReadouts = $derived<CoalitionPressureReadout[]>([
		{
			id: 'membership-ground',
			label: 'Membership ground',
			state: coalitionReadiness.state,
			title: coalitionReadiness.signal,
			action: coalitionReadiness.action,
			detail: coalitionReadiness.detail,
			gate: formatGateEvidence(coalitionReadiness.nextGate, {
				prefix: 'Coalition posture stays bounded by the next unresolved network lift.',
				complete: 'Coalition posture has no unresolved network lift.'
			}),
			href: coalitionReadiness.href,
			source: coalitionReadiness.nextGate.source,
			metric: coalitionReadiness.metric
		},
		{
			id: 'proof-handoff',
			label: 'Proof handoff',
			state: aggregateProofCoalitionRow?.state ?? coalitionReadiness.state,
			title: aggregateProofCoalitionRow?.label ?? 'Aggregate proof detail',
			action: aggregateProofCoalitionRow?.action ?? coalitionReadiness.action,
			detail:
				aggregateProofCoalitionRow?.ground ??
				'No active coalition network is loaded, so aggregate proof detail has no handoff target.',
			gate: aggregateProofCoalitionRow?.boundary ?? coalitionReadiness.gate,
			href: aggregateProofCoalitionRow?.href ?? coalitionReadiness.href,
			source: aggregateProofCoalitionRow?.gate.source ?? 'buildCoalitionReadiness',
			metric: {
				value: aggregateProofCoalitionRow?.metric.value ?? coalitionReadiness.metric.value,
				label: aggregateProofCoalitionRow?.metric.label ?? coalitionReadiness.metric.label,
				cite: aggregateProofCoalitionRow?.metric.cite ?? 'buildCoalitionReadiness'
			}
		},
		{
			id: 'next-coalition-lift',
			label: 'Next coalition lift',
			state: firstHeldCoalitionRow?.state ?? 'live',
			title: firstHeldCoalitionRow?.label ?? 'Coalition boundary clear',
			action: firstHeldCoalitionRow?.action ?? coalitionReadiness.action,
			detail:
				firstHeldCoalitionRow?.ground ??
				'No coalition contract is currently blocking network composition.',
			gate: firstHeldCoalitionRow?.boundary ?? coalitionReadiness.gate,
			href: firstHeldCoalitionRow?.href ?? coalitionReadiness.href,
			source: firstHeldCoalitionRow?.gate.source ?? coalitionReadiness.nextGate.source,
			metric: {
				value: firstHeldCoalitionRow?.metric.value ?? coalitionReadiness.boundaryCount,
				label: firstHeldCoalitionRow?.metric.label ?? 'coalition boundaries',
				cite: firstHeldCoalitionRow?.metric.cite ?? 'buildCoalitionReadiness'
			}
		}
	]);

	function memberLabel(count: number): string {
		return count === 1 ? 'member' : 'members';
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

	async function respondToInvite(networkId: string, action: 'accept' | 'decline') {
		if (action === 'accept') accepting = networkId;
		else declining = networkId;
		errorMsg = '';

		try {
			const res = await fetch(`/api/org/${data.org.slug}/networks/${networkId}/${action}`, {
				method: 'POST'
			});

			if (res.ok) {
				window.location.reload();
			} else {
				const body = await res.json().catch(() => null);
				errorMsg = body?.error ?? `Failed to ${action} (${res.status})`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			accepting = null;
			declining = null;
		}
	}
</script>

<svelte:head>
	<title>Coalition layer | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl space-y-6 px-4 py-8">
		<!-- Header -->
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<nav class="text-text-tertiary mb-3 flex items-center gap-2 text-sm">
					<a href="/org/{data.org.slug}/studio" class="hover:text-text-secondary transition-colors">
						Studio
					</a>
					<span aria-hidden="true">/</span>
					<span>Coalition layer</span>
				</nav>
				<h1 class="text-text-primary text-xl font-semibold">Coalition layer</h1>
				<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
					Read network memberships, invite state, and creation authority before entering a network's
					proof posture. Durable artifacts and cross-border routing stay bounded.
				</p>
			</div>
			{#if data.canCreate}
				<a
					href="/org/{data.org.slug}/networks/new"
					class="bg-surface-overlay text-text-primary hover:bg-surface-base rounded-md px-4 py-2 text-sm font-semibold transition-colors"
				>
					Create coalition network
				</a>
			{/if}
		</div>

		<!-- Error -->
		{#if errorMsg}
			<div class="rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
				{errorMsg}
			</div>
		{/if}

		<WorkspaceCapabilityStrip label="Coalition layer capability" items={capabilityItems} />

		<div class="grid gap-3 md:grid-cols-3" aria-label="Coalition composition pressure">
			{#each coalitionPressureReadouts as readout (readout.id)}
				<a
					href={readout.href}
					class={pressureCellClass(readout.state)}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					aria-label={`${readout.label}: ${operatorCapabilityStateLabel(readout.state)}; ${readout.detail}; ${readout.gate}`}
				>
					<span
						class="text-text-quaternary block font-mono text-[0.65rem] tracking-[0.18em] uppercase"
					>
						{readout.label}
					</span>
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
					<span class="text-text-quaternary mt-2 block font-mono text-[0.65rem] uppercase">
						{readout.source}
					</span>
				</a>
			{/each}
		</div>

		<div
			id="coalition-routing-boundary"
			class="border-surface-border bg-surface-base rounded-md border px-4 py-3"
		>
			<p class="text-text-primary text-sm font-medium">Routing boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				This route reads memberships and creation authority only. Network detail owns live aggregate
				stats after creation; cross-border delivery remains gate backed.
			</p>
		</div>

		<div
			id="coalition-artifact-boundary"
			class="border-surface-border bg-surface-base rounded-md border px-4 py-3"
		>
			<p class="text-text-primary text-sm font-medium">Artifact boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				Archive-grade coalition artifacts are not produced by the index. Durable proof belongs
				behind receipt anchoring, settlement, and cross-border packet gates.
			</p>
		</div>

		<div
			id="coalition-creation-boundary"
			class="border-surface-border bg-surface-base rounded-md border px-4 py-3"
		>
			<p class="text-text-primary text-sm font-medium">Creation authority</p>
			<p class="text-text-tertiary mt-1 text-sm">
				The creation route proves coalition subscription and owner-role gates before rendering.
				Other org contexts can still read active memberships and respond to pending invites.
			</p>
		</div>

		<!-- Pending Invitations -->
		{#if pendingNetworks.length > 0}
			<div id="network-invites">
				<h2 class="text-text-tertiary mb-3 text-sm font-medium">Invite response queue</h2>
				<div class="space-y-3">
					{#each pendingNetworks as network (network.id)}
						<div class="rounded-lg border border-amber-800/40 bg-amber-950/10 p-4">
							<div class="flex items-start justify-between gap-4">
								<div class="min-w-0 flex-1">
									<div class="mb-1 flex items-center gap-2">
										<h3 class="text-text-primary truncate text-base font-semibold">
											{network.name}
										</h3>
										<span
											class="shrink-0 rounded-full bg-amber-900/50 px-2 py-0.5 text-xs font-medium text-amber-400"
										>
											Pending
										</span>
									</div>
									{#if network.description}
										<p class="text-text-tertiary text-sm">{network.description}</p>
									{/if}
									<p class="text-text-tertiary mt-1 text-xs">
										Invited by {network.ownerOrg.name} &middot; {network.memberCount}
										{memberLabel(network.memberCount)}
									</p>
								</div>
								<div class="flex shrink-0 gap-2">
									<button
										onclick={() => respondToInvite(network.id, 'accept')}
										disabled={accepting === network.id}
										class="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
									>
										{accepting === network.id ? 'Accepting...' : 'Accept'}
									</button>
									<button
										onclick={() => respondToInvite(network.id, 'decline')}
										disabled={declining === network.id}
										class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
									>
										{declining === network.id ? 'Declining...' : 'Decline'}
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Active Networks -->
		{#if activeNetworks.length > 0}
			<div id="network-memberships">
				<h2 class="text-text-tertiary mb-3 text-sm font-medium">Active coalition memberships</h2>
				<div class="space-y-3">
					{#each activeNetworks as network (network.id)}
						<a href="/org/{data.org.slug}/networks/{network.id}" class="block">
							<NetworkCard {network} orgSlug={data.org.slug} />
						</a>
					{/each}
				</div>
			</div>
		{:else if pendingNetworks.length === 0}
			<div
				id="network-memberships"
				class="border-surface-border bg-surface-base rounded-md border py-14 text-center"
			>
				<p class="text-text-tertiary text-lg">No networks yet.</p>
				<p class="text-text-tertiary mt-1 text-sm">
					Create a coalition network to coordinate with other organizations.
				</p>
				{#if data.canCreate}
					<a
						href="/org/{data.org.slug}/networks/new"
						class="bg-surface-overlay text-text-primary hover:bg-surface-raised mt-4 inline-block rounded-md px-4 py-2 text-sm font-semibold"
					>
						Create coalition network
					</a>
				{/if}
			</div>
		{/if}
	</div>
</div>
