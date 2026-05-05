<script lang="ts">
	import NetworkCard from '$lib/components/networks/NetworkCard.svelte';
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

	let { data }: { data: PageData } = $props();
	const networks = $derived((data.networks ?? []) as NetworkView[]);

	let accepting = $state<string | null>(null);
	let declining = $state<string | null>(null);
	let errorMsg = $state('');

	const activeNetworks = $derived(networks.filter((n) => n.membershipStatus === 'active'));
	const pendingNetworks = $derived(networks.filter((n) => n.membershipStatus === 'pending'));

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
	<title>Networks | {data.org.name}</title>
</svelte:head>

<div class="min-h-screen bg-surface-raised text-text-primary">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<!-- Header -->
		<div class="mb-8 flex items-center justify-between">
			<h1 class="text-2xl font-bold text-text-primary">Networks</h1>
			{#if data.canCreate}
				<a
					href="/org/{data.org.slug}/networks/new"
					class="rounded-lg bg-surface-overlay px-4 py-2 text-sm font-semibold text-text-primary hover:bg-surface-raised"
				>
					Create Network
				</a>
			{/if}
		</div>

		<!-- Error -->
		{#if errorMsg}
			<div class="mb-6 rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
				{errorMsg}
			</div>
		{/if}

		<!-- Pending Invitations -->
		{#if pendingNetworks.length > 0}
			<div class="mb-8">
				<h2 class="mb-3 text-sm font-medium text-text-tertiary">Pending Invitations</h2>
				<div class="space-y-3">
					{#each pendingNetworks as network (network.id)}
						<div class="rounded-lg border border-amber-800/40 bg-amber-950/10 p-4">
							<div class="flex items-start justify-between gap-4">
								<div class="min-w-0 flex-1">
									<div class="mb-1 flex items-center gap-2">
										<h3 class="truncate text-base font-semibold text-text-primary">{network.name}</h3>
										<span class="shrink-0 rounded-full bg-amber-900/50 px-2 py-0.5 text-xs font-medium text-amber-400">
											Pending
										</span>
									</div>
									{#if network.description}
										<p class="text-sm text-text-tertiary">{network.description}</p>
									{/if}
									<p class="mt-1 text-xs text-text-tertiary">
										Invited by {network.ownerOrg.name} &middot; {network.memberCount} member{network.memberCount !== 1 ? 's' : ''}
									</p>
								</div>
								<div class="flex shrink-0 gap-2">
									<button
										onclick={() => respondToInvite(network.id, 'accept')}
										disabled={accepting === network.id}
										class="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
									>
										{accepting === network.id ? 'Accepting...' : 'Accept'}
									</button>
									<button
										onclick={() => respondToInvite(network.id, 'decline')}
										disabled={declining === network.id}
										class="rounded-lg border border-surface-border-strong px-3 py-1.5 text-sm text-text-secondary hover:border-text-tertiary hover:text-text-primary disabled:opacity-50"
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
			<div>
				<h2 class="mb-3 text-sm font-medium text-text-tertiary">Your Networks</h2>
				<div class="space-y-3">
					{#each activeNetworks as network (network.id)}
						<a href="/org/{data.org.slug}/networks/{network.id}" class="block">
							<NetworkCard {network} orgSlug={data.org.slug} />
						</a>
					{/each}
				</div>
			</div>
		{:else if pendingNetworks.length === 0}
			<div class="rounded-lg border border-surface-border py-16 text-center">
				<p class="text-lg text-text-tertiary">No networks yet.</p>
				<p class="mt-1 text-sm text-text-tertiary">
					Create a coalition network to coordinate with other organizations.
				</p>
				{#if data.canCreate}
					<a
						href="/org/{data.org.slug}/networks/new"
						class="mt-4 inline-block rounded-lg bg-surface-overlay px-4 py-2 text-sm font-semibold text-text-primary hover:bg-surface-raised"
					>
						Create Network
					</a>
				{/if}
			</div>
		{/if}
	</div>
</div>
