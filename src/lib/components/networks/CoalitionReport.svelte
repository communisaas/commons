<script lang="ts">
	import { assessIntegrity } from '$lib/components/org/integrity-assessment';

	type NetworkStats = {
		memberCount: number;
		// Counts arrive sub-K suppressed: 1-4 (districts 1-2) read as null.
		totalSupporters: number | null;
		uniqueSupporters: number | null;
		verifiedSupporters: number | null;
		totalCampaignActions: number | null;
		verifiedCampaignActions: number | null;
		stateDistribution: Record<string, number>;
		gds: number | null;
		ald: number | null;
		temporalEntropy: number | null;
		cai: number | null;
		districtCount: number | null;
	};

	let { stats, loading, brandingAccent = null }: {
		stats: NetworkStats | null;
		loading: boolean;
		// Hex like '#0d9488'. Only set on Coalition-tier orgs. When present,
		// overrides the default teal accent on stat highlights. Validated
		// upstream by the organizations.update mutation.
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

	// A coalition with nothing on record gets one quiet sentence, not a grid
	// of zero tiles.
	// Null means sub-K suppressed — records exist but the count is withheld,
	// so null counts as "something on record".
	const hasStatRecords = $derived(
		stats !== null &&
			(stats.memberCount > 0 ||
				stats.verifiedCampaignActions !== 0 ||
				stats.districtCount !== 0 ||
				stats.verifiedSupporters !== 0)
	);

	function formatCount(value: number | null): string {
		return value === null ? 'fewer than 5' : value.toLocaleString();
	}
	function formatDistrictCount(value: number | null): string {
		return value === null ? 'fewer than 3' : value.toLocaleString();
	}

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

		<!-- Coordination reading line -->
		<div class="mb-4 space-y-2">
			<div class="h-3 w-3/4 rounded bg-zinc-700/50"></div>
			<div class="h-3 w-24 rounded bg-zinc-700/50"></div>
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
	<!-- Stats grid — or one quiet sentence when nothing is on record yet. -->
	{#if hasStatRecords}
		<div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
			<div class="rounded-lg bg-zinc-900/50 p-3">
				<p class="text-xs font-medium text-zinc-500">Member Orgs</p>
				<p class="mt-1 text-xl font-bold text-zinc-100">{stats.memberCount}</p>
			</div>
			<div class="rounded-lg bg-zinc-900/50 p-3">
				<p class="text-xs font-medium text-zinc-500">Verified Actions</p>
				<p class="mt-1 text-xl font-bold text-zinc-100">{formatCount(stats.verifiedCampaignActions)}</p>
			</div>
			<div class="rounded-lg bg-zinc-900/50 p-3">
				<p class="text-xs font-medium text-zinc-500">Unique Districts</p>
				<p class="mt-1 text-xl font-bold" style="color: var(--coalition-accent, #2dd4bf);">{formatDistrictCount(stats.districtCount)}</p>
			</div>
			<div class="rounded-lg bg-zinc-900/50 p-3">
				<p class="text-xs font-medium text-zinc-500">Verified Supporters</p>
				<p class="mt-1 text-xl font-bold text-green-400">{formatCount(stats.verifiedSupporters)}</p>
			</div>
		</div>
	{:else}
		<p class="text-text-tertiary mb-4 text-sm">
			Nothing is on record for this coalition yet — member organizations, verified actions, and
			district coverage appear here as they happen.
		</p>
	{/if}

	<!-- Coordination reading: one plain-language line; raw scores stay in the collapsed audit. -->
	{#if stats.gds !== null || stats.ald !== null || stats.temporalEntropy !== null || stats.cai !== null}
		<div class="mb-4">
			<p class="text-text-secondary text-sm">
				{assessIntegrity({
					gds: stats.gds,
					ald: stats.ald,
					temporalEntropy: stats.temporalEntropy,
					burstVelocity: null,
					cai: stats.cai
				})}
			</p>
			<details class="mt-2">
				<summary
					class="text-text-tertiary hover:text-text-secondary cursor-pointer text-xs font-medium"
				>
					Coordination audit
				</summary>
				<div class="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
					<div class="border-surface-border bg-surface-raised rounded-lg border p-3">
						<p class="text-text-tertiary text-xs font-medium">Geographic diversity</p>
						<p class="text-text-primary mt-1 font-mono text-sm">{formatScalar(stats.gds)}</p>
					</div>
					<div class="border-surface-border bg-surface-raised rounded-lg border p-3">
						<p class="text-text-tertiary text-xs font-medium">Message distinctness</p>
						<p class="text-text-primary mt-1 font-mono text-sm">{formatScalar(stats.ald)}</p>
					</div>
					<div class="border-surface-border bg-surface-raised rounded-lg border p-3">
						<p class="text-text-tertiary text-xs font-medium">Timing spread</p>
						<p class="text-text-primary mt-1 font-mono text-sm">
							{formatScalar(stats.temporalEntropy)}
						</p>
					</div>
					<div class="border-surface-border bg-surface-raised rounded-lg border p-3">
						<p class="text-text-tertiary text-xs font-medium">Engagement depth</p>
						<p class="text-text-primary mt-1 font-mono text-sm">{formatScalar(stats.cai)}</p>
					</div>
				</div>
			</details>
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
