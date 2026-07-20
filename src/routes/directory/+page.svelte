<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let search = $state('');

	const filtered = $derived(
		search.trim().length > 0
			? data.orgs.filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase()))
			: data.orgs
	);

	const hasNext = $derived(data.hasMore && data.cursor !== null);

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
		<h1 class="text-text-primary text-2xl font-semibold">Organization Directory</h1>
		<p class="text-text-tertiary mt-1 text-sm">
			Discover organizations building proof of constituent voice.
		</p>
	</div>

	<!-- Search -->
	<div class="mb-6">
		<input
			type="text"
			class="border-surface-border bg-surface-base text-text-primary placeholder-text-quaternary w-full rounded-lg border px-4 py-2.5 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
			placeholder="Filter this page..."
			bind:value={search}
		/>
	</div>

	<!-- Grid -->
	{#if filtered.length === 0}
		<div class="py-16 text-center">
			<p class="text-text-quaternary text-sm">
				{search.trim().length > 0
					? 'No organizations match your search.'
					: 'No public organizations yet.'}
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each filtered as org (org.slug)}
				<a
					href="/org/{org.slug}"
					class="bg-surface-base border-surface-border group rounded-md border p-5 transition-colors hover:border-teal-500/40"
				>
					<!-- Logo / initials -->
					<div class="mb-3 flex items-center gap-3">
						{#if org.logoUrl}
							<img
								src={org.logoUrl}
								alt={org.name}
								class="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
							/>
						{:else}
							<div
								class="bg-surface-raised text-text-tertiary flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold"
							>
								{initials(org.name)}
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<p
								class="text-text-primary truncate text-sm font-medium transition-colors group-hover:text-teal-500"
							>
								{org.name}
							</p>
							<p class="text-text-quaternary font-mono text-[10px]">
								{org.memberCount} member{org.memberCount === 1 ? '' : 's'}
							</p>
						</div>
					</div>

					<!-- Mission -->
					{#if org.mission}
						<p class="text-text-secondary line-clamp-3 text-xs">{org.mission}</p>
					{:else if org.description}
						<p class="text-text-secondary line-clamp-3 text-xs">{org.description}</p>
					{/if}
				</a>
			{/each}
		</div>
	{/if}

	<!-- Pagination -->
	{#if data.total > 0}
		<div class="mt-8 flex items-center justify-between text-sm">
			<span class="text-text-quaternary font-mono tabular-nums">
				Showing {data.orgs.length} of {data.total}
			</span>
			<div class="flex gap-2">
				{#if !data.isFirstPage}
					<a
						href="/directory"
						class="border-surface-border text-text-secondary rounded-lg border px-3 py-1.5 transition-colors hover:border-teal-500/40 hover:text-teal-500"
					>
						First page
					</a>
				{/if}
				{#if hasNext}
					<a
						href="/directory?cursor={encodeURIComponent(data.cursor!)}"
						class="border-surface-border text-text-secondary rounded-lg border px-3 py-1.5 transition-colors hover:border-teal-500/40 hover:text-teal-500"
					>
						Next
					</a>
				{/if}
			</div>
		</div>
	{/if}
</div>
