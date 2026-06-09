<script lang="ts">
	type NetworkStats = {
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

	let { stats, loading, brandingAccent = null }: {
		stats: NetworkStats | null;
		loading: boolean;
		// NEW-E-4: hex like '#0d9488'. Only set on Coalition-tier orgs. When
		// present, overrides the default teal accent on stat highlights.
		// Validated upstream by organizations.update mutation.
		brandingAccent?: string | null;
	} = $props();

	// CSS custom property scoping — if brandingAccent is set, apply it inline
	// on the component root so child --coalition-accent vars cascade. Falls
	// back to the default brand teal via CSS.
	const accentStyle = $derived(
		brandingAccent ? `--coalition-accent: ${brandingAccent};` : ''
	);

	const countryDistribution = $derived(
		Object.entries(stats?.stateDistribution ?? {})
			.map(([country, count]) => ({ country, count }))
			.sort((a, b) => b.count - a.count || a.country.localeCompare(b.country))
	);

	function formatScalar(value: number | null): string {
		return value === null ? 'unavailable' : value.toFixed(2);
	}
</script>

{#if loading}
	<!-- Loading skeleton -->
	<div class="animate-pulse">
		<!-- Stats grid: matches rounded-lg bg-zinc-900/50 p-3, label + value -->
		<div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
			{#each Array(4) as _}
				<div class="rounded-lg bg-zinc-900/50 p-3">
					<div class="h-3 w-20 rounded bg-zinc-700/50"></div>
					<div class="mt-1 h-6 w-10 rounded bg-zinc-700/50"></div>
				</div>
			{/each}
		</div>

		<!-- Packet scalar rows -->
		<div class="mb-4">
			<div class="mb-2 h-3 w-24 rounded bg-zinc-700/50"></div>
			<div class="space-y-1.5">
				{#each Array(4) as _, i}
					<div class="flex items-center gap-2">
						<div class="h-3 w-28 shrink-0 rounded bg-zinc-700/50"></div>
						<div class="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
							<div class="h-full rounded-full bg-zinc-700/50" style="width: {80 - i * 15}%"></div>
						</div>
						<div class="h-3 w-10 shrink-0 rounded bg-zinc-700/50"></div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Country distribution skeleton -->
		<div>
			<div class="mb-2 h-3 w-28 rounded bg-zinc-700/50"></div>
			<div class="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
				{#each Array(6) as _}
					<div class="flex items-center justify-between">
						<div class="h-3 w-6 rounded bg-zinc-700/50"></div>
						<div class="h-3 w-8 rounded bg-zinc-700/50"></div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{:else if stats}
<div style={accentStyle}>
	<!-- Stats grid -->
	<div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
		<div class="rounded-lg bg-zinc-900/50 p-3">
			<p class="text-xs font-medium text-zinc-500">Member Orgs</p>
			<p class="mt-1 text-xl font-bold text-zinc-100">{stats.memberCount}</p>
		</div>
		<div class="rounded-lg bg-zinc-900/50 p-3">
			<p class="text-xs font-medium text-zinc-500">Verified Actions</p>
			<p class="mt-1 text-xl font-bold text-zinc-100">{stats.verifiedCampaignActions.toLocaleString()}</p>
		</div>
		<div class="rounded-lg bg-zinc-900/50 p-3">
			<p class="text-xs font-medium text-zinc-500">Unique Districts</p>
			<p class="mt-1 text-xl font-bold" style="color: var(--coalition-accent, #2dd4bf);">{stats.districtCount.toLocaleString()}</p>
		</div>
		<div class="rounded-lg bg-zinc-900/50 p-3">
			<p class="text-xs font-medium text-zinc-500">Verified Supporters</p>
			<p class="mt-1 text-xl font-bold text-green-400">{stats.verifiedSupporters.toLocaleString()}</p>
		</div>
	</div>

	<!-- Packet scalar parity with single-org verification reports. -->
	{#if stats.gds !== null || stats.ald !== null || stats.temporalEntropy !== null || stats.cai !== null}
		<div class="mb-4">
			<h4 class="mb-2 text-xs font-medium text-zinc-500">Coordination Scalars</h4>
			<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
				<div class="rounded-lg bg-zinc-900/50 p-3">
					<p class="text-xs font-medium text-zinc-500">GDS</p>
					<p class="mt-1 font-mono text-sm text-zinc-100">{formatScalar(stats.gds)}</p>
				</div>
				<div class="rounded-lg bg-zinc-900/50 p-3">
					<p class="text-xs font-medium text-zinc-500">ALD</p>
					<p class="mt-1 font-mono text-sm text-zinc-100">{formatScalar(stats.ald)}</p>
				</div>
				<div class="rounded-lg bg-zinc-900/50 p-3">
					<p class="text-xs font-medium text-zinc-500">Entropy</p>
					<p class="mt-1 font-mono text-sm text-zinc-100">{formatScalar(stats.temporalEntropy)}</p>
				</div>
				<div class="rounded-lg bg-zinc-900/50 p-3">
					<p class="text-xs font-medium text-zinc-500">CAI</p>
					<p class="mt-1 font-mono text-sm text-zinc-100">{formatScalar(stats.cai)}</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Country distribution -->
	{#if countryDistribution.length > 0}
		<div>
			<h4 class="mb-2 text-xs font-medium text-zinc-500">Country Distribution</h4>
			<div class="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
				{#each countryDistribution as item (item.country)}
					<div class="flex items-center justify-between text-xs">
						<span class="text-zinc-400">{item.country}</span>
						<span class="text-zinc-500">{item.count.toLocaleString()}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
{:else}
	<p class="py-4 text-center text-sm text-zinc-500">
		Generate a coalition report to see aggregated verification data.
	</p>
{/if}
