<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let search = $state('');

	const filtered = $derived(
		search.trim().length > 0
			? data.orgs.filter((o) =>
					o.name.toLowerCase().includes(search.trim().toLowerCase())
				)
			: data.orgs
	);

	const hasNext = $derived(data.offset + data.limit < data.total);
	const hasPrev = $derived(data.offset > 0);

	function initials(name: string): string {
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((w) => w.charAt(0).toUpperCase())
			.join('');
	}
</script>

<svelte:head>
	<title>Directory | Commons</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-10">
	<div class="mb-8">
		<h1 class="text-2xl font-semibold text-text-primary">Organization Directory</h1>
		<p class="mt-1 text-sm text-text-tertiary">
			Discover organizations building proof of constituent voice.
		</p>
	</div>

	<!-- Search -->
	<div class="mb-6">
		<input
			type="text"
			class="w-full rounded-lg border border-surface-border bg-surface-base px-4 py-2.5 text-sm text-text-primary placeholder-text-quaternary focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
			placeholder="Search organizations..."
			bind:value={search}
		/>
	</div>

	<!-- Grid -->
	{#if filtered.length === 0}
		<div class="py-16 text-center">
			<p class="text-sm text-text-quaternary">
				{search.trim().length > 0
					? 'No organizations match your search.'
					: 'No public organizations yet.'}
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each filtered as org (org.slug)}
				<a
					href="/org/{org.slug}"
					class="rounded-md bg-surface-base border border-surface-border p-5 shadow-[var(--shadow-sm)] transition-colors hover:border-teal-500/40 group"
				>
					<!-- Logo / initials -->
					<div class="flex items-center gap-3 mb-3">
						{#if org.logoUrl}
							<img
								src={org.logoUrl}
								alt={org.name}
								class="w-10 h-10 rounded-lg object-cover flex-shrink-0"
							/>
						{:else}
							<div class="w-10 h-10 rounded-lg bg-surface-raised flex items-center justify-center text-sm font-bold text-text-tertiary flex-shrink-0">
								{initials(org.name)}
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium text-text-primary group-hover:text-teal-500 transition-colors truncate">
								{org.name}
							</p>
							<p class="text-[10px] font-mono text-text-quaternary">
								{org.memberCount} member{org.memberCount === 1 ? '' : 's'}
							</p>
						</div>
					</div>

					<!-- Mission -->
					{#if org.mission}
						<p class="text-xs text-text-secondary line-clamp-3">{org.mission}</p>
					{:else if org.description}
						<p class="text-xs text-text-secondary line-clamp-3">{org.description}</p>
					{/if}
				</a>
			{/each}
		</div>
	{/if}

	<!-- Pagination -->
	{#if data.total > data.limit}
		<div class="flex items-center justify-between mt-8 text-sm">
			<span class="text-text-quaternary font-mono tabular-nums">
				{data.offset + 1}&ndash;{Math.min(data.offset + data.limit, data.total)} of {data.total}
			</span>
			<div class="flex gap-2">
				{#if hasPrev}
					<a
						href="/directory?offset={Math.max(data.offset - data.limit, 0)}"
						class="rounded-lg border border-surface-border px-3 py-1.5 text-text-secondary hover:border-teal-500/40 hover:text-teal-500 transition-colors"
					>
						Previous
					</a>
				{/if}
				{#if hasNext}
					<a
						href="/directory?offset={data.offset + data.limit}"
						class="rounded-lg border border-surface-border px-3 py-1.5 text-text-secondary hover:border-teal-500/40 hover:text-teal-500 transition-colors"
					>
						Next
					</a>
				{/if}
			</div>
		</div>
	{/if}
</div>
